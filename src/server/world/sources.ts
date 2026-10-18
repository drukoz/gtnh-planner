// Where a scan's world comes from (spec §3.4, §5): the server folder, read only — its newest complete backup zip, or a
// snapshot copy of its world folder — or an upload of level.dat plus region files. Every access to the server folder
// in this file is a read (readFileSync, readdir, stat, copyFile *from* it); copies go into the scan's own folder.

import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync, type Dirent } from 'node:fs';
import { constants, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorldSourcesResponse } from '../../shared/types/world-api.ts';
import type { WorldSource } from '../../shared/types/world.ts';
import { parseRegionPath, regionPathOf } from '../../shared/world/region.ts';
import { openDirWorld, type WorldFiles } from './files.ts';
import { listCompleteBackups, openZipWorld } from './zip.ts';

/** The two AppConfig fields (architecture §9) this file reads; the real AppConfig is assignable to it (ruling R3). */
export type WorldConfig = { dataDir: string; serverFolder: string | null };

export interface ServerLayout { serverDir: string; worldDir: string; backupsDir: string }

/** A source that cannot be used, with the HTTP status the API answers. */
export class SourceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
  }
}

export type ResolvedSource =
  | { kind: 'zip'; path: string; label: string }
  | { kind: 'snapshot'; worldDir: string; label: string }
  | { kind: 'dir'; path: string; label: string };

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const st = await stat(path);
    return st.isFile() ? st.size : null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** APFS clone of `from` (a plain copy where cloning is not supported); false when `from` does not exist. */
async function cloneIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await copyFile(from, to, constants.COPYFILE_FICLONE);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

// ---- Server folder ----

const DEFAULT_LEVEL_NAME = 'World';

function unescapeProperty(s: string): string {
  const named: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : named[e] ?? e));
}

/**
 * A value of a Java .properties text (the format of server.properties): `#`/`!` comment lines, a key ending at the first
 * unescaped `=`, `:` or blank, backslash escapes; the last line with the key wins. Line continuations are not read
 * (Minecraft never writes them).
 */
function propertyValue(text: string, key: string): string | null {
  let value: string | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^[ \t\f]+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const m = /^((?:\\.|[^\\=: \t\f])*)[ \t\f]*[=:]?[ \t\f]*(.*)$/.exec(line);
    if (m !== null && unescapeProperty(m[1]!) === key) value = unescapeProperty(m[2]!);
  }
  return value;
}

/** The world folder is `level-name` from server.properties (default `World`); backups are in `<serverDir>/backups`. */
export function serverLayout(serverFolder: string): ServerLayout {
  const serverDir = resolve(serverFolder);
  let text: string | null = null;
  try {
    text = readFileSync(join(serverDir, 'server.properties'), 'latin1');   // Java writes .properties as ISO-8859-1
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  const levelName = (text === null ? null : propertyValue(text, 'level-name')) || DEFAULT_LEVEL_NAME;
  return { serverDir, worldDir: join(serverDir, levelName), backupsDir: join(serverDir, 'backups') };
}

function configuredLayout(cfg: WorldConfig): ServerLayout {
  if (cfg.serverFolder === null) throw new SourceError(400, 'No server folder is configured');
  return serverLayout(cfg.serverFolder);
}

async function hasLevelDat(worldDir: string): Promise<boolean> {
  return (await fileSize(join(worldDir, 'level.dat'))) !== null;
}

/** `server` is true when a `{ kind: 'server' }` scan can start: a complete backup, or a world folder with level.dat. */
export async function listSources(cfg: WorldConfig, now: number = Date.now()): Promise<WorldSourcesResponse> {
  if (cfg.serverFolder === null) return { server: false, backups: [] };
  const layout = serverLayout(cfg.serverFolder);
  const backups = await listCompleteBackups(layout.backupsDir, now);
  return { server: backups.length > 0 || await hasLevelDat(layout.worldDir), backups };
}

/**
 * `server` → the newest complete backup, else a snapshot of the world folder; `backup` → only a name that
 * `listCompleteBackups` lists; `upload` → a completed upload's files folder. Anything else is a SourceError.
 */
export async function resolveSource(cfg: WorldConfig, source: WorldSource, now: number = Date.now()): Promise<ResolvedSource> {
  switch (source.kind) {
    case 'server': {
      const layout = configuredLayout(cfg);
      const [newest] = await listCompleteBackups(layout.backupsDir, now);
      if (newest !== undefined) return { kind: 'zip', path: join(layout.backupsDir, newest), label: `backup ${newest}` };
      if (await hasLevelDat(layout.worldDir)) return { kind: 'snapshot', worldDir: layout.worldDir, label: `server world ${basename(layout.worldDir)}` };
      throw new SourceError(400, 'The server folder has no world and no complete backup');
    }
    case 'backup': {
      const layout = configuredLayout(cfg);
      if (!(await listCompleteBackups(layout.backupsDir, now)).includes(source.file)) {
        throw new SourceError(400, `Not a complete backup older than two minutes: ${JSON.stringify(source.file)}`);
      }
      return { kind: 'zip', path: join(layout.backupsDir, source.file), label: `backup ${source.file}` };
    }
    case 'upload': {
      const meta = isUploadId(source.uploadId) ? await readUploadMeta(uploadDir(cfg.dataDir, source.uploadId)) : null;
      if (meta === null) throw new SourceError(400, 'Unknown upload');
      if (!meta.complete) throw new SourceError(409, 'The upload is not complete');
      return { kind: 'dir', path: join(uploadDir(cfg.dataDir, source.uploadId), 'files'), label: `upload ${source.uploadId}` };
    }
    default:
      throw new SourceError(400, 'Unknown source kind');
  }
}

/**
 * Clones every scan file of a live world folder into `to`, reading only from `worldDir`. A file the server removes
 * while the copy runs (it renames player files as it saves them) is left out.
 */
async function snapshotWorld(worldDir: string, to: string): Promise<string> {
  const live = await openDirWorld(worldDir);
  await mkdir(to, { recursive: true });
  const made = new Set([to]);
  for (const { path } of await live.list()) {
    const dst = join(to, path);
    if (!made.has(dirname(dst))) {
      await mkdir(dirname(dst), { recursive: true });
      made.add(dirname(dst));
    }
    await cloneIfPresent(join(worldDir, path), dst);
  }
  await live.close();
  return to;
}

/** Opens a resolved source; a snapshot is first cloned into `<scanDir>/snapshot/`. File system errors propagate (R6). */
export async function openResolved(src: ResolvedSource, scanDir: string): Promise<WorldFiles> {
  switch (src.kind) {
    case 'zip': return openZipWorld(src.path, src.label);
    case 'dir': return openDirWorld(src.path, src.label);
    case 'snapshot': return openDirWorld(await snapshotWorld(src.worldDir, join(scanDir, 'snapshot')), src.label);
  }
}

const VP_DIM_FILE = /^DIM-?\d+\.dat$/;

function isPathSegment(s: string): boolean {
  return s !== '' && s !== '.' && s !== '..' && !/[/\\\0]/.test(s);
}

async function readdirIfPresent(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * Clones the server-side files a scan reads outside the world folder into `<scanDir>/side/`: the VisualProspecting
 * cache of this world (`visualprospecting/server/<worldId>/DIM*.dat`, materials-availability §7.1) and
 * `config/StorageDrawers.cfg`. Each result is null when there was nothing to copy.
 */
export async function copyServerSideFiles(serverDir: string, worldId: string | null, scanDir: string): Promise<{ vpDir: string | null; drawersCfg: string | null }> {
  const side = join(scanDir, 'side');
  await mkdir(side, { recursive: true });
  let vpDir: string | null = null;
  if (worldId !== null && isPathSegment(worldId)) {
    const from = join(serverDir, 'visualprospecting', 'server', worldId);
    const dims = (await readdirIfPresent(from)).filter((d) => d.isFile() && VP_DIM_FILE.test(d.name));
    const to = join(side, 'visualprospecting');
    if (dims.length > 0) await mkdir(to, { recursive: true });
    for (const d of dims) if (await cloneIfPresent(join(from, d.name), join(to, d.name))) vpDir = to;
  }
  const drawersCfg = join(side, 'StorageDrawers.cfg');
  return { vpDir, drawersCfg: (await cloneIfPresent(join(serverDir, 'config', 'StorageDrawers.cfg'), drawersCfg)) ? drawersCfg : null };
}

// ---- Uploads: data/uploads/<uploadId>/upload.json and files/<rel> ----

const MiB = 1024 ** 2;
export const UPLOAD_LIMITS: Readonly<{ levelDat: number; region: number; files: number; total: number }> =
  Object.freeze({ levelDat: 32 * MiB, region: 128 * MiB, files: 4096, total: 8 * 1024 * MiB });
export type UploadLimits = typeof UPLOAD_LIMITS;

interface UploadMeta { createdAt: string; by: string | null; complete: boolean; files: number; bytes: number }

/**
 * `level.dat` or a region file in its one canonical spelling (so no `..`, backslash, NUL or case variant). There is no
 * zip kind: a whole world zip carries player files, which never leave the browser (spec §3.4, architecture §11.12).
 */
export function uploadKind(rel: string): 'level' | 'region' | null {
  if (rel === 'level.dat') return 'level';
  const r = parseRegionPath(rel);
  return r !== null && rel === regionPathOf(r.dim, r.rx, r.rz) ? 'region' : null;
}

export function isUploadId(s: string): boolean {
  return /^[0-9a-f]{32}$/.test(s);
}

/** Absolute, so one upload always has one key in `uploadQueues`. Call only with an `isUploadId` id. */
function uploadDir(dataDir: string, uploadId: string): string {
  return resolve(dataDir, 'uploads', uploadId);
}

async function readUploadMeta(dir: string): Promise<UploadMeta | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'upload.json'), 'utf8')) as UploadMeta;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function writeUploadMeta(dir: string, meta: UploadMeta): Promise<void> {
  const tmp = join(dir, `.upload.${randomUUID()}.json`);
  try {
    await writeFile(tmp, JSON.stringify(meta));
    await rename(tmp, join(dir, 'upload.json'));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** The record of an upload that still takes files: 404 when there is none, 409 once it is complete. */
async function openUpload(dir: string): Promise<UploadMeta> {
  const meta = await readUploadMeta(dir);
  if (meta === null) throw new SourceError(404, 'Unknown upload');
  if (meta.complete) throw new SourceError(409, 'The upload is already complete');
  return meta;
}

// Storing a finished file and completing run one at a time per upload, so upload.json counts every file once even
// while the browser sends two files at the same time.
const uploadQueues = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (uploadQueues.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  uploadQueues.set(key, tail);
  void tail.then(() => {
    if (uploadQueues.get(key) === tail) uploadQueues.delete(key);
  });
  return run;
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * MiB ? `${bytes / (1024 * MiB)} GiB` : bytes >= MiB ? `${bytes / MiB} MiB` : `${bytes} bytes`;
}

export async function createUpload(dataDir: string, by: string | null): Promise<string> {
  const uploadId = randomBytes(16).toString('hex');
  const dir = uploadDir(dataDir, uploadId);
  await mkdir(join(dir, 'files'), { recursive: true });
  await writeUploadMeta(dir, { createdAt: new Date().toISOString(), by, complete: false, files: 0, bytes: 0 });
  return uploadId;
}

/**
 * Stores one upload file. The id and path are checked before any file system call (404, 400), then the declared length
 * (413), the upload's state (404, 409) and its file count (413). The body streams through a byte meter into
 * `.<uuid>.part` next to the target and is renamed on success; any error removes the part file. A body longer or
 * shorter than `declaredLength` is a 400. Sending a path again replaces that file.
 */
export async function storeUploadFile(dataDir: string, uploadId: string, rel: string, body: Readable, declaredLength: number | null,
  limits: UploadLimits = UPLOAD_LIMITS): Promise<void> {
  if (!isUploadId(uploadId)) throw new SourceError(404, 'Unknown upload');
  const kind = uploadKind(rel);
  if (kind === null) throw new SourceError(400, 'Only level.dat and region files (region/r.<x>.<z>.mca, DIM<n>/region/r.<x>.<z>.mca) can be uploaded');
  const fileLimit = kind === 'level' ? limits.levelDat : limits.region;
  const fileTooLarge = () => new SourceError(413, `${rel} is larger than ${sizeText(fileLimit)}`);
  const uploadTooLarge = () => new SourceError(413, `The upload is larger than ${sizeText(limits.total)}`);
  const tooManyFiles = () => new SourceError(413, `The upload has more than ${limits.files} files`);
  if (declaredLength !== null && declaredLength > fileLimit) throw fileTooLarge();

  const dir = uploadDir(dataDir, uploadId);
  const meta = await openUpload(dir);
  const dst = join(dir, 'files', rel);
  const replaced = await fileSize(dst);
  if (replaced === null && meta.files >= limits.files) throw tooManyFiles();
  const room = limits.total - meta.bytes + (replaced ?? 0);
  if (declaredLength !== null && declaredLength > room) throw uploadTooLarge();

  await mkdir(dirname(dst), { recursive: true });
  const tmp = join(dirname(dst), `.${randomUUID()}.part`);
  try {
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > fileLimit) done(fileTooLarge());
        else if (bytes > room) done(uploadTooLarge());
        else if (declaredLength !== null && bytes > declaredLength) done(new SourceError(400, `${rel} is longer than its declared ${declaredLength} bytes`));
        else done(null, chunk);
      },
    });
    await pipeline(body, meter, createWriteStream(tmp, { flags: 'wx' }));
    if (declaredLength !== null && bytes !== declaredLength) throw new SourceError(400, `${rel} has ${bytes} bytes, not the declared ${declaredLength}`);

    await oneAtATime(dir, async () => {
      const current = await openUpload(dir);
      const old = await fileSize(dst);
      const files = current.files + (old === null ? 1 : 0);
      const total = current.bytes - (old ?? 0) + bytes;
      if (files > limits.files) throw tooManyFiles();
      if (total > limits.total) throw uploadTooLarge();
      await rename(tmp, dst);
      await writeUploadMeta(dir, { ...current, files, bytes: total });
    });
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Marks an upload complete (repeating it is harmless); 400 `level.dat is missing` without one, 404 for an unknown id. */
export async function completeUpload(dataDir: string, uploadId: string): Promise<WorldSource> {
  if (!isUploadId(uploadId)) throw new SourceError(404, 'Unknown upload');
  const dir = uploadDir(dataDir, uploadId);
  return oneAtATime(dir, async () => {
    const meta = await readUploadMeta(dir);
    if (meta === null) throw new SourceError(404, 'Unknown upload');
    if (!meta.complete) {
      if ((await fileSize(join(dir, 'files', 'level.dat'))) === null) throw new SourceError(400, 'level.dat is missing');
      await writeUploadMeta(dir, { ...meta, complete: true });
    }
    return { kind: 'upload', uploadId };
  });
}
