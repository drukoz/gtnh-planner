// AE2 (Plan 5 Task 8; spec §3.6 mode 3, research gt-mechanics §3.8; the feeding fix, architecture §11 entry 51,
// research machine-feeding §2.3, §3.5 and §6.4 item 3): every machine gets an ME interface on its spine cell, holding one
// processing pattern for the machine's recipe (the interface pushes the pattern's inputs into the machine), and the
// machine pushes its output back into the interface with a conveyor cover sized to its share. A pattern holds only what
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
// the pack's crafting calculator plans a job: a loop of patterns until it would come back to a pattern above).
// Blocking mode is on (the next set goes in once a run has taken the last) unless the machine holds an item AE2's
// blocking-ignore list leaves out, which blocking mode would wait on for ever (GT's
// `AE2Compat.registerBlockingModeIgnoreItems`: the programmed circuit, its molds, extruder shapes, slicer blades and
// lenses; not the Packager's schematics). ME glass cable fills the rest of the spine, the tail included, where the
// base's ME network joins the line. Each interface or bus takes a channel, so the line is checked against the channels
// the network has free. The patterns are the interfaces' structured `feed`, and an export bus's filter and cards the
// `feed.exportBus` of the cable it sits on (architecture §11 entry 51). Without an AE2 network at the base the ME parts
// cannot work: the layout says so and never assumes one. A machine run by hand gets no interface, and a venting steam
// machine gets its interface on its middle-row side but no cover, as GT allows none on it (architecture §11 entry 48;
// by-hand.ts says what is then moved by hand).

import { isFluidKey, parseItemKey, type StuffKey } from '../../../shared/keys.ts';
import { fmtInt, joinNames } from '../../../shared/layout/format.ts';
import { posKey, sideToward, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { ExportBusSpec, PatternSpec } from '../../../shared/types/feed.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, Plan, PlanStep, PlanWarning } from '../../../shared/types/plan.ts';
import { stepOneOffs } from '../../planner/bom.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostCover, LocalBlock, PlacedUnit } from '../arrange.ts';
import { linkBits } from '../path.ts';
import {
  conveyorCover, emptyModeResult, feedSettings, itemPorts, itemRisers, lineExceptions, mergeHostConfigs, nameList, outputSideInputs, placedStepIds,
  RISER_WORDS, unitItemRate, type ModeInput, type ModeResult, type StepDraft,
} from './mode.ts';

/** A network whose scan gives no channel figures is taken to have the 8 channels of a network without a controller. */
const DEFAULT_CHANNELS_MAX = 8;

// ---- What AE2 can count (research machine-feeding §2.3, §3.5) ----

const CIRCUIT_ID = 'gregtech:gt.integrated_circuit';
const GT_META_ITEM = 'gregtech:gt.metaitem.01';
/** The `gt.metaitem.01` metas GT registers with AE2's blocking-ignore list: its 31 molds, 28 extruder shapes and 2 slicer blades. */
const IGNORED_META_RANGES: ReadonlyArray<readonly [number, number]> = [[32301, 32331], [32350, 32377], [32398, 32399]];

/**
 * Whether AE2's blocking mode ignores `key` in a machine (GT 5.09.54 `AE2Compat.registerBlockingModeIgnoreItems`, read in
 * its bytecode: every programmed circuit, the 61 shape items above, BartWorks' and GT's lenses and a few named lenses):
 * the programmed circuit, those metas, and any item of GT's `lens` prefix.
 */
export function ignoredByBlocking(pack: Pack, key: StuffKey): boolean {
  if (isFluidKey(key)) return false;
  const { id, meta } = parseItemKey(key);
  if (id === CIRCUIT_ID) return true;
  if (id === GT_META_ITEM && IGNORED_META_RANGES.some(([lo, hi]) => meta >= lo && meta <= hi)) return true;
  return pack.items.get(key)?.gt?.prefix === 'lens';
}

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

function stepFeed(pack: Pack, step: PlanStep): StepFeed {
  const inputs = patternInputs(pack, step);
  const outputs = patternOutputs(step);
  if (inputs.length > 0 && outputs.length > 0) {
    const blocking = stepOneOffs(pack, step).every((held) => ignoredByBlocking(pack, held.key));
    return { kind: 'pattern', pattern: { inputs, outputs }, blocking };
  }
  if (inputs.length > 0 && !step.outputs.some((p) => !isFluidKey(p.key))) return { kind: 'export_bus', keys: inputs.map((i) => i.key).sort() };
  return { kind: 'none', why: inputs.length > 0 ? 'chanced' : 'fluid_in' };
}

// ---- What AE2 runs (research machine-feeding §2.3 "Jobs", §4.2 item 2; AE2 rv3-beta-1073-GTNH's crafting calculator) ----

/** A run share this far below 1 still counts as every planned run: the plan's flows are sums of floating rates. */
const SHARE_EPSILON = 1e-6;

/**
 * A flow of a pattern output that a request answers: what it carries, the step with a pattern that asks for it (null: a
 * job's own request, for all of it), and how much that step's pattern asks for each unit of it the plan feeds the step
 * (its amount a run over the plan's: 1 but for an input used up by chance or a slot whose options the plan splits).
 */
interface RunAsk { perSecond: number; to: string | null; scale: number }

/**
 * The share of its planned runs AE2 gives each step with a pattern at most, 0 to 1 (fewer where a job finds the items
 * in your storage, which it takes before it crafts any), as the pack's crafting calculator plans its jobs (`CraftingJobV2`,
 * which `CraftingGridCache.beginCraftingJob` starts unless lite crafting is on; AE2 rv3-beta-1073-GTNH, read with javap).
 * A crafting CPU pushes a pattern only for a job, never for a fluid the line pipes on. A job crafts what it is asked for:
 * the line's product (`out`), or what something AE2 does not run itself takes (a step without a pattern, a step the line
 * places no machine for, a machine run by hand: you keep those going), all of it. Each run of a pattern asks for the
 * pattern's inputs at the pattern's amounts (none for an item the plan sends it that its pattern does not take), which
 * the plan's flows into it split among its suppliers (raw inputs and what a step without a pattern makes come from
 * storage; AE2 itself gives a request to the first pattern that makes it, by priority and then the network's order, which
 * the layout cannot know, so the plan's split stands for it). A request is crafted by a pattern that makes it, but never
 * by one already above it in the job: `CraftFromPatternTask` adds its pattern to its request's `patternParents` before it
 * asks for its inputs, `CraftingContext.doWork` copies them into each input's request, and `CraftableItemResolver` drops
 * them from that request's patterns (patterns compare by what they encode, `PatternHelper.equals`). So a loop of patterns
 * (cells emptied and filled again) is planned until it would come back to a pattern above, and that item comes from
 * storage. A step runs as often as its most-asked-for pattern output needs (its other outputs go to the job's byproducts,
 * which `ExtractItemTask` takes before anything is crafted again), and nothing of what goes to your storage (`sink`) asks.
 */
export function aeRunShares(plan: Plan, patterns: ReadonlyMap<string, PatternSpec>): Map<string, number> {
  // each distinct pattern by number, as AE2 tells patterns apart
  const kinds = new Map<string, number>();
  const kindOf = new Map([...patterns].map(([id, p]) => {
    const text = JSON.stringify(p);
    if (!kinds.has(text)) kinds.set(text, kinds.size);
    return [id, kinds.get(text)!];
  }));
  const runsOf = new Map(plan.steps.map((s) => [s.id, s.runsPerSecond]));
  const fed = (to: string, key: StuffKey): number => plan.flows.reduce((n, f) => (f.to === to && f.key === key ? n + f.perSecond : n), 0);
  // per step, per pattern output it makes: what it makes of it and the flows of it a request answers
  const outputs = new Map([...patterns].map(([id, pattern]) => [id, pattern.outputs.flatMap(({ key }) => {
    const flows = plan.flows.filter((f) => f.from === id && f.key === key && f.perSecond > 0);
    const made = flows.reduce((n, f) => n + f.perSecond, 0);
    const asks = flows.flatMap((f): RunAsk[] => {
      if (f.to === 'sink') return [];
      const consumer = patterns.get(f.to);
      if (consumer === undefined) return [{ perSecond: f.perSecond, to: null, scale: 1 }];
      const ratio = (consumer.inputs.find((i) => i.key === key)?.amount ?? 0) * (runsOf.get(f.to) ?? 0) / fed(f.to, key);
      // the plan's rates are floating sums: a pattern that asks what the plan feeds asks exactly that
      const scale = Math.abs(ratio - 1) < SHARE_EPSILON ? 1 : ratio;
      return scale > 0 ? [{ perSecond: f.perSecond, to: f.to, scale }] : [];
    });
    return made > 0 ? [{ made, asks }] : [];
  })]));
  // the patterns a step's runs can be asked for through (its own among them): only these of the ones above it matter
  const through = new Map([...patterns.keys()].map((id) => {
    const seen = new Set([id]);
    for (const at of seen) for (const o of outputs.get(at)!) for (const a of o.asks) if (a.to !== null) seen.add(a.to);
    return [id, new Set([...seen].map((s) => kindOf.get(s)!))];
  }));
  const memo = new Map<string, number>();
  /**
   * The share of `id`'s planned runs asked for by the requests whose job reaches them through none of the patterns
   * `above` (none at all where the step's own pattern is one of them): what goes to a job's own request in full, and
   * what goes to a step with a pattern at that step's share through none of `above` nor the step's own pattern.
   */
  const share = (id: string, above: ReadonlySet<number>): number => {
    const kind = kindOf.get(id)!;
    if (above.has(kind)) return 0;
    const key = `${id}|${[...above].filter((k) => through.get(id)!.has(k)).sort((a, b) => a - b).join(',')}`;
    let value = memo.get(key);
    if (value === undefined) {
      const next = new Set(above).add(kind);
      value = Math.min(1, Math.max(0, ...outputs.get(id)!.map(({ made, asks }) =>
        asks.reduce((n, a) => n + a.perSecond * (a.to === null ? 1 : a.scale * share(a.to, next)), 0) / made)));
      memo.set(key, value);
    }
    return value;
  };
  return new Map([...patterns.keys()].map((id) => [id, share(id, new Set())]));
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

/** Σ item flows into the step ÷ step.count: the items/s each of its machines takes. */
function unitIntakeRate(plan: Plan, stepId: string): number {
  const count = plan.steps.find((s) => s.id === stepId)?.count ?? 1;
  const items = plan.flows.reduce((sum, f) => (f.to === stepId && !isFluidKey(f.key) ? sum + f.perSecond : sum), 0);
  return items / Math.max(1, count);
}

// ---- Warnings ----

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
  return `AE2 cannot plan ${machine}: it takes only ${nameList(plan, pack, keysOf(step.inputs, true))}, which the line pipes in, so no pattern can `
    + 'push anything into it. It runs from its pipes and what it makes goes back into your ME storage, so jobs that need '
    + `${nameList(plan, pack, keysOf(step.outputs, false))} rely on stock`;
}

/**
 * `ae2_fluid_short` for a step with a pattern whose fluid `fluid` the line pipes to `to` (its placed consumers, in flow
 * order) while AE2 runs it for `share` of its planned runs: what its pattern makes, how much of the fluid that gives, and
 * how to keep it running.
 */
function fluidShortText(input: ModeInput, unit: PlacedUnit, pattern: PatternSpec, fluid: StuffKey, to: readonly string[], share: number): string {
  const { pack, plan, placement } = input;
  const n = placement.units.filter((u) => u.stepId === unit.stepId).length;
  const machine = `the ${unit.name}${n > 1 ? ` (${fmtInt(n)}×)` : ''}`;
  // each consumer by its machine's name, with what it makes where two share a name
  const names = to.map((id) => placement.units.find((u) => u.stepId === id)?.name ?? id);
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
    : `AE2 runs ${machine} only as often as a job needs what its pattern makes (${made}), about ${share < 0.01 ? 'less than 1' : fmtInt(Math.floor(share * 100))} % `
      + `of the runs the ${fluidName} it pipes to ${consumers} needs: so ${one ? 'it runs' : 'they run'} out of ${fluidName} and ${one ? 'waits' : 'wait'} `
      + `for ever, ${andJobs}`;
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
  let patterns = 0, capacityCards = 0, accelerationCards = 0;
  for (const { pos, behind, unit } of ports) {
    portCells.add(posKey(pos));
    const intake = !unit.multiblock || blockAt.get(posKey(behind))?.hatch === 'input_bus';
    const feed = intake ? feedOf(unit.stepId) : null;
    if (feed?.kind === 'export_bus') {
      const cards = exportCards(feed.keys.length, unitIntakeRate(plan, unit.stepId));
      capacityCards += cards.capacity;
      accelerationCards += cards.acceleration;
      // the bus is an AE2 part on the spine's cable: the cable block carries its feed (add-on 21's `ExportBusSpec`) and
      // its cover, which the configure step words
      const exportBus: ExportBusSpec = { keys: [...feed.keys], ...(cards.acceleration > 0 ? { cards: cards.acceleration } : {}) };
      blocks.push({ pos, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key, feed: { exportBus } });
      covers.push({ pos: [...pos], cover: { face: FACES[sideToward(pos, behind)]!, item: parts.me_export_bus.key, filter: [...feed.keys],
        settings: { mode: 'me_export', ...(cards.capacity > 0 ? { capacityCards: cards.capacity } : {}),
          ...(cards.acceleration > 0 ? { accelerationCards: cards.acceleration } : {}) } } });
      if (cards.short) {
        warnings.push({ code: 'export_bus_short', stepId: unit.stepId, text: `One ME Export Bus cannot feed the ${unit.name} all it needs `
          + `(${nameList(plan, pack, feed.keys)}): feed the rest by hand` });
      }
      exportBusFor.set(unit.name, (exportBusFor.get(unit.name) ?? 0) + 1);
      continue;
    }
    const pattern = feed?.kind === 'pattern' ? feed : null;
    if (pattern !== null) {
      patterns += 1;
      patterned.set(unit.stepId, pattern.pattern);
    }
    blocks.push({
      pos, block: { ...parts.me_interface.block }, role: 'interface', label: `${parts.me_interface.name} (${unit.name})`, item: parts.me_interface.key,
      ...(pattern === null ? {} : { feed: { interface: { patterns: [structuredClone(pattern.pattern)], blocking: pattern.blocking } } }),
    });
  }
  // each step whose machines move items and get no pattern, once, in unit order (a multiblock that takes no item has no
  // input bus to put a pattern in front of, and gets none either)
  const warned = new Set<string>();
  for (const u of units) {
    if (u.manual !== undefined || !(u.io.itemIn || u.io.itemOut) || warned.has(u.stepId)) continue;
    warned.add(u.stepId);
    const step = plan.steps.find((s) => s.id === u.stepId);
    const feed = feedOf(u.stepId);
    if (step === undefined || feed === null || feed.kind === 'pattern') continue;
    warnings.push({ code: 'ae2_no_pattern', stepId: u.stepId, text: noPatternText(input, step, u, feed) });
  }
  // each step with a pattern that AE2 runs less often than the fluids it pipes to the line's other machines need, once
  // per fluid (in key order), in unit order
  const shares = aeRunShares(plan, patterned);
  const placed = placedStepIds(placement);
  const short = new Set<string>();
  for (const u of units) {
    const pattern = patterned.get(u.stepId);
    if (pattern === undefined || short.has(u.stepId) || (shares.get(u.stepId) ?? 0) >= 1 - SHARE_EPSILON) continue;
    short.add(u.stepId);
    const piped = plan.flows.filter((f) => f.from === u.stepId && isFluidKey(f.key) && f.to !== u.stepId && placed.has(f.to));
    for (const fluid of [...new Set(piped.map((f) => f.key))].sort()) {
      const to = [...new Set(piped.filter((f) => f.key === fluid).map((f) => f.to))];
      warnings.push({ code: 'ae2_fluid_short', stepId: u.stepId, key: fluid, text: fluidShortText(input, u, pattern, fluid, to, shares.get(u.stepId) ?? 0) });
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
      const { cover, warning } = conveyorCover(input, face, 'export', true, unitItemRate(plan, u.stepId), u.name, u.stepId);
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

  if (patterns > 0) extraParts.push({ key: parts.blank_pattern.key, amount: patterns, why: 'one processing pattern per machine', group: 'logistics' });
  for (const [part, amount] of [[parts.ae2_capacity_card, capacityCards], [parts.ae2_acceleration_card, accelerationCards]] as const) {
    if (amount > 0) extraParts.push({ key: part.key, amount, why: 'ME Export Bus upgrades', group: 'logistics' });
  }
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
