import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { drawerStatus, PlanBanner } from '../../src/client/views/ProjectPage.tsx';
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
    // its figures are VT323 (span.fig), its words Pixelify (Phase 2 spec §25)
    expect(html(served)).toContain('This plan does not add up: <span class="fig">2</span> inputs have no source, <span class="fig">1</span> good is made two ways');
    expect(out).toContain('Show in the flow');
    expect(out).toContain('Nothing supplies the PVA (as the server says it).');
    expect(out).not.toContain('Nothing supplies Polyvinyl Acetate');             // the server's text, not the client's
    expect(out).toContain('Nothing supplies Resin to Mixer (Glue): it needs 1,800/h and the plan neither makes nor buys it.');
    expect(out).toContain('Plate is made 2 ways: Fluid Solidifier (99.9%) and Cutting Machine (0.1%).');
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
    // the final fix wave, FW-7(b): the button goes with the op it sends, and the chips beside it with the next plan, so the page's main takes
    // the focus first, never the body (ledger ruling P2-R57); node has no DOM, so a stand-in main records it
    const order: string[] = [];
    class Main { hasAttribute(): boolean { return true; } focus(): void { order.push('focus main'); } }
    vi.stubGlobal('HTMLElement', Main);
    vi.stubGlobal('document', { querySelector: (selector: string) => (selector === 'main' ? new Main() : null) });
    send.mockImplementationOnce(() => order.push('send'));
    (plan!.props.onClick as () => void)();
    expect(order).toEqual(['focus main', 'send']);
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

// Phase 2 Task 8 (spec §17 R43, §11.3): the banners are inert behind an open settings drawer, so their status is not announced there; the
// drawer has a status line of its own: the planner's error, else that the plan is updating (in other words than the banner's busy line,
// which drawer.spec.ts finds by its text while the drawer is open: plan ruling drawer-status-words), else how many problems the banner
// lists (never their words, which other e2e specs find by text), leaving out the hint to pick something to make, which the drawer answers
// (plan ruling drawer-status-count), else, for a plan that runs, that it has no problems, so an update is heard to end as it was heard to
// start (ledger ruling P2-R52). The banner's busy line carries the GT progress arrow on its chat box.
describe('the drawer\'s status (R43)', () => {
  const hint = { code: 'no-target', text: 'Pick something to make' };
  const oneOrphan = planOf({
    steps: [step({ id: 'mixer', mainOutput: 't:glue@0', inputs: [{ key: 't:resin@0', amount: 1, chance: 1 }], outputs: [{ key: 't:glue@0', amount: 1, chance: 1 }] })],
    flows: [{ from: 'mixer', to: 'out', key: 't:glue@0', perSecond: 0.5 }],
  });
  const avoid = 'Basic Wiremill uses Copper Ingot — no recipe at LV avoids it';
  const twoWarnings = planOf({ warnings: [{ code: 'avoid-unavoidable', key: 't:copper_ingot@0', stepId: 'wire', text: avoid }, { code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }] });

  it('says the planner\'s error, else that the plan is updating, else how many problems the banner lists', () => {
    expect(drawerStatus(null, 'boom', false)).toBe('boom');
    expect(drawerStatus(broken, 'boom', true)).toBe('boom');
    expect(drawerStatus(broken, null, true)).toBe('The plan is updating…');
    expect(drawerStatus(broken, null, true).toLowerCase()).not.toContain('updating the plan');
    expect(drawerStatus(broken, null, false)).toBe('The plan has 3 problems');                   // two inputs with no source, a good made two ways
    expect(drawerStatus(oneOrphan, null, false)).toBe('The plan has 1 problem');
    expect(drawerStatus(twoWarnings, null, false)).toBe('The plan has 2 problems');
    expect(drawerStatus(twoWarnings, null, false)).not.toContain(avoid);
    // the hint to pick something to make is no problem: the drawer that opens by itself is where it is answered
    expect(drawerStatus(planOf({ status: 'empty', warnings: [hint] }), null, false)).toBe('');
    expect(drawerStatus(planOf({ status: 'empty', warnings: [hint, { code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }] }), null, false)).toBe('The plan has 1 problem');
    // ledger ruling P2-R52: a plan that runs with nothing to warn about has no problems, and says so; one that is on its way is updating
    expect(drawerStatus(planOf({}), null, false)).toBe('No problems');
    expect(drawerStatus(planOf({}), null, true)).toBe('The plan is updating…');
    // a plan that cannot run and says nothing about it is no "No problems"; it has none to count either
    expect(drawerStatus(planOf({ status: 'infeasible' }), null, false)).toBe('');
    expect(drawerStatus(null, null, true)).toBe('');                                               // the first plan is on its way: the view says "Planning…"
    expect(drawerStatus(null, null, false)).toBe('');
  });

  it('counts what the banner lists, its problems and other warnings, and not what the plan uses beyond its line', () => {
    // the banner's lists: each problem and each other warning is an item of a `ul.warnings`; the hint's item is not counted
    const listed = (plan: Plan): number => [...html(plan).matchAll(/<ul class="warnings">(.*?)<\/ul>/g)]
      .flatMap((m) => m[1]!.match(/<li>.*?<\/li>/g) ?? []).filter((li) => !li.includes('Pick something to make')).length;
    for (const plan of [broken, oneOrphan, twoWarnings, planOf({ status: 'empty', warnings: [hint, { code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }] })]) {
      const n = listed(plan);
      expect(n).toBeGreaterThan(0);
      expect(drawerStatus(plan, null, false)).toBe(`The plan has ${n} ${n === 1 ? 'problem' : 'problems'}`);
    }
    // a farm the plan uses is a source note, not a problem
    const farmed = planOf({ steps: [step({ id: 'tgs', mapId: 'gt.recipe.treefarm', mainOutput: 't:wood@0', outputs: [{ key: 't:wood@0', amount: 1, chance: 1 }],
      farm: { kind: 'tgs', tier: 1, footprint: [7, 7, 7], text: 'Tree Growth Simulator', tools: [] } })], flows: [{ from: 'tgs', to: 'out', key: 't:wood@0', perSecond: 0.5 }] });
    expect(text(html(farmed))).toContain('This plan uses');
    expect(drawerStatus(farmed, null, false)).toBe('No problems');
  });

  it('draws the GT progress arrow in the banner\'s busy line', () => {
    const busy = renderToStaticMarkup(<PlanBanner plan={broken} planError={null} planLoading={true} settings={S()} send={() => {}} />);
    expect(busy).toContain('<p class="muted"><span class="gt-arrow on-chat" aria-hidden="true"><span class="gt-arrow-fill"></span></span>Updating the plan…</p>');
    // alone too, when the banner has nothing else to say
    expect(renderToStaticMarkup(<PlanBanner plan={planOf({})} planError={null} planLoading={true} settings={S()} send={() => {}} />))
      .toBe('<div class="plan-banner" role="status"><p class="muted"><span class="gt-arrow on-chat" aria-hidden="true"><span class="gt-arrow-fill"></span></span>Updating the plan…</p></div>');
  });
});
