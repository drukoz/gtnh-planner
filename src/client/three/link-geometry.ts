// The Connections tab's links in the 3D view (the user's requirements of 2026-10-19, item 3 (b)): every piece of a link
// (../connections/model.ts `connectionSpans`, so every logistics mode draws what its Connections tab draws) as a thin
// tube that leaves its source face, arcs over the line and comes down into the face it reaches, with an arrowhead
// halfway along that points the way, in its EnderIO channel's colour, else the colour of what carries it, as the
// Connections tab draws it. All of them are one batched geometry, so the viewer draws them in one call however many
// blocks the line has; each starts and ends a little off its faces so it never shares a plane with a block. Also the
// white tube and face frames that mark a picked link, which link a ray from the pointer meets, and which links show
// while hookups are hidden. Pure TypeScript — no DOM, no three.js — so it is tested without a browser; the viewer turns
// these arrays into meshes.

import { dyeRgb } from '../../shared/layout/enderio.ts';
import { DIRS, posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { Rgb } from '../../shared/types/assets.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { ConnEdge, ConnGraph, ConnSpan, ConnSpot, ConnVia } from '../connections/model.ts';

/**
 * The colour of what carries a link that has no channel, as the Connections tab draws it (styles.css `.conn-via-*`,
 * the map's LOGISTICS_COLORS; an interface on what it serves and a hookup in the flow diagram's link grey).
 */
export const VIA_RGB: Readonly<Record<ConnVia, Rgb>> = Object.freeze({
  gt_pipe: [156, 204, 101], fluid_pipe: [30, 136, 229], routed: [255, 112, 67], ae2: [126, 87, 194],
  item_conduit: [38, 198, 218], fluid_conduit: [38, 198, 218], attached: [138, 146, 160], hookup: [138, 146, 160],
});

/** A link tube's radius (blocks). */
export const LINK_RADIUS = 0.05;
/** The arrowhead's base radius and length (blocks). */
const ARROW_RADIUS = 0.14;
const ARROW_LENGTH = 0.36;
/** The straight pieces a link's arc is drawn with: even, so the arrowhead sits on its middle point. */
export const LINK_SEGMENTS = 12;
/** The sides of a tube and of an arrowhead. */
const SIDES = 4;
/** How far off its face a link starts and ends (blocks), so it never lies in the face's plane. */
export const LINK_LIFT = 0.03;
/** How far a link first heads out of its face, and how high it arcs: this much, and this much more per block it spans. */
const LEAVE = 0.45;
const RISE = 0.8;
const RISE_PER_BLOCK = 0.15;
/** One link's vertices: its tube's rings, then its arrowhead's base ring and tip. */
export const LINK_VERTICES = (LINK_SEGMENTS + 1) * SIDES + SIDES + 1;
/** One link's triangles: two per side of each straight piece, then the arrowhead's sides and its base. */
export const LINK_TRIANGLES = LINK_SEGMENTS * SIDES * 2 + SIDES + (SIDES - 2);
/** A picked link: a white tube and arrowhead this much bigger than its own, and a white frame on each of its faces. */
const PICKED_RGB: Rgb = [255, 255, 255];
const PICKED_TUBE = 1.8;
const PICKED_ARROW = 1.3;
/** A face frame's outer and inner half-widths (blocks): a band 1.5 px wide round the face's edge. */
const FRAME_OUTER = 8 / 16;
const FRAME_INNER = 6.5 / 16;

/** Vertex arrays for one mesh: xyz per vertex, rgb (0..1, sRGB: the shader writes them as they are), a layer per vertex, triangles. */
export interface LinkMesh { positions: Float32Array; colors: Float32Array; layers: Float32Array; index: Uint32Array }

/** One drawn piece of a link. */
export interface DrawnLink {
  span: ConnSpan;
  /** The tube's centre line, LINK_SEGMENTS + 1 points, in scene coordinates (blocks from the layout's origin). */
  path: Vec3[];
  color: Rgb;
  /** The higher layer of its two ends (y from the origin): the layer slider hides it while that layer is cut away. */
  layer: number;
}

/** Every piece of every link: link k owns vertices k × LINK_VERTICES … and triangles k × LINK_TRIANGLES …. */
export interface LinkGeometry extends LinkMesh { links: DrawnLink[] }

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 1, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

/** `p + u × a + v × b`. */
function along(p: Vec3, u: Vec3, a: number, v: Vec3 = [0, 0, 0], b = 0): Vec3 {
  return [p[0] + u[0] * a + v[0] * b, p[1] + u[1] * a + v[1] * b, p[2] + u[2] * a + v[2] * b];
}

/** The colour a link is drawn in: its EnderIO channel as the game draws it, else the colour of what carries it. */
export function linkColor(edge: ConnEdge): Rgb {
  return edge.color === null ? [...VIA_RGB[edge.via]] : dyeRgb(edge.color);
}

/** Where a link starts or ends: the centre of its face, LINK_LIFT off it, in scene coordinates. */
export function spotPoint(spot: ConnSpot, origin: Vec3): Vec3 {
  const d = DIRS[spot.side]!;
  return [0, 1, 2].map((k) => spot.cell[k]! - origin[k]! + 0.5 + d[k]! * 0.5 + d[k]! * LINK_LIFT) as Vec3;
}

/**
 * A link's centre line: a cubic Bézier from one face to the other that heads LEAVE out of each face and rises RISE plus
 * RISE_PER_BLOCK per block between its ends over them, sampled at LINK_SEGMENTS + 1 points.
 */
function arc(from: ConnSpot, to: ConnSpot, origin: Vec3): Vec3[] {
  const p0 = spotPoint(from, origin), p3 = spotPoint(to, origin);
  const rise = RISE + RISE_PER_BLOCK * Math.hypot(...sub(p3, p0));
  const p1 = along(along(p0, DIRS[from.side]!, LEAVE), [0, 1, 0], rise);
  const p2 = along(along(p3, DIRS[to.side]!, LEAVE), [0, 1, 0], rise);
  return Array.from({ length: LINK_SEGMENTS + 1 }, (_, i): Vec3 => {
    const t = i / LINK_SEGMENTS, u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    return [0, 1, 2].map((k) => w[0] * p0[k]! + w[1] * p1[k]! + w[2] * p2[k]! + w[3] * p3[k]!) as Vec3;
  });
}

/** A unit vector across the unit `t`: `prev` turned onto the plane across `t` (so a tube's rings never twist), else any. */
function acrossOf(t: Vec3, prev: Vec3 | null): Vec3 {
  const onto = (base: Vec3): Vec3 | null => {
    const w = along(base, t, -dot(base, t));
    const len = Math.hypot(w[0], w[1], w[2]);
    return len < 1e-6 ? null : [w[0] / len, w[1] / len, w[2] / len];
  };
  return (prev === null ? null : onto(prev)) ?? onto([0, 1, 0]) ?? onto([1, 0, 0])!;
}

/** Writes vertices, colours, layers and triangles into preallocated arrays, one shape after the other. */
class MeshWriter {
  readonly mesh: LinkMesh;
  vertices = 0;
  triangles = 0;

  constructor(mesh: LinkMesh) {
    this.mesh = mesh;
  }

  vertex(p: Vec3, color: Rgb, layer: number): number {
    const i = this.vertices++;
    this.mesh.positions.set(p, i * 3);
    this.mesh.colors.set([color[0] / 255, color[1] / 255, color[2] / 255], i * 3);
    this.mesh.layers[i] = layer;
    return i;
  }

  triangle(a: number, b: number, c: number): void {
    this.mesh.index.set([a, b, c], this.triangles++ * 3);
  }
}

function meshFor(vertices: number, triangles: number): LinkMesh {
  return { positions: new Float32Array(vertices * 3), colors: new Float32Array(vertices * 3), layers: new Float32Array(vertices), index: new Uint32Array(triangles * 3) };
}

/** A tube of `radius` round `path`: a ring of SIDES vertices per point, two triangles per side of each straight piece. */
function tube(out: MeshWriter, path: readonly Vec3[], radius: number, color: Rgb, layer: number): void {
  const first = out.vertices;
  let across: Vec3 | null = null;
  path.forEach((p, i) => {
    const t = unit(sub(path[Math.min(i + 1, path.length - 1)]!, path[Math.max(i - 1, 0)]!));
    across = acrossOf(t, across);
    const other = cross(t, across);
    for (let j = 0; j < SIDES; j++) {
      const a = (2 * Math.PI * j) / SIDES;
      out.vertex(along(p, across, radius * Math.cos(a), other, radius * Math.sin(a)), color, layer);
    }
  });
  for (let i = 0; i + 1 < path.length; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = first + i * SIDES + j, b = first + i * SIDES + ((j + 1) % SIDES);
      out.triangle(a, b, b + SIDES);
      out.triangle(a, b + SIDES, a + SIDES);
    }
  }
}

/** An arrowhead `scale` times the usual size on the middle of `path`, pointing along it: a base ring and a tip. */
function arrowhead(out: MeshWriter, path: readonly Vec3[], scale: number, color: Rgb, layer: number): void {
  const mid = LINK_SEGMENTS / 2;
  const centre = path[mid]!;
  const t = unit(sub(path[mid + 1]!, path[mid - 1]!));
  const across = acrossOf(t, null), other = cross(t, across);
  const half = (ARROW_LENGTH * scale) / 2;
  const base = along(centre, t, -half);
  const first = out.vertices;
  for (let j = 0; j < SIDES; j++) {
    const a = (2 * Math.PI * j) / SIDES;
    out.vertex(along(base, across, ARROW_RADIUS * scale * Math.cos(a), other, ARROW_RADIUS * scale * Math.sin(a)), color, layer);
  }
  const tip = out.vertex(along(centre, t, half), color, layer);
  for (let j = 0; j < SIDES; j++) out.triangle(first + j, first + ((j + 1) % SIDES), tip);
  for (let j = 1; j + 1 < SIDES; j++) out.triangle(first, first + j, first + j + 1);
}

/**
 * The geometry of `spans` (in order; a span whose link is not in `edges` is left out): per piece a tube of LINK_RADIUS
 * round its arc and an arrowhead halfway along, in `linkColor` of its link, every vertex with the piece's `layer`.
 */
export function linkGeometry(spans: readonly ConnSpan[], edges: ReadonlyMap<string, ConnEdge>, origin: Vec3): LinkGeometry {
  const known = spans.filter((s) => edges.has(s.edge));
  const out = new MeshWriter(meshFor(known.length * LINK_VERTICES, known.length * LINK_TRIANGLES));
  const links = known.map((span): DrawnLink => {
    const path = arc(span.from, span.to, origin);
    const color = linkColor(edges.get(span.edge)!);
    const layer = Math.max(span.from.cell[1], span.to.cell[1]) - origin[1];
    tube(out, path, LINK_RADIUS, color, layer);
    arrowhead(out, path, 1, color, layer);
    return { span, path, color, layer };
  });
  return { ...out.mesh, links };
}

/** A white square frame on the face `spot` names, LINK_LIFT off it: an outer and an inner square, four strips between them. */
function frame(out: MeshWriter, spot: ConnSpot, origin: Vec3, layer: number): void {
  const n = DIRS[spot.side]!;
  const centre = spotPoint(spot, origin);
  // two directions in the face's plane
  const u: Vec3 = n[0] !== 0 ? [0, 0, 1] : [1, 0, 0];
  const v = cross(n, u);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
  const first = out.vertices;
  for (const half of [FRAME_OUTER, FRAME_INNER]) {
    for (const [a, b] of corners) out.vertex(along(centre, u, a * half, v, b * half), PICKED_RGB, layer);
  }
  for (let k = 0; k < 4; k++) {
    const o0 = first + k, o1 = first + ((k + 1) % 4), i0 = o0 + 4, i1 = o1 + 4;
    out.triangle(o0, o1, i1);
    out.triangle(o0, i1, i0);
  }
}

/**
 * What marks a picked link: its arc as a white tube PICKED_TUBE times as thick, with a white arrowhead PICKED_ARROW times
 * the size, then a white frame on its source face and one on its target face (8 vertices each, last).
 */
export function selectionGeometry(link: DrawnLink, origin: Vec3): LinkMesh {
  const FRAME_VERTICES = 8, FRAME_TRIANGLES = 8;
  const out = new MeshWriter(meshFor(LINK_VERTICES + 2 * FRAME_VERTICES, LINK_TRIANGLES + 2 * FRAME_TRIANGLES));
  tube(out, link.path, LINK_RADIUS * PICKED_TUBE, PICKED_RGB, link.layer);
  arrowhead(out, link.path, PICKED_ARROW, PICKED_RGB, link.layer);
  frame(out, link.span.from, origin, link.layer);
  frame(out, link.span.to, origin, link.layer);
  return out.mesh;
}

/**
 * Where a ray (from `start` along the unit `dir`) passes closest to the segment `a`–`b`: how far along the ray (t ≥ 0)
 * and how far from the segment.
 */
function raySegment(start: Vec3, dir: Vec3, a: Vec3, b: Vec3): { t: number; distance: number } {
  const v = sub(b, a), w = sub(start, a);
  const bb = dot(dir, v), c = dot(v, v), d = dot(dir, w), e = dot(v, w);
  const denom = c - bb * bb;
  let s = denom > 1e-12 ? Math.min(1, Math.max(0, (e - bb * d) / denom)) : 0;
  let t = Math.max(0, s * bb - d);
  if (c > 1e-12) s = Math.min(1, Math.max(0, (e + t * bb) / c));
  t = Math.max(0, s * bb - d);
  const gap = sub(along(start, dir, t), along(a, v, s));
  return { t, distance: Math.hypot(gap[0], gap[1], gap[2]) };
}

/**
 * The link a ray (from `start` along the unit `dir`, scene coordinates) passes: among those `shown` lets through whose
 * centre line comes within LINK_RADIUS plus `within(t)` of it, t being how far along the ray, the one it passes first;
 * that link's index and t, else null.
 */
export function pickLink(links: readonly DrawnLink[], start: Vec3, dir: Vec3, within: (t: number) => number,
  shown: (link: DrawnLink) => boolean = () => true): { link: number; t: number } | null {
  let best: { link: number; t: number } | null = null;
  for (const [k, link] of links.entries()) {
    if (!shown(link)) continue;
    for (let i = 0; i + 1 < link.path.length; i++) {
      const hit = raySegment(start, dir, link.path[i]!, link.path[i + 1]!);
      if (hit.distance <= LINK_RADIUS + within(hit.t) && (best === null || hit.t < best.t)) best = { link: k, t: hit.t };
    }
  }
  return best;
}

/**
 * The pieces that show: all of them, or while hookups are hidden none of a hookup's own links and none that starts or
 * ends on a block of a hookup (an AE2 line's raw inputs come in at its hookup's cable).
 */
export function spansShown(spans: readonly ConnSpan[], g: ConnGraph, layout: Layout, hookups: boolean): ConnSpan[] {
  if (hookups) return [...spans];
  const hooked = new Set(layout.blocks.filter((b) => b.hookup !== undefined && b.role !== 'ghost').map((b) => posKey(b.pos)));
  const viaHookup = new Set(g.edges.filter((e) => e.via === 'hookup').map((e) => e.id));
  return spans.filter((s) => !viaHookup.has(s.edge) && !hooked.has(posKey(s.from.cell)) && !hooked.has(posKey(s.to.cell)));
}
