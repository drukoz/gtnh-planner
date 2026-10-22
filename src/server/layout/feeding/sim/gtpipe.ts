// GT item pipes in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 10; E9, E4;
// research §2.4): each network of linked GT item pipes moves items machine to machine as GT 5.09.54.183's `MTEItemPipe` does.
// - A pipe is an inventory of as many slots as its capacity and an entity of the tile phase, in the pipes' local order. Its
//   covers act first in its tick (Task 4 rule 5a): an import conveyor fills it from the inventory on that side, an Item
//   Filter cover moves its filter's items out of it.
// - It takes a stack only into an empty slot (it never merges), only through a side it is connected on whose cover lets items
//   in, and while it holds items only from the side it first received them from (`allowPutStack`).
// - Every 10 ticks of its own timer (`aTick`: its age since its chunk loaded, plus 1) it checks. Holding items, it sends only
//   when the side it last received from is the one it had at its previous check, so a fresh stack waits one check; at the
//   end of each check it keeps that side for the next, and none once it is empty.
// - A send offers its stacks, one stack of up to 64 at a time (GT's transfer, E4), to the network's pipes by distance: itself
//   first, then by pipe hops, then in local order. Each tries its connected sides that touch an inventory (a machine, a bus or
//   a chest, never another pipe) in side order 0–5, past its own cover there (a Shutter on "Only Input allowed" stops it, an
//   Item Filter cover never does), and that inventory takes it by its own rules. The sending pipe never sends back out of the
//   side it received from.
// - A send counts against the transfer counter of every pipe the scan tried up to the one that handed the stack over, the
//   sender included. A pipe whose counter has reached its capacity sends no more until its window starts again, 20 ticks
//   after the first send it counted (`mCurrentTransferStartTick`, `mTickTime` 20 [jar]), and until then a scan neither adds
//   it nor goes through it (`scanPipes` [jar]): a scan reaches only the pipes that a path of pipes below their capacity leads
//   to, in its order by hops over every connection. So a pipe moves at most its capacity in stacks per 20 ticks (E9).
// - When its chunk loads again (`restart`), a pipe keeps its items and the side it received them from, which GT saves, but
//   not the side of its previous check nor its counter: a stack in it waits one check again.
// - Why an item does not arrive (`in`): no pipe touches the machine; its Input Filter keeps the item out; nothing pushes the
//   item into its pipes; or a nearer taker got it first. Why one does not leave (`out`): no conveyor cover pushes it out of
//   the machine; its Item Filter cover refuses it; nothing on its pipes takes it; or every taker there has no room for it
//   (full chests, or machines with no room).
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../../shared/keys.ts';
import { posKey, step } from '../../../../shared/layout/geometry.ts';
import { CHEST_SLOTS } from '../facts.ts';
import { compareLocal, localOf } from '../frame.ts';
import type { BasicNode, FeedModel, FeedNode, GtCover, GtPipe, GtPipeNet, InvRef, NodeId } from '../model.ts';
import { listText } from '../text.ts';
import { gtTransfer, insertEmpties, PHASE, roomFor, type PushTarget, type SimEntity, type SimInv, type Stack } from './core.ts';
import { coverGates, coverTicks, type CoverTicks } from './covers.ts';
import type { Explain } from './detect.ts';
import { aTick, type SimEnv } from './machine.ts';
import type { NetworkModel } from './run.ts';

/** ForgeDirection.UNKNOWN: no side (a pipe's own send takes its stacks out from no side). */
const UNKNOWN = -1;
/** E9: a pipe checks every 10 ticks of its own timer. */
const CHECK_TICKS = 10;
/** E9: `mTickTime`, the window of a pipe's transfer counter: at most its capacity in stacks per 20 ticks. */
const WINDOW_TICKS = 20;
/** E9, E4: a send moves one stack of up to 64 items (gtnhlib's `ItemTransfer`). */
const SEND_ITEMS = 64;
const SIDES: readonly number[] = [0, 1, 2, 3, 4, 5];
const NONE: readonly number[] = [];

/** The recipe maps on which a machine's Input Filter lets in a circuit (Task 4 rule 5, as `machine.ts` reads them). */
const CIRCUIT_MAPS: ReadonlySet<string> = new Set(['gt.recipe.assembler', 'gt.recipe.circuitassembler']);

/** The rank of every GT item pipe of the line by its local cell: the `order` of its entity. */
function pipeRanks(model: FeedModel): Map<NodeId, number> {
  const ids = new Set<NodeId>();
  for (const net of model.networks) if (net.kind === 'gtpipe') for (const p of net.pipes) ids.add(p.id);
  const sorted = [...ids].map((id) => ({ id, at: localOf(id) })).sort((a, b) => compareLocal(a.at, b.at));
  return new Map(sorted.map((p, i) => [p.id, i]));
}

/** What a pipe hands stacks to on one of its sides: the inventory there (by its own side toward the pipe), which takes them by its own rules. */
interface Hand { readonly side: number; readonly ref: InvRef; readonly inv: SimInv; readonly target: PushTarget }

/** A side of a pipe in one sender's scan: the pipe, its place in that scan, and what it hands stacks to there. */
interface Outlet { readonly pipe: Pipe; readonly at: number; readonly hand: Hand }

/** A stack one pipe sent: the item, the sender, who took it and through which outlet of the sender's scan. */
interface Sent { readonly key: number; readonly sender: Pipe; readonly taker: NodeId; readonly outlet: number }

/** A GT item pipe in the run: its inventory, its own state of the last checks and its transfer counter, and its entity. */
class Pipe implements SimInv, SimEntity, PushTarget {
  readonly id: NodeId;
  readonly label: string;
  readonly phase = PHASE.tile;
  readonly order: number;
  readonly spec: GtPipe;
  /** Its place in the network's local order (`net.pipes`): its "pipe order". */
  readonly index: number;
  readonly capacity: number;
  readonly all: readonly number[];
  /** What its covers let through each side. */
  readonly gates: ReturnType<typeof coverGates>;
  /** The side it last received from (`mLastReceivedFrom`), and the one it had at its last check (`oLastReceivedFrom`). */
  received = UNKNOWN;
  previous = UNKNOWN;
  /** Its transfer counter, and the timer of the first send it counted in its window. */
  count = 0;
  since = 0;
  /** How many of its slots hold a stack. */
  filled = 0;
  private readonly slots: Array<Stack | null>;
  private readonly covers: CoverTicks;
  private readonly env: SimEnv;
  private readonly net: Network;
  /** The side of the last `canInsert` that let a stack in: the side an insert into an empty pipe comes from. */
  private asked = UNKNOWN;

  constructor(spec: GtPipe, index: number, order: number, net: Network, env: SimEnv) {
    this.spec = spec;
    this.id = spec.id;
    this.label = spec.label;
    this.index = index;
    this.order = order;
    this.net = net;
    this.env = env;
    this.capacity = Math.max(1, Math.floor(spec.capacity));
    this.slots = Array.from({ length: this.capacity }, () => null);
    this.all = this.slots.map((_, i) => i);
    const covers = env.model.covers.filter((c) => c.host === spec.id);
    this.gates = coverGates(covers);
    this.covers = coverTicks(this, covers, env);
  }

  /** Whether it is connected on `side` (GT6-style pipes touch only what their connection bits point at, E17). */
  linked(side: number): boolean {
    return side >= 0 && side <= 5 && (this.spec.links & (1 << side)) !== 0;
  }

  // ---- The inventory ----

  slotCount(): number {
    return this.slots.length;
  }

  stack(slot: number): Readonly<Stack> | null {
    return this.slots[slot] ?? null;
  }

  /** Every slot, on every side (GT shows them all where the side's cover lets items in or out, as every cover modelled does). */
  sideSlots(): readonly number[] {
    return this.all;
  }

  stackLimit(key: number): number {
    return this.env.keys.limit(key);
  }

  /** `allowPutStack` behind the side's cover: a connected side, an empty slot, and while it holds items only the side they came from. */
  canInsert(slot: number, _key: number, side: number): boolean {
    if (!this.linked(side) || !this.gates.lets(side, 'in') || this.slots[slot] !== null) return false;
    if (this.filled > 0 && side !== this.received) return false;
    this.asked = side;
    return true;
  }

  /** Its own send takes its stacks out from no side; a cover or a neighbour only through a connected side whose cover lets them out. */
  canExtract(slot: number, _key: number, side: number): boolean {
    if ((this.slots[slot] ?? null) === null) return false;
    return side < 0 || side > 5 || (this.linked(side) && this.gates.lets(side, 'out'));
  }

  /** A stack into an empty slot; into an empty pipe, it remembers the side it came from. */
  insert(slot: number, key: number, n: number, by: SimEntity | null): number {
    if (n <= 0 || this.slots[slot] !== null) return 0;
    const m = Math.min(n, this.stackLimit(key));
    if (this.filled === 0) this.received = this.asked;
    this.asked = UNKNOWN;
    this.slots[slot] = { key, count: m };
    this.filled++;
    this.net.entered(key);
    this.env.sim.wake(this, by);
    return m;
  }

  extract(slot: number, n: number): number {
    const s = this.slots[slot];
    if (s === null || s === undefined || n <= 0) return 0;
    const m = Math.min(n, s.count);
    s.count -= m;
    if (s.count <= 0) {
      this.slots[slot] = null;
      this.filled--;
    }
    return m;
  }

  /** A push into it (a cover, an output bus, a bench's back, auto-output): into its empty slots by `canInsert` (rule 1). */
  accept(key: number, n: number, side: number, by: SimEntity | null): number {
    return insertEmpties(this, key, n, side, by);
  }

  countAll(key: number): number {
    let n = 0;
    for (const s of this.slots) if (s !== null && s.key === key) n += s.count;
    return n;
  }

  countsAsEmpty(): boolean {
    for (const s of this.slots) if (s !== null && !this.env.model.ignoredByBlocking(this.env.keys.key(s.key))) return false;
    return true;
  }

  // ---- The tick ----

  /** Its covers act; every 10 ticks of its timer it checks, and sends what has waited a check (rule 1). */
  tick(t: number): number {
    this.covers(t);
    const a = aTick(this.env, t);
    if (a % CHECK_TICKS === 0) {
      if (this.filled > 0 && this.previous === this.received) this.net.send(this, a);
      if (this.filled === 0) this.received = UNKNOWN;
      this.previous = this.received;
    }
    // its next check matters while it holds items or still has sides to forget; an insert wakes it otherwise
    let next = this.covers.next(t);
    if (this.filled > 0 || this.received !== UNKNOWN || this.previous !== UNKNOWN) next = Math.min(next, t + CHECK_TICKS - (a % CHECK_TICKS));
    return next;
  }

  /** The chunk loads again: GT saves the side it received from and its items, not the side of its last check nor its counter. */
  restart(): void {
    this.previous = UNKNOWN;
    this.count = 0;
    this.since = 0;
  }
}

/** The run's state of one GT item pipe network: its pipes, each sender's scan, the items that entered it and the stacks it sent. */
class Network {
  readonly pipes: Pipe[] = [];
  /** The stacks sent, each (item, sender, taker) once, in the order first sent (`explain` reads them). */
  readonly sent: Sent[] = [];
  private readonly env: SimEnv;
  private readonly wouldTake: (ref: InvRef, key: StuffKey) => boolean;
  private readonly cells = new Map<string, Pipe>();
  private readonly into: boolean[];
  private readonly keysIn = new Set<StuffKey>();
  private links: Array<readonly Pipe[] | undefined> = [];
  private scans: Array<readonly Pipe[] | undefined> = [];
  private outlets: Array<readonly Outlet[] | undefined> = [];
  private hands: Array<readonly Hand[] | undefined> = [];
  private byKey: Array<Map<number, readonly number[]> | undefined> = [];
  /** The item of the last stack a hand took. */
  private took = -1;
  /** The walk of `reach`: its number, each pipe's mark (the number of the last walk that reached it) and its queue, one place per pipe. */
  private walk = 0;
  private readonly marks: number[] = [];
  private readonly queue: Pipe[] = [];

  constructor(env: SimEnv, wouldTake: (ref: InvRef, key: StuffKey) => boolean) {
    this.env = env;
    this.wouldTake = wouldTake;
    this.into = Array.from({ length: env.keys.size }, () => false);
  }

  add(pipe: Pipe): void {
    this.pipes.push(pipe);
    this.cells.set(pipe.id, pipe);
    this.marks.push(0);
    this.queue.push(pipe);
  }

  /** A stack of `key` entered one of its pipes. */
  entered(key: number): void {
    if (this.into[key] === true) return;
    this.into[key] = true;
    this.keysIn.add(this.env.keys.key(key));
  }

  /** Whether `key` ever entered one of its pipes. */
  hadKey(key: StuffKey): boolean {
    return this.keysIn.has(key);
  }

  /** Whether `p` is below its capacity, its counter reset once its 20-tick window is over (`pipeCapacityCheck`). */
  private free(p: Pipe, a: number): boolean {
    if (p.count > 0 && a - p.since >= WINDOW_TICKS) p.count = 0;
    return p.count < p.capacity;
  }

  /** The pipes of the network that `p`'s connections lead to, in side order (computed once). */
  private linksOf(p: Pipe): readonly Pipe[] {
    const known = this.links[p.index];
    if (known !== undefined) return known;
    const at = localOf(p.id);
    const list: Pipe[] = [];
    for (const side of SIDES) {
      const q = p.linked(side) ? this.cells.get(posKey(step(at, side))) : undefined;
      if (q !== undefined) list.push(q);
    }
    this.links[p.index] = list;
    return list;
  }

  /**
   * The network's pipes from `s`: itself, then by pipe hops over the connections, then in local order (computed once). A scan
   * reaches only some of them while a pipe is at its capacity (`reach`), but it keeps this order.
   */
  scanOf(s: Pipe): readonly Pipe[] {
    const known = this.scans[s.index];
    if (known !== undefined) return known;
    const hops = new Map<Pipe, number>([[s, 0]]);
    const queue: Pipe[] = [s];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      for (const q of this.linksOf(p)) {
        if (hops.has(q)) continue;
        hops.set(q, hops.get(p)! + 1);
        queue.push(q);
      }
    }
    const scan = queue.sort((x, y) => hops.get(x)! - hops.get(y)! || x.index - y.index);
    this.scans[s.index] = scan;
    return scan;
  }

  /**
   * Which pipes of `scan`, `s`'s scan at its timer `a`, the scan reaches: `s` and every pipe that a path of pipes below their
   * capacity leads to, for `scanPipes` neither adds a pipe at its capacity nor goes through it. False when every pipe of the
   * scan is below its capacity, so it reaches them all; else true, with the pipes it reaches marked `walk`. It allocates nothing.
   */
  private reach(s: Pipe, scan: readonly Pipe[], a: number): boolean {
    let all = true;
    for (let i = 0; i < scan.length; i++) if (!this.free(scan[i]!, a)) all = false;
    if (all) return false;
    const walk = ++this.walk;
    const { marks, queue } = this;
    marks[s.index] = walk;
    queue[0] = s;
    let n = 1;
    for (let i = 0; i < n; i++) {
      const next = this.linksOf(queue[i]!);
      for (let j = 0; j < next.length; j++) {
        const q = next[j]!;
        if (marks[q.index] === walk || !this.free(q, a)) continue;
        marks[q.index] = walk;
        queue[n++] = q;
      }
    }
    return true;
  }

  /** The sides of `p` that hand stacks to an inventory of the run, past its own cover there, in side order (computed once). */
  handsOf(p: Pipe): readonly Hand[] {
    const known = this.hands[p.index];
    if (known !== undefined) return known;
    const { stats, sim } = this.env;
    const list: Hand[] = [];
    for (const { side, target: ref } of [...p.spec.sides].sort((x, y) => x.side - y.side)) {
      const inv = this.env.inv(ref.bus ?? ref.node);
      if (inv === null || !p.linked(side) || !p.gates.lets(side, 'out')) continue;
      const target: PushTarget = {
        accept: (key, n, intoSide, by) => {
          const got = insertEmpties(inv, key, n, intoSide, by);
          if (got > 0) {
            stats.delivered(inv.id, key, got, sim.t);
            this.took = key;
          }
          return got;
        },
      };
      list.push({ side, ref, inv, target });
    }
    this.hands[p.index] = list;
    return list;
  }

  /** Every outlet of `s`'s scan, in the order it tries them (computed once). */
  outletsOf(s: Pipe): readonly Outlet[] {
    const known = this.outlets[s.index];
    if (known !== undefined) return known;
    const list: Outlet[] = [];
    this.scanOf(s).forEach((pipe, at) => {
      for (const hand of this.handsOf(pipe)) list.push({ pipe, at, hand });
    });
    this.outlets[s.index] = list;
    return list;
  }

  /** The outlets of `s`'s scan (as indices, in order) whose inventory would take `key` when it has room (computed once). */
  private outletsFor(s: Pipe, key: number): readonly number[] {
    let cache = this.byKey[s.index];
    if (cache === undefined) {
      cache = new Map();
      this.byKey[s.index] = cache;
    }
    const known = cache.get(key);
    if (known !== undefined) return known;
    const k = this.env.keys.key(key);
    const list: number[] = [];
    this.outletsOf(s).forEach((o, i) => {
      if (this.wouldTake(o.hand.ref, k)) list.push(i);
    });
    cache.set(key, list);
    return list;
  }

  /** The outlets of `s`'s scan that may take one of the items it holds: no other could take any of them. */
  private candidates(s: Pipe): readonly number[] {
    let one = -1;
    let many: number[] | null = null;
    for (const slot of s.all) {
      const st = s.stack(slot);
      if (st === null) continue;
      if (one < 0) one = st.key;
      else if (st.key !== one && (many === null || !many.includes(st.key))) (many ??= [one]).push(st.key);
    }
    if (many === null) return one < 0 ? NONE : this.outletsFor(s, one);
    const marks = new Set<number>();
    for (const key of many) for (const i of this.outletsFor(s, key)) marks.add(i);
    return [...marks].sort((x, y) => x - y);
  }

  /**
   * Rule 1, `s`'s send at its check (timer `a`), as `MTEItemPipe.onPostTick` loops: while some pipe of a scan reached its
   * capacity and `s` still holds items and has room on its counter, it scans again; a scan reaches the pipes that pipes below
   * their capacity lead to (`reach`), and each of them, in order, hands stacks over as long as one goes in and no pipe of the
   * scan has reached its capacity (so every pipe it reaches stays below its capacity until the scan ends).
   */
  send(s: Pipe, a: number): void {
    let full = true;
    while (full && s.filled > 0 && this.free(s, a)) {
      full = false;
      const outlets = this.outletsOf(s);
      const scan = this.scanOf(s);
      const list = this.candidates(s);
      if (list.length === 0) return;
      // the pipes this scan reaches: all of them, or (`cut`) those this walk marked
      const cut = this.reach(s, scan, a);
      const walk = this.walk;
      const marks = this.marks;
      let i = 0;
      while (i < list.length && !full && s.filled > 0) {
        // the candidates on one pipe: it tries its sides from the first again after each stack it hands over
        const pipe = outlets[list[i]!]!.pipe;
        let end = i;
        while (end < list.length && outlets[list[end]!]!.pipe === pipe) end++;
        if (!cut || marks[pipe.index] === walk) {
          while (!full && s.filled > 0) {
            let handed = -1;
            for (let j = i; j < end && handed < 0; j++) {
              const o = outlets[list[j]!]!;
              // never back out of the side it received from
              if (pipe === s && o.hand.side === s.received) continue;
              if (gtTransfer(s, s.all, UNKNOWN, o.hand.target, o.hand.ref.side, 1, SEND_ITEMS, s) > 0) handed = list[j]!;
            }
            if (handed < 0) break;
            this.note(s, handed);
            // the send counts against every pipe the scan reaches up to this one, the sender included
            const at = outlets[handed]!.at;
            for (let r = 0; r <= at; r++) {
              const q = scan[r]!;
              if (cut && marks[q.index] !== walk) continue;
              if (q.count === 0) q.since = a;
              q.count++;
              if (q.count >= q.capacity) full = true;
            }
          }
        }
        i = end;
      }
    }
  }

  /** Records the stack `s` just handed over through outlet `outlet` of its scan, once per item and taker. */
  private note(s: Pipe, outlet: number): void {
    const key = this.took;
    const taker = this.outletsOf(s)[outlet]!.hand.ref.node;
    for (const x of this.sent) if (x.key === key && x.sender === s && x.taker === taker) return;
    this.sent.push({ key, sender: s, taker, outlet });
  }
}

/**
 * The model of GT item pipe network `net` in this run (`NETWORK_MODELS.gtpipe`): an entity of the tile phase for each pipe
 * (each also an inventory and the push target at every side of its cell), the network's reasons why an item does not arrive
 * or leave, and its restart.
 */
export function gtPipeModel(net: GtPipeNet, env: SimEnv): NetworkModel {
  const { keys, model } = env;
  const byId = new Map<NodeId, FeedNode>(model.nodes.map((n) => [n.id, n]));
  // a multiblock's input buses for one, its output buses for the other
  const busWay = new Map<NodeId, 'in' | 'out'>();
  for (const n of model.nodes) {
    if (n.kind !== 'multi') continue;
    for (const b of n.inBuses) busWay.set(b.id, 'in');
    for (const b of n.outBuses) busWay.set(b.id, 'out');
  }
  const gates = new Map<NodeId, ReturnType<typeof coverGates>>();
  const gatesOf = (host: NodeId): ReturnType<typeof coverGates> => {
    let g = gates.get(host);
    if (g === undefined) {
      g = coverGates(model.covers.filter((c) => c.host === host));
      gates.set(host, g);
    }
    return g;
  };

  /** The Input Filter of a basic machine (E2) passes `key`: a recipe of its maps takes it, or (3+ slots, an assembler) it is a circuit. */
  const filterPasses = (n: BasicNode, key: StuffKey): boolean => n.maps.some((m) => model.mapTakes(m, key))
    || (n.inSlots >= 3 && n.maps.some((m) => CIRCUIT_MAPS.has(m)) && model.circuitOre(key));

  /**
   * Whether the inventory at `ref` takes `key` from its side `ref.side` when it has room: its slot rules without its contents
   * (the side, its covers, its Input Filter; never an output bus). In a run, every item that gets in passes it, so a pipe
   * skips the inventories that do not, and `explain` counts the ones that do as takers.
   */
  const wouldTake = (ref: InvRef, key: StuffKey): boolean => {
    const n = byId.get(ref.node);
    if (n === undefined) return false;
    switch (n.kind) {
      case 'chest':
        return n.side === 'output' || n.keys.length < CHEST_SLOTS;
      case 'bench':
        return gatesOf(n.id).lets(ref.side, 'in');
      case 'multi': {
        const bus = n.inBuses.find((b) => b.id === ref.bus);
        return bus !== undefined && ref.side === bus.front && gatesOf(bus.id).lets(ref.side, 'in')
          && (bus.inputFilter !== true || bus.maps.some((m) => model.mapTakes(m, key)));
      }
      case 'basic':
        return n.inSlots > 0 && ref.side !== n.front && (ref.side !== n.outputSide || n.settings.inputFromOutputSide !== false)
          && (n.steam || gatesOf(n.id).lets(ref.side, 'in'))
          && (n.settings.inputFilter !== true || filterPasses(n, key) || n.recipes.some((r) => r.held.includes(key)));
    }
  };

  const network = new Network(env, wouldTake);
  const ranks = pipeRanks(model);
  net.pipes.forEach((spec, i) => network.add(new Pipe(spec, i, ranks.get(spec.id) ?? 0, network, env)));
  const pipes = network.pipes;

  // ---- Rule 2: why an item does not reach a node, or leave it ----

  /** The sides of `list`'s pipes that touch node `node`; of a multiblock, those at its input buses (`in`) or its output buses (`out`). */
  const contacts = (list: readonly GtPipe[], node: NodeId, way: 'in' | 'out'): Array<{ pipe: GtPipe; side: number; ref: InvRef }> => {
    const out: Array<{ pipe: GtPipe; side: number; ref: InvRef }> = [];
    for (const pipe of list) {
      for (const { side, target } of pipe.sides) {
        if (target.node === node && (target.bus === undefined || busWay.get(target.bus) === way)) out.push({ pipe, side, ref: target });
      }
    }
    return out;
  };
  /** Whether a filter cover passes `key`: a whitelist lists it, a blacklist does not. */
  const passes = (c: GtCover, key: StuffKey): boolean => (c.filter?.keys ?? []).includes(key) === ((c.filter?.mode ?? 'whitelist') === 'whitelist');
  /** What a filter cover that refuses `key` lists: "blacklists Why"; for a whitelist "lists Alpha and Beta", or "lists nothing". */
  const refusal = (c: GtCover, key: StuffKey): string => {
    if (c.filter?.mode === 'blacklist') return `blacklists ${model.nameOf(key)}`;
    const names = [...new Set((c.filter?.keys ?? []).map((k) => model.nameOf(k)))];
    return `lists ${names.length === 0 ? 'nothing' : listText(names)}`;
  };

  /** What moves items out of node `n` onto the pipe sides `own`: covers that push or pull them, or the block's own push (auto-output, an output bus, a bench's back). */
  const pushers = (n: FeedNode, own: ReadonlyArray<{ pipe: GtPipe; side: number; ref: InvRef }>): Array<GtCover | 'own'> => {
    const out: Array<GtCover | 'own'> = [];
    for (const c of own) {
      const host = c.ref.bus ?? n.id;
      for (const cover of model.covers) {
        if (cover.host === host && cover.side === c.ref.side && ((cover.kind === 'conveyor' && cover.export) || cover.kind === 'filter')) out.push(cover);
        // an import conveyor on the pipe's side pulls from it
        if (cover.host === c.pipe.id && cover.side === c.side && cover.kind === 'conveyor' && !cover.export) out.push(cover);
      }
      if (n.kind === 'basic' && n.settings.autoOutput === true && !n.steam && n.outputSide === c.ref.side) out.push('own');
      if (n.kind === 'bench' && n.back === c.ref.side) out.push('own');
      if (n.kind === 'multi' && n.outBuses.some((b) => b.id === c.ref.bus && b.front === c.ref.side)) out.push('own');
    }
    return out;
  };

  /** Rule 2 for `in`: the Input Filter of a basic machine, or of every input bus of a multiblock that touches the pipe, refuses `key`. */
  const filterRefuses = (n: FeedNode, own: ReadonlyArray<{ ref: InvRef }>, key: StuffKey): boolean => {
    if (n.kind === 'basic') return n.settings.inputFilter === true && !filterPasses(n, key);
    if (n.kind !== 'multi') return false;
    const buses = own.flatMap((c) => n.inBuses.filter((b) => b.id === c.ref.bus));
    return buses.length > 0 && buses.every((b) => b.inputFilter === true && !b.maps.some((m) => model.mapTakes(m, key)));
  };

  /**
   * The taker of a stack of `key` that the network handed over at an outlet nearer its sender than the first that reaches node
   * `node` (a multiblock's input buses), or null; a sender that cannot reach the node at all hands nothing to anyone "first".
   */
  const nearerTaker = (node: NodeId, key: StuffKey): string | null => {
    const k = keys.id(key);
    for (const x of network.sent) {
      if (x.key !== k || x.taker === node) continue;
      const mine = network.outletsOf(x.sender).findIndex((o) => o.hand.ref.node === node
        && (o.hand.ref.bus === undefined || busWay.get(o.hand.ref.bus) === 'in'));
      if (mine >= 0 && x.outlet < mine) return byId.get(x.taker)?.label ?? x.taker;
    }
    return null;
  };

  /** The inventories on the network, other than node `node`'s, that would take `key` from a pipe, each once. */
  const takers = (node: NodeId, key: StuffKey): Hand[] => {
    const out: Hand[] = [];
    for (const p of pipes) {
      for (const h of network.handsOf(p)) {
        if (h.ref.node !== node && wouldTake(h.ref, key) && !out.some((x) => x.inv === h.inv)) out.push(h);
      }
    }
    return out;
  };

  const explain: Explain = (kind, node, key) => {
    const n = byId.get(node);
    if (n === undefined || n.kind === 'chest') return null;
    const own = contacts(net.pipes, node, kind);
    if (own.length === 0) {
      // the line's other networks answer for a node they touch; with GT pipes alone, none touches it
      const elsewhere = model.networks.some((x) => x.kind !== 'gtpipe' || (x !== net && contacts(x.pipes, node, kind).length > 0));
      return elsewhere ? null : 'no pipe touches it';
    }
    const name = model.nameOf(key);
    if (kind === 'in') {
      if (filterRefuses(n, own, key)) return `its Input Filter keeps ${name} out (no recipe of its machine uses it)`;
      if (!network.hadKey(key)) return `nothing pushes ${name} into its pipe`;
      const nearer = nearerTaker(node, key);
      return nearer === null ? null : `its pipe hands ${name} to ${nearer} first, which is nearer`;
    }
    const out = pushers(n, own);
    if (out.length === 0) return `no conveyor cover pushes it out of ${n.label}`;
    const filters = out.filter((p): p is GtCover => p !== 'own' && p.kind === 'filter');
    if (filters.length === out.length && filters.every((c) => !passes(c, key))) return `its Item Filter cover ${refusal(filters[0]!, key)}`;
    const all = takers(node, key);
    if (all.length === 0) return `nothing on its pipe takes ${name}`;
    // rule 2 as the Task 10 ruling amends it: every taker lacks room for it from its pipe side (full chests, or machines with no room)
    const k = keys.id(key);
    if (all.every((h) => roomFor(h.inv, k, h.ref.side) <= 0)) {
      const names = [...new Set(all.map((h) => byId.get(h.ref.node)!.label))];
      const chests = all.every((h) => byId.get(h.ref.node)?.kind === 'chest');
      if (names.length === 1) return `its pipe's only taker for ${name}, ${names[0]!}, ${chests ? 'is full' : 'has no room'}`;
      return `its pipe's only takers for ${name}, ${listText(names)}, ${chests ? 'are full' : 'have no room'}`;
    }
    return null;
  };

  // every side of every pipe's cell takes pushes by the pipe's own rule (rule 1): a side it is not connected on takes none
  const receivers: NetworkModel['receivers'] = [];
  for (const p of pipes) for (const side of SIDES) receivers.push({ at: p.id, side, target: p });

  const restart = (): void => {
    for (const p of pipes) p.restart();
  };

  return { entities: pipes, explain, receivers, restart };
}
