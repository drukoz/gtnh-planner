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
export interface BlockFaces { block: BlockRef; faces: Record<Face, TextureLayer[]>; fallbackColor: [number, number, number]; resolved: boolean }
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
