import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dimRows, dimOverridePatch, toggleList, parseAmount, groupDimRows, parseCost } from '../../src/client/views/settings-model.ts';
import { SettingsPanel } from '../../src/client/views/SettingsPanel.tsx';
import { TierPicker } from '../../src/client/components/TierPicker.tsx';
import { defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { PackInfo } from '../../src/shared/types/api.ts';
import type { Plan } from '../../src/shared/types/plan.ts';

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
