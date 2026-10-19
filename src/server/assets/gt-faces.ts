// GregTech's own textures (research §6.1-§6.2) read from the loaded dump: machine, casing, block and ore-block faces,
// cover overlays, material and meta-item icons, fluids, and the material templates GT computes from material data
// (frames, sheetmetal, storage blocks, metaitem.98/99 and BartWorks items, by the pack's `gt {prefix, material}`). A
// face layer that copies another block is resolved by the caller's `CopyResolver`, which owns the cycle guard (Task 10).

import { isFluidKey, parseItemKey, type ItemKey } from '../../shared/keys.ts';
import { FACES, type Face, type Rgb, type TextureLayer } from '../../shared/types/assets.ts';
import { iconDomain, type AssetIndex } from './index.ts';
import type { PackView } from './resolve.ts';
import { textureSetLayers, type DumpLayer, type FaceLayer, type ResolvedFaces, type TexturesDump } from './textures-dump.ts';

const FRAMES = new Set(['gregtech:gt.blockframes', 'gregtech:bw.frames']);
const SHEETMETAL = new Set(['gregtech:gt.sheetmetal', 'gregtech:bw.sheetmetal']);
/** `BlockMetal`'s blocks of material (`gt.blockmetal1…9`, `gt.blockgem1…3`), each drawn with its `BLOCK_<MATERIAL>` icon. */
const STORAGE_BLOCK = /^gregtech:gt\.block(?:metal|gem)\d+$/;
const STORAGE_ICON = 'gregtech/textures/blocks/iconsets/BLOCK_';
/** Meta items whose icon is the material set's icon of their prefix (`MetaGeneratedItem99.getIconContainer`). */
const TEMPLATE_ITEM = 'gregtech:gt.metaitem.99';
const BARTWORKS_ITEM = 'bartworks:gt.bwMetaGenerated';
/** GT's cells of other mods' fluids (`MetaGeneratedItem98`), every one drawn as the `FLUID` set's `cell` icon. */
const FLUID_CELL = 'gregtech:gt.metaitem.98';
const FLUID_SET = 'FLUID';
const CELL_PREFIX = 'cell';
const FLUID_PREFIX = 'fluid:';   // as shared/keys.ts fluidKey() writes it

/** The faces of block `block` meta `meta` on `side` (ForgeDirection index), for a `copy` layer. */
export type CopyResolver = (block: string, meta: number, side: number) => TextureLayer[];

function layersFrom(list: readonly FaceLayer[], copy: CopyResolver): TextureLayer[] {
  const out: TextureLayer[] = [];
  for (const layer of list) {
    if ('copy' in layer) out.push(...copy(layer.copy[0], layer.copy[1], layer.copy[2]));
    else out.push(layer);
  }
  return out;
}

/** The six face lists with every `CopyRef` replaced by what `copy` gives. */
export function facesFrom(faces: ResolvedFaces, copy: CopyResolver): Record<Face, TextureLayer[]> {
  const out = {} as Record<Face, TextureLayer[]>;
  FACES.forEach((face, side) => { out[face] = layersFrom(faces[side] ?? [], copy); });
  return out;
}

/** A machine's canonical faces (front on north); null when the dump lacks it or the exporter failed on it. */
export function gtMachineFaces(dump: TexturesDump, mteId: number, copy: CopyResolver, active = false): Record<Face, TextureLayer[]> | null {
  const mte = dump.mte.get(mteId);
  if (mte === undefined || mte.error !== undefined) return null;
  const faces = active ? mte.active : mte.inactive;
  return faces === null ? null : facesFrom(faces, copy);
}

/**
 * A block's faces from the dump's block table. Null when the table lacks the meta, or when its six lists are all empty
 * after dropped and error layers (copies not yet followed): those faces would shadow the block's texture name (RC17).
 */
export function gtBlockFaces(dump: TexturesDump, id: string, meta: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null {
  const faces = dump.blocks.get(id)?.get(meta);
  return faces === undefined || faces.every((list) => list.length === 0) ? null : facesFrom(faces, copy);
}

/**
 * A GT ore block as `GTBlockOre.getTextures` draws it: on every face its stone (the stone block's down face, which
 * `StoneType.getTexture(0)` copies) under the material's ore icon, tinted with the material colour and full-bright for a
 * glowing ore; a small ore uses the small-ore icon. The meta splits like `getStoneIndex`, `getMaterialIndex` and
 * `isSmallOre`. A stone without a texture leaves the ore icon alone. Null when the dump has no such block, stone index
 * or material, or the material's set has no ore icon (the stone alone would not show which ore it is).
 */
export function gtOreFaces(dump: TexturesDump, index: AssetIndex, id: string, meta: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null {
  const ores = dump.ores;
  const stones = ores?.blocks.get(id);
  if (ores === null || stones === undefined || !Number.isInteger(meta) || meta < 0) return null;
  const stone = stones[Math.floor(((meta % ores.smallOffset) % ores.naturalOffset) / 1000)];
  const material = dump.materialsById.get(meta % 1000);
  if (stone === undefined || material === undefined) return null;
  const icon = dump.sets[material.set]?.get(meta >= ores.smallOffset ? ores.oreSmall : ores.ore);
  const ore = icon === undefined ? [] : setIconLayers(icon, material.rgb, index, material.oreGlow === true);
  if (ore.length === 0) return null;
  const layers = [...layersFrom(stone, copy), ...ore];
  const faces = {} as Record<Face, TextureLayer[]>;
  for (const face of FACES) faces[face] = [...layers];
  return faces;
}

/** A casing page of `gt.blockmachines`-style ids (`page << 7 | index`). */
export function casingFaces(dump: TexturesDump, casingId: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null {
  const faces = dump.casingPages.get(casingId);
  return faces === undefined ? null : facesFrom(faces, copy);
}

export function coverLayers(dump: TexturesDump, item: ItemKey, copy: CopyResolver): TextureLayer[] | null {
  let name: string;
  try {
    const parsed = parseItemKey(item);
    name = `${parsed.id}@${parsed.meta}`;
  } catch {
    return null;
  }
  const layers = dump.covers.get(name);
  return layers === undefined ? null : layersFrom(layers, copy);
}

/**
 * Material items (`meta < offset`) from the texture set, and numbered meta items from `<unlocalized>/<n>.png` in the
 * item's own domain (its mod id lower-cased: GGFab's `gt.ggfab.d1` icons are GGFab's); null when nothing resolves.
 */
export function gtItemIcon(dump: TexturesDump, index: AssetIndex, key: ItemKey): TextureLayer[] | null {
  let parsed: { id: string; meta: number };
  try {
    parsed = parseItemKey(key);
  } catch {
    return null;
  }
  const item = dump.metaItems.get(parsed.id);
  if (item === undefined) return null;
  if (parsed.meta >= item.offset) {
    const n = parsed.meta - item.offset;
    const base = `${iconDomain(parsed.id)}/textures/items/${item.unlocalized}/${n}`;
    const found = index.firstLayer([`${base}.png`, `${base}/0.png`, `${base}/1.png`]);
    return found === null ? null : [found];
  }
  const prefix = item.prefixes.get(Math.floor(parsed.meta / 1000));
  const material = dump.materialsById.get(parsed.meta % 1000);
  if (prefix === undefined || material === undefined) return null;
  const list = dump.sets[material.set]?.get(prefix.texture);
  if (list === undefined) return null;
  const out = setIconLayers(list, material.rgb, index);
  return out.length === 0 ? null : out;
}

/**
 * The layers of one texture-set icon: a `ts` layer by the texture-set rule (base tinted with `rgb`), a `p` layer
 * tinted when it is the first one drawn (a custom-alpha icon's base; its overlay stays untinted). `glow` makes every
 * layer full-bright.
 */
function setIconLayers(list: readonly DumpLayer[], rgb: Rgb, index: AssetIndex, glow = false): TextureLayer[] {
  const out: TextureLayer[] = [];
  for (const layer of list) {
    if ('ts' in layer) {
      for (const found of textureSetLayers(layer.ts, rgb, index)) out.push(glow ? { ...found, glow: true } : found);
    } else if ('p' in layer) {
      const found = index.firstLayer(layer.p, { tint: out.length === 0 ? rgb : undefined, glow: glow || layer.glow === 1 });
      if (found !== null) out.push(found);
    }
  }
  return out;
}

/**
 * What GT draws for `prefix` of `material` (by name): the material's texture set's icon at the prefix's texture index,
 * in the material's colour. Null when the dump lacks the prefix's index, the material, its set or that icon, or when
 * none of the icon's files was extracted.
 */
export function materialTemplate(dump: TexturesDump, index: AssetIndex, prefix: string, material: string): TextureLayer[] | null {
  const texture = dump.prefixTextures.get(prefix);
  const found = dump.materialsByName.get(material);
  if (texture === undefined || found === undefined) return null;
  const list = dump.sets[found.set]?.get(texture);
  if (list === undefined) return null;
  const out = setIconLayers(list, found.rgb, index);
  return out.length === 0 ? null : out;
}

/**
 * A GT material block, by the material the pack gives its item (`gt.material`), the same on all six faces: frame
 * boxes their `frameGt` template, sheetmetal its `sheetmetal` template, storage blocks their own untinted
 * `BLOCK_<MATERIAL>` icon (`BlockMetal.mBlockIcons`). Null for any other block, a block without a pack material, or
 * one whose texture does not resolve.
 */
export function gtMaterialBlockFaces(dump: TexturesDump, index: AssetIndex, pack: PackView | null, id: string, meta: number): Record<Face, TextureLayer[]> | null {
  const material = pack?.items.get(`${id}@${meta}`)?.gt?.material;
  const layers = material === undefined ? null : materialBlockLayers(dump, index, id, material);
  if (layers === null) return null;
  const faces = {} as Record<Face, TextureLayer[]>;
  for (const face of FACES) faces[face] = [...layers];
  return faces;
}

/** Every face's layers of material block `id` in `material`; null for another block or when nothing resolves. */
function materialBlockLayers(dump: TexturesDump, index: AssetIndex, id: string, material: string): TextureLayer[] | null {
  if (FRAMES.has(id)) return materialTemplate(dump, index, 'frameGt', material);
  if (SHEETMETAL.has(id)) return materialTemplate(dump, index, 'sheetmetal', material);
  if (!STORAGE_BLOCK.test(id)) return null;
  const icon = index.layer(`${STORAGE_ICON}${material.toUpperCase()}.png`);
  return icon === null ? null : [icon];
}

/**
 * The icons GT builds from a material template instead of its own file: `gt.metaitem.99` and BartWorks' generated
 * items by the pack's `gt {prefix, material}` (`MetaGeneratedItem99.getIconContainer`: the material set's icon of the
 * prefix), and `gt.metaitem.98` cells (`fluidCellIcon`). Null for any other item or when nothing resolves.
 */
export function gtTemplateIcon(dump: TexturesDump, index: AssetIndex, pack: PackView | null, key: ItemKey): TextureLayer[] | null {
  let parsed: { id: string; meta: number };
  try {
    parsed = parseItemKey(key);
  } catch {
    return null;
  }
  const item = `${parsed.id}@${parsed.meta}`;
  if (parsed.id === FLUID_CELL) return fluidCellIcon(dump, index, pack, item);
  if (parsed.id !== TEMPLATE_ITEM && !parsed.id.startsWith(BARTWORKS_ITEM)) return null;
  const gt = pack?.items.get(item)?.gt;
  return gt === undefined ? null : materialTemplate(dump, index, gt.prefix, gt.material);
}

/**
 * A `gt.metaitem.98` cell: the `FLUID` set's `cell` icon, in the colour the dump gives the fluid its
 * `Pack.fluidContainers` row holds. `MetaGeneratedItem98` draws every one of its cells with a prefix of Water's `FLUID`
 * set, `cell` for its 1000 L and 144 L cells; it has no molten or plasma cell, so the amount never picks another icon.
 * Null without that row, the fluid's colour, the set or the icon's files.
 */
function fluidCellIcon(dump: TexturesDump, index: AssetIndex, pack: PackView | null, container: ItemKey): TextureLayer[] | null {
  const fluid = pack?.fluidContainers?.find((row) => row.container === container)?.fluid;
  const color = fluid !== undefined && isFluidKey(fluid) ? dump.fluids.get(fluid.slice(FLUID_PREFIX.length))?.color : undefined;
  const texture = dump.prefixTextures.get(CELL_PREFIX);
  const list = texture === undefined ? undefined : dump.sets[dump.setNames.indexOf(FLUID_SET)]?.get(texture);
  if (color === undefined || list === undefined) return null;
  const out = setIconLayers(list, color, index);
  return out.length === 0 ? null : out;
}

/** The fluid's colour and tinted still texture (`layers` is empty for a fluid without one); null for an unknown fluid. */
export function gtFluidIcon(dump: TexturesDump, name: string): { layers: TextureLayer[]; color: Rgb } | null {
  const fluid = dump.fluids.get(name);
  return fluid === undefined ? null : { layers: fluid.still === null ? [] : [fluid.still], color: fluid.color };
}
