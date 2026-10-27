// The header above every page but the login form: one link per top-level page (TOP_PAGES, read on every render so
// pages later plans append show up), the current one marked for screen readers and styling; and, after the pages, the Theme
// button (Phase 2 spec §4.8), which says the look this browser chose.

import type { ReactElement } from 'react';
import { followLink } from '../router.ts';
import { useThemeChoice } from '../state/theme.ts';
import { TOP_PAGES } from '../views/top-pages.ts';
import { ThemeButton } from './ThemeButton.tsx';

export function TopNav(props: { current: string }): ReactElement {
  const theme = useThemeChoice();
  return (
    <header className="top-nav">
      <span className="brand"><span className="brand-mark" aria-hidden="true" />GTNH Line Planner</span>
      <nav aria-label="Pages">
        {TOP_PAGES.map((page) => (
          <a key={page.path} href={page.path} aria-current={page.path === props.current ? 'page' : undefined} onClick={(e) => followLink(e, page.path)}>{page.label}</a>
        ))}
      </nav>
      <ThemeButton choice={theme} />
    </header>
  );
}
