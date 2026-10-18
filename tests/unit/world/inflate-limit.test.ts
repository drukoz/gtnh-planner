import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBlockReader } from '../../../src/server/world/area.ts';
import { readLevelDat } from '../../../src/server/world/level-dat.ts';
import { MAX_INFLATED_BYTES, nodeInflate, readGzipNbt } from '../../../src/server/world/nbt.ts';
import { decodeTeamBlob } from '../../../src/server/world/prospecting.ts';
import { chunkPayload, inflateChunk, REGION_HEADER_BYTES, regionChunkRefs, type RegionChunkRef } from '../../../src/server/world/region.ts';
import { runScanJob, type ScanJob } from '../../../src/server/world/scan.worker.ts';
import { scanChunk, scanRegionBuffer } from '../../../src/server/world/tile-entities.ts';
import { chunkNbt, DEFAULT_BLOCK_IDS, makeWorld } from '../../helpers/make-world.ts';
import { comp, str, writeNbt } from '../../helpers/nbt-write.ts';
import { regionFile } from '../../helpers/region-write.ts';
import { testFacts } from '../../helpers/world-facts.ts';

// Zip bombs a friend's upload could hold (Review Focus 4): well-formed NBT one byte array past MAX_INFLATED_BYTES,
// compressed to a few hundred KB. Without the cap every one of them would inflate and parse; with it, node:zlib stops
// at 64 MiB and the readers treat the chunk as skipped (or level.dat as unreadable).
// REGION: chunk (0,0) a normal chunk, (1,0) the bomb zlib-compressed, (2,0) the same bomb gzip-compressed.

/** `nbt` (a root compound) with a zero-filled byte array of `size` bytes added as its last entry: still well formed. */
function padded(nbt: Uint8Array, size: number): Buffer {
  const name = Buffer.from('Padding', 'utf8');
  const head = Buffer.alloc(1 + 2 + name.length + 4);
  head[0] = 7;   // TAG_Byte_Array
  head.writeUInt16BE(name.length, 1);
  name.copy(head, 3);
  head.writeInt32BE(size, 3 + name.length);
  return Buffer.concat([nbt.subarray(0, nbt.length - 1), head, Buffer.alloc(size), Buffer.from([0])]);
}

let tmp: string, bomb: Buffer, region: Buffer, refs: RegionChunkRef[], bigLevelDat: Buffer;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-inflate-limit-'));
  bomb = padded(chunkNbt({ cx: 1, cz: 0 }, DEFAULT_BLOCK_IDS), MAX_INFLATED_BYTES);
  region = regionFile([
    { cx: 0, cz: 0, nbt: chunkNbt({ cx: 0, cz: 0, inhabitedTime: 5 }, DEFAULT_BLOCK_IDS) },
    { cx: 1, cz: 0, nbt: bomb }, { cx: 2, cz: 0, nbt: bomb, compression: 1 },
  ]);
  refs = regionChunkRefs(region.subarray(0, REGION_HEADER_BYTES));
  bigLevelDat = gzipSync(padded(writeNbt(comp({ Data: comp({ LevelName: str('Bomb') }) })), MAX_INFLATED_BYTES));
}, 60_000);

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('the 64 MiB inflate limit', () => {
  it('is 64 MiB, and the bomb is a chunk that would read fine without it', () => {
    expect(MAX_INFLATED_BYTES).toBe(64 * 2 ** 20);
    expect(bomb.length).toBeGreaterThan(MAX_INFLATED_BYTES);
    expect(region.length).toBeLessThan(2 * 2 ** 20);   // a few hundred KB on the wire
    expect(scanChunk(bomb, 0, 0).stat).toMatchObject({ cx: 1, cz: 0 });
  });

  it('stops a chunk inflating past the limit, zlib and gzip alike', () => {
    expect(inflateChunk(chunkPayload(region, refs[0]!)!).length).toBeLessThan(MAX_INFLATED_BYTES);
    for (const ref of refs.slice(1)) {
      expect(() => inflateChunk(chunkPayload(region, ref)!)).toThrow(expect.objectContaining({ name: 'RangeError', code: 'ERR_BUFFER_TOO_LARGE' }));
    }
  });

  it('skips such a chunk in the scan pass and keeps the rest of the region', () => {
    const { chunks, skipped } = scanRegionBuffer(region, 0);
    expect([chunks.map((c) => [c.stat.cx, c.stat.inhabitedTime]), skipped]).toEqual([[[0, 5]], 2]);
  });

  it('reads such a chunk as missing in the block reader of the map and readArea', async () => {
    const reader = createBlockReader({ readRegion: async () => region });
    expect(await reader.chunk(0, 0, 0)).not.toBeNull();
    expect([await reader.chunk(0, 1, 0), await reader.chunk(0, 2, 0), await reader.blockAt(0, 20, 64, 3)]).toEqual([null, null, null]);
  });

  it('refuses a level.dat, a side file or a team blob that inflates past the limit', async () => {
    expect(() => readLevelDat(bigLevelDat)).toThrow(RangeError);
    expect(() => readGzipNbt(bigLevelDat)).toThrow(RangeError);
    expect(() => decodeTeamBlob(bigLevelDat.toString('base64'))).toThrow(RangeError);
    await expect(nodeInflate(bigLevelDat, 'gzip')).rejects.toThrow(RangeError);
    await expect(nodeInflate(chunkPayload(region, refs[1]!)!.data, 'zlib')).rejects.toThrow(RangeError);
  });

  describe('in a scan of an upload', () => {
    /** A scan job over the world folder `worldDir`, as an upload's files folder. */
    const jobOf = (worldDir: string, n: number): ScanJob => ({
      scanId: `20261018T120000Z-00000${n}`, scanDir: join(tmp, 'scans', String(n)), request: { kind: 'upload', uploadId: 'b'.repeat(32) },
      source: { kind: 'dir', path: worldDir, label: 'upload' }, serverDir: null, facts: testFacts(),
    });

    it('counts the bomb chunks as skipped and finishes', async () => {
      const { worldDir } = await makeWorld(join(tmp, 'bomb-region'), { dims: { 0: [{ cx: 0, cz: 0 }] } });
      await writeFile(join(worldDir, 'region', 'r.0.0.mca'), region);
      const scan = await runScanJob(jobOf(worldDir, 1), () => {});
      expect([scan.skippedChunks, scan.dims.find((d) => d.dim === 0)?.chunks]).toEqual([2, 1]);
    });

    it('fails at a level.dat that inflates past the limit', async () => {
      const { worldDir } = await makeWorld(join(tmp, 'bomb-level'), { dims: { 0: [{ cx: 0, cz: 0 }] } });
      await writeFile(join(worldDir, 'level.dat'), bigLevelDat);
      await expect(runScanJob(jobOf(worldDir, 2), () => {})).rejects.toThrow(/^level\.dat could not be read: Cannot create a Buffer larger than/);
    });
  });
});
