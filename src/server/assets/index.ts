// `data/assets/index.json`: the textures `npm run extract-assets` copied out of the jars (Task 2), and the lookups the
// resolvers use to turn a texture path into a `TextureLayer` only when the file was extracted.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rgb, TextureLayer } from '../../shared/types/assets.ts';

export const ASSET_INDEX_FORMAT = 'gtnh-planner-assets/1';
export const INDEX_FILE = 'index.json';                              // data/assets/index.json

export interface AssetFileInfo { w: number; h: number; frames?: number /* only when > 1 */; jar: string /* basename of the winning jar */ }
export interface AssetConflict { path: string; winner: string; losers: string[]; rule: 'mod-over-client' | 'override-over-home' | 'last-by-name' }
export interface AssetIndexFile {
  format: typeof ASSET_INDEX_FORMAT; createdAt: string;
  sources: Array<{ jar: string; kind: 'client' | 'mod'; files: number /* paths it won */; sha1?: string /* client jar only */ }>;
  files: Record<string /* data/assets-relative PNG path */, AssetFileInfo>;
  conflicts: AssetConflict[] /* sorted by path */; identicalDuplicates: number;
}

/** `index.json` cannot be read, is not valid JSON, or was not written by this version of the extractor. */
export class AssetIndexError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssetIndexError';
  }
}

export interface AssetIndex {
  readonly size: number; readonly file: AssetIndexFile | null;
  has(path: string): boolean; info(path: string): AssetFileInfo | undefined;
  layer(path: string, opts?: { tint?: Rgb; glow?: boolean }): TextureLayer | null;
  firstLayer(paths: readonly string[], opts?: { tint?: Rgb; glow?: boolean }): TextureLayer | null;
}

function isWhite(rgb: Rgb): boolean {
  return rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
}

function indexOver(files: ReadonlyMap<string, AssetFileInfo>, file: AssetIndexFile | null): AssetIndex {
  const layer = (path: string, opts?: { tint?: Rgb; glow?: boolean }): TextureLayer | null => {
    const info = files.get(path);
    if (info === undefined) return null;
    const out: TextureLayer = { path };
    if (opts?.tint !== undefined && !isWhite(opts.tint)) out.tint = [opts.tint[0], opts.tint[1], opts.tint[2]];
    if (opts?.glow === true) out.glow = true;
    if (info.frames !== undefined && info.frames > 1) out.frames = info.frames;
    return out;
  };
  return {
    size: files.size,
    file,
    has: (path) => files.has(path),
    info: (path) => files.get(path),
    layer,
    firstLayer(paths, opts) {
      for (const path of paths) {
        const found = layer(path, opts);
        if (found !== null) return found;
      }
      return null;
    },
  };
}

export function assetIndexFrom(file: AssetIndexFile): AssetIndex {
  return indexOver(new Map(Object.entries(file.files)), file);
}

export function emptyAssetIndex(): AssetIndex {
  return indexOver(new Map(), null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function checkFile(parsed: unknown, file: string): AssetIndexFile {
  const again = 'Run `npm run extract-assets` again.';
  if (!isPlainObject(parsed) || parsed.format !== ASSET_INDEX_FORMAT) {
    const format = isPlainObject(parsed) ? JSON.stringify(parsed.format) : 'none';
    throw new AssetIndexError(`${file}: format ${format}, expected "${ASSET_INDEX_FORMAT}". ${again}`);
  }
  if (!isPlainObject(parsed.files)) throw new AssetIndexError(`${file}: "files" must be an object. ${again}`);
  for (const [path, info] of Object.entries(parsed.files)) {
    const ok = isPlainObject(info) && isCount(info.w, 0) && isCount(info.h, 0) && typeof info.jar === 'string'
      && (info.frames === undefined || isCount(info.frames, 1));
    if (!ok) throw new AssetIndexError(`${file}: bad entry for ${JSON.stringify(path)}. ${again}`);
  }
  return parsed as unknown as AssetIndexFile;
}

/** The index in `assetsDir`; empty when there is no `index.json` yet. */
export async function loadAssetIndex(assetsDir: string): Promise<AssetIndex> {
  const file = join(assetsDir, INDEX_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return emptyAssetIndex();
    throw new AssetIndexError(`${file}: cannot read the asset index: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new AssetIndexError(`${file}: not valid JSON (${err instanceof Error ? err.message : String(err)}). Run \`npm run extract-assets\` again.`, { cause: err });
  }
  return assetIndexFrom(checkFile(parsed, file));
}

/**
 * The extracted file of an icon name, as Minecraft 1.7.10's `ResourceLocation` and `TextureMap` build it (research
 * §2.1): the domain before the first `:` is lower-cased (`minecraft` when absent or empty), the rest is kept as is.
 */
export function iconPath(iconName: string, atlas: 'blocks' | 'items'): string {
  const colon = iconName.indexOf(':');
  const domain = colon < 0 ? '' : iconName.slice(0, colon);
  const rest = colon < 0 ? iconName : iconName.slice(colon + 1);
  return `${(domain === '' ? 'minecraft' : domain).toLowerCase()}/textures/${atlas}/${rest}.png`;
}
