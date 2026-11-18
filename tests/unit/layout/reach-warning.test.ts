// RUK-3028 (RUK-2877, RUK-2571 design goal 3): `unreachableWarning`, the `machine_unreachable` warning for the machines
// no builder can reach. Hand-built local blocks (the `at`/`boxed` style of reach.test.ts) cover the singular, plural and
// no-warning texts; the laid lines cover `mixed-02` in AE2 (its 2 multiblock controllers behind ME Interfaces), the same
// line in direct, and a loss line with nothing shut in.
import { describe, it, expect } from 'vitest';
import type { Vec3 } from '../../../src/shared/layout/geometry.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { unreachableWarning } from '../../../src/server/layout/reach.ts';
import { benchLines } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { lossLine } from '../../helpers/power-loss.ts';

type Hand = { pos: Vec3; role: string; label: string };
const at = (pos: Vec3, role: string, label = 'Machine'): Hand => ({ pos, role, label });

// a machine at [1,0,1] walled by full blocks on its four horizontal sides and on top; the ground below is solid.
const boxed = (east: Hand): Hand[] => [
  at([1, 0, 1], 'machine', 'Electric Blast Furnace'), east,
  at([0, 0, 1], 'machine'), at([1, 0, 0], 'machine'), at([1, 0, 2], 'machine'), at([1, 1, 1], 'machine'),
];

// two machines at [1,0,1] and [1,0,2], same name, each walled by casings on every side (they wall each other).
const pair: Hand[] = [
  at([1, 0, 1], 'machine', 'Electric Blast Furnace'), at([1, 0, 2], 'machine', 'Electric Blast Furnace'),
  at([0, 0, 1], 'casing'), at([2, 0, 1], 'casing'), at([1, 0, 0], 'casing'), at([1, 1, 1], 'casing'),
  at([0, 0, 2], 'casing'), at([2, 0, 2], 'casing'), at([1, 0, 3], 'casing'), at([1, 1, 2], 'casing'),
];

describe('unreachableWarning (RUK-3028)', () => {
  it('is null for a lone machine every builder can reach', () => {
    expect(unreachableWarning([at([0, 0, 0], 'machine', 'Electric Blast Furnace')])).toBeNull();
  });

  it('names one shut-in machine in the singular', () => {
    const w = unreachableWarning(boxed(at([2, 0, 1], 'machine')));
    expect(w?.first).toEqual([1, 0, 1]);
    expect(w?.warning).toEqual({
      code: 'machine_unreachable',
      text: '1 machine is closed in by the blocks around it, so you cannot reach it once the line is built: '
        + '1× Electric Blast Furnace. Set up each one (circuit, covers, wrench) before you place the blocks beside it.',
    });
  });

  it('groups two shut-in machines of one name and speaks in the plural', () => {
    const w = unreachableWarning(pair);
    expect(w?.first).toEqual([1, 0, 1]);
    expect(w?.warning).toEqual({
      code: 'machine_unreachable',
      text: '2 machines are closed in by the blocks around them, so you cannot reach them once the line is built: '
        + '2× Electric Blast Furnace. Set up each one (circuit, covers, wrench) before you place the blocks beside it.',
    });
  });
});

describe('layoutLine machine_unreachable (RUK-3028)', () => {
  const AE2_TEXT = '2 machines are closed in by the blocks around them, so you cannot reach them once the line is built: '
    + '2× Electric Blast Furnace. Set up each one (circuit, covers, wrench) before you place the blocks beside it.';

  it('warns once for mixed-02 in AE2, pinned at the first shut-in controller', async () => {
    const line = benchLines().find((l) => l.name === 'mixed-02')!;
    const layout = await layoutLine(layoutPack(), line.plan, line.scan('ae2'), makeProject({ logistics: 'ae2' }), line.deps);
    const mu = layout.warnings.filter((w) => w.code === 'machine_unreachable');
    expect(mu).toHaveLength(1);
    expect(mu[0]!.text).toBe(AE2_TEXT);
    // the first shut-in controller's world position: the warning is pinned there
    expect(layout.pins.some((p) => p.kind === 'warning' && p.text === AE2_TEXT && p.pos[0] === 34 && p.pos[1] === 64 && p.pos[2] === 19)).toBe(true);
  }, 30_000);

  it('says nothing for mixed-02 in direct', async () => {
    const line = benchLines().find((l) => l.name === 'mixed-02')!;
    const layout = await layoutLine(layoutPack(), line.plan, line.scan('direct'), makeProject({ logistics: 'direct' }), line.deps);
    expect(layout.warnings.filter((w) => w.code === 'machine_unreachable')).toHaveLength(0);
  }, 30_000);

  it('says nothing for a 10-machine direct loss line', async () => {
    const { layout } = await lossLine(10, 'direct');
    expect(layout.warnings.filter((w) => w.code === 'machine_unreachable')).toHaveLength(0);
  }, 30_000);
});
