// What the scan found, drawn over the map (spec §3.7): machines, power cables coloured by voltage, logistics in the
// colour of their kind, storage, the base outline, and the note pins anyone can add with a click (architecture §7.2).
// Every overlay draws only the records of the view's dimension at or below its Y level, and skips anything outside
// the view before drawing; a record within one block of the edge still counts as inside (ledger ruling R19).

import type { Note } from '../../shared/types/project.ts';
import type { Base, LogisticsNetwork, WorldScan } from '../../shared/types/world.ts';
import { REQUEST_KINDS } from '../../shared/world/storage-totals.ts';
import { screenToWorld, worldToScreen } from './render.ts';
import type { MapMarker, MapOverlay, MapViewport } from './types.ts';

/** One colour per voltage tier, ULV … MAX (Plan 5 draws the new line's cables with the same colours). */
export const VOLTAGE_COLORS: readonly string[] = [
  '#8a8a8a', '#3fa34d', '#1e88e5', '#fdd835', '#8e24aa', '#e53935', '#00acc1', '#fb8c00', '#6d4c41', '#d81b60', '#43a047', '#5e35b1', '#00897b',
  '#c0ca33', '#212121',
];
export const LOGISTICS_COLORS: Readonly<Record<LogisticsNetwork['kind'], string>> = { routed: '#ff7043', enderio: '#26c6da', gtpipe: '#9ccc65', ae2: '#7e57c2' };
export const STORAGE_COLOR = '#ffca28';
export const MACHINE_COLOR = '#90a4ae';
export const BASE_OUTLINE_COLOR = '#ffffff';
export const NOTE_COLOR = '#ffb300';

const OUTLINE_DASH = [6, 4];
/** A press and release at most this many blocks apart (in x and in z) is a click, not a drag. */
const CLICK_SLOP = 1;
/** Storage reached by a request network is filled this opaque, so the map still shows through. */
const REACHED_ALPHA = 0.55;
/** The horizontal ForgeDirection sides with the block offset each one points to: north, south, west, east. */
const HORIZONTAL_SIDES: ReadonlyArray<readonly [side: number, dx: number, dz: number]> = [[2, 0, -1], [3, 0, 1], [4, -1, 0], [5, 1, 0]];

interface Placed { dim: number; pos: [number, number, number] }
/** A block joined to its neighbours: a cable, pipe, conduit or ME cable (`connections` bit `1 << side`). */
interface Link extends Placed { connections: number }

/** Whether a record is drawn in `v`: its dimension, at or below the Y level, within a block of the visible area. */
function inView(v: MapViewport): (p: Placed) => boolean {
  const [left, top] = screenToWorld(v, 0, 0);
  const [right, bottom] = screenToWorld(v, v.width, v.height);
  return (p) => p.dim === v.dim && p.pos[1] <= v.y && p.pos[0] >= left - 1 && p.pos[0] <= right + 1 && p.pos[2] >= top - 1 && p.pos[2] <= bottom + 1;
}

/** A block's square on screen; never below one pixel, so blocks stay visible zoomed far out. */
function blockRect(v: MapViewport, p: Placed): [x: number, y: number, size: number] {
  const [x, y] = worldToScreen(v, p.pos[0], p.pos[2]);
  return [x, y, Math.max(1, v.pixelsPerBlock)];
}

/**
 * Each link as a line from its block centre to the middle of every joined horizontal side, in its colour; a link
 * joined only up or down (or not at all) is a dot. One path per colour.
 */
function drawLinks<T extends Link>(ctx: CanvasRenderingContext2D, v: MapViewport, links: readonly T[], colorOf: (l: T) => string): void {
  const shown = inView(v);
  const byColor = new Map<string, T[]>();
  for (const l of links) {
    if (!shown(l)) continue;
    const color = colorOf(l);
    const group = byColor.get(color);
    if (group === undefined) byColor.set(color, [l]);
    else group.push(l);
  }
  const width = Math.max(1, v.pixelsPerBlock / 4);
  const half = v.pixelsPerBlock / 2;
  for (const [color, group] of byColor) {
    const dots: Array<[number, number]> = [];
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const l of group) {
      const [cx, cy] = worldToScreen(v, l.pos[0] + 0.5, l.pos[2] + 0.5);
      let joined = false;
      for (const [side, dx, dz] of HORIZONTAL_SIDES) {
        if ((l.connections & (1 << side)) === 0) continue;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * half, cy + dz * half);
        joined = true;
      }
      if (!joined) dots.push([cx, cy]);
    }
    ctx.stroke();
    if (dots.length === 0) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [cx, cy] of dots) {
      ctx.moveTo(cx + width, cy);
      ctx.arc(cx, cy, width, 0, 2 * Math.PI);
    }
    ctx.fill();
  }
}

/** A filled square per machine. */
export function machinesOverlay(scan: WorldScan): MapOverlay {
  return {
    id: 'machines',
    draw(ctx, v) {
      const shown = inView(v);
      ctx.fillStyle = MACHINE_COLOR;
      for (const m of scan.machines) {
        if (!shown(m)) continue;
        const [x, y, size] = blockRect(v, m);
        ctx.fillRect(x, y, size, size);
      }
    },
  };
}

/** Power cables in the colour of their voltage tier (ULV grey when the export gives none). */
export function cablesOverlay(scan: WorldScan): MapOverlay {
  const cables = scan.pipes.filter((p) => p.kind === 'cable');
  return {
    id: 'cables',
    draw(ctx, v) {
      drawLinks(ctx, v, cables, (c) => VOLTAGE_COLORS[c.voltageTier ?? 0] ?? VOLTAGE_COLORS[0]!);
    },
  };
}

/** Routed pipes, EnderIO conduits, GT pipes and ME cables, each kind in its own colour. */
export function logisticsOverlay(scan: WorldScan): MapOverlay {
  const blocks = scan.logisticsBlocks ?? [];
  return {
    id: 'logistics',
    draw(ctx, v) {
      drawLinks(ctx, v, blocks, (b) => LOGISTICS_COLORS[b.kind]);
    },
  };
}

/** An outlined square per storage block, filled when a request network (routed or AE2) reaches it. */
export function storageOverlay(scan: WorldScan): MapOverlay {
  const kindOf = new Map(scan.logistics.map((n) => [n.id, n.kind]));
  const reached = (networkId: string | null): boolean => {
    const kind = networkId === null ? undefined : kindOf.get(networkId);
    return kind !== undefined && REQUEST_KINDS.has(kind);
  };
  return {
    id: 'storage',
    draw(ctx, v) {
      const shown = inView(v);
      const width = Math.max(1, Math.min(2, v.pixelsPerBlock / 4));
      ctx.strokeStyle = STORAGE_COLOR;
      ctx.fillStyle = STORAGE_COLOR;
      ctx.lineWidth = width;
      for (const s of scan.storage) {
        if (!shown(s)) continue;
        const [x, y, size] = blockRect(v, s);
        if (reached(s.networkId)) {
          ctx.globalAlpha = REACHED_ALPHA;
          ctx.fillRect(x, y, size, size);
          ctx.globalAlpha = 1;
        }
        const inner = Math.max(0, size - width);
        ctx.strokeRect(x + width / 2, y + width / 2, inner, inner);
      }
    },
  };
}

/** The base's bounding box as a dashed rectangle. */
export function baseOutlineOverlay(base: Base): MapOverlay {
  return {
    id: 'outline',
    draw(ctx, v) {
      if (base.dim !== v.dim) return;
      const [x0, y0] = worldToScreen(v, base.bbox.minX, base.bbox.minZ);
      const [x1, y1] = worldToScreen(v, base.bbox.maxX + 1, base.bbox.maxZ + 1);
      if (x1 < 0 || y1 < 0 || x0 > v.width || y0 > v.height) return;
      ctx.setLineDash(OUTLINE_DASH);
      ctx.strokeStyle = BASE_OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    },
  };
}

/**
 * Turns a click on the map into a note position: `onPick` gets the block of the release when it is within a block of
 * the press. Presses and moves are never taken, so dragging still pans the map; only a picked release is taken.
 */
export function noteClickOverlay(onPick: (x: number, z: number) => void): MapOverlay {
  let down: { x: number; z: number } | null = null;
  return {
    id: 'note-click',
    draw() {},
    onPointer(ev) {
      if (ev.kind === 'down') {
        down = { x: ev.x, z: ev.z };
        return false;
      }
      if (ev.kind === 'move') return false;
      const from = down;
      down = null;
      if (from === null || Math.abs(ev.x - from.x) > CLICK_SLOP || Math.abs(ev.z - from.z) > CLICK_SLOP) return false;
      onPick(ev.x, ev.z);
      return true;
    },
  };
}

export type PinnedNote = Note & { pin: NonNullable<Note['pin']> };

/** The notes with a map pin and their number: 1, 2, … in note order over every dimension. */
export function numberedPins(notes: readonly Note[]): Array<{ n: number; note: PinnedNote }> {
  const out: Array<{ n: number; note: PinnedNote }> = [];
  for (const note of notes) if (note.pin !== undefined) out.push({ n: out.length + 1, note: note as PinnedNote });
  return out;
}

/** The pinned notes of `dim` as numbered map markers; a note keeps its number whichever dimension the map shows. */
export function noteMarkers(notes: Note[], dim: number): MapMarker[] {
  return numberedPins(notes)
    .filter(({ note }) => note.pin.dim === dim)
    .map(({ n, note }) => ({ n, pos: [note.pin.x, note.pin.y, note.pin.z], color: NOTE_COLOR, label: note.text }));
}
