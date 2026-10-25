// The build MIP's measure of a finished running-line plan (plan 12; controller ruling 187: the real-data acceptance holds
// a plan to another by it), read from what the plan says: one copy for every real-data file that weighs plans this way.

import { LEAN_BASE_ABOVE, OWNED_STEP_SHARE } from '../../src/server/planner/build-mip.ts';
import { BY_HAND_FLOOR_CHARGE, HAND_STEP_WEIGHT } from '../../src/server/planner/solve.ts';
import { PSEUDO_MACHINES } from '../../src/shared/gt/tiers.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_STEP_CHARGE, type Plan, type PlanSettings } from '../../src/shared/types/plan.ts';

const SECONDS_PER_HOUR = 3600;

/**
 * What `plan`, a running line planned with `settings`, costs by the build MIP's measure (build-mip.ts, fix wave 2 (a)), its
 * tie-breaks aside: the raw material it uses over the build horizon (24 hours where build cost is ignored), the raw
 * material to build its new machines (`Plan.cost.build`, a cleanroom included), and the step charge on every new machine
 * block — `stepCharge` × the base build-mip.ts `scaleOf` measures it against: σ, `least` × the horizon and at least one
 * raw unit, `least` being the line's least raw material a second with gathered world blocks dug (S1g), or `leanest` × the
 * horizon where that is more than LEAN_BASE_ABOVE × σ, `leanest` the leanest line's raw material a second
 * (`Plan.rawCost.leanestPerSecond`, fix wave 3 (B2); 0 where the plan has none) — a sharing pool's machines once, a step
 * on a pseudo machine (the vanilla furnace; the automated crafting table of a pack without an Auto Workbench) once, a
 * step crafted by hand `HAND_STEP_WEIGHT` times whether or not the line's crafting is automated (`solveOptions`:
 * `handWeight` by hand, `byHandWeight` for a recipe no Auto Workbench runs), and every machine the group owns that the
 * line runs on OWNED_STEP_SHARE of a block's charge (ledger 265, controller OQ24): each distinct owned machine the plan
 * reports (`reused.units` and `reused.others[].units`) once, a step that lists no units its `owned` (a sharing pool's
 * once). With crafting automated at step charge 0 a crafting-table step by hand, or on the automated crafting table of a
 * pack without an Auto Workbench, pays at least BY_HAND_FLOOR_CHARGE × σ a block (the controller's U2 ruling,
 * `SolveOptions.byHandFloor`). Two plans are weighed alike with one `least` and one `leanest`.
 */
export function buildObjective(plan: Plan, settings: PlanSettings, least: number, leanest = 0): number {
  if (settings.mode !== 'rate') throw new Error('buildObjective weighs running lines; a Make N batch counts against itself');
  const horizon = (settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS) * SECONDS_PER_HOUR;
  const sigma = Math.max(least * horizon, 1);
  const lean = leanest * horizon;
  const stepCharge = settings.stepCharge ?? DEFAULT_STEP_CHARGE;
  const charge = stepCharge * (lean > LEAN_BASE_ABOVE * sigma ? lean : sigma);
  /** A crafting-table step's charge on a block: the U2 floor where crafting is automated at step charge 0 (`solveOptions`). */
  const craftCharge = settings.automateCrafting && !(stepCharge > 0) ? BY_HAND_FLOOR_CHARGE * sigma : charge;
  let blocks = 0;
  /** The blocks of the crafting-table steps on no machine (by hand, or on the automated crafting table). */
  let crafted = 0;
  /** The owned machines the plan runs on, by type and unit, and the count of those listed without units. */
  const units = new Set<string>();
  let unlisted = 0;
  for (const step of plan.steps) {
    for (const u of step.reused?.units ?? []) units.add(`${step.machine.mteId}#${u}`);
    for (const o of step.reused?.others ?? []) {
      for (const u of o.units ?? []) units.add(`${o.mteId}#${u}`);
      if (o.units === undefined) unlisted += o.count;
    }
    if (step.pool !== undefined && step.pool.steps[0] !== step.id) continue;   // a pool's machines once, by its first step
    if (step.reused?.units === undefined) unlisted += step.owned;
    if (step.handCraft) crafted += HAND_STEP_WEIGHT;
    else if (step.machine.mteId === PSEUDO_MACHINES.CRAFTING_TABLE) crafted += 1;
    else if (step.machine.mteId < 0) blocks += 1;
    else blocks += Math.max(0, step.count - step.owned);
  }
  const owned = units.size + unlisted;
  return (plan.rawCost?.perSecond ?? 0) * horizon + (plan.cost?.build ?? 0) + charge * (blocks + OWNED_STEP_SHARE * owned) + craftCharge * crafted;
}
