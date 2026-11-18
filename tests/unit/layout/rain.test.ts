// RUK-3026 (design goal 7, gt-mechanics §3.4a): `rainChecked` / `rainExposures` / `roofCells` over hand-built local
// blocks (floor at y 0, open sky everywhere). Every block and unit is built by hand in the local frame.
import { describe, it, expect } from 'vitest';
import type { Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { BlockRole, HatchKind } from '../../../src/shared/types/layout.ts';
import type { LocalBlock, PlacedUnit } from '../../../src/server/layout/arrange.ts';
import { RoofRule, rainChecked, rainExposures, roofCells } from '../../../src/server/layout/rain.ts';

const blk = (pos: Vec3, role: BlockRole, hatch?: HatchKind): LocalBlock =>
  ({ pos, role, label: '', ...(hatch === undefined ? {} : { hatch }) }) as LocalBlock;

const unit = (pos: Vec3, electric: boolean, multiblock: boolean): PlacedUnit =>
  ({ electric, multiblock, at: pos, cells: [{ pos, role: 'machine', block: {}, label: '' }] }) as unknown as PlacedUnit;

const cellIn = (cells: readonly Vec3[], x: number, z: number): Vec3 | undefined => cells.find((c) => c[0] === x && c[2] === z);

describe('rainChecked / rainExposures / roofCells (RUK-3026, design goal 7)', () => {
  it('a lone singleblock is top and 4-side exposed, Flat lays 5 cells', () => {
    const blocks = [blk([0, 0, 0], 'machine')];
    const checked = rainChecked(blocks, [unit([0, 0, 0], true, false)]);
    expect(checked).toHaveLength(1);
    const exp = rainExposures(blocks, checked);
    expect(exp).toEqual([{ pos: [0, 0, 0], top: true, sides: [2, 3, 4, 5] }]);
    expect(roofCells(blocks, exp, [], 1, RoofRule.Flat)).toEqual([[-1, 1, 0], [0, 1, -1], [0, 1, 0], [0, 1, 1], [1, 1, 0]]);
    expect(roofCells(blocks, exp, [], 1, RoofRule.Box)).toHaveLength(9);
  });

  it('two machines stacked: the lower is covered on top by the upper', () => {
    const blocks = [blk([0, 0, 0], 'machine'), blk([0, 1, 0], 'machine')];
    const units = [unit([0, 0, 0], true, false), unit([0, 1, 0], true, false)];
    const exp = rainExposures(blocks, rainChecked(blocks, units));
    expect(exp[0]).toEqual({ pos: [0, 0, 0], top: false, sides: [2, 3, 4, 5] });
    expect(exp[1]).toEqual({ pos: [0, 1, 0], top: true, sides: [2, 3, 4, 5] });
  });

  it('a transformer beside a machine at the same y covers that side', () => {
    const blocks = [blk([0, 0, 0], 'machine'), blk([1, 0, 0], 'transformer')];
    const exp = rainExposures(blocks, rainChecked(blocks, [unit([0, 0, 0], true, false)]));
    const machine = exp.find((e) => e.pos[0] === 0)!;
    expect(machine.sides).toEqual([2, 3, 4]); // east (5) is covered by the transformer
  });

  it('a reserved cell above a machine pushes Lowest one higher', () => {
    const blocks = [blk([0, 0, 0], 'machine')];
    const exp = rainExposures(blocks, rainChecked(blocks, [unit([0, 0, 0], true, false)]));
    const lowest = roofCells(blocks, exp, [[0, 1, 0]], 3, RoofRule.Lowest);
    expect(cellIn(lowest, 0, 0)).toEqual([0, 2, 0]); // (0,1,0) is reserved, so the roof sits at y 2
    expect(cellIn(roofCells(blocks, exp, [[0, 1, 0]], 3, RoofRule.Flat), 0, 0)).toEqual([0, 3, 0]);
  });

  it('a multiblock controller and a steam machine are not checked', () => {
    const blocks = [blk([0, 0, 0], 'machine'), blk([1, 0, 0], 'machine')];
    const units = [unit([0, 0, 0], true, true), unit([1, 0, 0], false, false)];
    expect(rainChecked(blocks, units)).toEqual([]);
    expect(rainExposures(blocks, [])).toEqual([]);
  });
});
