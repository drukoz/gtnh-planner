// How the build list's parts are made (spec §3.10, architecture §11 entry 41; add-on 14): one recipe per good, settled
// cheapest first over the breakdown's recipe book (`settleRecipes`), with why a good the book cannot settle stays unmade
// (`unmadeCause`); the machine a one-off job of each recipe runs on (`partMachine`, over `ownedForParts`); the pooled
// make plan of a whole build list (`poolMakes`), so whole runs are rounded once per good, not once per part needing it;
// and the order of its jobs (`orderJobs`), which also says where a cycle of machine waits is broken.

import { PSEUDO_MACHINES, V } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Machine, Pack, Recipe } from '../../shared/types/pack.ts';
import type { BomMachine, PlanContext, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import type { CandidateGraph, LpRecipe } from './candidates.ts';

/** Amounts up to this count as zero, and a run count this little above a whole number stays whole (as bom.ts). */
const TINY = 1e-9;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0. */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

/** What one run of `lp` makes of `key`: its positive coefficient, else 0. */
export function madePerRun(lp: LpRecipe, key: StuffKey): number {
  for (const [k, c] of lp.coeffs) if (k === key) return Math.max(0, c);
  return 0;
}

const MAKERS = new WeakMap<CandidateGraph, ReadonlyMap<StuffKey, readonly LpRecipe[]>>();

/** The recipes of `graph` that make each good (convert recipes make their ore-dictionary slot), by id; once per graph. */
export function makersOf(graph: CandidateGraph): ReadonlyMap<StuffKey, readonly LpRecipe[]> {
  let makers = MAKERS.get(graph);
  if (makers === undefined) {
    const map = new Map<StuffKey, LpRecipe[]>();
    for (const lp of graph.recipes) {
      for (const [key, c] of lp.coeffs) {
        if (c <= 0) continue;
        const list = map.get(key);
        if (list === undefined) map.set(key, [lp]);
        else list.push(lp);
      }
    }
    makers = map;
    MAKERS.set(graph, makers);
  }
  return makers;
}

/** The recipe each made good settled by, the option each ore-dictionary slot took, every settled good's cost, the pins dropped. */
export interface Settled {
  /** Each made good's recipe and what one run makes of it. */
  recipe: ReadonlyMap<StuffKey, { lp: LpRecipe; perRun: number }>;
  /** Each ore-dictionary slot (virtual good) of the graph: the option it takes and how much of it. */
  option: ReadonlyMap<StuffKey, { key: StuffKey; amount: number }>;
  /** Gross raw cost per unit of every settled good: leaves at their leaf cost, made goods at their recipe's. */
  cost: ReadonlyMap<StuffKey, number>;
  /**
   * The free input burnt per unit of every settled good, beside its cost (architecture §11 entry 41 (1)): leaves at
   * `SettleOptions.free`, made goods at their recipe's, worked out as its cost is.
   */
  free: ReadonlyMap<StuffKey, number>;
  /** The pinned goods whose pin never settled them while the book held another recipe for them, by key. */
  droppedPins: readonly StuffKey[];
}

export interface SettleOptions {
  /** A good's leaf cost (Infinity: a base material out of reach), or null for a good the breakdown makes. */
  leafCost(key: StuffKey): number | null;
  /**
   * A leaf's free-input units per unit (water, lava, air or cobblestone, each unit counting 1), which breaks an exact
   * cost tie (architecture §11 entry 41 (1)); absent: 0 for every leaf.
   */
  free?(key: StuffKey): number;
  /** `PlanSettings.recipeChoice`: a pinned good is offered by its pinned recipe only, while that settles it. */
  pins: Readonly<Record<StuffKey, string>>;
  /** Whether `lp` may make `key` here (an empty container never from a filled one or itself); absent: every recipe may. */
  offers?(lp: LpRecipe, key: StuffKey): boolean;
}

type Entry = [cost: number, free: number, seq: number, key: StuffKey, lp: LpRecipe | null];

/** A binary min-heap of offers by cost, then the free input they burn, then the order they were made in. */
class OfferHeap {
  readonly #items: Entry[] = [];
  static #before(a: Entry, b: Entry): boolean {
    return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  }
  push(e: Entry): void {
    const a = this.#items;
    a.push(e);
    for (let i = a.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!OfferHeap.#before(a[i] as Entry, a[up] as Entry)) break;
      [a[i], a[up]] = [a[up] as Entry, a[i] as Entry];
      i = up;
    }
  }
  pop(): Entry | undefined {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && OfferHeap.#before(a[l] as Entry, a[m] as Entry)) m = l;
        if (r < a.length && OfferHeap.#before(a[r] as Entry, a[m] as Entry)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as Entry, a[i] as Entry];
        i = m;
      }
    }
    return top;
  }
}

/** One settle of `graph` with `pins` (good → pinned recipe id). */
function settleOnce(graph: CandidateGraph, opts: SettleOptions, pins: ReadonlyMap<StuffKey, string>): Omit<Settled, 'droppedPins'> {
  const keys = new Set<StuffKey>(graph.goods.keys());
  const waiting = new Map<string, number>();
  const consumers = new Map<StuffKey, LpRecipe[]>();
  for (const lp of graph.recipes) {
    let n = 0;
    for (const [key, c] of lp.coeffs) {
      keys.add(key);
      if (c >= 0) continue;
      n++;
      const list = consumers.get(key);
      if (list === undefined) consumers.set(key, [lp]);
      else list.push(lp);
    }
    waiting.set(lp.id, n);
  }
  const heap = new OfferHeap();
  let seq = 0;
  const cost = new Map<StuffKey, number>();
  const free = new Map<StuffKey, number>();
  const recipe = new Map<StuffKey, { lp: LpRecipe; perRun: number }>();
  const option = new Map<StuffKey, { key: StuffKey; amount: number }>();
  const offer = (lp: LpRecipe): void => {
    let total = 0;
    let burnt = 0;
    for (const [key, c] of lp.coeffs) {
      if (c >= 0) continue;
      total -= c * (cost.get(key) as number);
      burnt -= c * (free.get(key) as number);
    }
    for (const [key, c] of lp.coeffs) {
      if (c <= 0 || cost.has(key) || opts.leafCost(key) !== null) continue;
      const pin = pins.get(key);
      if (pin !== undefined && pin !== lp.id) continue;
      if (opts.offers !== undefined && !opts.offers(lp, key)) continue;
      heap.push([total / c, burnt / c, seq++, key, lp]);
    }
  };
  for (const key of [...keys].sort(byString)) {
    const leaf = opts.leafCost(key);
    if (leaf !== null) heap.push([leaf, opts.free?.(key) ?? 0, seq++, key, null]);
  }
  for (const lp of graph.recipes) if (waiting.get(lp.id) === 0) offer(lp);
  for (let e = heap.pop(); e !== undefined; e = heap.pop()) {
    const [c, f, , key, lp] = e;
    if (cost.has(key)) continue;
    cost.set(key, c);
    free.set(key, f);
    if (lp !== null) {
      if (lp.kind === 'convert') {
        const used = lp.coeffs.find(([, k]) => k < 0) as [StuffKey, number];
        option.set(key, { key: used[0], amount: -used[1] });
      } else {
        recipe.set(key, { lp, perRun: madePerRun(lp, key) });
      }
    }
    for (const next of consumers.get(key) ?? []) {
      const left = (waiting.get(next.id) as number) - 1;
      waiting.set(next.id, left);
      if (left === 0) offer(next);
    }
  }
  return { recipe, option, cost, free };
}

/**
 * One recipe per good of the breakdown's book (architecture §11 entry 41 (1)), settled cheapest first as the candidate
 * walk's estimate settles goods: a leaf settles at its leaf cost (leaves in key order); a recipe whose consumed goods have
 * all settled offers each good it makes, an ore-dictionary slot's convert recipe its slot, at its gross cost per unit —
 * what its consumed goods cost at their settled costs over what one run makes of the good, no credit for its other outputs
 * (the breakdown throws them away); the cheapest offer settles a good, at equal cost the one that burns less free input
 * per unit made (`SettleOptions.free`, worked out beside the cost), then the one made first (its recipe was ready first,
 * then the smaller recipe id), and every good settles once. So a recipe settles a good only after all it consumes has
 * settled: the choices form a DAG and no recipe consumes a good it is being made for, at any depth; a good's own packed
 * form or a stand-in pressed from the real thing settles after the real thing and loses every tie to it. A pinned good
 * is offered by its pin alone; while one that never settles so has another recipe in the book, the pin of the first
 * such good by key is dropped and the book settles again.
 */
export function settleRecipes(graph: CandidateGraph, opts: SettleOptions): Settled {
  const makers = makersOf(graph);
  const pins = new Map<StuffKey, string>();
  for (const [key, id] of Object.entries(opts.pins)) if ((makers.get(key) ?? []).some((lp) => lp.id === id)) pins.set(key, id);
  const dropped: StuffKey[] = [];
  for (;;) {
    const settled = settleOnce(graph, opts, pins);
    const stuck = [...pins.keys()].sort(byString)
      .find((key) => !settled.cost.has(key) && (makers.get(key) ?? []).some((lp) => lp.id !== pins.get(key)));
    if (stuck === undefined) return { ...settled, droppedPins: dropped };
    pins.delete(stuck);
    dropped.push(stuck);
  }
}

/**
 * Why `key`, which the breakdown needs but which never settled, is unmade (architecture §11 entry 41 (2)): `own-chain` when
 * a recipe of the book for it consumes an unsettled good from which the book's recipes lead back to it — every way to it
 * needs a part of its own chain — else `no-recipe` (the book holds no recipe for it, or its recipes need parts nothing
 * here makes).
 */
export function unmadeCause(graph: CandidateGraph, settled: Settled, key: StuffKey): 'no-recipe' | 'own-chain' {
  const makers = makersOf(graph);
  const leadsBack = (start: StuffKey): boolean => {
    const seen = new Set<StuffKey>();
    const stack = [start];
    while (stack.length > 0) {
      const good = stack.pop() as StuffKey;
      if (good === key) return true;
      if (seen.has(good) || settled.cost.has(good)) continue;
      seen.add(good);
      for (const lp of makers.get(good) ?? []) for (const [input, c] of lp.coeffs) if (c < 0) stack.push(input);
    }
    return false;
  };
  for (const lp of makers.get(key) ?? []) {
    for (const [input, c] of lp.coeffs) if (c < 0 && !settled.cost.has(input) && leadsBack(input)) return 'own-chain';
  }
  return 'no-recipe';
}

/**
 * The machines a one-off job may run on (architecture §11 entry 41 (1)): per mteId the group's machines of the world scan
 * (`ctx.ownedMachines`), of "Machines we have" (`settings.ownedManual`) and of every step's `owned` count, summed. Reuse
 * settings (`declineReuse`, `reuseOwned`) do not apply: they keep a machine out of the running line, not out of a one-off
 * job. Only whether a type is there is read.
 */
export function ownedForParts(ctx: PlanContext, settings: PlanSettings, steps: readonly PlanStep[]): Map<number, number> {
  const owned = new Map<number, number>();
  const add = (mteId: number, count: number): void => {
    if (count > 0) owned.set(mteId, (owned.get(mteId) ?? 0) + count);
  };
  for (const m of ctx.ownedMachines) add(m.mteId, m.count);
  for (const m of settings.ownedManual ?? []) add(m.mteId, m.count);
  for (const s of steps) add(s.machine.mteId, s.owned);
  return new Map([...owned].sort(([a], [b]) => a - b));
}

function tierOf(m: Machine): number {
  return m.tier ?? 0;
}

/**
 * The machine a one-off job of `r` on `mapId` runs on (architecture §11 entry 41 (1)): the crafting table for `crafting`,
 * the furnace for `furnace`; else, of the map's machines that run `r` at `groupTier` (`pickMachine`'s rule: a singleblock of
 * a tier at most `groupTier` whose `V[tier]` × the map's amps covers the recipe's EU/t, any multiblock of the map), the first
 * of: one the group has (`owned`; highest tier, then lowest mteId) → `owned`; one this line builds (`line`) and `exclude`
 * leaves in (highest tier, lowest mteId) → `line`; a singleblock not in `exclude` (lowest tier, lowest mteId: the cheapest
 * to build) → `new`; a multiblock not in `exclude` (one of `multiblocks` first, lowest mteId) → `new`; one of `exclude`
 * (lowest tier, lowest mteId) → `first`. Null when none runs it.
 */
export function partMachine(
  pack: Pack, r: Recipe, mapId: string,
  opts: { groupTier: number; owned: ReadonlyMap<number, number>; line: ReadonlySet<number>; exclude?: ReadonlySet<number>; multiblocks?: ReadonlySet<number> },
): BomMachine | 'crafting table' | null {
  if (mapId === 'crafting') return 'crafting table';
  if (mapId === 'furnace') return { mteId: PSEUDO_MACHINES.FURNACE, name: 'Furnace', tier: 0, source: 'owned' };
  const amps = pack.maps.get(mapId)?.amps ?? 1;
  const runs = (pack.machinesByMap.get(mapId) ?? []).flatMap((id) => pack.machines.get(id) ?? [])
    .filter((m) => m.kind === 'multiblock' || (m.kind === 'basic' && tierOf(m) <= opts.groupTier && (V[tierOf(m)] as number) * amps >= r.euPerTick));
  const exclude = opts.exclude ?? new Set<number>();
  const highest = (a: Machine, b: Machine): number => tierOf(b) - tierOf(a) || a.mteId - b.mteId;
  const lowest = (a: Machine, b: Machine): number => tierOf(a) - tierOf(b) || a.mteId - b.mteId;
  const as = (m: Machine | undefined, source: BomMachine['source']): BomMachine | undefined =>
    m === undefined ? undefined : { mteId: m.mteId, name: m.name, tier: tierOf(m), source };
  const multis = (list: Machine[]): Machine[] => list.filter((m) => m.kind === 'multiblock')
    .sort((a, b) => Number(!(opts.multiblocks?.has(a.mteId) ?? true)) - Number(!(opts.multiblocks?.has(b.mteId) ?? true)) || a.mteId - b.mteId);
  return as(runs.filter((m) => (opts.owned.get(m.mteId) ?? 0) > 0).sort(highest)[0], 'owned')
    ?? as(runs.filter((m) => opts.line.has(m.mteId) && !exclude.has(m.mteId)).sort(highest)[0], 'line')
    ?? as(runs.filter((m) => m.kind === 'basic' && !exclude.has(m.mteId)).sort(lowest)[0], 'new')
    ?? as(multis(runs.filter((m) => !exclude.has(m.mteId)))[0], 'new')
    ?? as(runs.filter((m) => exclude.has(m.mteId)).sort(lowest)[0], 'first')
    ?? null;
}

/** One run of a good's chosen recipe: how much of the good it makes and what it consumes. */
export interface PoolGood { perRun: number; inputs: ReadonlyArray<readonly [StuffKey, number]> }

/** The pooled make plan of a build list (`poolMakes`). */
export interface Pooled {
  /** Whole runs of every made good. */
  runs: Map<StuffKey, number>;
  /** What the whole list needs of every good. */
  demand: Map<StuffKey, number>;
  /** Goods that are not made: the pooled totals. */
  leaves: Map<StuffKey, number>;
  /** Leaf → top-level key → that top's exact share (fractional runs). */
  shares: Map<StuffKey, Map<StuffKey, number>>;
  /** [consumer, input] where the input was on the walk's stack, sorted (its demand there is gathered). */
  backEdges: Array<[StuffKey, StuffKey]>;
}

/**
 * The pooled make plan of a whole build list (architecture §11 entry 41 (4)): depth first from `tops` in order through
 * `made(key)?.inputs` (post order; an input already on the stack is a back edge, its demand gathered); every top's amount on
 * its key; then consumers first (the post order reversed) a made good with demand d above TINY runs ceil(d / perRun − TINY)
 * times and adds per-run × runs to each input's demand (a back edge's to `leaves`), and a good `made` gives null for adds
 * its d to `leaves`. Shares: the same walk from each top alone with fractional runs, adding each leaf amount to
 * `shares[leaf][top]`. Values `round9`.
 */
export function poolMakes(tops: ReadonlyArray<{ key: StuffKey; amount: number }>, made: (key: StuffKey) => PoolGood | null): Pooled {
  const order: StuffKey[] = [];
  const state = new Map<StuffKey, 'open' | 'done'>();
  const back = new Set<string>();
  const backEdges: Array<[StuffKey, StuffKey]> = [];
  const memo = new Map<StuffKey, PoolGood | null>();
  const madeOf = (key: StuffKey): PoolGood | null => {
    if (!memo.has(key)) memo.set(key, made(key));
    return memo.get(key) as PoolGood | null;
  };
  const visit = (key: StuffKey): void => {
    state.set(key, 'open');
    for (const [input] of madeOf(key)?.inputs ?? []) {
      const s = state.get(input);
      if (s === 'open') {
        const id = `${key}\u0000${input}`;
        if (!back.has(id)) {
          back.add(id);
          backEdges.push([key, input]);
        }
        continue;
      }
      if (s === undefined) visit(input);
    }
    state.set(key, 'done');
    order.push(key);
  };
  for (const t of tops) if (!state.has(t.key)) visit(t.key);
  const isBack = (from: StuffKey, to: StuffKey): boolean => back.has(`${from}\u0000${to}`);
  const pass = (start: ReadonlyArray<{ key: StuffKey; amount: number }>, whole: boolean): Pick<Pooled, 'runs' | 'demand' | 'leaves'> => {
    const demand = new Map<StuffKey, number>();
    const runs = new Map<StuffKey, number>();
    const leaves = new Map<StuffKey, number>();
    const add = (map: Map<StuffKey, number>, key: StuffKey, n: number): void => {
      map.set(key, (map.get(key) ?? 0) + n);
    };
    for (const t of start) add(demand, t.key, t.amount);
    for (const key of [...order].reverse()) {
      const d = demand.get(key) ?? 0;
      if (d <= TINY) continue;
      const m = madeOf(key);
      if (m === null) {
        add(leaves, key, d);
        continue;
      }
      const n = whole ? Math.ceil(d / m.perRun - TINY) : d / m.perRun;
      runs.set(key, n);
      for (const [input, per] of m.inputs) add(isBack(key, input) ? leaves : demand, input, per * n);
    }
    return { runs, demand, leaves };
  };
  const pooled = pass(tops, true);
  const shares = new Map<StuffKey, Map<StuffKey, number>>();
  for (const t of tops) {
    for (const [leaf, n] of pass([t], false).leaves) {
      const byTop = shares.get(leaf) ?? new Map<StuffKey, number>();
      byTop.set(t.key, round9((byTop.get(t.key) ?? 0) + n));
      shares.set(leaf, byTop);
    }
  }
  const rounded = (map: Map<StuffKey, number>): Map<StuffKey, number> => new Map([...map].map(([k, v]) => [k, round9(v)]));
  backEdges.sort(([a, b], [c, d]) => byString(a, c) || byString(b, d));
  return { runs: rounded(pooled.runs), demand: rounded(pooled.demand), leaves: rounded(pooled.leaves), shares, backEdges };
}

/** A part step of a build in the terms of its order (`orderJobs`). */
export interface OrderJob {
  key: StuffKey;
  /**
   * The order sorts by it, then by `name`, then by `key` (plain string order), and batches by it: a job's machine name,
   * `crafting table` for a craft, `''` for a part no job makes.
   */
  machineKey: string;
  name: string;
  /** The keys it waits for (`BomMake.after`); a key that is no job of the order holds nothing up. */
  waits: readonly StuffKey[];
  /** Those of `waits` that are its machine's: a `line` machine's own key and structure parts. */
  machineWaits: readonly StuffKey[];
}

/**
 * The order of a build's part steps (architecture §11 entry 41 (5); add-on 14 Task 5's order): Kahn's walk over the jobs'
 * waits, taking of the ready jobs the one with the machine key of the job just taken, else the smallest by machine key,
 * name and key. When nothing is ready while jobs remain — a cycle through machines this line builds — the smallest
 * remaining job whose unmet waits are all machine waits drops them: another machine of its type makes it, as the one
 * this line builds needs it first (`first`); when none qualifies — a cycle of material waits, which the breakdown never
 * makes, as `BomMake.after` leaves out back edges — the smallest remaining job drops all its waits. Every round takes one
 * job, so the walk always ends. `expandWith` runs it over its makes and gives each job of `first` a `first` machine where
 * `made` is set, so the build list and the steps say the same; `partSteps` runs it for the order of the steps.
 */
export function orderJobs(jobs: readonly OrderJob[]): { order: StuffKey[]; first: Set<StuffKey> } {
  const byKey = new Map<StuffKey, OrderJob>();
  for (const j of jobs) if (!byKey.has(j.key)) byKey.set(j.key, j);
  const waits = new Map([...byKey.values()].map((j) => [j.key, j.waits.filter((w) => byKey.has(w))]));
  const sorted = [...byKey.values()].sort((a, b) => byString(a.machineKey, b.machineKey) || byString(a.name, b.name) || byString(a.key, b.key));
  const done = new Set<StuffKey>();
  const order: StuffKey[] = [];
  const first = new Set<StuffKey>();
  const unmet = (j: OrderJob): StuffKey[] => (waits.get(j.key) as StuffKey[]).filter((w) => !done.has(w));
  let last: OrderJob | undefined;
  while (order.length < sorted.length) {
    const left = sorted.filter((j) => !done.has(j.key));
    const ready = left.filter((j) => unmet(j).length === 0);
    let pick = ready.find((j) => last !== undefined && j.machineKey === last.machineKey) ?? ready[0];
    if (pick === undefined) {
      pick = left.find((j) => unmet(j).every((w) => j.machineWaits.includes(w)));
      if (pick !== undefined) first.add(pick.key);
      else pick = left[0] as OrderJob;
    }
    done.add(pick.key);
    order.push(pick.key);
    last = pick;
  }
  return { order, first };
}
