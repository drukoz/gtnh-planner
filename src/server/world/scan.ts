// The world service (Plan 4 Task 13; architecture §6.6, §11.11; spec §5): the scan queue, which runs one scan at a time
// in a worker thread (`scan.worker.ts`) so the server's event loop never waits on a world; cancel; the status files;
// and what a finished scan serves from its folder — the scan, its palette, map tiles and voxel areas.
//
// `data/scans/<id>/status.json` holds the ScanStatus fields plus the request `source` (ruling R17); it is written when
// a scan is queued, when its state changes and at most once per second while it runs. A failed or cancelled scan's
// folder keeps only status.json; a scan a restart interrupted is marked failed and keeps its folder, because the
// service cannot tell a dead server's scan from one another process (`npm run scan`) is still running there.
// Everything a finished scan holds is fixed, so parsed files are cached in memory.

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { BlockRef } from '../../shared/types/pack.ts';
import type { WorldScanListItem, WorldSourcesResponse } from '../../shared/types/world-api.ts';
import { encodeMapTile, type BBox, type ScanStatus, type Voxels, type WorldScan, type WorldSource } from '../../shared/types/world.ts';
import { createBlockReader, readAreaVoxels, regionStoreFromDir, type AreaInput } from './area.ts';
import type { ScanPackFacts } from './facts.ts';
import { posKey } from './model.ts';
import { runScanJob, scanSummary, type ScanJob, type WorkerMessage } from './scan.worker.ts';
import { listSources, resolveSource, serverLayout, SourceError, type ResolvedSource, type WorldConfig } from './sources.ts';
import { createPalette, renderTile, type Palette } from './tiles.ts';

const SCAN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const STATUS_FILE = 'status.json';
/** status.json is rewritten at most this often while progress messages come in. */
const STATUS_WRITE_MS = 1000;
/** Finished scans whose parsed files (scan, palette, map renderer) stay in memory. */
const PARSED_SCANS = 2;
const RENDERED_TILES = 256;
const SURFACE_Y = 255;
const UNKNOWN_SCAN_TIME = '1970-01-01T00:00:00.000Z';
const INTERRUPTED = 'Interrupted by a server restart';
const CANCELLED = 'Cancelled';
const WORKER_URL = new URL('./scan.worker.ts', import.meta.url);
const WORKER_EXEC_ARGV = ['--disable-warning=ExperimentalWarning'];

/** `YYYYMMDDTHHMMSSZ-<6 hex>`: the UTC second of `now` and three random bytes. */
export function newScanId(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

/** Also the only check a scan id needs before it names a folder: no separator or dot can pass it. */
export function isScanId(s: string): boolean {
  return SCAN_ID_RE.test(s);
}

export interface WorldServiceOptions {
  /** Ruling R3: the two AppConfig fields the world code reads; the real AppConfig is assignable to it. */
  config: WorldConfig;
  /** Called when a scan starts, so every scan uses the pack that is active at that moment. */
  facts: () => Promise<ScanPackFacts>;
  /** Default true. False runs `runScanJob` in-process (tests only). */
  useWorker?: boolean;
}

export interface WorldService {
  listSources(): Promise<WorldSourcesResponse>;
  /** The id of the new scan, or of the queued or running scan of an equal source. A bad source is a SourceError. */
  startScan(source: WorldSource): Promise<string>;
  /** True when a queued or running scan of this service was cancelled; false for an unknown or finished scan. */
  cancelScan(id: string): boolean;
  hasScan(id: string): boolean;
  scanStatus(id: string): ScanStatus;
  /** Every scan folder with a readable status, newest first. */
  listScans(): Promise<WorldScanListItem[]>;
  /** Null unless the scan is done. The object is shared by every caller: read it, never change it. */
  getScan(id: string): Promise<WorldScan | null>;
  palette(id: string): Promise<BlockRef[] | null>;
  /** The encoded MapTile (20,480 bytes) of the first block at or below `maxY`; null unless the scan is done. */
  tile(id: string, dim: number, tx: number, tz: number, maxY: number): Promise<Uint8Array | null>;
  /** The voxels of `bbox`; throws unless the scan is done, and a RangeError above MAX_AREA_VOXELS. */
  readArea(scanId: string, dim: number, bbox: BBox): Promise<Voxels>;
  /** Resolves once no scan is starting, queued or running and every status write has finished. */
  idle(): Promise<void>;
}

// ---- Small helpers ----

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A copy of `v` with only the fields of its kind, or null when it is not a WorldSource. */
function asWorldSource(v: unknown): WorldSource | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'server') return { kind: 'server' };
  if (v.kind === 'backup' && typeof v.file === 'string') return { kind: 'backup', file: v.file };
  if (v.kind === 'upload' && typeof v.uploadId === 'string') return { kind: 'upload', uploadId: v.uploadId };
  return null;
}

/** An LRU map: `get` makes an entry the youngest, `set` evicts the oldest beyond `max`. */
class Lru<V> {
  readonly #map = new Map<string, V>();
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  get(key: string): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value!);
  }

  /** Removes `key` only while it still holds `value`. */
  drop(key: string, value: V): void {
    if (this.#map.get(key) === value) this.#map.delete(key);
  }
}

/** One load per key shared by concurrent callers; a failed load is forgotten, so the next call tries again. */
function memo<V>(cache: Lru<Promise<V>>, key: string, load: () => Promise<V>): Promise<V> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const loading = load();
  cache.set(key, loading);
  loading.catch(() => cache.drop(key, loading));
  return loading;
}

// ---- status.json ----

interface StatusRecord { status: ScanStatus; source: WorldSource | null }

const STATES: ReadonlyArray<ScanStatus['state']> = ['queued', 'running', 'done', 'failed'];

/** The record of a status.json text, with `id` from its folder name; null when it is not a status. */
function parseStatus(id: string, text: string): StatusRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const { state, progress, message, startedAt, finishedAt } = v;
  if (!STATES.includes(state as ScanStatus['state']) || typeof progress !== 'number' || typeof message !== 'string' || typeof startedAt !== 'string') return null;
  const status: ScanStatus = { id, state: state as ScanStatus['state'], progress, message, startedAt };
  if (typeof finishedAt === 'string') status.finishedAt = finishedAt;
  return { status, source: asWorldSource(v.source) };
}

function statusFileOf(rec: StatusRecord): unknown {
  return rec.source === null ? rec.status : { ...rec.status, source: rec.source };
}

/** An unreadable or missing status.json reads as no status. */
function readStatusSync(dir: string, id: string): StatusRecord | null {
  try {
    return parseStatus(id, readFileSync(join(dir, STATUS_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function readStatus(dir: string, id: string): Promise<StatusRecord | null> {
  try {
    return parseStatus(id, await readFile(join(dir, STATUS_FILE), 'utf8'));
  } catch {
    return null;
  }
}

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

function writeJsonAtomicSync(path: string, value: unknown): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** A server that stopped mid-scan left its scans queued or running; they become failed (their folders are kept). */
function markInterrupted(scansDir: string): void {
  let names: string[];
  try {
    names = readdirSync(scansDir);
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
  const finishedAt = new Date().toISOString();
  for (const id of names) {
    if (!isScanId(id)) continue;
    const dir = join(scansDir, id);
    const rec = readStatusSync(dir, id);
    if (rec === null || (rec.status.state !== 'queued' && rec.status.state !== 'running')) continue;
    const status: ScanStatus = { ...rec.status, state: 'failed', message: INTERRUPTED, finishedAt };
    writeJsonAtomicSync(join(dir, STATUS_FILE), statusFileOf({ status, source: rec.source }));
  }
}

/** Removes everything in a scan folder but status.json; best effort, a file that will not go stays. */
async function emptyExceptStatus(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(names.filter((n) => n !== STATUS_FILE).map((n) => rm(join(dir, n), { recursive: true, force: true }).catch(() => {})));
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// ---- The service ----

/** A scan this service queued. `status` is the live status; status.json follows it. */
interface Entry {
  id: string;
  dir: string;
  /** The source's key in `active`. */
  key: string;
  source: WorldSource;
  resolved: ResolvedSource;
  status: ScanStatus;
  cancelled: boolean;
  worker: Worker | null;
  lastWrite: number;
  /** The status writes, one after another; never rejects. */
  writes: Promise<void>;
}

type Outcome = { ok: true; summary: string } | { ok: false; message: string };

/** A finished scan's map renderer: the saved palette, frozen, over the region files copied into the scan folder. */
interface ScanView { palette: Palette; input: AreaInput }

export function createWorldService(opts: WorldServiceOptions): WorldService {
  const { config, facts } = opts;
  const useWorker = opts.useWorker ?? true;
  const scansDir = resolve(config.dataDir, 'scans');
  const dirOf = (id: string): string => join(scansDir, id);

  const entries = new Map<string, Entry>();
  /** Final statuses read from status.json (scans of an earlier server run or of another process); they never change. */
  const settled = new Map<string, StatusRecord>();
  /** Source key → the id of its queued or running scan. */
  const active = new Map<string, string>();
  /** Source key → the startScan still resolving it, so equal requests made at the same time share one scan. */
  const starting = new Map<string, Promise<string>>();
  const background = new Set<Promise<void>>();
  let queue: Promise<void> = Promise.resolve();

  const scans = new Lru<Promise<WorldScan>>(PARSED_SCANS);
  const palettes = new Lru<Promise<BlockRef[]>>(PARSED_SCANS);
  const views = new Lru<Promise<ScanView>>(PARSED_SCANS);
  const tiles = new Lru<Promise<Uint8Array>>(RENDERED_TILES);
  const levelNames = new Map<string, string | null>();

  markInterrupted(scansDir);

  function track(p: Promise<void>): void {
    background.add(p);
    const done = (): void => { background.delete(p); };
    p.then(done, done);
  }

  function persist(entry: Entry): Promise<void> {
    const file = statusFileOf({ status: entry.status, source: entry.source });
    entry.lastWrite = Date.now();
    entry.writes = entry.writes.then(() => writeJsonAtomic(join(entry.dir, STATUS_FILE), file)).catch(() => {
      // memory keeps the live status; the next write (at the latest the final one) tries again
    });
    return entry.writes;
  }

  function release(entry: Entry): void {
    if (active.get(entry.key) === entry.id) active.delete(entry.key);
  }

  function record(id: string): StatusRecord | null {
    const entry = entries.get(id);
    if (entry !== undefined) return { status: entry.status, source: entry.source };
    const known = settled.get(id);
    if (known !== undefined) return known;
    if (!isScanId(id)) return null;
    const rec = readStatusSync(dirOf(id), id);
    if (rec !== null && (rec.status.state === 'done' || rec.status.state === 'failed')) settled.set(id, rec);
    return rec;
  }

  const isDone = (id: string): boolean => record(id)?.status.state === 'done';

  async function createEntry(source: WorldSource, key: string, resolved: ResolvedSource): Promise<Entry> {
    await mkdir(scansDir, { recursive: true });
    for (;;) {
      const now = new Date();
      const id = newScanId(now);
      const dir = dirOf(id);
      try {
        await mkdir(dir);
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code === 'EEXIST') continue;
        throw err;
      }
      const entry: Entry = {
        id, dir, key, source, resolved,
        status: { id, state: 'queued', progress: 0, message: 'Queued', startedAt: now.toISOString() },
        cancelled: false, worker: null, lastWrite: Date.now(), writes: Promise.resolve(),
      };
      try {
        await writeJsonAtomic(join(dir, STATUS_FILE), statusFileOf({ status: entry.status, source }));
      } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
      }
      return entry;
    }
  }

  function progress(entry: Entry, value: number, message: string): void {
    if (entry.cancelled || entry.status.state !== 'running') return;
    entry.status = { ...entry.status, progress: value, message };
    if (Date.now() - entry.lastWrite >= STATUS_WRITE_MS) void persist(entry);
  }

  function jobOf(entry: Entry, scanFacts: ScanPackFacts): ScanJob {
    const serverDir = entry.resolved.kind !== 'dir' && config.serverFolder !== null ? serverLayout(config.serverFolder).serverDir : null;
    return { scanId: entry.id, scanDir: entry.dir, request: entry.source, source: entry.resolved, serverDir, facts: scanFacts };
  }

  /**
   * The worker's first `done` or `error` message is the outcome; the worker has nothing left to do after posting it,
   * so it is stopped then rather than trusted to exit (a handle left open would hold the queue). The promise settles
   * on `exit`, once the thread can no longer touch the scan folder. An uncaught error or an exit without a message
   * (a crash, or `terminate()` on cancel) is a failure.
   */
  function runInWorker(entry: Entry, job: ScanJob): Promise<Outcome> {
    return new Promise((done) => {
      let outcome: Outcome | null = null;
      const worker = new Worker(WORKER_URL, { workerData: { scanJob: job }, execArgv: WORKER_EXEC_ARGV });
      entry.worker = worker;
      const settle = (o: Outcome): void => {
        if (outcome !== null) return;
        outcome = o;
        void worker.terminate().catch(() => {});
      };
      worker.on('message', (m: WorkerMessage) => {
        if (m.type === 'progress') progress(entry, m.progress, m.message);
        else settle(m.type === 'done' ? { ok: true, summary: m.summary } : { ok: false, message: m.message });
      });
      worker.on('error', (err) => { outcome ??= { ok: false, message: errorMessage(err) }; });
      worker.once('exit', (code) => {
        entry.worker = null;
        done(outcome ?? { ok: false, message: `The scan worker stopped with exit code ${code}` });
      });
    });
  }

  async function runInProcess(entry: Entry, job: ScanJob): Promise<Outcome> {
    try {
      return { ok: true, summary: scanSummary(await runScanJob(job, (p, m) => progress(entry, p, m))) };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  }

  /** Sets the final status (a cancelled scan already has it), empties the folder of a failed scan, then writes status.json. */
  async function finish(entry: Entry, outcome: Outcome): Promise<void> {
    const finishedAt = new Date().toISOString();
    if (!entry.cancelled) {
      entry.status = outcome.ok
        ? { ...entry.status, state: 'done', progress: 1, message: outcome.summary, finishedAt }
        : { ...entry.status, state: 'failed', message: outcome.message, finishedAt };
    }
    if (entry.status.state === 'failed') {
      await entry.writes;
      await emptyExceptStatus(entry.dir);
    }
    release(entry);
    await persist(entry);
  }

  async function run(entry: Entry): Promise<void> {
    if (entry.cancelled) return;   // cancelled while queued; cancelScan has written its status
    entry.status = { ...entry.status, state: 'running', message: 'Starting' };
    void persist(entry);
    let outcome: Outcome;
    try {
      const scanFacts = await facts();
      outcome = entry.cancelled
        ? { ok: false, message: CANCELLED }
        : await (useWorker ? runInWorker : runInProcess)(entry, jobOf(entry, scanFacts));
    } catch (err) {
      outcome = { ok: false, message: errorMessage(err) };
    }
    await finish(entry, outcome);
  }

  async function begin(source: WorldSource, key: string): Promise<string> {
    try {
      const resolved = await resolveSource(config, source);
      const entry = await createEntry(source, key, resolved);
      entries.set(entry.id, entry);
      active.set(key, entry.id);
      queue = queue.then(() => run(entry));
      return entry.id;
    } finally {
      starting.delete(key);
    }
  }

  // ---- Finished scans ----

  function loadScan(id: string): Promise<WorldScan> {
    return memo(scans, id, async () => JSON.parse(await readFile(join(dirOf(id), 'scan.json'), 'utf8')) as WorldScan);
  }

  function loadPalette(id: string): Promise<BlockRef[]> {
    return memo(palettes, id, async () => JSON.parse(await readFile(join(dirOf(id), 'palette.json'), 'utf8')) as BlockRef[]);
  }

  async function readMeta(id: string): Promise<Record<string, unknown>> {
    const meta: unknown = JSON.parse(await readFile(join(dirOf(id), 'meta.json'), 'utf8'));
    return isRecord(meta) ? meta : {};
  }

  function view(id: string): Promise<ScanView> {
    return memo(views, id, async () => {
      const [scan, refs, meta] = await Promise.all([loadScan(id), loadPalette(id), readMeta(id)]);
      const mteIds = new Map<string, number>();
      for (const r of [...scan.machines, ...scan.pipes]) mteIds.set(posKey(r.dim, ...r.pos), r.mteId);
      const blockNames = new Map<number, string>(Array.isArray(meta.blockNames) ? (meta.blockNames as Array<[number, string]>) : []);
      return {
        palette: createPalette(refs, { frozen: true }),
        input: {
          reader: createBlockReader(regionStoreFromDir(join(dirOf(id), 'regions'))), blockNames,
          mteAt: (d, x, y, z) => mteIds.get(posKey(d, x, y, z)),
        },
      };
    });
  }

  async function levelNameOf(id: string): Promise<string | null> {
    if (levelNames.has(id)) return levelNames.get(id)!;
    let name: string | null = null;
    try {
      const meta = await readMeta(id);
      if (typeof meta.levelName === 'string') name = meta.levelName;
    } catch {
      return null;
    }
    levelNames.set(id, name);
    return name;
  }

  return {
    listSources: () => listSources(config),

    startScan(source) {
      const norm = asWorldSource(source);
      if (norm === null) return Promise.reject(new SourceError(400, 'Unknown source kind'));
      const key = JSON.stringify(norm);
      const pending = starting.get(key);
      if (pending !== undefined) return pending;
      const id = active.get(key);
      if (id !== undefined) return Promise.resolve(id);
      const started = begin(norm, key);
      starting.set(key, started);
      return started;
    },

    cancelScan(id) {
      const entry = entries.get(id);
      if (entry === undefined || entry.cancelled || (entry.status.state !== 'queued' && entry.status.state !== 'running')) return false;
      const wasQueued = entry.status.state === 'queued';
      entry.cancelled = true;
      entry.status = { ...entry.status, state: 'failed', message: CANCELLED, finishedAt: new Date().toISOString() };
      release(entry);
      if (wasQueued) track(persist(entry));   // its folder holds only status.json
      else if (entry.worker !== null) void entry.worker.terminate().catch(() => {});   // finish() empties the folder after the exit
      return true;
    },

    hasScan: (id) => isScanId(id) && (entries.has(id) || existsSync(join(dirOf(id), STATUS_FILE))),

    scanStatus(id) {
      const rec = record(id);
      return rec === null ? { id, state: 'failed', progress: 0, message: 'Unknown scan', startedAt: UNKNOWN_SCAN_TIME } : { ...rec.status };
    },

    async listScans() {
      let names: string[];
      try {
        names = await readdir(scansDir);
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
      const items: WorldScanListItem[] = [];
      for (const id of names) {
        if (!isScanId(id)) continue;
        const entry = entries.get(id);
        const rec = entry !== undefined ? { status: entry.status, source: entry.source } : (settled.get(id) ?? await readStatus(dirOf(id), id));
        if (rec === null || rec.source === null) continue;
        items.push({ ...rec.status, source: rec.source, levelName: rec.status.state === 'done' ? await levelNameOf(id) : null });
      }
      const order = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);
      return items.sort((a, b) => order(a.startedAt, b.startedAt) || order(a.id, b.id));
    },

    getScan: async (id) => (isDone(id) ? loadScan(id) : null),

    palette: async (id) => (isDone(id) ? loadPalette(id) : null),

    async tile(id, dim, tx, tz, maxY) {
      if (![dim, tx, tz].every(Number.isInteger) || Number.isNaN(maxY)) throw new RangeError(`invalid tile ${dim}/${tx}/${tz} at y ${maxY}`);
      if (!isDone(id)) return null;
      const y = Math.min(SURFACE_Y, Math.max(-1, Math.floor(maxY)));
      if (y === SURFACE_Y) {
        const saved = await readIfPresent(join(dirOf(id), 'tiles', String(dim), `${tx}_${tz}.bin`));
        if (saved !== null) return saved;
      }
      return memo(tiles, `${id}/${dim}/${tx}/${tz}/${y}`, async () => {
        const v = await view(id);
        return encodeMapTile(await renderTile(v.input, v.palette, dim, tx, tz, y));
      });
    },

    async readArea(scanId, dim, bbox) {
      if (!isDone(scanId)) throw new Error(`Scan ${scanId} is not finished`);
      return readAreaVoxels((await view(scanId)).input, dim, bbox);
    },

    async idle() {
      for (;;) {
        const tail = queue;
        await Promise.allSettled([tail, ...starting.values(), ...background]);
        if (tail === queue && starting.size === 0 && background.size === 0) return;
      }
    },
  };
}
