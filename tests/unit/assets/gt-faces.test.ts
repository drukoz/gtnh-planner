import { describe, it, expect } from 'vitest';
import { indexOf } from '../../helpers/assets-dir.ts';
import { gtSample, I, BM, MI } from '../../helpers/gt-sample.ts';
import { dumpFile } from '../../helpers/textures-dump.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import type { Item } from '../../../src/shared/types/pack.ts';
import {
  gtMachineFaces, gtBlockFaces, casingFaces, coverLayers, gtItemIcon, gtFluidIcon, gtMaterialBlockFaces, gtTemplateIcon, materialTemplate, type CopyResolver,
} from '../../../src/server/assets/gt-faces.ts';
import type { PackView } from '../../../src/server/assets/resolve.ts';
import { buildTexturesDump, type DumpLayer } from '../../../src/server/assets/textures-dump.ts';

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

  it('finds numbered meta items in the item\'s own domain, lower-cased', () => {
    const ix = indexOf({ 'ggfab/textures/items/gt.ggfab.d1/4.png': {}, 'gregtech/textures/items/gt.ggfab.d1/5.png': {}, 'mixed/textures/items/gt.thing/1.png': {} });
    const d = buildTexturesDump(dumpFile({ metaItems: [{ id: 'ggfab:gt.ggfab.d1', offset: 0, unlocalized: 'gt.ggfab.d1', prefixes: [] },
      { id: 'MiXed:gt.thing', offset: 0, unlocalized: 'gt.thing', prefixes: [] }] }), ix);
    expect(gtItemIcon(d, ix, 'ggfab:gt.ggfab.d1@4')).toEqual([{ path: 'ggfab/textures/items/gt.ggfab.d1/4.png' }]);
    expect(gtItemIcon(d, ix, 'ggfab:gt.ggfab.d1@5')).toBeNull();   // gregtech's folder is not GGFab's
    expect(gtItemIcon(d, ix, 'MiXed:gt.thing@1')).toEqual([{ path: 'mixed/textures/items/gt.thing/1.png' }]);
  });
});

describe('GT material templates (RC4)', () => {
  const MB = 'gregtech/textures/blocks/materialicons/';
  const BLOCK = 'gregtech/textures/blocks/iconsets/BLOCK_';
  const tsOf = (root: string, set: string, n: string): DumpLayer =>
    ({ ts: [`${root}${set}/${n}.png`, `${root}NONE/${n}.png`, `${root}${set}/${n}_OVERLAY.png`, `${root}NONE/${n}_OVERLAY.png`] });
  const ix = indexOf({ [MB + 'NONE/frameGt.png']: {}, [MB + 'METALLIC/sheetmetal.png']: {}, [MI + 'NONE/dust.png']: {},
    [MI + 'NONE/cell.png']: {}, [MI + 'NONE/cell_OVERLAY.png']: {}, [BLOCK + 'RUBY.png']: {}, [BLOCK + 'STAINLESSSTEEL.png']: {} });
  const file = dumpFile({
    sets: [
      { name: 'METALLIC', icons: { '83': [tsOf(MB, 'METALLIC', 'frameGt')], '86': [tsOf(MB, 'METALLIC', 'sheetmetal')], '2': [tsOf(MI, 'METALLIC', 'dust')],
        '17': [tsOf(MI, 'METALLIC', 'plate')] } },
      { name: 'FLUID', icons: { '30': [tsOf(MI, 'FLUID', 'cell')] } },
    ],
    materials: [{ name: 'Steel', id: 305, rgba: [128, 128, 128, 0], set: 0 }, { name: 'Lost', id: 7, rgba: [1, 2, 3, 0], set: 9 }],
    fluids: [{ name: 'xenoxene', color: -16744320 }],
    metaItems: [{ id: 'gregtech:gt.metaitem.01', offset: 32000, unlocalized: 'gt.metaitem.01', prefixes: [
      { i: 2, prefix: 'dust', texture: 2 }, { i: 17, prefix: 'plate', texture: 17 }, { i: 30, prefix: 'cell', texture: 30 }] }],
  });
  const d = buildTexturesDump(file, ix);
  const item = (key: string, prefix?: string, material?: string): Item => ({
    key, id: key.slice(0, key.lastIndexOf('@')), meta: Number(key.slice(key.lastIndexOf('@') + 1)), name: key, oreDict: [],
    ...(prefix !== undefined && material !== undefined ? { gt: { prefix, material, amount: 3628800 } } : {}),
  });
  const pack: PackView = {
    machines: new Map(), materials: new Map(),
    items: new Map([
      item('gregtech:gt.blockframes@305', 'frameGt', 'Steel'), item('gregtech:bw.frames@10', 'frameGt', 'Steel'), item('gregtech:gt.blockframes@1'),
      item('gregtech:gt.sheetmetal@305', 'sheetmetal', 'Steel'), item('gregtech:bw.sheetmetal@3', 'sheetmetal', 'Steel'),
      item('gregtech:gt.blockgem2@4', 'block', 'Ruby'), item('gregtech:gt.blockmetal7@0', 'block', 'StainlessSteel'), item('gregtech:gt.blockmetal1@3', 'block', 'Nope'),
      item('gregtech:gt.blockcasings@305', 'frameGt', 'Steel'),
      item('gregtech:gt.metaitem.99@305', 'dust', 'Steel'), item('gregtech:gt.metaitem.99@2'), item('gregtech:gt.metaitem.01@2305', 'dust', 'Steel'),
      item('bartworks:gt.bwMetaGenerateddust@305', 'dust', 'Steel'), item('bartworks:gt.bwMetaGeneratedplate@1', 'plate', 'Steel'),
    ].map((i) => [i.key, i])),
    fluidContainers: [{ container: 'gregtech:gt.metaitem.98@27', empty: null, fluid: 'fluid:xenoxene', amount: 1000 },
      { container: 'gregtech:gt.metaitem.98@5', empty: null, fluid: 'fluid:nope', amount: 1000 }],
  };

  it('draws a prefix of a material from its set\'s icon, tinted; nothing for a missing prefix, material, set, icon or file', () => {
    expect(materialTemplate(d, ix, 'frameGt', 'Steel')).toEqual([{ path: MB + 'NONE/frameGt.png', tint: [128, 128, 128] }]);
    expect(materialTemplate(d, ix, 'sheetmetal', 'Steel')).toEqual([{ path: MB + 'METALLIC/sheetmetal.png', tint: [128, 128, 128] }]);
    expect([
      materialTemplate(d, ix, 'nope', 'Steel'),     // no texture index
      materialTemplate(d, ix, 'dust', 'Nope'),      // no such material
      materialTemplate(d, ix, 'dust', 'Lost'),      // its set is not in the dump
      materialTemplate(d, ix, 'ore', 'Steel'),      // the set has no ore icon
      materialTemplate(d, ix, 'plate', 'Steel'),    // no plate file was extracted
    ]).toEqual([null, null, null, null, null]);
  });

  it('draws frames and sheetmetal from their template and storage blocks from their own icon, the same on all six faces', () => {
    const frame = gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockframes', 305)!;
    for (const face of FACES) expect(frame[face]).toEqual([{ path: MB + 'NONE/frameGt.png', tint: [128, 128, 128] }]);
    expect(frame.up).not.toBe(frame.down);   // every face its own list
    expect(gtMaterialBlockFaces(d, ix, pack, 'gregtech:bw.frames', 10)!.west).toEqual(frame.west);
    const sheet = [{ path: MB + 'METALLIC/sheetmetal.png', tint: [128, 128, 128] }];
    expect([gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.sheetmetal', 305)!.north, gtMaterialBlockFaces(d, ix, pack, 'gregtech:bw.sheetmetal', 3)!.south])
      .toEqual([sheet, sheet]);
    expect(gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockgem2', 4)!.east).toEqual([{ path: BLOCK + 'RUBY.png' }]);   // untinted
    expect(gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockmetal7', 0)!.up).toEqual([{ path: BLOCK + 'STAINLESSSTEEL.png' }]);
  });

  it('leaves blocks without a pack material, storage blocks without an icon and other blocks to the later steps', () => {
    expect([
      gtMaterialBlockFaces(d, ix, null, 'gregtech:gt.blockframes', 305),
      gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockframes', 1),       // the pack gives no material
      gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockframes', 2),       // not in the pack
      gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockmetal1', 3),       // BLOCK_NOPE was not extracted
      gtMaterialBlockFaces(d, ix, pack, 'gregtech:gt.blockcasings', 305),    // not a material block
    ]).toEqual([null, null, null, null, null]);
  });

  it('draws metaitem.99 and BartWorks items by their pack prefix and material, metaitem.98 as the FLUID cell in its fluid\'s colour', () => {
    const dust = [{ path: MI + 'NONE/dust.png', tint: [128, 128, 128] }];
    expect(gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.99@305')).toEqual(dust);
    expect(gtTemplateIcon(d, ix, pack, 'bartworks:gt.bwMetaGenerateddust@305')).toEqual(dust);
    expect(gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.98@27')).toEqual([{ path: MI + 'NONE/cell.png', tint: [0, 128, 128] }, { path: MI + 'NONE/cell_OVERLAY.png' }]);
  });

  it('gives no template icon without a pack material, a container row, a dump fluid or a FLUID set, nor for other items', () => {
    const noFluidSet = buildTexturesDump({ ...file, sets: [file.sets[0]!] }, ix);
    expect([
      gtTemplateIcon(d, ix, null, 'gregtech:gt.metaitem.99@305'),
      gtTemplateIcon(d, ix, null, 'gregtech:gt.metaitem.98@27'),
      gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.99@2'),               // the pack gives no material
      gtTemplateIcon(d, ix, pack, 'bartworks:gt.bwMetaGeneratedplate@1'),     // no plate file was extracted
      gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.98@1'),               // no container row
      gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.98@5'),               // a fluid the dump does not know
      gtTemplateIcon(noFluidSet, ix, pack, 'gregtech:gt.metaitem.98@27'),
      gtTemplateIcon(d, ix, pack, 'gregtech:gt.metaitem.01@2305'),            // gtItemIcon's
      gtTemplateIcon(d, ix, pack, 'nope'),
    ]).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
