// Real-data regression (GTNH_LOCAL=1, fix spec §7.2 and complaint 1): a line planned per hour is the same line as per
// minute, only slower, and every good a step takes is made by a step or bought. On cd6fcce the hourly Electronic Circuit
// took Polyvinyl Acetate and Methyl Acetate Cells from nowhere (HiGHS's absolute tolerances at 1e-8..1e-4 per second).
// Skipped everywhere else; nothing game-derived is read or written otherwise. Plan 12 (Task 8): with build cost counted
// (the default) the objective weighs machines against the rate, so the same line per hour and per minute is checked on
// the settings with build cost ignored, plan 09's scale-free objective; the build-cost plans' differences are logged.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const EC = 'IC2:itemPartCircuit@0';

/** Goods some step takes that no step makes and the line does not buy. */
function orphans(plan: Plan): string[] {
  const made = new Set(plan.steps.flatMap((s) => s.outputs.map((o) => o.key)));
  const bought = new Set(plan.rawInputs.map((r) => r.key));
  return [...new Set(plan.steps.flatMap((s) => s.inputs.map((i) => i.key)))].filter((k) => !made.has(k) && !bought.has(k)).sort();
}

/** Largest |made + bought − taken − thrown away − delivered| / taken over the goods steps take. */
function worstImbalance(plan: Plan, target: string, perSecond: number): number {
  const sum = new Map<string, number>();
  const used = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number): void => {
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const s of plan.steps) {
    for (const o of s.outputs) add(sum, o.key, o.amount * s.runsPerSecond);
    for (const i of s.inputs) {
      add(sum, i.key, -i.amount * s.runsPerSecond);
      add(used, i.key, i.amount * s.runsPerSecond);
    }
  }
  for (const r of plan.rawInputs) add(sum, r.key, r.perSecond);
  for (const b of plan.byproducts) add(sum, b.key, -b.amount);
  add(sum, target, -perSecond);
  let worst = 0;
  for (const [k, u] of used) worst = Math.max(worst, Math.abs(sum.get(k) ?? 0) / u);
  return worst;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('rates on the real 2.9 export', () => {
  let pack: Pack;
  const plan = (s: Partial<PlanSettings>): Promise<Plan> => planLine(pack, { ...defaultSettings(), ...s }, emptyContext());
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 120_000);

  it('plans 1 Electronic Circuit an hour at MV with every input made or bought, balanced, as at 1 a minute', async () => {
    const hourly = await plan({ target: EC, amount: 1, per: 'hour', tier: 2 });
    const perMinute = await plan({ target: EC, amount: 1, per: 'min', tier: 2 });
    expect(hourly.status).toBe('ok');
    expect(orphans(hourly)).toEqual([]);
    expect(worstImbalance(hourly, EC, 1 / 3600)).toBeLessThan(1e-6);
    const ids = (p: Plan): string[] => p.steps.map((s) => s.recipeId);
    const hourIgnoring = await plan({ target: EC, amount: 1, per: 'hour', tier: 2, buildHorizonHours: null });
    const minuteIgnoring = await plan({ target: EC, amount: 1, per: 'min', tier: 2, buildHorizonHours: null });
    expect(ids(hourIgnoring)).toEqual(ids(minuteIgnoring));
    console.log(`real-rate: with build cost per hour ${hourly.steps.length} steps, per minute ${perMinute.steps.length}; `
      + `per hour only ${ids(hourly).filter((id) => !ids(perMinute).includes(id)).join(' ') || 'none'}, `
      + `per minute only ${ids(perMinute).filter((id) => !ids(hourly).includes(id)).join(' ') || 'none'}`);
    // Molten polyethylene and copper plates each come from one recipe at most (they came from two: a bought PE bar beside the
    // chemical reactor, a cutting saw beside the fluid solidifier).
    const makers = (key: string): string[] => hourly.steps.filter((s) => s.outputs.some((o) => o.key === key)).map((s) => s.recipeId);
    expect(makers('fluid:molten.plastic').length).toBeLessThanOrEqual(1);
    expect(makers('gregtech:gt.metaitem.01@17035').length).toBeLessThanOrEqual(1);
  }, 120_000);
});
