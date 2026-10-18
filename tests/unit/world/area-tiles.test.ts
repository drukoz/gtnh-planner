import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBlockReader, MAX_AREA_VOXELS, readAreaVoxels, regionStoreFromDir, regionStoreFromFiles, type AreaInput, type MteLookup } from '../../../src/server/world/area.ts';
import { openDirWorld } from '../../../src/server/world/files.ts';
import { addChunkToPalette, createPalette, GT_MACHINE_BLOCK, refAt, renderTile } from '../../../src/server/world/tiles.ts';
import type { BlockRef } from '../../../src/shared/types/pack.ts';
import { UNKNOWN_BLOCK, UNKNOWN_INDEX } from '../../../src/shared/types/world.ts';
import { DEFAULT_BLOCK_IDS, makeWorld } from '../../helpers/make-world.ts';

// World: chunk (0,0) EID with stone at y=60 (x 0..15, z 0..15) and gt.blockmachines meta 0 at (1,61,0);
//        chunk (-1,-1) legacy with stone at y=10 (x -16..-1, z -16..-1). Nothing else exists.
const mteAt: MteLookup = (d, x, y, z) => (d === 0 && x === 1 && y === 61 && z === 0 ? 2002 : undefined);
const AIR: BlockRef = { id: 'minecraft:air', meta: 0 };
const STONE: BlockRef = { id: 'minecraft:stone', meta: 0 };
const GT: BlockRef = { id: GT_MACHINE_BLOCK, meta: 0, mteId: 2002 };

let dir: string, worldDir: string, input: AreaInput;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gp-area-'));
  ({ worldDir } = await makeWorld(dir, { dims: { 0: [
    { cx: 0, cz: 0, fill: [{ from: [0, 60, 0], to: [15, 60, 15], block: 'minecraft:stone' }, { from: [1, 61, 0], to: [1, 61, 0], block: GT_MACHINE_BLOCK }] },
    { cx: -1, cz: -1, format: 'legacy', fill: [{ from: [-16, 10, -16], to: [-1, 10, -1], block: 'minecraft:stone' }] },
  ] } }));
  const blockNames = new Map(Object.entries(DEFAULT_BLOCK_IDS).map(([name, id]) => [id, name]));
  input = { reader: createBlockReader(regionStoreFromFiles(await openDirWorld(worldDir))), blockNames, mteAt };
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('block reader', () => {
  it('reads blocks in both formats, across the 0/-1 border, and reports missing chunks', async () => {
    const r = createBlockReader(regionStoreFromFiles(await openDirWorld(worldDir)));
    expect(await r.blockAt(0, -1, 10, -1)).toEqual({ id: 1, meta: 0 });
    expect(await r.blockAt(0, -1, 11, -1)).toEqual({ id: 0, meta: 0 });
    expect(await r.blockAt(0, 0, 60, 0)).toEqual({ id: 1, meta: 0 });
    expect(await r.blockAt(0, 0, 300, 0)).toEqual({ id: 0, meta: 0 });
    expect(await r.blockAt(0, 100, 60, 100)).toBeNull();
  });

  it('reads the same chunks from a regions folder, and evicts old chunks and regions', async () => {
    const r = createBlockReader(regionStoreFromDir(worldDir), { maxChunks: 1, maxRegions: 1 });
    expect(await r.blockAt(0, 0, 60, 0)).toEqual({ id: 1, meta: 0 });
    expect(await r.blockAt(0, -1, 10, -1)).toEqual({ id: 1, meta: 0 });
    expect(await r.blockAt(0, 0, 60, 0)).toEqual({ id: 1, meta: 0 });
    expect(await r.blockAt(1, 0, 60, 0)).toBeNull();
  });
});

describe('readAreaVoxels', () => {
  it('reads an area into voxels with a local palette and GT machine ids', async () => {
    const v = await readAreaVoxels(input, 0, { minX: -2, minY: 59, minZ: -1, maxX: 1, maxY: 61, maxZ: 0 });
    const at = (x: number, y: number, z: number) => v.palette[v.blocks[((y - 59) * 2 + (z + 1)) * 4 + (x + 2)]!];
    expect([v.origin, v.size]).toEqual([[-2, 59, -1], [4, 3, 2]]);
    expect(at(1, 61, 0)).toEqual({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2002 });
    expect(at(0, 60, 0)).toEqual({ id: 'minecraft:stone', meta: 0 });
    expect(at(-1, 60, -1)).toEqual({ id: 'minecraft:air', meta: 0 });
    expect([at(-1, 60, 0), at(0, 60, -1)]).toEqual([UNKNOWN_BLOCK, UNKNOWN_BLOCK]);
  });

  it('refuses areas above MAX_AREA_VOXELS', async () => {
    expect(MAX_AREA_VOXELS).toBe(8_388_608);
    await expect(readAreaVoxels(input, 0, { minX: 0, minY: 0, minZ: 0, maxX: 256, maxY: 255, maxZ: 256 })).rejects.toThrow(RangeError);
  });
});

describe('map tiles', () => {
  it('renders a tile at negative tile coordinates', async () => {
    const pal = createPalette();
    const t = await renderTile(input, pal, 0, -1, -1, 255);
    const stone = pal.index({ id: 'minecraft:stone', meta: 0 });
    expect([t.top[4095], t.height[4095]]).toEqual([stone, 10]);   // x = -1, z = -1
    expect([t.top[3120], t.height[3120]]).toEqual([stone, 10]);   // x = -16, z = -16
    expect([t.top[0], t.height[0]]).toEqual([UNKNOWN_INDEX, 0]);  // x = -64, z = -64: chunk (-4,-4) missing
  });

  it('cuts columns at maxY', async () => {
    const pal = createPalette();
    const col = async (maxY: number) => { const t = await renderTile(input, pal, 0, 0, 0, maxY); return [pal.refs[t.top[1]!], t.height[1]]; };   // x = 1, z = 0
    expect(await col(255)).toEqual([GT, 61]);
    expect(await col(60)).toEqual([STONE, 60]);
    expect(await col(59)).toEqual([AIR, 0]);
  });
});

describe('palette', () => {
  it('a frozen palette maps unseen states to unknown', () =>
    expect(createPalette([AIR, UNKNOWN_BLOCK, STONE], { frozen: true }).index({ id: 'minecraft:dirt', meta: 0 })).toBe(UNKNOWN_INDEX));

  it('de-duplicates by id, meta and mteId, and keeps air first', () => {
    const p = createPalette();
    expect(p.refs).toEqual([AIR, UNKNOWN_BLOCK]);
    const a = p.index(STONE);
    expect(p.index({ id: 'minecraft:stone', meta: 0 })).toBe(a);
    expect(p.index({ id: 'minecraft:stone', meta: 1 })).not.toBe(a);
    expect(p.index({ ...GT })).not.toBe(p.index({ ...GT, mteId: 2003 }));
    expect(p.index({ id: 'minecraft:air', meta: 5 })).toBe(0);
  });

  it('refAt keeps the machine id only on the GregTech machine block', () => {
    expect(refAt('minecraft:stone', 0, 7)).toEqual(STONE);
    expect(Object.keys(refAt('minecraft:stone', 0, 7))).toEqual(['id', 'meta']);
    expect(refAt(GT_MACHINE_BLOCK, 0, 2002)).toEqual(GT);
  });

  it('collects the block states of a chunk, with machine ids', async () => {
    const p = createPalette();
    await addChunkToPalette(input, p, 0, 0, 0);
    await addChunkToPalette(input, p, 0, 50, 50);
    expect(p.refs).toEqual([AIR, UNKNOWN_BLOCK, STONE, GT]);
  });
});
