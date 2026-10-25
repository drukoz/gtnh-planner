// Plan invariants (from the planner audit, plan 09): checks a finished `Plan` the way a group reading it would, from what
// the plan itself says (steps, flows, raw inputs, byproducts), with tolerances fit for floating LP output (relative 1e-6
// by default) and the 9 significant digits plan values keep.
//
//   (a) balance       per good: produced (Σ step outputs × runs/s, chances as expected values) + bought (rawInputs)
//                     ≥ consumed + target demand; `orphan-input`: a consumed good no step makes and no raw input buys
//   (b) flow          PlanFlow edges agree with the steps (net per step and good), raw inputs, the target and byproducts
//   (c) multi-producer a good made by two or more recipes, with the rates (the deep check says whether one can go);
//                     `bought-and-made`: a good both bought and made by a step
//   (d) machines      count ≥ runs/s × duration(s) / parallel after overclocking, utilization ≤ 1, OC recomputed
//   (e) raw-source    every raw input available, with a leaf class and a source; derived sources whose text names a
//                     filled container of the good itself (a round trip)
//   (f) byproduct     byproducts listed = net surplus of every good (and nothing else)
//   (g) free-detour   a chain of steps that only converts free inputs (water, lava, air, cobblestone and what is made
//                     of them alone) into something that is itself directly a base or gathered material, with the raw
//                     cost it saves
//
// `checkPlanInvariants` is synchronous and reads only the pack, the settings and the plan (plus the basis the planner
// derives from them). `checkPlanInvariantsDeep` adds what needs the LP: an independent least-raw-material optimum of the
// line's own candidate graph (solved at a normalized demand, so HiGHS tolerances cannot hand out goods), and for every
// multi-producer / bought-and-made good whether the plan still works at the same raw cost without one of its sources.
// With `buildCost` (plan 12) the checks that assume plan 09's objective follow plan 12's (`InvariantOptions.buildCost`).

import { multiblockOverclock, multiplierUnderOneTick, singleblockOverclock, voltageTier, type MachineOc } from '../../src/shared/gt/overclock.ts';
import { V, tierName } from '../../src/shared/gt/tiers.ts';
import type { StuffKey } from '../../src/shared/keys.ts';
import type { Machine, Pack, Recipe } from '../../src/shared/types/pack.ts';
import { FREE_KEYS, type Plan, type PlanContext, type PlanSettings, type PlanStep } from '../../src/shared/types/plan.ts';
// The world blocks the planner gathers, and with build cost counted may also make (plan 12's change request 13)
import { GATHERED_BLOCKS as MADE_WHEN_IT_PAYS } from '../../src/server/planner/availability.ts';
import { planBasis, type PlanBasis } from '../../src/server/planner/basis.ts';
import { isAutoWorkbench } from '../../src/server/planner/benches.ts';
import type { CandidateGraph } from '../../src/server/planner/candidates.ts';
import { solveLp, type LpRow } from '../../src/server/planner/lp.ts';
import { ownedMachineMap, pickMachine, type MachinePick } from '../../src/server/planner/machines.ts';
import { linePricing } from '../../src/server/planner/pricing.ts';

export type ViolationKind =
  | 'balance' | 'orphan-input' | 'flow' | 'multi-producer' | 'bought-and-made' | 'machines' | 'raw-source' | 'byproduct'
  | 'free-detour' | 'cost' | 'marginal';

export const VIOLATION_KINDS: readonly ViolationKind[] = [
  'balance', 'orphan-input', 'flow', 'multi-producer', 'bought-and-made', 'machines', 'raw-source', 'byproduct', 'free-detour', 'cost', 'marginal',
];

/**
 * One finding. `error`: the plan is wrong as shown (a good from nowhere, a machine count too low, a redundant producer at
 * no extra cost). `warn`: suspicious or only rounding-sized. `info`: reported for completeness (a justified multi-producer).
 */
export interface Violation {
  kind: ViolationKind;
  severity: 'error' | 'warn' | 'info';
  message: string;
  key?: StuffKey;
  stepId?: string;
  data?: Record<string, unknown>;
}

export interface InvariantOptions {
  /** Relative tolerance of every comparison (default 1e-6). */
  relTol?: number;
  /** Absolute floor below which differences are ignored (default 1e-12 per second). */
  absTol?: number;
  /** Context the plan was made in (default: no world scan). */
  ctx?: PlanContext;
  /**
   * The plan counts build cost (plan 12: a running line with a build horizon, or Make N), so the checks that assume plan
   * 09's objective follow plan 12's: a step's machine may be any machine that can run its recipe here, at any of its
   * eligible tiers (the solve picks the tier), its overclock recomputed for its own tier, and a crafting-table step's an
   * Auto Workbench; the owned machines of a step's other options (`reused.others`) count in its machine checks; a sharing
   * pool is checked once — its steps on equal machines, `max(1, ⌈Σ busy − 1e-9⌉)` of them, each step at its own share —
   * and the peak power counts a pool's machines and each owned unit once (`powerSummary`'s rule); on an AE2 or Project Red
   * line, the lines that may make gathered world blocks (Amendment OQ4), a free detour that ends in one is a note, as the
   * objective chose to make it, machines and step charges counted (controller ruling 250). The deep check keeps the least
   * raw material as a floor but lifts the step charge's +25 % cap, and a source of a good the line could drop at no more
   * raw material is a note only where the plan's machines cannot do without it (controller ruling 249, `needsMachine`): a
   * producer whose share the other steps cannot take within their machines (one machine of A beside a cheaper machine of
   * B for the rest), or a purchase beside steps whose machines are full.
   */
  buildCost?: boolean;
}

const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const TICKS_PER_SECOND = 20;
/**
 * EU one craft of GT++'s Electric Auto Workbench draws, at 1 A of its tier and at most one craft a tick (gt-mechanics §8):
 * below EV a craft takes 2,048 / V ticks at V EU/t, from EV on one tick at 2,048 EU/t; it never overclocks.
 */
const AUTO_WORKBENCH_EU_PER_CRAFT = 2048;
/**
 * Plan values keep 9 significant digits (`sig9`, rounded at unit demand and again when scaled back): what that rounding
 * can move one term by, relative to the term (half a unit of the 9th digit is at most 5e-9 of it; twice that, and some).
 */
const ROUND_REL = 1e-8;
/** A step charge may cost at most this much more raw material than the least (spec §3 `STEP_CHARGE_CAP`). */
const STEP_CHARGE_CAP = 0.25;
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
/**
 * World blocks a group gathers by the stack (or makes from cobblestone in one hammer hit) that the planner's
 * availability does not class as base or natural: a chain making them from free inputs replaces gathering them.
 */
export const GATHERED_BLOCKS: ReadonlySet<StuffKey> = new Set([
  'minecraft:sand@0', 'minecraft:sand@1', 'minecraft:gravel@0', 'minecraft:dirt@0', 'minecraft:clay@0', 'minecraft:clay_ball@0',
  'minecraft:netherrack@0', 'minecraft:end_stone@0', 'minecraft:soul_sand@0', 'minecraft:snowball@0', 'minecraft:ice@0',
]);
/**
 * The logistics of the lines that may make gathered world blocks with build cost counted: AE2 and Project Red (plan 12's
 * Amendment OQ4, ruling P1; machine-to-machine and EnderIO lines dig them). Written out here rather than read from the
 * planner's `gatheredRecipesOn` (basis.ts), whose regression kind (g) is there to catch (controller ruling 250).
 */
const GATHERED_MADE_ON: ReadonlySet<string> = new Set(['routed', 'ae2']);

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sci(x: number): string {
  return Number.isFinite(x) ? x.toExponential(4) : String(x);
}

/** Per good: what the steps make and take per second, what the line buys and sinks, and who makes and takes it. */
interface Ledger {
  produced: number; consumed: number; bought: number; sunk: number;
  /** Rounding allowance of each side: `ROUND_REL` × each of its terms (step amount × rate, buy, sink). */
  producedRound: number; consumedRound: number;
  producers: Map<string, number>; consumers: Map<string, number>;
}

function ledgerOf(map: Map<StuffKey, Ledger>, key: StuffKey): Ledger {
  let l = map.get(key);
  if (l === undefined) {
    l = { produced: 0, consumed: 0, bought: 0, sunk: 0, producedRound: 0, consumedRound: 0, producers: new Map(), consumers: new Map() };
    map.set(key, l);
  }
  return l;
}

/** Per-run totals of a step, summed per key (a recipe may list one good in several slots). */
function perRun(products: ReadonlyArray<{ key: StuffKey; amount: number }>): Map<StuffKey, number> {
  const out = new Map<StuffKey, number>();
  for (const p of products) out.set(p.key, (out.get(p.key) ?? 0) + p.amount);
  return out;
}

/** The demand the plan was made for, per second (rate mode), or the batch spread over its time (Make N). */
export function targetDemand(settings: PlanSettings, plan: Plan): number {
  if (settings.mode === 'makeN') {
    const t = plan.makeN?.totalSeconds ?? 0;
    return t > 0 ? settings.amount / t : 0;
  }
  return settings.amount / SECONDS_PER[settings.per];
}

/** The step ledgers, raw inputs and byproducts of `plan`, per good. */
function ledgers(plan: Plan): Map<StuffKey, Ledger> {
  const map = new Map<StuffKey, Ledger>();
  for (const step of plan.steps) {
    const rps = step.runsPerSecond;
    for (const [key, amount] of perRun(step.outputs)) {
      if (amount <= 0) continue;
      const l = ledgerOf(map, key);
      l.produced += amount * rps;
      l.producedRound += ROUND_REL * Math.abs(amount * rps);
      l.producers.set(step.id, (l.producers.get(step.id) ?? 0) + amount * rps);
    }
    for (const [key, amount] of perRun(step.inputs)) {
      if (amount <= 0) continue;
      const l = ledgerOf(map, key);
      l.consumed += amount * rps;
      l.consumedRound += ROUND_REL * Math.abs(amount * rps);
      l.consumers.set(step.id, (l.consumers.get(step.id) ?? 0) + amount * rps);
    }
  }
  for (const r of plan.rawInputs) {
    const l = ledgerOf(map, r.key);
    l.bought += r.perSecond;
    l.producedRound += ROUND_REL * Math.abs(r.perSecond);
  }
  for (const b of plan.byproducts) {
    const l = ledgerOf(map, b.key);
    l.sunk += b.amount;
    l.consumedRound += ROUND_REL * Math.abs(b.amount);
  }
  return map;
}

/** `|a − b|` beyond the relative tolerance of the larger side (and the absolute floor). */
function differs(a: number, b: number, relTol: number, absTol: number): boolean {
  return Math.abs(a - b) > Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}

function stepLabel(pack: Pack, plan: Plan, step: PlanStep): string {
  const map = plan.names?.[`map:${step.mapId}`] ?? pack.maps.get(step.mapId)?.name ?? step.mapId;
  const main = step.mainOutput === undefined ? '?' : pack.nameOf(step.mainOutput);
  return `${map} → ${main} [${step.id}]`;
}

/** Which ore-dictionary slots of a step's recipe a key fills together with other options. */
function oreDictOptions(pack: Pack, step: PlanStep, key: StuffKey): StuffKey[] | undefined {
  const r = pack.recipeById.get(step.recipeId);
  const slot = r?.inputs.find((ing) => ing.consumed && ing.options.length > 1 && ing.options.some((o) => o.key === key));
  return slot?.options.map((o) => o.key);
}

// ---------------------------------------------------------------------------------------------------------------------
// (a) balance and orphan inputs, (f) byproducts

function checkBalance(pack: Pack, settings: PlanSettings, plan: Plan, led: Map<StuffKey, Ledger>, relTol: number, absTol: number): Violation[] {
  const out: Violation[] = [];
  const target = settings.target;
  const demand = targetDemand(settings, plan);
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  const byproductKeys = new Set(plan.byproducts.map((b) => b.key));
  for (const [key, l] of [...led].sort(([a], [b]) => byString(a, b))) {
    const need = l.consumed + (key === target ? demand : 0);
    const have = l.produced + l.bought;
    const name = pack.nameOf(key);
    const consumersText = [...l.consumers].map(([id, v]) => `${stepLabel(pack, plan, stepById.get(id) as PlanStep)} ${sci(v)}/s`).join('; ');
    if (need > 0 && l.produced <= 0 && l.bought <= 0) {
      const optionsBy = [...l.consumers.keys()].map((id) => oreDictOptions(pack, stepById.get(id) as PlanStep, key)).find((o) => o !== undefined);
      out.push({
        kind: 'orphan-input', severity: 'error', key,
        message: `${name} is consumed (${sci(need)}/s) but no step makes it and no raw input buys it — consumers: ${consumersText}`,
        data: { consumed: l.consumed, demand: key === target ? demand : 0, consumers: Object.fromEntries(l.consumers), ...(optionsBy ? { oreDictSlot: optionsBy } : {}) },
      });
      continue;
    }
    const short = need - have;
    if (short > Math.max(absTol, relTol * Math.max(need, have))) {
      const rounding = short <= l.producedRound + l.consumedRound;
      const rel = short / Math.max(need, 1e-300);
      out.push({
        kind: 'balance', severity: rounding && rel <= 1e-4 ? 'warn' : 'error', key,
        message: `${name}: consumed${key === target ? ' + demand' : ''} ${sci(need)}/s > produced ${sci(l.produced)} + bought ${sci(l.bought)} (short ${sci(short)}/s, ${(rel * 100).toPrecision(3)}%)${rounding ? ' — within the 9-digit rounding of plan values' : ''}`,
        data: { consumed: l.consumed, demand: key === target ? demand : 0, produced: l.produced, bought: l.bought, short, relative: rel, cause: rounding ? 'rounding' : 'unbalanced', roundingAllowance: l.producedRound + l.consumedRound },
      });
    }
    // (f) the surplus must be listed as a byproduct (the target's own surplus is not a byproduct).
    const surplus = have - need - l.sunk;
    if (key !== target && surplus > Math.max(absTol, relTol * Math.max(have, need))) {
      const rounding = surplus <= l.producedRound + l.consumedRound;
      out.push({
        kind: 'byproduct', severity: rounding ? 'warn' : 'error', key,
        message: `${name}: surplus ${sci(have - need)}/s (produced ${sci(l.produced)} + bought ${sci(l.bought)} − consumed ${sci(l.consumed)}) but byproducts list ${sci(l.sunk)}/s${rounding ? ' — rounding-sized' : ''}`,
        data: { surplus: have - need, listed: l.sunk, produced: l.produced, bought: l.bought, consumed: l.consumed, cause: rounding ? 'rounding' : 'unlisted' },
      });
    }
    if (byproductKeys.has(key) && l.sunk > 0 && have - need < l.sunk - Math.max(absTol, relTol * l.sunk)) {
      const over = l.sunk - Math.max(0, have - need);
      const rounding = over <= l.producedRound + l.consumedRound;
      out.push({
        kind: 'byproduct', severity: rounding ? 'warn' : 'error', key,
        message: `${name}: byproducts list ${sci(l.sunk)}/s but the net surplus is only ${sci(have - need)}/s${rounding ? ' — rounding-sized' : ''}`,
        data: { surplus: have - need, listed: l.sunk, cause: rounding ? 'rounding' : 'overstated' },
      });
    }
  }
  if (target !== null && plan.status === 'ok') {
    const l = led.get(target);
    if (l === undefined || l.produced <= 0) {
      out.push({ kind: 'balance', severity: 'error', key: target, message: `the target ${pack.nameOf(target)} is made by no step`, data: { demand } });
    }
    if (l !== undefined && l.bought > 0) {
      out.push({ kind: 'balance', severity: 'error', key: target, message: `the target ${pack.nameOf(target)} is bought (${sci(l.bought)}/s)`, data: { bought: l.bought } });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (b) flows

const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

/**
 * The add-on 12 x 17 integration's F5: no item comes into a laid step from outside the line (`raw`, or a farm step, which
 * the layout never places) while a laid step sends it to `sink` or `out`: the layout would list it on both chests, and
 * EnderIO then moves it from one to the other for ever.
 */
function checkSupplySink(pack: Pack, plan: Plan): Violation[] {
  const farms = new Set(plan.steps.filter((s) => s.farm !== undefined).map((s) => s.id));
  const laid = (node: string): boolean => node !== RAW && node !== SINK && node !== OUT && !farms.has(node);
  const fed = new Set<StuffKey>();
  const thrown = new Set<StuffKey>();
  for (const f of plan.flows) {
    if (f.key.startsWith('fluid:')) continue;
    if ((f.from === RAW || farms.has(f.from)) && laid(f.to)) fed.add(f.key);
    if (laid(f.from) && (f.to === SINK || f.to === OUT)) thrown.add(f.key);
  }
  return [...fed].filter((key) => thrown.has(key)).sort().map((key): Violation => ({
    kind: 'flow', severity: 'error', key, message: `${pack.nameOf(key)} comes into the line from outside it while a step of the line throws it away`,
  }));
}

function checkFlows(pack: Pack, settings: PlanSettings, plan: Plan, led: Map<StuffKey, Ledger>, relTol: number, absTol: number): Violation[] {
  /**
   * What the 9-digit rounding of every step rate, buy and sink touching `key` (flows split producers by share), and of
   * the `flowed` total of flows compared, can move a flow of it by.
   */
  const keyRounding = (key: StuffKey, flowed: number): number => {
    const l = led.get(key);
    return (l === undefined ? 0 : l.producedRound + l.consumedRound) + ROUND_REL * Math.abs(flowed);
  };
  /** Σ |flows| of one node and good: what their own rounding is relative to. */
  const flowedOf = (e: { inn: number; outt: number } | undefined): number => (e === undefined ? 0 : e.inn + e.outt);
  const out: Violation[] = [];
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const target = settings.target;
  const seen = new Set<string>();
  /** node → key → net flow out (+) / in (−), and the number of flows behind it. */
  const net = new Map<string, Map<StuffKey, { value: number; n: number; inn: number; outt: number }>>();
  const add = (node: string, key: StuffKey, v: number): void => {
    let m = net.get(node);
    if (m === undefined) {
      m = new Map();
      net.set(node, m);
    }
    const e = m.get(key) ?? { value: 0, n: 0, inn: 0, outt: 0 };
    e.value += v;
    e.n += 1;
    if (v > 0) e.outt += v;
    else e.inn -= v;
    m.set(key, e);
  };
  for (const f of plan.flows) {
    const id = `${f.from}|${f.to}|${f.key}`;
    if (seen.has(id)) out.push({ kind: 'flow', severity: 'error', key: f.key, message: `duplicate flow ${f.from} → ${f.to} of ${pack.nameOf(f.key)}` });
    seen.add(id);
    if (f.from === f.to) out.push({ kind: 'flow', severity: 'error', key: f.key, stepId: f.from, message: `self-loop flow of ${pack.nameOf(f.key)} on ${f.from}` });
    if (!(f.perSecond > 0)) out.push({ kind: 'flow', severity: 'error', key: f.key, message: `flow ${f.from} → ${f.to} of ${pack.nameOf(f.key)} has rate ${f.perSecond}` });
    if (f.from !== RAW && !steps.has(f.from)) out.push({ kind: 'flow', severity: 'error', key: f.key, message: `flow from unknown node ${f.from}` });
    if (f.to !== OUT && f.to !== SINK && !steps.has(f.to)) out.push({ kind: 'flow', severity: 'error', key: f.key, message: `flow to unknown node ${f.to}` });
    const from = steps.get(f.from);
    if (from !== undefined && !from.outputs.some((p) => p.key === f.key)) {
      out.push({ kind: 'flow', severity: 'error', key: f.key, stepId: from.id, message: `flow of ${pack.nameOf(f.key)} out of ${stepLabel(pack, plan, from)}, which does not list it as an output` });
    }
    const to = steps.get(f.to);
    if (to !== undefined && !to.inputs.some((p) => p.key === f.key)) {
      const options = oreDictOptions(pack, to, f.key);
      out.push({
        kind: 'flow', severity: 'error', key: f.key, stepId: to.id,
        message: `flow of ${pack.nameOf(f.key)} into ${stepLabel(pack, plan, to)}, which does not list it as an input${options ? ` (it fills an ore-dictionary slot whose shown option is ${to.inputs.filter((p) => options.includes(p.key)).map((p) => pack.nameOf(p.key)).join(', ') || 'another'})` : ''}`,
        data: options ? { oreDictSlot: options } : {},
      });
    }
    if (f.to === OUT && f.key !== target) out.push({ kind: 'flow', severity: 'error', key: f.key, message: `flow to out of ${pack.nameOf(f.key)}, which is not the target` });
    add(f.from, f.key, f.perSecond);
    add(f.to, f.key, -f.perSecond);
  }
  // Per step and good: net production of the step = net flow out of it.
  for (const step of plan.steps) {
    const outs = perRun(step.outputs);
    const ins = perRun(step.inputs);
    const keys = new Set([...outs.keys(), ...ins.keys(), ...(net.get(step.id)?.keys() ?? [])]);
    for (const key of keys) {
      const madeGross = (outs.get(key) ?? 0) * step.runsPerSecond;
      const usedGross = (ins.get(key) ?? 0) * step.runsPerSecond;
      const stepNet = madeGross - usedGross;
      const e = net.get(step.id)?.get(key);
      const flowNet = e?.value ?? 0;
      const scale = Math.max(madeGross, usedGross);
      const allowance = keyRounding(key, flowedOf(e));
      if (Math.abs(stepNet - flowNet) > Math.max(absTol, relTol * scale)) {
        const rounding = Math.abs(stepNet - flowNet) <= allowance;
        out.push({
          kind: 'flow', severity: rounding ? 'warn' : 'error', key, stepId: step.id,
          message: `${stepLabel(pack, plan, step)}: ${pack.nameOf(key)} net ${sci(stepNet)}/s by the step (made ${sci(madeGross)}, used ${sci(usedGross)}) but flows carry ${sci(flowNet)}/s${rounding ? ' — rounding-sized' : ''}`,
          data: { stepNet, flowNet, made: madeGross, used: usedGross, cause: rounding ? 'rounding' : 'mismatch' },
        });
      }
    }
  }
  // raw → rawInputs
  const raw = net.get(RAW) ?? new Map();
  const rawKeys = new Set([...raw.keys(), ...plan.rawInputs.map((r) => r.key)]);
  for (const key of rawKeys) {
    const listed = plan.rawInputs.filter((r) => r.key === key).reduce((s, r) => s + r.perSecond, 0);
    const e = raw.get(key);
    const flowed = e?.value ?? 0;
    if (differs(listed, flowed, relTol, absTol)) {
      const rounding = Math.abs(listed - flowed) <= keyRounding(key, flowedOf(e));
      out.push({
        kind: 'flow', severity: rounding ? 'warn' : 'error', key,
        message: `${pack.nameOf(key)}: raw input ${sci(listed)}/s but flows from raw carry ${sci(flowed)}/s${rounding ? ' — rounding-sized' : ''}`,
        data: { listed, flowed },
      });
    }
  }
  // out → demand
  if (target !== null && plan.status === 'ok') {
    const delivered = -(net.get(OUT)?.get(target)?.value ?? 0);
    const demand = targetDemand(settings, plan);
    if (delivered < demand - Math.max(absTol, relTol * demand)) {
      const rounding = demand - delivered <= keyRounding(target, delivered + demand);
      out.push({
        kind: 'flow', severity: rounding ? 'warn' : 'error', key: target,
        message: `flows deliver ${sci(delivered)}/s of the target, demand is ${sci(demand)}/s (short ${(((demand - delivered) / demand) * 100).toPrecision(3)}%)${rounding ? ' — rounding-sized' : ''}`,
        data: { delivered, demand, cause: rounding ? 'rounding' : 'short' },
      });
    }
  }
  // sink → byproducts (the target's own surplus may sink too)
  const sink = net.get(SINK) ?? new Map();
  const sinkKeys = new Set([...sink.keys(), ...plan.byproducts.map((b) => b.key)]);
  for (const key of sinkKeys) {
    if (key === target) continue;
    const listed = plan.byproducts.filter((b) => b.key === key).reduce((s, b) => s + b.amount, 0);
    const e = sink.get(key);
    const flowed = -(e?.value ?? 0);
    if (differs(listed, flowed, relTol, absTol)) {
      const rounding = Math.abs(listed - flowed) <= keyRounding(key, flowedOf(e));
      out.push({
        kind: 'flow', severity: rounding ? 'warn' : 'error', key,
        message: `${pack.nameOf(key)}: byproduct ${sci(listed)}/s but flows to sink carry ${sci(flowed)}/s${rounding ? ' — rounding-sized' : ''}`,
        data: { listed, flowed },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (c) multi-producer and bought-and-made goods (static part)

export interface ProducerInfo { stepId: string; recipeId: string; map: string; machine: string; mainOutput?: StuffKey; isMain: boolean; perSecond: number; share: number; runsPerSecond: number }

/** Every good two or more steps make, with each producer's rate and share. */
export function multiProducers(pack: Pack, plan: Plan): Map<StuffKey, ProducerInfo[]> {
  const out = new Map<StuffKey, ProducerInfo[]>();
  const led = ledgers(plan);
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  for (const [key, l] of led) {
    if (l.producers.size < 2) continue;
    const list = [...l.producers].map(([id, v]): ProducerInfo => {
      const s = stepById.get(id) as PlanStep;
      return {
        stepId: id, recipeId: s.recipeId, map: plan.names?.[`map:${s.mapId}`] ?? s.mapId, machine: s.machine.name,
        ...(s.mainOutput === undefined ? {} : { mainOutput: s.mainOutput }), isMain: s.mainOutput === key, perSecond: v,
        share: l.produced > 0 ? v / l.produced : 0, runsPerSecond: s.runsPerSecond,
      };
    }).sort((a, b) => b.perSecond - a.perSecond);
    out.set(key, list);
  }
  return out;
}

function checkProducers(pack: Pack, plan: Plan, led: Map<StuffKey, Ledger>): Violation[] {
  const out: Violation[] = [];
  for (const [key, list] of [...multiProducers(pack, plan)].sort(([a], [b]) => byString(a, b))) {
    const mains = list.filter((p) => p.isMain).length;
    out.push({
      kind: 'multi-producer', severity: mains >= 2 ? 'warn' : 'info', key,
      message: `${pack.nameOf(key)} is made by ${list.length} recipes (${mains} as their main output): ${list.map((p) => `${p.map}${p.isMain ? '' : ' (byproduct)'} ${sci(p.perSecond)}/s = ${(p.share * 100).toPrecision(3)}%`).join('; ')}`,
      data: { producers: list },
    });
  }
  for (const [key, l] of [...led].sort(([a], [b]) => byString(a, b))) {
    if (l.bought > 0 && l.produced > 0) {
      out.push({
        kind: 'bought-and-made', severity: FREE.has(key) ? 'info' : 'warn', key,
        message: `${pack.nameOf(key)} is both bought (${sci(l.bought)}/s) and made by ${[...l.producers.keys()].length} step(s) (${sci(l.produced)}/s)`,
        data: { bought: l.bought, produced: l.produced, producers: Object.fromEntries(l.producers) },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (d) machines

/**
 * With build cost counted: why `m` cannot run `step`'s recipe `r` here at the step's own tier, as plan 12's machine
 * options allow (their rules 1–3), or null. A crafting-table step: an Auto Workbench of a tier at most the project's.
 * Any other step: a machine of its map — a singleblock at its own tier, at most the project's, whose voltage × the map's
 * amps covers the recipe's EU/t; or a multiblock whose energy hatch is from the recipe's voltage tier (at most the
 * project's) up to the project's, one the group owns or one for a recipe no such singleblock runs.
 */
function notEligible(pack: Pack, r: Recipe, step: PlanStep, m: Machine, groupTier: number, owned: ReadonlyMap<number, number>): string | null {
  const tier = step.machine.tier;
  if (step.mapId === 'crafting') {
    if (!isAutoWorkbench(m)) return 'a crafting-table step runs on an Auto Workbench';
    return tier === (m.tier ?? 0) && tier <= groupTier ? null : `an Auto Workbench of ${tierName(tier)} above the project's ${tierName(groupTier)}`;
  }
  const onMap = (pack.machinesByMap.get(step.mapId) ?? []).flatMap((id) => pack.machines.get(id) ?? []);
  if (!onMap.some((x) => x.mteId === m.mteId)) return `${m.name} runs no recipe of ${pack.maps.get(step.mapId)?.name ?? step.mapId}`;
  const mapAmps = pack.maps.get(step.mapId)?.amps ?? 1;
  const runs = (x: Machine): boolean => x.kind === 'basic' && (x.tier ?? 0) <= groupTier && (V[x.tier ?? 0] as number) * mapAmps >= r.euPerTick;
  if (m.kind === 'basic') {
    if (tier !== (m.tier ?? 0)) return `${m.name} is ${tierName(m.tier ?? 0)}, not ${tierName(tier)}`;
    return runs(m) ? null : `${m.name} (${tierName(tier)}) cannot run it at the project's ${tierName(groupTier)}`;
  }
  if (m.kind === 'multiblock') {
    const lowest = Math.min(voltageTier(r.euPerTick), groupTier);
    if (tier < lowest || tier > groupTier) return `an energy hatch of ${tierName(tier)} is outside ${tierName(lowest)}–${tierName(groupTier)}`;
    return onMap.some(runs) && (owned.get(m.mteId) ?? 0) === 0 ? `a singleblock runs it and the group owns no ${m.name}` : null;
  }
  return `${m.name} is no machine a step runs on`;
}

/** With build cost counted: the overclock of `step`'s own machine `m` at its own tier (gt-mechanics §2, §6, §8). */
function ownOverclock(pack: Pack, r: Recipe, step: PlanStep, m: Machine, coilHeat: number): MachineOc {
  const tier = step.machine.tier;
  if (step.mapId === 'crafting') {
    const volts = V[tier] as number;
    const euPerTick = Math.min(volts, AUTO_WORKBENCH_EU_PER_CRAFT);
    return { euPerTick, durationTicks: Math.ceil(AUTO_WORKBENCH_EU_PER_CRAFT / euPerTick), overclocks: 0, heatOverclocks: 0, machineVoltage: volts, machineAmps: 1, parallel: 1 };
  }
  if (m.kind === 'multiblock') {
    return multiblockOverclock(
      { euPerTick: r.euPerTick, durationTicks: r.durationTicks, heat: r.meta.coilHeat ?? r.specialValue },
      { hatchTier: tier, perfectOC: m.perfectOC === true, heatOC: m.heatOC === true, coilHeat },
    );
  }
  return singleblockOverclock(r, { tier, amps: m.amps ?? pack.maps.get(step.mapId)?.amps ?? 1 });
}

/**
 * The peak draw `powerSummary` (plan.ts) gives with build cost counted (plan 12, architecture §11.39): each step's new
 * machines, `count − reused.units.length` at its EU/t — a sharing pool's once, by its first step, at the largest EU/t of
 * its steps — plus each distinct owned machine (mteId and unit, those of `reused.others` at their own EU/t) once, at the
 * largest EU/t among the steps on it; an owned machine of another option without units at its count × EU/t.
 */
function peakAsPlanned(steps: readonly PlanStep[]): number {
  let peak = 0;
  const units = new Map<string, number>();
  const onUnit = (mteId: number, unit: number, euPerTick: number): void => {
    const key = `${mteId}:${unit}`;
    units.set(key, Math.max(units.get(key) ?? 0, euPerTick));
  };
  const seen = new Set<string>();
  for (const step of steps) {
    const pool = step.pool;
    const group = pool === undefined ? [step] : steps.filter((s) => s.pool?.id === pool.id);
    const key = pool === undefined ? `step:${step.id}` : `pool:${pool.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = group.find((s) => s.id === pool?.steps[0]) ?? step;
    let euPerTick = 0;
    for (const s of group) euPerTick = Math.max(euPerTick, s.euPerTick);
    peak += Math.max(0, first.count - (first.reused?.units?.length ?? 0)) * euPerTick;
    for (const s of group) {
      for (const u of s.reused?.units ?? []) onUnit(s.machine.mteId, u, s.euPerTick);
      for (const o of s.reused?.others ?? []) {
        if (o.units === undefined) peak += o.count * o.euPerTick;
        else for (const u of o.units) onUnit(o.mteId, u, o.euPerTick);
      }
    }
  }
  for (const euPerTick of units.values()) peak += euPerTick;
  return peak;
}

function checkMachines(pack: Pack, settings: PlanSettings, plan: Plan, basis: PlanBasis, ctx: PlanContext, relTol: number, buildCost: boolean): Violation[] {
  const out: Violation[] = [];
  const owned = ownedMachineMap(ctx, settings);
  /** Per sharing pool (with build cost counted): its steps, and each one's machines kept busy (`busy`). */
  const pools = new Map<string, Array<{ step: PlanStep; busy: number; label: string }>>();
  for (const step of plan.steps) {
    const label = stepLabel(pack, plan, step);
    const r = pack.recipeById.get(step.recipeId);
    if (r === undefined) {
      out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: recipe not in the pack` });
      continue;
    }
    if (!Number.isInteger(step.count) || step.count < 1) {
      out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: machine count ${step.count} is not a whole number ≥ 1` });
    }
    if (step.machine.tier > plan.tier && step.machine.mteId >= 0) {
      out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: machine tier ${step.machine.tier} above the group's tier ${plan.tier}` });
    }
    let parallel = 1;
    const machine = step.machine.mteId >= 0 ? pack.machines.get(step.machine.mteId) : undefined;
    if (buildCost && machine !== undefined) {
      // Plan 12: the solve picks the step's machine among those that can run it, at any eligible tier; its overclock is
      // recomputed for that tier.
      const why = notEligible(pack, r, step, machine, plan.tier, owned);
      if (why !== null) {
        out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: ${step.machine.name} T${step.machine.tier} is none of the machines that can run it here (${why})` });
      }
      const oc = ownOverclock(pack, r, step, machine, basis.coilHeat);
      parallel = oc.parallel;
      if (oc.euPerTick !== step.euPerTick || oc.durationTicks !== step.durationTicks || oc.overclocks !== step.overclocks) {
        out.push({
          kind: 'machines', severity: 'error', stepId: step.id,
          message: `${label}: overclock ${step.euPerTick} EU/t × ${step.durationTicks} t ×${step.overclocks} OC on ${step.machine.name} T${step.machine.tier}, recomputed ${oc.euPerTick} × ${oc.durationTicks} ×${oc.overclocks}`,
        });
      }
      if (machine.kind === 'basic' && r.euPerTick > (V[step.machine.tier] as number) * (pack.maps.get(step.mapId)?.amps ?? 1)) {
        out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: recipe ${r.euPerTick} EU/t above what a T${step.machine.tier} machine supplies` });
      }
      if (machine.kind === 'multiblock' && step.oc !== undefined) {
        parallel = Math.max(parallel, multiplierUnderOneTick({
          recipeEUt: r.euPerTick, duration: r.durationTicks, machineVoltage: step.oc.machineVoltage, amperage: step.oc.machineAmps, amperageOC: true, perfectOC: step.oc.perfect,
        }));
      }
    } else {
      let pick: MachinePick | undefined;
      try {
        const wantTier = Object.hasOwn(settings.machineTier, step.recipeId) ? settings.machineTier[step.recipeId] : undefined;
        // With build cost counted a crafting-table step no Auto Workbench runs is crafted by hand although crafting is
        // automated (controller ruling 214): its pick is the hand's.
        const automateCrafting = settings.automateCrafting && !(buildCost && step.handCraft);
        pick = pickMachine(pack, r, step.mapId, {
          groupTier: plan.tier, wantTier, coilHeat: basis.coilHeat, automateCrafting, owned, multiblocks: basis.env.multiblocks,
        });
      } catch (error) {
        out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: no machine runs it (${(error as Error).message})` });
      }
      if (pick !== undefined) {
        parallel = pick.oc.parallel;
        if (pick.mteId !== step.machine.mteId || pick.tier !== step.machine.tier || pick.oc.euPerTick !== step.euPerTick
          || pick.oc.durationTicks !== step.durationTicks || pick.oc.overclocks !== step.overclocks) {
          out.push({
            kind: 'machines', severity: 'error', stepId: step.id,
            message: `${label}: machine/OC differ from a fresh pick (${step.machine.name} T${step.machine.tier} ${step.euPerTick} EU/t ${step.durationTicks} t ×${step.overclocks} OC vs ${pick.name} T${pick.tier} ${pick.oc.euPerTick} EU/t ${pick.oc.durationTicks} t ×${pick.oc.overclocks} OC)`,
          });
        }
        // An independent overclock of a singleblock (gt-mechanics §2.2) and its voltage.
        if (pick.kind === 'basic') {
          const amps = machine?.amps ?? pack.maps.get(step.mapId)?.amps ?? 1;
          const oc = singleblockOverclock(r, { tier: step.machine.tier, amps });
          if (oc.euPerTick !== step.euPerTick || oc.durationTicks !== step.durationTicks) {
            out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: overclock ${step.euPerTick} EU/t × ${step.durationTicks} t, recomputed ${oc.euPerTick} × ${oc.durationTicks}` });
          }
          if (r.euPerTick > (V[step.machine.tier] as number) * (pack.maps.get(step.mapId)?.amps ?? 1)) {
            out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: recipe ${r.euPerTick} EU/t above what a T${step.machine.tier} machine supplies` });
          }
        } else if (pick.kind === 'multiblock' && step.oc !== undefined) {
          parallel = multiplierUnderOneTick({
            recipeEUt: r.euPerTick, duration: r.durationTicks, machineVoltage: step.oc.machineVoltage, amperage: step.oc.machineAmps, amperageOC: true, perfectOC: step.oc.perfect,
          });
          parallel = Math.max(parallel, pick.oc.parallel);
        }
      }
    }
    if (step.oc !== undefined && step.oc.recipeEuPerTick !== r.euPerTick) {
      out.push({ kind: 'machines', severity: 'warn', stepId: step.id, message: `${label}: oc.recipeEuPerTick ${step.oc.recipeEuPerTick} ≠ recipe ${r.euPerTick}` });
    }
    // Runs a second one machine of the step's own type does; with build cost counted, the owned machines of its other
    // options take their share of the runs beside them (`reused.others`).
    const perMachine = (TICKS_PER_SECOND * parallel) / step.durationTicks;
    let besides = 0;
    if (buildCost) for (const o of step.reused?.others ?? []) besides += o.count * o.runsPerSecondPerMachine;
    const capacity = step.count * perMachine + besides;
    const busy = Math.max(0, step.runsPerSecond - besides) / perMachine;   // machines of its own type fully busy
    const beside = besides > 0 ? ` beside the owned machines of its other options, which do ${sci(besides)}/s,` : '';
    if (buildCost && step.pool !== undefined) {
      const list = pools.get(step.pool.id) ?? [];
      list.push({ step, busy, label });
      pools.set(step.pool.id, list);
    } else {
      if (step.count < busy * (1 - relTol) - 1e-12) {
        out.push({
          kind: 'machines', severity: 'error', stepId: step.id,
          message: `${label}: ${step.count} machine(s)${beside} but ${sci(step.runsPerSecond)} runs/s × ${step.durationTicks / TICKS_PER_SECOND} s / ${parallel} parallel needs ${busy.toFixed(4)}`,
          data: { count: step.count, needed: busy },
        });
      }
      if (step.count > 1 && busy <= step.count - 1 + 1e-9) {
        out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: ${step.count} machines${beside} where ${Math.ceil(busy - 1e-9)} would do (${busy.toFixed(4)} busy)` });
      }
    }
    if (step.utilization > 1 + relTol) {
      out.push({ kind: 'machines', severity: 'error', stepId: step.id, message: `${label}: utilization ${step.utilization} > 1` });
    }
    const utilization = capacity > 0 ? step.runsPerSecond / capacity : 0;   // a pooled step's: its own share of the pool
    if (step.count >= 1 && differs(step.utilization, utilization, Math.max(relTol, 1e-6), 1e-12)) {
      out.push({ kind: 'machines', severity: 'warn', stepId: step.id, message: `${label}: utilization ${step.utilization} ≠ recomputed ${utilization}` });
    }
  }
  // A sharing pool (plan 12): every step of it on the same machines, as many as its steps keep busy together.
  for (const [id, list] of pools) {
    const first = (list[0] as (typeof list)[number]).step;
    const ids = list.map((e) => e.step.id).sort(byString);
    if (list.some(({ step }) => step.count !== first.count || step.owned !== first.owned || (step.pool?.steps ?? []).join() !== ids.join())) {
      out.push({
        kind: 'machines', severity: 'error', stepId: first.id,
        message: `${id}: its steps differ (${list.map(({ step }) => `${step.id} ${step.count} machine(s), ${step.owned} owned, listing ${(step.pool?.steps ?? []).join(', ')}`).join('; ')})`,
      });
    }
    let busy = 0;
    for (const e of list) busy += e.busy;
    const want = Math.max(1, Math.ceil(busy - 1e-9));
    if (first.count < busy * (1 - relTol) - 1e-12) {
      out.push({ kind: 'machines', severity: 'error', stepId: first.id, message: `${id}: ${first.count} machine(s) but its steps (${ids.join(', ')}) keep ${busy.toFixed(4)} busy`, data: { count: first.count, needed: busy } });
    } else if (first.count > want) {
      out.push({ kind: 'machines', severity: 'error', stepId: first.id, message: `${id}: ${first.count} machines where ${want} would do (${busy.toFixed(4)} busy over ${ids.join(', ')})` });
    }
  }
  // Power: the summary adds up the steps (rate mode: Σ count × EU/t; with build cost counted, `powerSummary`'s rule).
  if (settings.mode === 'rate' && plan.steps.length > 0) {
    const peak = buildCost ? peakAsPlanned(plan.steps) : plan.steps.reduce((s, x) => s + x.count * x.euPerTick, 0);
    if (differs(peak, plan.power.peakEUt, 1e-9, 1e-6)) {
      out.push({ kind: 'machines', severity: 'warn', message: `power.peakEUt ${plan.power.peakEUt} ≠ ${buildCost ? 'its machines, each pool and owned unit once,' : 'Σ count × EU/t'} ${peak}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (e) raw inputs: availability and sources

/**
 * The names a derived source text says its good is made from: "made by Canner from Ethylene Cell" → Ethylene Cell; a
 * trailing count of recipes ("(3 recipes in all)") is not a name.
 */
function madeFromNames(detail: string): string[] {
  const at = detail.indexOf(' from ');
  if (at < 0) return [];
  return detail.slice(at + ' from '.length).replace(/\s*\([^()]*\)$/, '').split(', ').filter((n) => n !== '');
}

function checkRawSources(pack: Pack, plan: Plan): Violation[] {
  const out: Violation[] = [];
  const containersOf = new Map<StuffKey, Set<string>>();   // fluid → the names of its filled containers
  for (const c of pack.fluidContainers ?? []) {
    let set = containersOf.get(c.fluid);
    if (set === undefined) {
      set = new Set();
      containersOf.set(c.fluid, set);
    }
    set.add(pack.nameOf(c.container));
  }
  for (const r of plan.rawInputs) {
    const name = pack.nameOf(r.key);
    if (!r.available) out.push({ kind: 'raw-source', severity: 'error', key: r.key, message: `${name} is bought but not available here` });
    if (r.leafClass === undefined) out.push({ kind: 'raw-source', severity: 'warn', key: r.key, message: `${name} is bought with no leaf class` });
    if (r.sources.length === 0) {
      out.push({ kind: 'raw-source', severity: r.leafClass === 'stop' ? 'info' : 'error', key: r.key, message: `${name} (${r.leafClass ?? '?'}) is bought with no source` });
    }
    if (!(r.perSecond > 0)) out.push({ kind: 'raw-source', severity: 'error', key: r.key, message: `${name}: raw input rate ${r.perSecond}` });
    if (!Number.isFinite(r.cost) || r.cost < 0) out.push({ kind: 'raw-source', severity: 'error', key: r.key, message: `${name}: raw input cost ${r.cost}` });
    if (r.leafClass === 'derived') {
      // What the plan says (its source text), not how availability first reached the good: a source naming a filled
      // container of the good itself as what it is made from only empties that container.
      const containers = containersOf.get(r.key) ?? new Set<string>();
      const roundTrip = r.sources.find((s) => s.kind === 'derived' && madeFromNames(s.detail).some((n) => containers.has(n)));
      if (roundTrip !== undefined) {
        out.push({
          kind: 'raw-source', severity: 'warn', key: r.key,
          message: `${name}: its source "${roundTrip.detail}" only empties a container of ${name} itself — it says nothing about where ${name} comes from`,
          data: { detail: roundTrip.detail },
        });
      }
      if (!r.sources.some((s) => s.kind === 'derived')) {
        out.push({ kind: 'raw-source', severity: 'warn', key: r.key, message: `${name} is a derived leaf without a derived source` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// (g) free-input detours

export interface Detour { product: StuffKey; perSecond: number; price: number; savedPerSecond: number; steps: string[]; why: string }

/** Whether `key` is directly a base or gathered material: availability classes it direct/natural/byproduct, or it is a world block. */
function gatheredOrBase(basis: PlanBasis, key: StuffKey): string | null {
  if (FREE.has(key)) return null;
  const cls = basis.avail.classOf(key);
  if (cls === 'direct' || cls === 'natural' || cls === 'byproduct') return cls;
  return GATHERED_BLOCKS.has(key) ? 'world block' : null;
}

/**
 * The chains of steps fed by free inputs alone that end in a base or gathered material the plan then uses. What a
 * supply step makes (`PlanStep.supply`: a rock breaker's stone, a pump's water) counts as free input too (ruling P5).
 */
export function freeDetours(pack: Pack, plan: Plan, basis: PlanBasis): Detour[] {
  const freeRaw = new Set<StuffKey>([
    ...FREE, ...plan.rawInputs.filter((r) => r.leafClass === 'free').map((r) => r.key),
    ...plan.steps.flatMap((s) => (s.supply === undefined ? [] : [s.supply])),
  ]);
  const freeFed = new Set<string>();
  const freeGoods = new Set<StuffKey>(freeRaw);
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of plan.steps) {
      if (freeFed.has(s.id)) continue;
      if (s.inputs.length > 0 && s.inputs.every((p) => freeGoods.has(p.key))) {
        freeFed.add(s.id);
        for (const p of s.outputs) freeGoods.add(p.key);
        changed = true;
      }
    }
  }
  const producersOf = new Map<StuffKey, PlanStep[]>();
  for (const s of plan.steps) for (const p of s.outputs) {
    if (!freeFed.has(s.id)) continue;
    const list = producersOf.get(p.key) ?? [];
    list.push(s);
    producersOf.set(p.key, list);
  }
  const ancestors = (s: PlanStep, acc: Set<string>): Set<string> => {
    if (acc.has(s.id)) return acc;
    acc.add(s.id);
    for (const p of s.inputs) for (const up of producersOf.get(p.key) ?? []) ancestors(up, acc);
    return acc;
  };
  const out: Detour[] = [];
  for (const s of plan.steps) {
    if (!freeFed.has(s.id)) continue;
    for (const p of s.outputs) {
      const why = gatheredOrBase(basis, p.key);
      if (why === null) continue;
      // The last gathered good of the chain: something other than a gathered-good step of the chain takes it.
      const takers = plan.steps.filter((t) => t.inputs.some((q) => q.key === p.key));
      const exits = takers.length === 0 || takers.some((t) => !freeFed.has(t.id) || !t.outputs.some((q) => gatheredOrBase(basis, q.key) !== null));
      if (!exits) continue;
      const perSecond = p.amount * s.runsPerSecond;
      const price = basis.prices.price(p.key);
      out.push({ product: p.key, perSecond, price, savedPerSecond: perSecond * price, steps: [...ancestors(s, new Set())], why });
    }
  }
  return out;
}

/**
 * Kind (g). With build cost counted on an AE2 or Project Red line (`GATHERED_MADE_ON`), a detour that ends in a world
 * block the planner gathers (availability.ts's `GATHERED_BLOCKS`, plan 09's R1) is a note: plan 12 offers those blocks'
 * recipes there beside digging them (spec §3.3, Amendment OQ4), and the objective chose to make it with its machines and
 * step charges counted (plan 12's D1). On machine-to-machine and EnderIO lines, which dig them, such a detour stays a
 * warning, as with build cost ignored (controller ruling 250).
 */
function checkDetours(pack: Pack, settings: PlanSettings, plan: Plan, basis: PlanBasis, buildCost: boolean): Violation[] {
  const totalCost = plan.rawInputs.reduce((s, r) => s + r.cost, 0);
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  const madeHere = buildCost && GATHERED_MADE_ON.has(settings.logistics);
  return freeDetours(pack, plan, basis).map((d): Violation => ({
    kind: 'free-detour', severity: madeHere && Object.hasOwn(MADE_WHEN_IT_PAYS, d.product) ? 'info' : 'warn', key: d.product,
    message: `${d.steps.length} step(s) (${d.steps.map((id) => stepLabel(pack, plan, stepById.get(id) as PlanStep)).join(' ⇐ ')}) turn free input into ${pack.nameOf(d.product)} (${d.why}) at ${sci(d.perSecond)}/s, saving ${sci(d.savedPerSecond)} raw cost/s (${totalCost > 0 ? ((d.savedPerSecond / totalCost) * 100).toPrecision(3) : '∞'}% of the line's ${sci(totalCost)}/s)`,
    data: { ...d, lineRawCost: totalCost },
  }));
}

// ---------------------------------------------------------------------------------------------------------------------

/** The synchronous invariants (a, b, c static, d, e, f, g) of `plan`, made for `settings` on `pack`. */
export function checkPlanInvariants(pack: Pack, settings: PlanSettings, plan: Plan, opts: InvariantOptions = {}): Violation[] {
  const relTol = opts.relTol ?? 1e-6;
  const absTol = opts.absTol ?? 1e-12;
  const buildCost = opts.buildCost === true;
  const ctx = opts.ctx ?? { ownedMachines: [], storage: new Map(), visitedDims: [], topTier: null, coilHeat: null, prospected: [] };
  if (plan.status !== 'ok') return [];
  const basis = planBasis(pack, settings, ctx);
  const led = ledgers(plan);
  return [
    ...checkBalance(pack, settings, plan, led, relTol, absTol),
    ...checkFlows(pack, settings, plan, led, relTol, absTol),
    ...checkSupplySink(pack, plan),
    ...checkProducers(pack, plan, led),
    ...checkMachines(pack, settings, plan, basis, ctx, relTol, buildCost),
    ...checkRawSources(pack, plan),
    ...checkDetours(pack, settings, plan, basis, buildCost),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Deep checks: an independent least-raw-material LP over the line's own candidate graph.

export interface S1Result {
  status: 'optimal' | 'infeasible' | 'error'; cost: number; runs: Map<string, number>; buys: Map<StuffKey, number>;
  /** With `sparse`: the step recipes (not ore-dictionary conversions) a few reweighted-L1 rounds at that cost still run. */
  support?: Set<string>;
}

export interface S1Options {
  /** Recipe ids left out. */
  banned?: ReadonlySet<string>;
  /** Only these recipe ids (and every ore-dictionary conversion) may run. */
  allowed?: ReadonlySet<string>;
  /** Goods that may not be bought. */
  notBuyable?: ReadonlySet<StuffKey>;
  /** After S1, look for a plan of that cost that runs few recipes (reweighted L1, as the planner's fallback S3 does). */
  sparse?: boolean;
  /** The recipes held to machines (`heldBy`: a plan's), runs a second; a recipe it does not name runs unbounded. */
  held?: HeldMachines;
}

/**
 * What machines let recipes run, runs a second: each recipe of `most` at most its value; the recipes of each `pools`
 * entry, which share their machines, together at most them — Σ runs ÷ the recipe's value ≤ 1 (each value: the recipe's
 * runs a second on all of the pool's machines).
 */
export interface HeldMachines { most: ReadonlyMap<string, number>; pools: ReadonlyArray<ReadonlyMap<string, number>> }

/** Whether `step` runs on no machine a build counts: by hand, or on a pseudo machine (the furnace, the crafting table). */
function onPseudo(step: PlanStep): boolean {
  return step.handCraft || step.machine.mteId < 0;
}

/**
 * The machines a plan gives its steps (controller ruling 249): a step's runs at most `runsPerSecond / utilization` (its
 * own machines and the owned ones of its other options, `reused.others`); the steps of one sharing pool together at most
 * their pool's machines (Σ runs × utilization / runsPerSecond ≤ 1); a step on a pseudo machine or by hand unbounded, as
 * the solve's later stages leave them (`laterRoom` holds no pseudo step). Each bound is `slack` (relative) wider, so the
 * plan's own 9-digit rates stay inside them.
 */
function heldBy(plan: Plan, slack: number): HeldMachines {
  const most = new Map<string, number>();
  const pools = new Map<string, Map<string, number>>();
  for (const step of plan.steps) {
    if (onPseudo(step) || !(step.runsPerSecond > 0) || !(step.utilization > 0)) continue;
    const full = (step.runsPerSecond / step.utilization) * (1 + slack);
    if (step.pool === undefined) {
      most.set(step.recipeId, full);
      continue;
    }
    let pool = pools.get(step.pool.id);
    if (pool === undefined) {
      pool = new Map();
      pools.set(step.pool.id, pool);
    }
    pool.set(step.recipeId, full);
  }
  return { most, pools: [...pools.values()] };
}

/** How full `step`'s machines are: its utilization, a pooled step's pool's (Σ of its steps' shares); none on a pseudo machine. */
function fullness(plan: Plan, step: PlanStep): number {
  if (onPseudo(step)) return 0;
  const pool = step.pool;
  if (pool === undefined) return step.utilization;
  return plan.steps.filter((s) => s.pool?.id === pool.id).reduce((sum, s) => sum + s.utilization, 0);
}

/**
 * Whether dropping `step` saves a machine block the build MIP pays for (fix wave 2 (a)): its new machines, one of its
 * sharing pool's (the pool's other steps keep `Σ utilization × count` of its machines busy), or, by hand or on a pseudo
 * machine, its step charge. Not where it runs on owned machines only, nor where its pool keeps its count without it —
 * although since ledger 265 (fix wave 3, controller OQ24) the build MIP charges an owned block OWNED_STEP_SHARE of a
 * new one's step charge, which this rule does not count yet (its severity is the final review's).
 */
function savesBlock(plan: Plan, step: PlanStep): boolean {
  if (onPseudo(step)) return true;
  const pool = step.pool;
  if (pool === undefined) return step.count > step.owned;
  const busy = plan.steps.filter((s) => s.pool?.id === pool.id && s.id !== step.id).reduce((sum, s) => sum + s.utilization, 0) * step.count;
  const without = Math.max(1, Math.ceil(busy - 1e-9));
  return Math.max(0, step.count - step.owned) > Math.max(0, without - step.owned);
}

/**
 * Least raw material (S1) over `graph` for `demand` per second, solved at a demand normalized to 1 so HiGHS's absolute
 * tolerances stay far below every real flow, then scaled back.
 */
export async function leastRawCost(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>, opts: S1Options = {}): Promise<S1Result> {
  const scale = Math.max(...demand.values());
  const keys = new Set<StuffKey>([...graph.goods.keys(), ...demand.keys()]);
  for (const r of graph.recipes) for (const [k] of r.coeffs) keys.add(k);
  const goods = [...keys].sort(byString);
  const rowOf = new Map(goods.map((k, i) => [k, i]));
  const recipes = graph.recipes.filter((r) => !(opts.banned?.has(r.id) ?? false) && (opts.allowed === undefined || r.kind === 'convert' || opts.allowed.has(r.id)));
  const buyKeys = goods.filter((k) => graph.goods.get(k)?.buyable === true && !(opts.notBuyable?.has(k) ?? false));
  const firstBuy = recipes.length;
  const firstSink = firstBuy + buyKeys.length;
  const width = firstSink + goods.length;
  const entries = goods.map((): Array<[number, number]> => []);
  recipes.forEach((r, j) => {
    for (const [k, c] of r.coeffs) (entries[rowOf.get(k) as number] as Array<[number, number]>).push([j, c]);
  });
  buyKeys.forEach((k, i) => (entries[rowOf.get(k) as number] as Array<[number, number]>).push([firstBuy + i, 1]));
  const rows: LpRow[] = goods.map((k, g) => {
    const d = (demand.get(k) ?? 0) / scale;
    return { lower: d, upper: d, entries: [...(entries[g] as Array<[number, number]>), [firstSink + g, -1]] };
  });
  const colCost = new Array<number>(width).fill(0);
  buyKeys.forEach((k, i) => {
    colCost[firstBuy + i] = graph.goods.get(k)?.cost ?? 0;
  });
  const lower = new Array<number>(width).fill(0);
  const upper = new Array<number>(width).fill(Infinity);
  // Machines: a recipe's runs at the normalized demand are its runs a second ÷ `scale`.
  if (opts.held !== undefined) {
    const held = opts.held;
    recipes.forEach((r, j) => {
      const most = held.most.get(r.id);
      if (most !== undefined) upper[j] = most / scale;
    });
    for (const pool of held.pools) {
      const entries = recipes.flatMap((r, j): Array<[number, number]> => {
        const full = pool.get(r.id);
        return full === undefined ? [] : [[j, scale / full]];
      });
      if (entries.length > 0) rows.push({ lower: -Infinity, upper: 1, entries });
    }
  }
  const res = await solveLp({ sense: 'min', colCost, colLower: lower, colUpper: upper, rows });
  if (res.status !== 'optimal') return { status: res.status === 'error' ? 'error' : 'infeasible', cost: Infinity, runs: new Map(), buys: new Map() };
  let x = res.x;
  let support: Set<string> | undefined;
  if (opts.sparse === true) {
    const lock: LpRow = { lower: -Infinity, upper: res.objective * (1 + 1e-7) + 1e-12, entries: colCost.flatMap((c, j): Array<[number, number]> => (c === 0 ? [] : [[j, c]])) };
    const lockRows = lock.entries.length > 0 ? [lock] : [];
    const isStep = recipes.map((r) => r.kind === 'recipe');
    let prev: number[] | null = null;
    for (let round = 0; round < 4; round++) {
      const largest = prev === null ? 0 : Math.max(0, ...prev.slice(0, firstBuy));
      const w = colCost.map((_, j) => (j < firstBuy && isStep[j] === true ? (prev === null ? 1 : 1 / ((prev[j] ?? 0) + largest * 1e-6 + 1e-12)) : 0));
      const again = await solveLp({ sense: 'min', colCost: w, colLower: lower, colUpper: upper, rows: [...rows, ...lockRows] });
      if (again.status !== 'optimal') break;
      prev = again.x;
    }
    if (prev !== null) x = prev;
    const top = Math.max(0, ...x.slice(0, firstBuy));
    support = new Set(recipes.filter((r, j) => r.kind === 'recipe' && (x[j] ?? 0) > top * 1e-9).map((r) => r.id));
  }
  const runs = new Map<string, number>();
  recipes.forEach((r, j) => {
    const v = (x[j] ?? 0) * scale;
    if (v > 1e-12 * scale) runs.set(r.id, v);
  });
  const buys = new Map<StuffKey, number>();
  buyKeys.forEach((k, i) => {
    const v = (x[firstBuy + i] ?? 0) * scale;
    if (v > 1e-12 * scale) buys.set(k, v);
  });
  return { status: 'optimal', cost: res.objective * scale, runs, buys, ...(support === undefined ? {} : { support }) };
}

export interface DeepOptions extends InvariantOptions {
  /** A source of a multi-producer good is redundant when the line costs at most this much more without it (default 1e-6). */
  costTol?: number;
  /**
   * Also price every step's exclusive upstream (the step and the steps that feed only it): a chain of 2+ steps the line
   * could drop for less than `marginalShare` (default 0.01 = 1%) more raw material is reported as `marginal`, one it can
   * drop at no extra cost as an `error`. Off by default (one LP per step).
   */
  marginal?: boolean;
  marginalShare?: number;
  /** Seconds the marginal trials may take per plan (default 120); the rest are skipped and counted. */
  marginalBudgetSeconds?: number;
  /**
   * The step charge the plan was made with (`PlanSettings.stepCharge`): above 0 the plan may use up to `STEP_CHARGE_CAP`
   * more raw material than the optimum to save steps, so only a cost below the optimum, or above that cap, is an `error`.
   */
  stepCharge?: number;
}

/**
 * Everything `checkPlanInvariants` checks, plus: the plan's raw cost against an independent S1 optimum of the line's own
 * candidate graph (`cost`; with `opts.stepCharge` above 0, anywhere from the optimum to `STEP_CHARGE_CAP` above it; with
 * `opts.buildCost`, anywhere from the optimum up), and for every multi-producer and bought-and-made good, the raw cost of
 * the line without each of its sources (a recipe banned, or the purchase barred). A source the line can drop within
 * `costTol` makes the multi-producer an `error` (the plan uses more recipes than it needs; a `warn` with fewer than two
 * main producers) and the purchase or the making an `error` (a `warn` where no step makes the good as its main output);
 * otherwise each stays `info` with the extra cost. With `opts.buildCost` (controller ruling 249) such a source is an
 * `info` with `data.needsMachine` only where the plan's machines cannot do without it: for a producer, where the same ban
 * test with every step held to the machines the plan gives it (`heldBy`) is infeasible or dearer than that held test
 * with nothing dropped; for a purchase, where the steps making the good are full (making the rest needs another
 * machine; ruling 183 (4) forbids a tie purchase beside a step with room). A producer the line can drop within its
 * machines keeps the `error` where that saves a machine block the build cost counts (`savesBlock`) and is a `warn`
 * where it saves none (owned machines, or a pool that keeps its count): a tie the objective cannot see — for owned
 * machines no longer quite so since ledger 265, under which each owned block pays OWNED_STEP_SHARE of the step charge
 * (build-mip.ts); this severity rule is left to the final review.
 */
export async function checkPlanInvariantsDeep(pack: Pack, settings: PlanSettings, plan: Plan, opts: DeepOptions = {}): Promise<Violation[]> {
  const base = checkPlanInvariants(pack, settings, plan, opts);
  if (plan.status !== 'ok' || settings.target === null || settings.mode !== 'rate') return base;
  const relTol = opts.relTol ?? 1e-6;
  const costTol = opts.costTol ?? 1e-6;
  const buildCost = opts.buildCost === true;
  const ctx = opts.ctx ?? { ownedMachines: [], storage: new Map(), visitedDims: [], topTier: null, coilHeat: null, prospected: [] };
  const pricing = linePricing(pack, settings, ctx);
  if (pricing === null) return base;
  const { graph } = await pricing;
  const demand = new Map([[settings.target, targetDemand(settings, plan)]]);
  const optimum = await leastRawCost(graph, demand);
  const planCost = plan.rawInputs.reduce((s, r) => s + r.cost, 0);
  const extra: Violation[] = [];
  if (optimum.status !== 'optimal') {
    extra.push({ kind: 'cost', severity: 'error', message: `the line's own graph has no least-raw-material solution at a normalized demand (${optimum.status}) while the plan is ok` });
    return [...base, ...extra];
  }
  const relGap = (planCost - optimum.cost) / Math.max(optimum.cost, 1e-300);
  const roundingCost = plan.rawInputs.reduce((sum, r) => sum + ROUND_REL * Math.abs(r.cost), 0);
  const slack = Math.max(roundingCost, 1e-6 * optimum.cost);
  // With a step charge the plan may pay up to the cap in raw material to save steps; never less than the optimum. With
  // build cost counted the cap applies only when build cost is ignored (plan 12, architecture §11.39 amending §11.34).
  const charged = (opts.stepCharge ?? 0) > 0;
  const ceiling = buildCost ? Infinity : optimum.cost * (1 + (charged ? STEP_CHARGE_CAP : 0));
  if (optimum.cost - planCost > slack || planCost - ceiling > slack) {
    extra.push({
      kind: 'cost', severity: 'error',
      message: planCost < optimum.cost
        ? `the plan's raw cost ${sci(planCost)}/s is BELOW the true optimum ${sci(optimum.cost)}/s (${(relGap * 100).toPrecision(3)}%): it gets material from LP tolerance`
        : `the plan's raw cost ${sci(planCost)}/s is above the optimum ${sci(optimum.cost)}/s (+${(relGap * 100).toPrecision(3)}%${charged ? `, more than the step charge's +${STEP_CHARGE_CAP * 100}%` : ''})`,
      data: { planCost, optimum: optimum.cost, relGap, ...(charged ? { stepCharge: opts.stepCharge, cap: STEP_CHARGE_CAP } : {}) },
    });
  } else {
    const above = planCost - optimum.cost > slack;
    const within = buildCost && above
      ? `is +${(relGap * 100).toPrecision(3)}% on the optimum ${sci(optimum.cost)}/s, raw material the build cost of the machines it saves pays for`
      : charged && above
        ? `is +${(relGap * 100).toPrecision(3)}% on the optimum ${sci(optimum.cost)}/s, within the step charge's +${STEP_CHARGE_CAP * 100}%`
        : `matches the optimum ${sci(optimum.cost)}/s`;
    extra.push({ kind: 'cost', severity: 'info', message: `raw cost ${sci(planCost)}/s ${within}`, data: { planCost, optimum: optimum.cost, relGap, ...(buildCost ? { buildCost } : {}) } });
  }
  // Removing a source from the plan: over the plan's own recipes when they meet the demand in an exact LP, else (the
  // plan only works through LP tolerance) over the whole graph.
  const planRecipes = new Set(plan.steps.map((s) => s.recipeId));
  const own = await leastRawCost(graph, demand, { allowed: planRecipes });
  const ownFeasible = own.status === 'optimal';
  if (!ownFeasible) {
    extra.push({
      kind: 'cost', severity: 'error',
      message: `the plan's own recipes cannot meet the demand in an exact LP (${own.status}): the plan only balances through LP tolerance`,
    });
  } else if (own.cost > optimum.cost * (1 + costTol) + 1e-15) {
    extra.push({
      kind: 'cost', severity: 'warn',
      message: `the plan's own recipes cost ${sci(own.cost)}/s at best, the graph's optimum is ${sci(optimum.cost)}/s`,
      data: { ownCost: own.cost },
    });
  }
  const refCost = ownFeasible ? own.cost : optimum.cost;
  const cache = new Map<string, number>();
  const costWithout = async (recipes: readonly string[], key?: StuffKey): Promise<number> => {
    const id = `${recipes.join(',')}|${key ?? ''}`;
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const notBuyable = key === undefined ? undefined : new Set([key]);
    const r = ownFeasible
      ? await leastRawCost(graph, demand, { allowed: new Set([...planRecipes].filter((x) => !recipes.includes(x))), ...(notBuyable ? { notBuyable } : {}) })
      : await leastRawCost(graph, demand, { banned: new Set(recipes), ...(notBuyable ? { notBuyable } : {}) });
    cache.set(id, r.cost);
    return r.cost;
  };
  const delta = (cost: number): number => (Number.isFinite(cost) ? (cost - refCost) / Math.max(refCost, 1e-300) : Infinity);
  const pct = (d: number): string => (Number.isFinite(d) ? `+${(d * 100).toPrecision(3)}%` : 'infeasible');
  const over = ownFeasible ? "the plan's other recipes" : 'the whole graph (the plan alone is infeasible)';
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  // With build cost counted (controller ruling 249): the ban test again with every step held to the machines the plan
  // gives it, against that held test with nothing dropped — over the plan's own recipes, when they meet the demand at all.
  const held = buildCost && ownFeasible ? heldBy(plan, relTol) : undefined;
  let heldBase: Promise<S1Result> | undefined;   // solved when a source is first tested
  /**
   * Whether the line without `recipeId` cannot do within the plan's machines at the raw material it uses within them;
   * false where the plan's own runs do not fit its machines in an exact LP (`heldBase`'s status says so).
   */
  const needsMachine = async (recipeId: string): Promise<boolean> => {
    if (held === undefined) return false;
    heldBase ??= leastRawCost(graph, demand, { allowed: planRecipes, held });
    const within = await heldBase;
    if (within.status !== 'optimal') return false;
    const r = await leastRawCost(graph, demand, { allowed: new Set([...planRecipes].filter((x) => x !== recipeId)), held });
    return r.status !== 'optimal' || r.cost > within.cost * (1 + costTol) + 1e-15;
  };
  for (const v of base) {
    if (v.kind === 'multi-producer' && v.key !== undefined) {
      const producers = (v.data?.producers ?? []) as ProducerInfo[];
      const mains = producers.filter((p) => p.isMain).length;
      const tests: Array<{ stepId: string; map: string; share: number; isMain: boolean; costWithout: number; delta: number }> = [];
      for (const p of producers) {
        const c = await costWithout([p.recipeId]);
        tests.push({ stepId: p.stepId, map: p.map, share: p.share, isMain: p.isMain, costWithout: c, delta: delta(c) });
      }
      const removable = tests.filter((t) => t.delta <= costTol);
      const names = (list: typeof tests): string => list.map((t) => `${t.map} (${(t.share * 100).toPrecision(3)}% of it)`).join(' or ');
      v.data = { ...v.data, banTests: tests, over, ...(buildCost ? { buildCost } : {}) };
      if (removable.length > 0 && buildCost) {
        // Controller ruling 249: one machine of A beside a cheaper machine of B for the rest is a build-cost plan where A's
        // machines cannot take B's share; dropped within the plan's machines, B saves its machine block, or nothing.
        const heldTests: Array<{ stepId: string; needsMachine: boolean; savesBlock: boolean }> = [];
        for (const t of removable) {
          const step = stepById.get(t.stepId) as PlanStep;
          heldTests.push({ stepId: t.stepId, needsMachine: await needsMachine(step.recipeId), savesBlock: savesBlock(plan, step) });
        }
        const droppable = removable.filter((t) => heldTests.some((x) => x.stepId === t.stepId && !x.needsMachine));
        const saving = droppable.filter((t) => heldTests.some((x) => x.stepId === t.stepId && x.savesBlock));
        const within = held === undefined ? 'not run' : (await (heldBase as Promise<S1Result>)).status;
        v.data = { ...v.data, heldTests, heldBase: within, ...(droppable.length === 0 ? { needsMachine: true } : {}) };
        if (droppable.length === 0) {
          v.severity = 'info';
          v.message += ` — redundant in raw material alone: over ${over}, the line without ${names(removable)} costs the same raw material, but not within the plan's machines: dropping it needs another machine`;
        } else if (saving.length > 0) {
          v.severity = mains >= 2 ? 'error' : 'warn';
          v.message += ` — REDUNDANT: over ${over}, the line without ${names(saving)} costs the same within the plan's machines, and saves a machine block the build cost counts`;
        } else {
          v.severity = 'warn';
          v.message += ` — redundant: over ${over}, the line without ${names(droppable)} costs the same within the plan's machines, but saves no new machine (owned machines, or a pool that keeps its count): a tie the build cost cannot see`;
        }
      } else if (removable.length > 0) {
        v.severity = mains >= 2 ? 'error' : 'warn';
        v.message += ` — REDUNDANT: over ${over}, the line without ${names(removable)} costs the same`;
      } else {
        v.severity = 'info';
        v.message += ` — justified: dropping any one costs more (${tests.map((t) => `${t.map} ${pct(t.delta)}`).join(', ')})`;
      }
    } else if (v.kind === 'bought-and-made' && v.key !== undefined && !FREE.has(v.key)) {
      const key = v.key;
      const producers = Object.keys((v.data?.producers ?? {}) as Record<string, number>);
      const recipeIds = producers.map((id) => stepById.get(id)?.recipeId).filter((x): x is string => x !== undefined);
      const dBuy = delta(await costWithout([], key));
      const dMake = delta(await costWithout(recipeIds));
      v.data = { ...v.data, deltaWithoutBuying: dBuy, deltaWithoutMaking: dMake, over, ...(buildCost ? { buildCost } : {}) };
      // Important A, controller ruling 249: with build cost counted, buying the rest beside steps whose machines are full
      // saves the machine making it would add; beside a step with room, ruling 183 (4) has the line make it instead.
      const full = producers.every((id) => {
        const step = stepById.get(id);
        return step !== undefined && fullness(plan, step) >= 1 - relTol;
      });
      if ((dBuy <= costTol || dMake <= costTol) && buildCost && full) {
        v.severity = 'info';
        v.data = { ...v.data, needsMachine: true };
        v.message += ` — redundant in raw material alone: over ${over}, ${dBuy <= costTol ? 'not buying it' : 'not making it'} costs the same raw material (without buying ${pct(dBuy)}, without making ${pct(dMake)}), but the steps making it are full: making the rest needs another machine`;
      } else if (dBuy <= costTol || dMake <= costTol) {
        // Buying the shortfall of a byproduct is a tie by construction (derived leaves cost what making them costs); a
        // step run to make the good while the line also buys it is not.
        const mainProducer = producers.some((id) => stepById.get(id)?.mainOutput === key);
        v.severity = mainProducer ? 'error' : 'warn';
        v.message += ` — REDUNDANT: over ${over}, ${dBuy <= costTol ? 'not buying it' : 'not making it'} costs the same (without buying ${pct(dBuy)}, without making ${pct(dMake)})${buildCost ? ', and a step making it has room for more within its machines' : ''}`;
      } else {
        v.severity = 'info';
        v.message += ` — justified (without buying ${pct(dBuy)}, without making ${pct(dMake)})`;
      }
    }
  }
  if (opts.marginal === true) extra.push(...(await marginalChains(pack, plan, graph, demand, optimum.cost, costTol, opts.marginalShare ?? 0.01, opts.marginalBudgetSeconds ?? 120)));
  return [...base, ...extra];
}

/**
 * Steps the plan does not need, and chains it adds for little: for each step, the line with only the plan's other
 * recipes (and purchases); at no extra raw cost that step is `redundant` (error). Then each step's exclusive upstream
 * (the step and every step whose flows, sinks aside, all go into that set) of 2+ steps is priced over the whole graph:
 * when dropping it costs less than `share` more raw material and a sparse solve of the line then runs fewer recipes
 * than the same sparse solve without the ban, the chain is `marginal` (warn), with the steps it saves.
 */
async function marginalChains(
  pack: Pack, plan: Plan, graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>, optimum: number, costTol: number, share: number,
  budgetSeconds: number,
): Promise<Violation[]> {
  const started = performance.now();
  const outOfTime = (): boolean => (performance.now() - started) / 1000 > budgetSeconds;
  const out: Violation[] = [];
  const stepById = new Map(plan.steps.map((s) => [s.id, s]));
  const planRecipes = new Set(plan.steps.map((s) => s.recipeId));
  const target = [...demand.keys()][0];
  const own = await leastRawCost(graph, demand, { allowed: planRecipes });
  const ownCost = own.status === 'optimal' ? own.cost : Infinity;
  // (1) redundant steps: the plan's other recipes cover them at no extra cost (only when they meet the demand at all).
  for (const s of Number.isFinite(ownCost) ? plan.steps : []) {
    const allowed = new Set([...planRecipes].filter((id) => id !== s.recipeId));
    const r = await leastRawCost(graph, demand, { allowed });
    const d = Number.isFinite(r.cost) ? (r.cost - ownCost) / Math.max(ownCost, 1e-300) : Infinity;
    if (d <= costTol) {
      out.push({
        kind: 'marginal', severity: 'error', stepId: s.id,
        message: `REDUNDANT step ${stepLabel(pack, plan, s)}: the plan's other recipes cover it at no extra raw cost (Δ ${d.toExponential(1)}; it runs ${sci(s.runsPerSecond)}/s, ${(s.utilization * 100).toPrecision(3)}% busy)`,
        data: { delta: d, runsPerSecond: s.runsPerSecond },
      });
    }
  }
  // (2) marginal chains over the whole graph.
  const outTo = new Map<string, Set<string>>();
  for (const f of plan.flows) {
    if (!stepById.has(f.from) || f.to === SINK) continue;
    let set = outTo.get(f.from);
    if (set === undefined) {
      set = new Set();
      outTo.set(f.from, set);
    }
    set.add(f.to);
  }
  const baseSparse = await leastRawCost(graph, demand, { sparse: true });
  // Recipes saved are counted from the sparser of the plan and the same sparse solve without bans (the solve is a
  // heuristic: it may keep more recipes than the planner's fewest-recipes stage did).
  const baseCount = Math.min(baseSparse.support?.size ?? Infinity, plan.steps.length);
  const chains = new Map<string, Set<string>>();
  for (const root of plan.steps) {
    if (root.outputs.some((p) => p.key === target)) continue;   // the target's own step cannot go
    const set = new Set([root.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const s of plan.steps) {
        if (set.has(s.id)) continue;
        const to = outTo.get(s.id);
        if (to !== undefined && to.size > 0 && [...to].every((t) => set.has(t))) {
          set.add(s.id);
          grew = true;
        }
      }
    }
    if (set.size >= 2) chains.set([...set].sort().join(','), set);
  }
  if (baseSparse.status !== 'optimal') return out;
  const baseSupport = baseSparse.support ?? new Set<string>();
  if (baseCount < plan.steps.length && Math.abs(baseSparse.cost - optimum) <= costTol * Math.max(optimum, 1e-300)) {
    out.push({
      kind: 'marginal', severity: 'warn',
      message: `a plan of the same raw cost runs ${baseCount} recipes (sparse re-solve), the plan runs ${plan.steps.length}: the fewest-recipes stage left ${plan.steps.length - baseCount} more in`,
      data: { sparseCount: baseCount, planCount: plan.steps.length },
    });
  }
  const name = (id: string): string => {
    const st = plan.steps.find((x) => x.recipeId === id);
    if (st !== undefined) return stepLabel(pack, plan, st);
    const r = graph.recipes.find((x) => x.id === id);
    return `${pack.maps.get(r?.mapId ?? '')?.name ?? r?.mapId ?? id} → ${pack.nameOf(r?.main ?? '')} [${id}]`;
  };
  // Bans to try: every chain of 2+ steps above, and every single step (the sparse re-solve finds what else goes).
  const trials: Array<{ label: string; banned: Set<string> }> = [];
  for (const set of chains.values()) trials.push({ label: 'chain', banned: new Set([...set].map((id) => stepById.get(id)?.recipeId as string)) });
  for (const st of plan.steps) {
    if (st.outputs.some((p) => p.key === target)) continue;
    trials.push({ label: 'step', banned: new Set([st.recipeId]) });
  }
  const found = new Map<string, { banned: Set<string>; delta: number; saved: number; removed: string[]; added: string[] }>();
  let skipped = 0;
  for (const t of trials) {
    if (outOfTime()) {
      skipped++;
      continue;
    }
    const r = await leastRawCost(graph, demand, { banned: t.banned, sparse: true });
    if (r.status !== 'optimal' || r.support === undefined) continue;
    const delta = (r.cost - optimum) / Math.max(optimum, 1e-300);
    const saved = baseCount - r.support.size;
    if (!(delta < share) || saved < 1) continue;
    const removed = [...baseSupport].filter((id) => !(r.support as Set<string>).has(id)).sort();
    const added = [...r.support].filter((id) => !baseSupport.has(id)).sort();
    const id = removed.join(',');
    const prev = found.get(id);
    if (prev === undefined || delta < prev.delta) found.set(id, { banned: t.banned, delta, saved, removed, added });
  }
  // Report the largest savings first; a set of removed recipes inside a larger one found at no smaller cost is folded in.
  const list = [...found.values()].sort((a, b) => b.saved - a.saved || a.delta - b.delta);
  const kept = list.filter((a) => !list.some((b) => b !== a && b.removed.length > a.removed.length && b.delta <= a.delta + 1e-12 && a.removed.every((x) => b.removed.includes(x))));
  if (skipped > 0) out.push({ kind: 'marginal', severity: 'info', message: `${skipped} of ${trials.length} marginal trials skipped (time budget ${budgetSeconds} s)` });
  for (const m of kept) {
    out.push({
      kind: 'marginal', severity: 'warn',
      message: `dropping ${[...m.banned].map(name).join(' + ')} costs only ${m.delta <= costTol ? 'nothing' : `+${(m.delta * 100).toPrecision(3)}%`} raw material and runs ${m.saved} recipe(s) fewer: drops ${m.removed.map(name).join('; ')}${m.added.length > 0 ? ` — adds ${m.added.map(name).join('; ')}` : ''}`,
      data: { banned: [...m.banned], delta: m.delta, recipesSaved: m.saved, removed: m.removed, added: m.added, baseCount, planSteps: plan.steps.length, sparseBase: baseSparse.support?.size },
    });
  }
  return out;
}

/** Violations counted by kind and severity: `{ balance: { error: 2, warn: 1 } }`. */
export function countByKind(violations: readonly Violation[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const v of violations) {
    const k = (out[v.kind] ??= {});
    k[v.severity] = (k[v.severity] ?? 0) + 1;
  }
  return out;
}

