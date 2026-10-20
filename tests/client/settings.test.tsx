import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  dimRows, dimOverridePatch, toggleList, parseAmount, groupDimRows, parseCost, STEP_CHARGE_PRESETS, ownableMachineGroups, ownedMachineLabel, ownedWith,
  ownedWithout, parseOwnedCount,
} from '../../src/client/views/settings-model.ts';
import { HaveSupplySection, OptionPinsSection, ReuseOwnedField, SettingsPanel, StepChargeField } from '../../src/client/views/SettingsPanel.tsx';
import { OwnedMachinesEditor } from '../../src/client/components/OwnedMachinesEditor.tsx';
import { TierPicker } from '../../src/client/components/TierPicker.tsx';
import { defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { PackInfo } from '../../src/shared/types/api.ts';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

const panelOf = (settings: PlanSettings, p: Plan | null = null, packInfo: PackInfo | null = info): string => renderToStaticMarkup(<SettingsPanel info={packInfo}
  project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings, world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] }}
  plan={p} send={() => {}} me="Ann" />);

const info = { manifest: {} as never, mapCount: 1, recipeCount: 1, itemCount: 1, exclusionRules: ['recycling', 'lava-centrifuge'],
  dimensions: [{ key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 },
               { key: 'moon', id: 28, name: 'Moon', mod: 'galacticraft', kind: 'moon', rocketTier: 1, defaultTier: 3 },
               { key: 'nether', id: -1, name: 'Nether', mod: 'minecraft', kind: 'dimension', defaultTier: 0 }],
  capabilities: [{ key: 'drill:underground', name: 'Fluid Drilling Rig', minTier: 2, yields: [] }] } satisfies PackInfo;
const plan = (reachable: Plan['reachable']) => ({ reachable } as Plan);

describe('settings model', () => {
  it('labels dimensions by why they are reachable', () => {
    const rows = dimRows(info, defaultSettings(), plan([{ key: 'nether', why: 'progression' }, { key: 'overworld', why: 'progression' }]));
    expect(rows.map((r) => [r.key, r.group, r.reachable, r.label])).toEqual([
      ['nether', 'No rocket', true, 'assumed by progression (ULV)'], ['overworld', 'No rocket', true, 'always'],
      ['moon', 'T1 rocket', false, 'not yet — assumed from HV, T1 rocket'], ['drill:underground', 'Capabilities', false, 'not yet — assumed from MV']]);
    const visited = dimRows(info, { ...defaultSettings(), dims: { policy: 'progression', overrides: { nether: 'off' } } }, plan([{ key: 'moon', why: 'visited' }, { key: 'overworld', why: 'progression' }]));
    expect(visited.find((r) => r.key === 'moon')?.label).toBe('visited');
    expect(visited.find((r) => r.key === 'nether')).toMatchObject({ state: 'off', label: 'turned off' });
  });
  it('builds patches', () => {
    const s = { ...defaultSettings(), dims: { policy: 'progression' as const, overrides: { moon: 'on' as const } } };
    expect(dimOverridePatch(s, 'moon', 'auto')).toEqual({ dims: { policy: 'progression', overrides: {} } });
    expect(dimOverridePatch(s, 'nether', 'off')).toEqual({ dims: { policy: 'progression', overrides: { moon: 'on', nether: 'off' } } });
    expect(toggleList(['b', 'a'], 'c', true)).toEqual(['a', 'b', 'c']);
    expect(toggleList(['a', 'b'], 'a', false)).toEqual(['b']);
  });
  it('validates amounts', () => {
    expect(parseAmount('64', 'makeN')).toEqual({ amount: 64 });
    expect(parseAmount('2.5', 'makeN')).toEqual({ error: 'Make N needs a whole number' });
    expect(parseAmount('2.5', 'rate')).toEqual({ amount: 2.5 });
    expect(parseAmount('0', 'rate')).toEqual({ error: 'Enter a number above 0' });
    expect(parseAmount('lots', 'rate')).toEqual({ error: 'Enter a number above 0' });
  });
  it('renders every section', () => {
    const html = renderToStaticMarkup(<SettingsPanel info={info} project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings: defaultSettings(),
      world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] }} plan={null} send={() => {}} me="Ann" />);
    for (const s of ['Make', 'Make N (batch)', 'Tier', 'Reachable dimensions', 'Logistics', 'EnderIO conduits', 'Material costs', 'Skip recipe groups', 'We already make', 'Lava and stone-dust centrifuging'])
      expect(html).toContain(s);
  });
  it('groups rows by rocket and names overrides and progression', () => {
    const wide = { ...info, dimensions: [...info.dimensions, { key: 'mars', id: 29, name: 'Mars', mod: 'galacticraft', kind: 'planet' as const, rocketTier: 2, defaultTier: 4 },
      { key: 'twilight', id: 7, name: 'Twilight Forest', mod: 'twilightforest', kind: 'dimension' as const, defaultTier: 5 }] };
    const s = { ...defaultSettings(), dims: { policy: 'progression' as const, overrides: { mars: 'on' as const } } };
    const rows = dimRows(wide, s, plan([{ key: 'mars', why: 'override' }, { key: 'drill:underground', why: 'progression' }]));
    expect(groupDimRows(rows).map((g) => [g.group, g.rows.map((r) => r.key)])).toEqual([
      ['No rocket', ['nether', 'overworld', 'twilight']], ['T1 rocket', ['moon']], ['T2 rocket', ['mars']], ['Capabilities', ['drill:underground']]]);
    expect(rows.find((r) => r.key === 'mars')).toMatchObject({ state: 'on', reachable: true, label: 'turned on' });
    expect(rows.find((r) => r.key === 'drill:underground')?.label).toBe('assumed by progression (MV)');
    expect(dimRows(info, defaultSettings(), null).map((r) => [r.reachable, r.label])[1]).toEqual([false, 'always']);
    expect(dimRows(info, { ...defaultSettings(), dims: { policy: 'visited', overrides: { overworld: 'off' } } }, null)
      .find((r) => r.key === 'overworld')?.label).toBe('turned off');
  });
  it('rejects amounts and costs the server would refuse', () => {
    expect(parseAmount(' 30 ', 'rate')).toEqual({ amount: 30 });
    expect(parseAmount('1e9', 'makeN')).toEqual({ amount: 1e9 });
    expect(parseAmount('1000000001', 'rate')).toEqual({ error: 'Enter a number above 0' });
    expect(parseAmount('-2.5', 'makeN')).toEqual({ error: 'Enter a number above 0' });
    expect(parseAmount('', 'rate')).toEqual({ error: 'Enter a number above 0' });
    expect(parseCost('0')).toEqual({ cost: 0 });
    expect(parseCost('2.5')).toEqual({ cost: 2.5 });
    expect(parseCost('-1')).toEqual({ error: 'Enter a cost of 0 or more' });
    expect(parseCost('')).toEqual({ error: 'Enter a cost of 0 or more' });
    expect(toggleList(['b', 'a', 'b'], 'a', true)).toEqual(['a', 'b']);
  });
  it('sends patches the server accepts', () => {
    const s = defaultSettings();
    for (const patch of [dimOverridePatch(s, 'moon', 'on'), dimOverridePatch(s, 'moon', 'auto'), { excludedCategories: toggleList(s.excludedCategories, 'scrap', false) },
      { mode: 'makeN' as const, amount: 3 }, { costOverrides: { Silver: 0, 't:iron_plate@0': 2.5 } }, { tier: null }, { coilHeat: 1801 }])
      expect(validateOp({ op: 'settings', patch })).toBeNull();
  });
  it("shows the project's choices", () => {
    const settings = { ...defaultSettings(), target: 't:circuit@0', mode: 'makeN' as const, amount: 64, tier: 2, logistics: 'routed' as const,
      costOverrides: { Silver: 5, 't:iron_plate@0': 2 }, stopItems: ['t:iron_plate@0'], expandItems: ['t:iron_ingot@0'], coilHeat: 2701, routeDerived: true };
    const names = { 't:circuit@0': 'Basic Circuit', 't:iron_plate@0': 'Iron Plate', 't:iron_ingot@0': 'Iron Ingot' };
    const html = renderToStaticMarkup(<SettingsPanel info={info} project={{ id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings,
      world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] }} plan={{ ...plan([]), names, tier: 2 }} send={() => {}} me="Ann" />);
    expect(html).toContain('Basic Circuit');
    expect(html).toContain('placeholder="Search items and fluids"');
    expect(html).toMatch(/<input[^>]*value="makeN"[^>]*checked=""|<input[^>]*checked=""[^>]*value="makeN"/);
    expect(html).toMatch(/value="64"/);
    expect(html).not.toContain('per minute');                         // Make N has no rate unit
    expect(html).toMatch(/<option value="2" selected="">MV<\/option>/);
    expect(html).toMatch(/<input[^>]*value="routed"[^>]*checked=""|<input[^>]*checked=""[^>]*value="routed"/);
    expect(html).toContain('Silver');
    expect(html).toContain('aria-label="Cost of Iron Plate"');
    expect(html).toContain('aria-label="Remove Iron Plate"');
    expect(html).toContain('aria-label="Remove Iron Ingot"');
    expect(html).toMatch(/<option value="2701" selected="">Kanthal \(2701 K\)<\/option>/);
    expect(html).toContain('Recycling');
    expect(html).not.toContain('Mass fabricator');                     // only the pack's own rules are listed
  });
  it('picks a tier or the world', () => {
    const html = renderToStaticMarkup(<TierPicker value={null} onChange={() => {}} />);
    expect(html).toMatch(/^<select[^>]*><option value="" selected="">From world \(LV until a world scan exists\)<\/option><option value="0">ULV<\/option><option value="1">LV<\/option>/);
    expect(html).toContain('<option value="14">MAX</option>');
  });
});

describe('steps vs raw material, supplies and pinned options', () => {
  const options = (html: string): string[] => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[3]}${m[2] === undefined ? '' : ' *'}`);
  const stepCharge = (html: string): string[] => options(/<select[^>]*aria-label="Steps vs raw material"[^>]*>.*?<\/select>/s.exec(html)?.[0] ?? '');
  it('lists the presets of the Steps vs raw material select and sends the one picked', () => {
    // Plan 12 fix wave 2 (the user's answer of 2026-10-20): Least raw material, Some machines, Fewest machines (the default).
    expect(STEP_CHARGE_PRESETS.map((p) => [p.value, p.label])).toEqual([[0, 'Least raw material'], [0.02, 'Some machines'], [0.5, 'Fewest machines']]);
    expect(stepCharge(panelOf({ ...defaultSettings(), stepCharge: 0.02 }))).toEqual([
      '0=Least raw material (0%)', '0.02=Some machines (2%) *', '0.5=Fewest machines (50%)']);
    const patch = vi.fn();
    const [select] = findAll(StepChargeField({ settings: defaultSettings(), patch }), (e) => e.type === 'select');
    (select!.props.onChange as (e: unknown) => void)({ currentTarget: { value: '0.02' } });
    expect(patch).toHaveBeenCalledWith({ stepCharge: 0.02 });
    expect(validateOp({ op: 'settings', patch: { stepCharge: 0.02 } })).toBeNull();
    (select!.props.onChange as (e: unknown) => void)({ currentTarget: { value: '0.5' } });   // the value it has: nothing to send
    expect(patch).toHaveBeenCalledTimes(1);
  });
  it('shows a stored value that is no preset as Custom', () => {
    // 5 % and 15 % were presets before fix wave 2; a project that chose one keeps it, now shown as its value.
    for (const charge of [0.05, 0.15, 0.07]) {
      expect(stepCharge(panelOf({ ...defaultSettings(), stepCharge: charge }))).toEqual([
        '0=Least raw material (0%)', '0.02=Some machines (2%)', '0.5=Fewest machines (50%)', `${charge}=Custom (${Math.round(charge * 100)}%) *`]);
    }
  });
  it('shows Fewest machines for a project without stepCharge', () => {
    const old = { ...defaultSettings() };
    delete old.stepCharge;
    expect(stepCharge(panelOf(old))).toContain('0.5=Fewest machines (50%) *');
  });
  it('lists the free inputs the group already supplies and removes one', () => {
    const settings = { ...defaultSettings(), haveSupply: ['fluid:water', 'minecraft:cobblestone@0'] };
    const names: Record<string, string> = { 'fluid:water': 'Water', 'minecraft:cobblestone@0': 'Cobblestone' };
    const html = panelOf(settings, { ...plan([]), names, tier: 1 } as Plan);
    expect(html).toContain('<h3>We already have a supply</h3>');
    expect(html).toContain('aria-label="Remove Cobblestone"');
    const patch = vi.fn();
    const section = HaveSupplySection({ settings, nameOf: (key) => names[key] ?? key, patch });
    (section.props.onRemove as (key: string) => void)('minecraft:cobblestone@0');
    expect(patch).toHaveBeenCalledWith({ haveSupply: ['fluid:water'] });
    expect(panelOf({ ...defaultSettings(), haveSupply: [] })).toContain('Nothing yet. “We already have a supply” on a generator step adds it here.');
  });
  it('lists the pinned ingredient options by step and removes one', () => {
    const settings = { ...defaultSettings(), optionChoice: { 'ca#100': 'fluid:molten.tin', 'gone#2': 't:x@0' } };
    const pinned = { ...plan([]), tier: 1, names: { 't:ec@0': 'Electronic Circuit', 'fluid:molten.tin': 'Molten Tin' },
      steps: [{ id: 'ca', recipeId: 'ca', machine: { mteId: 1180, name: 'Circuit Assembler', tier: 1 }, mainOutput: 't:ec@0' }] } as unknown as Plan;
    const html = panelOf(settings, pinned);
    expect(html).toContain('<h3>Pinned ingredient options</h3>');
    expect(html).toContain('Circuit Assembler (Electronic Circuit): Molten Tin');
    expect(html).toContain('recipe gone, slot 2: t:x@0');                      // a recipe this plan does not run
    const patch = vi.fn();
    const tree = OptionPinsSection({ settings, plan: pinned, nameOf: (key) => pinned.names?.[key] ?? key, patch });
    const [remove] = findAll(tree, (e) => e.type === 'button' && e.props['aria-label'] === 'Remove the pin of Molten Tin');
    (remove!.props.onClick as () => void)();
    expect(patch).toHaveBeenCalledWith({ optionChoice: { 'gone#2': 't:x@0' } });
  });
  it('labels the supporting-lines switch', () => {
    expect(panelOf(defaultSettings())).toContain('Plan supporting lines for alloys, plastics and chemicals (off: buy the shallow ones)');
  });
});

// "Reuse machines we have" and the "Machines we have" list (plan 09 Task 9; architecture §11.29, ruling P21).
describe('reusing machines we have', () => {
  const machines = [
    { mteId: 122, name: 'Advanced Assembler', tier: 2 }, { mteId: 121, name: 'Basic Assembler', tier: 1 },
    { mteId: 101, name: 'Basic Bending Machine', tier: 1 }, { mteId: 1000, name: 'Electric Blast Furnace' },
  ];
  const withMachines: PackInfo = { ...info, machines };
  const reuseInput = (html: string): string => /<input[^>]*name="reuseOwned"[^>]*>/.exec(html)?.[0] ?? '';
  /** The markup of the settings section titled `title`, from its heading to its end. */
  const sectionOf = (html: string, title: string): string => new RegExp(`<h3>${title}</h3>.*?</section>`, 's').exec(html)?.[0] ?? '';
  const optionsSection = (html: string): string => sectionOf(html, 'Options');

  it('shows the Reuse machines we have switch in the Options section, on by default, and sends the change', () => {
    const html = panelOf(defaultSettings());
    expect(optionsSection(html)).toMatch(/<input[^>]*name="reuseOwned"[^>]*>Reuse machines we have/);
    expect(reuseInput(html)).toContain('checked');
    expect(reuseInput(panelOf({ ...defaultSettings(), reuseOwned: false }))).not.toContain('checked');
    const old = { ...defaultSettings() };
    delete old.reuseOwned;
    expect(reuseInput(panelOf(old))).toContain('checked');                   // a project stored before the switch reuses
    const patch = vi.fn();
    const [input] = findAll(ReuseOwnedField({ settings: defaultSettings(), patch }), (e) => e.type === 'input');
    (input!.props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
    expect(patch).toHaveBeenCalledWith({ reuseOwned: false });
    expect(validateOp({ op: 'settings', patch: { reuseOwned: false } })).toBeNull();
  });
  it('lists the machines we have by name and tier', () => {
    const settings = { ...defaultSettings(), ownedManual: [{ mteId: 121, count: 2 }, { mteId: 1000, count: 1 }, { mteId: 999, count: 10_000 }] };
    const html = panelOf(settings, null, withMachines);
    expect(html).toContain('<h3>Machines we have</h3>');
    const rows = [...html.matchAll(/<li[^>]*data-owned-machine="(\d+)"[^>]*>.*?<span class="key-name"[^>]*>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([['121', '2× Basic Assembler (LV)'], ['1000', '1× Electric Blast Furnace'], ['999', '10,000× Machine #999']]);
    expect(html).toContain('aria-label="Remove Basic Assembler (LV)"');
    expect(sectionOf(panelOf(defaultSettings(), null, withMachines), 'Machines we have')).toContain('Nothing yet.');
    // Reuse off: the list is kept, and the section says it is not used.
    const off = sectionOf(panelOf({ ...settings, reuseOwned: false }, null, withMachines), 'Machines we have');
    expect(off).toContain('Reuse machines we have is off');
    expect(off).toContain('data-owned-machine="121"');
    expect(sectionOf(html, 'Machines we have')).not.toContain('Reuse machines we have is off');
  });
  it('offers every machine of the pack by tier, multiblocks last', () => {
    const html = panelOf(defaultSettings(), null, withMachines);
    const groups = [...html.matchAll(/<optgroup label="([^"]*)">(.*?)<\/optgroup>/g)].map((m) => [m[1], [...(m[2] ?? '').matchAll(/<option value="(\d+)">([^<]*)<\/option>/g)].map((o) => `${o[1]}=${o[2]}`)]);
    expect(groups).toEqual([
      ['LV', ['121=Basic Assembler (LV)', '101=Basic Bending Machine (LV)']], ['MV', ['122=Advanced Assembler (MV)']], ['Multiblocks', ['1000=Electric Blast Furnace']]]);
    expect(sectionOf(panelOf(defaultSettings(), null, null), 'Machines we have')).toContain('The pack is not loaded yet.');
  });
  it('adds machines (a listed one adds to its count) and removes one, sending the whole list', () => {
    const owned = [{ mteId: 121, count: 2 }, { mteId: 1000, count: 1 }];
    const onChange = vi.fn();
    const editor = OwnedMachinesEditor({ owned, machines, onChange });
    const removes = findAll(editor, (e) => e.type === 'button' && String(e.props['aria-label']).startsWith('Remove '));
    expect(removes.map((b) => b.props['aria-label'])).toEqual(['Remove Basic Assembler (LV)', 'Remove Electric Blast Furnace']);
    (removes[0]!.props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith([{ mteId: 1000, count: 1 }]);
    const [form] = findAll(editor, (e) => typeof e.props.onAdd === 'function');
    const add = form!.props.onAdd as (mteId: number, count: number) => string | null;
    expect(add(122, 4)).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([{ mteId: 121, count: 2 }, { mteId: 1000, count: 1 }, { mteId: 122, count: 4 }]);
    expect(add(121, 3)).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([{ mteId: 121, count: 5 }, { mteId: 1000, count: 1 }]);
    for (const call of onChange.mock.calls) expect(validateOp({ op: 'settings', patch: { ownedManual: call[0] } })).toBeNull();
  });
  it('words machines and keeps within what the server takes', () => {
    expect([ownedMachineLabel(machines[1], 121), ownedMachineLabel(machines[3], 1000), ownedMachineLabel(undefined, 7)])
      .toEqual(['Basic Assembler (LV)', 'Electric Blast Furnace', 'Machine #7']);
    expect(ownableMachineGroups(machines).map((g) => [g.label, g.machines.map((m) => m.mteId)])).toEqual([['LV', [121, 101]], ['MV', [122]], ['Multiblocks', [1000]]]);
    expect(parseOwnedCount(' 12 ')).toEqual({ count: 12 });
    expect(parseOwnedCount('10000')).toEqual({ count: 10_000 });
    for (const t of ['0', '1.5', '-2', '10001', '', 'two']) expect(parseOwnedCount(t), t).toEqual({ error: 'Enter a whole number from 1 to 10,000' });
    expect(ownedWith([{ mteId: 121, count: 9_999 }], 121, 5)).toEqual({ owned: [{ mteId: 121, count: 10_000 }] });
    expect(ownedWith([{ mteId: 121, count: 10_000 }], 121, 1)).toEqual({ error: 'The list already counts 10,000 of this machine' });
    const full = Array.from({ length: 200 }, (_, i) => ({ mteId: i, count: 1 }));
    expect(ownedWith(full, 500, 1)).toEqual({ error: 'The list holds at most 200 machine types; remove one first' });
    expect(ownedWith(full, 5, 1)).toEqual({ owned: full.map((e) => (e.mteId === 5 ? { mteId: 5, count: 2 } : e)) });
    expect(ownedWith([], 121, 0)).toEqual({ error: 'Enter a whole number from 1 to 10,000' });
    expect(ownedWithout([{ mteId: 121, count: 2 }, { mteId: 101, count: 1 }], 121)).toEqual([{ mteId: 101, count: 1 }]);
  });
});
