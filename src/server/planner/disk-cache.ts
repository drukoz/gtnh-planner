// The plan cache's store on disk (RUK-563 milestone 2): JSON values by key under one code version, one gzip file per key
// in a folder, at most `max` files with the least recently used dropped first, and never a failure for its caller. A later
// task wires it under `<dataDir>/cache/plans/` with the version from `codeVersion`, so a pulled change never serves a plan
// an older build made.

import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Makes a temp file name unique within this process. */
let counter = 0;

/** The file name of `key`'s value under code version `version`: the SHA-256 of `${version}\n${key}` in hex, then `.json.gz`. */
export function cacheFile(version: string, key: string): string {
  return `${createHash('sha256').update(`${version}\n${key}`).digest('hex')}.json.gz`;
}

/** A cache of JSON values on disk (RUK-563 milestone 2). */
export interface DiskCache {
  /** The value stored under `key`, or undefined when there is none or its file cannot be read (a damaged file is deleted). */
  get(key: string): Promise<unknown>;
  /** Stores `value` (JSON) under `key`, then drops the least recently used files past `max`. Never rejects. */
  put(key: string, value: unknown): Promise<void>;
}

/** The cache in folder `dir` (made on the first put), at most `opts.max` files, for code version `opts.version`. */
export function diskCache(dir: string, opts: { max: number; version: string }): DiskCache {
  const version = opts.version;
  return {
    async get(key: string): Promise<unknown> {
      const file = join(dir, cacheFile(version, key));
      try {
        const raw = await readFile(file);
        let parsed: unknown;
        try {
          parsed = JSON.parse((await gunzipAsync(raw)).toString('utf8')) as unknown;
        } catch {
          await unlink(file).catch(() => undefined);
          return undefined;
        }
        if (typeof parsed !== 'object' || parsed === null || (parsed as { key: unknown }).key !== key) {
          await unlink(file).catch(() => undefined);
          return undefined;
        }
        const now = new Date();
        await utimes(file, now, now).catch(() => undefined);
        return (parsed as { value: unknown }).value;
      } catch {
        return undefined;
      }
    },

    async put(key: string, value: unknown): Promise<void> {
      try {
        await mkdir(dir, { recursive: true });
        const data = await gzipAsync(Buffer.from(JSON.stringify({ key, value })));
        const file = join(dir, cacheFile(version, key));
        const tmp = join(dir, `${cacheFile(version, key)}.${process.pid}.${counter++}.tmp`);
        await writeFile(tmp, data);
        await rename(tmp, file);
        const names = (await readdir(dir)).filter((name) => name.endsWith('.json.gz'));
        if (names.length > opts.max) {
          const files = await Promise.all(
            names.map(async (name) => ({ name, mtimeMs: (await stat(join(dir, name))).mtimeMs })),
          );
          files.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          for (const f of files.slice(0, names.length - opts.max)) await unlink(join(dir, f.name)).catch(() => undefined);
        }
      } catch {
        // a cache that cannot write costs a cold plan, never a failed request
      }
    },
  };
}

/**
 * A hash of the code that makes plans, from the repository root `root`: the SHA-256, in hex, of every `.ts` file under
 * `src/server` and `src/shared` and of `package-lock.json`, each as its path relative to `root`, a NUL byte, its bytes
 * and a NUL byte, in the order of the paths sorted as strings with package-lock.json last.
 */
export function codeVersion(root: string): string {
  const paths: string[] = [];
  for (const top of ['src/server', 'src/shared']) {
    for (const path of readdirSync(join(root, top), { recursive: true, encoding: 'utf8' })) {
      if (path.endsWith('.ts')) paths.push(`${top}/${path}`);
    }
  }
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  paths.push('package-lock.json');
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
