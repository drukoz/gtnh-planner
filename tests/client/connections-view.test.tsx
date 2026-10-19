import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { connectionsElk, connectionsFromElk, connectionsGraph } from '../../src/client/connections/model.ts';
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
    for (const id of ['step:a', 'step:b', 'chest:2,64,0', 'chest:2,64,2']) expect(html).toContain(`data-node="${id}"`);
    expect(html).toContain('data-face="step:a#conduit:0,64,1:item:north"');
    expect(html).toContain('Titanium Dust 60/min · Red');
    expect(html).toContain('stroke="#b02e26"');
    expect(html).toContain('Item Conduit (line colour = channel)');
    expect(html).not.toContain('data-testid="conn-panel"');
  });
  it('shows the picked face in the side panel', () => {
    const html = shell({ pick: { node: 'step:a', face: 'step:a#conduit:0,64,1:item:north' } });
    expect(html).toContain('data-testid="conn-panel"');
    expect(html).toContain('<h3>Basic Macerator, south side · Item Conduit</h3>');
    expect(html).toContain('In / Out; extract on Red');
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
  it('lays the line out before it draws it', () => {
    const project = { id: 'P1', settings: { mode: 'rate', per: 'min', logistics: 'enderio' }, placement: null, world: { scanId: null, baseId: null } } as never;
    expect(renderToStaticMarkup(<ConnectionsView project={project} plan={connPlan} send={() => {}} me="Ann" />)).toContain('Laying out the line…');
  });
});
