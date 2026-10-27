import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { greedyWholeRuns, wholeRuns, makeN } from '../../../src/server/planner/make-n.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { makeLeafOracle, makePrices } from '../../../src/server/planner/costs.ts';
import { solveLine } from '../../../src/server/planner/solve.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
async function solved(target: string, n: number, tier: number) {
  const env: PlanEnv = { tier, reachable: reachableDims(pack.worldgen, { policy: 'progression', overrides: {} }, [], tier).keys, lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };
  const graph = buildCandidates(pack, defaultSettings(), env, makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env), makePrices(pack, {})), [target]);
  const demand = new Map([[target, n]]);
  return { graph, demand, sol: await solveLine(graph, demand) };
}

describe('wholeRuns', () => {
  it('rounds crafts up and reports leftovers', async () => {
    const { graph, sol, demand } = await solved('t:copper_wire@0', 3, 1);
    const w = await wholeRuns(graph, sol, demand);
    expect(Object.fromEntries(w.runs)).toEqual({ wire: 2 });
    expect(Object.fromEntries(w.buys)).toEqual({ 't:copper_ingot@0': 2 });
    expect(w.leftovers).toEqual([{ key: 't:copper_wire@0', amount: 1, chance: 1 }]);
  });
  it('propagates rounding up the chain', async () => {
    const { graph, sol, demand } = await solved('t:circuit@0', 1, 2);
    const w = await wholeRuns(graph, sol, demand);
    expect(Object.fromEntries(w.runs)).toEqual({ 'circuit-mv': 1, 'extract-iron': 1, wire: 1 });
    expect(w.buys.get('t:iron_ingot@0')).toBe(1);
    expect(w.leftovers).toEqual([{ key: 'fluid:molten.iron', amount: 72, chance: 1 }]);
  });
});

describe('makeN', () => {
  it('runs on owned machines, adds only what is missing, and estimates time', async () => {
    const { graph, sol, demand } = await solved('t:circuit@0', 10, 1);
    const ctx = { ...emptyContextForTest(), ownedMachines: [{ mteId: 121, count: 2 }, { mteId: 101, count: 1 }] };
    const r = await makeN(pack, graph, sol, demand, { settings: defaultSettings(), groupTier: 1, coilHeat: 1801, ctx });
    // Ruling R3: wire runs 10 (circuit-lv takes 2 copper wire, a wire run makes 2).
    expect(r.steps.map((s) => [s.id, s.machine.mteId, s.count, s.owned, s.runs])).toEqual([
      ['bend-plate', 101, 1, 1, 10], ['circuit-lv', 121, 2, 2, 10], ['wire', 111, 1, 0, 10]]);
    expect(r.addedMachines).toEqual([{ id: 'gt:111', count: 1 }]);
    expect(r.totalSeconds).toBeCloseTo(65, 6);          // slowest type 50 s + fill 15 s (100 t + 200 t)
    expect(r.leftovers).toEqual([]);
  });
});

describe('more Make N cases', () => {
  const rawLeaf: LeafOracle = (k) => (k === 'raw@0' || k === 'fluid:oil'
    ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  async function planned(spec: PackSpec, target: string, n: number, settings: Partial<PlanSettings> = {}) {
    const p = packFromSpec(spec);
    const s = { ...defaultSettings(), ...settings };
    const env: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(s.excludedCategories) };
    const graph = buildCandidates(p, s, env, rawLeaf, [target]);
    const demand = new Map([[target, n]]);
    const sol = await solveLine(graph, demand);
    const run = (ownedMachines: Array<{ mteId: number; count: number }> = []) =>
      makeN(p, graph, sol, demand, { settings: s, groupTier: 1, coilHeat: 1801, ctx: { ...emptyContextForTest(), ownedMachines } });
    return { graph, sol, demand, run };
  }

  // make-t needs 5 m and 1 n; split makes one of each, z-make-m makes 2 m, so the line runs both producers of m.
  const twoProducers: PackSpec = {
    recipes: [
      { id: 'make-t', map: 'crafting', in: [['m@0', 5], ['n@0', 1]], out: [['t@0', 2]] },
      { id: 'split', map: 'crafting', in: [['raw@0', 1]], out: [['m@0', 1], ['n@0', 1]] },
      { id: 'z-make-m', map: 'crafting', in: [['raw@0', 1]], out: [['m@0', 2]] },
    ],
  };

  it('adds the runs a deficit needs to the producer with the most runs', async () => {
    // LP: make-t 1.5, split 1.5, z-make-m 3 → whole 2, 2, 3 leaves 2 m short; z-make-m (3 runs) beats split (2 runs).
    const { graph, sol, demand } = await planned(twoProducers, 't@0', 3);
    const w = await wholeRuns(graph, sol, demand);
    expect(Object.fromEntries(w.runs)).toEqual({ 'make-t': 2, split: 2, 'z-make-m': 4 });
    expect(Object.fromEntries(w.buys)).toEqual({ 'raw@0': 6 });
    expect(w.leftovers).toEqual([{ key: 't@0', amount: 1, chance: 1 }]);
  });
  it('tops a short good up through the producer that yields most of it, not the busiest one', async () => {
    // LP: make-t 0.5, split 0.5, z-make-m 1 → whole 1, 1, 1 leaves 2 m short; z-make-m makes 2 m a run, split 1.
    const { graph, sol, demand } = await planned(twoProducers, 't@0', 1);
    const w = await wholeRuns(graph, sol, demand);
    expect(Object.fromEntries(w.runs)).toEqual({ 'make-t': 1, split: 1, 'z-make-m': 2 });
    expect(w.leftovers).toEqual([{ key: 't@0', amount: 1, chance: 1 }]);
    expect(w.short).toEqual([]);
  });

  /** The greedy fallback (or wholeRuns) on a hand-made LP answer, so the rounding case is exact. */
  async function rounded(spec: PackSpec, target: string, n: number, runs: Record<string, number>, exact = false) {
    const { graph, sol, demand } = await planned(spec, target, n);
    const given = { ...sol, runs: new Map(Object.entries(runs)) };
    return exact ? wholeRuns(graph, given, demand) : greedyWholeRuns(graph, given, demand);
  }
  it('breaks a tie between equal producers by id', async () => {
    // make-t takes 5 m for 2 t: 3 t → 1.5 runs → 2 (10 m); b-m at 3.75 → 4 runs makes 8 m; a-m and b-m tie, a-m wins.
    const spec: PackSpec = { recipes: [
      { id: 'make-t', map: 'crafting', in: [['m@0', 5]], out: [['t@0', 2]] },
      { id: 'a-m', map: 'crafting', in: [['raw@0', 1]], out: [['m@0', 2]] },
      { id: 'b-m', map: 'crafting', in: [['raw@0', 1]], out: [['m@0', 2]] }] };
    const w = await rounded(spec, 't@0', 3, { 'make-t': 1.5, 'b-m': 3.75 });
    expect(Object.fromEntries(w.runs)).toEqual({ 'a-m': 1, 'b-m': 4, 'make-t': 2 });
  });
  it('prefers a recipe the short good is the main output of over a chanced byproduct', async () => {
    // 'by' yields 1.5 m a run as a byproduct of x; main-m only 1, but m is what it is for.
    const spec: PackSpec = { recipes: [
      { id: 'make-t', map: 'crafting', in: [['m@0', 2]], out: [['t@0', 1]] },
      { id: 'by', map: 'crafting', in: [['raw@0', 1]], out: [['x@0', 1], ['m@0', 3, 0.5]] },
      { id: 'main-m', map: 'crafting', in: [['raw@0', 1]], out: [['m@0', 1]] }] };
    const w = await rounded(spec, 't@0', 1, { 'make-t': 1 });
    expect(Object.fromEntries(w.runs)).toEqual({ 'main-m': 2, 'make-t': 1 });
  });
  it('closes loops of handed-round containers exactly in whole runs', async () => {
    // fill takes an empty container and raw into a full one; use takes two full ones and hands both back. Whole runs
    // solved together balance at once; topping up one good at a time chased the loop round.
    const spec: PackSpec = { recipes: [
      { id: 'use', map: 'crafting', in: [['f@0', 2]], out: [['t@0', 1], ['e@0', 2]] },
      { id: 'fill', map: 'crafting', in: [['e@0', 1], ['raw@0', 1]], out: [['f@0', 1]] }] };
    const w = await rounded(spec, 't@0', 3, { use: 3, fill: 6 }, true);
    expect(Object.fromEntries(w.runs)).toEqual({ fill: 6, use: 3 });
    expect([w.short, Object.fromEntries(w.buys)]).toEqual([[], { 'raw@0': 6 }]);
  });
  it('leaves a loop that does not close in whole runs short, and says so', async () => {
    // use hands back one container for the two filled ones it takes; only use makes containers. Topping the loop up
    // only digs it deeper (e short 1, then 2), so it stops and reports the containers the batch needs on hand.
    const spec: PackSpec = { recipes: [
      { id: 'use', map: 'crafting', in: [['f@0', 2]], out: [['t@0', 1], ['e@0', 1]] },
      { id: 'fill', map: 'crafting', in: [['e@0', 1], ['raw@0', 1]], out: [['f@0', 1]] }] };
    // No whole (or LP) answer exists, so wholeRuns falls back to the greedy repair, which reports the shortfall.
    const w = await rounded(spec, 't@0', 1, { use: 1, fill: 2 }, true);
    expect(Object.fromEntries(w.runs)).toEqual({ fill: 4, use: 2 });
    expect(w.short).toEqual([{ key: 'e@0', amount: 2, chance: 1 }]);
    expect(w.leftovers).toEqual([{ key: 't@0', amount: 1, chance: 1 }]);
  });
  it('rounds bought amounts up to whole items and whole litres', async () => {
    const spec: PackSpec = { recipes: [{ id: 'mix', map: 'crafting', in: [['raw@0', 1, 0.5], ['fluid:oil', 5, 0.5]], out: [['t@0', 1]] }] };
    const { graph, sol, demand } = await planned(spec, 't@0', 1);
    expect(Object.fromEntries((await wholeRuns(graph, sol, demand)).buys)).toEqual({ 'fluid:oil': 3, 'raw@0': 1 });
  });

  // Two LV assembler recipes in a row; make-t also has a 50% byproduct.
  const assemblerLine: PackSpec = {
    maps: [{ id: 'gt.recipe.assembler' }],
    machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
    recipes: [
      { id: 'make-a', map: 'gt.recipe.assembler', in: [['raw@0', 1]], out: [['a@0', 1]], eut: 16, dur: 100 },
      { id: 'make-t', map: 'gt.recipe.assembler', in: [['a@0', 1]], out: [['t@0', 1], ['side@0', 1, 0.5]], eut: 16, dur: 100 },
    ],
  };
  const SHARES_T = 'Shares machines with make-t — swap circuits/molds between batches';
  const SHARES_A = 'Shares machines with make-a — swap circuits/molds between batches';
  const CHANCED = 'Chanced outputs: amounts are expected values; a small batch may come out short';

  it('adds one machine for a type nothing owned covers and shares it between the steps', async () => {
    const { run } = await planned(assemblerLine, 't@0', 4);
    const r = await run();
    expect(r.addedMachines).toEqual([{ id: 'gt:1', count: 1 }]);
    expect(r.totalSeconds).toBeCloseTo(50, 9);   // 8 runs × 100 t on one machine = 40 s, plus 10 s to fill (100 t + 100 t)
    expect(r.steps.map((s) => [s.id, s.count, s.owned, s.runs, s.runsPerSecond, s.utilization, s.warnings])).toEqual([
      ['make-a', 1, 0, 4, 0.08, 0.4, [SHARES_T]],
      ['make-t', 1, 0, 4, 0.08, 0.4, [SHARES_A, CHANCED]]]);
    expect(r.leftovers).toEqual([{ key: 'side@0', amount: 2, chance: 1 }]);
  });
  it('uses every owned machine of a type for each step of that type', async () => {
    const { run } = await planned(assemblerLine, 't@0', 4);
    const r = await run([{ mteId: 1, count: 2 }]);
    expect(r.addedMachines).toEqual([]);
    expect(r.totalSeconds).toBeCloseTo(30, 9);   // 800 t on two machines = 20 s, plus 10 s to fill
    expect(r.steps.map((s) => [s.id, s.count, s.owned, Number(s.utilization.toFixed(6))])).toEqual([
      ['make-a', 2, 2, 0.333333], ['make-t', 2, 2, 0.333333]]);
  });
  it('counts a declined owned type as not owned', async () => {
    const { graph, sol, demand } = await solved('t:circuit@0', 10, 1);
    const ctx = { ...emptyContextForTest(), ownedMachines: [{ mteId: 121, count: 2 }] };
    const r = await makeN(pack, graph, sol, demand, { settings: { ...defaultSettings(), declineReuse: [121] }, groupTier: 1, coilHeat: 1801, ctx });
    expect(r.steps.find((s) => s.id === 'circuit-lv')).toMatchObject({ count: 1, owned: 0, circuit: 2, mainOutput: 't:circuit@0' });
    expect(r.addedMachines).toEqual([{ id: 'gt:101', count: 1 }, { id: 'gt:111', count: 1 }, { id: 'gt:121', count: 1 }]);
    expect(r.totalSeconds).toBeCloseTo(115, 6);   // assembler 10 × 200 t = 100 s, plus 15 s to fill
  });
  it('hand-crafts without adding a machine or a sharing warning', async () => {
    const spec: PackSpec = { recipes: [
      { id: 'c1', map: 'crafting', in: [['raw@0', 1]], out: [['a@0', 1]] },
      { id: 'c2', map: 'crafting', in: [['a@0', 1]], out: [['t@0', 1]] },
    ] };
    // By hand is no longer the default (plan 12's Auto Workbench ruling): this case asks for it.
    const r = await (await planned(spec, 't@0', 3, { automateCrafting: false })).run();
    expect(r.addedMachines).toEqual([]);
    expect(r.totalSeconds).toBeCloseTo(8, 9);   // 6 crafts at one per second, plus 2 s to fill (20 t + 20 t)
    expect(r.steps.map((s) => [s.id, s.machine.mteId, s.count, s.owned, s.handCraft, s.warnings])).toEqual([
      ['c1', -3, 1, 0, true, []], ['c2', -3, 1, 0, true, []]]);
  });
});
