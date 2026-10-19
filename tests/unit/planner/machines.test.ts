import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { pickMachine, planSteps, buildFlows, ownedMachineMap, recipeCircuit, emptyContainers, type StepLine } from '../../../src/server/planner/machines.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
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
});

describe('more machine and flow cases', () => {
  const rawLeaf: LeafOracle = (k) => (k === 'raw@0' ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  /** `value` gives the steps what each good is worth and the empty containers of the pack (`StepLine`), as planLine does. */
  async function planned(
    spec: PackSpec, target: string, perSecond: number, tier: number, settings: Partial<PlanSettings> = {},
    value?: (p: Pack) => Pick<StepLine, 'valueOf' | 'empties'>,
  ) {
    const p = packFromSpec(spec);
    const s = { ...defaultSettings(), ...settings };
    const env: PlanEnv = { tier, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(s.excludedCategories) };
    const graph = buildCandidates(p, s, env, rawLeaf, [target]);
    const sol = await solveLine(graph, new Map([[target, perSecond]]));
    const steps = planSteps(p, graph, sol, {
      settings: s, groupTier: tier, coilHeat: 1801, ctx: emptyContextForTest(), perSecondScale: 1, ...(value === undefined ? {} : { value: value(p) }),
    });
    return { graph, sol, steps, flows: buildFlows(graph, sol, [target]) };
  }
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
    // A pyrolysis-like step: 1,000 L of water and 1 charcoal a run, both taken by other steps (half the water).
    const spec: PackSpec = {
      machines: [{ mteId: 1, name: 'M', maps: ['gt.recipe.macerator'], tier: 1 }],
      recipes: [
        { id: 'pyrolyse', map: 'gt.recipe.macerator', in: [['raw@0', 1]], out: [['fluid:water', 1000], ['t:charcoal@0', 1]], eut: 2 },
        { id: 'use-water', map: 'gt.recipe.macerator', in: [['fluid:water', 500]], out: [['wet@0', 1]], eut: 2 },
        { id: 'use-charcoal', map: 'gt.recipe.macerator', in: [['t:charcoal@0', 1]], out: [['fuel@0', 1]], eut: 2 },
        { id: 'combine', map: 'gt.recipe.macerator', in: [['wet@0', 1], ['fuel@0', 1]], out: [['t@0', 1]], eut: 2 },
      ],
    };
    const valueOf = (key: string): number => (key === 'fluid:water' ? 0.001 : key === 't:charcoal@0' ? 1 : 0);
    const main = (steps: Array<{ id: string; mainOutput?: string }>) => steps.find((s) => s.id === 'pyrolyse')?.mainOutput;
    expect(main((await planned(spec, 't@0', 1, 1, {}, () => ({ valueOf }))).steps)).toBe('t:charcoal@0');
    // Without values the old rule stands: the output the other steps take most of, by amount.
    expect(main((await planned(spec, 't@0', 1, 1)).steps)).toBe('fluid:water');
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
    const hand = (await planned(spec, 't@0', 2, 1)).steps[0];
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
