// Logistics modes (Plan 5 Tasks 7–8; spec §3.6, research gt-mechanics §3.8): what sits on a line's spine and tail in
// each logistics mode, the covers and settings the mode puts on machines and on its own blocks, where the base's
// logistics network hooks in, and the mode's build-step drafts. This module holds the contract every mode returns, the
// dispatch and the helpers the modes share (flow sums, names, item ports, sized conveyor covers, what a shared pipe can
// misroute). Each mode lives in its own file. Every order and tie-break is fixed, so the same plan gives the same
// result.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { joinNames } from '../../../shared/layout/format.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { ConduitFace, ConduitKind } from '../../../shared/types/layout.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, BuildStep, LogisticsMode, Plan, PlanFlow, PlanWarning } from '../../../shared/types/plan.ts';
import type { LogisticsNetwork } from '../../../shared/types/world.ts';
import type { BlockConfig, HostConfig, HostCover, LocalBlock, PlacedUnit, Placement } from '../arrange.ts';
import { coverRateWarning, pickConveyor, type PartId, type Parts } from '../parts.ts';
import { ae2Mode } from './ae2.ts';
import { withHandSteps } from './by-hand.ts';
import { directMode } from './direct.ts';
import { enderioMode } from './enderio.ts';
import { routedMode } from './routed.ts';

// ---- Types ----

/** A build step a mode asks for; Task 10 numbers it and turns `pin` into a pin number. */
export interface StepDraft { id: string; kind: BuildStep['kind']; text: string; pin: 'site' | 'power' | 'logistics' | null }

export interface ModeInput {
  pack: Pack; plan: Plan; parts: Parts; placement: Placement;
  /** The base's logistics network to hook into, chosen by Task 9; null when there is none. */
  network: LogisticsNetwork | null;
}

/** The hookup path's part; `end` replaces its last cell (facing the port); `endConfig` goes on the last cell. */
export interface ModeHookup {
  part: PartId; end: PartId | null; endConfig?: BlockConfig;
  /**
   * The conduit face the hookup's last cell turns toward the port; the hookup fills in `face`, the side that touches the
   * port, where its route ends (architecture "EnderIO conduits, granted change requests (add-on 11)").
   */
  endConduit?: { kind: ConduitKind; face: Omit<ConduitFace, 'face'> };
}

export interface ModeResult {
  /** Sorted by x, y, z, then facing; every block carries `item`. */
  blocks: LocalBlock[];
  /** Sorted by pos (x, y, z), then FACES order — on machines and on the mode's own blocks. */
  covers: HostCover[];
  /** Sorted by pos — settings for blocks the mode does not own (machines, input buses). */
  configs: HostConfig[];
  /** The local block the logistics hookup must reach from outside the box. */
  logisticsPort: Vec3 | null;
  hookup: ModeHookup | null;
  /** Group `logistics`. */
  extraParts: BomLine[];
  /** Laying the line, settings on existing base blocks, how to use it — never a placed block's settings. */
  drafts: StepDraft[];
  warnings: PlanWarning[];
  /** The lowest y the tail's fluid roots may use (above the mode's tail blocks). */
  tailFluidY: number;
  /** The mode lays the line's fluid network itself: internal routing then gets no fluid nets (no GT fluid pipes, no pump covers). */
  ownsFluids?: boolean;
}

// ---- Dispatch ----

/**
 * How far apart units' item ports must be in each mode (Task 5 `placeUnits`): direct may share, routed and AE2 may not.
 * EnderIO may share too: each face of a conduit is set on its own, so the N and S machines may share a spine cell.
 */
export const PORT_SPACING: Readonly<Record<LogisticsMode, 0 | 1 | 2>> = Object.freeze({ direct: 0, routed: 1, ae2: 2, enderio: 0 });

/**
 * The mode's line. Every mode but machine to machine (add-on 15's) also says how to run its hand-run machines and what
 * a steam machine's line cannot take out of it (`withHandSteps`).
 */
export function buildMode(mode: LogisticsMode, input: ModeInput): ModeResult {
  switch (mode) {
    case 'direct': return directMode(input);
    case 'routed': return withHandSteps(input, mode, routedMode(input));
    case 'ae2': return withHandSteps(input, mode, ae2Mode(input));
    case 'enderio': return withHandSteps(input, mode, enderioMode(input));
    default: throw new Error(`unknown logistics mode ${String(mode)}`);
  }
}

// ---- Flows ----

const ITEMS_PER_STACK = 64;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function itemFlows(plan: Plan): PlanFlow[] {
  return plan.flows.filter((f) => !isFluidKey(f.key));
}

/** Each key once, sorted. */
function distinctKeys(flows: readonly PlanFlow[]): StuffKey[] {
  return [...new Set(flows.map((f) => f.key))].sort(compareText);
}

function isFinal(to: string): boolean {
  return to === 'out' || to === 'sink';
}

/** A mode result with nothing in it: no unit moves items, or the mode cannot lay its line. */
export function emptyModeResult(warnings: PlanWarning[] = []): ModeResult {
  return { blocks: [], covers: [], configs: [], logisticsPort: null, hookup: null, extraParts: [], drafts: [], warnings, tailFluidY: 1 };
}

/**
 * The step ids whose units the line's logistics serve, in unit order: every unit in the placement but those run by hand
 * (`Unit.manual`), whose goods cross the line's edge like those of a step it does not place.
 */
export function placedStepIds(placement: Placement): Set<string> {
  return new Set(placement.units.filter((u) => u.manual === undefined).map((u) => u.stepId));
}

/**
 * The item keys the line hands to the steps it runs by hand (`toHand`: flows from a placed step into one of them, which
 * wait in the line's output chest) and takes from them (`fromHand`: flows from one of them into a placed step, which go
 * in its input chest), each sorted.
 */
export function handItemFlows(plan: Plan, placement: Placement): { toHand: StuffKey[]; fromHand: StuffKey[] } {
  const hand = new Set(placement.units.filter((u) => u.manual !== undefined).map((u) => u.stepId));
  const placed = placedStepIds(placement);
  const flows = itemFlows(plan);
  return {
    toHand: distinctKeys(flows.filter((f) => placed.has(f.from) && hand.has(f.to))),
    fromHand: distinctKeys(flows.filter((f) => hand.has(f.from) && placed.has(f.to))),
  };
}

/** Σ item flows touching a placed step ÷ 64. */
export function itemStacksPerSecond(plan: Plan, placed: ReadonlySet<string>): number {
  const items = itemFlows(plan).reduce((sum, f) => (placed.has(f.from) || placed.has(f.to) ? sum + f.perSecond : sum), 0);
  return items / ITEMS_PER_STACK;
}

/** Σ item flows out of the step ÷ step.count: the items/s each of its machines pushes out. */
export function unitItemRate(plan: Plan, stepId: string): number {
  const count = plan.steps.find((s) => s.id === stepId)?.count ?? 1;
  const items = itemFlows(plan).reduce((sum, f) => (f.from === stepId ? sum + f.perSecond : sum), 0);
  return items / Math.max(1, count);
}

function rawItemFlows(plan: Plan, placed: ReadonlySet<string>): PlanFlow[] {
  return itemFlows(plan).filter((f) => f.from === 'raw' && placed.has(f.to));
}

/** The item keys flowing raw → placed step, sorted. */
export function rawItemInputs(plan: Plan, placed: ReadonlySet<string>): StuffKey[] {
  return distinctKeys(rawItemFlows(plan, placed));
}

/** Σ perSecond of the item flows raw → placed step. */
export function rawItemRate(plan: Plan, placed: ReadonlySet<string>): number {
  return rawItemFlows(plan, placed).reduce((sum, f) => sum + f.perSecond, 0);
}

/** The item keys flowing placed step → out | sink, sorted. */
export function finalItemOutputs(plan: Plan, placed: ReadonlySet<string>): StuffKey[] {
  return distinctKeys(itemFlows(plan).filter((f) => placed.has(f.from) && isFinal(f.to)));
}

/**
 * The items a step's machine takes: the item keys of the flows into it, or its `step.inputs` item keys when no item
 * flows into it (ruling R4). Sorted, each once.
 */
export function stepItemInputs(plan: Plan, stepId: string): StuffKey[] {
  const fed = distinctKeys(itemFlows(plan).filter((f) => f.to === stepId));
  if (fed.length > 0) return fed;
  const own = plan.steps.find((s) => s.id === stepId)?.inputs ?? [];
  return [...new Set(own.filter((p) => !isFluidKey(p.key)).map((p) => p.key))].sort(compareText);
}

/** The item keys of `step.outputs`, sorted, each once. */
export function stepItemOutputs(plan: Plan, stepId: string): StuffKey[] {
  const own = plan.steps.find((s) => s.id === stepId)?.outputs ?? [];
  return [...new Set(own.filter((p) => !isFluidKey(p.key)).map((p) => p.key))].sort(compareText);
}

// ---- Item ports ----

/** A spine cell in front of a unit, and the unit's cell behind it that takes or gives the items. */
export interface ItemPort { pos: Vec3; behind: Vec3; unit: PlacedUnit; /** The unit's first item port. */ first: boolean }

/**
 * The item ports (`UnitPorts.items`) of the units that move items, in unit then port order. A unit that moves only
 * fluids keeps its spine cell plain: an interface there would have nothing to take or give.
 */
export function itemPorts(placement: Placement): ItemPort[] {
  return placement.units.filter((u) => u.io.itemIn || u.io.itemOut).flatMap((u) => u.ports.items.map((pos, i): ItemPort => ({
    pos: [...pos], behind: step(pos, OPPOSITE[u.facing]!), unit: u, first: i === 0,
  })));
}

/**
 * A singleblock takes its items through its spine face, which is its output side (GT keeps its front, `mainFacing`,
 * elsewhere): so in every mode each singleblock with item inputs gets "Input from Output Side" allowed on its
 * machine. A venting steam singleblock's output side faces up (`PlacedUnit.outputSide`), so it takes its items on a
 * side that needs no such setting. Keyed by the machine cell's posKey, in unit order.
 */
export function outputSideInputs(placement: Placement): Map<string, HostConfig> {
  const configs = new Map<string, HostConfig>();
  for (const u of placement.units) {
    const port = u.ports.items[0];
    if (u.multiblock || u.outputSide !== undefined || !u.io.itemIn || port === undefined) continue;
    const cell = step(port, OPPOSITE[u.facing]!);
    configs.set(posKey(cell), { pos: cell, config: { inputFromOutputSide: true } });
  }
  return configs;
}

// ---- Line words ----

/**
 * What the `layout:logistics:line` step adds where the line's parts do not meet a machine at its output side or bus
 * (architecture §11 entry 48): a venting steam machine is met on its middle-row side, as its output side faces up, and a
 * machine run by hand gets nothing. Empty for a line with neither.
 */
export function lineExceptions(placement: Placement): string {
  const steam = placement.units.some((u) => u.outputSide !== undefined);
  const hand = [...new Set(placement.units.filter((u) => u.manual !== undefined).map((u) => `the ${u.name}`))];
  const words = [...(steam ? ["a steam machine's middle-row side instead, as its output side faces up"] : []),
    ...(hand.length === 0 ? [] : [`${joinNames(hand)} ${hand.length === 1 ? 'gets' : 'get'} nothing`])];
  return words.length === 0 ? '' : ` (${words.join('; ')})`;
}

// ---- Names ----

function nameOf(plan: Plan, pack: Pack, key: StuffKey): string {
  return plan.names?.[key] ?? pack.nameOf(key);
}

/** "A", "A and B", "A, B and C" over `plan.names`, else `pack.nameOf`. */
export function nameList(plan: Plan, pack: Pack, keys: readonly StuffKey[]): string {
  return joinNames(keys.map((k) => nameOf(plan, pack, k)));
}

/** Whole numbers with thousands separators, anything else with two decimals (like Plan 2's build steps). */
function amountText(n: number): string {
  const x = Math.round(n * 1e9) / 1e9 || 0;
  return Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1× A + 2× B" */
export function amountList(plan: Plan, pack: Pack, items: ReadonlyArray<{ key: StuffKey; amount: number }>): string {
  return items.map(({ key, amount }) => `${amountText(amount)}× ${nameOf(plan, pack, key)}`).join(' + ');
}

// ---- Covers ----

/**
 * A conveyor cover on side `at.side` of the block at `at.pos`, the smallest up to the plan's tier that moves `rate`
 * items/s, with the `cover_rate` warning (naming `machine`) when none does.
 */
export function conveyorCover(input: ModeInput, at: { pos: Vec3; side: number }, mode: 'export' | 'import', allowInput: boolean, rate: number,
  machine: string, stepId?: string): { cover: HostCover; warning: PlanWarning | null } {
  const { pack, plan } = input;
  const face = FACES[at.side];
  if (face === undefined) throw new RangeError(`a side is a ForgeDirection 0..5, got ${at.side}`);
  const pick = pickConveyor(pack, rate, plan.tier);
  return {
    cover: { pos: [...at.pos], cover: { face, item: pick.key, settings: { mode, allowInput, rate, unit: 'items/s' } } },
    warning: pick.short ? coverRateWarning('conveyor', pick, rate, plan.tier, machine, stepId) : null,
  };
}

// ---- What a shared pipe can misroute ----

/**
 * The items a shared spine pipe carries that a placed step's machine could take although they are not its inputs: a
 * machine with its Input Filter on still takes any item one of its recipes uses (research §3.8). The spine carries
 * every item key of the flows raw → placed, placed → placed and placed → out/sink. A step's inputs are the item keys
 * of the flows into it, or its `step.inputs` item keys when no item flows into it (ruling R4). Key k conflicts with
 * step j when a recipe consuming k shares a map with j's machine (its maps and the step's own non-empty `mapId`).
 * Steps in `placed` order (unit order from `placedStepIds`), keys sorted, steps without conflicts left out.
 */
export function spineConflicts(pack: Pack, plan: Plan, placed: ReadonlySet<string>): Array<{ stepId: string; keys: StuffKey[] }> {
  const flows = itemFlows(plan);
  const onSpine = (f: PlanFlow) => (f.from === 'raw' && placed.has(f.to)) || (placed.has(f.from) && (placed.has(f.to) || isFinal(f.to)));
  const carried = distinctKeys(flows.filter(onSpine));
  const consumerMaps = (key: StuffKey): string[] =>
    (pack.consumers.get(key) ?? []).flatMap((i) => pack.recipes[i]?.maps ?? []);
  const out: Array<{ stepId: string; keys: StuffKey[] }> = [];
  for (const stepId of placed) {
    const planStep = plan.steps.find((s) => s.id === stepId);
    if (planStep === undefined) continue;
    const inputs = new Set(stepItemInputs(plan, stepId));
    const maps = new Set(pack.machines.get(planStep.machine.mteId)?.maps ?? []);
    if (planStep.mapId !== '') maps.add(planStep.mapId);
    const keys = carried.filter((k) => !inputs.has(k) && consumerMaps(k).some((m) => maps.has(m)));
    if (keys.length > 0) out.push({ stepId, keys });
  }
  return out;
}
