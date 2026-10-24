// The resource packs a Minecraft 1.7.10 client has switched on (add-on 23): the names on the `resourcePacks` line of the
// game folder's `options.txt`, lowest priority first as the game saves them, each matched to a folder or a zip in
// `resourcepacks/` and read for the version in its `pack.mcmeta`. A listed name is a pack's file name in
// `resourcepacks/`, as in 1.7.10's `ResourcePackRepository`, and a name that is not there, or a pack whose `pack.mcmeta`
// is missing or cannot be read, is skipped as the game skips it. Every other skip is this reader's own rule, and the
// game does not always agree: `pack.mcmeta` has to be strict JSON holding a `pack` object (1.7.10 parses it leniently
// with Gson and keeps a pack without a `pack` section, though it skips a `pack` object without `pack_format`, which this
// reader keeps), and a name listed twice is read at its first place only (the game ranks the pack at its last listing).
// Each skip comes with its reason. This module only reads: `options.txt` and a folder's `pack.mcmeta` with `readFile`,
// zips with yauzl (it opens them with flag 'r', as the extractor opens jars). Nothing under the instance is written,
// renamed or locked, and a listed name that is not a plain file name (`../x`) is never opened. The packs' textures are
// not read here: the extractor takes them from the `PackSet`.

import { statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import yauzl from 'yauzl';
import type { Options as ZipOptions, ZipFile } from 'yauzl';
import type { AssetPacks } from './index.ts';

/** A pack to read: `path` is its folder or zip in `<game folder>/resourcepacks/`, `version` is from its `pack.mcmeta`. */
export interface PackSource { name: string; path: string; format: 'folder' | 'zip'; version: string }
/** Both lowest priority first: `enabled` is `options.txt`'s list as read (repeats and skipped names included). */
export interface PackSet { enabled: string[]; packs: PackSource[] }
/** A listed name that this reader skips, and why. */
export interface SkippedPack { name: string; reason: string }

const OPTIONS_TXT = 'options.txt';
const PACK_DIR = 'resourcepacks';
const PACK_MCMETA = 'pack.mcmeta';
const RESOURCE_PACKS_KEY = 'resourcePacks:';
/** The reason for a `pack.mcmeta` that is missing or cannot be read: the game skips such a pack too. */
const NO_MCMETA = 'no valid pack.mcmeta (the game skips it too)';
/** The reason for a `pack.mcmeta` that fails this reader's own rule; the game applies some such packs. */
const BAD_MCMETA = 'pack.mcmeta is not strict JSON with a "pack" object';
/**
 * As the extractor opens jars: entry names stay raw, because with `decodeStrings: true` yauzl refuses a whole zip for
 * one entry name holding `..` or `\`, which would skip a pack that the extraction itself can read.
 */
const OPEN_OPTIONS: ZipOptions = { lazyEntries: true, autoClose: false, decodeStrings: false };
/** A listed name is one file name in `resourcepacks/`: no separator and no control character. */
const UNSAFE_NAME = /[\/\\\p{Cc}]/u;
/** A formatting code of a pack description: `§` and the character after it. */
const FORMAT_CODE = /§./gs;
const NO_PACKS: AssetPacks = { enabled: [], read: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The names on `options.txt`'s `resourcePacks:` line, lowest priority first: the strings of the JSON array after the
 * key. The game assigns line by line, so the last such line counts. A missing line, or one that is not a JSON array,
 * gives `[]`; entries that are not strings are dropped. A byte-order mark is not stripped: the game reads the first
 * line's key with it too, and `options.txt` starts with `version:`, so a BOM never touches this line in practice.
 */
export function parseResourcePacks(optionsTxt: string): string[] {
  let value: string | undefined;
  for (const line of optionsTxt.split(/\r?\n/)) {
    if (line.startsWith(RESOURCE_PACKS_KEY)) value = line.slice(RESOURCE_PACKS_KEY.length);
  }
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : [];
}

/**
 * A pack's version from the text of its `pack.mcmeta`; null when this reader skips the pack, which is when the text
 * (without a leading U+FEFF, which real packs have) is not strict JSON for an object holding a `pack` object: this
 * reader's rule, not the game's (the module comment says where they differ). The version is the GTNH resource pack
 * updater's `pack_version` when it is a non-empty string, else the pack's `description` without its `§x` codes and
 * trimmed, else ''.
 */
export function packVersion(mcmetaText: string): string | null {
  let meta: unknown;
  try {
    meta = JSON.parse(mcmetaText.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!isRecord(meta)) return null;
  const pack = meta.pack;
  if (!isRecord(pack)) return null;
  const updater = meta.gtnh_resource_pack_updater;
  if (isRecord(updater) && typeof updater.pack_version === 'string' && updater.pack_version !== '') return updater.pack_version;
  return typeof pack.description === 'string' ? pack.description.replace(FORMAT_CODE, '').trim() : '';
}

/**
 * The game folder of an instance: the first of `folder`, `folder/.minecraft` (Prism Launcher's) and `folder/minecraft`
 * that holds an `options.txt` file, else null. It only `stat`s, so an `options.txt` that cannot be read is found too,
 * and `readPackSet` is where that error shows.
 */
export function gameDirOf(folder: string): string | null {
  const holdsOptions = (dir: string) => statSync(join(dir, OPTIONS_TXT), { throwIfNoEntry: false })?.isFile() === true;
  return [folder, join(folder, '.minecraft'), join(folder, 'minecraft')].find(holdsOptions) ?? null;
}

/** A listed name is a pack's file name: not empty, `.` or `..`, and without `/`, `\` or a control character. */
function isPackName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !UNSAFE_NAME.test(name);
}

/** A folder, or a zip when it is a file (`stat` follows links); null when it is neither, or is not there. */
async function packFormat(path: string): Promise<PackSource['format'] | null> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? 'folder' : info.isFile() ? 'zip' : null;
  } catch {
    return null;
  }
}

/** The text of `path`, or null when it cannot be read. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** The text of the zip's top-level `pack.mcmeta` (an exact name, as zip packs match); null when absent or unreadable. */
async function zipMcmeta(zip: ZipFile): Promise<string | null> {
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileNameRaw.toString('utf8') !== PACK_MCMETA) continue;
      return (await buffer(await zip.openReadStreamPromise(entry))).toString('utf8');
    }
  } catch {
    // a damaged entry or central directory: there is no readable pack.mcmeta
  }
  return null;
}

/** The pack `name` in `<gameDir>/resourcepacks/`, or why this reader skips it. `name` is a plain file name. */
async function inspectPack(gameDir: string, name: string): Promise<{ pack: PackSource } | { reason: string }> {
  const path = join(gameDir, PACK_DIR, name);
  const format = await packFormat(path);
  if (format === null) return { reason: 'not in resourcepacks/' };
  let mcmeta: string | null;
  if (format === 'folder') {
    mcmeta = await readText(join(path, PACK_MCMETA));
  } else {
    let zip: ZipFile;
    try {
      zip = await yauzl.openPromise(path, OPEN_OPTIONS);
    } catch (err) {
      return { reason: messageOf(err) };
    }
    try {
      mcmeta = await zipMcmeta(zip);
    } finally {
      zip.close();
    }
  }
  if (mcmeta === null) return { reason: NO_MCMETA };
  const version = packVersion(mcmeta);
  return version === null ? { reason: BAD_MCMETA } : { pack: { name, path, format, version } };
}

/**
 * Reads `<gameDir>/options.txt` once and the packs it lists. `set.enabled` is the list as read; `set.packs` are the packs
 * this reader keeps, with their versions. Every other listed name is in `skipped` with its reason, in the order
 * listed: a name that is not a file name (so `../x` never leaves `resourcepacks/`), one listed before, one not in
 * `resourcepacks/`, a zip yauzl cannot open, a pack whose `pack.mcmeta` is missing or cannot be read, or one whose
 * `pack.mcmeta` is not strict JSON holding a `pack` object. The read of `options.txt` is the only thing that throws;
 * whatever goes wrong with one pack is a skip.
 */
export async function readPackSet(gameDir: string): Promise<{ set: PackSet; skipped: SkippedPack[] }> {
  const enabled = parseResourcePacks(await readFile(join(gameDir, OPTIONS_TXT), 'utf8'));
  const packs: PackSource[] = [];
  const skipped: SkippedPack[] = [];
  const listed = new Set<string>();
  for (const name of enabled) {
    if (!isPackName(name)) {
      skipped.push({ name, reason: 'not a pack name' });
    } else if (listed.has(name)) {
      skipped.push({ name, reason: 'listed twice' });
    } else {
      listed.add(name);
      const found = await inspectPack(gameDir, name);
      if ('pack' in found) packs.push(found.pack);
      else skipped.push({ name, reason: found.reason });
    }
  }
  return { set: { enabled, packs }, skipped };
}

/**
 * What changed between the pack lists of two runs, one line each, for the CLI to print; `undefined` is a run that read
 * no instance. Packs are compared by name. First, for each pack of `next.read`, lowest first, one line at most: added,
 * its version changed, or the same version with a different number of texture entries or bytes. Then each pack of
 * `prev.read` that is gone. Then one line when the packs both runs read have a different relative order. An edit that
 * keeps a pack's version, entry count and byte count is not seen: no per-file checksum is kept (fewer moving parts).
 */
export function packChanges(prev: AssetPacks | undefined, next: AssetPacks | undefined): string[] {
  const before = (prev ?? NO_PACKS).read;
  const after = (next ?? NO_PACKS).read;
  const beforeByName = new Map(before.map((pack) => [pack.name, pack]));
  const afterNames = new Set(after.map((pack) => pack.name));
  const lines: string[] = [];
  for (const pack of after) {
    const old = beforeByName.get(pack.name);
    if (old === undefined) lines.push(`added ${pack.name} (${pack.version})`);
    else if (old.version !== pack.version) lines.push(`${pack.name}: ${old.version} → ${pack.version}`);
    else if (old.entries !== pack.entries || old.bytes !== pack.bytes) lines.push(`${pack.name}: same version, different files`);
  }
  for (const pack of before) {
    if (!afterNames.has(pack.name)) lines.push(`removed ${pack.name}`);
  }
  const keptBefore = before.filter((pack) => afterNames.has(pack.name)).map((pack) => pack.name);
  const keptAfter = after.filter((pack) => beforeByName.has(pack.name)).map((pack) => pack.name);
  if (keptBefore.length !== keptAfter.length || keptBefore.some((name, i) => name !== keptAfter[i])) {
    lines.push(`order changed, last wins: ${after.map((pack) => pack.name).reverse().join(', ')}`);
  }
  return lines;
}
