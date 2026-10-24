// "We already make this" priced honestly (add-on 14 Task 2, architecture §11 entry 41 (6) and (7)): a stopped item costs
// what making it on its own costs, never less than the metal in it, in the line and in add-on 12's machine prices alike,
// and the line never smelts a stopped part back into its own metal.

import { describe, it, expect } from 'vitest';
import { rodSpec } from '../../helpers/howto-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { itemPrices } from '../../../src/server/planner/build-cost.ts';
import type { LeafOracle } from '../../../src/server/planner/candidates.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = packFromSpec(rodSpec());
/** A Vacuum Tube a minute at LV, the group stopping both rods: least raw material, fewest recipes only on a tie, no build cost. */
const s: PlanSettings = {
  ...defaultSettings(), target: 't:tube@0', tier: 1, amount: 1, per: 'min', stopItems: ['t:steel_rod@0', 't:fancy_rod@0'], stepCharge: 0,
  buildHorizonHours: null,
};
const ROD = 't:steel_rod@0';
const FANCY = 't:fancy_rod@0';

/** `actual` lies within `within` of `expected`. */
function expectNear(actual: number | undefined, expected: number, within: number): void {
  expect(Math.abs((actual ?? NaN) - expected), `${String(actual)} is not within ${within} of ${expected}`).toBeLessThan(within);
}

/** The leaf oracle the line `x` is planned with. */
async function lineLeafOf(x: PlanSettings): Promise<LeafOracle> {
  const pricing = await linePricing(pack, x, emptyContext());
  if (pricing === null) throw new Error('the fixture has no target');
  return pricing.leaf;
}

/** The recipe ids of the steps of the line `x`, sorted. */
async function stepRecipes(x: PlanSettings): Promise<string[]> {
  return (await planLine(pack, x, emptyContext())).steps.map((step) => step.recipeId).sort();
}

describe('"we already make this" prices', () => {
  it('prices a stopped item at what making it alone costs', async () => {
    const leaf = await lineLeafOf(s);
    // Half an ingot, and an ingot is 1 iron dust + 1 coal dust = 2 (the ash is thrown away); its floor (half an ingot of
    // Steel at 1) is 0.5.
    expect(leaf(ROD)).toMatchObject({ buyable: true, leafClass: 'stop' });
    expectNear(leaf(ROD).cost, 1, 1e-9);
    // The floor, 3 × 0.5, beats the chain's 1, which uses no steel price.
    expectNear((await lineLeafOf({ ...s, costOverrides: { Steel: 3 } }))(ROD).cost, 1.5, 1e-9);
    // A key override wins.
    expect((await lineLeafOf({ ...s, costOverrides: { [ROD]: 0.25 } }))(ROD).cost).toBe(0.25);
    // Nothing at LV runs the lathe: its plain price.
    expect(leaf(FANCY).cost).toBe(0.5);
    // The plan buys the rod at that price.
    const rod = (await planLine(pack, s, emptyContext())).rawInputs.find((r) => r.key === ROD);
    expectNear(rod === undefined ? undefined : rod.cost / rod.perSecond, 1, 1e-6);
  });

  it('prices a stopped part of a machine as the line does', async () => {
    const p = await itemPrices(pack, s, emptyContext(), [ROD, FANCY]);
    // Its own chain, walked from the rod alone: machine prices have no target.
    expectNear(p.cost(ROD), 1, 1e-9);
    expect(p.cost(FANCY)).toBe(0.5);
    // Another memo entry: pricingSettings keeps costOverrides.
    const overridden = await itemPrices(pack, { ...s, costOverrides: { [ROD]: 0.25 } }, emptyContext(), [ROD, FANCY]);
    expect(overridden.cost(ROD)).toBe(0.25);
  });

  it('shows a stopped option of a slot at what the line buys it for', async () => {
    // The tube takes either rod in one slot. The stopped Steel Rod costs its key override, not the cost model's price of
    // extruding it (1): the step panel shows each option at what the line pays for it, so pinning one costs what it shows.
    const spec = rodSpec();
    const tube = spec.recipes?.find((r) => r.id === 'tube');
    if (tube === undefined) throw new Error('rodSpec changed: no tube');
    tube.in = [{ any: [[ROD, 1], [FANCY, 1]] }, ['t:steel_casing@0', 1]];
    const either = packFromSpec(spec);
    const options = async (x: PlanSettings) => (await planLine(either, x, emptyContext())).steps.find((st) => st.recipeId === 'tube')?.options;
    // At 0.25 the line buys the rod, and it shows so.
    expect(await options({ ...s, costOverrides: { [ROD]: 0.25 } })).toMatchObject([{ slot: 0, choices: [
      { key: ROD, rawPerRun: 0.25, steps: 0, share: 1 }, { key: FANCY, rawPerRun: 0.5, steps: 0, share: 0 }] }]);
    // At 3 it takes the Fancy Steel Rod, and the Steel Rod shows 3, what a pin on it costs.
    expect(await options({ ...s, costOverrides: { [ROD]: 3 } })).toMatchObject([{ slot: 0, choices: [
      { key: FANCY, rawPerRun: 0.5, steps: 0, share: 1 }, { key: ROD, rawPerRun: 3, steps: 0, share: 0 }] }]);
    const pinned = (await planLine(either, { ...s, costOverrides: { [ROD]: 3 }, optionChoice: { 'tube#0': ROD } }, emptyContext())).rawInputs
      .find((r) => r.key === ROD);
    expectNear(pinned === undefined ? undefined : pinned.cost / pinned.perSecond, 3, 1e-6);
  });

  it('never smelts a stopped part back into its own metal', async () => {
    // Per tube the alloy route takes half an ingot, 1 raw, beside the rod; with honest prices alone, recycling a second
    // rod into that half ingot would cost the same 1, a tie that fewer recipes break.
    expect(await stepRecipes(s)).toEqual(['alloy-steel', 'extrude-casing', 'tube']);
    // At 0.25 a rod recycling would pay: the recycling rule bars the smelt.
    const cheap: PlanSettings = { ...s, costOverrides: { [ROD]: 0.25 } };
    expect(await stepRecipes(cheap)).toEqual(['alloy-steel', 'extrude-casing', 'tube']);
    // The rule off (the fixture holds the loophole): 0.25 for the tube's rod and 0.25 for the rod recycled into its half
    // ingot, against 0.25 + 1 by the alloy smelter.
    expect(await stepRecipes({ ...cheap, excludedCategories: [] }))
      .toEqual(['extrude-casing', 'long-mag', 'polarize-rod', 'smelt-mag-long', 'tube']);
  });
});
