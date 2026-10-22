// The LP solver (web-stack §6): HiGHS compiled to WebAssembly, behind one small dense-bounds, sparse-rows model shape.
// This is the only module that imports `highs`. Rows are scaled before the solve because planner quantities range from
// 0.05 dust to 20,000 L (prior-art §3.4); scaling a row changes neither the solution nor the objective.

import highsDefault from 'highs';
import type { Highs, ModelData } from 'highs';

// web-stack §6.1: under `nodenext` the package's types describe the default import as the module object, while Node
// loads build/highs.mjs, whose default export is the loader itself.
const loadHighs = highsDefault as unknown as typeof highsDefault.default;

/** `lower ≤ Σ coefficient · x[column] ≤ upper`; ±Infinity for a missing bound; each column at most once per row. */
export interface LpRow { lower: number; upper: number; entries: Array<[number /* column */, number /* coefficient */]> }
export interface LpModel {
  sense: 'min' | 'max'; colCost: number[]; colLower: number[]; colUpper: number[] /* Infinity allowed */; rows: LpRow[];
  // optional additions (fewest recipes, solve.ts; Make N's whole runs, make-n.ts)
  /** Per column, whether it must be a whole number: the model is then a MIP. */
  integer?: readonly boolean[];
  /** A MIP stops after this many branch-and-bound nodes (deterministic, unlike a time limit) with its best solution. */
  maxNodes?: number;
  // optional addition (the plan 12 fix wave: the build MIP's work bound)
  /**
   * A MIP stops at the first of HiGHS's interrupt checkpoints where its simplex iterations (`mip_total_lp_iterations`, its
   * root node's cuts and heuristics included) reach this, with its best whole solution: like `maxNodes` a deterministic
   * bound, and one that also bounds the work inside a node (`stop: 'limit'`).
   */
  maxIterations?: number;
  /** Seconds the solve may take; a MIP that runs out keeps its best whole solution (`feasible`), if it found one. */
  timeLimit?: number;
  // optional addition (the step-charge MIP, solve.ts; fix spec R3)
  /**
   * A start solution, one value per column (HiGHS `setSolution`): a MIP whose node limit stops it before it finds a
   * better whole solution keeps this one (`feasible`). Only rows are scaled, so the columns' values need no scaling.
   */
  start?: number[];
}
/**
 * `objective` and `x` (one value per column) are meaningful only when `optimal`, or `feasible` (a MIP that stopped at
 * its node or time limit with a whole solution); otherwise they are NaN and `[]`.
 */
export interface LpResult {
  status: 'optimal' | 'feasible' | 'infeasible' | 'unbounded' | 'error'; objective: number; x: number[];
  // optional additions (the build-cost MIP, build-mip.ts; plan 12)
  /** Why a `feasible` MIP stopped: its time limit (`'time'`), else its node limit (`'limit'`; HiGHS says `solutionLimit`). */
  stop?: 'time' | 'limit';
  /** The branch-and-bound nodes a MIP used (HiGHS's `mip_node_count`), on every result of a model with `integer`. */
  nodes?: number;
  // optional addition (the plan 12 fix wave: the build MIP's gap, for its stats)
  /** A MIP's best proven bound on the objective (HiGHS's `mip_dual_bound`), on an `optimal` or `feasible` result. */
  bound?: number;
}

let loading: Promise<Highs> | null = null;

/** The HiGHS runtime, loaded once per process; a failed load is retried by the next call. */
function runtime(): Promise<Highs> {
  loading ??= loadHighs().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

function notOptimal(status: Exclude<LpResult['status'], 'optimal'>): LpResult {
  return { status, objective: NaN, x: [] };
}

/** Rows scaled by `1 / max(1, max |coefficient|)`, bounds too, as a CSC matrix. Throws RangeError for a malformed row. */
function modelData(highs: Highs, model: LpModel): ModelData {
  const numCols = model.colCost.length;
  const numRows = model.rows.length;
  const scale = new Float64Array(numRows);
  const rowLower = new Float64Array(numRows);
  const rowUpper = new Float64Array(numRows);
  const starts = new Int32Array(numCols + 1);
  const lastRow = new Int32Array(numCols).fill(-1);

  model.rows.forEach((row, r) => {
    let largest = 0;
    for (const [col, coefficient] of row.entries) {
      if (!Number.isInteger(col) || col < 0 || col >= numCols) throw new RangeError(`LP row ${r}: column ${col} is not in 0..${numCols - 1}`);
      if (!Number.isFinite(coefficient)) throw new RangeError(`LP row ${r}: coefficient of column ${col} is ${coefficient}`);
      if (lastRow[col] === r) throw new RangeError(`LP row ${r}: column ${col} appears twice`);
      lastRow[col] = r;
      largest = Math.max(largest, Math.abs(coefficient));
      starts[col + 1] = (starts[col + 1] as number) + 1;
    }
    const s = 1 / Math.max(1, largest);
    scale[r] = s;
    rowLower[r] = row.lower * s;
    rowUpper[r] = row.upper * s;
  });
  for (let col = 0; col < numCols; col++) starts[col + 1] = (starts[col + 1] as number) + (starts[col] as number);

  const nonZeros = starts[numCols] as number;
  const indices = new Int32Array(nonZeros);
  const values = new Float64Array(nonZeros);
  const next = starts.slice(0, numCols);
  model.rows.forEach((row, r) => {
    for (const [col, coefficient] of row.entries) {
      const at = next[col] as number;
      next[col] = at + 1;
      indices[at] = r;
      values[at] = coefficient * (scale[r] as number);
    }
  });

  const data: ModelData = {
    numCols, numRows,
    sense: model.sense === 'max' ? highs.constants.objectiveSense.maximize : highs.constants.objectiveSense.minimize,
    colCost: Float64Array.from(model.colCost), colLower: Float64Array.from(model.colLower), colUpper: Float64Array.from(model.colUpper),
    rowLower, rowUpper,
    matrix: { format: 'csc', numRows, numCols, starts, indices, values },
  };
  if (model.integer === undefined) return data;
  const { integer, continuous } = highs.constants.variableType;
  return { ...data, integrality: Int32Array.from(model.integer, (whole) => (whole ? integer : continuous)) };
}

/** A model without columns: every row's activity is 0 (HiGHS reports such a model as "empty" without checking rows). */
function solveEmpty(model: LpModel): LpResult {
  const feasible = model.rows.every((row) => row.lower <= 0 && row.upper >= 0);
  return feasible ? { status: 'optimal', objective: 0, x: [] } : notOptimal('infeasible');
}

/** Lets the event loop run queued I/O (other requests, SSE, ticks) before the next synchronous stretch of planning. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Throws RangeError for a start that does not give every column one finite value. */
function checkStart(model: LpModel): void {
  const start = model.start;
  if (start === undefined) return;
  if (start.length !== model.colCost.length) throw new RangeError(`LP start has ${start.length} values for ${model.colCost.length} columns`);
  start.forEach((value, col) => {
    if (!Number.isFinite(value)) throw new RangeError(`LP start: column ${col} is ${value}`);
  });
}

export async function solveLp(model: LpModel): Promise<LpResult> {
  if (model.colCost.length === 0) return solveEmpty(model);
  checkStart(model);
  // A solve is synchronous WebAssembly: yield first, so a plan of a dozen solves never holds the thread for all of them.
  await yieldToEventLoop();
  const highs = await runtime();
  const data = modelData(highs, model);
  const statuses = highs.constants.modelStatus;
  return highs.withModel((m): LpResult => {
    m.options.set({
      output_flag: false,
      ...(model.timeLimit === undefined ? {} : { time_limit: model.timeLimit }),
      ...(model.maxNodes === undefined ? {} : { mip_max_nodes: model.maxNodes, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-10 }),
    });
    m.passModel(data);
    if (model.start !== undefined) {
      try {
        m.setSolution({ colValue: Float64Array.from(model.start) });
      } catch {
        // A start HiGHS refuses (its shape was checked above) only loses the head start: the model solves without it.
      }
    }
    /** A MIP's result carries the nodes it used and, with a solution, its bound, when HiGHS can say. */
    const withNodes = (result: LpResult): LpResult => {
      if (model.integer === undefined) return result;
      let out = result;
      try {
        out = { ...out, nodes: Number(m.info.get('mip_node_count')) };
        const bound = Number(m.info.get('mip_dual_bound'));
        if (result.x.length > 0 && Number.isFinite(bound)) out = { ...out, bound };
      } catch {
        // the counts are only stats
      }
      return out;
    };
    const most = model.maxIterations;
    try {
      if (most === undefined) {
        m.run();
      } else {
        m.run({ [highs.constants.callbackType.mipInterrupt]: (event) => {
          if (Number(event.data.mip_total_lp_iterations ?? 0) >= most) event.interrupt();
        } });
      }
    } catch {
      return withNodes(notOptimal('error'));   // a native solver failure; malformed input already threw in passModel
    }
    const status = m.getModelStatus();
    switch (status) {
      case statuses.optimal:
        return withNodes({ status: 'optimal', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue) });
      case statuses.infeasible:
        return withNodes(notOptimal('infeasible'));
      case statuses.unbounded:
      case statuses.unboundedOrInfeasible:
        return withNodes(notOptimal('unbounded'));
      default:
        // A MIP stopped by its node or time limit keeps its best whole solution, if it found one (status 2 = feasible).
        if (model.integer !== undefined && Number(m.info.get('primal_solution_status')) === 2) {
          return withNodes({
            status: 'feasible', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue),
            stop: status === statuses.timeLimit ? 'time' : 'limit',
          });
        }
        return withNodes(notOptimal('error'));
    }
  });
}
