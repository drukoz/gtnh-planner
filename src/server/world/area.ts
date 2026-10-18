// Block access to a world's region files (world-format §3): an LRU-cached chunk reader on a `RegionStore`, and the
// voxel reader of a bounding box that the base viewer and the planner's structure matching use. Only `Level.Sections`
// of a chunk is decoded; tile entities, entities and biomes are never built.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { UNKNOWN_INDEX, type BBox, type Voxels } from '../../shared/types/world.ts';
import type { WorldFiles } from './files.ts';
import { parseNbt, type NbtCompound } from './nbt.ts';
import { chunkIndex, chunkPayload, inflateChunk, regionChunkRefs, regionOfChunk, regionPathOf, REGION_HEADER_BYTES, type RegionChunkRef } from './region.ts';
import { decodeSection, sectionIndex, type DecodedSection } from './sections.ts';
import { createPalette, GT_MACHINE_BLOCK, refAt } from './tiles.ts';

export interface RegionStore { readRegion(dim: number, rx: number, rz: number): Promise<Uint8Array | null> }

export function regionStoreFromFiles(files: WorldFiles): RegionStore {
  return { readRegion: (dim, rx, rz) => files.read(regionPathOf(dim, rx, rz)) };
}

/** Region files at `<regionsDir>/<regionPathOf(dim, rx, rz)>`; a missing file is null, other file system errors propagate. */
export function regionStoreFromDir(regionsDir: string): RegionStore {
  return {
    async readRegion(dim, rx, rz) {
      try {
        return await readFile(join(regionsDir, regionPathOf(dim, rx, rz)));
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return null;
        throw err;
      }
    },
  };
}

export interface DecodedChunk { cx: number; cz: number; sections: Array<DecodedSection | null> /* length 16, by section Y */ }

export interface BlockReader {
  /** Null when the chunk is not available (no region, absent from it, or unreadable). */
  chunk(dim: number, cx: number, cz: number): Promise<DecodedChunk | null>;
  /** Null when the chunk is not available; a missing section or a `y` outside 0..255 is air. */
  blockAt(dim: number, x: number, y: number, z: number): Promise<{ id: number; meta: number } | null>;
}

const SECTIONS_PER_CHUNK = 16;
const AIR_BLOCK = { id: 0, meta: 0 } as const;

interface LoadedRegion { bytes: Uint8Array; refs: Map<number, RegionChunkRef> }

function isCompound(v: unknown): v is NbtCompound {
  return typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !(v instanceof Int32Array) && !Array.isArray(v);
}

/** The decoded sections of a chunk's NBT, or null when it has no `Level` compound; a bad `Y` leaves that section out. */
function decodeChunk(nbt: NbtCompound, cx: number, cz: number): DecodedChunk | null {
  const level = nbt.Level;
  if (!isCompound(level)) return null;
  const sections: Array<DecodedSection | null> = new Array<DecodedSection | null>(SECTIONS_PER_CHUNK).fill(null);
  const list = level.Sections;
  if (Array.isArray(list)) {
    for (const s of list) {
      if (!isCompound(s) || typeof s.Y !== 'number' || !Number.isInteger(s.Y) || s.Y < 0 || s.Y >= SECTIONS_PER_CHUNK) continue;
      sections[s.Y] = decodeSection(s);
    }
  }
  return { cx, cz, sections };
}

/** Evicts the oldest entry of `map` beyond `max`; a hit is re-inserted by the callers to stay young. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value!);
}

export function createBlockReader(store: RegionStore, opts: { maxChunks?: number; maxRegions?: number } = {}): BlockReader {
  const maxChunks = opts.maxChunks ?? 128, maxRegions = opts.maxRegions ?? 4;
  const regions = new Map<string, LoadedRegion | null>();
  const chunks = new Map<string, DecodedChunk | null>();

  async function region(dim: number, rx: number, rz: number): Promise<LoadedRegion | null> {
    const key = `${dim}:${rx}:${rz}`;
    if (regions.has(key)) {
      const hit = regions.get(key)!;
      remember(regions, key, hit, maxRegions);
      return hit;
    }
    const bytes = await store.readRegion(dim, rx, rz);
    const loaded = bytes === null ? null : {
      bytes,
      refs: new Map(regionChunkRefs(bytes.subarray(0, REGION_HEADER_BYTES)).map((r) => [r.index, r] as const)),
    };
    remember(regions, key, loaded, maxRegions);
    return loaded;
  }

  async function load(dim: number, cx: number, cz: number): Promise<DecodedChunk | null> {
    const reg = await region(dim, regionOfChunk(cx), regionOfChunk(cz));
    const ref = reg?.refs.get(chunkIndex(cx, cz));
    if (reg === null || ref === undefined) return null;
    const payload = chunkPayload(reg.bytes, ref);
    if (payload === null) return null;
    try {
      return decodeChunk(parseNbt(inflateChunk(payload)), cx, cz);
    } catch {
      return null;   // a chunk that fails to inflate or parse reads as missing
    }
  }

  async function chunk(dim: number, cx: number, cz: number): Promise<DecodedChunk | null> {
    const key = `${dim}:${cx}:${cz}`;
    if (chunks.has(key)) {
      const hit = chunks.get(key)!;
      remember(chunks, key, hit, maxChunks);
      return hit;
    }
    const decoded = await load(dim, cx, cz);
    remember(chunks, key, decoded, maxChunks);
    return decoded;
  }

  return {
    chunk,
    async blockAt(dim, x, y, z) {
      const c = await chunk(dim, x >> 4, z >> 4);
      if (c === null) return null;
      if (y < 0 || y > 255) return { ...AIR_BLOCK };
      const section = c.sections[y >> 4];
      if (section === null || section === undefined) return { ...AIR_BLOCK };
      const i = sectionIndex(x, y, z);
      return { id: section.ids[i]!, meta: section.meta[i]! };
    },
  };
}

/** Returns the GT machine mID at a position (from the tile entity scan); undefined when there is none. */
export type MteLookup = (dim: number, x: number, y: number, z: number) => number | undefined;

export interface AreaInput { reader: BlockReader; blockNames: Map<number, string>; mteAt: MteLookup }

export const MAX_AREA_VOXELS = 8_388_608;

function checkBox(bbox: BBox): [number, number, number] {
  const { minX, minY, minZ, maxX, maxY, maxZ } = bbox;
  const size: [number, number, number] = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isInteger) || size.some((n) => n < 1)) {
    throw new RangeError(`invalid area ${JSON.stringify(bbox)}`);
  }
  if (size[0] * size[1] * size[2] > MAX_AREA_VOXELS) {
    throw new RangeError(`area of ${size.join('×')} blocks is over the limit of ${MAX_AREA_VOXELS}`);
  }
  return size;
}

/** The ids of the blocks that are GregTech machines (normally one). */
export function gtMachineIds(blockNames: Map<number, string>): Set<number> {
  const ids = new Set<number>();
  for (const [id, name] of blockNames) if (name === GT_MACHINE_BLOCK) ids.add(id);
  return ids;
}

/**
 * The blocks of `bbox` (inclusive) in `dim` as voxels with a local palette: `[0]` air, `[1]` unknown for the columns
 * of chunks that are not available, and a block id without a registry name reads as unknown too. Yields to the event
 * loop after each chunk.
 */
export async function readAreaVoxels(input: AreaInput, dim: number, bbox: BBox): Promise<Voxels> {
  const size = checkBox(bbox);
  const { reader, blockNames, mteAt } = input;
  const palette = createPalette();
  const gtIds = gtMachineIds(blockNames);
  const blocks = new Uint32Array(size[0] * size[1] * size[2]);
  const seen = new Map<number, number>();   // id·65536 + meta → palette index, for blocks that carry no position data
  const layer = size[0] * size[2];
  for (let cz = bbox.minZ >> 4; cz <= bbox.maxZ >> 4; cz++) {
    for (let cx = bbox.minX >> 4; cx <= bbox.maxX >> 4; cx++) {
      const chunk = await reader.chunk(dim, cx, cz);
      const x0 = Math.max(bbox.minX, cx * 16), x1 = Math.min(bbox.maxX, cx * 16 + 15);
      const z0 = Math.max(bbox.minZ, cz * 16), z1 = Math.min(bbox.maxZ, cz * 16 + 15);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const column = (z - bbox.minZ) * size[0] + (x - bbox.minX);
          for (let y = bbox.minY; y <= bbox.maxY; y++) {
            const at = (y - bbox.minY) * layer + column;
            if (chunk === null) { blocks[at] = UNKNOWN_INDEX; continue; }
            const section = y < 0 || y > 255 ? null : chunk.sections[y >> 4];
            if (section === null || section === undefined) continue;   // air
            const i = sectionIndex(x, y, z), id = section.ids[i]!;
            if (id === 0) continue;
            const meta = section.meta[i]!;
            if (gtIds.has(id)) {
              blocks[at] = palette.index(refAt(GT_MACHINE_BLOCK, meta, mteAt(dim, x, y, z)));
              continue;
            }
            const key = id * 65536 + meta;
            let index = seen.get(key);
            if (index === undefined) {
              const name = blockNames.get(id);
              index = name === undefined ? UNKNOWN_INDEX : palette.index(refAt(name, meta, undefined));
              seen.set(key, index);
            }
            blocks[at] = index;
          }
        }
      }
      await yieldToLoop();
    }
  }
  return { origin: [bbox.minX, bbox.minY, bbox.minZ], size, blocks, palette: palette.refs };
}
