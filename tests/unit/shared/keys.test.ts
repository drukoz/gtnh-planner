import { describe, expect, it } from 'vitest';
import { fluidKey, isFluidKey, itemKey, parseItemKey } from '../../../src/shared/keys.ts';

describe('item keys', () => {
  it('joins registry name and meta, with an optional NBT hash', () => {
    expect(itemKey('gregtech:gt.metaitem.01', 2032)).toBe('gregtech:gt.metaitem.01@2032');
    expect(itemKey('minecraft:written_book', 0, 'a1b2c3d4e5f6')).toBe('minecraft:written_book@0#a1b2c3d4e5f6');
  });
  it('never builds a wildcard or invalid meta', () => {
    expect(() => itemKey('minecraft:planks', 32767)).toThrow(RangeError);
    expect(() => itemKey('minecraft:planks', -1)).toThrow(RangeError);
    expect(() => itemKey('minecraft:planks', 1.5)).toThrow(RangeError);
  });
  it('parses what it builds', () => {
    expect(parseItemKey('gregtech:gt.metaitem.01@2032')).toEqual({ id: 'gregtech:gt.metaitem.01', meta: 2032 });
    expect(parseItemKey('minecraft:written_book@0#a1b2c3d4e5f6')).toEqual({ id: 'minecraft:written_book', meta: 0, nbtHash: 'a1b2c3d4e5f6' });
  });
  it('rejects fluid keys and malformed keys', () => {
    for (const bad of ['fluid:water', 'minecraft:stone', 'minecraft:stone@x', '@3', 'minecraft:stone@1#']) {
      expect(() => parseItemKey(bad)).toThrow();
    }
  });
});

describe('fluid keys', () => {
  it('prefixes and detects', () => {
    expect(fluidKey('molten.iron')).toBe('fluid:molten.iron');
    expect(isFluidKey('fluid:molten.iron')).toBe(true);
    expect(isFluidKey('gregtech:gt.metaitem.01@2032')).toBe(false);
  });
});

describe('key edge cases', () => {
  it('accepts the largest real meta and rejects NaN, infinities and metas too big to print exactly', () => {
    expect(itemKey('minecraft:planks', 32766)).toBe('minecraft:planks@32766');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53]) {
      expect(() => itemKey('minecraft:planks', bad)).toThrow(RangeError);
    }
  });
  it('splits on the last @, so a registry name may contain one', () => {
    expect(parseItemKey('odd@mod:thing@7#abc123')).toEqual({ id: 'odd@mod:thing', meta: 7, nbtHash: 'abc123' });
  });
  it('never reads a fluid key as an item key, even when the fluid name contains an @', () => {
    expect(() => parseItemKey('fluid:odd@3')).toThrow();
  });
  it('rejects the wildcard, non-canonical numbers and a stray # when parsing', () => {
    for (const bad of ['minecraft:planks@32767', 'minecraft:stone@-1', 'minecraft:stone@1.5', 'minecraft:stone@01', 'minecraft:stone@99999999999999999999', 'minecraft:stone@', 'minecraft:stone@1#a#b']) {
      expect(() => parseItemKey(bad)).toThrow();
    }
  });
});
