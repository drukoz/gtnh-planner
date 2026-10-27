// The build stage's lite start (release gate round 2, G1: Duty plate in about main's time). On a large leanest-line MIP
// the build stage first solves its lite relaxation (`BuildMipInput.lite`: every step priced as a light step, owned
// machines whole per step within each type's count), whose plan rounded up is a start for the leanest line and the build
// MIP; the build MIP then solves beside the leanest line at the lite plan's raw material to 9 significant digits, kept
// where the leanest line's is the same (the same model from the same starts as solving it after), else solved again.

import { describe, it, expect, vi } from 'vitest';

// The relaxation cases read the inputs `solveLine` hands the build MIP; every call runs the real `buildMip`.
vi.mock('../../../src/server/planner/build-mip.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/build-mip.ts')>();
  return { ...mod, buildMip: vi.fn(mod.buildMip) };
});
// The solves' cases read the build MIP's models solved here and the jobs handed the solver thread; every solve is HiGHS's,
// but where a failure case answers one in its place (`fail`: given the model, or the job and its index since `aside` was
// last emptied).
const seen = vi.hoisted(() => ({
  here: [] as Array<import('../../../src/server/planner/lp.ts').LpModel>, aside: [] as Array<import('../../../src/server/planner/lp.ts').BuildRunsJob>,
  fail: {} as {
    here?: (m: import('../../../src/server/planner/lp.ts').LpModel) => Promise<import('../../../src/server/planner/lp.ts').LpResult> | undefined;
    aside?: (job: import('../../../src/server/planner/lp.ts').BuildRunsJob, index: number) => Promise<import('../../../src/server/planner/lp.ts').BuildRuns> | undefined;
  },
}));
vi.mock('../../../src/server/planner/lp.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/lp.ts')>();
  return {
    ...mod,
    solveLp: async (m: import('../../../src/server/planner/lp.ts').LpModel) => {
      if (m.keepImproving === true) seen.here.push(m);
      return (m.keepImproving === true ? seen.fail.here?.(m) : undefined) ?? mod.solveLp(m);
    },
    solveBuildRunsAside: async (job: import('../../../src/server/planner/lp.ts').BuildRunsJob) => {
      seen.aside.push(job);
      return seen.fail.aside?.(job, seen.aside.length - 1) ?? mod.solveBuildRunsAside(job);
    },
  };
});

import { fastSlowSpec, opt, solderSpec, solvedWithBuild, woodSpec } from '../../helpers/build-fixtures.ts';
import type { PackSpec } from '../../helpers/pack-spec.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { buildMip, type BuildMipInput } from '../../../src/server/planner/build-mip.ts';
import { solveLp } from '../../../src/server/planner/lp.ts';
import { LITE_MIN_INTEGERS, type Solution, type SolveOptions } from '../../../src/server/planner/solve.ts';

const COSTS: Record<StuffKey, number> = { 't:a@0': 1, 't:b@0': 1, 't:part@0': 1, 't:tin_ingot@0': 1, 't:antimony@0': 1 };
/** Task 4's solder line (build-mip.test.ts): each board recipe on an assembler, each extractor on an extractor, the alloy smelter. */
const SOLDER = {
  'board-tin': [opt(121, 1, 0.2, 16)], 'board-solder': [opt(121, 1, 0.2, 16)],
  'x-tin': [opt(131, 1, 0.5, 12)], 'x-solder': [opt(131, 1, 0.5, 12)], 'alloy-solder': [opt(201, 1, 0.1, 20)],
};
/** A board an hour for a week at Fewest machines' 0.5 under the default +25 % cap: the soldering alloy (build-mip.test.ts). */
const week = (opts: SolveOptions = {}) => solvedWithBuild(
  solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER, horizonSeconds: 604800 }, { stepCharge: 0.5, rawCap: 0.25, ...opts },
);
/** Every gate open: the lite start on a line of any size. */
const LITE: SolveOptions = { liteMinIntegers: 0 };

/** `p-a` (1 a → 1 t1) and `p-b` (1 b → 1 t2), both on bender 101: two steps the line needs on one machine type. */
function twoBenderSpec(): PackSpec {
  const BENDER = 'gt.recipe.metalbender';
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }],
    machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] }],
    recipes: [
      { id: 'p-a', map: BENDER, in: [['t:a@0', 1]], out: [['t:t1@0', 1]], eut: 24, dur: 100 },
      { id: 'p-b', map: BENDER, in: [['t:b@0', 1]], out: [['t:t2@0', 1]], eut: 24, dur: 100 },
    ],
  };
}

/** The input of the last build MIP `run` hands `buildMip` that is not a lite one. */
async function lastInput(run: () => Promise<unknown>): Promise<BuildMipInput> {
  const spy = vi.mocked(buildMip);
  spy.mockClear();
  await run();
  const inputs = spy.mock.calls.map(([input]) => input).filter((i) => i.lite !== true);
  return inputs[inputs.length - 1] as BuildMipInput;
}

/** The optimum of a build MIP's model, solved whole (no node or iteration limit). */
async function optimum(mip: ReturnType<typeof buildMip>): Promise<{ objective: number; x: number[] }> {
  const r = await solveLp(mip.model);
  expect(r.status).toBe('optimal');
  return { objective: r.objective, x: r.x };
}

/** A solution without its wall times, for comparing two solves of one line. */
function timeless(sol: Solution): unknown {
  const { buildStats, ...rest } = sol;
  if (buildStats === undefined) return rest;
  const { seconds: _seconds, beside: _beside, ...stats } = buildStats;
  return { ...rest, buildStats: stats };
}

describe('the lite relaxation of the build MIP', () => {
  it('prices every step light, so it never costs more than the MIP and its runs round up to a start', async () => {
    // 0.3 t a second over 100 s at step charge 0 (σ = 30 raw): the fast press (1 a, 0.2 a second each, 100 to build)
    // needs 1.5 machines' runs, so the MIP builds 2 (1 + 200 / 30) and takes the slow one (2 a, 160: 2 + 160 / 30); the
    // lite prices the second fast press at its share (max(100, 100 / 0.2 × 0.3) = 150: 1 + 150 / 30), below the MIP's
    // optimum. Its runs are a plan of the MIP, whose start from them builds the two presses.
    const options = { fast: [opt(301, 1, 0.2, 100)], slow: [opt(302, 1, 10, 160)] };
    const input = await lastInput(() => solvedWithBuild(fastSlowSpec(), { 't:a@0': 1 }, [['t:t@0', 0.3]], { options, horizonSeconds: 100 }, { stepCharge: 0, rawCap: null }));
    const full = buildMip(input);
    const lite = buildMip({ ...input, lite: true });
    expect(lite.model.colCost.length).toBeLessThan(full.model.colCost.length);   // no machine pools
    const exact = await optimum(full);
    const light = await optimum(lite);
    expect(light.objective).toBeLessThan(exact.objective - 1e-6);
    const start = full.startAt(light.x.slice(0, input.lp.rawCost.length));
    expect(start).toBeDefined();
    expect(start?.cost).toBeGreaterThanOrEqual(exact.objective - 1e-9);
  });

  it('gives a type\'s owned machines whole to one step each, within the count the group owns', async () => {
    // p-a and p-b each need under one bender; the group owns one (build 100). The MIP runs one on it and builds a second;
    // the lite does the same (each step's runs fit one machine, so its price is the MIP's): it may not run both on the
    // one owned bender, which would save the second's build.
    const options = { 'p-a': [opt(101, 1, 0.5, 100, 1)], 'p-b': [opt(101, 1, 0.5, 100, 1)] };
    const input = await lastInput(() => solvedWithBuild(twoBenderSpec(), { 't:a@0': 1, 't:b@0': 1 }, [['t:t1@0', 0.1], ['t:t2@0', 0.1]], { options }, { stepCharge: 0.5, rawCap: null }));
    const exact = await optimum(buildMip(input));
    const light = await optimum(buildMip({ ...input, lite: true }));
    expect(light.objective).toBeCloseTo(exact.objective, 9);
  });
});

describe('the build MIP beside the leanest line (the lite start)', () => {
  it('solves the lite start only on a leanest line of at least LITE_MIN_INTEGERS whole columns', async () => {
    expect(LITE_MIN_INTEGERS).toBe(3000);
    const small = await week();
    expect(small.runs).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(small.sol.buildStats?.beside).toBeUndefined();
    expect((await week(LITE)).sol.buildStats?.beside).toBeDefined();
  });

  it('keeps the build MIP solved beside the leanest line where its raw material to 9 digits is the lite plan\'s: the same plan as after it', async () => {
    // The solder week: the lite plan is the soldering alloy, the leanest line too (1.5 raw a board), so the MIP solved at
    // the lite plan's cap is the MIP of the leanest line's, from the same starts.
    const beside = await week(LITE);
    expect(beside.sol.buildStats?.beside).toBe('kept');
    expect(beside.sol.leanRawCost).toBe(0.000416666667);
    const after = await week({ ...LITE, sequentialLean: true });
    expect(after.sol.buildStats?.beside).toBeUndefined();
    expect(timeless(beside.sol)).toEqual(timeless(after.sol));
    // twice the same
    expect(timeless((await week(LITE)).sol)).toEqual(timeless(beside.sol));
  });

  it('gives the leanest line the lite plan as its cutoff and the build MIP as its incumbent, never restarted, where it is their cheapest start', async () => {
    // Measured on the user's live board and real-board's A3 (b) (release gate round 2, G1): with the lite plan as its
    // cutoff the build MIP's answer moved with the board's x 0.999 offers (raw 10.36 against 11.11 a minute); as its
    // incumbent with restarts the board fell into a 2-cycle; as its incumbent without them both held. Poly in small (a
    // tank an hour, build-mip.test.ts): S1 and the sparse plan take the long way (three machines of 100), the lite plan
    // the log (one of 10), the cheapest start of both MIPs.
    const options = { 'w-tank': [opt(121, 1, 0.2, 10)], 's-grit': [opt(481, 1, 0.2, 100)], 's-paste': [opt(351, 1, 0.2, 100)], 's-tank': [opt(101, 1, 0.2, 100)] };
    seen.here.length = 0;
    seen.aside.length = 0;
    const { runs } = await solvedWithBuild(woodSpec(), { 't:log@0': 1, 't:ore@0': 1 }, [['t:tank@0', 1 / 3600]], { options }, { stepCharge: 0.5, rawCap: 0.25, ...LITE });
    expect(runs).toEqual(['w-tank']);
    expect(seen.here.length).toBeGreaterThan(0);
    for (const m of seen.here) {
      expect(m.start).toBeDefined();
      expect(m.allowRestart).toBe(false);
      expect(m.objectiveBound).toBeUndefined();
    }
    // on the solver thread: the lite (no start, no cutoff), then the leanest line (the lite plan as its cutoff)
    expect(seen.aside.map((j) => [j.start === undefined, j.cutoff === undefined])).toEqual([[true, true], [true, false]]);
  });

  it('solves the leanest line and the build MIP as before where another start costs no more than the lite plan', async () => {
    // The fast press line below: the lite plan is S1's (the fast press), so S1 rounded up stays both MIPs' start, an
    // incumbent restarts may leave (Electronic Circuit MV on Project Red, two of every machine owned: from the sparse
    // plan as its cutoff its leanest line found nothing below it, 1.032 against 0.884 as the incumbent). And off the lite
    // path (the default gate) both solve as before too.
    const options = { fast: [opt(301, 1, 0.2, 100)], slow: [opt(302, 1, 10, 160)] };
    for (const opts of [LITE, {}] as SolveOptions[]) {
      seen.here.length = 0;
      seen.aside.length = 0;
      await solvedWithBuild(fastSlowSpec(), { 't:a@0': 1 }, [['t:t@0', 0.3]], { options, horizonSeconds: 100 }, { stepCharge: 0.5, rawCap: 0.25, ...opts });
      for (const m of seen.here) expect(m.allowRestart).toBeUndefined();
      expect(seen.aside.some((j) => j.start !== undefined)).toBe(true);   // the leanest line from its start, an incumbent
      expect(seen.aside.every((j) => j.cutoff === undefined)).toBe(true);
    }
    for (const opts of [{}] as SolveOptions[]) {
      seen.here.length = 0;
      await week(opts);
      for (const m of seen.here) expect(m.allowRestart).toBeUndefined();
    }
  });

  it('solves the build MIP again at the leanest line\'s raw material where the lite plan\'s differs', async () => {
    // A t a second (0.3) over 100 s: the fast press (1 a, 0.2 a second each, 100 to build) or the slow one (2 a, one
    // machine, 160). Lite: fast 30 raw + 150 against slow 60 + 160. The leanest line (whole machines): fast 30 + 200 >
    // slow 220, so its raw (0.6 a second) is not the lite plan's (0.3) and the MIP solved beside it is solved again.
    const options = { fast: [opt(301, 1, 0.2, 100)], slow: [opt(302, 1, 10, 160)] };
    const line = (opts: SolveOptions) => solvedWithBuild(fastSlowSpec(), { 't:a@0': 1 }, [['t:t@0', 0.3]], { options, horizonSeconds: 100 }, { stepCharge: 0.5, rawCap: 0.25, ...opts });
    const beside = await line(LITE);
    expect(beside.sol.buildStats?.beside).toBe('re-solved');
    expect(beside.sol.leanRawCost).toBe(0.6);
    expect(beside.runs).toEqual(['slow']);
    const after = await line({ ...LITE, sequentialLean: true });
    expect(timeless(beside.sol)).toEqual(timeless(after.sol));
  });
});

describe('the lite start when a solve fails', () => {
  /**
   * The reasons of the promise rejections no handler took while `run` ran and a little after (Node's 'unhandledRejection',
   * which crashes the server: src/server/main.ts registers no handler), with `seen.fail` set for `run` only.
   */
  async function unhandledOf(fail: typeof seen.fail, run: () => Promise<void>): Promise<unknown[]> {
    const reasons: unknown[] = [];
    const note = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on('unhandledRejection', note);
    seen.aside.length = 0;
    seen.fail = fail;
    try {
      await run();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      seen.fail = {};
      process.off('unhandledRejection', note);
    }
    return reasons;
  }

  it('fails only the plan where the leanest line fails while the build MIP solves beside it', async () => {
    // The leanest line's job (the second on the solver thread, after the lite's) fails as the build MIP beside it starts.
    let failLean: ((error: Error) => void) | undefined;
    const unhandled = await unhandledOf({
      aside: (_job, index) => (index === 1 ? new Promise((_resolve, reject) => {
        failLean = reject;
      }) : undefined),
      here: () => {
        failLean?.(new Error('the leanest line failed'));
        failLean = undefined;
        return undefined;
      },
    }, async () => {
      await expect(week(LITE)).rejects.toThrow('the leanest line failed');
    });
    expect(unhandled).toEqual([]);
  });

  it('fails only the plan where the build MIP beside the leanest line fails, and the leanest line after it', async () => {
    let failLean: ((error: Error) => void) | undefined;
    const unhandled = await unhandledOf({
      aside: (_job, index) => (index === 1 ? new Promise((_resolve, reject) => {
        failLean = reject;
      }) : undefined),
      here: () => Promise.reject(new Error('the build MIP failed')),
    }, async () => {
      await expect(week(LITE)).rejects.toThrow('the build MIP failed');
      expect(failLean).toBeDefined();
      failLean?.(new Error('the leanest line failed after'));
    });
    expect(unhandled).toEqual([]);
  });
});
