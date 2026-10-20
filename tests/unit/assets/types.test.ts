import { describe, it, expect } from 'vitest';
import {
  FACES, rotateFaces, orientFaces, hashColor, KIND_COLORS, partBlockRef, conduitBlockRef, ae2CableBlockRef, regionRect, layerKey,
  type Face, type Rect, type Rgb, type TextureLayer,
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

// Plan 16 Task 10 (architecture §11.43 (j)): a block facing up or down keeps its hull by world side, as GT draws it.
describe('orientFaces', () => {
  const l = (n: string): TextureLayer => ({ path: `gregtech/textures/blocks/iconsets/${n}.png` });
  const hatch = { down: [l('B')], up: [l('T')], north: [l('S'), l('OUT')], south: [l('S')], west: [l('S')], east: [l('S')] };

  it('keeps every world side\'s own layers on a block facing up or down whose sides share a hull, and moves only the front\'s overlays', () => {
    expect(orientFaces(hatch, 1)).toEqual({ down: [l('B')], up: [l('T'), l('OUT')], north: [l('S')], south: [l('S')], west: [l('S')], east: [l('S')] });
    expect(orientFaces(hatch, 0)).toEqual({ down: [l('B'), l('OUT')], up: [l('T')], north: [l('S')], south: [l('S')], west: [l('S')], east: [l('S')] });
    expect(orientFaces(hatch, 4)).toEqual(rotateFaces(hatch, 4));
    const machine = { down: [l('B')], up: [l('T'), l('OT')], north: [l('S'), l('OF')], south: [l('S')], west: [l('S'), l('OS')], east: [l('S')] };
    expect(orientFaces(machine, 1)).toEqual({ down: [l('B')], up: [l('T'), l('OF')], north: [l('S')], south: [l('S')], west: [l('S'), l('OS')], east: [l('S')] });   // OT is not drawn: up shows the front
    expect(orientFaces(machine, 0)).toEqual({ down: [l('B'), l('OF')], up: [l('T'), l('OT')], north: [l('S')], south: [l('S')], west: [l('S'), l('OS')], east: [l('S')] });   // the top keeps its overlay
    const odd = { ...hatch, west: [l('W')] };                                     // sides do not share a hull: the whole cube turns
    expect(orientFaces(odd, 1)).toEqual(rotateFaces(odd, 1));
    expect(orientFaces({ down: [], up: [], north: [], south: [], west: [], east: [] }, 1).north).toEqual([]);
    expect(orientFaces(hatch, 1).up[0]).not.toBe(hatch.up[0]);
  });

  // ---- after the plan's own tests: the edges the plan leaves open ----

  it('compares the sides\' first layers by value, tint and region included', () => {
    const red = (n: string): TextureLayer => ({ ...l(n), tint: [255, 0, 0] });
    const tinted = { down: [l('B')], up: [l('T')], north: [red('S'), l('OUT')], south: [red('S')], west: [red('S')], east: [red('S')] };
    expect(orientFaces(tinted, 1).north).toEqual([red('S')]);                    // equal values in separate objects: one hull
    const blue = { ...tinted, east: [{ ...l('S'), tint: [0, 0, 255] as Rgb }] };
    expect(orientFaces(blue, 1)).toEqual(rotateFaces(blue, 1));                    // the same file in another tint is another hull
    const crop = (x: number): TextureLayer => ({ ...l('S'), region: { sheet: 64, src: [x, 0, 16, 16] } });
    const cut = { down: [l('B')], up: [l('T')], north: [crop(0), l('OUT')], south: [crop(0)], west: [crop(0)], east: [crop(16)] };
    expect(orientFaces(cut, 1)).toEqual(rotateFaces(cut, 1));                      // another crop of the same file too
    const loose = { ...hatch, east: [{ ...l('S'), tint: undefined }] };          // a field left undefined is absent, as once sent as JSON
    expect(orientFaces(loose, 1).up).toEqual([l('T'), l('OUT')]);
  });

  it('turns a block without a top or a bottom whole, and any facing but up or down as rotateFaces does', () => {
    const open = { ...hatch, down: [] };
    expect(orientFaces(open, 1)).toEqual(rotateFaces(open, 1));
    expect(orientFaces({ ...hatch, up: [] }, 0)).toEqual(rotateFaces({ ...hatch, up: [] }, 0));
    for (const facing of [2, 3, 5, 6, -1]) expect(orientFaces(hatch, facing)).toEqual(rotateFaces(hatch, facing));
  });

  it('hands out copies: changing what it returns changes neither its input nor its next answer', () => {
    const crop: TextureLayer = { ...l('S'), tint: [10, 20, 30], region: { sheet: 64, src: [0, 0, 16, 16], dst: [0, 0, 16, 16] } };
    const faces = { down: [l('B')], up: [l('T')], north: [crop, l('OUT')], south: [crop], west: [crop], east: [crop] };
    for (const facing of [1, 4]) {
      const out = orientFaces(faces, facing);
      for (const face of FACES) {
        expect(out[face]).not.toBe(faces[face]);
        for (const layer of out[face]) {
          layer.path = 'changed.png';
          if (layer.tint !== undefined) layer.tint[0] = 0;
          if (layer.region !== undefined) {
            layer.region.src[0] = 99;
            layer.region.dst![0] = 99;
          }
        }
      }
    }
    expect(crop).toEqual({ ...l('S'), tint: [10, 20, 30], region: { sheet: 64, src: [0, 0, 16, 16], dst: [0, 0, 16, 16] } });
    expect(faces.north[1]).toEqual(l('OUT'));
    expect(orientFaces(faces, 1).up).toEqual([l('T'), l('OUT')]);
  });
});
