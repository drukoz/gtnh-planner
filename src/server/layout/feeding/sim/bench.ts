// GT++'s Auto Workbench in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 6;
// E4; research §1.3), in mode 0 ("Normal Crafting Table"), line for line (`MTEElectricAutoWorkbench.onPostTick` 182–589).
// - Slots 0–8 are its input buffer, 9–17 its output buffer, 18 its result, 19–27 its grid and 28 the preview. The grid and
//   the preview are ghosts it never stores, but each grid cell counts one of its item (EnderIO's Limited Item Filter), and a
//   grid that holds an item keeps AE2's blocking mode from ever seeing the bench empty (`isIOSlot` is true for all 30 slots).
//   Any item goes into an input slot from any face; only slots 9–18 let items out. Covers act first in its tick.
// - It acts on a countdown, never on a change: each tick its energy holds 2,048 EU the countdown drops by one, and when it
//   runs out the bench updates. While its result slot is empty it throws out a stray, else crafts or, on a failed craft,
//   moves its last input slot to its result slot, then moves the second of each pair of stacks of one ingredient there,
//   each overwriting the one before. Then it pushes one stack out of its back (`gtTransfer`, E4). At throughput 2 and 3
//   it only crafts: no move, no clean-up, no push. An update sets the countdown to 32 ticks, or 1 when it moved or crafted
//   something. A restart sets it to 20 again and forgets its slot pointer and its last craft (none of them is saved).
// - Its energy (its own entity of the `power` phase) gains V[tier] a tick up to its store, `benchEnergyCap(tier)`; a craft
//   takes 2,048 EU and each item pushed 10 (E4). Power itself is not modelled: every bench is fed.
// Pure TypeScript: nothing from node:* may be imported here.

import { V } from '../../../../shared/gt/tiers.ts';
import { OPPOSITE } from '../../../../shared/layout/geometry.ts';
import { BENCH, benchEnergyCap } from '../facts.ts';
import type { BenchNode } from '../model.ts';
import {
  gtTransfer, isTarget, NEVER, nodeOrder, PHASE, type Preloadable, type PushTarget, type SimEntity, type SimInv, type Stack,
} from './core.ts';
import { coverGates, coverTicks, deliverInto, type CoverTicks } from './covers.ts';
import type { BenchMove } from './detect.ts';
import type { SimEnv } from './machine.ts';

const RESULT = BENCH.resultSlot;                              // 18
const LAST_INPUT = BENCH.inputSlots - 1;                      // 8
const LAST_BUFFER = RESULT - 1;                               // 17
const GRID_CELLS = 9;
/** What a network sees from any side: its input buffer, its output buffer and its result. */
const SIDE_SLOTS: readonly number[] = Array.from({ length: RESULT + 1 }, (_, i) => i);
/** What its push walks, in order: the output buffer, then the result. */
const PUSH_SLOTS: readonly number[] = SIDE_SLOTS.slice(BENCH.inputSlots);
/** Its clean-up moves only the stacks of an item that stacks above this. */
const DUPLICATE_LIMIT = 8;
/** At throughput settings 2 and 3 it throws out nothing, cleans up nothing and pushes nothing. */
const NO_PUSH = 2;

/** GT++'s Auto Workbench in mode 0: an inventory and an entity of the tile phase, with its energy an entity of the power phase. */
class AutoWorkbench implements SimInv, SimEntity, Preloadable {
  readonly id: string;
  readonly label: string;
  readonly phase = PHASE.tile;
  readonly order: number;
  /** Its energy, an entity of the power phase: each tick's gain, taken up to the tick it runs. */
  readonly power: SimEntity;
  private readonly env: SimEnv;
  private readonly node: BenchNode;
  private readonly slots: Array<Stack | null> = SIDE_SLOTS.map(() => null);
  /** The grid's nine cells as key ids, −1 where a cell is empty. */
  private readonly cells: readonly number[];
  /** Each grid item once, in key order, with how many cells hold it: what a craft needs in slots 0–17. */
  private readonly needs: ReadonlyArray<{ key: number; count: number }>;
  /** The grid items, in key order: what an empty bench waits for. */
  private readonly allNeeded: readonly number[];
  private readonly inGrid: ReadonlySet<number>;
  /** The grid's items and their containers: what is not a stray. */
  private readonly keeps: ReadonlySet<number>;
  private readonly containerOf: ReadonlyMap<number, number>;
  private readonly result: Stack | null;
  private readonly volts: number;
  private readonly cap: number;
  private readonly gates: ReturnType<typeof coverGates>;
  private readonly covers: CoverTicks;
  /** What its back pushes into: resolved at its first push, null when nothing there takes items. */
  private into: PushTarget | null | undefined;
  // its state (E4): `countdown` (mTicksUntilNextUpdate), `cur` (mCurrentSlot) and `lastOk` (mLastCraftSuccessful) are not saved
  private stored = 0;
  private countdown: number = BENCH.firstTicks;
  private cur = 0;
  private lastOk = false;
  /** The last tick whose gain is in `stored`, and the last whose countdown is counted. */
  private poweredTo = -1;
  private countedTo = -1;
  /** The tick its push first left the stack in its result slot where it was, while that stack stays there; −1 otherwise. */
  private refusedSince = -1;

  constructor(node: BenchNode, env: SimEnv) {
    this.node = node;
    this.env = env;
    this.id = node.id;
    this.label = node.label;
    this.order = nodeOrder(env.model, node.id);
    const { keys } = env;
    this.cells = Array.from({ length: GRID_CELLS }, (_, i) => {
      const key = node.grid[i] ?? null;
      return key === null ? -1 : keys.id(key);
    });
    const counts = new Map<number, number>();
    for (const key of this.cells) if (key >= 0) counts.set(key, (counts.get(key) ?? 0) + 1);
    this.needs = [...counts].sort((a, b) => a[0] - b[0]).map(([key, count]) => ({ key, count }));
    this.allNeeded = this.needs.map((n) => n.key);
    this.inGrid = new Set(counts.keys());
    const containerOf = new Map<number, number>();
    for (const key of this.inGrid) {
      const container = node.containers[keys.key(key)];
      if (container !== undefined) containerOf.set(key, keys.id(container));
    }
    this.containerOf = containerOf;
    this.keeps = new Set([...this.inGrid, ...containerOf.values()]);
    // a bench whose step makes nothing the checker knows crafts nothing (the run's key table leaves out the empty key)
    if (node.result.key === '' || node.result.amount <= 0) this.result = null;
    else {
      const key = keys.id(node.result.key);
      this.result = { key, count: Math.min(node.result.amount, keys.limit(key)) };
    }
    this.volts = V[node.tier] ?? 0;
    this.cap = benchEnergyCap(node.tier);
    const covers = env.model.covers.filter((c) => c.host === node.id);
    this.gates = coverGates(covers);
    this.covers = coverTicks(this, covers, env);
    this.power = {
      phase: PHASE.power, order: this.order,
      tick: (t: number): number => {
        this.countThrough(t - 1);
        this.gain(t);
        // the gains of the ticks it sleeps through are taken when the bench next looks at its energy, which comes to the same
        return NEVER;
      },
    };
    env.stats.register(node.id);
  }

  // ---- The inventory ----

  slotCount(): number {
    return BENCH.slots;
  }

  /** Slots 0–18 as they stand; the grid and the preview are ghosts, never stored. */
  stack(slot: number): Readonly<Stack> | null {
    return this.slots[slot] ?? null;
  }

  sideSlots(): readonly number[] {
    return SIDE_SLOTS;
  }

  stackLimit(key: number): number {
    return this.env.keys.limit(key);
  }

  /**
   * Mode 0's `allowPutStack` (`aIndex < 9`): any item into an input slot, from any face its cover lets it in, onto an empty
   * slot or the same item below its limit.
   */
  canInsert(slot: number, key: number, side: number): boolean {
    if (slot < 0 || slot > LAST_INPUT || !this.gates.lets(side, 'in')) return false;
    const s = this.slots[slot] ?? null;
    return s === null || (s.key === key && s.count < this.stackLimit(key));
  }

  /** `allowPullStack` (`aIndex >= 9`, and `isValidSlot` below 19): the output buffer and the result. */
  canExtract(slot: number, _key: number, side: number): boolean {
    return slot >= BENCH.inputSlots && slot <= RESULT && this.gates.lets(side, 'out');
  }

  /** It acts on its countdown alone, so a change wakes nothing; what lands in an input slot is recorded for the detectors. */
  insert(slot: number, key: number, n: number, by: SimEntity | null): number {
    void by;
    const s = this.slots[slot];
    if (s === undefined || n <= 0) return 0;
    const limit = this.stackLimit(key);
    const m = Math.min(n, s === null ? limit : s.key === key ? limit - s.count : 0);
    if (m <= 0) return 0;
    if (s === null) {
      this.slots[slot] = { key, count: m };
      this.landed(slot, key);
    } else s.count += m;
    return m;
  }

  extract(slot: number, n: number, by: SimEntity | null): number {
    void by;
    const s = this.slots[slot];
    if (s === undefined || s === null || n <= 0) return 0;
    const m = Math.min(n, s.count);
    s.count -= m;
    if (s.count <= 0) this.slots[slot] = null;
    if (slot === RESULT && this.refusedSince >= 0) {
      // its result went out, by its own push or by a network: it is not refused any more
      this.refusedSince = -1;
      this.env.stats.benchFreed(this.id, this.env.sim.t);
    }
    return m;
  }

  /** What it holds, and one for each grid cell that holds `key` (`getStackInSlot` shows the ghosts too). */
  countAll(key: number): number {
    let n = 0;
    for (const need of this.needs) if (need.key === key) n += need.count;
    for (const s of this.slots) if (s !== null && s.key === key) n += s.count;
    return n;
  }

  /** Never while its grid holds an item (every one of its 30 slots counts); else when it holds nothing AE2's blocking mode does not ignore. */
  countsAsEmpty(): boolean {
    if (this.needs.length > 0) return false;
    for (const s of this.slots) if (s !== null && !this.env.model.ignoredByBlocking(this.env.keys.key(s.key))) return false;
    return true;
  }

  preload(slot: number, key: number, count: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot > RESULT) throw new RangeError(`${this.label} has no slot ${slot} that holds items`);
    this.slots[slot] = count > 0 ? { key, count: Math.min(count, this.stackLimit(key)) } : null;
    if (count > 0) this.landed(slot, key);
  }

  /** A new stack in `slot`: in an input slot, how many input slots its item fills now, and an item not in its grid (`feed_overfill`). */
  private landed(slot: number, key: number): void {
    if (slot > LAST_INPUT) return;
    const { stats, sim } = this.env;
    let n = 0;
    for (let i = 0; i <= LAST_INPUT; i++) if (this.slots[i]?.key === key) n++;
    stats.occupancy(this.id, key, n, sim.t);
    if (!this.inGrid.has(key)) stats.benchTook(this.id, key, sim.t);
  }

  // ---- Energy and the countdown ----

  /** The gains up to tick `t`: `min(V[tier], cap − stored)` a tick. */
  private gain(t: number): void {
    if (this.poweredTo >= t) return;
    this.stored = Math.min(this.cap, this.stored + this.volts * (t - this.poweredTo));
    this.poweredTo = t;
  }

  /**
   * Counts every tick up to `last` it slept through: the tick's gain, then its countdown, which drops while 2,048 EU are
   * there and cannot run out on such a tick, as the bench is due on the tick it does (`nextUpdate`).
   */
  private countThrough(last: number): void {
    for (let s = this.countedTo + 1; s <= last; s++) {
      this.gain(s);
      if (this.stored >= BENCH.craftEU && --this.countdown < 1) throw new Error(`${this.label} slept through its update at tick ${s}`);
      this.countedTo = s;
    }
  }

  /** The tick of its next update after tick `t`: the first tick whose energy holds 2,048 EU, then as many ticks as its countdown. */
  private nextUpdate(t: number): number {
    const short = BENCH.craftEU - this.stored;
    if (short > 0 && this.volts <= 0) return NEVER;
    const from = short <= 0 ? t + 1 : t + Math.ceil(short / this.volts);
    return from + this.countdown - 1;
  }

  /** The restart (at the start of tick `restartAt`): the countdown at 20, the slot pointer at 0, no last craft (E4: none is saved). */
  restart(): void {
    this.countThrough(this.env.sim.t);
    this.countdown = BENCH.firstTicks;
    this.cur = 0;
    this.lastOk = false;
  }

  // ---- The tick ----

  tick(t: number): number {
    this.countThrough(t - 1);
    this.gain(t);
    this.covers(t);
    if (this.stored >= BENCH.craftEU && --this.countdown < 1) this.update(t);
    this.countedTo = t;
    return Math.min(this.nextUpdate(t), this.covers.next(t));
  }

  /**
   * One update (`onPostTick` 182–589), line for line. What its craft test finds is recorded as a machine's recipe checks
   * are, for `feed_starved` and `feed_slow`: a craft is a run of its recipe (recipe 0, the one its grid is laid from); a
   * failed craft, or slots 0–17 holding nothing, waits for the grid items short there; a full result slot or a held-back
   * result waits for no input.
   */
  private update(t: number): void {
    const s = this.slots;
    const { stats } = this.env;
    const pushes = this.node.throughput < NO_PUSH;
    this.countdown = BENCH.idleTicks;
    if (s[RESULT] === null) {
      if (!this.lastOk) {
        this.cur = (this.cur + 1) % RESULT;
        for (let i = 0; i < LAST_BUFFER && s[this.cur] === null; i++) this.cur = (this.cur + 1) % RESULT;
      }
      const looked = s[this.cur] ?? null;
      if (looked !== null && !this.keeps.has(looked.key) && this.cur < LAST_INPUT && pushes) {
        // a stray (line 240): the grid is taken as empty for the rest of this update
        this.toResult(this.cur, 'stray', t);
        this.lastOk = false;
      } else if (this.gridHasResult()) {
        if (this.heldBack(t)) {
          // its result is held back (`late_input`): no craft before the hold ends, as the line's makers start no run
          this.lastOk = false;
          stats.waiting(this.id, 0, [], null, t);
        } else {
          if (this.holdsAnything()) {
            if (s[LAST_BUFFER] === null && this.hasEverything()) {
              this.lastOk = true;
              this.craft(t);
            } else {
              this.lastOk = false;
              stats.waiting(this.id, 0, this.missing(), null, t);
              if (s[LAST_INPUT] !== null && pushes) this.toResult(LAST_INPUT, 'failed', t);
            }
          } else stats.waiting(this.id, 0, this.allNeeded, null, t);
          if (s[RESULT] === null && pushes) this.clearDuplicates(t);
        }
      } else this.lastOk = false;
    } else stats.waiting(this.id, 0, [], null, t);
    if (pushes) this.push(t);
  }

  /** The grid holds an item, whose result the checker knows. */
  private gridHasResult(): boolean {
    return this.needs.length > 0 && this.result !== null;
  }

  /** Its result is held back (`late_input`: `env.heldBack` until `env.heldUntil`). */
  private heldBack(t: number): boolean {
    const { heldBack, heldUntil } = this.env;
    return heldBack.size > 0 && t < heldUntil && heldBack.has(this.node.result.key);
  }

  /** The grid items slots 0–17 hold fewer of than the grid's cells, in key order. */
  private missing(): number[] {
    const out: number[] = [];
    for (const need of this.needs) if (this.content(need.key) < need.count) out.push(need.key);
    return out;
  }

  /** Whether slots 0–17 hold anything (`benchContent`). */
  private holdsAnything(): boolean {
    for (let i = 0; i <= LAST_BUFFER; i++) if (this.slots[i] !== null) return true;
    return false;
  }

  /** How many of `key` slots 0–17 hold together (`benchContent`, merged). */
  private content(key: number): number {
    let n = 0;
    for (let i = 0; i <= LAST_BUFFER; i++) {
      const s = this.slots[i];
      if (s !== null && s !== undefined && s.key === key) n += s.count;
    }
    return n;
  }

  /** Whether slots 0–17 together hold every grid item in its grid count. */
  private hasEverything(): boolean {
    for (const need of this.needs) if (this.content(need.key) < need.count) return false;
    return true;
  }

  /** Slot `from`'s stack into the result slot, which takes it whole, and a 1-tick countdown. */
  private toResult(from: number, why: BenchMove, t: number): void {
    const moved = this.slots[from]!;
    this.slots[RESULT] = moved;
    this.slots[from] = null;
    this.countdown = BENCH.busyTicks;
    this.env.stats.benchMoved(this.id, moved.key, moved.count, why, t);
  }

  /**
   * A craft (lines 502–554): cell 8 down to cell 0, one of the cell's item from the highest slot of 0–17 that holds it, its
   * container into the first slot of 9–17 that is empty or holds the container with room (where none is, it is gone); the
   * result into slot 18, 2,048 EU drawn.
   */
  private craft(t: number): void {
    const s = this.slots;
    for (let cell = GRID_CELLS - 1; cell >= 0; cell--) {
      const key = this.cells[cell]!;
      if (key < 0) continue;
      for (let j = LAST_BUFFER; j >= 0; j--) {
        const st = s[j];
        if (st === null || st === undefined || st.key !== key) continue;
        st.count -= 1;
        if (st.count <= 0) s[j] = null;
        const container = this.containerOf.get(key);
        if (container !== undefined) this.returnContainer(container);
        break;
      }
    }
    s[RESULT] = { key: this.result!.key, count: this.result!.count };
    this.stored -= BENCH.craftEU;
    this.countdown = BENCH.busyTicks;
    this.env.stats.benchCrafted(this.id, t);
  }

  private returnContainer(key: number): void {
    for (let k = BENCH.inputSlots; k <= LAST_BUFFER; k++) {
      const st = this.slots[k];
      if (st === null || st === undefined) {
        this.slots[k] = { key, count: 1 };
        return;
      }
      if (st.key === key && st.count < this.stackLimit(key)) {
        st.count += 1;
        return;
      }
    }
  }

  /**
   * The clean-up of duplicates (lines 565–573): for each pair of stacks of one item that stacks above 8 in slots 0–8, the later
   * one into the result slot. It looked at the result slot once, before it started, so each move overwrites the one before.
   */
  private clearDuplicates(t: number): void {
    const s = this.slots;
    for (let i = 0; i < LAST_INPUT; i++) {
      for (let j = i + 1; j <= LAST_INPUT; j++) {
        const a = s[i], b = s[j];
        if (a === null || a === undefined || b === null || b === undefined || a.key !== b.key || this.stackLimit(a.key) <= DUPLICATE_LIMIT) continue;
        const overwritten = s[RESULT];
        if (overwritten !== null && overwritten !== undefined) this.env.stats.benchLost(this.id, overwritten.key, overwritten.count, t);
        this.toResult(j, 'duplicate', t);
        break;
      }
    }
  }

  /**
   * The push (lines 581–586): one stack, up to 64 items, from slots 9–18 in slot order into the block behind it, skipping
   * what that block refuses (E4), at 10 EU an item; nothing behind it takes nothing (no `dropItems`). A push that moves
   * nothing while the result slot holds a stack leaves that stack refused.
   */
  private push(t: number): void {
    const back = this.node.back;
    let moved = 0;
    if (back >= 0 && back <= 5) {
      if (this.into === undefined) {
        const there = this.env.push(this.id, back);
        this.into = there === null ? null : isTarget(there) ? there : deliverInto(this.env, there);
      }
      if (this.into !== null) moved = gtTransfer(this, PUSH_SLOTS, back, this.into, OPPOSITE[back]!, 1, 64, this);
    }
    this.stored = Math.max(0, this.stored - BENCH.euPerItem * moved);
    const left = this.slots[RESULT];
    if (left !== null && left !== undefined && moved === 0 && this.refusedSince < 0) {
      this.refusedSince = t;
      this.env.stats.benchStuck(this.id, left.key, t);
    }
  }
}

/** The Auto Workbench of node `node` in this run, with its energy (`power`, an entity of the power phase) and its restart. */
export function bench(node: BenchNode, env: SimEnv): SimInv & SimEntity & Preloadable & { restart(): void; readonly power: SimEntity } {
  return new AutoWorkbench(node, env);
}
