// How "To build (once)" is shown (Phase 2 spec §9.1, D9): as the List, the default and the source of truth for tests, or as the opt-in
// inventory Grid. One choice for this browser, kept in localStorage under `gtnh-planner:materials-view`, where anything but `'grid'` reads as
// the List. It is a display choice, not a project setting, so no op is sent; and since it lives here, not in the tab panel's state, it
// outlives the panel's remount on every tab switch. The pipes-paused.ts pattern: a browser that refuses storage keeps the choice for this
// page's lifetime, and so does one that can read its storage but not write it.

import { useSyncExternalStore } from 'react';

export const MATERIALS_VIEW_KEY = 'gtnh-planner:materials-view';
export type MaterialsViewMode = 'list' | 'grid';

/** The choice made on this page when storage refused to keep it; null while storage keeps it (or nothing was chosen). */
let pageValue: MaterialsViewMode | null = null;
const listeners = new Set<() => void>();

/** What this page chose when storage refused it, else what storage holds, else the List (a missing or unknown value is the List). */
export function getMaterialsView(): MaterialsViewMode {
  if (pageValue !== null) return pageValue;
  try {
    return globalThis.localStorage?.getItem(MATERIALS_VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';   // storage is disabled or refused
  }
}

/** Shows the build list as `mode` in this browser, and tells every view. */
export function setMaterialsView(mode: MaterialsViewMode): void {
  let kept = false;
  try {
    const storage = globalThis.localStorage;
    if (storage !== undefined) {
      storage.setItem(MATERIALS_VIEW_KEY, mode);
      kept = true;
    }
  } catch {
    // refused: kept for this page only
  }
  pageValue = kept ? null : mode;
  for (const fn of [...listeners]) fn();
}

/** Calls `fn` when the choice changes, here or in another tab of this browser; returns how to stop. */
export function subscribeMaterialsView(fn: () => void): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === MATERIALS_VIEW_KEY) fn();
  };
  listeners.add(fn);
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

/** How the build list is shown, re-rendering when that changes; the server snapshot is the same, so pages rendered to a string work too. */
export function useMaterialsView(): MaterialsViewMode {
  return useSyncExternalStore(subscribeMaterialsView, getMaterialsView, getMaterialsView);
}
