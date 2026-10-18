// Logistics modes (Plan 5 Task 7; spec §3.6, research gt-mechanics §3.8): what sits on a line's spine and tail in each
// logistics mode, the covers and settings the mode puts on machines and on its own blocks, where the base's logistics
// network hooks in, and the mode's build-step drafts. This module holds the contract every mode returns, the dispatch
// and the helpers the modes share (flow sums, names, sized conveyor covers, what a shared pipe can misroute). Each mode
// lives in its own file. Every order and tie-break is fixed, so the same plan gives the same result.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { joinNames } from '../../../shared/layout/format.ts';
import type { Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES } from '../../../shared/types/assets.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { BomLine, BuildStep, LogisticsMode, Plan, PlanFlow, PlanWarning } from '../../../shared/types/plan.ts';
import type { LogisticsNetwork } from '../../../shared/types/world.ts';
import type { BlockConfig, HostConfig, HostCover, LocalBlock, Placement } from '../arrange.ts';
import { coverRateWarning, pickConveyor, type PartId, type Parts } from '../parts.ts';
import { directMode } from './direct.ts';

// ---- Types ----

/** A build step a mode asks for; Task 10 numbers it and turns `pin` into a pin number. */
export interface StepDraft { id: string; kind: BuildStep['kind']; text: string; pin: 'site' | 'power' | 'logistics' | null }

export interface ModeInput {
  pack: Pack; plan: Plan; parts: Parts; placement: Placement;
  /** The base's logistics network to hook into, chosen by Task 9; null when there is none. */
  network: LogisticsNetwork | null;
}

/** The hookup path's part; `end` replaces its last cell (facing the port); `endConfig` goes on the last cell. */
export interface ModeHookup { part: PartId; end: PartId | null; endConfig?: BlockConfig }

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
}

// ---- Dispatch ----

/** How far apart units' item ports must be in each mode (Task 5 `placeUnits`): direct may share, routed and AE2 may not. */
export const PORT_SPACING: Readonly<Record<LogisticsMode, 0 | 1 | 2>> = Object.freeze({ direct: 0, routed: 1, ae2: 2 });

export function buildMode(mode: LogisticsMode, input: ModeInput): ModeResult {
  switch (mode) {
    case 'direct': return directMode(input);
    case 'routed': throw new Error('not implemented');                                     // Task 8
    case 'ae2': throw new Error('not implemented');                                        // Task 8
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

/** The step ids that have units in the placement, in unit order. */
export function placedStepIds(placement: Placement): Set<string> {
  return new Set(placement.units.map((u) => u.stepId));
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
    const step = plan.steps.find((s) => s.id === stepId);
    if (step === undefined) continue;
    const fed = flows.filter((f) => f.to === stepId).map((f) => f.key);
    const inputs = new Set(fed.length > 0 ? fed : step.inputs.filter((p) => !isFluidKey(p.key)).map((p) => p.key));
    const maps = new Set(pack.machines.get(step.machine.mteId)?.maps ?? []);
    if (step.mapId !== '') maps.add(step.mapId);
    const keys = carried.filter((k) => !inputs.has(k) && consumerMaps(k).some((m) => maps.has(m)));
    if (keys.length > 0) out.push({ stepId, keys });
  }
  return out;
}
