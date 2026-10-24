import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBanner } from '../../src/client/views/ProjectPage.tsx';
import { getFlowFocus, setFlowFocus } from '../../src/client/state/flow-focus.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings, PlanStep } from '../../src/shared/types/plan.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), ...p });
const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, count: 1, owned: 0,
  runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [],
  handCraft: false, warnings: [], ...p,
});
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 1, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 1, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const banner = (plan: Plan, settings = S(), send = vi.fn()) => PlanBanner({ plan, planError: null, planLoading: false, settings, send });
const html = (plan: Plan, settings = S()): string => renderToStaticMarkup(<PlanBanner plan={plan} planError={null} planLoading={false} settings={settings} send={() => {}} />);

// A mixer whose two inputs nothing supplies, and a plate two steps make as their main output.
const broken = planOf({
  steps: [
    step({ id: 'mixer', machine: { mteId: 581, name: 'Mixer', tier: 1 }, mainOutput: 't:glue@0',
      inputs: [{ key: 'fluid:pva', amount: 100, chance: 1 }, { key: 't:resin@0', amount: 1, chance: 1 }], outputs: [{ key: 't:glue@0', amount: 1, chance: 1 }] }),
    step({ id: 'solid', machine: { mteId: 521, name: 'Fluid Solidifier', tier: 1 }, mainOutput: 't:plate@0', runsPerSecond: 0.999,
      outputs: [{ key: 't:plate@0', amount: 1, chance: 1 }] }),
    step({ id: 'saw', machine: { mteId: 541, name: 'Cutting Machine', tier: 1 }, mainOutput: 't:plate@0', runsPerSecond: 0.001,
      outputs: [{ key: 't:plate@0', amount: 1, chance: 1 }] }),
  ],
  flows: [{ from: 'mixer', to: 'out', key: 't:glue@0', perSecond: 0.5 }, { from: 'solid', to: 'sink', key: 't:plate@0', perSecond: 0.999 },
    { from: 'saw', to: 'sink', key: 't:plate@0', perSecond: 0.001 }],
  names: { 'fluid:pva': 'Polyvinyl Acetate', 't:resin@0': 'Resin', 't:glue@0': 'Glue', 't:plate@0': 'Plate' },
});

afterEach(() => { setFlowFocus(null); vi.unstubAllGlobals(); });

describe('plan banner', () => {
  it('sums up what does not add up, preferring the server texts', () => {
    const served = { ...broken, warnings: [{ code: 'orphan-input', key: 'fluid:pva', stepId: 'mixer', text: 'Nothing supplies the PVA (as the server says it).' }] };
    const out = text(html(served));
    expect(out).toContain('This plan does not add up: 2 inputs have no source, 1 good is made two ways');
    expect(out).toContain('Show in the flow');
    expect(out).toContain('Nothing supplies the PVA (as the server says it).');
    expect(out).not.toContain('Nothing supplies Polyvinyl Acetate');             // the server's text, not the client's
    expect(out).toContain('Nothing supplies Resin to Mixer (Glue): it needs 1,800/h and the plan neither makes nor buys it.');
    expect(out).toContain('Plate is made 2 ways: Fluid Solidifier (99.9%) and Cutting Machine (0.1%).');
  });
  it('shows a good a build-cost plan makes two ways on purpose as a plain note, not as a problem (plan 12 final review)', () => {
    // The raw cap keeps 40 % of the plates on one full machine and the rest on the other way: the plan marks the split
    // (`Plan.deliberate`), so the banner shows its note plainly, once, in the server's words, else the client's.
    const plate = (id: string, name: string, runsPerSecond: number) => step({ id, machine: { mteId: 521, name, tier: 1 }, mainOutput: 't:plate@0', runsPerSecond,
      utilization: 1, outputs: [{ key: 't:plate@0', amount: 1, chance: 1 }] });
    const split = planOf({
      steps: [plate('solid', 'Fluid Solidifier', 0.6), plate('saw', 'Cutting Machine', 0.4)],
      flows: [{ from: 'solid', to: 'out', key: 't:plate@0', perSecond: 0.6 }, { from: 'saw', to: 'out', key: 't:plate@0', perSecond: 0.4 }],
      names: { 't:plate@0': 'Plate' }, deliberate: [{ key: 't:plate@0', code: 'multi-producer', why: 'full', full: ['saw'] }],
      warnings: [{ code: 'deliberate-split', key: 't:plate@0', stepId: 'solid', text: 'Plates come two ways on purpose (as the server says it).' }],
    });
    const out = text(html(split));
    expect(out).not.toContain('does not add up');
    expect(out.split('Plates come two ways on purpose').length).toBe(2);
    expect(findAll(banner(split), (e) => e.type === 'ul' && e.props.className === 'banner-notes')).toHaveLength(1);
    expect(text(html({ ...split, warnings: [] }))).toContain('Plate is made 2 ways: Fluid Solidifier (60%) and Cutting Machine (40%). The Cutting Machine '
      + 'is full, and one more would cost more than the raw material it saves.');
    // Unmarked, the same split is a problem.
    expect(text(html({ ...split, deliberate: undefined, warnings: [] }))).toContain('This plan does not add up: 1 good is made two ways');
  });
  it('shows the first problem in the flow', () => {
    vi.stubGlobal('location', { hash: '#materials' });
    const [show] = findAll(banner(broken), (e) => e.type === 'button' && e.props.children === 'Show in the flow');
    (show!.props.onClick as () => void)();
    expect(getFlowFocus()).toEqual({ kind: 'item', key: 'fluid:pva' });
    expect(location.hash).toBe('#flow');
  });
  it('keeps every other server warning', () => {
    const avoid = 'Basic Wiremill uses Copper Ingot — no recipe at LV avoids it';
    const out = text(html(planOf({ warnings: [{ code: 'avoid-unavoidable', key: 't:copper_ingot@0', stepId: 'wire', text: avoid }, { code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }] })));
    expect(out).toContain(avoid);
    expect(out).toContain('Nothing at ≤ LV makes Glue');
    expect(out).not.toContain('does not add up');
    expect(html(planOf({}))).toBe('');                                             // nothing to say
  });
  it('shows each bought derived material as a chip and offers supporting lines when they are off', () => {
    const derived = planOf({
      names: { 't:a1@0': 'Alloy 1 Ingot', 't:a2@0': 'Alloy 2 Ingot', 't:x@0': 'X Dust' },
      rawInputs: [{ key: 't:a1@0', perSecond: 1, cost: 1, available: true, sources: [], leafClass: 'derived' },
        { key: 't:a2@0', perSecond: 1, cost: 1, available: true, sources: [], leafClass: 'derived' },
        { key: 't:x@0', perSecond: 1, cost: 1, available: true, sources: [], leafClass: 'direct' }],
      warnings: [{ code: 'derived-leaf', key: 't:a1@0', text: 'Alloy 1 Ingot and Alloy 2 Ingot are not mined anywhere you can reach; the line buys them made from other materials (see their sources). Plan them as supporting lines to include their chains.' }],
    });
    const off = html(derived, S({ routeDerived: false }));
    const chips = [...off.matchAll(/<button[^>]*class="[^"]*banner-chip[^"]*"[^>]*data-key="([^"]*)"/g)].map((m) => m[1]);
    expect(chips).toEqual(['t:a1@0', 't:a2@0']);
    expect(text(off)).toContain('Alloy 1 Ingot');
    expect(text(off)).toContain('Plan them as supporting lines');
    expect(text(html(derived, S({ routeDerived: true })))).not.toContain('Plan them as supporting lines');

    vi.stubGlobal('location', { hash: '' });
    const send = vi.fn();
    const tree = banner(derived, S({ routeDerived: false }), send);
    const [chip] = findAll(tree, (e) => e.type === 'button' && e.props['data-key'] === 't:a2@0');
    (chip!.props.onClick as () => void)();
    expect(getFlowFocus()).toEqual({ kind: 'item', key: 't:a2@0' });               // each chip shows its import in the flow
    expect(location.hash).toBe('#flow');
    const [plan] = findAll(tree, (e) => e.type === 'button' && e.props.children === 'Plan them as supporting lines');
    (plan!.props.onClick as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { routeDerived: true } }]);
  });
  it('leaves what a Make N batch comes out short of to its batch-short warning', () => {
    // Plan 09's final review: whole crafts that leave a good short gave a short input at each step that takes it under
    // the red heading, beside the warning that already says what to have ready.
    const shortText = 'Whole crafts do not balance: have 2× Empty Cell ready before you start (cells or catalysts the chain hands round), or the batch comes out short.';
    const batch = planOf({
      steps: [
        step({ id: 'use', mainOutput: 't:thing@0', runsPerSecond: 0.01, inputs: [{ key: 't:cell@0', amount: 2, chance: 1 }], outputs: [{ key: 't:thing@0', amount: 1, chance: 1 }] }),
        step({ id: 'can', mainOutput: 't:cell@0', runsPerSecond: 0.01, outputs: [{ key: 't:cell@0', amount: 1, chance: 1 }] }),
      ],
      flows: [{ from: 'can', to: 'use', key: 't:cell@0', perSecond: 0.01 }, { from: 'use', to: 'out', key: 't:thing@0', perSecond: 0.01 }],
      names: { 't:cell@0': 'Empty Cell', 't:thing@0': 'Thing' },
      makeN: { totalSeconds: 100, leftovers: [] },
      warnings: [{ code: 'batch-short', key: 't:cell@0', keys: ['t:cell@0'], text: shortText }],
    });
    const out = text(html(batch));
    expect(out).toContain(shortText);
    expect(out).not.toContain('does not add up');
    expect(out).not.toContain('gets only');
  });
  it('says how much more raw material the plan uses than the least, and why', () => {
    const costly = planOf({ rawCost: { perSecond: 1.21, leastPerSecond: 1 } });
    expect(text(html(costly))).toContain('Uses 21% more raw material than the least possible to save machines (Machines vs raw material: Fewest machines)');
    expect(text(html(costly, S({ stepCharge: 0.02 })))).toContain('(Machines vs raw material: Some machines)');
    expect(text(html(costly, S({ stepCharge: 0.07 })))).toContain('(Machines vs raw material: Custom (7%))');
    expect(html(planOf({ rawCost: { perSecond: 1, leastPerSecond: 1 } }))).toBe('');
    expect(html(planOf({ rawCost: { perSecond: 0, leastPerSecond: 0 } }))).toBe('');
  });
  it('measures against the leanest line where build cost counts, and names the raw cap (fix wave 3 (A))', () => {
    const capped = planOf({ rawCost: { perSecond: 1.2, leastPerSecond: 0.5, leanestPerSecond: 1 } });
    expect(text(html(capped))).toContain('Uses 20% more raw material than the leanest line to save machines (Machines vs raw material: Fewest machines; at most +25 %)');
    expect(text(html(capped, S({ rawCap: null })))).toContain('(Machines vs raw material: Fewest machines; no limit)');
    // The poly line: 135 × the least, but the leanest line itself (its machines paid for), so nothing to say.
    expect(html(planOf({ rawCost: { perSecond: 0.000987654322, leastPerSecond: 0.0000072965006, leanestPerSecond: 0.000987654322 } }))).toBe('');
  });
  it('says what the plan costs to run and to build (plan 12)', () => {
    const costed = planOf({ cost: { runPerHour: 5400, build: 182, horizonHours: 24 } });
    const out = html(costed);
    expect(text(out)).toContain('5,400 raw per hour to run + 182 raw to build new machines, counted over 24 h');
    expect(out).toMatch(/<p class="plan-cost">5,400 raw per hour to run/);
    // A plan with nothing to warn about keeps its cost line, outside the warning box.
    expect(out).not.toContain('plan-banner');
    const warned = html({ ...costed, warnings: [{ code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }] });
    expect(warned).toContain('class="plan-banner"');
    expect(text(warned)).toContain('counted over 24 h');
    expect(text(html(planOf({ cost: { runPerHour: 1, build: 50, horizonHours: null, batch: 192 } })))).toContain('192 raw for the batch + 50 raw to build new machines');
  });
  it('says a line whose least raw material is 0 uses raw material free inputs could replace, without a percentage', () => {
    // A glass line digging sand that rock-breaker cobblestone and forge hammers could make (plan 12, D1).
    const line = (html(planOf({ rawCost: { perSecond: 0.01, leastPerSecond: 0 } }))).match(/<p class="banner-cost">(.*?)<\/p>/)?.[1] ?? '';
    expect(text(line)).toBe('Uses raw material that free inputs could replace, to save machines (Machines vs raw material: Fewest machines)');
    expect(line).not.toContain('%');
    expect(text(html(planOf({ rawCost: { perSecond: 0.01, leastPerSecond: 0 } }), S({ stepCharge: 0.02 })))).toContain('(Machines vs raw material: Some machines)');
  });
});

// A project with no target says "Pick something to make" (the server's `no-target` warning), and the picker is in the settings column,
// which is a drawer behind the Settings button on a narrow screen: so the hint is the way in, a button that the page answers by
// opening the drawer into the item search (or, beside the views, by focusing it). Without a page to answer it, it stays text.
describe('plan banner: the hint to pick something to make', () => {
  const hint = { code: 'no-target', text: 'Pick something to make' };
  const empty = planOf({ status: 'empty', warnings: [hint] });
  const withPicker = (plan: Plan, onPickTarget: () => void) => PlanBanner({ plan, planError: null, planLoading: false, settings: S(), send: vi.fn(), onPickTarget });
  const htmlWithPicker = (plan: Plan, onPickTarget: () => void = () => {}): string => renderToStaticMarkup(
    <PlanBanner plan={plan} planError={null} planLoading={false} settings={S()} send={() => {}} onPickTarget={onPickTarget} />);

  it('is a link-looking button in its own list item when the page can answer it', () => {
    const out = htmlWithPicker(empty);
    expect(out).toContain('<ul class="warnings"><li><button type="button" class="link">Pick something to make</button></li></ul>');
    expect(text(out)).toBe('Pick something to make');
  });

  it('asks the page to take the reader to the picker when it is clicked', () => {
    const onPickTarget = vi.fn();
    const buttons = findAll(withPicker(empty, onPickTarget), (e) => e.type === 'button' && e.props.children === 'Pick something to make');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props.type).toBe('button');
    expect(buttons[0]!.props.className).toBe('link');
    expect(onPickTarget).not.toHaveBeenCalled();
    (buttons[0]!.props.onClick as () => void)();
    expect(onPickTarget).toHaveBeenCalledOnce();
  });

  it('stays plain text without a page to answer it', () => {
    const out = html(empty);
    expect(out).toContain('<ul class="warnings"><li>Pick something to make</li></ul>');
    expect(out).not.toContain('<button');
    expect(findAll(banner(empty), (e) => e.type === 'button')).toEqual([]);
  });

  it('makes only that warning a button: every other server warning keeps its text', () => {
    const mixed = planOf({ status: 'empty', warnings: [hint, { code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }, { code: 'unknown-target', text: 'This item is not in the current recipe export' }] });
    const out = htmlWithPicker(mixed);
    expect(out).toContain('<li>Nothing at ≤ LV makes Glue</li>');
    expect(out).toContain('<li>This item is not in the current recipe export</li>');
    expect(out.match(/<button/g)).toHaveLength(1);
    // and it is the hint by its code, not by its words: another warning that says the same is no way into the picker
    const lookalike = planOf({ warnings: [{ code: 'no-recipe', text: 'Pick something to make' }] });
    expect(htmlWithPicker(lookalike)).toContain('<li>Pick something to make</li>');
    expect(htmlWithPicker(lookalike)).not.toContain('<button');
  });

  it('adds nothing of its own: a plan with nothing to say is still no banner, and a plan not yet loaded is none either', () => {
    expect(htmlWithPicker(planOf({}))).toBe('');
    expect(renderToStaticMarkup(<PlanBanner plan={null} planError={null} planLoading={true} settings={S()} send={() => {}} onPickTarget={() => {}} />)).toBe('');
  });
});
