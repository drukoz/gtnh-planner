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
