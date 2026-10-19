// The rate solver (spec §3.3, prior-art §3.4 steps 3, 4 and 7): the main LP in extent form, solved in lexicographic
// stages (least raw material, then power as a tie-break only, then a canonical form), a guard against recipe data loops
// that make matter from nothing, and the goods that block a target nothing reachable can make, for plain-words warnings.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanWarning } from '../../shared/types/plan.ts';
import type { CandidateGraph, LpRecipe } from './candidates.ts';
import { solveLp, type LpResult, type LpRow } from './lp.ts';
import { sig9 } from './round.ts';

export interface Blocker { key: StuffKey; reason: 'unavailable' | 'rejected' | 'no-recipe'; needTier?: number }
/**
 * The maps hold only values above 1e-9 per unit of the largest demand (the stages solve at unit demand, `solveLine`),
 * scaled to the demand and kept to 9 significant digits (`sig9`: an exact 1 stays 1 and equal plans compare equal),
 * inserted in sorted key order; `rawCost` and `leastRawCost` likewise. An infeasible solution has empty maps and costs 0.
 */
export interface Solution {
  status: 'ok' | 'infeasible';
  /** Recipe id (convert ids included) → runs per unit of demand time. */
  runs: Map<string, number>;
  buys: Map<StuffKey, number>;
  sinks: Map<StuffKey, number>;
  /** Σ cost × buy. */
  rawCost: number;
  /** The least raw material any plan of this graph needs (S1), never above `rawCost`: what the later stages trade. */
  leastRawCost: number;
  blockers: Blocker[];
  warnings: PlanWarning[];
  // optional addition
  /** Ids of the recipes the loop guard left out, in the order it did; planLine names them. */
  banned?: string[];
}

/**
 * Values up to this count as zero (at unit demand: per unit of the largest demand): they never reach the maps, and a
 * loop-guard run below it uses no recipe.
 */
const TINY = 1e-9;
/**
 * A stage balances a good when `|Σ a·x − d| ≤ RESIDUAL_ABS + RESIDUAL_REL × max(|d|, max |a·x|)` at unit demand
 * (`residualViolations`); HiGHS's absolute tolerances can leave more, and a stage that does not balance is not used.
 */
export const RESIDUAL_REL = 1e-6;
export const RESIDUAL_ABS = 1e-9;
const MAX_LOOP_ROUNDS = 5;
const MAX_BLOCKERS = 5;
/** A free-loop warning names this many recipes, then counts the rest. */
export const MAX_NAMED_LOOP_RECIPES = 5;
/** The loop guard can only succeed when S1 needs no raw material at all, so it runs only for an S1 up to this. */
const ZERO_RAW = 1e-6;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  /**
   * Per column: cost × buy (S1), EU per run (S2), and 1 on every column (S4), but 1 + the recipes of its chain for buying
   * a derived leaf (`GoodInfo.steps`): among plans equal in everything else the one that buys Steel for its rods is
   * simpler than the one that buys Magnetic Steel (steel, then a polarizer).
   */
  rawCost: number[]; power: number[]; canonical: number[];
  /**
   * Per column, the free input (water, air, cobblestone, lava) one unit of it takes: 1 for buying a free good, what the
   * chain of a bought derived leaf takes per unit (`GoodInfo.free`), else 0. The fewest-recipes stage breaks its ties
   * by it.
   */
  free: number[];
  /** Per column, the recipes of a bought derived leaf's chain (`GoodInfo.steps`, at least 1); 0 for other columns. */
  derivedSteps: number[];
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
  const canonical = new Array<number>(width).fill(1);
  const free = new Array<number>(width).fill(0);
  const derivedSteps = new Array<number>(width).fill(0);
  buyKeys.forEach((key, i) => {
    const good = graph.goods.get(key);
    if (good?.leafClass === 'free') free[firstBuy + i] = 1;
    if (good?.leafClass !== 'derived') return;
    derivedSteps[firstBuy + i] = Math.max(1, good.steps ?? 1);
    canonical[firstBuy + i] = 1 + (derivedSteps[firstBuy + i] as number);
    free[firstBuy + i] = good.free ?? 0;
  });
  return { recipes: sorted, buyKeys, goods, firstBuy, firstSink, rows, rawCost, power, canonical, free, derivedSteps };
}

/**
 * Minimizes `cost` over the main rows plus `locks`; every column ≥ 0, purchases at most `buyUpper`, the columns in
 * `off` (recipes, or purchases the fewest-recipes stage left out) fixed to 0.
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
 * The fewest-recipes stage (S3) first finds the fewest recipes, then, among the plans with that many, takes the one
 * with the least weighted sum of the free input (water, air, cobblestone, lava, and what the chains of bought derived
 * leaves take), the power (what S2 would pick) and the chains of the derived leaves it buys. The weights below are
 * scaled to what the least-raw plan takes, so their order is by weight, not strict (a line of very high power weighs a
 * difference in power less). On the real export a free input is often tied with another (oxygen from 10,000 L of air
 * in a centrifuge, or from 3,000 L of water in an electrolyzer; Helium for the blast furnace, distilled from 1,000 L of
 * air per litre), and recipes of one count with another (Steel or Magnetic Steel, steel and a polarizer, extruded into
 * rods); without these S3 picked among them at random and power then kept the pick.
 */
const S3_FREE_SHARE = 1e-3;
const S3_POWER_SHARE = 1e-5;
/** Per recipe of a bought derived leaf's chain. */
const S3_DERIVED_STEP = 1e-7;

/** The continuous S3 tie-breaks per column (free input, then power), scaled to the least-raw plan `x`. */
function tieBreaks(lp: MainLp, x: readonly number[]): number[] {
  let free = 0;
  let power = 0;
  for (let j = 0; j < lp.rawCost.length; j++) {
    free += (lp.free[j] ?? 0) * (x[j] ?? 0);
    power += (lp.power[j] ?? 0) * (x[j] ?? 0);
  }
  const perFree = S3_FREE_SHARE / Math.max(1, free);
  const perPower = S3_POWER_SHARE / Math.max(1, power);
  return lp.rawCost.map((_, j) => (lp.free[j] ?? 0) * perFree + Math.max(0, lp.power[j] ?? 0) * perPower);
}

/**
 * S3 (prior-art §3.4 step 4: fewest distinct recipes, for simpler lines) as the MILP the prior art suggests: one binary
 * per step recipe, `runs ≤ M × binary`, minimizing the binaries within `locks`. M is `S3_BIG_M` × the largest run count
 * of the least-raw plan, so a plan that would run a recipe more than that is not looked at (`simplest` checks what
 * comes out). A second MIP keeps the count found (Σ binaries ≤ it) and minimizes the tie-breaks above; a derived
 * purchase with a price gets a binary there, its M exact (what the raw-material lock lets the line buy of it); one
 * that costs nothing is weighed by its free input only. Returns the columns left out, or null when the first MIP finds
 * no whole solution (then `fewestRecipes` approximates it); the first MIP's when the second finds none.
 */
async function fewestRecipesMip(lp: MainLp, s1: LpResult, locks: readonly LpRow[]): Promise<Set<number> | null> {
  let largest = 0;
  for (let j = 0; j < lp.firstBuy; j++) largest = Math.max(largest, s1.x[j] ?? 0);
  if (largest <= TINY) return null;
  const width = lp.rawCost.length;
  const steps: Array<{ j: number; weight: number; bigM: number }> = [];
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe') steps.push({ j, weight: 1, bigM: largest * S3_BIG_M });
  });
  if (steps.length === 0) return null;
  const derived: Array<{ j: number; weight: number; bigM: number }> = [];
  lp.derivedSteps.forEach((n, j) => {
    const cost = lp.rawCost[j] ?? 0;
    if (n > 0 && cost > 0) derived.push({ j, weight: S3_DERIVED_STEP * n, bigM: (s1.objective / cost) * (1 + S3_TOLERANCE) + TINY });
  });
  /** One MIP over `counted` binaries (`column ≤ M × binary`), with `extra` rows over the binaries (k = their index). */
  const solve = (counted: typeof steps, colCost: number[], extra: LpRow[]): Promise<LpResult> => {
    const rows: LpRow[] = [...lp.rows, ...locks, ...counted.map((c, k): LpRow => ({ lower: -Infinity, upper: 0, entries: [[c.j, 1], [width + k, -c.bigM]] })), ...extra];
    const all = width + counted.length;
    return solveLp({
      sense: 'min', colCost, colLower: new Array<number>(all).fill(0), colUpper: new Array<number>(all).fill(Infinity).fill(1, width), rows,
      integer: new Array<boolean>(all).fill(false).fill(true, width), maxNodes: S3_MAX_NODES,
    });
  };
  const offOf = (counted: typeof steps, x: readonly number[]): Set<number> => {
    const off = new Set<number>();
    counted.forEach((c, k) => {
      if ((x[width + k] ?? 0) < 0.5) off.add(c.j);
    });
    return off;
  };
  const found = (r: LpResult): boolean => r.status === 'optimal' || r.status === 'feasible';
  const fewest = await solve(steps, [...new Array<number>(width).fill(0), ...steps.map((c) => c.weight)], []);
  if (!found(fewest)) return null;
  let count = 0;
  steps.forEach((_, k) => {
    count += Math.round(fewest.x[width + k] ?? 0);
  });
  const counted = [...steps, ...derived];
  const atMost: LpRow = { lower: -Infinity, upper: count, entries: steps.map((_, k): [number, number] => [width + k, 1]) };
  const tied = await solve(counted, [...tieBreaks(lp, s1.x), ...steps.map(() => 0), ...derived.map((c) => c.weight)], [atMost]);
  return found(tied) ? offOf(counted, tied.x) : offOf(steps, fewest.x);
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
 * mixtures such as two electrolysis variants of the same salt water. Purchases of derived leaves count their chains a
 * little, as in `fewestRecipesMip`; the free-input and power tie-breaks are left to the MIP, as here they could
 * outweigh a recipe. Returns the counted columns the plan no longer uses, or null when no round solves.
 */
async function fewestRecipes(lp: MainLp, locks: readonly LpRow[]): Promise<Set<number> | null> {
  const step = lp.recipes.map((r) => r.kind === 'recipe');   // ore-dictionary conversions are not steps
  const counts = (j: number): number => (step[j] === true ? 1 : S3_DERIVED_STEP * (lp.derivedSteps[j] ?? 0));
  let x: readonly number[] | null = null;
  let solved = false;
  for (let round = 0; round < S3_ROUNDS; round++) {
    let largest = 0;
    if (x !== null) for (let j = 0; j < lp.firstSink; j++) largest = Math.max(largest, x[j] ?? 0);
    const delta = largest * S3_DELTA;
    const prev = x;
    // The first round weighs every step 1 (least total runs); later ones 1 / (runs before + δ). A derived purchase
    // counts its chain, a little, as in `fewestRecipesMip`.
    const cost = lp.canonical.map((_, j) => {
      const c = counts(j);
      return c === 0 ? 0 : prev === null ? c : c / ((prev[j] ?? 0) + delta + TINY);
    });
    const result = await minimize(lp, cost, locks);
    if (result.status !== 'optimal') break;
    x = result.x;
    solved = true;
  }
  if (!solved) return null;
  const off = new Set<number>();
  for (let j = 0; j < lp.firstSink; j++) {
    if (counts(j) > 0 && ((x as readonly number[])[j] ?? 0) <= TINY) off.add(j);
  }
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

/** The values of `keys` (columns from `first` on) above TINY, to 9 significant digits; the keys are already in sorted order. */
function kept(keys: readonly string[], x: readonly number[], first: number): Map<string, number> {
  const out = new Map<string, number>();
  keys.forEach((key, i) => {
    const value = x[first + i] ?? 0;
    if (value > TINY) out.set(key, sig9(value));
  });
  return out;
}

/**
 * The rows `x` does not balance: per row, `residual` = activity − the nearest bound (`Σ a·x − d` for a row of demand
 * `d`, purchases and sinks included) and `scale` = max(|that bound|, max |a·x|); a row fails when
 * `|residual| > RESIDUAL_ABS + RESIDUAL_REL × scale`, or when its activity is not a number.
 */
export function residualViolations(rows: readonly LpRow[], x: readonly number[]): Array<{ row: number; residual: number; scale: number }> {
  const out: Array<{ row: number; residual: number; scale: number }> = [];
  rows.forEach((r, row) => {
    let activity = 0;
    let largest = 0;
    for (const [j, a] of r.entries) {
      const term = a * (x[j] ?? 0);
      activity += term;
      largest = Math.max(largest, Math.abs(term));
    }
    const bound = activity < r.lower ? r.lower : activity > r.upper ? r.upper : activity;
    const residual = activity - bound;
    const scale = Math.max(Number.isFinite(bound) ? Math.abs(bound) : 0, largest);
    if (!Number.isFinite(residual) || Math.abs(residual) > RESIDUAL_ABS + RESIDUAL_REL * scale) out.push({ row, residual, scale });
  });
  return out;
}

/** The first of `stages` whose solution balances every row (`residualViolations`), or null when none does. */
export function firstBalanced<T extends { x: readonly number[] }>(stages: readonly T[], rows: readonly LpRow[]): T | null {
  for (const stage of stages) if (residualViolations(rows, stage.x).length === 0) return stage;
  return null;
}

/**
 * The source columns, never part of a loop: recipes that consume nothing (rock breakers, pumps, ponds, farms), and
 * supply recipes (`LpRecipe.supply`, fix spec R2) such as the compressor that fills with air the cells a canner empties,
 * so a line that runs on free inputs alone (Nitrogen from air) keeps them.
 */
function sourceColumns(lp: MainLp): Set<number> {
  const sources = new Set<number>();
  lp.recipes.forEach((r, j) => {
    if (r.supply === true || r.coeffs.every(([, c]) => c >= 0)) sources.add(j);
  });
  return sources;
}

/**
 * The loop guard. A line that needs no raw material at all either runs on sources (`sourceColumns`: recipes that consume
 * nothing and supply recipes, and the goods made from them) or on a loop in the data that makes matter from nothing
 * (x → 2 y, y → x). It is a loop when the demand can still be met with every purchase and every source fixed to 0; then
 * the loop is the least-runs steady state that, again without purchases or sources and with no demand, leaves any
 * surplus at all: only the loop's own recipes, not the recipes that turn its output into the target, nor recipes that
 * merely share a no-gain cycle with it (cells filled and emptied). On the real export the old rule (every used recipe on
 * any cycle) banned 58 recipes for an Electronic Circuit, the salt water mixer and cell canners among them, because the
 * Eye of Harmony (a source) ran.
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
 * `S3_TOLERANCE` of S1 the stages lock that instead, else S3 is dropped (and approximated without a MIP). `skipped`:
 * neither stage came back, or each that left recipes out failed that check (fix spec D2: never skip silently); one that
 * leaves nothing out (every recipe of the graph is needed) is a plan as simple as it gets, so nothing was skipped.
 */
async function simplest(lp: MainLp, s1: LpResult, locks: LpRow[]): Promise<{ off: Set<number>; locks: LpRow[]; base: LpResult; skipped: boolean }> {
  const candidates = [await fewestRecipesMip(lp, s1, locks), await fewestRecipes(lp, locks)];
  let simple = false;
  for (const off of candidates) {
    if (off === null) continue;
    if (off.size === 0) {
      simple = true;
      continue;
    }
    const again = await minimize(lp, lp.rawCost, [], Infinity, off);
    if (again.status === 'optimal' && again.objective <= s1.objective * (1 + S3_TOLERANCE) + TINY) {
      return { off, locks: lockRow(lp.rawCost, Math.max(again.objective, s1.objective)), base: again, skipped: false };
    }
  }
  return { off: new Set(), locks, base: s1, skipped: !simple };
}

/** The `simplify-skipped` warning (fix spec D2), a fresh object per plan. */
function simplifySkipped(): PlanWarning {
  return { code: 'simplify-skipped', text: 'Could not simplify this plan; it may use more machines than it needs' };
}

/**
 * The `numerics` warning (fix spec D2) for the stage solution `x` that does not balance: it names the good of its worst
 * row (the most times over its allowance) by key; planLine names it in words.
 */
function numericsWarning(lp: MainLp, x: readonly number[]): PlanWarning {
  let worst: { row: number; over: number } | undefined;
  for (const v of residualViolations(lp.rows, x)) {
    const over = Number.isFinite(v.residual) ? Math.abs(v.residual) / (RESIDUAL_ABS + RESIDUAL_REL * v.scale) : Infinity;
    if (worst === undefined || over > worst.over) worst = { row: v.row, over };
  }
  const key = lp.goods[worst?.row ?? -1];
  return key === undefined
    ? { code: 'numerics', text: 'The solver could not balance this plan exactly; the plan uses an earlier stage' }
    : { code: 'numerics', key, text: `The solver could not balance ${key} exactly; the plan uses an earlier stage` };
}

/** S3, S2 and S4 on top of an optimal S1, the latest of them that balances (`firstBalanced`), then the rounded maps. */
async function finish(lp: MainLp, s1: LpResult, warnings: PlanWarning[]): Promise<Solution> {
  // S3, S2 and S4 only break ties: a stage that does not solve (numerically, or S2 unbounded by a recipe with negative
  // EU) keeps the previous stage's plan, which already uses the least raw material (S3's: the least raw material
  // without the recipes it left out). S3 runs before power, so power never picks a longer chain among equally cheap
  // ones; the later stages keep to the recipes S3 left.
  const open = lockRow(lp.rawCost, s1.objective);
  const { off, locks, base, skipped } = await simplest(lp, s1, open);
  const s2 = await minimize(lp, lp.power, locks, Infinity, off);
  if (s2.status === 'optimal') locks.push(...lockRow(lp.power, s2.objective));
  const s4 = await minimize(lp, lp.canonical, locks, Infinity, off);
  // Latest first: S4, S2, the simplified base, S1. A stage whose solution leaves a good unbalanced beyond the residual
  // allowance (HiGHS's absolute tolerances) gives way to an earlier one, and the plan says so; when none balances, the
  // latest stays and the warning names its worst good.
  const stages: LpResult[] = [];
  if (s4.status === 'optimal') stages.push(s4);
  if (s2.status === 'optimal') stages.push(s2);
  stages.push(base);
  if (base !== s1) stages.push(s1);
  const latest = stages[0] as LpResult;
  const balanced = firstBalanced(stages, lp.rows);
  const best = balanced ?? latest;
  const notes = [...warnings];
  if (skipped) notes.push(simplifySkipped());
  if (best !== latest || balanced === null) notes.push(numericsWarning(lp, latest.x));

  let rawCost = 0;
  lp.rawCost.forEach((c, j) => {
    rawCost += c * (best.x[j] ?? 0);
  });
  return {
    status: 'ok',
    runs: kept(lp.recipes.map((r) => r.id), best.x, 0),
    buys: kept(lp.buyKeys, best.x, lp.firstBuy),
    sinks: kept(lp.goods, best.x, lp.firstSink),
    // Within tolerance a later stage may read a hair under S1's objective; the least is never more than the plan's.
    rawCost: sig9(rawCost), leastRawCost: sig9(Math.min(s1.objective, rawCost)), blockers: [], warnings: notes,
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
 *
 * The LP is homogeneous in the demand (no fixed costs), so every stage solves the demand divided by its largest amount
 * and the result is scaled back (fix spec D1): the stages see the same numbers at 1 per hour as at 1 per second.
 * HiGHS's feasibility tolerances are absolute (1e-7 on rows lp.ts divides by their largest coefficient), so at
 * 1 Electronic Circuit per hour (flows of 1e-8..1e-4 per second) S1 took cells from nothing, the fewest-recipes MIP
 * found its raw lock infeasible, and S2/S4 dropped whole chains (Polyvinyl Acetate) inside the tolerance. Every
 * absolute threshold (`TINY`, `ZERO_RAW`, the S3 big-M, the tie-break scalings) is thereby per unit of target.
 */
export async function solveLine(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>): Promise<Solution> {
  let scale = 0;
  for (const amount of demand.values()) scale = Math.max(scale, Math.abs(amount));
  if (!(scale > 0) || !Number.isFinite(scale) || scale === 1) return solveUnit(graph, demand);
  const unit = new Map([...demand].map(([key, amount]): [StuffKey, number] => [key, amount / scale]));
  const sol = await solveUnit(graph, unit);
  const times = <K>(values: ReadonlyMap<K, number>): Map<K, number> => new Map([...values].map(([key, v]): [K, number] => [key, sig9(v * scale)]));
  return {
    ...sol, runs: times(sol.runs), buys: times(sol.buys), sinks: times(sol.sinks),
    rawCost: sig9(sol.rawCost * scale), leastRawCost: sig9(sol.leastRawCost * scale),
  };
}

/** `solveLine` at the demand given (unit demand, or a demand that cannot be scaled). */
async function solveUnit(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>): Promise<Solution> {
  const banned: string[] = [];
  const bannedSet = new Set<string>();
  const loopWarnings = (): PlanWarning[] => (banned.length === 0 ? [] : [{
    code: 'free-loop',
    text: `Ignored ${banned.length === 1 ? '1 recipe' : `${banned.length} recipes`} that make ${graph.targets.join(', ')} from nothing (likely a recipe data loop): ${cappedList(banned)}`,
  }]);
  const infeasible = (blockers: Blocker[], warnings: PlanWarning[]): Solution => ({
    status: 'infeasible', runs: new Map(), buys: new Map(), sinks: new Map(), rawCost: 0, leastRawCost: 0, blockers, warnings, banned: [...banned],
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
 * What making one unit of a good on its own costs: `cost` in raw material (Infinity: only a chain through the line's
 * target makes it), `steps`, the recipes that chain runs (ore-dictionary conversions are not recipes), and `free`, the
 * free input it takes (`MainLp.free`); `recipes` and `top` say which recipes those are (fix spec R7).
 */
export interface Standalone {
  cost: number; steps: number; free: number;
  /** The step recipes the chain runs (`steps` of them), the most runs first, equal runs by id. */
  recipes: string[];
  /**
   * The recipe of the chain that makes most of the good, container moves left out (`isContainerMove`); for a fluid, the
   * filled containers of it a recipe makes count as that fluid. None when no other recipe of the chain makes it.
   */
  top?: string;
}

/** A filled container and the litres of its fluid (`Pack.fluidContainers`). */
export interface FluidContainer { container: StuffKey; fluid: StuffKey; amount: number }

/**
 * A recipe that only moves `fluid` between a container and its bulk form: one whose only consumed good is a filled
 * container of it (a canner emptying an Ethylene Cell), or one that only makes filled containers of it, from it (a
 * canner filling cells). `holds` gives a filled container's fluid.
 */
function isContainerMove(r: LpRecipe, fluid: StuffKey | undefined, holds: ReadonlyMap<StuffKey, FluidContainer>): boolean {
  if (fluid === undefined) return false;
  const inputs = r.coeffs.filter(([, c]) => c < 0).map(([key]) => key);
  const outputs = r.coeffs.filter(([, c]) => c > 0).map(([key]) => key);
  const holdsFluid = (key: StuffKey): boolean => holds.get(key)?.fluid === fluid;
  if (inputs.length === 1 && holdsFluid(inputs[0] as StuffKey)) return true;
  return inputs.includes(fluid) && outputs.length > 0 && outputs.every(holdsFluid);
}

/**
 * The least raw material that makes one unit of each of `keys` on its own in `graph`: S1 of the main LP with that one
 * demand and every byproduct sunk, no recipe consuming a good of `notInputs` (the line's target). It is what buying the
 * good instead of making it should cost, without the arbitrary split of a recipe's cost between its co-products that
 * the cost analysis (costs.ts) makes (pyrolysis there priced charcoal at 0 and gave the whole log to its wood gas).
 * Infinity when only a chain through `notInputs` makes the good (Magnetic Steel from the Steel target); undefined when
 * the graph cannot make it at all. `containers` (the pack's filled containers) tell the recipes that only fill or empty
 * one from the chemistry `Standalone.top` names.
 */
export async function standaloneCosts(
  graph: CandidateGraph, keys: readonly StuffKey[], notInputs: readonly StuffKey[] = [], containers: readonly FluidContainer[] = [],
): Promise<Map<StuffKey, Standalone | undefined>> {
  const out = new Map<StuffKey, Standalone | undefined>();
  if (keys.length === 0) return out;
  const holds = new Map<StuffKey, FluidContainer>();
  for (const c of containers) if (!holds.has(c.container)) holds.set(c.container, c);
  /** What one run of `r` makes of `key`: its own output, and for a fluid each filled container of it at its litres. */
  const madeOf = (r: LpRecipe, key: StuffKey): number => {
    let made = 0;
    for (const [k, c] of r.coeffs) {
      if (c <= 0) continue;
      if (k === key) made += c;
      else if (holds.get(k)?.fluid === key) made += c * (holds.get(k) as FluidContainer).amount;
    }
    return made;
  };
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
    if (result.status === 'optimal') {
      const ran = lp.recipes.flatMap((r, j) => {
        const runs = result.x[j] ?? 0;
        return r.kind === 'recipe' && runs > TINY ? [{ r, runs: sig9(runs) }] : [];
      }).sort((a, b) => b.runs - a.runs || byString(a.r.id, b.r.id));
      let free = 0;
      lp.free.forEach((f, j) => {
        free += f * (result.x[j] ?? 0);
      });
      const fluid = isFluidKey(key) ? key : holds.get(key)?.fluid;
      let top: { id: string; made: number } | undefined;
      for (const { r, runs } of ran) {
        if (isContainerMove(r, fluid, holds)) continue;
        const made = sig9(runs * madeOf(r, key));
        if (made > TINY && (top === undefined || made > top.made || (made === top.made && r.id < top.id))) top = { id: r.id, made };
      }
      const made: Standalone = { cost: Math.max(0, result.objective), steps: ran.length, free: sig9(free), recipes: ran.map(({ r }) => r.id) };
      if (top !== undefined) made.top = top.id;
      out.set(key, made);
    } else if (barred.size > 0 && (await solve(g, new Set())).status === 'optimal') {
      out.set(key, { cost: Infinity, steps: 0, free: 0, recipes: [] });
    } else {
      out.set(key, undefined);
    }
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
