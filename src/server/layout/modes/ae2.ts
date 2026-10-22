// AE2 (Plan 5 Task 8; spec §3.6 mode 3, research gt-mechanics §3.8; the feeding fix, architecture §11 entry 51,
// research machine-feeding §2.3, §3.5 and §6.4 item 3): every machine gets an ME interface on its spine cell, holding one
// processing pattern for each recipe the machine runs (the interface pushes the pattern's inputs into the machine) — a
// shared machine's steps each one, in step order, at most the nine one ME Interface holds (plan 12 Task 6, controller
// Amendment OQ6: past that `ae2_patterns_short`) — and the machine pushes its output back into the interface with a
// conveyor cover sized to what its steps make. A pattern holds only what
// AE2 can count: the item inputs one run uses up (the line pipes every fluid, a held item stays in the machine, and the
// programmed circuit sits in its ghost slot) and the item outputs every run gives in whole numbers (a chanced byproduct
// still goes back into ME through the cover). A machine with neither gets no pattern: one that makes only fluids an ME
// Export Bus on the cable in front of it, filtered to its inputs (with a Capacity Card for every four items past the
// first and Acceleration Cards for its rate; AE2 rv3-beta-1073-GTNH `PartExportBus`, `PartSharedItemBus`); one that takes
// only fluids, or whose item outputs all come by chance, an interface for what it makes and nothing that feeds it; each
// with an `ae2_no_pattern` warning that the line then relies on stock or your hands. A crafting CPU pushes a pattern
// only as often as a job needs what the pattern makes, never for a fluid the line pipes from it to another machine, so a
// machine with a pattern whose fluid another machine waits for, and whose items no job of the line needs as often as
// that fluid is needed, gets an `ae2_fluid_short` warning: that machine must be kept running by you (`aeRunShares`, as
// the pack's crafting calculator plans a job: a loop of patterns until it would come back to a pattern above; a loop
// with too many ways round to follow gets a lower and an upper bound, and the warning says "at most" where they differ).
// Blocking mode is on (the next set goes in once a run has taken the last) unless the machine holds an item AE2's
// blocking-ignore list leaves out, which blocking mode would wait on for ever (GT's
// `AE2Compat.registerBlockingModeIgnoreItems`: the programmed circuit, its molds, extruder shapes, slicer blades and
// lenses; not the Packager's schematics), and never toward an Auto Workbench, whose ghost crafting grid blocking mode
// counts as items (controller ruling 204 (1)). ME glass cable fills the rest of the spine, the tail included, where the
// base's ME network joins the line. Each interface or bus takes a channel, so the line is checked against the channels
// the network has free. The patterns are the interfaces' structured `feed`, and an export bus's filter and cards the
// `feed.exportBus` of the cable it sits on (architecture §11 entry 51). Without an AE2 network at the base the ME parts
// cannot work: the layout says so and never assumes one. A machine run by hand gets no interface, and a venting steam
// machine gets its interface on its middle-row side but no cover, as GT allows none on it (architecture §11 entry 48;
// by-hand.ts says what is then moved by hand).

import { ignoredByBlocking } from '../../../shared/gt/feeding.ts';
import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { fmtInt, joinNames } from '../../../shared/layout/format.ts';
import { posKey, sideToward, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { ExportBusSpec, PatternSpec } from '../../../shared/types/feed.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, Plan, PlanStep, PlanWarning } from '../../../shared/types/plan.ts';
import { stepOneOffs } from '../../planner/bom.ts';
import { AE2_POOL_MAX_PATTERNS, isAutoWorkbench } from '../../planner/machine-options.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostCover, LocalBlock, PlacedUnit } from '../arrange.ts';
import { benchPattern } from '../bench.ts';
import { linkBits } from '../path.ts';
import {
  conveyorCover, emptyModeResult, feedSettings, itemPorts, itemRisers, lineExceptions, mergeHostConfigs, nameList, outputSideInputs, placedStepIds,
  RISER_WORDS, unitItemRate, unitSteps, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

/** A network whose scan gives no channel figures is taken to have the 8 channels of a network without a controller. */
const DEFAULT_CHANNELS_MAX = 8;

// ---- What AE2 can count (research machine-feeding §2.3, §3.5) ----

/**
 * Whether AE2's blocking mode ignores `key` in a machine (shared/gt/feeding.ts, which the planner reads too: controller
 * ruling 214 (b)).
 */
export { ignoredByBlocking };

/** "1× A" amounts summed per key, in first-seen order. */
function summed(list: ReadonlyArray<{ key: StuffKey; amount: number }>): Array<{ key: StuffKey; amount: number }> {
  const sums = new Map<StuffKey, number>();
  for (const { key, amount } of list) sums.set(key, (sums.get(key) ?? 0) + amount);
  return [...sums].map(([key, amount]) => ({ key, amount }));
}

/**
 * The items one run of the step uses up, in whole numbers: per consumed item slot of its recipe, the option the line
 * uses most there (`step.inputs`; the slot's first on a tie) at its recipe amount; without the recipe, `step.inputs`'s
 * items at their amount over their chance. Fluids, held items and the programmed circuit are left out (the line pipes
 * the fluids, and the others are not used up).
 */
function patternInputs(pack: Pack, step: PlanStep): PatternSpec['inputs'] {
  const used = new Map(step.inputs.filter((p) => !isFluidKey(p.key)).map((p) => [p.key, p.amount]));
  const recipe = pack.recipeById.get(step.recipeId);
  if (recipe === undefined) {
    return summed(step.inputs.filter((p) => !isFluidKey(p.key))
      .map((p) => ({ key: p.key, amount: Math.round((p.chance > 0 ? p.amount / p.chance : p.amount) * 1e9) / 1e9 })));
  }
  const picks = recipe.inputs.filter((ing) => ing.consumed).flatMap((ing) => {
    const options = ing.options.filter((o) => !isFluidKey(o.key) && used.has(o.key));
    const best = options.reduce<(typeof options)[number] | undefined>((b, o) => (b === undefined || used.get(o.key)! > used.get(b.key)! ? o : b), undefined);
    return best === undefined ? [] : [{ key: best.key, amount: best.amount }];
  });
  return summed(picks);
}

/** The item outputs every run gives (chance 1), summed per key. */
function patternOutputs(step: PlanStep): PatternSpec['outputs'] {
  return summed(step.outputs.filter((p) => !isFluidKey(p.key) && p.chance >= 1));
}

/** How a step's machine is fed: by a pattern, by an export bus, or not at all (and why). */
type StepFeed =
  | { kind: 'pattern'; pattern: PatternSpec; blocking: boolean }
  | { kind: 'export_bus'; keys: StuffKey[] }
  | { kind: 'none'; why: 'fluid_in' | 'chanced' };

/**
 * Whether blocking mode can push into the step's machine: never into an Auto Workbench, whose every slot GT's
 * `GTItemSink` counts, its ghost crafting grid included, so a blocking interface waits for a bench whose grid is set for
 * ever (research machine-feeding §1.3.6, §2.3; controller ruling 204 (1)); else only when the machine holds nothing
 * blocking mode does not ignore (`ignoredByBlocking`).
 */
function blocksInto(pack: Pack, step: PlanStep): boolean {
  if (isAutoWorkbench(pack.machines.get(step.machine.mteId))) return false;
  return stepOneOffs(pack, step).every((held) => ignoredByBlocking(pack, held.key));
}

function stepFeed(pack: Pack, step: PlanStep): StepFeed {
  const inputs = patternInputs(pack, step);
  const outputs = patternOutputs(step);
  if (inputs.length > 0 && outputs.length > 0) return { kind: 'pattern', pattern: { inputs, outputs }, blocking: blocksInto(pack, step) };
  if (inputs.length > 0 && !step.outputs.some((p) => !isFluidKey(p.key))) return { kind: 'export_bus', keys: inputs.map((i) => i.key).sort() };
  return { kind: 'none', why: inputs.length > 0 ? 'chanced' : 'fluid_in' };
}

// ---- What AE2 runs (research machine-feeding §2.3 "Jobs", §4.2 item 2; AE2 rv3-beta-1073-GTNH's crafting calculator) ----

/** A run share this far below 1 still counts as every planned run: the plan's flows are sums of floating rates. */
const SHARE_EPSILON = 1e-6;
/**
 * The most sets of patterns above a step that `aeRunShares` counts exactly in one loop of patterns (the steps whose runs
 * can be asked for through the same patterns). A job can come round a loop by any set of its patterns, so a dense loop
 * has a set for every way round it (k cell fillers and k emptiers pooled: about k² × 2^(k−1), some nine million for
 * k = 16). The real-data corpus lines need at most about 60,000 in one loop, and the two past this many get the same
 * percentages from both bounds as from a full count, as the sets nearest the requests decide them.
 */
export const AE_SHARE_SETS_MAX = 20_000;

/**
 * A step's share of its planned runs (`aeRunShares`): what the jobs ask for at most (`share`) and at least (`low`), the
 * same but where a loop of patterns had more sets than `aeRunShares` counts exactly.
 */
export interface RunShare { share: number; low: number }

const NO_RUNS: RunShare = Object.freeze({ share: 0, low: 0 });

/** The number of patterns in a set. */
function setSize(set: bigint): number {
  let n = 0;
  for (let rest = set; rest !== 0n; rest &= rest - 1n) n += 1;
  return n;
}

/**
 * A flow of a pattern output that a request answers: what it carries, the step with a pattern that asks for it (its
 * index; -1: a job's own request, for all of it), and how much that step's pattern asks for each unit of it the plan
 * feeds the step (its amount a run over the plan's: 1 but for an input used up by chance or a slot whose options the
 * plan splits).
 */
interface RunAsk { perSecond: number; to: number; scale: number }

/**
 * The share of its planned runs AE2 gives each step with a pattern at most, 0 to 1 (fewer where a job finds the items
 * in your storage, which it takes before it crafts any; but see the byproducts below), as the pack's crafting
 * calculator plans its jobs (`CraftingJobV2`, which `CraftingGridCache.beginCraftingJob` starts unless lite crafting is
 * on; AE2 rv3-beta-1073-GTNH, read with javap). A crafting CPU pushes a pattern only for a job, never for a fluid the
 * line pipes on. A job crafts what it is asked for: the line's product (`out`), or what something AE2 does not run
 * itself takes (a step without a pattern, a step the line places no machine for, a machine run by hand: you keep those
 * going), all of it. Each run of a pattern asks for the pattern's inputs at the pattern's amounts (none for an item the
 * plan sends it that its pattern does not take), which the plan's flows into it split among its suppliers (raw inputs
 * and what a step without a pattern makes come from storage; AE2 itself gives a request to the first pattern that makes
 * it, by priority and then the network's order, which the layout cannot know, so the plan's split stands for it). A
 * request is crafted by a pattern that makes it, but never by one already above it in the job: `CraftFromPatternTask`
 * adds its pattern to its request's `patternParents` before it asks for its inputs, `CraftingContext.doWork` copies
 * them into each input's request, and `CraftableItemResolver` drops them from that request's patterns (patterns compare
 * by what they encode, `PatternHelper.equals`). So a loop of patterns (cells emptied and filled again) is planned until
 * it would come back to a pattern above, and that item comes from storage. A step runs as often as its most-asked-for
 * pattern output needs (its other outputs go to the job's byproducts, which `ExtractItemTask` takes before anything is
 * crafted again), and nothing of what goes to your storage (`sink`) asks. That is a second approximation where other
 * steps also make such a byproduct: the job's byproducts (`context.byproductsInventory`) go to whichever of its
 * requests for the item `ExtractItemTask` meets first, not to the one the plan's flows send them to, so a request the
 * plan meets with a byproduct can be crafted after all, and a step whose pattern makes that item can run more often
 * than its share says (its share is then no upper bound). The sets of patterns above a step are counted breadth first
 * from every step, at most `setsMax` in one loop of patterns (`AE_SHARE_SETS_MAX`), so the sets nearest the jobs'
 * requests come first; a set past them counts as asking for nothing at least (`RunShare.low`) and at most for a cheap
 * upper bound (`RunShare.share`): its share counted along every chain of requests no longer than the patterns it could
 * still be asked through, even a chain that comes back to a pattern above (which AE2 never plans), so never below what
 * the jobs ask for. `ae2_fluid_short` says "at most" where the two give different percentages.
 */
export function aeRunShares(plan: Plan, patterns: ReadonlyMap<string, PatternSpec>, setsMax = AE_SHARE_SETS_MAX): Map<string, RunShare> {
  const ids = [...patterns.keys()];
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  // each distinct pattern as a bit of a set, as AE2 tells patterns apart
  const kinds = new Map<string, bigint>();
  const bit = ids.map((id) => {
    const text = JSON.stringify(patterns.get(id));
    if (!kinds.has(text)) kinds.set(text, 1n << BigInt(kinds.size));
    return kinds.get(text)!;
  });
  const runsOf = new Map(plan.steps.map((s) => [s.id, s.runsPerSecond]));
  const fed = (to: string, key: StuffKey): number => plan.flows.reduce((n, f) => (f.to === to && f.key === key ? n + f.perSecond : n), 0);
  // per step, per pattern output it makes: what it makes of it and the flows of it a request answers
  const outputs = ids.map((id) => patterns.get(id)!.outputs.flatMap(({ key }) => {
    const flows = plan.flows.filter((f) => f.from === id && f.key === key && f.perSecond > 0);
    const made = flows.reduce((n, f) => n + f.perSecond, 0);
    const asks = flows.flatMap((f): RunAsk[] => {
      if (f.to === 'sink') return [];
      const consumer = patterns.get(f.to);
      if (consumer === undefined) return [{ perSecond: f.perSecond, to: -1, scale: 1 }];
      const ratio = (consumer.inputs.find((i) => i.key === key)?.amount ?? 0) * (runsOf.get(f.to) ?? 0) / fed(f.to, key);
      // the plan's rates are floating sums: a pattern that asks what the plan feeds asks exactly that
      const scale = Math.abs(ratio - 1) < SHARE_EPSILON ? 1 : ratio;
      return scale > 0 ? [{ perSecond: f.perSecond, to: indexOf.get(f.to)!, scale }] : [];
    });
    return made > 0 ? [{ made, asks }] : [];
  }));
  // the patterns a step's runs can be asked for through (its own among them): only these of the ones above it matter,
  // and the steps of one loop share them
  const through = ids.map((_, i) => {
    const seen = new Set([i]);
    for (const at of seen) for (const o of outputs[at]!) for (const a of o.asks) if (a.to >= 0) seen.add(a.to);
    return [...seen].reduce((set, s) => set | bit[s]!, 0n);
  });
  /** Step `i`'s share at most and at least, given that `of` each step with a pattern that asks for what it makes. */
  const asked = (i: number, of: (to: number) => RunShare): RunShare => {
    let share = 0, low = 0;
    for (const { made, asks } of outputs[i]!) {
      let most = 0, least = 0;
      for (const a of asks) {
        if (a.to < 0) {
          most += a.perSecond;
          least += a.perSecond;
        } else {
          const r = of(a.to);
          most += a.perSecond * (a.scale * r.share);
          least += a.perSecond * (a.scale * r.low);
        }
      }
      share = Math.max(share, most / made);
      low = Math.max(low, least / made);
    }
    return { share: Math.min(1, share), low: Math.min(1, low) };
  };
  // the sets above each step counted exactly (null until counted): breadth first from every step, at most `setsMax` in
  // one loop, so the sets nearest the requests come first
  const counted = ids.map(() => new Map<bigint, RunShare | null>());
  const used = new Map<bigint, number>();
  const queue: Array<readonly [number, bigint]> = [];
  const admit = (i: number, above: bigint): void => {
    const loop = through[i]!;
    const key = above & loop;
    const n = used.get(loop) ?? 0;
    if (counted[i]!.has(key) || n >= setsMax) return;
    used.set(loop, n + 1);
    counted[i]!.set(key, null);
    queue.push([i, key]);
  };
  for (let i = 0; i < ids.length; i++) admit(i, 0n);
  for (let q = 0; q < queue.length; q++) {
    const [i, above] = queue[q]!;
    const next = above | bit[i]!;
    for (const o of outputs[i]!) for (const a of o.asks) if (a.to >= 0 && (next & bit[a.to]!) === 0n) admit(a.to, next);
  }
  // the upper bound of a set past them: per step, the share counted along every chain of at most m requests, m = 0, 1, …
  // up to the most patterns a step can be asked through, whatever is above (each round is never below the one before)
  let chains: RunShare[][] | null = null;
  const upperBound = (i: number, free: number): number => {
    if (chains === null) {
      const rounds = Math.max(...through.map(setSize));
      const byStep = ids.map(() => [NO_RUNS]);
      for (let m = 1; m <= rounds; m++) for (let s = 0; s < ids.length; s++) byStep[s]!.push(asked(s, (to) => byStep[to]![m - 1]!));
      chains = byStep;
    }
    return chains[i]![free]!.share;
  };
  /**
   * The share of step `i`'s planned runs asked for by the requests whose job reaches them through none of the patterns
   * `above` (none at all where the step's own pattern is one of them): what goes to a job's own request in full, and
   * what goes to a step with a pattern at that step's share through none of `above` nor the step's own pattern; for a set
   * not counted exactly, nothing at least and the upper bound of a chain as long as the patterns it can still be asked
   * through at most.
   */
  const share = (i: number, above: bigint): RunShare => {
    if ((above & bit[i]!) !== 0n) return NO_RUNS;
    const loop = through[i]!;
    const known = counted[i]!.get(above & loop);
    if (known === undefined) return { share: upperBound(i, setSize(loop & ~above)), low: 0 };
    if (known !== null) return known;
    const next = above | bit[i]!;
    const result = asked(i, (to) => share(to, next));
    counted[i]!.set(above & loop, result);
    return result;
  };
  return new Map(ids.map((id, i) => [id, share(i, 0n)]));
}

// ---- The ME Export Bus ----

/** Items one operation of an ME Export Bus moves with 0–4 Acceleration Cards (AE2 rv3 `PartExportBus.calculateAmountToSend`). */
const EXPORT_ITEMS_PER_OP: readonly number[] = [1, 8, 32, 64, 96];
/**
 * The time an ME Export Bus is counted to take per operation while its machine needs items, 10 ticks: it runs every 5
 * to 60 ticks (the pack's AppliedEnergistics2.cfg `ExportBus.min/max`), 2 ticks sooner after an operation that moved
 * items and 1 tick later after one that did not (AE2 rv3 `TickManagerCache`: FASTER, SLOWER), so it keeps up with a
 * machine that takes up to four operations' worth a second; half that leaves room.
 */
const EXPORT_SECONDS_PER_OP = 0.5;
/** Filter slots: 1, and 4 more per Capacity Card, at most 2 (AE2 rv3 `PartSharedItemBus.availableSlots`, a 9-slot config). */
const EXPORT_MAX_CAPACITY_CARDS = 2;
/** An export bus's Acceleration Cards: an index of `EXPORT_ITEMS_PER_OP`. */
type AccelerationCards = NonNullable<ExportBusSpec['cards']>;

/** The cards an export bus needs for `kinds` items at `rate` items/s; `short` when even the most cannot. */
function exportCards(kinds: number, rate: number): { capacity: number; acceleration: AccelerationCards; short: boolean } {
  const capacity = Math.min(EXPORT_MAX_CAPACITY_CARDS, Math.ceil(Math.max(0, kinds - 1) / 4));
  const need = rate * EXPORT_SECONDS_PER_OP;
  const found = EXPORT_ITEMS_PER_OP.findIndex((n) => n >= need);
  const acceleration = (found === -1 ? EXPORT_ITEMS_PER_OP.length - 1 : found) as AccelerationCards;
  return { capacity, acceleration, short: found === -1 || kinds > 1 + 4 * EXPORT_MAX_CAPACITY_CARDS };
}

/** Σ item flows into the steps a unit runs (`unitSteps`) ÷ its first step's count: the items/s each of its machines takes. */
function unitIntakeRate(plan: Plan, u: PlacedUnit): number {
  const steps = unitSteps(u);
  const count = plan.steps.find((s) => s.id === steps[0])?.count ?? 1;
  const items = plan.flows.reduce((sum, f) => (steps.includes(f.to) && !isFluidKey(f.key) ? sum + f.perSecond : sum), 0);
  return items / Math.max(1, count);
}

// ---- Warnings ----

/** What a step makes, for the words: its main output, else its first output (its id when it has neither). */
function stepProduct(plan: Plan, id: string): StuffKey {
  const s = plan.steps.find((x) => x.id === id);
  return s?.mainOutput ?? s?.outputs[0]?.key ?? id;
}

/** What `ae2_fluid_short` adds to a share it counts only at most (`RunShare.low` gives another percentage). */
const AT_MOST_WORDS = " (the line's patterns loop round in too many ways for the layout to follow every job, so it counts some runs AE2 never plans)";

/** A share as a percentage, as `ae2_fluid_short` words it. */
function percentWords(share: number): string {
  return share < 0.01 ? 'less than 1' : fmtInt(Math.floor(share * 100));
}

function noPatternText(input: ModeInput, step: PlanStep, unit: PlacedUnit, feed: Exclude<StepFeed, { kind: 'pattern' }>): string {
  const { pack, plan } = input;
  const keysOf = (list: readonly { key: StuffKey }[], fluid: boolean) => [...new Set(list.filter((p) => isFluidKey(p.key) === fluid).map((p) => p.key))];
  const n = input.placement.units.filter((u) => u.stepId === unit.stepId).length;
  const machine = `the ${unit.name}${n > 1 ? ` (${fmtInt(n)}×)` : ''}`;
  if (feed.kind === 'export_bus') {
    const names = nameList(plan, pack, feed.keys);
    return `AE2 cannot plan ${machine}: it makes only ${nameList(plan, pack, keysOf(step.outputs, true))}, which the line pipes on, so no pattern can `
      + `count what it makes. An ME Export Bus on the cable in front of it feeds it ${names} whenever your ME storage holds some, so the line relies `
      + `on that stock: keep ${names} in storage`;
  }
  if (feed.why === 'chanced') {
    const inputs = keysOf(step.inputs, false);
    return `AE2 cannot plan ${machine}: what it makes (${nameList(plan, pack, keysOf(step.outputs, false))}) comes by chance, which no pattern can `
      + `count, so it gets no pattern and nothing pushes ${nameList(plan, pack, inputs)} into it: put ${inputs.length === 1 ? 'it' : 'them'} in by hand; `
      + 'what it makes still goes back into your ME storage';
  }
  const fluids = keysOf(step.inputs, true);
  const back = `goes back into your ME storage, so jobs that need ${nameList(plan, pack, keysOf(step.outputs, false))} rely on stock`;
  if (fluids.length === 0) {
    // it uses up nothing: a rock breaker's supply recipe (water and lava beside it), GT++'s Algae Farm or Fish Pond
    return pack.recipeById.get(step.recipeId)?.meta.supply === 'rock-breaker'
      ? `AE2 cannot plan ${machine}: it takes nothing, it runs on the water and lava beside it, so no pattern has anything to push into it. `
        + `What it makes ${back}`
      : `AE2 cannot plan ${machine}: it takes nothing, so no pattern has anything to push into it. It runs by itself and what it makes ${back}`;
  }
  return `AE2 cannot plan ${machine}: it takes only ${nameList(plan, pack, fluids)}, which the line pipes in, so no pattern can push anything into `
    + `it. It runs from its pipes and what it makes ${back}`;
}

/**
 * `ae2_fluid_short` for a step with a pattern whose fluid `fluid` the line pipes to `to` (its placed consumers, in flow
 * order) while AE2 runs it for `run.share` of its planned runs: what its pattern makes, how much of the fluid that gives
 * ("at most" where `run.low` would give another percentage), and how to keep it running.
 */
function fluidShortText(input: ModeInput, unit: PlacedUnit, pattern: PatternSpec, fluid: StuffKey, to: readonly string[], run: RunShare): string {
  const { share } = run;
  const atMost = percentWords(run.low) !== percentWords(share);
  const { pack, plan, placement } = input;
  const n = placement.units.filter((u) => u.stepId === unit.stepId).length;
  const machine = `the ${unit.name}${n > 1 ? ` (${fmtInt(n)}×)` : ''}`;
  // each consumer by its machine's name, with what it makes where two share a name
  const names = to.map((id) => placement.units.find((u) => unitSteps(u).includes(id))?.name ?? id);
  const consumers = joinNames(to.map((id, i) => {
    const s = plan.steps.find((x) => x.id === id);
    const key = s?.mainOutput ?? s?.outputs[0]?.key;
    return `the ${names[i]!}${names.filter((m) => m === names[i]).length > 1 && key !== undefined ? ` making ${nameList(plan, pack, [key])}` : ''}`;
  }));
  const made = nameList(plan, pack, pattern.outputs.map((o) => o.key));
  const used = nameList(plan, pack, pattern.inputs.map((i) => i.key));
  const fluidName = nameList(plan, pack, [fluid]);
  const one = to.length === 1;
  const andJobs = `and so does a job that needs what ${one ? 'it makes' : 'they make'}`;
  const runs = share <= 0
    ? `AE2 runs ${machine} only for a job that needs what its pattern makes (${made}), and no job of this line does: so its ${fluidName} never `
      + `reaches ${consumers} by pipe, which ${one ? 'waits' : 'wait'} for it for ever, ${andJobs}`
    : `AE2 runs ${machine} only as often as a job needs what its pattern makes (${made}), ${atMost ? 'at most ' : ''}about ${percentWords(share)} % `
      + `of the runs the ${fluidName} it pipes to ${consumers} needs${atMost ? AT_MOST_WORDS : ''}: so ${one ? 'it runs' : 'they run'} out of `
      + `${fluidName} and ${one ? 'waits' : 'wait'} for ever, ${andJobs}`;
  return `${runs}. Keep the ${unit.name} running yourself: feed it ${used} from stock, keep a request for ${made} standing, or fill it by hand`;
}

// ---- The mode ----

/**
 * The ME spine `[firstX … tailX] × (y 0, z spineZ)`: interfaces with their patterns, or cable with an export bus in front
 * of a machine that makes only fluids, cable between and up the spine's column to an interface above it (`itemRisers`),
 * output covers on the machines. Nothing when no placed unit moves items.
 */
export function ae2Mode(input: ModeInput): ModeResult {
  const { pack, plan, parts, placement, network } = input;
  const { units, firstX, tailX, spineZ } = placement;
  const ports = itemPorts(placement);
  if (ports.length === 0) return emptyModeResult();

  const feeds = new Map<string, StepFeed>();
  const feedOf = (stepId: string): StepFeed | null => {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step === undefined) return null;
    let feed = feeds.get(stepId);
    if (feed === undefined) feeds.set(stepId, feed = stepFeed(pack, step));
    return feed;
  };

  // one interface per item port; the pattern or export bus goes in front of a singleblock, or of a multiblock's input bus
  const blockAt = new Map(placement.blocks.map((b) => [posKey(b.pos), b]));
  const blocks: LocalBlock[] = [];
  const covers: HostCover[] = [];
  const extraParts: BomLine[] = [];
  const warnings: PlanWarning[] = [];
  const portCells = new Set<string>();
  /** How many machines of each name get an export bus, in the order first met. */
  const exportBusFor = new Map<string, number>();
  /** The pattern of each step whose machines get one. */
  const patterned = new Map<string, PatternSpec>();
  /** The units' first steps already told that their interface holds too few patterns, or that blocking mode stays off. */
  const patternsWarned = new Set<string>();
  const unblockedWarned = new Set<string>();
  let patterns = 0, patternedInterfaces = 0, capacityCards = 0, accelerationCards = 0, lockingCards = 0;
  for (const { pos, behind, unit } of ports) {
    portCells.add(posKey(pos));
    if (unit.bench !== undefined) {
      // an Auto Workbench (research machine-feeding §3.4, controller ruling 204 (1)): one pattern exactly equal to its
      // grid, blocking mode off (blocking mode counts its ghost grid as items, so it would never push into it) and a
      // Locking Card on "Until crafting result is returned", so the CPU pushes one whole set at a time; it pushes what it
      // makes into the interface itself, through its back
      const pattern = benchPattern(unit.bench);
      patterned.set(unit.stepId, pattern);
      patterns += 1;
      patternedInterfaces += 1;
      lockingCards += 1;
      blocks.push({
        pos, block: { ...parts.me_interface.block }, role: 'interface', label: `${parts.me_interface.name} (${unit.name})`, item: parts.me_interface.key,
        feed: { interface: { patterns: [pattern], blocking: false, lock: 'until_result' } },
      });
      continue;
    }
    const intake = !unit.multiblock || blockAt.get(posKey(behind))?.hatch === 'input_bus';
    // how each step the machine runs is fed (`unitSteps`: a shared machine runs several, plan 12 Task 6)
    const fed = intake ? unitSteps(unit).flatMap((id) => {
      const feed = feedOf(id);
      return feed === null ? [] : [{ id, feed }];
    }) : [];
    if (fed.length > 0 && fed.every(({ feed }) => feed.kind === 'export_bus')) {
      const keys = [...new Set(fed.flatMap(({ feed }) => (feed.kind === 'export_bus' ? feed.keys : [])))].sort();
      const cards = exportCards(keys.length, unitIntakeRate(plan, unit));
      capacityCards += cards.capacity;
      accelerationCards += cards.acceleration;
      // the bus is an AE2 part on the spine's cable: the cable block carries its feed (add-on 21's `ExportBusSpec`) and
      // its cover, which the configure step words
      const exportBus: ExportBusSpec = { keys: [...keys], ...(cards.acceleration > 0 ? { cards: cards.acceleration } : {}) };
      blocks.push({ pos, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key, feed: { exportBus } });
      covers.push({ pos: [...pos], cover: { face: FACES[sideToward(pos, behind)]!, item: parts.me_export_bus.key, filter: [...keys],
        settings: { mode: 'me_export', ...(cards.capacity > 0 ? { capacityCards: cards.capacity } : {}),
          ...(cards.acceleration > 0 ? { accelerationCards: cards.acceleration } : {}) } } });
      if (cards.short) {
        warnings.push({ code: 'export_bus_short', stepId: unit.stepId, text: `One ME Export Bus cannot feed the ${unit.name} all it needs `
          + `(${nameList(plan, pack, keys)}): feed the rest by hand` });
      }
      exportBusFor.set(unit.name, (exportBusFor.get(unit.name) ?? 0) + 1);
      continue;
    }
    // one processing pattern per step, in `unitSteps` order, as many as one ME Interface holds (controller Amendment OQ6),
    // blocking mode on only where it can push into the machine for every one of them
    const withPattern = fed.flatMap(({ id, feed }) => (feed.kind === 'pattern' ? [{ id, feed }] : []));
    const kept = withPattern.slice(0, AE2_POOL_MAX_PATTERNS);
    const rest = withPattern.slice(AE2_POOL_MAX_PATTERNS);
    for (const { id, feed } of kept) patterned.set(id, feed.pattern);
    patterns += kept.length;
    if (kept.length > 0) patternedInterfaces += 1;
    if (rest.length > 0 && !patternsWarned.has(unit.stepId)) {
      patternsWarned.add(unit.stepId);
      warnings.push({ code: 'ae2_patterns_short', stepId: rest[0]!.id, text: `${unit.name} runs more recipes than one ME Interface holds `
        + `(${AE2_POOL_MAX_PATTERNS} patterns): ${nameList(plan, pack, rest.map(({ id }) => stepProduct(plan, id)))} need another interface` });
    }
    const blocking = kept.every(({ feed }) => feed.blocking);
    // a shared machine needs blocking mode, which pushes one recipe's set at a time (research machine-feeding §3.3); a held
    // item blocking mode does not ignore keeps it off, so the recipes' sets can mix in the machine
    if (kept.length > 1 && !blocking && !unblockedWarned.has(unit.stepId)) {
      unblockedWarned.add(unit.stepId);
      const held = [...new Set(kept.flatMap(({ id }) => {
        const s = plan.steps.find((x) => x.id === id);
        return s === undefined ? [] : stepOneOffs(pack, s).map((h) => h.key).filter((k) => !ignoredByBlocking(pack, k));
      }))].sort();
      warnings.push({ code: 'ae2_shared_unblocked', stepId: unit.stepId, text: `The ${unit.name} runs ${fmtInt(kept.length)} recipes from one ME Interface `
        + `but holds ${nameList(plan, pack, held)}, which blocking mode does not ignore, so blocking mode stays off and the next recipe's items can go `
        + 'in before the last has run: give each recipe its own machine' });
    }
    blocks.push({
      pos, block: { ...parts.me_interface.block }, role: 'interface', label: `${parts.me_interface.name} (${unit.name})`, item: parts.me_interface.key,
      ...(kept.length === 0 ? {} : { feed: { interface: { patterns: kept.map(({ feed }) => structuredClone(feed.pattern)), blocking } } }),
    });
  }
  // each step whose machines move items and get no pattern, once, in unit order (a multiblock that takes no item has no
  // input bus to put a pattern in front of, and gets none either)
  const warned = new Set<string>();
  for (const u of units) {
    if (u.manual !== undefined || !(u.io.itemIn || u.io.itemOut)) continue;
    for (const id of unitSteps(u)) {
      if (warned.has(id)) continue;
      warned.add(id);
      const step = plan.steps.find((s) => s.id === id);
      const feed = feedOf(id);
      if (step === undefined || feed === null || feed.kind === 'pattern') continue;
      warnings.push({ code: 'ae2_no_pattern', stepId: id, text: noPatternText(input, step, u, feed) });
    }
  }
  // each step with a pattern that AE2 runs less often than the fluids it pipes to the line's other machines need, once
  // per fluid (in key order), in unit order
  const shares = aeRunShares(plan, patterned);
  const placed = placedStepIds(placement);
  const short = new Set<string>();
  for (const u of units) {
    // every step the machine runs (`unitSteps`: a shared machine runs several, plan 12 Task 6), each with its own share
    // (`RunShare`: at most and at least)
    const own = unitSteps(u);
    for (const id of own) {
      const pattern = patterned.get(id);
      const run = shares.get(id) ?? NO_RUNS;
      if (pattern === undefined || short.has(id) || run.share >= 1 - SHARE_EPSILON) continue;
      short.add(id);
      const piped = plan.flows.filter((f) => f.from === id && isFluidKey(f.key) && !own.includes(f.to) && placed.has(f.to));
      for (const fluid of [...new Set(piped.map((f) => f.key))].sort()) {
        const to = [...new Set(piped.filter((f) => f.key === fluid).map((f) => f.to))];
        warnings.push({ code: 'ae2_fluid_short', stepId: id, key: fluid, text: fluidShortText(input, u, pattern, fluid, to, run) });
      }
    }
  }

  const links: Array<[Vec3, Vec3]> = [];
  for (let x = firstX; x <= tailX; x++) {
    const cell: Vec3 = [x, 0, spineZ];
    if (!portCells.has(posKey(cell))) {
      blocks.push({ pos: cell, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key });
    }
    if (x > firstX) links.push([[x - 1, 0, spineZ], cell]);
  }
  // cable climbs the spine's column to the interface of a bus GT takes only higher up
  const risers = itemRisers(placement);
  for (const cell of risers.cells) blocks.push({ pos: cell, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key });
  links.push(...risers.links);
  // every output face pushes its machine's share into the interface in front of it
  const rateWarned = new Set<string>();
  for (const u of units) {
    for (const face of u.ports.itemFaces) {
      // what every step it runs makes leaves through it (`unitItemRate` of the unit)
      const { cover, warning } = conveyorCover(input, face, 'export', true, unitItemRate(plan, u), u.name, u.stepId);
      covers.push(cover);
      if (warning !== null && !rateWarned.has(u.stepId)) {
        rateWarned.add(u.stepId);
        warnings.push(warning);
      }
    }
  }

  const hooked = network?.kind === 'ae2';
  if (!hooked) {
    warnings.push({ code: 'ae2_missing', text: 'No AE2 network at this base: the ME parts need an ME controller and drive — build those first (not in this list)' });
  } else {
    const free = Math.max(0, (network.channelsMax ?? DEFAULT_CHANNELS_MAX) - (network.channelsUsed ?? 0));
    if (ports.length > free) warnings.push({ code: 'ae2_channels', text: `The line needs ${ports.length} channels; the AE2 network has ${free} free` });
  }

  // one per pattern of every interface: a machine that runs several recipes holds one for each (plan 12 Task 6)
  if (patterns > 0) {
    extraParts.push({ key: parts.blank_pattern.key, amount: patterns, group: 'logistics',
      why: patterns === patternedInterfaces ? 'one processing pattern per machine' : 'one processing pattern per recipe each machine runs' });
  }
  for (const [part, amount] of [[parts.ae2_capacity_card, capacityCards], [parts.ae2_acceleration_card, accelerationCards]] as const) {
    if (amount > 0) extraParts.push({ key: part.key, amount, why: 'ME Export Bus upgrades', group: 'logistics' });
  }
  if (lockingCards > 0) extraParts.push({ key: parts.ae2_locking_card.key, amount: lockingCards, why: 'Locking Card on each Auto Workbench\'s interface', group: 'logistics' });
  const exportWords = exportBusFor.size === 0 ? ''
    : `, but only cable in front of ${joinNames([...exportBusFor].map(([name, n]) => (n === 1 ? `the ${name}` : `${fmtInt(n)}× ${name}`)))}, with an ME `
      + 'Export Bus on its face toward the machine';
  const drafts: StepDraft[] = [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
    text: `Lay ME glass cable along the middle row with an ME interface at every machine's output side or bus${lineExceptions(placement)}`
      + `${exportWords}${risers.links.length > 0 ? RISER_WORDS : ''}` }];

  // cable cells show their joins to the spine cells beside them; an interface is a full block
  const bits = linkBits(links);
  return {
    blocks: blocks
      .map((b): LocalBlock => {
        const connections = b.role === 'pipe' ? bits.get(posKey(b.pos)) : undefined;
        return connections === undefined ? b : { ...b, connections };
      })
      .sort((a, b) => comparePos(a.pos, b.pos) || (a.facing ?? -1) - (b.facing ?? -1)),
    covers: covers.sort((a, b) => comparePos(a.pos, b.pos) || FACES.indexOf(a.cover.face) - FACES.indexOf(b.cover.face)),
    // the interface pushes the pattern's inputs through the machine's output side; the machines' feeding settings
    // (architecture §11 entry 51)
    configs: mergeHostConfigs([...outputSideInputs(placement).values(), ...feedSettings(pack, plan, placement)]),
    logisticsPort: hooked ? [tailX, 0, spineZ] : null,
    hookup: hooked ? { part: 'me_cable', end: null } : null,
    extraParts, drafts, warnings, tailFluidY: 1,
  };
}
