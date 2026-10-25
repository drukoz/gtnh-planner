// The planner side of the Auto Workbench's feeding rules (plan 12 Task 6; controller rulings 188 and 214, user ruling 180
// (d); research docs/research/machine-feeding.md §1.3, §6.1 items 2 and 7): a crafting recipe with a tool slot never
// runs on an Auto Workbench, its GGFab single-use variant does (a recipe of its own the loader derives, which the solve
// weighs against the hand recipe and the other routes), any other tool keeps it by hand with the reason on the step, and
// on Project Red and EnderIO lines a recipe whose least stock cannot fit a bench's eight safe slots is crafted by hand.

import { describe, it, expect } from 'vitest';
import { benchToolSpec, gizmoSpec, SINGLE_USE_FILE } from '../../helpers/build-fixtures.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { allMachines } from '../../../src/server/pack/lookup.ts';
import { benchLine, benchRefusal } from '../../../src/server/planner/benches.ts';
import { buildKeys, itemPrices } from '../../../src/server/planner/build-cost.ts';
import { machineOptions, type MachineOptionEnv } from '../../../src/server/planner/machine-options.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack, Recipe } from '../../../src/shared/types/pack.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const ctx = emptyContext();
const lv: PlanSettings = { ...defaultSettings(), tier: 1 };

function recipeOf(pack: Pack, id: string): Recipe {
  const r = pack.recipeById.get(id);
  if (r === undefined) throw new Error(`no recipe ${id}`);
  return r;
}

/** The GGFab single-use variant the loader derives from recipe `id` (`Recipe.meta.benchVariantOf`). */
function variantOf(pack: Pack, id: string): Recipe | undefined {
  return pack.recipes.find((r) => r.meta.benchVariantOf === id);
}

/** The options' environment at LV with every machine of `pack` priced, crafting automated unless `more` says otherwise. */
async function lvEnv(pack: Pack, more: Partial<MachineOptionEnv> = {}): Promise<MachineOptionEnv> {
  const prices = await itemPrices(pack, lv, ctx, buildKeys(pack, allMachines(pack)));
  return { groupTier: 1, coilHeat: 1801, owned: new Map(), prices, automateCrafting: true, ...more };
}

/** The ids of a line's graph (`linePricing`), with each recipe crafted by hand's reason. */
async function graphOf(pack: Pack, s: PlanSettings): Promise<Map<string, string | undefined>> {
  const pricing = await linePricing(pack, s, ctx);
  if (pricing === null) throw new Error('the settings name no target of the pack');
  return new Map(pricing.graph.recipes.filter((r) => r.kind === 'recipe').map((r) => [r.id, r.byHand]));
}

describe('GGFab single-use variants of tool recipes', () => {
  it('derives a variant of a crafting recipe whose tool slots all take a single-use tool, and of no other', () => {
    const pack = packFromSpec(benchToolSpec());
    const rod = recipeOf(pack, 'rod-file');
    const variant = variantOf(pack, 'rod-file');
    expect(variant).toBeDefined();
    // the same recipe with the tool slot a consumed input of its single-use tool, one a craft; the original keeps it held
    expect(variant).toMatchObject({ source: 'crafting', maps: ['crafting'], outputs: rod.outputs, meta: { benchVariantOf: 'rod-file' } });
    expect(variant!.id).not.toBe('rod-file');
    expect(variant!.inputs).toEqual([
      { slot: 0, consumed: true, chance: 1, options: [{ key: SINGLE_USE_FILE, amount: 1 }] },
      { slot: 1, consumed: true, chance: 1, options: [{ key: 't:iron_ingot@0', amount: 1 }] },
    ]);
    expect(rod.inputs[0]).toMatchObject({ consumed: false, options: [{ key: SINGLE_USE_FILE, amount: 1 }, { key: 't:file@0', amount: 1 }] });
    // a Mortar has no single-use kind: no variant; nor has a recipe without a tool
    expect(variantOf(pack, 'mash-mortar')).toBeUndefined();
    expect(variantOf(pack, 'hull-lv')).toBeUndefined();
    // a single-use item without a tool's ore name (a mold) is no tool to consume
    const spec: PackSpec = { ...benchToolSpec(), items: (benchToolSpec().items ?? []).map((i) => (i.key === SINGLE_USE_FILE ? { ...i, oreDict: ['SingleUseFileMold'] } : i)) };
    expect(variantOf(packFromSpec(spec), 'rod-file')).toBeUndefined();
  });

  it('gives the Auto Workbench to the variant and never to a recipe that holds a tool', async () => {
    const pack = packFromSpec(benchToolSpec());
    const env = await lvEnv(pack);
    // a craft wears the tool out of the grid's match: no bench option, so the step is crafted by hand
    expect(machineOptions(pack, recipeOf(pack, 'rod-file'), 'crafting', env)).toEqual([]);
    expect(machineOptions(pack, recipeOf(pack, 'mash-mortar'), 'crafting', env)).toEqual([]);
    expect(machineOptions(pack, variantOf(pack, 'rod-file')!, 'crafting', env).map((o) => o.id)).toEqual(['gt:31091']);
    expect(benchRefusal(pack, recipeOf(pack, 'mash-mortar'), {})).toBe('needs a Mortar, which an Auto Workbench cannot keep using');
    expect(benchRefusal(pack, recipeOf(pack, 'rod-file'), {})).toBe('needs a File, which an Auto Workbench cannot keep using');
    expect(benchRefusal(pack, variantOf(pack, 'rod-file')!, {})).toBeUndefined();
  });

  it("walks the variant beside its original only where the line's crafting runs on Auto Workbenches", async () => {
    const pack = packFromSpec(benchToolSpec());
    const variant = variantOf(pack, 'rod-file')!.id;
    const automated = await graphOf(pack, { ...lv, target: 't:rod@0' });
    expect([...automated.keys()].sort()).toEqual([variant, 'make-file', 'rod-file'].sort());
    expect(automated.get('rod-file')).toBe('needs a File, which an Auto Workbench cannot keep using');
    expect(automated.get(variant)).toBeUndefined();
    // crafting by hand (R0's case): no variant, nothing marked, as before
    const byHand = await graphOf(pack, { ...lv, target: 't:rod@0', automateCrafting: false });
    expect([...byHand.entries()]).toEqual([['rod-file', undefined]]);
    expect(benchLine(pack, { ...lv, automateCrafting: false }, 1)).toBeUndefined();
  });

  it('keeps a tool recipe and its variant as one producer where the walk keeps the cheapest', async () => {
    // a rod by file costs 1 iron ingot, by the variant 1 + 1/64 (the single-use file), on the bender 100/99 and in the
    // wiremill 50/49: the walk keeps three producers of a good, and the variant comes with its original, so it crowds
    // out neither machine route
    const spec = benchToolSpec();
    spec.recipes!.push(
      { id: 'rod-bend', map: 'gt.recipe.metalbender', in: [['t:iron_ingot@0', 100]], out: [['t:rod@0', 99]], eut: 8, dur: 20 },
      { id: 'rod-wire', map: 'gt.recipe.wiremill', in: [['t:iron_ingot@0', 50]], out: [['t:rod@0', 49]], eut: 8, dur: 20 },
    );
    const pack = packFromSpec(spec);
    const variant = variantOf(pack, 'rod-file')!.id;
    expect([...(await graphOf(pack, { ...lv, target: 't:rod@0' })).keys()].sort()).toEqual([variant, 'make-file', 'rod-bend', 'rod-file', 'rod-wire'].sort());
    // by hand, as before: no variant, three producers
    expect([...(await graphOf(pack, { ...lv, target: 't:rod@0', automateCrafting: false })).keys()].sort()).toEqual(['rod-bend', 'rod-file', 'rod-wire']);
  });

  it('plans the variant on an Auto Workbench, its single-use files a step of their own', async () => {
    const pack = packFromSpec(benchToolSpec());
    const plan = await planLine(pack, { ...lv, target: 't:rod@0' }, ctx);
    expect(plan.status).toBe('ok');
    const variant = variantOf(pack, 'rod-file')!.id;
    const rods = plan.steps.find((s) => s.recipeId === variant);
    // 1 a minute: one bench, the files of 1/64 an ingot a rod, against the hand recipe's three step charges
    expect(rods).toMatchObject({ machine: { mteId: 31091, name: 'Auto Workbench (LV)' }, count: 1, handCraft: false });
    expect(rods!.inputs.map((p) => p.key).sort()).toEqual([SINGLE_USE_FILE, 't:iron_ingot@0']);
    expect(plan.steps.map((s) => s.recipeId)).toContain('make-file');
    expect(plan.steps.some((s) => s.handCraft)).toBe(false);
    expect(plan.warnings.filter((w) => w.code === 'hand-step')).toEqual([]);
    // the swap list offers the hand recipe beside it
    expect(rods!.alternatives.map((a) => a.recipeId)).toContain('rod-file');
  });

  it('keeps crafting by hand as it was: no variant, the tool held', async () => {
    const pack = packFromSpec(benchToolSpec());
    const plan = await planLine(pack, { ...lv, target: 't:rod@0', automateCrafting: false }, ctx);
    expect(plan.steps.map((s) => [s.recipeId, s.machine.name, s.handCraft])).toEqual([['rod-file', 'Crafting table (by hand)', true]]);
    const variant = variantOf(pack, 'rod-file')!.id;
    expect(plan.steps[0]!.alternatives.map((a) => a.recipeId)).not.toContain(variant);
  });

  it('crafts a recipe no Auto Workbench runs by hand, weighed as a step by hand, saying why', async () => {
    const pack = packFromSpec(benchToolSpec());
    // by hand the mortar recipe weighs three step charges (1,440 raw a day at 1 a minute, 0.5 a charge: 2,160), more
    // than the mill's dearer iron (288 more) and its machine (4 and one charge, 720); at one charge it would win
    const milled = await planLine(pack, { ...lv, target: 't:mash@0' }, ctx);
    expect(milled.steps.map((s) => s.recipeId)).toEqual(['mash-mill']);
    // with no other way it is crafted by hand, and says why on the step and in the plan's warning
    const only = packFromSpec(benchToolSpec({ mill: false }));
    const plan = await planLine(only, { ...lv, target: 't:mash@0' }, ctx);
    expect(plan.steps.map((s) => [s.recipeId, s.machine.name, s.handCraft])).toEqual([['mash-mortar', 'Crafting table (by hand)', true]]);
    expect(plan.steps[0]!.warnings).toContain('Crafted by hand: it needs a Mortar, which an Auto Workbench cannot keep using');
    expect(plan.warnings.find((w) => w.code === 'hand-step')?.text)
      .toBe('Iron Mash is crafted by hand: 60/h; it needs a Mortar, which an Auto Workbench cannot keep using, so pin a machine recipe to automate it');
  });
});

describe('the cap rule on Project Red and EnderIO lines', () => {
  it("gives no Auto Workbench where the line keeps a stock that cannot fit a bench's safe slots", async () => {
    const pack = packFromSpec(gizmoSpec());
    const gizmo = recipeOf(pack, 'gizmo');
    const env = await lvEnv(pack);
    // one craft needs all nine input slots: AE2 pushes one whole set behind its Locking Card, machine to machine fills it by hand
    expect(machineOptions(pack, gizmo, 'crafting', env).map((o) => o.id)).toEqual(['gt:31091']);
    expect(machineOptions(pack, gizmo, 'crafting', { ...env, benchCapBy: 'Project Red' })).toEqual([]);
    expect(benchRefusal(pack, gizmo, { capBy: 'EnderIO' }))
      .toBe('needs 9 input slots of an Auto Workbench for its stock, more than the 8 an EnderIO line fills safely');
    expect(benchRefusal(pack, gizmo, {})).toBeUndefined();
  });

  it('crafts such a recipe by hand on Project Red and EnderIO lines and on a bench elsewhere', async () => {
    const pack = packFromSpec(gizmoSpec());
    const s: PlanSettings = { ...lv, target: 't:gizmo@0' };
    for (const logistics of ['routed', 'enderio'] as const) {
      const plan = await planLine(pack, { ...s, logistics }, ctx);
      expect(plan.steps.map((x) => [x.recipeId, x.machine.name, x.handCraft]), logistics).toEqual([['gizmo', 'Crafting table (by hand)', true]]);
      const capBy = logistics === 'routed' ? 'a Project Red' : 'an EnderIO';
      expect(plan.steps[0]!.warnings).toContain(`Crafted by hand: it needs 9 input slots of an Auto Workbench for its stock, more than the 8 ${capBy} line fills safely`);
    }
    for (const logistics of ['ae2', 'direct'] as const) {
      const plan = await planLine(pack, { ...s, logistics }, ctx);
      expect(plan.steps.map((x) => [x.recipeId, x.machine.name, x.handCraft]), logistics).toEqual([['gizmo', 'Auto Workbench (LV)', false]]);
    }
  });
});
