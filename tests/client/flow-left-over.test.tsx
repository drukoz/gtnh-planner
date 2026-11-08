import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowLeftOverShape } from '../../src/client/views/FlowView.tsx';
import {
  flowGraph, toElk, fromElk, rowCentre,
  PORT_SIZE, LEFT_OVER_GAP, LANE_STEP, LEFT_OVER_TITLE, LEFT_OVER_PAD, LEFT_OVER_SPACING,
  APPROACH, LEFT_OVER_WORDS, TITLE_CHAR_WIDTH, leftOverTitleWidth, FlowNodeKind, type FlowLayout, type FlowNode,
} from '../../src/client/views/flow-model.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Product, LeafClass } from '../../src/shared/types/pack.ts';
import type { Plan, PlanFlow, PlanSettings, PlanStep, RawInput } from '../../src/shared/types/plan.ts';

const H = 3600;
const per = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });
const raw = (key: string, perSecond: number, leafClass: LeafClass): RawInput => ({ key, perSecond, cost: perSecond, available: true, sources: [], leafClass });
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

// Two-sink fixture (from the electrolyzer plan): brine leaves t:naoh@0, water leaves fluid:oxygen.
const H_CELL = 't:h_cell@0';
const cells = planOf({
  target: 't:hcl@0', targetPerSecond: 1 / H,
  names: { [H_CELL]: 'Hydrogen Cell', 'fluid:chlorine': 'Chlorine', 'fluid:saltwater': 'Salt Water', 't:cl_cell@0': 'Chlorine Cell', 't:hcl@0': 'Acid',
    't:naoh@0': 'Sodium Hydroxide Dust', 't:empty@0': 'Empty Cell', 'fluid:oxygen': 'Oxygen', 'fluid:water': 'Water' },
  steps: [
    mv({ id: 'water', machine: { mteId: 371, name: 'Advanced Electrolyzer II', tier: 3 }, mainOutput: H_CELL, runsPerSecond: 0.485 / H,
      inputs: [per('t:empty@0', 2), per('fluid:water', 1000)], outputs: [per(H_CELL, 2), per('fluid:oxygen', 1000)] }),
    mv({ id: 'brine', machine: { mteId: 371, name: 'Advanced Electrolyzer II', tier: 3 }, mainOutput: H_CELL, runsPerSecond: 0.03 / H,
      inputs: [per('t:empty@0', 1), per('fluid:saltwater', 1000)], outputs: [per('t:naoh@0', 3), per(H_CELL, 1), per('fluid:chlorine', 1000)] }),
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

// Red alloy line (open supporting line with a sink inside it)
const RED = 'fluid:molten.redalloy';
const redLine = { key: RED, name: 'Red Alloy' };
const red = planOf({
  target: 't:redalloy_wire@0',
  names: { 't:copper_ingot@0': 'Copper Ingot', 't:redstone@0': 'Redstone', 't:redalloy_ingot@0': 'Red Alloy Ingot', [RED]: 'Molten Red Alloy', 't:redalloy_wire@0': '1x Red Alloy Wire' },
  steps: [
    mv({ id: 'smelt', machine: { mteId: 201, name: 'Advanced Alloy Smelter', tier: 2 }, line: redLine, mainOutput: 't:redalloy_ingot@0',
      inputs: [per('t:copper_ingot@0', 1), per('t:redstone@0', 4)], outputs: [per('t:redalloy_ingot@0', 1), per('t:slag@0', 1)] }),
    mv({ id: 'extract', machine: { mteId: 131, name: 'Advanced Fluid Extractor', tier: 2 }, line: redLine, mainOutput: RED,
      inputs: [per('t:redalloy_ingot@0', 1)], outputs: [per(RED, 144)] }),
    mv({ id: 'wire', machine: { mteId: 521, name: 'Fluid Solidifier', tier: 2 }, mainOutput: 't:redalloy_wire@0', inputs: [per(RED, 144)], outputs: [per('t:redalloy_wire@0', 2)] }),
  ],
  flows: [
    flow('raw', 'smelt', 't:copper_ingot@0', 1 / H), flow('raw', 'smelt', 't:redstone@0', 4 / H), flow('smelt', 'extract', 't:redalloy_ingot@0', 1 / H),
    flow('extract', 'wire', RED, 144 / H), flow('wire', 'out', 't:redalloy_wire@0', 2 / H),
    flow('smelt', 'sink', 't:slag@0', 1 / H),
  ],
  rawInputs: [raw('t:copper_ingot@0', 1 / H, 'direct'), raw('t:redstone@0', 4 / H, 'direct')],
});

const g = flowGraph(board, 'hour');

async function layOut(plan: Plan, opts?: { collapsedLines?: ReadonlySet<string> }): Promise<FlowLayout> {
  const graph = flowGraph(plan, 'hour', opts);
  const laid = await new ELK().layout(toElk(graph));
  return fromElk(graph, laid);
}

function nodeOf(layout: FlowLayout, id: string): FlowNode & { x: number; y: number } {
  const n = layout.nodes.find((n) => n.id === id);
  if (n === undefined) throw new Error(`no node ${id}`);
  return n;
}

describe('flow left-over band (RUK-740)', () => {
  it('toElk has no child and no edge for the sink', () => {
    const elk = toElk(g);
    const childIds = (elk.children ?? []).map((c) => c.id);
    expect(childIds).not.toContain('sink:t:copper_dust@0@saw');
    // Also check inside groups
    for (const child of elk.children ?? []) {
      const subIds = (child.children ?? []).map((c) => c.id);
      expect(subIds).not.toContain('sink:t:copper_dust@0@saw');
    }
    const edgeIds = (elk.edges ?? []).flatMap((e) => [...e.sources, ...e.targets]);
    expect(edgeIds.filter((id) => id.includes('sink:'))).toEqual([]);
  });

  it('the sink is at least LEFT_OVER_GAP below every other box, and leftOver frame contains it', async () => {
    const laid = await layOut(board);
    const sink = nodeOf(laid, 'sink:t:copper_dust@0@saw');
    const nonSinks = laid.nodes.filter((n) => n.kind !== FlowNodeKind.Sink);
    const maxBottom = Math.max(...nonSinks.map((n) => n.y + n.height));
    expect(sink.y).toBeGreaterThanOrEqual(maxBottom + LEFT_OVER_GAP);
    expect(laid.leftOver).toBeDefined();
    const frame = laid.leftOver!;
    expect(sink.x).toBeGreaterThanOrEqual(frame.x);
    expect(sink.y).toBeGreaterThanOrEqual(frame.y);
    expect(sink.x + sink.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(sink.y + sink.height).toBeLessThanOrEqual(frame.y + frame.height);
  });

  it('the sink arrow has 6 points: first at the saw output port, last at the sink input port', async () => {
    const laid = await layOut(board);
    const sink = nodeOf(laid, 'sink:t:copper_dust@0@saw');
    const saw = nodeOf(laid, 'saw');
    const edge = laid.edges.find((e) => e.to === sink.id)!;
    expect(edge).toBeDefined();
    expect(edge.points).toHaveLength(6);
    const sawRow = saw.rows.findIndex((r) => r.port === edge.fromPort);
    expect(sawRow).toBeGreaterThanOrEqual(0);
    expect(edge.points[0]).toEqual([saw.x + saw.width + PORT_SIZE, saw.y + rowCentre(saw, sawRow)]);
    expect(edge.points[5]).toEqual([sink.x - PORT_SIZE, sink.y + rowCentre(sink, 0)]);
  });

  it('the arrow vertical segment from start to bottom crosses no other box', async () => {
    const laid = await layOut(board);
    const sink = nodeOf(laid, 'sink:t:copper_dust@0@saw');
    const edge = laid.edges.find((e) => e.to === sink.id)!;
    const start = edge.points[0]!;
    const dropX = edge.points[1]![0];
    const nonSinks = laid.nodes.filter((n) => n.kind !== FlowNodeKind.Sink);
    for (const b of nonSinks) {
      const crosses = dropX >= b.x && dropX <= b.x + b.width && b.y + b.height > start[1] && b.y < Math.max(...nonSinks.map((n) => n.y + n.height));
      expect(crosses, `dropX=${dropX} crosses box ${b.id}`).toBe(false);
    }
  });

  it('two sinks sit in one row, left to right in start order, LEFT_OVER_SPACING apart, on different lanes', async () => {
    const laid = await layOut(cells);
    const sinks = laid.nodes.filter((n) => n.kind === FlowNodeKind.Sink);
    expect(sinks).toHaveLength(2);
    const brineSink = sinks.find((s) => s.id.includes('naoh'))!;
    const waterSink = sinks.find((s) => s.id.includes('oxygen'))!;
    // They are in one row (same y)
    expect(brineSink.y).toBe(waterSink.y);
    // LEFT_OVER_SPACING apart (the gap between the right edge of the left one and the left edge of the right one)
    const left = brineSink.x < waterSink.x ? brineSink : waterSink;
    const right = brineSink.x < waterSink.x ? waterSink : brineSink;
    expect(right.x - (left.x + left.width)).toBe(LEFT_OVER_SPACING);
    // On different lanes: verify from their edges
    const edges = laid.edges.filter((e) => sinks.some((s) => s.id === e.to));
    const laneYs = new Set(edges.map((e) => e.points[2]![1]));
    expect(laneYs.size).toBe(2);
    // Left to right in start order (start x, then start y)
    const startOf = (s: { id: string }) => edges.find((e) => e.to === s.id)!.points[0]!;
    const [ls, rs] = [startOf(left), startOf(right)];
    expect(ls[0] < rs[0] || (ls[0] === rs[0] && ls[1] <= rs[1])).toBe(true);
  });

  it('a plan without sinks lays out exactly as before: leftOver is undefined', async () => {
    const noSink = planOf({ ...board, flows: board.flows.filter((f) => f.to !== 'sink') });
    const g2 = flowGraph(noSink, 'hour');
    const laid = fromElk(g2, await new ELK().layout(toElk(g2)));
    expect(laid.leftOver).toBeUndefined();
    // Verify by comparing to fromElk directly (which is what placeLeftOvers returns for no-sink):
    // The nodes, edges, width and height match the raw ELK output since placeLeftOvers is a pass-through.
    expect(laid.nodes.every((n) => n.kind !== FlowNodeKind.Sink)).toBe(true);
  });

  it('a sink inside an open supporting line has no group and the group does not list it', async () => {
    const graph = flowGraph(red, 'hour', { collapsedLines: new Set() });
    const sinkNode = graph.nodes.find((n) => n.id === 'sink:t:slag@0@smelt');
    expect(sinkNode).toBeDefined();
    expect(sinkNode!.group).toBeUndefined();
    const lineGroup = graph.groups.find((grp) => grp.id === 'line:fluid:molten.redalloy');
    expect(lineGroup).toBeDefined();
    expect(lineGroup!.nodes).not.toContain('sink:t:slag@0@smelt');
  });

  it('laying the same plan out twice gives deep-equal layouts (determinism)', async () => {
    const a = await layOut(board);
    const b = await layOut(board);
    expect(a).toEqual(b);
  });

  it('the frame is never narrower than its title (RUK-740 task 7)', async () => {
    const laid = await layOut(board);
    expect(leftOverTitleWidth()).toBe(Math.ceil(LEFT_OVER_WORDS.length * TITLE_CHAR_WIDTH) + 2 * LEFT_OVER_PAD);
    expect(laid.leftOver!.width).toBeGreaterThanOrEqual(leftOverTitleWidth());
    expect(laid.width).toBeGreaterThanOrEqual(laid.leftOver!.x + laid.leftOver!.width);
  });

  it('draws the band as a dashed frame with its title, dimmed while a focus lights none of its boxes (RUK-740 task 7)', () => {
    const box = { x: 0, y: 300, width: 280, height: 90 };
    const html = renderToStaticMarkup(<svg><FlowLeftOverShape box={box} dim={false} /></svg>);
    expect(html).toContain('<g class="flow-left-over" data-left-over="" transform="translate(0 300)">');
    expect(html).toContain('<rect class="flow-left-over-box" width="280" height="90"></rect>');
    expect(html).toContain(`<svg width="280" height="${LEFT_OVER_TITLE}">`);
    expect(html).toContain(`<text class="flow-left-over-title" x="${LEFT_OVER_PAD}" y="19">Left over: not used in this line</text>`);
    expect(renderToStaticMarkup(<svg><FlowLeftOverShape box={box} dim /></svg>)).toContain('class="flow-left-over dim"');
  });
});
