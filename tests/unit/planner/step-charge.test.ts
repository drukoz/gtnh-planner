// Steps vs raw material (fix spec R3, D6, D7, D24): a recipe step must save its share of the line's least raw material
// to be built, hand-crafting in a running line weighs three steps, total raw material never goes above 1.25 times the
// least, and the plan says when a step is left to hand-crafting or a pinned recipe is far dearer than another.

import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { buildCandidates, type LeafOracle, type PlanEnv } from '../../../src/server/planner/candidates.ts';
import { emptyContext, planLine, solveOptions } from '../../../src/server/planner/plan.ts';
import { solveLine, type SolveOptions } from '../../../src/server/planner/solve.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const env: PlanEnv = { tier: 1, reachable: new Set(['overworld']), lowGravity: false, coilHeat: 1801, excluded: new Set(defaultSettings().excludedCategories) };

/** The recipes a line making one t a second runs (sorted ids) and its solution; it buys the goods of `leafCosts` at their cost. */
async function charged(spec: PackSpec, leafCosts: Record<string, number>, opts?: SolveOptions) {
  const pack = packFromSpec(spec);
  const leaf: LeafOracle = (k) => (Object.hasOwn(leafCosts, k)
    ? { buyable: true, cost: leafCosts[k] as number, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
  const graph = buildCandidates(pack, defaultSettings(), env, leaf, ['t:t@0']);
  const sol = await solveLine(graph, new Map([['t:t@0', 1]]), opts);
  return { ids: [...sol.runs].filter(([, runs]) => runs > 0).map(([id]) => id).sort(), sol };
}

const ASSEMBLER: Pick<PackSpec, 'maps' | 'machines'> = {
  maps: [{ id: 'gt.recipe.assembler', name: 'Assembler' }],
  machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }],
};
/** One LV assembler recipe (16 EU/t) turning one `from` into one `to`. */
const step = (id: string, from: string, to: string): RecipeSpec => ({ id, map: 'gt.recipe.assembler', in: [[from, 1]], out: [[to, 1]], eut: 16 });
/** t from one a (`direct`), through a 4-recipe chain from c (`b1`, `b2`, `b3`, `from-b`), or a 10-recipe chain from e (`k1` … `k9`, `from-k`). */
const LINE: PackSpec = {
  ...ASSEMBLER,
  recipes: [
    step('direct', 't:a@0', 't:t@0'),
    step('b1', 't:c@0', 't:b1@0'), step('b2', 't:b1@0', 't:b2@0'), step('b3', 't:b2@0', 't:b3@0'), step('from-b', 't:b3@0', 't:t@0'),
    ...Array.from({ length: 9 }, (_, i) => step(`k${i + 1}`, i === 0 ? 't:e@0' : `t:k${i}@0`, `t:k${i + 1}@0`)),
    step('from-k', 't:k9@0', 't:t@0'),
  ],
};
const CHAIN = ['b1', 'b2', 'b3', 'from-b'];
const LONG_CHAIN = ['from-k', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];

describe('the step charge', () => {
  it('does not build a chain to save a crumb', async () => {
    // The chain saves 1 % of the raw material; at a 5 % charge each of its 4 steps costs more than that.
    expect((await charged(LINE, { 't:a@0': 1, 't:c@0': 0.99 }, { stepCharge: 0.05 })).ids).toEqual(['direct']);
    expect((await charged(LINE, { 't:a@0': 1, 't:c@0': 0.99 }, { stepCharge: 0 })).ids).toEqual(CHAIN);
  });
  it('builds a chain that saves enough', async () => {
    // 4 steps against 1 at 5 % each: the chain wins once 1/c + 0.05 > 1 + 0.2, below c = 1/1.15 ≈ 0.87.
    expect((await charged(LINE, { 't:a@0': 1, 't:c@0': 0.85 }, { stepCharge: 0.05 })).ids).toEqual(CHAIN);
    expect((await charged(LINE, { 't:a@0': 1, 't:c@0': 0.9 }, { stepCharge: 0.05 })).ids).toEqual(['direct']);
  });
  it('never goes above 1.25 times the least raw material', async () => {
    // The direct route would use 33 % more than the long chain, so the chain stays although its 9 extra steps cost more
    // than it saves; at 0.85 the direct route is within the cap and its steps win.
    const cheap = await charged(LINE, { 't:a@0': 1, 't:e@0': 0.75 }, { stepCharge: 0.05 });
    expect(cheap.ids).toEqual(LONG_CHAIN);
    expect(cheap.sol.rawCost).toBeLessThanOrEqual(1.25 * cheap.sol.leastRawCost);
    expect((await charged(LINE, { 't:a@0': 1, 't:e@0': 0.85 }, { stepCharge: 0.05 })).ids).toEqual(['direct']);
  });
  it('prefers a machine to hand-crafting in a running line', async () => {
    const spec: PackSpec = {
      maps: [{ id: 'gt.recipe.metalbender', name: 'Bending Machine' }, { id: 'crafting', name: 'Crafting' }],
      machines: [{ mteId: 2, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }],
      recipes: [{ id: 'p-hand', map: 'crafting', in: [['t:a@0', 1]], out: [['t:t@0', 1]] },
                { id: 'p-machine', map: 'gt.recipe.metalbender', in: [['t:a@0', 1]], out: [['t:t@0', 1]], eut: 24 }],
    };
    // A hand step weighs three steps; at the same weight the power tie-break takes the 0 EU/t crafting table.
    expect((await charged(spec, { 't:a@0': 1 }, { stepCharge: 0.05, handWeight: 3 })).ids).toEqual(['p-machine']);
    expect((await charged(spec, { 't:a@0': 1 }, { stepCharge: 0.05, handWeight: 1 })).ids).toEqual(['p-hand']);
  });
  it('keeps one of two equal producers', async () => {
    const twins: PackSpec = { ...ASSEMBLER, recipes: [step('q1', 't:a@0', 't:t@0'), step('q2', 't:a@0', 't:t@0')] };
    expect((await charged(twins, { 't:a@0': 1 }, { stepCharge: 0.05 })).ids).toHaveLength(1);
  });
});

describe('planLine and the step charge', () => {
  it('maps settings to solve options', () => {
    // Crafting-table steps run on the Auto Workbench by default (plan 12's ruling): a step like any other. The default is
    // "Fewest machines", 0.5 (plan 12 fix wave 2). One no Auto Workbench runs is still crafted by hand, and weighs
    // three steps in a running line (controller ruling 214, `byHandWeight`).
    expect(solveOptions(defaultSettings())).toEqual({ stepCharge: 0.5, handWeight: 1, byHandWeight: 3 });
    const byHand: PlanSettings = { ...defaultSettings(), automateCrafting: false, stepCharge: 0.02 };
    expect(solveOptions(byHand)).toEqual({ stepCharge: 0.02, handWeight: 3 });
    expect(solveOptions({ ...byHand, mode: 'makeN' })).toEqual({ stepCharge: 0.02, handWeight: 1 });
    expect(solveOptions({ ...byHand, automateCrafting: true })).toEqual({ stepCharge: 0.02, handWeight: 1, byHandWeight: 3 });
    expect(solveOptions({ ...byHand, automateCrafting: true, mode: 'makeN' })).toEqual({ stepCharge: 0.02, handWeight: 1 });
    expect(solveOptions({ ...byHand, stepCharge: 0 })).toEqual({ stepCharge: 0, handWeight: 3 });
    // A project stored before the setting existed plans with the default.
    const { stepCharge: _, ...old } = defaultSettings();
    expect(solveOptions(old as PlanSettings).stepCharge).toBe(0.5);
  });
  it('warns about a step left to hand-crafting', async () => {
    // An LV Machine Hull a minute: the hull and its tin cables have no machine recipe at LV. Crafted by hand, with build
    // cost ignored (plan 12): this case predates both.
    const pack = miniGt();
    const settings: PlanSettings = { ...defaultSettings(), target: 't:hull_lv@0', tier: 1, automateCrafting: false, buildHorizonHours: null };
    const plan = await planLine(pack, settings, emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['bend-plate', 'cable', 'hull-lv']);
    expect(plan.warnings).toContainEqual({ code: 'hand-step', stepId: 'hull-lv',
      text: 'LV Machine Hull is crafted by hand: 60/h; mark crafting as automated or pin a machine recipe' });
    expect(plan.warnings).toContainEqual({ code: 'hand-step', stepId: 'cable',
      text: '1x Tin Cable is crafted by hand: 120/h; mark crafting as automated or pin a machine recipe' });
    const automated = await planLine(pack, { ...settings, automateCrafting: true }, emptyContext());
    expect(automated.warnings.filter((w) => w.code === 'hand-step')).toEqual([]);
    // A batch may be crafted by hand.
    const batch = await planLine(pack, { ...settings, mode: 'makeN', amount: 2 }, emptyContext());
    expect(batch.warnings.filter((w) => w.code === 'hand-step')).toEqual([]);
  });
  it('flags a dominated pin', async () => {
    // Hammering a plate takes 2 iron ingots, bending it 1.
    const pack = miniGt();
    const settings: PlanSettings = { ...defaultSettings(), target: 't:circuit@0', tier: 1 };
    const pinned = await planLine(pack, { ...settings, recipeChoice: { 't:iron_plate@0': 'hammer-plate' } }, emptyContext());
    expect(pinned.steps.map((s) => s.id)).toContain('hammer-plate');
    expect(pinned.warnings).toContainEqual({ code: 'pin-dominated', stepId: 'hammer-plate', key: 't:iron_plate@0',
      text: 'Iron Plate: the pinned recipe uses 2 raw per unit; Bending Machine makes it for 1' });
    const free = await planLine(pack, settings, emptyContext());
    expect(free.warnings.filter((w) => w.code === 'pin-dominated')).toEqual([]);
  });
});
