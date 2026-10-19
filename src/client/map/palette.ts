// Map colours per palette entry (spec §3.4b, §3.8): the average colour of the block's top texture, from Plan 3's block
// faces and texture layers; a fixed colour for blocks whose texture is grey and tinted in game (grass, leaves, water);
// and a colour from the block's name whenever no texture can be had — the map never waits for, or fails on, assets.

import { compositeLayers, type LayerPixels } from '../assets/composite.ts';
import { loadLayerBitmap } from '../assets/texture-image.ts';
import { hashColor, type BlockFaces, type Rgb, type TextureLayer } from '../../shared/types/assets.ts';
import type { BlockRef } from '../../shared/types/pack.ts';

/** Textures are averaged at 16×16 (frame 0 only, cut by loadLayerBitmap). */
export const PALETTE_TEXTURE_SIZE = 16;
/** Blocks per `POST /api/assets/blocks` request (the server takes at most 500). */
export const FACES_BATCH = 200;

const LEAF_GREEN: Rgb = [72, 181, 24];

/** Blocks whose texture is grey and coloured by the biome in game, plus the planner's own "not scanned" block. */
export const OVERRIDE_COLORS: Record<string, Rgb> = {
  'minecraft:grass': [127, 178, 56],
  'minecraft:leaves': LEAF_GREEN,
  'minecraft:leaves2': LEAF_GREEN,
  'minecraft:tallgrass': LEAF_GREEN,
  'minecraft:vine': LEAF_GREEN,
  'minecraft:waterlily': [32, 128, 48],
  'minecraft:water': [63, 118, 228],
  'minecraft:flowing_water': [63, 118, 228],
  'minecraft:lava': [255, 106, 0],
  'minecraft:flowing_lava': [255, 106, 0],
  'gtnh-planner:unknown': [32, 32, 36],
};

const GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines';

/** In order; patterns test the lower-cased block name after the mod id ("Forestry:log1" is a log, not an ore). */
const NAME_RULES: ReadonlyArray<{ test: (name: string, id: string) => boolean; color: Rgb }> = [
  { test: (name) => /stone|cobble|ore/.test(name), color: [125, 125, 125] },
  { test: (name) => /log|wood|planks/.test(name), color: [143, 119, 72] },
  { test: (name) => /sand/.test(name), color: [219, 207, 163] },
  { test: (name) => /dirt/.test(name), color: [134, 96, 67] },
  { test: (name) => /glass/.test(name), color: [192, 220, 235] },
  { test: (_name, id) => id === GT_MACHINE_BLOCK, color: [96, 125, 139] },
  { test: (name) => /casing/.test(name), color: [158, 158, 158] },
];

/** A colour for `ref` without any texture: its override, a name rule, else a stable hash colour of `id@meta`. */
export function fallbackColor(ref: BlockRef): Rgb {
  const override = OVERRIDE_COLORS[ref.id];
  if (override !== undefined) return override;
  const name = ref.id.slice(ref.id.indexOf(':') + 1).toLowerCase();
  return NAME_RULES.find((rule) => rule.test(name, ref.id))?.color ?? hashColor(`${ref.id}@${ref.meta}`);
}

export function packRgb(c: Rgb): number {
  return ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;
}

export function unpackRgb(n: number): Rgb {
  return [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/**
 * The mean colour of the pixels with alpha > 0 after Plan 3's `compositeLayers` (bottom to top, straight alpha, tint
 * multiplies RGB), rounded; null without layers or without such pixels. Every layer must be `w`×`w` with `w` the first
 * layer's width — `compositeLayers` throws a RangeError otherwise.
 */
export function averageTopColor(layers: readonly LayerPixels[]): Rgb | null {
  const first = layers[0];
  if (first === undefined) return null;
  const pixels = compositeLayers(first.width, layers);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    n++;
  }
  return n === 0 ? null : [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** One layer's frame 0 at PALETTE_TEXTURE_SIZE², read back from an OffscreenCanvas; null when the texture did not load. */
export async function layerPixels(layer: TextureLayer): Promise<LayerPixels | null> {
  const bitmap = await loadLayerBitmap(layer, PALETTE_TEXTURE_SIZE);
  if (bitmap === null) return null;
  const canvas = new OffscreenCanvas(PALETTE_TEXTURE_SIZE, PALETTE_TEXTURE_SIZE);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  // The bitmap is loadLayerBitmap's cached copy: drawn, never closed.
  ctx.drawImage(bitmap, 0, 0, PALETTE_TEXTURE_SIZE, PALETTE_TEXTURE_SIZE);
  const { data } = ctx.getImageData(0, 0, PALETTE_TEXTURE_SIZE, PALETTE_TEXTURE_SIZE);
  return { data, width: PALETTE_TEXTURE_SIZE, height: PALETTE_TEXTURE_SIZE, tint: layer.tint };
}

export interface PaletteDeps { faces(blocks: BlockRef[]): Promise<BlockFaces[]>; image(layer: TextureLayer): Promise<LayerPixels | null> }

/** Override > average of the `up` face layers > the server's fallback when unresolved > the local fallback. */
async function entryColor(ref: BlockRef, faces: BlockFaces | undefined, image: PaletteDeps['image']): Promise<Rgb> {
  const override = OVERRIDE_COLORS[ref.id];
  if (override !== undefined) return override;
  if (faces === undefined) return fallbackColor(ref);
  try {
    const layers = await Promise.all(faces.faces.up.map((layer) => image(layer)));
    const average = averageTopColor(layers.filter((l): l is LayerPixels => l !== null));
    if (average !== null) return average;
  } catch {
    // a texture that failed to load, or layers of different sizes: no average
  }
  return faces.resolved ? fallbackColor(ref) : faces.fallbackColor;
}

/**
 * Packed colours (0xRRGGBB) for every palette entry. The fallback colours come first and go to `onUpdate` at once;
 * then the block faces are fetched in batches of FACES_BATCH, and after each answered batch its colours are filled in
 * and `onUpdate` runs again — with the same array, updated in place. A failed batch keeps its fallback colours and the
 * later batches still go; nothing here throws for an assets error.
 */
export async function resolvePaletteColors(palette: BlockRef[], deps: PaletteDeps, onUpdate?: (colors: Uint32Array) => void): Promise<Uint32Array> {
  const colors = new Uint32Array(palette.length);
  palette.forEach((ref, i) => { colors[i] = packRgb(fallbackColor(ref)); });
  onUpdate?.(colors);
  for (let start = 0; start < palette.length; start += FACES_BATCH) {
    const batch = palette.slice(start, start + FACES_BATCH);
    let faces: BlockFaces[];
    try {
      faces = await deps.faces(batch);
    } catch {
      continue;
    }
    const batchColors = await Promise.all(batch.map((ref, j) => entryColor(ref, faces[j], deps.image)));
    batchColors.forEach((c, j) => { colors[start + j] = packRgb(c); });
    onUpdate?.(colors);
  }
  return colors;
}
