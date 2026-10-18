// Smart upload (spec §3.4, architecture §11.12): a friend never uploads the whole world. The browser reads the picked
// folder or zip itself, finds where people are and where bases are likely (player positions, spawn, claimed chunks,
// chunks people have spent time in), and sends level.dat plus one trimmed region file per touched region: only the
// chunks within the radius of those spots. Player and claim files are read here and never sent.

import { chunkSummary, INHABITED_KEEP_TICKS } from '../../shared/world/chunk-summary.ts';
import { inflateChunkWith, readNbtWith, type Inflate } from '../../shared/world/inflate.ts';
import { levelInfoFromNbt } from '../../shared/world/level-dat.ts';
import {
  chunkPayload, parseRegionPath, REGION_HEADER_BYTES, regionChunkRefs, regionOfChunk, regionPathOf, trimRegion,
} from '../../shared/world/region.ts';
import { claimedChunks, playerPosition } from '../../shared/world/side-files.ts';
import { unshared } from './inflate.ts';
import type { WorldPick } from './pick-files.ts';
import type { UploadItem } from './upload.ts';

/** In chunks. 8 chunks = 128 blocks, the margin a scan maps around a base (Task 12's MAP_MARGIN). */
export const SMART_RADIUS = { min: 2, max: 32, default: 8 } as const;

/** The bytes of a world-relative file of the pick (`pick.files` or `pick.local`); null when there is no such file. */
export type ReadFile = (rel: string) => Promise<Uint8Array | null>;

export interface Hotspot { dim: number; cx: number; cz: number; why: 'player' | 'spawn' | 'claim' | 'inhabited' }
export const HOTSPOT_ORDER = ['player', 'spawn', 'claim', 'inhabited'] as const;

/** One group of touching chunks to send; `x`, `z` are the block centre of its chunks; `why` lists its kinds of spot. */
export interface SmartArea { dim: number; x: number; z: number; why: string; chunks: number }
/** `items` start with level.dat; `bytes` counts every item, level.dat included; `chunks` the chunks sent. */
export interface SmartPlan { items: UploadItem[]; areas: SmartArea[]; bytes: number; chunks: number }

const LEVEL_DAT = 'level.dat';
const PLAYER_FILES = 'playerdata/';
const CLAIM_FILES = 'serverutilities/teams/claimedchunks/';
const REGION_CHUNKS = 32;
const CHUNKS_PER_REGION = REGION_CHUNKS * REGION_CHUNKS;
/** Chunks of one region file inflated at once while looking for lived-in chunks. */
const CHUNK_LANES = 4;

/** `read(rel)` through `parse`; null when the file is missing or cannot be read, inflated or parsed. */
async function tryRead<T>(read: ReadFile, rel: string, parse: (bytes: Uint8Array) => Promise<T>): Promise<T | null> {
  try {
    const bytes = await read(rel);
    return bytes === null ? null : await parse(bytes);
  } catch {
    return null;
  }
}

/**
 * The chunks of a region file with InhabitedTime ≥ INHABITED_KEEP_TICKS, at their place in the file (not their own
 * xPos / zPos). A chunk whose payload is not in the file, or that fails to inflate or parse, is skipped.
 */
async function inhabitedChunks(region: Uint8Array, rx: number, rz: number, inflate: Inflate): Promise<Array<{ cx: number; cz: number }>> {
  const refs = regionChunkRefs(region.subarray(0, REGION_HEADER_BYTES));
  const out: Array<{ cx: number; cz: number }> = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < refs.length) {
      const ref = refs[next++]!;
      const payload = chunkPayload(region, ref);
      if (payload === null) continue;
      try {
        const { inhabitedTime } = chunkSummary(await inflateChunkWith(payload, inflate));
        if (inhabitedTime >= INHABITED_KEEP_TICKS) out.push({ cx: rx * REGION_CHUNKS + ref.localX, cz: rz * REGION_CHUNKS + ref.localZ });
      } catch {
        // a torn or corrupt chunk
      }
    }
  };
  await Promise.all(Array.from({ length: CHUNK_LANES }, lane));
  return out;
}

const whyRank = (why: Hotspot['why']): number => HOTSPOT_ORDER.indexOf(why);

/**
 * Where to send chunks from: the spawn (level.dat), each player (`playerdata/*.dat`), each claimed chunk (claim files)
 * and each lived-in chunk of every region file, read one file at a time; `onProgress(done, total)` after each region
 * file. A side file or chunk that cannot be read, inflated or parsed is skipped. Each (dim, cx, cz, why) once, sorted
 * by dim, cx, cz, then HOTSPOT_ORDER.
 */
export async function findHotspots(
  pick: WorldPick, read: ReadFile, inflate: Inflate, onProgress?: (done: number, total: number) => void,
): Promise<Hotspot[]> {
  const found: Hotspot[] = [];
  const spawn = await tryRead(read, LEVEL_DAT, async (b) => levelInfoFromNbt(await readNbtWith(b, inflate)).spawn);
  if (spawn !== null) found.push({ dim: 0, cx: spawn[0] >> 4, cz: spawn[2] >> 4, why: 'spawn' });
  for (const { rel } of pick.local) {
    if (rel.startsWith(PLAYER_FILES)) {
      const at = await tryRead(read, rel, async (b) => playerPosition(await readNbtWith(b, inflate)));
      if (at !== null) found.push({ dim: at.dim, cx: Math.floor(at.x) >> 4, cz: Math.floor(at.z) >> 4, why: 'player' });
    } else if (rel.startsWith(CLAIM_FILES)) {
      const claimed = await tryRead(read, rel, async (b) => claimedChunks(await readNbtWith(b, inflate)));
      for (const c of claimed ?? []) found.push({ ...c, why: 'claim' });
    }
  }
  const regions = pick.files.flatMap((f) => {
    const at = f.dim === null ? null : parseRegionPath(f.rel);
    return at === null ? [] : [{ rel: f.rel, ...at }];
  });
  for (const [i, r] of regions.entries()) {
    const lived = await tryRead(read, r.rel, (b) => inhabitedChunks(b, r.rx, r.rz, inflate));
    for (const c of lived ?? []) found.push({ dim: r.dim, ...c, why: 'inhabited' });
    onProgress?.(i + 1, regions.length);
  }
  const unique = new Map(found.map((h) => [`${h.dim},${h.cx},${h.cz},${h.why}`, h]));
  return [...unique.values()].sort((a, b) => a.dim - b.dim || a.cx - b.cx || a.cz - b.cz || whyRank(a.why) - whyRank(b.why));
}

/** The selected chunks of one region: `owner[chunkIndex]` is 1 + the index of a hotspot whose square holds it, 0 if none. */
interface RegionSelection { dim: number; rx: number; rz: number; owner: Int32Array }

/** Every region a hotspot's (2r + 1)² square touches, ordered by dim, rx, rz. */
function selectRegions(hotspots: readonly Hotspot[], radiusChunks: number): RegionSelection[] {
  if (!Number.isInteger(radiusChunks) || radiusChunks < 0) throw new RangeError(`the radius must be a whole number of chunks, got ${radiusChunks}`);
  const r = radiusChunks;
  const regions = new Map<string, RegionSelection>();
  hotspots.forEach((h, i) => {
    for (let rx = regionOfChunk(h.cx - r); rx <= regionOfChunk(h.cx + r); rx++) {
      for (let rz = regionOfChunk(h.cz - r); rz <= regionOfChunk(h.cz + r); rz++) {
        const key = `${h.dim},${rx},${rz}`;
        let sel = regions.get(key);
        if (sel === undefined) regions.set(key, sel = { dim: h.dim, rx, rz, owner: new Int32Array(CHUNKS_PER_REGION) });
        const x0 = rx * REGION_CHUNKS, z0 = rz * REGION_CHUNKS;
        const [lx0, lx1] = [Math.max(h.cx - r, x0) - x0, Math.min(h.cx + r, x0 + REGION_CHUNKS - 1) - x0];
        const [lz0, lz1] = [Math.max(h.cz - r, z0) - z0, Math.min(h.cz + r, z0 + REGION_CHUNKS - 1) - z0];
        for (let lz = lz0; lz <= lz1; lz++) sel.owner.fill(i + 1, lz * REGION_CHUNKS + lx0, lz * REGION_CHUNKS + lx1 + 1);
      }
    }
  });
  return [...regions.values()].sort((a, b) => a.dim - b.dim || a.rx - b.rx || a.rz - b.rz);
}

/** The selected chunk indices of a region, ascending. */
function selectedIndices(owner: Int32Array): number[] {
  const out: number[] = [];
  owner.forEach((o, i) => {
    if (o !== 0) out.push(i);
  });
  return out;
}

/**
 * Every chunk within Chebyshev distance `radiusChunks` of a hotspot of the same dimension, by region file path
 * (ordered by dim, rx, rz), each region's chunk indices sorted and distinct.
 */
export function selectChunks(h: readonly Hotspot[], radiusChunks: number): Map<string, number[]> {
  return new Map(selectRegions(h, radiusChunks).map((s) => [regionPathOf(s.dim, s.rx, s.rz), selectedIndices(s.owner)]));
}

/**
 * The group of each hotspot: the 8-connected groups of the selected chunks. The selection is a union of equal
 * squares, so two squares of one dimension join exactly when their centres are at most 2r + 1 apart on both axes,
 * and the union-find over hotspots gives the flood fill's groups without visiting every selected chunk.
 */
function groupsOf(hotspots: readonly Hotspot[], radiusChunks: number): number[] {
  const parent = hotspots.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const reach = 2 * radiusChunks + 1;
  const byX = hotspots.map((_, i) => i).sort((a, b) => hotspots[a]!.dim - hotspots[b]!.dim || hotspots[a]!.cx - hotspots[b]!.cx);
  for (let k = 0; k < byX.length; k++) {
    const i = byX[k]!, a = hotspots[i]!;
    for (let m = k + 1; m < byX.length; m++) {   // a sweep along x: only hotspots up to `reach` further east can join
      const j = byX[m]!, b = hotspots[j]!;
      if (b.dim !== a.dim || b.cx - a.cx > reach) break;
      if (Math.abs(b.cz - a.cz) <= reach) parent[find(j)] = find(i);
    }
  }
  return hotspots.map((_, i) => find(i));
}

interface AreaBox { dim: number; minCx: number; maxCx: number; minCz: number; maxCz: number; chunks: number }

/**
 * What a smart upload sends: level.dat as picked, then each picked region file the selection touches (in
 * `selectChunks` order), trimmed to its selected chunks and kept when one of them is present; and the areas, groups
 * of touching selected chunks with at least one present chunk, largest first. Nothing from `pick.local` is an item.
 * It reads only the touched region files, so a new radius re-plans without reading the world again.
 */
export async function planSmartUpload(pick: WorldPick, hotspots: readonly Hotspot[], radiusChunks: number, read: ReadFile): Promise<SmartPlan> {
  const level = pick.files.find((f) => f.rel === LEVEL_DAT);
  if (level === undefined) throw new Error('The picked files hold no level.dat');
  const selection = selectRegions(hotspots, radiusChunks);
  const group = groupsOf(hotspots, radiusChunks);
  const picked = new Set(pick.files.map((f) => f.rel));
  const items: UploadItem[] = [{
    rel: LEVEL_DAT, size: level.size,
    blob: async () => {
      const bytes = await read(LEVEL_DAT);
      if (bytes === null) throw new Error('level.dat can no longer be read');
      return new Blob([unshared(bytes)]);
    },
  }];
  const boxes = new Map<number, AreaBox>();
  let chunks = 0;
  for (const sel of selection) {
    const rel = regionPathOf(sel.dim, sel.rx, sel.rz);
    if (!picked.has(rel)) continue;
    const region = await read(rel);
    if (region === null) continue;
    const trimmed = unshared(trimRegion(region, selectedIndices(sel.owner)));
    const present = regionChunkRefs(trimmed.subarray(0, REGION_HEADER_BYTES));   // trimRegion keeps only chunks whose payload is in the file
    if (present.length === 0) continue;
    items.push({ rel, size: trimmed.length, blob: async () => new Blob([trimmed]) });
    chunks += present.length;
    for (const ref of present) {
      const g = group[sel.owner[ref.index]! - 1]!;
      const cx = sel.rx * REGION_CHUNKS + ref.localX, cz = sel.rz * REGION_CHUNKS + ref.localZ;
      const box = boxes.get(g);
      if (box === undefined) {
        boxes.set(g, { dim: sel.dim, minCx: cx, maxCx: cx, minCz: cz, maxCz: cz, chunks: 1 });
        continue;
      }
      box.minCx = Math.min(box.minCx, cx);
      box.maxCx = Math.max(box.maxCx, cx);
      box.minCz = Math.min(box.minCz, cz);
      box.maxCz = Math.max(box.maxCz, cz);
      box.chunks += 1;
    }
  }
  const kinds = new Map<number, Set<Hotspot['why']>>();
  hotspots.forEach((h, i) => {
    const g = group[i]!;
    kinds.set(g, (kinds.get(g) ?? new Set()).add(h.why));
  });
  const areas = [...boxes].map(([g, b]): SmartArea => ({
    dim: b.dim, x: Math.floor((b.minCx + b.maxCx + 1) * 8), z: Math.floor((b.minCz + b.maxCz + 1) * 8),
    why: HOTSPOT_ORDER.filter((w) => kinds.get(g)?.has(w) === true).join(', '), chunks: b.chunks,
  })).sort((a, b) => b.chunks - a.chunks || a.dim - b.dim || a.x - b.x || a.z - b.z);
  return { items, areas, bytes: items.reduce((n, i) => n + i.size, 0), chunks };
}

/** `n` and `word`, with an s unless n is 1: "1 chunk", "1,234 chunks". */
export function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/** Below 1 MiB in whole KB (rounded up), else MB with one decimal. */
export function formatSize(bytes: number): string {
  return bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}
