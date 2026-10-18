// World scan types: architecture §6.6, with the optional additions and helpers of §11.11 (Plan 4 Task 1).
// Fields after an "optional addition" comment extend §6.6 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: no Node built-in modules here.

import type { StuffKey } from '../keys.ts';
import type { BlockRef, MachineKind } from './pack.ts';

export type WorldSource = { kind: 'server' } | { kind: 'backup'; file: string } | { kind: 'upload'; uploadId: string };
export interface ScanStatus { id: string; state: 'queued' | 'running' | 'done' | 'failed'; progress: number; message: string; startedAt: string; finishedAt?: string }
export interface DimSummary { dim: number; keys: string[] /* DimensionInfo.key(s) hosted by this id */; name: string; chunks: number; inhabitedChunks: number; visited: boolean; visitEvidence: string[] }
export interface Base { id: string; dim: number; name: string; bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }; center: [number, number, number]; machineCount: number; topTier: number }
export interface PlacedMachine {
  dim: number; pos: [number, number, number]; mteId: number; facing: number; mainFacing?: number; color: number; baseId: string | null; storedEU?: number; owner?: never;
  // optional additions: what the export says about this mID ('unknown' when the export does not know it, then no tier)
  kind?: MachineKind | 'unknown'; tier?: number; name?: string; recipeEUt?: number; coilHeat?: number;
}
export interface PlacedPipe {
  dim: number; pos: [number, number, number]; mteId: number; connections: number /* bits 1 down,2 up,4 north,8 south,16 west,32 east */;
  // optional additions
  kind?: 'cable' | 'fluid' | 'item'; voltageTier?: number; amps?: number; networkId?: string;
}
export interface TapPoint { pos: [number, number, number]; dim: number; kind: 'power' | 'routed' | 'ae2' | 'pipe'; voltageTier?: number; freeAmps?: number; networkId: string }
export interface PowerNetwork {
  id: string; baseId: string | null; voltageTier: number; generatorEUt: { clear: number; rain: number; average: number }; consumersMaxEUt: number; storedEU: number; capacityEU: number; taps: TapPoint[];
  // optional additions
  loadEUt?: number; solarShare?: number;
}
export interface LogisticsNetwork {
  id: string; baseId: string | null; kind: 'routed' | 'enderio' | 'gtpipe' | 'ae2'; nodes: number; taps: TapPoint[]; channelsUsed?: number; channelsMax?: number;
  // optional addition: what the network is made of, as a count per part type
  parts?: Record<string, number>;
}
export interface StorageBlock {
  id: string; dim: number; pos: [number, number, number]; kind: 'drawer' | 'drawer_controller' | 'barrel' | 'chest' | 'iron_chest' | 'gt_chest' | 'gt_tank' | 'ae2_drive'; baseId: string | null; networkId: string | null; contents: Array<{ key: StuffKey; count: number }> | null;
  // optional additions: null capacity = unknown; controller = the drawer controller that reaches this block
  capacityStacks?: number | null; controller?: [number, number, number];
}
export interface WorldScan {
  id: string; source: WorldSource; scannedAt: string; levelName: string;
  dims: DimSummary[]; bases: Base[]; machines: PlacedMachine[]; pipes: PlacedPipe[];
  power: PowerNetwork[]; logistics: LogisticsNetwork[]; storage: StorageBlock[];
  visitedDims: string[] /* DimensionInfo.key, judged by InhabitedTime > 0, quests, spawns/portals, team prospecting — not by region files existing */; topTier: number | null; coilHeat: number | null;
  prospected: Array<{ dim: number; x: number; z: number; vein: string }>;
  // optional additions
  logisticsBlocks?: LogisticsBlock[]; warnings?: string[]; skippedChunks?: number;
}
export interface MapTile { dim: number; tx: number; tz: number; size: 64; top: Uint32Array /* palette index per column */; height: Uint8Array }

// ---- Optional additions (architecture §11.11) ----

/** One block of a logistics network (pipe, conduit, cable, interface), for the map overlay. */
export interface LogisticsBlock { dim: number; pos: [number, number, number]; kind: LogisticsNetwork['kind']; networkId: string | null; connections: number }

/** An inclusive block box. */
export type BBox = Base['bbox'];

/**
 * A block area: `blocks[(y·size[2] + z)·size[0] + x]` is the palette index of the block at `origin + [x, y, z]`.
 * Every palette starts with air (`AIR_INDEX`) and `UNKNOWN_BLOCK` (`UNKNOWN_INDEX`, for blocks that were not scanned).
 */
export interface Voxels { origin: [number, number, number]; size: [number, number, number]; blocks: Uint32Array; palette: BlockRef[] }

export const AIR_INDEX = 0;
export const UNKNOWN_INDEX = 1;
export const UNKNOWN_BLOCK: BlockRef = { id: 'gtnh-planner:unknown', meta: 0 };

/** Map tiles are TILE_SIZE × TILE_SIZE columns. */
export const TILE_SIZE = 64;

const TILE_COLUMNS = TILE_SIZE * TILE_SIZE;
const TILE_TOP_BYTES = TILE_COLUMNS * 4;
const TILE_BYTES = TILE_TOP_BYTES + TILE_COLUMNS;   // 20,480

/** The tile holding a block coordinate (x or z). */
export function tileOf(blockCoord: number): number {
  return Math.floor(blockCoord / TILE_SIZE);
}

/** 20,480 bytes: `top` as u32 little-endian × 4096, then `height` as u8 × 4096; column `i = lz·64 + lx`. */
export function encodeMapTile(t: MapTile): Uint8Array {
  if (t.top.length !== TILE_COLUMNS || t.height.length !== TILE_COLUMNS) {
    throw new RangeError(`a map tile has ${TILE_COLUMNS} columns, got top ${t.top.length} and height ${t.height.length}`);
  }
  const bytes = new Uint8Array(TILE_BYTES);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < TILE_COLUMNS; i++) view.setUint32(i * 4, t.top[i]!, true);
  bytes.set(t.height, TILE_TOP_BYTES);
  return bytes;
}

/** The inverse of `encodeMapTile`; the arrays are copies, so `bytes` can be reused. */
export function decodeMapTile(bytes: Uint8Array, dim: number, tx: number, tz: number): MapTile {
  if (bytes.length !== TILE_BYTES) throw new RangeError(`an encoded map tile has ${TILE_BYTES} bytes, got ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = new Uint32Array(TILE_COLUMNS);
  for (let i = 0; i < TILE_COLUMNS; i++) top[i] = view.getUint32(i * 4, true);
  const height = new Uint8Array(bytes.subarray(TILE_TOP_BYTES));
  return { dim, tx, tz, size: TILE_SIZE, top, height };
}

// ---- Base ids (Plan 4 Task 7) ----

/** The id of the base anchored on chunk (cx, cz) of `dim`: `"dim:cx:cz"`. */
export function baseIdOf(dim: number, cx: number, cz: number): string {
  return `${dim}:${cx}:${cz}`;
}

const BASE_ID_RE = /^(-?\d+):(-?\d+):(-?\d+)$/;

/**
 * The base with id `baseId`; after a rescan moved the anchor, the base of the same dimension whose bbox holds the
 * centre column of the old anchor chunk (first in `scan.bases` order). Null for null, a malformed id or no match.
 */
export function findBase(scan: Pick<WorldScan, 'bases'>, baseId: string | null): Base | null {
  if (baseId === null) return null;
  const exact = scan.bases.find((b) => b.id === baseId);
  if (exact !== undefined) return exact;
  const m = BASE_ID_RE.exec(baseId);
  if (m === null) return null;
  const dim = Number(m[1]), x = Number(m[2]) * 16 + 8, z = Number(m[3]) * 16 + 8;
  return scan.bases.find((b) => b.dim === dim && b.bbox.minX <= x && x <= b.bbox.maxX && b.bbox.minZ <= z && z <= b.bbox.maxZ) ?? null;
}
