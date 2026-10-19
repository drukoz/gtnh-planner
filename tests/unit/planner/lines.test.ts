// Supporting lines (fix spec R6, architecture §11.27 and §11.32): the steps behind a derived material the main line uses
// are tagged with that material's line, so the flow diagram can group them and the group can say "we already make it".

import { describe, expect, it } from 'vitest';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { supportingLines } from '../../../src/server/planner/lines.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { OreVein, Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const vein = (material: string): OreVein => ({ name: `ore.mix.${material}`, dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
  materials: { primary: material, secondary: material, between: material, sporadic: material } });

const RED_ALLOY = 'fluid:molten.redalloy';

/**
 * A wire assembled from 72 L of molten red alloy (`takes: 'ingot'`: one red alloy ingot), a copper ingot and 100 L of
 * glue. Red alloy ingots are alloyed from mined copper and redstone and melted down; glue is spun out of mined resin in
 * one step.
 */
function wirePack(takes: 'molten' | 'ingot' = 'molten'): Pack {
  const alloy: [string, number] = takes === 'molten' ? [RED_ALLOY, 72] : ['t:redalloy_ingot@0', 1];
  const p = packFromSpec({
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
      { id: 'wire-asm', map: 'gt.recipe.assembler', in: [alloy, ['t:copper_ingot@0', 1], ['fluid:glue', 100]], out: [['t:wire@0', 1]], eut: 16 },
      { id: 'glue', map: 'gt.recipe.centrifuge', in: [['t:resin@0', 1]], out: [['fluid:glue', 100]], eut: 16 },
    ],
    worldgen: { veins: ['Copper', 'Redstone', 'Resin'].map(vein) },
  });
  p.materials.get('RedAlloy')!.displayName = 'Red Alloy';
  return p;
}

const pack = wirePack();
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:wire@0', tier: 1, ...p });
const lineOf = (plan: Plan, id: string) => plan.steps.find((s) => s.id === id)?.line;

describe('supporting lines', () => {
  it('groups the steps behind a material into its line', async () => {
    const plan = await planLine(pack, S(), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['alloy-ra', 'glue', 'wire-asm', 'x-ra']);
    expect(lineOf(plan, 'alloy-ra')).toEqual({ key: RED_ALLOY, name: 'Red Alloy' });
    expect(lineOf(plan, 'x-ra')).toEqual({ key: RED_ALLOY, name: 'Red Alloy' });
    expect(lineOf(plan, 'wire-asm')).toBeUndefined();
    // The same map straight from the plan, by step id.
    const lines = supportingLines(pack, plan, planBasis(pack, S(), emptyContext()));
    expect([...lines]).toEqual([['alloy-ra', { key: RED_ALLOY, name: 'Red Alloy' }], ['x-ra', { key: RED_ALLOY, name: 'Red Alloy' }]]);
  });
  it('leaves a one-step fluid in the main line', async () => {
    const plan = await planLine(pack, S(), emptyContext());
    expect(lineOf(plan, 'glue')).toBeUndefined();
  });
  it('drops a line the group already makes', async () => {
    const plan = await planLine(pack, S({ stopItems: [RED_ALLOY] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['glue', 'wire-asm']);
    expect(plan.steps.filter((s) => s.line !== undefined)).toEqual([]);
    expect(plan.rawInputs.find((r) => r.key === RED_ALLOY)?.leafClass).toBe('stop');
  });
  it('names a line after the GT material of its item root, keeps a one-step item line, and tags a batch too', async () => {
    // The wire takes red alloy ingots themselves: the alloy smelter alone is the Red Alloy line (only fluid roots of one
    // step stay in the main line). A Make N batch is tagged the same way.
    const p = wirePack('ingot');
    for (const settings of [S(), S({ mode: 'makeN', amount: 3 })]) {
      const plan = await planLine(p, settings, emptyContext());
      expect(plan.status).toBe('ok');
      expect(plan.steps.map((s) => [s.id, s.line])).toEqual([
        ['alloy-ra', { key: 't:redalloy_ingot@0', name: 'Red Alloy' }], ['glue', undefined], ['wire-asm', undefined]]);
    }
  });
});
