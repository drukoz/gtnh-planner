import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { connectionsElk, connectionsFromElk, connectionsGraph, faceModeText, pickDetails } from '../../src/client/connections/model.ts';
// for the tests after the plan's own: the links in the world (the user's requirements of 2026-10-19, item 3 (b))
import { connectionSpans, spanDetails } from '../../src/client/connections/model.ts';
// for the tests after the commit's own (the review of f82c98c)
import { SPANS_PER_LINK, connectionPieces, type ConnSpot } from '../../src/client/connections/model.ts';
import { DIRS, posKey, step } from '../../src/shared/layout/geometry.ts';
import type { ConduitFace, Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { connLayout, connPlan } from './connections-fixture.ts';
import { ITEM, basic } from './enderio-fixture.ts';

const MACERATOR_FACE = 'Item Conduit, north face to Basic Macerator: In / Out (2 filters); extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
  + 'round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1, '
  + 'into its output side: keep its Input from Output Side allowed (a newly crafted machine has it on; a Screwdriver right-click on that side of '
  + 'the machine, beside the conduit, switches it)';

describe('the Connections graph', () => {
  it('draws an EnderIO line: machines and chests with their conduit faces, flows on their channels', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    expect(g.nodes.map((n) => [n.id, n.kind, n.title, n.lines])).toEqual([
      ['step:a', 'machine', '1× Basic Macerator', ['LV · 2 EU/t']], ['step:b', 'machine', '1× Advanced Assembler', ['MV · 30 EU/t']],
      ['chest:2,64,0', 'chest', 'Chest (input)', ['Takes in: Raw Input']], ['chest:2,64,2', 'chest', 'Chest (output)', ['Collects: Titanium Ingot']]]);
    // the row shows the face's mode and the channel of each side (the audit of the EnderIO In / Out fix): what comes in on
    // Blue and what goes out on Red pass one face, so the row takes a second line
    expect(g.nodes[0]!.faces).toEqual([{ id: 'step:a#conduit:0,64,1:item:north', title: 'Basic Macerator, south side · Item Conduit', lines: [MACERATOR_FACE],
      mode: { mode: 'in_out', extract: 'red', insert: 'blue' } }]);
    expect([g.nodes[0]!.width, g.nodes[0]!.height]).toEqual([260, 84]);
    expect(g.nodes[2]!.faces.map((f) => f.mode)).toEqual([{ mode: 'extract', extract: 'blue' }]);
    expect(g.edges.map((e) => [e.id, e.via, e.label, e.color, e.fromFace, e.toFace])).toEqual([
      ['flow:chest:2,64,0>step:a:t:in@0', 'item_conduit', 'Raw Input 60/min · Blue', 'blue', 'chest:2,64,0#conduit:2,64,1:item:north', 'step:a#conduit:0,64,1:item:north'],
      ['flow:step:a>step:b:t:dust@0', 'item_conduit', 'Titanium Dust 60/min · Red', 'red', 'step:a#conduit:0,64,1:item:north', 'step:b#conduit:1,64,1:item:north'],
      ['flow:step:b>chest:2,64,2:t:ingot@0', 'item_conduit', 'Titanium Ingot 60/min · Yellow', 'yellow', 'step:b#conduit:1,64,1:item:north', 'chest:2,64,2#conduit:2,64,1:item:south']]);
    expect(g.edges[1]!.lines.slice(0, 3)).toEqual(['Item Conduit, channel Red', 'From 1× Basic Macerator — Basic Macerator, south side · Item Conduit', MACERATOR_FACE]);
  });

  it('draws a machine-to-machine line with its covers and settings on the boxes', () => {
    const g = connectionsGraph(connLayout('direct'), connPlan, 'hour');
    expect(g.nodes.find((n) => n.id === 'step:a')!.faces).toEqual([
      { id: 'step:a#cover:0,64,0:south', title: 'Basic Macerator, south face', lines: ['Conveyor Module (LV) on the south face: Export, allow input, 1 items/s'] },
      { id: 'step:a#config:0,64,0', title: 'Basic Macerator settings', lines: ['Input Filter on', 'Input from Output Side allowed: a newly crafted '
        + 'machine has it on; a Screwdriver right-click on its middle-row side switches it and the chat names the new state, so leave it where the '
        + 'chat says "Input from Output Side allowed" (a sneak-click switches the Input Filter instead, and the click also works a cover on that side)'] }]);
    expect(g.nodes.find((n) => n.id === 'chest:2,64,2')!.faces).toEqual([
      { id: 'chest:2,64,2#cover:2,64,1:south', title: 'Tin Item Pipe, south face', lines: ['Filtered Conveyor Cover (Export) on the south face: whitelist Titanium Ingot'] }]);
    expect(g.edges.map((e) => [e.from, e.to, e.via, e.label, e.color])).toEqual([
      ['chest:2,64,0', 'step:a', 'gt_pipe', 'Raw Input 3,600/h', null], ['step:a', 'step:b', 'gt_pipe', 'Titanium Dust 3,600/h', null],
      ['step:b', 'chest:2,64,2', 'gt_pipe', 'Titanium Ingot 3,600/h', null]]);
  });

  it('draws a routed line with an interface box on every machine', () => {
    const g = connectionsGraph(connLayout('routed'), connPlan, 'min');
    expect(g.nodes.filter((n) => n.kind === 'interface').map((n) => [n.id, n.title, n.lines])).toEqual([
      ['iface:0,64,1', 'Routed Interface Pipe (Basic Macerator)', ['chips: Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip']],
      ['iface:1,64,1', 'Routed Interface Pipe (Advanced Assembler)', ['chips: Item Responder Chip (whitelist: Titanium Dust) + Item Extractor Chip']]]);
    expect(g.edges.filter((e) => e.via === 'attached').map((e) => [e.from, e.to])).toEqual([['iface:0,64,1', 'step:a'], ['iface:1,64,1', 'step:b']]);
    expect(g.edges.filter((e) => e.key !== null).map((e) => e.via)).toEqual(['routed', 'routed', 'routed']);
  });

  it('draws an AE2 line from and to the ME network, with each interface pattern and the tap', () => {
    const g = connectionsGraph(connLayout('ae2'), connPlan, 'min');
    expect(g.nodes.map((n) => n.id)).toEqual(['step:a', 'step:b', 'iface:0,64,1', 'iface:1,64,1', 'hookup:0', 'raw', 'out']);
    expect(g.nodes.find((n) => n.id === 'iface:0,64,1')!.lines).toEqual(['1 processing pattern', 'pattern 1× Raw Input → 1× Titanium Dust', 'blocking mode off']);
    expect(g.nodes.find((n) => n.id === 'hookup:0')).toMatchObject({ kind: 'hookup', title: 'AE2 tap at 3 64 1',
      lines: ['1 block to lay', '1× appliedenergistics2:item.ItemMultiPart@16'] });
    expect(g.edges.filter((e) => e.key !== null).map((e) => [e.from, e.to, e.via])).toEqual([['raw', 'step:a', 'ae2'], ['step:a', 'step:b', 'ae2'], ['step:b', 'out', 'ae2']]);
  });

  it('tells the full configuration of a picked box, face or link', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    const face = g.nodes[0]!.faces[0]!;
    expect(pickDetails(g, { node: 'step:a' })).toEqual({ title: '1× Basic Macerator', lines: ['LV · 2 EU/t', face.title, ...face.lines] });
    expect(pickDetails(g, { node: 'step:a', face: face.id })).toEqual({ title: face.title, lines: face.lines });
    expect(pickDetails(g, { edge: 'flow:step:a>step:b:t:dust@0' })!.title).toBe('Titanium Dust 60/min · Red');
    expect(pickDetails(g, { node: 'nope' })).toBeNull();
    // an attached link has no label, so its one line titles it
    expect(pickDetails(connectionsGraph(connLayout('routed'), connPlan, 'min'), { edge: 'attach:iface:0,64,1>step:a' }))
      .toEqual({ title: 'Attached to 1× Basic Macerator', lines: ['Attached to 1× Basic Macerator'] });
  });

  it('lays inputs first and outputs last, with a label box on every flow', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    const elk = connectionsElk(g);
    const constraint = (id: string) => elk.children!.find((c) => c.id === id)!.layoutOptions?.['elk.layered.layering.layerConstraint'];
    expect([constraint('chest:2,64,0'), constraint('chest:2,64,2'), constraint('step:a')]).toEqual(['FIRST', 'LAST', undefined]);
    expect(elk.edges!.map((e) => e.labels?.[0]?.text)).toEqual(['Raw Input 60/min · Blue', 'Titanium Dust 60/min · Red', 'Titanium Ingot 60/min · Yellow']);
    const pic = connectionsFromElk(g, { ...elk, width: 900, height: 300, children: elk.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
    expect([pic.width, pic.nodes[1]!.x, pic.edges[0]!.points.length]).toEqual([900, 300, 2]);
  });

  it("says each conduit face's mode and its sides' channels in a few words", () => {
    // in: into the block the face points at (the insert side), out: out of it (the extract side)
    expect(faceModeText({ mode: 'in_out', extract: 'red', insert: 'blue' })).toBe('In / Out · in Blue · out Red');
    // the single pipe: both sides on the line's one channel name it once
    expect(faceModeText({ mode: 'in_out', extract: 'red', insert: 'red' })).toBe('In / Out · Red');
    expect(faceModeText({ mode: 'extract', extract: 'light_blue' })).toBe('Extract · out Light Blue');
    expect(faceModeText({ mode: 'insert', insert: 'silver' })).toBe('Insert · in Light Gray');
    expect(faceModeText({ mode: 'disabled' })).toBe('Disabled');
    expect(faceModeText({ mode: 'in_out', extract: 'silver', insert: 'light_blue' }).length).toBeLessThanOrEqual(42);   // the longest fits its row
  });

  it('lists an In / Out open end under both raw inputs and final outputs, and names it on both its links', () => {
    // the audit of the EnderIO In / Out fix: Molten Iron comes in from your tank and the surplus goes back out, through one face
    const MOLTEN = 'fluid:molten.iron', ENDER = 'EnderIO:itemLiquidConduit@2';
    const fluid = { filter: { whitelist: true, keys: [MOLTEN] }, rate: 1 };
    const cell = (pos: [number, number, number], face: ConduitFace): LayoutBlock => ({
      pos, block: { id: 'conduit:liquid_ender', meta: 0 }, role: 'pipe', label: 'Ender Fluid Conduit', item: ENDER, connections: 0,
      conduits: [{ kind: 'liquid_ender', item: ENDER, connections: 0, faces: [face] }] });
    const machine = (pos: [number, number, number], stepId: string, label: string): LayoutBlock => ({
      pos, block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, role: 'machine', facing: 3, stepId, label });
    const layout: Layout = { ...connLayout('enderio'), blocks: [machine([0, 64, 0], 'a', 'Basic Macerator'), machine([1, 64, 0], 'b', 'Advanced Assembler'),
      cell([0, 64, 1], { face: 'north', mode: 'extract', target: 'Basic Macerator', extract: { ...fluid, color: 'red', roundRobin: false, redstone: 'ignore' } }),
      cell([1, 64, 1], { face: 'north', mode: 'insert', target: 'Advanced Assembler', insert: { ...fluid, color: 'red' } }),
      cell([2, 64, 1], { face: 'east', mode: 'in_out', target: 'your tank', extract: { ...fluid, color: 'blue', roundRobin: false, redstone: 'ignore' },
        insert: { ...fluid, color: 'red' } })] };
    const plan: Plan = { ...connPlan, flows: [{ from: 'raw', to: 'b', key: MOLTEN, perSecond: 0.5 }, { from: 'a', to: 'b', key: MOLTEN, perSecond: 1 },
      { from: 'a', to: 'out', key: MOLTEN, perSecond: 0.25 }], names: { ...connPlan.names, [MOLTEN]: 'Molten Iron' } };
    const g = connectionsGraph(layout, plan, 'min');
    const rows = (id: string) => g.nodes.find((n) => n.id === id)!.faces.map((f) => [f.id, f.title, f.mode]);
    const end = { mode: 'in_out', extract: 'blue', insert: 'red' };
    expect(rows('raw')).toEqual([['raw#conduit:2,64,1:liquid_ender:east', 'your tank, west side · Ender Fluid Conduit', end]]);
    expect(rows('out')).toEqual([['out#conduit:2,64,1:liquid_ender:east', 'your tank, west side · Ender Fluid Conduit', end]]);
    const link = (id: string) => g.edges.find((e) => e.id === id)!;
    expect([link('flow:raw>step:b:fluid:molten.iron').fromFace, link('flow:step:a>out:fluid:molten.iron').toFace])
      .toEqual(['raw#conduit:2,64,1:liquid_ender:east', 'out#conduit:2,64,1:liquid_ender:east']);
    expect(link('flow:step:a>out:fluid:molten.iron').lines.slice(-2)).toEqual(['To Final outputs — your tank, west side · Ender Fluid Conduit',
      'Ender Fluid Conduit, east face to your tank: In / Out; extract on Blue with a fluid filter (whitelist: Molten Iron), round robin off, redstone '
        + 'Always active; insert on Red with a fluid filter (whitelist: Molten Iron)']);
  });

  it('lays a hookup out before the input chest it joins', async () => {
    // an EnderIO hookup from the base's tap at 4 64 0: one Item Conduit east of the input chest, inserting into it on Green
    const layout = connLayout('enderio');
    layout.blocks.push({ pos: [3, 64, 0], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0, connections: 16 | 32,
      conduits: [{ kind: 'item', item: ITEM, connections: 32,
        faces: [{ face: 'west', mode: 'insert', target: 'Chest (input)', insert: { color: 'green', filter: basic(['t:in@0']), rate: 1, priority: 1 } }] }] });
    layout.hookups.push({ kind: 'logistics', from: { pos: [4, 64, 0], dim: 0, kind: 'pipe', networkId: 'e:item:0:0' }, path: [[3, 64, 0]],
      parts: [{ key: ITEM, amount: 1, why: 'logistics hookup', group: 'logistics' }], found: true });
    const g = connectionsGraph(layout, connPlan, 'min');
    expect(g.nodes.find((n) => n.id === 'hookup:0')!.title).toBe('EnderIO tap at 4 64 0');
    expect(g.nodes.find((n) => n.id === 'chest:2,64,0')!.faces.map((f) => f.id)).toEqual(['chest:2,64,0#conduit:2,64,1:item:north', 'chest:2,64,0#conduit:3,64,0:item:west']);
    expect(g.edges.filter((e) => e.via === 'hookup').map((e) => [e.id, e.label, e.lines])).toEqual([['hookup:0>chest:2,64,0', 'hookup', ['Joins the line at Chest (input)']]]);
    // ELK refuses a link into a FIRST box unless it comes from a FIRST_SEPARATE one, so the hookup gets a layer of its own
    const laid = await new ELK().layout(connectionsElk(g));
    const x = (id: string) => laid.children!.find((c) => c.id === id)!.x!;
    expect(x('hookup:0')).toBeLessThan(x('chest:2,64,0'));
  });
});

// The user's requirements of 2026-10-19, item 3 (b): the 3D view's Show connections draws these links in the world, each
// from a face (or a block that stands for its box) to another.
describe('the Connections links in the world', () => {
  const spansOf = (mode: 'enderio' | 'direct' | 'routed' | 'ae2') => {
    const layout = connLayout(mode);
    return connectionSpans(layout, connectionsGraph(layout, connPlan, 'min'));
  };
  const brief = (mode: 'enderio' | 'direct' | 'routed' | 'ae2') =>
    spansOf(mode).map((s) => `${s.edge}: ${s.from.cell.join(' ')} ${s.from.side} > ${s.to.cell.join(' ')} ${s.to.side}`);

  it("draws an EnderIO flow from the face of the block its extract face points at to the face of the block its insert face does", () => {
    // each conduit face's end is on the face of the block it points at, toward the conduit: the chest and the machines south
    expect(spansOf('enderio')).toEqual([
      { edge: 'flow:chest:2,64,0>step:a:t:in@0', from: { cell: [2, 64, 0], side: 3, face: 'chest:2,64,0#conduit:2,64,1:item:north' },
        to: { cell: [0, 64, 0], side: 3, face: 'step:a#conduit:0,64,1:item:north' } },
      { edge: 'flow:step:a>step:b:t:dust@0', from: { cell: [0, 64, 0], side: 3, face: 'step:a#conduit:0,64,1:item:north' },
        to: { cell: [1, 64, 0], side: 3, face: 'step:b#conduit:1,64,1:item:north' } },
      { edge: 'flow:step:b>chest:2,64,2:t:ingot@0', from: { cell: [1, 64, 0], side: 3, face: 'step:b#conduit:1,64,1:item:north' },
        to: { cell: [2, 64, 2], side: 2, face: 'chest:2,64,2#conduit:2,64,1:item:south' } }]);
  });

  it('joins the blocks that stand for the boxes in the other modes, an interface to what it touches and the network at the hookup', () => {
    expect(brief('direct')).toEqual([
      'flow:chest:2,64,0>step:a:t:in@0: 2 64 0 1 > 0 64 0 1', 'flow:step:a>step:b:t:dust@0: 0 64 0 1 > 1 64 0 1',
      'flow:step:b>chest:2,64,2:t:ingot@0: 1 64 0 1 > 2 64 2 1']);
    // an interface pipe's link to what it serves ends on the side the two share, beside the pipe's arm
    expect(brief('routed').slice(3)).toEqual(['attach:iface:0,64,1>step:a: 0 64 1 1 > 0 64 0 3', 'attach:iface:1,64,1>step:b: 1 64 1 1 > 1 64 0 3']);
    // an AE2 line's raw inputs and final outputs are the base's ME network, which comes in at the hookup's cable; the
    // hookup's own link would start and end there, so it is left out
    expect(brief('ae2')).toEqual([
      'flow:raw>step:a:t:in@0: 3 64 1 1 > 0 64 0 1', 'flow:step:a>step:b:t:dust@0: 0 64 0 1 > 1 64 0 1', 'flow:step:b>out:t:ingot@0: 1 64 0 1 > 3 64 1 1',
      'attach:iface:0,64,1>step:a: 0 64 1 1 > 0 64 0 1', 'attach:iface:1,64,1>step:b: 1 64 1 1 > 1 64 0 1']);
  });

  it('draws a flow from each extract face to every insert face on its channel that takes the good, and only those', () => {
    // a third machine beside the assembler takes the dust too on Red, and a fourth on Blue: EnderIO hands the macerator's
    // dust to the Red face only
    const layout = connLayout('enderio');
    const machine = (x: number, stepId: string): LayoutBlock => ({ pos: [x, 64, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2002 },
      role: 'machine', facing: 3, stepId, label: 'Advanced Assembler' });
    const into = (x: number, color: 'red' | 'blue'): LayoutBlock => ({ pos: [x, 64, 1], block: { id: 'conduit:item', meta: 0 }, role: 'pipe',
      label: 'Item Conduit', item: ITEM, connections: 4 | 16, conduits: [{ kind: 'item', item: ITEM, connections: 16, faces: [{ face: 'north', mode: 'insert',
        target: 'Advanced Assembler', insert: { color, filter: basic(['t:dust@0']), rate: 1, priority: 1 } }] }] });
    layout.blocks.push(machine(3, 'b'), into(3, 'red'), machine(4, 'b'), into(4, 'blue'));
    const g = connectionsGraph(layout, connPlan, 'min');
    const dust = connectionSpans(layout, g).filter((s) => s.edge === 'flow:step:a>step:b:t:dust@0');
    expect(dust.map((s) => s.to.cell)).toEqual([[1, 64, 0], [3, 64, 0]]);
    // its details name the faces of that piece (the third assembler's), not the link's first ones
    const details = spanDetails(g, dust[1]!)!;
    expect(details.lines.slice(0, 2)).toEqual(['Item Conduit, channel Red', 'From 1× Basic Macerator — Basic Macerator, south side · Item Conduit']);
    expect(details.lines).toContain('To 3× Advanced Assembler — Advanced Assembler, south side · Item Conduit');
    expect(details.lines.at(-1)).toMatch(/^Item Conduit, north face to Advanced Assembler: Insert \(1 filter\); insert on Red/);
    expect(g.edges.find((e) => e.id === 'flow:step:a>step:b:t:dust@0')!.lines.at(-1)).toMatch(/In \/ Out/);   // the link's own: the first assembler's
    expect(spanDetails(g, dust[1]!)!.title).toBe('Titanium Dust 60/min · Red');
    expect(spanDetails(g, { edge: 'nope', from: dust[0]!.from, to: dust[0]!.to })).toBeNull();
  });

  it('joins two big boxes face by face in turn, at most 8 pieces a link, and counts the pieces it leaves out', () => {
    // two steps of a and b machines, machine to machine: a × b pieces up to 8, else one per machine of the bigger box,
    // at most 8 of them spread over it (the review of f82c98c: a 41-machine step drew a fan of 41 arcs no one could
    // read)
    const big = (a: number, b: number): Layout => ({ ...connLayout('direct'), blocks: [
      ...Array.from({ length: a }, (_, i): LayoutBlock => ({ pos: [i, 64, 0], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, role: 'machine',
        facing: 3, stepId: 'a', label: 'Basic Macerator' })),
      ...Array.from({ length: b }, (_, i): LayoutBlock => ({ pos: [i, 64, 2], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2002 }, role: 'machine',
        facing: 2, stepId: 'b', label: 'Advanced Assembler' }))] });
    const pieces = (a: number, b: number) => {
      const layout = big(a, b);
      const all = connectionPieces(layout, connectionsGraph(layout, connPlan, 'min'));
      return { spans: all.spans.filter((s) => s.edge === 'flow:step:a>step:b:t:dust@0'), more: all.more.get('flow:step:a>step:b:t:dust@0') ?? 0 };
    };
    expect(SPANS_PER_LINK).toBe(8);
    expect([pieces(2, 4).spans.length, pieces(2, 4).more]).toEqual([8, 0]);
    const cells = (spans: ReadonlyArray<{ from: ConnSpot; to: ConnSpot }>, end: 'from' | 'to') => new Set(spans.map((s) => s[end].cell.join()));
    // past 8 pairs, each machine of the bigger box once while there are at most 8
    const some = pieces(6, 6);
    expect([some.spans.length, some.more]).toEqual([6, 0]);
    expect(cells(some.spans, 'from')).toEqual(new Set(Array.from({ length: 6 }, (_, i) => `${i},64,0`)));
    expect(cells(some.spans, 'to')).toEqual(new Set(Array.from({ length: 6 }, (_, i) => `${i},64,2`)));
    expect([pieces(4, 8).spans.length, pieces(4, 8).more]).toEqual([8, 0]);
    // more: 8 spread over the bigger box, and the rest counted
    const many = pieces(16, 16);
    expect([many.spans.length, many.more]).toEqual([8, 8]);
    expect(cells(many.spans, 'from')).toEqual(new Set(Array.from({ length: 8 }, (_, i) => `${2 * i},64,0`)));
    expect([pieces(41, 1).spans.length, pieces(41, 1).more]).toEqual([8, 33]);
  });

  // the review of f9fe23e: a link's end never hides under another block; the review of f82c98c: when every face is
  // hidden, beside a cable or pipe against it rather than inside it, and not on a side that looks away
  it('ends a link on the face of its block that shows best: open, the top first, else beside a cable or pipe, never facing away', () => {
    const stone = (pos: [number, number, number]): LayoutBlock => ({ pos, block: { id: 'minecraft:stone', meta: 0 }, role: 'casing', label: 'Stone' });
    const spans = (...covers: Array<[number, number, number]>) => {
      const layout = connLayout('direct');
      layout.blocks.push(...covers.map(stone));
      return connectionSpans(layout, connectionsGraph(layout, connPlan, 'min'));
    };
    const ends = (...covers: Array<[number, number, number]>) => spans(...covers).map((s) => `${s.from.cell.join(' ')} ${s.from.side} > ${s.to.cell.join(' ')} ${s.to.side}`);
    // the input chest's top covered: toward the macerator (west) stands the assembler, so the raw input leaves north
    expect(ends([2, 65, 0])[0]).toBe('2 64 0 2 > 0 64 0 1');
    expect(spans([2, 65, 0])[0]!.from.at).toBeUndefined();
    // north covered too: south, beside the item pipe that links into the chest (its arm on the face's middle, its arm
    // west along the row), at the face's upper corner toward the macerator; not east, which looks away from it
    for (const covered of [[[2, 65, 0], [2, 64, -1]], [[2, 65, 0], [2, 64, -1], [3, 64, 0]]] as Array<Array<[number, number, number]>>) {
      const [raw] = spans(...covered);
      expect([raw!.from.cell, raw!.from.side, raw!.from.at]).toEqual([[2, 64, 0], 3, [-5 / 16, 5 / 16, 0]]);
    }
    // the output chest's top covered: north is the pipe, so west, the next most toward the assembler, which shows
    expect(ends([2, 65, 2])[2]).toBe('1 64 0 1 > 2 64 2 4');
  });

  it('ends the links of a row of machines walled in on every side beside the item pipe or the fluid pipe, never inside them', () => {
    // the review of f82c98c: four machines side by side, a fluid pipe on top of each linking down into it, a cable
    // behind and the item pipe in front linking into each: every face is hidden, and the fallback put every end on a
    // top, under the fluid pipe, so the arcs rose through its core
    const bit = (side: number) => 1 << side;
    const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
    const row = [0, 1, 2, 3];
    const last = row.length - 1;
    const along = (x: number) => (x > 0 ? bit(4) : 0) | (x < last ? bit(5) : 0);
    const blocks: LayoutBlock[] = row.flatMap((x): LayoutBlock[] => [
      { pos: [x, 64, 0], block: GT(2001), role: 'machine', facing: 3, stepId: x < 2 ? 'a' : 'b', label: 'Machine' },
      { pos: [x, 65, 0], block: GT(5110), role: 'pipe', label: 'Small Bronze Fluid Pipe (Water)', connections: bit(0) | along(x) | (x === 0 ? bit(4) : 0),
        buildStep: 'layout:logistics:fluid:fluid:water' },
      { pos: [x, 64, -1], block: GT(1246), role: 'cable', label: '1x Tin Cable', connections: bit(3) | along(x), buildStep: 'layout:power:wire:1' },
      { pos: [x, 64, 1], block: GT(5600), role: 'pipe', label: 'Tin Item Pipe', connections: bit(2) | along(x), buildStep: 'layout:logistics:line' },
    ]);
    // the fluid pipe's run comes in from the west, where your tank goes; the row's two ends are walled in too
    blocks.push({ pos: [-1, 65, 0], block: GT(5110), role: 'pipe', label: 'Small Bronze Fluid Pipe (Water)', connections: bit(5),
      buildStep: 'layout:logistics:fluid:fluid:water' });
    for (const x of [-1, row.length]) blocks.push({ pos: [x, 64, 0], block: { id: 'minecraft:stone', meta: 0 }, role: 'casing', label: 'Stone' });
    const layout: Layout = { ...connLayout('direct'), size: [5, 2, 3], blocks };
    const plan: Plan = { ...connPlan, flows: [{ from: 'raw', to: 'a', key: 'fluid:water', perSecond: 1 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 }] };
    const g = connectionsGraph(layout, plan, 'min');
    const spans = connectionSpans(layout, g);
    const at = new Map(blocks.map((b) => [posKey(b.pos), b]));
    const machineEnds = spans.flatMap((s) => [s.from, s.to].map((end) => ({ s, end }))).filter(({ end }) => at.get(posKey(end.cell))?.role === 'machine');
    expect(machineEnds.length).toBeGreaterThan(4);
    for (const { s, end } of machineEnds) {
      const against = at.get(posKey(step(end.cell, end.side)))!;
      // never the bottom, never under a whole block; an item beside the item pipe (never the fluid pipe), a fluid
      // beside its own pipe
      expect([end.side === 0, against?.label], s.edge).toEqual([false, s.edge.endsWith('fluid:water') ? 'Small Bronze Fluid Pipe (Water)' : 'Tin Item Pipe']);
      // beside the pipe's 6 px core and every arm, by more than a tube's radius
      const axes = [0, 1, 2].filter((k) => DIRS[end.side]![k] === 0);
      const off = end.at!;
      expect(off, s.edge).toBeDefined();
      expect(Math.max(...axes.map((k) => Math.abs(off[k]!))), s.edge).toBeGreaterThan(3 / 16 + 0.05);
      for (const k of axes) {
        for (const sign of [1, -1]) {
          const arm = DIRS.findIndex((d) => d[k] === sign && d.every((v, j) => j === k || v === 0));
          const across = axes.find((j) => j !== k)!;
          if ((against.connections! & bit(arm)) !== 0 && sign * off[k]! > 0) expect(Math.abs(off[across]!), `${s.edge} arm ${arm}`).toBeGreaterThan(3 / 16 + 0.05);
        }
      }
      // on a side never below its middle, out of which an arc would rise through the arm into the face
      if (end.side > 1) expect(off[1]!).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves an AE2 hookup's own link out, as its cable shows it: both its ends are where the base's network comes in", () => {
    const layout = connLayout('ae2');
    const g = connectionsGraph(layout, connPlan, 'min');
    const all = connectionPieces(layout, g);
    expect(g.edges.map((e) => e.id)).toContain('hookup:0>raw');
    expect([all.spans.some((s) => s.edge === 'hookup:0>raw'), [...all.joined]]).toEqual([false, ['hookup:0>raw']]);
    expect(all.spans).toEqual(connectionSpans(layout, g));
  });

  it('tells a piece of a link without faces what the link tells', () => {
    const layout = connLayout('routed');
    const g = connectionsGraph(layout, connPlan, 'min');
    const [first] = connectionSpans(layout, g);
    expect(spanDetails(g, first!)).toEqual(pickDetails(g, { edge: first!.edge }));
  });
});
