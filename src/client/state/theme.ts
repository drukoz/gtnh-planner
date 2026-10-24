// The look of the page (Phase 2 spec §4.1, §4.7; D2): Auto, Dark or Light, one choice for this browser, kept in localStorage under
// `gtnh-planner:theme`. Auto is the default and puts no data-theme on <html>, so the stylesheet follows the OS by itself, with no JS;
// Dark and Light set data-theme, which outranks the OS. The head script of index.html applies a stored Dark or Light before the app
// runs, so a page never paints in the other look first, and startTheme takes over from there. The pipes-paused.ts pattern: a browser
// that refuses storage keeps the choice for this page's lifetime, and so does one that can read its storage but not write it.

import { useSyncExternalStore } from 'react';
import { prefersReducedMotion } from './motion.ts';

export type ThemeChoice = 'auto' | 'dark' | 'light';
export const THEME_KEY = 'gtnh-planner:theme';
/** The choices in the order the Theme button goes round them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'dark', 'light'];

/** The choice made on this page when storage refused to keep it; null while storage keeps it (or nothing was chosen). */
let pageValue: ThemeChoice | null = null;
const listeners = new Set<() => void>();

const isChoice = (value: unknown): value is ThemeChoice => THEME_CHOICES.some((choice) => choice === value);

/** What this page chose when storage refused it, else what storage holds, else Auto (a missing or unknown value is Auto). */
export function getThemeChoice(): ThemeChoice {
  if (pageValue !== null) return pageValue;
  try {
    const stored = globalThis.localStorage?.getItem(THEME_KEY);
    return isChoice(stored) ? stored : 'auto';
  } catch {
    return 'auto';   // storage is disabled or refused
  }
}

/**
 * Chooses a look for this browser, puts it on the page and tells every subscriber. The page cross-fades into it (§4.9) where the browser
 * has View Transitions and the user has not asked for reduced motion, and switches at once otherwise (and where there is no document).
 */
export function setThemeChoice(choice: ThemeChoice): void {
  let kept = false;
  try {
    const storage = globalThis.localStorage;
    if (storage !== undefined) {
      storage.setItem(THEME_KEY, choice);
      kept = true;
    }
  } catch {
    // refused: kept for this page only
  }
  pageValue = kept ? null : choice;
  const doc: Partial<Pick<Document, 'startViewTransition'>> | undefined = globalThis.document;
  if (doc?.startViewTransition !== undefined && !prefersReducedMotion()) doc.startViewTransition(() => applyTheme(choice));
  else applyTheme(choice);
  for (const fn of [...listeners]) fn();
}

/** The choice after `choice` in the button's round: Auto → Dark → Light → Auto. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length] ?? 'auto';
}

/** Puts a look on `root` (the page's <html>): Dark and Light as data-theme, Auto as none, so the OS decides. Nothing without a root. */
export function applyTheme(
  choice: ThemeChoice,
  root: Pick<Element, 'setAttribute' | 'removeAttribute'> | undefined = globalThis.document?.documentElement,
): void {
  if (root === undefined) return;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Calls `fn` when the choice changes, here or in another tab of this browser; returns how to stop. */
export function subscribeThemeChoice(fn: () => void): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === THEME_KEY) fn();
  };
  listeners.add(fn);
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

/** The choice, re-rendering when it changes; the server snapshot is the same, so pages rendered to a string work too. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeThemeChoice, getThemeChoice, getThemeChoice);
}

/**
 * Puts the stored choice on the page as the app starts (main.tsx), and again, at once and with no fade, whenever another tab changes it
 * (or clears the storage); returns how to stop. It listens to `storage` itself and never through subscribeThemeChoice: a subscriber is
 * told of a click here too, and applying the look then would put it on the page before the View Transition has taken its picture of the
 * old one, and the fade would be lost.
 */
export function startTheme(): () => void {
  applyTheme(getThemeChoice());
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === THEME_KEY) applyTheme(getThemeChoice());
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => globalThis.removeEventListener?.('storage', onStorage);
}
