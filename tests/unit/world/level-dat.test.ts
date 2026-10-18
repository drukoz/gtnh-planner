import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { KNOWN_MANAGERS, levelInfoFromNbt, readLevelDat } from '../../../src/server/world/level-dat.ts';
import { comp, int, list, parseTag, str, writeNbt, type Tag } from '../../helpers/nbt-write.ts';

const managers = (blockid: string, extra: Record<string, Tag> = {}) => comp({
  version: str('0.8.4'),
  managers: comp({
    'endlessids:blockid': comp({ version: str(blockid), uninstallMessage: str('Removing EndlessIDs breaks the world') }),
    'endlessids:metadata': comp({ version: str('1.7.4') }), 'endlessids:biome': comp({ version: str('endlessids') }),
    'archaicfix:lighting': comp({ version: str('1.0') }), ...extra,
  }),
});

const level = (extra: Record<string, Tag>) => comp({
  Data: comp({ LevelName: str('World'), SpawnX: int(10), SpawnY: int(64), SpawnZ: int(-20) }),
  FML: comp({ ModList: list('compound', [comp({ ModId: str('Forge'), ModVersion: str('10.13.4.1614') }), comp({ ModId: str('gregtech'), ModVersion: str('5.09.54.183') })]) }),
  ...extra,
});

const info = readLevelDat(gzipSync(writeNbt(level({ chunkapicore: managers('9.9') }))));
const noManagers = readLevelDat(gzipSync(writeNbt(level({}))));

describe('level.dat', () => {
  it('keeps separate block and item maps', () => {
    const info = readLevelDat(gzipSync(writeNbt(comp({ FML: comp({ ItemData: list('compound', [
      comp({ K: str('\u0001minecraft:reeds'), V: int(83) }), comp({ K: str('\u0002minecraft:reeds'), V: int(338) }),
      comp({ K: str('\u0001gregtech:gt.blockmachines'), V: int(4000) }), comp({ K: str('\u0002gregtech:gt.blockmachines'), V: int(4000) }) ]) }) }))));
    expect([info.blockNames.get(83), info.itemNames.get(338), info.itemNames.has(83), info.blockIds.get('gregtech:gt.blockmachines')])
      .toEqual(['minecraft:reeds', 'minecraft:reeds', false, 4000]);
    expect(info.blockNames.get(0)).toBe('minecraft:air');
    expect([info.blockIds.get('minecraft:air'), info.blockNames.size, info.itemNames.size]).toEqual([0, 3, 2]);
  });

  it('skips ItemData entries without a known prefix, a name or a number', () => {
    const info = levelInfoFromNbt(parseTag(comp({ FML: comp({ ItemData: list('compound', [
      comp({ K: str('\u0003odd:thing'), V: int(5) }), comp({ K: str('\u0001'), V: int(6) }), comp({ K: str('\u0001a:b'), V: str('7') }), comp({ V: int(8) }),
      comp({ K: str('\u0001minecraft:air'), V: int(0) }), comp({ K: str('\u0001minecraft:stone'), V: int(1) }) ]) }) })));
    expect([...info.blockNames]).toEqual([[0, 'minecraft:air'], [1, 'minecraft:stone']]);
    expect(info.itemNames.size).toBe(0);
  });

  it('reads level name, spawn and mods', () => {
    expect([info.levelName, info.spawn, info.mods.gregtech]).toEqual(['World', [10, 64, -20], '5.09.54.183']);
    expect(info.mods).toEqual({ Forge: '10.13.4.1614', gregtech: '5.09.54.183' });
    expect(info.managers).toEqual({ 'endlessids:blockid': '9.9', 'endlessids:metadata': '1.7.4', 'endlessids:biome': 'endlessids', 'archaicfix:lighting': '1.0' });
  });

  it('warns about unknown chunk managers only', () => {
    expect(info.warnings).toEqual(['Unknown chunk manager endlessids:blockid 9.9 (expected 1.7.4)']);
    expect(noManagers.warnings).toEqual([]);
    expect(noManagers.managers).toEqual({});
    expect(readLevelDat(writeNbt(level({ chunkapicore: managers('1.7.4') }))).warnings).toEqual([]);
  });

  it('warns about a manager it does not know at all, without refusing the world', () => {
    const odd = readLevelDat(writeNbt(level({ chunkapicore: managers('1.7.4', { 'someone:extra': comp({ version: str('2.0') }), toString: comp({ version: str('1') }) }) })));
    expect(odd.warnings).toEqual(['Unknown chunk manager someone:extra 2.0', 'Unknown chunk manager toString 1']);
    expect([odd.levelName, odd.blockNames.get(0)]).toEqual(['World', 'minecraft:air']);
    expect(Object.keys(KNOWN_MANAGERS)).toEqual(['endlessids:blockid', 'endlessids:metadata', 'endlessids:biome', 'archaicfix:lighting']);
  });

  it('falls back when Data and FML are missing', () => {
    const bare = levelInfoFromNbt({});
    expect([bare.levelName, bare.spawn, bare.mods, [...bare.blockNames], bare.warnings]).toEqual(['', [0, 0, 0], {}, [[0, 'minecraft:air']], []]);
  });
});
