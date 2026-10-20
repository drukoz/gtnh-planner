import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexOf } from '../../helpers/assets-dir.ts';
import { assetIndexFrom, loadAssetIndex, iconPath, AssetIndexError, ASSET_INDEX_FORMAT, type AssetIndexFile } from '../../../src/server/assets/index.ts';
import type { LayerRegion } from '../../../src/shared/types/assets.ts';

const FILE: AssetIndexFile = {
  format: ASSET_INDEX_FORMAT, createdAt: '2026-10-17T00:00:00.000Z', sources: [], conflicts: [], identicalDuplicates: 0,
  files: {
    'gregtech/textures/blocks/fluids/fluid.water.png': { w: 16, h: 64, frames: 4, jar: 'gregtech.jar' },
    'minecraft/textures/blocks/stone.png': { w: 16, h: 16, jar: 'client.jar' },
  },
};

describe('asset index', () => {
  it('maps icon names to files', () => {
    expect(iconPath('StorageDrawers:drawers_oak_front_1', 'blocks')).toBe('storagedrawers/textures/blocks/drawers_oak_front_1.png');
    expect(iconPath('stone', 'blocks')).toBe('minecraft/textures/blocks/stone.png');
    expect(iconPath('gregtech:gt.metaitem.01/123', 'items')).toBe('gregtech/textures/items/gt.metaitem.01/123.png');
    expect(iconPath(':apple', 'items')).toBe('minecraft/textures/items/apple.png');
  });

  it('builds layers only for extracted files', () => {
    const ix = assetIndexFrom(FILE);
    expect(ix.size).toBe(2);
    expect(ix.layer('gregtech/textures/blocks/fluids/fluid.water.png', { tint: [255, 255, 255] }))
      .toEqual({ path: 'gregtech/textures/blocks/fluids/fluid.water.png', frames: 4 });
    expect(ix.layer('minecraft/textures/blocks/stone.png', { tint: [10, 20, 30], glow: true }))
      .toEqual({ path: 'minecraft/textures/blocks/stone.png', tint: [10, 20, 30], glow: true });
    expect(ix.layer('gregtech/textures/blocks/iconsets/NOPE.png')).toBeNull();
    expect(ix.firstLayer(['a/textures/blocks/x.png', 'minecraft/textures/blocks/stone.png'])).toEqual({ path: 'minecraft/textures/blocks/stone.png' });
    expect(ix.firstLayer(['a/textures/blocks/x.png'])).toBeNull();
  });

  it('puts a copy of the region on the layer', () => {
    const ix = assetIndexFrom(FILE);
    const region: LayerRegion = { sheet: 64, src: [14, 33, 14, 10], dst: [1, 6, 14, 10] };
    const layer = ix.firstLayer(['a/textures/blocks/x.png', 'minecraft/textures/blocks/stone.png'], { tint: [10, 20, 30], region })!;
    expect(layer).toEqual({ path: 'minecraft/textures/blocks/stone.png', tint: [10, 20, 30], region: { sheet: 64, src: [14, 33, 14, 10], dst: [1, 6, 14, 10] } });
    region.src[0] = 99;
    region.dst![0] = 99;
    expect([layer.region!.src[0], layer.region!.dst![0]]).toEqual([14, 1]);
    expect(Object.keys(ix.layer('minecraft/textures/blocks/stone.png', { region: { sheet: 16, src: [4, 0, 8, 8] } })!.region!)).toEqual(['sheet', 'src']);
  });

  it('frames are always square, also in an index written before the fix', () => {
    const biomass = 'forestry/textures/blocks/liquid/biomass_still.png';
    expect(indexOf({ [biomass]: { w: 16, h: 512, frames: 16 } }).layer(biomass)).toEqual({ path: biomass, frames: 32 });
    const square = 'x/textures/blocks/square.png';   // an old index counted two frames of `"height": 16`
    expect(indexOf({ [square]: { w: 32, h: 32, frames: 2 } }).layer(square)).toEqual({ path: square });
  });

  it('loads from disk, empty when missing, error on a foreign file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-ix-'));
    expect((await loadAssetIndex(dir)).size).toBe(0);
    await writeFile(join(dir, 'index.json'), JSON.stringify(FILE));
    expect((await loadAssetIndex(dir)).has('minecraft/textures/blocks/stone.png')).toBe(true);
    await writeFile(join(dir, 'index.json'), JSON.stringify({ ...FILE, format: 'other/1' }));
    await expect(loadAssetIndex(dir)).rejects.toBeInstanceOf(AssetIndexError);
  });
});
