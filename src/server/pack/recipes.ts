// Recipe converters (architecture §5, §6.2, §11.4; export-mod.md §2.3–§2.8, §4.1, §4.2, §6.2; prior-art T2–T10): the
// lines of the four recipe files become pack `Recipe`s with content-hash ids, and `RecipeCollector` merges the copies of
// one recipe that several maps hold.
//
// Item indices go through `LoadContext.items`, which throws for an index the export does not have; `buildPack` turns
// whatever a converter throws into an `ExportFormatError` with the file and line.

import { fluidKey, parseItemKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Product, Recipe } from '../../shared/types/pack.ts';
import type { AssemblyLineLine, CraftingLine, CraftingSlot, FurnaceLine, GtRecipeLine, ItemSlot, MetaValue } from './format.ts';
import type { ItemRefs, LoadContext } from './load.ts';
import { recipeId } from './recipe-id.ts';
import { withStandIns } from './stand-ins.ts';

/** GT's programmed circuit; its meta becomes `meta.circuit` when a recipe holds it as a not-consumed input. */
export const PROGRAMMED_CIRCUIT_ID = 'gregtech:gt.integrated_circuit';
/** `Ingredient.slot` of fluid input i (item inputs count from 0). */
export const FLUID_SLOT_BASE = 100;
/** A crafting slot that takes an ore name with this prefix holds a tool, which crafting damages instead of using up. */
export const TOOL_ORE_PREFIX = 'craftingTool';
/** Items that are tools whatever ore name the slot uses: a slot that only accepts these is not consumed. */
export const GT_TOOL_ITEM_IDS: readonly string[] = Object.freeze(['gregtech:gt.metatool.01']);
/** Ticks per vanilla furnace operation. */
export const VANILLA_FURNACE_TICKS = 200;
/** GT metadata identifiers → `Recipe.meta` keys; identifiers not listed here are kept as they are. */
export const META_RENAMES: Readonly<Record<string, string>> = Object.freeze({ coil_heat: 'coilHeat', low_gravity: 'lowGravity', cleanroom: 'cleanroom' });

/** GT's chance scale: 10000 = 100 % (export-mod.md §2.5). */
const CHANCE_SCALE = 10000;

type Option = Ingredient['options'][number];
/** An item or fluid slot of the wire format: `[item index | fluid name, amount, chance?]`. */
type Slot = readonly [ref: number | string, amount: number, chance?: number];
type RecipeContent = Omit<Recipe, 'id'>;

/** Option lists without a second entry of the same key and amount, first occurrence kept. */
function uniqueOptions(options: readonly Option[]): Option[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const id = `${o.amount} ${o.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function chanceOf(c: number | undefined): number {
  return (c ?? CHANCE_SCALE) / CHANCE_SCALE;
}

/** GT's rule (export-mod.md §2.4, prior-art T7): amount 0 or chance 0 = not consumed, and then the chance is 0. */
function consumption(amount: number, c: number | undefined): Pick<Ingredient, 'consumed' | 'chance'> {
  const consumed = amount > 0 && c !== 0;
  return { consumed, chance: consumed ? chanceOf(c) : 0 };
}

/** A concrete item's key, or a wildcard's first option (outputs and display references name one item). */
function firstKeyAt(items: ItemRefs, i: number): ItemKey {
  return items.optionsAt(i)[0] as ItemKey;
}

/**
 * The non-null `slots` as ingredients numbered `firstSlot + position`: the slot's own options plus those of its
 * alternatives `alts[position]`, without duplicates; consumption and chance come from the slot itself.
 */
function ingredients<S extends Slot>(
  slots: ReadonlyArray<S | null>, alts: ReadonlyArray<ReadonlyArray<S | null> | null> | undefined,
  firstSlot: number, optionsOf: (s: S) => Option[],
): Ingredient[] {
  const result: Ingredient[] = [];
  slots.forEach((s, i) => {
    if (s === null) return;
    const options = optionsOf(s);
    for (const alt of alts?.[i] ?? []) if (alt !== null) options.push(...optionsOf(alt));
    result.push({ slot: firstSlot + i, ...consumption(s[1], s[2]), options: uniqueOptions(options) });
  });
  return result;
}

/**
 * Item options of a slot: every variant of a wildcard; a not-consumed item (amount 0) still needs one. With `standIns`
 * (GT and assembly-line slots), a GTNH circuit stand-in also brings every item it stands for (stand-ins.ts).
 */
function itemOptions(items: ItemRefs, standIns?: ReadonlyMap<ItemKey, readonly ItemKey[]>): (s: readonly [number, number, number?]) => Option[] {
  return ([i, amount]) => {
    const options = items.optionsAt(i).map((key) => ({ key, amount: Math.max(amount, 1) }));
    return standIns === undefined ? options : withStandIns(options, standIns);
  };
}

function fluidOptions([name, litres]: readonly [string, number, number?]): Option[] {
  return [{ key: fluidKey(name), amount: litres }];
}

/** The non-null slots with an amount above 0, in order. */
function products<S extends Slot>(slots: ReadonlyArray<S | null>, keyOf: (s: S) => StuffKey): Product[] {
  const result: Product[] = [];
  for (const s of slots) if (s !== null && s[1] > 0) result.push({ key: keyOf(s), amount: s[1], chance: chanceOf(s[2]) });
  return result;
}

function itemProducts(slots: readonly ItemSlot[], items: ItemRefs): Product[] {
  return products(slots, ([i]) => firstKeyAt(items, i));
}

/** The recipe with its content id (recipe-id.ts); maps, amps and the other flags stay out of the id. */
function withId(content: RecipeContent): Recipe {
  const { source, inputs, outputs, euPerTick, durationTicks, specialValue, meta, category, flags } = content;
  return { id: recipeId({ source, inputs, outputs, euPerTick, durationTicks, specialValue, meta, category, fake: flags.fake }), ...content };
}

/** The value with every item reference (an object that is exactly `{ item: index }`), at any depth, as its key. */
function metaValue(value: MetaValue, items: ItemRefs): unknown {
  if (Array.isArray(value)) return value.map((v) => metaValue(v, items));
  if (typeof value !== 'object' || value === null) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === 'item' && typeof value.item === 'number') return firstKeyAt(items, value.item);
  // Object.fromEntries defines own properties, so a field named `__proto__` stays an ordinary key.
  return Object.fromEntries(keys.map((key) => [key, metaValue(value[key] as MetaValue, items)]));
}

/** The meta of the first not-consumed concrete programmed circuit among the item inputs (alternatives aside). */
function circuitOf(slots: readonly ItemSlot[], items: ItemRefs): number | undefined {
  for (const s of slots) {
    if (s === null || consumption(s[1], s[2]).consumed || items.idAt(s[0]) !== PROGRAMMED_CIRCUIT_ID) continue;
    const key = items.keyAt(s[0]);
    if (key !== null) return parseItemKey(key).meta;
  }
  return undefined;
}

/** Every metadata entry (renamed, item references as keys) plus the line's own extras. */
function gtMeta(line: GtRecipeLine, items: ItemRefs): Recipe['meta'] {
  // Object.fromEntries defines own properties, so an identifier like `__proto__` stays an ordinary key.
  const meta = Object.fromEntries(Object.entries(line.meta ?? {}).map(([key, value]) => [
    Object.hasOwn(META_RENAMES, key) ? (META_RENAMES[key] as string) : key, metaValue(value, items),
  ])) as Recipe['meta'];
  const circuit = circuitOf(line.in, items);
  if (circuit !== undefined) meta.circuit = circuit;
  if (line.needsEmptyOut) meta.needsEmptyOutput = true;
  if (line.nbtSensitive) meta.nbtSensitive = true;
  if (line.special != null) meta.specialItem = firstKeyAt(items, line.special);   // display only, never an input (T8)
  if (line.owners) meta.owners = [...line.owners];
  return meta;
}

/** A GT recipe line; null for a disabled recipe (dropped, §11.4). Throws for a map index the export does not have. */
export function gtRecipe(line: GtRecipeLine, ctx: LoadContext): Recipe | null {
  const map = ctx.mapsByIndex.get(line.map);
  if (map === undefined) throw new RangeError(`unknown recipe map index ${line.map}`);
  if (line.disabled) return null;
  const flags: Recipe['flags'] = {};
  if (line.hidden) flags.hidden = true;
  if (line.fake) flags.fake = true;
  if (line.meta?.recycle === true || line.cat?.endsWith('_recycling')) flags.recycling = true;
  if (map.dynamic) flags.dynamicMap = map.dynamic;
  const content: RecipeContent = {
    source: 'gt', maps: [map.id],
    inputs: [
      ...ingredients(line.in, line.inAlt, 0, itemOptions(ctx.items, ctx.standIns)),
      ...ingredients(line.fin, line.finAlt, FLUID_SLOT_BASE, fluidOptions),
    ],
    outputs: [...itemProducts(line.out, ctx.items), ...products(line.fout, ([name]) => fluidKey(name))],
    euPerTick: line.eut, durationTicks: line.dur, amps: map.amps, specialValue: line.sv ?? 0,
    meta: gtMeta(line, ctx.items), flags,
  };
  if (line.cat !== undefined) content.category = line.cat;
  return withId(content);
}

/** A data-stick assembly-line recipe (export-mod.md §2.8): 1 A, special value 0, the research in `meta`. */
export function assemblyLineRecipe(line: AssemblyLineLine, ctx: LoadContext): Recipe {
  return withId({
    source: 'assemblyline', maps: ['assemblyline'],
    inputs: [
      ...ingredients(line.in, line.inAlt, 0, itemOptions(ctx.items, ctx.standIns)),
      ...ingredients(line.fin, undefined, FLUID_SLOT_BASE, fluidOptions),
    ],
    outputs: itemProducts([line.out], ctx.items),
    euPerTick: line.eut, durationTicks: line.dur, amps: 1, specialValue: 0,
    meta: {
      researchItem: line.research == null ? null : firstKeyAt(ctx.items, line.research),
      researchTime: line.researchTime, researchVoltage: line.researchVoltage,
    },
    flags: {},
  });
}

/**
 * The items a crafting slot accepts: an item (every variant of a wildcard), an ore name's list (an unknown or empty
 * list warns and accepts nothing) or an anonymous list.
 */
function craftingSlotKeys(s: Exclude<CraftingSlot, null>, ctx: LoadContext, recipe: string): readonly ItemKey[] {
  if (typeof s === 'number') return ctx.items.optionsAt(s);
  if (Array.isArray(s)) return [...new Set(s.flatMap((i) => ctx.items.optionsAt(i)))];
  const keys = ctx.oreDict.get(s.ore) ?? [];
  if (keys.length === 0) ctx.warn(`${recipe}: ore name ${s.ore} lists no items, the slot accepts nothing`);
  return keys;
}

function isToolSlot(s: Exclude<CraftingSlot, null>, keys: readonly ItemKey[]): boolean {
  if (typeof s === 'object' && !Array.isArray(s) && s.ore.startsWith(TOOL_ORE_PREFIX)) return true;
  return keys.length > 0 && keys.every((key) => GT_TOOL_ITEM_IDS.includes(parseItemKey(key).id));
}

/**
 * A crafting-table recipe (export-mod.md §4.1): no EU, no time, one of each input; a tool slot is not consumed; an
 * opaque recipe (a class the exporter cannot read) has no inputs. The caller skips a line whose `out` is null.
 */
export function craftingRecipe(line: CraftingLine, ctx: LoadContext): Recipe {
  const outputs = itemProducts([line.out], ctx.items);
  const flags: Recipe['flags'] = {};
  const inputs: Ingredient[] = [];
  if (line.shape === 'opaque') {
    flags.opaque = true;
  } else {
    if (line.shape === 'shaped') flags.shaped = true;
    const recipe = `crafting recipe ${line.cls} for ${outputs[0]?.key ?? 'nothing'}`;
    (line.in ?? []).forEach((s, slot) => {
      if (s === null) return;
      const keys = craftingSlotKeys(s, ctx, recipe);
      const consumed = !isToolSlot(s, keys);
      inputs.push({ slot, consumed, chance: consumed ? 1 : 0, options: keys.map((key) => ({ key, amount: 1 })) });
    });
  }
  const meta: Recipe['meta'] = { cls: line.cls };
  if (line.w != null) meta.width = line.w;
  if (line.h != null) meta.height = line.h;
  if (line.mirrored != null) meta.mirrored = line.mirrored;
  return withId({ source: 'crafting', maps: ['crafting'], inputs, outputs, euPerTick: 0, durationTicks: 0, amps: 0, specialValue: 0, meta, flags });
}

/** A vanilla smelting entry with GT's own electric furnace (`ef`) and microwave (`mw`) results when it has them. */
export interface FurnaceEntry { input: ItemKey[]; output: Product; xp: number; ef?: Product; mw?: Product }

export function furnaceEntry(line: FurnaceLine, ctx: LoadContext): FurnaceEntry {
  const product = ([i, amount]: readonly [number, number]): Product => ({ key: firstKeyAt(ctx.items, i), amount, chance: 1 });
  const entry: FurnaceEntry = { input: ctx.items.optionsAt(line.in), output: product(line.out), xp: line.xp };
  if (line.ef) entry.ef = product(line.ef);
  if (line.mw) entry.mw = product(line.mw);
  return entry;
}

/** The vanilla furnace recipe of an entry: one input, no EU, `VANILLA_FURNACE_TICKS`, the experience in `meta.xp`. */
export function furnaceRecipe(e: FurnaceEntry): Recipe {
  return withId({
    source: 'furnace', maps: ['furnace'],
    inputs: [{ slot: 0, consumed: true, chance: 1, options: e.input.map((key) => ({ key, amount: 1 })) }],
    outputs: [{ ...e.output }],
    euPerTick: 0, durationTicks: VANILLA_FURNACE_TICKS, amps: 0, specialValue: 0, meta: { xp: e.xp }, flags: {},
  });
}

/**
 * Recipes merged by id (prior-art T10): the first copy is kept and updated in place — its maps gain the other copies'
 * maps in first-seen order, `amps` is the maximum, `flags.hidden` stays only if every copy is hidden, `flags.recycling`
 * is set if any copy is recycling, and `flags.dynamicMap` is the first one any copy has.
 */
export class RecipeCollector {
  readonly #byId = new Map<string, Recipe>();

  add(r: Recipe): void {
    const kept = this.#byId.get(r.id);
    if (kept === undefined) {
      this.#byId.set(r.id, r);
      return;
    }
    for (const map of r.maps) if (!kept.maps.includes(map)) kept.maps.push(map);
    kept.amps = Math.max(kept.amps, r.amps);
    if (!r.flags.hidden) delete kept.flags.hidden;
    if (r.flags.recycling) kept.flags.recycling = true;
    if (kept.flags.dynamicMap === undefined && r.flags.dynamicMap !== undefined) kept.flags.dynamicMap = r.flags.dynamicMap;
  }

  /** The merged recipes in the order their first copies were added. */
  list(): Recipe[] {
    return [...this.#byId.values()];
  }
}
