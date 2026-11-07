// A request to open the recipe browser (RUK-740): the page's R and U keys (state/shortcuts.ts) put one here, and the Flow view reads it
// (RUK-T9), so a request can arrive before the view mounts, and the same key twice asks twice. One value per browser tab, kept outside React
// like the flow focus, and the project page forgets it when it closes, as it clears the flow focus.

import { useSyncExternalStore } from 'react';

/** A request for the recipe browser (RUK-740): which list, and a number that grows with every request, so the same key twice asks twice. */
export interface RecipeRequest { mode: 'recipes' | 'uses'; seq: number }

let current: RecipeRequest | null = null;
/** How many requests have been made; every one takes the next number, so two of the same mode never share a `seq`. */
let seq = 0;
const listeners = new Set<() => void>();

/** The last request, or null until the first (and again after `clearRecipeRequest`). */
export function getRecipeRequest(): RecipeRequest | null {
  return current;
}

export function subscribeRecipeRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Asks for `mode`'s recipes: sets `{ mode, seq }` with the next `seq` and tells every listener. */
export function requestRecipes(mode: 'recipes' | 'uses'): void {
  seq += 1;
  current = { mode, seq };
  for (const fn of [...listeners]) fn();
}

/** `getRecipeRequest` for a component: re-renders when a request arrives. */
export function useRecipeRequest(): RecipeRequest | null {
  return useSyncExternalStore(subscribeRecipeRequest, getRecipeRequest, getRecipeRequest);
}

/** Forgets the last request (the project page calls it when it closes, as it clears the flow focus). */
export function clearRecipeRequest(): void {
  if (current === null) return;
  current = null;
  for (const fn of [...listeners]) fn();
}
