import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRows, groupBuildRows, runRows, sourceText, amountText, haveText, whereLines, unavoidableKeys, missingRows, madeText, withLinePlaced,
  gatheredStacks, groupBuildSlots, MAX_STACKS_SHOWN, slotTipLines, stackCount, stackSplit, stillNeeded,
} from '../../src/client/views/materials-model.ts';
import { StepsView } from '../../src/client/views/StepsView.tsx';
import { MaterialsView, UsedByChips } from '../../src/client/views/MaterialsView.tsx';
import { BuildGrid, GatherMeter, ViewToggle } from '../../src/client/views/MaterialsGrid.tsx';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import { localTime } from '../../src/client/format.ts';
import { getFlowFocus, setFlowFocus } from '../../src/client/state/flow-focus.ts';
import { MATERIALS_VIEW_KEY, getMaterialsView, setMaterialsView } from '../../src/client/state/materials-view.ts';
import { indexPlan } from '../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { BomLine, Plan, PlanStep } from '../../src/shared/types/plan.ts';
import { keepIn } from './storage-stub.ts';

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

// The Grid / List choice is a module's page value as well as storage's (state/materials-view.ts): a case that left Grid behind would draw
// the next case's build list as the grid, so the store is put back to the List as theme.test.tsx does, through a storage that keeps it.
afterEach(() => {
  setFlowFocus(null);
  vi.stubGlobal('localStorage', keepIn(new Map()));
  setMaterialsView('list');
  vi.unstubAllGlobals();
});

const names = { 'machine:111@0': 'Basic Wiremill', 't:hull_lv@0': 'LV Machine Hull', 't:iron_ingot@0': 'Iron Ingot', 't:titanium_ingot@0': 'Titanium Ingot', 'dim:overworld': 'Overworld', 'dim:moon': 'Moon', 'dimId:0': 'Overworld',
  'fluid:molten.tin': 'Molten Tin', 't:tin_dust@0': 'Tin Dust', 't:cupronickel_ingot@0': 'Cupronickel Ingot', 't:cupro_wire@0': '2x Cupronickel Wire', 't:mica_foil@0': 'Mica Insulator Foil',
  't:circuit@0': 'Basic Circuit', 't:copper_wire@0': '1x Copper Wire', 't:redstone@0': 'Redstone', 't:coil@0': 'Cupronickel Coil Block', 'machine:1000@0': 'Electric Blast Furnace', 't:v@0': 'Part V' };
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
    // the figures of a used-by chip and of a short input's badge are VT323 (span.fig), the words and the % Pixelify (Phase 2 spec §25)
    expect(html).toContain('<span class="chip">Assembler (Circuit Board) <span class="fig">259</span> L/h</span>');
    const halfGlue = { ...tiny, flows: tiny.flows.map((f) => (f.key === 't:glue@0' ? { ...f, perSecond: f.perSecond / 2 } : f)) } as Plan;
    expect(view(halfGlue)).toContain('<span class="badge missing-badge">short: gets <span class="fig">50</span>%</span>');
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
  it('totals what the build takes: the machines and the layout parts (plan 12)', () => {
    const costed = { ...plan, cost: { runPerHour: 1, build: 182, horizonHours: 24, layout: 40 } } as Plan;
    const html = renderToStaticMarkup(<MaterialsView project={project} plan={costed} send={() => {}} me="Ann" />);
    const section = /<section[^>]*aria-labelledby="to-build-title"[^>]*>.*?<\/section>/s.exec(html)?.[0] ?? '';
    expect(text(section)).toContain('About 222 raw to build: 182 for the machines, 40 for power and logistics parts');
    expect(section.indexOf('About 222 raw to build')).toBeLessThan(section.indexOf('Machines'));
    // Nothing in the build list: the section says so once.
    const empty = renderToStaticMarkup(<MaterialsView project={project} plan={{ ...costed, buildList: [], cost: { runPerHour: 1, build: 0, horizonHours: 24 } } as Plan}
      send={() => {}} me="Ann" />);
    expect(text(empty)).toContain('Nothing new to build: the machines you have cover this line.');
    expect(text(empty).match(/Nothing new to build/g)).toHaveLength(1);
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

describe('how the build parts are made', () => {
  const coilA = { recipeId: 'assemble-coil', rawCost: 11, mapId: 'gt.recipe.assembler' };
  const coilB = { recipeId: 'assemble-coil-b', rawCost: 12, mapId: 'gt.recipe.assembler' };
  const view = (p: Plan): string => renderToStaticMarkup(<MaterialsView project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3,
    settings: { ...defaultSettings() }, world: { scanId: null, baseId: null }, placement: null, notes: [], marks: {} } as never} plan={p} send={() => {}} me="Ann" />);
  /** The list row of `html` whose tick is `id` (its first one). */
  const row = (html: string, id: string): string => new RegExp(`<li class="mat-row"(?:(?!</li>).)*data-row="${id}"(?:(?!</li>).)*</li>`, 's').exec(html)?.[0] ?? '';
  /** The recipes `html` offers a radio for. */
  const recipeRadios = (html: string): string[] => [...html.matchAll(/<label class="check swap-option" title="recipe ([^"]*)"><input type="radio"/g)].map((m) => m[1]!);

  it('says how each build part is made', () => {
    const tin: BomLine = { key: 'fluid:molten.tin', amount: 576, why: 'for Cupronickel Coil Block',
      made: { recipeId: 'melt-tin', mapId: 'gt.recipe.fluidextractor', machine: { mteId: 131, name: 'Basic Fluid Extractor', tier: 1, source: 'new' }, runs: 4 },
      children: [{ key: 't:tin_dust@0', amount: 4, why: 'for Molten Tin' }] };
    const made = tin.made!;
    expect(madeText(tin, names)).toBe('made in a Basic Fluid Extractor from Tin Dust');
    expect(madeText({ ...tin, made: { ...made, machine: { mteId: 111, name: 'Basic Wiremill', tier: 1, source: 'owned' }, circuit: 2 },
      children: [{ key: 't:cupronickel_ingot@0', amount: 1, why: 'for 2x Cupronickel Wire' }] }, names)).toBe('made in your Basic Wiremill from Cupronickel Ingot (circuit 2)');
    expect(madeText({ ...tin, made: { ...made, machine: { mteId: 211, name: 'Basic Assembler', tier: 1, source: 'line' }, circuit: 8 },
      children: [{ key: 'fluid:molten.tin', amount: 144, why: 'for Cupronickel Coil Block' }, { key: 't:cupro_wire@0', amount: 8, why: 'for Cupronickel Coil Block' },
        { key: 't:mica_foil@0', amount: 8, why: 'for Cupronickel Coil Block' }] }, names))
      .toBe('made in the Basic Assembler this line builds from Molten Tin, 2x Cupronickel Wire, Mica Insulator Foil (circuit 8)');
    expect(madeText({ ...tin, made: { ...made, machine: 'crafting table' },
      children: [{ key: 't:hull_lv@0', amount: 1, why: 'for Basic Wiremill' }, { key: 't:circuit@0', amount: 2, why: 'for Basic Wiremill' }] }, names))
      .toBe('made at a crafting table from LV Machine Hull, Basic Circuit');
    expect(madeText({ ...tin, made: { ...made, machine: { mteId: 122, name: 'Advanced Assembler', tier: 2, source: 'new' }, cleanroom: true },
      children: [{ key: 't:copper_wire@0', amount: 4, why: 'for Basic Circuit' }, { key: 't:redstone@0', amount: 1, why: 'for Basic Circuit' }] }, names))
      .toBe('made in an Advanced Assembler from 1x Copper Wire, Redstone (in a cleanroom)');
    // A machine only this line's own unit could be, both notes, and a node the tree cuts at its depth (no children): no inputs named.
    expect(madeText({ key: 't:coil@0', amount: 1, why: 'for Electric Blast Furnace', made: { ...made, machine: { mteId: 211, name: 'Basic Assembler', tier: 1, source: 'first' },
      circuit: 3, cleanroom: true } }, names)).toBe('made in a Basic Assembler (circuit 3; in a cleanroom)');
    expect(madeText({ key: 't:tin_dust@0', amount: 4, why: 'for Molten Tin' }, names)).toBeUndefined();
  });
  it('says when the build counts the placed line\'s parts', () => {
    const placed = { ...plan, buildSteps: [{ id: 'layout:site', order: 1, text: 'Clear', kind: 'place' }] } as Plan;
    const unplaced = { ...plan, buildSteps: [{ id: 'gather', order: 1, text: 'Gather', kind: 'gather' }] } as Plan;
    expect([withLinePlaced(placed), withLinePlaced(unplaced)]).toEqual([true, false]);
    const html = view(placed);
    expect(html).toContain('To build (once), with the line placed');
    expect(html).toContain('Base materials for the build, with the line placed');
    const plain = view(unplaced);
    expect(plain).not.toContain('with the line placed');
    expect(plain).toContain('<h3 id="to-build-title">To build (once)</h3>');
    expect(plain).toContain('<h3 id="build-totals-title">Base materials for the build</h3>');
  });
  it('offers the recipe swap on a made build row and flags what must be imported', () => {
    const coil: BomLine = { key: 't:coil@0', amount: 16, why: '16× Cupronickel Coil Block',
      made: { recipeId: 'assemble-coil', mapId: 'gt.recipe.assembler', machine: { mteId: 211, name: 'Basic Assembler', tier: 1, source: 'new' }, runs: 16, circuit: 8 },
      children: [{ key: 'fluid:molten.tin', amount: 2304, why: 'for Cupronickel Coil Block' }, { key: 't:cupro_wire@0', amount: 128, why: 'for Cupronickel Coil Block' },
        { key: 't:mica_foil@0', amount: 128, why: 'for Cupronickel Coil Block' }] };
    const ebf: BomLine = { key: 'machine:1000@0', amount: 1, why: '1× Electric Blast Furnace', unmade: 'no-recipe' };
    const partV: BomLine = { key: 't:v@0', amount: 1, why: 'for Part W', unmade: 'own-chain' };
    const swapping = { ...plan, buildList: [coil, ebf, partV], buildTotals: [...plan.buildTotals!, partV], buildAlternatives: { 't:coil@0': [coilA, coilB] } } as Plan;
    const coilText = 'made in a Basic Assembler from Molten Tin, 2x Cupronickel Wire, Mica Insulator Foil (circuit 8)';
    expect(buildRows(swapping.buildList, names, new Set(), undefined, swapping.buildAlternatives).map((r) => [r.key, r.made, r.unmade])).toEqual([
      ['t:coil@0', { text: coilText, recipeId: 'assemble-coil', alternatives: [coilA, coilB] }, undefined],
      ['machine:1000@0', undefined, 'no-recipe'], ['t:v@0', undefined, 'own-chain']]);
    expect(groupBuildRows(swapping.buildList, names, new Set(), undefined, swapping.buildAlternatives)[0]?.rows[0]?.made?.alternatives).toEqual([coilA, coilB]);

    const html = view(swapping);
    const made = row(html, 'build:t:coil@0');
    expect(made).toContain(`<span class="mat-made muted small">${coilText}</span>`);
    expect(made).toContain('>16× Cupronickel Coil Block<');
    expect(made.indexOf('>16× Cupronickel Coil Block<')).toBeLessThan(made.indexOf('mat-made'));   // after its why
    expect(made).toContain('<details class="mat-swap">');
    expect(made).toContain('<summary>Swap recipe</summary>');
    expect(made).toContain('Recipe for Cupronickel Coil Block');
    expect(made).toContain('Let the planner choose');
    expect(recipeRadios(made)).toEqual(['assemble-coil', 'assemble-coil-b']);
    expect(made).not.toContain('unmade-badge');
    const noRecipe = row(html, 'build:machine:1000@0');
    expect(noRecipe).toContain('unmade-badge');
    expect(noRecipe).toContain('>import it</span>');
    expect(noRecipe).toContain('title="Nothing at this tier makes it: import it, or mark it &quot;we already make this&quot;"');
    expect(noRecipe).not.toContain('mat-made');
    expect(row(html, 'build:t:v@0')).toContain('title="Every recipe for it here needs a part of its own chain: swap the recipe of a part it goes into, or import it"');
    // The totals carry the badge too.
    const totals = /<section[^>]*aria-labelledby="build-totals-title"[^>]*>.*?<\/section>/s.exec(html)?.[0] ?? '';
    expect(row(totals, 'build:t:v@0')).toContain('unmade-badge');
    expect(row(totals, 'build:t:iron_ingot@0')).not.toContain('unmade-badge');
    // One way to make it, or none listed: nothing to swap, the row still says how it is made.
    for (const buildAlternatives of [{ 't:coil@0': [coilA] }, undefined]) {
      const single = row(view({ ...swapping, buildAlternatives } as Plan), 'build:t:coil@0');
      expect(single).toContain(coilText);
      expect(single).not.toContain('mat-swap');
    }
  });
});

// "To build (once)" as an inventory grid (Phase 2 spec §9, D9): the top-level build lines as 36 px Minecraft slots in their groups, an item
// split into stacks of 64, opted into per browser with the head's Grid / List toggle; the List stays the default and the source of truth.
// One mark per row: the first stack of an item is its one checkbox, its other stacks hidden copies that tick the same row.
describe('the inventory grid', () => {
  const slotNames = { ...names, 'p:cable@0': 'Cable', 'fluid:water': 'Water' };
  /** The second case's result, which the later cases share: the wiremill in Machines; 80 cables and 1,000 L of water in Power. */
  const groups = groupBuildSlots([{ key: 'p:cable@0', amount: 80, why: 'power hookup', group: 'power' }, { key: 'machine:111@0', amount: 1, why: '1× Basic Wiremill' },
    { key: 'fluid:water', amount: 1000, why: 'for the boiler', group: 'power' }], slotNames, new Set(['machine:111@0']));
  const cable = groups[1]!.items[0]!;
  const mark = { by: 'Ann', at: '2026-10-24T10:00:00.000Z' };

  it('splits an amount into stacks of 64', () => {
    expect([80, 128, 1, 0, 0.25, 64.0000000001].map((a) => stackSplit(a))).toEqual([[64, 16], [64, 64], [1], [], [1], [64]]);
  });
  // the final fix wave, FW-5: the split stops at the stacks the grid draws, and an item's count of stacks is worked out, never counted in an
  // array, so a build of a trillion items makes no array of 15.6 billion stacks (a renderer killed, again on every reload, from about 8.6e9)
  it('splits only the stacks the grid draws, and counts the rest', () => {
    expect(stackSplit(64 * 9 + 16)).toEqual(Array(MAX_STACKS_SHOWN).fill(64));                 // the tenth stack, the 16, is not drawn
    expect(stackSplit(64 * 8 + 16)).toEqual([...Array(8).fill(64), 16]);
    expect(stackSplit(1e12)).toEqual(Array(MAX_STACKS_SHOWN).fill(64));
    expect([80, 128, 1, 0, 0.25, 64.0000000001, 64 * 9 + 16, 1e12].map((a) => stackCount(a))).toEqual([2, 2, 1, 0, 1, 1, 10, 15_625_000_000]);
    expect([Number.NaN, Number.POSITIVE_INFINITY, -5].map((a) => [stackSplit(a), stackCount(a)])).toEqual([[[], 0], [[], 0], [[], 0]]);
    const [huge, water] = groupBuildSlots([{ key: 'p:x@0', amount: 1e12, why: 'x' }, { key: 'fluid:water', amount: 1e12, why: 'y' }], names)[0]!.items;
    expect([huge!.stacks.length, huge!.stackCount]).toEqual([MAX_STACKS_SHOWN, 15_625_000_000]);
    expect([water!.stacks, water!.stackCount]).toEqual([[1], 1]);                               // a fluid is one slot, whatever its litres
    expect(gatheredStacks([{ id: 'machines', label: 'Machines', items: [huge!, water!] }], { [huge!.row]: mark })).toEqual({ done: 15_625_000_000, total: 15_625_000_001 });
  });
  it('writes the counts of stacks as the List writes its figures: in the meter, its spoken words and a slot\'s name', () => {
    expect(renderToStaticMarkup(<GatherMeter done={1563} total={100_000} />)).toMatch(
      /<span>1,563 of 100,000 stacks<\/span>.*aria-valuemax="100000" aria-valuenow="1563" aria-valuetext="1,563 of 100,000 stacks gathered"/);
    const html = renderToStaticMarkup(<BuildGrid groups={groupBuildSlots([{ key: 'p:x@0', amount: 1563 * 64, why: 'x' }], names)} marks={{}} send={() => {}} />);
    expect(html).toContain('aria-label="p:x@0, 100,032× in 1,563 stacks"');
    expect(html).toContain('<span class="stack-count" aria-hidden="true">+1.6k</span>');           // 1,554 more: rolled up as a stack count is
  });
  it('groups the top-level build lines as slots, in the groups\' order, a fluid as one slot', () => {
    const groups = groupBuildSlots([{ key: 'p:cable@0', amount: 80, why: 'power hookup', group: 'power' }, { key: 'machine:111@0', amount: 1, why: '1× Basic Wiremill' },
      { key: 'fluid:water', amount: 1000, why: 'for the boiler', group: 'power' }], slotNames, new Set(['machine:111@0']));
    expect(groups.map((g) => [g.label, g.items.map((i) => [i.row, i.stacks])])).toEqual([['Machines', [['build:machine:111@0', [1]]]], ['Power', [['build:p:cable@0', [64, 16]], ['build:fluid:water', [1]]]]]);
    expect(groups[0]!.items[0]).toMatchObject({ amount: '1×', avoid: true, fluid: false }); expect(groups[1]!.items[1]).toMatchObject({ amount: '1,000 L', fluid: true });
  });
  it('counts the stacks gathered and the items still needed', () => {
    expect(gatheredStacks(groups, { 'build:p:cable@0': mark })).toEqual({ done: 2, total: 4 });
    expect(stillNeeded(groups[1]!.items, { 'build:p:cable@0': mark })).toBe('1 of 2 still needed'); expect(stillNeeded(groups[0]!.items, { 'build:machine:111@0': mark })).toBe('all in your chests');
  });
  it('tells a slot\'s need, stock, why, avoid and tick in its tip lines', () => {
    expect(slotTipLines({ ...cable, have: 'have 1,440 (64 reachable)', avoid: true }, { by: 'Ann', at: 'now' }, () => '10:00')).toEqual(
      ['need 80× · have 1,440 (64 reachable)', 'power hookup', 'On the avoid list or made from it, but no recipe at this tier avoids it', '✓ Ann, 10:00']);
  });
  it('draws one checkbox per item, its other stacks hidden, counts above 1, and a tick on a marked row', () => {
    const html = renderToStaticMarkup(<BuildGrid groups={groups} marks={{ 'build:p:cable@0': mark }} send={() => {}} />);
    expect(html.match(/data-row="build:p:cable@0"/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="button" class="mat-slot marked" role="checkbox" aria-checked="true" aria-label="Cable, 80× in 2 stacks" data-row="build:p:cable@0" data-marked="true" data-tip="/);
    expect(html).toMatch(/<button type="button" class="mat-slot marked" aria-hidden="true" tabindex="-1" data-stack-of="build:p:cable@0"/);
    expect(html.match(/class="stack-count"/g)).toHaveLength(2);           // 64 and 16; the single machine and the fluid draw none
    expect(html.match(/class="mat-slot-tick"/g)).toHaveLength(2);         // both stacks of the marked row
    const ten = renderToStaticMarkup(<BuildGrid groups={groupBuildSlots([{ key: 'p:x@0', amount: 640, why: 'x' }], names)} marks={{}} send={() => {}} />);
    expect(ten.match(/class="mat-slot[ "]/g)).toHaveLength(10); expect(ten).toContain('<span class="stack-count" aria-hidden="true">+1</span>');
  });
  it('ticks the row from any of its stacks', () => {
    const send = vi.fn(); const stacks = findAll(BuildGrid({ groups, marks: {}, send }), (e) => e.props['data-row'] === 'build:p:cable@0' || e.props['data-stack-of'] === 'build:p:cable@0');
    for (const s of stacks) (s.props.onClick as () => void)();
    expect(send.mock.calls).toEqual([[[{ op: 'mark', row: 'build:p:cable@0', on: true }]], [[{ op: 'mark', row: 'build:p:cable@0', on: true }]]]);
    const [first] = findAll(BuildGrid({ groups, marks: { 'build:p:cable@0': mark }, send }), (e) => e.props['data-row'] === 'build:p:cable@0');
    (first!.props.onClick as () => void)(); expect(send).toHaveBeenLastCalledWith([{ op: 'mark', row: 'build:p:cable@0', on: false }]);
  });
  it('shows the meter and the toggle', () => {
    expect(renderToStaticMarkup(<GatherMeter done={2} total={4} />)).toMatch(/role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="4" aria-valuenow="2" aria-valuetext="2 of 4 stacks gathered"/);
    expect(renderToStaticMarkup(<ViewToggle view="grid" />)).toBe('<div class="mat-view-toggle" role="group" aria-label="Show the build list as"><button type="button" class="small" aria-pressed="true">Grid</button><button type="button" class="small" aria-pressed="false">List</button></div>');
  });

  // beyond the brief's cases: what the slots say and hold where it shows only in a browser
  it('gives every stack of an item the item\'s tip and mod line, and names a fluid by its litres alone', () => {
    const stacks = findAll(BuildGrid({ groups, marks: { 'build:p:cable@0': mark }, send: () => {} }), (e) => e.props['data-row'] === 'build:p:cable@0' || e.props['data-stack-of'] === 'build:p:cable@0');
    expect(stacks.map((s) => s.props['data-tip'])).toEqual(Array(2).fill(`Cable\nneed 80×\npower hookup\n✓ Ann, ${localTime(mark.at)}`));
    const html = renderToStaticMarkup(<BuildGrid groups={groups} marks={{}} send={() => {}} />);
    expect(html).toContain('aria-label="Water, 1,000 L" data-row="build:fluid:water" data-marked="false" data-tip="Water\nneed 1,000 L\nfor the boiler"');
    // a GregTech item's slot names its mod on its tip's last line (Phase 2 spec §6.5), the e2e pack's `t:` and `machine:` keys none
    const steel = renderToStaticMarkup(<BuildGrid groups={groupBuildSlots([{ key: 'gregtech:gt.blockmachines@1', amount: 2, why: 'x' }], {})} marks={{}} send={() => {}} />);
    expect(steel).toContain('data-tip-mod="GregTech"');
    expect(html).not.toContain('data-tip-mod');
  });
  it('heads each group with how many of its items are still needed, over its slots, after the hint', () => {
    const html = renderToStaticMarkup(<BuildGrid groups={groups} marks={{ 'build:p:cable@0': mark }} send={() => {}} />);
    expect(html).toMatch(/^<div class="mat-grid"><p class="mat-grid-hint muted">Click a stack to mark it as in your chests\. Stacks split at 64, like in game\.<\/p>/);
    expect(html).toContain('<h4 id="slots-power">Power <span class="mat-grid-left">· 1 of 2 still needed</span></h4><div class="mat-slots" role="group" aria-labelledby="slots-power">');
    expect(html).toContain('<h4 id="slots-machines">Machines <span class="mat-grid-left">· 1 of 1 still needed</span></h4>');
  });
  it('tells a slot past the ninth stack how many more there are, rolled up past 999 as a stack count is, so it stays in its slot', () => {
    const more = (amount: number): string => /<span class="stack-count" aria-hidden="true">(\+[^<]*)<\/span>/.exec(renderToStaticMarkup(
      <BuildGrid groups={groupBuildSlots([{ key: 'p:x@0', amount, why: 'x' }], names)} marks={{}} send={() => {}} />))?.[1] ?? '';
    expect([64 * 9, 64 * 1008, 64 * 1009, 64 * 15634].map(more)).toEqual(['', '+999', '+1k', '+16k']);
    // the meter counts every stack, the ones past the ninth too
    expect(gatheredStacks(groupBuildSlots([{ key: 'p:x@0', amount: 640, why: 'x' }], names), { 'build:p:x@0': mark })).toEqual({ done: 10, total: 10 });
  });
  // spec §9.1, §9.2: the slot past the ninth stack says how many more there are, with no icon; like the item's other stacks it is a hidden copy,
  // out of the tab order and with no name of its own (the item's one checkbox names it), and it ticks the same row, ticked or not
  it('draws the +N slot as a hidden copy out of the tab order, with no icon and no name of its own, that ticks the same row', () => {
    const big = groupBuildSlots([{ key: 'p:x@0', amount: 640, why: 'x' }], names);
    const html = renderToStaticMarkup(<BuildGrid groups={big} marks={{}} send={() => {}} />);
    expect(html).toContain('<button type="button" class="mat-slot mat-slot-more" aria-hidden="true" tabindex="-1" data-stack-of="build:p:x@0" '
      + 'data-tip="p:x@0\nneed 640×\nx"><span class="stack-count" aria-hidden="true">+1</span></button></div>');
    expect(html.match(/tabindex="-1"/g)).toHaveLength(9);                // the eight other stacks drawn, and the +N slot
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
    const send = vi.fn();
    const more = (marks: Record<string, typeof mark>) => findAll(BuildGrid({ groups: big, marks, send }), (e) => String(e.props.className).includes('mat-slot-more'));
    const [plain] = more({});
    (plain!.props.onClick as () => void)();
    expect(send).toHaveBeenLastCalledWith([{ op: 'mark', row: 'build:p:x@0', on: true }]);
    const [ticked] = more({ 'build:p:x@0': mark });
    expect(ticked!.props.className).toBe('mat-slot marked mat-slot-more');
    (ticked!.props.onClick as () => void)();
    expect(send).toHaveBeenLastCalledWith([{ op: 'mark', row: 'build:p:x@0', on: false }]);
    // ticked, it is dimmed and ticked as every stack of its row
    expect(renderToStaticMarkup(<BuildGrid groups={big} marks={{ 'build:p:x@0': mark }} send={() => {}} />))
      .toContain('<span class="stack-count" aria-hidden="true">+1</span><span class="mat-slot-tick" aria-hidden="true"></span></button></div>');
  });
  it('switches the view from the toggle, in this browser only: the project hears nothing of it', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    const [grid, list] = findAll(ViewToggle({ view: 'list' }), (e) => e.type === 'button');
    (grid!.props.onClick as () => void)(); expect(getMaterialsView()).toBe('grid');
    (list!.props.onClick as () => void)(); expect(getMaterialsView()).toBe('list');
  });
  it('puts the toggle in the head of To build, and in Grid the meter beside it and the slots after the total line', () => {
    const project = { id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 3, settings: { mode: 'rate', per: 'min', stopItems: [], expandItems: [] },
      world: { scanId: null, baseId: null }, placement: null, notes: [], marks: {} } as never;
    const costed = { ...plan, cost: { runPerHour: 1, build: 182, horizonHours: 24, layout: 40 } } as Plan;
    const section = (p: Plan): string => /<section[^>]*aria-labelledby="to-build-title"[^>]*>.*?<\/section>/s.exec(
      renderToStaticMarkup(<MaterialsView project={project} plan={p} send={() => {}} me="Ann" />))?.[0] ?? '';
    const list = section(costed);
    expect(list).toContain('<div class="mat-head"><h3 id="to-build-title">To build (once)</h3><div class="mat-view-toggle" role="group" aria-label="Show the build list as">'
      + '<button type="button" class="small" aria-pressed="false">Grid</button><button type="button" class="small" aria-pressed="true">List</button></div></div>');
    expect(list).toContain('<li class="mat-row"'); expect(list).not.toContain('progressbar'); expect(list).not.toContain('mat-slot');
    vi.stubGlobal('localStorage', keepIn(new Map([[MATERIALS_VIEW_KEY, 'grid']])));
    const grid = section(costed);
    expect(grid).toMatch(/^<section[^>]*><div class="mat-head"><h3 id="to-build-title">To build \(once\)<\/h3><div class="mat-view-toggle"[^>]*>(?:(?!<\/div>).)*<\/div><div class="mat-meter-box">/s);
    expect(grid).toContain('aria-valuemax="1" aria-valuenow="0" aria-valuetext="0 of 1 stack gathered"');
    // the total line is still the section's own paragraph, before the slots, and nothing before it says "Machines"
    expect(grid).toContain('</div><p class="muted">About 222 raw to build');
    expect(grid.indexOf('About 222 raw to build')).toBeLessThan(grid.indexOf('Machines'));
    expect(grid.indexOf('About 222 raw to build')).toBeLessThan(grid.indexOf('class="mat-grid"'));
    expect(grid).not.toContain('<li class="mat-row"');
    // nothing to build: the one line that says so, and no toggle, meter or grid, in either view
    const empty = { ...costed, buildList: [] } as Plan;
    for (const stored of ['grid', 'list']) {
      vi.stubGlobal('localStorage', keepIn(new Map([[MATERIALS_VIEW_KEY, stored]])));
      expect(section(empty), stored).toMatch(/^<section[^>]*><div class="mat-head"><h3 id="to-build-title">To build \(once\)<\/h3><\/div><p class="muted">Nothing new to build: the machines you have cover this line\.<\/p><\/section>$/);
    }
  });
});
