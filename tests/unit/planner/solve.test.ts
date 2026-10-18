import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { solveLine, findBlockers, standaloneCosts } from '../../../src/server/planner/solve.ts';
import {
  buildCandidates, type CandidateGraph, type GoodInfo, type LeafDecision, type LeafOracle, type LpRecipe, type PlanEnv,
} from '../../../src/server/planner/candidates.ts';
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
  it('prices a good at what making it on its own costs, never through the target', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'smelt', map: 'gt.recipe.macerator', in: [['iron@0', 1], ['coal@0', 1]], out: [['steel@0', 1], ['slag@0', 1]], eut: 2 },
      { id: 'magnetize', map: 'gt.recipe.macerator', in: [['steel@0', 1]], out: [['magnetic@0', 1]], eut: 2 },
      { id: 'use', map: 'gt.recipe.macerator', in: [['magnetic@0', 1]], out: [['t@0', 1]], eut: 2 },
      { id: 'other', map: 'gt.recipe.macerator', in: [['steel@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'iron@0' || k === 'coal@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const g = graphFor(p, 't@0', 1, leaf);
    const costs = await standaloneCosts(g, ['steel@0', 'magnetic@0', 'nowhere@0']);
    expect([...costs]).toEqual([['steel@0', 2], ['magnetic@0', 2], ['nowhere@0', undefined]]);   // the slag is sunk
    expect((await standaloneCosts(g, ['magnetic@0'], ['steel@0'])).get('magnetic@0')).toBe(Infinity);
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
    expect(s.warnings).toEqual([{ code: 'free-loop', text: 'Ignored 2 recipes that make t@0 from nothing (likely a recipe data loop): loop-a, loop-b' }]);
    expect(s.banned).toEqual(['loop-a', 'loop-b']);
  });
  it('keeps recipes that only share a no-gain cycle with a loop (cells filled and emptied)', async () => {
    // The real export's guard banned 58 recipes for an Electronic Circuit: every used recipe on any cycle, cell
    // fill/empty pairs and the salt water mixer among them. Only loop-a and loop-b make matter from nothing here.
    const p = packFromSpec({ machines, recipes: [...loop(),
      { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 },
      { id: 'fill', map: 'gt.recipe.macerator', in: [['cell@0', 1], ['y@0', 1]], out: [['y_cell@0', 1]], eut: 2 },
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['y_cell@0', 1]], out: [['t@0', 1], ['cell@0', 1]], eut: 2 },
      { id: 'cell', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['cell@0', 1]], eut: 2 }] });
    const s = await solveLine(graphFor(p, 't@0', 1, rawOnly), one('t@0'));
    expect(Object.fromEntries(s.runs)).toEqual({ fill: 1, honest: 1, 'make-t': 1 });
    expect(s.warnings).toEqual([{ code: 'free-loop', text: 'Ignored 2 recipes that make t@0 from nothing (likely a recipe data loop): loop-a, loop-b' }]);
    expect(s.banned).toEqual(['loop-a', 'loop-b']);
  });
  it('lets a recipe that consumes nothing (a rock breaker, a pond) make the target, without a loop warning', async () => {
    const p = packFromSpec({ machines, recipes: [{ id: 'breaker', map: 'gt.recipe.macerator', in: [{ nc: 'circuit@0' }], out: [['t@0', 1]], eut: 2 }] });
    const s = await solveLine(graphFor(p, 't@0', 1, rawOnly), one('t@0'));
    expect(s.status).toBe('ok');
    expect(Object.fromEntries(s.runs)).toEqual({ breaker: 1 });
    expect(s.warnings).toEqual([]);
  });
  it('names what blocks a target only a loop makes', async () => {
    const s = await solveLine(graphFor(packFromSpec({ machines, recipes: loop() }), 'y@0', 1, rawOnly), one('y@0'));
    expect(s.status).toBe('infeasible');
    expect(s.blockers).toEqual([{ key: 'y@0', reason: 'no-recipe' }]);
    expect(s.warnings.map((w) => w.code)).toEqual(['free-loop']);
  });
  it('gives up as infeasible, in one plain warning, when every round still finds a loop', async () => {
    // Six loops, loop i making i + 1 y per x: the guard bans the best one each round, five times, and the sixth remains.
    // The candidate walk keeps three producers of y, so the graph is the union of one walk per loop.
    const graphs = Array.from({ length: 6 }, (_, i) => graphFor(packFromSpec({ machines, recipes: [
      { id: `loop${i}-a`, map: 'gt.recipe.macerator', in: [[`x${i}@0`, 1]], out: [['y@0', i + 2]], eut: 2 },
      { id: `loop${i}-b`, map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [[`x${i}@0`, 1]], eut: 2 },
      { id: 'honest', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['y@0', 1]], eut: 2 },
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['t@0', 1]], eut: 2 }] }), 't@0', 1, rawOnly));
    const union: CandidateGraph = { ...graphs[0]!,
      recipes: [...new Map(graphs.flatMap((g) => g.recipes).map((r) => [r.id, r])).values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      goods: new Map(graphs.flatMap((g) => [...g.goods])) };
    expect(union.recipes.filter((r) => r.id.startsWith('loop'))).toHaveLength(12);
    const s = await solveLine(union, one('t@0'));
    expect(s.status).toBe('infeasible');
    expect(s.runs.size).toBe(0);
    expect(s.blockers).toEqual([]);
    expect(s.banned).toHaveLength(10);
    expect(s.warnings).toEqual([{ code: 'free-loop', text: expect.stringMatching(/^No honest way to make t@0 here: .* even after leaving out loop5-a, loop5-b, loop4-a, loop4-b, loop3-a and 5 more$/) }]);
  });
  it('names no blockers in a graph cut short at its recipe cap', async () => {
    const graph = graphFor(mini, 't:titanium_plate@0', 1);
    expect((await solveLine(graph, one('t:titanium_plate@0'))).blockers).not.toEqual([]);
    const cut = await solveLine({ ...graph, truncated: true }, one('t:titanium_plate@0'));
    expect([cut.status, cut.blockers]).toEqual(['infeasible', []]);
  });
  it('lists at most five blockers, once each, sorted by key', () => {
    const p = packFromSpec({ machines, recipes: [
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['f@0', 1], ['b@0', 1], ['e@0', 1], ['a@0', 1], ['d@0', 1], ['c@0', 1]], out: [['t@0', 1]], eut: 2 },
      { id: 'make-t2', map: 'gt.recipe.macerator', in: [['a@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    expect(findBlockers(graphFor(p, 't@0', 1, rawOnly)).map((b) => `${b.key} ${b.reason}`))
      .toEqual(['a@0 no-recipe', 'b@0 no-recipe', 'c@0 no-recipe', 'd@0 no-recipe', 'e@0 no-recipe']);
  });

  // make-t: x -> t, where an ingot x and its block b turn into each other with no gain (9 x <-> 1 b): both have producers
  // although nothing reachable makes either. `blocked` says the recipe that really makes x needs tier 4.
  const lpRecipe = (id: string, coeffs: Array<[string, number]>): LpRecipe =>
    ({ id, kind: 'recipe', mapId: 'gt.recipe.macerator', coeffs, euPerRun: 0, nonConsumed: [], needsCleanroom: false });
  const cycleGraph = (leafClass: LeafDecision['leafClass'], withBlocked: boolean): CandidateGraph => ({
    targets: ['t@0'],
    recipes: [lpRecipe('block-to-x', [['b@0', -1], ['x@0', 9]]), lpRecipe('make-t', [['t@0', 1], ['x@0', -1]]),
              lpRecipe('x-to-block', [['b@0', 1], ['x@0', -9]])],
    goods: new Map<string, GoodInfo>([['t@0', null], ['x@0', leafClass], ['b@0', leafClass]].map(([key, lc]) =>
      [key as string, { key: key as string, buyable: false, cost: 0, leafClass: lc as LeafDecision['leafClass'], virtual: false }])),
    blocked: new Map(withBlocked ? [['x@0', [{ recipeId: 'make-x', why: 'tier' as const, needTier: 4 }]]] : []),
    warnings: [],
  });
  it('names the out-of-reach good on a no-gain cycle (ingot <-> block)', async () => {
    const graph = cycleGraph('unavailable', true);
    expect(findBlockers(graph)).toEqual([{ key: 'x@0', reason: 'unavailable' }]);
    const s = await solveLine(graph, one('t@0'));
    expect(s.status).toBe('infeasible');
    expect(s.blockers).toEqual([{ key: 'x@0', reason: 'unavailable' }]);
  });
  it('names the rejected recipe of a good on a no-gain cycle', () => {
    expect(findBlockers(cycleGraph(null, true))).toEqual([{ key: 'x@0', reason: 'rejected', needTier: 4 }]);
  });
  it('names the target when nothing on its no-gain cycle says more', () => {
    expect(findBlockers(cycleGraph(null, false))).toEqual([{ key: 't@0', reason: 'no-recipe' }]);
  });
  it('names an out-of-reach base material that the candidate graph expands into its cycle', async () => {
    const p = packFromSpec({ machines, recipes: [
      { id: 'block-to-x', map: 'gt.recipe.macerator', in: [['b@0', 1]], out: [['x@0', 9]], eut: 2 },
      { id: 'make-t', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['t@0', 1]], eut: 2 },
      { id: 'x-to-block', map: 'gt.recipe.macerator', in: [['x@0', 9]], out: [['b@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'x@0' || k === 'b@0' ? { buyable: false, cost: 0, leafClass: 'unavailable' } : rawOnly(k));
    const graph = graphFor(p, 't@0', 1, leaf);
    expect(graph.recipes.map((r) => r.id)).toEqual(['block-to-x', 'make-t', 'x-to-block']);
    const s = await solveLine(graph, one('t@0'));
    expect(s.status).toBe('infeasible');
    expect(s.blockers).toEqual([{ key: 'x@0', reason: 'unavailable' }]);
  });
});
