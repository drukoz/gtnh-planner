// The rate solver (spec §3.3, prior-art §3.4 steps 3, 4 and 7): the main LP in extent form, solved in lexicographic
// stages (least raw material, then power as a tie-break only, then a canonical form), a guard against recipe data loops
// that make matter from nothing, and the goods that block a target nothing reachable can make, for plain-words warnings.

import type { StuffKey } from '../../shared/keys.ts';
import type { PlanWarning } from '../../shared/types/plan.ts';
import type { CandidateGraph, LpRecipe } from './candidates.ts';
import { solveLp, type LpResult, type LpRow } from './lp.ts';

export interface Blocker { key: StuffKey; reason: 'unavailable' | 'rejected' | 'no-recipe'; needTier?: number }
/**
 * The maps hold only values above 1e-9, rounded to 9 decimal places (so an exact 1 stays 1 and equal plans compare
 * equal), inserted in sorted key order; `rawCost` is rounded the same way. An infeasible solution has empty maps.
 */
export interface Solution {
  status: 'ok' | 'infeasible';
  /** Recipe id (convert ids included) → runs per unit of demand time. */
  runs: Map<string, number>;
  buys: Map<StuffKey, number>;
  sinks: Map<StuffKey, number>;
  /** Σ cost × buy. */
  rawCost: number;
  blockers: Blocker[];
  warnings: PlanWarning[];
  // optional addition
  /** Ids of the recipes the loop guard left out, in the order it did; planLine names them. */
  banned?: string[];
}

/** Values up to this count as zero: they never reach the maps, and a loop-guard run below it uses no recipe. */
const TINY = 1e-9;
const MAX_LOOP_ROUNDS = 5;
const MAX_BLOCKERS = 5;
/** A free-loop warning names this many recipes, then counts the rest. */
export const MAX_NAMED_LOOP_RECIPES = 5;
/** The loop guard can only succeed when S1 needs no raw material at all, so it runs only for an S1 up to this. */
const ZERO_RAW = 1e-6;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0. */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The main LP (prior-art §3.4 step 3). Columns: one run count per recipe by id, then one purchase per buyable good by
 * key, then one sink per good by key; one row per good by key, `Σ a_rg·x_r + buy_g − sink_g = demand_g`. The goods are
 * the whole graph's, so banning a recipe drops only its column.
 */
interface MainLp {
  recipes: LpRecipe[]; buyKeys: StuffKey[]; goods: StuffKey[];
  firstBuy: number; firstSink: number; rows: LpRow[];
  /** Per column: cost × buy (S1), EU per run (S2), and 1 on every column (S4). */
  rawCost: number[]; power: number[]; canonical: number[];
}

function mainLp(graph: CandidateGraph, recipes: readonly LpRecipe[], demand: ReadonlyMap<StuffKey, number>): MainLp {
  const keys = new Set<StuffKey>([...graph.goods.keys(), ...demand.keys()]);
  for (const r of graph.recipes) for (const [key] of r.coeffs) keys.add(key);
  const goods = [...keys].sort(byString);
  const rowOf = new Map(goods.map((key, g) => [key, g]));
  const sorted = [...recipes].sort((a, b) => byString(a.id, b.id));
  const buyKeys = goods.filter((key) => graph.goods.get(key)?.buyable === true);
  const firstBuy = sorted.length;
  const firstSink = firstBuy + buyKeys.length;
  const width = firstSink + goods.length;

  const entries = goods.map((): Array<[number, number]> => []);
  const rowEntries = (key: StuffKey): Array<[number, number]> => entries[rowOf.get(key) as number] as Array<[number, number]>;
  sorted.forEach((r, j) => {
    for (const [key, c] of r.coeffs) rowEntries(key).push([j, c]);
  });
  buyKeys.forEach((key, i) => rowEntries(key).push([firstBuy + i, 1]));
  const rows = goods.map((key, g): LpRow => {
    const d = demand.get(key) ?? 0;
    return { lower: d, upper: d, entries: [...(entries[g] as Array<[number, number]>), [firstSink + g, -1]] };
  });

  const rawCost = new Array<number>(width).fill(0);
  buyKeys.forEach((key, i) => {
    rawCost[firstBuy + i] = graph.goods.get(key)?.cost ?? 0;
  });
  const power = new Array<number>(width).fill(0);
  sorted.forEach((r, j) => {
    power[j] = r.euPerRun;
  });
  return { recipes: sorted, buyKeys, goods, firstBuy, firstSink, rows, rawCost, power, canonical: new Array<number>(width).fill(1) };
}

/** Minimizes `cost` over the main rows plus `locks`; every column ≥ 0, purchases at most `buyUpper`. */
function minimize(lp: MainLp, cost: readonly number[], locks: readonly LpRow[], buyUpper = Infinity): Promise<LpResult> {
  const width = cost.length;
  return solveLp({
    sense: 'min', colCost: [...cost], colLower: new Array<number>(width).fill(0),
    colUpper: new Array<number>(width).fill(Infinity).fill(buyUpper, lp.firstBuy, lp.firstSink),
    rows: [...lp.rows, ...locks],
  });
}

/**
 * `Σ cost·column ≤ value`, so the next stage keeps this stage's optimum (no row when the cost is all 0). The lock has no
 * slack: with `value × (1 + 1e-9) + 1e-9` S2 buys that much more raw material to save power (a hammer-crafted plate at
 * 0 EU instead of a bent one), which the 9-decimal maps then show. HiGHS's own feasibility tolerance keeps the locked
 * stage feasible, and a stage that still does not solve keeps the previous stage's plan (`finish`).
 */
function lockRow(cost: readonly number[], value: number): LpRow[] {
  const entries = cost.flatMap((c, j): Array<[number, number]> => (c === 0 ? [] : [[j, c]]));
  return entries.length === 0 ? [] : [{ lower: -Infinity, upper: value, entries }];
}

/** The values of `keys` (columns from `first` on) above TINY once rounded; the keys are already in sorted order. */
function kept(keys: readonly string[], x: readonly number[], first: number): Map<string, number> {
  const out = new Map<string, number>();
  keys.forEach((key, i) => {
    const value = round9(x[first + i] ?? 0);
    if (value > TINY) out.set(key, value);
  });
  return out;
}

/**
 * The used recipes that make matter from nothing: each one that consumes nothing, and each one on a cycle among the
 * used recipes (it makes a good another used recipe consumes, and so on back to it). Recipes downstream of such a loop
 * only turn its output into the target; they are not the loop and stay.
 */
function matterFromNothing(used: readonly LpRecipe[]): LpRecipe[] {
  const consumers = new Map<StuffKey, number[]>();
  used.forEach((r, i) => {
    for (const [key, c] of r.coeffs) if (c < 0) pushTo(consumers, key, i);
  });
  const next = used.map((r) => [...new Set(r.coeffs.flatMap(([key, c]) => (c > 0 ? consumers.get(key) ?? [] : [])))]);
  const onCycle = (start: number): boolean => {
    const seen = new Set<number>();
    const stack = [...(next[start] as number[])];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if (i === start) return true;
      if (seen.has(i)) continue;
      seen.add(i);
      for (const j of next[i] as number[]) stack.push(j);
    }
    return false;
  };
  return used.filter((r, i) => r.coeffs.every(([, c]) => c >= 0) || onCycle(i));
}

/**
 * The loop guard: the same rows with every purchase fixed to 0 (free goods too), using as few runs as it can. When that
 * still meets the demand, the line makes matter from nothing, and this returns the recipes that do it (every used one
 * when rounding hides the loop among them); otherwise none.
 */
async function freeLoop(lp: MainLp): Promise<LpRecipe[]> {
  const runsOnly = lp.canonical.map((_, j) => (j < lp.firstBuy ? 1 : 0));
  const result = await minimize(lp, runsOnly, [], 0);
  if (result.status === 'error') throw new Error('rate solver: the loop-guard LP failed');
  if (result.status !== 'optimal') return [];
  const used = lp.recipes.filter((_, j) => (result.x[j] ?? 0) > TINY);
  const loop = matterFromNothing(used);
  return loop.length > 0 ? loop : used;
}

/** S2 and S4 on top of an optimal S1, then the rounded maps. */
async function finish(lp: MainLp, s1: LpResult, warnings: PlanWarning[]): Promise<Solution> {
  // S2 and S4 only break ties: a stage that does not solve (numerically, or S2 unbounded by a recipe with negative EU)
  // keeps the previous stage's plan, which already uses the least raw material.
  let best = s1;
  const locks = lockRow(lp.rawCost, s1.objective);
  const s2 = await minimize(lp, lp.power, locks);
  if (s2.status === 'optimal') {
    best = s2;
    locks.push(...lockRow(lp.power, s2.objective));
  }
  const s4 = await minimize(lp, lp.canonical, locks);
  if (s4.status === 'optimal') best = s4;

  let rawCost = 0;
  lp.rawCost.forEach((c, j) => {
    rawCost += c * (best.x[j] ?? 0);
  });
  return {
    status: 'ok',
    runs: kept(lp.recipes.map((r) => r.id), best.x, 0),
    buys: kept(lp.buyKeys, best.x, lp.firstBuy),
    sinks: kept(lp.goods, best.x, lp.firstSink),
    rawCost: round9(rawCost), blockers: [], warnings,
  };
}

/** The ids of `ids`, at most MAX_NAMED_LOOP_RECIPES of them and a count of the rest. */
function cappedList(ids: readonly string[]): string {
  const shown = ids.slice(0, MAX_NAMED_LOOP_RECIPES).join(', ');
  return ids.length > MAX_NAMED_LOOP_RECIPES ? `${shown} and ${ids.length - MAX_NAMED_LOOP_RECIPES} more` : shown;
}

/**
 * The cheapest steady state that meets `demand` (per unit of time): S1 least raw material (spec §3.3), S2 least power among
 * those, S4 the least total of runs, purchases and sinks (canonical). After S1 the loop guard may ban recipes that make
 * matter from nothing and start again, 5 times at most: then one `free-loop` warning names what it left out (`banned`).
 * When the solve after the fifth ban still finds such a loop, the line is `infeasible` with one warning: there is no
 * honest way to make the targets from these recipes, and the plan never shows one that makes something from nothing
 * (Review Focus #4). Infeasible → the goods that block it, unless the graph was cut short (`truncated`): goods it never walked
 * look unmakeable there, so it names none.
 */
export async function solveLine(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>): Promise<Solution> {
  const banned: string[] = [];
  const bannedSet = new Set<string>();
  const loopWarnings = (): PlanWarning[] => (banned.length === 0 ? [] : [{
    code: 'free-loop',
    text: `Ignored ${banned.length === 1 ? '1 recipe' : `${banned.length} recipes`} that make ${graph.targets.join(', ')} from nothing (likely a recipe data loop): ${cappedList(banned)}`,
  }]);
  const infeasible = (blockers: Blocker[], warnings: PlanWarning[]): Solution => ({
    status: 'infeasible', runs: new Map(), buys: new Map(), sinks: new Map(), rawCost: 0, blockers, warnings, banned: [...banned],
  });
  for (let round = 0; ; round++) {
    const recipes = graph.recipes.filter((r) => !bannedSet.has(r.id));
    const lp = mainLp(graph, recipes, demand);
    const s1 = await minimize(lp, lp.rawCost, []);
    if (s1.status === 'error') throw new Error('rate solver: the raw-material LP failed');
    // Costs are ≥ 0, so S1 is bounded below: an "unbounded or infeasible" answer can only mean infeasible.
    if (s1.status !== 'optimal') {
      return infeasible(graph.truncated === true ? [] : findBlockers({ ...graph, recipes }), loopWarnings());
    }
    const loop = s1.objective <= ZERO_RAW ? await freeLoop(lp) : [];
    if (loop.length === 0) {
      const done = await finish(lp, s1, loopWarnings());
      done.banned = [...banned];
      return done;
    }
    if (round >= MAX_LOOP_ROUNDS) {
      return infeasible([], [{
        code: 'free-loop',
        text: `No honest way to make ${graph.targets.join(', ')} here: every plan the recipes allow makes it from nothing (likely recipe data loops), even after leaving out ${cappedList(banned)}`,
      }]);
    }
    for (const r of loop) {
      if (bannedSet.has(r.id)) continue;
      bannedSet.add(r.id);
      banned.push(r.id);
    }
  }
}

/** Forward fixpoint: buyable goods are makeable; a recipe fires once every good it consumes is; its outputs then are. */
function makeableGoods(graph: CandidateGraph): Set<StuffKey> {
  const makeable = new Set<StuffKey>();
  const queue: StuffKey[] = [];
  const add = (key: StuffKey): void => {
    if (!makeable.has(key)) {
      makeable.add(key);
      queue.push(key);
    }
  };
  const fire = (r: LpRecipe): void => {
    for (const [key, c] of r.coeffs) if (c > 0) add(key);
  };
  /** Consumed goods per recipe not yet makeable (each key appears once in `coeffs`). */
  const waiting = graph.recipes.map((r) => r.coeffs.filter(([, c]) => c < 0).length);
  const consumers = new Map<StuffKey, number[]>();
  graph.recipes.forEach((r, j) => {
    for (const [key, c] of r.coeffs) if (c < 0) pushTo(consumers, key, j);
  });

  for (const [key, good] of graph.goods) if (good.buyable) add(key);
  graph.recipes.forEach((r, j) => {
    if (waiting[j] === 0) fire(r);
  });
  for (let i = 0; i < queue.length; i++) {
    for (const j of consumers.get(queue[i] as StuffKey) ?? []) {
      const left = (waiting[j] as number) - 1;
      waiting[j] = left;
      if (left === 0) fire(graph.recipes[j] as LpRecipe);
    }
  }
  return makeable;
}

function blockerFor(graph: CandidateGraph, key: StuffKey): Blocker {
  if (graph.goods.get(key)?.leafClass === 'unavailable') return { key, reason: 'unavailable' };
  const rejected = graph.blocked.get(key);
  if (rejected === undefined) return { key, reason: 'no-recipe' };
  const tiers = rejected.flatMap((b) => (b.needTier === undefined ? [] : [b.needTier]));
  return tiers.length > 0 ? { key, reason: 'rejected', needTier: Math.min(...tiers) } : { key, reason: 'rejected' };
}

/**
 * Why the targets cannot be made. Each target the makeable fixpoint misses is walked on its own, through the producers of
 * the goods the fixpoint misses. A good it misses is a blocker when it has no producer in the graph or is a base
 * material out of reach (`leafClass` 'unavailable'); the walk does not go past a blocker. A walk that finds none only
 * met goods on no-gain cycles (ingot <-> block, nugget or molten), so its blockers are the goods it visited that have a
 * `blocked` entry, or else the target itself. Reasons: `unavailable`, else `rejected` (its recipes cannot run here;
 * `needTier` is the lowest tier one of them names), else `no-recipe`. All targets together, sorted by key, at most 5.
 */
export function findBlockers(graph: CandidateGraph): Blocker[] {
  const makeable = makeableGoods(graph);
  const producers = new Map<StuffKey, LpRecipe[]>();
  for (const r of graph.recipes) for (const [key, c] of r.coeffs) if (c > 0) pushTo(producers, key, r);

  const blockers = new Map<StuffKey, Blocker>();
  for (const target of new Set(graph.targets)) {
    if (makeable.has(target)) continue;
    const seen = new Set<StuffKey>();
    const found: StuffKey[] = [];
    const stack = [target];
    while (stack.length > 0) {
      const key = stack.pop() as StuffKey;
      if (seen.has(key)) continue;
      seen.add(key);
      const made = producers.get(key) ?? [];
      if (made.length === 0 || graph.goods.get(key)?.leafClass === 'unavailable') {
        found.push(key);
        continue;
      }
      for (const r of made) {
        for (const [input, c] of r.coeffs) if (c < 0 && !makeable.has(input) && !seen.has(input)) stack.push(input);
      }
    }
    const named = found.length > 0 ? found : [...seen].filter((key) => graph.blocked.has(key));
    for (const key of named.length > 0 ? named : [target]) blockers.set(key, blockerFor(graph, key));
  }
  return [...blockers.values()].sort((a, b) => byString(a.key, b.key)).slice(0, MAX_BLOCKERS);
}
