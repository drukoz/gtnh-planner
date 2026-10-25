// The key-numbers strip (Phase 2 spec §10, D12), as pure functions: the five figures a line is read by at a glance, each a readout tile at
// the top of the banners' box — what it makes (a rate, or a Make N batch's count and how long it takes), its peak power, its machines, the
// raw material to build its new machines and to run it (to make the batch, in Make N) — with a short qualifier each that carries what the
// plan's cost sentence says besides the figure (P2-D27). `keyNumbers` reads them from the plan, `machineCount` counts the machines as the
// build list does, `compactNumber` writes a figure short enough for a narrow tile, and `countUpAt` eases a changed figure from the one shown.

import { PSEUDO_IDS, TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey } from '../../shared/keys.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { formatDuration, formatNumber, formatRate } from '../format.ts';
import { horizonText, notCounted } from './plan-cost.ts';

/** One tile of the strip. */
export interface KeyNumber {
  id: 'output' | 'power' | 'machines' | 'build' | 'run' | 'batch';
  /** What the tile counts ("Output", "Peak power", …), which the stylesheet writes in capitals. */
  label: string;
  /** The figure, which counts up when it changes; null for a dash and for a rate in words. */
  value: number | null;
  /** The figure as the tile shows it at rest and a screen reader hears it: `compactNumber`'s, a rate in words, or `—`. */
  text: string;
  /** What comes after the figure ("/min", "L/h", "EU/t", "raw", "raw/h"), or nothing. */
  unit: string;
  /** The qualifier at the right of the label: the target's name or the batch's time, the tier and amps, the new machines, what the build is counted against. */
  sub: string;
  /** A rate written in words ("1 every 526 days"), drawn in a smaller face, which never counts up. */
  words?: true;
}

/** How long a changed figure counts up, in ms (spec §10.1). */
export const COUNT_UP_MS = 400;
/** From here up a figure is written in 3 significant digits and a suffix (spec §10.1). */
const COMPACT_FROM = 100_000;
/** The suffix of each power of 1,000 a compact figure is written in. */
const SUFFIXES = ['k', 'M', 'G', 'T', 'P', 'E'];
/** A tile with no figure: a plan that cannot run, or a figure it lacks. */
const DASH = '—';
const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const PER_UNIT: Readonly<Record<PlanSettings['per'], string>> = { min: 'min', hour: 'h' };

/**
 * A figure short enough for the narrowest tile: below 100,000 as `formatNumber` writes it (`99,999`, `5,400`, `0.0586`), from there in 3
 * significant digits and the suffix of its power of 1,000 (`100k`, `540k`, `5.4M`, `12.3M`, `2.5G`; 999,999 rounds to `1M`, not `1,000k`).
 */
export function compactNumber(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) < COMPACT_FROM) return formatNumber(x);
  let scaled = Math.abs(x);
  let suffix = -1;
  // a power of 1,000 more while the figure, rounded to 3 digits, still has 4 before its point
  while (suffix < SUFFIXES.length - 1 && Number(scaled.toPrecision(3)) >= 1000) {
    scaled /= 1000;
    suffix++;
  }
  return `${x < 0 ? '-' : ''}${formatNumber(scaled)}${SUFFIXES[suffix] ?? ''}`;
}

/**
 * Where a figure that counts from `from` to `to` stands `elapsed` ms in (spec §10.1): a cubic ease-out over `duration` ms, `from` at the start
 * and exactly `to` from its end on, and always on its way from the one to the other, never back.
 */
export function countUpAt(from: number, to: number, elapsed: number, duration = COUNT_UP_MS): number {
  const t = duration > 0 ? Math.min(Math.max(elapsed / duration, 0), 1) : 1;
  return t === 1 ? to : from + (to - from) * (1 - (1 - t) ** 3);
}

/**
 * The machines the plan's steps run on, and how many of them are new (`count − owned`): a sharing pool's once, by its first step
 * (`machineGroups`), no hand step and no crafting table or furnace (`PSEUDO_IDS`); and in Make N, where the steps of one machine type share
 * that type's machines, each type once, by its first group — the build list's rule (bom.ts, `typesSeen`), whose new machines are those of
 * add-on 17's Compare card (compare.ts).
 */
export function machineCount(plan: Pick<Plan, 'steps' | 'makeN'>): { total: number; new: number } {
  const batch = plan.makeN !== undefined;
  const typesSeen = new Set<number>();
  let total = 0;
  let added = 0;
  for (const group of machineGroups(plan.steps)) {
    const step = group[0]!;
    const mteId = step.machine.mteId;
    if (step.handCraft || PSEUDO_IDS.has(mteId) || (batch && typesSeen.has(mteId))) continue;
    typesSeen.add(mteId);
    total += step.count;
    added += Math.max(0, step.count - step.owned);
  }
  return { total, new: added };
}

/** A tile with its figure, written by `compactNumber`. */
function figure(id: KeyNumber['id'], label: string, value: number, unit: string, sub: string): KeyNumber {
  return { id, label, value, text: compactNumber(value), unit, sub };
}

/** A tile with no figure: a dash and no unit. */
function dash(id: KeyNumber['id'], label: string, sub = ''): KeyNumber {
  return { id, label, value: null, text: DASH, unit: '', sub };
}

/**
 * What the line makes. In rate mode the plan's own rate in the settings' unit (`/min` or `/h`, in litres for a fluid; one too rare for a
 * figure in words, as `formatRate` writes it), and the name of the plan's target: never the settings' target, which is a newer pick while
 * its first plan is on its way (the Settings button and the panel name that one). In Make N the batch's count and the time it takes.
 */
function outputTile(plan: Plan, settings: Pick<PlanSettings, 'per' | 'amount'>, batch: boolean, ok: boolean): KeyNumber {
  if (batch) return ok && plan.makeN !== undefined ? figure('output', 'Output', settings.amount, '', formatDuration(plan.makeN.totalSeconds)) : dash('output', 'Output');
  const target = plan.target;
  const name = target === undefined ? '' : plan.names?.[target] ?? target;
  const perSecond = plan.targetPerSecond;
  if (!ok || perSecond === undefined) return dash('output', 'Output', name);
  const fluid = target !== undefined && isFluidKey(target);
  const rate = formatRate(perSecond, settings.per, { fluid });
  if (rate.includes(' every ')) return { id: 'output', label: 'Output', value: null, text: rate, unit: '', sub: name, words: true };
  return figure('output', 'Output', perSecond * SECONDS_PER[settings.per], `${fluid ? 'L' : ''}/${PER_UNIT[settings.per]}`, name);
}

/**
 * What the build cost is counted against, the first that applies: `not counted` (no horizon and no batch: least raw material, or "Ignore
 * build cost"); `+N not counted` for the new machines whose price could not be worked out; `for the batch` in Make N; else the horizon.
 */
function buildQualifier(cost: NonNullable<Plan['cost']>, batch: boolean): string {
  if (cost.horizonHours === null && cost.batch === undefined) return 'not counted';
  if (notCounted(cost) !== '') return `+${formatNumber(cost.unpriced ?? 0)} not counted`;
  if (batch) return 'for the batch';
  return cost.horizonHours === null ? '' : `over ${horizonText(cost.horizonHours)}`;
}

/**
 * The strip's five tiles for `plan` (spec §10.1), in the settings' rate unit and with a Make N batch's count; null while the plan is on its
 * way. A plan that cannot run (not `ok`) gives the five tiles with `—`, and so does a figure a plan lacks (a plan with no cost). A plan with
 * figures says itself whether it is a batch's (`makeN`), so the tiles never mix a running line's figures with a batch's while a plan for the
 * other mode is on its way; a plan without any is read in the mode the settings ask for.
 */
export function keyNumbers(plan: Plan | null, settings: Pick<PlanSettings, 'mode' | 'per' | 'amount'>): KeyNumber[] | null {
  if (plan === null) return null;
  const ok = (plan.status ?? 'ok') === 'ok';
  const batch = ok ? plan.makeN !== undefined : settings.mode === 'makeN';
  const cost = ok ? plan.cost : undefined;
  const { peakEUt, voltageTier, amps } = plan.power;
  const tier = TIER_NAMES[voltageTier];
  const machines = machineCount(plan);
  return [
    outputTile(plan, settings, batch, ok),
    ok ? figure('power', 'Peak power', peakEUt, 'EU/t', `${tier === undefined ? '' : `${tier} · `}${formatNumber(amps)} A`) : dash('power', 'Peak power'),
    ok ? figure('machines', 'Machines', machines.total, '', `${formatNumber(machines.new)} new`) : dash('machines', 'Machines'),
    cost === undefined ? dash('build', 'To build') : figure('build', 'To build', cost.build, 'raw', buildQualifier(cost, batch)),
    batch
      ? (cost?.batch === undefined ? dash('batch', 'Batch') : figure('batch', 'Batch', cost.batch, 'raw', ''))
      : (cost === undefined ? dash('run', 'To run') : figure('run', 'To run', cost.runPerHour, 'raw/h', '')),
  ];
}
