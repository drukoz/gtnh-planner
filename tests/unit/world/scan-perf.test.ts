import { copyFile, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createWorldService } from '../../../src/server/world/scan.ts';
import type { WorldConfig } from '../../../src/server/world/sources.ts';
import { makeBackup, makeWorld, type ChunkSpec } from '../../helpers/make-world.ts';
import { sampleSpec } from '../../helpers/sample-world.ts';
import { testFacts } from '../../helpers/world-facts.ts';

// A real worker thread; world = sampleSpec() plus legacy filler chunks for the rest of DIM 0 r.0.0 (1,019 chunks,
// 2 stone sections and 64 ore TEs each), and a backup of it.

const BACKUP = '2026-10-17-09-00-00.zip';

let tmp: string, serverDir: string, dataDir: string, config: WorldConfig;

async function waitFor(check: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-scan-perf-'));
  const spec = sampleSpec();
  const taken = new Set(spec.dims[0]!.map((c) => `${c.cx}:${c.cz}`));
  const fillers: ChunkSpec[] = [];
  for (let cz = 0; cz < 32; cz++) {
    for (let cx = 0; cx < 32; cx++) {
      if (taken.has(`${cx}:${cz}`)) continue;
      fillers.push({
        cx, cz, format: 'legacy', oreTes: 64,
        fill: [{ from: [cx * 16, 0, cz * 16], to: [cx * 16 + 15, 31, cz * 16 + 15], block: 'minecraft:stone' }],
      });
    }
  }
  expect(fillers).toHaveLength(1019);
  spec.dims[0] = [...spec.dims[0]!, ...fillers];
  ({ serverDir } = await makeWorld(join(tmp, 'srv'), spec));
  await makeBackup(serverDir, BACKUP, { mtime: new Date(Date.now() - 10 * 60_000) });
  dataDir = join(tmp, 'data');
  config = { dataDir, serverFolder: serverDir };
}, 120_000);
afterAll(() => rm(tmp, { recursive: true, force: true }));

it('scans in a worker without blocking the main thread, and can be cancelled', { timeout: 120_000 }, async () => {
  const svc = createWorldService({ config, facts: async () => testFacts() });          // useWorker defaults to true
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const id = await svc.startScan({ kind: 'server' });
  await svc.idle();
  lag.disable();
  expect(svc.scanStatus(id).state).toBe('done');
  console.log(`scan-perf: max event-loop lag ${(lag.max / 1e6).toFixed(1)} ms during the scan`);
  expect(lag.max / 1e6).toBeLessThan(100);                                             // ms
  expect((await svc.getScan(id))!.dims.find((d) => d.dim === 0)!.chunks).toBeGreaterThanOrEqual(1024);
  const id2 = await svc.startScan({ kind: 'backup', file: BACKUP });
  await waitFor(() => svc.scanStatus(id2).state === 'running');
  expect(svc.cancelScan(id2)).toBe(true);
  await svc.idle();
  expect(svc.scanStatus(id2)).toMatchObject({ state: 'failed', message: 'Cancelled' });
  expect(await readdir(join(dataDir, 'scans', id2))).toEqual(['status.json']);
});

it('cancels a worker scan part-way through', { timeout: 120_000 }, async () => {
  const svc = createWorldService({ config, facts: async () => testFacts() });
  const id = await svc.startScan({ kind: 'server' });
  await waitFor(() => svc.scanStatus(id).progress >= 0.05 || svc.scanStatus(id).state !== 'running');   // in the region pass or later
  expect(svc.scanStatus(id).state).toBe('running');
  expect(svc.cancelScan(id)).toBe(true);
  await svc.idle();
  expect(svc.scanStatus(id)).toMatchObject({ state: 'failed', message: 'Cancelled' });
  expect(await readdir(join(dataDir, 'scans', id))).toEqual(['status.json']);
});

it('fails a worker scan whose backup disappears before the worker opens it', { timeout: 120_000 }, async () => {
  const doomed = '2026-10-17-08-30-00.zip';
  const doomedPath = join(serverDir, 'backups', doomed);
  await copyFile(join(serverDir, 'backups', BACKUP), doomedPath);
  const old = new Date(Date.now() - 20 * 60_000);
  await utimes(doomedPath, old, old);
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const svc = createWorldService({ config, facts: async () => { await gate; return testFacts(); } });   // holds the job before its worker starts
  const id = await svc.startScan({ kind: 'backup', file: doomed });
  await rm(doomedPath);
  open();
  await svc.idle();
  expect(svc.scanStatus(id)).toMatchObject({ state: 'failed', message: `Source unavailable: backup ${doomed}` });
  expect(await readdir(join(dataDir, 'scans', id))).toEqual(['status.json']);
});
