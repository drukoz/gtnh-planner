// Writes Anvil region files (world-format §1.3) for tests: an 8 KiB header of big-endian locations and timestamps,
// then each chunk from sector 2 on as `u32 BE length (data + 1)`, a compression byte and the compressed NBT,
// padded to whole 4 KiB sectors. Independent of the region reader under test.

import { deflateSync, gzipSync } from 'node:zlib';

const SECTOR = 4096;

export interface RegionChunkSpec {
  cx: number; cz: number;
  /** Uncompressed chunk NBT. */
  nbt: Uint8Array;
  /** Unix seconds of the last save; default 0. */
  timestamp?: number;
  /** 2 zlib (default) or 1 gzip. */
  compression?: 1 | 2;
  /** Writes 64 bytes of 0xff as the payload: its length field overflows the file. */
  corrupt?: boolean;
}

/** A region file holding `chunks` in the given order; chunk coordinates are taken `& 31`. */
export function regionFile(chunks: RegionChunkSpec[]): Buffer {
  const header = Buffer.alloc(2 * SECTOR);
  const body: Buffer[] = [];
  const used = new Set<number>();
  let sector = 2;
  for (const chunk of chunks) {
    const index = (chunk.cx & 31) + (chunk.cz & 31) * 32;
    if (used.has(index)) throw new Error(`regionFile: two chunks at index ${index}`);
    used.add(index);
    let payload: Buffer;
    if (chunk.corrupt) {
      payload = Buffer.alloc(64, 0xff);
    } else {
      const compression = chunk.compression ?? 2;
      const data = compression === 1 ? gzipSync(chunk.nbt) : deflateSync(chunk.nbt);
      payload = Buffer.alloc(5 + data.length);
      payload.writeUInt32BE(data.length + 1, 0);
      payload[4] = compression;
      data.copy(payload, 5);
    }
    const sectors = Math.ceil(payload.length / SECTOR);
    if (sectors > 255) throw new Error(`regionFile: chunk ${index} needs ${sectors} sectors (max 255)`);
    const padded = Buffer.alloc(sectors * SECTOR);
    payload.copy(padded);
    header.writeUInt32BE(sector * 256 + sectors, index * 4);
    header.writeUInt32BE(chunk.timestamp ?? 0, SECTOR + index * 4);
    body.push(padded);
    sector += sectors;
  }
  return Buffer.concat([header, ...body]);
}
