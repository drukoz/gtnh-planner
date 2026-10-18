// Material cost (spec §3.3, architecture §5, prior-art §3.3–§3.4): prices in ingot-equivalents, the leaf oracle that
// decides which goods a line may buy, and a YAFC-style cost analysis (learn-only reference, no code copied) that gives
// every good of a candidate graph its cheapest raw cost. That cost only ranks alternative recipes and prices "we already
// make this" goods; the plan itself always comes from the main LP (solve.ts).

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import { FREE_KEYS, type PlanSettings } from '../../shared/types/plan.ts';
import { isBaseItem, isOrePrefix, type Availability } from './availability.ts';
import type { CandidateGraph, LeafDecision, LeafOracle, LpRecipe } from './candidates.ts';
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
      const material = key.startsWith(MOLTEN_PREFIX) ? moltenMaterials(pack).get(key.slice(MOLTEN_PREFIX.length)) : undefined;
      return (material === undefined ? 1 : costPerIngot(material)) / LITRES_PER_INGOT;
    }
    const gt = pack.items.get(key)?.gt;
    if (gt === undefined) return 1;
    const ingots = isOrePrefix(gt.prefix) || gt.amount <= 0 ? 1 : gt.amount / M_UNITS;
    return costPerIngot(gt.material) * ingots;
  };
  return { price, costPerIngot };
}

const NOT_A_LEAF: LeafDecision = { buyable: false, cost: 0, leafClass: null };
const UNAVAILABLE: LeafDecision = { buyable: false, cost: 0, leafClass: 'unavailable' };

/**
 * Which goods the line buys (spec §3.3, §5): "we already make this" items at their cost (key override, else `stopCost`,
 * else the price), free and natural goods, and base items the group can get at its tier; a derived base item only
 * while the project does not route derived materials. Base items it cannot get are never buyable.
 */
export function makeLeafOracle(
  pack: Pack, settings: PlanSettings, avail: Availability, prices: PriceTable, stopCost?: (key: StuffKey) => number,
): LeafOracle {
  const expand = new Set(settings.expandItems);
  const stop = new Set(settings.stopItems);
  return (key) => {
    if (expand.has(key)) return NOT_A_LEAF;
    if (stop.has(key)) {
      return { buyable: true, cost: own(settings.costOverrides, key) ?? stopCost?.(key) ?? prices.price(key), leafClass: 'stop' };
    }
    const leafClass = avail.classOf(key);
    if (leafClass === 'free' || leafClass === 'natural') return { buyable: true, cost: prices.price(key), leafClass };
    if (!isBaseItem(pack, key)) return NOT_A_LEAF;
    switch (leafClass) {
      case 'direct':
      case 'byproduct':
        return { buyable: true, cost: prices.price(key), leafClass };
      case 'derived':
        return settings.routeDerived ? NOT_A_LEAF : { buyable: true, cost: prices.price(key), leafClass };
      case 'unavailable':
        return UNAVAILABLE;
      default:
        return NOT_A_LEAF;
    }
  };
}

export interface CostAnalysis { cost(key: StuffKey): number /* Infinity when nothing reachable makes it */; recipeCost(recipeId: string, forKey: StuffKey): number }

/**
 * The recipes of `graph` that can run from what the line buys: a forward fixpoint in which every buyable good is
 * makeable and a recipe fires once every good it consumes (negative coefficient) is makeable, making its outputs makeable.
 */
function runnableRecipes(graph: CandidateGraph): LpRecipe[] {
  const waiting = new Int32Array(graph.recipes.length);
  const consumers = new Map<StuffKey, number[]>();
  graph.recipes.forEach((r, i) => {
    for (const [key, c] of r.coeffs) {
      if (c >= 0) continue;
      waiting[i] = (waiting[i] as number) + 1;
      const list = consumers.get(key);
      if (list === undefined) consumers.set(key, [i]);
      else list.push(i);
    }
  });

  const made = new Set<StuffKey>();
  const queue: StuffKey[] = [];
  const make = (key: StuffKey): void => {
    if (made.has(key)) return;
    made.add(key);
    queue.push(key);
  };
  const fire = (i: number): void => {
    for (const [key, c] of (graph.recipes[i] as LpRecipe).coeffs) if (c > 0) make(key);
  };
  for (const good of graph.goods.values()) if (good.buyable) make(good.key);
  graph.recipes.forEach((_, i) => {
    if (waiting[i] === 0) fire(i);
  });
  for (let head = 0; head < queue.length; head++) {
    for (const i of consumers.get(queue[head] as StuffKey) ?? []) {
      waiting[i] = (waiting[i] as number) - 1;
      if (waiting[i] === 0) fire(i);
    }
  }
  return graph.recipes.filter((_, i) => waiting[i] === 0);
}

/**
 * YAFC-style dual LP (prior-art §3.4 step 2): one cost variable per good, in `[0, cost]` for a buyable good and
 * `[0, 1e6]` otherwise; maximize the sum of all costs subject to `Σ out·c − Σ in·c ≤ 0` for each recipe, so every good
 * gets the cost of its cheapest way to make or buy it. Only recipes that can run from what the line buys get a row: a
 * recipe that cannot run must not make anything look cheaper, and a good that only such recipes make stays at its 1e6
 * bound and reads as Infinity, whatever their yields. The LP is always feasible (all zeros) and bounded. With
 * co-products the split of a recipe's cost between them is not unique, so these costs rank and price; they never plan.
 */
export async function analyzeCosts(graph: CandidateGraph): Promise<CostAnalysis> {
  const keys = new Set(graph.goods.keys());
  for (const r of graph.recipes) for (const [key] of r.coeffs) keys.add(key);
  const columns = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const columnOf = new Map(columns.map((key, i) => [key, i]));

  const upper = columns.map((key) => {
    const good = graph.goods.get(key);
    return good?.buyable === true ? good.cost : UNREACHED;
  });
  const rows: LpRow[] = runnableRecipes(graph).map((r) => ({
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
