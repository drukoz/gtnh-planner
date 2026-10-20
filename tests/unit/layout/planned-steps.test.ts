// Plan 09's planner steps in Plan 5's layout (the merge of plan 09 with Plan 5; architecture §11.31, §11.32): the steps
// the planner adds for free inputs (`PlanStep.supply`: a rock breaker's cobblestone, a pump's water) and the steps of a
// supporting line (`PlanStep.line`) are laid out like any machine step: one machine block per machine still to build,
// none left out as unknown, with the supply step's placing note kept among the merged build steps and sent to Plan 6's
// projector with the rest of the placed line.

import { describe, expect, it } from 'vitest';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { mergeLayoutIntoPlan } from '../../../src/server/layout/merge.ts';
import { projectorPayload } from '../../../src/server/projector/payload.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { OreVein } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import { addLineParts, areaReader, flatVoxels, makeProject, makeScan } from '../../helpers/layout-fixtures.ts';
import { withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { MINI_GT } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';

const COBBLE = 'minecraft:cobblestone@0';
const DISPLAY = 'gregtech:gt.metaitem.02@32765#abcdefabcdef';
const RED_ALLOY = 'fluid:molten.redalloy';

/**
 * Mini-GT with a rock breaker, a pump and a chemical bath: stone dust takes cobblestone, washed iron dust water. Its
 * machines can all be built (ruling P3: plan 12 never plans a machine no recipe makes as a new one), as can WIRE's.
 */
const SUPPLY: PackSpec = withBuildRecipes({
  ...MINI_GT,
  items: [
    ...MINI_GT.items!, { key: DISPLAY, name: 'IT\'S FREE! Place Lava on Side' }, { key: 't:stone_dust@0', name: 'Stone Dust' },
    { key: 't:washed@0', name: 'Washed Iron Dust' },
  ],
  maps: [...MINI_GT.maps!, { id: 'gt.recipe.rockbreaker', name: 'Rock Breaker' }, { id: 'gt.recipe.chemicalbath', name: 'Chemical Bath' }],
  machines: [
    ...MINI_GT.machines!,
    { mteId: 441, name: 'Basic Rock Breaker', maps: ['gt.recipe.rockbreaker'], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTERockBreaker' },
    { mteId: 1140, name: 'Basic Pump', maps: [], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTEPump' },
    { mteId: 471, name: 'Basic Chemical Bath', maps: ['gt.recipe.chemicalbath'], tier: 1 },
  ],
  recipes: [
    ...MINI_GT.recipes!,
    { id: 'fake-cobble', map: 'gt.recipe.rockbreaker', in: [[DISPLAY, 1]], out: [[COBBLE, 1]], eut: 30, dur: 16, flags: { fake: true } },
    { id: 'mace-cobble', map: 'gt.recipe.macerator', in: [[COBBLE, 1]], out: [['t:stone_dust@0', 1]], eut: 2, dur: 40 },
    { id: 'wash', map: 'gt.recipe.chemicalbath', in: [['t:iron_dust@0', 1], ['fluid:water', 1000]], out: [['t:washed@0', 1]], eut: 8, dur: 20 },
  ],
});

const vein = (material: string): OreVein => ({ name: `ore.mix.${material}`, dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
  materials: { primary: material, secondary: material, between: material, sporadic: material } });

/** A wire assembled from molten red alloy (alloyed from mined copper and redstone, then melted: its supporting line). */
const WIRE: PackSpec = withBuildRecipes({
  items: [
    { key: 't:copper_ingot@0', name: 'Copper Ingot', gt: { prefix: 'ingot', material: 'Copper' } },
    { key: 't:redstone@0', name: 'Redstone', gt: { prefix: 'dust', material: 'Redstone' } },
    { key: 't:redalloy_ingot@0', name: 'Red Alloy Ingot', gt: { prefix: 'ingot', material: 'RedAlloy' } },
    { key: 't:resin@0', name: 'Sticky Resin', gt: { prefix: 'dust', material: 'Resin' } },
    { key: 't:wire@0', name: 'Red Alloy Wire' },
  ],
  fluids: [{ key: RED_ALLOY, name: 'Molten Red Alloy' }, { key: 'fluid:glue', name: 'Glue' }],
  maps: [
    { id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' }, { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor' },
    { id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'gt.recipe.centrifuge', name: 'Centrifuge' },
  ],
  machines: [
    { mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 },
    { mteId: 2, name: 'Basic Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 1 },
    { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
    { mteId: 4, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 },
  ],
  recipes: [
    { id: 'alloy-ra', map: 'gt.recipe.alloysmelter', in: [['t:copper_ingot@0', 1], ['t:redstone@0', 4]], out: [['t:redalloy_ingot@0', 1]], eut: 16 },
    { id: 'x-ra', map: 'gt.recipe.fluidextractor', in: [['t:redalloy_ingot@0', 1]], out: [[RED_ALLOY, 144]], eut: 16 },
    { id: 'wire-asm', map: 'gt.recipe.assembler', in: [[RED_ALLOY, 72], ['t:copper_ingot@0', 1], ['fluid:glue', 100]], out: [['t:wire@0', 1]], eut: 16 },
    { id: 'glue', map: 'gt.recipe.centrifuge', in: [['t:resin@0', 1]], out: [['fluid:glue', 100]], eut: 16 },
  ],
  worldgen: { veins: ['Copper', 'Redstone', 'Resin'].map(vein) },
});

const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), tier: 1, logistics: 'direct', buildHorizonHours: null, ...p });

/** The line planned on `spec`'s pack, and laid out (no world scan yet) on the same pack with the fixture line parts. */
async function planAndLayOut(spec: PackSpec, settings: PlanSettings): Promise<{ plan: Plan; layout: Layout; nameOf: (k: string) => string }> {
  const plan = await planLine(packFromSpec(structuredClone(spec)), settings, emptyContext());
  const pack = addLineParts(packFromSpec(structuredClone(spec)));
  const layout = await layoutLine(pack, plan, emptyScan(), { ...makeProject({ scanId: null, baseId: null }), settings });
  return { plan, layout, nameOf: (k) => pack.nameOf(k) };
}

/** Per machine step: its id, the machines still to build and the machine blocks the layout placed for it. */
function machinesPerStep(plan: Plan, layout: Layout): Array<[string, number, number]> {
  return plan.steps.filter((s) => !s.handCraft && s.machine.mteId >= 0)
    .map((s): [string, number, number] => [s.id, s.count - s.owned, layout.blocks.filter((b) => b.role === 'machine' && b.stepId === s.id).length]);
}

describe('plan 09 steps in the line layout', () => {
  it('lays out the rock breaker and the pump that supply free inputs like any machine step', async () => {
    const stone = await planAndLayOut(SUPPLY, S({ target: 't:stone_dust@0', amount: 150, per: 'min' }));
    const breaker = stone.plan.steps.find((s) => s.supply === COBBLE);
    expect(breaker?.machine.name).toBe('Basic Rock Breaker');
    expect(machinesPerStep(stone.plan, stone.layout)).toEqual([[breaker!.id, 2, 2], ['mace-cobble', 5, 5]]);
    expect(stone.layout.warnings.map((w) => w.code)).not.toContain('unknown_machine');
    // the planner's note on where the rock breaker must stand stays among the merged build steps
    expect(mergeLayoutIntoPlan(stone.plan, stone.layout, null, stone.nameOf).buildSteps).toContainEqual(expect.objectContaining({
      id: `configure:${breaker!.id}`, kind: 'configure', text: 'Place water and lava next to the Basic Rock Breaker that makes Cobblestone' }));

    const washed = await planAndLayOut(SUPPLY, S({ target: 't:washed@0', amount: 60, per: 'min' }));
    const pump = washed.plan.steps.find((s) => s.supply === 'fluid:water');
    expect(pump?.machine.name).toBe('Basic Pump');
    expect(machinesPerStep(washed.plan, washed.layout)).toEqual([[pump!.id, 4, 4], ['wash', 1, 1]]);
    expect(washed.layout.warnings.map((w) => w.code)).not.toContain('unknown_machine');
    // the pumps' water is piped to the chemical bath like any step's fluid output
    expect(washed.layout.buildSteps.map((b) => b.text)).toContainEqual(expect.stringContaining('Fluid Pipe for Water'));
    expect(mergeLayoutIntoPlan(washed.plan, washed.layout, null, washed.nameOf).buildSteps.map((b) => b.text))
      .toContain('Put the Basic Pump over an infinite water source (a 2×2 pool)');
  });

  it('sends a placed supply step to the projector like any machine step', async () => {
    const settings = S({ target: 't:stone_dust@0', amount: 150, per: 'min' });
    const plan = await planLine(packFromSpec(structuredClone(SUPPLY)), settings, emptyContext());
    const pack = addLineParts(packFromSpec(structuredClone(SUPPLY)));
    const project = { ...makeProject(), settings };
    const scan = makeScan({ power: [{ voltageTier: 1, average: 1000, loadEUt: 0, taps: [{ pos: [0, 64, 30], freeAmps: 8 }] }] });
    const vox = flatVoxels({ origin: [-40, 50, -40], size: [100, 30, 100], groundY: 63 });
    const layout = await layoutLine(pack, plan, scan, project, { readArea: areaReader(vox) });
    expect(layout.status).toBe('ok');
    const breaker = plan.steps.find((s) => s.supply === COBBLE)!;
    const payload = projectorPayload(project, layout, pack, plan.buildSteps);
    const breakers = payload.blocks.filter((b) => b.mteId === breaker.machine.mteId);
    expect(breakers).toHaveLength(2);
    expect(breakers.every((b) => b.role === 'machine' && b.step !== null)).toBe(true);
    expect(payload.steps.find((st) => st.id === `configure:${breaker.id}`)?.text).toBe('Place water and lava next to the Basic Rock Breaker that makes Cobblestone');
  });

  it('lays out the steps of a supporting line like any machine step', async () => {
    const { plan, layout } = await planAndLayOut(WIRE, S({ target: 't:wire@0' }));
    expect(plan.steps.filter((s) => s.line !== undefined).map((s) => [s.id, s.line!.key])).toEqual([['alloy-ra', RED_ALLOY], ['x-ra', RED_ALLOY]]);
    expect(machinesPerStep(plan, layout)).toEqual([['alloy-ra', 1, 1], ['glue', 1, 1], ['wire-asm', 1, 1], ['x-ra', 1, 1]]);
    expect(layout.warnings.map((w) => w.code)).not.toContain('unknown_machine');
  });
});
