// Reachable dimensions and material availability (spec §3.3; materials-availability §5.4, §8.1–§8.4): which dimensions
// and capabilities the group can use at its tier, which goods it can get from them (a forward-chaining fixpoint over the
// recipes it can run), where each good comes from, and what would unlock a good it cannot get yet.

import { defaultCoilHeat } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Item, OrePart, Pack, Recipe, Worldgen } from '../../shared/types/pack.ts';
import { FREE_KEYS, type LeafClass, type PlanSettings, type ReachableDim, type SourceInfo } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { acceptRecipe, multiblocksFor, type PlanEnv } from './candidates.ts';

const MAX_TIER = V.length - 1;
const OVERWORLD = 'overworld';
const ASTEROIDS = 'asteroids';
/** The capability key of low-gravity processing (architecture §11.4); an explicit override of it decides `lowGravity`. */
const LOW_GRAVITY = 'low_gravity';
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
const MOLTEN = 'fluid:molten.';
/** The excluded category that also covers `fromNothingRecipes` (DEFAULT_EXCLUDED_CATEGORIES). */
const FREE_INPUT_CATEGORY = 'lava-centrifuge';
/** The ore-processing parts of a material (`GtMaterial.parts`) that are base items: everything but crushed ore. */
const BASE_PARTS: readonly OrePart[] = ['ore', 'rawOre', 'dust', 'ingot', 'gem'];
const CACHE_SIZE = 32;
const PROGRESSION: PlanSettings['dims'] = Object.freeze({ policy: 'progression', overrides: Object.freeze({}) });

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** GT's ore block prefixes (`ore`, `oreNetherrack`, `oreSmall`…) and the raw ore. */
export function isOrePrefix(prefix: string): boolean {
  return prefix === 'rawOre' || prefix.startsWith('ore');
}

/** The GT prefixes of base items; every ore prefix (`isOrePrefix`) counts too. */
export const BASE_PREFIXES: ReadonlySet<string> = new Set(['dust', 'ingot', 'gem', 'rawOre']);

function isBasePrefix(prefix: string): boolean {
  return BASE_PREFIXES.has(prefix) || isOrePrefix(prefix);
}

export interface Reachability { reachable: ReachableDim[] /* sorted by key; dimensions and capabilities */; keys: ReadonlySet<string>; lowGravity: boolean }

/**
 * The dimensions and capabilities the group can use at `tier`. A dimension: an `off` override keeps it out, an `on`
 * override puts it in; otherwise it is in when visited, or by progression when its default tier is reached (overworld
 * always). A capability: overrides as above; otherwise in from its minimum tier when its dimension (if any) is in.
 * Keys the pack's worldgen does not list are ignored.
 */
export function reachableDims(worldgen: Worldgen, dims: PlanSettings['dims'], visited: readonly string[], tier: number): Reachability {
  const overrideOf = (key: string): 'on' | 'off' | undefined => (Object.hasOwn(dims.overrides, key) ? dims.overrides[key] : undefined);
  const wasVisited = new Set(visited);
  const why = new Map<string, ReachableDim['why']>();

  for (const dim of worldgen.dimensions) {
    if (why.has(dim.key)) continue;
    const override = overrideOf(dim.key);
    if (override === 'off') continue;
    if (override === 'on') why.set(dim.key, 'override');
    else if (wasVisited.has(dim.key)) why.set(dim.key, 'visited');
    else if ((dims.policy === 'progression' && dim.defaultTier <= tier) || dim.key === OVERWORLD) why.set(dim.key, 'progression');
  }
  // Low-gravity recipes run on a space station or in the Asteroids dimension, not on the Moon or planets (§5.4).
  const lowGravityPlace = worldgen.dimensions.some((dim) => why.has(dim.key) && (dim.kind === 'station' || dim.key === ASTEROIDS));

  for (const capability of worldgen.capabilities) {
    if (why.has(capability.key)) continue;
    const override = overrideOf(capability.key);
    if (override === 'off') continue;
    if (override === 'on') why.set(capability.key, 'override');
    else if (tier >= capability.minTier && (capability.dim === undefined || why.has(capability.dim))) why.set(capability.key, 'progression');
  }

  const lowGravityOverride = overrideOf(LOW_GRAVITY);
  return {
    reachable: [...why].map(([key, reason]) => ({ key, why: reason })).sort((a, b) => byString(a.key, b.key)),
    keys: new Set(why.keys()),
    lowGravity: lowGravityOverride === undefined ? lowGravityPlace : lowGravityOverride === 'on',
  };
}

interface PackFacts {
  /** Base parts of materials (`GtMaterial.parts`), for items the GT unificator gives no association. */
  partOf: Map<ItemKey, string /* material */>;
  /** The base items of each material: GT items with a base prefix, and the material's base parts. */
  baseItems: Map<string, StuffKey[]>;
  natural: ReadonlySet<StuffKey>;
  /** Fluids some `worldgen.fluidSources` entry names. */
  sourcedFluids: ReadonlySet<StuffKey>;
  /** Index of each recipe's first input in the flat slot array. */
  slotStart: Int32Array;
  slotTotal: number;
  /** Input slots per recipe. A slot with no option (an ore name that lists no items) is never satisfied. */
  slotCount: Int32Array;
  /** Recipes without any input slot: they fire as soon as the group can run them. */
  inputless: number[];
  /** Every programmed circuit (GT's not-consumed configuration item) the pack lists. */
  programmedCircuits: ItemKey[];
  /** Materials the world gives as ore: those of veins, small ores, capabilities, byproducts and ore parts. */
  oreMaterials: ReadonlySet<string>;
  /** Material names by the id molten fluids spell them with (`fluid:molten.<id>`), the first name winning. */
  moltenMaterial: ReadonlyMap<string, string>;
}

const FACTS = new WeakMap<Pack, PackFacts>();

/**
 * Ore-dictionary prefixes of things gathered in the world: logs, saplings, leaves, crops, seeds, raw food, flowers,
 * mushrooms, plants, clay and mob drops. "No recipe makes it" does not find them on the real 2.9 export: nearly every gathered item
 * has some producer (tree farms, fishing ports, centrifuges…), so availability could not even reach rubber wood and
 * sticky resin; while ~6,500 items no recipe makes are not gathered at all (sensor and location cards made by using a
 * kit on a block, legacy multiblock controllers, data orbs with NBT, creative and display blocks, other mods' copies of
 * GT parts), and as cost-1 leaves they made disassembly recipes (a GregTech Sensor Card → 3 Electronic Circuits) the
 * cheapest way to make their outputs. So a natural item is one that carries one of these names. Broad names that
 * crafted items share are left out: `slimeball` (Electro-Magic Tools' Glue, Ball of Glue), `food` and `listAll`
 * (bread, cooked meat, edible salt); raw food keeps its own `listAll…raw` and produce names, and the slime balls of
 * mobs are `GATHERED_KEYS`.
 */
export const GATHERED_ORE_PREFIXES: readonly string[] = Object.freeze([
  'log', 'treeSapling', 'treeLeaves', 'crop', 'seed', 'listAllseed', 'listAllmeatraw', 'listAllfishraw', 'listAllegg', 'listAllveggie',
  'listAllfruit', 'listAllgrain', 'listAllmushroom', 'listAllnut', 'listAllberry', 'flower', 'mushroom', 'sugarcane', 'blockCactus',
  'vine', 'string', 'bone', 'feather', 'leather', 'egg', 'itemClay',
]);

/**
 * Gathered items no ore-dictionary name of `GATHERED_ORE_PREFIXES` covers: sticky resin (tapped from rubber logs) and
 * the slime balls of mobs (the `slimeball` ore name also covers crafted glue balls, so it is not a gathered name).
 */
export const GATHERED_KEYS: readonly StuffKey[] = Object.freeze(['IC2:itemHarz@0', 'minecraft:slime_ball@0']);

/**
 * World blocks a group digs or picks up by the stack (fix spec R1, D4), by the dimension they are gathered in
 * (`DimensionInfo.key`). Where that dimension is reachable, each is a natural leaf at its normal price (1; a cost override
 * applies), so a line imports Sand instead of crafting it from free cobblestone through gravel; elsewhere (End stone
 * below HV) it is classified like any other good. Stone is not here: a rock breaker makes it.
 */
export const GATHERED_BLOCKS: Readonly<Record<StuffKey, string /* DimensionInfo.key */>> = Object.freeze({
  'minecraft:sand@0': 'overworld', 'minecraft:sand@1': 'overworld', 'minecraft:gravel@0': 'overworld',
  'minecraft:dirt@0': 'overworld', 'minecraft:clay@0': 'overworld', 'minecraft:flint@0': 'overworld',
  'minecraft:sandstone@0': 'overworld', 'minecraft:snowball@0': 'overworld', 'minecraft:snow@0': 'overworld',
  'minecraft:ice@0': 'overworld', 'minecraft:packed_ice@0': 'overworld',
  'minecraft:netherrack@0': 'nether', 'minecraft:soul_sand@0': 'nether', 'minecraft:end_stone@0': 'theend',
});

/**
 * Mob drops a group collects where their mob lives, by the dimension (`DimensionInfo.key`): Ender Pearls from Endermen in
 * the overworld, Blaze Rods from Blazes in Nether fortresses. Where that dimension is reachable each is a natural leaf at
 * its normal price, as a gathered block is. Both carry a GT material (gem EnderPearl, stick Blaze) that no ore vein
 * yields, so neither the gathered ore names nor the veins gave them a source: on the 2.9 export nothing then made the MV
 * and HV emitters (an Ender Pearl; an Eye of Ender, crafted from a pearl and blaze powder), and no MV or HV laser
 * engraver, circuit assembler or microwave could be built.
 */
export const MOB_DROPS: Readonly<Record<StuffKey, string /* DimensionInfo.key */>> = Object.freeze({
  'minecraft:ender_pearl@0': 'overworld', 'minecraft:blaze_rod@0': 'nether',
});

/** `name` is `prefix` or `prefix` followed by an upper-case letter (logWood, cropWheat; not logistics). */
function hasOrePrefix(name: string, prefix: string): boolean {
  if (!name.startsWith(prefix)) return false;
  const next = name.charAt(prefix.length);
  return next === '' || (next >= 'A' && next <= 'Z');
}

/** An item that looks gathered: no NBT, no charge, and a gathered ore-dictionary name. */
function looksGathered(item: Item): boolean {
  if (item.nbt !== undefined || item.electric !== undefined) return false;
  if (GATHERED_KEYS.includes(item.key)) return true;
  return item.oreDict.some((name) => GATHERED_ORE_PREFIXES.some((prefix) => hasOrePrefix(name, prefix)));
}

function baseMaterialWith(pack: Pack, partOf: ReadonlyMap<ItemKey, string>, key: StuffKey): string | undefined {
  const gt = pack.items.get(key)?.gt;
  if (gt !== undefined && isBasePrefix(gt.prefix)) return gt.material;
  return partOf.get(key);
}

function factsOf(pack: Pack): PackFacts {
  let facts = FACTS.get(pack);
  if (facts !== undefined) return facts;

  const partOf = new Map<ItemKey, string>();
  for (const material of pack.materials.values()) {
    for (const part of BASE_PARTS) {
      const key = material.parts?.[part];
      if (key !== undefined && !partOf.has(key)) partOf.set(key, material.name);
    }
  }
  const baseItems = new Map<string, StuffKey[]>();
  const natural = new Set<StuffKey>();
  for (const item of pack.items.values()) {
    const material = baseMaterialWith(pack, partOf, item.key);
    if (material !== undefined) addTo(baseItems, material, item.key);
    else if (item.gt === undefined && looksGathered(item)) natural.add(item.key);
  }

  const n = pack.recipes.length;
  const slotStart = new Int32Array(n);
  const slotCount = new Int32Array(n);
  const inputless: number[] = [];
  let slotTotal = 0;
  pack.recipes.forEach((r, i) => {
    slotStart[i] = slotTotal;
    slotTotal += r.inputs.length;
    slotCount[i] = r.inputs.length;
    if (r.inputs.length === 0) inputless.push(i);
  });

  const programmedCircuits = [...pack.items.values()].filter((item) => item.id === PROGRAMMED_CIRCUIT_ID && item.nbt === undefined).map((item) => item.key);
  const oreMaterials = new Set<string>(partOf.values());
  for (const vein of pack.worldgen.veins) for (const material of Object.values(vein.materials)) oreMaterials.add(material);
  for (const capability of pack.worldgen.capabilities) for (const material of capability.yields) oreMaterials.add(material);
  for (const [material, byproducts] of Object.entries(pack.worldgen.byproducts)) {
    oreMaterials.add(material);
    for (const byproduct of byproducts) oreMaterials.add(byproduct);
  }
  const moltenMaterial = new Map<string, string>();
  for (const name of pack.materials.keys()) {
    const id = name.toLowerCase().replaceAll(' ', '');
    if (!moltenMaterial.has(id)) moltenMaterial.set(id, name);
  }
  facts = {
    partOf, baseItems, natural, sourcedFluids: new Set(pack.worldgen.fluidSources.map((s) => s.fluid)),
    slotStart, slotTotal, slotCount, inputless, programmedCircuits, oreMaterials, moltenMaterial,
  };
  FACTS.set(pack, facts);
  return facts;
}

/**
 * A base item (spec §3.3): a free input; an ore, raw ore, dust, ingot or gem (by GT prefix, or as a material's ore
 * part); or a fluid that `worldgen.fluidSources` names. Such a fluid counts as base only where a source is reachable
 * (`classOf` 'direct'): where none is, it is derived, and derived fluids are made, never bought (`makeLeafOracle`, fix
 * spec R5). Molten metals are not base: they are made from their ingot.
 */
export function isBaseItem(pack: Pack, key: StuffKey): boolean {
  if (FREE.has(key)) return true;
  const facts = factsOf(pack);
  if (isFluidKey(key)) return facts.sourcedFluids.has(key);
  return baseMaterialWith(pack, facts.partOf, key) !== undefined;
}

/**
 * An item with no GT association that carries a gathered ore-dictionary name (`GATHERED_ORE_PREFIXES`: logs, crops,
 * seeds, mob drops…): gathered by hand, whether or not some machine can also make it.
 */
export function isNatural(pack: Pack, key: StuffKey): boolean {
  return factsOf(pack).natural.has(key);
}

export interface Availability {
  tier: number; available: ReadonlySet<StuffKey>; classOf(key: StuffKey): LeafClass; sources(key: StuffKey): SourceInfo[];
  why: ReadonlyMap<StuffKey, string /* recipe id */>;
  /**
   * What `key` was first made from: the consumed input of each slot of its `why` recipe that became available first (the
   * goods a derived source names, without what the machine only holds); none for a good no recipe made available. Each
   * of them became available before `key`, so following them back always ends.
   */
  derivedFrom(key: StuffKey): StuffKey[];
  /**
   * Recipe layers from the seeds (fix spec R6): 0 for a seed (a free, natural or direct good) and for a good the group
   * cannot get; else 1 + the largest, over the consumed slots of its first-found recipe (`why`), of the smallest depth
   * among that slot's available options. With supporting lines off, only shallow derived materials are bought.
   */
  depth(key: StuffKey): number;
  /** The multiblocks the group can build: their controller item is available (`PlanEnv.multiblocks`). */
  multiblocks: ReadonlySet<number>;
  /** Ids of the recipes that make an ore material from free inputs alone (`fromNothingRecipes`, `PlanEnv.fromNothing`). */
  fromNothing: ReadonlySet<string>;
}

/** One way to get a direct material or a sourced fluid, and the reachable keys it relies on. */
interface Source { info: SourceInfo; reach: string[] }

interface State {
  avail: Availability;
  /** Order in which each available good became available (seeds first). */
  rank: ReadonlyMap<StuffKey, number>;
  /** Sources of every direct material, by material name, and of every sourced fluid, by key. */
  materialSources: ReadonlyMap<string, Source[]>;
  fluidSources: ReadonlyMap<StuffKey, Source[]>;
}

function addTo<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function copyOf(info: SourceInfo): SourceInfo {
  return { ...info, dims: [...info.dims] };
}

/** The veins, small ores and capabilities of each material, and the fluid sources, that `env` reaches. */
function reachedSources(worldgen: Worldgen, env: PlanEnv): { materials: Map<string, Source[]>; fluids: Map<StuffKey, Source[]> } {
  const materials = new Map<string, Source[]>();
  for (const vein of worldgen.veins) {
    const dims = vein.dims.filter((d) => env.reachable.has(d));
    if (dims.length === 0) continue;
    const info: SourceInfo = { kind: vein.kind === 'small' ? 'small_ore' : 'vein', dims, detail: vein.name };
    for (const material of unique(Object.values(vein.materials))) addTo(materials, material, { info, reach: dims });
  }
  for (const capability of worldgen.capabilities) {
    if (!env.reachable.has(capability.key)) continue;
    const info: SourceInfo = { kind: 'capability', dims: capability.dim === undefined ? [] : [capability.dim], detail: capability.name };
    for (const material of unique(capability.yields)) addTo(materials, material, { info, reach: [capability.key] });
  }
  const fluids = new Map<StuffKey, Source[]>();
  for (const source of worldgen.fluidSources) {
    if (source.minTier > env.tier) continue;
    const dims = source.dims.filter((d) => env.reachable.has(d));
    if (source.dims.length > 0 && dims.length === 0) continue;   // `dims: []` needs no dimension
    addTo(fluids, source.fluid, { info: { kind: 'fluid', dims, detail: source.kind }, reach: dims });
  }
  return { materials, fluids };
}

/**
 * The input option of each slot of `r` (each consumed slot, with `consumedOnly`) that became available first: the ones
 * that let it fire.
 */
function firstOptions(r: Recipe, rank: ReadonlyMap<StuffKey, number>, consumedOnly = false): StuffKey[] {
  const keys: StuffKey[] = [];
  for (const ing of r.inputs) {
    if (consumedOnly && !ing.consumed) continue;
    let best: StuffKey | undefined;
    let bestRank = Infinity;
    for (const { key } of ing.options) {
      const at = rank.get(key);
      if (at !== undefined && at < bestRank) {
        best = key;
        bestRank = at;
      }
    }
    if (best !== undefined) keys.push(best);
  }
  return keys;
}

/** Multiblock mteIds by the key of their controller item. */
const CONTROLLERS = new WeakMap<Pack, Map<StuffKey, number[]>>();

function controllersOf(pack: Pack): Map<StuffKey, number[]> {
  let byItem = CONTROLLERS.get(pack);
  if (byItem === undefined) {
    byItem = new Map();
    for (const m of pack.machines.values()) if (m.kind === 'multiblock') addTo(byItem, m.itemKey, m.mteId);
    CONTROLLERS.set(pack, byItem);
  }
  return byItem;
}

/** Prefixes of GT material forms an ore gives: dusts (and small and tiny piles), ingots, nuggets, gems, crushed and purified ore, ores. */
const ORE_FORM_PREFIXES: readonly string[] = ['dust', 'ingot', 'nugget', 'gem', 'crushed', 'ore', 'rawOre'];

/** The material of a GT material form (`ORE_FORM_PREFIXES`, or a material's ore part) or of a molten fluid. */
function formMaterial(pack: Pack, facts: PackFacts, key: StuffKey): string | undefined {
  if (isFluidKey(key)) return key.startsWith(MOLTEN) ? facts.moltenMaterial.get(key.slice(MOLTEN.length)) : undefined;
  const gt = pack.items.get(key)?.gt;
  if (gt !== undefined && ORE_FORM_PREFIXES.some((prefix) => gt.prefix.startsWith(prefix))) return gt.material;
  return facts.partOf.get(key);
}

/** The material of any GT item or molten fluid. */
function anyMaterial(pack: Pack, facts: PackFacts, key: StuffKey): string | undefined {
  if (isFluidKey(key)) return key.startsWith(MOLTEN) ? facts.moltenMaterial.get(key.slice(MOLTEN.length)) : undefined;
  return pack.items.get(key)?.gt?.material ?? facts.partOf.get(key);
}

/**
 * The recipes that make an ore material out of nothing (plan Review Focus #4, prior-art §3.4 step 5): with water,
 * air, cobblestone and lava free, everything those make alone is free too (the free closure: gravel, sand, quartz
 * sand, stone dust, obsidian…), and a recipe that consumes only such goods and separates them into a dust, ingot, gem,
 * nugget, ore or molten metal of a material the world gives as ore (other than a material it consumes; with other
 * products beside it, or only by chance) mines metal from nothing: lava centrifuged into copper and tin, the thermal
 * refinery's lava filter, obsidian dust electrolysed into iron and magnesium, quartz sand from cobblestone centrifuged
 * into cassiterite. A plain conversion (sand → quartz sand) is not one. Such a recipe does not fire, so the closure
 * never contains what it makes. Not-consumed slots are not checked; `canRun` judges the rest.
 */
export function fromNothingRecipes(pack: Pack, canRun: (index: number) => boolean): Set<number> {
  const facts = factsOf(pack);
  const free = new Set<StuffKey>();
  const queue: StuffKey[] = [];
  const banned = new Set<number>();
  const consumedSlots = (r: Recipe): number => r.inputs.filter((ing) => ing.consumed && ing.chance > 0).length;
  const need = new Int32Array(pack.recipes.length).fill(-1);
  const satisfied = new Uint8Array(facts.slotTotal);
  const add = (key: StuffKey): void => {
    if (free.has(key)) return;
    free.add(key);
    queue.push(key);
  };
  const consider = (i: number): void => {
    if (!canRun(i)) return;
    const r = pack.recipes[i] as Recipe;
    const consumed = new Set<string>();
    for (const ing of r.inputs) {
      if (!ing.consumed) continue;
      for (const o of ing.options) {
        const m = anyMaterial(pack, facts, o.key);
        if (m !== undefined) consumed.add(m);
      }
    }
    // A conversion (sand → quartz sand, flint dust → silicon dioxide) has one product and makes it for sure; a separation
    // (a centrifuge, electrolyzer, sifter or filter splitting free stuff into metals) makes several, or only by chance.
    const products = new Set(r.outputs.filter((p) => p.chance > 0 && !FREE.has(p.key)).map((p) => p.key));
    const mines = r.outputs.some((p) => {
      if (p.chance <= 0 || FREE.has(p.key)) return false;
      const m = formMaterial(pack, facts, p.key);
      if (m === undefined || !facts.oreMaterials.has(m) || consumed.has(m)) return false;
      return products.size > 1 || !r.outputs.some((q) => q.key === p.key && q.chance >= 1);
    });
    if (mines) banned.add(i);
    else for (const p of r.outputs) if (p.chance > 0) add(p.key);
  };
  pack.recipes.forEach((r, i) => {
    if (consumedSlots(r) === 0) consider(i);   // consumes nothing at all
  });
  for (const key of FREE_KEYS) add(key);
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head] as StuffKey;
    for (const i of pack.consumers.get(x) ?? []) {
      const r = pack.recipes[i] as Recipe;
      if (need[i] === -1) need[i] = consumedSlots(r);
      if (need[i] === 0) continue;
      const start = facts.slotStart[i] as number;
      r.inputs.forEach((ing, s) => {
        if (!ing.consumed || ing.chance <= 0 || satisfied[start + s] === 1 || !ing.options.some((o) => o.key === x)) return;
        satisfied[start + s] = 1;
        need[i] = (need[i] as number) - 1;
      });
      if (need[i] === 0) consider(i);
    }
  }
  return banned;
}

/**
 * materials-availability §8.1: seeds are the free inputs, natural items, the gathered blocks and mob drops of reachable
 * dimensions (`GATHERED_BLOCKS`, `MOB_DROPS`), the base items of direct materials and the reachable sourced fluids; a
 * recipe the group can run
 * fires once every input slot (consumed or not) has an available option,
 * and makes all its outputs with a chance above 0 available. A recipe only a multiblock runs also waits for one of
 * those multiblocks to be built: its controller item must be available (the machine's own minimum tier, §8.1 "Skip
 * recipes above T"), so a multiblock whose controller needs UMV parts never runs at MV. `env.multiblocks` is ignored:
 * this fixpoint is what decides it.
 */
function computeState(pack: Pack, env: PlanEnv): State {
  const facts = factsOf(pack);
  const controllers = controllersOf(pack);
  const { materials: materialSources, fluids: fluidSources } = reachedSources(pack.worldgen, env);
  const direct = new Set<StuffKey>();
  for (const material of materialSources.keys()) for (const key of facts.baseItems.get(material) ?? []) direct.add(key);
  for (const key of fluidSources.keys()) direct.add(key);
  /** The gathered blocks whose dimension `env` reaches, with that dimension (fix spec R1). */
  const gathered = new Map(Object.entries(GATHERED_BLOCKS).filter(([, dim]) => env.reachable.has(dim)));
  /** The mob drops whose dimension `env` reaches, with that dimension (`MOB_DROPS`). */
  const dropped = new Map(Object.entries(MOB_DROPS).filter(([, dim]) => env.reachable.has(dim)));

  const ungated: PlanEnv = { ...env, multiblocks: undefined, fromNothing: undefined };
  const noMultiblock: PlanEnv = { ...ungated, multiblocks: new Set() };
  /** Per recipe: undefined = not judged yet; [] = runs without a multiblock; null = never runs here; else its multiblocks. */
  const gates: Array<number[] | null | undefined> = new Array(pack.recipes.length);
  const gateOf = (i: number): number[] | null => {
    let gate = gates[i];
    if (gate === undefined) {
      const r = pack.recipes[i] as Recipe;
      if (!acceptRecipe(pack, r, ungated).ok) gate = null;
      else gate = acceptRecipe(pack, r, noMultiblock).ok ? [] : multiblocksFor(pack, r, ungated);
      gates[i] = gate;
    }
    return gate;
  };

  /** The fixpoint itself, with the recipes of `banned` left out. */
  const run = (banned: ReadonlySet<number>): { queue: StuffKey[]; rank: Map<StuffKey, number>; why: Map<StuffKey, string>; built: Set<number> } => {
    const built = new Set<number>();
    const rank = new Map<StuffKey, number>();
    const queue: StuffKey[] = [];
    const why = new Map<StuffKey, string>();
    /** Recipes that have every input slot and wait for one of their multiblocks, by mteId; and those released. */
    const parked = new Map<number, number[]>();
    const released: number[] = [];
    const add = (key: StuffKey, recipeId?: string): void => {
      if (rank.has(key)) return;
      rank.set(key, queue.length);
      queue.push(key);
      if (recipeId !== undefined) why.set(key, recipeId);
      // An NBT variant stands for its plain item too: GT makes every tool with its material in NBT
      // (gt.metatool.01@22#…), while crafting tool slots accept the plain screwdriver gt.metatool.01@22.
      const plain = isFluidKey(key) ? -1 : key.indexOf('#');
      if (plain > 0) add(key.slice(0, plain), recipeId);
      for (const id of controllers.get(key) ?? []) {
        if (built.has(id)) continue;
        built.add(id);
        released.push(...(parked.get(id) ?? []));
        parked.delete(id);
      }
    };

    for (const key of FREE_KEYS) add(key);
    for (const key of facts.natural) add(key);
    for (const key of gathered.keys()) add(key);
    for (const key of dropped.keys()) add(key);
    // From LV on every group has programmed circuits. The export cannot show the bootstrap: the first circuit needs a
    // vacuum tube, whose glass tube needs a ball mold, whose casting form comes from a Tinkers' casting table (not a
    // recipe) or from a fluid solidifier that itself needs a programmed circuit; without this seed nothing that takes
    // one as its not-consumed configuration item (most GT recipes, every multiblock controller) is ever available.
    if (env.tier >= 1) for (const key of facts.programmedCircuits) add(key);
    for (const key of direct) add(key);

    const canRun = (i: number): boolean => !banned.has(i) && gateOf(i) !== null;
    const fired = new Uint8Array(pack.recipes.length);
    const fireNow = (i: number): void => {
      if (fired[i] === 1) return;
      fired[i] = 1;
      const r = pack.recipes[i] as Recipe;
      for (const p of r.outputs) if (p.chance > 0) add(p.key, r.id);
    };
    /** Every slot of recipe `i` is satisfied: it fires now, or once one of its multiblocks is built. */
    const ready = (i: number): void => {
      const gate = gateOf(i) as number[];
      if (gate.length === 0 || gate.some((id) => built.has(id))) fireNow(i);
      else for (const id of gate) addTo(parked, id, i);
    };
    const need = Int32Array.from(facts.slotCount);
    const satisfied = new Uint8Array(facts.slotTotal);

    for (const i of facts.inputless) if (canRun(i)) ready(i);
    for (let head = 0; head < queue.length || released.length > 0; ) {
      const freed = released.pop();
      if (freed !== undefined) {
        fireNow(freed);
        continue;
      }
      const x = queue[head++] as StuffKey;
      for (const i of pack.consumers.get(x) ?? []) {
        if (need[i] === 0 || !canRun(i)) continue;   // ready already, or the group cannot run it
        const r = pack.recipes[i] as Recipe;
        const start = facts.slotStart[i] as number;
        r.inputs.forEach((ing, s) => {
          if (satisfied[start + s] === 1 || !ing.options.some((o) => o.key === x)) return;
          satisfied[start + s] = 1;
          need[i] = (need[i] as number) - 1;
        });
        if (need[i] === 0) ready(i);
      }
    }
    return { queue, rank, why, built };
  };

  // The `lava-centrifuge` category also leaves out every other recipe that mines an ore material from free inputs. The
  // free closure is judged with the multiblocks a first pass builds (else the Eye of Harmony, which consumes nothing,
  // would put half the pack in it), then the fixpoint runs again without those recipes.
  let fromNothing: ReadonlySet<number> = new Set<number>();
  let pass = run(fromNothing);
  if (env.excluded.has(FREE_INPUT_CATEGORY)) {
    const first = pass.built;
    fromNothing = fromNothingRecipes(pack, (i) => {
      const gate = gateOf(i);
      return gate !== null && (gate.length === 0 || gate.some((id) => first.has(id)));
    });
    if (fromNothing.size > 0) pass = run(fromNothing);
  }
  const { queue, rank, why, built } = pass;

  const available: ReadonlySet<StuffKey> = new Set(queue);
  const byproductOf = new Map<string, string[]>();   // byproduct material → the direct materials whose ore yields it
  for (const [material, byproducts] of Object.entries(pack.worldgen.byproducts)) {
    if (!materialSources.has(material)) continue;
    for (const byproduct of unique(byproducts)) addTo(byproductOf, byproduct, material);
  }
  const baseMaterialOf = (key: StuffKey): string | undefined => baseMaterialWith(pack, facts.partOf, key);
  const displayName = (material: string): string => pack.materials.get(material)?.displayName ?? material;

  const classOf = (key: StuffKey): LeafClass => {
    if (FREE.has(key)) return 'free';
    if (facts.natural.has(key) || gathered.has(key) || dropped.has(key)) return 'natural';
    if (direct.has(key)) return 'direct';
    if (!available.has(key)) return 'unavailable';
    const material = baseMaterialOf(key);
    return material !== undefined && byproductOf.has(material) ? 'byproduct' : 'derived';
  };

  /** The filled container `r` only empties into `key` (a canner: Ethylene Cell → Ethylene + Empty Cell), if it is one. */
  const emptiedFrom = (r: Recipe, key: StuffKey): StuffKey | undefined => {
    const consumed = r.inputs.filter((ing) => ing.consumed);
    const only = consumed.length === 1 ? consumed[0]!.options[0]?.key : undefined;
    return only !== undefined && (pack.fluidContainers ?? []).some((c) => c.container === only && c.fluid === key) ? only : undefined;
  };
  const derivedSource = (key: StuffKey): SourceInfo[] => {
    let r = pack.recipeById.get(why.get(key) ?? '');
    // A fluid first reached by emptying its cell is described by what made the cell (the chemistry, not the canner).
    const cell = r === undefined ? undefined : emptiedFrom(r, key);
    if (cell !== undefined) r = pack.recipeById.get(why.get(cell) ?? '') ?? r;
    if (r === undefined) return [];
    const accepted = acceptRecipe(pack, r, { ...env, multiblocks: built });
    const mapId = accepted.ok ? accepted.mapId : (r.maps[0] ?? '');
    const inputs = firstOptions(r, rank).map((k) => pack.nameOf(k));
    const by = `made by ${pack.maps.get(mapId)?.name ?? mapId}`;
    return [{ kind: 'derived', dims: [], detail: inputs.length > 0 ? `${by} from ${inputs.join(', ')}` : by }];
  };

  const sources = (key: StuffKey): SourceInfo[] => {
    switch (classOf(key)) {
      case 'free':
        return [{ kind: 'natural', dims: [], detail: 'free' }];
      case 'natural': {
        const drop = dropped.get(key);
        if (drop !== undefined) return [{ kind: 'natural', dims: [drop], detail: 'mob drop' }];
        const dim = gathered.get(key);
        return dim === undefined
          ? [{ kind: 'natural', dims: [OVERWORLD], detail: 'gathered by hand' }]
          : [{ kind: 'natural', dims: [dim], detail: 'gathered (dig it)' }];
      }
      case 'direct': {
        const list = isFluidKey(key) ? fluidSources.get(key) : materialSources.get(baseMaterialOf(key) ?? '');
        return (list ?? []).map((s) => copyOf(s.info));
      }
      case 'byproduct':
        return (byproductOf.get(baseMaterialOf(key) ?? '') ?? []).map((material) => ({
          kind: 'byproduct', dims: unique((materialSources.get(material) ?? []).flatMap((s) => s.info.dims)),
          detail: `byproduct of ${displayName(material)} ore`,
        }));
      case 'derived':
        return derivedSource(key);
      default:
        return [];
    }
  };

  const derivedFrom = (key: StuffKey): StuffKey[] => {
    const r = pack.recipeById.get(why.get(key) ?? '');
    return r === undefined ? [] : firstOptions(r, rank, true);
  };

  let depths: ReadonlyMap<StuffKey, number> | undefined;
  const depth = (key: StuffKey): number => (depths ??= depthsOf(pack, queue, why)).get(key) ?? 0;

  const fromNothingIds = new Set([...fromNothing].map((i) => (pack.recipes[i] as Recipe).id));
  return {
    avail: { tier: env.tier, available, classOf, sources, why, derivedFrom, depth, multiblocks: built, fromNothing: fromNothingIds },
    rank, materialSources, fluidSources,
  };
}

/**
 * `Availability.depth` of every good of `available` (fix spec R6), worked out once per state: the seeds (goods with no
 * `why` recipe) are 0, and a good whose first-found recipe has its last consumed slot filled by a good of depth d is
 * d + 1, the slots filled layer by layer, so each slot counts the smallest depth among its options and each recipe the
 * largest of its slots (a recipe that consumes nothing is 1). Every available good gets one: its recipe fired once every
 * slot had an option that became available before it. Built bottom-up rather than by following each good back, so a loop
 * in the data (an option made from the good itself) never counts, and a depth never depends on which good is asked
 * about first.
 */
function depthsOf(pack: Pack, available: readonly StuffKey[], why: ReadonlyMap<StuffKey, string>): Map<StuffKey, number> {
  const depth = new Map<StuffKey, number>();
  /** The goods each first-found recipe made available, by recipe id. */
  const madeBy = new Map<string, StuffKey[]>();
  for (const [key, id] of why) addTo(madeBy, id, key);
  /** Consumed slots per recipe that no settled good fills yet, and the slots each good can fill, with their recipe. */
  const open = new Map<string, number>();
  const fills = new Map<StuffKey, Array<{ id: string; slot: Ingredient }>>();
  const filled = new Set<Ingredient>();
  let layer: StuffKey[] = available.filter((key) => !why.has(key));
  let next: StuffKey[] = [];
  /** The goods recipe `id` made available have depth `d`; they fill slots in the next round. */
  const settle = (id: string, d: number): void => {
    for (const key of madeBy.get(id) ?? []) {
      if (depth.has(key)) continue;
      depth.set(key, d);
      next.push(key);
    }
  };
  for (const key of layer) depth.set(key, 0);
  for (const id of madeBy.keys()) {
    const slots = (pack.recipeById.get(id)?.inputs ?? []).filter((ing) => ing.consumed);
    open.set(id, slots.length);
    for (const slot of slots) for (const o of slot.options) addTo(fills, o.key, { id, slot });
    if (slots.length === 0) settle(id, 1);
  }
  for (let d = 0; layer.length > 0 || next.length > 0; d++) {
    for (const key of layer) {
      for (const { id, slot } of fills.get(key) ?? []) {
        if (filled.has(slot)) continue;
        filled.add(slot);
        const left = (open.get(id) as number) - 1;
        open.set(id, left);
        if (left === 0) settle(id, d + 1);
      }
    }
    layer = next;
    next = [];
  }
  return depth;
}

/** Availability results per pack, keyed by the env's content; the least recently used entry goes first. */
const STATES = new WeakMap<Pack, Map<string, State>>();

/**
 * Excluded categories availability does not apply. From LV every group has programmed circuits (`computeState`), and
 * crafting one back into an Electronic Circuit is the only way the export shows to the first circuits: the circuit
 * assembler's vacuum tube needs a glass tube, whose ball mold comes from a Tinkers' casting table, not a recipe.
 * Skipping that crafting (the default) only steers the plan to GTNH's circuit-assembler route; without it here no
 * LV group could build an Electric Blast Furnace.
 */
const AVAILABILITY_KEEPS: ReadonlySet<string> = new Set(['programmed-circuit-conversion']);

function stateFor(pack: Pack, env: PlanEnv): State {
  let perPack = STATES.get(pack);
  if (perPack === undefined) {
    perPack = new Map();
    STATES.set(pack, perPack);
  }
  const reachable = [...env.reachable].sort(byString);
  const excluded = [...env.excluded].filter((category) => !AVAILABILITY_KEEPS.has(category)).sort(byString);
  const key = JSON.stringify([env.tier, reachable, env.lowGravity, env.coilHeat, excluded]);
  let state = perPack.get(key);
  if (state !== undefined) {
    perPack.delete(key);
  } else {
    // A snapshot: the caller may change its own sets later, the cached result must not.
    state = computeState(pack, { tier: env.tier, reachable: new Set(reachable), lowGravity: env.lowGravity, coilHeat: env.coilHeat, excluded: new Set(excluded) });
    if (perPack.size >= CACHE_SIZE) perPack.delete(perPack.keys().next().value as string);
  }
  perPack.set(key, state);
  return state;
}

/** Which goods the group can get at `env` and how (materials-availability §8.1); cached per pack and env, 32 entries. */
export function computeAvailability(pack: Pack, env: PlanEnv): Availability {
  return stateFor(pack, env).avail;
}

/** The goods without a recipe behind them (free, natural, direct) that `key` was first made from. */
function seedsOf(pack: Pack, state: State, key: StuffKey): StuffKey[] {
  const seeds: StuffKey[] = [];
  const seen = new Set<StuffKey>();
  const stack = [key];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const r = pack.recipeById.get(state.avail.why.get(next) ?? '');
    if (r === undefined) seeds.push(next);
    else stack.push(...firstOptions(r, state.rank));   // each became available before `next`, so this ends
  }
  return seeds;
}

/** The sources of a seed that is a direct material's base item or a sourced fluid (none for free and natural goods). */
function sourcesOf(pack: Pack, state: State, seed: StuffKey): Source[] {
  const list = isFluidKey(seed)
    ? state.fluidSources.get(seed)
    : state.materialSources.get(baseMaterialWith(pack, factsOf(pack).partOf, seed) ?? '');
  return list ?? [];
}

/** Dimension (with its rocket tier) and capability names of `keys`, in the pack's order. */
function placeNames(worldgen: Worldgen, keys: ReadonlySet<string>): string[] {
  const names: string[] = [];
  for (const dim of worldgen.dimensions) {
    if (keys.has(dim.key)) names.push(dim.rocketTier === undefined ? dim.name : `${dim.name} (T${dim.rocketTier} rocket)`);
  }
  for (const capability of worldgen.capabilities) if (keys.has(capability.key)) names.push(capability.name);
  return names;
}

/**
 * What would make `key` available (materials-availability §8.1 "Unlock hints"): the first tier above `from.env.tier`
 * at which progression defaults (same visited dimensions, the tier's default coils unless the project sets them) make
 * it available, and the dimensions new at that tier that its first chain relies on: only the seeds that first appear
 * at that tier count, so a seed the group already gets, or could get from a place it already reaches (or from no
 * place) once its tier allows, names no dimension. The places of one seed are alternatives (" or "); different seeds
 * are each needed (" and "): "needs Mars (T2 rocket) and Moon (T1 rocket)" when copper is only on the Moon and tin only
 * on Mars, "needs Moon (T1 rocket) and either Mars (T2 rocket) or Phobos (T2 rocket)" when tin is on both.
 */
export function unlockText(pack: Pack, key: StuffKey, from: { env: PlanEnv; settings: PlanSettings; visited: readonly string[] }): string {
  const name = pack.nameOf(key);
  for (let tier = from.env.tier + 1; tier <= MAX_TIER; tier++) {
    const reach = reachableDims(pack.worldgen, PROGRESSION, from.visited, tier);
    const state = stateFor(pack, {
      tier, reachable: reach.keys, lowGravity: reach.lowGravity, coilHeat: from.settings.coilHeat ?? defaultCoilHeat(tier), excluded: from.env.excluded,
    });
    if (!state.avail.available.has(key)) continue;
    const now = stateFor(pack, from.env).avail.available;
    const reachedNow = (s: Source): boolean => s.reach.length === 0 || s.reach.some((place) => from.env.reachable.has(place));
    // One set of places per seed: any of them gives that seed, but every seed is needed.
    const needs: Array<Set<string>> = [];
    for (const seed of seedsOf(pack, state, key)) {
      if (now.has(seed)) continue;
      const sources = sourcesOf(pack, state, seed);
      if (sources.some(reachedNow)) continue;   // a fluid source the group reaches, gated only by its minimum tier
      const places = new Set<string>();
      for (const s of sources) for (const place of s.reach) places.add(place);
      if (places.size > 0) needs.push(places);
    }
    // A seed whose places include all of another seed's is covered by going there: only the smaller set is named.
    needs.sort((a, b) => a.size - b.size);
    const kept: Array<Set<string>> = [];
    for (const places of needs) if (!kept.some((k) => [...k].every((place) => places.has(place)))) kept.push(places);
    // Required places first, then the choices ("and either Mars or Phobos"), each by name.
    const named = kept.map((places) => placeNames(pack.worldgen, places)).filter((names) => names.length > 0)
      .sort((a, b) => a.length - b.length || byString(a[0] as string, b[0] as string));
    const groups = named.map((names) => (named.length > 1 && names.length > 1 ? `either ${names.join(' or ')}` : names.join(' or ')));
    return groups.length > 0 ? `${name}: needs ${groups.join(' and ')} — reachable at ${tierName(tier)}` : `${name}: needs ${tierName(tier)} machines`;
  }
  return `${name}: no source in this pack's data`;
}
