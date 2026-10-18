import { describe, it, expect } from 'vitest';
import { FACES, rotateFaces, hashColor, KIND_COLORS, partBlockRef, conduitBlockRef, ae2CableBlockRef, type Face } from '../../../src/shared/types/assets.ts';

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
});
