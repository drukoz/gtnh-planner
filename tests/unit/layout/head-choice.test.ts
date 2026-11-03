// RUK-508: which power head each standard line gets on the RUK-121 branch. `layoutLine` lays a line with its head at
// the west end and, for lines of 4 or more units, again with a head in the middle; the middle head is kept only when
// it cuts the line's own loss by at least 10 % (RUK-507) and leaves nothing more to finish by hand than the west
// head (RUK-509). Each head test pins the choice measured on the branch and checks every block of the line lies
// inside the layout's own box, the cables bridging the spine one block up included. The guide test lays the standard
// lines without world knowledge (`readArea` absent), where the hookup cannot route: a dashed guide is drawn instead,
// and it must not cross the line's columns (the side-face fix of RUK-505). The last test pins that a line which
// loses nothing of its own keeps the west head, so the middle head comes from the loss and not from the line
// (RUK-507's review fix, commit 351ee604e).

import { describe, it, expect } from 'vitest';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import type { Placement } from '../../../src/server/layout/arrange.ts';
import type { InternalResult } from '../../../src/server/layout/internal.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { lossLine, lossPlan, lossScan } from '../../helpers/power-loss.ts';

/** The 12 standard lines and the head each keeps, measured on the branch with RUK-509's guard. */
const HEADS: Array<{ n: number; mode: LogisticsMode; middle: boolean }> = [
  { n: 10, mode: 'direct', middle: false },
  { n: 10, mode: 'routed', middle: false },
  { n: 10, mode: 'ae2', middle: false },
  { n: 10, mode: 'enderio', middle: false },
  { n: 20, mode: 'direct', middle: false },
  { n: 20, mode: 'routed', middle: false },
  { n: 20, mode: 'ae2', middle: true },
  { n: 20, mode: 'enderio', middle: false },
  { n: 40, mode: 'direct', middle: true },
  { n: 40, mode: 'routed', middle: true },
  { n: 40, mode: 'ae2', middle: true },
  { n: 40, mode: 'enderio', middle: true },
];

describe('power head choice', () => {
  for (const { n, mode, middle } of HEADS) {
    it(`lays the ${n}-machine ${mode} line with the ${middle ? 'middle' : 'west'} head`, async () => {
      const { layout, placement } = await lossLine(n, mode);
      expect(placement.headX > 0, `${n} ${mode}: headX`).toBe(middle);
      const [min, size] = [layout.origin, layout.size];
      // the line's own blocks (the convention of layout.test.ts C1): hookup runs and the ghosts they mark at the
      // taps are not in the box, they sit with the world the runs wire to
      for (const b of layout.blocks.filter((x) => x.hookup === undefined && x.role !== 'ghost')) {
        for (let i = 0; i < 3; i++) {
          const inBox = b.pos[i]! >= min[i]! && b.pos[i]! < min[i]! + size[i]!;
          expect(inBox, `${b.role} at ${b.pos.join(',')} on axis ${i}`).toBe(true);
        }
      }
    });
  }

  it('draws the power hookup as a guide that never crosses the line', async () => {
    for (const n of [10, 20, 40]) for (const mode of ['direct', 'ae2'] as const) for (const rotation of [0, 90, 180, 270] as const) {
      // no `readArea`: the ground is unknown, so the hookup cannot route and a dashed guide is drawn instead
      const layout = await layoutLine(layoutPack(), lossPlan(n), lossScan(mode), makeProject({ logistics: mode, placement: { origin: [20, 64, 10], rotation } }));
      const [min, size] = [layout.origin, layout.size];
      const inColumns = (p: number[]) => p[0]! >= min[0] && p[0]! < min[0] + size[0] && p[2]! >= min[2] && p[2]! < min[2] + size[2];
      const hookup = layout.hookups.find((h) => h.kind === 'power')!;
      expect(hookup.found === false, `${n} ${mode} r${rotation}: found`).toBe(true);
      expect(hookup.path.some(inColumns), `${n} ${mode} r${rotation}: guide crosses the line`).toBe(false);
    }
  });

  it('keeps the west head on a line that loses nothing (RUK-507)', async () => {
    for (const lossless of [false, true]) {
      const pack = layoutPack();
      // every cable loses nothing, as ULV Red Alloy cable does; an LV line on its own LV supply has no banks either
      if (lossless) for (const m of pack.machines.values()) if (m.cable !== undefined) m.cable = { ...m.cable, lossPerBlock: 0 };
      const seen: Array<{ placement: Placement; internal: InternalResult }> = [];
      await layoutLine(pack, lossPlan(40), emptyScan(), makeProject({ logistics: 'direct' }), { localLine: (line) => { seen.push(line); } });
      // the same line with normal cables takes a middle head, so the west head comes from the loss, not from the line
      expect(seen[0]!.placement.headX > 0, lossless ? 'lossless line' : 'normal line').toBe(!lossless);
    }
  });
});
