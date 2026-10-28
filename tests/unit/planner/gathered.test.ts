// Gathered world blocks the walk may make (plan 12 Tasks 3 and 5; change request 13, controller Amendment OQ4): with build
// cost counted on an AE2 or Project Red line, sand and gravel stay buyable at their price and the candidate walk also
// offers their recipes, pruned on both estimates; machine prices and build-material breakdowns keep digging them.

import { describe, it, expect } from 'vitest';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { sandSpec } from '../../helpers/build-fixtures.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { gatheredRecipesOn, planBasis } from '../../../src/server/planner/basis.ts';
import { buildBom } from '../../../src/server/planner/bom.ts';
import { buildKeys, itemPrices } from '../../../src/server/planner/build-cost.ts';
import { buildCandidates, type CandidateGraph, type LeafOracle } from '../../../src/server/planner/candidates.ts';
import { makeLeafOracle } from '../../../src/server/planner/costs.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const SAND = 'minecraft:sand@0';
const GRAVEL = 'minecraft:gravel@0';
const COBBLE = 'minecraft:cobblestone@0';
const pack = packFromSpec(sandSpec());
const lv: PlanSettings = { ...defaultSettings(), target: 't:glass@0', tier: 1 };
const ctx = emptyContext();
const basis = planBasis(pack, lv, ctx);

/** The line's leaf oracle on `p` at `s`, with or without the recipes of gathered blocks. */
function leafOn(p: Pack, s: PlanSettings): (gathered: boolean) => LeafOracle {
  const b = planBasis(p, s, ctx);
  return (gathered) => makeLeafOracle(p, s, b.avail, b.prices, undefined, undefined, { supplied: b.supplied, gatheredRecipes: gathered });
}
const leafOf = leafOn(pack, lv);

const stepIds = (graph: CandidateGraph): string[] => graph.recipes.filter((r) => r.kind === 'recipe').map((r) => r.id);

/** A synthetic step on machine `mteId` that needs one new machine (as bom-steps.test.ts builds them). */
function stepOn(mteId: number, name: string): PlanStep {
  return {
    id: 'x', recipeId: 'x', mapId: 'm', machine: { mteId, name, tier: 1 }, count: 1, owned: 0, runsPerSecond: 0.1, utilization: 1, euPerTick: 0,
    durationTicks: 20, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [],
  };
}

describe('gathered blocks the walk may make', () => {
  it('offers the recipes of a gathered block and keeps it buyable', () => {
    expect(leafOf(true)(SAND)).toEqual({ buyable: true, cost: 1, leafClass: 'natural', alsoMade: true });
    expect(leafOf(true)(GRAVEL)).toEqual({ buyable: true, cost: 1, leafClass: 'natural', alsoMade: true });
    const graph = buildCandidates(pack, lv, basis.env, leafOf(true), ['t:glass@0']);
    const supply = pack.recipes.find((r) => r.meta.supply === 'rock-breaker');
    expect(stepIds(graph)).toEqual(['gravel-hand', 'hammer-gravel', 'hammer-sand', supply!.id, 'smelt-glass'].sort());
    expect(graph.goods.get(SAND)).toMatchObject({ buyable: true, cost: 1, alsoMade: true });
    expect(graph.goods.get(GRAVEL)).toMatchObject({ buyable: true, cost: 1, alsoMade: true });
    // Plan 09 R1 as built: a plain leaf.
    const dug = buildCandidates(pack, lv, basis.env, leafOf(false), ['t:glass@0']);
    expect(stepIds(dug)).toEqual(['smelt-glass']);
    expect(dug.goods.get(SAND)?.alsoMade).toBeUndefined();
  });

  it('makes world blocks only, not logs', () => {
    // Mini-GT's Oak Wood is natural by its logWood name.
    expect(leafOf(true)('minecraft:log@0')).toMatchObject({ buyable: true, leafClass: 'natural' });
    expect(leafOf(true)('minecraft:log@0').alsoMade).toBeUndefined();
    // A running line supplies its cobblestone from the rock breaker.
    expect(leafOf(true)(COBBLE).buyable).toBe(false);
  });

  it('digs gathered blocks for machine prices and build materials', async () => {
    // 4 sand dug at 1 beside the hull's 9; never 9 through free cobblestone and hammers.
    const prices = await itemPrices(pack, lv, ctx, buildKeys(pack, [machineByMteId(pack, 491)!]));
    expect(prices.cost('machine:491@0')).toBe(13);
    const bom = await buildBom(pack, [stepOn(491, 'Basic Sifter')], { settings: lv, env: basis.env, leaf: leafOf(true), ctx });
    expect(bom.totals.find((t) => t.key === SAND)?.amount).toBe(4);
    expect(bom.totals.some((t) => t.key === COBBLE)).toBe(false);
    // A one-off part made from frit is made from iron: dug sand costs 1, so frit-sand (2) never undercuts frit-iron (1).
    const spec = sandSpec({ frit: true });
    spec.machines?.push({ mteId: 492, name: 'Frit Kiln', tier: 1, maps: [] });
    spec.recipes?.push({ id: 'make-492', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:frit@0', 1]], out: [['machine:492@0', 1]] });
    const kilnPack = packFromSpec(spec);
    const kilnBasis = planBasis(kilnPack, lv, ctx);
    const kiln = await buildBom(kilnPack, [stepOn(492, 'Frit Kiln')], { settings: lv, env: kilnBasis.env, leaf: leafOn(kilnPack, lv)(true), ctx });
    expect(kiln.totals.map((t) => [t.key, t.amount])).toEqual([['t:iron_ingot@0', 9], ['t:tin_ingot@0', 1]]);
  });

  it('keeps the producers that dug sand makes worth keeping', () => {
    const packF = packFromSpec(sandSpec({ frit: true }));
    const lvF = { ...lv, target: 't:frit@0' };
    const envF = planBasis(packF, lvF, ctx).env;
    const leafOfF = leafOn(packF, lvF);
    // Made sand estimates 0, so KEEP_WITHIN × 0 alone would cut frit-iron, and R4 keeps frit-sand at the tie of one step;
    // dug at 1, sand puts frit-sand at 2, within 2 × 1 of frit-iron.
    expect(stepIds(buildCandidates(packF, lvF, envF, leafOfF(true), ['t:frit@0']))).toEqual(expect.arrayContaining(['frit-iron', 'frit-sand']));
    expect(stepIds(buildCandidates(packF, lvF, envF, leafOfF(false), ['t:frit@0']))).toEqual(expect.arrayContaining(['frit-iron', 'frit-sand']));
  });

  it('offers them only on AE2 and Project Red lines that count build cost', () => {
    // Controller Amendment OQ4 (ruling P1): machine-to-machine and EnderIO lines dig them, and so does "Ignore build cost".
    const on = (p: Partial<PlanSettings>): boolean => gatheredRecipesOn({ ...lv, ...p });
    expect((['ae2', 'routed', 'direct', 'enderio'] as const).map((logistics) => on({ logistics }))).toEqual([true, true, false, false]);
    expect(on({ logistics: 'ae2', buildHorizonHours: null })).toBe(false);
    expect(on({ logistics: 'routed', mode: 'makeN', buildHorizonHours: null })).toBe(true);
  });

  it('chooses the iron route when making sand does not pay', async () => {
    // Task 5 (review): the line's own graph offers the recipes of gathered blocks (an AE2 line, ruling P1). F = 1, σ = 1:
    // iron 1 + 16 + 0.02 < dug sand 2 + 16 + 0.02 < sand from cobblestone with gravel by hand 37 + 0.12. Pruned on the
    // made-sand estimate alone, the graph would hold only frit-sand and the plan would use 2 raw a frit. Crafted by hand,
    // as the arithmetic is.
    const settings: PlanSettings = {
      ...lv, target: 't:frit@0', amount: 1, per: 'hour', buildHorizonHours: 1, stepCharge: 0.02, logistics: 'ae2', automateCrafting: false,
    };
    const plan = await planLine(packFromSpec(sandSpec({ frit: true })), settings, ctx);
    expect(plan.steps.map((s) => s.id)).toEqual(['frit-iron']);
    expect(plan.rawInputs.map((r) => r.key)).toEqual(['t:iron_ingot@0']);
    expect(plan.cost).toEqual({ runPerHour: 1, build: 16, horizonHours: 1 });
  });
});
