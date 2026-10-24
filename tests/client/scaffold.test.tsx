import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchPath } from '../../src/client/router.ts';
import { TOP_PAGES } from '../../src/client/views/top-pages.ts';
import { TopNav } from '../../src/client/components/TopNav.tsx';
import { PROJECT_TABS, tabFromHash } from '../../src/client/views/project-tabs.ts';
import { getName, setName } from '../../src/client/state/name.ts';
import { ItemIcon } from '../../src/client/components/ItemIcon.tsx';
import { Tick } from '../../src/client/components/Tick.tsx';
import { NotesView } from '../../src/client/views/NotesView.tsx';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Project } from '../../src/shared/types/project.ts';

const P0: Project = { id: 'p1', name: 'Steel', createdAt: 't', createdBy: 'Ann', rev: 0, settings: defaultSettings(), world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };

describe('router and top pages', () => {
  it('matches the login page, top pages, projects and anything else', () => {
    expect(matchPath('/login')).toEqual({ name: 'login' });
    expect(matchPath('/p/abc')).toEqual({ name: 'project', id: 'abc' });
    expect(matchPath('/')).toEqual({ name: 'top', path: '/' });
    expect(matchPath('/nope/x')).toEqual({ name: 'notFound' });
  });
  it('reads appended top pages at call time, in the router and in the header', () => {
    TOP_PAGES.push({ path: '/x', label: 'X', component: () => null });
    try {
      expect(matchPath('/x')).toEqual({ name: 'top', path: '/x' });
      const html = renderToStaticMarkup(<TopNav current="/" />);
      expect(html).toContain('Projects');
      expect(html).toContain('>X<');
      expect(html).toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"/);
      expect(html).not.toMatch(/<a[^>]*href="\/x"[^>]*aria-current/);
    } finally {
      TOP_PAGES.pop();
    }
  });
  it('draws the pixel brand mark before the name, as decoration only', () => {
    // the mark is a CSS background (styles.css `--brand-mark`): the span is empty and hidden from screen readers, so the
    // brand reads as "GTNH Line Planner" and is still no link (flow-focus.spec.ts looks up the link named "Projects")
    expect(renderToStaticMarkup(<TopNav current="/" />)).toContain(
      '<span class="brand"><span class="brand-mark" aria-hidden="true"></span>GTNH Line Planner</span>',
    );
  });
});

describe('project tabs', () => {
  it('opens the tab named by the hash, else the first tab', () => {
    expect(tabFromHash('')).toBe(PROJECT_TABS[0]!.id);
    expect(tabFromHash('#bogus')).toBe(PROJECT_TABS[0]!.id);
    expect(tabFromHash('#notes')).toBe('notes');
    expect(PROJECT_TABS.map((t) => t.id)).toContain('notes');   // later tasks add tabs before it
  });
});

describe('display name', () => {
  it('survives a browser that refuses storage (private windows)', () => {
    const refuse = () => { throw new Error('storage is disabled'); };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 });
    try {
      expect(getName()).toBeNull();
      expect(() => setName('  Jörg 🙂  ')).not.toThrow();
      expect(getName()).toBe('Jörg 🙂');                       // kept for this page's lifetime
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('components', () => {
  it('draws a placeholder item icon of the given size', () => {
    const html = renderToStaticMarkup(<ItemIcon itemKey="gregtech:gt.metaitem.01@2032" size={32} />);
    expect(html).toContain('title="gregtech:gt.metaitem.01@2032"');
    expect(html).toContain('width:32px');
    expect(html).toContain('data-item-key="gregtech:gt.metaitem.01@2032"');
  });
  it('shows who ticked a row', () => {
    const html = renderToStaticMarkup(<Tick row="run:t:iron_ingot@0" mark={{ by: 'Jörg 🙂', at: '2026-10-17T12:00:00.000Z' }} onToggle={() => {}} label="Iron Ingot" />);
    expect(html).toMatch(/data-row="run:t:iron_ingot@0"[^>]*data-marked="true"/);
    expect(html).toContain('✓ Jörg 🙂');
    expect(renderToStaticMarkup(<Tick row="run:a" mark={undefined} onToggle={() => {}} label="A" />)).toContain('data-marked="false"');
  });
  it('lists notes with their author', () => {
    const project = { ...P0, notes: [{ id: 'n1', text: 'tap power here', by: 'Jörg 🙂', at: '2026-10-17T12:00:00.000Z' }] };
    const html = renderToStaticMarkup(<NotesView project={project} plan={null} send={() => {}} me="Ann" />);
    expect(html).toContain('tap power here');
    expect(html).toContain('Jörg 🙂');
  });
});
