// The prices a line is planned at (spec §3.3; Plan 2 "Real-data amendments", derived leaves): the cost model behind
// stop-item prices and swap lists, and the leaf oracle whose derived leaves cost what making them on their own costs.
// `planLine` plans with it and `expandBomLines` breaks Plan 5's layout parts down with it, so a line's machines and its
// layout parts break down at the same prices (architecture §11.15). Derived once per pack, settings and world context.

import type { StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { isBaseItem } from './availability.ts';
import { basisContextKey, gatheredRecipesOn, planBasis, resolveAvoid, settingsHash, type PlanBasis } from './basis.ts';
import { benchLine } from './benches.ts';
import { buildCandidates, type CandidateGraph, type CandidateOptions, type LeafOracle } from './candidates.ts';
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
 * (`Standalone`, fix spec R7): the chain a bought one stands for (`RawInput.pricedVia`). `unbuildable` (plan 12) holds
 * the step recipes the graph was walked without (`linePricing`'s `opts`), which every other walk of the line leaves out
 * too.
 */
export interface LinePricing {
  target: StuffKey; basis: PlanBasis; model: CostModel; leaf: LeafOracle; graph: CandidateGraph; chains: ReadonlyMap<StuffKey, Standalone>;
  unbuildable?: ReadonlyMap<string, string>;
  /**
   * The leaf oracle the build list and the layout's parts break down with (plan 12 fix wave 3 (B)): `leaf` without the
   * project's "Only these come in", which only the line's own graphs read (machine prices never do); `leaf` itself when
   * the list is empty.
   */
  buildLeaf: LeafOracle;
}

/**
 * Raw-material costs over a candidate graph built without pins (of recipes or ingredient options) and stop items and
 * with derived base materials routed, so every recipe of a good and every option of a slot is an alternative, costs
 * count raw material (not stop prices), and every derived material the line may buy has the cost of making it
 * (`makeLeafOracle`'s `derivedCost`). A stop item or derived material that graph cannot make (nothing at the tier makes
 * it, but the group already does, or gets it some other way) would cost Infinity there and hide every recipe that uses
 * it, the one the plan chose among them; such goods are leaves at their stop price (key override, else price) instead.
 */
async function costModel(pack: Pack, settings: PlanSettings, basis: PlanBasis, target: StuffKey): Promise<CostModel> {
  const analyze = async (stopItems: StuffKey[]): Promise<CostModel> => {
    await yieldToEventLoop();
    const s: PlanSettings = { ...settings, recipeChoice: {}, optionChoice: {}, stopItems, routeDerived: true };
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
 * What a line's pricing derives before its own walk, whatever recipes that walk leaves out (plan 12: `linePricing`'s
 * `unbuildable`): its basis, its cost model, and what making each derived material it prices on its own costs
 * (`derivedCosts`) — per key of the cost model's graph, where each is one LP of that graph, and per ordered list of the
 * other keys, which are priced together over the graph walked from them. Shared by every pricing of one line.
 */
interface PricingCore {
  basis: PlanBasis; model: CostModel;
  standalone: Map<StuffKey, Promise<Standalone | undefined>>; alone: Map<string, Promise<Map<StuffKey, Standalone | undefined>>>;
}

/**
 * What making each derived material of `keys` on its own costs, never consuming the line's target (`standaloneCosts`
 * over the cost model's graph, where derived materials are routed), and never below its plain price (fix spec R7). One
 * that graph never walked (its pruning found no cheap way to make it along the target's chain) is priced over a graph
 * walked from it alone. Without the floor a bought material undercut what it is made from (molten copper at 0.826 an
 * ingot, Glass Dust at 0): at the flat 1 Magnetic Steel was the cheapest way to the LV Machine Hull's plates, while its
 * own chain costs what the steel costs; and a graph walked from it alone is not the line's, so it may count
 * ore-processing yields the flat price of mined items over-rewards (an end-stone iron ore smelted into 40 nuggets) as
 * savings the line never makes. Infinity = only a chain through the target makes it; no entry = its plain price. Each
 * answer is worked out once per `core` (`PricingCore`), so a line walked again around recipes it cannot run asks again
 * for free.
 */
async function derivedCosts(
  pack: Pack, settings: PlanSettings, core: PricingCore, target: StuffKey, keys: readonly StuffKey[],
): Promise<Map<StuffKey, Standalone>> {
  const { basis, model } = core;
  const out = new Map<StuffKey, Standalone>();
  const containers = pack.fluidContainers ?? [];
  const floored = (key: StuffKey, made: Standalone): Standalone => ({ ...made, cost: Math.max(made.cost, basis.prices.price(key)) });
  const inModel = keys.filter((key) => model.graph.goods.has(key));
  const own = keys.filter((key) => !model.graph.goods.has(key));
  const missing = inModel.filter((key) => !core.standalone.has(key));
  if (missing.length > 0) {
    const batch = standaloneCosts(model.graph, missing, [target], containers);
    for (const key of missing) {
      const made = batch.then((all) => all.get(key));
      core.standalone.set(key, made);
      made.catch(() => {
        if (core.standalone.get(key) === made) core.standalone.delete(key);   // a failed one is asked again
      });
    }
  }
  for (const key of inModel) {
    const made = await core.standalone.get(key);
    if (made !== undefined) out.set(key, floored(key, made));
  }
  if (own.length > 0) {
    const id = own.join('\n');
    let alone = core.alone.get(id);
    if (alone === undefined) {
      const made = (async () => {
        await yieldToEventLoop();
        return standaloneCosts(aloneGraph(pack, settings, basis, model, own), own, [target], containers);
      })();
      core.alone.set(id, made);
      made.catch(() => {
        if (core.alone.get(id) === made) core.alone.delete(id);
      });
      alone = made;
    }
    for (const [key, made] of await alone) if (made !== undefined) out.set(key, floored(key, made));
  }
  return out;
}

/**
 * The graph `keys` alone walk to, as the cost model walks (no pins, its stop items, derived materials routed): where goods
 * the cost model's graph never reached are priced (`derivedCosts`; plan.ts prices ingredient options there), with
 * `walk.avoid` around those goods (`CandidateOptions.avoid`, as a line that avoids them walks: plan.ts's options) and
 * without the recipes of `walk.unbuildable` (`CandidateOptions.unbuildable`: no machine that runs them can be built here
 * or is owned, plan 12; plan.ts's options walk a chain around the avoid list so, as the line is walked).
 */
export function aloneGraph(
  pack: Pack, settings: PlanSettings, basis: PlanBasis, model: CostModel, keys: StuffKey[],
  walk: Pick<CandidateOptions, 'avoid' | 'unbuildable'> = {},
): CandidateGraph {
  const s: PlanSettings = { ...settings, recipeChoice: {}, optionChoice: {}, stopItems: model.stopItems, routeDerived: true };
  const opts: CandidateOptions = {};
  if (walk.avoid !== undefined) opts.avoid = walk.avoid;
  if (walk.unbuildable !== undefined && walk.unbuildable.size > 0) opts.unbuildable = walk.unbuildable;
  return buildCandidates(pack, s, basis.env, makeLeafOracle(pack, s, basis.avail, basis.prices), keys, opts);
}

/**
 * The options of a walk of the line's own graph (`computePricing`, plan.ts's avoid trials): `opts` with the line's Auto
 * Workbenches (`CandidateOptions.bench`, `benchLine`: crafting automated and one at the tier; controller ruling 214),
 * which only the line's own graphs get — never the cost model, machine prices or build-material breakdowns, where
 * crafting is the build list's one-off crafting by hand.
 */
export function lineWalk(pack: Pack, settings: PlanSettings, basis: PlanBasis, opts: CandidateOptions): CandidateOptions {
  const bench = benchLine(pack, settings, basis.tier);
  return bench === undefined ? opts : { ...opts, bench };
}

/** The line's target when it has one the export knows (an item or a fluid), else null. */
export function plannableTarget(pack: Pack, settings: PlanSettings): StuffKey | null {
  const target = settings.target;
  return target !== null && (pack.items.has(target) || pack.fluids.has(target)) ? target : null;
}

/**
 * The options `settings.optionChoice` pins that its avoid list covers (`resolveAvoid`; never the target, which a line
 * plans whatever the list says), sorted: ruling P28 lets the avoid list win over such a pin, also in the line's graph,
 * which is walked without the list (ruling R6), so that graph is told them (`CandidateOptions.pinAvoid`).
 */
function avoidedPins(pack: Pack, settings: PlanSettings, target: StuffKey): StuffKey[] {
  const entries = settings.avoid ?? [];
  const pinned = Object.values(settings.optionChoice ?? {});
  if (entries.length === 0 || pinned.length === 0) return [];
  const { goods } = resolveAvoid(pack, entries);
  goods.delete(target);
  return [...new Set(pinned.filter((key) => goods.has(key)))].sort();
}

/** A line's `PricingCore`: its basis and cost model, no derived material priced yet. */
async function computeCore(pack: Pack, settings: PlanSettings, ctx: PlanContext, target: StuffKey): Promise<PricingCore> {
  await yieldToEventLoop();
  const basis = planBasis(pack, settings, ctx);
  return { basis, model: await costModel(pack, settings, basis, target), standalone: new Map(), alone: new Map() };
}

async function computePricing(
  pack: Pack, settings: PlanSettings, target: StuffKey, pinAvoid: ReadonlySet<StuffKey>, unbuildable: ReadonlyMap<string, string> | undefined,
  core: Promise<PricingCore>,
): Promise<LinePricing> {
  await yieldToEventLoop();
  const shared = await core;
  const { basis, model } = shared;
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
  // tie-break) stay what they were. Plan 12 (change request 13, Amendment OQ4): where build cost counts on an AE2 or
  // Project Red line (`gatheredRecipesOn`), the line's own graph also offers the recipes of the gathered world blocks it
  // uses (sand from rock-breaker cobblestone), beside digging them; the cost model, machine prices and build-material
  // breakdowns keep them plain leaves.
  const gatheredRecipes = gatheredRecipesOn(settings);
  // Fix wave 3 (B): "Only these come in" holds for the line's own graphs (`LinePricing.buildLeaf` is the same oracle without it).
  const inputsOnly: ReadonlySet<StuffKey> = new Set(settings.inputsOnly ?? []);
  const leafWith = (only: ReadonlySet<StuffKey> = inputsOnly): LeafOracle => makeLeafOracle(
    pack, settings, basis.avail, basis.prices, stopCost, (key) => priced.get(key), { supplied: basis.supplied, gatheredRecipes, inputsOnly: only },
  );
  // Plan 12 (controller ruling OQ5 a): the step recipes no machine can run here are left out of every walk of the line;
  // and with crafting automated (controller ruling 214) its walks offer the Auto Workbench's single-use tool variants and
  // mark the crafting recipes no bench runs as crafted by hand (`lineWalk`).
  const walk = lineWalk(pack, settings, basis, { pinAvoid, ...(unbuildable === undefined ? {} : { unbuildable }) });
  let leaf = leafWith();
  await yieldToEventLoop();
  let graph = buildCandidates(pack, settings, basis.env, leaf, [target], walk);
  for (let round = 0; round < MAX_PRICING_ROUNDS; round++) {
    const unpriced = [...graph.goods.values()].filter((g) => g.leafClass === 'derived' && g.buyable && !tried.has(g.key)).map((g) => g.key);
    if (unpriced.length === 0) break;
    for (const key of unpriced) tried.add(key);
    for (const [key, cost] of await derivedCosts(pack, settings, shared, target, unpriced)) priced.set(key, cost);
    leaf = leafWith();
    await yieldToEventLoop();
    graph = buildCandidates(pack, settings, basis.env, leaf, [target], walk);
  }
  // The chains behind the stop items the line may buy, as the derived leaves' (`priced`): only what they stand for
  // (`RawInput.pricedVia`) is read; a stop item keeps its own price.
  const stops = [...graph.goods.values()].filter((g) => g.leafClass === 'stop' && g.buyable).map((g) => g.key);
  const chains = new Map(priced);
  for (const [key, made] of await derivedCosts(pack, settings, shared, target, stops)) chains.set(key, made);
  const buildLeaf = inputsOnly.size === 0 ? leaf : leafWith(new Set());
  const pricing: LinePricing = { target, basis, model, leaf, graph, chains, buildLeaf };
  if (unbuildable !== undefined) pricing.unbuildable = unbuildable;
  return pricing;
}

const MEMOS = new WeakMap<Pack, Map<string, Promise<LinePricing>>>();
const CORES = new WeakMap<Pack, Map<string, Promise<PricingCore>>>();

/**
 * Returns `memo`'s entry for `key`, made with `make` when it has none, most recently used last; at most MEMO_SIZE
 * entries, the least recently used dropped first; one that fails is dropped too.
 */
function remembered<T>(memo: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const made = make();
  memo.set(key, made);
  if (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  made.catch(() => {
    if (memo.get(key) === made) memo.delete(key);
  });
  return made;
}

/** `map`'s value for `pack`, a new map when it has none. */
function memoOf<T>(map: WeakMap<Pack, Map<string, T>>, pack: Pack): Map<string, T> {
  let memo = map.get(pack);
  if (memo === undefined) {
    memo = new Map();
    map.set(pack, memo);
  }
  return memo;
}

/**
 * The line's prices for `settings` in `ctx` (null when it has no target the export knows), computed once per pack,
 * settings hash, the context fields its basis reads (`basisContextKey`) and the sorted ids of `opts.unbuildable`, for at
 * most MEMO_SIZE such keys per pack: the plan and every later `expandBomLines` of the same project share one pricing,
 * and the pricings of one line walked without different `unbuildable` sets share its basis, cost model and derived costs
 * (`PricingCore`, memoized the same way without `unbuildable`), so only the line's own walks run again.
 * Callers asking while it is computed share that computation; one that fails is not kept. The avoid list plays no part
 * (ruling R6: only `planLine`'s own graphs honor it) beyond the option pins it overrides (`avoidedPins`, ruling P28: the
 * line's graph ignores them, with a `stale-option` each), so projects that differ only in it share one pricing, priced
 * and walked without it, unless it covers an option they pin. `opts.unbuildable` (plan 12, controller ruling OQ5 a):
 * step recipes no machine can run here, with why (`BuildModel.blocked`), which the line's graph is walked without
 * (`CandidateOptions.unbuildable`), so producers that can run take their place.
 */
export function linePricing(
  pack: Pack, settings: PlanSettings, ctx: PlanContext, opts?: { unbuildable?: ReadonlyMap<string, string> },
): Promise<LinePricing> | null {
  const target = plannableTarget(pack, settings);
  if (target === null) return null;
  const open: PlanSettings = { ...settings, avoid: [] };
  const pinAvoid = avoidedPins(pack, settings, target);
  const unbuildable = opts?.unbuildable !== undefined && opts.unbuildable.size > 0 ? opts.unbuildable : undefined;
  const blockedIds = unbuildable === undefined ? '' : `|unbuildable:${JSON.stringify([...unbuildable.keys()].sort())}`;
  const line = `${settingsHash(open)}|${basisContextKey(ctx)}${pinAvoid.length === 0 ? '' : `|${JSON.stringify(pinAvoid)}`}`;
  const blocked = unbuildable === undefined ? undefined : new Map(unbuildable);
  return remembered(memoOf(MEMOS, pack), `${line}${blockedIds}`, () => {
    // Every pricing of the line, whatever it walks without, shares its basis, cost model and derived costs (`PricingCore`).
    const core = remembered(memoOf(CORES, pack), line, () => computeCore(pack, open, ctx, target));
    return computePricing(pack, open, target, new Set(pinAvoid), blocked, core);
  });
}

/**
 * The environment and leaf oracle a line's breakdowns use: the line's prices (`linePricing`) when it has a target the
 * export knows, else the basis's plain ones (no line, so nothing to price against).
 */
export async function lineLeaf(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<Pick<PlanBasis, 'env' | 'leaf'>> {
  const pricing = linePricing(pack, settings, ctx);
  if (pricing === null) return planBasis(pack, settings, ctx);
  const { basis, buildLeaf } = await pricing;
  return { env: basis.env, leaf: buildLeaf };
}
