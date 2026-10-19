// Map tiles (spec §3.4b): per column the first non-air block at or below a height, scanning down, as a palette index
// plus its height. The palette is shared by all tiles of a scan (or frozen, once the scan has finished).

import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { AIR_INDEX, TILE_SIZE, UNKNOWN_BLOCK, UNKNOWN_INDEX, type MapTile } from '../../shared/types/world.ts';
import type { BlockRef } from '../../shared/types/pack.ts';
import { gtMachineIds, type AreaInput } from './area.ts';
import { sectionIndex } from './sections.ts';

export const GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines';

const AIR: BlockRef = { id: 'minecraft:air', meta: 0 };
const CHUNKS_PER_TILE = TILE_SIZE / 16;

/** A block state; the GT tile id is kept only on the GregTech machine block. */
export function refAt(name: string, meta: number, mteId: number | undefined): BlockRef {
  return name === GT_MACHINE_BLOCK && mteId !== undefined ? { id: name, meta, mteId } : { id: name, meta };
}

export interface Palette { refs: BlockRef[]; index(ref: BlockRef): number }

function keyOf(ref: BlockRef): string {
  return `${ref.id}|${ref.meta}|${ref.mteId ?? ''}`;
}

/**
 * `refs[0]` is air and `refs[1]` unknown; states are de-duplicated by `id|meta|mteId`, and air of any meta is
 * `AIR_INDEX`. A frozen palette answers `UNKNOWN_INDEX` for a state it does not hold.
 */
export function createPalette(initial?: BlockRef[], opts: { frozen?: boolean } = {}): Palette {
  const refs = initial === undefined ? [AIR, UNKNOWN_BLOCK] : [...initial];
  const indexOf = new Map<string, number>();
  refs.forEach((r, i) => { if (!indexOf.has(keyOf(r))) indexOf.set(keyOf(r), i); });
  return {
    refs,
    index(ref) {
      if (ref.id === AIR.id) return AIR_INDEX;
      const key = keyOf(ref);
      const known = indexOf.get(key);
      if (known !== undefined) return known;
      if (opts.frozen === true) return UNKNOWN_INDEX;
      refs.push({ ...ref });
      indexOf.set(key, refs.length - 1);
      return refs.length - 1;
    },
  };
}

/** Adds every block state in the chunk to the palette (nothing for a chunk that is not available). */
export async function addChunkToPalette(input: AreaInput, palette: Palette, dim: number, cx: number, cz: number): Promise<void> {
  const chunk = await input.reader.chunk(dim, cx, cz);
  if (chunk === null) return;
  const gtIds = gtMachineIds(input.blockNames);
  const seen = new Set<number>();
  chunk.sections.forEach((section, sy) => {
    if (section === null) return;
    for (let i = 0; i < 4096; i++) {
      const id = section.ids[i]!;
      if (id === 0) continue;
      const meta = section.meta[i]!;
      if (gtIds.has(id)) {
        const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = sy * 16 + (i >> 8);
        palette.index(refAt(GT_MACHINE_BLOCK, meta, input.mteAt(dim, x, y, z)));
        continue;
      }
      const key = id * 65536 + meta;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = input.blockNames.get(id);
      if (name !== undefined) palette.index(refAt(name, meta, undefined));
    }
  });
}

/**
 * The tile (tx, tz) of `dim`: column `i = lz·64 + lx` with `lx = x − tx·64`. A column of a chunk that is not available
 * is `UNKNOWN_INDEX` with height 0, a column with only air at or below `maxY` is `AIR_INDEX` with height 0. Yields to
 * the event loop after each chunk.
 */
export async function renderTile(input: AreaInput, palette: Palette, dim: number, tx: number, tz: number, maxY: number): Promise<MapTile> {
  const top = new Uint32Array(TILE_SIZE * TILE_SIZE), height = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const gtIds = gtMachineIds(input.blockNames);
  const top0 = Math.min(255, Math.max(-1, Math.floor(maxY)));
  const seen = new Map<number, number>();
  for (let kz = 0; kz < CHUNKS_PER_TILE; kz++) {
    for (let kx = 0; kx < CHUNKS_PER_TILE; kx++) {
      const cx = tx * CHUNKS_PER_TILE + kx, cz = tz * CHUNKS_PER_TILE + kz;
      const chunk = await input.reader.chunk(dim, cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const col = (kz * 16 + z) * TILE_SIZE + kx * 16 + x;
          if (chunk === null) { top[col] = UNKNOWN_INDEX; continue; }   // height stays 0
          top[col] = AIR_INDEX;
          for (let y = top0; y >= 0; y--) {
            const section = chunk.sections[y >> 4];
            if (section === null || section === undefined) { y = (y & ~15); continue; }   // the loop's y-- lands below the section
            const i = sectionIndex(x, y, z), id = section.ids[i]!;
            if (id === 0) continue;
            const meta = section.meta[i]!;
            if (gtIds.has(id)) {
              top[col] = palette.index(refAt(GT_MACHINE_BLOCK, meta, input.mteAt(dim, cx * 16 + x, y, cz * 16 + z)));
            } else {
              const key = id * 65536 + meta;
              let index = seen.get(key);
              if (index === undefined) {
                const name = input.blockNames.get(id);
                index = name === undefined ? UNKNOWN_INDEX : palette.index(refAt(name, meta, undefined));
                seen.set(key, index);
              }
              top[col] = index;
            }
            height[col] = y;
            break;
          }
        }
      }
      await yieldToLoop();
    }
  }
  return { dim, tx, tz, size: TILE_SIZE, top, height };
}
