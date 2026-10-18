// Make N (spec §3.2, prior-art §3.6): a one-off batch of N on the machines the group already owns. The LP's runs are
// rounded up to whole crafts (a good the rounding leaves short gets more runs, a buyable one is bought, a surplus is a
// leftover); each step runs on every owned machine of its type, or on one added machine when nothing owned can run
// it; and the batch takes as long as the busiest machine type plus the time one run needs to pass down the chain.

import { PSEUDO_MACHINES } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Pack, Product } from '../../shared/types/pack.ts';
import type { PlanContext, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import type { CandidateGraph, LpRecipe } from './candidates.ts';
import { describeStep, machineWarnings, ownedMachineMap, pickStepMachines, stepLine, type PickedRecipe } from './machines.ts';
import type { Solution } from './solve.ts';

export interface MakeNResult {
  steps: PlanStep[]; buys: Map<StuffKey, number>; leftovers: Product[]; totalSeconds: number;
  addedMachines: Array<{ mteId: number; count: number }>;
}

/** Amounts up to this count as zero; a run count this little above a whole number stays whole. */
const TINY = 1e-9;
const MAX_ROUNDS = 1000;
const TICKS_PER_SECOND = 20;
const PSEUDO_IDS: ReadonlySet<number> = new Set(Object.values(PSEUDO_MACHINES));
const CHANCED_WARNING = 'Chanced outputs: amounts are expected values; a small batch may come out short';

/** 9 decimal places; −0 reads 0 (the rounding of `Solution`). */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

function sortedById<V>(entries: Iterable<[string, V]>): Map<string, V> {
  return new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Good → the recipes that make it (positive coefficient), in the graph's id order. */
function producersOf(recipes: readonly LpRecipe[]): Map<StuffKey, LpRecipe[]> {
  const producers = new Map<StuffKey, LpRecipe[]>();
  for (const r of recipes) {
    for (const [key, c] of r.coeffs) {
      if (c <= 0) continue;
      const list = producers.get(key);
      if (list === undefined) producers.set(key, [r]);
      else list.push(r);
    }
  }
  return producers;
}

/**
 * Whole runs for a batch: every recipe with runs starts at its LP runs rounded up; then, up to 1000 times, the first
 * good by key that cannot be bought and falls short (`Σ coefficient × runs − demand < 0`) gets enough extra runs of its
 * producer with the most runs (ties: the smallest id). Buyable goods that fall short are bought, rounded up to whole
 * items or whole litres; real goods left over are `leftovers` (`chance: 1`, sorted by key). Virtual ore-dictionary
 * goods are never leftovers.
 */
export function wholeRuns(
  graph: CandidateGraph, sol: Solution, demand: ReadonlyMap<StuffKey, number>,
): { runs: Map<string, number>; buys: Map<StuffKey, number>; leftovers: Product[] } {
  const byId = new Map(graph.recipes.map((r) => [r.id, r]));
  const producers = producersOf(graph.recipes);
  const runs = new Map<string, number>();
  const balance = new Map<StuffKey, number>();
  for (const [key, amount] of demand) balance.set(key, (balance.get(key) ?? 0) - amount);
  const addRuns = (r: LpRecipe, n: number): void => {
    runs.set(r.id, (runs.get(r.id) ?? 0) + n);
    for (const [key, c] of r.coeffs) balance.set(key, (balance.get(key) ?? 0) + c * n);
  };
  for (const [id, x] of sol.runs) {
    const r = byId.get(id);
    if (r !== undefined) addRuns(r, Math.ceil(x - TINY));
  }

  const buyable = (key: StuffKey): boolean => graph.goods.get(key)?.buyable === true;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // A good with no producer cannot be made up for; a feasible LP solution never leaves one short.
    const short = [...balance.keys()].sort()
      .find((key) => !buyable(key) && (balance.get(key) ?? 0) < -TINY && producers.has(key));
    if (short === undefined) break;
    const deficit = -(balance.get(short) ?? 0);
    const candidates = producers.get(short) as LpRecipe[];   // in id order, so the first of equals wins a tie
    let best = candidates[0] as LpRecipe;
    for (const r of candidates) if ((runs.get(r.id) ?? 0) > (runs.get(best.id) ?? 0)) best = r;
    const perRun = best.coeffs.find(([key]) => key === short)?.[1] as number;   // > 0: best is a producer
    addRuns(best, Math.max(1, Math.ceil(deficit / perRun - TINY)));
  }

  const buys = new Map<StuffKey, number>();
  const leftovers: Product[] = [];
  for (const key of [...balance.keys()].sort()) {
    const b = balance.get(key) ?? 0;
    // Items are counted in items and fluids in litres, so both round up to a whole number.
    if (b < -TINY && buyable(key)) buys.set(key, Math.ceil(-b - TINY));
    else if (b > TINY && graph.goods.get(key)?.virtual !== true) leftovers.push({ key, amount: round9(b), chance: 1 });
  }
  return { runs: sortedById(runs), buys, leftovers };
}

/** Ticks of machine work a step needs: runs × overclocked duration ÷ parallel. */
function workTicks(p: PickedRecipe): number {
  return (p.runs * p.pick.oc.durationTicks) / p.pick.oc.parallel;
}

/**
 * The time to fill the chain once: the longest path from a recipe that makes a target back to raw materials, adding
 * one run's (overclocked) duration per step; convert recipes take no time and a loop is cut where it closes.
 */
function fillSeconds(graph: CandidateGraph, runs: ReadonlyMap<string, number>, picked: readonly PickedRecipe[],
  targets: Iterable<StuffKey>): number {
  const ticksOf = new Map(picked.map((p) => [p.id, p.pick.oc.durationTicks]));
  const producers = producersOf(graph.recipes.filter((r) => runs.has(r.id)));
  const longest = new Map<string, number>();
  const onPath = new Set<string>();
  const chain = (r: LpRecipe): number => {
    const known = longest.get(r.id);
    if (known !== undefined) return known;
    onPath.add(r.id);
    let upstream = 0;
    for (const [key, c] of r.coeffs) {
      if (c >= 0) continue;
      for (const p of producers.get(key) ?? []) if (!onPath.has(p.id)) upstream = Math.max(upstream, chain(p));
    }
    onPath.delete(r.id);
    const ticks = (ticksOf.get(r.id) ?? 0) + upstream;
    longest.set(r.id, ticks);
    return ticks;
  };
  let fill = 0;
  for (const target of [...targets].sort()) for (const r of producers.get(target) ?? []) fill = Math.max(fill, chain(r));
  return fill / TICKS_PER_SECOND;
}

/**
 * Make N on the group's machines (spec §3.2, prior-art §3.6). Each step runs on the machine `pickMachine` chooses with
 * the group's owned machines (a type in `settings.declineReuse` counts as not owned): an owned type gives the step all
 * the owned machines of that type (`count = owned`), shared with the other steps of that type; any other type gets one
 * new machine (`count 1, owned 0`, in `addedMachines`), likewise shared. Pseudo machines (hand-crafting, crafting
 * table, furnace) are never added. `totalSeconds` = the busiest machine type (Σ work ÷ its machines) plus the fill time.
 */
export function makeN(
  pack: Pack, graph: CandidateGraph, sol: Solution, demand: ReadonlyMap<StuffKey, number>,
  opts: { settings: PlanSettings; groupTier: number; coilHeat: number; ctx: PlanContext; multiblocks?: ReadonlySet<number> },
): MakeNResult {
  const { settings, groupTier, coilHeat, ctx, multiblocks } = opts;
  const whole = wholeRuns(graph, sol, demand);
  const owned = ownedMachineMap(ctx, settings);
  const picked = pickStepMachines(pack, graph, whole.runs, { settings, groupTier, coilHeat, owned, multiblocks });

  const ownedOf = (mteId: number): number => Math.max(0, owned.get(mteId) ?? 0);
  const machinesOf = (mteId: number): number => ownedOf(mteId) || 1;
  const stepsOfType = new Map<number, string[]>();
  const workOfType = new Map<number, number>();
  for (const p of picked) {
    const mteId = p.pick.mteId;
    const ids = stepsOfType.get(mteId);
    if (ids === undefined) stepsOfType.set(mteId, [p.id]);
    else ids.push(p.id);
    workOfType.set(mteId, (workOfType.get(mteId) ?? 0) + workTicks(p));
  }
  let busiest = 0;
  for (const [mteId, ticks] of workOfType) busiest = Math.max(busiest, ticks / (machinesOf(mteId) * TICKS_PER_SECOND));
  const totalSeconds = busiest + fillSeconds(graph, whole.runs, picked, demand.keys());

  const line = stepLine(graph, whole.runs);
  const steps = picked.map((p): PlanStep => {
    const mteId = p.pick.mteId;
    const count = machinesOf(mteId);
    // A batch of machines that take no time at all has nothing to spread over; it reads 0 rather than NaN.
    const runsPerSecond = totalSeconds > 0 ? p.runs / totalSeconds : 0;
    const utilization = totalSeconds > 0 ? workTicks(p) / TICKS_PER_SECOND / (count * totalSeconds) : 0;
    const warnings = machineWarnings(p.lp, p.pick, runsPerSecond);
    const others = (stepsOfType.get(mteId) ?? []).filter((id) => id !== p.id);
    // Hand-crafting, a crafting table or a furnace has no circuit or mold to swap.
    if (others.length > 0 && !PSEUDO_IDS.has(mteId)) {
      warnings.push(`Shares machines with ${others.join(', ')} — swap circuits/molds between batches`);
    }
    if (p.recipe.outputs.some((o) => o.chance < 1)) warnings.push(CHANCED_WARNING);
    const step = describeStep(pack, p, line, { count, owned: ownedOf(mteId), runsPerSecond, utilization, warnings });
    step.runs = p.runs;
    return step;
  });

  const addedMachines = [...stepsOfType.keys()]
    .filter((mteId) => ownedOf(mteId) === 0 && !PSEUDO_IDS.has(mteId))
    .sort((a, b) => a - b)
    .map((mteId) => ({ mteId, count: 1 }));
  return { steps, buys: whole.buys, leftovers: whole.leftovers, totalSeconds, addedMachines };
}
