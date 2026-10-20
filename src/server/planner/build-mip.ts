// The build-cost MIP (plan 12 Task 4; spec §3.3 Objective and "Reusing machines we have", architecture §11.39): inside
// `solveLine`, when build cost counts, it weighs the raw material a line consumes over the build horizon (Make N: the
// batch) against the raw material to build the machines it adds beyond those the group owns — whole new machines per
// sharing pool (with `BuildModel.share`, the steps of one machine option and sharing key share them; else every step has
// its own), all of one option per step, owned machines of every eligible option free beside them (an owned machine
// serves one sharing key), Make N's one added machine per type, the cleanroom as one more machine, and plan 09's step
// charge measured against the raw material with gathered world blocks dug, never below the charge on one raw unit, paid
// per new machine block (fix wave 2 (a): each new machine of a step or a sharing pool, an Auto Workbench included, once;
// owned machines none; a step by hand or on another pseudo machine once, a crafting-table one HAND_STEP_WEIGHT times). Its
// decision (`decode`, or `roundUp` of the LP relaxation or of S1 when the far time guard stops it) keeps the later stages
// within the machines it bought (`laterRoom`). The plan fix wave (controller ruling 183 (2)) made its node limit the
// one thing that decides it — no plan depends on time or load — and its model strong and small enough that its root node
// plans real lines within plan 09's 5 s: valid rows that bring the fixed costs of the steps a line cannot do without into
// the relaxation, a step whose machines one binary prices where that is exact up to one machine, no columns for options
// another builds for less, and a start from plan 09's sparse plan (`solveLine`).

import type { LpRecipe } from './candidates.ts';
import type { LpModel, LpRow } from './lp.ts';
import { poolKey, type BuildModel, type MachineOption } from './machine-options.ts';
import { sig9 } from './round.ts';
import { STEP_BIG_M, type MainLp } from './solve.ts';

/**
 * The build MIP stops after its root node (deterministic, as plan 09's STEP_MIP_MAX_NODES), with its best whole solution,
 * which may be the start. Measured on 26 lines of the 2.9 export (plan fix wave, load 3–6 of 16 cores): the root takes
 * 0.04–4 s and plans 15 of them at the model's proven optimum (Electronic Circuit MV, the user's line, Robot Arm MV among
 * them; the model prices a light step's machines as `Light` says), the others within 1.3–6.9 % of the optimum or best
 * known by the MIP's objective (the most on Microprocessor HV and the routed Electronic Circuit MV); 10 nodes cost up to
 * 7 s more on Good Electronic Circuit HV (strong branching), and 100 cheap ones found nothing better on the five largest
 * lines.
 */
export const BUILD_MIP_MAX_NODES = 1;
/**
 * The build MIP also stops once its simplex iterations reach this (deterministic, `LpModel.maxIterations`), so a root
 * node far larger than the real lines' — at most 32,000 iterations on 26 of them, 0.05–4 s — ends with the best plan it
 * has, the same one whatever the load, long before the time guard would throw it away. A lower bound cut roots short
 * mid-heuristics and left plans up to 28 % dearer by the MIP's objective (the user's line at HV and 0 % at 20,000).
 */
export const BUILD_MIP_MAX_LP_ITERATIONS = 50_000;
/**
 * A far safety net only, never what decides a plan (the node limit does): a MIP it stops is thrown away for the
 * relaxation rounded up, with the `build-cost-approx` warning. The real lines' root nodes take a tenth of it.
 */
export const BUILD_MIP_TIME_LIMIT_SECONDS = 30;

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
   * Per step of `machines`, the runs a second its machines do, unrounded: the bound `laterRoom` keeps for a step on the
   * machines of several holders. Their shares are rounded to 9 digits, and a bound a hair off the decision's runs made the
   * base stage buy the rest of a good (below) or run a step up to it and sell the surplus back as a purchase of −1e-8
   * inside HiGHS's tolerance (above).
   */
  capacity?: Map<string, number>;
  /** Per step of `machines` (rate mode), the holders of machines it runs on and how much of each, unrounded (`laterRoom`). */
  uses?: Map<string, HolderUse[]>;
}
/**
 * Machines a kept step runs on, of one holder (`BuildDecision.uses`): with `model.share` a sharing pool (its new machines
 * and the owned ones it holds), else the step's own machines of one option; `holder` is its pool key (`poolOf`), `fresh`
 * and `owned` the machines' worth of its new and owned machines the step uses (without sharing whole machines, `fresh`
 * the step's new count).
 */
export interface HolderUse { holder: string; option: MachineOption; fresh: number; owned: number }
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

/**
 * What a step recipe weighs beside its machines, in units of σ, so that among plans of equal raw material, builds and
 * machine blocks the one of fewest step recipes wins (two free routes on one shared machine run as one, plan 09's
 * fewest recipes as a tie-break): far below one raw unit over any horizon a line is planned for.
 */
const STEP_TIE_BREAK = 1e-6;

/** Whole machines for `load` machines' worth: none for none, else at least one (a running step needs a machine). */
function machinesFor(load: number): number {
  return load > 0 ? Math.max(1, Math.ceil(load - WHOLE)) : 0;
}

/** Whether new machines of `o` may be planned (and weighed). */
function adds(o: MachineOption): boolean {
  return o.canAdd && Number.isFinite(o.solveBuild);
}

/**
 * The build MIP's scale (`buildMip`): F = D × horizon (rate) or D (Make N), σ = max(s1g × F, 1) — the raw material one
 * unit of the objective stands for — k = s1 × F / σ (0 when s1 ≤ 1e-9), and `charge`, the step charge on one new machine
 * block in raw material, `stepCharge × σ` (fix wave 2 (a): the charge is paid per new machine block, not per step).
 */
interface Scale { F: number; sigma: number; k: number; charge: number }

function scaleOf(input: BuildMipInput): Scale {
  const D = input.demandScale;
  const F = input.model.mode === 'rate' ? D * (input.model.horizonSeconds ?? 0) : D;
  const sigma = Math.max(input.s1g * F, 1);
  return { F, sigma, k: input.s1 > TINY ? (input.s1 * F) / sigma : 0, charge: input.stepCharge * sigma };
}

/** What one new machine of `o` costs the MIP, in raw material: its build and the step charge on one machine block. */
function blockCost(o: MachineOption, charge: number): number {
  return o.solveBuild + charge;
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
 * step's own count, without `model.share`), the runs a second they do, unrounded (`BuildDecision.capacity`), and the
 * holders they belong to (`BuildDecision.uses`: `option`'s first, then the others in `others`' order).
 */
function stepMachines(model: BuildModel, use: StepUse, added: number): { m: StepMachines; capacity: number; uses: HolderUse[] } {
  const { step, option } = use;
  const share = model.share;
  const value = (v: number): number => (share ? sig9(v) : Math.round(v));
  let ownedLoad = 0;
  let capacity = option.perMachine * (share ? use.fresh : added);
  const main: HolderUse = { holder: poolOf(model, step.r.id, step.key, option), option, fresh: share ? use.fresh : added, owned: 0 };
  const others: Array<{ option: MachineOption; ownedLoad: number; capacity: number; use: HolderUse }> = [];
  for (const [u, v] of use.owned) {
    if (!(v > 0)) continue;
    capacity += u.o.perMachine * v;
    if (u.o === option) {
      ownedLoad = value(v);
      main.owned += v;
    } else {
      others.push({ option: u.o, ownedLoad: value(v), capacity: u.o.perMachine * v, use: { holder: u.pool, option: u.o, fresh: 0, owned: v } });
    }
  }
  others.sort((a, b) => b.capacity - a.capacity || a.option.mteId - b.option.mteId);
  const m: StepMachines = share
    ? { option, added: 0, newLoad: use.fresh > 0 ? sig9(use.fresh) : 0, pool: poolKey(option, step.key), ownedLoad }
    : { option, added, newLoad: added, ownedLoad };
  if (others.length > 0) m.others = others.map(({ option: o, ownedLoad: load }) => ({ option: o, ownedLoad: load }));
  const uses = [...(main.fresh > 0 || main.owned > 0 ? [main] : []), ...others.map((o) => o.use)];
  return { m, capacity, uses };
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

/**
 * `roundUp` (below), with the columns it fills. A step runs when `x` gives it more than `floor` runs per unit of demand
 * (TINY for a decision; 0 for a MIP start, which must give every step it runs a machine: its step binary is 1 there).
 */
function allocate(input: BuildMipInput, x: readonly number[], prefer?: (j: number) => number | undefined, floor = TINY): Allocation {
  const { model } = input;
  const D = input.demandScale;
  const { charge } = scaleOf(input);
  const steps = stepsOf(input);
  const kept = (j: number): boolean => (x[j] ?? 0) > floor;
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

  const eps = floor * D;
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
        return blockCost(u.o, charge) * (machinesFor(before + r / u.o.perMachine) - machinesFor(before));
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
  const holders = new Map<string, HolderUse[]>();
  for (const use of uses) {
    const pool = poolOf(model, use.step.r.id, use.step.key, use.option);
    const entry = stepMachines(model, use, use.fresh > 0 ? alloc.added.get(pool) ?? 0 : 0);
    machines.set(use.step.r.id, entry.m);
    capacity.set(use.step.r.id, entry.capacity);
    holders.set(use.step.r.id, entry.uses);
  }
  alloc.decision.capacity = capacity;
  alloc.decision.uses = holders;
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
 * the least to its pool, each new machine at its build and the step charge on its block (`blockCost`; ties: more runs
 * a second, lower mteId) — whose pool then has the whole machines its
 * steps' load needs (at least one for any load). A step with runs left and no option that can add is `short`;
 * `machines` lists the steps in id order. Make N: an owned option (highest tier, then lowest mteId), else a type an
 * earlier step added, else the option with the lowest build (then most runs a second, lowest mteId). Runs per second up
 * to 1e-9 × D count as none (per unit of target).
 */
export function roundUp(input: BuildMipInput, x: readonly number[], prefer?: (j: number) => number | undefined): BuildDecision {
  return allocate(input, x, prefer).decision;
}

/**
 * What the later stages may run on (`laterRoom`; rate mode, nothing in Make N): the decision's machines per holder, and
 * what may grow for nothing in the tie stage (`withoutTiedPurchases`, solve.ts).
 */
export interface LaterRoom {
  /**
   * The rows: per holder of machines its steps' runs within its machines plus `grants` (whole owned machines more),
   * `Σ_j D·x_j / ρ_j ≤ machines + grant − what steps on several holders take of it` over the steps that run on it alone;
   * per step on several holders its runs within what its machines do, unrounded (`BuildDecision.capacity`).
   */
  rows(grants?: ReadonlyMap<string, number>): LpRow[];
  /**
   * `grants`, and for the holder of each step column of `makers` that runs on one holder and may grow for nothing what it
   * may take more: the owned machines of its type that neither the decision nor `grants` uses, whole. Steps by column; the
   * first takes all of a type's. A new machine never comes for nothing (fix wave 2 (a): its block pays the step charge,
   * whatever it costs to build), so only owned ones grow a holder here.
   */
  widen(makers: readonly number[], grants: ReadonlyMap<string, number>): Map<string, number>;
  /** `grants` cut to the whole machines `x` uses beyond each holder's own (left out where it uses no more). */
  trim(grants: ReadonlyMap<string, number>, x: readonly number[]): Map<string, number>;
}

/** One holder of `laterRoom`: its option, its machines (whole), what steps on several holders take of it, its other steps. */
interface Holder {
  key: string; option: MachineOption; machines: number; fixed: number; fresh: number; owned: number;
  simple: Array<{ j: number; perMachine: number }>;
}

/**
 * The machines a decision leaves the later stages (rate mode; none in Make N, whose machines bound no runs), per holder
 * (`HolderUse`): with `model.share` a sharing pool — its new machines (`pools`' count) and the owned ones it holds
 * (whole: an owned machine serves one sharing key) — so the steps of a pool share all its room as the build MIP let them
 * (each step's own share of it held the base and the tie stage to the decision's split, and a tie its pool had room for
 * went to buying); without, each step's own machines of one option. A step on several holders (owned machines of another
 * option beside its own, `others`) keeps what its machines do. In the tie stage a holder may grow for nothing (`widen`):
 * by the owned machines of its type the decision leaves idle, a whole number of them (`trim`), so the plan's own machine
 * assignment (machines.ts `assignOwned`) adds no new machine — every new one pays the step charge on its block (fix
 * wave 2 (a); 1c794df also let it grow by machines that build for nothing).
 */
export function laterRoom(input: BuildMipInput, decision: BuildDecision): LaterRoom {
  const { lp, model } = input;
  const D = input.demandScale;
  if (model.mode !== 'rate') return { rows: () => [], widen: (_, grants) => new Map(grants), trim: () => new Map() };
  const holders = new Map<string, Holder>();
  const holderOf = new Map<number, Holder>();
  const bounded: Array<{ j: number; capacity: number }> = [];
  const hold = (use: HolderUse): Holder => {
    let h = holders.get(use.holder);
    if (h === undefined) holders.set(use.holder, (h = { key: use.holder, option: use.option, machines: 0, fixed: 0, fresh: 0, owned: 0, simple: [] }));
    h.fresh += use.fresh;
    h.owned += use.owned;
    return h;
  };
  lp.recipes.forEach((r, j) => {
    const m = decision.machines.get(r.id);
    if (m === undefined || !decision.support.has(j)) return;
    const uses = decision.uses?.get(r.id) ?? [];
    const only = uses.length === 1 ? (uses[0] as HolderUse) : undefined;
    if (only !== undefined) {
      const h = hold(only);
      h.simple.push({ j, perMachine: only.option.perMachine });
      holderOf.set(j, h);
      return;
    }
    for (const use of uses) hold(use).fixed += use.fresh + use.owned;
    let capacity = decision.capacity?.get(r.id);
    if (capacity === undefined) {
      capacity = m.option.perMachine * (m.newLoad + m.ownedLoad);
      for (const o of m.others ?? []) capacity += o.option.perMachine * o.ownedLoad;
    }
    bounded.push({ j, capacity });
  });
  /** Per type, the owned machines the holders use. */
  const held = new Map<number, number>();
  for (const h of holders.values()) {
    h.machines = (model.share ? (decision.pools.get(h.key)?.added ?? 0) : h.fresh) + machinesFor(h.owned);
    held.set(h.option.mteId, (held.get(h.option.mteId) ?? 0) + machinesFor(h.owned));
  }
  /** What `h` may take more for nothing beside `grants`: the owned machines of its type nobody uses. */
  const freeFor = (h: Holder, grants: ReadonlyMap<string, number>): number => {
    let given = held.get(h.option.mteId) ?? 0;
    for (const [key, g] of grants) if (holders.get(key)?.option.mteId === h.option.mteId) given += g;
    return Math.max(0, ownedOf(model, h.option) - given);
  };
  return {
    rows: (grants = new Map()) => {
      const rows: LpRow[] = [];
      for (const key of [...holders.keys()].sort(byString)) {
        const h = holders.get(key) as Holder;
        if (h.simple.length === 0) continue;
        const room = h.machines + (grants.get(key) ?? 0) - h.fixed;
        const one = h.simple.length === 1 ? (h.simple[0] as { j: number; perMachine: number }) : undefined;
        rows.push(one !== undefined
          ? { lower: -Infinity, upper: one.perMachine * room, entries: [[one.j, D]] }
          : { lower: -Infinity, upper: room, entries: h.simple.map((s): [number, number] => [s.j, D / s.perMachine]) });
      }
      for (const b of bounded) rows.push({ lower: -Infinity, upper: b.capacity, entries: [[b.j, D]] });
      return rows;
    },
    widen: (makers, grants) => {
      const out = new Map(grants);
      for (const j of [...makers].sort((a, b) => a - b)) {
        const h = holderOf.get(j);
        if (h === undefined) continue;
        const more = freeFor(h, out);
        if (more >= 1) out.set(h.key, (out.get(h.key) ?? 0) + Math.floor(more));
      }
      return out;
    },
    trim: (grants, x) => {
      const out = new Map<string, number>();
      for (const [key, grant] of grants) {
        const h = holders.get(key);
        if (h === undefined || !(grant > 0)) continue;
        let used = h.fixed;
        for (const s of h.simple) used += (D * (x[s.j] ?? 0)) / s.perMachine;
        const over = used - h.machines;
        if (over > WHOLE) out.set(key, Math.min(grant, Math.ceil(over - WHOLE)));
      }
      return out;
    },
  };
}

/** One (step, option) pair of the MIP: its pool and its columns of new (`a`) and owned (`q`) machines and its option binary (`w`). */
interface Member { u: Usable; cap: number /* X·D/ρ: the most machines' worth it may use */; a?: number; q?: number; w?: number }
interface Pool { key: string; option: MachineOption; members: Member[]; n?: number; u?: number }

/**
 * A step whose machines the MIP prices from their builds alone (`layoutOf`: rate mode without sharing, no owned option,
 * S1's runs within one machine of its fastest option), each machine at its build and the step charge on its block
 * (`blockCost`, called its build here): its first machine at the build S1's runs need (`first`, on its
 * step binary: `cheapestAdd`'s machines for them; the least build of its options where S1 runs it not at all), more runs
 * at the least build per run a second of its options (`perRun`) on a continuous column `e`, so `max(first, perRun ×
 * runs)`. That is what its machines cost at S1's runs and, where S1's runs fit one machine of its option that builds
 * one for least, at any runs up to that machine's; elsewhere it is off by less than one machine's build (above at fewer
 * runs than S1's, below at more), so the model, its optimum and its bound hold for this pricing, and `buildMip`'s
 * `exactCost` re-prices a decision. Pricing such a step at the least build alone made one that needs a dearer, faster machine look cheaper than
 * a rival it is not; giving every step whose S1 runs pass one machine of its least-build option per-option columns
 * instead left the root node a harder model and worse plans (Microprocessor HV avoiding Diamond 16 % dearer).
 */
interface Light { first: number; perRun: number; e: number; step: Step }

/** The MIP's columns and rows, and where each part of the model sits. */
interface Layout {
  sigma: number /* σ: the raw material one unit of the objective stands for */;
  charge: number /* the step charge on one new machine block, in raw material (`Scale`) */;
  steps: Step[]; members: Map<number, Member[]>; light: Map<number, Light>; pools: Map<string, Pool>;
  z: Map<number, number> /* Make N: mteId → column */; y: Map<number, number> /* step column → column */; c?: number;
  derived: Array<{ j: number; col: number; weight: number }>;
  colCost: number[]; colUpper: number[]; integer: boolean[]; rows: LpRow[];
}

/**
 * Whether new machines of `o` always cost no more than those of `other`, whatever runs a step gives them, so a MIP whose
 * steps have their own new machines (rate mode without sharing) never needs `other`'s: `o` is at least as fast and no
 * dearer, one of the two strictly; or `other` is a whole number r ≥ 2 of times as fast and dearer than r of `o` (r of
 * `o` then do the work of one of `other` for less) — a machine's cost being its build and the step charge on its block
 * (`blockCost`), so r machines pay r charges. `roundUp` never picks such an `other` either: it takes the option that
 * adds the least of that cost to the step, then the faster.
 */
function cheaperToAdd(o: MachineOption, other: MachineOption, charge: number): boolean {
  if (o.perMachine >= other.perMachine && o.solveBuild <= other.solveBuild) return o.perMachine > other.perMachine || o.solveBuild < other.solveBuild;
  const ratio = other.perMachine / o.perMachine;
  const whole = Math.round(ratio);
  return whole >= 2 && Math.abs(ratio - whole) <= WHOLE * ratio && blockCost(o, charge) * whole < blockCost(other, charge);
}

/**
 * With sharing, the pools whose new machines another pool always builds for less (`cheaperToAdd`'s rule for whole
 * pools, each machine at its build and the step charge on its block): every step that could add machines to the pool
 * could add them to that other pool too, a whole number r ≥ 1 of the other's machines do the work of one of its own for
 * each of them, and r of the other cost less than one of its own (with r = 1: no dearer and slower for none, one of the
 * two strictly). Moving a solution's new loads from such a pool to the other never costs more (ceil(a + b) ≤ ceil(a) +
 * ceil(b)), so the MIP gives it no new-machine columns, and `roundUp`, which takes the option that adds the least of
 * that cost, never puts load there either.
 */
function outdonePools(steps: readonly Step[], charge: number): Set<string> {
  const byPool = new Map<string, Array<{ step: Step; u: Usable }>>();
  for (const step of steps) for (const u of step.usable) if (adds(u.o)) pushTo(byPool, u.pool, { step, u });
  /** A pool's build per machine in the MIP: the dearest of its members' options. */
  const buildOf = new Map([...byPool].map(([key, members]) => [key, Math.max(...members.map(({ u }) => u.o.solveBuild))]));
  const outdone = new Set<string>();
  for (const [key, members] of byPool) {
    const first = members[0] as { step: Step; u: Usable };
    const others = new Set(first.step.usable.filter((v) => v !== first.u && adds(v.o)).map((v) => v.pool));
    for (const other of [...others].sort(byString)) {
      if (other === key) continue;
      let ratio = 0;
      let cheapest = Infinity;
      let strict = false;
      const covered = members.every(({ step, u }) => {
        const v = step.usable.find((w) => w.pool === other && adds(w.o));
        if (v === undefined) return false;
        ratio = Math.max(ratio, u.o.perMachine / v.o.perMachine);
        cheapest = Math.min(cheapest, u.o.solveBuild);
        strict ||= v.o.perMachine > u.o.perMachine;
        return true;
      });
      if (!covered) continue;
      const dearest = buildOf.get(other) ?? Infinity;
      const whole = Math.max(1, Math.ceil(ratio - WHOLE * ratio));
      if (whole === 1 ? dearest < cheapest || (dearest <= cheapest && strict) : (dearest + charge) * whole < cheapest + charge) {
        outdone.add(key);
        break;
      }
    }
  }
  return outdone;
}

/** Of two options at one build, whether `u` comes before `best`: the faster, then the lower mteId, tier and index. */
function before(u: Usable, best: Usable): boolean {
  return (u.o.perMachine - best.o.perMachine || best.o.mteId - u.o.mteId || best.o.tier - u.o.tier || best.index - u.index) > 0;
}

/**
 * The new machines `r` runs a second of a step take when they are all of one option and none is owned: the option whose
 * machines cost least, each at its build and the step charge on its block (`blockCost`), then the fastest, the lower
 * mteId, tier and index (`roundUp`'s choice), and how many.
 */
function cheapestAdd(step: Step, r: number, charge: number): { u: Usable; added: number } | undefined {
  let best: { u: Usable; added: number; cost: number } | undefined;
  for (const u of step.usable) {
    if (!adds(u.o)) continue;
    const added = machinesFor(r / u.o.perMachine);
    const cost = blockCost(u.o, charge) * added;
    if (best === undefined || cost < best.cost || (cost === best.cost && before(u, best.u))) best = { u, added, cost };
  }
  return best === undefined ? undefined : { u: best.u, added: best.added };
}

/**
 * Per good row of the main LP, the step recipes (columns) that can supply the good when the line cannot buy it: the
 * ones that make it, and for an ore-dictionary slot's good (only conversions make it) the ones that supply an option it
 * converts; null when the line can buy it or an option it converts from (then no step need run for it).
 */
function suppliersOf(lp: MainLp): Array<Set<number> | null> {
  const rowOf = new Map(lp.goods.map((key, g) => [key, g]));
  const out: Array<Set<number> | null | undefined> = lp.goods.map(() => undefined);
  const supply = (g: number, open: Set<number>): Set<number> | null => {
    const known = out[g];
    if (known !== undefined) return known;
    if (open.has(g)) return new Set();   // a conversion cycle supplies nothing new
    const row = lp.rows[g] as LpRow;
    let found: Set<number> | null = new Set<number>();
    open.add(g);
    for (const [j, c] of row.entries) {
      if (j >= lp.firstBuy && j < lp.firstSink) {
        found = null;
        break;
      }
      const r = j < lp.firstBuy ? lp.recipes[j] : undefined;
      if (r === undefined || !(c > 0)) continue;
      if (r.kind === 'recipe') {
        found.add(j);
        continue;
      }
      for (const [key, coefficient] of r.coeffs) {
        const h = rowOf.get(key);
        if (!(coefficient < 0) || h === undefined) continue;
        const from = supply(h, open);
        if (from === null) {
          found = null;
          break;
        }
        for (const i of from) found.add(i);
      }
      if (found === null) break;
    }
    open.delete(g);
    out[g] = found;
    return found;
  };
  return lp.goods.map((_, g) => supply(g, new Set()));
}

/** The MIP's layout; R3's derived-purchase binaries only `withDerived` (`buildMip`). */
function layoutOf(input: BuildMipInput, withDerived: boolean): Layout {
  const { lp, model } = input;
  const D = input.demandScale;
  const width = lp.rawCost.length;
  const rate = model.mode === 'rate';
  const { F, sigma, k, charge } = scaleOf(input);
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
  // `model.share`, the owned machines it holds. An option whose new machines another of the step's options always builds
  // for less (`cheaperToAdd`; with sharing a whole pool another pool outdoes, `outdonePools`) gets none.
  const members = new Map<number, Member[]>();
  const light = new Map<number, Light>();
  const pools = new Map<string, Pool>();
  /** Without sharing, a step none of whose options is owned and whose S1 runs fit one machine of its fastest option. */
  const isLight = (step: Step): boolean => {
    if (model.share || step.usable.some((u) => u.o.owned > 0)) return false;
    let fastest = 0;
    for (const u of step.usable) if (adds(u.o)) fastest = Math.max(fastest, u.o.perMachine);
    return fastest > 0 && (input.x1[step.j] ?? 0) * D <= fastest * (1 + WHOLE);
  };
  if (rate) {
    const byPool = new Map<string, Member[]>();
    const outdone = model.share ? outdonePools(steps, charge) : new Set<string>();
    for (const step of steps) {
      if (isLight(step)) {
        let first = Infinity;
        let perRun = Infinity;
        for (const u of step.usable) {
          if (!adds(u.o)) continue;
          first = Math.min(first, blockCost(u.o, charge));
          perRun = Math.min(perRun, blockCost(u.o, charge) / u.o.perMachine);
        }
        const atS1 = (input.x1[step.j] ?? 0) > TINY ? cheapestAdd(step, (input.x1[step.j] ?? 0) * D, charge) : undefined;
        if (atS1 !== undefined) first = blockCost(atS1.u.o, charge) * atS1.added;
        light.set(step.j, { first, perRun, e: column(1 / sigma, Infinity, false), step });
        continue;
      }
      const list: Member[] = [];
      for (const u of step.usable) {
        const member: Member = { u, cap: (X * D) / u.o.perMachine };
        const beaten = model.share ? outdone.has(u.pool) : step.usable.some((v) => v !== u && adds(v.o) && cheaperToAdd(v.o, u.o, charge));
        if (adds(u.o) && !beaten) member.a = column(0, member.cap, false);
        if (u.o.owned > 0) member.q = column(0, u.o.owned, !model.share);
        if (member.a === undefined && member.q === undefined) continue;
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
        pool.n = column((build + charge) / sigma, most, true);
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

  // One binary per step recipe, 1 where it runs. The step charge is paid per new machine block (fix wave 2 (a): on a
  // pool's new machines, a light step's machines and Make N's added types above; owned machines pay none), so a step's
  // binary carries it only where the step runs on no machine the MIP counts — by hand or on another pseudo machine —
  // once, a crafting-table step `handWeight` times; every one carries the fewest-recipes tie-break.
  const y = new Map<number, number>();
  for (const s of steps) {
    const first = light.get(s.j)?.first ?? 0;
    const pseudo = s.usable.length === 0 ? input.stepCharge * (s.r.mapId === 'crafting' ? input.handWeight : 1) : 0;
    const col = column(pseudo + STEP_TIE_BREAK + first / sigma, 1, true);
    y.set(s.j, col);
    rows.push({ lower: -Infinity, upper: 0, entries: [[s.j, 1], [col, -X]] });
  }
  // A light step's build: its first machine on its binary, and `e` ≥ the build of its runs at the least build per run a
  // second, less that first machine.
  for (const [j, l] of light) {
    if (l.perRun > 0) rows.push({ lower: -Infinity, upper: 0, entries: [[j, l.perRun * D], [y.get(j) as number, -l.first], [l.e, -1]] });
  }

  // Make N: one binary per type a step without an owned option could add, shared by every step that can use it, at its
  // build and the step charge on one machine block; a step that runs has one of its types.
  const z = new Map<number, number>();
  if (!rate) {
    const builds = new Map<number, number>();
    const addable = steps.filter((s) => s.options.length > 0 && ownedPick(s.options) === undefined);
    for (const s of addable) for (const o of s.options) if (adds(o)) builds.set(o.mteId, Math.max(builds.get(o.mteId) ?? 0, o.solveBuild));
    for (const mteId of [...builds.keys()].sort((a, b) => a - b)) z.set(mteId, column(((builds.get(mteId) as number) + charge) / sigma, 1, true));
    for (const s of addable) {
      const types = [...new Set(s.options.filter(adds).map((o) => o.mteId))];
      if (types.length > 0) rows.push({ lower: -Infinity, upper: 0, entries: [[y.get(s.j) as number, 1], ...types.map((m): [number, number] => [z.get(m) as number, -1])] });
    }
  }

  // Valid rows that hold in every whole solution worth having, where a step's binary is 1 exactly where it runs (one at 1
  // that runs nothing only costs): they bring the fixed costs of the steps a plan cannot do without into the relaxation,
  // which otherwise spreads them over runs far below one machine's. (a) A step that runs needs a machine: one of its
  // pools' new machines or an owned one it may use (not written for a step on owned machines its pool always has). (b)
  // A step that runs and takes a good the line cannot buy needs a step that supplies it (`suppliersOf`), and some
  // supplier of each demanded good runs.
  if (rate) {
    for (const s of steps) {
      const list = members.get(s.j) ?? [];
      if (list.length === 0) continue;
      const entries: Array<[number, number]> = [[y.get(s.j) as number, 1]];
      let always = false;
      for (const m of list) {
        const pool = pools.get(m.u.pool) as Pool;
        if (m.a !== undefined) entries.push([pool.n as number, -1]);
        if (m.q === undefined) continue;
        if (!model.share) entries.push([m.q, -1]);
        else if (pool.u !== undefined) entries.push([pool.u, -1]);
        else always = true;
      }
      if (!always) rows.push({ lower: -Infinity, upper: 0, entries });
    }
  }
  const supply = suppliersOf(lp);
  const rowOf = new Map(lp.goods.map((key, g) => [key, g]));
  for (const s of steps) {
    for (const [key, coefficient] of s.r.coeffs) {
      if (!(coefficient < 0)) continue;
      const from = supply[rowOf.get(key) ?? -1];
      if (from === null || from === undefined) continue;
      const others = [...from].filter((i) => i !== s.j && y.has(i)).sort((a, b) => a - b);
      rows.push({ lower: -Infinity, upper: 0, entries: [[y.get(s.j) as number, 1], ...others.map((i): [number, number] => [y.get(i) as number, -1])] });
    }
  }
  lp.rows.forEach((row, g) => {
    const from = supply[g];
    if (!(row.lower > 0) || from === null || from === undefined) return;
    rows.push({ lower: 1, upper: Infinity, entries: [...from].filter((i) => y.has(i)).sort((a, b) => a - b).map((i): [number, number] => [y.get(i) as number, 1]) });
  });

  // The cleanroom, when the group owns none and a step needs one: a step that runs needs it.
  const room = model.cleanroom;
  const clean = steps.filter((s) => s.r.needsCleanroom);
  let c: number | undefined;
  if (room !== null && room.owned === 0 && clean.length > 0) {
    c = column(room.solveBuild / sigma, 1, true);
    for (const s of clean) rows.push({ lower: -Infinity, upper: 0, entries: [[y.get(s.j) as number, 1], [c, -1]] });
  }

  // R3's derived purchases with a price (their rows wait for the start's objective, `buildMip`).
  const derived = !withDerived ? []
    : input.derived.filter((d) => (colCost[d.j] ?? 0) > 0).map((d) => ({ j: d.j, col: column(d.weight, 1, true), weight: d.weight }));

  const layout: Layout = { sigma, charge, steps, members, light, pools, z, y, derived, colCost, colUpper, integer, rows };
  if (c !== undefined) layout.c = c;
  return layout;
}

/**
 * The MIP start of the runs `x` (main columns at unit demand) and their allocation `alloc` (`allocate` with floor 0:
 * every step `x` runs at all has machines, as its binary is 1); undefined when a step's new machines are of an option
 * the MIP gives none (`cheaperToAdd`; `roundUp` itself never picks one, but machine counts a hair above a whole number).
 */
function startOf(layout: Layout, width: number, x: readonly number[], alloc: Allocation, D: number): number[] | undefined {
  const start = new Array<number>(layout.colCost.length).fill(0);
  for (let j = 0; j < width; j++) start[j] = Math.max(0, x[j] ?? 0);
  for (const [j, list] of layout.members) {
    const owned = alloc.owned.get(j);
    const fresh = alloc.fresh.get(j);
    let placed = fresh === undefined;
    for (const m of list) {
      if (m.q !== undefined) start[m.q] = owned?.get(m.u.index) ?? 0;
      if (fresh === undefined || fresh.index !== m.u.index || m.a === undefined) continue;
      start[m.a] = fresh.load;
      if (m.w !== undefined) start[m.w] = 1;
      placed = true;
    }
    if (!placed) return undefined;
  }
  for (const pool of layout.pools.values()) {
    if (pool.n !== undefined) start[pool.n] = alloc.added.get(pool.key) ?? 0;
    if (pool.u !== undefined) start[pool.u] = alloc.held.get(pool.key) ?? 0;
  }
  for (const [mteId, col] of layout.z) start[col] = alloc.types.has(mteId) ? 1 : 0;
  for (const [j, col] of layout.y) start[col] = (x[j] ?? 0) > 0 ? 1 : 0;
  for (const [j, l] of layout.light) start[l.e] = Math.max(0, l.perRun * D * Math.max(0, x[j] ?? 0) - l.first * (start[layout.y.get(j) as number] ?? 0));
  if (layout.c !== undefined) start[layout.c] = layout.steps.some((s) => s.r.needsCleanroom && (x[s.j] ?? 0) > 0) ? 1 : 0;
  for (const d of layout.derived) start[d.col] = (x[d.j] ?? 0) > 0 ? 1 : 0;
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
  const uses: Array<{ use: StepUse; pool: Pool | undefined; added?: number }> = [];
  for (const step of layout.steps) {
    if (layout.light.has(step.j)) {
      // Its machines from its runs: as many of the option whose machines cost least as they need.
      const r = (x[step.j] ?? 0) * D;
      const pick = kept(step.j) ? cheapestAdd(step, r, layout.charge) : undefined;
      if (pick !== undefined) uses.push({ use: { step, option: pick.u.o, fresh: pick.added, owned: new Map() }, pool: undefined, added: pick.added });
      continue;
    }
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
  const holders = new Map<string, HolderUse[]>();
  for (const { use, pool, added } of uses) {
    const entry = stepMachines(model, use, added ?? (pool === undefined ? 0 : addedOf(pool.key)));
    machines.set(use.step.r.id, entry.m);
    capacity.set(use.step.r.id, entry.capacity);
    holders.set(use.step.r.id, entry.uses);
  }
  const c = layout.c;
  return {
    support, machines, pools: model.share ? poolsOf(machines, addedOf) : new Map(), capacity, uses: holders,
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
 * horizon) plus each new machine's build and step charge (`blockCost`) / σ — so a new machine block costs
 * `stepCharge × σ` raw beside its build — per pool whole new machines over the steps' new loads, owned machines free
 * (whole per step without sharing; with it per pool, one sharing key per owned machine), one load row per step, one
 * option for a step's new machines, Make N's one machine per type, one binary per step where it runs (with the step
 * charge × its weight as its cost only for a step on no machine the MIP counts, by hand or on another pseudo machine,
 * and the fewest-recipes tie-break `STEP_TIE_BREAK` on every one), the cleanroom and R3's
 * derived-purchase binaries (`M_d` = what a plan no dearer than the start can buy of it), and the valid rows of
 * `layoutOf` that tie the steps' binaries to their machines and to the steps that supply what they take. `start` =
 * `roundUp(input, x1)` in the columns (every step S1 runs at all with machines); `startAt(x)` the same for other runs,
 * with its objective; `decode` reads a whole solution's decision; `prefer` gives, per step column, the option with the
 * most new capacity in `x` (the relaxation's), for `roundUp`; `exactCost` is the objective of a whole solution with its
 * light steps (`Light`) at the build and charge of the machines `decode` gives them, from which the model's own objective
 * may be off by less than a machine each. When `roundUp(input, x1)` leaves a step short, that start
 * is no plan (`start` is undefined), so its objective bounds no purchase, and nothing else does soundly (a step with no
 * machine options and no step charge has no bound of its own): the MIP, and so its relaxation, then has no
 * derived-purchase binaries, which only break ties among equally cheap plans.
 */
export function buildMip(input: BuildMipInput): {
  model: LpModel; start: number[] | undefined; startCost: number; startAt(x: readonly number[]): { start: number[]; cost: number } | undefined;
  decode(x: readonly number[]): BuildDecision; prefer(x: readonly number[]): (j: number) => number | undefined;
  exactCost(x: readonly number[]): number;
} {
  const width = input.lp.rawCost.length;
  const first = allocate(input, input.x1, undefined, 0);
  const layout = layoutOf(input, first.decision.short === undefined);
  const costOf = (start: readonly number[]): number => {
    let cost = 0;
    layout.colCost.forEach((c, col) => {
      cost += c * (start[col] ?? 0);
    });
    return cost;
  };
  const start = first.decision.short === undefined ? startOf(layout, width, input.x1, first, input.demandScale) : undefined;
  const startCost = start === undefined ? Infinity : costOf(start);
  if (start === undefined) {
    for (const d of layout.derived) layout.colUpper[d.col] = 0;   // no start bounds them: no binaries (doc above)
  } else {
    for (const d of layout.derived) {
      const bigM = (startCost / (layout.colCost[d.j] as number)) * (1 + BIG_M_SLACK) + TINY;
      layout.rows.push({ lower: -Infinity, upper: 0, entries: [[d.j, 1], [d.col, -bigM]] });
    }
  }
  const model: LpModel = {
    sense: 'min', colCost: layout.colCost, colLower: new Array<number>(layout.colCost.length).fill(0), colUpper: layout.colUpper, rows: layout.rows,
    integer: layout.integer,
  };
  return {
    model, start, startCost,
    startAt: (x) => {
      const alloc = allocate(input, x, undefined, 0);
      const at = alloc.decision.short === undefined ? startOf(layout, width, x, alloc, input.demandScale) : undefined;
      return at === undefined ? undefined : { start: at, cost: costOf(at) };
    },
    decode: (x) => (input.model.mode === 'rate' ? decodeRate(input, layout, x) : decodeMakeN(input, layout, x)),
    exactCost: (x) => {
      let cost = costOf(x);
      for (const [j, l] of layout.light) {
        const runs = x[j] ?? 0;
        const pick = runs > TINY ? cheapestAdd(l.step, runs * input.demandScale, layout.charge) : undefined;
        const truth = pick === undefined ? 0 : blockCost(pick.u.o, layout.charge) * pick.added;
        cost += (truth - l.first * (x[layout.y.get(j) as number] ?? 0) - (x[l.e] ?? 0)) / layout.sigma;
      }
      return cost;
    },
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
