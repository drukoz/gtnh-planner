// How fast a diagram pipe's contents move (restyle plan Phase 1 Task 6, design spec §7 and §7a): a log scale of the edge's
// rate, items per second or litres per second over a thousand, clamped between 0.35 s and 1.6 s per 16 px dash cycle; and
// above 200 edges only the lit ones move (review focus 5: a huge plan must pan smoothly).

import { describe, it, expect } from 'vitest';
import { PIPE_ANIMATION_LIMIT, pipeAnimationMode, pipeSeconds } from '../../src/client/views/pipe-motion.ts';

describe('pipe motion', () => {
  it('moves the contents faster the more flows: a second per cycle at 1 a second, a quarter less per tenfold', () => {
    expect(pipeSeconds(1, false)).toBe(1);
    expect(pipeSeconds(10, false)).toBe(0.75);
    expect(pipeSeconds(100, false)).toBe(0.5);
  });

  it('clamps the speed between 0.35 s and 1.6 s per cycle, and gives nothing flowing the slowest', () => {
    expect(pipeSeconds(10_000, false)).toBe(0.35);
    expect(pipeSeconds(0.001, false)).toBe(1.6);
    expect(pipeSeconds(0, false)).toBe(1.6);
    expect(pipeSeconds(Number.NaN, false)).toBe(1.6);
  });

  it('counts a fluid in thousands of litres, so a bucket a second moves like an item a second', () => {
    expect(pipeSeconds(1000, true)).toBe(1);
    expect(pipeSeconds(100_000, true)).toBe(0.5);
  });

  it('rounds to hundredths of a second, so the custom property stays short', () => {
    expect(pipeSeconds(2, false)).toBe(0.92);                                        // 1 - 0.25 * log10(2) = 0.9247
    expect(pipeSeconds(0.5, false)).toBe(1.08);
  });

  it('animates every pipe up to 200 edges, and only the lit ones above that', () => {
    expect(PIPE_ANIMATION_LIMIT).toBe(200);
    expect(pipeAnimationMode(0)).toBe('all');
    expect(pipeAnimationMode(200)).toBe('all');
    expect(pipeAnimationMode(201)).toBe('lit');
  });
});
