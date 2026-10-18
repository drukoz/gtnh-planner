// Machines per step (spec §3.3, §3.9; prior-art §3.4 step 6, §3.5; gt-mechanics §2): which machine runs each recipe the
// solver chose and at what tier, its overclocked speed, how many machines a step needs and how busy they are, which of
// the group's own machines it can reuse, and the item and fluid flows between the steps.

import { multiblockOverclock, singleblockOverclock, voltageTier, type MachineOc } from '../../shared/gt/overclock.ts';
import { PSEUDO_MACHINES, V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Machine, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import type { PlanContext, PlanFlow, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { keptOptions, virtualKey, type CandidateGraph, type LpRecipe } from './candidates.ts';
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
  opts: {
    groupTier: number; wantTier?: number; coilHeat: number; automateCrafting: boolean; owned: ReadonlyMap<number, number>;
    /** The multiblocks the group can build (`PlanEnv.multiblocks`); absent = any. */
    multiblocks?: ReadonlySet<number>;
  },
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

  const built = opts.multiblocks;
  const multis = machines.filter((m) => m.kind === 'multiblock').sort((a, b) => a.mteId - b.mteId);
  const multi = (built === undefined ? undefined : multis.find((m) => built.has(m.mteId))) ?? multis[0];
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
function recipeAmounts(graph: CandidateGraph, runsById: ReadonlyMap<string, number>): { made: Amounts; used: Amounts } {
  const made: Amounts = new Map();
  const used: Amounts = new Map();
  for (const r of graph.recipes) {
    const runs = runsById.get(r.id);
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
function conversionRuns(graph: CandidateGraph, runsById: ReadonlyMap<string, number>): Map<StuffKey, Map<StuffKey, number>> {
  const runs = new Map<StuffKey, Map<StuffKey, number>>();
  for (const r of graph.recipes) {
    const ends = r.kind === 'convert' ? convertEnds(r) : null;
    if (ends !== null) addAmount(runs, ends.virtual, ends.option, runsById.get(r.id) ?? 0);
  }
  return runs;
}

/** One good of a step's inputs, added up over the slots it fills. */
interface InputTotal { expected: number; nominal: number; chance: number; sameChance: boolean }

/**
 * The consumed inputs per run with expected amounts (`amount × chance`), one entry per good in the order of the slot
 * it first fills: a good in several slots (a real crafting recipe has one ingredient of amount 1 per grid slot,
 * recipes.ts) is added up. Its `chance` is the slots' chance when they share one, else the expected amount over the
 * nominal one. Not-consumed inputs are one-off items of the machine (Task 13). A slot is read as the graph has it, so
 * without the options the line avoids (`keptOptions`, ruling R7).
 */
function stepInputs(r: Recipe, line: StepLine): Product[] {
  const totals = new Map<StuffKey, InputTotal>();
  for (const ing of r.inputs) {
    if (!ing.consumed) continue;
    const options = keptOptions(ing.options, line.avoid);
    if (options.length === 0) continue;
    // A slot with one option is that good itself; a longer one is the virtual good candidates.ts made for it.
    const option = options.length === 1
      ? (options[0] as Option)
      : busiestOption(options, line.conversions.get(virtualKey(options)));
    const expected = option.amount * ing.chance;
    const total = totals.get(option.key);
    if (total === undefined) {
      totals.set(option.key, { expected, nominal: option.amount, chance: ing.chance, sameChance: true });
    } else {
      total.expected += expected;
      total.nominal += option.amount;
      total.sameChance &&= total.chance === ing.chance;
    }
  }
  return [...totals].map(([key, t]) => ({
    key, amount: t.expected, chance: t.sameChance || t.nominal <= 0 ? t.chance : t.expected / t.nominal,
  }));
}

/** The output that is a target, else the one the other recipes consume most (ties: the smallest key). */
function mainOutputOf(r: Recipe, targets: ReadonlySet<StuffKey>, used: ReadonlyMap<StuffKey, ReadonlyMap<string, number>>): StuffKey | undefined {
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

/** A recipe the solution runs that is a step (convert recipes are not), and the machine that runs it. */
export interface PickedRecipe { id: string; runs: number; lp: LpRecipe; mapId: string; recipe: Recipe; pick: MachinePick }

/**
 * The recipes in `runs` that are steps, sorted by id, each with its machine: `pickMachine` with the recipe's own tier
 * from `settings.machineTier` and the group's `owned` machines. Shared by the rate plan and Make N.
 */
export function pickStepMachines(
  pack: Pack, graph: CandidateGraph, runs: ReadonlyMap<string, number>,
  opts: { settings: PlanSettings; groupTier: number; coilHeat: number; owned: ReadonlyMap<number, number>; multiblocks?: ReadonlySet<number> },
): PickedRecipe[] {
  const { settings, groupTier, coilHeat, owned, multiblocks } = opts;
  const lpById = new Map(graph.recipes.map((r) => [r.id, r]));
  const picked: PickedRecipe[] = [];
  for (const [id, n] of [...runs].sort(([a], [b]) => byString(a, b))) {
    const lp = lpById.get(id);
    if (lp === undefined || lp.kind === 'convert' || lp.mapId === null) continue;
    const recipe = pack.recipeById.get(id);
    if (recipe === undefined) throw new Error(`recipe ${id} of the plan is not in the pack`);
    const wantTier = Object.hasOwn(settings.machineTier, id) ? settings.machineTier[id] : undefined;
    const pick = pickMachine(pack, recipe, lp.mapId, { groupTier, wantTier, coilHeat, automateCrafting: settings.automateCrafting, owned, multiblocks });
    picked.push({ id, runs: n, lp, mapId: lp.mapId, recipe, pick });
  }
  return picked;
}

/**
 * What describing a step needs from the whole line: its targets, what its recipes consume, its ore-dictionary
 * conversions, and the goods its graph avoids.
 */
export interface StepLine {
  targets: ReadonlySet<StuffKey>;
  used: ReadonlyMap<StuffKey, ReadonlyMap<string, number>>;
  conversions: ReadonlyMap<StuffKey, ReadonlyMap<StuffKey, number>>;
  avoid?: ReadonlySet<StuffKey>;
}

/** The `StepLine` of a line that runs each recipe `runs` times (per second or in all; only the proportions matter). */
export function stepLine(graph: CandidateGraph, runs: ReadonlyMap<string, number>): StepLine {
  const line: StepLine = { targets: new Set(graph.targets), used: recipeAmounts(graph, runs).used, conversions: conversionRuns(graph, runs) };
  if (graph.avoid !== undefined) line.avoid = graph.avoid;
  return line;
}

/** The warnings that follow from a step's recipe and machine: cleanroom, fast hand-crafting, one energy hatch. */
export function machineWarnings(lp: LpRecipe, pick: MachinePick, runsPerSecond: number): string[] {
  const warnings: string[] = [];
  if (lp.needsCleanroom) warnings.push('Needs a cleanroom');
  if (pick.handCraft && runsPerSecond > HAND_CRAFT_RUNS_PER_SECOND) {
    warnings.push('More than one craft per second by hand — consider automating it');
  }
  if (pick.kind === 'multiblock') warnings.push(`Multiblock: count assumes one energy hatch at ${tierName(pick.tier)}`);
  return warnings;
}

/** How the caller sized a step: machines, owned ones among them, rate, how busy they are, and the step's warnings. */
export type StepSize = Pick<PlanStep, 'count' | 'owned' | 'runsPerSecond' | 'utilization' | 'warnings'>;

/**
 * The step of a picked recipe, sized by the caller: the machine and its overclocked speed, per-run inputs (one per
 * good, slots added up) and outputs (expected amounts), the main output, the overclock inputs, the cleanroom flag and
 * the programmed circuit.
 * `alternatives` stays empty here (Task 14 fills it).
 */
export function describeStep(pack: Pack, p: PickedRecipe, line: StepLine, size: StepSize): PlanStep {
  const { id, recipe: r, pick } = p;
  const step: PlanStep = {
    id, recipeId: id, mapId: p.mapId, machine: { mteId: pick.mteId, name: pick.name, tier: pick.tier },
    count: size.count, owned: size.owned, runsPerSecond: size.runsPerSecond, utilization: size.utilization,
    euPerTick: pick.oc.euPerTick, durationTicks: pick.oc.durationTicks, overclocks: pick.oc.overclocks,
    inputs: stepInputs(r, line),
    outputs: r.outputs.map((o) => ({ key: o.key, amount: o.amount * o.chance, chance: o.chance })),
    alternatives: [], handCraft: pick.handCraft, warnings: size.warnings,
  };
  const mainOutput = mainOutputOf(r, line.targets, line.used);
  if (mainOutput !== undefined) step.mainOutput = mainOutput;
  step.oc = {
    recipeEuPerTick: r.euPerTick, recipeDurationTicks: baseDurationTicks(r, pick), machineVoltage: pick.oc.machineVoltage,
    machineAmps: pick.oc.machineAmps, perfect: pick.kind === 'multiblock' && pack.machines.get(pick.mteId)?.perfectOC === true,
    heatOverclocks: pick.oc.heatOverclocks,
  };
  if (p.lp.needsCleanroom) step.needsCleanroom = true;
  const circuit = recipeCircuit(r);
  if (circuit !== undefined) step.circuit = circuit;
  return step;
}

/**
 * One step per recipe the solution runs (convert recipes are not steps), sorted by id: the picked machine, how many
 * of it the rate needs (`perSecondScale` turns runs into runs per second) and how busy they are, how many of them the
 * group already owns (each owned machine serves one step, earlier steps first), per-run inputs and outputs, and its
 * warnings.
 */
export function planSteps(
  pack: Pack, graph: CandidateGraph, sol: Solution,
  opts: { settings: PlanSettings; groupTier: number; coilHeat: number; ctx: PlanContext; perSecondScale: number; multiblocks?: ReadonlySet<number> },
): PlanStep[] {
  const { settings, groupTier, coilHeat, ctx, perSecondScale, multiblocks } = opts;
  const owned = ownedMachineMap(ctx, settings);
  const unclaimed = new Map(owned);
  const line = stepLine(graph, sol.runs);
  return pickStepMachines(pack, graph, sol.runs, { settings, groupTier, coilHeat, owned, multiblocks }).map((p) => {
    const runsPerSecond = p.runs * perSecondScale;
    const perMachine = p.pick.runsPerSecondPerMachine;
    const count = Math.max(1, Math.ceil(runsPerSecond / perMachine - TINY));
    const free = unclaimed.get(p.pick.mteId) ?? 0;
    const reused = Math.max(0, Math.min(count, free));
    if (reused > 0) unclaimed.set(p.pick.mteId, free - reused);
    return describeStep(pack, p, line, {
      count, owned: reused, runsPerSecond, utilization: runsPerSecond / (count * perMachine),
      warnings: machineWarnings(p.lp, p.pick, runsPerSecond),
    });
  });
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
  const { made, used } = recipeAmounts(graph, sol.runs);
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
