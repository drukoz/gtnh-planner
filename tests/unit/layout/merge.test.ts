import { describe, it, expect } from 'vitest';
import { mergeLayoutIntoPlan, mergeBuildSteps, mergeBom } from '../../../src/server/layout/merge.ts';
import { makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';

const layout = (over: Partial<Layout> = {}): Layout => ({ dim: 0, origin: [0, 64, 0], size: [4, 1, 5], rotation: 0, mode: 'direct', blocks: [], hookups: [], pins: [],
  buildSteps: [{ id: 'layout:site', order: 1, text: 'Clear', kind: 'place', pin: 1 }, { id: 'layout:test', order: 2, text: 'Check', kind: 'test', pin: 1 }],
  bom: [{ key: 'gregtech:gt.blockmachines@1247', amount: 3, why: 'line wiring', group: 'power' },
    { key: 'gregtech:gt.blockmachines@114', amount: 6, why: 'optional: covers a 34 EU/t power shortfall', group: 'power' }],
  warnings: [{ code: 'no_path', text: 'x' }], status: 'ok',
  power: { peakEUt: 60, averageEUt: 50, voltageTier: 1, amps: 2, fits: 'no', detail: 'd', suggestions: ['s'] }, ...over });

describe('mergeLayoutIntoPlan', () => {
  it('takes the power fit, adds line parts and puts the layout steps where the generic ones were', () => {
    const plan = { ...makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }]),
      buildList: [{ key: 'gregtech:gt.blockmachines@2001', amount: 2, why: '2× Basic Macerator', group: 'machines' as const }] };
    const merged = mergeLayoutIntoPlan(plan, layout(), {
      lines: [{ key: 'gregtech:gt.blockmachines@1247', amount: 3, why: 'line wiring', group: 'power', children: [{ key: 't:tin@0', amount: 3, why: 'for 2x Tin Cable' }] }],
      totals: [{ key: 't:tin@0', amount: 3, why: '' }] }, (k) => `name of ${k}`);
    expect(merged.power.fits).toBe('no');
    expect(merged.buildSteps.map((s) => [s.order, s.id])).toEqual([[1, 'gather'], [2, 'layout:site'], [3, 'layout:test'], [4, 'test']]);
    expect(merged.buildList.map((l) => [l.key, l.amount, l.group])).toEqual([
      ['gregtech:gt.blockmachines@1247', 3, 'power'], ['gregtech:gt.blockmachines@2001', 2, 'machines'], ['gregtech:gt.blockmachines@114', 6, 'power']]);
    expect(merged.buildTotals).toEqual([{ key: 't:tin@0', amount: 3, why: '' }]);
    expect(merged.warnings).toContainEqual({ code: 'no_path', text: 'x' });
    expect(merged.names!['gregtech:gt.blockmachines@1247']).toBe('name of gregtech:gt.blockmachines@1247');
  });

  it('leaves plans with nothing to build alone, and keeps plan steps when the layout has none', () => {
    const empty = makePlan([], { status: 'empty' });
    expect(mergeLayoutIntoPlan(empty, layout(), null, (k) => k)).toBe(empty);
    const steps = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }]).buildSteps;
    expect(mergeBuildSteps(steps, [])).toEqual(steps);
  });

  it('keeps each line group when merging, taking the first one set', () => {
    expect(mergeBom([{ key: 'k', amount: 1, why: 'a' }, { key: 'm', amount: 1, why: 'm', group: 'machines' }],
      [{ key: 'k', amount: 2, why: 'b', group: 'logistics' }, { key: 'm', amount: 1, why: 'n', group: 'power' }])).toEqual([
      { key: 'k', amount: 3, why: 'a; b', group: 'logistics' }, { key: 'm', amount: 2, why: 'm; n', group: 'machines' }]);
  });

  it('keeps what each build line needs of a total, summed per line in the order first seen (architecture §11.36)', () => {
    const merged = mergeBom(
      [{ key: 't:tin@0', amount: 6, why: 'for Basic Macerator, Basic Assembler', neededFor: [{ key: 'gregtech:gt.blockmachines@2001', amount: 4 }, { key: 'gregtech:gt.blockmachines@2002', amount: 2 }] }],
      [{ key: 't:tin@0', amount: 5, why: 'for 2x Tin Cable, Basic Assembler', neededFor: [{ key: 'gregtech:gt.blockmachines@1247', amount: 3 }, { key: 'gregtech:gt.blockmachines@2002', amount: 2 }] }]);
    expect(merged).toEqual([{ key: 't:tin@0', amount: 11, why: 'for Basic Macerator, Basic Assembler; for 2x Tin Cable, Basic Assembler', neededFor: [
      { key: 'gregtech:gt.blockmachines@2001', amount: 4 }, { key: 'gregtech:gt.blockmachines@2002', amount: 4 }, { key: 'gregtech:gt.blockmachines@1247', amount: 3 }] }]);
    expect(merged[0]!.neededFor!.reduce((sum, n) => sum + n.amount, 0)).toBe(merged[0]!.amount);
    // a merged line without neededFor leaves it out: the rest would no longer add up to the amount
    expect(mergeBom([{ key: 'k', amount: 1, why: 'a', neededFor: [{ key: 'x', amount: 1 }] }], [{ key: 'k', amount: 2, why: 'b' }]))
      .toEqual([{ key: 'k', amount: 3, why: 'a; b' }]);
  });

  it('takes the casings that energy and maintenance hatches replace off an EBF build list', () => {
    const plan = { ...makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120 }]), buildList: [
      { key: 'gregtech:gt.blockcasings5@1', amount: 16, why: 'structure of 1× Electric Blast Furnace', group: 'machines' as const },
      { key: 'gregtech:gt.blockcasings@11', amount: 17, why: 'structure of 1× Electric Blast Furnace', group: 'machines' as const,
        children: [{ key: 't:steel@0', amount: 34, why: 'for Heat Proof Machine Casing' }] }] };
    const merged = mergeLayoutIntoPlan(plan, layout({ bom: [], replaced: [{ key: 'gregtech:gt.blockcasings@11', amount: 2, why: 'replaced by hatches', group: 'machines' }] }),
      null, (k) => k);
    expect(merged.buildList.map((l) => [l.key, l.amount])).toEqual([['gregtech:gt.blockcasings5@1', 16], ['gregtech:gt.blockcasings@11', 15]]);
    expect(merged.buildList[1]!.children).toEqual([{ key: 't:steel@0', amount: 30, why: 'for Heat Proof Machine Casing' }]);   // ceil(34 × 15 / 17)
  });
});
