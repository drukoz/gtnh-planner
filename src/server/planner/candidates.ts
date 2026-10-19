// Candidate recipes (spec §3.3 and §5, gt-mechanics §1.2(b) and §6.4): which recipes the group can run at its tier, and
// the recipe graph the LP plans over, walked back from the targets to buyable leaves. Ore-dictionary slots become
// virtual `alt:` goods that free `convert` recipes fill from each kept option. A graph can avoid goods (§11.25): it
// never buys one, consumes one or holds one in a machine (a lens, mold or catalyst slot).

import { ebfHeat, voltageTier } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Pack, Recipe } from '../../shared/types/pack.ts';
import type { LeafClass, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';

export interface PlanEnv {
  tier: number; reachable: ReadonlySet<string> /* DimensionInfo.key and Capability.key */; lowGravity: boolean; coilHeat: number; excluded: ReadonlySet<string>;
  /**
   * The mteIds of the multiblocks the group can build at this tier: their controller is available (availability.ts).
   * Absent = every multiblock counts as built. Multiblocks carry no tier in the export, so without this gate the
   * Eye of Harmony, the Godforge modules or the HTGR (EU/t 0 or 1) would run at any tier.
   */
  multiblocks?: ReadonlySet<number>;
  /**
   * Ids of the recipes that make an ore material out of nothing but free inputs (availability.ts `fromNothing`), left out
   * like every other recipe of the `lava-centrifuge` category. Absent = none.
   */
  fromNothing?: ReadonlySet<string>;
}
/** `fuel`: the recipe only burns its inputs in a generator (a fuel map, or one run by generators, boilers or turbines). */
export type Rejection = 'fake' | 'opaque' | 'excluded' | 'vanilla-furnace' | 'low-gravity' | 'heat' | 'tier' | 'no-machine' | 'multiblock' | 'fuel';
export type Acceptance = { ok: true; mapId: string } | { ok: false; why: Rejection; needTier?: number };

export interface LpRecipe {
  id: string; kind: 'recipe' | 'convert'; mapId: string | null;
  /** Per run, expected values: + output × chance, − consumed input × chance; summed per key, sorted by key, zeros dropped. */
  coeffs: Array<[StuffKey, number]>;
  /** euPerTick × durationTicks; 0 for convert. */
  euPerRun: number;
  nonConsumed: StuffKey[]; needsCleanroom: boolean;
  // optional addition
  /** The good the recipe is for: its first listed output (a convert recipe's virtual good). */
  main?: StuffKey;
}
export interface LeafDecision {
  buyable: boolean; cost: number; leafClass: LeafClass | null /* null = not a leaf, must be made */;
  // optional additions: a bought derived leaf's chain (`Standalone`, solve.ts), which the solver's tie-breaks read
  /** The recipes the chain that makes it runs. */
  steps?: number;
  /** The free input (water, air, cobblestone, lava) that chain takes per unit. */
  free?: number;
}
export type LeafOracle = (key: StuffKey) => LeafDecision;
export interface GoodInfo {
  key: StuffKey; buyable: boolean; cost: number; leafClass: LeafClass | null; virtual: boolean;
  // optional additions
  /** `LeafDecision.steps` and `free` of a bought derived leaf. */
  steps?: number;
  free?: number;
}
export interface CandidateGraph {
  targets: StuffKey[]; recipes: LpRecipe[] /* sorted by id */; goods: Map<StuffKey, GoodInfo>;
  blocked: Map<StuffKey, Array<{ recipeId: string; why: Rejection; needTier?: number }>>; warnings: PlanWarning[];
  // optional additions
  /** The walk stopped at its recipe cap: goods it never expanded look unmakeable, so blockers would name the wrong goods. */
  truncated?: boolean;
  /**
   * The goods the graph avoids (`CandidateOptions.avoid`), when there are any: its slots lack them, consumed ones (its
   * ore-dictionary slots) and the not-consumed ones its recipes hold (`LpRecipe.nonConsumed`) alike.
   */
  avoid?: ReadonlySet<StuffKey>;
}

const MAX_TIER = V.length - 1;
/** The walk stops adding recipes here (`CandidateGraph.truncated`). */
export const MAX_RECIPES = 40_000;
/** Options kept for an ore-dictionary slot none of whose options has a finite estimated cost. */
const MAX_UNBUYABLE_OPTIONS = 8;
/**
 * Producers (and ore-dictionary options) kept per good: the cheapest by estimated raw cost, at most this many, and only
 * those within `KEEP_WITHIN` × the cheapest (prior-art §3.4 step 2, "prune recipes whose cost is far above the cheapest
 * alternative"). Without it the walk took every producer of every good: on the real export an Electronic Circuit pulled
 * in every ore's macerator recipe (for their chanced stone-dust byproducts), every cell canner and every recycling
 * smelt, and stopped at its recipe cap with most of its chain unexpanded.
 */
const KEEP_PRODUCERS = 3;
const KEEP_WITHIN = 2;
/** Slack when comparing estimates. */
const ESTIMATE_TOLERANCE = 1e-9;

/**
 * A binary min-heap of [cost, key], equal costs by key: the order goods settle in must not depend on the order the
 * export lists recipes and ore-dictionary options in (two exports of one pack list them differently).
 */
class CostHeap {
  readonly #items: Array<[number, StuffKey]> = [];
  static #before(a: [number, StuffKey], b: [number, StuffKey]): boolean {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  push(cost: number, key: StuffKey): void {
    const a = this.#items;
    a.push([cost, key]);
    for (let i = a.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!CostHeap.#before(a[i] as [number, StuffKey], a[up] as [number, StuffKey])) break;
      [a[i], a[up]] = [a[up] as [number, StuffKey], a[i] as [number, StuffKey]];
      i = up;
    }
  }
  pop(): [number, StuffKey] | undefined {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && CostHeap.#before(a[l] as [number, StuffKey], a[m] as [number, StuffKey])) m = l;
        if (r < a.length && CostHeap.#before(a[r] as [number, StuffKey], a[m] as [number, StuffKey])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as [number, StuffKey], a[i] as [number, StuffKey]];
        i = m;
      }
    }
    return top;
  }
}
const LAVA: StuffKey = 'fluid:lava';
/** Dusts of rock the line gets for free: stone (cobblestone) and obsidian (lava). */
const FREE_ROCK_DUSTS: readonly string[] = ['dustStone', 'dustObsidian'];

function anyMapContains(r: Recipe, part: string): boolean {
  return r.maps.some((map) => map.includes(part));
}

/** Smelting maps: the vanilla furnace and GT's furnace-derived electric furnace and microwave. */
const SMELTING_MAPS: ReadonlySet<string> = new Set(['furnace', 'gt.recipe.furnace', 'gt.recipe.microwave']);
/** GT prefixes of the forms ore processing gives; smelting one of these is how metal is made, not recycling. */
const PROCESSING_PREFIXES: readonly string[] = ['dust', 'crushed', 'ore', 'rawOre', 'gem', 'cell'];

/**
 * A smelting recipe that melts a finished GT part back into its own material (a spring, rod, pipe or casing into
 * ingots or nuggets): GT's recycling, which its unificator adds to the furnace list without a recycling flag. A plan
 * would otherwise make Polyethylene Bars by crafting sheets into pipes and smelting those.
 */
function smeltsBack(r: Recipe, pack: Pack): boolean {
  if (!r.maps.some((map) => SMELTING_MAPS.has(map))) return false;
  const consumed = r.inputs.filter((ing) => ing.consumed);
  if (consumed.length !== 1 || r.outputs.length === 0) return false;
  const material = (key: StuffKey): { prefix: string; material: string } | undefined => pack.items.get(key)?.gt;
  return consumed[0]!.options.some((o) => {
    const input = material(o.key);
    if (input === undefined || PROCESSING_PREFIXES.some((prefix) => input.prefix.startsWith(prefix))) return false;
    return r.outputs.every((p) => material(p.key)?.material === input.material);
  });
}

/**
 * A crafting-table recipe that turns a Programmed Circuit back into a circuit: its only consumed inputs are programmed
 * circuits and it makes no programmed circuit (the screwdriver recipes that set another number do). Any LV circuit
 * crafts into a programmed circuit and that back into an Electronic Circuit, so the least raw material made Electronic
 * Circuits from whatever LV circuit is cheapest instead of GTNH's own circuit-assembler recipe.
 */
function programmedCircuitBack(r: Recipe, pack: Pack): boolean {
  if (!r.maps.includes('crafting')) return false;
  const programmed = (key: StuffKey): boolean => pack.items.get(key)?.id === PROGRAMMED_CIRCUIT_ID;
  const consumed = r.inputs.filter((ing) => ing.consumed);
  return consumed.length > 0 && consumed.every((ing) => ing.options.length > 0 && ing.options.every((o) => programmed(o.key)))
    && r.outputs.length > 0 && !r.outputs.some((p) => programmed(p.key));
}

/** Recipe categories the group leaves out unless it turns the rule off; the keys are `DEFAULT_EXCLUDED_CATEGORIES`. */
export const EXCLUSION_RULES: Record<string, (r: Recipe, pack: Pack) => boolean> = {
  recycling: (r, pack) => r.flags.recycling === true || (r.category?.includes('recycling') ?? false) || smeltsBack(r, pack),
  massfab: (r) => anyMapContains(r, 'massfab'),
  replicator: (r) => anyMapContains(r, 'replicator'),
  scrap: (r) => anyMapContains(r, 'recycler') || anyMapContains(r, 'scrapbox'),
  // Centrifuging or electrolysing lava, stone dust (free cobblestone) or obsidian dust (free lava through a fluid
  // solidifier): 12 obsidian dust electrolyse into magnesium, iron, silicon and oxygen, which made silicon free.
  'lava-centrifuge': (r, pack) => ((anyMapContains(r, 'centrifuge') || anyMapContains(r, 'electrolyzer') || anyMapContains(r, 'multielectro')) && r.inputs.some((ing) => ing.options.some(
    (o) => o.key === LAVA || (pack.items.get(o.key)?.oreDict.some((name) => FREE_ROCK_DUSTS.includes(name)) ?? false))))
    // The Large Thermal Refinery's lava filter: 1,000 L of free lava → a few % of a copper, tin, gold, silver or tantalum
    // ingot. With lava free it made every such metal cost 0 (24 refineries, 5.7M L lava/min for 2 Good Circuits/min).
    || (anyMapContains(r, 'thermalboiler') && r.outputs.some((p) => !isFluidKey(p.key))
      && r.inputs.some((ing) => ing.consumed && ing.options.some((o) => o.key === LAVA))),
  'programmed-circuit-conversion': programmedCircuitBack,
};

/** The machines that can run one recipe map, as the acceptance test needs them. */
interface MapMachines {
  /** The map's amperage (gt-mechanics §1.2(b)): a singleblock draws up to V[tier] × amps. */
  amps: number;
  /** Tiers of the singleblocks (`kind: 'basic'`), ascending, without repeats. */
  basicTiers: number[];
  /** The multiblocks without a heat check that run the map, by mteId. */
  plain: number[];
  /** The multiblocks whose recipes need coil heat (heat map, or `heatOC`) that run the map, by mteId. */
  heated: number[];
  /** A fuel map (`specialValue` 'fuel') or one a generator, boiler or turbine runs: its recipes burn, they make nothing. */
  fuel: boolean;
}

/** Machine kinds that turn a recipe's inputs into power, not into goods. */
const POWER_KINDS: ReadonlySet<string> = new Set(['generator', 'boiler', 'turbine']);

const MAP_MACHINES = new WeakMap<Pack, Map<string, MapMachines>>();

function machinesOfMap(pack: Pack, mapId: string): MapMachines {
  let perPack = MAP_MACHINES.get(pack);
  if (perPack === undefined) {
    perPack = new Map();
    MAP_MACHINES.set(pack, perPack);
  }
  let table = perPack.get(mapId);
  if (table === undefined) {
    const info = pack.maps.get(mapId);
    const heatMap = info?.specialValue === 'heat';
    const tiers = new Set<number>();
    table = { amps: info?.amps ?? 1, basicTiers: [], plain: [], heated: [], fuel: info?.specialValue === 'fuel' };
    for (const id of pack.machinesByMap.get(mapId) ?? []) {
      const machine = pack.machines.get(id);
      if (machine !== undefined && POWER_KINDS.has(machine.kind)) table.fuel = true;
      if (machine?.kind === 'basic') tiers.add(machine.tier ?? 0);
      else if (machine?.kind === 'multiblock') {
        if (heatMap || machine.heatOC === true) table.heated.push(id);
        else table.plain.push(id);
      }
    }
    table.basicTiers = [...tiers].sort((a, b) => a - b);
    perPack.set(mapId, table);
  }
  return table;
}

/**
 * Why one map cannot run the recipe at the group's tier: no machine, coil heat, a multiblock the group cannot build yet
 * (`unbuilt`), or the lowest tier that would run it.
 */
type MapVerdict = { ok: true } | { ok: false; hasMachine: boolean; heat: boolean; unbuilt: boolean; needTier: number /* Infinity: none */ };

/** Some of `ids` is built: any of them when the env does not gate multiblocks. */
function anyBuilt(ids: readonly number[], env: PlanEnv): boolean {
  const built = env.multiblocks;
  return built === undefined ? ids.length > 0 : ids.some((id) => built.has(id));
}

/** `true` when a singleblock runs the recipe at the group's tier, else the lowest tier that would (Infinity: none). */
function judgeSingleblocks(t: MapMachines, euPerTick: number, tier: number): true | number {
  const lowest = t.basicTiers[0];
  const voltage = V.findIndex((volts) => volts * t.amps >= euPerTick);
  if (lowest === undefined || voltage === -1) return Infinity;
  // A machine at a tier from `voltage` up to the group's tier runs it (machine tier ≤ group tier, EU/t ≤ V[machine] × amps).
  if (t.basicTiers.some((m) => m >= voltage && m <= tier)) return true;
  // Ruling R2: the machine type at the voltage's tier, even when the pack lists no machine of that tier ...
  const relaxed = Math.max(lowest, voltage);
  if (relaxed > tier) return relaxed;
  // ... unless that tier is not above the group's: then the first listed machine that is fast enough.
  return t.basicTiers.find((m) => m >= voltage) ?? Infinity;
}

function judgeMap(pack: Pack, r: Recipe, mapId: string, env: PlanEnv): MapVerdict {
  if (mapId === 'crafting' || mapId === 'furnace') return { ok: true };   // the vanilla furnace only gets here at ULV
  const t = machinesOfMap(pack, mapId);
  const hasMultiblock = t.plain.length > 0 || t.heated.length > 0;
  const single = judgeSingleblocks(t, r.euPerTick, env.tier);
  if (single === true) return { ok: true };
  let heat = false;
  let unbuilt = false;
  let needTier = single;
  if (hasMultiblock) {
    const volts = V[env.tier] as number;   // one energy hatch at the group's tier
    const hot = (r.meta.coilHeat ?? r.specialValue) <= ebfHeat(env.coilHeat, volts);
    if (r.euPerTick > volts) {
      const voltage = voltageTier(r.euPerTick);
      needTier = Math.min(needTier, voltage <= MAX_TIER ? voltage : Infinity);
    } else if (anyBuilt(t.plain, env) || (hot && anyBuilt(t.heated, env))) {
      return { ok: true };
    } else if (!hot && anyBuilt(t.heated, env)) {
      heat = true;
    } else {
      unbuilt = true;
    }
  }
  return { ok: false, hasMachine: t.basicTiers.length > 0 || hasMultiblock, heat, unbuilt, needTier };
}

/** Whether the group can run `r` at `env.tier` where it is, and on which map (the first that works, by map id). */
export function acceptRecipe(pack: Pack, r: Recipe, env: PlanEnv): Acceptance {
  if (r.flags.fake === true) return { ok: false, why: 'fake' };
  if (r.flags.opaque === true) return { ok: false, why: 'opaque' };
  for (const [name, rule] of Object.entries(EXCLUSION_RULES)) {
    if (env.excluded.has(name) && rule(r, pack)) return { ok: false, why: 'excluded' };
  }
  if (env.fromNothing?.has(r.id) === true) return { ok: false, why: 'excluded' };
  // A generator's fuel list (Large Neutralization Engine: acid → Empty Cell) is not a way to make its outputs.
  const maps = r.maps.filter((mapId) => mapId === 'crafting' || mapId === 'furnace' || !machinesOfMap(pack, mapId).fuel);
  if (maps.length === 0 && r.maps.length > 0) return { ok: false, why: 'fuel' };
  // From LV on, the electric furnace runs the derived copy of every smelting recipe.
  if (r.source === 'furnace' && env.tier >= 1) return { ok: false, why: 'vanilla-furnace' };
  if (r.meta.lowGravity === true && !env.lowGravity) return { ok: false, why: 'low-gravity' };

  let hasMachine = false;
  let heat = false;
  let unbuilt = false;
  let needTier = Infinity;
  for (const mapId of maps.sort()) {
    const verdict = judgeMap(pack, r, mapId, env);
    if (verdict.ok) return { ok: true, mapId };
    hasMachine ||= verdict.hasMachine;
    heat ||= verdict.heat;
    unbuilt ||= verdict.unbuilt;
    needTier = Math.min(needTier, verdict.needTier);
  }
  if (!hasMachine) return { ok: false, why: 'no-machine' };
  if (heat) return { ok: false, why: 'heat' };   // better coils fix it at this tier
  if (Number.isFinite(needTier)) return { ok: false, why: 'tier', needTier };
  return unbuilt ? { ok: false, why: 'multiblock' } : { ok: false, why: 'tier' };
}

/**
 * The multiblocks that would run `r` at `env` if the group could build them (any map of the recipe, by mteId, sorted),
 * whatever `env.multiblocks` says; empty when a singleblock, the crafting table or the furnace runs it, or nothing does.
 */
export function multiblocksFor(pack: Pack, r: Recipe, env: PlanEnv): number[] {
  const none: PlanEnv = { ...env, multiblocks: new Set() };
  if (acceptRecipe(pack, r, none).ok || !acceptRecipe(pack, r, { ...env, multiblocks: undefined }).ok) return [];
  const ids = new Set<number>();
  for (const mapId of r.maps) {
    const t = machinesOfMap(pack, mapId);
    for (const id of [...t.plain, ...t.heated]) if (acceptRecipe(pack, r, { ...env, multiblocks: new Set([id]) }).ok) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** The virtual good one ore-dictionary slot stands for. */
export function virtualKey(options: Ingredient['options']): StuffKey {
  return 'alt:' + options.map((o) => `${o.key}*${o.amount}`).sort().join('|');
}

/**
 * The options of a slot a line that avoids `avoid` may take (ruling R7), consumed or not (a lens, mold or catalyst the
 * machine holds): the ones not avoided; `options` itself when none is avoided, so its virtual key stays; none when all
 * are.
 */
export function keptOptions(options: Ingredient['options'], avoid: ReadonlySet<StuffKey> | undefined): Ingredient['options'] {
  if (avoid === undefined || !options.some((o) => avoid.has(o.key))) return options;
  return options.filter((o) => !avoid.has(o.key));
}

/**
 * What a line avoids, as what its machines hold reads it (`heldOption`): every good its avoid list covers (`listed`),
 * and those of them it still avoids (`avoid`: without the ones it had to allow back).
 */
export interface HeldAvoid { listed: ReadonlySet<StuffKey>; avoid: ReadonlySet<StuffKey> }

/**
 * The option a not-consumed slot holds (a lens, mold or catalyst; ruling R7): its first one, or for a line that avoids
 * `line` its first one on no avoid list, else its first one the line had to allow back, else its first. So a lens slot
 * that also takes a lens off the list holds that one, even where the line allows the avoided lens back for another
 * step.
 */
export function heldOption(options: Ingredient['options'], line?: HeldAvoid): Ingredient['options'][number] | undefined {
  if (line === undefined) return options[0];
  return keptOptions(options, line.listed)[0] ?? keptOptions(options, line.avoid)[0] ?? options[0];
}

/**
 * Whether `r` uses an avoided good: some slot, consumed or held in the machine (not consumed), has options and every
 * one of them is avoided. Such a recipe is no candidate of a line that avoids `avoid`.
 */
export function usesAvoided(r: Recipe, avoid: ReadonlySet<StuffKey> | undefined): boolean {
  return avoid !== undefined && r.inputs.some((ing) => ing.options.length > 0 && keptOptions(ing.options, avoid).length === 0);
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addTo(coeffs: Map<StuffKey, number>, key: StuffKey, amount: number): void {
  coeffs.set(key, (coeffs.get(key) ?? 0) + amount);
}

function sortedCoeffs(coeffs: ReadonlyMap<StuffKey, number>): Array<[StuffKey, number]> {
  return [...coeffs].filter(([, c]) => c !== 0).sort(([a], [b]) => byString(a, b));
}

const NOT_A_LEAF: LeafDecision = { buyable: false, cost: 0, leafClass: null };

/** The options of a slot the walk may take (`keptOptions`). */
type SlotOptions = (ing: Ingredient) => Ingredient['options'];

/** The estimated raw cost of one run of `r`: its consumed inputs, each slot at its cheapest option (amount × estimate). */
function recipeInputCost(r: Recipe, estimateOf: (key: StuffKey) => number, optionsOf: SlotOptions): number {
  let total = 0;
  for (const ing of r.inputs) {
    if (!ing.consumed) continue;
    let best = Infinity;
    for (const o of optionsOf(ing)) best = Math.min(best, o.amount * estimateOf(o.key));
    total += ing.chance * best;
  }
  return total;
}

/**
 * A rough raw cost per unit of every good `targets` can reach through `usable` recipes (each slot option the walk may
 * take, `optionsOf`, counts as reached): leaves at their cost; a recipe's consumed inputs, each ore-dictionary slot at
 * its cheapest option, charged in full to each output. Goods settle cheapest first and once each (a generalized
 * Dijkstra), so a gain loop in the data (x → 2 y, y → x) cannot drive its goods' estimates to 0. `settledAt` is the
 * order the goods settled in.
 */
function estimateCosts(
  pack: Pack, targets: readonly StuffKey[], decide: (key: StuffKey) => LeafDecision, usable: (r: Recipe) => boolean, optionsOf: SlotOptions,
): { estimate: Map<StuffKey, number>; settledAt: Map<StuffKey, number> } {
  const estimate = new Map<StuffKey, number>();
  const settledAt = new Map<StuffKey, number>();
  const consumersOf = new Map<StuffKey, Recipe[]>();
  const reached: Recipe[] = [];
  const leaves: Array<[StuffKey, number]> = [];
  const seen = new Set<StuffKey>(targets);
  const walk = [...targets];
  const taken = new Set<string>();
  for (let i = 0; i < walk.length; i++) {
    const key = walk[i] as StuffKey;
    const d = decide(key);
    if (d.buyable) {
      leaves.push([key, d.cost]);
      continue;
    }
    for (const index of pack.producers.get(key) ?? []) {
      const r = pack.recipes[index];
      if (r === undefined || taken.has(r.id) || !usable(r)) continue;
      taken.add(r.id);
      reached.push(r);
      for (const ing of r.inputs) {
        if (!ing.consumed) continue;
        for (const o of optionsOf(ing)) {
          const list = consumersOf.get(o.key);
          if (list === undefined) consumersOf.set(o.key, [r]);
          else if (list[list.length - 1] !== r) list.push(r);
          if (!seen.has(o.key)) {
            seen.add(o.key);
            walk.push(o.key);
          }
        }
      }
    }
  }

  const estimateOf = (key: StuffKey): number => estimate.get(key) ?? Infinity;
  const heap = new CostHeap();
  const tentative = new Map<StuffKey, number>();
  const offer = (key: StuffKey, cost: number): void => {
    if (estimate.has(key) || cost >= (tentative.get(key) ?? Infinity)) return;
    tentative.set(key, cost);
    heap.push(cost, key);
  };
  for (const [key, cost] of leaves) offer(key, cost);
  /** Consumed slots per recipe that no settled good fills yet. */
  const open = new Map<Recipe, number>(reached.map((r) => [r, r.inputs.filter((ing) => ing.consumed).length]));
  const filled = new Set<Ingredient>();
  const run = (r: Recipe): void => {
    const total = recipeInputCost(r, estimateOf, optionsOf);
    if (!Number.isFinite(total)) return;
    for (const p of r.outputs) {
      const made = p.amount * p.chance;
      if (made > 0 && !decide(p.key).buyable) offer(p.key, total / made);   // a leaf keeps its own cost
    }
  };
  for (const r of reached) if (open.get(r) === 0) run(r);
  for (let top = heap.pop(); top !== undefined; top = heap.pop()) {
    const [cost, key] = top;
    if (estimate.has(key)) continue;
    estimate.set(key, cost);
    settledAt.set(key, settledAt.size);
    for (const r of consumersOf.get(key) ?? []) {
      let left = open.get(r) as number;
      for (const ing of r.inputs) {
        if (!ing.consumed || filled.has(ing) || !optionsOf(ing).some((o) => o.key === key)) continue;
        filled.add(ing);
        left--;
      }
      open.set(r, left);
      if (left === 0) run(r);
    }
  }
  return { estimate, settledAt };
}

/** Optional parts of `buildCandidates`. */
export interface CandidateOptions {
  /** The recipe cap (default `MAX_RECIPES`). */
  maxRecipes?: number;
  /**
   * Goods the line avoids (§11.25, rulings R6–R8): never bought, and no candidate consumes one or holds one in a
   * not-consumed slot. A recipe with a slot of avoided options only is left out (`usesAvoided`; a pinned one too), and a
   * slot with others keeps only those (`keptOptions`). Absent or empty = none.
   */
  avoid?: ReadonlySet<StuffKey>;
}

/**
 * The recipes that can make `targets` from buyable leaves, breadth-first from the targets with each good expanded once:
 * a target is never bought; any other good is a leaf when `leaf` says it is buyable, else it is made by its cheapest
 * accepted producers (or only the recipe `settings.recipeChoice` pins for it, when that recipe still makes it and runs
 * here). "Cheapest" is an estimate of raw cost per unit over every accepted recipe the targets can reach: leaves at their
 * cost, a recipe's consumed inputs (each ore-dictionary slot at its cheapest option) charged in full to each output,
 * settled cheapest first. It ignores byproduct credit, so it only prunes; the LP over the kept recipes still credits
 * byproducts. A good nothing reachable makes keeps a few producers anyway, so `findBlockers` can name what is missing.
 * Goods of `opts.avoid` are never bought, consumed or held (`CandidateOptions.avoid`), in the estimate as in the graph.
 */
export function buildCandidates(
  pack: Pack, settings: PlanSettings, env: PlanEnv, leaf: LeafOracle, targets: StuffKey[], opts: CandidateOptions = {},
): CandidateGraph {
  const maxRecipes = opts.maxRecipes ?? MAX_RECIPES;
  const avoid = opts.avoid !== undefined && opts.avoid.size > 0 ? opts.avoid : undefined;
  const targetSet = new Set(targets);
  const decisions = new Map<StuffKey, LeafDecision>();
  const goods = new Map<StuffKey, GoodInfo>();
  const recipes = new Map<string, LpRecipe>();
  const blocked: CandidateGraph['blocked'] = new Map();
  const warnings: PlanWarning[] = [];
  const acceptance = new Map<string, Acceptance>();
  const queue: StuffKey[] = [];
  const queued = new Set<StuffKey>();
  let full = false;

  const decide = (key: StuffKey): LeafDecision => {
    // An avoided good is never bought; as no candidate consumes it either, it is only ever some recipe's byproduct.
    if (targetSet.has(key) || avoid?.has(key) === true) return NOT_A_LEAF;
    let d = decisions.get(key);
    if (d === undefined) {
      d = leaf(key);
      decisions.set(key, d);
    }
    return d;
  };
  const register = (key: StuffKey): GoodInfo => {
    let good = goods.get(key);
    if (good === undefined) {
      const { buyable, cost, leafClass, steps, free } = decide(key);
      good = { key, buyable, cost, leafClass, virtual: false };
      if (steps !== undefined) good.steps = steps;
      if (free !== undefined) good.free = free;
      goods.set(key, good);
    }
    return good;
  };
  /** A good some recipe consumes: walked unless it is a leaf. */
  const need = (key: StuffKey): void => {
    if (!register(key).buyable && !queued.has(key)) {
      queued.add(key);
      queue.push(key);
    }
  };
  const accept = (r: Recipe): Acceptance => {
    let a = acceptance.get(r.id);
    if (a === undefined) {
      a = acceptRecipe(pack, r, env);
      acceptance.set(r.id, a);
    }
    return a;
  };
  const room = (): boolean => {
    if (recipes.size >= maxRecipes) full = true;
    return !full;
  };
  const optionsOf: SlotOptions = (ing) => keptOptions(ing.options, avoid);
  const { estimate, settledAt } = estimateCosts(pack, targets, decide, (r) => accept(r).ok && !usesAvoided(r, avoid), optionsOf);
  const estimateOf = (key: StuffKey): number => estimate.get(key) ?? Infinity;
  const inputCost = (r: Recipe): number => recipeInputCost(r, estimateOf, optionsOf);
  /**
   * Whether `r` makes `key` from goods the estimate settled before `key`. A producer that is not (sand from sandstone
   * when sandstone is made from sand) can tie with the real one at the same estimate, and a graph of only such
   * producers is a closed loop the LP cannot enter, so grounded producers rank first.
   */
  const grounded = (r: Recipe, key: StuffKey): boolean => {
    const at = settledAt.get(key) ?? Infinity;
    return r.inputs.every((ing) => !ing.consumed || optionsOf(ing).some((o) => (settledAt.get(o.key) ?? Infinity) < at));
  };
  /** Estimated raw cost per unit of `key` made by `r`. */
  const unitCost = (r: Recipe, key: StuffKey): number => {
    let made = 0;
    for (const p of r.outputs) if (p.key === key) made += p.amount * p.chance;
    return made > 0 ? inputCost(r) / made : Infinity;
  };
  /**
   * The cheapest of `items` by `cost`, those `first` holds before the others, ties by `id`: at most `max`, within
   * `KEEP_WITHIN` of the best; when none has a finite cost, the first `fallback` by id.
   */
  const cheapest = <T>(
    items: readonly T[], cost: (t: T) => number, id: (t: T) => string, max: number, fallback: number, first: (t: T) => boolean = () => true,
  ): T[] => {
    const scored = items.map((t) => ({ t, c: cost(t), id: id(t), rank: first(t) ? 0 : 1 }));
    const finite = scored.filter((x) => Number.isFinite(x.c));
    if (finite.length === 0) return scored.sort((a, b) => byString(a.id, b.id)).slice(0, fallback).map((x) => x.t);
    const best = Math.min(...finite.map((x) => x.c));
    return finite.filter((x) => x.c <= best * KEEP_WITHIN + ESTIMATE_TOLERANCE)
      .sort((a, b) => a.rank - b.rank || a.c - b.c || byString(a.id, b.id)).slice(0, max).map((x) => x.t);
  };

  /** Ruling R6: a virtual good never asks the oracle and is never bought; its kept options are made or bought. */
  const addVirtual = (vkey: StuffKey, options: Ingredient['options']): void => {
    if (goods.has(vkey)) return;
    goods.set(vkey, { key: vkey, buyable: false, cost: 0, leafClass: null, virtual: true });
    const kept = cheapest(options, (o) => o.amount * estimateOf(o.key), (o) => o.key, KEEP_PRODUCERS, MAX_UNBUYABLE_OPTIONS)
      .sort((a, b) => byString(a.key, b.key));
    for (const option of kept) {
      const id = `convert:${vkey}:${option.key}`;
      if (recipes.has(id)) continue;
      if (!room()) return;
      const coeffs = new Map<StuffKey, number>([[option.key, -option.amount], [vkey, 1]]);
      recipes.set(id, { id, kind: 'convert', mapId: null, coeffs: sortedCoeffs(coeffs), euPerRun: 0, nonConsumed: [], needsCleanroom: false, main: vkey });
      need(option.key);
    }
  };

  const addRecipe = (r: Recipe, mapId: string): void => {
    if (recipes.has(r.id) || !room()) return;
    const coeffs = new Map<StuffKey, number>();
    const slots = new Map<StuffKey, Ingredient['options']>();
    const nonConsumed: StuffKey[] = [];
    for (const ing of r.inputs) {
      if (ing.options.length === 0) continue;
      // Never every option avoided: such a recipe is no candidate (`usesAvoided`).
      const options = optionsOf(ing);
      if (!ing.consumed) {
        // What the machine holds, for the walk: the first option it may take (a plan names `heldOption`'s pick).
        const held = options[0];
        if (held !== undefined) nonConsumed.push(held.key);
        continue;
      }
      const only = options.length === 1 ? options[0] : undefined;
      if (only !== undefined) {
        addTo(coeffs, only.key, -only.amount * ing.chance);
      } else {
        const vkey = virtualKey(options);
        slots.set(vkey, options);
        addTo(coeffs, vkey, -ing.chance);
      }
    }
    for (const p of r.outputs) addTo(coeffs, p.key, p.amount * p.chance);
    const lp: LpRecipe = {
      id: r.id, kind: 'recipe', mapId, coeffs: sortedCoeffs(coeffs), euPerRun: r.euPerTick * r.durationTicks,
      nonConsumed, needsCleanroom: r.meta.cleanroom === true,
    };
    const main = r.outputs[0]?.key;
    if (main !== undefined) lp.main = main;
    recipes.set(r.id, lp);
    for (const [key, c] of lp.coeffs) {
      const options = slots.get(key);
      if (options !== undefined) addVirtual(key, options);
      else if (c < 0) need(key);
      else register(key);   // an output: known to the LP, but nothing needs more of it
    }
  };

  /** The recipe pinned for `key`, when it still exists, makes `key` and runs here. */
  const pinnedFor = (key: StuffKey, pin: string): { r: Recipe; mapId: string } | null => {
    const r = pack.recipeById.get(pin);
    if (r === undefined || !r.outputs.some((p) => p.key === key)) return null;
    const a = accept(r);
    return a.ok ? { r, mapId: a.mapId } : null;
  };

  const expand = (key: StuffKey): void => {
    const pin = Object.hasOwn(settings.recipeChoice, key) ? settings.recipeChoice[key] : undefined;
    if (pin !== undefined) {
      const pinned = pinnedFor(key, pin);
      if (pinned !== null && !usesAvoided(pinned.r, avoid)) {
        addRecipe(pinned.r, pinned.mapId);
        return;
      }
      warnings.push({
        code: 'stale-choice', key,
        text: pinned === null
          ? `${pack.nameOf(key)}: the chosen recipe is gone or cannot run at ${tierName(env.tier)}; using the best one available`
          : `${pack.nameOf(key)}: the chosen recipe uses a material on the avoid list; using the best one that avoids it`,
      });
    }
    const rejected: Array<{ recipeId: string; why: Rejection; needTier?: number }> = [];
    const accepted: Array<{ r: Recipe; mapId: string }> = [];
    for (const i of pack.producers.get(key) ?? []) {
      const r = pack.recipes[i];
      // One that consumes or holds an avoided good is no producer here at all: the line re-allows the good when it needs it.
      if (r === undefined || usesAvoided(r, avoid)) continue;
      const a = accept(r);
      if (a.ok) accepted.push({ r, mapId: a.mapId });
      else rejected.push(a.needTier === undefined ? { recipeId: r.id, why: a.why } : { recipeId: r.id, why: a.why, needTier: a.needTier });
    }
    const kept = cheapest(accepted, (x) => unitCost(x.r, key), (x) => x.r.id, KEEP_PRODUCERS, KEEP_PRODUCERS, (x) => grounded(x.r, key));
    for (const { r, mapId } of kept) addRecipe(r, mapId);
    if (accepted.length === 0 && rejected.length > 0) blocked.set(key, rejected.sort((a, b) => byString(a.recipeId, b.recipeId)));
  };

  for (const target of targets) need(target);
  for (let i = 0; i < queue.length && !full; i++) expand(queue[i] as StuffKey);
  if (full) {
    warnings.push({ code: 'graph-too-big', text: 'This chain is too large to plan in one go; mark some parts as "we already make this"' });
  }

  const graph: CandidateGraph = {
    targets: [...targets], recipes: [...recipes.values()].sort((a, b) => byString(a.id, b.id)), goods, blocked, warnings, truncated: full,
  };
  if (avoid !== undefined) graph.avoid = avoid;
  return graph;
}
