// Candidate recipes (spec §3.3 and §5, gt-mechanics §1.2(b) and §6.4): which recipes the group can run at its tier, and
// the recipe graph the LP plans over, walked back from the targets to buyable leaves. Ore-dictionary slots become
// virtual `alt:` goods that free `convert` recipes fill from each kept option.

import { ebfHeat, voltageTier } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Pack, Recipe } from '../../shared/types/pack.ts';
import type { LeafClass, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';

export interface PlanEnv {
  tier: number; reachable: ReadonlySet<string> /* DimensionInfo.key and Capability.key */; lowGravity: boolean; coilHeat: number; excluded: ReadonlySet<string>;
  /**
   * The mteIds of the multiblocks the group can build at this tier: their controller is available (availability.ts).
   * Absent = every multiblock counts as built. Multiblocks carry no tier in the export, so without this gate the
   * Eye of Harmony, the Godforge modules or the HTGR (EU/t 0 or 1) would run at any tier.
   */
  multiblocks?: ReadonlySet<number>;
}
export type Rejection = 'fake' | 'opaque' | 'excluded' | 'vanilla-furnace' | 'low-gravity' | 'heat' | 'tier' | 'no-machine' | 'multiblock';
export type Acceptance = { ok: true; mapId: string } | { ok: false; why: Rejection; needTier?: number };

export interface LpRecipe {
  id: string; kind: 'recipe' | 'convert'; mapId: string | null;
  /** Per run, expected values: + output × chance, − consumed input × chance; summed per key, sorted by key, zeros dropped. */
  coeffs: Array<[StuffKey, number]>;
  /** euPerTick × durationTicks; 0 for convert. */
  euPerRun: number;
  nonConsumed: StuffKey[]; needsCleanroom: boolean;
}
export interface LeafDecision { buyable: boolean; cost: number; leafClass: LeafClass | null /* null = not a leaf, must be made */ }
export type LeafOracle = (key: StuffKey) => LeafDecision;
export interface GoodInfo { key: StuffKey; buyable: boolean; cost: number; leafClass: LeafClass | null; virtual: boolean }
export interface CandidateGraph {
  targets: StuffKey[]; recipes: LpRecipe[] /* sorted by id */; goods: Map<StuffKey, GoodInfo>;
  blocked: Map<StuffKey, Array<{ recipeId: string; why: Rejection; needTier?: number }>>; warnings: PlanWarning[];
}

const MAX_TIER = V.length - 1;
const MAX_RECIPES = 20_000;
/** Options kept for an ore-dictionary slot none of whose options is buyable. */
const MAX_UNBUYABLE_OPTIONS = 8;
const LAVA: StuffKey = 'fluid:lava';

function anyMapContains(r: Recipe, part: string): boolean {
  return r.maps.some((map) => map.includes(part));
}

/** Recipe categories the group leaves out unless it turns the rule off; the keys are `DEFAULT_EXCLUDED_CATEGORIES`. */
export const EXCLUSION_RULES: Record<string, (r: Recipe, pack: Pack) => boolean> = {
  recycling: (r) => r.flags.recycling === true || (r.category?.includes('recycling') ?? false),
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
}

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
    table = { amps: info?.amps ?? 1, basicTiers: [], plain: [], heated: [] };
    for (const id of pack.machinesByMap.get(mapId) ?? []) {
      const machine = pack.machines.get(id);
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
  // From LV on, the electric furnace runs the derived copy of every smelting recipe.
  if (r.source === 'furnace' && env.tier >= 1) return { ok: false, why: 'vanilla-furnace' };
  if (r.meta.lowGravity === true && !env.lowGravity) return { ok: false, why: 'low-gravity' };

  let hasMachine = false;
  let heat = false;
  let unbuilt = false;
  let needTier = Infinity;
  for (const mapId of [...r.maps].sort()) {
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

/**
 * The recipes that can make `targets` from buyable leaves, breadth-first from the targets with each good expanded once:
 * a target is never bought; any other good is a leaf when `leaf` says it is buyable, else it is made by every accepted
 * producer (or only the recipe `settings.recipeChoice` pins for it, when that recipe still makes it and runs here).
 */
export function buildCandidates(pack: Pack, settings: PlanSettings, env: PlanEnv, leaf: LeafOracle, targets: StuffKey[]): CandidateGraph {
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
    if (recipes.size >= MAX_RECIPES) full = true;
    return !full;
  };

  /** Ruling R6: a virtual good never asks the oracle and is never bought; its kept options are made or bought. */
  const addVirtual = (vkey: StuffKey, options: Ingredient['options']): void => {
    if (goods.has(vkey)) return;
    goods.set(vkey, { key: vkey, buyable: false, cost: 0, leafClass: null, virtual: true });
    const sorted = [...options].sort((a, b) => byString(a.key, b.key));
    const buyable = sorted.filter((o) => decide(o.key).buyable);
    for (const option of buyable.length > 0 ? buyable : sorted.slice(0, MAX_UNBUYABLE_OPTIONS)) {
      const id = `convert:${vkey}:${option.key}`;
      if (recipes.has(id)) continue;
      if (!room()) return;
      const coeffs = new Map<StuffKey, number>([[option.key, -option.amount], [vkey, 1]]);
      recipes.set(id, { id, kind: 'convert', mapId: null, coeffs: sortedCoeffs(coeffs), euPerRun: 0, nonConsumed: [], needsCleanroom: false });
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
    let made = false;
    for (const i of pack.producers.get(key) ?? []) {
      const r = pack.recipes[i];
      if (r === undefined) continue;
      const a = accept(r);
      if (a.ok) {
        made = true;
        addRecipe(r, a.mapId);
      } else {
        rejected.push(a.needTier === undefined ? { recipeId: r.id, why: a.why } : { recipeId: r.id, why: a.why, needTier: a.needTier });
      }
    }
    if (!made && rejected.length > 0) blocked.set(key, rejected.sort((a, b) => byString(a.recipeId, b.recipeId)));
  };

  for (const target of targets) need(target);
  for (let i = 0; i < queue.length && !full; i++) expand(queue[i] as StuffKey);
  if (full) {
    warnings.push({ code: 'graph-too-big', text: 'This chain is too large to plan in one go; mark some parts as "we already make this"' });
  }

  return {
    targets: [...targets], recipes: [...recipes.values()].sort((a, b) => byString(a.id, b.id)), goods, blocked, warnings,
  };
}
