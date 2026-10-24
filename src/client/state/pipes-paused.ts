// Whether the pipes of the diagrams stand still (ruling R31; design spec §7 "Motion budget"): their contents move for as long as a
// diagram is shown, beside what the page says, and WCAG 2.2.2 asks for a way to stop such motion. The Flow and Connections toolbars'
// Pause pipes button sets it. One value for this browser, shared by both diagrams and kept in localStorage; a browser that refuses
// storage (a private window) keeps it for this page's lifetime, and so does one that can read its storage but not write it.

import { useSyncExternalStore } from 'react';

export const PIPES_PAUSED_KEY = 'gtnh-planner:pipes-paused';

/** The setting made on this page when storage refused to keep it; null while storage keeps it (or nothing was set). */
let pageValue: boolean | null = null;
const listeners = new Set<() => void>();

/** Paused: what this page set when storage refused it, else what storage holds (`'1'`), else not. */
export function getPipesPaused(): boolean {
  if (pageValue !== null) return pageValue;
  try {
    return globalThis.localStorage?.getItem(PIPES_PAUSED_KEY) === '1';
  } catch {
    return false;   // storage is disabled or refused
  }
}

/** Pauses or plays the pipes in this browser, and tells every view. */
export function setPipesPaused(paused: boolean): void {
  let kept = false;
  try {
    const storage = globalThis.localStorage;
    if (storage !== undefined) {
      storage.setItem(PIPES_PAUSED_KEY, paused ? '1' : '0');
      kept = true;
    }
  } catch {
    // refused: kept for this page only
  }
  pageValue = kept ? null : paused;
  for (const fn of [...listeners]) fn();
}

/** Calls `fn` when the setting changes, here or in another tab of this browser; returns how to stop. */
export function subscribePipesPaused(fn: () => void): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === PIPES_PAUSED_KEY) fn();
  };
  listeners.add(fn);
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

/** Whether the pipes are paused, re-rendering when that changes; the server snapshot is the same, so pages rendered to a string work too. */
export function usePipesPaused(): boolean {
  return useSyncExternalStore(subscribePipesPaused, getPipesPaused, getPipesPaused);
}
