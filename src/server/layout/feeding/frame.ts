// The line's local frame (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 2 rule 1, Review Focus 1):
// a laid-out line turned back to rotation 0 at its min corner, as `layoutLine` laid it before `toWorld` placed it. Every
// position, side and order the feeding checker keeps is in this frame, so a line reads and reports the same in every
// rotation and wherever it was dragged.
// Pure TypeScript: nothing from node:* may be imported here.

import { posKey, rotateConnections, rotatedSize, rotateFacing, type Rotation, type Vec3 } from '../../../shared/layout/geometry.ts';
import type { Layout } from '../../../shared/types/layout.ts';
import type { NodeId } from './model.ts';

/** The turn that undoes `r`. */
function backTurn(r: Rotation): Rotation {
  return r === 90 ? 270 : r === 270 ? 90 : r;
}

/**
 * The local cell of world cell `p`: `toWorld` inverted. `layout.size` is the world box, so the line's own size (before
 * the turn) is `rotatedSize(layout.size, layout.rotation)`.
 */
export function fromWorld(p: Vec3, layout: Pick<Layout, 'origin' | 'rotation' | 'size'>): Vec3 {
  const [w, , l] = rotatedSize(layout.size, layout.rotation);
  const a = p[0] - layout.origin[0], y = p[1] - layout.origin[1], b = p[2] - layout.origin[2];
  switch (layout.rotation) {
    case 90: return [b, y, l - 1 - a];
    case 180: return [w - 1 - a, y, l - 1 - b];
    case 270: return [w - 1 - b, y, a];
    default: return [a, y, b];
  }
}

/** A world side (ForgeDirection 0–5) of a block of a line turned by `rotation`, in the line's local frame. */
export function localSide(side: number, rotation: Rotation): number {
  return rotateFacing(side, backTurn(rotation));
}

/** World connection bits (`1 << side`) of a block of a line turned by `rotation`, in the line's local frame. */
export function localConnections(bits: number, rotation: Rotation): number {
  return rotateConnections(bits, backTurn(rotation));
}

/** The id of a local cell: `x,y,z`. */
export function nodeId(local: Vec3): NodeId {
  return posKey(local);
}

/** Local cells by x, then y, then z. */
export function compareLocal(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
