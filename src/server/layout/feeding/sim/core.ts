// The feeding simulation's core (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 4, engine and inventory
// rules 1–4): item keys as numbers, inventories as the networks see them, the insertion policies of each mod, GT's item
// transfer, the fluid pools, and the tick engine that runs every entity in a fixed order.
// - One step is one tick. Each tick runs the due entities sorted by (phase, order): `order` is the entity's index in the
//   line's local order, so a line runs the same in every rotation; ties keep the order they were added in.
// - An entity sleeps until it is due (`tick` returns the next tick it must run), and a change to what it watches wakes it
//   for its next turn: this tick when its turn is still to come, else the next. That is when GT sees a change
//   (`hasInventoryBeenModified` is set by the change and cleared at the end of the owner's own tick, E1), so an entity
//   must act only on its own state and the tick: then running every entity on every tick (`exhaustive`) gives the same
//   result, which the tests check.
// Pure TypeScript: nothing from node:* may be imported here.

import { isFluidKey, type StuffKey } from '../../../../shared/keys.ts';
import type { Vec3 } from '../../../../shared/layout/geometry.ts';
import { stackLimit } from '../facts.ts';
import { compareLocal } from '../frame.ts';
import type { FeedModel, NodeId } from '../model.ts';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- Keys ----

/** Every item and fluid key of a run as a number: ids in sorted key order (code units), so a lower id is an earlier key. */
export class KeyTable {
  private readonly keys: StuffKey[];
  private readonly ids: Map<StuffKey, number>;
  private readonly limits: number[];

  constructor(keys: Iterable<StuffKey>) {
    this.keys = [...new Set(keys)].sort(compareText);
    this.ids = new Map(this.keys.map((k, i) => [k, i]));
    this.limits = this.keys.map(stackLimit);
  }

  /** The id of `key`; a key the run does not know is a bug in the caller. */
  id(key: StuffKey): number {
    const id = this.ids.get(key);
    if (id === undefined) throw new Error(`The feeding simulation knows no item ${key}: the run's key table is built from the model`);
    return id;
  }

  key(id: number): StuffKey {
    const key = this.keys[id];
    if (key === undefined) throw new Error(`The feeding simulation has no key with id ${id}`);
    return key;
  }

  get size(): number {
    return this.keys.length;
  }

  /** How many of the key one slot holds (`stackLimit`). */
  limit(id: number): number {
    return this.limits[id] ?? 64;
  }

  /** Whether the key is a fluid. */
  isFluid(id: number): boolean {
    return isFluidKey(this.key(id));
  }
}

/** Every cell of the model that is a tile entity of its own: its nodes, and each multiblock's input and output buses. */
function tileCells(model: FeedModel): Array<{ id: NodeId; local: Vec3 }> {
  const cells: Array<{ id: NodeId; local: Vec3 }> = [];
  for (const n of model.nodes) {
    cells.push(n);
    if (n.kind === 'multi') cells.push(...n.inBuses, ...n.outBuses);
  }
  return cells;
}

/**
 * The order of node or bus `id` in the model's local order (its rank among the nodes and the multiblocks' buses, by local
 * cell): an entity's `order`; 0 when the model does not have it.
 */
export function nodeOrder(model: FeedModel, id: NodeId): number {
  const cells = tileCells(model);
  const at = cells.find((c) => c.id === id);
  if (at === undefined) return 0;
  let rank = 0;
  for (const c of cells) if (compareLocal(c.local, at.local) < 0) rank++;
  return rank;
}

// ---- Inventories ----

export interface Stack { key: number; count: number }

/** One inventory as the networks see it (ISidedInventory); sides are the inventory's own local sides. */
export interface SimInv {
  readonly id: string; readonly label: string;
  slotCount(): number; stack(slot: number): Readonly<Stack> | null; sideSlots(side: number): readonly number[];
  canInsert(slot: number, key: number, side: number): boolean; canExtract(slot: number, key: number, side: number): boolean;
  insert(slot: number, key: number, n: number, by: SimEntity | null): number;   // at most what fits the stack limit; marks the change
  extract(slot: number, n: number, by: SimEntity | null): number;
  countAll(key: number): number;          // every slot, ghost slots included (EnderIO's Limited filter)
  countsAsEmpty(): boolean;               // AE2 blocking: nothing in its IO slots that ignoredByBlocking does not cover
  /** How many of the key one of its slots holds (the item's stack size); `roomFor` reads it. */
  stackLimit(key: number): number;
  /**
   * A count that grows with every change to everything its `canInsert` reads: what its slots hold, whoever changes it (an
   * insert or an extract, its own run, craft or sort, a test's preload), and anything else it reads (the side a GT pipe takes
   * its stacks from). While it stays the same, every `canInsert` answers as it did, so `roomFor` gives what it gave and an
   * `insertEmpties` takes something exactly when it did before (Task 11 rule 7's exact steps in routed.ts rest on it). It
   * counts no change that `canInsert` cannot see (an input chest's stocked slots, which take nothing, fill up again at
   * `heldUntil` without one). Counting a change that is none is harmless; missing one that `canInsert` reads is not.
   */
  readonly changes: number;
}

/**
 * An inventory whose contents a test sets before the first tick (`runScenario`'s `initial`). A preload calls no
 * `markChanged` (GT's `hasInventoryBeenModified`: nothing is woken, the run has not started), but `changes` still moves, as
 * for every change to what `canInsert` reads.
 */
export interface Preloadable { preload(slot: number, key: number, count: number): void }

/** Something a GT transfer (cover, output bus, bench, auto-output) can push into: a pipe, a conduit face, an ME interface. */
export interface PushTarget { accept(key: number, n: number, side: number, by: SimEntity | null): number }

/** Whether `x` is an inventory, which a transfer can take items out of (a node, a bus; Task 10's pipes are both). */
export function isInv(x: PushTarget | SimInv): x is SimInv {
  return typeof (x as Partial<SimInv>).sideSlots === 'function';
}

/** Whether `x` takes pushes by its own rule (a pipe, a conduit face, an ME interface); a plain inventory takes them by `insertEmpties`. */
export function isTarget(x: PushTarget | SimInv): x is PushTarget {
  return typeof (x as Partial<PushTarget>).accept === 'function';
}

/**
 * A GT transfer (E4: gtnhlib's `ItemTransfer`, which every GT transfer uses: covers, auto-output, output buses, the bench,
 * GT pipes): walks `slots` of `from` in order and skips a slot whose stack `from` will not let out of `side`, `accept`
 * refuses or `into` takes none of (an inventory through `insertEmpties` from `intoSide`, else the target's `accept`);
 * from each other slot it moves up to `items`, until `stacks` slots have moved something. Returns the items moved.
 */
export function gtTransfer(from: SimInv, slots: readonly number[], side: number, into: PushTarget | SimInv, intoSide: number, stacks: number, items: number,
  by: SimEntity | null, accept?: (key: number) => boolean): number {
  let moved = 0;
  let done = 0;
  const target = isTarget(into) ? into : null;
  for (const slot of slots) {
    if (done >= stacks) break;
    const s = from.stack(slot);
    if (s === null || s.count <= 0) continue;
    const key = s.key;
    if (!from.canExtract(slot, key, side) || (accept !== undefined && !accept(key))) continue;
    const n = Math.min(items, s.count);
    const took = target !== null ? target.accept(key, n, intoSide, by) : insertEmpties(into as SimInv, key, n, intoSide, by);
    if (took <= 0) continue;
    from.extract(slot, took, by);
    moved += took;
    done++;
  }
  return moved;
}

/** The merge pass every insertion starts with: onto the stacks of `key` that take it, in the side's slot order. Returns what is left. */
function merge(inv: SimInv, slots: readonly number[], key: number, n: number, side: number, by: SimEntity | null): number {
  let left = n;
  for (const slot of slots) {
    if (left <= 0) break;
    const s = inv.stack(slot);
    if (s !== null && s.key === key && inv.canInsert(slot, key, side)) left -= inv.insert(slot, key, left, by);
  }
  return left;
}

/** EnderCore's `ItemUtil.doInsertItem` (E5): onto the stacks of the key that take it, then the rest into the first empty slot that takes it, and stop. */
export function insertOneEmpty(inv: SimInv, key: number, n: number, side: number, by: SimEntity | null): number {
  if (n <= 0) return 0;
  const slots = inv.sideSlots(side);
  let left = merge(inv, slots, key, n, side, by);
  for (const slot of slots) {
    if (left <= 0) break;
    if (inv.stack(slot) === null && inv.canInsert(slot, key, side)) {
      left -= inv.insert(slot, key, left, by);
      break;
    }
  }
  return n - left;
}

/** gtnhlib's sinks and Project Red's `injectItem` (research §2.2, §2.3): onto the stacks of the key that take it, then every empty slot that takes it, in order. */
export function insertEmpties(inv: SimInv, key: number, n: number, side: number, by: SimEntity | null): number {
  if (n <= 0) return 0;
  const slots = inv.sideSlots(side);
  let left = merge(inv, slots, key, n, side, by);
  for (const slot of slots) {
    if (left <= 0) break;
    if (inv.stack(slot) === null && inv.canInsert(slot, key, side)) left -= inv.insert(slot, key, left, by);
  }
  return n - left;
}

/**
 * Project Red's `getSpaceForItem` (research §2.2): over the side's slots that take the key, a full stack for each empty
 * one and what fits on each stack of the key. Every empty slot counts a stack, though Multi Stack Input Off lets the
 * machine take only one of them (research C19).
 */
export function roomFor(inv: SimInv, key: number, side: number): number {
  const limit = inv.stackLimit(key);
  let room = 0;
  for (const slot of inv.sideSlots(side)) {
    if (!inv.canInsert(slot, key, side)) continue;
    const s = inv.stack(slot);
    if (s === null) room += limit;
    else if (s.key === key) room += Math.max(0, limit - s.count);
  }
  return room;
}

// ---- Fluids (Task 4 rule 7a) ----

/** A machine that waits for a pooled fluid: told when some arrives. */
export interface FluidWaiter { fluidArrived(by: SimEntity | null): void }

/**
 * The line's fluids, which are counted but not routed (rule 7a): one pool per fluid a laid step makes, filled at a run's end
 * and drawn at a run's start; every other fluid (one the line takes from outside) is always there.
 */
export class FluidPools {
  private readonly amounts = new Map<number, number>();
  private readonly waiters = new Map<number, FluidWaiter[]>();

  constructor(pooled: Iterable<number>) {
    for (const key of pooled) this.amounts.set(key, 0);
  }

  /** Whether `n` of the fluid is there. */
  has(key: number, n: number): boolean {
    const have = this.amounts.get(key);
    return have === undefined || have >= n;
  }

  take(key: number, n: number): void {
    const have = this.amounts.get(key);
    if (have !== undefined) this.amounts.set(key, have - n);
  }

  /** A run's output into the pool: every machine waiting for the fluid looks again. */
  add(key: number, n: number, by: SimEntity | null): void {
    const have = this.amounts.get(key);
    if (have === undefined || n <= 0) return;
    this.amounts.set(key, have + n);
    const waiting = this.waiters.get(key);
    if (waiting === undefined) return;
    this.waiters.delete(key);
    for (const w of waiting) w.fluidArrived(by);
  }

  /** `w` waits for the fluid (a pooled one; others are always there). */
  wait(key: number, w: FluidWaiter): void {
    if (!this.amounts.has(key)) return;
    const list = this.waiters.get(key);
    if (list === undefined) this.waiters.set(key, [w]);
    else if (!list.includes(w)) list.push(w);
  }
}

// ---- The tick engine ----

export const NEVER = Number.POSITIVE_INFINITY;

/** An entity of the simulation: it runs in `phase`, at `order` within it, and `tick` returns the next tick it must run. */
export interface SimEntity { readonly phase: number; readonly order: number; tick(t: number): number }

/**
 * The phases of a tick, in order (rule 1): `feed` test feeders; `power` bench energy; `tile` every block that is a tile
 * entity (GT machines with their covers, buses, controllers, benches, chests, GT pipes, routed pipes with their chips,
 * ME interfaces); `conduits` EnderIO networks; `grid` the AE2 crafting CPU; `arrivals` routed payloads reaching their pipe.
 */
export const PHASE = { feed: 0, power: 1, tile: 2, conduits: 3, grid: 4, arrivals: 5 } as const;

/** Orders up to this many per phase (an index into the line's local order). */
const ORDER_LIMIT = 2 ** 26;
const BEFORE = 0, DURING = 1, AFTER = 2;

interface Slot { readonly e: SimEntity; readonly seq: number; rank: number; due: number; ranAt: number; asked: number }

/**
 * The tick engine. `add` every entity, then `run`. Scheduled, an entity runs when it is due and when something wakes it;
 * `exhaustive`, every entity runs on every tick in the same order, and a correct model gives the same result both ways.
 */
export class Sim {
  readonly ticks: number;
  t = 0;
  private readonly exhaustive: boolean;
  private readonly slots: Slot[] = [];
  private readonly slotOf = new Map<SimEntity, Slot>();
  private byRank: Slot[] = [];
  private readonly heap: number[] = [];
  private span = 1;
  private started = false;
  private stage = BEFORE;
  private current: Slot | null = null;

  constructor(ticks: number, exhaustive: boolean) {
    if (!Number.isInteger(ticks) || ticks < 0) throw new RangeError(`a run lasts a whole number of ticks, got ${ticks}`);
    this.ticks = ticks;
    this.exhaustive = exhaustive;
  }

  /** Registers `e`, due first at `firstTick`. Every entity is added before `run`. */
  add(e: SimEntity, firstTick: number): void {
    if (this.started) throw new Error('The feeding simulation takes its entities before it runs');
    if (this.slotOf.has(e)) throw new Error('An entity was added to the feeding simulation twice');
    if (!Number.isInteger(e.phase) || e.phase < 0 || !Number.isInteger(e.order) || e.order < 0 || e.order >= ORDER_LIMIT) {
      throw new RangeError(`an entity's phase and order are small whole numbers, got ${e.phase} and ${e.order}`);
    }
    if (Number.isNaN(firstTick)) throw new RangeError('an entity is first due at a tick, got NaN');
    const s: Slot = { e, seq: this.slots.length, rank: -1, due: Math.max(0, firstTick), ranAt: -1, asked: NEVER };
    this.slots.push(s);
    this.slotOf.set(e, s);
  }

  /**
   * `e` sees a change at its next turn: this tick if its turn in this tick's order is still to come, else the next tick
   * (rule 2). The turn of the entity running now is the reference, which is `by`'s when `by` makes the change; before a
   * tick starts every turn is still to come, and between ticks (the end-of-tick callback) none is. The entity running
   * now handles a change to itself in its own tick, as GT clears the flag at the end of the owner's tick.
   */
  wake(e: SimEntity, by: SimEntity | null): void {
    void by;
    if (this.exhaustive) return;
    const s = this.slotOf.get(e);
    if (s === undefined || s === this.current) return;
    this.schedule(s, this.nextTurn(s));
  }

  /** `e` runs at `tick` (or at its next turn, when that is later), unless it is due sooner. */
  wakeAt(e: SimEntity, tick: number): void {
    if (this.exhaustive) return;
    const s = this.slotOf.get(e);
    if (s === undefined) return;
    if (s === this.current) s.asked = Math.min(s.asked, Math.max(tick, this.t + 1));
    else this.schedule(s, Math.max(tick, this.nextTurn(s)));
  }

  /** Runs every tick of the run; `endOfTick` is called after each tick's last entity, before the next tick starts. */
  run(endOfTick?: (t: number) => void): void {
    if (this.started) throw new Error('A feeding simulation runs once');
    this.started = true;
    this.byRank = [...this.slots].sort((a, b) => a.e.phase - b.e.phase || a.e.order - b.e.order || a.seq - b.seq);
    this.byRank.forEach((s, i) => { s.rank = i; });
    this.span = Math.max(1, this.byRank.length);
    if (!this.exhaustive) for (const s of this.byRank) if (s.due < this.ticks) this.push(s.due, s.rank);
    for (let t = 0; t < this.ticks; t++) {
      this.t = t;
      this.stage = DURING;
      if (this.exhaustive) {
        for (const s of this.byRank) {
          this.current = s;
          s.e.tick(t);
        }
      } else {
        this.runDue(t);
      }
      this.current = null;
      this.stage = AFTER;
      endOfTick?.(t);
    }
  }

  /** Runs the entities due at `t`, in rank order, including those woken for `t` while it runs. */
  private runDue(t: number): void {
    while (this.heap.length > 0) {
      const top = this.heap[0]!;
      const due = Math.floor(top / this.span);
      if (due > t) return;
      this.pop();
      const s = this.byRank[top - due * this.span]!;
      if (s.due !== due || s.ranAt === t) continue;                      // a stale entry, or one it already ran
      this.current = s;
      s.ranAt = t;
      s.asked = NEVER;
      const next = Math.min(s.e.tick(t), s.asked);
      s.due = next > t ? next : t + 1;
      if (s.due < this.ticks) this.push(s.due, s.rank);
    }
  }

  private nextTurn(s: Slot): number {
    if (this.stage === BEFORE) return this.t;
    if (this.stage === AFTER) return this.t + 1;
    return s.rank > this.current!.rank ? this.t : this.t + 1;
  }

  private schedule(s: Slot, at: number): void {
    if (at >= s.due) return;
    s.due = at;
    if (this.started && at < this.ticks) this.push(at, s.rank);
  }

  // A binary heap of `due × span + rank`: the earliest tick first, then the rank.
  private push(due: number, rank: number): void {
    const h = this.heap;
    let i = h.length;
    const v = due * this.span + rank;
    h.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p]! <= v) break;
      h[i] = h[p]!;
      i = p;
    }
    h[i] = v;
  }

  private pop(): void {
    const h = this.heap;
    const last = h.pop()!;
    if (h.length === 0) return;
    let i = 0;
    const n = h.length;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && h[r]! < h[l]! ? r : l;
      if (h[c]! >= last) break;
      h[i] = h[c]!;
      i = c;
    }
    h[i] = last;
  }
}
