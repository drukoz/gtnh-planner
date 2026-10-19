// A chunk's coordinates and InhabitedTime by a cursor skip-scan (world-format §3.1, §8): everything else in the root
// and in `Level` (Sections, TileEntities, Entities, …) is skipped by length, so no section is decoded. Base clustering
// and the browser's smart upload (architecture §11.12) share it. Shared by server and browser.

import { cursor, NbtError, readName, readPayload, readTagType, skipPayload, TAG, type NbtCursor } from './nbt.ts';

/** One hour of a player nearby (InhabitedTime counts ticks): a chunk this lived-in belongs to a base. */
export const INHABITED_KEEP_TICKS = 72_000;

export interface ChunkSummary { cx: number; cz: number; inhabitedTime: number }

function levelSummary(c: NbtCursor): ChunkSummary {
  let cx: number | null = null, cz: number | null = null, inhabitedTime: number | null = null;
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const name = readName(c);
    if (name !== 'xPos' && name !== 'zPos' && name !== 'InhabitedTime') {
      skipPayload(c, type);
      continue;
    }
    const value = readPayload(c, type);
    if (typeof value !== 'number') continue;
    if (name === 'xPos') cx = value;
    else if (name === 'zPos') cz = value;
    else inhabitedTime = value;
    if (cx !== null && cz !== null && inhabitedTime !== null) break;   // the rest of the chunk is not needed
  }
  if (cx === null || cz === null) throw new NbtError('chunk Level has no xPos or zPos');
  return { cx, cz, inhabitedTime: inhabitedTime ?? 0 };
}

/** `nbt` is the decompressed chunk. InhabitedTime missing → 0; `Level`, `xPos` or `zPos` missing → NbtError. */
export function chunkSummary(nbt: Uint8Array): ChunkSummary {
  const c = cursor(nbt);
  const rootType = readTagType(c);
  if (rootType !== TAG.Compound) throw new NbtError(`chunk root is tag type ${rootType}, not a compound`);
  readName(c);
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const name = readName(c);
    if (name === 'Level' && type === TAG.Compound) return levelSummary(c);
    skipPayload(c, type);
  }
  throw new NbtError('chunk has no Level compound');
}
