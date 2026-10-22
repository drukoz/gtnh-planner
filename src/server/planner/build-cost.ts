// Machine build cost (spec §3.3 "material use includes the machines the group does not have yet", architecture §11.28 as
// entry 39 amends it): the raw material to build one machine, at the same pricing as derived materials (pricing.ts's
// cost model: a candidate graph walked back to buyable leaves, priced by the cost analysis) — its item's crafting chain,
// and for a multiblock also its exported structure, every structure hatch at the lowest tier of its class, plus the
// hatches it needs to run less the casings they stand on. It also says why a price is missing (controller ruling OQ5):
// a machine no recipe of the pack makes, or whose chain needs an item out of reach, cannot be built here; one that can be
// made, but that the cost analysis finds no price for, is a pricing gap.
//
// Memo key (`itemPrices`): `machinePricingKey(settings, ctx)` — `settingsHash(pricingSettings(settings, ctx))`, the hash
// of the very settings `planBasis` and the walk get, then `|` and `basisContextKey(ctx)` — then `|` and the SHA-1 of the
// sorted, deduplicated keys asked, joined by `\n`. The pricing reads no setting that key leaves out (it reads the tier,
// coil heat, dimensions, excluded categories, cost overrides, stop and expand items), so a project's target, amount,
// mode, logistics, build horizon, reuse settings, recipe and option pins and avoid list neither invalidate the memo nor
// change a price (machine prices avoid nothing, plan 08's ruling R6), and no price depends on which keys were priced
// before (the keys asked are part of the key).

import { createHash } from 'node:crypto';
import { PSEUDO_IDS, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, itemKey, type StuffKey } from '../../shared/keys.ts';
import { defaultSettings } from '../../shared/project/apply-op.ts';
import type { Machine, Pack, Recipe } from '../../shared/types/pack.ts';
import type { HatchKind } from '../../shared/types/layout.ts';
import type { BomLine, PlanContext, PlanSettings } from '../../shared/types/plan.ts';
// GT's structure rules the layout lays a multiblock's hatches by (entries 47 and 49 (3): `hatchRulesOf`, which reads
// only the machine and its export), read here so a multiblock's build holds the hatches its layout lays
import { hatchRulesOf, KIND_CLASS, ruleNeeds } from '../layout/hatch-rules.ts';
import { basisContextKey, effectiveTier, planBasis, settingsHash } from './basis.ts';
import { buildCandidates, type CandidateGraph, type LeafOracle } from './candidates.ts';
import { analyzeCosts, isOreBlock, makeLeafOracle } from './costs.ts';
import { yieldToEventLoop } from './lp.ts';
import { sig9 } from './round.ts';
import { deadEnds, deadEndsAlone, makeableWith } from './solve.ts';

/** Machine pricings kept per pack (`itemPrices`), the least recently used dropped first. */
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
 * tier) or a base material out of reach; `gap`, it is made and nothing in its chain is out of reach, yet the cost
 * analysis finds no price (its chain only meets loops with no way in).
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
 * Why `key`, priced Infinity in `graph` (null: no graph was walked) and by `oreProcessed`, has no price: `no-recipe` when
 * no recipe of the pack makes it, else a pricing gap when the ore blocks among its dead ends that the group can mine
 * (`mined`) would let it be made — its chain is available, only its price is missing (controller ruling OQ5 b; such a
 * key `oreProcessed` usually prices, as it did the Advanced Lathe and Advanced Macerator of the 2.9 export at MV, which
 * read "needs Native Diamond Cluster, not available at MV" before, a mod item that sorted first among such dead ends) —
 * else a good `deadEnds` names, else a pricing gap. The good named is one that alone,
 * made available, would let `key` be made (`deadEndsAlone`), else any dead end; among those a base material out of reach
 * first, then a good whose recipes cannot run here (it has a `blocked` entry), then any other (a good nothing makes),
 * each by key, and an ore the group can mine last (it is what the machine lacks only where nothing else is). Of the dead ends of every route sorted by key, the first was often one route's oddity — on the 2.9 export
 * the reactor sensor location cards nothing makes, behind the "Any MV Circuit" stand-in that one recipe of an Emitter
 * (MV) takes, or that an MV-circuit slot lists beside the real circuits — while what kept the machine from being built
 * was another good. A walk stopped at its recipe cap left goods unexpanded that would look out of reach, so there every
 * such key is a pricing gap, never a machine that cannot be built.
 */
function gapOf(pack: Pack, graph: CandidateGraph | null, key: StuffKey, mined: (key: StuffKey) => boolean): PriceGap {
  if ((pack.producers.get(key) ?? []).length === 0) return { kind: 'no-recipe' };
  if (graph?.truncated === true) return { kind: 'gap' };
  if (graph === null) return { kind: 'unavailable', item: key };
  const rank = (end: StuffKey): number => (mined(end) ? 3 : graph.goods.get(end)?.leafClass === 'unavailable' ? 0 : graph.blocked.has(end) ? 1 : 2);
  const first = (ends: readonly StuffKey[]): StuffKey | undefined => [...ends].sort((a, b) => rank(a) - rank(b) || byString(a, b))[0];
  const ends = deadEnds(graph, key);
  const ores = ends.filter(mined);
  if (ores.length > 0 && makeableWith(graph, key, ores)) return { kind: 'gap' };
  const item = first(deadEndsAlone(graph, key, ends)) ?? first(ends);
  return item === undefined ? { kind: 'gap' } : { kind: 'unavailable', item };
}

/**
 * The prices of `keys` at `s` (`pricingSettings`): the leaf oracle of its basis with no `supplied` option, so water, air,
 * cobblestone and lava stay leaves at 0 as in every build-material breakdown (plan 09 Task 3), and without gathered
 * recipes, so sand and gravel are dug at their price (the cost analysis counts no machines: free cobblestone and hammers
 * would price them at 0); stop items are leaves at their override or price. A buyable key costs its leaf's cost; the
 * others are the targets of one candidate graph, and cost what its cost analysis gives them, or for a part only ore
 * processing makes what the walk from the ores the group can mine gives it (`oreProcessed`).
 */
async function computePrices(pack: Pack, s: PlanSettings, ctx: PlanContext, keys: readonly StuffKey[]): Promise<ItemPrices> {
  await yieldToEventLoop();
  const basis = planBasis(pack, s, ctx);
  const leaf = makeLeafOracle(pack, s, basis.avail, basis.prices);
  const made = keys.filter((key) => !leaf(key).buyable);
  const graph = made.length > 0 ? buildCandidates(pack, s, basis.env, leaf, made) : null;
  const costs = graph === null ? null : await analyzeCosts(graph);
  const first = (key: StuffKey): number => {
    const decision = leaf(key);
    return decision.buyable ? decision.cost : (costs?.cost(key) ?? Infinity);
  };
  // An ore block a material line would buy here (makeLeafOracle's direct and byproduct ores).
  const mined = (key: StuffKey): boolean => {
    const reach = basis.avail.classOf(key);
    return (reach === 'direct' || reach === 'byproduct') && isOreBlock(pack, key);
  };
  const ores = await oreProcessed(pack, s, basis, graph, made, first, mined);
  const cost = (key: StuffKey): number => {
    const price = first(key);
    return Number.isFinite(price) ? price : (ores?.cost(key) ?? Infinity);
  };
  const gaps = new Map<StuffKey, PriceGap | undefined>();
  return {
    cost,
    gap(key) {
      if (!gaps.has(key)) gaps.set(key, Number.isFinite(cost(key)) ? undefined : gapOf(pack, graph, key, mined));
      return gaps.get(key);
    },
  };
}

/**
 * Fix wave 2 (c), controller ruling 187: the parts only ore processing makes, priced from the ore blocks the group can
 * mine (`mined`). Machine prices buy no ore blocks (plan 09's R8: only a material line does), so a part only sifting or
 * washing an ore makes had no price — on the 2.9 export the Flawless Diamond of the Advanced Lathe (292) and the Advanced
 * Macerator (302), so neither machine could be weighed at MV. Each key of `made` the first price graph left unpriced,
 * which a recipe of the pack makes and which the ores among its dead ends would let be made (`makeableWith`), is walked
 * again with those ores as leaves at their price and every good the first graph priced a leaf at that price (so an ore
 * stands in only where nothing else makes the part, and no other price moves); the cost analysis of that walk prices
 * them. Null when no key needs it (or the first walk was cut short at its recipe cap: then such keys stay gaps).
 */
async function oreProcessed(
  pack: Pack, s: PlanSettings, basis: ReturnType<typeof planBasis>, graph: CandidateGraph | null, made: readonly StuffKey[],
  first: (key: StuffKey) => number, mined: (key: StuffKey) => boolean,
): Promise<{ cost(key: StuffKey): number } | null> {
  if (graph === null || graph.truncated === true) return null;
  const targets = made.filter((key) => {
    if (Number.isFinite(first(key)) || (pack.producers.get(key) ?? []).length === 0) return false;
    const ends = deadEnds(graph, key).filter(mined);
    return ends.length > 0 && makeableWith(graph, key, ends);
  });
  if (targets.length === 0) return null;
  const leaf = makeLeafOracle(pack, s, basis.avail, basis.prices);
  const oreLeaf: LeafOracle = (key) => {
    if (mined(key)) return { buyable: true, cost: basis.prices.price(key), leafClass: basis.avail.classOf(key) };
    const decision = leaf(key);
    if (decision.buyable) return decision;
    const price = first(key);
    return Number.isFinite(price) ? { buyable: true, cost: price, leafClass: 'derived' } : decision;
  };
  return analyzeCosts(buildCandidates(pack, s, basis.env, oreLeaf, targets));
}

const MEMOS = new WeakMap<Pack, Map<string, Promise<ItemPrices>>>();

/**
 * The prices for building `keys` (`buildKeys`) in the pricing context of `settings` in `ctx`, computed once per pack and
 * memo key (module doc), for at most MACHINE_PRICE_MEMO_SIZE keys per pack, the least recently used dropped first.
 * Callers asking while it is computed share that computation; one that fails is not kept. The keys asked, and the goods
 * their chains walk, are priced; any other key that is no leaf reads Infinity, so a caller asks for every key it prices.
 * `gap` is worked out per key when first asked, from the same price graph.
 */
export function itemPrices(pack: Pack, settings: PlanSettings, ctx: PlanContext, keys: readonly StuffKey[]): Promise<ItemPrices> {
  const asked = [...new Set(keys)].sort(byString);
  const key = `${machinePricingKey(settings, ctx)}|${createHash('sha1').update(asked.join('\n')).digest('hex')}`;
  let memo = MEMOS.get(pack);
  if (memo === undefined) {
    memo = new Map();
    MEMOS.set(pack, memo);
  }
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const prices = computePrices(pack, pricingSettings(settings, ctx), ctx, asked);
  memo.set(key, prices);
  if (memo.size > MACHINE_PRICE_MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  const kept = memo;
  prices.catch(() => {
    if (kept.get(key) === prices) kept.delete(key);
  });
  return prices;
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
    for (const m of pack.machines.values()) {
      if (m.kind !== 'hatch') continue;
      const list = lists.get(simpleName(m));
      if (list === undefined) lists.set(simpleName(m), [m]);
      else list.push(m);
    }
    for (const list of lists.values()) list.sort((a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity) || a.mteId - b.mteId);
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
    if ((pos[0] === cx && pos[1] === cy && pos[2] === cz) || block.mteId === m.mteId || NOTHING_TO_PLACE.has(block.id)) continue;
    const tile = block.mteId === undefined ? undefined : pack.machines.get(block.mteId);
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
 * The hatches Plan 5's `multiblockShape` places for a step of `r` on the multiblock `m`, one each, keyed by the hatch's
 * item: an input bus when `r` takes an item, consumed or not (a programmed circuit included), an output bus when it
 * makes an item, an energy hatch of exactly `tier` (the lowest mteId of that tier), a maintenance hatch, an input hatch
 * per distinct fluid it takes (a slot of several fluid options counts once) and an output hatch per distinct fluid it
 * makes; and where GT's structure check needs a hatch whatever the recipe moves (an EBF's muffler, a tower's input
 * hatch: the `needs` of the rules the layout lays it by, `hatchRulesOf` — a hatch-rules.ts row that fits the exported
 * structure, with or without the export's own rules, architecture §11 entries 47 and 49 (3); the export's rules alone
 * need none), one of each such kind that neither those hatches nor the exported structure hold (a fluid of the
 * machine's own, a boiler's water and steam, always), as Plan 5's `ruledHatches` adds it on a casing, so the build and
 * the layout agree (plan 12 Task 6, the controller's note at the merge of main's hatch rules). The energy hatch aside,
 * each at the lowest tier of its class (`minimalHatch`'s pick). A class the pack lacks (or no energy hatch of `tier`) is
 * left out: Plan 5 then warns `hatch_cells_short`. Empty for a machine that is no multiblock.
 */
export function hatchSet(pack: Pack, m: Machine, r: Recipe, tier: number): Map<StuffKey, number> {
  const set = new Map<StuffKey, number>();
  if (m.kind !== 'multiblock') return set;
  const byClass = hatchesByClass(pack);
  const add = (hatch: Machine | undefined, n: number): void => {
    if (hatch !== undefined && n > 0) set.set(hatch.itemKey, (set.get(hatch.itemKey) ?? 0) + n);
  };
  const lowest = (cls: string): Machine | undefined => byClass.get(cls)?.[0];
  const itemIn = r.meta.circuit !== undefined || r.inputs.some((ing) => ing.options.some((o) => !isFluidKey(o.key)));
  const itemOut = r.outputs.some((p) => !isFluidKey(p.key));
  const fluidsIn = new Set(r.inputs.filter((ing) => ing.options.length > 0 && ing.options.every((o) => isFluidKey(o.key)))
    .map((ing) => ing.options.map((o) => o.key).sort(byString).join('/')));
  const fluidsOut = new Set(r.outputs.filter((p) => isFluidKey(p.key)).map((p) => p.key));
  add(lowest('MTEHatchInputBus'), itemIn ? 1 : 0);
  add(lowest('MTEHatchOutputBus'), itemOut ? 1 : 0);
  add(byClass.get('MTEHatchEnergy')?.find((hatch) => hatch.tier === tier), 1);
  add(lowest('MTEHatchMaintenance'), 1);
  add(lowest('MTEHatchInput'), fluidsIn.size);
  add(lowest('MTEHatchOutput'), fluidsOut.size);
  const { needs, exported } = structureNeeds(pack, m);
  if (needs.length > 0) {
    const placed = new Set<HatchKind>(['energy', 'maintenance', ...(itemIn ? ['input_bus' as const] : []), ...(itemOut ? ['output_bus' as const] : []),
      ...(fluidsIn.size > 0 ? ['input_hatch' as const] : []), ...(fluidsOut.size > 0 ? ['output_hatch' as const] : [])]);
    for (const need of needs) {
      if (!need.own && (placed.has(need.kind) || exported.has(need.cls))) continue;
      add(lowest(need.cls), 1);
    }
  }
  return set;
}

/**
 * What GT's structure check needs on a multiblock whatever its recipe moves: each need's kind, its class (a rule's own
 * class for the kind first) and whether it is a fluid of the machine's own; and the classes of the hatches its exported
 * structure holds, as `minimalHatch` builds them.
 */
interface StructureNeeds { needs: ReadonlyArray<{ kind: HatchKind; cls: string; own: boolean }>; exported: ReadonlySet<string> }
const NO_NEEDS: StructureNeeds = { needs: [], exported: new Set() };
const STRUCTURE_NEEDS = new WeakMap<Pack, WeakMap<Machine, StructureNeeds>>();

/**
 * The `StructureNeeds` of `m`: `ruleNeeds` of the hatch rules the layout lays it by (`hatchRulesOf`, architecture §11
 * entries 47 and 49 (3): a row that fits its exported structure, narrowed by the export's own rules where it has them),
 * none for a multiblock without a fitting row (the export's rules alone carry no needs). Once per pack and machine,
 * since `hatchSet` runs for every multiblock option the planner weighs and fitting a rule walks its whole structure.
 */
function structureNeeds(pack: Pack, m: Machine): StructureNeeds {
  let byMachine = STRUCTURE_NEEDS.get(pack);
  if (byMachine === undefined) STRUCTURE_NEEDS.set(pack, (byMachine = new WeakMap()));
  let found = byMachine.get(m);
  if (found === undefined) {
    const rule = hatchRulesOf(m)?.rule;
    const needs = rule === undefined ? [] : ruleNeeds(rule);
    const st = m.structure;
    found = rule === undefined || needs.length === 0 || st === undefined ? NO_NEEDS : {
      needs: needs.map((need) => ({ kind: need.kind, cls: rule.classes?.[need.kind] ?? KIND_CLASS[need.kind], own: need.fluid !== undefined })),
      exported: new Set(st.blocks.flatMap((b) => {
        const tile = b.block.mteId === undefined || b.block.mteId === m.mteId ? undefined : pack.machines.get(b.block.mteId);
        return tile?.kind === 'hatch' ? [simpleName(minimalHatch(pack, tile))] : [];
      })),
    };
    byMachine.set(m, found);
  }
  return found;
}

/**
 * The keys to price for building `machines` (`itemPrices`): each machine's item and, for a multiblock, its structure
 * parts (`structureParts`), the item of every hatch of the `HATCH_CLASSES` and the lowest hatch of each class its
 * structure check needs (`structureNeeds`, which `hatchSet` may add); sorted, without repeats. A pseudo machine
 * (crafting table, furnace) has no build cost, so its item is left out.
 */
export function buildKeys(pack: Pack, machines: readonly Machine[]): StuffKey[] {
  const keys = new Set<StuffKey>();
  let multiblock = false;
  for (const m of machines) {
    if (PSEUDO_IDS.has(m.mteId)) continue;
    keys.add(m.itemKey);
    if (m.kind !== 'multiblock') continue;
    multiblock = true;
    for (const { key } of structureBlocks(pack, m)) keys.add(key);
    for (const { cls } of structureNeeds(pack, m).needs) {
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
  if (m === undefined || PSEUDO_IDS.has(m.mteId)) return null;
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
  if (m === undefined || PSEUDO_IDS.has(m.mteId) || machineBuildCost(pack, prices, m, use) !== null) return null;
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
