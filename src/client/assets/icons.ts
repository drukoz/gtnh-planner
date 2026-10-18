// Real item and fluid icons (spec §3.8): the server's IconDescriptor for a key, its layers loaded, tinted and stacked
// into one PNG at the device's pixel size, and handed to <img> as an object URL. Descriptors are batched per tick
// (icon-batcher.ts); finished images are kept per key and size for the life of the page.

import { useEffect, useState } from 'react';
import { apiPost } from '../api/client.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { AssetIconsRequest } from '../../shared/types/api.ts';
import type { IconDescriptor } from '../../shared/types/assets.ts';
import { compositeLayers, type LayerPixels } from './composite.ts';
import { createIconBatcher, type IconBatcher } from './icon-batcher.ts';
import { loadLayerBitmap } from './texture-image.ts';

export const iconBatcher: IconBatcher = createIconBatcher((keys) => {
  const body: AssetIconsRequest = { keys };
  return apiPost<IconDescriptor[]>('/api/assets/icons', body);
});

/** Device pixels for an icon drawn `cssSize` CSS pixels wide: never below 16, the game's own texture size. */
export function iconPixelSize(cssSize: number): number {
  return Math.max(16, Math.round(cssSize * (globalThis.devicePixelRatio || 1)));
}

/** Per `key|px`; `null` (no layer loaded) is kept too, a failed render is forgotten so a later icon asks again. */
const images = new Map<string, Promise<string | null>>();

/** An object URL of `desc`'s layers composited at `px`×`px`, or `null` when none of its layers loads. */
export function iconImageUrl(desc: IconDescriptor, px: number): Promise<string | null> {
  const cacheKey = `${desc.key}|${px}`;
  let image = images.get(cacheKey);
  if (!image) {
    image = render(desc, px);
    images.set(cacheKey, image);
    image.catch(() => { images.delete(cacheKey); });
  }
  return image;
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  // Read back once per layer: a CPU-backed canvas makes those reads cheap (and Chrome stops warning about them).
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

async function render(desc: IconDescriptor, px: number): Promise<string | null> {
  const bitmaps = await Promise.all(desc.layers.map((layer) => loadLayerBitmap(layer, px)));
  const canvas = new OffscreenCanvas(px, px);
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = false;
  const layers: LayerPixels[] = [];
  for (const [index, bitmap] of bitmaps.entries()) {
    if (!bitmap) continue; // a missing file drops only its own layer
    // Bitmaps are shared through loadLayerBitmap's cache (also by the 3D view), so they are drawn, never closed.
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(bitmap, 0, 0, px, px);
    const { data } = ctx.getImageData(0, 0, px, px);
    const tint = desc.layers[index]!.tint;
    layers.push(tint ? { data, width: px, height: px, tint } : { data, width: px, height: px });
  }
  if (layers.length === 0) return null;
  const out = ctx.createImageData(px, px);
  out.data.set(compositeLayers(px, layers));
  ctx.putImageData(out, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

interface ItemIconState { desc: IconDescriptor | null; url: string | null }

const NOTHING_YET: ItemIconState = { desc: null, url: null };

/**
 * `key`'s descriptor and composited image for an icon `cssSize` CSS pixels wide: `{ desc: null, url: null }` until the
 * descriptor arrives, then `url` once the image is ready (never for a descriptor without layers). A failed lookup or
 * render leaves the placeholder; a change of key or size drops what the previous one would still deliver.
 */
export function useItemIcon(key: StuffKey, cssSize: number): ItemIconState {
  const wanted = `${key}|${cssSize}`;
  const [state, setState] = useState<{ for: string } & ItemIconState>({ for: '', ...NOTHING_YET });
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const desc = await iconBatcher.get(key);
        if (!current) return;
        setState({ for: wanted, desc, url: null });
        if (desc.layers.length === 0) return;
        const url = await iconImageUrl(desc, iconPixelSize(cssSize));
        if (current && url !== null) setState({ for: wanted, desc, url });
      } catch {
        // the placeholder stays
      }
    })();
    return () => { current = false; };
  }, [key, cssSize, wanted]);
  // Until this key and size have answered, the previous one's icon is not shown for it.
  return state.for === wanted ? { desc: state.desc, url: state.url } : NOTHING_YET;
}
