import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatNumber, formatRate, flowGraph, toElk, fromElk, ocLines, reusePatch, LEAF_WORD } from '../../src/client/views/flow-model.ts';
import { formatNumber as sharedNumber, formatRate as sharedRate } from '../../src/shared/format.ts';
import { FlowView, FlowNodeShape } from '../../src/client/views/FlowView.tsx';
import { StepPanel } from '../../src/client/views/StepPanel.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';

const step = (p: Partial<PlanStep>): PlanStep => ({ id: 'circuit-lv', recipeId: 'circuit-lv', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 },
  count: 5, owned: 0, runsPerSecond: 0.5, utilization: 1, euPerTick: 16, durationTicks: 200, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [],
  mainOutput: 't:circuit@0', oc: { recipeEuPerTick: 16, recipeDurationTicks: 200, machineVoltage: 32, machineAmps: 1, perfect: false, heatOverclocks: 0 }, ...p });
const plan = { status: 'ok', steps: [step({})], names: { 't:circuit@0': 'Basic Circuit', 't:redstone@0': 'Redstone' },
  flows: [{ from: 'raw', to: 'circuit-lv', key: 't:redstone@0', perSecond: 0.5 }, { from: 'circuit-lv', to: 'out', key: 't:circuit@0', perSecond: 0.5 }],
  rawInputs: [{ key: 't:redstone@0', perSecond: 0.5, cost: 0.5, available: true, sources: [] }], byproducts: [], warnings: [], unlocks: [] } as unknown as Plan;

/** What a reader sees: the markup without its tags and comments, entities decoded. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('flow model', () => {
  it('formats rates', () => {
    expect([formatRate(0.5, 'min'), formatRate(0.5, 'hour'), formatRate(0.0123, 'min'), formatRate(1 / 24, 'min')]).toEqual(['30/min', '1,800/h', '0.738/min', '2.5/min']);
    expect(formatRate).toBe(sharedRate);                                      // the one shared formatter (fix spec §6.1)
    expect(formatNumber).toBe(sharedNumber);
  });
  it('gives fluids their litres and calls each import by its kind', () => {
    const fluid = { ...plan, names: { ...plan.names, 'fluid:water': 'Water' }, rawInputs: [{ ...plan.rawInputs[0]!, leafClass: 'direct' }],
      flows: [...plan.flows, { from: 'raw', to: 'circuit-lv', key: 'fluid:water', perSecond: 0.5 }] } as unknown as Plan;
    const g = flowGraph(fluid, 'min');
    expect(g.edges.find((e) => e.key === 'fluid:water')?.label).toBe('Water 30 L/min');
    expect(g.nodes.find((n) => n.id === 'raw:t:redstone@0')?.lines).toEqual(['mined · 30/min']);
    expect(LEAF_WORD).toEqual({ free: 'free', direct: 'mined', byproduct: 'ore byproduct', derived: 'bought (made elsewhere)', natural: 'gathered',
      stop: 'supplied (we make it)', unavailable: 'not reachable' });
  });
  it('builds nodes and edges from the plan', () => {
    const g = flowGraph(plan, 'min');
    expect(g.nodes.map((n) => [n.id, n.kind, n.title, n.owned])).toEqual([
      ['circuit-lv', 'step', '5× Basic Assembler', 'none'], ['out', 'out', 'Basic Circuit', 'none'], ['raw:t:redstone@0', 'raw', 'Redstone', 'none']]);
    expect(g.nodes[0]?.lines).toEqual(['LV · 16 EU/t · 100% busy', 'makes Basic Circuit']);
    expect(g.edges.map((e) => [e.from, e.to, e.label])).toEqual([['circuit-lv', 'out', 'Basic Circuit 30/min'], ['raw:t:redstone@0', 'circuit-lv', 'Redstone 30/min']]);
    expect(flowGraph({ ...plan, steps: [step({ owned: 2 })] } as Plan, 'min').nodes[0]?.owned).toBe('some');
  });
  it('explains the overclock', () => {
    expect(ocLines(step({}))).toEqual(['Recipe: 16 EU/t × 200 t (10 s)', 'Machine: LV, 32 V × 1 A', '0 overclocks → 16 EU/t × 200 t',
      'One machine: 0.1 runs/s · needed: 0.5 runs/s → 5 machines, 100% busy']);
    const mv = step({ machine: { mteId: 102, name: 'Advanced Bending Machine', tier: 2 }, count: 3, runsPerSecond: 1, utilization: 1 / 1.2, euPerTick: 96, durationTicks: 50, overclocks: 1,
      oc: { recipeEuPerTick: 24, recipeDurationTicks: 100, machineVoltage: 128, machineAmps: 1, perfect: false, heatOverclocks: 0 } });
    expect(ocLines(mv)[2]).toBe('1 overclock (×4 EU/t, ÷2 time) → 96 EU/t × 50 t');
    expect(ocLines(mv)[3]).toBe('One machine: 0.4 runs/s · needed: 1 runs/s → 3 machines, 83% busy');
    // A step the line needs once in a year: how often it runs, never "0 runs/s" or "0% busy".
    const rare = step({ count: 1, runsPerSecond: 3.1e-8, utilization: 3.1e-7 });
    expect(ocLines(rare)[3]).toMatch(/needed: 1 run every 373 days → 1 machine, <0\.1% busy$/);
    expect(ocLines(rare)[3]).toBe('One machine: 0.1 runs/s · needed: 1 run every 373 days → 1 machine, <0.1% busy');
  });
  it('lays out raw materials left of the target', async () => {
    const g = flowGraph(plan, 'min');
    const laid = fromElk(g, await new ELK().layout(toElk(g)));
    const x = (id: string) => laid.nodes.find((n) => n.id === id)!.x;
    expect(x('raw:t:redstone@0')).toBeLessThan(x('circuit-lv'));
    expect(x('circuit-lv')).toBeLessThan(x('out'));
    expect(laid.edges[0]?.points.length).toBeGreaterThanOrEqual(2);
  });
  it('renders the waiting state and comes before materials and notes', () => {
    expect(renderToStaticMarkup(<FlowView project={{ settings: { per: 'min' } } as never} plan={null} send={() => {}} me="Ann" />)).toContain('Planning…');
    const ids = PROJECT_TABS.map((t) => t.id);                        // relative order only: Plans 4 and 5 insert map and 3d first
    expect(ids.indexOf('flow')).toBeGreaterThanOrEqual(0);
    if (ids.includes('materials')) expect(ids.indexOf('flow')).toBeLessThan(ids.indexOf('materials'));
    expect(ids.indexOf('flow')).toBeLessThan(ids.indexOf('notes'));
  });
  it('badges a step that uses a material on the avoid list nothing at the tier avoids', () => {
    const text = 'Basic Assembler uses Redstone — no recipe at LV avoids it';
    const flagged = { ...plan, warnings: [{ code: 'avoid-unavoidable', key: 't:redstone@0', stepId: 'circuit-lv', text }] } as Plan;
    const g = flowGraph(flagged, 'min');
    const box = g.nodes.find((n) => n.id === 'circuit-lv')!;
    expect(box.avoidBadge).toEqual({ text: '⚠ uses avoided Redstone', warnings: [text] });
    expect(box.height).toBe(flowGraph(plan, 'min').nodes.find((n) => n.id === 'circuit-lv')!.height + 16);   // one line taller
    expect(g.nodes.filter((n) => n.avoidBadge !== undefined).map((n) => n.id)).toEqual(['circuit-lv']);
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={{ ...box, x: 0, y: 0 }} /></svg>);
    expect(html).toMatch(/data-avoid-badge="".*⚠ uses avoided Redstone/s);
    expect(html).toContain(text);                                       // in the box's tooltip and accessible name
    expect(renderToStaticMarkup(<svg><FlowNodeShape node={{ ...flowGraph(plan, 'min').nodes[0]!, x: 0, y: 0 }} /></svg>)).not.toContain('data-avoid-badge');
  });
  it('renders an item icon in raw and step nodes', () => {
    const g = flowGraph(plan, 'min');
    const html = (id: string) => renderToStaticMarkup(<svg><FlowNodeShape node={{ ...g.nodes.find((n) => n.id === id)!, x: 0, y: 0 }} /></svg>);
    expect(html('raw:t:redstone@0')).toMatch(/<g[^>]*data-node-id="raw:t:redstone@0"[^>]*>.*data-item-key="t:redstone@0"/s);
    expect(html('circuit-lv')).toMatch(/data-step-id="circuit-lv".*data-item-key="t:circuit@0"/s);
  });
  it('lets the group decline reusing owned machines', () => {
    expect(reusePatch(defaultSettings(), 121, false)).toEqual({ declineReuse: [121] });
    expect(reusePatch({ ...defaultSettings(), declineReuse: [121, 5] }, 121, true)).toEqual({ declineReuse: [5] });
    const panel = (owned: number, declineReuse: number[]) => renderToStaticMarkup(<StepPanel step={step({ owned })} plan={plan}
      settings={{ ...defaultSettings(), declineReuse }} send={() => {}} onClose={() => {}} />);
    expect(panel(2, [])).toContain('Reuse your 2× Basic Assembler');
    expect(panel(2, []).match(/<input[^>]*name="reuse"[^>]*>/)?.[0]).toContain('checked');
    expect(panel(0, [121])).toContain('Reuse your Basic Assembler machines');
    expect(panel(0, [])).not.toContain('Reuse your');
  });
  it('tells swap options apart by what they take and make, and lists five before "more…"', () => {
    const alt = (n: number) => ({ recipeId: `r${n}`, rawCost: n, mapId: 'gt.recipe.assembler',
      inputs: [{ key: 't:redstone@0', amount: n }, { key: 'fluid:water', amount: 1000 }], outputs: [{ key: 't:circuit@0', amount: 1 }] });
    const alts = [1, 2, 3, 4, 5, 6, 7].map(alt);
    const named = { ...plan, names: { ...plan.names, 'map:gt.recipe.assembler': 'Assembler', 'fluid:water': 'Water' } } as Plan;
    const html = renderToStaticMarkup(<StepPanel step={step({ recipeId: 'r7', alternatives: alts })} plan={named}
      settings={defaultSettings()} send={() => {}} onClose={() => {}} />);
    expect(text(html)).toContain('Assembler: 2× Redstone, 1,000 L Water → Basic Circuit · 2 raw/unit');
    expect(text(html)).toContain('Assembler: Redstone, 1,000 L Water → Basic Circuit · 1 raw/unit');
    expect(html).not.toContain('r1</span>');                                   // no bare recipe ids
    expect(text(html)).toContain('· 7 raw/unit');                              // the one in use always shows
    expect(text(html)).not.toContain('· 6 raw/unit');
    expect(text(html)).toContain('1 more…');
  });
  it('writes an ingredient of several options as all of them', () => {
    const alt = { recipeId: 'ca', rawCost: 0.6, mapId: 'gt.recipe.circuitassembler', outputs: [{ key: 't:circuit@0', amount: 1 }],
      inputs: [{ key: 't:part@0', amount: 2 }, { key: 'fluid:molten.solderingalloy', amount: 72,
        options: [{ key: 'fluid:molten.solderingalloy', amount: 72 }, { key: 'fluid:molten.tin', amount: 144 }, { key: 'fluid:molten.lead', amount: 288 }] }] };
    const named = { ...plan, names: { ...plan.names, 'map:gt.recipe.circuitassembler': 'Circuit Assembler', 't:part@0': 'Part',
      'fluid:molten.solderingalloy': 'Molten Soldering Alloy', 'fluid:molten.tin': 'Molten Tin', 'fluid:molten.lead': 'Molten Lead' } } as Plan;
    const html = renderToStaticMarkup(<StepPanel step={step({ recipeId: 'ca', alternatives: [alt] })} plan={named} settings={defaultSettings()} send={() => {}} onClose={() => {}} />);
    expect(text(html)).toContain('Circuit Assembler: 2× Part, 72 L Molten Soldering Alloy / 144 L Molten Tin / 288 L Molten Lead → Basic Circuit · 0.6 raw/unit');
  });
});
