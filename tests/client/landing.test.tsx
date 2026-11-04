// The landing page (RUK-510): the site's front page, open to anyone. Its markup, which the routing and end-to-end tests rely
// on, and the rule that it asks the server for nothing.

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from '../../src/client/views/LandingPage.tsx';

const html = renderToStaticMarkup(<LandingPage />);
const source = readFileSync(new URL('../../src/client/views/LandingPage.tsx', import.meta.url), 'utf8');

describe('the landing page', () => {
  it('names the planner in its one h1, and its first link is the way in', () => {
    expect(html.startsWith('<main class="page landing">')).toBe(true);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('>GTNH Line Planner</h1>');
    const firstLink = html.slice(html.indexOf('<a '), html.indexOf('</a>') + 4);
    expect(firstLink).toMatch(/^<a [^>]*href="\/projects"[^>]*>Open the planner<\/a>$/);
    expect(html).toMatch(/<a [^>]*href="\/world"[^>]*>Upload a world<\/a>/);
  });

  it('lists six things the planner does and three steps to start', () => {
    const list = (tag: 'ul' | 'ol'): string => html.slice(html.indexOf(`<${tag} `), html.indexOf(`</${tag}>`));
    expect(list('ul').match(/<li class="card">/g)).toHaveLength(6);
    expect(list('ol').match(/<li class="card">/g)).toHaveLength(3);
    for (const title of ['The recipe chain', 'Fits your base', '3D view', 'Logistics', 'Materials and steps', 'In-game projector',
      'Export your pack', 'Upload your world', 'Plan and build']) expect(html).toContain(`<h3>${title}</h3>`);
    expect(html).toContain('<code>npm run extract-assets</code>');
  });

  it('says nothing about a password, which the planner asks for only when one is on', () => {
    expect(html.toLowerCase()).not.toContain('password');
  });

  it('asks the server for nothing and draws no game texture', () => {
    for (const needle of ["from '../api/", "from '../assets/", 'fetch(', 'EventSource', 'ItemIcon', 'apiGet', 'apiPost']) {
      expect(source, needle).not.toContain(needle);
    }
  });
});
