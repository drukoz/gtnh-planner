// How this browser shows "To build (once)" (Phase 2 spec §9.1, D9): as the List, the default, or as the opt-in inventory Grid, one choice for
// this browser kept in localStorage under `gtnh-planner:materials-view`, and anything but `'grid'` there reads as the List. It is a display
// choice, not a project setting, so it sends no op; and it outlives the tab panel, which remounts on every tab switch. These are
// pipes-paused.test.tsx's five store cases (the pipes-paused.ts pattern); materials-grid.spec.ts presses the toggle in a browser.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { MATERIALS_VIEW_KEY, getMaterialsView, setMaterialsView, subscribeMaterialsView } from '../../src/client/state/materials-view.ts';

/** A localStorage that keeps what it is given in `store`. */
function keepIn(store: Map<string, string>): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

const refuse = (): never => { throw new Error('storage is disabled'); };

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

  it('survives a browser that refuses storage, and keeps the choice for the page', () => {
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(getMaterialsView()).toBe('list');
    expect(() => setMaterialsView('grid')).not.toThrow();
    expect(getMaterialsView()).toBe('grid');
    setMaterialsView('list');
    expect(getMaterialsView()).toBe('list');
  });

  it('keeps the choice for the page in a browser that can read its storage but refuses to write it', () => {
    // a private window of some browsers: the stale value it can still read must not win over the page's own
    vi.stubGlobal('localStorage', { getItem: () => 'grid', setItem: refuse, removeItem: refuse });
    setMaterialsView('list');
    expect(getMaterialsView()).toBe('list');
    setMaterialsView('grid');
    expect(getMaterialsView()).toBe('grid');
  });

  it('tells every view that subscribed when it changes, here or in another tab, and no longer once it has left', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    const storage: Array<(e: { key: string | null }) => void> = [];
    vi.stubGlobal('addEventListener', (type: string, fn: never) => { if (type === 'storage') storage.push(fn); });
    vi.stubGlobal('removeEventListener', () => {});
    const heard = vi.fn();
    const leave = subscribeMaterialsView(heard);
    setMaterialsView('grid');
    expect(heard).toHaveBeenCalledTimes(1);
    // another tab of this browser: a change of this key, or a cleared storage; another key is not this choice
    storage[0]!({ key: MATERIALS_VIEW_KEY }); storage[0]!({ key: null }); storage[0]!({ key: 'gtnh-planner:theme' });
    expect(heard).toHaveBeenCalledTimes(3);
    leave();
    setMaterialsView('list');
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
