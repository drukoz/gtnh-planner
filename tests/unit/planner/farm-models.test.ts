// Add-on 17 Task 2: the pure farm models (docs/research/farms.md §1.3–§1.5, §2.2–§2.4, §5.8) on the synthetic farm pack:
// one Tree Growth Simulator operation with the tools in its bus, their wear and price; a crop's growth on the nutrients a
// managed stick gets, what one harvest of one stick gives, and the Crop Manager's water, fertilizer, EU and reach.

import { describe, it, expect } from 'vitest';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { defaultFarmSettings, TGS_MODE_ORDER, type TgsMode } from '../../../src/shared/types/farm.ts';
import type { Product, Recipe } from '../../../src/shared/types/pack.ts';
import { makePrices } from '../../../src/server/planner/costs.ts';
import {
  TGS_MTE_ID, TGS_OP_TICKS, TGS_TOOLS, tgsOp, tgsOutputMultiplier, toolPrice, toolUses,
} from '../../../src/server/planner/farms/tgs.ts';
import {
  CROP_GROWTH_TICKS, CROP_MANAGER_MTE_IDS, cropHarvest, cropNutrients, growthRate, managerSide, nutrientsPerCycle,
  sticksPerManager,
} from '../../../src/server/planner/farms/crops.ts';
import { farmPack, ORE_FERN, RESIN_CANE, RUBBER_BONSAI } from '../../helpers/farm-fixtures.ts';

const SAW = 'gregtech:gt.metatool.01@10';
const BRANCH_CUTTER = 'gregtech:gt.metatool.01@30';
const WIRE_CUTTER = 'gregtech:gt.metatool.01@26';
const KNIFE = 'gregtech:gt.metatool.01@34';

/** A Tree Growth Simulator's input bus holding the tools of `modes`, and no other. */
function bus(...modes: TgsMode[]): Record<TgsMode, boolean> {
  return { log: modes.includes('log'), sapling: modes.includes('sapling'), leaves: modes.includes('leaves'), fruit: modes.includes('fruit') };
}

/** `drops` hold exactly `expected`'s keys in that order, each at chance 1 with its amount to 12 decimal places. */
function expectDrops(drops: readonly Product[], expected: ReadonlyArray<readonly [StuffKey, number]>): void {
  expect(drops.map((d) => [d.key, d.chance])).toEqual(expected.map(([key]) => [key, 1]));
  drops.forEach((d, i) => expect(d.amount).toBeCloseTo(expected[i]![1], 12));
}

describe('the Tree Growth Simulator', () => {
  it("multiplies a tree farm's output by its tier", () => {
    expect([1, 2, 3, 4, 5, 8].map(tgsOutputMultiplier)).toEqual([5, 9, 17, 29, 45, 117]);
    expect([TGS_MTE_ID, TGS_OP_TICKS]).toEqual([15541, 100]);
  });

  it('runs one tree farm operation with the tools in its bus', () => {
    const pack = farmPack();
    const rubber = pack.recipeById.get('tgs-rubber')!;
    // farms.md §5.8: an LV saw and knife make 25 Rubber Wood and 5 Sticky Resin per 100 ticks for 30 EU/t
    expect(tgsOp(rubber, 1, bus('log', 'fruit'), 'Steel')).toEqual({
      outputs: [{ key: 't:rubber_wood@0', amount: 25, chance: 1 }, { key: 't:resin@0', amount: 5, chance: 1 }],
      wear: [{ key: SAW, perOp: 1 / 512 }, { key: KNIFE, perOp: 1 / 512 }],
      euPerTick: 30, ticks: 100,
    });
    // MV: 9 times the row, at 120 EU/t; the wear stays one use per tool and operation
    expect(tgsOp(rubber, 2, bus('log', 'fruit'), 'Steel')).toEqual({
      outputs: [{ key: 't:rubber_wood@0', amount: 45, chance: 1 }, { key: 't:resin@0', amount: 9, chance: 1 }],
      wear: [{ key: SAW, perOp: 1 / 512 }, { key: KNIFE, perOp: 1 / 512 }],
      euPerTick: 120, ticks: 100,
    });
    // All four tools: the wire cutter doubles the leaves, the branch cutter lasts a quarter as long
    const all = tgsOp(rubber, 1, bus('log', 'sapling', 'leaves', 'fruit'), 'Steel');
    expect(all?.outputs).toEqual([
      { key: 't:rubber_wood@0', amount: 25, chance: 1 }, { key: 't:rubber_sapling@0', amount: 25, chance: 1 },
      { key: 't:rubber_leaves@0', amount: 20, chance: 1 }, { key: 't:resin@0', amount: 5, chance: 1 },
    ]);
    expect(all?.wear).toEqual([
      { key: SAW, perOp: 1 / 512 }, { key: BRANCH_CUTTER, perOp: 1 / 128 }, { key: WIRE_CUTTER, perOp: 1 / 512 },
      { key: KNIFE, perOp: 1 / 512 },
    ]);
    expect(TGS_MODE_ORDER.map((mode) => toolUses(mode, 'Steel'))).toEqual([512, 128, 512, 512]);
    expect(tgsOp(rubber, 1, bus('log', 'fruit'), 'Bronze')?.wear[0]).toEqual({ key: SAW, perOp: 1 / 192 });
    expect(() => toolUses('log', 'Unobtainium')).toThrow(RangeError);
    // A knife on a tree without fruit makes nothing, and neither does an empty bus or a row without modes
    const oak = pack.recipeById.get('tgs-oak')!;
    const noFruit: Recipe = { ...oak, outputs: oak.outputs.slice(0, 3), meta: { ...oak.meta, tgsModes: ['log', 'sapling', 'leaves'] } };
    expect(tgsOp(noFruit, 1, bus('fruit'), 'Steel')).toBeNull();
    expect(tgsOp(rubber, 1, bus(), 'Steel')).toBeNull();
    expect(tgsOp({ ...rubber, meta: { specialItem: rubber.meta.specialItem } }, 1, bus('log', 'fruit'), 'Steel')).toBeNull();
  });

  it('prices a tool from its material', () => {
    expect(TGS_MODE_ORDER.map((mode) => TGS_TOOLS[mode].name)).toEqual(['Saw', 'Branch Cutter', 'Wire Cutter', 'Knife']);
    const prices = makePrices(farmPack(), {});
    expect(TGS_MODE_ORDER.map((mode) => toolPrice(mode, 'Steel', prices))).toEqual([2, 4, 3, 1]);
    expect(toolPrice('log', 'Steel', makePrices(farmPack(), { Steel: 3 }))).toBe(6);
  });
});

describe('crop sticks under a Crop Manager', () => {
  const crops = defaultFarmSettings().crops;
  const fresh = { growth: 1, gain: 1, resistance: 1 };

  it('grows a crop at the rate its nutrients allow', () => {
    const rates: Array<[number, number, number, number]> = [
      [17, 4, 1, 10], [17, 4, 16, 31], [17, 4, 31, 53], [27, 4, 1, 13], [55, 4, 31, 123], [17, 1, 1, 12], [17, 6, 1, 8],
      [10, 6, 1, 4], [5, 6, 1, 0],
    ];
    expect(rates.map(([n, tier, growth]) => growthRate(n, tier, growth))).toEqual(rates.map(([, , , rate]) => rate));
    // farms.md §2.2's table: Sticky Cane (tier 4), Rubber Bonsai (tier 1) and Ferrofern (tier 6) at growth 1, 16 and 31
    const table: Array<[number, number, number[]]> = [
      [4, 17, [10, 31, 53]], [4, 27, [13, 42, 72]], [4, 55, [23, 73, 123]],
      [1, 17, [12, 38, 64]], [1, 27, [15, 49, 83]], [1, 55, [25, 80, 135]],
      [6, 17, [8, 27, 46]], [6, 27, [12, 38, 64]], [6, 55, [22, 69, 116]],
    ];
    for (const [tier, n, expected] of table) expect([1, 16, 31].map((growth) => growthRate(n, tier, growth))).toEqual(expected);
    expect(nutrientsPerCycle(0, 0.5, true, 200, 0)).toBe(17);
    expect(nutrientsPerCycle(0, 0.5, true, 200, 200)).toBe(27);
    expect(nutrientsPerCycle(2, 0.5, true, 200, 200)).toBe(55);
    expect(nutrientsPerCycle(0, 0.8, false, 0, 0)).toBe(19);
    // The humidity bonus is truncated (9.33 → 9), and the biome's humidity is a float: 0.65 reads 0.6499999762, so 6.99… → 6
    expect(nutrientsPerCycle(0, 0.7, false, 0, 0)).toBe(14);
    expect(nutrientsPerCycle(0, 0.65, false, 0, 0)).toBe(11);
  });

  it('harvests a crop under a Crop Manager', () => {
    const cane = cropHarvest(RESIN_CANE, fresh, 1, crops)!;
    // rounds 0.880888509375: the 4 EU harvest is charged on 88 % of harvests, plus one 1 EU watering
    expect(cane).toMatchObject({ growthTicks: 20, cycleTicks: 5120, waterPerRun: 20, fertilizer: null });
    expect(cane.euPerRun).toBeCloseTo(4.5235540375, 12);
    expectDrops(cane.drops, [['t:resin@0', 0.8985062795625]]);

    const fertilized = cropHarvest(RESIN_CANE, fresh, 1, { ...crops, fertilizer: 'fertilizer' })!;
    expect(fertilized).toMatchObject({ growthTicks: 16, cycleTicks: 4096, waterPerRun: 16 });
    expect(fertilized.euPerRun).toBeCloseTo(4.6435540375, 12);
    expect(fertilized.fertilizer?.key).toBe('cropsnh:fertilizer@0');
    expect(fertilized.fertilizer?.perRun).toBeCloseTo(0.32, 12);   // 16 / 50
    expectDrops(fertilized.drops, [['t:resin@0', 0.8985062795625]]);

    const boneMeal = cropHarvest(RESIN_CANE, fresh, 1, { ...crops, fertilizer: 'bone-meal' })!;
    expect(boneMeal.fertilizer?.key).toBe('minecraft:dye@15');
    expect(boneMeal.fertilizer?.perRun).toBeCloseTo(8, 12);   // 16 / 2: one bone meal adds 2 points
    expect(boneMeal.euPerRun).toBeCloseTo(3.5235540375 + 0.8 + 8, 12);

    const mv = cropHarvest(RESIN_CANE, fresh, 2, crops)!;
    expectDrops(mv.drops, [['t:resin@0', 0.941292292875]]);
    expect(mv.euPerRun).toBeCloseTo(18.7653693, 12);   // 16 × 0.92283558125 + 4

    // rounds 1.027425: every harvest is charged
    const bonsai = cropHarvest(RUBBER_BONSAI, fresh, 1, crops)!;
    expect(bonsai).toMatchObject({ growthTicks: 100, cycleTicks: 25600 });
    expectDrops(bonsai.drops, [['t:rubber_sapling@0', 0.31439205], ['t:rubber_wood@0', 6.1768791], ['t:resin@0', 0.103769925]]);
    expect(bonsai.euPerRun).toBeCloseTo(9, 12);

    const best = cropHarvest(RESIN_CANE, { growth: 31, gain: 31, resistance: 31 }, 1, { ...crops, fertilizer: 'fertilizer' })!;
    expect(best).toMatchObject({ growthTicks: 3, cycleTicks: 768 });
    expectDrops(best.drops, [['t:resin@0', 2.8223548585427447]]);

    expect(cropHarvest(ORE_FERN, fresh, 1, crops)).toBeNull();   // a sub-soil requirement
    expect(cropHarvest({ ...RESIN_CANE, tier: 12 }, fresh, 1, crops)).toBeNull();   // rate 0

    // Two layers: only the top one sees the sky, so every stick is planned without it
    expect(cropNutrients({ ...crops, layers: 2 })).toBe(15);
    expect(cropHarvest(RESIN_CANE, fresh, 1, { ...crops, layers: 2 })?.growthTicks).toBe(23);
    expect(CROP_GROWTH_TICKS).toBe(256);

    // A Crop Manager counts one success per drop round, so a chance above 1 (Water Lily's 8) acts as 1
    const lily = cropHarvest({ ...RESIN_CANE, drops: [{ key: 't:resin@0', chance: 8, stackSize: 1 }] }, fresh, 1, crops);
    expect(lily).toEqual(cane);
  });

  it('says how far a Crop Manager reaches', () => {
    expect([1, 2, 3, 4, 5].map(managerSide)).toEqual([11, 15, 19, 23, 27]);
    expect([sticksPerManager(1, 1), sticksPerManager(2, 2), sticksPerManager(1, 3)]).toEqual([121, 450, 363]);
    expect(CROP_MANAGER_MTE_IDS).toEqual([28001, 28002, 28003, 28004, 28005, 28006, 28007, 28008, 28009, 28010, 28011, 28012]);
    // farms.md §5.8's "121 sticks in one 11 × 11 layer" of Resin Cane at LV: 25.48 resin a minute, 9.45 L of water a
    // second and 0.107 EU/t
    const cane = cropHarvest(RESIN_CANE, fresh, 1, crops)!;
    const harvestsPerSecond = (sticksPerManager(1, 1) * 20) / cane.cycleTicks;
    expect(harvestsPerSecond * 60 * cane.drops[0]!.amount).toBeCloseTo(25.48, 2);
    expect(harvestsPerSecond * cane.waterPerRun).toBeCloseTo(9.45, 2);
    expect((sticksPerManager(1, 1) * cane.euPerRun) / cane.cycleTicks).toBeCloseTo(0.107, 3);
  });
});
