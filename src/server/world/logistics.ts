// Logistics networks and their tap points (Plan 4 Task 10; spec §3.4, world-format §6.2 and §6.9–§6.11): Project Red
// routed networks, EnderIO item and liquid conduit networks, GT item and fluid pipe networks and AE2 networks, each with
// the inventories it attaches (for storage reach), the blocks it is made of (for the map) and where a new line can hook
// in. Every kind is optional: a world without any of them yields no networks.

import type { LogisticsBlock, LogisticsNetwork, TapPoint } from '../../shared/types/world.ts';
import type { Ae2Rec } from './classify/ae2.ts';
import type { ConduitRec } from './classify/enderio.ts';
import type { GtPipeRec } from './classify/gt.ts';
import { prConnects, type PrPipeRec } from './classify/projectred.ts';
import { comparePos, majority, MAX_TAPS_PER_NETWORK, pickTaps, smallestPos, UnionFind } from './graph.ts';
import { OPPOSITE, posKey, step, type Vec3 } from './model.ts';

export { MAX_TAPS_PER_NETWORK } from './graph.ts';

export interface LogisticsInput {
  prPipes: PrPipeRec[];
  conduits: ConduitRec[];
  /** Every GT pipe and cable: item and fluid pipes form networks, and a pipe bit toward any of them attaches nothing. */
  gtPipes: GtPipeRec[];
  ae2: Ae2Rec[];
  /** The base a position belongs to, if any. */
  baseOf: (dim: number, pos: Vec3) => string | null;
  /** Whether a position holds anything the scan classified; a tap needs a free neighbour. */
  occupied: (dim: number, pos: Vec3) => boolean;
}

/** The networks attached to each inventory, keyed by the inventory's `posKey`; one entry per network, in network order. */
export type Attachments = Map<string /* posKey of an inventory */, Array<{ networkId: string; kind: LogisticsNetwork['kind'] }>>;

export interface LogisticsResult { networks: LogisticsNetwork[]; blocks: LogisticsBlock[]; attachments: Attachments }

/** Channels per controller face touching a connected AE2 block, and of a network without a controller (estimates, world-format §6.11). */
const AE2_CHANNELS_PER_CONTROLLER_FACE = 32;
const AE2_CHANNELS_WITHOUT_CONTROLLER = 8;

const SIDES = [0, 1, 2, 3, 4, 5] as const;
const ALL_SIDES = 0x3f;

const keyAt = (dim: number, p: Vec3): string => posKey(dim, p[0], p[1], p[2]);
const keyOf = (r: { dim: number; pos: Vec3 }): string => keyAt(r.dim, r.pos);
const hasBit = (bits: number, side: number): boolean => (bits & (1 << side)) !== 0;

/** One member of a network as the assembly sees it, whatever mod it comes from. */
interface Member {
  dim: number; pos: Vec3;
  /** `LogisticsBlock.connections`: the sides it is connected on. A side outside it may offer a tap. */
  connections: number;
  /** The sides a new pipe or cable could join it on (all six, but an AE2 cable bus only where it connects). */
  joinable: number;
  /** The inventories it attaches. */
  attaches: Vec3[];
  /** What it adds to the network's `parts`, one name per count. */
  parts: string[];
  /** Project Red: a routed pipe (a routed network needs one). */
  routed?: boolean;
  /** AE2: the channels it uses, and on a controller the faces joined to a neighbour. */
  channels?: number; controllerFaces?: number;
}

/** The members of one kind of network and how they are grouped. */
interface Graph { members: Map<string, Member>; uf: UnionFind }

/** How the networks of one graph are named and judged. */
interface Family {
  kind: LogisticsNetwork['kind'];
  /** The id up to the position: `r`, `e:item`, `g:fluid`, `a`, … */
  prefix: string;
  tapKind: TapPoint['kind'];
  /** Whether a group is a network at all (every group when absent). */
  keep?: (members: Member[]) => boolean;
  /** AE2 only: the channel estimate. */
  channels?: (members: Member[]) => Pick<LogisticsNetwork, 'channelsUsed' | 'channelsMax'>;
}

interface Built { dim: number; pos: Vec3; network: LogisticsNetwork; members: Member[] }

/** The parts of a network: each name's count, in the order the names first appear. */
function countParts(members: Member[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const m of members) for (const name of m.parts) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Object.fromEntries(counts);
}

/**
 * The networks of one graph: one per group the family keeps, named `<prefix>:<dim>:<x>:<y>:<z>` after its smallest
 * member, with its base by majority, its parts, and its taps (members with a joinable side that is not connected and
 * whose neighbour is free, one per 16-block cell, at most `MAX_TAPS_PER_NETWORK`). Members are in position order and
 * networks sorted by dimension, then position.
 */
function networksOf(graph: Graph, family: Family, input: LogisticsInput): Built[] {
  const { kind, prefix, tapKind } = family;
  const built: Built[] = [];
  for (const keys of graph.uf.groups().values()) {
    const members = keys.map((k) => graph.members.get(k)!).sort((a, b) => comparePos(a.pos, b.pos));
    if (family.keep !== undefined && !family.keep(members)) continue;
    const dim = members[0]!.dim;
    const pos = smallestPos(members.map((m) => m.pos));
    const id = `${prefix}:${keyAt(dim, pos)}`;
    const free = members.filter((m) =>
      SIDES.some((s) => hasBit(m.joinable, s) && !hasBit(m.connections, s) && !input.occupied(dim, step(m.pos, s))));
    const taps = pickTaps(free.map((m) => m.pos), MAX_TAPS_PER_NETWORK)
      .map((p): TapPoint => ({ pos: [p[0], p[1], p[2]], dim, kind: tapKind, networkId: id }));
    const network: LogisticsNetwork = {
      id, baseId: majority(members.map((m) => input.baseOf(m.dim, m.pos))), kind, nodes: members.length,
      ...family.channels?.(members), parts: countParts(members), taps,
    };
    built.push({ dim, pos, network, members });
  }
  return built.sort((a, b) => a.dim - b.dim || comparePos(a.pos, b.pos));
}

/**
 * Project Red: every pipe, routed or not, joins a neighbouring pipe when either connects toward the other. A pipe
 * attaches what its outward bits point at (unless that is another Project Red pipe) and its `io` side.
 */
function routedGraph(pipes: PrPipeRec[]): Graph {
  const at = new Map<string, PrPipeRec>();
  for (const p of pipes) at.set(keyOf(p), p);
  const uf = new UnionFind(), members = new Map<string, Member>();
  for (const [k, p] of at) {
    uf.find(k);
    let connections = 0;
    const attaches: Vec3[] = [];
    for (const s of SIDES) {
      if (prConnects(p.connMap, s)) connections |= 1 << s;
      const n = step(p.pos, s), nk = keyAt(p.dim, n), other = at.get(nk);
      if (other !== undefined) {
        if (prConnects(p.connMap, s) || prConnects(other.connMap, OPPOSITE[s])) uf.union(k, nk);
      } else if (hasBit(p.connMap, s)) attaches.push(n);
    }
    if (p.io !== null) attaches.push(step(p.pos, p.io));
    const parts = [p.type, ...p.chips.map((c) => `chip:${c}`)];
    members.set(k, { dim: p.dim, pos: p.pos, connections, joinable: ALL_SIDES, attaches, parts, routed: p.routed });
  }
  return { members, uf };
}

/**
 * EnderIO conduits of one type: bundles that carry it join when either has the conduit-to-conduit bit toward the other;
 * external connections attach inventories.
 */
function conduitGraph(bundles: ConduitRec[], type: 'item' | 'liquid'): Graph {
  const at = new Map<string, { dim: number; pos: Vec3; connections: number; external: number }>();
  for (const b of bundles) {
    const own = b.conduits.filter((c) => c.type === type);
    if (own.length === 0) continue;
    const connections = own.reduce((bits, c) => bits | c.connections, 0), external = own.reduce((bits, c) => bits | c.external, 0);
    at.set(keyOf(b), { dim: b.dim, pos: b.pos, connections, external });
  }
  const uf = new UnionFind(), members = new Map<string, Member>();
  for (const [k, c] of at) {
    uf.find(k);
    const attaches: Vec3[] = [];
    for (const s of SIDES) {
      const nk = keyAt(c.dim, step(c.pos, s)), other = at.get(nk);
      if (other !== undefined && (hasBit(c.connections, s) || hasBit(other.connections, OPPOSITE[s]))) uf.union(k, nk);
      if (hasBit(c.external, s)) attaches.push(step(c.pos, s));
    }
    members.set(k, { dim: c.dim, pos: c.pos, connections: c.connections | c.external, joinable: ALL_SIDES, attaches, parts: [type] });
  }
  return { members, uf };
}

/** GT pipes of one kind: neighbours of that kind join by either bit; a bit toward a block that is no GT pipe attaches it. */
function gtPipeGraph(pipes: GtPipeRec[], kind: 'item' | 'fluid'): Graph {
  const anyPipe = new Set(pipes.map(keyOf));
  const at = new Map<string, GtPipeRec>();
  for (const p of pipes) if (p.pipeKind === kind) at.set(keyOf(p), p);
  const uf = new UnionFind(), members = new Map<string, Member>();
  for (const [k, p] of at) {
    uf.find(k);
    const attaches: Vec3[] = [];
    for (const s of SIDES) {
      const n = step(p.pos, s), nk = keyAt(p.dim, n), other = at.get(nk);
      if (other !== undefined && (hasBit(p.connections, s) || hasBit(other.connections, OPPOSITE[s]))) uf.union(k, nk);
      if (hasBit(p.connections, s) && !anyPipe.has(nk)) attaches.push(n);
    }
    members.set(k, { dim: p.dim, pos: p.pos, connections: p.connections, joinable: ALL_SIDES, attaches, parts: [kind] });
  }
  return { members, uf };
}

/** Whether an AE2 block connects on `side`: a cable bus only with a centre cable and no part there, every other block always. */
function ae2ConnectsOn(r: Ae2Rec, side: number): boolean {
  return r.block !== 'cable_bus' || (r.center !== null && !r.parts.some((p) => p.side === side));
}

/**
 * AE2: neighbours join when both connect toward each other. Storage buses attach the inventory they face, drives and
 * ME chests attach themselves.
 */
function ae2Graph(blocks: Ae2Rec[]): Graph {
  const at = new Map<string, Ae2Rec>();
  for (const r of blocks) at.set(keyOf(r), r);
  const uf = new UnionFind(), members = new Map<string, Member>();
  for (const [k, r] of at) {
    uf.find(k);
    let connections = 0, joinable = 0, faces = 0;
    for (const s of SIDES) {
      if (!ae2ConnectsOn(r, s)) continue;
      joinable |= 1 << s;
      const nk = keyAt(r.dim, step(r.pos, s)), other = at.get(nk);
      if (other === undefined || !ae2ConnectsOn(other, OPPOSITE[s])) continue;
      connections |= 1 << s;
      faces++;
      uf.union(k, nk);
    }
    const attaches = r.parts.filter((p) => p.type === 'StorageBus').map((p) => step(r.pos, p.side));
    if (r.block === 'drive' || r.block === 'chest') attaches.push(r.pos);
    members.set(k, {
      dim: r.dim, pos: r.pos, connections, joinable, attaches, parts: [r.block, ...r.parts.map((p) => p.type)], channels: r.channels,
      ...(r.block === 'controller' ? { controllerFaces: faces } : {}),
    });
  }
  return { members, uf };
}

/**
 * An AE2 network's channel estimate (world-format §6.11 marks the capacities UNVERIFIED): the channels its blocks use,
 * and 32 per controller face joined to a neighbour, or 8 without a controller.
 */
function ae2Channels(members: Member[]): Pick<LogisticsNetwork, 'channelsUsed' | 'channelsMax'> {
  let used = 0, faces = 0, controller = false;
  for (const m of members) {
    used += m.channels ?? 0;
    if (m.controllerFaces !== undefined) {
      controller = true;
      faces += m.controllerFaces;
    }
  }
  return { channelsUsed: used, channelsMax: controller ? AE2_CHANNELS_PER_CONTROLLER_FACE * faces : AE2_CHANNELS_WITHOUT_CONTROLLER };
}

/**
 * Builds every logistics network of a scan, the blocks each is made of (with their connection bits) and the networks
 * attached to each inventory. Networks come routed, EnderIO (item, liquid), GT pipe (item, fluid), AE2, each kind by
 * dimension, then position.
 */
export function buildLogistics(input: LogisticsInput): LogisticsResult {
  const built: Built[] = [
    ...networksOf(routedGraph(input.prPipes), {
      kind: 'routed', prefix: 'r', tapKind: 'routed', keep: (ms) => ms.some((m) => m.routed === true),
    }, input),
    ...(['item', 'liquid'] as const).flatMap((t) =>
      networksOf(conduitGraph(input.conduits, t), { kind: 'enderio', prefix: `e:${t}`, tapKind: 'pipe' }, input)),
    ...(['item', 'fluid'] as const).flatMap((k) =>
      networksOf(gtPipeGraph(input.gtPipes, k), { kind: 'gtpipe', prefix: `g:${k}`, tapKind: 'pipe' }, input)),
    ...networksOf(ae2Graph(input.ae2), { kind: 'ae2', prefix: 'a', tapKind: 'ae2', channels: ae2Channels }, input),
  ];

  const blocks: LogisticsBlock[] = [];
  const attachments: Attachments = new Map();
  for (const { network, members } of built) {
    const { id: networkId, kind } = network;
    for (const m of members) {
      blocks.push({ dim: m.dim, pos: [m.pos[0], m.pos[1], m.pos[2]], kind, networkId, connections: m.connections });
      for (const p of m.attaches) {
        const k = keyAt(m.dim, p);
        const list = attachments.get(k);
        if (list === undefined) attachments.set(k, [{ networkId, kind }]);
        else if (!list.some((a) => a.networkId === networkId)) list.push({ networkId, kind });
      }
    }
  }
  return { networks: built.map((b) => b.network), blocks, attachments };
}
