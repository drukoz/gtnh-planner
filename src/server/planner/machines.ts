// Machines per step (spec §3.3, §3.9; prior-art §3.4 step 6, §3.5; gt-mechanics §2): which machine runs each recipe the
// solver chose and at what tier, its overclocked speed, how many machines a step needs and how busy they are, which of
// the group's own machines it can reuse, and the item and fluid flows between the steps.

import { multiblockOverclock, singleblockOverclock, voltageTier, type MachineOc } from '../../shared/gt/overclock.ts';
import { PSEUDO_MACHINES, V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Machine, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import type { PlanContext, PlanFlow, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { virtualKey, type CandidateGraph, type LpRecipe } from './candidates.ts';
import type { Solution } from './solve.ts';

export interface MachinePick {
  mteId: number; name: string; tier: number; kind: 'basic' | 'multiblock' | 'hand' | 'crafting' | 'furnace'; oc: MachineOc;
  runsPerSecondPerMachine: number; handCraft: boolean;
}

const TICKS_PER_SECOND = 20;
/** Ruling R5: one craft per second per crafter, whatever the recipe's duration (0 for crafting recipes, §11.4). */
const CRAFT_TICKS = 20;
/**
 * Amounts up to this count as zero, and a machine count this little above a whole number stays whole (prior-art §3.4
 * step 6: a count that is exactly 2 stays 2).
 */
const TINY = 1e-9;
const HAND_CRAFT_RUNS_PER_SECOND = 1;

const HAND_NAME = 'Crafting table (by hand)';
const CRAFTING_TABLE_NAME = 'Crafting table (automated)';
const FURNACE_NAME = 'Furnace';

/** The flow endpoints that are not steps. */
const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0 (the rounding of `Solution`). */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function tierOf(m: Machine): number {
  return m.tier ?? 0;
}

/** A machine that does not overclock and draws `euPerTick` (0: no EU at all). */
function fixedOc(euPerTick: number, durationTicks: number): MachineOc {
  return { euPerTick, durationTicks, overclocks: 0, heatOverclocks: 0, machineVoltage: 0, machineAmps: 0, parallel: 1 };
}

function picked(p: Omit<MachinePick, 'runsPerSecondPerMachine'>): MachinePick {
  return { ...p, runsPerSecondPerMachine: (TICKS_PER_SECOND * p.oc.parallel) / p.oc.durationTicks };
}

/** Highest tier first, then the lowest mteId. */
function preferred(a: Machine, b: Machine): number {
  return tierOf(b) - tierOf(a) || a.mteId - b.mteId;
}

/** `wantTier` clamped to the accepting tiers (the highest machine at or below it), else owned, else the highest tier. */
function chooseSingleblock(accepting: Machine[], wantTier: number | undefined, owned: ReadonlyMap<number, number>): Machine {
  if (wantTier !== undefined) {
    const tiers = accepting.map(tierOf);
    const tier = clamp(wantTier, Math.min(...tiers), Math.max(...tiers));
    return accepting.filter((m) => tierOf(m) <= tier).sort(preferred)[0] as Machine;
  }
  const mine = accepting.filter((m) => (owned.get(m.mteId) ?? 0) > 0);
  return (mine.length > 0 ? mine : accepting).sort(preferred)[0] as Machine;
}

/**
 * The machine that runs `r` on `mapId` for a group at `groupTier`: a crafting table (by hand unless crafting is
 * automated), the vanilla furnace, else a singleblock of the map at or below the group's tier that has the voltage for
 * the recipe (the per-recipe `wantTier`, else the best owned one, else the highest tier), else the map's multiblock
 * with one energy hatch at `wantTier ?? groupTier`. Throws when the map has no machine that can run the recipe.
 */
export function pickMachine(
  pack: Pack, r: Recipe, mapId: string,
  opts: { groupTier: number; wantTier?: number; coilHeat: number; automateCrafting: boolean; owned: ReadonlyMap<number, number> },
): MachinePick {
  if (mapId === 'crafting') {
    const hand = !opts.automateCrafting;
    return picked({
      mteId: hand ? PSEUDO_MACHINES.HAND : PSEUDO_MACHINES.CRAFTING_TABLE, name: hand ? HAND_NAME : CRAFTING_TABLE_NAME, tier: 0,
      kind: hand ? 'hand' : 'crafting', oc: fixedOc(0, CRAFT_TICKS), handCraft: hand,
    });
  }
  if (mapId === 'furnace') {
    // It burns fuel, not EU; a duration of at least one tick keeps the rate finite.
    return picked({
      mteId: PSEUDO_MACHINES.FURNACE, name: FURNACE_NAME, tier: 0, kind: 'furnace', oc: fixedOc(0, Math.max(r.durationTicks, 1)),
      handCraft: false,
    });
  }

  const machines = (pack.machinesByMap.get(mapId) ?? []).flatMap((id) => pack.machines.get(id) ?? []);
  const mapAmps = pack.maps.get(mapId)?.amps ?? 1;
  // The rule of acceptRecipe (candidates.ts): machine tier ≤ group tier and EU/t ≤ V[machine tier] × the map's amps.
  const accepting = machines.filter(
    (m) => m.kind === 'basic' && tierOf(m) <= opts.groupTier && (V[tierOf(m)] as number) * mapAmps >= r.euPerTick,
  );
  if (accepting.length > 0) {
    const m = chooseSingleblock(accepting, opts.wantTier, opts.owned);
    const oc = singleblockOverclock(r, { tier: tierOf(m), amps: m.amps ?? mapAmps });
    return picked({ mteId: m.mteId, name: m.name, tier: tierOf(m), kind: 'basic', oc, handCraft: false });
  }

  const multi = machines.filter((m) => m.kind === 'multiblock').sort((a, b) => a.mteId - b.mteId)[0];
  if (multi === undefined) throw new Error(`pickMachine: no machine on ${mapId} runs recipe ${r.id} at ${tierName(opts.groupTier)}`);
  // Never a hatch above the group's tier, nor one too weak for the recipe (spec §5).
  const hatchTier = clamp(opts.wantTier ?? opts.groupTier, Math.min(voltageTier(r.euPerTick), opts.groupTier), opts.groupTier);
  const oc = multiblockOverclock(
    { euPerTick: r.euPerTick, durationTicks: r.durationTicks, heat: r.meta.coilHeat ?? r.specialValue },
    { hatchTier, perfectOC: multi.perfectOC === true, heatOC: multi.heatOC === true, coilHeat: opts.coilHeat },
  );
  return picked({ mteId: multi.mteId, name: multi.name, tier: hatchTier, kind: 'multiblock', oc, handCraft: false });
}

/**
 * The group's own machines per mteId (`ctx.ownedMachines` summed), leaving out the types it declined to reuse for this
 * line (`settings.declineReuse`): a declined type counts as not owned everywhere.
 */
export function ownedMachineMap(ctx: PlanContext, settings: PlanSettings): Map<number, number> {
  const declined = new Set(settings.declineReuse ?? []);
  const owned = new Map<number, number>();
  for (const { mteId, count } of ctx.ownedMachines) {
    if (!declined.has(mteId)) owned.set(mteId, (owned.get(mteId) ?? 0) + count);
  }
  return owned;
}

/** The programmed-circuit number a recipe needs: `meta.circuit`, else the meta of a not-consumed programmed circuit. */
export function recipeCircuit(r: Recipe): number | undefined {
  if (typeof r.meta.circuit === 'number') return r.meta.circuit;
  for (const ing of r.inputs) {
    if (ing.consumed) continue;
    for (const option of ing.options) {
      if (isFluidKey(option.key)) continue;
      const { id, meta } = parseItemKey(option.key);
      if (id === PROGRAMMED_CIRCUIT_ID) return meta;
    }
  }
  return undefined;
}

type Option = Ingredient['options'][number];

/** good → node → amount per unit of time. */
type Amounts = Map<StuffKey, Map<string, number>>;

function addAmount(amounts: Amounts, key: StuffKey, node: string, amount: number): void {
  let nodes = amounts.get(key);
  if (nodes === undefined) {
    nodes = new Map();
    amounts.set(key, nodes);
  }
  nodes.set(node, (nodes.get(node) ?? 0) + amount);
}

function sum(nodes: ReadonlyMap<string, number> | undefined): number {
  let total = 0;
  for (const amount of nodes?.values() ?? []) total += amount;
  return total;
}

/** What each recipe with runs makes and consumes of each good (`coeffs` × runs), convert recipes included. */
function recipeAmounts(graph: CandidateGraph, sol: Solution): { made: Amounts; used: Amounts } {
  const made: Amounts = new Map();
  const used: Amounts = new Map();
  for (const r of graph.recipes) {
    const runs = sol.runs.get(r.id);
    if (runs === undefined) continue;
    for (const [key, c] of r.coeffs) addAmount(c > 0 ? made : used, key, r.id, Math.abs(c) * runs);
  }
  return { made, used };
}

/** The good a convert recipe fills (its only output) and the option it takes (its only input). */
function convertEnds(r: LpRecipe): { virtual: StuffKey; option: StuffKey } | null {
  const virtual = r.coeffs.find(([, c]) => c > 0)?.[0];
  const option = r.coeffs.find(([, c]) => c < 0)?.[0];
  return virtual === undefined || option === undefined ? null : { virtual, option };
}

/** For an ore-dictionary slot, the option its conversions used most (ties: the smallest key). */
function busiestOption(options: readonly Option[], conversions: ReadonlyMap<StuffKey, number> | undefined): Option {
  const runs = (o: Option): number => conversions?.get(o.key) ?? 0;
  const sorted = [...options].sort((a, b) => byString(a.key, b.key));
  let best = sorted[0] as Option;
  for (const option of sorted) if (runs(option) > runs(best)) best = option;
  return best;
}

/** Virtual good → option → runs of the convert recipe that fills it from that option. */
function conversionRuns(graph: CandidateGraph, sol: Solution): Map<StuffKey, Map<StuffKey, number>> {
  const runs = new Map<StuffKey, Map<StuffKey, number>>();
  for (const r of graph.recipes) {
    const ends = r.kind === 'convert' ? convertEnds(r) : null;
    if (ends !== null) addAmount(runs, ends.virtual, ends.option, sol.runs.get(r.id) ?? 0);
  }
  return runs;
}

/** The consumed inputs per run, expected amounts; not-consumed ones are one-off items of the machine (Task 13). */
function stepInputs(r: Recipe, conversions: ReadonlyMap<StuffKey, ReadonlyMap<StuffKey, number>>): Product[] {
  return r.inputs.flatMap((ing): Product[] => {
    if (!ing.consumed || ing.options.length === 0) return [];
    // A slot with one option is that good itself; a longer one is the virtual good candidates.ts made for it.
    const option = ing.options.length === 1
      ? (ing.options[0] as Option)
      : busiestOption(ing.options, conversions.get(virtualKey(ing.options)));
    return [{ key: option.key, amount: option.amount * ing.chance, chance: ing.chance }];
  });
}

/** The output that is a target, else the one the other recipes consume most (ties: the smallest key). */
function mainOutputOf(r: Recipe, targets: ReadonlySet<StuffKey>, used: Amounts): StuffKey | undefined {
  const outputs = [...new Set(r.outputs.map((p) => p.key))].sort(byString);
  const target = outputs.find((key) => targets.has(key));
  if (target !== undefined) return target;
  let best: StuffKey | undefined;
  let bestUse = -Infinity;
  for (const key of outputs) {
    const nodes = used.get(key);
    const use = sum(nodes) - (nodes?.get(r.id) ?? 0);
    if (use > bestUse) {
      best = key;
      bestUse = use;
    }
  }
  return best;
}

/**
 * One step per recipe the solution runs (convert recipes are not steps), sorted by id: the picked machine, how many
 * of it the rate needs (`perSecondScale` turns runs into runs per second) and how busy they are, how many of them the
 * group already owns (each owned machine serves one step, earlier steps first), per-run inputs and outputs, and its
 * warnings. `alternatives` stays empty here (Task 14 fills it).
 */
export function planSteps(
  pack: Pack, graph: CandidateGraph, sol: Solution,
  opts: { settings: PlanSettings; groupTier: number; coilHeat: number; ctx: PlanContext; perSecondScale: number },
): PlanStep[] {
  const { settings, groupTier, coilHeat, ctx, perSecondScale } = opts;
  const owned = ownedMachineMap(ctx, settings);
  const unclaimed = new Map(owned);
  const lpById = new Map(graph.recipes.map((r) => [r.id, r]));
  const targets = new Set(graph.targets);
  const { used } = recipeAmounts(graph, sol);
  const conversions = conversionRuns(graph, sol);

  const steps: PlanStep[] = [];
  for (const [id, runs] of [...sol.runs].sort(([a], [b]) => byString(a, b))) {
    const lp = lpById.get(id);
    if (lp === undefined || lp.kind === 'convert' || lp.mapId === null) continue;
    const r = pack.recipeById.get(id);
    if (r === undefined) throw new Error(`planSteps: recipe ${id} of the plan is not in the pack`);
    const wantTier = Object.hasOwn(settings.machineTier, id) ? settings.machineTier[id] : undefined;
    const pick = pickMachine(pack, r, lp.mapId, { groupTier, wantTier, coilHeat, automateCrafting: settings.automateCrafting, owned });

    const runsPerSecond = runs * perSecondScale;
    const perMachine = pick.runsPerSecondPerMachine;
    const count = Math.max(1, Math.ceil(runsPerSecond / perMachine - TINY));
    const free = unclaimed.get(pick.mteId) ?? 0;
    const reused = Math.max(0, Math.min(count, free));
    if (reused > 0) unclaimed.set(pick.mteId, free - reused);

    const warnings: string[] = [];
    if (lp.needsCleanroom) warnings.push('Needs a cleanroom');
    if (pick.handCraft && runsPerSecond > HAND_CRAFT_RUNS_PER_SECOND) {
      warnings.push('More than one craft per second by hand — consider automating it');
    }
    if (pick.kind === 'multiblock') warnings.push(`Multiblock: count assumes one energy hatch at ${tierName(pick.tier)}`);

    const step: PlanStep = {
      id, recipeId: id, mapId: lp.mapId, machine: { mteId: pick.mteId, name: pick.name, tier: pick.tier },
      count, owned: reused, runsPerSecond, utilization: runsPerSecond / (count * perMachine),
      euPerTick: pick.oc.euPerTick, durationTicks: pick.oc.durationTicks, overclocks: pick.oc.overclocks,
      inputs: stepInputs(r, conversions),
      outputs: r.outputs.map((p) => ({ key: p.key, amount: p.amount * p.chance, chance: p.chance })),
      alternatives: [], handCraft: pick.handCraft, warnings,
    };
    const mainOutput = mainOutputOf(r, targets, used);
    if (mainOutput !== undefined) step.mainOutput = mainOutput;
    step.oc = {
      recipeEuPerTick: r.euPerTick, recipeDurationTicks: baseDurationTicks(r, pick), machineVoltage: pick.oc.machineVoltage,
      machineAmps: pick.oc.machineAmps, perfect: pick.kind === 'multiblock' && pack.machines.get(pick.mteId)?.perfectOC === true,
      heatOverclocks: pick.oc.heatOverclocks,
    };
    if (lp.needsCleanroom) step.needsCleanroom = true;
    const circuit = recipeCircuit(r);
    if (circuit !== undefined) step.circuit = circuit;
    steps.push(step);
  }
  return steps;
}

/** The duration the pick started from: a crafting table's fixed craft time, the furnace's own, else the recipe's. */
function baseDurationTicks(r: Recipe, pick: MachinePick): number {
  if (pick.kind === 'hand' || pick.kind === 'crafting') return CRAFT_TICKS;
  return pick.kind === 'furnace' ? pick.oc.durationTicks : r.durationTicks;
}

/**
 * Item and fluid flows per unit of time. Per real good, each producer (`raw` for what the line buys, else the recipe)
 * is split across its consumers (recipes, `out` for the targets' demand, `sink` for what the line throws away) in
 * proportion to what each takes. Convert recipes are transparent: what one takes of an option goes on to the recipes
 * that consume its virtual good, in proportion to their use. Flows under 1e-9 are dropped; values are rounded to 9
 * decimal places and sorted by `from`, `to`, `key`.
 */
export function buildFlows(graph: CandidateGraph, sol: Solution, targets: StuffKey[]): PlanFlow[] {
  const { made, used } = recipeAmounts(graph, sol);
  for (const [key, amount] of sol.buys) addAmount(made, key, RAW, amount);
  for (const [key, amount] of sol.sinks) addAmount(used, key, SINK, amount);
  for (const target of new Set(targets)) {
    const out = sum(made.get(target)) - sum(used.get(target));
    if (out > TINY) addAmount(used, target, OUT, out);
  }

  // Convert recipes are transparent: what one takes of an option goes on to the users of its virtual good.
  for (const r of graph.recipes) {
    const ends = r.kind === 'convert' ? convertEnds(r) : null;
    const takers = ends === null ? undefined : used.get(ends.option);
    const taken = takers?.get(r.id);
    if (ends === null || takers === undefined || taken === undefined) continue;
    takers.delete(r.id);
    const users = used.get(ends.virtual);
    const total = sum(users);
    if (total <= 0) continue;
    for (const [to, amount] of users ?? []) addAmount(used, ends.option, to, (taken * amount) / total);
  }

  const flows: PlanFlow[] = [];
  for (const [key, producers] of made) {
    if (graph.goods.get(key)?.virtual === true) continue;
    const consumers = used.get(key);
    const total = sum(consumers);
    if (consumers === undefined || total <= 0) continue;
    for (const [from, produced] of producers) {
      for (const [to, amount] of consumers) {
        const perSecond = (produced * amount) / total;
        if (perSecond >= TINY) flows.push({ from, to, key, perSecond: round9(perSecond) });
      }
    }
  }
  return flows.sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to) || byString(a.key, b.key));
}
