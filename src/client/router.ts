// Client-side routes on the history API: /login, the top-level pages of TOP_PAGES (read at call time, so pages later
// plans append are matched), /p/:id for a project, and a not-found page for anything else.

import { useMemo, useSyncExternalStore, type MouseEvent } from 'react';
import { TOP_PAGES } from './views/top-pages.ts';

export type Route = { name: 'login' } | { name: 'top'; path: string } | { name: 'project'; id: string } | { name: 'notFound' };

const PROJECT_PATH = /^\/p\/([^/]+)$/;

export function matchPath(pathname: string): Route {
  if (pathname === '/login') return { name: 'login' };
  if (TOP_PAGES.some((page) => page.path === pathname)) return { name: 'top', path: pathname };
  const project = PROJECT_PATH.exec(pathname);
  if (project !== null) {
    try {
      return { name: 'project', id: decodeURIComponent(project[1]!) };
    } catch {
      // a malformed %-escape names no project
    }
  }
  return { name: 'notFound' };
}

const listeners = new Set<() => void>();

/** Path, query and hash of the page now open. */
export function currentPath(): string {
  return location.pathname + location.search + location.hash;
}

/** Opens `path` (path, optional query and hash) without reloading the page. */
export function navigate(path: string): void {
  const oldURL = location.href;
  if (path !== currentPath()) history.pushState(null, '', path);
  for (const fn of [...listeners]) fn();
  // pushState never fires hashchange, but views that follow the hash (the project tabs) must see a new one.
  if (location.href !== oldURL && new URL(oldURL).hash !== location.hash) {
    dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
  }
}

/** For an in-app `<a href={path}>`: a plain left click navigates in place, a modified click (new tab) is left alone. */
export function followLink(event: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    removeEventListener('popstate', fn);
  };
}

const pathname = (): string => location.pathname;

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, pathname, () => '/');
  return useMemo(() => matchPath(path), [path]);
}
