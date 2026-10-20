import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { connectionsElk, connectionsFromElk, connectionsGraph, faceModeText, pickDetails } from '../../src/client/connections/model.ts';
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
