import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/api/client.ts';
import { uploadWorld, type UploadItem, type UploadProgress } from '../../src/client/world/upload.ts';

const SCAN_ID = '20261017T120000Z-abcdef';
const MiB = 2 ** 20;

function item(rel: string, size: number): UploadItem {
  return { rel, size, blob: async () => new Blob([new Uint8Array(size)]) };
}

/** A worldApi stand-in that records its calls; `hold(rel)` keeps that file's PUT open until `release(rel)`. */
function fakeApi() {
  const calls: string[] = [];
  const held = new Map<string, () => void>();
  const holding = new Set<string>();
  let inFlight = 0;
  let maxInFlight = 0;
  const sentSizes: Record<string, number> = {};
  return {
    calls, sentSizes,
    get maxInFlight() { return maxInFlight; },
    hold: (rel: string) => holding.add(rel),
    release: (rel: string) => held.get(rel)?.(),
    /** Holds nothing more and lets every held file finish. */
    releaseAll: () => {
      holding.clear();
      for (const resolve of held.values()) resolve();
    },
    createUpload: async (): Promise<string> => {
      calls.push('create');
      return 'u1';
    },
    putFile: async (uploadId: string, rel: string, body: Blob): Promise<void> => {
      expect(uploadId).toBe('u1');
      calls.push(`put ${rel}`);
      sentSizes[rel] = body.size;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (holding.has(rel)) await new Promise<void>((resolve) => held.set(rel, resolve));
      else await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    },
    completeUpload: async (uploadId: string): Promise<string> => {
      expect(uploadId).toBe('u1');
      calls.push('complete');
      return SCAN_ID;
    },
  };
}

function failingApi(status: number, message: string, failOn = 'level.dat') {
  const api = fakeApi();
  return {
    ...api,
    putFile: async (uploadId: string, rel: string, body: Blob): Promise<void> => {
      if (rel === failOn) {
        api.calls.push(`put ${rel}`);
        throw new ApiError(status, 'too-large', message);
      }
      await api.putFile(uploadId, rel, body);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let api: ReturnType<typeof fakeApi>;
beforeEach(() => {
  api = fakeApi();
});

describe('uploadWorld', () => {
  it('uploads level.dat first, then regions, then completes', async () => {
    const progress: UploadProgress[] = [];
    const scanId = await uploadWorld([item('region/r.0.0.mca', 10), item('level.dat', 5), item('DIM-1/region/r.0.0.mca', 10)], api, (p) => progress.push(p));
    expect(scanId).toBe('20261017T120000Z-abcdef');
    expect(api.calls).toEqual(['create', 'put level.dat', 'put region/r.0.0.mca', 'put DIM-1/region/r.0.0.mca', 'complete']);
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, bytesDone: 25, bytesTotal: 25 });
    expect(api.sentSizes).toEqual({ 'level.dat': 5, 'region/r.0.0.mca': 10, 'DIM-1/region/r.0.0.mca': 10 });
  });

  it('reports each file as it starts and as it is done', async () => {
    const progress: UploadProgress[] = [];
    await uploadWorld([item('level.dat', 5), item('region/r.0.0.mca', 10)], api, (p) => progress.push({ ...p }));
    expect(progress[0]).toEqual({ done: 0, total: 2, bytesDone: 0, bytesTotal: 15, current: 'level.dat' });
    expect(progress).toContainEqual({ done: 1, total: 2, bytesDone: 5, bytesTotal: 15, current: 'level.dat' });
    expect(progress).toContainEqual({ done: 1, total: 2, bytesDone: 5, bytesTotal: 15, current: 'region/r.0.0.mca' });
    expect(progress.at(-1)).toEqual({ done: 2, total: 2, bytesDone: 15, bytesTotal: 15, current: 'region/r.0.0.mca' });
  });

  it('sends level.dat alone, then at most two region files at a time', async () => {
    api.hold('level.dat');
    const regions = [0, 1, 2, 3, 4].map((i) => `region/r.${i}.0.mca`);
    const done = uploadWorld([item('level.dat', 5), ...regions.map((r) => item(r, 10))], api, () => {});
    await tick();
    expect(api.calls).toEqual(['create', 'put level.dat']);   // no region before level.dat is stored
    for (const r of regions) api.hold(r);
    api.release('level.dat');
    await tick();
    expect(api.calls.slice(2)).toEqual(['put region/r.0.0.mca', 'put region/r.1.0.mca']);
    api.release('region/r.1.0.mca');
    await tick();
    expect(api.calls.slice(2)).toEqual(['put region/r.0.0.mca', 'put region/r.1.0.mca', 'put region/r.2.0.mca']);
    api.releaseAll();
    expect(await done).toBe(SCAN_ID);
    expect(api.maxInFlight).toBe(2);
    expect(api.calls.at(-1)).toBe('complete');
  });

  it('refuses an oversized region before uploading anything', async () => {
    await expect(uploadWorld([item('level.dat', 5), item('region/r.0.0.mca', 128 * 2 ** 20 + 1)], api, () => {})).rejects.toThrow('region/r.0.0.mca');
    expect(api.calls).toEqual([]);
  });

  it('takes files right at the limits and refuses an oversized level.dat', async () => {
    const atLimit: UploadItem[] = [{ ...item('level.dat', 0), size: 32 * MiB }, { ...item('region/r.0.0.mca', 0), size: 128 * MiB }];
    expect(await uploadWorld(atLimit, api, () => {})).toBe(SCAN_ID);
    const fresh = fakeApi();
    await expect(uploadWorld([item('level.dat', 32 * MiB + 1)], fresh, () => {})).rejects.toThrow('level.dat');
    expect(fresh.calls).toEqual([]);
  });

  it('refuses before uploading anything without level.dat, with a path the server does not take, or with too many files', async () => {
    await expect(uploadWorld([item('region/r.0.0.mca', 5)], api, () => {})).rejects.toThrow('level.dat');
    await expect(uploadWorld([item('level.dat', 5), item('playerdata/a.dat', 5)], api, () => {})).rejects.toThrow('playerdata/a.dat');
    const many = [item('level.dat', 1), ...Array.from({ length: 4096 }, (_, i) => item(`region/r.${i}.0.mca`, 1))];
    await expect(uploadWorld(many, api, () => {})).rejects.toThrow('4,097 files');
    const huge = [item('level.dat', 1), ...Array.from({ length: 64 }, (_, i) => ({ ...item(`region/r.${i}.0.mca`, 0), size: 128 * MiB }))];
    await expect(uploadWorld(huge, api, () => {})).rejects.toThrow('8 GiB');
    expect(api.calls).toEqual([]);
  });

  it('stops on abort and reports the failing file', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(uploadWorld([item('level.dat', 5)], api, () => {}, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(uploadWorld([item('level.dat', 5)], failingApi(413, 'too large'), () => {})).rejects.toThrow('level.dat: too large');
    expect(api.calls).toEqual([]);
  });

  it('stops between files when aborted during the upload and never completes it', async () => {
    const ac = new AbortController();
    api.hold('level.dat');
    const done = uploadWorld([item('level.dat', 5), item('region/r.0.0.mca', 10)], api, () => {}, ac.signal);
    await tick();
    ac.abort(new Error('some other reason'));
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    api.release('level.dat');
    await tick();
    expect(api.calls).toEqual(['create', 'put level.dat']);
  });

  it('starts no more files after one fails, and does not complete', async () => {
    const bad = failingApi(500, 'disk full', 'region/r.1.0.mca');
    const items = [item('level.dat', 5), ...[0, 1, 2, 3, 4, 5].map((i) => item(`region/r.${i}.0.mca`, 10))];
    await expect(uploadWorld(items, bad, () => {})).rejects.toThrow('region/r.1.0.mca: disk full');
    await tick();
    expect(bad.calls).toEqual(['create', 'put level.dat', 'put region/r.0.0.mca', 'put region/r.1.0.mca']);   // r.0 was in flight beside r.1
  });

  it('names the file whose bytes cannot be read', async () => {
    const unreadable: UploadItem = { rel: 'region/r.0.0.mca', size: 10, blob: async () => { throw new Error('The file was moved'); } };
    await expect(uploadWorld([item('level.dat', 5), unreadable], api, () => {})).rejects.toThrow('region/r.0.0.mca: The file was moved');
  });
});
