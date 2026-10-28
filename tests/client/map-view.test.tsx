import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapView } from '../../src/client/views/MapView.tsx';

describe('MapView (server-side render: effects do not run)', () => {
  it('renders a labelled canvas and the Y slider', () => {
    const html = renderToStaticMarkup(<MapView scanId="s" dim={0} />);
    expect(html).toContain('role="img"');
    for (const attr of ['type="range"', 'min="0"', 'max="255"', 'aria-label="Y level"']) expect(html).toContain(attr);
  });

  it('names the dimension, starts at the surface and offers Re-centre only with a focus', () => {
    const plain = renderToStaticMarkup(<MapView scanId="s" dim={-1} />);
    expect(plain).toContain('aria-label="Map of Nether"');
    expect(plain).toContain('value="255"');
    expect(plain).toContain('surface');
    expect(plain).toContain('aria-label="Zoom in"');
    expect(plain).toContain('aria-label="Zoom out"');
    expect(plain).not.toContain('Re-centre');
    const focused = renderToStaticMarkup(<MapView scanId="s" dim={0} focus={[4.5, 5.5]} markers={[{ n: 1, pos: [4, 64, 5], color: '#ffb300', label: 'Build here' }]} />);
    expect(focused).toContain('aria-label="Map of Overworld"');
    expect(focused).toContain('Re-centre');
  });
});

// The chrome round the canvas (restyle plan Phase 1 Task 8): classes, not inline styles. The one inline style left is the canvas's
// own: its cursor is written from code, and nothing (no border, no padding) may frame it. The frame is the box's.
describe('MapView chrome', () => {
  it('lays the toolbar and the box out with classes', () => {
    const html = renderToStaticMarkup(<MapView scanId="s" dim={0} focus={[4.5, 5.5]} />);
    expect(html).toContain('<div class="map-view">');
    expect(html).toContain('<div class="row map-toolbar">');
    expect(html).toContain('<button type="button" class="small map-zoom" aria-label="Zoom in">+</button>');
    expect(html).toContain('<button type="button" class="small map-zoom" aria-label="Zoom out">−</button>');
    expect(html).toContain('<button type="button" class="small">Re-centre</button>');
    expect(html).toContain('<span class="map-y">surface</span>');
    // the canvas is the box's own child: nothing sits between them to frame or to move it
    expect(html).toContain('<div class="map-box"><canvas role="img" aria-label="Map of Overworld"');
    expect(html.match(/ style="/g)).toHaveLength(1);
    expect(html).toContain('style="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab"');
  });
});
