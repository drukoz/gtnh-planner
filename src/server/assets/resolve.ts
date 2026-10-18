// Turns what the planner draws into textures (spec §3.8): a `BlockRef` into six faces, an item or fluid key into an
// icon, a cover item into its in-world overlay. GT's texture dump comes first, then the curated tables and the plain
// texture names of the extracted jars; whatever does not resolve gets a plain colour. Pure functions over loaded
// data: no file access.

import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import {
  FACES, hashColor, KIND_COLORS, rotateFaces,
  type BlockFaces, type CoverLayers, type Face, type IconDescriptor, type Rgb, type TextureLayer,
} from '../../shared/types/assets.ts';
import type { BlockRef, Pack } from '../../shared/types/pack.ts';
import { curatedBlock } from './curated.ts';
import { coverLayers, gtBlockFaces, gtFluidIcon, gtItemIcon, gtMachineFaces, type CopyResolver } from './gt-faces.ts';
import { iconPath, type AssetIndex } from './index.ts';
import type { TexturesDump } from './textures-dump.ts';

/** Icons rendered by NEI itself (Task 11's NEI index implements it). */
export interface IconSource { icon(key: StuffKey): TextureLayer | null }
/** All the resolver reads of a pack; a full `Pack` fits. */
export type PackView = Pick<Pack, 'items' | 'machines' | 'materials'>;
export interface AssetSources { index: AssetIndex; dump: TexturesDump | null; nei: IconSource | null; pack: PackView | null }

const GT_MACHINES = 'gregtech:gt.blockmachines';   // its item meta is the MTE id
const FLUID_PREFIX = 'fluid:';                     // as shared/keys.ts fluidKey() writes it
const CANONICAL_FACING = 2;                        // front on north
/** A copy nested deeper than this resolves to nothing, so a block that copies itself ends instead of recursing. */
const MAX_COPY_DEPTH = 4;

type Faces = Record<Face, TextureLayer[]>;
/** Canonical faces and where they came from: GT's texture dump, or the jar files (curated table or texture name). */
interface FoundFaces { faces: Faces; from: 'gt' | 'jar' }

/** A fresh RGB triple, so callers never share (or alter) the tables' arrays; drops the alpha of an RGBA. */
function rgbOf(c: readonly [number, number, number, ...number[]]): Rgb {
  return [c[0], c[1], c[2]];
}

function fluidName(key: StuffKey): string {
  return key.slice(FLUID_PREFIX.length);
}

function emptyFaces(): Faces {
  return { down: [], up: [], north: [], south: [], west: [], east: [] };
}

function allFaces(layer: TextureLayer): Faces {
  const faces = {} as Faces;
  for (const face of FACES) faces[face] = [layer];
  return faces;
}

/** Resolves a `CopyRef` at nesting level `depth` (1 = a copy in the block asked for). */
function copier(src: AssetSources, depth: number): CopyResolver {
  return (block, meta, side) => {
    const face = FACES[side];
    if (depth > MAX_COPY_DEPTH || face === undefined) return [];
    return blockFaces(src, block, meta, copier(src, depth + 1))?.faces[face] ?? [];
  };
}

/** Block steps (2)–(4): the dump's block table, the curated table, the block's texture name; first match wins. */
function blockFaces(src: AssetSources, id: string, meta: number, copy: CopyResolver): FoundFaces | null {
  const { index, dump } = src;
  const gt = dump === null ? null : gtBlockFaces(dump, id, meta, copy);
  if (gt !== null) return { faces: gt, from: 'gt' };
  const curated = curatedBlock(id, meta);
  if (curated !== null) {
    const faces = {} as Faces;
    for (const face of FACES) {
      const layer = index.firstLayer(curated.faces[face], { tint: curated.tint?.[face] });
      faces[face] = layer === null ? [] : [layer];
    }
    return { faces, from: 'jar' };
  }
  const name = dump?.textureNames.blocks.get(id);
  const layer = name === undefined ? null : index.layer(iconPath(name, 'blocks'));
  return layer === null ? null : { faces: allFaces(layer), from: 'jar' };
}

/**
 * Block step (1), the idle GT machine of `mteId`, alone: a machine the dump lacks or failed on gets nothing, never the
 * machine block's own icon (the real dump has a `gt.blockmachines` table that draws the LV hull side). A ref without
 * `mteId` takes steps (2)–(4).
 */
function refFaces(src: AssetSources, ref: BlockRef, copy: CopyResolver): FoundFaces | null {
  if (ref.mteId === undefined) return blockFaces(src, ref.id, ref.meta, copy);
  const gt = src.dump === null ? null : gtMachineFaces(src.dump, ref.mteId, copy);
  return gt === null ? null : { faces: gt, from: 'gt' };
}

/** Spec §3.8: a plain colour by machine kind, the casing colour for casings, else a stable colour per block. */
export function blockFallbackColor(ref: BlockRef, pack: PackView | null): Rgb {
  if (ref.mteId !== undefined) return rgbOf(KIND_COLORS[pack?.machines.get(ref.mteId)?.kind ?? 'other']);
  if (/casing/i.test(ref.id)) return rgbOf(KIND_COLORS.casing);
  return hashColor(`${ref.id}@${ref.meta}`);
}

/** Each block's faces turned so its front points to `facing` (ForgeDirection index, default north); same order as `refs`. */
export function resolveBlocks(src: AssetSources, refs: readonly BlockRef[], facing?: number): BlockFaces[] {
  return refs.map((ref) => {
    const found = refFaces(src, ref, copier(src, 1));
    const faces = rotateFaces(found?.faces ?? emptyFaces(), facing ?? CANONICAL_FACING);
    return {
      block: ref.mteId === undefined ? { id: ref.id, meta: ref.meta } : { id: ref.id, meta: ref.meta, mteId: ref.mteId },
      faces,
      fallbackColor: blockFallbackColor(ref, src.pack),
      resolved: FACES.every((face) => faces[face].length > 0),
    };
  });
}

/** Icon steps (1)–(5); null when nothing resolves (step 6). */
function iconLayers(src: AssetSources, key: StuffKey): { layers: TextureLayer[]; source: 'nei' | 'gt' | 'jar' } | null {
  const nei = src.nei?.icon(key) ?? null;
  if (nei !== null) return { layers: [nei], source: 'nei' };
  const { index, dump } = src;
  if (isFluidKey(key)) {
    const fluid = dump === null ? null : gtFluidIcon(dump, fluidName(key));
    return fluid !== null && fluid.layers.length > 0 ? { layers: fluid.layers, source: 'gt' } : null;
  }
  let item: { id: string; meta: number };
  try {
    item = parseItemKey(key);
  } catch {
    return null;   // malformed key: the fallback descriptor, never an error for the whole request
  }
  if (dump !== null) {
    const gt = gtItemIcon(dump, index, key);
    if (gt !== null) return { layers: gt, source: 'gt' };
    const name = dump.textureNames.items.get(item.id);
    const layer = name === undefined ? null : index.layer(iconPath(name, 'items'));
    if (layer !== null) return { layers: [layer], source: 'jar' };
  }
  const ref: BlockRef = item.id === GT_MACHINES ? { id: item.id, meta: item.meta, mteId: item.meta } : { id: item.id, meta: item.meta };
  const block = refFaces(src, ref, copier(src, 1));
  if (block === null) return null;
  const layers = block.faces.north.length > 0 ? block.faces.north : block.faces.up;
  return layers.length === 0 ? null : { layers, source: block.from };
}

/**
 * The colour a client paints while the icon loads or when it has none: a fluid's dump colour, an item's GT material
 * colour (pack first, then the dump's material of that name), else a stable colour per key.
 */
export function iconFallbackColor(key: StuffKey, src: AssetSources): Rgb {
  if (isFluidKey(key)) {
    const color = src.dump?.fluids.get(fluidName(key))?.color;
    return color === undefined ? hashColor(key) : rgbOf(color);
  }
  const material = src.pack?.items.get(key)?.gt?.material;
  if (material !== undefined) {
    const color = src.pack?.materials.get(material)?.rgba ?? src.dump?.materialsByName.get(material)?.rgb;
    if (color !== undefined) return rgbOf(color);
  }
  return hashColor(key);
}

/** One icon per key, same order (duplicates kept). */
export function resolveIcons(src: AssetSources, keys: readonly StuffKey[]): IconDescriptor[] {
  return keys.map((key) => {
    const found = iconLayers(src, key);
    const fallbackColor = iconFallbackColor(key, src);
    return found === null ? { key, layers: [], source: 'fallback', fallbackColor } : { key, layers: found.layers, source: found.source, fallbackColor };
  });
}

/**
 * GT's in-world overlay of each cover item (architecture §11.14), same order; `layers` is empty without a dump or for
 * an item that is not a cover, and the 3D view then draws the item icon.
 */
export function resolveCovers(src: AssetSources, items: readonly StuffKey[]): CoverLayers[] {
  return items.map((item) => ({ item, layers: (src.dump === null ? null : coverLayers(src.dump, item, copier(src, 1))) ?? [] }));
}
