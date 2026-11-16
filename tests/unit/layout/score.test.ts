// RUK-2614: what the wiring leaves each electric machine (the per-machine power report RUK-351 asks for), the score a
// laid line gets, and the rule that keeps a search candidate from replacing today's line by getting longer or lossier.
import { describe, it, expect } from 'vitest';
import type { LineScore } from '../../../src/shared/types/layout.ts';
import type { BlockRef } from '../../../src/shared/types/pack.ts';
import type { PlanWarning } from '../../../src/shared/types/plan.ts';
import { compareScore, replacesBaseline, scoreLine } from '../../../src/server/layout/score.ts';
import type { LocalBlock } from '../../../src/server/layout/arrange.ts';
import type { MachinePower } from '../../../src/server/layout/internal.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const BLOCK: BlockRef = { id: 'gregtech:gt.blockmachines', meta: 0 };

const block = (role: LocalBlock['role']): LocalBlock => ({ pos: [0, 0, 0], block: BLOCK, role, label: role });

const machine = (powered: boolean): MachinePower => ({
  stepId: 's1', name: 'Basic Macerator', tier: 1, feedTier: 1, euPerTick: 30, arrivingVolts: powered ? 30 : 5,
  maxAmps: 2, wired: true, powered,
});

const score = (over: Partial<LineScore> = {}): LineScore => ({
  unwired: 0, handTransformers: 0, unpowered: 0, total: 20, lossEUt: 100, volume: 60, ...over,
});

describe('per-machine power report', () => {
  it('reports every LV macerator of the 10-machine direct loss line as powered', async () => {
    const { internal } = await lossLine(10, 'direct');
    expect(internal.machines, 'one entry per electric unit').toHaveLength(10);
    for (const m of internal.machines) {
      expect(m.wired, `${m.name}: wired`).toBe(true);
      expect(m.powered, `${m.name}: powered`).toBe(true);
      expect(m.maxAmps, `${m.name}: max amps (floor(2·30 ÷ 32) + 1)`).toBe(2);
      expect(m.feedTier, `${m.name}: fed at LV`).toBe(1);
    }
  }, 30_000);

  it("reports the far macerators of the 40-machine AE2 loss line as unpowered", async () => {
    const { layout, internal } = await lossLine(40, 'ae2');
    const dark = internal.machines.filter((m) => !m.powered);
    expect(dark.length, 'at least one unpowered macerator').toBeGreaterThan(0);
    expect(Math.min(...dark.map((m) => m.arrivingVolts)), 'the farthest gets under the 15 V it needs').toBeLessThan(15);
    expect(layout.loss?.unpowered, 'the layout counts them').toBe(dark.length);
  }, 30_000);

  it('leaves loss.unpowered out when every machine runs', async () => {
    const { layout } = await lossLine(10, 'direct');
    expect('unpowered' in (layout.loss ?? {}), 'no unpowered machine to count').toBe(false);
  }, 30_000);
});

describe('line score', () => {
  it('scores blocks, warnings and machines', () => {
    const warnings: PlanWarning[] = [{ code: 'route_failed', text: 'no path' }, { code: 'cable_loss_high', text: 'lossy' }];
    const got = scoreLine({
      blocks: [block('cable'), block('cable'), block('pipe'), block('machine')],
      warnings, machines: [machine(true), machine(false)],
      handTransformers: 0, lossEUt: 42, size: [2, 3, 4],
    });
    expect(got).toEqual({ unwired: 1, handTransformers: 0, unpowered: 1, total: 3, lossEUt: 42, volume: 24 });
  });

  it('compares scores field by field', () => {
    expect(compareScore(score({ unwired: 0, total: 30 }), score({ unwired: 1, total: 20 })), 'fewer unwired wins over length')
      .toBeLessThan(0);
    expect(compareScore(score({ total: 20, lossEUt: 80 }), score({ total: 20, lossEUt: 100 })), 'equal up to total, the lower loss wins')
      .toBeLessThan(0);
    expect(compareScore(score(), score()), 'all equal').toBe(0);
  });

  it('replaces the baseline only to power a machine or when no longer and no lossier', () => {
    const base = score();
    expect(replacesBaseline(score({ total: 18, lossEUt: 90 }), base), 'shorter and less lossy').toBe(true);
    expect(replacesBaseline(score({ total: 18, lossEUt: 120 }), base), 'shorter but lossier, same unpowered').toBe(false);
    expect(replacesBaseline(score({ total: 24, unpowered: base.unpowered - 1 }), base), 'longer but one fewer unpowered').toBe(true);
    expect(replacesBaseline(score({ total: 18, lossEUt: 90, unwired: 1 }), base), 'better score but one more unwired').toBe(false);
  });
});
