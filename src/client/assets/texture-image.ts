// Loads one texture layer from `GET /api/assets/file/<path>` as an ImageBitmap: frame 0 of an animated strip (the top
// `height / frames` rows), optionally resized with nearest-neighbour sampling. Shared by the flat item icons and
// Plan 5's 3D view; the tint is not applied here (icons tint in compositeLayers, the 3D view in its shader).

import type { TextureLayer } from '../../shared/types/assets.ts';

const FILE_ROUTE = '/api/assets/file/';

/** The asset route for a `data/assets`-relative path, every segment URI-encoded on its own. */
export function assetFileUrl(path: string): string {
  return FILE_ROUTE + path.split('/').map(encodeURIComponent).join('/');
}

/** Rows of frame 0: `floor(height / frames)` for an animated strip, else the square `min(width, height)`. */
export function frameHeight(width: number, height: number, frames?: number): number {
  return frames !== undefined && frames > 1 ? Math.floor(height / frames) : Math.min(width, height);
}

export interface LayerImageDeps { fetch: typeof fetch; createImageBitmap: typeof createImageBitmap }

/** Per `path|size`, for the life of the page; a layer that could not be loaded stays `null`. */
const cache = new Map<string, Promise<ImageBitmap | null>>();

/**
 * Frame 0 of `layer`'s texture, resized to `size`×`size` when `size` is given; `null` when the file is missing, the
 * server refuses it or it does not decode. The default deps are the browser's own, looked up at call time.
 */
export function loadLayerBitmap(layer: TextureLayer, size?: number, deps?: LayerImageDeps): Promise<ImageBitmap | null> {
  const key = `${layer.path}|${size ?? ''}`;
  let bitmap = cache.get(key);
  if (!bitmap) {
    bitmap = load(layer, size, deps);
    cache.set(key, bitmap);
  }
  return bitmap;
}

async function load(layer: TextureLayer, size: number | undefined, deps: LayerImageDeps | undefined): Promise<ImageBitmap | null> {
  try {
    // Called unbound: the browser's fetch and createImageBitmap throw "Illegal invocation" as methods of another object.
    const { fetch: get, createImageBitmap: decode } = deps ?? { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap };
    const res = await get(assetFileUrl(layer.path), { credentials: 'same-origin' });
    if (!res.ok) return null;
    const decoded = await decode(await res.blob());
    try {
      const { width, height } = decoded;
      const resize: ImageBitmapOptions | undefined = size ? { resizeWidth: size, resizeHeight: size, resizeQuality: 'pixelated' } : undefined;
      return await decode(decoded, 0, 0, width, frameHeight(width, height, layer.frames), resize);
    } finally {
      decoded.close();
    }
  } catch {
    return null;
  }
}
