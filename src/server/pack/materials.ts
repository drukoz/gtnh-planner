// Material converters (architecture §6.2, §11.4): the lines of materials.jsonl.gz (GT materials) and
// ore-materials.jsonl.gz (the ore materials of GT, BartWorks and GT++) become the pack's `GtMaterial`s, plus the map
// from ore-material keys (`gt:Iron`, `bw:Prasiolite`, `gtpp:Iron`) to material names that worldgen.ts uses.
//
// Item indices go through `LoadContext.items`; load.ts checks every index of a line before the line gets here, so an
// index that points nowhere fails with its file and line.

import type { ItemKey } from '../../shared/keys.ts';
import type { GtMaterial, OrePart } from '../../shared/types/pack.ts';
import { EXPORT_FILES, type MaterialLine, type OreMaterialLine } from './format.ts';
import type { LoadContext } from './load.ts';

/** Colour and icon set of an ore material whose line has none. */
const DEFAULT_RGBA: GtMaterial['rgba'] = [255, 255, 255, 0];
const DEFAULT_ICON_SET = 'NONE';

type Rgba = GtMaterial['rgba'];
type Parts = NonNullable<GtMaterial['parts']>;

function rgbaOf(c: Readonly<Rgba>): Rgba {
  return [c[0], c[1], c[2], c[3]];
}

/**
 * Turns material keys into names through `nameOfKey`. An unknown key becomes its part after the first ':' (the
 * whole key when it has none) and warns once per key, naming the key and its first user.
 */
export function materialNameResolver(nameOfKey: ReadonlyMap<string, string>, warn: (message: string) => void): (key: string, usedBy: string) => string {
  const warned = new Set<string>();
  return (key, usedBy) => {
    const name = nameOfKey.get(key);
    if (name !== undefined) return name;
    const fallback = key.slice(key.indexOf(':') + 1);
    if (!warned.has(key)) {
      warned.add(key);
      warn(`${usedBy}: unknown material key ${key}, using the name ${fallback}`);
    }
    return fallback;
  };
}

function gtMaterial(line: MaterialLine): GtMaterial {
  const material: GtMaterial = {
    name: line.name, rgba: rgbaOf(line.rgba), iconSet: line.iconSet, oreByproducts: [...line.byproducts], displayName: line.dn || line.name,
  };
  if (line.oreMultiplier != null) material.oreMultiplier = line.oreMultiplier;
  if (line.byproductMultiplier != null) material.byproductMultiplier = line.byproductMultiplier;
  return material;
}

/** The item key of each ore part (a wildcard index gives its first option). */
function partKeys(parts: OreMaterialLine['parts'], ctx: LoadContext): Parts {
  const keys: Parts = {};
  for (const [part, i] of Object.entries(parts) as Array<[OrePart, number]>) keys[part] = ctx.items.optionsAt(i)[0] as ItemKey;
  return keys;
}

/** A material that only the ore line describes; its byproducts are filled once every ore key is known. */
function oreMaterial(line: OreMaterialLine, name: string, parts: Parts): GtMaterial {
  return {
    name, rgba: rgbaOf(line.rgba ?? DEFAULT_RGBA), iconSet: line.iconSet || DEFAULT_ICON_SET, oreByproducts: [],
    key: line.key, family: line.family, displayName: line.dn || line.name, parts,
  };
}

/**
 * GT materials by name, then the ore materials in file order: a `gt` ore line adds its key, family and parts to the
 * GT material of its name (or creates the material); a `bw`/`gtpp` line, or a `gt` line whose name a non-GT material
 * already holds, creates a material named after the line, or after its key when that name is taken. Byproducts of
 * created materials are ore keys, turned into names once every line is known. Duplicates warn; the first line wins.
 */
export function buildMaterials(gt: readonly MaterialLine[], ores: readonly OreMaterialLine[], ctx: LoadContext): { materials: Map<string, GtMaterial>; nameOfKey: Map<string, string> } {
  const warn = (message: string): void => ctx.warn(message);
  const materials = new Map<string, GtMaterial>();
  gt.forEach((line, n) => {
    if (materials.has(line.name)) warn(`${EXPORT_FILES.materials}:${n + 1}: duplicate material ${line.name} ignored, the first line wins`);
    else materials.set(line.name, gtMaterial(line));
  });

  const nameOfKey = new Map<string, string>();
  const created: Array<{ material: GtMaterial; line: OreMaterialLine }> = [];
  ores.forEach((line, n) => {
    const where = `${EXPORT_FILES.oreMaterials}:${n + 1}`;
    if (nameOfKey.has(line.key)) {
      warn(`${where}: duplicate ore material ${line.key} ignored, the first line wins`);
      return;
    }
    const parts = partKeys(line.parts, ctx);
    const existing = materials.get(line.name);
    if (line.family === 'gt' && existing !== undefined && existing.key === undefined) {
      Object.assign(existing, { key: line.key, family: line.family, parts });
      nameOfKey.set(line.key, existing.name);
      return;
    }
    const name = existing === undefined ? line.name : line.key;
    if (materials.has(name)) {
      warn(`${where}: ore material ${line.key} ignored, the names ${line.name} and ${line.key} are both taken`);
      return;
    }
    const material = oreMaterial(line, name, parts);
    materials.set(name, material);
    nameOfKey.set(line.key, name);
    created.push({ material, line });
  });

  const nameOf = materialNameResolver(nameOfKey, warn);
  for (const { material, line } of created) material.oreByproducts = line.byproducts.map((key) => nameOf(key, `ore material ${line.key}`));
  return { materials, nameOfKey };
}
