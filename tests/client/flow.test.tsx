import { describe, it, expect, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatNumber, formatRate, flowGraph, toElk, fromElk, ocLines, reusePatch, LEAF_WORD, focusSets, centreOn, flowEdgeId, rowCentre,
  collapsedLines, firstProducer, edgeTag, rowNameRoom, textWidth, LINE_COLLAPSE_STEPS, TEXT_CHAR_WIDTH, flowIssueLines, type FlowLayout, type FlowNode,
} from '../../src/client/views/flow-model.ts';
import { formatNumber as sharedNumber, formatRate as sharedRate } from '../../src/shared/format.ts';
import { FlowView, FlowNodeShape, FlowIssues, FlowLegend } from '../../src/client/views/FlowView.tsx';
import { StepPanel } from '../../src/client/views/StepPanel.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import { PROJECT_TABS } from '../../src/client/views/project-tabs.ts';
import type { Product } from '../../src/shared/types/pack.ts';
import type { LeafClass, Plan, PlanFlow, PlanSettings, PlanStep, RawInput } from '../../src/shared/types/plan.ts';

const step = (p: Partial<PlanStep>): PlanStep => ({ id: 'circuit-lv', recipeId: 'circuit-lv', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 },
  count: 5, owned: 0, runsPerSecond: 0.5, utilization: 1, euPerTick: 16, durationTicks: 200, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [],
  mainOutput: 't:circuit@0', oc: { recipeEuPerTick: 16, recipeDurationTicks: 200, machineVoltage: 32, machineAmps: 1, perfect: false, heatOverclocks: 0 }, ...p });
const plan = { status: 'ok', steps: [step({ inputs: [{ key: 't:redstone@0', amount: 1, chance: 1 }], outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }] })],
  names: { 't:circuit@0': 'Basic Circuit', 't:redstone@0': 'Redstone' },
  flows: [{ from: 'raw', to: 'circuit-lv', key: 't:redstone@0', perSecond: 0.5 }, { from: 'circuit-lv', to: 'out', key: 't:circuit@0', perSecond: 0.5 }],
  rawInputs: [{ key: 't:redstone@0', perSecond: 0.5, cost: 0.5, available: true, sources: [] }], byproducts: [], warnings: [], unlocks: [] } as unknown as Plan;

/** What a reader sees: the markup without its tags and comments, entities decoded. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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

describe('flow model', () => {
  it('formats rates', () => {
    expect([formatRate(0.5, 'min'), formatRate(0.5, 'hour'), formatRate(0.0123, 'min'), formatRate(1 / 24, 'min')]).toEqual(['30/min', '1,800/h', '0.738/min', '2.5/min']);
    expect(formatRate).toBe(sharedRate);                                      // the one shared formatter (fix spec §6.1)
    expect(formatNumber).toBe(sharedNumber);
  });
  it('gives fluids their litres and calls each import by its kind', () => {
    const fluid = { ...plan, names: { ...plan.names, 'fluid:water': 'Water' }, rawInputs: [{ ...plan.rawInputs[0]!, leafClass: 'direct' }],
      steps: [step({ inputs: [{ key: 't:redstone@0', amount: 1, chance: 1 }, { key: 'fluid:water', amount: 1, chance: 1 }], outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }] })],
      flows: [...plan.flows, { from: 'raw', to: 'circuit-lv', key: 'fluid:water', perSecond: 0.5 }] } as unknown as Plan;
    const g = flowGraph(fluid, 'min');
    expect(g.edges.find((e) => e.key === 'fluid:water')?.title).toBe('Water · 30 L/min · import → Basic Assembler (Basic Circuit)');
    expect(g.nodes.find((n) => n.id === 'import:t:redstone@0@circuit-lv')?.rows.map((r) => [r.side, r.name, r.rate])).toEqual([['out', 'mined', '30/min']]);
    expect(g.nodes.find((n) => n.id === 'circuit-lv')?.rows.find((r) => r.key === 'fluid:water')?.rate).toBe('30 L/min');
    expect(LEAF_WORD).toEqual({ free: 'free', direct: 'mined', byproduct: 'ore byproduct', derived: 'bought (made elsewhere)', natural: 'gathered',
      stop: 'supplied (we make it)', unavailable: 'not reachable' });
  });
  it('builds nodes and edges from the plan', () => {
    const g = flowGraph(plan, 'min');
    expect(g.nodes.map((n) => [n.id, n.kind, n.title, n.owned])).toEqual([
      ['circuit-lv', 'step', 'Basic Assembler', 'none'], ['import:t:redstone@0@circuit-lv', 'import', 'Redstone', 'none'], ['out', 'out', 'Basic Circuit', 'none']]);
    expect(g.nodes[0]?.lines).toEqual(['LV · 16 EU/t · 5 machines · 100% busy']);
    expect(g.edges.map((e) => [e.from, e.to, e.fromPort, e.toPort, e.label])).toEqual([
      ['circuit-lv', 'out', 'circuit-lv|out|t:circuit@0', 'out|in|t:circuit@0', undefined],
      ['import:t:redstone@0@circuit-lv', 'circuit-lv', 'import:t:redstone@0@circuit-lv|out|t:redstone@0', 'circuit-lv|in|t:redstone@0', undefined]]);
    expect(g.nodes.find((n) => n.id === 'out')?.rows.map((r) => [r.side, r.name, r.rate])).toEqual([['in', 'target', '30/min']]);
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
  it('lays out imports left of their step and the target right of it', async () => {
    const g = flowGraph(plan, 'min');
    const laid = fromElk(g, await new ELK().layout(toElk(g)));
    const x = (id: string) => laid.nodes.find((n) => n.id === id)!.x;
    expect(x('import:t:redstone@0@circuit-lv')).toBeLessThan(x('circuit-lv'));
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
  it('renders an item icon in import stubs and step boxes', () => {
    const g = flowGraph(plan, 'min');
    const html = (id: string) => renderToStaticMarkup(<svg><FlowNodeShape node={{ ...g.nodes.find((n) => n.id === id)!, x: 0, y: 0 }} /></svg>);
    expect(html('import:t:redstone@0@circuit-lv')).toMatch(/<g[^>]*data-node-id="import:t:redstone@0@circuit-lv"[^>]*>.*data-item-key="t:redstone@0"/s);
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

// A board line at 1 per hour (fix spec §6.2's cases, synthetic): wire from a bought ingot, glue from a mixer whose input
// nothing supplies, plates from two steps (98 % from a fluid solidifier, 2 % from a saw that leaves dust over), all into
// an assembler.
const H = 3600;
const per = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });
const raw = (key: string, perSecond: number, leafClass: LeafClass): RawInput => ({ key, perSecond, cost: perSecond, available: true, sources: [], leafClass });
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), ...p });
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 2, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 2, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const mv = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.test', machine: { mteId: 200, name: 'Advanced Machine', tier: 2 }, count: 1, owned: 0, runsPerSecond: 1 / H,
  utilization: 0.001, euPerTick: 28, durationTicks: 80, overclocks: 1, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [], ...p,
});
const WIRE = 't:copper_wire@0';
const PLATE = 't:copper_plate@0';
const board = planOf({
  target: 't:board@0', targetPerSecond: 1 / H,
  names: {
    't:copper_ingot@0': 'Copper Ingot', [WIRE]: '1x Copper Wire', 'fluid:pva': 'Polyvinyl Acetate', 'fluid:glue': 'Glue', 'fluid:molten.copper': 'Molten Copper',
    't:copper_block@0': 'Block of Copper', [PLATE]: 'Copper Plate', 't:copper_dust@0': 'Copper Dust', 't:board@0': 'Circuit Board',
  },
  steps: [
    mv({ id: 'mill', machine: { mteId: 352, name: 'Advanced Wiremill', tier: 2 }, mainOutput: WIRE, inputs: [per('t:copper_ingot@0', 1)], outputs: [per(WIRE, 2)] }),
    mv({ id: 'mixer', machine: { mteId: 582, name: 'Advanced Mixer', tier: 2 }, mainOutput: 'fluid:glue', runsPerSecond: 3.1e-8,
      inputs: [per('fluid:pva', 2000)], outputs: [per('fluid:glue', 5000)] }),
    mv({ id: 'solid', machine: { mteId: 521, name: 'Fluid Solidifier', tier: 2 }, mainOutput: PLATE, runsPerSecond: 0.98 / H,
      inputs: [per('fluid:molten.copper', 144)], outputs: [per(PLATE, 1)] }),
    mv({ id: 'saw', machine: { mteId: 541, name: 'Cutting Machine', tier: 2 }, mainOutput: PLATE, runsPerSecond: 0.02 / H,
      inputs: [per('t:copper_block@0', 1)], outputs: [per(PLATE, 1), per('t:copper_dust@0', 1)] }),
    mv({ id: 'asm', machine: { mteId: 212, name: 'Advanced Assembler', tier: 2 }, mainOutput: 't:board@0',
      inputs: [per(WIRE, 2), per('fluid:glue', 0.558), per(PLATE, 1)], outputs: [per('t:board@0', 1)] }),
  ],
  flows: [
    flow('raw', 'mill', 't:copper_ingot@0', 1 / H), flow('raw', 'solid', 'fluid:molten.copper', 141.12 / H), flow('raw', 'saw', 't:copper_block@0', 0.02 / H),
    flow('mill', 'asm', WIRE, 2 / H), flow('mixer', 'asm', 'fluid:glue', 5000 * 3.1e-8), flow('solid', 'asm', PLATE, 0.98 / H), flow('saw', 'asm', PLATE, 0.02 / H),
    flow('saw', 'sink', 't:copper_dust@0', 0.02 / H), flow('asm', 'out', 't:board@0', 1 / H),
  ],
  rawInputs: [raw('t:copper_ingot@0', 1 / H, 'derived'), raw('fluid:molten.copper', 141.12 / H, 'derived'), raw('t:copper_block@0', 0.02 / H, 'direct')],
});
const g = flowGraph(board, 'hour');
const nodeOf = (graph: { nodes: FlowNode[] }, id: string): FlowNode => {
  const found = graph.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found;
};

// A supporting line (fix spec R6): red alloy smelted from copper and redstone, then extracted to molten red alloy, which
// the main line's solidifier makes wire from.
const RED = 'fluid:molten.redalloy';
const redLine = { key: RED, name: 'Red Alloy' };
const red = planOf({
  target: 't:redalloy_wire@0',
  names: { 't:copper_ingot@0': 'Copper Ingot', 't:redstone@0': 'Redstone', 't:redalloy_ingot@0': 'Red Alloy Ingot', [RED]: 'Molten Red Alloy', 't:redalloy_wire@0': '1x Red Alloy Wire' },
  steps: [
    mv({ id: 'smelt', machine: { mteId: 201, name: 'Advanced Alloy Smelter', tier: 2 }, line: redLine, mainOutput: 't:redalloy_ingot@0',
      inputs: [per('t:copper_ingot@0', 1), per('t:redstone@0', 4)], outputs: [per('t:redalloy_ingot@0', 1)] }),
    mv({ id: 'extract', machine: { mteId: 131, name: 'Advanced Fluid Extractor', tier: 2 }, line: redLine, mainOutput: RED,
      inputs: [per('t:redalloy_ingot@0', 1)], outputs: [per(RED, 144)] }),
    mv({ id: 'wire', machine: { mteId: 521, name: 'Fluid Solidifier', tier: 2 }, mainOutput: 't:redalloy_wire@0', inputs: [per(RED, 144)], outputs: [per('t:redalloy_wire@0', 2)] }),
  ],
  flows: [
    flow('raw', 'smelt', 't:copper_ingot@0', 1 / H), flow('raw', 'smelt', 't:redstone@0', 4 / H), flow('smelt', 'extract', 't:redalloy_ingot@0', 1 / H),
    flow('extract', 'wire', RED, 144 / H), flow('wire', 'out', 't:redalloy_wire@0', 2 / H),
  ],
  rawInputs: [raw('t:copper_ingot@0', 1 / H, 'direct'), raw('t:redstone@0', 4 / H, 'direct')],
});

describe('flow diagram: boxes, rows and stubs (fix spec §6.2)', () => {
  it('titles a step box by its machine and lists what it takes and makes as rows, main output first', () => {
    const mill = nodeOf(g, 'mill');
    expect(mill.title).toBe('Advanced Wiremill');
    expect(mill.lines).toEqual(['MV · 28 EU/t · 1 machine · 0.1% busy']);
    expect(mill.rows.map((r) => [r.side, r.name, r.rate])).toEqual([['in', 'Copper Ingot', '1/h'], ['out', '1x Copper Wire', '2/h']]);
    expect(mill.rows.map((r) => r.port)).toEqual(['mill|in|t:copper_ingot@0', `mill|out|${WIRE}`]);
    expect(mill.rows[1]?.main).toBe(true);
    // The saw makes its plate (main, first) and dust it leaves over.
    expect(nodeOf(g, 'saw').rows.map((r) => [r.side, r.key, r.main === true])).toEqual([
      ['in', 't:copper_block@0', false], ['out', PLATE, true], ['out', 't:copper_dust@0', false]]);
    for (const n of g.nodes) {
      expect(n.width).toBeGreaterThanOrEqual(190);
      expect(n.width).toBeLessThanOrEqual(330);
    }
    const long = flowGraph(planOf({ steps: [mv({ id: 'x', machine: { mteId: 1, name: 'Extremely Advanced Large Multiblock Assembling Machine of Great Length', tier: 2 } })] }), 'hour');
    expect(nodeOf(long, 'x').width).toBe(330);
  });
  it('says what a supply step supplies and that a hand step is done by hand', () => {
    const COBBLE = 'minecraft:cobblestone@0';
    const supplied = planOf({
      tier: 1, names: { [COBBLE]: 'Cobblestone', 't:gravel@0': 'Gravel' },
      steps: [
        mv({ id: 'breaker', machine: { mteId: 300, name: 'Basic Rock Breaker', tier: 1 }, supply: COBBLE, mainOutput: COBBLE, outputs: [per(COBBLE, 1)] }),
        mv({ id: 'hammer', machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, handCraft: true, euPerTick: 0, utilization: 0.03, mainOutput: 't:gravel@0',
          inputs: [per(COBBLE, 1)], outputs: [per('t:gravel@0', 1)] }),
      ],
      flows: [flow('breaker', 'hammer', COBBLE, 1 / H), flow('hammer', 'out', 't:gravel@0', 1 / H)],
    });
    const sg = flowGraph(supplied, 'hour');
    expect(nodeOf(sg, 'breaker').lines).toEqual(['LV · 28 EU/t · 1 machine · 0.1% busy', 'supplies Cobblestone']);
    expect(nodeOf(sg, 'hammer').lines).toEqual(['by hand · 3% busy']);
  });
  it('puts one import stub beside each step that takes a bought good, called by its kind of import', () => {
    expect(g.nodes.filter((n) => n.kind === 'import').map((n) => [n.id, n.title, n.leaf, n.rows.map((r) => [r.side, r.name, r.rate])])).toEqual([
      ['import:fluid:molten.copper@solid', 'Molten Copper', 'derived', [['out', LEAF_WORD.derived, '141 L/h']]],
      ['import:t:copper_block@0@saw', 'Block of Copper', 'direct', [['out', LEAF_WORD.direct, '0.02/h']]],
      ['import:t:copper_ingot@0@mill', 'Copper Ingot', 'derived', [['out', LEAF_WORD.derived, '1/h']]],
    ]);
    // A good bought for two steps gets a stub beside each.
    const twice = planOf({
      steps: [mv({ id: 'a', inputs: [per('t:x@0', 1)] }), mv({ id: 'b', inputs: [per('t:x@0', 1)] })],
      flows: [flow('raw', 'a', 't:x@0', 1 / H), flow('raw', 'b', 't:x@0', 1 / H)], rawInputs: [raw('t:x@0', 2 / H, 'natural')],
    });
    expect(flowGraph(twice, 'hour').nodes.filter((n) => n.kind === 'import').map((n) => [n.id, n.rows[0]?.name])).toEqual([
      ['import:t:x@0@a', 'gathered'], ['import:t:x@0@b', 'gathered']]);
  });
  it('gives an input nothing supplies, or supplies short, a stub of its own into that input', () => {
    const missing = nodeOf(g, 'missing:fluid:pva@mixer');
    expect(missing.kind).toBe('missing');
    expect(missing.rows).toHaveLength(1);
    expect(missing.rows[0]).toMatchObject({ side: 'out', name: 'no source in the plan', rate: '0.223 L/h', issue: 'orphan-input' });
    expect(g.edges.filter((e) => e.from === 'missing:fluid:pva@mixer').map((e) => e.toPort)).toEqual(['mixer|in|fluid:pva']);
    expect(nodeOf(g, 'mixer').rows.find((r) => r.key === 'fluid:pva')).toMatchObject({ side: 'in', rate: '0.223 L/h', issue: 'orphan-input' });
    // Half the glue the assembler needs: a "short" stub carries the half that is missing.
    const short = flowGraph({ ...board, flows: board.flows.map((f) => (f.key === 'fluid:glue' ? { ...f, perSecond: f.perSecond / 2 } : f)) }, 'hour');
    expect(nodeOf(short, 'missing:fluid:glue@asm').rows[0]).toMatchObject({ name: 'short', rate: '0.279 L/h', issue: 'short-input' });
    expect(nodeOf(short, 'asm').rows.find((r) => r.key === 'fluid:glue')).toMatchObject({ issue: 'short-input', share: '50%' });
    expect(g.nodes.filter((n) => n.kind === 'missing').map((n) => n.id)).toEqual(['missing:fluid:pva@mixer']);
  });
  it('gives each good left over a sink stub beside the step that makes it', () => {
    const sink = nodeOf(g, 'sink:t:copper_dust@0@saw');
    expect(sink.rows.map((r) => [r.side, r.name])).toEqual([['in', 'left over']]);
    expect(g.edges.filter((e) => e.to === sink.id).map((e) => e.fromPort)).toEqual(['saw|out|t:copper_dust@0']);
    expect(g.nodes.filter((n) => n.kind === 'sink').map((n) => n.id)).toEqual(['sink:t:copper_dust@0@saw']);
  });
  it('labels an arrow with its rate only where a port has two or more, and titles every arrow', () => {
    expect(g.edges.filter((e) => e.label !== undefined).map((e) => [e.from, e.toPort, e.label])).toEqual([
      ['saw', `asm|in|${PLATE}`, '0.02/h'], ['solid', `asm|in|${PLATE}`, '0.98/h']]);
    for (const e of g.edges) expect(e.title).toMatch(/^.+ · .+ · .+ → .+$/);
    expect(g.edges.find((e) => e.from === 'mill')?.title).toBe('1x Copper Wire · 2/h · Advanced Wiremill (1x Copper Wire) → Advanced Assembler (Circuit Board)');
    expect(g.edges.find((e) => e.from === 'import:t:copper_ingot@0@mill')?.title).toBe('Copper Ingot · 1/h · import (bought (made elsewhere)) → Advanced Wiremill (1x Copper Wire)');
    expect(g.edges.find((e) => e.to === 'out')?.title).toBe('Circuit Board · 1/h · Advanced Assembler (Circuit Board) → the target');
  });
  it('marks each step of a good made two ways with its share', () => {
    expect(['solid', 'saw'].map((id) => nodeOf(g, id).rows.find((r) => r.key === PLATE))).toMatchObject([
      { issue: 'multi-producer', share: '98%' }, { issue: 'multi-producer', share: '2%' }]);
  });
  it('draws the target the plan names, not a guess from the flows', () => {
    const two = planOf({ target: 't:b@0', names: { 't:a@0': 'A', 't:b@0': 'B' },
      steps: [mv({ id: 's', outputs: [per('t:a@0', 1), per('t:b@0', 1)] })], flows: [flow('s', 'out', 't:a@0', 1 / H), flow('s', 'out', 't:b@0', 1 / H)] });
    expect(nodeOf(flowGraph(two, 'hour'), 'out')).toMatchObject({ key: 't:b@0', title: 'B' });
    expect(nodeOf(flowGraph({ ...two, target: undefined } as Plan, 'hour'), 'out').key).toBe('t:a@0');   // a plan from before Plan.target
  });
  it('names the arrow a plan flow is drawn as', () => {
    const ids = new Set(g.edges.map((e) => e.id));
    for (const f of board.flows) expect(ids.has(flowEdgeId(f))).toBe(true);
  });
});

describe('flow diagram: the ELK graph (web-stack §7, fix spec §6.2)', () => {
  const child = (elk: ElkNode, id: string): ElkNode => {
    const found = elk.children?.find((c) => c.id === id);
    if (found === undefined) throw new Error(`no ELK child ${id}`);
    return found;
  };
  it('gives every row a fixed port, leaves imports free to sit by their step unless asked, and keeps the target last', () => {
    const elk = toElk(g);
    expect(elk.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    });
    for (const c of elk.children ?? []) {
      expect(c.layoutOptions?.['elk.portConstraints']).toBe('FIXED_POS');
      expect(c.ports?.map((p) => p.id)).toEqual(nodeOf(g, c.id).rows.map((r) => r.port));
    }
    const imports = (elk.children ?? []).filter((c) => c.id.startsWith('import:'));
    expect(imports).toHaveLength(3);
    for (const c of imports) expect(c.layoutOptions?.['elk.layered.layering.layerConstraint']).toBeUndefined();
    expect(child(elk, 'out').layoutOptions?.['elk.layered.layering.layerConstraint']).toBe('LAST');
    const column = toElk(flowGraph(board, 'hour', { importsInOneColumn: true }));
    for (const c of (column.children ?? []).filter((n) => n.id.startsWith('import:'))) expect(c.layoutOptions?.['elk.layered.layering.layerConstraint']).toBe('FIRST');
    // Edges run port to port; only the labelled ones carry a label box.
    expect(elk.edges?.find((e) => e.id === g.edges.find((x) => x.from === 'mill')?.id)).toMatchObject({ sources: [`mill|out|${WIRE}`], targets: ['asm|in|t:copper_wire@0'] });
    expect((elk.edges ?? []).filter((e) => (e.labels ?? []).length > 0)).toHaveLength(2);
  });
  it('holds the steps of a supporting line in a compound node, or draws a collapsed line as one box', () => {
    const open = flowGraph(red, 'hour');
    expect(open.groups.map((grp) => [grp.id, grp.title])).toEqual([['line:fluid:molten.redalloy', 'Red Alloy line']]);
    const elk = toElk(open);
    const line = child(elk, 'line:fluid:molten.redalloy');
    expect(line.children?.map((c) => c.id)).toEqual(expect.arrayContaining(['extract', 'smelt']));
    expect((elk.children ?? []).map((c) => c.id)).not.toContain('smelt');
    expect((elk.children ?? []).map((c) => c.id)).toContain('wire');

    const closed = flowGraph(red, 'hour', { collapsedLines: new Set([RED]) });
    const box = nodeOf(closed, 'line:fluid:molten.redalloy');
    expect(box).toMatchObject({ kind: 'line', key: RED, title: 'Red Alloy line' });
    expect(box.rows.map((r) => [r.side, r.name, r.main === true])).toEqual([
      ['in', 'Copper Ingot', false], ['in', 'Redstone', false], ['out', 'Molten Red Alloy', true]]);
    expect(closed.nodes.map((n) => n.id)).not.toContain('smelt');
    expect(closed.groups).toEqual([]);
    expect(closed.edges.map((e) => [e.fromPort, e.toPort])).toEqual(expect.arrayContaining([
      ['import:t:copper_ingot@0@line:fluid:molten.redalloy|out|t:copper_ingot@0', 'line:fluid:molten.redalloy|in|t:copper_ingot@0'],
      ['line:fluid:molten.redalloy|out|fluid:molten.redalloy', 'wire|in|fluid:molten.redalloy']]));
    const flat = toElk(closed);
    expect((flat.children ?? []).every((c) => c.children === undefined)).toBe(true);
    expect(child(flat, 'line:fluid:molten.redalloy').ports?.length).toBe(3);
  });
  it('collapses supporting lines by default only in a plan of more than 25 steps', () => {
    expect(LINE_COLLAPSE_STEPS).toBe(25);
    expect([...collapsedLines(red, new Map())]).toEqual([]);
    const big = { ...red, steps: [...red.steps, ...Array.from({ length: 23 }, (_, i) => mv({ id: `x${i}` }))] };
    expect(big.steps).toHaveLength(26);
    expect([...collapsedLines(big, new Map())]).toEqual([RED]);
    expect([...collapsedLines(big, new Map([[RED, true]]))]).toEqual([]);           // the group opened it
    expect([...collapsedLines(red, new Map([[RED, false]]))]).toEqual([RED]);        // the group closed it
  });
  it('lays every import right before its step and starts every arrow on the row of its good (ELK in Node)', async () => {
    const check = (laid: FlowLayout): void => {
      const at = new Map(laid.nodes.map((n) => [n.id, n]));
      for (const stub of laid.nodes.filter((n) => n.kind === 'import')) {
        const consumer = at.get(laid.edges.find((e) => e.from === stub.id)!.to)!;
        const gap = consumer.x - (stub.x + stub.width);
        expect(gap, stub.id).toBeGreaterThanOrEqual(0);
        expect(gap, stub.id).toBeLessThanOrEqual(120);
      }
      for (const e of laid.edges) {
        const from = at.get(e.from)!;
        const row = from.rows.findIndex((r) => r.port === e.fromPort);
        expect(row, e.id).toBeGreaterThanOrEqual(0);
        expect(Math.abs(e.points[0]![1] - (from.y + rowCentre(from, row))), e.id).toBeLessThanOrEqual(2);
        const to = at.get(e.to)!;
        const into = to.rows.findIndex((r) => r.port === e.toPort);
        expect(Math.abs(e.points.at(-1)![1] - (to.y + rowCentre(to, into))), e.id).toBeLessThanOrEqual(2);
      }
    };
    check(fromElk(g, await new ELK().layout(toElk(g))));
    // Inside an open supporting line too: its box holds its steps, and positions come back in diagram coordinates.
    const open = flowGraph(red, 'hour');
    const laid = fromElk(open, await new ELK().layout(toElk(open)));
    check(laid);
    const group = laid.groups[0]!;
    for (const id of ['smelt', 'extract']) {
      const n = laid.nodes.find((x) => x.id === id)!;
      expect(n.x).toBeGreaterThan(group.x);
      expect(n.x + n.width).toBeLessThan(group.x + group.width);
      expect(n.y).toBeGreaterThan(group.y);
    }
  });
});

describe('flow diagram: focus (fix spec §6.2)', () => {
  it('lights the makers and takers of an item, a box with its neighbours, an arrow with its ends, or nothing', () => {
    const item = focusSets(g, { kind: 'item', key: PLATE })!;
    expect([...item.producers].sort()).toEqual(['saw', 'solid']);
    expect([...item.consumers]).toEqual(['asm']);
    expect(item.edges.size).toBe(2);
    expect([...item.ports].sort()).toEqual([`asm|in|${PLATE}`, `saw|out|${PLATE}`, `solid|out|${PLATE}`]);
    const node = focusSets(g, { kind: 'node', id: 'mill' })!;
    expect([...node.nodes].sort()).toEqual(['asm', 'import:t:copper_ingot@0@mill', 'mill']);
    expect([...node.producers]).toEqual(['import:t:copper_ingot@0@mill']);
    expect([...node.consumers]).toEqual(['asm']);
    const edge = g.edges.find((e) => e.from === 'mill')!;
    const one = focusSets(g, { kind: 'edge', id: edge.id })!;
    expect([[...one.edges], [...one.nodes].sort(), [...one.ports].sort()]).toEqual([[edge.id], ['asm', 'mill'], [`asm|in|${WIRE}`, `mill|out|${WIRE}`]]);
    expect(focusSets(g, null)).toBeNull();
    expect(focusSets(g, { kind: 'node', id: 'gone' })).toBeNull();   // nothing of it in this plan: nothing dims
  });
  it('writes a lit arrow\'s good and rate on a tag: stretched back from its label at a shared port, else above its longest run', () => {
    const arrow = { name: 'Copper Plate', rate: '0.98/h', points: [[0, 50], [40, 50], [40, 10], [200, 10]] as Array<[number, number]> };
    const text = 'Copper Plate · 0.98/h';
    const width = Math.ceil(text.length * 6.5) + 8;
    // A head label (by the arrow's end): the tag ends where the label ends; a tail label: it starts where the label starts.
    expect(edgeTag({ ...arrow, labelBox: { x: 150, y: 12, width: 46, height: 14 } })).toEqual({ text, width, height: 16, x: 196 - width, y: 11 });
    expect(edgeTag({ ...arrow, labelBox: { x: 2, y: 52, width: 46, height: 14 } })).toEqual({ text, width, height: 16, x: 2, y: 51 });
    expect(edgeTag(arrow)).toEqual({ text, width, height: 16, x: 120 - width / 2, y: 10 - 16 - 2 });   // over the 160 px run across
    expect(edgeTag({ ...arrow, points: [] })).toBeUndefined();
  });
  it('makes a box wide enough that no row name is cut, up to the widest box', () => {
    for (const graph of [g, flowGraph(red, 'hour'), flowGraph(red, 'hour', { collapsedLines: new Set([RED]) })]) {
      for (const n of graph.nodes) {
        if (n.width >= 330) continue;
        for (const r of n.rows) expect(textWidth(r.name, TEXT_CHAR_WIDTH), `${n.id} ${r.port}`).toBeLessThanOrEqual(rowNameRoom(n, r));
      }
    }
  });
  it('finds the box that makes an item first and centres a box in the canvas', () => {
    expect(firstProducer(g, PLATE)).toBe('solid');
    expect(firstProducer(g, 't:copper_ingot@0')).toBe('import:t:copper_ingot@0@mill');
    expect(firstProducer(g, 'fluid:pva')).toBe('missing:fluid:pva@mixer');
    expect(firstProducer(g, 't:board@0')).toBe('asm');
    expect(firstProducer(g, 't:nothing@0')).toBeUndefined();
    expect(centreOn({ x: 100, y: 50, width: 200, height: 100 }, { zoom: 0.9, x: 0, y: 0 }, { width: 800, height: 600 })).toEqual({ zoom: 0.9, x: 220, y: 210 });
  });
});

describe('flow diagram: what it renders (fix spec §6.2)', () => {
  const at0 = (n: FlowNode) => ({ ...n, x: 0, y: 0 });
  const classOf = (html: string): string[] => (html.match(/<g class="([^"]*)" data-node-id/)?.[1] ?? '').split(' ');
  it('lights or dims each box under a focus, with a row per good that lights it in turn', () => {
    const sets = focusSets(g, { kind: 'item', key: WIRE });
    const html = (id: string) => renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(g, id))} sets={sets} /></svg>);
    expect(classOf(html('mill'))).toEqual(expect.arrayContaining(['flow-node', 'step', 'hl', 'producer']));
    expect(classOf(html('asm'))).toEqual(expect.arrayContaining(['hl', 'consumer']));
    expect(classOf(html('mixer'))).toContain('dim');
    expect(classOf(html('mixer'))).not.toContain('hl');
    const mill = html('mill');
    expect(mill).toContain(`data-port="mill|out|${WIRE}"`);
    expect(mill).toContain('aria-label="makes 1x Copper Wire 2/h: show where it goes"');
    expect(mill).toContain('aria-label="takes Copper Ingot 1/h: show where it comes from"');
    expect(mill).toMatch(new RegExp(`<g class="[^"]*flow-row[^"]*\\bhl\\b[^"]*" data-port="mill\\|out\\|${WIRE}"`));
    expect(mill).toMatch(/<g class="[^"]*flow-row[^"]*\bdim\b[^"]*" data-port="mill\|in\|t:copper_ingot@0"/);
    expect(renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(g, 'mill'))} /></svg>)).not.toMatch(/\b(hl|dim)\b/);
    // Only step boxes carry data-step-id (ruling P17); stubs say what they are.
    const stub = renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(g, 'import:t:copper_ingot@0@mill'))} sets={sets} /></svg>);
    expect(stub).not.toContain('data-step-id');
    expect(classOf(stub)).toEqual(expect.arrayContaining(['import', 'leaf-derived', 'dim']));
    expect(renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(g, 'missing:fluid:pva@mixer'))} /></svg>)).toContain('data-kind="missing"');
  });
  it('lists what does not add up above the diagram, each with Show, and Keep only for a good made two ways', () => {
    const send = vi.fn();
    const onShow = vi.fn();
    const html = renderToStaticMarkup(<FlowIssues plan={board} settings={S()} send={send} onShow={onShow} />);
    expect(text(html)).toContain('Nothing supplies Polyvinyl Acetate to Advanced Mixer (Glue): it needs 0.223 L/h and the plan neither makes nor buys it.');
    expect(text(html)).toContain('Copper Plate is made 2 ways: Fluid Solidifier (98%) and Cutting Machine (2%).');
    expect(html).toMatch(/class="flow-issues error"/);                               // red with an input nothing supplies
    const box = FlowIssues({ plan: board, settings: S(), send, onShow });
    const shows = findAll(box, (e) => e.type === 'button' && childText(e) === 'Show');
    expect(shows).toHaveLength(2);
    (shows[0]!.props.onClick as () => void)();
    expect(onShow).toHaveBeenCalledWith('fluid:pva');
    const [keep] = findAll(box, (e) => e.type === 'button' && childText(e) === 'Keep only Fluid Solidifier');
    (keep!.props.onClick as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { recipeChoice: { [PLATE]: 'solid' } } }]);
    // A server text wins over the client's; amber without an input nothing supplies; nothing to say, no box.
    const served = { ...board, warnings: [{ code: 'multi-producer', key: PLATE, stepId: 'solid', text: 'Plates come two ways (server).' }] };
    expect(text(renderToStaticMarkup(<FlowIssues plan={served} settings={S()} send={send} onShow={onShow} />))).toContain('Plates come two ways (server).');
    const fed = { ...board, flows: [...board.flows, flow('raw', 'mixer', 'fluid:pva', 2000 * 3.1e-8)] };
    expect(renderToStaticMarkup(<FlowIssues plan={fed} settings={S()} send={send} onShow={onShow} />)).toMatch(/class="flow-issues"/);
    expect(FlowIssues({ plan: red, settings: S(), send, onShow })).toBeNull();
  });
  it('offers no Keep only for a maker the line runs for another good, and says why', () => {
    // Plan 09's final review (GEC HV, 2 a minute): "Hydrogen Cell is made 2 ways" by water electrolysis and salt water
    // electrolysis, which the line runs for its Chlorine (a canner makes Chlorine too). Keep only pinned the water
    // electrolysis for the cells, but the walk for Chlorine keeps the salt water one: the plan came back the same.
    const H_CELL = 't:h_cell@0';
    const electrolyzer = { mteId: 371, name: 'Advanced Electrolyzer II', tier: 3 };
    const cells = planOf({
      target: 't:hcl@0', targetPerSecond: 1 / H,
      names: { [H_CELL]: 'Hydrogen Cell', 'fluid:chlorine': 'Chlorine', 'fluid:saltwater': 'Salt Water', 't:cl_cell@0': 'Chlorine Cell', 't:hcl@0': 'Acid',
        't:naoh@0': 'Sodium Hydroxide Dust', 't:empty@0': 'Empty Cell', 'fluid:oxygen': 'Oxygen' },
      steps: [
        mv({ id: 'water', machine: electrolyzer, mainOutput: H_CELL, runsPerSecond: 0.485 / H, inputs: [per('t:empty@0', 2), per('fluid:water', 1000)],
          outputs: [per(H_CELL, 2), per('fluid:oxygen', 1000)] }),
        mv({ id: 'brine', machine: electrolyzer, mainOutput: H_CELL, runsPerSecond: 0.03 / H, inputs: [per('t:empty@0', 1), per('fluid:saltwater', 1000)],
          outputs: [per('t:naoh@0', 3), per(H_CELL, 1), per('fluid:chlorine', 1000)] }),
        mv({ id: 'canner', machine: { mteId: 381, name: 'Canning Machine', tier: 2 }, mainOutput: 'fluid:chlorine', runsPerSecond: 0.97 / H,
          inputs: [per('t:cl_cell@0', 1)], outputs: [per('fluid:chlorine', 1000), per('t:empty@0', 1)] }),
        mv({ id: 'reactor', machine: { mteId: 391, name: 'Chemical Reactor', tier: 2 }, mainOutput: 't:hcl@0', runsPerSecond: 1 / H,
          inputs: [per(H_CELL, 1), per('fluid:chlorine', 1000)], outputs: [per('t:hcl@0', 1)] }),
      ],
      flows: [
        flow('water', 'reactor', H_CELL, 0.97 / H), flow('brine', 'reactor', H_CELL, 0.03 / H), flow('brine', 'reactor', 'fluid:chlorine', 30 / H),
        flow('canner', 'reactor', 'fluid:chlorine', 970 / H), flow('brine', 'sink', 't:naoh@0', 0.09 / H), flow('water', 'sink', 'fluid:oxygen', 485 / H),
        flow('reactor', 'out', 't:hcl@0', 1 / H), flow('canner', 'water', 't:empty@0', 0.97 / H), flow('raw', 'brine', 't:empty@0', 0.03 / H),
        flow('raw', 'water', 'fluid:water', 485 / H), flow('raw', 'brine', 'fluid:saltwater', 30 / H), flow('raw', 'canner', 't:cl_cell@0', 0.97 / H),
      ],
    });
    const [line, ...more] = flowIssueLines(cells);
    expect(more).toEqual([]);
    expect(line?.text).toBe('Hydrogen Cell is made 2 ways: Advanced Electrolyzer II (97%) and Advanced Electrolyzer II (3%).');
    expect(line?.keepOnly).toBeUndefined();
    expect(line?.stays).toBe('Keep only would not change this: the 3% comes from Advanced Electrolyzer II, which the line runs for Chlorine.');
    const box = FlowIssues({ plan: cells, settings: S(), send: vi.fn(), onShow: vi.fn() });
    expect(findAll(box, (e) => e.type === 'button' && childText(e).startsWith('Keep only'))).toEqual([]);
    expect(text(renderToStaticMarkup(<FlowIssues plan={cells} settings={S()} send={() => {}} onShow={() => {}} />)))
      .toContain('(3%). Keep only would not change this: the 3% comes from Advanced Electrolyzer II, which the line runs for Chlorine.Show');
    // A third maker it would remove keeps the button, and the note says what it would leave.
    const three = {
      ...cells,
      steps: [...cells.steps, mv({ id: 'press', machine: { mteId: 401, name: 'Cell Press', tier: 2 }, mainOutput: H_CELL, runsPerSecond: 0.01 / H, outputs: [per(H_CELL, 1)] })],
      flows: [...cells.flows.filter((f) => !(f.from === 'water' && f.key === H_CELL)), flow('water', 'reactor', H_CELL, 0.96 / H), flow('press', 'reactor', H_CELL, 0.01 / H)],
    };
    const [partial] = flowIssueLines(three);
    expect(partial?.keepOnly).toEqual({ recipeId: 'water', machine: 'Advanced Electrolyzer II' });
    expect(partial?.stays).toBe('Keep only would still leave the 3% from Advanced Electrolyzer II, which the line runs for Chlorine.');
    // The board's saw only leaves its dust over: Keep only removes it, and there is nothing to add.
    expect(flowIssueLines(board).find((l) => l.issue.code === 'multi-producer')).toMatchObject({ keepOnly: { recipeId: 'solid' } });
    expect(flowIssueLines(board).find((l) => l.issue.code === 'multi-producer')?.stays).toBeUndefined();
  });
  it('offers no Keep only for a step that empties the containers another step fills, and says why', () => {
    // A canner empties the Oxygen Cells a compressor fills (the walk adds such an emptier beside whatever makes the
    // cells, fix spec D14), so pinning the electrolyzer for Oxygen leaves it in the plan.
    const oxygen = planOf({
      target: 't:steel@0', targetPerSecond: 1 / H,
      names: { 'fluid:oxygen': 'Oxygen', 't:o_cell@0': 'Oxygen Cell', 't:empty@0': 'Empty Cell', 't:steel@0': 'Steel' },
      steps: [
        mv({ id: 'electrolyze', machine: { mteId: 371, name: 'Electrolyzer', tier: 2 }, mainOutput: 'fluid:oxygen', runsPerSecond: 0.99 / H,
          inputs: [per('fluid:water', 1000)], outputs: [per('fluid:oxygen', 1000)] }),
        mv({ id: 'fill', machine: { mteId: 382, name: 'Compressor', tier: 2 }, mainOutput: 't:o_cell@0', runsPerSecond: 0.01 / H,
          inputs: [per('t:empty@0', 1)], outputs: [per('t:o_cell@0', 1)] }),
        mv({ id: 'empty', machine: { mteId: 381, name: 'Canning Machine', tier: 2 }, mainOutput: 'fluid:oxygen', runsPerSecond: 0.01 / H,
          inputs: [per('t:o_cell@0', 1)], outputs: [per('fluid:oxygen', 1000), per('t:empty@0', 1)] }),
        mv({ id: 'ebf', machine: { mteId: 1000, name: 'Electric Blast Furnace', tier: 2 }, mainOutput: 't:steel@0', runsPerSecond: 1 / H,
          inputs: [per('fluid:oxygen', 1000)], outputs: [per('t:steel@0', 1)] }),
      ],
      flows: [
        flow('electrolyze', 'ebf', 'fluid:oxygen', 990 / H), flow('empty', 'ebf', 'fluid:oxygen', 10 / H), flow('fill', 'empty', 't:o_cell@0', 0.01 / H),
        flow('empty', 'fill', 't:empty@0', 0.01 / H), flow('ebf', 'out', 't:steel@0', 1 / H), flow('raw', 'electrolyze', 'fluid:water', 990 / H),
      ],
    });
    const [line] = flowIssueLines(oxygen);
    expect(line?.text).toBe('Oxygen is made 2 ways: Electrolyzer (99%) and Canning Machine (1%).');
    expect(line?.keepOnly).toBeUndefined();
    expect(line?.stays).toBe('Keep only would not change this: the 1% comes from Canning Machine, which empties the Oxygen Cell the line makes.');
  });
  it('explains every kind of box in the legend', () => {
    const legend = text(renderToStaticMarkup(<FlowLegend />));
    for (const word of ['Owned', 'New', 'Import', 'Free', 'No source', 'Left over', 'Supporting line', 'Target']) expect(legend).toContain(word);
  });
});
