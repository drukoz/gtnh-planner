// Leaf rules and import provenance (plan 09 Task 2; fix spec R1, R5–R8): gathered world blocks are natural leaves,
// fluids are bought only where a source is reachable, ore blocks only for material lines, derived materials only when
// shallow and never below their plain price, and every bought one names the chain it stands for.

import { describe, it, expect } from 'vitest';
import { withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type IngredientSpec, type ItemSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { DimensionInfo, FluidSource, OreVein } from '../../../src/shared/types/pack.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

/**
 * Build cost ignored (plan 12): these cases predate it. Their packs' machines get a build recipe (`withBuildRecipes`,
 * ruling P3), as controller Amendment OQ3 never plans a machine no recipe makes as a new one.
 */
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), buildHorizonHours: null, ...p });
const OVERWORLD: DimensionInfo = { key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 };
/** An overworld vein of one material. */
const vein = (material: string): OreVein => ({ name: `ore.mix.${material.toLowerCase()}`, dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255,
  size: 1, density: 1, materials: { primary: material, secondary: material, between: material, sporadic: material } });
const dust = (key: string, name: string, material: string): ItemSpec => ({ key, name, gt: { prefix: 'dust', material } });

describe('gathered world blocks (R1)', () => {
  it('imports sand and makes molten glass from it', async () => {
    // Before: sand was no leaf, and free cobblestone made it through gravel crafted by hand and a forge hammer.
    const p = packFromSpec(withBuildRecipes({
      items: [{ key: 'minecraft:sand@0', name: 'Sand', oreDict: ['sand'] }, { key: 'minecraft:cobblestone@0', name: 'Cobblestone' },
              { key: 'minecraft:gravel@0', name: 'Gravel' }, { key: 't:glass_tube@0', name: 'Glass Tube' }],
      fluids: [{ key: 'fluid:molten.glass', name: 'Molten Glass' }],
      maps: [{ id: 'crafting', name: 'Crafting' }, { id: 'gt.recipe.hammer', name: 'Forge Hammer' }, { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor' },
             { id: 'gt.recipe.fluidsolidifier', name: 'Fluid Solidifier' }],
      machines: [{ mteId: 1, name: 'Basic Forge Hammer', maps: ['gt.recipe.hammer'], tier: 1 },
                 { mteId: 2, name: 'Advanced Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 2 },
                 { mteId: 3, name: 'Basic Fluid Solidifier', maps: ['gt.recipe.fluidsolidifier'], tier: 1 }],
      recipes: [{ id: 'gravel-hand', map: 'crafting', in: [['minecraft:cobblestone@0', 1]], out: [['minecraft:gravel@0', 1]] },
                { id: 'sand-hammer', map: 'gt.recipe.hammer', in: [['minecraft:gravel@0', 1]], out: [['minecraft:sand@0', 1]], eut: 16 },
                { id: 'extract-glass', map: 'gt.recipe.fluidextractor', in: [['minecraft:sand@0', 1]], out: [['fluid:molten.glass', 144]], eut: 48, dur: 200 },
                { id: 'solidify-tube', map: 'gt.recipe.fluidsolidifier', in: [['fluid:molten.glass', 144]], out: [['t:glass_tube@0', 1]], eut: 8 }],
    }, [2, 3]));
    const plan = await planLine(p, S({ target: 't:glass_tube@0', tier: 2, amount: 1, per: 'min' }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['extract-glass', 'solidify-tube']);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['minecraft:sand@0', 'natural']]);
    expect(plan.rawInputs[0]?.sources).toEqual([{ kind: 'natural', dims: ['overworld'], detail: 'gathered (dig it)' }]);
    expect(plan.flows.filter((f) => f.key === 'minecraft:cobblestone@0')).toEqual([]);
  });
  it('gathers End stone only where the End is reachable', () => {
    const p = packFromSpec({
      items: [{ key: 'minecraft:end_stone@0', name: 'End Stone' }],
      worldgen: { dimensions: [OVERWORLD, { key: 'theend', id: 1, name: 'The End', mod: 'minecraft', kind: 'dimension', defaultTier: 3 }] },
    });
    const hv = planBasis(p, S({ tier: 3 }), emptyContext()).avail;
    expect(hv.classOf('minecraft:end_stone@0')).toBe('natural');
    expect(hv.sources('minecraft:end_stone@0')).toEqual([{ kind: 'natural', dims: ['theend'], detail: 'gathered (dig it)' }]);
    expect(planBasis(p, S({ tier: 2 }), emptyContext()).avail.classOf('minecraft:end_stone@0')).not.toBe('natural');
  });
});

describe('fluids only where a source is reachable (R5)', () => {
  it('makes a fluid whose only source is out of reach', async () => {
    const pack = (source: FluidSource) => packFromSpec(withBuildRecipes({
      items: [dust('t:sugar@0', 'Sugar Dust', 'Sugar'), { key: 't:widget@0', name: 'Widget' }],
      fluids: [{ key: 'fluid:ethylene', name: 'Ethylene', gas: true }],
      maps: [{ id: 'gt.recipe.chemicalreactor', name: 'Chemical Reactor' }],
      machines: [{ mteId: 1, name: 'Basic Chemical Reactor', maps: ['gt.recipe.chemicalreactor'], tier: 1 }],
      recipes: [{ id: 'make-ethylene', map: 'gt.recipe.chemicalreactor', in: [['t:sugar@0', 2]], out: [['fluid:ethylene', 1000]], eut: 30 },
                { id: 'polymerize', map: 'gt.recipe.chemicalreactor', in: [['fluid:ethylene', 1000]], out: [['t:widget@0', 1]], eut: 30 }],
      worldgen: {
        dimensions: [OVERWORLD, { key: 'triton', id: 86, name: 'Triton', mod: 'galaxyspace', kind: 'moon', rocketTier: 7, defaultTier: 9 }],
        veins: [vein('Sugar')], fluidSources: [source],
      },
    }));
    const far = pack({ fluid: 'fluid:ethylene', dims: ['triton'], kind: 'underground', minTier: 0 });
    for (const routeDerived of [false, true]) {
      const plan = await planLine(far, S({ target: 't:widget@0', tier: 1, routeDerived }), emptyContext());
      expect(plan.rawInputs.map((r) => r.key), `routeDerived ${routeDerived}`).not.toContain('fluid:ethylene');
      expect(plan.steps.map((s) => s.id), `routeDerived ${routeDerived}`).toContain('make-ethylene');
    }
    const near = pack({ fluid: 'fluid:ethylene', dims: ['overworld'], kind: 'underground', minTier: 0 });
    const plan = await planLine(near, S({ target: 't:widget@0', tier: 1 }), emptyContext());
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['fluid:ethylene', 'direct']]);
    expect(plan.steps.map((s) => s.id)).toEqual(['polymerize']);
  });
});

describe('ore blocks only for material lines (R8)', () => {
  it('buys ore blocks only for a material line', async () => {
    // Leaching an ore gives the acid a widget takes and copper dust beside it; burning sulfur gives half as much. Ruling
    // P9: the leach draws more power than the macerator, so the copper-dust line takes the macerator at the tie.
    const p = packFromSpec(withBuildRecipes({
      items: [{ key: 't:cu_ore@0', name: 'Copper Ore', gt: { prefix: 'ore', material: 'Copper' } }, dust('t:cu_dust@0', 'Copper Dust', 'Copper'),
              dust('t:s_dust@0', 'Sulfur Dust', 'Sulfur'), { key: 't:widget@0', name: 'Widget' }],
      fluids: [{ key: 'fluid:acid', name: 'Acid' }],
      maps: [{ id: 'gt.recipe.chemicalbath', name: 'Chemical Bath' }, { id: 'gt.recipe.chemicalreactor', name: 'Chemical Reactor' },
             { id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'gt.recipe.macerator', name: 'Macerator' }],
      machines: [{ mteId: 1, name: 'Basic Chemical Bath', maps: ['gt.recipe.chemicalbath'], tier: 1 },
                 { mteId: 2, name: 'Basic Chemical Reactor', maps: ['gt.recipe.chemicalreactor'], tier: 1 },
                 { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }, { mteId: 4, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'leach', map: 'gt.recipe.chemicalbath', in: [['t:cu_ore@0', 1]], out: [['fluid:acid', 1000], ['t:cu_dust@0', 2]], eut: 30, dur: 100 },
                { id: 'burn', map: 'gt.recipe.chemicalreactor', in: [['t:s_dust@0', 1]], out: [['fluid:acid', 500]], eut: 30 },
                { id: 'widget', map: 'gt.recipe.assembler', in: [['fluid:acid', 1000]], out: [['t:widget@0', 1]], eut: 16 },
                { id: 'mace-cu', map: 'gt.recipe.macerator', in: [['t:cu_ore@0', 1]], out: [['t:cu_dust@0', 2]], eut: 2, dur: 100 }],
      worldgen: { veins: [vein('Copper'), vein('Sulfur')] },
    }));
    const widget = await planLine(p, S({ target: 't:widget@0', tier: 1 }), emptyContext());
    expect(widget.rawInputs.map((r) => r.key)).toEqual(['t:s_dust@0']);
    const copper = await planLine(p, S({ target: 't:cu_dust@0', tier: 1 }), emptyContext());
    expect(copper.rawInputs.map((r) => r.key)).toEqual(['t:cu_ore@0']);
    expect(copper.steps.map((s) => s.id)).toEqual(['mace-cu']);
  });
});

describe('derived materials (R6, R7)', () => {
  it('buys only shallow derived materials when supporting lines are off', async () => {
    // d0 is mined; mix-n makes dn from d(n-1), so dn is n recipe layers deep. Ruling P8: d4 (depth 4) is the deepest
    // material bought, and a leaf is never expanded, so the line to t buys d4 and mixes d5 itself.
    const mix = (n: number): RecipeSpec => ({ id: `mix-${n}`, map: 'gt.recipe.mixer', in: [[`t:d${n - 1}@0`, 1]], out: [[`t:d${n}@0`, 1]], eut: 8 });
    const p = packFromSpec(withBuildRecipes({
      items: [0, 1, 2, 3, 4, 5].map((n) => dust(`t:d${n}@0`, `D${n} Dust`, `M${n}`)).concat([{ key: 't:u@0', name: 'U Part' }, { key: 't:t@0', name: 'T Part' }]),
      maps: [{ id: 'gt.recipe.mixer', name: 'Mixer' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Mixer', maps: ['gt.recipe.mixer'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [...[1, 2, 3, 4, 5].map(mix),
                { id: 'use-u', map: 'gt.recipe.assembler', in: [['t:d1@0', 1]], out: [['t:u@0', 1]], eut: 16 },
                { id: 'use-t', map: 'gt.recipe.assembler', in: [['t:d5@0', 1]], out: [['t:t@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('M0')] },
    }));
    const t = await planLine(p, S({ target: 't:t@0', tier: 1, routeDerived: false }), emptyContext());
    expect(t.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:d4@0', 'derived']]);
    expect(t.steps.map((s) => s.id)).toEqual(['mix-5', 'use-t']);
    const u = await planLine(p, S({ target: 't:u@0', tier: 1, routeDerived: false }), emptyContext());
    expect(u.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:d1@0', 'derived']]);
    expect(u.steps.map((s) => s.id)).toEqual(['use-u']);
    // Default settings (supporting lines) make both from the mined d0.
    const routed = await planLine(p, S({ target: 't:u@0', tier: 1 }), emptyContext());
    expect(routed.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:d0@0', 'direct']]);
    expect(routed.steps.map((s) => s.id)).toEqual(['mix-1', 'use-u']);
    const deep = await planLine(p, S({ target: 't:t@0', tier: 1 }), emptyContext());
    expect(deep.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:d0@0', 'direct']]);
    expect(deep.steps.map((s) => s.id)).toEqual(['mix-1', 'mix-2', 'mix-3', 'mix-4', 'mix-5', 'use-t']);
  });
  it('never prices a derived leaf below its plain price and names the chain behind it', async () => {
    // One mined M dust smelts into two Cheap ingots: its chain costs 0.5 an ingot, its plain price is 1.
    const p = packFromSpec(withBuildRecipes({
      items: [dust('t:m@0', 'M Dust', 'M'), { key: 't:cheap@0', name: 'Cheap Ingot', gt: { prefix: 'ingot', material: 'Cheap' } }, { key: 't:thing@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'smelt2', map: 'gt.recipe.alloysmelter', in: [['t:m@0', 1]], out: [['t:cheap@0', 2]], eut: 16 },
                { id: 'use', map: 'gt.recipe.assembler', in: [['t:cheap@0', 1]], out: [['t:thing@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('M')] },
    }));
    const plan = await planLine(p, S({ target: 't:thing@0', tier: 1, amount: 60, per: 'min', routeDerived: false }), emptyContext());
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:cheap@0', 'derived']]);
    const raw = plan.rawInputs[0]!;
    expect(raw.cost / raw.perSecond).toBeCloseTo(1, 9);
    expect(raw.pricedVia).toEqual({ recipeId: 'smelt2', mapId: 'gt.recipe.alloysmelter', inputs: ['t:m@0'], steps: 1 });
    expect(raw.sources).toEqual([{ kind: 'derived', dims: [], detail: 'made by Alloy Smelter from M Dust (1 recipe in all)' }]);
    // The client names that chain from the plan alone (the step panel's "Bought: usually made by …"): no step runs it.
    expect(plan.names).toMatchObject({ 'map:gt.recipe.alloysmelter': 'Alloy Smelter', 't:m@0': 'M Dust' });
  });
  it('names every derived material it buys in one warning', async () => {
    // Fix spec R7: no cut-off after five names (the client shows each as a chip).
    const alloys = [1, 2, 3, 4, 5, 6];
    const p = packFromSpec(withBuildRecipes({
      items: [dust('t:x@0', 'X Dust', 'X'), { key: 't:widget@0', name: 'Widget' },
              ...alloys.map((n): ItemSpec => ({ key: `t:a${n}@0`, name: `Alloy ${n} Ingot`, gt: { prefix: 'ingot', material: `A${n}` } }))],
      maps: [{ id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [...alloys.map((n): RecipeSpec => ({ id: `alloy-${n}`, map: 'gt.recipe.alloysmelter', in: [['t:x@0', 1]], out: [[`t:a${n}@0`, 1]], eut: 16 })),
                { id: 'widget', map: 'gt.recipe.assembler', in: alloys.map((n): IngredientSpec => [`t:a${n}@0`, 1]), out: [['t:widget@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('X')] },
    }));
    const plan = await planLine(p, S({ target: 't:widget@0', tier: 1, routeDerived: false }), emptyContext());
    expect(plan.rawInputs.map((r) => r.leafClass)).toEqual(alloys.map(() => 'derived'));
    expect(plan.warnings.filter((w) => w.code === 'derived-leaf')).toEqual([{ code: 'derived-leaf', key: 't:a1@0',
      text: 'Alloy 1 Ingot, Alloy 2 Ingot, Alloy 3 Ingot, Alloy 4 Ingot, Alloy 5 Ingot and Alloy 6 Ingot are not mined anywhere you can reach; '
        + 'the line buys them made from other materials (see their sources). Plan them as supporting lines to include their chains.' }]);
  });
  it('describes a stopped fluid by its chemistry, not a canner', async () => {
    // Availability first reaches Ethylene by a canner emptying the Ethylene Cell a dehydrator makes from sugar.
    const p = packFromSpec(withBuildRecipes({
      items: [dust('t:sugar@0', 'Sugar Dust', 'Sugar'), { key: 't:tin@0', name: 'Tin Ingot', gt: { prefix: 'ingot', material: 'Tin' } },
              { key: 't:empty_cell@0', name: 'Empty Cell' }, { key: 't:ethylene_cell@0', name: 'Ethylene Cell' }, { key: 't:widget@0', name: 'Widget' }],
      fluids: [{ key: 'fluid:ethylene', name: 'Ethylene', gas: true }],
      fluidContainers: [{ container: 't:ethylene_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:ethylene', amount: 1000 }],
      maps: [{ id: 'gt.recipe.chemicaldehydrator', name: 'Dehydrator' }, { id: 'gt.recipe.canner', name: 'Canner' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Dehydrator', maps: ['gt.recipe.chemicaldehydrator'], tier: 1 },
                 { mteId: 2, name: 'Basic Canner', maps: ['gt.recipe.canner'], tier: 1 }, { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'cell', map: 'gt.recipe.assembler', in: [['t:tin@0', 2]], out: [['t:empty_cell@0', 1]], eut: 16 },
                { id: 'dehydrate', map: 'gt.recipe.chemicaldehydrator', in: [['t:sugar@0', 2], ['t:empty_cell@0', 1]], out: [['t:ethylene_cell@0', 1]], eut: 30 },
                { id: 'empty-cell', map: 'gt.recipe.canner', in: [['t:ethylene_cell@0', 1]], out: [['fluid:ethylene', 1000], ['t:empty_cell@0', 1]], eut: 4 },
                { id: 'polymerize', map: 'gt.recipe.assembler', in: [['fluid:ethylene', 1000]], out: [['t:widget@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('Sugar'), vein('Tin')] },
    }));
    const plan = await planLine(p, S({ target: 't:widget@0', tier: 1, stopItems: ['fluid:ethylene'] }), emptyContext());
    const raw = plan.rawInputs.find((r) => r.key === 'fluid:ethylene');
    expect(raw?.leafClass).toBe('stop');
    expect(raw?.sources).toEqual([{ kind: 'derived', dims: [], detail: 'made by Dehydrator from Sugar Dust, Empty Cell' }]);
    expect(raw?.pricedVia).toMatchObject({ recipeId: 'dehydrate', mapId: 'gt.recipe.chemicaldehydrator' });
  });
  it('says whether the group can make an import', async () => {
    const plan = await planLine(miniGt(), S({ target: 't:circuit@0', tier: 1, amount: 30 }), emptyContext());
    const canMake = (key: string) => plan.rawInputs.find((r) => r.key === key)?.canMake;
    expect(canMake('t:copper_ingot@0')).toBe(false);   // only lava-copper makes it, and that needs an MV centrifuge
    expect(canMake('t:iron_ingot@0')).toBe(true);
  });
});
