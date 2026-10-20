// The build-cost MIP inside `solveLine` (plan 12 Task 4, spec §3.3 Objective and "Reusing machines we have"): whole new
// machines weighed against the raw material they save over the horizon, the tier that is cheaper to build, sharing pools
// of new and owned machines on a network, owned machines of another tier beside new ones, steps bounded by owned machines
// that cannot be built, Make N against the batch, the step charge against the raw material with gathered blocks dug, the
// cleanroom, the relaxation rounded up when the time guard stops the MIP, and with build cost ignored plan 09's stages
// within the owned-only bounds, their machines sized by plan 09's pick (ruling P2).

import { describe, it, expect } from 'vitest';
import {
  cleanSpec, fastSlowSpec, freeSpec, hammerSpec, handSpec, opt, pressSpec, solderSpec, solvedWithBuild, twoFreeSpec, twoPressSpec,
} from '../../helpers/build-fixtures.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import type { MachineOption } from '../../../src/server/planner/machine-options.ts';
import type { SolveOptions } from '../../../src/server/planner/solve.ts';

const COSTS: Record<StuffKey, number> = { 't:a@0': 1, 't:b@0': 1, 't:part@0': 1, 't:tin_ingot@0': 1, 't:antimony@0': 1 };
/** Each board recipe on an assembler, each extractor recipe on an extractor, the alloy smelter (Task 4's solder line). */
const SOLDER = {
  'board-tin': [opt(121, 1, 0.2, 16)], 'board-solder': [opt(121, 1, 0.2, 16)],
  'x-tin': [opt(131, 1, 0.5, 12)], 'x-solder': [opt(131, 1, 0.5, 12)], 'alloy-solder': [opt(201, 1, 0.1, 20)],
};
/** Cobblestone free, gravel and sand dug at 1 or made on the line. */
const GLASS: Record<StuffKey, number> = { 't:cobble@0': 0, 't:gravel@0': 1, 't:sand@0': 1 };
const HAMMERS = { 'h-gravel': [opt(481, 1, 0.5, 17)], 'h-sand': [opt(481, 1, 0.5, 17)], smelt: [opt(151, 1, 0.5, 16)] };
const GATHERED: StuffKey[] = ['t:gravel@0', 't:sand@0'];
const CHARGED = { stepCharge: 0.02, handWeight: 3 };
/** An owned machine of `opt` that cannot be built here. */
const unbuildable = (o: MachineOption): MachineOption => ({ ...o, canAdd: false, unbuildable: 'no recipe in this pack' });

describe('the build-cost MIP', () => {
  it('builds the machine that pays for itself over the horizon', async () => {
    // 24 boards: tin 48 + 28 = 76 < solder 36 + 48 = 84; 168 boards: tin 336 + 28 = 364 > solder 252 + 48 = 300.
    const day = await solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER });
    expect(day.runs).toEqual(['board-tin', 'x-tin']);
    expect(day.sol.machines?.get('board-tin')).toMatchObject({ option: { mteId: 121 }, added: 1, ownedLoad: 0 });
    expect(day.sol.machines?.get('x-tin')).toMatchObject({ option: { mteId: 131 }, added: 1 });
    const week = await solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER, horizonSeconds: 604800 });
    expect(week.runs).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    for (const id of week.runs) expect(week.sol.machines?.get(id)).toMatchObject({ added: 1 });
  });

  it('counts whole machines and picks the tier that is cheaper to build', async () => {
    const options = { press: [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 16)] };
    // LV 5 × 10 = 50 > MV ceil(2.5) × 16 = 48; at 0.2/s one machine either way, 10 < 16.
    const fast = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options });
    expect(fast.sol.machines?.get('press')).toMatchObject({ option: { mteId: 102 }, added: 3 });
    expect((fast.sol.runs.get('press') as number) / 0.4).toBeLessThanOrEqual(3 + 1e-9);
    const slow = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 0.2]], { options });
    expect(slow.sol.machines?.get('press')).toMatchObject({ option: { mteId: 101 }, added: 1 });
  });

  it('reuses owned machines for free and shares them only on a network', async () => {
    const options = { 'press-a': [opt(101, 1, 0.2, 10, 1)], 'press-b': [opt(101, 1, 0.2, 10, 1)] };
    const demand: Array<[StuffKey, number]> = [['t:t1@0', 0.1], ['t:t2@0', 0.1]];
    const direct = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options });
    const steps = [...(direct.sol.machines?.values() ?? [])];
    expect(steps).toHaveLength(2);
    expect(steps.reduce((n, m) => n + m.added, 0)).toBe(1);
    expect(steps.reduce((n, m) => n + m.ownedLoad, 0)).toBe(1);   // one step keeps the owned machine whole
    const shared = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options, share: true });
    for (const id of ['press-a', 'press-b']) expect(shared.sol.machines?.get(id)).toMatchObject({ added: 0, newLoad: 0, ownedLoad: 0.5 });
    expect([...(shared.sol.pools?.values() ?? [])]).toMatchObject([{ added: 0, steps: ['press-a', 'press-b'] }]);
  });

  it('shares one new forge hammer between gravel and sand on a network', async () => {
    // σ = 1,440 (1 raw a glass with sand dug, 24 h at 1/min), a step 28.8: one shared hammer 17 + 16 + 3 × 28.8 = 119.4 <
    // a hammer per step 50 + 86.4 = 136.4 < gravel by hand 33 + 28.8 × 5 = 177 < digging the sand 1,440 + 16 + 28.8.
    const demand: Array<[StuffKey, number]> = [['t:glass@0', 1 / 60]];
    const shared = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED, share: true }, CHARGED);
    expect(shared.runs).toEqual(['h-gravel', 'h-sand', 'smelt']);
    const pools = [...(shared.sol.pools?.values() ?? [])].sort((a, b) => (a.steps[0] as string).localeCompare(b.steps[0] as string));
    expect(pools).toMatchObject([
      { option: { mteId: 481 }, added: 1, steps: ['h-gravel', 'h-sand'] },
      { option: { mteId: 151 }, added: 1, steps: ['smelt'] },
    ]);
    for (const id of ['h-gravel', 'h-sand']) {
      const m = shared.sol.machines?.get(id);
      expect(m).toMatchObject({ option: { mteId: 481 }, added: 0, pool: '481:1:|-|' });   // no circuit, nothing held
      expect(Math.abs((m?.newLoad ?? 0) - 1 / 30)).toBeLessThan(1e-9);   // 1/60 runs a second ÷ 0.5
    }
    // The later stages keep to the machines exactly: no hair of dug sand bought, none sold back below 0.
    expect([...shared.sol.buys.keys()]).toEqual(['t:cobble@0']);
    expect(shared.sol.rawCost).toBe(0);
    const direct = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED }, CHARGED);
    expect(direct.runs).toEqual(['h-gravel', 'h-sand', 'smelt']);
    for (const id of ['h-gravel', 'h-sand']) expect(direct.sol.machines?.get(id)).toMatchObject({ option: { mteId: 481 }, added: 1, newLoad: 1 });
    expect(direct.sol.pools?.size ?? 0).toBe(0);
  });

  it('counts a pool\'s machines from its combined load', async () => {
    // 0.6 glass a second: 1.2 machines of each hammer step and 1.2 of the furnace; digging would cost 51,840 raw a day.
    const demand: Array<[StuffKey, number]> = [['t:glass@0', 0.6]];
    const shared = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED, share: true }, CHARGED);
    const pools = new Map([...(shared.sol.pools?.values() ?? [])].map((p) => [p.option.mteId, p.added]));
    expect(pools).toEqual(new Map([[481, 3], [151, 2]]));
    const direct = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED }, CHARGED);
    for (const id of ['h-gravel', 'h-sand']) expect(direct.sol.machines?.get(id)).toMatchObject({ added: 2 });
  });

  it('charges steps against the raw material with gathered blocks dug', async () => {
    // 1 glass an hour: σ = 24, a step 0.48, a hand step 1.44. Shared: one hammer 33 + 1.44 = 34.44 < gravel by hand
    // 33 + 0.48 × 5 = 35.4 < digging 24 + 16 + 0.48 = 40.48; per step: 35.4 < 40.48 < a hammer per step 50 + 1.44. Over one
    // hour (σ = 1): digging 1 + 16 + 0.02 = 17.02 < 33.06. Measured against S1 (0 here) the shared hammer and the hand step
    // would tie at 33.
    const demand: Array<[StuffKey, number]> = [['t:glass@0', 1 / 3600]];
    const build = { options: HAMMERS, alsoMade: GATHERED };
    expect((await solvedWithBuild(hammerSpec(), GLASS, demand, { ...build, share: true }, CHARGED)).runs).toEqual(['h-gravel', 'h-sand', 'smelt']);
    expect((await solvedWithBuild(hammerSpec(), GLASS, demand, build, CHARGED)).runs).toEqual(['h-sand', 'hand-gravel', 'smelt']);
    for (const share of [true, false]) {
      const hour = await solvedWithBuild(hammerSpec(), GLASS, demand, { ...build, share, horizonSeconds: 3600 }, CHARGED);
      expect(hour.runs).toEqual(['smelt']);
    }
  });

  it('drops a second free route on a shared machine', async () => {
    // S1 = S1g = 0, so σ = 1 and a step costs 0.02 raw: one bender and one step 10.02 < one bender and two steps 10.04.
    const options = { 'p-a': [opt(101, 1, 0.2, 10)], 'p-b': [opt(101, 1, 0.2, 10)] };
    const { runs, sol } = await solvedWithBuild(twoFreeSpec(), { 't:a@0': 0, 't:b@0': 0 }, [['t:t@0', 0.1]], { options, share: true }, { stepCharge: 0.02 });
    expect(runs).toHaveLength(1);
    expect(['p-a', 'p-b']).toContain(runs[0]);
    expect([...(sol.pools?.values() ?? [])]).toMatchObject([{ option: { mteId: 101 }, added: 1, steps: runs }]);
  });

  it('never shares a machine between programmed circuits, held items or fluids', async () => {
    // 0.5 of a bender for each step.
    const costs = { ...COSTS, 'fluid:molten.iron': 1 / 144, 'fluid:molten.tin': 1 / 144 };
    const demand: Array<[StuffKey, number]> = [['t:t1@0', 0.1], ['t:t2@0', 0.1]];
    const pools = async (spec: ReturnType<typeof twoPressSpec>, owned = 0) => {
      const { sol } = await solvedWithBuild(spec, costs, demand, {
        options: { 'press-a': [opt(101, 1, 0.2, 10, owned)], 'press-b': [opt(101, 1, 0.2, 10, owned)] }, share: true,
      });
      return { sol, pools: [...(sol.pools?.values() ?? [])] };
    };
    expect((await pools(twoPressSpec())).pools).toMatchObject([{ option: { mteId: 101 }, added: 1 }]);
    for (const spec of [
      twoPressSpec({ circuits: [1, 2] }), twoPressSpec({ held: ['t:mold_a@0', 't:mold_b@0'] }),
      twoPressSpec({ held: ['t:mold_a@0', 't:mold_a@0'], fluids: ['fluid:molten.iron', 'fluid:molten.tin'] }),   // one input tank holds one fluid
    ]) {
      expect((await pools(spec)).pools).toMatchObject([{ option: { mteId: 101 }, added: 1 }, { option: { mteId: 101 }, added: 1 }]);
    }
    expect((await pools(twoPressSpec({ fluids: ['fluid:molten.iron', 'fluid:molten.iron'] }))).pools).toMatchObject([{ added: 1 }]);
    // One owned machine serves one key: one step runs on it, the other on a new one.
    const owned = await pools(twoPressSpec({ circuits: [1, 2] }), 1);
    expect(owned.pools.reduce((n, p) => n + p.added, 0)).toBe(1);
    const steps = [...(owned.sol.machines?.values() ?? [])];
    expect(steps.filter((m) => m.ownedLoad === 0.5 && m.newLoad === 0)).toHaveLength(1);
    expect(steps.filter((m) => m.newLoad === 0.5 && m.ownedLoad === 0)).toHaveLength(1);
  });

  it('runs a step on owned machines of another tier beside new ones', async () => {
    // The owned MV press does 0.4 runs a second and 3 new LV presses the other 0.6: 30, against 1 owned + 2 new MV for 32
    // and 5 LV for 50.
    const { sol } = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options: { press: [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 16, 1)] } });
    expect(sol.machines?.get('press')).toMatchObject({ option: { mteId: 101 }, added: 3, ownedLoad: 0, others: [{ option: { mteId: 102 }, ownedLoad: 1 }] });
  });

  it('runs a step only on the owned machines it cannot add to', async () => {
    // Its one machine's 0.2 runs a second, 2 slow presses the other 0.3: 20 to build and 0.8 raw a second, against 3 slow
    // presses for 30 and 1 raw a second.
    const options = { fast: [unbuildable(opt(301, 1, 0.2, null, 1))], slow: [opt(302, 1, 0.2, 10)] };
    const both = await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 0.5]], { options });
    expect(both.runs).toEqual(['fast', 'slow']);
    expect(both.sol.machines?.get('fast')).toMatchObject({ added: 0, ownedLoad: 1 });
    expect(both.sol.machines?.get('slow')).toMatchObject({ added: 2 });
    const press = { press: [unbuildable(opt(101, 1, 0.2, null, 1))] };
    expect((await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 0.1]], { options: press })).sol.machines?.get('press'))
      .toMatchObject({ added: 0, ownedLoad: 1 });
    const short = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options: press });
    expect(short.sol.status).toBe('infeasible');
    expect(short.sol.blockers).toEqual([]);
    expect(short.sol.warnings).toContainEqual({ code: 'owned-only', key: 't:t@0', text: '1× M101, which cannot be built here (no recipe in this pack)' });
  });

  it('ends a line whose steps need more owned machines that cannot be built than the group has', async () => {
    // One owned bender that cannot be built, half of it for each step: whole machines per step need two, so the build
    // MIP has no solution and its relaxation's rounding leaves the second step short; a network shares the one.
    const options = { 'press-a': [unbuildable(opt(101, 1, 0.2, null, 1))], 'press-b': [unbuildable(opt(101, 1, 0.2, null, 1))] };
    const demand: Array<[StuffKey, number]> = [['t:t1@0', 0.1], ['t:t2@0', 0.1]];
    const text = '1× M101, which cannot be built here (no recipe in this pack)';
    for (const horizonSeconds of [86400, null]) {
      const { sol } = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options, horizonSeconds });
      expect(sol.status).toBe('infeasible');
      expect(sol.blockers).toEqual([]);
      expect(sol.warnings).toEqual([{ code: 'owned-only', key: 't:t1@0', text }, { code: 'owned-only', key: 't:t2@0', text }]);
    }
    const shared = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options, share: true });
    for (const id of ['press-a', 'press-b']) expect(shared.sol.machines?.get(id)).toMatchObject({ added: 0, ownedLoad: 0.5 });
    // One owned machine serves one sharing key.
    expect((await solvedWithBuild(twoPressSpec({ circuits: [1, 2] }), COSTS, demand, { options, share: true })).sol.status).toBe('infeasible');
  });

  it('gives the owned machines that cannot be built to the steps that can only use them first', async () => {
    // press-b can only run on the owned MV press that cannot be built; press-a could run on it too, but it can add LV
    // presses. Sized in id order, press-a took the owned press and left press-b short: with build cost ignored and in the
    // time guard's fallback the line ended infeasible, although the build MIP plans it.
    const mv = unbuildable(opt(102, 2, 0.4, null, 1));
    const options = { 'press-a': [opt(101, 1, 0.2, 10), mv], 'press-b': [mv] };
    const ways: Array<{ horizonSeconds?: number | null; opts?: SolveOptions }> = [
      {},                                // the build MIP
      { horizonSeconds: null },          // build cost ignored: plan 09's plan sized by `roundUp`
      { opts: { buildTimeLimit: 0 } },   // the time guard's fallback: the relaxation sized by `roundUp`
    ];
    for (const { horizonSeconds, opts } of ways) {
      const { sol } = await solvedWithBuild(twoPressSpec(), COSTS, [['t:t1@0', 0.1], ['t:t2@0', 0.1]], { options, horizonSeconds }, opts);
      expect(sol.status).toBe('ok');
      expect(sol.machines?.get('press-a')).toMatchObject({ option: { mteId: 101 }, added: 1, ownedLoad: 0 });
      expect(sol.machines?.get('press-b')).toMatchObject({ option: { mteId: 102 }, added: 0, ownedLoad: 1 });
      // On a network the two share it: press-b takes 0.75 of it, press-a the other 0.25 beside one new LV press.
      const shared = await solvedWithBuild(twoPressSpec(), COSTS, [['t:t1@0', 0.3], ['t:t2@0', 0.3]], { options, horizonSeconds, share: true }, opts);
      expect(shared.sol.status).toBe('ok');
      expect(shared.sol.machines?.get('press-a'))
        .toMatchObject({ option: { mteId: 101 }, newLoad: 1, ownedLoad: 0, others: [{ option: { mteId: 102 }, ownedLoad: 0.25 }] });
      expect(shared.sol.machines?.get('press-b')).toMatchObject({ option: { mteId: 102 }, newLoad: 0, ownedLoad: 0.75 });
      expect(shared.sol.pools?.get('101:1:|-|')).toMatchObject({ added: 1 });
    }
  });

  it('weighs a derived purchase without the start\'s bound when that start leaves a step short', async () => {
    // press-a and press-b can only use the one owned LV press that cannot be built, whole per step. S1 makes t1 from a
    // (1 raw) rather than from the derived d (1.5), and its rounding gives the press to press-a and leaves press-b short,
    // so that start is no plan: bounded by its objective (1.01 raw a unit of demand), the MIP could buy 0.67 of the one
    // unit of d that t1 takes, and the line ended infeasible. It runs press-b on the owned press, press-c on a new MV one.
    const spec = twoPressSpec();
    spec.recipes = [...(spec.recipes ?? []), { id: 'press-c', map: 'gt.recipe.metalbender', in: [['t:d@0', 1]], out: [['t:t1@0', 1]], eut: 24, dur: 100 }];
    const lv = unbuildable(opt(101, 1, 0.2, null, 1));
    const options = { 'press-a': [lv], 'press-b': [lv], 'press-c': [opt(102, 2, 0.4, 16)] };
    const demand: Array<[StuffKey, number]> = [['t:t1@0', 0.1], ['t:t2@0', 0.001]];
    const { runs, sol } = await solvedWithBuild(spec, { ...COSTS, 't:d@0': 1.5 }, demand, { options, derived: ['t:d@0'] });
    expect(sol.status).toBe('ok');
    expect(runs).toEqual(['press-b', 'press-c']);
    expect(sol.machines?.get('press-b')).toMatchObject({ added: 0, ownedLoad: 1 });
    expect(sol.machines?.get('press-c')).toMatchObject({ option: { mteId: 102 }, added: 1 });
  });

  it('builds a multiblock at the hatch tier that is cheaper to build', async () => {
    // Task 3's Large Bender at MV: one machine either way at 0.2/s (the LV energy hatch is cheaper); 2 × 81.5 > 86.5 at 0.4/s.
    const options = { press: [{ ...opt(1100, 1, 0.2, 81.5), kind: 'multiblock' as const }, { ...opt(1100, 2, 0.4, 86.5), kind: 'multiblock' as const }] };
    expect((await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 0.2]], { options })).sol.machines?.get('press'))
      .toMatchObject({ option: { mteId: 1100, tier: 1 }, added: 1 });
    expect((await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 0.4]], { options })).sol.machines?.get('press'))
      .toMatchObject({ option: { tier: 2 }, added: 1 });
  });

  it('counts an unpriced machine at its stand-in build', async () => {
    // 24 a day: fast 24 + 40 = 64 > slow 48 + 10 = 58; at a stand-in of 0, as before this rule, the unpriced route builds for free.
    const demand: Array<[StuffKey, number]> = [['t:t@0', 1 / 3600]];
    const gap = await solvedWithBuild(fastSlowSpec(), COSTS, demand, { options: { fast: [opt(301, 1, 0.2, null, 0, 40)], slow: [opt(302, 1, 0.2, 10)] } });
    expect(gap.runs).toEqual(['slow']);
    const free = await solvedWithBuild(fastSlowSpec(), COSTS, demand, { options: { fast: [opt(301, 1, 0.2, null)], slow: [opt(302, 1, 0.2, 10)] } });
    expect(free.runs).toEqual(['fast']);
  });

  it('plans the machines of a line that needs no raw material', async () => {
    // By hand the line would buy 86,400 raw of c a day against 50 to build 5 benders.
    const { runs, sol } = await solvedWithBuild(freeSpec(), { 't:a@0': 0, 't:c@0': 1 }, [['t:t@0', 1]], { options: { 'p-machine': [opt(101, 1, 0.2, 10)] } });
    expect(sol.leastRawCost).toBe(0);
    expect(runs).toEqual(['p-machine']);
    expect(sol.machines?.get('p-machine')).toMatchObject({ added: 5 });
    expect(sol.buildStats).toBeDefined();
  });

  it('runs Make N on owned machines unless a new one pays for itself', async () => {
    // 10: 20 < 10 + 50; 100: 150 < 200.
    const build = { options: { fast: [opt(301, 1, 0.2, 50)], slow: [opt(302, 1, 0.2, 30, 1)] }, mode: 'makeN' as const, horizonSeconds: null };
    const ten = await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 10]], build);
    expect(ten.runs).toEqual(['slow']);
    expect(ten.sol.machines?.get('slow')).toMatchObject({ added: 0 });
    const hundred = await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 100]], build);
    expect(hundred.runs).toEqual(['fast']);
    expect(hundred.sol.machines?.get('fast')).toMatchObject({ added: 1 });
  });

  it('charges a hand step in a running line', async () => {
    // F = 1,440: machine 1 + 0.02 + 10 / 1,440 = 1.027 < hand 1 + 0.06; F = 24: machine 1.02 + 10 / 24 = 1.437 > 1.06.
    const build = { options: { 'p-machine': [opt(101, 1, 0.2, 10)] } };
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 60]], build, CHARGED)).runs).toEqual(['p-machine']);
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 3600]], build, CHARGED)).runs).toEqual(['p-hand']);
  });

  it('builds a cleanroom only when it pays', async () => {
    // 1/min: 1,440 + 110 < 2,880 + 10; 1/h: 24 + 110 > 48 + 10. A pricing-gap cleanroom weighs its stand-in.
    const options = { clean: [opt(101, 1, 0.2, 10)], dirty: [opt(111, 1, 0.2, 10)] };
    for (const build of [100, null]) {
      const cleanroom = { mteId: 900, name: 'Cleanroom', build, solveBuild: 100, owned: 0 };
      const busy = await solvedWithBuild(cleanSpec(), COSTS, [['t:t@0', 1 / 60]], { options, cleanroom });
      expect(busy.runs).toEqual(['clean']);
      expect(busy.sol.cleanroom).toBe(true);
      const idle = await solvedWithBuild(cleanSpec(), COSTS, [['t:t@0', 1 / 3600]], { options, cleanroom });
      expect(idle.runs).toEqual(['dirty']);
      expect(idle.sol.cleanroom).toBe(false);
    }
  });

  it('falls back to the relaxation rounded up when the time guard stops the MIP', async () => {
    // The relaxation runs on MV at 16 / 0.4 = 40 per run a second against LV's 10 / 0.2 = 50; 2.5 rounded up.
    const { sol } = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options: { press: [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 16)] } }, { buildTimeLimit: 0 });
    expect(sol.warnings).toContainEqual(expect.objectContaining({ code: 'build-cost-approx' }));
    expect(sol.buildStats).toMatchObject({ status: 'skipped', approx: true });
    expect(sol.machines?.get('press')).toMatchObject({ option: { mteId: 102 }, added: 3 });
  });

  it('keeps plan 09 stages when build cost is ignored', async () => {
    // Least raw material (plan 09's stages); the machines are sized from that plan (ruling P2), with no build MIP.
    const { runs, sol } = await solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER, horizonSeconds: null });
    expect(runs).toEqual(['alloy-solder', 'board-solder', 'x-solder']);
    expect(sol.buildStats).toBeUndefined();
    expect(sol.machines?.get('board-solder')).toMatchObject({ option: { mteId: 121 }, added: 1 });
  });

  it('sizes machines by plan 09\'s pick when build cost is ignored', async () => {
    // Ruling P2: the new machines go to the highest tier, or to the owned type; the owned machine runs first.
    const demand: Array<[StuffKey, number]> = [['t:t@0', 1]];
    const none = await solvedWithBuild(pressSpec(), COSTS, demand, { options: { press: [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 16)] }, horizonSeconds: null });
    expect(none.sol.machines?.get('press')).toMatchObject({ option: { mteId: 102 }, added: 3, ownedLoad: 0 });
    const lv = await solvedWithBuild(pressSpec(), COSTS, demand, { options: { press: [opt(101, 1, 0.2, 10, 1), opt(102, 2, 0.4, 16)] }, horizonSeconds: null });
    expect(lv.sol.machines?.get('press')).toMatchObject({ option: { mteId: 101 }, added: 4, ownedLoad: 1 });
  });

  it('bounds a step by the owned machines it cannot add to when build cost is ignored', async () => {
    // Amendment OQ3 (ruling P2): the owned-only bound holds in every mode.
    const options = { fast: [unbuildable(opt(301, 1, 0.2, null, 1))], slow: [opt(302, 1, 0.2, 10)] };
    const { runs, sol } = await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 0.5]], { options, horizonSeconds: null });
    expect(runs).toEqual(['fast', 'slow']);
    expect(sol.runs.get('fast')).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(sol.machines?.get('fast')).toMatchObject({ added: 0, ownedLoad: 1 });
    expect(sol.machines?.get('slow')).toMatchObject({ added: 2 });
    const short = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options: { press: [unbuildable(opt(101, 1, 0.2, null, 1))] }, horizonSeconds: null });
    expect(short.sol.status).toBe('infeasible');
    expect(short.sol.warnings).toContainEqual({ code: 'owned-only', key: 't:t@0', text: '1× M101, which cannot be built here (no recipe in this pack)' });
  });
});
