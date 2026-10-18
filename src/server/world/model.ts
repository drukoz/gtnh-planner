// Internal records of a world scan, shared by the chunk pass, the classifiers and the network builders: positions,
// ForgeDirection steps, the tile entities a chunk pass keeps and its per-chunk statistics.

import type { StuffKey } from '../../shared/keys.ts';
import type { NbtCompound } from './nbt.ts';

/** A block position `[x, y, z]`. */
export type Vec3 = [number, number, number];

/** A whitelisted tile entity as the chunk pass found it: its `id`, absolute position and the whole parsed compound. */
export interface RawTe { dim: number; id: string; x: number; y: number; z: number; nbt: NbtCompound }

/** One chunk: `timestamp` is the region header's save time (Unix seconds); `teCount` counts every TE, ores included. */
export interface ChunkStat { dim: number; cx: number; cz: number; inhabitedTime: number; timestamp: number; teCount: number; oreTes: number }

export interface ChunkScanResult { stat: ChunkStat; tes: RawTe[] }

export interface ItemCount { key: StuffKey; count: number }

export function posKey(dim: number, x: number, y: number, z: number): string {
  return `${dim}:${x}:${y}:${z}`;
}

const dir = (x: number, y: number, z: number): Vec3 => Object.freeze([x, y, z]) as Vec3;

/** ForgeDirection ordinals 0..5: down (−y), up (+y), north (−z), south (+z), west (−x), east (+x). */
export const DIRS: readonly Vec3[] = Object.freeze([dir(0, -1, 0), dir(0, 1, 0), dir(0, 0, -1), dir(0, 0, 1), dir(-1, 0, 0), dir(1, 0, 0)]);

/** The side facing back: `OPPOSITE[s]` is the ordinal opposite side `s`. */
export const OPPOSITE = [1, 0, 3, 2, 5, 4] as const;

/** The neighbour of `p` on `side` (a ForgeDirection ordinal 0..5). */
export function step(p: Vec3, side: number): Vec3 {
  const d = DIRS[side];
  if (d === undefined) throw new RangeError(`side must be a ForgeDirection ordinal 0..5, got ${side}`);
  return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
}
