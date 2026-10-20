// The planner's basis: the one place that turns a project's settings and the world context into the tier, the
// reachable dimensions, the environment the candidate recipes are judged in, material availability, prices, the free
// inputs the line makes itself and the leaf oracle, so `planLine` and `expandBomLines` always derive them the same way.
// Also the settings hash, and the part of the world context the basis reads (`basisContextKey`), which together key
// what is derived from them (pricing.ts); and the goods an avoid list covers (`resolveAvoid`), which only `planLine`'s
// own graphs honor (plan.ts).

import { createHash } from 'node:crypto';
import { defaultCoilHeat } from '../../shared/gt/overclock.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Pack, Recipe } from '../../shared/types/pack.ts';
import { FREE_KEYS, type PlanContext, type PlanSettings } from '../../shared/types/plan.ts';
import { suppliedKey } from '../pack/supply.ts';
import { computeAvailability, reachableDims, type Availability, type Reachability } from './availability.ts';
import { acceptRecipe, type LeafOracle, type PlanEnv } from './candidates.ts';
import { makeLeafOracle, makePrices, type PriceTable } from './costs.ts';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A copy of `value` whose objects list their keys in sorted order, at every depth; arrays keep their order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort(byString).map((key) => [key, withSortedKeys(record[key])]));
}

/**
 * The first 16 hex digits of the SHA-1 of the settings as JSON with every object's keys sorted. An empty or missing avoid
 * list is left out: it plans like none, and a project stored before the list existed keeps its hash.
 */
export function settingsHash(s: PlanSettings): string {
  const { avoid, ...rest } = s;
  const hashed = (avoid ?? []).length === 0 ? rest : s;
  return createHash('sha1').update(JSON.stringify(withSortedKeys(hashed))).digest('hex').slice(0, 16);
}

const MATERIAL_GOODS = new WeakMap<Pack, Map<string, StuffKey[]>>();

/**
 * Every material name of the pack (a key of `pack.materials` or some `Item.gt.material`) → its goods, sorted by key: the
 * items of that material, the items its `GtMaterial.parts` lists, and whichever of the fluids `molten.<id>`,
 * `plasma.<id>` and `<id>` the pack has, `<id>` being the name in lower case without spaces (as molten fluid ids spell
 * materials; the export links no other fluid to a material). Built once per pack.
 */
function materialGoods(pack: Pack): Map<string, StuffKey[]> {
  let byName = MATERIAL_GOODS.get(pack);
  if (byName !== undefined) return byName;
  const sets = new Map<string, Set<StuffKey>>();
  const setOf = (name: string): Set<StuffKey> => {
    let set = sets.get(name);
    if (set === undefined) sets.set(name, (set = new Set()));
    return set;
  };
  for (const [name, material] of pack.materials) {
    const set = setOf(name);
    for (const key of Object.values(material.parts ?? {})) if (key !== undefined) set.add(key);
  }
  for (const item of pack.items.values()) if (item.gt !== undefined) setOf(item.gt.material).add(item.key);
  for (const [name, set] of sets) {
    const id = name.toLowerCase().replaceAll(' ', '');
    for (const fluid of [`fluid:molten.${id}`, `fluid:plasma.${id}`, `fluid:${id}`]) if (pack.fluids.has(fluid)) set.add(fluid);
  }
  byName = new Map([...sets].map(([name, set]) => [name, [...set].sort(byString)]));
  MATERIAL_GOODS.set(pack, byName);
  return byName;
}

/**
 * The goods an avoid list covers (architecture §11.25, ruling R5): an entry that is a material name of the pack, exactly
 * (case as exported), stands for every good of that material (`materialGoods`); else one that is an item or fluid key
 * for that good; any other entry matches nothing and is `unknown` (once, in list order). A material of the pack with no
 * goods (the export's `AnyCopper`, `Nano`, …) is no unknown entry, but matches nothing either: it is `empty` (once, in
 * list order), so the plan can say so.
 */
export function resolveAvoid(pack: Pack, avoid: readonly string[]): { goods: Set<StuffKey>; unknown: string[]; empty: string[] } {
  const byName = materialGoods(pack);
  const goods = new Set<StuffKey>();
  const unknown: string[] = [];
  const empty: string[] = [];
  for (const entry of new Set(avoid)) {
    const material = byName.get(entry);
    if (material !== undefined) {
      for (const key of material) goods.add(key);
      if (material.length === 0) empty.push(entry);
    } else if (pack.items.has(entry) || pack.fluids.has(entry)) {
      goods.add(entry);
    } else {
      unknown.push(entry);
    }
  }
  return { goods, unknown, empty };
}

const MATERIAL_LIST = new WeakMap<Pack, ReadonlyArray<{ name: string; label: string }>>();

/**
 * The material names an avoid entry can usefully be (`resolveAvoid`): those with at least one good, so the picker never
 * offers one that avoids nothing (the real export has 80 such materials of 1,355: `AnyCopper`, `AnyIron`, `Nano`, …).
 * Each comes with its display name (`GtMaterial.displayName`, else the name), sorted by display name then name; once per
 * pack. The settings panel suggests them (ruling R12).
 */
export function avoidableMaterials(pack: Pack): ReadonlyArray<{ name: string; label: string }> {
  let list = MATERIAL_LIST.get(pack);
  if (list === undefined) {
    list = [...materialGoods(pack)].filter(([, goods]) => goods.length > 0).map(([name]) => name)
      .map((name) => ({ name, label: pack.materials.get(name)?.displayName ?? name }))
      .sort((a, b) => byString(a.label, b.label) || byString(a.name, b.name));
    MATERIAL_LIST.set(pack, list);
  }
  return list;
}

/** The tier the line is planned at: the project's own, else the world's top tier, else LV. */
export function effectiveTier(s: PlanSettings, ctx: PlanContext): number {
  return s.tier ?? ctx.topTier ?? 1;
}

/**
 * Every field of the world context `planBasis` reads (top tier, coil heat, visited dimensions, in their order): two
 * contexts with the same key give the same basis for the same settings. Whatever `planBasis` starts reading of the
 * context must be added here.
 */
export function basisContextKey(ctx: PlanContext): string {
  return JSON.stringify([ctx.topTier, ctx.coilHeat, ctx.visitedDims]);
}

export interface PlanBasis {
  tier: number; coilHeat: number; reach: Reachability; env: PlanEnv; avail: Availability; prices: PriceTable; leaf: LeafOracle;
  /** The free inputs the line makes with a supply recipe instead of buying them (`suppliedFreeKeys`, fix spec R2). */
  supplied: ReadonlySet<StuffKey>;
  /**
   * The basis of the same settings and world at another tier: what a plan at that tier would get and run (plan.ts names
   * the tier at which the group could melt a metal it has). Its availability is cached per pack as every basis's is.
   */
  at(tier: number): PlanBasis;
}

const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
const SUPPLY_RECIPES = new WeakMap<Pack, ReadonlyMap<StuffKey, readonly Recipe[]>>();

/** The supply recipes of the pack (`Recipe.meta.supply`) by the free input each gives a line (`suppliedKey`), once per pack. */
function supplyRecipes(pack: Pack): ReadonlyMap<StuffKey, readonly Recipe[]> {
  let byKey = SUPPLY_RECIPES.get(pack);
  if (byKey === undefined) {
    const lists = new Map<StuffKey, Recipe[]>();
    for (const r of pack.recipes) {
      const key = suppliedKey(r, pack.fluidContainers);
      if (key === undefined || !FREE.has(key)) continue;
      const list = lists.get(key);
      if (list === undefined) lists.set(key, [r]);
      else list.push(r);
    }
    byKey = lists;
    SUPPLY_RECIPES.set(pack, byKey);
  }
  return byKey;
}

/**
 * The free inputs a running line makes itself (fix spec R2, architecture §11.26): in rate mode, each free key the group
 * does not already supply (`settings.haveSupply`) that a supply recipe makes, directly or as the fluid of the cells it
 * fills, and the group can run here (`acceptRecipe` in `env`). The leaf oracle then never buys them, so the line plans
 * their generator. A Make N batch takes them free, and so does a tier with no supply machine (ULV).
 */
function suppliedFreeKeys(pack: Pack, settings: PlanSettings, env: PlanEnv): ReadonlySet<StuffKey> {
  const supplied = new Set<StuffKey>();
  if (settings.mode !== 'rate') return supplied;
  const have = new Set(settings.haveSupply ?? []);
  for (const [key, recipes] of supplyRecipes(pack)) {
    if (!have.has(key) && recipes.some((r) => acceptRecipe(pack, r, env).ok)) supplied.add(key);
  }
  return supplied;
}

/**
 * The planner's environment for a project in a world: tier (`effectiveTier`); coil heat (the project's, else the
 * world's, else the default coil of the tier); the dimensions it reaches; what it can get there; the env candidate
 * recipes are judged in, with the multiblocks it can build; prices with the project's cost overrides; the free inputs
 * the line makes itself (`supplied`); and the leaf oracle over those (derived leaves at their plain price: `linePricing`
 * in pricing.ts prices the ones a line buys).
 */
export function planBasis(pack: Pack, settings: PlanSettings, ctx: PlanContext): PlanBasis {
  const tier = effectiveTier(settings, ctx);
  const coilHeat = settings.coilHeat ?? ctx.coilHeat ?? defaultCoilHeat(tier);
  const reach = reachableDims(pack.worldgen, settings.dims, ctx.visitedDims, tier);
  const open: PlanEnv = { tier, reachable: reach.keys, lowGravity: reach.lowGravity, coilHeat, excluded: new Set(settings.excludedCategories) };
  const avail = computeAvailability(pack, open);
  // Candidate recipes may only use the multiblocks the group can build at this tier, and never mine an ore material
  // from free inputs alone (availability.ts).
  const env: PlanEnv = { ...open, multiblocks: avail.multiblocks, fromNothing: avail.fromNothing };
  const prices = makePrices(pack, settings.costOverrides);
  const supplied = suppliedFreeKeys(pack, settings, env);
  const leaf = makeLeafOracle(pack, settings, avail, prices, undefined, undefined, { supplied });
  const basis: PlanBasis = {
    tier, coilHeat, reach, env, avail, prices, leaf, supplied,
    at: (other) => (other === tier ? basis : planBasis(pack, { ...settings, tier: other }, ctx)),
  };
  return basis;
}
