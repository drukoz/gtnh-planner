import { describe, expect, it } from 'vitest';
import { NbtError } from '../../../src/server/world/nbt.ts';
import {
  chunkIndex, chunkPayload, inflateChunk, parseRegionPath, regionChunkRefs, regionOfChunk, regionPathOf,
} from '../../../src/server/world/region.ts';
import { comp, int, writeNbt } from '../../helpers/nbt-write.ts';
import { regionFile } from '../../helpers/region-write.ts';

describe('region coordinates', () => {
  it('maps negative chunk coordinates', () => {
    expect([chunkIndex(-1, -1), chunkIndex(-32, 0), regionOfChunk(-1), regionOfChunk(-33), regionOfChunk(31)]).toEqual([1023, 0, -1, -2, 0]);
  });

  it('parses only real region paths', () => {
    expect(parseRegionPath('region/r.-1.2.mca')).toEqual({ dim: 0, rx: -1, rz: 2 });
    expect(parseRegionPath('DIM-1/region/r.0.0.mca')).toEqual({ dim: -1, rx: 0, rz: 0 });
    expect(parseRegionPath('DIM7/region/r.3.-4.mca')).toEqual({ dim: 7, rx: 3, rz: -4 });
    for (const bad of ['DIM-1/region/r.0.0.mcr', 'Region/r.0.0.mca', 'DIM1/data/r.0.0.mca', '../region/r.0.0.mca', 'DIM1/region/r.a.0.mca'])
      expect(parseRegionPath(bad)).toBeNull();
    expect([regionPathOf(-1, 0, 0), regionPathOf(0, -1, 2)]).toEqual(['DIM-1/region/r.0.0.mca', 'region/r.-1.2.mca']);
  });

  it('accepts one spelling per region file only', () => {
    for (const bad of ['DIM0/region/r.0.0.mca', 'DIM01/region/r.0.0.mca', 'DIM-0/region/r.0.0.mca', 'region/r.-0.0.mca', 'region/r.01.0.mca',
      'region/r.+1.0.mca', '/region/r.0.0.mca', 'World/region/r.0.0.mca', 'region/r.0.0.mca/', 'region\\r.0.0.mca', 'region/r.4294967296.0.mca'])
      expect(parseRegionPath(bad)).toBeNull();
    for (const p of ['region/r.0.0.mca', 'DIM-1/region/r.-12.345.mca', 'DIM2147483647/region/r.-2147483648.0.mca'])
      expect(regionPathOf(parseRegionPath(p)!.dim, parseRegionPath(p)!.rx, parseRegionPath(p)!.rz)).toBe(p);
  });
});

describe('region chunks', () => {
  it('lists present chunks with timestamps and inflates them', () => {
    const a = writeNbt(comp({ Level: comp({ xPos: int(0) }) })), b = writeNbt(comp({ Level: comp({ xPos: int(31) }) }));
    const reg = regionFile([{ cx: 0, cz: 0, nbt: a, timestamp: 1_700_000_000 }, { cx: 31, cz: 1, nbt: b, compression: 1 }]);
    const refs = regionChunkRefs(reg.subarray(0, 8192));
    expect(refs.map((r) => [r.index, r.localX, r.localZ])).toEqual([[0, 0, 0], [63, 31, 1]]);
    expect(refs[0]!.timestamp).toBe(1_700_000_000);
    expect(refs.map((r) => [r.offset, r.sectors])).toEqual([[8192, 1], [12288, 1]]);
    expect(inflateChunk(chunkPayload(reg, refs[1]!)!)).toEqual(Buffer.from(b));
    expect(inflateChunk(chunkPayload(reg, refs[0]!)!)).toEqual(Buffer.from(a));
  });

  it('returns null for a payload that overflows the file', () => {
    const header = new Uint8Array(8192);
    new DataView(header.buffer).setUint32(0, (2 << 8) | 1);   // chunk 0 at sector 2, 1 sector; the file ends at the header
    const refs = regionChunkRefs(header);
    expect(refs.map((r) => [r.index, r.offset, r.sectors])).toEqual([[0, 8192, 1]]);
    expect(chunkPayload(header, refs[0]!)).toBeNull();
    const corrupt = regionFile([{ cx: 0, cz: 0, nbt: writeNbt(comp({})), corrupt: true }]);   // length field 0xffffffff
    expect(chunkPayload(corrupt, regionChunkRefs(corrupt.subarray(0, 8192))[0]!)).toBeNull();
  });

  it('returns null for a chunk inside the header or with an empty length', () => {
    const reg = new Uint8Array(3 * 4096), view = new DataView(reg.buffer);
    view.setUint32(0, (1 << 8) | 1);   // chunk 0 points into the timestamp table…
    view.setUint32(4096, 3);           // …where its own timestamp reads as a plausible length 3
    view.setUint32(4, (2 << 8) | 1);   // chunk 1 at sector 2 with length 0
    expect(regionChunkRefs(reg.subarray(0, 8192)).map((r) => chunkPayload(reg, r))).toEqual([null, null]);
  });

  it('returns the payload as a plain byte view of the region', () => {
    const reg = regionFile([{ cx: 0, cz: 0, nbt: writeNbt(comp({ a: int(1) })) }]);
    const p = chunkPayload(reg, regionChunkRefs(reg.subarray(0, 8192))[0]!)!;
    expect([p.compression, p.data.constructor, p.data.buffer === reg.buffer, p.data.length]).toEqual([2, Uint8Array, true, reg.readUInt32BE(8192) - 1]);
  });

  it('inflates uncompressed chunks and rejects unknown compression', () => {
    const raw = writeNbt(comp({ a: int(1) }));
    expect(inflateChunk({ compression: 3, data: raw })).toEqual(raw);
    expect(() => inflateChunk({ compression: 9, data: raw })).toThrow(NbtError);
  });
});
