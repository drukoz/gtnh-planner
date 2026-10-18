import { describe, it, expect } from 'vitest';
import { gtSample, I, BM, MI } from '../../helpers/gt-sample.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import { gtMachineFaces, gtBlockFaces, casingFaces, coverLayers, gtItemIcon, gtFluidIcon, type CopyResolver } from '../../../src/server/assets/gt-faces.ts';

const { index, dump } = gtSample();
const copy: CopyResolver = (block, meta, side) => gtBlockFaces(dump, block, meta, copy)?.[FACES[side]!] ?? [];

describe('GT faces', () => {
  it('gives a machine its canonical faces, idle and running', () => {
    const idle = gtMachineFaces(dump, 301, copy)!;
    expect(idle.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }]);
    expect(idle.up).toEqual([{ path: I + 'MACHINE_LV_TOP.png' }]);
    expect(idle.east).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(gtMachineFaces(dump, 301, copy, true)!.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' },
      { path: BM + 'OVERLAY_FRONT_ACTIVE.png', frames: 4 }, { path: BM + 'OVERLAY_FRONT_ACTIVE_GLOW.png', glow: true, frames: 4 }]);
    expect(gtMachineFaces(dump, 999, copy)).toBeNull();
    expect(gtMachineFaces(dump, 12345, copy)).toBeNull();
  });

  it('draws hatches and casing pages with the casing block they copy', () => {
    const hatch = gtMachineFaces(dump, 50, copy)!;
    expect(hatch.south).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    expect(hatch.north).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }, { path: I + 'OVERLAY_PIPE_IN.png' }]);
    expect(casingFaces(dump, 16, copy)!.up).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    expect(casingFaces(dump, 17, copy)).toBeNull();
    expect(gtBlockFaces(dump, 'gregtech:gt.blockcasings2', 1, copy)).toBeNull();
  });

  it('resolves cover overlays', () => {
    expect(coverLayers(dump, 'gregtech:gt.metaitem.01@32630', copy)).toEqual([{ path: I + 'OVERLAY_CONVEYOR.png' }]);
    expect(coverLayers(dump, 'gregtech:gt.metaitem.01@1', copy)).toBeNull();
  });
});

describe('GT item and fluid icons', () => {
  it('composes material items from the texture set and the material colour', () => {
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@11032')).toEqual([{ path: MI + 'METALLIC/ingot.png', tint: [200, 200, 220] }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@2032')).toEqual([{ path: MI + 'NONE/dust.png', tint: [200, 200, 220] }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@11999')).toBeNull();
  });

  it('uses the numbered icon for meta items at or above the offset', () => {
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@32606')).toEqual([{ path: 'gregtech/textures/items/gt.metaitem.01/606.png' }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@32607')).toBeNull();
    expect(gtItemIcon(dump, index, 'minecraft:apple@0')).toBeNull();
  });

  it('gives GT fluids their tinted still texture', () => {
    expect(gtFluidIcon(dump, 'water')).toEqual({ layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }], color: [0, 0, 255] });
    expect(gtFluidIcon(dump, 'nope')).toBeNull();
  });
});
