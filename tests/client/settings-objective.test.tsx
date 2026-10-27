// "Plan for", "Machines vs raw material" beside it, the farm settings and "Use other projects' surplus" in the settings
// panel (add-on 17 Task 9; design spec §3.3, architecture §11.45 (1), (2), (4); rulings R10, S17, S20).

import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BUILD_HORIZON_PRESETS, OBJECTIVE_CHOICES, farmTierOptions, farmsOf, farmsPatch, horizonChoice, objectivePatch, parsePerMinute, parseStat, planningMode,
  runningFarmRows, runningFarmWith, runningFarmWithout,
} from '../../src/client/views/settings-model.ts';
import {
  CropFarmFields, FarmsSection, PlanForSection, SettingsPanel, StatInput, SurplusSection, TreeFarmFields,
} from '../../src/client/views/SettingsPanel.tsx';
import { applyOp, defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { PackInfo } from '../../src/shared/types/api.ts';
import { defaultFarmSettings } from '../../src/shared/types/farm.ts';
import { PLAN_OBJECTIVES, type Plan, type PlanSettings } from '../../src/shared/types/plan.ts';
import type { Project } from '../../src/shared/types/project.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

/** The text inside an unrendered element. */
function childText(e: ReactElement<Record<string, unknown>>): string {
  const walk = (n: ReactNode): string => {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(walk).join('');
    return isValidElement<Record<string, unknown>>(n) ? walk(n.props.children as ReactNode) : '';
  };
  return walk(e.props.children as ReactNode);
}

/** The input inside the label that reads `label`. */
function inputLabelled(tree: ReactNode, label: string): ReactElement<Record<string, unknown>> {
  const [found] = findAll(tree, (e) => e.type === 'label' && childText(e).trim() === label);
  const [input] = findAll(found?.props.children as ReactNode, (e) => e.type === 'input');
  expect(input, label).toBeDefined();
  return input!;
}

const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), ...p });
const project = (settings: PlanSettings): Project => ({
  id: 'p', name: 'x', createdAt: '', createdBy: '', rev: 0, settings, world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [],
});
const infoWith = (counts: Record<string, number>): PackInfo => ({
  manifest: { counts } as never, mapCount: 1, recipeCount: 1, itemCount: 1, exclusionRules: [], dimensions: [], capabilities: [],
});
const CROPS = infoWith({ items: 10, crops: 179 });
const panelOf = (settings: PlanSettings, info: PackInfo | null = CROPS, plan: Plan | null = null): string =>
  renderToStaticMarkup(<SettingsPanel info={info} project={project(settings)} plan={plan} send={() => {}} me="Ann" />);
/** The markup of the settings section titled `title` (an h3, or the "Plan for" legend), from its title to its end. */
const sectionOf = (html: string, title: string): string =>
  new RegExp(`<(h3|legend)[^>]*>${title}</(h3|legend)>.*?</section>`, 's').exec(html)?.[0] ?? '';
const options = (html: string): string[] =>
  [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[3]}${m[2] === undefined ? '' : ' *'}`);
const select = (html: string, label: string): string[] => options(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>.*?</select>`, 's').exec(html)?.[0] ?? '');
const radio = (html: string, value: string): string => new RegExp(`<input[^>]*type="radio"[^>]*value="${value}"[^>]*>`).exec(html)?.[0] ?? '';

describe('Plan for', () => {
  it('offers the three planning modes in order, with their words', () => {
    expect(OBJECTIVE_CHOICES.map((c) => c.value)).toEqual([...PLAN_OBJECTIVES]);
    expect(OBJECTIVE_CHOICES.map((c) => [c.label, c.hint])).toEqual([
      ['Least raw material', 'Raw material per item while the line runs; machines are not counted'],
      ['Cheapest', 'Raw material over the horizon plus the machines you do not have yet'],
      ['Best multi-output', 'As few different raw materials as possible: farms and byproducts first, then the cheapest'],
    ]);
  });

  it('gives cheapest and best multi-output a horizon when the project has none', () => {
    expect(objectivePatch('multi-output', S({ objective: 'least-raw', buildHorizonHours: null }))).toEqual({ objective: 'multi-output', buildHorizonHours: 24 });
    expect(objectivePatch('cheapest', S({ objective: 'least-raw', buildHorizonHours: null }))).toEqual({ objective: 'cheapest', buildHorizonHours: 24 });
    expect(objectivePatch('least-raw', S({ buildHorizonHours: null }))).toEqual({ objective: 'least-raw' });
    expect(objectivePatch('least-raw', S())).toEqual({ objective: 'least-raw' });
    expect(objectivePatch('multi-output', S({ buildHorizonHours: 8 }))).toEqual({ objective: 'multi-output' });
    for (const value of PLAN_OBJECTIVES) expect(validateOp({ op: 'settings', patch: objectivePatch(value, S({ buildHorizonHours: null })) })).toBeNull();
  });

  it('reads the mode as the planner does: a running line with no horizon plans least raw material', () => {
    expect(planningMode(S())).toBe('cheapest');
    expect(planningMode(S({ objective: 'multi-output' }))).toBe('multi-output');
    expect(planningMode(S({ objective: 'cheapest', buildHorizonHours: null }))).toBe('least-raw');
    expect(planningMode(S({ objective: 'cheapest', buildHorizonHours: null, mode: 'makeN' }))).toBe('cheapest');
    const old = S();
    delete old.objective;
    expect(planningMode(old)).toBe('cheapest');
  });

  it('has no "Ignore build cost" horizon any more: Least raw material is that mode', () => {
    expect(BUILD_HORIZON_PRESETS.map((p) => p.value)).not.toContain('none');
    expect(BUILD_HORIZON_PRESETS.map((p) => [p.value, p.hours, p.label])).toEqual([['1', 1, '1 hour'], ['8', 8, '8 hours'], ['24', 24, '24 hours'], ['168', 168, '1 week']]);
    expect(horizonChoice(null)).toEqual({ value: '24', label: '24 hours' });
  });

  it('checks the project\'s mode first under Make, with the horizon and the machine weight below it', () => {
    const html = panelOf(S({ objective: 'cheapest' }));
    expect(radio(html, 'cheapest')).toContain('checked=""');
    expect(radio(html, 'least-raw')).not.toContain('checked');
    expect(select(html, 'Count build cost against')).toContain('24=24 hours *');
    const planFor = sectionOf(html, 'Plan for');
    for (const label of ['Least raw material', 'Cheapest', 'Best multi-output', 'Count build cost against', 'Machines vs raw material']) expect(planFor).toContain(label);
    expect(text(planFor)).toContain('Raw material over the horizon plus the machines you do not have yet');
    // First under Make: before the tier, and the machine weight is no longer in Options.
    expect(html.indexOf('>Plan for<')).toBeGreaterThan(html.indexOf('<h3>Make</h3>'));
    expect(html.indexOf('>Plan for<')).toBeLessThan(html.indexOf('>Tier<'));
    expect(sectionOf(html, 'Options')).not.toContain('Machines vs raw material');
    expect(sectionOf(html, 'Options')).not.toContain('Count build cost against');
  });

  it('sends least raw material when picked, and then shows no horizon', () => {
    const settings = S({ objective: 'cheapest' });
    const send = vi.fn();
    const tree = PlanForSection({ settings, send });
    const [least] = findAll(tree, (e) => e.type === 'input' && e.props.type === 'radio' && e.props.value === 'least-raw');
    (least!.props.onChange as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { objective: 'least-raw' } }]);
    const after = applyOp(project(settings), send.mock.calls[0]![0][0], 'Ann', 'now').settings;
    const html = panelOf(after);
    expect(radio(html, 'least-raw')).toContain('checked=""');
    expect(html).not.toContain('aria-label="Count build cost against"');
    expect(sectionOf(html, 'Plan for')).toContain('Machines vs raw material');   // shown wherever the old select was (S17)
  });

  it('sends best multi-output with a horizon for a project that had none', () => {
    const send = vi.fn();
    const tree = PlanForSection({ settings: S({ objective: 'least-raw', buildHorizonHours: null }), send });
    const [multi] = findAll(tree, (e) => e.type === 'input' && e.props.type === 'radio' && e.props.value === 'multi-output');
    (multi!.props.onChange as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { objective: 'multi-output', buildHorizonHours: 24 } }]);
  });

  it('says in Make N that the batch carries the build cost of the modes that count it', () => {
    const batch = panelOf(S({ mode: 'makeN', amount: 64 }));
    expect(batch).not.toContain('aria-label="Count build cost against"');
    expect(sectionOf(batch, 'Plan for')).toContain('Make N counts the build cost of new machines against the batch itself.');
    expect(sectionOf(panelOf(S({ mode: 'makeN', amount: 64, objective: 'least-raw' })), 'Plan for')).not.toContain('Make N counts the build cost');
  });

  it('words the machine weight for the mode it weighs in', () => {
    const hint = (settings: PlanSettings): string => text(sectionOf(panelOf(settings), 'Plan for'));
    expect(hint(S())).toContain('Each new machine costs this share of the line\'s least raw material over the horizon, on top of its build.');
    expect(hint(S({ objective: 'least-raw' }))).toContain('A recipe step is built only when it saves this share of the line\'s least raw material.');
  });
});

describe('farm settings', () => {
  it('reads and patches the farm settings whole', () => {
    expect(farmsOf(S())).toEqual(defaultFarmSettings());
    const old = S();
    delete old.farms;
    expect(farmsOf(old)).toEqual(defaultFarmSettings());
    expect(farmsPatch(S(), (f) => ({ ...f, kinds: ['tgs'] }))).toEqual({ farms: { ...defaultFarmSettings(), kinds: ['tgs'] } });
  });

  it('turns a farm kind on and off, keeping the other settings', () => {
    const html = panelOf(S());
    expect(sectionOf(html, 'Farms')).toMatch(/<input[^>]*name="farm-tgs"[^>]*checked=""[^>]*>Tree Growth Simulator/);
    expect(sectionOf(html, 'Farms')).toMatch(/<input[^>]*name="farm-crop-manager"[^>]*checked=""[^>]*>CropsNH Crop Manager/);
    const patch = vi.fn();
    const tree = FarmsSection({ info: CROPS, settings: S(), plan: null, patch });
    (inputLabelled(tree, 'Tree Growth Simulator').props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
    expect(patch).toHaveBeenLastCalledWith({ farms: { ...defaultFarmSettings(), kinds: ['crop-manager'] } });
    const tgsOff = S({ farms: { ...defaultFarmSettings(), kinds: ['crop-manager'] } });
    (inputLabelled(FarmsSection({ info: CROPS, settings: tgsOff, plan: null, patch }), 'Tree Growth Simulator').props.onChange as (e: unknown) => void)(
      { currentTarget: { checked: true } });
    expect(patch).toHaveBeenLastCalledWith({ farms: defaultFarmSettings() });   // back in its place, before the Crop Manager
    const off = sectionOf(panelOf(tgsOff), 'Farms');
    expect(off).not.toContain('Knife (fruit)');                                // a kind that is off hides its fields
    expect(off).toContain('aria-label="Layers"');
  });

  it('sends the farm settings with the knife taken out of the input bus, everything else as before', () => {
    const patch = vi.fn();
    const tree = TreeFarmFields({ settings: S(), projectTier: 3, patch });
    (inputLabelled(tree, 'Knife (fruit)').props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
    const d = defaultFarmSettings();
    expect(patch).toHaveBeenCalledWith({ farms: { ...d, tgs: { ...d.tgs, tools: { ...d.tgs.tools, fruit: false } } } });
    expect(validateOp({ op: 'settings', patch: patch.mock.calls[0]![0] })).toBeNull();
    for (const label of ['Saw (logs)', 'Branch Cutter (saplings)', 'Wire Cutter (leaves, ×2)', 'Knife (fruit)']) inputLabelled(tree, label);
    expect(inputLabelled(tree, 'Saw (logs)').props.checked).toBe(true);
    expect(inputLabelled(tree, 'Branch Cutter (saplings)').props.checked).toBe(false);
  });

  it('offers the energy hatch, the tool material and the Crop Manager from LV up to the project tier', () => {
    expect(farmTierOptions(3, 1, 14)).toEqual([{ value: '1', label: 'LV' }, { value: '2', label: 'MV' }, { value: '3', label: 'HV' }]);
    expect(farmTierOptions(14, 1, 12).at(-1)).toEqual({ value: '12', label: 'UMV' });     // Crop Managers stop at UMV
    expect(farmTierOptions(2, 4, 14)).toEqual([{ value: '1', label: 'LV' }, { value: '2', label: 'MV' }, { value: '4', label: 'EV (above the project’s tier)' }]);
    expect(farmTierOptions(null, 2, 14)).toEqual([{ value: '2', label: 'MV' }]);           // an auto tier before the plan says it
    const html = panelOf(S({ tier: 2 }));
    expect(select(html, 'Energy hatch')).toEqual(['1=LV *', '2=MV']);
    expect(select(html, 'Crop Manager voltage')).toEqual(['1=LV *', '2=MV']);
    expect(select(html, 'Tool material')).toContain('Steel=Steel *');
    expect(select(html, 'Tool material')).toHaveLength(13);
    expect(select(panelOf(S(), CROPS, { tier: 3 } as Plan), 'Energy hatch')).toEqual(['1=LV *', '2=MV', '3=HV']);   // the world's tier, from the plan
    const patch = vi.fn();
    const [hatch] = findAll(TreeFarmFields({ settings: S({ tier: 2 }), projectTier: 2, patch }), (e) => e.type === 'select' && e.props['aria-label'] === 'Energy hatch');
    (hatch!.props.onChange as (e: unknown) => void)({ currentTarget: { value: '2' } });
    expect(patch.mock.calls[0]![0].farms.tgs).toEqual({ ...defaultFarmSettings().tgs, tier: 2 });
  });

  it('takes crop seed stats from 1 to 31 and says so for anything else, sending nothing', () => {
    expect([parseStat('1'), parseStat(' 31 '), parseStat('5')]).toEqual([{ value: 1 }, { value: 31 }, { value: 5 }]);
    for (const t of ['32', '0', '2.5', '', 'ten', '-3', '1e1']) expect(parseStat(t), t).toEqual({ error: 'Enter a whole number from 1 to 31' });
    const onValue = vi.fn();
    const props = { label: 'Growth', value: 1, draft: '32', onDraft: () => {}, onValue };
    expect(text(renderToStaticMarkup(<StatInput {...props} />))).toContain('Enter a whole number from 1 to 31');
    const [input] = findAll(StatInput(props), (e) => e.type === 'input');
    (input!.props.onBlur as (e: unknown) => void)({ currentTarget: { value: '32' } });
    // a key of its own, not a held Enter's repeat a guard has prevented (ledger ruling P2-R76: the field reads the native event's state)
    (input!.props.onKeyDown as (e: unknown) => void)({ key: 'Enter', currentTarget: { value: '32' }, nativeEvent: { defaultPrevented: false } });
    expect(onValue).not.toHaveBeenCalled();
    (input!.props.onBlur as (e: unknown) => void)({ currentTarget: { value: '12' } });
    expect(onValue).toHaveBeenCalledWith(12);
    // The Crop Manager's fields send the stat in the farm settings, the others as they were.
    const patch = vi.fn();
    const [growth] = findAll(CropFarmFields({ settings: S(), projectTier: 1, patch }), (e) => e.props.label === 'Growth');
    (growth!.props.onValue as (v: number) => void)(12);
    const d = defaultFarmSettings();
    expect(patch).toHaveBeenCalledWith({ farms: { ...d, crops: { ...d.crops, stats: { ...d.crops.stats, growth: 12 } } } });
  });

  it('offers one to three layers of crop sticks, and says what more than one means', () => {
    const html = panelOf(S());
    expect(select(html, 'Layers')).toEqual(['1=1 *', '2=2', '3=3']);
    expect(text(html)).toContain('Only the top layer sees the sky; with more than one, every layer is planned without it');
    expect(select(html, 'Liked biome tags')).toEqual(['0=0 *', '1=1', '2=2']);
    expect(select(html, 'Fertilizer')).toEqual(['none=None *', 'fertilizer=Fertilizer', 'bone-meal=Bone Meal']);
    expect(sectionOf(html, 'Farms')).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*>Open sky|<input[^>]*checked=""[^>]*type="checkbox"[^>]*>Open sky/);
    for (const label of ['Growth', 'Gain', 'Resistance']) expect(html).toContain(`aria-label="${label}"`);
  });

  it('says crop farms need a newer export only while the active export has no crop table', () => {
    const message = 'Crop farms need the crop table of a newer recipe export (exporter 0.5.1 or later)';
    expect(text(sectionOf(panelOf(S(), infoWith({ items: 10 })), 'Farms'))).toContain(message);
    expect(text(sectionOf(panelOf(S(), infoWith({ items: 10, crops: 0 })), 'Farms'))).toContain(message);   // an empty table offers no crop (R10)
    expect(panelOf(S(), infoWith({ items: 10 }))).not.toContain('aria-label="Layers"');
    expect(text(panelOf(S(), CROPS))).not.toContain(message);
    expect(text(panelOf(S(), null))).not.toContain(message);   // not known while the pack loads
    expect(text(panelOf(S(), { manifest: {} as never, mapCount: 1, recipeCount: 1, itemCount: 1, exclusionRules: [], dimensions: [], capabilities: [] })))
      .toContain(message);
  });
});

describe('farms we already run', () => {
  it('lists each farm output with its name, item and rate, and removes one', () => {
    const running = [{ name: 'Crop manager', outputs: [{ key: 't:rubber_wood@0', perMinute: 32 }, { key: 't:resin@0', perMinute: 4 }] },
      { name: 'Forestry farm', outputs: [{ key: 't:sapling@0', perMinute: 0.5 }] }];
    expect(runningFarmRows(running).map((r) => [r.id, r.name, r.key, r.perMinute])).toEqual([
      ['0:0', 'Crop manager', 't:rubber_wood@0', 32], ['0:1', 'Crop manager', 't:resin@0', 4], ['1:0', 'Forestry farm', 't:sapling@0', 0.5]]);
    expect(runningFarmWithout(running, 0, 1)).toEqual([{ name: 'Crop manager', outputs: [{ key: 't:rubber_wood@0', perMinute: 32 }] }, running[1]]);
    expect(runningFarmWithout(running, 1, 0)).toEqual([running[0]]);   // a farm with nothing left goes
    const settings = S({ farms: { ...defaultFarmSettings(), running } });
    const html = panelOf(settings, CROPS, { tier: 1, names: { 't:rubber_wood@0': 'Rubber Wood' } } as unknown as Plan);
    const section = text(sectionOf(html, 'Farms we already run'));
    expect(section).toContain('Crop manager: Rubber Wood · 32/min');
    expect(section).toContain('Forestry farm: t:sapling@0 · 0.5/min');
    expect(html).toContain('aria-label="Remove Crop manager: Rubber Wood"');
    expect(sectionOf(panelOf(S()), 'Farms we already run')).toContain('Nothing yet.');
  });

  it('adds a farm, within what the server takes', () => {
    expect([parsePerMinute('32'), parsePerMinute(' 0.5 '), parsePerMinute('1000000')]).toEqual([{ value: 32 }, { value: 0.5 }, { value: 1e6 }]);
    for (const t of ['0', '-1', '', 'lots', '1000001']) expect(parsePerMinute(t), t).toEqual({ error: 'Enter how many a minute (above 0)' });
    const added = runningFarmWith([], { name: '  Crop manager ', key: 't:rubber_wood@0', perMinute: 32 });
    expect(added).toEqual({ running: [{ name: 'Crop manager', outputs: [{ key: 't:rubber_wood@0', perMinute: 32 }] }] });
    expect(validateOp({ op: 'settings', patch: { farms: { ...defaultFarmSettings(), running: 'running' in added ? added.running : [] } } })).toBeNull();
    expect(runningFarmWith([], { name: ' ', key: 't:x@0', perMinute: 1 })).toEqual({ error: "Enter the farm's name" });
    expect(runningFarmWith([], { name: 'x'.repeat(81), key: 't:x@0', perMinute: 1 })).toEqual({ error: "A farm's name is at most 80 characters" });
    const full = Array.from({ length: 20 }, (_, i) => ({ name: `Farm ${i}`, outputs: [{ key: 't:x@0', perMinute: 1 }] }));
    expect(runningFarmWith(full, { name: 'One more', key: 't:x@0', perMinute: 1 })).toEqual({ error: 'The list holds at most 20 farms; remove one first' });
  });
});

describe("other projects' surplus", () => {
  it('is on unless the project turned it off, in rate mode only, and sends the change', () => {
    const box = (html: string): string => /<input[^>]*name="useSurplus"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box(panelOf(S()))).toContain('checked=""');
    expect(text(panelOf(S()))).toContain("Use other projects' surplus");
    expect(box(panelOf(S({ useSurplus: false })))).not.toContain('checked');
    const old = S();
    delete old.useSurplus;
    expect(box(panelOf(old))).toContain('checked=""');
    expect(box(panelOf(S({ mode: 'makeN', amount: 4 })))).toBe('');   // a Make N batch neither takes nor offers surplus
    const patch = vi.fn();
    const [input] = findAll(SurplusSection({ settings: S(), patch }), (e) => e.type === 'input');
    (input!.props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
    expect(patch).toHaveBeenCalledWith({ useSurplus: false });
    expect(validateOp({ op: 'settings', patch: { useSurplus: false } })).toBeNull();
  });
});
