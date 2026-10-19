// Where a line goes (Plan 5 Task 4; spec §3.6, Review Focus 2): the column analysis of a voxel box read around the
// base, the search for clear, flat ground near the base centre and its taps, the check of a spot the user chose, and
// the fallback beside the base box when nothing fits. A line is never put into existing blocks silently: a checked
// or fallback spot reports what is in the way (`blocked`) and how many columns have no floor (`unsupported`).
// The search is deterministic — fixed iteration order, strict improvement only — so the same voxels give the same site.

import { manhattan, posKey, rotatedSize, toWorld, type Rotation, type Vec3 } from '../../shared/layout/geometry.ts';
import type { BlockRef } from '../../shared/types/pack.ts';
import { AIR_INDEX, UNKNOWN_INDEX, type Base, type BBox, type Voxels, type WorldScan } from '../../shared/types/world.ts';

export const SITE_MARGIN = 24;        // blocks searched around the base box
export const SITE_CLEARANCE = 1;      // free ring around the line
export const MAX_STEP = 1;            // a column may sit 1 above or below the floor (dug or filled)
export const MAX_SITE_SPAN = 192;     // x/z span of the voxel read (stays far below MAX_AREA_VOXELS)
export const SITE_HEADROOM = 8;

export interface Footprint { w: number; h: number; l: number }            // local W (x), H, L (z), before rotation
export interface SiteRequest {
  dim: number; footprint: Footprint; base: Base; baseFloorY: number;
  ports: { power?: Vec3; logistics?: Vec3 };                             // local cells, may lie outside the box
  taps: { power?: Vec3; logistics?: Vec3 };                              // world positions
  avoid: ReadonlySet<string>;                                            // posKeys of every scanned machine, pipe, storage and logistics block
}
export interface Site { origin: Vec3; rotation: Rotation; size: Vec3 /* world */; floorY: number; dig: number; fill: number; blocked: number; unsupported: number; score: number; reason: 'search' | 'placement' | 'fallback'; moved: boolean }

const REPLACEABLE: ReadonlySet<string> = new Set([
  'minecraft:air', 'minecraft:tallgrass', 'minecraft:double_plant', 'minecraft:red_flower', 'minecraft:yellow_flower',
  'minecraft:deadbush', 'minecraft:snow_layer', 'minecraft:vine', 'minecraft:fire', 'minecraft:brown_mushroom', 'minecraft:red_mushroom',
]);
const FLUIDS: ReadonlySet<string> = new Set(['minecraft:water', 'minecraft:flowing_water', 'minecraft:lava', 'minecraft:flowing_lava']);
const FLUID_ID = /fluid/i;

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const WORLD_TOP_Y = 255;
/** The search box reaches this far past every tap. */
const TAP_REACH = 2;
/** Weights of the site score (lower wins). */
const BASE_WEIGHT = 2, FLOOR_WEIGHT = 4, EARTHWORK_WEIGHT = 2;

/** What a voxel cell is for the site rules. */
const CLEAR = 0, SOLID = 1, FLUID = 2, MACHINE = 3, UNKNOWN = 4;
/** `Columns.top` of a column without a known top. */
const NO_TOP = -32768;

/** Blocks a line may be built through: they count as air. */
export function isReplaceable(ref: BlockRef): boolean {
  return REPLACEABLE.has(ref.id);
}

export function isFluidBlock(ref: BlockRef): boolean {
  return FLUIDS.has(ref.id) || FLUID_ID.test(ref.id);
}

/** The floor of the base: the most common y of its scanned machines (ties → lower), else the base centre's y. */
export function baseFloorY(scan: WorldScan, base: Base): number {
  const counts = new Map<number, number>();
  for (const m of scan.machines) if (m.baseId === base.id) counts.set(m.pos[1], (counts.get(m.pos[1]) ?? 0) + 1);
  let best = base.center[1], bestCount = 0;
  for (const [y, n] of counts) {
    if (n > bestCount || (n === bestCount && y < best)) {
      best = y;
      bestCount = n;
    }
  }
  return best;
}

/** `[lo, hi]`, or the `MAX_SITE_SPAN` blocks around `centre` when it is wider than that. */
function capSpan(lo: number, hi: number, centre: number): [number, number] {
  const half = MAX_SITE_SPAN / 2;
  return hi - lo + 1 > MAX_SITE_SPAN ? [centre - half, centre + half - 1] : [lo, hi];
}

function clampY(y: number): number {
  return Math.min(Math.max(y, 0), WORLD_TOP_Y);
}

/** The voxel box the site search reads: the base box and its margin, every tap, and headroom above and below the floor. */
export function siteSearchBox(base: Base, floorY: number, footprint: Footprint, taps: readonly Vec3[]): BBox {
  const b = base.bbox;
  let minX = b.minX - SITE_MARGIN, maxX = b.maxX + SITE_MARGIN;
  let minZ = b.minZ - SITE_MARGIN, maxZ = b.maxZ + SITE_MARGIN;
  let minY = floorY - 1 - SITE_HEADROOM, maxY = floorY + footprint.h + SITE_HEADROOM;
  for (const t of taps) {
    minX = Math.min(minX, t[0] - TAP_REACH); maxX = Math.max(maxX, t[0] + TAP_REACH);
    minY = Math.min(minY, t[1] - TAP_REACH); maxY = Math.max(maxY, t[1] + TAP_REACH);
    minZ = Math.min(minZ, t[2] - TAP_REACH); maxZ = Math.max(maxZ, t[2] + TAP_REACH);
  }
  [minX, maxX] = capSpan(minX, maxX, base.center[0]);
  [minZ, maxZ] = capSpan(minZ, maxZ, base.center[2]);
  return { minX, minY: clampY(minY), minZ, maxX, maxY: clampY(maxY), maxZ };
}

/** The class of every palette entry; the reserved air and unknown entries go by their index. */
function cellClasses(palette: readonly BlockRef[]): Uint8Array {
  const classes = new Uint8Array(palette.length);
  palette.forEach((ref, i) => {
    if (i === AIR_INDEX) classes[i] = CLEAR;
    else if (i === UNKNOWN_INDEX) classes[i] = UNKNOWN;
    else if (isReplaceable(ref)) classes[i] = CLEAR;
    else if (isFluidBlock(ref)) classes[i] = FLUID;
    else if (ref.mteId !== undefined) classes[i] = MACHINE;
    else classes[i] = SOLID;
  });
  return classes;
}

/** Reads cell classes of a voxel box by local coordinates; cells outside the box are unknown. */
class VoxelCells {
  readonly vox: Voxels;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  private readonly classes: Uint8Array;

  constructor(vox: Voxels) {
    this.vox = vox;
    [this.sx, this.sy, this.sz] = vox.size;
    this.classes = cellClasses(vox.palette);
  }

  classAt(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return UNKNOWN;
    return this.classes[this.vox.blocks[(y * this.sz + z) * this.sx + x]!] ?? UNKNOWN;
  }

  /** The local y of the first cell from the top of the box down that is neither air nor replaceable; −1 for none. */
  topAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return -1;
    for (let y = this.sy - 1; y >= 0; y--) if (this.classAt(x, y, z) !== CLEAR) return y;
    return -1;
  }
}

/** Column tops (world y, `NO_TOP` when absent or unknown) and ground flags of a whole box, index `z·sx + x`. */
interface Columns { top: Int16Array; ground: Uint8Array }

function columnsOf(cells: VoxelCells, avoid: ReadonlySet<string>): Columns {
  const { sx, sz, vox } = cells;
  const [ox, oy, oz] = vox.origin;
  const top = new Int16Array(sx * sz).fill(NO_TOP);
  const ground = new Uint8Array(sx * sz);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const y = cells.topAt(x, z);
      if (y === -1) continue;
      const cls = cells.classAt(x, y, z);
      if (cls === UNKNOWN) continue;
      const i = z * sx + x;
      top[i] = oy + y;
      if (cls === SOLID && !avoid.has(posKey([ox + x, oy + y, oz + z]))) ground[i] = 1;
    }
  }
  return { top, ground };
}

interface Level { y0: number; dig: number; fill: number }

/**
 * The floor of the `wr × lr` rectangle at local (x0, z0): all columns ground, y0 their most common top (ties → lower),
 * every column within `MAX_STEP` of y0, the clearance ring ground and no higher than y0 + `MAX_STEP`, and room for
 * `h` blocks above y0 up to `maxY`. Null when the rectangle is not buildable.
 */
function levelAt(cols: Columns, sx: number, x0: number, z0: number, wr: number, lr: number, h: number, maxY: number): Level | null {
  const { top, ground } = cols;
  const spread = 2 * MAX_STEP;
  let min = Infinity, max = -Infinity;
  for (let z = z0; z < z0 + lr; z++) {
    for (let x = x0; x < x0 + wr; x++) {
      const i = z * sx + x;
      if (ground[i] !== 1) return null;
      const t = top[i]!;
      if (t < min) min = t;
      if (t > max) max = t;
      if (max - min > spread) return null;
    }
  }
  const counts = new Array<number>(spread + 1).fill(0);
  for (let z = z0; z < z0 + lr; z++) for (let x = x0; x < x0 + wr; x++) counts[top[z * sx + x]! - min]!++;
  let mode = 0;
  for (let k = 1; k <= spread; k++) if (counts[k]! > counts[mode]!) mode = k;
  const y0 = min + mode;
  if (min < y0 - MAX_STEP || max > y0 + MAX_STEP || y0 + h > maxY) return null;
  const c = SITE_CLEARANCE;
  for (let z = z0 - c; z < z0 + lr + c; z++) {
    for (let x = x0 - c; x < x0 + wr + c; x++) {
      if (x >= x0 && x < x0 + wr && z >= z0 && z < z0 + lr) continue;
      const i = z * sx + x;
      if (ground[i] !== 1 || top[i]! > y0 + MAX_STEP) return null;
    }
  }
  let dig = 0, fill = 0;
  counts.forEach((n, k) => {
    const d = min + k - y0;
    if (d > 0) dig += n * d;
    else fill -= n * d;
  });
  return { y0, dig, fill };
}

/** The distance from a port of the line (local cell) to its tap; 0 when either is missing. */
function portDistance(port: Vec3 | undefined, tap: Vec3 | undefined, origin: Vec3, r: Rotation, size: Vec3): number {
  return port === undefined || tap === undefined ? 0 : manhattan(toWorld(port, origin, r, size), tap);
}

/**
 * The best clear, flat spot inside `vox` (lowest score; ties → lowest x, then z, then rotation 0, 90, 180, 270);
 * null when no rectangle with its clearance ring is buildable.
 */
export function findSite(req: SiteRequest, vox: Voxels): Site | null {
  const cells = new VoxelCells(vox);
  const cols = columnsOf(cells, req.avoid);
  const { sx, sy, sz } = cells;
  const [ox, oy, oz] = vox.origin;
  const maxY = oy + sy - 1;
  const { w, h, l } = req.footprint;
  const size: Vec3 = [w, h, l];
  const c = SITE_CLEARANCE;
  let best: Site | null = null;
  for (let x0 = c; x0 < sx - c; x0++) {
    for (let z0 = c; z0 < sz - c; z0++) {
      const levels: Array<Level | null | undefined> = [undefined, undefined];   // per orientation: W × L, L × W
      for (const r of ROTATIONS) {
        const [wr, , lr] = rotatedSize(size, r);
        if (x0 + wr + c > sx || z0 + lr + c > sz) continue;
        const turn = r % 180 === 0 ? 0 : 1;
        let level = levels[turn];
        if (level === undefined) level = levels[turn] = levelAt(cols, sx, x0, z0, wr, lr, h, maxY);
        if (level === null) continue;
        const origin: Vec3 = [ox + x0, level.y0 + 1, oz + z0];
        const centre: Vec3 = [origin[0] + Math.floor(wr / 2), origin[1], origin[2] + Math.floor(lr / 2)];
        const score = BASE_WEIGHT * manhattan(centre, req.base.center)
          + portDistance(req.ports.power, req.taps.power, origin, r, size)
          + portDistance(req.ports.logistics, req.taps.logistics, origin, r, size)
          + FLOOR_WEIGHT * Math.abs(origin[1] - req.baseFloorY)
          + EARTHWORK_WEIGHT * (level.dig + level.fill);
        if (best !== null && score >= best.score) continue;
        best = {
          origin, rotation: r, size: rotatedSize(size, r), floorY: level.y0, dig: level.dig, fill: level.fill,
          blocked: 0, unsupported: 0, score, reason: 'search', moved: false,
        };
      }
    }
  }
  return best;
}

/**
 * The line at `at` turned by `rotation`, its y clamped into the world (`moved` when clamped), with what is in the way:
 * `blocked` known cells in its volume that are not air or replaceable (fluids count), `unsupported` columns whose
 * floor cell is known and air, replaceable or fluid, and the dig/fill to level the known column tops to the floor.
 */
function measure(req: SiteRequest, vox: Voxels | null, at: Vec3, rotation: Rotation, reason: Site['reason']): Site {
  const { w, h, l } = req.footprint;
  const size = rotatedSize([w, h, l], rotation);
  const y = Math.min(Math.max(at[1], 1), WORLD_TOP_Y + 1 - h);
  const origin: Vec3 = [at[0], y, at[2]];
  const floorY = y - 1;
  let dig = 0, fill = 0, blocked = 0, unsupported = 0;
  if (vox !== null) {
    const cells = new VoxelCells(vox);
    const [ox, oy, oz] = vox.origin;
    const x0 = origin[0] - ox, y0 = origin[1] - oy, z0 = origin[2] - oz;
    for (let z = z0; z < z0 + size[2]; z++) {
      for (let x = x0; x < x0 + size[0]; x++) {
        for (let dy = 0; dy < size[1]; dy++) {
          const cls = cells.classAt(x, y0 + dy, z);
          if (cls === SOLID || cls === FLUID || cls === MACHINE) blocked++;
        }
        const below = cells.classAt(x, y0 - 1, z);
        if (below === CLEAR || below === FLUID) unsupported++;
        const t = cells.topAt(x, z);
        if (t === -1 || cells.classAt(x, t, z) === UNKNOWN) continue;
        const d = oy + t - floorY;
        if (d > 0) dig += d;
        else fill -= d;
      }
    }
  }
  return { origin, rotation, size, floorY, dig, fill, blocked, unsupported, score: 0, reason, moved: y !== at[1] };
}

/** The spot the user chose, checked against the voxels; with `vox === null` every count is 0. */
export function checkPlacement(req: SiteRequest, vox: Voxels | null, placement: { origin: Vec3; rotation: Rotation }): Site {
  return measure(req, vox, placement.origin, placement.rotation, 'placement');
}

/** The spot beside the base box (east of it, at the base floor) used when the search finds nothing, checked like a placement. */
export function fallbackSite(req: SiteRequest, vox: Voxels | null): Site {
  const { base, footprint } = req;
  const origin: Vec3 = [base.bbox.maxX + 1 + SITE_CLEARANCE, req.baseFloorY, base.center[2] - Math.floor(footprint.l / 2)];
  return measure(req, vox, origin, 0, 'fallback');
}
