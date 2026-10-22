// The plan-invariant checker (tests/helpers/plan-invariants.ts) on Mini-GT: real plans pass every invariant, and each
// kind of damage a plan can carry (a good from nowhere, too few machines, a flow that does not add up, an unlisted
// surplus, a raw input without a source) is reported under its own kind. With `buildCost` (plan 12 Task 8) the checks
// that assume plan 09's objective follow plan 12's, and the damage is still found.

import { describe, expect, it } from 'vitest';
import { LV_MACHINE_PARTS, kitSpec, sandSpec, withAutoWorkbenches, withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { checkPlanInvariants, checkPlanInvariantsDeep, countByKind, type Violation } from '../../helpers/plan-invariants.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { OreVein, Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';

/**
 * Mini-GT whose MV bender, MV assembler and fluid extractor can be built, with build cost ignored (plan 12; ruling P3):
 * the plans plan 09's checker was written for, as controller Amendment OQ3 never plans a machine no recipe makes.
 */
const pack = packFromSpec(withBuildRecipes(MINI_GT, [102, 122, 131], LV_MACHINE_PARTS));
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), buildHorizonHours: null, ...p });
const errors = (v: readonly Violation[]): Violation[] => v.filter((x) => x.severity === 'error');
const kinds = (v: readonly Violation[]): string[] => [...new Set(errors(v).map((x) => x.kind))].sort();
const copy = (p: Plan): Plan => structuredClone(p);

describe('checkPlanInvariants on Mini-GT', () => {
  const cases: Array<[string, Partial<PlanSettings>]> = [
    ['circuits at LV', { target: 't:circuit@0', amount: 30, tier: 1 }],
    ['circuits at MV', { target: 't:circuit@0', amount: 30, tier: 2 }],
    ['circuits at MV, 1 per hour', { target: 't:circuit@0', amount: 1, per: 'hour', tier: 2 }],
    ['LV hulls', { target: 't:hull_lv@0', amount: 2, tier: 1 }],
    ['titanium plates at HV', { target: 't:titanium_plate@0', amount: 5, tier: 3 }],
  ];
  for (const [label, settings] of cases) {
    it(`finds nothing wrong with ${label}`, async () => {
      const s = S(settings);
      const plan = await planLine(pack, s, emptyContext());
      expect(plan.status).toBe('ok');
      const v = await checkPlanInvariantsDeep(pack, s, plan, { marginal: true });
      expect(errors(v), JSON.stringify(countByKind(v))).toEqual([]);
      expect(v.filter((x) => x.kind === 'cost' && x.severity === 'info')).toHaveLength(1);
    });
  }

  it('reports each kind of damage under its own kind', async () => {
    const s = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const plan = await planLine(pack, s, emptyContext());
    expect(errors(checkPlanInvariants(pack, s, plan))).toEqual([]);

    // A raw input dropped: its good is consumed with no source, and the flows no longer add up.
    const noCopper = copy(plan);
    noCopper.rawInputs = noCopper.rawInputs.filter((r) => r.key !== 't:copper_ingot@0');
    noCopper.flows = noCopper.flows.filter((f) => f.key !== 't:copper_ingot@0');
    expect(kinds(checkPlanInvariants(pack, s, noCopper))).toEqual(['flow', 'orphan-input']);

    // Too few machines for the runs.
    const busy = copy(plan);
    const wire = busy.steps.find((x) => x.id === 'wire')!;
    wire.count = Math.max(1, Math.ceil(wire.count / 4));
    wire.runsPerSecond *= 4;
    const v = checkPlanInvariants(pack, s, busy);
    expect(kinds(v)).toContain('machines');
    expect(kinds(v)).toContain('flow');

    // A flow listed twice.
    const twice = copy(plan);
    twice.flows.push({ ...twice.flows[0]! });
    expect(kinds(checkPlanInvariants(pack, s, twice))).toContain('flow');

    // A surplus the byproducts do not list: buy twice the iron the steps use.
    const surplus = copy(plan);
    const iron = surplus.rawInputs.find((r) => r.key === 't:iron_ingot@0')!;
    iron.perSecond *= 2;
    expect(kinds(checkPlanInvariants(pack, s, surplus))).toEqual(expect.arrayContaining(['byproduct', 'flow']));

    // A step that takes more than anything makes.
    const short = copy(plan);
    const circuit = short.steps.find((x) => x.id === 'circuit-lv')!;
    circuit.inputs = circuit.inputs.map((p) => (p.key === 't:redstone@0' ? { ...p, amount: p.amount * 2 } : p));
    expect(kinds(checkPlanInvariants(pack, s, short))).toEqual(expect.arrayContaining(['balance', 'flow']));

    // A raw input without a source.
    const unsourced = copy(plan);
    unsourced.rawInputs[0]!.sources = [];
    expect(kinds(checkPlanInvariants(pack, s, unsourced))).toEqual(['raw-source']);
  });

  it('calls a good made by two recipes redundant when one alone costs the same', async () => {
    const s = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const plan = await planLine(pack, s, emptyContext());
    // Make half the plates by hammering instead (2 ingots each): a second producer that costs more.
    const mixed = copy(plan);
    const bend = mixed.steps.find((x) => x.id === 'bend-plate')!;
    bend.runsPerSecond /= 2;
    mixed.steps.push({ ...structuredClone(bend), id: 'hammer-plate', recipeId: 'hammer-plate', mapId: 'crafting', inputs: [{ key: 't:iron_ingot@0', amount: 2, chance: 1 }] });
    const v = await checkPlanInvariantsDeep(pack, s, mixed);
    const multi = v.find((x) => x.kind === 'multi-producer' && x.key === 't:iron_plate@0');
    expect(multi?.severity).toBe('error');
    expect(multi?.message).toContain('REDUNDANT');
  });
});

describe('checkPlanInvariants with build cost counted', () => {
  // Plans of plan 12's objective (build cost over 24 hours, the default): the build MIP picks each step's tier, owned
  // machines of another tier run beside new ones, AE2 steps share machines, crafting-table steps run on Auto Workbenches,
  // sand may be made from free cobblestone and raw material may rise above the step charge's +25 % to save machines.
  // Plan 09's checks read each of those as damage; `buildCost` reads them as plan 12 plans them.
  const mini = miniGt();
  const owning = (...owned: PlanContext['ownedMachines']): PlanContext => ({ ...emptyContext(), ownedMachines: owned });
  const findings = (v: readonly Violation[]): string[] => v.filter((x) => x.severity !== 'info').map((x) => `${x.kind}/${x.severity}: ${x.message}`);
  const severityOf = (v: readonly Violation[], kind: Violation['kind']): string[] => v.filter((x) => x.kind === kind).map((x) => x.severity);
  /** Iron plates at MV, 60 a minute, at "Some machines" (2 %), the group owning an Advanced Bending Machine no recipe makes. */
  const plates: PlanSettings = { ...defaultSettings(), target: 't:iron_plate@0', tier: 2, amount: 60, stepCharge: 0.02, automateCrafting: false };
  const oneMvBender = owning({ mteId: 102, count: 1 });
  /** Glass at LV, 1 a minute, at 2 %, crafted by hand, on AE2: one forge hammer runs gravel and sand from free cobblestone. */
  const glass: PlanSettings = { ...defaultSettings(), target: 't:glass@0', tier: 1, amount: 1, per: 'min', stepCharge: 0.02, automateCrafting: false, logistics: 'ae2' };
  const sand = packFromSpec(sandSpec());

  it("accepts the tier the solve picks and counts the owned machines of another tier beside a step's own", async () => {
    // 3 new Basic Bending Machines (0.2 runs/s each) beside the owned Advanced one (0.4): build-plan.test.ts's
    // 'lists the eligible tiers of a step'.
    const plan = await planLine(mini, plates, oneMvBender);
    expect(plan.steps.find((x) => x.id === 'bend-plate')).toMatchObject({ machine: { mteId: 101 }, count: 3, reused: { others: [{ mteId: 102, count: 1 }] } });
    // Plan 09's checks: not a fresh pick's MV bender, too few machines without the owned one, its utilization and power.
    const plain = checkPlanInvariants(mini, plates, plan, { ctx: oneMvBender });
    expect(plain.filter((x) => x.kind === 'machines').map((x) => x.severity)).toEqual(['error', 'error', 'warn', 'warn']);
    expect(findings(checkPlanInvariants(mini, plates, plan, { ctx: oneMvBender, buildCost: true }))).toEqual([]);
  });

  it('counts a sharing pool once and reads each step of it at its own share', async () => {
    // AE2: gravel and sand on one hammer (peak 62 = rock breaker 30 + the hammer once 16 + furnace 16); the kit's
    // circuit, gear and kit steps on the one owned assembler (peak 48 = the owned unit once 16 + bender 24 + wiremill 8).
    const kit = packFromSpec(kitSpec());
    const oneAssembler = owning({ mteId: 121, count: 1, where: [{ dim: 0, pos: [10, 64, 10] }] });
    const kitSettings: PlanSettings = { ...defaultSettings(), target: 't:kit@0', tier: 1, automateCrafting: false, logistics: 'ae2' };
    const cases: Array<[Pack, PlanSettings, PlanContext, string]> = [
      [sand, glass, emptyContext(), 'pool:hammer-gravel'], [kit, kitSettings, oneAssembler, 'pool:circuit-lv'],
    ];
    for (const [p, settings, ctx, pool] of cases) {
      const plan = await planLine(p, settings, ctx);
      expect(plan.steps.filter((x) => x.pool?.id === pool).length, pool).toBeGreaterThan(1);
      expect(checkPlanInvariants(p, settings, plan, { ctx }).filter((x) => x.kind === 'machines').map((x) => x.message), pool)
        .toEqual([expect.stringMatching(/^power\.peakEUt \d+ ≠ Σ count × EU\/t \d+$/)]);
      expect(findings(checkPlanInvariants(p, settings, plan, { ctx, buildCost: true })), pool).toEqual([]);
    }
  });

  it('accepts crafting-table steps on an Auto Workbench', async () => {
    const benches = packFromSpec(withAutoWorkbenches(MINI_GT, [1]));
    const hulls: PlanSettings = { ...defaultSettings(), target: 't:hull_lv@0', tier: 1, amount: 2 };
    const plan = await planLine(benches, hulls, emptyContext());
    expect(plan.steps.filter((x) => x.machine.mteId === 31091).map((x) => x.id)).toEqual(['cable', 'hull-lv']);
    expect(checkPlanInvariants(benches, hulls, plan).filter((x) => x.severity === 'error').map((x) => x.stepId)).toEqual(['cable', 'hull-lv']);
    expect(findings(checkPlanInvariants(benches, hulls, plan, { buildCost: true }))).toEqual([]);
  });

  it('reads sand made from free cobblestone as a note: the build-cost objective chose it, machines and step charges counted', async () => {
    const plan = await planLine(sand, glass, emptyContext());
    expect(severityOf(checkPlanInvariants(sand, glass, plan), 'free-detour')).toEqual(['warn']);
    expect(severityOf(checkPlanInvariants(sand, glass, plan, { buildCost: true }), 'free-detour')).toEqual(['info']);
  });

  it('still finds a machine no step could run, a pool sized wrong, an overclock not of its own tier and too few machines', async () => {
    const plan = await planLine(mini, plates, oneMvBender);
    const errorsOf = (p: Plan): string[] => checkPlanInvariants(mini, plates, p, { ctx: oneMvBender, buildCost: true }).filter((x) => x.severity === 'error').map((x) => x.message);
    const bendOf = (p: Plan) => p.steps.find((x) => x.id === 'bend-plate')!;
    // A wiremill bending plates.
    const wiremill = copy(plan);
    bendOf(wiremill).machine = { mteId: 111, name: 'Basic Wiremill', tier: 1 };
    expect(errorsOf(wiremill)).toEqual([expect.stringContaining('none of the machines that can run it')]);
    // The MV bender with the LV bender's overclock.
    const mv = copy(plan);
    bendOf(mv).machine = { mteId: 102, name: 'Advanced Bending Machine', tier: 2 };
    expect(errorsOf(mv)).toEqual(expect.arrayContaining([expect.stringContaining('recomputed')]));
    // Without the owned machine beside them, 3 Basic Bending Machines do 0.6 of the 1 run a second.
    const alone = copy(plan);
    delete bendOf(alone).reused;
    expect(errorsOf(alone)).toEqual([expect.stringContaining('needs 5.0000')]);
    // A pool whose steps disagree on their machines, and one with a machine more than its steps' busy time needs.
    const glassPlan = await planLine(sand, glass, emptyContext());
    const poolErrors = (p: Plan): string[] => checkPlanInvariants(sand, glass, p, { buildCost: true }).filter((x) => x.severity === 'error').map((x) => x.message);
    const uneven = copy(glassPlan);
    uneven.steps.find((x) => x.id === 'hammer-sand')!.count = 2;
    expect(poolErrors(uneven)).toEqual(expect.arrayContaining([expect.stringContaining('pool:hammer-gravel')]));
    const twice = copy(glassPlan);
    for (const id of ['hammer-gravel', 'hammer-sand']) twice.steps.find((x) => x.id === id)!.count = 2;
    expect(poolErrors(twice)).toEqual([expect.stringContaining('2 machines where 1 would do')]);
  });

  it('lets raw material rise above the step charge cap and a producer be redundant in raw material alone, never below the least', async () => {
    // Over 1 hour a Basic Circuit an hour hammers its plates by hand (4 raw against the bender's 3: +33 %).
    const hourly: PlanSettings = { ...defaultSettings(), target: 't:circuit@0', tier: 1, amount: 1, per: 'hour', automateCrafting: false, buildHorizonHours: 1 };
    const hammered = await planLine(mini, hourly, emptyContext());
    expect(hammered.steps.map((x) => x.id)).toContain('hammer-plate');
    expect(severityOf(await checkPlanInvariantsDeep(mini, hourly, hammered, { stepCharge: hourly.stepCharge }), 'cost')).toContain('error');
    expect(findings(await checkPlanInvariantsDeep(mini, hourly, hammered, { stepCharge: hourly.stepCharge, buildCost: true }))).toEqual([]);
    // The lower bound stays: a plan that uses less raw material than the least gets it from nowhere.
    const short = copy(hammered);
    for (const r of short.rawInputs) r.cost /= 2;
    expect(severityOf(await checkPlanInvariantsDeep(mini, hourly, short, { stepCharge: hourly.stepCharge, buildCost: true }), 'cost')).toContain('error');
    // A Thing bent or drawn from 1 A Dust, at 0.5 runs a second per machine: the owned bender does half, one new wiremill
    // (1 raw to build, against the bender's 10) the rest. The two recipes cost the same raw material.
    const vein: OreVein = { name: 'ore.mix.a', dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
      materials: { primary: 'A', secondary: 'A', between: 'A', sporadic: 'A' } };
    const tie = packFromSpec(withBuildRecipes(withBuildRecipes({
      items: [{ key: 't:a@0', name: 'A Dust', gt: { prefix: 'dust', material: 'A' } }, { key: 't:t@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.metalbender', name: 'Bending Machine' }, { id: 'gt.recipe.wiremill', name: 'Wiremill' }],
      machines: [{ mteId: 301, name: 'Basic Bending Machine', tier: 1, maps: ['gt.recipe.metalbender'] }, { mteId: 302, name: 'Basic Wiremill', tier: 1, maps: ['gt.recipe.wiremill'] }],
      recipes: [
        { id: 'bend', map: 'gt.recipe.metalbender', in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 16, dur: 40 },
        { id: 'mill', map: 'gt.recipe.wiremill', in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 16, dur: 40 },
      ],
      worldgen: { veins: [vein] },
    }, [301], [['t:a@0', 10]]), [302], [['t:a@0', 1]]));
    const oneBender = owning({ mteId: 301, count: 1 });
    const things: PlanSettings = { ...defaultSettings(), target: 't:t@0', tier: 1, amount: 60, per: 'min' };
    const both = await planLine(tie, things, oneBender);
    expect(both.steps.map((x) => [x.id, x.count, x.owned])).toEqual([['bend', 1, 1], ['mill', 1, 0]]);
    expect(severityOf(await checkPlanInvariantsDeep(tie, things, both, { ctx: oneBender }), 'multi-producer')).toEqual(['error']);
    expect(findings(await checkPlanInvariantsDeep(tie, things, both, { ctx: oneBender, buildCost: true }))).toEqual([]);
  });
});
