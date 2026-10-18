// The scan job (Plan 4 Task 12; spec §3.3b, §3.4, §3.5, §5): one pass over a world's files that finds bases, machines,
// power, logistics, storage, visited dimensions and prospected veins, copies the region files around the bases into
// the scan folder and draws their surface tiles. It runs in a worker thread (the bootstrap at the end; `scan.ts` starts
// it) or in-process in tests. Between passes it holds only the classified records, never raw chunk data, and it reads
// one region file at a time. The source is only ever read (spec §5): a backup zip, a snapshot copy or an upload.

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { DimensionInfo } from '../../shared/types/pack.ts';
import { encodeMapTile, type Base, type PlacedMachine, type PlacedPipe, type WorldScan, type WorldSource } from '../../shared/types/world.ts';
import { createBlockReader, regionStoreFromDir, regionStoreFromFiles, type AreaInput, type BlockReader } from './area.ts';
import { baseAt, findBases, type BaseHints, type BaseSignal } from './bases.ts';
import { classifyAe2, type Ae2Rec } from './classify/ae2.ts';
import { classifyChest } from './classify/chests.ts';
import { classifyDrawer, readDrawerConfig, type DrawerConfig } from './classify/drawers.ts';
import { classifyConduitBundle, type ConduitRec } from './classify/enderio.ts';
import {
  classifyGtMachine, classifyGtPipe, countsForTopTier, toPlacedMachine, toPlacedPipe, type GtMachineRec, type GtPipeRec,
} from './classify/gt.ts';
import { classifyGtStorage } from './classify/gtchests.ts';
import { classifyBarrel } from './classify/jabba.ts';
import { classifyMultipart, type PrPipeRec } from './classify/projectred.ts';
import { ebfCoilHeat, isEbf } from './coils.ts';
import { claimHints, dimSummaries, playerHints, questVisits, visitedKeys, type VisitHint } from './dims.ts';
import type { ScanPackFacts } from './facts.ts';
import type { WorldEntry, WorldFiles } from './files.ts';
import { readLevelDat, type LevelInfo } from './level-dat.ts';
import { buildLogistics } from './logistics.ts';
import { posKey, type ChunkStat, type RawTe, type StorageRec, type Vec3 } from './model.ts';
import { readGzipNbt } from './nbt.ts';
import { buildPower } from './power.ts';
import { decodeTeamBlob, joinDiscoveries, readVpDimension, teamBlobOf, vpWorldId, type TeamDiscoveries, type VpVein } from './prospecting.ts';
import { parseRegionPath, REGION_HEADER_BYTES, regionChunkRefs, regionPathOf } from './region.ts';
import { copyServerSideFiles, openResolved, type ResolvedSource } from './sources.ts';
import { buildStorage } from './storage.ts';
import { scanRegionBuffer } from './tile-entities.ts';
import { addChunkToPalette, createPalette, renderTile, type Palette } from './tiles.ts';

/** Region files this many blocks around a base's bbox are copied, so the map shows its surroundings too. */
export const MAP_MARGIN = 128;

export interface ScanJob {
  scanId: string;
  /** `data/scans/<scanId>/`: the snapshot, side files, copied regions, tiles and the scan's JSON files go here. */
  scanDir: string;
  /** What was asked for; it becomes `WorldScan.source`. */
  request: WorldSource;
  source: ResolvedSource;
  /** The server folder, for the side files outside the world (VisualProspecting cache, StorageDrawers.cfg); null for uploads. */
  serverDir: string | null;
  facts: ScanPackFacts;
}

export type WorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string };

// Fixed progress steps, so the UI moves steadily; the region pass moves by bytes between SCAN_FROM and SCAN_TO.
const P_OPENED = 0.02;
const SCAN_FROM = 0.05;
const SCAN_TO = 0.8;
const P_BASES = 0.82;
const P_REGIONS = 0.85;
const P_TILES = 0.95;
const P_NETWORKS = 0.98;

const SURFACE_Y = 255;
const BLOCKS_PER_REGION = 512;
const CHUNKS_PER_REGION_SIDE = 32;
const CHUNKS_PER_TILE_SIDE = 4;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** `"Done: 2 bases, 7 machines"`, plus `" (1 chunk skipped)"` / `" (3 chunks skipped)"` when chunks were skipped. */
export function scanSummary(scan: WorldScan): string {
  const skipped = scan.skippedChunks ?? 0;
  const done = `Done: ${plural(scan.bases.length, 'base')}, ${plural(scan.machines.length, 'machine')}`;
  return skipped > 0 ? `${done} (${plural(skipped, 'chunk')} skipped)` : done;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The resolved source, opened. A source that is gone (ENOENT, at open or on a later read: a deleted backup or upload)
 * fails as `Source unavailable: <label>`; every other error passes unchanged.
 */
async function openSource(src: ResolvedSource, scanDir: string): Promise<WorldFiles> {
  const unavailable = (err: unknown): unknown => (isMissing(err) ? new Error(`Source unavailable: ${src.label}`, { cause: err }) : err);
  let files: WorldFiles;
  try {
    files = await openResolved(src, scanDir);
  } catch (err) {
    throw unavailable(err);
  }
  return {
    label: files.label,
    list: () => files.list(),
    read: (rel) => files.read(rel).catch((err: unknown) => { throw unavailable(err); }),
    close: () => files.close(),
  };
}

// ---- Side files (level.dat, players, claims, quests, teams, VisualProspecting, StorageDrawers.cfg) ----

interface SideData {
  level: LevelInfo;
  /** Visit evidence from player files and quest progress. */
  visits: VisitHint[];
  hints: BaseHints;
  teams: TeamDiscoveries[][];
  vpCache: VpVein[];
  drawerCfg: DrawerConfig;
  /** Side files that were there but could not be parsed (a player file torn by a live save, a foreign format). */
  unreadable: number;
}

const PLAYER_DIR = 'playerdata/';
const CLAIMS_DIR = 'serverutilities/teams/claimedchunks/';
const QUESTS_DIR = 'betterquesting/QuestProgress/';
const TEAMS_DIR = 'gtnhteams/';
const VP_WORLD_FILE = 'data/visualprospecting.dat';

function readLevel(buf: Buffer | null): LevelInfo {
  if (buf === null) throw new Error('level.dat is missing');
  try {
    return readLevelDat(buf);
  } catch (err) {
    throw new Error(`level.dat could not be read: ${errorMessage(err)}`, { cause: err });
  }
}

async function readSideFiles(files: WorldFiles, entries: WorldEntry[], job: ScanJob): Promise<SideData> {
  const level = readLevel(await files.read('level.dat'));
  let unreadable = 0;
  /** A side file parsed by `parse`; null when absent or unparseable (counted). Read errors are the source's and propagate. */
  const parsed = async <T>(rel: string, parse: (buf: Buffer) => T): Promise<T | null> => {
    const buf = await files.read(rel);
    if (buf === null) return null;
    try {
      return parse(buf);
    } catch {
      unreadable++;
      return null;
    }
  };
  const inDir = (dir: string): string[] => entries.filter((e) => e.path.startsWith(dir)).map((e) => e.path);
  const json = (buf: Buffer): unknown => JSON.parse(buf.toString('utf8'));

  const visits: VisitHint[] = [];
  const hints: BaseHints = { claims: [], beds: [] };
  for (const rel of inDir(PLAYER_DIR)) {
    const player = await parsed(rel, (b) => playerHints(readGzipNbt(b)));
    if (player === null) continue;
    visits.push(...player.visits);
    hints.beds.push(...player.beds);
  }
  for (const rel of inDir(CLAIMS_DIR)) {
    const team = rel.slice(CLAIMS_DIR.length, -'.dat'.length);
    hints.claims.push(...((await parsed(rel, (b) => claimHints(team, readGzipNbt(b)))) ?? []));
  }
  for (const rel of inDir(QUESTS_DIR)) visits.push(...((await parsed(rel, (b) => questVisits(json(b)))) ?? []));
  const teams: TeamDiscoveries[][] = [];
  for (const rel of inDir(TEAMS_DIR)) {
    const team = await parsed(rel, (b) => {
      const blob = teamBlobOf(json(b));
      return blob === null ? [] : decodeTeamBlob(blob);
    });
    if (team !== null) teams.push(team);
  }
  const worldId = await parsed(VP_WORLD_FILE, vpWorldId);

  let vpCache: VpVein[] = [];
  let drawerText: string | null = null;
  if (job.serverDir !== null) {
    const { vpDir, drawersCfg } = await copyServerSideFiles(job.serverDir, worldId, job.scanDir);
    if (vpDir !== null) {
      for (const name of (await readdir(vpDir)).sort()) {
        try {
          vpCache = vpCache.concat(readVpDimension(await readFile(join(vpDir, name))));   // a dimension can hold more veins than a spread takes
        } catch {
          unreadable++;
        }
      }
    }
    if (drawersCfg !== null) drawerText = await readFile(drawersCfg, 'utf8');
  }
  return { level, visits, hints, teams, vpCache, drawerCfg: readDrawerConfig(drawerText), unreadable };
}

// ---- The chunk pass ----

interface RegionEntry { dim: number; rx: number; rz: number; size: number }

interface Records {
  chunks: ChunkStat[];
  machines: GtMachineRec[]; pipes: GtPipeRec[]; storage: StorageRec[];
  prPipes: PrPipeRec[]; conduits: ConduitRec[]; ae2: Ae2Rec[];
  skipped: number;
}

/** Every region file of the listing in (dim, rx, rz) order. */
function regionEntries(entries: WorldEntry[]): RegionEntry[] {
  return entries.flatMap((e) => {
    const r = parseRegionPath(e.path);
    return r === null ? [] : [{ ...r, size: e.size }];
  }).sort((a, b) => a.dim - b.dim || a.rx - b.rx || a.rz - b.rz);
}

/** Hands one tile entity to the classifier for its id; ids no classifier knows add nothing. */
function classify(te: RawTe, facts: ScanPackFacts, itemNames: Map<number, string>, drawerCfg: DrawerConfig, out: Records): void {
  switch (te.id) {
    case 'BaseMetaTileEntity': {
      out.machines.push(classifyGtMachine(te, facts, itemNames));
      const digital = classifyGtStorage(te, facts, itemNames);
      if (digital !== null) out.storage.push(digital);
      return;
    }
    case 'BaseMetaPipeEntity':
      out.pipes.push(classifyGtPipe(te, facts));
      return;
    case 'TileEntityBarrel':
      out.storage.push(classifyBarrel(te, itemNames));
      return;
    case 'savedMultipart': {
      const pipe = classifyMultipart(te);
      if (pipe !== null) out.prPipes.push(pipe);
      return;
    }
    case 'blockConduitBundleTileEntity':
      out.conduits.push(classifyConduitBundle(te));
      return;
  }
  if (te.id.startsWith('StorageDrawers:')) {
    const drawer = classifyDrawer(te, itemNames, drawerCfg);
    if (drawer !== null) out.storage.push(drawer);
    return;
  }
  const chest = classifyChest(te, itemNames);
  if (chest !== null) {
    out.storage.push(chest);
    return;
  }
  const ae2 = classifyAe2(te, itemNames);
  if (ae2 !== null) out.ae2.push(ae2);
}

async function scanRegions(
  files: WorldFiles, regions: RegionEntry[], job: ScanJob, side: SideData, dimName: (dim: number) => string,
  report: (progress: number, message: string) => void,
): Promise<Records> {
  const out: Records = { chunks: [], machines: [], pipes: [], storage: [], prPipes: [], conduits: [], ae2: [], skipped: 0 };
  const total = regions.reduce((sum, r) => sum + r.size, 0);
  let done = 0;
  for (const r of regions) {
    report(SCAN_FROM + (SCAN_TO - SCAN_FROM) * (total > 0 ? done / total : 0), `Scanning ${dimName(r.dim)} r.${r.rx}.${r.rz}`);
    const buf = await files.read(regionPathOf(r.dim, r.rx, r.rz));
    done += r.size;
    if (buf === null) continue;
    const { chunks, skipped } = scanRegionBuffer(buf, r.dim);
    out.skipped += skipped;
    for (const chunk of chunks) {
      out.chunks.push(chunk.stat);
      for (const te of chunk.tes) classify(te, job.facts, side.level.itemNames, side.drawerCfg, out);
    }
  }
  return out;
}

// ---- Bases, region copies, palette and tiles ----

type Placed = { dim: number; pos: Vec3 };

function signalsOf(r: Records): BaseSignal[] {
  const plain = (x: Placed, seed = true): BaseSignal => ({ dim: x.dim, pos: x.pos, seed, machine: false, tier: null });
  return [
    ...r.machines.map((m): BaseSignal => ({ dim: m.dim, pos: m.pos, seed: true, machine: true, tier: countsForTopTier(m) ? m.tier : null })),
    ...r.pipes.map((p) => plain(p)),
    ...r.storage.map((s) => plain(s, s.kind !== 'chest')),   // a lone vanilla chest is dungeon loot, not a base
    ...r.prPipes.map((p) => plain(p)), ...r.conduits.map((c) => plain(c)), ...r.ae2.map((a) => plain(a)),
  ];
}

function dimNamer(dims: DimensionInfo[]): (dim: number) => string {
  const names = new Map<number, string>();
  for (const d of dims) if (d.id !== null && !names.has(d.id)) names.set(d.id, d.name);
  return (dim) => names.get(dim) ?? (dim === 0 ? 'Overworld' : `DIM${dim}`);
}

const regionOfBlock = (v: number): number => Math.floor(v / BLOCKS_PER_REGION);

/** Copies every region file within MAP_MARGIN of a base bbox into `<scanDir>/regions/`; the copied regions, in order. */
async function copyBaseRegions(files: WorldFiles, regions: RegionEntry[], bases: Base[], scanDir: string): Promise<RegionEntry[]> {
  const wanted = new Set<string>();
  for (const { dim, bbox } of bases) {
    for (let rx = regionOfBlock(bbox.minX - MAP_MARGIN); rx <= regionOfBlock(bbox.maxX + MAP_MARGIN); rx++) {
      for (let rz = regionOfBlock(bbox.minZ - MAP_MARGIN); rz <= regionOfBlock(bbox.maxZ + MAP_MARGIN); rz++) wanted.add(regionPathOf(dim, rx, rz));
    }
  }
  const copied: RegionEntry[] = [];
  for (const r of regions) {
    const rel = regionPathOf(r.dim, r.rx, r.rz);
    if (!wanted.has(rel)) continue;
    const buf = await files.read(rel);
    if (buf === null) continue;
    const dst = join(scanDir, 'regions', rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, buf);
    copied.push(r);
  }
  return copied;
}

/**
 * The palette of every present chunk of the copied regions, and the surface tile of every tile holding one, written to
 * `<scanDir>/tiles/<dim>/<tx>_<tz>.bin`. A tile never spans two regions, so each region's tiles are drawn while its
 * chunks are still in the reader's cache.
 */
async function drawTiles(copied: RegionEntry[], scanDir: string, input: AreaInput, palette: Palette): Promise<void> {
  const regionsDir = join(scanDir, 'regions');
  for (const r of copied) {
    const bytes = await readFile(join(regionsDir, regionPathOf(r.dim, r.rx, r.rz)));
    const tiles = new Map<string, { tx: number; tz: number; chunks: Array<[number, number]> }>();
    for (const ref of regionChunkRefs(bytes.subarray(0, REGION_HEADER_BYTES))) {
      const cx = r.rx * CHUNKS_PER_REGION_SIDE + ref.localX, cz = r.rz * CHUNKS_PER_REGION_SIDE + ref.localZ;
      const tx = Math.floor(cx / CHUNKS_PER_TILE_SIDE), tz = Math.floor(cz / CHUNKS_PER_TILE_SIDE), key = `${tx}:${tz}`;
      const tile = tiles.get(key);
      if (tile === undefined) tiles.set(key, { tx, tz, chunks: [[cx, cz]] });
      else tile.chunks.push([cx, cz]);
    }
    const dir = join(scanDir, 'tiles', String(r.dim));
    await mkdir(dir, { recursive: true });
    for (const { tx, tz, chunks } of [...tiles.values()].sort((a, b) => a.tz - b.tz || a.tx - b.tx)) {
      for (const [cx, cz] of chunks) await addChunkToPalette(input, palette, r.dim, cx, cz);
      await writeFile(join(dir, `${tx}_${tz}.bin`), encodeMapTile(await renderTile(input, palette, r.dim, tx, tz, SURFACE_Y)));
    }
  }
}

// ---- Assembly and output ----

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function highest(values: Array<number | null>): number | null {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v > best)) best = v;
  return best;
}

/** One `team prospecting` hint per dimension in which any team prospected something, in first-seen order. */
function teamHints(teams: TeamDiscoveries[][]): VisitHint[] {
  const dims = new Set<number>();
  for (const team of teams) for (const d of team) if (d.veins.length > 0 || d.depleted.length > 0) dims.add(d.dim);
  return [...dims].map((dim) => ({ dim, why: 'team prospecting' }));
}

function warningsOf(side: SideData, unmatchedVeins: number, unknownBoilers: number): string[] {
  const warnings = [...side.level.warnings];
  if (side.unreadable > 0) warnings.push(`${plural(side.unreadable, 'side file')} could not be read`);
  if (unmatchedVeins > 0) warnings.push(`${plural(unmatchedVeins, 'prospected vein')} had no vein type`);
  if (unknownBoilers > 0) warnings.push(`${plural(unknownBoilers, 'boiler')} with unknown steam output`);
  return warnings;
}

/**
 * Runs the scan passes over `job.source` and writes `scan.json`, `palette.json`, `meta.json`, `regions/` and `tiles/`
 * into `job.scanDir`. `report` gets fixed progress steps (0.02 … 0.98; the caller sets 1 when done) with a message
 * naming the work under way. The source is closed and `<scanDir>/snapshot` and `<scanDir>/side` are removed whether
 * the scan succeeds or fails.
 */
export async function runScanJob(job: ScanJob, report: (progress: number, message: string) => void): Promise<WorldScan> {
  const scannedAt = new Date().toISOString();
  const { scanDir, facts } = job;
  const dimName = dimNamer(facts.dimensions);
  await mkdir(scanDir, { recursive: true });
  let files: WorldFiles | null = null;
  try {
    files = await openSource(job.source, scanDir);
    report(P_OPENED, 'Reading level.dat and side files');
    const entries = (await files.list()).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const side = await readSideFiles(files, entries, job);
    const blockNames = side.level.blockNames;
    report(SCAN_FROM, 'Reading the region files');

    const regions = regionEntries(entries);
    const rec = await scanRegions(files, regions, job, side, dimName, report);
    report(SCAN_TO, 'Finding bases');
    const bases = findBases(signalsOf(rec), rec.chunks, side.hints, dimName);
    const baseOf = (dim: number, pos: Vec3): string | null => baseAt(bases, dim, pos)?.id ?? null;

    report(P_BASES, 'Copying the region files around the bases');
    const copied = await copyBaseRegions(files, regions, bases, scanDir);
    report(P_REGIONS, 'Drawing the map');
    const mteIds = new Map<string, number>();
    for (const r of [...rec.machines, ...rec.pipes]) mteIds.set(posKey(r.dim, ...r.pos), r.mteId);
    const palette = createPalette();
    const mapInput: AreaInput = {
      reader: createBlockReader(regionStoreFromDir(join(scanDir, 'regions'))), blockNames, mteAt: (d, x, y, z) => mteIds.get(posKey(d, x, y, z)),
    };
    await drawTiles(copied, scanDir, mapInput, palette);

    report(P_TILES, 'Reading power, logistics and storage');
    const sourceReader: BlockReader = createBlockReader(regionStoreFromFiles(files));
    const occupiedAt = new Set<string>();
    for (const r of [...rec.machines, ...rec.pipes, ...rec.storage, ...rec.prPipes, ...rec.conduits, ...rec.ae2]) occupiedAt.add(posKey(r.dim, ...r.pos));
    const occupied = (dim: number, pos: Vec3): boolean => occupiedAt.has(posKey(dim, ...pos));

    const machines: PlacedMachine[] = [];
    const coilHeats: number[] = [];
    for (const m of rec.machines) {
      const placed = toPlacedMachine(m, baseOf(m.dim, m.pos));
      if (isEbf(m)) {
        const heat = await ebfCoilHeat(sourceReader, blockNames, m.dim, m.pos, m.facing);
        if (heat !== null) {
          placed.coilHeat = heat;
          coilHeats.push(heat);
        }
      }
      machines.push(placed);
    }
    const power = buildPower({ machines: rec.machines, pipes: rec.pipes, facts, baseOf, occupied });
    const logistics = buildLogistics({ prPipes: rec.prPipes, conduits: rec.conduits, gtPipes: rec.pipes, ae2: rec.ae2, baseOf, occupied });
    const storage = await buildStorage({
      recs: rec.storage, ae2: rec.ae2, attachments: logistics.attachments, networks: logistics.networks,
      reader: sourceReader, blockNames, drawerCfg: side.drawerCfg, baseOf,
    });
    const pipeNetwork = new Map<string, string>();
    for (const b of logistics.blocks) if (b.kind === 'gtpipe' && b.networkId !== null) pipeNetwork.set(posKey(b.dim, ...b.pos), b.networkId);
    const pipes: PlacedPipe[] = rec.pipes.map((p) => {
      const k = posKey(p.dim, ...p.pos);
      return p.pipeKind === 'cable'
        ? toPlacedPipe({ ...p, voltageTier: power.cableTier.get(k) ?? p.voltageTier }, power.cableNetwork.get(k))
        : toPlacedPipe(p, pipeNetwork.get(k));
    });
    const dims = dimSummaries(rec.chunks, [...side.visits, ...teamHints(side.teams)], facts.dimensions);
    const { prospected, unmatched } = joinDiscoveries(side.vpCache, side.teams);

    const scan: WorldScan = {
      id: job.scanId, source: job.request, scannedAt, levelName: side.level.levelName,
      dims, bases, machines, pipes, power: power.networks, logistics: logistics.networks, storage,
      visitedDims: visitedKeys(dims), topTier: highest(rec.machines.map((m) => (countsForTopTier(m) ? m.tier : null))), coilHeat: highest(coilHeats),
      prospected, logisticsBlocks: logistics.blocks, warnings: warningsOf(side, unmatched, power.unknownBoilers), skippedChunks: rec.skipped,
    };

    report(P_NETWORKS, 'Writing the scan');
    await writeJsonAtomic(join(scanDir, 'palette.json'), palette.refs);
    await writeJsonAtomic(join(scanDir, 'meta.json'), {
      source: job.request, levelName: side.level.levelName, blockNames: [...blockNames].sort((a, b) => a[0] - b[0]),
    });
    await writeJsonAtomic(join(scanDir, 'scan.json'), scan);
    return scan;
  } finally {
    try {
      await files?.close();
    } catch {
      // the scan has read everything it needs; a failing close changes nothing
    }
    await rm(join(scanDir, 'snapshot'), { recursive: true, force: true });
    await rm(join(scanDir, 'side'), { recursive: true, force: true });
  }
}

// ---- Worker bootstrap: only inside a worker started with `workerData: { scanJob }` (scan.ts) ----

if (!isMainThread && workerData?.scanJob) {
  const post = (m: WorkerMessage): void => parentPort?.postMessage(m);
  runScanJob(workerData.scanJob as ScanJob, (progress, message) => post({ type: 'progress', progress, message })).then(
    (scan) => post({ type: 'done', summary: scanSummary(scan) }),
    (err: unknown) => post({ type: 'error', message: errorMessage(err) }),
  );
}
