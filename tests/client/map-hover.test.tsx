// The map's hover tooltip (spec §3.7; architecture §11, Map hover): what `describeColumn` says about a column of the
// synthetic scan, which tile column is read, the 150 ms rest before a column is described, where the box sits, and
// its markup. Server-side render only: effects do not run, so the pointer handling itself is covered end to end.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildColumnIndex, columnItemKeys, createHoverTimer, describeColumn, HOVER_DELAY_MS, mteNamesOf, topBlockAt } from '../../src/client/map/hover.ts';
import { MapTooltip, TOOLTIP_OFFSET, tooltipPosition } from '../../src/client/map/MapTooltip.tsx';
import type { MapOverlay, MapViewport } from '../../src/client/map/types.ts';
import { MapView } from '../../src/client/views/MapView.tsx';
import type { StuffKey } from '../../src/shared/keys.ts';
import type { PaletteName } from '../../src/shared/types/api.ts';
import {
  TILE_SIZE, UNKNOWN_INDEX, type LogisticsBlock, type MapTile, type PlacedMachine, type PlacedPipe, type StorageBlock, type WorldScan,
} from '../../src/shared/types/world.ts';
import { manyItems, SCAN_FIXTURE } from '../helpers/scan-fixture.ts';

const BASE_ID = '0:0:0';
const BASE_LINE = 'Base: Overworld base (4, 5)';
const IRON = 'minecraft:iron_ingot@0';

/** `describeColumn` over the Overworld of `scan` (SCAN_FIXTURE unless given). */
function linesAt(
  x: number, z: number, topY: number | null, blockName: string | null,
  more: { scan?: WorldScan; dim?: number; overlays?: MapOverlay[]; itemName?: (key: StuffKey) => string; mteName?: (mteId: number) => string | undefined } = {},
): string[] {
  const scan = more.scan ?? SCAN_FIXTURE;
  return describeColumn({
    x, z, topY, blockName, index: buildColumnIndex(scan, more.dim ?? 0), scan, overlays: more.overlays ?? [],
    ...(more.itemName === undefined ? {} : { itemName: more.itemName }),
    ...(more.mteName === undefined ? {} : { mteName: more.mteName }),
  });
}

/** The palette names of the GT cables and pipes the tests name: the SCAN_FIXTURE cable and a tin item pipe. */
const GT_NAMES: ReadonlyMap<number, string> = new Map([[1240, '1x Tin Cable'], [5600, 'Tin Item Pipe']]);
const mteName = (mteId: number): string | undefined => GT_NAMES.get(mteId);

/** SCAN_FIXTURE plus more records. */
function withRecords(more: { machines?: PlacedMachine[]; pipes?: PlacedPipe[]; storage?: StorageBlock[]; logisticsBlocks?: LogisticsBlock[] }): WorldScan {
  return {
    ...SCAN_FIXTURE,
    machines: [...SCAN_FIXTURE.machines, ...(more.machines ?? [])],
    pipes: [...SCAN_FIXTURE.pipes, ...(more.pipes ?? [])],
    storage: [...SCAN_FIXTURE.storage, ...(more.storage ?? [])],
    logisticsBlocks: [...(SCAN_FIXTURE.logisticsBlocks ?? []), ...(more.logisticsBlocks ?? [])],
  };
}

const machine = (pos: [number, number, number], fields: Partial<PlacedMachine>): PlacedMachine => ({ dim: 0, pos, mteId: 0, facing: 2, color: -1, baseId: BASE_ID, ...fields });
const storage = (pos: [number, number, number], kind: StorageBlock['kind'], contents: StorageBlock['contents']): StorageBlock => ({
  id: `s:0:${pos.join(':')}`, dim: 0, pos, kind, baseId: BASE_ID, networkId: null, contents,
});

describe('describeColumn', () => {
  it('names a GT machine with its tier and facing, then the base the column lies in', () => {
    // SCAN_FIXTURE's Basic Macerator (LV) at (3, 64, 3) faces south (3) inside base 0:0:0
    expect(linesAt(3, 3, 64, 'Basic Macerator')).toEqual(['Basic Macerator', '3 64 3', 'Basic Macerator (LV) · facing south', BASE_LINE]);
    const assembler = machine([9, 64, 1], { mteId: 2002, kind: 'basic', tier: 2, name: 'Assembling Machine', storedEU: 12_345 });
    expect(linesAt(9, 1, 64, 'Assembling Machine (MV)', { scan: withRecords({ machines: [assembler] }) }))
      .toEqual(['Assembling Machine (MV)', '9 64 1', 'Assembling Machine (MV) · facing north · stored 12,345 EU', BASE_LINE]);
  });

  it('says "stored" only for a buffer that holds energy, and leaves out a tier or facing it does not know', () => {
    const empty = machine([9, 64, 1], { mteId: 2002, tier: 2, name: 'Assembling Machine', storedEU: 0 });   // the scan writes 0 for "none"
    const odd = machine([9, 64, 2], { mteId: 1000, facing: 9, name: 'Electric Blast Furnace', kind: 'multiblock' });
    const scan = withRecords({ machines: [empty, odd] });
    expect(linesAt(9, 1, 64, null, { scan })[1]).toBe('Assembling Machine (MV) · facing north');
    expect(linesAt(9, 2, 64, null, { scan })[1]).toBe('Electric Blast Furnace');
    expect(linesAt(7, 3, 64, null)).toEqual(['7 64 3', 'Unknown machine #31999 · facing north', BASE_LINE]);   // not in the export
    expect(linesAt(1, 0, 64, null)[1]).toBe('Basic Steam Turbine (LV) · facing east');
  });

  it("faces a basic machine where GT draws its front (mainFacing), and names its output side when that is another one", () => {
    const basic = (pos: [number, number, number], facing: number, mainFacing: number): PlacedMachine =>
      machine(pos, { mteId: 2001, kind: 'basic', tier: 1, name: 'Basic Macerator', facing, mainFacing });
    const scan = withRecords({
      machines: [
        basic([9, 64, 0], 2, 3),   // as placed: the front toward the player (south), the output behind it (north)
        basic([9, 64, 1], 1, 2),   // the output wrenched to the top: the front still faces north
        basic([9, 64, 2], 4, 1),   // mainFacing up: GT draws the front on facing instead, and there is no other output side
        basic([9, 64, 3], 5, 5),   // front and output on one side
      ],
    });
    expect(linesAt(9, 0, 64, null, { scan })[1]).toBe('Basic Macerator (LV) · facing south · output north');
    expect(linesAt(9, 1, 64, null, { scan })[1]).toBe('Basic Macerator (LV) · facing north · output up');
    expect(linesAt(9, 2, 64, null, { scan })[1]).toBe('Basic Macerator (LV) · facing west');
    expect(linesAt(9, 3, 64, null, { scan })[1]).toBe('Basic Macerator (LV) · facing east');
    // without mainFacing (every machine but a basic one) the front is facing, as before
    expect(linesAt(3, 3, 64, null)[1]).toBe('Basic Macerator (LV) · facing south');
  });

  it('gives a plain column outside every base exactly its block name and position', () => {
    expect(linesAt(20, 20, 64, 'Grass Block')).toEqual(['Grass Block', '20 64 20']);
  });

  it("lists three of a storage block's contents, largest first, then how many more", () => {
    const drawer = storage([8, 64, 6], 'drawer', [
      { key: 'minecraft:redstone@0', count: 64 }, { key: IRON, count: 1500 }, { key: 'minecraft:gold_ingot@0', count: 12 },
      { key: 'minecraft:coal@0', count: 64 }, { key: 'minecraft:cobblestone@0', count: 640 },
    ]);
    const scan = withRecords({ storage: [drawer] });
    const names: Record<StuffKey, string> = { [IRON]: 'Iron Ingot', 'minecraft:cobblestone@0': 'Cobblestone', 'minecraft:coal@0': 'Coal' };
    // coal and redstone tie at 64: the key decides
    expect(linesAt(8, 6, 64, 'Drawer', { scan, itemName: (key) => names[key] ?? key }))
      .toEqual(['Drawer', '8 64 6', 'Drawer · 1,500× Iron Ingot · 640× Cobblestone · 64× Coal · +2 more', BASE_LINE]);
    expect(columnItemKeys(buildColumnIndex(scan, 0), 8, 6, 64)).toEqual([IRON, 'minecraft:cobblestone@0', 'minecraft:coal@0']);   // the names to ask for
  });

  it('keeps a storage block with hundreds of item kinds to three of them', () => {
    // manyItems puts one chest at (0, 64, 20), outside the base, holding test:item@0 … @299 (item i: 10·i, item 0: 1)
    expect(linesAt(0, 20, 64, 'Chest', { scan: manyItems(300, 1) }))
      .toEqual(['Chest', '0 64 20', 'Chest · 2,990× test:item@299 · 2,980× test:item@298 · 2,970× test:item@297 · +297 more']);
  });

  it('says when a storage block is empty or its contents are unknown', () => {
    expect(linesAt(3, 10, 64, null)[1]).toBe('Drawer · contents unknown');   // the compacting drawer
    expect(linesAt(6, 10, 64, null)[1]).toBe(`Chest · 30× ${IRON}`);        // no name source: the key itself
    expect(linesAt(5, 10, 64, null)[1]).toBe('JABBA barrel · empty');       // nothing in it
  });

  it('counts the drawers joined to a drawer controller instead of calling it empty', () => {
    // A controller holds nothing of its own (the scan writes []): the drawers that name it as their controller are its network.
    const controller = (pos: [number, number, number]): StorageBlock => storage(pos, 'drawer_controller', []);
    const joinedTo = (c: [number, number, number], pos: [number, number, number], dim = 0): StorageBlock => (
      { ...storage(pos, 'drawer', [{ key: IRON, count: 1 }]), id: `s:${dim}:${pos.join(':')}`, dim, controller: c }
    );
    const scan = withRecords({
      storage: [
        controller([9, 64, 9]), joinedTo([9, 64, 9], [9, 64, 8]), joinedTo([9, 64, 9], [8, 64, 9]),
        joinedTo([9, 64, 9], [9, 64, 7], -1),                       // the Nether drawer at the same coordinates is not this controller's
        controller([9, 64, 3]), joinedTo([9, 64, 3], [9, 65, 3]),   // one drawer, on top of its controller
        controller([9, 64, 1]),                                     // none joined
      ],
    });
    expect(linesAt(9, 9, 64, 'Controller', { scan })[2]).toBe('Drawer controller · 2 drawers');
    expect(linesAt(9, 3, 65, 'Drawer', { scan })).toEqual(['Drawer', '9 65 3', `Drawer · 1× ${IRON}`, 'y 64 · Drawer controller · 1 drawer', BASE_LINE]);
    expect(linesAt(9, 1, 64, 'Controller', { scan })[2]).toBe('Drawer controller');
  });

  it('lists the records of a column top-most first, only those at or below the top block, each lower one with its height', () => {
    // the routed pipe at (1, 65, 10) joins west, above the drawer at (1, 64, 10)
    expect(linesAt(1, 10, 65, 'Block', { itemName: (key) => (key === IRON ? 'Iron Ingot' : key) }))
      .toEqual(['Block', '1 65 10', 'Routed pipe · connected west', 'y 64 · Drawer · 1,000× Iron Ingot', BASE_LINE]);
    expect(linesAt(1, 10, 64, 'Drawer', { itemName: () => 'Iron Ingot' })).toEqual(['Drawer', '1 64 10', 'Drawer · 1,000× Iron Ingot', BASE_LINE]);   // Y ≤ 64
    // two empty JABBA barrels stacked at (5, 64..65, 10)
    expect(linesAt(5, 10, 65, 'JABBA Barrel')).toEqual(['JABBA Barrel', '5 65 10', 'JABBA barrel · empty', 'y 64 · JABBA barrel · empty', BASE_LINE]);
    // at one height a machine comes before its storage (a GT chest is both)
    const quantum = machine([7, 64, 10], { mteId: 125, name: 'Quantum Chest LV', kind: 'other' });
    const scan = withRecords({ machines: [quantum], storage: [storage([7, 64, 10], 'gt_chest', [{ key: IRON, count: 500 }])] });
    expect(linesAt(7, 10, 64, 'Quantum Chest LV', { scan }).slice(2, 4)).toEqual(['Quantum Chest LV · facing north', `GT chest · 500× ${IRON}`]);
    // under a roof: the EBF controller at (8, 64, 8) below its coil ring, whose top coil is the column's top block
    const ebf = machine([8, 64, 8], { mteId: 1000, name: 'Electric Blast Furnace', kind: 'multiblock' });
    expect(linesAt(8, 8, 66, 'Kanthal Coil Block', { scan: withRecords({ machines: [ebf] }) }))
      .toEqual(['Kanthal Coil Block', '8 66 8', 'y 64 · Electric Blast Furnace · facing north', BASE_LINE]);
  });

  it('lists five records at most and counts the rest, so the base and overlay lines always show', () => {
    // a riser of eight LV cables at (9, 57..64, 4), and a planned line that says something about the column
    const riser = Array.from({ length: 8 }, (_, i): PlacedPipe => ({ dim: 0, pos: [9, 57 + i, 4], mteId: 1240, connections: 1 | 2, kind: 'cable', voltageTier: 1, amps: 1 }));
    const planned: MapOverlay = { id: 'plan', draw() {}, describe: () => ['Planned: Wiremill (MV)'] };
    const scan = withRecords({ pipes: riser });
    expect(linesAt(9, 4, 64, '1x Tin Cable', { scan, overlays: [planned], mteName })).toEqual([
      '1x Tin Cable', '9 64 4', '1x Tin Cable · LV · 1 A', 'y 63 · 1x Tin Cable · LV · 1 A', 'y 62 · 1x Tin Cable · LV · 1 A',
      'y 61 · 1x Tin Cable · LV · 1 A', 'y 60 · 1x Tin Cable · LV · 1 A', '+3 more below', BASE_LINE, 'Planned: Wiremill (MV)',
    ]);
    // at Y ≤ 61 five are left: all of them, with nothing more to count
    expect(linesAt(9, 4, 61, '1x Tin Cable', { scan })).toEqual([
      '1x Tin Cable', '9 61 4', 'Cable · LV · 1 A', 'y 60 · Cable · LV · 1 A', 'y 59 · Cable · LV · 1 A', 'y 58 · Cable · LV · 1 A',
      'y 57 · Cable · LV · 1 A', BASE_LINE,
    ]);
    // a wall of six chests at (9, 59..64, 5): only the five shown have their item names asked for
    const wall = Array.from({ length: 6 }, (_, i) => storage([9, 64 - i, 5], 'chest', [{ key: `test:item@${i}`, count: 1 }]));
    const walled = withRecords({ storage: wall });
    expect(linesAt(9, 5, 64, 'Chest', { scan: walled }).slice(2)).toEqual([
      'Chest · 1× test:item@0', 'y 63 · Chest · 1× test:item@1', 'y 62 · Chest · 1× test:item@2', 'y 61 · Chest · 1× test:item@3',
      'y 60 · Chest · 1× test:item@4', '+1 more below', BASE_LINE,
    ]);
    expect(columnItemKeys(buildColumnIndex(walled, 0), 9, 5, 64)).toEqual(['test:item@0', 'test:item@1', 'test:item@2', 'test:item@3', 'test:item@4']);
  });

  it('describes GT cables and pipes once each by their palette names, and other logistics blocks with their connected sides', () => {
    expect(linesAt(2, 0, 64, '1x Tin Cable', { mteName })).toEqual(['1x Tin Cable', '2 64 0', '1x Tin Cable · LV · 1 A', BASE_LINE]);
    expect(linesAt(2, 0, 64, null)).toEqual(['2 64 0', 'Cable · LV · 1 A', BASE_LINE]);   // palette names not loaded (yet): the kind
    // the cable under a battery buffer is named by its own palette entry, not by the column's top block
    const buffer = machine([2, 65, 0], { mteId: 161, tier: 1, name: 'Battery Buffer', kind: 'other', facing: 1 });
    expect(linesAt(2, 0, 65, 'Battery Buffer', { scan: withRecords({ machines: [buffer] }), mteName }))
      .toEqual(['Battery Buffer', '2 65 0', 'Battery Buffer (LV) · facing up', 'y 64 · 1x Tin Cable · LV · 1 A', BASE_LINE]);
    const gtpipe = (pos: [number, number, number]): LogisticsBlock => ({ dim: 0, pos, kind: 'gtpipe', networkId: 'g:1', connections: 3 });
    const scan = withRecords({
      pipes: [
        { dim: 0, pos: [8, 64, 0], mteId: 5600, connections: 16, kind: 'item' }, { dim: 0, pos: [8, 63, 0], mteId: 5120, connections: 32, kind: 'fluid' },
        { dim: 0, pos: [8, 64, 1], mteId: 5999, connections: 0 },
      ],
      logisticsBlocks: [
        gtpipe([8, 64, 0]), gtpipe([8, 63, 0]),   // Plan 4 lists every GT item and fluid pipe a second time, as a gtpipe block
        { dim: 0, pos: [8, 64, 2], kind: 'enderio', networkId: null, connections: 0 },
        { dim: 0, pos: [8, 64, 3], kind: 'ae2', networkId: null, connections: 1 | 2 | 8 },
      ],
    });
    // the fluid pipe (5120) has no palette name: its kind
    expect(linesAt(8, 0, 64, 'Tin Item Pipe', { scan, mteName })).toEqual(['Tin Item Pipe', '8 64 0', 'Tin Item Pipe', 'y 63 · Fluid pipe', BASE_LINE]);
    expect(linesAt(8, 1, 64, null, { scan, mteName })[1]).toBe('GT pipe');   // a pipe the export does not know
    expect(linesAt(8, 2, 64, null, { scan })[1]).toBe('EnderIO conduit · not connected');
    expect(linesAt(8, 3, 64, null, { scan })[1]).toBe('AE2 part · connected down, up, south');
    expect(linesAt(0, 10, 65, null)[1]).toBe('Routed pipe · connected east');
  });

  it('leaves out the block, its position and the records without a top block, and the name while it is unknown', () => {
    expect(linesAt(3, 3, null, null)).toEqual([BASE_LINE]);   // air, an unread chunk or a tile not loaded: only base and overlay lines
    expect(linesAt(20, 20, null, null)).toEqual([]);          // nothing to say: no tooltip
    expect(linesAt(3, 3, 64, null)).toEqual(['3 64 3', 'Basic Macerator (LV) · facing south', BASE_LINE]);   // names not loaded (yet)
    expect(linesAt(3, 3, 64, '')).toEqual(['3 64 3', 'Basic Macerator (LV) · facing south', BASE_LINE]);
  });

  it('takes the base from the dimension the index was built for', () => {
    expect(linesAt(4, 5, 64, 'Stone')).toEqual(['Stone', '4 64 5', BASE_LINE]);
    expect(linesAt(4, 5, 64, 'Stone', { dim: 7 })).toEqual(['Stone', '4 64 5']);   // the same column of the Twilight Forest
    expect(linesAt(3, 3, 64, 'Stone', { dim: 7 })).toEqual(['Stone', '3 64 3']);   // and none of the Overworld's machines
  });

  it("appends every overlay's own lines last, in overlay order, without empty lines", () => {
    const planned: MapOverlay = { id: 'plan', draw() {}, describe: (x, z) => (x === 3 && z === 3 ? ['Planned: Wiremill (MV)'] : null) };
    const hookup: MapOverlay = { id: 'hookup', draw() {}, describe: () => ['', 'Tap power here'] };
    const silent: MapOverlay = { id: 'silent', draw() {}, describe: () => null };
    const plain: MapOverlay = { id: 'plain', draw() {} };
    const overlays = [plain, planned, silent, hookup];
    expect(linesAt(3, 3, 64, 'Basic Macerator', { overlays }))
      .toEqual(['Basic Macerator', '3 64 3', 'Basic Macerator (LV) · facing south', BASE_LINE, 'Planned: Wiremill (MV)', 'Tap power here']);
    expect(linesAt(20, 20, null, null, { overlays })).toEqual(['Tap power here']);
  });
});

describe('mteNamesOf', () => {
  it('names each GT tile entity of the palette names by its mteId, leaving out ids the export does not know', () => {
    const GT = 'gregtech:gt.blockmachines';
    const entries: PaletteName[] = [
      { block: { id: 'minecraft:air', meta: 0 }, name: 'Air' },
      { block: { id: GT, meta: 0, mteId: 1246 }, name: '1x Tin Cable' },
      { block: { id: GT, meta: 4, mteId: 1246 }, name: '1x Tin Cable' },                 // one tile entity in several block states
      { block: { id: GT, meta: 2, mteId: 31999 }, name: 'Unknown machine #31999' },      // the route's word for an id it cannot name
      { block: { id: GT, meta: 1 }, name: GT },                                          // no tile id
      { block: { id: 'minecraft:stone', meta: 0 }, name: 'Stone' },
      { block: { id: GT, meta: 3, mteId: 2001 }, name: 'Basic Macerator' },
    ];
    expect([...mteNamesOf(entries)]).toEqual([[1246, '1x Tin Cable'], [2001, 'Basic Macerator']]);
    expect(mteNamesOf([]).size).toBe(0);
  });
});

describe('topBlockAt', () => {
  /** A tile of the Overworld whose listed columns `[lx, lz, palette index, height]` are set; every other one is air. */
  function tileWith(tx: number, tz: number, columns: Array<[number, number, number, number]>): MapTile {
    const top = new Uint32Array(TILE_SIZE * TILE_SIZE), height = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (const [lx, lz, index, h] of columns) {
      top[lz * TILE_SIZE + lx] = index;
      height[lz * TILE_SIZE + lx] = h;
    }
    return { dim: 0, tx, tz, size: TILE_SIZE, top, height };
  }
  const NAMES = ['Air', 'Unknown block', 'Stone', 'Bedrock'];
  // tile (−1, 0): x −1 is its column lx 63
  const tile = tileWith(-1, 0, [[63, 5, 2, 63], [62, 5, 3, 0], [61, 5, UNKNOWN_INDEX, 70], [60, 5, UNKNOWN_INDEX, 0]]);
  const NOTHING = { topY: null, blockName: null };

  it('reads the top block of a column and names it from the palette names', () => {
    expect(topBlockAt(tile, -1, 5, NAMES)).toEqual({ topY: 63, blockName: 'Stone' });
    expect(topBlockAt(tile, -2, 5, NAMES)).toEqual({ topY: 0, blockName: 'Bedrock' });          // a real block at y 0
    expect(topBlockAt(tile, -3, 5, NAMES)).toEqual({ topY: 70, blockName: 'Unknown block' });   // a block the scan could not name
    expect(topBlockAt(tile, -1, 5, null)).toEqual({ topY: 63, blockName: null });               // names not loaded (yet)
  });

  it('finds no block in air, in a chunk the scan did not read, or without the tile', () => {
    expect(topBlockAt(tile, -5, 5, NAMES)).toEqual(NOTHING);       // air
    expect(topBlockAt(tile, -4, 5, NAMES)).toEqual(NOTHING);       // unknown with height 0: not read
    expect(topBlockAt(undefined, -1, 5, NAMES)).toEqual(NOTHING);  // tile not loaded
    expect(topBlockAt(tile, 0, 5, NAMES)).toEqual(NOTHING);        // a column of another tile
  });
});

describe('createHoverTimer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('describes only the latest column, once the pointer has rested on it for 150 ms', () => {
    vi.useFakeTimers();
    const shown: Array<{ x: number; z: number } | null> = [];
    const timer = createHoverTimer((column) => shown.push(column));
    expect(HOVER_DELAY_MS).toBe(150);
    timer.move(1, 1);   // A
    vi.advanceTimersByTime(60);
    timer.move(2, 1);   // B
    vi.advanceTimersByTime(60);
    timer.move(3, 1);   // C
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    timer.move(3, 1);   // still C: the wait goes on
    expect(shown).toEqual([]);   // A and B were never described, C not yet
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([{ x: 3, z: 1 }]);
    timer.move(3, 1);   // moving inside the shown column keeps the tooltip
    timer.move(4, 1);   // leaving it hides the tooltip at once
    expect(shown).toEqual([{ x: 3, z: 1 }, null]);
    timer.clear();      // the pointer left before D was described
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(shown).toEqual([{ x: 3, z: 1 }, null]);
    timer.move(4, 1);   // back on D after a clear: a new wait
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    timer.clear();
    expect(shown).toEqual([{ x: 3, z: 1 }, null, { x: 4, z: 1 }, null]);
  });
});

describe('tooltipPosition', () => {
  const view: MapViewport = { dim: 0, centerX: 0, centerZ: 0, pixelsPerBlock: 4, width: 400, height: 300, y: 255 };
  const size = { width: 100, height: 40 };
  /** The column under screen point (px, py) of `v`. */
  const columnAt = (v: MapViewport, px: number, py: number) => ({
    x: Math.floor((px - v.width / 2) / v.pixelsPerBlock + v.centerX), z: Math.floor((py - v.height / 2) / v.pixelsPerBlock + v.centerZ),
  });
  const at = (v: MapViewport, px: number, py: number) => tooltipPosition(v, columnAt(v, px, py), [px, py], size);
  /** Whether the tooltip at `p` overlaps the screen square of the block under (px, py). */
  const coversBlock = (v: MapViewport, px: number, py: number, p: { left: number; top: number }): boolean => {
    const { x, z } = columnAt(v, px, py);
    const bx = (x - v.centerX) * v.pixelsPerBlock + v.width / 2, by = (z - v.centerZ) * v.pixelsPerBlock + v.height / 2;
    return p.left < bx + v.pixelsPerBlock && bx < p.left + size.width && p.top < by + v.pixelsPerBlock && by < p.top + size.height;
  };

  it('sits 12 px right of and below the pointer, and flips left or up at the edge of the map', () => {
    expect(TOOLTIP_OFFSET).toBe(12);
    expect(at(view, 100, 80)).toEqual({ left: 112, top: 92 });
    expect(at(view, 390, 80)).toEqual({ left: 278, top: 92 });    // no room on the right
    expect(at(view, 100, 290)).toEqual({ left: 112, top: 238 });  // no room below
    for (const [px, py] of [[100, 80], [390, 80], [100, 290], [399, 299]] as const) expect(coversBlock(view, px, py, at(view, px, py))).toBe(false);
  });

  it('keeps clear of a block drawn wider than the offset, moving with whole blocks', () => {
    const zoomed = { ...view, pixelsPerBlock: 32 };   // block (0, 0) is drawn at 200..232 × 150..182
    expect(at(zoomed, 210, 160)).toEqual({ left: 244, top: 194 });
    expect(at(zoomed, 230, 180)).toEqual({ left: 244, top: 194 });   // the same block: the same place
    expect(at(zoomed, 390, 160)).toEqual({ left: 248, top: 194 });   // block (5, 0) at 360..392: flipped left of it
    for (const [px, py] of [[210, 160], [230, 180], [390, 160], [390, 290]] as const) expect(coversBlock(zoomed, px, py, at(zoomed, px, py))).toBe(false);
  });

  it('stays inside a map too small for it on either side', () => {
    expect(tooltipPosition({ ...view, width: 80, height: 30 }, { x: 0, z: 0 }, [40, 15], size)).toEqual({ left: 0, top: 0 });
  });
});

describe('MapTooltip', () => {
  it('renders the lines in order as a tooltip that takes no pointer events', () => {
    const html = renderToStaticMarkup(<MapTooltip id="map-tip" lines={['Basic Macerator', '3 64 3', BASE_LINE]} />);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('id="map-tip"');
    expect(html).toContain('pointer-events:none');
    // the NEI look is the stylesheet's (`.map-tooltip`); the inline style keeps only what the map and the pointer need
    expect(html).toContain('class="map-tooltip"');
    expect(html).not.toMatch(/class="[^"]*\bsmall\b/);
    expect(html).toMatch(/style="position:absolute;pointer-events:none"/);
    const at = ['Basic Macerator', '3 64 3', BASE_LINE].map((line) => html.indexOf(`>${line}<`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is not part of the map until a column is described', () => {
    const html = renderToStaticMarkup(<MapView scanId={SCAN_FIXTURE.id} dim={0} scan={SCAN_FIXTURE} focus={[4.5, 5.5]} />);
    expect(html).toContain('role="img"');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('aria-describedby');
  });
});
