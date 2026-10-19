// Texture tiles of the 3D view (Plan 5 Task 14; spec §3.8, web-stack §8): every face is one TILE × TILE RGBA image whose
// layers are blended exactly as Plan 3 blends an item icon, and all the tiles of a scene are packed one after the other
// for the array texture. Pure: no DOM and no three.js, so it runs in tests as in the browser.

import type { Rgb } from '../../shared/types/assets.ts';
import { compositeLayers, solidPixels, type LayerPixels } from '../assets/composite.ts';

/** Edge length (px) of one tile; every texture is cut to its first animation frame at this size. */
export const TILE = 16;
/** Bytes in one tile: `TILE × TILE` RGBA. */
const TILE_BYTES = TILE * TILE * 4;

/** One texture layer's pixels: `TILE × TILE` straight (not premultiplied) RGBA, animation frame 0. */
export interface TileImage { data: Uint8ClampedArray }

/**
 * The layers of a face blended into one tile, bottom to top: Plan 3's `compositeLayers` over the entries that are not
 * `null` (a layer whose image did not load), each with its own tint — straight-alpha source-over, the tint multiplying
 * RGB first — so icons and 3D faces blend alike. `null` when there is nothing to draw.
 */
export function compositeTile(images: ReadonlyArray<{ image: TileImage; tint?: Rgb } | null>): Uint8ClampedArray | null {
  const layers: LayerPixels[] = [];
  for (const entry of images) {
    if (entry === null) continue;
    layers.push({ data: entry.image.data, width: TILE, height: TILE, ...(entry.tint === undefined ? {} : { tint: entry.tint }) });
  }
  return layers.length === 0 ? null : compositeLayers(TILE, layers);
}

/** An opaque tile of one colour: a face with no texture (spec §3.8's plain-colour fallback). */
export function solidTile(color: Rgb): Uint8ClampedArray {
  return solidPixels(TILE, color);
}

/** The tiles one after the other, `TILE · TILE · 4` bytes each — the data of the array texture, one layer per tile. */
export function packTiles(tiles: readonly Uint8ClampedArray[]): Uint8Array {
  const packed = new Uint8Array(tiles.length * TILE_BYTES);
  for (const [index, tile] of tiles.entries()) {
    // a tile of another size would shift every later layer
    if (tile.length !== TILE_BYTES) throw new RangeError(`tile ${index} has ${tile.length} bytes, expected ${TILE_BYTES} (${TILE}×${TILE} RGBA)`);
    packed.set(tile, index * TILE_BYTES);
  }
  return packed;
}

/** How bright a block game draws each side, by ForgeDirection: down 0.5, up 1, north and south 0.8, west and east 0.6. */
const SHADES: readonly number[] = [0.5, 1, 0.8, 0.8, 0.6, 0.6];

/** The brightness (0..1) a cube side is drawn with. */
export function shadeFor(side: number): number {
  const shade = SHADES[side];
  if (shade === undefined) throw new RangeError(`a side is a ForgeDirection 0..5, got ${side}`);
  return shade;
}
