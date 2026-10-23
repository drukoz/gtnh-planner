import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type IngredientSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { ANY_LV_CIRCUIT, largeBenderSpec } from '../../helpers/build-fixtures.ts';
import { deepSpec, loopSpec, packedTableSpec, standInPressSpec, variantCellSpec } from '../../helpers/howto-fixtures.ts';
import { buildBom, expandBomLines, partName } from '../../../src/server/planner/bom.ts';
import { buildSteps } from '../../../src/server/planner/steps.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { planBasis, effectiveTier } from '../../../src/server/planner/basis.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { makeLeafOracle, makePrices } from '../../../src/server/planner/costs.ts';
import { MAX_RECIPES, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import type { BomLine, PlanContext, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';

const pack = miniGt();
const env: PlanEnv = { tier: 1, reachable: reachableDims(pack.worldgen, { policy: 'progression', overrides: {} }, [], 1).keys, lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };
const leaf = makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env), makePrices(pack, {}));
const step = (p: Partial<PlanStep>): PlanStep => ({ id: 'x', recipeId: 'x', mapId: 'm', machine: { mteId: 0, name: '', tier: 1 }, count: 1, owned: 0, runsPerSecond: 0.1,
  utilization: 1, euPerTick: 0, durationTicks: 20, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [], ...p });
const opts = { settings: defaultSettings(), env, leaf, ctx: emptyContextForTest() };
const PC = 'gregtech:gt.integrated_circuit@2';

describe('planBasis', () => {
  it('derives tier, reachability and the leaf oracle like planLine', () => {
    const ctx = { ...emptyContextForTest(), topTier: 3 };
    expect([effectiveTier(defaultSettings(), ctx), effectiveTier({ ...defaultSettings(), tier: 2 }, ctx), effectiveTier(defaultSettings(), emptyContextForTest())]).toEqual([3, 2, 1]);
    const b = planBasis(pack, { ...defaultSettings(), tier: 1 }, emptyContextForTest());
    expect(b.env).toMatchObject({ tier: 1, lowGravity: false });
    expect(b.env.reachable.has('overworld')).toBe(true);
    expect(b.leaf('t:iron_ingot@0')).toMatchObject({ buyable: true, leafClass: 'direct' });
  });
});

describe('buildBom', () => {
  it('lists new machines and breaks them down to base materials', async () => {
    const bom = await buildBom(pack, [step({ id: 'wire', recipeId: 'wire', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 } })], opts);
    expect(bom.lines.map((l) => [l.key, l.amount, l.why])).toEqual([['machine:111@0', 1, '1× Basic Wiremill']]);
    expect(bom.lines.map((l) => l.group)).toEqual(['machines']);
    expect(bom.lines[0]?.children?.map((l) => [l.key, l.amount])).toEqual([['t:circuit@0', 2], ['t:copper_wire@0', 4], ['t:hull_lv@0', 1]]);
    expect(bom.totals.map((l) => [l.key, l.amount])).toEqual([['t:copper_ingot@0', 4], ['t:iron_ingot@0', 10], ['t:redstone@0', 2], ['t:tin_ingot@0', 1]]);
  });
  it('skips owned machines but keeps one-off items for every machine', async () => {
    const bom = await buildBom(pack, [step({ id: 'circuit-lv', recipeId: 'circuit-lv', count: 5, owned: 5, machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } })], opts);
    expect(bom.lines.map((l) => [l.key, l.amount, l.why])).toEqual([[PC, 5, '5× Programmed Circuit (stays in the machine)']]);
    expect(bom.lines.map((l) => l.group)).toEqual(['one-off']);
  });
  it('counts a multiblock controller once, not again inside its structure', async () => {
    const p = packFromSpec({ maps: [{ id: 'gt.recipe.blastfurnace', specialValue: 'heat' }],
      machines: [
        { mteId: 1000, name: 'Electric Blast Furnace', maps: ['gt.recipe.blastfurnace'], kind: 'multiblock', structure: { size: [3, 1, 1], controller: [1, 0, 0], air: [], blocks: [
          { pos: [0, 0, 0], block: { id: 't:casing', meta: 11 } },
          { pos: [1, 0, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 1000 } },
          { pos: [2, 0, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 50 } }] } },
        { mteId: 50, name: 'LV Energy Hatch', maps: [], kind: 'hatch', tier: 1 }],
      recipes: [{ id: 'ebf', map: 'gt.recipe.blastfurnace', in: [['a@0', 1]], out: [['b@0', 1]], eut: 120 }] });
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    const bom = await buildBom(p, [step({ id: 'ebf', recipeId: 'ebf', machine: { mteId: 1000, name: 'Electric Blast Furnace', tier: 1 } })], { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.lines.map((l) => [l.key, l.amount, l.group])).toEqual([['machine:1000@0', 1, 'machines'], ['machine:50@0', 1, 'machines'], ['t:casing@11', 1, 'machines']]);
    expect(bom.lines.find((l) => l.key === 'machine:1000@0')?.why).toBe('1× Electric Blast Furnace');
  });
  it('lists a structure hatch at the lowest tier of its class', async () => {
    // The Large Bender's exported structure holds an HV muffler hatch; the LV one does the same job.
    const p = packFromSpec(largeBenderSpec());
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    const bom = await buildBom(p, [step({ id: 'bend-plate', recipeId: 'bend-plate', machine: { mteId: 1100, name: 'Large Bender', tier: 1 } })],
      { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    const lines = bom.lines.map((l) => [l.key, l.amount, l.why, l.group]);
    expect(lines).toContainEqual(['machine:91@0', 1, 'structure of 1× Large Bender', 'machines']);
    expect(lines.map(([key]) => key)).not.toContain('machine:93@0');
  });
  it('adds one cleanroom for the steps that need it, and warns when the pack has none', async () => {
    const spec = (cls: string) => packFromSpec({ maps: [{ id: 'gt.recipe.assembler' }],
      machines: [{ mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
                 { mteId: 1172, name: 'Cleanroom', maps: [], kind: 'multiblock', cls }],
      recipes: [{ id: 'chip', map: 'gt.recipe.assembler', in: [['t:wafer@0', 1]], out: [['t:chip@0', 1]], eut: 16, meta: { cleanroom: true } }] });
    const steps = [step({ id: 'chip', recipeId: 'chip', needsCleanroom: true, mainOutput: 't:chip@0', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } })];
    const settings = { ...defaultSettings(), tier: 1 };
    const withRoom = spec('gregtech.common.tileentities.machines.multi.MTECleanroom');
    const b = planBasis(withRoom, settings, emptyContextForTest());
    const bom = await buildBom(withRoom, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.lines.map((l) => [l.key, l.amount, l.why, l.group])).toEqual([
      ['machine:1172@0', 1, 'cleanroom for t:chip@0', 'machines'], ['machine:121@0', 1, '1× Basic Assembler', 'machines']]);
    expect(bom.warnings).toEqual([]);
    const without = spec('test.NotACleanroom');
    const nb = planBasis(without, settings, emptyContextForTest());
    const none = await buildBom(without, steps, { settings, env: nb.env, leaf: nb.leaf, ctx: emptyContextForTest() });
    expect(none.lines.map((l) => l.key)).toEqual(['machine:121@0']);
    expect(none.warnings.map((w) => w.code)).toEqual(['no-cleanroom']);
  });
  it('leaves out a cleanroom the group owns', async () => {
    // Plan 12 Task 6: the group's own cleanroom (a world scan's, or the "Machines we have" list's) needs no building.
    const p = packFromSpec({ ...MINI_GT, machines: [...(MINI_GT.machines ?? []),
      { mteId: 1200, name: 'Cleanroom', kind: 'multiblock', maps: [], cls: 'gregtech.common.tileentities.machines.multi.MTECleanroom' }] });
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    const steps = [step({ id: 'x', recipeId: 'x', needsCleanroom: true, mainOutput: 't:circuit@0' })];
    const rooms = async (ctx: PlanContext) => (await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx })).lines.filter((l) => l.key === 'machine:1200@0');
    expect(await rooms(emptyContextForTest())).toEqual([expect.objectContaining({ amount: 1, why: expect.stringMatching(/^cleanroom for /), group: 'machines' })]);
    expect(await rooms({ ...emptyContextForTest(), ownedMachines: [{ mteId: 1200, count: 1 }] })).toEqual([]);
    // the list's own one counts the same; a declined one does not
    const listed = await buildBom(p, steps, { settings: { ...settings, ownedManual: [{ mteId: 1200, count: 1 }] }, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(listed.lines.map((l) => l.key)).not.toContain('machine:1200@0');
    const declined = await buildBom(p, steps, { settings: { ...settings, declineReuse: [1200] }, env: b.env, leaf: b.leaf,
      ctx: { ...emptyContextForTest(), ownedMachines: [{ mteId: 1200, count: 1 }] } });
    expect(declined.lines.map((l) => l.key)).toContain('machine:1200@0');
  });
  it('counts a machine that Make N steps share once', async () => {
    const steps = [step({ id: 'bend-plate', recipeId: 'bend-plate', count: 1, owned: 0, machine: { mteId: 101, name: 'Basic Bending Machine', tier: 1 } }),
                   step({ id: 'bend-ti', recipeId: 'bend-ti', count: 1, owned: 0, machine: { mteId: 101, name: 'Basic Bending Machine', tier: 1 } })];
    const makeN = await buildBom(pack, steps, { ...opts, settings: { ...defaultSettings(), mode: 'makeN' } });
    expect(makeN.lines.map((l) => [l.key, l.amount, l.why])).toEqual([['machine:101@0', 1, '1× Basic Bending Machine']]);
    const rate = await buildBom(pack, steps, opts);
    expect(rate.lines.map((l) => [l.key, l.amount, l.why])).toEqual([['machine:101@0', 2, '1× Basic Bending Machine; 1× Basic Bending Machine']]);
  });
  it('warns when its own recipe graph is too large to break the build list down fully', async () => {
    // make-assembler needs t:a and t:x, t:x needs t:w, t:w needs t:b. t:a takes 200 parts of 200 parts each (40,201
    // recipes in all, one per good), so the walk stops at MAX_RECIPES before it ever expands t:b, three levels down.
    const ins = (prefix: string): Array<[string, number]> => Array.from({ length: 200 }, (_, i): [string, number] => [`${prefix}_${i}@0`, 1]);
    const p = packFromSpec({ maps: [{ id: 'gt.recipe.assembler' }],
      machines: [{ mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [
        { id: 'make-assembler', map: 'gt.recipe.assembler', in: [['t:a@0', 1], ['t:x@0', 1]], out: [['machine:121@0', 1]], eut: 16 },
        { id: 'make-x', map: 'gt.recipe.assembler', in: [['t:w@0', 1]], out: [['t:x@0', 1]], eut: 16 },
        { id: 'make-w', map: 'gt.recipe.assembler', in: [['t:b@0', 1]], out: [['t:w@0', 1]], eut: 16 },
        { id: 'make-b', map: 'gt.recipe.assembler', in: [['t:c@0', 1]], out: [['t:b@0', 1]], eut: 16 },
        { id: 'make-a', map: 'gt.recipe.assembler', in: ins('t:a'), out: [['t:a@0', 1]], eut: 16 },
        ...ins('t:a').flatMap(([part], i) => [
          { id: `a${i}`, map: 'gt.recipe.assembler', in: ins(`t:a${i}`), out: [[part, 1]] as Array<[string, number]>, eut: 16 },
          ...ins(`t:a${i}`).map(([leaf], j) => ({ id: `a${i}_${j}`, map: 'gt.recipe.assembler', out: [[leaf, 1]] as Array<[string, number]>, eut: 16 }))])] });
    expect(p.recipes.length).toBeGreaterThan(MAX_RECIPES);
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    const steps = [step({ id: 'make-b', recipeId: 'make-b', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } })];
    const bom = await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.warnings).toEqual([{ code: 'graph-too-big', text: 'The build list is too large to break down fully; mark some parts as "we already make this"' }]);
    // t:b was never expanded, so nothing above it settles: the assembler is unmade, and the warning says why
    expect(bom.totals.map((l) => [l.key, l.amount, l.unmade])).toEqual([['machine:121@0', 1, 'no-recipe']]);
    const r = await expandBomLines(p, bom.lines.map(({ key, amount, why, group }) => ({ key, amount, why, ...(group === undefined ? {} : { group }) })), settings, emptyContextForTest());
    expect(Object.keys(r).sort()).toEqual(['lines', 'totals']);
    expect(r.totals).toEqual(bom.totals);
  });
  it('breaks the build list down at the line\'s prices, the same in expandBomLines, with a derived leaf and a stop item', async () => {
    // The line bends U from D (an alloy of 3 X, mined nowhere) and assembles T from U and S (4 Y, which the group says it
    // already makes). Its assembler is crafted from 1 D or 2 P, its bender from 1 S or 2 Q. At plain prices D and S cost
    // 1 each; the line buys D at what its chain costs (3) and S at the cost model's 4, so both machines are made from
    // P and Q, and expandBomLines, given the same top-level lines, breaks them down at those same prices.
    const dust = (key: string, material: string) => ({ key, name: `${material} Dust`, gt: { prefix: 'dust', material } });
    const vein = (material: string) => ({ name: `ore.mix.${material}`, dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
      materials: { primary: material, secondary: material, between: material, sporadic: material } });
    const p = packFromSpec({
      items: [dust('x@0', 'X'), dust('y@0', 'Y'), dust('p@0', 'P'), dust('q@0', 'Q'), { key: 'd@0', name: 'D Ingot', gt: { prefix: 'ingot', material: 'D' } },
              { key: 's@0', name: 'Stop Part' }, { key: 'u@0', name: 'U Part' }, { key: 't@0', name: 'Thing' }],
      maps: [{ id: 'gt.recipe.alloysmelter' }, { id: 'gt.recipe.assembler' }, { id: 'gt.recipe.metalbender' }, { id: 'crafting' }],
      machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }, { mteId: 2, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 },
                 { mteId: 3, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }],
      recipes: [{ id: 'make-d', map: 'gt.recipe.alloysmelter', in: [['x@0', 3]], out: [['d@0', 1]], eut: 16 },
                { id: 'make-s', map: 'gt.recipe.assembler', in: [['y@0', 4]], out: [['s@0', 1]], eut: 16 },
                { id: 'make-u', map: 'gt.recipe.metalbender', in: [['d@0', 1]], out: [['u@0', 1]], eut: 16 },
                { id: 'make-t', map: 'gt.recipe.assembler', in: [['u@0', 1], ['s@0', 1]], out: [['t@0', 1]], eut: 16 },
                { id: 'assembler-d', map: 'crafting', in: [['d@0', 1]], out: [['machine:1@0', 1]] },
                { id: 'assembler-p', map: 'crafting', in: [['p@0', 2]], out: [['machine:1@0', 1]] },
                { id: 'bender-s', map: 'crafting', in: [['s@0', 1]], out: [['machine:2@0', 1]] },
                { id: 'bender-q', map: 'crafting', in: [['q@0', 2]], out: [['machine:2@0', 1]] }],
      worldgen: { veins: ['X', 'Y', 'P', 'Q'].map(vein) },
    });
    const settings = { ...defaultSettings(), tier: 1, target: 't@0', stopItems: ['s@0'], routeDerived: false };
    const plan = await planLine(p, settings, emptyContextForTest());
    expect(plan.status).toBe('ok');
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['d@0', 'derived'], ['s@0', 'stop']]);
    expect(plan.rawInputs.map((r) => Math.round(r.cost / r.perSecond * 1e6) / 1e6)).toEqual([3, 4]);   // per unit
    expect(plan.buildList.map((l) => l.key)).toEqual(['machine:1@0', 'machine:2@0']);
    expect(plan.buildTotals?.map((l) => [l.key, l.amount])).toEqual([['p@0', 2], ['q@0', 2]]);
    const top = plan.buildList.map(({ key, amount, why, group }) => ({ key, amount, why, ...(group === undefined ? {} : { group }) }));
    const r = await expandBomLines(p, top, settings, emptyContextForTest());
    expect(r.totals).toEqual(plan.buildTotals);
    expect(r.lines).toEqual(plan.buildList);
  });
  it('lists a hand-crafting tool once, not as a part that stays in a machine (Task 13 ruling)', async () => {
    const p = packFromSpec({ maps: [{ id: 'crafting' }],
      items: [{ key: 't:hammer@0', name: 'Hammer' }, { key: 't:iron_plate@0', name: 'Iron Plate' }],
      recipes: [{ id: 'hammer-plate', map: 'crafting', in: [['t:iron_ingot@0', 2], { nc: 't:hammer@0' }], out: [['t:iron_plate@0', 1]] }] });
    const settings = { ...defaultSettings(), tier: 1, target: 't:iron_plate@0', amount: 30, per: 'min' as const };
    const b = planBasis(p, settings, emptyContextForTest());
    const steps = [step({ id: 'hammer-plate', recipeId: 'hammer-plate', handCraft: true, count: 2, runsPerSecond: 0.5, mainOutput: 't:iron_plate@0', machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 } })];
    const bom = await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.lines.map((l) => [l.key, l.amount, l.why, l.group])).toEqual([['t:hammer@0', 1, '1× Hammer (tool for hand-crafting Iron Plate)', 'one-off']]);
    const out = buildSteps(p, { steps, bom, power: { peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 }, settings, tier: 1, target: 't:iron_plate@0' });
    expect(out.find((s) => s.id === 'craft:t:hammer@0')?.text).toBe('Make 1× Hammer (a tool for hand-crafting)');
    expect(out.find((s) => s.id === 'handcraft:hammer-plate')?.text).toBe('Hand-craft 30/min Iron Plate at a crafting table (tools: Hammer)');
    expect(out.find((s) => s.id === 'configure:hammer-plate')).toBeUndefined();
    expect(out.filter((s) => s.kind === 'configure')).toEqual([]);
  });
  it('keeps free inputs as leaves of a breakdown', async () => {
    // Fix spec R2: with a pump at LV a running line pumps its water (it is no leaf for the line), but the one-off
    // materials of its machines get no generator. The chemical bath is crafted from two parts that each take 500 L of it.
    const p = packFromSpec({
      ...MINI_GT,
      items: [...MINI_GT.items!, { key: 't:part@0', name: 'Bath Part' }],
      maps: [...MINI_GT.maps!, { id: 'gt.recipe.chemicalbath', name: 'Chemical Bath' }],
      machines: [...MINI_GT.machines!, { mteId: 171, name: 'Basic Chemical Bath', maps: ['gt.recipe.chemicalbath'], tier: 1 },
                 { mteId: 1140, name: 'Basic Pump', maps: [], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTEPump' }],
      recipes: [...MINI_GT.recipes!,
                { id: 'make-part', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1], ['fluid:water', 500]], out: [['t:part@0', 1]], eut: 16 },
                { id: 'make-bath', map: 'crafting', in: [['t:part@0', 2]], out: [['machine:171@0', 1]] }],
    });
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    expect(b.supplied.has('fluid:water')).toBe(true);
    expect(b.leaf('fluid:water').buyable).toBe(false);
    const steps = [step({ id: 'wash', recipeId: 'wash', machine: { mteId: 171, name: 'Basic Chemical Bath', tier: 1 } })];
    const bom = await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.totals.map((l) => [l.key, l.amount])).toEqual([['fluid:water', 1000], ['t:iron_ingot@0', 2]]);
    const r = await expandBomLines(p, [{ key: 'machine:171@0', amount: 1, why: '1× Basic Chemical Bath', group: 'machines' }], settings, emptyContextForTest());
    expect(r.totals).toEqual(bom.totals);
  });
  it('never makes an Empty Cell from a recipe that only hands it back', async () => {
    // Fix spec D15 (audit patch G-bom-containers): a reaction takes 3 Acid Cells and hands their Empty Cells back beside
    // a Gold Dust. Crediting the dust, the cost analysis prices that the cheapest Empty Cell (1 against 2 from tin), so
    // the assembler's breakdown asked for Acid Cells; an empty container is made from its own parts instead. (The Acid
    // Cell is made without a cell here, so the breakdown's loop guard cannot catch it.)
    const vein = (material: string) => ({ name: `ore.mix.${material}`, dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
      materials: { primary: material, secondary: material, between: material, sporadic: material } });
    const p = packFromSpec({
      items: [
        { key: 't:empty_cell@0', name: 'Empty Cell' }, { key: 't:acid_cell@0', name: 'Acid Cell' }, { key: 'machine:8@0', name: 'Basic Assembler' },
        { key: 't:tin_ingot@0', name: 'Tin Ingot', gt: { prefix: 'ingot', material: 'Tin' } },
        { key: 't:raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } },
        { key: 't:gold_dust@0', name: 'Gold Dust', gt: { prefix: 'dust', material: 'Gold' } },
      ],
      maps: [{ id: 'gt.recipe.chemicalreactor', name: 'Chemical Reactor' }, { id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'crafting' }],
      machines: [{ mteId: 7, name: 'Basic Chemical Reactor', maps: ['gt.recipe.chemicalreactor'], tier: 1 }, { mteId: 8, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
      recipes: [
        { id: 'react-acid', map: 'gt.recipe.chemicalreactor', in: [['t:acid_cell@0', 3], ['t:raw@0', 1]], out: [['t:gold_dust@0', 1], ['t:empty_cell@0', 3]], eut: 16 },
        { id: 'make-acid-cell', map: 'gt.recipe.chemicalreactor', in: [['t:raw@0', 1]], out: [['t:acid_cell@0', 1]], eut: 16 },
        { id: 'make-cell', map: 'gt.recipe.assembler', in: [['t:tin_ingot@0', 2]], out: [['t:empty_cell@0', 1]], eut: 16 },
        { id: 'craft-assembler', map: 'crafting', in: [['t:empty_cell@0', 1]], out: [['machine:8@0', 1]] },
      ],
      fluidContainers: [{ container: 't:acid_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:acid', amount: 1000 }],
      worldgen: { veins: ['Tin', 'Raw', 'Gold'].map(vein) },
    });
    const settings = { ...defaultSettings(), tier: 1 };
    const b = planBasis(p, settings, emptyContextForTest());
    const steps = [step({ id: 'make-acid-cell', recipeId: 'make-acid-cell', machine: { mteId: 8, name: 'Basic Assembler', tier: 1 } })];
    const bom = await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.lines.map((l) => [l.key, l.children?.map((c) => [c.key, c.amount, c.children?.map((g) => [g.key, g.amount])])])).toEqual([
      ['machine:8@0', [['t:empty_cell@0', 1, [['t:tin_ingot@0', 2]]]]]]);
    expect(bom.totals.map((l) => [l.key, l.amount])).toEqual([['t:tin_ingot@0', 2]]);
  });
  it('says which build lines need each total', async () => {
    // Fix spec D15 and ruling P18: each total names the top-level lines it is for, and their amounts add up to it.
    const named = packFromSpec({ ...MINI_GT, items: [...MINI_GT.items!, { key: 'machine:111@0', name: 'Basic Wiremill' }, { key: 'machine:121@0', name: 'Basic Assembler' }] });
    const steps = [step({ id: 'wire', recipeId: 'wire', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 } }),
                   step({ id: 'circuit-lv', recipeId: 'circuit-lv', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } })];
    const b = planBasis(named, { ...defaultSettings(), tier: 1 }, emptyContextForTest());
    const bom = await buildBom(named, steps, { settings: defaultSettings(), env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    // Top-level lines keep their own why.
    expect(bom.lines.map((l) => [l.key, l.why])).toEqual([
      ['machine:111@0', '1× Basic Wiremill'], ['machine:121@0', '1× Basic Assembler'], [PC, '1× Programmed Circuit (stays in the machine)']]);
    expect(bom.totals.length).toBeGreaterThan(0);
    for (const total of bom.totals) {
      const needs = total.neededFor ?? [];
      expect(needs.length, total.key).toBeGreaterThan(0);
      expect(needs.reduce((sum, n) => sum + n.amount, 0)).toBeCloseTo(total.amount, 9);
      expect(total.why).toBe(`for ${[...new Set(needs.map((n) => named.nameOf(n.key)))].join(', ')}`);
    }
    expect(bom.totals.find((t) => t.key === 't:copper_ingot@0')).toMatchObject({
      amount: 6, why: 'for Basic Wiremill, Basic Assembler', neededFor: [{ key: 'machine:111@0', amount: 4 }, { key: 'machine:121@0', amount: 2 }] });
    expect(bom.totals.find((t) => t.key === PC)).toMatchObject({ amount: 1, why: 'for Programmed Circuit', neededFor: [{ key: PC, amount: 1 }] });
    // expandBomLines gives Plan 5's parts the same totals (architecture §11.15).
    const r = await expandBomLines(named, bom.lines.map(({ key, amount, why, group }) => ({ key, amount, why, ...(group === undefined ? {} : { group }) })), { ...defaultSettings(), tier: 1 }, emptyContextForTest());
    expect(r.totals).toEqual(bom.totals);
  });
  it('names each line a total is for once, keeping every one in neededFor', async () => {
    // Two parts of one name (as programmed circuits of two configurations are) crafted from the same ingot.
    const vein = { name: 'ore.mix.iron', dims: ['overworld'], kind: 'vein' as const, weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
      materials: { primary: 'Iron', secondary: 'Iron', between: 'Iron', sporadic: 'Iron' } };
    const p = packFromSpec({ maps: [{ id: 'crafting' }],
      items: [{ key: 't:gear@0', name: 'Gear' }, { key: 't:gear@1', name: 'Gear' }, { key: 't:iron_ingot@0', name: 'Iron Ingot', gt: { prefix: 'ingot', material: 'Iron' } }],
      recipes: [{ id: 'gear-0', map: 'crafting', in: [['t:iron_ingot@0', 1]], out: [['t:gear@0', 1]] },
                { id: 'gear-1', map: 'crafting', in: [['t:iron_ingot@0', 1]], out: [['t:gear@1', 1]] }],
      worldgen: { veins: [vein] } });
    const r = await expandBomLines(p, [{ key: 't:gear@0', amount: 1, why: 'a' }, { key: 't:gear@1', amount: 2, why: 'b' }], { ...defaultSettings(), tier: 1 }, emptyContextForTest());
    expect(r.totals).toEqual([{ key: 't:iron_ingot@0', amount: 3, why: 'for Gear', neededFor: [{ key: 't:gear@0', amount: 1 }, { key: 't:gear@1', amount: 2 }] }]);
  });
  it('merges a hand-crafting tool with the same part an automated step keeps in its machine', async () => {
    const p = packFromSpec({ maps: [{ id: 'crafting' }],
      items: [{ key: 't:hammer@0', name: 'Hammer' }, { key: 't:iron_plate@0', name: 'Iron Plate' }],
      recipes: [{ id: 'hammer-plate', map: 'crafting', in: [['t:iron_ingot@0', 2], { nc: 't:hammer@0' }], out: [['t:iron_plate@0', 1]] }] });
    const settings = { ...defaultSettings(), tier: 1, target: 't:iron_plate@0', amount: 30, per: 'min' as const };
    const b = planBasis(p, settings, emptyContextForTest());
    const steps = [step({ id: 'auto-plate', recipeId: 'hammer-plate', count: 3, mainOutput: 't:iron_plate@0', machine: { mteId: 211, name: 'Basic Crafter', tier: 1 } }),
                   step({ id: 'hand-plate', recipeId: 'hammer-plate', handCraft: true, mainOutput: 't:iron_plate@0', machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 } })];
    const bom = await buildBom(p, steps, { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(bom.lines.map((l) => [l.key, l.amount, l.why, l.group])).toEqual([
      ['t:hammer@0', 4, '3× Hammer (stays in the machine); 1× Hammer (tool for hand-crafting Iron Plate)', 'one-off']]);
    const out = buildSteps(p, { steps, bom, power: { peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 }, settings, tier: 1, target: 't:iron_plate@0' });
    expect(out.find((s) => s.id === 'craft:t:hammer@0')?.text).toBe('Make 4× Hammer (stays in the machine)');
    expect(out.filter((s) => s.kind === 'configure').map((s) => [s.id, s.text])).toEqual([['configure:auto-plate', 'Put Hammer in the Basic Crafter that makes Iron Plate']]);
  });
});

describe('expandBomLines', () => {
  it('expands lines that do not come from plan steps, keeping their group and why', async () => {
    const ctx = { ...emptyContextForTest(), storage: new Map([['t:tin_cable@0', { total: 5, reachable: 1 }]]) };
    const r = await expandBomLines(pack, [{ key: 't:tin_cable@0', amount: 3, why: 'cable to the power tap', group: 'power' }], { ...defaultSettings(), tier: 1 }, ctx);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ key: 't:tin_cable@0', amount: 3, why: 'cable to the power tap', group: 'power', have: { total: 5, reachable: 1 } });
    expect(r.lines[0]?.children?.map((l) => [l.key, l.amount, l.why])).toEqual([['t:tin_ingot@0', 2, 'for 1x Tin Cable']]);   // 2 runs of 1 → 2
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:tin_ingot@0', 2]]);
  });
  it('copies where the stock sits into have (ruling R9)', async () => {
    const where = [{ kind: 'drawer', pos: [10, 64, -5] as [number, number, number], count: 64, reachable: true }];
    const ctx = { ...emptyContextForTest(), storage: new Map([['t:tin_cable@0', { total: 64, reachable: 64, where }]]) };
    const r = await expandBomLines(pack, [{ key: 't:tin_cable@0', amount: 3, why: 'cable to the power tap', group: 'power' }], { ...defaultSettings(), tier: 1 }, ctx);
    expect(r.lines[0]?.have).toEqual({ total: 64, reachable: 64, where });
  });
  it('never loops back, and takes the cheapest option of an ore-dictionary slot', async () => {
    const p = packFromSpec({ maps: [{ id: 'crafting' }],
      items: [{ key: 't:a@0', oreDict: ['logWood'] }, { key: 't:b@0', oreDict: ['logWood'] }],
      recipes: [
        { id: 'a-unpack', map: 'crafting', in: [['t:block@0', 1]], out: [['t:bar@0', 9]] },   // ties with c-bar and sorts first
        { id: 'b-pack', map: 'crafting', in: [['t:bar@0', 9]], out: [['t:block@0', 1]] },
        { id: 'c-bar', map: 'crafting', in: [['t:a@0', 1]], out: [['t:bar@0', 1]] },
        { id: 'frame', map: 'crafting', in: [['t:bar@0', 2], { any: [['t:a@0', 2], ['t:b@0', 1]] }], out: [['t:frame@0', 1]] }] });
    const r = await expandBomLines(p, [{ key: 't:frame@0', amount: 3, why: 'frames' }], { ...defaultSettings(), tier: 1 }, emptyContextForTest());
    expect(r.lines[0]?.children?.map((l) => [l.key, l.amount, l.children?.map((c) => [c.key, c.amount])])).toEqual([
      ['t:b@0', 3, undefined], ['t:bar@0', 6, [['t:a@0', 6]]]]);
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:a@0', 6], ['t:b@0', 3]]);
  });
  it('stops at a base material the group cannot reach yet', async () => {
    const settings = { ...defaultSettings(), tier: 3, coilHeat: 2701, dims: { policy: 'progression' as const, overrides: { moon: 'off' as const } } };
    const r = await expandBomLines(pack, [{ key: 't:titanium_plate@0', amount: 1, why: 'plate' }], settings, emptyContextForTest());
    expect(r.lines[0]?.children).toEqual([{ key: 't:titanium_ingot@0', amount: 1, why: 'for Titanium Plate' }]);
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:titanium_ingot@0', 1]]);
  });
});

describe('how each build part is made', () => {
  // Architecture §11 entry 41 (1)–(3): one recipe per good across the list, settled cheapest first, the machine of each
  // job, the parts nothing here makes, and the swap list.
  const at = (tier: number, p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), tier, ...p });
  /** Every node, depth first. */
  const all = (lines: readonly BomLine[]): BomLine[] => lines.flatMap((l) => [l, ...all(l.children ?? [])]);
  const unmade = (lines: readonly BomLine[]): BomLine[] => all(lines).filter((l) => l.unmade !== undefined);
  const childOf = (line: BomLine | undefined, key: string): BomLine | undefined => line?.children?.find((c) => c.key === key);
  const wiremillStep = step({ id: 'wire', recipeId: 'wire', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 } });

  it('says how each part of a machine is made', async () => {
    const wiremill = [{ key: 'machine:111@0', amount: 1, why: 'wiremill' }];
    const r = await expandBomLines(pack, wiremill, at(1), emptyContextForTest());
    const top = r.lines[0];
    expect(top?.made).toEqual({ recipeId: 'make-111', mapId: 'crafting', machine: 'crafting table', runs: 1 });
    // the programmed circuit is the circuit's only held part
    expect(childOf(top, 't:circuit@0')?.amount).toBe(2);
    expect(childOf(top, 't:circuit@0')?.made).toEqual({
      recipeId: 'circuit-lv', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1, source: 'new' }, runs: 2, circuit: 2 });
    expect(childOf(top, 't:copper_wire@0')?.amount).toBe(4);
    expect(childOf(top, 't:copper_wire@0')?.made).toEqual({
      recipeId: 'wire', mapId: 'gt.recipe.wiremill', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1, source: 'new' }, runs: 2 });
    expect(childOf(top, 't:hull_lv@0')?.amount).toBe(1);
    expect(childOf(top, 't:hull_lv@0')?.made).toEqual({ recipeId: 'hull-lv', mapId: 'crafting', machine: 'crafting table', runs: 1 });
    const ingot = childOf(childOf(top, 't:copper_wire@0'), 't:copper_ingot@0');
    expect(ingot?.amount).toBe(2);
    expect([ingot?.made, ingot?.unmade]).toEqual([undefined, undefined]);
    // an assembler the group has
    const owned = await expandBomLines(pack, wiremill, at(1), { ...emptyContextForTest(), ownedMachines: [{ mteId: 121, count: 1 }] });
    expect(childOf(owned.lines[0], 't:circuit@0')?.made?.machine).toEqual({ mteId: 121, name: 'Basic Assembler', tier: 1, source: 'owned' });
    // At MV circuit-mv is the cheaper circuit: 2 × 0.5 + 1 + 72 L × 1/144 = 2.5 against circuit-lv's 1 + 2 × 0.5 + 1 = 3.
    const mv = await expandBomLines(pack, wiremill, at(2), emptyContextForTest());
    const circuit = childOf(mv.lines[0], 't:circuit@0');
    expect(circuit?.made).toEqual({
      recipeId: 'circuit-mv', mapId: 'gt.recipe.assembler', machine: { mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'new' }, runs: 2 });
    const molten = childOf(circuit, 'fluid:molten.iron');
    expect(molten?.amount).toBe(144);
    expect(molten?.made).toEqual({
      recipeId: 'extract-iron', mapId: 'gt.recipe.fluidextractor', machine: { mteId: 131, name: 'Basic Fluid Extractor', tier: 1, source: 'new' }, runs: 1 });
  });

  it('marks the wiremill a line builds when its own build needs the wires', async () => {
    const bom = await buildBom(pack, [wiremillStep], opts);
    const wires = all(bom.lines).filter((l) => l.key === 't:copper_wire@0');
    expect(wires).toHaveLength(2);   // the wiremill's own 4, and the 4 of its 2 circuits
    for (const wire of wires) expect(wire.made?.machine).toEqual({ mteId: 111, name: 'Basic Wiremill', tier: 1, source: 'first' });
  });

  it('lists every recipe of a build part for the swap', async () => {
    const bom = await buildBom(pack, [wiremillStep], opts);
    expect(bom.alternatives?.get('t:iron_plate@0')).toEqual([
      { recipeId: 'bend-plate', rawCost: 1, mapId: 'gt.recipe.metalbender', inputs: [{ key: 't:iron_ingot@0', amount: 1 }], outputs: [{ key: 't:iron_plate@0', amount: 1 }] },
      { recipeId: 'hammer-plate', rawCost: 2, mapId: 'crafting', inputs: [{ key: 't:iron_ingot@0', amount: 2 }], outputs: [{ key: 't:iron_plate@0', amount: 1 }] },
    ]);
    const plan = await planLine(pack, { ...defaultSettings(), target: 't:copper_wire@0', tier: 1, amount: 1, per: 'min' }, emptyContext());
    expect(plan.buildAlternatives?.['t:iron_plate@0']?.map((a) => a.recipeId)).toEqual(['bend-plate', 'hammer-plate']);
    expect(plan.names?.['map:gt.recipe.metalbender']).toBe('Bending Machine');
  });

  it('leaves a recipe above a material out of reach off the swap list', async () => {
    // Titanium comes from the Moon, which is off: the Titanium Ingot settles at Infinity (architecture §11 entry 41 (1)),
    // and so does every recipe above it. The swap list keeps only the rows at a finite gross cost (entry 41 (3)), as a
    // step's does: JSON would send an Infinity as null. A Basic Centrifuge crafted from one Titanium Plate is still made
    // that way, and neither it nor the plate gets a swap list.
    const settings = (p: Partial<PlanSettings> = {}): PlanSettings => at(3, { coilHeat: 2701, dims: { policy: 'progression', overrides: { moon: 'off' } }, ...p });
    const centrifuge = [step({ id: 'lava-copper', recipeId: 'lava-copper', machine: { mteId: 161, name: 'Basic Centrifuge', tier: 1 } })];
    const bomOf = async (p: ReturnType<typeof packFromSpec>, s: PlanSettings) => {
      const b = planBasis(p, s, emptyContextForTest());
      return buildBom(p, centrifuge, { settings: s, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    };
    const rawCosts = (bom: Awaited<ReturnType<typeof buildBom>>): number[] => [...(bom.alternatives?.values() ?? [])].flat().map((a) => a.rawCost);
    const fromTitanium: RecipeSpec = { id: 'make-161', map: 'crafting', in: [['t:titanium_plate@0', 1]], out: [['machine:161@0', 1]] };
    const bom = await bomOf(packFromSpec({ ...MINI_GT, recipes: [...MINI_GT.recipes!, fromTitanium] }), settings());
    expect(bom.lines[0]?.made?.recipeId).toBe('make-161');
    expect(bom.totals.map((l) => [l.key, l.amount])).toEqual([['t:titanium_ingot@0', 1]]);
    expect(bom.alternatives?.get('t:titanium_plate@0')).toBeUndefined();
    expect(bom.alternatives?.get('machine:161@0')).toBeUndefined();
    expect(rawCosts(bom).every(Number.isFinite)).toBe(true);

    // Pinned beside a recipe from three Iron Plates (`pinnedBeside` keeps both in the book), the Titanium Plate recipe
    // still settles the Centrifuge, at Infinity, and the build follows it; its row leaves the list, the other one stays.
    const pinned = await bomOf(packFromSpec({ ...MINI_GT, recipes: [...MINI_GT.recipes!, fromTitanium,
      { id: 'make-161b', map: 'crafting', in: [['t:iron_plate@0', 3]], out: [['machine:161@0', 1]] }] }), settings({ recipeChoice: { 'machine:161@0': 'make-161' } }));
    expect(pinned.lines[0]?.made?.recipeId).toBe('make-161');
    expect(pinned.alternatives?.get('machine:161@0')?.map((a) => [a.recipeId, a.rawCost])).toEqual([['make-161b', 3]]);
    expect(pinned.alternatives?.get('t:titanium_plate@0')).toBeUndefined();
    expect(rawCosts(pinned)).toEqual([3]);
  });

  it('uses a pinned recipe for every node of that good', async () => {
    const pinned = { ...opts, settings: { ...defaultSettings(), recipeChoice: { 't:iron_plate@0': 'hammer-plate' } } };
    const bom = await buildBom(pack, [wiremillStep], pinned);
    const plates = all(bom.lines).filter((l) => l.key === 't:iron_plate@0');
    expect(plates).toHaveLength(2);
    for (const plate of plates) expect([plate.made?.recipeId, plate.made?.machine]).toEqual(['hammer-plate', 'crafting table']);
    // the book keeps the plate's other producer beside the pin (`pinnedBeside`)
    expect(bom.alternatives?.get('t:iron_plate@0')?.map((a) => a.recipeId)).toEqual(['bend-plate', 'hammer-plate']);
    // 10 plates × 2 ingots: 8 in the hull, 2 in the circuits
    expect(bom.totals.find((t) => t.key === 't:iron_ingot@0')?.amount).toBe(20);

    // The pin settles X once Z settles from copper, so Z takes z2 rather than the z1 its X would loop through.
    const r = await expandBomLines(packFromSpec(loopSpec()), [{ key: 't:x@0', amount: 1, why: 'x' }], at(1, { recipeChoice: { 't:x@0': 'x1' } }), emptyContextForTest());
    const x = r.lines[0];
    expect(x?.made?.recipeId).toBe('x1');
    expect(childOf(x, 't:y@0')?.made?.recipeId).toBe('y1');
    expect(childOf(childOf(x, 't:y@0'), 't:z@0')?.made?.recipeId).toBe('z2');
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:copper_ingot@0', 5]]);
  });

  it('falls back from a pin that needs the good itself', async () => {
    // X by Y, Y by Z, Z by X: neither pin settles, so the first pin by key, X's, is dropped; Z's pin z1 stands.
    const r = await expandBomLines(packFromSpec(loopSpec()), [{ key: 't:x@0', amount: 1, why: 'x' }],
      at(1, { recipeChoice: { 't:x@0': 'x1', 't:z@0': 'z1' } }), emptyContextForTest());
    expect(r.lines[0]?.made?.recipeId).toBe('x2');
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:copper_ingot@0', 3]]);
    expect(unmade(r.lines)).toEqual([]);
  });

  it('makes each good one way across the build list', async () => {
    // X settles at 3 by x2, then Z at 3 by z1 before z2's 5; Y and x1 come after.
    const r = await expandBomLines(packFromSpec(loopSpec()), [{ key: 't:z@0', amount: 1, why: 'z' }, { key: 't:x@0', amount: 1, why: 'x' }], at(1), emptyContextForTest());
    expect(r.lines[0]?.made?.recipeId).toBe('z1');
    expect(all(r.lines).filter((l) => l.key === 't:x@0').map((l) => l.made?.recipeId)).toEqual(['x2', 'x2']);
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:copper_ingot@0', 6]]);
  });

  it('marks a part nothing at the tier makes', async () => {
    const r = await expandBomLines(pack, [{ key: 'machine:1000@0', amount: 1, why: 'ebf' }], at(1), emptyContextForTest());
    expect(r.lines[0]).toEqual({ key: 'machine:1000@0', amount: 1, why: 'ebf', unmade: 'no-recipe' });
    expect(r.totals).toEqual([
      { key: 'machine:1000@0', amount: 1, why: 'for machine:1000@0', neededFor: [{ key: 'machine:1000@0', amount: 1 }], unmade: 'no-recipe' }]);
  });

  it('marks a part whose every recipe needs its own chain', async () => {
    // W's only recipe takes V, whose only recipe takes W.
    const r = await expandBomLines(packFromSpec(loopSpec()), [{ key: 't:w@0', amount: 1, why: 'w' }], at(1), emptyContextForTest());
    expect(r.lines[0]).toEqual({ key: 't:w@0', amount: 1, why: 'w', unmade: 'own-chain' });
    expect(r.totals).toEqual([{ key: 't:w@0', amount: 1, why: 'for Part W', neededFor: [{ key: 't:w@0', amount: 1 }], unmade: 'own-chain' }]);
  });

  it('chooses the recipes below the depth the list shows', async () => {
    const r = await expandBomLines(packFromSpec(deepSpec()), [{ key: 't:d0@0', amount: 1, why: 'deep' }], at(1), emptyContextForTest());
    let node = r.lines[0];
    for (let depth = 0; depth < 12; depth++) {
      expect(node?.key).toBe(`t:d${depth}@0`);
      node = node?.children?.[0];
    }
    expect(node?.key).toBe('t:d12@0');
    expect(node?.made).toEqual({ recipeId: 'deep-12', mapId: 'crafting', machine: 'crafting table', runs: 1 });
    expect(node?.children).toBeUndefined();
    expect(unmade(r.lines)).toEqual([]);
  });

  it('never makes a part by unpacking its own packed form', async () => {
    const r = await expandBomLines(packFromSpec(packedTableSpec()), [{ key: 't:table@0', amount: 1, why: 'table' }], at(1), emptyContextForTest());
    expect(r.lines[0]?.made?.recipeId).toBe('table');
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:copper_ingot@0', 4]]);
    expect(unmade(r.lines)).toEqual([]);
  });

  it('never takes a circuit stand-in where the real circuits will do', async () => {
    const r = await expandBomLines(packFromSpec(standInPressSpec()), [{ key: 'machine:102@0', amount: 1, why: 'bender' }], at(1), emptyContextForTest());
    const sensor = childOf(r.lines[0], 't:sensor@0');
    expect(sensor?.children?.map((c) => [c.key, c.amount, c.made?.recipeId])).toEqual([['t:circuit@0', 2, 'circuit-lv'], ['t:iron_plate@0', 1, 'bend-plate']]);
    expect(all(r.lines).map((l) => l.key)).not.toContain(ANY_LV_CIRCUIT);
    expect(r.totals.map((l) => l.key)).not.toContain(ANY_LV_CIRCUIT);
    expect(unmade(r.lines)).toEqual([]);
  });

  it('settles a cost tie by the route that burns less free input', async () => {
    // Architecture §11 entry 41 (1): a Shield Plate is assembled from Iron Dust with 1,000 L of Helium (centrifuged from
    // free Air) or without; both cost 1, and the plain one wins, though a-gas sorts first by id. (The 2.9 export's
    // Aluminium Ingot: its plain EBF recipe ties its gas variants, so ties settled by id asked for millions of litres of
    // Air.) A Basic Centrifuge crafted from one Shield Plate shows the swap list, which expandBomLines does not return.
    const p = packFromSpec({
      ...MINI_GT,
      items: [...MINI_GT.items!, { key: 't:shield@0', name: 'Shield Plate' }],
      fluids: [...MINI_GT.fluids!, { key: 'fluid:helium', name: 'Helium' }],
      recipes: [...MINI_GT.recipes!,
                { id: 'air-helium', map: 'gt.recipe.centrifuge', in: [['fluid:air', 8000]], out: [['fluid:helium', 10]], eut: 16 },
                { id: 'a-gas', map: 'gt.recipe.assembler', in: [['t:iron_dust@0', 1], ['fluid:helium', 1000]], out: [['t:shield@0', 1]], eut: 16 },
                { id: 'b-plain', map: 'gt.recipe.assembler', in: [['t:iron_dust@0', 1]], out: [['t:shield@0', 1]], eut: 16 },
                { id: 'make-161', map: 'crafting', in: [['t:shield@0', 1]], out: [['machine:161@0', 1]] }],
    });
    const r = await expandBomLines(p, [{ key: 't:shield@0', amount: 1, why: 'shield' }], at(1), emptyContextForTest());
    expect(r.lines[0]?.made?.recipeId).toBe('b-plain');
    expect(r.totals.map((l) => [l.key, l.amount])).toEqual([['t:iron_dust@0', 1]]);
    const settings = at(1);
    const b = planBasis(p, settings, emptyContextForTest());
    const bom = await buildBom(p, [step({ id: 'air-helium', recipeId: 'air-helium', machine: { mteId: 161, name: 'Basic Centrifuge', tier: 1 } })],
      { settings, env: b.env, leaf: b.leaf, ctx: emptyContextForTest() });
    expect(childOf(bom.lines[0], 't:shield@0')?.made?.recipeId).toBe('b-plain');
    expect(bom.alternatives?.get('t:shield@0')?.map((a) => [a.recipeId, a.rawCost])).toEqual([['a-gas', 1], ['b-plain', 1]]);
  });
});

describe('buildSteps', () => {
  it('orders the build and keeps ids stable', async () => {
    const steps = [step({ id: 'circuit-lv', recipeId: 'circuit-lv', count: 5, owned: 2, circuit: 2, mainOutput: 't:circuit@0', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } }),
                   step({ id: 'hammer-plate', recipeId: 'hammer-plate', handCraft: true, runsPerSecond: 0.5, mainOutput: 't:iron_plate@0', machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 } })];
    const bom = await buildBom(pack, steps, opts);
    const settings = { ...defaultSettings(), target: 't:circuit@0', amount: 30, per: 'min' as const };
    const out = buildSteps(pack, { steps, bom, power: { peakEUt: 80, averageEUt: 80, voltageTier: 1, amps: 3 }, settings, tier: 1, target: 't:circuit@0' });
    expect(out.map((s) => s.id)).toEqual(['gather', 'craft:machine:121@0', `craft:${PC}`, 'place', 'power', 'logistics:direct', 'configure:circuit-lv', 'handcraft:hammer-plate', 'test']);
    expect(out.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.find((s) => s.id === 'handcraft:hammer-plate')?.text).toBe('Hand-craft 30/min Iron Plate at a crafting table');
    expect(out.find((s) => s.id === 'place')?.text).toBe('Place the machines: 3× Basic Assembler; reuse your 2× Basic Assembler');
    expect(out.find((s) => s.id === 'configure:circuit-lv')?.text).toBe('Put a Programmed Circuit set to 2 in the Basic Assembler that makes Basic Circuit');
    expect(out.at(-1)?.text).toBe('Run the line and check it makes 30 Basic Circuit per minute');
  });
  it('words the base materials, crafts, power and a Make N batch', async () => {
    const steps = [step({ id: 'wire', recipeId: 'wire', runs: 5, mainOutput: 't:copper_wire@0', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 } }),
                   step({ id: 'circuit-lv', recipeId: 'circuit-lv', owned: 1, runs: 5, circuit: 2, mainOutput: 't:circuit@0', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 } }),
                   step({ id: 'cable', recipeId: 'cable', handCraft: true, runs: 3, mainOutput: 't:tin_cable@0', machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 } })];
    const settings = { ...defaultSettings(), target: 't:circuit@0', mode: 'makeN' as const, amount: 10, logistics: 'ae2' as const };
    const bom = await buildBom(pack, steps, { ...opts, settings });
    const out = buildSteps(pack, { steps, bom, power: { peakEUt: 24, averageEUt: 24, voltageTier: 1, amps: 1 }, settings, tier: 1, target: 't:circuit@0', totalSeconds: 115 });
    const text = (id: string) => out.find((s) => s.id === id)?.text;
    expect(out.map((s) => s.id)).toEqual(['gather', 'craft:machine:111@0', `craft:${PC}`, 'place', 'power', 'logistics:ae2', 'configure:circuit-lv', 'handcraft:cable', 'test']);
    expect(text('gather')).toBe('Gather the base materials: 1× Programmed Circuit, 4× Copper Ingot, 10× Iron Ingot, 2× Redstone, 1× Tin Ingot');
    expect(text(`craft:${PC}`)).toBe('Make 1× Programmed Circuit (stays in the machine)');
    expect(text('place')).toBe('Place the machines: 1× Basic Wiremill; reuse your 1× Basic Assembler');
    expect(text('power')).toBe('Connect power: up to 24 EU/t at LV — never feed a machine more than its tier\'s voltage');
    expect(text('logistics:ae2')).toBe('Give every machine an ME interface with its patterns');
    expect(text('handcraft:cable')).toBe('Hand-craft 3× 1x Tin Cable at a crafting table');
    expect(out.at(-1)?.text).toBe('Run the batch: 10× Basic Circuit in about 2 min');
  });
  it('shortens a long gather list and leaves out steps the line does not need', () => {
    const totals = 'abcdefghij'.split('').map((c) => ({ key: `t:${c}@0`, amount: 1, why: 'base material' }));
    const steps = [step({ id: 'planks', recipeId: 'planks', handCraft: true, runsPerSecond: 0.25, mainOutput: 'minecraft:planks@0', machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 } })];
    const settings = { ...defaultSettings(), target: 'minecraft:planks@0', amount: 60, per: 'hour' as const, logistics: 'routed' as const };
    const out = buildSteps(pack, { steps, bom: { lines: [], totals, warnings: [] }, power: { peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 }, settings, tier: 1, target: 'minecraft:planks@0' });
    expect(out.map((s) => [s.id, s.kind])).toEqual([['gather', 'gather'], ['logistics:routed', 'logistics'], ['handcraft:planks', 'handcraft'], ['test', 'test']]);
    // An unnamed plain item key at meta 0 reads as its id (`partName`).
    expect(out[0]?.text).toBe('Gather the base materials: 1× t:a, 1× t:b, 1× t:c, 1× t:d, 1× t:e, 1× t:f, 1× t:g, 1× t:h (and 2 more)');
    expect(out.find((s) => s.id === 'handcraft:planks')?.text).toBe('Hand-craft 900/h Oak Planks at a crafting table');
    expect(out.at(-1)?.text).toBe('Run the line and check it makes 60 Oak Planks per hour');
  });
  it('writes litres for fluids in build steps', () => {
    // Spec §6.1: counts of things keep their "×", fluids are amounts in litres.
    const totals = [{ key: 'fluid:water', amount: 1000, why: 'base material' }, { key: 't:iron_ingot@0', amount: 3, why: 'base material' }];
    const settings = { ...defaultSettings(), target: 'fluid:molten.iron', mode: 'makeN' as const, amount: 1440 };
    const out = buildSteps(pack, { steps: [], bom: { lines: [], totals, warnings: [] }, power: { peakEUt: 0, averageEUt: 0, voltageTier: 0, amps: 0 }, settings, tier: 1, target: 'fluid:molten.iron' });
    const gather = out.find((s) => s.id === 'gather')?.text;
    expect(gather).toContain('1,000 L Water');
    expect(gather).toContain('3× Iron Ingot');
    expect(gather).toBe('Gather the base materials: 1,000 L Water, 3× Iron Ingot');
    expect(out.at(-1)?.text).toBe('Run the batch: 1,440 L Molten Iron');
  });
});

describe('partName', () => {
  it('names every build part, a machine named after its key and a variant block alike', async () => {
    // Architecture §11 entry 41 (8): a key the pack names only after itself reads as the machine whose item it is, as a
    // variant of its meta-0 block, or as its id; the plan's names and every build step name it so.
    const p = packFromSpec(variantCellSpec());
    expect(partName(p, 't:firebrick@0')).toBe('Firebrick');
    expect(partName(p, 't:firebrick@3')).toBe('Firebrick (variant 3)');   // make-firebrick-3's output: an item named after its key
    expect(partName(p, 'x:mystery@0')).toBe('x:mystery');
    expect(partName(p, 'x:mystery@3')).toBe('x:mystery (meta 3)');
    expect(partName(p, 'fluid:molten.iron')).toBe('Molten Iron');
    expect(partName(p, 'machine:1200@0')).toBe('Bricked Furnace');   // an item named after its key in the pack
    expect(partName(p, 'machine:1000@0')).toBe('Electric Blast Furnace');   // no recipe makes the EBF: the pack has no item for it

    // The Bricked Furnace's `bake`: its controller, 3 Firebricks and the variant one in its structure.
    const plan = await planLine(p, { ...defaultSettings(), target: 't:steel_ingot@0', tier: 1, amount: 1, per: 'min' }, emptyContext());
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    const lines = plan.buildList.map((l) => [l.key, l.amount]);
    expect(lines).toContainEqual(['machine:1200@0', 1]);
    expect(lines).toContainEqual(['t:firebrick@0', 3]);
    expect(lines).toContainEqual(['t:firebrick@3', 1]);
    expect(plan.names?.['t:firebrick@3']).toBe('Firebrick (variant 3)');
    expect(plan.names?.['machine:1200@0']).toBe('Bricked Furnace');
    const text = (id: string) => plan.buildSteps.find((s) => s.id === id)?.text;
    expect(text('craft:t:firebrick@3')).toMatch(/^Craft 1× Firebrick \(variant 3\)( |$)/);
    expect(text('craft:machine:1200@0')).toMatch(/^Craft 1× Bricked Furnace( |$)/);
    for (const s of plan.buildSteps) {
      expect(s.text, s.id).not.toContain('machine:');
      expect(s.text, s.id).not.toContain('t:firebrick');
    }
  });
});
