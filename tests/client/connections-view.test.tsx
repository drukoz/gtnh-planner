import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONN_NODE_WIDTH, connectionsElk, connectionsFromElk, connectionsGraph, type ConnNode } from '../../src/client/connections/model.ts';
import { setPipesPaused } from '../../src/client/state/pipes-paused.ts';
import { ConnectionsShell, ConnectionsView, type ConnectionsShellProps } from '../../src/client/views/ConnectionsView.tsx';
import { PROJECT_TABS, tabFromHash } from '../../src/client/views/project-tabs.ts';
import { DYE_HEX } from '../../src/shared/layout/enderio.ts';
import type { DyeColor, Layout } from '../../src/shared/types/layout.ts';
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
    expect(link).toContain('<h3>Titanium Dust <span class="fig">60</span>/min · Red</h3>');
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
  it('draws a flow carried by hand as such and lists it in the legend', () => {
    const layout = { ...connLayout('routed'), buildSteps: [{ id: 'layout:hand:b:fill', order: 1, kind: 'logistics' as const,
      text: 'Fill the Advanced Assembler by hand: 1× Titanium Dust a run (from the output chest)' }] };
    const g = connectionsGraph(layout, connPlan, 'min');
    const e = connectionsElk(g);
    const pic = connectionsFromElk(g, { ...e, width: 900, height: 300, children: e.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
    const html = shell({ layout, graph: g, picture: pic });
    expect(html).toContain('data-edge="flow:step:a&gt;step:b:t:dust@0" class="conn-edge conn-via-hand"');
    const legend = /<ul class="conn-legend"[^>]*>(.*?)<\/ul>/.exec(html)![1]!;
    expect([...legend.matchAll(/<li>.*?<\/span>(.*?)<\/li>/g)].map((m) => m[1])).toContain('By hand (a machine the line runs by hand)');
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

// The pipes (restyle plan Phase 1 Task 7, design spec §7): a link is a pipe, a casing with what it carries moving inside it toward
// the box it enters, in its channel's colour or else in the colour of what carries it (the stylesheet's), at the speed of its rate
// (`--pipe-dur`, pipe-motion.ts); a channel too dark to read on the dark casing gets a panel-grey one. A link that carries nothing
// is a still line. pipes.spec.ts watches them move in a browser; these cases pin the markup.

/** The line in `layout` with its boxes side by side and straight links, the way the cases above draw it. */
function drawn(layout: Layout): string {
  const g = connectionsGraph(layout, connPlan, 'min');
  const e = connectionsElk(g);
  const pic = connectionsFromElk(g, { ...e, width: 900, height: 300, children: e.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
  return shell({ layout, graph: g, picture: pic });
}

/** The opening tag of the link `id` (as the markup escapes it) and what its group holds. */
function edgeOf(html: string, id: string): { tag: string; inner: string } {
  const literal = id.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const at = new RegExp(`(<g data-edge="${literal}"[^>]*>)(.*?)</g>`, 's').exec(html);
  if (at === null) throw new Error(`the picture has no link ${id}`);
  return { tag: at[1]!, inner: at[2]! };
}

/** The Red link from the Macerator to the Assembler, to copy with other channels, rates or goods. */
const redLink = picture.edges.find((e) => e.id === 'flow:step:a>step:b:t:dust@0')!;
const withEdges = (edges: typeof picture.edges): string => shell({ picture: { ...picture, edges } });

/** A link's rim, casing and moving contents on the same points, the contents with `attributes` after them, then its label. */
const pipeMarkup = (attributes: string): RegExp => new RegExp(
  `^<polyline class="conn-edge-rim" points="([^"]+)"></polyline><polyline class="conn-edge-line" points="\\1"></polyline>` +
  `<polyline class="conn-edge-flow" points="\\1"${attributes}></polyline><text class="conn-label" `,
);

describe('the Connections pipes', () => {
  it('draws a link as a pipe whose contents move at its rate in its channel colour, the head on them', () => {
    const red = edgeOf(shell(), 'flow:step:a&gt;step:b:t:dust@0');
    // the group keeps what the tests and the e2e specs read first, the pipe's custom properties after them: 1 item/s, a second a cycle
    expect(red.tag).toMatch(/^<g data-edge="flow:step:a&gt;step:b:t:dust@0" class="conn-edge conn-via-item_conduit" style="--pipe-dur:1s;/);
    // Red is too dark to read on the dark casing, so its casing is panel grey
    expect(red.tag).toContain('--pipe-casing:var(--dye-casing)');
    // under the casing the rim a hovered or picked link shows; the casing never has a stroke attribute (the stylesheet colours it),
    // the contents carry the channel's colour and the arrow head
    expect(red.inner).toMatch(pipeMarkup(' stroke="#b3312c" marker-end="url\\(#conn-arrow\\)"'));
  });

  it('gives the seven dyes too dark for the dark casing a panel-grey one, and every other dye the dark casing', () => {
    const html = shell();
    expect(edgeOf(html, 'flow:chest:2,64,0&gt;step:a:t:in@0').tag).toContain('--pipe-casing:var(--dye-casing)');      // Blue
    expect(edgeOf(html, 'flow:step:b&gt;chest:2,64,2:t:ingot@0').tag).not.toContain('--pipe-casing');            // Yellow
    const dyes = Object.keys(DYE_HEX) as DyeColor[];
    const every = withEdges(dyes.map((color) => ({ ...redLink, id: `dye:${color}`, color })));
    for (const color of dyes) expect(edgeOf(every, `dye:${color}`).inner, color).toContain(`<polyline class="conn-edge-flow" points="260,52 300,52" stroke="${DYE_HEX[color]}"`);
    const panelGrey = dyes.filter((color) => edgeOf(every, `dye:${color}`).tag.includes('--pipe-casing:var(--dye-casing)'));
    expect(panelGrey.sort()).toEqual(['black', 'blue', 'brown', 'gray', 'green', 'purple', 'red']);           // design spec §7
  });

  it('moves the good of a link without a channel in the colour of what carries it, from the stylesheet', () => {
    const ae2 = drawn(connLayout('ae2'));
    for (const id of ['flow:raw&gt;step:a:t:in@0', 'flow:step:a&gt;step:b:t:dust@0', 'flow:step:b&gt;out:t:ingot@0']) {
      const { tag, inner } = edgeOf(ae2, id);
      expect(tag, id).toBe(`<g data-edge="${id}" class="conn-edge conn-via-ae2" style="--pipe-dur:1s">`);
      expect(inner, id).toMatch(pipeMarkup(' marker-end="url\\(#conn-arrow\\)"'));
    }
    expect(ae2).not.toContain('stroke="#');
    // a flow carried by hand moves too: its dash-dot and its missing casing are the stylesheet's
    const layout = { ...connLayout('routed'), buildSteps: [{ id: 'layout:hand:b:fill', order: 1, kind: 'logistics' as const,
      text: 'Fill the Advanced Assembler by hand: 1× Titanium Dust a run (from the output chest)' }] };
    const hand = edgeOf(drawn(layout), 'flow:step:a&gt;step:b:t:dust@0');
    expect(hand.tag).toBe('<g data-edge="flow:step:a&gt;step:b:t:dust@0" class="conn-edge conn-via-hand" style="--pipe-dur:1s">');
    expect(hand.inner).toMatch(pipeMarkup(' marker-end="url\\(#conn-arrow\\)"'));
  });

  it('draws a link that carries nothing as a still line: a hookup with the head on its casing, an interface on its machine with none', () => {
    const ae2 = drawn(connLayout('ae2'));
    const hookup = edgeOf(ae2, 'hookup:0&gt;raw');
    expect(hookup.tag).toBe('<g data-edge="hookup:0&gt;raw" class="conn-edge conn-via-hookup">');                 // nothing moves: no speed
    expect(hookup.inner).not.toContain('conn-edge-flow');
    expect(hookup.inner).toMatch(/^<polyline class="conn-edge-rim" points="([^"]+)"><\/polyline><polyline class="conn-edge-line" points="\1" marker-end="url\(#conn-arrow\)"><\/polyline><text /);
    for (const id of ['attach:iface:0,64,1&gt;step:a', 'attach:iface:1,64,1&gt;step:b']) {
      const attached = edgeOf(ae2, id);
      expect(attached.tag, id).toBe(`<g data-edge="${id}" class="conn-edge conn-via-attached">`);
      expect(attached.inner, id).toMatch(/^<polyline class="conn-edge-rim" points="([^"]+)"><\/polyline><polyline class="conn-edge-line" points="\1"><\/polyline>$/);
    }
  });

  it('moves a pipe faster the more it carries, a fluid by the bucket', () => {
    const html = withEdges([
      { ...redLink, id: 'trickle', color: null, perSecond: 0.5 }, { ...redLink, id: 'torrent', color: null, perSecond: 100 },
      { ...redLink, id: 'water', color: null, key: 'fluid:water', perSecond: 100_000 },
    ]);
    expect(edgeOf(html, 'trickle').tag).toContain('style="--pipe-dur:1.08s"');
    expect(edgeOf(html, 'torrent').tag).toContain('style="--pipe-dur:0.5s"');
    expect(edgeOf(html, 'water').tag).toContain('style="--pipe-dur:0.5s"');                                    // 100 buckets a second, not 100,000 items
  });

  it('heads every pipe with one 8 x 8 arrow in the picture\'s units, its tip on the end of the pipe', () => {
    const html = shell();
    const markers = html.match(/<marker [^>]*>/g) ?? [];
    expect(markers).toHaveLength(1);
    for (const attribute of ['id="conn-arrow"', 'viewBox="0 0 10 10"', 'refX="10"', 'refY="5"', 'markerWidth="8"', 'markerHeight="8"', 'markerUnits="userSpaceOnUse"']) {
      expect(markers[0], attribute).toContain(attribute);
    }
    // the tip is the point (10, 5) that refX and refY put on the end of the pipe; the stylesheet fills it in the colour of the pipe
    expect(html).toContain('<path class="conn-arrow-head" d="M 0 0 L 10 5 L 0 10 z"></path></marker>');
  });

  it('moves every pipe of a picture of up to 200 links, and above that only the picked one', () => {
    expect(shell()).toContain('<div class="connections" data-testid="connections" aria-busy="false" data-pipes="all">');
    const links = Array.from({ length: 201 }, (_, i) => ({ ...redLink, id: `link:${i}` }));
    expect(withEdges(links.slice(0, 200))).toContain('aria-busy="false" data-pipes="all">');
    expect(withEdges(links)).toContain('aria-busy="false" data-pipes="lit">');
  });

  it('draws square boxes, the face rows\' part starting where the rect ends', () => {
    const box = /<g data-node="step:a"[^>]*>(.*?)<\/g>/s.exec(shell())![1]!;
    expect(box).toMatch(/<\/title><rect width="260" height="46" rx="0"><\/rect><path d="M 0 46 H 260 V 84 /);
  });

  // ruling R31 (WCAG 2.2.2): the pipes move for as long as the picture is shown, so a text button after Fit stops them all, the one
  // setting of this browser that the Flow toolbar shares (state/pipes-paused.ts); paused, the area says so in `data-pipes`
  it('offers a Pause pipes button after Fit, and stops every pipe while the pipes are paused', () => {
    expect(shell()).toMatch(/<button type="button" class="small">Fit<\/button><button type="button" class="small" aria-pressed="false">Pause pipes<\/button><span class="muted small">/);
    setPipesPaused(true);
    try {
      const html = shell();
      expect(html).toContain('<button type="button" class="small">Fit</button><button type="button" class="small" aria-pressed="true">Play pipes</button>');
      expect(html).toContain('<div class="connections" data-testid="connections" aria-busy="false" data-pipes="paused">');
      // a pause stops the picked link of a huge picture too, the one pipe that moves there
      const links = Array.from({ length: 201 }, (_, i) => ({ ...redLink, id: `link:${i}` }));
      expect(withEdges(links)).toContain('aria-busy="false" data-pipes="paused">');
    } finally {
      setPipesPaused(false);
    }
    expect(shell()).toContain('aria-busy="false" data-pipes="all">');
  });
});
