import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import {
  pickMachine, planSteps, buildFlows, ownedMachineMap, recipeCircuit, emptyContainers, stepInputs, boughtGoods, describeStep, pickStepMachines, stepLine,
  type StepLine,
} from '../../../src/server/planner/machines.ts';
import { buildCandidates, virtualKey, type CandidateGraph, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { computeAvailability, reachableDims } from '../../../src/server/planner/availability.ts';
import { makeLeafOracle, makePrices } from '../../../src/server/planner/costs.ts';
import { solveLine } from '../../../src/server/planner/solve.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { packFromSpec, type IngredientSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const R = (id: string) => pack.recipeById.get(id)!;
const none = new Map<number, number>();
const pick = (id: string, map: string, groupTier: number, extra = {}) =>
  pickMachine(pack, R(id), map, { groupTier, coilHeat: 2701, automateCrafting: false, owned: none, ...extra });

describe('pickMachine', () => {
  it('uses the group tier and overclocks', () => {
    expect(pick('bend-plate', 'gt.recipe.metalbender', 1)).toMatchObject({ mteId: 101, tier: 1, runsPerSecondPerMachine: 0.2, oc: { euPerTick: 24, durationTicks: 100 } });
    expect(pick('bend-plate', 'gt.recipe.metalbender', 2)).toMatchObject({ mteId: 102, tier: 2, runsPerSecondPerMachine: 0.4, oc: { euPerTick: 96, durationTicks: 50, overclocks: 1 } });
  });
  it('honours a per-recipe tier and prefers owned machines', () => {
    expect(pick('bend-plate', 'gt.recipe.metalbender', 2, { wantTier: 1 }).mteId).toBe(101);
    expect(pick('bend-plate', 'gt.recipe.metalbender', 2, { owned: new Map([[101, 2]]) }).mteId).toBe(101);
  });
  it('crafting is by hand unless automated', () => {
    expect(pick('hammer-plate', 'crafting', 2)).toMatchObject({ mteId: -3, name: 'Crafting table (by hand)', handCraft: true, runsPerSecondPerMachine: 1 });
    expect(pick('hammer-plate', 'crafting', 2, { automateCrafting: true })).toMatchObject({ mteId: -1, handCraft: false });
  });
  it('plans multiblocks with one hatch at the group tier', () => {
    expect(pick('ebf-ti', 'gt.recipe.blastfurnace', 3)).toMatchObject({ mteId: 1000, kind: 'multiblock', tier: 3, oc: { euPerTick: 480, durationTicks: 1000 } });
  });
});

describe('planSteps and buildFlows', () => {
  async function lvCircuit(ownedMachines: Array<{ mteId: number; count: number }> = [], declineReuse: number[] = []) {
    const env: PlanEnv = { tier: 1, reachable: reachableDims(pack.worldgen, { policy: 'progression', overrides: {} }, [], 1).keys, lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };
    const leaf = makeLeafOracle(pack, defaultSettings(), computeAvailability(pack, env), makePrices(pack, {}));
    const graph = buildCandidates(pack, defaultSettings(), env, leaf, ['t:circuit@0']);
    const sol = await solveLine(graph, new Map([['t:circuit@0', 0.5]]));
    const ctx = { ...emptyContextForTest(), ownedMachines };
    return { graph, sol, steps: planSteps(pack, graph, sol, { settings: { ...defaultSettings(), declineReuse }, groupTier: 1, coilHeat: 1801, ctx, perSecondScale: 1 }) };
  }
  it('counts machines from overclocked speed and keeps exact counts exact', async () => {
    const { steps } = await lvCircuit();
    expect(steps.map((s) => [s.id, s.machine.name, s.count, Number(s.utilization.toFixed(4))])).toEqual([
      ['bend-plate', 'Basic Bending Machine', 3, 0.8333], ['circuit-lv', 'Basic Assembler', 5, 1], ['wire', 'Basic Wiremill', 3, 0.8333]]);
    expect(steps[1]).toMatchObject({ mainOutput: 't:circuit@0', euPerTick: 16, durationTicks: 200, overclocks: 0, handCraft: false, circuit: 2,
      oc: { recipeEuPerTick: 16, recipeDurationTicks: 200, machineVoltage: 32, machineAmps: 1, perfect: false, heatOverclocks: 0 } });
    expect(steps[0]?.circuit).toBeUndefined();
  });
  it('suggests owned machines', async () => {
    const { steps } = await lvCircuit([{ mteId: 121, count: 2 }]);
    expect(steps.find((s) => s.id === 'circuit-lv')).toMatchObject({ count: 5, owned: 2 });
  });
  it('declined machines are not counted as owned', async () => {
    const owned = [{ mteId: 121, count: 2 }, { mteId: 101, count: 1 }];
    expect([...ownedMachineMap({ ...emptyContextForTest(), ownedMachines: owned }, { ...defaultSettings(), declineReuse: [121] })]).toEqual([[101, 1]]);
    const { steps } = await lvCircuit(owned, [121]);
    expect(steps.find((s) => s.id === 'circuit-lv')).toMatchObject({ count: 5, owned: 0 });
    expect(steps.find((s) => s.id === 'bend-plate')).toMatchObject({ owned: 1 });
  });
  it('draws flows from raw materials to the output', async () => {
    const { graph, sol } = await lvCircuit();
    expect(buildFlows(graph, sol, ['t:circuit@0']).map((f) => [f.from, f.to, f.key, Number(f.perSecond.toFixed(6))])).toEqual([
      ['bend-plate', 'circuit-lv', 't:iron_plate@0', 0.5], ['circuit-lv', 'out', 't:circuit@0', 0.5], ['raw', 'bend-plate', 't:iron_ingot@0', 0.5],
      ['raw', 'circuit-lv', 't:redstone@0', 0.5], ['raw', 'wire', 't:copper_ingot@0', 0.5], ['wire', 'circuit-lv', 't:copper_wire@0', 1]]);
  });

  it('sinks a farm\'s share of a good first and feeds the line from its own maker (12 x 17 F5)', () => {
    // farm: 1 run -> 6 wood + 0.2 resin; centrifuge: 6 wood -> 6 resin; press: 4 resin -> 1 target. Resin sunk: 2.2. Split pro
    // rata the farm's resin went in and out at once: the layout lists it on both chests and EnderIO moves it between them.
    const recipes = [
      { id: 'centrifuge', kind: 'recipe', mapId: 'm', coeffs: [['t:resin@0', 6], ['t:wood@0', -6]], euPerRun: 1, nonConsumed: [], needsCleanroom: false, main: 't:resin@0' },
      { id: 'farm', kind: 'recipe', mapId: 'f', coeffs: [['t:resin@0', 0.2], ['t:wood@0', 6]], euPerRun: 0, nonConsumed: [], needsCleanroom: false, main: 't:wood@0', farm: true },
      { id: 'press', kind: 'recipe', mapId: 'm', coeffs: [['t:resin@0', -4], ['t:target@0', 1]], euPerRun: 1, nonConsumed: [], needsCleanroom: false, main: 't:target@0' },
    ];
    const graph = { targets: ['t:target@0'], recipes, goods: new Map(), blocked: new Map(), warnings: [] } as never;
    const sol = { status: 'ok', runs: new Map([['centrifuge', 1], ['farm', 1], ['press', 1]]), buys: new Map(), sinks: new Map([['t:resin@0', 2.2]]),
      rawCost: 0, leastRawCost: 0, blockers: [], warnings: [] } as never;
    const resin = buildFlows(graph, sol, ['t:target@0']).filter((f) => f.key === 't:resin@0').map((f) => [f.from, f.to, Number(f.perSecond.toFixed(6))]);
    expect(resin).toEqual([['centrifuge', 'press', 4], ['centrifuge', 'sink', 2], ['farm', 'sink', 0.2]]);
  });

  it('feeds the line what a farm makes beyond what the line throws away (12 x 17 F5)', () => {
    // farm 3 resin, centrifuge 2, press takes 4, 1 sunk: the farm's 1 to sink, its other 2 and the centrifuge's 2 to the press.
    const recipes = [
      { id: 'centrifuge', kind: 'recipe', mapId: 'm', coeffs: [['t:resin@0', 2], ['t:wood@0', -6]], euPerRun: 1, nonConsumed: [], needsCleanroom: false, main: 't:resin@0' },
      { id: 'farm', kind: 'recipe', mapId: 'f', coeffs: [['t:resin@0', 3], ['t:wood@0', 6]], euPerRun: 0, nonConsumed: [], needsCleanroom: false, main: 't:wood@0', farm: true },
      { id: 'press', kind: 'recipe', mapId: 'm', coeffs: [['t:resin@0', -4], ['t:target@0', 1]], euPerRun: 1, nonConsumed: [], needsCleanroom: false, main: 't:target@0' },
    ];
    const graph = { targets: ['t:target@0'], recipes, goods: new Map(), blocked: new Map(), warnings: [] } as never;
    const sol = { status: 'ok', runs: new Map([['centrifuge', 1], ['farm', 1], ['press', 1]]), buys: new Map(), sinks: new Map([['t:resin@0', 1]]),
      rawCost: 0, leastRawCost: 0, blockers: [], warnings: [] } as never;
    const resin = buildFlows(graph, sol, ['t:target@0']).filter((f) => f.key === 't:resin@0').map((f) => [f.from, f.to, Number(f.perSecond.toFixed(6))]);
    expect(resin).toEqual([['centrifuge', 'press', 2], ['farm', 'press', 2], ['farm', 'sink', 1]]);
  });
});

describe('more machine and flow cases', () => {
  const rawLeaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  /**
   * `value` gives the steps what each good is worth and the empty containers of the pack (`StepLine`), as planLine does;
   * `leaf` says what the line may buy (raw@0 at 1 unless given).
   */
  async function planned(
    spec: PackSpec, target: string, perSecond: number, tier: number, settings: Partial<PlanSettings> = {},
    value?: (p: Pack) => Pick<StepLine, 'valueOf' | 'empties'>, leaf: LeafOracle = rawLeaf,
  ) {
    const p = packFromSpec(spec);
    const s = { ...defaultSettings(), ...settings };
    const env: PlanEnv = { tier, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(s.excludedCategories) };
    const graph = buildCandidates(p, s, env, leaf, [target]);
    const sol = await solveLine(graph, new Map([[target, perSecond]]));
    const steps = planSteps(p, graph, sol, {
      settings: s, groupTier: tier, coilHeat: 1801, ctx: emptyContextForTest(), perSecondScale: 1, ...(value === undefined ? {} : { value: value(p) }),
    });
    return { pack: p, graph, sol, steps, flows: buildFlows(graph, sol, [target]) };
  }
  /** Each step's main output when its line is `line` instead of the one planSteps builds: the steps described again. */
  const mainOutputs = (p: Pack, graph: CandidateGraph, runs: ReadonlyMap<string, number>, line: StepLine): Array<[string, string | undefined]> =>
    pickStepMachines(p, graph, runs, { settings: defaultSettings(), groupTier: 1, coilHeat: 1801, owned: new Map() })
      .map((r) => [r.id, describeStep(p, r, line, { count: 1, owned: 0, runsPerSecond: r.runs, utilization: 1, warnings: [] }).mainOutput]);
  const oreDict: PackSpec = {
    machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
    recipes: [{ id: 'use', map: 'gt.recipe.macerator', in: [{ any: [['a@0', 1], ['b@0', 2]] }], out: [['t@0', 1]], eut: 2 },
              { id: 'make-b', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['b@0', 1], ['side@0', 1]], eut: 2 }],
  };

  it('reports the ore-dictionary option the line uses and names a main output by use', async () => {
    const { steps } = await planned(oreDict, 't@0', 1, 1);
    expect(steps.map((s) => [s.id, s.mainOutput, s.inputs])).toEqual([
      ['make-b', 'b@0', [{ key: 'raw@0', amount: 1, chance: 1 }]],
      ['use', 't@0', [{ key: 'b@0', amount: 2, chance: 1 }]]]);
  });
  it('names the most valuable output the line uses as the main output', async () => {
    // A pyrolysis-like step: `litres` of a fluid and 1 charcoal a run, both made by no other step; the other steps take
    // 500 L of the fluid and the charcoal.
    const oven = (fluid: string, litres: number): PackSpec => ({
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'pyrolyse', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [[fluid, litres], ['t:charcoal@0', 1]], eut: 2 },
        { id: 'use-fluid', map: 'gt.recipe.macerator', in: [[fluid, 500]], out: [['wet@0', 1]], eut: 2 },
        { id: 'use-charcoal', map: 'gt.recipe.macerator', in: [['t:charcoal@0', 1]], out: [['fuel@0', 1]], eut: 2 },
        { id: 'combine', map: 'gt.recipe.macerator', in: [['wet@0', 1], ['fuel@0', 1]], out: [['t@0', 1]], eut: 2 },
      ],
    });
    const valueOf = (key: string): number => (key === 'fluid:creosote' || key === 'fluid:water' ? 0.001 : key === 't:charcoal@0' ? 1 : 0);
    const main = (steps: Array<{ id: string; mainOutput?: string }>) => steps.find((s) => s.id === 'pyrolyse')?.mainOutput;
    // The line takes both in full: the more valuable one names the step.
    expect(main((await planned(oven('fluid:creosote', 500), 't@0', 1, 1, {}, () => ({ valueOf }))).steps)).toBe('t:charcoal@0');
    // Without values the old rule stands: the output the other steps take most of, by amount.
    expect(main((await planned(oven('fluid:creosote', 500), 't@0', 1, 1)).steps)).toBe('fluid:creosote');
    // Of 1,000 L the line throws half away, so the oven runs for its charcoal, values or not (fix spec D13).
    expect(main((await planned(oven('fluid:creosote', 1000), 't@0', 1, 1)).steps)).toBe('t:charcoal@0');
    // Water is a free input, no reason to run a step: with or without values the step is there for the line's only
    // charcoal (the rule by amount named the litres, "Pyrolyse Oven makes Water").
    expect(main((await planned(oven('fluid:water', 1000), 't@0', 1, 1, {}, () => ({ valueOf }))).steps)).toBe('t:charcoal@0');
    expect(main((await planned(oven('fluid:water', 500), 't@0', 1, 1)).steps)).toBe('t:charcoal@0');
  });
  it('never names a container it hands back', async () => {
    // A step takes an Oxygen Cell and hands the Empty Cell back, which the filling step takes again; the cell is worth
    // more than the product, and both are taken as much, yet the product is what the step is for.
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'make-o2', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['fluid:oxygen', 1000]], eut: 2 },
        { id: 'fill', map: 'gt.recipe.macerator', in: [['t:empty_cell@0', 1], ['fluid:oxygen', 1000]], out: [['t:o2_cell@0', 1]], eut: 2 },
        { id: 'use-cell', map: 'gt.recipe.macerator', in: [['t:o2_cell@0', 1], ['raw@0', 1]], out: [['t:product@0', 1], ['t:empty_cell@0', 1]], eut: 2 },
        { id: 'final', map: 'gt.recipe.macerator', in: [['t:product@0', 1]], out: [['t@0', 1]], eut: 2 },
        { id: 'make-cell', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['t:empty_cell@0', 1]], eut: 2 },
        { id: 'pack', map: 'gt.recipe.macerator', in: [['t:empty_cell@0', 1], ['raw@0', 1]], out: [['u@0', 1]], eut: 2 },
      ],
      fluidContainers: [{ container: 't:o2_cell@0', empty: 't:empty_cell@0', fluid: 'fluid:oxygen', amount: 1000 }],
    };
    const value = (p: Pack) => ({ valueOf: (key: string) => (key === 't:empty_cell@0' ? 5 : 1), empties: emptyContainers(p) });
    expect(emptyContainers(packFromSpec(spec))).toEqual(new Set(['t:empty_cell@0']));
    const { steps } = await planned(spec, 't@0', 1, 1, {}, value);
    expect(steps.map((s) => [s.id, s.mainOutput])).toEqual([
      ['fill', 't:o2_cell@0'], ['final', 't@0'], ['make-o2', 'fluid:oxygen'], ['use-cell', 't:product@0']]);
    // A recipe that makes nothing but the container is there for it; a recipe making only the target names the target.
    const cells = await planned(spec, 'u@0', 1, 1, {}, value);
    expect(cells.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-cell', 't:empty_cell@0'], ['pack', 'u@0']]);
    const target = await planned(spec, 't:empty_cell@0', 1, 1, {}, value);
    expect(target.steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-cell', 't:empty_cell@0']]);
    // A good the line buys stays the step's product when all it makes beside it is the container it hands back.
    const { pack: p, graph, sol } = await planned(spec, 't@0', 1, 1, {}, value);
    const buying = { ...stepLine(graph, sol.runs, value(p)), bought: new Set(['t:product@0']) };
    expect(mainOutputs(p, graph, sol.runs, buying).find(([id]) => id === 'use-cell')).toEqual(['use-cell', 't:product@0']);
  });
  it('names a step after the output it runs for, not a good the line also buys', async () => {
    // Fix spec D13 (plan 09 Task 8): a split makes X and Y, and the line takes 2 X and 1 Y. X is also bought, for less
    // than a second split costs (raw at 1.5), so the line splits once and buys the other X: the split runs for its Y.
    // Without what the line buys the old choice stands: X, the output the other steps value most (2 taken against 1).
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'split', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['x@0', 1], ['y@0', 1]], eut: 2 },
        { id: 'make-t', map: 'gt.recipe.macerator', in: [['x@0', 2], ['y@0', 1]], out: [['t@0', 1]], eut: 2 },
      ],
    };
    const leaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1.5, leafClass: 'direct' }
      : k === 'x@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
    const value = () => ({ valueOf: () => 1 });
    const { pack: p, graph, sol, steps } = await planned(spec, 't@0', 1, 1, {}, value, leaf);
    expect(boughtGoods(sol.buys)).toEqual(new Set(['raw@0', 'x@0']));
    expect(steps.map((s) => [s.id, s.mainOutput])).toEqual([['make-t', 't@0'], ['split', 'y@0']]);
    expect(mainOutputs(p, graph, sol.runs, stepLine(graph, sol.runs, value()))).toEqual([['make-t', 't@0'], ['split', 'x@0']]);
  });
  it('still names a good the line buys when the step makes only free water beside it', async () => {
    // The pyrolysis-like step above, its charcoal also bought: the water it makes beside is free, no reason to run it.
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'pyrolyse', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['fluid:water', 1000], ['t:charcoal@0', 1]], eut: 2 },
        { id: 'use-water', map: 'gt.recipe.macerator', in: [['fluid:water', 500]], out: [['wet@0', 1]], eut: 2 },
        { id: 'use-charcoal', map: 'gt.recipe.macerator', in: [['t:charcoal@0', 1]], out: [['fuel@0', 1]], eut: 2 },
        { id: 'combine', map: 'gt.recipe.macerator', in: [['wet@0', 1], ['fuel@0', 1]], out: [['t@0', 1]], eut: 2 },
      ],
    };
    const value = () => ({ valueOf: (key: string): number => (key === 'fluid:water' ? 0.001 : key === 't:charcoal@0' ? 1 : 0) });
    const { pack: p, graph, sol } = await planned(spec, 't@0', 1, 1, {}, value);
    const buying = { ...stepLine(graph, sol.runs, value()), bought: new Set(['t:charcoal@0']) };
    expect(mainOutputs(p, graph, sol.runs, buying).find(([id]) => id === 'pyrolyse')).toEqual(['pyrolyse', 't:charcoal@0']);
    // The same step with its water bought is there for its charcoal, as before.
    const water = { ...stepLine(graph, sol.runs, value()), bought: new Set(['fluid:water']) };
    expect(mainOutputs(p, graph, sol.runs, water).find(([id]) => id === 'pyrolyse')).toEqual(['pyrolyse', 't:charcoal@0']);
  });
  it('names a step after the output only it makes for the line, not a co-product another step makes too', async () => {
    // Fix spec D13 (plan 09 final review): a reactor makes the line's only X and 1 H beside it, and an electrolyzer makes
    // 2 H a run for less; the thing takes 1 X and 10 H. The reactor runs once a thing, for its X, and the electrolyzer
    // makes the other 9 H. By value × use alone the reactor would be named after H (10 taken against 1), as the real GEC
    // line's reactor that alone makes Iron III Chloride was named Hydrogen Cell, and H would be "made 2 ways".
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'react', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['x@0', 1], ['h@0', 1]], eut: 2 },
        { id: 'electrolyze', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['h@0', 2], ['o@0', 1]], eut: 2 },
        { id: 'make-t', map: 'gt.recipe.macerator', in: [['x@0', 1], ['h@0', 10]], out: [['t@0', 1]], eut: 2 },
      ],
    };
    const value = () => ({ valueOf: () => 1 });
    const { pack: p, graph, sol, steps, flows } = await planned(spec, 't@0', 1, 1, {}, value);
    expect([...sol.runs].sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([['electrolyze', 4.5], ['make-t', 1], ['react', 1]]);
    expect(steps.map((s) => [s.id, s.mainOutput])).toEqual([['electrolyze', 'h@0'], ['make-t', 't@0'], ['react', 'x@0']]);
    expect(flows.filter((f) => f.key === 'x@0').map((f) => [f.from, f.to])).toEqual([['react', 'make-t']]);
    // Without what each recipe runs for (a line literal), or with X also bought, the old choice: H, the output the
    // other steps value most.
    const withoutRunsFor = { ...stepLine(graph, sol.runs, value()), runsFor: undefined };
    expect(mainOutputs(p, graph, sol.runs, withoutRunsFor).find(([id]) => id === 'react')).toEqual(['react', 'h@0']);
    const buyingX = { ...stepLine(graph, sol.runs, value()), bought: new Set(['x@0']) };
    expect(mainOutputs(p, graph, sol.runs, buyingX).find(([id]) => id === 'react')).toEqual(['react', 'h@0']);
    // An output only the step makes that nothing takes (the electrolyzer's O, thrown away) is no reason to run it.
    expect(flows.filter((f) => f.key === 'o@0').map((f) => f.to)).toEqual(['sink']);
  });
  it('never names a step after an output only it makes that the line takes only part of', async () => {
    // The case above with the electrolyzer's 1,000 L of oxygen a run, of which the thing takes 100 L: the electrolyzer is
    // the line's only maker of oxygen, but it runs 4.5 times a thing for its H and throws 4,400 L away (the real GEC HV
    // line's water electrolysis throws 90 % of its oxygen away). The reactor's X is taken in full: it runs for that.
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'react', map: 'gt.recipe.macerator', in: [['raw@0', 2]], out: [['x@0', 1], ['h@0', 1]], eut: 2 },
        { id: 'electrolyze', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['h@0', 2], ['fluid:oxygen', 1000]], eut: 2 },
        { id: 'make-t', map: 'gt.recipe.macerator', in: [['x@0', 1], ['h@0', 10], ['fluid:oxygen', 100]], out: [['t@0', 1]], eut: 2 },
      ],
    };
    const value = () => ({ valueOf: (key: string): number => (key === 'fluid:oxygen' ? 0.001 : 1) });
    const { sol, steps, flows } = await planned(spec, 't@0', 1, 1, {}, value);
    expect(sol.runs.get('electrolyze')).toBe(4.5);
    expect(flows.filter((f) => f.key === 'fluid:oxygen').map((f) => [f.to, f.perSecond])).toEqual([['make-t', 100], ['sink', 4400]]);
    expect(steps.map((s) => [s.id, s.mainOutput])).toEqual([['electrolyze', 'h@0'], ['make-t', 't@0'], ['react', 'x@0']]);
  });
  it('lists every option a slot used', () => {
    // Fix spec R9: the solder slot of a circuit recipe split 36/64 between soldering alloy and tin lists both, each with
    // its share of the slot's amount; lead, which no conversion ran, is not listed.
    const options: Array<[string, number]> = [['fluid:molten.solder', 72], ['fluid:molten.tin', 144], ['fluid:molten.lead', 288]];
    const p = packFromSpec({ recipes: [{ id: 'ca', map: 'm', in: [['t:part@0', 1], { any: options }], out: [['t:ec@0', 1]] }] });
    const r = p.recipeById.get('ca')!;
    const slot = r.inputs.find((ing) => ing.options.length > 1)!;
    const line: StepLine = {
      targets: new Set(['t:ec@0']), used: new Map(), valueOf: undefined,
      conversions: new Map([[virtualKey(slot.options), new Map([['fluid:molten.solder', 0.36], ['fluid:molten.tin', 0.64]])]]),
    };
    expect(stepInputs(r, line)).toEqual([
      { key: 't:part@0', amount: 1, chance: 1 },
      { key: 'fluid:molten.solder', amount: 25.92, chance: 0.36 },
      { key: 'fluid:molten.tin', amount: 92.16, chance: 0.64 },
    ]);
    // One option used: that option at the slot's own amount and chance; none at all: the first by key, whole.
    const tinOnly = { ...line, conversions: new Map([[virtualKey(slot.options), new Map([['fluid:molten.tin', 2], ['fluid:molten.lead', 0]])]]) };
    expect(stepInputs(r, tinOnly).slice(1)).toEqual([{ key: 'fluid:molten.tin', amount: 144, chance: 1 }]);
    expect(stepInputs(r, { ...line, conversions: new Map() }).slice(1)).toEqual([{ key: 'fluid:molten.lead', amount: 288, chance: 1 }]);
    // A slot the line pins (`optionPins`) is that option, whatever ran.
    expect(stepInputs(r, { ...line, optionPins: new Map([['ca#100', 'fluid:molten.lead']]) }).slice(1)).toEqual([{ key: 'fluid:molten.lead', amount: 288, chance: 1 }]);
  });
  it('lists a good that fills several slots of a recipe once, with the amounts added up', async () => {
    // A real export gives each crafting-grid slot its own ingredient of amount 1 (recipes.ts craftingRecipe).
    const slot = (key: string): IngredientSpec => [key, 1];
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'hull', map: 'crafting', out: [['t@0', 1]],
          in: [slot('plate@0'), slot('plate@0'), slot('plate@0'), slot('cable@0'), slot('plate@0'), slot('plate@0'), slot('plate@0'), slot('plate@0'), slot('cable@0'), slot('plate@0')] },
        { id: 'make-cable', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['cable@0', 2]], eut: 2 },
        { id: 'make-plate', map: 'gt.recipe.macerator', in: [['raw@0', 1], ['raw@0', 1, 0.5]], out: [['plate@0', 1]], eut: 2 },
      ],
    };
    const { steps } = await planned(spec, 't@0', 1, 1);
    expect(steps.map((s) => [s.id, s.inputs])).toEqual([
      ['hull', [{ key: 'plate@0', amount: 8, chance: 1 }, { key: 'cable@0', amount: 2, chance: 1 }]],
      ['make-cable', [{ key: 'raw@0', amount: 1, chance: 1 }]],
      ['make-plate', [{ key: 'raw@0', amount: 1.5, chance: 0.75 }]]]);
  });
  it('passes flows through ore-dictionary conversions and sends byproducts to the sink', async () => {
    const { flows } = await planned(oreDict, 't@0', 1, 1);
    expect(flows.map((f) => [f.from, f.to, f.key, f.perSecond])).toEqual([
      ['make-b', 'sink', 'side@0', 2], ['make-b', 'use', 'b@0', 2], ['raw', 'make-b', 'raw@0', 2], ['use', 'out', 't@0', 1]]);
  });
  it('warns about fast hand-crafting unless crafting is automated', async () => {
    const spec: PackSpec = { recipes: [{ id: 'craft', map: 'crafting', in: [['raw@0', 1]], out: [['t@0', 1]] }] };
    // By hand is no longer the default (plan 12's Auto Workbench ruling): this case asks for it.
    const hand = (await planned(spec, 't@0', 2, 1, { automateCrafting: false })).steps[0];
    expect(hand).toMatchObject({ machine: { mteId: -3, name: 'Crafting table (by hand)', tier: 0 }, count: 2, utilization: 1, handCraft: true,
      durationTicks: 20, euPerTick: 0, warnings: ['More than one craft per second by hand — consider automating it'] });
    const automated = (await planned(spec, 't@0', 2, 1, { automateCrafting: true })).steps[0];
    expect(automated).toMatchObject({ machine: { mteId: -1, name: 'Crafting table (automated)' }, count: 2, handCraft: false, warnings: [] });
  });
  it('keeps a multiblock hatch within the group tier and flags cleanrooms', async () => {
    const spec: PackSpec = {
      maps: [{ id: 'gt.recipe.big' }], machines: [{ mteId: 500, name: 'Big Machine', maps: ['gt.recipe.big'], kind: 'multiblock' }],
      recipes: [{ id: 'big', map: 'gt.recipe.big', in: [['raw@0', 1]], out: [['t@0', 1]], eut: 100, dur: 100, meta: { cleanroom: true } }],
    };
    const { steps } = await planned(spec, 't@0', 0.1, 2, { machineTier: { big: 5 } });
    expect(steps[0]).toMatchObject({ machine: { mteId: 500, tier: 2 }, needsCleanroom: true, count: 1,
      warnings: ['Needs a cleanroom', 'Multiblock: count assumes one energy hatch at MV'] });
    const p = packFromSpec(spec);
    const big = p.recipeById.get('big')!;
    const at = (wantTier: number) => pickMachine(p, big, 'gt.recipe.big', { groupTier: 3, wantTier, coilHeat: 1801, automateCrafting: false, owned: none }).tier;
    expect([at(0), at(2), at(3), at(9)]).toEqual([2, 2, 3, 3]);
  });
  it('clamps a per-recipe singleblock tier and runs vanilla furnace recipes at their own speed', () => {
    expect([0, 7].map((wantTier) => pick('bend-plate', 'gt.recipe.metalbender', 2, { wantTier }).mteId)).toEqual([101, 102]);
    expect(pick('smelt-v', 'furnace', 1)).toMatchObject({ mteId: -2, name: 'Furnace', kind: 'furnace', runsPerSecondPerMachine: 0.1,
      oc: { euPerTick: 0, durationTicks: 200, overclocks: 0 } });
  });
  it('finds the programmed circuit in the recipe meta or a not-consumed input', () => {
    const p = packFromSpec({ recipes: [
      { id: 'by-meta', map: 'm', in: [['x@0', 1]], meta: { circuit: 3 } },
      { id: 'by-input', map: 'm', in: [['fluid:water', 0], ['x@0', 1], { nc: 'gregtech:gt.integrated_circuit@7' }] },
      { id: 'consumed', map: 'm', in: [['gregtech:gt.integrated_circuit@4', 1]] },
    ] });
    expect(['by-meta', 'by-input', 'consumed'].map((id) => recipeCircuit(p.recipeById.get(id)!))).toEqual([3, 7, undefined]);
  });
});
