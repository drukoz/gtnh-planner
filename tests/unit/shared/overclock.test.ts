import { describe, it, expect } from 'vitest';
import { V } from '../../../src/shared/gt/tiers.ts';
import { VP, powInt, log4, log4ceil, voltageTier, calculateOverclock, multiplierUnderOneTick,
  singleblockOverclock, multiblockOverclock, ebfHeat, defaultCoilHeat, type OcInput } from '../../../src/shared/gt/overclock.ts';

const v = (i: number) => V[i] as number;
const vp = (i: number) => VP[i] as number;
// [GT test name, input, expected duration (or null = not asserted), expected EU/t]
const GT: Array<[string, OcInput, number | null, number]> = [
  ['fullPerfectOverclockEBF', { recipeEUt: vp(1), machineVoltage: v(5), duration: 1024, heatOC: true, heatDiscount: true, recipeHeat: 1800, machineHeat: 9000 }, 4, Math.ceil(vp(5) * powInt(0.95, 8))],
  ['imperfectOverclockEBFWithOneHeatDiscount', { recipeEUt: vp(1), machineVoltage: v(5), duration: 1024, heatOC: true, heatDiscount: true, recipeHeat: 1800, machineHeat: 2700 }, 64, Math.ceil(vp(5) * powInt(0.95, 1))],
  ['imperfectOverclockEBFWithoutHeatDiscounts', { recipeEUt: vp(1), machineVoltage: v(5), duration: 1024, heatOC: true, heatDiscount: true, recipeHeat: 1800, machineHeat: 1800 }, 64, vp(5)],
  ['perfectAndImperfectOverclockEBFWithTwoHeatDiscounts', { recipeEUt: vp(1), machineVoltage: v(5), duration: 1024, heatOC: true, heatDiscount: true, recipeHeat: 1800, machineHeat: 3600 }, 32, Math.ceil(vp(5) * powInt(0.95, 2))],
  ['generalImperfectOverclock', { recipeEUt: vp(1), machineVoltage: v(6), duration: 1024 }, 32, vp(6)],
  ['generalPerfectOverclock', { recipeEUt: vp(1), machineVoltage: v(6), duration: 2048, perfectOC: true }, 2, vp(6)],
  ['weirdHeatEBF', { recipeEUt: vp(1), machineVoltage: v(6), duration: 2048, heatOC: true, heatDiscount: true, recipeHeat: 486, machineHeat: 3900 }, 32, Math.ceil(vp(6) * powInt(0.95, 3))],
  ['doubleEnergyHatchOC', { recipeEUt: vp(1), machineVoltage: v(6), amperage: 4, duration: 1024, amperageOC: true }, 16, vp(7)],
  ['doubleEnergyHatchOCForULV', { recipeEUt: vp(0), machineVoltage: v(6), amperage: 4, duration: 1024, amperageOC: true }, 16, vp(0) * powInt(4, 6)],
  ['multiAmpHatchOC', { recipeEUt: vp(1), machineVoltage: v(6), amperage: 256, duration: 1024, amperageOC: true }, 2, vp(10)],
  ['weirdAmpHatchOC', { recipeEUt: vp(1), machineVoltage: v(6), amperage: 320, duration: 1024, amperageOC: true }, 2, vp(10)],
  ['parallelImperfectOC', { recipeEUt: vp(1), machineVoltage: v(8), amperage: 4, duration: 1024, parallel: 16, amperageOC: true }, 16, vp(9)],
  ['parallelPerfectOC', { recipeEUt: vp(1), machineVoltage: v(8), amperage: 4, duration: 4096, parallel: 16, amperageOC: true, perfectOC: true }, 1, vp(9)],
  ['parallelMultiAmpOC', { recipeEUt: vp(1), machineVoltage: v(6), amperage: 320, duration: 1024, parallel: 16, amperageOC: true }, 8, vp(10)],
  ['weirdParallelOC', { recipeEUt: vp(1), machineVoltage: v(8), duration: 1024, parallel: 8 }, 32, vp(6) * 8],
  ['weirdParallelAndAmpsOC', { recipeEUt: vp(1), machineVoltage: v(8), amperage: 320, duration: 1024, parallel: 8, amperageOC: true }, 2, vp(6) * 8 * 256],
  ['weirdTimeOC', { recipeEUt: vp(1), machineVoltage: v(6), duration: 77 }, 2, vp(6)],
  ['correctWhenOneTicking', { recipeEUt: vp(1), machineVoltage: v(6), duration: 1 }, 1, vp(1) * powInt(4, 5)],
  ['imperfectOCWithEUtDiscount', { recipeEUt: vp(1), machineVoltage: v(6), eutDiscount: 0.9, duration: 1024 }, 32, 27648],
  ['perfectOCWithEUtDiscount', { recipeEUt: vp(1), machineVoltage: v(6), eutDiscount: 0.9, duration: 1024, perfectOC: true }, 1, 27648],
  ['imperfectOCWithSpeedBoost', { recipeEUt: vp(1), machineVoltage: v(6), durationModifier: 0.9, duration: 1024 }, 28, vp(6)],
  ['perfectOCWithSpeedBoost', { recipeEUt: vp(1), machineVoltage: v(6), durationModifier: 0.9, duration: 2048, perfectOC: true }, 1, vp(6)],
  ['perfectOC3TicksTo1Tick', { recipeEUt: vp(1), machineVoltage: v(5), duration: 3, perfectOC: true }, 1, vp(5)],
  ['ulvRecipeWithDiscount', { recipeEUt: vp(0), machineVoltage: v(6), eutDiscount: 0.9, duration: 1024 }, 32, 6452],
  ['ulvRecipeWithDiscountWithParallel', { recipeEUt: vp(0), machineVoltage: v(5), eutDiscount: 0.9, parallel: 14, duration: 1024 }, 128, 5645],
  ['ulvRecipeDoesntOverclockExtraWithAmperageWithoutAmperageOCVersion5', { recipeEUt: 8, machineVoltage: v(3), parallel: 16, duration: 20 }, null, 8 * 16 * powInt(4, 1)],
  ['testCorrectEUtWhenOverclockingUnderOneTick', { recipeEUt: 24, parallel: 56, amperage: 1, amperageOC: true, durationModifier: 1 / 6, machineVoltage: v(14) * 1_048_576, duration: 56, currentParallel: 6144 }, null, 24 * 56 * powInt(4, 20)],
  ['stopsCorrectlyWhenOverclockingUnderOneTick', { recipeEUt: vp(2), machineVoltage: v(9), parallel: 4, duration: 10, amperageOC: false, amperage: 16, currentParallel: 16 }, null, vp(2) * 4 * powInt(4, 7)],
  ['overclockWithAbnormalEnergyIncrease', { recipeEUt: vp(1), machineVoltage: v(6), duration: 1024, eutIncreasePerOC: 4.1 }, 32, Math.ceil(vp(1) * powInt(4.1, 5))],
  ['overclockWithAbnormalDurationDecrease', { recipeEUt: vp(1), machineVoltage: v(6), duration: 1024, durationDecreasePerOC: 2.1 }, Math.floor(1024 / powInt(2.1, 5)), vp(6)],
  ['slightlyOverOneAmpRecipeWorksWithSingleEnergyHatch', { recipeEUt: 614400, machineVoltage: v(8), amperage: 2, amperageOC: false, duration: 600 }, 600, 614400],
];

describe('calculateOverclock matches GT unit tests (5.09.54.183)', () => {
  it.each(GT)('%s', (_name, input, duration, eut) => {
    const r = calculateOverclock(input);
    if (duration !== null) expect(r.durationTicks).toBe(duration);
    expect(r.euPerTick).toBe(eut);
  });
});

describe('helpers', () => {
  it('log4 / log4ceil / voltageTier / VP', () => {
    expect([log4(1), log4(4), log4(15), log4(16), log4(4 ** 20)]).toEqual([0, 1, 1, 2, 20]);
    expect([log4ceil(1), log4ceil(2), log4ceil(16), log4ceil(17)]).toEqual([0, 1, 2, 3]);
    expect([voltageTier(8), voltageTier(30), voltageTier(33), voltageTier(256), voltageTier(129)]).toEqual([0, 1, 2, 3, 3]);
    expect(VP[14]).toBe(2013265912);
  });
});

describe('worked examples (gt-mechanics §2.2, §2.3, §6.4, §6.5)', () => {
  it('30 EU/t × 200 t singleblock across tiers', () => {
    const r = [1, 2, 3, 4, 5].map((t) => singleblockOverclock({ euPerTick: 30, durationTicks: 200 }, { tier: t, amps: 1 }));
    expect(r.map((x) => [x.euPerTick, x.durationTicks])).toEqual([[30, 200], [120, 100], [480, 50], [1920, 25], [7680, 12]]);
  });
  it('ULV recipe gets no OC in LV', () => {
    const r = [1, 2, 3].map((t) => singleblockOverclock({ euPerTick: 8, durationTicks: 200 }, { tier: t, amps: 1 }));
    expect(r.map((x) => [x.euPerTick, x.durationTicks])).toEqual([[8, 200], [32, 100], [128, 50]]);
  });
  it('thermal centrifuge is 2 A', () => {
    const r = [2, 3, 4, 5].map((t) => singleblockOverclock({ euPerTick: 48, durationTicks: 500 }, { tier: t, amps: 2 }));
    expect(r.map((x) => [x.euPerTick, x.durationTicks])).toEqual([[192, 250], [768, 125], [3072, 62], [12288, 31]]);
  });
  it('arc furnace is 3 A with ×3 EU/t', () => {
    const r = singleblockOverclock({ euPerTick: 30, durationTicks: 200 }, { tier: 2, amps: 3 });
    expect([r.euPerTick, r.durationTicks, r.machineVoltage]).toEqual([360, 100, 384]);
  });
  it('multiblock hatches: one hatch = 1 A, two hatches = 4 A', () => {
    const f = (hatchTier: number, hatches: number) => multiblockOverclock({ euPerTick: 30, durationTicks: 200 }, { hatchTier, hatches });
    expect([f(2, 1), f(2, 2), f(1, 2), f(3, 1)].map((x) => [x.euPerTick, x.durationTicks])).toEqual([[120, 100], [480, 50], [120, 100], [480, 50]]);
  });
  it('EBF heat discount and heat OCs (120 EU/t × 1000 t, 1000 K)', () => {
    const ebf = (coilHeat: number, hatchTier: number, hatches = 1) =>
      multiblockOverclock({ euPerTick: 120, durationTicks: 1000, heat: 1000 }, { hatchTier, hatches, heatOC: true, coilHeat });
    expect([ebf(2701, 2), ebf(3601, 3), ebf(3601, 4), ebf(2701, 2, 2)].map((x) => [x.euPerTick, x.durationTicks]))
      .toEqual([[114, 1000], [412, 250], [1647, 125], [434, 250]]);
    expect([ebfHeat(2701, 128), ebfHeat(3601, 512), ebfHeat(2701, 256), ebfHeat(1801, 32)]).toEqual([2701, 3701, 2801, 1701]);
  });
  it('perfect OC (Large Chemical Reactor) and sub-tick parallels', () => {
    const lcr = (t: number) => multiblockOverclock({ euPerTick: 30, durationTicks: 200 }, { hatchTier: t, perfectOC: true });
    expect([lcr(2), lcr(4)].map((x) => [x.euPerTick, x.durationTicks])).toEqual([[120, 50], [1920, 3]]);
    expect(multiplierUnderOneTick({ recipeEUt: 30, duration: 2, machineVoltage: v(5), amperageOC: true })).toBe(8);
    expect(multiblockOverclock({ euPerTick: 30, durationTicks: 2 }, { hatchTier: 5 }).parallel).toBe(8);
  });
  it('default coil per tier', () => {
    expect([defaultCoilHeat(1), defaultCoilHeat(2), defaultCoilHeat(3), defaultCoilHeat(5)]).toEqual([1801, 1801, 2701, 4501]);
  });
});
