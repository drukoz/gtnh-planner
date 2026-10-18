import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { solveLine, findBlockers } from '../../../src/server/planner/solve.ts';
import { buildCandidates, type PlanEnv, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { makeLeafOracle, makePrices } from '../../../src/server/planner/costs.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

const mini = miniGt();
function graphFor(pack: Pack, target: string, tier: number, leaf?: LeafOracle) {
  const env: PlanEnv = { tier, reachable: reachableDims(pack.worldgen, { policy: 'progression', overrides: {} }, [], tier).keys,
    lowGravity: false, coilHeat: 2701, excluded: new Set(defaultSettings().excludedCategories) };
  const l = leaf ?? makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env), makePrices(pack, {}));
  return buildCandidates(pack, defaultSettings(), env, l, [target]);
}
const one = (k: string) => new Map([[k, 1]]);

describe('solveLine', () => {
  it('uses the least raw material at LV', async () => {
    const s = await solveLine(graphFor(mini, 't:circuit@0', 1), one('t:circuit@0'));
    expect(s.status).toBe('ok');
    expect(s.rawCost).toBeCloseTo(3, 9);
    expect([...s.runs.keys()]).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    expect(Object.fromEntries(s.buys)).toEqual({ 't:copper_ingot@0': 1, 't:iron_ingot@0': 1, 't:redstone@0': 1 });
  });
  it('switches to the cheaper MV recipe at MV', async () => {
    const s = await solveLine(graphFor(mini, 't:circuit@0', 2), one('t:circuit@0'));
    expect(s.rawCost).toBeCloseTo(2.5, 9);
    expect(s.runs.get('circuit-mv')).toBeCloseTo(1, 9);
    expect(s.runs.get('extract-iron')).toBeCloseTo(0.5, 9);
    expect(s.runs.has('circuit-lv')).toBe(false);
  });
  it('counts usable byproducts as savings', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'both', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['a@0', 1], ['b@0', 1]], eut: 2 },
                { id: 'only-a', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['a@0', 1]], eut: 2 },
                { id: 'only-b', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['b@0', 1]], eut: 2 },
                { id: 'make-t', map: 'gt.recipe.macerator', in: [['a@0', 1], ['b@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 't@0', 1, leaf), one('t@0'));
    expect(s.rawCost).toBeCloseTo(1, 9);
    expect([...s.runs.keys()]).toEqual(['both', 'make-t']);
  });
  it('breaks raw-cost ties by power', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'hungry', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['t@0', 1]], eut: 30, dur: 100 },
                { id: 'frugal', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['t@0', 1]], eut: 4, dur: 100 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    expect([...(await solveLine(graphFor(p, 't@0', 1, leaf), one('t@0'))).runs.keys()]).toEqual(['frugal']);
  });
  it('never makes something from nothing', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'loop-a', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 2]], eut: 2 },
                { id: 'loop-b', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]], eut: 2 },
                { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 'y@0', 1, leaf), one('y@0'));
    expect([...s.runs.keys()]).toEqual(['honest']);
    expect(s.warnings).toEqual([expect.objectContaining({ code: 'free-loop', text: expect.stringContaining('loop-a') })]);
  });
  it('free inputs are still inputs (water electrolysis is not a loop)', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'E', maps: ['gt.recipe.electrolyzer'], tier: 1 }],
      recipes: [{ id: 'elec', map: 'gt.recipe.electrolyzer', in: [['fluid:water', 3000]], out: [['fluid:hydrogen', 2000], ['fluid:oxygen', 1000]], eut: 30, dur: 2000 }] });
    const leaf: LeafOracle = (k) => (k === 'fluid:water' ? { buyable: true, cost: 0, leafClass: 'free' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 'fluid:hydrogen', 1, leaf), one('fluid:hydrogen'));
    expect(s.status).toBe('ok');
    expect(s.warnings).toEqual([]);
    expect(s.sinks.get('fluid:oxygen')).toBeCloseTo(0.5, 9);
  });
  it('reports what blocks an impossible target', async () => {
    const lv = await solveLine(graphFor(mini, 't:titanium_plate@0', 1), one('t:titanium_plate@0'));
    expect(lv.status).toBe('infeasible');
    expect(lv.blockers).toEqual([{ key: 't:titanium_plate@0', reason: 'rejected', needTier: 2 }]);
    expect(findBlockers(graphFor(mini, 't:titanium_plate@0', 2))).toEqual([{ key: 't:titanium_ingot@0', reason: 'unavailable' }]);
  });
});

describe('loop guard and blockers', () => {
  const rawOnly: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  const loop = (): RecipeSpec[] => [{ id: 'loop-a', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 2]], eut: 2 },
                                    { id: 'loop-b', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]], eut: 2 }];
  const machines = [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }];
  it('bans only the loop, not the recipes that use its output', async () => {
    const p = packFromSpec({ machines, recipes: [...loop(),
      { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 },
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const s = await solveLine(graphFor(p, 't@0', 1, rawOnly), one('t@0'));
    expect(Object.fromEntries(s.runs)).toEqual({ honest: 1, 'make-t': 1 });
    expect(s.warnings).toEqual([{ code: 'free-loop', text: 'Ignored recipes that make t@0 from nothing (likely a recipe data loop): loop-a, loop-b' }]);
  });
  it('names what blocks a target only a loop makes', async () => {
    const s = await solveLine(graphFor(packFromSpec({ machines, recipes: loop() }), 'y@0', 1, rawOnly), one('y@0'));
    expect(s.status).toBe('infeasible');
    expect(s.blockers).toEqual([{ key: 'y@0', reason: 'no-recipe' }]);
    expect(s.warnings.map((w) => w.code)).toEqual(['free-loop']);
  });
  it('lists at most five blockers, once each, sorted by key', () => {
    const p = packFromSpec({ machines, recipes: [
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['f@0', 1], ['b@0', 1], ['e@0', 1], ['a@0', 1], ['d@0', 1], ['c@0', 1]], out: [['t@0', 1]], eut: 2 },
      { id: 'make-t2', map: 'gt.recipe.macerator', in: [['a@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    expect(findBlockers(graphFor(p, 't@0', 1, rawOnly)).map((b) => `${b.key} ${b.reason}`))
      .toEqual(['a@0 no-recipe', 'b@0 no-recipe', 'c@0 no-recipe', 'd@0 no-recipe', 'e@0 no-recipe']);
  });
});
