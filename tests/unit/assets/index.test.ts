import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetIndexFrom, loadAssetIndex, iconPath, AssetIndexError, ASSET_INDEX_FORMAT, type AssetIndexFile } from '../../../src/server/assets/index.ts';

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

  it('loads from disk, empty when missing, error on a foreign file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-ix-'));
    expect((await loadAssetIndex(dir)).size).toBe(0);
    await writeFile(join(dir, 'index.json'), JSON.stringify(FILE));
    expect((await loadAssetIndex(dir)).has('minecraft/textures/blocks/stone.png')).toBe(true);
    await writeFile(join(dir, 'index.json'), JSON.stringify({ ...FILE, format: 'other/1' }));
    await expect(loadAssetIndex(dir)).rejects.toBeInstanceOf(AssetIndexError);
  });
});
