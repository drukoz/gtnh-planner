import { describe, it, expect, vi } from 'vitest';
import { makePlan } from '../../helpers/layout-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import {
  COMPARE_MAX_RUNNING, COMPARE_TIME_LIMIT_SECONDS, CompareRunner, compareModes, compareSummary, creditedKeys, modeDifferences,
  modeSettings, rawKeys, type CompareStart,
} from '../../../src/server/planner/compare.ts';
import { objectiveOf } from '../../../src/server/planner/objective.ts';
import { emptyContext, settingsHash } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { PSEUDO_MACHINES } from '../../../src/shared/gt/tiers.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings, normalizeSettings, withObjectiveRules } from '../../../src/shared/project/apply-op.ts';
import type { CompareMode } from '../../../src/shared/types/api.ts';
import { PLAN_OBJECTIVES, type Plan, type PlanObjective, type PlanSettings, type RawInput } from '../../../src/shared/types/plan.ts';

// Add-on 17 Task 7 (architecture §11.45 (5)): the Compare card's modes, their summaries and differences, the modes planned
// in turn within a time limit, and one compare per project at a time.

/** A bought raw row of `key` (0.1 a second for 0.1 raw), with `extra` over it. */
function row(key: StuffKey, extra: Partial<RawInput> = {}): RawInput {
  return { key, perSecond: 0.1, cost: 0.1, available: true, sources: [], ...extra };
}

/** An `ok` plan of no steps that buys `keys`, with `extra` rows beside them. */
function buying(keys: StuffKey[], extra: RawInput[] = []): Plan {
  return { ...makePlan([]), rawInputs: [...keys.map((key) => row(key)), ...extra] };
}

/** An `ok` plan made in mode `objective` that buys `t:<objective>@0`. */
function planIn(objective: PlanObjective): Plan {
  return { ...buying([`t:${objective}@0`]), objective };
}

/** Whatever is due now: every pending callback and promise reaction. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the modes a compare plans (add-on 17, architecture §11.45 (5))', () => {
  it('plans each mode with its own settings', async () => {
    const least: PlanSettings = { ...defaultSettings(), buildHorizonHours: null, objective: 'least-raw' };
    expect(modeSettings(least, 'cheapest')).toMatchObject({ objective: 'cheapest', buildHorizonHours: 24 });
    expect(modeSettings(least, 'least-raw')).toMatchObject({ objective: 'least-raw', buildHorizonHours: null });
    expect(modeSettings({ ...defaultSettings(), buildHorizonHours: 8 }, 'multi-output')).toMatchObject({ objective: 'multi-output', buildHorizonHours: 8 });
    // Projects as the store keeps them: rate (cheapest, least raw by its mode or by add-on 12's null horizon, best
    // multi-output) and a Make N batch stored with a null horizon, which plans cheapest. Each mode's settings plan in that
    // mode; the current one's are the project's own (the plan route and the card share its cached plan), and every other
    // one's are what "Use this mode" leaves the project with (`withObjectiveRules`), so the plan it then serves is the
    // one the card planned.
    const stored = [
      normalizeSettings({}), normalizeSettings({ buildHorizonHours: null }), normalizeSettings({ buildHorizonHours: 8 }),
      normalizeSettings({ objective: 'least-raw', buildHorizonHours: 8 }), normalizeSettings({ objective: 'multi-output', buildHorizonHours: 8 }),
      normalizeSettings({ mode: 'makeN', buildHorizonHours: null }),
    ];
    for (const s of stored) {
      const current = objectiveOf(s);
      expect(settingsHash(modeSettings(s, current)), JSON.stringify(s)).toBe(settingsHash(s));
      for (const o of PLAN_OBJECTIVES) {
        expect(objectiveOf(modeSettings(s, o))).toBe(o);
        if (o !== current) expect(settingsHash(modeSettings(s, o)), `${o} of ${JSON.stringify(s)}`).toBe(settingsHash(withObjectiveRules(s, { objective: o })));
      }
    }
    // One pricing for the two modes that count build cost; least raw, which counts none, is the line's second.
    const pack = miniGt();
    const s = normalizeSettings({ target: 't:circuit@0', tier: 1 });
    const cheapest = linePricing(pack, modeSettings(s, 'cheapest'), emptyContext());
    expect(cheapest).not.toBeNull();
    expect(linePricing(pack, modeSettings(s, 'multi-output'), emptyContext())).toBe(cheapest);
    const leastRaw = linePricing(pack, modeSettings(s, 'least-raw'), emptyContext());
    expect(leastRaw).not.toBe(cheapest);
    expect((await Promise.all([cheapest, leastRaw])).map((p) => p?.target)).toEqual(['t:circuit@0', 't:circuit@0']);
  });

  it('sums up a plan for the card', () => {
    const pool = { id: 'pool:a', steps: ['b', 'c'] };
    const plan = makePlan([
      { id: 'a', mteId: 101, count: 3, owned: 1 },
      { id: 'b', mteId: 102, count: 2, pool }, { id: 'c', mteId: 102, count: 2, pool },
      { id: 'd', mteId: PSEUDO_MACHINES.CRAFTING_TABLE, count: 1, handCraft: true },
    ]);
    const card: Plan = { ...plan, cost: { runPerHour: 12, build: 40, horizonHours: 24 }, rawSources: 3, power: { ...plan.power, peakEUt: 96 } };
    expect(compareSummary(card)).toEqual({ rawPerHour: 12, rawBuild: 40, newMachines: 4, rawSources: 3, steps: 4, peakEUt: 96 });
    const credit = (key: StuffKey, to: string) => ({ to, name: to, key, perSecond: 0.1 });
    expect(creditedKeys({ ...card, credits: [credit('t:y@0', 'p2'), credit('t:a@0', 'p3'), credit('t:y@0', 'p4')] })).toEqual(['t:a@0', 't:y@0']);
    expect(creditedKeys(card)).toEqual([]);
    // Without `cost` and `rawSources`: the raw material a second for an hour, nothing to build, the bought raw goods.
    const bare: Plan = { ...buying(['t:a@0', 't:b@0'], [row('t:w@0', { cost: 0 })]), rawCost: { perSecond: 0.01, leastPerSecond: 0.01 } };
    expect(compareSummary(bare)).toMatchObject({ rawPerHour: 36, rawBuild: 0, newMachines: 0, rawSources: 2, steps: 0 });
    // Make N: the steps of one machine type share its machines (make-n.ts), so each type counts once.
    const batch: Plan = {
      ...makePlan([{ id: 'x', mteId: 101, count: 1 }, { id: 'y', mteId: 101, count: 1 }, { id: 'z', mteId: 102, count: 1, owned: 1 }]),
      makeN: { totalSeconds: 10, leftovers: [] },
    };
    expect(compareSummary(batch).newMachines).toBe(1);
  });

  it('says which inputs each mode avoids', () => {
    // A free row, a farm's tool wear and a supply from another project (whatever its cost) are no raw goods it buys.
    const notBought = [
      row('t:water@0', { cost: 0 }), row('t:saw@0', { upkeep: true }),
      row('t:d@0', { from: { kind: 'project', id: 'p2', name: 'Two' } }),
    ];
    const least = buying(['t:a@0', 't:b@0'], notBought);
    const cheapest = buying(['t:a@0', 't:c@0'], notBought);
    const multi = buying(['t:a@0'], notBought);
    expect([...rawKeys(least)]).toEqual(['t:a@0', 't:b@0']);
    expect(modeDifferences(new Map([['least-raw', least], ['cheapest', cheapest], ['multi-output', multi]]))).toEqual(new Map([
      ['least-raw', { avoids: ['t:c@0'], adds: ['t:b@0'] }],
      ['cheapest', { avoids: ['t:b@0'], adds: ['t:c@0'] }],
      ['multi-output', { avoids: ['t:b@0', 't:c@0'], adds: [] }],
    ]));
  });

  it('gives up waiting at the time limit and says when the rest is done', async () => {
    const late = Promise.withResolvers<Plan>();
    const log: string[] = [];
    const planMode = (o: PlanObjective): Promise<Plan> => {
      log.push(`plan ${o}`);
      const plan = o === 'multi-output' ? late.promise : Promise.resolve(planIn(o));
      void plan.then(() => log.push(`settled ${o}`));
      return plan;
    };
    const onLate = vi.fn();
    const modes = await compareModes(planMode, { current: 'cheapest', limitSeconds: 0.05, onLate });
    expect(modes.map((m) => [m.objective, m.status])).toEqual([['least-raw', 'ok'], ['cheapest', 'ok'], ['multi-output', 'pending']]);
    expect(modes[2]).toEqual({ objective: 'multi-output', status: 'pending' });
    // the finished modes against each other
    expect(modes[0]).toEqual({
      objective: 'least-raw', status: 'ok', summary: compareSummary(planIn('least-raw')), avoids: ['t:cheapest@0'], adds: ['t:least-raw@0'],
    });
    expect(onLate).not.toHaveBeenCalled();
    // the current mode first, then the others in turn, each only after the one before it settled
    expect(log).toEqual(['plan cheapest', 'settled cheapest', 'plan least-raw', 'settled least-raw', 'plan multi-output']);
    late.resolve(planIn('multi-output'));
    await settle();
    expect(onLate).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onLate).toHaveBeenCalledTimes(1);

    // A run that went stale while its current mode planned starts no other mode and never says it is done.
    let stale = false;
    const started: PlanObjective[] = [];
    const staleLate = vi.fn();
    const cut = await compareModes((o) => {
      started.push(o);
      if (o === 'cheapest') stale = true;
      return Promise.resolve(planIn(o));
    }, { current: 'cheapest', limitSeconds: 0.05, onLate: staleLate, stale: () => stale });
    expect(started).toEqual(['cheapest']);
    expect(cut.map((m) => m.status)).toEqual(['pending', 'ok', 'pending']);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(staleLate).not.toHaveBeenCalled();

    // Nor does one that went stale after its answer, while a mode it had not finished still planned.
    let after = false;
    const slow = Promise.withResolvers<Plan>();
    const tried: PlanObjective[] = [];
    const afterLate = vi.fn();
    const answered = await compareModes((o) => {
      tried.push(o);
      return o === 'least-raw' ? slow.promise : Promise.resolve(planIn(o));
    }, { current: 'cheapest', limitSeconds: 0.05, onLate: afterLate, stale: () => after });
    expect(answered.map((m) => m.status)).toEqual(['pending', 'ok', 'pending']);
    after = true;
    slow.resolve(planIn('least-raw'));
    await settle();
    expect(tried).toEqual(['cheapest', 'least-raw']);
    expect(afterLate).not.toHaveBeenCalled();

    // A mode without a plan fails: with the rejection's message, or with the first warning of a plan that is not ok.
    const infeasible: Plan = {
      ...makePlan([], { status: 'infeasible' }),
      warnings: [{ code: 'no-route', text: 'Nothing here makes Tee' }, { code: 'other', text: 'second' }],
    };
    const failed = await compareModes((o) => {
      if (o === 'least-raw') return Promise.reject(new Error('no export'));
      return Promise.resolve(o === 'multi-output' ? infeasible : planIn(o));
    }, { current: 'cheapest', limitSeconds: 1, onLate: vi.fn() });
    expect(failed).toEqual([
      { objective: 'least-raw', status: 'failed', error: 'no export' },
      { objective: 'cheapest', status: 'ok', summary: compareSummary(planIn('cheapest')), avoids: [], adds: ['t:cheapest@0'] },
      { objective: 'multi-output', status: 'failed', error: 'Nothing here makes Tee' },
    ]);
  });

  it('names the goods a mode is credited for', async () => {
    const credited: Plan = { ...planIn('multi-output'), credits: [{ to: 'p2', name: 'Glue line', key: 't:plantball@0', perSecond: 0.01 }] };
    const modes = await compareModes((o) => Promise.resolve(o === 'multi-output' ? credited : planIn(o)), {
      current: 'cheapest', limitSeconds: 1, onLate: vi.fn(),
    });
    expect(modes.map((m) => m.credited)).toEqual([undefined, undefined, ['t:plantball@0']]);
  });

  it('runs one compare per project, the newest settings winning', async () => {
    expect([COMPARE_TIME_LIMIT_SECONDS, COMPARE_MAX_RUNNING]).toEqual([20, 2]);
    const runner = new CompareRunner(1);
    const started: string[] = [];
    const runs = new Map<string, { stale: () => boolean; answer: PromiseWithResolvers<CompareMode[]> }>();
    const startOf = (label: string): CompareStart => (stale) => {
      started.push(label);
      const answer = Promise.withResolvers<CompareMode[]>();
      runs.set(label, { stale, answer });
      return answer.promise;
    };
    const answerOf = (label: string): CompareMode[] => [{ objective: 'cheapest', status: 'failed', error: label }];
    const finish = async (label: string): Promise<void> => {
      runs.get(label)?.answer.resolve(answerOf(label));
      await settle();
    };

    // two calls for the same settings at once share one run
    const first = runner.run('p1', 'h1', startOf('p1 h1'));
    const second = runner.run('p1', 'h1', startOf('p1 h1 again'));
    expect(started).toEqual(['p1 h1']);
    expect(runs.get('p1 h1')?.stale()).toBe(false);
    // another project waits while p1 runs (one at a time with maxRunning 1)
    const other = runner.run('p2', 'h1', startOf('p2 h1'));
    // other settings make the running one stale and wait for it; a later call replaces the waiting one
    const h2 = runner.run('p1', 'h2', startOf('p1 h2'));
    expect(runs.get('p1 h1')?.stale()).toBe(true);
    const h3 = runner.run('p1', 'h3', startOf('p1 h3'));
    await settle();
    expect(started).toEqual(['p1 h1']);

    await finish('p1 h1');
    const answer = await first;
    expect(answer).toEqual(answerOf('p1 h1'));
    expect(await second).toBe(answer);
    // p2 asked before p1's newer settings did: arrival order
    expect(started).toEqual(['p1 h1', 'p2 h1']);
    await finish('p2 h1');
    expect(await other).toEqual(answerOf('p2 h1'));
    // the replaced call never starts and gets the newest run's answer
    expect(started).toEqual(['p1 h1', 'p2 h1', 'p1 h3']);
    expect(runs.get('p1 h3')?.stale()).toBe(false);
    await finish('p1 h3');
    expect(await h3).toEqual(answerOf('p1 h3'));
    expect(await h2).toBe(await h3);

    // Nothing runs any more: the next call starts at once, and a failed run fails its callers and frees its turn.
    const failing = runner.run('p1', 'h4', () => Promise.reject(new Error('boom')));
    await expect(failing).rejects.toThrow('boom');
    await settle();
    const next = runner.run('p1', 'h5', startOf('p1 h5'));
    expect(started.at(-1)).toBe('p1 h5');
    await finish('p1 h5');
    expect(await next).toEqual(answerOf('p1 h5'));
  });

  it("holds a project's turn while its modes still plan past its answer", async () => {
    const runner = new CompareRunner(2);
    const planning = Promise.withResolvers<void>();
    const stales: Array<() => boolean> = [];
    const answer = await runner.run('p1', 'h1', (stale, keepPlanning) => {
      stales.push(stale);
      keepPlanning(planning.promise);
      return Promise.resolve([{ objective: 'cheapest', status: 'pending' }]);
    });
    expect(answer).toEqual([{ objective: 'cheapest', status: 'pending' }]);
    // the same settings share the answered run; other settings make it stale and wait until its planning ends
    expect(await runner.run('p1', 'h1', () => Promise.reject(new Error('never started')))).toBe(answer);
    let started = false;
    const newer = runner.run('p1', 'h2', () => {
      started = true;
      return Promise.resolve([]);
    });
    expect(stales[0]?.()).toBe(true);
    await settle();
    expect(started).toBe(false);
    planning.resolve();
    await settle();
    expect(started).toBe(true);
    expect(await newer).toEqual([]);
  });
});
