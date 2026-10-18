// The planner's basis: the one place that turns a project's settings and the world context into the tier, the
// reachable dimensions, the environment the candidate recipes are judged in, material availability, prices and the leaf
// oracle, so `planLine` and `expandBomLines` always derive them the same way. Also the settings hash, and the part of
// the world context the basis reads (`basisContextKey`), which together key what is derived from them (pricing.ts).

import { createHash } from 'node:crypto';
import { defaultCoilHeat } from '../../shared/gt/overclock.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { PlanContext, PlanSettings } from '../../shared/types/plan.ts';
import { computeAvailability, reachableDims, type Availability, type Reachability } from './availability.ts';
import type { LeafOracle, PlanEnv } from './candidates.ts';
import { makeLeafOracle, makePrices, type PriceTable } from './costs.ts';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A copy of `value` whose objects list their keys in sorted order, at every depth; arrays keep their order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort(byString).map((key) => [key, withSortedKeys(record[key])]));
}

/** The first 16 hex digits of the SHA-1 of the settings as JSON with every object's keys sorted. */
export function settingsHash(s: PlanSettings): string {
  return createHash('sha1').update(JSON.stringify(withSortedKeys(s))).digest('hex').slice(0, 16);
}

/** The tier the line is planned at: the project's own, else the world's top tier, else LV. */
export function effectiveTier(s: PlanSettings, ctx: PlanContext): number {
  return s.tier ?? ctx.topTier ?? 1;
}

/**
 * Every field of the world context `planBasis` reads (top tier, coil heat, visited dimensions, in their order): two
 * contexts with the same key give the same basis for the same settings. Whatever `planBasis` starts reading of the
 * context must be added here.
 */
export function basisContextKey(ctx: PlanContext): string {
  return JSON.stringify([ctx.topTier, ctx.coilHeat, ctx.visitedDims]);
}

export interface PlanBasis { tier: number; coilHeat: number; reach: Reachability; env: PlanEnv; avail: Availability; prices: PriceTable; leaf: LeafOracle }

/**
 * The planner's environment for a project in a world: tier (`effectiveTier`); coil heat (the project's, else the
 * world's, else the default coil of the tier); the dimensions it reaches; what it can get there; the env candidate
 * recipes are judged in, with the multiblocks it can build; prices with the project's cost overrides; and the leaf
 * oracle over those (derived leaves at their plain price: `linePricing` in pricing.ts prices the ones a line buys).
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
  const leaf = makeLeafOracle(pack, settings, avail, prices);
  return { tier, coilHeat, reach, env, avail, prices, leaf };
}
