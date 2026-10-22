// Pan and zoom for a picture drawn in an svg, with the flow diagram's limits and feel (the Connections tab uses it; a
// later cleanup can move FlowView onto it). A view puts the picture's top left at (x, y) in the svg's screen pixels and
// zooms it by k: the picture's group has the transform `translate(x y) scale(k)`, so a drag adds what the pointer moved
// to x and y at any zoom. When the svg changes size the view is fitted again or keeps its middle (`resizeView`).

/** Where the picture's top left is (screen px) and its zoom. */
export interface View { x: number; y: number; k: number }
/** The size of a picture (its own units) or of the area that shows it (screen px). */
export interface Size { width: number; height: number }

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
/** Wheel zoom per pixel of scroll, and the pixels a line of scroll counts for. */
export const WHEEL_ZOOM = 0.0015;
export const WHEEL_LINE_PIXELS = 16;
/** A press moves this far (px) before it counts as a drag instead of a click. */
export const DRAG_THRESHOLD = 4;

/** `k` within the zoom limits. */
export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** The view zoomed by `factor` (within the limits) around the screen point (px, py), which stays over the same spot. */
export function zoomAround(v: View, px: number, py: number, factor: number): View {
  const k = clampZoom(v.k * factor);
  const r = k / v.k;
  return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

/**
 * The zoom factor of a wheel turn of `deltaY`, in lines when `lines` (else pixels): a turn up zooms in. A trackpad
 * pinch comes as wheel events too (with ctrlKey), so it zooms the same way.
 */
export function wheelFactor(deltaY: number, lines: boolean): number {
  return Math.exp(-(lines ? deltaY * WHEEL_LINE_PIXELS : deltaY) * WHEEL_ZOOM);
}

/**
 * The view that shows all of `picture` in `area`, `pad` px in from its sides: zoomed out as far as that takes but not
 * past MIN_ZOOM, never zoomed in past its own size, and centred where it fits, else from its top left. While the area
 * or the picture has no size yet (not laid out), the picture at its own size by the padding.
 */
export function fitView(picture: Size, area: Size, pad = 0): View {
  if (area.width <= 0 || area.height <= 0 || picture.width <= 0 || picture.height <= 0) return { x: pad, y: pad, k: 1 };
  const k = Math.min(1, clampZoom(Math.min((area.width - 2 * pad) / picture.width, (area.height - 2 * pad) / picture.height)));
  return { k, x: Math.max(pad, (area.width - picture.width * k) / 2), y: Math.max(pad, (area.height - picture.height * k) / 2) };
}

/** Whether two views are the same, within what rounding leaves. */
export function sameView(a: View, b: View): boolean {
  const EPS = 1e-6;
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.k - b.k) < EPS;
}

/**
 * The view once the area that shows `picture` changed size from `before` to `after` (the Connections view's side panel
 * opening or closing beside it; the review of 401d0ca): fitted again (`fitView`) while it is still `fitted`, the view
 * last fitted, so nothing of the picture is cut off; else moved by half the change, so the spot in the middle of the
 * area stays in the middle, at the same zoom.
 */
export function resizeView(v: View, fitted: View | null, picture: Size, before: Size, after: Size, pad = 0): View {
  if (fitted !== null && sameView(v, fitted)) return fitView(picture, after, pad);
  return { k: v.k, x: v.x + (after.width - before.width) / 2, y: v.y + (after.height - before.height) / 2 };
}
