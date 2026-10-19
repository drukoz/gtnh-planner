// Optional NEI item-panel icon import (Task 11, research §6.5.1, Rulings R16 and R17). NEI's "Item Panel" data dump,
// taken by hand in a copy of the client instance, writes `itempanel.csv` and `itempanel_icons/<display name>.png`
// from the same item list, in the same order. This module joins them by row order, replaying NEI's CSV and file-name
// rules (leaving without an icon the few rows whose item changed its name at random between the two dumps), keys
// fluid rows by their display name against the pack's fluids, and copies each icon to
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
/** How many rows may miss their PNG because their item changed its name: 10, or one per 1000 rows when that is more. */
const RENAMED_MIN = 10;
const ROWS_PER_RENAMED = 1000;
/** NEI's `_2`, `_3`, … at the end of a file name without `.png`. */
const COLLISION_SUFFIX = /_(?:[2-9]|[1-9]\d+)$/;
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

export interface NeiImportResult {
  rows: number; imported: number; skippedNbt: number; fluids: number; duplicates: number; caseInsensitive: boolean;
  /** The rows left without an icon because their item changed its name before the PNG dump; empty when every row matched. */
  unmatched: Array<{ row: number /* 1-based */; key: string /* name@meta */; display: string /* as in the CSV */ }>;
}

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

/** Each row's PNG file name, and the rows (from 0, in order) whose file is not in the folder. */
export interface NeiMatch { files: string[]; caseInsensitive: boolean; missing: number[] }

/** A file counts only when the listing holds that exact name (see `matchNeiFiles`). */
function assignment(rows: readonly NeiRow[], pngs: ReadonlySet<string>, caseInsensitive: boolean): NeiMatch {
  const files = assignNeiFiles(rows, caseInsensitive);
  return { files, caseInsensitive, missing: files.flatMap((file, i) => (pngs.has(file) ? [] : [i])) };
}

/** Why the rows that miss their file cannot all be items that changed their name (see `matchNeiFiles`), else null. */
function whyRefused(rows: readonly NeiRow[], pngs: ReadonlySet<string>, match: NeiMatch): string | null {
  const { files, caseInsensitive, missing } = match;
  const most = Math.max(RENAMED_MIN, Math.floor(rows.length / ROWS_PER_RENAMED));
  if (missing.length > most) return `${missing.length} rows have no PNG; items that change their name at random explain at most ${most}.`;
  const assigned = new Set(files);
  const orphans = [...pngs].filter((file) => !assigned.has(file)).sort();
  if (orphans.length !== missing.length) return `${missing.length} rows have no PNG but ${orphans.length} PNGs belong to no row.`;
  const fold = caseInsensitive ? (base: string) => base.toLowerCase() : (base: string) => base;
  const firstRow = new Map<string, number>();   // folded file base → the first row with it
  const shared = new Set<string>();             // folded file bases of two or more rows
  for (const [i, row] of rows.entries()) {
    const base = fold(neiFileBase(row.display));
    if (firstRow.has(base)) shared.add(base);
    else firstRow.set(base, i);
  }
  const ambiguous = (why: string) => `The names are ambiguous: ${why}, so NEI's _2, _3 numbering may have shifted.`;
  for (const i of missing) {
    const base = neiFileBase(rows[i]!.display);
    if (shared.has(fold(base)) || files[i] !== `${base}.png`) return ambiguous(`row ${i + 1} shares its file name with another row`);
  }
  for (const orphan of orphans) {
    const row = firstRow.get(fold(orphan.slice(0, -'.png'.length).replace(COLLISION_SUFFIX, '')));
    if (row !== undefined) return ambiguous(`"${orphan}" belongs to no row but is named like row ${row + 1}`);
  }
  return null;
}

/**
 * Each row's PNG file: the case-sensitive assignment when every file it names is listed, else whichever of the two
 * finds more files (the case-sensitive one on a tie). Names are compared with the folder listing, never looked up on
 * disk: on a case-insensitive disk a lookup would also find a file whose name differs in case, and accept the wrong
 * assignment.
 *
 * Some items pick a display name at random each time they are drawn (Extra Utilities' QED, Dreamcraft's oven gloves),
 * so the PNG dump, taken a few seconds after the CSV one, can hold their icon under a name that no row expects. The
 * rows that miss their file are accepted as such items (`missing`) when (a) there are at most max(10, rows / 1000) of
 * them, (b) as many listed files belong to no row, and (c) the names are not ambiguous: each missing row is the only
 * row with its file base (compared case-insensitively for the case-insensitive assignment) and expects
 * `<base>.png`, not a number after another row's file; and no file that belongs to no row has, without `.png` and a
 * `_<n>` suffix, the base of a row. Otherwise a changed name may have moved NEI's `_2`, `_3` numbering, so that a row
 * would get another row's icon, and the dump is refused, naming the first missing row.
 */
export function matchNeiFiles(rows: readonly NeiRow[], pngs: ReadonlySet<string>, pngDir: string): NeiMatch {
  const sensitive = assignment(rows, pngs, false);
  if (sensitive.missing.length === 0) return sensitive;
  const insensitive = assignment(rows, pngs, true);
  const match = insensitive.missing.length < sensitive.missing.length ? insensitive : sensitive;
  const refused = match.missing.length === 0 ? null : whyRefused(rows, pngs, match);
  if (refused === null) return match;
  const first = match.missing[0]!;
  const row = rows[first]!;
  throw new NeiImportError(`Row ${first + 1} (${row.name}@${row.meta} "${row.display}") expects "${match.files[first]}", `
    + `which is not in ${pngDir}. ${refused} ${REDUMP}`);
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
 * its Display Name; every other row is skipped (`skippedNbt`). A row that misses its file because its item changed its
 * name before the PNG dump (see `matchNeiFiles`) gets no icon and is listed in `unmatched`. The dump is checked
 * completely (CSV, PNG count, every row's file) before anything is written; the icons and `index.json` go to
 * `<dataDir>/assets/nei.staging-<ms>/`, which replaces `nei/` only once it is complete.
 */
export async function importNeiIcons(opts: {
  csv: string /* file */; fluids?: Iterable<{ key: FluidKey; name: string }> | null; pngDir: string; dataDir: string; now?: () => Date;
}): Promise<NeiImportResult> {
  const rows = parseNeiCsv(await readText(opts.csv, 'the CSV'));
  const fluidOf = fluidsByName(opts.fluids ?? []);
  const pngs = await listPngs(opts.pngDir);
  if (pngs.size !== rows.length) throw new NeiImportError(`The CSV has ${rows.length} rows but ${opts.pngDir} has ${pngs.size} PNGs. ${REDUMP}`);
  const { files, caseInsensitive, missing } = matchNeiFiles(rows, pngs, opts.pngDir);
  const unmatched = new Set(missing);

  const icons = new Map<StuffKey, string>();
  const copies: Array<{ from: string; to: string }> = [];
  let skippedNbt = 0;
  let fluidIcons = 0;
  let duplicates = 0;
  for (const [i, row] of rows.entries()) {
    // NEI wrote this row's icon under the item's new name, a file that no row is given (see `matchNeiFiles`).
    if (unmatched.has(i)) continue;
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
  return {
    rows: rows.length, imported: icons.size, skippedNbt, fluids: fluidIcons, duplicates, caseInsensitive,
    unmatched: missing.map((i) => ({ row: i + 1, key: `${rows[i]!.name}@${rows[i]!.meta}`, display: rows[i]!.display })),
  };
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
