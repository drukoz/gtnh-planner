// Which dimensions the group has been to (spec §3.3b, materials-availability §6): a dimension is visited only by
// InhabitedTime > 0 in one of its chunks, a player's `Dimension` / bed spawns / portal use, a completed BetterQuesting
// location quest, or team prospecting there — never because region files exist. The side-file readers here also give
// base detection its hints (beds, claimed chunks). Evidence strings name the kind of evidence only, never a player.

import type { DimensionInfo } from '../../shared/types/pack.ts';
import type { DimSummary } from '../../shared/types/world.ts';
import type { BaseHints } from './bases.ts';
import type { ChunkStat } from './model.ts';
import { comp, list, type NbtCompound, type NbtValue } from './nbt.ts';

/** BetterQuesting location quests by questIDLow (questIDHigh 0), materials-availability §6.3. */
export const LOCATION_QUESTS: Readonly<Record<number, { dim: number; name: string }>> = Object.freeze({
  479: { dim: -1, name: 'THE NETHER' },
  225: { dim: 7, name: 'Searching for Answers' },
  986: { dim: 1, name: 'Is This the End?' },
  1072: { dim: 28, name: 'Moon Arrival' },
  2311: { dim: 64, name: 'Ross128b Trip' },
  2634: { dim: 227, name: 'A Vision of the Future' },
});

/** One piece of evidence that a dimension was visited, e.g. `{ dim: -1, why: 'portal use' }`. */
export interface VisitHint { dim: number; why: string }

const intOf = (v: NbtValue | undefined): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/**
 * A player file (world-format §7, materials-availability §6.1): `Dimension` → player location; bed spawns → `bed spawn`
 * visits and base hints; `ForgeData.PlayerPersisted.ReturnPortals[]` (netherportalfix) `FromDim`/`ToDim` → portal use.
 * Forge keeps the Overworld bed in the root `SpawnX`/`SpawnZ` and every other dimension's in `Spawns[]` (with `Dim`).
 */
export function playerHints(player: NbtCompound): { visits: VisitHint[]; beds: BaseHints['beds'] } {
  const visits: VisitHint[] = [];
  const beds: BaseHints['beds'] = [];
  const at = intOf(player.Dimension);
  if (at !== null) visits.push({ dim: at, why: 'player location' });
  const rootX = intOf(player.SpawnX), rootZ = intOf(player.SpawnZ);
  if (rootX !== null && rootZ !== null) {
    visits.push({ dim: 0, why: 'bed spawn' });
    beds.push({ dim: 0, x: rootX, z: rootZ });
  }
  for (const entry of list(player.Spawns)) {
    const spawn = comp(entry);
    const dim = intOf(spawn?.Dim);
    if (spawn === null || dim === null) continue;
    visits.push({ dim, why: 'bed spawn' });
    const x = intOf(spawn.SpawnX), z = intOf(spawn.SpawnZ);
    if (x !== null && z !== null) beds.push({ dim, x, z });
  }
  for (const entry of list(comp(comp(player.ForgeData)?.PlayerPersisted)?.ReturnPortals)) {
    const portal = comp(entry);
    for (const side of [portal?.FromDim, portal?.ToDim]) {
      const dim = intOf(side);
      if (dim !== null) visits.push({ dim, why: 'portal use' });
    }
  }
  return { visits, beds };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `obj[name]`, also when BetterQuesting wrote the key with its NBT type suffix (`"name:<type>"`). */
function field(obj: Record<string, unknown>, name: string): unknown {
  if (Object.hasOwn(obj, name)) return obj[name];
  const prefix = `${name}:`;
  for (const [key, value] of Object.entries(obj)) if (key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))) return value;
  return undefined;
}

/** A BetterQuesting list: a JSON array, or an object keyed `"<i>:<type>"` (its values); anything else is empty. */
function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return isObject(v) ? Object.values(v) : [];
}

/** One `quest: <name>` hint per completed location quest (`completed` has ≥ 1 entry) in a QuestProgress JSON. */
export function questVisits(progress: unknown): VisitHint[] {
  if (!isObject(progress)) return [];
  const visits: VisitHint[] = [];
  for (const q of listOf(field(progress, 'questProgress'))) {
    if (!isObject(q) || field(q, 'questIDHigh') !== 0) continue;
    const low = field(q, 'questIDLow');
    const quest = typeof low === 'number' && Object.hasOwn(LOCATION_QUESTS, low) ? LOCATION_QUESTS[low] : undefined;
    if (quest === undefined || listOf(field(q, 'completed')).length === 0) continue;
    visits.push({ dim: quest.dim, why: `quest: ${quest.name}` });
  }
  return visits;
}

/** A ServerUtilities claims file (world-format §7): `ClaimedChunks: { "<dim>": [{ x, z }] }`, chunk coordinates. */
export function claimHints(team: string, claims: NbtCompound): BaseHints['claims'] {
  const out: BaseHints['claims'] = [];
  for (const [key, chunks] of Object.entries(comp(claims.ClaimedChunks) ?? {})) {
    if (!/^-?\d+$/.test(key)) continue;
    const dim = Number(key);
    for (const entry of list(chunks)) {
      const chunk = comp(entry);
      const cx = intOf(chunk?.x), cz = intOf(chunk?.z);
      if (cx !== null && cz !== null) out.push({ team, dim, cx, cz });
    }
  }
  return out;
}

/**
 * One summary per dimension that has chunks or hints, sorted by dim id. `keys`: every pack dimension with that id
 * (DIM 1 hosts both `theend` and `endasteroid`); `visitEvidence`: `inhabited chunks: <n>` when n > 0, then each
 * distinct `why` in first-seen order, with ` (×<count>)` when repeated. Visited = any evidence at all.
 */
export function dimSummaries(chunks: ChunkStat[], hints: VisitHint[], dims: DimensionInfo[]): DimSummary[] {
  const acc = new Map<number, { chunks: number; inhabited: number; whys: Map<string, number> }>();
  const entry = (dim: number) => {
    let e = acc.get(dim);
    if (e === undefined) acc.set(dim, e = { chunks: 0, inhabited: 0, whys: new Map() });
    return e;
  };
  for (const c of chunks) {
    const e = entry(c.dim);
    e.chunks++;
    if (c.inhabitedTime > 0) e.inhabited++;
  }
  for (const h of hints) {
    const whys = entry(h.dim).whys;
    whys.set(h.why, (whys.get(h.why) ?? 0) + 1);
  }
  return [...acc].sort(([a], [b]) => a - b).map(([dim, e]) => {
    const infos = dims.filter((d) => d.id === dim);
    const visitEvidence = e.inhabited > 0 ? [`inhabited chunks: ${e.inhabited}`] : [];
    for (const [why, n] of e.whys) visitEvidence.push(n > 1 ? `${why} (×${n})` : why);
    return {
      dim, keys: infos.map((d) => d.key), name: infos[0]?.name ?? (dim === 0 ? 'Overworld' : `DIM${dim}`),
      chunks: e.chunks, inhabitedChunks: e.inhabited, visited: visitEvidence.length > 0, visitEvidence,
    };
  });
}

/** Every `DimensionInfo.key` of the visited dimensions, in dim order. */
export function visitedKeys(s: DimSummary[]): string[] {
  return [...s].sort((a, b) => a.dim - b.dim).filter((d) => d.visited).flatMap((d) => d.keys);
}
