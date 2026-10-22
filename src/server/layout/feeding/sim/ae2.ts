// AE2 in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 9; E8, E14, E16, E17;
// research §2.3, §3.4, §3.5, §4.2): ME storage, one crafting job and the CPU that runs it, the ME interfaces with their send
// lists, blocking modes, Locking Cards and Fluid Packets, and the ME Export Buses, as AE2 rv3-beta-1073-GTNH does them.
// - Storage. ME holds every supply item without limit (in `late_input` a held-back one only once the hold ends) and, with
//   `ae2FluidStock`, every fluid a pattern lists. What goes into an interface (a machine's cover or output bus, a bench's
//   back) enters ME at once: the CPU's store as far as the job waits for it, else storage; and every such injection counts
//   down the list of every locked interface that lists it. In AE2 mode a steam machine's outputs, which the player takes out
//   by hand (E17), are injected the same way as each of its runs ends.
// - Patterns. Only a pattern of whole amounts that lists nothing its machine keeps (a held item, a programmed circuit) can be
//   encoded; the others are left out (Review Focus 5). Equal patterns on several interfaces are one task with all of them.
// - The job, planned at tick 0: twice the run's worth of each item the plan sends out of the line. A supply item or a stocked
//   fluid comes from storage; else the first encodable pattern (interface order) that makes it is crafted as often as needed,
//   its inputs needed in turn; else, when a laid step that an ME Export Bus feeds makes it, the job counts on what that step
//   makes; else the job cannot be planned and nothing is pushed for the whole run. Tasks of raw-fed steps come first
//   (`stepDepths`), then interface order.
// - The CPU (phase `grid`), each tick: at most `c + 1 − (its pushes of its last three updates)` pushes. It walks the tasks with
//   crafts left whose inputs are in its store and each task's interfaces in order, skipping a busy one (its send list holds
//   something, it is locked, or blocking mode finds none of its targets empty). A push takes the inputs out of the store and
//   makes the job wait for the pattern's items (its fluids never come back: the line pipes them). A blocking interface then
//   gives the turn to the next; a non-blocking one is pushed again while crafts and pushes last.
// - A push goes into the interface's targets in order (with blocking mode only an empty one, but any after the same pattern
//   with smart blocking), every stack into each, what is left on to the next; a fluid becomes one Fluid Packet item, which a
//   Dual Interface puts into the machine's tank instead. Nothing taken anywhere: no push. Else the rest waits in the send
//   list, which the interface tries the next tick and then at its adaptive rate: 62 ticks at first, 5 after a try that moved
//   something, one more after each that did not, at most 120. A Locking Card locks the interface until every output of the
//   pattern, container returns and fluids alike, has entered ME.
// - An ME Export Bus (phase `tile`) moves up to its amount an operation, shared over its items in order, from storage into its
//   target: first 32 ticks after the line starts, then 2 ticks sooner after an operation that moved something and 1 later
//   after one that did not, between 5 and 60.
// - A restart resets nothing: the job, the send lists, the locks and their lists are saved.
// Pure TypeScript: nothing from node:* may be imported here.

import { isFluidKey, type StuffKey } from '../../../../shared/keys.ts';
import { TICKS_PER_SECOND, type FeedUnknown, type PatternSpec } from '../contract.ts';
import { AE2, PART_KEYS } from '../facts.ts';
import { compareLocal, localOf } from '../frame.ts';
import type { Ae2Iface, Ae2Net, BasicNode, FeedModel, FeedNode, NodeId } from '../model.ts';
import { amountText } from '../text.ts';
import { insertEmpties, NEVER, PHASE, type PushTarget, type SimEntity, type SimInv } from './core.ts';
import type { Explain } from './detect.ts';
import type { SimEnv } from './machine.ts';
import type { NetworkModel } from './run.ts';

/** Whether `n` is a whole number, to a billionth (as the static rule R8 tells one). */
function isWhole(n: number): boolean {
  return Math.abs(n - Math.round(n)) <= 1e-9;
}

/** An item key's id: the text before its last '@' (a key is `id@meta`, or `id@meta#hash`). */
function idOf(key: StuffKey): string {
  const at = key.lastIndexOf('@');
  return at < 1 ? key : key.slice(0, at);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The rank of the AE2 part `id` (an interface or an ME Export Bus) among every AE2 part of the line, by local cell: its entity's `order`. */
function partRank(model: FeedModel, id: NodeId): number {
  const at = localOf(id);
  let rank = 0;
  for (const net of model.networks) {
    if (net.kind !== 'ae2') continue;
    for (const p of net.interfaces) if (compareLocal(localOf(p.id), at) < 0) rank++;
    for (const p of net.exportBuses) if (compareLocal(localOf(p.id), at) < 0) rank++;
  }
  return rank;
}

/** Amounts by key id, each key once. */
type Amounts = Map<number, number>;

/**
 * A stack a push hands over, or that waits in a send list: an item (`fluid` −1), a fluid as one Fluid Packet item (`key` the
 * packet, `fluid` the fluid), or a fluid a Dual Interface puts into the machine's tank (`tank`, `key` the fluid).
 */
interface Parcel { readonly key: number; n: number; readonly fluid: number; readonly tank: boolean }

/** One of an interface's targets: its inventory and its own side toward the interface, its node, and what a Fluid Packet does there. */
interface Target {
  readonly inv: SimInv; readonly side: number; readonly node: FeedNode;
  /** Not a chest: a machine, a multiblock's bus or a bench, which a Dual Interface's fluid goes into. */
  readonly machine: boolean;
  /** A Fluid Packet that goes in stays in an input slot for good: a basic machine's, a multiblock's input bus's (a bench throws it out). */
  readonly keepsPackets: boolean;
}

/** An ME interface as the run pushes into it and through it. */
interface Iface {
  readonly spec: Ae2Iface;
  readonly targets: readonly Target[];
  /** Its first target that is a machine: whom its Fluid Packets are for. */
  readonly machine: Target | null;
  /** What its patterns are for, in texts: that machine, else the interface itself. */
  readonly maker: string;
  readonly dual: boolean;
  /** What waits to go out, in the order it was left. */
  readonly sendList: Parcel[];
  /** Its Locking Card's lock, and the outputs it waits for (by key, what is still to come) and how many of them are not down to 0. */
  locked: boolean; readonly lockList: Amounts; lockLeft: number;
  /** The task it was pushed last (smart blocking). */
  lastTask: Task | null;
  /** Its adaptive tick rate and the tick it next tries its send list. */
  rate: number; nextTry: number;
  entity: SimEntity;
}

/** An encodable pattern the job crafts, with every interface that holds it, in interface order. */
interface Task {
  /** Its inputs and every output, by key (items and fluids), and its item outputs: what the job waits for after a push. */
  readonly need: Amounts; readonly made: Amounts; readonly items: Amounts;
  /** Its stacks as a plain interface pushes them (a fluid as a Fluid Packet) and as a Dual Interface does (a fluid into the tank). */
  readonly packets: readonly Parcel[]; readonly tanks: readonly Parcel[];
  readonly ifaces: Iface[];
  /** `stepDepths` of its step, and its first interface's place (then its pattern's): the job's order. */
  readonly depth: number; readonly order: number;
  /** Its first interface's machine, in texts. */
  readonly maker: string;
  /** The crafts the job plans, and those not pushed yet. */
  crafts: number; left: number;
}

/**
 * The model of the AE2 network `net` in this run (`NETWORK_MODELS.ae2`): the crafting CPU (phase `grid`), an entity of the tile
 * phase per interface (its send list) and per ME Export Bus, a push target on every side of each interface (what is pushed into
 * it enters ME), the network's reasons why an item does not reach a machine, what it left unknown and what entered ME.
 */
export function ae2Model(net: Ae2Net, env: SimEnv): NetworkModel {
  const { keys, stats, sim, model } = env;
  const byId = new Map<NodeId, FeedNode>(model.nodes.map((n) => [n.id, n]));
  const nameOf = (k: number): string => model.nameOf(keys.key(k));
  const packet = (): number => keys.id(PART_KEYS.fluidPacket);

  // ---- Rule 1: storage, the CPU's store and what the job waits for, by key id ----
  const storage = new Float64Array(keys.size);
  const store = new Float64Array(keys.size);
  const waiting = new Float64Array(keys.size);
  const entered = new Float64Array(keys.size);
  const supply = new Set(model.supply.map((k) => keys.id(k)));
  const patternFluids = new Set<number>();
  for (const i of net.interfaces) {
    for (const p of i.spec.patterns) for (const e of [...p.inputs, ...p.outputs]) if (isFluidKey(e.key)) patternFluids.add(keys.id(e.key));
  }
  /** What ME holds without limit at tick `t`: a supply item (a held-back one only once the hold ends) and, with `ae2FluidStock`, a pattern's fluid. */
  const inStock = (k: number, t: number): boolean => {
    if (supply.has(k)) return !(env.heldBack.size > 0 && t < env.heldUntil && env.heldBack.has(keys.key(k)));
    return env.opts.ae2FluidStock && patternFluids.has(k);
  };
  /** What the job plans with from storage: a supply item, held back or not, or a stocked fluid. */
  const stocked = (k: number): boolean => supply.has(k) || (env.opts.ae2FluidStock && patternFluids.has(k));

  // ---- The interfaces ----
  const ifaces: Iface[] = net.interfaces.map((spec): Iface => {
    const targets: Target[] = [];
    for (const ref of spec.targets) {
      const inv = env.inv(ref.bus ?? ref.node);
      const node = byId.get(ref.node);
      if (inv === null || node === undefined) continue;
      const keepsPackets = node.kind === 'basic' || (node.kind === 'multi' && node.inBuses.some((b) => b.id === ref.bus));
      targets.push({ inv, side: ref.side, node, machine: node.kind !== 'chest', keepsPackets });
    }
    const machine = targets.find((x) => x.machine) ?? null;
    const f: Iface = {
      spec, targets, machine, maker: machine?.node.label ?? spec.label, dual: spec.spec.dual === true, sendList: [],
      locked: false, lockList: new Map(), lockLeft: 0, lastTask: null,
      rate: Math.floor((AE2.ifaceMinTicks + AE2.ifaceMaxTicks) / 2), nextTry: NEVER,
      entity: {
        phase: PHASE.tile, order: partRank(model, spec.id),
        // rule 6: it tries its send list when it is due, and then is due at its adaptive rate while the list holds something
        tick(t: number): number {
          if (f.sendList.length > 0 && t >= f.nextTry) {
            const moved = trySendList(f, t);
            f.rate = moved ? AE2.ifaceMinTicks : Math.min(AE2.ifaceMaxTicks, f.rate + 1);
            f.nextTry = t + f.rate;
          }
          return f.sendList.length > 0 ? f.nextTry : NEVER;
        },
      },
    };
    return f;
  });

  // ---- Rule 2: the encodable patterns, as tasks ----

  /** Why the copy of pattern `p` on interface `f` cannot be encoded, in R8's words after "the pattern for …" (null: it can). */
  const unencodable = (f: Iface, p: PatternSpec): string | null => {
    const held = new Set<StuffKey>();
    for (const { node } of f.targets) if (node.kind !== 'chest') for (const r of node.recipes) for (const h of r.held) held.add(h);
    for (const [side, list] of [['in', p.inputs], ['out', p.outputs]] as const) {
      for (const { key, amount } of list) {
        const name = model.nameOf(key);
        if (!isWhole(amount)) return `holds ${amountText(amount)}× ${name}: a pattern holds whole items`;
        if (side === 'in' && !isFluidKey(key) && (held.has(key) || idOf(key) === PART_KEYS.circuitId)) return `lists ${name}, which ${f.maker} keeps and does not use up`;
      }
    }
    return null;
  };
  const condense = (list: PatternSpec['inputs']): Amounts => {
    const out: Amounts = new Map();
    for (const { key, amount } of list) if (amount > 0) out.set(keys.id(key), (out.get(keys.id(key)) ?? 0) + amount);
    return out;
  };

  const tasks = new Map<string, Task>();
  /** The task of the first encodable pattern that makes each key (interface order, then pattern order), and why the first pattern that makes it cannot be encoded. */
  const makerOf = new Map<number, Task>();
  const unencodableFor = new Map<number, string>();
  let copies = 0;
  ifaces.forEach((f) => {
    f.spec.spec.patterns.forEach((raw, k) => {
      const order = copies++;
      const why = unencodable(f, raw);
      if (why !== null) {
        for (const o of raw.outputs) if (o.amount > 0 && !unencodableFor.has(keys.id(o.key))) unencodableFor.set(keys.id(o.key), `the pattern for ${f.maker} ${why}`);
        return;
      }
      const p: PatternSpec = {
        inputs: raw.inputs.map((e) => ({ key: e.key, amount: Math.round(e.amount) })).filter((e) => e.amount > 0),
        outputs: raw.outputs.map((e) => ({ key: e.key, amount: Math.round(e.amount) })).filter((e) => e.amount > 0),
      };
      const content = `${p.inputs.map((e) => `${e.key}*${e.amount}`).join(',')}>${p.outputs.map((e) => `${e.key}*${e.amount}`).join(',')}`;
      let task = tasks.get(content);
      if (task === undefined) {
        // its step: the k-th of its first interface's machine, as main writes one pattern per step
        const node = f.machine?.node;
        const stepId = node === undefined || node.kind === 'chest' ? undefined : node.stepIds[k] ?? node.stepIds[0];
        const made = condense(p.outputs);
        task = {
          need: condense(p.inputs), made, items: new Map([...made].filter(([key]) => !keys.isFluid(key))),
          packets: p.inputs.map((e): Parcel => (isFluidKey(e.key)
            ? { key: packet(), n: 1, fluid: keys.id(e.key), tank: false } : { key: keys.id(e.key), n: e.amount, fluid: -1, tank: false })),
          tanks: p.inputs.map((e): Parcel => (isFluidKey(e.key)
            ? { key: keys.id(e.key), n: e.amount, fluid: keys.id(e.key), tank: true } : { key: keys.id(e.key), n: e.amount, fluid: -1, tank: false })),
          ifaces: [], depth: stepId === undefined ? 0 : model.depths[stepId] ?? 0, order, maker: f.maker, crafts: 0, left: 0,
        };
        tasks.set(content, task);
      }
      if (!task.ifaces.includes(f)) task.ifaces.push(f);
      for (const key of task.made.keys()) if (!makerOf.has(key)) makerOf.set(key, task);
    });
  });

  // ---- Rule 3: the job ----

  // the items a laid step makes that an ME Export Bus feeds (research §3.5: the line relies on stock)
  const laid = new Set(model.laid);
  const countedOn = new Set<number>();
  for (const bus of net.exportBuses) {
    const node = bus.target === null || bus.keys.length === 0 ? undefined : byId.get(bus.target.node);
    if (node === undefined || node.kind === 'chest') continue;
    for (const r of node.recipes) if (laid.has(r.stepId)) for (const o of r.outputs) countedOn.add(keys.id(o.key));
  }
  /** Why the job cannot be planned (rule 9's words), or null. */
  let failed = null as string | null;
  const spare = new Map<number, number>();
  const making = new Set<number>();
  /** The job needs `n` of key `k`: from storage, from the crafts of the task that makes it (and what it makes over), from a step ME feeds, or the plan fails. */
  const need = (k: number, n: number): void => {
    if (failed !== null || n <= 0 || stocked(k)) return;
    const over = spare.get(k) ?? 0;
    if (over > 0) {
      const use = Math.min(over, n);
      spare.set(k, over - use);
      n -= use;
      if (n <= 0) return;
    }
    // a pattern that needs what it makes, in turn, cannot be crafted from nothing: AE2's plan leaves it out
    const task = making.has(k) ? undefined : makerOf.get(k);
    if (task !== undefined) {
      const out = task.made.get(k)!;
      const crafts = Math.ceil(n / out);
      task.crafts += crafts;
      spare.set(k, (spare.get(k) ?? 0) + crafts * out - n);
      making.add(k);
      for (const [input, amount] of task.need) need(input, crafts * amount);
      making.delete(k);
      return;
    }
    if (countedOn.has(k) && !keys.isFluid(k)) {
      waiting[k]! += n;
      return;
    }
    failed = unencodableFor.get(k) ?? `nothing makes ${nameOf(k)} and ME holds none`;
  };
  const rates = new Map<StuffKey, number>();
  for (const f of model.itemFlows) if (f.to === 'out') rates.set(f.key, (rates.get(f.key) ?? 0) + f.perSecond);
  for (const [key, rate] of [...rates].sort((a, b) => compareText(a[0], b[0]))) {
    need(keys.id(key), Math.ceil((rate * env.opts.ticks * 2) / TICKS_PER_SECOND - 1e-9));
  }
  const job: Task[] = failed !== null ? [] : [...tasks.values()].filter((t) => t.crafts > 0).sort((a, b) => a.depth - b.depth || a.order - b.order);
  if (failed !== null) waiting.fill(0);
  for (const task of job) task.left = task.crafts;

  // ---- Rule 1: what enters ME, and rule 5's Locking Cards ----

  /** `n` of key `k` enter ME at tick `t`: the CPU's store as far as the job waits for them, else storage; each locked interface that lists `k` counts it down. */
  const inject = (k: number, n: number, t: number): void => {
    if (n <= 0) return;
    entered[k]! += n;
    const toStore = Math.min(waiting[k]!, n);
    if (toStore > 0) {
      store[k]! += toStore;
      waiting[k]! -= toStore;
    }
    storage[k]! += n - toStore;
    for (const f of ifaces) {
      if (!f.locked) continue;
      const want = f.lockList.get(k);
      if (want === undefined || want <= 0) continue;
      const left = Math.max(0, want - n);
      f.lockList.set(k, left);
      if (left > 0) continue;
      f.lockLeft -= 1;
      if (f.lockLeft > 0) continue;
      f.locked = false;
      stats.ae2Unlock(f.spec.id, t);
    }
  };
  const into: PushTarget = { accept: (key, n) => { inject(key, n, sim.t); return n; } };

  // E17: in AE2 mode the player takes a steam machine's outputs out by hand, into ME as each of its runs ends
  const byHand = model.mode === 'ae2' && env.byHand === null;
  if (byHand) env.byHand = (_node, key, n) => inject(key, n, sim.t);

  // ---- Rule 5: a push; rule 6: the send list ----

  /** Records each Fluid Packet in `f`'s send list as waiting there at `t`, for the machine they are for. */
  const listed = (f: Iface, t: number): void => {
    if (f.machine === null) return;
    for (const p of f.sendList) if (p.fluid >= 0 && !p.tank) stats.packet(f.machine.node.id, f.spec.id, p.fluid, 'send_list', t);
  };

  /** `pushPattern`: `task`'s stacks into `f`'s targets at tick `t`; false when nothing went anywhere (then nothing is left in the send list either). */
  const pushPattern = (f: Iface, task: Task, t: number): boolean => {
    if (f.sendList.length > 0 || f.locked) return false;
    const { blocking, smartBlocking } = f.spec.spec;
    const parcels = f.dual ? task.tanks : task.packets;
    const left = parcels.map((p) => p.n);
    const slotted: Array<[NodeId, number]> = [];
    const tried: FeedNode[] = [];
    let took = false;
    for (const x of f.targets) {
      if (blocking && !(smartBlocking === true && f.lastTask === task) && !x.inv.countsAsEmpty()) continue;
      if (x.machine && !tried.includes(x.node)) tried.push(x.node);
      for (let i = 0; i < parcels.length; i++) {
        const p = parcels[i]!;
        if (left[i]! <= 0) continue;
        if (p.tank) {
          if (x.machine) {
            left[i] = 0;
            took = true;
          }
          continue;
        }
        const got = insertEmpties(x.inv, p.key, left[i]!, x.side, cpu);
        if (got <= 0) continue;
        stats.delivered(x.inv.id, p.key, got, t);
        left[i]! -= got;
        took = true;
        if (p.fluid >= 0 && x.keepsPackets) slotted.push([x.node.id, p.fluid]);
      }
    }
    if (!took) {
      // a pattern of Fluid Packets alone that no slot takes: the CPU tries again (E8: no send list)
      if (parcels.length > 0 && parcels.every((p) => p.fluid >= 0 && !p.tank)) {
        for (const node of tried) for (const p of parcels) stats.packet(node.id, f.spec.id, p.fluid, 'no_slot', t);
      }
      return false;
    }
    stats.ae2Push(f.spec.id, t);
    for (const [node, fluid] of slotted) stats.packet(node, f.spec.id, fluid, 'slot', t);
    parcels.forEach((p, i) => { if (left[i]! > 0) f.sendList.push({ key: p.key, n: left[i]!, fluid: p.fluid, tank: p.tank }); });
    if (f.sendList.length > 0) {
      listed(f, t);
      // `alertDevice`: the interface tries its send list on the next tick
      f.nextTry = t + 1;
      sim.wakeAt(f.entity, t + 1);
    }
    if (f.spec.spec.lock === 'until_result' && task.made.size > 0) {
      f.locked = true;
      f.lockList.clear();
      for (const [k, n] of task.made) f.lockList.set(k, n);
      f.lockLeft = task.made.size;
    }
    f.lastTask = task;
    return true;
  };

  /** Rule 6: `f` tries its send list at tick `t`, each stack into its targets in order, blocking or not; returns whether it moved something. */
  const trySendList = (f: Iface, t: number): boolean => {
    let moved = false;
    for (const x of f.targets) {
      for (const p of f.sendList) {
        if (p.n <= 0) continue;
        if (p.tank) {
          if (x.machine) {
            p.n = 0;
            moved = true;
          }
          continue;
        }
        const got = insertEmpties(x.inv, p.key, p.n, x.side, f.entity);
        if (got <= 0) continue;
        stats.delivered(x.inv.id, p.key, got, t);
        p.n -= got;
        moved = true;
        if (p.fluid >= 0 && x.keepsPackets) stats.packet(x.node.id, f.spec.id, p.fluid, 'slot', t);
      }
    }
    let kept = 0;
    for (const p of f.sendList) if (p.n > 0) f.sendList[kept++] = p;
    f.sendList.length = kept;
    listed(f, t);
    return moved;
  };

  // ---- Rule 4: the CPU ----

  /** Busy: its send list holds something, it is locked, or blocking mode (not smart blocking) finds none of its targets empty. */
  const busy = (f: Iface): boolean => f.sendList.length > 0 || f.locked
    || (f.spec.spec.blocking && f.spec.spec.smartBlocking !== true && !f.targets.some((x) => x.inv.countsAsEmpty()));
  /** Whether one craft's inputs are in the CPU's store (what ME stocks always is). */
  const ready = (task: Task, t: number): boolean => {
    for (const [k, n] of task.need) if (!inStock(k, t) && store[k]! < n) return false;
    return true;
  };
  /** The CPU's pushes of its last three updates, the latest first. */
  const used = [0, 0, 0];
  const first = net.interfaces[0] ?? net.exportBuses[0];
  const cpu: SimEntity = {
    phase: PHASE.grid,
    order: first === undefined ? 0 : partRank(model, first.id),
    tick(t: number): number {
      const allowed = env.opts.ae2Coprocessors + 1 - (used[0]! + used[1]! + used[2]!);
      let ops = allowed;
      for (const task of job) {
        if (ops <= 0) break;
        if (task.left <= 0 || !ready(task, t)) continue;
        for (const f of task.ifaces) {
          while (ops > 0 && task.left > 0 && !busy(f) && ready(task, t) && pushPattern(f, task, t)) {
            for (const [k, n] of task.need) if (!inStock(k, t)) store[k]! -= n;
            for (const [k, n] of task.items) waiting[k]! += n;
            task.left -= 1;
            ops -= 1;
            // a blocking interface gives the turn to the next; a non-blocking one is pushed again
            if (f.spec.spec.blocking) break;
          }
          if (ops <= 0 || task.left <= 0) break;
        }
      }
      used[2] = used[1]!;
      used[1] = used[0]!;
      used[0] = Math.max(0, allowed) - Math.max(0, ops);
      // it looks every tick while the job has crafts left
      return job.some((task) => task.left > 0) ? t + 1 : NEVER;
    },
  };

  // ---- Rule 1a: the ME Export Buses ----
  const buses: SimEntity[] = [];
  for (const spec of net.exportBuses) {
    const target = spec.target;
    const inv = target === null ? null : env.inv(target.bus ?? target.node);
    const items = spec.keys.filter((k) => !isFluidKey(k)).map((k) => keys.id(k));
    if (target === null || inv === null || items.length === 0) continue;
    let rate = Math.floor((AE2.exportMinTicks + AE2.exportMaxTicks) / 2);
    let next = env.loadedAt + rate;
    const bus: SimEntity = {
      phase: PHASE.tile, order: partRank(model, spec.id),
      tick(t: number): number {
        if (t < next) return next;
        // one operation: up to its amount, shared over its items in order, each from storage (a supply item always)
        let budget = spec.amount;
        for (const k of items) {
          if (budget <= 0) break;
          const always = inStock(k, t);
          const n = always ? budget : Math.min(budget, storage[k]!);
          if (n <= 0) continue;
          const got = insertEmpties(inv, k, n, target.side, bus);
          if (got <= 0) continue;
          if (!always) storage[k]! -= got;
          stats.delivered(inv.id, k, got, t);
          budget -= got;
        }
        rate = Math.min(AE2.exportMaxTicks, Math.max(AE2.exportMinTicks, rate + (budget < spec.amount ? -2 : 1)));
        next = t + rate;
        return next;
      },
    };
    buses.push(bus);
  }

  // ---- Rule 9: why an item does not reach a machine ----
  const explain: Explain = (kind, node, key) => {
    void key;
    if (kind !== 'in') return null;
    const toward = ifaces.filter((f) => f.targets.some((x) => x.node.id === node));
    if (toward.length === 0) return null;
    if (failed !== null) return `the AE2 job cannot be planned: ${failed}`;
    // a task for it waits for a fluid another pattern makes, which never comes back to ME
    for (const task of job) {
      if (!task.ifaces.some((f) => toward.includes(f))) continue;
      for (const k of task.need.keys()) {
        const maker = keys.isFluid(k) && !stocked(k) ? makerOf.get(k) : undefined;
        if (maker !== undefined) return `the AE2 job waits for ${nameOf(k)}, which ${maker.maker} makes but the line pipes away, so it never comes back to ME`;
      }
    }
    // R9: blocking mode toward a bench, or toward a machine that holds what blocking mode does not ignore (the model's test, as
    // the machine's `countsAsEmpty` asks it: the pack's list, GT's lenses among them)
    const target = byId.get(node);
    for (const f of toward) {
      if (!f.spec.spec.blocking || target === undefined) continue;
      if (target.kind === 'bench') return `${f.spec.label} has blocking mode on and ${target.label}'s crafting grid counts as items: it never pushes into it`;
      if (target.kind !== 'basic') continue;
      const held = [...new Set(target.recipes.flatMap((r) => r.held))].sort(compareText).find((h) => !model.ignoredByBlocking(h));
      if (held !== undefined) {
        return `${f.spec.label} has blocking mode on and ${target.label} holds ${model.nameOf(held)}, which blocking mode does not ignore: it never pushes into it`;
      }
    }
    return null;
  };

  // ---- What the run leaves unknown, and what entered ME ----
  const steam = byHand ? model.nodes.filter((n): n is BasicNode => n.kind === 'basic' && n.steam) : [];
  const unknowns = (): FeedUnknown[] => steam.map((n): FeedUnknown => ({
    code: 'steam_by_hand', text: `${n.label} takes no cover and never pushes its outputs out (a steam machine): the player takes them out by hand, `
      + 'which the checker models as each run\'s outputs entering ME as the run ends',
    pos: [n.pos[0], n.pos[1], n.pos[2]], ...(n.stepIds[0] === undefined ? {} : { stepId: n.stepIds[0] }),
  }));
  const out = (): Array<[StuffKey, number]> => {
    const list: Array<[StuffKey, number]> = [];
    for (let k = 0; k < keys.size; k++) if (entered[k]! > 0) list.push([keys.key(k), entered[k]!]);
    return list;
  };

  const receivers: NetworkModel['receivers'] = [];
  for (const f of ifaces) for (let side = 0; side < 6; side++) receivers.push({ at: f.spec.id, side, target: into });
  return {
    entities: [...(job.length > 0 ? [cpu] : []), ...ifaces.map((f) => f.entity), ...buses], explain, receivers, unknowns, out,
  };
}
