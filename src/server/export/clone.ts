// Copies the server folder to the export clone under `.local/` with APFS clones (`cp -c`, no extra disk space), leaving
// world data, backups, logs, player files and the looping start scripts behind (export-mod.md §5.1). The server folder
// is only ever read: every check runs before anything is removed or written, and nothing is written outside the target.
// `cp -R` copies a symbolic link as a link, so a clone whose links lead outside it is refused and removed before anyone
// configures or starts it: the export server would read and write the live server's files through such a link.

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, readlink, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readLevelName } from './configure.ts';

const execFileAsync = promisify(execFile);

/** Top-level names never cloned: world data, backups, logs, player files, per-world mod data, the looping start scripts. */
export const CLONE_EXCLUDES: readonly string[] = Object.freeze([
  'World', 'backups', 'logs', 'crash-reports', 'journeymap', 'visualprospecting', 'serverutilities', 'blueprints',
  'usercache.json', 'usernamecache.json', 'ops.json', 'banned-players.json', 'banned-ips.json', 'whitelist.json',
  'startserver.sh', 'startserver.bat', 'startserver-java9.sh', 'startserver-java9.bat', '.healer.log', 'export-world',
]);

/** Top-level names never cloned, by pattern: the pack's world zips. */
export const CLONE_EXCLUDE_PATTERNS: readonly RegExp[] = Object.freeze([/^World-.*\.zip$/i]);

const APFS_HINT = 'APFS clone failed — keep the repo and the server folder on the same APFS volume';
/** Links named in a refusal; the rest are counted. */
const MAX_LINKS_SHOWN = 10;

/** The source is not a server folder, the target is not a safe place for the clone, or `cp -c` failed. */
export class CloneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloneError';
  }
}

/** `copied` and `skipped` are top-level names of the server folder, sorted. */
export interface CloneResult { target: string; copied: string[]; skipped: string[] }

/** Whether absolute `inner` is absolute `outer` itself or lies below it. */
function within(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function strictlyInside(outer: string, inner: string): boolean {
  return relative(outer, inner) !== '' && within(outer, inner);
}

function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

/** `path` with the symbolic links of its existing part resolved (on macOS also its letter case); a missing rest as given. */
async function physical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const parent = dirname(path);
    if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === path) throw err;
    return join(await physical(parent), basename(path));
  }
}

async function isKind(path: string, kind: 'file' | 'folder'): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return kind === 'file' ? info?.isFile() === true : info?.isDirectory() === true;
}

/**
 * The symbolic links below `clone` that may lead outside it, as `path -> target` (path relative to the clone). A link
 * is safe when its target is relative without a `..` segment (it can only lead further down, through links that are
 * checked themselves) or when it resolves, following every link, to an existing place inside the clone. Anything
 * else counts: an absolute target or one with `..` that resolves outside the clone, or that cannot be resolved at
 * all (dangling or looping), as there is no telling where a write through it would end up.
 */
async function linksLeaving(clone: string): Promise<string[]> {
  const inside = await realpath(clone);
  const unsafe: string[] = [];
  for (const entry of await readdir(clone, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const link = join(entry.parentPath, entry.name);
    const to = await readlink(link);
    if (!isAbsolute(to) && !to.split(/[/\\]/).includes('..')) continue;
    const resolved = await realpath(link).catch(() => null);
    if (resolved === null || !within(inside, resolved)) unsafe.push(`${relative(clone, link)} -> ${to}`);
  }
  return unsafe.sort();
}

/** Excluded names compare without letter case, as on macOS's default (case-insensitive) APFS volumes. */
function isExcluded(name: string, skipNames: ReadonlySet<string>): boolean {
  return skipNames.has(name.toLowerCase()) || CLONE_EXCLUDE_PATTERNS.some((p) => p.test(name));
}

/**
 * Replaces `target` with an APFS clone of the server folder `source`: `cp -c -R <source>/<entry> <target>/` for every
 * top-level entry except `CLONE_EXCLUDES`, `CLONE_EXCLUDE_PATTERNS` and the world folder named by the source's
 * `level-name`. Refuses (`CloneError`), before touching anything, a `source` without `mods/` and `server.properties`, a
 * `target` that is not inside `<root>/.local/`, and a `target` that is the source, lies inside it or contains it (also
 * through symbolic links). After copying it refuses, and removes the clone again, when the clone holds a symbolic
 * link that may lead outside it (see `linksLeaving`). Relative paths resolve against the working directory.
 */
export async function cloneServer(opts: { source: string; target: string; root: string }): Promise<CloneResult> {
  const source = resolve(opts.source);
  const target = resolve(opts.target);
  const local = resolve(opts.root, '.local');

  if (!(await isKind(join(source, 'mods'), 'folder')) || !(await isKind(join(source, 'server.properties'), 'file'))) {
    throw new CloneError(`${source} does not look like a GTNH server folder (it needs mods/ and server.properties)`);
  }
  // `rm` removes the target entry itself (a symbolic link there is removed, not followed), so only its parent resolves.
  const physicalTarget = join(await physical(dirname(target)), basename(target));
  if (!strictlyInside(local, target) || !strictlyInside(await physical(local), physicalTarget)) {
    throw new CloneError(`the clone target ${target} must be inside .local/ of the repo (${local})`);
  }
  if (overlaps(source, target) || overlaps(await realpath(source), physicalTarget)) {
    throw new CloneError(`refusing to clone into ${target}: the target must not be the server folder, lie inside the `
      + `server folder or contain it (${source})`);
  }

  const levelName = readLevelName(await readFile(join(source, 'server.properties'), 'utf8'));
  const skipNames = new Set([...CLONE_EXCLUDES, levelName].map((name) => name.toLowerCase()));
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const name of (await readdir(source)).sort()) (isExcluded(name, skipNames) ? skipped : copied).push(name);

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const name of copied) {
    try {
      await execFileAsync('cp', ['-c', '-R', join(source, name), `${target}/`]);
    } catch (err) {
      const stderr = (err as { stderr?: unknown }).stderr;
      const detail = typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : (err as Error).message;
      throw new CloneError(`cp -c -R ${name} failed: ${detail}\n${APFS_HINT}`, { cause: err });
    }
  }
  const unsafe = await linksLeaving(target);
  if (unsafe.length > 0) {
    await rm(target, { recursive: true, force: true });   // removes the links themselves, never what they point at
    const shown = unsafe.slice(0, MAX_LINKS_SHOWN).map((line) => `  ${line}`);
    if (unsafe.length > MAX_LINKS_SHOWN) shown.push(`  … and ${unsafe.length - MAX_LINKS_SHOWN} more`);
    throw new CloneError([
      `refusing to export from ${source}: it holds symbolic links that lead outside the server folder copy, so the `
        + 'export server would read and write the files they point at (for example the live server\'s config):',
      ...shown,
      'Replace them with real files or folders, or with links that stay inside the server folder, and run the export again.',
    ].join('\n'));
  }
  return { target, copied, skipped };
}
