// Decompression is injected, never imported (architecture §11.12): the server passes a node:zlib `Inflate`
// (src/server/world/nbt.ts), the browser one built on DecompressionStream (Plan 4 Task 17a).

import { isGzip, NbtError, parseNbt, type NbtCompound } from './nbt.ts';

export type Inflate = (data: Uint8Array, kind: 'zlib' | 'gzip') => Promise<Uint8Array>;

/** A plain Uint8Array over the same bytes (byte arrays of subclasses become views, never copies). */
function plain(bytes: Uint8Array): Uint8Array {
  return bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** How a region chunk payload is compressed (world-format §1.3): 2 zlib, 1 gzip, 3 none; any other value throws. */
export function chunkCompression(compression: number): 'zlib' | 'gzip' | 'none' {
  switch (compression) {
    case 2: return 'zlib';
    case 1: return 'gzip';
    case 3: return 'none';
    default: throw new NbtError(`unknown chunk compression ${compression}`);
  }
}

/** NBT that may be gzip'd (level.dat, player files): gunzipped through `inflate` when it is, else parsed as is. */
export async function readNbtWith(buf: Uint8Array, inflate: Inflate): Promise<NbtCompound> {
  return parseNbt(isGzip(buf) ? await inflate(buf, 'gzip') : buf);
}

/** The uncompressed NBT bytes of a region chunk payload (`chunkPayload` in region.ts). */
export async function inflateChunkWith(p: { compression: number; data: Uint8Array }, inflate: Inflate): Promise<Uint8Array> {
  const kind = chunkCompression(p.compression);
  return plain(kind === 'none' ? p.data : await inflate(p.data, kind));
}
