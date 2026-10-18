import { describe, expect, it } from 'vitest';
import { classifyChest, IRON_CHEST_SLOTS } from '../../../src/server/world/classify/chests.ts';
import {
  classifyDrawer, countsAsDrawer, DEFAULT_DRAWER_CONFIG, isNetworkedDrawerBlock, readDrawerConfig, slotCapacityStacks,
} from '../../../src/server/world/classify/drawers.ts';
import { classifyBarrel } from '../../../src/server/world/classify/jabba.ts';
import type { RawTe, Vec3 } from '../../../src/server/world/model.ts';
import { DEFAULT_ITEM_IDS } from '../../helpers/make-world.ts';
import { byte, comp, int, list, parseTag, short, str, type Tag } from '../../helpers/nbt-write.ts';
import { barrel, chest, drawer, drawerController, drawerSlave, ironChest, stack, te } from '../../helpers/world-tes.ts';

const itemNames = new Map(Object.entries(DEFAULT_ITEM_IDS).map(([name, id]) => [id, name]));
const P: Vec3 = [-1, 64, -17];

/** A whitelisted TE as the chunk pass hands it over: dim 0, the compound's own id and position. */
function raw(t: Tag): RawTe {
  const nbt = parseTag(t);
  const { id, x, y, z } = nbt;
  if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') throw new TypeError('not a TE compound');
  return { dim: 0, id, x, y, z, nbt };
}

const cfg = DEFAULT_DRAWER_CONFIG;
it('reads drawer slots with Int counts and base capacity', () => {
  expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 1000], null, [4, 64], null], cap: 16 })), itemNames, cfg)).toEqual({
    dim: 0, pos: P, kind: 'drawer', capacityStacks: 64,
    contents: [{ key: 'minecraft:iron_ingot@0', count: 1000 }, { key: 'minecraft:cobblestone@0', count: 64 }] });
});
it.each([
  [[{ name: 'StorageDrawers:upgrade', damage: 3 }, { name: 'StorageDrawers:upgrade', damage: 8 }], 16 * 132],
  [[{ name: 'StorageDrawers:upgrade', damage: 3 }, { name: 'StorageDrawers:upgradeDowngrade', damage: 0 }], 4],
  [[{ name: 'StorageDrawers:upgrade', damage: 9 }], 16],            // damage outside 2..8 adds 1
  [[{ name: 'StorageDrawers:upgradeCreative', damage: 1 }], null],  // vending variant is unlimited too
])('slot capacity with upgrades %j is %s stacks', (ups, want) => expect(slotCapacityStacks(16, ups, cfg)).toBe(want));
it('creative upgrades are limited when the config disables them', () =>
  expect(slotCapacityStacks(16, [{ name: 'StorageDrawers:upgradeCreative', damage: 0 }], { ...cfg, creativeUnlimited: false })).toBe(16));
it('reads legacy Item/Meta slots', () => {
  const legacy = comp({ Item: short(265), Meta: short(0), Count: int(5) });
  expect(classifyDrawer(raw(drawer({ pos: P, slots: [legacy] })), itemNames, cfg)!.contents).toEqual([{ key: 'minecraft:iron_ingot@0', count: 5 }]);
});
it('marks compacting drawers found-but-unknown and controllers empty', () => {
  expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 9]], comp: true })), itemNames, cfg)!.contents).toBeNull();
  expect(classifyDrawer(raw(drawerController(P)), itemNames, cfg)).toEqual({ dim: 0, pos: P, kind: 'drawer_controller', contents: [] });
  expect(classifyDrawer(raw(drawerSlave(P, [0, 64, 0])), itemNames, cfg)).toBeNull();
});
it('parses the pack config and falls back to defaults', () => {
  const text = 'blocks {\n  controller {\n    I:maxDrawers=30\n    I:range=6\n  }\n}\nupgrades {\n  I:level2Mult=3\n}\ngeneral {\n  B:enableCreativeUpgrades=false\n}\n';
  expect(readDrawerConfig(text)).toEqual({ range: 6, maxDrawers: 30, upgradeMult: { ...cfg.upgradeMult, 2: 3 }, creativeUnlimited: false });
  expect(readDrawerConfig(null)).toEqual(cfg);
});
it('knows which blocks are networked and which count as drawers', () => {
  expect(['StorageDrawers:fullDrawers4', 'StorageDrawersBop:fullDrawers2', 'StorageDrawers:trim', 'StorageDrawers:controllerSlave',
    'StorageDrawers:framingTable', 'minecraft:chest'].map(isNetworkedDrawerBlock)).toEqual([true, true, true, true, false, false]);
  expect(['StorageDrawers:halfCustom2', 'StorageDrawers:trim', 'StorageDrawers:controller'].map(countsAsDrawer)).toEqual([true, false, false]);
});
it('reads a JABBA barrel, and hides linked barrels', () => {
  expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 3000, maxstacks: 64 })), itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'barrel', capacityStacks: 64, contents: [{ key: 'minecraft:iron_ingot@0', count: 3000 }] });
  expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 10, linked: true })), itemNames).contents).toBeNull();
  expect(classifyBarrel(raw(barrel({ pos: P, amount: 0 })), itemNames).contents).toEqual([]);
});
it('reads chests, unsigned slots and merges duplicate stacks', () => {
  expect(classifyChest(raw(chest(P, [[0, stack(265, 64)], [200, stack(265, 32)]])), itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'chest', capacityStacks: 27, contents: [{ key: 'minecraft:iron_ingot@0', count: 96 }] });
  expect(classifyChest(raw(ironChest(P, 'DIAMOND', [])), itemNames)).toMatchObject({ kind: 'iron_chest', capacityStacks: 108 });
  expect(classifyChest(raw(ironChest(P, 'WOOD', [])), itemNames)!.capacityStacks).toBeUndefined();
  expect(classifyChest(raw(chest(P, [[0, stack(9999, 1)]])), itemNames)!.contents).toBeNull();     // unknown item id
});

// ---- Beyond the plan's list: the rest of Task 5's interface and its decisions ----

describe('drawers', () => {
  it('applies the upgrades stored in the drawer to every slot', () => {
    const two: Array<[number, number] | null> = [[265, 10], null];
    expect(classifyDrawer(raw(drawer({ pos: P, slots: two, cap: 16, upgrades: [[5100, 3], [5100, 8]] })), itemNames, cfg)!.capacityStacks).toBe(2 * 16 * 132);
    expect(classifyDrawer(raw(drawer({ pos: P, slots: two, cap: 16, upgrades: [[5100, 3], [5101, 0]] })), itemNames, cfg)!.capacityStacks).toBe(2 * 4);
    expect(classifyDrawer(raw(drawer({ pos: P, slots: two, cap: 16, upgrades: [[5102, 0]] })), itemNames, cfg)!.capacityStacks).toBeNull();
    expect(classifyDrawer(raw(drawer({ pos: P, slots: two, cap: 16, upgrades: [[5102, 0]] })), itemNames, { ...cfg, creativeUnlimited: false })!
      .capacityStacks).toBe(2 * 16);
  });

  it('leaves the capacity unknown when an upgrade or the base capacity cannot be read', () => {
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 10]], upgrades: [[9999, 3]] })), itemNames, cfg)!.capacityStacks).toBeNull();
    const noCap = te('StorageDrawers:tileDrawersStandard', P, { Slots: list('compound', [comp({})]), Dir: byte(2) });
    expect(classifyDrawer(raw(noCap), itemNames, cfg)).toEqual({ dim: 0, pos: P, kind: 'drawer', capacityStacks: null, contents: [] });
  });

  it('sums the same item over slots, skips locked slots at 0 and reads idExt ids', () => {
    const r = classifyDrawer(raw(drawer({ pos: P, slots: [[265, 10], [4, 0], [265, 5], [40000, 7, 3]] })), itemNames, cfg);
    expect(r!.contents).toEqual([{ key: 'minecraft:iron_ingot@0', count: 15 }, { key: 'test:big_item@3', count: 7 }]);
  });

  it('is found-but-unknown when a stocked slot cannot be read, but not for an unreadable locked slot', () => {
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 10], [9999, 3]] })), itemNames, cfg)!.contents).toBeNull();
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 10], [9999, 0]] })), itemNames, cfg)!.contents)
      .toEqual([{ key: 'minecraft:iron_ingot@0', count: 10 }]);
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [comp({ Count: int(4) })] })), itemNames, cfg)!.contents).toBeNull();   // a count without an item
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, -1]] })), itemNames, cfg)!.contents).toBeNull();
  });

  it('gives compacting drawers no capacity and ignores every other Storage Drawers tile entity', () => {
    expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 9]], comp: true })), itemNames, cfg)).toEqual({ dim: 0, pos: P, kind: 'drawer', contents: null });
    for (const id of ['StorageDrawers:trim', 'StorageDrawers:framingTable', 'TileEntityBarrel', 'Chest']) {
      expect(classifyDrawer(raw(te(id, P, {})), itemNames, cfg)).toBeNull();
    }
  });

  it('names networked blocks of every pack variant and nothing else', () => {
    expect(['StorageDrawersForestry:halfDrawers4', 'StorageDrawersMisc:trim', 'StorageDrawersNatura:fullCustom1', 'StorageDrawers:compDrawers',
      'StorageDrawers:trimCustom', 'StorageDrawers:controller', 'StorageDrawers:fullDrawers', 'StorageDrawers:controllerSlave2',
      'StorageDrawersExtra:fullDrawers1', 'storagedrawers:fullDrawers1', 'fullDrawers1', 'StorageDrawers:upgrade'].map(isNetworkedDrawerBlock))
      .toEqual([true, true, true, true, true, true, false, false, false, false, false, false]);
    expect(['StorageDrawersBop:fullDrawers2', 'StorageDrawers:compDrawers', 'StorageDrawers:trimCustom', 'StorageDrawers:controllerSlave',
      'minecraft:chest'].map(countsAsDrawer)).toEqual([true, true, false, false, false]);
  });
});

describe('drawer config', () => {
  it('keeps every default the file does not set, and gives a fresh copy each time', () => {
    expect(readDrawerConfig('')).toEqual(cfg);
    expect(readDrawerConfig('upgrades {\n  I:level8Mult=256\n}\n')).toEqual({ ...cfg, upgradeMult: { ...cfg.upgradeMult, 8: 256 } });
    const copy = readDrawerConfig(null);
    copy.upgradeMult[2] = 99;
    expect(DEFAULT_DRAWER_CONFIG.upgradeMult[2]).toBe(2);
  });

  it('reads a Forge file with comments, lists, quoted names and nested categories', () => {
    const text = [
      '# Configuration file', '',
      'blocks {', '    "fulldrawers1" {', '        I:baseStorage=32', '        I:range=99', '    }', '',
      '    CONTROLLER {', '        # Range of the controller', '        B:enabled=true', '        S:blockBlacklist <', '            minecraft:chest', '            }',
      '         >', '        I:"maxDrawers"=40', '        I:range=8', '    }', '}', '',
      'general {', '    S:emptyList <', '     >', '    B:enableCreativeUpgrades=FALSE', '}', '',
      'upgrades {', '    I:level3Mult=5', '    I:level9Mult=1000', '    I:level1Mult=7', '}', '',
    ].join('\r\n');
    expect(readDrawerConfig(text)).toEqual({ range: 8, maxDrawers: 40, upgradeMult: { ...cfg.upgradeMult, 3: 5 }, creativeUnlimited: false });
  });

  it('keeps the default for a value Forge could not parse either', () => {
    const text = 'blocks {\n  controller {\n    I:range=far\n    I:maxDrawers=99999999999\n  }\n}\ngeneral {\n  B:enableCreativeUpgrades=no\n}\n';
    expect(readDrawerConfig(text)).toEqual(cfg);
  });
});

describe('barrels', () => {
  it('hides ender barrels and is found-but-unknown when the stored item cannot be read', () => {
    expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 10, ender: true })), itemNames).contents).toBeNull();
    expect(classifyBarrel(raw(barrel({ pos: P, item: 9999, amount: 10 })), itemNames).contents).toBeNull();
    expect(classifyBarrel(raw(barrel({ pos: P, amount: 10 })), itemNames).contents).toBeNull();               // amount without an item
    expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 0, maxstacks: 128 })), itemNames))         // keepLastItem: the item stays at 0
      .toEqual({ dim: 0, pos: P, kind: 'barrel', capacityStacks: 128, contents: [] });
  });

  it('keeps a barrel without a storage compound as found-but-unknown', () => {
    expect(classifyBarrel(raw(te('TileEntityBarrel', P, { rotation: int(2) })), itemNames))
      .toEqual({ dim: 0, pos: P, kind: 'barrel', capacityStacks: null, contents: null });
  });
});

describe('chests', () => {
  it('reads every IronChest type of the table, slots above 127 included', () => {
    expect(Object.entries(IRON_CHEST_SLOTS)).toEqual([['IRON', 54], ['GOLD', 81], ['DIAMOND', 108], ['COPPER', 45], ['STEEL', 72], ['CRYSTAL', 108],
      ['OBSIDIAN', 108], ['NETHERITE', 135], ['DARKSTEEL', 135], ['SILVER', 72]]);
    expect(classifyChest(raw(ironChest(P, 'NETHERITE', [[134, stack(4, 64)], [0, stack(265, 1)], [128, stack(4, 1, 0, { tag: comp({ display: comp({ Name: str('x') }) }) })]])), itemNames))
      .toEqual({ dim: 0, pos: P, kind: 'iron_chest', capacityStacks: 135,
        contents: [{ key: 'minecraft:cobblestone@0', count: 65 }, { key: 'minecraft:iron_ingot@0', count: 1 }] });
  });

  it('gives types outside the table no capacity, never a prototype key', () => {
    for (const type of ['DIRTCHEST9000', 'toString', 'constructor']) {
      const r = classifyChest(raw(ironChest(P, type, [])), itemNames);
      expect(r).toEqual({ dim: 0, pos: P, kind: 'iron_chest', contents: [] });
      expect(r).not.toHaveProperty('capacityStacks');
    }
  });

  it('skips empty stacks, and ignores tile entities that are not chests', () => {
    expect(classifyChest(raw(chest(P, [[0, stack(9999, 0)], [1, stack(4, 2)]])), itemNames)!.contents).toEqual([{ key: 'minecraft:cobblestone@0', count: 2 }]);
    expect(classifyChest(raw(chest(P, [])), itemNames)).toEqual({ dim: 0, pos: P, kind: 'chest', capacityStacks: 27, contents: [] });
    for (const id of ['TileEntityBarrel', 'BlockChest', 'StorageDrawers:tileDrawersStandard']) expect(classifyChest(raw(te(id, P, {})), itemNames)).toBeNull();
  });
});
