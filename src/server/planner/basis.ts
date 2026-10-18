// The planner's basis: the one place that turns a project's settings and the world context into the tier, the
// reachable dimensions, the environment the candidate recipes are judged in, material availability, prices and the leaf
// oracle, so `planLine` and `expandBomLines` always derive them the same way.

import { defaultCoilHeat } from '../../shared/gt/overclock.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { computeAvailability, reachableDims, type Availability, type Reachability } from './availability.ts';
import type { LeafOracle, PlanEnv } from './candidates.ts';
import { makeLeafOracle, makePrices, type PriceTable } from './costs.ts';
import { roughCosts, type RoughCosts } from './rough.ts';

/** The tier the line is planned at: the project's own, else the world's top tier, else LV. */
export function effectiveTier(s: PlanSettings, ctx: PlanContext): number {
  return s.tier ?? ctx.topTier ?? 1;
}

export interface PlanBasis {
  tier: number; coilHeat: number; reach: Reachability; env: PlanEnv; avail: Availability; prices: PriceTable; leaf: LeafOracle;
  /**
   * Rough costs with derived materials made, not bought, and the target never an input (rough.ts): they prune the
   * candidate graph and price derived leaves.
   */
  rough: RoughCosts;
  /**
   * What making a good costs the line without consuming the target (`rough.cost`), the price `makeLeafOracle` gives a
   * derived leaf; Infinity when only a chain through the target makes it; undefined when rough costs cannot tell.
   */
  madeCost: (key: StuffKey) => number | undefined;
}

function sortedKeys(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The planner's environment for a project in a world: tier (`effectiveTier`); coil heat (the project's, else the
 * world's, else the default coil of the tier); the dimensions it reaches; what it can get there; the env candidate
 * recipes are judged in, with the multiblocks it can build; prices with the project's cost overrides; rough costs; and
 * the leaf oracle over those.
 */
export function planBasis(pack: Pack, settings: PlanSettings, ctx: PlanContext): PlanBasis {
  const tier = effectiveTier(settings, ctx);
  const coilHeat = settings.coilHeat ?? ctx.coilHeat ?? defaultCoilHeat(tier);
  const reach = reachableDims(pack.worldgen, settings.dims, ctx.visitedDims, tier);
  const open: PlanEnv = { tier, reachable: reach.keys, lowGravity: reach.lowGravity, coilHeat, excluded: new Set(settings.excludedCategories) };
  const avail = computeAvailability(pack, open);
  // Candidate recipes may only use the multiblocks the group can build at this tier, and never mine an ore material
  // from free inputs alone (availability.ts).
  const env: PlanEnv = { ...open, multiblocks: avail.multiblocks, fromNothing: avail.fromNothing };
  const prices = makePrices(pack, settings.costOverrides);
  const routed = makeLeafOracle(pack, { ...settings, routeDerived: true }, avail, prices);
  const roughKey = JSON.stringify([sortedKeys(settings.costOverrides), [...settings.stopItems].sort(), [...settings.expandItems].sort()]);
  const anyInputs = roughCosts(pack, env, routed, avail.available, roughKey);
  const rough = settings.target === null ? anyInputs : roughCosts(pack, env, routed, avail.available, roughKey, [settings.target]);
  const madeCost = (key: StuffKey): number | undefined => {
    const withoutTarget = rough.cost(key);
    if (Number.isFinite(withoutTarget)) return withoutTarget;
    return Number.isFinite(anyInputs.cost(key)) ? Infinity : undefined;   // only the target makes it; else no estimate
  };
  const leaf = makeLeafOracle(pack, settings, avail, prices, undefined, madeCost);
  return { tier, coilHeat, reach, env, avail, prices, leaf, rough, madeCost };
}
