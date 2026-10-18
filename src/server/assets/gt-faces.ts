// GregTech's own textures (research §6.1-§6.2) read from the loaded dump: machine, casing, block and ore-block faces,
// cover overlays, material and meta-item icons, and fluids. A face layer that copies another block is resolved by the
// caller's `CopyResolver`, which owns the cycle guard (Task 10).

import { parseItemKey, type ItemKey } from '../../shared/keys.ts';
import { FACES, type Face, type Rgb, type TextureLayer } from '../../shared/types/assets.ts';
import type { AssetIndex } from './index.ts';
import { textureSetLayers, type DumpLayer, type FaceLayer, type ResolvedFaces, type TexturesDump } from './textures-dump.ts';

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

export function gtBlockFaces(dump: TexturesDump, id: string, meta: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null {
  const faces = dump.blocks.get(id)?.get(meta);
  return faces === undefined ? null : facesFrom(faces, copy);
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

/** Material items (`meta < offset`) from the texture set, and numbered meta items from `<unlocalized>/<n>.png`; null when nothing resolves. */
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
    const base = `gregtech/textures/items/${item.unlocalized}/${n}`;
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

/** The fluid's colour and tinted still texture (`layers` is empty for a fluid without one); null for an unknown fluid. */
export function gtFluidIcon(dump: TexturesDump, name: string): { layers: TextureLayer[]; color: Rgb } | null {
  const fluid = dump.fluids.get(name);
  return fluid === undefined ? null : { layers: fluid.still === null ? [] : [fluid.still], color: fluid.color };
}
