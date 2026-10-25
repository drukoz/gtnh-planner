// The group's projects changed in a way the project list cannot hear (Phase 2 spec §12.1): a project deleted here was restored from its
// toast's Undo, which the App draws over whatever page is open. The list has no live channel (ruling C17), so it loads again whenever this
// count moves, and drops the "was deleted" notice that no longer holds. One value for the page, kept as pin-focus.ts keeps the focused pin.

import { useSyncExternalStore } from 'react';

let changes = 0;
const listeners = new Set<() => void>();

/** Says the projects changed: the list loads them again. */
export function bumpProjectsChanged(): void {
  changes += 1;
  for (const fn of [...listeners]) fn();
}

/** How many times the projects changed since the page opened. */
export function getProjectsChanged(): number {
  return changes;
}

export function subscribeProjectsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The count, re-rendering when it moves; the server snapshot is the same, so pages rendered to a string work too (ruling R13 e). */
export function useProjectsChanged(): number {
  return useSyncExternalStore(subscribeProjectsChanged, getProjectsChanged, getProjectsChanged);
}
