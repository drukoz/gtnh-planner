// Add-on 17 Task 4: farms in the candidate graph, on the synthetic farm pack (tests/helpers/farm-fixtures.ts). Which farm
// machines a line may use (`farmSetup`), the goods it wants (`wantedGoods`), the synthetic Tree Growth Simulator and crop
// recipes for them (`farmRecipes`) and the pack that holds them (`withFarms`); the line's pricing walking the farms'
// products in every mode, a farm running at its own tier without overclocking, and whole plans: an owned tree farm, crop
// sticks under a new Crop Manager with their plantings in the build cost, the build list and the build steps, and Make N
// on owned farms only. The final review: the soil each crop is planted on (`cropSoil`), one the line can get.

import { describe, it, expect } from 'vitest';
import type { MachineId } from '../../../src/shared/ids.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { defaultFarmSettings, type FarmSettings } from '../../../src/shared/types/farm.ts';
import type { Pack, Recipe } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';
import { recipeId } from '../../../src/server/pack/recipe-id.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { itemPrices, type ItemPrices } from '../../../src/server/planner/build-cost.ts';
import type { CandidateGraph } from '../../../src/server/planner/candidates.ts';
import { makePrices } from '../../../src/server/planner/costs.ts';
import { machineOptions } from '../../../src/server/planner/machine-options.ts';
import { pickMachine } from '../../../src/server/planner/machines.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing, type LinePricing } from '../../../src/server/planner/pricing.ts';
import { CROP_MANAGER_MAP, exportPack, withFarms } from '../../../src/server/planner/farms/pack.ts';
import {
  CROP_STICKS, FARM_SOURCES_PER_GOOD, PLAIN_SOILS, cropSoil, farmRecipes, plantingKeys, plantingParts, soilItem, soilsToPrice, sticksOf, wantedGoods,
  type SoilSource,
} from '../../../src/server/planner/farms/recipes.ts';
import { sig9 } from '../../../src/server/planner/round.ts';
import { farmSetup, type FarmSetup } from '../../../src/server/planner/farms/setup.ts';
import { opt, solvedWithBuild, twoFreeSpec } from '../../helpers/build-fixtures.ts';
import { FIELD_FLAX, RESIN_CANE, RUBBER_BONSAI, ORE_FERN, farmPack, farmSpec } from '../../helpers/farm-fixtures.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';

const SAW = 'gregtech:gt.metatool.01@10';
const KNIFE = 'gregtech:gt.metatool.01@34';
const RESIN = 't:resin@0';
const RUBBER_WOOD = 't:rubber_wood@0';
const DIRT = 'minecraft:dirt@0';
const TREE_FARM = 'gt.recipe.treefarm';
const RESIN_BOARD = 't:resin_board@0';
const RUBBER_DUST = 't:rubber_dust@0';
const LINEN = 't:linen@0';
const FARMLAND = 'minecraft:farmland@0';
const ENCHANTED_EARTH = 't:enchanted_earth@0';
const GARDEN_SOIL = 't:garden_soil@0';
/** The integrity warnings of a plan's flows (`indexPlan`): none in a plan that adds up. */
const INTEGRITY = ['orphan-input', 'short-input', 'multi-producer', 'bought-and-made'];

/** The project settings of a case: the defaults (both farm kinds on), `target` a minute, then the case's own. */
function settingsOf(target: StuffKey, c: Partial<PlanSettings> = {}): PlanSettings {
  return { ...defaultSettings(), target, per: 'min', ...c };
}

/** The default farm settings with `patch` over them. */
function farmsWith(patch: Partial<FarmSettings>): FarmSettings {
  return { ...defaultFarmSettings(), ...patch };
}

/** A pack-free price table for machine options: every key costs 1. */
const FLAT: ItemPrices = { cost: () => 1, gap: () => undefined };

/** The soils a line of `pack` at `s` can get (its basis's availability), each priced 1: what `farmRecipes` plants on here. */
function soilsAt(pack: Pack, s: PlanSettings): SoilSource {
  const { avail } = planBasis(pack, s, emptyContext());
  return { canGet: (key) => avail.available.has(key), cost: () => 1 };
}

/** The soils of a tree farm's tests, which plant no crop. */
const NO_SOILS: SoilSource = { canGet: () => false, cost: () => Infinity };

/** The line's pricing (it has a target the farm pack knows). */
async function pricingOf(pack: Pack, s: PlanSettings, ctx: PlanContext = emptyContext()): Promise<LinePricing> {
  const pricing = linePricing(pack, s, ctx);
  if (pricing === null) throw new Error('no pricing');
  return pricing;
}

/** The one step of `plan` whose farm is of `kind`. */
function farmStep(plan: Plan, kind: 'tgs' | 'crop'): Plan['steps'][number] {
  const steps = plan.steps.filter((s) => s.farm?.kind === kind);
  expect(steps).toHaveLength(1);
  return steps[0]!;
}

describe('which farms a line may use', () => {
  it('offers a tree farm only where the group owns or can build one', async () => {
    const pack = farmPack();
    const setupOf = (c: Partial<PlanSettings>, ctx: PlanContext = emptyContext()): FarmSetup => {
      const s = settingsOf(RESIN_BOARD, c);
      return farmSetup(pack, s, ctx, planBasis(pack, s, ctx));
    };
    // MV: the controller needs the Moon's titanium dust, which progression reaches at HV
    expect(setupOf({ tier: 2 }).tgs).toBeNull();
    expect(setupOf({ tier: 2, ownedManual: [{ mteId: 15541, count: 1 }] }).tgs).toEqual({ tier: 1, machines: [15541] });
    expect(setupOf({ tier: 2 }, { ...emptyContext(), ownedMachines: [{ mteId: 15541, count: 1 }] }).tgs).toEqual({ tier: 1, machines: [15541] });
    expect(setupOf({ tier: 2, ownedManual: [{ mteId: 15541, count: 1 }], reuseOwned: false }).tgs).toBeNull();
    expect(setupOf({ tier: 2, ownedManual: [{ mteId: 15541, count: 1 }], declineReuse: [15541] }).tgs).toBeNull();
    expect(setupOf({ tier: 3 }).tgs).toEqual({ tier: 1, machines: [15541] });
    // the energy hatch of the farm settings, never above the line's tier
    expect(setupOf({ tier: 3, farms: farmsWith({ tgs: { ...defaultFarmSettings().tgs, tier: 5 } }) }).tgs).toEqual({ tier: 3, machines: [15541] });
    // a Make N batch runs on owned farms only
    expect(setupOf({ tier: 3, mode: 'makeN', amount: 64 }).tgs).toBeNull();
    expect(setupOf({ tier: 3, mode: 'makeN', amount: 64, ownedManual: [{ mteId: 15541, count: 1 }] }).tgs).toEqual({ tier: 1, machines: [15541] });
    expect(setupOf({ tier: 3, farms: farmsWith({ kinds: ['crop-manager'] }) }).tgs).toBeNull();

    const crops = defaultFarmSettings().crops;
    expect(setupOf({ tier: 1 }).crops).toEqual({ tier: 1, machines: [28001], parallel: 121 });
    expect(setupOf({ tier: 2, farms: farmsWith({ crops: { ...crops, tier: 2, layers: 2 } }) }).crops)
      .toEqual({ tier: 2, machines: [28002], parallel: 450 });
    expect(setupOf({ tier: 2, farms: farmsWith({ crops: { ...crops, tier: 3 } }) }).crops).toEqual({ tier: 2, machines: [28002], parallel: 225 });
    expect(setupOf({ tier: 1, farms: farmsWith({ kinds: ['tgs'] }) }).crops).toBeNull();
    expect(setupOf({ tier: 1, mode: 'makeN', amount: 64 }).crops).toBeNull();
    expect(setupOf({ tier: 1, mode: 'makeN', amount: 64, ownedManual: [{ mteId: 28001, count: 1 }] }).crops)
      .toEqual({ tier: 1, machines: [28001], parallel: 121 });
    expect(setupOf({ tier: 1 }).settings).toEqual(defaultFarmSettings());

    // No crop table (ruling R10: absent or empty): no crop farm, and no plan says so.
    for (const crops of [undefined, []]) {
      const bare = packFromSpec(farmSpec());
      if (crops !== undefined) bare.crops = crops;
      const s = settingsOf(RUBBER_DUST, { tier: 1 });
      expect(farmSetup(bare, s, emptyContext(), planBasis(bare, s, emptyContext())).crops).toBeNull();
      const plan = await planLine(bare, s, emptyContext());
      const without = await planLine(bare, { ...s, farms: farmsWith({ kinds: [] }) }, emptyContext());
      expect(plan.status).toBe('ok');
      expect(plan.warnings).toEqual(without.warnings);
      expect(plan.steps.some((step) => step.farm !== undefined)).toBe(false);
    }
  });
});

describe('the synthetic farm recipes', () => {
  it('wants the goods a line consumes', async () => {
    const pack = farmPack();
    const priced = await pricingOf(pack, settingsOf(RESIN_BOARD, { tier: 2, farms: farmsWith({ kinds: [] }) }));
    expect(priced.pack).toBeUndefined();
    const wanted = wantedGoods(priced.graph);
    for (const key of ['t:carbon_dust@0', 't:pulp@0', RESIN, RUBBER_WOOD, 'fluid:refinedglue']) expect(wanted.has(key)).toBe(true);
    expect(wanted.has(RESIN_BOARD)).toBe(false);
    expect(wanted.has('t:apple@0')).toBe(false);

    // An ore-dictionary slot (a virtual good) stands for its option of canonical rank 0 with the lowest key alone.
    const slot = 'alt:gregtech:a@5*1|minecraft:log@0*1|t:rubber_wood@0*1';
    const graph: CandidateGraph = {
      targets: ['t:t@0'], blocked: new Map(), warnings: [],
      goods: new Map([[slot, { key: slot, buyable: false, cost: 0, leafClass: null, virtual: true }]]),
      recipes: [
        { id: 'r', kind: 'recipe', mapId: 'crafting', coeffs: [[slot, -1], ['t:t@0', 1], ['t:x@0', -2]], euPerRun: 0, nonConsumed: ['t:mold@0'], needsCleanroom: false },
        ...['gregtech:a@5', 'minecraft:log@0', RUBBER_WOOD].map((option) => ({
          id: `convert:${slot}:${option}`, kind: 'convert' as const, mapId: null, coeffs: [[option, -1], [slot, 1]] as Array<[StuffKey, number]>,
          euPerRun: 0, nonConsumed: [], needsCleanroom: false,
        })),
      ],
    };
    expect([...wantedGoods(graph)].sort()).toEqual(['gregtech:a@5', 't:x@0']);
  });

  it('makes one tree farm recipe per sapling the line wants', () => {
    const pack = farmPack();
    const prices = makePrices(pack, {});
    const setup: FarmSetup = { settings: defaultFarmSettings(), tgs: { tier: 1, machines: [15541] }, crops: null };
    const { recipes, tools } = farmRecipes(pack, setup, new Set([RESIN]), prices, NO_SOILS);
    expect(recipes).toHaveLength(1);
    const r = recipes[0]!;
    expect(r.inputs).toEqual([
      { options: [{ key: SAW, amount: 1 }], consumed: true, chance: 1 / 512, slot: 0 },
      { options: [{ key: KNIFE, amount: 1 }], consumed: true, chance: 1 / 512, slot: 1 },
    ]);
    expect(r.outputs).toEqual([{ key: RUBBER_WOOD, amount: 25, chance: 1 }, { key: RESIN, amount: 5, chance: 1 }]);
    expect(r).toMatchObject({ source: 'derived', maps: [TREE_FARM], euPerTick: 30, durationTicks: 100, amps: 1, specialValue: 0, flags: {} });
    expect(r.meta).toEqual({
      farm: { kind: 'tgs', tier: 1, machines: [15541], parallel: 1, footprint: [7, 7, 7], sapling: 't:rubber_sapling@0', tools: [SAW, KNIFE] },
    });
    expect(r.flags.fake).toBeUndefined();
    expect(r.id).toBe(recipeId({ source: r.source, inputs: r.inputs, outputs: r.outputs, euPerTick: 30, durationTicks: 100, specialValue: 0, meta: r.meta }));
    expect(tools).toEqual(new Map([[SAW, 2], [KNIFE, 1]]));
    // A row makes one recipe, however many of its products the line wants; no setup, no recipe.
    expect(farmRecipes(pack, setup, new Set([RESIN, RUBBER_WOOD]), prices, NO_SOILS).recipes.map((x) => x.id)).toEqual([r.id]);
    expect(farmRecipes(pack, { ...setup, tgs: null }, new Set([RESIN]), prices, NO_SOILS)).toEqual({ recipes: [], tools: new Map() });

    const oak = farmRecipes(pack, setup, new Set(['minecraft:log@0']), prices, NO_SOILS).recipes;
    expect(oak.map((x) => x.outputs)).toEqual([[{ key: 'minecraft:log@0', amount: 25, chance: 1 }, { key: 't:apple@0', amount: 5, chance: 1 }]]);
    expect(oak[0]?.meta.farm?.sapling).toBe('t:oak_sapling@0');

    // The FARM_SOURCES_PER_GOOD rows that make most of a good per operation: 10 and 5 logs before the multiplier, not 3.
    expect(FARM_SOURCES_PER_GOOD).toBe(2);
    const spec = farmSpec();
    for (const [id, logs] of [['tgs-ten', 10], ['tgs-three', 3]] as const) {
      spec.recipes?.push({
        id, map: TREE_FARM, dur: 100, flags: { fake: true }, out: [['minecraft:log@0', logs], [`t:${id}_sapling@0`, 5]],
        meta: { specialItem: `t:${id}_sapling@0`, tgsModes: ['log', 'sapling'] },
      });
    }
    const more = packFromSpec(spec);
    const kept = farmRecipes(more, setup, new Set(['minecraft:log@0']), makePrices(more, {}), NO_SOILS).recipes;
    expect(kept.map((x) => x.meta.farm?.sapling).sort()).toEqual(['t:oak_sapling@0', 't:tgs-ten_sapling@0']);
    expect(kept.map((x) => x.id)).toEqual([...kept.map((x) => x.id)].sort());
  });

  it('makes crop recipes for the crops the line wants', async () => {
    const pack = farmPack();
    const prices = makePrices(pack, {});
    const setupOf = (farms: FarmSettings): FarmSetup => {
      const s = settingsOf(RUBBER_DUST, { tier: 1, farms });
      return farmSetup(pack, s, emptyContext(), planBasis(pack, s, emptyContext()));
    };
    const soils = soilsAt(pack, settingsOf(RUBBER_DUST, { tier: 1 }));
    const { recipes, tools } = farmRecipes(pack, setupOf(defaultFarmSettings()), new Set([RESIN]), prices, soils);
    expect(tools.size).toBe(0);
    expect(recipes.map((r) => r.meta.farm?.crop?.name).sort()).toEqual(['Resin Cane', 'Rubber Bonsai']);
    const cane = recipes.find((r) => r.meta.farm?.crop?.id === 'cropsnh:testCane')!;
    expect(cane.inputs).toEqual([{ options: [{ key: 'fluid:water', amount: 20 }], consumed: true, chance: 1, slot: 100 }]);
    expect(cane.outputs).toHaveLength(1);
    expect(cane.outputs[0]).toMatchObject({ key: RESIN, chance: 1 });
    expect(cane.outputs[0]?.amount).toBeCloseTo(0.8985062795625, 12);
    expect(cane.euPerTick).toBeCloseTo(4.5235540375 / 5120, 15);
    expect(cane).toMatchObject({ durationTicks: 5120, maps: [CROP_MANAGER_MAP], source: 'derived', amps: 1, specialValue: 0, flags: {} });
    expect(cane.meta.farm).toEqual({
      kind: 'crop', tier: 1, machines: [28001], parallel: 121, footprint: [11, 2, 11],
      crop: {
        id: 'cropsnh:testCane', name: 'Resin Cane', growthTicks: 20, stats: { growth: 1, gain: 1, resistance: 1 }, soil: DIRT,
        seed: 't:cane_seed@0',
      },
    });
    expect(recipes.map((r) => r.id)).toEqual([...recipes.map((r) => r.id)].sort());
    // Ore Fern needs a sub-soil block: never a recipe
    expect(farmRecipes(pack, setupOf(defaultFarmSettings()), new Set(['t:iron_dust@0']), prices, soils).recipes).toEqual([]);

    const crops = defaultFarmSettings().crops;
    const layered = farmRecipes(pack, setupOf(farmsWith({ crops: { ...crops, layers: 3 } })), new Set([RESIN]), prices, soils).recipes;
    const deep = layered.find((r) => r.meta.farm?.crop?.id === 'cropsnh:testCane')!;
    expect(deep.meta.farm).toMatchObject({ footprint: [11, 6, 11], parallel: 363 });

    const fed = farmRecipes(pack, setupOf(farmsWith({ crops: { ...crops, fertilizer: 'fertilizer' } })), new Set([RESIN]), prices, soils).recipes;
    const fertilized = fed.find((r) => r.meta.farm?.crop?.id === 'cropsnh:testCane')!;
    expect(fertilized.inputs).toEqual([
      { options: [{ key: 'cropsnh:fertilizer@0', amount: 0.32 }], consumed: true, chance: 1, slot: 0 },
      { options: [{ key: 'fluid:water', amount: 16 }], consumed: true, chance: 1, slot: 100 },
    ]);
    expect(fertilized.durationTicks).toBe(4096);
  });

  it('keeps the farm recipes in a pack of their own, one per pack and recipes', async () => {
    const pack = farmPack();
    const priced = await pricingOf(pack, settingsOf(RESIN_BOARD, { tier: 3 }));
    const farms = priced.pack!;
    const recipes = farms.recipes.filter((r) => r.meta.farm !== undefined);
    expect(recipes.length).toBeGreaterThan(0);
    expect(withFarms(pack, [...recipes].reverse())).toBe(farms);
    expect(withFarms(farms, recipes)).toBe(farms);
    expect(exportPack(farms)).toBe(pack);
    expect(exportPack(pack)).toBe(pack);
    // Shared: everything but the recipes, their indices, the maps and the machines; the export pack itself unchanged.
    expect(farms.items).toBe(pack.items);
    expect(farms.manifest).toBe(pack.manifest);
    expect(farms.recipes).toHaveLength(pack.recipes.length + recipes.length);
    for (const r of recipes) {
      expect(farms.recipeById.get(r.id)).toBe(r);
      expect(pack.recipeById.has(r.id)).toBe(false);
      for (const p of r.outputs) expect(farms.producers.get(p.key)).toContain(farms.recipes.indexOf(r));
    }
    expect(pack.producers.get(RESIN)?.some((i) => pack.recipes[i]?.meta.farm !== undefined)).toBe(false);
    expect(farms.maps.get(CROP_MANAGER_MAP)).toEqual({ id: CROP_MANAGER_MAP, name: 'Crop Manager', amps: 1, specialValue: 'none', aliases: [] });
    expect(pack.maps.has(CROP_MANAGER_MAP)).toBe(false);
    expect(farms.machinesByMap.get(CROP_MANAGER_MAP)).toEqual([28001, 28002]);
    expect(farms.machines.get(28001)).toMatchObject({ kind: 'basic', maps: [CROP_MANAGER_MAP], tier: 1, name: 'Basic Crop Manager' });
    expect(machineByMteId(pack, 28001)).toMatchObject({ kind: 'other', maps: [] });
    expect(farms.machines.get(15541)).toBe(machineByMteId(pack, 15541));
  });
});

// The final review of add-on 17: CropsNH lists a crop's soils by key, so its first soil is often an exotic block (on the
// 2.9 export MagicBees' Enchanted Earth for 29 crops, Chisel's dirt for 27). A crop is planted on one the line can get.
describe('the soil a crop is planted on', () => {
  /** A soil source that can get `have`, at `costs` (Infinity for any other key). */
  const source = (have: readonly string[], costs: Readonly<Record<string, number>> = {}): SoilSource => ({
    canGet: (key) => have.includes(key), cost: (key) => costs[key] ?? Infinity,
  });
  const card = (soils: string[]) => ({ soils });

  it('plants on dirt, farmland or grass first, else on the cheapest soil the line can get', () => {
    expect(PLAIN_SOILS).toEqual([DIRT, FARMLAND, 'minecraft:grass@0']);
    // the card's exotic first soil is passed over wherever the line can get dirt: farmland is hoed dirt
    expect(cropSoil(card([ENCHANTED_EARTH, GARDEN_SOIL, FARMLAND]), source([DIRT, GARDEN_SOIL], { [GARDEN_SOIL]: 2 }))).toBe(FARMLAND);
    expect(cropSoil(card(['minecraft:grass@0', FARMLAND, DIRT]), source([DIRT]))).toBe(DIRT);
    expect(cropSoil(card(['minecraft:grass@0', FARMLAND]), source([DIRT]))).toBe(FARMLAND);
    expect(cropSoil(card(['minecraft:grass@0']), source([DIRT]))).toBe('minecraft:grass@0');
    // without dirt there is no farmland either: the cheapest other soil the line can get
    expect(cropSoil(card([ENCHANTED_EARTH, GARDEN_SOIL, FARMLAND]), source([GARDEN_SOIL], { [GARDEN_SOIL]: 2 }))).toBe(GARDEN_SOIL);
    // a priced soil before an unpriced one, the cheaper first, ties by key
    const three = source(['t:a@0', 't:b@0', 't:c@0'], { 't:a@0': 3, 't:b@0': 2, 't:c@0': 2 });
    expect(cropSoil(card(['t:c@0', 't:a@0', 't:b@0']), three)).toBe('t:b@0');
    expect(cropSoil(card(['t:b@0', 't:a@0']), source(['t:a@0', 't:b@0'], { 't:b@0': 5 }))).toBe('t:b@0');
    expect(cropSoil(card(['t:b@0', 't:a@0']), source(['t:a@0', 't:b@0']))).toBe('t:a@0');
    // none the line can get, or none listed: no soil, so the crop is not offered
    expect(cropSoil(card([ENCHANTED_EARTH]), source([DIRT]))).toBeNull();
    expect(cropSoil(card([]), source([DIRT]))).toBeNull();
    // what is placed for a soil: dirt for farmland and grass
    expect([DIRT, FARMLAND, 'minecraft:grass@0', GARDEN_SOIL].map(soilItem)).toEqual([DIRT, DIRT, DIRT, GARDEN_SOIL]);
    // planting a farmland crop: its crop sticks, the dirt hoed into its farmland and its seeds; the build cost leaves the seeds out
    const meta = { kind: 'crop' as const, tier: 1, machines: [28001], parallel: 121, footprint: [11, 2, 11] as [number, number, number],
      crop: { id: FIELD_FLAX.id, name: FIELD_FLAX.name, growthTicks: 20, stats: { growth: 1, gain: 1, resistance: 1 }, soil: FARMLAND, seed: 't:flax_seed@0' } };
    expect(plantingParts(meta)).toEqual([
      { key: CROP_STICKS, part: 'sticks' }, { key: DIRT, part: 'soil', soil: FARMLAND }, { key: 't:flax_seed@0', part: 'seed' }]);
    expect(plantingKeys(meta)).toEqual([CROP_STICKS, DIRT]);
  });

  it('plants a farmland crop on Farmland hoed from dirt, never on the first soil its card lists', async () => {
    const plan = await planLine(farmPack(), settingsOf(LINEN, { tier: 1, objective: 'least-raw', buildHorizonHours: null }), emptyContext());
    expect(plan.status).toBe('ok');
    const crop = farmStep(plan, 'crop');
    expect(crop.farm?.crop?.id).toBe(FIELD_FLAX.id);
    const sticks = crop.farm?.sticks ?? 0;
    expect(sticks).toBeGreaterThan(0);
    expect(crop.farm?.planting).toBe('of Field Flax (growth 1, gain 1, resistance 1) on Farmland, watering on');
    expect(plan.rawInputs.some((r) => r.key === 't:flax@0')).toBe(false);
    // the build list names the dirt the group hoes into farmland, never the card's first soil nor farmland itself
    expect(plan.buildList.filter((l) => l.group === 'one-off').map((l) => [l.key, l.amount, l.why])).toEqual([
      [CROP_STICKS, sticks, 'Field Flax farm'], [DIRT, sticks, 'Field Flax farm (hoe it into Farmland)'], ['t:flax_seed@0', sticks, 'Field Flax farm'],
    ]);
    expect((plan.buildTotals ?? []).some((l) => l.key === ENCHANTED_EARTH || l.key === FARMLAND)).toBe(false);
    expect(plan.buildSteps.find((b) => b.id === `craft:${DIRT}`)?.text).toBe(`Get ${sticks}× Dirt as soil for the Field Flax farm (hoe it into Farmland)`);
    // and its build cost charges that dirt and the crop sticks at the machines' prices, every part priced
    const prices = await itemPrices(exportPack(farmPack()), settingsOf(LINEN, { tier: 1 }), emptyContext(), [CROP_STICKS, DIRT]);
    expect([prices.cost(CROP_STICKS), prices.cost(DIRT)].every((c) => Number.isFinite(c) && c > 0)).toBe(true);
    expect(plan.warnings.map((w) => w.code)).not.toContain('build-cost-unknown');
  });

  it('offers a crop only on a soil the line can get, and names a planting it cannot price', async () => {
    /** The farm pack, Field Flax listing `soils`, plus Fine Soil (crafted from four dirt, so dearer than Garden Soil's two). */
    const withFlax = (soils: string[]): Pack => {
      const spec: PackSpec = farmSpec();
      spec.items?.push({ key: 't:fine_soil@0', name: 'Fine Soil' });
      spec.recipes?.push({ id: 'fine-soil', map: 'crafting', in: [[DIRT, 4]], out: [['t:fine_soil@0', 1]] });
      const pack = packFromSpec(spec);
      pack.crops = structuredClone([RESIN_CANE, RUBBER_BONSAI, ORE_FERN, { ...FIELD_FLAX, soils }]);
      return pack;
    };
    const s = settingsOf(LINEN, { tier: 1, objective: 'least-raw', buildHorizonHours: null });
    const flaxSoil = async (pack: Pack) => (await pricingOf(pack, s)).pack?.recipes.find((r) => r.meta.farm?.crop?.id === FIELD_FLAX.id)?.meta.farm?.crop?.soil;
    /** The soils the line prices to choose its crops' (`soilsToPrice`). */
    const priced = (pack: Pack): string[] => {
      const basis = planBasis(pack, s, emptyContext());
      return soilsToPrice(pack, farmSetup(pack, s, emptyContext(), basis), new Set(['t:flax@0']), (key) => basis.avail.available.has(key));
    };
    // with farmland it can get, nothing to price
    expect(priced(farmPack())).toEqual([]);
    // no plain soil: the one other soil the line can get (Garden Soil, crafted from two dirt), not the exotic first one
    const garden = withFlax([ENCHANTED_EARTH, GARDEN_SOIL]);
    expect(priced(garden)).toEqual([]);
    expect(await flaxSoil(garden)).toBe(GARDEN_SOIL);
    // two it can get: priced as machines are, the cheaper wins, not the first by key
    const two = withFlax([ENCHANTED_EARTH, 't:fine_soil@0', GARDEN_SOIL]);
    expect(priced(two)).toEqual(['t:fine_soil@0', GARDEN_SOIL]);
    expect(await flaxSoil(two)).toBe(GARDEN_SOIL);
    // only a soil nothing makes: no crop farm of it, and the line buys its flax
    const exotic = withFlax([ENCHANTED_EARTH]);
    expect(await flaxSoil(exotic)).toBeUndefined();
    const bought = await planLine(exotic, s, emptyContext());
    expect(bought.status).toBe('ok');
    expect(bought.steps.some((st) => st.farm !== undefined)).toBe(false);
    expect(bought.rawInputs.some((r) => r.key === 't:flax@0')).toBe(true);
    // a soil the line can get but nobody can price (an ore block, which machine prices never buy): planted, and the
    // build cost says it leaves it out
    const ore = withFlax([ENCHANTED_EARTH, 't:iron_ore@0']);
    expect(await flaxSoil(ore)).toBe('t:iron_ore@0');
    const unpriced = await planLine(ore, s, emptyContext());
    expect(farmStep(unpriced, 'crop').farm?.planting).toBe('of Field Flax (growth 1, gain 1, resistance 1) on Iron Ore, watering on');
    expect(unpriced.warnings.filter((w) => w.code === 'build-cost-unknown')).toEqual([
      { code: 'build-cost-unknown', text: 'Not counted in the build cost: Iron Ore for the Field Flax farm (its price could not be worked out)' },
    ]);
  });
});

describe('farms in the line', () => {
  it('walks the products of the farms in every mode', async () => {
    const pack = farmPack();
    const s = settingsOf(RESIN_BOARD, { tier: 3, objective: 'least-raw', buildHorizonHours: null });
    const priced = await pricingOf(pack, s);
    expect(priced.pack).toBeDefined();
    const tgs = priced.graph.recipes.filter((r) => r.farm === true && r.mapId === TREE_FARM);
    expect(tgs).toHaveLength(1);
    expect(priced.graph.goods.get(RUBBER_WOOD)?.farmMade).toBe(true);
    // the crop farms too, beside the export's centrifuge: farm sources are kept whatever their estimate
    expect(priced.graph.recipes.filter((r) => r.farm === true && r.mapId === CROP_MANAGER_MAP)).toHaveLength(2);
    expect(priced.graph.recipes.some((r) => r.id === 'cf-wood')).toBe(true);
    // tool wear: fixed leaves at the tool's price, never walked
    expect(priced.graph.goods.get(SAW)).toMatchObject({ buyable: true, cost: 2, leafClass: 'direct' });
    expect(priced.farm?.tools).toEqual(new Map([[SAW, 2], [KNIFE, 1]]));
    expect(priced.farm?.setup.tgs).toEqual({ tier: 1, machines: [15541] });
    expect(priced.leaf(RUBBER_WOOD)).toMatchObject({ buyable: true, farmMade: true });
    // the cost model stays farm-free
    expect(priced.model.graph.recipes.some((r) => r.farm === true)).toBe(false);

    const cheapest = await pricingOf(pack, { ...s, objective: 'cheapest', buildHorizonHours: 24 });
    expect(cheapest.graph.recipes.filter((r) => r.farm === true).map((r) => r.id)).toEqual(priced.graph.recipes.filter((r) => r.farm === true).map((r) => r.id));
    const batch = await pricingOf(pack, { ...s, mode: 'makeN', amount: 64, ownedManual: [{ mteId: 15541, count: 1 }] });
    expect(batch.graph.recipes.filter((r) => r.farm === true).map((r) => r.mapId)).toEqual([TREE_FARM]);

    const none = await pricingOf(pack, { ...s, farms: farmsWith({ kinds: [] }) });
    expect(none.graph.recipes.some((r) => r.farm === true)).toBe(false);
    expect(none.pack).toBeUndefined();
    expect(none.farm).toBeUndefined();
  });

  it('prices a line once for the modes that walk alike', async () => {
    const pack = farmPack();
    const s = settingsOf(RESIN_BOARD, { tier: 3 });
    const first = linePricing(pack, s, emptyContext());
    // what pricing never reads: the planning mode, the build horizon and other projects' surplus
    for (const other of [{ objective: 'multi-output' as const }, { buildHorizonHours: 8 }, { useSurplus: false }]) {
      expect(linePricing(pack, { ...s, ...other }, emptyContext())).toBe(first);
    }
    // whether build cost counts (gathered blocks), and the farm machines the context owns, which farmSetup reads
    const ignored = linePricing(pack, { ...s, buildHorizonHours: null }, emptyContext());
    const owned = linePricing(pack, s, { ...emptyContext(), ownedMachines: [{ mteId: 15541, count: 1 }] });
    expect(ignored).not.toBe(first);
    expect(owned).not.toBe(first);
    expect(linePricing(pack, s, { ...emptyContext(), ownedMachines: [{ mteId: 161, count: 1 }] })).toBe(first);
    expect(linePricing(withFarms(pack, []), s, emptyContext())).toBe(first);
    const [plain, scanned] = await Promise.all([first, owned, ignored]);
    expect(plain?.farm?.setup.tgs).toEqual({ tier: 1, machines: [15541] });
    expect(scanned?.farm?.setup.tgs).toEqual({ tier: 1, machines: [15541] });
  });

  it('runs a farm at its own tier without overclocking', async () => {
    const priced = await pricingOf(farmPack(), settingsOf(RESIN_BOARD, { tier: 3 }));
    const farms = priced.pack!;
    const tgs = farms.recipes.find((r) => r.meta.farm?.kind === 'tgs')!;
    const opts = { groupTier: 5, coilHeat: 1801, automateCrafting: true, owned: new Map<MachineId, number>() };
    const pick = pickMachine(farms, tgs, TREE_FARM, opts);
    expect(pick).toMatchObject({ id: 'gt:15541', tier: 1, kind: 'multiblock', runsPerSecondPerMachine: 0.2, handCraft: false });
    expect(pick.oc).toEqual({ euPerTick: 30, durationTicks: 100, overclocks: 0, heatOverclocks: 0, machineVoltage: 32, machineAmps: 1, parallel: 1 });
    const cane = farms.recipes.find((r) => r.meta.farm?.crop?.id === 'cropsnh:testCane')!;
    const crop = pickMachine(farms, cane, CROP_MANAGER_MAP, opts);
    expect(crop).toMatchObject({ id: 'gt:28001', tier: 1, kind: 'basic', runsPerSecondPerMachine: 0.47265625 });
    expect(crop.oc.euPerTick).toBeCloseTo((4.5235540375 / 5120) * 121, 12);
    expect(crop.oc).toMatchObject({ durationTicks: 5120, overclocks: 0, parallel: 121, machineVoltage: 32, machineAmps: 1 });

    const options = machineOptions(farms, tgs, TREE_FARM, { groupTier: 5, coilHeat: 1801, owned: new Map(), prices: FLAT });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: 'gt:15541', tier: 1, perMachine: 0.2, kind: 'multiblock', canAdd: true });
    expect(options[0]?.oc.overclocks).toBe(0);
    expect(machineOptions(farms, cane, CROP_MANAGER_MAP, { groupTier: 5, coilHeat: 1801, owned: new Map(), prices: FLAT }))
      .toMatchObject([{ id: 'gt:28001', tier: 1, kind: 'basic', perMachine: 0.47265625 }]);
    // Where nothing builds the farm's machine, its owned ones alone serve (rule 5).
    const gap: ItemPrices = { cost: () => Infinity, gap: () => ({ kind: 'no-recipe' }) };
    expect(machineOptions(farms, tgs, TREE_FARM, { groupTier: 5, coilHeat: 1801, owned: new Map(), prices: gap })).toEqual([]);
    expect(machineOptions(farms, tgs, TREE_FARM, { groupTier: 5, coilHeat: 1801, owned: new Map([['gt:15541', 1]]), prices: gap }))
      .toMatchObject([{ id: 'gt:15541', owned: 1, canAdd: false }]);
  });

  it('plans resin from an owned tree farm', async () => {
    const s = settingsOf(RESIN_BOARD, {
      tier: 2, ownedManual: [{ mteId: 15541, count: 1 }], objective: 'cheapest', farms: farmsWith({ kinds: ['tgs'] }),
    });
    const plan = await planLine(farmPack(), s, emptyContext());
    expect(plan.status).toBe('ok');
    const tgs = farmStep(plan, 'tgs');
    expect(tgs.machine.mteId).toBe(15541);
    expect(tgs.count).toBe(1);
    expect(tgs.owned).toBe(1);
    expect(tgs.farm).toEqual({
      kind: 'tgs', tier: 1, footprint: [7, 7, 7], sapling: 't:rubber_sapling@0', tools: [SAW, KNIFE],
      text: 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw and Knife (Steel) in an input bus',
    });
    const raw = new Map(plan.rawInputs.map((r) => [r.key, r]));
    expect(raw.get(SAW)?.upkeep).toBe(true);
    expect(raw.get(KNIFE)?.upkeep).toBe(true);
    expect(raw.has(RUBBER_WOOD)).toBe(false);
    expect(raw.has(RESIN)).toBe(false);
    expect(plan.buildList.some((l) => l.key === 'machine:15541@0' || l.key === 't:rubber_sapling@0')).toBe(false);
    expect(plan.warnings.filter((w) => INTEGRITY.includes(w.code))).toEqual([]);
    expect(plan.names?.['t:rubber_sapling@0']).toBe('Rubber Sapling');
    expect(plan.names?.[`map:${TREE_FARM}`]).toBe('Tree Growth Simulator');
  });

  it('plans resin from crop sticks under a new Crop Manager', async () => {
    const s = settingsOf(RUBBER_DUST, { tier: 1, objective: 'least-raw', buildHorizonHours: null });
    const plan = await planLine(farmPack(), s, emptyContext());
    expect(plan.status).toBe('ok');
    const crop = farmStep(plan, 'crop');
    expect(crop.machine.mteId).toBe(28001);
    expect(crop.mapId).toBe(CROP_MANAGER_MAP);
    expect(crop.count).toBe(1);
    expect(crop.owned).toBe(0);
    // 1/3 resin a minute ÷ 0.8985 a harvest × 256 s a harvest = 1.58 sticks
    expect(crop.farm).toEqual({
      kind: 'crop', tier: 1, footprint: [11, 2, 11], sticks: 2,
      crop: { id: 'cropsnh:testCane', name: 'Resin Cane', stats: { growth: 1, gain: 1, resistance: 1 } },
      text: '1× Basic Crop Manager: 2 crop sticks of Resin Cane (growth 1, gain 1, resistance 1) on Dirt, watering on',
      // its words after the stick count, from which the layout words the area of each new Crop Manager
      planting: 'of Resin Cane (growth 1, gain 1, resistance 1) on Dirt, watering on',
    });
    expect(plan.rawInputs.some((r) => r.key === RESIN)).toBe(false);
    expect(plan.buildList.filter((l) => l.group === 'one-off').map((l) => [l.key, l.amount, l.why])).toEqual([
      [CROP_STICKS, 2, 'Resin Cane farm'], [DIRT, 2, 'Resin Cane farm'], ['t:cane_seed@0', 2, 'Resin Cane farm'],
    ]);
    // the final review (T4-a): the sticks and soil are planted round the Crop Manager and the seeds come from the seed
    // bank, so none of them "stays in the machine"
    const craft = (key: string) => plan.buildSteps.find((b) => b.id === `craft:${key}`);
    expect([CROP_STICKS, DIRT, 't:cane_seed@0'].map((key) => [craft(key)?.kind, craft(key)?.text])).toEqual([
      ['craft', 'Make 2× Crop Sticks to plant in the Resin Cane farm'],
      ['craft', 'Get 2× Dirt as soil for the Resin Cane farm'],
      ['craft', 'Take 2× Resin Cane Seeds from your seed bank for the Resin Cane farm'],
    ]);
    expect(plan.buildSteps.some((b) => b.text.includes('stays in the machine'))).toBe(false);
    expect(plan.buildList.find((l) => l.key === 'machine:28001@0')).toMatchObject({ amount: 1, group: 'machines' });
    expect(plan.names?.[`map:${CROP_MANAGER_MAP}`]).toBe('Crop Manager');
    expect(plan.warnings.filter((w) => INTEGRITY.includes(w.code))).toEqual([]);
  });

  it('counts crop sticks as it counts machines: an exactly full Crop Manager keeps its 121 sticks', () => {
    // 121 sticks under one Crop Manager at 1792 ticks a run run 2420/1792 times a second, a rate the plan keeps to 9 significant digits
    // (sig9: 1.35044643), which reads 121.00000013 sticks. A machine count takes that slack of 9 digits as the whole number it is
    // (wholeMachines, plan 12 Task 8), and so do the crop sticks: 121, not 122 for a Crop Manager that tends 121
    const cycle = { durationTicks: 1792 } as Recipe;
    expect(sticksOf(sig9(2420 / 1792), cycle)).toBe(121);
    // a load really above a whole number still takes one more stick, and no runs take none
    expect(sticksOf(sig9(2421 / 1792), cycle)).toBe(122);
    expect(sticksOf(0, cycle)).toBe(0);
  });

  it("keeps a new tree farm's sapling in its controller", async () => {
    // HV, cheapest, nothing owned: the line builds a Tree Growth Simulator, whose sapling does stay in the machine
    const plan = await planLine(farmPack(), settingsOf(RESIN_BOARD, { tier: 3, objective: 'cheapest', farms: farmsWith({ kinds: ['tgs'] }) }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(farmStep(plan, 'tgs')).toMatchObject({ count: 1, owned: 0 });
    expect(plan.buildList.filter((l) => l.group === 'one-off').map((l) => [l.key, l.amount, l.why])).toEqual([['t:rubber_sapling@0', 1, 'Rubber Sapling farm']]);
    expect(plan.buildSteps.find((b) => b.id === 'craft:t:rubber_sapling@0')?.text).toBe('Make 1× Rubber Sapling (stays in the machine)');
  });

  it("words a new farm with the project's own farm settings, not the defaults", async () => {
    // a farm step on machines the line builds (none owned: no world, no machines we have) is described with the project's farm
    // settings, not the defaults: Bronze tools, not the default Steel, on a new Tree Growth Simulator. machines.ts's other call of
    // describeStep, the one the merge of add-on 17 into main resolved, serves only hand-crafted and pseudo-machine steps, never a farm
    const farms = farmsWith({ kinds: ['tgs'], tgs: { ...defaultFarmSettings().tgs, toolMaterial: 'Bronze' } });
    expect(defaultFarmSettings().tgs.toolMaterial).toBe('Steel');
    const plan = await planLine(farmPack(), settingsOf(RESIN_BOARD, { tier: 3, objective: 'cheapest', farms }), emptyContext());
    expect(plan.status).toBe('ok');
    const tgs = farmStep(plan, 'tgs');
    expect([tgs.count, tgs.owned]).toEqual([1, 0]);
    expect(tgs.farm?.text).toContain('(Bronze) in an input bus');
    expect(tgs.farm?.text).not.toContain('(Steel)');
  });

  it('weighs what a crop farm plants in the build MIP, in rate mode only', async () => {
    // p-a and p-b make t from free goods on machines of 10 and 20 raw (solvedWithBuild: 24 h, no step charge) ...
    const options = { 'p-a': [opt(201, 1, 1, 10)], 'p-b': [opt(202, 1, 1, 20)] };
    const free = { 't:a@0': 0, 't:b@0': 0 };
    const demand: Array<[StuffKey, number]> = [['t:t@0', 1 / 60]];
    expect((await solvedWithBuild(twoFreeSpec(), free, demand, { options })).runs).toEqual(['p-a']);
    // ... until p-a is a crop farm whose sticks cost 10,000 raw a run a second: 167 raw at 1/60 runs a second
    const planting = { 'p-a': 1e4 };
    expect((await solvedWithBuild(twoFreeSpec(), free, demand, { options, planting })).runs).toEqual(['p-b']);
    // Make N weighs no planting
    const batch = await solvedWithBuild(twoFreeSpec(), free, [['t:t@0', 64]], { options, planting, mode: 'makeN', horizonSeconds: null });
    expect(batch.runs).toEqual(['p-a']);
  });

  it("counts a farm's plantings in its build cost", async () => {
    const pack = farmPack();
    const at = (amount: number): Promise<Plan> => planLine(pack, settingsOf(RUBBER_DUST, { tier: 1, amount }), emptyContext());
    const plan1 = await at(1);
    const plan10 = await at(10);
    expect(farmStep(plan1, 'crop').farm?.sticks).toBe(2);
    expect(farmStep(plan10, 'crop').farm?.sticks).toBe(16);
    // one resin centrifuge and one Crop Manager at both rates
    const added = (plan: Plan): Array<[number, number]> => plan.steps.filter((st) => st.count > st.owned)
      .map((st): [number, number] => [st.machine.mteId, st.count - st.owned]).sort((a, b) => a[0] - b[0]);
    expect(added(plan1)).toEqual([[161, 1], [28001, 1]]);
    expect(added(plan10)).toEqual(added(plan1));
    const prices = await itemPrices(pack, settingsOf(RUBBER_DUST, { tier: 1 }), emptyContext(), [CROP_STICKS, DIRT]);
    const planting = prices.cost(CROP_STICKS) + prices.cost(DIRT);
    expect(planting).toBeGreaterThan(0);
    expect(Math.abs(plan10.cost!.build - plan1.cost!.build - 14 * planting)).toBeLessThanOrEqual(1e-9);
  });

  it('never adds a farm to a Make N batch', async () => {
    const s = settingsOf(RESIN_BOARD, { tier: 3, mode: 'makeN', amount: 64 });
    const plan = await planLine(farmPack(), s, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.some((st) => st.farm !== undefined)).toBe(false);
    const owned = await planLine(farmPack(), { ...s, ownedManual: [{ mteId: 15541, count: 1 }] }, emptyContext());
    expect(owned.status).toBe('ok');
    const tgs = farmStep(owned, 'tgs');
    expect(tgs.owned).toBe(1);
    expect(tgs.count).toBe(1);
    expect(owned.buildList.some((l) => l.key === 'machine:15541@0' || l.key === 't:rubber_sapling@0')).toBe(false);
  });
});
