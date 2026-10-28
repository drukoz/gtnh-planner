// The key-numbers strip (Phase 2 spec §10, D12), as pure functions: the five figures a line is read by at a glance, each a readout tile at
// the top of the banners' box — what it makes (a rate, or a Make N batch's count and how long it takes), its peak power, its machines, the
// raw material to build its new machines and to run it (to make the batch, in Make N) — with a short qualifier each that carries what the
// plan's cost sentence says besides the figure (P2-D27). `keyNumbers` reads them from the plan, `machineCount` counts the machines as the
// build list does, `compactNumber` writes a figure short enough for a narrow tile, and `countUpAt` and `nextCount` ease a changed figure from
// the one shown. A tile is read to a screen reader once, with the exact figure (`spoken`) and every qualifier of the cost sentence (`more`),
// so the sentence itself is hidden from a screen reader beside the strip (fix round 1 of Task 7: I2, M2, M5).

import { PSEUDO_IDS, TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey } from '../../shared/keys.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import { settingsHash } from '../../shared/project/settings-hash.ts';
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
  /** The figure as the tile shows it at rest: `compactNumber`'s, a rate in words, or `—`. */
  text: string;
  /** The figure as a screen reader hears it, in the visually hidden copy: exact (`formatNumber`'s, as the cost sentence writes it), the rate in
   *  words, or a dash's words (spec §10.1, §10.4). */
  spoken: string;
  /** What comes after the figure ("/min", "L/h", "EU/t", "raw", "raw/h"), or nothing. */
  unit: string;
  /** The qualifier at the right of the label: the target's name or the batch's time, the tier and amps, the new machines, what the build is counted against. */
  sub: string;
  /** What else qualifies the figure, which `sub` has no room for and a screen reader hears after it: the build cost's other qualifiers. */
  more?: string;
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
/** A dash's words for a screen reader, which often says nothing for a lone "—" (fix round 1, M5). */
const DASH_WORDS = 'not available';
/** How near a rate must come to the settings' amount to be the plan of that amount: the server writes it to 9 significant digits (`sig9`). */
const SAME_RATE = 1e-6;
/** How many settings states `planDrawn` remembers, the oldest forgotten first: far more than one replan's changes. */
const UNITS_KEPT = 64;
const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const PER_UNIT: Readonly<Record<PlanSettings['per'], string>> = { min: 'min', hour: 'h' };

/**
 * A figure short enough for the narrowest tile: below 100,000 as `formatNumber` writes it (`99,999`, `5,400`, `0.0586`), from there in 3
 * significant digits and the suffix of its power of 1,000 (`100k`, `540k`, `5.4M`, `12.3M`, `2.5G`; 999,999 rounds to `1M`, not `1,000k`).
 */
export function compactNumber(x: number): string {
  // the form follows the figure as written: from 1,000 `formatNumber` writes it whole, so 99,999.6 is 100,000, and so 100k (fix round 1, M6)
  if (!Number.isFinite(x) || Math.round(Math.abs(x)) < COMPACT_FROM) return formatNumber(x);
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

/** A figure counting up (`useCountUp`'s state): the figure it set out `from`, the one it goes `to`, the unit they are in, and the figure `shown` now. */
export interface Count { from: number | null; to: number | null; unit: string; shown: number | null }

/**
 * `useCountUp`'s step when `target` comes in `unit` (spec §10.1): the same target in the same unit changes nothing; another target counts on
 * from the figure shown; and it shows at once from a dash or to one, in another unit (a figure in another unit is another figure, never
 * counted from: fix round 1, M3) and while `reduced()` says the system asks for less motion (asked on a change only).
 */
export function nextCount(count: Count, target: number | null, unit: string, reduced: () => boolean): Count {
  if (Object.is(count.to, target) && count.unit === unit) return count;
  const instant = target === null || count.shown === null || count.unit !== unit || reduced();
  return { from: instant ? target : count.shown, to: target, unit, shown: instant ? target : count.shown };
}

/** A tile's flash (spec §10.1): what it last showed (its text, its unit and whether that was a figure), how many times that changed (which keys
 *  the frame, so each change replays it), and whether the frame still runs. */
export interface Flash { text: string; unit: string; figure: boolean; changes: number; running: boolean }

/**
 * The flash's step when the tile comes to show `n`: a new text flashes the tile once (its frame replays, its qualifier turns yellow); but a
 * figure that comes in another unit than the figure it replaces shows without a flash, as it shows without a count (`nextCount`): it is
 * another figure, not a change of this one (fix round 2, ledger ruling P2-R49).
 */
export function nextFlash(flash: Flash, n: Pick<KeyNumber, 'text' | 'unit' | 'value'>): Flash {
  const figure = n.value !== null;
  if (flash.text === n.text && flash.unit === n.unit && flash.figure === figure) return flash;
  const another = flash.figure && figure && flash.unit !== n.unit;
  if (flash.text === n.text || another) return { ...flash, text: n.text, unit: n.unit, figure, running: another ? false : flash.running };
  return { text: n.text, unit: n.unit, figure, changes: flash.changes + 1, running: true };
}

/** Each settings object's hash, worked out once (a page draws the same settings object again and again). */
const HASHES = new WeakMap<PlanSettings, string>();

/** What a settings state asked of its plan, as the strip reads it: the unit of its rate and its amount (a Make N batch's count). */
export interface Drawn { per: PlanSettings['per']; amount: number }

/**
 * What the settings the plan on screen was made for asked of it (fix round 2, ledger ruling P2-R49; the final fix wave, FW-13): `drawn`
 * remembers the unit and the amount of every settings state the page draws, by its hash, and the plan carries the hash of the settings it was
 * made for (`Plan.settingsHash`, the same test as `flow-model.ts`'s "is this the plan of those settings"). So while the plan of 30 a minute is
 * on screen under settings of 60 an hour, its unit is the minute, and while a Make N batch of 64 is on screen under settings of 128, its count is
 * 64; undefined for settings this page never drew (the strip then reads the plan's own figures, `planPer`, and the settings' amount).
 */
export function planDrawn(drawn: Map<string, Drawn>, settings: PlanSettings, plan: Plan | null): Drawn | undefined {
  let hash = HASHES.get(settings);
  if (hash === undefined) {
    hash = settingsHash(settings);
    HASHES.set(settings, hash);
  }
  if (!drawn.has(hash)) {
    drawn.set(hash, { per: settings.per, amount: settings.amount });
    if (drawn.size > UNITS_KEPT) drawn.delete(drawn.keys().next().value as string);
  }
  return plan === null ? undefined : drawn.get(plan.settingsHash);
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

/** A tile with its figure, written by `compactNumber` and heard exact; `more`, the qualifiers `sub` has no room for, when there are any. */
function figure(id: KeyNumber['id'], label: string, value: number, unit: string, sub: string, more = ''): KeyNumber {
  return { id, label, value, text: compactNumber(value), spoken: formatNumber(value), unit, sub, ...(more === '' ? {} : { more }) };
}

/** A tile with no figure: a dash, its words for a screen reader, and no unit. */
function dash(id: KeyNumber['id'], label: string, sub = ''): KeyNumber {
  return { id, label, value: null, text: DASH, spoken: DASH_WORDS, unit: '', sub };
}

/**
 * The unit the plan's rate was planned in, read from its own figures (fix round 1, M3), where `planDrawn` does not know it: the settings' when
 * the rate gives their amount in it; else the other unit when it gives the amount there (the unit was changed, and the plan of the new one is
 * on its way); else the settings' (a new amount on its way, which the figure counts to).
 */
function planPer(perSecond: number, settings: Pick<PlanSettings, 'per' | 'amount'>): PlanSettings['per'] {
  const gives = (per: PlanSettings['per']): boolean =>
    Math.abs(perSecond * SECONDS_PER[per] - settings.amount) <= SAME_RATE * Math.max(1, Math.abs(settings.amount));
  if (gives(settings.per)) return settings.per;
  const other: PlanSettings['per'] = settings.per === 'min' ? 'hour' : 'min';
  return gives(other) ? other : settings.per;
}

/**
 * What the line makes. In rate mode the plan's own rate in the unit it was planned in (`/min` or `/h`, in litres for a fluid; one too rare
 * for a figure in words, as `formatRate` writes it), and the name of the plan's target: never the settings' target, which is a newer pick
 * while its first plan is on its way (the Settings button and the panel name that one). In Make N the batch's count and the time it takes: the
 * count of the settings the plan was made for (`planned`), never a newer amount typed while that plan is still on screen beside its time (FW-13).
 */
function outputTile(plan: Plan, settings: Pick<PlanSettings, 'per' | 'amount'>, batch: boolean, ok: boolean, planned?: Drawn): KeyNumber {
  if (batch) {
    if (!ok || plan.makeN === undefined) return dash('output', 'Output');
    return figure('output', 'Output', planned?.amount ?? settings.amount, '', formatDuration(plan.makeN.totalSeconds));
  }
  const target = plan.target;
  const name = target === undefined ? '' : plan.names?.[target] ?? target;
  const perSecond = plan.targetPerSecond;
  if (!ok || perSecond === undefined) return dash('output', 'Output', name);
  const fluid = target !== undefined && isFluidKey(target);
  const per = planned?.per ?? planPer(perSecond, settings);
  const rate = formatRate(perSecond, per, { fluid });
  if (rate.includes(' every ')) return { id: 'output', label: 'Output', value: null, text: rate, spoken: rate, unit: '', sub: name, words: true };
  return figure('output', 'Output', perSecond * SECONDS_PER[per], `${fluid ? 'L' : ''}/${PER_UNIT[per]}`, name);
}

/**
 * What the build cost is counted against, every one that applies, in this order: `not counted` (no horizon and no batch: least raw
 * material, or "Ignore build cost"); `+N not counted` for the new machines whose price could not be worked out; `for the batch` in Make N;
 * the horizon. The tile shows the first, and a screen reader hears the others after it, as the cost sentence says them all (fix round 1, M2).
 */
function buildQualifiers(cost: NonNullable<Plan['cost']>, batch: boolean): string[] {
  const all: string[] = [];
  if (cost.horizonHours === null && cost.batch === undefined) all.push('not counted');
  if (notCounted(cost) !== '') all.push(`+${formatNumber(cost.unpriced ?? 0)} not counted`);
  if (batch) all.push('for the batch');
  if (cost.horizonHours !== null) all.push(`over ${horizonText(cost.horizonHours)}`);
  return all;
}

/**
 * The strip's five tiles for `plan` (spec §10.1), its rate in the unit it was planned in and a Make N batch's count (`planned`, from `planDrawn`,
 * else read from its figures and the settings); null while the plan is on its way. A plan that cannot run (not `ok`) gives the five tiles with `—`, and so does a figure a plan lacks (a plan with no cost). A plan with
 * figures says itself whether it is a batch's (`makeN`), so the tiles never mix a running line's figures with a batch's while a plan for the
 * other mode is on its way; a plan without any is read in the mode the settings ask for.
 */
export function keyNumbers(
  plan: Plan | null, settings: Pick<PlanSettings, 'mode' | 'per' | 'amount'>, planned?: Drawn,
): KeyNumber[] | null {
  if (plan === null) return null;
  const ok = (plan.status ?? 'ok') === 'ok';
  const batch = ok ? plan.makeN !== undefined : settings.mode === 'makeN';
  const cost = ok ? plan.cost : undefined;
  const { peakEUt, voltageTier, amps } = plan.power;
  const tier = TIER_NAMES[voltageTier];
  const machines = machineCount(plan);
  const qualifiers = cost === undefined ? [] : buildQualifiers(cost, batch);
  return [
    outputTile(plan, settings, batch, ok, planned),
    ok ? figure('power', 'Peak power', peakEUt, 'EU/t', `${tier === undefined ? '' : `${tier} · `}${formatNumber(amps)} A`) : dash('power', 'Peak power'),
    ok ? figure('machines', 'Machines', machines.total, '', `${formatNumber(machines.new)} new`) : dash('machines', 'Machines'),
    cost === undefined ? dash('build', 'To build') : figure('build', 'To build', cost.build, 'raw', qualifiers[0] ?? '', qualifiers.slice(1).join(', ')),
    batch
      ? (cost?.batch === undefined ? dash('batch', 'Batch') : figure('batch', 'Batch', cost.batch, 'raw', ''))
      : (cost === undefined ? dash('run', 'To run') : figure('run', 'To run', cost.runPerHour, 'raw/h', '')),
  ];
}
