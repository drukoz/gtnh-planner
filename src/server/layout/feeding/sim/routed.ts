// Project Red routed pipes in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 8;
// E6, E7; research §2.2): each network moves items as Project Red 4.12.44-GTNH's chips and payloads do.
// - Chips act on countdowns their pipe's tick lowers: an Item Extractor Chip and an Item Broadcaster Chip every 10 ticks, an
//   Item Stock Keeper Chip every 100 plus 10 for each earlier pass that requested nothing (at most 1,200 more), first 9 (or
//   99) ticks after the line's chunk loads. A Routed Interface Pipe whose chips act is an entity of the tile phase, in the
//   pipes' local order: each tick it first sends the head of its send queue, then runs its chips in slot order.
// - A chip's send only queues a payload on its own pipe, which sends one a tick. From then the payload counts in its
//   destination's transit, and it reaches the far end of the destination pipe (hops + 1 pipe lengths) at its priority's
//   speed (`prTravelTicks`). Arrivals, retries, re-routes and wanderers are the network's one entity of the arrivals phase,
//   which handles a tick's payloads in the order they were sent.
// - An answer: an Item Responder (Passive), Item Terminator (Terminated) or Item Overflow Responder (Default, any item) whose
//   filter passes the item answers with its inventory's room (`roomFor`: every empty slot that takes it counts a stack) less
//   what is on its way there (the item's count, and a full stack for each slot the other items on their way will need), when
//   that is above 0. The best: the higher priority, the chip's own priority, fewer hops, the pipe earlier in local order.
// - An Item Extractor Chip lists the items of the slots its inventory shows it (each once, in the order of the slot it first
//   stands in) and sends up to 64 of each its filter passes to the best answers (never to its own pipe, nor to one pipe twice
//   for one item), each time as much as it can take out, up to a stack and the answer's room. When it can take none out (an
//   input item, which GT keeps in), it gives up the whole act, as it does when one item uses up its 64.
// - An Item Stock Keeper Chip asks the network's Item Broadcaster Chips (not its own pipe's), nearest first, for what its
//   inventory lacks of each stock item, less what is on its way and already ordered, up to the room and 128; each broadcaster
//   promises what its inventory holds that its filter passes, less its open orders. An act that was promised something resets
//   the chip's slowdown, and nothing else does (E7). A broadcaster sends up to 8 orders and 64 items an act, each cut to its
//   requester's room; an order it cannot take out of its inventory is dropped.
// - What does not all go in bounces: it keeps its destination, stays in its transit and tries again one pipe length later,
//   as often as it takes. Only when the last of it goes in does that last part come off the transit, so a payload that went
//   in in parts leaves its earlier parts counted.
// - A restart saves no send queue (what waits in one is lost), no transit, no payload's destination and no broadcaster's
//   order, and every chip counts down from the start again. A payload in flight then re-routes as it enters its next pipe;
//   one in its destination pipe already goes in on arrival if it fits and re-routes there if not. A re-routed payload does
//   not count in its new destination's transit. One that finds no answer wanders, asking again every pipe length at
//   Wandering speed, for ever (the pack's "Max Wander Distance" is 0); the model keeps it at the pipe where it lost its way.
// - A routed pipe is no inventory, so a machine's own push (a cover, auto-output, an output bus) never goes into one: the
//   model registers no push target.
// - Why an item does not reach a node (`in`): no chip on its pipe takes it; its sources' Item Extractor Chips do not let it out;
//   or one does, but items of another kind sent to it did not fit and circle its pipe, still counted as on their way, so its
//   pipe answers for the item with no room (research C19, named with what circles). Why one does not leave (`out`): its Item
//   Extractor Chip refuses it (unless a Broadcaster sends it on a Stock Keeper's orders), nothing on the line answers for it,
//   or every taker has no room for it, named, as the fallback "nothing on the line takes it" would deny what they show.
// - Work whose answer is already known is skipped, and only that (Task 11 rule 7's exact steps, which change no result): a
//   payload's try at an inventory that a try for its item already found full in the same arrivals tick, or that its own
//   last try found full while the inventory has not changed since (`SimInv.changes`), and the room of an inventory that has
//   not changed since it was last taken.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../../shared/keys.ts';
import { fmtInt } from '../../../../shared/layout/format.ts';
import type { FeedUnknown, ItemFilterSpec, RoutedChipSpec } from '../contract.ts';
import { PR, PR_PRIORITY_ORDER, prTravelTicks, stockKeeperDelay, type PrPriority } from '../facts.ts';
import { compareLocal, localOf } from '../frame.ts';
import type { FeedModel, FeedNode, NodeId, RoutedNet, RoutedPipe } from '../model.ts';
import { listText } from '../text.ts';
import { insertEmpties, NEVER, PHASE, roomFor, type KeyTable, type SimEntity, type SimInv } from './core.ts';
import type { Explain } from './detect.ts';
import type { SimEnv } from './machine.ts';
import type { NetworkModel } from './run.ts';

/** An Item Extractor Chip with nothing in its whitelist, in R5a's and R5d's words (precheck.ts). */
const EMPTY_WHITELIST = 'has an empty whitelist (a new chip extracts nothing)';

/** The priority each kind of chip that answers for an item answers with (E6). */
const ANSWERING: Partial<Record<RoutedChipSpec['kind'], PrPriority>> = { responder: 'passive', terminator: 'terminated', overflow: 'default' };

/** A chip's filter; a chip that carries none is a new one: an empty whitelist, a broadcaster's an empty blacklist (research §2.2). */
function filterOf(chip: RoutedChipSpec): ItemFilterSpec {
  return chip.filter ?? { mode: chip.kind === 'broadcaster' ? 'blacklist' : 'whitelist', keys: [] };
}

/** Whether `chip`'s filter passes `key`: a whitelist lists it, a blacklist does not. */
function passes(chip: RoutedChipSpec, key: StuffKey): boolean {
  const f = filterOf(chip);
  return f.keys.includes(key) === (f.mode === 'whitelist');
}

/** Why none of the Item Extractor Chips `extractors` passes an item, in R5a's and R5d's words: all are empty whitelists, one blacklists it, or none lists it. */
function refusal(extractors: readonly RoutedChipSpec[]): string {
  if (extractors.every((c) => filterOf(c).mode === 'whitelist' && filterOf(c).keys.length === 0)) return EMPTY_WHITELIST;
  return extractors.some((c) => filterOf(c).mode === 'blacklist') ? 'blacklists it' : 'does not list it';
}

/** `chip`'s filter over the run's key ids: 1 for each item it passes. */
function compile(chip: RoutedChipSpec, keys: KeyTable): Uint8Array {
  const f = filterOf(chip);
  const listed = new Set(f.keys);
  const whitelist = f.mode === 'whitelist';
  const pass = new Uint8Array(keys.size);
  for (let id = 0; id < keys.size; id++) pass[id] = listed.has(keys.key(id)) === whitelist ? 1 : 0;
  return pass;
}

/** The rank of the pipe at `id` among every routed pipe of the line, by local cell: the `order` of its entity. */
function pipeRank(model: FeedModel, id: NodeId): number {
  const at = localOf(id);
  let rank = 0;
  for (const net of model.networks) {
    if (net.kind !== 'routed') continue;
    for (const p of net.pipes) if (compareLocal(localOf(p.id), at) < 0) rank++;
  }
  return rank;
}

/** A chip that answers for items (rule 2): its kind's priority (as its place in `PR_PRIORITY_ORDER`), its own priority setting, and what it passes (null: anything). */
interface Answerer { readonly rank: number; readonly own: number; readonly priority: PrPriority; readonly pass: Uint8Array | null }

/** A pipe of the network as the run moves payloads through it. */
interface Pipe {
  /** Its place in the network's local order (`net.pipes`): its "pipe order". */
  readonly index: number;
  readonly spec: RoutedPipe;
  /** The inventory it serves (null: none in the run), that inventory's own side toward it, and the slots it shows that side. */
  readonly inv: SimInv | null; readonly side: number; readonly slots: readonly number[];
  readonly answerers: readonly Answerer[];
  /** What is on its way to it, by key: dispatched to it and not yet taken off (`transitQueue`). */
  readonly transit: Map<number, number>;
  /** Its send queue, head first. */
  readonly queue: Payload[];
}

/** What a payload does next: reach the inventory of its `edge` pipe, enter the pipe `enters` (and re-route there), or ask for a route at `from` again. */
const ARRIVE = 0, ENTER = 1, WANDER = 2;

/** A stack on its way through the network. */
interface Payload {
  readonly key: number;
  count: number;
  priority: PrPriority;
  /** Its destination: null once a restart lost it, and while it wanders. */
  dest: Pipe | null;
  /** The node it was last sent to: where it bounces, or where it was heading when it lost its way. */
  heading: NodeId;
  /** The pipe whose inventory it makes for, the pipe it last set out from and the tick it did (its dispatch, a re-route, a wander). */
  edge: Pipe; from: Pipe; base: number;
  /** Its next step and that step's tick; `enters`: the pipe an `ENTER` step enters. */
  step: typeof ARRIVE | typeof ENTER | typeof WANDER; at: number; enters: Pipe | null;
  /** It has been counted as bounced, or as wandering; it has gone in. */
  bounced: boolean; wandered: boolean; done: boolean;
  /** The pipe of its last try that took nothing, and that pipe's inventory's `changes` then (null: none yet). */
  tried: Pipe | null; triedAt: number;
}

/** What a broadcaster promised: `count` of `key` for the stock keeper's pipe `to`. */
interface Order { readonly to: Pipe; readonly key: number; count: number }

/** A chip that acts on its countdown: an extractor, a broadcaster or a stock keeper, with its state. */
interface Actor {
  readonly kind: 'extractor' | 'broadcaster' | 'stock_keeper';
  readonly pipe: Pipe;
  /** What an extractor's or a broadcaster's filter passes. */
  readonly pass: Uint8Array;
  /** A stock keeper's stock, each item once (its first entry) in slot order, and whether it asks only while it stores none. */
  readonly stock: ReadonlyArray<{ readonly key: number; readonly count: number }>; readonly whenEmpty: boolean;
  /** The tick it acts next; a stock keeper's passes that requested nothing since the last that did. */
  next: number; idle: number;
  /** A broadcaster's orders, head first. */
  readonly orders: Order[];
}

/** A pipe that answers for an item, seen from one pipe before its room is known: its answer's priority (and that priority's rank), the chip's own, its hops. */
interface Candidate { readonly pipe: Pipe; readonly priority: PrPriority; readonly rank: number; readonly own: number; readonly hops: number }

/** What a re-route leaves out: no pipe, its own included. */
const NO_PIPES: readonly Pipe[] = [];

/**
 * The model of Project Red network `net` in this run (`NETWORK_MODELS.routed`): an entity of the tile phase for each pipe whose
 * chips act, one entity of the arrivals phase for the payloads, the network's reasons why an item does not arrive or leave,
 * its restart, and the unknowns its restarts and wanderers leave.
 */
export function routedModel(net: RoutedNet, env: SimEnv): NetworkModel {
  const { keys, stats, sim, model } = env;
  if (net.pipes.length === 0) return { entities: [], explain: () => null, receivers: [] };
  const pipes: Pipe[] = net.pipes.map((spec, index): Pipe => {
    const ref = spec.target;
    const inv = ref === null ? null : env.inv(ref.bus ?? ref.node);
    const answerers: Answerer[] = [];
    for (const chip of spec.chips) {
      const priority = ANSWERING[chip.kind];
      if (priority === undefined) continue;
      answerers.push({ rank: PR_PRIORITY_ORDER.indexOf(priority), own: chip.priority ?? 0, priority, pass: chip.kind === 'overflow' ? null : compile(chip, keys) });
    }
    return {
      index, spec, inv, side: ref?.side ?? -1, slots: inv === null || ref === null ? [] : inv.sideSlots(ref.side), answerers, transit: new Map(), queue: [],
    };
  });
  const hopsOf = (a: Pipe, b: Pipe): number | undefined => net.hops[a.spec.id]?.[b.spec.id];
  const inputBuses = new Set(model.nodes.flatMap((n) => (n.kind === 'multi' ? n.inBuses.map((b) => b.id) : [])));

  // ---- Rule 2: answers ----

  /** The pipes that answer for `key` from pipe `from`, best first but for their room (memoized by pipe and key). */
  const ranked = new Map<number, readonly Candidate[]>();
  const candidates = (from: Pipe, key: number): readonly Candidate[] => {
    const memo = from.index * keys.size + key;
    const known = ranked.get(memo);
    if (known !== undefined) return known;
    const list: Candidate[] = [];
    for (const p of pipes) {
      const hops = hopsOf(from, p);
      if (hops === undefined || p.inv === null) continue;
      // the pipe answers with its best chip that passes the item
      let best: Answerer | null = null;
      for (const a of p.answerers) {
        if (a.pass !== null && a.pass[key] !== 1) continue;
        if (best === null || a.rank > best.rank || (a.rank === best.rank && a.own > best.own)) best = a;
      }
      if (best !== null) list.push({ pipe: p, priority: best.priority, rank: best.rank, own: best.own, hops });
    }
    list.sort((a, b) => b.rank - a.rank || b.own - a.own || a.hops - b.hops || a.pipe.index - b.pipe.index);
    ranked.set(memo, list);
    return list;
  };

  /**
   * A further exact step of Task 11 rule 7, for the extractors' answer scan: `roomFor` of each pipe's inventory for each item,
   * kept with the inventory's `changes` it was taken at (`roomSeen`, −1: never), and taken again only once they moved. While
   * they stay the same every `canInsert` answers as it did, so `roomFor` gives what it gave.
   */
  const roomKept = new Float64Array(pipes.length * keys.size);
  const roomSeen = new Float64Array(pipes.length * keys.size).fill(-1);

  /** What pipe `p` answers for `key` (`RoutedInterfacePipePart.getSyncResponse`): its inventory's room less its transit, a full stack of `key` for each slot another item in transit needs. */
  const roomOf = (p: Pipe, key: number): number => {
    const inv = p.inv!;
    const memo = p.index * keys.size + key;
    let room: number;
    if (roomSeen[memo] === inv.changes) room = roomKept[memo]!;
    else {
      room = roomFor(inv, key, p.side);
      roomKept[memo] = room;
      roomSeen[memo] = inv.changes;
    }
    if (room <= 0) return room;
    const limit = keys.limit(key);
    for (const [k, n] of p.transit) room -= k === key ? n : limit * Math.ceil(n / keys.limit(k));
    return room;
  };

  /** The room of the answer `answer` gave last. */
  let answerRoom = 0;
  /** The best answer for `key` from pipe `from` but the pipes in `skip`: the first candidate whose room is above 0, or null. */
  const answer = (key: number, from: Pipe, skip: readonly Pipe[]): Candidate | null => {
    for (const c of candidates(from, key)) {
      if (skip.includes(c.pipe)) continue;
      const room = roomOf(c.pipe, key);
      if (room > 0) {
        answerRoom = room;
        return c;
      }
    }
    return null;
  };

  // ---- Rule 5: send queues, dispatch and arrival ----

  /** Every payload dispatched and not yet gone in, in dispatch order (one pipe sends one a tick, and the pipes run in pipe order). */
  const flying: Payload[] = [];

  /** A chip's send: a payload of `count` of `key` for pipe `dest` at the back of `pipe`'s send queue. */
  const enqueue = (pipe: Pipe, key: number, count: number, dest: Pipe, priority: PrPriority): void => {
    pipe.queue.push({
      key, count, priority, dest, heading: dest.spec.target!.node, edge: dest, from: pipe, base: -1, step: ARRIVE, at: NEVER, enters: null,
      bounced: false, wandered: false, done: false, tried: null, triedAt: 0,
    });
  };

  /** `pipe` sends payload `p`, the head of its send queue, at tick `t`: from then it counts in its destination's transit (`itemExpected`). */
  const dispatch = (pipe: Pipe, p: Payload, t: number): void => {
    const dest = p.dest!;
    dest.transit.set(p.key, (dest.transit.get(p.key) ?? 0) + p.count);
    p.base = t;
    p.at = t + prTravelTicks(hopsOf(pipe, dest) ?? 0, p.priority);
    flying.push(p);
    stats.dispatched(pipe.spec.id, p.key, p.count, t);
    sim.wakeAt(arrivals, p.at);
  };

  /** `itemReceived`: the last `n` of a payload of `key` went into `p`'s inventory, and its transit of `key` drops by them, never below 0. */
  const received = (p: Pipe, key: number, n: number): void => {
    const left = (p.transit.get(key) ?? 0) - n;
    if (left > 0) p.transit.set(key, left);
    else p.transit.delete(key);
  };

  /** The payloads that lost their way, by the node they were heading for and item, in the order they first did (`pr_wander_path`). */
  const lostWays: Array<{ node: NodeId; key: number; n: number }> = [];

  /**
   * Rule 6: payload `p` asks for a route at pipe `at` at tick `t`: to the best answer, every pipe allowed, whose transit does not
   * count it (`setDestination` without `itemExpected`); with none, it wanders and asks there again one pipe length later at
   * Wandering speed.
   */
  const reRoute = (p: Payload, at: Pipe, t: number): void => {
    const c = answer(p.key, at, NO_PIPES);
    p.from = at;
    p.base = t;
    if (c !== null) {
      p.dest = c.pipe;
      p.edge = c.pipe;
      p.heading = c.pipe.spec.target!.node;
      p.priority = c.priority;
      p.step = ARRIVE;
      p.at = t + prTravelTicks(c.hops, c.priority);
      return;
    }
    if (!p.wandered) {
      p.wandered = true;
      stats.wandered(p.heading, p.key, p.count, t);
      const seen = lostWays.find((w) => w.node === p.heading && w.key === p.key);
      if (seen === undefined) lostWays.push({ node: p.heading, key: p.key, n: p.count });
      else seen.n += p.count;
    }
    p.dest = null;
    p.priority = 'wandering';
    p.step = WANDER;
    p.at = t + prTravelTicks(0, 'wandering');
  };

  /**
   * Task 11 rule 7's exact step for the payloads that bounce and try the same inventory again: within one tick of the arrivals
   * entity, a try at a pipe's inventory (its edge: the pipe and its side) for an item is skipped when an earlier try there for
   * that item in the same tick took nothing and no try since took anything, and it takes nothing, as that one did. It is
   * exact: during that tick only the payloads' tries move items, a try that takes nothing changes nothing (`canInsert` only
   * reads, and every `insert` returns 0 before it changes anything), and whether a try takes anything does not depend on its
   * count. `futile[pipe × keys + key]` holds the generation of the memo in which such a try took nothing; the memo empties, a
   * new generation, at the start of each arrivals tick and whenever a try takes something.
   */
  const futile = new Int32Array(pipes.length * keys.size);
  let generation = 1;
  const forget = (): void => {
    if (generation >= 0x7fffffff) {
      futile.fill(0);
      generation = 0;
    }
    generation++;
  };

  /**
   * Payload `p` reaches the inventory of its `edge` pipe at tick `t` (`passToInventory`, `injectItem`): what goes in is delivered.
   * When the last of it goes in, that last part comes off the pipe's transit. Else it bounces: with a destination it keeps it,
   * stays in its transit and tries again one pipe length later; without one (a restart lost it) it asks for a route there.
   * A further exact step of rule 7: a payload whose last try at this inventory took nothing skips a try at it while the
   * inventory is unchanged since (its `changes`, which every change to what `canInsert` reads moves), as that try would take
   * nothing again; and a try that the memo above skips is one that took nothing at the inventory as it stands.
   */
  const arrive = (p: Payload, t: number, by: SimEntity): void => {
    const { edge } = p;
    const inv = edge.inv;
    let got = 0;
    if (inv !== null && (p.tried !== edge || p.triedAt !== inv.changes)) {
      const memo = edge.index * keys.size + p.key;
      if (futile[memo] !== generation) {
        got = insertEmpties(inv, p.key, p.count, edge.side, by);
        if (got > 0) forget();
        else futile[memo] = generation;
      }
      if (got <= 0) {
        p.tried = edge;
        p.triedAt = inv.changes;
      }
    }
    if (got > 0) stats.delivered(inv!.id, p.key, got, t);
    if (got >= p.count) {
      received(edge, p.key, got);
      p.done = true;
      return;
    }
    p.count -= got;
    if (p.dest === null) {
      reRoute(p, edge, t);
      return;
    }
    if (!p.bounced) {
      p.bounced = true;
      stats.bounced(p.heading, p.key, p.count, t);
    }
    p.at = t + prTravelTicks(0, p.priority);
  };

  /** The payloads' entity (phase `arrivals`): each tick, the payloads whose step falls on it, in dispatch order. */
  const arrivals: SimEntity = {
    phase: PHASE.arrivals,
    order: pipeRank(model, net.pipes[0]!.id),
    tick(t: number): number {
      let due = NEVER;
      let gone = false;
      forget();                                               // rule 7's memo empties at the start of each arrivals tick
      for (const p of flying) {
        if (p.at === t) {
          if (p.step === ARRIVE) arrive(p, t, arrivals);
          else reRoute(p, p.step === ENTER ? p.enters! : p.from, t);
          if (p.done) {
            gone = true;
            continue;
          }
        }
        if (p.at < due) due = p.at;
      }
      if (gone) {
        let kept = 0;
        for (const p of flying) if (!p.done) flying[kept++] = p;
        flying.length = kept;
      }
      return due;
    },
  };

  // ---- Rules 1, 3, 4, 7: the chips that act ----

  /** The countdown a chip starts after it acts, and when the line loads: 10, 10, or a stock keeper's `stockKeeperDelay(idle)`. */
  const delayOf = (a: Actor): number => (a.kind === 'stock_keeper' ? stockKeeperDelay(a.idle) : a.kind === 'extractor' ? PR.extractorDelay : PR.broadcasterDelay);

  const actors: Actor[] = [];
  for (const pipe of pipes) {
    if (pipe.inv === null) continue;
    for (const chip of pipe.spec.chips) {
      if (chip.kind !== 'extractor' && chip.kind !== 'broadcaster' && chip.kind !== 'stock_keeper') continue;
      const stock: Array<{ key: number; count: number }> = [];
      for (const s of chip.kind === 'stock_keeper' ? chip.stock ?? [] : []) {
        const key = keys.id(s.key);
        if (!stock.some((e) => e.key === key)) stock.push({ key, count: s.count });
      }
      const actor: Actor = { kind: chip.kind, pipe, pass: compile(chip, keys), stock, whenEmpty: chip.requestMode === 'when_empty', next: 0, idle: 0, orders: [] };
      actor.next = env.loadedAt + delayOf(actor) - 1;
      actors.push(actor);
    }
  }
  /** Whether a chip can ever do something: an extractor or a broadcaster whose filter passes some item, a stock keeper with a stock. */
  const acts = (a: Actor): boolean => (a.kind === 'stock_keeper' ? a.stock.length > 0 : a.pass.includes(1));
  const broadcasters = actors.filter((a) => a.kind === 'broadcaster' && acts(a));

  /** Up to `n` of `key` out of `slots` of `inv`, in slot order, where it lets them out of `side`. Returns what it took. */
  const take = (inv: SimInv, slots: readonly number[], side: number, key: number, n: number, by: SimEntity): number => {
    let left = n;
    for (const slot of slots) {
      if (left <= 0) break;
      const s = inv.stack(slot);
      if (s === null || s.key !== key || s.count <= 0 || !inv.canExtract(slot, key, side)) continue;
      left -= inv.extract(slot, Math.min(left, s.count), by);
    }
    return n - left;
  };

  /** How many of `key` `slots` of `inv` hold. */
  const countOf = (inv: SimInv, slots: readonly number[], key: number): number => {
    let n = 0;
    for (const slot of slots) {
      const s = inv.stack(slot);
      if (s !== null && s.key === key) n += s.count;
    }
    return n;
  };

  // one extractor act's listing, and the pipes it has sent one item to: kept between acts, so an act allocates nothing
  const listedKeys: number[] = [];
  const listedCounts: number[] = [];
  const sentTo: Pipe[] = [];

  /** `getAllItemStacks` (open question 5): each item `slots` of `inv` hold, once, with its total, in the order of the slot it first stands in. */
  const list = (inv: SimInv, slots: readonly number[]): void => {
    listedKeys.length = 0;
    listedCounts.length = 0;
    for (const slot of slots) {
      const s = inv.stack(slot);
      if (s === null || s.count <= 0) continue;
      const i = listedKeys.indexOf(s.key);
      if (i < 0) {
        listedKeys.push(s.key);
        listedCounts.push(s.count);
      } else listedCounts[i]! += s.count;
    }
  };

  /**
   * Rule 3, an Item Extractor Chip's act: for each listed item its filter passes, a budget of 64 (it starts again for each item,
   * E6) sent to the best answers but its own pipe and those it already sent the item to. Every `return` is the jar's `return`
   * inside the loop: nothing to send, nothing taken out, or the budget used up ends the whole act (research C3).
   */
  const extract = (a: Actor, t: number, by: SimEntity): void => {
    const { pipe } = a;
    const inv = pipe.inv!;
    const bus = pipe.spec.target?.bus;
    // rule 9: what it takes out of an input bus is pulled back (research §3.2)
    const pulls = bus !== undefined && inputBuses.has(bus);
    list(inv, pipe.slots);
    for (let i = 0; i < listedKeys.length; i++) {
      const key = listedKeys[i]!;
      if (a.pass[key] !== 1) continue;
      const listed = listedCounts[i]!;
      let budget = PR.extractPerKey;
      sentTo.length = 0;
      sentTo.push(pipe);
      for (let c = answer(key, pipe, sentTo); c !== null; c = answer(key, pipe, sentTo)) {
        const n = Math.min(budget, listed, keys.limit(key), answerRoom);
        if (n <= 0) return;
        const taken = take(inv, pipe.slots, pipe.side, key, n, by);
        if (taken <= 0) return;
        if (pulls) stats.pulledBack(bus, key, taken, t);
        enqueue(pipe, key, taken, c.pipe, c.priority);
        budget -= taken;
        if (budget <= 0) return;
        sentTo.push(c.pipe);
      }
    }
  };

  /** What broadcaster `b` has on order of `key`: for every requester, or (`to`) for one. */
  const ordered = (b: Actor, key: number, to: Pipe | null): number => {
    let n = 0;
    for (const o of b.orders) if (o.key === key && (to === null || o.to === to)) n += o.count;
    return n;
  };

  /** The broadcasters a stock keeper on pipe `to` asks, nearest first, then in pipe order (memoized); not its own pipe's. */
  const supplierLists = new Map<Pipe, readonly Actor[]>();
  const suppliers = (to: Pipe): readonly Actor[] => {
    let found = supplierLists.get(to);
    if (found === undefined) {
      found = broadcasters.filter((b) => b.pipe !== to && hopsOf(to, b.pipe) !== undefined)
        .sort((x, y) => hopsOf(to, x.pipe)! - hopsOf(to, y.pipe)! || x.pipe.index - y.pipe.index);
      supplierLists.set(to, found);
    }
    return found;
  };

  /**
   * Rule 4, an Item Stock Keeper Chip's act: for each stock item with room, what is missing (less what is stored, on its way and
   * on order, up to the room and 128) asked of the broadcasters, each promising what its inventory holds through its filter less
   * its open orders; each promise is an order at that broadcaster. A pass that was promised something resets the slowdown (E7).
   */
  const keepStock = (a: Actor): void => {
    const { pipe } = a;
    const inv = pipe.inv!;
    let requested = false;
    for (const { key, count: stock } of a.stock) {
      const space = roomFor(inv, key, pipe.side);
      if (space <= 0) continue;
      const stored = countOf(inv, pipe.slots, key);
      if (a.whenEmpty && stored > 0) continue;
      const enroute = pipe.transit.get(key) ?? 0;
      if (stored + enroute >= stock) continue;
      let pending = 0;
      for (const b of broadcasters) pending += ordered(b, key, pipe);
      let missing = Math.min(stock - stored - enroute - pending, space, PR.maxRequest);
      for (const b of suppliers(pipe)) {
        if (missing <= 0) break;
        const offered = b.pass[key] === 1 ? countOf(b.pipe.inv!, b.pipe.slots, key) : 0;
        const n = Math.min(missing, offered - ordered(b, key, null));
        if (n <= 0) continue;
        b.orders.push({ to: pipe, key, count: n });
        missing -= n;
        requested = true;
      }
    }
    a.idle = requested ? 0 : a.idle + 1;
  };

  /**
   * Rule 7, an Item Broadcaster Chip's act: up to 8 orders and 64 items from the head of its order list, each a stack at most and
   * cut to its requester's room (none: the order goes to the back and the act ends); taken out of its inventory through its filter
   * and sent at Active Broadcast. An order of which it takes nothing is dropped (`timeOutOnFailedExtract`); one sent in full is
   * done, one cut to the room goes to the back.
   */
  const broadcast = (a: Actor, t: number, by: SimEntity): void => {
    const { pipe, orders } = a;
    let handled = 0;
    let items = PR.broadcastItems;
    while (orders.length > 0 && handled < PR.broadcastStacks && items > 0) {
      handled++;
      const o = orders[0]!;
      let x = Math.min(o.count, items, keys.limit(o.key));
      const space = roomFor(o.to.inv!, o.key, o.to.side);
      if (space <= 0) {
        orders.push(orders.shift()!);
        return;
      }
      const cut = space < x;
      if (cut) x = space;
      const taken = a.pass[o.key] === 1 ? take(pipe.inv!, pipe.slots, pipe.side, o.key, x, by) : 0;
      if (taken <= 0) {
        orders.shift();
        stats.prDropped(pipe.spec.id, o.key, o.count, t);
        continue;
      }
      enqueue(pipe, o.key, taken, o.to, 'active_broadcast');
      items -= taken;
      o.count -= taken;
      if (o.count <= 0) orders.shift();
      else if (cut) orders.push(orders.shift()!);
    }
  };

  // rule 1: each pipe whose chips act ticks in the tile phase: the head of its send queue first, then its chips in slot order
  const entities: SimEntity[] = [];
  for (const pipe of pipes) {
    const mine = actors.filter((a) => a.pipe === pipe && acts(a));
    if (mine.length === 0) continue;
    const self: SimEntity = {
      phase: PHASE.tile,
      order: pipeRank(model, pipe.spec.id),
      tick(t: number): number {
        const head = pipe.queue.shift();
        if (head !== undefined) dispatch(pipe, head, t);
        let next = NEVER;
        for (const a of mine) {
          if (a.next === t) {
            if (a.kind === 'extractor') extract(a, t, self);
            else if (a.kind === 'broadcaster') broadcast(a, t, self);
            else keepStock(a);
            a.next = t + delayOf(a);
          }
          if (a.next < next) next = a.next;
        }
        // due at its chips' next act, and on every tick while its send queue holds a payload
        return pipe.queue.length > 0 ? t + 1 : next;
      },
    };
    entities.push(self);
  }
  entities.push(arrivals);

  // ---- Rule 8: the restart ----

  /** Each pipe's neighbours one hop away, in pipe order (memoized). */
  const nearLists = new Map<Pipe, readonly Pipe[]>();
  const neighbours = (p: Pipe): readonly Pipe[] => {
    let found = nearLists.get(p);
    if (found === undefined) {
      found = pipes.filter((q) => hopsOf(p, q) === 1);
      nearLists.set(p, found);
    }
    return found;
  };
  /** A payload's route from `from` to `to`, both included: the breadth-first path, at each pipe on to the first neighbour in pipe order one hop nearer (memoized). */
  const paths = new Map<number, readonly Pipe[]>();
  const pathOf = (from: Pipe, to: Pipe): readonly Pipe[] => {
    const memo = from.index * pipes.length + to.index;
    const known = paths.get(memo);
    if (known !== undefined) return known;
    const path = [from];
    let at = from;
    for (let d = hopsOf(from, to) ?? 0; d > 0; d--) {
      const next = neighbours(at).find((n) => hopsOf(n, to) === d - 1);
      if (next === undefined) break;
      path.push(next);
      at = next;
    }
    paths.set(memo, path);
    return path;
  };

  /**
   * A restart at tick `at` loses payload `p`'s destination. It enters the j-th pipe of its route after the one it set out from at
   * `base + prTravelTicks(j − 1, priority)`: it re-routes at the first it enters from `at` on; in its destination pipe already,
   * it keeps its arrival, goes in if it fits and re-routes there if not (`arrive`).
   */
  const lose = (p: Payload, at: number): void => {
    if (p.dest === null) return;
    p.dest = null;
    const route = pathOf(p.from, p.edge);
    for (let j = 1; j < route.length; j++) {
      const enter = p.base + prTravelTicks(j - 1, p.priority);
      if (enter < at) continue;
      p.step = ENTER;
      p.enters = route[j]!;
      p.at = enter;
      return;
    }
  };

  /** What restarts took out of each pipe's send queue, by pipe and item, in the order they first did (`pr_queue_lost`). */
  const lostQueues: Array<{ pipe: Pipe; key: number; n: number }> = [];

  /**
   * Rule 8 (at the start of `restartAt`, when `env.loadedAt` is that tick): every send queue is lost with its items, every
   * transit cleared, every payload in flight loses its destination, every broadcaster's orders are dropped, and every chip
   * counts down again from its first countdown, all together, a stock keeper with no idle pass.
   */
  const restart = (): void => {
    const t = env.loadedAt;
    for (const pipe of pipes) {
      for (const q of pipe.queue) {
        stats.queueLost(pipe.spec.id, q.key, q.count, t);
        const seen = lostQueues.find((l) => l.pipe === pipe && l.key === q.key);
        if (seen === undefined) lostQueues.push({ pipe, key: q.key, n: q.count });
        else seen.n += q.count;
      }
      pipe.queue.length = 0;
      pipe.transit.clear();
    }
    for (const p of flying) lose(p, t);
    for (const a of actors) {
      a.orders.length = 0;
      a.idle = 0;
      a.next = t + delayOf(a) - 1;
    }
  };

  // ---- Rule 11: why an item does not reach a node, or leave it ----

  // a multiblock's input buses for one, its output buses for the other
  const busWay = new Map<NodeId, 'in' | 'out'>();
  for (const n of model.nodes) {
    if (n.kind !== 'multi') continue;
    for (const b of n.inBuses) busWay.set(b.id, 'in');
    for (const b of n.outBuses) busWay.set(b.id, 'out');
  }
  /** The network's pipes that serve node `node`; of a multiblock, those at its input buses (`in`) or its output buses (`out`). */
  const serving = (node: NodeId, way: 'in' | 'out'): Pipe[] => pipes.filter((p) => {
    const ref = p.spec.target;
    return ref !== null && ref.node === node && (ref.bus === undefined || busWay.get(ref.bus) === way);
  });
  /** Whether `chip` lists `key` as one its pipe takes in: a responder's or a terminator's filter, an overflow responder (anything), a stock keeper's stock. */
  const takesIn = (chip: RoutedChipSpec, key: StuffKey): boolean => {
    switch (chip.kind) {
      case 'responder':
      case 'terminator': return passes(chip, key);
      case 'overflow': return true;
      case 'stock_keeper': return chip.stock?.some((s) => s.key === key) === true;
      default: return false;
    }
  };
  /** Whether node `n` supplies `key`: an input chest that stocks it, a machine whose recipes make it. */
  const supplies = (n: FeedNode, key: StuffKey): boolean => (n.kind === 'chest' ? n.side === 'input' && n.keys.includes(key) : n.recipes.some((r) => r.outputs.some((o) => o.key === key)));
  const extractorsOn = (list: readonly Pipe[]): RoutedChipSpec[] => list.flatMap((p) => p.spec.chips.filter((c) => c.kind === 'extractor'));

  /** Whether pipe `p` keeps `key` in stock: an Item Stock Keeper Chip of it lists it. */
  const keeps = (p: Pipe, key: StuffKey): boolean => p.spec.chips.some((c) => c.kind === 'stock_keeper' && c.stock?.some((s) => s.key === key) === true);

  /**
   * Why `key` finds no room at node `node`'s pipes `own` although its sources let it out (research C19 as E6 reads Project Red):
   * payloads of other items sent there did not fit and circle the pipe, and while they stay counted as on their way there,
   * every other item's answer loses a stack for each slot they will need, so the pipe answers for `key` with no room. Names
   * each such item with what of it circles, in key order; null when nothing of another item circles there counted.
   */
  const circlingAt = (own: readonly Pipe[], key: StuffKey): string | null => {
    const k = keys.id(key);
    const circling = new Map<number, number>();
    for (const p of flying) {
      if (p.done || !p.bounced || p.dest === null || p.key === k || !own.includes(p.dest) || (p.dest.transit.get(p.key) ?? 0) <= 0) continue;
      circling.set(p.key, (circling.get(p.key) ?? 0) + p.count);
    }
    if (circling.size === 0) return null;
    const items = [...circling].sort((a, b) => a[0] - b[0]).map(([id, n]) => `${fmtInt(n)} ${model.nameOf(keys.key(id))}`);
    return `${listText(items)} sent to it did not fit and circle its pipe, still counted as on their way there, so its pipe has no room left `
      + `to answer for ${model.nameOf(key)}`;
  };

  /**
   * Why `key` does not leave node `node` though something on the network takes it: every taker has no room for it when `detect`
   * asks (at the run's end) — an answering pipe's answer (its inventory's room less what is on its way there), a stock keeper's
   * room; one taker by name, else all of them, "full" when they are chests without room. Null when one still has room.
   */
  const noRoomFor = (node: NodeId, key: StuffKey, ordered: boolean): string | null => {
    const k = keys.id(key);
    const answers = (p: Pipe): boolean => p.spec.chips.some((c) => ANSWERING[c.kind] !== undefined && (c.kind === 'overflow' || passes(c, key)));
    const takers = pipes.filter((p) => p.inv !== null && p.spec.target?.node !== node && (answers(p) || (ordered && keeps(p, key))));
    if (takers.length === 0 || takers.some((p) => (answers(p) ? roomOf(p, k) : roomFor(p.inv!, k, p.side)) > 0)) return null;
    const nodes = [...new Set(takers.map((p) => p.spec.target!.node))].map((id) => model.nodes.find((n) => n.id === id) ?? id);
    const names = nodes.map((n) => (typeof n === 'string' ? n : n.label));
    const full = nodes.every((n) => typeof n !== 'string' && n.kind === 'chest') && takers.every((p) => roomFor(p.inv!, k, p.side) <= 0);
    const name = model.nameOf(key);
    if (names.length === 1) return `its routed network's only taker for ${name}, ${names[0]!}, ${full ? 'is full' : 'has no room'}`;
    return `its routed network's only takers for ${name}, ${listText(names)}, ${full ? 'are full' : 'have no room'}`;
  };

  const explain: Explain = (kind, node, key) => {
    const own = serving(node, kind);
    if (own.length === 0) return null;
    if (kind === 'in') {
      if (!own.some((p) => p.spec.chips.some((c) => takesIn(c, key)))) return `no Item Responder Chip on its pipe lists ${model.nameOf(key)}`;
      // the network's sources of the item, in node order: when none lets it out, the first whose Item Extractor Chip refuses it;
      // when one does, what circles its pipe may keep it out
      let blamed: string | null = null;
      for (const n of model.nodes) {
        if (n.id === node || !supplies(n, key)) continue;
        const at = serving(n.id, 'out');
        if (at.some((p) => p.spec.chips.some((c) => (c.kind === 'extractor' || c.kind === 'broadcaster') && passes(c, key)))) return circlingAt(own, key);
        const extractors = extractorsOn(at);
        if (blamed === null && extractors.length > 0) blamed = `the Item Extractor Chip on ${n.label} ${refusal(extractors)}`;
      }
      return blamed;
    }
    // an Item Broadcaster Chip on its pipe that passes the item sends it on the orders of a Stock Keeper Chip that keeps it
    // (research §2.2): then that is its way out, and the extractor beside it is not why it stays (as R5a reads it)
    const ordered = own.some((p) => p.spec.chips.some((c) => c.kind === 'broadcaster' && passes(c, key))) && pipes.some((p) => keeps(p, key));
    const extractors = extractorsOn(own);
    if (!ordered && extractors.length > 0 && !extractors.some((c) => passes(c, key))) return `its Item Extractor Chip ${refusal(extractors)}`;
    // an answer on another node's pipe, which may have no room left
    const answered = ordered || pipes.some((p) => p.inv !== null && p.spec.target?.node !== node
      && p.spec.chips.some((c) => ANSWERING[c.kind] !== undefined && (c.kind === 'overflow' || passes(c, key))));
    return answered ? noRoomFor(node, key, ordered) : 'no Item Responder Chip on the line lists it';
  };

  // ---- What the run leaves unknown ----

  /** The world cell and step of node `id`, for an unknown about it. */
  const where = (id: NodeId | undefined): Pick<FeedUnknown, 'pos' | 'stepId'> => {
    const n = id === undefined ? undefined : model.nodes.find((x) => x.id === id);
    if (n === undefined) return {};
    const stepId = n.kind === 'chest' ? undefined : n.stepIds[0];
    return { pos: [n.pos[0], n.pos[1], n.pos[2]], ...(stepId === undefined ? {} : { stepId }) };
  };
  const unknowns = (): FeedUnknown[] => [
    ...lostQueues.map(({ pipe, key, n }): FeedUnknown => ({
      code: 'pr_queue_lost', text: `${pipe.spec.label} lost ${fmtInt(n)} ${model.nameOf(keys.key(key))} from its send queue in the restart: Project Red saves `
        + 'no send queue, so a restart just after a chip\'s act deletes what it queued', key: keys.key(key), ...where(pipe.spec.target?.node),
    })),
    ...lostWays.map(({ node, key, n }): FeedUnknown => ({
      code: 'pr_wander_path', text: `${fmtInt(n)} ${model.nameOf(keys.key(key))} on their way to ${model.nodes.find((x) => x.id === node)?.label ?? node} `
        + `lost their way: the checker keeps a wandering payload at the pipe where it lost its way, asking for a route there every ${prTravelTicks(0, 'wandering')} `
        + 'ticks, as it does not follow its random path through the pipes', key: keys.key(key), ...where(node),
    })),
  ];

  return { entities, explain, receivers: [], restart, unknowns };
}
