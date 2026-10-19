// The chunk pass (world-format §8 Pass 2): a cursor skip-scan of each chunk that reads `xPos`, `zPos` and
// `InhabitedTime`, and walks `TileEntities` looking only at each element's `id`. Whitelisted TEs are parsed in full;
// everything else, `Sections`, `Entities` and biomes included, is skipped by length. GT ore TEs (~99.6% of all TEs in
// a real world) are recognised by comparing bytes, so no string or object is ever built for them (spec §5).
// Also the item-stack reader every classifier uses (world-format §5).

import { itemKey, type ItemKey } from '../../shared/keys.ts';
import type { ChunkScanResult, RawTe } from './model.ts';
import {
  comp, cursor, NbtError, readName, readPayload, readTagType, skipPayload, TAG, type NbtCompound, type NbtCursor,
} from './nbt.ts';
import { chunkPayload, inflateChunk, REGION_HEADER_BYTES, regionChunkRefs } from './region.ts';

/** TE ids the scan keeps (world-format §6): GregTech, JABBA, chests, Forge Multipart, EnderIO and AE2. */
export const TE_WHITELIST: ReadonlySet<string> = new Set([
  'BaseMetaTileEntity', 'BaseMetaPipeEntity', 'TileEntityBarrel', 'Chest', 'savedMultipart', 'blockConduitBundleTileEntity',
  'BlockCableBus', 'BlockController', 'BlockDrive', 'BlockChest', 'BlockInterface',
]);

/** TE id prefixes the scan keeps: every IronChest type and every Storage Drawers TE. */
export const TE_PREFIXES: readonly string[] = Object.freeze(['IronChest.', 'StorageDrawers:']);

const ORE_TE_ID = 'GT_TileEntity_Ores';

export function isWantedTe(id: string): boolean {
  return TE_WHITELIST.has(id) || TE_PREFIXES.some((p) => id.startsWith(p));
}

const ASCII = new TextEncoder();
const ID_BYTES = ASCII.encode('id');
const ORE_ID_BYTES = ASCII.encode(ORE_TE_ID);

/** True when the u16-length string at the cursor (a tag name or a String payload) is exactly `bytes`; the cursor stays. */
function stringIs(c: NbtCursor, bytes: Uint8Array): boolean {
  const at = c.pos;
  if (at + 2 + bytes.length > c.buf.length || c.view.getUint16(at) !== bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (c.buf[at + 2 + i] !== bytes[i]) return false;
  return true;
}

/**
 * Walks the TE compound at the cursor to its end and returns its String `id` wherever it sits (the last one if a
 * malformed compound repeats it), or null. Other keys are skipped by length; the ore id comes back as one shared string.
 */
function skimTeId(c: NbtCursor): string | null {
  let id: string | null = null;
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const isId = type === TAG.String && stringIs(c, ID_BYTES);
    skipPayload(c, TAG.String);   // the name: a u16-length string, like a String payload
    if (!isId) {
      skipPayload(c, type);
    } else if (stringIs(c, ORE_ID_BYTES)) {
      skipPayload(c, TAG.String);
      id = ORE_TE_ID;
    } else {
      id = readName(c);
    }
  }
  return id;
}

interface TeTally { teCount: number; oreTes: number }

/** The `TileEntities` list at the cursor (its type byte and name already read): counts every element, keeps wanted ones. */
function scanTileEntities(c: NbtCursor, dim: number, tally: TeTally, tes: RawTe[]): void {
  const elem = readTagType(c);
  const count = readPayload(c, TAG.Int) as number;
  if (count < 0) throw new NbtError(`negative TileEntities length ${count}`);
  if (elem !== TAG.Compound) {
    for (let i = 0; i < count; i++) skipPayload(c, elem);
    return;
  }
  for (let i = 0; i < count; i++) {
    const start = c.pos;
    const id = skimTeId(c);
    tally.teCount++;
    if (id === ORE_TE_ID) {
      tally.oreTes++;
      continue;
    }
    if (id === null || !isWantedTe(id)) continue;
    const end = c.pos;
    c.pos = start;
    const nbt = readPayload(c, TAG.Compound) as NbtCompound;
    c.pos = end;
    const { x, y, z } = nbt;
    // world-format §6: every TE has Int x, y, z; one without them cannot be placed, so it is not kept
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') tes.push({ dim, id, x, y, z, nbt });
  }
}

function scanLevel(c: NbtCursor, dim: number, timestamp: number): ChunkScanResult {
  let cx: number | null = null, cz: number | null = null, inhabitedTime = 0;
  const tally: TeTally = { teCount: 0, oreTes: 0 };
  const tes: RawTe[] = [];
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const name = readName(c);
    if (name === 'TileEntities' && type === TAG.List) {
      scanTileEntities(c, dim, tally, tes);
    } else if (name === 'xPos' || name === 'zPos' || name === 'InhabitedTime') {
      const value = readPayload(c, type);
      if (typeof value !== 'number') continue;
      if (name === 'xPos') cx = value;
      else if (name === 'zPos') cz = value;
      else inhabitedTime = value;
    } else {
      skipPayload(c, type);
    }
  }
  if (cx === null || cz === null) throw new NbtError('chunk Level has no xPos or zPos');
  return { stat: { dim, cx, cz, inhabitedTime, timestamp, ...tally }, tes };
}

/**
 * One decompressed chunk, skip-parsed (no full parse): its stat and its wanted TEs in chunk order. `timestamp` is the
 * region header's save time. Throws NbtError for NBT that is not a chunk (no `Level`, `xPos` or `zPos`) or is malformed.
 */
export function scanChunk(nbt: Uint8Array, dim: number, timestamp: number): ChunkScanResult {
  const c = cursor(nbt);
  const rootType = readTagType(c);
  if (rootType !== TAG.Compound) throw new NbtError(`chunk root is tag type ${rootType}, not a compound`);
  readName(c);
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const name = readName(c);
    if (name === 'Level' && type === TAG.Compound) return scanLevel(c, dim, timestamp);
    skipPayload(c, type);
  }
  throw new NbtError('chunk has no Level compound');
}

/**
 * Every chunk of a region file in header order. A present chunk whose payload cannot be in the file, or that fails to
 * inflate or parse (a torn or corrupt chunk), is left out and counted in `skipped` (ruling R8).
 */
export function scanRegionBuffer(region: Uint8Array, dim: number): { chunks: ChunkScanResult[]; skipped: number } {
  const chunks: ChunkScanResult[] = [];
  let skipped = 0;
  for (const ref of regionChunkRefs(region.subarray(0, REGION_HEADER_BYTES))) {
    const payload = chunkPayload(region, ref);
    if (payload === null) {
      skipped++;
      continue;
    }
    try {
      chunks.push(scanChunk(inflateChunk(payload), dim, ref.timestamp));
    } catch {
      skipped++;
    }
  }
  return { chunks, skipped };
}

/**
 * An item stack (world-format §5): id from `idExt`, else a numeric `id` (Int or Short), else a String registry name;
 * a negative `Damage` reads as 0; `Count` is a Byte or an Int. Null when the stack cannot be keyed reliably: an unknown
 * numeric id, no id, a negative count, or a damage `itemKey` refuses (the 32767 wildcard).
 */
export function readStack(t: NbtCompound, itemNames: Map<number, string>): { key: ItemKey; count: number; tag: NbtCompound | null } | null {
  const raw = typeof t.idExt === 'number' ? t.idExt : t.id;
  const name = typeof raw === 'number' ? itemNames.get(raw) : typeof raw === 'string' && raw !== '' ? raw : undefined;
  if (name === undefined) return null;
  const count = typeof t.Count === 'number' ? t.Count : 0;
  if (count < 0) return null;
  let key: ItemKey;
  try {
    key = itemKey(name, Math.max(0, typeof t.Damage === 'number' ? t.Damage : 0));
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
  return { key, count, tag: comp(t.tag) };
}
