// Goods a build-cost plan makes two ways, or buys beside its makers, on purpose (plan 12's final review; the plan's side
// of controller ruling 249's `needsMachine`): with the raw cap at its default the e2e Basic Circuit line makes 40 % of its
// Iron Plates on one full Basic Bending Machine and the rest on the automated crafting table, the best plan the settings
// ask for. The build stage marks such a split (`Plan.deliberate`), so plan 09's integrity check gives it as a note, not
// as "This plan does not add up"; a split the plan's machines could do without stays an integrity issue. On an AE2 line
// the build stage makes each item good one way instead (add-on 12 x 17 F6). Mini-GT and synthetic steps only: invented
// names, no game data.

import { describe, expect, it } from 'vitest';
import { deliberateSplits, emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Product } from '../../../src/shared/types/pack.ts';
import type { PlanFlow, PlanSettings, PlanStep, RawInput } from '../../../src/shared/types/plan.ts';
import { opt, solvedWithBuild } from '../../helpers/build-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import type { PackSpec } from '../../helpers/pack-spec.ts';

const PLATE = 't:iron_plate@0';
const INGOT = 't:iron_ingot@0';

const BENDER = 'gt.recipe.metalbender';
const HAMMER = 'gt.recipe.hammer';
const ASSEMBLER = 'gt.recipe.assembler';
/**
 * A good made two ways (12 x 17 F6): `g-plain` (1 a → 1 g) on a Basic Bending Machine (101), `g-twin` (1 b → 1 g + 1 h)
 * on a Basic Forge Hammer (481), and `p-make` (2 g + 1 h → 1 p) on a Basic Assembler (121), all LV.
 */
function twinMakerSpec(): PackSpec {
  return {
    maps: [{ id: BENDER, name: 'Bending Machine' }, { id: HAMMER, name: 'Forge Hammer' }, { id: ASSEMBLER, name: 'Assembler' }],
    machines: [
      { mteId: 101, name: 'Basic Bending Machine', tier: 1, maps: [BENDER] },
      { mteId: 481, name: 'Basic Forge Hammer', tier: 1, maps: [HAMMER] },
      { mteId: 121, name: 'Basic Assembler', tier: 1, maps: [ASSEMBLER] },
    ],
    recipes: [
      { id: 'g-plain', map: BENDER, in: [['t:a@0', 1]], out: [['t:g@0', 1]], eut: 24, dur: 100 },
      { id: 'g-twin', map: HAMMER, in: [['t:b@0', 1]], out: [['t:g@0', 1], ['t:h@0', 1]], eut: 16, dur: 40 },
      { id: 'p-make', map: ASSEMBLER, in: [['t:g@0', 2], ['t:h@0', 1]], out: [['t:p@0', 1]], eut: 16, dur: 100 },
    ],
  };
}

describe('a split the build stage makes on purpose', () => {
  const pack = miniGt();
  /** The e2e line: 30 Basic Circuits a minute at LV, every other setting the default (the +25 % raw cap among them). */
  const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', amount: 30, tier: 1, ...p });

  it('marks the plates the raw cap keeps on one full Bending Machine, and says so in a note, not as a problem', async () => {
    const plan = await planLine(pack, S(), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['bend-plate', 'circuit-lv', 'hammer-plate', 'wire']);
    expect(plan.steps.filter((s) => s.mainOutput === PLATE).map((s) => [s.id, s.machine.name, s.count, s.utilization])).toEqual([
      ['bend-plate', 'Basic Bending Machine', 1, 1], ['hammer-plate', 'Crafting table (automated)', 1, 0.3]]);
    expect(plan.rawCost).toEqual({ perSecond: 1.8, leastPerSecond: 1.5, leanestPerSecond: 1.5 });
    expect(plan.deliberate).toEqual([{ key: PLATE, code: 'multi-producer', why: 'full', full: ['bend-plate'] }]);
    const index = indexPlan(plan);
    expect(index.issues).toEqual([]);
    expect(index.notes.map((n) => [n.code, n.key, n.stepIds])).toEqual([['multi-producer', PLATE, ['hammer-plate', 'bend-plate']]]);
    expect(plan.warnings.filter((w) => w.code === 'multi-producer')).toEqual([]);
    expect(plan.warnings.filter((w) => w.code === 'deliberate-split')).toEqual([{ code: 'deliberate-split', key: PLATE, stepId: 'hammer-plate',
      stepIds: ['hammer-plate', 'bend-plate'], share: [0.6, 0.4], text: 'Iron Plate is made 2 ways: Crafting table (automated) (60%) and Basic Bending '
        + 'Machine (40%). The Basic Bending Machine is full, and one more would cost more than the raw material it saves.' }]);
  });

  it('makes each item one way on AE2, with more machines rather than more raw material (12 x 17 F6)', async () => {
    // An AE2 job crafts an item through the first pattern that makes it, so a second maker would never be fed (the user's
    // "every machine input fed, no deadlock, in every mode"): on AE2 the line bends every plate, on 3 Basic Bending
    // Machines, at the leanest line's raw material; the direct line above keeps its split.
    const plan = await planLine(pack, S({ logistics: 'ae2' }), emptyContext());
    expect(plan.status ?? 'ok').toBe('ok');
    expect(plan.steps.filter((s) => s.mainOutput === PLATE).map((s) => [s.id, s.machine.name, s.count])).toEqual([['bend-plate', 'Basic Bending Machine', 3]]);
    expect(plan.deliberate).toBeUndefined();
    expect(plan.rawCost).toMatchObject({ perSecond: 1.5, leanestPerSecond: 1.5 });
  });

  it('keeps the split out on AE2 where plan 09\'s plan or the time guard\'s fallback would bring it back (12 x 17 F6)', async () => {
    // 1 p a minute, a at 1 and b at 1.2: the least raw material makes g both ways (2.2 a p against 2.4 by the twin
    // alone), and at a 2 % step charge so does plan 09's plan, which then costs less by the build MIP's measure than any
    // plan making g one way. A direct line takes it, and it is ruling 187's yardstick there. On AE2 neither a pick
    // (`cheaperPlan`) nor the fallback the build stage takes without a MIP answer (`buildTimeLimit` 0, as when the time
    // guard stops the MIP) takes it, and it is no yardstick (12 x 17 ruling R9): the line makes g on the twin alone, 2.4 a p.
    const options = { 'g-plain': [opt(101, 1, 0.2, 17)], 'g-twin': [opt(481, 1, 0.5, 17)], 'p-make': [opt(121, 1, 0.2, 16)] };
    const demand: Array<[StuffKey, number]> = [['t:p@0', 1 / 60]];
    const solve = (share: boolean, buildTimeLimit?: number): ReturnType<typeof solvedWithBuild> => solvedWithBuild(
      twinMakerSpec(), { 't:a@0': 1, 't:b@0': 1.2 }, demand, { options, share },
      { stepCharge: 0.02, rawCap: 0.25, ...(buildTimeLimit === undefined ? {} : { buildTimeLimit }) });
    const direct = await solve(false);
    expect(direct.runs).toEqual(['g-plain', 'g-twin', 'p-make']);
    expect(direct.sol.buildStats?.ignoredObjective).toBeDefined();
    for (const limit of [undefined, 0]) {
      const ae2 = await solve(true, limit);
      expect(ae2.sol.status, `time limit ${limit}`).toBe('ok');
      expect(ae2.sol.buildStats?.approx, `time limit ${limit}`).toBe(limit === 0);
      expect(ae2.runs, `time limit ${limit}`).toEqual(['g-twin', 'p-make']);
      expect(Math.abs(ae2.sol.rawCost - 2.4 / 60), `time limit ${limit}`).toBeLessThan(1e-9);
      expect(ae2.sol.buildStats?.ignoredObjective, `time limit ${limit}`).toBeUndefined();
    }
  });

  it('marks nothing where the line makes each good one way, or ignores build cost', async () => {
    // No raw cap: every plate on the crafting table. Build cost ignored: plan 09's stages, whose integrity check stays.
    for (const p of [{ rawCap: null }, { buildHorizonHours: null }] as const) {
      const plan = await planLine(pack, S(p), emptyContext());
      expect(plan.status, JSON.stringify(p)).toBe('ok');
      expect(plan.deliberate, JSON.stringify(p)).toBeUndefined();
      expect(plan.warnings.filter((w) => w.code.startsWith('deliberate-')), JSON.stringify(p)).toEqual([]);
    }
  });
});

describe('deliberateSplits', () => {
  const out = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
  /** A step making `key` (its main output) at `rawCost` a unit, on `mteId` (below 0: a pseudo machine), its machines `utilization` busy. */
  const maker = (id: string, key: string, perSecond: number, rawCost: number, utilization: number, mteId = 101): PlanStep => ({
    id, recipeId: id, mapId: 'gt.recipe.test', machine: { mteId, name: `Machine ${id}`, tier: 1 }, count: 1, owned: 0, runsPerSecond: perSecond,
    utilization, euPerTick: 8, durationTicks: 20, overclocks: 0, inputs: [], outputs: [out(key, 1)], alternatives: [{ recipeId: id, rawCost, mapId: 'gt.recipe.test' }],
    handCraft: false, warnings: [], mainOutput: key,
  });
  const use = (from: string, perSecond: number, key = PLATE): PlanFlow => ({ from, to: 'out', key, perSecond });
  const bought = (key: string, perSecond: number, price: number): RawInput => ({ key, perSecond, cost: perSecond * price, available: true, sources: [] });

  it('marks a split one maker cannot take whole within the plan\'s machines, by its full machines', () => {
    // a: full, 1 raw a plate; b: the crafting table, 2 a plate: a has no room for b's share, and b takes a's for more raw
    const steps = [maker('a', PLATE, 0.4, 1, 1), maker('b', PLATE, 0.6, 2, 0.6, -1)];
    expect(deliberateSplits(steps, [use('a', 0.4), use('b', 0.6)], [], false)).toEqual([{ key: PLATE, code: 'multi-producer', why: 'full', full: ['a'] }]);
    // Both full: neither takes the other's share.
    const both = [maker('a', PLATE, 0.4, 1, 1), maker('b', PLATE, 0.6, 1, 1)];
    expect(deliberateSplits(both, [use('a', 0.4), use('b', 0.6)], [], false)).toEqual([{ key: PLATE, code: 'multi-producer', why: 'full', full: ['b', 'a'] }]);
  });

  it('leaves a split the plan\'s machines could do without an integrity issue', () => {
    // a is full, but b makes plates for no more raw material and has room for a's whole share: a tie a machine pays for
    const tie = [maker('a', PLATE, 0.4, 1, 1), maker('b', PLATE, 0.2, 1, 0.2)];
    expect(deliberateSplits(tie, [use('a', 0.4), use('b', 0.2)], [], false)).toEqual([]);
    // No maker full: the leaner one has room (as far as its own machines go), so only the raw cap explains the split.
    const room = [maker('a', PLATE, 0.4, 1, 0.5), maker('b', PLATE, 0.6, 2, 0.6, -1)];
    expect(deliberateSplits(room, [use('a', 0.4), use('b', 0.6)], [], false)).toEqual([]);
    expect(deliberateSplits(room, [use('a', 0.4), use('b', 0.6)], [], true)).toEqual([{ key: PLATE, code: 'multi-producer', why: 'raw-cap' }]);
    // At the cap, ways alike in raw material a unit are still a tie.
    const alike = [maker('a', PLATE, 0.4, 1, 0.5), maker('b', PLATE, 0.6, 1, 0.6, -1)];
    expect(deliberateSplits(alike, [use('a', 0.4), use('b', 0.6)], [], true)).toEqual([]);
  });

  it('marks a purchase beside makers that are all full, or at the raw cap where buying and making differ', () => {
    const plates = (utilization: number): PlanStep[] => [{ ...maker('bend', PLATE, 1, 2, 1), inputs: [out(INGOT, 1)] }, maker('smelt', INGOT, 0.25, 1, utilization)];
    const flows: PlanFlow[] = [use('bend', 1), { from: 'raw', to: 'bend', key: INGOT, perSecond: 0.75 }, { from: 'smelt', to: 'bend', key: INGOT, perSecond: 0.25 }];
    expect(deliberateSplits(plates(1), flows, [bought(INGOT, 0.75, 1.5)], false)).toEqual([{ key: INGOT, code: 'bought-and-made', why: 'full', full: ['smelt'] }]);
    expect(deliberateSplits(plates(0.5), flows, [bought(INGOT, 0.75, 1.5)], false)).toEqual([]);
    expect(deliberateSplits(plates(0.5), flows, [bought(INGOT, 0.75, 1.5)], true)).toEqual([{ key: INGOT, code: 'bought-and-made', why: 'raw-cap' }]);
    expect(deliberateSplits(plates(0.5), flows, [bought(INGOT, 0.75, 1)], true)).toEqual([]);
  });
});
