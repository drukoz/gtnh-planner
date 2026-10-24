import { expect, it } from 'vitest';
import {
  GT_NS,
  MC_MACHINES,
  MC_NS,
  compareMachineId,
  gtMachineId,
  isId,
  isPseudoMachineId,
  legacyMteId,
  localOf,
  machineIdOfLegacy,
  makeId,
  nsOf,
} from '../../../src/shared/ids.ts';

it('names the GT and MC namespaces', () => {
  expect(GT_NS).toBe('gt');
  expect(MC_NS).toBe('mc');
});

it('round-trips makeId/nsOf/localOf, including a local part with a colon', () => {
  expect(makeId('ic2', 'te:macerator')).toBe('ic2:te:macerator');
  expect(nsOf('ic2:te:macerator')).toBe('ic2');
  expect(localOf('ic2:te:macerator')).toBe('te:macerator');
  expect(nsOf('gt:1001')).toBe('gt');
  expect(localOf('gt:1001')).toBe('1001');
  expect(nsOf('mc:furnace')).toBe('mc');
  expect(localOf('mc:furnace')).toBe('furnace');
});

it('rejects bad namespaces and an empty local part', () => {
  for (const ns of ['', 'GT', '1ic2', 'ic 2']) {
    expect(() => makeId(ns, 'x')).toThrow(RangeError);
  }
  expect(() => makeId('gt', '')).toThrow(RangeError);
  expect(() => nsOf('nope')).toThrow();
});

it('recognises well-formed ids', () => {
  expect(isId('gt:1001')).toBe(true);
  expect(isId('ic2:te:macerator')).toBe(true);
  expect(isId('mc:hand')).toBe(true);
  expect(isId('')).toBe(false);
  expect(isId('nope')).toBe(false);
  expect(isId('x:')).toBe(false);
  expect(isId(1001)).toBe(false);
  expect(isId(null)).toBe(false);
});

it('builds a gt id and rejects a bad mteId', () => {
  expect(gtMachineId(1001)).toBe('gt:1001');
  expect(gtMachineId(0)).toBe('gt:0');
  expect(() => gtMachineId(-1)).toThrow(RangeError);
  expect(() => gtMachineId(1.5)).toThrow(RangeError);
});

it('fixes the pseudo machine ids', () => {
  expect(MC_MACHINES).toEqual({ HAND: 'mc:hand', FURNACE: 'mc:furnace', CRAFTING_TABLE: 'mc:crafting_table' });
  expect(isPseudoMachineId(MC_MACHINES.HAND)).toBe(true);
  expect(isPseudoMachineId(MC_MACHINES.FURNACE)).toBe(true);
  expect(isPseudoMachineId(MC_MACHINES.CRAFTING_TABLE)).toBe(true);
  expect(isPseudoMachineId('gt:1001')).toBe(false);
});

it('maps legacy mteIds both ways and rejects foreign ids', () => {
  for (const n of [-3, -2, -1, 0, 1, 1001, 31091]) {
    const id = machineIdOfLegacy(n);
    expect(legacyMteId(id)).toBe(n);
    expect(machineIdOfLegacy(legacyMteId(id))).toBe(id);
  }
  expect(() => legacyMteId('ic2:macerator')).toThrow();
  expect(() => machineIdOfLegacy(-4)).toThrow();
});

it('compares ids exactly as the old mteId subtraction did', () => {
  const nums = [-3, -2, -1, 0, 1, 2, 9, 10, 999, 1001, 31091];
  const ids = nums.map(machineIdOfLegacy);
  const shuffled = [...ids].reverse();
  shuffled.sort(compareMachineId);
  const expected = [...nums].sort((a, b) => a - b).map(machineIdOfLegacy);
  expect(shuffled).toEqual(expected);

  const extra = [...shuffled, 'ic2:macerator', 'te:pulverizer'];
  extra.sort(compareMachineId);
  expect(extra).toEqual([...expected, 'ic2:macerator', 'te:pulverizer']);
});
