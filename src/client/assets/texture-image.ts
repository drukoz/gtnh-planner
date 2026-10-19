// Loads one texture layer from `GET /api/assets/file/<path>` as an ImageBitmap: frame 0 of an animated strip (the top
// `height / frames` rows), optionally resized evenly (architecture §11.43 (h)): a whole multiple of the frame is
// nearest-neighbour, any other upscale goes nearest-neighbour to the next whole multiple and then smooth to the target,
// a downscale is smooth. Shared by the flat item icons and Plan 5's 3D view; the tint is not applied here (icons tint
// in compositeLayers, the 3D view in its shader).

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

/** One resize, to `size`×`size` pixels: nearest-neighbour (`pixelated`) or smooth (`high`). */
export type ResizeStep = { size: number; quality: 'pixelated' | 'high' };

/**
 * The resizes that take a `from`×`from` frame to `to`×`to` so that no source pixel ends up wider than another: the same
 * size or a whole multiple is one nearest-neighbour step; any other upscale goes nearest-neighbour to the next whole
 * multiple of `from`, then smooth down to `to`; a downscale is one smooth step.
 */
export function resizeSteps(from: number, to: number): ResizeStep[] {
  if (to === from || to % from === 0) return [{ size: to, quality: 'pixelated' }];
  if (to < from) return [{ size: to, quality: 'high' }];
  return [{ size: Math.ceil(to / from) * from, quality: 'pixelated' }, { size: to, quality: 'high' }];
}

/** Per `path|size`, for the life of the page; a layer that could not be loaded stays `null`. */
const cache = new Map<string, Promise<ImageBitmap | null>>();

/**
 * Frame 0 of `layer`'s texture, resized to `size`×`size` by `resizeSteps` when `size` is given (else at its own size);
 * `null` when the file is missing, the server refuses it or it does not decode. The default deps are the browser's
 * own, looked up at call time.
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
      // A frame is square, so the steps start from its width. The first one rides on the crop, the rest resize its result.
      const [first, ...later] = size ? resizeSteps(width, size) : [];
      let bitmap = await decode(decoded, 0, 0, width, frameHeight(width, height, layer.frames), first ? resizeOptions(first) : undefined);
      for (const step of later) {
        const previous = bitmap;
        try {
          bitmap = await decode(previous, resizeOptions(step));
        } finally {
          previous.close();
        }
      }
      return bitmap;
    } finally {
      decoded.close();
    }
  } catch {
    return null;
  }
}

function resizeOptions(step: ResizeStep): ImageBitmapOptions {
  return { resizeWidth: step.size, resizeHeight: step.size, resizeQuality: step.quality };
}
