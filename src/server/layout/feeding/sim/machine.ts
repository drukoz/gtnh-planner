// The GT basic machine in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 4
// rules 5–8; E1, E2, E17; research §1.1), and the environment every model of a scenario run shares (`SimEnv`).
// - Slots 0 … inSlots − 1 are its inputs, then its outputs. Items go in by GT's slot test: never through its front, into
//   an input slot, through the output side only while Input from Output Side is allowed, past the side's cover, onto an
//   empty slot or a stack of the same item below its limit; with Multi Stack Input Off an item already in an input slot
//   goes only into that slot; with the Input Filter on, by its slot-count rule (E2). Only the output slots let items out,
//   never through the front.
// - Each tick (E1): its covers act; a run in progress counts the tick and on its last one puts its outputs into the
//   output slots; with auto-output on it pushes its outputs out of its output side; then, idle, it looks for a recipe when
//   a run just ended, its inventory changed since its last tick or its timer (`aTick`) is a multiple of 600. It takes its
//   cached recipe when that recipe's inputs are there, else its first recipe whose are; a recipe whose outputs do not fit
//   blocks it, and it never tries another. Inputs are taken when a run starts, chanced outputs rolled then, by a
//   deterministic accumulator per machine and item (Review Focus 5).
// - A steam machine (E17) keeps these slot rules, takes no cover and never auto-outputs. In AE2 mode the player takes its
//   outputs out by hand: each run's outputs go to `env.byHand` (into ME) as the run ends, not into its output slots.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../../shared/keys.ts';
import { OPPOSITE } from '../../../../shared/layout/geometry.ts';
import { FAST_FACTOR, type ScenarioName } from '../contract.ts';
import type { BasicNode, FeedModel, NodeId, SimRecipe } from '../model.ts';
import {
  gtTransfer, nodeOrder, PHASE, type FluidPools, type FluidWaiter, type KeyTable, type Preloadable, type PushTarget, type Sim,
  type SimEntity, type SimInv, type Stack,
} from './core.ts';
import { coverGates, coverTicks, pushTargetOf, type CoverTicks } from './covers.ts';
import type { Crowd, SimStats } from './detect.ts';

/** What every model of one scenario run shares. */
export interface SimEnv {
  readonly sim: Sim; readonly keys: KeyTable; readonly stats: SimStats; readonly scenario: ScenarioName; readonly model: FeedModel;
  /**
   * What a GT transfer out of side `side` of the block at `from` meets: the receiver a network registered at the
   * neighbouring cell for that side (a pipe, a conduit face, an ME interface), else the inventory there (a node or a
   * bus), else null (air, a routed pipe, a cable).
   */
  push(from: NodeId, side: number): PushTarget | SimInv | null;
  /** The inventory of a node or a bus by its id, or null. */
  inv(id: NodeId): SimInv | null;
  /** Steps whose runs last `⌈ticks / FAST_FACTOR⌉` (`fast_supplier`; empty otherwise). */
  fastSteps: ReadonlySet<string>;
  /** Items held back until `heldUntil` (`late_input`; empty otherwise): input chests do not stock them and their makers start no run. */
  heldBack: ReadonlySet<StuffKey>;
  heldUntil: number;
  /** The tick the line's chunk last loaded: 0, then `restartAt` in `restart` (rule 3a). */
  loadedAt: number;
  /** The line's fluid pools (rule 7a). */
  readonly fluids: FluidPools;
  /** The run's options (ruling R-12). */
  readonly opts: { ticks: number; restartAt: number; ae2Coprocessors: number; ae2FluidStock: boolean; slowTolerance: number };
  /**
   * Where a steam machine's outputs go when the player takes them out by hand: the AE2 model sets it in AE2 mode (Task 9
   * rule 1, E17: `steam_items`), and a steam machine then hands each run's outputs to it as the run ends, in place of its
   * output slots. Null in every other mode.
   */
  byHand: ((node: NodeId, key: number, n: number, by: SimEntity | null) => void) | null;
}

/** The timer a GT tile sees at tick `t`: its age since its chunk loaded, plus 1 (E1, rule 3a). */
export function aTick(env: SimEnv, t: number): number {
  return t - env.loadedAt + 1;
}

/** Results within this of a whole number count as that number: chances summed in floating point (0.1 ten times) stay exact. */
const EPSILON = 1e-9;

/** A recipe compiled to key ids, as the machine models run it (the basic machine here, the multiblock controller in multi.ts). */
export interface CompiledRecipe {
  stepId: string; ticks: number;
  need: Array<{ key: number; amount: number }>;              // what must be in the input slots to start: consumed amounts plus one per held item, per key
  inputs: Array<{ key: number; amount: number; chance: number }>;
  outputs: Array<{ key: number; amount: number; chance: number }>;
  outputKeys: StuffKey[];
  fluidsIn: Array<{ key: number; amount: number }>; fluidsOut: Array<{ key: number; amount: number }>;
}

/** Recipe `r` with its keys as `keys` ids; `need` sums each key's consumed amounts and one per held item, in key order. */
export function compileRecipe(r: SimRecipe, keys: KeyTable): CompiledRecipe {
  const need = new Map<number, number>();
  for (const i of r.inputs) need.set(keys.id(i.key), (need.get(keys.id(i.key)) ?? 0) + i.amount);
  for (const h of r.held) need.set(keys.id(h), (need.get(keys.id(h)) ?? 0) + 1);
  return {
    stepId: r.stepId, ticks: Math.max(1, r.ticks),
    need: [...need].sort((a, b) => a[0] - b[0]).map(([key, amount]) => ({ key, amount })),
    inputs: r.inputs.map((i) => ({ key: keys.id(i.key), amount: i.amount, chance: i.chance })),
    outputs: r.outputs.map((o) => ({ key: keys.id(o.key), amount: o.amount, chance: o.chance })),
    outputKeys: r.outputs.map((o) => o.key),
    fluidsIn: r.fluidsIn.map((f) => ({ key: keys.id(f.key), amount: f.amount })),
    fluidsOut: r.fluidsOut.map((f) => ({ key: keys.id(f.key), amount: f.amount })),
  };
}

/**
 * A deterministic accumulator per machine and item (Review Focus 5): adds `x` (an amount times its chance) to `acc`'s total
 * for `key` and returns `⌊total⌋ − ⌊total before⌋`, so nothing fractional ever enters a slot.
 */
export function rollShare(acc: Map<number, number>, key: number, x: number): number {
  const before = acc.get(key) ?? 0;
  const total = before + x;
  acc.set(key, total);
  return Math.floor(total + EPSILON) - Math.floor(before + EPSILON);
}

/** GT's basic machine (rules 5–8), an inventory and an entity of the tile phase. */
export class BasicMachine implements SimInv, SimEntity, Preloadable, FluidWaiter {
  readonly id: string;
  readonly label: string;
  readonly phase = PHASE.tile;
  readonly order: number;
  readonly node: BasicNode;
  private readonly env: SimEnv;
  private readonly slots: Array<Stack | null>;
  private readonly every: number[];
  private readonly outputSlots: number[];
  private readonly inSlots: number;
  private readonly outSlots: number;
  private readonly multiOn: boolean;
  private readonly filterOn: boolean;
  private readonly fromOutputSide: boolean;
  private readonly autoOutput: boolean;
  private readonly circuits: boolean;
  private readonly gates: ReturnType<typeof coverGates>;
  private readonly covers: CoverTicks;
  private readonly recipes: CompiledRecipe[];
  private readonly rolled: number[];
  private readonly made = new Map<number, number>();         // chanced outputs rolled so far, by key
  private readonly used = new Map<number, number>();         // chanced inputs used up so far, by key
  /** Every change to its slots, its runs' own included (`SimInv.changes`). */
  changes = 0;
  private changed = false;
  private cached = -1;
  private running = -1;
  private endAt = 0;
  private outputBlocked = 0;
  private heldWait = false;
  private autoInto: PushTarget | undefined;

  constructor(node: BasicNode, env: SimEnv) {
    this.node = node;
    this.env = env;
    this.id = node.id;
    this.label = node.label;
    this.order = nodeOrder(env.model, node.id);
    this.inSlots = Math.max(0, node.inSlots);
    this.outSlots = Math.max(0, node.outSlots);
    this.slots = Array.from({ length: this.inSlots + this.outSlots }, () => null);
    this.every = this.slots.map((_, i) => i);
    this.outputSlots = this.every.slice(this.inSlots);
    this.multiOn = node.settings.multiStack === true || (node.settings.multiStack === null && env.scenario === 'multistack_on');
    this.filterOn = node.settings.inputFilter === true;
    this.fromOutputSide = node.settings.inputFromOutputSide !== false;
    this.autoOutput = node.settings.autoOutput === true && !node.steam;
    this.circuits = node.maps.some((m) => m === 'gt.recipe.assembler' || m === 'gt.recipe.circuitassembler');
    const covers = node.steam ? [] : env.model.covers.filter((c) => c.host === node.id);
    this.gates = coverGates(covers);
    this.covers = coverTicks(this, covers, env);
    this.recipes = node.recipes.map((r) => compileRecipe(r, env.keys));
    this.rolled = Array.from({ length: Math.max(0, ...this.recipes.map((r) => r.outputs.length)) }, () => 0);
    env.stats.register(node.id);
    // held items stand in input slots 0, 1, … at tick 0, one each (rule 6)
    const held = [...new Set(node.recipes.flatMap((r) => r.held))].slice(0, this.inSlots);
    held.forEach((key, slot) => this.preload(slot, env.keys.id(key), 1));
  }

  // ---- The inventory ----

  slotCount(): number {
    return this.slots.length;
  }

  stack(slot: number): Readonly<Stack> | null {
    return this.slots[slot] ?? null;
  }

  sideSlots(): readonly number[] {
    return this.every;
  }

  stackLimit(key: number): number {
    return this.env.keys.limit(key);
  }

  canInsert(slot: number, key: number, side: number): boolean {
    if (side === this.node.front || slot < 0 || slot >= this.inSlots) return false;
    if (side === this.node.outputSide && !this.fromOutputSide) return false;
    if (!this.gates.lets(side, 'in')) return false;
    return this.slotTakes(slot, key);
  }

  /** GT's slot test without the side: empty or the same item below its limit, Multi Stack Input, the Input Filter (E2). */
  private slotTakes(slot: number, key: number): boolean {
    const s = this.slots[slot] ?? null;
    if (s !== null && (s.key !== key || s.count >= this.stackLimit(key))) return false;
    if (!this.multiOn) {
      for (let i = 0; i < this.inSlots; i++) if (this.slots[i]?.key === key) return i === slot;
    }
    return !this.filterOn || this.filterTakes(slot, key);
  }

  /** The Input Filter (E2): one slot, the map must take the item; two, both full, both empty and the map takes it, or a recipe uses both stacks; three or more, the map takes it (or a circuit, on an assembler). */
  private filterTakes(slot: number, key: number): boolean {
    const { model, keys } = this.env;
    const k = keys.key(key);
    const takes = (): boolean => this.node.maps.some((m) => model.mapTakes(m, k));
    if (this.inSlots === 1) return takes();
    if (this.inSlots === 2) {
      const a = this.slots[0] ?? null, b = this.slots[1] ?? null;
      if (a !== null && b !== null) return true;
      if (a === null && b === null) return takes();
      const other = keys.key((slot === 0 ? b ?? a : a ?? b)!.key);
      return this.node.maps.some((m) => model.mapPair(m, other, k));
    }
    return takes() || (this.circuits && model.circuitOre(k));
  }

  canExtract(slot: number, _key: number, side: number): boolean {
    return side !== this.node.front && slot >= this.inSlots && slot < this.slots.length && this.gates.lets(side, 'out');
  }

  insert(slot: number, key: number, n: number, by: SimEntity | null): number {
    const s = this.slots[slot];
    if (s === undefined || n <= 0) return 0;
    const limit = this.stackLimit(key);
    const room = s === null ? limit : s.key === key ? limit - s.count : 0;
    const m = Math.min(n, room);
    if (m <= 0) return 0;
    if (s === null) {
      this.slots[slot] = { key, count: m };
      if (slot < this.inSlots) this.env.stats.occupancy(this.id, key, this.inputSlotsOf(key), this.env.sim.t);
    } else s.count += m;
    this.changes++;
    this.markChanged(by);
    return m;
  }

  extract(slot: number, n: number, by: SimEntity | null): number {
    const s = this.slots[slot];
    if (s === undefined || s === null || n <= 0) return 0;
    const m = Math.min(n, s.count);
    const key = s.key;
    s.count -= m;
    if (s.count <= 0) this.slots[slot] = null;
    this.changes++;
    if (slot >= this.inSlots) this.env.stats.extracted(this.id, key, m, this.env.sim.t);
    this.markChanged(by);
    return m;
  }

  countAll(key: number): number {
    let n = 0;
    for (const s of this.slots) if (s !== null && s.key === key) n += s.count;
    return n;
  }

  /**
   * Only the input slots count (`MTEBasicMachine.isIOSlot`, ruling R-16), and an item AE2's blocking mode ignores does not
   * (`model.ignoredByBlocking`: the pack's list, GT's lenses among them).
   */
  countsAsEmpty(): boolean {
    for (let i = 0; i < this.inSlots; i++) {
      const s = this.slots[i];
      if (s !== null && s !== undefined && !this.env.model.ignoredByBlocking(this.env.keys.key(s.key))) return false;
    }
    return true;
  }

  preload(slot: number, key: number, count: number): void {
    if (slot < 0 || slot >= this.slots.length || !Number.isInteger(slot)) throw new RangeError(`${this.label} has no slot ${slot}`);
    this.slots[slot] = count > 0 ? { key, count: Math.min(count, this.stackLimit(key)) } : null;
    this.changes++;
    if (count > 0 && slot < this.inSlots) this.env.stats.occupancy(this.id, key, this.inputSlotsOf(key), 0);
  }

  fluidArrived(by: SimEntity | null): void {
    this.markChanged(by);
  }

  /** A change: GT's `hasInventoryBeenModified`, which the machine sees at its next turn (rule 2). */
  private markChanged(by: SimEntity | null): void {
    this.changed = true;
    this.env.sim.wake(this, by);
  }

  private inputSlotsOf(key: number): number {
    let n = 0;
    for (let i = 0; i < this.inSlots; i++) if (this.slots[i]?.key === key) n++;
    return n;
  }

  private inputTotal(key: number): number {
    let n = 0;
    for (let i = 0; i < this.inSlots; i++) {
      const s = this.slots[i];
      if (s !== null && s !== undefined && s.key === key) n += s.count;
    }
    return n;
  }

  // ---- The tick ----

  tick(t: number): number {
    const env = this.env;
    this.covers(t);
    const timer = aTick(env, t);
    // (a) a run in progress counts the tick; on its last one its outputs go into the output slots
    let ended = false;
    if (this.running >= 0 && t >= this.endAt) {
      this.finish();
      ended = true;
    }
    // (b) auto-output and (c) the blocked-output counter (only auto-output reads it)
    if (this.autoOutput) {
      const side = this.node.outputSide;
      if (side >= 0 && side <= 5 && side !== this.node.front && !this.outputsEmpty()
        && (ended || this.outputBlocked % 300 === 1 || this.changed || timer % 600 === 0)) {
        this.autoInto ??= pushTargetOf(env, this.id, env.push(this.id, side));
        gtTransfer(this, this.outputSlots, side, this.autoInto, OPPOSITE[side]!, this.outSlots, 64, this);
      }
      if (this.outputBlocked !== 0) this.outputBlocked = this.outputsEmpty() ? 0 : this.outputBlocked + 1;
    }
    // (d) idle, it looks for a recipe
    const heldOver = this.heldWait && t >= env.heldUntil;
    if (this.running < 0 && (ended || this.changed || timer % 600 === 0 || heldOver)) this.check(t);
    this.changed = false;
    return this.nextTick(t);
  }

  /** The next tick it must run (rule 8, ruling R-11): its run's last tick or its next 600-tick check, its covers' next act, the end of a hold. */
  private nextTick(t: number): number {
    if (this.autoOutput) return t + 1;
    const env = this.env;
    let next: number;
    if (this.running >= 0) next = this.endAt;
    else {
      const age = t - env.loadedAt + 1;                       // aTick at t
      next = env.loadedAt - 1 + (Math.floor(age / 600) + 1) * 600;
      if (this.heldWait && env.heldUntil > t) next = Math.min(next, env.heldUntil);
    }
    return Math.min(next, this.covers.next(t));
  }

  private outputsEmpty(): boolean {
    for (const slot of this.outputSlots) if (this.slots[slot] !== null) return false;
    return true;
  }

  /** Whether recipe `r`'s inputs, held items and fluids are there. */
  private ready(r: CompiledRecipe): boolean {
    for (const need of r.need) if (this.inputTotal(need.key) < need.amount) return false;
    for (const f of r.fluidsIn) if (!this.env.fluids.has(f.key, f.amount)) return false;
    return true;
  }

  /** The item in the first output slot that blocks recipe `r`'s outputs (`canOutput`, E1: chance ignored), or −1. */
  private blocking(r: CompiledRecipe): number {
    for (let i = 0; i < r.outputs.length && i < this.outSlots; i++) {
      const s = this.slots[this.inSlots + i];
      const o = r.outputs[i]!;
      if (s !== null && s !== undefined && (s.key !== o.key || s.count + o.amount > this.stackLimit(o.key))) return s.key;
    }
    return -1;
  }

  private check(t: number): void {
    const env = this.env;
    this.heldWait = false;
    let found = this.cached >= 0 && this.ready(this.recipes[this.cached]!) ? this.cached : -1;
    if (found < 0) found = this.recipes.findIndex((r) => this.ready(r));
    if (found < 0) {
      const r = this.cached >= 0 ? this.cached : 0;
      const recipe = this.recipes[r];
      if (recipe === undefined) return;
      const missing = this.missing(recipe);
      env.stats.waiting(this.id, r, missing, this.crowd(missing), t);
      for (const f of recipe.fluidsIn) if (!env.fluids.has(f.key, f.amount)) env.fluids.wait(f.key, this);
      return;
    }
    this.cached = found;
    const recipe = this.recipes[found]!;
    const block = this.blocking(recipe);
    if (block >= 0) {
      if (this.autoOutput) this.outputBlocked++;
      const ready = this.recipes.flatMap((r, i) => (i !== found && this.ready(r) ? [i] : []));
      env.stats.blocked(this.id, found, t, block, ready);
      return;
    }
    if (env.heldBack.size > 0 && t < env.heldUntil && recipe.outputKeys.some((k) => env.heldBack.has(k))) {
      // its step makes an item held back: no run before the hold ends (Task 11's late_input)
      this.heldWait = true;
      env.stats.waiting(this.id, found, [], null, t);
      return;
    }
    this.start(found, t);
  }

  /** Recipe `r`'s missing keys, in key order: items short in the input slots (held ones too) and pooled fluids short in their pool. */
  private missing(r: CompiledRecipe): number[] {
    const out: number[] = [];
    for (const need of r.need) if (this.inputTotal(need.key) < need.amount) out.push(need.key);
    for (const f of r.fluidsIn) if (!this.env.fluids.has(f.key, f.amount) && !out.includes(f.key)) out.push(f.key);
    return out.sort((a, b) => a - b);
  }

  /**
   * The first missing item (key order) that no input slot takes, and the kind that fills the most input slots (ties: the
   * lowest slot), or null (rule 6d). Slots are tested without the side: what keeps it out is what fills the slots.
   */
  private crowd(missing: readonly number[]): Crowd | null {
    const keys = this.env.keys;
    const out = missing.find((k) => !keys.isFluid(k) && !this.someInputTakes(k));
    if (out === undefined) return null;
    let by = -1, most = 0;
    for (let i = 0; i < this.inSlots; i++) {
      const s = this.slots[i];
      if (s === null || s === undefined) continue;
      const n = this.inputSlotsOf(s.key);
      if (n > most) {
        most = n;
        by = s.key;
      }
    }
    return by < 0 ? null : { key: out, by, slots: most, of: this.inSlots };
  }

  private someInputTakes(key: number): boolean {
    for (let slot = 0; slot < this.inSlots; slot++) if (this.slotTakes(slot, key)) return true;
    return false;
  }

  private start(r: number, t: number): void {
    const env = this.env;
    const recipe = this.recipes[r]!;
    this.changes++;
    // inputs, each from the input slots in slot order, lowest first (GTRecipe.consumeInput)
    for (const input of recipe.inputs) {
      let n = input.chance >= 1 ? input.amount : rollShare(this.used, input.key, input.amount * input.chance);
      for (let i = 0; i < this.inSlots && n > 0; i++) {
        const s = this.slots[i];
        if (s === null || s === undefined || s.key !== input.key) continue;
        const m = Math.min(n, s.count);
        s.count -= m;
        n -= m;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    for (const f of recipe.fluidsIn) env.fluids.take(f.key, f.amount);
    recipe.outputs.forEach((o, i) => { this.rolled[i] = o.chance >= 1 ? o.amount : rollShare(this.made, o.key, o.amount * o.chance); });
    const fast = env.fastSteps.has(recipe.stepId);
    this.running = r;
    this.endAt = t + (fast ? Math.max(1, Math.ceil(recipe.ticks / FAST_FACTOR)) : recipe.ticks);
    env.stats.started(this.id, r, t);
  }

  /**
   * The run's last tick: output i into output slot i, i + 1, … (mod the output slots), the first empty one or one holding it with
   * room for all of it; a steam machine whose outputs the player takes out by hand (`env.byHand`) hands them over instead.
   */
  private finish(): void {
    const recipe = this.recipes[this.running]!;
    const byHand = this.node.steam ? this.env.byHand : null;
    this.changes++;
    recipe.outputs.forEach((o, i) => {
      const amount = this.rolled[i] ?? 0;
      if (amount <= 0 || i >= this.outSlots) return;
      if (byHand !== null) {
        byHand(this.id, o.key, amount, this);
        return;
      }
      const limit = this.stackLimit(o.key);
      for (let j = 0; j < this.outSlots; j++) {
        const slot = this.inSlots + ((i + j) % this.outSlots);
        const s = this.slots[slot] ?? null;
        if (s === null) {
          this.slots[slot] = { key: o.key, count: Math.min(amount, limit) };
          return;
        }
        if (s.key === o.key && s.count + amount <= limit) {
          s.count += amount;
          return;
        }
      }
    });
    for (const f of recipe.fluidsOut) this.env.fluids.add(f.key, f.amount, this);
    this.running = -1;
  }
}

/** The GT basic machine of node `node` in this run. */
export function basicMachine(node: BasicNode, env: SimEnv): BasicMachine {
  return new BasicMachine(node, env);
}
