// VisualProspecting data (materials-availability §7): the server cache names the vein at each vein-centre chunk of
// the world; the team files say which of those chunks a team prospected. Joining the two gives "where the group has
// already found this ore" (spec §3.3b). Team discoveries are keys only, so a key without a cache entry has no vein type.

import { gunzipSync } from 'node:zlib';
import type { WorldScan } from '../../shared/types/world.ts';
import { comp, INFLATE_LIMIT, list, readGzipNbt, type NbtValue } from './nbt.ts';

/** One vein of the server cache, keyed by the chunk of its centre. */
export interface VpVein { dim: number; chunkX: number; chunkZ: number; vein: string; depleted: boolean }

/** One dimension of a team's discoveries, as vein-centre chunk coordinates `[chunkX, chunkZ]`. */
export interface TeamDiscoveries { dim: number; veins: Array<[number, number]>; depleted: Array<[number, number]> }

/** `MinecraftServer.getFolderName() + "_" + <random UUID>`: the name of the world's server-cache folder. */
const WORLD_ID_RE = /_[0-9a-f-]{36}$/;

/** `DimensionCache.CURRENT_FORMAT_VERSION`. */
const CACHE_VERSION = 3;

/**
 * The world id in `World/data/visualprospecting.dat` (gzip NBT): the first String under `data` that ends in
 * `_<uuid>`, else null. Only the server-cache folder with this name belongs to the world (§7.1).
 */
export function vpWorldId(visualprospectingDat: Uint8Array): string | null {
  for (const value of Object.values(comp(readGzipNbt(visualprospectingDat).data) ?? {})) {
    if (typeof value === 'string' && WORLD_ID_RE.test(value)) return value;
  }
  return null;
}

/** An IntArray or a List of Ints as numbers; null for anything else. */
function intList(v: NbtValue | undefined): number[] | null {
  if (v instanceof Int32Array) return Array.from(v);
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number') return null;
    out.push(x);
  }
  return out;
}

/**
 * The ores of a server cache file `visualprospecting/server/<worldId>/DIM<n>.dat` (gzip NBT, version 3):
 * `ores.chunkX`/`chunkZ`/`veinTypeIndex` (IntArray or List<Int>) index into `ores.palette`; `ores.depleted` is a
 * ByteArray. A vein whose type index is outside the palette is left out. Other versions, a missing `dim` and ore
 * arrays of different lengths throw.
 */
export function readVpDimension(buf: Uint8Array): VpVein[] {
  const root = readGzipNbt(buf);
  if (root.version !== CACHE_VERSION) throw new Error(`VisualProspecting cache version ${String(root.version)} is not supported (expected ${CACHE_VERSION})`);
  const dim = root.dim;
  if (typeof dim !== 'number') throw new Error('VisualProspecting cache has no dim');
  const ores = comp(root.ores);
  if (ores === null) return [];
  const palette = list(ores.palette);
  const xs = intList(ores.chunkX) ?? [], zs = intList(ores.chunkZ) ?? [], types = intList(ores.veinTypeIndex) ?? [];
  if (zs.length !== xs.length || types.length !== xs.length) {
    throw new Error(`VisualProspecting cache ore array lengths differ: chunkX ${xs.length}, chunkZ ${zs.length}, veinTypeIndex ${types.length}`);
  }
  const depleted = ores.depleted instanceof Uint8Array ? ores.depleted : (intList(ores.depleted) ?? []);
  const veins: VpVein[] = [];
  for (let i = 0; i < xs.length; i++) {
    const vein = palette[types[i]!];
    if (typeof vein !== 'string') continue;
    veins.push({ dim, chunkX: xs[i]!, chunkZ: zs[i]!, vein, depleted: (depleted[i] ?? 0) !== 0 });
  }
  return veins;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `TeamData.visualprospecting.blob` of a `World/gtnhteams/<team>.json`, else null. */
export function teamBlobOf(json: unknown): string | null {
  const vp = isObject(json) && isObject(json.TeamData) ? json.TeamData.visualprospecting : undefined;
  return isObject(vp) && typeof vp.blob === 'string' ? vp.blob : null;
}

/**
 * A team blob (§7.2): Base64 of GZIP of a big-endian stream `int nDims; nDims × { int dim; LongSet veins;
 * LongSet fluidFields; LongSet depleted }`, LongSet = `int n; n × long`, vein key `chunkX << 32 | chunkZ & 0xffffffff`.
 * Fluid fields are skipped. A truncated stream, a negative count or a blob inflating past `MAX_INFLATED_BYTES` throws.
 */
export function decodeTeamBlob(b64: string): TeamDiscoveries[] {
  const raw = gunzipSync(Buffer.from(b64, 'base64'), INFLATE_LIMIT);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let pos = 0;
  const need = (n: number): void => {
    if (pos + n > raw.length) throw new Error(`VisualProspecting team blob is truncated: ${n} bytes needed at byte ${pos} of ${raw.length}`);
  };
  const count = (): number => {
    need(4);
    const n = view.getInt32(pos);
    pos += 4;
    if (n < 0) throw new Error(`VisualProspecting team blob has a negative count ${n} at byte ${pos - 4}`);
    return n;
  };
  const longSet = (): Array<[number, number]> => {
    const n = count();
    need(n * 8);
    const keys: Array<[number, number]> = [];
    for (let i = 0; i < n; i++, pos += 8) keys.push([view.getInt32(pos), view.getInt32(pos + 4)]);   // high int = chunkX, low = chunkZ
    return keys;
  };
  const dims: TeamDiscoveries[] = [];
  for (let d = count(); d > 0; d--) {
    need(4);
    const dim = view.getInt32(pos);
    pos += 4;
    const veins = longSet();
    longSet();   // discovered fluid fields
    dims.push({ dim, veins, depleted: longSet() });
  }
  return dims;
}

/**
 * Team discoveries joined to the server cache: one entry per discovered vein chunk with a cache entry, at the block
 * coordinates of that chunk's centre (`chunkX·16 + 8`, `chunkZ·16 + 8`), de-duplicated across teams and sorted by
 * dim, x, z. `unmatched` counts the distinct discovered chunks the cache has no vein for.
 */
export function joinDiscoveries(cache: VpVein[], teams: TeamDiscoveries[][]): { prospected: WorldScan['prospected']; unmatched: number } {
  const byChunk = new Map<string, VpVein>();
  for (const v of cache) {
    const key = `${v.dim}:${v.chunkX}:${v.chunkZ}`;
    if (!byChunk.has(key)) byChunk.set(key, v);
  }
  const found = new Map<string, WorldScan['prospected'][number]>();
  const unmatched = new Set<string>();
  for (const team of teams) {
    for (const { dim, veins } of team) {
      for (const [chunkX, chunkZ] of veins) {
        const key = `${dim}:${chunkX}:${chunkZ}`;
        if (found.has(key) || unmatched.has(key)) continue;
        const vein = byChunk.get(key);
        if (vein === undefined) unmatched.add(key);
        else found.set(key, { dim, x: chunkX * 16 + 8, z: chunkZ * 16 + 8, vein: vein.vein });
      }
    }
  }
  const prospected = [...found.values()].sort((a, b) => a.dim - b.dim || a.x - b.x || a.z - b.z);
  return { prospected, unmatched: unmatched.size };
}
