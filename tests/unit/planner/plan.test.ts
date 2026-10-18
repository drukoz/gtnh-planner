import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { planLine, emptyContext, settingsHash, planCacheKey, PlanCache, powerSummary } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { OreVein } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), ...p });
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
    expect(p.steps[0]?.alternatives).toEqual([{ recipeId: 'bend-plate', rawCost: 1, mapId: 'gt.recipe.metalbender' },
                                             { recipeId: 'hammer-plate', rawCost: 2, mapId: 'crafting' }]);
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
    expect(p.warnings).toContainEqual({ code: 'derived-leaf', key: 'steel@0',
      text: 'Steel Ingot is not mined anywhere you can reach; it is made by Alloy Smelter from Iron Ingot. Turn on "plan derived materials" to include that chain.' });
    const routed = await planLine(steel, S({ target: 'steel_plate@0', tier: 1, routeDerived: true }), emptyContext());
    expect(routed.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['iron@0', 'direct']]);
    expect(routed.warnings.map((w) => w.code)).not.toContain('derived-leaf');
  });
  it('keeps a stop item the line cannot make at its stop price, so its recipe stays an alternative', async () => {
    // At MV nothing reachable makes titanium ingots; the group says it already makes them.
    const p = await planLine(pack, S({ target: 't:titanium_plate@0', tier: 2, stopItems: ['t:titanium_ingot@0'] }), emptyContext());
    expect(p.status).toBe('ok');
    expect(p.rawInputs.map((r) => [r.key, r.leafClass, r.cost])).toEqual([['t:titanium_ingot@0', 'stop', 0.016666667]]);
    expect(p.steps[0]?.alternatives).toEqual([{ recipeId: 'bend-ti', rawCost: 1, mapId: 'gt.recipe.metalbender' }]);
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
      items: [{ key: 'raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } }, { key: 'y@0', name: 'Widget' }],
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'loop-a', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 2]], eut: 2 },
                { id: 'loop-b', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]], eut: 2 },
                { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 }],
      worldgen: { veins: [vein('ore.mix.raw', 'Raw')] },
    });
    const p = await planLine(loop, S({ target: 'y@0', tier: 1 }), emptyContext());
    expect(p.steps.map((s) => s.id)).toEqual(['honest']);
    expect(p.warnings).toEqual([{ code: 'free-loop', text: 'Ignored recipes that make Widget from nothing (likely a recipe data loop): loop-a, loop-b' }]);
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
