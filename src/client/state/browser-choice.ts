// One choice of this browser's, kept in localStorage under a key of its own: the one store of the per-browser settings (ledger ruling P2-R40),
// the Pause pipes setting (ruling R31), the look (Phase 2 spec §4.7) and how the build list is shown (§9.1). A browser that refuses storage
// keeps the choice for this page's lifetime, and so does one that can read its storage but not write it, whose stale value never wins over
// the page's own. A change here, or in another tab of this browser (a `storage` event of the key, or of a cleared storage), tells every
// subscriber. Each choice says how its value is written and read back (`write`, `read`); what `read` does not know, and nothing stored, is
// its default (`read(null)`).

import { useSyncExternalStore } from 'react';

/** A choice of this browser's, as its module exposes it: its value, a change to it, word of a change, and the hook that re-renders on one. */
export interface BrowserChoice<T> {
  /** What this page chose when storage refused it, else what storage holds, else the default. */
  get(): T;
  /** Keeps `value` for this browser, or for this page when storage refuses it, and tells every subscriber. */
  set(value: T): void;
  /** Calls `fn` when the choice changes, here or in another tab of this browser; returns how to stop. */
  subscribe(fn: () => void): () => void;
  /** The choice, re-rendering when it changes; the server snapshot is the same, so pages rendered to a string work too. */
  use(): T;
}

export interface BrowserChoiceOptions<T> {
  /** Where localStorage keeps it, its `storage` events included. */
  key: string;
  /** The value a stored text stands for: anything it does not know, and `null` (nothing stored, no storage), is the default. */
  read: (stored: string | null) => T;
  /** How the value is stored. */
  write: (value: T) => string;
  /** Called with a value once it is kept, before the subscribers are told (the look puts itself on the page there, Phase 2 spec §4.9). */
  onSet?: (value: T) => void;
}

/** A choice of this browser's, kept under `key` (see the module's header). */
export function createBrowserChoice<T>(options: BrowserChoiceOptions<T>): BrowserChoice<T> {
  const { key, read, write, onSet } = options;
  /** The value set on this page when storage refused to keep it; null while storage keeps it (or nothing was set). */
  let pageValue: { value: T } | null = null;
  const listeners = new Set<() => void>();

  const get = (): T => {
    if (pageValue !== null) return pageValue.value;
    try {
      return read(globalThis.localStorage?.getItem(key) ?? null);
    } catch {
      return read(null);   // storage is disabled or refused
    }
  };
  const set = (value: T): void => {
    let kept = false;
    try {
      const storage = globalThis.localStorage;
      if (storage !== undefined) {
        storage.setItem(key, write(value));
        kept = true;
      }
    } catch {
      // refused: kept for this page only
    }
    pageValue = kept ? null : { value };
    onSet?.(value);
    for (const fn of [...listeners]) fn();
  };
  const subscribe = (fn: () => void): (() => void) => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === null || e.key === key) fn();
    };
    listeners.add(fn);
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      listeners.delete(fn);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  };
  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get, get) };
}
