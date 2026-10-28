// The user's own Electronic Circuit project as the planner audit copied it (2026-10-18, plan 09 Task 8, ruling P27):
// its settings only, never the project's name, id, author, marks or notes. Shared by the real-data tests that plan it
// (tests/unit/planner/real-user-project.test.ts, plan 09's complaints; real-build-cost.test.ts, the same settings with
// build cost counted where plan 09's checks move to the plan that ignores it).

import type { PlanSettings } from '../../src/shared/types/plan.ts';

/**
 * The project's stored settings, verbatim: stored before plan 09, so without its new settings (`normalizeSettings` fills
 * them: since plan 12's fix wave 2 the "Fewest machines" step charge, 0.5, and crafting on Auto Workbenches).
 */
export const USER_EC_STORED: Partial<PlanSettings> = {
  target: 'IC2:itemPartCircuit@0', mode: 'rate', amount: 1, per: 'hour', tier: 2, dims: { policy: 'progression', overrides: {} },
  routeDerived: false, logistics: 'routed', costOverrides: {}, stopItems: [], expandItems: [],
  recipeChoice: { 'fluid:glue': '98f259e40a64e8b0', 'gregtech:gt.metaitem.01@32716': '0a074f4241a9e0f9' }, machineTier: {},
  excludedCategories: ['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion'],
  coilHeat: null, automateCrafting: false, declineReuse: [],
};
