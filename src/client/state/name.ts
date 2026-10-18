// The display name of whoever uses this browser (spec §3.11: no accounts, each person types their name once). It lives
// in localStorage under `gp.name`; a browser that refuses storage (private windows) keeps it for this page's lifetime.
// Names are trimmed and cut to 40 characters exactly as the server cuts the X-Planner-Name header.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'gp.name';
const MAX_NAME_CHARACTERS = 40;

/** The name saved on this page when storage refused it. */
let pageName: string | null = null;
const listeners = new Set<() => void>();

/** Trimmed and cut to 40 characters (code points, so an emoji is never split). */
function normalize(name: string): string {
  return Array.from(name.trim()).slice(0, MAX_NAME_CHARACTERS).join('').trim();
}

export function getName(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    const name = typeof stored === 'string' ? normalize(stored) : '';
    if (name !== '') return name;
  } catch {
    // storage is disabled or refused: fall back to the name given on this page
  }
  return pageName;
}

/** Saves the name for this browser; a name that is empty after trimming is ignored. */
export function setName(name: string): void {
  const normalized = normalize(name);
  if (normalized === '') return;
  pageName = normalized;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch {
    // kept for this page only
  }
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  addEventListener('storage', fn);   // another tab of this browser changed it
  return () => {
    listeners.delete(fn);
    removeEventListener('storage', fn);
  };
}

/** The current name, re-rendering when it is set here or in another tab. */
export function useName(): string | null {
  return useSyncExternalStore(subscribe, getName, getName);
}
