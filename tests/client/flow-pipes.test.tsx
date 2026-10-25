// The Flow diagram's pipes (restyle plan Phase 1 Task 6, design spec §7): an arrow is a dark casing with its good moving
// inside, yellow for an item and cyan for a fluid, at the speed of its rate (`--pipe-dur` on the arrow's group); its head
// is in the colour of what it carries; an arrow from a missing source carries nothing. Every port is a flange whose outer
// face is where ELK ends an arrow (2 px outside the box, on the row's centre line), so a pipe meets its flange at any zoom.
// pipes.spec.ts measures that in a browser; these cases pin the markup.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowDefs, FlowEdgeShape, FlowNodeShape } from '../../src/client/views/FlowView.tsx';
import { rowCentre, type FlowLayout, type FocusSets } from '../../src/client/views/flow-model.ts';

type Edge = FlowLayout['edges'][number];

const edge: Edge = {
  id: 'e1', from: 'a', to: 'b', key: 't:iron_ingot@0', fromPort: 'a|out|t:iron_ingot@0', toPort: 'b|in|t:iron_ingot@0', perSecond: 1,
  name: 'Iron Ingot', rate: '1/s', title: 'Iron Ingot · 1/s · A → B', points: [[0, 0], [40, 0]],
};

/** One arrow as the diagram draws it: unlit (`null`), lit (`true`) or dimmed (`false`). */
const draw = (e: Edge, lit: boolean | null = null, missing = false): string =>
  renderToStaticMarkup(<svg><FlowEdgeShape edge={e} lit={lit} missing={missing} /></svg>);

/** Every class attribute of the markup, in order. */
const classes = (html: string): string[] => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1] ?? '');

describe('flow diagram: pipes (design spec §7)', () => {
  it('draws an item arrow as a casing with yellow contents that move at its rate, and its head in their colour', () => {
    const html = draw(edge);
    expect(html).toContain('class="flow-edge item"');
    expect(html).toContain('style="--pipe-dur:1s"');
    expect(html).toContain('<path class="flow-edge-flow" d="M 0 0 L 40 0">');
    expect(html).toContain('marker-end="url(#flow-arrow)"');
    // the group keeps what the hit test and the e2e tests read, the speed after them; then the tooltip, the hit path, the casing
    // (which carries the head), the contents
    expect(html).toContain('<g class="flow-edge item" data-edge-id="e1" data-key="t:iron_ingot@0" style="--pipe-dur:1s"><title>');
    expect(classes(html)).toEqual(['flow-edge item', 'flow-edge-hit', 'flow-edge-line', 'flow-edge-flow']);
    expect(html).toMatch(/<path class="flow-edge-line" d="M 0 0 L 40 0" marker-end="url\(#flow-arrow\)"><\/path><path class="flow-edge-flow"/);
  });

  it('draws a fluid arrow in the fluid colour, at the speed of its litres over a thousand', () => {
    const html = draw({ ...edge, key: 'fluid:water', perSecond: 1000 });
    expect(html).toContain('class="flow-edge fluid"');
    expect(html).toContain('marker-end="url(#flow-arrow-fluid)"');
    expect(html).toContain('--pipe-dur:1s');
  });

  it('gives an arrow from a missing source a head of its own (white on its red casing, ruling R34) and nothing moving in it', () => {
    const html = draw(edge, null, true);
    expect(html).toMatch(/class="flow-edge item missing"/);
    expect(html).toContain('marker-end="url(#flow-arrow-missing)"');
    expect(html).not.toContain('flow-edge-flow');
  });

  it('lights a focused arrow and dims the others on their group only, so `.flow-edge.hl` counts arrows', () => {
    const lit = draw(edge, true);
    expect(lit).toMatch(/class="[^"]*\bhl\b[^"]*"/);
    expect(lit).toContain('marker-end="url(#flow-arrow-hl)"');
    expect(classes(lit)).toEqual(['flow-edge item hl', 'flow-edge-hit', 'flow-edge-line', 'flow-edge-flow']);
    // a lit missing arrow is lit first: its head turns yellow like every lit head
    expect(draw(edge, true, true)).toContain('marker-end="url(#flow-arrow-hl)"');
    const dimmed = draw(edge, false);
    expect(classes(dimmed)).toEqual(['flow-edge item dim', 'flow-edge-hit', 'flow-edge-line', 'flow-edge-flow']);
    expect(dimmed).toContain('marker-end="url(#flow-arrow)"');
  });

  it('keeps a slow arrow slow and a fast one fast', () => {
    expect(draw({ ...edge, perSecond: 0.5 })).toContain('style="--pipe-dur:1.08s"');
    expect(draw({ ...edge, perSecond: 100 })).toContain('style="--pipe-dur:0.5s"');
  });

  it('defines one 8 x 8 head per colour in user space, so it never grows with the pipe, its tip on the end of the pipe', () => {
    const html = renderToStaticMarkup(<svg><FlowDefs /></svg>);
    const markers = html.match(/<marker [^>]*>/g) ?? [];
    expect(markers.map((m) => m.match(/ id="([^"]*)"/)?.[1])).toEqual(['flow-arrow', 'flow-arrow-fluid', 'flow-arrow-hl', 'flow-arrow-missing']);
    for (const marker of markers) {
      for (const attribute of ['markerUnits="userSpaceOnUse"', 'markerWidth="8"', 'markerHeight="8"', 'refX="10"', 'refY="5"', 'viewBox="0 0 10 10"']) {
        expect(marker, attribute).toContain(attribute);
      }
    }
    // the tip of each head is the point (10, 5) the marker puts on the end of the pipe
    for (const head of ['flow-arrow-head', 'flow-arrow-head-fluid', 'flow-arrow-head-hl', 'flow-arrow-head-missing']) {
      expect(html, head).toContain(`<path class="${head}" d="M 0 0 L 10 5 L 0 10 z">`);
    }
    // and the half-and-half fill of a partly owned box is still defined beside them
    expect(html).toContain('<linearGradient id="flow-partly" x1="0" x2="1" y1="0" y2="0"><stop class="flow-stop-owned" offset="0.5"></stop><stop class="flow-stop-new" offset="0.5"></stop></linearGradient>');
  });
});

describe('flow diagram: flanges (design spec §7 "Connected")', () => {
  const node: FlowLayout['nodes'][number] = {
    id: 'mill', kind: 'step', key: 't:copper_wire@0', title: 'Wiremill', lines: ['LV · 32 EU/t · 1 machine'], owned: 'none', width: 200, height: 86,
    rows: [
      { side: 'in', key: 't:copper_ingot@0', port: 'mill|in|t:copper_ingot@0', name: 'Copper Ingot', rate: '1/s' },
      { side: 'out', key: 't:copper_wire@0', port: 'mill|out|t:copper_wire@0', name: 'Copper Wire', rate: '2/s', main: true },
    ],
    x: 0, y: 0,
  };

  it('ends each row on a flange 4 px deep across the box edge and 10 px tall: its outer face is where ELK ends the arrow', () => {
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} /></svg>);
    expect(html).toContain(`<rect class="flow-port" x="198" y="${rowCentre(node, 1) - 5}" width="4" height="10"`);
    expect(html).toContain(`<rect class="flow-port" x="-2" y="${rowCentre(node, 0) - 5}" width="4" height="10"`);
    // the last thing in its row, so it is painted over the pipe's end, and only geometry: no data-port (the e2e hover locator
    // of a row is strict), no state class
    expect(html.match(/<rect class="flow-port" x="[-\d.]+" y="[-\d.]+" width="4" height="10"><\/rect><\/g>/g)).toHaveLength(2);
    // the box still renders as flow.test.tsx reads it: its class right before data-node-id, and no hl or dim word unlit
    expect(html.match(/<g class="([^"]*)" data-node-id/)?.[1]).toBe('flow-node step new');
    expect(html).not.toMatch(/\b(hl|dim)\b/);
    expect(html).not.toContain('<circle');
  });

  it('lights a row on its group under a focus, never on its flange', () => {
    const sets: FocusSets = {
      nodes: new Set(['mill']), edges: new Set(), ports: new Set(['mill|out|t:copper_wire@0']), producers: new Set(['mill']), consumers: new Set(),
    };
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} sets={sets} /></svg>);
    expect(html).toMatch(/<g class="flow-row out main hl" data-port="mill\|out\|t:copper_wire@0"/);
    expect(html).toContain(`<rect class="flow-port" x="198" y="${rowCentre(node, 1) - 5}" width="4" height="10"></rect></g>`);
  });

  // Phase 2 spec §6.4: an icon in a box shows no tip of its own (`tip={false}`), as the box tells what it holds; until Task 3b moves the
  // box's words to its `data-tip`, its <title> tells them, so nothing shows two tips
  it('draws no item tip inside a box, whose own title still tells it', () => {
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} /></svg>);
    expect(html).not.toMatch(/<span class="item-icon[^"]*"[^>]*data-tip=/);
    expect(html.match(/<span class="item-icon/g)).toHaveLength(3);                      // the head's icon and one a row, all without one
    expect(html).toContain('<title>Wiremill\nLV · 32 EU/t · 1 machine\ntakes Copper Ingot 1/s\nmakes Copper Wire 2/s</title>');
  });
});
