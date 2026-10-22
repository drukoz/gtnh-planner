// The power hookup's tap (fix/hookup-route, architecture §11 entry 52). The layout searched the hookup's route from one
// tap only, the nearest one rated for the line, so a tap walled in by the ground or the base's blocks gave `no_path`
// although the same network could be reached a few blocks away: from another listed tap, or from one of the network's
// cables that Plan 4 did not list (it lists one tap per 16×16×16 cell). Synthetic scenes only.

import { describe, expect, it } from 'vitest';
import { reachableTap } from '../../../src/server/layout/hookups.ts';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { LayoutTap } from '../../../src/shared/types/layout.ts';
import type { BlockRef } from '../../../src/shared/types/pack.ts';
import { flatVoxels, IDS, STONE } from '../../helpers/layout-fixtures.ts';

const GT = (mteId: number): BlockRef => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
type Cells = Array<{ from: Vec3; to: Vec3; block: BlockRef }>;
const at = (pos: Vec3, block: BlockRef = GT(IDS.ANNEALED_2X)): Cells[number] => ({ from: pos, to: pos, block });
/** Stone on every face of `p`: a tap boxed in by the ground and the base's blocks. */
const walledIn = (p: Vec3): Cells => DIRS.map((_, side) => at(step(p, side), STONE));

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
