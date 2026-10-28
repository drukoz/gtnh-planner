// Whether the project page's single-key shortcuts act (Phase 2 spec §14; ledger ruling P2-R85, WCAG 2.1.4 Character Key Shortcuts): `/`, the
// digits, F, P and `?` act from anywhere on the page outside a field, so a person can turn them off. On by default; the shortcuts' sheet holds
// the switch. Off, no key acts, `?` included, and nothing says a key: no `aria-keyshortcuts`, no tips on Fit and Pause pipes, no ending on the
// diagram hints. One value for this browser, kept in localStorage and shared by its tabs (the one store of the per-browser settings,
// browser-choice.ts: ledger ruling P2-R40).

import { createBrowserChoice } from './browser-choice.ts';

export const SINGLE_KEY_SHORTCUTS_KEY = 'gtnh-planner:shortcuts';

/** On is `'on'` in storage, off `'off'`; anything else, or nothing stored, is on. */
const singleKeyShortcuts = createBrowserChoice<boolean>({
  key: SINGLE_KEY_SHORTCUTS_KEY,
  read: (stored) => stored !== 'off',
  write: (on) => (on ? 'on' : 'off'),
});

/** On: what this page set when storage refused it, else what storage holds (anything but `'off'`), else on. */
export function getSingleKeyShortcuts(): boolean {
  return singleKeyShortcuts.get();
}

/** Turns the single-key shortcuts on or off in this browser, and tells every view. */
export function setSingleKeyShortcuts(on: boolean): void {
  singleKeyShortcuts.set(on);
}

/** Calls `fn` when the setting changes, here or in another tab of this browser; returns how to stop. */
export function subscribeSingleKeyShortcuts(fn: () => void): () => void {
  return singleKeyShortcuts.subscribe(fn);
}

/** Whether the single-key shortcuts are on, re-rendering when that changes; the server snapshot is the same, so pages rendered to a string work too. */
export function useSingleKeyShortcuts(): boolean {
  return singleKeyShortcuts.use();
}
