// Copies the block and item textures (PNG + `.png.mcmeta`) and the chests' model sheets (PNG) out of the modpack's jars
// and the user's resource packs into `<dataDir>/assets/` and writes `index.json` (Task 2; the packs are add-on 23).
// Every resource pack ranks above every jar, the last enabled pack highest (`layerPacks`). Sources are only read: jars
// and zip packs are opened with yauzl (flag 'r'), a folder pack is listed with `readdir` and read with `readFile`.
// Everything is first written to a staging folder next to `assets/`, which replaces the old folder only once it is
// complete, so a failed run leaves the previous textures in place. No other module writes extracted textures or
// `assets/index.json`.

import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import type { Entry, Options as ZipOptions, ZipFile } from 'yauzl';
import { ASSET_INDEX_FORMAT, INDEX_FILE, type AssetConflict, type AssetFileInfo, type AssetIndexFile, type AssetPacks } from './index.ts';
import { layerPacks, type LayerFrom } from './pack-layer.ts';
import { animationFrames, pngSize, type PngSize } from './png.ts';
import type { PackSet, PackSource } from './resource-packs.ts';

export interface JarSource { path: string; kind: 'client' | 'mod' }
export interface ExtractOptions {
  jars: JarSource[]; dataDir: string; clientSha1?: string; now?: () => Date;
  /** The client instance's resource packs, lowest priority first. Without it the textures come from the jars alone. */
  packs?: PackSet;
}
export interface ExtractSummary {
  files: number /* PNGs indexed */; bytes: number /* bytes copied */; jars: number /* jars opened */; conflicts: AssetConflict[];
  identicalDuplicates: number; skippedJars: Array<{ jar: string /* a jar's file name or a resource pack's name */; error: string }>;
  ignoredEntries: number /* jar entries that are not block/item textures or chest model sheets */;
  packFiles: number /* PNGs indexed from resource packs */; packReplaced: number /* those a jar also had */;
  caseOnly: number /* zip pack entries left out: their names differ from the game's only in case */;
  notPngInPacks: Array<{ pack: string; path: string }> /* pack files named .png that are not PNGs: left out, no jar fallback */;
  packs: AssetPacks | null /* as index.json records it; null without `opts.packs` */;
}
/** A folder pack's texture file as `scanFolderPack` read it: the CRC-32 and size of its bytes, and its path on disk. */
export interface FolderEntry { crc: number; size: number; file: string }
/** What one copy function took from its source, by target path (`data/assets`-relative, as written). */
export interface CopyResult {
  sizes: Map<string, PngSize> /* target PNG → size */; mcmetas: Map<string, Buffer> /* target PNG → .mcmeta bytes */;
  bytes: number; notPng: string[] /* target paths */;
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
/**
 * The model sheets the chests are cut from (architecture §11.43 (e)): the client jar's `entity/chest/<name>.png` and
 * IronChest's `model/<name>.png`, drawn by a tile-entity renderer rather than from an atlas. Only these two folders.
 */
const MODEL_SHEET = /^assets\/(minecraft\/textures\/entity\/chest|ironchest\/textures\/model)\/([a-z_]+\.png)$/;
const UNSAFE_CHAR = /[\\\p{Cc}]/u;
const MCMETA = '.mcmeta';
/** A folder pack's folder of resources, as in a jar. */
const ASSETS = 'assets';
/** `<dataDir>/assets/nei/` belongs to the NEI icon import (Task 11), so no jar or pack domain is extracted there. */
const NEI_DIR = 'nei';
/** Skipped jars named in the error when no mod jar could be read. */
const LISTED_SKIPPED = 20;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The error of a path that is not there (or leads through a file). */
function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
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
 * control characters; else null. Also a chest model sheet, `assets/minecraft/textures/entity/chest/<name>.png` or
 * `assets/ironchest/textures/model/<name>.png` (`[a-z_]+`, no `.mcmeta`), under its own path. The result never leads
 * outside the folder it is joined to.
 */
export function textureEntry(name: string): string | null {
  const sheet = MODEL_SHEET.exec(name);
  if (sheet !== null) return `${sheet[1]}/${sheet[2]}`;
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
 * `textureEntry` for a folder pack's file, named relative to the pack folder with `/`. The game finds a folder pack's
 * files in any case on this Mac's file system, so the name is accepted when its lower-cased form is, except that a
 * domain folder that is not lower case as spelled gives null (Minecraft 1.7.10's `FolderResourcePack` ignores it, as
 * `textureEntry` refuses it in a jar). The result keeps the file's own spelling, except that `textures/<blocks|items>/`
 * and the `.png` or `.png.mcmeta` ending are lower case, as the game asks for them; a chest model sheet is lower case
 * as a whole.
 */
export function folderEntry(name: string): string | null {
  const lower = name.toLowerCase();
  const rel = textureEntry(lower);
  if (rel === null) return null;
  const parts = name.split('/');   // assets, <domain>, textures, <atlas>, <rest>… (lower-casing keeps every `/`)
  if (parts[1] !== domainOf(rel)) return null;
  if (MODEL_SHEET.test(lower)) return rel;
  const ending = rel.endsWith(MCMETA) ? `.png${MCMETA}` : '.png';
  const rest = parts.slice(4).join('/');
  return `${parts[1]}/textures/${parts[3]!.toLowerCase()}/${rest.slice(0, -ending.length)}${ending}`;
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
/** A resource pack after pass 1: a zip's entries as `scanJar` lists them, a folder's as `scanFolderPack` does. */
type ScannedPack =
  | { source: PackSource; format: 'zip'; entries: Map<string, EntryMeta> }
  | { source: PackSource; format: 'folder'; entries: Map<string, FolderEntry> };

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

/**
 * Pass 1 for a folder pack: walks `<dir>/assets/` and keys each regular file by `folderEntry`, reading it once for its
 * CRC-32 (the first file in path order when two give one key, which only a case-sensitive disk allows). Symbolic links
 * and other files that are not regular are left out, and so are the `nei` domain and every file that is not a texture;
 * `ignored` counts them, unread. The walk never enters a linked folder, `assets/` included, so nothing is read outside
 * the pack through a link. Files are taken in path order, whatever order the disk lists them in. A folder without
 * `assets/` holds no texture.
 */
export async function scanFolderPack(dir: string): Promise<{ entries: Map<string, FolderEntry>; ignored: number }> {
  const assets = join(dir, ASSETS);
  let listed: Dirent[];
  try {
    if (!(await lstat(assets)).isDirectory()) return { entries: new Map(), ignored: 0 };
    listed = await readdir(assets, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return { entries: new Map(), ignored: 0 };
    throw err;
  }
  const files = listed.filter((e) => !e.isDirectory()).map((e) => ({ dirent: e, file: join(e.parentPath, e.name) }));
  files.sort((a, b) => byCodeUnit(a.file, b.file));
  const entries = new Map<string, FolderEntry>();
  let ignored = 0;
  for (const { dirent, file } of files) {
    const rel = dirent.isFile() ? folderEntry(`${ASSETS}/${relative(assets, file).split(sep).join('/')}`) : null;
    if (rel === null || domainOf(rel) === NEI_DIR) {
      ignored++;
    } else if (!entries.has(rel)) {
      const data = await readFile(file);
      entries.set(rel, { crc: crc32(data), size: data.length, file });
    }
  }
  return { entries, ignored };
}

/** Pass 1 for a resource pack: a zip is scanned as a jar is, a folder by `scanFolderPack`. */
async function scanPack(source: PackSource): Promise<ScannedPack> {
  if (source.format === 'zip') return { source, format: 'zip', entries: (await scanJar(source.path)).entries };
  return { source, format: 'folder', entries: (await scanFolderPack(source.path)).entries };
}

async function readWhole(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return buffer(await zip.openReadStreamPromise(entry));
}

/** Writes `data` to `<root>/<rel>`, creating each folder once per run (`madeDirs`); the bytes written. */
async function writeInto(root: string, rel: string, data: Buffer, madeDirs: Set<string>): Promise<number> {
  const file = join(root, rel);
  const dir = dirname(file);
  if (!madeDirs.has(dir)) {
    await mkdir(dir, { recursive: true });
    madeDirs.add(dir);
  }
  await writeFile(file, data);
  return data.length;
}

/**
 * Takes one file a copy function read for `target`: an `.mcmeta` is kept for `extractAssets` under its PNG's target, a
 * PNG is written, and a `.png` that is not a PNG is listed in `notPng` and not written.
 */
async function takeCopied(result: CopyResult, target: string, data: Buffer, root: string, madeDirs: Set<string>): Promise<void> {
  if (target.endsWith(MCMETA)) {
    result.mcmetas.set(target.slice(0, -MCMETA.length), data);
    return;
  }
  const size = pngSize(data);
  if (size === null) {
    result.notPng.push(target);
    return;
  }
  result.bytes += await writeInto(root, target, data, madeDirs);
  result.sizes.set(target, size);
}

function emptyCopy(): CopyResult {
  return { sizes: new Map(), mcmetas: new Map(), bytes: 0, notPng: [] };
}

/**
 * Pass 2 for a jar or a zip pack: copies the entries in `wanted` (entry → target) into `root`, each checked against the
 * CRC-32 that pass 1 listed for it in `scanned`.
 */
async function copyFromZip(path: string, scanned: ReadonlyMap<string, EntryMeta>, wanted: ReadonlyMap<string, string>, root: string, madeDirs: Set<string>): Promise<CopyResult> {
  const result = emptyCopy();
  const left = new Map(wanted);
  const zip = await yauzl.openPromise(path, OPEN_OPTIONS);
  try {
    for await (const e of zip.eachEntry()) {
      const name = e.fileNameRaw.toString('utf8');
      const rel = textureEntry(name);
      if (rel === null) continue;
      const target = left.get(rel);
      if (target === undefined) continue;
      left.delete(rel);
      let data: Buffer;
      try {
        data = await readWhole(zip, e);
      } catch (err) {
        throw new Error(`${name}: ${messageOf(err)}`, { cause: err });
      }
      if (crc32(data) !== scanned.get(rel)!.crc) {
        throw new Error(`${name}: CRC-32 mismatch (the entry is corrupt or the file changed during the extraction)`);
      }
      await takeCopied(result, target, data, root, madeDirs);
    }
  } finally {
    zip.close();
  }
  const missing = left.keys().next();
  if (!missing.done) throw new Error(`${missing.value} is no longer in the file (it changed during the extraction)`);
  return result;
}

/**
 * Pass 2 for a folder pack: reads each file in `wanted` (entry → target) and copies it into `root`. A file whose size
 * or CRC-32 differs from the scan changed after it (the pack was edited or updated during the run): the run fails
 * rather than mix two versions of the pack.
 */
export async function copyFromFolder(entries: ReadonlyMap<string, FolderEntry>, wanted: ReadonlyMap<string, string>, root: string, madeDirs: Set<string>): Promise<CopyResult> {
  const result = emptyCopy();
  for (const [entry, target] of wanted) {
    const scanned = entries.get(entry);
    if (scanned === undefined) throw new Error(`${entry} was not scanned`);
    const data = await readFile(scanned.file);
    if (data.length !== scanned.size || crc32(data) !== scanned.crc) throw new Error(`${scanned.file} changed during the extraction`);
    await takeCopied(result, target, data, root, madeDirs);
  }
  return result;
}

/** Runs one source's pass 2; an error names the source. */
async function copyNamed(name: string, copy: () => Promise<CopyResult>): Promise<CopyResult> {
  try {
    return await copy();
  } catch (err) {
    throw new ExtractError(`${name}: ${messageOf(err)}`, { cause: err });
  }
}

/** lstat succeeds; a missing path (or a path through a file) is absent. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
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
 * cannot be read is skipped, and when no mod jar is left the run fails before anything is written) and chooses the
 * winners among the jars by `pickWinner`. Then it scans each resource pack of `opts.packs`, lowest first (one that
 * cannot be read, or is named like a jar, is skipped), and `layerPacks` puts the packs over the jars. Pass 2 copies
 * each source's share into a staging folder, writes each `.mcmeta` whose PNG was copied, and writes `index.json` there
 * before `swapIn`. At most one zip is open at a time.
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
  if (scanned.every((jar) => jar.source.kind !== 'mod')) {
    // Every mod jar unreadable (or none given) is a broken setup, not an empty pack: keep the previous textures.
    const listed = skippedJars.slice(0, LISTED_SKIPPED).map((s) => `${s.jar} (${s.error})`);
    if (skippedJars.length > LISTED_SKIPPED) listed.push(`… ${skippedJars.length - LISTED_SKIPPED} more`);
    throw new ExtractError(`no mod jar could be read: ${listed.length === 0 ? 'none was found' : listed.join('; ')}`);
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
  const jarPngs = new Map<string, number>();   // each PNG path the jars hold → the jar that won it
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
    jarPngs.set(rel, winner);
  }
  conflicts.sort((a, b) => byCodeUnit(a.path, b.path));

  const packs: ScannedPack[] = [];   // the packs scanned, lowest first: `LayerFrom.pack` indexes this list
  for (const source of opts.packs?.packs ?? []) {
    const earlier = pathOfName.get(source.name);
    if (earlier !== undefined) {
      // files[p].jar names a pack by its name, so a pack named like a jar could not be told apart from it.
      skippedJars.push({ jar: source.name, error: `same file name as ${earlier}` });
      continue;
    }
    try {
      packs.push(await scanPack(source));
      pathOfName.set(source.name, source.path);
    } catch (err) {
      skippedJars.push({ jar: source.name, error: messageOf(err) });
    }
  }
  const layered = layerPacks({
    jarPngs,
    jarHasMcmeta: (j, p) => scanned[j]!.entries.has(p + MCMETA),
    packs: packs.map((pack) => ({ format: pack.format, entries: new Set(pack.entries.keys()) })),
  });
  // Each source's share, entry → target: the PNGs it supplies and the `.mcmeta` files taken from it.
  const lists = { jar: new Map<number, Map<string, string>>(), pack: new Map<number, Map<string, string>>() };
  const want = (from: LayerFrom, target: string) => {
    const index = from.kind === 'jar' ? from.jar : from.pack;
    let list = lists[from.kind].get(index);
    if (list === undefined) lists[from.kind].set(index, list = new Map());
    list.set(from.kind === 'jar' ? target : from.entry, target);   // a jar's paths are spelled as its entries
  };
  for (const [png, from] of layered.png) want(from, png);
  for (const [png, from] of layered.mcmeta) want(from, png + MCMETA);

  const staging = join(opts.dataDir, `assets.staging-${process.pid}-${Date.now()}`);
  try {
    await mkdir(opts.dataDir, { recursive: true });
    await mkdir(staging);
  } catch (err) {
    throw new ExtractError(`could not create ${staging}: ${messageOf(err)}`, { cause: err });
  }
  let summary: ExtractSummary;
  try {
    const copied = new Map<string, { size: PngSize; source: string }>();   // target PNG → its size and source's name
    const mcmetas = new Map<string, Buffer>();   // target PNG → its .mcmeta, from whichever source
    const supplied = new Map<string, number>();   // source name → PNGs indexed from it
    const notPngInPacks: ExtractSummary['notPngInPacks'] = [];
    const madeDirs = new Set<string>();
    let bytes = 0;
    let packFiles = 0;
    let packReplaced = 0;
    const take = (source: string, result: CopyResult) => {
      bytes += result.bytes;
      supplied.set(source, result.sizes.size);
      for (const [rel, size] of result.sizes) copied.set(rel, { size, source });
      for (const [rel, data] of result.mcmetas) mcmetas.set(rel, data);
    };
    for (const [i, list] of [...lists.jar].sort((a, b) => a[0] - b[0])) {
      const jar = scanned[i]!;
      const result = await copyNamed(jar.name, () => copyFromZip(jar.source.path, jar.entries, list, staging, madeDirs));
      take(jar.name, result);
      ignoredEntries += result.notPng.length;
    }
    for (const [k, list] of [...lists.pack].sort((a, b) => a[0] - b[0])) {
      const pack = packs[k]!;
      const name = pack.source.name;
      const result = await copyNamed(name, () => pack.format === 'zip'
        ? copyFromZip(pack.source.path, pack.entries, list, staging, madeDirs)
        : copyFromFolder(pack.entries, list, staging, madeDirs));
      take(name, result);
      for (const rel of result.sizes.keys()) {
        packFiles++;
        if (jarPngs.has(rel)) packReplaced++;
      }
      for (const path of result.notPng) notPngInPacks.push({ pack: name, path });
    }
    const files: Record<string, AssetFileInfo> = {};
    for (const rel of [...copied.keys()].sort(byCodeUnit)) {
      const { size, source } = copied.get(rel)!;
      const mcmeta = mcmetas.get(rel);
      let frames = 1;
      if (mcmeta !== undefined) {
        bytes += await writeInto(staging, rel + MCMETA, mcmeta, madeDirs);
        frames = animationFrames(mcmeta.toString('utf8'), size);
      }
      files[rel] = { w: size.width, h: size.height, ...(frames > 1 ? { frames } : {}), jar: source };
    }
    const packsRead: AssetPacks | null = opts.packs === undefined ? null : {
      enabled: [...opts.packs.enabled],
      read: packs.map((pack) => {
        let entryBytes = 0;
        for (const entry of pack.entries.values()) entryBytes += entry.size;
        return {
          name: pack.source.name, format: pack.format, version: pack.source.version,
          entries: pack.entries.size, bytes: entryBytes, files: supplied.get(pack.source.name) ?? 0,
        };
      }),
    };
    const index: AssetIndexFile = {
      format: ASSET_INDEX_FORMAT,
      createdAt: (opts.now ?? (() => new Date()))().toISOString(),
      sources: scanned.map((jar) => ({
        jar: jar.name, kind: jar.source.kind, files: supplied.get(jar.name) ?? 0,
        ...(jar.source.kind === 'client' && opts.clientSha1 !== undefined ? { sha1: opts.clientSha1 } : {}),
      })),
      files, conflicts, identicalDuplicates,
      ...(packsRead === null ? {} : { packs: packsRead }),
    };
    await writeFile(join(staging, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
    summary = {
      files: copied.size, bytes, jars: scanned.length, conflicts, identicalDuplicates, skippedJars, ignoredEntries,
      packFiles, packReplaced, caseOnly: layered.caseOnly.length, notPngInPacks, packs: packsRead,
    };
  } catch (err) {
    const left = await removeTree(staging);
    const tail = left === null ? '' : ` (could not remove ${staging}: ${left})`;
    throw new ExtractError(`${messageOf(err)}${tail}`, { cause: err });
  }
  await swapIn(opts.dataDir, staging);
  return summary;
}
