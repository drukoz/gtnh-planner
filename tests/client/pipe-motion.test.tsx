// How fast a diagram pipe's contents move (restyle plan Phase 1 Task 6, design spec §7 and §7a): a log scale of the edge's
// rate, items per second or litres per second over a thousand, clamped between 0.35 s and 1.6 s per 16 px dash cycle; and
// above 200 edges only the lit ones move (review focus 5: a huge plan must pan smoothly). Phase 2 Task 12 (spec §15.2): the goods
// that ride the Flow pipes, 64 px a dash cycle within 1.2–12 s a ride, staggered by a phase of their edge's id, and which pipes carry one.

import { describe, it, expect } from 'vitest';
import { PORT_SIZE } from '../../src/client/views/flow-model.ts';
import {
  PIPE_ANIMATION_LIMIT, RIDE_OVERHANG, RIDER_LIMIT, RIDER_SIZE, pathLength, pipeAnimationMode, pipeSeconds, rideRoute, riderEdges, riderPhase,
  riderSeconds,
} from '../../src/client/views/pipe-motion.ts';

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

describe('goods riding the pipes (Phase 2 spec §15)', () => {
  it('draws a rider 12 px wide, at most 150 to a diagram', () => {
    expect(RIDER_SIZE).toBe(12);
    expect(RIDER_LIMIT).toBe(150);
  });

  it('measures an orthogonal route', () => expect(pathLength([[0, 0], [30, 0], [30, 40]])).toBe(70));

  it('rides four times as fast as the dashes, within 1.2–12 s', () => {
    expect(riderSeconds(640, 1, false)).toBe(10); expect(riderSeconds(320, 100, false)).toBe(2.5);
    expect(riderSeconds(64, 1, false)).toBe(1.2); expect(riderSeconds(0, 1, false)).toBe(1.2); expect(riderSeconds(1280, 1, false)).toBe(12);
  });

  it('staggers riders by a stable phase of the edge id', () => {
    expect(riderPhase('e1')).toBe(riderPhase('e1')); expect(riderPhase('e1')).not.toBe(riderPhase('e2'));
    for (const id of ['e1', 'a|out|t:x@0->b|in|t:x@0', '']) { expect(riderPhase(id)).toBeGreaterThanOrEqual(0); expect(riderPhase(id)).toBeLessThan(1); }
  });

  it('rides no pipe from a missing source or of no length, lit ones first, then the biggest, at most 150', () => {
    const e = (id: string, perSecond: number, points: Array<[number, number]> = [[0, 0], [10, 0]]) => ({ id, perSecond, points });
    expect(riderEdges([e('a', 1), e('m', 5), e('z', 9, [[0, 0], [0, 0]]), e('b', 3)], new Set(['a']), new Set(['m'])).map((x) => x.id)).toEqual(['a', 'b']);
    expect(riderEdges(Array.from({ length: 180 }, (_, i) => e(`e${i}`, i)), null, new Set())).toHaveLength(RIDER_LIMIT);
    const many = Array.from({ length: 201 }, (_, i) => e(`e${i}`, 1));
    expect(riderEdges(many, null, new Set())).toEqual([]); expect(riderEdges(many, new Set(['e7']), new Set()).map((x) => x.id)).toEqual(['e7']);
  });

  // a rider moved in the DOM starts its ride over (Chromium and WebKit restart a moved element's CSS animation), so the ranking picks who
  // rides and the riders keep the order of their edges: a hover that lights another pipe moves none of them
  it('keeps the riders in the order of their edges, whatever the ranking that picked them', () => {
    const e = (id: string, perSecond: number) => ({ id, perSecond, points: [[0, 0], [10, 0]] as Array<[number, number]> });
    expect(riderEdges([e('b', 3), e('a', 1)], new Set(['a']), new Set()).map((x) => x.id)).toEqual(['b', 'a']);
    // past the limit: the lit e0 and the 149 biggest (e31 to e179) ride, in the edges' order
    const kept = riderEdges(Array.from({ length: 180 }, (_, i) => e(`e${i}`, i)), new Set(['e0']), new Set()).map((x) => x.id);
    expect(kept).toEqual(['e0', ...Array.from({ length: 149 }, (_, i) => `e${i + 31}`)]);
    // a limit of its own, and ties on the rate go to the first id
    expect(riderEdges([e('c', 2), e('b', 2), e('a', 2)], null, new Set(), 2).map((x) => x.id)).toEqual(['b', 'a']);
  });

  // fix round 1 (ledger ruling P2-R98): a fluid's rate is in litres, so past the limit a pipe is ranked in the dashes' units (`pipeSeconds`):
  // a thousand litres a second rides like one item a second; an edge with no key is taken as items
  it('ranks pipes past the limit in the units the dashes use: a fluid by the thousand litres', () => {
    const p = (id: string, perSecond: number, key?: string) => (
      { id, perSecond, points: [[0, 0], [10, 0]] as Array<[number, number]>, ...(key === undefined ? {} : { key }) }
    );
    expect(riderEdges([p('f', 144, 'fluid:water'), p('i', 2, 't:x@0')], null, new Set(), 1).map((x) => x.id)).toEqual(['i']);
    expect(riderEdges([p('f', 3000, 'fluid:water'), p('i', 2, 't:x@0')], null, new Set(), 1).map((x) => x.id)).toEqual(['f']);
    expect(riderEdges([p('n', 144), p('i', 2, 't:x@0')], null, new Set(), 1).map((x) => x.id)).toEqual(['n']);
  });

  // fix round 1 (ledger ruling P2-R97): an arrow ends on its flange's outer face, 2 px outside the box, where a 12 px rider would show half of
  // itself; the ride runs on along the first and last runs, 9 px past each end (the flange's 2 px, half a rider and a pixel), into the boxes,
  // which are drawn over the riders, so a ride starts and ends out of sight
  it('rides on 9 px past each end of its arrow, along its first and last runs, into the boxes', () => {
    expect(RIDE_OVERHANG).toBe(PORT_SIZE + RIDER_SIZE / 2 + 1);
    expect(RIDE_OVERHANG).toBe(9);
    // a two-point route
    expect(rideRoute([[0, 0], [40, 0]])).toEqual([[-9, 0], [49, 0]]);
    // a horizontal route, right to left (a pipe back to an earlier box)
    expect(rideRoute([[100, 5], [70, 5], [20, 5]])).toEqual([[109, 5], [70, 5], [11, 5]]);
    // a route that turns: each end along its own run, whichever way it runs
    expect(rideRoute([[0, 0], [30, 0], [30, 40]])).toEqual([[-9, 0], [30, 0], [30, 49]]);
    expect(rideRoute([[0, 0], [30, 0], [30, -40], [60, -40]])).toEqual([[-9, 0], [30, 0], [30, -40], [69, -40]]);
    // a doubled point at an end gives no direction: the run is the one to the next point that differs
    expect(rideRoute([[0, 0], [0, 0], [40, 0]])).toEqual([[-9, 0], [0, 0], [49, 0]]);
    // nothing to ride: as it is
    expect(rideRoute([[5, 5], [5, 5]])).toEqual([[5, 5], [5, 5]]);
    // the arrow's own points stay as they are
    const points: Array<[number, number]> = [[0, 0], [40, 0]];
    rideRoute(points);
    expect(points).toEqual([[0, 0], [40, 0]]);
  });

  // fix round 1 (M4): the phase is the shared FNV-1a over 2³², as it was before it was shared
  it('keeps each rider\'s phase where it was', () => {
    expect(riderPhase('')).toBe(0x811c9dc5 / 2 ** 32);
    expect(riderPhase('e1')).toBe(2216349443 / 2 ** 32);
    expect(riderPhase('a|out|t:x@0->b|in|t:x@0')).toBe(3367248338 / 2 ** 32);
  });
});
