// tests/unit/world/logistics.test.ts — pr(), cb(), gp(), ae() build records directly; occupied() = any record or listed inventory position
import { expect, it } from 'vitest';
import type { Ae2Rec } from '../../../src/server/world/classify/ae2.ts';
import type { ConduitRec } from '../../../src/server/world/classify/enderio.ts';
import type { GtPipeRec } from '../../../src/server/world/classify/gt.ts';
import { PR_PIPES, type PrPipeRec, type PrPipeType } from '../../../src/server/world/classify/projectred.ts';
import { buildLogistics, MAX_TAPS_PER_NETWORK, type LogisticsInput } from '../../../src/server/world/logistics.ts';
import { posKey, type Vec3 } from '../../../src/server/world/model.ts';

const D = 1 << 0, U = 1 << 1, W = 1 << 4, E = 1 << 5;

/** A Project Red pipe of `type` in dim 0, routed as its part def says. */
function pr(type: PrPipeType, pos: Vec3, connMap: number, io: number | null = null, chips: string[] = []): PrPipeRec {
  const def = Object.values(PR_PIPES).find((d) => d.type === type)!;
  return { dim: 0, pos, type, routed: def.routed, connMap, io, chips };
}

/** An EnderIO conduit bundle in dim 0. */
function cb(pos: Vec3, conduits: ConduitRec['conduits']): ConduitRec {
  return { dim: 0, pos, conduits };
}

/** A GT pipe in `dim` (0 unless given) with connection bits `bits`. */
function gp(pos: Vec3, bits: number, kind: GtPipeRec['pipeKind'], dim = 0): GtPipeRec {
  return { dim, pos, mteId: kind === 'fluid' ? 5120 : 5602, connections: bits, pipeKind: kind, color: 0, voltageTier: undefined };
}

/** An AE2 block in dim 0: no centre cable, no parts, no channels, empty cells unless `opts` says otherwise. */
function ae(block: Ae2Rec['block'], pos: Vec3, opts: Partial<Pick<Ae2Rec, 'center' | 'parts' | 'channels' | 'cells'>> = {}): Ae2Rec {
  return { dim: 0, pos, block, center: null, parts: [], channels: 0, cells: [], ...opts };
}

/** No bases unless `over` names them; `occupied` = any record's position or one of the dim-0 `inventories`. */
function input(over: Partial<LogisticsInput> & { inventories?: Vec3[] }): LogisticsInput {
  const { inventories = [], ...rest } = over;
  const recs: LogisticsInput = { prPipes: [], conduits: [], gtPipes: [], ae2: [], baseOf: () => null, occupied: () => false, ...rest };
  const taken = new Set([...recs.prPipes, ...recs.conduits, ...recs.gtPipes, ...recs.ae2].map((r) => posKey(r.dim, ...r.pos)));
  for (const p of inventories) taken.add(posKey(0, ...p));
  return { ...recs, occupied: rest.occupied ?? ((dim, p) => taken.has(posKey(dim, ...p))) };
}

it('joins routed pipes, attaches the interface inventory and offers one tap per cell', () => {
  const r = buildLogistics(input({ prPipes: [
    pr('interface', [0, 64, 0], (0x41 << 5), 4), pr('junction', [1, 64, 0], (0x41 << 4) | (0x41 << 5)), pr('request', [2, 64, 0], 0x41 << 4)] }));
  expect(r.networks).toEqual([{ id: 'r:0:0:64:0', baseId: null, kind: 'routed', nodes: 3, parts: { interface: 1, junction: 1, request: 1 },
    taps: [{ pos: [0, 64, 0], dim: 0, kind: 'routed', networkId: 'r:0:0:64:0' }] }]);
  expect(r.attachments.get(posKey(0, -1, 64, 0))).toEqual([{ networkId: 'r:0:0:64:0', kind: 'routed' }]);   // io side 4 = west
  expect(r.blocks.find((b) => b.pos[0] === 1)!.connections).toBe(W | E);
});
it('a basic-pipe-only Project Red line is not a routed network', () =>
  expect(buildLogistics(input({ prPipes: [pr('basic', [0, 64, 0], 0x41 << 5), pr('basic', [1, 64, 0], 0x41 << 4)] })).networks).toEqual([]));
it('conduits form one network per logistics type; power conduits are ignored', () => {
  const r = buildLogistics(input({ conduits: [cb([0, 64, 0], [{ type: 'item', connections: E, external: W }, { type: 'power', connections: E, external: 0 }]),
                                              cb([1, 64, 0], [{ type: 'item', connections: W, external: 0 }, { type: 'power', connections: W, external: 0 }])] }));
  expect(r.networks.map((n) => [n.id, n.kind, n.nodes])).toEqual([['e:item:0:0:64:0', 'enderio', 2]]);
  expect(r.attachments.get(posKey(0, -1, 64, 0))).toEqual([{ networkId: 'e:item:0:0:64:0', kind: 'enderio' }]);
});
it('GT item and fluid pipes never join each other', () => {
  const r = buildLogistics(input({ gtPipes: [gp([0, 64, 0], E, 'item'), gp([1, 64, 0], W, 'fluid')] }));
  expect(r.networks.map((n) => n.id).sort()).toEqual(['g:fluid:0:1:64:0', 'g:item:0:0:64:0']);
});
it('AE2: channels used, controller capacity, storage bus and drive attachments', () => {
  const r = buildLogistics(input({ ae2: [ae('controller', [0, 64, 0]), ae('cable_bus', [1, 64, 0], { center: 'dense', parts: [{ side: 5, type: 'StorageBus' }], channels: 1 }),
                                         ae('drive', [1, 65, 0], { channels: 1 })] }));
  expect(r.networks).toMatchObject([{ id: 'a:0:0:64:0', kind: 'ae2', nodes: 3, channelsUsed: 2, channelsMax: 32 }]);
  expect(r.attachments.get(posKey(0, 2, 64, 0))).toEqual([{ networkId: 'a:0:0:64:0', kind: 'ae2' }]);   // chest faced by the storage bus
  expect(r.attachments.get(posKey(0, 1, 65, 0))).toEqual([{ networkId: 'a:0:0:64:0', kind: 'ae2' }]);   // the drive itself
});
it('a world without logistics yields nothing', () => expect(buildLogistics(input({}))).toEqual({ networks: [], blocks: [], attachments: new Map() }));

// ---- further rules of the model ----

it('counts pipe types and chips, and joins pipes when only one of them connects toward the other', () => {
  const r = buildLogistics(input({ prPipes: [
    pr('interface', [0, 64, 0], 0x41 << 5, 4, ['extractor', 'extractor', 'stock_keeper']),
    pr('basic', [1, 64, 0], 0x41 << 4),   // does not connect east, but the request pipe connects west toward it
    pr('request', [2, 64, 0], 0x41 << 4)] }));
  expect(r.networks.map((n) => [n.id, n.nodes, n.parts])).toEqual([
    ['r:0:0:64:0', 3, { interface: 1, basic: 1, request: 1, 'chip:extractor': 2, 'chip:stock_keeper': 1 }]]);
  expect(r.blocks.map((b) => [b.pos, b.kind, b.networkId, b.connections])).toEqual([
    [[0, 64, 0], 'routed', 'r:0:0:64:0', E], [[1, 64, 0], 'routed', 'r:0:0:64:0', W], [[2, 64, 0], 'routed', 'r:0:0:64:0', W]]);
});
it('lists an inventory once per network, and every network that reaches it', () => {
  // the interface pipe connects down onto the inventory and names it as its io side; a GT item pipe also points at it
  const r = buildLogistics(input({ prPipes: [pr('interface', [0, 65, 0], 0x41 | (0x41 << 5), 0), pr('request', [1, 65, 0], 0x41 << 4)],
                                   gtPipes: [gp([1, 64, 0], W, 'item')], inventories: [[0, 64, 0]] }));
  expect(r.attachments.get(posKey(0, 0, 64, 0))).toEqual([{ networkId: 'r:0:0:65:0', kind: 'routed' }, { networkId: 'g:item:0:1:64:0', kind: 'gtpipe' }]);
  expect(r.attachments.has(posKey(0, 1, 64, 0))).toBe(false);   // the request pipe has no outward bit toward the GT pipe below it
});
it('item and liquid conduits of the same bundles are two networks, each block with its own bits', () => {
  const r = buildLogistics(input({ conduits: [cb([0, 64, 0], [{ type: 'item', connections: E, external: 0 }, { type: 'liquid', connections: E, external: D }]),
                                              cb([1, 64, 0], [{ type: 'item', connections: W, external: U }, { type: 'liquid', connections: W, external: 0 }])] }));
  expect(r.networks.map((n) => [n.id, n.nodes, n.parts])).toEqual([['e:item:0:0:64:0', 2, { item: 2 }], ['e:liquid:0:0:64:0', 2, { liquid: 2 }]]);
  expect(r.blocks.filter((b) => b.pos[0] === 0).map((b) => [b.networkId, b.connections])).toEqual([['e:item:0:0:64:0', E], ['e:liquid:0:0:64:0', E | D]]);
  expect([r.attachments.get(posKey(0, 1, 65, 0)), r.attachments.get(posKey(0, 0, 63, 0))]).toEqual([
    [{ networkId: 'e:item:0:0:64:0', kind: 'enderio' }], [{ networkId: 'e:liquid:0:0:64:0', kind: 'enderio' }]]);
});
it('keeps dimensions apart and names networks of negative coordinates', () => {
  const r = buildLogistics(input({ gtPipes: [gp([-2, 64, -1], E, 'item', -1), gp([-1, 64, -1], W, 'item', -1), gp([-1, 64, -1], W, 'item')] }));
  expect(r.networks.map((n) => [n.id, n.nodes, n.parts])).toEqual([['g:item:-1:-2:64:-1', 2, { item: 2 }], ['g:item:0:-1:64:-1', 1, { item: 1 }]]);
});
it('offers at most one tap per 16-block cell and 12 per network, and none where every free side is taken', () => {
  const line = Array.from({ length: 16 * 13 }, (_, x) => gp([x, 64, 0], (x > 0 ? W : 0) | E, 'item'));
  const [net] = buildLogistics(input({ gtPipes: line })).networks;
  expect(net!.taps.map((t) => [t.pos, t.kind])).toEqual(Array.from({ length: MAX_TAPS_PER_NETWORK }, (_, i) => [[16 * i, 64, 0], 'pipe']));
  const boxed = buildLogistics(input({ prPipes: [pr('interface', [0, 64, 0], 0)],
                                       inventories: [[0, 63, 0], [0, 65, 0], [0, 64, -1], [0, 64, 1], [-1, 64, 0], [1, 64, 0]] }));
  expect(boxed.networks.map((n) => [n.nodes, n.taps])).toEqual([[1, []]]);
});
it('takes the base most of its members stand in', () => {
  const r = buildLogistics(input({ gtPipes: [gp([0, 64, 0], E, 'fluid'), gp([1, 64, 0], W | E, 'fluid'), gp([2, 64, 0], W, 'fluid')],
                                   baseOf: (_dim, p) => (p[0] < 2 ? '0:0:1' : '0:0:0') }));
  expect(r.networks.map((n) => n.baseId)).toEqual(['0:0:1']);
});
it('AE2: without a controller a network has 8 channels, and a part on a facing side keeps two cables apart', () => {
  const r = buildLogistics(input({ ae2: [ae('cable_bus', [0, 64, 0], { center: 'glass', parts: [{ side: 5, type: 'Terminal' }], channels: 1 }),
                                         ae('cable_bus', [1, 64, 0], { center: 'glass' }), ae('interface', [0, 65, 0], { channels: 1 })] }));
  expect(r.networks.map((n) => [n.id, n.nodes, n.channelsUsed, n.channelsMax, n.parts])).toEqual([
    ['a:0:0:64:0', 2, 2, 8, { cable_bus: 1, Terminal: 1, interface: 1 }], ['a:0:1:64:0', 1, 0, 8, { cable_bus: 1 }]]);
  expect(r.blocks.map((b) => [b.pos, b.connections])).toEqual([[[0, 64, 0], U], [[0, 65, 0], D], [[1, 64, 0], 0]]);
});
it('AE2: a cable bus offers no tap on a face its parts cover', () => {
  const r = buildLogistics(input({ ae2: [ae('cable_bus', [0, 64, 0], { center: 'smart', channels: 5,
                                                                       parts: [0, 1, 2, 3, 4].map((side) => ({ side, type: 'StorageBus' })) })],
                                   inventories: [[1, 64, 0]] }));
  expect(r.networks.map((n) => n.taps)).toEqual([[]]);
  expect(r.attachments.size).toBe(5);
});
