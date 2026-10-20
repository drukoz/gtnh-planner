// Pan and zoom for an svg picture (the Connections tab's wire map, dragged at the user's request of 2026-10-19): the
// zoom limits, a zoom around the pointer, a wheel turn's zoom and the view that fits a picture, with the flow diagram's
// numbers.

import { describe, it, expect } from 'vitest';
import { clampZoom, fitView, wheelFactor, zoomAround, type View } from '../../src/client/views/pan-zoom.ts';
// the follow-up of the drag (the review of 401d0ca): the side panel narrows the area
import { resizeView, sameView } from '../../src/client/views/pan-zoom.ts';

/** The picture point (in its own units) under the screen point (px, py) of the view. */
const under = (v: View, px: number, py: number): [number, number] => [(px - v.x) / v.k, (py - v.y) / v.k];

describe('pan and zoom', () => {
  it('keeps the zoom between 0.15 and 3', () => {
    expect([clampZoom(0.01), clampZoom(0.15), clampZoom(1.2), clampZoom(3), clampZoom(10)]).toEqual([0.15, 0.15, 1.2, 3, 3]);
  });

  it('zooms around the pointer: the picture point under it stays under it', () => {
    const v = { x: 10, y: 20, k: 1 };
    const zoomedIn = zoomAround(v, 110, 70, 2);
    expect(zoomedIn).toEqual({ x: -90, y: -30, k: 2 });
    expect([under(v, 110, 70), under(zoomedIn, 110, 70)]).toEqual([[100, 50], [100, 50]]);
    const zoomedOut = zoomAround(zoomedIn, 110, 70, 0.5);
    expect(zoomedOut).toEqual(v);
  });

  it('stops zooming at the limits, still around the pointer', () => {
    const halfway = zoomAround({ x: 0, y: 0, k: 2 }, 100, 100, 2);
    expect(halfway).toEqual({ x: -50, y: -50, k: 3 });   // 3, not 4
    expect(under(halfway, 100, 100)).toEqual([50, 50]);
    expect(zoomAround({ x: 10, y: 20, k: 3 }, 110, 70, 2)).toEqual({ x: 10, y: 20, k: 3 });
    expect(zoomAround({ x: 10, y: 20, k: 0.2 }, 110, 70, 0.5).k).toBe(0.15);
  });

  it('zooms in on a wheel turn up and out on one down, a line of scroll counting 16 px', () => {
    expect(wheelFactor(100, false)).toBeCloseTo(0.86071, 5);
    expect(wheelFactor(-100, false)).toBeCloseTo(1.16183, 5);
    expect(wheelFactor(3, true)).toBeCloseTo(0.93053, 5);   // 48 px
    expect(wheelFactor(0, false)).toBe(1);
  });

  it('fits a 1000 × 400 picture into a 500 × 500 area at half size, centred top to bottom', () => {
    expect(fitView({ width: 1000, height: 400 }, { width: 500, height: 500 })).toEqual({ x: 0, y: 150, k: 0.5 });
    expect(fitView({ width: 1000, height: 400 }, { width: 532, height: 532 }, 16)).toEqual({ x: 16, y: 166, k: 0.5 });   // 16 px in from the sides
  });

  it('never fits a small picture larger than its own size, and shows a huge one from its top left at the smallest zoom', () => {
    expect(fitView({ width: 200, height: 100 }, { width: 500, height: 500 })).toEqual({ x: 150, y: 200, k: 1 });
    expect(fitView({ width: 10000, height: 100 }, { width: 500, height: 500 })).toEqual({ x: 0, y: 242.5, k: 0.15 });
  });

  it('shows the picture at its own size by the padding while the area or the picture has no size yet', () => {
    expect(fitView({ width: 1000, height: 400 }, { width: 0, height: 0 }, 16)).toEqual({ x: 16, y: 16, k: 1 });
    expect(fitView({ width: 0, height: 0 }, { width: 500, height: 500 }, 16)).toEqual({ x: 16, y: 16, k: 1 });
  });
});

// The Connections view's follow-ups (the review of 401d0ca): when the side panel opens and the area narrows, the
// picture is fitted again if nobody moved or zoomed it since it was fitted, else the spot in the middle stays there.
describe('pan and zoom when the area changes size', () => {
  const picture = { width: 1000, height: 400 };
  const wide = { width: 1032, height: 432 }, narrow = { width: 632, height: 432 };

  it('fits the picture again while the view is still the fitted one', () => {
    const fitted = fitView(picture, wide, 16);
    expect(fitted).toEqual({ x: 16, y: 16, k: 1 });
    expect(resizeView(fitted, fitted, picture, wide, narrow, 16)).toEqual(fitView(picture, narrow, 16));
    expect(resizeView(fitted, fitted, picture, wide, narrow, 16)).toEqual({ x: 16, y: 96, k: 0.6 });
  });

  it('keeps the spot in the middle of the area in the middle once the view was moved or zoomed', () => {
    const fitted = fitView(picture, wide, 16);
    const moved = { x: 116, y: 6, k: 1.5 };
    const after = resizeView(moved, fitted, picture, wide, narrow, 16);
    expect(after).toEqual({ x: -84, y: 6, k: 1.5 });
    const middle = (v: View, a: { width: number; height: number }): [number, number] => [(a.width / 2 - v.x) / v.k, (a.height / 2 - v.y) / v.k];
    expect(middle(after, narrow)).toEqual(middle(moved, wide));
    // and back when the panel closes
    expect(resizeView(after, fitted, picture, narrow, wide, 16)).toEqual(moved);
    // never fitted yet (the area had no size): the middle stays too
    expect(resizeView(moved, null, picture, wide, narrow, 16)).toEqual(after);
  });

  it('tells a view from one a hair away, as rounding leaves it', () => {
    expect(sameView({ x: 16, y: 136, k: 0.6 }, { x: 16 + 1e-9, y: 136, k: 0.6 })).toBe(true);
    expect(sameView({ x: 16, y: 136, k: 0.6 }, { x: 17, y: 136, k: 0.6 })).toBe(false);
    expect(sameView({ x: 16, y: 136, k: 0.6 }, { x: 16, y: 136, k: 0.61 })).toBe(false);
  });
});
