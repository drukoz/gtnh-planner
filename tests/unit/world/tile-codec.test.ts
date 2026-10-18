import { describe, expect, it } from 'vitest';
import {
  AIR_INDEX, decodeMapTile, encodeMapTile, TILE_SIZE, tileOf, UNKNOWN_BLOCK, UNKNOWN_INDEX, type MapTile,
} from '../../../src/shared/types/world.ts';

describe('map tile codec', () => {
  it('round-trips a tile in 20,480 little-endian bytes', () => {
    const t: MapTile = { dim: -1, tx: -1, tz: 2, size: 64, top: new Uint32Array(4096).fill(70000), height: new Uint8Array(4096).fill(200) };
    const bytes = encodeMapTile(t);
    expect([bytes.length, bytes[0], bytes[1], bytes[2], bytes[16384]]).toEqual([20480, 0x70, 0x11, 0x01, 200]);
    expect(decodeMapTile(bytes, -1, -1, 2)).toEqual(t);
    expect([tileOf(-1), tileOf(-64), tileOf(-65), tileOf(63)]).toEqual([-1, -1, -2, 0]);
  });

  it('keeps every column in place, column i = lz·64 + lx', () => {
    const top = Uint32Array.from({ length: 4096 }, (_, i) => i * 1000), height = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
    const bytes = encodeMapTile({ dim: 0, tx: 0, tz: 0, size: 64, top, height });
    const i = 3 * 64 + 5;   // lx 5, lz 3
    expect([new DataView(bytes.buffer).getUint32(4 * i, true), bytes[16384 + i]]).toEqual([i * 1000, i % 256]);
    const back = decodeMapTile(Buffer.from(bytes), 0, 0, 0);
    expect([back.top[i], back.height[i], back.height.constructor, back.top.length, back.height.length]).toEqual([i * 1000, i % 256, Uint8Array, 4096, 4096]);
  });

  it('rejects tiles and byte arrays of the wrong size', () => {
    expect(() => encodeMapTile({ dim: 0, tx: 0, tz: 0, size: 64, top: new Uint32Array(10), height: new Uint8Array(4096) })).toThrow(RangeError);
    expect(() => decodeMapTile(new Uint8Array(20479), 0, 0, 0)).toThrow(RangeError);
  });

  it('fixes the palette entries and tile size every scan shares', () => {
    expect([AIR_INDEX, UNKNOWN_INDEX, UNKNOWN_BLOCK, TILE_SIZE]).toEqual([0, 1, { id: 'gtnh-planner:unknown', meta: 0 }, 64]);
  });
});
