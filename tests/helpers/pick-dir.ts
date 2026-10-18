// A world folder on disk as the browser's folder picker gives it (Plan 4 Task 17a): every file below `worldDir` as a
// `PickedEntry` under `World/` (what `File.webkitRelativePath` holds when the World folder is picked), sorted by
// `pickWorldFiles`, and a `ReadFile` over the picked files, as WorldPage builds one over the picked `File`s.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pickWorldFiles, type PickedEntry, type WorldPick } from '../../src/client/world/pick-files.ts';
import type { ReadFile } from '../../src/client/world/smart.ts';

const PICKED_FOLDER = 'World/';

export async function pickDir(worldDir: string): Promise<{ pick: WorldPick; read: ReadFile }> {
  const dirents = await readdir(worldDir, { recursive: true, withFileTypes: true });
  const entries: PickedEntry[] = [];
  const onDisk = new Map<string, string>();   // picked path → file on disk
  for (const d of dirents.filter((e) => e.isFile())) {
    const file = join(d.parentPath, d.name);
    const path = PICKED_FOLDER + relative(worldDir, file).split(sep).join('/');
    entries.push({ path, size: (await stat(file)).size });
    onDisk.set(path, file);
  }
  const pick = pickWorldFiles(entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
  const paths = new Map([...pick.files, ...pick.local].map((f) => [f.rel, f.path]));
  const read: ReadFile = async (rel) => {
    const path = paths.get(rel);
    if (path === undefined) return null;
    const bytes = await readFile(onDisk.get(path)!);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);   // a plain Uint8Array, as File.arrayBuffer gives
  };
  return { pick, read };
}
