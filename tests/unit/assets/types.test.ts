import { describe, it, expect } from 'vitest';
import {
  FACES, rotateFaces, hashColor, KIND_COLORS, partBlockRef, conduitBlockRef, ae2CableBlockRef, regionRect, layerKey, type Face, type Rect,
} from '../../../src/shared/types/assets.ts';

const C: Record<Face, string> = { down: 'D', up: 'U', north: 'N', south: 'S', west: 'W', east: 'E' };

describe('asset types', () => {
  it('lists faces in ForgeDirection order', () => {
    expect(FACES).toEqual(['down', 'up', 'north', 'south', 'west', 'east']);
  });

  it('turns the canonical north front to each facing', () => {
    expect(rotateFaces(C, 2)).toEqual(C);
    expect(rotateFaces(C, 3)).toEqual({ down: 'D', up: 'U', north: 'S', south: 'N', west: 'E', east: 'W' });
    expect(rotateFaces(C, 4)).toEqual({ down: 'D', up: 'U', north: 'E', south: 'W', west: 'N', east: 'S' });
    expect(rotateFaces(C, 5)).toEqual({ down: 'D', up: 'U', north: 'W', south: 'E', west: 'S', east: 'N' });
    expect(rotateFaces(C, 0)).toEqual({ down: 'N', up: 'S', north: 'U', south: 'D', west: 'W', east: 'E' });
    expect(rotateFaces(C, 1)).toEqual({ down: 'S', up: 'N', north: 'D', south: 'U', west: 'W', east: 'E' });
    expect(rotateFaces(C, 7)).toEqual(C);
    expect(rotateFaces(C, 2)).not.toBe(C);
  });

  it('hashes to stable colours', () => {
    expect(hashColor('a')).toEqual([192, 89, 123]);
    expect(hashColor('fluid:water')).toEqual([89, 192, 106]);
    expect(hashColor('t:iron_ingot@0')).toEqual([89, 128, 192]);
  });

  it('has a colour for every machine kind', () => {
    expect(Object.keys(KIND_COLORS).sort()).toEqual(['basic', 'battery_buffer', 'boiler', 'cable', 'casing', 'fluid_pipe', 'generator',
      'hatch', 'item_pipe', 'multiblock', 'other', 'steam', 'transformer', 'turbine']);
    expect(KIND_COLORS.basic).toEqual([96, 125, 139]);
  });

  it('builds pseudo block refs for parts, conduits and AE2 cables', () => {
    expect(partBlockRef('pr_rinterface')).toEqual({ id: 'fmp:pr_rinterface', meta: 0 });
    expect(conduitBlockRef('item')).toEqual({ id: 'conduit:item', meta: 0 });
    expect(ae2CableBlockRef('smart')).toEqual({ id: 'ae2cable:smart', meta: 0 });
  });

  it('places a region in the tile and keys a layer by path and region', () => {
    const chest = { path: 'p.png', region: { sheet: 64, src: [14, 33, 14, 10] as Rect, dst: [1, 6, 14, 10] as Rect } };
    expect(regionRect(chest, 32)).toEqual([2, 12, 28, 20]);
    expect(regionRect({ path: 'p.png' }, 32)).toEqual([0, 0, 32, 32]);
    expect(regionRect({ path: 'p.png', region: { sheet: 16, src: [4, 0, 8, 8] } }, 24)).toEqual([0, 0, 24, 24]);
    expect(layerKey({ path: 'a.png' })).toBe('a.png');
    expect(layerKey(chest)).toBe('p.png#{"sheet":64,"src":[14,33,14,10],"dst":[1,6,14,10]}');
  });

  it('rounds a region\'s place and never makes it narrower than a pixel', () => {
    const knob = { path: 'p.png', region: { sheet: 64, src: [1, 1, 2, 4] as Rect, dst: [7, 5, 2, 4] as Rect } };
    expect(regionRect(knob, 24)).toEqual([11, 8, 3, 6]);   // 10.5, 7.5, 3, 6
    expect(regionRect(knob, 2)).toEqual([1, 1, 1, 1]);     // 0.875, 0.625, 0.25 (at least 1), 0.5
  });
});
