// "Build machines at" and "Multiblocks" (the user's ruling 224 of 2026-10-20, plan 12 Task 7, architecture §11.39): every
// step's new machines at one tier the group picks — where a machine of that tier runs the recipe; else the lowest tier
// above that runs it, else the nearest below, the step saying so; a step's own tier pin first; owned machines of any
// tier still used — so the build-cost solve compares the routes at that tier and other recipes can win; and new
// multiblocks only where nothing else can do it: none beside a single-block machine that can be built here, and for a
// recipe only a multiblock runs a build weight that any other route beats, the step saying when one is still needed;
// owned multiblocks stay free. Synthetic packs only (Mini-GT and copies of it with invented recipes and machines).

import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { largeBenderSpec } from '../../helpers/build-fixtures.ts';
import { buildKeys, itemPrices } from '../../../src/server/planner/build-cost.ts';
import { lineBuildModel, machineOptions, ONLY_REQUIRED_MULTIBLOCK_WEIGHT, type BuildModel } from '../../../src/server/planner/machine-options.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanContext, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const WIDGET = 't:widget@0';
const ALLOY = 't:alloy@0';

/** A copy of Mini-GT with `more` appended to its lists. */
function miniGtWith(more: Pick<PackSpec, 'items' | 'maps' | 'machines' | 'recipes'>): PackSpec {
  const spec = structuredClone(MINI_GT);
  return {
    ...spec,
    items: [...(spec.items ?? []), ...(more.items ?? [])],
    maps: [...(spec.maps ?? []), ...(more.maps ?? [])],
    machines: [...(spec.machines ?? []), ...(more.machines ?? [])],
    recipes: [...(spec.recipes ?? []), ...(more.recipes ?? [])],
  };
}

/**
 * Mini-GT plus a Widget two ways: `press-widget` bends 2 iron ingots into one (24 EU/t × 100 t: the Basic Bending Machine
 * 101, 0.2 runs/s, or the Advanced one 102, overclocked to 0.4 runs/s, 40 raw here) and `draw-widget` draws one from a
 * copper ingot on an Advanced Wiremill (112, MV; 100 EU/t × 100 t, which no LV machine gives: 0.2 runs/s, 40 raw).
 * Copper costs 1.9 in the tests (`costOverrides`), so the wire route uses less raw material, and the Basic Bending
 * Machine 17.8 at MV prices (an LV hull 9, 2 circuits of 2 copper wires, redstone and 72 L of molten iron, 3.4 each, and
 * 2 iron plates).
 */
function widgetSpec(): PackSpec {
  return miniGtWith({
    items: [{ key: WIDGET, name: 'Widget' }],
    machines: [{ mteId: 112, name: 'Advanced Wiremill', maps: ['gt.recipe.wiremill'], tier: 2 }],
    recipes: [
      { id: 'press-widget', map: 'gt.recipe.metalbender', in: [['t:iron_ingot@0', 2]], out: [[WIDGET, 1]], eut: 24, dur: 100 },
      { id: 'draw-widget', map: 'gt.recipe.wiremill', in: [['t:copper_ingot@0', 1]], out: [[WIDGET, 1]], eut: 100, dur: 100 },
      { id: 'make-102', map: 'crafting', in: [['t:iron_ingot@0', 40]], out: [['machine:102@0', 1]] },
      { id: 'make-112', map: 'crafting', in: [['t:iron_ingot@0', 40]], out: [['machine:112@0', 1]] },
    ],
  });
}

/**
 * Mini-GT plus an Alloy Ingot: `smelt-alloy` makes 2 from an iron and a copper ingot on a Big Smelter (1300, a
 * multiblock with no structure, the only machine of its map; 20 iron ingots to build, 0.2 runs/s at LV) and, unless
 * `mixer` is false, `mix-alloy` makes 2 from 3 iron ingots on the Basic Assembler (121, 16 raw at LV): a raw material
 * of 1 an alloy against 1.5.
 */
function alloySpec(opts: { mixer?: boolean } = {}): PackSpec {
  return miniGtWith({
    items: [{ key: ALLOY, name: 'Alloy Ingot' }],
    maps: [{ id: 'gt.recipe.bigsmelter', name: 'Big Smelter' }],
    machines: [{ mteId: 1300, name: 'Big Smelter', kind: 'multiblock', maps: ['gt.recipe.bigsmelter'] }],
    recipes: [
      { id: 'smelt-alloy', map: 'gt.recipe.bigsmelter', in: [['t:iron_ingot@0', 1], ['t:copper_ingot@0', 1]], out: [[ALLOY, 2]], eut: 16, dur: 100 },
      ...(opts.mixer === false ? [] : [{ id: 'mix-alloy', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 3]] as Array<[string, number]>, out: [[ALLOY, 2]] as Array<[string, number]>, eut: 16, dur: 100 }]),
      { id: 'make-1300', map: 'crafting', in: [['t:iron_ingot@0', 20]], out: [['machine:1300@0', 1]] },
    ],
  });
}

/** Widgets at MV, 1 an hour, copper at 1.9. */
const W = (p: Partial<PlanSettings> = {}): PlanSettings => ({
  ...defaultSettings(), target: WIDGET, tier: 2, amount: 1, per: 'hour', costOverrides: { 't:copper_ingot@0': 1.9 }, ...p,
});
/** Alloy ingots at LV, 1 a minute. */
const A = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: ALLOY, tier: 1, amount: 1, per: 'min', ...p });
const owning = (...owned: PlanContext['ownedMachines']): PlanContext => ({ ...emptyContext(), ownedMachines: owned });

const ids = (plan: Plan): string[] => plan.steps.map((s) => s.id);
const stepOf = (plan: Plan, id: string): PlanStep => {
  const step = plan.steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`no step ${id} in ${ids(plan).join(', ')}`);
  return step;
};
/** The notes of a step about where its new machines are built and why a multiblock is needed. */
const notes = (step: PlanStep): string[] => step.warnings.filter((w) => w.startsWith('Built at') || w.startsWith('A multiblock'));

async function modelOf(pack: Pack, s: PlanSettings, c: PlanContext = emptyContext()): Promise<BuildModel> {
  const pricing = await linePricing(pack, s, c);
  if (pricing === null) throw new Error('the settings name no target of the pack');
  return lineBuildModel(pack, pricing.graph, pricing.basis, s, c);
}

describe('build machines at one tier', () => {
  it('builds every new machine at the tier picked, so a recipe only an MV machine runs wins at MV', async () => {
    // 24 widgets over the 24 h horizon; each new machine block costs half the least raw material over it (0.5 × 1.9 × 24 =
    // 22.8). Cheapest tier: the press on one Basic Bending Machine, 48 + 17.8 + 22.8 = 88.6, against the wire on one
    // Advanced Wiremill, 45.6 + 40 + 22.8 = 108.4. At MV the press needs an Advanced Bending Machine, 48 + 40 + 22.8 =
    // 110.8, so the wire route wins.
    const pack = packFromSpec(widgetSpec());
    const cheapest = await planLine(pack, W(), emptyContext());
    expect(cheapest.status, JSON.stringify(cheapest.warnings)).toBe('ok');
    expect(cheapest.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['press-widget', 101, 1]]);
    expect(cheapest.cost?.build).toBe(17.8);
    const atMv = await planLine(pack, W({ buildTier: 2 }), emptyContext());
    expect(atMv.status, JSON.stringify(atMv.warnings)).toBe('ok');
    expect(atMv.steps.map((s) => [s.id, s.machine.mteId, s.machine.tier, s.count])).toEqual([['draw-widget', 112, 2, 1]]);
    expect(atMv.cost?.build).toBe(40);
    expect(notes(stepOf(atMv, 'draw-widget'))).toEqual([]);
    // The step still lists every tier it can run at, none pinned: the project's tier choice is no pin.
    expect(stepOf(atMv, 'draw-widget').tiers?.map((t) => [t.tier, t.pinned])).toEqual([[2, undefined]]);
    // Build cost ignored: plan 09's least raw material picks the wire route anyway, still on an MV machine.
    const ignored = await planLine(pack, W({ buildTier: 2, buildHorizonHours: null }), emptyContext());
    expect(ignored.steps.map((s) => [s.id, s.machine.mteId])).toEqual([['draw-widget', 112]]);
    // A Make N batch builds its one machine per type at MV too, the press's included.
    for (const recipe of ['press-widget', 'draw-widget']) {
      const batch = await planLine(pack, W({ buildTier: 2, mode: 'makeN', amount: 24, recipeChoice: { [WIDGET]: recipe } }), emptyContext());
      expect(batch.status, JSON.stringify(batch.warnings)).toBe('ok');
      expect(batch.steps.map((s) => [s.id, s.machine.tier, s.count, s.owned])).toEqual([[recipe, 2, 1, 0]]);
    }
  });

  it('keeps only that tier for new machines, owned ones of every tier beside them', async () => {
    const pack = packFromSpec(widgetSpec());
    const press = W({ recipeChoice: { [WIDGET]: 'press-widget' } });
    expect((await modelOf(pack, press)).options('press-widget').map((o) => [o.id, o.canAdd])).toEqual([['gt:101', true], ['gt:102', true]]);
    expect((await modelOf(pack, { ...press, buildTier: 2 })).options('press-widget').map((o) => [o.id, o.canAdd])).toEqual([['gt:102', true]]);
    expect((await modelOf(pack, { ...press, buildTier: 1 })).options('press-widget').map((o) => [o.id, o.canAdd])).toEqual([['gt:101', true]]);
    const lvOwned = owning({ mteId: 101, count: 1 });
    expect((await modelOf(pack, { ...press, buildTier: 2 }, lvOwned)).options('press-widget').map((o) => [o.id, o.canAdd, o.owned]))
      .toEqual([['gt:101', false, 1], ['gt:102', true, 0]]);
    // 33 widgets a minute: 0.55 presses a second; the owned LV bender does 0.2 at most, so one new MV bender (0.4) does
    // the rest, where two would be needed without it.
    const plan = await planLine(pack, { ...press, buildTier: 2, amount: 33, per: 'min' }, lvOwned);
    expect(stepOf(plan, 'press-widget')).toMatchObject({
      machine: { mteId: 102, tier: 2 }, count: 1, owned: 0, reused: { count: 0, others: [{ mteId: 101, count: 1, units: [0] }] },
    });
    // A step's own pin wins over the project's tier.
    const pinned = await planLine(pack, { ...press, buildTier: 2, machineTier: { 'press-widget': 1 } }, emptyContext());
    expect(stepOf(pinned, 'press-widget')).toMatchObject({ machine: { mteId: 101, tier: 1 }, count: 1 });
    expect(notes(stepOf(pinned, 'press-widget'))).toEqual([]);
  });

  it('builds a recipe that needs more power at the lowest tier that runs it, and says so', async () => {
    const pack = packFromSpec(widgetSpec());
    const drawn = W({ buildTier: 1, recipeChoice: { [WIDGET]: 'draw-widget' } });
    expect((await modelOf(pack, drawn)).buildTierFallback?.('draw-widget')).toEqual({ wanted: 1, tier: 2, why: 'its recipe needs more power than an LV machine gives' });
    const plan = await planLine(pack, drawn, emptyContext());
    expect(stepOf(plan, 'draw-widget')).toMatchObject({ machine: { mteId: 112, tier: 2 }, count: 1 });
    expect(notes(stepOf(plan, 'draw-widget'))).toEqual(['Built at MV, not LV: its recipe needs more power than an LV machine gives']);
    // At the cheapest tier the press wins at LV, and nothing is said.
    const lv = await planLine(pack, W({ buildTier: 1 }), emptyContext());
    expect(lv.steps.map((s) => [s.id, s.machine.mteId])).toEqual([['press-widget', 101]]);
    expect(notes(stepOf(lv, 'press-widget'))).toEqual([]);
  });

  it('builds where the map has no machine of that tier at the nearest tier below, and says so', async () => {
    // At HV: no Bending Machine of HV, so the press's new machine is the Advanced (MV) one.
    const pack = packFromSpec(widgetSpec());
    const plan = await planLine(pack, W({ tier: 3, buildTier: 3, recipeChoice: { [WIDGET]: 'press-widget' } }), emptyContext());
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(stepOf(plan, 'press-widget')).toMatchObject({ machine: { mteId: 102, tier: 2 }, count: 1 });
    expect(notes(stepOf(plan, 'press-widget'))).toEqual(['Built at MV, not HV: no HV machine runs this recipe']);
  });

  it('builds below a machine of that tier that cannot be built here, and says why', async () => {
    // Mini-GT's MV bender and assembler have no recipe (controller ruling OQ5 a) and its wiremill map has no MV machine.
    // Crafted by hand, as build-plan.test.ts's `S` (with automated crafting and no Auto Workbench in Mini-GT, the free
    // crafting table hammers the plates at "Fewest machines").
    const circuits = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', tier: 2, automateCrafting: false, buildTier: 2, ...p });
    const plan = await planLine(miniGt(), circuits({ amount: 30 }), emptyContext());
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(plan.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['bend-plate', 101, 3], ['circuit-lv', 121, 5], ['wire', 111, 3]]);
    expect(plan.steps.map((s) => [s.id, notes(s)])).toEqual([
      ['bend-plate', ['Built at LV, not MV: Advanced Bending Machine cannot be built here (no recipe in this pack)']],
      ['circuit-lv', ['Built at LV, not MV: Advanced Assembler cannot be built here (no recipe in this pack)']],
      ['wire', ['Built at LV, not MV: no MV machine runs this recipe']],
    ]);
    // Owned machines only: nothing new is built, so nothing is said.
    const owned = await planLine(miniGt(), circuits({ amount: 1, per: 'hour' }), owning({ mteId: 101, count: 1 }, { mteId: 111, count: 1 }, { mteId: 121, count: 1 }));
    expect(owned.steps.filter((s) => s.count > s.owned)).toEqual([]);
    expect(owned.steps.flatMap(notes)).toEqual([]);
  });

  it('builds at the project tier when the tier picked is above it', async () => {
    const pack = packFromSpec(widgetSpec());
    const plan = await planLine(pack, W({ buildTier: 5 }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.machine.mteId])).toEqual([['draw-widget', 112]]);
    expect(plan.steps.flatMap(notes)).toEqual([]);
  });
});

describe('multiblocks only when nothing else can do it', () => {
  it('makes the good another way where a multiblock would be cheaper', async () => {
    // 1,440 alloys over 24 h, a new block costing 0.5 × 1,440 = 720: the Big Smelter 1,440 + 20 + 720 = 2,180 against the
    // assembler 2,160 + 16 + 720 = 2,896. Only where nothing else can do it, the smelter weighs a million raw more.
    const pack = packFromSpec(alloySpec());
    const allowed = await planLine(pack, A(), emptyContext());
    expect(allowed.status, JSON.stringify(allowed.warnings)).toBe('ok');
    expect(allowed.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['smelt-alloy', 1300, 1]]);
    expect(notes(stepOf(allowed, 'smelt-alloy'))).toEqual([]);
    const required = await planLine(pack, A({ multiblocks: 'only-required' }), emptyContext());
    expect(required.status, JSON.stringify(required.warnings)).toBe('ok');
    expect(required.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['mix-alloy', 121, 1]]);
    expect(required.cost?.build).toBe(16);
    // In Make N too: 64 alloys, a block 0.5 × 64 = 32: the smelter 64 + 20 + 32 = 116 against 96 + 16 + 32 = 144.
    const batch = (p: Partial<PlanSettings>): Promise<Plan> => planLine(pack, A({ mode: 'makeN', amount: 64, ...p }), emptyContext());
    expect(ids(await batch({}))).toEqual(['smelt-alloy']);
    expect(ids(await batch({ multiblocks: 'only-required' }))).toEqual(['mix-alloy']);
  });

  it('keeps a multiblock nothing else can replace, saying so, at its own build cost', async () => {
    const pack = packFromSpec(alloySpec({ mixer: false }));
    const plan = await planLine(pack, A({ multiblocks: 'only-required' }), emptyContext());
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(plan.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['smelt-alloy', 1300, 1]]);
    expect(notes(stepOf(plan, 'smelt-alloy'))).toEqual(['A multiblock is needed: nothing else makes Alloy Ingot']);
    expect(plan.cost?.build).toBe(20);
    const options = (await modelOf(pack, A({ multiblocks: 'only-required' }))).options('smelt-alloy');
    expect(options.map((o) => [o.id, o.build, o.solveBuild])).toEqual([['gt:1300', 20, 20 + ONLY_REQUIRED_MULTIBLOCK_WEIGHT]]);
    expect(ONLY_REQUIRED_MULTIBLOCK_WEIGHT).toBe(1e6);
  });

  it('runs an owned multiblock for free', async () => {
    const plan = await planLine(packFromSpec(alloySpec()), A({ multiblocks: 'only-required' }), owning({ mteId: 1300, count: 1 }));
    expect(plan.steps.map((s) => [s.id, s.machine.mteId, s.count, s.owned])).toEqual([['smelt-alloy', 1300, 1, 1]]);
    expect(plan.cost?.build).toBe(0);
    expect(plan.steps.flatMap(notes)).toEqual([]);
  });

  it('adds no multiblock beside a single-block machine that can be built here', async () => {
    // The Large Bender (1100) is offered beside the Basic Bending Machine only because the group owns one.
    const pack = packFromSpec(largeBenderSpec());
    const lv = { ...defaultSettings(), tier: 1 };
    const prices = await itemPrices(pack, lv, emptyContext(), buildKeys(pack, [...pack.machines.values()]));
    const env = { groupTier: 1, coilHeat: 1801, owned: new Map([['gt:1100', 1]]), prices };
    const bend = pack.recipeById.get('bend-plate')!;
    expect(machineOptions(pack, bend, 'gt.recipe.metalbender', env).map((o) => [o.id, o.canAdd])).toEqual([['gt:101', true], ['gt:1100', true]]);
    expect(machineOptions(pack, bend, 'gt.recipe.metalbender', { ...env, onlyRequiredMultiblocks: true }).map((o) => [o.id, o.canAdd, o.solveBuild]))
      .toEqual([['gt:101', true, 17], ['gt:1100', false, 83]]);
  });
});
