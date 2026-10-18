// Map tiles in memory, least recently used first out: one fetch per tile even when several views ask at once, and the
// surface height of any column whose surface tile is cached (the note dialog's y).

import { tileOf, TILE_SIZE, type MapTile } from '../../shared/types/world.ts';
import { worldApi } from './api.ts';

/** The `y` of a surface tile: the first block from the top of the world down. */
export const SURFACE_Y = 255;

export interface TileKey { scanId: string; dim: number; tx: number; tz: number; y: number }
export interface TileCache {
  get(k: TileKey): MapTile | undefined;
  load(k: TileKey): Promise<MapTile>;
  surfaceY(scanId: string, dim: number, x: number, z: number): number | null;
  clear(): void;
}

/** One string per tile key, for maps and sets. */
export function tileKeyId(k: TileKey): string {
  return `${k.scanId}|${k.dim}|${k.tx}|${k.tz}|${k.y}`;
}

/** Sets `key` as the most recently used entry of `lru` (a Map in use order) and drops the oldest beyond `max`. */
export function lruSet<K, V>(lru: Map<K, V>, key: K, value: V, max: number): void {
  lru.delete(key);
  lru.set(key, value);
  for (const oldest of lru.keys()) {
    if (lru.size <= max) break;
    lru.delete(oldest);
  }
}

export function createTileCache(fetchTile: (k: TileKey) => Promise<MapTile>, max = 512): TileCache {
  const tiles = new Map<string, MapTile>();   // least recently used first
  const loading = new Map<string, Promise<MapTile>>();
  let generation = 0;   // a load that started before clear() is not kept
  const remember = (id: string, tile: MapTile): void => lruSet(tiles, id, tile, max);

  const get = (k: TileKey): MapTile | undefined => {
    const id = tileKeyId(k);
    const tile = tiles.get(id);
    if (tile !== undefined) remember(id, tile);
    return tile;
  };

  return {
    get,
    load(k) {
      const hit = get(k);
      if (hit !== undefined) return Promise.resolve(hit);
      const id = tileKeyId(k);
      const pending = loading.get(id);
      if (pending !== undefined) return pending;
      const started = generation;
      const p = fetchTile(k)
        .then((tile) => {
          if (started === generation) remember(id, tile);
          return tile;
        })
        .finally(() => {
          if (loading.get(id) === p) loading.delete(id);
        });
      loading.set(id, p);
      return p;
    },
    surfaceY(scanId, dim, x, z) {
      const tx = tileOf(x), tz = tileOf(z);
      const tile = tiles.get(tileKeyId({ scanId, dim, tx, tz, y: SURFACE_Y }));   // a peek: reading a height is not a use
      if (tile === undefined) return null;
      const height = tile.height[(Math.floor(z) - tz * TILE_SIZE) * TILE_SIZE + Math.floor(x) - tx * TILE_SIZE] ?? 0;
      return height === 0 ? null : height;
    },
    clear() {
      tiles.clear();
      loading.clear();
      generation++;
    },
  };
}

/** The page's tile cache, over `GET /api/world/scans/:id/tiles/:dim/:tx/:tz?y=`. */
export const tileCache: TileCache = createTileCache((k) => worldApi.tile(k.scanId, k.dim, k.tx, k.tz, k.y));
