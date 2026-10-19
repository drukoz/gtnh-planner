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
  it('says how much more raw material the plan uses than the least, and why', () => {
    const costly = planOf({ rawCost: { perSecond: 1.21, leastPerSecond: 1 } });
    expect(text(html(costly))).toContain('Uses 21% more raw material than the least possible to save machines (Steps vs raw material: Some steps)');
    expect(text(html(costly, S({ stepCharge: 0.05 })))).toContain('(Steps vs raw material: Balanced)');
    expect(text(html(costly, S({ stepCharge: 0.07 })))).toContain('(Steps vs raw material: Custom (7%))');
    expect(html(planOf({ rawCost: { perSecond: 1, leastPerSecond: 1 } }))).toBe('');
    expect(html(planOf({ rawCost: { perSecond: 0, leastPerSecond: 0 } }))).toBe('');
  });
});
