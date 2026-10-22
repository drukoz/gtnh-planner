// Material cost (spec §3.3, architecture §5, prior-art §3.3–§3.4): prices in ingot-equivalents, the leaf oracle that
// decides which goods a line may buy, and a YAFC-style cost analysis (learn-only reference, no code copied) that gives
// every good of a candidate graph its cheapest raw cost. That cost only ranks alternative recipes and prices "we already
// make this" goods; the plan itself always comes from the main LP (solve.ts).

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import { FREE_KEYS, type PlanSettings } from '../../shared/types/plan.ts';
import { GATHERED_BLOCKS, isBaseItem, isOrePrefix, type Availability } from './availability.ts';
import type { CandidateGraph, LeafDecision, LeafOracle } from './candidates.ts';
import type { Standalone } from './solve.ts';
import { solveLp, type LpRow } from './lp.ts';

/** GT's material unit: one dust or ingot is 3628800 M. */
export const M_UNITS = 3628800;
/** Litres of molten metal per ingot (GTValues.L). */
const LITRES_PER_INGOT = 144;
/** Any other fluid costs 1 per 1,000 L. */
const LITRES_PER_UNIT = 1000;
const MOLTEN_PREFIX = 'fluid:molten.';
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
/** Upper bound of a good the line cannot buy in the cost analysis; reaching it means nothing reachable makes the good. */
const UNREACHED = 1e6;
const UNREACHED_TOLERANCE = 1e-6;
/** A good is makeable when the makeability LP gives it a surplus above this; at the optimum every surplus is 0 or 1. */
const MAKEABLE = 0.5;
/**
 * With supporting lines off (`routeDerived: false`), a derived material is bought only within this many recipe layers
 * of the seeds (`Availability.depth`; fix spec R6): on the 2.9 export that keeps stock alloys (red alloy 1, soldering
 * alloy 2, annealed copper 2, redstone alloy 3, gallium arsenide 3, aluminium at MV 4) and leaves out plastics and
 * petrochemicals (polyethylene 6, PVC 6, PTFE 7, epoxid 8, SBR 8).
 */
export const DERIVED_LEAF_MAX_DEPTH = 4;
/** GT prefixes of the material forms an ore gives: only a line whose target has one of them buys ore blocks (fix spec R8). */
export const ORE_LINE_PREFIXES: readonly string[] = Object.freeze(['dust', 'ingot', 'gem', 'nugget', 'crushed', 'ore', 'rawOre']);

export interface PriceTable { price(key: StuffKey): number /* per item or per litre */; costPerIngot(material: string): number }

function own(record: Record<string, number>, key: string): number | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const MOLTEN_MATERIALS = new WeakMap<Pack, Map<string, string>>();

/** Material names by their lower-case form without spaces, as molten fluid ids spell them; the first name wins. */
function moltenMaterials(pack: Pack): Map<string, string> {
  let byId = MOLTEN_MATERIALS.get(pack);
  if (byId === undefined) {
    byId = new Map();
    for (const name of pack.materials.keys()) {
      const id = name.toLowerCase().replaceAll(' ', '');
      if (!byId.has(id)) byId.set(id, name);
    }
    MOLTEN_MATERIALS.set(pack, byId);
  }
  return byId;
}

/** The material a molten fluid (`fluid:molten.<id>`) is of: `fluid:molten.redalloy` → `RedAlloy`; none for other keys. */
export function moltenMaterial(pack: Pack, key: StuffKey): string | undefined {
  return key.startsWith(MOLTEN_PREFIX) ? moltenMaterials(pack).get(key.slice(MOLTEN_PREFIX.length)) : undefined;
}

/**
 * Prices in ingot-equivalents (architecture §5). `overrides` holds per-project costs by key (which win over every rule)
 * and costs per ingot by material name. A molten fluid whose material the pack does not list still counts 144 L per ingot.
 */
export function makePrices(pack: Pack, overrides: Record<string, number>): PriceTable {
  const costPerIngot = (material: string): number => own(overrides, material) ?? 1;
  const price = (key: StuffKey): number => {
    const override = own(overrides, key);
    if (override !== undefined) return override;
    if (FREE.has(key)) return 0;
    if (isFluidKey(key)) {
      if (pack.fluids.get(key)?.molten !== true) return 1 / LITRES_PER_UNIT;
      const material = moltenMaterial(pack, key);
      return (material === undefined ? 1 : costPerIngot(material)) / LITRES_PER_INGOT;
    }
    const gt = pack.items.get(key)?.gt;
    if (gt === undefined) return 1;
    const ingots = isOrePrefix(gt.prefix) || gt.amount <= 0 ? 1 : gt.amount / M_UNITS;
    return costPerIngot(gt.material) * ingots;
  };
  return { price, costPerIngot };
}

/**
 * The least a "we already make this" item costs (architecture §11 entry 41 (6)): its plain price (`prices`) when it is a GT
 * material form or a molten fluid — never less than the metal in it — else 0, so a part without GT data costs what its
 * own chain costs.
 */
export function stopFloor(pack: Pack, prices: PriceTable): (key: StuffKey) => number {
  return (key) => (pack.items.get(key)?.gt !== undefined || pack.fluids.get(key)?.molten === true ? prices.price(key) : 0);
}

const NOT_A_LEAF: LeafDecision = { buyable: false, cost: 0, leafClass: null };
const UNAVAILABLE: LeafDecision = { buyable: false, cost: 0, leafClass: 'unavailable' };
const NO_KEYS: ReadonlySet<StuffKey> = new Set();

/** A cost override for `key` itself, its GT material, or the material of its molten fluid (the rules of `makePrices`). */
export function hasCostOverride(pack: Pack, overrides: Record<string, number>, key: StuffKey): boolean {
  if (Object.hasOwn(overrides, key)) return true;
  const material = pack.items.get(key)?.gt?.material ?? moltenMaterial(pack, key);
  return material !== undefined && Object.hasOwn(overrides, material);
}

const ORE_PARTS = new WeakMap<Pack, ReadonlySet<StuffKey>>();

/** An ore block or raw ore: its GT prefix is an ore prefix (`isOrePrefix`), or some material lists it as its ore part. */
export function isOreBlock(pack: Pack, key: StuffKey): boolean {
  const prefix = pack.items.get(key)?.gt?.prefix;
  if (prefix !== undefined && isOrePrefix(prefix)) return true;
  let parts = ORE_PARTS.get(pack);
  if (parts === undefined) {
    const keys = new Set<StuffKey>();
    for (const material of pack.materials.values()) {
      for (const part of [material.parts?.ore, material.parts?.rawOre]) if (part !== undefined) keys.add(part);
    }
    parts = keys;
    ORE_PARTS.set(pack, parts);
  }
  return parts.has(key);
}

/** The line makes a material form an ore gives (`ORE_LINE_PREFIXES`): its target is a GT item with such a prefix. */
function isMaterialLine(pack: Pack, target: StuffKey | null): boolean {
  const prefix = target === null ? undefined : pack.items.get(target)?.gt?.prefix;
  return prefix !== undefined && ORE_LINE_PREFIXES.some((p) => prefix.startsWith(p));
}

/**
 * Which goods the line buys (spec §3.3, §5): "we already make this" items at their cost (key override, else `stopCost`,
 * else the price), free and natural goods (gathered blocks among them, fix spec R1) except the free inputs of
 * `opts.supplied` (`PlanBasis.supplied`, fix spec R2: a running line makes those with their generator, a rock breaker,
 * pump or compressor), and base items the group can get at its tier, with three exceptions (fix spec R5, R6, R8):
 * - a derived fluid is never bought: a sourced fluid is bought only where a source is reachable (`direct`), and every
 *   other fluid the line needs is made, so chemicals such as ethylene get a line behind them;
 * - a derived base item is bought only while the project does not plan supporting lines (`routeDerived`) and only when
 *   it is shallow (`Availability.depth` at most `DERIVED_LEAF_MAX_DEPTH`: alloys, not plastics), and then at
 *   `derivedCost` when that knows what making it costs and no cost override names it (with the recipes and free input
 *   of its chain, `LeafDecision.steps` and `free`), else at its price. When `derivedCost` says Infinity (only a chain
 *   through the line's target makes it: Magnetic Steel for Steel) it is no leaf at all, so the line never buys a form of
 *   its own target;
 * - an ore block or raw ore (`isOreBlock`) is bought only by a line whose target is a material form an ore gives
 *   (`isMaterialLine`): any other line bought Chalcopyrite Ore to run ore processing for its sulfuric acid and copper.
 * Base items it cannot get are never buyable.
 *
 * With `opts.gatheredRecipes` (plan 12, change request 13: for the line's own graph where basis.ts `gatheredRecipesOn`
 * says so, build cost counted on an AE2 or Project Red line; Task 5 passes it), a gathered world block
 * (`GATHERED_BLOCKS`) that availability classes `natural` (its dimension is reachable) is that same leaf, at its price
 * and with its "gathered (dig it)" source, and `alsoMade` too, so the candidate walk also offers its recipes and the LP
 * weighs digging it against making it (rock-breaker cobblestone → gravel → sand), machines and step charges counted.
 * Logs, crops and other natural items get no `alsoMade`, and expand and stop items keep their decisions. The cost model,
 * machine prices and build-material breakdowns never pass it: there gathered blocks are dug.
 *
 * `derivedCost` is what making the derived item on its own costs (pricing.ts: `standaloneCosts` over the cost model's
 * graph, where derived materials are routed, never below its price), undefined when that is not known. A flat price of
 * 1 made exotic derived dusts the cheapest way to make ordinary parts (Poly-Si and gallium arsenide wafers for an
 * Electronic Circuit), and a price above what the line pays to make it in place made the LP route the whole chain
 * anyway (the 20-step oil chain behind an Epoxid Bar priced at 1 while making it costs 0.69). At exactly that cost,
 * buying it and making it in place tie and the later stages (fewest recipes, then power) choose.
 */
export function makeLeafOracle(
  pack: Pack, settings: PlanSettings, avail: Availability, prices: PriceTable, stopCost?: (key: StuffKey) => number,
  derivedCost?: (key: StuffKey) => Standalone | undefined, opts?: { supplied?: ReadonlySet<StuffKey>; gatheredRecipes?: boolean },
): LeafOracle {
  const supplied = opts?.supplied ?? NO_KEYS;
  const gatheredRecipes = opts?.gatheredRecipes === true;
  /** A derived leaf: its price under a cost override, else what making it costs, else its price. */
  const derived = (key: StuffKey): LeafDecision => {
    const made = hasCostOverride(pack, settings.costOverrides, key) ? undefined : derivedCost?.(key);
    if (made === undefined) return { buyable: true, cost: prices.price(key), leafClass: 'derived' };
    // Only a chain through the target itself makes it: the line cannot buy it to make the target.
    return Number.isFinite(made.cost) ? { buyable: true, cost: made.cost, leafClass: 'derived', steps: made.steps, free: made.free } : NOT_A_LEAF;
  };
  const expand = new Set(settings.expandItems);
  const stop = new Set(settings.stopItems);
  const buysOres = isMaterialLine(pack, settings.target);
  return (key) => {
    if (expand.has(key)) return NOT_A_LEAF;
    if (stop.has(key)) {
      return { buyable: true, cost: own(settings.costOverrides, key) ?? stopCost?.(key) ?? prices.price(key), leafClass: 'stop' };
    }
    const leafClass = avail.classOf(key);
    if (leafClass === 'free' && supplied.has(key)) return NOT_A_LEAF;
    if (leafClass === 'natural' && gatheredRecipes && Object.hasOwn(GATHERED_BLOCKS, key)) {
      return { buyable: true, cost: prices.price(key), leafClass, alsoMade: true };
    }
    if (leafClass === 'free' || leafClass === 'natural') return { buyable: true, cost: prices.price(key), leafClass };
    if (!isBaseItem(pack, key)) return NOT_A_LEAF;
    switch (leafClass) {
      case 'direct':
      case 'byproduct':
        if (!buysOres && isOreBlock(pack, key)) return NOT_A_LEAF;
        return { buyable: true, cost: prices.price(key), leafClass };
      case 'derived':
        if (isFluidKey(key) || settings.routeDerived || avail.depth(key) > DERIVED_LEAF_MAX_DEPTH) return NOT_A_LEAF;
        return derived(key);
      case 'unavailable':
        return UNAVAILABLE;
      default:
        return NOT_A_LEAF;
    }
  };
}

export interface CostAnalysis { cost(key: StuffKey): number /* Infinity when nothing reachable makes it */; recipeCost(recipeId: string, forKey: StuffKey): number }

/**
 * The goods of `graph` the line can make in steady state, from the main LP's own rows (solve.ts): an activity
 * `x_r ≥ 0` per recipe, a purchase `b_g ≥ 0` per buyable good and a surplus `s_g` in `[0, 1]` per good, one row
 * `Σ a_rg·x_r + b_g − s_g ≥ 0` per good, maximizing `Σ s_g`. Apart from `s ≤ 1` the LP is a cone, so at the optimum
 * every surplus is 0 or 1, and a good is makeable exactly when some steady state yields a surplus of it: a loop with no
 * entry recipe counts when it gains, and goods that only unreachable goods make never count, whatever the yield.
 */
async function makeableGoods(graph: CandidateGraph, goods: readonly StuffKey[], indexOf: ReadonlyMap<StuffKey, number>): Promise<Set<StuffKey>> {
  const recipeCount = graph.recipes.length;
  const buyable = goods.filter((key) => graph.goods.get(key)?.buyable === true);
  const firstSurplus = recipeCount + buyable.length;
  const width = firstSurplus + goods.length;

  const entries: Array<Array<[number, number]>> = goods.map(() => []);
  const rowOf = (key: StuffKey): Array<[number, number]> => entries[indexOf.get(key) as number] as Array<[number, number]>;
  graph.recipes.forEach((r, j) => {
    for (const [key, c] of r.coeffs) rowOf(key).push([j, c]);
  });
  buyable.forEach((key, i) => rowOf(key).push([recipeCount + i, 1]));
  const rows: LpRow[] = entries.map((row, g) => ({ lower: 0, upper: Infinity, entries: [...row, [firstSurplus + g, -1]] }));

  const result = await solveLp({
    sense: 'max',
    colCost: new Array<number>(width).fill(0, 0, firstSurplus).fill(1, firstSurplus),
    colLower: new Array<number>(width).fill(0),
    colUpper: new Array<number>(width).fill(Infinity, 0, firstSurplus).fill(1, firstSurplus),
    rows,
  });
  if (result.status !== 'optimal') throw new Error(`cost analysis: the makeability LP is ${result.status}`);
  return new Set(goods.filter((_, g) => (result.x[firstSurplus + g] ?? 0) > MAKEABLE));
}

/**
 * YAFC-style dual LP (prior-art §3.4 step 2): one cost variable per good, in `[0, cost]` for a buyable good and
 * `[0, 1e6]` otherwise; maximize the sum of all costs subject to `Σ out·c − Σ in·c ≤ 0` for each recipe that can run,
 * so every good gets the cost of its cheapest way to make or buy it. A recipe can run when every good it consumes
 * (negative coefficient) is makeable (`makeableGoods`): a recipe that cannot run must not make anything look cheaper,
 * so a good the line cannot make is in no row, stays at its 1e6 bound and reads as Infinity. The LP is always feasible
 * (all zeros) and bounded. With co-products the split of a recipe's cost between them is not unique, so these costs
 * rank and price; they never plan.
 */
export async function analyzeCosts(graph: CandidateGraph): Promise<CostAnalysis> {
  const keys = new Set(graph.goods.keys());
  for (const r of graph.recipes) for (const [key] of r.coeffs) keys.add(key);
  const columns = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const columnOf = new Map(columns.map((key, i) => [key, i]));

  const makeable = await makeableGoods(graph, columns, columnOf);
  const runnable = graph.recipes.filter((r) => r.coeffs.every(([key, c]) => c >= 0 || makeable.has(key)));
  const upper = columns.map((key) => {
    const good = graph.goods.get(key);
    return good?.buyable === true ? good.cost : UNREACHED;
  });
  const rows: LpRow[] = runnable.map((r) => ({
    lower: -Infinity, upper: 0, entries: r.coeffs.map(([key, c]): [number, number] => [columnOf.get(key) as number, c]),
  }));
  const result = await solveLp({ sense: 'max', colCost: columns.map(() => 1), colLower: columns.map(() => 0), colUpper: upper, rows });
  if (result.status !== 'optimal') throw new Error(`cost analysis: the cost LP is ${result.status}`);

  const costs = new Map<StuffKey, number>();
  columns.forEach((key, i) => {
    const value = Math.max(0, result.x[i] ?? 0);
    costs.set(key, value >= UNREACHED - UNREACHED_TOLERANCE ? Infinity : value);
  });
  const recipes = new Map(graph.recipes.map((r) => [r.id, r]));
  const cost = (key: StuffKey): number => costs.get(key) ?? Infinity;

  return {
    cost,
    /** Inputs at cost, less the other outputs at cost (byproduct credit), per unit of `forKey`; Infinity when it cannot run. */
    recipeCost(recipeId, forKey) {
      const r = recipes.get(recipeId);
      const perRun = r?.coeffs.find(([key]) => key === forKey)?.[1] ?? 0;
      if (r === undefined || perRun <= 0) return Infinity;
      let net = 0;
      for (const [key, c] of r.coeffs) {
        if (key === forKey) continue;
        const each = cost(key);
        if (c < 0) {
          if (each === Infinity) return Infinity;
          net -= c * each;
        } else if (Number.isFinite(each)) {
          net -= c * each;   // a co-product without a finite cost earns no credit
        }
      }
      return net / perRun;
    },
  };
}
