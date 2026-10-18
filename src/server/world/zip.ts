// Backup zips as a world source (world-format §1.1): ServerUtilities writes `backups/YYYY-MM-DD-HH-MM-SS.zip` every
// 30 minutes. A zip counts only when it is complete (yauzl opens its central directory) and at least
// BACKUP_MIN_AGE_MS old, so a backup still being written is never read. Entries are inflated one at a time.

import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import { isScanPath, type WorldEntry, type WorldFiles } from './files.ts';

export const BACKUP_MIN_AGE_MS = 120_000;

/** The file is not a usable world zip: no central directory, or no level.dat. File system errors are never this. */
export class ZipWorldError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipWorldError';
  }
}

function hasCode(err: unknown): boolean {
  return typeof (err as { code?: unknown } | null)?.code === 'string';
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** File system errors (with a `code`) pass unchanged; yauzl's format errors become ZipWorldError. */
function zipError(err: unknown, label: string): unknown {
  if (err instanceof ZipWorldError || hasCode(err) || !(err instanceof Error)) return err;
  return new ZipWorldError(`${label} is not a complete zip: ${err.message}`, { cause: err });
}

function openZip(path: string): Promise<ZipFile> {
  return openPromise(path, { lazyEntries: true, autoClose: false });
}

export async function isCompleteZip(path: string): Promise<boolean> {
  try {
    (await openZip(path)).close();
    return true;
  } catch {
    return false;
  }
}

/** Basenames of the complete `*.zip` files in `backupsDir` whose mtime is ≤ now − BACKUP_MIN_AGE_MS, newest first. */
export async function listCompleteBackups(backupsDir: string, now: number = Date.now()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(backupsDir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const found: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.zip')) continue;
    const path = join(backupsDir, name);
    const st = await stat(path).catch((err: unknown) => {
      if (isMissing(err)) return null;
      throw err;
    });
    if (st === null || !st.isFile() || st.mtimeMs > now - BACKUP_MIN_AGE_MS) continue;
    if (await isCompleteZip(path)) found.push({ name, mtimeMs: st.mtimeMs });
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return found.map((f) => f.name);
}

/** The folder of the shallowest `level.dat` entry ('' at the top, else ending in '/'); ties go to the first name. */
function worldRoot(names: string[]): string | null {
  let best: { name: string; depth: number } | null = null;
  for (const name of names) {
    if (name !== 'level.dat' && !name.endsWith('/level.dat')) continue;
    const depth = name.split('/').length;
    if (best === null || depth < best.depth || (depth === best.depth && name < best.name)) best = { name, depth };
  }
  return best === null ? null : best.name.slice(0, -'level.dat'.length);
}

async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * A backup zip as world files: the world root is the folder of the shallowest `level.dat` entry and entries outside it
 * are ignored. Throws ZipWorldError for a zip without a central directory or without level.dat; file system errors
 * (ENOENT, EACCES, …) propagate unchanged.
 */
export async function openZipWorld(zipPath: string, label: string = basename(zipPath)): Promise<WorldFiles> {
  let zip: ZipFile;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    throw zipError(err, label);
  }
  const entries = new Map<string, Entry>();
  try {
    const all: Entry[] = [];
    for await (const entry of zip.eachEntry()) if (!entry.fileName.endsWith('/')) all.push(entry);
    const root = worldRoot(all.map((e) => e.fileName));
    if (root === null) throw new ZipWorldError(`${label} holds no level.dat`);
    for (const entry of all) {
      if (!entry.fileName.startsWith(root)) continue;
      const rel = entry.fileName.slice(root.length);
      if (isScanPath(rel) && !entries.has(rel)) entries.set(rel, entry);
    }
  } catch (err) {
    zip.close();
    throw zipError(err, label);
  }

  const listing: WorldEntry[] = [...entries].map(([path, e]) => ({ path, size: e.uncompressedSize }));
  let queue: Promise<unknown> = Promise.resolve();   // one entry inflated at a time
  return {
    label,
    list: async () => listing.map((e) => ({ ...e })),
    read: (rel) => {
      const entry = entries.get(rel);
      if (entry === undefined) return Promise.resolve(null);
      const read = queue.then(() => readEntry(zip, entry));
      queue = read.catch(() => {});
      return read;
    },
    close: async () => {
      await queue;
      zip.close();
    },
  };
}
