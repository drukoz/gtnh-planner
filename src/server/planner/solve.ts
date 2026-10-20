// The rate solver (spec §3.3, prior-art §3.4 steps 3, 4 and 7): the main LP in extent form, solved in lexicographic
// stages (least raw material, then a step charge or fewest recipes — or, when build cost counts, the build-cost MIP
// (build-mip.ts) — then power as a tie-break only, then a canonical form), a guard against recipe data loops that make
// matter from nothing, and the goods that block a target nothing reachable can make, for plain-words warnings (and the
// dead ends of one good's chain, for machine prices).

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanWarning } from '../../shared/types/plan.ts';
import {
  BUILD_MIP_MAX_LP_ITERATIONS, BUILD_MIP_MAX_NODES, BUILD_MIP_TIME_LIMIT_SECONDS, buildMip, laterRoom, roundUp, type BuildDecision, type BuildMipInput,
  type LaterRoom, type StepMachines,
} from './build-mip.ts';
import { canonicalRank, type CandidateGraph, type LpRecipe } from './candidates.ts';
import { solveLp, type LpModel, type LpResult, type LpRow } from './lp.ts';
import { buildCounts, type BuildModel, type MachineOption } from './machine-options.ts';
import { sig9 } from './round.ts';

/** How `solveLine` trades steps against raw material, and whether it only probes (fix spec R3, architecture §11.34). */
export interface SolveOptions {
  /**
   * Share of the least raw material (S1) one recipe step must save to be built; 0 = least raw material, fewest recipes as
   * tie-break. When build cost counts, the build MIP pays it per new machine block instead, measured against S1g over the
   * horizon (build-mip.ts, fix wave 2 (a)).
   */
  stepCharge?: number;
  /** Weight of a crafting-table step: HAND_STEP_WEIGHT in rate mode with automateCrafting off, else 1. */
  handWeight?: number;
  /** S1 only: whether the line plans and its least-raw solution (avoid trials, below). */
  probe?: boolean;
  // optional additions (plan 12: build cost, architecture §11.39)
  /**
   * The line's build model (`lineBuildModel`): in rate mode its steps that can only use owned machines are bounded by
   * them in every stage; when it counts build cost (`buildCounts`) the build-cost MIP replaces R3's stages 2–4, else plan
   * 09's stages run and their plan's machines are sized by `roundUp`. Absent: plan 09's solve.
   */
  build?: BuildModel;
  /** Seconds the build MIP may take (default BUILD_MIP_TIME_LIMIT_SECONDS); ≤ 0 skips it for the fallback (tests). */
  buildTimeLimit?: number;
  /** Nodes the build MIP may use (default BUILD_MIP_MAX_NODES; Task 8's calibration). */
  buildMaxNodes?: number;
  // optional addition (the plan 12 fix wave)
  /** Simplex iterations the build MIP may use (default BUILD_MIP_MAX_LP_ITERATIONS; calibration and tests). */
  buildMaxIterations?: number;
  // optional addition (the plan 12 fix wave 2 review)
  /** The recipe ids the project pins (`PlanSettings.recipeChoice`'s values): `twinMoves` never moves one to its twin. */
  pinnedRecipes?: ReadonlySet<string>;
  // optional addition (controller ruling 197 (1))
  /**
   * Rule (c) of twin step recipes (`twinMoves`): how players stock a good, 0 an ingot, 1 a dust, 2 any other form
   * (`stockForm` in plan.ts reads the pack's GT prefixes); absent, every good ranks alike there.
   */
  formRank?: (key: StuffKey) => number;
}

/** The step charge never lets total raw material go above (1 + this) × the least (S1) (fix spec §3). */
export const STEP_CHARGE_CAP = 0.25;
/** A crafting-table step weighs this many steps in a running line with crafting not automated (fix spec D7). */
export const HAND_STEP_WEIGHT = 3;
/** In the step-charge MIP a step recipe runs at most this many times the largest run count of S1 (its big-M). */
export const STEP_BIG_M = 100;
/** The step-charge MIP stops after its root node: a node limit, never a time limit, so the plan is deterministic. */
export const STEP_MIP_MAX_NODES = 1;
/**
 * Fix spec R10: the tie-break weight of a non-canonical (`canonicalRank` 1) purchase or ore-dictionary option per unit,
 * in the step-charge MIP (relative to raw material: a purchase pays this share of its raw cost more, a conversion this
 * share of one unit of raw material) and in S4 (added to the column's canonical weight of 1).
 */
export const CANON_RANK_S3 = 1e-6;
export const CANON_RANK_S4 = 1e-3;

export interface Blocker {
  key: StuffKey; reason: 'unavailable' | 'rejected' | 'no-recipe'; needTier?: number;
  // optional addition (plan 12, controller ruling OQ5 a)
  /** With reason `rejected`: why a machine its recipes need cannot be built here (`<machine> cannot be built here (<why>)`). */
  machine?: string;
}
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
  // optional additions (plan 12: a solve with `SolveOptions.build`)
  /**
   * Per kept step recipe with machine options, its machines as the build stage decided them (with build cost ignored,
   * `roundUp` of plan 09's plan); Task 5 recomputes the counts from the final runs.
   */
  machines?: Map<string, StepMachines>;
  /** With `BuildModel.share`: the decision's sharing pools (empty without). */
  pools?: BuildDecision['pools'];
  /** Whether the plan builds a cleanroom (the model's, which the group does not own). */
  cleanroom?: boolean;
  /**
   * The build MIP's wall time, nodes and end — `status` HiGHS's, of the model: `optimal` is the model's optimum, whose
   * light steps' builds (build-mip.ts `Light`) are exact at S1's runs and may be off by less than a machine each at
   * others — `approx` when the plan comes from the fallback; with a whole solution the decision's objective with every
   * machine at its true build (`exactCost`) and HiGHS's proven bound on the model (their gap: how far the node limit and
   * that pricing may have left the plan from the model's optimum; optional additions of the plan fix wave). Absent with
   * build cost ignored.
   */
  buildStats?: {
    seconds: number; nodes: number; status: LpResult['status'] | 'skipped'; stop?: 'time' | 'limit'; approx: boolean; objective?: number; bound?: number;
  };
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
export interface MainLp {
  recipes: LpRecipe[]; buyKeys: StuffKey[]; goods: StuffKey[];
  firstBuy: number; firstSink: number; rows: LpRow[];
  /**
   * Per column, its upper bound in every stage: Infinity, but for a step recipe that can only run on owned machines that
   * cannot be built here (plan 12, `BuildModel.ownedOnly`, rate mode) the runs per unit of demand they do.
   */
  upper: number[];
  /**
   * Per column: cost × buy (S1), EU per run (S2), and 1 on every column (S4), but 1 + the recipes of its chain for buying
   * a derived leaf (`GoodInfo.steps`): among plans equal in everything else the one that buys Steel for its rods is
   * simpler than the one that buys Magnetic Steel (steel, then a polarizer). A purchase or ore-dictionary conversion of a
   * non-canonical good (`rank`) weighs CANON_RANK_S4 more in S4.
   */
  rawCost: number[]; power: number[]; canonical: number[];
  /** Per column, `canonicalRank` of the good a purchase buys or a conversion takes (fix spec R10); 0 for other columns. */
  rank: number[];
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
  const rank = new Array<number>(width).fill(0);
  sorted.forEach((r, j) => {
    const option = r.kind === 'convert' ? r.coeffs.find(([, c]) => c < 0)?.[0] : undefined;
    if (option !== undefined) rank[j] = canonicalRank(option);
  });
  buyKeys.forEach((key, i) => {
    rank[firstBuy + i] = canonicalRank(key);
  });
  rank.forEach((n, j) => {
    canonical[j] = (canonical[j] as number) + CANON_RANK_S4 * n;
  });
  const upper = new Array<number>(width).fill(Infinity);
  return { recipes: sorted, buyKeys, goods, firstBuy, firstSink, rows, upper, rawCost, power, canonical, rank, free, derivedSteps };
}

/**
 * Minimizes `cost` over the main rows plus `locks`; every column ≥ 0 and within `lp.upper`, purchases at most
 * `buyUpper`, the columns in `off` (recipes, or purchases the fewest-recipes stage left out) fixed to 0.
 */
function minimize(lp: MainLp, cost: readonly number[], locks: readonly LpRow[], buyUpper = Infinity, off: ReadonlySet<number> = new Set()): Promise<LpResult> {
  const width = cost.length;
  const colUpper = lp.upper.map((u, j) => (j >= lp.firstBuy && j < lp.firstSink ? Math.min(u, buyUpper) : u));
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
      sense: 'min', colCost, colLower: new Array<number>(all).fill(0), colUpper: [...lp.upper, ...new Array<number>(counted.length).fill(1)], rows,
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
  const colUpper = [...lp.upper].fill(0, lp.firstBuy, lp.firstSink);
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
 * What the simplification stage leaves the later stages: the columns it fixes to 0 (step recipes, and derived purchases
 * it does without), the lock on raw material they keep, its least-raw plan over the rest (`base`), and whether it
 * failed (`skipped`, fix spec D2).
 */
interface Simplified { off: Set<number>; locks: LpRow[]; base: LpResult; skipped: boolean }

/**
 * Step charge 0, "Least raw material" (fix spec R3): the step-charge stage with the raw material held at the least (a
 * cap of 0) and every step recipe weighing this, crafted by hand or not. Among the plans of least raw material it
 * looks for one of fewest recipes, then the least free input and power: a recipe weighs 10 times what the least-raw
 * plan's free input weighs in S3's tie-breaks (S3_FREE_SHARE), so a plan of one more recipe wins only where the fewer
 * would take over 10 times that free input. S3's fewest-recipes MIPs (`fewestRecipesMip`, S3_MAX_NODES each) took up to
 * 14 s on the real-data corpus and 181 s on the user's settings at Advanced Circuit HV, on the larger graphs of the
 * step-bounded pruning (R4); this root-node MIP, started from S1, plans them in under 3 s, within 2 steps of S3's
 * count. A weight of 0.05 to 1 made HiGHS's root node take 5 to 14 s on one of those lines.
 */
const LEAST_RAW_STEP = 0.01;

/**
 * The simplification stage (fix spec R3), for a line that needs raw material: the step-charge stage, at
 * `opts.stepCharge` when it is above 0, else held at the least raw material (`LEAST_RAW_STEP`). A line that needs
 * none has nothing to weigh its steps against: today's fewest recipes (`fewestRecipesStage`).
 */
function simplest(lp: MainLp, s1: LpResult, locks: LpRow[], opts: SolveOptions): Promise<Simplified> {
  if (!(s1.objective > TINY)) return fewestRecipesStage(lp, s1, locks);
  const charge = opts.stepCharge ?? 0;
  if (Number.isFinite(charge) && charge > 0) return chargedStage(lp, s1, locks, charge, opts.handWeight ?? 1, STEP_CHARGE_CAP);
  return chargedStage(lp, s1, locks, LEAST_RAW_STEP, 1, 0);
}

/**
 * S3 and the lock the later stages keep. The MIP's big-M lets a recipe it leaves out still run a tiny amount (its
 * binary sits just above 0), so the least raw material is solved again without the left-out recipes: within
 * `S3_TOLERANCE` of S1 the stages lock that instead, else S3 is dropped (and approximated without a MIP). `skipped`:
 * neither stage came back, or each that left recipes out failed that check (fix spec D2: never skip silently); one that
 * leaves nothing out (every recipe of the graph is needed) is a plan as simple as it gets, so nothing was skipped.
 */
async function fewestRecipesStage(lp: MainLp, s1: LpResult, locks: LpRow[]): Promise<Simplified> {
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

/** A step recipe's weight in the step charge: `handWeight` for a crafting-table recipe, 1 for any other. */
function stepWeight(r: LpRecipe, handWeight: number): number {
  return r.mapId === 'crafting' ? handWeight : 1;
}

/**
 * R3's relative cost per main column (the step-charge MIP's objective there): the raw material in units of S1's, S3's
 * free-input and power tie-breaks (`tieBreaks`) and the canonical rank (CANON_RANK_S3). Only for an S1 above 0.
 */
function relativeCosts(lp: MainLp, s1: LpResult): number[] {
  const least = s1.objective;
  const tb = tieBreaks(lp, s1.x);
  const isPurchase = (j: number): boolean => j >= lp.firstBuy && j < lp.firstSink;
  return lp.rawCost.map((c, j) => c / least + (tb[j] ?? 0) + (CANON_RANK_S3 * (lp.rank[j] ?? 0) * (isPurchase(j) ? c : 1)) / least);
}

/** R3's bought derived leaves with a price: their purchase column and S3's small charge for the recipes of their chain. */
function pricedDerived(lp: MainLp): Array<{ j: number; weight: number }> {
  const out: Array<{ j: number; weight: number }> = [];
  lp.derivedSteps.forEach((n, j) => {
    if (n > 0 && (lp.rawCost[j] ?? 0) > 0) out.push({ j, weight: S3_DERIVED_STEP * n });
  });
  return out;
}

/**
 * A plan of few recipes within `Σ raw ≤ capped` (S3's reweighted L1, `fewestRecipes`), at the least raw material its
 * recipes allow: the charge MIP's other start (fix spec R3 step 2, as amended by plan 09 Task 8). S1 runs every recipe
 * of the least raw material, the most steps a plan of the line has, and from it the root node stopped where the line
 * had a plan better by the charge: the user's Electronic Circuit line (MV, 1 an hour, 2 %) at 19 steps and 11 % above
 * the least, where 24 steps at 0.05 % above it charge less (with this start the root node finds them). Null when it
 * finds none.
 */
async function sparseWithin(lp: MainLp, capped: number): Promise<number[] | null> {
  const off = await fewestRecipes(lp, lockRow(lp.rawCost, capped));
  if (off === null) return null;
  const base = await minimize(lp, lp.rawCost, [], Infinity, off);
  return base.status === 'optimal' && base.objective <= capped ? base.x : null;
}

/**
 * The step-charge MIP (fix spec R3 step 2). Over the main rows and `Σ raw ≤ (1 + cap) × S1` it minimizes the
 * raw material in units of S1's, with S3's free-input and power tie-breaks (`tieBreaks`) and the canonical rank
 * (CANON_RANK_S3), plus `charge` × `stepWeight` for each step recipe it runs and S3's small charge for each priced
 * derived leaf it buys. One binary per step recipe and per such purchase, `column ≤ M × binary` (M: STEP_BIG_M × the
 * largest S1 run for a recipe, what the cap lets the line buy for a purchase). It starts from the better, by its own
 * objective, of S1 and `sparseWithin` (each counted column the start uses above TINY on) and stops after
 * STEP_MIP_MAX_NODES nodes with the best whole solution it has, which may be the start. Returns the counted columns it
 * leaves out (binary off, or a step recipe it does not run), or null when it has no whole solution or nothing to count.
 */
async function chargeMip(lp: MainLp, s1: LpResult, charge: number, handWeight: number, cap: number): Promise<Set<number> | null> {
  const least = s1.objective;
  let largest = 0;
  for (let j = 0; j < lp.firstBuy; j++) largest = Math.max(largest, s1.x[j] ?? 0);
  if (largest <= TINY || !(least > TINY)) return null;
  const width = lp.rawCost.length;
  const capped = (1 + cap) * least;
  const counted: Array<{ j: number; weight: number; bigM: number; step: boolean }> = [];
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe') counted.push({ j, weight: charge * stepWeight(r, handWeight), bigM: STEP_BIG_M * largest, step: true });
  });
  if (counted.length === 0) return null;
  for (const { j, weight } of pricedDerived(lp)) {
    counted.push({ j, weight, bigM: (capped / (lp.rawCost[j] as number)) * (1 + S3_TOLERANCE) + TINY, step: false });
  }
  const colCost = [...relativeCosts(lp, s1), ...counted.map((c) => c.weight)];
  const all = width + counted.length;
  /** A plan `x` as a start: its columns, and each counted binary 1 where the plan uses its column. */
  const startOf = (x: readonly number[]): number[] => [
    ...lp.rawCost.map((_, j) => Math.max(0, x[j] ?? 0)), ...counted.map((c) => ((x[c.j] ?? 0) > TINY ? 1 : 0)),
  ];
  const objectiveOf = (start: readonly number[]): number => start.reduce((sum, v, j) => sum + (colCost[j] ?? 0) * v, 0);
  // The root node improves on the start it is given: the better of S1 and a plan of few recipes within the cap.
  let start = startOf(s1.x);
  const sparse = await sparseWithin(lp, capped);
  if (sparse !== null && counted.every((c) => (sparse[c.j] ?? 0) <= c.bigM)) {
    const candidate = startOf(sparse);
    if (objectiveOf(candidate) < objectiveOf(start)) start = candidate;
  }
  const result = await solveLp({
    sense: 'min', colCost, colLower: new Array<number>(all).fill(0), colUpper: [...lp.upper, ...new Array<number>(counted.length).fill(1)],
    rows: [
      ...lp.rows, ...lockRow(lp.rawCost, capped),
      ...counted.map((c, k): LpRow => ({ lower: -Infinity, upper: 0, entries: [[c.j, 1], [width + k, -c.bigM]] })),
    ],
    integer: new Array<boolean>(all).fill(false).fill(true, width), maxNodes: STEP_MIP_MAX_NODES, start,
  });
  if (result.status !== 'optimal' && result.status !== 'feasible') return null;
  const off = new Set<number>();
  counted.forEach((c, k) => {
    if ((result.x[width + k] ?? 0) < 0.5 || (c.step && (result.x[c.j] ?? 0) <= TINY)) off.add(c.j);
  });
  return off;
}

/** What one run of `r` nets of `key` (its coefficient; 0 when it has none). */
function netOf(r: LpRecipe | undefined, key: StuffKey): number {
  return r?.coeffs.find(([k]) => k === key)?.[1] ?? 0;
}

/**
 * Consolidation (fix spec R3 step 4): for each good that is the main output (`LpRecipe.main`) of two or more step
 * recipes `base` runs, its smaller producers, least made first, one LP each: leave it out when the least raw material
 * without it, in units of S1's, plus `charge` × the weights of the step recipes that plan runs is lower (and within
 * `limit`, the cap). Goods by key, so the result does not depend on the export's order. Then each purchase of a good a
 * step makes too, where the line can do without it (`withoutTiedPurchases`).
 */
async function consolidated(
  lp: MainLp, s1: LpResult, start: { off: Set<number>; base: LpResult }, charge: number, handWeight: number, limit: number,
): Promise<{ off: Set<number>; base: LpResult }> {
  const score = (plan: LpResult): number => {
    let weights = 0;
    lp.recipes.forEach((r, j) => {
      if (r.kind === 'recipe' && (plan.x[j] ?? 0) > TINY) weights += stepWeight(r, handWeight);
    });
    return plan.objective / s1.objective + charge * weights;
  };
  let { off, base } = start;
  let best = score(base);
  const producers = new Map<StuffKey, number[]>();
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe' && r.main !== undefined) pushTo(producers, r.main, j);
  });
  for (const key of [...producers.keys()].sort(byString)) {
    const made = (j: number): number => (base.x[j] ?? 0) * netOf(lp.recipes[j], key);
    const running = (producers.get(key) as number[]).filter((j) => !off.has(j) && (base.x[j] ?? 0) > TINY);
    if (running.length < 2) continue;
    running.sort((a, b) => made(b) - made(a) || byString((lp.recipes[a] as LpRecipe).id, (lp.recipes[b] as LpRecipe).id));
    for (const j of running.slice(1).reverse()) {
      if (!((base.x[j] ?? 0) > TINY)) continue;   // an earlier removal left it idle
      const without = new Set(off).add(j);
      const tried = await minimize(lp, lp.rawCost, [], Infinity, without);
      if (tried.status !== 'optimal' || tried.objective > limit) continue;
      const s = score(tried);
      if (s + TINY < best) {
        off = without;
        base = tried;
        best = s;
      }
    }
  }
  const tied = await withoutTiedPurchases(lp, off, base);
  return { off: tied.off, base: tied.base };
}

/**
 * A good a step recipe of the base makes has that one source when the line can do without buying it at the same raw
 * material (within S3_TOLERANCE; the step charge cannot tell the two apart, as no step comes or goes), so the later
 * stages never buy it beside the step (spec R11's bought-and-made): within the raw-material lock the power and
 * canonical stages broke such ties towards buying, and an Electric Blast Furnace run for its carbon dioxide made some of
 * a line's copper ingots while the line bought the rest (plan 09 Task 8). A purchase the base does not use stays shut;
 * one it uses, when an LP without it is not dearer. Goods in key order; free goods (no raw cost) are left alone.
 *
 * In the build stage (`room`: plan 12, `laterRoom`) every LP stays within the machines the decision bought, and a step
 * that makes the good may also run on machines that cost nothing more — owned ones the decision leaves idle — taking
 * whole machines of them (`LaterRoom.widen`, then `trim` to what it uses): making the rest there costs no more raw
 * material, no machine to build and no machine block, so buying it beside the step is only the power or canonical
 * tie-break's choice. A new machine always costs a block's step charge (fix wave 2 (a)), so a tie that needs one is the
 * build MIP's to weigh. `locks` are the rows the later stages keep (none without `room`).
 */
async function withoutTiedPurchases(
  lp: MainLp, start: Set<number>, from: LpResult, room?: LaterRoom,
): Promise<{ off: Set<number>; base: LpResult; locks: LpRow[] }> {
  let off = start;
  let base = from;
  let grants: ReadonlyMap<string, number> = new Map();
  const most = from.objective * (1 + S3_TOLERANCE) + TINY;
  for (let i = 0; i < lp.buyKeys.length; i++) {
    const j = lp.firstBuy + i;
    const key = lp.buyKeys[i] as StuffKey;
    if (off.has(j) || !((lp.rawCost[j] ?? 0) > 0)) continue;
    const makers: number[] = [];
    lp.recipes.forEach((r, k) => {
      if (r.kind === 'recipe' && !off.has(k) && (base.x[k] ?? 0) > TINY && netOf(r, key) > 0) makers.push(k);
    });
    if (makers.length === 0) continue;
    const without = new Set(off).add(j);
    if (!((base.x[j] ?? 0) > TINY)) {
      off = without;
      continue;
    }
    const widened = room?.widen(makers, grants) ?? grants;
    const tried = await minimize(lp, lp.rawCost, room?.rows(widened) ?? [], Infinity, without);
    if (tried.status === 'optimal' && tried.objective <= most) {
      off = without;
      base = tried;
      if (room !== undefined) grants = room.trim(widened, tried.x);
    }
  }
  return { off, base, locks: room?.rows(grants) ?? [] };
}

/**
 * The step-charge stage (fix spec R3 steps 2–5), raw material at most (1 + `cap`) × S1: the charge MIP's support
 * (`chargeMip`), its least raw material solved again over that support (`base`, within the cap); when either fails,
 * today's fewest recipes with the exact lock (`fewestRecipesStage`, which says so when it fails too); then
 * `consolidated`. The later stages run only the step recipes the base runs, the derived purchases left out stay out,
 * and they lock raw material at the base's.
 */
async function chargedStage(lp: MainLp, s1: LpResult, open: LpRow[], charge: number, handWeight: number, cap: number): Promise<Simplified> {
  const limit = (1 + cap) * s1.objective * (1 + S3_TOLERANCE) + TINY;
  let start: { off: Set<number>; base: LpResult } | undefined;
  const mipOff = await chargeMip(lp, s1, charge, handWeight, cap);
  if (mipOff !== null) {
    const base = await minimize(lp, lp.rawCost, [], Infinity, mipOff);
    if (base.status === 'optimal' && base.objective <= limit) start = { off: mipOff, base };
  }
  if (start === undefined) {
    const fallback = await fewestRecipesStage(lp, s1, open);
    if (fallback.skipped) return fallback;
    start = { off: fallback.off, base: fallback.base };
  }
  const { off, base } = await consolidated(lp, s1, start, charge, handWeight, limit);
  const leftOut = new Set([...off].filter((j) => j >= lp.firstBuy));
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe' && !((base.x[j] ?? 0) > TINY)) leftOut.add(j);
  });
  return { off: leftOut, locks: lockRow(lp.rawCost, Math.max(base.objective, s1.objective)), base, skipped: false };
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

/**
 * The plan of `stages` (latest first): the latest whose solution balances every row (`firstBalanced`) — a stage that
 * leaves a good unbalanced beyond the residual allowance (HiGHS's absolute tolerances) gives way to an earlier one, and
 * the plan says so; when none balances, the latest stays and the warning names its worst good — as rounded maps, with
 * `notes` (the numerics warning appended) and that stage's columns.
 */
function settled(lp: MainLp, s1: LpResult, stages: readonly LpResult[], notes: PlanWarning[]): { sol: Solution; x: readonly number[] } {
  const latest = stages[0] as LpResult;
  const balanced = firstBalanced(stages, lp.rows);
  const best = balanced ?? latest;
  if (best !== latest || balanced === null) notes.push(numericsWarning(lp, latest.x));

  let rawCost = 0;
  lp.rawCost.forEach((c, j) => {
    rawCost += c * (best.x[j] ?? 0);
  });
  const sol: Solution = {
    status: 'ok',
    runs: kept(lp.recipes.map((r) => r.id), best.x, 0),
    buys: kept(lp.buyKeys, best.x, lp.firstBuy),
    sinks: kept(lp.goods, best.x, lp.firstSink),
    // Within tolerance a later stage may read a hair under S1's objective; the least is never more than the plan's.
    rawCost: sig9(rawCost), leastRawCost: sig9(Math.min(s1.objective, rawCost)), blockers: [], warnings: notes,
  };
  return { sol, x: best.x };
}

/**
 * S3 (or the step charge, `opts`), S2 and S4 on top of an optimal S1, the latest of them that balances (`settled`):
 * the rounded maps and the columns of the stage they come from.
 */
async function finish(lp: MainLp, s1: LpResult, warnings: PlanWarning[], opts: SolveOptions): Promise<{ sol: Solution; x: readonly number[] }> {
  // S3 (fewest recipes), S2 and S4 only break ties: a stage that does not solve (numerically, or S2 unbounded by a
  // recipe with negative EU) keeps the previous stage's plan, which already uses the least raw material (S3's: the
  // least raw material without the recipes it left out). With a step charge S3 instead trades raw material for steps, up
  // to the cap (at 0 there is no room above S1). S3 runs before power, so power never picks a longer chain among equally
  // cheap ones; the later stages keep to the recipes S3 left.
  const open = lockRow(lp.rawCost, s1.objective);
  const { off, locks, base, skipped } = await simplest(lp, s1, open, opts);
  const s2 = await minimize(lp, lp.power, locks, Infinity, off);
  if (s2.status === 'optimal') locks.push(...lockRow(lp.power, s2.objective));
  const s4 = await minimize(lp, lp.canonical, locks, Infinity, off);
  // Latest first: S4, S2, the simplified base, S1.
  const stages: LpResult[] = [];
  if (s4.status === 'optimal') stages.push(s4);
  if (s2.status === 'optimal') stages.push(s2);
  stages.push(base);
  if (base !== s1) stages.push(s1);
  const notes = [...warnings];
  if (skipped) notes.push(simplifySkipped());
  return settled(lp, s1, stages, notes);
}

/**
 * A step recipe the plan does not run in place of a twin it runs (`twinMoves`): `recipe` takes `amount` of `from` a run
 * where `to` takes as much of `into`, and is otherwise the same.
 */
export interface TwinMove { recipe: string; to: string; from: StuffKey; into: StuffKey; amount: number }

/** What `twinMoves` reads beside the graph: the build model, the pins, the plan and the forms of goods. */
export interface TwinRules {
  /** The line's build model: twins run on the same machines there, and a step only owned machines can run has none. */
  model?: BuildModel;
  /** The recipe ids the project pins (`SolveOptions.pinnedRecipes`): never moved. */
  pinned?: ReadonlySet<string>;
  /** The plan the moves are for (its runs and purchases): rule (b) reads what it buys apart from its twins. */
  plan?: Pick<Solution, 'runs' | 'buys'>;
  /** Rule (c): how players stock a good (`SolveOptions.formRank`); absent, every good ranks alike. */
  formRank?: (key: StuffKey) => number;
}

/**
 * Twin step recipes (the plan 12 fix wave 2 review): two step recipes that differ only in which of two goods they
 * consume, the same amount of it, both goods bought at the same price and with the same weights there (raw cost and
 * canonical rank; never a derived leaf, a free input, a gathered block the line may also make or a demanded good), on the
 * same map, power, held items, cleanroom and outputs and, with a build model, the same options, eligible options, pin
 * fallback and sharing key (never a step only owned machines can run). Every stage rates them alike, so the solver takes
 * one or the other by its numerics: on the 2.9 export the Fluid Extractor makes Molten Tin from Tin Dust or from a Tin
 * Ingot, and the user's reference line ran the ingot's at a 2 % step charge and the dust's at 50 %. A plan that runs a
 * twin whose good no column of `recipes` makes (it is only ever bought) does exactly as well with the other twin, buying
 * the other good instead, so the plan runs one twin of each set, the first of these (controller ruling 197 (1)): a
 * recipe the project pins (`pinned`; never moved); (a) one whose good the line also makes (the Alloy Smelter's Red Alloy
 * from a Copper Ingot, which the Bricked Blast Furnace makes beside Ferrosilite, never its Copper Dust twin); (b) one
 * whose good the plan already buys for another step (`plan`: what it buys of it beyond what the twins take of every good
 * their sets swap, so whichever twin the solver ran reads the same: an Electronic Circuit line at LV buys Copper Ingots
 * for its plates, so its Red Alloy takes one too); (c) the ingot's, then the dust's, then any other form's (`formRank`:
 * players stock ingots); (d) the lowest id. Sets of twins (`<map, power, …, the rest of the coefficients>` per good)
 * are taken in key order, and a twin of two sets may move in each (solder from 9 tin and 1 antimony, as dusts or ingots,
 * is a chain of two sets): `withTwinsMoved` follows the moves until none applies. Each move goes to the twin its set
 * ranks first, by the pin and the swapped good's own (a)–(c), then the id, so no move leads back and a chain ends on one
 * twin.
 */
export function twinMoves(
  graph: CandidateGraph, recipes: readonly LpRecipe[], demand: ReadonlyMap<StuffKey, number>, rules: TwinRules = {},
): TwinMove[] {
  const { model, plan } = rules;
  const pinned = rules.pinned ?? new Set<string>();
  const formRank = rules.formRank ?? ((): number => 0);
  const made = new Set<StuffKey>();
  for (const r of recipes) for (const [key, c] of r.coeffs) if (c > 0) made.add(key);
  /** What buying `key` weighs in every stage, when it may be swapped for another good: undefined when it may not. */
  const purchase = (key: StuffKey): string | undefined => {
    const good = graph.goods.get(key);
    if (good === undefined || !good.buyable || good.virtual || good.alsoMade === true || demand.has(key)) return undefined;
    if (good.leafClass === 'derived' || good.leafClass === 'free' || !Number.isFinite(good.cost)) return undefined;
    return `${good.cost}|${canonicalRank(key)}`;
  };
  type Member = { r: LpRecipe; key: StuffKey; amount: number };
  const sets = new Map<string, Member[]>();
  for (const r of recipes) {
    if (r.kind !== 'recipe') continue;
    for (const [key, c] of r.coeffs) {
      const weighs = c < 0 ? purchase(key) : undefined;
      if (weighs === undefined) continue;
      const rest = r.coeffs.filter(([k]) => k !== key);
      pushTo(sets, JSON.stringify([r.mapId, r.euPerRun, r.nonConsumed, r.needsCleanroom, r.supply === true, r.main ?? null, rest, c, weighs]), { r, key, amount: -c });
    }
  }
  /** A step recipe's machines as the build model has them; undefined for one only owned machines can run. */
  const machinesOf = (id: string): string | undefined => {
    if (model === undefined) return '';
    if (model.ownedOnly(id) !== undefined) return undefined;
    return JSON.stringify([model.sharingKey(id), model.options(id), model.eligible(id), model.pinFallback(id) ?? null]);
  };
  const twins = new Map<string, Member[]>();
  for (const [key, members] of sets) {
    if (members.length < 2) continue;
    for (const m of members) {
      const machines = machinesOf(m.r.id);
      if (machines !== undefined) pushTo(twins, `${key}|${machines}`, m);
    }
  }
  const stocked = plan === undefined ? new Set<StuffKey>() : stockedApart(plan, [...twins.values()].filter((members) => members.length >= 2));
  const rank = (m: Member): number[] => [pinned.has(m.r.id) ? 0 : 1, made.has(m.key) ? 0 : 1, stocked.has(m.key) ? 0 : 1, formRank(m.key)];
  const before = (a: Member, b: Member): number => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    return byString(a.r.id, b.r.id);
  };
  const moves: TwinMove[] = [];
  for (const key of [...twins.keys()].sort(byString)) {
    const members = (twins.get(key) as Member[]).slice().sort(before);
    if (members.length < 2) continue;
    const to = members[0] as Member;
    for (const m of members) {
      if (m === to || made.has(m.key) || pinned.has(m.r.id)) continue;
      moves.push({ recipe: m.r.id, to: to.r.id, from: m.key, into: to.key, amount: m.amount });
    }
  }
  return moves;
}

/**
 * The goods `plan` buys beyond what its twin recipes take of the goods their sets swap (`twinMoves` rule b): the twins of
 * one chain of sets (`sets`, joined where they share a recipe) are told apart by every good any of their sets swaps,
 * so what the plan buys of those for the twins it runs is left out, whichever of them the solver ran.
 */
function stockedApart(plan: Pick<Solution, 'runs' | 'buys'>, sets: ReadonlyArray<ReadonlyArray<{ r: LpRecipe; key: StuffKey }>>): Set<StuffKey> {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    return r;
  };
  const recipeOf = new Map<string, LpRecipe>();
  for (const members of sets) {
    for (const m of members) {
      recipeOf.set(m.r.id, m.r);
      if (!parent.has(m.r.id)) parent.set(m.r.id, m.r.id);
    }
    const first = root((members[0] as { r: LpRecipe }).r.id);
    for (const m of members) {
      const other = root(m.r.id);
      if (other !== first) parent.set(other, first);
    }
  }
  const swapped = new Map<string, Set<StuffKey>>();
  for (const members of sets) {
    const chain = root((members[0] as { r: LpRecipe }).r.id);
    let keys = swapped.get(chain);
    if (keys === undefined) swapped.set(chain, (keys = new Set()));
    for (const m of members) keys.add(m.key);
  }
  const apart = new Map(plan.buys);
  for (const [id, r] of recipeOf) {
    const runs = plan.runs.get(id) ?? 0;
    if (runs <= 0) continue;
    const keys = swapped.get(root(id)) as Set<StuffKey>;
    for (const [key, c] of r.coeffs) if (c < 0 && keys.has(key)) apart.set(key, (apart.get(key) ?? 0) + c * runs);
  }
  const stocked = new Set<StuffKey>();
  for (const [key, amount] of apart) if (amount > Math.max(TINY, RESIDUAL_REL * (plan.buys.get(key) ?? 0))) stocked.add(key);
  return stocked;
}

/** `map` with its keys in sorted order (as `kept` inserts them). */
function sortedMap<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  return new Map([...map].sort(([a], [b]) => byString(a, b)));
}

/**
 * The plan `sol` (an `ok` solution, maps at unit demand) with each twin it runs moved to the twin `moves` keeps
 * (`twinMoves`), in their order and again until none applies (a twin moved in one set may move on in another): the runs,
 * machines and sharing-pool place of `move.recipe` go to `move.to`, which buys `into` where it bought `from` — at the
 * same raw material and on the same machines, so no stage would rate it otherwise. A move whose twin runs too (a plan
 * that runs both) is left out, as is one whose good the plan buys less of than the twin takes. No move leads back
 * (`twinMoves`), so this ends. The stages themselves see every recipe: leaving a twin out of the LP changed which plan
 * the build MIP's root node found, and slowed it (Good Electronic Circuit at HV: 3.9 s instead of 2.4 s for the same
 * plan).
 */
export function withTwinsMoved(sol: Solution, moves: readonly TwinMove[]): Solution {
  let runs = sol.runs;
  let buys = sol.buys;
  let machines = sol.machines;
  let pools = sol.pools;
  /** Moves `move.recipe`'s runs to `move.to` when it applies; whether it did. */
  const apply = (move: TwinMove): boolean => {
    const t = runs.get(move.recipe);
    if (t === undefined || runs.has(move.to)) return false;
    const taken = move.amount * t;
    const had = buys.get(move.from) ?? 0;
    if (had < taken * (1 - RESIDUAL_REL) - TINY) return false;
    runs = new Map(runs);
    runs.delete(move.recipe);
    runs.set(move.to, t);
    runs = sortedMap(runs);
    buys = new Map(buys);
    const left = sig9(had - taken);
    if (left > TINY) buys.set(move.from, left);
    else buys.delete(move.from);
    buys.set(move.into, sig9((buys.get(move.into) ?? 0) + taken));
    buys = sortedMap(buys);
    const m = machines?.get(move.recipe);
    if (machines !== undefined && m !== undefined) {
      machines = new Map(machines);
      machines.delete(move.recipe);
      machines.set(move.to, m);
      machines = sortedMap(machines);
    }
    if (pools !== undefined && [...pools.values()].some((p) => p.steps.includes(move.recipe))) {
      pools = new Map([...pools].map(([key, p]) => [key, p.steps.includes(move.recipe)
        ? { ...p, steps: p.steps.map((id) => (id === move.recipe ? move.to : id)).sort(byString) } : p]));
    }
    return true;
  };
  // Each pass that moves a twin goes to one no worse (`twinMoves`), so at most one pass per move finds something to do.
  for (let pass = 0; pass <= moves.length; pass++) {
    let applied = false;
    for (const move of moves) if (apply(move)) applied = true;
    if (!applied) break;
  }
  if (runs === sol.runs) return sol;
  const out: Solution = { ...sol, runs, buys };
  if (machines !== undefined) out.machines = machines;
  if (pools !== undefined) out.pools = pools;
  return out;
}

/** A line that cannot be planned, with no blockers: empty maps, costs 0 (`Solution`). */
function infeasibleLine(warnings: PlanWarning[]): Solution {
  return { status: 'infeasible', runs: new Map(), buys: new Map(), sinks: new Map(), rawCost: 0, leastRawCost: 0, blockers: [], warnings };
}

/**
 * Rate mode with a build model (controller ruling OQ5 a, Amendment OQ3, ruling P2): each step recipe that can only run
 * on owned machines that cannot be built here (`BuildModel.ownedOnly`) runs at most what they do — `D·x_j ≤
 * runsPerSecond` as its column's upper bound in every stage. Returns the columns it bounds.
 */
function boundOwnedOnly(lp: MainLp, model: BuildModel, demandScale: number): number[] {
  const bounded: number[] = [];
  lp.recipes.forEach((r, j) => {
    const only = r.kind === 'recipe' ? model.ownedOnly(r.id) : undefined;
    if (only === undefined) return;
    lp.upper[j] = Math.max(0, only.runsPerSecond) / demandScale;
    bounded.push(j);
  });
  return bounded;
}

/**
 * The `owned-only` warnings (OQ5 a: `<good> needs more than your <n>× <machine>, which cannot be built here (<why>)`,
 * worded by planLine) of the bounded steps among `columns`, by column: `key` its main good, `text` the model's.
 */
function ownedOnlyWarnings(lp: MainLp, model: BuildModel, columns: readonly number[]): PlanWarning[] {
  return columns.flatMap((j): PlanWarning[] => {
    const r = lp.recipes[j];
    const only = r === undefined ? undefined : model.ownedOnly(r.id);
    if (r === undefined || only === undefined) return [];
    const key = r.main ?? r.coeffs.find(([, c]) => c > 0)?.[0];
    return [key === undefined ? { code: 'owned-only', text: only.text } : { code: 'owned-only', key, text: only.text }];
  });
}

/**
 * S1g (plan 12): the least raw material with gathered world blocks dug — S1 again with the step recipes whose `main`
 * the line may also buy (`GoodInfo.alsoMade`) left out, never below S1; S1 itself on a graph without such goods, or when
 * that LP does not solve (an `alsoMade` good keeps its purchase, so it solves whenever S1 does).
 */
async function leastDug(graph: CandidateGraph, lp: MainLp, s1: LpResult): Promise<number> {
  const off = new Set<number>();
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe' && r.main !== undefined && graph.goods.get(r.main)?.alsoMade === true) off.add(j);
  });
  if (off.size === 0) return s1.objective;
  const dug = await minimize(lp, lp.rawCost, [], Infinity, off);
  return dug.status === 'optimal' ? Math.max(dug.objective, s1.objective) : s1.objective;
}

/** The build MIP's input for a line whose S1 is `s1` (`BuildMipInput`). */
function buildInput(lp: MainLp, s1: LpResult, s1g: number, demandScale: number, model: BuildModel, opts: SolveOptions): BuildMipInput {
  const charge = opts.stepCharge ?? 0;
  return {
    lp, x1: s1.x, s1: s1.objective, s1g, columnCost: s1.objective > TINY ? relativeCosts(lp, s1) : [], derived: pricedDerived(lp),
    demandScale, model, stepCharge: Number.isFinite(charge) && charge > 0 ? charge : 0, handWeight: opts.handWeight ?? 1,
  };
}

/** The `build-cost-approx` warning, a fresh object per plan. */
function buildCostApprox(): PlanWarning {
  return { code: 'build-cost-approx', text: 'Weighing the build cost of new machines took too long; machine counts are rounded up from an estimate' };
}

/** The steps of `bounded` (`boundOwnedOnly`) that `x` runs. */
function ownedOnlyRuns(bounded: readonly number[], x: readonly number[]): number[] {
  return bounded.filter((j) => (x[j] ?? 0) > TINY);
}

/**
 * The build stage (plan 12 Task 4), when the model counts build cost, in place of R3's stages 2–4 (the charge MIP, its
 * fallback and consolidation; or plan 09's fewest recipes when S1 needs no raw material): S1g, then the build-cost MIP
 * started from the cheaper by its own objective of `roundUp` of S1 and of plan 09's sparse plan (none when both leave a
 * step short; without S1's the MIP has no derived-purchase binaries, whose bound comes from that start: `buildMip`), which
 * its node and simplex-iteration limits decide (BUILD_MIP_MAX_NODES, BUILD_MIP_MAX_LP_ITERATIONS) and a far time guard
 * only backs up. A
 * MIP that ends without a whole solution, or that the guard stops (or `buildTimeLimit ≤ 0`), gives way to the cheapest
 * by the MIP's objective (`rounded`) of plan 09's plan of the line ("Ignore build cost", `finish`), its LP relaxation
 * and S1, each rounded up to whole machines (the relaxation's at its options of most new capacity, the others at each
 * step's cheapest; fix wave 2 (b)) and covering the steps that can only use owned machines, with the
 * `build-cost-approx` warning. A decision that leaves a step short (the owned machines of one type cannot cover the
 * steps that can only use them) ends the line, with the `owned-only` warnings of the bounded steps S1 runs. Then R3's
 * stage 5 inside the
 * decision: the step recipes outside its support off, its machines in every stage (`laterRoom`: a sharing pool's steps
 * share all of its room), the least raw material over that, each purchase of a good a step of it makes shut where the
 * line does as well without it within those machines and the owned ones the decision leaves idle
 * (`withoutTiedPurchases`, plan 09's one source at a tie: the `base`), power and the canonical form with the raw material
 * locked at the base's, the latest that balances — the decision's own columns last, never S1 (which may run steps past
 * the machines it bought). A tie that needs a new machine (its build and the step charge on its block) is the build
 * MIP's to weigh.
 */
async function buildStage(
  graph: CandidateGraph, lp: MainLp, s1: LpResult, warnings: PlanWarning[], opts: SolveOptions, model: BuildModel, demandScale: number,
  bounded: readonly number[],
): Promise<Solution> {
  const input = buildInput(lp, s1, await leastDug(graph, lp, s1), demandScale, model, opts);
  const mip = buildMip(input);
  // The MIP's start: S1 rounded up, or plan 09's sparse plan within the step charge's cap (`sparseWithin`) rounded up
  // when that costs less in the MIP's own objective — S1 runs every step of the least raw material, the most a plan of
  // the line has, so the sparse one is far closer to what the MIP plans.
  const sparse = await sparseWithin(lp, (1 + STEP_CHARGE_CAP) * s1.objective);
  const alternative = sparse === null ? undefined : mip.startAt(sparse);
  const start = alternative !== undefined && alternative.cost < mip.startCost ? alternative.start : mip.start;
  const notes = [...warnings];
  const limit = opts.buildTimeLimit ?? BUILD_MIP_TIME_LIMIT_SECONDS;
  let result: LpResult | undefined;
  let seconds = 0;
  if (limit > 0) {
    const began = performance.now();
    result = await solveLp({
      ...mip.model, ...(start === undefined ? {} : { start }),
      maxNodes: opts.buildMaxNodes ?? BUILD_MIP_MAX_NODES, maxIterations: opts.buildMaxIterations ?? BUILD_MIP_MAX_LP_ITERATIONS, timeLimit: limit,
    });
    seconds = (performance.now() - began) / 1000;
  }
  let decision: BuildDecision;
  let from: readonly number[];
  let approx = false;
  if (result !== undefined && (result.status === 'optimal' || (result.status === 'feasible' && result.stop !== 'time'))) {
    decision = mip.decode(result.x);
    from = result.x;
  } else {
    approx = true;
    notes.push(buildCostApprox());
    const m = mip.model;
    const relaxation: LpModel = { sense: m.sense, colCost: m.colCost, colLower: m.colLower, colUpper: m.colUpper, rows: m.rows };
    const relaxed = await solveLp(relaxation);
    // Fix wave 2 (b): beside the relaxation and S1, plan 09's plan of the same graph ("Ignore build cost": its charged
    // stage, with the owned-only bounds), each rounded up to whole machines — the relaxation's at its options of most new
    // capacity, the others at each step's cheapest option — and the one the build MIP's objective rates lowest kept (ties:
    // plan 09's, which has the fewest steps, then the relaxation's, then S1's). The relaxation spreads a step's fixed
    // costs over runs far below one machine's, so its rounding can build machines a plan of fewer steps does without.
    const ignored = await finish(lp, s1, [], opts);
    const candidates: Array<{ decision: BuildDecision; cost: number; from: readonly number[] }> = [
      { ...mip.rounded(ignored.x), from: ignored.x },
      ...(relaxed.status === 'optimal' ? [{ ...mip.rounded(relaxed.x, mip.prefer(relaxed.x)), from: relaxed.x }] : []),
      { ...mip.rounded(s1.x), from: s1.x },
    ];
    let kept: (typeof candidates)[number] | undefined;
    for (const c of candidates) if (c.decision.short === undefined && (kept === undefined || c.cost < kept.cost)) kept = c;
    // When none covers the steps on owned machines, any of them ends the line below the same way: S1's.
    kept ??= candidates[candidates.length - 1] as (typeof candidates)[number];
    decision = kept.decision;
    from = kept.from;
  }
  const buildStats: NonNullable<Solution['buildStats']> = { seconds, nodes: result?.nodes ?? 0, status: result?.status ?? 'skipped', approx };
  if (result?.stop !== undefined) buildStats.stop = result.stop;
  if (result !== undefined && result.x.length > 0) {
    buildStats.objective = mip.exactCost(result.x);
    if (result.bound !== undefined) buildStats.bound = result.bound;
  }
  if (decision.short !== undefined) {
    const sol = infeasibleLine([...warnings, ...ownedOnlyWarnings(lp, model, ownedOnlyRuns(bounded, s1.x))]);
    sol.buildStats = buildStats;
    return sol;
  }

  const room = laterRoom(input, decision);
  const outside = new Set<number>();
  lp.recipes.forEach((r, j) => {
    if (r.kind === 'recipe' && !decision.support.has(j)) outside.add(j);
  });
  const own = from.slice(0, lp.rawCost.length);
  let ownRaw = 0;
  lp.rawCost.forEach((c, j) => {
    ownRaw += c * (own[j] ?? 0);
  });
  const stages: LpResult[] = [];
  const rows = room.rows();
  const least = await minimize(lp, lp.rawCost, rows, Infinity, outside);
  // Plan 09's one source at a tie (`withoutTiedPurchases`) within the decision's machines and those that cost nothing
  // more, before power and the canonical form, which broke such a tie towards buying a good beside the step that makes it.
  const { off, base, locks: kept } = least.status === 'optimal'
    ? await withoutTiedPurchases(lp, outside, least, room) : { off: outside, base: least, locks: rows };
  if (base.status === 'optimal') {
    const locks = [...kept, ...lockRow(lp.rawCost, base.objective)];
    const s2 = await minimize(lp, lp.power, locks, Infinity, off);
    if (s2.status === 'optimal') locks.push(...lockRow(lp.power, s2.objective));
    const s4 = await minimize(lp, lp.canonical, locks, Infinity, off);
    if (s4.status === 'optimal') stages.push(s4);
    if (s2.status === 'optimal') stages.push(s2);
    stages.push(base);
  }
  stages.push({ status: 'feasible', objective: ownRaw, x: own });
  const { sol } = settled(lp, s1, stages, notes);
  sol.machines = decision.machines;
  sol.pools = decision.pools;
  sol.cleanroom = decision.cleanroom;
  sol.buildStats = buildStats;
  return sol;
}

/**
 * Plan 09's pick among a step's options that can add machines, for "Ignore build cost" (ruling P2): a singleblock before a
 * multiblock (`pickMachine` takes a multiblock only where no singleblock runs the recipe), then one of a type the group
 * owns, then the highest tier, then the lowest mteId — a pin has already narrowed the options to the tier rule 6 keeps.
 * Its index in `options`; undefined when none can add.
 */
function planPick(options: readonly MachineOption[]): number | undefined {
  const before = (a: MachineOption, b: MachineOption): number =>
    Number(b.kind === 'basic') - Number(a.kind === 'basic') || Number(b.owned > 0) - Number(a.owned > 0) || b.tier - a.tier || a.mteId - b.mteId;
  return options.map((o, i) => ({ o, i })).filter(({ o }) => o.canAdd).sort((a, b) => before(a.o, b.o))[0]?.i;
}

/**
 * "Ignore build cost" with a model (ruling P2): plan 09's plan, whose stages kept the owned-only bounds, gets its
 * machines from `roundUp` of its columns with plan 09's pick (`planPick`) for new ones; a step it leaves short ends the
 * line with the `owned-only` warnings of the bounded steps S1 runs. No build MIP, so no `buildStats`.
 */
function sized(
  lp: MainLp, s1: LpResult, plan: { sol: Solution; x: readonly number[] }, warnings: PlanWarning[], opts: SolveOptions, model: BuildModel,
  demandScale: number, bounded: readonly number[],
): Solution {
  const input = buildInput(lp, s1, s1.objective, demandScale, model, opts);
  const decision = roundUp(input, plan.x, (j) => planPick(model.options(lp.recipes[j]?.id ?? '')));
  if (decision.short !== undefined) return infeasibleLine([...warnings, ...ownedOnlyWarnings(lp, model, ownedOnlyRuns(bounded, s1.x))]);
  const { sol } = plan;
  sol.machines = decision.machines;
  sol.pools = decision.pools;
  sol.cleanroom = decision.cleanroom;
  return sol;
}

/**
 * A probe's answer (`SolveOptions.probe`, fix spec R3): S1's plan as it stands, no later stage; its raw material is the
 * least (`rawCost` = `leastRawCost`).
 */
function probed(lp: MainLp, s1: LpResult, warnings: PlanWarning[]): Solution {
  let rawCost = 0;
  lp.rawCost.forEach((c, j) => {
    rawCost += c * (s1.x[j] ?? 0);
  });
  const least = sig9(Math.min(s1.objective, rawCost));
  return {
    status: 'ok', runs: kept(lp.recipes.map((r) => r.id), s1.x, 0), buys: kept(lp.buyKeys, s1.x, lp.firstBuy),
    sinks: kept(lp.goods, s1.x, lp.firstSink), rawCost: least, leastRawCost: least, blockers: [], warnings,
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
 * With `opts.stepCharge` above 0 S3 is the step charge instead (fix spec R3): each step recipe must save that share of
 * S1 to be built (a crafting-table one `opts.handWeight` times it), never above STEP_CHARGE_CAP over S1; without it
 * (0) the same stage keeps raw material at S1's and weighs every step recipe alike (`LEAST_RAW_STEP`), for as few
 * recipes as the least raw material allows. `opts.probe` stops after S1 (and the loop guard).
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
 *
 * Plan 12, with `opts.build` (architecture §11.39): in rate mode each step that can only run on owned machines that
 * cannot be built is bounded by them in every stage (`boundOwnedOnly`); when that makes S1 infeasible and S1 without
 * the bounds solves, the line is infeasible with an `owned-only` warning for each such step that S1 runs past its bound.
 * When the model counts build cost (`buildCounts`) the build stage replaces R3's stages 2–4 (`buildStage`); with build
 * cost ignored plan 09's stages run and their plan's machines are sized (`sized`). Machine counts are absolute (the
 * build stage works with the demand scale), so they are not scaled back.
 */
export async function solveLine(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>, opts: SolveOptions = {}): Promise<Solution> {
  let scale = 0;
  for (const amount of demand.values()) scale = Math.max(scale, Math.abs(amount));
  if (!(scale > 0) || !Number.isFinite(scale) || scale === 1) return solveUnit(graph, demand, opts, 1);
  const unit = new Map([...demand].map(([key, amount]): [StuffKey, number] => [key, amount / scale]));
  const sol = await solveUnit(graph, unit, opts, scale);
  const times = <K>(values: ReadonlyMap<K, number>): Map<K, number> => new Map([...values].map(([key, v]): [K, number] => [key, sig9(v * scale)]));
  return {
    ...sol, runs: times(sol.runs), buys: times(sol.buys), sinks: times(sol.sinks),
    rawCost: sig9(sol.rawCost * scale), leastRawCost: sig9(sol.leastRawCost * scale),
  };
}

/**
 * `solveLine` at the demand given (unit demand, or a demand that cannot be scaled), `demandScale` the factor that
 * scales it back.
 */
async function solveUnit(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>, opts: SolveOptions, demandScale: number): Promise<Solution> {
  const banned: string[] = [];
  const bannedSet = new Set<string>();
  const loopWarnings = (): PlanWarning[] => (banned.length === 0 ? [] : [{
    code: 'free-loop',
    text: `Ignored ${banned.length === 1 ? '1 recipe' : `${banned.length} recipes`} that make ${graph.targets.join(', ')} from nothing (likely a recipe data loop): ${cappedList(banned)}`,
  }]);
  const infeasible = (blockers: Blocker[], warnings: PlanWarning[]): Solution => ({
    status: 'infeasible', runs: new Map(), buys: new Map(), sinks: new Map(), rawCost: 0, leastRawCost: 0, blockers, warnings, banned: [...banned],
  });
  const model = opts.build;
  for (let round = 0; ; round++) {
    const recipes = graph.recipes.filter((r) => !bannedSet.has(r.id));
    const lp = mainLp(graph, recipes, demand);
    const bounded = model !== undefined && model.mode === 'rate' ? boundOwnedOnly(lp, model, demandScale) : [];
    const s1 = await minimize(lp, lp.rawCost, []);
    if (s1.status === 'error') throw new Error('rate solver: the raw-material LP failed');
    // Costs are ≥ 0, so S1 is bounded below: an "unbounded or infeasible" answer can only mean infeasible.
    if (s1.status !== 'optimal') {
      if (model !== undefined && bounded.length > 0) {
        // The owned machines that cannot be built are too few when the line plans without their bounds.
        const free = await minimize({ ...lp, upper: new Array<number>(lp.upper.length).fill(Infinity) }, lp.rawCost, []);
        if (free.status === 'optimal') {
          const past = bounded.filter((j) => (free.x[j] ?? 0) > (lp.upper[j] as number) + TINY);
          return infeasible([], [...loopWarnings(), ...ownedOnlyWarnings(lp, model, past.length > 0 ? past : ownedOnlyRuns(bounded, free.x))]);
        }
      }
      return infeasible(graph.truncated === true ? [] : findBlockers({ ...graph, recipes }), loopWarnings());
    }
    const loop = s1.objective <= ZERO_RAW ? await freeLoop(lp) : [];
    if (loop.length === 0) {
      let done: Solution;
      if (opts.probe === true) done = probed(lp, s1, loopWarnings());
      else if (model !== undefined && buildCounts(model)) done = await buildStage(graph, lp, s1, loopWarnings(), opts, model, demandScale, bounded);
      else {
        const plan = await finish(lp, s1, loopWarnings(), opts);
        done = model === undefined ? plan.sol : sized(lp, s1, plan, loopWarnings(), opts, model, demandScale, bounded);
      }
      // Of two twins every stage rates alike, the plan runs the same one whichever the solver met (`twinMoves`).
      if (done.status === 'ok') {
        done = withTwinsMoved(done, twinMoves(graph, recipes, demand, { model, pinned: opts.pinnedRecipes, plan: done, formRank: opts.formRank }));
      }
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

/**
 * Forward fixpoint: buyable goods (and `given` ones) are makeable; a recipe fires once every good it consumes is; its
 * outputs then are.
 */
function makeableGoods(graph: CandidateGraph, given: readonly StuffKey[] = []): Set<StuffKey> {
  const makeable = new Set<StuffKey>();
  const queue: StuffKey[] = [];
  const add = (key: StuffKey): void => {
    if (!makeable.has(key)) {
      makeable.add(key);
      queue.push(key);
    }
  };
  for (const key of given) add(key);
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

/**
 * Why `key` blocks: out of reach (`unavailable`), its recipes cannot run here (`rejected`, with the lowest tier one of
 * them names and, plan 12, the first reason by recipe id that a machine one needs cannot be built here), else none
 * makes it (`no-recipe`).
 */
function blockerFor(graph: CandidateGraph, key: StuffKey): Blocker {
  if (graph.goods.get(key)?.leafClass === 'unavailable') return { key, reason: 'unavailable' };
  const rejected = graph.blocked.get(key);
  if (rejected === undefined) return { key, reason: 'no-recipe' };
  const tiers = rejected.flatMap((b) => (b.needTier === undefined ? [] : [b.needTier]));
  const blocker: Blocker = tiers.length > 0 ? { key, reason: 'rejected', needTier: Math.min(...tiers) } : { key, reason: 'rejected' };
  const machine = [...rejected].sort((a, b) => byString(a.recipeId, b.recipeId)).find((b) => b.machine !== undefined)?.machine;
  if (machine !== undefined) blocker.machine = machine;
  return blocker;
}

/** The recipes of `graph` that make each good (a positive coefficient), in graph order. */
function producersIn(graph: CandidateGraph): Map<StuffKey, LpRecipe[]> {
  const producers = new Map<StuffKey, LpRecipe[]>();
  for (const r of graph.recipes) for (const [key, c] of r.coeffs) if (c > 0) pushTo(producers, key, r);
  return producers;
}

/**
 * The walk back from a good the makeable fixpoint misses, through the producers of the goods it misses: `found` holds
 * each good it meets that has no producer in the graph or is a base material out of reach (`leafClass` 'unavailable'),
 * in the order met, and it does not go past one; `seen` every good it visited, in that order.
 */
function walkBack(
  graph: CandidateGraph, from: StuffKey, makeable: ReadonlySet<StuffKey>, producers: ReadonlyMap<StuffKey, readonly LpRecipe[]>,
): { found: StuffKey[]; seen: Set<StuffKey> } {
  const seen = new Set<StuffKey>();
  const found: StuffKey[] = [];
  const stack = [from];
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
  return { found, seen };
}

/**
 * What stops `from` being made: `findBlockers`' walk from it, without its fallback — the goods the walk meets that
 * nothing in the graph makes or that are base materials out of reach (`leafClass` 'unavailable'), sorted by key. `[]`
 * when `from` is makeable, and when the walk meets only goods on loops with no way in (made, and nothing out of reach,
 * yet nothing grounds them). Machine prices tell a machine that cannot be built from a pricing gap by it (build-cost.ts).
 */
export function deadEnds(graph: CandidateGraph, from: StuffKey): StuffKey[] {
  const makeable = makeableGoods(graph);
  if (makeable.has(from)) return [];
  return walkBack(graph, from, makeable, producersIn(graph)).found.sort(byString);
}

/**
 * The goods of `ends` (`deadEnds(graph, from)`) each of which alone, were it makeable, would make `from` makeable (the
 * fixpoint again with it given), sorted by key — such as the one good every route needs where one route also meets dead
 * ends of its own: on the 2.9 export the Emitter (MV) is made in an assembler from "Any MV Circuit" (whose recipes take
 * reactor sensor location cards nothing makes) or in a crafting table from a Good Electronic Circuit, both with an Ender
 * Pearl, and only the pearl alone would let it be made. [] when no one good does.
 */
export function deadEndsAlone(graph: CandidateGraph, from: StuffKey, ends: readonly StuffKey[]): StuffKey[] {
  return ends.filter((key) => makeableGoods(graph, [key]).has(from)).sort(byString);
}

/** Whether `from` is makeable in `graph` with the goods of `given` made available (the makeable fixpoint with them). */
export function makeableWith(graph: CandidateGraph, from: StuffKey, given: readonly StuffKey[]): boolean {
  return makeableGoods(graph, given).has(from);
}

/**
 * Why the targets cannot be made. Each target the makeable fixpoint misses is walked on its own (`deadEnds`' walk, over
 * one fixpoint for all targets), through the producers of the goods the fixpoint misses. A good it misses is a blocker
 * when it has no producer in the graph or is a base material out of reach (`leafClass` 'unavailable'); the walk does not
 * go past a blocker. A walk that finds none only met goods on no-gain cycles (ingot <-> block, nugget or molten), so its
 * blockers are the goods it visited that have a `blocked` entry, or else the target itself. Reasons: `unavailable`, else
 * `rejected` (its recipes cannot run here; `needTier` is the lowest tier one of them names), else `no-recipe`. All
 * targets together, sorted by key, at most 5.
 */
export function findBlockers(graph: CandidateGraph): Blocker[] {
  const makeable = makeableGoods(graph);
  const producers = producersIn(graph);
  const blockers = new Map<StuffKey, Blocker>();
  for (const target of new Set(graph.targets)) {
    if (makeable.has(target)) continue;
    const { found, seen } = walkBack(graph, target, makeable, producers);
    const named = found.length > 0 ? found : [...seen].filter((key) => graph.blocked.has(key));
    for (const key of named.length > 0 ? named : [target]) blockers.set(key, blockerFor(graph, key));
  }
  return [...blockers.values()].sort((a, b) => byString(a.key, b.key)).slice(0, MAX_BLOCKERS);
}
