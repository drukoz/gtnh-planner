import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dimRows, dimOverridePatch, toggleList, parseAmount, groupDimRows, parseCost, STEP_CHARGE_PRESETS } from '../../src/client/views/settings-model.ts';
import { HaveSupplySection, OptionPinsSection, SettingsPanel, StepChargeField } from '../../src/client/views/SettingsPanel.tsx';
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

const panelOf = (settings: PlanSettings, p: Plan | null = null): string => renderToStaticMarkup(<SettingsPanel info={info} project={{ id: 'p', name: 'x', createdAt: '',
  createdBy: '', rev: 0, settings, world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] }} plan={p} send={() => {}} me="Ann" />);

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
    for (const s of ['Make', 'Make N (batch)', 'Tier', 'Reachable dimensions', 'Logistics', 'Material costs', 'Skip recipe groups', 'We already make', 'Lava and stone-dust centrifuging'])
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
    expect(STEP_CHARGE_PRESETS.map((p) => [p.value, p.label])).toEqual([[0, 'Least raw material'], [0.02, 'Some steps'], [0.05, 'Balanced'], [0.15, 'Fewest machines']]);
    expect(stepCharge(panelOf({ ...defaultSettings(), stepCharge: 0.05 }))).toEqual([
      '0=Least raw material (0%)', '0.02=Some steps (2%)', '0.05=Balanced (5%) *', '0.15=Fewest machines (15%)']);
    const patch = vi.fn();
    const [select] = findAll(StepChargeField({ settings: defaultSettings(), patch }), (e) => e.type === 'select');
    (select!.props.onChange as (e: unknown) => void)({ currentTarget: { value: '0.15' } });
    expect(patch).toHaveBeenCalledWith({ stepCharge: 0.15 });
    expect(validateOp({ op: 'settings', patch: { stepCharge: 0.15 } })).toBeNull();
    (select!.props.onChange as (e: unknown) => void)({ currentTarget: { value: '0.02' } });   // the value it has: nothing to send
    expect(patch).toHaveBeenCalledTimes(1);
  });
  it('shows a stored value that is no preset as Custom', () => {
    expect(stepCharge(panelOf({ ...defaultSettings(), stepCharge: 0.07 }))).toEqual([
      '0=Least raw material (0%)', '0.02=Some steps (2%)', '0.05=Balanced (5%)', '0.15=Fewest machines (15%)', '0.07=Custom (7%) *']);
  });
  it('shows Some steps for a project without stepCharge', () => {
    const old = { ...defaultSettings() };
    delete old.stepCharge;
    expect(stepCharge(panelOf(old))).toContain('0.02=Some steps (2%) *');
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
