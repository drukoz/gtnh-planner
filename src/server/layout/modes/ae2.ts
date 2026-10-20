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
// with an `ae2_no_pattern` warning that the line then relies on stock or your hands. Blocking mode is on (the next set
// goes in once a run has taken the last) unless the machine holds an item AE2's blocking-ignore list leaves out, which
// blocking mode would wait on for ever (GT's `AE2Compat.registerBlockingModeIgnoreItems`: the programmed circuit, its
// molds, extruder shapes, slicer blades and lenses; not the Packager's schematics). ME glass cable fills the rest of the
// spine, the tail included, where the base's ME network joins the line. Each interface or bus takes a channel, so the
// line is checked against the channels the network has free. The patterns are the interfaces' structured `feed`
// (architecture §11 entry 51). Without an AE2 network at the base the ME parts cannot work: the layout says so and never
// assumes one. A machine run by hand gets no interface, and a venting steam machine gets its interface on its middle-row
// side but no cover, as GT allows none on it (architecture §11 entry 48; by-hand.ts says what is then moved by hand).

import { isFluidKey, parseItemKey, type StuffKey } from '../../../shared/keys.ts';
import { fmtInt, joinNames } from '../../../shared/layout/format.ts';
import { posKey, sideToward, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { PatternSpec } from '../../../shared/types/feed.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, Plan, PlanStep, PlanWarning } from '../../../shared/types/plan.ts';
import { stepOneOffs } from '../../planner/bom.ts';
import { comparePos } from '../../world/graph.ts';
import type { HostCover, LocalBlock, PlacedUnit } from '../arrange.ts';
import { linkBits } from '../path.ts';
import {
  conveyorCover, emptyModeResult, feedSettings, itemPorts, itemRisers, lineExceptions, mergeHostConfigs, nameList, outputSideInputs, RISER_WORDS,
  unitItemRate, type ModeInput, type ModeResult, type StepDraft,
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

/** The cards an export bus needs for `kinds` items at `rate` items/s; `short` when even the most cannot. */
function exportCards(kinds: number, rate: number): { capacity: number; acceleration: number; short: boolean } {
  const capacity = Math.min(EXPORT_MAX_CAPACITY_CARDS, Math.ceil(Math.max(0, kinds - 1) / 4));
  const need = rate * EXPORT_SECONDS_PER_OP;
  const found = EXPORT_ITEMS_PER_OP.findIndex((n) => n >= need);
  const acceleration = found === -1 ? EXPORT_ITEMS_PER_OP.length - 1 : found;
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
  let patterns = 0, capacityCards = 0, accelerationCards = 0;
  for (const { pos, behind, unit } of ports) {
    portCells.add(posKey(pos));
    const intake = !unit.multiblock || blockAt.get(posKey(behind))?.hatch === 'input_bus';
    const feed = intake ? feedOf(unit.stepId) : null;
    if (feed?.kind === 'export_bus') {
      const cards = exportCards(feed.keys.length, unitIntakeRate(plan, unit.stepId));
      capacityCards += cards.capacity;
      accelerationCards += cards.acceleration;
      blocks.push({ pos, block: { ...parts.me_cable.block }, role: 'pipe', label: parts.me_cable.name, item: parts.me_cable.key });
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
    if (pattern !== null) patterns += 1;
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
  if (capacityCards > 0) extraParts.push({ key: parts.ae2_capacity_card.key, amount: capacityCards, why: 'ME Export Bus upgrades', group: 'logistics' });
  if (accelerationCards > 0) extraParts.push({ key: parts.ae2_acceleration_card.key, amount: accelerationCards, why: 'ME Export Bus upgrades', group: 'logistics' });
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
