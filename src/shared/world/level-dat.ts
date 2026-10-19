// `level.dat` from its decompressed NBT root (world-format §3.6, §4): the separate block and item id maps of
// FML.ItemData, level name, spawn, mod versions and the ChunkAPI chunk managers. An unexpected manager version is a
// warning, never a refusal. Shared by server and browser: no Node built-in modules.

import { comp, list, num, str, type NbtCompound } from './nbt.ts';

export interface LevelInfo {
  levelName: string; spawn: [number, number, number];
  blockNames: Map<number, string>; itemNames: Map<number, string>; blockIds: Map<string, number>;
  mods: Record<string, string>; managers: Record<string, string>; warnings: string[];
}

/** The chunk managers (and versions) this reader decodes: EndlessIDs 1.7.4 storage on ChunkAPI 0.8.4. */
export const KNOWN_MANAGERS: Readonly<Record<string, string>> = {
  'endlessids:blockid': '1.7.4', 'endlessids:metadata': '1.7.4', 'endlessids:biome': 'endlessids', 'archaicfix:lighting': '1.0',
};

const BLOCK_PREFIX = 1;   // '\u0001' + registry name
const ITEM_PREFIX = 2;    // '\u0002' + registry name
const AIR = 'minecraft:air';

export function levelInfoFromNbt(root: NbtCompound): LevelInfo {
  const data = comp(root.Data), fml = comp(root.FML);
  const blockNames = new Map<number, string>(), itemNames = new Map<number, string>(), blockIds = new Map<string, number>();
  for (const e of list(fml?.ItemData)) {
    const entry = comp(e), key = str(entry?.K), id = entry?.V;
    if (key === null || key.length < 2 || typeof id !== 'number') continue;
    const name = key.slice(1);
    const prefix = key.charCodeAt(0);
    if (prefix === BLOCK_PREFIX) {
      blockNames.set(id, name);
      blockIds.set(name, id);
    } else if (prefix === ITEM_PREFIX) {
      itemNames.set(id, name);
    }
  }
  if (!blockNames.has(0)) blockNames.set(0, AIR);   // block id 0 is air in every world
  if (!blockIds.has(AIR)) blockIds.set(AIR, 0);

  const mods = Object.fromEntries(list(fml?.ModList).flatMap((e) => {
    const id = str(comp(e)?.ModId);
    return id === null ? [] : [[id, str(comp(e)?.ModVersion) ?? '']];
  }));
  const managers = Object.fromEntries(Object.entries(comp(comp(root.chunkapicore)?.managers) ?? {})
    .map(([name, m]) => [name, str(comp(m)?.version) ?? '']));
  const warnings = Object.entries(managers).flatMap(([name, version]) => {
    const expected = Object.hasOwn(KNOWN_MANAGERS, name) ? KNOWN_MANAGERS[name] : undefined;
    if (expected === version) return [];
    return [expected === undefined ? `Unknown chunk manager ${name} ${version}` : `Unknown chunk manager ${name} ${version} (expected ${expected})`];
  });

  return {
    levelName: str(data?.LevelName) ?? '',
    spawn: [num(data?.SpawnX), num(data?.SpawnY), num(data?.SpawnZ)],
    blockNames, itemNames, blockIds, mods, managers, warnings,
  };
}
