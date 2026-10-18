// Synthetic extracted assets: the `data/assets/index.json` that `npm run extract-assets` would write for a set of
// textures, in memory or on disk with real PNGs, so the loaders and routes are tested without game files.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ASSET_INDEX_FORMAT, INDEX_FILE, assetIndexFrom, type AssetFileInfo, type AssetIndex, type AssetIndexFile,
} from '../../src/server/assets/index.ts';
import { makePng, type Rgba } from './png.ts';

/** data/assets-relative PNG path → size (16×16), animation frames (1) and fill colour ([128, 128, 128, 255]). */
export type AssetSpec = Record<string /* data/assets-relative path */, { w?: number; h?: number; frames?: number; color?: Rgba }>;

const JAR = 'test-assets.jar';
const DEFAULT_COLOR: Rgba = [128, 128, 128, 255];

export function indexFileOf(spec: AssetSpec): AssetIndexFile {
  const files: Record<string, AssetFileInfo> = {};
  for (const path of Object.keys(spec).sort()) {
    const s = spec[path]!;
    files[path] = { w: s.w ?? 16, h: s.h ?? 16, ...(s.frames !== undefined && s.frames > 1 ? { frames: s.frames } : {}), jar: JAR };
  }
  return {
    format: ASSET_INDEX_FORMAT, createdAt: '2026-10-17T00:00:00.000Z',
    sources: [{ jar: JAR, kind: 'mod', files: Object.keys(files).length }],
    files, conflicts: [], identicalDuplicates: 0,
  };
}

/** The index of `spec`, in memory only. */
export function indexOf(spec: AssetSpec): AssetIndex {
  return assetIndexFrom(indexFileOf(spec));
}

/** Writes every PNG of `spec` and `index.json` under `<dataDir>/assets`; files already there are left alone. */
export async function writeAssetsDir(dataDir: string, spec: AssetSpec): Promise<AssetIndex> {
  const assetsDir = join(dataDir, 'assets');
  for (const [path, s] of Object.entries(spec)) {
    const file = join(assetsDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, makePng(s.w ?? 16, s.h ?? 16, s.color ?? DEFAULT_COLOR));
  }
  const index = indexFileOf(spec);
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  return assetIndexFrom(index);
}
