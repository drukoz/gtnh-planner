// What a plan costs in words (plan 12 Task 7, architecture §11.39): the plan banner's line of raw material to run and to
// build, counted over the build horizon (or ignored, or the batch in Make N), and the Materials page's build total with
// the layout's power and logistics parts. Pure functions; `.tsx` because the client project collects only those.

import { describe, it, expect } from 'vitest';
import { buildTotalLine, costLine, horizonText } from '../../src/client/views/plan-cost.ts';
import type { Plan } from '../../src/shared/types/plan.ts';

const planOf = (cost?: Plan['cost']): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 1, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 1, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok',
  ...(cost === undefined ? {} : { cost }),
});

describe('the plan cost line', () => {
  it('names the horizon in hours, a week as a week', () => {
    expect([1, 8, 24, 168, 48, 0.5, 8760].map(horizonText)).toEqual(['1 h', '8 h', '24 h', '1 week', '48 h', '0.5 h', '8,760 h']);
  });

  it('says what the plan uses to run and to build, and what the build cost is counted over', () => {
    expect(costLine(planOf({ runPerHour: 5400, build: 182, horizonHours: 24 })))
      .toBe('5,400 raw per hour to run + 182 raw to build new machines, counted over 24 h');
    expect(costLine(planOf({ runPerHour: 5400, build: 182, horizonHours: 168 }))).toMatch(/counted over 1 week$/);
    expect(costLine(planOf({ runPerHour: 3, build: 50, horizonHours: null })))
      .toBe('3 raw per hour to run + 50 raw to build new machines (build cost not counted)');
    expect(costLine(planOf({ runPerHour: 1, build: 50, horizonHours: null, batch: 192 }))).toBe('192 raw for the batch + 50 raw to build new machines');
    expect(costLine(planOf({ runPerHour: 4500, build: 48, horizonHours: 24, unpriced: 4 })))
      .toBe('4,500 raw per hour to run + 48 raw to build new machines (4 more not counted), counted over 24 h');
    expect(costLine(planOf())).toBeNull();
  });

  it('marks the machines it cannot price in every form', () => {
    expect(costLine(planOf({ runPerHour: 3, build: 50, horizonHours: null, unpriced: 1 })))
      .toBe('3 raw per hour to run + 50 raw to build new machines (1 more not counted) (build cost not counted)');
    expect(costLine(planOf({ runPerHour: 1, build: 50, horizonHours: null, batch: 192, unpriced: 2 })))
      .toBe('192 raw for the batch + 50 raw to build new machines (2 more not counted)');
  });
});

describe('the build total', () => {
  it('adds the layout parts to the machines and says what is not counted', () => {
    const base = { runPerHour: 1, horizonHours: 24 };
    expect(buildTotalLine(planOf({ ...base, build: 182 }))).toBe('About 182 raw to build the machines');
    expect(buildTotalLine(planOf({ ...base, build: 182, layout: 40 }))).toBe('About 222 raw to build: 182 for the machines, 40 for power and logistics parts');
    expect(buildTotalLine(planOf({ ...base, build: 0 }))).toBe('Nothing new to build');
    expect(buildTotalLine(planOf({ ...base, build: 48, unpriced: 4 }))).toBe('About 48 raw to build the machines (4 more not counted)');
    expect(buildTotalLine(planOf({ ...base, build: 0, unpriced: 2 }))).toBe('About 0 raw to build the machines (2 more not counted)');
    expect(buildTotalLine(planOf({ ...base, build: 48, layout: 1000, unpriced: 4 })))
      .toBe('About 1,048 raw to build: 48 for the machines (4 more not counted), 1,000 for power and logistics parts');
    expect(buildTotalLine(planOf())).toBeNull();
  });
});
