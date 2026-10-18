// Real-data smoke check (architecture §10): plans a line on the active export of this host. It runs only with
// GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise.

import { describe, it, expect } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the active export', () => {
  it('plans 60 Electronic Circuits per hour at MV', async () => {
    const pack = await loadPack(activeExportDir(loadConfig()));
    const circuit = [...pack.items.values()].find((item) => item.name === 'Electronic Circuit');
    expect(circuit, 'an item named Electronic Circuit').toBeDefined();

    const started = performance.now();
    const plan = await planLine(pack, { ...defaultSettings(), target: circuit!.key, amount: 60, per: 'hour', tier: 2 }, emptyContext());
    const seconds = (performance.now() - started) / 1000;

    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.rawInputs.filter((r) => !r.available)).toEqual([]);
    expect(plan.warnings.filter((w) => w.code === 'free-loop')).toEqual([]);
    expect(seconds).toBeLessThan(5);
  }, 300_000);
});
