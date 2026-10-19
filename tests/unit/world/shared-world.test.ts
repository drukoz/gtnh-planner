import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { nodeInflate } from '../../../src/server/world/nbt.ts';
import { chunkSummary, INHABITED_KEEP_TICKS } from '../../../src/shared/world/chunk-summary.ts';
import { inflateChunkWith, readNbtWith, type Inflate } from '../../../src/shared/world/inflate.ts';
import { NbtError } from '../../../src/shared/world/nbt.ts';
import { chunkIndex, chunkPayload, REGION_HEADER_BYTES, regionChunkRefs, SECTOR_BYTES, trimRegion } from '../../../src/shared/world/region.ts';
import { byte, bytes, comp, int, list, long, str, writeNbt } from '../../helpers/nbt-write.ts';
import { regionFile } from '../../helpers/region-write.ts';

const chunk = (cx: number, cz: number) => writeNbt(comp({ Level: comp({ xPos: int(cx), zPos: int(cz) }) }));
const A = chunk(0, 0), B = chunk(3, 1), C = chunk(31, 31);

describe('src/shared/world', () => {
  it('keeps src/shared/world free of node modules and Buffer', async () => {
    for (const f of await readdir('src/shared/world'))
      expect(await readFile(join('src/shared/world', f), 'utf8')).not.toMatch(/from ['"]node:|\bBuffer\b|\brequire\(/);
  });

  it('decompresses only through the injected inflate', async () => {
    const raw = writeNbt(comp({ a: int(1) })), calls: string[] = [];
    const spy: Inflate = (d, kind) => { calls.push(kind); return nodeInflate(d, kind); };
    expect([await readNbtWith(gzipSync(raw), spy), await readNbtWith(raw, spy)]).toEqual([{ a: 1 }, { a: 1 }]);
    expect(await inflateChunkWith({ compression: 2, data: deflateSync(raw) }, spy)).toEqual(new Uint8Array(raw));
    expect(await inflateChunkWith({ compression: 3, data: raw }, spy)).toEqual(new Uint8Array(raw));
    expect(calls).toEqual(['gzip', 'zlib']);
    await expect(inflateChunkWith({ compression: 9, data: raw }, spy)).rejects.toThrow(NbtError);
  });

  it('inflates gzip chunks through the injected inflate', async () => {
    const raw = writeNbt(comp({ a: int(1) })), calls: string[] = [];
    const spy: Inflate = (d, kind) => { calls.push(kind); return nodeInflate(d, kind); };
    expect(await inflateChunkWith({ compression: 1, data: gzipSync(raw) }, spy)).toEqual(new Uint8Array(raw));
    expect(calls).toEqual(['gzip']);
  });

  it('trims a region to the kept chunks with byte-identical payloads', () => {
    const reg = regionFile([{ cx: 0, cz: 0, nbt: A, timestamp: 5 }, { cx: 3, cz: 1, nbt: B, timestamp: 6 }, { cx: 31, cz: 31, nbt: C, compression: 1, timestamp: 7 }]);
    const t = trimRegion(reg, [chunkIndex(31, 31), chunkIndex(3, 1), chunkIndex(7, 7)]);   // (7,7) is not in the file
    const refs = regionChunkRefs(t.subarray(0, REGION_HEADER_BYTES)), before = regionChunkRefs(reg.subarray(0, REGION_HEADER_BYTES));
    expect(refs.map((r) => [r.index, r.timestamp])).toEqual([[35, 6], [1023, 7]]);
    for (const r of refs) expect(chunkPayload(t, r)).toEqual(chunkPayload(reg, before.find((b) => b.index === r.index)!));
    expect([t.length % SECTOR_BYTES, trimRegion(reg, []).length]).toEqual([0, 8192]);
  });

  it('writes kept chunks in index order from sector 2, each length = data + 1, zero-padded to whole sectors', () => {
    let seed = 1;
    const noise = Uint8Array.from({ length: 9000 }, () => (seed = (seed * 48271) % 2147483647) & 0xff);   // incompressible: > 1 sector
    const big = writeNbt(comp({ Level: comp({ xPos: int(3), zPos: int(1), noise: bytes(noise) }) }));
    const reg = regionFile([{ cx: 31, cz: 31, nbt: C, timestamp: 9 }, { cx: 0, cz: 0, nbt: A }, { cx: 3, cz: 1, nbt: big, timestamp: 8 }]);
    const t = trimRegion(reg, [chunkIndex(31, 31), chunkIndex(3, 1)]);
    const refs = regionChunkRefs(t.subarray(0, REGION_HEADER_BYTES));
    const sizes = refs.map((r) => chunkPayload(t, r)!.data.length);
    const sectors = sizes.map((n) => Math.ceil((n + 5) / SECTOR_BYTES));
    expect(sectors[0]).toBeGreaterThan(1);
    expect(refs.map((r) => [r.index, r.offset / SECTOR_BYTES, r.sectors])).toEqual([[35, 2, sectors[0]], [1023, 2 + sectors[0]!, sectors[1]]]);
    expect(t.length).toBe((2 + sectors[0]! + sectors[1]!) * SECTOR_BYTES);
    const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
    expect([view.getUint32(2 * SECTOR_BYTES), t[2 * SECTOR_BYTES + 4]]).toEqual([sizes[0]! + 1, 2]);
    expect(t.subarray(2 * SECTOR_BYTES + 5 + sizes[0]!, (2 + sectors[0]!) * SECTOR_BYTES).every((b) => b === 0)).toBe(true);
    const nonZero: number[] = [];
    for (let k = 0; k < REGION_HEADER_BYTES / 4; k++) if (view.getUint32(k * 4) !== 0) nonZero.push(k);
    expect(nonZero).toEqual([35, 1023, 1024 + 35, 1024 + 1023]);   // two locations, two timestamps, everything else 0
  });

  it('trimRegion drops a kept chunk whose payload overflows the file', () => {
    const reg = regionFile([{ cx: 0, cz: 0, nbt: A }, { cx: 1, cz: 0, nbt: B, corrupt: true }]);
    expect(regionChunkRefs(trimRegion(reg, [0, 1]).subarray(0, 8192)).map((r) => r.index)).toEqual([0]);
  });

  it('trimRegion drops a chunk too large for a location entry (over 255 sectors)', () => {
    const length = 255 * SECTOR_BYTES;   // data + 5 bytes needs 256 sectors
    const reg = new Uint8Array(REGION_HEADER_BYTES + 256 * SECTOR_BYTES), view = new DataView(reg.buffer);
    view.setUint32(0, (2 << 8) | 1);     // the header claims 1 sector, the length field claims more; both fit the file
    view.setUint32(REGION_HEADER_BYTES, length);
    reg[REGION_HEADER_BYTES + 4] = 2;
    expect(chunkPayload(reg, regionChunkRefs(reg.subarray(0, REGION_HEADER_BYTES))[0]!)!.data.length).toBe(length - 1);
    expect(trimRegion(reg, [0]).length).toBe(REGION_HEADER_BYTES);
  });

  it('reads xPos, zPos and InhabitedTime without decoding sections', () => {
    const chunk = writeNbt(comp({ Level: comp({ Sections: list('compound', [comp({ Y: byte(0), Blocks: bytes(new Uint8Array(4096)) })]),
      xPos: int(-3), zPos: int(18), InhabitedTime: long(72_000n) }) }));
    expect(chunkSummary(chunk)).toEqual({ cx: -3, cz: 18, inhabitedTime: 72_000 });
    expect(chunkSummary(writeNbt(comp({ Level: comp({ xPos: int(0), zPos: int(0) }) }))).inhabitedTime).toBe(0);
    expect(() => chunkSummary(writeNbt(comp({ Level: comp({ xPos: int(0) }) })))).toThrow(NbtError);
  });

  it('finds Level after other root keys and fails without it', () => {
    const late = writeNbt(comp({ Forestry: comp({ x: str('y') }), CoFHWorld: list('int', [int(1)]),
      Level: comp({ TileEntities: list('compound', [comp({ id: str('GT_TileEntity_Ores') })]), InhabitedTime: long(5n), zPos: int(-1), xPos: int(2) }) }));
    expect(chunkSummary(late)).toEqual({ cx: 2, cz: -1, inhabitedTime: 5 });
    expect(() => chunkSummary(writeNbt(comp({ Other: comp({}) })))).toThrow(NbtError);
    expect(() => chunkSummary(writeNbt(comp({ Level: int(3) })))).toThrow(NbtError);
    expect(() => chunkSummary(writeNbt(int(1)))).toThrow(NbtError);
    expect(() => chunkSummary(late.subarray(0, late.length - 20))).toThrow(NbtError);
    expect(INHABITED_KEEP_TICKS).toBe(72_000);
  });
});
