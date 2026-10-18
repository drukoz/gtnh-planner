export * from '../../shared/world/region.ts';

// Server side of the shared region code: synchronous chunk inflation for the scan worker and the block reader.

import { gunzipSync, inflateSync } from 'node:zlib';
import { chunkCompression } from '../../shared/world/inflate.ts';
import { INFLATE_LIMIT } from './nbt.ts';

/**
 * The uncompressed NBT of a chunk payload: 2 zlib, 1 gzip, 3 none (a view, no copy); other values throw NbtError, and
 * a payload that would inflate past `MAX_INFLATED_BYTES` throws a RangeError.
 */
export function inflateChunk(p: { compression: number; data: Uint8Array }): Buffer {
  switch (chunkCompression(p.compression)) {
    case 'zlib': return inflateSync(p.data, INFLATE_LIMIT);
    case 'gzip': return gunzipSync(p.data, INFLATE_LIMIT);
    case 'none': return Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  }
}
