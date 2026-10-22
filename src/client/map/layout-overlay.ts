// The new line on the map (spec §3.7, architecture §7.2, §11.14): a filled square per column of the line in the colour
// of its most important block (EnderIO's for a conduit cell), a dot on every configured block (covers, settings,
// conduit faces, or chips and patterns: §11 entry 51), the line's box outline, each hookup as a dashed path in its network's colour ("dashed = still to
// build"), white arrows for the item flow between steps, and the layout pins as numbered markers next to the note pins
// (notes show N1, N2, … so a build step's "pin 1" names one marker). In move mode a drag that starts inside the line
// moves it. The shapes are plain data (`overlayShapes`) drawn by `drawShapes`, so they are tested without a canvas.

import { hookupNetworkKind } from '../../shared/layout/enderio.ts';
import type { Rotation, Vec3 } from '../../shared/layout/geometry.ts';
import type { BlockRole, Hookup, Layout, LayoutBlock, Pin } from '../../shared/types/layout.ts';
import type { LogisticsMode, PlanFlow } from '../../shared/types/plan.ts';
import { LOGISTICS_COLORS, VOLTAGE_COLORS } from './overlays.ts';
import { worldToScreen } from './render.ts';
import type { MapMarker, MapOverlay, MapViewport } from './types.ts';

export const PIN_COLORS: Readonly<Record<Pin['kind'], string>> = {
  site: '#1e88e5', power: '#00acc1', logistics: '#8e24aa', reuse: '#43a047', warning: '#e53935',
};
export const ROLE_COLORS: Readonly<Record<BlockRole, string>> = {
  machine: '#90caf9', casing: '#b0bec5', hatch: '#a1887f', cable: '#616161', transformer: '#8e24aa', pipe: '#ffb300', cover: '#ffffff',
  interface: '#7e57c2', chip_pipe: '#ff7043', chest: '#ffca28', ghost: 'rgba(255,255,255,0.25)',
};
/** The mark on a configured block: one with covers, settings (§11.14), conduit faces, or chips and patterns (§11 entry 51). */
export const CONFIGURED_COLOR = '#ffffff';

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string | null; stroke: string | null; dash: number[] }
  | { kind: 'path'; points: Array<[number, number]>; stroke: string; dash: number[]; width: number }
  | { kind: 'arrow'; from: [number, number]; to: [number, number]; color: string }
  | { kind: 'dot'; x: number; y: number; r: number; color: string };   // a configured block (covers, settings, conduit faces, chips or patterns)

/** A drag of the line in move mode: the block it started on and the block under the pointer now. */
export type Drag = { from: { x: number; z: number }; to: { x: number; z: number } };

/**
 * A column of the line takes the colour of the first of these roles it holds. No layout places a `cover` block (a
 * cover is data on its host block), so it only stands last in case one ever does.
 */
const ROLE_PRIORITY: readonly BlockRole[] = ['machine', 'hatch', 'casing', 'transformer', 'chest', 'interface', 'chip_pipe', 'pipe', 'cable', 'cover'];
const OUTLINE_COLOR = '#ffffff';
const OUTLINE_WIDTH = 2;
const ARROW_COLOR = '#ffffff';
const ARROW_WIDTH = 1.5;
/** The arrow head's length (px), at most half the arrow. */
const ARROW_HEAD = 6;
/** Drawn under the white arrows so they read on light ground too. */
const ARROW_HALO = 'rgba(0, 0, 0, 0.55)';
const DOT_OUTLINE = '#000000';
const HOOKUP_DASH: readonly number[] = [6, 4];
const HOOKUP_WIDTH = 2;
const NEXT_ROTATION: Readonly<Record<Rotation, Rotation>> = { 0: 90, 90: 180, 180: 270, 270: 0 };

/** Whether the block holds EnderIO conduits (a conduit cell or bundle). */
function holdsConduits(b: LayoutBlock): boolean {
  return b.conduits !== undefined && b.conduits.length > 0;
}

function configured(b: LayoutBlock): boolean {
  return (b.covers !== undefined && b.covers.length > 0) || (b.config !== undefined && Object.keys(b.config).length > 0)
    || (b.conduits ?? []).some((c) => c.faces.length > 0) || (b.feed !== undefined && Object.keys(b.feed).length > 0);
}

/** A power hookup in the colour of its tap's voltage (as Plan 4 draws cables), a logistics one in its network's. */
function hookupColor(h: Hookup, mode: LogisticsMode): string {
  const kind = hookupNetworkKind(h, mode);
  return kind === null ? VOLTAGE_COLORS[h.from.voltageTier ?? 0] ?? VOLTAGE_COLORS[0]! : LOGISTICS_COLORS[kind];
}

/**
 * What the line looks like in `view` (nothing in another dimension), with the line itself shifted by `drag` blocks:
 * a square per (x, z) column of its blocks (hookup blocks and ghosts left out; EnderIO's colour when the block that
 * colours it holds conduits), the box outline, the hookups as dashed paths through their cell centres (never shifted:
 * they run from the base's taps), an arrow per plan flow between two steps that both have machines (first machine to
 * first machine, in layout order; a machine shared by several steps, `stepIds`, is each of theirs, and a flow between two
 * steps of one machine draws none) and last a dot per column holding a configured block, a hookup block's dot
 * unshifted. Squares are at least one pixel, as Plan 4 draws blocks.
 */
export function overlayShapes(layout: Layout, view: MapViewport, drag: { dx: number; dz: number } | null, flows: readonly PlanFlow[]): Shape[] {
  if (view.dim !== layout.dim) return [];
  const dx = drag?.dx ?? 0, dz = drag?.dz ?? 0;
  const side = Math.max(1, view.pixelsPerBlock);
  const centre = (x: number, z: number): [number, number] => worldToScreen(view, x + 0.5, z + 0.5);
  const shapes: Shape[] = [];

  const columns = new Map<string, { x: number; z: number; rank: number; conduits: boolean }>();
  for (const b of layout.blocks) {
    if (b.hookup !== undefined || b.role === 'ghost') continue;
    const key = `${b.pos[0]},${b.pos[2]}`;
    const rank = ROLE_PRIORITY.indexOf(b.role);
    const seen = columns.get(key);
    if (seen === undefined || rank < seen.rank) columns.set(key, { x: b.pos[0], z: b.pos[2], rank, conduits: holdsConduits(b) });
  }
  for (const c of columns.values()) {
    const [x, y] = worldToScreen(view, c.x + dx, c.z + dz);
    const fill = c.conduits ? LOGISTICS_COLORS.enderio : ROLE_COLORS[ROLE_PRIORITY[c.rank]!];
    shapes.push({ kind: 'rect', x, y, w: side, h: side, fill, stroke: null, dash: [] });
  }

  const [ox, , oz] = layout.origin;
  const [w, , l] = layout.size;
  if (w > 0 && l > 0) {
    const [x0, y0] = worldToScreen(view, ox + dx, oz + dz);
    const [x1, y1] = worldToScreen(view, ox + w + dx, oz + l + dz);
    shapes.push({ kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: null, stroke: OUTLINE_COLOR, dash: [] });
  }

  for (const h of layout.hookups) {
    if (h.path.length === 0) continue;
    shapes.push({ kind: 'path', points: h.path.map((p) => centre(p[0], p[2])), stroke: hookupColor(h, layout.mode), dash: [...HOOKUP_DASH], width: HOOKUP_WIDTH });
  }

  // A machine several steps share (`LayoutBlock.stepIds`, plan 12) stands for each of them.
  const firstMachine = new Map<string, LayoutBlock>();
  for (const b of layout.blocks) {
    if (b.role !== 'machine' || b.stepId === undefined) continue;
    for (const id of b.stepIds ?? [b.stepId]) if (!firstMachine.has(id)) firstMachine.set(id, b);
  }
  for (const f of flows) {
    const from = firstMachine.get(f.from), to = firstMachine.get(f.to);
    if (from === undefined || to === undefined || from === to) continue;
    shapes.push({ kind: 'arrow', from: centre(from.pos[0] + dx, from.pos[2] + dz), to: centre(to.pos[0] + dx, to.pos[2] + dz), color: ARROW_COLOR });
  }

  const dotted = new Set<string>();
  for (const b of layout.blocks) {
    if (b.role === 'ghost' || !configured(b)) continue;
    const x = b.pos[0] + (b.hookup === undefined ? dx : 0), z = b.pos[2] + (b.hookup === undefined ? dz : 0);
    const key = `${x},${z}`;
    if (dotted.has(key)) continue;
    dotted.add(key);
    const [px, py] = centre(x, z);
    shapes.push({ kind: 'dot', x: px, y: py, r: Math.max(2, view.pixelsPerBlock / 4), color: CONFIGURED_COLOR });
  }
  return shapes;
}

function drawArrow(ctx: CanvasRenderingContext2D, from: readonly [number, number], to: readonly [number, number], color: string, width: number): void {
  const [x0, y0] = from, [x1, y1] = to;
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length === 0) return;
  const ux = (x1 - x0) / length, uy = (y1 - y0) / length;
  const head = Math.min(ARROW_HEAD, length / 2);
  const bx = x1 - ux * head, by = y1 - uy * head;   // where the head meets the shaft
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx - (uy * head) / 2, by + (ux * head) / 2);
  ctx.lineTo(bx + (uy * head) / 2, by - (ux * head) / 2);
  ctx.closePath();
  ctx.fill();
}

/** Draws `shapes` in order. A path of one cell is a dot of its colour, so a one-block hookup still shows. */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    switch (s.kind) {
      case 'rect':
        if (s.fill !== null) {
          ctx.fillStyle = s.fill;
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        if (s.stroke !== null) {
          ctx.setLineDash(s.dash);
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = OUTLINE_WIDTH;
          ctx.strokeRect(s.x, s.y, s.w, s.h);
        }
        break;
      case 'path': {
        const [first, ...rest] = s.points;
        if (first === undefined) break;
        if (rest.length === 0) {
          ctx.fillStyle = s.stroke;
          ctx.beginPath();
          ctx.arc(first[0], first[1], s.width, 0, 2 * Math.PI);
          ctx.fill();
          break;
        }
        ctx.setLineDash(s.dash);
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(first[0], first[1]);
        for (const [x, y] of rest) ctx.lineTo(x, y);
        ctx.stroke();
        break;
      }
      case 'arrow':
        ctx.setLineDash([]);
        drawArrow(ctx, s.from, s.to, ARROW_HALO, ARROW_WIDTH + 2);
        drawArrow(ctx, s.from, s.to, s.color, ARROW_WIDTH);
        break;
      case 'dot':
        ctx.setLineDash([]);
        ctx.fillStyle = s.color;
        ctx.strokeStyle = DOT_OUTLINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        break;
    }
  }
  ctx.setLineDash([]);
}

/** The pins of the layout's dimension as numbered markers, by number. */
export function layoutMarkers(layout: Layout): MapMarker[] {
  return layout.pins
    .filter((p) => p.dim === layout.dim)
    .sort((a, b) => a.n - b.n)
    .map((p) => ({ n: p.n, pos: [p.pos[0], p.pos[1], p.pos[2]], color: PIN_COLORS[p.kind], label: `Pin ${p.n}: ${p.text}` }));
}

/**
 * The note markers drawn as `N<n>`, then the layout's pins (none without a layout) drawn with their own number, so no
 * two markers read the same (spec §3.7, §3.10: "pin <n>" in a build step names one marker).
 */
export function combinedMarkers(notes: readonly MapMarker[], layout: Layout | null): MapMarker[] {
  const named = notes.map((m) => (m.n === undefined ? { ...m } : { ...m, text: `N${m.n}` }));
  return layout === null ? named : [...named, ...layoutMarkers(layout)];
}

/** Whether block column (x, z) lies in the line's box. */
export function insideLine(layout: Layout, x: number, z: number): boolean {
  const [ox, , oz] = layout.origin;
  return x >= ox && x < ox + layout.size[0] && z >= oz && z < oz + layout.size[2];
}

/** The line's origin after a drag from block `from` to block `to`; its height stays (the server checks it). */
export function draggedOrigin(layout: Layout, from: { x: number; z: number }, to: { x: number; z: number }): Vec3 {
  return [layout.origin[0] + to.x - from.x, layout.origin[1], layout.origin[2] + to.z - from.z];
}

/** The placement of the line turned a quarter clockwise about its min corner. */
export function rotatedPlacement(layout: Layout): { origin: Vec3; rotation: Rotation } {
  return { origin: [layout.origin[0], layout.origin[1], layout.origin[2]], rotation: NEXT_ROTATION[layout.rotation] };
}

/**
 * The line as a map overlay. Pointer events are the map's unless `moving`: then a press inside the line starts a drag
 * (`onDrag({ from, to: from })`), moves update it, and the release drops the line (`onDrop` with its new origin, then
 * `onDrag(null)`); all three are taken while dragging, so the map does not pan. A press outside the line is the map's
 * and ends a drag the browser cut short (a cancelled pointer never sends its release).
 */
export function layoutOverlay(layout: Layout, opts: {
  moving: boolean; drag: Drag | null; flows: readonly PlanFlow[]; onDrag(d: Drag | null): void; onDrop(origin: Vec3): void;
}): MapOverlay {
  const { drag } = opts;
  const shift = drag === null ? null : { dx: drag.to.x - drag.from.x, dz: drag.to.z - drag.from.z };
  return {
    id: 'layout',
    draw(ctx, view) {
      drawShapes(ctx, overlayShapes(layout, view, shift, opts.flows));
    },
    onPointer(ev) {
      if (!opts.moving) return false;
      if (ev.kind === 'down') {
        if (!insideLine(layout, ev.x, ev.z)) {
          if (drag !== null) opts.onDrag(null);
          return false;
        }
        opts.onDrag({ from: { x: ev.x, z: ev.z }, to: { x: ev.x, z: ev.z } });
        return true;
      }
      if (drag === null) return false;
      if (ev.kind === 'move') {
        if (ev.x !== drag.to.x || ev.z !== drag.to.z) opts.onDrag({ from: drag.from, to: { x: ev.x, z: ev.z } });
        return true;
      }
      opts.onDrop(draggedOrigin(layout, drag.from, { x: ev.x, z: ev.z }));
      opts.onDrag(null);
      return true;
    },
  };
}
