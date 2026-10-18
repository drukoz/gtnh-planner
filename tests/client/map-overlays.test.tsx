import { describe, expect, it } from 'vitest';
import {
  BASE_OUTLINE_COLOR, cablesOverlay, LOGISTICS_COLORS, logisticsOverlay, MACHINE_COLOR, machinesOverlay, NOTE_COLOR, noteClickOverlay, noteMarkers,
  STORAGE_COLOR, storageOverlay, baseOutlineOverlay, VOLTAGE_COLORS,
} from '../../src/client/map/overlays.ts';
import type { MapViewport } from '../../src/client/map/types.ts';
import type { Note } from '../../src/shared/types/project.ts';
import type { WorldScan } from '../../src/shared/types/world.ts';
import { SCAN_FIXTURE } from '../helpers/scan-fixture.ts';

type Point = [number, number];

/** A 2D context that records what was drawn: colours set, line segments, rectangles, dashes and dots. */
function fakeCtx() {
  let at: Point = [0, 0];
  const rec = {
    strokeStyles: [] as string[], fillStyles: [] as string[], segments: [] as Array<[Point, Point]>,
    fillRects: [] as number[][], strokeRects: [] as number[][], lineDashes: [] as number[][], arcs: [] as number[][],
    lineWidth: 1,
    set strokeStyle(v: string) { rec.strokeStyles.push(v); },
    set fillStyle(v: string) { rec.fillStyles.push(v); },
    beginPath() {}, closePath() {}, stroke() {}, fill() {}, save() {}, restore() {},
    moveTo(x: number, y: number) { at = [x, y]; },
    lineTo(x: number, y: number) { rec.segments.push([at, [x, y]]); at = [x, y]; },
    arc(x: number, y: number, r: number) { rec.arcs.push([x, y, r]); },
    rect() {},
    fillRect(x: number, y: number, w: number, h: number) { rec.fillRects.push([x, y, w, h]); },
    strokeRect(x: number, y: number, w: number, h: number) { rec.strokeRects.push([x, y, w, h]); },
    setLineDash(d: number[]) { rec.lineDashes.push([...d]); },
  };
  return rec;
}

const view: MapViewport = { dim: 0, centerX: 0, centerZ: 0, pixelsPerBlock: 8, width: 160, height: 160, y: 255 };
const draw = (o: { draw(ctx: CanvasRenderingContext2D, v: MapViewport): void }, v: MapViewport = view) => {
  const ctx = fakeCtx();
  o.draw(ctx as unknown as CanvasRenderingContext2D, v);
  return ctx;
};

function note(id: string, text: string, pin?: Note['pin']): Note {
  const n: Note = { id, text, by: 'Ann', at: '2026-10-17T12:00:00.000Z' };
  if (pin !== undefined) n.pin = pin;
  return n;
}

describe('map overlays', () => {
  it('exports the palette the map and Plan 5 share', () => {
    expect(VOLTAGE_COLORS).toEqual(['#8a8a8a', '#3fa34d', '#1e88e5', '#fdd835', '#8e24aa', '#e53935', '#00acc1', '#fb8c00', '#6d4c41', '#d81b60',
      '#43a047', '#5e35b1', '#00897b', '#c0ca33', '#212121']);
    expect(LOGISTICS_COLORS).toEqual({ routed: '#ff7043', enderio: '#26c6da', gtpipe: '#9ccc65', ae2: '#7e57c2' });
    expect([STORAGE_COLOR, MACHINE_COLOR, BASE_OUTLINE_COLOR, NOTE_COLOR]).toEqual(['#ffca28', '#90a4ae', '#ffffff', '#ffb300']);
    expect([machinesOverlay(SCAN_FIXTURE).id, cablesOverlay(SCAN_FIXTURE).id, logisticsOverlay(SCAN_FIXTURE).id, storageOverlay(SCAN_FIXTURE).id,
      baseOutlineOverlay(SCAN_FIXTURE.bases[0]!).id, noteClickOverlay(() => {}).id]).toEqual(['machines', 'cables', 'logistics', 'storage', 'outline', 'note-click']);
  });

  it('draws cables in their voltage colour from the block centre toward connected sides', () => {
    const ctx = fakeCtx(); cablesOverlay(SCAN_FIXTURE).draw(ctx as unknown as CanvasRenderingContext2D, view);
    expect(ctx.strokeStyles).toContain(VOLTAGE_COLORS[1]);
    expect(ctx.segments).toEqual([[[100, 84], [96, 84]], [[100, 84], [104, 84]]]);   // centre of (2,64,0) at 8 px/block, west and east halves
  });

  it('draws a dot for a cable joined only up or down, in ULV grey without a tier', () => {
    const scan: WorldScan = { ...SCAN_FIXTURE, pipes: [{ dim: 0, pos: [2, 64, 0], mteId: 1240, connections: 1 | 2, kind: 'cable' }] };
    const ctx = draw(cablesOverlay(scan));
    expect(ctx.segments).toEqual([]);
    expect(ctx.arcs.map(([x, y]) => [x, y])).toEqual([[100, 84]]);
    expect(ctx.fillStyles).toContain(VOLTAGE_COLORS[0]);
  });

  it('draws only cables of the view dimension and inside the view', () => {
    const scan: WorldScan = {
      ...SCAN_FIXTURE, pipes: [
        { dim: -1, pos: [2, 64, 0], mteId: 1240, connections: 48, kind: 'cable', voltageTier: 1 },   // another dimension
        { dim: 0, pos: [500, 64, 0], mteId: 1240, connections: 48, kind: 'cable', voltageTier: 1 },  // far outside the view
        { dim: 0, pos: [3, 64, 0], mteId: 1240, connections: 48, kind: 'fluid' },                     // not a cable
      ],
    };
    const ctx = draw(cablesOverlay(scan));
    expect([ctx.segments, ctx.arcs]).toEqual([[], []]);
  });

  it('draws logistics blocks in the colour of their network kind', () => {
    const ctx = draw(logisticsOverlay(SCAN_FIXTURE));
    expect(ctx.strokeStyles).toContain(LOGISTICS_COLORS.routed);
    expect(ctx.segments).toEqual([[[84, 164], [88, 164]], [[92, 164], [88, 164]]]);   // (0,65,10) east half, (1,65,10) west half
  });

  it('fills a square per machine of the view dimension', () => {
    const ctx = draw(machinesOverlay(SCAN_FIXTURE));
    expect(ctx.fillStyles).toContain(MACHINE_COLOR);
    expect(ctx.fillRects).toHaveLength(4);
    expect(ctx.fillRects).toContainEqual([104, 104, 8, 8]);   // (3,64,3)
    expect(draw(machinesOverlay(SCAN_FIXTURE), { ...view, dim: -1 }).fillRects).toEqual([]);
  });

  it('fills storage only when a request network reaches it', () => {
    const ctx = fakeCtx(); storageOverlay(SCAN_FIXTURE).draw(ctx as unknown as CanvasRenderingContext2D, view);
    expect([ctx.fillRects.length, ctx.strokeRects.length]).toEqual([1, 5]);
  });

  it('hides blocks above the Y level', () => {
    expect(draw(storageOverlay(SCAN_FIXTURE), { ...view, y: 64 }).strokeRects).toHaveLength(4);   // the barrel at y 65 is cut away
    expect(draw(machinesOverlay(SCAN_FIXTURE), { ...view, y: 63 }).fillRects).toEqual([]);
  });

  it('draws the base outline dashed', () => {
    const ctx = fakeCtx(); baseOutlineOverlay(SCAN_FIXTURE.bases[0]!).draw(ctx as unknown as CanvasRenderingContext2D, view);
    expect(ctx.lineDashes).toContainEqual([6, 4]);
    expect(ctx.strokeStyles).toContain(BASE_OUTLINE_COLOR);
    expect(ctx.strokeRects).toEqual([[80, 80, 80, 88]]);   // x 0..9 and z 0..10, inclusive
    expect(draw(baseOutlineOverlay(SCAN_FIXTURE.bases[0]!), { ...view, dim: 1 }).strokeRects).toEqual([]);
  });

  it('picks a note position on a click but not on a drag', () => {
    const picks: Array<[number, number]> = [], o = noteClickOverlay((x, z) => picks.push([x, z]));
    expect(o.onPointer!({ kind: 'down', x: 10, z: 10 })).toBe(false);
    expect(o.onPointer!({ kind: 'up', x: 11, z: 10 })).toBe(true);
    o.onPointer!({ kind: 'down', x: 10, z: 10 });
    expect(o.onPointer!({ kind: 'up', x: 14, z: 10 })).toBe(false);
    expect(picks).toEqual([[11, 10]]);
  });

  it('never takes a move, and ignores an up without a down', () => {
    const picks: Array<[number, number]> = [], o = noteClickOverlay((x, z) => picks.push([x, z]));
    expect(o.onPointer!({ kind: 'up', x: 1, z: 1 })).toBe(false);
    o.onPointer!({ kind: 'down', x: 1, z: 1 });
    expect(o.onPointer!({ kind: 'move', x: 1, z: 1 })).toBe(false);
    expect(o.onPointer!({ kind: 'up', x: 1, z: 1 })).toBe(true);
    expect(o.onPointer!({ kind: 'up', x: 1, z: 1 })).toBe(false);   // that down was used up
    expect(picks).toEqual([[1, 1]]);
  });

  it('numbers pinned notes across dimensions and filters by dimension', () => {
    const notes = [note('a', 'Build here', { dim: 0, x: 1, y: 64, z: 2 }), note('b', 'no pin'), note('c', 'Nether', { dim: -1, x: 0, y: 64, z: 0 }), note('d', 'Tap', { dim: 0, x: 5, y: 64, z: 5 })];
    expect(noteMarkers(notes, 0)).toEqual([{ n: 1, pos: [1, 64, 2], color: NOTE_COLOR, label: 'Build here' }, { n: 3, pos: [5, 64, 5], color: NOTE_COLOR, label: 'Tap' }]);
    expect(noteMarkers(notes, -1)).toEqual([{ n: 2, pos: [0, 64, 0], color: NOTE_COLOR, label: 'Nether' }]);
  });
});
