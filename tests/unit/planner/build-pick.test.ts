// Fix wave 3 (F)'s pick on a model whose search ends at its start (the add-on 12 x 17 integration, F4): with a start,
// HiGHS skips the root heuristics it runs without one, so on Duty plate's farm model the 50-node search returned its
// 325-block start at the root (436 against 149 without it). `pickBuild` then solves once more without the start; the
// start stays a pick candidate, so the pick is never dearer by `exactCost`. Synthetic: an injected solver, no HiGHS.

import { describe, expect, it } from 'vitest';
import { BUILD_MIP_RETRY_TOLERANCE } from '../../../src/server/planner/build-mip.ts';
import type { LpModel, LpResult } from '../../../src/server/planner/lp.ts';
import { pickBuild } from '../../../src/server/planner/solve.ts';

const START = [4, 0];
const BETTER = [1, 1];
/** A stand-in build MIP: `exactCost` is 10 × x0 + x1, so START costs 40 and BETTER 11. */
const mip = { exactCost: (x: readonly number[]) => 10 * (x[0] ?? 0) + (x[1] ?? 0) } as unknown as Parameters<typeof pickBuild>[0];
const model: LpModel = { sense: 'min', colCost: [10, 1], colLower: [0, 0], colUpper: [Infinity, Infinity], rows: [] };
const AT_ROOT: LpResult = { status: 'feasible', stop: 'limit', nodes: 0, objective: 40, x: START, improving: [START] };
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
});
