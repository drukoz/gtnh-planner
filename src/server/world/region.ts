export * from '../../shared/world/region.ts';

// Server side of the shared region code: synchronous chunk inflation for the scan worker.

import { gunzipSync, inflateSync } from 'node:zlib';
import { chunkCompression } from '../../shared/world/inflate.ts';

/** The uncompressed NBT of a chunk payload: 2 zlib, 1 gzip, 3 none (a view, no copy); other values throw NbtError. */
export function inflateChunk(p: { compression: number; data: Uint8Array }): Buffer {
  switch (chunkCompression(p.compression)) {
    case 'zlib': return inflateSync(p.data);
    case 'gzip': return gunzipSync(p.data);
    case 'none': return Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  }
}
