// Flat item icons from texture layers (research §2.4, §2.5): every layer is drawn bottom to top with straight-alpha
// source-over after its tint multiplies its RGB (alpha untouched). Glow layers are drawn like any other layer here; only
// the 3D view treats them as full-bright. Pure: no DOM, so it runs in tests and workers alike.

import type { Rgb } from '../../shared/types/assets.ts';

/** One layer's pixels: `width`×`height` straight (not premultiplied) RGBA, as `ImageData.data` holds them. */
export interface LayerPixels { data: Uint8ClampedArray; width: number; height: number; tint?: Rgb }

/**
 * Composites `layers` (each `size`×`size` RGBA) into one `size`×`size` RGBA image. Per pixel, with every value in 0..1:
 * `outA = sa + da·(1 − sa)`, `outC = (sc·sa + dc·da·(1 − sa)) / outA`, and `outA = 0` gives transparent black. The
 * running result stays unrounded and is rounded to 0..255 once at the end.
 */
export function compositeLayers(size: number, layers: readonly LayerPixels[]): Uint8ClampedArray {
  const length = size * size * 4;
  const acc = new Float64Array(length); // straight RGBA in 0..1
  for (const [index, layer] of layers.entries()) {
    if (layer.width !== size || layer.height !== size || layer.data.length !== length) {
      throw new RangeError(`layer ${index} is ${layer.width}×${layer.height} (${layer.data.length} bytes), expected ${size}×${size}`);
    }
    const { data, tint } = layer;
    const tr = tint ? tint[0] / 255 : 1;
    const tg = tint ? tint[1] / 255 : 1;
    const tb = tint ? tint[2] / 255 : 1;
    for (let i = 0; i < length; i += 4) {
      const sa = data[i + 3]! / 255;
      if (sa === 0) continue; // source-over with a transparent source leaves the pixel as it is
      const da = acc[i + 3]!;
      const keep = da * (1 - sa);
      const outA = sa + keep;
      acc[i] = ((data[i]! / 255) * tr * sa + acc[i]! * keep) / outA;
      acc[i + 1] = ((data[i + 1]! / 255) * tg * sa + acc[i + 1]! * keep) / outA;
      acc[i + 2] = ((data[i + 2]! / 255) * tb * sa + acc[i + 2]! * keep) / outA;
      acc[i + 3] = outA;
    }
  }
  const out = new Uint8ClampedArray(length);
  for (let i = 0; i < length; i++) out[i] = Math.round(acc[i]! * 255);
  return out;
}

/** A `size`×`size` opaque RGBA image of one colour (spec §3.8's plain-colour fallback). */
export function solidPixels(size: number, rgb: Rgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = 255;
  }
  return out;
}
