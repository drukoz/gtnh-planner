// An empty `PlanContext` for the planner tests of Plan 2 Tasks 11–13, which must not import `plan.ts` before Task 14
// creates it (ruling R18: an accepted duplicate of Task 14's `emptyContext`).

import type { PlanContext } from '../../src/shared/types/plan.ts';

/** No world scan: nothing owned, nothing in storage, no visited dimensions, tier and coil heat unknown. */
export function emptyContextForTest(): PlanContext {
  return { ownedMachines: [], storage: new Map(), visitedDims: [], topTier: null, coilHeat: null, prospected: [] };
}
