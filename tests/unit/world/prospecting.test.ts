import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeTeamBlob, joinDiscoveries, readVpDimension, teamBlobOf, vpWorldId, type TeamDiscoveries, type VpVein,
} from '../../../src/server/world/prospecting.ts';
import { makeWorld } from '../../helpers/make-world.ts';
import { bytes, comp, int, ints, list, str, writeNbt } from '../../helpers/nbt-write.ts';

const WORLD_ID = 'World_0f0e0d0c-0b0a-4908-8706-050403020100';

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-prospecting-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

describe('VisualProspecting files', () => {
  it('finds the world id, decodes the server cache and joins team discoveries', async () => {
    const { serverDir, worldDir } = await makeWorld(tmp, { dims: {},
      vp: { worldId: WORLD_ID, dims: { 0: [{ chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper' }] } },
      teams: { Alpha: [{ dim: 0, veins: [[-3, 5], [10, 10]] }] } });
    expect(vpWorldId(await readFile(join(worldDir, 'data/visualprospecting.dat')))).toBe(WORLD_ID);
    const cache = readVpDimension(await readFile(join(serverDir, 'visualprospecting/server', WORLD_ID, 'DIM0.dat')));
    expect(cache).toEqual([{ dim: 0, chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper', depleted: false }]);
    const team = decodeTeamBlob(teamBlobOf(JSON.parse(await readFile(join(worldDir, 'gtnhteams/Alpha.json'), 'utf8')))!);
    expect(team).toEqual([{ dim: 0, veins: [[-3, 5], [10, 10]], depleted: [] }]);
    expect(joinDiscoveries(cache, [team, team])).toEqual({ prospected: [{ dim: 0, x: -40, z: 88, vein: 'ore.mix.copper' }], unmatched: 1 });
  });

  it('decodes several dimensions, the palette, depleted veins and extreme chunk coordinates', async () => {
    const { serverDir, worldDir } = await makeWorld(tmp, { dims: {},
      vp: { worldId: WORLD_ID, dims: { [-1]: [{ chunkX: 0, chunkZ: -1, vein: 'ore.mix.netherquartz' }, { chunkX: 4, chunkZ: 4, vein: 'ore.mix.sulfur', depleted: true },
        { chunkX: -8, chunkZ: 2, vein: 'ore.mix.netherquartz' }] } },
      teams: { Beta: [{ dim: -1, veins: [[0, -1], [-1_875_000, 1_875_000]], depleted: [[4, 4]] }, { dim: 7, veins: [] }] } });
    expect(readVpDimension(await readFile(join(serverDir, 'visualprospecting/server', WORLD_ID, 'DIM-1.dat')))).toEqual([
      { dim: -1, chunkX: 0, chunkZ: -1, vein: 'ore.mix.netherquartz', depleted: false },
      { dim: -1, chunkX: 4, chunkZ: 4, vein: 'ore.mix.sulfur', depleted: true },
      { dim: -1, chunkX: -8, chunkZ: 2, vein: 'ore.mix.netherquartz', depleted: false }]);
    const blob = teamBlobOf(JSON.parse(await readFile(join(worldDir, 'gtnhteams/Beta.json'), 'utf8')))!;
    expect(decodeTeamBlob(blob)).toEqual([
      { dim: -1, veins: [[-1_875_000, 1_875_000], [0, -1]], depleted: [[4, 4]] }, { dim: 7, veins: [], depleted: [] }]);
  });
});

describe('vpWorldId', () => {
  const dat = (data: Parameters<typeof comp>[0]) => gzipSync(writeNbt(comp({ data: comp(data) })));

  it('takes the first String under data that ends in _<uuid>', () => {
    expect(vpWorldId(dat({ version: int(1), other: str('World'), id: str(WORLD_ID), later: str('World_ffffffff-ffff-4fff-8fff-ffffffffffff') }))).toBe(WORLD_ID);
  });

  it('is null without one', () => {
    expect(vpWorldId(dat({ id: str('World_not-a-uuid') }))).toBeNull();
    expect(vpWorldId(gzipSync(writeNbt(comp({ other: comp({ id: str(WORLD_ID) }) }))))).toBeNull();
  });
});

describe('readVpDimension', () => {
  const cache = (ores: Parameters<typeof comp>[0] | null, version = 3) =>
    gzipSync(writeNbt(comp({ dim: int(28), version: int(version), ...(ores === null ? {} : { ores: comp(ores) }), fluids: comp({}) })));

  it('reads List<Int> coordinates as well as IntArrays, and skips veins without a vein type', () => {
    const buf = cache({ palette: list('string', [str('ore.mix.moon.a'), str('ore.mix.moon.b')]),
      chunkX: list('int', [int(1), int(2), int(3)]), chunkZ: list('int', [int(-1), int(-2), int(-3)]), veinTypeIndex: ints([1, 5, 0]),
      depleted: bytes([0, 0, 1]), source: bytes([1, 1, 2]) });
    expect(readVpDimension(buf)).toEqual([
      { dim: 28, chunkX: 1, chunkZ: -1, vein: 'ore.mix.moon.b', depleted: false },
      { dim: 28, chunkX: 3, chunkZ: -3, vein: 'ore.mix.moon.a', depleted: true }]);
  });

  it('gives no veins for a cache without ores, and rejects other versions and mismatched arrays', () => {
    expect(readVpDimension(cache(null))).toEqual([]);
    const ores = { palette: list('string', [str('ore.mix.a')]), chunkX: ints([1]), chunkZ: ints([1]), veinTypeIndex: ints([0]), depleted: bytes([0]) };
    expect(() => readVpDimension(cache(ores, 2))).toThrow(/version 2/);
    expect(() => readVpDimension(cache({ ...ores, chunkZ: ints([1, 2]) }))).toThrow(/lengths/);
  });
});

describe('team discoveries', () => {
  it('finds the blob only at TeamData.visualprospecting.blob', () => {
    expect(teamBlobOf({ TeamData: { visualprospecting: { version: 1, blob: 'abc' } } })).toBe('abc');
    expect([teamBlobOf(null), teamBlobOf('x'), teamBlobOf({ TeamData: {} }), teamBlobOf({ TeamData: { visualprospecting: { blob: 5 } } })])
      .toEqual([null, null, null, null]);
  });

  it('rejects a truncated blob', () => {
    const stream = Buffer.alloc(12);
    stream.writeInt32BE(1, 0);
    stream.writeInt32BE(0, 4);
    stream.writeInt32BE(2, 8);   // two veins announced, none written
    expect(() => decodeTeamBlob(gzipSync(stream).toString('base64'))).toThrow(/truncated/);
  });

  it('joins de-duplicated discoveries across teams, sorted by dimension, x and z', () => {
    const vein = (dim: number, chunkX: number, chunkZ: number, name: string): VpVein => ({ dim, chunkX, chunkZ, vein: name, depleted: false });
    const cache = [vein(0, 2, 2, 'b'), vein(0, -1, 9, 'a'), vein(0, -1, 3, 'c'), vein(-1, 5, 5, 'n'), vein(7, 0, 0, 't')];
    const alpha: TeamDiscoveries[] = [{ dim: 0, veins: [[2, 2], [-1, 9]], depleted: [] }, { dim: -1, veins: [[5, 5], [6, 6]], depleted: [] }];
    const beta: TeamDiscoveries[] = [{ dim: 0, veins: [[-1, 3], [2, 2], [8, 8]], depleted: [] }, { dim: 7, veins: [], depleted: [] }];
    expect(joinDiscoveries(cache, [alpha, beta])).toEqual({ prospected: [
      { dim: -1, x: 88, z: 88, vein: 'n' }, { dim: 0, x: -8, z: 56, vein: 'c' }, { dim: 0, x: -8, z: 152, vein: 'a' }, { dim: 0, x: 40, z: 40, vein: 'b' }],
    unmatched: 2 });
    expect(joinDiscoveries(cache, [])).toEqual({ prospected: [], unmatched: 0 });
  });
});
