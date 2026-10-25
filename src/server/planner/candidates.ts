// Candidate recipes (spec §3.3 and §5, gt-mechanics §1.2(b) and §6.4): which recipes the group can run at its tier, and
// the recipe graph the LP plans over, walked back from the targets to buyable leaves. Ore-dictionary slots become
// virtual `alt:` goods that free `convert` recipes fill from each kept option. A graph can avoid goods (§11.25): it
// never buys one, consumes one or holds one in a machine (a lens, mold or catalyst slot).

import { ebfHeat, voltageTier } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { type MachineId, compareMachineId } from '../../shared/ids.ts';
import type { Ingredient, Pack, Recipe } from '../../shared/types/pack.ts';
import type { LeafClass, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { machineOf, machineIdsForMap } from '../pack/lookup.ts';
import { benchRefusal, isBenchVariant, type BenchLine } from './benches.ts';

export interface PlanEnv {
  tier: number; reachable: ReadonlySet<string> /* DimensionInfo.key and Capability.key */; lowGravity: boolean; coilHeat: number; excluded: ReadonlySet<string>;
  /**
    * The ids of the multiblocks the group can build at this tier: their controller is available (availability.ts).
    * Absent = every multiblock counts as built. Multiblocks carry no tier in the export, so without this gate the
    * Eye of Harmony, the Godforge modules or the HTGR (EU/t 0 or 1) would run at any tier.
    */
   multiblocks?: ReadonlySet<MachineId>;
  /**
   * Ids of the recipes that make an ore material out of nothing but free inputs (availability.ts `fromNothing`), left out
   * like every other recipe of the `lava-centrifuge` category. Absent = none.
   */
  fromNothing?: ReadonlySet<string>;
}
/**
 * `fuel`: the recipe only burns its inputs in a generator (a fuel map, or one run by generators, boilers or turbines).
 * `machine` (plan 12, controller ruling OQ5 a): no machine that can run it can be built here and none is owned
 * (`CandidateOptions.unbuildable`); only `buildCandidates` gives it, never `acceptRecipe`. `bench` (plan 12, controller
 * ruling 214 (a)): a GGFab single-use variant of a tool recipe (`Recipe.meta.benchVariantOf`) where no Auto Workbench runs
 * it (crafting by hand, none at the tier, or a line whose bench cannot keep its stock: `benchRefusal`); it is no way of
 * its own there, as its original is the hand way.
 */
export type Rejection = 'fake' | 'opaque' | 'excluded' | 'vanilla-furnace' | 'low-gravity' | 'heat' | 'tier' | 'no-machine' | 'multiblock' | 'fuel' | 'machine' | 'bench';
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
  // optional addition
  /**
   * A supply recipe (`Recipe.meta.supply`, fix spec R2: a rock breaker, a pump, the compressor filling air cells): a
   * source of free input, which the loop guard never takes for a loop (solve.ts `sourceColumns`).
   */
  supply?: true;
  // optional addition (plan 12, controller ruling 214; user ruling 180 (d))
  /**
   * A crafting-table recipe no Auto Workbench of the line runs although its crafting is automated
   * (`CandidateOptions.bench`): why, in plain words (`benchRefusal`: "needs a Mortar, which an Auto Workbench cannot keep
   * using"). It is crafted by hand: the step charge weighs it as a step by hand (`SolveOptions.byHandWeight`) and its step
   * says why.
   */
  byHand?: string;
}
export interface LeafDecision {
  buyable: boolean; cost: number; leafClass: LeafClass | null /* null = not a leaf, must be made */;
  // optional additions: a bought derived leaf's chain (`Standalone`, solve.ts), which the solver's tie-breaks read
  /** The recipes the chain that makes it runs. */
  steps?: number;
  /** The free input (water, air, cobblestone, lava) that chain takes per unit. */
  free?: number;
  // optional addition (plan 12, change request 13)
  /**
   * A buyable leaf the line may also make (a gathered world block, `makeLeafOracle`'s `gatheredRecipes`): the walk keeps
   * its purchase and also adds its producers, so the LP weighs digging it against making it.
   */
  alsoMade?: true;
}
export type LeafOracle = (key: StuffKey) => LeafDecision;
export interface GoodInfo {
  key: StuffKey; buyable: boolean; cost: number; leafClass: LeafClass | null; virtual: boolean;
  // optional additions
  /** `LeafDecision.steps` and `free` of a bought derived leaf. */
  steps?: number;
  free?: number;
  // optional addition (plan 12, change request 13)
  /** `LeafDecision.alsoMade`: a leaf the graph also makes (its producers are in `recipes`). */
  alsoMade?: true;
}
export interface CandidateGraph {
  targets: StuffKey[]; recipes: LpRecipe[] /* sorted by id */; goods: Map<StuffKey, GoodInfo>;
  blocked: Map<StuffKey, Array<{
    recipeId: string; why: Rejection; needTier?: number;
    // optional addition (plan 12): with `why` 'machine', why its machine cannot be built here (`CandidateOptions.unbuildable`)
    machine?: string;
  }>>;
  warnings: PlanWarning[];
  // optional additions
  /** The walk stopped at its recipe cap: goods it never expanded look unmakeable, so blockers would name the wrong goods. */
  truncated?: boolean;
  /**
   * The goods the graph avoids (`CandidateOptions.avoid`), when there are any: its slots lack them, consumed ones (its
   * ore-dictionary slots) and the not-consumed ones its recipes hold (`LpRecipe.nonConsumed`) alike.
   */
  avoid?: ReadonlySet<StuffKey>;
  /**
   * The ingredient options the graph pins (`PlanSettings.optionChoice`, fix spec R9), when there are any:
   * `<recipe id>#<slot>` → the option that slot takes, the only one the graph has for it.
   */
  optionPins?: ReadonlyMap<string, StuffKey>;
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
 * Fix spec R4: a good's producers also keep the one with the fewest recipe steps down to leaves (`stepsTo`), and drop
 * one whose chain is more than this many steps longer than that one's, unless it is the cheapest by estimate. Ranking by
 * the raw estimate alone dropped short routes (sand → molten glass → tube) and kept 10-recipe detours.
 */
export const MAX_EXTRA_PRODUCER_STEPS = 6;

/**
 * Fix spec R10: 0 for the canonical member of a group of interchangeable goods (an item without NBT of Minecraft at meta
 * 0, or of GregTech or IC2 at any meta, or a fluid), else 1. Equal estimates go to the canonical one (`cheapest`), and
 * the solver's tie-breaks weigh it (solve.ts): Oak Wood over "Sacred Oak Log" or "Bloodwood", Sand over Red Sand.
 */
export function canonicalRank(key: StuffKey): 0 | 1 {
  if (isFluidKey(key)) return 0;
  if (key.includes('#')) return 1;
  const at = key.lastIndexOf('@');
  const id = at < 0 ? key : key.slice(0, at);
  const colon = id.indexOf(':');
  const mod = colon < 0 ? '' : id.slice(0, colon);
  if (mod === 'gregtech' || mod === 'IC2') return 0;
  return mod === 'minecraft' && key.slice(at + 1) === '0' ? 0 : 1;
}

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
  /** The multiblocks without a heat check that run the map, by id. */
  plain: MachineId[];
  /** The multiblocks whose recipes need coil heat (heat map, or `heatOC`) that run the map, by id. */
  heated: MachineId[];
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
    for (const id of machineIdsForMap(pack, mapId)) {
      const machine = machineOf(pack, id);
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
function anyBuilt(ids: readonly MachineId[], env: PlanEnv): boolean {
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

/**
 * Whether the group can run `r` at `env.tier` where it is, and on which map (the first that works, by map id). A GGFab
 * single-use variant of a tool recipe runs only on an Auto Workbench of `bench` (the line's, `benchLine`) that can keep
 * its stock (`benchRefusal`), else it is rejected as `bench` (plan 12, controller ruling 214 (a)).
 */
export function acceptRecipe(pack: Pack, r: Recipe, env: PlanEnv, bench?: BenchLine): Acceptance {
  if (r.flags.fake === true) return { ok: false, why: 'fake' };
  if (r.flags.opaque === true) return { ok: false, why: 'opaque' };
  if (isBenchVariant(r) && (bench === undefined || benchRefusal(pack, r, bench) !== undefined)) return { ok: false, why: 'bench' };
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
 * The multiblocks that would run `r` at `env` if the group could build them (any map of the recipe, by id, sorted),
 * whatever `env.multiblocks` says; empty when a singleblock, the crafting table or the furnace runs it, or nothing does.
 */
export function multiblocksFor(pack: Pack, r: Recipe, env: PlanEnv): MachineId[] {
  const none: PlanEnv = { ...env, multiblocks: new Set() };
  if (acceptRecipe(pack, r, none).ok || !acceptRecipe(pack, r, { ...env, multiblocks: undefined }).ok) return [];
  const ids = new Set<MachineId>();
  for (const mapId of r.maps) {
    const t = machinesOfMap(pack, mapId);
    for (const id of [...t.plain, ...t.heated]) if (acceptRecipe(pack, r, { ...env, multiblocks: new Set([id]) }).ok) ids.add(id);
  }
  return [...ids].sort(compareMachineId);
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

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** The options of a slot the walk may take (`keptOptions`). */
type SlotOptions = (ing: Ingredient) => Ingredient['options'];
/** The consumed slots of a recipe it hands on (`carriedSlots`). */
type CarriedSlots = (r: Recipe) => ReadonlySet<Ingredient>;

const EMPTY_OF_FILLED = new WeakMap<Pack, ReadonlyMap<StuffKey, StuffKey>>();

/** Each filled container of the pack (`fluidContainers`) that has an empty one → that empty container; once per pack. */
function emptyOfFilled(pack: Pack): ReadonlyMap<StuffKey, StuffKey> {
  let byFilled = EMPTY_OF_FILLED.get(pack);
  if (byFilled === undefined) {
    const map = new Map<StuffKey, StuffKey>();
    for (const c of pack.fluidContainers ?? []) if (c.empty !== null && !map.has(c.container)) map.set(c.container, c.empty);
    byFilled = map;
    EMPTY_OF_FILLED.set(pack, byFilled);
  }
  return byFilled;
}

/**
 * The consumed slots `r` hands on (fix spec R4): slots whose every option is an empty container the recipe gives back
 * filled (it makes a filled container whose `fluidContainers` entry has that empty one) and the line can empty again
 * (`canEmpty` of the filled one: D14's emptier runs here), as a water electrolyzer takes Empty Cells and makes Hydrogen
 * Cells of them, which a canner empties. The estimate neither charges them nor waits for them: an Empty Cell priced at
 * its tin made Oxygen from free water dearer than from dust, and the EBF steel recipe was pruned for it. A filled
 * container nothing here empties leaves the line with its container, so its slot is charged like any other: at 0 it
 * pruned every priced producer that was not the simplest (KEEP_WITHIN × 0), and the line made new cells from tin.
 */
function carriedSlots(pack: Pack, r: Recipe, optionsOf: SlotOptions, canEmpty: (filled: StuffKey) => boolean): Set<Ingredient> {
  const filled = emptyOfFilled(pack);
  const handedOn = new Set<StuffKey>();
  for (const p of r.outputs) {
    const empty = p.amount * p.chance > 0 ? filled.get(p.key) : undefined;
    if (empty !== undefined && canEmpty(p.key)) handedOn.add(empty);
  }
  const carried = new Set<Ingredient>();
  if (handedOn.size === 0) return carried;
  for (const ing of r.inputs) {
    const options = ing.consumed ? optionsOf(ing) : [];
    if (options.length > 0 && options.every((o) => handedOn.has(o.key))) carried.add(ing);
  }
  return carried;
}

/**
 * The estimated raw cost of one run of `r`: its consumed inputs it does not hand on (`carried`), each slot at its
 * cheapest option (amount × estimate).
 */
function recipeInputCost(r: Recipe, estimateOf: (key: StuffKey) => number, optionsOf: SlotOptions, carried: ReadonlySet<Ingredient>): number {
  let total = 0;
  for (const ing of r.inputs) {
    if (!ing.consumed || carried.has(ing)) continue;
    let best = Infinity;
    for (const o of optionsOf(ing)) best = Math.min(best, o.amount * estimateOf(o.key));
    total += ing.chance * best;
  }
  return total;
}

type Option = Ingredient['options'][number];

/**
 * The option of a slot the estimate charges (`recipeInputCost`): the least amount × estimate, equal ones by canonical
 * rank (fix spec R10), then key; none when no option has a finite estimate.
 */
function cheapestOption(options: readonly Option[], estimateOf: (key: StuffKey) => number): Option | undefined {
  let best: Option | undefined;
  let bestCost = Infinity;
  for (const o of options) {
    const cost = o.amount * estimateOf(o.key);
    if (!Number.isFinite(cost)) continue;
    const before = best === undefined || cost < bestCost
      || (cost === bestCost && (canonicalRank(o.key) - canonicalRank(best.key) || byString(o.key, best.key)) < 0);
    if (before) {
      best = o;
      bestCost = cost;
    }
  }
  return best;
}

/** What `estimateCosts` finds. */
interface Estimates {
  estimate: Map<StuffKey, number>;
  /** The order the goods settled in. */
  settledAt: Map<StuffKey, number>;
  /** Fix spec R4: the recipe steps of the simplest chain from leaves to each good (`settleSteps`). */
  steps: Map<StuffKey, number>;
  /**
   * The goods one run of a recipe takes, as the steps count them: the option the estimate charges (`cheapestOption`) of
   * each consumed slot it does not hand on, each good once; null when some such slot has no priced option.
   */
  inputsOf: (r: Recipe) => readonly StuffKey[] | null;
  /** The walk met a leaf the line may also make (`LeafDecision.alsoMade`). */
  metAlsoMade: boolean;
}

/** What `buildCandidates` ranks a good's producers and a slot's options by, from one estimate pass (`estimateCosts`). */
interface EstimatePass {
  estimateOf(key: StuffKey): number;
  /**
   * Whether `r` makes `key` from goods the estimate settled before `key` (the slots it hands on aside). A producer that is
   * not (sand from sandstone when sandstone is made from sand) can tie with the real one at the same estimate, and a
   * graph of only such producers is a closed loop the LP cannot enter, so grounded producers rank first.
   */
  grounded(r: Recipe, key: StuffKey): boolean;
  /** Estimated raw cost per unit of `key` made by `r`. */
  unitCost(r: Recipe, key: StuffKey): number;
  /** Fix spec R4: the recipe steps of the simplest chain through `r` (1 + the steps of what it takes), else Infinity. */
  stepsOf(r: Recipe): number;
  /** Fix spec R10: the canonical rank of what `r` takes (one option per slot, as `stepsOf` counts them), added up. */
  inputRank(r: Recipe): number;
}

/**
 * A rough raw cost per unit of every good `targets` can reach through `usable` recipes (each slot option the walk may
 * take, `optionsOf`, counts as reached): leaves at their cost; a recipe's consumed inputs, each ore-dictionary slot at
 * its cheapest option, charged in full to each output, except the slots it hands on (`carried`: never charged, never
 * waited for). Goods settle cheapest first and once each (a generalized Dijkstra), so a gain loop in the data (x → 2 y,
 * y → x) cannot drive its goods' estimates to 0. A second pass over the same recipes counts the steps to each good.
 * A leaf the line may also make (`alsoMade`, plan 12) is a plain leaf at its cost, unless `walkMade`: then it is seeded
 * at its cost but its producers are walked too and offer what making it costs, so its estimate is the cheaper of
 * digging and making it (any other leaf keeps its own cost).
 */
function estimateCosts(
  pack: Pack, targets: readonly StuffKey[], decide: (key: StuffKey) => LeafDecision, usable: (r: Recipe) => boolean, optionsOf: SlotOptions,
  carried: CarriedSlots, walkMade: boolean,
): Estimates {
  const estimate = new Map<StuffKey, number>();
  const settledAt = new Map<StuffKey, number>();
  const consumersOf = new Map<StuffKey, Recipe[]>();
  const reached: Recipe[] = [];
  const leaves: Array<[StuffKey, number]> = [];
  const seen = new Set<StuffKey>(targets);
  const walk = [...targets];
  const taken = new Set<string>();
  let metAlsoMade = false;
  /** Whether a run of a recipe offers its cost to `key`: any good not bought, and with `walkMade` one also made. */
  const offersTo = (key: StuffKey): boolean => {
    const d = decide(key);
    return !d.buyable || (walkMade && d.alsoMade === true);
  };
  for (let i = 0; i < walk.length; i++) {
    const key = walk[i] as StuffKey;
    const d = decide(key);
    if (d.buyable) {
      leaves.push([key, d.cost]);
      if (d.alsoMade === true) metAlsoMade = true;
      if (!walkMade || d.alsoMade !== true) continue;
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
  /** Consumed slots per recipe, other than those it hands on, that no settled good fills yet. */
  const open = new Map<Recipe, number>(reached.map((r) => [r, r.inputs.filter((ing) => ing.consumed && !carried(r).has(ing)).length]));
  const filled = new Set<Ingredient>();
  const run = (r: Recipe): void => {
    const total = recipeInputCost(r, estimateOf, optionsOf, carried(r));
    if (!Number.isFinite(total)) return;
    for (const p of r.outputs) {
      const made = p.amount * p.chance;
      if (made > 0 && offersTo(p.key)) offer(p.key, total / made);   // a plain leaf keeps its own cost
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
        if (!ing.consumed || filled.has(ing) || carried(r).has(ing) || !optionsOf(ing).some((o) => o.key === key)) continue;
        filled.add(ing);
        left--;
      }
      open.set(r, left);
      if (left === 0) run(r);
    }
  }

  const inputs = new Map<Recipe, readonly StuffKey[] | null>();
  const inputsOf = (r: Recipe): readonly StuffKey[] | null => {
    const known = inputs.get(r);
    if (known !== undefined) return known;
    const chosen = new Set<StuffKey>();
    let priced = true;
    for (const ing of r.inputs) {
      if (!ing.consumed || carried(r).has(ing)) continue;
      const option = cheapestOption(optionsOf(ing), estimateOf);
      if (option === undefined) {
        priced = false;
        break;
      }
      chosen.add(option.key);
    }
    const keys = priced ? [...chosen] : null;
    inputs.set(r, keys);
    return keys;
  };
  const steps = settleSteps(reached, leaves.map(([key]) => key), (key) => decide(key).buyable, inputsOf);
  return { estimate, settledAt, steps, inputsOf, metAlsoMade };
}

/**
 * Fix spec R4: the recipe steps of the simplest chain from leaves to each good `reached` can make. A leaf takes 0; a
 * recipe 1 + the steps of each good it takes (`inputsOf`: one option per slot, each good once); a good the fewest of the
 * recipes that make it. Goods settle fewest steps first, equal counts by key, as the costs do (`estimateCosts`).
 */
function settleSteps(
  reached: readonly Recipe[], leaves: readonly StuffKey[], isLeaf: (key: StuffKey) => boolean, inputsOf: (r: Recipe) => readonly StuffKey[] | null,
): Map<StuffKey, number> {
  const steps = new Map<StuffKey, number>();
  const heap = new CostHeap();
  const tentative = new Map<StuffKey, number>();
  const offer = (key: StuffKey, n: number): void => {
    if (steps.has(key) || n >= (tentative.get(key) ?? Infinity)) return;
    tentative.set(key, n);
    heap.push(n, key);
  };
  for (const key of leaves) offer(key, 0);
  const waiting = new Map<Recipe, number>();
  const waitersOf = new Map<StuffKey, Recipe[]>();
  const run = (r: Recipe): void => {
    let n = 1;
    for (const key of inputsOf(r) ?? []) n += steps.get(key) as number;
    for (const p of r.outputs) if (p.amount * p.chance > 0 && !isLeaf(p.key)) offer(p.key, n);
  };
  const ready: Recipe[] = [];
  for (const r of reached) {
    const keys = inputsOf(r);
    if (keys === null) continue;   // a slot without a priced option: the recipe never runs
    waiting.set(r, keys.length);
    for (const key of keys) pushTo(waitersOf, key, r);
    if (keys.length === 0) ready.push(r);
  }
  for (const r of ready) run(r);
  for (let top = heap.pop(); top !== undefined; top = heap.pop()) {
    const [n, key] = top;
    if (steps.has(key)) continue;
    steps.set(key, n);
    for (const r of waitersOf.get(key) ?? []) {
      const left = (waiting.get(r) as number) - 1;
      waiting.set(r, left);
      if (left === 0) run(r);
    }
  }
  return steps;
}

/** The digits of `Ingredient.slot` in a key of `PlanSettings.optionChoice` (`<recipe id>#<slot>`). */
const PIN_SLOT = /^\d{1,4}$/;

/** The option pins of a graph (`optionPinsOf`). */
interface OptionPinning {
  /** Each consumed slot a pin holds, by its ingredient: the one option the graph takes for it. */
  slots: ReadonlyMap<Ingredient, Option>;
  /** The pins honoured, by `<recipe id>#<slot>` (`CandidateGraph.optionPins`). */
  pins: ReadonlyMap<string, StuffKey>;
  warnings: PlanWarning[];
}

/**
 * The pins of `settings.optionChoice` a graph honours (fix spec R9, ruling P28), in key order: each names a consumed slot
 * of a recipe (`<recipe id>#<Ingredient.slot>`) and an option it holds, so that slot takes that option and no other. A
 * pin is ignored, with one `stale-option` warning (`key` = the pin's key), when its recipe is gone, the recipe has no
 * consumed slot of that number, the slot no such option (a re-export changed it), or the option is on the avoid list
 * (`onAvoidList`: the avoid list wins over a pin, as over a pinned recipe). A pin of a recipe the line never runs costs
 * nothing.
 */
function optionPinsOf(pack: Pack, settings: PlanSettings, onAvoidList: (key: StuffKey) => boolean): OptionPinning {
  const slots = new Map<Ingredient, Option>();
  const pins = new Map<string, StuffKey>();
  const warnings: PlanWarning[] = [];
  const choice = settings.optionChoice ?? {};
  for (const pin of Object.keys(choice).sort(byString)) {
    const key = choice[pin] as StuffKey;
    const at = pin.lastIndexOf('#');
    const r = at < 0 ? undefined : pack.recipeById.get(pin.slice(0, at));
    const digits = pin.slice(at + 1);
    const slot = PIN_SLOT.test(digits) ? Number(digits) : Number.NaN;
    const stale = (text: string): void => {
      warnings.push({ code: 'stale-option', key: pin, text });
    };
    if (r === undefined) {
      stale(`${pack.nameOf(key)} was pinned for an ingredient of a recipe this pack no longer has; nothing is pinned there`);
      continue;
    }
    const product = pack.nameOf(r.outputs[0]?.key ?? r.id);
    const held = r.inputs.flatMap((ing): Array<[Ingredient, Option]> => {
      const option = ing.consumed && ing.slot === slot ? ing.options.find((o) => o.key === key) : undefined;
      return option === undefined ? [] : [[ing, option]];
    });
    if (held.length === 0) {
      stale(`${product}: ${pack.nameOf(key)} is no longer an option of the pinned ingredient; the planner chooses one`);
    } else if (onAvoidList(key)) {
      stale(`${product}: the pinned ingredient ${pack.nameOf(key)} is on the avoid list; ignoring the pin`);
    } else {
      for (const [ing, option] of held) slots.set(ing, option);
      pins.set(pin, key);
    }
  }
  return { slots, pins, warnings };
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
  /**
   * The goods of the project's avoid list, for its option pins (ruling P28: the avoid list wins over a pin): a pin of
   * one of them is ignored, with the avoid list's `stale-option`, also where the graph does not avoid it. `linePricing`'s
   * graph walks without the avoid list (ruling R6) and an `avoidingLine` trial may allow some of it back (ruling R10);
   * neither plans a pinned option the list covers. Absent or empty = only `avoid`.
   */
  pinAvoid?: ReadonlySet<StuffKey>;
  // optional addition (plan 12, controller ruling OQ5 a)
  /**
   * Step recipes no machine can run here (`BuildModel.blocked`: recipe id → `<machine> cannot be built here (<why>)`):
   * rejected as `machine` before any pruning, in the estimate as in the walk, so a producer that can run takes their
   * place; a good left with none names that reason in its `blocked` entry (`machine`). Absent = none.
   */
  unbuildable?: ReadonlyMap<string, string>;
  // optional addition (plan 12, controller ruling 214)
  /**
   * The line's Auto Workbenches (`benchLine`: crafting automated, one at the tier), for the line's own walks only: the
   * GGFab single-use variants of tool recipes they run are candidates (`acceptRecipe`), a variant and its original count
   * as one producer where the walk keeps the cheapest, and a crafting-table recipe none of them runs is marked
   * `LpRecipe.byHand` with why. Absent: no variant is a candidate and nothing is marked (the cost model, prices, breakdowns).
   */
  bench?: BenchLine;
}

/**
 * The recipes that can make `targets` from buyable leaves, breadth-first from the targets with each good expanded once:
 * a target is never bought; any other good is a leaf when `leaf` says it is buyable, else it is made by its cheapest
 * accepted producers (or only the recipe `settings.recipeChoice` pins for it, when that recipe still makes it and runs
 * here). "Cheapest" is an estimate of raw cost per unit over every accepted recipe the targets can reach: leaves at their
 * cost, a recipe's consumed inputs (each ore-dictionary slot at its cheapest option) charged in full to each output,
 * settled cheapest first. It ignores byproduct credit, so it only prunes; the LP over the kept recipes still credits
 * byproducts. A good nothing reachable makes keeps a few producers anyway, so `findBlockers` can name what is missing.
 * Fix spec R4 and R10: the empty containers a recipe hands on filled, where the line can empty them again (D14's
 * emptier), cost it nothing; each good also keeps its producer
 * of fewest steps and drops one far longer than that (`MAX_EXTRA_PRODUCER_STEPS`) unless it is the cheapest; equal
 * estimates go to canonical goods (`canonicalRank`). D14: a filled container a kept recipe makes brings the recipe that
 * empties it. Goods of `opts.avoid` are never bought, consumed or held (`CandidateOptions.avoid`), in the estimate as in
 * the graph. Fix spec R9: an ore-dictionary slot `settings.optionChoice` pins takes only its pinned option, in the
 * estimate as in the graph, so the walk plans that option's chain however dear it is (`optionPinsOf`; the pins it
 * ignores warn `stale-option`, among them every pin of an option of `opts.avoid` or `opts.pinAvoid`).
 * Plan 12: the recipes of `opts.unbuildable` are rejected as `machine` (`CandidateOptions.unbuildable`). A leaf the line
 * may also make (`LeafDecision.alsoMade`: a gathered world block) is bought and walked: the graph keeps its purchase
 * and adds its producers. Such a leaf makes the pruning run on two estimates — one with it a plain leaf at its price
 * (as without it), one at the cheaper of digging and making it — and keep every producer and option either keeps
 * (`cheapest`, R4's `simplestAndNotFar` and an ore-dictionary slot's options each take the union of the two passes'
 * picks, in id order): made sand from free cobblestone estimates 0, and `KEEP_WITHIN` × 0 alone would cut every route
 * dug sand makes worth keeping. Without such a leaf, one estimate as before. Plan 12, controller ruling 214: with the
 * line's Auto Workbenches (`opts.bench`), the GGFab single-use variants of tool recipes they run are candidates, each
 * kept with its original as one producer, and a crafting-table recipe none of them runs is marked `LpRecipe.byHand`.
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
  const pinAvoid = opts.pinAvoid;
  const pinning = optionPinsOf(pack, settings, (key) => avoid?.has(key) === true || pinAvoid?.has(key) === true);
  const warnings: PlanWarning[] = [...pinning.warnings];
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
      const { buyable, cost, leafClass, steps, free, alsoMade } = decide(key);
      good = { key, buyable, cost, leafClass, virtual: false };
      if (steps !== undefined) good.steps = steps;
      if (free !== undefined) good.free = free;
      if (alsoMade === true) good.alsoMade = true;
      goods.set(key, good);
    }
    return good;
  };
  /** A good some recipe consumes: walked unless it is a leaf the line only buys. */
  const need = (key: StuffKey): void => {
    const good = register(key);
    if ((!good.buyable || good.alsoMade === true) && !queued.has(key)) {
      queued.add(key);
      queue.push(key);
    }
  };
  const unbuildable = opts.unbuildable;
  const accept = (r: Recipe): Acceptance => {
    let a = acceptance.get(r.id);
    if (a === undefined) {
      a = unbuildable?.has(r.id) === true ? { ok: false, why: 'machine' } : acceptRecipe(pack, r, env, opts.bench);
      acceptance.set(r.id, a);
    }
    return a;
  };
  const room = (): boolean => {
    if (recipes.size >= maxRecipes) full = true;
    return !full;
  };
  const optionsOf: SlotOptions = (ing) => {
    const pinned = pinning.slots.get(ing);
    return pinned === undefined ? keptOptions(ing.options, avoid) : [pinned];
  };
  /** An accepted recipe and the map it runs on here. */
  type Producer = { r: Recipe; mapId: string };
  const emptiers = new Map<StuffKey, Producer | null>();
  /**
   * Fix spec D14 (audit patch E-containers): the pack's recipe that empties the filled container `key` back into its
   * empty one, when the line may run it: its only consumed slot takes `key` alone, it makes the empty container, and it
   * runs here without an avoided good. The one of smallest id when several do (whatever order the export lists them
   * in); none for a good that is no filled container with an empty one. A recipe hands its empty containers on only
   * through filled ones this finds (`carriedSlots`), and the walk adds it beside each recipe that makes one (`addRecipe`).
   */
  const emptierOf = (key: StuffKey): Producer | null => {
    const known = emptiers.get(key);
    if (known !== undefined) return known;
    let found: Producer | null = null;
    const empty = emptyOfFilled(pack).get(key);
    if (empty !== undefined) {
      for (const i of pack.consumers.get(key) ?? []) {
        const r = pack.recipes[i];
        const consumed = r?.inputs.filter((ing) => ing.consumed) ?? [];
        if (r === undefined || (found !== null && found.r.id < r.id)) continue;
        if (consumed.length !== 1 || !(consumed[0] as Ingredient).options.every((o) => o.key === key)) continue;
        if (!r.outputs.some((p) => p.key === empty) || usesAvoided(r, avoid)) continue;
        const a = accept(r);
        if (a.ok) found = { r, mapId: a.mapId };
      }
    }
    emptiers.set(key, found);
    return found;
  };
  const carriedByRecipe = new Map<Recipe, ReadonlySet<Ingredient>>();
  const carried: CarriedSlots = (r) => {
    let slots = carriedByRecipe.get(r);
    if (slots === undefined) {
      slots = carriedSlots(pack, r, optionsOf, (filled) => emptierOf(filled) !== null);
      carriedByRecipe.set(r, slots);
    }
    return slots;
  };
  const usable = (r: Recipe): boolean => accept(r).ok && !usesAvoided(r, avoid);
  /** What one estimate pass ranks producers and options by. */
  const passOf = ({ estimate, settledAt, steps, inputsOf }: Estimates): EstimatePass => {
    const estimateOf = (key: StuffKey): number => estimate.get(key) ?? Infinity;
    const inputCost = (r: Recipe): number => recipeInputCost(r, estimateOf, optionsOf, carried(r));
    return {
      estimateOf,
      grounded(r, key) {
        const at = settledAt.get(key) ?? Infinity;
        return r.inputs.every((ing) => !ing.consumed || carried(r).has(ing) || optionsOf(ing).some((o) => (settledAt.get(o.key) ?? Infinity) < at));
      },
      unitCost(r, key) {
        let made = 0;
        for (const p of r.outputs) if (p.key === key) made += p.amount * p.chance;
        return made > 0 ? inputCost(r) / made : Infinity;
      },
      stepsOf(r) {
        const keys = inputsOf(r);
        if (keys === null) return Infinity;
        let n = 1;
        for (const key of keys) n += steps.get(key) ?? Infinity;
        return n;
      },
      inputRank(r) {
        let rank = 0;
        for (const key of inputsOf(r) ?? []) rank += canonicalRank(key);
        return rank;
      },
    };
  };
  // Plan 09's estimate, with a leaf the line may also make at its price; and when the walk meets such a leaf, the
  // estimate at the cheaper of digging and making it as well.
  const dug = estimateCosts(pack, targets, decide, usable, optionsOf, carried, false);
  const passes: EstimatePass[] = [passOf(dug)];
  if (dug.metAlsoMade) passes.push(passOf(estimateCosts(pack, targets, decide, usable, optionsOf, carried, true)));
  /**
   * The cheapest of `items` by `cost`, those `first` holds before the others, equal costs by canonical rank (`canon`, fix
   * spec R10), then by `id`: at most `max`, within `KEEP_WITHIN` of the best; when none has a finite cost, the first
   * `fallback` by canonical rank, then id.
   */
  const cheapest = <T>(
    items: readonly T[], cost: (t: T) => number, id: (t: T) => string, max: number, fallback: number,
    first: (t: T) => boolean = () => true, canon: (t: T) => number = () => 0,
  ): T[] => {
    const scored = items.map((t) => ({ t, c: cost(t), id: id(t), rank: first(t) ? 0 : 1, canon: canon(t) }));
    const finite = scored.filter((x) => Number.isFinite(x.c));
    if (finite.length === 0) return scored.sort((a, b) => a.canon - b.canon || byString(a.id, b.id)).slice(0, fallback).map((x) => x.t);
    const best = Math.min(...finite.map((x) => x.c));
    return finite.filter((x) => x.c <= best * KEEP_WITHIN + ESTIMATE_TOLERANCE)
      .sort((a, b) => a.rank - b.rank || a.c - b.c || a.canon - b.canon || byString(a.id, b.id)).slice(0, max).map((x) => x.t);
  };
  /**
   * Fix spec R4: `kept` (the cheapest producers of `key`) with the accepted producer of fewest steps (`stepsOf`; equal
   * ones by estimate, the canonical rank of what they take, then id) added, less every producer more than
   * MAX_EXTRA_PRODUCER_STEPS steps longer than that one, unless it is the cheapest of them by estimate, all by `pass`. A
   * producer whose steps are not known (the steps pass never reached its chain) is not dropped for them.
   */
  const simplestAndNotFar = (pass: EstimatePass, key: StuffKey, accepted: readonly Producer[], kept: readonly Producer[]): Producer[] => {
    let simplest: { x: Producer; steps: number; cost: number; rank: number } | undefined;
    for (const x of accepted) {
      const n = pass.stepsOf(x.r);
      if (!Number.isFinite(n)) continue;
      const cost = pass.unitCost(x.r, key);
      const rank = pass.inputRank(x.r);
      const better = simplest === undefined || n < simplest.steps || (n === simplest.steps
        && (cost < simplest.cost || (cost === simplest.cost && (rank < simplest.rank || (rank === simplest.rank && x.r.id < simplest.x.r.id)))));
      if (better) simplest = { x, steps: n, cost, rank };
    }
    if (simplest === undefined) return [...kept];
    const all = kept.includes(simplest.x) ? [...kept] : [...kept, simplest.x];
    const least = Math.min(...all.map((x) => pass.unitCost(x.r, key)));
    const limit = simplest.steps + MAX_EXTRA_PRODUCER_STEPS;
    return all.filter((x) => {
      const n = pass.stepsOf(x.r);
      return !(Number.isFinite(n) && n > limit) || pass.unitCost(x.r, key) <= least + ESTIMATE_TOLERANCE;
    });
  };
  /** A producer's family: a bench variant's original (`Recipe.meta.benchVariantOf`), else itself. */
  const familyOf = (x: Producer): string => (typeof x.r.meta.benchVariantOf === 'string' ? x.r.meta.benchVariantOf : x.r.id);
  /**
   * The producers of `key` one pass keeps: its cheapest (grounded ones first, `grounded`), with R4's simplest. A bench
   * variant and its original (controller ruling 214 (a): one recipe, crafted on an Auto Workbench or by hand) count as
   * one producer, ranked by the cheaper of the two, and are kept together, so the variants never crowd out another route.
   */
  const keptBy = (pass: EstimatePass, key: StuffKey, accepted: readonly Producer[]): Producer[] => {
    const rank = (list: readonly Producer[], max: number): Producer[] =>
      cheapest(list, (x) => pass.unitCost(x.r, key), (x) => x.r.id, max, max, (x) => pass.grounded(x.r, key), (x) => pass.inputRank(x.r));
    if (!accepted.some((x) => isBenchVariant(x.r))) return simplestAndNotFar(pass, key, accepted, rank(accepted, KEEP_PRODUCERS));
    const families = new Map<string, Producer[]>();
    for (const x of accepted) {
      const members = families.get(familyOf(x));
      if (members === undefined) families.set(familyOf(x), [x]);
      else members.push(x);
    }
    const heads = [...families.values()].map((members) => rank(members, 1)[0] ?? (members[0] as Producer));
    const kept = rank(heads, KEEP_PRODUCERS).flatMap((head) => families.get(familyOf(head)) ?? []);
    return simplestAndNotFar(pass, key, accepted, kept);
  };

  /** Ruling R6: a virtual good never asks the oracle and is never bought; its kept options are made or bought. */
  const addVirtual = (vkey: StuffKey, options: Ingredient['options']): void => {
    if (goods.has(vkey)) return;
    goods.set(vkey, { key: vkey, buyable: false, cost: 0, leafClass: null, virtual: true });
    const kept = [...new Set(passes.flatMap((pass) => cheapest(
      options, (o) => o.amount * pass.estimateOf(o.key), (o) => o.key, KEEP_PRODUCERS, MAX_UNBUYABLE_OPTIONS, undefined, (o) => canonicalRank(o.key),
    )))].sort((a, b) => byString(a.key, b.key));
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
    if (r.meta.supply !== undefined) lp.supply = true;
    // a crafting-table recipe none of the line's Auto Workbenches runs is crafted by hand (controller ruling 214)
    const byHand = opts.bench !== undefined && mapId === 'crafting' && !isBenchVariant(r) ? benchRefusal(pack, r, opts.bench) : undefined;
    if (byHand !== undefined) lp.byHand = byHand;
    recipes.set(r.id, lp);
    for (const [key, c] of lp.coeffs) {
      const options = slots.get(key);
      if (options !== undefined) addVirtual(key, options);
      else if (c < 0) need(key);
      else register(key);   // an output: known to the LP, but nothing needs more of it
    }
    // A filled container it makes (a Water Cell beside Vinyl Acetate) can be emptied back into its container instead of
    // being thrown away while another step makes new cells from steel.
    for (const [key, c] of lp.coeffs) {
      const emptier = c > 0 && !slots.has(key) ? emptierOf(key) : null;
      if (emptier !== null) addRecipe(emptier.r, emptier.mapId);
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
    const rejected: Array<{ recipeId: string; why: Rejection; needTier?: number; machine?: string }> = [];
    const accepted: Producer[] = [];
    for (const i of pack.producers.get(key) ?? []) {
      const r = pack.recipes[i];
      // One that consumes or holds an avoided good is no producer here at all: the line re-allows the good when it needs it.
      if (r === undefined || usesAvoided(r, avoid)) continue;
      const a = accept(r);
      if (a.ok) {
        accepted.push({ r, mapId: a.mapId });
        continue;
      }
      // a bench variant no bench runs here is no way of its own: its original is the hand way
      if (a.why === 'bench') continue;
      const entry: { recipeId: string; why: Rejection; needTier?: number; machine?: string } = { recipeId: r.id, why: a.why };
      if (a.needTier !== undefined) entry.needTier = a.needTier;
      const machine = a.why === 'machine' ? unbuildable?.get(r.id) : undefined;
      if (machine !== undefined) entry.machine = machine;
      rejected.push(entry);
    }
    // One pass keeps its picks in its own order; two keep every producer either keeps, in id order.
    const picks = passes.map((pass) => keptBy(pass, key, accepted));
    const kept = picks.length === 1 ? (picks[0] as Producer[]) : [...new Set(picks.flat())].sort((a, b) => byString(a.r.id, b.r.id));
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
  if (pinning.pins.size > 0) graph.optionPins = pinning.pins;
  return graph;
}
