import { describe, it, expect, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatNumber, formatRate, flowGraph, toElk, fromElk, ocLines, reusePatch, LEAF_WORD, focusSets, centreOn, flowEdgeId, rowCentre,
  collapsedLines, firstProducer, edgeTag, rowNameRoom, textWidth, LINE_COLLAPSE_STEPS, TEXT_CHAR_WIDTH, flowIssueLines, type FlowLayout, type FlowNode,
  machineIconKey, machineReadout, tierSlug, rowsTop, busyTrack, chipWidth, MACHINE_ICON, MACHINE_SLOT, STEP_HEAD_HEIGHT, BUSY_BAND, CHIP_HEIGHT,
  CHIP_PADDING, CHIP_CHAR_WIDTH, recipeSlots, stackText, recipeStats, ocChips, powerShare, chanceTag,
} from '../../src/client/views/flow-model.ts';
import { PSEUDO_MACHINE_ENTRIES } from '../../src/server/pack/machines.ts';
import { TIER_NAMES } from '../../src/shared/gt/tiers.ts';
import { formatNumber as sharedNumber, formatRate as sharedRate } from '../../src/shared/format.ts';
import { FlowView, FlowNodeShape, FlowIssues, FlowLegend, disjoint, outsideWindow } from '../../src/client/views/FlowView.tsx';
import { StepPanel } from '../../src/client/views/StepPanel.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import { settingsHash } from '../../src/shared/project/settings-hash.ts';
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
/** `p` as the plan of `s` (its `settingsHash`): the replan for those settings has arrived. */
const planFor = (p: Plan, s: PlanSettings): Plan => ({ ...p, settingsHash: settingsHash(s) });
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
  it('says when a step shares its machines with other steps (plan 12)', () => {
    // The hammer steps of Task 5's AE2 sand plan: one forge hammer for both.
    const pool = { id: 'pool:hammer-gravel', steps: ['hammer-gravel', 'hammer-sand'] };
    const hammer = (id: string, out: string): PlanStep => mv({ id, machine: { mteId: 481, name: 'Basic Forge Hammer', tier: 1 }, euPerTick: 16,
      utilization: 1 / 30, mainOutput: out, outputs: [per(out, 1)], pool });
    const shared = flowGraph(planOf({ tier: 1, steps: [hammer('hammer-gravel', 't:gravel@0'), hammer('hammer-sand', 't:sand@0'),
      mv({ id: 'smelt', machine: { mteId: 151, name: 'Basic Electric Furnace', tier: 1 }, euPerTick: 16, utilization: 1 / 30, mainOutput: 't:glass@0', outputs: [per('t:glass@0', 1)] })],
      names: { 't:gravel@0': 'Gravel', 't:sand@0': 'Sand', 't:glass@0': 'Glass' } }), 'min');
    expect(nodeOf(shared, 'hammer-gravel').lines).toEqual(['LV · 16 EU/t · 1 shared machine · 3% busy']);
    expect(nodeOf(shared, 'smelt').lines).toEqual(['LV · 16 EU/t · 1 machine · 3% busy']);
    const two = flowGraph(planOf({ steps: [mv({ id: 'p', count: 2, pool: { id: 'pool:p', steps: ['p', 'q'] } })] }), 'min');
    expect(nodeOf(two, 'p').lines[0]).toContain('2 shared machines');
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
  // Phase 2 spec §6.4 and P2-D36: a collapsed line's open button tells its name in its tooltip, and an arrow's tooltip has three lines,
  // its good, its rate and its route, which its title (its accessible name) runs together
  it('tells a line\'s open button and every arrow\'s good, rate and route in their tooltips', () => {
    const closed = flowGraph(red, 'hour', { collapsedLines: new Set([RED]) });
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(closed, 'line:fluid:molten.redalloy'))} /></svg>);
    expect(html).toContain('data-tip="Open the Red Alloy line"');
    expect(html).not.toContain('<title');
    const { edges } = flowGraph(plan, 'min');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(e.title, e.id).toBe(`${e.name} · ${e.rate} · ${e.route}`);
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
  it('says when Keep only may not take a maker out, and drops it once the pin is in place', () => {
    // Plan 09's final review (GEC HV, 2 a minute): "Hydrogen Cell is made 2 ways" by water electrolysis and salt water
    // electrolysis, which the line runs for its Chlorine (a canner makes Chlorine too). Keep only pinned the water
    // electrolysis for the cells, but the walk for Chlorine keeps the salt water one: the plan came back the same. The
    // client sees only the plan, so before the click that is a guess (the review of the follow-up found it wrong 2 times
    // in 15); once the recipe is pinned and the issue is still there, it is a fact.
    const H_CELL = 't:h_cell@0';
    const electrolyzer = { mteId: 371, name: 'Advanced Electrolyzer II', tier: 3 };
    const cells = planOf({
      target: 't:hcl@0', targetPerSecond: 1 / H,
      names: { [H_CELL]: 'Hydrogen Cell', 'fluid:chlorine': 'Chlorine', 'fluid:saltwater': 'Salt Water', 't:cl_cell@0': 'Chlorine Cell', 't:hcl@0': 'Acid',
        't:naoh@0': 'Sodium Hydroxide Dust', 't:empty@0': 'Empty Cell', 'fluid:oxygen': 'Oxygen', 'fluid:water': 'Water' },
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
    const [line, ...more] = flowIssueLines(cells, undefined, S());
    expect(more).toEqual([]);
    expect(line?.text).toBe('Hydrogen Cell is made 2 ways: Advanced Electrolyzer II (97%) and Advanced Electrolyzer II (3%).');
    // Both makers are the same machine: each is named by the input that sets it apart, the button too.
    expect(line?.keepOnly).toEqual({ recipeId: 'water', machine: 'Advanced Electrolyzer II on Water' });
    expect(line?.stays).toBe('Keep only may not change this: the 3% comes from the Advanced Electrolyzer II on Salt Water, which the line runs for Chlorine.');
    expect(text(renderToStaticMarkup(<FlowIssues plan={cells} settings={S()} send={() => {}} onShow={() => {}} />)))
      .toContain('(3%). Keep only may not change this: the 3% comes from the Advanced Electrolyzer II on Salt Water, which the line runs for Chlorine.ShowKeep only Advanced Electrolyzer II on Water');
    // The review of the follow-up: on PTFE HV the same Keep only came back after it was clicked. With the pin in place it
    // would change nothing: no button, and the line says what stays.
    const pinned = S({ recipeChoice: { [H_CELL]: 'water' } });
    const [after] = flowIssueLines(planFor(cells, pinned), undefined, pinned);
    expect(after?.keepOnly).toBeUndefined();
    expect(after?.stays).toBe('Advanced Electrolyzer II on Water is pinned for Hydrogen Cell: the 3% still comes from the Advanced Electrolyzer II on Salt Water, which the line runs for Chlorine.');
    expect(findAll(FlowIssues({ plan: planFor(cells, pinned), settings: pinned, send: vi.fn(), onShow: vi.fn() }), (e) => e.type === 'button' && childText(e).startsWith('Keep only'))).toEqual([]);
    // A pin of the smaller maker's recipe is in place too: Keep only would only move it (a replan can make the pinned
    // maker the smaller one: Robot Arm (MV) at HV, Hydrochloric Acid).
    const brine = S({ recipeChoice: { [H_CELL]: 'brine' } });
    const [moved] = flowIssueLines(planFor(cells, brine), undefined, brine);
    expect(moved?.keepOnly).toBeUndefined();
    expect(moved?.stays).toBe('Advanced Electrolyzer II on Salt Water is pinned for Hydrogen Cell: the 97% still comes from the Advanced Electrolyzer II on Water.');
    // A pin of a recipe no maker runs (the plan does not honour it) is not in place.
    const gone = S({ recipeChoice: { [H_CELL]: 'gone' } });
    expect(flowIssueLines(planFor(cells, gone), undefined, gone)[0]?.keepOnly).toEqual({ recipeId: 'water', machine: 'Advanced Electrolyzer II on Water' });
    // A third maker the pin would remove: the note says only what it may leave.
    const three = {
      ...cells,
      steps: [...cells.steps, mv({ id: 'press', machine: { mteId: 401, name: 'Cell Press', tier: 2 }, mainOutput: H_CELL, runsPerSecond: 0.01 / H, outputs: [per(H_CELL, 1)] })],
      flows: [...cells.flows.filter((f) => !(f.from === 'water' && f.key === H_CELL)), flow('water', 'reactor', H_CELL, 0.96 / H), flow('press', 'reactor', H_CELL, 0.01 / H)],
    };
    const [partial] = flowIssueLines(three, undefined, S());
    expect(partial?.keepOnly).toEqual({ recipeId: 'water', machine: 'Advanced Electrolyzer II on Water' });
    expect(partial?.stays).toBe('Keep only may still leave the 3% from the Advanced Electrolyzer II on Salt Water, which the line runs for Chlorine.');
    expect(flowIssueLines(planFor(three, pinned), undefined, pinned)[0]?.stays)
      .toBe('Advanced Electrolyzer II on Water is pinned for Hydrogen Cell: the 3% still comes from the Advanced Electrolyzer II on Salt Water, which the line runs for Chlorine; the 1.0% still comes from Cell Press.');
    // The board's saw only leaves its dust over: Keep only removes it, and there is nothing to add; pinned, it says so.
    expect(flowIssueLines(board).find((l) => l.issue.code === 'multi-producer')).toMatchObject({ keepOnly: { recipeId: 'solid', machine: 'Fluid Solidifier' } });
    expect(flowIssueLines(board).find((l) => l.issue.code === 'multi-producer')?.stays).toBeUndefined();
    const solid = S({ recipeChoice: { [PLATE]: 'solid' } });
    expect(flowIssueLines(planFor(board, solid), undefined, solid).find((l) => l.issue.code === 'multi-producer'))
      .toMatchObject({ stays: 'Fluid Solidifier is pinned for Copper Plate: the 2% still comes from Cutting Machine.' });
    // Review of the follow-ups: Keep only changes the settings at once, but the plan on screen stays the one before the pin
    // until the replan arrives (1 to 5 s), and from it the line read "… is pinned for Hydrogen Cell: the 3% still comes
    // from …" before any plan had the pin. The pin is set: until the plan of those settings arrives, the line says so.
    const before = planFor(cells, S());
    for (const waiting of [flowIssueLines(before, undefined, pinned)[0], flowIssueLines(before, undefined, brine)[0], flowIssueLines(before, undefined, gone)[0]]) {
      expect(waiting).toMatchObject({ text: 'Hydrogen Cell is made 2 ways: Advanced Electrolyzer II (97%) and Advanced Electrolyzer II (3%).', stays: 'Updating…' });
      expect(waiting?.keepOnly).toBeUndefined();
    }
    const box = FlowIssues({ plan: before, settings: pinned, send: vi.fn(), onShow: vi.fn() });
    expect(findAll(box, (e) => e.type === 'button').map(childText)).toEqual(['Show']);
    expect(text(renderToStaticMarkup(<FlowIssues plan={before} settings={pinned} send={() => {}} onShow={() => {}} />))).toContain('(3%). Updating…Show');
    // Without a pin the line offers Keep only whatever plan is on screen, and the plan of the pin decides as above.
    expect(flowIssueLines(before, undefined, S())[0]?.keepOnly).toEqual({ recipeId: 'water', machine: 'Advanced Electrolyzer II on Water' });
  });
  it('says Keep only may not take out a step that empties the containers another step fills', () => {
    // A canner empties the Oxygen Cells a compressor fills (the walk adds such an emptier beside whatever makes the
    // cells, fix spec D14), so pinning the electrolyzer for Oxygen may leave it in the plan.
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
    const [line] = flowIssueLines(oxygen, undefined, S());
    expect(line?.text).toBe('Oxygen is made 2 ways: Electrolyzer (99%) and Canning Machine (1%).');
    expect(line?.keepOnly).toEqual({ recipeId: 'electrolyze', machine: 'Electrolyzer' });
    expect(line?.stays).toBe('Keep only may not change this: the 1% comes from Canning Machine, which empties the Oxygen Cell the line makes.');
    const electrolyze = S({ recipeChoice: { 'fluid:oxygen': 'electrolyze' } });
    expect(flowIssueLines(planFor(oxygen, electrolyze), undefined, electrolyze)[0]?.stays)
      .toBe('Electrolyzer is pinned for Oxygen: the 1% still comes from Canning Machine, which empties the Oxygen Cell the line makes.');
  });
  it('explains every kind of box in the legend', () => {
    const legend = text(renderToStaticMarkup(<FlowLegend />));
    for (const word of ['Owned', 'New', 'Import', 'Free', 'No source', 'Left over', 'Supporting line', 'Target']) expect(legend).toContain(word);
  });
});

// Phase 2 spec §7 (Task 4): a step box's head is a machine readout, its machine's icon in a slot, its tier and count on chips and its power,
// over a band filled to how busy its machines are; the box's words (`lines`) stay as they were, its name and its tip. Plan rulings
// pseudo-tier-chip (a crafting table or furnace has no voltage tier, so no tier chip), farm-step-readout (add-on 17's farms are machine
// steps) and digits-mixed (a count's digits in VT323, its × in Pixelify); ledger ruling P2-R8 (a chip is 10 px a character, so the widest
// tier label fits in the fallback face too).
describe('flow diagram: machine readouts', () => {
  const at0 = (n: FlowNode) => ({ ...n, x: 0, y: 0 });
  it('keys a machine\'s icon by its MTE id, a pseudo machine as the server does, and a hand step none', () => {
    expect(machineIconKey({ mteId: 121, name: 'Basic Assembler', tier: 1 }, false)).toBe('gregtech:gt.blockmachines@121');
    for (const m of PSEUDO_MACHINE_ENTRIES) expect(machineIconKey({ mteId: m.mteId, name: m.name, tier: 0 }, false), m.name).toBe(m.itemKey);   // src/server/pack/machines.ts:41-44
    expect(machineIconKey({ mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, true)).toBeNull();
    expect(machineIconKey({ mteId: -3, name: 'By hand', tier: 0 }, false)).toBeNull();                    // PSEUDO_MACHINES.HAND has no item
  });
  it('reads a step\'s tier, machines, power and how busy it is', () => {
    expect(machineReadout(step({}))).toEqual({ iconKey: 'gregtech:gt.blockmachines@121', tier: { name: 'LV', slug: 'lv' }, count: '×5', power: '16 EU/t', busy: 1, busyText: '100%', high: true });
    expect(machineReadout(step({ count: 1, pool: { id: 'pool:a', steps: ['a', 'circuit-lv'] } })).count).toBe('×1 shared');
    expect(machineReadout(step({ utilization: 0.625 }))).toMatchObject({ busy: 0.625, busyText: '63%', high: false });
    expect(machineReadout(step({ utilization: 0.9 })).high).toBe(true); expect(machineReadout(step({ utilization: 1.4 })).busy).toBe(1);
    expect(machineReadout(step({ euPerTick: 0 })).power).toBeNull();
    expect(machineReadout(step({ handCraft: true, machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 } }))).toMatchObject({ iconKey: null, tier: null, count: null, power: null });
    expect(machineReadout(step({ machine: { mteId: -2, name: 'Furnace', tier: 0 }, euPerTick: 0 })))   // no voltage tier, so no chip (plan ruling pseudo-tier-chip)
      .toMatchObject({ iconKey: 'minecraft:furnace@0', tier: null, count: '×5', power: null });
    // the band never fills past its track or below nothing, and its words are the box's own (lines[0]'s "… · 140% busy")
    expect(machineReadout(step({ utilization: 1.4 })).busyText).toBe('140%');
    expect(machineReadout(step({ utilization: -0.2 })).busy).toBe(0); expect(machineReadout(step({ utilization: Number.NaN })).busy).toBe(0);
  });
  it('slugs a tier for its colour class, and an unknown one as unknown', () => {
    expect([0, 1, 6, 14].map(tierSlug)).toEqual(['ulv', 'lv', 'luv', 'max']); expect(tierSlug(15)).toBe('unknown'); expect(tierSlug(-1)).toBe('unknown');
    expect(tierSlug(1.5)).toBe('unknown');
  });
  it('starts a readout box\'s rows below its 46 px head and 16 px busy band', () => {
    const box = nodeOf(flowGraph(plan, 'min'), 'circuit-lv');
    expect(box.machine).toBeDefined(); expect(rowsTop(box)).toBe(46 + 16 + 16 * (box.lines.length - 1));
    expect(rowsTop({ ...box, avoidBadge: { text: 'x', warnings: [] } })).toBe(46 + 16 + 16 * box.lines.length);
    expect(rowsTop({ ...box, machine: undefined })).toBe(28 + 16 * box.lines.length);   // a stub, as today
    expect(box.lines).toEqual(['LV · 16 EU/t · 5 machines · 100% busy']);                    // the words stay (:71)
    expect([MACHINE_ICON, MACHINE_SLOT, STEP_HEAD_HEIGHT, BUSY_BAND, CHIP_HEIGHT, CHIP_PADDING]).toEqual([32, 36, 46, 16, 16, 5]);
    // only a step has a readout: a stub, the target and a collapsed line keep their heads
    const closed = flowGraph(red, 'hour', { collapsedLines: new Set([RED]) });
    expect(closed.nodes.filter((n) => n.machine !== undefined).map((n) => n.id)).toEqual(['wire']);
    expect(g.nodes.filter((n) => n.machine === undefined).map((n) => n.kind).sort()).toEqual(['import', 'import', 'import', 'missing', 'out', 'sink']);
  });
  it('draws a readout box\'s machine, chips and busy bar in its head', () => {
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(flowGraph(plan, 'min'), 'circuit-lv'))} /></svg>);
    expect(html).toContain('<g class="flow-machine" aria-hidden="true">'); expect(html).toContain('data-item-key="gregtech:gt.blockmachines@121"');
    expect(html).toMatch(/<g class="flow-chip tier-lv" transform="translate\(52 25\)"><rect width="30" height="16"><\/rect><text x="15" y="12.5">LV<\/text><\/g>/);
    expect(html).toContain('>×<tspan class="fig">5</tspan></text>'); expect(html).toContain('>16 EU/t</text>'); expect(html).toContain('<g class="flow-busy high">');   // a count's digits in VT323 (spec §25)
    const node = at0(nodeOf(flowGraph(plan, 'min'), 'circuit-lv'));
    expect(html).toContain(`<rect class="flow-busy-fill" x="8" y="51" width="${busyTrack(node)}" height="6">`);
    expect(html.match(/<g class="([^"]*)" data-node-id/)?.[1]).toBe('flow-node step new'); expect(html).not.toMatch(/\b(hl|dim)\b/); expect(html).not.toContain('<circle');
    // the slot and its 2 px bevel, the 32 px icon filling its own foreignObject inside it, the count chip 4 px after the tier's and the
    // power 6 px after the count's; the band's track, and its words at the box's right edge
    expect(html).toContain('<rect class="flow-machine-slot" x="8" y="6" width="36" height="36"></rect><path class="flow-slot-lo" d="M 8 6 H 44 V 8 H 10 V 42 H 8 Z"></path><path class="flow-slot-hi" d="M 44 6 V 42 H 8 V 40 H 42 V 6 Z"></path><foreignObject x="10" y="8" width="32" height="32"><span class="item-icon');
    expect(html).toContain('<g class="flow-chip" transform="translate(86 25)"><rect width="30" height="16"></rect><text x="15" y="12.5">×<tspan class="fig">5</tspan></text></g><text class="flow-node-power" x="122" y="37">16 EU/t</text>');
    expect(html).toContain(`<rect class="flow-busy-track" x="8" y="51" width="${busyTrack(node)}" height="6"></rect>`);
    expect(html).toContain(`<text class="flow-busy-text" x="${node.width - 8}" y="57">100%</text>`);
    // the title beside the slot, on its baseline; no 16 px head icon and no first line: the readout draws them
    expect(html).toContain('<text class="flow-node-title" x="52" y="19">Basic Assembler</text>');
    expect(html).not.toContain('class="flow-node-line"');
    expect(html.match(/<foreignObject [^>]*>/g)).toEqual(['<foreignObject x="10" y="8" width="32" height="32">', expect.stringContaining('width="16" height="16"'), expect.stringContaining('width="16" height="16"')]);
    // the words stay the box's name and tip
    expect(html).toContain('aria-label="Basic Assembler, LV · 16 EU/t · 5 machines · 100% busy"');
    expect(html).toContain('data-tip="Basic Assembler\nLV · 16 EU/t · 5 machines · 100% busy\ntakes Redstone 30/min\nmakes Basic Circuit 30/min"');
  });
  it('draws a pseudo machine\'s count chip first, and a hand step\'s "by hand" with no chip', () => {
    const box = (s: PlanStep): string => renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(flowGraph({ ...plan, steps: [s] } as Plan, 'min'), 'circuit-lv'))} /></svg>);
    const furnace = box({ ...plan.steps[0]!, machine: { mteId: -2, name: 'Furnace', tier: 0 }, euPerTick: 0 });
    expect(furnace).toContain('<g class="flow-chip" transform="translate(52 25)"><rect width="30" height="16"></rect><text x="15" y="12.5">×<tspan class="fig">5</tspan></text></g>');
    expect(furnace).not.toContain('flow-chip tier-'); expect(furnace).toContain('data-item-key="minecraft:furnace@0"');
    const hand = box({ ...plan.steps[0]!, handCraft: true, machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, euPerTick: 0 });
    expect(hand).toContain('<text class="flow-node-power" x="52" y="37">by hand</text>'); expect(hand).not.toContain('flow-chip');
    expect(hand).toMatch(/<foreignObject x="10" y="8" width="32" height="32"><span class="item-icon[^>]*data-item-key="t:circuit@0"/);   // its slot shows its main output
    expect(hand).toContain('<g class="flow-busy high">');                                                     // it keeps its band
    // a hand step that makes nothing in particular has an empty slot
    expect(box({ ...plan.steps[0]!, handCraft: true, mainOutput: undefined, machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 } }))
      .not.toContain('<foreignObject x="10" y="8"');
  });
  it('reads a farm step as the farm machine it needs, tier chip and all, and cuts its farm words below the band', () => {
    // add-on 17: a Tree Growth Simulator's tier is its energy hatch's and a Crop Manager's its own, voltage tiers both, so plan ruling pseudo-tier-chip does not apply
    const words = 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw and Knife (Steel) in an input bus';
    const tgs: PlanStep = { ...plan.steps[0]!, machine: { mteId: 15541, name: 'Tree Growth Simulator', tier: 1 }, count: 1, euPerTick: 30, utilization: 0.5,
      farm: { kind: 'tgs', tier: 1, footprint: [7, 7, 7], text: words, sapling: 't:rubber_sapling@0', tools: ['gregtech:gt.metatool.01@10'] } };
    expect(machineReadout(tgs)).toEqual({ iconKey: 'gregtech:gt.blockmachines@15541', tier: { name: 'LV', slug: 'lv' }, count: '×1', power: '30 EU/t', busy: 0.5, busyText: '50%', high: false });
    // a Crop Manager draws a fraction of an EU/t: its recipe's EU/t × the 121 crop sticks it tends (farmOc)
    expect(machineReadout({ ...tgs, machine: { mteId: 28001, name: 'Basic Crop Manager', tier: 1 }, euPerTick: (4.5235540375 / 5120) * 121 }))
      .toMatchObject({ iconKey: 'gregtech:gt.blockmachines@28001', tier: { name: 'LV', slug: 'lv' }, count: '×1', power: '0.107 EU/t' });
    const box = nodeOf(flowGraph({ ...plan, steps: [tgs] } as Plan, 'min'), 'circuit-lv');
    expect(box.lines).toEqual(['LV · 30 EU/t · 1 machine · 50% busy', words]);   // the words keep the whole sentence
    expect(box.width).toBe(330); expect(rowsTop(box)).toBe(46 + 16 + 16);
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(box)} /></svg>);
    expect(html).toContain('data-item-key="gregtech:gt.blockmachines@15541"'); expect(html).toContain('<g class="flow-chip tier-lv" transform="translate(52 25)">');
    expect(html).toContain('<text class="flow-node-line" x="8" y="73">Tree Growth Simulator (LV): Rubber Sapling in the…</text>');
    expect(html).not.toContain('t:rubber_sapling@0');                                                         // the slot never shows the sapling
    expect(html).toContain(`data-tip="Tree Growth Simulator\nLV · 30 EU/t · 1 machine · 50% busy\n${words}\n`);   // the tip keeps them whole
  });
  it('sizes a readout box to its head, its chip row and its band, and puts a second line and the badge below the band', () => {
    // the chip row of a UMV pool step: 52 + 40 (UMV) + 4 + 110 (×12 shared) + 6 + 62 (1,920 EU/t) + 8; the band alone needs 120
    const pooled = step({ machine: { mteId: 121, name: 'Basic Assembler', tier: 12 }, count: 12, euPerTick: 1920, pool: { id: 'pool:a', steps: ['a', 'circuit-lv'] } });
    expect(nodeOf(flowGraph({ ...plan, steps: [pooled] } as Plan, 'min'), 'circuit-lv').width).toBe(52 + 40 + 4 + 110 + 6 + 62 + 8);
    expect(machineReadout(pooled)).toMatchObject({ tier: { name: 'UMV', slug: 'umv' }, count: '×12 shared', power: '1,920 EU/t' });
    expect(8 + 60 + 6 + textWidth('>99.9%', TEXT_CHAR_WIDTH) + 8).toBe(120);
    expect(busyTrack({ width: 190 })).toBe(130); expect(busyTrack({ width: 330 })).toBe(270);
    // a long machine name sizes the head: 8 + 36 + 8 + its 13 px title + 8, up to the widest box
    const named = (name: string): number => nodeOf(flowGraph({ ...plan, steps: [step({ machine: { mteId: 121, name, tier: 1 } })] } as Plan, 'min'), 'circuit-lv').width;
    expect(named('Electric Blast Furnace Controller')).toBe(60 + textWidth('Electric Blast Furnace Controller', 7.4));
    expect(named('Extremely Advanced Large Multiblock Assembling Machine')).toBe(330);
    // an owned step's second line and the avoid badge, below the band
    const text = 'Basic Assembler uses Redstone — no recipe at LV avoids it';
    const owned = flowGraph({ ...plan, steps: [step({ owned: 2, inputs: plan.steps[0]!.inputs, outputs: plan.steps[0]!.outputs })],
      warnings: [{ code: 'avoid-unavoidable', key: 't:redstone@0', stepId: 'circuit-lv', text }] } as Plan, 'min');
    const box = nodeOf(owned, 'circuit-lv');
    expect(box.lines).toEqual(['LV · 16 EU/t · 5 machines · 100% busy', '2 owned']);
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(box)} /></svg>);
    expect(html).toContain('<text class="flow-node-line" x="8" y="73">2 owned</text>');
    expect(html).toContain('<g class="flow-avoid-badge" data-avoid-badge="" transform="translate(4 78)">');
    expect(rowsTop(box)).toBe(46 + 16 + 16 + 16);
    expect(html).toContain(`<rect class="flow-hit" width="${box.width}" height="${rowsTop(box)}"></rect>`);   // the head's hit area holds the band
  });
  it('makes every chip wide enough for its text in Pixelify and in its fallback, MAX in bold too (ledger ruling P2-R8)', () => {
    expect(CHIP_CHAR_WIDTH).toBe(10);
    expect(chipWidth('MAX')).toBe(40); expect(chipWidth('LV')).toBe(30); expect(chipWidth('×1 shared')).toBe(100);
    // measured in Chromium at 13 px ($SCRATCH/p2/4/probe-chips.mjs): with the web fonts refused the tier labels are the fallback's
    // (Helvetica here), wider than Pixelify's, MAX in bold; at 9 px a character MV, HV, UV, ZPM, UHV, UMV and MAX spilled into the padding
    const FALLBACK: Record<string, number> = {
      ULV: 24.34, LV: 14.95, MV: 19.5, HV: 18.06, EV: 17.34, IV: 12.3, LuV: 23.14, ZPM: 27.45, UV: 18.06, UHV: 27.45, UEV: 26.73, UIV: 21.67,
      UMV: 28.89, UXV: 26.73, MAX: 28.89,
    };
    const PIXELIFY: Record<string, number> = {
      ULV: 22.86, LV: 15.25, MV: 17.59, HV: 15.25, EV: 15.25, IV: 12.88, LuV: 22.61, ZPM: 25.22, UV: 15.25, UHV: 22.86, UEV: 22.86, UIV: 20.5,
      UMV: 24.95, UXV: 22.61, MAX: 25.16,
    };
    for (const name of TIER_NAMES) {
      expect(chipWidth(name) - 2 * CHIP_PADDING, name).toBeGreaterThanOrEqual(FALLBACK[name]!);
      expect(chipWidth(name) - 2 * CHIP_PADDING, name).toBeGreaterThanOrEqual(PIXELIFY[name]!);
    }
    // a count's × in Pixelify and its digits in VT323 (the fallback: Menlo, size-adjusted), the wider of the two faces (spec §25)
    for (const [count, widest] of [['×2', 14.52], ['×5', 14.52], ['×1 shared', 62.64], ['×128', 28.34], ['×1024', 35.25]] as const) {
      expect(chipWidth(count) - 2 * CHIP_PADDING, count).toBeGreaterThanOrEqual(widest);
    }
  });
});

// The recipe card's numbers (Phase 2 spec §8.2, §8.5; Task 5a): what one run takes and makes as NEI's slots draw it, the stack counts as
// Minecraft writes them, the four readouts, the overclock chips and how full the energy bar is. A crop farm's expected drop below one item is
// drawn as one at that chance, a fluid keeps its litres, and a tree farm's tool keeps the chance it wears at (plan ruling farm-step-card).
describe('the recipe card\'s numbers', () => {
  // the overclocked step of 'explains the overclock': an MV bending machine, its 100 t recipe in 50 t
  const mvStep = step({ machine: { mteId: 102, name: 'Advanced Bending Machine', tier: 2 }, durationTicks: 50, overclocks: 1,
    oc: { recipeEuPerTick: 24, recipeDurationTicks: 100, machineVoltage: 128, machineAmps: 1, perfect: false, heatOverclocks: 0 } });
  it('writes stack counts as Minecraft does', () => {
    expect([1, 2, 64, 1500, 12000].map((n) => stackText('t:x@0', n))).toEqual(['', '2', '64', '1.5k', '12k']);
    expect([72, 144, 1000, 2300, 12000, 1_000_000].map((n) => stackText('fluid:water', n))).toEqual(['72L', '144L', '1B', '2.3B', '12B', '1kB']);
    // a value that rounds to 1,000 of its unit is written in the next one, as compactNumber rolls up
    expect([stackText('fluid:water', 999_500), stackText('fluid:water', 9_960), stackText('t:x@0', 999.6), stackText('t:x@0', 9_960)]).toEqual(['1kB', '10B', '1k', '10k']);
    // and so on past 999k items and 999 kB: the next unit, so a count stays a few glyphs in its 36 px slot
    expect([stackText('t:x@0', 999_500), stackText('t:x@0', 1_500_000), stackText('fluid:water', 2_000_000_000)]).toEqual(['1M', '1.5M', '2MB']);
  });
  it('writes a chance tag short enough for its slot: whole percents, "<1%" below one, and never "100%" below a hundred', () => {
    // measured in the app: Pixelify's % is 12.1 px and VT323's digits 6.45 px, so "<0.1%" (39.9 px), "99.5%" (37.9) and ">99%" (33.4) pass
    // the 32 px a tag has in its 36 px slot (2 px in, its 2 px shadow), and "<1%" (27.0) and "99%" (25.0) stay inside
    expect([0.1, 0.125, 0.9, 0.01, 0.0099, 0.005, 0.0005, 0.99, 0.995, 0.9995].map(chanceTag))
      .toEqual(['10%', '13%', '90%', '1%', '<1%', '<1%', '<1%', '99%', '99%', '99%']);
  });
  it('gives a slot its nominal amount and its chance, and drops what a run never makes', () => {
    const [slot] = recipeSlots([{ key: 't:dust@0', amount: 0.1, chance: 0.1 }]);
    expect(slot!.amount).toBeCloseTo(1); expect(slot!.chance).toBe(0.1); expect(recipeSlots([{ key: 't:x@0', amount: 0, chance: 1 }])).toEqual([]);
  });
  it('draws an item a run makes less than one of as one at that chance, and keeps the litres of a fluid and the chance of a tool', () => {
    expect(recipeSlots([{ key: 't:resin@0', amount: 0.9, chance: 1 }])).toEqual([{ key: 't:resin@0', amount: 1, chance: 0.9 }]);   // a crop harvest's expected drop
    expect(recipeSlots([{ key: 't:rubber_wood@0', amount: 6.18, chance: 1 }])).toEqual([{ key: 't:rubber_wood@0', amount: 6.18, chance: 1 }]); expect(stackText('t:rubber_wood@0', 6.18)).toBe('6');
    expect(recipeSlots([{ key: 'fluid:water', amount: 0.5, chance: 1 }])).toEqual([{ key: 'fluid:water', amount: 0.5, chance: 1 }]);
    expect(recipeSlots([{ key: 'gregtech:gt.metatool.01@10', amount: 1 / 512, chance: 1 / 512 }])).toEqual([{ key: 'gregtech:gt.metatool.01@10', amount: 1, chance: 1 / 512 }]);
  });
  it('reads the machines, how busy, and the power each and in all', () => {
    expect(recipeStats(step({ count: 1, utilization: 0.5 }))).toEqual([{ label: 'Machines', value: '×1' }, { label: 'Busy', value: '50%' }, { label: 'EU/t each', value: '16' }, { label: 'EU/t total', value: '16' }]);
    expect(recipeStats(step({ count: 2, reused: { count: 0, where: [], others: [{ mteId: 2, name: 'x', tier: 2, count: 1, where: [], euPerTick: 24, runsPerSecondPerMachine: 1 }] } })).at(-1)).toEqual({ label: 'EU/t total', value: '56' });
    expect(recipeStats(step({ pool: { id: 'pool:a', steps: ['a', 'b'] } }))[0]!.label).toBe('Shared machines');
    expect(recipeStats(step({ handCraft: true }))).toEqual([{ label: 'Busy', value: '100%' }]);
  });
  it('says what overclocking did as chips', () => {
    expect(ocChips(step({}))).toEqual([{ text: 'No overclock at LV', tone: 'now' }]);
    expect(ocChips(mvStep)).toEqual([{ text: '1 overclock at MV', tone: 'now' }, { text: '2× faster', tone: 'note' }]);   // 100 t → 50 t
    expect(ocChips({ ...mvStep, oc: { ...mvStep.oc!, heatOverclocks: 2 } }).at(-1)).toEqual({ text: '2 perfect from heat', tone: 'note' });
    expect(ocChips({ ...mvStep, oc: { ...mvStep.oc!, perfect: true } }).at(-1)).toEqual({ text: 'perfect overclocks', tone: 'note' });
    expect(ocChips(step({ handCraft: true }))).toEqual([]);
    // nor on a crafting table or a furnace: they have no voltage tier to name, as they have no tier chip (plan ruling pseudo-tier-chip)
    for (const mteId of [-1, -2]) expect(ocChips(step({ machine: { mteId, name: 'Furnace', tier: 0 }, euPerTick: 0, oc: undefined })), String(mteId)).toEqual([]);
  });
  it('fills the energy bar to the share of what the machine can draw', () => {
    expect(powerShare(step({}))).toBe(0.5); expect(powerShare(step({ oc: undefined }))).toBe(0.5);   // 16 of LV's 32 V × 1 A
    expect(powerShare(step({ handCraft: true }))).toBeNull(); expect(powerShare(step({ euPerTick: 0 }))).toBeNull();
  });
});

// Ledger ruling P2-R35: the step panel that takes the focus after a pick inside the old one moves the page only when its head is outside the
// window, wholly: a head the window shows, even in part, keeps the page still, and a hidden one is scrolled in by the least scroll.
describe('flow diagram: a box outside the window', () => {
  it('is one no part of which the window shows', () => {
    type Box = { top: number; bottom: number; left: number; right: number };
    const box = (top: number, bottom: number, left = 10, right = 300): Box => ({ top, bottom, left, right });
    expect(outsideWindow(box(-60, -20), 1000, 600), 'wholly above').toBe(true);
    expect(outsideWindow(box(-40, 0), 1000, 600), 'its bottom edge on the top of the window').toBe(true);
    expect(outsideWindow(box(600, 640), 1000, 600), 'wholly below').toBe(true);
    expect(outsideWindow(box(100, 140, -400, -10), 1000, 600), 'wholly left').toBe(true);
    expect(outsideWindow(box(100, 140, 1000, 1200), 1000, 600), 'wholly right').toBe(true);
    expect(outsideWindow(box(-20, 20), 1000, 600), 'cut by the top edge').toBe(false);
    expect(outsideWindow(box(580, 620), 1000, 600), 'cut by the bottom edge').toBe(false);
    expect(outsideWindow(box(100, 140), 1000, 600), 'inside').toBe(false);
  });
  // Task 5b fix round 1 (M2): Close gives the focus to the canvas, not to a box head the canvas no longer shows (panned out of its view)
  it('shares no area with a box wholly beside it, and shares some with one it overlaps', () => {
    const canvas = { top: 300, bottom: 700, left: 20, right: 900 };
    expect(disjoint({ top: 720, bottom: 750, left: 100, right: 300 }, canvas), 'below it').toBe(true);
    expect(disjoint({ top: 260, bottom: 300, left: 100, right: 300 }, canvas), 'above, its bottom edge on the top').toBe(true);
    expect(disjoint({ top: 400, bottom: 430, left: 900, right: 1100 }, canvas), 'right of it, its left edge on the right').toBe(true);
    expect(disjoint({ top: 400, bottom: 430, left: -300, right: -10 }, canvas), 'left of it').toBe(true);
    expect(disjoint({ top: 690, bottom: 720, left: 100, right: 300 }, canvas), 'cut by its bottom').toBe(false);
    expect(disjoint({ top: 400, bottom: 430, left: 880, right: 1000 }, canvas), 'cut by its right').toBe(false);
    expect(disjoint({ top: 400, bottom: 430, left: 100, right: 300 }, canvas), 'inside').toBe(false);
  });
});
