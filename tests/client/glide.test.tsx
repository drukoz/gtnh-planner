// The diagrams glide (Phase 2 spec §16.1–§16.2, Task 13a): Fit, the zoom buttons and a reveal pan a diagram's view over 250 ms with a WAAPI
// animation of its pan group's CSS `transform`, from absolute keyframes that end on the group's `transform` attribute, which holds the view
// at once. These cases pin the view's two spellings (the keyframe a pan animates, and the matrix the browser computes while it runs) and that
// nothing glides where the browser cannot animate an element: node here, where the view then moves at once. glide.spec.ts drives the pans in
// a browser. Task 13b adds a new layout's glide (spec §16.3): its fade in, and that node, which cannot animate, glides none either.

import { describe, it, expect, vi } from 'vitest';
import { FADE_IN, PAN_ANIMATION_ID, canGlide, glideLayout, glideView, matrixView, panTransform } from '../../src/client/views/glide.ts';

describe('the diagrams glide', () => {
  it('writes a view as the CSS transform a pan animates: px for the offset, which is the SVG\'s user units', () => {
    expect(panTransform({ x: 16, y: 20.5, scale: 0.9 })).toBe('translate(16px, 20.5px) scale(0.9)');
    expect(panTransform({ x: -120.25, y: 0, scale: 1 })).toBe('translate(-120.25px, 0px) scale(1)');
  });

  it('reads a view back from the matrix the browser computes while a pan runs, and nothing from none', () => {
    expect(matrixView('matrix(0.9, 0, 0, 0.9, 16, 20.5)')).toEqual({ x: 16, y: 20.5, scale: 0.9 });
    expect(matrixView('matrix(1.25, 0, 0, 1.25, -340.5, 12)')).toEqual({ x: -340.5, y: 12, scale: 1.25 });
    expect(matrixView('none')).toBeNull();
  });

  it('reads no view from a matrix that is not a pan\'s: turned, skewed, stretched, 3D or not a matrix', () => {
    expect(matrixView('matrix(0, 1, -1, 0, 16, 20)')).toBeNull();
    expect(matrixView('matrix(1, 0, 0.5, 1, 16, 20)')).toBeNull();
    expect(matrixView('matrix(1, 0, 0, 2, 16, 20)')).toBeNull();
    expect(matrixView('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 16, 20, 0, 1)')).toBeNull();
    expect(matrixView('matrix(1, 0, 0, 1, 16)')).toBeNull();
    expect(matrixView('translate(16px, 20px)')).toBeNull();
  });

  it('names its animation, so a pan is told from any other animation of the group', () => {
    expect(PAN_ANIMATION_ID).toBe('pan');
  });

  it('never glides where the browser cannot animate an element (node): the view moves at once', () => {
    expect(canGlide()).toBe(false);
    expect(glideView({} as SVGGElement, { x: 16, y: 16, scale: 1 }, { x: 40, y: 16, scale: 0.5 })).toBeNull();
  });

  // fix round 2: a probe that cannot run (here the page gives it nowhere to go) answers false, and never throws out of `canGlide`; a fresh
  // copy of the module, as the answer is kept once found
  it('answers false, and throws nothing, when its probe cannot run', async () => {
    vi.resetModules();
    const element = (): Record<string, unknown> => ({ setAttribute: () => {}, append: () => {}, remove: () => {}, style: {} });
    vi.stubGlobal('Element', class { animate(): void {} });
    vi.stubGlobal('document', { createElementNS: element, body: { append: () => { throw new Error('nowhere to probe'); } } });
    try {
      const fresh = await import('../../src/client/views/glide.ts');
      expect(fresh.canGlide()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  // Task 13b: a box that comes in fades from nothing to its own opacity, one keyframe at the start (an end one would fade it out), so a box that
  // comes in under a focus ends at its `.dim` 0.18
  it('fades a box in from nothing to its own opacity: one keyframe, at the start', () => {
    expect(FADE_IN).toEqual([{ opacity: 0, offset: 0 }]);
  });

  // fix round 1 (M3): past its gate `glideLayout` looks the boxes up with `querySelectorAll` first, so both are watched, and neither may be called
  it('never glides a new layout where the browser cannot animate an element (node): the boxes move at once', () => {
    const root = { querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []) } as unknown as SVGGElement;
    glideLayout(root, { moved: [{ id: 'a', from: [0, 0], to: [10, 0] }], entered: ['b'], left: ['c'], rerouted: ['e'] }, { boxes: ['data-node-id'], edges: 'data-edge-id', extra: '.flow-riders' });
    expect(root.querySelectorAll).not.toHaveBeenCalled();
    expect(root.querySelector).not.toHaveBeenCalled();
  });
});
