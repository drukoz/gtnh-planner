import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildRows, groupBuildRows, runRows, sourceText, amountText, haveText, whereLines, unavoidableKeys, missingRows } from '../../src/client/views/materials-model.ts';
import { StepsView } from '../../src/client/views/StepsView.tsx';
import { MaterialsView, UsedByChips } from '../../src/client/views/MaterialsView.tsx';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import { getFlowFocus, setFlowFocus } from '../../src/client/state/flow-focus.ts';
import { indexPlan } from '../../src/shared/plan/balance.ts';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

afterEach(() => { setFlowFocus(null); vi.unstubAllGlobals(); });

const names = { 'machine:111@0': 'Basic Wiremill', 't:hull_lv@0': 'LV Machine Hull', 't:iron_ingot@0': 'Iron Ingot', 't:titanium_ingot@0': 'Titanium Ingot', 'dim:overworld': 'Overworld', 'dim:moon': 'Moon', 'dimId:0': 'Overworld' };
const plan = {
  status: 'ok', names,
  buildList: [{ key: 'machine:111@0', amount: 1, why: '1× Basic Wiremill', children: [{ key: 't:hull_lv@0', amount: 1, why: 'for Basic Wiremill' }] }],
  buildTotals: [{ key: 't:iron_ingot@0', amount: 10, why: 'base material' }],
  rawInputs: [
    { key: 't:iron_ingot@0', perSecond: 0.5, cost: 0.5, available: true, leafClass: 'direct', sources: [{ kind: 'vein', dims: ['overworld'], detail: 'ore.mix.iron', foundAt: [{ dim: 0, x: 1, z: 2 }] }], have: { total: 1440, reachable: 64 } },
    { key: 't:titanium_ingot@0', perSecond: 0.1, cost: 0.1, available: false, leafClass: 'unavailable', sources: [] }],
  unlocks: [{ key: 't:titanium_ingot@0', text: 'Titanium Ingot: needs Moon (T1 rocket) — reachable at HV' }],
  buildSteps: [{ id: 'gather', order: 1, text: 'Gather the base materials: 10× Iron Ingot', kind: 'gather' }, { id: 'test', order: 2, text: 'Run the line', kind: 'test' }],
  byproducts: [], steps: [], flows: [], warnings: [],
} as unknown as Plan;

describe('materials model', () => {
  it('formats amounts, have counts and sources', () => {
    expect([amountText(1440), amountText(0.125)]).toEqual(['1,440', '0.13']);
    expect(haveText({ total: 1440, reachable: 64 })).toBe('have 1,440 (64 reachable)');
    expect(sourceText({ kind: 'vein', dims: ['overworld', 'moon'], detail: 'ore.mix.iron', foundAt: [{ dim: 0, x: 1, z: 2 }] }, names)).toBe('vein ore.mix.iron · Overworld, Moon · found at 1 2 (Overworld)');
    const five = [[8, 24], [-40, 88], [100, 3], [5, 5], [6, 6]].map(([x, z]) => ({ dim: 0, x: x!, z: z! }));
    expect(sourceText({ kind: 'vein', dims: ['overworld'], detail: 'ore.mix.iron', foundAt: five }, names))
      .toBe('vein ore.mix.iron · Overworld · found at 8 24 (Overworld), -40 88 (Overworld), 100 3 (Overworld) +2 more');
  });
  it('flattens the build tree by expansion', () => {
    expect(buildRows(plan.buildList, names, new Set()).map((r) => [r.row, r.depth, r.hasChildren])).toEqual([['build:machine:111@0', 0, true]]);
    expect(buildRows(plan.buildList, names, new Set(['machine:111@0'])).map((r) => [r.name, r.depth])).toEqual([['Basic Wiremill', 0], ['LV Machine Hull', 1]]);
  });
  it('groups the build list by part kind', () => {
    const lines: Plan['buildList'] = [{ key: 'p:chip@0', amount: 2, why: 'chips', group: 'logistics' }, { key: 'p:circ@2', amount: 1, why: 'stays in the machine', group: 'one-off' },
      { key: 'p:cable@0', amount: 8, why: 'power hookup', group: 'power' }, { key: 'machine:111@0', amount: 1, why: '1× Basic Wiremill' }];   // no group → Machines
    expect(groupBuildRows(lines, names, new Set()).map((g) => [g.label, g.rows.map((r) => r.key)])).toEqual([
      ['Machines', ['machine:111@0']], ['Power', ['p:cable@0']], ['Piping & logistics', ['p:chip@0']], ['One-off items', ['p:circ@2']]]);
    expect(groupBuildRows([lines[1]!], names, new Set()).map((g) => g.label)).toEqual(['One-off items']);   // empty groups are hidden
  });
  it('marks the run and build rows of goods on the avoid list that nothing at the tier avoids', () => {
    const flagged = { ...plan, avoided: [{ key: 't:iron_ingot@0', name: 'Iron Ingot', unavoidable: true }, { key: 't:titanium_ingot@0', name: 'Titanium Ingot', unavoidable: false }] } as Plan;
    const unavoidable = unavoidableKeys(flagged);
    expect([...unavoidable]).toEqual(['t:iron_ingot@0']);
    expect(runRows(flagged, 'rate').map((r) => [r.key, r.avoid])).toEqual([['t:iron_ingot@0', true], ['t:titanium_ingot@0', undefined]]);
    expect(buildRows(flagged.buildTotals!, names, new Set(), unavoidable).map((r) => r.avoid)).toEqual([true]);
    expect(groupBuildRows(flagged.buildList, names, new Set(['machine:111@0']), unavoidable).flatMap((g) => g.rows.map((r) => r.avoid))).toEqual([undefined, undefined]);
    expect(runRows(plan, 'rate').some((r) => r.avoid !== undefined)).toBe(false);
    const html = renderToStaticMarkup(<MaterialsView project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3, settings: { mode: 'rate', per: 'min', stopItems: [], expandItems: [] },
      world: { scanId: null, baseId: null }, placement: null, notes: [], marks: {} } as never} plan={flagged} send={() => {}} me="Ann" />);
    const row = (id: string) => new RegExp(`<li class="mat-row"(?:(?!</li>).)*data-row="${id}"(?:(?!</li>).)*</li>`, 's').exec(html)?.[0] ?? '';
    expect(row('run:t:iron_ingot@0')).toContain('avoid-badge');
    expect(row('build:t:iron_ingot@0')).toContain('avoid-badge');
    expect(row('run:t:titanium_ingot@0')).not.toContain('avoid-badge');
  });
  it('lists run materials per hour or per batch, with unlocks', () => {
    const rows = runRows(plan, 'rate');
    expect(rows.map((r) => [r.row, r.amount, r.badge, r.unlock])).toEqual([
      ['run:t:iron_ingot@0', '1,800/h', 'mined', undefined], ['run:t:titanium_ingot@0', '360/h', 'not reachable yet', 'Titanium Ingot: needs Moon (T1 rocket) — reachable at HV']]);
    expect(rows[0]).toMatchObject({ have: 'have 1,440 (64 reachable)', canExpand: true, sources: ['vein ore.mix.iron · Overworld · found at 1 2 (Overworld)'] });
  });
});

describe('materials rows', () => {
  const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
    recipeId: p.id, mapId: 'gt.recipe.mixer', machine: { mteId: 581, name: 'Mixer', tier: 1 }, count: 1, owned: 0, runsPerSecond: 0.001,
    utilization: 0.01, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [], ...p,
  });
  const PVA_PER_SECOND = 0.003438 / 3600;
  const mixer = step({ id: 'mixer', mainOutput: 't:glue@0', inputs: [{ key: 'fluid:pva', amount: PVA_PER_SECOND / 0.001, chance: 1 }],
    outputs: [{ key: 't:glue@0', amount: 1, chance: 1 }] });
  const asm = step({ id: 'asm', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Assembler', tier: 1 }, mainOutput: 't:board@0',
    inputs: [{ key: 't:glue@0', amount: 1, chance: 1 }, { key: 'fluid:solder', amount: 72, chance: 1 }], outputs: [{ key: 't:board@0', amount: 1, chance: 1 }] });
  const tiny = {
    ...plan,
    names: { ...names, 'fluid:pva': 'Polyvinyl Acetate', 't:glue@0': 'Glue', 't:board@0': 'Circuit Board', 'fluid:solder': 'Molten Solder' },
    steps: [mixer, asm],
    flows: [{ from: 'raw', to: 'mixer', key: 'fluid:pva', perSecond: PVA_PER_SECOND }, { from: 'mixer', to: 'asm', key: 't:glue@0', perSecond: 0.001 },
      { from: 'asm', to: 'out', key: 't:board@0', perSecond: 0.001 }],
    rawInputs: [{ key: 'fluid:pva', perSecond: PVA_PER_SECOND, cost: PVA_PER_SECOND / 1000, available: true, leafClass: 'derived', sources: [] }],
    byproducts: [{ key: 't:iron_ingot@0', amount: 2e-7, chance: 1 }],
    buildTotals: [{ key: 't:iron_ingot@0', amount: 10, why: 'for Basic Wiremill, LV Machine Hull', neededFor: [{ key: 'machine:111@0', amount: 6 }, { key: 't:hull_lv@0', amount: 4 }] }],
  } as unknown as Plan;
  const view = (p: Plan, mode: 'rate' | 'makeN' = 'rate'): string => renderToStaticMarkup(<MaterialsView project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3,
    settings: { mode, per: 'hour', stopItems: [], expandItems: [] }, world: { scanId: null, baseId: null }, placement: null, notes: [], marks: {} } as never} plan={p} send={() => {}} me="Ann" />);

  it('never prints a tiny amount as 0, and gives fluids their litres', () => {
    /** An amount that reads "0.00" (not the start of 0.004). */
    const ZERO = /(?<![\d.])0\.00(?!\d)/;
    expect(runRows(tiny, 'rate')[0]?.amount).toBe('1 L every 12.1 days');
    expect([amountText(0.004), amountText(0.0000123), amountText(-0.001), amountText(0.125)]).toEqual(['0.004', '0.0000123', '-0.001', '0.13']);
    const html = view(tiny);
    expect(text(html)).toContain('1 L every 12.1 days');
    expect(text(html)).not.toMatch(ZERO);
    const batch = { ...tiny, makeN: { totalSeconds: 10, leftovers: [{ key: 'fluid:solder', amount: 0.0001, chance: 1 }] },
      rawInputs: [{ ...tiny.rawInputs[0]!, total: 0.0003 }] } as Plan;
    expect(text(view(batch, 'makeN'))).not.toMatch(ZERO);
    expect(text(view(batch, 'makeN'))).toContain('0.0003 L');
    expect(text(view(batch, 'makeN'))).toContain('0.0001 L');
    expect(runRows(batch, 'makeN')[0]?.usedBy).toEqual([{ stepId: 'mixer', label: 'Mixer (Glue)', rate: '0.00000955 L' }]);   // the batch's share, with its unit
  });
  it('names the steps that use each base material, and shows them in the flow', () => {
    expect(runRows(tiny, 'rate')[0]?.usedBy).toEqual([{ stepId: 'mixer', label: 'Mixer (Glue)', rate: '1 L every 12.1 days' }]);
    const html = text(view(tiny));
    expect(html).toContain('Mixer (Glue)');
    expect(html).toContain('Show in flow');
    vi.stubGlobal('location', { hash: '#materials' });
    const chips = UsedByChips({ itemKey: 'fluid:pva', usedBy: runRows(tiny, 'rate')[0]!.usedBy });
    const [show] = findAll(chips, (e) => e.type === 'button' && e.props.children === 'Show in flow');
    (show!.props.onClick as () => void)();
    expect(getFlowFocus()).toEqual({ kind: 'item', key: 'fluid:pva' });
    expect(location.hash).toBe('#flow');
  });
  it('lists the inputs nothing supplies first', () => {
    const rows = missingRows(tiny, indexPlan(tiny));
    expect(rows).toMatchObject([{ row: 'missing:fluid:solder@asm', key: 'fluid:solder', name: 'Molten Solder', badge: 'no source in the plan',
      amount: '259 L/h', usedBy: [{ stepId: 'asm', label: 'Assembler (Circuit Board)', rate: '259 L/h' }] }]);
    const html = view(tiny);
    expect(html).toContain('no source in the plan');
    expect(html.indexOf('data-row="missing:fluid:solder@asm"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-row="missing:fluid:solder@asm"')).toBeLessThan(html.indexOf('data-row="run:fluid:pva"'));
    expect(missingRows(plan, indexPlan(plan))).toEqual([]);
  });
  it('opens a total of base materials to the build lines that need it', () => {
    const [row] = buildRows(tiny.buildTotals!, tiny.names!, new Set());
    expect(row?.why).toBe('for Basic Wiremill, LV Machine Hull');
    expect(row?.neededFor).toEqual([{ key: 'machine:111@0', name: 'Basic Wiremill', amount: '6' }, { key: 't:hull_lv@0', name: 'LV Machine Hull', amount: '4' }]);
    const html = view(tiny);
    expect(html).toMatch(/<details class="mat-needed[^"]*"><summary>for Basic Wiremill, LV Machine Hull<\/summary>/);
    expect(text(html)).toContain('6× for Basic Wiremill');
    expect(text(html)).toContain('4× for LV Machine Hull');
  });
  it('names a programmed circuit by its configuration', () => {
    const circuits: Plan['buildList'] = [{ key: 'gregtech:gt.integrated_circuit@3', amount: 1, why: 'stays in the machine', group: 'one-off' }];
    expect(buildRows(circuits, { 'gregtech:gt.integrated_circuit@3': 'Programmed Circuit' }, new Set())[0]?.name).toBe('Programmed Circuit (config 3)');
    const html = view({ ...plan, names: { ...names, 'gregtech:gt.integrated_circuit@3': 'Programmed Circuit' }, buildList: circuits } as Plan);
    expect(text(html)).toContain('Programmed Circuit (config 3)');
  });
  it('keeps a base material nothing here makes from being planned in the line', () => {
    const fixed = { ...plan, tier: 1, rawInputs: [{ ...plan.rawInputs[0]!, canMake: false }] } as Plan;
    expect(runRows(fixed, 'rate')[0]?.cannotMake).toBe('Nothing at LV makes Iron Ingot');
    expect(view(fixed)).toMatch(/<button[^>]*disabled=""[^>]*>We&#x27;ll make it ourselves<\/button>/);
    expect(runRows(plan, 'rate')[0]?.cannotMake).toBeUndefined();
  });
});

describe('views', () => {
  const project = { id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3, settings: { mode: 'rate', per: 'min', stopItems: [], expandItems: [] },
    world: { scanId: null, baseId: null }, placement: null, notes: [], marks: { 'step:gather': { by: 'Jörg 🙂', at: '2026-10-17T12:00:00.000Z' } } } as never;
  it('crosses off marked steps and shows who did it', () => {
    const html = renderToStaticMarkup(<StepsView project={project} plan={plan} send={() => {}} me="Ann" />);
    expect(html).toContain('data-row="step:gather"');
    expect(html).toMatch(/data-row="step:gather"[^>]*data-marked="true"/);
    expect(html).toContain('Jörg 🙂');
  });
  it('renders all sections and sits between flow and notes', () => {
    const html = renderToStaticMarkup(<MaterialsView project={project} plan={plan} send={() => {}} me="Ann" />);
    for (const s of ['To build (once)', 'Machines', 'To run', 'Titanium Ingot: needs Moon', 'Gather the base materials']) expect(html).toContain(s);
    const ids = PROJECT_TABS.map((t) => t.id);                        // relative order only: Plans 4 and 5 insert map and 3d first
    expect(ids.indexOf('flow')).toBeLessThan(ids.indexOf('materials'));
    expect(ids.indexOf('materials')).toBeLessThan(ids.indexOf('notes'));
  });
  it('shows where a material sits', () => {
    const where = [{ kind: 'drawer', pos: [10, 64, -5], count: 64, reachable: true }, { kind: 'chest', pos: [12, 65, -5], count: 1376, reachable: false }];
    const spots = ['64 in drawer at 10 64 -5', '1,376 in chest at 12 65 -5'];
    const have = { total: 1440, reachable: 64, where };
    expect(whereLines(have)).toEqual(spots);
    expect([whereLines({ total: 1, reachable: 1 }), whereLines(undefined)]).toEqual([[], []]);
    const stocked = { ...plan, buildTotals: [{ key: 't:iron_ingot@0', amount: 10, why: 'base material', have }],
      rawInputs: [{ ...plan.rawInputs[0]!, have }, plan.rawInputs[1]!] } as unknown as Plan;
    expect(runRows(stocked, 'rate').map((r) => r.where)).toEqual([spots, undefined]);
    expect(buildRows(stocked.buildTotals!, names, new Set())[0]?.where).toEqual(spots);
    expect(buildRows(plan.buildList, names, new Set())[0]?.where).toBeUndefined();
    const html = renderToStaticMarkup(<MaterialsView project={project} plan={stocked} send={() => {}} me="Ann" />);
    for (const s of ['have 1,440 (64 reachable)', ...spots]) expect(html).toContain(s);
  });
  it('lists the whole batch, its leftovers and its time in Make N', () => {
    const batch = { ...plan, makeN: { totalSeconds: 115, leftovers: [{ key: 't:hull_lv@0', amount: 3, chance: 1 }] },
      rawInputs: [{ ...plan.rawInputs[0]!, perSecond: 0.087, total: 10, cost: 10 }, { key: 't:titanium_ingot@0', perSecond: 0, total: 2, cost: 2, available: true, leafClass: 'stop', sources: [] }] } as unknown as Plan;
    expect(runRows(batch, 'makeN').map((r) => [r.amount, r.cost, r.badge, r.canExpand, r.isStop])).toEqual([
      ['10', 'cost 10', 'mined', true, false], ['2', 'cost 2', 'we make this', false, true]]);
    expect(runRows(plan, 'rate').map((r) => r.cost)).toEqual(['cost 1,800/h', 'cost 360/h']);
    const stopping = { ...(project as object), settings: { mode: 'makeN', per: 'min', stopItems: ['t:titanium_ingot@0'], expandItems: [] } } as never;
    const html = renderToStaticMarkup(<MaterialsView project={stopping} plan={batch} send={() => {}} me="Ann" />);
    for (const s of ['Left over', 'LV Machine Hull', '3×', 'Takes about 2 min', 'Stop treating as made', 'We&#x27;ll make it ourselves']) expect(html).toContain(s);
    expect(renderToStaticMarkup(<MaterialsView project={project} plan={batch} send={() => {}} me="Ann" />)).not.toContain('Stop treating as made');   // not in stopItems any more
  });
});
