// The build-cost MIP inside `solveLine` (plan 12 Task 4, spec §3.3 Objective and "Reusing machines we have"): whole new
// machines weighed against the raw material they save over the horizon, the tier that is cheaper to build, sharing pools
// of new and owned machines on a network, owned machines of another tier beside new ones, steps bounded by owned machines
// that cannot be built, Make N against the batch, the step charge against the raw material with gathered blocks dug and
// paid per new machine block, the cleanroom, the cheapest of plan 09's plan, the relaxation and S1 rounded up when the
// time guard stops the MIP, and with build cost ignored plan 09's stages
// within the owned-only bounds, their machines sized by plan 09's pick (ruling P2); the raw cap against the leanest line
// and the step charge measured on that line (fix wave 3 (A), (B2)), an owned block's share of the step charge (ledger
// 265), and on an AE2 line no start from S1 rounded up where it makes an item good two ways (add-on 12 x 17 F6).

import { describe, it, expect, vi } from 'vitest';

// The AE2 start case reads the inputs `solveLine` hands the build MIP; every call runs the real `buildMip`.
vi.mock('../../../src/server/planner/build-mip.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/build-mip.ts')>();
  return { ...mod, buildMip: vi.fn(mod.buildMip) };
});

import {
  cleanSpec, fastSlowSpec, freeSpec, hammerSpec, handSpec, opt, pressSpec, solderSpec, solvedWithBuild, twinSpec, twoFreeSpec, twoPressSpec,
  woodSpec,
} from '../../helpers/build-fixtures.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import {
  BUILD_MIP_MAX_LP_ITERATIONS, BUILD_MIP_MAX_NODES, BUILD_MIP_RETRY_TOLERANCE, BUILD_MIP_TIME_LIMIT_SECONDS, LEAN_BASE_ABOVE, OWNED_STEP_SHARE, buildMip,
  type BuildMipInput, type StepMachines,
} from '../../../src/server/planner/build-mip.ts';
import type { MachineOption } from '../../../src/server/planner/machine-options.ts';
import { BY_HAND_FLOOR_CHARGE, type Solution, type SolveOptions } from '../../../src/server/planner/solve.ts';

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

/**
 * An item good made two ways from one raw material (add-on 12 x 17 F6): `g-plain` (1 a → 1 g) on a Basic Bending Machine
 * (101), `g-twin` (6 a → 5 g + 5 h) on a Basic Forge Hammer (481) and `p-make` (2 g + 1 h → 1 p) on a Basic Assembler
 * (121), all LV; nothing but the twin makes h.
 */
function twinMakerSpec(): Parameters<typeof solvedWithBuild>[0] {
  const BENDER = 'gt.recipe.metalbender';
  const HAMMER = 'gt.recipe.hammer';
  const ASSEMBLER = 'gt.recipe.assembler';
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }, { id: HAMMER, name: 'Forge Hammer' }, { id: ASSEMBLER, name: 'Assembler' }],
    machines: [
      { mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] },
      { mteId: 481, name: 'Basic Forge Hammer', tier: 1, maps: [HAMMER] },
      { mteId: 121, name: 'Basic Assembler', tier: 1, maps: [ASSEMBLER] },
    ],
    recipes: [
      { id: 'g-plain', map: BENDER, in: [['t:a@0', 1]], out: [['t:g@0', 1]], eut: 24, dur: 100 },
      { id: 'g-twin', map: HAMMER, in: [['t:a@0', 6]], out: [['t:g@0', 5], ['t:h@0', 5]], eut: 16, dur: 40 },
      { id: 'p-make', map: ASSEMBLER, in: [['t:g@0', 2], ['t:h@0', 1]], out: [['t:p@0', 1]], eut: 16, dur: 100 },
    ],
  };
}
const TWIN_MAKERS = { 'g-plain': [opt(101, 1, 0.2, 17)], 'g-twin': [opt(481, 1, 0.5, 17)], 'p-make': [opt(121, 1, 0.2, 16)] };

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

  it('pays the step charge once per new machine block, an owned block OWNED_STEP_SHARE of it', async () => {
    // Fix wave 2 (a): σ = 100 raw (1 raw a run at 0.5 runs a second over 200 s, or 0.4 over 250 s), so a charge of 0.06
    // is 6 raw a new machine and one of 0.04 is 4. The work of 2.5 Basic presses (3 × 10) or one Advanced (40): 3 × 16 =
    // 48 > 46 at 6, 3 × 14 = 42 < 44 at 4. Two LV presses (2 × 10) or one MV that does both (25): 2 × 16 = 32 > 31 at 6,
    // 28 < 29 at 4 (with no charge two LV presses always build for less, and the MIP gives the MV no columns).
    const built = (sol: Solution): [number, number] => {
      const m = sol.machines?.get('press') as StepMachines;
      return [m.option.mteId, m.pool === undefined ? m.added : (sol.pools?.get(m.pool)?.added ?? 0)];
    };
    const press = async (options: MachineOption[], runs: number, horizonSeconds: number, stepCharge: number, share: boolean): Promise<Solution> =>
      (await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', runs]], { options: { press: options }, horizonSeconds, share }, { stepCharge })).sol;
    for (const share of [false, true]) {
      const advanced = [opt(101, 1, 0.2, 10), opt(102, 2, 0.5, 40)];
      expect(built(await press(advanced, 0.5, 200, 0.06, share)), `share ${share}`).toEqual([102, 1]);
      expect(built(await press(advanced, 0.5, 200, 0.04, share)), `share ${share}`).toEqual([101, 3]);
      const doubled = [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 25)];
      expect(built(await press(doubled, 0.4, 250, 0.06, share)), `share ${share}`).toEqual([102, 1]);
      expect(built(await press(doubled, 0.4, 250, 0.04, share)), `share ${share}`).toEqual([101, 2]);
      // Three owned Basic presses cost no build and OWNED_STEP_SHARE of the charge each (ledger 265; with sharing their pool
      // holds three whole ones): 3 × 3 = 9 < one new Advanced 46, or two of them beside a new Basic 6 + 16 = 22.
      const owned = await press([opt(101, 1, 0.2, 10, 3), opt(102, 2, 0.5, 40)], 0.5, 200, 0.06, share);
      expect(owned.machines?.get('press')).toMatchObject({ option: { mteId: 101 }, added: 0, newLoad: 0, ownedLoad: share ? 2.5 : 3 });
    }
    // Make N pays it once per type it adds: 100 fast runs take 100 raw, 50 to build and the charge on σ = 100 against the
    // owned slow press's 200 raw: 190 < 200 at 0.4, 210 > 200 at 0.6.
    const batch = { options: { fast: [opt(301, 1, 0.2, 50)], slow: [opt(302, 1, 0.2, 30, 1)] }, mode: 'makeN' as const, horizonSeconds: null };
    expect((await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 100]], batch, { stepCharge: 0.4 })).runs).toEqual(['fast']);
    expect((await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 100]], batch, { stepCharge: 0.6 })).runs).toEqual(['slow']);
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
    // σ = 1,440 (1 raw a glass with sand dug, 24 h at 1/min), a new machine block's charge 28.8 (a hand step 3 of them):
    // one shared hammer 17 + 16 + 2 × 28.8 = 90.6 < a hammer per step 50 + 3 × 28.8 = 136.4 < gravel by hand 33 + 28.8 × 5
    // = 177 < digging the sand 1,440 + 16 + 28.8.
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
    // 0.6 glass a second: 1.2 machines of each hammer step and 1.2 of the furnace; digging would cost 51,840 raw a day, and
    // each new machine block 1,036.8 (2 % of it): 3 shared hammers 3 × 1,053.8 < gravel by hand 3 × 1,036.8 + 2 × 1,053.8.
    const demand: Array<[StuffKey, number]> = [['t:glass@0', 0.6]];
    const shared = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED, share: true }, CHARGED);
    const pools = new Map([...(shared.sol.pools?.values() ?? [])].map((p) => [p.option.mteId, p.added]));
    expect(pools).toEqual(new Map([[481, 3], [151, 2]]));
    const direct = await solvedWithBuild(hammerSpec(), GLASS, demand, { options: HAMMERS, alsoMade: GATHERED }, CHARGED);
    for (const id of ['h-gravel', 'h-sand']) expect(direct.sol.machines?.get(id)).toMatchObject({ added: 2 });
  });

  it('charges steps against the raw material with gathered blocks dug', async () => {
    // 1 glass an hour: σ = 24, a new machine block 0.48, a hand step 1.44. Shared: one hammer 33 + 2 × 0.48 = 33.96 < gravel
    // by hand 33 + 0.48 × 2 + 1.44 = 35.4 < digging 24 + 16 + 0.48 = 40.48; per step: 35.4 < 40.48 < a hammer per step
    // 50 + 1.44. Over one hour (σ = 1): digging 1 + 16 + 0.02 = 17.02 < 33.04. Measured against S1 (0 here) the shared
    // hammer and the hand step would tie at 33.
    const demand: Array<[StuffKey, number]> = [['t:glass@0', 1 / 3600]];
    const build = { options: HAMMERS, alsoMade: GATHERED };
    expect((await solvedWithBuild(hammerSpec(), GLASS, demand, { ...build, share: true }, CHARGED)).runs).toEqual(['h-gravel', 'h-sand', 'smelt']);
    expect((await solvedWithBuild(hammerSpec(), GLASS, demand, build, CHARGED)).runs).toEqual(['h-sand', 'hand-gravel', 'smelt']);
    for (const share of [true, false]) {
      const hour = await solvedWithBuild(hammerSpec(), GLASS, demand, { ...build, share, horizonSeconds: 3600 }, CHARGED);
      expect(hour.runs).toEqual(['smelt']);
    }
  });

  it('charges a machine block at least the charge on one raw unit on a line that needs no raw material', async () => {
    // S1 = S1g = 0, so σ = 1 (the floor) and a new machine block costs 0.02 raw beside its build. Two free routes on
    // benders that build for nothing: a second route's bender is a second block, 0.04 > 0.02, so one route runs (charged
    // stepCharge × S1g × F, here 0, both blocks would cost nothing). On a network both share one bender: one block either
    // way, whichever routes run on it.
    const free = { 'p-a': [opt(101, 1, 0.2, 0)], 'p-b': [opt(101, 1, 0.2, 0)] };
    const direct = await solvedWithBuild(twoFreeSpec(), { 't:a@0': 0, 't:b@0': 0 }, [['t:t@0', 0.1]], { options: free }, { stepCharge: 0.02 });
    expect(direct.runs).toHaveLength(1);
    expect(direct.sol.machines?.get(direct.runs[0] as string)).toMatchObject({ option: { mteId: 101 }, added: 1 });
    const priced = { 'p-a': [opt(101, 1, 0.2, 10)], 'p-b': [opt(101, 1, 0.2, 10)] };
    const shared = await solvedWithBuild(twoFreeSpec(), { 't:a@0': 0, 't:b@0': 0 }, [['t:t@0', 0.1]], { options: priced, share: true }, { stepCharge: 0.02 });
    expect([...(shared.sol.pools?.values() ?? [])]).toMatchObject([{ option: { mteId: 101 }, added: 1 }]);
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

  it('starts best multi-output from cheapest\'s decision on AE2 where S1 rounded up makes an item good two ways (12 x 17 F6)', async () => {
    // 1 p a minute, a at 1: S1 makes g both ways (2.2 a for each p: the twin for the h, g-plain for the second g), and
    // with the one-maker rows the MIP makes it on the twin alone (2.4 a), cheapest's decision. S1 rounded up still costs
    // the multi-output MIP less (1 + 50 / 3,168 against 2.4 / 2.2 + 33 / 3,168 in σ, beside one source each), but it
    // breaks those rows, so, like a rounding that leaves a step short, it is no plan: the MIP starts from cheapest's
    // decision and is never worse than it (add-on 17's S10). A direct line keeps S1 rounded up as its start.
    const spy = vi.mocked(buildMip);
    const solved = async (share: boolean): Promise<{ runs: string[]; inputs: BuildMipInput[] }> => {
      spy.mockClear();
      const { runs } = await solvedWithBuild(twinMakerSpec(), { 't:a@0': 1 }, [['t:p@0', 1 / 60]], { options: TWIN_MAKERS, share }, { multiOutput: true });
      return { runs, inputs: spy.mock.calls.map(([input]) => input) };
    };
    const ae2 = await solved(true);
    expect(ae2.runs).toEqual(['g-twin', 'p-make']);
    // first the MIP as cheapest solves it, then the multi-output one from its solution
    const [pre, multi] = ae2.inputs as [BuildMipInput, BuildMipInput];
    expect(pre.sources).toBeUndefined();
    const given = multi.start as readonly number[];
    const ran = (x: readonly number[]): string[] => pre.lp.recipes.flatMap((r, j) => ((x[j] ?? 0) > 1e-9 ? [r.id] : []));
    expect(ran(pre.x1)).toEqual(['g-plain', 'g-twin', 'p-make']);
    expect(ran(given)).toEqual(['g-twin', 'p-make']);
    // the start is cheapest's decision with its source binary (a bought: 1), though S1 rounded up costs less
    const mip = buildMip(multi);
    expect(mip.start).toEqual([...given, 1]);
    expect(mip.startAt(pre.x1)?.cost).toBeLessThan(mip.startCost);
    expect(buildMip(pre).start).toBeUndefined();
    const direct = await solved(false);
    expect(direct.runs).toEqual(['g-plain', 'g-twin', 'p-make']);
    expect(buildMip(direct.inputs[0] as BuildMipInput).start).toBeDefined();
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
    // A hand step pays HAND_STEP_WEIGHT charges, a machine one per new block. F = 1,440: machine 1 + 0.02 + 10 / 1,440 =
    // 1.027 < hand 1 + 0.06; F = 24: machine 1.02 + 10 / 24 = 1.437 > 1.06.
    const build = { options: { 'p-machine': [opt(101, 1, 0.2, 10)] } };
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 60]], build, CHARGED)).runs).toEqual(['p-machine']);
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 3600]], build, CHARGED)).runs).toEqual(['p-hand']);
  });

  it('charges a crafting step at least the floor where crafting is automated and the step charge is 0 (U2)', async () => {
    // σ = 1,440 at 1 a minute: the machine's 10 / 1,440 = 0.007 against BY_HAND_FLOOR_CHARGE × 3 = 0.06 by hand; without
    // the floor the hand step cost nothing. At 1 an hour (σ = 24) the machine's 0.42 is more: the floor is a charge, not a ban.
    const build = { options: { 'p-machine': [opt(101, 1, 0.2, 10)] } };
    const floor = { stepCharge: 0, handWeight: 3, byHandFloor: BY_HAND_FLOOR_CHARGE };
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 60]], build, { stepCharge: 0, handWeight: 3 })).runs).toEqual(['p-hand']);
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 60]], build, floor)).runs).toEqual(['p-machine']);
    expect((await solvedWithBuild(handSpec(), COSTS, [['t:t@0', 1 / 3600]], build, floor)).runs).toEqual(['p-hand']);
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

  it('stops at its node and simplex-iteration limits, without strong branching, and keeps a far time guard', async () => {
    // Controller ruling 183 (2): no plan depends on time or load. Fix wave 3 (F), ledger 248: 50 nodes without strong
    // branching (whose iterations escape the iteration cap), and a root whose LP relaxation fails at 1e-10 runs again at 1e-9.
    expect(BUILD_MIP_MAX_NODES).toBe(50);
    expect(BUILD_MIP_MAX_LP_ITERATIONS).toBe(50_000);
    expect(BUILD_MIP_RETRY_TOLERANCE).toBe(1e-9);
    expect(BUILD_MIP_TIME_LIMIT_SECONDS).toBe(30);
    const { sol } = await solvedWithBuild(hammerSpec(), GLASS, [['t:glass@0', 1 / 60]], { options: HAMMERS, share: true, alsoMade: GATHERED }, CHARGED);
    const stats = sol.buildStats;
    expect(stats?.approx).toBe(false);
    expect(stats?.nodes).toBeLessThanOrEqual(BUILD_MIP_MAX_NODES);
    expect(stats?.retried).toBeUndefined();
    expect(stats?.status === 'optimal' || (stats?.status === 'feasible' && stats.stop === 'limit')).toBe(true);
    // Its objective and HiGHS's proven bound say how close to the optimum the node limit left it (here: at it).
    expect(stats?.objective).toBeGreaterThan(0);
    expect(stats?.bound).toBeLessThanOrEqual((stats?.objective as number) * (1 + 1e-9));
  });

  it('stops at its simplex-iteration limit with its best whole solution, deterministically', async () => {
    // A bound of 1 stops the MIP at its first checkpoint: the start (S1 rounded up, or the sparse plan), a plan all the
    // same, never the time guard's fallback; twice the same.
    const solve = async (): Promise<Solution> => (await solvedWithBuild(
      hammerSpec(), GLASS, [['t:glass@0', 0.6]], { options: HAMMERS, share: true, alsoMade: GATHERED }, { ...CHARGED, buildMaxIterations: 1 },
    )).sol;
    const first = await solve();
    expect(first.status).toBe('ok');
    expect(first.buildStats).toMatchObject({ approx: false });
    expect(first.buildStats?.status === 'optimal' || first.buildStats?.stop === 'limit').toBe(true);
    const again = await solve();
    expect([...again.runs]).toEqual([...first.runs]);
    expect([...(again.machines ?? [])].map(([id, m]) => [id, m.option.mteId, m.added])).toEqual([...(first.machines ?? [])].map(([id, m]) => [id, m.option.mteId, m.added]));
  });

  it('says build-cost-approx when the search stopped at the root on its start and the search without it found nothing (12 x 17 F4)', async () => {
    // Bounds of 0 nodes and 1 simplex iteration end the start's solve at the root (nodes 0) and the bare one before any
    // whole solution: the plan is its start's, rounded up from an estimate, not the fallback's (`approx` false). On the
    // solder line, as the glass line's MIP above ends optimal at the root under these bounds too and never stalls.
    const { sol } = await solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER }, { buildMaxIterations: 1, buildMaxNodes: 0 });
    expect(sol.status).toBe('ok');
    expect(sol.buildStats?.bare).toBe('stalled');
    expect(sol.buildStats?.approx).toBe(false);
    expect(sol.warnings.map((w) => w.code)).toContain('build-cost-approx');
  });

  it('plans the same machines whatever the time guard, which never decides a plan', async () => {
    // The node limit decides: a guard of 5 s, the default 30 s or 10 minutes gives the same runs, machines, pools and
    // stats, on a line of one step per machine and on a network's sharing pools.
    const decided = (sol: Solution): unknown => ({
      runs: [...sol.runs], buys: [...sol.buys],
      machines: [...(sol.machines ?? [])].map(([id, m]) => [id, m.option.mteId, m.option.tier, m.added, m.newLoad, m.ownedLoad]),
      pools: [...(sol.pools ?? [])].map(([key, p]) => [key, p.added, p.steps]),
      stats: { nodes: sol.buildStats?.nodes, status: sol.buildStats?.status, stop: sol.buildStats?.stop, approx: sol.buildStats?.approx },
    });
    const solder = async (opts: SolveOptions): Promise<Solution> =>
      (await solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], { options: SOLDER, horizonSeconds: 604800 }, opts)).sol;
    const hammers = async (opts: SolveOptions): Promise<Solution> =>
      (await solvedWithBuild(hammerSpec(), GLASS, [['t:glass@0', 0.6]], { options: HAMMERS, share: true, alsoMade: GATHERED }, { ...CHARGED, ...opts })).sol;
    for (const line of [solder, hammers]) {
      const base = decided(await line({}));
      expect((base as { stats: { approx: boolean } }).stats.approx).toBe(false);
      for (const buildTimeLimit of [5, 600]) expect(decided(await line({ buildTimeLimit }))).toEqual(base);
    }
  });

  it('sizes a step its MIP prices from its builds alone by the machines its runs need', async () => {
    // Fast's machine costs a million, so slow runs although S1 gives it no runs: the MIP prices its machines from their
    // builds alone (a first one at 10, then 40 a run a second), and its decision builds what 1 run a second needs of the
    // option that does it for least: 3 MV presses for 48, not 5 LV ones for 50.
    const options = { fast: [opt(301, 1, 0.2, 1e6)], slow: [opt(302, 1, 0.2, 10), opt(304, 2, 0.4, 16)] };
    const { runs, sol } = await solvedWithBuild(fastSlowSpec(), COSTS, [['t:t@0', 1]], { options });
    expect(runs).toEqual(['slow']);
    expect(sol.machines?.get('slow')).toMatchObject({ option: { mteId: 304 }, added: 3, ownedLoad: 0 });
    expect(sol.runs.get('slow') as number).toBeLessThanOrEqual(3 * 0.4 + 1e-9);
    // The model priced those machines at max(10, 40 × 1) = 40 and proved that optimal; the objective it reports is the
    // decision's, with the 48 its machines cost (σ = 1 raw a second over 24 h).
    expect(sol.buildStats).toMatchObject({ status: 'optimal', approx: false });
    const { objective, bound } = sol.buildStats as { objective: number; bound: number };
    expect(objective - bound).toBeCloseTo(8 / 86400, 12);
  });

  it('prices a step\'s first machine at what its S1 runs need', async () => {
    // pa runs on an LV press (0.2 runs a second, 10 to build) or an MV one (0.4, 16): at 0.3 runs a second one MV press, 16.
    // pb runs on a mill (1 run a second, 14.5), its input a hair dearer, so S1 runs pa. Priced from its least build, pa
    // read max(10, 40 × 0.3) = 12 and won; its first machine now costs what S1's 0.3 runs a second need, 16.
    const BENDER = 'gt.recipe.metalbender';
    const WIREMILL = 'gt.recipe.wiremill';
    const spec = {
      maps: [{ id: BENDER, name: 'Bending Machine' }, { id: WIREMILL, name: 'Wiremill' }],
      machines: [{ mteId: 401, name: 'LV Press', tier: 1, maps: [BENDER] }, { mteId: 402, name: 'MV Press', tier: 2, maps: [BENDER] },
        { mteId: 403, name: 'Mill', tier: 1, maps: [WIREMILL] }],
      recipes: [
        { id: 'pa', map: BENDER, in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 16, dur: 100 },
        { id: 'pb', map: WIREMILL, in: [['t:b@0', 1]], out: [['t:t@0', 1]], eut: 16, dur: 100 },
      ],
    } satisfies Parameters<typeof solvedWithBuild>[0];
    const options = { pa: [opt(401, 1, 0.2, 10), opt(402, 2, 0.4, 16)], pb: [opt(403, 1, 1, 14.5)] };
    const { runs, sol } = await solvedWithBuild(spec, { 't:a@0': 1, 't:b@0': 1.000001 }, [['t:t@0', 0.3]], { options });
    expect(runs).toEqual(['pb']);
    expect(sol.machines?.get('pb')).toMatchObject({ option: { mteId: 403 }, added: 1 });
  });

  it('falls back to the relaxation rounded up when the time guard stops the MIP', async () => {
    // The relaxation runs on MV at 16 / 0.4 = 40 per run a second against LV's 10 / 0.2 = 50; 2.5 rounded up.
    const { sol } = await solvedWithBuild(pressSpec(), COSTS, [['t:t@0', 1]], { options: { press: [opt(101, 1, 0.2, 10), opt(102, 2, 0.4, 16)] } }, { buildTimeLimit: 0 });
    expect(sol.warnings).toContainEqual(expect.objectContaining({ code: 'build-cost-approx' }));
    expect(sol.buildStats).toMatchObject({ status: 'skipped', approx: true });
    expect(sol.machines?.get('press')).toMatchObject({ option: { mteId: 102 }, added: 3 });
  });

  it('falls back to plan 09\'s plan rounded up where that costs the build MIP less than the relaxation rounded up', async () => {
    // Fix wave 2 (b): `final` (g → t, LV bender) must run; g is bought at 1.2 or made by `make-g` from a at 1 on an LV
    // wiremill (`alsoMade`: the line may make what it can buy). At 0.02 t a second each step needs 0.1 of a machine; σ =
    // 1.2 × 0.02 × 86,400 = 2,073.6 raw (g bought) and a new machine block costs 0.5 + 10 / 2,073.6 = 0.5048 of it, raw
    // 0.8333 a unit made and 1 bought. The relaxation charges make-g a tenth of its block (0.8333 + 0.5048 + 0.0505 =
    // 1.389 < buying g 1 + 0.5048 = 1.505), so its rounding builds it a machine: 0.8333 + 2 × 0.5048 = 1.843, as does S1's.
    // Plan 09's charged stage (0.5 a step, within +25 %) buys g: 1.505, which the MIP plans too.
    const spec: Parameters<typeof solvedWithBuild>[0] = {
      maps: [{ id: 'gt.recipe.metalbender', name: 'Bending Machine' }, { id: 'gt.recipe.wiremill', name: 'Wiremill' }],
      machines: [{ mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: ['gt.recipe.metalbender'] },
        { mteId: 111, name: 'Basic Wiremill', tier: 1, maps: ['gt.recipe.wiremill'] }],
      recipes: [
        { id: 'final', map: 'gt.recipe.metalbender', in: [['t:g@0', 1]], out: [['t:t@0', 1]], eut: 24, dur: 100 },
        { id: 'make-g', map: 'gt.recipe.wiremill', in: [['t:a@0', 1]], out: [['t:g@0', 1]], eut: 24, dur: 100 },
      ],
    };
    const build = { options: { final: [opt(101, 1, 0.2, 10)], 'make-g': [opt(111, 1, 0.2, 10)] }, alsoMade: ['t:g@0'] };
    const line = (opts: SolveOptions) => solvedWithBuild(spec, { 't:a@0': 1, 't:g@0': 1.2 }, [['t:t@0', 0.02]], build, { stepCharge: 0.5, ...opts });
    const guarded = await line({ buildTimeLimit: 0 });
    expect(guarded.sol.buildStats).toMatchObject({ status: 'skipped', approx: true });
    expect(guarded.sol.warnings).toContainEqual(expect.objectContaining({ code: 'build-cost-approx' }));
    expect(guarded.runs).toEqual(['final']);
    expect(guarded.sol.machines?.get('final')).toMatchObject({ option: { mteId: 101 }, added: 1 });
    expect([...guarded.sol.buys.keys()]).toEqual(['t:g@0']);
    expect((await line({})).runs).toEqual(['final']);
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

  it('runs the same twin of a recipe whatever the step charge, the horizon, sharing or mode', async () => {
    // The plan 12 fix wave 2 review: Molten Tin from Tin Dust (`x-dust`) or a Tin Ingot (`x-ingot`), 1 raw each on one
    // extractor, which the solver took by its numerics (Make N the ingot's); the plan runs the twin of the lower id
    // (`twinMoves` rule d: the line makes and otherwise buys neither, and no form ranks are given here), with the machines
    // decided for whichever twin the solver ran.
    const costs: Record<StuffKey, number> = { 't:part@0': 1, 't:tin_dust@0': 1, 't:tin_ingot@0': 1 };
    const options = { 'x-dust': [opt(131, 1, 0.5, 12)], 'x-ingot': [opt(131, 1, 0.5, 12)], 'board-tin': [opt(121, 1, 0.2, 16)] };
    for (const stepCharge of [0, 0.02, 0.5]) {
      for (const horizonSeconds of [3600, 86400, null]) {
        for (const share of [false, true]) {
          const { runs, sol } = await solvedWithBuild(twinSpec(), costs, [['t:board@0', 0.1]], { options, horizonSeconds, share }, { stepCharge });
          const what = `charge ${stepCharge}, horizon ${horizonSeconds}, share ${share}`;
          expect(runs, what).toEqual(['board-tin', 'x-dust']);
          expect([...sol.buys.keys()], what).toEqual(['t:part@0', 't:tin_dust@0']);
          expect([...(sol.machines?.keys() ?? [])], what).toEqual(['board-tin', 'x-dust']);
          expect(sol.machines?.get('x-dust'), what).toMatchObject({ option: { mteId: 131 } });
          expect([...(sol.pools?.values() ?? [])].flatMap((p) => p.steps).sort(), what).toEqual(share ? ['board-tin', 'x-dust'] : []);
        }
      }
      const batch = await solvedWithBuild(twinSpec(), costs, [['t:board@0', 10]], { options, mode: 'makeN', horizonSeconds: null }, { stepCharge });
      expect(batch.runs, `Make N, charge ${stepCharge}`).toEqual(['board-tin', 'x-dust']);
    }
    // On other machines they are no twins: the extractor that builds for less runs, whatever its id (12 < 40).
    const dearer = { ...options, 'x-dust': [opt(132, 1, 0.5, 40)] };
    expect((await solvedWithBuild(twinSpec(), costs, [['t:board@0', 0.1]], { options: dearer })).runs).toEqual(['board-tin', 'x-ingot']);
  });
});

describe('the raw cap and the leanest line (fix wave 3 (A), (B2))', () => {
  // The leanest line is the build MIP's plan at step charge 0 (what "Least raw material" plans): the least raw material
  // over the horizon plus the build of its machines. The cap holds the plan's raw material within (1 + rawCap) × that
  // line's, and the step charge is measured against that line's raw material where it is more than LEAN_BASE_ABOVE × σ
  // (S1g's over the horizon).
  const WEEK = { options: SOLDER, horizonSeconds: 604800 };
  const TIN = ['board-tin', 'x-tin'];
  const SOLDERED = ['alloy-solder', 'board-solder', 'x-solder'];
  const week = (opts: SolveOptions) => solvedWithBuild(solderSpec(), COSTS, [['t:board@0', 1 / 3600]], WEEK, { stepCharge: 0.5, ...opts });

  it('caps the raw material at (1 + rawCap) × the leanest line\'s, where Fewest machines would trade more', async () => {
    // A board an hour for a week: soldering alloy is the leanest line (252 raw + 48 to build = 300 < tin's 336 + 28 =
    // 364), and at Fewest machines (0.5 × 252 = 126 a new block) tin's two blocks win (616 < 678) at 4/3 its raw.
    for (const rawCap of [undefined, null, 0.34]) expect((await week({ rawCap })).runs, `cap ${rawCap}`).toEqual(TIN);
    for (const rawCap of [0.33, 0.25, 0]) {
      const capped = await week({ rawCap });
      expect(capped.runs, `cap ${rawCap}`).toEqual(SOLDERED);
      expect(capped.sol.leanRawCost).toBe(0.000416666667);   // 1.5 raw a board, an hour
      expect(capped.sol.rawCost).toBeLessThanOrEqual((capped.sol.leanRawCost as number) * (1 + rawCap) * (1 + 1e-6));
    }
  });

  it('measures the cap against the leanest line, not the least raw material: the poly line keeps its log', async () => {
    // A tank an hour: the long way takes 0.01 raw a tank but three machines of 100 (300 to build); the log takes 1 raw a
    // tank on one machine of 10, 24 + 10 = 34 over the day against 300.24, so it is the leanest line. At 0.5 and the
    // default +25 % the line keeps it, 100 × S1: a cap on S1 (0.24 × 1.25 = 0.3 a day) would force the long way.
    const options = { 'w-tank': [opt(121, 1, 0.2, 10)], 's-grit': [opt(481, 1, 0.2, 100)], 's-paste': [opt(351, 1, 0.2, 100)], 's-tank': [opt(101, 1, 0.2, 100)] };
    for (const stepCharge of [0, 0.5]) {
      const { runs, sol } = await solvedWithBuild(woodSpec(), { 't:log@0': 1, 't:ore@0': 1 }, [['t:tank@0', 1 / 3600]], { options }, { stepCharge, rawCap: 0.25 });
      expect(runs, `charge ${stepCharge}`).toEqual(['w-tank']);
      expect(sol.leastRawCost).toBe(0.00000277777778);   // S1: 0.01 raw a tank
      expect(sol.leanRawCost).toBe(0.000277777778);       // the log line's 1 raw a tank
      expect(sol.rawCost).toBe(0.000277777778);
    }
  });

  it('keeps the project\'s charge on a hand step in the leanest line, so the cap never forces one (F3b)', async () => {
    // p-hand crafts t from c (0.7) by hand, p-machine bends it from a (1) on a machine of 10, 1 a minute: σ = 0.7 a minute
    // over the day (1,008). At step charge 0 a hand step cost nothing, so the leanest line crafted by hand at 0.7 and the
    // +25 % cap (0.875) forced the hand step on the plan. With the project's 0.5 × 3 on it the leanest line bends (1.43 +
    // 0.01 against 1 + 1.5 in σ): the cap is 1.25 and the plan bends too.
    const build = { options: { 'p-machine': [opt(101, 1, 0.2, 10)] } };
    const { runs, sol } = await solvedWithBuild(freeSpec(), { 't:a@0': 1, 't:c@0': 0.7 }, [['t:t@0', 1 / 60]], build, { stepCharge: 0.5, handWeight: 3, rawCap: 0.25 });
    expect(runs).toEqual(['p-machine']);
    expect(sol.leanRawCost).toBe(0.0166666667);
  });

  it('weighs Fewest machines against the leanest line\'s raw material where S1\'s needs machines nobody would build (T2)', async () => {
    // The log line on three slow assemblers (2 each, 6) or one fast one (7.5): at step charge 0 the slow ones, 1.5 less
    // to build. σ = max(S1g × 24 h, 1) = 1 raw (0.24 a day the long way). With Rubber Log at 1 the leanest line takes 24
    // raw a day, more than LEAN_BASE_ABOVE × σ: Fewest machines charges 0.5 × 24 = 12 a block and one fast assembler wins
    // (19.5 < 42; before fix wave 3 (B2) it charged 0.5 and kept the three, 7.5 < 8). With Rubber Log at 0.075 (1.8 a
    // day, within twice σ) the charge stays 0.5 and the three stay (7.5 < 8), where 1.8 as the base would charge 0.9 and
    // take the fast one (8.4 < 8.7).
    const options = {
      'w-tank': [opt(121, 1, 1 / 10800, 2), opt(122, 1, 1 / 3600, 7.5)],
      's-grit': [opt(481, 1, 0.2, 100)], 's-paste': [opt(351, 1, 0.2, 100)], 's-tank': [opt(101, 1, 0.2, 100)],
    };
    const tanks = (log: number, stepCharge: number) => solvedWithBuild(woodSpec(), { 't:log@0': log, 't:ore@0': 1 }, [['t:tank@0', 1 / 3600]], { options }, { stepCharge });
    for (const [log, mteId, added, lean] of [[1, 122, 1, 0.000277777778], [0.075, 121, 3, 0.0000208333333]] as const) {
      const least = await tanks(log, 0);
      expect(least.runs).toEqual(['w-tank']);
      expect(least.sol.machines?.get('w-tank'), `Rubber Log at ${log}, step charge 0`).toMatchObject({ option: { mteId: 121 }, added: 3 });
      const fewest = await tanks(log, 0.5);
      expect(fewest.runs).toEqual(['w-tank']);
      expect(fewest.sol.machines?.get('w-tank'), `Rubber Log at ${log}`).toMatchObject({ option: { mteId }, added });
      expect(fewest.sol.leanRawCost).toBe(lean);
    }
  });

  it('measures the cap against the least raw material when the leanest line has no plan (the fallback)', async () => {
    // With the MIP skipped (`buildTimeLimit` 0) neither MIP runs: the cap falls back to S1 (1.875 raw a board at +25 %),
    // which only the soldering alloy meets, and the plan says it was rounded up from an estimate.
    const { runs, sol } = await week({ rawCap: 0.25, buildTimeLimit: 0 });
    expect(runs).toEqual(SOLDERED);
    expect(sol.buildStats?.approx).toBe(true);
    expect(sol.leanRawCost).toBe(sol.leastRawCost);
  });

  it('solves no leanest line at "No limit" where its start costs at most LEAN_BASE_ABOVE (controller OQ1 (D))', async () => {
    // The solder week's charge-0 start (S1 rounded up) costs (252 + 48) / 252 = 1.19 σ, so its leanest line could not
    // re-base the charge and, with no cap, nothing else reads it: none is solved, the plan reports none, and its runs are
    // those it had before the cap.
    expect(LEAN_BASE_ABOVE).toBe(2);
    for (const rawCap of [undefined, null]) {
      const { runs, sol } = await week({ rawCap });
      expect(runs, `cap ${rawCap}`).toEqual(TIN);
      expect(sol.leanRawCost, `cap ${rawCap}`).toBeUndefined();
    }
    // Poly in small at "No limit": its charge-0 start runs the long way on three machines of 100 (300.24 σ), so its
    // leanest line is solved, re-bases the charge and is reported.
    const options = { 'w-tank': [opt(121, 1, 0.2, 10)], 's-grit': [opt(481, 1, 0.2, 100)], 's-paste': [opt(351, 1, 0.2, 100)], 's-tank': [opt(101, 1, 0.2, 100)] };
    const wood = await solvedWithBuild(woodSpec(), { 't:log@0': 1, 't:ore@0': 1 }, [['t:tank@0', 1 / 3600]], { options }, { stepCharge: 0.5 });
    expect(wood.runs).toEqual(['w-tank']);
    expect(wood.sol.leanRawCost).toBe(0.000277777778);
  });
});

describe('the owned-step charge (ledger 265, controller OQ24)', () => {
  // A step on a machine the group owns still counts toward Fewest machines: it costs no build, but each owned machine it
  // runs on pays OWNED_STEP_SHARE of a new machine block's step charge, whole machines per step and option (per sharing
  // pool on a network). A tank a minute (F = 1,440 a day): Raw Ore's three steps, one owned machine each (0.01 raw a
  // tank, S1 = σ = 14.4 raw a day), or Rubber Log's one step on a new assembler that builds for nothing.
  const LONG = ['s-grit', 's-paste', 's-tank'];
  const options = {
    'w-tank': [opt(121, 1, 0.2, 0)], 's-grit': [opt(481, 1, 0.2, 100, 1)], 's-paste': [opt(351, 1, 0.2, 100, 1)], 's-tank': [opt(101, 1, 0.2, 100, 1)],
  };
  const tanks = (log: number, stepCharge: number) =>
    solvedWithBuild(woodSpec(), { 't:log@0': log, 't:ore@0': 1 }, [['t:tank@0', 1 / 60]], { options }, { stepCharge });

  it('weighs a step on an owned machine at OWNED_STEP_SHARE of a new machine block, its build still 0', async () => {
    expect(OWNED_STEP_SHARE).toBe(0.5);
    // Rubber Log at 0.011 (15.84 raw a day). At Fewest machines a new block weighs 0.5 × 14.4 = 7.2 raw and an owned one
    // 3.6: the three owned steps 14.4 + 3 × 3.6 = 25.2 > the log's 15.84 + 7.2 = 23.04 (with owned machines free, fix wave
    // 2 (a), they cost 14.4 and kept the line on three steps).
    const fewest = await tanks(0.011, 0.5);
    expect(fewest.runs).toEqual(['w-tank']);
    expect(fewest.sol.machines?.get('w-tank')).toMatchObject({ option: { mteId: 121 }, added: 1 });
    // At step charge 0 no block pays a charge: the least raw material on the three owned machines, none of them built.
    const least = await tanks(0.011, 0);
    expect(least.runs).toEqual(LONG);
    for (const id of LONG) expect(least.sol.machines?.get(id), id).toMatchObject({ added: 0, newLoad: 0, ownedLoad: 1 });
    // Rubber Log at 0.02 (28.8 + 7.2 = 36 > 25.2): the owned steps win at Fewest machines too, nothing built, and the
    // build MIP's objective counts their three owned blocks (in σ: 1 + 3 × 3.6 / 14.4).
    const dearer = await tanks(0.02, 0.5);
    expect(dearer.runs).toEqual(LONG);
    for (const id of LONG) expect(dearer.sol.machines?.get(id), id).toMatchObject({ added: 0, newLoad: 0, ownedLoad: 1 });
    expect(dearer.sol.buildStats?.objective).toBeCloseTo(1.75, 4);
  });

  it('charges an owned machine two steps share once, as a sharing pool\'s new machines', async () => {
    // Two presses at 0.1 runs a second, half an owned bender each (σ = 2 raw × 8,640 = 17,280, a new block 8,640, an owned
    // one 4,320): on a network they share it and pay one owned block, 1 + 0.25 in σ; without sharing one step has it
    // and the other a new bender (10 to build), 1 + 0.25 + 8,650 / 17,280.
    const presses = { 'press-a': [opt(101, 1, 0.2, 10, 1)], 'press-b': [opt(101, 1, 0.2, 10, 1)] };
    const demand: Array<[StuffKey, number]> = [['t:t1@0', 0.1], ['t:t2@0', 0.1]];
    const shared = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options: presses, share: true }, { stepCharge: 0.5 });
    for (const id of ['press-a', 'press-b']) expect(shared.sol.machines?.get(id), id).toMatchObject({ added: 0, newLoad: 0, ownedLoad: 0.5 });
    expect(shared.sol.buildStats?.objective).toBeCloseTo(1.25, 4);
    const direct = await solvedWithBuild(twoPressSpec(), COSTS, demand, { options: presses }, { stepCharge: 0.5 });
    const steps = [...(direct.sol.machines?.values() ?? [])];
    expect(steps.filter((m) => m.ownedLoad === 1 && m.added === 0)).toHaveLength(1);
    expect(steps.filter((m) => m.added === 1 && m.ownedLoad === 0)).toHaveLength(1);
    expect(direct.sol.buildStats?.objective).toBeCloseTo(1.25 + 8650 / 17280, 4);
  });
});
