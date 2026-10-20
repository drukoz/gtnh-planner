// The Connections tab's links in the 3D view (the user's requirements of 2026-10-19, item 3 (b)): every piece of a link
// (../connections/model.ts `connectionSpans`, so every logistics mode draws what its Connections tab draws) as a thin
// tube that leaves its source face, arcs over the line clear of its solid blocks and comes down into the face it
// reaches, drawn smoother the longer it is, with an arrowhead halfway along that points the way, in its EnderIO
// channel's colour, else the colour of what carries it, as the Connections tab draws it. All of them are one batched
// geometry, so the viewer draws them in one call however many blocks the line has; each starts and ends a little off
// its faces so it never shares a plane with a block, and links between the same two faces fan out side by side, never
// toward a face. Also the white tube and face frames that mark a picked link, which link a ray from the pointer meets,
// which links show while hookups are hidden, and what the note under the view counts and names. Pure TypeScript — no
// DOM, no three.js — so it is tested without a browser; the viewer turns these arrays into meshes.

import { dyeRgb } from '../../shared/layout/enderio.ts';
import { DIRS, posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { Rgb } from '../../shared/types/assets.ts';
import type { BlockRole, Layout } from '../../shared/types/layout.ts';
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
/**
 * The fewest and the most straight pieces a link's arc is drawn with, about one per SEGMENT_LENGTH / 2 blocks of its
 * length in between (`segmentsFor`): always even, so the arrowhead sits on its middle point.
 */
export const LINK_SEGMENTS = 12;
const MAX_SEGMENTS = 48;
const SEGMENT_LENGTH = 3;
/** The sides of a tube and of an arrowhead. */
const SIDES = 4;
/** How far off its face a link starts and ends (blocks), so it never lies in the face's plane. */
export const LINK_LIFT = 0.03;
/** How far a link first heads out of its face, and how high it arcs: this much, and this much more per block it spans. */
const LEAVE = 0.45;
const RISE = 0.8;
const RISE_PER_BLOCK = 0.15;
/**
 * How far over the top of the highest solid block under it a link's centre line passes (blocks); and at most how many
 * times the height it has to climb (or twice its own rise) a link rises for that, so a link that passes right beside a
 * tall block near its end does not shoot up out of sight.
 */
const CLEAR = 0.5;
const RISE_CAP = 6;
/** A block's top face (ForgeDirection up). */
const TOP = 1;
/** The roles the 3D view draws as a core with arms (a cable, a pipe or conduit, a chip pipe) rather than a whole block. */
const THIN_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['cable', 'pipe', 'chip_pipe']);
/**
 * How far apart (blocks) the middles of the links that join the same two faces are drawn, side by side: a little more
 * than an arrowhead is wide while the group spans at most FAN_SPREAD from its first middle to its last, closer in a
 * bigger group, never closer than FAN_MIN (more than a tube is wide). A cubic Bézier's middle moves 3/4 as far as its
 * two inner control points.
 */
const FAN = 0.3;
const FAN_SPREAD = 1.2;
const FAN_MIN = 0.12;
const MIDDLE_PER_CONTROL = 0.75;
/**
 * A group fans out level only while its level axis lies this little along each end's facing (|cos| below it): on two
 * tops, or on sides that look along the line between them. Otherwise it fans upward, each link a little higher than
 * the one before, which moves no control point toward a face.
 */
const LEVEL_FAN_MAX = 0.5;
/** A link's vertices when drawn with `segments` straight pieces: its tube's rings, then its arrowhead's base ring and tip. */
export function linkVertices(segments: number): number {
  return (segments + 1) * SIDES + SIDES + 1;
}
/** A link's triangles when drawn with `segments` straight pieces: two per side of each, then the arrowhead's sides and its base. */
export function linkTriangles(segments: number): number {
  return segments * SIDES * 2 + SIDES + (SIDES - 2);
}
/** A link of LINK_SEGMENTS pieces (every short one): its vertices and its triangles. */
export const LINK_VERTICES = linkVertices(LINK_SEGMENTS);
export const LINK_TRIANGLES = linkTriangles(LINK_SEGMENTS);
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
  /**
   * The tube's centre line in scene coordinates (blocks from the layout's origin): one more point than the straight
   * pieces it is drawn with (`segmentsFor`, LINK_SEGMENTS at least), the arrowhead on the middle one.
   */
  path: Vec3[];
  color: Rgb;
  /** The higher layer of its two ends (y from the origin): the layer slider hides it while that layer is cut away. */
  layer: number;
  /** Its vertices in the geometry: `start` up to `end` (not included), its tube's then its arrowhead's. */
  start: number; end: number;
}

/** Every piece of every link, one after the other (each link's vertices from its `start` to its `end`, its triangles in the same order). */
export interface LinkGeometry extends LinkMesh { links: DrawnLink[] }

/** How `linkGeometry` draws: the line's solid blocks its arcs rise clear of. */
export interface LinkOptions { solid?: SolidColumns }

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

/** The centre of a spot's face, LINK_LIFT off it, in scene coordinates. */
function faceCentre(spot: ConnSpot, origin: Vec3): Vec3 {
  const d = DIRS[spot.side]!;
  return [0, 1, 2].map((k) => spot.cell[k]! - origin[k]! + 0.5 + d[k]! * 0.5 + d[k]! * LINK_LIFT) as Vec3;
}

/** Where a link starts or ends: on its face, LINK_LIFT off it, at the face's centre or `at` off it, in scene coordinates. */
export function spotPoint(spot: ConnSpot, origin: Vec3): Vec3 {
  return along(faceCentre(spot, origin), spot.at ?? [0, 0, 0], 1);
}

/**
 * A link's cubic Bézier before it rises: its two ends, and its inner control points LEAVE out of each end's face, moved
 * by its fan shift; and how high it rises over its ends at least, RISE plus RISE_PER_BLOCK per block between them.
 */
interface Controls { p0: Vec3; q1: Vec3; q2: Vec3; p3: Vec3; rise: number }

function controlsOf(span: ConnSpan, origin: Vec3, fan: FanShift): Controls {
  const p0 = spotPoint(span.from, origin), p3 = spotPoint(span.to, origin);
  return {
    p0, q1: along(p0, DIRS[span.from.side]!, LEAVE, fan.s1, 1), q2: along(p3, DIRS[span.to.side]!, LEAVE, fan.s2, 1), p3,
    rise: RISE + RISE_PER_BLOCK * Math.hypot(...sub(p3, p0)),
  };
}

/** How high a link's two inner control points rise: the one by its source face, then the one by its target face. */
type Rise = readonly [number, number];

/** The point at `t` of a link's Bézier with its inner control points raised by `rise`. */
function bezier(c: Controls, t: number, rise: Rise): Vec3 {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return [0, 1, 2].map((k) => w[0] * c.p0[k]! + w[1] * (c.q1[k]! + (k === 1 ? rise[0] : 0)) + w[2] * (c.q2[k]! + (k === 1 ? rise[1] : 0)) + w[3] * c.p3[k]!) as Vec3;
}

/** A link's centre line: its Bézier raised by `rise`, sampled at `segments` + 1 points. */
function arc(c: Controls, rise: Rise, segments: number): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, i): Vec3 => bezier(c, i / segments, rise));
}

/**
 * How many straight pieces a link is drawn with: two for about every SEGMENT_LENGTH blocks of its control polygon at
 * its own rise (a little more than the arc is long), LINK_SEGMENTS to MAX_SEGMENTS, so a long arc stays as smooth as a
 * short one.
 */
function segmentsFor(c: Controls): number {
  const up = (q: Vec3): Vec3 => [q[0], q[1] + c.rise, q[2]];
  const length = Math.hypot(...sub(up(c.q1), c.p0)) + Math.hypot(...sub(up(c.q2), up(c.q1))) + Math.hypot(...sub(c.p3, up(c.q2)));
  return Math.min(MAX_SEGMENTS, Math.max(LINK_SEGMENTS, 2 * Math.ceil(length / SEGMENT_LENGTH)));
}

/**
 * The line's solid blocks by column, `x,z` from the layout's origin → the top of the highest one there (y from the
 * origin): every block the 3D view draws whole, so not a ghost and not a cable, pipe, conduit or chip pipe.
 */
export type SolidColumns = ReadonlyMap<string, number>;

export function solidColumns(layout: Layout): SolidColumns {
  const tops = new Map<string, number>();
  const [ox, oy, oz] = layout.origin;
  for (const b of layout.blocks) {
    if (b.role === 'ghost' || THIN_ROLES.has(b.role)) continue;
    const key = `${b.pos[0] - ox},${b.pos[2] - oz}`;
    tops.set(key, Math.max(tops.get(key) ?? -Infinity, b.pos[1] - oy + 1));
  }
  return tops;
}

/**
 * How high a link's inner control points rise so its centre line, as drawn with `segments` straight pieces, passes
 * CLEAR over the top of every solid column it crosses (`solid`), and never below the top of the column it climbs out of
 * or comes down into on a top face: each its own rise at least, and at most RISE_CAP times the height it has to climb
 * or twice its own rise. A Bézier's point at t rises 3(1 − t)²t as far as the inner control point by the source and
 * 3(1 − t)t² as far as the one by the target, and a point of a straight piece as far as its two ends do, in between;
 * so each part of a piece over one column is checked at its two ends, which is the whole drawn line. A point too low
 * raises both control points as much as it moves with each, so an arc climbs steeply only next to what it must clear.
 */
function riseOver(c: Controls, segments: number, span: ConnSpan, origin: Vec3, solid: SolidColumns): Rise {
  const own = [span.from, span.to].filter((s) => s.side === TOP).map((s) => `${s.cell[0] - origin[0]},${s.cell[2] - origin[2]}`);
  const low = arc(c, [0, 0], segments);
  const bySource = low.map((_, i) => 3 * (1 - i / segments) ** 2 * (i / segments));
  const byTarget = low.map((_, i) => 3 * (1 - i / segments) * (i / segments) ** 2);
  const rise: [number, number] = [c.rise, c.rise];
  let climb = 0;
  for (let i = 0; i < segments; i++) {
    const a = low[i]!, b = low[i + 1]!;
    const at = (f: number, k: number): number => a[k]! + (b[k]! - a[k]!) * f;
    // where the piece passes from one column to the next
    const cuts = [0, 1];
    for (const k of [0, 2]) {
      if (a[k] === b[k]) continue;
      for (let v = Math.floor(Math.min(a[k]!, b[k]!)) + 1; v <= Math.max(a[k]!, b[k]!); v++) cuts.push((v - a[k]!) / (b[k]! - a[k]!));
    }
    cuts.sort((x, y) => x - y);
    for (let m = 0; m + 1 < cuts.length; m++) {
      const f0 = cuts[m]!, f1 = cuts[m + 1]!, middle = (f0 + f1) / 2;
      if (f1 - f0 < 1e-9) continue;
      const key = `${Math.floor(at(middle, 0))},${Math.floor(at(middle, 2))}`;
      const top = solid.get(key);
      if (top === undefined) continue;
      for (const f of [f0, f1]) {
        const a1 = bySource[i]! + (bySource[i + 1]! - bySource[i]!) * f, a2 = byTarget[i]! + (byTarget[i + 1]! - byTarget[i]!) * f;
        const gap = top + (own.includes(key) ? 0 : CLEAR) - at(f, 1);
        if (a1 + a2 <= 0 || gap <= 0) continue;
        climb = Math.max(climb, gap);
        const short = gap - a1 * rise[0] - a2 * rise[1];
        if (short <= 0) continue;
        const k = short / (a1 * a1 + a2 * a2);
        rise[0] += k * a1;
        rise[1] += k * a2;
      }
    }
  }
  const cap = Math.max(2 * c.rise, RISE_CAP * climb);
  return [Math.min(rise[0], cap), Math.min(rise[1], cap)];
}

function spotKey(spot: ConnSpot): string {
  return `${posKey(spot.cell)}:${spot.side}${spot.at === undefined ? '' : `@${spot.at.join(',')}`}`;
}

/** A piece's two ends, the same either way round: the first is the one whose key sorts first. */
function endsOf(span: ConnSpan): [ConnSpot, ConnSpot] {
  return spotKey(span.from) <= spotKey(span.to) ? [span.from, span.to] : [span.to, span.from];
}

/**
 * The way the links that join two faces fan out: level and square to the line from the first end to the other (so a
 * link and the one coming back, which share their ends, fan out along one line), else, for ends one above the other,
 * square to the first end's facing, or along x.
 */
function fanAxis(span: ConnSpan, origin: Vec3): Vec3 {
  const [first, second] = endsOf(span);
  const a = spotPoint(first, origin), b = spotPoint(second, origin);
  if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-6) return unit([a[2] - b[2], 0, b[0] - a[0]]);
  const n = DIRS[first.side]!;
  return n[1] === 0 ? unit([-n[2], 0, n[0]]) : [1, 0, 0];
}

/**
 * How a piece's inner control points move to keep it beside the others that join the same two faces: `s1` the one by
 * its source face, `s2` the one by its target face. The pieces of one `group` (the index of its first piece) also
 * share one rise, so they stay side by side however high they have to go; `flip`: the piece runs from the group's
 * second face to its first (`endsOf`).
 */
interface FanShift { s1: Vec3; s2: Vec3; group: number; flip: boolean }

/**
 * How far each piece's inner control points move: the pieces that join the same two faces, either way round, in order,
 * their middles a gap apart (FAN, closer in a group that would span more than FAN_SPREAD, at least FAN_MIN). A group
 * whose `fanAxis` lies across both its faces' facings (LEVEL_FAN_MAX: two tops, or sides that look along the line
 * between them) fans out level along it, centred on where one alone goes, each control point moved only along its
 * own face; any other group fans upward from where one alone goes, so no control point moves toward its face and no
 * tube is pushed back into its own block or across the next one. A piece alone does not move.
 */
function fanShifts(spans: readonly ConnSpan[], origin: Vec3): FanShift[] {
  const together = new Map<string, number[]>();
  spans.forEach((s, i) => {
    const [a, b] = endsOf(s);
    const key = `${spotKey(a)}|${spotKey(b)}`;
    const list = together.get(key);
    if (list === undefined) together.set(key, [i]);
    else list.push(i);
  });
  const shifts = spans.map((_, i): FanShift => ({ s1: [0, 0, 0], s2: [0, 0, 0], group: i, flip: false }));
  for (const list of together.values()) {
    const n = list.length;
    if (n < 2) continue;
    const [first, second] = endsOf(spans[list[0]!]!);
    const axis = fanAxis(spans[list[0]!]!, origin);
    const nf = DIRS[first.side]!, ns = DIRS[second.side]!;
    const gap = Math.max(FAN_MIN, Math.min(FAN, FAN_SPREAD / (n - 1)));
    // which way the faces that look along the axis look: a fan may only go that way from them
    const facing = [dot(axis, nf), dot(axis, ns)].filter((c) => Math.abs(c) >= LEVEL_FAN_MAX).map(Math.sign);
    const way = facing.length === 0 ? 0 : facing.every((s) => s > 0) ? 1 : facing.every((s) => s < 0) ? -1 : null;
    // the axis without its part along each face's facing; a centred fan's middle moves along their mean
    const onFirst = along(axis, nf, -dot(axis, nf)), onSecond = along(axis, ns, -dot(axis, ns));
    const mean = Math.hypot(...along(onFirst, onSecond, 1)) / 2;
    list.forEach((i, k) => {
      const s = spans[i]!;
      const flip = spotKey(s.from) !== spotKey(first);
      if (way === 0) {
        const a = ((k - (n - 1) / 2) * gap) / MIDDLE_PER_CONTROL / mean;
        shifts[i] = { s1: along([0, 0, 0], flip ? onSecond : onFirst, a), s2: along([0, 0, 0], flip ? onFirst : onSecond, a), group: list[0]!, flip };
      } else if (way !== null) {
        // out of the faces that look along the axis, level along their own face elsewhere
        const shift = along([0, 0, 0], axis, (way * k * gap) / MIDDLE_PER_CONTROL);
        shifts[i] = { s1: shift, s2: shift, group: list[0]!, flip };
      } else {
        const up = (k * gap) / MIDDLE_PER_CONTROL;
        shifts[i] = { s1: [0, up, 0], s2: [0, up, 0], group: list[0]!, flip };
      }
    });
  }
  return shifts;
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
  const mid = (path.length - 1) / 2;
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
 * round its arc, drawn with more straight pieces the longer it is (`segmentsFor`), and an arrowhead halfway along, in
 * `linkColor` of its link, every vertex with the piece's `layer`. The pieces that join the same two faces, either way
 * round (two goods from one step to the next, a link and the one coming back), fan out side by side (`fanShifts`), so
 * each shows and each can be picked. Given the line's solid blocks (`opts.solid`), every arc rises clear of those it
 * passes over (`riseOver`), the pieces of a fan all as high as the one that has to rise most, so they stay side by
 * side; a higher arc only clears them more.
 */
export function linkGeometry(spans: readonly ConnSpan[], edges: ReadonlyMap<string, ConnEdge>, origin: Vec3, opts: LinkOptions = {}): LinkGeometry {
  const known = spans.filter((s) => edges.has(s.edge));
  const shifts = fanShifts(known, origin);
  const controls = known.map((span, i) => controlsOf(span, origin, shifts[i]!));
  const segments = controls.map(segmentsFor);
  // each group's rise, by its first face then its second
  const rises = new Map<number, Rise>();
  const turned = (r: Rise, flip: boolean): Rise => (flip ? [r[1], r[0]] : r);
  controls.forEach((c, i) => {
    const { group, flip } = shifts[i]!;
    const own = turned(opts.solid === undefined ? [c.rise, c.rise] : riseOver(c, segments[i]!, known[i]!, origin, opts.solid), flip);
    const was = rises.get(group) ?? [0, 0];
    rises.set(group, [Math.max(was[0], own[0]), Math.max(was[1], own[1])]);
  });
  const paths = controls.map((c, i) => arc(c, turned(rises.get(shifts[i]!.group)!, shifts[i]!.flip), segments[i]!));
  const out = new MeshWriter(meshFor(segments.reduce((n, k) => n + linkVertices(k), 0), segments.reduce((n, k) => n + linkTriangles(k), 0)));
  const links = known.map((span, i): DrawnLink => {
    const path = paths[i]!;
    const color = linkColor(edges.get(span.edge)!);
    const layer = Math.max(span.from.cell[1], span.to.cell[1]) - origin[1];
    const start = out.vertices;
    tube(out, path, LINK_RADIUS, color, layer);
    arrowhead(out, path, 1, color, layer);
    return { span, path, color, layer, start, end: out.vertices };
  });
  return { ...out.mesh, links };
}

/** A white square frame on the face `spot` names, LINK_LIFT off it: an outer and an inner square, four strips between them. */
function frame(out: MeshWriter, spot: ConnSpot, origin: Vec3, layer: number): void {
  const n = DIRS[spot.side]!;
  const centre = faceCentre(spot, origin);
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
  const FRAME_VERTICES = 8, FRAME_TRIANGLES = 8, segments = link.path.length - 1;
  const out = new MeshWriter(meshFor(linkVertices(segments) + 2 * FRAME_VERTICES, linkTriangles(segments) + 2 * FRAME_TRIANGLES));
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

/** A ball round a centre line: its centre (the middle of the line's box) and the distance to its furthest point. */
interface Ball { centre: Vec3; radius: number }
/** How many straight pieces of a centre line share one of its smaller balls. */
const PICK_CHUNK = 4;
/**
 * Each drawn centre line's ball, and the balls of its runs of PICK_CHUNK straight pieces (`first` the run's first
 * point), made the first time a ray is tested against it (a drawn path never changes).
 */
const balls = new WeakMap<readonly Vec3[], Ball & { runs: Array<Ball & { first: number }> }>();

function ballAround(points: readonly Vec3[]): Ball {
  const centre = [0, 1, 2].map((k) => (Math.min(...points.map((p) => p[k]!)) + Math.max(...points.map((p) => p[k]!))) / 2) as Vec3;
  return { centre, radius: Math.max(...points.map((p) => Math.hypot(...sub(p, centre)))) };
}

function ballOf(path: readonly Vec3[]): Ball & { runs: Array<Ball & { first: number }> } {
  const known = balls.get(path);
  if (known !== undefined) return known;
  const runs = Array.from({ length: Math.ceil((path.length - 1) / PICK_CHUNK) }, (_, r) =>
    ({ ...ballAround(path.slice(r * PICK_CHUNK, (r + 1) * PICK_CHUNK + 1)), first: r * PICK_CHUNK }));
  const ball = { ...ballAround(path), runs };
  balls.set(path, ball);
  return ball;
}

/**
 * The link a ray (from `start` along the unit `dir`, scene coordinates) passes: among those `shown` lets through whose
 * centre line comes within LINK_RADIUS plus `within(t)` of it, t being how far along the ray, one the ray meets (within
 * LINK_RADIUS: the pointer is on it), the nearest along the ray first; else the one it passes closest to, as a share of
 * the allowance there, so of links side by side the one the pointer is nearest wins over one nearer the camera; never
 * where the ray is further on than `limit` (behind the first solid block). That link's index and t, else null. A link
 * whose ball the ray misses by more than that is never looked at piece by piece, nor a run of its pieces whose own ball
 * it misses, so a pick stays quick among thousands of long arcs; `within` must not shrink as t grows.
 */
export function pickLink(links: readonly DrawnLink[], start: Vec3, dir: Vec3, within: (t: number) => number,
  shown: (link: DrawnLink) => boolean = () => true, limit = Infinity): { link: number; t: number } | null {
  let best: { link: number; t: number; miss: number } | null = null;
  const missed = ({ centre, radius }: Ball): boolean => {
    const x = centre[0] - start[0], y = centre[1] - start[1], z = centre[2] - start[2];
    const tc = x * dir[0] + y * dir[1] + z * dir[2];
    if (tc + radius < 0) return true;
    // how near the ray must pass the centre: no point of the ball is further along it than tc + radius
    const reach = radius + LINK_RADIUS + within(tc + radius);
    return x * x + y * y + z * z - tc * tc > reach * reach;
  };
  for (const [k, link] of links.entries()) {
    if (!shown(link)) continue;
    const ball = ballOf(link.path);
    if (missed(ball)) continue;
    for (const run of ball.runs) {
      if (missed(run)) continue;
      for (let i = run.first; i < Math.min(run.first + PICK_CHUNK, link.path.length - 1); i++) {
        const hit = raySegment(start, dir, link.path[i]!, link.path[i + 1]!);
        const allowance = within(hit.t);
        if (hit.t > limit || hit.distance > LINK_RADIUS + allowance) continue;
        const miss = hit.distance <= LINK_RADIUS ? 0 : (hit.distance - LINK_RADIUS) / allowance;
        if (best === null || miss < best.miss || (miss === best.miss && hit.t < best.t)) best = { link: k, t: hit.t, miss };
      }
    }
  }
  return best === null ? null : { link: best.link, t: best.t };
}

/** What the note under the view says of the drawn links. */
export interface LinksSummary {
  /** The pieces drawn, and how many links of the Connections graph they are pieces of. */
  pieces: number; links: number;
  /** Each link of the graph that has no piece anywhere in the line, in graph order: `[<label>: ]<from box> → <to box>`. */
  unplaced: string[];
}

/**
 * How many pieces of how many links `drawn` shows, and each link of `g` that `all` (every piece of every link, before
 * any is hidden) has no piece for — one whose two ends are one spot (an AE2 hookup joining the base's network where that
 * comes in), or one with an end that stands for nothing laid — a flow by its label, every one by its two boxes; a
 * hookup's own is left out while hookups are hidden, as it would be anyway.
 */
export function linksSummary(g: ConnGraph, all: readonly ConnSpan[], drawn: readonly DrawnLink[], hookups: boolean): LinksSummary {
  const placed = new Set(all.map((s) => s.edge));
  const title = new Map(g.nodes.map((n) => [n.id, n.title]));
  const unplaced = g.edges.filter((e) => !placed.has(e.id) && (hookups || e.via !== 'hookup'))
    .map((e) => `${e.key === null ? '' : `${e.label}: `}${title.get(e.from) ?? e.from} → ${title.get(e.to) ?? e.to}`);
  return { pieces: drawn.length, links: new Set(drawn.map((l) => l.span.edge)).size, unplaced };
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
