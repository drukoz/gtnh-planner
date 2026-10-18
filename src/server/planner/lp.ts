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
  /** Seconds the solve may take; a MIP that runs out keeps its best whole solution (`feasible`), if it found one. */
  timeLimit?: number;
}
/**
 * `objective` and `x` (one value per column) are meaningful only when `optimal`, or `feasible` (a MIP that stopped at
 * its node or time limit with a whole solution); otherwise they are NaN and `[]`.
 */
export interface LpResult { status: 'optimal' | 'feasible' | 'infeasible' | 'unbounded' | 'error'; objective: number; x: number[] }

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

export async function solveLp(model: LpModel): Promise<LpResult> {
  if (model.colCost.length === 0) return solveEmpty(model);
  // A solve is synchronous WebAssembly: yield first, so a plan of a dozen solves never holds the thread for all of them.
  await yieldToEventLoop();
  const highs = await runtime();
  const data = modelData(highs, model);
  const statuses = highs.constants.modelStatus;
  return highs.withModel((m): LpResult => {
    m.options.set({
      output_flag: false,
      ...(model.timeLimit === undefined ? {} : { time_limit: model.timeLimit }),
      ...(model.maxNodes === undefined ? {} : { mip_max_nodes: model.maxNodes, mip_rel_gap: 0, mip_feasibility_tolerance: 1e-10 }),
    });
    m.passModel(data);
    try {
      m.run();
    } catch {
      return notOptimal('error');   // a native solver failure; malformed input already threw in passModel
    }
    switch (m.getModelStatus()) {
      case statuses.optimal:
        return { status: 'optimal', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue) };
      case statuses.infeasible:
        return notOptimal('infeasible');
      case statuses.unbounded:
      case statuses.unboundedOrInfeasible:
        return notOptimal('unbounded');
      default:
        // A MIP stopped by its node or time limit keeps its best whole solution, if it found one (status 2 = feasible).
        if (model.integer !== undefined && Number(m.info.get('primal_solution_status')) === 2) {
          return { status: 'feasible', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue) };
        }
        return notOptimal('error');
    }
  });
}
