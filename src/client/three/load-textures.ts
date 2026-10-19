// What the 3D view needs from the asset routes (Plan 5 Task 15; spec §3.8, web-stack §8): the faces of every distinct
// block of a layout, and for every cover item both GT's in-world overlay and the item's icon (the plate falls back to
// it), then one TILE × TILE image per scene tile, its layers blended as Plan 3 blends an item icon. Nothing here
// fails the view: a request that fails leaves its blocks or covers in plain colours, and a tile whose images do not
// load is its plain colour.

import type { StuffKey } from '../../shared/keys.ts';
import { ASSET_KEYS_MAX, type AssetCoversRequest } from '../../shared/types/api.ts';
import type { BlockFaces, CoverLayers, IconDescriptor, TextureLayer } from '../../shared/types/assets.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { BlockRef } from '../../shared/types/pack.ts';
import { apiPost } from '../api/client.ts';
import { iconBatcher } from '../assets/icons.ts';
import { worldApi } from '../map/api.ts';
import { FACES_BATCH, layerPixels } from '../map/palette.ts';
import { blockKey, type SceneData } from './scene-data.ts';
import { compositeTile, solidTile, TILE, type TileImage } from './textures.ts';

/** The asset lookups the 3D view makes; the browser's are `realTextureDeps`, tests pass their own. */
export interface TextureDeps {
  /** `BlockFaces` per block, in request order. */
  blocks(refs: BlockRef[]): Promise<BlockFaces[]>;
  /** The item icon per key, in request order. */
  icons(keys: StuffKey[]): Promise<IconDescriptor[]>;
  /** GT's in-world cover overlay per cover item, in request order. */
  covers(items: StuffKey[]): Promise<CoverLayers[]>;
  /** Frame 0 of one layer's texture at TILE × TILE, untinted; `null` when it cannot be had. */
  image(layer: TextureLayer): Promise<TileImage | null>;
}

/** `post` over `list` in slices of at most `size`, one request after the other; the answers in request order. */
async function inBatches<T, A>(list: readonly T[], size: number, post: (slice: T[]) => Promise<A[]>): Promise<A[]> {
  const answers: A[] = [];
  for (let start = 0; start < list.length; start += size) answers.push(...await post(list.slice(start, start + size)));
  return answers;
}

/**
 * The browser's lookups. Block faces go through the map's `worldApi.blockFaces` in batches of FACES_BATCH (200), icons
 * through Plan 3's page-wide `iconBatcher` (batches of ASSET_KEYS_MAX, shared with every ItemIcon), cover overlays in
 * batches of ASSET_KEYS_MAX, and an image is the map palette's `layerPixels` — Plan 3's `loadLayerBitmap` at 16 px drawn
 * on an OffscreenCanvas and read back — or `null` when it does not load or is not a TILE × TILE image (ruling R17).
 */
export const realTextureDeps: TextureDeps = {
  blocks: (refs) => inBatches(refs, FACES_BATCH, (slice) => worldApi.blockFaces(slice)),
  icons: (keys) => Promise.all(keys.map((key) => iconBatcher.get(key))),
  covers: (items) => inBatches(items, ASSET_KEYS_MAX, (slice) => {
    const body: AssetCoversRequest = { items: slice };
    return apiPost<CoverLayers[]>('/api/assets/covers', body);
  }),
  image: async (layer) => {
    try {
      const pixels = await layerPixels(layer);
      return pixels !== null && pixels.width === TILE && pixels.height === TILE ? { data: pixels.data } : null;
    } catch {
      return null;
    }
  },
};

/**
 * `ask(args)` once, its answers keyed by `keys` (the same order); empty when there is nothing to ask, when the request
 * fails or when the answer is not a list — the blocks or covers it was for are then drawn in plain colours.
 */
async function answersBy<A, V>(keys: readonly string[], args: A[], ask: (args: A[]) => Promise<V[]>): Promise<Map<string, V>> {
  const byKey = new Map<string, V>();
  if (args.length === 0) return byKey;
  try {
    const answers = await ask(args);
    if (!Array.isArray(answers)) return byKey;
    answers.slice(0, keys.length).forEach((answer, i) => byKey.set(keys[i]!, answer));
  } catch {
    // plain colours, never a broken view (spec §3.8)
  }
  return byKey;
}

/**
 * The faces of every distinct block of `layout` (by `blockKey`, ghosts included), and for every distinct cover item
 * its in-world overlay (`covers`) and its icon (`icons`, what a plate shows when the overlay is `[]`): one request of
 * each kind, in the order the layout first names them.
 */
export async function loadSceneInputs(layout: Layout, deps: TextureDeps): Promise<{
  faces: Map<string, BlockFaces>; icons: Map<StuffKey, IconDescriptor>; covers: Map<StuffKey, CoverLayers>;
}> {
  const blocks = new Map<string, BlockRef>();
  const coverItems = new Set<StuffKey>();
  for (const b of layout.blocks) {
    const key = blockKey(b.block);
    if (!blocks.has(key)) blocks.set(key, b.block);
    for (const cover of b.covers ?? []) coverItems.add(cover.item);
  }
  const items = [...coverItems];
  const [faces, icons, covers] = await Promise.all([
    answersBy([...blocks.keys()], [...blocks.values()], (refs) => deps.blocks(refs)),
    answersBy(items, items, (keys) => deps.icons(keys)),
    answersBy(items, items, (keys) => deps.covers(keys)),
  ]);
  return { faces, icons, covers };
}

/** `deps.image(layer)`, with every failure (a rejection or a throw) as `null`. */
async function imageOrNull(deps: TextureDeps, layer: TextureLayer): Promise<TileImage | null> {
  try {
    return await deps.image(layer);
  } catch {
    return null;
  }
}

/**
 * The pixels of every scene tile, in tile order: its layers composited bottom to top, each with its own tint (Task
 * 14's `compositeTile`), each texture path asked for once however many tiles use it; a tile without layers, whose
 * images all fail to load, or that cannot be composited is `solidTile(tile.color)`. Never rejects.
 */
export async function tilesFor(scene: SceneData, deps: TextureDeps): Promise<Uint8ClampedArray[]> {
  const images = new Map<string, Promise<TileImage | null>>();
  const imageOf = (layer: TextureLayer): Promise<TileImage | null> => {
    let image = images.get(layer.path);
    if (image === undefined) {
      image = imageOrNull(deps, layer);
      images.set(layer.path, image);
    }
    return image;
  };
  return Promise.all(scene.tiles.map(async (tile) => {
    if (tile.layers.length === 0) return solidTile(tile.color);
    const drawn = await Promise.all(tile.layers.map(async (layer) => {
      const image = await imageOf(layer);
      return image === null ? null : { image, ...(layer.tint === undefined ? {} : { tint: layer.tint }) };
    }));
    try {
      return compositeTile(drawn) ?? solidTile(tile.color);
    } catch {
      return solidTile(tile.color);   // an image of another size
    }
  }));
}
