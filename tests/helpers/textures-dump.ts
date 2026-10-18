// Synthetic `textures.json.gz` dumps, shaped like the exporter's `TextureExporter` output (Task 6), so the loader and
// resolvers are tested without running the game.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { TEXTURES_FILE, TEXTURES_FORMAT, type TexturesDumpFile } from '../../src/server/assets/textures-dump.ts';

/** An empty dump of the current format, with `part` laid over it. */
export function dumpFile(part: Partial<TexturesDumpFile> = {}): TexturesDumpFile {
  return {
    format: TEXTURES_FORMAT, exporterVersion: 'test',
    sets: [], materials: [], metaItems: [], mte: [], casingPages: [], blocks: [], covers: [], fluids: [],
    textureNames: { blocks: {}, items: {} }, blockIds: [], stats: {},
    ...part,
  };
}

/** Writes `file` as gzip'd JSON to `<exportDir>/textures.json.gz`, creating `exportDir` when needed. */
export async function writeTexturesDump(exportDir: string, file: TexturesDumpFile): Promise<void> {
  await mkdir(exportDir, { recursive: true });
  await writeFile(join(exportDir, TEXTURES_FILE), gzipSync(JSON.stringify(file)));
}
