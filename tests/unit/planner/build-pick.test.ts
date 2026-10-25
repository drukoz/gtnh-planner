// Fix wave 3 (F)'s pick on a model whose search ends at its start (the add-on 12 x 17 integration, F4): with a start,
// HiGHS skips the root heuristics it runs without one, so on Duty plate's farm model the 50-node search returned its
// 325-block start at the root (436 against 149 without it), its root LP relaxation solved (bound 143.87). `pickBuild`
// then solves once more without the start; the start stays a pick candidate, so the pick is never dearer by `exactCost`.
// Only there: a search its iteration cap stopped before its root LP relaxation solved (its bound at most TINY, or none),
// before the heuristics a start costs, is left alone, as a solve without the start would only spend the cap again at its
// root (the integration's final review). It also covers fix wave 3 (F)'s retry of a build MIP whose root LP relaxation
// does not solve, which no real-data test reaches since 12 x 17 F7b. Synthetic: an injected solver, no HiGHS; and the
// build stage's note where the solve without the start finds nothing, on a line whose build MIP solves answer so through
// a stand-in `solveLp`.

import { describe, expect, it, vi } from 'vitest';
import { opt, pressSpec, solvedWithBuild } from '../../helpers/build-fixtures.ts';
import { BUILD_MIP_RETRY_TOLERANCE } from '../../../src/server/planner/build-mip.ts';
import type { LpModel, LpResult } from '../../../src/server/planner/lp.ts';
import { pickBuild } from '../../../src/server/planner/solve.ts';

/**
 * While on, the build MIP's solves (those that keep improving solutions: `pickBuild`'s alone) answer as a model whose
 * search ends at the root on its start after its LP relaxation solved (the relaxation's optimum its bound), and whose
 * search without the start finds nothing; every other solve is HiGHS's. No synthetic line stalls so under the real
 * limits: a solve without the start that gets past the root LP relaxation finds a whole solution there.
 */
const stall = vi.hoisted(() => ({ on: false }));
vi.mock('../../../src/server/planner/lp.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/lp.ts')>();
  const solveLp = async (m: LpModel): Promise<LpResult> => {
    if (!stall.on || m.keepImproving !== true) return mod.solveLp(m);
    if (m.start === undefined) return { status: 'error', objective: NaN, x: [], nodes: 0 };
    const relaxed = await mod.solveLp({ sense: m.sense, colCost: m.colCost, colLower: m.colLower, colUpper: m.colUpper, rows: m.rows });
    const objective = m.colCost.reduce((sum, c, j) => sum + c * (m.start?.[j] ?? 0), 0);
    return { status: 'feasible', stop: 'limit', nodes: 0, objective, bound: relaxed.objective, x: m.start, improving: [m.start] };
  };
  return { ...mod, solveLp };
});

const START = [4, 0];
const BETTER = [1, 1];
/** A stand-in build MIP: `exactCost` is 10 × x0 + x1, so START costs 40 and BETTER 11. */
const mip = { exactCost: (x: readonly number[]) => 10 * (x[0] ?? 0) + (x[1] ?? 0) } as unknown as Parameters<typeof pickBuild>[0];
const model: LpModel = { sense: 'min', colCost: [10, 1], colLower: [0, 0], colUpper: [Infinity, Infinity], rows: [] };
/** The start's solve, its limits ended at the root after its LP relaxation solved (bound 10, below every whole solution). */
const AT_ROOT: LpResult = { status: 'feasible', stop: 'limit', nodes: 0, objective: 40, bound: 10, x: START, improving: [START] };
const SEARCHED: LpResult = { status: 'feasible', stop: 'limit', nodes: 50, objective: 11, x: BETTER, improving: [BETTER] };

/** A solver that answers `withStart` when handed a start and `bare` without one; `calls` holds the models it was given. */
function solverOf(withStart: LpResult, bare: LpResult = SEARCHED): { calls: LpModel[]; solver: (m: LpModel) => Promise<LpResult> } {
  const calls: LpModel[] = [];
  return { calls, solver: async (m) => { calls.push(m); return m.start === undefined ? bare : withStart; } };
}

describe('pickBuild when the search ends at its start', () => {
  it('solves once more without the start when the MIP stopped at the root on it', async () => {
    const { calls, solver } = solverOf(AT_ROOT);
    const picked = await pickBuild(mip, START, {}, 30, model, solver);
    expect(picked.result.x).toEqual(BETTER);
    expect(picked.bare).toBe('kept');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.start).toBeUndefined();
    expect(calls[1]?.feasibilityTolerance).toBe(BUILD_MIP_RETRY_TOLERANCE);
  });

  it('keeps the start, marked stalled, when the solve without it finds nothing', async () => {
    const { calls, solver } = solverOf(AT_ROOT, { status: 'error', objective: NaN, x: [] });
    const picked = await pickBuild(mip, START, {}, 30, model, solver);
    expect(picked.result.x).toEqual(START);
    expect(picked.bare).toBe('stalled');
    expect(calls).toHaveLength(2);
  });

  it('leaves a search that branched, improved on its start or proved it alone', async () => {
    const improved: LpResult = { ...AT_ROOT, objective: 30, x: [3, 0], improving: [START, [3, 0]] };
    for (const r of [{ ...AT_ROOT, nodes: 3 }, improved, { ...AT_ROOT, status: 'optimal' as const, stop: undefined }]) {
      const { calls, solver } = solverOf(r);
      const picked = await pickBuild(mip, START, {}, 30, model, solver);
      expect(calls).toHaveLength(1);
      expect(picked.bare).toBeUndefined();
    }
    const { calls, solver } = solverOf(AT_ROOT);
    await pickBuild(mip, undefined, {}, 30, model, solver);
    expect(calls).toHaveLength(1);
  });

  it('leaves a search its iteration cap stopped before its root LP relaxation solved alone', async () => {
    // The integration's final review: on Electronic Circuit MV on Project Red with two of every machine owned, the start's
    // solve ran out of its simplex iterations inside its root LP relaxation (bound 5.8e-10), and the solve without the
    // start spent the cap again at its root for a plan of 3.7e8 against the start's 8.81: the same plan, the start
    // picked, the build MIP 22.8 s against 13.0 s. A bound at most TINY, or none, is such a root.
    for (const bound of [5.8e-10, 0, undefined]) {
      const { calls, solver } = solverOf({ ...AT_ROOT, bound });
      const picked = await pickBuild(mip, START, {}, 30, model, solver);
      expect(calls).toHaveLength(1);
      expect(picked.bare).toBeUndefined();
      expect(picked.result.x).toEqual(START);
    }
  });

  it("reads the bound of the last solve, the retry's where the root LP relaxation failed first", async () => {
    // Fix wave 3 (F)'s retry runs from the same start; where it too ends at the root on that start, its bound says whether
    // its root LP relaxation solved, and so whether a solve without the start can find more.
    for (const [bound, solves, bare] of [[10, 3, 'kept'], [5.8e-10, 2, undefined]] as const) {
      const calls: LpModel[] = [];
      const solver = async (m: LpModel): Promise<LpResult> => {
        calls.push(m);
        if (m.stopOnRootLpFailure === true) return { ...AT_ROOT, bound: undefined, rootLpFailed: true };
        return m.start === undefined ? SEARCHED : { ...AT_ROOT, bound };
      };
      const picked = await pickBuild(mip, START, {}, 30, model, solver);
      expect(calls).toHaveLength(solves);
      expect(picked.retried).toBe(true);
      expect(picked.bare).toBe(bare);
    }
  });
});

describe('pickBuild when the root LP relaxation does not solve', () => {
  it('runs again at BUILD_MIP_RETRY_TOLERANCE from the same start and picks from that run', async () => {
    // Fix wave 3 (F): the first solve stops itself where its root LP relaxation does not solve (`stopOnRootLpFailure`;
    // its `x` is the start's). Good Electronic Circuit 2/min HV on AE2 did so until 12 x 17 F7b, so real-build-cost.test.ts
    // no longer reaches this path.
    const calls: LpModel[] = [];
    const solver = async (m: LpModel): Promise<LpResult> => {
      calls.push(m);
      return m.stopOnRootLpFailure === true ? { ...AT_ROOT, rootLpFailed: true } : SEARCHED;
    };
    const picked = await pickBuild(mip, START, {}, 30, model, solver);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.stopOnRootLpFailure).toBe(true);
    expect(calls[1]?.stopOnRootLpFailure).toBeUndefined();
    expect(calls[1]?.feasibilityTolerance).toBe(BUILD_MIP_RETRY_TOLERANCE);
    expect(calls[1]?.start).toEqual(START);
    expect(picked.retried).toBe(true);
    expect(picked.result.x).toEqual(BETTER);
    expect(picked.bare).toBeUndefined();
  });
});

describe('the build stage when the search without the start finds nothing', () => {
  it("says build-cost-approx, the plan its start's (12 x 17 F4)", async () => {
    // The start's solve ends at the root after its LP relaxation solved, with nothing better than the start, and the solve
    // without it finds nothing (`stall`): the plan is its start's, rounded up from an estimate, not the fallback's
    // (`approx` false).
    stall.on = true;
    try {
      const { sol } = await solvedWithBuild(pressSpec(), { 't:a@0': 1 }, [['t:t@0', 1]], { options: { press: [opt(101, 1, 0.2, 10)] } });
      expect(sol.status).toBe('ok');
      expect(sol.buildStats).toMatchObject({ status: 'feasible', stop: 'limit', nodes: 0, approx: false, bare: 'stalled' });
      expect(sol.warnings.map((w) => w.code)).toContain('build-cost-approx');
    } finally {
      stall.on = false;
    }
  });
});
