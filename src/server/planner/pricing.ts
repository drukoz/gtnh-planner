// The prices a line is planned at (spec §3.3; Plan 2 "Real-data amendments", derived leaves): the cost model behind
// stop-item prices and swap lists, and the leaf oracle whose derived leaves cost what making them on their own costs.
// `planLine` plans with it and `expandBomLines` breaks Plan 5's layout parts down with it, so a line's machines and its
// layout parts break down at the same prices (architecture §11.15). Derived once per pack, settings and world context.

import type { StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { isBaseItem } from './availability.ts';
import { basisContextKey, planBasis, settingsHash, type PlanBasis } from './basis.ts';
import { buildCandidates, type CandidateGraph, type LeafOracle } from './candidates.ts';
import { analyzeCosts, makeLeafOracle, type CostAnalysis } from './costs.ts';
import { yieldToEventLoop } from './lp.ts';
import { standaloneCosts, type Standalone } from './solve.ts';

/** Rounds of pricing the derived leaves a line buys (`linePricing`). */
const MAX_PRICING_ROUNDS = 6;
/** Pricings kept per pack (`linePricing`), the least recently used dropped first. */
const MEMO_SIZE = 8;

/** The cost analysis behind stop-item prices and alternatives, the graph it ran on, and the stop items it took. */
export interface CostModel { graph: CandidateGraph; costs: CostAnalysis; stopItems: StuffKey[] }

/**
 * A line's prices: its basis, the cost model, the leaf oracle with stop items at their cost-model price and derived
 * leaves at their own chain's cost, and the line's candidate graph over that oracle (the graph `planLine` solves).
 * `chains` holds what making each priced derived material and each stop item of that graph on its own runs
 * (`Standalone`, fix spec R7): the chain a bought one stands for (`RawInput.pricedVia`).
 */
export interface LinePricing {
  target: StuffKey; basis: PlanBasis; model: CostModel; leaf: LeafOracle; graph: CandidateGraph; chains: ReadonlyMap<StuffKey, Standalone>;
}

/**
 * Raw-material costs over a candidate graph built without pins and stop items and with derived base materials routed,
 * so every recipe of a good is an alternative, costs count raw material (not stop prices), and every derived material
 * the line may buy has the cost of making it (`makeLeafOracle`'s `derivedCost`). A stop item or derived material that
 * graph cannot make (nothing at the tier makes it, but the group already does, or gets it some other way) would cost
 * Infinity there and hide every recipe that uses it, the one the plan chose among them; such goods are leaves at their
 * stop price (key override, else price) instead.
 */
async function costModel(pack: Pack, settings: PlanSettings, basis: PlanBasis, target: StuffKey): Promise<CostModel> {
  const analyze = async (stopItems: StuffKey[]): Promise<CostModel> => {
    await yieldToEventLoop();
    const s: PlanSettings = { ...settings, recipeChoice: {}, stopItems, routeDerived: true };
    const graph = buildCandidates(pack, s, basis.env, makeLeafOracle(pack, s, basis.avail, basis.prices), [target]);
    return { graph, costs: await analyzeCosts(graph), stopItems };
  };
  const open = await analyze([]);
  const unmade = (key: StuffKey): boolean => key !== target && open.graph.goods.has(key) && !Number.isFinite(open.costs.cost(key));
  const derived = [...open.graph.goods.keys()].filter((key) => basis.avail.classOf(key) === 'derived' && isBaseItem(pack, key));
  const stuck = [...new Set([...settings.stopItems, ...derived])].filter(unmade);
  return stuck.length > 0 ? analyze(stuck) : open;
}

/**
 * What making each derived material of `keys` on its own costs, never consuming the line's target (`standaloneCosts`
 * over the cost model's graph, where derived materials are routed), and never below its plain price (fix spec R7). One
 * that graph never walked (its pruning found no cheap way to make it along the target's chain) is priced over a graph
 * walked from it alone. Without the floor a bought material undercut what it is made from (molten copper at 0.826 an
 * ingot, Glass Dust at 0): at the flat 1 Magnetic Steel was the cheapest way to the LV Machine Hull's plates, while its
 * own chain costs what the steel costs; and a graph walked from it alone is not the line's, so it may count
 * ore-processing yields the flat price of mined items over-rewards (an end-stone iron ore smelted into 40 nuggets) as
 * savings the line never makes. Infinity = only a chain through the target makes it; no entry = its plain price.
 */
async function derivedCosts(
  pack: Pack, settings: PlanSettings, basis: PlanBasis, model: CostModel, target: StuffKey, keys: readonly StuffKey[],
): Promise<Map<StuffKey, Standalone>> {
  const out = new Map<StuffKey, Standalone>();
  const containers = pack.fluidContainers ?? [];
  const floored = (key: StuffKey, made: Standalone): Standalone => ({ ...made, cost: Math.max(made.cost, basis.prices.price(key)) });
  const inModel = keys.filter((key) => model.graph.goods.has(key));
  const own = keys.filter((key) => !model.graph.goods.has(key));
  for (const [key, made] of await standaloneCosts(model.graph, inModel, [target], containers)) if (made !== undefined) out.set(key, floored(key, made));
  if (own.length > 0) {
    await yieldToEventLoop();
    const s: PlanSettings = { ...settings, recipeChoice: {}, stopItems: model.stopItems, routeDerived: true };
    const alone = buildCandidates(pack, s, basis.env, makeLeafOracle(pack, s, basis.avail, basis.prices), own);
    for (const [key, made] of await standaloneCosts(alone, own, [target], containers)) if (made !== undefined) out.set(key, floored(key, made));
  }
  return out;
}

/** The line's target when it has one the export knows (an item or a fluid), else null. */
export function plannableTarget(pack: Pack, settings: PlanSettings): StuffKey | null {
  const target = settings.target;
  return target !== null && (pack.items.has(target) || pack.fluids.has(target)) ? target : null;
}

async function computePricing(pack: Pack, settings: PlanSettings, ctx: PlanContext, target: StuffKey): Promise<LinePricing> {
  await yieldToEventLoop();
  const basis = planBasis(pack, settings, ctx);
  const model = await costModel(pack, settings, basis, target);
  const stopCost = (key: StuffKey): number => {
    const cost = model.costs.cost(key);
    return Number.isFinite(cost) ? cost : basis.prices.price(key);
  };
  // Derived leaves cost what making them on their own costs (`derivedCosts`): first the graph at their plain prices,
  // then again with the derived leaves it buys priced, until it buys no unpriced one. One only a chain through the
  // target makes is no leaf (Infinity), and walking it can meet further derived leaves; after MAX_PRICING_ROUNDS a
  // derived leaf the last graph meets first keeps its plain price.
  const priced = new Map<StuffKey, Standalone>();
  const tried = new Set<StuffKey>();
  // The line makes the free inputs of `basis.supplied` with their generators (fix spec R2). The cost model above buys
  // them, at 0 like their generators' runs: its costs and the free input of a derived chain (`Standalone.free`, a
  // tie-break) stay what they were.
  const leafWith = (): LeafOracle =>
    makeLeafOracle(pack, settings, basis.avail, basis.prices, stopCost, (key) => priced.get(key), { supplied: basis.supplied });
  let leaf = leafWith();
  await yieldToEventLoop();
  let graph = buildCandidates(pack, settings, basis.env, leaf, [target]);
  for (let round = 0; round < MAX_PRICING_ROUNDS; round++) {
    const unpriced = [...graph.goods.values()].filter((g) => g.leafClass === 'derived' && g.buyable && !tried.has(g.key)).map((g) => g.key);
    if (unpriced.length === 0) break;
    for (const key of unpriced) tried.add(key);
    for (const [key, cost] of await derivedCosts(pack, settings, basis, model, target, unpriced)) priced.set(key, cost);
    leaf = leafWith();
    await yieldToEventLoop();
    graph = buildCandidates(pack, settings, basis.env, leaf, [target]);
  }
  // The chains behind the stop items the line may buy, as the derived leaves' (`priced`): only what they stand for
  // (`RawInput.pricedVia`) is read; a stop item keeps its own price.
  const stops = [...graph.goods.values()].filter((g) => g.leafClass === 'stop' && g.buyable).map((g) => g.key);
  const chains = new Map(priced);
  for (const [key, made] of await derivedCosts(pack, settings, basis, model, target, stops)) chains.set(key, made);
  return { target, basis, model, leaf, graph, chains };
}

const MEMOS = new WeakMap<Pack, Map<string, Promise<LinePricing>>>();

/**
 * The line's prices for `settings` in `ctx` (null when it has no target the export knows), computed once per pack,
 * settings hash and the context fields its basis reads (`basisContextKey`), for at most MEMO_SIZE such keys per pack:
 * the plan and every later `expandBomLines` of the same project share one pricing. Callers asking while it is computed
 * share that computation; one that fails is not kept. The avoid list plays no part (ruling R6: only `planLine`'s own
 * graphs honor it), so projects that differ only in it share one pricing, priced and walked without it.
 */
export function linePricing(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<LinePricing> | null {
  const target = plannableTarget(pack, settings);
  if (target === null) return null;
  let memo = MEMOS.get(pack);
  if (memo === undefined) {
    memo = new Map();
    MEMOS.set(pack, memo);
  }
  const open: PlanSettings = { ...settings, avoid: [] };
  const key = `${settingsHash(open)}|${basisContextKey(ctx)}`;
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const pricing = computePricing(pack, open, ctx, target);
  memo.set(key, pricing);
  if (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  const kept = memo;
  pricing.catch(() => {
    if (kept.get(key) === pricing) kept.delete(key);
  });
  return pricing;
}

/**
 * The environment and leaf oracle a line's breakdowns use: the line's prices (`linePricing`) when it has a target the
 * export knows, else the basis's plain ones (no line, so nothing to price against).
 */
export async function lineLeaf(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<Pick<PlanBasis, 'env' | 'leaf'>> {
  const pricing = linePricing(pack, settings, ctx);
  if (pricing === null) return planBasis(pack, settings, ctx);
  const { basis, leaf } = await pricing;
  return { env: basis.env, leaf };
}
