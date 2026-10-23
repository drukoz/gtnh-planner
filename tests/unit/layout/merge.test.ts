import { describe, it, expect } from 'vitest';
import { mergeLayoutIntoPlan, mergeBuildSteps, mergeBom } from '../../../src/server/layout/merge.ts';
import { makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { BomLine, BuildStep, PlanStep } from '../../../src/shared/types/plan.ts';

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

  it('keeps make steps before the layout steps', () => {
    // Architecture §11 entry 41 (5): the build parts' make steps come with the gather and craft steps, before the layout's.
    const plan: BuildStep[] = [{ id: 'gather', order: 1, text: 'Gather', kind: 'gather' }, { id: 'make:t:x@0', order: 2, text: 'Make X', kind: 'make' },
      { id: 'craft:t:y@0', order: 3, text: 'Craft Y', kind: 'craft' }, { id: 'test', order: 4, text: 'Run', kind: 'test' }];
    expect(mergeBuildSteps(plan, [{ id: 'layout:site', order: 1, text: 'Clear', kind: 'place', pin: 1 }]).map((s) => [s.order, s.id])).toEqual([
      [1, 'gather'], [2, 'make:t:x@0'], [3, 'craft:t:y@0'], [4, 'layout:site'], [5, 'test']]);
  });

  it('carries the layout parts into the plan cost', () => {
    // plan 12 Task 6: the layout's parts other than its hatches, priced by the layout service, beside the machines' build
    const plan = { ...makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }]), cost: { runPerHour: 1, build: 10, horizonHours: 24 } };
    expect(mergeLayoutIntoPlan(plan, layout(), null, (k) => k, 7).cost).toEqual({ runPerHour: 1, build: 10, horizonHours: 24, layout: 7 });
    expect(mergeLayoutIntoPlan(plan, layout(), null, (k) => k).cost).toEqual({ runPerHour: 1, build: 10, horizonHours: 24 });
    const costless = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }]);
    expect(mergeLayoutIntoPlan(costless, layout(), null, (k) => k, 7).cost).toBeUndefined();
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

  it('takes the whole build from an expansion with part steps', () => {
    // Architecture §11 entry 41 (9): `finishPlan` breaks the plan's top-level lines and the layout's required parts down in
    // one call and passes their part steps, so the expansion is the whole build and nothing of the plan's is added again.
    const steps = (list: ReadonlyArray<readonly [string, BuildStep['kind'], string?]>): BuildStep[] =>
      list.map(([id, kind, text], i) => ({ id, order: i + 1, text: text ?? id, kind }));
    const plan = { ...makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }]), names: { 't:a@0': 'Part A' },
      buildList: [{ key: 't:a@0', amount: 2, why: '2× Part A', group: 'machines' as const, children: [{ key: 't:iron@0', amount: 4, why: 'for Part A' }] }],
      buildTotals: [{ key: 't:iron@0', amount: 4, why: 'for Part A', neededFor: [{ key: 't:a@0', amount: 4 }] }],
      buildSteps: steps([['gather', 'gather'], ['craft:t:a@0', 'craft'], ['place', 'place'], ['power', 'power'], ['logistics:direct', 'logistics'],
        ['configure:s1', 'configure'], ['test', 'test']]) };
    const wiring = { key: 't:c@0', amount: 2, why: 'line wiring', group: 'power' as const };
    const suggestion = { key: 'gregtech:gt.blockmachines@114', amount: 6, why: 'optional: covers a 34 EU/t power shortfall', group: 'power' as const };
    // A′ and C as the breakdown gives them: each made one way, C's chain three levels deep
    const lines: BomLine[] = [
      { key: 't:a@0', amount: 2, why: '2× Part A', group: 'machines', made: { recipeId: 'make-a', mapId: 'crafting', machine: 'crafting table', runs: 2 },
        children: [{ key: 't:iron@0', amount: 4, why: 'for Part A' }] },
      { ...wiring, made: { recipeId: 'make-c', mapId: 'gt.recipe.assembler', machine: { mteId: 2002, name: 'Advanced Assembler', tier: 2, source: 'new' }, runs: 2 },
        children: [{ key: 't:d@0', amount: 2, why: 'for C', made: { recipeId: 'make-d', mapId: 'crafting', machine: 'crafting table', runs: 1 },
          children: [{ key: 't:e@0', amount: 4, why: 'for D', made: { recipeId: 'make-e', mapId: 'crafting', machine: 'crafting table', runs: 4 },
            children: [{ key: 't:iron@0', amount: 8, why: 'for E' }] }] }] },
    ];
    const totals: BomLine[] = [{ key: 't:iron@0', amount: 12, why: 'for Part A, C', neededFor: [{ key: 't:a@0', amount: 4 }, { key: 't:c@0', amount: 8 }] }];
    const alt: PlanStep['alternatives'][number] = { recipeId: 'make-c', rawCost: 4, mapId: 'gt.recipe.assembler',
      inputs: [{ key: 't:d@0', amount: 1, options: [{ key: 't:d@0', amount: 1 }, { key: 't:g@0', amount: 2 }] }], outputs: [{ key: 't:c@0', amount: 1 }] };
    const parts = steps([['gather', 'gather', 'Gather the base materials: 12× t:iron'], ['make:t:c@0', 'make', 'Make 2× C'], ['craft:t:a@0', 'craft', 'Craft 2× Part A']]);
    // the whole build's top-level lines are already less what the hatches replace: nothing is taken off A′ a second time
    const placed = layout({ buildSteps: [{ id: 'layout:site', order: 1, text: 'Clear', kind: 'place', pin: 1 }], bom: [wiring, suggestion],
      replaced: [{ key: 't:a@0', amount: 1, why: 'replaced by hatches', group: 'machines' }] });
    const merged = mergeLayoutIntoPlan(plan, placed, { lines, totals, alternatives: { 't:c@0': [alt] }, parts }, (k) => `name of ${k}`);
    // A′ and C by key as mergeBom sorts them, then the suggestion; the plan's own A and the layout's own C are not merged again
    expect(merged.buildList).toEqual([...lines, suggestion]);
    // the pooled totals: the plan's own 4 iron are among them, not added again
    expect(merged.buildTotals).toEqual(totals);
    expect(merged.buildAlternatives).toEqual({ 't:c@0': [alt] });
    // the part steps in place of the plan's gather and craft steps, the layout's steps in place of its place, power and logistics
    expect(merged.buildSteps.map((s) => [s.order, s.id, s.text])).toEqual([
      [1, 'gather', 'Gather the base materials: 12× t:iron'], [2, 'make:t:c@0', 'Make 2× C'], [3, 'craft:t:a@0', 'Craft 2× Part A'],
      [4, 'layout:site', 'Clear'], [5, 'configure:s1', 'configure:s1'], [6, 'test', 'test']]);
    // every new key named, at any depth, and the swap list's goods and map; the plan's own names are kept
    expect(merged.names).toEqual({ 't:a@0': 'Part A', ...Object.fromEntries(['t:c@0', 't:d@0', 't:e@0', 't:iron@0', 'gregtech:gt.blockmachines@114', 't:g@0',
      'map:gt.recipe.assembler'].map((k) => [k, `name of ${k}`])) });
  });

  it('keeps how each merged build line is made', () => {
    // Architecture §11 entry 41 (1)–(2): every node of a good the breakdown makes says how, and every node it cannot make
    // why; a merged line keeps that from the first line that says (never both), as it keeps the first children.
    const made: BomLine['made'] = { recipeId: 'cable', mapId: 'crafting', machine: 'crafting table', runs: 1 };
    const children = [{ key: 't:tin@0', amount: 1, why: 'for Cable' }];
    const a: BomLine[] = [{ key: 't:cable@0', amount: 0, why: 'a' }, { key: 't:ebf@0', amount: 1, why: 'ebf', unmade: 'no-recipe' }];
    const b: BomLine[] = [{ key: 't:cable@0', amount: 2, why: 'b', made, children }, { key: 't:ebf@0', amount: 1, why: 'ebf', made }];
    expect(mergeBom(a, b)).toEqual([
      { key: 't:cable@0', amount: 2, why: 'a; b', made, children },
      { key: 't:ebf@0', amount: 2, why: 'ebf', unmade: 'no-recipe' }]);
  });
});
