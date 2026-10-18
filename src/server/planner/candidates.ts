// Candidate recipes (spec §3.3 and §5, gt-mechanics §1.2(b) and §6.4): which recipes the group can run at its tier, and
// the recipe graph the LP plans over, walked back from the targets to buyable leaves. Ore-dictionary slots become
// virtual `alt:` goods that free `convert` recipes fill from each kept option.

import { ebfHeat, voltageTier } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Pack, Recipe } from '../../shared/types/pack.ts';
import type { LeafClass, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';
import type { RoughCosts } from './rough.ts';

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
export interface LeafDecision { buyable: boolean; cost: number; leafClass: LeafClass | null /* null = not a leaf, must be made */ }
export type LeafOracle = (key: StuffKey) => LeafDecision;
export interface GoodInfo { key: StuffKey; buyable: boolean; cost: number; leafClass: LeafClass | null; virtual: boolean }
export interface CandidateGraph {
  targets: StuffKey[]; recipes: LpRecipe[] /* sorted by id */; goods: Map<StuffKey, GoodInfo>;
  blocked: Map<StuffKey, Array<{ recipeId: string; why: Rejection; needTier?: number }>>; warnings: PlanWarning[];
  // optional addition
  /** The walk stopped at its recipe cap: goods it never expanded look unmakeable, so blockers would name the wrong goods. */
  truncated?: boolean;
}

const MAX_TIER = V.length - 1;
/** The walk stops adding recipes here (`CandidateGraph.truncated`). */
export const MAX_RECIPES = 40_000;
/** Options kept for an ore-dictionary slot none of whose options is buyable (without rough costs). */
const MAX_UNBUYABLE_OPTIONS = 8;
/**
 * With rough costs, a good's producers are kept while their rough cost per unit is at most this many times the
 * cheapest one's (always the 2 cheapest, at most 8; for a target 3 times, at most 12, so the swap list has choices).
 * Rough costs give no byproduct credit, so the margin leaves room for recipes whose co-products the line uses.
 */
const KEEP_FACTOR = 1.5;
const TARGET_KEEP_FACTOR = 3;
const MIN_PRODUCERS = 2;
const MAX_PRODUCERS = 8;
const MAX_TARGET_PRODUCERS = 12;
/** Ore-dictionary options kept with rough costs: one per cost level (the first listed), within KEEP_FACTOR, at most 3. */
const MAX_OPTIONS = 3;
const COST_SLACK = 1e-9;
const LAVA: StuffKey = 'fluid:lava';

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

/** Recipe categories the group leaves out unless it turns the rule off; the keys are `DEFAULT_EXCLUDED_CATEGORIES`. */
export const EXCLUSION_RULES: Record<string, (r: Recipe, pack: Pack) => boolean> = {
  recycling: (r, pack) => r.flags.recycling === true || (r.category?.includes('recycling') ?? false) || smeltsBack(r, pack),
  massfab: (r) => anyMapContains(r, 'massfab'),
  replicator: (r) => anyMapContains(r, 'replicator'),
  scrap: (r) => anyMapContains(r, 'recycler') || anyMapContains(r, 'scrapbox'),
  'lava-centrifuge': (r, pack) => (anyMapContains(r, 'centrifuge') && r.inputs.some((ing) => ing.options.some(
    (o) => o.key === LAVA || (pack.items.get(o.key)?.oreDict.includes('dustStone') ?? false))))
    // The Large Thermal Refinery's lava filter: 1,000 L of free lava → a few % of a copper, tin, gold, silver or tantalum
    // ingot. With lava free it made every such metal cost 0 (24 refineries, 5.7M L lava/min for 2 Good Circuits/min).
    || (anyMapContains(r, 'thermalboiler') && r.outputs.some((p) => !isFluidKey(p.key))
      && r.inputs.some((ing) => ing.consumed && ing.options.some((o) => o.key === LAVA))),
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

/** Optional parts of `buildCandidates`. */
export interface CandidateOptions {
  /** Rough costs at the same env and leaf prices (rough.ts): only the producers that can matter are expanded. */
  rough?: RoughCosts;
  /** The recipe cap (default `MAX_RECIPES`). */
  maxRecipes?: number;
}

/**
 * The recipes that can make `targets` from buyable leaves, breadth-first from the targets with each good expanded once:
 * a target is never bought; any other good is a leaf when `leaf` says it is buyable, else it is made by every accepted
 * producer (or only the recipe `settings.recipeChoice` pins for it, when that recipe still makes it and runs here).
 * With `opts.rough`, a good with a finitely priced producer keeps only its cheapest producers (KEEP_FACTOR): one that
 * makes the good only as a small chanced byproduct, only hands back a container it took in (most of the 1,700 recipes
 * that "make" an empty cell), or needs inputs already costlier than a known route is not walked; an ore-dictionary
 * slot keeps its cheapest options, the first listed among equally cheap ones (oak before sacred oak). Without rough
 * costs, or for a good no producer of which has a finite rough cost, every accepted producer is kept.
 */
export function buildCandidates(
  pack: Pack, settings: PlanSettings, env: PlanEnv, leaf: LeafOracle, targets: StuffKey[], opts: CandidateOptions = {},
): CandidateGraph {
  const rough = opts.rough;
  const maxRecipes = opts.maxRecipes ?? MAX_RECIPES;
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
    if (targetSet.has(key)) return NOT_A_LEAF;
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
      const { buyable, cost, leafClass } = decide(key);
      good = { key, buyable, cost, leafClass, virtual: false };
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
  /** What one unit of an option costs the line: its leaf price when it is bought, else its rough cost. */
  const optionCost = (key: StuffKey): number => {
    const d = decide(key);
    return d.buyable ? d.cost : (rough?.cost(key) ?? Infinity);
  };
  /** With rough costs, the options of a slot worth a convert recipe; null when none has a finite cost. */
  const cheapestOptions = (options: Ingredient['options']): Ingredient['options'] | null => {
    if (rough === undefined) return null;
    const ranked = options.map((o, index) => ({ o, index, cost: optionCost(o.key) * o.amount }))
      .filter((x) => Number.isFinite(x.cost))
      .sort((a, b) => a.cost - b.cost || a.index - b.index);
    const best = ranked[0]?.cost;
    if (best === undefined) return null;
    const kept: Array<{ o: Ingredient['options'][number]; cost: number }> = [];
    for (const x of ranked) {
      if (kept.length >= MAX_OPTIONS || x.cost > best * KEEP_FACTOR + COST_SLACK) break;
      if (kept.some((k) => Math.abs(k.cost - x.cost) <= Math.abs(x.cost) * COST_SLACK + COST_SLACK)) continue;   // one per cost level
      kept.push(x);
    }
    return kept.map((k) => k.o).sort((a, b) => byString(a.key, b.key));
  };

  /** Ruling R6: a virtual good never asks the oracle and is never bought; its kept options are made or bought. */
  const addVirtual = (vkey: StuffKey, options: Ingredient['options']): void => {
    if (goods.has(vkey)) return;
    goods.set(vkey, { key: vkey, buyable: false, cost: 0, leafClass: null, virtual: true });
    const sorted = [...options].sort((a, b) => byString(a.key, b.key));
    const buyable = sorted.filter((o) => decide(o.key).buyable);
    const kept = cheapestOptions(options) ?? (buyable.length > 0 ? buyable : sorted.slice(0, MAX_UNBUYABLE_OPTIONS));
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
      const first = ing.options[0];
      if (first === undefined) continue;
      if (!ing.consumed) {
        nonConsumed.push(first.key);
      } else if (ing.options.length === 1) {
        addTo(coeffs, first.key, -first.amount * ing.chance);
      } else {
        const vkey = virtualKey(ing.options);
        slots.set(vkey, ing.options);
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
      if (pinned !== null) {
        addRecipe(pinned.r, pinned.mapId);
        return;
      }
      warnings.push({
        code: 'stale-choice', key,
        text: `${pack.nameOf(key)}: the chosen recipe is gone or cannot run at ${tierName(env.tier)}; using the best one available`,
      });
    }
    const rejected: Array<{ recipeId: string; why: Rejection; needTier?: number }> = [];
    const runnable: Array<{ index: number; r: Recipe; mapId: string }> = [];
    for (const i of pack.producers.get(key) ?? []) {
      const r = pack.recipes[i];
      if (r === undefined) continue;
      const a = accept(r);
      if (a.ok) runnable.push({ index: i, r, mapId: a.mapId });
      else rejected.push(a.needTier === undefined ? { recipeId: r.id, why: a.why } : { recipeId: r.id, why: a.why, needTier: a.needTier });
    }
    for (const p of keptProducers(key, runnable)) addRecipe(p.r, p.mapId);
    if (runnable.length === 0 && rejected.length > 0) blocked.set(key, rejected.sort((a, b) => byString(a.recipeId, b.recipeId)));
  };
  /** The producers of `key` worth walking (see the doc comment); all of them without rough costs. */
  const keptProducers = <P extends { index: number; r: Recipe }>(key: StuffKey, runnable: P[]): P[] => {
    if (rough === undefined) return runnable;
    const priced = runnable.map((p) => ({ p, cost: rough.recipeCost(p.index, key) }))
      .filter((x) => Number.isFinite(x.cost))
      .sort((a, b) => a.cost - b.cost || byString(a.p.r.id, b.p.r.id));
    const best = priced[0]?.cost;
    if (best === undefined) return runnable;
    const target = targetSet.has(key);
    const factor = target ? TARGET_KEEP_FACTOR : KEEP_FACTOR;
    const cap = target ? MAX_TARGET_PRODUCERS : MAX_PRODUCERS;
    return priced.filter((x, n) => n < MIN_PRODUCERS || x.cost <= best * factor + COST_SLACK).slice(0, cap).map((x) => x.p);
  };

  for (const target of targets) need(target);
  for (let i = 0; i < queue.length && !full; i++) expand(queue[i] as StuffKey);
  if (full) {
    warnings.push({ code: 'graph-too-big', text: 'This chain is too large to plan in one go; mark some parts as "we already make this"' });
  }

  return {
    targets: [...targets], recipes: [...recipes.values()].sort((a, b) => byString(a.id, b.id)), goods, blocked, warnings, truncated: full,
  };
}
