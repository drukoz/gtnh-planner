// The three planning modes (add-on 17; design spec §3.3, architecture §11.45 (1), (3), (4)): the mode and build horizon a
// project's settings plan with (`objectiveOf`, `horizonHoursOf`: in rate mode a null horizon is least raw whatever the
// stored mode says), what one raw source weighs in best multi-output's build MIP (`sourceWeight`), the capped free
// supplies of the farms the group runs (`runningSupplies`), and what a line reads of the group's other projects (`Offer`,
// `Need`), which `planLine` turns into the solver's supply and credit columns.

import type { StuffKey } from '../../shared/keys.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_OBJECTIVE, type PlanObjective, type PlanSettings } from '../../shared/types/plan.ts';
import type { SupplyColumn } from './solve.ts';

/**
 * Best multi-output weighs each raw source the line buys at this many horizons of the farm-free line's mean raw input
 * (`sourceWeight`): a constant, no project setting (controller ruling OQ4).
 */
export const SOURCE_WEIGHT_HORIZONS = 1;

/** Least raw material per unit of demand up to this counts as none (solve.ts's threshold): such a line weighs no source. */
const TINY = 1e-9;
const SECONDS_PER_MINUTE = 60;

/**
 * The mode a project plans in: rate mode with `buildHorizonHours === null` plans least raw material, whatever `objective`
 * says (add-on 12's "Ignore build cost", as settings built `{ ...defaultSettings(), buildHorizonHours: null }` mean it;
 * change request 1); else `objective`, or `DEFAULT_OBJECTIVE` for settings stored before it.
 */
export function objectiveOf(settings: PlanSettings): PlanObjective {
  if (settings.mode === 'rate' && settings.buildHorizonHours === null) return 'least-raw';
  return settings.objective ?? DEFAULT_OBJECTIVE;
}

/**
 * The hours of running the build cost of new machines is weighed against: none in least raw (build cost is not counted)
 * and none in Make N (the batch is the horizon); else `buildHorizonHours`, or `DEFAULT_BUILD_HORIZON_HOURS` for settings
 * stored before it.
 */
export function horizonHoursOf(settings: PlanSettings): number | null {
  if (settings.mode === 'makeN' || objectiveOf(settings) === 'least-raw') return null;
  return settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS;
}

/**
 * A raw source's weight in the build MIP's units (raw material over the horizon / σ): one horizon of the farm-free line's
 * mean raw input, `SOURCE_WEIGHT_HORIZONS × s1f × F / (max(1, k1f) × σ)`, where `s1f` is the least raw material per unit
 * of demand with the synthetic farm recipes off and `k1f` its count of raw sources (S1f, solve.ts), `F` the demand scale
 * × the horizon (Make N: the batch) and `sigma` the raw material one unit of the MIP's objective stands for. So the mode
 * pays up to one average input's worth of raw material, machines included, to need one input fewer, and never more; 0
 * when `s1f` ≤ 1e-9 (a line that needs no raw material has no source to drop).
 */
export function sourceWeight(x: { s1f: number; k1f: number; F: number; sigma: number }): number {
  if (!(x.s1f > TINY)) return 0;
  return (SOURCE_WEIGHT_HORIZONS * x.s1f * x.F) / (Math.max(1, x.k1f) * x.sigma);
}

/**
 * The capped free supplies of the farms the group runs (`FarmSettings.running`): one column per farm and good, id
 * `farm:<index>:<key>` (its outputs of one good summed), per second, with the farm's name; in farm order, then the order
 * of its outputs. Free up to the rate typed in; `planLine` passes them in rate mode only.
 */
export function runningSupplies(settings: PlanSettings): Array<SupplyColumn & { name: string }> {
  const supplies: Array<SupplyColumn & { name: string }> = [];
  (settings.farms?.running ?? []).forEach((farm, index) => {
    const perMinute = new Map<StuffKey, number>();
    for (const output of farm.outputs) perMinute.set(output.key, (perMinute.get(output.key) ?? 0) + output.perMinute);
    for (const [key, amount] of perMinute) {
      supplies.push({ id: `farm:${index}:${key}`, key, perSecond: amount / SECONDS_PER_MINUTE, name: farm.name });
    }
  });
  return supplies;
}

/**
 * Another project's surplus a line may take (Task 6 reads it from the published summaries): a capped free supply of the
 * line, id `project:<from>:<key>`, shown as a "from <project>" raw input.
 */
export interface Offer {
  from: string /* the project's id */; name: string /* its name */; key: StuffKey; perSecond: number;
  // optional addition (ruling R16, OQ3: several readers of one producer are served oldest first)
  /** The producer's whole surplus and the older projects whose draws reduced this offer (names), when they did. */
  shared?: { surplus: number; takenBy: string[] };
}

/**
 * Another project's need of a good (Task 6 reads it from the published summaries): a multi-output line is credited for
 * the byproduct its own runs make of it, up to `perSecond`, as `need:<by>:<key>` (ruling R14).
 */
export interface Need { by: string /* the project's id */; name: string /* its name */; key: StuffKey; perSecond: number }
