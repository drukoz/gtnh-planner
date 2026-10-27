// The group's projects changed in a way the project list cannot hear (Phase 2 spec §12.1): a project deleted here was restored from its
// toast's Undo, which the App draws over whatever page is open. The list has no live channel (ruling C17), so it loads again whenever this
// count moves, and drops its "was deleted" notice if it is about a project restored since it last looked (`restoredSince`, Task 9b's M5).
// One value for the page, kept as pin-focus.ts keeps the focused pin.

import { useSyncExternalStore } from 'react';

let changes = 0;
/** The changes that restored a project, the latest few: a reader looks back over those since it last looked. */
let restores: Array<{ change: number; id: string }> = [];
const RESTORES_KEPT = 16;
const listeners = new Set<() => void>();

/** Says the projects changed, by a restore of project `restored` when given: the list loads them again. */
export function bumpProjectsChanged(restored?: string): void {
  changes += 1;
  if (restored !== undefined) restores = [...restores.slice(1 - RESTORES_KEPT), { change: changes, id: restored }];
  for (const fn of [...listeners]) fn();
}

/** The projects restored by the changes after change `n`, oldest first. */
export function restoredSince(n: number): string[] {
  return restores.filter((r) => r.change > n).map((r) => r.id);
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
