// How "To build (once)" is shown (Phase 2 spec §9.1, D9): as the List, the default and the source of truth for tests, or as the opt-in
// inventory Grid. One choice for this browser, kept in localStorage under `gtnh-planner:materials-view`, where anything but `'grid'` reads as
// the List. It is a display choice, not a project setting, so no op is sent; and since it lives here, not in the tab panel's state, it
// outlives the panel's remount on every tab switch. A browser that refuses storage keeps the choice for this page's lifetime, and so does one
// that can read its storage but not write it (the one store of the per-browser settings, browser-choice.ts: ledger ruling P2-R40).

import { createBrowserChoice } from './browser-choice.ts';

export const MATERIALS_VIEW_KEY = 'gtnh-planner:materials-view';
export type MaterialsViewMode = 'list' | 'grid';

/** Grid is `'grid'` in storage, the List `'list'`; anything else, or nothing stored, is the List. */
const materialsView = createBrowserChoice<MaterialsViewMode>({
  key: MATERIALS_VIEW_KEY,
  read: (stored) => (stored === 'grid' ? 'grid' : 'list'),
  write: (mode) => mode,
});

/** What this page chose when storage refused it, else what storage holds, else the List (a missing or unknown value is the List). */
export function getMaterialsView(): MaterialsViewMode {
  return materialsView.get();
}

/** Shows the build list as `mode` in this browser, and tells every view. */
export function setMaterialsView(mode: MaterialsViewMode): void {
  materialsView.set(mode);
}

/** Calls `fn` when the choice changes, here or in another tab of this browser; returns how to stop. */
export function subscribeMaterialsView(fn: () => void): () => void {
  return materialsView.subscribe(fn);
}

/** How the build list is shown, re-rendering when that changes; the server snapshot is the same, so pages rendered to a string work too. */
export function useMaterialsView(): MaterialsViewMode {
  return materialsView.use();
}
