import { Worker } from 'node:worker_threads';
import { describe, it, expect, vi } from 'vitest';
import {
  highsOptions, MIP_FEASIBILITY_TOLERANCE, solveBuildRuns, solveBuildRunsAside, solveLp, solveLpAside, yieldToEventLoop, type BuildRunsJob, type LpModel,
} from '../../../src/server/planner/lp.ts';

describe('solveLp', () => {
  it('solves a small minimisation', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: 4, upper: Infinity, entries: [[0, 1], [1, 2]] }] });
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(2, 9);
    expect(r.x[1]).toBeCloseTo(2, 9);
  });
  it('reports infeasible', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1], colLower: [0], colUpper: [3], rows: [{ lower: 5, upper: Infinity, entries: [[0, 1]] }] });
    expect(r.status).toBe('infeasible');
  });
  it('is unaffected by badly scaled rows', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1, 0], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: 0, upper: 0, entries: [[0, 20000], [1, -0.05]] }, { lower: 1, upper: Infinity, entries: [[1, 1]] }] });
    expect(r.x[0]).toBeCloseTo(0.05 / 20000, 10);
  });
  it('reports an unbounded maximisation as not optimal', async () => {
    const r = await solveLp({ sense: 'max', colCost: [1], colLower: [0], colUpper: [Infinity], rows: [] });
    expect(r.status).not.toBe('optimal');
  });
  it('decides a model without columns from its row bounds', async () => {
    expect(await solveLp({ sense: 'min', colCost: [], colLower: [], colUpper: [], rows: [] })).toEqual({ status: 'optimal', objective: 0, x: [] });
    const r = await solveLp({ sense: 'min', colCost: [], colLower: [], colUpper: [], rows: [{ lower: 1, upper: Infinity, entries: [] }] });
    expect(r.status).toBe('infeasible');
  });
  it('solves a small MIP with whole columns', async () => {
    const r = await solveLp({ sense: 'max', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: -Infinity, upper: 3, entries: [[0, 2], [1, 2]] }], integer: [true, true], maxNodes: 100 });
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(1, 9);
    expect(r.x.every((v) => Math.abs(v - Math.round(v)) < 1e-9)).toBe(true);
    expect(r.stop).toBeUndefined();
  });
  it('says why a MIP stopped early', async () => {
    // A 0–1 knapsack HiGHS 1.15.3 needs 2,072 nodes for unlimited (4,719 with the zero gaps a node limit sets; about half
    // a second), so either limit stops it with the start.
    const weights = Array.from({ length: 40 }, (_, i) => 1000 + ((i * 7919) % 1000));
    const values = weights.map((w, i) => w + ((i * 104729) % 97));
    const knapsack = {
      sense: 'max' as const, colCost: values, colLower: new Array<number>(40).fill(0), colUpper: new Array<number>(40).fill(1),
      rows: [{ lower: -Infinity, upper: Math.floor(weights.reduce((a, b) => a + b, 0) / 2), entries: weights.map((w, i): [number, number] => [i, w]) }],
      integer: new Array<boolean>(40).fill(true), start: new Array<number>(40).fill(0),
    };
    expect(await solveLp({ ...knapsack, maxNodes: 1 })).toMatchObject({ status: 'feasible', stop: 'limit', nodes: 1 });
    expect(await solveLp({ ...knapsack, timeLimit: 0 })).toMatchObject({ status: 'feasible', stop: 'time' });
    // The simplex-iteration bound (plan 12 fix wave) stops it deterministically, the same way twice, with a bound on
    // the optimum no better than the solution it keeps.
    const bounded = await solveLp({ ...knapsack, maxNodes: 100_000, maxIterations: 50 });
    expect(bounded).toMatchObject({ status: 'feasible', stop: 'limit' });
    expect(bounded.bound).toBeGreaterThanOrEqual(bounded.objective - 1e-9);
    expect(await solveLp({ ...knapsack, maxNodes: 100_000, maxIterations: 50 })).toEqual(bounded);
  });
  it('gives a MIP its node limit, gaps and tolerance, and turns strong branching off only when asked (fix wave 3 (F))', () => {
    const lp = { sense: 'min' as const, colCost: [1], colLower: [0], colUpper: [1], rows: [] };
    expect(MIP_FEASIBILITY_TOLERANCE).toBe(1e-10);
    expect(highsOptions(lp)).toEqual({ output_flag: false });
    expect(highsOptions({ ...lp, timeLimit: 30 })).toEqual({ output_flag: false, time_limit: 30 });
    expect(highsOptions({ ...lp, integer: [true], maxNodes: 1 }))
      .toEqual({ output_flag: false, mip_max_nodes: 1, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-10 });
    expect(highsOptions({ ...lp, integer: [true], maxNodes: 50, feasibilityTolerance: 1e-9, strongBranching: false }))
      .toEqual({ output_flag: false, mip_max_nodes: 50, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-9, mip_pscost_minreliable: 0 });
  });
  it('keeps the improving whole solutions of a MIP in order, and stops on a failed root LP only when it fails', async () => {
    const weights = Array.from({ length: 40 }, (_, i) => 1000 + ((i * 7919) % 1000));
    const values = weights.map((w, i) => w + ((i * 104729) % 97));
    const knapsack = {
      sense: 'max' as const, colCost: values, colLower: new Array<number>(40).fill(0), colUpper: new Array<number>(40).fill(1),
      rows: [{ lower: -Infinity, upper: Math.floor(weights.reduce((a, b) => a + b, 0) / 2), entries: weights.map((w, i): [number, number] => [i, w]) }],
      integer: new Array<boolean>(40).fill(true), start: new Array<number>(40).fill(0),
    };
    const r = await solveLp({ ...knapsack, maxNodes: 200, maxIterations: 50_000, strongBranching: false, keepImproving: true, stopOnRootLpFailure: true });
    expect(r.status === 'optimal' || r.stop === 'limit').toBe(true);
    expect(r.rootLpFailed).toBeUndefined();   // its LP relaxation solves
    const worth = (x: readonly number[]): number => x.reduce((sum, v, i) => sum + (values[i] as number) * v, 0);
    const seen = (r.improving ?? []).map(worth);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i] as number).toBeGreaterThanOrEqual((seen[i - 1] as number) - 1e-9);
    expect(seen[seen.length - 1] as number).toBeCloseTo(r.objective, 6);
    expect((await solveLp({ ...knapsack, maxNodes: 200 })).improving).toBeUndefined();
  });
  it('accepts a start solution', async () => {
    const r = await solveLp({ sense: 'max', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: -Infinity, upper: 3, entries: [[0, 2], [1, 2]] }], integer: [true, true], maxNodes: 100, start: [1, 0] });
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(1, 9);
    expect(r.x.every((v) => Math.abs(v - Math.round(v)) < 1e-9)).toBe(true);
  });
  it('keeps the start as the solution of a MIP its node limit stops at once', async () => {
    // 40 binaries whose weights must add up to exactly `b`: HiGHS finds no whole solution before its first node, so with
    // no node to search the start is the solution (fix spec R3: the step-charge MIP starts from the least-raw plan).
    let seed = 1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const weights = Array.from({ length: 40 }, () => 100 + Math.floor(next() * 900));
    const costs = Array.from({ length: 40 }, () => 1 + Math.floor(next() * 100));
    const start = weights.map(() => (next() < 0.5 ? 1 : 0));
    const b = weights.reduce((sum, w, i) => sum + w * (start[i] as number), 0);
    const r = await solveLp({
      sense: 'min', colCost: costs, colLower: new Array<number>(40).fill(0), colUpper: new Array<number>(40).fill(1),
      rows: [{ lower: b, upper: b, entries: weights.map((w, i): [number, number] => [i, w]) }],
      integer: new Array<boolean>(40).fill(true), maxNodes: 0, start,
    });
    expect(r.status).toBe('feasible');
    expect(r.objective).toBe(costs.reduce((sum, c, i) => sum + c * (start[i] as number), 0));
  });
  it('rejects a start of the wrong length', async () => {
    await expect(solveLp({ sense: 'min', colCost: [1, 1], colLower: [0, 0], colUpper: [1, 1], rows: [], start: [1] })).rejects.toThrow(RangeError);
  });
  it('rejects a row with a missing column, a repeated column or a non-finite coefficient', async () => {
    const model = (entries: Array<[number, number]>) => ({ sense: 'min' as const, colCost: [1], colLower: [0], colUpper: [1], rows: [{ lower: 0, upper: 1, entries }] });
    await expect(solveLp(model([[1, 1]]))).rejects.toThrow(RangeError);
    await expect(solveLp(model([[0, 1], [0, 2]]))).rejects.toThrow(RangeError);
    await expect(solveLp(model([[0, Infinity]]))).rejects.toThrow(RangeError);
  });
});

describe('solveLpAside (fix wave 3 Task 7 review, controller OQ1)', () => {
  // The build stage solves the leanest line's MIP on the solver thread while plan 09's plan solves on this one, so a
  // build-cost plan waits for the longer of the two instead of their sum; the plan must not change.
  const weights = Array.from({ length: 40 }, (_, i) => 1000 + ((i * 7919) % 1000));
  const values = weights.map((w, i) => w + ((i * 104729) % 97));
  const knapsack: LpModel = {
    sense: 'max', colCost: values, colLower: new Array<number>(40).fill(0), colUpper: new Array<number>(40).fill(1),
    rows: [{ lower: -Infinity, upper: Math.floor(weights.reduce((a, b) => a + b, 0) / 2), entries: weights.map((w, i): [number, number] => [i, w]) }],
    integer: new Array<boolean>(40).fill(true), start: new Array<number>(40).fill(0),
  };

  it("gives exactly what solveLp gives: an LP, an infeasible one, and a MIP with its start, limits and improving solutions", async () => {
    const models: LpModel[] = [
      { sense: 'min', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity], rows: [{ lower: 4, upper: Infinity, entries: [[0, 1], [1, 2]] }] },
      { sense: 'min', colCost: [1], colLower: [0], colUpper: [3], rows: [{ lower: 5, upper: Infinity, entries: [[0, 1]] }] },
      { ...knapsack, maxNodes: 200, maxIterations: 50_000, strongBranching: false, keepImproving: true, stopOnRootLpFailure: true },
      { ...knapsack, maxNodes: 1 },
    ];
    for (const model of models) expect(await solveLpAside(model)).toStrictEqual(await solveLp(model));
  });

  it('leaves this thread free while it solves', async () => {
    // Solved here, the knapsack (4,719 nodes, about half a second) would hold this thread for all of it after one turn.
    let settled = false;
    const aside = solveLpAside({ ...knapsack, maxNodes: 100_000 }).then((r) => {
      settled = true;
      return r;
    });
    let turns = 0;
    while (!settled) {
      await yieldToEventLoop();
      turns++;
    }
    expect(turns).toBeGreaterThan(10);
    expect((await aside).status).toBe('optimal');
  });

  it('throws what solveLp throws on a malformed model', async () => {
    await expect(solveLpAside({ sense: 'min', colCost: [1, 1], colLower: [0, 0], colUpper: [1, 1], rows: [], start: [1] })).rejects.toThrow(RangeError);
    await expect(solveLpAside({ sense: 'min', colCost: [1], colLower: [0], colUpper: [1], rows: [{ lower: 0, upper: 1, entries: [[1, 1]] }] }))
      .rejects.toThrow(RangeError);
  });
});

describe('solveBuildRunsAside (release gate round 2, G1)', () => {
  // The leanest line's build MIP solves on the solver thread while plan 09's plan solves on this one. Its solves after the
  // first (fix wave 3 (F)'s retry, 12 x 17 F4's solve without the start) run there one after another, so none waits for
  // this thread to finish a solve of its own (Duty plate: the leanest line's retry waited 1.7 s for plan 09's charge MIP).
  // A cover whose start is its optimum: under a 1-iteration cap its solve ends at the root on the start after its LP
  // relaxation solved, so the job solves once more without the start: two solves.
  const weights = Array.from({ length: 40 }, (_, i) => 1000 + ((i * 7919) % 1000));
  const cover: LpModel = {
    sense: 'min', colCost: weights.map((w, i) => w + ((i * 104729) % 97)), colLower: new Array<number>(40).fill(0),
    colUpper: new Array<number>(40).fill(1), integer: new Array<boolean>(40).fill(true),
    rows: [{ lower: Math.floor(weights.reduce((a, b) => a + b, 0) / 2), upper: Infinity, entries: weights.map((w, i): [number, number] => [i, w]) }],
  };
  const jobOf = async (): Promise<BuildRunsJob> => ({
    model: { ...cover, maxNodes: 50, maxIterations: 1, timeLimit: 30, strongBranching: false, keepImproving: true },
    start: (await solveLp({ ...cover, maxNodes: 100_000 })).x, retryTolerance: 1e-9, tiny: 1e-9,
  });

  it('gives exactly what solveBuildRuns gives on this thread', async () => {
    const job = await jobOf();
    const here = await solveBuildRuns(job);
    expect(here.runs).toHaveLength(2);
    expect(here.bare).toBe('kept');
    expect(await solveBuildRunsAside(job)).toStrictEqual(here);
  });

  it('hands the solver thread all of its solves at once', async () => {
    const job = await jobOf();
    await solveLpAside(cover);   // the solver thread started
    const posted = vi.spyOn(Worker.prototype, 'postMessage');
    try {
      const { runs } = await solveBuildRunsAside(job);
      expect(runs).toHaveLength(2);
      expect(posted).toHaveBeenCalledTimes(1);
    } finally {
      posted.mockRestore();
    }
  });
});
