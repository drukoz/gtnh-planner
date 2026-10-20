// The 3D view's Show connections (the user's requirements of 2026-10-19, item 3 (b)): the Connections tab's links as one
// batched geometry of thin tubes that leave their faces, arc over the line and come down into the faces they reach,
// each in its channel's colour or the colour of what carries it, with an arrowhead halfway along; which link a ray from
// the pointer meets; the white tube and face frames that mark a picked link; and which links show while hookups are
// hidden.

import { describe, it, expect } from 'vitest';
import { connectionSpans, connectionsGraph, type ConnEdge, type ConnGraph, type ConnSpan } from '../../src/client/connections/model.ts';
import {
  LINK_LIFT, LINK_SEGMENTS, LINK_TRIANGLES, LINK_VERTICES, VIA_RGB, linkColor, linkGeometry, pickLink, selectionGeometry, spansShown, spotPoint,
} from '../../src/client/three/link-geometry.ts';
import { dyeRgb } from '../../src/shared/layout/enderio.ts';
import type { Vec3 } from '../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan } from '../../src/shared/types/plan.ts';
import { connLayout, connPlan } from './connections-fixture.ts';

const line = (mode: LogisticsMode): { layout: Layout; g: ConnGraph; spans: ConnSpan[]; edges: Map<string, ConnEdge> } => {
  const layout = connLayout(mode);
  const g = connectionsGraph(layout, connPlan, 'min');
  return { layout, g, spans: connectionSpans(layout, g), edges: new Map(g.edges.map((e) => [e.id, e])) };
};
/** Vertex `i` of a flat xyz (or rgb) array. */
const at = (a: Float32Array, i: number): Vec3 => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
const close = (a: Vec3, b: Vec3, digits = 5): void => a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, digits));
const mean = (ps: readonly Vec3[]): Vec3 => [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k]!, 0) / ps.length) as Vec3;
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The tube's rings: LINK_SEGMENTS + 1 of them, 4 vertices each, then the arrowhead's base ring of 4 and its tip. */
const RING = 4;

describe("the 3D view's connections", () => {
  it('puts every piece of every link of a line in one geometry', () => {
    const { layout, spans, edges } = line('enderio');
    const geo = linkGeometry(spans, edges, layout.origin);
    expect(geo.links.map((l) => l.span)).toEqual(spans);
    expect([geo.positions.length, geo.colors.length, geo.layers.length, geo.index.length])
      .toEqual([spans.length * LINK_VERTICES * 3, spans.length * LINK_VERTICES * 3, spans.length * LINK_VERTICES, spans.length * LINK_TRIANGLES * 3]);
    expect([LINK_VERTICES, LINK_TRIANGLES]).toEqual([(LINK_SEGMENTS + 1) * RING + RING + 1, LINK_SEGMENTS * RING * 2 + RING + 2]);
    expect(Math.max(...geo.index)).toBe(spans.length * LINK_VERTICES - 1);
    // each link's triangles use its own vertices only
    for (let k = 0; k < spans.length; k++) {
      const own = [...geo.index.slice(k * LINK_TRIANGLES * 3, (k + 1) * LINK_TRIANGLES * 3)];
      expect(Math.min(...own)).toBe(k * LINK_VERTICES);
      expect(Math.max(...own)).toBe((k + 1) * LINK_VERTICES - 1);
    }
    expect(linkGeometry([], edges, layout.origin).positions).toHaveLength(0);
  });

  it('starts and ends a link just off the faces it joins, in scene coordinates, and arcs over the line between them', () => {
    const { layout, spans, edges } = line('enderio');
    const geo = linkGeometry(spans, edges, layout.origin);
    // the raw input: from the input chest's south face (toward its conduit, origin 0 64 0) to the macerator's south face
    const [first] = geo.links;
    expect(spotPoint(first!.span.from, layout.origin)).toEqual([2.5, 0.5, 1 + LINK_LIFT]);
    expect(first!.path).toHaveLength(LINK_SEGMENTS + 1);
    close(first!.path[0]!, [2.5, 0.5, 1 + LINK_LIFT]);
    close(first!.path.at(-1)!, [0.5, 0.5, 1 + LINK_LIFT]);
    // the tube's first and last rings are round those ends
    close(mean([0, 1, 2, 3].map((i) => at(geo.positions, i))), [2.5, 0.5, 1 + LINK_LIFT]);
    close(mean([0, 1, 2, 3].map((i) => at(geo.positions, LINK_SEGMENTS * RING + i))), [0.5, 0.5, 1 + LINK_LIFT]);
    // it leaves the face outward and rises above both ends in between
    expect(first!.path[1]![2]).toBeGreaterThan(1 + LINK_LIFT);
    expect(Math.min(...first!.path.slice(1, -1).map((p) => p[1]))).toBeGreaterThan(0.5);
    expect(Math.max(...first!.path.map((p) => p[1]))).toBeGreaterThan(1.2);
    // a block's top: just above it
    const { layout: routed, spans: rs, edges: re } = line('routed');
    close(linkGeometry(rs, re, routed.origin).links[0]!.path[0]!, [2.5, 1 + LINK_LIFT, 0.5]);
  });

  it("colours a link by its EnderIO channel, else by what carries it, as the Connections tab draws it", () => {
    const { layout, spans, edges } = line('enderio');
    const geo = linkGeometry(spans, edges, layout.origin);
    const rgb = (k: number, i: number): Vec3 => at(geo.colors, k * LINK_VERTICES + i);
    const want = (c: Vec3): Vec3 => [c[0] / 255, c[1] / 255, c[2] / 255];
    // raw input on Blue, the dust on Red, the ingot on Yellow, every vertex of each
    for (const [k, color] of [[0, 'blue'], [1, 'red'], [2, 'yellow']] as const) {
      for (let i = 0; i < LINK_VERTICES; i++) close(rgb(k, i), want(dyeRgb(color)));
      expect(geo.links[k]!.color).toEqual(dyeRgb(color));
    }
    const routed = line('routed');
    expect(routed.g.edges.map((e) => linkColor(e))).toEqual([VIA_RGB.routed, VIA_RGB.routed, VIA_RGB.routed, VIA_RGB.attached, VIA_RGB.attached]);
    expect([VIA_RGB.routed, VIA_RGB.ae2, VIA_RGB.gt_pipe, VIA_RGB.fluid_pipe]).toEqual([[255, 112, 67], [126, 87, 194], [156, 204, 101], [30, 136, 229]]);
  });

  it('points the arrowhead halfway along the link, the way its good goes', () => {
    const { layout, spans, edges } = line('enderio');
    const geo = linkGeometry(spans, edges, layout.origin);
    for (const [k, link] of geo.links.entries()) {
      const base = mean([0, 1, 2, 3].map((i) => at(geo.positions, k * LINK_VERTICES + (LINK_SEGMENTS + 1) * RING + i)));
      const tip = at(geo.positions, (k + 1) * LINK_VERTICES - 1);
      const mid = LINK_SEGMENTS / 2;
      const along = minus(link.path[mid + 1]!, link.path[mid - 1]!);
      expect(dot(minus(tip, base), along)).toBeGreaterThan(0);
      close(mean([tip, base]), link.path[mid]!, 3);   // centred on the middle of the link
      // and the whole link runs from its source to its target: the tip is nearer the target than the base is
      const end = link.path.at(-1)!;
      expect(Math.hypot(...minus(end, tip))).toBeLessThan(Math.hypot(...minus(end, base)));
    }
  });

  it("gives every vertex its link's higher layer, so the layer slider can hide it", () => {
    const { layout, spans, edges } = line('enderio');
    const lifted = spans.map((s, i) => (i === 2 ? { ...s, to: { ...s.to, cell: [s.to.cell[0], 66, s.to.cell[2]] as Vec3 } } : s));
    const geo = linkGeometry(lifted, edges, layout.origin);
    expect(geo.links.map((l) => l.layer)).toEqual([0, 0, 2]);
    expect([...new Set(geo.layers.slice(2 * LINK_VERTICES))]).toEqual([2]);
    expect([...new Set(geo.layers.slice(0, 2 * LINK_VERTICES))]).toEqual([0]);
  });

  it('finds the link a ray from the camera passes, the nearest first, within the distance it allows', () => {
    const { layout, spans, edges } = line('enderio');
    const [link] = linkGeometry([spans[1]!], edges, layout.origin).links;   // the dust, from the macerator to the assembler
    const mid = link!.path[LINK_SEGMENTS / 2]!;
    const down: Vec3 = [0, -1, 0];
    const from = (p: Vec3, up = 10): Vec3 => [p[0], p[1] + up, p[2]];
    const hit = pickLink([link!], from(mid), down, () => 0.05)!;
    expect(hit.link).toBe(0);
    expect(hit.t).toBeCloseTo(10, 1);
    expect(pickLink([link!], from([mid[0] + 3, mid[1], mid[2] + 3]), down, () => 0.05)).toBeNull();
    // a ray that passes two links stops at the nearer: here the one drawn 2 blocks higher
    const higher = { ...link!, path: link!.path.map((p): Vec3 => [p[0], p[1] + 2, p[2]]) };
    expect(pickLink([link!, higher], from(mid), down, () => 0.05)!.link).toBe(1);
    // what the layer slider hides is never picked
    expect(pickLink([link!, higher], from(mid), down, () => 0.05, (l) => l !== higher)!.link).toBe(0);
    // the allowance grows with the distance along the ray: 0.3 blocks to the side is too far at 0.05, near enough at 0.04 a block
    const aside = from([mid[0], mid[1], mid[2] + 0.3]);
    expect(pickLink([link!], aside, down, () => 0.05)).toBeNull();
    expect(pickLink([link!], aside, down, (t) => 0.04 * t)!.link).toBe(0);
  });

  it('marks a picked link with a thicker white tube and a white frame on each of its two faces', () => {
    const { layout, spans, edges } = line('enderio');
    const link = linkGeometry(spans, edges, layout.origin).links[1]!;   // the macerator's south face to the assembler's
    const sel = selectionGeometry(link, layout.origin);
    expect([...new Set(sel.colors)]).toEqual([1]);
    expect(sel.index.length % 3).toBe(0);
    expect(Math.max(...sel.index)).toBe(sel.positions.length / 3 - 1);
    // the frames: 8 vertices each, last, on the plane just off each face, around the face's centre
    const n = sel.positions.length / 3;
    const frame = (first: number) => Array.from({ length: 8 }, (_, i) => at(sel.positions, first + i));
    for (const [points, cx] of [[frame(n - 16), 0.5], [frame(n - 8), 1.5]] as const) {
      for (const p of points) {
        expect(p[2]).toBeGreaterThan(1);
        expect(p[2]).toBeLessThan(1 + 2 * LINK_LIFT);
        expect(Math.abs(p[0] - cx)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(p[1] - 0.5)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
      close(mean(points), [cx, 0.5, points[0]![2]]);
    }
    // the tube round the link is thicker than the link's own
    const ring = [0, 1, 2, 3].map((i) => at(sel.positions, i));
    expect(Math.hypot(...minus(ring[0]!, link.path[0]!))).toBeGreaterThan(0.06);
    expect([...new Set(sel.layers)]).toEqual([0]);
  });

  it('stays one light geometry, quickly built, for a line of more than a thousand blocks', () => {
    // 30 steps of 20 machines, each feeding the next machine to machine, a pipe in front of every machine
    const steps = 30, per = 20;
    const blocks: LayoutBlock[] = [];
    for (let s = 0; s < steps; s++) {
      for (let m = 0; m < per; m++) {
        const x = s * per + m;
        blocks.push({ pos: [x, 64, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, role: 'machine', facing: 3, stepId: `s${s}`, label: `Machine ${s}` },
          { pos: [x, 64, 1], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 5600 }, role: 'pipe', label: 'Tin Item Pipe', connections: 16 | 32 });
      }
    }
    const plan: Plan = { ...connPlan, steps: Array.from({ length: steps }, (_, s) => ({ ...connPlan.steps[0]!, id: `s${s}`, count: per })),
      flows: Array.from({ length: steps - 1 }, (_, s) => ({ from: `s${s}`, to: `s${s + 1}`, key: `t:k${s}@0`, perSecond: 1 })) };
    const layout: Layout = { ...connLayout('direct'), size: [steps * per, 1, 2], blocks };
    const started = performance.now();
    const g = connectionsGraph(layout, plan, 'min');
    const spans = connectionSpans(layout, g);
    const geo = linkGeometry(spans, new Map(g.edges.map((e) => [e.id, e])), layout.origin);
    const ms = performance.now() - started;
    expect(blocks.length).toBeGreaterThan(1000);
    expect(spans).toHaveLength((steps - 1) * per);                    // 20 × 20 is past the cap: each machine once each way
    expect(geo.positions).toHaveLength(spans.length * LINK_VERTICES * 3);
    expect(geo.index).toHaveLength(spans.length * LINK_TRIANGLES * 3);
    expect(ms).toBeLessThan(1000);
  });

  it('leaves out the links to a hookup and to its blocks while hookups are hidden', () => {
    const { layout, g, spans } = line('ae2');
    expect(spansShown(spans, g, layout, true)).toEqual(spans);
    // the raw inputs and final outputs come in at the hookup's cable
    expect(spansShown(spans, g, layout, false).map((s) => s.edge)).toEqual(['flow:step:a>step:b:t:dust@0', 'attach:iface:0,64,1>step:a', 'attach:iface:1,64,1>step:b']);
  });
});
