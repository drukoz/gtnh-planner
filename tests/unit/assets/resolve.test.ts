import { describe, it, expect } from 'vitest';
import { gtSampleFile, GT_SAMPLE_ASSETS, I, BM, MI } from '../../helpers/gt-sample.ts';
import { indexOf } from '../../helpers/assets-dir.ts';
import { dumpFile } from '../../helpers/textures-dump.ts';
import { buildTexturesDump, type TexturesDumpFile } from '../../../src/server/assets/textures-dump.ts';
import { resolveBlocks, resolveIcons, resolveCovers, type AssetSources, type PackView } from '../../../src/server/assets/resolve.ts';
import { hashColor, KIND_COLORS } from '../../../src/shared/types/assets.ts';
import type { Item, Machine, MachineKind } from '../../../src/shared/types/pack.ts';

const index = indexOf({ ...GT_SAMPLE_ASSETS, 'storagedrawers/textures/blocks/drawers_oak_front_1.png': {}, 'storagedrawers/textures/blocks/drawers_oak_side.png': {},
  'jabba/textures/blocks/barrel_side_0.png': {}, 'minecraft/textures/blocks/stone.png': {}, 't/textures/items/iron_ingot.png': {} });
const dump = buildTexturesDump({ ...gtSampleFile(), textureNames: { blocks: { 'minecraft:stone': 'stone' }, items: { 't:iron_ingot': 't:iron_ingot' } } }, index);
const machine = (mteId: number, kind: MachineKind): Machine => ({ mteId, metaName: `m${mteId}`, name: `M${mteId}`, cls: 'X', itemKey: `gregtech:gt.blockmachines@${mteId}`, kind, maps: [] });
const item = (key: string, material?: string): Item => ({ key, id: key.split('@')[0]!, meta: 0, name: key, oreDict: [], ...(material ? { gt: { prefix: 'ingot', material, amount: 3628800 } } : {}) });
const pack: PackView = {
  machines: new Map([[301, machine(301, 'basic')], [77, machine(77, 'steam')]]),
  items: new Map([['t:iron_ingot@0', item('t:iron_ingot@0', 'Iron')], ['t:mystery@0', item('t:mystery@0', 'Copper')], ['t:plain@0', item('t:plain@0')]]),
  materials: new Map([['Copper', { name: 'Copper', rgba: [255, 100, 0, 0], iconSet: 'SHINY', oreByproducts: [] }]]),
};
const src: AssetSources = { index, dump, nei: null, pack };
const GT = 'gregtech:gt.blockmachines';

describe('resolveBlocks', () => {
  it('resolves GT machines, turns them, and falls back by machine kind', () => {
    const [m] = resolveBlocks(src, [{ id: GT, meta: 0, mteId: 301 }]);
    expect(m!.resolved).toBe(true);
    expect(m!.faces.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }]);
    const [east] = resolveBlocks(src, [{ id: GT, meta: 0, mteId: 301 }], 5);
    expect(east!.faces.east).toEqual(m!.faces.north);
    expect(east!.faces.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(resolveBlocks(src, [{ id: GT, meta: 0, mteId: 999 }])[0]).toMatchObject({ resolved: false, fallbackColor: KIND_COLORS.other });
    expect(resolveBlocks(src, [{ id: GT, meta: 0, mteId: 77 }])[0]!.fallbackColor).toEqual(KIND_COLORS.steam);
  });

  it('resolves casing blocks, curated blocks and plain texture names', () => {
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings2', meta: 0 }])[0]!.faces.up).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    const sd = resolveBlocks(src, [{ id: 'StorageDrawers:fullDrawers1', meta: 0 }])[0]!;
    expect(sd.faces.north).toEqual([{ path: 'storagedrawers/textures/blocks/drawers_oak_front_1.png' }]);
    expect(sd.resolved).toBe(true);
    expect(resolveBlocks(src, [{ id: 'minecraft:stone', meta: 0 }])[0]!.faces.west).toEqual([{ path: 'minecraft/textures/blocks/stone.png' }]);
  });

  it('reports partially resolved blocks', () => {
    const j = resolveBlocks(src, [{ id: 'JABBA:barrel', meta: 0 }])[0]!;
    expect(j.resolved).toBe(false);
    expect(j.faces.east).toEqual([{ path: 'jabba/textures/blocks/barrel_side_0.png' }]);
    expect(j.faces.north).toEqual([]);
    expect(j.fallbackColor).toEqual(hashColor('JABBA:barrel@0'));
  });

  it('ends copy cycles and gives unknown blocks their fallback colour', () => {
    const loop = buildTexturesDump(dumpFile({ blocks: [{ id: 'x:loop', metas: { '0': [0, 1, 2, 3, 4, 5].map((s) => [{ copy: ['x:loop', 0, s] as [string, number, number] }]) } }] }), index);
    expect(resolveBlocks({ ...src, dump: loop }, [{ id: 'x:loop', meta: 0 }])[0]).toMatchObject({ resolved: false, faces: { up: [] } });
    expect(resolveBlocks(src, [{ id: 'mod:thing', meta: 3 }])[0]).toEqual({ block: { id: 'mod:thing', meta: 3 },
      faces: { down: [], up: [], north: [], south: [], west: [], east: [] }, fallbackColor: hashColor('mod:thing@3'), resolved: false });
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings9', meta: 0 }])[0]!.fallbackColor).toEqual(KIND_COLORS.casing);
  });

  it('never draws a failed or unknown machine with the machine block\'s own icon', () => {
    // The real dump has a getIcon table for gt.blockmachines itself (the LV hull side on every face and meta).
    const file = gtSampleFile();
    const hull = buildTexturesDump({ ...file, blocks: [...file.blocks, { id: GT, metas: { '0': [0, 1, 2, 3, 4, 5].map(() => [{ p: [I + 'MACHINE_LV_SIDE.png'] }]) } }] }, index);
    const withHull: AssetSources = { ...src, dump: hull };
    const empty = { down: [], up: [], north: [], south: [], west: [], east: [] };
    expect(resolveBlocks(withHull, [{ id: GT, meta: 0, mteId: 999 }, { id: GT, meta: 0, mteId: 12345 }])).toEqual([
      { block: { id: GT, meta: 0, mteId: 999 }, faces: empty, fallbackColor: KIND_COLORS.other, resolved: false },
      { block: { id: GT, meta: 0, mteId: 12345 }, faces: empty, fallbackColor: KIND_COLORS.other, resolved: false }]);
    expect(resolveIcons(withHull, [`${GT}@999`, `${GT}@0`]).map((d) => d.source)).toEqual(['fallback', 'fallback']);
    expect(resolveBlocks(withHull, [{ id: GT, meta: 0, mteId: 301 }])[0]!.faces.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }]);
  });

  it('follows copies four levels deep and draws hatches with the casing they copy', () => {
    const chain = (n: number) => buildTexturesDump(dumpFile({ blocks: Array.from({ length: n + 1 }, (_, i) => ({ id: `c:${i}`, metas: { '0': [0, 1, 2, 3, 4, 5].map((s) =>
      [i < n ? { copy: [`c:${i + 1}`, 0, s] as [string, number, number] } : { p: [I + 'MACHINE_LV_TOP.png'] }]) } })) }), index);
    expect(resolveBlocks({ ...src, dump: chain(4) }, [{ id: 'c:0', meta: 0 }])[0]!.faces.up).toEqual([{ path: I + 'MACHINE_LV_TOP.png' }]);
    expect(resolveBlocks({ ...src, dump: chain(5) }, [{ id: 'c:0', meta: 0 }])[0]!.faces.up).toEqual([]);
    const hatch = resolveBlocks(src, [{ id: GT, meta: 0, mteId: 50 }], 1)[0]!;
    expect(hatch).toMatchObject({ block: { id: GT, meta: 0, mteId: 50 }, resolved: true });
    expect(hatch.faces.up).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }, { path: I + 'OVERLAY_PIPE_IN.png' }]);
  });
});

describe('GT ore blocks', () => {
  const B = 'gregtech/textures/blocks/materialicons/';
  const STONE = 'minecraft/textures/blocks/stone.png';
  const O = 'gregtech:gt.blockores2';
  const oreIndex = indexOf({ ...GT_SAMPLE_ASSETS, [STONE]: {}, [I + 'GRANITE_BLACK_STONE.png']: {},
    [B + 'METALLIC/ore.png']: {}, [B + 'METALLIC/oreSmall.png']: {}, [B + 'DULL/ore.png']: {}, [B + 'DULL/ore_OVERLAY.png']: {} });
  const file = gtSampleFile();
  const oreFile: TexturesDumpFile = {
    ...file,
    sets: [
      { ...file.sets[0]!, icons: { ...file.sets[0]!.icons,
        '67': [{ p: [B + 'METALLIC/oreSmall.png'] }, { p: [B + 'METALLIC/oreSmall_OVERLAY.png'] }],
        '68': [{ p: [B + 'METALLIC/ore.png'] }, { p: [B + 'METALLIC/ore_OVERLAY.png'] }] } },
      { name: 'DULL', icons: { '68': [{ p: [B + 'DULL/ore.png'] }, { p: [B + 'DULL/ore_OVERLAY.png'] }] } },
      { name: 'NONE', icons: {} },
    ],
    materials: [...file.materials, { name: 'Uraninite', id: 922, rgba: [35, 35, 35, 0], set: 1, oreGlow: 1 }, { name: 'Plain', id: 5, rgba: [1, 2, 3, 0], set: 2 }],
    blocks: [...file.blocks, { id: 'gregtech:gt.blockgranites', metas: { '0': [0, 1, 2, 3, 4, 5].map(() => [{ p: [I + 'GRANITE_BLACK_STONE.png'] }]) } }],
    ores: { ore: 68, oreSmall: 67, smallOffset: 16000, naturalOffset: 8000, blocks: [{ id: O, stones: [
      [{ copy: ['minecraft:stone', 0, 0] }], [{ copy: ['gregtech:gt.blockgranites', 0, 0] }], [{ copy: ['GalaxySpace:phobosblocks', 2, 0] }]] }] },
    textureNames: { blocks: { 'minecraft:stone': 'stone' }, items: {} },
  };
  const ores: AssetSources = { index: oreIndex, dump: buildTexturesDump(oreFile, oreIndex), nei: null, pack: null };
  const ironOre = (stone: string) => [{ path: stone }, { path: B + 'METALLIC/ore.png', tint: [200, 200, 220] }];

  it('draws the stone\'s down face under the tinted ore icon on every face (GTBlockOre.getTextures)', () => {
    const [iron, granite, natural] = resolveBlocks(ores, [{ id: O, meta: 32 }, { id: O, meta: 1032 }, { id: O, meta: 8032 }]);
    expect(iron).toEqual({ block: { id: O, meta: 32 }, resolved: true, fallbackColor: hashColor(`${O}@32`), faces: {
      down: ironOre(STONE), up: ironOre(STONE), north: ironOre(STONE), south: ironOre(STONE), west: ironOre(STONE), east: ironOre(STONE) } });
    expect(granite!.faces.south).toEqual(ironOre(I + 'GRANITE_BLACK_STONE.png'));
    expect(natural!.faces).toEqual(iron!.faces);   // world-generated ores (+8000) look the same
  });

  it('gives ore items their block face: small ores, glowing ores, and the ore alone on a stone without a texture', () => {
    const [iron, small, uraninite, phobos] = resolveIcons(ores, [`${O}@32`, `${O}@17032`, `${O}@922`, `${O}@2032`]);
    expect(iron).toMatchObject({ source: 'gt', layers: ironOre(STONE) });
    expect(small!.layers).toEqual([{ path: I + 'GRANITE_BLACK_STONE.png' }, { path: B + 'METALLIC/oreSmall.png', tint: [200, 200, 220] }]);
    expect(uraninite!.layers).toEqual([{ path: STONE }, { path: B + 'DULL/ore.png', tint: [35, 35, 35], glow: true }, { path: B + 'DULL/ore_OVERLAY.png', glow: true }]);
    expect(phobos).toMatchObject({ source: 'gt', layers: [{ path: B + 'METALLIC/ore.png', tint: [200, 200, 220] }] });
  });

  it('leaves an unknown stone, material or ore icon, another block and a dump without ores to the fallback', () => {
    expect(resolveIcons(ores, [`${O}@3032`, `${O}@999`, `${O}@5`, 'gregtech:gt.blockores3@32']).map((d) => d.source))
      .toEqual(['fallback', 'fallback', 'fallback', 'fallback']);
    const { ores: _, ...withoutOres } = oreFile;
    expect(resolveIcons({ ...ores, dump: buildTexturesDump(withoutOres, oreIndex) }, [`${O}@32`])[0]!.source).toBe('fallback');
  });
});

describe('resolveIcons', () => {
  it('prefers NEI, then GT, then jar texture names, then block faces', () => {
    const nei = { icon: (k: string) => (k === 't:iron_ingot@0' ? { path: 'nei/icons/adc999ea62bc5836.png' } : null) };
    const [a, b, c, d, e] = resolveIcons({ ...src, nei }, ['t:iron_ingot@0', 'gregtech:gt.metaitem.01@11032', 't:iron_ingot@1', `${GT}@301`, 'StorageDrawers:fullDrawers1@0']);
    expect(a).toMatchObject({ source: 'nei', layers: [{ path: 'nei/icons/adc999ea62bc5836.png' }] });
    expect(b).toMatchObject({ source: 'gt', layers: [{ path: MI + 'METALLIC/ingot.png', tint: [200, 200, 220] }] });
    expect(c).toMatchObject({ source: 'jar', layers: [{ path: 't/textures/items/iron_ingot.png' }] });
    expect(d).toMatchObject({ source: 'gt', layers: [{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }] });
    expect(e).toMatchObject({ source: 'jar', layers: [{ path: 'storagedrawers/textures/blocks/drawers_oak_front_1.png' }] });
  });

  it('gives fluids their texture or a colour, and items a material or hash colour', () => {
    const [water, oil, copper, plain] = resolveIcons(src, ['fluid:water', 'fluid:oil', 't:mystery@0', 't:plain@0']);
    expect(water).toEqual({ key: 'fluid:water', source: 'gt', layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }], fallbackColor: [0, 0, 255] });
    expect(oil).toEqual({ key: 'fluid:oil', source: 'fallback', layers: [], fallbackColor: hashColor('fluid:oil') });
    expect(copper).toEqual({ key: 't:mystery@0', source: 'fallback', layers: [], fallbackColor: [255, 100, 0] });
    expect(plain).toEqual({ key: 't:plain@0', source: 'fallback', layers: [], fallbackColor: hashColor('t:plain@0') });
  });

  it('gives covers their in-world overlay', () => {
    expect(resolveCovers(src, ['gregtech:gt.metaitem.01@32630', 'x:y@0'])).toEqual([
      { item: 'gregtech:gt.metaitem.01@32630', layers: [{ path: I + 'OVERLAY_CONVEYOR.png' }] }, { item: 'x:y@0', layers: [] }]);
  });

  it('works without a dump and keeps request order and duplicates', () => {
    expect(resolveCovers({ ...src, dump: null }, ['gregtech:gt.metaitem.01@32630'])).toEqual([{ item: 'gregtech:gt.metaitem.01@32630', layers: [] }]);
    expect(resolveIcons({ ...src, dump: null }, ['fluid:water', 'fluid:water']).map((d) => [d.key, d.source])).toEqual([['fluid:water', 'fallback'], ['fluid:water', 'fallback']]);
    expect(resolveBlocks({ ...src, dump: null }, [{ id: 'minecraft:stone', meta: 0 }])[0]!.resolved).toBe(false);
  });

  it('gives malformed keys and failed machines the fallback, and blocks without an item texture their face', () => {
    expect(resolveIcons(src, ['nope', 'x:y@01', `${GT}@999`]).map((d) => [d.key, d.source, d.fallbackColor])).toEqual([
      ['nope', 'fallback', hashColor('nope')], ['x:y@01', 'fallback', hashColor('x:y@01')], [`${GT}@999`, 'fallback', hashColor(`${GT}@999`)]]);
    expect(resolveIcons(src, ['minecraft:stone@0'])[0]).toMatchObject({ source: 'jar', layers: [{ path: 'minecraft/textures/blocks/stone.png' }] });
    expect(resolveIcons(src, ['t:iron_ingot@0'])[0]!.fallbackColor).toEqual([200, 200, 220]);   // the dump's Iron, the pack has no such material
  });
});
