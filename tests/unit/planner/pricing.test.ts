import { describe, it, expect } from 'vitest';
import { miniGt } from '../../helpers/mini-gt.ts';
import { linePricing, lineLeaf } from '../../../src/server/planner/pricing.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';

const pack = miniGt();
const settings = { ...defaultSettings(), target: 't:circuit@0', tier: 1 };

describe('linePricing', () => {
  it('prices a line once per pack, settings and the context fields its basis reads', async () => {
    const first = linePricing(pack, settings, emptyContext());
    expect(first).not.toBeNull();
    // Equal settings and a context that differs only in what the basis never reads (storage) share one pricing.
    const storage = new Map([['t:iron_ingot@0', { total: 64, reachable: 64 }]]);
    expect(linePricing(pack, { ...settings }, { ...emptyContext(), storage })).toBe(first);
    const others = [
      linePricing(pack, { ...settings, amount: 2 }, emptyContext()), linePricing(pack, settings, { ...emptyContext(), visitedDims: ['moon'] }),
      linePricing(pack, settings, { ...emptyContext(), topTier: 2 }), linePricing(miniGt(), settings, emptyContext()),
    ];
    for (const other of others) expect(other).not.toBe(first);
    const all = await Promise.all([first, ...others]);
    expect(all.map((p) => p?.target)).toEqual(Array(5).fill('t:circuit@0'));
  });
  it('has nothing to price without a target the export knows, so breakdowns use the plain basis', async () => {
    expect(linePricing(pack, defaultSettings(), emptyContext())).toBeNull();
    expect(linePricing(pack, { ...settings, target: 't:not_exported@0' }, emptyContext())).toBeNull();
    const plain = await lineLeaf(pack, defaultSettings(), emptyContext());
    expect(plain.leaf('t:iron_ingot@0')).toEqual(planBasis(pack, defaultSettings(), emptyContext()).leaf('t:iron_ingot@0'));
    const priced = await lineLeaf(pack, settings, emptyContext());
    const line = await linePricing(pack, settings, emptyContext());
    expect(priced.leaf).toBe(line?.leaf);
    expect(priced.env).toBe(line?.basis.env);
  });
});
