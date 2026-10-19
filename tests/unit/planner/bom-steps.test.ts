import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type IngredientSpec } from '../../helpers/pack-spec.ts';
import { buildBom, expandBomLines } from '../../../src/server/planner/bom.ts';
import { buildSteps } from '../../../src/server/planner/steps.ts';
import { planLine } from '../../../src/server/planner/plan.ts';
import { planBasis, effectiveTier } from '../../../src/server/planner/basis.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { makeLeafOracle, makePrices } from '../../../src/server/planner/costs.ts';
import { MAX_RECIPES, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import type { PlanStep } from '../../../src/shared/types/plan.ts';
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
    expect(bom.totals.map((l) => [l.key, l.amount])).toContainEqual(['t:b@0', 1]);   // never expanded, so it reads as a base material
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
    expect(out[0]?.text).toBe('Gather the base materials: 1× t:a@0, 1× t:b@0, 1× t:c@0, 1× t:d@0, 1× t:e@0, 1× t:f@0, 1× t:g@0, 1× t:h@0 (and 2 more)');
    expect(out.find((s) => s.id === 'handcraft:planks')?.text).toBe('Hand-craft 900/h Oak Planks at a crafting table');
    expect(out.at(-1)?.text).toBe('Run the line and check it makes 60 Oak Planks per hour');
  });
});
