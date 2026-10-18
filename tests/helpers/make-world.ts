// Synthetic GTNH 2.9 worlds for tests (architecture §10: tests never use real game files): a server folder with
// server.properties, the world's level.dat and region files in both chunk formats (world-format §3), the side files
// a scan reads (materials-availability §6–§7, world-format §7) and ServerUtilities-style backup zips (world-format
// §1.1). Written independently of the readers under test: the formats are spelled out here, not imported.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Vec3 } from '../../src/server/world/model.ts';
import { byte, bytes, comp, double, float, int, ints, list, long, str, writeNbt, type Tag } from './nbt-write.ts';
import { regionFile, type RegionChunkSpec } from './region-write.ts';
import { compounds, oreTe } from './world-tes.ts';
import { writeZip, type ZipEntrySpec } from './zip-write.ts';

/** Fills the inclusive box `from`..`to` (world coordinates, either corner first); the part outside the chunk is ignored. */
export interface FillBox { from: Vec3; to: Vec3; block: string; meta?: number }

export interface ChunkSpec {
  cx: number; cz: number;
  /** 'eid' (default): an EndlessIDs chunk saved by 2.9; 'legacy': a pre-upgrade NotEnoughIDs chunk (world-format §3.2). */
  format?: 'eid' | 'legacy';
  inhabitedTime?: number;
  /** The region header's save time, Unix seconds (default 0). */
  timestamp?: number;
  /** Applied in order; blocks not filled are air. Nothing else places blocks, tile entities' owner blocks included. */
  fill?: FillBox[];
  /** TE compounds (world-tes.ts); each must stand inside this chunk. */
  tileEntities?: Tag[];
  /** How many `GT_TileEntity_Ores` filler TEs to write, before `tileEntities`, at distinct positions from y 1 up. */
  oreTes?: number;
  /** Writes a payload whose length overflows the region file (region-write.ts). */
  corrupt?: boolean;
}

export interface WorldSpec {
  /** server.properties `level-name` and the world folder name (default 'World'). */
  levelName?: string;
  spawn?: Vec3;
  /** Block and item ids merged over DEFAULT_BLOCK_IDS / DEFAULT_ITEM_IDS; the two maps stay separate (world-format §4). */
  blocks?: Record<string, number>;
  items?: Record<string, number>;
  dims: Record<number, ChunkSpec[]>;
  /** `playerdata/<file>.dat`; bed spawns (`spawnDims`) sit at the player's block position. */
  players?: Array<{ file: string; dim: number; pos: Vec3; spawnDims?: number[]; portals?: Array<[from: number, to: number]> }>;
  /** team → dim → claimed chunk coordinates `[cx, cz]`. */
  claims?: Record<string, Record<number, Array<[number, number]>>>;
  /** team → VisualProspecting discoveries per dimension, as vein chunk coordinates `[chunkX, chunkZ]`. */
  teams?: Record<string, Array<{ dim: number; veins: Array<[number, number]>; depleted?: Array<[number, number]> }>>;
  /** `betterquesting/QuestProgress/<file>.json` → completed quest ids (questIDHigh 0). */
  quests?: Record<string, number[]>;
  /** `data/visualprospecting.dat` with `worldId`, and the server cache `visualprospecting/server/<worldId>/DIM<n>.dat`. */
  vp?: { worldId: string; dims: Record<number, Array<{ chunkX: number; chunkZ: number; vein: string; depleted?: boolean }>> };
  /** The text of `config/StorageDrawers.cfg` in the server folder. */
  drawersCfg?: string;
}

export const DEFAULT_BLOCK_IDS: Readonly<Record<string, number>> = Object.freeze({
  'minecraft:air': 0, 'minecraft:stone': 1, 'minecraft:grass': 2, 'minecraft:dirt': 3, 'minecraft:water': 9, 'minecraft:chest': 54,
  'gregtech:gt.blockmachines': 4000, 'gregtech:gt.blockcasings5': 4001, 'gregtech:gt.blockores': 4002,
  'StorageDrawers:fullDrawers4': 4100, 'StorageDrawers:controller': 4101, 'StorageDrawers:trim': 4102, 'StorageDrawers:controllerSlave': 4103,
  'StorageDrawers:framingTable': 4104, 'StorageDrawersBop:fullDrawers2': 4105,
  'JABBA:barrel': 4200, 'IronChest:BlockIronChest': 4300, 'ForgeMultipart:block': 4400, 'EnderIO:blockConduitBundle': 4500,
  'appliedenergistics2:tile.BlockController': 4600, 'appliedenergistics2:tile.BlockDrive': 4601,
  'appliedenergistics2:tile.BlockCableBus': 4602, 'appliedenergistics2:tile.BlockInterface': 4603,
  'cropsnh:cropSticks': 11025,
});

export const DEFAULT_ITEM_IDS: Readonly<Record<string, number>> = Object.freeze({
  'minecraft:cobblestone': 4, 'minecraft:iron_ingot': 265, 'minecraft:reeds': 338, 'gregtech:gt.metaitem.01': 5000,
  'StorageDrawers:upgrade': 5100, 'StorageDrawers:upgradeDowngrade': 5101, 'StorageDrawers:upgradeCreative': 5102,
  'ProjRed|Transportation:projectred.transportation.routingchip': 5200,
  'appliedenergistics2:item.ItemMultiPart': 5300, 'appliedenergistics2:item.ItemBasicStorageCell.1k': 5301,
  'test:big_item': 40000,
});

// ---- Chunks (world-format §3) ----

const BLOCKS = 4096;
const NIBBLES = BLOCKS / 2;
/** The POSTEA code of chunks saved by the current pack; pre-upgrade chunks carry 0 (world-format §3.5). */
const EID_POSTEA = 1234n;
const BIOME = 1;
const MAX_ORE_TES = 16 * 16 * 255;

interface SectionData { ids: Uint32Array; meta: Uint16Array }

/** The inclusive overlap of `a..b` (either order) with `lo..hi`, or null. */
function clip(a: number, b: number, lo: number, hi: number): [number, number] | null {
  const from = Math.max(Math.min(a, b), lo), to = Math.min(Math.max(a, b), hi);
  return from <= to ? [from, to] : null;
}

function blockId(ids: Readonly<Record<string, number>>, name: string): number {
  const id = Object.hasOwn(ids, name) ? ids[name] : undefined;
  if (id === undefined) throw new Error(`chunkNbt: unknown block ${name}; add it to the world's block ids`);
  return id;
}

function fillSections(spec: ChunkSpec, ids: Readonly<Record<string, number>>): Map<number, SectionData> {
  const sections = new Map<number, SectionData>();
  const x0 = spec.cx * 16, z0 = spec.cz * 16;
  for (const box of spec.fill ?? []) {
    const id = blockId(ids, box.block), meta = box.meta ?? 0;
    if (!Number.isInteger(meta) || meta < 0 || meta > 0xffff) throw new RangeError(`chunkNbt: meta must be 0..65535, got ${meta}`);
    const xs = clip(box.from[0], box.to[0], x0, x0 + 15), ys = clip(box.from[1], box.to[1], 0, 255), zs = clip(box.from[2], box.to[2], z0, z0 + 15);
    if (xs === null || ys === null || zs === null) continue;
    for (let y = ys[0]; y <= ys[1]; y++) {
      let s = sections.get(y >> 4);
      if (s === undefined) sections.set(y >> 4, s = { ids: new Uint32Array(BLOCKS), meta: new Uint16Array(BLOCKS) });
      for (let z = zs[0]; z <= zs[1]; z++) {
        for (let x = xs[0]; x <= xs[1]; x++) {
          const i = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
          s.ids[i] = id;
          s.meta[i] = meta;
        }
      }
    }
  }
  return sections;
}

/** Byte `i` = bits `shift..shift+7` of value `i`. */
function byteArray(values: ArrayLike<number>, shift: number): Uint8Array {
  const out = new Uint8Array(BLOCKS);
  for (let i = 0; i < BLOCKS; i++) out[i] = (values[i]! >>> shift) & 0xff;
  return out;
}

/** Vanilla NibbleArray of bits `shift..shift+3`: byte `i >> 1`, low half for even `i`. */
function nibbleArray(values: ArrayLike<number>, shift: number): Uint8Array {
  const out = new Uint8Array(NIBBLES);
  for (let i = 0; i < BLOCKS; i++) out[i >> 1]! |= ((values[i]! >>> shift) & 15) << ((i & 1) << 2);
  return out;
}

function u16be(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(2 * BLOCKS);
  for (let i = 0; i < BLOCKS; i++) {
    out[2 * i] = values[i]! >>> 8;
    out[2 * i + 1] = values[i]! & 0xff;
  }
  return out;
}

const light = (): Record<string, Tag> => ({ BlockLight: bytes(new Uint8Array(NIBBLES)), SkyLight: bytes(new Uint8Array(NIBBLES).fill(0xff)) });

/** EndlessIDs writes `Add`, `BlocksB2Hi`, `BlocksB3`, `Data1High` and `Data2` only when a value needs them (§3.3). */
function eidSection(y: number, s: SectionData): Tag {
  const maxId = s.ids.reduce((m, v) => Math.max(m, v), 0), maxMeta = s.meta.reduce((m, v) => Math.max(m, v), 0);
  const arrays: Record<string, Tag> = { Blocks: bytes(byteArray(s.ids, 0)) };
  if (maxId > 0xff) arrays.Add = bytes(nibbleArray(s.ids, 8));
  if (maxId > 0xfff) arrays.BlocksB2Hi = bytes(nibbleArray(s.ids, 12));
  if (maxId > 0xffff) arrays.BlocksB3 = bytes(byteArray(s.ids, 16));
  arrays.Data = bytes(nibbleArray(s.meta, 0));
  if (maxMeta > 15) arrays.Data1High = bytes(nibbleArray(s.meta, 4));
  if (maxMeta > 0xff) arrays.Data2 = bytes(byteArray(s.meta, 8));
  return comp({ Y: byte(y), ...arrays, ...light() });
}

/** NotEnoughIDs `Blocks16`/`Data16`: 4096 big-endian u16 each. */
function legacySection(y: number, s: SectionData): Tag {
  if (s.ids.some((id) => id > 0xffff)) throw new RangeError('chunkNbt: a legacy section holds block ids up to 65535 only');
  return comp({ Y: byte(y), Blocks16: bytes(u16be(s.ids)), Data16: bytes(u16be(s.meta)), ...light() });
}

function checkInChunk(t: Tag, spec: ChunkSpec): Tag {
  if (t.type !== 'compound') throw new TypeError(`chunkNbt: a tile entity must be a compound, got '${t.type}'`);
  const { id, x, z } = t.entries;
  if (x?.type === 'int' && z?.type === 'int' && ((x.value >> 4) !== spec.cx || (z.value >> 4) !== spec.cz)) {
    const name = id?.type === 'string' ? id.value : '?';
    throw new Error(`chunkNbt: tile entity ${name} at x ${x.value}, z ${z.value} is outside chunk (${spec.cx}, ${spec.cz})`);
  }
  return t;
}

function oreFillers(spec: ChunkSpec): Tag[] {
  const n = spec.oreTes ?? 0;
  if (!Number.isInteger(n) || n < 0 || n > MAX_ORE_TES) throw new RangeError(`chunkNbt: oreTes must be 0..${MAX_ORE_TES}, got ${n}`);
  return Array.from({ length: n }, (_, i) => oreTe([spec.cx * 16 + (i & 15), 1 + (i >> 8), spec.cz * 16 + ((i >> 4) & 15)]));
}

/**
 * Uncompressed chunk NBT `{ Level: {…} }` (world-format §3.1). `ids` maps block names to ids. EID chunks carry
 * `Biomes16v2` and POSTEA 1234, legacy chunks vanilla `Biomes` and POSTEA 0. `xPos`, `zPos` and `InhabitedTime` come
 * after Sections and TileEntities, so readers must skip by length to reach them (Java's key order is never stable).
 */
export function chunkNbt(spec: ChunkSpec, ids: Readonly<Record<string, number>>): Buffer {
  const legacy = spec.format === 'legacy';
  const sections = [...fillSections(spec, ids)].sort(([a], [b]) => a - b).map(([y, s]) => (legacy ? legacySection(y, s) : eidSection(y, s)));
  const biomes: Record<string, Tag> = legacy
    ? { Biomes: bytes(new Uint8Array(256).fill(BIOME)) }
    : { Biomes16v2: bytes(Uint8Array.from({ length: 512 }, (_, i) => (i & 1 ? 0 : BIOME))) };   // little-endian u16
  const level = comp({
    V: byte(1), LastUpdate: long(0n), TerrainPopulated: byte(1), LightPopulated: byte(1), HeightMap: ints(new Array<number>(256).fill(0)),
    Sections: compounds(sections),
    Entities: compounds([]),
    TileEntities: compounds([...oreFillers(spec), ...(spec.tileEntities ?? []).map((t) => checkInChunk(t, spec))]),
    ...biomes,
    InhabitedTime: long(BigInt(spec.inhabitedTime ?? 0)), xPos: int(spec.cx), zPos: int(spec.cz),
    POSTEA: long(legacy ? 0n : EID_POSTEA),
  });
  return writeNbt(comp({ Level: level }));
}

// ---- The world folder ----

async function put(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

const gzipNbt = (root: Tag): Buffer => gzipSync(writeNbt(root));

function regionRel(dim: number, rx: number, rz: number): string {
  return `${dim === 0 ? '' : `DIM${dim}/`}region/r.${rx}.${rz}.mca`;
}

/** level.dat (world-format §4, §3.6): `Data`, the separate block (`\u0001`) and item (`\u0002`) id maps, chunk managers. */
function levelDat(levelName: string, spawn: Vec3, blocks: Record<string, number>, items: Record<string, number>): Tag {
  const itemData = [
    ...Object.entries(blocks).map(([name, id]) => comp({ K: str(`\u0001${name}`), V: int(id) })),
    ...Object.entries(items).map(([name, id]) => comp({ K: str(`\u0002${name}`), V: int(id) })),
  ];
  const manager = (version: string) => comp({ version: str(version) });
  return comp({
    Data: comp({ LevelName: str(levelName), SpawnX: int(spawn[0]), SpawnY: int(spawn[1]), SpawnZ: int(spawn[2]), version: int(19133), Time: long(0n) }),
    FML: comp({
      ItemData: list('compound', itemData),
      ModList: list('compound', [comp({ ModId: str('chunkapi'), ModVersion: str('0.8.4') }), comp({ ModId: str('endlessids'), ModVersion: str('1.7.4') })]),
    }),
    chunkapicore: comp({ version: str('0.8.4'), managers: comp({
      'endlessids:blockid': manager('1.7.4'), 'endlessids:metadata': manager('1.7.4'), 'endlessids:biome': manager('endlessids'),
      'archaicfix:lighting': manager('1.0'),
    }) }),
  });
}

/** playerdata (world-format §7, materials-availability §6.1): `Dimension`, `Pos`, Forge `Spawns`, netherportalfix `ReturnPortals`. */
function playerNbt(p: NonNullable<WorldSpec['players']>[number]): Tag {
  const [x, y, z] = p.pos;
  const fields: Record<string, Tag> = {
    Dimension: int(p.dim), Pos: list('double', [double(x), double(y), double(z)]), Rotation: list('float', [float(0), float(0)]),
  };
  if (p.spawnDims?.length) {
    fields.Spawns = list('compound', p.spawnDims.map((dim) => comp({
      Dim: int(dim), SpawnX: int(Math.floor(x)), SpawnY: int(Math.floor(y)), SpawnZ: int(Math.floor(z)), SpawnForced: byte(0) })));
  }
  if (p.portals?.length) {
    fields.ForgeData = comp({ PlayerPersisted: comp({
      ReturnPortals: list('compound', p.portals.map(([from, to]) => comp({ FromDim: int(from), ToDim: int(to) }))) }) });
  }
  return comp(fields);
}

/** `serverutilities/teams/claimedchunks/<team>.dat` (world-format §7): `ClaimedChunks: { "<dim>": [{ x, z, preDecay }] }`. */
function claimsNbt(dims: Record<number, Array<[number, number]>>): Tag {
  return comp({ ClaimedChunks: comp(Object.fromEntries(Object.entries(dims).map(([dim, chunks]) =>
    [dim, compounds(chunks.map(([x, z]) => comp({ x: int(x), z: int(z), preDecay: byte(0) })))]))) });
}

/** A LongSet of vein keys `chunkX << 32 | chunkZ & 0xffffffff` (materials-availability §7.2): `int n`, then n sorted longs. */
function longSet(chunks: ReadonlyArray<[number, number]>): Buffer {
  const keys = [...new Set(chunks.map(([x, z]) => BigInt.asIntN(64, (BigInt(x) << 32n) | (BigInt(z) & 0xffffffffn))))]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = Buffer.alloc(4 + 8 * keys.length);
  out.writeInt32BE(keys.length, 0);
  keys.forEach((k, i) => out.writeBigInt64BE(k, 4 + 8 * i));
  return out;
}

function int32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
}

/** `gtnhteams/<team>.json` → `TeamData.visualprospecting = { version: 1, blob }`, blob = Base64(GZIP(int nDims; {int dim; 3 LongSets})). */
function teamJson(dims: NonNullable<WorldSpec['teams']>[string]): unknown {
  const stream = [int32(dims.length), ...dims.flatMap((d) => [int32(d.dim), longSet(d.veins), longSet([]), longSet(d.depleted ?? [])])];
  return { TeamData: { visualprospecting: { version: 1, blob: gzipSync(Buffer.concat(stream)).toString('base64') } } };
}

/** BetterQuesting progress JSON (materials-availability §6.3): NBT-as-JSON keys with `:<type>` suffixes, lists as `"<i>:10"` objects. */
function questJson(questIds: number[]): unknown {
  return { 'questProgress:9': Object.fromEntries(questIds.map((id, i) => [`${i}:10`, {
    'questIDHigh:4': 0, 'questIDLow:4': id,
    'completed:9': { '0:10': { 'uuid:8': '00000000-0000-4000-8000-000000000001', 'timestamp:4': 1_760_000_000_000, 'claimed:1': 1 } },
  }])) };
}

/** VisualProspecting server cache (materials-availability §7.1): gzip NBT version 3, ores by vein-centre chunk. */
function vpDimensionNbt(dim: number, veins: NonNullable<WorldSpec['vp']>['dims'][number]): Tag {
  const palette: string[] = [];
  const index = veins.map((v) => (palette.includes(v.vein) ? palette.indexOf(v.vein) : palette.push(v.vein) - 1));
  return comp({
    dim: int(dim), version: int(3),
    ores: comp({
      palette: list('string', palette.map(str)), chunkX: ints(veins.map((v) => v.chunkX)), chunkZ: ints(veins.map((v) => v.chunkZ)),
      veinTypeIndex: ints(index), depleted: bytes(veins.map((v) => (v.depleted ? 1 : 0))), source: bytes(veins.map(() => 1)),   // 1 = GENERATED
    }),
    fluids: comp({}),
  });
}

/**
 * Writes a server folder at `dir` (= `serverDir`): `server.properties`, the world folder `<levelName>/` with level.dat,
 * region files and side files, and outside it `visualprospecting/server/<worldId>/DIM<n>.dat` and `config/StorageDrawers.cfg`.
 */
export async function makeWorld(dir: string, spec: WorldSpec): Promise<{ serverDir: string; worldDir: string }> {
  const levelName = spec.levelName ?? 'World';
  const serverDir = dir, worldDir = join(dir, levelName);
  const blocks = { ...DEFAULT_BLOCK_IDS, ...spec.blocks }, items = { ...DEFAULT_ITEM_IDS, ...spec.items };
  await put(join(serverDir, 'server.properties'), `#Minecraft server properties\nlevel-name=${levelName}\nserver-port=25565\n`);
  await put(join(worldDir, 'level.dat'), gzipNbt(levelDat(levelName, spec.spawn ?? [0, 64, 0], blocks, items)));

  for (const [dimKey, chunks] of Object.entries(spec.dims)) {
    const dim = Number(dimKey);
    const regions = new Map<string, { rx: number; rz: number; chunks: RegionChunkSpec[] }>();
    for (const c of chunks) {
      const rx = c.cx >> 5, rz = c.cz >> 5, key = `${rx}:${rz}`;
      if (!regions.has(key)) regions.set(key, { rx, rz, chunks: [] });
      regions.get(key)!.chunks.push({ cx: c.cx, cz: c.cz, nbt: c.corrupt ? Buffer.alloc(0) : chunkNbt(c, blocks), timestamp: c.timestamp, corrupt: c.corrupt });
    }
    for (const r of regions.values()) await put(join(worldDir, regionRel(dim, r.rx, r.rz)), regionFile(r.chunks));
  }

  for (const p of spec.players ?? []) await put(join(worldDir, 'playerdata', `${p.file}.dat`), gzipNbt(playerNbt(p)));
  for (const [team, dims] of Object.entries(spec.claims ?? {})) {
    await put(join(worldDir, 'serverutilities', 'teams', 'claimedchunks', `${team}.dat`), gzipNbt(claimsNbt(dims)));
  }
  for (const [team, dims] of Object.entries(spec.teams ?? {})) await put(join(worldDir, 'gtnhteams', `${team}.json`), JSON.stringify(teamJson(dims)));
  for (const [file, ids] of Object.entries(spec.quests ?? {})) {
    await put(join(worldDir, 'betterquesting', 'QuestProgress', `${file}.json`), JSON.stringify(questJson(ids)));
  }
  if (spec.vp !== undefined) {
    await put(join(worldDir, 'data', 'visualprospecting.dat'), gzipNbt(comp({ data: comp({ worldId: str(spec.vp.worldId) }) })));
    for (const [dimKey, veins] of Object.entries(spec.vp.dims)) {
      await put(join(serverDir, 'visualprospecting', 'server', spec.vp.worldId, `DIM${dimKey}.dat`), gzipNbt(vpDimensionNbt(Number(dimKey), veins)));
    }
  }
  if (spec.drawersCfg !== undefined) await put(join(serverDir, 'config', 'StorageDrawers.cfg'), spec.drawersCfg);
  return { serverDir, worldDir };
}

/** Every file below `dir`, relative with '/' separators, in code-unit order. */
async function filesBelow(dir: string): Promise<string[]> {
  const dirents = await readdir(dir, { recursive: true, withFileTypes: true });
  return dirents.filter((d) => d.isFile()).map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/')).sort();
}

/**
 * Zips the server's world folder into `<serverDir>/backups/<name>` as ServerUtilities does (world-format §1.1): entries
 * `World/…` whatever the level name, plus `serverutilities/backup.txt`. `mtime` and `truncateBytes` as in `writeZip`.
 */
export async function makeBackup(serverDir: string, name: string, opts: { mtime?: Date; truncateBytes?: number } = {}): Promise<string> {
  const props = await readFile(join(serverDir, 'server.properties'), 'latin1');
  const worldDir = join(serverDir, /^level-name=(.*)$/m.exec(props)?.[1]?.trim() || 'World');
  const entries: ZipEntrySpec[] = [];
  for (const rel of await filesBelow(worldDir)) entries.push({ name: `World/${rel}`, data: await readFile(join(worldDir, rel)) });
  entries.push({ name: 'serverutilities/backup.txt', data: Buffer.from(`Backup ${name}\n`) });
  const path = join(serverDir, 'backups', name);
  await writeZip(path, entries, opts);
  return path;
}
