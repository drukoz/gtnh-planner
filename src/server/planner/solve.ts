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

/**
 * Minimizes `cost` over the main rows plus `locks`; every column ≥ 0, purchases at most `buyUpper`, the recipe columns
 * in `off` fixed to 0.
 */
function minimize(lp: MainLp, cost: readonly number[], locks: readonly LpRow[], buyUpper = Infinity, off: ReadonlySet<number> = new Set()): Promise<LpResult> {
  const width = cost.length;
  const colUpper = new Array<number>(width).fill(Infinity).fill(buyUpper, lp.firstBuy, lp.firstSink);
  for (const j of off) colUpper[j] = 0;
  return solveLp({ sense: 'min', colCost: [...cost], colLower: new Array<number>(width).fill(0), colUpper, rows: [...lp.rows, ...locks] });
}

/** Branch-and-bound nodes the fewest-recipes MIP may use (Good Electronic Circuit at HV: optimal in well under 1,000). */
const S3_MAX_NODES = 5000;
/** A recipe left in by the MIP may run at most this many times the largest run count of the least-raw plan. */
const S3_BIG_M = 10;

/**
 * S3 (prior-art §3.4 step 4: fewest distinct recipes, for simpler lines) as the MILP the prior art suggests: one binary
 * per step recipe, `runs ≤ M × binary`, minimizing the binaries within `locks`. Returns the recipe columns it leaves
 * out, or null when it finds no whole solution (then `fewestRecipes` approximates it).
 */
async function fewestRecipesMip(lp: MainLp, s1: readonly number[], locks: readonly LpRow[]): Promise<Set<number> | null> {
  const steps: number[] = [];
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe') steps.push(j);
  });
  let largest = 0;
  for (const j of steps) largest = Math.max(largest, s1[j] ?? 0);
  if (steps.length === 0 || largest <= TINY) return null;
  const width = lp.rawCost.length;
  const bigM = largest * S3_BIG_M;
  const rows: LpRow[] = [...lp.rows, ...locks, ...steps.map((j, k): LpRow => ({ lower: -Infinity, upper: 0, entries: [[j, 1], [width + k, -bigM]] }))];
  const all = width + steps.length;
  const result = await solveLp({
    sense: 'min', colCost: new Array<number>(all).fill(0).fill(1, width), colLower: new Array<number>(all).fill(0),
    colUpper: new Array<number>(all).fill(Infinity).fill(1, width), rows,
    integer: new Array<boolean>(all).fill(false).fill(true, width), maxNodes: S3_MAX_NODES,
  });
  if (result.status !== 'optimal' && result.status !== 'feasible') return null;
  const off = new Set<number>();
  steps.forEach((j, k) => {
    if ((result.x[width + k] ?? 0) < 0.5) off.add(j);
  });
  return off;
}

/** Rounds of the fewest-recipes stage. */
const S3_ROUNDS = 4;
/** A recipe's weight in the fewest-recipes stage is 1 / (its runs in the round before + this × the largest runs). */
const S3_DELTA = 1e-6;

/**
 * S3 (prior-art §3.4 step 4: fewer distinct recipes, for simpler lines), as reweighted L1 instead of a MILP: each round
 * minimizes Σ runs_r / (runs_r of the round before + δ) within `locks`, so a recipe that ran little is pushed out when
 * the least raw material does not need it. On the real export the least raw material is often reached by many plans
 * (free water, air and cobblestone, cell fill/empty pairs, three cutting-saw variants), and power alone then picked
 * mixtures such as two electrolysis variants of the same salt water. Returns the recipe columns the plan no longer uses,
 * or null when no round solves.
 */
async function fewestRecipes(lp: MainLp, locks: readonly LpRow[]): Promise<Set<number> | null> {
  const step = lp.recipes.map((r) => r.kind === 'recipe');   // ore-dictionary conversions are not steps
  let x: readonly number[] | null = null;
  let solved = false;
  for (let round = 0; round < S3_ROUNDS; round++) {
    let largest = 0;
    if (x !== null) for (let j = 0; j < lp.firstBuy; j++) largest = Math.max(largest, x[j] ?? 0);
    const delta = largest * S3_DELTA;
    const prev = x;
    // The first round weighs every step 1 (least total runs); later ones 1 / (runs before + δ).
    const cost = lp.canonical.map((_, j) => (j >= lp.firstBuy || step[j] !== true ? 0 : prev === null ? 1 : 1 / ((prev[j] ?? 0) + delta + TINY)));
    const result = await minimize(lp, cost, locks);
    if (result.status !== 'optimal') break;
    x = result.x;
    solved = true;
  }
  if (!solved) return null;
  const off = new Set<number>();
  for (let j = 0; j < lp.firstBuy; j++) if (((x as readonly number[])[j] ?? 0) <= TINY) off.add(j);
  return off;
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

/** Recipe columns that consume nothing: sources (rock breakers, ponds, farms), never part of a loop. */
function sourceColumns(lp: MainLp): Set<number> {
  const sources = new Set<number>();
  lp.recipes.forEach((r, j) => {
    if (r.coeffs.every(([, c]) => c >= 0)) sources.add(j);
  });
  return sources;
}

/**
 * The loop guard. A line that needs no raw material at all either runs on sources (recipes that consume nothing, free
 * goods made by them) or on a loop in the data that makes matter from nothing (x → 2 y, y → x). It is a loop when the
 * demand can still be met with every purchase and every source fixed to 0; then the loop is the least-runs steady state
 * that, again without purchases or sources and with no demand, leaves any surplus at all: only the loop's own recipes,
 * not the recipes that turn its output into the target, nor recipes that merely share a no-gain cycle with it (cells
 * filled and emptied). On the real export the old rule (every used recipe on any cycle) banned 58 recipes for an
 * Electronic Circuit, the salt water mixer and cell canners among them, because the Eye of Harmony (a source) ran.
 */
async function freeLoop(lp: MainLp): Promise<LpRecipe[]> {
  const sources = sourceColumns(lp);
  const runsOnly = lp.canonical.map((_, j) => (j < lp.firstBuy ? 1 : 0));
  const fromNothing = await minimize(lp, runsOnly, [], 0, sources);
  if (fromNothing.status === 'error') throw new Error('rate solver: the loop-guard LP failed');
  if (fromNothing.status !== 'optimal') return [];
  const width = lp.rawCost.length;
  const surplus: LpRow = { lower: 1, upper: Infinity, entries: lp.goods.map((_, g): [number, number] => [lp.firstSink + g, 1]) };
  const colUpper = new Array<number>(width).fill(Infinity).fill(0, lp.firstBuy, lp.firstSink);
  for (const j of sources) colUpper[j] = 0;
  const circulation = await solveLp({
    sense: 'min', colCost: runsOnly, colLower: new Array<number>(width).fill(0), colUpper,
    rows: [...lp.rows.map((row) => ({ ...row, lower: 0, upper: 0 })), surplus],
  });
  if (circulation.status === 'error') throw new Error('rate solver: the loop-guard LP failed');
  const x = circulation.status === 'optimal' ? circulation.x : fromNothing.x;   // rounding hid the loop: name every used recipe
  return lp.recipes.filter((_, j) => (x[j] ?? 0) > TINY);
}

/** The least raw material without the recipes S3 leaves out may exceed S1 by this much (relative) for S3 to stand. */
const S3_TOLERANCE = 1e-6;

/**
 * S3 and the lock the later stages keep. The MIP's big-M lets a recipe it leaves out still run a tiny amount (its
 * binary sits just above 0), so the least raw material is solved again without the left-out recipes: within
 * `S3_TOLERANCE` of S1 the stages lock that instead, else S3 is dropped (and approximated without a MIP).
 */
async function simplest(lp: MainLp, s1: LpResult, locks: LpRow[]): Promise<{ off: Set<number>; locks: LpRow[] }> {
  const candidates = [await fewestRecipesMip(lp, s1.x, locks), await fewestRecipes(lp, locks)];
  for (const off of candidates) {
    if (off === null || off.size === 0) continue;
    const again = await minimize(lp, lp.rawCost, [], Infinity, off);
    if (again.status === 'optimal' && again.objective <= s1.objective * (1 + S3_TOLERANCE) + TINY) {
      return { off, locks: lockRow(lp.rawCost, Math.max(again.objective, s1.objective)) };
    }
  }
  return { off: new Set(), locks };
}

/** S3, S2 and S4 on top of an optimal S1, then the rounded maps. */
async function finish(lp: MainLp, s1: LpResult, warnings: PlanWarning[]): Promise<Solution> {
  // S3, S2 and S4 only break ties: a stage that does not solve (numerically, or S2 unbounded by a recipe with negative
  // EU) keeps the previous stage's plan, which already uses the least raw material. S3 runs before power, so power
  // never picks a longer chain among equally cheap ones; the later stages keep to the recipes S3 left.
  let best = s1;
  const open = lockRow(lp.rawCost, s1.objective);
  const { off, locks } = await simplest(lp, s1, open);
  const s2 = await minimize(lp, lp.power, locks, Infinity, off);
  if (s2.status === 'optimal') {
    best = s2;
    locks.push(...lockRow(lp.power, s2.objective));
  }
  const s4 = await minimize(lp, lp.canonical, locks, Infinity, off);
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
 * The cheapest steady state that meets `demand` (per unit of time): S1 least raw material (spec §3.3), S3 as few recipes
 * as that allows (`simplest`), S2 least power among those, S4 the least total of runs, purchases and sinks (canonical).
 * After S1 the loop guard may ban recipes that make matter from nothing and start again, 5 times at most: then one
 * `free-loop` warning names what it left out (`banned`). When the solve after the fifth ban still finds such a loop, the
 * line is `infeasible` with one warning: there is no honest way to make the targets from these recipes, and the plan
 * never shows one that makes something from nothing (Review Focus #4). Infeasible → the goods that block it, unless the
 * graph was cut short (`truncated`): goods it never walked look unmakeable there, so it names none.
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

/**
 * The least raw material that makes one unit of each of `keys` on its own in `graph`: S1 of the main LP with that one
 * demand and every byproduct sunk, no recipe consuming a good of `notInputs` (the line's target). It is what buying the
 * good instead of making it should cost, without the arbitrary split of a recipe's cost between its co-products that
 * the cost analysis (costs.ts) makes (pyrolysis there priced charcoal at 0 and gave the whole log to its wood gas).
 * Infinity when only a chain through `notInputs` makes the good (Magnetic Steel from the Steel target); undefined when
 * the graph cannot make it at all.
 */
export async function standaloneCosts(
  graph: CandidateGraph, keys: readonly StuffKey[], notInputs: readonly StuffKey[] = [],
): Promise<Map<StuffKey, number | undefined>> {
  const out = new Map<StuffKey, number | undefined>();
  if (keys.length === 0) return out;
  const lp = mainLp(graph, graph.recipes, new Map());
  const rowOf = new Map(lp.goods.map((key, g) => [key, g]));
  const width = lp.rawCost.length;
  const barredKeys = new Set(notInputs);
  const barred = new Set<number>();
  lp.recipes.forEach((r, j) => {
    if (r.coeffs.some(([key, c]) => c < 0 && barredKeys.has(key))) barred.add(j);
  });
  const solve = (g: number, off: ReadonlySet<number>): Promise<LpResult> => {
    const colUpper = new Array<number>(width).fill(Infinity);
    for (const j of off) colUpper[j] = 0;
    const rows = lp.rows.map((row, i) => (i === g ? { ...row, lower: 1, upper: 1 } : row));
    return solveLp({ sense: 'min', colCost: [...lp.rawCost], colLower: new Array<number>(width).fill(0), colUpper, rows });
  };
  for (const key of keys) {
    const g = rowOf.get(key);
    if (g === undefined) {
      out.set(key, undefined);
      continue;
    }
    const result = await solve(g, barred);
    if (result.status === 'optimal') out.set(key, Math.max(0, result.objective));
    else if (barred.size > 0 && (await solve(g, new Set())).status === 'optimal') out.set(key, Infinity);
    else out.set(key, undefined);
  }
  return out;
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
