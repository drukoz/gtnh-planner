// Whether the pipes of the diagrams stand still (ruling R31; design spec §7 "Motion budget"): their contents move for as long as a
// diagram is shown, beside what the page says, and WCAG 2.2.2 asks for a way to stop such motion. The Flow and Connections toolbars'
// Pause pipes button sets it. One value for this browser, shared by both diagrams and kept in localStorage; a browser that refuses
// storage (a private window) keeps it for this page's lifetime, and so does one that can read its storage but not write it (the one store
// of the per-browser settings, browser-choice.ts: ledger ruling P2-R40).

import { createBrowserChoice } from './browser-choice.ts';

export const PIPES_PAUSED_KEY = 'gtnh-planner:pipes-paused';

/** Paused is `'1'` in storage, playing `'0'`; anything else, or nothing stored, is not paused. */
const pipesPaused = createBrowserChoice<boolean>({
  key: PIPES_PAUSED_KEY,
  read: (stored) => stored === '1',
  write: (paused) => (paused ? '1' : '0'),
});

/** Paused: what this page set when storage refused it, else what storage holds (`'1'`), else not. */
export function getPipesPaused(): boolean {
  return pipesPaused.get();
}

/** Pauses or plays the pipes in this browser, and tells every view. */
export function setPipesPaused(paused: boolean): void {
  pipesPaused.set(paused);
}

/** Calls `fn` when the setting changes, here or in another tab of this browser; returns how to stop. */
export function subscribePipesPaused(fn: () => void): () => void {
  return pipesPaused.subscribe(fn);
}

/** Whether the pipes are paused, re-rendering when that changes; the server snapshot is the same, so pages rendered to a string work too. */
export function usePipesPaused(): boolean {
  return pipesPaused.use();
}
