import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { connectionsElk, connectionsFromElk, connectionsGraph, pickDetails } from '../../src/client/connections/model.ts';
import { connLayout, connPlan } from './connections-fixture.ts';
import { ITEM, basic } from './enderio-fixture.ts';

const MACERATOR_FACE = 'Item Conduit, north face to Basic Macerator: In / Out; extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
  + 'round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1';

describe('the Connections graph', () => {
  it('draws an EnderIO line: machines and chests with their conduit faces, flows on their channels', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    expect(g.nodes.map((n) => [n.id, n.kind, n.title, n.lines])).toEqual([
      ['step:a', 'machine', '1× Basic Macerator', ['LV · 2 EU/t']], ['step:b', 'machine', '1× Advanced Assembler', ['MV · 30 EU/t']],
      ['chest:2,64,0', 'chest', 'Chest (input)', ['Takes in: Raw Input']], ['chest:2,64,2', 'chest', 'Chest (output)', ['Collects: Titanium Ingot']]]);
    expect(g.nodes[0]!.faces).toEqual([{ id: 'step:a#conduit:0,64,1:item:north', title: 'Basic Macerator, south side · Item Conduit', lines: [MACERATOR_FACE] }]);
    expect([g.nodes[0]!.width, g.nodes[0]!.height]).toEqual([260, 68]);
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
      { id: 'step:a#config:0,64,0', title: 'Basic Macerator settings', lines: ['Input Filter on', 'allow input from the output side'] }]);
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
