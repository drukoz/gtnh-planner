// A Make N batch whose whole runs come out short (plan 09 follow-up): its batch-short warning says what to have ready,
// and the plan raises no short or orphan input for the goods that warning covers. Only `wholeRuns`' greedy fallback
// leaves a good short: its whole-runs program has an answer whenever the LP has one, and falls back only when it runs
// out of its 2 s, as on long real lines. So this file stands in a solver whose whole-runs program never finishes.

import { describe, expect, it, vi } from 'vitest';
import type { LpModel, LpResult } from '../../../src/server/planner/lp.ts';

vi.mock('../../../src/server/planner/lp.ts', async (importOriginal) => {
  const lp = await importOriginal<typeof import('../../../src/server/planner/lp.ts')>();
  // Only the whole-runs program has a time limit (make-n.ts); every other solve runs as it is.
  const unfinished: LpResult = { status: 'error', objective: NaN, x: [] };
  return { ...lp, solveLp: (model: LpModel) => (model.timeLimit !== undefined ? Promise.resolve(unfinished) : lp.solveLp(model)) };
});

import { packFromSpec } from '../../helpers/pack-spec.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';

const FULL = 't:cell_full@0';

/**
 * A widget run takes 2 full cells and hands 1 empty cell back, a canner fills an empty cell from raw dust, and a
 * centrifuge yields an empty cell 1 time in 10. The LP balances that in fractions; whole runs top the cells up through
 * the widget's assembler, which only digs the loop deeper, so the batch comes out short of full cells.
 */
const pack = packFromSpec({
  items: [
    { key: 't:widget@0', name: 'Widget' }, { key: FULL, name: 'Full Cell' }, { key: 't:cell@0', name: 'Empty Cell' },
    { key: 't:slag@0', name: 'Slag' }, { key: 't:raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } },
  ],
  maps: [{ id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'gt.recipe.canner', name: 'Canner' }, { id: 'gt.recipe.centrifuge', name: 'Centrifuge' }],
  machines: [
    { mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }, { mteId: 2, name: 'Basic Canner', maps: ['gt.recipe.canner'], tier: 1 },
    { mteId: 3, name: 'Basic Centrifuge', maps: ['gt.recipe.centrifuge'], tier: 1 },
  ],
  recipes: [
    { id: 'use', map: 'gt.recipe.assembler', in: [[FULL, 2]], out: [['t:widget@0', 2], ['t:cell@0', 1]], eut: 16 },
    { id: 'fill', map: 'gt.recipe.canner', in: [['t:cell@0', 1], ['t:raw@0', 1]], out: [[FULL, 1]], eut: 2 },
    { id: 'side', map: 'gt.recipe.centrifuge', in: [['t:raw@0', 1]], out: [['t:slag@0', 1], ['t:cell@0', 1, 0.1]], eut: 2 },
  ],
  worldgen: {
    veins: [{ name: 'ore.mix.raw', dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
      materials: { primary: 'Raw', secondary: 'Raw', between: 'Raw', sporadic: 'Raw' } }],
  },
});

describe('a Make N batch whose whole runs come out short', () => {
  it('leaves the goods it is short of to its batch-short warning', async () => {
    const plan = await planLine(pack, { ...defaultSettings(), target: 't:widget@0', mode: 'makeN', amount: 1, tier: 1 }, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => [s.id, s.runs])).toEqual([['fill', 2], ['side', 5], ['use', 2]]);
    expect(plan.warnings).toEqual([{
      code: 'batch-short', key: FULL, keys: [FULL],
      text: 'Whole crafts do not balance: have 2× Full Cell ready before you start (cells or catalysts the chain hands round), or the batch comes out short.',
    }]);
    // The widget's step gets only half the full cells it takes: without the warning that is a short input there.
    expect(indexPlan({ ...plan, warnings: [] }).issues.map((i) => [i.code, i.key, i.stepId])).toEqual([['short-input', FULL, 'use']]);
  });
});
