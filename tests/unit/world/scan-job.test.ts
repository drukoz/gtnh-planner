import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyFacts } from '../../../src/server/world/facts.ts';
import { MAP_MARGIN, NO_EXPORT_WARNING, runScanJob, scanSummary, type ScanJob, type WorkerMessage } from '../../../src/server/world/scan.worker.ts';
import type { ResolvedSource } from '../../../src/server/world/sources.ts';
import type { BlockRef } from '../../../src/shared/types/pack.ts';
import { decodeMapTile, type WorldScan, type WorldSource } from '../../../src/shared/types/world.ts';
import { storageTotals } from '../../../src/shared/world/storage-totals.ts';
import { makeBackup, makeWorld } from '../../helpers/make-world.ts';
import { SAMPLE, SAMPLE_BACKUP, SAMPLE_PLAYER_FILE, makeSampleWorld, sampleSpec } from '../../helpers/sample-world.ts';
import { testFacts } from '../../helpers/world-facts.ts';
import { gtMachine } from '../../helpers/world-tes.ts';

// runScanJob in-process on makeSampleWorld; job = its ScanJob with source { kind: 'snapshot', worldDir, label: 'snapshot' },
// request { kind: 'server' }, serverDir = the sample server folder, facts = testFacts(), scanDir = a fresh temp folder;
// jobFor(path, { kind }) builds the same job for another world folder, upload folder or zip path.

let tmp: string;
let sample: { serverDir: string; worldDir: string };
let worldWithOneCorruptChunk: string, sampleWithCoalBoiler: string, uploadDirWithLevelAndOneRegion: string, dirWithoutLevel: string, zipPath: string;
let scanCount = 0;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A job over `path` in a fresh scan folder: a world folder (snapshot, default), an upload's files folder (dir) or a zip. */
async function jobFor(path: string, opts: { kind?: ResolvedSource['kind']; request?: WorldSource } = {}): Promise<ScanJob> {
  const kind = opts.kind ?? 'snapshot';
  const scanDir = join(tmp, 'scans', `scan-${++scanCount}`);
  await mkdir(scanDir, { recursive: true });
  const source: ResolvedSource = kind === 'snapshot' ? { kind, worldDir: path, label: 'snapshot' } : { kind, path, label: `${kind} ${path}` };
  return {
    scanId: `20261017T120000Z-${scanCount.toString(16).padStart(6, '0')}`, scanDir, source,
    request: opts.request ?? (kind === 'dir' ? { kind: 'upload', uploadId: 'f'.repeat(32) } : { kind: 'server' }),
    serverDir: kind === 'snapshot' ? dirname(path) : kind === 'zip' ? dirname(dirname(path)) : null,
    facts: testFacts(),
  };
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-scan-job-'));
  sample = await makeSampleWorld(join(tmp, 'srv'));

  // the sample's Nether chunk plus a torn chunk in the same region file
  const corrupt = sampleSpec();
  corrupt.dims = { [-1]: [...corrupt.dims[-1]!, { cx: -2, cz: -1, corrupt: true }] };
  worldWithOneCorruptChunk = (await makeWorld(join(tmp, 'corrupt'), corrupt)).worldDir;

  // the sample plus a Small Coal Boiler (no steamPerSecondMax in the export) at (0,64,1), facing north onto the HP boiler
  const coal = sampleSpec();
  const base = coal.dims[0]![0]!;
  base.fill = [...base.fill!, { from: [0, 64, 1], to: [0, 64, 1], block: 'gregtech:gt.blockmachines' }];
  base.tileEntities = [...base.tileEntities!, gtMachine({ pos: [0, 64, 1], mID: 100, facing: 2 })];
  sampleWithCoalBoiler = (await makeWorld(join(tmp, 'coal'), coal)).worldDir;

  // an upload: level.dat and one region file, whose chunk holds a lone machine the export does not know
  const mini = await makeWorld(join(tmp, 'mini'), { dims: { 0: [{ cx: 0, cz: 0, inhabitedTime: 20, fill: [
    { from: [0, 63, 0], to: [15, 63, 15], block: 'minecraft:stone' }, { from: [4, 64, 4], to: [4, 64, 4], block: 'gregtech:gt.blockmachines' }],
  tileEntities: [gtMachine({ pos: [4, 64, 4], mID: 31999 })] }] } });
  uploadDirWithLevelAndOneRegion = join(tmp, 'uploads', 'a'.repeat(32), 'files');
  await mkdir(join(uploadDirWithLevelAndOneRegion, 'region'), { recursive: true });
  await copyFile(join(mini.worldDir, 'level.dat'), join(uploadDirWithLevelAndOneRegion, 'level.dat'));
  await copyFile(join(mini.worldDir, 'region/r.0.0.mca'), join(uploadDirWithLevelAndOneRegion, 'region/r.0.0.mca'));
  dirWithoutLevel = join(tmp, 'uploads', 'b'.repeat(32), 'files');
  await mkdir(join(dirWithoutLevel, 'region'), { recursive: true });
  await copyFile(join(mini.worldDir, 'region/r.0.0.mca'), join(dirWithoutLevel, 'region/r.0.0.mca'));
  zipPath = await makeBackup(mini.serverDir, '2026-10-17-10-00-00.zip', { mtime: new Date(Date.now() - 3_600_000) });
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('the scan job on the sample world', () => {
  let job: ScanJob, scanDir: string, scan: WorldScan;
  const progress: number[] = [], messages: string[] = [];

  beforeAll(async () => {
    job = await jobFor(sample.worldDir);
    scanDir = job.scanDir;
    scan = await runScanJob(job, (p, message) => { progress.push(p); messages.push(message); });
  });

  it('scans the sample world end to end', async () => {
    expect(scan.bases.map((b) => [b.id, b.name, b.machineCount, b.topTier])).toEqual([
      ['0:0:0', 'Alpha base (4, 5)', 6, 1], ['-1:-1:-1', 'Nether base (-4, -2)', 4, 2]]);
    expect([scan.topTier, scan.coilHeat, scan.visitedDims, scan.prospected, scan.skippedChunks])
      .toEqual([2, 2701, ['nether', 'overworld', 'moon'], SAMPLE.prospected, 0]);
    expect(scan.power).toHaveLength(1);
    expect(scan.power[0]!.generatorEUt.clear).toBeCloseTo(7.037, 3);
    expect([scan.power[0]!.storedEU, scan.power[0]!.capacityEU, scan.power[0]!.baseId]).toEqual([101_000, 102_048, '0:0:0']);
    expect(scan.logistics.map((n) => [n.id, n.kind, n.nodes])).toEqual([['r:0:0:65:10', 'routed', 2]]);
    expect(scan.storage.filter((s) => s.networkId === 'r:0:0:65:10').map((s) => s.pos)).toEqual([[0, 64, 10], [1, 64, 10], [3, 64, 10]]);
    expect(scan.dims.find((d) => d.dim === 7)).toMatchObject({ chunks: 2, inhabitedChunks: 0, visited: false });
    expect(scan.machines.find((m) => m.mteId === 1000)!.coilHeat).toBe(2701);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);
    expect(await exists(join(scanDir, 'tiles/0/0_0.bin'))).toBe(true);
    expect(await exists(join(scanDir, 'tiles/-1/-1_-1.bin'))).toBe(true);
    expect(await exists(join(scanDir, 'regions/region/r.0.0.mca'))).toBe(true);
    expect(await exists(join(scanDir, 'regions/DIM7'))).toBe(false);
    expect(await exists(join(scanDir, 'snapshot'))).toBe(false);
    expect(JSON.parse(await readFile(join(scanDir, 'scan.json'), 'utf8')).id).toBe(job.scanId);
  });

  it('matches SAMPLE and says so in its summary', () => {
    expect([scan.bases.map((b) => b.id), scan.bases.map((b) => b.name), scan.bases.map((b) => b.machineCount), scan.bases.map((b) => b.topTier)])
      .toEqual([SAMPLE.baseIds, SAMPLE.baseNames, SAMPLE.machineCount, SAMPLE.baseTopTier]);
    expect([scan.topTier, scan.coilHeat, scan.visitedDims]).toEqual([SAMPLE.topTier, SAMPLE.coilHeat, SAMPLE.visitedDims]);
    expect(scan.logistics[0]!.id).toBe(SAMPLE.routedId);
    expect([scan.power[0]!.storedEU, scan.power[0]!.capacityEU]).toEqual([SAMPLE.power.storedEU, SAMPLE.power.capacityEU]);
    expect(scanSummary(scan)).toBe('Done: 2 bases, 10 machines');
    expect([scan.id, scan.source, scan.levelName, scan.warnings]).toEqual([job.scanId, { kind: 'server' }, 'World', []]);
  });

  it('places machines and pipes with their bases, networks and cable tiers', () => {
    expect(scan.machines.map((m) => [m.dim, m.mteId, m.baseId])).toEqual([
      [-1, 2002, '-1:-1:-1'], [-1, 2002, '-1:-1:-1'], [-1, 2002, '-1:-1:-1'], [-1, 2002, '-1:-1:-1'],
      [0, 114, '0:0:0'], [0, 1120, '0:0:0'], [0, 2001, '0:0:0'], [0, 161, '0:0:0'], [0, 1000, '0:0:0'], [0, 125, '0:0:0']]);
    expect(scan.machines.filter((m) => m.coilHeat !== undefined).map((m) => m.mteId)).toEqual([1000]);
    expect(scan.pipes).toEqual([{ dim: 0, pos: [2, 64, 0], mteId: 1246, connections: 50, kind: 'cable', voltageTier: 1, amps: 1, networkId: 'p:0:1:64:0' }]);
    expect(scan.logisticsBlocks!.map((b) => [b.pos, b.networkId])).toEqual([[[0, 65, 10], 'r:0:0:65:10'], [[1, 65, 10], 'r:0:0:65:10']]);
  });

  it('keeps storage totals, drawer reach and visit evidence as SAMPLE describes', () => {
    expect(Object.fromEntries(storageTotals(scan.storage, scan.logistics, '0:0:0'))).toEqual(SAMPLE.totals);
    expect(scan.storage.find((s) => s.pos[0] === 3 && s.pos[2] === 10)).toMatchObject({ kind: 'drawer', controller: [0, 64, 10], baseId: '0:0:0' });
    expect(scan.dims.map((d) => [d.dim, d.visited, d.visitEvidence])).toEqual([
      [-1, true, ['inhabited chunks: 1', 'portal use']],
      [0, true, ['inhabited chunks: 1', 'player location', 'portal use', 'team prospecting']],
      [7, false, []],
      [28, true, ['quest: Moon Arrival']]]);
  });

  it('reports fixed progress steps and names each region it scans', () => {
    expect(progress[0]).toBe(0.02);
    expect(progress).toEqual(expect.arrayContaining([0.05, 0.8, 0.82, 0.85, 0.95, 0.98]));
    expect(progress.every((p) => p >= 0 && p <= 0.98)).toBe(true);
    expect(messages.filter((m) => m.startsWith('Scanning '))).toEqual([
      'Scanning Nether r.-1.-1', 'Scanning Overworld r.0.0', 'Scanning Twilight Forest r.0.0']);
  });

  it('writes the palette, the meta file and decodable surface tiles', async () => {
    const palette = JSON.parse(await readFile(join(scanDir, 'palette.json'), 'utf8')) as BlockRef[];
    expect(palette.slice(0, 2)).toEqual([{ id: 'minecraft:air', meta: 0 }, { id: 'gtnh-planner:unknown', meta: 0 }]);
    expect(palette).toContainEqual({ id: 'gregtech:gt.blockcasings5', meta: 1 });
    const meta = JSON.parse(await readFile(join(scanDir, 'meta.json'), 'utf8')) as { source: WorldSource; levelName: string; blockNames: Array<[number, string]> };
    expect([meta.source, meta.levelName]).toEqual([{ kind: 'server' }, 'World']);
    expect(meta.blockNames).toContainEqual([4000, 'gregtech:gt.blockmachines']);
    const tile = decodeMapTile(await readFile(join(scanDir, 'tiles/0/0_0.bin')), 0, 0, 0);
    expect([palette[tile.top[3]!], tile.height[3]]).toEqual([{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, 64]);   // macerator at (3,64,0)
    expect([palette[tile.top[5 * 64 + 5]!], tile.height[5 * 64 + 5]]).toEqual([{ id: 'minecraft:stone', meta: 0 }, 63]);
    expect([tile.top[20 * 64 + 40], tile.height[20 * 64 + 40]]).toEqual([1, 0]);   // chunk (2,1) does not exist
    expect((await readdir(join(scanDir, 'tiles'))).sort()).toEqual(['-1', '0']);
    expect((await readdir(scanDir)).sort()).toEqual(['meta.json', 'palette.json', 'regions', 'scan.json', 'tiles']);
  });

  it('copies only the region files within MAP_MARGIN of a base', async () => {
    expect(MAP_MARGIN).toBe(128);
    expect(await readdir(join(scanDir, 'regions'), { recursive: true })).toEqual(expect.arrayContaining(['region/r.0.0.mca', 'DIM-1/region/r.-1.-1.mca']));
    expect((await readdir(join(scanDir, 'regions'))).sort()).toEqual(['DIM-1', 'region']);
  });
});

describe('the scan job on other worlds', () => {
  it('completes with skipped chunks reported', async () => {
    const scan = await runScanJob(await jobFor(worldWithOneCorruptChunk), () => {});
    expect([scan.skippedChunks, scanSummary(scan)]).toEqual([1, 'Done: 1 base, 4 machines (1 chunk skipped)']);
  });

  it('scans a minimal upload: level.dat and one region, no side files', async () => {
    const scan = await runScanJob(await jobFor(uploadDirWithLevelAndOneRegion, { kind: 'dir' }), () => {});
    expect([scan.bases, scan.power, scan.logistics, scan.storage, scan.prospected]).toEqual([[], [], [], [], []]);
    expect(scan.dims.map((d) => d.dim)).toEqual([0]);
    // the machine the export does not know stays on the map without a tier, and never sets the top tier
    expect(scan.machines).toMatchObject([{ mteId: 31999, kind: 'unknown', baseId: null }]);
    expect([scan.machines[0]!.tier, scan.topTier, scan.coilHeat, scan.visitedDims, scan.source]).toEqual([undefined, null, null, ['overworld'], { kind: 'upload', uploadId: 'f'.repeat(32) }]);
  });

  it('scans a backup zip without copying anything into the server folder', async () => {
    const job = await jobFor(join(sample.serverDir, 'backups', SAMPLE_BACKUP), { kind: 'zip' });
    const before = await readdir(sample.serverDir, { recursive: true });
    const scan = await runScanJob(job, () => {});
    expect(scan.bases.map((b) => b.id)).toEqual(SAMPLE.baseIds);
    expect(scan.prospected).toEqual(SAMPLE.prospected);
    expect(await readdir(sample.serverDir, { recursive: true })).toEqual(before);
    expect(await exists(join(job.scanDir, 'side'))).toBe(false);
  });

  it('fails with a clear message when the source is gone', async () => {
    await rm(zipPath);
    await expect(runScanJob(await jobFor(zipPath, { kind: 'zip' }), () => {})).rejects.toThrow(/Source unavailable/);
  });

  it('fails when level.dat is missing', async () => {
    await expect(runScanJob(await jobFor(dirWithoutLevel, { kind: 'dir' }), () => {})).rejects.toThrow('level.dat is missing');
  });

  it('scans past a torn side file and a discovery the cache has no vein for, with a warning for each', async () => {
    const spec = sampleSpec();
    spec.teams = { Alpha: [{ dim: 0, veins: [[-3, 5], [10, 10]] }] };
    const { worldDir } = await makeWorld(join(tmp, 'torn'), spec);
    await writeFile(join(worldDir, 'playerdata', `${SAMPLE_PLAYER_FILE}.dat`), Buffer.from([0x1f, 0x8b, 8, 0, 1, 2]));   // a gzip header, then nothing
    const scan = await runScanJob(await jobFor(worldDir), () => {});
    expect(scan.warnings).toEqual(['1 side file could not be read', '1 prospected vein had no vein type']);
    expect([scan.bases.map((b) => b.id), scan.prospected]).toEqual([SAMPLE.baseIds, SAMPLE.prospected]);
    expect(scan.dims.find((d) => d.dim === 0)!.visitEvidence).toEqual(['inhabited chunks: 1', 'team prospecting']);   // the player's evidence is gone
  });

  it('warns about boilers with unknown steam output', async () => {   // the sample spec plus a coal boiler 100 at (0,64,1)
    expect((await runScanJob(await jobFor(sampleWithCoalBoiler), () => {})).warnings).toContain('1 boiler with unknown steam output');
  });

  it('says when it scanned without a recipe export, first', async () => {
    const scan = await runScanJob({ ...(await jobFor(sample.worldDir)), facts: emptyFacts() }, () => {});
    expect(scan.warnings).toEqual([NO_EXPORT_WARNING]);
    expect([scan.machines.length, scan.machines.every((m) => m.kind === 'unknown' && m.name === undefined)]).toEqual([SAMPLE.machineCount.reduce((a, b) => a + b, 0), true]);
  });
});

describe('the worker bootstrap', () => {
  /** Every message a worker started with `workerData` posts, until it exits. */
  async function runInWorker(workerData: unknown): Promise<WorkerMessage[]> {
    const worker = new Worker(new URL('../../../src/server/world/scan.worker.ts', import.meta.url), {
      workerData, execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    const messages: WorkerMessage[] = [];
    worker.on('message', (m: WorkerMessage) => messages.push(m));
    const code = await new Promise<number>((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
    expect(code).toBe(0);
    return messages;
  }

  it('posts progress, then the summary, from a worker thread', { timeout: 30_000 }, async () => {
    const messages = await runInWorker({ scanJob: await jobFor(sample.worldDir) });
    expect(messages.at(-1)).toEqual({ type: 'done', summary: 'Done: 2 bases, 10 machines' });
    expect(messages.slice(0, -1).every((m) => m.type === 'progress')).toBe(true);
    expect(messages[0]).toEqual({ type: 'progress', progress: 0.02, message: 'Reading level.dat and side files' });
  });

  it('posts the error message when the scan fails', { timeout: 30_000 }, async () => {
    expect((await runInWorker({ scanJob: await jobFor(dirWithoutLevel, { kind: 'dir' }) })).at(-1)).toEqual({ type: 'error', message: 'level.dat is missing' });
  });

  it('does nothing in a worker that was not given a scan job', { timeout: 30_000 }, async () => {
    expect(await runInWorker({})).toEqual([]);
  });
});

describe('scanSummary', () => {
  const scan = (bases: number, machines: number, skippedChunks?: number) =>
    ({ bases: new Array(bases).fill(null), machines: new Array(machines).fill(null), ...(skippedChunks === undefined ? {} : { skippedChunks }) }) as unknown as WorldScan;
  it('counts bases, machines and skipped chunks in singular and plural', () => {
    expect([scanSummary(scan(2, 7)), scanSummary(scan(1, 1, 0)), scanSummary(scan(0, 0, 3)), scanSummary(scan(1, 4, 1))]).toEqual([
      'Done: 2 bases, 7 machines', 'Done: 1 base, 1 machine', 'Done: 0 bases, 0 machines (3 chunks skipped)', 'Done: 1 base, 4 machines (1 chunk skipped)']);
  });
});
