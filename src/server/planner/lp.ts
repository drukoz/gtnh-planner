// The LP solver (web-stack §6): HiGHS compiled to WebAssembly, behind one small dense-bounds, sparse-rows model shape.
// This is the only module that imports `highs`. Rows are scaled before the solve because planner quantities range from
// 0.05 dust to 20,000 L (prior-art §3.4); scaling a row changes neither the solution nor the objective. A model may also
// be solved on a worker thread that loads this module with its own HiGHS runtime (`solveLpAside`, and a build MIP's
// solves together: `solveBuildRunsAside`; the bootstrap at the end), while this thread solves others.

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
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
  // optional additions (plan 12 fix wave 3 (F): the build MIP's robust pick)
  /** A MIP's feasibility and integrality tolerance (HiGHS `mip_feasibility_tolerance`); absent: MIP_FEASIBILITY_TOLERANCE. */
  feasibilityTolerance?: number;
  /**
   * False: no strong branching (HiGHS `mip_pscost_minreliable` 0). Strong branching's simplex iterations reach no
   * interrupt checkpoint's count until its node ends (measured: 107,176 of them past a 50,000 cap, 23 s), so only without
   * it does `maxIterations` bound the work of nodes after the root.
   */
  strongBranching?: boolean;
  /**
   * A MIP stops at its first interrupt checkpoint after simplex iterations whose dual bound is not finite: its root LP
   * relaxation did not solve at `feasibilityTolerance` (every model this is set on has a finite LP bound), so its search
   * would run without a bound, cuts or LP-guided heuristics. The result says so (`rootLpFailed`).
   */
  stopOnRootLpFailure?: boolean;
  /** Keep every improving whole solution HiGHS reports, in order (`LpResult.improving`). */
  keepImproving?: boolean;
  // optional addition (release gate round 2, G1: the lite start)
  /**
   * A MIP's cutoff (HiGHS `objective_bound`): its LP solves stop where their objective reaches this, so its search prunes
   * every node no better than it — the objective of a plan known beside the solve, which then needs no start
   * (`BuildRunsJob.cutoff`). Its heuristics may still report a whole solution no better than it; with none it is
   * `infeasible` where its root LP relaxation is no better, and `error` with `stop` where its limits (or the time guard)
   * ended it first; a plain `error` (no `stop`) where HiGHS failed, as without a cutoff.
   */
  objectiveBound?: number;
  /** False: a MIP never restarts its root after it fixes columns (HiGHS `mip_allow_restart`); absent: HiGHS's default (it may). */
  allowRestart?: boolean;
}
/** The integrality and feasibility tolerance of every MIP with `maxNodes` unless the model sets one (523d6be: a binary at 1e-7 is not 0). */
export const MIP_FEASIBILITY_TOLERANCE = 1e-10;
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
  // optional additions (plan 12 fix wave 3 (F))
  /** `stopOnRootLpFailure` stopped it: its root LP relaxation did not solve (its `x`, if any, is the start's). */
  rootLpFailed?: true;
  /** With `keepImproving`: the whole solutions HiGHS found better than the one before, in order (the last is `x` unless it stopped on time). */
  improving?: number[][];
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

/**
 * The HiGHS options of `model`: no output; its time limit; with `maxNodes` the node limit, both gaps 0 and its
 * feasibility tolerance (`feasibilityTolerance`, else MIP_FEASIBILITY_TOLERANCE); without strong branching when
 * `strongBranching` is false.
 */
export function highsOptions(model: LpModel): Record<string, number | boolean> {
  return {
    output_flag: false,
    ...(model.timeLimit === undefined ? {} : { time_limit: model.timeLimit }),
    ...(model.maxNodes === undefined ? {} : {
      mip_max_nodes: model.maxNodes, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: model.feasibilityTolerance ?? MIP_FEASIBILITY_TOLERANCE,
    }),
    ...(model.strongBranching === false ? { mip_pscost_minreliable: 0 } : {}),
    ...(model.objectiveBound === undefined ? {} : { objective_bound: model.objectiveBound }),
    ...(model.allowRestart === false ? { mip_allow_restart: false } : {}),
  };
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
    m.options.set(highsOptions(model));
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
    const improving: number[][] = [];
    let rootLpFailed = false;
    try {
      if (most === undefined && model.stopOnRootLpFailure !== true && model.keepImproving !== true) {
        m.run();
      } else {
        m.run({
          [highs.constants.callbackType.mipInterrupt]: (event) => {
            const iterations = Number(event.data.mip_total_lp_iterations ?? 0);
            if (model.stopOnRootLpFailure === true && iterations > 0 && !Number.isFinite(Number(event.data.mip_dual_bound))) {
              rootLpFailed = true;
              event.interrupt();
            }
            if (most !== undefined && iterations >= most) event.interrupt();
          },
          ...(model.keepImproving === true ? {
            [highs.constants.callbackType.mipImprovingSolution]: (event) => {
              const x = event.data.mip_solution;
              if (x !== undefined) improving.push(Array.from(x));
            },
          } : {}),
        });
      }
    } catch {
      return withNodes(notOptimal('error'));   // a native solver failure; malformed input already threw in passModel
    }
    /** The result with `improving` and `rootLpFailed` when the model asked for them. */
    const withRun = (result: LpResult): LpResult => ({
      ...withNodes(result), ...(model.keepImproving === true ? { improving } : {}), ...(rootLpFailed ? { rootLpFailed: true as const } : {}),
    });
    const status = m.getModelStatus();
    switch (status) {
      case statuses.optimal:
        return withRun({ status: 'optimal', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue) });
      case statuses.infeasible:
        return withRun(notOptimal('infeasible'));
      case statuses.unbounded:
      case statuses.unboundedOrInfeasible:
        return withRun(notOptimal('unbounded'));
      default:
        // A MIP stopped by its node or time limit keeps its best whole solution, if it found one (status 2 = feasible).
        if (model.integer !== undefined && Number(m.info.get('primal_solution_status')) === 2) {
          return withRun({
            status: 'feasible', objective: m.getObjectiveValue(), x: Array.from(m.getSolution().colValue),
            stop: status === statuses.timeLimit ? 'time' : 'limit',
          });
        }
        // With a cutoff: its limits ended it before a whole solution (the iteration cap's interrupt, the node limit, which
        // HiGHS reports as its solution limit, its simplex iteration limit), or the time guard did. Any other status is
        // HiGHS failing: no plan, as without a cutoff.
        if (model.objectiveBound !== undefined && status === statuses.timeLimit) return withRun({ ...notOptimal('error'), stop: 'time' });
        if (model.objectiveBound !== undefined
          && (status === statuses.interrupted || status === statuses.solutionLimit || status === statuses.iterationLimit)) {
          return withRun({ ...notOptimal('error'), stop: 'limit' });
        }
        return withRun(notOptimal('error'));
    }
  });
}

// ---- A build MIP's solves (solve.ts `pickBuild`: plan 12 fix wave 3 (F), add-on 12 x 17 F4) ----

/**
 * One build MIP as `pickBuild` solves it: `model` with its limits (`maxNodes`, `maxIterations`, `timeLimit`,
 * `strongBranching`, `keepImproving`), from `start` where one is given; `retryTolerance` is the feasibility tolerance of
 * its later solves, and a root LP relaxation whose bound is at most `tiny` (or has none) did not solve.
 */
export interface BuildRunsJob {
  model: LpModel; start?: number[]; retryTolerance: number; tiny: number;
  // optional addition (release gate round 2, G1)
  /** In place of `start`: the objective of the plan the solve must beat, its cutoff (`LpModel.objectiveBound`) in every solve. */
  cutoff?: number;
}
/** A build MIP's solves in order (`solveBuildRuns`), with `retried` and `bare` saying which ran after the first. */
export interface BuildRuns { runs: LpResult[]; retried?: true; bare?: 'kept' | 'stalled' }

/** Whether a build MIP's result is a plan: it has a whole solution and the time guard did not stop it. */
export function wholeBuild(r: LpResult): boolean {
  return r.status === 'optimal' || (r.status === 'feasible' && r.stop !== 'time');
}

/**
 * The solves of `job` (`pickBuild`'s rules, solve.ts): one from the start that stops itself where its root LP relaxation
 * does not solve (`stopOnRootLpFailure`), then, where it did not, one more at `retryTolerance` from the same start
 * (`retried`). Where the last of those stopped on its limits at the root (`nodes` 0) after its root LP relaxation solved
 * (its `bound` above `tiny`) with nothing better than the start, one more at `retryTolerance` without the start (`bare`:
 * `kept` when it gave a whole solution, which joins `runs`; `stalled` when not). With `cutoff` in place of the start,
 * every solve looks below it (`objectiveBound`) and none runs bare: without an incumbent HiGHS already runs the root
 * heuristics a bare solve is for. `solver` solves each model.
 */
export async function solveBuildRuns(job: BuildRunsJob, solver: (model: LpModel) => Promise<LpResult> = solveLp): Promise<BuildRuns> {
  const { model, start, retryTolerance, tiny, cutoff } = job;
  const solve = (tolerance?: number, bare = false): Promise<LpResult> => solver({
    ...model, ...(start === undefined || bare ? {} : { start }), ...(cutoff === undefined ? {} : { objectiveBound: cutoff }),
    ...(tolerance === undefined ? { stopOnRootLpFailure: true } : { feasibilityTolerance: tolerance }),
  });
  const first = await solve();
  const runs = [first];
  if (first.rootLpFailed === true) runs.push(await solve(retryTolerance));
  let bare: { bare?: 'kept' | 'stalled' } = {};
  const stalled = runs[runs.length - 1] as LpResult;
  // A solve its limits ended at the root after its LP relaxation solved, with nothing better than its start (a start
  // costs HiGHS the heuristics it runs on that relaxation without an incumbent: Duty plate with farms, 436 against 149,
  // bound 143.87): once more without it; the start stays a pick. Not where the iteration cap stopped it inside that
  // relaxation, before those heuristics (its bound at most TINY, or none, as no objective coefficient is below 0): a solve
  // without the start only spends the cap again at its root (the integration's final review: Electronic Circuit MV on
  // Project Red, two of every machine owned, bound 5.8e-10, where it found a plan of 3.7e8 against its start's 8.81, so
  // the same plan, the start's, in a build MIP of 22.8 s against 13.0 s).
  if (start !== undefined && wholeBuild(stalled) && stalled.stop === 'limit' && (stalled.nodes ?? 0) === 0
    && (stalled.bound ?? 0) > tiny && runs.every((r) => (r.improving?.length ?? 0) <= 1)) {
    const again = await solve(retryTolerance, true);
    if (wholeBuild(again)) runs.push(again);
    bare = { bare: wholeBuild(again) ? 'kept' : 'stalled' };
  }
  return { runs, ...(first.rootLpFailed === true ? { retried: true as const } : {}), ...bare };
}

// ---- Solving on a worker thread (fix wave 3 Task 7 review, controller OQ1: the user's MV lines under 5 s warm) ----

/** The `workerData` field that makes a worker thread loading this module a solver (`solveLpAside`). */
const SOLVER_FLAG = 'lpSolver';
const SOLVER_EXEC_ARGV = ['--disable-warning=ExperimentalWarning'];

/** A model to solve, or a build MIP's solves (`solveBuildRuns`), all run there before it answers. */
type SolverTask = { model: LpModel } | { runs: BuildRunsJob };
type SolverJob = { id: number } & SolverTask;
type SolverReply = { id: number; result: LpResult } | { id: number; runs: BuildRuns } | { id: number; failed: true };

/** The solver thread and the jobs it has not answered yet, each with the callback that settles its promise. */
interface Solver { worker: Worker; pending: Map<number, (reply: SolverReply | undefined) => void> }

let solver: Solver | null = null;
/** A solver thread that could not start or stopped is not started again: every later model solves on this thread. */
let solverFailed = false;
let nextJob = 0;

/** The solver thread, started on first use; it holds the process open only while a job is pending (`ref`/`unref`). */
function solverThread(): Solver {
  if (solver !== null) return solver;
  const worker = new Worker(new URL(import.meta.url), { workerData: { [SOLVER_FLAG]: true }, execArgv: SOLVER_EXEC_ARGV });
  worker.unref();
  const started: Solver = { worker, pending: new Map() };
  const stopped = (): void => {
    solverFailed = true;
    if (solver === started) solver = null;
    for (const settle of started.pending.values()) settle(undefined);
    started.pending.clear();
  };
  worker.on('message', (reply: SolverReply) => {
    const settle = started.pending.get(reply.id);
    if (settle === undefined) return;
    started.pending.delete(reply.id);
    if (started.pending.size === 0) worker.unref();
    settle('failed' in reply ? undefined : reply);
  });
  worker.on('error', stopped);
  worker.on('exit', stopped);
  solver = started;
  return started;
}

/** `task` done on the solver thread; undefined when that thread cannot do it (it did not start, stopped, or threw). */
function solvedAside(task: SolverTask): Promise<SolverReply | undefined> {
  if (solverFailed) return Promise.resolve(undefined);
  let thread: Solver;
  try {
    thread = solverThread();
  } catch {
    solverFailed = true;
    return Promise.resolve(undefined);
  }
  return new Promise((settle) => {
    const id = nextJob++;
    thread.pending.set(id, settle);
    thread.worker.ref();
    try {
      thread.worker.postMessage({ id, ...task } satisfies SolverJob);
    } catch {
      thread.pending.delete(id);
      if (thread.pending.size === 0) thread.worker.unref();
      settle(undefined);
    }
  });
}

/**
 * `solveLp` on a worker thread with its own HiGHS runtime, so that this thread can solve other models meanwhile
 * (`buildStage`: the leanest line's build MIP beside plan 09's plan). HiGHS gives the same model the same answer on
 * either thread, so the result is `solveLp`'s, bit for bit. Where the solver thread cannot answer (it does not start,
 * stops, or the solve throws there, as on a malformed model) the model is solved on this thread, which throws the same
 * errors as `solveLp`. One thread serves every caller, one job at a time, in the order asked.
 */
export async function solveLpAside(model: LpModel): Promise<LpResult> {
  const reply = await solvedAside({ model });
  return reply !== undefined && 'result' in reply ? reply.result : solveLp(model);
}

/**
 * `solveBuildRuns` on the solver thread, as one job: every solve of it runs there one after another, so none waits for
 * this thread to come back from a solve of its own (release gate round 2, G1: Duty plate's leanest line waited 1.7 s
 * for plan 09's charge MIP before its retry), and the answer is `solveBuildRuns`'s here, bit for bit. Where the solver
 * thread cannot answer, the job runs on this thread, as `solveLpAside`'s models do.
 */
export async function solveBuildRunsAside(job: BuildRunsJob): Promise<BuildRuns> {
  const reply = await solvedAside({ runs: job });
  return reply !== undefined && 'runs' in reply ? reply.runs : solveBuildRuns(job);
}

// ---- Worker bootstrap: only inside the solver thread `solverThread` starts (`workerData.lpSolver`) ----

if (!isMainThread && (workerData as Record<string, unknown> | null)?.[SOLVER_FLAG] === true) {
  const reply = (r: SolverReply): void => parentPort?.postMessage(r);
  parentPort?.on('message', (job: SolverJob) => {
    const failed = (): void => reply({ id: job.id, failed: true });
    if ('runs' in job) solveBuildRuns(job.runs).then((runs) => reply({ id: job.id, runs }), failed);
    else solveLp(job.model).then((result) => reply({ id: job.id, result }), failed);
  });
}
