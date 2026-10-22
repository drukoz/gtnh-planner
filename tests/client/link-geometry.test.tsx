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
// for the tests after the commit's own (the review of f9fe23e)
import { LINK_RADIUS, linksSummary } from '../../src/client/three/link-geometry.ts';
// for the tests after the commit's own (the review of f82c98c)
import { connectionPieces } from '../../src/client/connections/model.ts';
import {
  LINK_DIMMED, LINK_HIDDEN, LINK_SHOWN, goodRgb, hoverGeometry, linkColors, linkStates, linkTriangles, linkVertices, linksLegend, linksOfBlock, solidColumns,
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
/** `steps` steps of `per` machines in a row, each feeding the next machine to machine, a pipe in front of every machine. */
const bigLine = (steps: number, per: number): { layout: Layout; plan: Plan } => {
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
  return { layout: { ...connLayout('direct'), size: [steps * per, 1, 2], blocks }, plan };
};

describe("the 3D view's connections of a machine run by hand", () => {
  // the line's layout:hand:b:fill step: the Advanced Assembler is filled by hand (server modes/by-hand.ts)
  const handLine = (mode: LogisticsMode) => {
    const layout: Layout = { ...connLayout(mode), buildSteps: [{ id: 'layout:hand:b:fill', order: 1, kind: 'logistics',
      text: 'Fill the Advanced Assembler by hand: 1× Titanium Dust a run (from the output chest)' }] };
    const g = connectionsGraph(layout, connPlan, 'min');
    return { layout, g, spans: connectionSpans(layout, g), edges: new Map(g.edges.map((e) => [e.id, e])) };
  };

  it('draws a flow carried by hand in its own colour and names it so in the legend', () => {
    for (const mode of ['routed', 'enderio'] as const) {
      const { layout, g, spans, edges } = handLine(mode);
      const dust = g.edges.find((e) => e.key === 't:dust@0')!;
      expect([dust.via, linkColor(dust)], mode).toEqual(['hand', VIA_RGB.hand]);
      const drawn = linkGeometry(spans, edges, layout.origin).links;
      expect(linksLegend(g, drawn, false).find((r) => r.rgb.join() === VIA_RGB.hand.join())?.label, mode).toBe('By hand');
    }
    // an EnderIO line whose other flows ride one channel still colours each of its goods, and the hand link by hand
    const { g } = handLine('enderio');
    const { color } = linkColors(g);
    expect(color(g.edges.find((e) => e.key === 't:dust@0')!)).toEqual(VIA_RGB.hand);
    expect(VIA_RGB.hand).not.toEqual(VIA_RGB.routed);
  });

  it('names a flow carried by hand from your storage among the links it has nowhere to draw, not among those an ME network would carry', () => {
    // an AE2 line whose base has no ME network (no logistics hookup), whose first machine you fill by hand
    const layout: Layout = { ...connLayout('ae2'), hookups: [], blocks: connLayout('ae2').blocks.filter((b) => b.hookup === undefined),
      buildSteps: [{ id: 'layout:hand:a:fill', order: 1, kind: 'logistics', text: 'Fill the Basic Macerator by hand: 1× Raw Input a run (from your storage)' }] };
    const g = connectionsGraph(layout, connPlan, 'min');
    const all = connectionPieces(layout, g);
    const summary = linksSummary(g, all, linkGeometry(all.spans, new Map(g.edges.map((e) => [e.id, e])), layout.origin).links, true, layout);
    expect(summary.unplaced).toEqual(['Raw Input 60/min · by hand: Raw inputs → 1× Basic Macerator']);
    expect(summary.noNetwork).toEqual(['Titanium Ingot 60/min: 1× Advanced Assembler → Final outputs']);
  });
});

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
    const { layout, plan } = bigLine(steps, per);
    const started = performance.now();
    const g = connectionsGraph(layout, plan, 'min');
    const spans = connectionSpans(layout, g);
    const geo = linkGeometry(spans, new Map(g.edges.map((e) => [e.id, e])), layout.origin);
    const ms = performance.now() - started;
    expect(layout.blocks.length).toBeGreaterThan(1000);
    expect(spans).toHaveLength((steps - 1) * 8);                      // 20 × 20 is past the cap: 8 pieces a link
    expect(geo.positions).toHaveLength(geo.links.at(-1)!.end * 3);
    expect(geo.index.length / 3).toBe(geo.links.reduce((n, l) => n + linkTriangles(l.path.length - 1), 0));
    expect(ms).toBeLessThan(1000);
  });

  // the review of f9fe23e: 16 machines a step stayed under the old cap, so every link was 256 tubes
  it('keeps a line of 16-machine steps light, and finds the link under the pointer quickly among thousands', () => {
    const steps = 60, per = 16;
    const { layout, plan } = bigLine(steps, per);
    const g = connectionsGraph(layout, plan, 'min');
    const edges = new Map(g.edges.map((e) => [e.id, e]));
    const spans = connectionSpans(layout, g);
    const geo = linkGeometry(spans, edges, layout.origin);
    expect(layout.blocks).toHaveLength(1920);
    expect(spans).toHaveLength((steps - 1) * 8);                      // 16 × 16 is past the cap: 8 pieces a link
    expect(geo.positions.length / 3).toBeLessThan(60_000);            // 472 pieces of 57 vertices or more
    expect(geo.index.length / 3).toBeLessThan(110_000);               // and of 106 triangles or more
    // each machine with each, as a denser drawing would be: 15,104 pieces, yet a pick stays far under a frame
    const top = (x: number) => ({ cell: [x, 64, 0] as Vec3, side: 1, face: null });
    const dense = g.edges.flatMap((e, s) => Array.from({ length: per * per }, (_, k): ConnSpan =>
      ({ edge: e.id, from: top(s * per + Math.floor(k / per)), to: top((s + 1) * per + (k % per)) })));
    const many = linkGeometry(dense, edges, layout.origin).links;
    expect(many).toHaveLength(15_104);
    const ray = (): ReturnType<typeof pickLink> => pickLink(many, [10, 20, 10], [0, -Math.SQRT1_2, -Math.SQRT1_2], (t) => 0.004 * t);
    const first = ray();
    const picks: Array<ReturnType<typeof pickLink>> = [];
    const started = performance.now();
    for (let i = 0; i < 50; i++) picks.push(ray());
    const perPick = (performance.now() - started) / 50;
    for (const p of picks) expect(p).toEqual(first);
    // about 0.8 ms a pick on a quiet machine; the bound leaves room for a busy shared host and still catches a scan of
    // every link (14.7 ms a pick before the bounding-sphere skip)
    expect(perPick).toBeLessThan(6);
  });

  it('leaves out the links to a hookup and to its blocks while hookups are hidden', () => {
    const { layout, g, spans } = line('ae2');
    expect(spansShown(spans, g, layout, true)).toEqual(spans);
    // the raw inputs and final outputs come in at the hookup's cable
    expect(spansShown(spans, g, layout, false).map((s) => s.edge)).toEqual(['flow:step:a>step:b:t:dust@0', 'attach:iface:0,64,1>step:a', 'attach:iface:1,64,1>step:b']);
  });

  // the review of f9fe23e: what the note under the view counts and names; the review of f82c98c: and what it does not
  it('counts the pieces and the links drawn, those hidden with the hookups, and names each link that has nowhere in the line to be drawn', () => {
    const { layout, g } = line('ae2');
    const all = connectionPieces(layout, g);
    const drawn = (shown: ConnSpan[]) => linkGeometry(shown, new Map(g.edges.map((e) => [e.id, e])), layout.origin).links;
    const none = { more: 0, hidden: 0, unplaced: [], noNetwork: [] };
    // the hookup joins the base's ME network where that comes in: its cable shows it, so it is no link left undrawn
    expect(linksSummary(g, all, drawn(all.spans), true, layout)).toEqual({ ...none, pieces: 5, links: 5 });
    // while hookups are hidden, so are the links to the hookup's cable, and the note counts them
    expect(linksSummary(g, all, drawn(spansShown(all.spans, g, layout, false)), false, layout)).toEqual({ ...none, pieces: 3, links: 3, hidden: 2 });
    // a link drawn in two pieces counts once; a flow without a piece names its good and rate too, links in graph order
    const some = { ...all, spans: [...all.spans.slice(1), { ...all.spans[1]!, to: { cell: [4, 64, 0] as Vec3, side: 1, face: null } }] };
    expect(linksSummary(g, some, drawn(some.spans), true, layout)).toEqual({ ...none, pieces: 5, links: 4, unplaced: ['Raw Input 60/min: Raw inputs → 1× Basic Macerator'] });
    // pieces left out of links between big steps count when their link is drawn
    expect(linksSummary(g, { ...all, more: new Map([[all.spans[1]!.edge, 7], ['nope', 3]]) }, drawn(all.spans), true, layout).more).toBe(7);
    // an AE2 line with no ME network to hook into: its raw inputs and final outputs have nowhere to come in or go
    const alone: Layout = { ...layout, hookups: [], blocks: layout.blocks.filter((b) => b.hookup === undefined) };
    const lone = connectionsGraph(alone, connPlan, 'min');
    const pieces = connectionPieces(alone, lone);
    expect(linksSummary(lone, pieces, drawn(pieces.spans), true, alone)).toEqual({ ...none, pieces: 3, links: 3,
      noNetwork: ['Raw Input 60/min: Raw inputs → 1× Basic Macerator', 'Titanium Ingot 60/min: 1× Advanced Assembler → Final outputs'] });
  });
});

// The review of f9fe23e: links that join the same two faces (two goods from one step to the next, a loop back) fan out
// side by side, so each one shows and each one can be hovered and clicked.
describe("the 3D view's connections between the same two faces", () => {
  const down: Vec3 = [0, -1, 0];
  const above = (p: Vec3): Vec3 => [p[0], p[1] + 10, p[2]];
  const middle = (path: readonly Vec3[]): Vec3 => path[LINK_SEGMENTS / 2]!;
  /** The direct line with `flows` added to the plan's own. */
  const withFlows = (flows: Plan['flows']) => {
    const layout = connLayout('direct');
    const g = connectionsGraph(layout, { ...connPlan, flows: [...connPlan.flows, ...flows] }, 'min');
    const geo = linkGeometry(connectionSpans(layout, g), new Map(g.edges.map((e) => [e.id, e])), layout.origin);
    return { layout, geo };
  };

  it('draws two goods from one step to the next as two arcs side by side, each its own to pick', () => {
    // the macerator hands the assembler a second good: both links join the macerator's top to the assembler's
    const { layout, geo } = withFlows([{ from: 'a', to: 'b', key: 't:tiny@0', perSecond: 1 }]);
    const pair = geo.links.filter((l) => l.span.edge.startsWith('flow:step:a>step:b:'));
    expect(pair.map((l) => l.span.edge)).toEqual(['flow:step:a>step:b:t:dust@0', 'flow:step:a>step:b:t:tiny@0']);
    expect(pair[1]!.span.from).toEqual(pair[0]!.span.from);
    expect(pair[1]!.span.to).toEqual(pair[0]!.span.to);
    for (const l of pair) {
      close(l.path[0]!, spotPoint(l.span.from, layout.origin));   // both still leave and reach their own faces
      close(l.path.at(-1)!, spotPoint(l.span.to, layout.origin));
    }
    // apart in the middle by more than a tube's width, and a ray down onto each middle names that link
    expect(Math.hypot(...minus(middle(pair[0]!.path), middle(pair[1]!.path)))).toBeGreaterThan(4 * LINK_RADIUS);
    for (const l of pair) {
      const hit = pickLink(geo.links, above(middle(l.path)), down, () => 0.05);
      expect(geo.links[hit!.link]!.span.edge).toBe(l.span.edge);
    }
  });

  it('draws a link and the one coming back between the same two faces apart, their arrows pointing opposite ways', () => {
    const { geo } = withFlows([{ from: 'b', to: 'a', key: 't:back@0', perSecond: 1 }]);
    const there = geo.links.find((l) => l.span.edge === 'flow:step:a>step:b:t:dust@0')!;
    const back = geo.links.find((l) => l.span.edge === 'flow:step:b>step:a:t:back@0')!;
    expect([back.span.from, back.span.to]).toEqual([there.span.to, there.span.from]);
    expect(Math.hypot(...minus(middle(there.path), middle(back.path)))).toBeGreaterThan(4 * LINK_RADIUS);
    for (const l of [there, back]) expect(geo.links[pickLink(geo.links, above(middle(l.path)), down, () => 0.05)!.link]).toBe(l);
    const way = (path: readonly Vec3[]) => minus(path[LINK_SEGMENTS / 2 + 1]!, path[LINK_SEGMENTS / 2 - 1]!);
    expect(dot(way(there.path), way(back.path))).toBeLessThan(0);
  });

  it('picks the link the pointer is on before a nearer one that only comes within the allowance', () => {
    const { layout, spans, edges } = line('enderio');
    const [link] = linkGeometry([spans[1]!], edges, layout.origin).links;
    // a second link 0.3 blocks to the side and a little higher, so nearer the camera above both
    const beside = { ...link!, path: link!.path.map((p): Vec3 => [p[0], p[1] + 0.04, p[2] + 0.3]) };
    const onLink = above(middle(link!.path));
    expect(pickLink([beside, link!], onLink, down, () => 0.4)!.link).toBe(1);
    // and of two it only comes near, the nearer to the pointer, though the other is nearer the camera
    const nearLink: Vec3 = [onLink[0], onLink[1], onLink[2] + 0.1];
    expect(pickLink([link!, beside], nearLink, down, () => 0.4)!.link).toBe(0);
    // what lies past `limit` along the ray (behind the first solid block) is never picked, so a link before it that the
    // ray only comes near is
    const low = { ...link!, path: link!.path.map((p): Vec3 => [p[0], p[1] - 1, p[2]]) };
    const aside = { ...link!, path: link!.path.map((p): Vec3 => [p[0], p[1], p[2] + 0.2]) };
    const onLow = above(middle(low.path));                           // on the low link 10 blocks on, past the other at 9
    expect(pickLink([low, aside], onLow, down, () => 0.4)!.link).toBe(0);
    expect(pickLink([low, aside], onLow, down, () => 0.4, () => true, 9.5)).toEqual({ link: 1, t: expect.closeTo(9, 1) });
  });
});

// The review of f82c98c: fans that stay out of the blocks they join, arcs that clear the line's solid blocks, long
// arcs drawn smooth, and what the 3D view uses to keep a busy line readable.
describe("the 3D view's connections, readable on real lines", () => {
  const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
  const machine = (pos: Vec3): LayoutBlock => ({ pos, block: GT(2001), role: 'machine', facing: 3, stepId: 'a', label: 'Machine' });
  const casing = (pos: Vec3): LayoutBlock => ({ pos, block: { id: 'gregtech:gt.blockcasings', meta: 11 }, role: 'casing', label: 'Casing' });
  const spot = (cell: Vec3, side: number): ConnSpan['from'] => ({ cell, side, face: null });
  const { layout: fixture, edges } = line('direct');
  const edge = 'flow:step:a>step:b:t:dust@0';
  const middle = (path: readonly Vec3[]): Vec3 => path[(path.length - 1) / 2]!;
  /** Every point of a drawn centre line, eight between each two of its points. */
  const samples = (path: readonly Vec3[]): Vec3[] => path.slice(1).flatMap((b, i) => Array.from({ length: 8 }, (_, k): Vec3 => {
    const a = path[i]!, f = k / 8;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }));
  /** The samples of a drawn link inside a solid block of `layout` (scene coordinates from origin 0 64 0). */
  const inside = (layout: Layout, path: readonly Vec3[]): Vec3[] => {
    const solid = new Set(layout.blocks.filter((b) => b.role !== 'ghost' && !['cable', 'pipe', 'chip_pipe'].includes(b.role))
      .map((b) => `${b.pos[0]},${b.pos[1] - 64},${b.pos[2]}`));
    return samples(path).filter((p) => solid.has(`${Math.floor(p[0])},${Math.floor(p[1])},${Math.floor(p[2])}`));
  };

  it('fans links between two tops out level, centred on where one alone goes, a gap apart that shrinks in a big group', () => {
    const alone = middle(linkGeometry([{ edge, from: spot([0, 64, 0], 1), to: spot([3, 64, 0], 1) }], edges, fixture.origin).links[0]!.path);
    for (const n of [2, 5, 13]) {
      const spans = Array.from({ length: n }, (): ConnSpan => ({ edge, from: spot([0, 64, 0], 1), to: spot([3, 64, 0], 1) }));
      const middles = linkGeometry(spans, edges, fixture.origin).links.map((l) => middle(l.path));
      // level, across the line between the two ends (along z), centred
      for (const m of middles) close([m[0], m[1]], [alone[0], alone[1]], 6);
      close(mean(middles), alone, 6);
      const gaps = middles.slice(1).map((m, k) => m[2] - middles[k]![2]);
      for (const gap of gaps) expect(gap).toBeCloseTo(Math.max(0.12, Math.min(0.3, 1.2 / (n - 1))), 6);
      expect(middles.at(-1)![2] - middles[0]![2]).toBeLessThanOrEqual(1.44 + 1e-9);
    }
  });

  it('fans links between sides that look along the fan out of both faces, and between sides that look either way upward', () => {
    // both south faces: the fan goes south only, never back into the blocks
    const same = Array.from({ length: 4 }, (): ConnSpan => ({ edge, from: spot([0, 64, 0], 3), to: spot([3, 64, 0], 3) }));
    const alone = middle(linkGeometry([same[0]!], edges, fixture.origin).links[0]!.path);
    const out = linkGeometry(same, edges, fixture.origin).links.map((l) => middle(l.path));
    close(out[0]!, alone, 6);
    out.slice(1).forEach((m, k) => {
      expect(m[2]).toBeGreaterThan(out[k]![2] + 0.12);
      close([m[0], m[1]], [alone[0], alone[1]], 6);
    });
    // a south face and a north face across from it: the fan rises, each link above the one before
    const across = Array.from({ length: 4 }, (): ConnSpan => ({ edge, from: spot([0, 64, 0], 3), to: spot([1, 64, 2], 2) }));
    const up = linkGeometry(across, edges, fixture.origin).links.map((l) => middle(l.path));
    up.slice(1).forEach((m, k) => {
      expect(m[1]).toBeCloseTo(up[k]![1] + 0.3, 6);
      close([m[0], m[2]], [up[0]![0], up[0]![2]], 6);
    });
    // and a link coming back between the same two faces is one of the same fan
    const back = linkGeometry([across[0]!, { edge, from: across[0]!.to, to: across[0]!.from }], edges, fixture.origin).links.map((l) => middle(l.path));
    expect(back[1]![1] - back[0]![1]).toBeCloseTo(0.3, 6);
  });

  it('rises clear of the solid blocks between its ends, steeply only next to them, and only when told what they are', () => {
    // a tower of four casings between two machines' tops, and one right beside the first of two machines far apart
    const tower = (x: number): LayoutBlock[] => [64, 65, 66, 67].map((y) => casing([x, y, 0]));
    const layout: Layout = { ...fixture, size: [15, 4, 1], blocks: [machine([0, 64, 0]), ...tower(2), machine([4, 64, 0]), machine([7, 64, 0]), ...tower(8), machine([14, 64, 0])] };
    const over: ConnSpan = { edge, from: spot([0, 64, 0], 1), to: spot([4, 64, 0], 1) };
    const beside: ConnSpan = { edge, from: spot([7, 64, 0], 1), to: spot([14, 64, 0], 1) };
    const plain = linkGeometry([over, beside], edges, layout.origin).links;
    expect(plain.map((l) => inside(layout, l.path).length > 0)).toEqual([true, true]);
    const clear = linkGeometry([over, beside], edges, layout.origin, { solid: solidColumns(layout) }).links;
    expect(clear.map((l) => inside(layout, l.path))).toEqual([[], []]);
    // over the tower half a block clear of its top (4 from the origin)
    const above = samples(clear[0]!.path).filter((p) => p[0] >= 2 && p[0] < 3);
    expect(Math.min(...above.map((p) => p[1]))).toBeGreaterThanOrEqual(4.5 - 1e-9);
    // beside it: the climb is all at the tower's end, so the arc is highest in its first half
    const path = clear[1]!.path;
    const top = path.reduce((k, p, i) => (p[1] > path[k]![1] ? i : k), 0);
    expect(top).toBeLessThan((path.length - 1) / 2);
    expect(solidColumns(layout).get('2,0')).toBe(4);
    expect(solidColumns(layout).has('1,0')).toBe(false);
  });

  it('comes down to a chest beside a tall multiblock without passing through it', () => {
    // an EBF-sized block of casings (3 × 4 × 3), a chest beside its corner, a machine further off, and a link from the
    // machine to each face of the chest that shows
    const ebf = [0, 1, 2].flatMap((x) => [0, 1, 2].flatMap((z) => [64, 65, 66, 67].map((y) => casing([x, y, z]))));
    const layout: Layout = { ...fixture, size: [9, 4, 5], blocks: [...ebf, { ...machine([3, 64, 0]), role: 'chest', label: 'Chest' }, machine([8, 64, 4])] };
    const solid = solidColumns(layout);
    for (const side of [1, 2, 3, 5]) {
      for (const [from, to] of [[spot([8, 64, 4], 1), spot([3, 64, 0], side)], [spot([3, 64, 0], side), spot([8, 64, 4], 4)]] as const) {
        const [link] = linkGeometry([{ edge, from, to }], edges, layout.origin, { solid }).links;
        expect(inside(layout, link!.path), `side ${side}`).toEqual([]);
      }
    }
  });

  it('draws a long arc with more straight pieces than a short one, its arrowhead on its middle point', () => {
    const lengths = [3, 30, 60, 300];
    const geo = linkGeometry(lengths.map((x): ConnSpan => ({ edge, from: spot([0, 64, 0], 1), to: spot([x, 64, 0], 1) })), edges, fixture.origin);
    const segments = geo.links.map((l) => l.path.length - 1);
    expect(segments[0]).toBe(12);
    expect(segments[1]).toBeGreaterThan(24);
    expect(segments.slice(2)).toEqual([48, 48]);
    for (const n of segments) expect(n % 2).toBe(0);
    // one link after the other: each its own vertices and triangles, the arrowhead's tip last, its middle on the line's
    let triangle = 0;
    geo.links.forEach((l, k) => {
      const n = l.path.length - 1;
      expect([l.start, l.end - l.start]).toEqual([k === 0 ? 0 : geo.links[k - 1]!.end, linkVertices(n)]);
      const own = [...geo.index.slice(triangle * 3, (triangle + linkTriangles(n)) * 3)];
      expect([Math.min(...own), Math.max(...own)]).toEqual([l.start, l.end - 1]);
      triangle += linkTriangles(n);
      const base = mean([0, 1, 2, 3].map((i) => at(geo.positions, l.start + (n + 1) * RING + i)));
      close(mean([at(geo.positions, l.end - 1), base]), middle(l.path), 3);
    });
    expect(triangle * 3).toBe(geo.index.length);
  });

  it('marks the link under the pointer thicker and lighter, and fades or hides the others', () => {
    const { layout, g, spans, edges: all } = line('enderio');
    const geo = linkGeometry(spans, all, layout.origin);
    const link = geo.links[1]!;
    const hover = hoverGeometry(link);
    expect(hover.positions.length / 3).toBe(linkVertices(link.path.length - 1));
    const ring = [0, 1, 2, 3].map((i) => at(hover.positions, i));
    expect(Math.hypot(...minus(ring[0]!, link.path[0]!))).toBeCloseTo(0.075, 6);
    const rgb = at(hover.colors, 0);
    rgb.forEach((c, k) => expect(c * 255).toBeGreaterThan(link.color[k]!));
    // the others fade while one is hovered; Focus hides what it leaves out, faded or not
    const states = linkStates(geo.links, 1, null);
    expect(states).toHaveLength(geo.links.at(-1)!.end);
    expect(geo.links.map((l) => states[l.start])).toEqual([LINK_DIMMED, LINK_SHOWN, LINK_DIMMED]);
    expect([...new Set(states.slice(link.start, link.end))]).toEqual([LINK_SHOWN]);
    const focus = linkStates(geo.links, 0, (l) => l !== geo.links[2]);
    expect(geo.links.map((l) => focus[l.start])).toEqual([LINK_SHOWN, LINK_DIMMED, LINK_HIDDEN]);
    expect([...new Set(linkStates(geo.links, null, null))]).toEqual([0]);
    // Focus on machine a: the links of its box (the raw input and the dust); on the chests' conduit: what ends beside
    // it
    const of = (block: number) => geo.links.filter(linksOfBlock(g, layout, block)).map((l) => l.span.edge);
    const a = layout.blocks.findIndex((b) => b.stepId === 'a');
    expect(of(a)).toEqual(['flow:chest:2,64,0>step:a:t:in@0', 'flow:step:a>step:b:t:dust@0']);
    const conduit = layout.blocks.findIndex((b) => b.pos.join() === '2,64,1');
    expect(of(conduit)).toEqual(['flow:chest:2,64,0>step:a:t:in@0', 'flow:step:b>chest:2,64,2:t:ingot@0']);
  });

  it('colours each good its own colour on an EnderIO line whose flows all ride one channel, else as the Connections tab', () => {
    const { g } = line('enderio');
    // three channels: as the Connections tab draws them
    expect(linkColors(g).byGood).toBeNull();
    expect(g.edges.map((e) => linkColors(g).color(e))).toEqual(g.edges.map((e) => linkColor(e)));
    // one channel: a colour per good, the same for the same good, and links that carry nothing as before
    const reds = g.edges.map((e) => ({ ...e, color: 'red' as const }));
    const red = { ...g, edges: [...reds, { ...reds[0]!, id: 'again' }, { ...reds[0]!, id: 'attach', key: null, color: null, via: 'attached' as const }] };
    const { color, byGood } = linkColors(red);
    expect(byGood).toBe('red');
    const colours = red.edges.map((e) => color(e).join());
    expect(colours.slice(0, 3)).toEqual([goodRgb(0), goodRgb(1), goodRgb(2)].map((c) => c.join()));
    expect(new Set(colours.slice(0, 3)).size).toBe(3);
    expect(colours[3]).toBe(colours[0]);
    expect(colours[4]).toBe(VIA_RGB.attached.join());
    // the routed line keeps the colours of what carries each link: none is a channel
    expect(linkColors(line('routed').g).byGood).toBeNull();
    // the legend: each colour once with what it means, or only what carries nothing while goods have their own colours
    const routed = line('routed');
    const drawn = linkGeometry(routed.spans, routed.edges, routed.layout.origin).links;
    expect(linksLegend(routed.g, drawn, false)).toEqual([{ rgb: VIA_RGB.routed, label: 'Routed network' }, { rgb: VIA_RGB.attached, label: 'Interface or hookup' }]);
    expect(linksLegend(routed.g, drawn, true)).toEqual([{ rgb: VIA_RGB.attached, label: 'Interface or hookup' }]);
    const eio = line('enderio');
    expect(linksLegend(eio.g, linkGeometry(eio.spans, eio.edges, eio.layout.origin).links, false).map((r) => r.label)).toEqual(['Blue channel', 'Red channel', 'Yellow channel']);
  });
});
