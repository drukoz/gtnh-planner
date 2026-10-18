// GregTech's own textures (research §6.1-§6.2) read from the loaded dump: machine, casing and block faces, cover
// overlays, material and meta-item icons, and fluids. A face layer that copies another block is resolved by the
// caller's `CopyResolver`, which owns the cycle guard (Task 10).

import { parseItemKey, type ItemKey } from '../../shared/keys.ts';
import { FACES, type Face, type Rgb, type TextureLayer } from '../../shared/types/assets.ts';
import type { AssetIndex } from './index.ts';
import { textureSetLayers, type FaceLayer, type ResolvedFaces, type TexturesDump } from './textures-dump.ts';

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
  const out: TextureLayer[] = [];
  for (const layer of list) {
    if ('ts' in layer) {
      out.push(...textureSetLayers(layer.ts, material.rgb, index));
    } else if ('p' in layer) {
      const found = index.firstLayer(layer.p, { tint: out.length === 0 ? material.rgb : undefined, glow: layer.glow === 1 });
      if (found !== null) out.push(found);
    }
  }
  return out.length === 0 ? null : out;
}

/** The fluid's colour and tinted still texture (`layers` is empty for a fluid without one); null for an unknown fluid. */
export function gtFluidIcon(dump: TexturesDump, name: string): { layers: TextureLayer[]; color: Rgb } | null {
  const fluid = dump.fluids.get(name);
  return fluid === undefined ? null : { layers: fluid.still === null ? [] : [fluid.still], color: fluid.color };
}
