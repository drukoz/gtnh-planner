// How this browser shows "To build (once)" (Phase 2 spec §9.1, D9): as the List, the default, or as the opt-in inventory Grid, one choice for
// this browser kept in localStorage under `gtnh-planner:materials-view`, and anything but `'grid'` there reads as the List. It is a display
// choice, not a project setting, so it sends no op; and it outlives the tab panel, which remounts on every tab switch. These cases pin how the
// choice is stored; the store's storage cases (refused storage, storage read but not written, its subscribers) are browser-choice.test.tsx's,
// asserted there for this choice (ledger ruling P2-R40). materials-grid.spec.ts presses the toggle in a browser.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { MATERIALS_VIEW_KEY, getMaterialsView, setMaterialsView } from '../../src/client/state/materials-view.ts';
import { keepIn } from './storage-stub.ts';

// A choice that storage keeps sets the module's page value back to null, which `vi.unstubAllGlobals()` alone would not: a test that left a
// page value behind would decide the next one's reads (theme.test.tsx's reset).
afterEach(() => {
  vi.stubGlobal('localStorage', keepIn(new Map()));
  setMaterialsView('list');
  vi.unstubAllGlobals();
});

describe('the Grid / List choice of the build list', () => {
  it('reads List by default', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    expect(getMaterialsView()).toBe('list');
  });

  it('keeps Grid in this browser\'s storage, finds it there when the page is loaded again, and reads anything else as List', () => {
    expect(MATERIALS_VIEW_KEY).toBe('gtnh-planner:materials-view');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', keepIn(store));
    setMaterialsView('grid');
    expect([store.get(MATERIALS_VIEW_KEY), getMaterialsView()]).toEqual(['grid', 'grid']);
    setMaterialsView('list');
    expect([store.get(MATERIALS_VIEW_KEY), getMaterialsView()]).toEqual(['list', 'list']);
    // what an earlier visit or another tab of this browser kept is read from the storage, not from this page
    store.set(MATERIALS_VIEW_KEY, 'grid');
    expect(getMaterialsView()).toBe('grid');
    // and anything but Grid's own value is the List
    store.set(MATERIALS_VIEW_KEY, 'tiles');
    expect(getMaterialsView()).toBe('list');
  });
});
