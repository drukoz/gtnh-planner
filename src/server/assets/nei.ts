// Optional NEI item-panel icon import (Task 11, research §6.5.1, Rulings R16 and R17). NEI's "Item Panel" data dump,
// taken by hand in a copy of the client instance, writes `itempanel.csv` and `itempanel_icons/<display name>.png`
// from the same item list, in the same order. This module joins them by row order, replaying NEI's CSV and file-name
// rules, keys fluid rows by their display name against the pack's fluids, and copies each icon to
// `<dataDir>/assets/nei/icons/` with `nei/index.json` (key → path). It owns `<dataDir>/assets/nei/` and its
// `nei.staging-<ms>/` folder; `npm run extract-assets` carries `nei/` over unchanged.

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TextureLayer } from '../../shared/types/assets.ts';
import type { FluidKey, StuffKey } from '../../shared/keys.ts';
import type { IconSource } from './resolve.ts';

export const NEI_INDEX_FORMAT = 'gtnh-planner-nei/1';
export const NEI_HEADER = ['Item Name', 'Item ID', 'Item meta', 'Has NBT', 'Display Name'] as const;

export interface NeiRow { name: string; meta: number; hasNbt: boolean; display: string }
export interface NeiIndexFile { format: typeof NEI_INDEX_FORMAT; importedAt: string; rows: number; icons: Record<string /* StuffKey */, string /* data/assets-relative path */> }

/** The dump was refused or could not be copied (the previous import stays in place), or `nei/index.json` is bad. */
export class NeiImportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NeiImportError';
  }
}

const NEI_DIR = 'nei';                         // <dataDir>/assets/nei
const ICONS_DIR = 'icons';                     // <dataDir>/assets/nei/icons
const NEI_INDEX_FILE = 'index.json';           // <dataDir>/assets/nei/index.json
/**
 * NEI's own display item for fluids. Its meta is the dump world's `FluidRegistry` id and its NBT holds only the amount
 * (`ItemFluidDisplay.createStack`), so a fluid row is matched by its Display Name (`Fluid.getLocalizedName()`).
 */
const FLUID_DISPLAY = 'NotEnoughItems:neiFluidDisplay';
/** A quoted field's inner text, when every `"` in it is one of a doubled pair. */
const DOUBLED_QUOTES_ONLY = /^(?:[^"]|"")*$/;
/** What `GuiItemIconDumper.cleanFileName` replaces with `_`. */
const NEI_ILLEGAL = /["<>|:*?\\/\u0000-\u001f]/g;
const WHOLE_NUMBER = /^-?\d+$/;
const KEY_HASH_HEX = 16;
const REDUMP = 'Dump again with an empty search box and every collapsible group expanded, CSV and PNG in the same session.';
const REIMPORT = 'Run `npm run import-nei-icons` again.';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * RFC 4180 rows: fields separated by `,`, a field in double quotes may hold `,`, line breaks and doubled quotes
 * (`""`), records end with LF or CRLF, and a line break at the end of the text does not start an empty last row.
 * Text after a closing quote is kept as it is; a text that ends inside quotes is refused.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1;
  let quoteLine = 1;
  const endField = () => {
    row.push(field);
    field = '';
    state = 'start';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    line++;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (state === 'quoted') {
      if (c === '\n') line++;
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else state = 'closed';
    } else if (c === ',') endField();
    else if (c === '\n') endRow();
    else if (c === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (c === '"' && state === 'start') {
      state = 'quoted';
      quoteLine = line;
    } else {
      field += c;
      state = 'plain';
    }
  }
  if (state === 'quoted') throw new NeiImportError(`The CSV ends inside the quoted field that starts on line ${quoteLine}`);
  if (state !== 'start' || row.length > 0) endRow();
  return rows;
}

/** `DataDumper.concat` wraps a field in quotes (doubling its `"`) only when its first `,` or `"` is past index 0. */
function neiQuotes(value: string): boolean {
  return value.indexOf(',') > 0 || value.indexOf('"') > 0;
}

/**
 * The Display Name as NEI meant it: the quoted reading of `"…"` (inner `""` → `"`) when NEI would have quoted that
 * value, else the text as it is. NEI writes a name that starts with `"` or `,` unquoted, so `"Enderios"` stays as it is.
 */
function neiDisplay(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  if (!DOUBLED_QUOTES_ONLY.test(inner)) return raw;
  const decoded = inner.replaceAll('""', '"');
  return neiQuotes(decoded) ? decoded : raw;
}

/** One line of NEI's CSV: the text between its first four commas, then everything after the 4th; null with fewer commas. */
function splitNeiLine(line: string): [string, string, string, string, string] | null {
  const fields: string[] = [];
  let from = 0;
  for (let k = 1; k < NEI_HEADER.length; k++) {
    const comma = line.indexOf(',', from);
    if (comma < 0) return null;
    fields.push(line.slice(from, comma));
    from = comma + 1;
  }
  return [...fields, neiDisplay(line.slice(from))] as [string, string, string, string, string];
}

/**
 * The rows of NEI's `itempanel.csv` (`DataDumper.concat`'s format, not RFC 4180): one line per row, LF or CRLF; the
 * first four fields never hold `,` or `"`, and the Display Name is everything after the 4th comma (see `neiDisplay`).
 * The header must be `NEI_HEADER`. `Item ID` is world-specific and dropped.
 */
export function parseNeiCsv(text: string): NeiRow[] {
  const lines = (text.startsWith('\uFEFF') ? text.slice(1) : text).split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const [headerLine, ...body] = lines;
  const header = headerLine === undefined ? null : splitNeiLine(headerLine);
  if (header === null || header.some((cell, i) => cell !== NEI_HEADER[i])) {
    throw new NeiImportError(`The CSV header is ${JSON.stringify(headerLine ?? '')}, expected ${JSON.stringify(NEI_HEADER.join(','))}: `
      + 'not an NEI item panel dump (NEI options → Tools → Data Dumps → Item Panel, CSV mode)');
  }
  return body.map((line, i) => {
    const where = `CSV row ${i + 1}`;
    const fields = splitNeiLine(line);
    if (fields === null) throw new NeiImportError(`${where} has ${line.split(',').length} fields, expected ${NEI_HEADER.length}`);
    const quoted = fields.slice(0, -1).findIndex((field) => field.includes('"'));
    if (quoted >= 0) {
      throw new NeiImportError(`${where}: "${NEI_HEADER[quoted]}" is ${JSON.stringify(fields[quoted])}, but NEI never quotes it: `
        + 'not an NEI item panel dump');
    }
    const [name, , metaText, nbt, display] = fields;
    const meta = Number(metaText);
    if (!WHOLE_NUMBER.test(metaText) || !Number.isSafeInteger(meta)) {
      throw new NeiImportError(`${where}: "Item meta" is ${JSON.stringify(metaText)}, not a whole number`);
    }
    if (nbt !== 'true' && nbt !== 'false') throw new NeiImportError(`${where}: "Has NBT" is ${JSON.stringify(nbt)}, expected true or false`);
    return { name, meta, hasNbt: nbt === 'true', display };
  });
}

/** NEI's `cleanFileName`: `" < > | : * ? \ /` and the control characters U+0000–U+001F become `_`. */
export function neiFileBase(display: string): string {
  return display.replace(NEI_ILLEGAL, '_');
}

/**
 * The PNG file NEI wrote for each row: `<base>.png`, or when that name is taken `<base>_2.png`, `<base>_3.png`, … (the
 * first free one), row by row. On a case-insensitive disk names that differ only in case are taken too.
 */
export function assignNeiFiles(rows: readonly NeiRow[], caseInsensitive: boolean): string[] {
  const taken = new Set<string>();
  const seen = caseInsensitive ? (file: string) => file.toLowerCase() : (file: string) => file;
  return rows.map((row) => {
    const base = neiFileBase(row.display);
    let file = `${base}.png`;
    for (let n = 2; taken.has(seen(file)); n++) file = `${base}_${n}.png`;
    taken.add(seen(file));
    return file;
  });
}

export interface NeiImportResult { rows: number; imported: number; skippedNbt: number; fluids: number; duplicates: number; caseInsensitive: boolean }

async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    throw new NeiImportError(`Cannot read ${what} ${file}: ${messageOf(err)}`, { cause: err });
  }
}

/** The `*.png` file names in the folder, exactly as the disk lists them. */
async function listPngs(pngDir: string): Promise<Set<string>> {
  let entries: Dirent[];
  try {
    entries = await readdir(pngDir, { withFileTypes: true });
  } catch (err) {
    throw new NeiImportError(`Cannot read the PNG folder ${pngDir}: ${messageOf(err)}`, { cause: err });
  }
  return new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.png')).map((e) => e.name));
}

/** Display name → the key of the one fluid with that name; null when two or more fluids share the name. */
function fluidsByName(fluids: Iterable<{ key: FluidKey; name: string }>): Map<string, FluidKey | null> {
  const byName = new Map<string, FluidKey | null>();
  for (const { key, name } of fluids) {
    const seen = byName.get(name);
    if (seen === undefined) byName.set(name, key);
    else if (seen !== key) byName.set(name, null);
  }
  return byName;
}

interface Assignment { files: string[]; caseInsensitive: boolean; firstMiss: number /* -1 when every file is listed */; found: number }

/** A file counts only when the listing holds that exact name (see `matchFiles`). */
function assignment(rows: readonly NeiRow[], pngs: ReadonlySet<string>, caseInsensitive: boolean): Assignment {
  const files = assignNeiFiles(rows, caseInsensitive);
  return { files, caseInsensitive, firstMiss: files.findIndex((f) => !pngs.has(f)), found: files.filter((f) => pngs.has(f)).length };
}

/**
 * The case-sensitive assignment when every file it names is listed, else the case-insensitive one; otherwise the
 * first row that the one finding more files misses (the case-sensitive one on a tie). Names are compared with the
 * folder listing, never looked up on disk: on a case-insensitive disk a lookup would also find a file whose name
 * differs in case, and accept the wrong assignment.
 */
function matchFiles(rows: readonly NeiRow[], pngs: ReadonlySet<string>, pngDir: string): Assignment {
  const sensitive = assignment(rows, pngs, false);
  if (sensitive.firstMiss < 0) return sensitive;
  const insensitive = assignment(rows, pngs, true);
  if (insensitive.firstMiss < 0) return insensitive;
  const better = insensitive.found > sensitive.found ? insensitive : sensitive;
  const row = rows[better.firstMiss]!;
  throw new NeiImportError(`Row ${better.firstMiss + 1} (${row.name}@${row.meta} "${row.display}") expects `
    + `"${better.files[better.firstMiss]}", which is not in ${pngDir}. ${REDUMP}`);
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

/** Renames the previous `nei/` away, the complete staging folder in, then removes the previous one. */
async function swapIn(assetsDir: string, staging: string): Promise<void> {
  const live = join(assetsDir, NEI_DIR);
  const old = join(assetsDir, `${NEI_DIR}.old-${Date.now()}`);
  let movedOld = false;
  try {
    if (await present(live)) {
      await rename(live, old);
      movedOld = true;
    }
    await rename(staging, live);
  } catch (err) {
    let tail = '';
    if (movedOld) {
      try {
        await rename(old, live);
      } catch (undoErr) {
        tail = ` (could not rename ${old} back to ${live}: ${messageOf(undoErr)})`;
      }
    }
    if (tail === '') {
      const left = await removeTree(staging);
      if (left !== null) tail = ` (could not remove ${staging}: ${left})`;
    }
    throw new NeiImportError(`Could not put the new NEI icons in place: ${messageOf(err)}${tail}`, { cause: err });
  }
  // The new folder is in place; a previous one that cannot be removed only costs disk space.
  await removeTree(old);
}

/**
 * Joins an NEI item-panel dump to keys and installs its icons under `<dataDir>/assets/nei/`. A row without NBT gets
 * `<name>@<meta>`; a `NotEnoughItems:neiFluidDisplay` row gets the key of the one fluid in `fluids` whose name equals
 * its Display Name; every other row is skipped (`skippedNbt`). The dump is checked completely (CSV, PNG count, every
 * row's file) before anything is written; the icons and `index.json` go to `<dataDir>/assets/nei.staging-<ms>/`, which
 * replaces `nei/` only once it is complete.
 */
export async function importNeiIcons(opts: {
  csv: string /* file */; fluids?: Iterable<{ key: FluidKey; name: string }> | null; pngDir: string; dataDir: string; now?: () => Date;
}): Promise<NeiImportResult> {
  const rows = parseNeiCsv(await readText(opts.csv, 'the CSV'));
  const fluidOf = fluidsByName(opts.fluids ?? []);
  const pngs = await listPngs(opts.pngDir);
  if (pngs.size !== rows.length) throw new NeiImportError(`The CSV has ${rows.length} rows but ${opts.pngDir} has ${pngs.size} PNGs. ${REDUMP}`);
  const { files, caseInsensitive } = matchFiles(rows, pngs, opts.pngDir);

  const icons = new Map<StuffKey, string>();
  const copies: Array<{ from: string; to: string }> = [];
  let skippedNbt = 0;
  let fluidIcons = 0;
  let duplicates = 0;
  for (const [i, row] of rows.entries()) {
    // A fluid row's meta is the dump world's fluid id, so it never gets an item key.
    const isFluid = row.name === FLUID_DISPLAY;
    const fluid = isFluid ? (fluidOf.get(row.display) ?? null) : null;
    if (isFluid ? fluid === null : row.hasNbt) {
      skippedNbt++;
      continue;
    }
    const key: StuffKey = fluid ?? `${row.name}@${row.meta}`;
    if (icons.has(key)) {
      duplicates++;
      continue;
    }
    const file = `${createHash('sha1').update(key).digest('hex').slice(0, KEY_HASH_HEX)}.png`;
    icons.set(key, `${NEI_DIR}/${ICONS_DIR}/${file}`);
    copies.push({ from: files[i]!, to: file });
    if (fluid !== null) fluidIcons++;
  }

  const assetsDir = join(opts.dataDir, 'assets');
  const staging = join(assetsDir, `${NEI_DIR}.staging-${Date.now()}`);
  try {
    await mkdir(assetsDir, { recursive: true });
    await mkdir(staging);
  } catch (err) {
    throw new NeiImportError(`Could not create ${staging}: ${messageOf(err)}`, { cause: err });
  }
  try {
    await mkdir(join(staging, ICONS_DIR));
    for (const { from, to } of copies) await copyFile(join(opts.pngDir, from), join(staging, ICONS_DIR, to));
    const index: NeiIndexFile = {
      format: NEI_INDEX_FORMAT,
      importedAt: (opts.now ?? (() => new Date()))().toISOString(),
      rows: rows.length,
      icons: Object.fromEntries(icons),
    };
    await writeFile(join(staging, NEI_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  } catch (err) {
    const left = await removeTree(staging);
    const tail = left === null ? '' : ` (could not remove ${staging}: ${left})`;
    throw new NeiImportError(`Could not copy the NEI icons: ${messageOf(err)}${tail}`, { cause: err });
  }
  await swapIn(assetsDir, staging);
  return { rows: rows.length, imported: icons.size, skippedNbt, fluids: fluidIcons, duplicates, caseInsensitive };
}

export interface NeiIndex extends IconSource { readonly size: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The imported icons in `<assetsDir>/nei/index.json`; null when there is no import. */
export async function loadNeiIndex(assetsDir: string): Promise<NeiIndex | null> {
  const file = join(assetsDir, NEI_DIR, NEI_INDEX_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
    throw new NeiImportError(`${file}: cannot read the NEI icon index: ${messageOf(err)}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new NeiImportError(`${file}: not valid JSON (${messageOf(err)}). ${REIMPORT}`, { cause: err });
  }
  if (!isPlainObject(parsed) || parsed.format !== NEI_INDEX_FORMAT) {
    const format = isPlainObject(parsed) ? JSON.stringify(parsed.format) : 'none';
    throw new NeiImportError(`${file}: format ${format}, expected "${NEI_INDEX_FORMAT}". ${REIMPORT}`);
  }
  const { icons } = parsed;
  if (!isPlainObject(icons) || Object.values(icons).some((path) => typeof path !== 'string')) {
    throw new NeiImportError(`${file}: "icons" must map keys to paths. ${REIMPORT}`);
  }
  const paths = new Map(Object.entries(icons as Record<StuffKey, string>));
  return {
    size: paths.size,
    icon(key: StuffKey): TextureLayer | null {
      const path = paths.get(key);
      return path === undefined ? null : { path };
    },
  };
}
