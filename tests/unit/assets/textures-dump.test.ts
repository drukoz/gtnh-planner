import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { indexOf } from '../../helpers/assets-dir.ts';
import { dumpFile, writeTexturesDump } from '../../helpers/textures-dump.ts';
import {
  buildTexturesDump, derivedUnconnected, loadTexturesDump, PREFIX_SUPPLEMENT, resolveDumpLayers, textureSetLayers, TexturesDumpError,
  type DumpFaces, type DumpLayer, type DumpStats,
} from '../../../src/server/assets/textures-dump.ts';

const I = 'gregtech/textures/blocks/iconsets/';
const M = 'gregtech/textures/items/materialicons/';
const FLUID = 'gregtech/textures/blocks/fluids/fluid.water.png';
const ix = indexOf({ [I + 'MACHINE_LV_SIDE.png']: {}, [I + 'MACHINE_LV_TOP.png']: {}, [M + 'METALLIC/ingot.png']: {}, [M + 'NONE/ingot.png']: {},
  [M + 'NONE/ingot_OVERLAY.png']: {}, [M + 'NONE/gearGt.png']: {}, [M + 'NONE/dust.png']: {}, [M + 'SHINY/dust_OVERLAY.png']: {}, [FLUID]: { w: 16, h: 64, frames: 4 } });
const ts = (set: string, s: string): [string, string, string, string] => [`${M}${set}/${s}.png`, `${M}NONE/${s}.png`, `${M}${set}/${s}_OVERLAY.png`, `${M}NONE/${s}_OVERLAY.png`];

const FILE = dumpFile({
  mte: [
    { id: 301, cls: 'MTEBasicMachineWithRecipe', inactive: [
      [{ p: [I + 'MACHINE_LV_BOTTOM.png'] }], [{ p: [I + 'MACHINE_LV_TOP.png'] }],
      [{ p: [I + 'MACHINE_LV_SIDE.png'] }, { p: [I + 'NOT_EXTRACTED.png'] }], [{ p: [I + 'MACHINE_LV_SIDE.png'] }],
      [{ p: [I + 'MACHINE_LV_SIDE.png'] }], [{ err: 'x.Unknown' }, { copy: ['gregtech:gt.blockcasings2', 0, 5] }]] },
    { id: 999, cls: 'Broken', error: 'java.lang.NullPointerException' },
  ],
  fluids: [{ name: 'water', color: -16776961, still: FLUID }, { name: 'oil', color: -14540254 }],
});

describe('texture-set rule (research §6.1)', () => {
  it('keeps override and fallback pairs the way GT draws them', () => {
    expect(textureSetLayers(ts('METALLIC', 'ingot'), [200, 200, 200], ix)).toEqual([{ path: M + 'METALLIC/ingot.png', tint: [200, 200, 200] }]);
    expect(textureSetLayers(ts('METALLIC', 'gearGt'), [200, 200, 200], ix)).toEqual([{ path: M + 'NONE/gearGt.png', tint: [200, 200, 200] }]);
    expect(textureSetLayers(ts('SHINY', 'dust'), [1, 2, 3], ix)).toEqual([{ path: M + 'SHINY/dust_OVERLAY.png' }]);
    expect(textureSetLayers(ts('DULL', 'ingot'), [1, 2, 3], ix)).toEqual([{ path: M + 'NONE/ingot.png', tint: [1, 2, 3] }, { path: M + 'NONE/ingot_OVERLAY.png' }]);
    expect(textureSetLayers(ts('DULL', 'plate'), [1, 2, 3], ix)).toEqual([]);
  });
});

describe('buildTexturesDump', () => {
  it('drops dump layers whose file was not extracted', () => {
    const d = buildTexturesDump(FILE, ix);
    const m = d.mte.get(301)!;
    expect(m.inactive![0]).toEqual([]);
    expect(m.inactive![2]).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(m.inactive![5]).toEqual([{ copy: ['gregtech:gt.blockcasings2', 0, 5] }]);
    expect(m.active).toEqual(m.inactive);
    expect(d.mte.get(999)).toEqual({ cls: 'Broken', pipe: false, inactive: null, active: null, unconnected: null, error: 'java.lang.NullPointerException' });
    expect(d.stats).toEqual({ droppedLayers: 2, errorLayers: 1, missingStill: 0 });
  });

  it('turns fluid colours into RGB and tints the still texture', () => {
    const d = buildTexturesDump(FILE, ix);
    expect(d.fluids.get('water')).toEqual({ color: [0, 0, 255], still: { path: FLUID, tint: [0, 0, 255], frames: 4 } });
    expect(d.fluids.get('oil')).toEqual({ color: [34, 34, 34], still: null });
  });

  it('keeps the fluid\'s block (0.4.0) and counts stills that were not extracted', () => {
    const d = buildTexturesDump(dumpFile({ fluids: [{ name: 'a', color: 0, still: 'gregtech/textures/blocks/fluids/fluid.a.png' },
      { name: 'p', color: -1, block: 'IC2:fluidPahoehoeLava' }] }), indexOf({}));
    expect(d.stats.missingStill).toBe(1);
    expect(d.fluids.get('a')).toStrictEqual({ color: [0, 0, 0], still: null });   // no block key without one
    expect(d.fluids.get('p')).toStrictEqual({ color: [255, 255, 255], still: null, block: 'IC2:fluidPahoehoeLava' });
  });
});

describe('resolveDumpLayers', () => {
  it('tints and lights path layers and splits texture sets', () => {
    const stats: DumpStats = { droppedLayers: 0, errorLayers: 0, missingStill: 0 };
    expect(resolveDumpLayers([{ p: [I + 'NOPE.png', I + 'MACHINE_LV_SIDE.png'], rgb: [10, 20, 30], glow: 1 }, { ts: ts('DULL', 'ingot'), rgb: [1, 2, 3] },
      { ts: ts('DULL', 'plate') }, { p: [I + 'MACHINE_LV_TOP.png'], rgb: [255, 255, 255] }], ix, stats)).toEqual([
      { path: I + 'MACHINE_LV_SIDE.png', tint: [10, 20, 30], glow: true }, { path: M + 'NONE/ingot.png', tint: [1, 2, 3] }, { path: M + 'NONE/ingot_OVERLAY.png' },
      { path: I + 'MACHINE_LV_TOP.png' }]);
    expect(stats).toEqual({ droppedLayers: 1, errorLayers: 0, missingStill: 0 });
  });

  it('counts layers it cannot read as errors (Ruling R7)', () => {
    const stats: DumpStats = { droppedLayers: 0, errorLayers: 0, missingStill: 0 };
    const odd = [{ copy: [null, 0, 2] }, { copy: ['b', 0, 6] }, { x: 1 }, null, { p: I + 'MACHINE_LV_SIDE.png' }, { ts: ['a', 'b'] },
      { p: [I + 'MACHINE_LV_SIDE.png'], rgb: [1, 2] }] as unknown as DumpLayer[];
    expect(resolveDumpLayers(odd, ix, stats)).toEqual([]);
    expect(stats).toEqual({ droppedLayers: 0, errorLayers: 7, missingStill: 0 });
  });
});

describe('buildTexturesDump tables', () => {
  it('indexes materials, meta items, casings, blocks, covers and names', () => {
    const side = (path: string): DumpLayer[][] => Array.from({ length: 6 }, () => [{ p: [path] }]);
    const d = buildTexturesDump(dumpFile({
      sets: [{ name: 'METALLIC', icons: { '11': [{ ts: ts('METALLIC', 'ingot') }] } }],
      materials: [{ name: 'Iron', id: 32, rgba: [200, 200, 220, 0], set: 0 }, { name: 'Air', id: -1, rgba: [255, 255, 255, 0], set: 0 }],
      metaItems: [{ id: 'gregtech:gt.metaitem.01', offset: 32000, unlocalized: 'gt.metaitem.01', prefixes: [{ i: 11, prefix: 'ingot', texture: 11 }] }],
      mte: [{ id: 7, cls: 'MTEPipe', pipe: true, inactive: side(I + 'MACHINE_LV_SIDE.png'), active: side(I + 'MACHINE_LV_TOP.png') }],
      casingPages: [{ id: 16, faces: [[{ copy: ['gregtech:gt.blockcasings2', 0, 0] }]] }],
      blocks: [{ id: 'gregtech:gt.blockcasings2', metas: { '3': side(I + 'MACHINE_LV_TOP.png') } }],
      covers: [{ item: 'gregtech:gt.metaitem.01@32630', layers: [{ p: [I + 'MACHINE_LV_SIDE.png'] }] }],
      textureNames: { blocks: { 'minecraft:stone': 'stone' }, items: { 'minecraft:apple': 'apple' } },
      blockIds: ['minecraft:stone'],
    }), ix);
    expect(d.exporterVersion).toBe('test');
    expect(d.sets[0]!.get(11)).toEqual([{ ts: ts('METALLIC', 'ingot') }]);
    expect(d.materialsById.get(32)).toEqual({ name: 'Iron', id: 32, rgb: [200, 200, 220], set: 0 });
    expect(d.materialsByName.get('Air')!.id).toBe(-1);
    expect(d.materialsById.has(-1)).toBe(false);
    expect(d.metaItems.get('gregtech:gt.metaitem.01')).toEqual({ offset: 32000, unlocalized: 'gt.metaitem.01', prefixes: new Map([[11, { prefix: 'ingot', texture: 11 }]]) });
    const pipe = d.mte.get(7)!;
    expect([pipe.pipe, pipe.inactive![0], pipe.active![0]]).toEqual([true, [{ path: I + 'MACHINE_LV_SIDE.png' }], [{ path: I + 'MACHINE_LV_TOP.png' }]]);
    expect(d.casingPages.get(16)).toEqual([[{ copy: ['gregtech:gt.blockcasings2', 0, 0] }], [], [], [], [], []]);
    expect(d.blocks.get('gregtech:gt.blockcasings2')!.get(3)![1]).toEqual([{ path: I + 'MACHINE_LV_TOP.png' }]);
    expect(d.covers.get('gregtech:gt.metaitem.01@32630')).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect([d.textureNames.blocks.get('minecraft:stone'), d.textureNames.items.get('minecraft:apple')]).toEqual(['stone', 'apple']);
    expect([...d.blockIds]).toEqual(['minecraft:stone']);
    expect(d.stats).toEqual({ droppedLayers: 0, errorLayers: 0, missingStill: 0 });
  });
});

describe('buildTexturesDump ores', () => {
  it('keeps the GT ore blocks with their stones and marks glowing ores; a dump without the part has none', () => {
    const d = buildTexturesDump(dumpFile({
      materials: [{ name: 'Uraninite', id: 922, rgba: [35, 35, 35, 0], set: 0, oreGlow: 1 }, { name: 'Iron', id: 32, rgba: [200, 200, 220, 0], set: 0 }],
      ores: { ore: 68, oreSmall: 67, smallOffset: 16000, naturalOffset: 8000, blocks: [
        { id: 'gregtech:gt.blockores2', stones: [[{ copy: ['minecraft:stone', 0, 0] }], [{ p: [I + 'NOT_EXTRACTED.png'] }], [{ p: [I + 'MACHINE_LV_SIDE.png'] }]] }] },
    }), ix);
    expect(d.materialsById.get(922)).toEqual({ name: 'Uraninite', id: 922, rgb: [35, 35, 35], set: 0, oreGlow: true });
    expect(d.materialsById.get(32)!.oreGlow).toBeUndefined();
    expect(d.ores).toEqual({ ore: 68, oreSmall: 67, smallOffset: 16000, naturalOffset: 8000, blocks: new Map([['gregtech:gt.blockores2',
      [[{ copy: ['minecraft:stone', 0, 0] }], [], [{ path: I + 'MACHINE_LV_SIDE.png' }]]]]) });
    expect(d.stats).toEqual({ droppedLayers: 1, errorLayers: 0, missingStill: 0 });
    expect(buildTexturesDump(dumpFile(), ix).ores).toBeNull();
  });
});

describe('pipe sides with nothing connected (RC9)', () => {
  const MB = 'gregtech/textures/blocks/materialicons/';
  const tsOf = (root: string, set: string, n: string): { ts: [string, string, string, string] } =>
    ({ ts: [`${root}${set}/${n}.png`, `${root}NONE/${n}.png`, `${root}${set}/${n}_OVERLAY.png`, `${root}NONE/${n}_OVERLAY.png`] });
  const wire: DumpLayer = { ...tsOf(MB, 'SHINY', 'wire'), rgb: [255, 120, 20] };
  const pipeTiny: DumpLayer = { ...tsOf(MB, 'DULL', 'pipeTiny'), rgb: [220, 220, 220] };

  it('derives full insulation for insulated cables and pipeSide for pipes; bare wires already match the game', () => {
    const insulated: DumpLayer[] = [wire, { p: ['gregtech/textures/blocks/iconsets/INSULATION_HUGE.png'], rgb: [64, 64, 64] }];
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map(() => insulated) as DumpFaces)![2])
      .toEqual([{ p: ['gregtech/textures/blocks/iconsets/INSULATION_FULL.png'], rgb: [64, 64, 64] }]);
    const eightX: DumpLayer[] = [wire, { p: ['gregtech/textures/blocks/iconsets/INSULATION_MEDIUM_PLUS.png'], rgb: [70, 60, 50] }];   // every 8x cable (1209, 1249, …)
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map(() => eightX) as DumpFaces)![3])
      .toEqual([{ p: ['gregtech/textures/blocks/iconsets/INSULATION_FULL.png'], rgb: [70, 60, 50] }]);
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map((): DumpLayer[] => [{ ...tsOf(MB, 'SHINY', 'pipeTiny'), rgb: [255, 233, 0] }]) as DumpFaces)![0])
      .toEqual([{ ...tsOf(MB, 'SHINY', 'pipeSide'), rgb: [255, 233, 0] }]);
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map(() => [wire]) as DumpFaces)).toBeNull();
  });

  it('rewrites only the pipe template; other layers, sides without a rule, frames and fully insulated cables stay', () => {
    const restrictor: DumpLayer = { p: ['gregtech/textures/blocks/iconsets/PIPE_RESTRICTOR.png'] };
    expect(derivedUnconnected([[pipeTiny, restrictor], [wire], [], [{ ...tsOf(MB, 'NONE', 'pipeQuadruple'), rgb: [1, 2, 3] }],
      [tsOf(MB, 'NONE', 'pipeNonuple')], [{ err: 'x.Unknown' }]])).toEqual([
      [{ ...tsOf(MB, 'DULL', 'pipeSide'), rgb: [220, 220, 220] }, restrictor], [wire], [], [{ ...tsOf(MB, 'NONE', 'pipeSide'), rgb: [1, 2, 3] }],
      [tsOf(MB, 'NONE', 'pipeSide')], [{ err: 'x.Unknown' }]]);
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map((): DumpLayer[] => [{ ...tsOf(MB, 'SHINY', 'frameGt'), rgb: [9, 9, 9] }]))).toBeNull();
    expect(derivedUnconnected([0, 1, 2, 3, 4, 5].map((): DumpLayer[] => [{ p: ['gregtech/textures/blocks/iconsets/INSULATION_FULL.png'], rgb: [64, 64, 64] }])))
      .toBeNull();
    expect(derivedUnconnected([null, [null], [{ p: 'x' }], [{ ts: ['a'] }]] as unknown as DumpFaces)).toBeNull();
  });

  it('a 0.3.0 dump derives pipe sides', () => {
    const pipeIx = indexOf({ [MB + 'NONE/pipeTiny.png']: {}, [MB + 'NONE/pipeSide.png']: {}, 'x/textures/blocks/given.png': {} });
    const inactive: DumpFaces = [0, 1, 2, 3, 4, 5].map(() => [pipeTiny]);
    const d = buildTexturesDump(dumpFile({ mte: [{ id: 5589, cls: 'MTEItemPipe', pipe: true, inactive },
      { id: 1240, cls: 'MTECable', pipe: true, inactive: [0, 1, 2, 3, 4, 5].map(() => [wire]) },
      { id: 301, cls: 'MTEBasicMachine', inactive }] }), pipeIx);   // the same faces on a machine that is no pipe
    expect(d.mte.get(5589)!.unconnected![2]).toEqual([{ path: MB + 'NONE/pipeSide.png', tint: [220, 220, 220] }]);
    expect(d.mte.get(5589)!.inactive![2]).toEqual([{ path: MB + 'NONE/pipeTiny.png', tint: [220, 220, 220] }]);
    expect([d.mte.get(1240)!.unconnected, d.mte.get(301)!.unconnected]).toEqual([null, null]);
    const given = buildTexturesDump(dumpFile({ mte: [{ id: 5589, cls: 'MTEItemPipe', pipe: true, inactive,
      unconnected: [0, 1, 2, 3, 4, 5].map(() => [{ p: ['x/textures/blocks/given.png'] }]) }] }), pipeIx);
    expect(given.mte.get(5589)!.unconnected![2]).toEqual([{ path: 'x/textures/blocks/given.png' }]);   // 0.4.0's own faces win
  });
});

describe('prefix table (RC4)', () => {
  const metaItems = [{ id: 'gregtech:gt.metaitem.01', offset: 32000, unlocalized: 'gt.metaitem.01', prefixes: [{ i: 2, prefix: 'dust', texture: 2 }] }];

  it('takes the X32 lists, then the supplement; a 0.4.0 table is the whole table', () => {
    const derived = buildTexturesDump(dumpFile({ metaItems }), ix).prefixTextures;
    expect([derived.get('dust'), derived.get('frameGt'), derived.get('cellMolten')]).toEqual([2, 83, 31]);
    const given = buildTexturesDump(dumpFile({ metaItems, prefixTextures: { frameGt: 99 } }), ix).prefixTextures;
    expect(given.get('frameGt')).toBe(99);
    expect(given.get('dust')).toBeUndefined();   // the file's table is the whole table
  });

  it('keeps an X32 list\'s own index over the supplement, and names the sets in order', () => {
    expect(PREFIX_SUPPLEMENT).toEqual({ cellMolten: 31, cellSteamCracked1: 30, cellSteamCracked2: 30, cellSteamCracked3: 30, cellHydroCracked1: 30,
      cellHydroCracked2: 30, cellHydroCracked3: 30, frameGt: 83, sheetmetal: 86, ore: 68, oreSmall: 67 });
    const own = buildTexturesDump(dumpFile({ metaItems: [{ ...metaItems[0]!, prefixes: [{ i: 30, prefix: 'ore', texture: 70 }] }] }), ix);
    expect(own.prefixTextures.get('ore')).toBe(70);
    expect(buildTexturesDump(dumpFile({ sets: [{ name: 'METALLIC', icons: {} }, { name: 'FLUID', icons: {} }] }), ix).setNames).toEqual(['METALLIC', 'FLUID']);
  });
});

describe('loadTexturesDump', () => {
  it('loads the file, ignores a missing or failed dump, rejects anything else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-td-'));
    expect(await loadTexturesDump(dir, ix)).toBeNull();
    await writeTexturesDump(dir, FILE);
    expect((await loadTexturesDump(dir, ix))!.mte.size).toBe(2);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: ['textures'], skippedSections: [] }));
    expect(await loadTexturesDump(dir, ix)).toBeNull();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: [], skippedSections: [] }));
    await writeTexturesDump(dir, { ...FILE, format: 'other/1' as never });
    await expect(loadTexturesDump(dir, ix)).rejects.toBeInstanceOf(TexturesDumpError);
    await writeFile(join(dir, 'textures.json.gz'), 'not gzip');
    await expect(loadTexturesDump(dir, ix)).rejects.toBeInstanceOf(TexturesDumpError);
  });
});

describe('loadTexturesDump errors', () => {
  it('treats a skipped section like a failed one and names the file it rejects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-td-'));
    await writeTexturesDump(dir, FILE);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: [], skippedSections: ['textures'] }));
    expect(await loadTexturesDump(dir, ix)).toBeNull();
    await writeFile(join(dir, 'manifest.json'), '{broken');
    await expect(loadTexturesDump(dir, ix)).rejects.toThrow(join(dir, 'manifest.json'));
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: ['structures'] }));
    expect((await loadTexturesDump(dir, ix))!.mte.size).toBe(2);
    await writeFile(join(dir, 'textures.json.gz'), gzipSync('{"format":'));
    await expect(loadTexturesDump(dir, ix)).rejects.toThrow(`${join(dir, 'textures.json.gz')}: not valid JSON`);
    await writeFile(join(dir, 'textures.json.gz'), gzipSync(JSON.stringify({ format: 'gtnh-planner-textures/1' })));
    await expect(loadTexturesDump(dir, ix)).rejects.toThrow(`${join(dir, 'textures.json.gz')}: unexpected content`);
  });
});
