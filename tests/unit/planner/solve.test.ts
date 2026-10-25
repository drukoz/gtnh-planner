import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { twinSpec } from '../../helpers/build-fixtures.ts';
import { packFromSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import {
  chainRecipes, solveLine, findBlockers, standaloneCosts, standalonePrices, twinMoves, withTwinsMoved, type Solution,
} from '../../../src/server/planner/solve.ts';
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

const RANDOM_AMOUNTS = [1, 1, 1, 1, 2, 2, 3, 4, 8, 9, 16, 0.5, 0.25];
/**
 * A random recipe graph, one per seed (fix wave 3 (D), the Task 2 review's generator): `goods` goods `g000@0`…, each
 * bought with chance 0.2 at 0.01–100, and `recipes` recipes `r0000`…, each taking one to three goods and making one or two
 * (a good drawn again is skipped), every amount drawn from RANDOM_AMOUNTS.
 */
function randomGraph(seed: number, goods: number, recipes: number): CandidateGraph {
  let state = seed;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const keyOf = (g: number): string => `g${String(g).padStart(3, '0')}@0`;
  const info = new Map<string, GoodInfo>();
  for (let g = 0; g < goods; g++) {
    const buyable = random() < 0.2;
    const cost = buyable ? Math.round((0.01 + random() * 100) * 1000) / 1000 : 0;
    info.set(keyOf(g), { key: keyOf(g), buyable, cost, leafClass: buyable ? 'direct' : null, virtual: false });
  }
  const list: LpRecipe[] = [];
  for (let r = 0; r < recipes; r++) {
    const inputs = 1 + Math.floor(random() * 3);
    const outputs = 1 + Math.floor(random() * 2);
    const coeffs = new Map<string, number>();
    for (let k = 0; k < inputs + outputs; k++) {
      const key = keyOf(Math.floor(random() * goods));
      if (coeffs.has(key)) continue;
      const amount = RANDOM_AMOUNTS[Math.floor(random() * RANDOM_AMOUNTS.length)] as number;
      coeffs.set(key, k < inputs ? -amount : amount);
    }
    list.push({
      id: `r${String(r).padStart(4, '0')}`, kind: 'recipe', mapId: 'gt.recipe.macerator', euPerRun: 0, nonConsumed: [], needsCleanroom: false,
      coeffs: [...coeffs].sort(([a], [b]) => (a < b ? -1 : 1)),
    });
  }
  return { targets: [], recipes: list, goods: info, blocked: new Map(), warnings: [] };
}

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
  it('prices a good at what making it on its own costs, never through the target, and names the recipes of that chain', async () => {
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'smelt', map: 'gt.recipe.macerator', in: [['iron@0', 1], ['coal@0', 1]], out: [['steel@0', 1], ['slag@0', 1]], eut: 2 },
      { id: 'magnetize', map: 'gt.recipe.macerator', in: [['steel@0', 1]], out: [['magnetic@0', 1]], eut: 2 },
      { id: 'use', map: 'gt.recipe.macerator', in: [['magnetic@0', 1]], out: [['t@0', 1]], eut: 2 },
      { id: 'other', map: 'gt.recipe.macerator', in: [['steel@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const leaf: LeafOracle = (k) => (k === 'iron@0' || k === 'coal@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const g = graphFor(p, 't@0', 1, leaf);
    const costs = await standaloneCosts(g, ['steel@0', 'magnetic@0', 'nowhere@0']);
    // The slag is sunk; magnetic steel takes the smelter and the polarizer (fix spec R7: its recipes, most runs first and
    // equal runs by id, and the one that makes it).
    expect([...costs]).toEqual([['steel@0', { cost: 2, steps: 1, free: 0, recipes: ['smelt'], top: 'smelt' }],
      ['magnetic@0', { cost: 2, steps: 2, free: 0, recipes: ['magnetize', 'smelt'], top: 'magnetize' }], ['nowhere@0', undefined]]);
    expect((await standaloneCosts(g, ['magnetic@0'], ['steel@0'])).get('magnetic@0')).toEqual({ cost: Infinity, steps: 0, free: 0, recipes: [] });
  });
  it('prices each good on its own, whatever else is asked, on the recipes its chain can use (fix wave 3 (D))', async () => {
    // One split of raw (1) makes A and B; C is made from B and a second raw (3); T takes two A and a C.
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'split', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['a@0', 1], ['b@0', 1]], eut: 2 },
      { id: 'b-to-c', map: 'gt.recipe.macerator', in: [['b@0', 1], ['raw2@0', 1]], out: [['c@0', 1]], eut: 2 },
      { id: 'use', map: 'gt.recipe.macerator', in: [['a@0', 2], ['c@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const raws: Record<string, number> = { 'raw@0': 1, 'raw2@0': 3 };
    const leaf: LeafOracle = (k) => (Object.hasOwn(raws, k)
      ? { buyable: true, cost: raws[k] as number, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const g = graphFor(p, 't@0', 1, leaf);
    expect(chainRecipes(g, ['c@0']).map((r) => r.id)).toEqual(['b-to-c', 'split']);
    expect(chainRecipes(g, ['t@0']).map((r) => r.id)).toEqual(['b-to-c', 'split', 'use']);
    // A: one split, its B sunk; C: a split's B and the second raw, its A sunk; T: two splits and the second raw.
    const prices = { 'a@0': 1, 'c@0': 4, 't@0': 5, 'nowhere@0': Infinity };
    const keys = Object.keys(prices);
    expect(Object.fromEntries(await standalonePrices(g, keys))).toEqual(prices);
    expect(Object.fromEntries(await standalonePrices(g, [...keys].reverse()))).toEqual(prices);
    for (const [key, price] of Object.entries(prices)) expect((await standalonePrices(g, [key])).get(key)).toBe(price);
  });
  it('gives each good of a random graph one price, alone, with every good and in reverse (fix wave 3 (D))', async () => {
    // Priced in one series of hot-started solves on one model (e6e0a36), g015@0 read 0.453210938 forward and 0.453210937
    // reversed here, and g026@0 2.71926563 alone and 2.71926562 with every good.
    const g = randomGraph(3, 80, 120);
    const keys = [...g.goods.keys()];
    const all = await standalonePrices(g, keys);
    expect([...all.values()].filter((price) => Number.isFinite(price))).toHaveLength(72);
    expect(Object.fromEntries(await standalonePrices(g, [...keys].reverse()))).toEqual(Object.fromEntries(all));
    const alone = new Map<string, number | undefined>();
    for (const key of keys) alone.set(key, (await standalonePrices(g, [key])).get(key));
    expect(Object.fromEntries(alone)).toEqual(Object.fromEntries(all));
  });
  it('never makes a good through a dead end, however little of it the chain needs (fix wave 3 (D))', async () => {
    // X made `made` a run from 0.05 Y, Y made `made2` a run from 0.05 Z, and nothing makes Z: one X takes 1.7e-8 Z at
    // 144 and 1,000, 6.25e-12 at 20,000 and 20,000, both within HiGHS's feasibility tolerance of none (e6e0a36 priced X
    // at 0 in both graphs). With `raw`, X is also made from a raw at 1.
    const recipe = (id: string, coeffs: Array<[string, number]>): LpRecipe =>
      ({ id, kind: 'recipe', mapId: 'gt.recipe.macerator', coeffs, euPerRun: 0, nonConsumed: [], needsCleanroom: false });
    const good = (key: string, cost?: number): [string, GoodInfo] =>
      [key, { key, buyable: cost !== undefined, cost: cost ?? 0, leafClass: cost === undefined ? null : 'direct', virtual: false }];
    const deadEnd = (made: number, made2: number, raw: boolean): CandidateGraph => ({
      targets: ['x@0'],
      recipes: [recipe('q', [['y@0', made2], ['z@0', -0.05]]), recipe('r', [['x@0', made], ['y@0', -0.05]]),
                ...(raw ? [recipe('s', [['raw@0', -1], ['x@0', 1]])] : [])],
      goods: new Map([good('x@0'), good('y@0'), good('z@0'), ...(raw ? [good('raw@0', 1)] : [])]),
      blocked: new Map(), warnings: [],
    });
    expect((await standalonePrices(deadEnd(144, 1000, false), ['x@0'])).get('x@0')).toBe(Infinity);
    expect((await standalonePrices(deadEnd(20000, 20000, true), ['x@0'])).get('x@0')).toBe(1);
  });

  it('names the chemistry behind a fluid, not the canner that empties its cells (fix spec R7)', async () => {
    // A reactor makes Gas Cells (1,000 L each) from 2 raw; a canner empties them; another canner fills cells again.
    const p = packFromSpec({
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [{ id: 'react', map: 'gt.recipe.macerator', in: [['raw@0', 2], ['cell@0', 1]], out: [['gas_cell@0', 1]], eut: 2 },
                { id: 'empty', map: 'gt.recipe.macerator', in: [['gas_cell@0', 1]], out: [['fluid:gas', 1000], ['cell@0', 1]], eut: 2 },
                { id: 'fill', map: 'gt.recipe.macerator', in: [['fluid:gas', 1000], ['cell@0', 1]], out: [['gas_cell@0', 1]], eut: 2 },
                { id: 'use', map: 'gt.recipe.macerator', in: [['fluid:gas', 1000]], out: [['t@0', 1]], eut: 2 }],
    });
    const leaf: LeafOracle = (k) => (k === 'raw@0' || k === 'cell@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const g = graphFor(p, 't@0', 1, leaf);
    const containers = [{ container: 'gas_cell@0', fluid: 'fluid:gas', amount: 1000 }];
    const costs = await standaloneCosts(g, ['fluid:gas', 'gas_cell@0'], [], containers);
    expect(costs.get('fluid:gas')).toMatchObject({ steps: 2, recipes: ['empty', 'react'], top: 'react' });
    expect(costs.get('gas_cell@0')).toMatchObject({ steps: 1, recipes: ['react'], top: 'react' });
    // Without the containers the canner is the only recipe that makes the gas itself.
    expect((await standaloneCosts(g, ['fluid:gas'])).get('fluid:gas')?.top).toBe('empty');
  });
  it('takes the plan with the fewest recipes among the cheapest, before power', async () => {
    // Both use one raw@0 per t@0; the two-step chain draws less power (80 EU against 60,000), the direct recipe is one step.
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'direct', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['t@0', 1]], eut: 30, dur: 2000 },
      { id: 'step-a', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['m@0', 1]], eut: 2, dur: 20 },
      { id: 'step-b', map: 'gt.recipe.macerator', in: [['m@0', 1]], out: [['t@0', 1]], eut: 2, dur: 20 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 't@0', 1, leaf), one('t@0'));
    expect(Object.fromEntries(s.runs)).toEqual({ direct: 1 });
    expect(s.rawCost).toBeCloseTo(1, 9);
  });
  it('counts recipes before any tie-break, however much power the fewer recipes draw', async () => {
    // One recipe at 6,000,000 EU a run, or two at 40 EU: the tie-breaks only choose among plans of the fewest recipes.
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'direct', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['t@0', 1]], eut: 30, dur: 200_000 },
      { id: 'step-a', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['m@0', 1]], eut: 2, dur: 20 },
      { id: 'step-b', map: 'gt.recipe.macerator', in: [['m@0', 1]], out: [['t@0', 1]], eut: 2, dur: 20 }] });
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 't@0', 1, leaf), one('t@0'));
    expect(Object.fromEntries(s.runs)).toEqual({ direct: 1 });
    // The same with free input: one recipe on 1,000,000 L of water, or two on none.
    const wet = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }], recipes: [
      { id: 'direct', map: 'gt.recipe.macerator', in: [['raw@0', 1], ['fluid:water', 1_000_000]], out: [['t@0', 1]], eut: 2 },
      { id: 'step-a', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['m@0', 1]], eut: 2 },
      { id: 'step-b', map: 'gt.recipe.macerator', in: [['m@0', 1]], out: [['t@0', 1]], eut: 2 }] });
    const freeWater: LeafOracle = (k) => (k === 'fluid:water' ? { buyable: true, cost: 0, leafClass: 'free' } : leaf(k));
    expect(Object.fromEntries((await solveLine(graphFor(wet, 't@0', 1, freeWater), one('t@0'))).runs)).toEqual({ direct: 1 });
  });
  it('breaks a fewest-recipes tie by free input first, then by power', async () => {
    // Oxygen from 10,000 L of air at 2 EU/t, or from 3,000 L of water at 30 EU/t: power alone would take the air.
    const p = packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.centrifuge', 'gt.recipe.electrolyzer'], tier: 1 }], recipes: [
      { id: 'air', map: 'gt.recipe.centrifuge', in: [['fluid:air', 10000]], out: [['fluid:oxygen', 1000]], eut: 2 },
      { id: 'water', map: 'gt.recipe.electrolyzer', in: [['fluid:water', 3000]], out: [['fluid:oxygen', 1000]], eut: 30 }] });
    const free: LeafOracle = (k) => (k === 'fluid:air' || k === 'fluid:water' ? { buyable: true, cost: 0, leafClass: 'free' } : { buyable: false, cost: 0, leafClass: null });
    const s = await solveLine(graphFor(p, 'fluid:oxygen', 1, free), one('fluid:oxygen'));
    expect([...s.runs.keys()]).toEqual(['water']);
  });
  it('breaks a fewest-recipes tie by power before the chains of bought derived leaves, and by those chains last', async () => {
    // Rods from Steel (a chain of 1 recipe) or from Magnetic Steel (2: steel, then a polarizer), at the same raw cost.
    const rods = (steelEu: number, magneticEu: number) => packFromSpec({ machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.extruder'], tier: 1 }], recipes: [
      { id: 'from-magnetic', map: 'gt.recipe.extruder', in: [['magnetic@0', 1]], out: [['rod@0', 2]], eut: magneticEu },
      { id: 'from-steel', map: 'gt.recipe.extruder', in: [['steel@0', 1]], out: [['rod@0', 2]], eut: steelEu }] });
    const leaf: LeafOracle = (k) => (k === 'steel@0' ? { buyable: true, cost: 2, leafClass: 'derived', steps: 1, free: 0 }
      : k === 'magnetic@0' ? { buyable: true, cost: 2, leafClass: 'derived', steps: 2, free: 0 } : { buyable: false, cost: 0, leafClass: null });
    const run = async (steelEu: number, magneticEu: number) => [...(await solveLine(graphFor(rods(steelEu, magneticEu), 'rod@0', 1, leaf), one('rod@0'))).runs.keys()];
    expect(await run(30, 30)).toEqual(['from-steel']);
    expect(await run(30, 8)).toEqual(['from-magnetic']);
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
  it('probes the least raw material only', async () => {
    // Fix spec R3: a probe says whether the line plans and what its least raw material is (the avoid trials need no more).
    const graph = graphFor(mini, 't:circuit@0', 1);
    const full = await solveLine(graph, one('t:circuit@0'), { stepCharge: 0.05, handWeight: 3 });
    const probe = await solveLine(graph, one('t:circuit@0'), { stepCharge: 0.05, handWeight: 3, probe: true });
    expect(probe.status).toBe(full.status);
    expect(probe.rawCost).toBe(full.leastRawCost);
    expect(probe.leastRawCost).toBe(full.leastRawCost);
    const lv = await solveLine(graphFor(mini, 't:titanium_plate@0', 1), one('t:titanium_plate@0'), { probe: true });
    expect(lv.status).toBe('infeasible');
  });
});

describe('loop guard and blockers', () => {
  const rawOnly: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  const loop = (): RecipeSpec[] => [{ id: 'loop-a', map: 'gt.recipe.macerator', in: [['x@0', 1]], out: [['y@0', 2]], eut: 2 },
                                    { id: 'loop-b', map: 'gt.recipe.macerator', in: [['y@0', 1]], out: [['x@0', 1]], eut: 2 }];
  const machines = [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }];
  it('prices a good only a loop with no way in makes at Infinity, as the makeable goods say (fix wave 3 (D))', async () => {
    // The LP alone would run the loop (one X makes two Y, one Y makes one X) for nothing.
    const g = graphFor(packFromSpec({ machines, recipes: loop() }), 'y@0', 1, rawOnly);
    expect(g.recipes.map((r) => r.id)).toEqual(['loop-a', 'loop-b']);
    expect(await standalonePrices(g, ['x@0', 'y@0'])).toEqual(new Map([['x@0', Infinity], ['y@0', Infinity]]));
  });
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
  it('takes a farm recipe for a source, not a loop (add-on 12 x 17 integration, F1)', async () => {
    // A Crop Manager (`LpRecipe.farm`) takes water, which the line can also get back from the farm's wood (on real data a
    // centrifuge, methane, hydrogen and distilled water): with the farm a source, as a pump is, the line runs the farm route
    // at no raw material; the guard took the cycle for a data loop and banned the farm, the water chain and the heater.
    const step = (id: string, coeffs: Array<[string, number]>, more: Partial<LpRecipe> = {}): LpRecipe => ({
      id, kind: 'recipe', mapId: 'gt.recipe.macerator', euPerRun: 0, nonConsumed: [], needsCleanroom: false,
      main: coeffs.find(([, c]) => c > 0)?.[0], coeffs: [...coeffs].sort(([a], [b]) => (a < b ? -1 : 1)), ...more,
    });
    const good = (key: string, buyable: boolean, cost: number, leafClass: LeafDecision['leafClass']): [string, GoodInfo] =>
      [key, { key, buyable, cost, leafClass, virtual: false }];
    const graph: CandidateGraph = {
      targets: ['t@0'],
      recipes: [
        step('dry', [['wood@0', -1], ['fluid:water', 200]]),
        step('farm', [['fluid:water', -100], ['wood@0', 1]], { farm: true }),
        step('from-wood', [['wood@0', -10], ['t@0', 1]]),
        step('heat', [['fluid:water', -6], ['steam@0', 960]]),
        step('honest', [['raw@0', -1], ['steam@0', -1000], ['t@0', 1]]),
        step('pump', [['fluid:water', 1000]], { supply: true }),
      ],
      goods: new Map([good('fluid:water', true, 0, 'free'), good('raw@0', true, 1, 'direct'), good('wood@0', false, 0, null),
        good('t@0', false, 0, null), good('steam@0', false, 0, null)]),
      blocked: new Map(), warnings: [],
    };
    const s = await solveLine(graph, one('t@0'));
    expect(s.status).toBe('ok');
    expect(s.banned ?? []).toEqual([]);
    expect(s.warnings.map((w) => w.code)).not.toContain('free-loop');
    expect(s.runs.has('farm')).toBe(true);
    expect(s.rawCost).toBe(0);
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

describe('twin recipes', () => {
  // The plan 12 fix wave 2 review: the 2.9 export's Fluid Extractor makes Molten Tin from Tin Dust or from a Tin Ingot
  // (both 1 raw), and the build MIP's root node took one or the other by its numerics (the user's reference line: the
  // ingot's at a 2 % step charge, the dust's at 50 %). Every stage rates the two alike, so the plan runs one of them.
  const TIN: Record<string, number> = { 't:part@0': 1, 't:tin_dust@0': 1, 't:tin_ingot@0': 1, 't:ore@0': 1 };
  const leafAt = (costs: Record<string, number>): LeafOracle => (k) => (Object.hasOwn(costs, k)
    ? { buyable: true, cost: costs[k] as number, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  const graphOf = (spec: Parameters<typeof packFromSpec>[0], targets: string[], costs = TIN): CandidateGraph => {
    const pack = packFromSpec(spec);
    const env: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };
    return buildCandidates(pack, defaultSettings(), env, leafAt(costs), targets);
  };
  const DUST = 't:tin_dust@0';
  const INGOT = 't:tin_ingot@0';
  // Controller ruling 197 (1): of twins the plan keeps (a) the one whose good the line also makes, else (b) the one whose
  // good the line already buys for another step, else (c) the ingot's before the dust's before any other form's (players
  // stock ingots: `SolveOptions.formRank`), else (d) the one of the lowest id; it never moves a pinned recipe.
  const FORMS = (key: string): number => (key.endsWith('_ingot@0') ? 0 : key.endsWith('_dust@0') ? 1 : 2);
  const DUST_FIRST = (key: string): number => (key.endsWith('_dust@0') ? 0 : 1);
  const solution = (runs: Record<string, number>, buys: Record<string, number>): Solution => ({
    status: 'ok', runs: new Map(Object.entries(runs)), buys: new Map(Object.entries(buys)), sinks: new Map(), rawCost: 0, leastRawCost: 0, blockers: [], warnings: [],
  });

  it('moves the twin of the higher id to the lower one when nothing else tells them apart (rule d)', () => {
    const graph = graphOf(twinSpec(), ['t:board@0']);
    expect(twinMoves(graph, graph.recipes, one('t:board@0'))).toEqual([{ recipe: 'x-ingot', to: 'x-dust', from: INGOT, into: DUST, amount: 1 }]);
    // A recipe the project pins stays: its twin moves to it.
    expect(twinMoves(graph, graph.recipes, one('t:board@0'), { pinned: new Set(['x-ingot']) }))
      .toEqual([{ recipe: 'x-dust', to: 'x-ingot', from: DUST, into: INGOT, amount: 1 }]);
  });

  it('moves a twin to the one whose good the line also makes, whatever the other rules say (rule a)', async () => {
    // `roast` makes the slag the line takes and a tin ingot beside it: a plan may melt that ingot, never a dust it makes,
    // even where the line buys tin dust for its foil (rule b) and dust ranks first (rule c).
    const graph = graphOf(twinSpec({ roast: true }), ['t:board@0', 't:slag@0']);
    expect(twinMoves(graph, graph.recipes, new Map([['t:board@0', 1], ['t:slag@0', 1]])))
      .toEqual([{ recipe: 'x-dust', to: 'x-ingot', from: DUST, into: INGOT, amount: 1 }]);
    const foil = graphOf(twinSpec({ roast: true, foil: 'dust' }), ['t:board@0', 't:slag@0', 't:tin_foil@0']);
    const demand = new Map([['t:board@0', 1], ['t:slag@0', 1], ['t:tin_foil@0', 1]]);
    const plan = await solveLine(foil, demand, { formRank: DUST_FIRST });
    expect(plan.buys.get(DUST)).toBeCloseTo(1, 9);
    expect(twinMoves(foil, foil.recipes, demand, { plan, formRank: DUST_FIRST }))
      .toEqual([{ recipe: 'x-dust', to: 'x-ingot', from: DUST, into: INGOT, amount: 1 }]);
  });

  it('keeps the twin whose good the line already buys for another step (rule b), before the ingot', async () => {
    // Tin foil from an ingot: the line buys tin ingots anyway, so its Molten Tin comes from one too, though the dust's twin
    // has the lower id.
    const demand = new Map([['t:board@0', 1], ['t:tin_foil@0', 1]]);
    const ingots = graphOf(twinSpec({ foil: 'ingot' }), ['t:board@0', 't:tin_foil@0']);
    const plan = await solveLine(ingots, demand);
    expect(Object.fromEntries(plan.runs)).toEqual({ 'board-tin': 1, foil: 1, 'x-ingot': 1 });
    expect(Object.fromEntries(plan.buys)).toEqual({ 't:part@0': 1, [INGOT]: 2 });
    const toIngot = [{ recipe: 'x-dust', to: 'x-ingot', from: DUST, into: INGOT, amount: 1 }];
    expect(twinMoves(ingots, ingots.recipes, demand, { plan })).toEqual(toIngot);
    // The same whichever twin the solver ran: what the twins take is left out of what the line buys.
    const dustRun = solution({ 'board-tin': 1, foil: 1, 'x-dust': 1 }, { 't:part@0': 1, [DUST]: 1, [INGOT]: 1 });
    expect(twinMoves(ingots, ingots.recipes, demand, { plan: dustRun })).toEqual(toIngot);
    // Tin foil from dust: the dust's twin, though ingots come first by form.
    const dusts = graphOf(twinSpec({ foil: 'dust' }), ['t:board@0', 't:tin_foil@0']);
    const dustPlan = await solveLine(dusts, demand, { formRank: FORMS });
    expect(Object.fromEntries(dustPlan.runs)).toEqual({ 'board-tin': 1, foil: 1, 'x-dust': 1 });
    expect(Object.fromEntries(dustPlan.buys)).toEqual({ 't:part@0': 1, [DUST]: 2 });
    expect(twinMoves(dusts, dusts.recipes, demand, { plan: dustPlan, formRank: FORMS }))
      .toEqual([{ recipe: 'x-ingot', to: 'x-dust', from: INGOT, into: DUST, amount: 1 }]);
  });

  it('keeps the ingot twin before the dust twin when the line buys neither for another step (rule c)', async () => {
    const graph = graphOf(twinSpec(), ['t:board@0']);
    expect(twinMoves(graph, graph.recipes, one('t:board@0'), { formRank: FORMS }))
      .toEqual([{ recipe: 'x-dust', to: 'x-ingot', from: DUST, into: INGOT, amount: 1 }]);
    const s = await solveLine(graph, one('t:board@0'), { formRank: FORMS });
    expect(Object.fromEntries(s.runs)).toEqual({ 'board-tin': 1, 'x-ingot': 1 });
    expect(Object.fromEntries(s.buys)).toEqual({ 't:part@0': 1, [INGOT]: 1 });
    // Never away from a pinned recipe: the ingot's twin moves to the pinned dust's.
    expect(twinMoves(graph, graph.recipes, one('t:board@0'), { formRank: FORMS, pinned: new Set(['x-dust']) }))
      .toEqual([{ recipe: 'x-ingot', to: 'x-dust', from: INGOT, into: DUST, amount: 1 }]);
  });

  it('ends a chain of twins over two goods on one twin, whichever of them the solver ran', async () => {
    // Solder from 9 tin and 1 antimony, each as dust or ingot (`s-dd`, `s-id`, `s-ii`; no `s-di`): the ingots' twin,
    // reached from the dusts' through `s-id` whatever order the twin sets come in.
    const costs = { ...TIN, 't:antimony_dust@0': 1, 't:antimony_ingot@0': 1 };
    const graph = graphOf(twinSpec({ solder: true }), ['t:solder_dust@0'], costs);
    const demand = one('t:solder_dust@0');
    const s = await solveLine(graph, demand, { formRank: FORMS });
    expect([...s.runs.keys()]).toEqual(['s-ii']);
    expect(Object.fromEntries(s.buys)).toEqual({ 't:antimony_ingot@0': 0.1, [INGOT]: 0.9 });
    const moves = twinMoves(graph, graph.recipes, demand, { formRank: FORMS });
    expect(moves.map((m) => `${m.recipe}>${m.to}`).sort()).toEqual(['s-dd>s-id', 's-id>s-ii']);
    for (const order of [moves, [...moves].reverse()]) {
      for (const [start, tin, antimony] of [['s-dd', DUST, 't:antimony_dust@0'], ['s-id', INGOT, 't:antimony_dust@0']] as const) {
        const moved = withTwinsMoved(solution({ [start]: 0.1 }, { [antimony]: 0.1, [tin]: 0.9 }), order);
        expect(Object.fromEntries(moved.runs), start).toEqual({ 's-ii': 0.1 });
        expect(Object.fromEntries(moved.buys), start).toEqual({ 't:antimony_ingot@0': 0.1, [INGOT]: 0.9 });
      }
    }
  });

  it('moves none where the goods differ in amount or price, or one is demanded', () => {
    const twice = graphOf(twinSpec({ ingots: 2 }), ['t:board@0']);
    expect(twinMoves(twice, twice.recipes, one('t:board@0'))).toEqual([]);
    const dearer = graphOf(twinSpec(), ['t:board@0'], { ...TIN, [INGOT]: 2 });
    expect(twinMoves(dearer, dearer.recipes, one('t:board@0'))).toEqual([]);
    const graph = graphOf(twinSpec(), ['t:board@0']);
    expect(twinMoves(graph, graph.recipes, new Map([['t:board@0', 1], [INGOT, 1]]))).toEqual([]);
  });

  it('plans the kept twin, buying its good', async () => {
    const s = await solveLine(graphOf(twinSpec(), ['t:board@0']), one('t:board@0'));
    expect(Object.fromEntries(s.runs)).toEqual({ 'board-tin': 1, 'x-dust': 1 });
    expect(Object.fromEntries(s.buys)).toEqual({ 't:part@0': 1, [DUST]: 1 });
    expect(s.rawCost).toBeCloseTo(2, 9);
  });
});
