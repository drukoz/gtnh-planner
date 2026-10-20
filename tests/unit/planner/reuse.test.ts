// "Reuse machines we have" and the "Machines we have" list (plan 09 Task 9; architecture §11.29, rulings P22): the
// machines a line runs on are the world scan's and the list's (none with the switch off), less the declined types, for
// machine assignment and the build list, in rate mode and in Make N.

import { describe, it, expect } from 'vitest';
import { LV_MACHINE_PARTS, withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { ownedMachineMap, ownedPools, planSteps } from '../../../src/server/planner/machines.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { solveLine } from '../../../src/server/planner/solve.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { MachineWhere, Plan, PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const ASSEMBLER = 121;   // Mini-GT's Basic Assembler (LV), which runs circuit-lv
const BENDER = 101;      // Basic Bending Machine (LV)
const at = (x: number, z: number): MachineWhere => ({ dim: 0, pos: [x, 64, z] });
const A1 = at(1, 2), A2 = at(3, 2), B1 = at(5, 2);

/** 18 Basic Circuits a minute at LV: circuit-lv runs 0.3 times a second, which takes 3 Basic Assemblers. */
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', amount: 18, per: 'min', tier: 1, buildHorizonHours: null, ...p });
/** A world scan's base with these machines (`where`: where each stands). */
const scanned = (...owned: PlanContext['ownedMachines']): PlanContext => ({ ...emptyContext(), ownedMachines: owned });
const TWO_ASSEMBLERS = scanned({ mteId: ASSEMBLER, count: 2, where: [A1, A2] });

const stepOf = (plan: Plan, id: string) => plan.steps.find((s) => s.id === id)!;
const built = (plan: Plan, mteId: number): number | undefined => plan.buildList.find((l) => l.key === `machine:${mteId}@0`)?.amount;

describe('reusing machines we have (rate)', () => {
  it('runs a step on the owned machines first and builds only the rest', async () => {
    const p = await planLine(pack, S(), TWO_ASSEMBLERS);
    expect(stepOf(p, 'circuit-lv')).toMatchObject({ count: 3, owned: 2, reused: { count: 2, where: [A1, A2] } });
    expect(p.steps.filter((s) => s.reused !== undefined).map((s) => s.id)).toEqual(['circuit-lv']);
    expect(built(p, ASSEMBLER)).toBe(1);
  });
  it('with "Reuse machines we have" off, runs every step on new machines', async () => {
    const p = await planLine(pack, S({ reuseOwned: false }), TWO_ASSEMBLERS);
    expect(p.steps.map((s) => [s.id, s.owned, s.reused])).toEqual([['bend-plate', 0, undefined], ['circuit-lv', 0, undefined], ['wire', 0, undefined]]);
    expect(stepOf(p, 'circuit-lv').count).toBe(3);
    expect(built(p, ASSEMBLER)).toBe(3);
    expect(p.buildSteps.map((b) => b.text).join('\n')).not.toContain('reuse your');
  });
  it('with the switch off, an owned machine no longer decides which machine a step runs on', async () => {
    // At MV a plate is bent on the owned LV bender while reuse is on, else on the MV one (the highest tier). Mini-GT's MV
    // bender gets a build recipe (ruling P3): plan 12 never plans one no recipe makes as a new machine.
    const mv = packFromSpec(withBuildRecipes(MINI_GT, [102], LV_MACHINE_PARTS));
    const ctx = scanned({ mteId: BENDER, count: 1, where: [B1] });
    const plate = { target: 't:iron_plate@0', tier: 2 };
    const on = await planLine(mv, S(plate), ctx);
    expect(stepOf(on, 'bend-plate')).toMatchObject({ machine: { mteId: BENDER }, owned: 1, reused: { count: 1, where: [B1] } });
    const off = await planLine(mv, S({ ...plate, reuseOwned: false }), ctx);
    expect(stepOf(off, 'bend-plate')).toMatchObject({ machine: { mteId: 102 }, owned: 0 });
    expect(stepOf(off, 'bend-plate').reused).toBeUndefined();
  });
  it('reuses the machines of the "Machines we have" list without a world', async () => {
    const p = await planLine(pack, S({ ownedManual: [{ mteId: ASSEMBLER, count: 1 }] }), emptyContext());
    expect(stepOf(p, 'circuit-lv')).toMatchObject({ count: 3, owned: 1, reused: { count: 1, where: [] } });
    expect(built(p, ASSEMBLER)).toBe(2);
  });
  it('adds the list to the scan, the scanned machines and where they stand first', async () => {
    const p = await planLine(pack, S({ ownedManual: [{ mteId: ASSEMBLER, count: 1 }] }), TWO_ASSEMBLERS);
    expect(stepOf(p, 'circuit-lv')).toMatchObject({ count: 3, owned: 3, reused: { count: 3, where: [A1, A2] } });
    expect(built(p, ASSEMBLER)).toBeUndefined();
  });
  it('still leaves out a declined machine type, from the scan and from the list, while the switch is on', async () => {
    const ctx = scanned({ mteId: ASSEMBLER, count: 2, where: [A1, A2] }, { mteId: BENDER, count: 1, where: [B1] });
    const p = await planLine(pack, S({ declineReuse: [ASSEMBLER], ownedManual: [{ mteId: ASSEMBLER, count: 1 }] }), ctx);
    expect(stepOf(p, 'circuit-lv')).toMatchObject({ count: 3, owned: 0 });
    expect(stepOf(p, 'circuit-lv').reused).toBeUndefined();
    expect(stepOf(p, 'bend-plate')).toMatchObject({ owned: 1, reused: { count: 1, where: [B1] } });
    expect(built(p, ASSEMBLER)).toBe(3);
  });
  it('gives the owned machines of one type to the steps in order, positions first, the list after', async () => {
    // Two LV assembler steps of two machines each; three owned: two the scan found, one on the list. Plan 12: `units`
    // says which of the type's owned machines a step runs on (0-based, the scan's first).
    const spec: PackSpec = {
      maps: [{ id: 'gt.recipe.assembler' }],
      machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [
        { id: 'make-a', map: 'gt.recipe.assembler', in: [['raw@0', 1]], out: [['a@0', 1]], eut: 16, dur: 100 },
        { id: 'make-t', map: 'gt.recipe.assembler', in: [['a@0', 1]], out: [['t@0', 1]], eut: 16, dur: 100 },
      ],
    };
    const p = packFromSpec(spec);
    const settings = { ...defaultSettings(), ownedManual: [{ mteId: 1, count: 1 }] };
    const env: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(settings.excludedCategories) };
    const rawLeaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const graph = buildCandidates(p, settings, env, rawLeaf, ['t@0']);
    const sol = await solveLine(graph, new Map([['t@0', 0.4]]));   // 0.4 runs a second each, 0.2 per machine
    const ctx = { ...emptyContextForTest(), ownedMachines: [{ mteId: 1, count: 2, where: [A1, A2] }] };
    const steps = planSteps(p, graph, sol, { settings, groupTier: 1, coilHeat: 1801, ctx, perSecondScale: 1 });
    expect(steps.map((s) => [s.id, s.count, s.owned, s.reused])).toEqual([
      ['make-a', 2, 2, { count: 2, where: [A1, A2], units: [0, 1] }], ['make-t', 2, 1, { count: 1, where: [], units: [2] }]]);
  });
  it('copies where the machines stand, sharing nothing with the context', async () => {
    const ctx = scanned({ mteId: ASSEMBLER, count: 2, where: [at(1, 2), at(3, 2)] });
    const where = stepOf(await planLine(pack, S(), ctx), 'circuit-lv').reused!.where;
    expect(where).toEqual([A1, A2]);
    expect(where[0]).not.toBe(ctx.ownedMachines[0]!.where![0]);
    expect(where[0]!.pos).not.toBe(ctx.ownedMachines[0]!.where![0]!.pos);
  });
  it('names the dimension each reused machine stands in', async () => {
    // Plan 09's final review: without a linked base the scan's whole world counts, so a machine the step reuses may stand
    // in the Nether; the plan names its dimension for the step panel (`dimId:<n>`, as for a found ore spot).
    const nether: MachineWhere = { dim: -1, pos: [8, 40, 8] };
    const p = await planLine(pack, S(), scanned({ mteId: ASSEMBLER, count: 2, where: [A1, nether] }));
    expect(stepOf(p, 'circuit-lv').reused?.where).toEqual([A1, nether]);
    expect(p.names).toMatchObject({ 'dimId:0': 'Overworld', 'dimId:-1': 'Nether' });
  });
});

describe('reusing machines we have (Make N)', () => {
  const N = (p: Partial<PlanSettings> = {}): PlanSettings => S({ mode: 'makeN', amount: 10, ...p });
  it('runs each step on every owned machine of its type, with where they stand', async () => {
    const p = await planLine(pack, N(), TWO_ASSEMBLERS);
    expect(stepOf(p, 'circuit-lv')).toMatchObject({ count: 2, owned: 2, reused: { count: 2, where: [A1, A2] } });
    expect(built(p, ASSEMBLER)).toBeUndefined();
  });
  it('with the switch off, adds one new machine per type and reuses none, hammering the plates a new bender would not pay for', async () => {
    // Plan 12: a batch always weighs build cost, and for 10 circuits a new Basic Bending Machine (17 raw) costs more than
    // the 10 extra iron ingots that hammering the plates takes.
    const p = await planLine(pack, N({ reuseOwned: false }), TWO_ASSEMBLERS);
    expect(p.steps.map((s) => [s.id, s.count, s.owned, s.reused])).toEqual([
      ['circuit-lv', 1, 0, undefined], ['hammer-plate', 1, 0, undefined], ['wire', 1, 0, undefined]]);
    expect(built(p, ASSEMBLER)).toBe(1);
  });
  it('reuses the list without a world, and leaves out a declined type', async () => {
    const listed = await planLine(pack, N({ ownedManual: [{ mteId: ASSEMBLER, count: 2 }] }), emptyContext());
    expect(stepOf(listed, 'circuit-lv')).toMatchObject({ count: 2, owned: 2, reused: { count: 2, where: [] } });
    const declined = await planLine(pack, N({ ownedManual: [{ mteId: ASSEMBLER, count: 2 }], declineReuse: [ASSEMBLER] }), emptyContext());
    expect(stepOf(declined, 'circuit-lv')).toMatchObject({ count: 1, owned: 0 });
    expect(stepOf(declined, 'circuit-lv').reused).toBeUndefined();
    expect(built(declined, ASSEMBLER)).toBe(1);
  });
});

describe('ownedPools / ownedMachineMap', () => {
  const ctx = scanned({ mteId: ASSEMBLER, count: 2, where: [A1, A2] }, { mteId: BENDER, count: 1 });
  it('adds the list to the scan per type, positions only for what the scan found', () => {
    const settings = { ...defaultSettings(), ownedManual: [{ mteId: ASSEMBLER, count: 3 }, { mteId: 122, count: 1 }] };
    // one entry per machine, in pool order: the scan's with where they stand, then the list's without a position
    expect([...ownedPools(ctx, settings)]).toEqual([[ASSEMBLER, [A1, A2, null, null, null]], [BENDER, [null]], [122, [null]]]);
    expect([...ownedMachineMap(ctx, settings)]).toEqual([[ASSEMBLER, 5], [BENDER, 1], [122, 1]]);
  });
  it('is empty with "Reuse machines we have" off and leaves out declined types', () => {
    expect([...ownedMachineMap(ctx, { ...defaultSettings(), reuseOwned: false, ownedManual: [{ mteId: 122, count: 1 }] })]).toEqual([]);
    expect([...ownedMachineMap(ctx, { ...defaultSettings(), declineReuse: [ASSEMBLER], ownedManual: [{ mteId: ASSEMBLER, count: 1 }] })]).toEqual([[BENDER, 1]]);
  });
  it('reads settings stored before the switch and the list as reuse on with an empty list', () => {
    const old = { ...defaultSettings() };
    delete old.reuseOwned;
    delete old.ownedManual;
    expect([...ownedMachineMap(ctx, old)]).toEqual([[ASSEMBLER, 2], [BENDER, 1]]);
  });
});
