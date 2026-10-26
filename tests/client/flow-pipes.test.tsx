// The Flow diagram's pipes (restyle plan Phase 1 Task 6, design spec §7): an arrow is a dark casing with its good moving
// inside, yellow for an item and cyan for a fluid, at the speed of its rate (`--pipe-dur` on the arrow's group); its head
// is in the colour of what it carries; an arrow from a missing source carries nothing. Every port is a flange whose outer
// face is where ELK ends an arrow (2 px outside the box, on the row's centre line), so a pipe meets its flange at any zoom.
// pipes.spec.ts measures that in a browser; these cases pin the markup. Phase 2 Task 12 (spec §15.3): a good rides each pipe, a 12 px
// icon the stylesheet carries along the arrow's path, in a layer of its own, so the arrow's own markup stays as it is.

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useItemIcon } from '../../src/client/assets/icons.ts';
import { FlowDefs, FlowEdgeShape, FlowNodeShape, FlowRiderShape } from '../../src/client/views/FlowView.tsx';
import { machineReadout, rowCentre, type FlowLayout, type FocusSets } from '../../src/client/views/flow-model.ts';
import { riderPhase } from '../../src/client/views/pipe-motion.ts';
import { hashColor, type IconDescriptor, type Rgb } from '../../src/shared/types/assets.ts';
import type { PlanStep } from '../../src/shared/types/plan.ts';

// The real hook, except where a case hands a rider a descriptor and an image URL (server rendering never gets either), as item-icon.test.tsx
vi.mock('../../src/client/assets/icons.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/assets/icons.ts')>();
  return { ...actual, useItemIcon: vi.fn(actual.useItemIcon) };
});

type Edge = FlowLayout['edges'][number];

const edge: Edge = {
  id: 'e1', from: 'a', to: 'b', key: 't:iron_ingot@0', fromPort: 'a|out|t:iron_ingot@0', toPort: 'b|in|t:iron_ingot@0', perSecond: 1,
  name: 'Iron Ingot', rate: '1/s', title: 'Iron Ingot · 1/s · A → B', route: 'A → B', points: [[0, 0], [40, 0]],
};

/** One arrow as the diagram draws it: unlit (`null`), lit (`true`) or dimmed (`false`). */
const draw = (e: Edge, lit: boolean | null = null, missing = false): string =>
  renderToStaticMarkup(<svg><FlowEdgeShape edge={e} lit={lit} missing={missing} /></svg>);

/** Every class attribute of the markup, in order. */
const classes = (html: string): string[] => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1] ?? '');

/** A rider's placeholder picture (ledger ruling P2-R96): a 1 × 1 square of `rgb` as an SVG data URI, its quotes written %22. */
const swatch = ([r, g, b]: Rgb): string => (
  `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22 shape-rendering=%22crispEdges%22%3E`
  + `%3Crect width=%221%22 height=%221%22 fill=%22rgb(${r},${g},${b})%22/%3E%3C/svg%3E`
);

/** A rider's delay into its ride: its phase of `seconds`, in hundredths. */
const delay = (id: string, seconds: number): number => Math.round(riderPhase(id) * seconds * 100) / 100;

describe('flow diagram: pipes (design spec §7)', () => {
  it('draws an item arrow as a casing with yellow contents that move at its rate, and its head in their colour', () => {
    const html = draw(edge);
    expect(html).toContain('class="flow-edge item"');
    expect(html).toContain('style="--pipe-dur:1s"');
    expect(html).toContain('<path class="flow-edge-flow" d="M 0 0 L 40 0">');
    expect(html).toContain('marker-end="url(#flow-arrow)"');
    // the group keeps what the hit test and the e2e tests read, the speed after them, then its accessible name and its tooltip's three
    // lines (Phase 2 spec §6.4); then the hit path, the casing (which carries the head), the contents
    expect(html).toContain('<g class="flow-edge item" data-edge-id="e1" data-key="t:iron_ingot@0" style="--pipe-dur:1s" aria-label="Iron Ingot · 1/s · A → B" data-tip="Iron Ingot\n1/s\nA → B"><path class="flow-edge-hit"');
    expect(html).not.toContain('<title');
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
    // a lit missing arrow keeps its white head (ruling R41): yellow reads 2.95:1 on its red casing
    expect(draw(edge, true, true)).toContain('marker-end="url(#flow-arrow-missing)"');
    const dimmed = draw(edge, false);
    expect(classes(dimmed)).toEqual(['flow-edge item dim', 'flow-edge-hit', 'flow-edge-line', 'flow-edge-flow']);
    expect(dimmed).toContain('marker-end="url(#flow-arrow)"');
  });

  it('keeps a slow arrow slow and a fast one fast', () => {
    expect(draw({ ...edge, perSecond: 0.5 })).toContain('style="--pipe-dur:1.08s"');
    expect(draw({ ...edge, perSecond: 100 })).toContain('style="--pipe-dur:0.5s"');
  });

  // Phase 2 spec §15.3 and fix round 1 (ledger rulings P2-R96, P2-R97): in node no icon URL ever arrives (the icon hook answers in an
  // effect), so a rider shows its placeholder: the same <image>, its picture a square of its good's colour (an SVG data URI) until the icon
  // comes, so it is never swapped for another element and its ride never starts over. The stylesheet moves it along the pipe's route carried
  // on 9 px past each end, into the boxes (`offset-path`: 58 px, under 64 px a cycle, so the 1.2 s floor), and its negative delay starts it
  // part-way, at its edge's phase
  it('draws a rider as a 12 px image that rides its pipe, and a placeholder until its icon loads', () => {
    const ride = (e: Edge, lit: boolean | null = null): string => renderToStaticMarkup(<svg><FlowRiderShape edge={e} lit={lit} /></svg>);
    const style = `style="offset-path:path(&#x27;M -9 0 L 49 0&#x27;);--rider-dur:1.2s;animation-delay:-${delay('e1', 1.2)}s"`;
    const image = (classes: string): string => (
      `<image class="${classes}" href="${swatch(hashColor('t:iron_ingot@0'))}" x="-6" y="-6" width="12" height="12" ${style}></image>`
    );
    expect(ride(edge)).toBe(`<svg>${image('flow-rider placeholder item')}</svg>`);
    // lit and dimmed with its pipe, so `.flow-canvas.focusing .dim` fades it and a dimmed one stands still
    expect(ride(edge, true)).toBe(`<svg>${image('flow-rider placeholder item hl')}</svg>`);
    expect(ride(edge, false)).toBe(`<svg>${image('flow-rider placeholder item dim')}</svg>`);
    // a fluid in its own colour; a longer route rides longer, at its rate (178 px, 160 and 9 at each end, is 2.78 cycles of a second)
    const fluid = ride({ ...edge, key: 'fluid:water', perSecond: 1000 });
    expect(fluid).toContain(`<image class="flow-rider placeholder fluid" href="${swatch(hashColor('fluid:water'))}" x="-6" y="-6" width="12" height="12"`);
    const long = ride({ ...edge, id: 'e2', points: [[0, 0], [100, 0], [100, 60]] });
    expect(long).toContain(`style="offset-path:path(&#x27;M -9 0 L 100 0 L 100 69&#x27;);--rider-dur:2.78s;animation-delay:-${delay('e2', 2.78)}s"`);
    // never what the hit test, the tooltips or the e2e locators read on an arrow or a box
    for (const html of [ride(edge), ride(edge, true), fluid, long]) {
      expect(html).not.toMatch(/flow-edge|data-edge-id|data-step-id|data-tip|data-key|flow-port/);
    }
  });

  // fix round 1 (M2, ledger ruling P2-R96): once the icon has come, the same <image> shows it, the placeholder class gone; while only the
  // descriptor has, its square takes the server's fallback colour
  it('draws a rider\'s icon once it has come, in the same image, and the server\'s colour before it', () => {
    const desc: IconDescriptor = { key: 't:iron_ingot@0', layers: [], source: 'jar', fallbackColor: [10, 20, 30] };
    const ride = (e: Edge, lit: boolean | null, icon: { desc: IconDescriptor | null; url: string | null }): string => {
      vi.mocked(useItemIcon).mockReturnValueOnce(icon);
      return renderToStaticMarkup(<svg><FlowRiderShape edge={e} lit={lit} /></svg>);
    };
    const style = `style="offset-path:path(&#x27;M -9 0 L 49 0&#x27;);--rider-dur:1.2s;animation-delay:-${delay('e1', 1.2)}s"`;
    const loaded = (classes: string): string => `<svg><image class="${classes}" href="blob:x" x="-6" y="-6" width="12" height="12" ${style}></image></svg>`;
    expect(ride(edge, null, { desc, url: 'blob:x' })).toBe(loaded('flow-rider item'));
    expect(ride(edge, true, { desc, url: 'blob:x' })).toBe(loaded('flow-rider item hl'));
    expect(ride(edge, false, { desc, url: 'blob:x' })).toBe(loaded('flow-rider item dim'));
    expect(ride({ ...edge, key: 'fluid:water', perSecond: 1000 }, null, { desc, url: 'blob:x' })).toBe(loaded('flow-rider fluid'));
    // the icon asked for is the rows' 16 px one, whose image the cache already holds
    expect(vi.mocked(useItemIcon)).toHaveBeenLastCalledWith('fluid:water', 16);
    const described = ride(edge, null, { desc, url: null });
    expect(described).toBe(`<svg><image class="flow-rider placeholder item" href="${swatch([10, 20, 30])}" x="-6" y="-6" width="12" height="12" ${style}></image></svg>`);
  });

  // fix round 1 (M3): a rider draws only from its arrow and whether it is lit, so it is memoized: a pan or a zoom, which draws the whole canvas
  // again, leaves every rider as it is (pipes.spec.ts shows it in a browser: a view change keeps each rider's props)
  it('memoizes a rider on its arrow and its light', () => {
    const memo = FlowRiderShape as unknown as { $$typeof: symbol; compare: unknown; type: unknown };
    expect(memo.$$typeof).toBe(Symbol.for('react.memo'));
    expect(memo.compare).toBeNull();                                                   // React's own shallow comparison of the props
    expect(typeof memo.type).toBe('function');
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

  // Phase 2 spec §7.6 (Task 4): the same box with its machine readout, whose head (46 px) and busy band (16 px) push the rows down 18 px;
  // each flange still sits on its row's centre line, as ELK's port does (both read rowCentre), and the box keeps the pins above
  it('ends each row on its flange under a machine readout too, the rows below the head and the busy band', () => {
    const wiremill: PlanStep = {
      id: 'mill', recipeId: 'mill', mapId: 'gt.recipe.wiremill', machine: { mteId: 111, name: 'Wiremill', tier: 1 }, count: 1, owned: 0, runsPerSecond: 1,
      utilization: 0.5, euPerTick: 32, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [],
    };
    const readout = { ...node, machine: machineReadout(wiremill) };
    expect(rowCentre(readout, 1)).toBe(rowCentre(node, 1) + 18);
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={readout} /></svg>);
    expect(html).toContain(`<rect class="flow-port" x="198" y="${rowCentre(readout, 1) - 5}" width="4" height="10"`);
    expect(html).toContain(`<rect class="flow-port" x="-2" y="${rowCentre(readout, 0) - 5}" width="4" height="10"`);
    expect(html.match(/<rect class="flow-port" x="[-\d.]+" y="[-\d.]+" width="4" height="10"><\/rect><\/g>/g)).toHaveLength(2);
    expect(html.match(/<g class="([^"]*)" data-node-id/)?.[1]).toBe('flow-node step new');
    expect(html).not.toMatch(/\b(hl|dim)\b/);
    expect(html).not.toContain('<circle');
    // the machine's icon shows no tip of its own either: the box's tells it
    expect(html).not.toMatch(/<span class="item-icon[^"]*"[^>]*data-tip=/);
    expect(html).toContain('data-item-key="gregtech:gt.blockmachines@111"');
  });

  it('lights a row on its group under a focus, never on its flange', () => {
    const sets: FocusSets = {
      nodes: new Set(['mill']), edges: new Set(), ports: new Set(['mill|out|t:copper_wire@0']), producers: new Set(['mill']), consumers: new Set(),
    };
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} sets={sets} /></svg>);
    expect(html).toMatch(/<g class="flow-row out main hl" data-port="mill\|out\|t:copper_wire@0"/);
    expect(html).toContain(`<rect class="flow-port" x="198" y="${rowCentre(node, 1) - 5}" width="4" height="10"></rect></g>`);
  });

  // Phase 2 spec §6.4: an icon in a box shows no tip of its own (`tip={false}`), as the box tells what it holds in its own tip (its
  // `data-tip`), so nothing shows two tips
  it('draws no item tip inside a box, whose own tip tells it', () => {
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} /></svg>);
    expect(html).not.toMatch(/<span class="item-icon[^"]*"[^>]*data-tip=/);
    expect(html.match(/<span class="item-icon/g)).toHaveLength(3);                      // the head's icon and one a row, all without one
    expect(html).toContain(' data-tip="Wiremill\nLV · 32 EU/t · 1 machine\ntakes Copper Ingot 1/s\nmakes Copper Wire 2/s">');
  });

  // Phase 2 spec §6.4 and §6.6: the box's words, its title, lines and rows, one a line, are its tip and its accessible name, written after
  // its transform (its class stays right before data-node-id); no SVG title, so the box rect is its first child
  it('tells a box\'s words in its tooltip and name', () => {
    const html = renderToStaticMarkup(<svg><FlowNodeShape node={node} /></svg>);
    expect(html).not.toContain('<title');
    const tip = 'Wiremill\nLV · 32 EU/t · 1 machine\ntakes Copper Ingot 1/s\nmakes Copper Wire 2/s';
    expect(html).toContain(
      `<g class="flow-node step new" data-node-id="mill" data-step-id="mill" data-kind="step" transform="translate(0 0)" aria-label="${tip}" data-tip="${tip}"><rect class="flow-node-box"`,
    );
  });
});
