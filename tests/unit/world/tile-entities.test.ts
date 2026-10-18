import { describe, expect, it } from 'vitest';
import { DIRS, OPPOSITE, posKey, step, type Vec3 } from '../../../src/server/world/model.ts';
import { isWantedTe, readStack, scanChunk, scanRegionBuffer, TE_PREFIXES, TE_WHITELIST } from '../../../src/server/world/tile-entities.ts';
import { chunkNbt, DEFAULT_BLOCK_IDS, DEFAULT_ITEM_IDS } from '../../helpers/make-world.ts';
import { byte, comp, double, int, list, parseTag, short, str, writeNbt, type Tag } from '../../helpers/nbt-write.ts';
import { regionFile } from '../../helpers/region-write.ts';
import { chest, gtMachine, oreTe, stack, stackFields } from '../../helpers/world-tes.ts';

const ids = { ...DEFAULT_BLOCK_IDS };
const itemNames = new Map(Object.entries(DEFAULT_ITEM_IDS).map(([name, id]) => [id, name]));

describe('scanChunk', () => {
  it('returns wanted TEs and InhabitedTime, skipping ore TEs', () => {
    const r = scanChunk(chunkNbt({ cx: -1, cz: 2, format: 'legacy', inhabitedTime: 1_440_000, oreTes: 500,
      tileEntities: [gtMachine({ pos: [-5, 64, 40], mID: 1121 }), chest([-6, 64, 40], [])] }, ids), 0, 1_700_000_000);
    expect(r.stat).toEqual({ dim: 0, cx: -1, cz: 2, inhabitedTime: 1_440_000, timestamp: 1_700_000_000, teCount: 502, oreTes: 500 });
    expect(r.tes.map((t) => [t.id, t.x, t.y, t.z])).toEqual([['BaseMetaTileEntity', -5, 64, 40], ['Chest', -6, 64, 40]]);
    expect(r.tes[0]!.nbt.mID).toBe(1121);
  });

  it('finds the id when it is the last key of the TE compound', () => {
    // Items comes first and holds a nested Short `id`, which must not be taken for the TE's own id.
    const idLast = comp({ x: int(3), y: int(64), z: int(5), Items: list('compound', [comp({ Slot: byte(0), ...stackFields(265, 3) })]), id: str('Chest') });
    const furnaceIdLast = comp({ x: int(4), y: int(64), z: int(5), BurnTime: short(0), id: str('Furnace') });
    const oreIdLast = comp({ m: short(32), n: byte(1), x: int(5), y: int(10), z: int(5), id: str('GT_TileEntity_Ores') });
    const r = scanChunk(chunkNbt({ cx: 0, cz: 0, inhabitedTime: 7, fill: [{ from: [0, 0, 0], to: [15, 63, 15], block: 'minecraft:stone' }],
      tileEntities: [furnaceIdLast, oreIdLast, idLast, oreTe([6, 10, 6])] }, ids), 0, 9);
    expect(r.stat).toMatchObject({ cx: 0, cz: 0, inhabitedTime: 7, timestamp: 9, teCount: 4, oreTes: 2 });
    expect(r.tes).toEqual([{ dim: 0, id: 'Chest', x: 3, y: 64, z: 5,
      nbt: { x: 3, y: 64, z: 5, Items: [{ Slot: 0, id: 265, Count: 3, Damage: 0 }], id: 'Chest' } }]);
  });

  it('keeps chunk order, the dimension and every whitelisted TE kind', () => {
    const tes = ['StorageDrawers:tileDrawersStandard', 'IronChest.DIAMOND', 'savedMultipart', 'BlockCableBus', 'TileEntityBarrel']
      .map((id, i) => comp({ id: str(id), x: int(16 + i), y: int(70), z: int(-1) }));
    const r = scanChunk(chunkNbt({ cx: 1, cz: -1, tileEntities: tes }, ids), -1, 0);
    expect(r.tes.map((t) => [t.dim, t.id, t.x])).toEqual([[-1, 'StorageDrawers:tileDrawersStandard', 16], [-1, 'IronChest.DIAMOND', 17],
      [-1, 'savedMultipart', 18], [-1, 'BlockCableBus', 19], [-1, 'TileEntityBarrel', 20]]);
    expect(r.stat).toEqual({ dim: -1, cx: 1, cz: -1, inhabitedTime: 0, timestamp: 0, teCount: 5, oreTes: 0 });
  });

  it('throws for NBT that is not a chunk', () => {
    expect(() => scanChunk(writeNbt(comp({ Other: int(1) })), 0, 0)).toThrow(/no Level/);
    expect(() => scanChunk(writeNbt(comp({ Level: comp({ zPos: int(1) }) })), 0, 0)).toThrow(/xPos/);
  });
});

describe('scanRegionBuffer', () => {
  it('skips a corrupt chunk and keeps the rest of the region', () => {
    const reg = regionFile([{ cx: 0, cz: 0, nbt: chunkNbt({ cx: 0, cz: 0 }, ids) }, { cx: 1, cz: 0, nbt: Buffer.alloc(0), corrupt: true }]);
    const out = scanRegionBuffer(reg, 0);
    expect([out.chunks.length, out.skipped]).toEqual([1, 1]);
  });

  it('counts chunks that inflate but do not parse, and stamps chunks with their header timestamp', () => {
    const good = chunkNbt({ cx: -32, cz: -1, inhabitedTime: 3 }, ids);
    const reg = regionFile([
      { cx: -32, cz: -1, nbt: good, timestamp: 1_700_000_123 },
      { cx: -31, cz: -1, nbt: writeNbt(comp({ NotAChunk: int(1) })) },
      { cx: -30, cz: -1, nbt: good.subarray(0, 100) },                       // truncated NBT
      { cx: -29, cz: -1, nbt: chunkNbt({ cx: -29, cz: -1 }, ids), compression: 1 },
    ]);
    const out = scanRegionBuffer(reg, 7);
    expect(out.chunks.map((c) => [c.stat.dim, c.stat.cx, c.stat.cz, c.stat.inhabitedTime, c.stat.timestamp]))
      .toEqual([[7, -32, -1, 3, 1_700_000_123], [7, -29, -1, 0, 0]]);
    expect(out.skipped).toBe(2);
  });

  it('reads an empty region', () => expect(scanRegionBuffer(regionFile([]), 0)).toEqual({ chunks: [], skipped: 0 }));
});

describe('isWantedTe', () => {
  it('takes the whitelist and the mod prefixes, never ore TEs', () => {
    expect([...TE_WHITELIST].every(isWantedTe)).toBe(true);
    expect(TE_PREFIXES).toEqual(['IronChest.', 'StorageDrawers:']);
    expect(['IronChest.DIAMOND', 'StorageDrawers:tileController', 'StorageDrawers:trim'].map(isWantedTe)).toEqual([true, true, true]);
    expect(['GT_TileEntity_Ores', 'Furnace', 'BlockSkyChest', 'ironchest.IRON', 'StorageDrawersBop:x', ''].map(isWantedTe))
      .toEqual([false, false, false, false, false, false]);
  });
});

describe('readStack', () => {
  it.each([
    [{ id: short(265), Count: byte(3), Damage: short(-1) }, { key: 'minecraft:iron_ingot@0', count: 3 }],
    [{ id: short(0), idExt: int(40000), Count: byte(1), Damage: short(7) }, { key: 'test:big_item@7', count: 1 }],
    [{ id: int(265), Count: int(300), Damage: short(0) }, { key: 'minecraft:iron_ingot@0', count: 300 }],
    [{ id: str('minecraft:cobblestone'), Count: byte(2), Damage: short(0) }, { key: 'minecraft:cobblestone@0', count: 2 }],
  ] satisfies Array<[Record<string, Tag>, object]>)('reads item stack %#', (fields, want) =>
    expect(readStack(parseTag(comp(fields)), itemNames)).toMatchObject(want));

  it('returns null for an unknown numeric item id', () =>
    expect(readStack(parseTag(comp({ id: short(9999), Count: byte(1) })), itemNames)).toBeNull());

  it('keeps the stack tag; a missing Damage is 0', () => {
    expect(readStack(parseTag(stack(5000, 1, 32539, { tag: comp({ charge: double(5) }) })), itemNames))
      .toEqual({ key: 'gregtech:gt.metaitem.01@32539', count: 1, tag: { charge: 5 } });
    expect(readStack(parseTag(comp({ id: short(4), Count: byte(64) })), itemNames)).toEqual({ key: 'minecraft:cobblestone@0', count: 64, tag: null });
  });

  it('writes and reads ids above 31,999 through idExt', () =>
    expect(readStack(parseTag(stack(40000, 2, 1)), itemNames)).toMatchObject({ key: 'test:big_item@1', count: 2 }));

  it('returns null for stacks it cannot key reliably', () => {
    const unreadable: Array<Record<string, Tag>> = [{ Count: byte(1) }, { id: str(''), Count: byte(1) }, { id: short(265), Count: byte(-56) },
      { id: short(265), Count: byte(1), Damage: short(32767) }];   // no id, empty name, negative count, the wildcard damage
    for (const fields of unreadable) expect(readStack(parseTag(comp(fields)), itemNames), JSON.stringify(fields)).toBeNull();
  });
});

describe('positions and directions', () => {
  it('uses ForgeDirection ordinals and "dim:x:y:z" keys', () => {
    const p: Vec3 = [-1, 64, -1];
    expect(DIRS.map((_, side) => step(p, side))).toEqual([[-1, 63, -1], [-1, 65, -1], [-1, 64, -2], [-1, 64, 0], [-2, 64, -1], [0, 64, -1]]);
    expect(DIRS.every((_, side) => posKey(0, ...step(step(p, side), OPPOSITE[side]!)) === posKey(0, ...p))).toBe(true);
    expect([posKey(-1, -5, 64, 40), p]).toEqual(['-1:-5:64:40', [-1, 64, -1]]);
    expect(() => step(p, 6)).toThrow(RangeError);
  });
});
