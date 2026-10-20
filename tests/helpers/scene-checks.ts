// The 3D scene's conduit checks (the user's requirements of 2026-10-19, item 3 (a)), shared by the client tests and the
// server's tests of laid-out lines: every link and every set face of every conduit of a layout has its arm, a set
// face's arm is its connector and a link's the conduit itself, the arms of linked neighbours meet end to end, every arm
// reaches the face it points at, two conduits never share a lane, every arm starts on its conduit's core or inside the
// bundle's connector box, and every tile a conduit cell shows is opaque over a plain colour. Synthetic checks: nothing
// here reads a game file.

import { instanceTranslation, type SceneData, type SceneInstance } from '../../src/client/three/scene-data.ts';
import { DIRS, OPPOSITE, posKey, step, type Vec3 } from '../../src/shared/layout/geometry.ts';
import { FACES } from '../../src/shared/types/assets.ts';
import type { Layout } from '../../src/shared/types/layout.ts';

/** A conduit's width (blocks): its core and arms are 6 px across, and an arm starts 3 px from its core's centre. */
const WIDTH = 6 / 16;
const EPS = 1e-9;

function plus(a: Vec3, b: Vec3, k = 1): Vec3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function same(a: Vec3, b: Vec3): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) < EPS);
}

/** Where an arm ends, at the face it points at: its cell centre and offset, half a block toward its side. */
export function armTip(inst: SceneInstance): Vec3 {
  return plus(instanceTranslation(inst), DIRS[inst.side]!, 0.5);
}

/** Where an arm starts: 3 px from its cell centre and offset toward its side. */
export function armRoot(inst: SceneInstance): Vec3 {
  return plus(instanceTranslation(inst), DIRS[inst.side]!, WIDTH / 2);
}

/** Whether `p` is inside a `hub` instance's box. */
function inHub(p: Vec3, hub: SceneInstance): boolean {
  const c = instanceTranslation(hub);
  return p.every((v, k) => Math.abs(v - c[k]!) <= hub.size![k]! / 2 + EPS);
}

/**
 * Everything wrong with how `scene` draws the conduits of `layout`, one line each; empty when every connection is drawn.
 * `connector` is the texture path of the connector plate (`conduit:connector_background`): a set face's arm shows it,
 * a link's arm does not.
 */
export function conduitGaps(layout: Layout, scene: SceneData, connector: string): string[] {
  const gaps: string[] = [];
  const at = new Map<string, number>();
  layout.blocks.forEach((b, i) => {
    if (!at.has(posKey(b.pos))) at.set(posKey(b.pos), i);
  });
  const shows = (inst: SceneInstance, path: string): boolean => scene.tiles[inst.tiles[0]]!.layers.some((l) => l.path === path);
  layout.blocks.forEach((b, block) => {
    const conduits = b.conduits ?? [];
    if (conduits.length === 0) return;
    const where = `${b.label} at ${posKey(b.pos)}`;
    const own = scene.instances.filter((i) => i.block === block);
    const hub = own.find((i) => i.shape === 'hub');
    for (const inst of own) {
      for (const t of inst.tiles) {
        const tile = scene.tiles[t]!;
        if (tile.layers.length > 0 && tile.under === undefined) gaps.push(`${where}: a ${inst.shape} tile is not drawn over a colour`);
      }
    }
    conduits.forEach((c, ci) => {
      const arms = own.filter((i) => i.shape === 'arm' && i.conduit === ci);
      const cores = own.filter((i) => i.shape === 'core' && i.conduit === ci);
      if (hub === undefined && cores.length !== 1) gaps.push(`${where}: ${c.kind} has ${cores.length} cores and no connector box`);
      for (let side = 0; side < 6; side++) {
        const face = c.faces.find((f) => f.face === FACES[side]);
        const set = face !== undefined && face.mode !== 'disabled';
        const linked = (c.connections & (1 << side)) !== 0;
        const mine = arms.filter((i) => i.side === side);
        const name = `${c.kind} ${FACES[side]}`;
        if (!set && !linked) {
          if (mine.length > 0) gaps.push(`${where}: ${name} has an arm toward nothing`);
          continue;
        }
        if (mine.length !== 1) {
          gaps.push(`${where}: ${name} has ${mine.length} arms`);
          continue;
        }
        const arm = mine[0]!;
        if (set !== shows(arm, connector)) gaps.push(`${where}: ${name} ${set ? 'is set but shows no connector' : 'is a link but shows a connector'}`);
        const off = arm.offset ?? [0, 0, 0];
        const d = DIRS[side]!;
        if (Math.abs(off[0] * d[0] + off[1] * d[1] + off[2] * d[2]) > EPS) gaps.push(`${where}: ${name}'s arm does not reach its face`);
        const root = armRoot(arm);
        const onCore = cores.some((k) => same(instanceTranslation(k), instanceTranslation(arm)));
        if (!onCore && (hub === undefined || !inHub(root, hub))) gaps.push(`${where}: ${name}'s arm starts in the air`);
        if (set) continue;
        // a link: the neighbour's same conduit (or the hookup's plain pipe there) reaches back and the two arms meet; a
        // link into a block of the base (a ghost: the tap's conduit) ends on its face
        const nb = at.get(posKey(step(b.pos, side)));
        const other = nb === undefined ? undefined : layout.blocks[nb];
        if (other?.role === 'ghost' && b.role !== 'ghost') continue;
        const oc = other?.conduits?.findIndex((x) => x.kind === c.kind) ?? -1;
        const back = nb === undefined ? [] : scene.instances.filter((i) => i.block === nb && i.shape === 'arm' && i.side === OPPOSITE[side]
          && (oc === -1 ? i.conduit === undefined : i.conduit === oc));
        if (back.length !== 1) gaps.push(`${where}: ${name}'s link meets ${back.length} arms`);
        else if (!same(armTip(arm), armTip(back[0]!))) gaps.push(`${where}: ${name}'s link misses its neighbour's arm`);
      }
    });
    for (let side = 0; side < 6; side++) {
      const tips = own.filter((i) => i.shape === 'arm' && i.side === side).map(armTip);
      for (let i = 0; i < tips.length; i++) {
        for (let j = i + 1; j < tips.length; j++) {
          if (tips[i]!.every((v, k) => Math.abs(v - tips[j]![k]!) < WIDTH - EPS)) gaps.push(`${where}: two arms overlap toward ${FACES[side]}`);
        }
      }
    }
  });
  return gaps;
}

// The review of f82c98c: where the 3D view's Connections links start, end and pass.

/** The roles the 3D view draws as a core with arms rather than a whole block. */
const THIN = new Set(['cable', 'pipe', 'chip_pipe']);
/** A cable's or pipe's core reaches this far from its cell's middle (blocks), and a link tube is this thick round its centre line. */
const CORE_HALF = 3 / 16;
const TUBE = 0.05;

/**
 * Everything wrong with where the pieces `spans` of links of `layout` start and end, one line each: an end that is no
 * conduit face on a bottom, against a whole block, or inside the core or an arm of a cable, pipe or chip pipe that
 * stands against its face (its spot within the core's square or an arm's strip, grown by a tube's thickness; a side
 * a thin block only passes beside is fine anywhere); and an item's end against a fluid pipe that links into its face
 * or lies over its top.
 */
export function linkEndProblems(layout: Layout, spans: ReadonlyArray<{ edge: string; from: SpotLike; to: SpotLike }>, items: (edge: string) => boolean = () => false): string[] {
  const at = new Map(layout.blocks.filter((b) => b.role !== 'ghost').map((b) => [posKey(b.pos), b]));
  const problems: string[] = [];
  for (const s of spans) {
    for (const end of [s.from, s.to]) {
      if (end.face !== null) continue;
      const where = `${s.edge} at ${posKey(end.cell)} side ${end.side}`;
      if (end.side === 0) problems.push(`${where}: on a bottom`);
      const b = at.get(posKey(step(end.cell, end.side)));
      if (b === undefined) continue;
      if (!THIN.has(b.role)) {
        problems.push(`${where}: under ${b.label}`);
        continue;
      }
      const linked = ((b.connections ?? 0) & (1 << OPPOSITE[end.side]!)) !== 0;
      if (items(s.edge) && b.buildStep?.startsWith('layout:logistics:fluid:') === true && (linked || end.side === 1)) problems.push(`${where}: an item at ${b.label}`);
      const axes = [0, 1, 2].filter((k) => DIRS[end.side]![k] === 0);
      const off = end.at ?? [0, 0, 0];
      if (end.side !== 1 && !linked) continue;
      if (axes.every((k) => Math.abs(off[k]!) < CORE_HALF + TUBE)) problems.push(`${where}: in the core of ${b.label}`);
      for (const k of axes) {
        for (const sign of [1, -1]) {
          const arm = DIRS.findIndex((d) => d[k] === sign && d.every((v, j) => j === k || v === 0));
          const across = axes.find((j) => j !== k)!;
          if (((b.connections ?? 0) & (1 << arm)) !== 0 && sign * off[k]! > CORE_HALF - TUBE && Math.abs(off[across]!) < CORE_HALF + TUBE) {
            problems.push(`${where}: in the ${FACES[arm]} arm of ${b.label}`);
          }
        }
      }
    }
  }
  return problems;
}

/** A link's end as the Connections model gives it (`ConnSpot`). */
export interface SpotLike { cell: Vec3; side: number; face: string | null; at?: Vec3 }

/**
 * Every point of the drawn centre lines `links` (scene coordinates from `layout.origin`, eight points between each two
 * of a line's own) inside a block the 3D view draws whole, one line per link: its edge, how many, and which blocks.
 */
export function arcsThroughBlocks(layout: Layout, links: ReadonlyArray<{ span: { edge: string }; path: Vec3[] }>): string[] {
  const solid = new Map(layout.blocks.filter((b) => b.role !== 'ghost' && !THIN.has(b.role))
    .map((b) => [posKey([b.pos[0] - layout.origin[0], b.pos[1] - layout.origin[1], b.pos[2] - layout.origin[2]]), b.label]));
  return links.flatMap((l) => {
    const hits = new Set<string>();
    l.path.slice(1).forEach((b, i) => {
      const a = l.path[i]!;
      for (let k = 0; k < 8; k++) {
        const p: Vec3 = [0, 1, 2].map((j) => Math.floor(a[j]! + ((b[j]! - a[j]!) * k) / 8)) as Vec3;
        const label = solid.get(posKey(p));
        if (label !== undefined) hits.add(`${label} at ${posKey(p)}`);
      }
    });
    return hits.size === 0 ? [] : [`${l.span.edge}: through ${[...hits].join(', ')}`];
  });
}
