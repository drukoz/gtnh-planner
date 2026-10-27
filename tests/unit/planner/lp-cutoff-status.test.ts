// A MIP with a cutoff (`LpModel.objectiveBound`, release gate round 2, G1: the lite start) that ends without a whole
// solution: `stop` says its limits ('limit': the iteration cap's interrupt, the node limit, which HiGHS reports as its
// solution limit, and HiGHS's simplex iteration limit) or the time guard ('time') ended it, and nothing else does: a
// status where HiGHS failed is a plain `error` (no plan, `pickBuild`), as without a cutoff. HiGHS's model status is
// canned here, every other call is HiGHS's: a search the iteration cap interrupts before any whole solution, its status
// replaced.

import { describe, expect, it, vi } from 'vitest';
import type { Highs } from 'highs';

const canned = vi.hoisted(() => ({ status: undefined as number | undefined }));
vi.mock('highs', async (importOriginal) => {
  const mod = await importOriginal<{ default: (...args: unknown[]) => Promise<Highs> }>();
  /** `name` of `target`, a method bound to it. */
  const bound = (target: object, name: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, name);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  };
  /** A HiGHS model that reports the canned status, while one is set. */
  const cannedModel = (model: object): object => new Proxy(model, {
    get: (target, name) => (name === 'getModelStatus' && canned.status !== undefined ? () => canned.status : bound(target, name)),
  });
  const load = async (...args: unknown[]): Promise<Highs> => {
    const highs = await mod.default(...args);
    const withModel = highs.withModel as unknown as (this: Highs, run: (model: object) => unknown) => unknown;
    return new Proxy(highs, {
      get: (target, name) => (name === 'withModel'
        ? (run: (model: object) => unknown) => withModel.call(target, (model) => run(cannedModel(model)))
        : bound(target, name)),
    });
  };
  return { ...mod, default: load };
});

import highsDefault from 'highs';
import { solveLp, type LpModel } from '../../../src/server/planner/lp.ts';

/** lp.test.ts's 40 weights to an exact total: no whole solution before the iteration cap's interrupt. */
const weights = Array.from({ length: 40 }, (_, i) => 1000 + ((i * 7919) % 1000));
const half = Math.floor(weights.reduce((a, b) => a + b, 0) / 2);
const CAPPED: LpModel = {
  sense: 'min', colCost: weights.map((w, i) => w + ((i * 104729) % 97)), colLower: new Array<number>(40).fill(0),
  colUpper: new Array<number>(40).fill(1), integer: new Array<boolean>(40).fill(true),
  rows: [{ lower: half + 1, upper: half + 1, entries: weights.map((w, i): [number, number] => [i, w]) }],
  maxNodes: 50, maxIterations: 1, timeLimit: 30, strongBranching: false, keepImproving: true,
};

/** `solveLp` of `model` with HiGHS's model status `status` (a name of `highs.constants.modelStatus`). */
async function solvedAs(status: keyof Highs['constants']['modelStatus'], model: LpModel): Promise<Awaited<ReturnType<typeof solveLp>>> {
  const highs = await (highsDefault as unknown as () => Promise<Highs>)();
  canned.status = highs.constants.modelStatus[status];
  try {
    return await solveLp(model);
  } finally {
    canned.status = undefined;
  }
}

describe('a MIP with a cutoff that ends without a whole solution', () => {
  it('stops on its limits where its iteration cap, node limit or simplex iteration limit ended it, and on time on the time guard', async () => {
    expect(await solveLp({ ...CAPPED, objectiveBound: 1e9 })).toMatchObject({ status: 'error', stop: 'limit', x: [] });   // HiGHS's own: interrupted
    for (const status of ['interrupted', 'solutionLimit', 'iterationLimit'] as const) {
      expect(await solvedAs(status, { ...CAPPED, objectiveBound: 1e9 }), status).toMatchObject({ status: 'error', stop: 'limit', x: [] });
    }
    expect(await solvedAs('timeLimit', { ...CAPPED, objectiveBound: 1e9 })).toMatchObject({ status: 'error', stop: 'time', x: [] });
  });

  it('is a plain error, as without a cutoff, where HiGHS failed', async () => {
    const failed = ['notSet', 'loadError', 'modelError', 'presolveError', 'solveError', 'postsolveError', 'unknown', 'objectiveBound', 'objectiveTarget'] as const;
    for (const status of failed) {
      for (const model of [{ ...CAPPED, objectiveBound: 1e9 }, CAPPED]) {
        const r = await solvedAs(status, model);
        expect(r.status, status).toBe('error');
        expect(r.x, status).toEqual([]);
        expect(r.stop, status).toBeUndefined();
      }
    }
  });
});
