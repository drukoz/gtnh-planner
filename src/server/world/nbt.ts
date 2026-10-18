export * from '../../shared/world/nbt.ts';

// Server side of the shared NBT reader (architecture §11.12): the node:zlib decompression it leaves to its caller.

import { gunzipSync, inflateSync } from 'node:zlib';
import type { Inflate } from '../../shared/world/inflate.ts';
import { isGzip, parseNbt, type NbtCompound } from '../../shared/world/nbt.ts';

/**
 * The most bytes one decompression on the server may produce: 64 MiB, far above any real chunk (the group's world
 * peaks under 1 MiB) or level.dat, yet small enough that a crafted upload (a zip bomb inflating to many GB) cannot fill
 * the memory of the scan worker or the HTTP server. Past it node:zlib throws a RangeError (`ERR_BUFFER_TOO_LARGE`),
 * which the readers count as a skipped chunk or an unreadable side file, and which fails a scan at level.dat.
 */
export const MAX_INFLATED_BYTES = 64 * 2 ** 20;

/** The options of every server-side `inflateSync` / `gunzipSync` call. */
export const INFLATE_LIMIT = Object.freeze({ maxOutputLength: MAX_INFLATED_BYTES });

/** NBT that may be gzip'd (level.dat, player and claim files): gunzipped when it is, else parsed as is. */
export function readGzipNbt(buf: Uint8Array): NbtCompound {
  return parseNbt(isGzip(buf) ? gunzipSync(buf, INFLATE_LIMIT) : buf);
}

/** The shared code's `Inflate` on node:zlib; it returns plain Uint8Array views, as the browser's does. */
export const nodeInflate: Inflate = async (data, kind) => {
  const out = kind === 'gzip' ? gunzipSync(data, INFLATE_LIMIT) : inflateSync(data, INFLATE_LIMIT);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
};
