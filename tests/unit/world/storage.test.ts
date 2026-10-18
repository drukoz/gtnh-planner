import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createBlockReader, regionStoreFromFiles, type BlockReader } from '../../../src/server/world/area.ts';
import type { Ae2Rec } from '../../../src/server/world/classify/ae2.ts';
import { DEFAULT_DRAWER_CONFIG } from '../../../src/server/world/classify/drawers.ts';
import { openDirWorld } from '../../../src/server/world/files.ts';
import type { Attachments } from '../../../src/server/world/logistics.ts';
import { posKey, type StorageRec, type Vec3 } from '../../../src/server/world/model.ts';
import { buildStorage, drawerReach, type StorageInput } from '../../../src/server/world/storage.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import type { LogisticsNetwork, StorageBlock } from '../../../src/shared/types/world.ts';
import { reachKinds, storageTotals, type ReachMode } from '../../../src/shared/world/storage-totals.ts';
import { DEFAULT_BLOCK_IDS, makeWorld } from '../../helpers/make-world.ts';

const IRON = 'minecraft:iron_ingot@0' as StuffKey;
const NETS: LogisticsNetwork[] = [
  { id: 'r:0:0:65:0', baseId: null, kind: 'routed', nodes: 1, taps: [] },
  { id: 'e:item:0:9:64:0', baseId: null, kind: 'enderio', nodes: 1, taps: [] },
];
const ROUTED_NET = NETS[0]!;

/** A StorageRec in dim 0; contents as [key, count] pairs or null. */
function rec(kind: StorageRec['kind'], pos: Vec3, contents: Array<[string, number]> | null): StorageRec {
  return { dim: 0, pos, kind, contents: contents === null ? null : contents.map(([key, count]) => ({ key: key as StuffKey, count })) };
}
/** A StorageBlock of base '0:0:0'. */
function blk(kind: StorageBlock['kind'], pos: Vec3, contents: Array<[string, number]>, networkId: string | null): StorageBlock {
  return { id: `s:0:${pos.join(':')}`, dim: 0, pos, kind, baseId: '0:0:0', networkId, contents: contents.map(([key, count]) => ({ key: key as StuffKey, count })) };
}

// World (both chunks EID): StorageDrawers:controller at (0,64,0); fullDrawers4 at (-1,64,0), (1,64,0), (2,64,0), (4,64,0), (5,64,0);
// StorageDrawers:trim at (3,64,0); minecraft:stone at (0,64,1) and a fullDrawers4 behind it at (0,64,2).
let dir: string, reader: BlockReader;
const names = new Map(Object.entries(DEFAULT_BLOCK_IDS).map(([name, id]) => [id, name]));
const put = (p: Vec3, block: string) => ({ from: p, to: p, block });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gp-storage-'));
  const { worldDir } = await makeWorld(dir, { dims: { 0: [
    { cx: 0, cz: 0, fill: [
      put([0, 64, 0], 'StorageDrawers:controller'), put([1, 64, 0], 'StorageDrawers:fullDrawers4'), put([2, 64, 0], 'StorageDrawers:fullDrawers4'),
      put([3, 64, 0], 'StorageDrawers:trim'), put([4, 64, 0], 'StorageDrawers:fullDrawers4'), put([5, 64, 0], 'StorageDrawers:fullDrawers4'),
      put([0, 64, 1], 'minecraft:stone'), put([0, 64, 2], 'StorageDrawers:fullDrawers4')] },
    { cx: -1, cz: 0, fill: [put([-1, 64, 0], 'StorageDrawers:fullDrawers4')] },
  ] } });
  reader = createBlockReader(regionStoreFromFiles(await openDirWorld(worldDir)));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const EMPTY_INPUT = (): StorageInput => ({
  recs: [], ae2: [], attachments: new Map(), networks: [], reader, blockNames: names, drawerCfg: DEFAULT_DRAWER_CONFIG, baseOf: () => null,
});

it('reaches drawers breadth-first within range, through trim, across the x = 0 / x = -1 border', async () => {
  expect((await drawerReach(reader, names, 0, [0, 64, 0], DEFAULT_DRAWER_CONFIG)).drawers)
    .toEqual([[-1, 64, 0], [1, 64, 0], [2, 64, 0], [4, 64, 0]]);   // (5,64,0) is 5 away; (0,64,2) sits behind stone
});
it('lists controller, drawers and trim as members', async () => {
  const { members } = await drawerReach(reader, names, 0, [0, 64, 0], DEFAULT_DRAWER_CONFIG);
  expect(members).toContainEqual([0, 64, 0]);
  expect(members).toContainEqual([3, 64, 0]);
  expect(members).not.toContainEqual([0, 64, 1]);
});
it('stops the whole search when maxDrawers would be passed', async () => {
  expect((await drawerReach(reader, names, 0, [0, 64, 0], { ...DEFAULT_DRAWER_CONFIG, maxDrawers: 2 })).drawers).toEqual([[-1, 64, 0], [1, 64, 0]]);
});
it('gives reached drawers the controller network and flags only request networks as reachable', async () => {
  const recs = [rec('drawer_controller', [0, 64, 0], []), rec('drawer', [1, 64, 0], [[IRON, 1000]]),
    rec('drawer', [5, 64, 0], [[IRON, 50]]), rec('chest', [10, 64, 0], [[IRON, 30]]),
    rec('drawer', [4, 64, 0], null)];
  const attachments: Attachments = new Map([[posKey(0, 0, 64, 0), [{ networkId: 'r:0:0:65:0', kind: 'routed' }]],
                                            [posKey(0, 10, 64, 0), [{ networkId: 'e:item:0:9:64:0', kind: 'enderio' }]]]);
  const storage = await buildStorage({ ...EMPTY_INPUT(), recs, attachments, networks: NETS, baseOf: () => '0:0:4' });
  expect(storage.find((s) => s.pos[0] === 1)).toMatchObject({ id: 's:0:1:64:0', networkId: 'r:0:0:65:0', controller: [0, 64, 0], baseId: '0:0:4' });
  expect(storage.find((s) => s.pos[0] === 5)!.networkId).toBeNull();
  expect(storage.find((s) => s.pos[0] === 10)!.networkId).toBe('e:item:0:9:64:0');
  expect(storage.map((s) => s.id)).toEqual([...storage.map((s) => s.id)].sort());
  expect(storageTotals(storage, NETS, '0:0:4').get(IRON)).toMatchObject({ total: 1080, reachable: 1000 });
  expect(storageTotals(storage, NETS, 'other-base').size).toBe(0);
  const reach = (mode: ReachMode) => storageTotals(storage, NETS, '0:0:4', reachKinds(mode)).get(IRON)!.reachable;
  expect([reach('routed'), reach('ae2'), reach('direct')]).toEqual([1000, 0, 1000]);   // only the chosen logistics counts as reachable
});
it('prefers a request network over an earlier non-request one on the controller group', async () => {
  const attachments: Attachments = new Map([
    [posKey(0, 0, 64, 0), [{ networkId: 'e:item:0:9:64:0', kind: 'enderio' }]],
    [posKey(0, 3, 64, 0), [{ networkId: 'r:0:0:65:0', kind: 'routed' }]]]);   // on the trim
  const storage = await buildStorage({ ...EMPTY_INPUT(), recs: [rec('drawer_controller', [0, 64, 0], []), rec('drawer', [1, 64, 0], [[IRON, 5]])], attachments });
  expect(storage.map((s) => s.networkId)).toEqual(['r:0:0:65:0', 'r:0:0:65:0']);
});
it('lists every block holding an item with its count', () => {
  const blocks = [blk('drawer', [1, 64, 10], [[IRON, 1000]], 'r:0:0:65:10'), blk('barrel', [5, 64, 10], [[IRON, 3000]], null), blk('gt_chest', [7, 64, 10], [[IRON, 500]], null)];
  expect(storageTotals(blocks, [{ ...ROUTED_NET, id: 'r:0:0:65:10' }], '0:0:0').get(IRON)).toEqual({ total: 4500, reachable: 1000, where: [
    { kind: 'barrel', pos: [5, 64, 10], count: 3000, reachable: false }, { kind: 'drawer', pos: [1, 64, 10], count: 1000, reachable: true },
    { kind: 'gt_chest', pos: [7, 64, 10], count: 500, reachable: false }] });
});
it('breaks count ties by x, then y, then z, skips unreadable blocks and counts all blocks for a null base', () => {
  const blocks = [blk('chest', [2, 64, 1], [[IRON, 10]], null), blk('chest', [2, 63, 5], [[IRON, 10]], null), blk('chest', [1, 70, 9], [[IRON, 10]], null),
    { ...blk('chest', [0, 0, 0], [], null), contents: null }, { ...blk('chest', [3, 3, 3], [[IRON, 7]], null), baseId: 'elsewhere' }];
  const t = storageTotals(blocks, [], null).get(IRON)!;
  expect(t.where.map((w) => w.pos)).toEqual([[1, 70, 9], [2, 63, 5], [2, 64, 1], [3, 3, 3]]);
  expect(t.total).toBe(37);
});
it('maps logistics modes to the networks they can order from', () =>
  expect([reachKinds('routed'), reachKinds('ae2'), reachKinds('direct'), reachKinds(undefined)].map((s) => [...s].sort()))
    .toEqual([['routed'], ['ae2'], ['ae2', 'routed'], ['ae2', 'routed']]));
it('adds AE2 drives as reachable storage', async () => {
  const drive: Ae2Rec = { dim: 0, pos: [20, 64, 20], block: 'drive', center: null, parts: [], channels: 1, cells: [{ key: IRON, count: 500 }] };
  const iface: Ae2Rec = { dim: 0, pos: [21, 64, 20], block: 'interface', center: null, parts: [], channels: 1, cells: [] };
  const net: LogisticsNetwork = { id: 'a:0:20:64:21', baseId: null, kind: 'ae2', nodes: 2, taps: [] };
  const attachments: Attachments = new Map([[posKey(0, 20, 64, 20), [{ networkId: net.id, kind: 'ae2' }]]]);
  const storage = await buildStorage({ ...EMPTY_INPUT(), ae2: [drive, iface], attachments, networks: [net], baseOf: () => '0:0:1' });
  expect(storage).toEqual([{ id: 's:0:20:64:20', dim: 0, pos: [20, 64, 20], kind: 'ae2_drive', baseId: '0:0:1', networkId: net.id, contents: [{ key: IRON, count: 500 }] }]);
  const t = storageTotals(storage, [net], '0:0:1').get(IRON)!;
  expect([t.total, t.reachable, t.where[0]!.kind]).toEqual([500, 500, 'ae2_drive']);
  expect(storageTotals(storage, [net], '0:0:1', reachKinds('routed')).get(IRON)!.reachable).toBe(0);
});
it('handles a base with no storage at all', async () =>
  expect(storageTotals(await buildStorage(EMPTY_INPUT()), [], null)).toEqual(new Map()));
