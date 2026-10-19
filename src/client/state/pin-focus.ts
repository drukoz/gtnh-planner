// The layout pin the viewer asked to see (spec §3.7, §3.10): a build step's "pin <n>" link, a pin in the line panel or a
// pin marker on the map focuses it, and the Map tab centres the map on it and highlights its row. Only layout pins
// (`Layout.pins`) are focused this way, never note pins. Kept for the page, so a link on another tab reaches the map.

import { useSyncExternalStore } from 'react';

let focused: number | null = null;
const listeners = new Set<() => void>();

export function focusPin(n: number | null): void {
  if (n === focused) return;
  focused = n;
  for (const fn of [...listeners]) fn();
}

export function getFocusedPin(): number | null {
  return focused;
}

export function subscribePinFocus(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The focused pin; the server snapshot is the same, so pages rendered to a string work too (ruling R13 e). */
export function usePinFocus(): number | null {
  return useSyncExternalStore(subscribePinFocus, getFocusedPin, getFocusedPin);
}
