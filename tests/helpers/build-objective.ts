// The build MIP's measure of a finished running-line plan (plan 12; controller ruling 187: the real-data acceptance holds
// a plan to another by it), read from what the plan says: one copy for every real-data file that weighs plans this way.

import { HAND_STEP_WEIGHT } from '../../src/server/planner/solve.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_STEP_CHARGE, type Plan, type PlanSettings } from '../../src/shared/types/plan.ts';

const SECONDS_PER_HOUR = 3600;

/**
 * What `plan`, a running line planned with `settings`, costs by the build MIP's measure (build-mip.ts, fix wave 2 (a)), its
 * tie-breaks aside: the raw material it uses over the build horizon (24 hours where build cost is ignored), the raw
 * material to build its new machines (`Plan.cost.build`, a cleanroom included), and the step charge on every new machine
 * block — `stepCharge` × `least` × the horizon, at least the charge on one raw unit, `least` being the line's least raw
 * material a second with gathered world blocks dug (S1g) — a sharing pool's machines once, a step on a pseudo machine
 * (the vanilla furnace; the automated crafting table of a pack without an Auto Workbench) once, a step crafted by hand
 * `HAND_STEP_WEIGHT` times whether or not the line's crafting is automated (`solveOptions`: `handWeight` by hand,
 * `byHandWeight` for a recipe no Auto Workbench runs), owned machines none. Two plans are weighed alike with one `least`.
 */
export function buildObjective(plan: Plan, settings: PlanSettings, least: number): number {
  if (settings.mode !== 'rate') throw new Error('buildObjective weighs running lines; a Make N batch counts against itself');
  const horizon = (settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS) * SECONDS_PER_HOUR;
  const charge = (settings.stepCharge ?? DEFAULT_STEP_CHARGE) * Math.max(least * horizon, 1);
  let blocks = 0;
  for (const step of plan.steps) {
    if (step.pool !== undefined && step.pool.steps[0] !== step.id) continue;   // a pool's machines once, by its first step
    if (step.handCraft) blocks += HAND_STEP_WEIGHT;
    else if (step.machine.mteId < 0) blocks += 1;
    else blocks += Math.max(0, step.count - step.owned);
  }
  return (plan.rawCost?.perSecond ?? 0) * horizon + (plan.cost?.build ?? 0) + charge * blocks;
}
