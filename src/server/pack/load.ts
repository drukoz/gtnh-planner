// The pack loader (architecture §6.2 server API): streams an export into the in-memory `Pack`.
//
// Files are read in this order, so every reference resolves: manifest → items → fluids → fluid containers → ore
// dictionary → recipe maps → recipes (GT, assembly line, crafting, furnace) → machines → structures → the optional crop
// table; then the electric furnace and microwave recipes are derived from the smelting list, the supply recipes of the
// free inputs from the rock breaker's display recipes, the pumps and the compressor (supply.ts), and the indices built;
// then GT materials and ore materials; and last the nine worldgen files, because capability yields need the items'
// materials. Files are never read into one string; `readJsonl` streams them line by line. Structural damage (bad gzip,
// bad JSON, a line count that differs from the manifest, an index that points nowhere) fails with the file and line
// instead of returning a half-loaded pack; recoverable oddities become `pack.warnings`, and so does an item the crop
// table names but the loader cannot resolve (crops.ts). The crop table's inline items join `pack.items` after every item
// line, as crop items that no wildcard, ore name or recipe of the export ever sees (crops.ts).

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { fluidKey, itemKey, type FluidKey, type ItemKey } from '../../shared/keys.ts';
import type { Fluid, Item, Pack, PackManifest, RecipeMapInfo } from '../../shared/types/pack.ts';
import { cropTable } from './crops.ts';
import {
  EXPORT_FILES, EXPORT_FORMAT, OPTIONAL_EXPORT_FILES,
  type ExportFileKey, type ExportLineTypes, type ItemLine, type ManifestFile, type RecipeMapLine,
} from './format.ts';
import { buildIndices, buildMachinesByMap, deriveFurnaceRecipes } from './indices.ts';
import { PSEUDO_MACHINE_ENTRIES, toMachine, toStructure } from './machines.ts';
import { aliasesOf, normalizeMapId } from './map-aliases.ts';
import { buildMaterials } from './materials.ts';
import { nbtHash } from './recipe-id.ts';
import { assemblyLineRecipe, craftingRecipe, furnaceEntry, furnaceRecipe, gtRecipe, RecipeCollector, type FurnaceEntry } from './recipes.ts';
import { deriveSupply } from './supply.ts';
import { buildWorldgen, type WorldgenInput } from './worldgen.ts';

/** Minecraft's OreDictionary.WILDCARD_VALUE: "any meta". Expanded here, never part of a key (architecture §5). */
const WILDCARD_META = 32767;
/** GT's M: material units in one dust or ingot, the default `gtAmt`. */
const GT_M = 3628800;
const MANIFEST = EXPORT_FILES.manifest;
const FILE_KEYS = Object.keys(EXPORT_FILES).filter((k): k is ExportFileKey => k !== 'manifest');
const MANIFEST_STRINGS = ['exportId', 'exporterVersion', 'exportedAt', 'packVersion', 'gtVersion'] as const;

/** A structurally broken export: `file` is the file name inside the export directory, `line` is 1-based, 0 = the whole file. */
export class ExportFormatError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(file: string, line: number, reason: string, options?: ErrorOptions) {
    super(`${file}:${line}: ${reason}`, options);
    this.name = 'ExportFormatError';
    this.file = file;
    this.line = line;
  }
}

/** Where `buildPack` reads an export from: a directory (`dirSource`) or line arrays in memory (`memorySource`). */
export interface ExportSource {
  readonly manifest: ManifestFile;
  has(file: ExportFileKey): boolean;
  /** The lines of `file` numbered from 1; nothing for a file the source does not have. */
  lines<K extends ExportFileKey>(file: K): AsyncIterable<{ line: number; value: ExportLineTypes[K] }>;
}

/** What the converters of recipes, machines, materials and worldgen receive to turn their lines into pack entries. */
export interface LoadContext {
  readonly items: ItemRefs;
  readonly mapsByIndex: ReadonlyMap<number, RecipeMapInfo>;
  readonly oreDict: ReadonlyMap<string, ItemKey[]>;
  warn(message: string): void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(err: unknown): boolean {
  return isPlainObject(err) && err.code === 'ENOENT';
}

/**
 * The JSON values of a gzip'd JSON Lines file with their 1-based line numbers. Bad JSON fails with its line; a gzip or
 * read error (a truncated or non-gzip file) fails with line 0.
 */
export async function* readJsonl(path: string): AsyncGenerator<{ line: number; value: unknown }> {
  const file = basename(path);
  const gunzip = createGunzip();
  pipeline(createReadStream(path), gunzip, () => {});   // an error of either stream reaches the reader through gunzip
  const reader = createInterface({ input: gunzip, crlfDelay: Infinity });
  let line = 0;
  try {
    for await (const text of reader) {
      line += 1;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (err) {
        throw new ExportFormatError(file, line, `invalid JSON: ${messageOf(err)}`);
      }
      yield { line, value };
    }
  } catch (err) {
    if (err instanceof ExportFormatError) throw err;
    throw new ExportFormatError(file, 0, `unreadable after line ${line}: ${messageOf(err)}`, { cause: err });
  } finally {
    reader.close();
    gunzip.destroy();   // also ends the pipeline, which closes the file
  }
}

function checkManifest(value: unknown): ManifestFile {
  const fail = (reason: string) => new ExportFormatError(MANIFEST, 0, reason);
  if (!isPlainObject(value)) throw fail('expected a JSON object');
  if (value.format !== EXPORT_FORMAT) throw fail(`format is ${JSON.stringify(value.format)}, this loader reads ${EXPORT_FORMAT}`);
  for (const field of MANIFEST_STRINGS) if (typeof value[field] !== 'string') throw fail(`${field} is not a string`);
  if (!isPlainObject(value.mods)) throw fail('mods is not an object');
  const counts = value.counts;
  if (!isPlainObject(counts) || !Object.values(counts).every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) {
    throw fail('counts is not an object of line counts');
  }
  return value as unknown as ManifestFile;
}

async function readManifest(dir: string): Promise<ManifestFile> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST), 'utf8');
  } catch (err) {
    throw new ExportFormatError(MANIFEST, 0, isMissing(err) ? `missing, ${dir} is not an export directory` : `unreadable: ${messageOf(err)}`, { cause: err });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new ExportFormatError(MANIFEST, 0, `invalid JSON: ${messageOf(err)}`);
  }
  return checkManifest(value);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

/** Every line must be a JSON object; after the last one the count is checked against the manifest when it has one. */
async function* dirLines<K extends ExportFileKey>(path: string, expected: number | undefined): AsyncGenerator<{ line: number; value: ExportLineTypes[K] }> {
  const file = basename(path);
  let count = 0;
  for await (const { line, value } of readJsonl(path)) {
    if (!isPlainObject(value)) throw new ExportFormatError(file, line, 'expected a JSON object');
    count = line;
    yield { line, value: value as unknown as ExportLineTypes[K] };
  }
  if (expected !== undefined && count !== expected) {
    throw new ExportFormatError(file, 0, `has ${count} lines, but the manifest says ${expected} lines`);
  }
}

async function* arrayLines<T>(values: readonly T[]): AsyncGenerator<{ line: number; value: T }> {
  let line = 0;
  for (const value of values) yield { line: ++line, value };
}

/**
 * An export directory: `manifest.json` must name `EXPORT_FORMAT`, and every file of `EXPORT_FILES` except
 * `OPTIONAL_EXPORT_FILES` must exist (an absent optional file reads as no lines).
 */
export async function dirSource(dir: string): Promise<ExportSource> {
  const manifest = await readManifest(dir);
  const present = new Set<ExportFileKey>();
  for (const key of FILE_KEYS) {
    if (await isFile(join(dir, EXPORT_FILES[key]))) present.add(key);
    else if (!OPTIONAL_EXPORT_FILES.includes(key)) throw new ExportFormatError(EXPORT_FILES[key], 0, 'required file is missing');
  }
  return {
    manifest,
    has: (file) => present.has(file),
    lines: <K extends ExportFileKey>(file: K) =>
      present.has(file) ? dirLines<K>(join(dir, EXPORT_FILES[file]), manifest.counts[file]) : arrayLines<ExportLineTypes[K]>([]),
  };
}

/** Line arrays in memory (`makePack`); an absent file reads as no lines, and the manifest counts are not checked. */
export function memorySource(manifest: ManifestFile, files: Partial<{ [K in ExportFileKey]: ExportLineTypes[K][] }>): ExportSource {
  return {
    manifest,
    has: (file) => files[file] !== undefined,
    lines: <K extends ExportFileKey>(file: K) => arrayLines<ExportLineTypes[K]>(files[file] ?? []),
  };
}

/** Item line index → item key, with wildcard lines (meta 32767) expanded into the variants the export knows. */
export class ItemRefs {
  readonly #ids: string[] = [];
  readonly #keys: Array<ItemKey | null> = [];
  /** id → meta → key of every NBT-free concrete item seen. */
  readonly #variants = new Map<string, Map<number, ItemKey>>();
  /** id → the options of its wildcard, once asked for. */
  readonly #wildcards = new Map<string, readonly ItemKey[]>();
  readonly #warn: (message: string) => void;

  constructor(warn: (message: string) => void) {
    this.#warn = warn;
  }

  get size(): number {
    return this.#ids.length;
  }

  /** Registers the next line of items.jsonl.gz (its `i` must be its position); returns its key, null for a wildcard. */
  add(line: ItemLine): ItemKey | null {
    if (line.i !== this.size) throw new Error(`item line says i=${line.i}, but it is item ${this.size}`);
    if (typeof line.id !== 'string' || line.id === '') throw new Error('item line has no id');
    const key = line.m === WILDCARD_META ? null : itemKey(line.id, line.m, line.nbt ? nbtHash(line.nbt) : undefined);
    this.#ids.push(line.id);
    this.#keys.push(key);
    if (key !== null && !line.nbt) {
      let metas = this.#variants.get(line.id);
      if (metas === undefined) this.#variants.set(line.id, (metas = new Map()));
      if (!metas.has(line.m)) metas.set(line.m, key);
      this.#wildcards.delete(line.id);
    }
    return key;
  }

  /** Whether `i` is the index of an item line. */
  has(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < this.size;
  }

  #check(i: number): number {
    if (!this.has(i)) throw new RangeError(`unknown item index ${i}`);
    return i;
  }

  /** The key of item `i`, null for a wildcard. */
  keyAt(i: number): ItemKey | null {
    return this.#keys[this.#check(i)] as ItemKey | null;
  }

  idAt(i: number): string {
    return this.#ids[this.#check(i)] as string;
  }

  /**
   * `[key]` for a concrete item; for a wildcard every NBT-free variant of the same id sorted by meta, or `[id@0]`
   * (with one warning per id) when the export knows none.
   */
  optionsAt(i: number): ItemKey[] {
    const key = this.keyAt(i);
    if (key !== null) return [key];
    const id = this.#ids[i] as string;
    let options = this.#wildcards.get(id);
    if (options === undefined) {
      const metas = this.#variants.get(id);
      if (metas !== undefined) {
        options = [...metas].sort(([a], [b]) => a - b).map(([, variant]) => variant);
      } else {
        options = [itemKey(id, 0)];
        this.#warn(`wildcard ${id}@${WILDCARD_META} has no known variant, using ${options[0]}`);
      }
      this.#wildcards.set(id, options);
    }
    return [...options];
  }
}

/** The kind of `RecipeMapInfo.specialValue`, from the simple class name of the map's formatter (export-mod.md §2.7). */
export function specialValueKind(svFormatter?: string, svKey?: string): RecipeMapInfo['specialValue'] {
  if (!svFormatter) return 'none';
  switch (svFormatter.slice(Math.max(svFormatter.lastIndexOf('.'), svFormatter.lastIndexOf('$')) + 1)) {
    case 'HeatingCoilSpecialValueFormatter': return 'heat';
    case 'FusionSpecialValueFormatter': return 'fusion';
    case 'FuelSpecialValueFormatter': return 'fuel';
    case 'SimpleSpecialValueFormatter': return svKey === 'GT5U.nei.tier' ? 'tier' : 'none';
    default: return 'none';
  }
}

function pseudoMap(id: string, name: string): RecipeMapInfo {
  return Object.freeze({ id, name, amps: 0, specialValue: 'none', aliases: [] });
}

/** The maps of recipes that no GT map holds (architecture §5); the pack gets its own copies. */
export const PSEUDO_MAPS: readonly RecipeMapInfo[] = Object.freeze([
  pseudoMap('crafting', 'Crafting Table'),
  pseudoMap('furnace', 'Vanilla Furnace'),
  pseudoMap('assemblyline', 'Assembly Line (data stick)'),
]);

type LoadingPack = Pack & Required<Pick<Pack, 'fluidContainers' | 'warnings'>>;

/** What `buildPack` carries from one file to the next. Private to this module; later readers add their own fields. */
interface LoadState {
  readonly src: ExportSource;
  readonly pack: LoadingPack;
  readonly mapsByIndex: Map<number, RecipeMapInfo>;
  readonly ctx: LoadContext;
  /** Every recipe read so far, merged by id; `setRecipes` puts the list into the pack. */
  readonly recipes: RecipeCollector;
  /** The smelting entries, kept for the electric furnace and microwave recipes derived from them. */
  readonly furnace: FurnaceEntry[];
}

function toPackManifest(m: ManifestFile): PackManifest {
  return {
    format: m.format, exportId: m.exportId, exporterVersion: m.exporterVersion, exportedAt: m.exportedAt,
    packVersion: m.packVersion, gtVersion: m.gtVersion, mods: { ...m.mods },
    counts: Object.fromEntries(Object.entries(m.counts).filter((e): e is [string, number] => e[1] !== undefined)),
    nameFailures: m.nameFailures, nameFailureSamples: m.nameFailureSamples, sectionMillis: m.sectionMillis,
    failedSections: m.failedSections, skippedSections: m.skippedSections, warnings: m.warnings,
  };
}

function newLoadState(src: ExportSource): LoadState {
  const items = new Map<ItemKey, Item>();
  const fluids = new Map<FluidKey, Fluid>();
  const pack: LoadingPack = {
    manifest: toPackManifest(src.manifest),
    items, fluids, oreDict: new Map(), maps: new Map(), recipes: [], recipeById: new Map(),
    producers: new Map(), consumers: new Map(), machines: new Map(), machinesByMap: new Map(), materials: new Map(),
    worldgen: { dimensions: [], veins: [], fluidSources: [], capabilities: [], byproducts: {} },
    nameOf: (key) => items.get(key)?.name ?? fluids.get(key)?.name ?? key,
    fluidContainers: [], warnings: [],
  };
  const warn = (message: string): void => {
    pack.warnings.push(message);
  };
  const mapsByIndex = new Map<number, RecipeMapInfo>();
  return {
    src, pack, mapsByIndex, ctx: { items: new ItemRefs(warn), mapsByIndex, oreDict: pack.oreDict, warn },
    recipes: new RecipeCollector(), furnace: [],
  };
}

/** Calls `fn` for every line of `file`; whatever it throws becomes an `ExportFormatError` with the file and line. */
async function eachLine<K extends ExportFileKey>(src: ExportSource, file: K, fn: (value: ExportLineTypes[K], line: number) => void): Promise<void> {
  for await (const { line, value } of src.lines(file)) {
    try {
      fn(value, line);
    } catch (err) {
      throw err instanceof ExportFormatError ? err : new ExportFormatError(EXPORT_FILES[file], line, messageOf(err), { cause: err });
    }
  }
}

function toItem(line: ItemLine, key: ItemKey): Item {
  const item: Item = { key, id: line.id, meta: line.m, name: line.dn || line.un || key, oreDict: line.od ? [...line.od] : [] };
  if (line.nbt) item.nbt = line.nbt;
  if (line.gtPrefix && line.gtMat) item.gt = { prefix: line.gtPrefix, material: line.gtMat, amount: line.gtAmt ?? GT_M };
  if (line.electric) {
    const { maxCharge, tier, canProvideEnergy } = line.electric;
    item.electric = { maxCharge, tier, canProvideEnergy };
  }
  return item;
}

async function readItems({ src, pack, ctx }: LoadState): Promise<void> {
  await eachLine(src, 'items', (line, n) => {
    const key = ctx.items.add(line);
    if (key === null) return;   // a wildcard is never an Item
    if (pack.items.has(key)) ctx.warn(`${EXPORT_FILES.items}:${n}: duplicate item key ${key} ignored, the first line wins`);
    else pack.items.set(key, toItem(line, key));
  });
}

async function readFluids({ src, pack, ctx }: LoadState): Promise<void> {
  await eachLine(src, 'fluids', (line, n) => {
    if (typeof line.id !== 'string' || line.id === '') throw new Error('fluid line has no id');
    const key = fluidKey(line.id);
    if (pack.fluids.has(key)) {
      ctx.warn(`${EXPORT_FILES.fluids}:${n}: duplicate fluid ${key} ignored, the first line wins`);
      return;
    }
    pack.fluids.set(key, {
      key, id: line.id, name: line.dn || line.un || line.id, temperature: line.temp, gas: line.gas === true, molten: line.id.startsWith('molten.'),
    });
  });
}

/** A concrete item's key, or a wildcard's first option (as for recipe outputs). */
function singleKeyAt(items: ItemRefs, i: number): ItemKey {
  return items.optionsAt(i)[0] as ItemKey;
}

async function readFluidContainers({ src, pack, ctx }: LoadState): Promise<void> {
  await eachLine(src, 'fluidContainers', (line) => {
    pack.fluidContainers.push({
      container: singleKeyAt(ctx.items, line.container),
      empty: line.empty == null ? null : singleKeyAt(ctx.items, line.empty),
      fluid: fluidKey(line.fluid),
      amount: line.amount,
    });
  });
}

async function readOreDict({ src, pack, ctx }: LoadState): Promise<void> {
  const byOre = new Map<string, Set<ItemKey>>();
  await eachLine(src, 'oreDict', (line) => {
    let keys = byOre.get(line.ore);
    if (keys === undefined) byOre.set(line.ore, (keys = new Set()));
    for (const i of line.items) for (const key of ctx.items.optionsAt(i)) keys.add(key);
  });
  for (const [ore, keys] of byOre) pack.oreDict.set(ore, [...keys]);
}

function toMapInfo(id: string, line: RecipeMapLine, catalysts: ItemKey[] | undefined): RecipeMapInfo {
  const info: RecipeMapInfo = {
    id, name: line.dn || line.id, amps: line.amps, specialValue: specialValueKind(line.svFormatter, line.svKey), aliases: [], recipeCount: line.recipes,
  };
  if (line.dynamic) info.dynamic = line.dynamic;
  if (line.cats) info.categories = [...new Set(line.cats)];
  if (catalysts) info.catalystItems = [...new Set(catalysts)];
  return info;
}

/** A second raw map with the same normalized id: the first line's name, amps and kinds stay; lists unite, counts add up. */
function mergeMapInfo(info: RecipeMapInfo, line: RecipeMapLine, catalysts: ItemKey[] | undefined): void {
  info.recipeCount = (info.recipeCount ?? 0) + line.recipes;
  if (line.cats) info.categories = [...new Set([...(info.categories ?? []), ...line.cats])];
  if (catalysts) info.catalystItems = [...new Set([...(info.catalystItems ?? []), ...catalysts])];
}

async function readRecipeMaps({ src, pack, mapsByIndex, ctx }: LoadState): Promise<void> {
  const rawIds = new Map<string, string[]>();
  await eachLine(src, 'recipeMaps', (line) => {
    if (mapsByIndex.has(line.i)) throw new Error(`recipe map index ${line.i} appears twice`);
    const id = normalizeMapId(line.id);
    const catalysts = line.catalysts?.flatMap((i) => ctx.items.optionsAt(i));
    let info = pack.maps.get(id);
    if (info === undefined) pack.maps.set(id, (info = toMapInfo(id, line, catalysts)));
    else mergeMapInfo(info, line, catalysts);
    mapsByIndex.set(line.i, info);
    const seen = rawIds.get(id);
    if (seen === undefined) rawIds.set(id, [line.id]);
    else seen.push(line.id);
  });
  for (const [id, seen] of rawIds) (pack.maps.get(id) as RecipeMapInfo).aliases = aliasesOf(id, seen);
  for (const pseudo of PSEUDO_MAPS) {
    if (pack.maps.has(pseudo.id)) ctx.warn(`recipe map ${pseudo.id} of the export is replaced by the pseudo map of that id`);
    pack.maps.set(pseudo.id, { ...pseudo, aliases: [] });
  }
}

/** GT, assembly-line, crafting and furnace recipes, in that order, all through one collector. */
async function readRecipes({ src, ctx, recipes, furnace }: LoadState): Promise<void> {
  await eachLine(src, 'recipesGt', (line) => {
    const recipe = gtRecipe(line, ctx);
    if (recipe !== null) recipes.add(recipe);
  });
  await eachLine(src, 'recipesAssemblyLine', (line) => recipes.add(assemblyLineRecipe(line, ctx)));
  let withoutOutput = 0;
  await eachLine(src, 'recipesCrafting', (line) => {
    if (line.out == null) withoutOutput += 1;
    else recipes.add(craftingRecipe(line, ctx));
  });
  if (withoutOutput > 0) ctx.warn(`${EXPORT_FILES.recipesCrafting}: skipped ${withoutOutput} crafting recipe(s) without an output`);
  await eachLine(src, 'recipesFurnace', (line) => {
    const entry = furnaceEntry(line, ctx);
    furnace.push(entry);
    recipes.add(furnaceRecipe(entry));
  });
}

/** The export's machines (a duplicate id warns, the first line wins), then the pack's copies of the pseudo machines. */
async function readMachines({ src, pack, ctx }: LoadState): Promise<void> {
  await eachLine(src, 'machines', (line, n) => {
    if (pack.machines.has(line.id)) ctx.warn(`${EXPORT_FILES.machines}:${n}: duplicate machine id ${line.id} ignored, the first line wins`);
    else pack.machines.set(line.id, toMachine(line, ctx));
  });
  for (const pseudo of PSEUDO_MACHINE_ENTRIES) {
    if (pack.machines.has(pseudo.mteId)) ctx.warn(`machine ${pseudo.mteId} of the export is replaced by the pseudo machine of that id`);
    pack.machines.set(pseudo.mteId, { ...pseudo, maps: [...pseudo.maps] });
  }
}

/** Each structure goes to the machine of its id; one for an unknown machine, a second one and a truncated one warn. */
async function readStructures({ src, pack, ctx }: LoadState): Promise<void> {
  await eachLine(src, 'structures', (line, n) => {
    const machine = pack.machines.get(line.id);
    if (machine === undefined) {
      ctx.warn(`${EXPORT_FILES.structures}:${n}: structure for unknown machine ${line.id} ignored`);
      return;
    }
    if (machine.structure !== undefined) {
      ctx.warn(`${EXPORT_FILES.structures}:${n}: duplicate structure for machine ${line.id} ignored, the first line wins`);
      return;
    }
    machine.structure = toStructure(line);
    if (machine.structure.truncated) {
      ctx.warn(`machine ${line.id} (${machine.metaName}): structure truncated, a block lay on the exporter's scan box boundary, it may be incomplete`);
    }
  });
}

/**
 * The crop table becomes `pack.crops` when the export has one (exporter 0.5.0 and later, with CropsNH), and the items
 * it names inline that the item table lacks become crop items of `pack.items`, after every item line (crops.ts).
 */
async function readCrops({ src, pack, ctx }: LoadState): Promise<void> {
  if (!src.has('crops')) return;
  const { cards, items } = cropTable(await collectLines(src, 'crops'), ctx);
  pack.crops = cards;
  for (const item of items) if (!pack.items.has(item.key)) pack.items.set(item.key, item);
}

/**
 * The derived recipes, through the same collector as the others: the electric furnace and microwave recipes of the
 * smelting list, and the supply recipes (supply.ts, fix spec R2): the rock breaker's display-only recipes made real and
 * the pumps' water and lava on the pseudo map `pump`, which the pump machines get; the compressor recipe that fills an
 * empty cell with air is marked `meta.supply` with its id unchanged (ruling P20).
 */
function addDerivedRecipes({ pack, recipes, furnace, ctx }: LoadState): void {
  for (const recipe of deriveFurnaceRecipes(furnace, pack.maps)) recipes.add(recipe);
  const loaded = recipes.list();
  const supply = deriveSupply({ recipes: loaded, machines: pack.machines, maps: pack.maps, fluidContainers: pack.fluidContainers });
  for (const recipe of supply.recipes) recipes.add(recipe);
  if (supply.pumpMap !== null) {
    const map = supply.pumpMap.id;
    if (pack.maps.has(map)) ctx.warn(`recipe map ${map} of the export is replaced by the pseudo map of the pumps`);
    pack.maps.set(map, supply.pumpMap);
    for (const id of supply.pumpMachines) {
      const machine = pack.machines.get(id);
      if (machine !== undefined && !machine.maps.includes(map)) machine.maps.push(map);
    }
  }
  const flagged = new Set(supply.flagged);
  for (const recipe of loaded) if (flagged.has(recipe.id)) recipe.meta.supply = 'compressor';
}

/** The collected recipes become `pack.recipes`, and `recipeById` points at the same objects. */
function setRecipes({ pack, recipes }: LoadState): void {
  pack.recipes = recipes.list();
  for (const recipe of pack.recipes) pack.recipeById.set(recipe.id, recipe);
}

/** Producers and consumers over `pack.recipes`, and the machines of every map. */
function setIndices({ pack }: LoadState): void {
  const { producers, consumers } = buildIndices(pack.recipes);
  pack.producers = producers;
  pack.consumers = consumers;
  pack.machinesByMap = buildMachinesByMap(pack.machines);
}

/** Every line of `file` in order; `check` sees each line first and throws for a reference the export does not have. */
async function collectLines<K extends ExportFileKey>(src: ExportSource, file: K, check?: (value: ExportLineTypes[K]) => void): Promise<Array<ExportLineTypes[K]>> {
  const lines: Array<ExportLineTypes[K]> = [];
  await eachLine(src, file, (value) => {
    check?.(value);
    lines.push(value);
  });
  return lines;
}

/** Throws a RangeError for an item index the export does not have. */
function checkItemIndices(ctx: LoadContext, indices: Iterable<number>): void {
  for (const i of indices) ctx.items.keyAt(i);
}

/** GT materials and ore materials become `pack.materials`; returns the ore-material key → material name map. */
async function readMaterials({ src, pack, ctx }: LoadState): Promise<Map<string, string>> {
  const gt = await collectLines(src, 'materials');
  const ores = await collectLines(src, 'oreMaterials', (line) => checkItemIndices(ctx, Object.values(line.parts)));
  const { materials, nameOfKey } = buildMaterials(gt, ores, ctx, pack.items);
  pack.materials = materials;
  return nameOfKey;
}

/** The nine worldgen files become `pack.worldgen`; material keys resolve through `nameOfKey`. */
async function readWorldgen({ src, pack, ctx }: LoadState, nameOfKey: ReadonlyMap<string, string>): Promise<void> {
  const input: WorldgenInput = {
    dimensions: await collectLines(src, 'dimensions'),
    celestial: await collectLines(src, 'celestial'),
    veins: await collectLines(src, 'oreVeins'),
    smallOres: await collectLines(src, 'smallOres'),
    undergroundFluids: await collectLines(src, 'undergroundFluids'),
    voidMiner: await collectLines(src, 'voidMiner', (line) => checkItemIndices(ctx, [...line.drops, ...line.extra].map(({ item }) => item))),
    gasSiphon: await collectLines(src, 'gasSiphon'),
    spacePump: await collectLines(src, 'spacePump'),
    spaceAsteroids: await collectLines(src, 'spaceAsteroids', (line) => checkItemIndices(ctx, line.outputs)),
  };
  pack.worldgen = buildWorldgen(input, ctx, { materials: pack.materials, nameOfKey, items: pack.items });
}

/** Reads `src` into a Pack, file by file in the order of the header comment. */
export async function buildPack(src: ExportSource): Promise<Pack> {
  const state = newLoadState(src);
  await readItems(state);
  await readFluids(state);
  await readFluidContainers(state);
  await readOreDict(state);
  await readRecipeMaps(state);
  await readRecipes(state);
  await readMachines(state);
  await readStructures(state);
  await readCrops(state);
  addDerivedRecipes(state);
  setRecipes(state);
  setIndices(state);
  const nameOfKey = await readMaterials(state);
  await readWorldgen(state, nameOfKey);
  return state.pack;
}

/** Loads the export in `exportDir` (architecture §6.2). Throws `ExportFormatError` for a broken export. */
export async function loadPack(exportDir: string): Promise<Pack> {
  return buildPack(await dirSource(exportDir));
}
