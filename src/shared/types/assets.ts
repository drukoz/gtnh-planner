import type { BlockRef, MachineKind } from './pack.ts';
import type { StuffKey } from '../keys.ts';

export type Rgb = [number, number, number];
/** `[x, y, w, h]`. */
export type Rect = [number, number, number, number];
/**
 * Part of a texture drawn into part of the tile (architecture §11.43 (b)): `src` in pixels of a sheet `sheet` pixels
 * wide (scaled to the file's real width), `dst` in sixteenths of the tile (default the whole tile).
 */
export interface LayerRegion { sheet: number; src: Rect; dst?: Rect }
export interface TextureLayer { path: string /* data/assets-relative, e.g. "gregtech/textures/blocks/iconsets/MACHINE_MV_SIDE.png" */; tint?: [number, number, number]; glow?: boolean; frames?: number; region?: LayerRegion }
export type Face = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
/**
 * A block drawn as a core with arms (architecture §11.43 (c)): `core` on the middle box, `arm` on an arm's long faces
 * (u along the arm), `end` on an arm's tip.
 */
export interface PipeLayers { core: TextureLayer[]; arm: TextureLayer[]; end: TextureLayer[] }
export interface BlockFaces { block: BlockRef; faces: Record<Face, TextureLayer[]>; fallbackColor: [number, number, number]; resolved: boolean; pipe?: PipeLayers }
export interface IconDescriptor { key: StuffKey; layers: TextureLayer[]; source: 'nei' | 'gt' | 'jar' | 'fallback'; fallbackColor: [number, number, number] }

/** A GT cover's in-world overlay. */
export interface CoverLayers { item: StuffKey; layers: TextureLayer[] }

/** ForgeDirection order 0..5. */
export const FACES: readonly Face[] = ['down', 'up', 'north', 'south', 'west', 'east'];

/** A region's `dst` is in sixteenths of the tile. */
const TILE_SIXTEENTHS = 16;

/**
 * Where `layer` goes in a `size`×`size` tile, in pixels: its region's `dst`, else the whole tile, scaled from
 * sixteenths to `size`; each value rounded, the width and height at least 1.
 */
export function regionRect(layer: TextureLayer, size: number): Rect {
  const [x, y, w, h] = layer.region?.dst ?? [0, 0, TILE_SIXTEENTHS, TILE_SIXTEENTHS];
  const px = (v: number): number => Math.round((v * size) / TILE_SIXTEENTHS);
  return [px(x), px(y), Math.max(1, px(w)), Math.max(1, px(h))];
}

/** What an image cache keys a layer by (architecture §11.43 (b)): its path, plus `#` and its region's JSON when it has one. */
export function layerKey(layer: TextureLayer): string {
  return layer.region === undefined ? layer.path : `${layer.path}#${JSON.stringify(layer.region)}`;
}

// Result face <- canonical face, per facing (canonical front is north).
const FACING_MAPS: Record<number, Partial<Record<Face, Face>>> = {
  2: {},
  3: { north: 'south', south: 'north', west: 'east', east: 'west' },
  4: { west: 'north', south: 'west', east: 'south', north: 'east' },
  5: { east: 'north', south: 'east', west: 'south', north: 'west' },
  0: { down: 'north', south: 'down', up: 'south', north: 'up' },
  1: { up: 'north', south: 'up', down: 'south', north: 'down' },
};

/** Turns canonical faces (front on north) so the front points to `facing`. Returns a new object. */
export function rotateFaces<T>(faces: Record<Face, T>, facing: number): Record<Face, T> {
  const map = FACING_MAPS[facing] ?? {};
  const out = { ...faces };
  for (const face of FACES) {
    const from = map[face];
    if (from) out[face] = faces[from];
  }
  return out;
}

/** The four sides of a block; canonical north is its front. */
const SIDES: readonly Face[] = ['north', 'south', 'west', 'east'];

/**
 * Whether two JSON values are deeply equal, a property holding `undefined` counting as absent: a layer compares the same
 * before and after it travels as JSON, so the server and the client orient the same faces alike.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>): string[] => Object.keys(o).filter((key) => o[key] !== undefined);
  const leftKeys = keys(left);
  return leftKeys.length === keys(right).length && leftKeys.every((key) => sameJson(left[key], right[key]));
}

/** A fresh copy of `layer`: its tint and its region's rectangles are copied too, so a copy never shares an array. */
function copyLayer(layer: TextureLayer): TextureLayer {
  const out: TextureLayer = { ...layer };
  if (layer.tint !== undefined) out.tint = [...layer.tint];
  if (layer.region !== undefined) {
    out.region = { ...layer.region, src: [...layer.region.src] };
    if (layer.region.dst !== undefined) out.region.dst = [...layer.region.dst];
  }
  return out;
}

type FaceLayers = Readonly<Record<Face, readonly TextureLayer[]>>;

/**
 * The world sides of a block facing up (1) or down (0) that GT draws by world side, as `MTEBasicMachine.getTexture`
 * does with a vertical main facing: the facing side its own hull layer under the front's (canonical north's) overlays,
 * world north its hull alone, every other side its own canonical layers, overlays included. Null for any other
 * facing, or unless the four sides are non-empty with deep-equal first layers (the hull) and the top and bottom have
 * layers.
 */
function hullBySide(faces: FaceLayers, facing: number): FaceLayers | null {
  const front: Face | null = facing === 0 ? 'down' : facing === 1 ? 'up' : null;
  if (front === null) return null;
  const hull = faces.north[0];
  const own = faces[front][0];
  if (hull === undefined || own === undefined || faces.down.length === 0 || faces.up.length === 0) return null;
  if (!SIDES.every((side) => faces[side].length > 0 && sameJson(faces[side][0], hull))) return null;
  const sides = {} as Record<Face, readonly TextureLayer[]>;
  for (const face of FACES) sides[face] = face === front ? [own, ...faces.north.slice(1)] : face === 'north' ? [hull] : faces[face];
  return sides;
}

/**
 * Canonical faces (front on north) as the world sides of a block whose front points to `facing` show them (architecture
 * §11.43 (j)): facing up or down, a block whose four sides share their first layer keeps each world side's own layers
 * and only its front's overlays move (`hullBySide`); any other block turns whole (`rotateFaces`). Always fresh arrays of
 * layer copies.
 */
export function orientFaces(faces: Readonly<Record<Face, readonly TextureLayer[]>>, facing: number): Record<Face, TextureLayer[]> {
  const shown = hullBySide(faces, facing) ?? rotateFaces(faces, facing);
  const out = {} as Record<Face, TextureLayer[]>;
  for (const face of FACES) out[face] = shown[face].map(copyLayer);
  return out;
}

/** Stable colour for anything without a texture: FNV-1a hue, HSL(hue, 45%, 55%). */
export function hashColor(s: string): Rgb {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = h % 360;
  const sat = 0.45;
  const light = 0.55;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [f(0), f(8), f(4)];
}

/** Spec §3.8 fallback: plain colour by machine kind. */
export const KIND_COLORS: Readonly<Record<MachineKind, Rgb>> = {
  basic: [96, 125, 139],
  multiblock: [69, 90, 100],
  steam: [176, 124, 72],
  generator: [251, 140, 0],
  boiler: [191, 90, 40],
  turbine: [120, 144, 156],
  battery_buffer: [67, 160, 71],
  transformer: [142, 36, 170],
  cable: [66, 66, 66],
  fluid_pipe: [30, 136, 229],
  item_pipe: [255, 179, 0],
  hatch: [121, 85, 72],
  casing: [158, 158, 158],
  other: [117, 117, 117],
};

/** Forge Multipart part, e.g. 'pr_rinterface'. */
export function partBlockRef(partId: string): BlockRef { return { id: `fmp:${partId}`, meta: 0 }; }
/** EnderIO conduit type. */
export function conduitBlockRef(type: string): BlockRef { return { id: `conduit:${type}`, meta: 0 }; }
/** AE2 cable by centre kind: 'glass' | 'covered' | 'smart' | 'dense' | 'dense_covered'. */
export function ae2CableBlockRef(center: string): BlockRef { return { id: `ae2cable:${center}`, meta: 0 }; }
