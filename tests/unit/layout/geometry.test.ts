import { describe, it, expect } from 'vitest';
import { DIRS, OPPOSITE, posKey, step, sideToward, manhattan, bboxOf, rotatedSize, rotateLocal, rotateFacing,
  rotateConnections, rotateFace, toWorld, type Rotation, type Vec3 } from '../../../src/shared/layout/geometry.ts';

describe('layout geometry', () => {
  it('names the six ForgeDirection steps', () => {
    expect(DIRS).toEqual([[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]);
    expect(OPPOSITE).toEqual([1, 0, 3, 2, 5, 4]);
    expect(step([1, 2, 3], 5)).toEqual([2, 2, 3]);
    expect(posKey([1, -2, 3])).toBe('1,-2,3');
    expect(sideToward([0, 0, 0], [1, 0, 0])).toBe(5);
    expect(sideToward([0, 0, 0], [0, 0, -1])).toBe(2);
    expect(sideToward([0, 0, 0], [2, 0, 0])).toBe(-1);
    expect(manhattan([0, 0, 0], [1, -2, 3])).toBe(6);
    expect(bboxOf([[1, 2, 3], [-1, 5, 0]])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
    expect(bboxOf([])).toBeNull();
  });

  it('rotates a box clockwise seen from above', () => {
    const size: Vec3 = [4, 1, 3];
    expect(rotatedSize(size, 90)).toEqual([3, 1, 4]);
    expect(rotatedSize(size, 180)).toEqual([4, 1, 3]);
    expect(rotateLocal([0, 0, 0], 90, size)).toEqual([2, 0, 0]);
    expect(rotateLocal([3, 0, 2], 90, size)).toEqual([0, 0, 3]);
    expect(rotateLocal([0, 0, 0], 180, size)).toEqual([3, 0, 2]);
    expect(rotateLocal([0, 0, 0], 270, size)).toEqual([0, 0, 3]);
    expect(rotateLocal([3, 0, 2], 270, size)).toEqual([2, 0, 0]);
    expect(rotateFacing(2, 90)).toBe(5);
    expect([2, 3, 4, 5].map((f) => rotateFacing(f, 180))).toEqual([3, 2, 5, 4]);
    expect([2, 3, 4, 5].map((f) => rotateFacing(f, 270))).toEqual([4, 5, 3, 2]);
    expect([0, 1].map((f) => rotateFacing(f, 90))).toEqual([0, 1]);
    expect(rotateConnections(4, 90)).toBe(32);
    expect(rotateConnections(4 | 1, 180)).toBe(9);
    expect([rotateFace('north', 90), rotateFace('east', 180), rotateFace('up', 270)]).toEqual(['east', 'west', 'up']);
    expect(toWorld([0, 0, 0], [100, 64, 200], 90, size)).toEqual([102, 64, 200]);
  });

  it('keeps the block in front of a machine in front after any rotation', () => {
    const size: Vec3 = [5, 2, 4];
    for (const r of [0, 90, 180, 270] as Rotation[]) for (const f of [2, 3, 4, 5]) for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) {
      const p: Vec3 = [x, 0, z];
      expect(toWorld(step(p, f), [0, 0, 0], r, size)).toEqual(step(toWorld(p, [0, 0, 0], r, size), rotateFacing(f, r)));
    }
  });
});
