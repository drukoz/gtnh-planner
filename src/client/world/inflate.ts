// The browser's `Inflate` for the shared world readers (architecture §11.12): the Compression Streams API, so no
// zlib library ships to the page. 'deflate' is the zlib-wrapped format region chunks use; 'gzip' is level.dat's and
// the player and claim files'.

import type { Inflate } from '../../shared/world/inflate.ts';

/**
 * The same bytes on a plain ArrayBuffer, as streams and Blob take them: a view when they already are, else a copy
 * (a SharedArrayBuffer view).
 */
export function unshared(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
}

/** Rejects (TypeError) when `data` is not valid zlib or gzip data, truncated input included. */
export const browserInflate: Inflate = async (data, kind) => {
  const ds = new DecompressionStream(kind === 'zlib' ? 'deflate' : 'gzip');
  const writer = ds.writable.getWriter();
  // Both sides run together: a reader that waited for the write to finish would stall a large input's backpressure.
  const [out] = await Promise.all([new Response(ds.readable).arrayBuffer(), writer.write(unshared(data)), writer.close()]);
  return new Uint8Array(out);
};
