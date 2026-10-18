// Base detection (spec §3.4 "finds bases automatically"; the clustering rule is the plan's, spec §8 leaves it open):
// per dimension, chunks holding a seed are linked when they lie within LINK_CHUNKS of each other (Chebyshev), and a
// cluster is a base when it is big enough, lived in, claimed or slept in. Ids are anchored on the most lived-in chunk,
// which only grows more lived-in, so a project's base survives rescans (`findBase` covers an anchor that moved).

import { INHABITED_KEEP_TICKS } from '../../shared/world/chunk-summary.ts';
import { baseIdOf, type Base, type BBox } from '../../shared/types/world.ts';
import type { ChunkStat, Vec3 } from './model.ts';

export { INHABITED_KEEP_TICKS };

/**
 * One classified block as base detection sees it. `seed`: every classified record except a vanilla `Chest` (dungeon
 * loot is not a base); `machine`: a GregTech machine; `tier`: its tier, only when it counts for the top tier.
 */
export interface BaseSignal { dim: number; pos: Vec3; seed: boolean; machine: boolean; tier: number | null }

/** Side-file hints that keep a small cluster: claimed chunks (chunk coordinates) and bed spawns (block coordinates). */
export interface BaseHints { claims: Array<{ team: string; dim: number; cx: number; cz: number }>; beds: Array<{ dim: number; x: number; z: number }> }

/** Seed chunks this close (Chebyshev, in chunks) belong to the same base. */
export const LINK_CHUNKS = 3;

/** A cluster with this many seeds is a base without any other evidence. */
export const MIN_SEEDS = 4;

/** The chunk holding block coordinate `v` (floor, so -1 is in chunk -1). */
const chunkOf = (v: number): number => Math.floor(v / 16);

/** A chunk holding ≥ 1 seed; `parent` is its union-find link (null at a cluster's root). */
interface SeedChunk { cx: number; cz: number; seeds: number; inhabited: number; parent: SeedChunk | null }

interface ChunkBounds { minCx: number; maxCx: number; minCz: number; maxCz: number }

const inBounds = (b: ChunkBounds, cx: number, cz: number): boolean => b.minCx <= cx && cx <= b.maxCx && b.minCz <= cz && cz <= b.maxCz;

function root(c: SeedChunk): SeedChunk {
  let r = c;
  while (r.parent !== null) r = r.parent;
  while (c.parent !== null && c.parent !== r) {   // path compression
    const next: SeedChunk = c.parent;
    c.parent = r;
    c = next;
  }
  return r;
}

/** The seed chunks of one dimension joined into clusters (union-find over a hash of chunk coordinates). */
function clusters(seedChunks: Map<string, SeedChunk>): SeedChunk[][] {
  for (const c of seedChunks.values()) {
    for (let dx = -LINK_CHUNKS; dx <= LINK_CHUNKS; dx++) {
      for (let dz = -LINK_CHUNKS; dz <= LINK_CHUNKS; dz++) {
        const n = seedChunks.get(`${c.cx + dx}:${c.cz + dz}`);
        if (n === undefined) continue;
        const a = root(c), b = root(n);
        if (a !== b) b.parent = a;
      }
    }
  }
  const groups = new Map<SeedChunk, SeedChunk[]>();
  for (const c of seedChunks.values()) {
    const r = root(c);
    const g = groups.get(r);
    if (g === undefined) groups.set(r, [c]);
    else g.push(c);
  }
  return [...groups.values()];
}

/** Highest InhabitedTime, then more seeds, then lower cx, then lower cz. */
function anchorOf(chunks: SeedChunk[]): SeedChunk {
  let best = chunks[0]!;
  for (const c of chunks) {
    if (c.inhabited !== best.inhabited ? c.inhabited > best.inhabited
      : c.seeds !== best.seeds ? c.seeds > best.seeds
        : c.cx !== best.cx ? c.cx < best.cx : c.cz < best.cz) best = c;
  }
  return best;
}

/** The team with the most claimed chunks inside `bounds` (ties: the name that sorts first), else null. */
function claimingTeam(claims: BaseHints['claims'], bounds: ChunkBounds): string | null {
  const counts = new Map<string, number>();
  for (const c of claims) if (inBounds(bounds, c.cx, c.cz)) counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
  let team: string | null = null, most = 0;
  for (const [t, n] of counts) {
    if (n > most || (n === most && team !== null && t < team)) {
      team = t;
      most = n;
    }
  }
  return team;
}

function emptyBox(): BBox {
  return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
}

function grow(b: BBox, [x, y, z]: Vec3): void {
  b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.minZ = Math.min(b.minZ, z);
  b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); b.maxZ = Math.max(b.maxZ, z);
}

function bucket<T>(map: Map<number, T[]>, key: number, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function basesOfDim(dim: number, signals: BaseSignal[], chunks: ChunkStat[], hints: BaseHints, dimName: (dim: number) => string): Base[] {
  const inhabited = new Map<string, number>();
  for (const s of chunks) {
    const key = `${s.cx}:${s.cz}`;
    inhabited.set(key, Math.max(inhabited.get(key) ?? 0, s.inhabitedTime));
  }
  const seedChunks = new Map<string, SeedChunk>();
  const signalChunks = new Map<string, { cx: number; cz: number; signals: BaseSignal[] }>();
  for (const s of signals) {
    const cx = chunkOf(s.pos[0]), cz = chunkOf(s.pos[2]), key = `${cx}:${cz}`;
    const sc = signalChunks.get(key);
    if (sc === undefined) signalChunks.set(key, { cx, cz, signals: [s] });
    else sc.signals.push(s);
    if (!s.seed) continue;
    const c = seedChunks.get(key);
    if (c !== undefined) c.seeds++;
    else seedChunks.set(key, { cx, cz, seeds: 1, inhabited: inhabited.get(key) ?? 0, parent: null });
  }
  const claims = hints.claims.filter((c) => c.dim === dim);
  const beds = hints.beds.filter((b) => b.dim === dim);

  const bases: Base[] = [];
  for (const cluster of clusters(seedChunks)) {
    const bounds: ChunkBounds = { minCx: Infinity, maxCx: -Infinity, minCz: Infinity, maxCz: -Infinity };
    let seeds = 0, lived = false;
    for (const c of cluster) {
      bounds.minCx = Math.min(bounds.minCx, c.cx); bounds.maxCx = Math.max(bounds.maxCx, c.cx);
      bounds.minCz = Math.min(bounds.minCz, c.cz); bounds.maxCz = Math.max(bounds.maxCz, c.cz);
      seeds += c.seeds;
      if (c.inhabited >= INHABITED_KEEP_TICKS) lived = true;
    }
    const team = claimingTeam(claims, bounds);
    const keep = seeds >= MIN_SEEDS || lived || team !== null || beds.some((b) => inBounds(bounds, chunkOf(b.x), chunkOf(b.z)));
    if (!keep) continue;

    const bbox = emptyBox();
    let machineCount = 0, topTier = 0;
    for (const sc of signalChunks.values()) {
      if (!inBounds(bounds, sc.cx, sc.cz)) continue;
      for (const s of sc.signals) {
        grow(bbox, s.pos);
        if (s.machine) machineCount++;
        if (s.tier !== null && s.tier > topTier) topTier = s.tier;
      }
    }
    const center: Vec3 = [Math.floor((bbox.minX + bbox.maxX) / 2), Math.floor((bbox.minY + bbox.maxY) / 2), Math.floor((bbox.minZ + bbox.maxZ) / 2)];
    const anchor = anchorOf(cluster);
    const name = `${team ?? dimName(dim)} base (${center[0]}, ${center[2]})`;
    bases.push({ id: baseIdOf(dim, anchor.cx, anchor.cz), dim, name, bbox, center, machineCount, topTier });
  }
  return bases;
}

/**
 * The bases of every dimension. A cluster of seed chunks is kept when it holds ≥ MIN_SEEDS seeds, a chunk with
 * InhabitedTime ≥ INHABITED_KEEP_TICKS, a claimed chunk or a bed spawn inside its chunk bounds (the rectangle of its
 * chunks). `bbox` covers every signal, seed or not, inside those bounds; `machineCount` counts GT machines and
 * `topTier` is their highest tier (0 when none). Sorted by machineCount descending, then id.
 */
export function findBases(signals: BaseSignal[], chunks: ChunkStat[], hints: BaseHints, dimName: (dim: number) => string): Base[] {
  const signalsByDim = new Map<number, BaseSignal[]>();
  for (const s of signals) bucket(signalsByDim, s.dim, s);
  const chunksByDim = new Map<number, ChunkStat[]>();
  for (const c of chunks) bucket(chunksByDim, c.dim, c);
  const bases: Base[] = [];
  for (const [dim, dimSignals] of signalsByDim) bases.push(...basesOfDim(dim, dimSignals, chunksByDim.get(dim) ?? [], hints, dimName));
  return bases.sort((a, b) => b.machineCount - a.machineCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The first base of `dim` whose bbox holds `pos` (edges included), else null. */
export function baseAt(bases: Base[], dim: number, pos: Vec3): Base | null {
  const [x, y, z] = pos;
  return bases.find((b) => b.dim === dim && b.bbox.minX <= x && x <= b.bbox.maxX && b.bbox.minY <= y && y <= b.bbox.maxY
    && b.bbox.minZ <= z && z <= b.bbox.maxZ) ?? null;
}
