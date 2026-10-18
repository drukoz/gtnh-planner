import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_AREA_VOXELS } from '../../../src/server/world/area.ts';
import { emptyFacts } from '../../../src/server/world/facts.ts';
import { createWorldService, isScanId, newScanId, type WorldService } from '../../../src/server/world/scan.ts';
import { NO_EXPORT_WARNING } from '../../../src/server/world/scan.worker.ts';
import type { WorldConfig } from '../../../src/server/world/sources.ts';
import { decodeMapTile, type ScanStatus, type WorldSource } from '../../../src/shared/types/world.ts';
import { makeBackup } from '../../helpers/make-world.ts';
import { SAMPLE, SAMPLE_BACKUP, makeSampleWorld } from '../../helpers/sample-world.ts';
import { testFacts } from '../../helpers/world-facts.ts';

// config.dataDir = tmp/data, config.serverFolder = makeSampleWorld(tmp/srv), whose backup SAMPLE_BACKUP (= NEWER) is
// 10 minutes old; OLDER is a second complete backup of the same world, 40 minutes old.

const NEWER = SAMPLE_BACKUP;
const OLDER = '2026-10-17-10-30-00.zip';
const UNKNOWN_ID = '20991231T000000Z-abcdef';

let tmp: string, srv: string, dataDir: string, config: WorldConfig;

/** Writes `data/scans/<id>/status.json` as a scan of an earlier server process left it. */
async function writeStatus(dir: string, id: string, fields: Partial<ScanStatus> & { source?: WorldSource }): Promise<void> {
  await mkdir(join(dir, 'scans', id), { recursive: true });
  const status = { id, state: 'running', progress: 0, message: 'Scanning Overworld r.0.0', startedAt: '2026-10-17T12:00:00.000Z', source: { kind: 'server' }, ...fields };
  await writeFile(join(dir, 'scans', id, 'status.json'), JSON.stringify(status));
}

async function statusFile(id: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, 'scans', id, 'status.json'), 'utf8')) as Record<string, unknown>;
}

/**
 * A service whose scans wait in `running` (on their pack facts) until `open()`: an in-process scan of the sample world
 * takes milliseconds, so tests that look at a running or queued scan hold the queue here.
 */
function gatedService(): { svc: WorldService; open: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  return { svc: createWorldService({ config, facts: async () => { await gate; return testFacts(); }, useWorker: false }), open };
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-scan-service-'));
  srv = (await makeSampleWorld(join(tmp, 'srv'))).serverDir;
  await makeBackup(srv, OLDER, { mtime: new Date(Date.now() - 40 * 60_000) });
  dataDir = join(tmp, 'data');
  config = { dataDir, serverFolder: srv };
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('scan ids', () => {
  it('formats the start time and six hex digits', () => {
    const id = newScanId(new Date('2026-10-17T12:34:56.789Z'));
    expect(id).toMatch(/^20261017T123456Z-[0-9a-f]{6}$/);
    expect(isScanId(id)).toBe(true);
    expect(newScanId(new Date('2026-10-17T12:34:56.789Z'))).not.toBe(id);
  });

  it.each(['', '20261017T123456Z', '20261017T123456Z-ABCDEF', '20261017T123456Z-abcdeg', '../20261017T123456Z-abcdef', '20261017T123456Z-abcdef/..'])(
    'refuses %j', (s) => expect(isScanId(s)).toBe(false));
});

describe('the world service', () => {
  let svc: WorldService, id: string;

  it('queues, runs and caches a scan; identical sources share one scan', async () => {
    svc = createWorldService({ config, facts: async () => testFacts(), useWorker: false });
    const [a, b] = await Promise.all([svc.startScan({ kind: 'server' }), svc.startScan({ kind: 'server' })]);
    expect(a).toBe(b);
    await svc.idle();
    expect(svc.scanStatus(a)).toMatchObject({ id: a, state: 'done', progress: 1, message: 'Done: 2 bases, 10 machines' });
    expect((await svc.getScan(a))!.bases.map((x) => x.id)).toEqual(SAMPLE.baseIds);
    expect((await svc.listScans())[0]).toMatchObject({ id: a, state: 'done', source: { kind: 'server' }, levelName: 'World' });
    id = a;
  });

  it('keeps finished scans: a new request for the same source starts a new scan', async () => {
    expect(await svc.getScan(id)).toBe(await svc.getScan(id));   // parsed once, then served from memory
    const again = await svc.startScan({ kind: 'server' });
    expect(again).not.toBe(id);
    expect(svc.scanStatus(again).state).toMatch(/^(queued|running)$/);
    await svc.idle();
    expect(svc.scanStatus(again).state).toBe('done');
    expect((await svc.listScans()).map((s) => s.id)).toEqual([again, id]);   // newest first
  });

  it('writes the request source into status.json, but scanStatus returns only the status', async () => {
    const status = svc.scanStatus(id);
    expect(Object.keys(status).sort()).toEqual(['finishedAt', 'id', 'message', 'progress', 'startedAt', 'state']);
    expect(await statusFile(id)).toEqual({ ...status, source: { kind: 'server' } });
    expect(Date.parse(status.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(status.startedAt));
    expect(svc.hasScan(id)).toBe(true);
  });

  it('serves cached surface tiles and renders Y-cut tiles and areas on demand', async () => {
    const surface = decodeMapTile((await svc.tile(id, 0, 0, 0, 255))!, 0, 0, 0);
    const cut = decodeMapTile((await svc.tile(id, 0, 0, 0, 63))!, 0, 0, 0);
    const pal = (await svc.palette(id))!;
    expect([pal[surface.top[3]!]!.id, surface.height[3]]).toEqual(['gregtech:gt.blockmachines', 64]);   // macerator at (3,64,0)
    expect([pal[cut.top[3]!]!.id, cut.height[3]]).toEqual(['minecraft:stone', 63]);
    const v = await svc.readArea(id, 0, { minX: 0, minY: 64, minZ: 0, maxX: 3, maxY: 64, maxZ: 0 });
    expect(v.blocks.length).toBe(4);
    expect(await svc.tile(UNKNOWN_ID, 0, 0, 0, 255)).toBeNull();
  });

  it('serves the saved surface tile as stored, keeps rendered tiles and freezes the saved palette', async () => {
    const saved = await readFile(join(dataDir, 'scans', id, 'tiles', '0', '0_0.bin'));
    expect(Buffer.from((await svc.tile(id, 0, 0, 0, 255))!).equals(saved)).toBe(true);
    expect(await svc.tile(id, 0, 0, 0, 63)).toBe(await svc.tile(id, 0, 0, 0, 63));   // rendered once
    const pal = (await svc.palette(id))!;
    expect(pal).toEqual(JSON.parse(await readFile(join(dataDir, 'scans', id, 'palette.json'), 'utf8')));
    const cut = decodeMapTile((await svc.tile(id, 0, 0, 0, 64))!, 0, 0, 0);
    expect(pal[cut.top[3]!]).toEqual({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 });   // GT ids from the scan's machines
    expect(Math.max(...cut.top)).toBeLessThan(pal.length);                                        // never a new palette entry
    // a tile without a saved .bin is rendered: chunks the scan did not copy are unknown (palette index 1)
    expect(decodeMapTile((await svc.tile(id, 0, 40, 40, 255))!, 0, 40, 40).top.every((i) => i === 1)).toBe(true);
  });

  it('reads areas with their own palette and refuses areas above MAX_AREA_VOXELS', async () => {
    const v = await svc.readArea(id, 0, { minX: 0, minY: 63, minZ: 0, maxX: 3, maxY: 64, maxZ: 0 });
    expect([v.origin, v.size]).toEqual([[0, 63, 0], [4, 2, 1]]);
    expect(v.palette[v.blocks[0]!]).toEqual({ id: 'minecraft:stone', meta: 0 });
    expect(v.palette[v.blocks[4 + 3]!]).toEqual({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 });
    expect(1024 * 256 * 33).toBeGreaterThan(MAX_AREA_VOXELS);
    await expect(svc.readArea(id, 0, { minX: 0, minY: 0, minZ: 0, maxX: 1023, maxY: 255, maxZ: 32 })).rejects.toThrow(RangeError);
    await expect(svc.readArea(UNKNOWN_ID, 0, { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })).rejects.toThrow(/not finished/);
  });

  it('answers for unknown scans without touching the file system outside data/scans', () => {
    for (const bad of [UNKNOWN_ID, '..', '../srv', 'nope']) {
      expect(svc.scanStatus(bad)).toEqual({ id: bad, state: 'failed', progress: 0, message: 'Unknown scan', startedAt: '1970-01-01T00:00:00.000Z' });
      expect(svc.hasScan(bad)).toBe(false);
      expect(svc.cancelScan(bad)).toBe(false);
    }
  });

  it('runs one scan at a time and returns no scan, palette or tile until a scan is done', async () => {
    const held = gatedService();
    const first = await held.svc.startScan({ kind: 'backup', file: NEWER });
    const queued = await held.svc.startScan({ kind: 'server' });
    expect(held.svc.scanStatus(first)).toMatchObject({ id: first, state: 'running', message: 'Starting' });
    expect(held.svc.scanStatus(queued)).toMatchObject({ id: queued, state: 'queued', progress: 0, message: 'Queued' });
    expect(await statusFile(queued)).toMatchObject({ state: 'queued', source: { kind: 'server' } });
    expect([held.svc.hasScan(first), held.svc.hasScan(queued)]).toEqual([true, true]);
    expect(await held.svc.startScan({ kind: 'server' })).toBe(queued);   // still queued: the same scan
    for (const notDone of [first, queued]) {
      expect([await held.svc.getScan(notDone), await held.svc.palette(notDone), await held.svc.tile(notDone, 0, 0, 0, 255)]).toEqual([null, null, null]);
      await expect(held.svc.readArea(notDone, 0, { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })).rejects.toThrow(/not finished/);
    }
    held.open();
    await held.svc.idle();
    expect([held.svc.scanStatus(first).state, held.svc.scanStatus(queued).state]).toEqual(['done', 'done']);
    expect(Date.parse(held.svc.scanStatus(queued).finishedAt!)).toBeGreaterThanOrEqual(Date.parse(held.svc.scanStatus(first).finishedAt!));
  });

  it('cancels queued and running scans and refuses to cancel finished ones', async () => {
    const held = gatedService();
    const running = await held.svc.startScan({ kind: 'backup', file: NEWER });
    const queued = await held.svc.startScan({ kind: 'server' });
    expect([held.svc.scanStatus(running).state, held.svc.scanStatus(queued).state]).toEqual(['running', 'queued']);
    expect(held.svc.cancelScan(queued)).toBe(true);
    expect(held.svc.scanStatus(queued)).toMatchObject({ state: 'failed', message: 'Cancelled' });
    expect(held.svc.cancelScan(queued)).toBe(false);
    expect(held.svc.cancelScan(running)).toBe(true);
    expect(held.svc.scanStatus(running)).toMatchObject({ state: 'failed', message: 'Cancelled' });
    held.open();
    await held.svc.idle();
    for (const cancelled of [running, queued]) {
      expect(held.svc.scanStatus(cancelled)).toMatchObject({ state: 'failed', message: 'Cancelled' });
      expect(await readdir(join(dataDir, 'scans', cancelled))).toEqual(['status.json']);
      expect(await statusFile(cancelled)).toMatchObject({ state: 'failed', message: 'Cancelled' });
    }
    expect(held.svc.cancelScan(id)).toBe(false);   // finished in another service of this data folder
    // a cancelled scan no longer holds its source: the same request starts a new scan
    const next = await held.svc.startScan({ kind: 'server' });
    expect([next === queued, next === running]).toEqual([false, false]);
    expect(held.svc.cancelScan(next)).toBe(true);
    await held.svc.idle();
    expect(svc.cancelScan(id)).toBe(false);   // finished
  });

  it('cancels an in-process scan part-way through and discards what it wrote', async () => {
    let mid!: () => void;
    const reached = new Promise<void>((r) => { mid = r; });
    const local = createWorldService({ config, facts: async () => testFacts(), useWorker: false });
    const scanning = await local.startScan({ kind: 'server' });
    // the job reports progress synchronously and needs file I/O to go on, so it is still running when this resumes
    const poll = setInterval(() => { if (local.scanStatus(scanning).progress > 0) mid(); }, 0);
    await reached;
    clearInterval(poll);
    expect(local.scanStatus(scanning).state).toBe('running');
    expect(local.cancelScan(scanning)).toBe(true);
    await local.idle();
    expect(local.scanStatus(scanning)).toMatchObject({ state: 'failed', message: 'Cancelled' });
    expect(await readdir(join(dataDir, 'scans', scanning))).toEqual(['status.json']);
  });

  it('marks scans interrupted by a restart as failed', async () => {
    await writeStatus(dataDir, '20261017T120000Z-aaaaaa', { state: 'running', progress: 0.4 });
    await writeStatus(dataDir, '20261017T120000Z-bbbbbb', { state: 'queued', source: { kind: 'backup', file: OLDER } });
    await writeStatus(dataDir, '20261017T120000Z-cccccc', { state: 'failed', message: 'Cancelled', finishedAt: '2026-10-17T12:01:00.000Z' });
    const restarted = createWorldService({ config, facts: async () => testFacts(), useWorker: false });
    expect(restarted.scanStatus('20261017T120000Z-aaaaaa')).toMatchObject({ state: 'failed', message: 'Interrupted by a server restart', progress: 0.4 });
    expect(restarted.scanStatus('20261017T120000Z-bbbbbb')).toMatchObject({ state: 'failed', message: 'Interrupted by a server restart' });
    expect(restarted.scanStatus('20261017T120000Z-cccccc')).toMatchObject({ state: 'failed', message: 'Cancelled' });
    expect(await statusFile('20261017T120000Z-bbbbbb')).toMatchObject({ state: 'failed', source: { kind: 'backup', file: OLDER } });
    const listed = (await restarted.listScans()).find((s) => s.id === '20261017T120000Z-aaaaaa');
    expect(listed).toMatchObject({ state: 'failed', source: { kind: 'server' }, levelName: null });
    expect((await restarted.getScan(id))!.bases.map((b) => b.id)).toEqual(SAMPLE.baseIds);   // finished scans read from disk
  });

  it('fails a scan whose pack facts cannot be loaded and leaves only status.json', async () => {
    const broken = createWorldService({ config, facts: async () => { throw new Error('No export is active'); }, useWorker: false });
    const failed = await broken.startScan({ kind: 'server' });
    await broken.idle();
    expect(broken.scanStatus(failed)).toMatchObject({ state: 'failed', message: 'No export is active' });
    expect(broken.scanStatus(failed).finishedAt).toBeDefined();
    expect(await readdir(join(dataDir, 'scans', failed))).toEqual(['status.json']);
    expect(await broken.getScan(failed)).toBeNull();
  });

  it('fails cleanly when a queued backup disappears', async () => {
    const held = gatedService();   // a stays running until the backup is gone
    const a = await held.svc.startScan({ kind: 'backup', file: NEWER });   // two complete backups of the sample world
    const b = await held.svc.startScan({ kind: 'backup', file: OLDER });   // queued behind a; sources are opened only when a job starts
    await rm(join(srv, 'backups', OLDER));
    held.open();
    await held.svc.idle();
    expect(held.svc.scanStatus(a).state).toBe('done');
    expect(held.svc.scanStatus(b)).toMatchObject({ state: 'failed', message: expect.stringMatching(/^Source unavailable/) });
    expect(held.svc.scanStatus(b).message).toBe(`Source unavailable: backup ${OLDER}`);
    expect(await readdir(join(dataDir, 'scans', b))).toEqual(['status.json']);
  });

  it('refuses unknown sources with SourceError', async () => {
    await expect(svc.startScan({ kind: 'backup', file: '../x.zip' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.startScan({ kind: 'upload', uploadId: 'f'.repeat(32) })).rejects.toMatchObject({ status: 400 });
    const offline = createWorldService({ config: { dataDir: join(tmp, 'data-offline'), serverFolder: null }, facts: async () => testFacts(), useWorker: false });
    await expect(offline.startScan({ kind: 'server' })).rejects.toMatchObject({ name: 'SourceError', status: 400 });
    expect(await offline.listScans()).toEqual([]);
    expect(await offline.listSources()).toEqual({ server: false, backups: [] });
    expect(await svc.listSources()).toEqual({ server: true, backups: [NEWER] });
  });

  it('lists the warnings of a finished scan, and none for a scan without any', async () => {
    const bare = createWorldService({ config: { ...config, dataDir: join(tmp, 'data-no-export') }, facts: async () => emptyFacts(), useWorker: false });
    const noExport = await bare.startScan({ kind: 'server' });
    await bare.idle();
    expect((await bare.listScans()).find((s) => s.id === noExport)).toMatchObject({ state: 'done', levelName: 'World', warnings: [NO_EXPORT_WARNING] });
    expect((await bare.getScan(noExport))!.warnings).toEqual([NO_EXPORT_WARNING]);
    expect(Object.keys((await svc.listScans()).find((s) => s.id === id)!)).not.toContain('warnings');   // the sample scans clean
  });

  it('lists only scan folders that hold a status', async () => {
    await mkdir(join(dataDir, 'scans', 'not-a-scan'), { recursive: true });
    await mkdir(join(dataDir, 'scans', '20261017T130000Z-dddddd'), { recursive: true });   // no status.json
    const list = await svc.listScans();
    const ids = list.map((s) => s.id);
    expect(ids).not.toContain('not-a-scan');
    expect(ids).not.toContain('20261017T130000Z-dddddd');
    expect(ids.length).toBeGreaterThan(5);
    expect(list.every((s, i) => i === 0 || s.startedAt <= list[i - 1]!.startedAt)).toBe(true);   // newest first
    expect(list.every((s) => Object.keys(s).includes('source') && Object.keys(s).includes('levelName'))).toBe(true);
    expect(svc.hasScan('20261017T130000Z-dddddd')).toBe(false);
  });
});
