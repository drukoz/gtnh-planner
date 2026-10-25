// Make N (spec §3.2, prior-art §3.6): a one-off batch of N on the machines the group already owns. The LP's runs are
// rounded up to whole crafts (a good the rounding leaves short gets more runs, a buyable one is bought, a surplus is a
// leftover); each step runs on every owned machine of its type, or on one added machine when nothing owned can run it
// or a new one pays for itself against the batch (plan 12: the build-cost solve decides which); and the batch takes as
// long as the busiest machine type plus the time one run needs to pass down the chain.

import { PSEUDO_IDS } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Pack, Product } from '../../shared/types/pack.ts';
import type { PlanContext, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import { isAutoWorkbench } from './benches.ts';
import type { CandidateGraph, LpRecipe } from './candidates.ts';
import {
  boughtGoods, describeStep, machineWarnings, ownedPools, pickStepMachines, reusedOf, stepLine, type PickedRecipe, type StepLine, type StepSize,
} from './machines.ts';
import { legacyMteId, machineIdOfLegacy, type MachineId } from '../../shared/ids.ts';
import { solveLp, type LpRow } from './lp.ts';
import type { BuildModel, OwnedPools } from './machine-options.ts';
import type { Solution } from './solve.ts';

export interface MakeNResult {
  steps: PlanStep[]; buys: Map<StuffKey, number>; leftovers: Product[]; totalSeconds: number;
  addedMachines: Array<{ mteId: number; count: number }>;
  /** Goods whole runs could not balance: the batch comes out this much short of them (`wholeRuns`). */
  short: Product[];
}

/** Amounts up to this count as zero; a run count this little above a whole number stays whole. */
const TINY = 1e-9;
const MAX_ROUNDS = 1000;
/** A loop gets this many top-ups per good in it (plus as many) before it counts as making no progress. */
const LOOP_TOP_UPS = 8;
/** A good of a loop short again by more than this times its last deficit: topping up only digs the loop deeper. */
const GROWTH = 1.5;
const TICKS_PER_SECOND = 20;
const CHANCED_WARNING = 'Chanced outputs: amounts are expected values; a small batch may come out short';

/** 9 decimal places; −0 reads 0: whole-batch amounts (rates use `sig9`). */
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

/** Each good's place downstream-first: goods of one strongly connected component (a loop) share it. */
function downstreamOrder(recipes: readonly LpRecipe[]): { order: Map<StuffKey, number>; size: Map<number, number> } {
  const next = new Map<StuffKey, Set<StuffKey>>();
  const link = (from: StuffKey, to: StuffKey): void => {
    let set = next.get(from);
    if (set === undefined) next.set(from, (set = new Set()));
    set.add(to);
  };
  for (const r of recipes) {
    const inputs = r.coeffs.filter(([, c]) => c < 0).map(([key]) => key);
    const outputs = r.coeffs.filter(([, c]) => c > 0).map(([key]) => key);
    for (const input of inputs) for (const output of outputs) link(input, output);
    for (const key of [...inputs, ...outputs]) if (!next.has(key)) next.set(key, new Set());
  }
  // Tarjan's algorithm, iterative: a component is finished once everything downstream of it is, so the first one
  // finished is the most downstream.
  const index = new Map<StuffKey, number>();
  const low = new Map<StuffKey, number>();
  const onStack = new Set<StuffKey>();
  const stack: StuffKey[] = [];
  const order = new Map<StuffKey, number>();
  const size = new Map<number, number>();
  let counter = 0;
  let components = 0;
  for (const root of [...next.keys()].sort()) {
    if (index.has(root)) continue;
    const work: Array<{ key: StuffKey; children: StuffKey[]; at: number }> = [];
    const open = (key: StuffKey): void => {
      index.set(key, counter);
      low.set(key, counter);
      counter++;
      stack.push(key);
      onStack.add(key);
      work.push({ key, children: [...(next.get(key) ?? [])].sort(), at: 0 });
    };
    open(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.at < frame.children.length) {
        const child = frame.children[frame.at++]!;
        if (!index.has(child)) open(child);
        else if (onStack.has(child)) low.set(frame.key, Math.min(low.get(frame.key)!, index.get(child)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) low.set(parent.key, Math.min(low.get(parent.key)!, low.get(frame.key)!));
      if (low.get(frame.key) === index.get(frame.key)) {
        let n = 0;
        for (;;) {
          const key = stack.pop()!;
          onStack.delete(key);
          order.set(key, components);
          n++;
          if (key === frame.key) break;
        }
        size.set(components, n);
        components++;
      }
    }
  }
  return { order, size };
}

/** Whole runs for a batch, what it buys (whole items, whole litres), what is left over, and what it comes out short of. */
export interface WholeRuns { runs: Map<string, number>; buys: Map<StuffKey, number>; leftovers: Product[]; short: Product[] }

/** Raw cost one extra run is worth in the whole-runs MIP: among plans of equal raw material, the fewest runs. */
const RUN_WEIGHT = 1e-4;
/** A bought unit is worth this much even when free, so the MIP never buys more water than the batch takes. */
const BUY_WEIGHT = 1e-7;
const MIP_SECONDS = 2;

/**
 * Whole runs for a batch (spec §3.2), exactly: the recipes the LP runs, as a small integer program over the LP's own
 * rows (`Σ a·x + buy − leftover = demand` per good, purchases only of buyable goods) with whole runs and whole
 * purchases, the least raw material first and then the fewest runs. A batch needs no top-up heuristic then: loops of
 * cells, catalysts and refinery fractions close by themselves, and nothing comes out short. When the program has no
 * answer within 2 s (or none at all: the LP relied on something whole runs cannot do), `greedyWholeRuns` decides, and
 * its `short` says what the batch would lack.
 */
export async function wholeRuns(graph: CandidateGraph, sol: Solution, demand: ReadonlyMap<StuffKey, number>): Promise<WholeRuns> {
  const recipes = graph.recipes.filter((r) => (sol.runs.get(r.id) ?? 0) > 0);
  if (recipes.length === 0) return greedyWholeRuns(graph, sol, demand);
  const keys = new Set<StuffKey>(demand.keys());
  for (const r of recipes) for (const [key] of r.coeffs) keys.add(key);
  const goods = [...keys].sort();
  const rowOf = new Map(goods.map((key, g) => [key, g]));
  const buyKeys = goods.filter((key) => graph.goods.get(key)?.buyable === true);
  const firstBuy = recipes.length;
  const firstSink = firstBuy + buyKeys.length;
  const width = firstSink + goods.length;
  const entries = goods.map((): Array<[number, number]> => []);
  recipes.forEach((r, j) => {
    for (const [key, c] of r.coeffs) entries[rowOf.get(key) as number]!.push([j, c]);
  });
  buyKeys.forEach((key, i) => entries[rowOf.get(key) as number]!.push([firstBuy + i, 1]));
  const rows: LpRow[] = goods.map((key, g) => {
    const d = demand.get(key) ?? 0;
    return { lower: d, upper: d, entries: [...(entries[g] as Array<[number, number]>), [firstSink + g, -1]] };
  });
  const colCost = new Array<number>(width).fill(0);
  recipes.forEach((_, j) => {
    colCost[j] = RUN_WEIGHT;
  });
  buyKeys.forEach((key, i) => {
    colCost[firstBuy + i] = (graph.goods.get(key)?.cost ?? 0) + BUY_WEIGHT;
  });
  const result = await solveLp({
    sense: 'min', colCost, colLower: new Array<number>(width).fill(0), colUpper: new Array<number>(width).fill(Infinity), rows,
    integer: Array.from({ length: width }, (_, j) => j < firstSink), timeLimit: MIP_SECONDS,
  });
  if (result.status !== 'optimal') return greedyWholeRuns(graph, sol, demand);

  const runs = new Map<string, number>();
  recipes.forEach((r, j) => {
    const n = Math.round(result.x[j] ?? 0);
    if (n > 0) runs.set(r.id, n);
  });
  const buys = new Map<StuffKey, number>();
  buyKeys.forEach((key, i) => {
    const n = Math.round(result.x[firstBuy + i] ?? 0);
    if (n > 0) buys.set(key, n);
  });
  const leftovers: Product[] = [];
  goods.forEach((key, g) => {
    const left = round9(result.x[firstSink + g] ?? 0);
    if (left > TINY && graph.goods.get(key)?.virtual !== true) leftovers.push({ key, amount: left, chance: 1 });
  });
  return { runs: sortedById(runs), buys, leftovers, short: [] };
}

/**
 * The fallback of `wholeRuns`: every recipe with runs starts at its LP runs rounded up; then, up to 1000 times, the most
 * downstream good (ties by key) that cannot be bought and falls short (`Σ coefficient × runs − demand < 0`) gets enough
 * extra runs of one producer: one whose main output it is, then the one that yields most of it per run, then the
 * smallest id; so a short good is never topped up through a recipe that makes it only as a small chanced byproduct.
 * Going downstream first, a good outside a loop is topped up at most once; a loop (cells filled and emptied, a
 * catalyst) makes no progress for a good of it that falls short again by more than 1.5 times as much as before (that
 * good is left short), and as a whole after 8 top-ups per good in it (plus 8).
 * Buyable goods that fall short are bought, rounded up to whole items or whole litres; real goods left over are
 * `leftovers`; goods still short at the end (no producer, a loop left short, or the round cap) are `short`, so the
 * plan can say so (`chance: 1`, sorted by key). Virtual ore-dictionary goods are never leftovers.
 */
export function greedyWholeRuns(graph: CandidateGraph, sol: Solution, demand: ReadonlyMap<StuffKey, number>): WholeRuns {
  const byId = new Map(graph.recipes.map((r) => [r.id, r]));
  const producers = producersOf(graph.recipes);
  const { order, size } = downstreamOrder(graph.recipes);
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
  const yieldOf = (r: LpRecipe, key: StuffKey): number => r.coeffs.find(([k]) => k === key)?.[1] ?? 0;
  const topUps = new Map<number, number>();
  /** Loops (by place) that used up their top-ups, and goods of a loop whose deficit grew. */
  const stuck = new Set<number>();
  const stuckGoods = new Set<StuffKey>();
  /** The deficit each good of a loop had when it was last topped up. */
  const lastDeficit = new Map<StuffKey, number>();
  const placeOf = (key: StuffKey): number => order.get(key) ?? Number.MAX_SAFE_INTEGER;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let short: StuffKey | undefined;
    for (const [key, b] of balance) {
      if (b >= -TINY || buyable(key) || !producers.has(key) || stuck.has(placeOf(key)) || stuckGoods.has(key)) continue;
      if (short === undefined || placeOf(key) < placeOf(short) || (placeOf(key) === placeOf(short) && key < short)) short = key;
    }
    if (short === undefined) break;
    const place = placeOf(short);
    const done = (topUps.get(place) ?? 0) + 1;
    topUps.set(place, done);
    const deficit = -(balance.get(short) ?? 0);
    // In a loop, a good short again by at least as much as last time, or too many top-ups, means no progress.
    const inLoop = (size.get(place) ?? 1) > 1;
    const before = lastDeficit.get(short);
    if (inLoop && done > LOOP_TOP_UPS * (size.get(place) ?? 1) + LOOP_TOP_UPS) {
      stuck.add(place);   // a loop that does not close in whole runs
      continue;
    }
    if (inLoop && before !== undefined && deficit > before * GROWTH + TINY) {
      stuckGoods.add(short);   // topping it up only digs its loop deeper
      continue;
    }
    if (inLoop) lastDeficit.set(short, deficit);
    const key = short;
    const best = [...(producers.get(key) as LpRecipe[])].sort((a, b) => (
      Number(b.main === key) - Number(a.main === key) || yieldOf(b, key) - yieldOf(a, key) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    ))[0] as LpRecipe;
    addRuns(best, Math.max(1, Math.ceil(deficit / yieldOf(best, key) - TINY)));
  }

  const buys = new Map<StuffKey, number>();
  const leftovers: Product[] = [];
  const shortList: Product[] = [];
  for (const key of [...balance.keys()].sort()) {
    const b = balance.get(key) ?? 0;
    // Items are counted in items and fluids in litres, so both round up to a whole number.
    if (b < -TINY && buyable(key)) buys.set(key, Math.ceil(-b - TINY));
    else if (b < -TINY) shortList.push({ key, amount: round9(-b), chance: 1 });
    else if (b > TINY && graph.goods.get(key)?.virtual !== true) leftovers.push({ key, amount: round9(b), chance: 1 });
  }
  return { runs: sortedById(runs), buys, leftovers, short: shortList };
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
 * Make N on the group's machines (spec §3.2, prior-art §3.6). Each step runs on the machine the build-cost solve decided
 * for it (`Solution.machines`, plan 12: an owned option, else the one whose one new machine pays for itself against the
 * batch), else on the one `pickMachine` chooses with the group's owned machines (pseudo steps); owned machines are the
 * owned pools (`opts.build`'s, else `ownedPools`: the scan's and the "Machines we have" list's, none with "Reuse machines
 * we have" off, and a type in `settings.declineReuse` counts as not owned). An owned type gives the step all the owned
 * machines of that type (`count = owned`, `reused` with all its units, where they stand and the other steps of the type
 * in `sharedWith`), shared with the other steps of that type; any other type gets one new machine (`count 1, owned 0`, in
 * `addedMachines`), likewise shared — no sharing pool (`PlanStep.pool`): a batch already shares one machine per type, and
 * each step of a shared type says so: swap circuits or molds between batches, or on an Auto Workbench set its crafting
 * grid (controller ruling 177).
 * Pseudo machines (hand-crafting, crafting table, furnace) are never added. `totalSeconds` = the busiest machine type
 * (Σ work ÷ its machines) plus the fill time.
 */
export async function makeN(
  pack: Pack, graph: CandidateGraph, sol: Solution, demand: ReadonlyMap<StuffKey, number>,
  opts: {
    settings: PlanSettings; groupTier: number; coilHeat: number; ctx: PlanContext; multiblocks?: ReadonlySet<MachineId>;
    /** What the line's goods are worth and the pack's empty containers, for each step's main output (`StepLine`). */
    value?: Pick<StepLine, 'valueOf' | 'empties'>;
    /** The line's build model (plan 12): its owned pools. */
    build?: BuildModel;
  },
): Promise<MakeNResult> {
  const { settings, groupTier, coilHeat, ctx, multiblocks } = opts;
  const whole = await wholeRuns(graph, sol, demand);
  const pools: OwnedPools = opts.build?.pools ?? ownedPools(ctx, settings);
  const owned: ReadonlyMap<MachineId, number> = new Map([...pools].map(([id, units]) => [id, units.length]));
  const picked = pickStepMachines(pack, graph, whole.runs, { settings, groupTier, coilHeat, owned, multiblocks, machines: sol.machines });

  const ownedOf = (mteId: number): number => Math.max(0, owned.get(machineIdOfLegacy(mteId)) ?? 0);
  const machinesOf = (mteId: number): number => ownedOf(mteId) || 1;
  const stepsOfType = new Map<number, string[]>();
  const workOfType = new Map<number, number>();
  for (const p of picked) {
    const mteId = legacyMteId(p.pick.id);
    const ids = stepsOfType.get(mteId);
    if (ids === undefined) stepsOfType.set(mteId, [p.id]);
    else ids.push(p.id);
    workOfType.set(mteId, (workOfType.get(mteId) ?? 0) + workTicks(p));
  }
  let busiest = 0;
  for (const [mteId, ticks] of workOfType) busiest = Math.max(busiest, ticks / (machinesOf(mteId) * TICKS_PER_SECOND));
  const totalSeconds = busiest + fillSeconds(graph, whole.runs, picked, demand.keys());

  const line = stepLine(graph, whole.runs, opts.value);
  line.bought = boughtGoods(whole.buys);
  // What each step runs for, from the line's LP as for a rate (fix spec D13): rounding up to whole runs leaves goods
  // over that the line takes in full.
  const lp = stepLine(graph, sol.runs).runsFor;
  if (lp !== undefined) line.runsFor = lp;
  const steps = picked.map((p): PlanStep => {
    const mteId = legacyMteId(p.pick.id);
    const count = machinesOf(mteId);
    // A batch of machines that take no time at all has nothing to spread over; it reads 0 rather than NaN.
    const runsPerSecond = totalSeconds > 0 ? p.runs / totalSeconds : 0;
    const utilization = totalSeconds > 0 ? workTicks(p) / TICKS_PER_SECOND / (count * totalSeconds) : 0;
    const warnings = machineWarnings(p.lp, p.pick, runsPerSecond);
    const others = (stepsOfType.get(mteId) ?? []).filter((id) => id !== p.id);
    // Hand-crafting, a crafting table or a furnace has no circuit or mold to swap; an Auto Workbench is switched by
    // setting its 3x3 crafting grid (controller ruling 177).
    if (others.length > 0 && !PSEUDO_IDS.has(mteId)) {
      const swap = isAutoWorkbench(pack.machines.get(mteId)) ? 'set its crafting grid between batches' : 'swap circuits/molds between batches';
      warnings.push(`Shares machines with ${others.join(', ')} — ${swap}`);
    }
    if (p.recipe.outputs.some((o) => o.chance < 1)) warnings.push(CHANCED_WARNING);
    const size: StepSize = { count, owned: ownedOf(mteId), runsPerSecond, utilization, warnings };
    if (size.owned > 0) {
      const reused = reusedOf(pools, p.pick.id, Array.from({ length: size.owned }, (_, u) => u));
      if (others.length > 0) reused.sharedWith = [...others].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      size.reused = reused;
    }
    const step = describeStep(pack, p, line, size);
    step.runs = p.runs;
    return step;
  });

  const addedMachines = [...stepsOfType.keys()]
    .filter((mteId) => ownedOf(mteId) === 0 && !PSEUDO_IDS.has(mteId))
    .sort((a, b) => a - b)
    .map((mteId) => ({ mteId, count: 1 }));
  return { steps, buys: whole.buys, leftovers: whole.leftovers, totalSeconds, addedMachines, short: whole.short };
}
