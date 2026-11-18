// RUK-3015 (RUK-2877, design goal 3): `unreachableMachines` over a line's local blocks (floor at y 0). A `machine` block
// is reachable when a neighbour cell is outside air (flood-filled from the edge of the box grown by one, nothing below
// the floor), or a thin block (cable, pipe, chip pipe) whose own cell touches outside air; full blocks close a face and
// the ground under the floor is solid. Every block here is built by hand, in the local frame.
import { describe, it, expect } from 'vitest';
import type { Vec3 } from '../../../src/shared/layout/geometry.ts';
import { unreachableMachines } from '../../../src/server/layout/reach.ts';

type Hand = { pos: Vec3; role: string };
const at = (pos: Vec3, role: string): Hand => ({ pos, role });

describe('unreachableMachines (RUK-2877, design goal 3)', () => {
  it('reaches a lone machine', () => {
    expect(unreachableMachines([at([0, 0, 0], 'machine')])).toEqual([]);
  });

  // (b) a machine at [1,0,1] walled in by machines on its four horizontal sides and on top; the ground below is solid.
  const boxed = (east: Hand): Hand[] => [
    at([1, 0, 1], 'machine'), east,
    at([0, 0, 1], 'machine'), at([1, 0, 0], 'machine'), at([1, 0, 2], 'machine'), at([1, 1, 1], 'machine'),
  ];

  it('shuts in a machine walled by machines on its four sides and top, the ground does not count', () => {
    expect(unreachableMachines(boxed(at([2, 0, 1], 'machine')))).toEqual([[1, 0, 1]]);
  });

  it('reaches a machine whose east neighbour is a pipe touching outside air', () => {
    expect(unreachableMachines(boxed(at([2, 0, 1], 'pipe')))).toEqual([]);
  });

  it('shuts in a machine whose east neighbour is a full ME Interface', () => {
    expect(unreachableMachines(boxed(at([2, 0, 1], 'interface')))).toEqual([[1, 0, 1]]);
  });

  it('shuts in a machine whose east pipe is itself boxed in by casings on every side but the machine', () => {
    const blocks: Hand[] = [
      ...boxed(at([2, 0, 1], 'pipe')),
      at([3, 0, 1], 'casing'), at([2, 1, 1], 'casing'), at([2, 0, 0], 'casing'), at([2, 0, 2], 'casing'),
    ];
    expect(unreachableMachines(blocks)).toEqual([[1, 0, 1]]);
  });
});
