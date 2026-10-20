import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONN_NODE_WIDTH, connectionsElk, connectionsFromElk, connectionsGraph, type ConnNode } from '../../src/client/connections/model.ts';
import { ConnectionsShell, ConnectionsView, type ConnectionsShellProps } from '../../src/client/views/ConnectionsView.tsx';
import { PROJECT_TABS, tabFromHash } from '../../src/client/views/project-tabs.ts';
import { connLayout, connPlan } from './connections-fixture.ts';

const graph = connectionsGraph(connLayout('enderio'), connPlan, 'min');
const elk = connectionsElk(graph);
const picture = connectionsFromElk(graph, { ...elk, width: 900, height: 300, children: elk.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
const shell = (over: Partial<ConnectionsShellProps> = {}) => renderToStaticMarkup(<ConnectionsShell plan={connPlan} layout={connLayout('enderio')}
  loading={false} error={null} graph={graph} picture={picture} layoutError={null} pick={null} onPick={() => {}} {...over} />);

describe('the Connections tab', () => {
  it('comes right after 3D', () => {
    // relative order only (plan 11, ruling R6): Plan 5's 3d tab is not on this branch, so connections follows map until it is
    const ids = PROJECT_TABS.map((t) => t.id);
    expect(ids.filter((id) => id !== '3d')).toEqual(['map', 'connections', 'flow', 'materials', 'notes']);
    expect(ids.indexOf('connections')).toBe(Math.max(ids.indexOf('map'), ids.indexOf('3d')) + 1);
    expect(PROJECT_TABS.find((t) => t.id === 'connections')!.label).toBe('Connections');
    expect(tabFromHash('#connections')).toBe('connections');
  });
  it('draws every box, face row and link with its channel colour', () => {
    const html = shell();
    expect(html).toContain('data-testid="connections"');
    expect(html).toContain('<svg role="group" aria-label="Connections of the line"');   // plan 11, Task 8's review ruling (not role="img")
    for (const id of ['step:a', 'step:b', 'chest:2,64,0', 'chest:2,64,2']) expect(html).toContain(`data-node="${id}"`);
    expect(html).toContain('data-face="step:a#conduit:0,64,1:item:north"');
    expect(html).toContain('Titanium Dust 60/min · Red');
    expect(html).toContain('stroke="#b3312c"');                                       // Red as the game draws it (Minecraft 1.7.10's dye colours)
    expect(html).toContain('Item Conduit (line colour = channel)');
    expect(html).not.toContain('data-testid="conn-panel"');
  });
  // the user's request of 2026-10-19: the picture moves and zooms as one group, in an area of its own height (at most
  // 75vh) that takes the arrow keys, under a Fit button; until the area is measured the view is the picture's own size,
  // 16 px in
  it('draws every link and box in one group the view moves and zooms, under a Fit button', () => {
    const html = shell();
    const svg = /<svg role="group" aria-label="Connections of the line"([^>]*)>(.*)<\/svg>/s.exec(html)!;
    expect(svg[1]).toContain('tabindex="0"');
    expect(svg[1]).toContain('style="height:min(332px, 75vh)"');   // the picture's 300 px and 16 px above and below
    const pan = /^<defs>.*?<\/defs><g class="conn-pan" transform="translate\(16 16\) scale\(1\)">(.*)<\/g>$/s.exec(svg[2]!)?.[1];
    expect(pan).toBeDefined();
    for (const id of ['step:a', 'step:b', 'chest:2,64,0', 'chest:2,64,2']) expect(pan).toContain(`data-node="${id}"`);
    expect(pan).toContain('data-edge="flow:step:a&gt;step:b:t:dust@0"');
    expect(html).toMatch(/<button type="button" class="small">Fit<\/button>.*<div class="connections" data-testid="connections"/s);
  });
  // the audit of the EnderIO In / Out fix: a conduit face's row names its mode and the channel of each side under its
  // title, so the picture shows that the link in (insert side) and the link out (extract side) pass the same face
  it("shows each conduit face's mode and channels on its row's second line, which picks the face too", () => {
    const box = /<g data-node="step:a"[^>]*>(.*?)<\/g>/s.exec(shell())![1]!;
    expect(box).toContain('<text class="conn-face" data-face="step:a#conduit:0,64,1:item:north" x="8" y="59">');
    expect(box).toContain('<text class="conn-face-mode" data-face="step:a#conduit:0,64,1:item:north" x="8" y="75">In / Out · in Blue · out Red</text>');
    expect(box).toContain('<svg width="260" height="84">');
    expect(shell({ pick: { node: 'step:a', face: 'step:a#conduit:0,64,1:item:north' } }))
      .toContain('<text class="conn-face-mode selected" data-face="step:a#conduit:0,64,1:item:north"');
  });
  it('marks the face rows a picked link leaves and enters', () => {
    const html = shell({ pick: { edge: 'flow:step:a>step:b:t:dust@0' } });
    for (const face of ['step:a#conduit:0,64,1:item:north', 'step:b#conduit:1,64,1:item:north']) {
      expect(html).toContain(`<text class="conn-face linked" data-face="${face}"`);
      expect(html).toContain(`<text class="conn-face-mode linked" data-face="${face}"`);
    }
    expect(html).not.toContain('class="conn-face linked" data-face="chest:');
  });
  it('shows the picked face in the side panel', () => {
    const html = shell({ pick: { node: 'step:a', face: 'step:a#conduit:0,64,1:item:north' } });
    expect(html).toContain('data-testid="conn-panel"');
    expect(html).toContain('<h3>Basic Macerator, south side · Item Conduit</h3>');
    expect(html).toContain('In / Out (2 filters); extract on Red');
  });
  it('says why there is nothing to draw', () => {
    expect(shell({ plan: null })).toContain('Planning…');
    expect(shell({ layout: null, graph: null, picture: null, loading: true })).toContain('Laying out the line…');
    expect(shell({ layout: null, graph: null, picture: null, error: 'boom' })).toContain('Could not load the layout: boom');
    expect(shell({ layout: { ...connLayout('enderio'), status: 'empty', blocks: [] }, graph: null, picture: null })).toContain('Nothing to connect yet');
    expect(shell({ picture: null })).toContain('Drawing the connections…');
    expect(shell({ picture: null, layoutError: 'elk' })).toContain('Could not lay out the connections: elk');
  });

  it('marks the picked box or link, and titles a picked link by its label', () => {
    const link = shell({ pick: { edge: 'flow:step:a>step:b:t:dust@0' } });
    expect(link).toContain('<h3>Titanium Dust 60/min · Red</h3>');
    expect(link).toContain('data-edge="flow:step:a&gt;step:b:t:dust@0" class="conn-edge conn-via-item_conduit selected"');
    expect(shell({ pick: { node: 'step:b' } })).toContain('data-node="step:b" class="conn-node conn-machine selected"');
    expect(shell({ pick: { node: 'nope' } })).not.toContain('selected');
  });
  it('colours a link without a channel by what carries it, and lists only what the picture holds', () => {
    const g = connectionsGraph(connLayout('ae2'), connPlan, 'min');
    const e = connectionsElk(g);
    const pic = connectionsFromElk(g, { ...e, width: 900, height: 300, children: e.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
    const html = shell({ layout: connLayout('ae2'), graph: g, picture: pic });
    expect(html).toContain('class="conn-edge conn-via-ae2"');
    expect(html).not.toContain('stroke="#');
    // the attached links (each ME interface on its machine) need no legend entry
    const legend = /<ul class="conn-legend"[^>]*>(.*?)<\/ul>/.exec(html)![1]!;
    expect([...legend.matchAll(/<li>.*?<\/span>(.*?)<\/li>/g)].map((m) => m[1])).toEqual(['ME network', 'Hookup to the base']);
  });
  it('keeps the last picture up while the line is laid out again, and says when a newer one failed', () => {
    const html = shell({ loading: true, error: 'boom', layoutError: 'elk' });
    expect(html).toContain('data-testid="connections" aria-busy="true"');
    expect(html).toContain('Could not load the layout: boom');
    expect(html).toContain('Could not lay out the connections: elk');
  });
  // plan 11, Task 8's review ruling: a box is a fixed 260 px wide, so a text too long for it ends in … and the box's
  // tooltip (its first child, as in the flow diagram) holds every text in full
  it('cuts a box text too long for its box with …, and keeps every text of the box in full in its tooltip', () => {
    const box = /<g data-node="step:b"[^>]*>(.*?)<\/g>/s.exec(shell())![1]!;
    expect(/^<title>(.*?)<\/title><rect /s.exec(box)?.[1])
      .toBe('1× Advanced Assembler\nMV · 30 EU/t\nAdvanced Assembler, south side · Item Conduit — In / Out · in Red · out Yellow');
    expect(box).toMatch(/data-face="step:b#conduit:1,64,1:item:north"[^>]*>Advanced Assembler, south side · Item …<\/text>/);
    expect(box).not.toContain('Item Conduit</text>');
  });
  it('shows a title of up to 32 characters and a line or face row of up to 38 whole, and cuts a longer one there', () => {
    const text = (n: number): string => 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'.slice(0, n);
    const draw = (title: number, row: number): string => {
      const node: ConnNode = { id: 'box', kind: 'machine', title: text(title), lines: [text(row)], faces: [{ id: 'box#face', title: text(row), lines: [] }],
        blocks: [], width: CONN_NODE_WIDTH, height: 68 };
      return shell({ graph: { nodes: [node], edges: [] }, picture: { width: 300, height: 100, nodes: [{ ...node, x: 0, y: 0 }], edges: [] } });
    };
    const texts = (html: string): string[] => [...html.matchAll(/<text class="(conn-[a-z]+)"[^>]*>(.*?)<\/text>/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(texts(draw(32, 38))).toEqual([`conn-title: ${text(32)}`, `conn-line: ${text(38)}`, `conn-face: ${text(38)}`]);
    expect(texts(draw(33, 39))).toEqual([`conn-title: ${text(32)}…`, `conn-line: ${text(38)}…`, `conn-face: ${text(38)}…`]);
    expect(draw(33, 39)).toContain(`<title>${text(33)}\n${text(39)}\n${text(39)}</title>`);
  });
  it('lays the line out before it draws it', () => {
    const project = { id: 'P1', settings: { mode: 'rate', per: 'min', logistics: 'enderio' }, placement: null, world: { scanId: null, baseId: null } } as never;
    expect(renderToStaticMarkup(<ConnectionsView project={project} plan={connPlan} send={() => {}} me="Ann" />)).toContain('Laying out the line…');
  });
});
