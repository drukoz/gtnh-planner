// Machine options per step and the build model (plan 12 Task 3, architecture §11.39): every eligible machine tier of a
// step with its overclocked rate, build cost and owned count; machines that cannot be built here (controller ruling OQ5
// a) and pricing gaps (OQ5 b); tier pins (Amendment OQ5); sharing keys with the AE2 split, and none shared on Project Red
// (fix wave 2 (d)); owned pools;
// and crafting-table steps on GT++'s Auto Workbench (the controller's Auto Workbench ruling, gt-mechanics §8).

import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { centrifugeDustSpec, kitSpec, largeBenderSpec, sandSpec, withAutoWorkbenches, withPriceGap } from '../../helpers/build-fixtures.ts';
import { buildCostCounts, planBasis } from '../../../src/server/planner/basis.ts';
import { buildKeys, itemPrices, type ItemPrices } from '../../../src/server/planner/build-cost.ts';
import { buildCandidates, type CandidateGraph, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { makeLeafOracle } from '../../../src/server/planner/costs.ts';
import {
  AE2_POOL_MAX_PATTERNS, buildCounts, lineBuildModel, machineOptions, optionMachines, poolKey, sharingKey, type BuildModel, type MachineOption,
  type MachineOptionEnv,
} from '../../../src/server/planner/machine-options.ts';
import { ownedMachineMap, ownedPools } from '../../../src/server/planner/machines.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack, Recipe } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';
import { type MachineId } from '../../../src/shared/ids.ts';

const ctx = emptyContext();
const lv: PlanSettings = { ...defaultSettings(), tier: 1 };
const mv: PlanSettings = { ...defaultSettings(), tier: 2 };
const CIRCUIT = 't:circuit@0';

/** The prices of every machine of `pack` at `s`. */
function pricesOf(pack: Pack, s: PlanSettings): Promise<ItemPrices> {
  return itemPrices(pack, s, ctx, buildKeys(pack, [...pack.machines.values()]));
}

function recipeOf(pack: Pack, id: string): Recipe {
  const r = pack.recipeById.get(id);
  if (r === undefined) throw new Error(`no recipe ${id}`);
  return r;
}

/** The options' environment at MV with Cupronickel coils, owning `owned` ([id, count]). */
function mvEnv(prices: ItemPrices, owned: Array<[MachineId, number]> = [], more: Partial<MachineOptionEnv> = {}): MachineOptionEnv {
  return { groupTier: 2, coilHeat: 1801, owned: new Map(owned), prices, ...more };
}

const ids = (options: readonly MachineOption[]): MachineId[] => options.map((o) => o.id);

/** The build model of `pack`'s line for `s` (which names its target), on the graph `linePricing` walks. */
async function modelOf(pack: Pack, s: PlanSettings, c: PlanContext = ctx): Promise<BuildModel> {
  const pricing = await linePricing(pack, s, c);
  if (pricing === null) throw new Error('the settings name no target of the pack');
  return lineBuildModel(pack, pricing.graph, pricing.basis, s, c);
}

/** A leaf oracle that buys exactly `keys`, at 1 each. */
function buying(keys: readonly string[]): LeafOracle {
  const leaves = new Set(keys);
  return (key) => (leaves.has(key) ? { buyable: true, cost: 1, leafClass: 'direct' } : { buyable: false, cost: 0, leafClass: null });
}

/** A pack of one LV macerator and one-input macerator recipes `mace-<name>` (`t:<name>@0` → `t:d<name>@0`). */
function maceratorPack(names: readonly string[]): Pack {
  return packFromSpec({
    maps: [{ id: 'gt.recipe.macerator', name: 'Macerator' }],
    machines: [{ mteId: 141, name: 'Basic Macerator', tier: 1, maps: ['gt.recipe.macerator'] }],
    recipes: names.map((name) => ({ id: `mace-${name}`, map: 'gt.recipe.macerator', in: [[`t:${name}@0`, 1]], out: [[`t:d${name}@0`, 1]], eut: 2, dur: 40 })),
  });
}

/** The sharing keys of `ids` on `graph` with `logistics` (LV, nothing owned). */
async function keysOn(pack: Pack, graph: CandidateGraph, logistics: LogisticsMode, recipeIds: readonly string[]): Promise<string[]> {
  const s = { ...lv, logistics };
  const model = await lineBuildModel(pack, graph, planBasis(pack, s, ctx), s, ctx);
  return recipeIds.map((id) => model.sharingKey(id));
}

describe('machineOptions', () => {
  it('lists every eligible tier with its overclocked rate', async () => {
    const pack = miniGt();
    const options = machineOptions(pack, recipeOf(pack, 'circuit-lv'), 'gt.recipe.assembler', mvEnv(await pricesOf(pack, mv), [['gt:122', 1]]));
    // LV: log4(32 / 32) = 0 overclocks, 20 / 200 = 0.1 runs/s. MV: log4(128 / 32) = 1, the voltage cap MV − LV = 1, so
    // 16 × 4 = 64 EU/t and 200 / 2 = 100 ticks, 0.2 runs/s. No recipe makes the Advanced Assembler: it serves as owned.
    expect(options).toMatchObject([
      { id: 'gt:121', tier: 1, kind: 'basic', perMachine: 0.1, build: 15, owned: 0 },
      {
        id: 'gt:122', tier: 2, kind: 'basic', perMachine: 0.2, build: null, owned: 1, canAdd: false, unbuildable: 'no recipe in this pack',
        oc: { euPerTick: 64, durationTicks: 100, overclocks: 1 },
      },
    ]);
  });

  it('drops a machine that cannot be built unless the group owns it', async () => {
    const pack = miniGt();
    expect(ids(machineOptions(pack, recipeOf(pack, 'circuit-lv'), 'gt.recipe.assembler', mvEnv(await pricesOf(pack, mv))))).toEqual(['gt:121']);
  });

  it('keeps a pricing-gap machine when nothing else runs the recipe', async () => {
    // Task 2: 122 is made from a Seed Crystal nothing grounds, so it can be made but has no price.
    const gap = packFromSpec(withPriceGap(MINI_GT, [122]));
    const gapOptions = machineOptions(gap, recipeOf(gap, 'circuit-mv'), 'gt.recipe.assembler', mvEnv(await pricesOf(gap, mv)));
    // idiv(128, 120) = 1: no overclock, 20 / 100 = 0.2 runs/s.
    expect(gapOptions).toMatchObject([{ id: 'gt:122', perMachine: 0.2, build: null, owned: 0, canAdd: true }]);
    expect(gapOptions[0]?.unbuildable).toBeUndefined();
    const pack = miniGt();
    const prices = await pricesOf(pack, mv);
    expect(machineOptions(pack, recipeOf(pack, 'circuit-mv'), 'gt.recipe.assembler', mvEnv(prices))).toEqual([]);
    expect(machineOptions(pack, recipeOf(pack, 'circuit-mv'), 'gt.recipe.assembler', mvEnv(prices, [['gt:122', 1]])))
      .toMatchObject([{ id: 'gt:122', owned: 1, canAdd: false, unbuildable: 'no recipe in this pack' }]);
  });

  it('offers a multiblock only when no singleblock runs the recipe or the group owns it', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const prices = await pricesOf(pack, lv);
    const atLv = (owned: Array<[MachineId, number]>): MachineOption[] =>
      machineOptions(pack, recipeOf(pack, 'bend-plate'), 'gt.recipe.metalbender', mvEnv(prices, owned, { groupTier: 1 }));
    expect(ids(atLv([]))).toEqual(['gt:101']);
    // 67 for the controller and structure, 16 for its hatch set less the casings it takes (Task 2).
    expect(atLv([['gt:1100', 1]])).toMatchObject([
      { id: 'gt:101', tier: 1, kind: 'basic', perMachine: 0.2, build: 17, owned: 0 },
      { id: 'gt:1100', tier: 1, kind: 'multiblock', perMachine: 0.2, build: 83, owned: 1 },
    ]);
  });

  it('prices each hatch tier of a multiblock with the hatches it needs', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const options = machineOptions(pack, recipeOf(pack, 'bend-plate'), 'gt.recipe.metalbender', mvEnv(await pricesOf(pack, mv), [['gt:1100', 1]]));
    // Both hatch tiers stay (the MV energy hatch makes the faster one dearer); no recipe makes the Advanced Bending
    // Machine 102 and none is owned, so it is dropped.
    expect(options).toMatchObject([
      { id: 'gt:101', tier: 1, perMachine: 0.2, build: 16 },
      { id: 'gt:1100', tier: 1, kind: 'multiblock', perMachine: 0.2, build: 81.5, owned: 1, hatches: 'machine:51@0×1,machine:61@0×1,machine:71@0×1,machine:81@0×1' },
      { id: 'gt:1100', tier: 2, kind: 'multiblock', perMachine: 0.4, build: 86.5, owned: 1, hatches: 'machine:51@0×1,machine:61@0×1,machine:71@0×1,machine:82@0×1' },
    ]);
    expect(options[0]?.hatches).toBeUndefined();
  });

  it('never drops a machine that can be built for an owned one that cannot', async () => {
    // Rule 8: only an option that can add machines makes another one's new machines needless. Here the Basic Assembler's
    // only recipe is a pricing gap (it can be built, at a stand-in), and the owned Advanced Assembler cannot be built.
    const base = structuredClone(MINI_GT);
    const pack = packFromSpec(withPriceGap({ ...base, recipes: (base.recipes ?? []).filter((r) => r.id !== 'make-121') }, [121]));
    expect(machineOptions(pack, recipeOf(pack, 'circuit-lv'), 'gt.recipe.assembler', mvEnv(await pricesOf(pack, mv), [['gt:122', 1]]))).toMatchObject([
      { id: 'gt:121', perMachine: 0.1, build: null, owned: 0, canAdd: true },
      { id: 'gt:122', perMachine: 0.2, build: null, owned: 1, canAdd: false, unbuildable: 'no recipe in this pack' },
    ]);
  });

  it('keeps only the pinned tier, clamped to the eligible ones', async () => {
    const pack = miniGt();
    const prices = await pricesOf(pack, mv);
    const pinned = (pin: number, owned: Array<[MachineId, number]>, eligibleOnly?: true): MachineId[] =>
      ids(machineOptions(pack, recipeOf(pack, 'circuit-lv'), 'gt.recipe.assembler', mvEnv(prices, owned, eligibleOnly ? { pin, eligibleOnly } : { pin })));
    const one: Array<[MachineId, number]> = [['gt:122', 1]];
    // Amendment OQ5 (ruling P5): the pinned MV assembler is owned but cannot be built, so the LV one runs the rest.
    expect([1, 2, 5, 0].map((pin) => pinned(pin, one))).toEqual([['gt:121'], ['gt:121', 'gt:122'], ['gt:121', 'gt:122'], ['gt:121']]);
    expect([1, 2, 5, 0].map((pin) => pinned(pin, one, true))).toEqual([['gt:121', 'gt:122'], ['gt:121', 'gt:122'], ['gt:121', 'gt:122'], ['gt:121', 'gt:122']]);
    // Nothing owned: the MV tier can neither be built nor borrowed.
    expect(pinned(2, [])).toEqual(['gt:121']);
  });
});

describe('lineBuildModel', () => {
  it('gives a pricing-gap machine the largest priced build of its tier and kind', async () => {
    const make102: RecipeSpec = { id: 'make-102', map: 'crafting', in: [['t:hull_lv@0', 1], [CIRCUIT, 4]], out: [['machine:102@0', 1]] };
    const base = structuredClone(MINI_GT);
    const s = { ...mv, target: CIRCUIT };
    const model = await modelOf(packFromSpec(withPriceGap({ ...base, recipes: [...(base.recipes ?? []), make102] }, [122, 131])), s);
    // 102 (a hull 9 and 4 circuits of 2.5: 19) is the priced basic MV machine; 101 and 111 at 16 the dearest basic LV ones.
    expect(model.options('circuit-mv')).toMatchObject([{ id: 'gt:122', build: null, solveBuild: 19 }]);
    expect(model.options('extract-iron')).toMatchObject([{ id: 'gt:131', build: null, solveBuild: 16 }]);
    // With no priced MV machine, the dearest priced machine of the model.
    const noMv = await modelOf(packFromSpec(withPriceGap(MINI_GT, [122])), s);
    expect(noMv.options('circuit-mv')).toMatchObject([{ id: 'gt:122', build: null, solveBuild: 16 }]);
  });

  it('blocks a step whose only machine cannot be built', async () => {
    const pack = miniGt();
    const s = { ...mv, target: CIRCUIT };
    const model = await modelOf(pack, s);
    const blocked = new Map([
      ['circuit-mv', 'Advanced Assembler cannot be built here (no recipe in this pack)'],
      ['extract-iron', 'Basic Fluid Extractor cannot be built here (no recipe in this pack)'],
    ]);
    expect(model.blocked).toEqual(blocked);
    expect(model.options('circuit-mv')).toEqual([]);
    expect(model.ownedOnly('circuit-mv')).toBeUndefined();
    const owning = await modelOf(pack, { ...s, ownedManual: [{ mteId: 122, count: 1 }] });
    expect([...owning.blocked.keys()]).toEqual(['extract-iron']);
    expect(owning.ownedOnly('circuit-mv')).toEqual({ runsPerSecond: 0.2, text: '1× Advanced Assembler, which cannot be built here (no recipe in this pack)' });
    // Walked again without them (Task 5), the line makes its circuits on the LV assembler.
    const pricing = await linePricing(pack, s, ctx);
    const walked = buildCandidates(pack, s, pricing!.basis.env, pricing!.leaf, [CIRCUIT], { unbuildable: blocked }).recipes.map((r) => r.id);
    expect(walked).toContain('circuit-lv');
    expect(walked).not.toContain('circuit-mv');
    expect(walked).not.toContain('extract-iron');
    // Where nothing else makes the good, the walk names the machine that is missing.
    const spec = structuredClone(MINI_GT);
    const onlyMv = packFromSpec({ ...spec, recipes: (spec.recipes ?? []).filter((r) => r.id !== 'circuit-lv') });
    const basis = planBasis(onlyMv, s, ctx);
    expect(buildCandidates(onlyMv, s, basis.env, basis.leaf, [CIRCUIT], { unbuildable: blocked }).blocked.get(CIRCUIT))
      .toEqual([{ recipeId: 'circuit-mv', why: 'machine', machine: 'Advanced Assembler cannot be built here (no recipe in this pack)' }]);
  });

  it('names the other recipes of a blocked machine that no machine can run either', async () => {
    // The walk keeps only spin-1, the cheapest producer, so the model blocks it; spin-2 and spin-3 are on the same
    // centrifuge, which no recipe makes, so they are named too (`blockedAlike`) and one walk goes around them all.
    const pack = packFromSpec(centrifugeDustSpec());
    const s = { ...lv, target: 't:widget_dust@0' };
    const pricing = await linePricing(pack, s, ctx);
    expect(pricing!.graph.recipes.map((r) => r.id)).toContain('spin-1');
    expect(pricing!.graph.recipes.map((r) => r.id)).not.toContain('spin-2');
    const model = await lineBuildModel(pack, pricing!.graph, pricing!.basis, s, ctx);
    const why = 'Basic Centrifuge cannot be built here (no recipe in this pack)';
    expect(model.blocked).toEqual(new Map([['spin-1', why]]));
    expect(model.blockedAlike).toEqual(new Map([['spin-2', why], ['spin-3', why]]));
    // Walked once without all three, the line presses its dust, and that graph's model blocks nothing more.
    const unbuildable = new Map([...model.blocked, ...(model.blockedAlike ?? [])]);
    const again = await linePricing(pack, s, ctx, { unbuildable });
    expect(again!.graph.recipes.map((r) => r.id)).toContain('press-widget');
    expect((await lineBuildModel(pack, again!.graph, again!.basis, s, ctx)).blocked.size).toBe(0);
    // A model that blocks nothing names nothing beside it.
    expect((await modelOf(miniGt(), { ...lv, target: CIRCUIT })).blockedAlike).toBeUndefined();
  });

  it('falls back from a pinned tier that cannot be built to the nearest one that can', async () => {
    // Amendment OQ5 (ruling P5): the owned machines of the pinned tier run first, new ones are of the fallback tier.
    const pack = miniGt();
    const s = { ...mv, target: CIRCUIT, machineTier: { 'circuit-lv': 2 } };
    const fallback = { tier: 2, name: 'Advanced Assembler', why: 'no recipe in this pack' };
    const none = await modelOf(pack, s);
    expect(ids(none.options('circuit-lv'))).toEqual(['gt:121']);
    expect(none.pinFallback('circuit-lv')).toEqual(fallback);
    const owning = await modelOf(pack, { ...s, ownedManual: [{ mteId: 122, count: 1 }] });
    expect(owning.options('circuit-lv')).toMatchObject([{ id: 'gt:121', canAdd: true }, { id: 'gt:122', owned: 1, canAdd: false }]);
    expect(owning.pinFallback('circuit-lv')).toEqual(fallback);
    // No fallback on a pinned tier that can be built, nor without a pin.
    expect((await modelOf(pack, { ...s, machineTier: { 'circuit-lv': 1 } })).pinFallback('circuit-lv')).toBeUndefined();
    expect((await modelOf(pack, { ...mv, target: CIRCUIT })).pinFallback('circuit-lv')).toBeUndefined();
  });

  it('builds the model the settings ask for', async () => {
    const pack = miniGt();
    const s = { ...mv, target: CIRCUIT };
    const cases: Array<[Partial<PlanSettings>, Pick<BuildModel, 'mode' | 'horizonSeconds' | 'share'>, boolean]> = [
      [{}, { mode: 'rate', horizonSeconds: 86400, share: false }, true],
      [{ buildHorizonHours: 8 }, { mode: 'rate', horizonSeconds: 28800, share: false }, true],
      [{ buildHorizonHours: null }, { mode: 'rate', horizonSeconds: null, share: false }, false],
      // Project Red shares no machine (fix wave 2 (d)); AE2 does.
      [{ logistics: 'routed' }, { mode: 'rate', horizonSeconds: 86400, share: false }, true],
      [{ logistics: 'ae2' }, { mode: 'rate', horizonSeconds: 86400, share: true }, true],
      // EnderIO stays per step (controller ruling).
      [{ logistics: 'enderio' }, { mode: 'rate', horizonSeconds: 86400, share: false }, true],
      [{ mode: 'makeN', logistics: 'ae2' }, { mode: 'makeN', horizonSeconds: null, share: false }, true],
    ];
    for (const [patch, want, counts] of cases) {
      const settings = { ...s, ...patch };
      const model = await modelOf(pack, settings);
      expect({ mode: model.mode, horizonSeconds: model.horizonSeconds, share: model.share }).toEqual(want);
      expect(buildCounts(model)).toBe(counts);
      expect(buildCostCounts(settings)).toBe(counts);
    }
    const stored: PlanSettings = { ...s };
    delete stored.buildHorizonHours;
    expect(buildCostCounts(stored)).toBe(true);
    const model = await modelOf(pack, s);
    // Meta circuit 2; its held programmed circuit is not counted again.
    expect(model.sharingKey('circuit-lv')).toBe('2|');
    expect(model.sharingKey('bend-plate')).toBe('-|');
    expect(model.sharingKey('no-such-recipe')).toBe('-|');
  });

  it('keys sharing by programmed circuit, held items and fluids', async () => {
    const pack = packFromSpec({
      maps: [{ id: 'gt.recipe.fluidsolidifier', name: 'Fluid Solidifier' }],
      machines: [{ mteId: 301, name: 'Basic Fluid Solidifier', tier: 1, maps: ['gt.recipe.fluidsolidifier'] }],
      recipes: [
        { id: 'shaped', map: 'gt.recipe.fluidsolidifier', in: [{ nc: 't:shape_plate@0' }, ['t:a@0', 1]], out: [['t:b@0', 1]], eut: 8 },
        {
          id: 'lensed', map: 'gt.recipe.fluidsolidifier', in: [{ nc: 't:shape_plate@0' }, { nc: 't:lens@0' }, ['t:a@0', 1]], out: [['t:c@0', 1]],
          eut: 8, meta: { circuit: 3 },
        },
        { id: 'cast-iron', map: 'gt.recipe.fluidsolidifier', in: [{ nc: 't:shape_plate@0' }, ['fluid:molten.iron', 144]], out: [['t:d@0', 1]], eut: 8 },
        { id: 'cast-tin', map: 'gt.recipe.fluidsolidifier', in: [{ nc: 't:shape_plate@0' }, ['fluid:molten.tin', 144]], out: [['t:e@0', 1]], eut: 8 },
      ],
    });
    expect(sharingKey(recipeOf(pack, 'shaped'), ['t:shape_plate@0'])).toBe('-|t:shape_plate@0');
    expect(sharingKey(recipeOf(pack, 'lensed'), ['t:shape_plate@0', 't:lens@0', 't:lens@0'])).toBe('3|t:lens@0,t:shape_plate@0');
    // A basic machine has one input tank: steps on two fluids get two keys.
    expect(sharingKey(recipeOf(pack, 'cast-iron'), ['t:shape_plate@0'])).toBe('-|t:shape_plate@0|fluid:molten.iron|');
    expect(sharingKey(recipeOf(pack, 'cast-tin'), ['t:shape_plate@0'])).toBe('-|t:shape_plate@0|fluid:molten.tin|');
    // The fluids it makes count too (one output tank).
    const mini = miniGt();
    expect(sharingKey(recipeOf(mini, 'extract-iron'), [])).toBe('-|||fluid:molten.iron');
    expect(sharingKey(recipeOf(mini, 'circuit-mv'), [])).toBe('-||fluid:molten.iron|');
    const [opt121] = machineOptions(mini, recipeOf(mini, 'circuit-lv'), 'gt.recipe.assembler', mvEnv(await pricesOf(mini, lv), [], { groupTier: 1 }));
    expect(poolKey(opt121!, '2|')).toBe('gt:121:1:|2|');
  });

  it('shares no machine on Project Red lines', async () => {
    // Fix wave 2 (d), the controller's feeding ruling (docs/research/machine-feeding.md): a GT basic machine reruns the
    // recipe it cached while Project Red's responder chips top its inputs up, so a second recipe on the machine waits for
    // ever. On Project Red every step has its own machines, as on machine-to-machine lines; AE2 still pools them.
    const sand = packFromSpec(sandSpec());
    const glass = { ...lv, target: 't:glass@0' };
    const basis = planBasis(sand, glass, ctx);
    const leaf = makeLeafOracle(sand, glass, basis.avail, basis.prices, undefined, undefined, { supplied: basis.supplied, gatheredRecipes: true });
    const glassGraph = buildCandidates(sand, glass, basis.env, leaf, ['t:glass@0']);
    const routed = { ...glass, logistics: 'routed' as const };
    expect((await lineBuildModel(sand, glassGraph, planBasis(sand, routed, ctx), routed, ctx)).share).toBe(false);
    expect(await keysOn(sand, glassGraph, 'routed', ['hammer-gravel', 'hammer-sand'])).toEqual(['-|', '-|']);
    expect(await keysOn(sand, glassGraph, 'ae2', ['hammer-gravel', 'hammer-sand'])).toEqual(['-|', '-|']);
    const kit = packFromSpec(kitSpec());
    const kitGraph = (await linePricing(kit, { ...lv, target: 't:kit@0' }, ctx))!.graph;
    expect(await keysOn(kit, kitGraph, 'routed', ['circuit-lv', 'gear', 'kit'])).toEqual(['2|', '2|', '2|']);
    expect(await keysOn(kit, kitGraph, 'ae2', ['circuit-lv', 'gear', 'kit'])).toEqual(['2|', '2|', '2|']);
  });

  it('splits a sharing key past the nine patterns of one ME Interface on AE2', async () => {
    // Amendment OQ6 (ruling P6): ten one-input recipes on one map and key.
    const names = Array.from({ length: 10 }, (_, i) => `x${i}`);
    const pack = maceratorPack(names);
    const graph = buildCandidates(pack, lv, planBasis(pack, lv, ctx).env, buying(names.map((n) => `t:${n}@0`)), names.map((n) => `t:d${n}@0`));
    const recipeIds = names.map((n) => `mace-${n}`);
    expect(AE2_POOL_MAX_PATTERNS).toBe(9);
    expect(await keysOn(pack, graph, 'ae2', recipeIds)).toEqual([...names.slice(0, 9).map(() => '-|'), '-|#1']);
    expect(await keysOn(pack, graph, 'direct', recipeIds)).toEqual(names.map(() => '-|'));
  });

  it('reads the owned pool from the world and the manual list', () => {
    const c: PlanContext = { ...emptyContext(), ownedMachines: [{ mteId: 121, count: 2, where: [{ dim: 0, pos: [1, 64, 1] }, { dim: 0, pos: [2, 64, 1] }] }] };
    const s: PlanSettings = { ...defaultSettings(), ownedManual: [{ mteId: 121, count: 1 }, { mteId: 111, count: 1 }] };
    expect([...ownedPools(c, s)]).toEqual([[121, [{ dim: 0, pos: [1, 64, 1] }, { dim: 0, pos: [2, 64, 1] }, null]], [111, [null]]]);
    expect([...ownedMachineMap(c, s)]).toEqual([[121, 3], [111, 1]]);
    expect([...ownedPools(c, { ...s, declineReuse: [121] })]).toEqual([[111, [null]]]);
    expect([...ownedPools(c, { ...s, reuseOwned: false })]).toEqual([]);
  });

  it('prices every machine the graph can use', async () => {
    const pack = miniGt();
    const pricing = (await linePricing(pack, { ...mv, target: CIRCUIT }, ctx))!;
    const machines = optionMachines(pack, pricing.graph, { groupTier: 2, multiblocks: pricing.basis.env.multiblocks }, new Map()).map((m) => m.mteId);
    expect(machines).toEqual(expect.arrayContaining([101, 102, 111, 121, 122, 131]));
    // Iron ingots are bought, so no macerator recipe is in the graph.
    expect(machines).not.toContain(141);
  });
});

describe('crafting-table steps on the Auto Workbench', () => {
  it('runs a crafting-table step on the Auto Workbench tiers when crafting is automated', async () => {
    const pack = packFromSpec(withAutoWorkbenches(MINI_GT, [1, 2, 3]));
    const env = mvEnv(await pricesOf(pack, mv));
    const plate = recipeOf(pack, 'hammer-plate');
    // 2,048 EU a craft at 1 A of the tier's voltage: 64 ticks at LV, 16 at MV (gt-mechanics §8); the HV one is above MV.
    expect(machineOptions(pack, plate, 'crafting', { ...env, automateCrafting: true })).toMatchObject([
      {
        id: 'gt:31091', name: 'Auto Workbench (LV)', tier: 1, kind: 'basic', perMachine: 0.3125, build: 14, owned: 0, canAdd: true,
        oc: { euPerTick: 32, durationTicks: 64, overclocks: 0 },
      },
      {
        id: 'gt:31092', name: 'Auto Workbench (MV)', tier: 2, kind: 'basic', perMachine: 1.25, build: 19, owned: 0, canAdd: true,
        oc: { euPerTick: 128, durationTicks: 16, overclocks: 0 },
      },
    ]);
    // By hand no machine runs it, and the vanilla furnace never has one.
    expect(machineOptions(pack, plate, 'crafting', env)).toEqual([]);
    expect(machineOptions(pack, plate, 'crafting', { ...env, automateCrafting: false })).toEqual([]);
    expect(machineOptions(pack, recipeOf(pack, 'smelt-v'), 'furnace', { ...env, automateCrafting: true })).toEqual([]);
    // Nor does any in a pack without an Auto Workbench.
    const mini = miniGt();
    expect(machineOptions(mini, recipeOf(mini, 'hammer-plate'), 'crafting', { ...mvEnv(await pricesOf(mini, mv)), automateCrafting: true })).toEqual([]);
  });

  it('crafts once a tick from EV on', async () => {
    const pack = packFromSpec(withAutoWorkbenches(MINI_GT, [1, 2, 3, 4, 5, 6, 7, 8], { buildable: false }));
    const options = machineOptions(pack, recipeOf(pack, 'hammer-plate'), 'crafting',
      mvEnv(await pricesOf(pack, mv), [], { groupTier: 8, automateCrafting: true, eligibleOnly: true }));
    expect(options.map((o) => [o.tier, o.oc.euPerTick, o.oc.durationTicks, o.perMachine])).toEqual([
      [1, 32, 64, 0.3125], [2, 128, 16, 1.25], [3, 512, 4, 5], [4, 2048, 1, 20], [5, 2048, 1, 20], [6, 2048, 1, 20], [7, 2048, 1, 20], [8, 2048, 1, 20],
    ]);
    expect(options.every((o) => o.unbuildable === 'no recipe in this pack' && !o.canAdd)).toBe(true);
    // An IV one is no faster than an EV one and dearer to build (a hull 9 and 10 circuits against 8, at 2.5): rule 8
    // keeps the EV one.
    const built = packFromSpec(withAutoWorkbenches(MINI_GT, [4, 5]));
    const fast = machineOptions(built, recipeOf(built, 'hammer-plate'), 'crafting', mvEnv(await pricesOf(built, mv), [], { groupTier: 5, automateCrafting: true }));
    expect(fast).toMatchObject([{ id: 'gt:31094', tier: 4, perMachine: 20, build: 29 }]);
  });

  it('never shares an Auto Workbench between two crafting recipes', async () => {
    // It crafts the 3×3 pattern set in its GUI and never switches recipes by itself (gt-mechanics §8): the key holds the recipe.
    const pack = packFromSpec(withAutoWorkbenches(MINI_GT, [1, 2]));
    expect(sharingKey(recipeOf(pack, 'hammer-plate'), [])).toBe('-||recipe:hammer-plate');
    expect(sharingKey(recipeOf(pack, 'cable'), [])).toBe('-||recipe:cable');
    // Each crafting recipe is a part of its own on a network: no split suffix.
    const s = { ...lv, target: CIRCUIT, automateCrafting: true, logistics: 'routed' as const };
    expect((await modelOf(pack, s)).sharingKey('hammer-plate')).toBe('-||recipe:hammer-plate');
    expect((await modelOf(pack, { ...s, logistics: 'ae2' })).sharingKey('hammer-plate')).toBe('-||recipe:hammer-plate');
  });

  it('builds the Auto Workbench into the model, or blocks the step where none can be built', async () => {
    const s = { ...lv, target: CIRCUIT, automateCrafting: true };
    const pack = packFromSpec(withAutoWorkbenches(MINI_GT, [1, 2]));
    const model = await modelOf(pack, s);
    // At LV: a hull 9 and 2 circuits of 3.
    expect(model.options('hammer-plate')).toMatchObject([{ id: 'gt:31091', tier: 1, build: 15, canAdd: true }]);
    expect(model.blocked.has('hammer-plate')).toBe(false);
    const pricing = (await linePricing(pack, s, ctx))!;
    expect(optionMachines(pack, pricing.graph, { groupTier: 1, automateCrafting: true }, new Map()).map((m) => m.mteId)).toContain(31091);
    expect(optionMachines(pack, pricing.graph, { groupTier: 1 }, new Map()).map((m) => m.mteId)).not.toContain(31091);
    const unbuilt = await modelOf(packFromSpec(withAutoWorkbenches(MINI_GT, [1, 2], { buildable: false })), s);
    expect(unbuilt.blocked.get('hammer-plate')).toBe('Auto Workbench (LV) cannot be built here (no recipe in this pack)');
    // By hand the step stays a pseudo step: no options, nothing eligible, not blocked.
    const byHand = await modelOf(pack, { ...s, automateCrafting: false });
    expect([byHand.options('hammer-plate'), byHand.eligible('hammer-plate'), byHand.blocked.has('hammer-plate')]).toEqual([[], [], false]);
  });
});

describe('AE2 pools by blocking mode and the machine\'s own input slots', () => {
  // Controller ruling 214 (b), research machine-feeding §3.3: a shared machine needs blocking mode, which never pushes into
  // a machine holding an item it does not ignore, and pushes one recipe's set at a time, which must fit the machine's own
  // input slots at its tier less what it holds.
  const MOLD = 'gregtech:gt.metaitem.01@32301';
  const SCHEMATIC = 't:schematic@0';
  const LENS = 't:lens@0';
  /** Mini-GT with LV and HV Forming Presses (GT's slot table: 2 and 4 input slots) and press recipes holding `held`. */
  const pressPack = (held: string) => packFromSpec({
    ...structuredClone(MINI_GT),
    items: [...structuredClone(MINI_GT).items!, { key: LENS, name: 'Glass Lens', gt: { prefix: 'lens', material: 'Glass' } }, { key: SCHEMATIC, name: 'Schematic' },
      { key: MOLD, name: 'Mold (Plate)' }, { key: 't:combo@0', name: 'Combo' }],
    maps: [...structuredClone(MINI_GT).maps!, { id: 'gt.recipe.press', name: 'Forming Press' }],
    machines: [...structuredClone(MINI_GT).machines!,
      { mteId: 201, name: 'Basic Forming Press', tier: 1, maps: ['gt.recipe.press'], metaName: 'basicmachine.press.tier.01' },
      { mteId: 203, name: 'Advanced Forming Press II', tier: 3, maps: ['gt.recipe.press'], metaName: 'basicmachine.press.tier.03' }],
    recipes: [...structuredClone(MINI_GT).recipes!,
      { id: 'press-a', map: 'gt.recipe.press', in: [{ nc: held }, ['t:iron_ingot@0', 1]], out: [['t:pa@0', 1]], eut: 16, dur: 40 },
      { id: 'press-b', map: 'gt.recipe.press', in: [{ nc: held }, ['t:copper_ingot@0', 1]], out: [['t:pb@0', 1]], eut: 16, dur: 40 },
      { id: 'press-two', map: 'gt.recipe.press', in: [{ nc: held }, ['t:iron_ingot@0', 1], ['t:tin_ingot@0', 1]], out: [['t:pt@0', 1]], eut: 16, dur: 40 },
      { id: 'make-201', map: 'crafting', in: [['t:iron_ingot@0', 4]], out: [['machine:201@0', 1]] },
      { id: 'make-203', map: 'crafting', in: [['t:iron_ingot@0', 8]], out: [['machine:203@0', 1]] },
      { id: 'combo', map: 'gt.recipe.assembler', in: [['t:pa@0', 1], ['t:pb@0', 1]], out: [['t:combo@0', 1]], eut: 16, dur: 40 }],
  });

  it('keys a recipe holding an item blocking mode does not ignore by its own recipe', () => {
    // GT's ignore list holds the programmed circuit, its molds, shapes and blades, and lenses: not a Packager's schematic
    const keyOf = (held: string, withPack: boolean): string => {
      const pack = pressPack(held);
      return sharingKey(recipeOf(pack, 'press-a'), [held], withPack ? pack : undefined);
    };
    expect(keyOf(SCHEMATIC, true)).toBe(`-|${SCHEMATIC}|recipe:press-a`);
    expect(keyOf(MOLD, true)).toBe(`-|${MOLD}`);
    expect(keyOf(LENS, true)).toBe(`-|${LENS}`);
    expect(keyOf('gregtech:gt.integrated_circuit@2', true)).toBe('2|');
    // without the pack (Task 3's callers) as before
    expect(keyOf(SCHEMATIC, false)).toBe(`-|${SCHEMATIC}`);
  });

  it('pools on AE2 the recipes holding one mold, and none holding a schematic', async () => {
    const s: PlanSettings = { ...lv, target: 't:combo@0', logistics: 'ae2' };
    const molds = await planLine(pressPack(MOLD), s, ctx);
    const pool = { id: 'pool:press-a', steps: ['press-a', 'press-b'] };
    expect(molds.steps.filter((x) => x.pool !== undefined).map((x) => [x.id, x.pool])).toEqual([['press-a', pool], ['press-b', pool]]);
    const schematics = await planLine(pressPack(SCHEMATIC), s, ctx);
    expect(schematics.steps.map((x) => x.id)).toEqual(expect.arrayContaining(['press-a', 'press-b']));
    expect(schematics.steps.filter((x) => x.pool !== undefined)).toEqual([]);
  });

  it("pools on an option only the recipes whose item kinds fit its own input slots less what they hold", async () => {
    const pack = pressPack(MOLD);
    const env = mvEnv(await pricesOf(pack, mv), [], { groupTier: 3 });
    // two kinds and a held mold: the LV press's two slots leave one, the HV press's four leave three
    const two = machineOptions(pack, recipeOf(pack, 'press-two'), 'gt.recipe.press', { ...env, eligibleOnly: true });
    expect(two.map((o) => [o.id, o.ownPool])).toEqual([['gt:201', 'press-two'], ['gt:203', undefined]]);
    expect(poolKey(two[0]!, '-|' + MOLD)).toBe(`gt:201:1:|-|${MOLD}|own:press-two`);
    expect(poolKey(two[1]!, '-|' + MOLD)).toBe(`gt:203:3:|-|${MOLD}`);
    const one = machineOptions(pack, recipeOf(pack, 'press-a'), 'gt.recipe.press', { ...env, eligibleOnly: true });
    expect(one.map((o) => [o.id, o.ownPool])).toEqual([['gt:201', undefined], ['gt:203', undefined]]);
    // a machine the slot table does not know is not limited
    const assembler = machineOptions(pack, recipeOf(pack, 'combo'), 'gt.recipe.assembler', { ...env, eligibleOnly: true });
    expect(assembler.every((o) => o.ownPool === undefined)).toBe(true);
  });
});
