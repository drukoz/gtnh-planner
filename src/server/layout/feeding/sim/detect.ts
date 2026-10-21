// What a scenario run records and the findings it gives (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md`
// Task 4, detector rules 10–16, Task 5 rule 4 and Task 6 rule 5). The models record as they run (`SimStats`): what each
// machine was handed and gave up, every recipe check it made and what came of it, how many input slots each kind filled,
// what reached each chest and what was dropped into the world, and what each Auto Workbench moved to its result slot,
// destroyed, crafted, could not push and took in. `detect` reads that once the run is over:
// - `feed_crowded`: a recipe waits for a kind that cannot get in, for `STALL_TICKS` in a row; or a multiblock has every
//   input of its recipe on its input buses but no one bus holds them all while Input Separation is on, as long;
// - `feed_overfill`: one kind in two or more input slots of a machine (or slots of a multiblock's input bus) that takes two
//   or more kinds; one item in two or more input slots of a bench, or an item not in its grid in one;
// - `feed_bench_eject`, `feed_bench_delete`: what a bench moved to its result slot that it did not craft, and what its
//   clean-up of duplicate stacks overwrote there;
// - `feed_bench_stuck`: a bench whose push left the stack in its result slot where it was for `STALL_TICKS` in a row;
// - `feed_no_route`: an output blocked for `STALL_TICKS` in a row while nothing is taken out of the machine;
// - `feed_pool_starve`: a recipe of a shared machine that never ran while its inputs were there for `STALL_TICKS`;
// - `feed_starved`, `feed_slow`: a planned input never handed over, or handed over too slowly while the recipe waited;
// - `feed_leak`: an item planned for a machine that reached a chest instead.
// A multiblock's buses stand in for a basic machine's slots: what its input buses were handed counts as handed to it, and
// what left its output buses as taken out of it.
// Each finding is `phase: 'sim'` and `certain` for its scenario, with the first tick of its condition; findings come by node
// (the model's local order), then the Codes table's order, then item key.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../../shared/keys.ts';
import { fmtInt, fmtRate } from '../../../../shared/layout/format.ts';
import { FEED_KINDS, STALL_TICKS, TICKS_PER_SECOND, SLOW_TOLERANCE, type FeedCode, type FeedFinding, type ScenarioName } from '../contract.ts';
import type { BenchNode, ChestNode, FeedModel, FeedNode, MultiNode, NodeId } from '../model.ts';
import { listText } from '../text.ts';
import type { KeyTable, SimInv } from './core.ts';

/** A network's reason why an item does not reach a node (`in`) or leave it (`out`), or null when it has none. */
export type Explain = (kind: 'in' | 'out', node: NodeId, key: StuffKey) => string | null;

/** A missing kind that cannot get into a machine (rule 6d): `key`, while `by` fills `slots` of its `of` input slots. */
export interface Crowd { key: number; by: number; slots: number; of: number }

const START = 0, WAIT = 1, BLOCK = 2, SPLIT = 3;

/** One recipe check of a machine (rule 6d) and what came of it; `SPLIT`: a multiblock's set on separated buses (Task 5 rule 4). */
interface Check {
  t: number; kind: typeof START | typeof WAIT | typeof BLOCK | typeof SPLIT; recipe: number;
  missing: number[]; crowd: Crowd | null;                     // a wait: what is missing, and what keeps a missing kind out
  key: number; ready: number[];                               // a block: the item in the output slot that blocks, the other recipes whose inputs are there
}

/** What a run records about one node. */
interface NodeRecord {
  checks: Check[];
  starts: number[];                                           // runs started, by recipe index
  given: { t: number[]; key: number[]; n: number[] };         // `delivered`, in order
  taken: number[];                                            // ticks something left its output slots
  slots: Map<number, { most: number; first: number }>;        // input slots a kind filled: the most, the first tick it filled two
  arrived: Array<[number, number, number]>;                   // a chest's arrivals: tick, key, count (one per tick and key)
  spilled: Map<number, number>;                               // items dropped into the world, by key
  final: Array<[number, number] | null> | null;               // slot contents at the end
}

function emptyRecord(): NodeRecord {
  return { checks: [], starts: [], given: { t: [], key: [], n: [] }, taken: [], slots: new Map(), arrived: [], spilled: new Map(), final: null };
}

/**
 * Why a bench moved a stack to its result slot that it did not craft (Task 6 rule 3): a stray (an item neither in its grid
 * nor a grid item's container), the last input slot after a failed craft, or the second of two stacks of one ingredient.
 */
export type BenchMove = 'stray' | 'failed' | 'duplicate';

/** What a run records about one Auto Workbench (Task 6). */
interface BenchRecord {
  moved: Array<{ t: number; key: number; n: number; why: BenchMove }>;   // stacks moved to its result slot that it did not craft
  lost: Array<{ t: number; key: number; n: number }>;                    // stacks its clean-up overwrote in its result slot
  crafts: number[];                                                      // craft ticks
  refused: Array<{ key: number; from: number; to: number }>;             // its push left its result from `from` until it went out at `to` (−1: never)
  took: Map<number, number>;                                             // items not in its grid it took into an input slot: the first tick, by key
}

function emptyBench(): BenchRecord {
  return { moved: [], lost: [], crafts: [], refused: [], took: new Map() };
}

/**
 * What a scenario run records, by node id. The models call the recorders as things happen (keys are `KeyTable` ids);
 * the readers turn ids back into keys. Nothing here depends on how often an entity ran, so a scheduled run and an
 * exhaustive one record the same.
 */
export class SimStats {
  /** The run's key table: the readers turn ids back into keys with it. */
  readonly keys: KeyTable;
  private readonly nodes = new Map<NodeId, NodeRecord>();
  private readonly benches = new Map<NodeId, BenchRecord>();
  private readonly simulated = new Set<NodeId>();
  private readonly spills: Array<[NodeId, number]> = [];      // (node, key) in the order they first spilled

  constructor(keys: KeyTable) {
    this.keys = keys;
  }

  private of(node: NodeId): NodeRecord {
    let r = this.nodes.get(node);
    if (r === undefined) {
      r = emptyRecord();
      this.nodes.set(node, r);
    }
    return r;
  }

  private benchOf(node: NodeId): BenchRecord {
    let r = this.benches.get(node);
    if (r === undefined) {
      r = emptyBench();
      this.benches.set(node, r);
    }
    return r;
  }

  /** `node` is simulated: `detect` reports on it. */
  register(node: NodeId): void {
    this.simulated.add(node);
    this.of(node);
  }

  isSimulated(node: NodeId): boolean {
    return this.simulated.has(node);
  }

  /** A network (or a test feeder) handed `n` of `key` to `node`. */
  delivered(node: NodeId, key: number, n: number, t: number): void {
    const g = this.of(node).given;
    g.t.push(t);
    g.key.push(key);
    g.n.push(n);
  }

  /** `n` of `key` left `node`'s output slots. */
  extracted(node: NodeId, key: number, n: number, t: number): void {
    void key;
    void n;
    const taken = this.of(node).taken;
    if (taken.at(-1) !== t) taken.push(t);
  }

  /** A recipe check found no recipe whose inputs are there: recipe `recipe` (its cached one, else its first) misses `missing`. */
  waiting(node: NodeId, recipe: number, missing: readonly number[], crowdedBy: Crowd | null, t: number): void {
    this.of(node).checks.push({ t, kind: WAIT, recipe, missing: [...missing], crowd: crowdedBy === null ? null : { ...crowdedBy }, key: -1, ready: [] });
  }

  /** A run of recipe `recipe` started. */
  started(node: NodeId, recipe: number, t: number): void {
    const r = this.of(node);
    r.checks.push({ t, kind: START, recipe, missing: [], crowd: null, key: -1, ready: [] });
    while (r.starts.length <= recipe) r.starts.push(0);
    r.starts[recipe]! += 1;
  }

  /**
   * A recipe check found recipe `recipe` but its outputs do not fit (rule 6d: it never tries another): `key` is the item
   * in the output slot that blocks, `ready` the other recipes whose inputs were there.
   */
  blocked(node: NodeId, recipe: number, t: number, key: number, ready: readonly number[] = []): void {
    this.of(node).checks.push({ t, kind: BLOCK, recipe, missing: [], crowd: null, key, ready: [...ready] });
  }

  /**
   * A multiblock's recipe check found every input of recipe `recipe` on its input buses, but no one bus holds them all
   * while Input Separation checks each bus alone (Task 5 rule 4).
   */
  separated(node: NodeId, recipe: number, t: number): void {
    this.of(node).checks.push({ t, kind: SPLIT, recipe, missing: [], crowd: null, key: -1, ready: [] });
  }

  /** `key` now fills `slots` input slots of `node`. */
  occupancy(node: NodeId, key: number, slots: number, t: number): void {
    const m = this.of(node).slots;
    const r = m.get(key);
    if (r === undefined) m.set(key, { most: slots, first: slots >= 2 ? t : -1 });
    else {
      r.most = Math.max(r.most, slots);
      if (r.first < 0 && slots >= 2) r.first = t;
    }
  }

  /** `n` of `key` arrived in `chest`. */
  arrived(chest: NodeId, key: number, n: number, t: number): void {
    const list = this.of(chest).arrived;
    const last = list.at(-1);
    if (last !== undefined && last[0] === t && last[1] === key) last[2] += n;
    else list.push([t, key, n]);
  }

  /** `n` of `key` that `node` (a conveyor on it, or its auto-output) dropped into the world. */
  spilled(node: NodeId, key: number, n: number, t: number): void {
    void t;
    const m = this.of(node).spilled;
    if (!m.has(key)) this.spills.push([node, key]);
    m.set(key, (m.get(key) ?? 0) + n);
  }

  /** Bench `node` moved `n` of `key` to its result slot, not as a craft's result: `why`. */
  benchMoved(node: NodeId, key: number, n: number, why: BenchMove, t: number): void {
    this.benchOf(node).moved.push({ t, key, n, why });
  }

  /** Bench `node`'s clean-up of duplicate stacks overwrote the `n` of `key` it had moved to its result slot: they are gone. */
  benchLost(node: NodeId, key: number, n: number, t: number): void {
    this.benchOf(node).lost.push({ t, key, n });
  }

  /** Bench `node` crafted: a run of its recipe 0, the one its grid is laid from (`started`). */
  benchCrafted(node: NodeId, t: number): void {
    this.benchOf(node).crafts.push(t);
    this.started(node, 0, t);
  }

  /** Bench `node`'s push moved nothing while its result slot held `key`: from `t`, until that stack goes out (`benchFreed`). */
  benchStuck(node: NodeId, key: number, t: number): void {
    const list = this.benchOf(node).refused;
    if (list.at(-1)?.to === -1) return;
    list.push({ key, from: t, to: -1 });
  }

  /** The stack in bench `node`'s result slot that its push had left there went out at `t`, in whole or in part. */
  benchFreed(node: NodeId, t: number): void {
    const open = this.benchOf(node).refused.at(-1);
    if (open !== undefined && open.to === -1) open.to = t;
  }

  /** Bench `node` took `key`, which is not in its grid, into an input slot (only its first time counts). */
  benchTook(node: NodeId, key: number, t: number): void {
    const took = this.benchOf(node).took;
    if (!took.has(key)) took.set(key, t);
  }

  /** Records `inv`'s contents at the end of the run. */
  snapshot(inv: SimInv): void {
    const out: Array<[number, number] | null> = [];
    for (let i = 0; i < inv.slotCount(); i++) {
      const s = inv.stack(i);
      out.push(s === null ? null : [s.key, s.count]);
    }
    this.of(inv.id).final = out;
  }

  // ---- Readers ----

  /** The items `node` dropped into the world. */
  spilledTotal(node: NodeId): number {
    let n = 0;
    for (const v of this.nodes.get(node)?.spilled.values() ?? []) n += v;
    return n;
  }

  /** What `node` dropped, by key, in the order each key first dropped (the unknowns `items_dropped` name them). */
  spillsInOrder(): Array<[NodeId, StuffKey, number]> {
    return this.spills.map(([node, key]) => [node, this.keys.key(key), this.nodes.get(node)!.spilled.get(key)!]);
  }

  /** What reached `chest`, in order: one entry per tick and key. */
  arrivals(chest: NodeId): Array<[tick: number, key: StuffKey, count: number]> {
    return (this.nodes.get(chest)?.arrived ?? []).map(([t, key, n]) => [t, this.keys.key(key), n]);
  }

  /** `node`'s slot contents at the end of the run, in slot order (null: empty). */
  final(node: NodeId): Array<[StuffKey, number] | null> {
    return (this.nodes.get(node)?.final ?? []).map((s) => (s === null ? null : [this.keys.key(s[0]), s[1]]));
  }

  /** The runs `node` started, by recipe index. */
  runsOf(node: NodeId): number[] {
    return [...(this.nodes.get(node)?.starts ?? [])];
  }

  /** The ticks bench `node` crafted, in order. */
  benchCrafts(node: NodeId): number[] {
    return [...(this.benches.get(node)?.crafts ?? [])];
  }

  /** @internal what `detect` reads */
  recordOf(node: NodeId): Readonly<NodeRecord> | undefined {
    return this.nodes.get(node);
  }

  /** @internal what `detect` reads of a bench */
  benchRecordOf(node: NodeId): Readonly<BenchRecord> | undefined {
    return this.benches.get(node);
  }
}

// ---- detect ----

const CODE_ORDER: readonly FeedCode[] = Object.keys(FEED_KINDS) as FeedCode[];

/** Why a bench threw items out of its input slots, in the order `feed_bench_eject` gives them (Task 6 rule 5). */
const BENCH_REASONS: ReadonlyArray<readonly [BenchMove, string]> = [
  ['stray', 'it took items that are not in its grid'],
  ['failed', 'a failed craft empties its last input slot'],
  ['duplicate', 'its clean-up moves the second of two stacks of one ingredient to its result slot'],
];

/** "1 item", "448 items". */
function itemsText(n: number): string {
  return `${fmtInt(n)} item${n === 1 ? '' : 's'}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Pending { at: number; code: number; key: string; seq: number; finding: FeedFinding }

/** The end of check `i`'s condition: the next check's tick, or the end of the run. */
function endOf(checks: readonly Check[], i: number, ticks: number): number {
  return checks[i + 1]?.t ?? ticks;
}

/**
 * The stretches of consecutive checks for which `same(check)` gives the same non-null value: each from its first check
 * to the next check that differs, or the end of the run.
 */
function stretches<T>(checks: readonly Check[], ticks: number, same: (c: Check) => T | null): Array<{ value: T; from: number; to: number; first: Check }> {
  const out: Array<{ value: T; from: number; to: number; first: Check }> = [];
  let open: { value: T; from: number; first: Check } | null = null;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i]!;
    const v = same(c);
    if (open !== null && v !== open.value) {
      out.push({ ...open, to: c.t });
      open = null;
    }
    if (open === null && v !== null) open = { value: v, from: c.t, first: c };
    if (i === checks.length - 1 && open !== null) out.push({ ...open, to: endOf(checks, i, ticks) });
  }
  return out;
}

/**
 * A multiblock's record as the detectors read it: its controller's checks and runs, with what its input buses were handed
 * (`given`) and the ticks something left its output buses (`taken`), the buses standing in for a machine's slots.
 */
function withBuses(stats: SimStats, node: MultiNode, own: Readonly<NodeRecord>): Readonly<NodeRecord> {
  const given = { t: [...own.given.t], key: [...own.given.key], n: [...own.given.n] };
  for (const bus of node.inBuses) {
    const g = stats.recordOf(bus.id)?.given;
    if (g === undefined) continue;
    for (let i = 0; i < g.t.length; i++) {
      given.t.push(g.t[i]!);
      given.key.push(g.key[i]!);
      given.n.push(g.n[i]!);
    }
  }
  const taken = new Set(own.taken);
  for (const bus of node.outBuses) for (const t of stats.recordOf(bus.id)?.taken ?? []) taken.add(t);
  return { ...own, given, taken: [...taken].sort((a, b) => a - b) };
}

/**
 * The findings of a scenario run (rules 10–16, Task 5 rule 4) on the nodes the run simulated. `explain` gives the
 * networks' reasons for an item that never arrives or never leaves; `slowTolerance` is `feed_slow`'s (default
 * `SLOW_TOLERANCE`).
 */
export function detect(model: FeedModel, stats: SimStats, run: { scenario: ScenarioName; ticks: number; explain: Explain; slowTolerance?: number }): FeedFinding[] {
  const { ticks, scenario } = run;
  const found: Pending[] = [];
  const keyOf = (id: number) => stats.keys.key(id);
  const name = (id: number) => model.nameOf(keyOf(id));
  const emit = (at: number, node: FeedNode, code: FeedCode, text: string, more: { key?: StuffKey; stepId?: string; tick: number; count?: number }): void => {
    const stepId = more.stepId ?? (node.kind === 'chest' ? undefined : node.stepIds[0]);
    found.push({
      at, code: CODE_ORDER.indexOf(code), key: more.key ?? '', seq: found.length,
      finding: {
        code, kind: FEED_KINDS[code], phase: 'sim', certainty: 'certain', scenario, ...(stepId === undefined ? {} : { stepId }),
        machine: node.label, pos: [node.pos[0], node.pos[1], node.pos[2]], ...(more.key === undefined ? {} : { key: more.key }), text,
        tick: more.tick, ...(more.count === undefined ? {} : { count: more.count }),
      },
    });
  };

  // the first machine whose plan rates list each key: who a leaked item was meant for
  const meantFor = new Map<StuffKey, { node: FeedNode; stepId: string }>();
  for (const node of model.nodes) {
    if (node.kind === 'chest') continue;
    for (const stepId of node.stepIds) {
      for (const key of Object.keys(model.planned[stepId] ?? {}).sort(compareText)) if (!meantFor.has(key)) meantFor.set(key, { node, stepId });
    }
  }
  const sinks = new Set(model.sinks);

  model.nodes.forEach((node, at) => {
    if (!stats.isSimulated(node.id)) return;
    const own = stats.recordOf(node.id);
    if (own === undefined) return;
    if (node.kind === 'chest') {
      leaks(at, node, own);
      return;
    }
    const rec = node.kind === 'multi' ? withBuses(stats, node, own) : own;
    const recipeStep = (r: number) => node.recipes[r]?.stepId ?? node.stepIds[0];

    // rule 10: feed_crowded, one per kind that cannot get in
    const crowded = stretches(rec.checks, ticks, (c) => (c.kind === WAIT && c.crowd !== null ? c.crowd.key : null));
    for (const key of [...new Set(crowded.map((s) => s.value))].sort((a, b) => a - b)) {
      const mine = crowded.filter((s) => s.value === key);
      const first = mine.find((s) => s.to - s.from >= STALL_TICKS);
      if (first === undefined) continue;
      const crowd = first.first.crowd!;
      const multiOn = node.kind === 'basic' && (node.settings.multiStack === true || (node.settings.multiStack === null && scenario === 'multistack_on'));
      emit(at, node, 'feed_crowded', `${name(key)} cannot get into ${node.label}: ${name(crowd.by)} fills ${crowd.slots} of its ${crowd.of} input slots`
        + `${multiOn ? ' (Multi Stack Input On)' : ''} while its recipe waits for ${name(key)}`,
      { key: keyOf(key), stepId: recipeStep(first.first.recipe), tick: first.from, count: Math.max(...mine.map((s) => s.to - s.from)) });
    }

    // Task 5 rule 4: feed_crowded, a multiblock's set split over input buses that Input Separation checks alone, one per recipe
    const split = stretches(rec.checks, ticks, (c) => (c.kind === SPLIT ? c.recipe : null));
    for (const recipe of [...new Set(split.map((s) => s.value))].sort((a, b) => a - b)) {
      const mine = split.filter((s) => s.value === recipe);
      const first = mine.find((s) => s.to - s.from >= STALL_TICKS);
      if (first === undefined) continue;
      emit(at, node, 'feed_crowded', `${node.label} has every input of its recipe but on different input buses, and Input Separation checks each bus alone`,
        { stepId: recipeStep(recipe), tick: first.from, count: Math.max(...mine.map((s) => s.to - s.from)) });
    }

    // rule 11 (Task 5 rule 4 on a multiblock's input buses): feed_overfill; a bench's has its own words (Task 6 rule 5)
    if (node.kind === 'bench') benchFindings(at, node, rec);
    else if (node.kinds.length >= 2) {
      const filled = node.kind === 'multi'
        ? node.inBuses.map((bus) => ({ slots: stats.recordOf(bus.id)?.slots, where: (n: number) => `${n} slots of ${bus.label} of ${node.label}` }))
        : [{ slots: rec.slots, where: (n: number) => `${n} input slots of ${node.label}` }];
      for (const { slots, where } of filled) {
        for (const [key, s] of [...(slots ?? [])].sort((a, b) => a[0] - b[0])) {
          if (s.most < 2) continue;
          const k = keyOf(key);
          emit(at, node, 'feed_overfill', `${name(key)} fills ${where(s.most)}, which takes ${node.kinds.length} kinds of item`,
            { key: k, stepId: node.recipes.find((r) => r.inputs.some((i) => i.key === k))?.stepId, tick: s.first });
        }
      }
    }

    // rule 14: feed_no_route, an output blocked with nothing taken out of the machine meanwhile
    const blocked = stretches(rec.checks, ticks, (c) => (c.kind === BLOCK ? c.key : null));
    const stalls = new Map<number, { from: number; recipe: number }>();
    for (const s of blocked) {
      if (stalls.has(s.value)) continue;
      // the stall starts again each time something leaves the output slots
      let from = s.from;
      let stalled = -1;
      for (const t of rec.taken) {
        if (t < s.from) continue;
        if (t >= s.to) break;
        if (t - from >= STALL_TICKS) {
          stalled = from;
          break;
        }
        from = t;
      }
      if (stalled < 0 && s.to - from >= STALL_TICKS) stalled = from;
      if (stalled >= 0) stalls.set(s.value, { from: stalled, recipe: s.first.recipe });
    }
    for (const [key, s] of [...stalls].sort((a, b) => a[0] - b[0])) {
      const k = keyOf(key);
      emit(at, node, 'feed_no_route', `Nothing takes ${name(key)} out of ${node.label}: ${run.explain('out', node.id, k) ?? 'nothing on the line takes it'}`,
        { key: k, stepId: recipeStep(s.recipe), tick: s.from });
    }

    // rule 15: feed_pool_starve, a recipe that never ran while the cached one's output blocked it
    if (node.recipes.length >= 2) {
      node.recipes.forEach((recipe, j) => {
        if ((rec.starts[j] ?? 0) > 0) return;
        const waits = stretches(rec.checks, ticks, (c) => (c.kind === BLOCK && c.ready.includes(j) ? c.recipe : null));
        const first = waits.find((s) => s.to - s.from >= STALL_TICKS);
        if (first === undefined) return;
        const outputs = [...new Set(node.recipes[first.value]?.outputs.map((o) => model.nameOf(o.key)) ?? [])];
        emit(at, node, 'feed_pool_starve',
          `${node.label} never ran its recipe for ${model.stepName(recipe.stepId)}: it kept waiting on its last recipe's blocked output (${listText(outputs)})`,
          { stepId: recipe.stepId, tick: first.from });
      });
    }

    // rules 12 and 13: feed_starved and feed_slow, per planned input
    const planned = new Map<StuffKey, { rate: number; stepId: string }>();
    for (const stepId of node.stepIds) {
      for (const [key, rate] of Object.entries(model.planned[stepId] ?? {})) {
        const p = planned.get(key);
        planned.set(key, { rate: (p?.rate ?? 0) + rate, stepId: p?.stepId ?? stepId });
      }
    }
    const half = Math.floor(ticks / 2);
    const seconds = (ticks - half) / TICKS_PER_SECOND;
    const tolerance = run.slowTolerance ?? SLOW_TOLERANCE;
    for (const [key, p] of [...planned].sort((a, b) => compareText(a[0], b[0]))) {
      const id = stats.keys.id(key);
      let total = 0, late = 0;
      rec.given.key.forEach((k, i) => {
        if (k !== id) return;
        total += rec.given.n[i]!;
        if (rec.given.t[i]! >= half) late += rec.given.n[i]!;
      });
      if (total === 0) {
        emit(at, node, 'feed_starved', `${node.label} never gets ${model.nameOf(key)}: ${run.explain('in', node.id, key) ?? 'nothing on the line hands it over'}`,
          { key, stepId: p.stepId, tick: 0 });
        continue;
      }
      if (seconds <= 0 || late >= (1 - tolerance) * p.rate * seconds) continue;
      // how long the second half's checks left the recipe waiting for it
      let waited = 0, since = -1;
      rec.checks.forEach((c, i) => {
        if (c.kind !== WAIT || !c.missing.includes(id)) return;
        const from = Math.max(c.t, half), to = Math.min(endOf(rec.checks, i, ticks), ticks);
        if (to <= from) return;
        waited += to - from;
        if (since < 0) since = from;
      });
      if (waited <= 0.1 * (ticks - half)) continue;
      emit(at, node, 'feed_slow', `${node.label} gets ${model.nameOf(key)} at ${fmtRate(late / seconds)}/s, below the ${fmtRate(p.rate)}/s the plan needs`,
        { key, stepId: p.stepId, tick: since });
    }
  });

  /** `${n}× ${name}` for each item of `events` by its total, the largest first (ties: key order), joined by ", ". */
  function countsText(events: ReadonlyArray<{ key: number; n: number }>): string {
    const totals = new Map<number, number>();
    for (const e of events) totals.set(e.key, (totals.get(e.key) ?? 0) + e.n);
    return [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([key, n]) => `${fmtInt(n)}× ${name(key)}`).join(', ');
  }

  /**
   * Task 6 rule 5, a bench: `feed_overfill` (one item in two or more input slots: n the most, from the first tick; an item
   * not in its grid in one), `feed_bench_eject` (what it moved to its result slot that it did not craft), `feed_bench_delete`
   * (what its clean-up overwrote there) and `feed_bench_stuck` (its push left its result for `STALL_TICKS` in a row, once
   * per item, from the first such stretch).
   */
  function benchFindings(at: number, node: BenchNode, rec: Readonly<NodeRecord>): void {
    for (const [key, s] of [...rec.slots].sort((a, b) => a[0] - b[0])) {
      if (s.most >= 2) emit(at, node, 'feed_overfill', `${name(key)} fills ${s.most} input slots of ${node.label}`, { key: keyOf(key), tick: s.first });
    }
    const b = stats.benchRecordOf(node.id);
    if (b === undefined) return;
    for (const [key, t] of [...b.took].sort((x, y) => x[0] - y[0])) {
      emit(at, node, 'feed_overfill', `${node.label} took ${name(key)}, which is not in its grid`, { key: keyOf(key), tick: t });
    }
    if (b.moved.length > 0) {
      const n = b.moved.reduce((sum, m) => sum + m.n, 0);
      const reasons = BENCH_REASONS.filter(([why]) => b.moved.some((m) => m.why === why)).map(([, words]) => words);
      emit(at, node, 'feed_bench_eject', `${node.label} threw ${itemsText(n)} out of its input slots (${countsText(b.moved)}): ${reasons.join('; ')}`,
        { tick: b.moved[0]!.t, count: n });
    }
    if (b.lost.length > 0) {
      const n = b.lost.reduce((sum, l) => sum + l.n, 0);
      emit(at, node, 'feed_bench_delete', `${node.label} destroyed ${itemsText(n)} (${countsText(b.lost)}): its clean-up of stacks of one ingredient `
        + 'overwrites the stack it already moved to its result slot', { tick: b.lost[0]!.t, count: n });
    }
    const stuck = new Map<number, number>();
    for (const r of b.refused) {
      if (stuck.has(r.key) || (r.to === -1 ? ticks : r.to) - r.from < STALL_TICKS) continue;
      stuck.set(r.key, r.from);
    }
    for (const [key, from] of [...stuck].sort((x, y) => x[0] - y[0])) {
      emit(at, node, 'feed_bench_stuck', `${node.label} stopped: ${name(key)} sits in its result slot and the block behind it does not take it`,
        { key: keyOf(key), tick: from });
    }
  }

  /** Rule 16: an item planned for a machine that reached the chest, and the plan does not send out of the line. */
  function leaks(at: number, chest: ChestNode, rec: Readonly<NodeRecord>): void {
    const got = new Map<number, { n: number; first: number }>();
    for (const [t, key, n] of rec.arrived) {
      const g = got.get(key);
      if (g === undefined) got.set(key, { n, first: t });
      else g.n += n;
    }
    for (const [key, g] of [...got].sort((a, b) => a[0] - b[0])) {
      const k = keyOf(key);
      const meant = meantFor.get(k);
      if (meant === undefined || sinks.has(k)) continue;
      emit(at, chest, 'feed_leak', `${model.nameOf(k)} meant for ${meant.node.label} reached ${chest.label}`, { key: k, stepId: meant.stepId, tick: g.first, count: g.n });
    }
  }

  return found.sort((a, b) => a.at - b.at || a.code - b.code || compareText(a.key, b.key) || a.seq - b.seq).map((p) => p.finding);
}
