// Map geometry and tile shading (spec §3.4b): pure functions over a `MapViewport`, so they run in tests without a DOM.
// Screen coordinates are CSS pixels from the canvas's top-left corner; world x grows to the right, world z downwards.

import { AIR_INDEX, TILE_SIZE, UNKNOWN_INDEX, type MapTile } from '../../shared/types/world.ts';
import type { MapViewport } from './types.ts';

export const MIN_PPB = 0.25;
export const MAX_PPB = 32;

const CHUNK = 16;
/** Chunk borders are drawn from this zoom on; below it they would cover the map. */
const GRID_MIN_PPB = 2;
const BRIGHTER = 1.12;
const DARKER = 0.86;

/** The browser has no pack data, so other dimensions go by their folder name. */
export function dimLabel(dim: number): string {
  if (dim === 0) return 'Overworld';
  if (dim === -1) return 'Nether';
  if (dim === 1) return 'The End';
  return `DIM${dim}`;
}

export function worldToScreen(v: MapViewport, x: number, z: number): [number, number] {
  return [(x - v.centerX) * v.pixelsPerBlock + v.width / 2, (z - v.centerZ) * v.pixelsPerBlock + v.height / 2];
}

export function screenToWorld(v: MapViewport, px: number, py: number): [number, number] {
  return [(px - v.width / 2) / v.pixelsPerBlock + v.centerX, (py - v.height / 2) / v.pixelsPerBlock + v.centerZ];
}

/** The tiles covering the world area `[left, right) × [top, bottom)` of the view, row-major by tz then tx. */
export function visibleTiles(v: MapViewport): Array<[number, number]> {
  if (v.width <= 0 || v.height <= 0) return [];
  const [left, top] = screenToWorld(v, 0, 0);
  const [right, bottom] = screenToWorld(v, v.width, v.height);
  const tiles: Array<[number, number]> = [];
  for (let tz = Math.floor(top / TILE_SIZE); tz * TILE_SIZE < bottom; tz++) {
    for (let tx = Math.floor(left / TILE_SIZE); tx * TILE_SIZE < right; tx++) tiles.push([tx, tz]);
  }
  return tiles;
}

/** Zooms by `factor` (clamped to MIN_PPB..MAX_PPB) keeping the world point under the screen point (px, py) in place. */
export function zoomAt(v: MapViewport, px: number, py: number, factor: number): MapViewport {
  const pixelsPerBlock = Math.min(MAX_PPB, Math.max(MIN_PPB, v.pixelsPerBlock * factor));
  const [wx, wz] = screenToWorld(v, px, py);
  return { ...v, pixelsPerBlock, centerX: wx - (px - v.width / 2) / pixelsPerBlock, centerZ: wz - (py - v.height / 2) / pixelsPerBlock };
}

/** Moves the map content by (dxPx, dyPx) screen pixels, as a drag does. */
export function panBy(v: MapViewport, dxPx: number, dyPx: number): MapViewport {
  return { ...v, centerX: v.centerX - dxPx / v.pixelsPerBlock, centerZ: v.centerZ - dyPx / v.pixelsPerBlock };
}

/**
 * Writes the 64×64 RGBA image of `tile` into `out` (column `lz·64 + lx`, as the tile stores it). `colors` holds a
 * packed 0xRRGGBB per palette index. Air is transparent; unknown columns (chunks that were not read) take their colour
 * as it is; any other column is brightened ×1.12 when higher than its north neighbour (`lz − 1`), darkened ×0.86 when
 * lower and left as it is on row 0.
 */
export function shadeTile(tile: MapTile, colors: Uint32Array, out: Uint8ClampedArray): void {
  const unknown = colors[UNKNOWN_INDEX] ?? 0;
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const index = tile.top[i]!;
    const o = i * 4;
    if (index === AIR_INDEX) {
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
      continue;
    }
    const rgb = colors[index] ?? unknown;
    let shade = 1;
    if (index !== UNKNOWN_INDEX && i >= TILE_SIZE) {
      const h = tile.height[i]!, north = tile.height[i - TILE_SIZE]!;
      shade = h > north ? BRIGHTER : h < north ? DARKER : 1;
    }
    // Rounded here; the Uint8ClampedArray clamps to 255.
    out[o] = Math.round(((rgb >>> 16) & 0xff) * shade);
    out[o + 1] = Math.round(((rgb >>> 8) & 0xff) * shade);
    out[o + 2] = Math.round((rgb & 0xff) * shade);
    out[o + 3] = 255;
  }
}

/** Screen positions of the chunk borders (block coordinates 16k) inside the view; none below 2 px/block. */
export function chunkGridLines(v: MapViewport): { xs: number[]; zs: number[] } {
  if (v.pixelsPerBlock < GRID_MIN_PPB) return { xs: [], zs: [] };
  const [left, top] = screenToWorld(v, 0, 0);
  const [right, bottom] = screenToWorld(v, v.width, v.height);
  const xs: number[] = [], zs: number[] = [];
  for (let k = Math.ceil(left / CHUNK); k * CHUNK <= right; k++) xs.push(worldToScreen(v, k * CHUNK, 0)[0]);
  for (let k = Math.ceil(top / CHUNK); k * CHUNK <= bottom; k++) zs.push(worldToScreen(v, 0, k * CHUNK)[1]);
  return { xs, zs };
}
