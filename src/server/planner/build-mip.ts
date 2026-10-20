// The build-cost MIP (plan 12 Task 4; spec §3.3 Objective and "Reusing machines we have", architecture §11.39): inside
// `solveLine`, when build cost counts, it weighs the raw material a line consumes over the build horizon (Make N: the
// batch) against the raw material to build the machines it adds beyond those the group owns — whole new machines per
// sharing pool (with `BuildModel.share`, the steps of one machine option and sharing key share them; else every step has
// its own), all of one option per step, owned machines of every eligible option free beside them (an owned machine
// serves one sharing key), Make N's one added machine per type, the cleanroom as one more machine, and plan 09's step
// charge measured against the raw material with gathered world blocks dug, never below the charge on one raw unit. Its
// decision (`decode`, or `roundUp` of the LP relaxation or of S1 when the MIP does not end in time) keeps the later
// stages within the machines it bought (`capacityRows`).

import type { LpRecipe } from './candidates.ts';
import type { LpModel, LpRow } from './lp.ts';
import { poolKey, type BuildModel, type MachineOption } from './machine-options.ts';
import { sig9 } from './round.ts';
import { STEP_BIG_M, type MainLp } from './solve.ts';

/** The build MIP stops after this many branch-and-bound nodes (deterministic); Task 8 sets it from the measured lines. */
export const BUILD_MIP_MAX_NODES = 200;
/** A hang guard only: a MIP this stops is thrown away for the relaxation rounded up (`build-cost-approx`). */
export const BUILD_MIP_TIME_LIMIT_SECONDS = 2;

/**
 * Values up to this count as zero: runs per unit of demand (`MainLp`'s unit), and so runs per second up to this times
 * the demand scale (per unit of target, as every threshold of the solver is).
 */
const TINY = 1e-9;
/** A machine count this little above a whole number stays whole (machines.ts: an exact 2 stays 2). */
const WHOLE = 1e-9;
/** The slack of a derived purchase's big-M (S3_TOLERANCE in solve.ts). */
const BIG_M_SLACK = 1e-6;

export interface StepMachines {
  /** The option the step's new machines are of; with none new, the owned option giving it the most capacity. */
  option: MachineOption;
  added: number /* new machines of `option` for this step alone (Make N: 1 on an added type); 0 with `model.share`, where its pool holds them */;
  /** Machines' worth of new capacity of `option` it uses: `added` without `model.share`, its share of the pool's new machines with it. */
  newLoad: number;
  /** With `model.share`: the sharing pool (`poolKey(option, sharingKey)`) its machines belong to. */
  pool?: string;
  ownedLoad: number /* owned machines of `option` it may use: whole machines in direct mode, a share when shared */;
  /** Owned machines of the step's other options it also runs on (rate mode), largest capacity first; absent when none. */
  others?: Array<{ option: MachineOption; ownedLoad: number }>;
}
export interface BuildDecision {
  support: Set<number> /* main recipe columns kept */; machines: Map<string, StepMachines>; cleanroom: boolean;
  /** With `model.share` (empty without): per sharing pool its option, its new machines and the kept steps on it, sorted. */
  pools: Map<string, { option: MachineOption; added: number; steps: string[] }>;
  /**
   * `roundUp` only: the kept steps left with runs no machine covers — steps that can only use owned machines, whose
   * type's owned machines other such steps took (`solveLine` ends the line with `owned-only` warnings); absent when none.
   */
  short?: string[];
  /**
   * Per step of `machines`, the runs a second its machines do, unrounded: `capacityRows`' bound. Their shares are rounded
   * to 9 digits, and a bound a hair off the decision's runs made the base stage buy the rest of a good (below) or run a
   * step up to it and sell the surplus back as a purchase of −1e-8 inside HiGHS's tolerance (above).
   */
  capacity?: Map<string, number>;
}
export interface BuildMipInput {
  lp: MainLp; x1: readonly number[]; s1: number;
  /** The least raw material per unit of demand with gathered world blocks dug (`solveLine`, below); `s1` on a graph without `alsoMade` goods. */
  s1g: number;
  /** Per main column, R3's relative cost: rawCost / s1 + tie-breaks + canonical rank (unused when s1 ≤ 1e-9). */
  columnCost: readonly number[];
  /** R3's bought derived leaves with a price: their purchase column and weight (the big-M is the build MIP's own, below). */
  derived: ReadonlyArray<{ j: number; weight: number }>;
  demandScale: number /* D: actual demand = unit demand × D */; model: BuildModel; stepCharge: number; handWeight: number;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Whole machines for `load` machines' worth: none for none, else at least one (a running step needs a machine). */
function machinesFor(load: number): number {
  return load > 0 ? Math.max(1, Math.ceil(load - WHOLE)) : 0;
}

/** Whether new machines of `o` may be planned (and weighed). */
function adds(o: MachineOption): boolean {
  return o.canAdd && Number.isFinite(o.solveBuild);
}

/** One option of a step that can run it (`perMachine` above 0), its index in `model.options(id)` and its pool. */
interface Usable { o: MachineOption; index: number; pool: string }
/** A step recipe of the main LP (`kind: 'recipe'`) with its options and sharing key. */
interface Step { j: number; r: LpRecipe; options: readonly MachineOption[]; key: string; usable: Usable[] }

/** The pool of a step on `o`: `poolKey(o, key)` with `model.share`, else one of its own. */
function poolOf(model: BuildModel, id: string, key: string, o: MachineOption): string {
  return model.share ? poolKey(o, key) : `${id}#${o.mteId}:${o.tier}`;
}

/** The step recipes of `input.lp`, in column (id) order. */
function stepsOf(input: BuildMipInput): Step[] {
  const { lp, model } = input;
  const steps: Step[] = [];
  lp.recipes.forEach((r, j) => {
    if (r.kind !== 'recipe') return;
    const options = model.options(r.id);
    const key = model.sharingKey(r.id);
    const usable: Usable[] = [];
    options.forEach((o, index) => {
      if (o.perMachine > 0 && Number.isFinite(o.perMachine)) usable.push({ o, index, pool: poolOf(model, r.id, key, o) });
    });
    steps.push({ j, r, options, key, usable });
  });
  return steps;
}

/** The owned machines of `o`'s type (`model.owned`, else the option's own count). */
function ownedOf(model: BuildModel, o: MachineOption): number {
  return model.owned.get(o.mteId) ?? o.owned;
}

/** Owned options in the order their machines are used: the most runs a second first, then the lower mteId. */
function byCapacity(a: Usable, b: Usable): number {
  return b.o.perMachine - a.o.perMachine || a.o.mteId - b.o.mteId;
}

/** The higher tier, then the lower mteId, first. */
function byTierDown(a: MachineOption, b: MachineOption): number {
  return b.tier - a.tier || a.mteId - b.mteId;
}

/** Make N's pick among options: the lowest build, then the most runs a second, then the lowest mteId. */
function byBuildUp(a: MachineOption, b: MachineOption): number {
  return a.solveBuild - b.solveBuild || b.perMachine - a.perMachine || a.mteId - b.mteId;
}

/** Make N's owned pick: the highest tier, then the lowest mteId. */
function ownedPick(options: readonly MachineOption[]): MachineOption | undefined {
  return options.filter((o) => o.owned > 0).sort(byTierDown)[0];
}

/** The rate-mode entry of one step: its option, its new load (machines' worth), its owned use per option. */
interface StepUse { step: Step; option: MachineOption; fresh: number /* new machines' worth of `option` */; owned: Map<Usable, number> }

/**
 * The rate-mode `StepMachines` of a step, from its owned use per option and its new load of `option` (`added` is the
 * step's own count, without `model.share`), and the runs a second they do, unrounded (`BuildDecision.capacity`).
 */
function stepMachines(model: BuildModel, use: StepUse, added: number): { m: StepMachines; capacity: number } {
  const { step, option } = use;
  const share = model.share;
  const value = (v: number): number => (share ? sig9(v) : Math.round(v));
  let ownedLoad = 0;
  let capacity = option.perMachine * (share ? use.fresh : added);
  const others: Array<{ option: MachineOption; ownedLoad: number; capacity: number }> = [];
  for (const [u, v] of use.owned) {
    if (!(v > 0)) continue;
    capacity += u.o.perMachine * v;
    if (u.o === option) ownedLoad = value(v);
    else others.push({ option: u.o, ownedLoad: value(v), capacity: u.o.perMachine * v });
  }
  others.sort((a, b) => b.capacity - a.capacity || a.option.mteId - b.option.mteId);
  const m: StepMachines = share
    ? { option, added: 0, newLoad: use.fresh > 0 ? sig9(use.fresh) : 0, pool: poolKey(option, step.key), ownedLoad }
    : { option, added, newLoad: added, ownedLoad };
  if (others.length > 0) m.others = others.map(({ option: o, ownedLoad: load }) => ({ option: o, ownedLoad: load }));
  return { m, capacity };
}

/** A step's option with no new load: the owned one giving it the most capacity (ties: higher tier, lower mteId), else the highest tier. */
function ownedMain(step: Step, owned: ReadonlyMap<Usable, number>): MachineOption {
  let best: { o: MachineOption; capacity: number } | undefined;
  for (const [u, v] of owned) {
    if (!(v > 0)) continue;
    const capacity = u.o.perMachine * v;
    if (best === undefined || capacity > best.capacity || (capacity === best.capacity && byTierDown(u.o, best.o) < 0)) best = { o: u.o, capacity };
  }
  return best?.o ?? ([...step.usable].map((u) => u.o).sort(byTierDown)[0] as MachineOption);
}

/** The decision's `pools` (with `model.share`) from the kept steps' entries, sorted by pool key, each pool's steps by id. */
function poolsOf(
  machines: ReadonlyMap<string, StepMachines>, addedOf: (pool: string) => number,
): Map<string, { option: MachineOption; added: number; steps: string[] }> {
  const byPool = new Map<string, Array<[string, StepMachines]>>();
  for (const [id, m] of machines) if (m.pool !== undefined) pushTo(byPool, m.pool, [id, m]);
  const pools = new Map<string, { option: MachineOption; added: number; steps: string[] }>();
  for (const key of [...byPool.keys()].sort(byString)) {
    const members = (byPool.get(key) as Array<[string, StepMachines]>).sort(([a], [b]) => byString(a, b));
    pools.set(key, { option: (members[0] as [string, StepMachines])[1].option, added: addedOf(key), steps: members.map(([id]) => id) });
  }
  return pools;
}

/** Whether a cleanroom is built: the model has one the group does not own and a kept step needs it. */
function cleanroomNeeded(model: BuildModel, steps: readonly Step[], kept: (j: number) => boolean): boolean {
  return model.cleanroom !== null && model.cleanroom.owned === 0 && steps.some((s) => s.r.needsCleanroom && kept(s.j));
}

/** What `roundUp` allocates, beside its decision: the columns of the MIP start. */
interface Allocation {
  decision: BuildDecision;
  /** Per step column: owned machines' worth per option (by its index in `model.options(id)`), and one option's new load. */
  owned: Map<number, Map<number, number>>;
  fresh: Map<number, { index: number; load: number }>;
  /** Per pool: its new machines, and (with `model.share`) the owned machines it holds. */
  added: Map<string, number>;
  held: Map<string, number>;
  /** Make N: the types it adds. */
  types: Set<number>;
}

/** `roundUp` (below), with the columns it fills. */
function allocate(input: BuildMipInput, x: readonly number[], prefer?: (j: number) => number | undefined): Allocation {
  const { model } = input;
  const D = input.demandScale;
  const steps = stepsOf(input);
  const kept = (j: number): boolean => (x[j] ?? 0) > TINY;
  const support = new Set(steps.filter((s) => kept(s.j)).map((s) => s.j));
  const machines = new Map<string, StepMachines>();
  const short: string[] = [];
  const alloc: Allocation = {
    decision: { support, machines, cleanroom: cleanroomNeeded(model, steps, kept), pools: new Map() },
    owned: new Map(), fresh: new Map(), added: new Map(), held: new Map(), types: new Set(),
  };
  const preferred = (step: Step, among: readonly MachineOption[]): MachineOption | undefined => {
    const index = prefer?.(step.j);
    const o = index === undefined ? undefined : step.options[index];
    return o !== undefined && among.includes(o) ? o : undefined;
  };

  if (model.mode === 'makeN') {
    for (const step of steps) {
      if (!kept(step.j) || step.options.length === 0) continue;
      const owned = ownedPick(step.options);
      if (owned !== undefined) {
        machines.set(step.r.id, { option: owned, added: 0, newLoad: 0, ownedLoad: owned.owned });
        continue;
      }
      const choices = step.options.filter(adds);
      const again = choices.filter((o) => alloc.types.has(o.mteId));
      const pick = preferred(step, choices) ?? [...(again.length > 0 ? again : choices)].sort(byBuildUp)[0];
      if (pick === undefined) {
        short.push(step.r.id);
        continue;
      }
      alloc.types.add(pick.mteId);
      machines.set(step.r.id, { option: pick, added: 1, newLoad: 1, ownedLoad: 0 });
    }
    if (short.length > 0) alloc.decision.short = short;
    return alloc;
  }

  const eps = TINY * D;
  const free = new Map<number, number>();   // per mteId: owned machines no pool holds (direct: none taken yet)
  const used = new Map<string, number>();   // per pool: owned machines' worth its steps use
  const load = new Map<string, number>();   // per pool: new machines' worth its steps use
  const uses: StepUse[] = [];
  // The steps none of whose options can add machines take their owned ones first, then the others, each group in id
  // order: a step that can add machines would otherwise take an owned machine such a step needs and leave it short.
  const addsNone = (step: Step): boolean => !step.usable.some((u) => adds(u.o));
  for (const step of [...steps.filter(addsNone), ...steps.filter((s) => !addsNone(s))]) {
    if (!kept(step.j) || step.usable.length === 0) continue;
    let r = (x[step.j] ?? 0) * D;
    const owned = new Map<Usable, number>();
    for (const u of step.usable.filter((v) => v.o.owned > 0).sort(byCapacity)) {
      if (!(r > eps)) break;
      const m = u.o.mteId;
      const rho = u.o.perMachine;
      const left = free.get(m) ?? ownedOf(model, u.o);
      let t: number;
      if (model.share) {
        const room = (alloc.held.get(u.pool) ?? 0) - (used.get(u.pool) ?? 0);
        t = Math.min(room + left, r / rho);
        if (!(t > 0)) continue;
        if (t > room) {
          const join = Math.min(left, machinesFor(t - room));
          alloc.held.set(u.pool, (alloc.held.get(u.pool) ?? 0) + join);
          free.set(m, left - join);
        } else {
          free.set(m, left);
        }
        used.set(u.pool, (used.get(u.pool) ?? 0) + t);
      } else {
        t = Math.min(left, machinesFor(r / rho));
        if (!(t > 0)) continue;
        free.set(m, left - t);
      }
      owned.set(u, (owned.get(u) ?? 0) + t);
      r = Math.max(0, r - t * rho);
    }
    alloc.owned.set(step.j, new Map([...owned].map(([u, t]) => [u.index, t])));
    let fresh = 0;
    let option: MachineOption | undefined;
    if (r > eps) {
      const choices = step.usable.filter((u) => adds(u.o));
      const want = preferred(step, choices.map((u) => u.o));
      const cost = (u: Usable): number => {
        const before = load.get(u.pool) ?? 0;
        return u.o.solveBuild * (machinesFor(before + r / u.o.perMachine) - machinesFor(before));
      };
      const pick = want !== undefined ? choices.find((u) => u.o === want)
        : [...choices].sort((a, b) => cost(a) - cost(b) || b.o.perMachine - a.o.perMachine || a.o.mteId - b.o.mteId || a.o.tier - b.o.tier || a.index - b.index)[0];
      if (pick === undefined) {
        short.push(step.r.id);
      } else {
        fresh = r / pick.o.perMachine;
        option = pick.o;
        load.set(pick.pool, (load.get(pick.pool) ?? 0) + fresh);
        alloc.fresh.set(step.j, { index: pick.index, load: fresh });
      }
    }
    uses.push({ step, option: option ?? ownedMain(step, owned), fresh, owned });
  }
  uses.sort((a, b) => a.step.j - b.step.j);   // `machines` in id order
  for (const [pool, l] of load) alloc.added.set(pool, machinesFor(l));
  const capacity = new Map<string, number>();
  for (const use of uses) {
    const pool = poolOf(model, use.step.r.id, use.step.key, use.option);
    const entry = stepMachines(model, use, use.fresh > 0 ? alloc.added.get(pool) ?? 0 : 0);
    machines.set(use.step.r.id, entry.m);
    capacity.set(use.step.r.id, entry.capacity);
  }
  alloc.decision.capacity = capacity;
  if (model.share) alloc.decision.pools = poolsOf(machines, (pool) => alloc.added.get(pool) ?? 0);
  if (short.length > 0) alloc.decision.short = short;
  return alloc;
}

/**
 * Whole machines for the runs `x` (main columns, at unit demand) gives each step recipe, without a MIP: the MIP's start
 * (from S1) and the deterministic fallback (from the LP relaxation, or S1) when the MIP does not end in time. Step
 * recipes with `x_j > 1e-9`, runs `r = x_j·D`, first the steps none of whose options can add machines and then the
 * others, each group in id order (so a step that can add machines never takes an owned machine that a step which cannot
 * add needs; among the latter, id order may still leave one short where each has owned machines of several types):
 * first the owned capacity, options with owned machines by runs a second descending then lower mteId, each taking
 * `min(left, r/ρ)` machines' worth (with `model.share`: `left` = the room in the owned machines its pool holds plus the
 * machines of its type no pool holds yet, which then join its pool) or that many whole machines (without), then the rest
 * as new capacity of one option — `prefer(j)` (an index in `model.options(id)`) when it can add, else the one that adds
 * the least build to its pool (ties: more runs a second, lower mteId) — whose pool then has the whole machines its
 * steps' load needs (at least one for any load). A step with runs left and no option that can add is `short`;
 * `machines` lists the steps in id order. Make N: an owned option (highest tier, then lowest mteId), else a type an
 * earlier step added, else the option with the lowest build (then most runs a second, lowest mteId). Runs per second up
 * to 1e-9 × D count as none (per unit of target).
 */
export function roundUp(input: BuildMipInput, x: readonly number[], prefer?: (j: number) => number | undefined): BuildDecision {
  return allocate(input, x, prefer).decision;
}

/**
 * The later stages' rows (rate mode): per kept step with machines, its runs at most what they do —
 * `D·x_j ≤ ρ_option·(newLoad + ownedLoad) + Σ_others ρ_o·ownedLoad_o`, unrounded (`BuildDecision.capacity`) — so, with
 * `model.share`, each step keeps the share of its pool the decision gave it and no stage runs a pool past its machines.
 */
export function capacityRows(input: BuildMipInput, decision: BuildDecision): LpRow[] {
  if (input.model.mode !== 'rate') return [];
  const rows: LpRow[] = [];
  input.lp.recipes.forEach((r, j) => {
    const m = decision.machines.get(r.id);
    if (m === undefined || !decision.support.has(j)) return;
    let capacity = decision.capacity?.get(r.id);
    if (capacity === undefined) {
      capacity = m.option.perMachine * (m.newLoad + m.ownedLoad);
      for (const o of m.others ?? []) capacity += o.option.perMachine * o.ownedLoad;
    }
    rows.push({ lower: -Infinity, upper: capacity, entries: [[j, input.demandScale]] });
  });
  return rows;
}

/** One (step, option) pair of the MIP: its pool and its columns of new (`a`) and owned (`q`) machines and its option binary (`w`). */
interface Member { u: Usable; cap: number /* X·D/ρ: the most machines' worth it may use */; a?: number; q?: number; w?: number }
interface Pool { key: string; option: MachineOption; members: Member[]; n?: number; u?: number }

/** The MIP's columns and rows, and where each part of the model sits. */
interface Layout {
  steps: Step[]; members: Map<number, Member[]>; pools: Map<string, Pool>;
  z: Map<number, number> /* Make N: mteId → column */; y: Map<number, number> /* step column → column */; c?: number;
  derived: Array<{ j: number; col: number; weight: number }>;
  colCost: number[]; colUpper: number[]; integer: boolean[]; rows: LpRow[];
}

/** The MIP's layout; R3's derived-purchase binaries only `withDerived` (`buildMip`). */
function layoutOf(input: BuildMipInput, withDerived: boolean): Layout {
  const { lp, model } = input;
  const D = input.demandScale;
  const width = lp.rawCost.length;
  const rate = model.mode === 'rate';
  const F = rate ? D * (model.horizonSeconds ?? 0) : D;
  const sigma = Math.max(input.s1g * F, 1);
  const k = input.s1 > TINY ? (input.s1 * F) / sigma : 0;
  let largest = 0;
  for (let j = 0; j < lp.firstBuy; j++) largest = Math.max(largest, input.x1[j] ?? 0);
  const X = STEP_BIG_M * largest;

  const colCost = input.s1 > TINY
    ? lp.rawCost.map((_, j) => k * (input.columnCost[j] ?? 0))
    : lp.rawCost.map((c) => (F * c) / sigma);
  const colUpper = [...lp.upper];
  const integer = new Array<boolean>(width).fill(false);
  const column = (cost: number, upper: number, whole: boolean): number => {
    colCost.push(cost);
    colUpper.push(upper);
    integer.push(whole);
    return colCost.length - 1;
  };
  const rows: LpRow[] = [...lp.rows];
  const steps = stepsOf(input);

  // Rate mode: new and owned machines per (step, option), the option binaries, then per pool its new machines and, with
  // `model.share`, the owned machines it holds.
  const members = new Map<number, Member[]>();
  const pools = new Map<string, Pool>();
  if (rate) {
    const byPool = new Map<string, Member[]>();
    for (const step of steps) {
      const list: Member[] = [];
      for (const u of step.usable) {
        const member: Member = { u, cap: (X * D) / u.o.perMachine };
        if (adds(u.o)) member.a = column(0, member.cap, false);
        if (u.o.owned > 0) member.q = column(0, u.o.owned, !model.share);
        list.push(member);
        pushTo(byPool, u.pool, member);
      }
      const adders = list.filter((m) => m.a !== undefined);
      if (adders.length >= 2) {
        for (const m of adders) m.w = column(0, 1, true);
        rows.push({ lower: -Infinity, upper: 1, entries: adders.map((m): [number, number] => [m.w as number, 1]) });
        for (const m of adders) rows.push({ lower: -Infinity, upper: 0, entries: [[m.a as number, 1], [m.w as number, -m.cap]] });
      }
      members.set(step.j, list);
    }
    for (const key of [...byPool.keys()].sort(byString)) {
      const list = byPool.get(key) as Member[];
      const pool: Pool = { key, option: (list[0] as Member).u.o, members: list };
      const adders = list.filter((m) => m.a !== undefined);
      if (adders.length > 0) {
        let most = 0;
        let build = 0;
        for (const m of adders) {
          most += Math.ceil(m.cap);
          build = Math.max(build, m.u.o.solveBuild);
        }
        pool.n = column(build / sigma, most, true);
        rows.push({ lower: -Infinity, upper: 0, entries: [...adders.map((m): [number, number] => [m.a as number, 1]), [pool.n, -1]] });
      }
      pools.set(key, pool);
    }
    // Owned machines: per type, whole machines per step without sharing; with it, per pool of the type the owned
    // machines it holds (a column when two or more pools of the type have steps, else all of them).
    const byType = new Map<number, Pool[]>();
    for (const pool of pools.values()) if (pool.members.some((m) => m.q !== undefined)) pushTo(byType, pool.option.mteId, pool);
    for (const mteId of [...byType.keys()].sort((a, b) => a - b)) {
      const typePools = byType.get(mteId) as Pool[];
      const total = ownedOf(model, (typePools[0] as Pool).option);
      const owners = typePools.flatMap((p) => p.members.filter((m) => m.q !== undefined));
      if (!model.share) {
        rows.push({ lower: -Infinity, upper: total, entries: owners.map((m): [number, number] => [m.q as number, 1]) });
        continue;
      }
      const several = typePools.length >= 2;
      for (const pool of typePools) {
        const entries = pool.members.flatMap((m): Array<[number, number]> => (m.q === undefined ? [] : [[m.q, 1]]));
        if (several) pool.u = column(0, total, true);
        rows.push({ lower: -Infinity, upper: several ? 0 : total, entries: several ? [...entries, [pool.u as number, -1]] : entries });
      }
      if (several) rows.push({ lower: -Infinity, upper: total, entries: typePools.map((p): [number, number] => [p.u as number, 1]) });
    }
    // One load row per step: its runs within the new and owned machines it uses.
    for (const step of steps) {
      const list = members.get(step.j) ?? [];
      if (list.length === 0) continue;
      const entries: Array<[number, number]> = [[step.j, D]];
      for (const m of list) {
        if (m.a !== undefined) entries.push([m.a, -m.u.o.perMachine]);
        if (m.q !== undefined) entries.push([m.q, -m.u.o.perMachine]);
      }
      rows.push({ lower: -Infinity, upper: 0, entries });
    }
  }

  // Make N: one binary per type a step without an owned option could add, shared by every step that can use it.
  const z = new Map<number, number>();
  if (!rate) {
    const builds = new Map<number, number>();
    const addable = steps.filter((s) => s.options.length > 0 && ownedPick(s.options) === undefined);
    for (const s of addable) for (const o of s.options) if (adds(o)) builds.set(o.mteId, Math.max(builds.get(o.mteId) ?? 0, o.solveBuild));
    for (const mteId of [...builds.keys()].sort((a, b) => a - b)) z.set(mteId, column((builds.get(mteId) as number) / sigma, 1, true));
    for (const s of addable) {
      const types = [...new Set(s.options.filter(adds).map((o) => o.mteId))];
      if (types.length > 0) rows.push({ lower: -Infinity, upper: 0, entries: [[s.j, 1], ...types.map((m): [number, number] => [z.get(m) as number, -X])] });
    }
  }

  // The step charge: one binary per step recipe, a crafting-table one weighing `handWeight`.
  const y = new Map<number, number>();
  if (input.stepCharge > 0) {
    for (const s of steps) {
      const col = column(input.stepCharge * (s.r.mapId === 'crafting' ? input.handWeight : 1), 1, true);
      y.set(s.j, col);
      rows.push({ lower: -Infinity, upper: 0, entries: [[s.j, 1], [col, -X]] });
    }
  }

  // The cleanroom, when the group owns none and a step needs one.
  const room = model.cleanroom;
  const clean = steps.filter((s) => s.r.needsCleanroom);
  let c: number | undefined;
  if (room !== null && room.owned === 0 && clean.length > 0) {
    c = column(room.solveBuild / sigma, 1, true);
    for (const s of clean) rows.push({ lower: -Infinity, upper: 0, entries: [[s.j, 1], [c, -X]] });
  }

  // R3's derived purchases with a price (their rows wait for the start's objective, `buildMip`).
  const derived = !withDerived ? []
    : input.derived.filter((d) => (colCost[d.j] ?? 0) > 0).map((d) => ({ j: d.j, col: column(d.weight, 1, true), weight: d.weight }));

  const layout: Layout = { steps, members, pools, z, y, derived, colCost, colUpper, integer, rows };
  if (c !== undefined) layout.c = c;
  return layout;
}

/** The MIP start: `roundUp(input, x1)` written into the columns. */
function startOf(input: BuildMipInput, layout: Layout, alloc: Allocation): number[] {
  const start = new Array<number>(layout.colCost.length).fill(0);
  const x1 = input.x1;
  for (let j = 0; j < input.lp.rawCost.length; j++) start[j] = Math.max(0, x1[j] ?? 0);
  for (const [j, list] of layout.members) {
    const owned = alloc.owned.get(j);
    const fresh = alloc.fresh.get(j);
    for (const m of list) {
      if (m.q !== undefined) start[m.q] = owned?.get(m.u.index) ?? 0;
      if (fresh !== undefined && fresh.index === m.u.index) {
        if (m.a !== undefined) start[m.a] = fresh.load;
        if (m.w !== undefined) start[m.w] = 1;
      }
    }
  }
  for (const pool of layout.pools.values()) {
    if (pool.n !== undefined) start[pool.n] = alloc.added.get(pool.key) ?? 0;
    if (pool.u !== undefined) start[pool.u] = alloc.held.get(pool.key) ?? 0;
  }
  for (const [mteId, col] of layout.z) start[col] = alloc.types.has(mteId) ? 1 : 0;
  for (const [j, col] of layout.y) start[col] = (x1[j] ?? 0) > 0 ? 1 : 0;
  if (layout.c !== undefined) start[layout.c] = layout.steps.some((s) => s.r.needsCleanroom && (x1[s.j] ?? 0) > 0) ? 1 : 0;
  for (const d of layout.derived) start[d.col] = (x1[d.j] ?? 0) > 0 ? 1 : 0;
  return start;
}

/** The decision of a whole solution `x` of the MIP (rate mode), each step's columns trimmed to what its runs use. */
function decodeRate(input: BuildMipInput, layout: Layout, x: readonly number[]): BuildDecision {
  const { model } = input;
  const D = input.demandScale;
  const eps = TINY * D;
  const kept = (j: number): boolean => (x[j] ?? 0) > TINY;
  const support = new Set(layout.steps.filter((s) => kept(s.j)).map((s) => s.j));
  const machines = new Map<string, StepMachines>();
  const freshByPool = new Map<string, number>();
  const uses: Array<{ use: StepUse; pool: Pool | undefined }> = [];
  for (const step of layout.steps) {
    const list = layout.members.get(step.j) ?? [];
    if (!kept(step.j) || list.length === 0) continue;
    // The MIP's machine columns cost nothing beside their pool's machines, so a vertex may give a step more than it
    // needs; it keeps what its runs use, owned machines first, in `roundUp`'s order (whole ones without sharing).
    let left = (x[step.j] ?? 0) * D;
    const owned = new Map<Usable, number>();
    for (const m of list.filter((v) => v.q !== undefined).sort((a, b) => byCapacity(a.u, b.u))) {
      if (!(left > eps)) break;
      const q = x[m.q as number] ?? 0;
      if (!(q > TINY)) continue;
      const rho = m.u.o.perMachine;
      const use = model.share ? Math.min(q, left / rho) : Math.min(Math.round(q), machinesFor(left / rho));
      if (!(use > 0)) continue;
      owned.set(m.u, use);
      left = Math.max(0, left - use * rho);
    }
    // New capacity: the option with some (at most one with two or more options that can add, the `w` binaries).
    let fresh: { m: Member; a: number } | undefined;
    for (const m of list) {
      const a = m.a === undefined ? 0 : (x[m.a] ?? 0);
      if (a > TINY && (fresh === undefined || a > fresh.a)) fresh = { m, a };
    }
    const load = fresh !== undefined && left > eps ? Math.min(fresh.a, left / fresh.m.u.o.perMachine) : 0;
    const option = load > 0 && fresh !== undefined ? fresh.m.u.o : ownedMain(step, owned);
    const pool = load > 0 && fresh !== undefined ? layout.pools.get(fresh.m.u.pool) : undefined;
    if (pool !== undefined) freshByPool.set(pool.key, (freshByPool.get(pool.key) ?? 0) + load);
    uses.push({ use: { step, option, fresh: load, owned }, pool });
  }
  // A pool's new machines: its count, never more than its steps' loads need (a free machine's count is otherwise loose).
  const addedOf = (key: string): number => {
    const n = layout.pools.get(key)?.n;
    return n === undefined ? 0 : Math.min(Math.round(x[n] ?? 0), machinesFor(freshByPool.get(key) ?? 0));
  };
  const capacity = new Map<string, number>();
  for (const { use, pool } of uses) {
    const entry = stepMachines(model, use, pool === undefined ? 0 : addedOf(pool.key));
    machines.set(use.step.r.id, entry.m);
    capacity.set(use.step.r.id, entry.capacity);
  }
  const c = layout.c;
  return {
    support, machines, pools: model.share ? poolsOf(machines, addedOf) : new Map(), capacity,
    cleanroom: c !== undefined && (x[c] ?? 0) >= 0.5 && cleanroomNeeded(model, layout.steps, kept),
  };
}

/** The decision of a whole solution `x` of the MIP in Make N. */
function decodeMakeN(input: BuildMipInput, layout: Layout, x: readonly number[]): BuildDecision {
  const { model } = input;
  const kept = (j: number): boolean => (x[j] ?? 0) > TINY;
  const support = new Set(layout.steps.filter((s) => kept(s.j)).map((s) => s.j));
  const machines = new Map<string, StepMachines>();
  for (const step of layout.steps) {
    if (!kept(step.j) || step.options.length === 0) continue;
    const owned = ownedPick(step.options);
    if (owned !== undefined) {
      machines.set(step.r.id, { option: owned, added: 0, newLoad: 0, ownedLoad: owned.owned });
      continue;
    }
    const choices = step.options.filter(adds);
    const added = choices.filter((o) => (x[layout.z.get(o.mteId) ?? -1] ?? 0) >= 0.5);
    const pick = [...(added.length > 0 ? added : choices)].sort(byBuildUp)[0];
    if (pick !== undefined) machines.set(step.r.id, { option: pick, added: 1, newLoad: 1, ownedLoad: 0 });
  }
  const c = layout.c;
  return { support, machines, pools: new Map(), cleanroom: c !== undefined && (x[c] ?? 0) >= 0.5 && cleanroomNeeded(model, layout.steps, kept) };
}

/**
 * The build-cost MIP over the main LP (main columns first, as in `MainLp`; the plan's model, `BuildMipInput` and the
 * spec's Objective). With D the demand scale, F = D × horizon (rate) or D (Make N), σ = max(s1g × F, 1) and
 * k = s1 × F / σ, it minimizes `k × columnCost` on the main columns (with s1 ≤ 1e-9: F × rawCost / σ, the raw over the
 * horizon) plus each new machine's build / σ, per pool whole new machines over the steps' new loads, owned machines free
 * (whole per step without sharing; with it per pool, one sharing key per owned machine), one load row per step, one
 * option for a step's new machines, Make N's one machine per type, the step charge (`stepCharge` × its weight, so a step
 * costs `stepCharge × σ` raw), the cleanroom and R3's derived-purchase binaries (`M_d` = what a plan no dearer than the
 * start can buy of it). `start` = `roundUp(input, x1)` in the columns; `decode` reads a whole solution's decision;
 * `prefer` gives, per step column, the option with the most new capacity in `x` (the relaxation's), for `roundUp`.
 * When `roundUp(input, x1)` leaves a step short, that start is no plan (`solveLine` does not pass it), so its objective
 * bounds no purchase, and nothing else does soundly (a step with no machine options and no step charge has no bound of
 * its own): the MIP, and so its relaxation, then has no derived-purchase binaries, which only break ties among equally
 * cheap plans.
 */
export function buildMip(input: BuildMipInput): {
  model: LpModel; start: number[]; decode(x: readonly number[]): BuildDecision; prefer(x: readonly number[]): (j: number) => number | undefined;
} {
  const first = allocate(input, input.x1);
  const layout = layoutOf(input, first.decision.short === undefined);
  const start = startOf(input, layout, first);
  let startCost = 0;
  layout.colCost.forEach((c, col) => {
    startCost += c * (start[col] ?? 0);
  });
  for (const d of layout.derived) {
    const bigM = (startCost / (layout.colCost[d.j] as number)) * (1 + BIG_M_SLACK) + TINY;
    layout.rows.push({ lower: -Infinity, upper: 0, entries: [[d.j, 1], [d.col, -bigM]] });
  }
  const width = layout.colCost.length;
  const model: LpModel = {
    sense: 'min', colCost: layout.colCost, colLower: new Array<number>(width).fill(0), colUpper: layout.colUpper, rows: layout.rows,
    integer: layout.integer,
  };
  return {
    model, start,
    decode: (x) => (input.model.mode === 'rate' ? decodeRate(input, layout, x) : decodeMakeN(input, layout, x)),
    prefer: (x) => (j) => {
      let best: { index: number; capacity: number } | undefined;
      for (const m of layout.members.get(j) ?? []) {
        const capacity = m.a === undefined ? 0 : m.u.o.perMachine * (x[m.a] ?? 0);
        if (capacity > TINY * input.demandScale && (best === undefined || capacity > best.capacity)) best = { index: m.u.index, capacity };
      }
      return best?.index;
    },
  };
}
