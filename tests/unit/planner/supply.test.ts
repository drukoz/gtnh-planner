// Free inputs need their generator (plan 09 Task 3; fix spec R2, architecture §11.26 and §11.31): in a running line
// cobblestone comes from a rock breaker, water from a pump and air from a compressor and canner, sized to the rate,
// unless the group already has a supply; a Make N batch, and a tier with no supply machine, take them free.

import { describe, it, expect } from 'vitest';
import { withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { MINI_GT } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { checkPlanInvariants, freeDetours } from '../../helpers/plan-invariants.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const COBBLE = 'minecraft:cobblestone@0';
const DISPLAY = 'gregtech:gt.metaitem.02@32765#abcdefabcdef';
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), buildHorizonHours: null, ...p });

/** Mini-GT with a rock breaker, a pump, a compressor and canner, and lines that take cobblestone, water and air. */
const SPEC: PackSpec = {
  ...MINI_GT,
  items: [
    ...MINI_GT.items!,
    { key: DISPLAY, name: 'IT\'S FREE! Place Lava on Side' }, { key: 't:stone_dust@0', name: 'Stone Dust' },
    { key: 't:washed@0', name: 'Washed Iron Dust' }, { key: 't:empty_cell@0', name: 'Empty Cell' },
    { key: 't:air_cell@0', name: 'Compressed Air Cell' }, { key: 'minecraft:gravel@0', name: 'Gravel' },
  ],
  fluids: [...MINI_GT.fluids!, { key: 'fluid:nitrogen', name: 'Nitrogen', gas: true }],
  maps: [
    ...MINI_GT.maps!, { id: 'gt.recipe.rockbreaker', name: 'Rock Breaker' }, { id: 'gt.recipe.compressor', name: 'Compressor' },
    { id: 'gt.recipe.canner', name: 'Canner' }, { id: 'gt.recipe.chemicalbath', name: 'Chemical Bath' },
  ],
  machines: [
    ...MINI_GT.machines!,
    { mteId: 441, name: 'Basic Rock Breaker', maps: ['gt.recipe.rockbreaker'], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTERockBreaker' },
    { mteId: 1140, name: 'Basic Pump', maps: [], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTEPump' },
    { mteId: 451, name: 'Basic Compressor', maps: ['gt.recipe.compressor'], tier: 1 },
    { mteId: 461, name: 'Basic Canner', maps: ['gt.recipe.canner'], tier: 1 },
    { mteId: 471, name: 'Basic Chemical Bath', maps: ['gt.recipe.chemicalbath'], tier: 1 },
  ],
  recipes: [
    ...MINI_GT.recipes!,
    { id: 'fake-cobble', map: 'gt.recipe.rockbreaker', in: [[DISPLAY, 1]], out: [[COBBLE, 1]], eut: 30, dur: 16, flags: { fake: true } },
    { id: 'mace-cobble', map: 'gt.recipe.macerator', in: [[COBBLE, 1]], out: [['t:stone_dust@0', 1]], eut: 2, dur: 40 },
    { id: 'wash', map: 'gt.recipe.chemicalbath', in: [['t:iron_dust@0', 1], ['fluid:water', 1000]], out: [['t:washed@0', 1]], eut: 8, dur: 20 },
    { id: 'make-cell', map: 'gt.recipe.metalbender', in: [['t:tin_ingot@0', 1]], out: [['t:empty_cell@0', 1]], eut: 8 },
    { id: 'compress-air', map: 'gt.recipe.compressor', in: [['t:empty_cell@0', 1]], out: [['t:air_cell@0', 1]], eut: 2, dur: 300 },
    { id: 'release-air', map: 'gt.recipe.canner', in: [['t:air_cell@0', 1]], out: [['t:empty_cell@0', 1], ['fluid:air', 2000]], eut: 2, dur: 16 },
    { id: 'air-n2', map: 'gt.recipe.centrifuge', in: [['fluid:air', 1000]], out: [['fluid:nitrogen', 390]], eut: 8, dur: 100 },
    { id: 'gravel-hand', map: 'crafting', in: [[COBBLE, 1]], out: [['minecraft:gravel@0', 1]] },
  ],
  fluidContainers: [{ container: 't:air_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:air', amount: 2000 }],
};
/** Every machine of it can be built (ruling P3: plan 12 never plans a machine no recipe makes as a new one). */
const pack = packFromSpec(withBuildRecipes(SPEC));

/** The plan's steps that run a supply recipe, as [supplied good, machine, count]. */
const supplySteps = (plan: Plan) => plan.steps.filter((s) => s.supply !== undefined).map((s) => [s.supply, s.machine.name, s.count]);
/** Invariant errors of a plan (tests/helpers/plan-invariants.ts): a correct plan has none. */
const errors = (settings: PlanSettings, plan: Plan) => checkPlanInvariants(pack, settings, plan).filter((v) => v.severity === 'error');

describe('free-input supply steps', () => {
  it('adds a rock breaker sized to the rate', async () => {
    const settings = S({ target: 't:stone_dust@0', tier: 1, amount: 150, per: 'min' });
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    // 2.5 cobblestone a second; an LV rock breaker makes one every 16 ticks (1.25 a second).
    expect(supplySteps(plan)).toEqual([[COBBLE, 'Basic Rock Breaker', 2]]);
    const breaker = plan.steps.find((s) => s.supply === COBBLE)!;
    expect(breaker).toMatchObject({ euPerTick: 30, durationTicks: 16, outputs: [{ key: COBBLE, amount: 1, chance: 1 }] });
    expect(plan.rawInputs).toEqual([]);
    expect(plan.buildList.find((l) => l.key === 'machine:441@0')).toMatchObject({ amount: 2, group: 'machines' });
    expect(plan.buildSteps.find((b) => b.id === `configure:${breaker.id}`)).toMatchObject({
      kind: 'configure', text: 'Place water and lava next to the Basic Rock Breaker that makes Cobblestone',
    });
    expect(errors(settings, plan)).toEqual([]);
  });

  it('skips the generator when the group has a supply', async () => {
    const plan = await planLine(pack, S({ target: 't:stone_dust@0', tier: 1, amount: 150, per: 'min', haveSupply: [COBBLE] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(supplySteps(plan)).toEqual([]);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([[COBBLE, 'free']]);
    expect(plan.buildList.map((l) => l.key)).not.toContain('machine:441@0');
  });

  it('pumps water', async () => {
    const settings = S({ target: 't:washed@0', tier: 1, amount: 60, per: 'min' });
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    // 1,000 L a second; an LV pump moves 1,000 L every 80 ticks (250 L a second; ULV recipes get no overclock at LV).
    expect(supplySteps(plan)).toEqual([['fluid:water', 'Basic Pump', 4]]);
    expect(plan.rawInputs.map((r) => r.key)).toEqual(['t:iron_dust@0']);
    const pump = plan.steps.find((s) => s.supply === 'fluid:water')!;
    expect(plan.buildSteps.find((b) => b.id === `configure:${pump.id}`)?.text).toBe('Put the Basic Pump over an infinite water source (a 2×2 pool)');
    expect(plan.buildList.find((l) => l.key === 'machine:1140@0')).toMatchObject({ amount: 4, group: 'machines' });
    expect(errors(settings, plan)).toEqual([]);
  });

  it('plans nitrogen from air with nothing bought', async () => {
    const settings = S({ target: 'fluid:nitrogen', tier: 1, amount: 390, per: 'min' });
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(expect.arrayContaining(['air-n2', 'compress-air', 'release-air']));
    expect(plan.rawInputs.map((r) => r.key)).not.toContain('fluid:air');
    expect(plan.rawInputs).toEqual([]);   // the cells go round: the compressor fills what the canner empties
    expect(plan.warnings.map((w) => w.code)).not.toContain('free-loop');
    expect(plan.steps.find((s) => s.id === 'compress-air')?.supply).toBe('fluid:air');
    expect(plan.buildSteps.filter((b) => b.kind === 'configure')).toEqual([]);   // a compressor needs no setting up
    expect(plan.buildSteps.at(-1)?.text).toBe('Run the line and check it makes 390 L Nitrogen per minute');
    expect(errors(settings, plan)).toEqual([]);
  });

  it('buys cobblestone free at ULV', async () => {
    const plan = await planLine(pack, S({ target: 'minecraft:gravel@0', tier: 0 }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['gravel-hand']);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([[COBBLE, 'free']]);
    expect(supplySteps(plan)).toEqual([]);
  });

  it('plans no supply step in Make N', async () => {
    const plan = await planLine(pack, S({ target: 'minecraft:gravel@0', tier: 1, mode: 'makeN', amount: 64 }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(supplySteps(plan)).toEqual([]);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([[COBBLE, 'free']]);
  });
});

describe('the invariant checker', () => {
  it('counts what a supply step makes as free input (ruling P5)', async () => {
    // A rock breaker's stone hammered into gravel, a gathered block, replaces gathering it: a free detour. The step that
    // turns the gravel into something no one gathers ends the chain and is none (spec §7.2).
    const settings = S({ target: 't:stone_dust@0', tier: 1, amount: 150, per: 'min' });
    const plan = await planLine(pack, settings, emptyContext());
    const { supply: _ignored, ...like } = plan.steps[0]!;
    const step = (id: string, inputs: string[], outputs: string[], supply?: string): PlanStep => ({
      ...like, id, recipeId: id, runsPerSecond: 1, alternatives: [],
      inputs: inputs.map((key) => ({ key, amount: 1, chance: 1 })), outputs: outputs.map((key) => ({ key, amount: 1, chance: 1 })),
      ...(supply === undefined ? {} : { supply }),
    });
    const stone = 'minecraft:stone@0';
    const chain: Plan = {
      ...plan, rawInputs: [],
      steps: [step('breaker', [], [stone], stone), step('hammer', [stone], ['minecraft:gravel@0']), step('use', ['minecraft:gravel@0'], ['t:stone_dust@0'])],
    };
    const detours = freeDetours(pack, chain, planBasis(pack, settings, emptyContext()));
    expect(detours.map((d) => [d.product, d.steps])).toEqual([['minecraft:gravel@0', ['hammer']]]);
    // Without the supply, stone is no free input and the hammer no detour.
    const plain: Plan = { ...chain, steps: chain.steps.map(({ supply: _supply, ...s }) => s) };
    expect(freeDetours(pack, plain, planBasis(pack, settings, emptyContext()))).toEqual([]);
  });
});
