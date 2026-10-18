import { expect, it } from 'vitest';
import { PSEUDO_MACHINES, TIER_NAMES, V, recipeTier, tierName } from '../../../src/shared/gt/tiers.ts';

it('has the 15 GT tiers and voltages', () => {
  expect(TIER_NAMES).toEqual(['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UMV', 'UXV', 'MAX']);
  expect(V).toEqual([8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483640]);
});

it('names tiers and rejects unknown ones', () => {
  expect(tierName(6)).toBe('LuV');
  expect(() => tierName(15)).toThrow(RangeError);
  expect(() => tierName(-1)).toThrow(RangeError);
});

it.each([
  [0, 1, 1], [7, 1, 1], [8, 1, 1], [32, 1, 1], [33, 1, 2], [120, 1, 2], [480, 1, 3],
  [1920, 1, 4], [7680, 1, 5], [64, 2, 1], [65, 2, 2], [30, 0, 1], [3e9, 1, 14],
])('recipeTier(%d EU/t, %d A) = %d', (eut, amps, tier) => {
  expect(recipeTier(eut, amps)).toBe(tier);
});

it('fixes the pseudo machine ids', () => {
  expect(PSEUDO_MACHINES).toEqual({ CRAFTING_TABLE: -1, FURNACE: -2, HAND: -3 });
});

it('names the first and last tier and rejects non-integers', () => {
  expect(tierName(0)).toBe('ULV');
  expect(tierName(14)).toBe('MAX');
  expect(() => tierName(1.5)).toThrow(RangeError);
  expect(() => tierName(Number.NaN)).toThrow(RangeError);
});

it('clamps recipeTier at the voltage edges and counts missing amps as one', () => {
  expect(recipeTier(536870912, 1)).toBe(13);
  expect(recipeTier(536870913, 1)).toBe(14);
  expect(recipeTier(2147483640, 1)).toBe(14);
  expect(recipeTier(96, 3)).toBe(1);
  expect(recipeTier(33, -5)).toBe(2);
});
