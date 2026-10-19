// Anvil region files (world-format §1.3): the 8 KiB header, chunk payloads, region file paths and `trimRegion`,
// which the browser's smart upload uses to send only the chunks it keeps (architecture §11.12).
// Shared by server and browser: only Uint8Array and DataView, no Node built-in modules.

export const REGION_HEADER_BYTES = 8192;
export const SECTOR_BYTES = 4096;

const CHUNKS_PER_REGION = 1024;
const HEADER_SECTORS = REGION_HEADER_BYTES / SECTOR_BYTES;
/** A location entry stores the sector count in 8 bits. */
const MAX_CHUNK_SECTORS = 255;
/** u32 BE length, then the compression byte. */
const PAYLOAD_PREFIX = 5;

export interface RegionChunkRef { index: number; localX: number; localZ: number; offset: number /* bytes */; sectors: number; timestamp: number }

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Every present chunk (non-zero location entry) in index order. A header shorter than 8 KiB (a truncated file) reads
 * its missing entries as 0: absent chunks and timestamps.
 */
export function regionChunkRefs(header: Uint8Array): RegionChunkRef[] {
  const view = viewOf(header);
  const refs: RegionChunkRef[] = [];
  for (let index = 0; index < CHUNKS_PER_REGION; index++) {
    const at = index * 4;
    if (at + 4 > header.length) break;
    const location = view.getUint32(at);
    if (location === 0) continue;
    const stamp = SECTOR_BYTES + at;
    refs.push({
      index, localX: index & 31, localZ: index >> 5,
      offset: (location >>> 8) * SECTOR_BYTES, sectors: location & 0xff,
      timestamp: stamp + 4 <= header.length ? view.getUint32(stamp) : 0,
    });
  }
  return refs;
}

/**
 * The compression byte and compressed bytes of a chunk, as a view of `region`. Null when the payload cannot be in the
 * file: it starts inside the header, its length field or its data run past the end, or its length is 0.
 */
export function chunkPayload(region: Uint8Array, ref: RegionChunkRef): { compression: number; data: Uint8Array } | null {
  const start = ref.offset;
  if (start < REGION_HEADER_BYTES || start + PAYLOAD_PREFIX > region.length) return null;
  const length = viewOf(region).getUint32(start);   // counts the compression byte
  if (length < 1 || start + 4 + length > region.length) return null;
  return { compression: region[start + 4]!, data: new Uint8Array(region.buffer, region.byteOffset + start + PAYLOAD_PREFIX, length - 1) };
}

/** The chunk's index in its region file (and in the header tables). */
export function chunkIndex(cx: number, cz: number): number {
  return (cx & 31) + (cz & 31) * 32;
}

/** The region coordinate of a chunk coordinate. */
export function regionOfChunk(c: number): number {
  return c >> 5;
}

// One spelling per file: integers without leading zeros, '+' or '-0'; the Overworld has no DIM prefix, so 'DIM0/' is
// not a region path (regionPathOf(parseRegionPath(p)) === p for every accepted p).
const REGION_PATH = /^(?:DIM(-?[1-9]\d*)\/)?region\/r\.(0|-?[1-9]\d*)\.(0|-?[1-9]\d*)\.mca$/;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/** `region/r.<rx>.<rz>.mca` (dim 0) or `DIM<n>/region/r.<rx>.<rz>.mca`, world-relative; anything else is null. */
export function parseRegionPath(rel: string): { dim: number; rx: number; rz: number } | null {
  const m = REGION_PATH.exec(rel);
  if (m === null) return null;
  const [dim, rx, rz] = [m[1] === undefined ? 0 : Number(m[1]), Number(m[2]), Number(m[3])];
  return [dim, rx, rz].every((n) => n >= INT32_MIN && n <= INT32_MAX) ? { dim, rx, rz } : null;
}

export function regionPathOf(dim: number, rx: number, rz: number): string {
  if (![dim, rx, rz].every(Number.isInteger)) throw new RangeError(`region coordinates must be integers, got ${dim} ${rx} ${rz}`);
  const file = `region/r.${rx}.${rz}.mca`;
  return dim === 0 ? file : `DIM${dim}/${file}`;
}

/**
 * A valid region file holding only the chunks whose index is in `keep` and whose payload is readable: written in index
 * order from sector 2, each as length (data + 1), compression byte, data and zero padding to whole sectors, with the
 * original timestamps; every other header entry is 0. Indices absent from the file are ignored, and so is a chunk too
 * large for a location entry (over 255 sectors). `trimRegion(r, [])` is the 8 KiB header alone.
 */
export function trimRegion(region: Uint8Array, keep: readonly number[]): Uint8Array {
  const wanted = new Set(keep);
  const kept: Array<{ ref: RegionChunkRef; compression: number; data: Uint8Array; sectors: number }> = [];
  for (const ref of regionChunkRefs(region.subarray(0, REGION_HEADER_BYTES))) {
    if (!wanted.has(ref.index)) continue;
    const payload = chunkPayload(region, ref);
    if (payload === null) continue;
    const sectors = Math.ceil((payload.data.length + PAYLOAD_PREFIX) / SECTOR_BYTES);
    if (sectors > MAX_CHUNK_SECTORS) continue;
    kept.push({ ref, ...payload, sectors });
  }
  const totalSectors = kept.reduce((n, k) => n + k.sectors, HEADER_SECTORS);
  const out = new Uint8Array(totalSectors * SECTOR_BYTES);
  const view = viewOf(out);
  let sector = HEADER_SECTORS;
  for (const { ref, compression, data, sectors } of kept) {
    view.setUint32(ref.index * 4, sector * 256 + sectors);
    view.setUint32(SECTOR_BYTES + ref.index * 4, ref.timestamp);
    const at = sector * SECTOR_BYTES;
    view.setUint32(at, data.length + 1);
    out[at + 4] = compression;
    out.set(data, at + PAYLOAD_PREFIX);
    sector += sectors;
  }
  return out;
}
