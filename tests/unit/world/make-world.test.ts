import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDirWorld } from '../../../src/server/world/files.ts';
import { readLevelDat } from '../../../src/server/world/level-dat.ts';
import { comp, list, parseNbt, readGzipNbt, type NbtCompound } from '../../../src/server/world/nbt.ts';
import { chunkIndex, chunkPayload, inflateChunk, regionChunkRefs, regionPathOf } from '../../../src/server/world/region.ts';
import { decodeSection, sectionIndex } from '../../../src/server/world/sections.ts';
import { serverLayout } from '../../../src/server/world/sources.ts';
import { openZipWorld } from '../../../src/server/world/zip.ts';
import { chunkNbt, DEFAULT_BLOCK_IDS, makeBackup, makeWorld, type WorldSpec } from '../../helpers/make-world.ts';
import { chest, gtMachine } from '../../helpers/world-tes.ts';

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-make-world-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

/** The block at (x, y, z) as Task 1's readers see it in the files makeWorld wrote. */
async function blockAtFile(worldDir: string, dim: number, x: number, y: number, z: number): Promise<{ name: string | undefined; meta: number | undefined }> {
  const names = readLevelDat(await readFile(join(worldDir, 'level.dat'))).blockNames;
  const [cx, cz] = [x >> 4, z >> 4];
  const region = await readFile(join(worldDir, regionPathOf(dim, cx >> 5, cz >> 5)));
  const ref = regionChunkRefs(region.subarray(0, 8192)).find((r) => r.index === chunkIndex(cx, cz))!;
  const level = comp(parseNbt(inflateChunk(chunkPayload(region, ref)!)).Level)!;
  const section = list(level.Sections).map(comp).find((s) => s?.Y === y >> 4);
  if (!section) return { name: 'minecraft:air', meta: 0 };
  const { ids, meta } = decodeSection(section);
  const i = sectionIndex(x, y, z);
  return { name: names.get(ids[i]!), meta: meta[i] };
}

const keysOf = (c: NbtCompound | null | undefined) => Object.keys(c ?? {}).sort();

describe('chunks', () => {
  it('writes both chunk formats that decode to the same blocks', async () => {
    const { worldDir } = await makeWorld(tmp, { dims: {
      0: [{ cx: 0, cz: 0, format: 'eid', inhabitedTime: 100, fill: [{ from: [0, 60, 0], to: [15, 60, 15], block: 'minecraft:stone' },
                                                                   { from: [1, 61, 2], to: [1, 61, 2], block: 'cropsnh:cropSticks', meta: 305 }] }],
      [-1]: [{ cx: -1, cz: -1, format: 'legacy', fill: [{ from: [-16, 10, -16], to: [-1, 10, -1], block: 'cropsnh:cropSticks', meta: 305 }] }] } });
    expect(await blockAtFile(worldDir, 0, 1, 61, 2)).toEqual({ name: 'cropsnh:cropSticks', meta: 305 });   // Add + BlocksB2Hi + Data1High + Data2
    expect(await blockAtFile(worldDir, 0, 15, 60, 15)).toEqual({ name: 'minecraft:stone', meta: 0 });
    expect(await blockAtFile(worldDir, -1, -1, 10, -1)).toEqual({ name: 'cropsnh:cropSticks', meta: 305 });   // Blocks16/Data16
    expect(await blockAtFile(worldDir, 0, 0, 61, 0)).toEqual({ name: 'minecraft:air', meta: 0 });
  });

  it('writes the optional EndlessIDs arrays only when an id or meta needs them', () => {
    const level = comp(parseNbt(chunkNbt({ cx: 2, cz: -3, fill: [
      { from: [32, 0, -48], to: [47, 0, -33], block: 'minecraft:stone' },                 // section 0: ids ≤ 255, meta ≤ 15
      { from: [32, 16, -48], to: [32, 16, -48], block: 'gregtech:gt.blockmachines' },     // section 1: id 4000 > 255
      { from: [33, 32, -47], to: [33, 32, -47], block: 'cropsnh:cropSticks', meta: 20 },  // section 2: id 11025 > 4095, meta 20 > 15
      { from: [34, 48, -46], to: [34, 48, -46], block: 'minecraft:dirt', meta: 300 },     // section 3: meta 300 > 255
    ] }, DEFAULT_BLOCK_IDS)).Level)!;
    const sections = list(level.Sections).map(comp);
    expect(sections.map((s) => s?.Y)).toEqual([0, 1, 2, 3]);
    expect(sections.map(keysOf)).toEqual([
      ['BlockLight', 'Blocks', 'Data', 'SkyLight', 'Y'],
      ['Add', 'BlockLight', 'Blocks', 'Data', 'SkyLight', 'Y'],
      ['Add', 'BlockLight', 'Blocks', 'BlocksB2Hi', 'Data', 'Data1High', 'SkyLight', 'Y'],
      ['BlockLight', 'Blocks', 'Data', 'Data1High', 'Data2', 'SkyLight', 'Y']]);
    const at = (k: number, x: number, y: number, z: number) => {
      const d = decodeSection(sections[k]!), i = sectionIndex(x, y, z);
      return [d.ids[i], d.meta[i]];
    };
    expect([at(0, 47, 0, -33), at(1, 32, 16, -48), at(2, 33, 32, -47), at(3, 34, 48, -46), at(3, 35, 48, -46)])
      .toEqual([[1, 0], [4000, 0], [11025, 20], [3, 300], [0, 0]]);
    expect([level.xPos, level.zPos, level.InhabitedTime, level.POSTEA, (level.Biomes16v2 as Uint8Array).length, 'Biomes' in level])
      .toEqual([2, -3, 0, 1234, 512, false]);
  });

  it('writes legacy chunks with Blocks16/Data16, vanilla biomes and POSTEA 0', () => {
    const level = comp(parseNbt(chunkNbt({ cx: 0, cz: 0, format: 'legacy', inhabitedTime: 72_000,
      fill: [{ from: [0, 5, 0], to: [0, 5, 0], block: 'minecraft:stone' }] }, DEFAULT_BLOCK_IDS)).Level)!;
    expect(list(level.Sections).map((s) => keysOf(comp(s)))).toEqual([['BlockLight', 'Blocks16', 'Data16', 'SkyLight', 'Y']]);
    expect([level.InhabitedTime, level.POSTEA, (level.Biomes as Uint8Array).length, 'Biomes16v2' in level]).toEqual([72_000, 0, 256, false]);
  });

  it('writes tile entities in order and ore filler TEs inside the chunk', () => {
    const level = comp(parseNbt(chunkNbt({ cx: -1, cz: 2, format: 'legacy', oreTes: 300,
      tileEntities: [gtMachine({ pos: [-5, 64, 40], mID: 1121 }), chest([-6, 64, 40], [])] }, DEFAULT_BLOCK_IDS)).Level)!;
    const tes = list(level.TileEntities).map(comp);
    const ores = tes.filter((t) => t?.id === 'GT_TileEntity_Ores');
    expect(tes.filter((t) => t?.id !== 'GT_TileEntity_Ores').map((t) => [t?.id, t?.x, t?.y, t?.z]))
      .toEqual([['BaseMetaTileEntity', -5, 64, 40], ['Chest', -6, 64, 40]]);
    expect(ores).toHaveLength(300);
    expect(keysOf(ores[0])).toEqual(['id', 'm', 'n', 'x', 'y', 'z']);
    expect(ores.every((t) => Number(t?.x) >> 4 === -1 && Number(t?.z) >> 4 === 2)).toBe(true);
    expect(new Set(ores.map((t) => `${t?.x}:${t?.y}:${t?.z}`)).size).toBe(300);
  });

  it('refuses unknown blocks and tile entities outside their chunk', () => {
    expect(() => chunkNbt({ cx: 0, cz: 0, fill: [{ from: [0, 0, 0], to: [0, 0, 0], block: 'nope:block' }] }, DEFAULT_BLOCK_IDS)).toThrow('nope:block');
    expect(() => chunkNbt({ cx: 0, cz: 0, tileEntities: [chest([16, 64, 0], [])] }, DEFAULT_BLOCK_IDS)).toThrow(/outside chunk/);
  });
});

describe('world folder and side files', () => {
  const spec: WorldSpec = {
    levelName: 'Saves', spawn: [8, 64, -8], blocks: { 'test:extra_block': 4999 }, items: { 'test:extra_item': 6000 },
    dims: { 0: [{ cx: 0, cz: 0, inhabitedTime: 5 }], 7: [{ cx: 40, cz: -1 }] },
    players: [{ file: 'p1', dim: -1, pos: [4.5, 65, -5.5], spawnDims: [7], portals: [[0, -1]] }],
    claims: { Alpha: { 0: [[0, 0], [-1, 2]], [-1]: [[3, 3]] } },
    teams: { Alpha: [{ dim: 0, veins: [[10, 10], [-3, 5]], depleted: [[10, 10]] }] },
    quests: { q1: [1072, 479] },
    vp: { worldId: 'Saves_00000000-0000-4000-8000-000000000000', dims: { 0: [{ chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper' },
      { chunkX: 10, chunkZ: 10, vein: 'ore.mix.iron', depleted: true }, { chunkX: 1, chunkZ: 2, vein: 'ore.mix.copper' }] } },
    drawersCfg: 'blocks {\n  controller {\n    I:range=6\n  }\n}\n',
  };
  let serverDir: string, worldDir: string;
  beforeEach(async () => ({ serverDir, worldDir } = await makeWorld(join(tmp, 'srv'), spec)));

  it('lays out the server folder the way the sources find it', async () => {
    expect([serverDir, worldDir]).toEqual([join(tmp, 'srv'), join(tmp, 'srv', 'Saves')]);
    expect(serverLayout(serverDir).worldDir).toBe(worldDir);
    expect((await (await openDirWorld(worldDir)).list()).map((e) => e.path)).toEqual([
      'DIM7/region/r.1.-1.mca', 'betterquesting/QuestProgress/q1.json', 'data/visualprospecting.dat', 'gtnhteams/Alpha.json', 'level.dat',
      'playerdata/p1.dat', 'region/r.0.0.mca', 'serverutilities/teams/claimedchunks/Alpha.dat']);
  });

  it('writes level.dat with separate block and item maps and known chunk managers', async () => {
    const info = readLevelDat(await readFile(join(worldDir, 'level.dat')));
    expect([info.levelName, info.spawn, info.warnings]).toEqual(['Saves', [8, 64, -8], []]);
    expect([info.blockNames.get(4000), info.blockNames.get(4999), info.blockNames.get(11025), info.blockNames.has(265)])
      .toEqual(['gregtech:gt.blockmachines', 'test:extra_block', 'cropsnh:cropSticks', false]);
    expect([info.itemNames.get(265), info.itemNames.get(40000), info.itemNames.get(6000), info.itemNames.has(4000)])
      .toEqual(['minecraft:iron_ingot', 'test:big_item', 'test:extra_item', false]);
  });

  it('writes player, claim and quest files', async () => {
    const player = readGzipNbt(await readFile(join(worldDir, 'playerdata/p1.dat')));
    expect(player).toMatchObject({ Dimension: -1, Pos: [4.5, 65, -5.5], Spawns: [{ Dim: 7, SpawnX: 4, SpawnY: 65, SpawnZ: -6 }],
      ForgeData: { PlayerPersisted: { ReturnPortals: [{ FromDim: 0, ToDim: -1 }] } } });
    const claims = readGzipNbt(await readFile(join(worldDir, 'serverutilities/teams/claimedchunks/Alpha.dat')));
    expect(claims).toEqual({ ClaimedChunks: { '0': [{ x: 0, z: 0, preDecay: 0 }, { x: -1, z: 2, preDecay: 0 }], '-1': [{ x: 3, z: 3, preDecay: 0 }] } });
    const quests = JSON.parse(await readFile(join(worldDir, 'betterquesting/QuestProgress/q1.json'), 'utf8'));
    expect(Object.values(quests['questProgress:9']).map((q: any) => [q['questIDHigh:4'], q['questIDLow:4'], Object.keys(q['completed:9'])]))
      .toEqual([[0, 1072, ['0:10']], [0, 479, ['0:10']]]);
  });

  it('writes the team prospecting blob as gzip of big-endian dims and sorted long sets', async () => {
    const json = JSON.parse(await readFile(join(worldDir, 'gtnhteams/Alpha.json'), 'utf8'));
    expect(json.TeamData.visualprospecting.version).toBe(1);
    const raw = gunzipSync(Buffer.from(json.TeamData.visualprospecting.blob, 'base64'));
    let at = 0;
    const int = () => { const v = raw.readInt32BE(at); at += 4; return v; };
    const longSet = () => Array.from({ length: int() }, () => { const v = raw.readBigInt64BE(at); at += 8; return [Number(v >> 32n), Number(BigInt.asIntN(32, v))]; });
    expect([int(), int(), longSet(), longSet(), longSet(), at]).toEqual([1, 0, [[-3, 5], [10, 10]], [], [[10, 10]], raw.length]);
  });

  it('writes the VisualProspecting world id, the server cache and the drawers config', async () => {
    const id = readGzipNbt(await readFile(join(worldDir, 'data/visualprospecting.dat')));
    expect(id).toEqual({ data: { worldId: spec.vp!.worldId } });
    const cache = readGzipNbt(await readFile(join(serverDir, 'visualprospecting/server', spec.vp!.worldId, 'DIM0.dat')));
    expect(cache).toMatchObject({ dim: 0, version: 3, fluids: {}, ores: { palette: ['ore.mix.copper', 'ore.mix.iron'],
      chunkX: Int32Array.from([-3, 10, 1]), chunkZ: Int32Array.from([5, 10, 2]), veinTypeIndex: Int32Array.from([0, 1, 0]) } });
    expect([...(comp(cache.ores)!.depleted as Uint8Array)]).toEqual([0, 1, 0]);
    expect(await readFile(join(serverDir, 'config/StorageDrawers.cfg'), 'utf8')).toBe(spec.drawersCfg);
  });

  it('makes backups under World/ whatever the level name, optionally old or truncated', async () => {
    const path = await makeBackup(serverDir, '2026-10-17-11-00-00.zip', { mtime: new Date('2026-10-17T11:00:00Z') });
    expect(path).toBe(join(serverDir, 'backups', '2026-10-17-11-00-00.zip'));
    expect((await stat(path)).mtime.toISOString()).toBe('2026-10-17T11:00:00.000Z');
    const bytes = await readFile(path);
    expect([bytes.includes('World/level.dat'), bytes.includes('Saves/'), bytes.includes('serverutilities/backup.txt')]).toEqual([true, false, true]);
    const zip = await openZipWorld(path), dir = await openDirWorld(worldDir);
    expect(await zip.list()).toEqual(await dir.list());
    expect(await zip.read('region/r.0.0.mca')).toEqual(await readFile(join(worldDir, 'region/r.0.0.mca')));
    await zip.close();
    await expect(openZipWorld(await makeBackup(serverDir, 'torn.zip', { truncateBytes: 30 }))).rejects.toThrow();
  });
});
