import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  dimRows, dimOverridePatch, toggleList, parseAmount, groupDimRows, parseCost, STEP_CHARGE_PRESETS, ownableMachineGroups, ownedMachineLabel, ownedWith,
  ownedWithout, parseOwnedCount, BUILD_HORIZON_PRESETS, horizonChoice, horizonPatch, buildTierOptions, buildTierPatch, MULTIBLOCK_CHOICES, multiblocksPatch,
  RAW_CAP_PRESETS, rawCapChoice, rawCapOf, rawCapPatch,
  inputsOnlyFromPlan, inputsOnlyPatch,
} from '../../src/client/views/settings-model.ts';
import {
  BuildHorizonField, BuildTierField, HaveSupplySection, InputsOnlySection, MultiblocksField, OptionPinsSection, RawCapField, ReuseOwnedField, SettingsPanel, StepChargeField,
} from '../../src/client/views/SettingsPanel.tsx';
import { ItemSearch } from '../../src/client/components/ItemSearch.tsx';
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

describe('machines vs raw material, supplies and pinned options', () => {
  const options = (html: string): string[] => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[3]}${m[2] === undefined ? '' : ' *'}`);
  // Ruling S17: the select is "Machines vs raw material" now, under "Plan for" (formerly "Steps vs raw material" in Options).
  const stepCharge = (html: string): string[] => options(/<select[^>]*aria-label="Machines vs raw material"[^>]*>.*?<\/select>/s.exec(html)?.[0] ?? '');
  it('lists the presets of the Machines vs raw material select and sends the one picked', () => {
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

// The build horizon (plan 12 Task 7, design spec §3.3), the tier new machines are built at and when a multiblock may be
// built (the user's ruling 224 of 2026-10-20), and no crafting switch any more (the user's ruling 180: crafting steps are
// automatic), in the Options section; the horizon is under "Plan for" beside "Machines vs raw material" since add-on 17,
// which made "Ignore build cost" the mode "Least raw material" (no horizon preset any more).
describe('build cost, machine tier and multiblocks', () => {
  const options = (html: string): string[] => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[3]}${m[2] === undefined ? '' : ' *'}`);
  const select = (html: string, label: string): string[] => options(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>.*?</select>`, 's').exec(html)?.[0] ?? '');
  const optionsSection = (html: string): string => /<h3>Options<\/h3>.*?<\/section>/s.exec(html)?.[0] ?? '';
  const planForSection = (html: string): string => /<legend class="settings-title">Plan for<\/legend>.*?<\/section>/s.exec(html)?.[0] ?? '';
  /** What picking `value` in the select of `field` sends. */
  const sendsOf = (field: (props: { settings: PlanSettings; plan?: Plan | null; patch: (p: Partial<PlanSettings>) => void }) => ReactElement,
    settings: PlanSettings, value: string, plan: Plan | null = null): unknown[] => {
    const patch = vi.fn();
    const [el] = findAll(field({ settings, plan, patch }), (e) => e.type === 'select');
    (el!.props.onChange as (e: unknown) => void)({ currentTarget: { value } });
    return patch.mock.calls.map((c) => c[0]);
  };

  it('offers the raw cap beside Machines vs raw material: at most +10, +25 or +50 %, or no limit (fix wave 3 (A))', () => {
    const label = 'Raw material for fewer machines';
    expect(RAW_CAP_PRESETS.map((p) => [p.value, p.cap, p.label])).toEqual([
      ['0.1', 0.1, 'At most +10 %'], ['0.25', 0.25, 'At most +25 %'], ['0.5', 0.5, 'At most +50 %'], ['off', null, 'No limit'],
    ]);
    expect(select(panelOf(defaultSettings()), label)).toEqual(['0.1=At most +10 %', '0.25=At most +25 % *', '0.5=At most +50 %', 'off=No limit']);
    const old = { ...defaultSettings() };
    delete old.rawCap;
    expect(rawCapOf(old)).toBe(0.25);
    expect(select(panelOf(old), label)).toContain('0.25=At most +25 % *');
    expect(select(panelOf({ ...defaultSettings(), rawCap: null }), label)).toContain('off=No limit *');
    expect(rawCapChoice(0.3)).toEqual({ value: 'custom', label: 'At most +30 %' });
    expect(select(panelOf({ ...defaultSettings(), rawCap: 0.3 }), label)).toEqual([
      '0.1=At most +10 %', '0.25=At most +25 %', '0.5=At most +50 %', 'off=No limit', 'custom=At most +30 % *']);
    expect(sendsOf(RawCapField, defaultSettings(), 'off')).toEqual([{ rawCap: null }]);
    expect(sendsOf(RawCapField, defaultSettings(), '0.5')).toEqual([{ rawCap: 0.5 }]);
    expect(sendsOf(RawCapField, defaultSettings(), '0.25')).toEqual([]);                                // the value it has
    expect(sendsOf(RawCapField, { ...defaultSettings(), rawCap: 0.3 }, 'custom')).toEqual([]);
    expect([rawCapPatch('0.1'), rawCapPatch('off'), rawCapPatch('custom')]).toEqual([{ rawCap: 0.1 }, { rawCap: null }, {}]);
    for (const patch of [rawCapPatch('0.1'), rawCapPatch('off')]) expect(validateOp({ op: 'settings', patch })).toBeNull();
    // Since add-on 17 the step charge and the horizon are under "Plan for" (the horizon above the step charge), and the
    // raw cap with them, right after the step charge.
    const planFor = planForSection(panelOf(defaultSettings()));
    expect(planFor.indexOf(label)).toBeGreaterThan(planFor.indexOf('Machines vs raw material'));
    expect(planFor.indexOf(label)).toBeGreaterThan(planFor.indexOf('Count build cost against'));
    expect(planFor.indexOf('Count build cost against')).toBeGreaterThan(-1);
    expect(optionsSection(panelOf(defaultSettings()))).not.toContain(label);
    expect(planFor).toContain('Fewer machines never cost more raw material than this over the leanest line (what Least raw material plans).');
    expect(planForSection(panelOf({ ...defaultSettings(), buildHorizonHours: null })))
      .toContain('With build cost ignored the plan stays within 25 % of the least raw material instead.');
  });
  it('shows 24 hours for a project without buildHorizonHours', () => {
    expect(BUILD_HORIZON_PRESETS.map((p) => [p.value, p.hours, p.label])).toEqual([
      ['1', 1, '1 hour'], ['8', 8, '8 hours'], ['24', 24, '24 hours'], ['168', 168, '1 week']]);
    expect(horizonChoice(undefined)).toEqual({ value: '24', label: '24 hours' });
    const old = { ...defaultSettings() };
    delete old.buildHorizonHours;
    expect(select(panelOf(old), 'Count build cost against')).toEqual(['1=1 hour', '8=8 hours', '24=24 hours *', '168=1 week']);
    expect(planForSection(panelOf(old))).toContain('Count build cost against');
  });
  it('sends the horizon picked: a week', () => {
    expect(sendsOf(BuildHorizonField, defaultSettings(), '168')).toEqual([{ buildHorizonHours: 168 }]);
    expect(sendsOf(BuildHorizonField, defaultSettings(), 'none')).toEqual([]);                   // no preset any more: least raw material is a mode
    expect(sendsOf(BuildHorizonField, defaultSettings(), '24')).toEqual([]);                     // the value it has: nothing to send
    expect(horizonPatch('1')).toEqual({ buildHorizonHours: 1 });
    expect(horizonPatch('none')).toEqual({});
    for (const patch of [horizonPatch('168'), horizonPatch('8')]) expect(validateOp({ op: 'settings', patch })).toBeNull();
    // A running line without a horizon plans least raw material, which counts no build cost: no select.
    expect(panelOf({ ...defaultSettings(), buildHorizonHours: null })).not.toContain('aria-label="Count build cost against"');
  });
  it('shows a stored horizon that is no preset as Custom', () => {
    expect(horizonChoice(48)).toEqual({ value: 'custom', label: 'Custom (48 h)' });
    expect(horizonChoice(168)).toEqual({ value: '168', label: '1 week' });
    expect(horizonChoice(null)).toEqual({ value: '24', label: '24 hours' });
    expect(select(panelOf({ ...defaultSettings(), buildHorizonHours: 48 }), 'Count build cost against')).toEqual([
      '1=1 hour', '8=8 hours', '24=24 hours', '168=1 week', 'custom=Custom (48 h) *']);
    expect(sendsOf(BuildHorizonField, { ...defaultSettings(), buildHorizonHours: 48 }, 'custom')).toEqual([]);
  });
  it('says in Make N that the batch carries the build cost, with no select', () => {
    const html = panelOf({ ...defaultSettings(), mode: 'makeN', amount: 64 });
    expect(html).not.toContain('aria-label="Count build cost against"');
    expect(planForSection(html)).toContain('Make N counts the build cost of new machines against the batch itself.');
    expect(panelOf(defaultSettings())).not.toContain('Make N counts the build cost');
  });

  it('offers the cheapest tier and every tier from LV up to the project tier for new machines', () => {
    expect(buildTierOptions(2, null)).toEqual([{ value: '', label: 'Cheapest tier' }, { value: '1', label: 'LV' }, { value: '2', label: 'MV' }]);
    expect(select(panelOf({ ...defaultSettings(), tier: 2 }), 'Build machines at')).toEqual(['=Cheapest tier *', '1=LV', '2=MV']);
    // The project's tier from the world: the plan's.
    expect(select(panelOf(defaultSettings(), { ...plan([]), tier: 3 } as Plan), 'Build machines at')).toEqual(['=Cheapest tier *', '1=LV', '2=MV', '3=HV']);
    expect(select(panelOf({ ...defaultSettings(), tier: 2, buildTier: 2 }), 'Build machines at')).toEqual(['=Cheapest tier', '1=LV', '2=MV *']);
    // A stored tier above the project's (the tier was lowered since): kept and said so.
    expect(select(panelOf({ ...defaultSettings(), tier: 2, buildTier: 4 }), 'Build machines at'))
      .toEqual(['=Cheapest tier', '1=LV', '2=MV', '4=EV (above the project’s tier) *']);
    const old = { ...defaultSettings(), tier: 1 };
    delete old.buildTier;
    expect(select(panelOf(old), 'Build machines at')).toEqual(['=Cheapest tier *', '1=LV']);
    expect(optionsSection(panelOf(defaultSettings()))).toContain('Build machines at');
  });
  it('waits for the plan to list the tiers when the project tier comes from the world (the controller\'s ruling after Task 7, (b))', () => {
    // An auto tier (null) with no plan yet (loading, or none) is not LV: the select offers the cheapest tier and the stored
    // tier, plainly, until the plan says the project's tier.
    expect(buildTierOptions(null, null)).toEqual([{ value: '', label: 'Cheapest tier' }]);
    expect(buildTierOptions(null, 2)).toEqual([{ value: '', label: 'Cheapest tier' }, { value: '2', label: 'MV' }]);
    expect(select(panelOf(defaultSettings()), 'Build machines at')).toEqual(['=Cheapest tier *']);
    expect(select(panelOf({ ...defaultSettings(), buildTier: 2 }), 'Build machines at')).toEqual(['=Cheapest tier', '2=MV *']);
    expect(select(panelOf({ ...defaultSettings(), buildTier: 2 }, { ...plan([]), tier: 3 } as Plan), 'Build machines at'))
      .toEqual(['=Cheapest tier', '1=LV', '2=MV *', '3=HV']);
    expect(sendsOf(BuildTierField, { ...defaultSettings(), buildTier: 2 }, '')).toEqual([{ buildTier: null }]);
  });
  it('sends the tier picked for new machines, or the cheapest', () => {
    const mv = { ...defaultSettings(), tier: 2 };
    expect(sendsOf(BuildTierField, mv, '2')).toEqual([{ buildTier: 2 }]);
    expect(sendsOf(BuildTierField, { ...mv, buildTier: 2 }, '')).toEqual([{ buildTier: null }]);
    expect(sendsOf(BuildTierField, mv, '')).toEqual([]);
    expect([buildTierPatch('1'), buildTierPatch(''), buildTierPatch('x')]).toEqual([{ buildTier: 1 }, { buildTier: null }, null]);
    for (const patch of [{ buildTier: 2 }, { buildTier: null }]) expect(validateOp({ op: 'settings', patch })).toBeNull();
  });
  it('lets the group keep new multiblocks to what nothing else can do', () => {
    expect(MULTIBLOCK_CHOICES.map((c) => [c.value, c.label])).toEqual([['allow', 'Use when cheaper'], ['only-required', 'Only when nothing else can do it']]);
    expect(select(panelOf(defaultSettings()), 'Multiblocks')).toEqual(['allow=Use when cheaper *', 'only-required=Only when nothing else can do it']);
    const old = { ...defaultSettings() };
    delete old.multiblocks;
    expect(select(panelOf(old), 'Multiblocks')).toEqual(['allow=Use when cheaper *', 'only-required=Only when nothing else can do it']);
    expect(select(panelOf({ ...defaultSettings(), multiblocks: 'only-required' }), 'Multiblocks')).toContain('only-required=Only when nothing else can do it *');
    expect(sendsOf(MultiblocksField, defaultSettings(), 'only-required')).toEqual([{ multiblocks: 'only-required' }]);
    expect(sendsOf(MultiblocksField, defaultSettings(), 'allow')).toEqual([]);
    expect([multiblocksPatch('allow'), multiblocksPatch('other')]).toEqual([{ multiblocks: 'allow' }, null]);
    expect(validateOp({ op: 'settings', patch: { multiblocks: 'only-required' } })).toBeNull();
    expect(optionsSection(panelOf(defaultSettings()))).toContain('Multiblocks');
  });
  it('says what "Only when nothing else can do it" does with build cost ignored (the controller\'s ruling after Task 7, (c))', () => {
    const hint = 'With build cost ignored, a recipe only a multiblock runs is weighed by its raw material alone.';
    const onlyRequired: PlanSettings = { ...defaultSettings(), multiblocks: 'only-required' };
    expect(optionsSection(panelOf({ ...onlyRequired, buildHorizonHours: null }))).toContain(hint);
    // not with build cost counted (the default horizon), not where multiblocks are used when cheaper, not in Make N
    expect(optionsSection(panelOf(onlyRequired))).not.toContain(hint);
    expect(optionsSection(panelOf({ ...defaultSettings(), buildHorizonHours: null }))).not.toContain(hint);
    expect(optionsSection(panelOf({ ...onlyRequired, buildHorizonHours: null, mode: 'makeN', amount: 64 }))).not.toContain(hint);
  });
  it('has no switch for crafting-table steps: they run on an Auto Workbench', () => {
    // The user's ruling 180 (a): no control replaces the old checkbox, whatever a stored project held.
    for (const automateCrafting of [true, false]) {
      const options = optionsSection(panelOf({ ...defaultSettings(), automateCrafting }));
      expect(options).not.toContain('Crafting-table steps are automated');
      expect(options).not.toMatch(/crafting/i);
      expect(options.match(/type="checkbox"/g)).toHaveLength(2);   // supporting lines, reuse machines we have
    }
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

// The page that draws the panel also draws the Settings button of the head, which says what the project makes in the panel's own words,
// so the page keeps the names of what was picked in the search boxes and hands them to the panel (`usePickedNames`).
describe('the settings panel and the names a page hands it', () => {
  const settings = { ...defaultSettings(), target: 't:circuit@0' };
  const project = { id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings, world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
  const names = { nameOf: (key: string) => (key === 't:circuit@0' ? 'Basic Circuit (the page names it)' : key), remember: () => {} };

  it('names the target with the names it is given, where its own would have only the key', () => {
    // no plan has named the key yet, and nothing was picked in this panel: it falls back to the key
    expect(panelOf(settings)).toContain('<span class="settings-target-name">t:circuit@0</span>');
    const html = renderToStaticMarkup(<SettingsPanel info={info} project={project} plan={null} send={() => {}} me="Ann" names={names} />);
    expect(html).toContain('<span class="settings-target-name">Basic Circuit (the page names it)</span>');
    expect(html).not.toContain('t:circuit@0</span>');
  });

  it('keeps the plan\'s names first when it keeps its own', () => {
    const html = renderToStaticMarkup(<SettingsPanel info={info} project={project} plan={{ ...plan([]), names: { 't:circuit@0': 'Basic Circuit' }, tier: 1 }} send={() => {}} me="Ann" />);
    expect(html).toContain('<span class="settings-target-name">Basic Circuit</span>');
  });
});

describe('only these come in (fix wave 3 (B))', () => {
  it('takes the plan’s raw inputs as the list: free inputs left out, once each, sorted, at most 50', () => {
    const raw = (keys: string[]): Pick<Plan, 'rawInputs'> => ({ rawInputs: keys.map((key) => ({ key })) } as unknown as Pick<Plan, 'rawInputs'>);
    expect(inputsOnlyFromPlan(raw(['t:b@0', 'fluid:water', 't:a@0', 'minecraft:cobblestone@0', 't:b@0']))).toEqual(['t:a@0', 't:b@0']);
    const many = Array.from({ length: 60 }, (_, i) => `t:k${String(i).padStart(2, '0')}@0`);
    expect(inputsOnlyFromPlan(raw(many))).toEqual(many.slice(0, 50));
  });

  it('adds and removes one key, never past 50', () => {
    const s = { ...defaultSettings(), inputsOnly: ['t:b@0'] };
    expect(inputsOnlyPatch(s, 't:a@0', true)).toEqual({ inputsOnly: ['t:a@0', 't:b@0'] });
    expect(inputsOnlyPatch(s, 't:b@0', false)).toEqual({ inputsOnly: [] });
    const full = { ...defaultSettings(), inputsOnly: Array.from({ length: 50 }, (_, i) => `t:k${i}@0`) };
    expect(inputsOnlyPatch(full, 't:new@0', true)).toBeNull();
    expect(inputsOnlyPatch(full, 't:k3@0', true)).toEqual({ inputsOnly: [...full.inputsOnly].sort() });
    expect(validateOp({ op: 'settings', patch: inputsOnlyPatch(s, 't:a@0', true) })).toBeNull();
  });

  it('shows "Only these come in" with a chip per key, a search, "Use this plan’s raw inputs" and "Clear"', () => {
    const p = { ...plan([]), tier: 1, rawInputs: [{ key: 't:a@0' }, { key: 'fluid:water' }, { key: 't:b@0' }],
      names: { 't:a@0': 'Alpha', 't:b@0': 'Beta' } } as unknown as Plan;
    const listed = { ...defaultSettings(), inputsOnly: ['t:a@0'] };
    const html = panelOf(listed, p);
    expect(html).toContain('<h3>Only these come in</h3>');
    expect(html).toContain('aria-label="Remove Alpha"');
    const patch = vi.fn();
    const remember = vi.fn();
    const tree = InputsOnlySection({ settings: listed, plan: p, nameOf: (k) => p.names?.[k] ?? k, patch, remember });
    const button = (label: string): ReactElement<Record<string, unknown>> =>
      findAll(tree, (e) => e.type === 'button' && (e.props.children === label || e.props['aria-label'] === label))[0]!;
    (button("Use this plan's raw inputs").props.onClick as () => void)();
    (button('Clear').props.onClick as () => void)();
    (button('Remove Alpha').props.onClick as () => void)();
    const [search] = findAll(tree, (e) => e.type === ItemSearch);
    (search!.props.onPick as (hit: { key: string; name: string }) => void)({ key: 't:c@0', name: 'Gamma' });
    expect(remember).toHaveBeenCalledWith({ key: 't:c@0', name: 'Gamma' });
    expect(patch.mock.calls.map((c) => c[0])).toEqual([
      { inputsOnly: ['t:a@0', 't:b@0'] }, { inputsOnly: [] }, { inputsOnly: [] }, { inputsOnly: ['t:a@0', 't:c@0'] },
    ]);
    const off = panelOf(defaultSettings(), null);
    expect(off).toContain('Off: the line buys whatever the planner picks.');
    expect(off).not.toContain('>Clear<');
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*>Use this plan&#x27;s raw inputs<\/button>/);
  });
});
