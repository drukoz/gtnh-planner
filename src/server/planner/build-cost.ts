// Machine build cost (spec §3.3 "material use includes the machines the group does not have yet", architecture §11.28 as
// entry 39 amends it): the raw material to build one machine, each part at the least that makes one on its own
// (the standalone LP on a graph walked back to buyable leaves: fix wave 3 (D), below) — its item's crafting chain,
// and for a multiblock also its exported structure, every structure hatch at the lowest tier of its class, plus the
// hatches it needs to run less the casings they stand on. It also says why a price is missing (controller ruling OQ5):
// a machine no recipe of the pack makes, or whose chain needs an item out of reach, cannot be built here; one that can be
// made, but that the pricing finds no price for, is a pricing gap.
//
// Memo keys: a pricing context is `machinePricingKey(settings, ctx)` — `settingsHash(pricingSettings(settings, ctx))`,
// the hash of the very settings `planBasis` and the walk get, then `|` and `basisContextKey(ctx)`; `itemPrices` adds `|`
// and the SHA-1 of the sorted, deduplicated keys asked, joined by `\n`, for the table it hands out. The pricing reads no
// setting the context leaves out (it reads the tier, coil heat, dimensions, excluded categories, cost overrides, stop and
// expand items), so a project's target, amount, mode, logistics, build horizon, reuse settings, recipe and option pins
// and avoid list neither invalidate the memo nor change a price (machine prices avoid nothing, plan 08's ruling R6).
// Fix wave 3 (D): one price graph per context (`priceGraph`) and one price per context and key (`computePrices`), so no
// price depends on the other keys asked or on which keys were priced before, and an override that makes a good cheaper
// never makes a key dearer than without it.

import { createHash } from 'node:crypto';
import { tierName, V } from '../../shared/gt/tiers.ts';
import { compareMachineId, isPseudoMachineId, legacyMteId } from '../../shared/ids.ts';
import { isFluidKey, itemKey, type StuffKey } from '../../shared/keys.ts';
import { defaultSettings } from '../../shared/project/apply-op.ts';
import type { Machine, Pack, Recipe } from '../../shared/types/pack.ts';
import type { HatchKind } from '../../shared/types/layout.ts';
import type { BomLine, PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { COVER_RATES, resolveParts } from '../layout/parts.ts';
import { allMachineIds, allMachines, machineByMteId, machineOf } from '../pack/lookup.ts';
// GT's structure rules the layout lays a multiblock's hatches by (entries 47 and 49 (3): `hatchRulesOf`, which reads
// only the machine and its export), read here so a multiblock's build holds the hatches its layout lays
import { hatchRulesOf, KIND_CLASS, ruleNeeds, rulePower, ruleTakes, type HatchRule, type HatchSource } from '../layout/hatch-rules.ts';
import { basisContextKey, effectiveTier, planBasis, settingsHash } from './basis.ts';
import { buildCandidates, type CandidateGraph, type LeafDecision, type LeafOracle } from './candidates.ts';
import { isOreBlock, makeLeafOracle, stopFloor } from './costs.ts';
import { yieldToEventLoop } from './lp.ts';
import { sig9 } from './round.ts';
import { deadEnds, deadEndsAlone, makeableGoods, makeableWith, standaloneCosts, standalonePrices } from './solve.ts';

/**
 * The most entries each of the two per-pack pricing memos keeps, the least recently used dropped first: the price
 * graphs (`priceGraph`, where a context with cost overrides also keeps the one without them in use) and the price
 * tables (`itemPrices`).
 */
export const MACHINE_PRICE_MEMO_SIZE = 8;
/**
 * Block ids of structure cells nothing is placed in: air, and the fluids an exported structure holds where the machine or
 * its surroundings put them. The 2.9 export has such cells in 16 multiblocks — lava@1 in 2 (the Bricked Blast Furnace's
 * hollow, 2 cells; the Boldarnator, 3), water@0 in 14, flowing_water@0 in 5, `bartworks:coloredFluidBlock@0` in 1 (the
 * Bacterial Vat, 18) — none of them an item any recipe makes, so pricing them as parts made those machines ones that
 * cannot be built here, and every LV steel line infeasible.
 */
export const NOTHING_TO_PLACE: ReadonlySet<string> = new Set([
  'minecraft:air', 'minecraft:water', 'minecraft:flowing_water', 'minecraft:lava', 'minecraft:flowing_lava', 'bartworks:coloredFluidBlock',
]);
/**
 * The simple class names (architecture §11.19) of the hatches a multiblock may need to run (`hatchSet`). With a
 * multiblock, `buildKeys` prices every hatch of these classes, so its options at every hatch tier can be priced.
 */
export const HATCH_CLASSES: readonly string[] = Object.freeze([
  'MTEHatchInputBus', 'MTEHatchOutputBus', 'MTEHatchEnergy', 'MTEHatchMaintenance', 'MTEHatchInput', 'MTEHatchOutput',
]);

/**
 * Why a good has no price (controller ruling OQ5): `no-recipe`, no recipe of the pack makes it; `unavailable`, its chain
 * needs `item` — a good nothing in the price graph makes (the good itself when every recipe for it is rejected at the
 * tier) or a base material out of reach; `gap`, no price is found, yet nothing out of reach is what it lacks (its chain
 * only meets loops with no way in, or dead ends that even all made available would not let it be made: `gapOf`).
 */
export type PriceGap = { kind: 'no-recipe' } | { kind: 'unavailable'; item: StuffKey } | { kind: 'gap' };

/** Prices for building, from one price graph (`itemPrices`). */
export interface ItemPrices {
  /** Raw material per unit of `key`; Infinity = no price. */
  cost(key: StuffKey): number;
  /** Why `key` has no price; undefined for a priced key. */
  gap(key: StuffKey): PriceGap | undefined;
}


function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The settings machines are priced at: the defaults, except what the price of a machine depends on — the tier the line
 * is planned at (`effectiveTier`), coil heat, dimensions, excluded categories, cost overrides, stop and expand items —
 * with derived materials routed. So the target is null (plan 09's R8 reads it: ore blocks are leaves only for a material
 * line), there are no recipe or option pins (R9 applies `optionChoice` in the walk) and no avoid list, in rate mode,
 * whatever the project has: two projects that share a memo entry price every machine alike.
 */
export function pricingSettings(settings: PlanSettings, ctx: PlanContext): PlanSettings {
  return {
    ...defaultSettings(), tier: effectiveTier(settings, ctx), coilHeat: settings.coilHeat, dims: settings.dims,
    excludedCategories: settings.excludedCategories, costOverrides: settings.costOverrides, stopItems: settings.stopItems,
    expandItems: settings.expandItems, routeDerived: true,
  };
}

/** The pricing context of `settings` in `ctx`: the hash of `pricingSettings`, then the context fields its basis reads. */
export function machinePricingKey(settings: PlanSettings, ctx: PlanContext): string {
  return `${settingsHash(pricingSettings(settings, ctx))}|${basisContextKey(ctx)}`;
}

/**
 * Why `key`, priced Infinity on `graph` and by `orePrice`, has no price: `no-recipe` when
 * no recipe of the pack makes it, else a pricing gap when the ore blocks among its dead ends that the group can mine
 * (`mined`) would let it be made — its chain is available, only its price is missing (controller ruling OQ5 b; such a
 * key `orePrice` usually prices, as it did the Advanced Lathe and Advanced Macerator of the 2.9 export at MV, which
 * read "needs Native Diamond Cluster, not available at MV" before, a mod item that sorted first among such dead ends) —
 * else, where its dead ends all made available would let it be made, a good `deadEnds` names, else a pricing gap (fix
 * wave 3 (D): on the 2.9 export's price graph the Steam Hatch, 31040, meets two bee combs that would not let it be made,
 * and read "needs Brown Tinted Comb", which walked six GT++ steam multiblocks' recipes out of every line). The good
 * named is one that alone,
 * made available, would let `key` be made (`deadEndsAlone`), else any dead end; among those a base material out of reach
 * first, then a good whose recipes cannot run here (it has a `blocked` entry), then any other (a good nothing makes),
 * each by key, and an ore the group can mine last (it is what the machine lacks only where nothing else is). Of the dead ends of every route sorted by key, the first was often one route's oddity — on the 2.9 export
 * the reactor sensor location cards nothing makes, behind the "Any MV Circuit" stand-in that one recipe of an Emitter
 * (MV) takes, or that an MV-circuit slot lists beside the real circuits — while what kept the machine from being built
 * was another good. A walk stopped at its recipe cap left goods unexpanded that would look out of reach, so there every
 * such key is a pricing gap, never a machine that cannot be built.
 */
function gapOf(pack: Pack, graph: CandidateGraph, key: StuffKey, mined: (key: StuffKey) => boolean): PriceGap {
  if ((pack.producers.get(key) ?? []).length === 0) return { kind: 'no-recipe' };
  if (graph.truncated === true) return { kind: 'gap' };
  const rank = (end: StuffKey): number => (mined(end) ? 3 : graph.goods.get(end)?.leafClass === 'unavailable' ? 0 : graph.blocked.has(end) ? 1 : 2);
  const first = (ends: readonly StuffKey[]): StuffKey | undefined => [...ends].sort((a, b) => rank(a) - rank(b) || byString(a, b))[0];
  const ends = deadEnds(graph, key);
  const ores = ends.filter(mined);
  if (ores.length > 0 && makeableWith(graph, key, ores)) return { kind: 'gap' };
  // dead ends that, all made available, still leave `key` unmade are not what it lacks: its chain only meets loops
  if (ends.length > 0 && !makeableWith(graph, key, ends)) return { kind: 'gap' };
  const item = first(deadEndsAlone(graph, key, ends)) ?? first(ends);
  return item === undefined ? { kind: 'gap' } : { kind: 'unavailable', item };
}

/**
 * What each "we already make this" item of `s` without a key override costs to build with (architecture §11 entry 41 (6)),
 * as a line prices it: what making it on its own costs (`standaloneCosts` over the graph walked from those items alone,
 * with no stop items; byproducts thrown away; machine prices have no target to keep out), never below `stopFloor`; its
 * plain price when nothing here makes it. Worked out once per pack and pricing context, whatever keys are asked: the
 * leaf oracle of its price graph (`priceGraph`, memoized per context) reads it.
 */
async function stopItemCosts(pack: Pack, s: PlanSettings, basis: ReturnType<typeof planBasis>): Promise<(key: StuffKey) => number> {
  const stops = s.stopItems.filter((key) => !Object.hasOwn(s.costOverrides, key));
  if (stops.length === 0) return (key) => basis.prices.price(key);
  const open: PlanSettings = { ...s, stopItems: [] };
  const graph = buildCandidates(pack, open, basis.env, makeLeafOracle(pack, open, basis.avail, basis.prices), stops);
  const made = await standaloneCosts(graph, stops, [], pack.fluidContainers ?? []);
  const floor = stopFloor(pack, basis.prices);
  return (key) => {
    const cost = made.get(key)?.cost;
    return cost !== undefined && Number.isFinite(cost) ? Math.max(cost, floor(key)) : basis.prices.price(key);
  };
}

/**
 * Every key a build or a layout prices at `tier` (fix wave 3 (D)): `buildKeys` of every machine at or below it (one
 * without a tier counts) other than cables and pipes, every cable rated up to one tier above it, every item and fluid
 * pipe, every hatch and transformer up to it, the conveyor and pump covers up to it (LV at least) and every layout part
 * (`resolveParts`); sorted, without repeats. A pricing context's price graph is walked from these (`priceGraph`).
 */
export function priceKeys(pack: Pack, tier: number): StuffKey[] {
  const keys = new Set<StuffKey>(buildKeys(pack, allMachines(pack).filter((m) =>
    m.kind !== 'cable' && m.kind !== 'item_pipe' && m.kind !== 'fluid_pipe' && (m.tier === undefined || m.tier <= tier))));
  const rated = V[Math.min(tier + 1, V.length - 1)] as number;
  for (const m of allMachines(pack)) {
    if (m.kind === 'cable' && m.cable !== undefined && m.cable.voltage <= rated) keys.add(m.itemKey);
    if (m.kind === 'item_pipe' || m.kind === 'fluid_pipe') keys.add(m.itemKey);
    if ((m.kind === 'hatch' || m.kind === 'transformer') && m.tier !== undefined && m.tier <= tier) keys.add(m.itemKey);
  }
  for (const row of [...COVER_RATES.conveyor, ...COVER_RATES.pump]) if (row.tier <= Math.max(1, tier)) keys.add(row.key);
  for (const part of Object.values(resolveParts(pack))) keys.add(part.key);
  return [...keys].sort(byString);
}

/** One pricing context's price graph (`priceGraph`) and the prices worked out on it so far. */
interface PriceGraph {
  s: PlanSettings; basis: ReturnType<typeof planBasis>; leaf: LeafOracle; graph: CandidateGraph;
  /** Per key asked so far: its price and the graph it was priced on (the price graph, or the key's own walk). */
  priced: Map<StuffKey, Promise<{ cost: number; graph: CandidateGraph }>>;
  /** The goods `graph` can make (`makeableGoods`), worked out when first needed. */
  makeable?: ReadonlySet<StuffKey>;
}

const GRAPHS = new WeakMap<Pack, Map<string, Promise<PriceGraph>>>();

/** `memo.get(key)`, made the most recently used; else `make()` kept, at most MACHINE_PRICE_MEMO_SIZE, dropped when it fails. */
function memoized<T>(memo: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const made = make();
  memo.set(key, made);
  if (memo.size > MACHINE_PRICE_MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  made.catch(() => {
    if (memo.get(key) === made) memo.delete(key);
  });
  return made;
}

/**
 * `a` with the recipes of `b` it lacks; the goods `b` adds take `leaf`'s decision (a virtual good its own). The price
 * graph of a context with cost overrides is its walk united with the walk at no overrides (`priceGraph`).
 */
function unitedGraph(a: CandidateGraph, b: CandidateGraph, leaf: LeafOracle): CandidateGraph {
  const recipes = new Map(a.recipes.map((r) => [r.id, r]));
  for (const r of b.recipes) if (!recipes.has(r.id)) recipes.set(r.id, r);
  const goods = new Map(a.goods);
  for (const [key, good] of b.goods) {
    if (goods.has(key)) continue;
    if (good.virtual) {
      goods.set(key, good);
      continue;
    }
    const { buyable, cost, leafClass } = leaf(key);
    goods.set(key, { key, buyable, cost, leafClass, virtual: false });
  }
  const united: CandidateGraph = { ...a, recipes: [...recipes.values()].sort((x, y) => byString(x.id, y.id)), goods };
  if (b.truncated === true) united.truncated = true;
  return united;
}

/**
 * The price graph of the pricing context of `settings` in `ctx` (fix wave 3 (D)), once per pack and context
 * (`machinePricingKey`), at most MACHINE_PRICE_MEMO_SIZE per pack: one candidate walk from every key of `priceKeys` at
 * the context's tier that is no leaf, with the leaf oracle of its basis (no `supplied` option, no gathered recipes: see
 * `computePrices`). With cost overrides it is united with the price graph of the same context without them
 * (`unitedGraph`), so an override that makes a good cheaper never drops the producers the pack's own prices keep — the
 * walk keeps each good's cheapest producers by an estimate, and on the 2.9 export at HV Rubber Wood at 0.01 instead of 1
 * dropped the chemical reactors' Raw Rubber Dust and the SBR route of 1x Annealed Copper Cable, whose price rose from
 * 0.4133 to 0.4511.
 */
function priceGraph(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<PriceGraph> {
  let memo = GRAPHS.get(pack);
  if (memo === undefined) {
    memo = new Map();
    GRAPHS.set(pack, memo);
  }
  return memoized(memo, machinePricingKey(settings, ctx), async () => {
    await yieldToEventLoop();
    const s = pricingSettings(settings, ctx);
    const basis = planBasis(pack, s, ctx);
    const leaf = makeLeafOracle(pack, s, basis.avail, basis.prices, await stopItemCosts(pack, s, basis));
    let graph = buildCandidates(pack, s, basis.env, leaf, priceKeys(pack, basis.tier).filter((key) => !leaf(key).buyable));
    if (Object.keys(s.costOverrides).length > 0) graph = unitedGraph(graph, (await priceGraph(pack, { ...settings, costOverrides: {} }, ctx)).graph, leaf);
    return { s, basis, leaf, graph, priced: new Map() };
  });
}

/** A good the price graph makes, as a leaf of an ore walk (`orePrice`): it stops the walk there, and is no leaf in the LP. */
const MADE_IN_PRICE_GRAPH: LeafDecision = { buyable: true, cost: 0, leafClass: 'derived' };
const NOT_A_PRICE_LEAF: LeafDecision = { buyable: false, cost: 0, leafClass: null };

/**
 * Fix wave 2 (c), controller ruling 187, per key (fix wave 3 (D)): the price of `key`, which `graph` cannot make, when
 * the ore blocks among its dead ends that the group can mine (`mined`) would let it be made (`makeableWith`) — on the
 * 2.9 export the Flawless Diamond of the Advanced Lathe (292) and the Advanced Macerator (302), so neither machine could
 * be weighed at MV. `key` is walked on its own with those ores as leaves at their price and every good `graph` makes as a
 * leaf that stops the walk; that walk's recipes join `graph`, where the mined ores are bought at their price, and the
 * standalone LP prices `key` there (no other key sees the ores). Infinity otherwise, and when `graph` was cut short at its
 * recipe cap (such keys stay pricing gaps).
 */
async function orePrice(pack: Pack, entry: PriceGraph, graph: CandidateGraph, key: StuffKey, mined: (key: StuffKey) => boolean): Promise<number> {
  if (graph.truncated === true || (pack.producers.get(key) ?? []).length === 0) return Infinity;
  const ores = deadEnds(graph, key).filter(mined);
  if (ores.length === 0 || !makeableWith(graph, key, ores)) return Infinity;
  const { s, basis, leaf } = entry;
  const made = graph === entry.graph && entry.makeable !== undefined ? entry.makeable : makeableGoods(graph);
  const bought = (k: StuffKey): LeafDecision => ({ buyable: true, cost: basis.prices.price(k), leafClass: basis.avail.classOf(k) });
  const oreLeaf: LeafOracle = (k) => (mined(k) ? bought(k) : made.has(k) ? MADE_IN_PRICE_GRAPH : leaf(k));
  const walk = buildCandidates(pack, s, basis.env, oreLeaf, [key]);
  const united = unitedGraph(graph, walk, (k) => (mined(k) ? bought(k) : made.has(k) ? NOT_A_PRICE_LEAF : leaf(k)));
  for (const [k, good] of united.goods) if (mined(k)) united.goods.set(k, { ...good, ...bought(k) });
  return (await standalonePrices(united, [key])).get(key) ?? Infinity;
}

/**
 * The prices of `keys` in the pricing context of `settings` in `ctx` (fix wave 3 (D)): a buyable key costs its leaf's
 * cost (the leaf oracle of the context's basis with no `supplied` option, so water, air, cobblestone and lava stay
 * leaves at 0 as in every build-material breakdown (plan 09 Task 3), and without gathered recipes, so sand and gravel
 * are dug at their price — the analysis counts no machines: free cobblestone and hammers would price them at 0); stop
 * items are leaves at their override, else what making them on their own costs (`stopItemCosts`, change request 6). Any
 * other key costs the least raw material that makes one unit of it on its own (`standalonePrices`: its byproducts sunk)
 * on the context's price graph (`priceGraph`), or on its own walk when the price graph never reached it — with cost
 * overrides united with its own walk in the same context without them, as the price graph is, so there too an override
 * that makes a good cheaper never drops the producers the walk without it keeps — or, for a part only ore processing
 * makes, what `orePrice` gives. Each price is worked out once per context and key, so it never depends on the other
 * keys asked: the cost analysis of one candidate graph per key set that this replaced (`analyzeCosts`, which shares a
 * recipe's cost among its outputs by what else the graph holds) priced the Advanced Distillery at HV at 33.39 alone,
 * 34.59 beside the Large Chemical Reactor and 42.40 beside it and the Distillation Tower (all 42.59 now), and 16x
 * Redstone Alloy Cable at MV at 12.38 alone and 6.48 beside every cable (13.05 now).
 */
async function computePrices(pack: Pack, settings: PlanSettings, ctx: PlanContext, keys: readonly StuffKey[]): Promise<ItemPrices> {
  const entry = await priceGraph(pack, settings, ctx);
  const { s, basis, leaf, graph, priced } = entry;
  // An ore block a material line would buy here (makeLeafOracle's direct and byproduct ores).
  const mined = (key: StuffKey): boolean => {
    const reach = basis.avail.classOf(key);
    return (reach === 'direct' || reach === 'byproduct') && isOreBlock(pack, key);
  };
  const fresh = keys.filter((key) => !leaf(key).buyable && !priced.has(key));
  // a good the price graph cannot make costs Infinity without an LP (its makeable fixpoint, once per context)
  entry.makeable ??= makeableGoods(graph);
  const makeable = entry.makeable;
  const onGraph = fresh.filter((key) => graph.goods.has(key) && makeable.has(key));
  const batch = onGraph.length > 0 ? standalonePrices(graph, onGraph) : null;
  const withOre = async (key: StuffKey, cost: number, on: CandidateGraph): Promise<{ cost: number; graph: CandidateGraph }> =>
    ({ cost: Number.isFinite(cost) ? cost : await orePrice(pack, entry, on, key, mined), graph: on });
  for (const key of fresh) {
    const price = graph.goods.has(key)
      ? (batch !== null && makeable.has(key) ? batch.then((m) => withOre(key, m.get(key) ?? Infinity, graph)) : withOre(key, Infinity, graph))
      : (async () => {
        let own = buildCandidates(pack, s, basis.env, leaf, [key]);
        if (Object.keys(s.costOverrides).length > 0) {
          // united with the key's own walk in the same context without them, as `priceGraph` unites the price graphs
          const plain = await priceGraph(pack, { ...settings, costOverrides: {} }, ctx);
          own = unitedGraph(own, buildCandidates(pack, plain.s, plain.basis.env, plain.leaf, [key]), leaf);
        }
        return withOre(key, (await standalonePrices(own, [key])).get(key) ?? Infinity, own);
      })();
    priced.set(key, price);
    price.catch(() => {
      if (priced.get(key) === price) priced.delete(key);
    });
  }
  const asked = new Map<StuffKey, { cost: number; graph: CandidateGraph }>();
  for (const key of keys) {
    const price = priced.get(key);
    if (price !== undefined) asked.set(key, await price);
  }
  const cost = (key: StuffKey): number => {
    const decision = leaf(key);
    return decision.buyable ? decision.cost : (asked.get(key)?.cost ?? Infinity);
  };
  const gaps = new Map<StuffKey, PriceGap | undefined>();
  return {
    cost,
    gap(key) {
      if (!gaps.has(key)) gaps.set(key, Number.isFinite(cost(key)) ? undefined : gapOf(pack, asked.get(key)?.graph ?? graph, key, mined));
      return gaps.get(key);
    },
  };
}

const MEMOS = new WeakMap<Pack, Map<string, Promise<ItemPrices>>>();

/**
 * The prices for building `keys` (`buildKeys`) in the pricing context of `settings` in `ctx` (`computePrices`): one
 * table per pack and memo key (module doc), for at most MACHINE_PRICE_MEMO_SIZE keys per pack, the least recently used
 * dropped first; each key's price is worked out once per context, whatever else was asked with it. Callers asking while
 * it is computed share that computation; one that fails is not kept. Any key not asked that is no leaf reads Infinity,
 * so a caller asks for every key it prices. `gap` is worked out per key when first asked.
 */
export function itemPrices(pack: Pack, settings: PlanSettings, ctx: PlanContext, keys: readonly StuffKey[]): Promise<ItemPrices> {
  const asked = [...new Set(keys)].sort(byString);
  let memo = MEMOS.get(pack);
  if (memo === undefined) {
    memo = new Map();
    MEMOS.set(pack, memo);
  }
  const key = `${machinePricingKey(settings, ctx)}|${createHash('sha1').update(asked.join('\n')).digest('hex')}`;
  return memoized(memo, key, () => computePrices(pack, settings, ctx, asked));
}

const HATCHES = new WeakMap<Pack, ReadonlyMap<string, readonly Machine[]>>();

/** GT's simple class name (architecture §11.19): `Machine.cls` after its last '.'. */
function simpleName(m: Machine): string {
  return m.cls.slice(m.cls.lastIndexOf('.') + 1);
}

/** The pack's hatches by simple class name, each list lowest tier first (no tier last), then by mteId; once per pack. */
function hatchesByClass(pack: Pack): ReadonlyMap<string, readonly Machine[]> {
  let byClass = HATCHES.get(pack);
  if (byClass === undefined) {
    const lists = new Map<string, Machine[]>();
    for (const id of allMachineIds(pack)) {
      const m = machineOf(pack, id);
      if (m === undefined || m.kind !== 'hatch') continue;
      const list = lists.get(simpleName(m));
      if (list === undefined) lists.set(simpleName(m), [m]);
      else list.push(m);
    }
    for (const list of lists.values()) list.sort((a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity) || compareMachineId(a.id, b.id));
    byClass = lists;
    HATCHES.set(pack, byClass);
  }
  return byClass;
}

/**
 * The hatch class a structure hatch of class `cls` is built as: GT's creative debug hatches stand for the ordinary class
 * of their name without "Debug" (`MTEHatchInputBusDebug` for `MTEHatchInputBus`, `MTEHatchInputDebug` for
 * `MTEHatchInput`), where the pack has that class. The 2.9 export's structures hold them where the multiblock takes the
 * ordinary hatch (a Debug Input Bus in the Assembly Line and the Circuit Assembly Line, a Debug Input Hatch in the Large
 * Heat Exchanger), and nothing makes one, so each made its multiblock one that cannot be built here.
 */
function builtClass(byClass: ReadonlyMap<string, readonly Machine[]>, cls: string): string {
  const plain = cls.replace('Debug', '');
  return plain !== cls && byClass.has(plain) ? plain : cls;
}

/**
 * The hatch a multiblock is built with for a structure hatch: the hatch of the same simple class name (a debug hatch's,
 * that of the hatch it stands for: `builtClass`) with the lowest tier (no tier sorts last), ties by lowest mteId. An
 * exported structure holds whatever hatch its exporter placed (the real EBF's is a UV muffler hatch, which would price
 * every EBF out of reach below UV), and any tier of the class does the job. A machine that is no hatch is its own.
 */
export function minimalHatch(pack: Pack, hatch: Machine): Machine {
  if (hatch.kind !== 'hatch') return hatch;
  const byClass = hatchesByClass(pack);
  return byClass.get(builtClass(byClass, simpleName(hatch)))?.[0] ?? hatch;
}

/**
 * Blocks whose block meta holds more than their item's damage, and that damage (vanilla 1.7.10's `damageDropped`): an
 * anvil keeps its facing in the meta's low two bits and its damage above them, so the 2.9 export's Industrial
 * Sledgehammer, whose structure holds an anvil block at meta 1, is built with an Anvil (minecraft:anvil@0), not a
 * Slightly Damaged Anvil, which nothing makes.
 */
const ITEM_DAMAGE: Readonly<Record<string, (meta: number) => number>> = { 'minecraft:anvil': (meta) => meta >> 2 };

/** The item a structure cell of block `id` at `meta` is built from (`ITEM_DAMAGE`, else `itemKey(id, meta)`). */
export function cellItem(id: string, meta: number): StuffKey {
  return itemKey(id, Object.hasOwn(ITEM_DAMAGE, id) ? (ITEM_DAMAGE[id] as (meta: number) => number)(meta) : meta);
}

/**
 * The cells of a multiblock's exported structure other than the controller (its cell, and blocks of its own mteId) and
 * the cells that need nothing placed (`NOTHING_TO_PLACE`: air and fluids), in export order: the item each is built from —
 * a GT tile block's machine item, a hatch at the lowest tier of its class (`minimalHatch`), any other block its item
 * (`cellItem`) — and whether it is a hatch. None for a singleblock and for a multiblock without an exported structure.
 */
function structureBlocks(pack: Pack, m: Machine): Array<{ key: StuffKey; hatch: boolean }> {
  const s = m.structure;
  if (m.kind !== 'multiblock' || s === undefined) return [];
  const [cx, cy, cz] = s.controller;
  const cells: Array<{ key: StuffKey; hatch: boolean }> = [];
  for (const { pos, block } of s.blocks) {
    if ((pos[0] === cx && pos[1] === cy && pos[2] === cz) || block.mteId === legacyMteId(m.id) || NOTHING_TO_PLACE.has(block.id)) continue;
    const tile = block.mteId === undefined ? undefined : machineByMteId(pack, block.mteId);
    cells.push(tile === undefined
      ? { key: cellItem(block.id, block.meta), hatch: false }
      : { key: minimalHatch(pack, tile).itemKey, hatch: tile.kind === 'hatch' });
  }
  return cells;
}

/** Cells per item. */
function tally(cells: ReadonlyArray<{ key: StuffKey }>): Map<StuffKey, number> {
  const parts = new Map<StuffKey, number>();
  for (const { key } of cells) parts.set(key, (parts.get(key) ?? 0) + 1);
  return parts;
}

/**
 * The blocks of a multiblock's exported structure per item, one per cell, without the controller (the machine itself)
 * and the cells that need nothing placed (`NOTHING_TO_PLACE`), each structure hatch counted at the lowest tier of its
 * class (`minimalHatch`). Empty for a singleblock and for a multiblock without an exported structure.
 */
export function structureParts(pack: Pack, m: Machine): Map<StuffKey, number> {
  return tally(structureBlocks(pack, m));
}

/**
 * The hatches Plan 5's `multiblockShape` lays for a step of `r` on the multiblock `m`, kind for kind (the controller's
 * ruling after the merge of main's hatch rules at e2efd36: a multiblock's build holds exactly the hatches its layout
 * lays), keyed by the hatch's item:
 * - By its hatch rules (`hatchRulesOf`: a hatch-rules.ts row that fits the exported structure, narrowed by the export's
 *   own rules where it has them, or the export's rules alone; architecture §11 entries 47 and 49), as `ruledHatches`
 *   lays them, each only where the rules take its kind anywhere (`ruleTakes`): an input bus when `r` takes an item,
 *   consumed or not (a programmed circuit included), an output bus when it makes one (a steam multiblock's steam buses:
 *   the rules' `classes`); an energy hatch of exactly `tier` (the lowest mteId of that tier) when the machine is
 *   electric — its rules run it on EU, or only the export's rules know it, they took neither an energy nor a steam hatch
 *   and `r` draws EU — and the rules take GT's plain energy hatch (one taking only multi-amp or laser energy hatches gets
 *   none: `hatch_energy_exotic`); a steam hatch when they run it on steam; an input hatch per distinct fluid `r` takes (a
 *   slot of several fluid options counts once), each on the cells the rules give that fluid slot (`fluidInputSlots`); an
 *   output hatch per distinct fluid it makes, or on a tower that GT hands one fluid a layer (`layerOutputs`) one on every
 *   layer above the bottom of the tower its layout builds (taller for more fluids, up to `maxLayers`); a maintenance
 *   hatch where the rules take one; and where GT's structure check needs a hatch whatever the recipe moves (the rules'
 *   `needs`: an EBF's muffler, a tower's input hatch, a cracker's middle input hatch), one of each such kind that none of
 *   those can stand in for (none on the cells the need names) and, for a muffler, that the exported structure does not
 *   hold (a fluid of the machine's own, a boiler's water and steam, always).
 * - Without rules, as `genericHatches` lays them: the buses as above, an energy hatch of `tier`, a maintenance hatch, an
 *   input hatch per distinct fluid it takes and an output hatch per distinct fluid it makes.
 * The energy hatch aside, each at the lowest tier of its class (`minimalHatch`'s pick). A class the pack lacks (or no
 * energy hatch of `tier`) is left out: Plan 5 then warns `hatch_cells_short`. Empty for a machine that is no multiblock.
 */
export function hatchSet(pack: Pack, m: Machine, r: Recipe, tier: number): Map<StuffKey, number> {
  const set = new Map<StuffKey, number>();
  if (m.kind !== 'multiblock') return set;
  const byClass = hatchesByClass(pack);
  const lowest = (cls: string): Machine | undefined => byClass.get(cls)?.[0];
  const energy = byClass.get('MTEHatchEnergy')?.find((hatch) => hatch.tier === tier);
  const add = (hatch: Machine | undefined, n: number): void => {
    if (hatch !== undefined && n > 0) set.set(hatch.itemKey, (set.get(hatch.itemKey) ?? 0) + n);
  };
  const itemIn = r.meta.circuit !== undefined || r.inputs.some((ing) => ing.options.some((o) => !isFluidKey(o.key)));
  const itemOut = r.outputs.some((p) => !isFluidKey(p.key));
  // the fluid slots, each once, in slot order, with the slot (from 0) GT counts its fluid inputs by
  const fluidSlots = new Map<string, number>();
  for (const ing of r.inputs) {
    if (ing.options.length === 0 || !ing.options.every((o) => isFluidKey(o.key))) continue;
    const key = ing.options.map((o) => o.key).sort(byString).join('/');
    if (!fluidSlots.has(key)) fluidSlots.set(key, ing.slot - FLUID_SLOT_BASE);
  }
  const fluidsOut = new Set(r.outputs.filter((p) => isFluidKey(p.key)).map((p) => p.key));
  const { rules, needs, exportedMuffler } = laidRules(pack, m);
  if (rules === null) {
    add(lowest('MTEHatchInputBus'), itemIn ? 1 : 0);
    add(lowest('MTEHatchOutputBus'), itemOut ? 1 : 0);
    add(energy, 1);
    add(lowest('MTEHatchMaintenance'), 1);
    add(lowest('MTEHatchInput'), fluidSlots.size);
    add(lowest('MTEHatchOutput'), fluidsOut.size);
    return set;
  }
  const { rule, source } = rules;
  /** The element characters that take `kind`. */
  const takers = (kind: HatchKind): string => Object.keys(rule.elements).filter((ch) => rule.elements[ch]?.includes(kind) === true).join('');
  /** The hatches laid, each with the characters of the cells it may stand on; and the kinds a hatch of which found no cell or no hatch. */
  const laid: Array<{ kind: HatchKind; chars: string }> = [];
  const short = new Set<HatchKind>();
  const lay = (kind: HatchKind, hatch: Machine | undefined, within?: string): void => {
    if (!ruleTakes(rule, kind)) return;   // `hatch_not_taken`
    const chars = [...takers(kind)].filter((ch) => within === undefined || within.includes(ch)).join('');
    if (hatch === undefined || chars === '') {
      short.add(kind);   // `hatch_cells_short`
      return;
    }
    add(hatch, 1);
    laid.push({ kind, chars });
  };
  const of = (kind: HatchKind): Machine | undefined => lowest(rule.classes?.[kind] ?? KIND_CLASS[kind]);
  const power = rulePower(rule);
  if (itemIn) lay('input_bus', of('input_bus'));
  if (itemOut) lay('output_bus', of('output_bus'));
  if (power === 'eu' || (source === 'export' && power === 'none' && r.euPerTick > 0)) lay('energy', energy);
  if (power === 'steam') lay('steam', of('steam'));
  for (const slot of fluidSlots.values()) lay('input_hatch', of('input_hatch'), rule.fluidInputSlots?.[slot]);
  const layers = rule.layerOutputs === undefined ? 0 : towerHeight(m, fluidsOut.size, rule.layerOutputs.maxLayers) - 1;
  for (let k = 0; k < (rule.layerOutputs === undefined ? fluidsOut.size : layers); k++) lay('output_hatch', of('output_hatch'));
  lay('maintenance', of('maintenance'));
  for (const need of needs) {
    const met = !need.own && (laid.some((h) => h.kind === need.kind && [...h.chars].every((ch) => need.chars === undefined || need.chars.includes(ch)))
      || (need.kind === 'muffler' && exportedMuffler));
    if (met || (!need.own && short.has(need.kind))) continue;
    lay(need.kind, need.kind === 'energy' ? energy : lowest(need.cls), need.chars);
  }
  return set;
}

/** GT's first fluid slot (`Ingredient.slot`): fluid inputs count from it. */
const FLUID_SLOT_BASE = 100;

/**
 * The height of the tower Plan 5's layout builds for a step of `fluids` fluid outputs on `m` (`ruledHatches`, whose
 * `growLayers` adds layers to a tower of at least 3): one layer per fluid above the bottom, at least its exported height,
 * at most `maxLayers`.
 */
function towerHeight(m: Machine, fluids: number, maxLayers: number): number {
  const height = m.structure?.size[1] ?? 0;
  return height < 3 ? height : height + Math.min(Math.max(0, fluids + 1 - height), Math.max(0, maxLayers - height));
}

/**
 * How Plan 5's layout lays a multiblock's hatches: by the hatch rules of `hatchRulesOf` (null: generically), what GT's
 * structure check needs whatever the recipe moves (`ruleNeeds`: each need's kind, its class, a rule's own class for the
 * kind first, the cells it names and whether it is a fluid of the machine's own), and whether the exported structure
 * holds a muffler, which the layout keeps as the muffler it needs.
 */
interface LaidRules {
  rules: { rule: HatchRule; source: HatchSource } | null;
  needs: ReadonlyArray<{ kind: HatchKind; cls: string; chars?: string; own: boolean }>;
  exportedMuffler: boolean;
}
const LAID_RULES = new WeakMap<Pack, WeakMap<Machine, LaidRules>>();

/**
 * The `LaidRules` of `m`, once per pack and machine, since `hatchSet` runs for every multiblock option the planner
 * weighs and fitting a rule walks its whole structure.
 */
function laidRules(pack: Pack, m: Machine): LaidRules {
  let byMachine = LAID_RULES.get(pack);
  if (byMachine === undefined) LAID_RULES.set(pack, (byMachine = new WeakMap()));
  let found = byMachine.get(m);
  if (found === undefined) {
    const of = hatchRulesOf(m);
    const rule = of?.rule;
    found = {
      rules: of === null ? null : { rule: of.rule, source: of.source },
      needs: rule === undefined ? [] : ruleNeeds(rule).map((need) => ({
        kind: need.kind, cls: rule.classes?.[need.kind] ?? KIND_CLASS[need.kind], ...(need.chars === undefined ? {} : { chars: need.chars }), own: need.fluid !== undefined,
      })),
      exportedMuffler: (m.structure?.blocks ?? []).some((b) => {
        const tile = b.block.mteId === undefined || b.block.mteId === legacyMteId(m.id) ? undefined : machineByMteId(pack, b.block.mteId);
        return tile?.kind === 'hatch' && simpleName(minimalHatch(pack, tile)) === KIND_CLASS.muffler;
      }),
    };
    byMachine.set(m, found);
  }
  return found;
}

/**
 * The keys to price for building `machines` (`itemPrices`): each machine's item and, for a multiblock, its structure
 * parts (`structureParts`), the item of every hatch of the `HATCH_CLASSES` and the lowest hatch of each other class its
 * hatch rules may lay (`laidRules`: a steam multiblock's buses and steam hatch, what its structure check needs), which
 * `hatchSet` may add; sorted, without repeats. A pseudo machine (crafting table, furnace) has no build cost, so its item
 * is left out.
 */
export function buildKeys(pack: Pack, machines: readonly Machine[]): StuffKey[] {
  const keys = new Set<StuffKey>();
  let multiblock = false;
  for (const m of machines) {
    if (isPseudoMachineId(m.id)) continue;
    keys.add(m.itemKey);
    if (m.kind !== 'multiblock') continue;
    multiblock = true;
    for (const { key } of structureBlocks(pack, m)) keys.add(key);
    const { rules, needs } = laidRules(pack, m);
    const classes = [...needs.map((need) => need.cls), ...Object.values(rules?.rule.classes ?? {})];
    if (rules !== null && rulePower(rules.rule) === 'steam') classes.push(rules.rule.classes?.steam ?? KIND_CLASS.steam);
    for (const cls of classes) {
      const hatch = hatchesByClass(pack).get(cls)?.[0];
      if (hatch !== undefined) keys.add(hatch.itemKey);
    }
  }
  if (multiblock) {
    const byClass = hatchesByClass(pack);
    for (const cls of HATCH_CLASSES) for (const hatch of byClass.get(cls) ?? []) keys.add(hatch.itemKey);
  }
  return [...keys].sort(byString);
}

/** How a machine is used: a step of `recipe` with its energy hatch at `tier` (a multiblock's hatch tier). */
type MachineUse = { recipe: Recipe; tier: number };

/**
 * What building one `m` takes, as [key, amount] lines whose costs add up to its build cost: its item and, for a
 * multiblock, its structure parts and, with `use`, the hatches it needs to run (`hatchSet`), less the `h` structure
 * casings they stand on — `h` the number of hatches, at most the casing's cells, the casing being the structure's most
 * common block that is neither the controller nor a hatch (ties by the smaller key).
 */
function billOf(pack: Pack, m: Machine, use: MachineUse | undefined): Array<[StuffKey, number]> {
  const bill: Array<[StuffKey, number]> = [[m.itemKey, 1]];
  if (m.kind !== 'multiblock') return bill;
  const cells = structureBlocks(pack, m);
  bill.push(...tally(cells));
  if (use === undefined) return bill;
  let hatches = 0;
  for (const [key, n] of hatchSet(pack, m, use.recipe, use.tier)) {
    bill.push([key, n]);
    hatches += n;
  }
  let casing: [StuffKey, number] | undefined;
  for (const [key, n] of tally(cells.filter((c) => !c.hatch))) {
    if (casing === undefined || n > casing[1] || (n === casing[1] && key < casing[0])) casing = [key, n];
  }
  const replaced = casing === undefined ? 0 : Math.min(hatches, casing[1]);
  if (casing !== undefined && replaced > 0) bill.push([casing[0], -replaced]);
  return bill;
}

/**
 * The raw material to build one `m` (`sig9`): its item for a singleblock (any machine that is no multiblock); for a
 * multiblock its controller and structure, plus with `use` the hatches it needs to run less the casings they stand on
 * (`billOf`), so each hatch tier of a multiblock costs what its energy hatch costs. Every machine option and plan step
 * passes `use`; the cleanroom alone goes without. Null for `undefined`, a pseudo machine (crafting table, furnace, hand)
 * and a machine any of whose parts is priced Infinity (`machineGap` says why).
 */
export function machineBuildCost(pack: Pack, prices: ItemPrices, m: Machine | undefined, use?: MachineUse): number | null {
  if (m === undefined || isPseudoMachineId(m.id)) return null;
  let total = 0;
  for (const [key, n] of billOf(pack, m, use)) {
    const each = prices.cost(key);
    if (!Number.isFinite(each)) return null;
    total += n * each;
  }
  return sig9(total);
}

/**
 * Why `m` has no build cost (controller ruling OQ5): null when `machineBuildCost` is a number, `m` is undefined or a
 * pseudo machine; else the gap of its item when that is unpriced, else that of its first unpriced part by key (structure
 * parts, then with `use` its hatch set), a part's `no-recipe` reading as `unavailable` of that part (the machine needs a
 * part nothing makes).
 */
export function machineGap(pack: Pack, prices: ItemPrices, m: Machine | undefined, use?: MachineUse): PriceGap | null {
  if (m === undefined || isPseudoMachineId(m.id) || machineBuildCost(pack, prices, m, use) !== null) return null;
  const own = prices.gap(m.itemKey);
  if (own !== undefined) return own;
  const parts = [...structureParts(pack, m).keys()].sort(byString);
  const hatches = use === undefined ? [] : [...hatchSet(pack, m, use.recipe, use.tier).keys()].sort(byString);
  for (const key of [...parts, ...hatches]) {
    const gap = prices.gap(key);
    if (gap !== undefined) return gap.kind === 'no-recipe' ? { kind: 'unavailable', item: key } : gap;
  }
  return { kind: 'gap' };   // not reached: every part priced Infinity has a gap
}

/**
 * The plain-words reason `m` cannot be built here, for a step's or a plan's text: `no recipe in this pack`; `nothing at
 * <tier> makes it` when its own item is out of reach; `needs <item>, not available at <tier>`. Null for a pricing gap,
 * which can be built (the solve weighs it at a stand-in).
 */
export function gapText(pack: Pack, m: Machine, gap: PriceGap, tier: number): string | null {
  switch (gap.kind) {
    case 'no-recipe':
      return 'no recipe in this pack';
    case 'unavailable':
      return gap.item === m.itemKey ? `nothing at ${tierName(tier)} makes it` : `needs ${pack.nameOf(gap.item)}, not available at ${tierName(tier)}`;
    case 'gap':
      return null;
  }
}

/**
 * The raw material of the build lines `add` less that of `minus` (`sig9`, never below 0), over one `itemPrices` call for
 * all their keys; a key priced Infinity counts nothing. Plan 5's layout parts are priced so, less the casings their
 * hatches replace.
 */
export async function bomBuildCost(
  pack: Pack, settings: PlanSettings, ctx: PlanContext, add: readonly BomLine[], minus: readonly BomLine[] = [],
): Promise<number> {
  const prices = await itemPrices(pack, settings, ctx, [...add, ...minus].map((line) => line.key));
  const sum = (lines: readonly BomLine[]): number => {
    let total = 0;
    for (const { key, amount } of lines) {
      const each = prices.cost(key);
      if (Number.isFinite(each)) total += amount * each;
    }
    return total;
  };
  return Math.max(0, sig9(sum(add) - sum(minus)));
}
