// The line's chests in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 4
// rule 9; ruling R-21): vanilla chests of 27 slots, which take anything on any side by the inserter's own rule and let
// anything out, and count everything that arrives.
// - An input chest holds a full stack of each item it stocks in its first slots (key order; only the first 27), refilled
//   at once after each extraction: the hookup or the player keeps it stocked. In `late_input` the slots of the items held
//   back stay empty until the hold ends. Its other slots start empty and keep what is pushed into them.
// - An output chest starts empty. An item the plan sends out of the line leaves it as soon as it arrives (the player or a
//   hookup takes the line's products: plan open question 15); anything else stays, so it fills only with items the plan
//   did not send there, and then refuses what has no room.
// Pure TypeScript: nothing from node:* may be imported here.

import { CHEST_SLOTS } from '../facts.ts';
import type { ChestNode } from '../model.ts';
import { NEVER, nodeOrder, PHASE, type Preloadable, type SimEntity, type SimInv, type Stack } from './core.ts';
import type { SimEnv } from './machine.ts';

const ALL_SLOTS: readonly number[] = Array.from({ length: CHEST_SLOTS }, (_, i) => i);

/** A vanilla chest: 27 slots, any item on any side, every arrival counted. */
abstract class Chest implements SimInv, SimEntity, Preloadable {
  readonly id: string;
  readonly label: string;
  readonly phase = PHASE.tile;
  readonly order: number;
  protected readonly env: SimEnv;
  protected readonly slots: Array<Stack | null> = ALL_SLOTS.map(() => null);

  constructor(node: ChestNode, env: SimEnv) {
    this.id = node.id;
    this.label = node.label;
    this.env = env;
    this.order = nodeOrder(env.model, node.id);
    env.stats.register(node.id);
  }

  slotCount(): number {
    return CHEST_SLOTS;
  }

  stack(slot: number): Readonly<Stack> | null {
    return this.slots[slot] ?? null;
  }

  sideSlots(): readonly number[] {
    return ALL_SLOTS;
  }

  stackLimit(key: number): number {
    return this.env.keys.limit(key);
  }

  canInsert(slot: number, key: number): boolean {
    const s = this.stack(slot);
    return slot >= 0 && slot < CHEST_SLOTS && (s === null || (s.key === key && s.count < this.stackLimit(key)));
  }

  canExtract(): boolean {
    return true;
  }

  /** Puts up to the room in `slot`; what arrives is counted. */
  insert(slot: number, key: number, n: number): number {
    if (n <= 0 || !this.canInsert(slot, key)) return 0;
    const s = this.slots[slot] ?? null;
    const m = Math.min(n, s === null ? this.stackLimit(key) : this.stackLimit(key) - s.count);
    this.env.stats.arrived(this.id, key, m, this.env.sim.t);
    if (this.keeps(key)) {
      if (s === null) this.slots[slot] = { key, count: m };
      else s.count += m;
    }
    return m;
  }

  extract(slot: number, n: number): number {
    const s = this.slots[slot] ?? null;
    if (s === null || n <= 0) return 0;
    const m = Math.min(n, s.count);
    s.count -= m;
    if (s.count <= 0) this.slots[slot] = null;
    return m;
  }

  countAll(key: number): number {
    let n = 0;
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const s = this.stack(i);
      if (s !== null && s.key === key) n += s.count;
    }
    return n;
  }

  countsAsEmpty(): boolean {
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const s = this.stack(i);
      if (s !== null && !this.env.model.ignoredByBlocking(this.env.keys.key(s.key))) return false;
    }
    return true;
  }

  preload(slot: number, key: number, count: number): void {
    if (slot < 0 || slot >= CHEST_SLOTS || !Number.isInteger(slot)) throw new RangeError(`${this.label} has no slot ${slot}`);
    this.slots[slot] = count > 0 ? { key, count: Math.min(count, this.stackLimit(key)) } : null;
  }

  /** Whether an arrival of `key` stays in the chest. */
  protected keeps(key: number): boolean {
    void key;
    return true;
  }

  /** A chest does nothing on its own: what it does happens as it is used. */
  tick(): number {
    return NEVER;
  }
}

/** An input chest: its stocked items in its first slots, each kept full; the rest of its slots keep what comes. */
class InputChest extends Chest {
  private readonly stocked: Stack[];
  private readonly stockedKeys: string[];

  constructor(node: ChestNode, env: SimEnv) {
    super(node, env);
    this.stockedKeys = node.keys.slice(0, CHEST_SLOTS);
    this.stocked = this.stockedKeys.map((k) => {
      const key = env.keys.id(k);
      return { key, count: env.keys.limit(key) };
    });
  }

  /** A stocked slot holds its full stack, or nothing while its item is held back (`late_input`: `env.heldBack` until `env.heldUntil`). */
  override stack(slot: number): Readonly<Stack> | null {
    const stocked = this.stocked[slot];
    if (stocked === undefined) return super.stack(slot);
    const { heldBack, heldUntil, sim } = this.env;
    return heldBack.size > 0 && sim.t < heldUntil && heldBack.has(this.stockedKeys[slot]!) ? null : stocked;
  }

  /** Nothing goes into a stocked slot: the hookup keeps it. */
  override canInsert(slot: number, key: number): boolean {
    return slot >= this.stocked.length && super.canInsert(slot, key);
  }

  /** A stocked slot is refilled at once. */
  override extract(slot: number, n: number): number {
    const stocked = this.stack(slot);
    if (slot < this.stocked.length) return stocked === null || n <= 0 ? 0 : Math.min(n, stocked.count);
    return super.extract(slot, n);
  }

  override preload(slot: number, key: number, count: number): void {
    if (slot < this.stocked.length) throw new RangeError(`${this.label}'s slot ${slot} is stocked`);
    super.preload(slot, key, count);
  }
}

/** An output chest: the line's products leave it as they arrive, anything else stays. */
class OutputChest extends Chest {
  private readonly sinks: ReadonlySet<number>;

  constructor(node: ChestNode, env: SimEnv) {
    super(node, env);
    this.sinks = new Set(env.model.sinks.map((k) => env.keys.id(k)));
  }

  protected override keeps(key: number): boolean {
    return !this.sinks.has(key);
  }
}

/** The input chest of node `node`: it stocks `node.keys`. */
export function inputChest(node: ChestNode, env: SimEnv): SimInv & SimEntity & Preloadable {
  return new InputChest(node, env);
}

/** The output chest of node `node`. */
export function outputChest(node: ChestNode, env: SimEnv): SimInv & SimEntity & Preloadable {
  return new OutputChest(node, env);
}
