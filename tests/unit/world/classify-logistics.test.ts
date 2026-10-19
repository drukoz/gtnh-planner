import { describe, expect, it } from 'vitest';
import { classifyAe2, PART_BASES, partType } from '../../../src/server/world/classify/ae2.ts';
import { classifyConduitBundle, conduitType } from '../../../src/server/world/classify/enderio.ts';
import { classifyMultipart, PR_PIPES, prConnects, ROUTING_CHIPS } from '../../../src/server/world/classify/projectred.ts';
import type { RawTe, Vec3 } from '../../../src/server/world/model.ts';
import { DEFAULT_ITEM_IDS } from '../../helpers/make-world.ts';
import { byte, comp, int, ints, list, long, parseTag, short, str, type Tag } from '../../helpers/nbt-write.ts';
import {
  ae2CableBus, ae2Controller, ae2Drive, ae2Interface, conduit, otherMultipart, prPipe, stack, stackFields, te,
} from '../../helpers/world-tes.ts';

const itemNames = new Map(Object.entries(DEFAULT_ITEM_IDS).map(([name, id]) => [id, name]));
const P: Vec3 = [-1, 64, -17];

/** A whitelisted TE as the chunk pass hands it over: dim 0, the compound's own id and position. */
function raw(t: Tag): RawTe {
  const nbt = parseTag(t);
  const { id, x, y, z } = nbt;
  if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') throw new TypeError('not a TE compound');
  return { dim: 0, id, x, y, z, nbt };
}

it('reads a routed interface pipe with chips and its inventory side', () => {
  const connMap = 0x41 | (0x41 << 3);
  const r = classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rinterface', connMap, io: 2, chips: [stack(5200, 1, 0), stack(5200, 1, 4)] })));
  expect(r).toEqual({ dim: 0, pos: P, type: 'interface', routed: true, connMap, io: 2, chips: ['responder', 'extractor'] });
  expect([prConnects(connMap, 0), prConnects(connMap, 3), prConnects(connMap, 1)]).toEqual([true, true, false]);
});
it('treats io 6 as no inventory and ignores multiparts without a pipe', () => {
  expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rbasic', connMap: 1, io: 6 })))!.io).toBeNull();
  expect(classifyMultipart(raw(otherMultipart(P, 'mc_torch')))).toBeNull();
});
it('reads conduit bundles as per-type bitmasks', () => {
  expect(classifyConduitBundle(raw(conduit({ pos: P, conduits: [
    { cls: 'crazypants.enderio.conduit.item.ItemConduit', connections: [2, 3], external: [4] },
    { cls: 'crazypants.enderio.conduit.power.PowerConduit', connections: [0], external: [] } ] }))).conduits)
    .toEqual([{ type: 'item', connections: 12, external: 16 }, { type: 'power', connections: 1, external: 0 }]);
  expect(['crazypants.enderio.conduit.liquid.EnderLiquidConduit', 'crazypants.enderio.conduit.me.MEConduit', 'x.y.Z'].map(conduitType))
    .toEqual(['liquid', 'me', 'other']);
});
it('maps AE2 part damage to part types, colour offsets included', () =>
  expect([0, 16, 60, 76, 220, 281, 440, 465, 520].map(partType))
    .toEqual(['CableGlass', 'CableGlass', 'CableDense', 'CableDense', 'StorageBus', 'AdvancedLevelEmitter', 'Interface', 'P2PTunnelEU', 'CableDenseCovered']));
it('reads a cable bus with a dense centre and a storage bus', () => {
  expect(classifyAe2(raw(ae2CableBus({ pos: P, center: 60, parts: { 2: 220 } })), itemNames))
    .toEqual({ dim: 0, pos: P, block: 'cable_bus', center: 'dense', parts: [{ side: 2, type: 'StorageBus' }], channels: 1, cells: [] });
});
it('reads drive cells, and hides drives holding fluid cells', () => {
  expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 500]] }] })), itemNames))
    .toMatchObject({ block: 'drive', channels: 1, cells: [{ key: 'minecraft:iron_ingot@0', count: 500 }] });
  expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 5]] }, { fluid: true }] })), itemNames)!.cells).toBeNull();
  expect(classifyAe2(raw(ae2Controller(P)), itemNames)).toMatchObject({ block: 'controller', channels: 0 });
});

// ---- Beyond the plan's list: the rest of Task 6's interface and its decisions ----

describe('Project Red', () => {
  it('knows every pipe def, and only the routed ones are routed', () => {
    expect(Object.entries(PR_PIPES).map(([id, d]) => [id, d.type, d.routed])).toEqual([
      ['pr_pipe', 'basic', false], ['pr_rbasic', 'junction', true], ['pr_rinterface', 'interface', true], ['pr_rcrafting', 'crafting', true],
      ['pr_rrequest', 'request', true], ['pr_rextension', 'extension', true], ['pr_rfire', 'firewall', true], ['pr_pt', 'pressure', false],
      ['pr_rpt', 'resistance', false], ['pr_netvalve', 'valve', false], ['pr_netlatency', 'latency', false],
    ]);
    expect(ROUTING_CHIPS).toEqual(['responder', 'dyn_responder', 'overflow', 'terminator', 'extractor', 'broadcaster', 'stock_keeper', 'crafting', 'extension']);
  });
  it('reads a basic pipe: not routed, no inventory side, no chips', () =>
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_pipe', connMap: 0x41 << 5 }))))
      .toEqual({ dim: 0, pos: P, type: 'basic', routed: false, connMap: 0x41 << 5, io: null, chips: [] }));
  it('finds the pipe behind other parts of the same block', () =>
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rrequest', connMap: 1, io: 0, others: ['mcr_face', 'mc_torch'] }))))
      .toMatchObject({ type: 'request', routed: true, io: 0 }));
  it('reads every chip def, unknown chip damage as unknown, and a negative damage as 0', () => {
    const chips = [...ROUTING_CHIPS.keys(), 9, 300].map((d) => stack(5200, 1, d));
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rinterface', connMap: 0, chips })))!.chips).toEqual([...ROUTING_CHIPS, 'unknown', 'unknown']);
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rinterface', connMap: 0, chips: [stack(5200, 1, -1)] })))!.chips).toEqual(['responder']);
  });
  it('an interface without chips has none', () =>
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rinterface', connMap: 0 })))!.chips).toEqual([]));
  it('io outside 0..5 is no inventory', () => {
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rrequest', connMap: 0, io: 5 })))!.io).toBe(5);
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rrequest', connMap: 0, io: 7 })))!.io).toBeNull();
    expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rrequest', connMap: 0, io: -1 })))!.io).toBeNull();
  });
  it('a part id that is an Object.prototype member is not a pipe', () => {
    expect(classifyMultipart(raw(otherMultipart(P, 'constructor')))).toBeNull();
    expect(classifyMultipart(raw(otherMultipart(P, 'toString')))).toBeNull();
  });
  it('only reads savedMultipart tile entities', () =>
    expect(classifyMultipart({ ...raw(prPipe({ pos: P, part: 'pr_pipe', connMap: 0 })), id: 'Chest' })).toBeNull());
  it('connects on a side through the outward or the internal bit, never the open bit alone', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => prConnects(1 << (s + 6), s))).toEqual([true, true, true, true, true, true]);
    expect([0, 1, 2, 3, 4, 5].map((s) => prConnects(1 << s, s))).toEqual([true, true, true, true, true, true]);
    expect([0, 1, 2, 3, 4, 5].map((s) => prConnects(0x1000 << s, s))).toEqual([false, false, false, false, false, false]);
    expect(prConnects(1 << 2, 3)).toBe(false);
  });
});

describe('EnderIO', () => {
  it('types every conduit class world-format §6.10 lists', () => {
    const p = 'crazypants.enderio.conduit.';
    expect(['item.ItemConduit', 'liquid.LiquidConduit', 'liquid.AdvancedLiquidConduit', 'liquid.CrystallineEnderLiquidConduit',
      'power.PowerConduit', 'power.endergy.PowerConduitEndergy', 'redstone.RedstoneConduit', 'redstone.InsulatedRedstoneConduit',
      'me.MEConduit', 'gas.GasConduit', 'oc.OCConduit'].map((c) => conduitType(p + c)))
      .toEqual(['item', 'liquid', 'liquid', 'liquid', 'power', 'power', 'redstone', 'redstone', 'me', 'gas', 'oc']);
  });
  it('types a class outside a known conduit package as other', () =>
    expect(['crazypants.enderio.conduit.AbstractConduit', 'crazypants.enderio.conduit.facade.ItemFacade', 'crazypants.enderio.conduit.item',
      'crazypants.enderio.machine.item.ItemConduit', 'xcrazypants.enderio.conduit.item.ItemConduit', ''].map(conduitType))
      .toEqual(['other', 'other', 'other', 'other', 'other', 'other']));
  it('places the bundle and keeps every conduit in order', () =>
    expect(classifyConduitBundle(raw(conduit({ pos: P, conduits: [
      { cls: 'crazypants.enderio.conduit.liquid.LiquidConduit', connections: [0, 1, 4, 5], external: [2, 3] },
      { cls: 'crazypants.enderio.conduit.me.MEConduit', connections: [], external: [] } ] }))))
      .toEqual({ dim: 0, pos: P, conduits: [{ type: 'liquid', connections: 0b110011, external: 0b001100 }, { type: 'me', connections: 0, external: 0 }] }));
  it('ignores ordinals that are not a side (6 = UNKNOWN) and reads an empty bundle', () => {
    expect(classifyConduitBundle(raw(conduit({ pos: P, conduits: [
      { cls: 'crazypants.enderio.conduit.item.ItemConduit', connections: [6, 1, -1], external: [7, 0] }] }))).conduits)
      .toEqual([{ type: 'item', connections: 2, external: 1 }]);
    expect(classifyConduitBundle(raw(conduit({ pos: P, conduits: [] }))).conduits).toEqual([]);
  });
  it('reads a conduit without its link arrays as unconnected', () =>
    expect(classifyConduitBundle(raw(te('blockConduitBundleTileEntity', P, {
      conduits: list('compound', [comp({ conduitType: str('crazypants.enderio.conduit.item.ItemConduit'), conduit: comp({}) }),
        comp({ conduitType: str('crazypants.enderio.conduit.gas.GasConduit'), conduit: comp({ connections: ints([3]) }) })]),
      facadeId: str('null') }))).conduits)
      .toEqual([{ type: 'item', connections: 0, external: 0 }, { type: 'gas', connections: 8, external: 0 }]));
});

describe('AE2', () => {
  it('lists the part bases in ascending order and maps each base to itself', () => {
    const bases = PART_BASES.map(([base]) => base);
    expect(bases).toEqual([...bases].sort((a, b) => a - b));
    expect(new Set(bases).size).toBe(bases.length);
    expect(PART_BASES.map(([base]) => partType(base))).toEqual(PART_BASES.map(([, name]) => name));
    expect(PART_BASES).toHaveLength(44);
    expect([PART_BASES[0], PART_BASES.at(-1)]).toEqual([[0, 'CableGlass'], [690, 'PartCreativeEnergy']]);
  });
  it('reads a negative part damage as 0, as the game reads any stack', () => expect(partType(-5)).toBe('CableGlass'));
  it('names every centre cable', () => {
    const centre = (damage: number) => classifyAe2(raw(ae2CableBus({ pos: P, center: damage })), itemNames)!.center;
    expect([0, 36, 40, 60, 520, 536].map(centre)).toEqual(['glass', 'covered', 'smart', 'dense', 'dense_covered', 'dense_covered']);
  });
  it('a cable bus without a centre cable has no centre', () =>
    expect(classifyAe2(raw(ae2CableBus({ pos: P, parts: { 0: 380 } })), itemNames))
      .toEqual({ dim: 0, pos: P, block: 'cable_bus', center: null, parts: [{ side: 0, type: 'Terminal' }], channels: 1, cells: [] }));
  it('counts one channel per side part that needs one, in side order', () => {
    const r = classifyAe2(raw(ae2CableBus({ pos: P, center: 40, parts: { 5: 240, 0: 380, 3: 440, 1: 460 } })), itemNames)!;
    expect(r.parts).toEqual([{ side: 0, type: 'Terminal' }, { side: 1, type: 'P2PTunnelME' }, { side: 3, type: 'Interface' }, { side: 5, type: 'ImportBus' }]);
    expect(r.channels).toBe(4);
  });
  it('panels, toggle buses, anchors and quartz fibres need no channel', () => {
    const r = classifyAe2(raw(ae2CableBus({ pos: P, center: 0, parts: { 0: 160, 1: 180, 2: 80, 3: 100, 4: 120, 5: 140 } })), itemNames)!;
    expect(r.parts.map((p) => p.type)).toEqual(['Monitor', 'SemiDarkMonitor', 'ToggleBus', 'InvertedToggleBus', 'CableAnchor', 'QuartzFiber']);
    expect(r.channels).toBe(0);
  });
  it('names a part of another mod by its item key and counts its channel; an unnamed part is unknown', () => {
    const r = classifyAe2(raw(te('BlockCableBus', P, {
      'def:6': stack(5300, 1, 0), 'def:3': stack(265, 1, 2), 'def:4': stack(9999, 1, 0), 'def:5': comp({}), 'def:2': int(1) })), itemNames)!;
    expect(r).toMatchObject({ center: 'glass', parts: [{ side: 3, type: 'minecraft:iron_ingot@2' }, { side: 4, type: 'unknown' }, { side: 5, type: 'unknown' }], channels: 3 });
    expect(classifyAe2(raw(te('BlockCableBus', P, { 'def:6': stack(265, 1, 60) })), itemNames)!.center).toBeNull();
  });
  it('interfaces need a channel and hold no cells', () =>
    expect(classifyAe2(raw(ae2Interface(P)), itemNames))
      .toEqual({ dim: 0, pos: P, block: 'interface', center: null, parts: [], channels: 1, cells: [] }));
  it('a controller is a whole record with no channels of its own', () =>
    expect(classifyAe2(raw(ae2Controller(P)), itemNames)).toEqual({ dim: 0, pos: P, block: 'controller', center: null, parts: [], channels: 0, cells: [] }));
  it('reads an ME chest like a drive', () =>
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[4, 0, 2000]] }], chest: true })), itemNames))
      .toEqual({ dim: 0, pos: P, block: 'chest', center: null, parts: [], channels: 1, cells: [{ key: 'minecraft:cobblestone@0', count: 2000 }] }));
  it('sums every cell per item in slot order; empty cells and empty drives hold nothing', () => {
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [
      { items: [[265, 0, 500], [4, 0, 7]] }, {}, { items: [[265, 0, 1500], [338, 0, 3], [265, 1, 1]] }] })), itemNames)!.cells)
      .toEqual([{ key: 'minecraft:iron_ingot@0', count: 2000 }, { key: 'minecraft:cobblestone@0', count: 7 },
        { key: 'minecraft:reeds@0', count: 3 }, { key: 'minecraft:iron_ingot@1', count: 1 }]);
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [] })), itemNames)!.cells).toEqual([]);
    expect(classifyAe2(raw(te('BlockDrive', P, {})), itemNames)!.cells).toEqual([]);
  });
  it('orders slots and entries by number, not by the order the NBT lists them', () => {
    const cell = (entries: Record<string, Tag>) => stack(5301, 1, 0, { tag: comp(entries) });
    const ae = (id: number, count: number) => comp({ ...stackFields(id, 0), Cnt: long(BigInt(count)) });
    const inv = comp({
      '#10': cell({ '#0': ae(338, 1) }),
      '#2': cell({ '#10': ae(4, 1), '@10': long(1n), '#2': ae(265, 1), '@2': long(1n) }),
    });
    expect(classifyAe2(raw(te('BlockDrive', P, { inv })), itemNames)!.cells!.map((c) => c.key))
      .toEqual(['minecraft:iron_ingot@0', 'minecraft:cobblestone@0', 'minecraft:reeds@0']);
  });
  it('reads Cnt when a cell has no @ count, and counts stacks above 2^31', () => {
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 640]], cntOnly: true }] })), itemNames)!.cells)
      .toEqual([{ key: 'minecraft:iron_ingot@0', count: 640 }]);
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 2 ** 40]] }] })), itemNames)!.cells)
      .toEqual([{ key: 'minecraft:iron_ingot@0', count: 2 ** 40 }]);
  });
  it('ignores the Count Byte of an AE stack, which is not its amount', () => {
    const tag = comp({ it: short(1), ic: long(200n), '#0': comp({ id: short(265), Count: byte(-56), Damage: short(0), Cnt: long(200n) }), '@0': long(200n) });
    expect(classifyAe2(raw(te('BlockDrive', P, { inv: comp({ '#0': stack(5301, 1, 0, { tag }) }) })), itemNames)!.cells)
      .toEqual([{ key: 'minecraft:iron_ingot@0', count: 200 }]);
  });
  it('a drive with an unreadable cell or stored stack is found-but-unknown', () => {
    const drive = (inv: Record<string, Tag>) => classifyAe2(raw(te('BlockDrive', P, { inv: comp(inv) })), itemNames)!.cells;
    const cell = (entries: Record<string, Tag>) => stack(5301, 1, 0, { tag: comp(entries) });
    expect(drive({ '#0': cell({ '#0': comp({ ...stackFields(9999, 0), Cnt: long(5n) }), '@0': long(5n) }) })).toBeNull();   // unknown item id
    expect(drive({ '#0': cell({ '#0': comp({ ...stackFields(265, 0) }) }) })).toBeNull();                                 // no amount at all
    expect(drive({ '#0': cell({ '#0': comp({ ...stackFields(265, 0), Cnt: long(5n) }), '@0': long(-5n) }) })).toBeNull();   // negative amount
    expect(drive({ '#0': cell({ '#0': int(3), '@0': long(5n) }) })).toBeNull();                                           // not a compound
    expect(drive({ '#0': stack(9999, 1, 0) })).toBeNull();                                                                // unknown cell item
    expect(drive({ '#0': int(1) })).toBeNull();                                                                           // slot is not a stack
  });
  it('hides a drive whose fluid cell is the only cell, even an emptied one', () => {
    expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ fluid: true }] })), itemNames)!.cells).toBeNull();
    const emptied = (key: 'ft' | 'fc') => stack(5301, 1, 0, { tag: comp(key === 'ft' ? { ft: short(0) } : { fc: long(0n) }) });
    expect(classifyAe2(raw(te('BlockDrive', P, { inv: comp({ '#0': emptied('ft') }) })), itemNames)!.cells).toBeNull();
    expect(classifyAe2(raw(te('BlockDrive', P, { inv: comp({ '#0': emptied('fc') }) })), itemNames)!.cells).toBeNull();
  });
  it('returns null for other tile entities, sky-stone chests included', () => {
    expect(classifyAe2(raw(te('BlockSkyChest', P, {})), itemNames)).toBeNull();
    expect(classifyAe2(raw(te('Chest', P, {})), itemNames)).toBeNull();
  });
});
