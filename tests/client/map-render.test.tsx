import { describe, it, expect } from 'vitest';
import { chunkGridLines, dimLabel, MAX_PPB, MIN_PPB, panBy, screenToWorld, shadeTile, visibleTiles, worldToScreen, zoomAt } from '../../src/client/map/render.ts';
import { packRgb } from '../../src/client/map/palette.ts';
import type { MapViewport } from '../../src/client/map/types.ts';
import { AIR_INDEX, TILE_SIZE, UNKNOWN_INDEX, type MapTile } from '../../src/shared/types/world.ts';

const v: MapViewport = { dim: 0, centerX: -100.5, centerZ: 200, pixelsPerBlock: 4, width: 800, height: 600, y: 255 };

/** Every column is palette `index`; row `lz` has height `rows[lz]`, rows past the list 64. */
function tileWithRows(rows: number[], index: number): MapTile {
  const top = new Uint32Array(TILE_SIZE * TILE_SIZE).fill(index);
  const height = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let lz = 0; lz < TILE_SIZE; lz++) height.fill(rows[lz] ?? 64, lz * TILE_SIZE, (lz + 1) * TILE_SIZE);
  return { dim: 0, tx: 0, tz: 0, size: TILE_SIZE, top, height };
}

const rgbaAt = (out: Uint8ClampedArray, lx: number, lz: number): number[] => Array.from(out.subarray((lz * TILE_SIZE + lx) * 4, (lz * TILE_SIZE + lx) * 4 + 4));

describe('map geometry', () => {
  it('round-trips negative world coordinates', () => {
    expect(worldToScreen(v, -100.5, 200)).toEqual([400, 300]);
    expect(screenToWorld(v, 0, 0)).toEqual([-200.5, 125]);
    const [px, py] = worldToScreen(v, -1234.25, -7);
    expect(screenToWorld(v, px, py)).toEqual([-1234.25, -7]);
  });

  it('lists the tiles covering the view', () =>
    expect(visibleTiles({ ...v, centerX: 0, centerZ: 0, pixelsPerBlock: 1, width: 128, height: 128 })).toEqual([[-1, -1], [0, -1], [-1, 0], [0, 0]]));

  it('lists no tile for an empty view and one tile for a view inside it', () => {
    expect(visibleTiles({ ...v, width: 0, height: 0 })).toEqual([]);
    expect(visibleTiles({ ...v, centerX: 32, centerZ: 32, pixelsPerBlock: 1, width: 10, height: 10 })).toEqual([[0, 0]]);
  });

  it('zooms around the cursor and clamps', () => {
    const before = screenToWorld(v, 100, 100), z = zoomAt(v, 100, 100, 2);
    expect(z.pixelsPerBlock).toBe(8);
    expect(screenToWorld(z, 100, 100)[0]).toBeCloseTo(before[0], 9);
    expect(screenToWorld(z, 100, 100)[1]).toBeCloseTo(before[1], 9);
    expect(zoomAt({ ...v, pixelsPerBlock: 32 }, 0, 0, 2).pixelsPerBlock).toBe(MAX_PPB);
    expect(zoomAt({ ...v, pixelsPerBlock: 0.3 }, 0, 0, 0.5).pixelsPerBlock).toBe(MIN_PPB);
  });

  it('pans so the map follows the pointer', () => {
    const p = panBy(v, 40, -20);
    expect([p.centerX, p.centerZ]).toEqual([-110.5, 205]);
    expect(worldToScreen(p, -100.5, 200)).toEqual([440, 280]);
  });

  it('draws chunk borders only from 2 px/block', () => {
    expect(chunkGridLines({ ...v, centerX: 0, centerZ: 0, pixelsPerBlock: 2, width: 64, height: 64 }).xs).toEqual([0, 32, 64]);
    expect(chunkGridLines({ ...v, centerX: 0, centerZ: 8, pixelsPerBlock: 2, width: 64, height: 32 }).zs).toEqual([0, 32]);
    expect(chunkGridLines({ ...v, pixelsPerBlock: 1 })).toEqual({ xs: [], zs: [] });
  });

  it('names the dimensions the browser knows without pack data', () => {
    expect([dimLabel(0), dimLabel(-1), dimLabel(1), dimLabel(7), dimLabel(-28)]).toEqual(['Overworld', 'Nether', 'The End', 'DIM7', 'DIM-28']);
  });
});

describe('shadeTile', () => {
  it('shades by height against the north neighbour; air is transparent', () => {
    const tile = tileWithRows([64, 65, 63], 2);   // top = palette 2 (grey) everywhere; row r height from the list, later rows 64
    tile.top[5] = AIR_INDEX; tile.height[5] = 0;   // row 0, column 5 is air
    const colors = new Uint32Array([0, packRgb([32, 32, 36]), packRgb([128, 128, 128])]);
    const out = new Uint8ClampedArray(64 * 64 * 4); shadeTile(tile, colors, out);
    expect(Array.from(out.subarray(0, 4))).toEqual([128, 128, 128, 255]);                 // row 0
    expect(Array.from(out.subarray(64 * 4, 64 * 4 + 4))).toEqual([143, 143, 143, 255]);   // row 1: higher
    expect(Array.from(out.subarray(128 * 4, 128 * 4 + 4))).toEqual([110, 110, 110, 255]); // row 2: lower
    expect(out[5 * 4 + 3]).toBe(0);                                                       // air column
    expect(rgbaAt(out, 0, 4)).toEqual([128, 128, 128, 255]);                              // same height as the north column
  });

  it('draws unknown columns in their own colour, unshaded, and clamps brightening', () => {
    const tile = tileWithRows([64, 70], 2);
    tile.top[TILE_SIZE + 3] = UNKNOWN_INDEX; tile.height[TILE_SIZE + 3] = 0;   // row 1, column 3: a chunk that was not read
    const colors = new Uint32Array([0, packRgb([32, 32, 36]), packRgb([250, 10, 128])]);
    const out = new Uint8ClampedArray(64 * 64 * 4); shadeTile(tile, colors, out);
    expect(rgbaAt(out, 3, 1)).toEqual([32, 32, 36, 255]);
    expect(rgbaAt(out, 0, 1)).toEqual([255, 11, 143, 255]);   // 250·1.12 clamps to 255, 10·1.12 rounds to 11
  });
});
