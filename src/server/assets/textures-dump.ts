// `textures.json.gz`: the GT texture data the exporter mod's `TextureExporter` section writes into an export (Task 6),
// joined to the extracted files of `data/assets/index.json` (Task 2). Every face layer is checked against the index
// once, at load time: a layer whose file was not extracted (pack upgraded, export not re-run) is dropped and counted,
// so nothing downstream ever names a file the server cannot serve.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { Rgb, TextureLayer } from '../../shared/types/assets.ts';
import { EXPORT_FILES } from '../pack/format.ts';
import type { AssetIndex } from './index.ts';

export const TEXTURES_FILE = 'textures.json.gz';
export const TEXTURES_FORMAT = 'gtnh-planner-textures/1';

/** The exporter's section name, as `manifest.json` lists it in `failedSections` / `skippedSections`. */
const TEXTURES_SECTION = 'textures';

const gunzipAsync = promisify(gunzip);

// --- wire format (Task 6, verbatim) ---

export type DumpLayer =
  | { p: string[]; rgb?: [number, number, number]; glow?: 1 }                  // candidate data/assets-relative paths, first extracted one wins
  | { ts: [string, string, string, string]; rgb?: [number, number, number] }   // GT texture set: base, base fallback, overlay, overlay fallback ('' = none)
  | { copy: [string, number, number] }                                         // looks like block <registry name> meta <m> on face <side 0..5>
  | { err: string };                                                           // texture class the exporter could not read
export type DumpFaces = DumpLayer[][];                                         // 6 lists, ForgeDirection order
export interface TexturesDumpFile {
  format: 'gtnh-planner-textures/1'; exporterVersion: string;
  sets: Array<{ name: string; icons: Record<string /* texture index */, DumpLayer[]> }>;
  materials: Array<{ name: string; id: number /* mMetaItemSubID */; rgba: [number, number, number, number]; set: number /* index into sets */ }>;
  metaItems: Array<{ id: string /* registry name */; offset: number; unlocalized: string; prefixes: Array<{ i: number /* meta / 1000 */; prefix: string; texture: number }> }>;
  mte: Array<{ id: number; cls: string; pipe?: true; inactive?: DumpFaces; active?: DumpFaces /* omitted when equal to inactive */; error?: string }>;
  casingPages: Array<{ id: number /* page << 7 | index */; faces: DumpFaces }>;
  blocks: Array<{ id: string; metas: Record<string /* meta */, DumpFaces> }>;
  covers: Array<{ item: string /* registry@meta */; layers: DumpLayer[] }>;
  fluids: Array<{ name: string; color: number /* Fluid.getColor(), 0xAARRGGBB as a signed int */; still?: string }>;
  textureNames: { blocks: Record<string, string>; items: Record<string, string> };   // registry name → Block.textureName / Item.iconString
  blockIds: string[];                                                            // every block registry name, sorted
  stats: Record<string, number>;                                                 // counts per part, '<part>Failed', 'unknown:<class>'
}

// --- the loaded dump ---

export interface CopyRef { copy: [string, number, number] }               // block registry name, meta, side
export type FaceLayer = TextureLayer | CopyRef;
export type ResolvedFaces = FaceLayer[][];                                 // 6 lists, ForgeDirection order
export interface DumpMte { cls: string; pipe: boolean; inactive: ResolvedFaces | null; active: ResolvedFaces | null; error?: string }
export interface DumpMaterial { name: string; id: number; rgb: Rgb; set: number }
export interface DumpStats { droppedLayers: number; errorLayers: number }
export interface TexturesDump {
  exporterVersion: string;
  sets: Array<Map<number, DumpLayer[]>>;                                  // raw: the tint comes from the material at lookup time (Task 8)
  materialsById: Map<number, DumpMaterial>; materialsByName: Map<string, DumpMaterial>;
  metaItems: Map<string, { offset: number; unlocalized: string; prefixes: Map<number, { prefix: string; texture: number }> }>;
  mte: Map<number, DumpMte>; casingPages: Map<number, ResolvedFaces>; blocks: Map<string, Map<number, ResolvedFaces>>;
  covers: Map<string, FaceLayer[]>; fluids: Map<string, { color: Rgb; still: TextureLayer | null }>;
  textureNames: { blocks: Map<string, string>; items: Map<string, string> }; blockIds: Set<string>; stats: DumpStats;
}

/** `textures.json.gz` cannot be read, is not gzip'd JSON, or was not written by this version of the exporter. */
export class TexturesDumpError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TexturesDumpError';
  }
}

/**
 * GT's client rule for a texture set (research §6.1): base = `ts[0]` when extracted (override), else `ts[1]` when
 * extracted (fallback); overlay likewise from `ts[2]` / `ts[3]`. An override base drops a fallback overlay and an
 * override overlay drops a fallback base. The base is tinted with `rgb`, the overlay never is. `''` names no file.
 */
export function textureSetLayers(ts: readonly [string, string, string, string], rgb: Rgb | undefined, index: AssetIndex): TextureLayer[] {
  const pick = (override: string, fallback: string, opts?: { tint?: Rgb }): { layer: TextureLayer; override: boolean } | null => {
    const first = override === '' ? null : index.layer(override, opts);
    if (first !== null) return { layer: first, override: true };
    const second = fallback === '' ? null : index.layer(fallback, opts);
    return second === null ? null : { layer: second, override: false };
  };
  let base = pick(ts[0], ts[1], rgb === undefined ? undefined : { tint: rgb });
  let overlay = pick(ts[2], ts[3]);
  if (base !== null && overlay !== null && base.override !== overlay.override) {
    if (base.override) overlay = null;
    else base = null;
  }
  const out: TextureLayer[] = [];
  if (base !== null) out.push(base.layer);
  if (overlay !== null) out.push(overlay.layer);
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown, length?: number): value is string[] {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every((v) => typeof v === 'string');
}

function isRgbOrAbsent(value: unknown): value is Rgb | undefined {
  return value === undefined || (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number'));
}

/**
 * Joins dump layers to the extracted files: `p` → the first extracted candidate, `ts` → `textureSetLayers`, `copy` →
 * kept as a `CopyRef` (resolved later by whoever knows the block tables). A layer whose file is missing counts in
 * `droppedLayers`; an `err` layer, a `copy` without a block name (the exporter writes null when it cannot name the
 * block) and any layer of unknown shape count in `errorLayers`. Both kinds are left out.
 */
export function resolveDumpLayers(layers: readonly DumpLayer[], index: AssetIndex, stats: DumpStats): FaceLayer[] {
  const out: FaceLayer[] = [];
  for (const layer of layers as readonly unknown[]) {
    if (!isPlainObject(layer)) {
      stats.errorLayers++;
    } else if (layer.p !== undefined) {
      if (!isStrings(layer.p) || !isRgbOrAbsent(layer.rgb)) { stats.errorLayers++; continue; }
      const found = index.firstLayer(layer.p, { tint: layer.rgb, glow: layer.glow === 1 });
      if (found === null) stats.droppedLayers++;
      else out.push(found);
    } else if (layer.ts !== undefined) {
      if (!isStrings(layer.ts, 4) || !isRgbOrAbsent(layer.rgb)) { stats.errorLayers++; continue; }
      const found = textureSetLayers(layer.ts as [string, string, string, string], layer.rgb, index);
      if (found.length === 0) stats.droppedLayers++;
      else out.push(...found);
    } else if (layer.copy !== undefined) {
      const c = layer.copy;
      const ok = Array.isArray(c) && c.length === 3 && typeof c[0] === 'string' && Number.isInteger(c[1])
        && Number.isInteger(c[2]) && (c[2] as number) >= 0 && (c[2] as number) <= 5;
      if (!ok) { stats.errorLayers++; continue; }
      out.push({ copy: [c[0] as string, c[1] as number, c[2] as number] });
    } else {
      stats.errorLayers++;   // `err`, or a shape this version does not know
    }
  }
  return out;
}

/** Joins a whole dump to the asset index; every face and cover list is resolved exactly once. */
export function buildTexturesDump(file: TexturesDumpFile, index: AssetIndex): TexturesDump {
  const stats: DumpStats = { droppedLayers: 0, errorLayers: 0 };
  const layers = (list: unknown): FaceLayer[] => (Array.isArray(list) ? resolveDumpLayers(list as DumpLayer[], index, stats) : []);
  const faces = (raw: unknown): ResolvedFaces => {
    const lists = Array.isArray(raw) ? raw : [];
    return Array.from({ length: 6 }, (_, side) => layers(lists[side]));
  };

  const materialsById = new Map<number, DumpMaterial>();
  const materialsByName = new Map<string, DumpMaterial>();
  for (const m of file.materials) {
    const material: DumpMaterial = { name: m.name, id: m.id, rgb: [m.rgba[0], m.rgba[1], m.rgba[2]], set: m.set };
    materialsByName.set(material.name, material);
    if (material.id >= 0) materialsById.set(material.id, material);   // -1: the material has no generated items
  }

  const mte = new Map<number, DumpMte>();
  for (const m of file.mte) {
    const pipe = m.pipe === true;
    if (m.error !== undefined) {
      mte.set(m.id, { cls: m.cls, pipe, inactive: null, active: null, error: m.error });
      continue;
    }
    const inactive = m.inactive === undefined ? null : faces(m.inactive);
    mte.set(m.id, { cls: m.cls, pipe, inactive, active: m.active === undefined ? inactive : faces(m.active) });
  }

  const fluids = new Map<string, { color: Rgb; still: TextureLayer | null }>();
  for (const f of file.fluids) {
    const c = f.color;
    const color: Rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    fluids.set(f.name, { color, still: typeof f.still === 'string' ? index.layer(f.still, { tint: color }) : null });
  }

  return {
    exporterVersion: file.exporterVersion,
    sets: file.sets.map((s) => new Map(Object.entries(s.icons).map(([i, list]) => [Number(i), list]))),
    materialsById,
    materialsByName,
    metaItems: new Map(file.metaItems.map((m) => [m.id, {
      offset: m.offset, unlocalized: m.unlocalized,
      prefixes: new Map(m.prefixes.map((p) => [p.i, { prefix: p.prefix, texture: p.texture }])),
    }])),
    mte,
    casingPages: new Map(file.casingPages.map((c) => [c.id, faces(c.faces)])),
    blocks: new Map(file.blocks.map((b) => [b.id, new Map(Object.entries(b.metas).map(([meta, f]) => [Number(meta), faces(f)]))])),
    covers: new Map(file.covers.map((c) => [c.item, layers(c.layers)])),
    fluids,
    textureNames: { blocks: new Map(Object.entries(file.textureNames.blocks)), items: new Map(Object.entries(file.textureNames.items)) },
    blockIds: new Set(file.blockIds),
    stats,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whether `manifest.json` says the `textures` section failed or was skipped (a failed section can leave a truncated file). */
async function sectionMissing(exportDir: string): Promise<boolean> {
  const file = join(exportDir, EXPORT_FILES.manifest);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false;
    throw new TexturesDumpError(`${file}: cannot read the export manifest: ${messageOf(err)}`, { cause: err });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (err) {
    throw new TexturesDumpError(`${file}: not valid JSON (${messageOf(err)})`, { cause: err });
  }
  if (!isPlainObject(manifest)) return false;
  const lists = (sections: unknown): boolean => Array.isArray(sections) && sections.includes(TEXTURES_SECTION);
  return lists(manifest.failedSections) || lists(manifest.skippedSections);
}

/**
 * The texture dump of the export in `exportDir`, joined to `index`; null when the export has none (older exporter,
 * section skipped or failed). A file that is not gzip'd JSON of `TEXTURES_FORMAT` throws `TexturesDumpError`.
 */
export async function loadTexturesDump(exportDir: string, index: AssetIndex): Promise<TexturesDump | null> {
  const file = join(exportDir, TEXTURES_FILE);
  const again = 'Run `npm run export` again.';
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
    throw new TexturesDumpError(`${file}: cannot read the texture dump: ${messageOf(err)}`, { cause: err });
  }
  if (await sectionMissing(exportDir)) return null;
  let text: string;
  try {
    text = (await gunzipAsync(bytes)).toString('utf8');
  } catch (err) {
    throw new TexturesDumpError(`${file}: not a gzip file (${messageOf(err)}). ${again}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TexturesDumpError(`${file}: not valid JSON (${messageOf(err)}). ${again}`, { cause: err });
  }
  if (!isPlainObject(parsed) || parsed.format !== TEXTURES_FORMAT) {
    const format = isPlainObject(parsed) ? JSON.stringify(parsed.format) : 'none';
    throw new TexturesDumpError(`${file}: format ${format}, expected "${TEXTURES_FORMAT}". ${again}`);
  }
  try {
    return buildTexturesDump(parsed as unknown as TexturesDumpFile, index);
  } catch (err) {
    throw new TexturesDumpError(`${file}: unexpected content (${messageOf(err)}). ${again}`, { cause: err });
  }
}
