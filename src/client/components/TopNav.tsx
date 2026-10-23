// The header above every page but the login form: one link per top-level page (TOP_PAGES, read on every render so
// pages later plans append show up), the current one marked for screen readers and styling.

import type { ReactElement } from 'react';
import { followLink } from '../router.ts';
import { TOP_PAGES } from '../views/top-pages.ts';

export function TopNav(props: { current: string }): ReactElement {
  return (
    <header className="top-nav">
      <span className="brand"><span className="brand-mark" aria-hidden="true" />GTNH Line Planner</span>
      <nav aria-label="Pages">
        {TOP_PAGES.map((page) => (
          <a key={page.path} href={page.path} aria-current={page.path === props.current ? 'page' : undefined} onClick={(e) => followLink(e, page.path)}>{page.label}</a>
        ))}
      </nav>
    </header>
  );
}
