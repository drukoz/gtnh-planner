// One choice of this browser's (ledger ruling P2-R40, src/client/state/browser-choice.ts): the one store of the Pause pipes setting, the look and
// how the build list is shown. Its storage cases are written once here and asserted for a choice made with the store and for each of the three,
// whose own tests keep how each writes and reads its value (pipes-paused.test.tsx '1' / '0', theme.test.tsx its three choices and junk as Auto,
// materials-view.test.tsx Grid / List): the default with nothing stored or no storage at all; a browser that refuses storage; one that can read
// its storage but not write it, whose stale value never wins over the page's own; word of a change here or in another tab (a storage event of
// the key, or of a cleared storage) and none once a subscriber has left, and word of a change storage did not keep (refused, or no storage at
// all); and the hook. The cases of the three modules' tests that said these for each module (pipes-paused.test.tsx's refused storage, its
// storage read but not written, and its subscribers; theme.test.tsx's refused or unwritable storage, and its subscribers and storage events,
// which it heard with no storage at all; materials-view.test.tsx's three) moved here.

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createBrowserChoice, type BrowserChoice } from '../../src/client/state/browser-choice.ts';
import { MATERIALS_VIEW_KEY, getMaterialsView, setMaterialsView, subscribeMaterialsView, useMaterialsView } from '../../src/client/state/materials-view.ts';
import { PIPES_PAUSED_KEY, getPipesPaused, setPipesPaused, subscribePipesPaused, usePipesPaused } from '../../src/client/state/pipes-paused.ts';
import { THEME_KEY, getThemeChoice, setThemeChoice, subscribeThemeChoice, useThemeChoice } from '../../src/client/state/theme.ts';
import { keepIn, refuse } from './storage-stub.ts';

/**
 * A choice as these cases drive it: its store, its key, its default and another value, the text storage keeps for each, and the text of a third
 * value when it has one (the look's Light).
 */
interface Choice {
  name: string; store: BrowserChoice<unknown>; key: string;
  fallback: unknown; fallbackText: string; other: unknown; otherText: string; thirdText?: string;
}

/** A choice made with the store for these cases alone: 'a', the default, or 'b'. */
const letter = createBrowserChoice<'a' | 'b'>({ key: 'test:letter', read: (stored) => (stored === 'b' ? 'b' : 'a'), write: (value) => value });

const CHOICES: Choice[] = [
  { name: 'a choice made with the store', store: letter, key: 'test:letter', fallback: 'a', fallbackText: 'a', other: 'b', otherText: 'b' },
  {
    name: 'the Pause pipes setting', store: { get: getPipesPaused, set: setPipesPaused, subscribe: subscribePipesPaused, use: usePipesPaused },
    key: PIPES_PAUSED_KEY, fallback: false, fallbackText: '0', other: true, otherText: '1',
  },
  {
    name: 'the look', store: { get: getThemeChoice, set: setThemeChoice, subscribe: subscribeThemeChoice, use: useThemeChoice },
    key: THEME_KEY, fallback: 'auto', fallbackText: 'auto', other: 'dark', otherText: 'dark', thirdText: 'light',
  },
  {
    name: 'how the build list is shown', store: { get: getMaterialsView, set: setMaterialsView, subscribe: subscribeMaterialsView, use: useMaterialsView },
    key: MATERIALS_VIEW_KEY, fallback: 'list', fallbackText: 'list', other: 'grid', otherText: 'grid',
  },
];

// A choice that storage keeps sets its store's page value back to null, which `vi.unstubAllGlobals()` alone would not: a case that left a page
// value behind would decide the next one's reads (theme.test.tsx's reset, for every choice).
afterEach(() => {
  vi.stubGlobal('localStorage', keepIn(new Map()));
  for (const choice of CHOICES) choice.store.set(choice.fallback);
  vi.unstubAllGlobals();
});

describe.each(CHOICES)('$name, kept for this browser', (choice) => {
  const { store } = choice;

  it('reads its default with nothing stored and with no storage at all, where a choice is kept for the page', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    expect(store.get()).toEqual(choice.fallback);
    vi.stubGlobal('localStorage', undefined);
    expect(store.get()).toEqual(choice.fallback);
    store.set(choice.other);
    expect(store.get()).toEqual(choice.other);
  });

  it('survives a browser that refuses storage, and keeps the choice for the page', () => {
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(store.get()).toEqual(choice.fallback);
    expect(() => store.set(choice.other)).not.toThrow();
    expect(store.get()).toEqual(choice.other);
    store.set(choice.fallback);
    expect(store.get()).toEqual(choice.fallback);
  });

  it('keeps the choice for the page in a browser that can read its storage but refuses to write it: the stale value never wins', () => {
    // a private window of some browsers: the value it can still read, whichever it is, must not win over the page's own
    const stale: Array<[string, unknown, unknown]> = [[choice.fallbackText, choice.other, choice.fallback], [choice.otherText, choice.fallback, choice.other]];
    if (choice.thirdText !== undefined) stale.push([choice.thirdText, choice.fallback, choice.other]);
    for (const [stored, first, second] of stale) {
      vi.stubGlobal('localStorage', { getItem: () => stored, setItem: refuse, removeItem: refuse });
      store.set(first);
      expect(store.get(), `with ${stored} stored`).toEqual(first);
      store.set(second);
      expect(store.get(), `with ${stored} stored`).toEqual(second);
    }
  });

  it('tells every subscriber of a change, here or in another tab (a storage event of its key, or of a cleared storage), and none once it has left', () => {
    vi.stubGlobal('localStorage', keepIn(new Map()));
    const added: Array<(e: { key: string | null }) => void> = [];
    const removed: unknown[] = [];
    vi.stubGlobal('addEventListener', (type: string, fn: (e: { key: string | null }) => void) => { if (type === 'storage') added.push(fn); });
    vi.stubGlobal('removeEventListener', (type: string, fn: unknown) => { if (type === 'storage') removed.push(fn); });
    const heard = vi.fn();
    const leave = store.subscribe(heard);
    store.set(choice.other);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
    // another tab of this browser changed this key, or cleared the storage; a change of another key is not this choice's
    added[0]!({ key: choice.key }); added[0]!({ key: null }); added[0]!({ key: 'gtnh-planner:another-setting' });
    expect(heard).toHaveBeenCalledTimes(3);
    leave();
    expect(removed).toEqual([added[0]]);
    store.set(choice.fallback);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('tells every subscriber of a value storage did not keep: storage refused, or no storage at all', () => {
    // theme.test.tsx's subscriber case ran with no storage at all: a choice the page keeps for itself is still a change every view hears
    for (const [storage, what] of [[{ getItem: refuse, setItem: refuse, removeItem: refuse }, 'storage refused'], [undefined, 'no storage']] as const) {
      vi.stubGlobal('localStorage', storage);
      const heard = vi.fn();
      const alsoHeard = vi.fn();
      const leave = [store.subscribe(heard), store.subscribe(alsoHeard)];
      store.set(choice.other);
      expect([heard.mock.calls.length, alsoHeard.mock.calls.length], what).toEqual([1, 1]);
      store.set(choice.fallback);
      expect([heard.mock.calls.length, alsoHeard.mock.calls.length], what).toEqual([2, 2]);
      for (const stop of leave) stop();
    }
  });

  it('renders the choice through its hook, the server snapshot the same as the store\'s', () => {
    vi.stubGlobal('localStorage', keepIn(new Map([[choice.key, choice.otherText]])));
    const Show = (): ReactElement => <output>{String(store.use())}</output>;
    expect(renderToStaticMarkup(<Show />)).toBe(`<output>${String(choice.other)}</output>`);
  });
});

describe('a choice made with the store', () => {
  it('keeps a value under its key as it writes it, and reads it back, a text it does not know as its default', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', keepIn(kept));
    letter.set('b');
    expect([kept.get('test:letter'), letter.get()]).toEqual(['b', 'b']);
    letter.set('a');
    expect([kept.get('test:letter'), letter.get()]).toEqual(['a', 'a']);
    kept.set('test:letter', 'b');                                                      // an earlier visit or another tab
    expect(letter.get()).toBe('b');
    kept.set('test:letter', 'z');
    expect(letter.get()).toBe('a');
  });

  it('puts a value to use once it is kept, before its subscribers are told (the look\'s cross-fade)', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', keepIn(kept));
    const order: string[] = [];
    const lamp = createBrowserChoice<'on' | 'off'>({
      key: 'test:lamp', read: (stored) => (stored === 'on' ? 'on' : 'off'), write: (value) => value,
      onSet: (value) => order.push(`put ${value} to use, ${kept.get('test:lamp') ?? 'nothing'} kept`),
    });
    lamp.subscribe(() => order.push(`told ${lamp.get()}`));
    lamp.set('on');
    expect(order).toEqual(['put on to use, on kept', 'told on']);
  });
});
