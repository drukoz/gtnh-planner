// A small synthetic GregTech texture dump with its extracted files (Task 8), shared by the GT face, resolver and route tests.

import type { AssetIndex } from '../../src/server/assets/index.ts';
import { buildTexturesDump, type DumpFaces, type DumpLayer, type TexturesDump, type TexturesDumpFile } from '../../src/server/assets/textures-dump.ts';
import { indexOf, type AssetSpec } from './assets-dir.ts';
import { dumpFile } from './textures-dump.ts';

export const I = 'gregtech/textures/blocks/iconsets/';
export const BM = 'gregtech/textures/blocks/basicmachines/macerator/';
export const MI = 'gregtech/textures/items/materialicons/';

const FLUID_WATER = 'gregtech/textures/blocks/fluids/fluid.water.png';

export const GT_SAMPLE_ASSETS: AssetSpec = {
  [I + 'MACHINE_LV_SIDE.png']: { color: [150, 150, 160, 255] },
  [I + 'MACHINE_LV_TOP.png']: {},
  [I + 'MACHINE_LV_BOTTOM.png']: {},
  [I + 'MACHINE_CASING_SOLID_STEEL.png']: { color: [180, 180, 180, 255] },
  [I + 'OVERLAY_PIPE_IN.png']: {},
  [I + 'OVERLAY_CONVEYOR.png']: {},
  [BM + 'OVERLAY_FRONT.png']: { color: [40, 40, 40, 255] },
  [BM + 'OVERLAY_FRONT_ACTIVE.png']: { h: 64, frames: 4 },
  [BM + 'OVERLAY_FRONT_ACTIVE_GLOW.png']: { h: 64, frames: 4 },
  [MI + 'METALLIC/ingot.png']: {},
  [MI + 'NONE/ingot.png']: {},
  [MI + 'NONE/ingot_OVERLAY.png']: {},
  [MI + 'NONE/dust.png']: {},
  'gregtech/textures/items/gt.metaitem.01/606.png': {},
  [FLUID_WATER]: { h: 64, frames: 4 },
};

const ts = (set: string, suffix: string): DumpLayer =>
  ({ ts: [`${MI}${set}/${suffix}.png`, `${MI}NONE/${suffix}.png`, `${MI}${set}/${suffix}_OVERLAY.png`, `${MI}NONE/${suffix}_OVERLAY.png`] });
const p = (path: string): DumpLayer => ({ p: [path] });
const casing = (side: number): DumpLayer => ({ copy: ['gregtech:gt.blockcasings2', 0, side] });

export function gtSampleFile(): TexturesDumpFile {
  const side = p(I + 'MACHINE_LV_SIDE.png');
  const idle: DumpFaces = [
    [p(I + 'MACHINE_LV_BOTTOM.png')], [p(I + 'MACHINE_LV_TOP.png')],
    [side, p(BM + 'OVERLAY_FRONT.png')], [side], [side], [side],
  ];
  const running: DumpFaces = [
    ...idle.slice(0, 2),
    [side, p(BM + 'OVERLAY_FRONT_ACTIVE.png'), { p: [BM + 'OVERLAY_FRONT_ACTIVE_GLOW.png'], glow: 1 }],
    ...idle.slice(3),
  ];
  const copies: DumpFaces = [0, 1, 2, 3, 4, 5].map((s) => [casing(s)]);
  return dumpFile({
    sets: [{ name: 'METALLIC', icons: { '11': [ts('METALLIC', 'ingot')], '2': [ts('METALLIC', 'dust')] } }],
    materials: [{ name: 'Iron', id: 32, rgba: [200, 200, 220, 0], set: 0 }],
    metaItems: [{ id: 'gregtech:gt.metaitem.01', offset: 32000, unlocalized: 'gt.metaitem.01',
      prefixes: [{ i: 2, prefix: 'dust', texture: 2 }, { i: 11, prefix: 'ingot', texture: 11 }] }],
    mte: [
      { id: 301, cls: 'MTEBasicMachineWithRecipe', inactive: idle, active: running },
      { id: 50, cls: 'MTEHatchInput', inactive: copies.map((l, s) => (s === 2 ? [...l, p(I + 'OVERLAY_PIPE_IN.png')] : l)) },
      { id: 999, cls: 'Broken', error: 'java.lang.NullPointerException' },
    ],
    casingPages: [{ id: 16, faces: copies }],
    blocks: [{ id: 'gregtech:gt.blockcasings2', metas: { '0': [0, 1, 2, 3, 4, 5].map(() => [p(I + 'MACHINE_CASING_SOLID_STEEL.png')]) } }],
    covers: [{ item: 'gregtech:gt.metaitem.01@32630', layers: [p(I + 'OVERLAY_CONVEYOR.png')] }],
    fluids: [{ name: 'water', color: -16776961, still: FLUID_WATER }],
    blockIds: ['gregtech:gt.blockcasings2', 'gregtech:gt.blockmachines', 'minecraft:stone'],
  });
}

export function gtSample(): { index: AssetIndex; dump: TexturesDump } {
  const index = indexOf(GT_SAMPLE_ASSETS);
  return { index, dump: buildTexturesDump(gtSampleFile(), index) };
}
