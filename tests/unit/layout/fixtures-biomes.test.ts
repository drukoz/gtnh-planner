import { describe, expect, it } from 'vitest';
import { areaReader, flatVoxels } from '../../helpers/layout-fixtures.ts';

describe('flatVoxels biomes', () => {
  it('fills every column with the spec biome', () => {
    const vox = flatVoxels({ origin: [0, 60, 0], size: [4, 3, 4], groundY: 61, biome: 2 });
    expect(vox.biomes).toBeDefined();
    expect(vox.biomes!.length).toBe(4 * 4);
    expect(vox.biomes!.every((b) => b === 2)).toBe(true);
  });

  it('leaves biomes absent without a spec biome', () => {
    expect(flatVoxels({ origin: [0, 60, 0], size: [4, 3, 4], groundY: 61 }).biomes).toBeUndefined();
  });
});

describe('areaReader biomes', () => {
  it('copies the biome per column, −1 outside the area', async () => {
    const vox = flatVoxels({ origin: [0, 60, 0], size: [4, 1, 4], groundY: 60, biome: 2 });
    const read = areaReader(vox);
    const v = await read(0, { minX: -1, minY: 60, minZ: -1, maxX: 4, maxY: 60, maxZ: 4 });
    expect(v.biomes!.length).toBe(6 * 6);
    const biome = (x: number, z: number) => v.biomes![(z - -1) * v.size[0] + (x - -1)];
    for (let z = -1; z <= 4; z++) {
      for (let x = -1; x <= 4; x++) {
        const inside = x >= 0 && x < 4 && z >= 0 && z < 4;
        expect(biome(x, z)).toBe(inside ? 2 : -1);
      }
    }
  });

  it('leaves biomes absent when the area has none', async () => {
    const read = areaReader(flatVoxels({ origin: [0, 60, 0], size: [4, 1, 4], groundY: 60 }));
    const v = await read(0, { minX: 0, minY: 60, minZ: 0, maxX: 3, maxY: 60, maxZ: 3 });
    expect(v.biomes).toBeUndefined();
  });
});
