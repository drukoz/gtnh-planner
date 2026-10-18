// Copies the block and item textures (PNG + `.png.mcmeta`) out of the pack's jars into `<dataDir>/assets/` and writes
// `index.json` (Task 2). Jars are only read (yauzl opens them with flag 'r'). Everything is first written to a staging
// folder next to `assets/`, which replaces the old folder only once it is complete, so a failed run leaves the
// previous textures in place. No other module writes extracted textures or `assets/index.json`.

import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import type { Entry, Options as ZipOptions, ZipFile } from 'yauzl';
import { ASSET_INDEX_FORMAT, INDEX_FILE, type AssetConflict, type AssetFileInfo, type AssetIndexFile } from './index.ts';
import { animationFrames, pngSize, type PngSize } from './png.ts';

export interface JarSource { path: string; kind: 'client' | 'mod' }
export interface ExtractOptions { jars: JarSource[]; dataDir: string; clientSha1?: string; now?: () => Date }
export interface ExtractSummary {
  files: number /* PNGs indexed */; bytes: number /* bytes copied */; jars: number /* jars opened */; conflicts: AssetConflict[];
  identicalDuplicates: number; skippedJars: Array<{ jar: string; error: string }>;
  ignoredEntries: number /* entries that are not block/item textures */;
}

/** The copy failed; `<dataDir>/assets` was left as it was. */
export class ExtractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractError';
  }
}

type Rule = AssetConflict['rule'];
interface Candidate { jar: string; kind: 'client' | 'mod' }

/**
 * Entry names are decoded here, not by yauzl: with `decodeStrings: true` yauzl rejects the whole jar when one entry
 * name holds `..` or `\`, and `textureEntry` refuses such names anyway.
 */
const OPEN_OPTIONS: ZipOptions = { lazyEntries: true, autoClose: false, decodeStrings: false };
const TEXTURE_ENTRY = /^assets\/([a-z0-9_.-]+)\/textures\/(blocks|items)\/(.+)$/;
const UNSAFE_CHAR = /[\\\p{Cc}]/u;
const MCMETA = '.mcmeta';
/** `<dataDir>/assets/nei/` belongs to the NEI icon import (Task 11), so no jar domain is extracted there. */
const NEI_DIR = 'nei';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Case-insensitive name order, exact order between names that differ only in case. */
function byName(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function domainOf(rel: string): string {
  return rel.slice(0, rel.indexOf('/'));
}

/**
 * `<domain>/textures/<blocks|items>/<rest>` (the `data/assets`-relative path) for a jar entry
 * `assets/<domain>/textures/<blocks|items>/<rest>` whose domain is lower case (the game lower-cases domains before
 * it looks a file up) and whose rest is a `.png` or `.png.mcmeta` path without empty, `.` or `..` segments, `\` or
 * control characters; else null. The result never leads outside the folder it is joined to.
 */
export function textureEntry(name: string): string | null {
  const m = TEXTURE_ENTRY.exec(name);
  if (m === null) return null;
  const domain = m[1]!;
  const atlas = m[2]!;
  const rest = m[3]!;
  if (domain === '.' || domain === '..') return null;
  if (!rest.endsWith('.png') && !rest.endsWith(`.png${MCMETA}`)) return null;
  if (UNSAFE_CHAR.test(rest)) return null;
  if (rest.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return `${domain}/textures/${atlas}/${rest}`;
}

/**
 * Which jar's copy of a texture path is used (research §2.2: the last resource pack wins and FML adds one pack per
 * mod after vanilla). In order, until one candidate is left: (1) a mod jar beats the client jar; (2) among mod jars,
 * the jars other than the domain's home jar beat the home jar (a jar ships another mod's path only to override it);
 * (3) the jar whose name sorts last case-insensitively. `rule` is the step that decided.
 */
export function pickWinner(candidates: ReadonlyArray<Candidate>, home: string | undefined): { winner: string; rule: Rule } {
  if (candidates.length === 0) throw new RangeError('pickWinner needs at least one candidate');
  const steps: Array<[Rule, (c: Candidate) => boolean]> = [
    ['mod-over-client', (c) => c.kind === 'mod'],
    ['override-over-home', (c) => c.kind === 'mod' && c.jar !== home],
  ];
  let pool = candidates;
  for (const [rule, keep] of steps) {
    const kept = pool.filter(keep);
    if (kept.length === 0 || kept.length === pool.length) continue;
    pool = kept;
    if (pool.length === 1) return { winner: pool[0]!.jar, rule };
  }
  const last = pool.reduce((a, b) => (byName(b.jar, a.jar) >= 0 ? b : a));
  return { winner: last.jar, rule: 'last-by-name' };
}

interface EntryMeta { crc: number; size: number }
interface ScannedJar { name: string; source: JarSource; entries: Map<string /* data/assets-relative path */, EntryMeta> }

/** Pass 1: the texture entries listed in the central directory (the first one when a name repeats). */
async function scanJar(path: string): Promise<{ entries: Map<string, EntryMeta>; ignored: number }> {
  const zip = await yauzl.openPromise(path, OPEN_OPTIONS);
  try {
    const entries = new Map<string, EntryMeta>();
    let ignored = 0;
    for await (const e of zip.eachEntry()) {
      const rel = textureEntry(e.fileNameRaw.toString('utf8'));
      if (rel === null || domainOf(rel) === NEI_DIR) {
        ignored++;
      } else if (!entries.has(rel)) {
        entries.set(rel, { crc: e.crc32, size: e.uncompressedSize });
      }
    }
    return { entries, ignored };
  } finally {
    zip.close();
  }
}

async function readWhole(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return buffer(await zip.openReadStreamPromise(entry));
}

interface CopyResult { sizes: Map<string, PngSize>; frames: Map<string, number>; bytes: number; notPng: number }

/**
 * Pass 2 for one jar: copies the entries in `wanted` into `root`. A `.png` that is not a PNG is left out, and so is
 * its `.mcmeta`; a `.mcmeta` gives the frame count of its PNG.
 */
async function copyFromJar(jar: ScannedJar, wanted: ReadonlySet<string>, root: string, madeDirs: Set<string>): Promise<CopyResult> {
  const result: CopyResult = { sizes: new Map(), frames: new Map(), bytes: 0, notPng: 0 };
  const write = async (rel: string, data: Buffer) => {
    const file = join(root, rel);
    const dir = dirname(file);
    if (!madeDirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      madeDirs.add(dir);
    }
    await writeFile(file, data);
    result.bytes += data.length;
  };
  const mcmetas = new Map<string, Buffer>();
  const left = new Set(wanted);
  const zip = await yauzl.openPromise(jar.source.path, OPEN_OPTIONS);
  try {
    for await (const e of zip.eachEntry()) {
      const name = e.fileNameRaw.toString('utf8');
      const rel = textureEntry(name);
      if (rel === null || !left.delete(rel)) continue;
      let data: Buffer;
      try {
        data = await readWhole(zip, e);
      } catch (err) {
        throw new Error(`${name}: ${messageOf(err)}`, { cause: err });
      }
      if (crc32(data) !== jar.entries.get(rel)!.crc) {
        throw new Error(`${name}: CRC-32 mismatch (the entry is corrupt or the jar changed during the extraction)`);
      }
      if (rel.endsWith(MCMETA)) {
        mcmetas.set(rel, data);
        continue;
      }
      const size = pngSize(data);
      if (size === null) {
        result.notPng++;
        continue;
      }
      await write(rel, data);
      result.sizes.set(rel, size);
    }
  } finally {
    zip.close();
  }
  const missing = left.values().next();
  if (!missing.done) throw new Error(`${missing.value} is no longer in the jar (it changed during the extraction)`);
  for (const [rel, data] of mcmetas) {
    const png = rel.slice(0, -MCMETA.length);
    const size = result.sizes.get(png);
    if (size === undefined) continue;
    await write(rel, data);
    result.frames.set(png, animationFrames(data.toString('utf8'), size));
  }
  return result;
}

/** lstat succeeds; a missing path (or a path through a file) is absent. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw err;
  }
}

/** Removes `path`; the error message when that fails, else null. */
async function removeTree(path: string): Promise<string | null> {
  try {
    await rm(path, { recursive: true, force: true });
    return null;
  } catch (err) {
    return messageOf(err);
  }
}

/**
 * Puts the complete staging folder in place of `<dataDir>/assets`: the NEI import moves into it, the old folder is
 * renamed away, the staging folder renamed in, and the old folder removed. A failed rename moves back what was moved.
 */
async function swapIn(dataDir: string, staging: string): Promise<void> {
  const live = join(dataDir, 'assets');
  const old = join(dataDir, `assets.old-${Date.now()}`);
  const nei = join(live, NEI_DIR);
  const stagedNei = join(staging, NEI_DIR);
  const undo: Array<{ what: string; run: () => Promise<void> }> = [];
  try {
    if (await present(nei)) {
      await rename(nei, stagedNei);
      undo.push({ what: `move ${stagedNei} back to ${nei}`, run: () => rename(stagedNei, nei) });
    }
    if (await present(live)) {
      await rename(live, old);
      undo.push({ what: `rename ${old} back to ${live}`, run: () => rename(old, live) });
    }
    await rename(staging, live);
  } catch (err) {
    const problems: string[] = [];
    for (const step of undo.reverse()) {
      try {
        await step.run();
      } catch (undoErr) {
        problems.push(`could not ${step.what}: ${messageOf(undoErr)}`);
      }
    }
    if (problems.length === 0) {
      const left = await removeTree(staging);
      if (left !== null) problems.push(`could not remove ${staging}: ${left}`);
    }
    const tail = problems.length === 0 ? '' : ` (${problems.join('; ')})`;
    throw new ExtractError(`could not put the new textures in place: ${messageOf(err)}${tail}`, { cause: err });
  }
  // The new folder is in place; an old folder that cannot be removed only costs disk space.
  await removeTree(old);
}

/**
 * Pass 1 reads every jar's central directory (client jars first, then mods by case-insensitive name; a jar that
 * cannot be read is skipped), the winners are chosen by `pickWinner`, and pass 2 copies them into a staging folder
 * and writes `index.json` there before `swapIn`. At most one jar is open at a time.
 */
export async function extractAssets(opts: ExtractOptions): Promise<ExtractSummary> {
  const ordered = [...opts.jars].sort((a, b) =>
    a.kind === b.kind ? byName(basename(a.path), basename(b.path)) : a.kind === 'client' ? -1 : 1);
  const scanned: ScannedJar[] = [];
  const skippedJars: ExtractSummary['skippedJars'] = [];
  const pathOfName = new Map<string, string>();
  let ignoredEntries = 0;
  for (const source of ordered) {
    const name = basename(source.path);
    const earlier = pathOfName.get(name);
    if (earlier !== undefined) {
      // index.json names jars by file name, so a second jar of the same name could not be told apart.
      skippedJars.push({ jar: name, error: `same file name as ${earlier}` });
      continue;
    }
    try {
      const { entries, ignored } = await scanJar(source.path);
      scanned.push({ name, source, entries });
      pathOfName.set(name, source.path);
      ignoredEntries += ignored;
    } catch (err) {
      skippedJars.push({ jar: name, error: messageOf(err) });
    }
  }

  // The home jar of a domain: the mod jar with the most PNGs of that domain, the first by name on a tie.
  const home = new Map<string, { jar: string; count: number }>();
  for (const jar of scanned) {
    if (jar.source.kind !== 'mod') continue;
    const counts = new Map<string, number>();
    for (const rel of jar.entries.keys()) {
      if (rel.endsWith('.png')) counts.set(domainOf(rel), (counts.get(domainOf(rel)) ?? 0) + 1);
    }
    for (const [domain, count] of counts) {
      const best = home.get(domain);
      if (best === undefined || count > best.count) home.set(domain, { jar: jar.name, count });
    }
  }

  const candidates = new Map<string, number[]>();
  scanned.forEach((jar, i) => {
    for (const rel of jar.entries.keys()) {
      if (!rel.endsWith('.png')) continue;
      const list = candidates.get(rel);
      if (list === undefined) candidates.set(rel, [i]);
      else list.push(i);
    }
  });
  const wanted = new Map<number, Set<string>>();   // jar → paths to copy (each PNG it won, plus that PNG's .mcmeta)
  const conflicts: AssetConflict[] = [];
  let identicalDuplicates = 0;
  for (const [rel, holders] of candidates) {
    let winner = holders[0]!;
    if (holders.length > 1) {
      const pick = pickWinner(holders.map((i) => ({ jar: scanned[i]!.name, kind: scanned[i]!.source.kind })), home.get(domainOf(rel))?.jar);
      winner = holders.find((i) => scanned[i]!.name === pick.winner)!;
      const metas = holders.map((i) => scanned[i]!.entries.get(rel)!);
      if (metas.every((m) => m.crc === metas[0]!.crc && m.size === metas[0]!.size)) {
        identicalDuplicates++;
      } else {
        conflicts.push({ path: rel, winner: pick.winner, losers: holders.filter((i) => i !== winner).map((i) => scanned[i]!.name), rule: pick.rule });
      }
    }
    let set = wanted.get(winner);
    if (set === undefined) wanted.set(winner, set = new Set());
    set.add(rel);
    if (scanned[winner]!.entries.has(rel + MCMETA)) set.add(rel + MCMETA);
  }
  conflicts.sort((a, b) => byCodeUnit(a.path, b.path));

  const staging = join(opts.dataDir, `assets.staging-${process.pid}-${Date.now()}`);
  try {
    await mkdir(opts.dataDir, { recursive: true });
    await mkdir(staging);
  } catch (err) {
    throw new ExtractError(`could not create ${staging}: ${messageOf(err)}`, { cause: err });
  }
  let summary: ExtractSummary;
  try {
    const infos = new Map<string, AssetFileInfo>();
    const won = new Map<string, number>();   // jar name → PNG paths indexed from it
    const madeDirs = new Set<string>();
    let bytes = 0;
    for (const [i, paths] of [...wanted].sort((a, b) => a[0] - b[0])) {
      const jar = scanned[i]!;
      let copied: CopyResult;
      try {
        copied = await copyFromJar(jar, paths, staging, madeDirs);
      } catch (err) {
        throw new ExtractError(`${jar.name}: ${messageOf(err)}`, { cause: err });
      }
      bytes += copied.bytes;
      ignoredEntries += copied.notPng;
      won.set(jar.name, copied.sizes.size);
      for (const [rel, size] of copied.sizes) {
        const frames = copied.frames.get(rel) ?? 1;
        infos.set(rel, { w: size.width, h: size.height, ...(frames > 1 ? { frames } : {}), jar: jar.name });
      }
    }
    const files: Record<string, AssetFileInfo> = {};
    for (const rel of [...infos.keys()].sort(byCodeUnit)) files[rel] = infos.get(rel)!;
    const index: AssetIndexFile = {
      format: ASSET_INDEX_FORMAT,
      createdAt: (opts.now ?? (() => new Date()))().toISOString(),
      sources: scanned.map((jar) => ({
        jar: jar.name, kind: jar.source.kind, files: won.get(jar.name) ?? 0,
        ...(jar.source.kind === 'client' && opts.clientSha1 !== undefined ? { sha1: opts.clientSha1 } : {}),
      })),
      files, conflicts, identicalDuplicates,
    };
    await writeFile(join(staging, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
    summary = { files: infos.size, bytes, jars: scanned.length, conflicts, identicalDuplicates, skippedJars, ignoredEntries };
  } catch (err) {
    const left = await removeTree(staging);
    const tail = left === null ? '' : ` (could not remove ${staging}: ${left})`;
    throw new ExtractError(`${messageOf(err)}${tail}`, { cause: err });
  }
  await swapIn(opts.dataDir, staging);
  return summary;
}
