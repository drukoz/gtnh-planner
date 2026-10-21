// What a plan costs in raw material, in words (plan 12 Task 7, design spec §3.3, architecture §11.39): the plan banner's
// line of what the line uses to run and to build its new machines, and what the build cost was counted against (the
// build horizon, nothing with "Ignore build cost", the batch in Make N); and the Materials page's build total, the
// machines with the layout's power and logistics parts. Machines whose price could not be worked out (`Plan.cost.
// unpriced`) are said not to be counted. Pure functions; numbers through the shared formatter (fix spec §6.1).

import type { Plan } from '../../shared/types/plan.ts';
import { formatNumber } from '../format.ts';

const HOURS_PER_WEEK = 168;

/** A build horizon in words: `1 h`, `24 h`, `1 week`, `48 h`. */
export function horizonText(hours: number): string {
  return hours === HOURS_PER_WEEK ? '1 week' : `${formatNumber(hours)} h`;
}

/** ` (<n> more not counted)` for the new machines the build figure leaves out, else nothing. */
function notCounted(cost: NonNullable<Plan['cost']>): string {
  return cost.unpriced !== undefined && cost.unpriced > 0 ? ` (${formatNumber(cost.unpriced)} more not counted)` : '';
}

/**
 * The plan banner's cost line: `<run> raw per hour to run + <build> raw to build new machines, counted over <horizon>`;
 * with build cost ignored `… (build cost not counted)` in place of the horizon; in Make N (`cost.batch`) `<batch> raw for
 * the batch + <build> raw to build new machines`; the build figure followed by ` (<n> more not counted)` for machines
 * whose price could not be worked out. Null for a plan without a cost.
 */
export function costLine(plan: Plan): string | null {
  const cost = plan.cost;
  if (cost === undefined) return null;
  const build = `${formatNumber(cost.build)} raw to build new machines${notCounted(cost)}`;
  if (cost.batch !== undefined) return `${formatNumber(cost.batch)} raw for the batch + ${build}`;
  const run = `${formatNumber(cost.runPerHour)} raw per hour to run + ${build}`;
  return cost.horizonHours === null ? `${run} (build cost not counted)` : `${run}, counted over ${horizonText(cost.horizonHours)}`;
}

/**
 * The Materials page's build total: with the layout's parts priced (`cost.layout` above 0) `About <both> raw to build:
 * <build> for the machines, <layout> for power and logistics parts`; else `Nothing new to build` when nothing is built
 * and nothing is left out, else `About <build> raw to build the machines` — the machines' figure followed by ` (<n> more
 * not counted)` for those whose price could not be worked out. Null for a plan without a cost.
 */
export function buildTotalLine(plan: Plan): string | null {
  const cost = plan.cost;
  if (cost === undefined) return null;
  const build = formatNumber(cost.build);
  const left = notCounted(cost);
  if (cost.layout !== undefined && cost.layout > 0) {
    return `About ${formatNumber(cost.build + cost.layout)} raw to build: ${build} for the machines${left}, ${formatNumber(cost.layout)} for power and logistics parts`;
  }
  if (cost.build === 0 && left === '') return 'Nothing new to build';
  return `About ${build} raw to build the machines${left}`;
}
