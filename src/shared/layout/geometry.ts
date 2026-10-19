// Block-grid geometry for line layouts: ForgeDirection steps and the rotation of a line's local box into the world.
// Rotation is clockwise seen from above (north up, east right): 90° turns north → east → south → west.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import { FACES, type Face } from '../types/assets.ts';

export type Vec3 = [number, number, number];
export type Rotation = 0 | 90 | 180 | 270;

/** ForgeDirection 0..5: down, up, north (−z), south (+z), west (−x), east (+x). */
export const DIRS: readonly Vec3[] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
export const OPPOSITE: readonly number[] = [1, 0, 3, 2, 5, 4];
export const SIDE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;

/** The horizontal sides in clockwise order seen from above: north, east, south, west. */
const CLOCKWISE: readonly number[] = [2, 5, 3, 4];
/** The connection bits of the horizontal sides (`1 << side`). */
const HORIZONTAL_BITS = CLOCKWISE.reduce((bits, side) => bits | (1 << side), 0);

function dir(side: number): Vec3 {
  const d = DIRS[side];
  if (d === undefined) throw new RangeError(`a side is a ForgeDirection 0..5, got ${side}`);
  return d;
}

/** Quarter turns of a rotation. */
function quarters(r: Rotation): number {
  if (r !== 0 && r !== 90 && r !== 180 && r !== 270) throw new RangeError(`a rotation is 0, 90, 180 or 270, got ${String(r)}`);
  return r / 90;
}

/** The neighbour of `p` on `side`. */
export function step(p: Vec3, side: number): Vec3 {
  const d = dir(side);
  return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
}

/** "x,y,z" */
export function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/** The side of `from` that touches `to`; −1 when the two are not face-adjacent. */
export function sideToward(from: Vec3, to: Vec3): number {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return DIRS.findIndex((d) => d[0] === dx && d[1] === dy && d[2] === dz);
}

export function manhattan(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** The inclusive corners of the smallest box holding every point; null for no points. */
export function bboxOf(ps: readonly Vec3[]): { min: Vec3; max: Vec3 } | null {
  const first = ps[0];
  if (first === undefined) return null;
  const min: Vec3 = [...first];
  const max: Vec3 = [...first];
  for (const p of ps) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  return { min, max };
}

/** The `W × H × L` box after the rotation: 90° and 270° swap W and L. */
export function rotatedSize(size: Vec3, r: Rotation): Vec3 {
  return quarters(r) % 2 === 1 ? [size[2], size[1], size[0]] : [...size];
}

/** Where cell `p` of a `W × H × L` box (`size`, before rotation) lands in the rotated box. */
export function rotateLocal(p: Vec3, r: Rotation, size: Vec3): Vec3 {
  const [x, y, z] = p;
  const w = size[0], l = size[2];
  switch (quarters(r)) {
    case 1: return [l - 1 - z, y, x];
    case 2: return [w - 1 - x, y, l - 1 - z];
    case 3: return [z, y, w - 1 - x];
    default: return [x, y, z];
  }
}

/** A facing after the rotation: north → east → south → west per 90°; down (0) and up (1) never change. */
export function rotateFacing(f: number, r: Rotation): number {
  const turns = quarters(r);
  if (f === 0 || f === 1) return f;
  const i = CLOCKWISE.indexOf(f);
  if (i === -1) throw new RangeError(`a facing is a ForgeDirection 0..5, got ${f}`);
  return CLOCKWISE[(i + turns) % 4]!;
}

/** Connection bits (`1 << side`) after the rotation: each horizontal bit turns like its facing, other bits stay. */
export function rotateConnections(bits: number, r: Rotation): number {
  let out = bits & ~HORIZONTAL_BITS;
  for (const side of CLOCKWISE) if (bits & (1 << side)) out |= 1 << rotateFacing(side, r);
  return out;
}

/** A block face after the rotation. */
export function rotateFace(face: Face, r: Rotation): Face {
  return FACES[rotateFacing(FACES.indexOf(face), r)]!;
}

/** The world position of local cell `local` of a box of `size` (before rotation) whose rotated min corner is `origin`. */
export function toWorld(local: Vec3, origin: Vec3, r: Rotation, size: Vec3): Vec3 {
  const p = rotateLocal(local, r, size);
  return [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]];
}
