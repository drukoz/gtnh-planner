import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatRate, flowGraph, toElk, fromElk, ocLines, reusePatch } from '../../src/client/views/flow-model.ts';
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

describe('flow model', () => {
  it('formats rates', () => {
    expect([formatRate(0.5, 'min'), formatRate(0.5, 'hour'), formatRate(0.0123, 'min'), formatRate(1 / 24, 'min')]).toEqual(['30/min', '1800/h', '0.74/min', '2.5/min']);
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
    expect(html).toContain('Assembler: 2× Redstone, 1000 L Water → Basic Circuit · 2 raw/unit');
    expect(html).toContain('Assembler: Redstone, 1000 L Water → Basic Circuit · 1 raw/unit');
    expect(html).not.toContain('r1</span>');                                   // no bare recipe ids
    expect(html).toContain('· 7 raw/unit');                                    // the one in use always shows
    expect(html).not.toContain('· 6 raw/unit');
    expect(html).toContain('1 more…');
  });
});
