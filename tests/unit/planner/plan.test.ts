import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { planLine, emptyContext, settingsHash, planCacheKey, PlanCache, powerSummary, batchShortWarning } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { OreVein } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
/** Supporting lines off (the default before plan 09): these cases buy derived materials. */
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), routeDerived: false, ...p });
/** An overworld vein of one material. */
const vein = (name: string, material: string): OreVein => ({ name, dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
  materials: { primary: material, secondary: material, between: material, sporadic: material } });

describe('planLine', () => {
  it('asks for a target first', async () => {
    const p = await planLine(pack, defaultSettings(), emptyContext());
    expect(p.status).toBe('empty');
    expect(p.warnings).toEqual([{ code: 'no-target', text: 'Pick something to make' }]);
  });
  it('plans 30 circuits per minute at LV', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', amount: 30, tier: 1 }), emptyContext());
    expect(p.status).toBe('ok');
    expect(p.steps.map((s) => s.id)).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    expect(p.rawInputs.map((r) => [r.key, r.perSecond, r.leafClass])).toEqual([
      ['t:copper_ingot@0', 0.5, 'direct'], ['t:iron_ingot@0', 0.5, 'direct'], ['t:redstone@0', 0.5, 'direct']]);
    // Each swap option says what one run takes and makes, by key; Plan.names names them and the map (StepPanel).
    expect(p.steps[0]?.alternatives).toEqual([
      { recipeId: 'bend-plate', rawCost: 1, mapId: 'gt.recipe.metalbender', inputs: [{ key: 't:iron_ingot@0', amount: 1 }], outputs: [{ key: 't:iron_plate@0', amount: 1 }] },
      { recipeId: 'hammer-plate', rawCost: 2, mapId: 'crafting', inputs: [{ key: 't:iron_ingot@0', amount: 2 }], outputs: [{ key: 't:iron_plate@0', amount: 1 }] }]);
    expect(p.names).toMatchObject({ 'map:gt.recipe.metalbender': 'Bending Machine', 'map:crafting': 'Crafting', 't:iron_ingot@0': 'Iron Ingot' });
    expect(p.power).toMatchObject({ peakEUt: 3 * 24 + 5 * 16 + 3 * 8, voltageTier: 1 });
    expect(p.buildSteps.at(-1)?.id).toBe('test');
    expect(p.exportId).toBe('test');
  });
  it('keeps a pinned recipe and still lists every alternative', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', tier: 2, recipeChoice: { 't:circuit@0': 'circuit-lv' } }), emptyContext());
    const step = p.steps.find((s) => s.mainOutput === 't:circuit@0')!;
    expect(step.recipeId).toBe('circuit-lv');
    expect(step.alternatives.map((a) => [a.recipeId, a.rawCost])).toEqual([['circuit-mv', 2.5], ['circuit-lv', 3]]);
  });
  it('drops a stale pin with a warning and still plans', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', tier: 2, recipeChoice: { 't:circuit@0': 'gone-after-reexport' } }), emptyContext());
    expect(p.status).toBe('ok');
    expect(p.warnings.map((w) => w.code)).toContain('stale-choice');
  });
  it('explains what blocks a target in plain words', async () => {
    const lv = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 1 }), emptyContext());
    expect(lv.status).toBe('infeasible');
    expect(lv.warnings).toEqual([{ code: 'no-recipe', key: 't:titanium_plate@0', text: 'Nothing at ≤ LV makes Titanium Plate (needs MV)' }]);
    const mv = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 2 }), emptyContext());
    expect(mv.unlocks).toEqual([{ key: 't:titanium_ingot@0', text: 'Titanium Ingot: needs Moon (T1 rocket) — reachable at HV' }]);
    const hv = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 3 }), emptyContext());
    expect(hv.rawInputs[0]).toMatchObject({ key: 't:titanium_ingot@0', sources: [{ kind: 'vein', dims: ['moon'], detail: 'ore.mix.ilmenite' }] });
  });
  it('uses visited dimensions and owned machines from the context', async () => {
    const ctx = { ...emptyContext(), visitedDims: ['moon'], ownedMachines: [{ mteId: 102, count: 1 }] };
    const p = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 2 }), ctx);
    expect(p.status).toBe('ok');
    expect(p.reachable).toContainEqual({ key: 'moon', why: 'visited' });
    expect(p.steps[0]).toMatchObject({ recipeId: 'bend-ti', owned: 1 });
  });
  it('plans Make N with time and totals', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', mode: 'makeN', amount: 10, tier: 1 }), emptyContext());
    expect(p.makeN?.totalSeconds).toBeCloseTo(115, 6);       // assembler 10 × 200 t = 100 s, plus 15 s to fill the chain
    // Ruling R3: 10 copper ingots (circuit-lv takes 2 copper wire, wire makes 2 per copper ingot).
    expect(p.rawInputs.map((r) => [r.key, r.total])).toEqual([['t:copper_ingot@0', 10], ['t:iron_ingot@0', 10], ['t:redstone@0', 10]]);
  });
  it('Make N lists only added machines in the build list', async () => {
    const ctx = { ...emptyContext(), ownedMachines: [{ mteId: 121, count: 2 }, { mteId: 101, count: 1 }] };
    const p = await planLine(pack, S({ target: 't:circuit@0', mode: 'makeN', amount: 10, tier: 1 }), ctx);
    const keys = p.buildList.map((l) => l.key);
    expect(p.buildList.find((l) => l.key === 'machine:111@0')?.amount).toBe(1);
    expect(keys).not.toContain('machine:121@0');
    expect(keys).not.toContain('machine:101@0');
  });
  it('declining reuse puts the machines back in the build list', async () => {
    const ctx = { ...emptyContext(), ownedMachines: [{ mteId: 121, count: 2 }] };
    const reuse = await planLine(pack, S({ target: 't:circuit@0', amount: 30, tier: 1 }), ctx);
    expect(reuse.buildList.find((l) => l.key === 'machine:121@0')?.amount).toBe(3);
    const declined = await planLine(pack, S({ target: 't:circuit@0', amount: 30, tier: 1, declineReuse: [121] }), ctx);
    expect(declined.buildList.find((l) => l.key === 'machine:121@0')?.amount).toBe(5);
    expect(declined.steps.find((s) => s.id === 'circuit-lv')?.owned).toBe(0);
  });
  it('fills foundAt from prospected veins', async () => {
    const ctx = { ...emptyContext(), prospected: [{ dim: 0, x: 8, z: 24, vein: 'ore.mix.iron' }] };
    const p = await planLine(pack, S({ target: 't:iron_plate@0', tier: 1 }), ctx);
    expect(p.rawInputs.find((r) => r.key === 't:iron_ingot@0')?.sources[0]?.foundAt).toEqual([{ dim: 0, x: 8, z: 24 }]);
    expect(p.names?.['dimId:0']).toBe('Overworld');
  });
  it('is deterministic (same solve 12 times)', async () => {
    const s = S({ target: 't:circuit@0', amount: 90, per: 'hour', tier: 2 });
    const first = JSON.stringify(await planLine(pack, s, emptyContext()));
    for (let i = 0; i < 11; i++) expect(JSON.stringify(await planLine(pack, s, emptyContext()))).toBe(first);
  });

  // Ruling R9 (architecture §11.20): what storage holds of a raw input, and where it sits, reaches RawInput.have.
  it('copies what storage holds, and where it sits, into have', async () => {
    const where = [{ kind: 'drawer', pos: [10, 64, -5] as [number, number, number], count: 64, reachable: true }];
    const ctx = { ...emptyContext(), storage: new Map([['t:iron_ingot@0', { total: 64, reachable: 64, where }]]) };
    const p = await planLine(pack, S({ target: 't:iron_plate@0', tier: 1 }), ctx);
    expect(p.rawInputs.find((r) => r.key === 't:iron_ingot@0')?.have).toEqual({ total: 64, reachable: 64, where });
  });
  it('names every key, the reachable dimensions and an unknown target', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', amount: 30, tier: 1 }), emptyContext());
    expect(p.names).toMatchObject({ 't:circuit@0': 'Basic Circuit', 't:copper_ingot@0': 'Copper Ingot', 't:hull_lv@0': 'LV Machine Hull',
      'gregtech:gt.integrated_circuit@2': 'Programmed Circuit', 'dim:overworld': 'Overworld', 'dim:nether': 'Nether' });
    expect(p.names?.['dim:moon']).toBeUndefined();
    expect(Object.keys(p.names ?? {})).toEqual(Object.keys(p.names ?? {}).sort());
    const unknown = await planLine(pack, S({ target: 't:not_exported@0' }), emptyContext());
    expect(unknown).toMatchObject({ status: 'empty', steps: [], exportId: 'test', tier: 1 });
    expect(unknown.warnings).toEqual([{ code: 'unknown-target', text: 'This item is not in the current recipe export' }]);
    expect(unknown.names?.['dim:overworld']).toBe('Overworld');
  });
  it('flags a derived raw material and says how to plan its chain', async () => {
    // Steel is mined nowhere: an alloy smelter makes its ingot from iron, so the line buys it as a derived leaf.
    const steel = packFromSpec({
      items: [{ key: 'iron@0', name: 'Iron Ingot', gt: { prefix: 'ingot', material: 'Iron' } },
              { key: 'steel@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } },
              { key: 'steel_plate@0', name: 'Steel Plate', gt: { prefix: 'plate', material: 'Steel' } }],
      maps: [{ id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' }, { id: 'gt.recipe.metalbender', name: 'Bending Machine' }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 },
                 { mteId: 2, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }],
      recipes: [{ id: 'steel', map: 'gt.recipe.alloysmelter', in: [['iron@0', 1]], out: [['steel@0', 1]], eut: 16 },
                { id: 'bend', map: 'gt.recipe.metalbender', in: [['steel@0', 1]], out: [['steel_plate@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('ore.mix.iron', 'Iron')] },
    });
    const p = await planLine(steel, S({ target: 'steel_plate@0', tier: 1 }), emptyContext());
    expect(p.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['steel@0', 'derived']]);
    // Fix spec R7: the source names the chain the purchase stands for, and the warning points at supporting lines.
    expect(p.warnings).toContainEqual({ code: 'derived-leaf', key: 'steel@0',
      text: 'Steel Ingot is not mined anywhere you can reach; it is made by Alloy Smelter from Iron Ingot (1 recipe in all). Plan them as supporting lines to include their chains.' });
    const routed = await planLine(steel, S({ target: 'steel_plate@0', tier: 1, routeDerived: true }), emptyContext());
    expect(routed.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['iron@0', 'direct']]);
    expect(routed.warnings.map((w) => w.code)).not.toContain('derived-leaf');
  });
  it('never buys a derived form of the target to make the target, and prices derived leaves at their chain', async () => {
    // Magnetic steel is made only from steel; demagnetizing it is the cheapest-looking way to "make" steel from a
    // bought leaf at the flat price of 1, but its chain runs through the target itself.
    const steel = packFromSpec({
      items: [{ key: 'iron@0', name: 'Iron Dust', gt: { prefix: 'dust', material: 'Iron' } }, { key: 'coal@0', name: 'Coal Dust', gt: { prefix: 'dust', material: 'Coal' } },
              { key: 'steel@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } },
              { key: 'magnetic@0', name: 'Magnetic Steel Ingot', gt: { prefix: 'ingot', material: 'SteelMagnetic' } },
              { key: 'steel_plate@0', name: 'Steel Plate', gt: { prefix: 'plate', material: 'Steel' } }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 },
                 { mteId: 2, name: 'Basic Polarizer', maps: ['gt.recipe.polarizer'], tier: 1 },
                 { mteId: 3, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }],
      recipes: [{ id: 'smelt', map: 'gt.recipe.alloysmelter', in: [['iron@0', 1], ['coal@0', 1]], out: [['steel@0', 1]], eut: 30, dur: 400 },
                { id: 'magnetize', map: 'gt.recipe.polarizer', in: [['steel@0', 1]], out: [['magnetic@0', 1]], eut: 16 },
                { id: 'demagnetize', map: 'gt.recipe.alloysmelter', in: [['magnetic@0', 1]], out: [['steel@0', 1]], eut: 2 },
                { id: 'bend', map: 'gt.recipe.metalbender', in: [['steel@0', 1]], out: [['steel_plate@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('ore.mix.iron', 'Iron'), vein('ore.mix.coal', 'Coal')] },
    });
    const p = await planLine(steel, S({ target: 'steel@0', tier: 1 }), emptyContext());
    expect(p.steps.map((s) => s.id)).toEqual(['smelt']);
    expect(p.rawInputs.map((r) => r.key)).toEqual(['coal@0', 'iron@0']);
    // Bought for a plate, steel costs what its chain costs (iron + coal), not the flat 1 of a base item.
    const plate = await planLine(steel, S({ target: 'steel_plate@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plate.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['steel@0', 'derived']]);
    expect(plate.rawInputs[0]?.cost).toBeCloseTo(2, 5);
  });
  it('names the target\'s own unlock when the walk only meets side roads', async () => {
    // Thing comes from its hot form (an EV freezer) or from molten Thing, which only Thing itself or Thing Bars (an HV
    // smelter) make: the walk only finds the bars, a side road; what the group needs is HV for Thing.
    const p = packFromSpec({
      items: [{ key: 'thing@0', name: 'Thing' }, { key: 'bars@0', name: 'Thing Bars' }, { key: 'hot@0', name: 'Hot Thing' }, { key: 'raw@0', name: 'Raw', gt: { prefix: 'dust', material: 'Raw' } }],
      machines: [{ mteId: 1, name: 'Basic Solidifier', maps: ['gt.recipe.fluidsolidifier'], tier: 1 }, { mteId: 2, name: 'Basic Extractor', maps: ['gt.recipe.fluidextractor'], tier: 1 },
                 { mteId: 3, name: 'Smelter III', maps: ['gt.recipe.smelter'], tier: 3 }, { mteId: 4, name: 'Freezer IV', maps: ['gt.recipe.vacuumfreezer'], tier: 4 }],
      recipes: [{ id: 'solidify', map: 'gt.recipe.fluidsolidifier', in: [['fluid:molten.thing', 144]], out: [['thing@0', 1]], eut: 8 },
                { id: 'extract', map: 'gt.recipe.fluidextractor', in: [['thing@0', 1]], out: [['fluid:molten.thing', 144]], eut: 30 },
                { id: 'melt-bars', map: 'gt.recipe.fluidextractor', in: [['bars@0', 1]], out: [['fluid:molten.thing', 144]], eut: 30 },
                { id: 'make-bars', map: 'gt.recipe.smelter', in: [['raw@0', 1]], out: [['bars@0', 1]], eut: 480 },
                { id: 'freeze', map: 'gt.recipe.vacuumfreezer', in: [['hot@0', 1]], out: [['thing@0', 1]], eut: 1920 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const mv = await planLine(p, S({ target: 'thing@0', tier: 2 }), emptyContext());
    expect(mv.status).toBe('infeasible');
    expect(mv.warnings).toEqual([{ code: 'unavailable', key: 'thing@0', text: 'Thing: needs HV machines' }]);
    expect(mv.unlocks).toEqual([{ key: 'thing@0', text: 'Thing: needs HV machines' }]);
  });
  it('names the target\'s own unlock when only a chain through the target itself is left (nuggets cut from the ingot)', async () => {
    const p = packFromSpec({
      items: [{ key: 'al@0', name: 'Aluminium Ingot' }, { key: 'nugget@0', name: 'Aluminium Nugget' }, { key: 'dust@0', name: 'Aluminium Dust', gt: { prefix: 'dust', material: 'Aluminium' } }],
      machines: [{ mteId: 1, name: 'Basic Cutter', maps: ['gt.recipe.cuttingsaw'], tier: 1 }, { mteId: 2, name: 'Smelter II', maps: ['gt.recipe.smelter'], tier: 2 }],
      recipes: [{ id: 'craft', map: 'crafting', in: [['nugget@0', 9]], out: [['al@0', 1]] },
                { id: 'cut', map: 'gt.recipe.cuttingsaw', in: [['al@0', 1]], out: [['nugget@0', 9]], eut: 8 },
                { id: 'smelt', map: 'gt.recipe.smelter', in: [['dust@0', 1]], out: [['al@0', 1]], eut: 120 }],
      worldgen: { veins: [vein('ore.mix.al', 'Aluminium')] },
    });
    const lv = await planLine(p, S({ target: 'al@0', tier: 1 }), emptyContext());
    expect(lv.status).toBe('infeasible');
    expect(lv.warnings).toEqual([{ code: 'unavailable', key: 'al@0', text: 'Aluminium Ingot: needs MV machines' }]);
    expect(lv.unlocks).toEqual([{ key: 'al@0', text: 'Aluminium Ingot: needs MV machines' }]);
  });
  it('says in one warning which derived materials the line buys', async () => {
    // A widget of steel and red alloy, both made here from mined iron, copper and redstone.
    const p = packFromSpec({
      items: [{ key: 'iron@0', name: 'Iron Ingot', gt: { prefix: 'ingot', material: 'Iron' } }, { key: 'copper@0', name: 'Copper Ingot', gt: { prefix: 'ingot', material: 'Copper' } },
              { key: 'steel@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } }, { key: 'redalloy@0', name: 'Red Alloy Ingot', gt: { prefix: 'ingot', material: 'RedAlloy' } },
              { key: 'widget@0', name: 'Widget' }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'steel', map: 'gt.recipe.alloysmelter', in: [['iron@0', 1]], out: [['steel@0', 1]], eut: 16 },
                { id: 'redalloy', map: 'gt.recipe.alloysmelter', in: [['copper@0', 1]], out: [['redalloy@0', 1]], eut: 16 },
                { id: 'widget', map: 'gt.recipe.assembler', in: [['steel@0', 1], ['redalloy@0', 1]], out: [['widget@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('ore.mix.iron', 'Iron'), vein('ore.mix.copper', 'Copper')] },
    });
    const plan = await planLine(p, S({ target: 'widget@0', tier: 1 }), emptyContext());
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['redalloy@0', 'derived'], ['steel@0', 'derived']]);
    expect(plan.warnings.filter((w) => w.code === 'derived-leaf')).toEqual([{ code: 'derived-leaf', key: 'redalloy@0',
      text: 'Red Alloy Ingot and Steel Ingot are not mined anywhere you can reach; the line buys them made from other materials (see their sources). Plan them as supporting lines to include their chains.' }]);
  });
  it('never prices a derived material the cost model did not walk below what its own chain costs', async () => {
    // Plates bend from steel (made from iron and coal), press from iron, or alloy-smelt from Magnetic Steel (2 steel per
    // ingot). The cost model keeps the three cheapest plate recipes, so it never walks Magnetic Steel; at its flat price
    // of 1 the smelter was the cheapest plate. Its own chain costs 4 (2 steel), so the line makes plates for 2.
    const p = packFromSpec({
      items: [{ key: 'iron@0', name: 'Iron Dust', gt: { prefix: 'dust', material: 'Iron' } }, { key: 'coal@0', name: 'Coal Dust', gt: { prefix: 'dust', material: 'Coal' } },
              { key: 'steel@0', name: 'Steel Ingot', gt: { prefix: 'ingot', material: 'Steel' } },
              { key: 'magnetic@0', name: 'Magnetic Steel Ingot', gt: { prefix: 'ingot', material: 'SteelMagnetic' } },
              { key: 'plate@0', name: 'Steel Plate', gt: { prefix: 'plate', material: 'Steel' } }],
      machines: [{ mteId: 1, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }, { mteId: 2, name: 'Basic Polarizer', maps: ['gt.recipe.polarizer'], tier: 1 },
                 { mteId: 3, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }, { mteId: 4, name: 'Basic Press', maps: ['gt.recipe.press'], tier: 1 }],
      recipes: [{ id: 'steel', map: 'gt.recipe.alloysmelter', in: [['iron@0', 1], ['coal@0', 1]], out: [['steel@0', 1]], eut: 16 },
                { id: 'magnetize', map: 'gt.recipe.polarizer', in: [['steel@0', 2]], out: [['magnetic@0', 1]], eut: 16 },
                { id: 'bend', map: 'gt.recipe.metalbender', in: [['steel@0', 1]], out: [['plate@0', 1]], eut: 16 },
                { id: 'mold', map: 'gt.recipe.alloysmelter', in: [['magnetic@0', 1]], out: [['plate@0', 1]], eut: 16 },
                { id: 'press-a', map: 'gt.recipe.press', in: [['iron@0', 1], ['coal@0', 1]], out: [['plate@0', 1]], eut: 16 },
                { id: 'press-b', map: 'gt.recipe.press', in: [['iron@0', 3]], out: [['plate@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('ore.mix.iron', 'Iron'), vein('ore.mix.coal', 'Coal')] },
    });
    const plan = await planLine(p, S({ target: 'plate@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plan.rawInputs.map((r) => r.key)).not.toContain('magnetic@0');
    expect(plan.rawInputs.reduce((sum, r) => sum + r.cost, 0)).toBeCloseTo(2, 6);
  });
  it('lists the recipe each step runs among its swaps, also one the cost model pruned', async () => {
    // Thing comes from 13 P, 15 Q, 17 R or 19 S dust per 10, or from one Part. Part bends from Alloy, which nothing mines:
    // a centrifuge splits one X dust into a Left and a Right half and a mixer joins them again, so Alloy costs 1 X. The
    // walk's estimate charges that X to both halves (2), so the cost model, which routes Alloy, keeps the three cheapest
    // dust recipes and never walks Part. The line buys Alloy at what its chain costs (1) and makes Thing through Part:
    // neither step's recipe is among the cost model's, and Part has no producer there at all.
    const dust = (key: string, name: string, material: string) => ({ key, name, gt: { prefix: 'dust', material } });
    const p = packFromSpec({
      items: [dust('x@0', 'X Dust', 'X'), dust('p@0', 'P Dust', 'P'), dust('q@0', 'Q Dust', 'Q'), dust('r@0', 'R Dust', 'R'), dust('s@0', 'S Dust', 'S'),
              { key: 'alloy@0', name: 'Alloy Ingot', gt: { prefix: 'ingot', material: 'Alloy' } },
              { key: 'left@0', name: 'Left' }, { key: 'right@0', name: 'Right' }, { key: 'part@0', name: 'Part' }, { key: 'thing@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.centrifuge' }, { id: 'gt.recipe.mixer' }, { id: 'gt.recipe.metalbender' }, { id: 'gt.recipe.assembler' }],
      machines: [{ mteId: 1, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 }, { mteId: 2, name: 'Basic Mixer', maps: ['gt.recipe.mixer'], tier: 1 },
                 { mteId: 3, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }, { mteId: 4, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'split', map: 'gt.recipe.centrifuge', in: [['x@0', 1]], out: [['left@0', 1], ['right@0', 1]], eut: 16 },
                { id: 'join', map: 'gt.recipe.mixer', in: [['left@0', 1], ['right@0', 1]], out: [['alloy@0', 1]], eut: 16 },
                { id: 'bend', map: 'gt.recipe.metalbender', in: [['alloy@0', 1]], out: [['part@0', 1]], eut: 16 },
                { id: 'from-part', map: 'gt.recipe.assembler', in: [['part@0', 1]], out: [['thing@0', 1]], eut: 16 },
                { id: 'from-p', map: 'gt.recipe.assembler', in: [['p@0', 13]], out: [['thing@0', 10]], eut: 16 },
                { id: 'from-q', map: 'gt.recipe.assembler', in: [['q@0', 15]], out: [['thing@0', 10]], eut: 16 },
                { id: 'from-r', map: 'gt.recipe.assembler', in: [['r@0', 17]], out: [['thing@0', 10]], eut: 16 },
                { id: 'from-s', map: 'gt.recipe.assembler', in: [['s@0', 19]], out: [['thing@0', 10]], eut: 16 }],
      worldgen: { veins: ['X', 'P', 'Q', 'R', 'S'].map((m) => vein(`ore.mix.${m}`, m)) },
    });
    const swaps = (plan: Plan, id: string) => plan.steps.find((s) => s.id === id)?.alternatives.map((a) => [a.recipeId, a.rawCost]);
    const plan = await planLine(p, S({ target: 'thing@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['bend', 'from-part']);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['alloy@0', 'derived']]);
    // Controller ruling (every recipe that makes the product is listed): the fourth dust recipe, which the cost model
    // pruned, too, at its estimate (19 S dust at 1 each per 10).
    expect(swaps(plan, 'from-part')).toEqual([['from-part', 1], ['from-p', 1.3], ['from-q', 1.5], ['from-r', 1.7], ['from-s', 1.9]]);
    expect(swaps(plan, 'bend')).toEqual([['bend', 1]]);
    expect(plan.steps.find((s) => s.id === 'from-part')?.ways).toEqual({ total: 5, usable: 5 });
    // A pinned recipe the cost model pruned (the fourth dust recipe) is the one in use; Part, which neither graph walks
    // now, is listed at its estimate (one Part at its price).
    const pinned = await planLine(p, S({ target: 'thing@0', tier: 1, amount: 60, per: 'min', recipeChoice: { 'thing@0': 'from-s' } }), emptyContext());
    expect(pinned.steps.map((s) => s.id)).toEqual(['from-s']);
    expect(swaps(pinned, 'from-s')).toEqual([['from-part', 1], ['from-p', 1.3], ['from-q', 1.5], ['from-r', 1.7], ['from-s', 1.9]]);
  });
  it('lists every way to make the product, saying why the group cannot use the others', async () => {
    // Controller rulings (plan 09, "show all ways to make the output"): a Widget assembled at LV, MV or HV, in a
    // recycling recipe (excluded by default), or from Titanium Dust, which only the Moon has. At LV one is usable and
    // four are greyed, each with its reason; usable first, then the rest, each group by raw cost per unit, then id.
    const p = packFromSpec({
      ...MINI_GT,
      items: [...MINI_GT.items!, { key: 't:widget@0', name: 'Widget' }],
      recipes: [...MINI_GT.recipes!,
        { id: 'widget-lv', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 2]], out: [['t:widget@0', 1]], eut: 16 },
        { id: 'widget-mv', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 3]], out: [['t:widget@0', 1]], eut: 120 },
        { id: 'widget-hv', map: 'gt.recipe.assembler', in: [['t:copper_ingot@0', 2]], out: [['t:widget@0', 1]], eut: 480 },
        { id: 'widget-recycled', map: 'gt.recipe.assembler', in: [['t:iron_dust@0', 4]], out: [['t:widget@0', 1]], eut: 16, flags: { recycling: true } },
        { id: 'widget-ti', map: 'gt.recipe.assembler', in: [['t:titanium_dust@0', 1]], out: [['t:widget@0', 1]], eut: 16 }],
    });
    const plan = await planLine(p, S({ target: 't:widget@0', tier: 1 }), emptyContext());
    const step = plan.steps.find((s) => s.mainOutput === 't:widget@0')!;
    expect(step.recipeId).toBe('widget-lv');
    expect(step.ways).toEqual({ total: 5, usable: 1 });
    expect(step.alternatives.map((a) => [a.recipeId, a.rawCost, a.unusable])).toEqual([
      ['widget-lv', 2, undefined],
      ['widget-ti', 1, ['needs Moon (T1 rocket)']],
      ['widget-hv', 2, ['needs HV (your tier is LV)']],
      ['widget-mv', 3, ['needs MV (your tier is LV)']],
      ['widget-recycled', 4, ['excluded: recycling (see Settings)']],
    ]);
    // Every row says what it takes, named in the plan.
    expect(step.alternatives.find((a) => a.recipeId === 'widget-ti')?.inputs).toEqual([{ key: 't:titanium_dust@0', amount: 1 }]);
    expect(plan.names?.['t:titanium_dust@0']).toBe('Titanium Dust');
    // At MV the MV recipe is usable too.
    const mv = (await planLine(p, S({ target: 't:widget@0', tier: 2 }), emptyContext())).steps.find((s) => s.mainOutput === 't:widget@0')!;
    expect(mv.ways).toEqual({ total: 5, usable: 2 });
    expect(mv.alternatives.filter((a) => a.unusable === undefined).map((a) => a.recipeId).sort()).toEqual(['widget-lv', 'widget-mv']);
  });
  it('lists every way to make the product, however many there are', async () => {
    // Controller rulings (plan 09, "ALL ways the export knows"): no cut of the cheapest. 40 Widget recipes run at LV and
    // 20 more need MV; at LV all 60 are listed, the 40 usable ones first, each group by raw cost per unit, then id.
    const widget = (id: string, plates: number, eut: number): RecipeSpec => ({ id, map: 'gt.recipe.assembler', in: [['t:iron_plate@0', plates]], out: [['t:widget@0', 1]], eut });
    const lv = Array.from({ length: 40 }, (_, i) => widget(`widget-lv-${String(i).padStart(2, '0')}`, i + 2, 16));
    const mv = Array.from({ length: 20 }, (_, i) => widget(`widget-mv-${String(i).padStart(2, '0')}`, i + 2, 120));
    const p = packFromSpec({ ...MINI_GT, items: [...MINI_GT.items!, { key: 't:widget@0', name: 'Widget' }], recipes: [...MINI_GT.recipes!, ...lv, ...mv] });
    const step = (await planLine(p, S({ target: 't:widget@0', tier: 1 }), emptyContext())).steps.find((s) => s.mainOutput === 't:widget@0')!;
    expect(step.recipeId).toBe('widget-lv-00');
    expect(step.ways).toEqual({ total: 60, usable: 40 });
    expect(step.alternatives.map((a) => a.recipeId)).toEqual([...lv, ...mv].map((r) => r.id));
    expect(step.alternatives.map((a) => a.rawCost)).toEqual([...lv.map((_, i) => i + 2), ...mv.map((_, i) => i + 2)]);
    expect(step.alternatives.filter((a) => a.unusable !== undefined).map((a) => a.unusable)).toEqual(mv.map(() => ['needs MV (your tier is LV)']));
  });
  it('leaves display-only and duplicate recipes out of the swap list and names a machine nothing builds', async () => {
    // A fake (display-only) recipe and the vanilla furnace's copy of a smelting recipe the electric furnace runs are no
    // ways of their own; a recipe of a multiblock whose controller nothing makes needs a machine nothing can build; one
    // whose ingredient only an MV recipe makes (Titanium Plate, bent at 120 EU/t) needs MV.
    const p = packFromSpec({
      ...MINI_GT,
      items: [...MINI_GT.items!, { key: 't:widget@0', name: 'Widget' }],
      recipes: [...MINI_GT.recipes!,
        { id: 'widget-lv', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 2]], out: [['t:widget@0', 1]], eut: 16 },
        { id: 'widget-shown', map: 'gt.recipe.assembler', in: [['t:redstone@0', 1]], out: [['t:widget@0', 1]], eut: 16, flags: { fake: true } },
        { id: 'widget-ebf', map: 'gt.recipe.blastfurnace', in: [['t:iron_dust@0', 1]], out: [['t:widget@0', 1]], eut: 30 },
        { id: 'widget-smelt', map: 'gt.recipe.furnace', source: 'derived', in: [['t:copper_ingot@0', 3]], out: [['t:widget@0', 1]], eut: 4, dur: 128 },
        { id: 'widget-furnace', map: 'furnace', in: [['t:copper_ingot@0', 3]], out: [['t:widget@0', 1]], dur: 200 },
        { id: 'widget-plate', map: 'gt.recipe.assembler', in: [['t:titanium_plate@0', 1]], out: [['t:widget@0', 1]], eut: 16 }],
    });
    const plan = await planLine(p, S({ target: 't:widget@0', tier: 1 }), emptyContext());
    const step = plan.steps.find((s) => s.mainOutput === 't:widget@0')!;
    expect(step.ways).toEqual({ total: 4, usable: 2 });
    expect(step.alternatives.map((a) => [a.recipeId, a.unusable])).toEqual([
      ['widget-lv', undefined], ['widget-smelt', undefined], ['widget-ebf', ['needs a machine nothing can build here']],
      ['widget-plate', ['needs MV (your tier is LV)']]]);
  });
  it('says when whole crafts leave a Make N batch short', () => {
    expect(batchShortWarning(pack, [], 't:circuit@0', 10)).toEqual([]);
    expect(batchShortWarning(pack, [{ key: 'fluid:oil', amount: 1000, chance: 1 }, { key: 't:copper_wire@0', amount: 2, chance: 1 }], 't:circuit@0', 10)).toEqual([{
      code: 'batch-short', key: 'fluid:oil', keys: ['fluid:oil', 't:copper_wire@0'],
      text: 'Whole crafts do not balance: have 1,000 L Oil, 2× 1x Copper Wire ready before you start (cells or catalysts the chain hands round), or the batch comes out short.',
    }]);
    expect(batchShortWarning(pack, [{ key: 't:circuit@0', amount: 3, chance: 1 }], 't:circuit@0', 10)[0]?.text).toBe('The batch makes only 7 of 10 Basic Circuit.');
    // Every good it covers, the target first, so the plan index leaves them to it (no short input at each consumer).
    const both = [{ key: 't:copper_wire@0', amount: 2, chance: 1 }, { key: 't:circuit@0', amount: 3, chance: 1 }];
    expect(batchShortWarning(pack, both, 't:circuit@0', 10)[0]).toMatchObject({ key: 't:circuit@0', keys: ['t:circuit@0', 't:copper_wire@0'] });
  });
  it('keeps a stop item the line cannot make at its stop price, so its recipe stays an alternative', async () => {
    // At MV nothing reachable makes titanium ingots; the group says it already makes them.
    const p = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 2, stopItems: ['t:titanium_ingot@0'] }), emptyContext());
    expect(p.status).toBe('ok');
    expect(p.rawInputs.map((r) => [r.key, r.leafClass, r.cost])).toEqual([['t:titanium_ingot@0', 'stop', 0.0166666667]]);
    expect(p.steps[0]?.alternatives.map((a) => [a.recipeId, a.rawCost, a.mapId])).toEqual([['bend-ti', 1, 'gt.recipe.metalbender']]);
  });
  it('names the target and the raw-cost trade-off', async () => {
    // Spec R3/R11: the client reads the target and its rate from the plan, and how much raw material the plan uses
    // against the least possible (one MV circuit takes 2.5 raw: 1 copper, 1 redstone, half an iron ingot).
    const rate = await planLine(pack, S({ target: 't:circuit@0', tier: 2, amount: 30, per: 'min' }), emptyContext());
    expect(rate.target).toBe('t:circuit@0');
    expect(rate.targetPerSecond).toBe(0.5);
    expect(rate.rawCost?.perSecond).toBeCloseTo(1.25, 9);
    expect(rate.rawCost?.leastPerSecond).toBeCloseTo(1.25, 9);
    expect(rate.rawCost!.leastPerSecond).toBeLessThanOrEqual(rate.rawCost!.perSecond);
    const batch = await planLine(pack, S({ target: 't:circuit@0', tier: 2, mode: 'makeN', amount: 10 }), emptyContext());
    expect(batch.status).toBe('ok');
    expect(batch.target).toBe('t:circuit@0');
    expect(batch.targetPerSecond).toBeUndefined();
    expect(batch.rawCost).toBeUndefined();
  });
  it('names a step after the output it runs for when the line also buys its other output, so the plan adds up', async () => {
    // A macerator splits raw dust into X and Y; a thing takes 2 X and 1 Y. X is also mined, for less than a second split
    // costs (Raw Dust at 1.5), so the line runs the macerator once and buys the other X. The split runs for its Y, and is
    // named after it (fix spec D13, plan 09 Task 8): nothing is both bought and made (spec R11), in a rate or a batch.
    // (At a tie the line makes all of it, one source: solve.ts withoutTiedPurchases.)
    const p = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'x@0', name: 'X Dust', gt: { prefix: 'dust', material: 'X' } },
              { key: 'y@0', name: 'Y Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'split', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['x@0', 1], ['y@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['x@0', 2], ['y@0', 1]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw'), vein('ore.mix.x', 'X')] },
    });
    const plan = await planLine(p, S({ target: 't@0', tier: 1, amount: 60, per: 'min', costOverrides: { Raw: 1.5 } }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-t', 't@0'], ['split', 'y@0']]);
    expect(plan.rawInputs.map((r) => [r.key, r.perSecond])).toEqual([['raw@0', 1], ['x@0', 1]]);
    expect(plan.warnings).toEqual([]);
    const batch = await planLine(p, S({ target: 't@0', tier: 1, mode: 'makeN', amount: 10, costOverrides: { Raw: 1.5 } }), emptyContext());
    expect(batch.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-t', 't@0'], ['split', 'y@0']]);
    expect(batch.rawInputs.map((r) => r.key)).toEqual(['raw@0', 'x@0']);
    expect(batch.warnings.filter((w) => w.code === 'bought-and-made')).toEqual([]);
  });
  it('names two steps after the part only each makes, not the X both make beside it', async () => {
    // Fix spec D13 (plan 09 final review): a macerator and a centrifuge each make 2 X beside a part only it makes, and a
    // thing takes 4 X and one of each part. Each step is there for its part (the line has it from that step alone) and X
    // is their co-product, so the plan adds up (spec R11). Named after X by value × use, both steps "made" X, and the
    // plan said X is made two ways.
    const p = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'x@0', name: 'X Dust', gt: { prefix: 'dust', material: 'X' } },
              { key: 'a@0', name: 'A Part' }, { key: 'b@0', name: 'B Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }, { id: 'gt.recipe.centrifuge', name: 'Centrifuge' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }, { mteId: 2, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 },
                 { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'make-a', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['x@0', 2], ['a@0', 1]], eut: 2 },
                { id: 'make-b', map: 'gt.recipe.centrifuge', in: [['raw@0', 1]], out: [['x@0', 2], ['b@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['x@0', 4], ['a@0', 1], ['b@0', 1]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const plan = await planLine(p, S({ target: 't@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-a', 'a@0'], ['make-b', 'b@0'], ['make-t', 't@0']]);
    expect(plan.warnings).toEqual([]);
    expect(indexPlan(plan).issues).toEqual([]);
  });
  it('says in a warning what the plan does not add up on', async () => {
    // A centrifuge makes 2 X from the W Dust a macerator makes beside the thing's part, and a second macerator grinds
    // the other 2 X the thing takes from raw dust: each of the two makes only X, so both are there for their X (spec
    // D13), X is made two ways (spec R11), and the plan says so. (Grinding all 4 X would cost a raw dust more.)
    const p = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'x@0', name: 'X Dust' },
              { key: 'a@0', name: 'A Part' }, { key: 'w@0', name: 'W Dust' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }, { id: 'gt.recipe.centrifuge', name: 'Centrifuge' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }, { mteId: 2, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 },
                 { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'make-a', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['a@0', 1], ['w@0', 1]], eut: 2 },
                { id: 'spin-w', map: 'gt.recipe.centrifuge', in: [['w@0', 1]], out: [['x@0', 2]], eut: 2 },
                { id: 'grind-x', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['x@0', 2]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['x@0', 4], ['a@0', 1]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const plan = await planLine(p, S({ target: 't@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.runsPerSecond])).toEqual([['grind-x', 1], ['make-a', 1], ['make-t', 1], ['spin-w', 1]]);
    expect(plan.steps.filter((s) => s.mainOutput === 'x@0').map((s) => s.id)).toEqual(['grind-x', 'spin-w']);
    expect(plan.warnings).toEqual([{ code: 'multi-producer', key: 'x@0', text: 'X Dust is made 2 ways: Basic Macerator (50%) and Basic Centrifuge (50%).',
      stepId: 'grind-x', stepIds: ['grind-x', 'spin-w'], share: [0.5, 0.5] }]);
  });
  it('names a step after the output only it makes, per minute and in a batch whose whole runs leave some of it over', async () => {
    // Fix spec D13 (plan 09 final review): a reactor makes the line's only X Part (2 a run) and an H Cell, an
    // electrolyzer 2 H Cells a run for less; a thing takes 3 X and 10 H. The reactor runs for its X, the electrolyzer
    // makes the rest of the H. A batch of one thing runs the reactor twice and keeps 1 X over, yet it still runs for its
    // X: what each step runs for comes from the line's LP, as per minute.
    const p = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'x@0', name: 'X Part' }, { key: 'h@0', name: 'H Cell' },
              { key: 'o@0', name: 'O Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.chemicalreactor', name: 'Chemical Reactor' }, { id: 'gt.recipe.electrolyzer', name: 'Electrolyzer' },
             { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Chemical Reactor', maps: ['gt.recipe.chemicalreactor'], tier: 1 },
                 { mteId: 2, name: 'Basic Electrolyzer', maps: ['gt.recipe.electrolyzer'], tier: 1 },
                 { mteId: 3, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'react', map: 'gt.recipe.chemicalreactor', in: [['raw@0', 2]], out: [['x@0', 2], ['h@0', 1]], eut: 2 },
                { id: 'electrolyze', map: 'gt.recipe.electrolyzer', in: [['raw@0', 1]], out: [['h@0', 2], ['o@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['x@0', 3], ['h@0', 10]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const mains = [['electrolyze', 'h@0'], ['make-t', 't@0'], ['react', 'x@0']];
    const rate = await planLine(p, S({ target: 't@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(rate.steps.map((s) => [s.id, s.runsPerSecond])).toEqual([['electrolyze', 4.25], ['make-t', 1], ['react', 1.5]]);
    expect(rate.steps.map((s) => [s.id, s.mainOutput])).toEqual(mains);
    expect(indexPlan(rate).issues).toEqual([]);
    const batch = await planLine(p, S({ target: 't@0', tier: 1, mode: 'makeN', amount: 1 }), emptyContext());
    expect(batch.steps.map((s) => [s.id, s.runs])).toEqual([['electrolyze', 4], ['make-t', 1], ['react', 2]]);
    expect(batch.makeN?.leftovers).toContainEqual({ key: 'x@0', amount: 1, chance: 1 });
    expect(batch.steps.map((s) => [s.id, s.mainOutput])).toEqual(mains);
    expect(indexPlan(batch).issues).toEqual([]);
  });
  it('makes all of a good a step of the line makes rather than buy the rest at the same raw material', async () => {
    // The case above at the plain price of Raw Dust: a second split costs what buying the other X does, and the line
    // takes all of its X from the macerator, leaving a Y over, instead of buying X beside it (plan 09 Task 8: the audit's
    // checker calls such a purchase redundant, and fix spec §7.2 allows no such plan).
    const p = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'x@0', name: 'X Dust', gt: { prefix: 'dust', material: 'X' } },
              { key: 'y@0', name: 'Y Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'split', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['x@0', 1], ['y@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['x@0', 2], ['y@0', 1]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw'), vein('ore.mix.x', 'X')] },
    });
    const plan = await planLine(p, S({ target: 't@0', tier: 1, amount: 60, per: 'min' }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.runsPerSecond])).toEqual([['make-t', 1], ['split', 2]]);
    expect(plan.rawInputs.map((r) => [r.key, r.perSecond])).toEqual([['raw@0', 2]]);
    expect(plan.byproducts.map((b) => [b.key, b.amount])).toEqual([['y@0', 1]]);
    expect(plan.warnings.filter((w) => w.code === 'bought-and-made')).toEqual([]);
  });
  it('names a step after its product, not the free water beside it, when the cost model never walked the product', async () => {
    // Fix spec D13 as ruled in Task 1: a good's value is its cost-model cost (0 when not finite), never below its plain
    // price. The group pins the assembler recipe that takes 1 Charcoal and 2,000 L Water; a pyrolyse oven makes the
    // charcoal with 1,000 L Water beside it, and the line buys the other 1,000 L. The cost model keeps only the cheaper
    // dust recipe, so it never walks Charcoal (Infinity, like the real Methyl Acetate Cell). At 0 against free Water the
    // litres won: the oven "made Water", and the plan said Water is both bought and made.
    const p = packFromSpec({
      items: [{ key: 'minecraft:log@0', name: 'Oak Wood', oreDict: ['logWood'] }, { key: 't:charcoal@0', name: 'Charcoal' },
              { key: 't:x_dust@0', name: 'X Dust', gt: { prefix: 'dust', material: 'X' } }, { key: 't:thing@0', name: 'Thing' }],
      fluids: [{ key: 'fluid:water', name: 'Water' }],
      maps: [{ id: 'gt.recipe.pyro', name: 'Pyrolyse Oven' }, { id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Pyrolyse Oven', maps: ['gt.recipe.pyro'], tier: 1 }, { mteId: 2, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'pyrolyse', map: 'gt.recipe.pyro', in: [['minecraft:log@0', 1]], out: [['t:charcoal@0', 1], ['fluid:water', 1000]], eut: 8 },
                { id: 'make-thing', map: 'gt.recipe.assembler', in: [['t:charcoal@0', 1], ['fluid:water', 2000]], out: [['t:thing@0', 1]], eut: 2 },
                { id: 'from-dust', map: 'gt.recipe.assembler', in: [['t:x_dust@0', 1]], out: [['t:thing@0', 4]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.x', 'X')] },
    });
    const settings = S({ target: 't:thing@0', tier: 1, amount: 60, per: 'min', recipeChoice: { 't:thing@0': 'make-thing' } });
    expect((await linePricing(p, settings, emptyContext()))?.model.costs.cost('t:charcoal@0')).toBe(Infinity);
    const plan = await planLine(p, settings, emptyContext());
    expect(plan.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-thing', 't:thing@0'], ['pyrolyse', 't:charcoal@0']]);
    expect(plan.rawInputs.map((r) => [r.key, r.perSecond])).toEqual([['fluid:water', 1000], ['minecraft:log@0', 1]]);
    expect(plan.warnings.filter((w) => w.code === 'bought-and-made' || w.code === 'multi-producer')).toEqual([]);
  });
  it('gives Make N flows and leftovers per second over the batch', async () => {
    const p = await planLine(pack, S({ target: 't:circuit@0', mode: 'makeN', amount: 10, tier: 1 }), emptyContext());
    const out = p.flows.find((f) => f.to === 'out');
    expect(out?.key).toBe('t:circuit@0');
    expect(out?.perSecond).toBeCloseTo(10 / 115, 9);
    expect(p.rawInputs[0]?.perSecond).toBeCloseTo(10 / 115, 9);
  });
  it('counts the machines Make N steps share once in the peak draw', async () => {
    // Progress ruling (Task 14): both assembler steps run on the same 2 owned assemblers, so the peak is 2 × 30 EU/t.
    const shared = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'a@0', name: 'Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.assembler', name: 'Assembler' }],
      machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [{ id: 'r1', map: 'gt.recipe.assembler', in: [['raw@0', 1]], out: [['a@0', 1]], eut: 30 },
                { id: 'r2', map: 'gt.recipe.assembler', in: [['a@0', 1]], out: [['t@0', 1]], eut: 16 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const ctx = { ...emptyContext(), ownedMachines: [{ mteId: 1, count: 2 }] };
    const p = await planLine(shared, S({ target: 't@0', mode: 'makeN', amount: 4, tier: 1 }), ctx);
    expect(p.steps.map((s) => [s.id, s.machine.mteId, s.count, s.euPerTick])).toEqual([['r1', 1, 2, 30], ['r2', 1, 2, 16]]);
    expect(p.power).toMatchObject({ peakEUt: 60, voltageTier: 1, amps: 2 });
    expect(p.buildSteps.find((s) => s.kind === 'power')?.text).toMatch(/^Connect power: up to 60 EU\/t at LV/);
    // Rate mode gives every step its own machines, so the plain sum stays.
    const rate = await planLine(shared, S({ target: 't@0', amount: 60, per: 'min', tier: 1 }), ctx);
    expect(rate.power).toMatchObject({ peakEUt: rate.steps.reduce((sum, s) => sum + s.count * s.euPerTick, 0) });
  });
  it('names the target in a free-loop warning', async () => {
    const loop = packFromSpec({
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'y@0', name: 'Widget' }, { key: 'x@0', name: 'Gizmo' },
              { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }],
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'loop-a', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 2]], eut: 2 },
                { id: 'loop-b', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]], eut: 2 },
                { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['t@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    // A loop upstream of the target: the guard leaves it out and names its recipes.
    const p = await planLine(loop, S({ target: 't@0', tier: 1 }), emptyContext());
    expect(p.steps.map((s) => s.id)).toEqual(['honest', 'make-t']);
    // The left-out recipes by machine and product, not by their 16-hex ids.
    expect(p.warnings).toEqual([{ code: 'free-loop', text: 'Ignored 2 recipes that make Thing from nothing (likely a recipe data loop): Macerator making Widget, Macerator making Gizmo' }]);
  });
});

describe('settingsHash / planCacheKey / PlanCache', () => {
  it('hashes settings independent of key order', () => {
    const a = defaultSettings();
    const b = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(settingsHash(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(settingsHash(b)).toBe(settingsHash(a));
    expect(settingsHash({ ...a, amount: 2 })).not.toBe(settingsHash(a));
    expect(planCacheKey('abc', 'e1', null, null)).toBe('e1|-|-|abc');
    expect(planCacheKey('abc', 'e1', 'S', 'B')).toBe('e1|S|B|abc');
  });
  it('computes each key once, even for concurrent callers', async () => {
    const c = new PlanCache(2);
    let n = 0;
    const compute = async () => { n++; return { settingsHash: 'h' } as never; };
    await Promise.all([c.get('k', compute), c.get('k', compute)]);
    expect([n, c.computations]).toEqual([1, 1]);
  });
  it('sorts nested keys too, drops the least recently used entry and never keeps a failure', async () => {
    const a = S({ costOverrides: { Iron: 2, Copper: 3 }, dims: { policy: 'progression', overrides: { moon: 'on', nether: 'off' } } });
    const b = S({ costOverrides: { Copper: 3, Iron: 2 }, dims: { policy: 'progression', overrides: { nether: 'off', moon: 'on' } } });
    expect(settingsHash(b)).toBe(settingsHash(a));
    const c = new PlanCache(2);
    const plan = (h: string) => async () => ({ settingsHash: h }) as unknown as Plan;
    await c.get('a', plan('a'));
    await c.get('b', plan('b'));
    await c.get('a', plan('a'));           // a is now the most recently used
    await c.get('c', plan('c'));           // drops b
    expect(c.computations).toBe(3);
    await c.get('a', plan('a'));
    expect(c.computations).toBe(3);
    await c.get('b', plan('b'));
    expect(c.computations).toBe(4);
    await expect(c.get('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await c.get('x', plan('x'))).settingsHash).toBe('x');
    expect(c.computations).toBe(6);
  });
});

describe('powerSummary', () => {
  const step = (p: Partial<PlanStep>): PlanStep => ({ id: 's', recipeId: 's', mapId: 'm', machine: { mteId: 1, name: 'M', tier: 1 },
    count: 1, owned: 0, runsPerSecond: 1, utilization: 1, euPerTick: 0, durationTicks: 20, overclocks: 0, inputs: [], outputs: [],
    alternatives: [], handCraft: false, warnings: [], ...p });
  it('sums peak and average draw, and the amps at the highest machine tier', () => {
    expect(powerSummary([])).toEqual({ peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 });
    expect(powerSummary([step({ count: 3, euPerTick: 24, utilization: 0.5 }),
                         step({ count: 2, euPerTick: 120, utilization: 0.25, machine: { mteId: 2, name: 'N', tier: 2 } })]))
      .toEqual({ peakEUt: 312, averageEUt: 96, voltageTier: 2, amps: 3 });
    expect(powerSummary([step({ count: 4, euPerTick: 32 })])).toMatchObject({ peakEUt: 128, amps: 4 });
  });
  it('counts a machine type once per type when its steps share the machines', () => {
    const steps = [step({ id: 'a', count: 2, euPerTick: 30 }), step({ id: 'b', count: 2, euPerTick: 16 })];
    expect(powerSummary(steps, { sharedByType: true })).toMatchObject({ peakEUt: 60, voltageTier: 1, amps: 2 });
    expect(powerSummary(steps)).toMatchObject({ peakEUt: 92, voltageTier: 1, amps: 3 });
    expect(powerSummary(steps, { sharedByType: false })).toMatchObject({ peakEUt: 92, amps: 3 });
    // The average already divides by the shared count, so it is the same either way.
    expect(powerSummary(steps, { sharedByType: true }).averageEUt).toBe(powerSummary(steps).averageEUt);
  });
});
