// RUK-3041: no rain roof where it never rains around the base. GT's rain gate (gt-mechanics §3.4a) checks weather only
// where the biome passes `rainfall > 0 && (lightning || snow)`; RUK-3038 reads that gate as `BiomeInfo.rain`. When every
// column a site of this layout can land among is in a biome where GT never rains, the line lays no roof and names those
// biomes in `Layout.dryBiomes`. `dryBiomes` is the pure gate; the layout tests lay real lines over a dry and a wet ground.
import { describe, it, expect } from 'vitest';
import { AIR_INDEX, UNKNOWN_BLOCK, UNKNOWN_INDEX, type Voxels } from '../../../src/shared/types/world.ts';
import type { BiomeInfo } from '../../../src/shared/types/pack.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import { dryBiomes } from '../../../src/server/layout/rain.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const TABLE: BiomeInfo[] = [
  { id: 1, name: 'Plains', rain: true },
  { id: 2, name: 'Desert', rain: false },
  { id: 17, name: 'DesertHills', rain: false },
  { id: 8, name: 'Hell', rain: false },
];

/** A 3×1×2 box (6 columns): column `i` carries `biomeIds[i]`, an `UNKNOWN_INDEX` voxel at each index in `unknown` and air elsewhere. */
function box(biomeIds: number[], unknown: readonly number[] = []): Voxels {
  return {
    origin: [0, 0, 0], size: [3, 1, 2],
    blocks: Uint32Array.from(biomeIds.map((_, i) => (unknown.includes(i) ? UNKNOWN_INDEX : AIR_INDEX))),
    palette: [{ id: 'minecraft:air', meta: 0 }, UNKNOWN_BLOCK],
    biomes: Int32Array.from(biomeIds),
  };
}

describe('dryBiomes', () => {
  it('names the dry biomes of every column', () => {
    expect(dryBiomes(TABLE, box([2, 2, 2, 2, 2, 2]))).toEqual(['Desert']);
    expect(dryBiomes(TABLE, box([2, 17, 2, 2, 2, 2]))).toEqual(['Desert', 'DesertHills']);
  });

  it('keeps the roof for a raining biome, an id the table lacks, or a read chunk with no biome', () => {
    expect(dryBiomes(TABLE, box([1, 2, 2, 2, 2, 2]))).toBeNull(); // id 1 Plains rains
    expect(dryBiomes(TABLE, box([99, 2, 2, 2, 2, 2]))).toBeNull(); // id 99 not in the table
    expect(dryBiomes(TABLE, box([-1, 2, 2, 2, 2, 2]))).toBeNull(); // −1 over air: a read chunk with no biome is unknown
  });

  it('skips unread chunks (−1 over UNKNOWN_INDEX) and needs at least one dry column', () => {
    expect(dryBiomes(TABLE, box([-1, 8, 8, 8, 8, 8], [0]))).toEqual(['Hell']); // the unread column is skipped
    expect(dryBiomes(TABLE, box([-1, -1, -1, -1, -1, -1], [0, 1, 2, 3, 4, 5]))).toBeNull(); // none dry
  });

  it('keeps the roof without a table, a table with no rows, or a world with no biomes', () => {
    expect(dryBiomes(undefined, box([2, 2, 2, 2, 2, 2]))).toBeNull();
    expect(dryBiomes([], box([2, 2, 2, 2, 2, 2]))).toBeNull();
    const noBiomes: Voxels = { origin: [0, 0, 0], size: [3, 1, 2], blocks: new Uint32Array(6), palette: [{ id: 'minecraft:air', meta: 0 }, UNKNOWN_BLOCK] };
    expect(dryBiomes(TABLE, noBiomes)).toBeNull();
  });
});

describe('no rain roof where it never rains', () => {
  it('lays no roof, no roof step, no roof parts, and names the dry biomes', async () => {
    const { layout } = await lossLine(10, 'direct', { biomes: TABLE, biome: 2 });
    expect(layout.blocks.filter((b) => b.role === 'roof')).toEqual([]);
    expect(layout.buildSteps.some((s) => s.id === 'layout:roof')).toBe(false);
    expect(layout.bom.some((l) => l.why === 'rain roof')).toBe(false);
    expect(layout.dryBiomes).toEqual(['Desert']);
  }, 120000);

  it('keeps the 16-block roof when the biome rains', async () => {
    const { layout } = await lossLine(10, 'direct', { biomes: TABLE, biome: 1 });
    expect(layout.blocks.filter((b) => b.role === 'roof')).toHaveLength(16);
    expect(layout.dryBiomes).toBeUndefined();
  }, 120000);

  it('lays the same layout when the world has no biomes, roof and all', async () => {
    const noBiome = (await lossLine(10, 'direct')).layout;
    const tableOnly = (await lossLine(10, 'direct', { biomes: TABLE })).layout;
    expect(tableOnly).toEqual(noBiome);
    expect(noBiome.dryBiomes).toBeUndefined();
  }, 120000);
});

const codesOf = (l: Layout): Set<string> => new Set(l.warnings.map((w) => w.code));
const RUN_CODES = ['machine_unpowered', 'machine_unreachable', 'route_failed'] as const;

describe('a dry line runs no worse than the roofed one', () => {
  for (const n of [10, 40]) {
    it(`lays a dry ${n}-machine line in every mode with no roof and no new failure`, async () => {
      for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
        const dry = (await lossLine(n, mode, { biomes: TABLE, biome: 2 })).layout;
        const roofed = (await lossLine(n, mode, { biomes: TABLE, biome: 1 })).layout;
        const roofedCodes = codesOf(roofed);
        for (const code of RUN_CODES) {
          expect(codesOf(dry).has(code) && !roofedCodes.has(code), `${n} ${mode}: the dry line adds ${code}`).toBe(false);
        }
        expect(dry.blocks.filter((b) => b.role === 'roof'), `${n} ${mode} lays a roof`).toEqual([]);
      }
    }, 120000);
  }
});
