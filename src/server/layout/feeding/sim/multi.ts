// Multiblocks in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 5 rules 1–3;
// E3, E15; research §1.2): a multiblock's input buses, its output buses and its controller, each a tile entity of its own.
// - An input bus takes items only through its front, onto an empty slot or a stack of the same item below its limit: with
//   the Input Filter on only what the controller's recipe map takes, with Limiting mode on an item already in a slot only
//   into that slot. Anything may be pulled out of its front. When its contents change it sorts them into its first slots,
//   each item merged into full stacks where it first stood (sorting is on: GT's `fillStacksIntoFirstSlots`), and tells
//   its controller.
// - An output bus takes nothing from outside; a bus locked to an item stores only that item. When its own timer (`aTick`)
//   is a multiple of 8 it pushes every stack out of its front by GT's transfer, skipping what the block there refuses, and
//   moves nothing when nothing is there (no `dropItems` on a bus). Whenever it loses items it tells its controller.
// - The controller looks for a recipe when a bus tells it, when a run ends and when its chunk loads (tick 0, and again at
//   `restartAt` in `restart`: ruling R-17), never on a timer. With Input Separation on (the layout's setting, else its
//   class's default, E15) each input bus is checked alone, in local order; off, all of them together. On each bus (or on
//   all of them) it tries its cached recipe first, then its recipes in step order, and starts the first whose inputs are
//   there and whose outputs fit; a recipe whose outputs do not fit is passed over, and when no recipe fits it waits for a
//   drain (void protection keeps items). Inputs come out of the matched bus (or the buses in local order), each bus from
//   its highest slot down, and every bus sorts itself again. Outputs go into the buses locked to them first, then into the
//   unlocked ones, in local order within each group, each bus merging before it fills empty slots. Chances, fluids, fast
//   steps and held-back makers work as for a basic machine (Task 4 rules 6, 7, 7a).
// Pure TypeScript: nothing from node:* may be imported here.

import { OPPOSITE, type Vec3 } from '../../../../shared/layout/geometry.ts';
import { FAST_FACTOR } from '../contract.ts';
import { compareLocal } from '../frame.ts';
import type { BusNode, MultiNode, OutBusNode } from '../model.ts';
import {
  gtTransfer, isTarget, NEVER, nodeOrder, PHASE, type FluidWaiter, type Preloadable, type PushTarget, type SimEntity, type SimInv,
  type Stack,
} from './core.ts';
import { coverGates, coverTicks, deliverInto, type CoverTicks } from './covers.ts';
import type { Crowd } from './detect.ts';
import { aTick, compileRecipe, rollShare, type CompiledRecipe, type SimEnv } from './machine.ts';

/** An output bus pushes when its timer is a multiple of this (`(aTick & 7) == 0`, E3). */
const PUSH_EVERY = 8;

/**
 * Puts up to `n` of `key` into one bus's `slots`, as GT's output bus stores a stack: onto its stacks of the item below
 * `limit`, then into its empty slots, in slot order. Returns what is left.
 */
function place(slots: Array<Stack | null>, key: number, n: number, limit: number): number {
  let left = n;
  for (const s of slots) {
    if (left <= 0) break;
    if (s === null || s.key !== key || s.count >= limit) continue;
    const m = Math.min(left, limit - s.count);
    s.count += m;
    left -= m;
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i] !== null) continue;
    const m = Math.min(left, limit);
    slots[i] = { key, count: m };
    left -= m;
  }
  return left;
}

/** A multiblock's bus: its slots, its front, what its covers let through it, and its covers acting in its tick (Task 4 rule 5a). */
abstract class Bus implements SimInv, SimEntity, Preloadable {
  readonly id: string;
  readonly label: string;
  readonly phase = PHASE.tile;
  readonly order: number;
  /** The multiblock the bus belongs to: `multiblock` sets it once every part is built. */
  controller: Controller | null = null;
  protected readonly env: SimEnv;
  protected readonly front: number;
  protected readonly slots: Array<Stack | null>;
  protected readonly all: readonly number[];
  protected readonly gates: ReturnType<typeof coverGates>;
  protected readonly covers: CoverTicks;

  constructor(node: BusNode | OutBusNode, env: SimEnv) {
    this.id = node.id;
    this.label = node.label;
    this.env = env;
    this.order = nodeOrder(env.model, node.id);
    this.front = node.front;
    this.slots = Array.from({ length: Math.max(0, node.slots) }, () => null);
    this.all = this.slots.map((_, i) => i);
    const covers = env.model.covers.filter((c) => c.host === node.id);
    this.gates = coverGates(covers);
    this.covers = coverTicks(this, covers, env);
  }

  abstract canInsert(slot: number, key: number, side: number): boolean;
  abstract insert(slot: number, key: number, n: number, by: SimEntity | null): number;
  abstract extract(slot: number, n: number, by: SimEntity | null): number;
  abstract tick(t: number): number;

  slotCount(): number {
    return this.slots.length;
  }

  stack(slot: number): Readonly<Stack> | null {
    return this.slots[slot] ?? null;
  }

  sideSlots(): readonly number[] {
    return this.all;
  }

  stackLimit(key: number): number {
    return this.env.keys.limit(key);
  }

  /** Only its front lets items out, past the cover there. */
  canExtract(slot: number, _key: number, side: number): boolean {
    return side === this.front && slot >= 0 && slot < this.slots.length && this.gates.lets(side, 'out');
  }

  countAll(key: number): number {
    let n = 0;
    for (const s of this.slots) if (s !== null && s.key === key) n += s.count;
    return n;
  }

  /** Every slot counts, but not an item AE2's blocking mode ignores (`model.ignoredByBlocking`: the pack's list, GT's lenses among them). */
  countsAsEmpty(): boolean {
    for (const s of this.slots) if (s !== null && !this.env.model.ignoredByBlocking(this.env.keys.key(s.key))) return false;
    return true;
  }

  preload(slot: number, key: number, count: number): void {
    if (slot < 0 || slot >= this.slots.length || !Number.isInteger(slot)) throw new RangeError(`${this.label} has no slot ${slot}`);
    this.slots[slot] = count > 0 ? { key, count: Math.min(count, this.stackLimit(key)) } : null;
  }

  /** How many of its slots hold `key`. */
  slotsOf(key: number): number {
    let n = 0;
    for (const s of this.slots) if (s !== null && s.key === key) n++;
    return n;
  }

  protected isEmpty(): boolean {
    for (const s of this.slots) if (s !== null) return false;
    return true;
  }
}

/** GT's input bus (`MTEHatchInputBus`, rule 1). */
class InputBus extends Bus {
  private readonly limited: boolean;
  private readonly filtered: boolean;
  private readonly maps: readonly string[];
  private changed = false;

  constructor(node: BusNode, env: SimEnv) {
    super(node, env);
    this.limited = node.limited === true;
    // unset is the constructor's default, off; a placed bus has its placer's preference (E3)
    this.filtered = node.inputFilter === true;
    this.maps = [...node.maps];
  }

  canInsert(slot: number, key: number, side: number): boolean {
    return side === this.front && this.gates.lets(side, 'in') && this.slotTakes(slot, key);
  }

  /** GT's slot test without the side: empty or the same item below its limit, Limiting mode, the Input Filter. */
  slotTakes(slot: number, key: number): boolean {
    if (slot < 0 || slot >= this.slots.length) return false;
    const s = this.slots[slot] ?? null;
    if (s !== null && (s.key !== key || s.count >= this.stackLimit(key))) return false;
    // Limiting mode (`limitedAllowPutStack`): an item already in a slot goes only into the first slot that holds it
    if (this.limited) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i]?.key === key) {
          if (i !== slot) return false;
          break;
        }
      }
    }
    return !this.filtered || this.filterTakes(key);
  }

  /** The Input Filter: some recipe of the controller's map takes the item (`containsInput`). */
  private filterTakes(key: number): boolean {
    const k = this.env.keys.key(key);
    return this.maps.some((m) => this.env.model.mapTakes(m, k));
  }

  /** Whether some slot takes `key` (the slot test: what keeps a kind out is what fills the slots). */
  takesAnywhere(key: number): boolean {
    for (let slot = 0; slot < this.slots.length; slot++) if (this.slotTakes(slot, key)) return true;
    return false;
  }

  insert(slot: number, key: number, n: number, by: SimEntity | null): number {
    const s = this.slots[slot];
    if (s === undefined || n <= 0) return 0;
    const limit = this.stackLimit(key);
    const m = Math.min(n, s === null ? limit : s.key === key ? limit - s.count : 0);
    if (m <= 0) return 0;
    if (s === null) {
      this.slots[slot] = { key, count: m };
      this.env.stats.occupancy(this.id, key, this.slotsOf(key), this.env.sim.t);
    } else s.count += m;
    this.markChanged(by);
    return m;
  }

  extract(slot: number, n: number, by: SimEntity | null): number {
    const s = this.slots[slot];
    if (s === undefined || s === null || n <= 0) return 0;
    const m = Math.min(n, s.count);
    s.count -= m;
    if (s.count <= 0) this.slots[slot] = null;
    this.markChanged(by);
    return m;
  }

  override preload(slot: number, key: number, count: number): void {
    super.preload(slot, key, count);
    if (count > 0) this.env.stats.occupancy(this.id, key, this.slotsOf(key), this.env.sim.t);
  }

  /** A change: GT's `hasInventoryBeenModified`, which the bus sees at its next turn. */
  private markChanged(by: SimEntity | null): void {
    this.changed = true;
    this.env.sim.wake(this, by);
  }

  /**
   * A run's inputs: up to `n` of `key` from its highest slot down (E3: GT lists a bus's slots from the last one), taken
   * straight out of its slots as GT's controller does, so no change is marked. Returns what it took.
   */
  consume(key: number, n: number): number {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i] ?? null;
      if (s === null || s.key !== key) continue;
      const m = Math.min(left, s.count);
      s.count -= m;
      left -= m;
      if (s.count <= 0) this.slots[i] = null;
    }
    return n - left;
  }

  /**
   * Its stacks into its first slots (`fillStacksIntoFirstSlots`): each item's total, a full stack at a time, into the next
   * slot at each place one of its stacks stood, in slot order, so one item in two part stacks becomes one.
   */
  sort(): void {
    const stacks = this.slots.filter((s): s is Stack => s !== null);
    const left = new Map<number, number>();
    for (const s of stacks) left.set(s.key, (left.get(s.key) ?? 0) + s.count);
    this.slots.fill(null);
    let next = 0;
    for (const s of stacks) {
      const have = left.get(s.key) ?? 0;
      if (have <= 0) continue;
      const m = Math.min(have, this.stackLimit(s.key));
      this.slots[next++] = { key: s.key, count: m };
      left.set(s.key, have - m);
    }
  }

  /** Its covers act; after a change it sorts itself and tells its controller. */
  tick(t: number): number {
    this.covers(t);
    if (this.changed) {
      this.sort();
      this.controller?.alert(this);
    }
    this.changed = false;
    return this.covers.next(t);
  }
}

/** GT's output bus (`MTEHatchOutputBus`, rule 2). */
class OutputBus extends Bus {
  /** The item it is locked to (`lockedItem`) as a key id, −1 when unlocked; a lock no item matches stores nothing (ruling R-7). */
  readonly lock: number;
  /** What its front pushes into: resolved at its first push, null when nothing there takes items. */
  private into: PushTarget | null | undefined;

  constructor(node: OutBusNode, env: SimEnv) {
    super(node, env);
    this.lock = node.lock === null ? -1 : env.keys.id(node.lock);
  }

  /** It takes no automated input (E3): only its controller stores into it. */
  canInsert(): boolean {
    return false;
  }

  insert(): number {
    return 0;
  }

  /** Whatever takes items out of it (its own push, a network at its front), its controller hears of it. */
  extract(slot: number, n: number, by: SimEntity | null): number {
    const s = this.slots[slot];
    if (s === undefined || s === null || n <= 0) return 0;
    const m = Math.min(n, s.count);
    const key = s.key;
    s.count -= m;
    if (s.count <= 0) this.slots[slot] = null;
    this.env.stats.extracted(this.id, key, m, this.env.sim.t);
    this.controller?.alert(by);
    return m;
  }

  /** A run's output: up to `n` of `key`, merged first, then into empty slots. Returns what is left. */
  store(key: number, n: number, by: SimEntity | null): number {
    const left = place(this.slots, key, n, this.stackLimit(key));
    if (left < n) this.env.sim.wake(this, by);
    return left;
  }

  /** Its slots as they stand, for a test of what fits. */
  copy(): Array<Stack | null> {
    return this.slots.map((s) => (s === null ? null : { key: s.key, count: s.count }));
  }

  /** The item of its first stack that cannot take `amount` more of `key` (another item, or too full), or −1. */
  inTheWay(key: number, amount: number): number {
    for (const s of this.slots) if (s !== null && (s.key !== key || s.count + amount > this.stackLimit(key))) return s.key;
    return -1;
  }

  /** Its covers act; when its timer is a multiple of 8 it pushes every stack out of its front. */
  tick(t: number): number {
    this.covers(t);
    if (aTick(this.env, t) % PUSH_EVERY === 0 && !this.isEmpty()) this.push();
    return Math.min(this.nextPush(t), this.covers.next(t));
  }

  private push(): void {
    const front = this.front;
    if (front < 0 || front > 5) return;
    if (this.into === undefined) {
      const there = this.env.push(this.id, front);
      this.into = there === null ? null : isTarget(there) ? there : deliverInto(this.env, there);
    }
    if (this.into !== null) gtTransfer(this, this.all, front, this.into, OPPOSITE[front]!, this.slots.length, 64, this);
  }

  /** The next tick after `t` whose timer is a multiple of 8, while it holds items and may have somewhere to push them (ruling R-11). */
  private nextPush(t: number): number {
    if (this.into === null || this.front < 0 || this.front > 5 || this.isEmpty()) return NEVER;
    const age = aTick(this.env, t);
    return this.env.loadedAt - 1 + (Math.floor(age / PUSH_EVERY) + 1) * PUSH_EVERY;
  }
}

/** A multiblock's controller (`MTEMultiBlockBase`, rule 3): an entity of the tile phase with no inventory of its own here. */
class Controller implements SimEntity, FluidWaiter {
  readonly phase = PHASE.tile;
  readonly order: number;
  private readonly node: MultiNode;
  private readonly env: SimEnv;
  private readonly ins: readonly InputBus[];
  private readonly outs: readonly OutputBus[];
  /** The buses a recipe is looked for on, in turn: each input bus alone with Input Separation on, else all of them together. */
  private readonly groups: ReadonlyArray<readonly InputBus[]>;
  private readonly recipes: CompiledRecipe[];
  private readonly rolled: number[];
  private readonly made = new Map<number, number>();         // chanced outputs rolled so far, by key
  private readonly used = new Map<number, number>();         // chanced inputs used up so far, by key
  private readonly eligible = new Map<number, number[]>();   // by output key: the output buses it goes into, in order
  private alerted = false;
  private cached = -1;
  private running = -1;
  private endAt = 0;
  private heldWait = false;

  constructor(node: MultiNode, env: SimEnv, ins: readonly InputBus[], outs: readonly OutputBus[]) {
    this.node = node;
    this.env = env;
    this.ins = ins;
    this.outs = outs;
    this.order = nodeOrder(env.model, node.id);
    const separate = node.inputSeparation ?? node.separationDefault;
    this.groups = separate && ins.length > 0 ? ins.map((b) => [b]) : [ins];
    this.recipes = node.recipes.map((r) => compileRecipe(r, env.keys));
    this.rolled = Array.from({ length: Math.max(0, ...this.recipes.map((r) => r.outputs.length)) }, () => 0);
    env.stats.register(node.id);
    // held items stand in the first input bus's slots 0, 1, … at tick 0, one each, as a basic machine's do (Task 4 rule 6)
    const first = ins[0];
    if (first !== undefined) {
      const held = [...new Set(node.recipes.flatMap((r) => r.held))].slice(0, first.slotCount());
      held.forEach((key, slot) => first.preload(slot, env.keys.id(key), 1));
    }
  }

  /** A bus changed or lost items, or a pooled fluid arrived: it looks for a recipe at its next turn, when it is idle. */
  alert(by: SimEntity | null): void {
    this.alerted = true;
    this.env.sim.wake(this, by);
  }

  fluidArrived(by: SimEntity | null): void {
    this.alert(by);
  }

  tick(t: number): number {
    const env = this.env;
    let ended = false;
    if (this.running >= 0 && t >= this.endAt) {
      this.finish();
      ended = true;
    }
    const heldOver = this.heldWait && t >= env.heldUntil;
    if (this.running < 0 && (ended || this.alerted || t === env.loadedAt || heldOver)) this.check(t);
    this.alerted = false;
    if (this.running >= 0) return this.endAt;
    return this.heldWait && env.heldUntil > t ? env.heldUntil : NEVER;
  }

  private check(t: number): void {
    const env = this.env;
    this.heldWait = false;
    const count = this.recipes.length;
    if (count === 0) return;
    let blocked = -1, blockedBy = -1;
    for (const group of this.groups) {
      // its cached recipe first, then its recipes in step order
      for (let k = -1; k < count; k++) {
        const r = k < 0 ? this.cached : k;
        if (r < 0 || (k >= 0 && r === this.cached)) continue;
        const recipe = this.recipes[r]!;
        if (!this.readyOn(recipe, group)) continue;
        const block = this.blocking(recipe);
        if (block >= 0) {
          if (blocked < 0) {
            blocked = r;
            blockedBy = block;
          }
          continue;
        }
        if (env.heldBack.size > 0 && t < env.heldUntil && recipe.outputKeys.some((key) => env.heldBack.has(key))) {
          // its step makes an item held back: no run before the hold ends (Task 11's late_input)
          this.heldWait = true;
          env.stats.waiting(this.node.id, r, [], null, t);
          return;
        }
        this.start(r, group, t);
        return;
      }
    }
    if (blocked >= 0) {
      env.stats.blocked(this.node.id, blocked, t, blockedBy);
      return;
    }
    // no recipe has its set on one bus (or on its buses together): what its cached recipe, else its first, misses over them all
    const r = this.cached >= 0 ? this.cached : 0;
    const missing = this.missing(this.recipes[r]!);
    for (const recipe of this.recipes) for (const f of recipe.fluidsIn) if (!env.fluids.has(f.key, f.amount)) env.fluids.wait(f.key, this);
    if (missing.length === 0) env.stats.separated(this.node.id, r, t);
    else env.stats.waiting(this.node.id, r, missing, this.crowd(missing), t);
  }

  /** Whether recipe `r`'s inputs and held items are on the buses of `group` together, and its fluids there. */
  private readyOn(r: CompiledRecipe, group: readonly InputBus[]): boolean {
    for (const need of r.need) {
      let have = 0;
      for (const bus of group) have += bus.countAll(need.key);
      if (have < need.amount) return false;
    }
    for (const f of r.fluidsIn) if (!this.env.fluids.has(f.key, f.amount)) return false;
    return true;
  }

  /** Recipe `r`'s missing keys over all its input buses, in key order: items short (held ones too), pooled fluids short in their pool. */
  private missing(r: CompiledRecipe): number[] {
    const out: number[] = [];
    for (const need of r.need) {
      let have = 0;
      for (const bus of this.ins) have += bus.countAll(need.key);
      if (have < need.amount) out.push(need.key);
    }
    for (const f of r.fluidsIn) if (!this.env.fluids.has(f.key, f.amount) && !out.includes(f.key)) out.push(f.key);
    return out.sort((a, b) => a - b);
  }

  /**
   * The first missing item (key order) that no slot of any input bus takes, and the kind that fills the most slots of one
   * bus (ties: the earlier bus, then the lower slot) with that bus's slot count, or null (rule 4, Task 4 rule 6d).
   */
  private crowd(missing: readonly number[]): Crowd | null {
    const keys = this.env.keys;
    const out = missing.find((k) => !keys.isFluid(k) && !this.ins.some((b) => b.takesAnywhere(k)));
    if (out === undefined) return null;
    let by = -1, most = 0, of = 0;
    for (const bus of this.ins) {
      for (let slot = 0; slot < bus.slotCount(); slot++) {
        const s = bus.stack(slot);
        if (s === null) continue;
        const n = bus.slotsOf(s.key);
        if (n > most) {
          most = n;
          by = s.key;
          of = bus.slotCount();
        }
      }
    }
    return by < 0 ? null : { key: out, by, slots: most, of };
  }

  /** The output buses an output of `key` goes into, by index: those locked to it, then the unlocked ones, each group in local order (`ItemEjectionHelper`, E3). */
  private busesFor(key: number): readonly number[] {
    const known = this.eligible.get(key);
    if (known !== undefined) return known;
    const list: number[] = [];
    this.outs.forEach((b, i) => { if (b.lock === key) list.push(i); });
    this.outs.forEach((b, i) => { if (b.lock < 0) list.push(i); });
    this.eligible.set(key, list);
    return list;
  }

  /**
   * Whether recipe `r`'s outputs fit its output buses (void protection keeps items, E3): each at its full amount (chance
   * ignored), in recipe order, placed as a run's end places them. Returns −1 when they fit, else the item in the way of
   * the first output that does not: the first stack in that output's buses that cannot take it, else the output itself.
   */
  private blocking(r: CompiledRecipe): number {
    if (r.outputs.length === 0) return -1;
    const scratch = this.outs.map((b) => b.copy());
    for (const o of r.outputs) {
      let left = o.amount;
      const limit = this.env.keys.limit(o.key);
      for (const b of this.busesFor(o.key)) {
        if (left <= 0) break;
        left = place(scratch[b]!, o.key, left, limit);
      }
      if (left <= 0) continue;
      for (const b of this.busesFor(o.key)) {
        const key = this.outs[b]!.inTheWay(o.key, o.amount);
        if (key >= 0) return key;
      }
      return o.key;
    }
    return -1;
  }

  private start(r: number, group: readonly InputBus[], t: number): void {
    const env = this.env;
    const recipe = this.recipes[r]!;
    // inputs out of the matched bus, or the buses in local order, each from its highest slot down
    for (const input of recipe.inputs) {
      let n = input.chance >= 1 ? input.amount : rollShare(this.used, input.key, input.amount * input.chance);
      for (const bus of group) {
        if (n <= 0) break;
        n -= bus.consume(input.key, n);
      }
    }
    // GT's `updateSlots`: every input bus sorts its stacks again
    for (const bus of this.ins) bus.sort();
    for (const f of recipe.fluidsIn) env.fluids.take(f.key, f.amount);
    recipe.outputs.forEach((o, i) => { this.rolled[i] = o.chance >= 1 ? o.amount : rollShare(this.made, o.key, o.amount * o.chance); });
    this.cached = r;
    this.running = r;
    this.endAt = t + (env.fastSteps.has(recipe.stepId) ? Math.max(1, Math.ceil(recipe.ticks / FAST_FACTOR)) : recipe.ticks);
    env.stats.started(this.node.id, r, t);
  }

  /** The run's end: each output, at its rolled amount, into its output buses; its fluids into their pools. */
  private finish(): void {
    const recipe = this.recipes[this.running]!;
    recipe.outputs.forEach((o, i) => {
      let left = this.rolled[i] ?? 0;
      for (const b of this.busesFor(o.key)) {
        if (left <= 0) break;
        left = this.outs[b]!.store(o.key, left, this);
      }
    });
    for (const f of recipe.fluidsOut) this.env.fluids.add(f.key, f.amount, this);
    this.running = -1;
  }
}

/** Sorted by local cell: GT's bus order, taken in the line's own frame. */
function byLocal<T extends { local: Vec3 }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareLocal(a.local, b.local));
}

/**
 * The controller of multiblock node `node` in this run, and its input and output buses (each in local order), each an
 * entity of its own; a test may set the buses' contents before the first tick (`Preloadable`), as `runScenario`'s `initial` does.
 */
export function multiblock(node: MultiNode, env: SimEnv): {
  controller: SimEntity; buses: Array<SimInv & SimEntity & Preloadable>; outBuses: Array<SimInv & SimEntity & Preloadable>;
} {
  const buses = byLocal(node.inBuses).map((b) => new InputBus(b, env));
  const outBuses = byLocal(node.outBuses).map((b) => new OutputBus(b, env));
  const controller = new Controller(node, env, buses, outBuses);
  for (const bus of [...buses, ...outBuses]) bus.controller = controller;
  return { controller, buses, outBuses };
}
