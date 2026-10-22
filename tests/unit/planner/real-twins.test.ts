// Real-data check of twin step recipes (controller ruling 197 (1), plan 12): two recipes on one machine that differ
// only in an equally priced form of one input, of which the plan keeps (a) the one whose good the line also makes, else
// (b) the one whose good the line already buys for another step, else (c) the ingot's before the dust's, else (d) the
// one of the lowest id. It runs only with GTNH_LOCAL=1 on the active export and logs only keys and counts; nothing
// game-derived is read or written otherwise.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const COPPER_DUST = 'gregtech:gt.metaitem.01@2035';
/** The Alloy Smelter's Red Alloy from a Copper Ingot and from Copper Dust (with Redstone): twins of 1 raw each. */
const RED_ALLOY_FROM_INGOT = '85eaebd6c5132556';
const RED_ALLOY_FROM_DUST = '46403d12a101370b';

describe.skipIf(process.env.GTNH_LOCAL !== '1')('twin recipes on the active export', () => {
  let pack: Pack;
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  it('melts Red Alloy from the Copper Ingot an AE2 Electronic Circuit line at LV already buys', async () => {
    // Electronic Circuit 1 a minute at LV on AE2 at the default 50 % (Fewest machines): the line buys Copper Ingots for
    // its plates and annealed copper, so its Red Alloy takes one too (rule b), never Copper Dust, whose twin has the lower
    // id (the rule before: lowest id only, which bought Copper Dust for it alone).
    const plan = await planLine(pack, { ...defaultSettings(), target: ELECTRONIC_CIRCUIT, tier: 1, amount: 1, per: 'min', logistics: 'ae2' }, emptyContext());
    const twins = plan.steps.filter((s) => s.recipeId === RED_ALLOY_FROM_INGOT || s.recipeId === RED_ALLOY_FROM_DUST).map((s) => s.recipeId);
    console.log(`real-twins EC LV 1/min AE2: ${plan.status}, ${plan.steps.length} steps, Red Alloy twins ${twins.join(', ') || 'none'}, `
      + `raw ${plan.rawInputs.map((r) => r.key).join(', ')}`);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(twins).toEqual([RED_ALLOY_FROM_INGOT]);
    expect(plan.rawInputs.map((r) => r.key)).not.toContain(COPPER_DUST);
  }, 120_000);
});
