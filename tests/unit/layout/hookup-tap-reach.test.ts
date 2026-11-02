// The power hookup's tap (fix/hookup-route, architecture §11 entry 52). The layout searched the hookup's route from one
// tap only, the nearest one rated for the line, so a tap walled in by the ground or the base's blocks gave `no_path`
// although the same network could be reached a few blocks away: from another listed tap, or from one of the network's
// cables that Plan 4 did not list (it lists one tap per 16×16×16 cell). Synthetic scenes only.

import { describe, expect, it } from 'vitest';
import { reachableTap } from '../../../src/server/layout/hookups.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutTap } from '../../../src/shared/types/layout.ts';
import type { BlockRef } from '../../../src/shared/types/pack.ts';
import type { PlacedPipe } from '../../../src/shared/types/world.ts';
import { areaReader, flatVoxels, IDS, layoutPack, makePlan, makeProject, makeScan, STONE } from '../../helpers/layout-fixtures.ts';

const GT = (mteId: number): BlockRef => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
type Cells = Array<{ from: Vec3; to: Vec3; block: BlockRef }>;
const at = (pos: Vec3, block: BlockRef = GT(IDS.ANNEALED_2X)): Cells[number] => ({ from: pos, to: pos, block });
/** Stone on every face of `p`: a tap boxed in by the ground and the base's blocks. */
const walledIn = (p: Vec3): Cells => DIRS.map((_, side) => at(step(p, side), STONE));

// ---- Through the layout ----

/** The two-step line of `layout.test.ts`: fed at MV, it draws 4 A. */
const twoStep = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
]);
const base = { center: [20, 64, 20] as Vec3, bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } };
/**
 * The line dragged to x 17–23, z 18–22 at y 64: its supply run is x 17, z 18–22, its power port (16, 64, 20). The base has
 * one MV network, 'p:0:0', with 900 EU/t spare (7 A at MV), whose listed taps are cables rated 8 A.
 */
const project = () => makeProject({ placement: { origin: [17, 64, 18], rotation: 0 } });
const mvNetwork = (taps: Vec3[]) =>
  makeScan({ base, power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: taps.map((pos) => ({ pos, freeAmps: 7, cableAmps: 8 })) }] });
/** A scanned cable of that network: a 2x Annealed Copper Cable rated 8 A at MV unless `over` says otherwise. */
const cable = (pos: Vec3, connections: number, over: Partial<PlacedPipe> = {}): PlacedPipe =>
  ({ dim: 0, pos, mteId: IDS.ANNEALED_2X, connections, kind: 'cable', voltageTier: 2, amps: 8, networkId: 'p:0:0', ...over });
/** Flat stone ground up to y 63 with `cells` on it. */
const ground = (cells: Cells) => ({ readArea: areaReader(flatVoxels({ origin: [-20, 50, -20], size: [90, 30, 90], groundY: 63, boxes: cells })) });
const powerHookup = (layout: Layout) => layout.hookups.find((h) => h.kind === 'power')!;
const codes = (layout: Layout) => layout.warnings.map((w) => w.code);
const powerPin = (layout: Layout) => layout.pins.find((p) => p.kind === 'power')!.pos;

describe('the power hookup starts from a tap its route can leave', () => {
  it('routes from another listed tap of the network when the nearest one is walled in', async () => {
    const scan = mvNetwork([[16, 64, 30], [40, 64, 30]]);
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground([...walledIn([16, 64, 30]), at([16, 64, 30]), at([40, 64, 30])]));
    const hookup = powerHookup(layout);
    expect(codes(layout)).not.toContain('no_path');
    expect([hookup.found, hookup.from.pos, powerPin(layout)]).toEqual([true, [40, 64, 30], [40, 64, 30]]);
    expect(layout.blocks.filter((b) => b.hookup === 0).length).toBeGreaterThan(0);
  });

  it('routes from a cable of the network that Plan 4 did not list when every listed tap is buried', async () => {
    // Plan 4 lists one tap per 16×16×16 cell, the cable that comes first in (x, y, z) with a side free of tile entities:
    // here the buried end of a run that comes up to the surface at (18, 63, 30), all in one cell
    const scan = mvNetwork([[16, 62, 30]]);
    scan.pipes = [cable([16, 62, 30], 32), cable([17, 62, 30], 16 | 32), cable([18, 62, 30], 2 | 16), cable([18, 63, 30], 1)];
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground(scan.pipes.map((p) => at(p.pos))));
    const hookup = powerHookup(layout);
    expect(codes(layout)).not.toContain('no_path');
    // its free amps as Plan 4 gives a tap's: the cable's 8 A capped at the 7 A of spare power
    expect([hookup.found, hookup.from, powerPin(layout)])
      .toEqual([true, { pos: [18, 63, 30], dim: 0, kind: 'power', voltageTier: 2, freeAmps: 7, networkId: 'p:0:0' }, [18, 63, 30]]);
    expect(hookup.path[0]).toEqual([18, 64, 30]);                     // on the cable's one free face
    expect(layout.blocks.filter((b) => b.role === 'ghost').map((b) => [b.pos, b.label])).toEqual([[[18, 63, 30], 'existing 2x Annealed Copper Cable']]);
  });

  it('keeps the nearest tap that carries the line whenever a route leaves it, even when another one routes shorter', async () => {
    // the nearest tap reaches the line only round a wall (20 cells); the other one would run 12 cells straight to it
    const scan = mvNetwork([[16, 64, 30], [4, 64, 20]]);
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground([at([16, 64, 30]), at([4, 64, 20]), { from: [10, 64, 26], to: [22, 70, 26], block: STONE }]));
    const hookup = powerHookup(layout);
    expect([hookup.found, hookup.from.pos, hookup.path.length]).toEqual([true, [16, 64, 30], 20]);
  });

  const decoys: Array<[string, Partial<PlacedPipe>]> = [
    ['of another tier', { voltageTier: 1, mteId: IDS.TIN_4X, amps: 4 }],
    ['of another network', { networkId: 'p:0:9' }],
    ['rated for fewer amps than the line draws', { mteId: IDS.ANNEALED_1X, amps: 1 }],
  ];
  it.each(decoys)('never starts from a cable %s: with nothing else to reach, the guide stays at the nearest tap', async (_, over) => {
    const scan = mvNetwork([[16, 62, 30]]);
    scan.pipes = [cable([16, 62, 30], 0), cable([18, 63, 30], 0, over)];
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground([at([16, 62, 30]), at([18, 63, 30], GT(over.mteId ?? IDS.ANNEALED_2X))]));
    const hookup = powerHookup(layout);
    expect([hookup.found, hookup.from.pos]).toEqual([false, [16, 62, 30]]);
    expect(codes(layout)).toContain('no_path');
  });

  it('never takes a tap whose only way out runs further off than its hookup searches, and routes from a cable it can reach', async () => {
    // the nearest tap is walled in, and so is a far one; the third sits at the end of a tunnel that comes up at x 45, more
    // than the 16 blocks round that tap and the line that its hookup's route search reaches
    const scan = mvNetwork([[16, 64, 30], [16, 58, 40], [46, 64, 46]]);
    scan.pipes = [cable([30, 64, 10], 0)];
    const air: BlockRef = { id: 'minecraft:air', meta: 0 };
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground([
      ...walledIn([16, 64, 30]), ...walledIn([46, 64, 46]), at([16, 64, 30]), at([16, 58, 40]), at([46, 64, 46]), at([30, 64, 10]),
      { from: [17, 58, 40], to: [45, 58, 40], block: air }, { from: [45, 59, 40], to: [45, 63, 40], block: air },
    ]));
    const hookup = powerHookup(layout);
    expect([hookup.found, hookup.from.pos]).toEqual([true, [30, 64, 10]]);
  });

  it('routes from another listed tap when the scan could not read the tier of their cables', async () => {
    // the line is fed at the network's own MV; as 2x Silver Cables the taps are rated for HV, so the hookup keeps away
    // from them, but never from the tap it starts from
    const scan = mvNetwork([[16, 64, 30], [40, 64, 30]]);
    for (const t of scan.power[0]!.taps) delete t.voltageTier;
    scan.pipes = [[16, 64, 30], [40, 64, 30]].map((pos) => cable(pos as Vec3, 0, { mteId: IDS.SILVER_2X, voltageTier: undefined }));
    const silver = GT(IDS.SILVER_2X);
    const layout = await layoutLine(layoutPack(), twoStep(), scan, project(), ground([...walledIn([16, 64, 30]), at([16, 64, 30], silver), at([40, 64, 30], silver)]));
    const hookup = powerHookup(layout);
    expect([hookup.found, hookup.from.pos]).toEqual([true, [40, 64, 30]]);
  });
});

// ---- The search itself ----

describe('reachableTap', () => {
  // flat ground up to y 63; the line stands at x 11–14, z 0–3 and its port is (11, 64, 0)
  const vox = (cells: Cells = []) => flatVoxels({ origin: [-4, 60, -4], size: [30, 12, 30], groundY: 63, boxes: cells });
  const line = new Set(Array.from({ length: 16 }, (_, i) => posKey([11 + (i % 4), 64, Math.floor(i / 4)])));
  const tap = (pos: Vec3): LayoutTap => ({ pos, dim: 0, kind: 'power', voltageTier: 1, freeAmps: 4, networkId: 'p:0:0' });

  it('gives the tap the cheapest route leaves from, whatever their order', () => {
    const far = tap([0, 64, 20]), near = tap([5, 64, 0]);
    expect(reachableTap({ vox: vox([at(far.pos), at(near.pos)]), line }, [far, near], [[11, 64, 0]])).toBe(near);
  });

  it('gives null when no route leaves any of the taps, or the ground is unknown', () => {
    const walled = [tap([0, 64, 0]), tap([5, 64, 10])];
    const cells = walled.flatMap((t) => [at(t.pos), ...walledIn(t.pos)]);
    expect(reachableTap({ vox: vox(cells), line }, walled, [[11, 64, 0]])).toBeNull();
    expect(reachableTap({ vox: null, line }, [tap([5, 64, 0])], [[11, 64, 0]])).toBeNull();
  });
});
