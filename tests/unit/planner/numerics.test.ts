// Numerics (fix spec D1–D3): the solver works at unit demand, so a line planned at 1e-6 per hour is the line at 1 and 30
// per hour, only slower; every per-second value keeps 9 significant digits; every good balances; and the residual check
// finds the rows a stage does not balance. On 46067df the 1e-6-per-hour plan came back `ok` with no steps at all.

import { beforeAll, describe, expect, it } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { firstBalanced, residualViolations } from '../../../src/server/planner/solve.ts';
import type { LpRow } from '../../../src/server/planner/lp.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const TARGET = 't:circuit@0';
/** Circuits per hour. */
const AMOUNTS = [30, 1, 1e-6] as const;
const settingsFor = (amount: number): PlanSettings => ({ ...defaultSettings(), target: TARGET, tier: 2, per: 'hour', amount });

const plans = new Map<number, Plan>();
beforeAll(async () => {
  for (const amount of AMOUNTS) plans.set(amount, await planLine(pack, settingsFor(amount), emptyContext()));
});
const planAt = (amount: number): Plan => plans.get(amount) as Plan;

describe('numerics', () => {
  it('plans 1e-6 per hour like 1 and 30 per hour', () => {
    for (const amount of AMOUNTS) {
      const p = planAt(amount);
      expect(p.status, `${amount}/h`).toBe('ok');
      expect(p.steps.map((s) => s.id), `${amount}/h`).toEqual(['circuit-mv', 'extract-iron', 'wire']);
      expect(p.flows, `${amount}/h`).toHaveLength(6);
      expect(p.flows.filter((f) => f.to === 'out'), `${amount}/h`).toHaveLength(1);
    }
    const tiny = planAt(1e-6);
    const one = planAt(1);
    tiny.steps.forEach((step, i) => {
      const expected = (one.steps[i]?.runsPerSecond ?? NaN) * 1e-6;
      expect(Math.abs(step.runsPerSecond - expected), step.id).toBeLessThanOrEqual(1e-9 * expected);
    });
  });

  it('keeps 9 significant digits everywhere', () => {
    for (const amount of AMOUNTS) {
      const p = planAt(amount);
      const values = [
        ...p.steps.map((s) => s.runsPerSecond), ...p.flows.map((f) => f.perSecond),
        ...p.rawInputs.flatMap((r) => [r.perSecond, r.cost]), ...p.byproducts.map((b) => b.amount),
      ];
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(Number(v.toPrecision(9)), `${amount}/h: ${v}`).toBe(v);
    }
  });

  it('closes the balance of every good', () => {
    // Within the rounding of its terms: each keeps 9 significant digits (rounded at unit demand and again when scaled
    // back), so each can be 1e-8 of itself off — at 30/h the molten iron is 144 × 0.00416666667 L made against
    // 72 × 0.00833333333 L taken, 1.2e-9 of either apart. A good from tolerance was 1e-2 off (fix spec §2).
    for (const amount of AMOUNTS) {
      const p = planAt(amount);
      const terms = new Map<string, { made: number; bought: number; taken: number; sunk: number; demand: number }>();
      const of = (key: string) => {
        let t = terms.get(key);
        if (t === undefined) terms.set(key, (t = { made: 0, bought: 0, taken: 0, sunk: 0, demand: 0 }));
        return t;
      };
      for (const s of p.steps) {
        for (const o of s.outputs) of(o.key).made += o.amount * s.runsPerSecond;
        for (const i of s.inputs) of(i.key).taken += i.amount * s.runsPerSecond;
      }
      for (const r of p.rawInputs) of(r.key).bought += r.perSecond;
      for (const b of p.byproducts) of(b.key).sunk += b.amount;
      of(TARGET).demand += amount / 3600;
      for (const [key, t] of terms) {
        const magnitude = t.made + t.bought + t.taken + t.sunk + t.demand;
        expect(magnitude, key).toBeGreaterThan(0);
        expect(Math.abs(t.made + t.bought - t.taken - t.sunk - t.demand), `${amount}/h: ${key}`).toBeLessThanOrEqual(1e-8 * magnitude);
      }
    }
  });

  it('finds rows a stage does not balance', () => {
    const rows: LpRow[] = [{ lower: 1, upper: 1, entries: [[0, 1]] }];
    const off = residualViolations(rows, [1.001]);
    expect(off).toHaveLength(1);
    expect(off[0]?.row).toBe(0);
    expect(off[0]?.residual).toBeCloseTo(0.001, 12);
    expect(residualViolations(rows, [1 + 1e-12])).toEqual([]);
    expect(firstBalanced([{ name: 'S4', x: [1.001] }, { name: 'S2', x: [1] }], rows)?.name).toBe('S2');
    expect(firstBalanced([{ name: 'S4', x: [1.001] }, { name: 'S2', x: [0.99] }], rows)).toBeNull();
  });
});
