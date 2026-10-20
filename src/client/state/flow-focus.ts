// What the flow diagram lights up (fix spec §6.2 focus mode): one item (its producers, consumers and arrows), one box or
// one arrow, or nothing. The views that point into the diagram set it — the Materials "Show in flow" chips, the plan
// banner's chips and "Show in the flow", the step panel's rows, the diagram's own hovers, clicks, Find and Show — and
// the diagram reads it; a reveal (`revealFlowFocus`) also asks the diagram to bring it into view. One value per browser
// tab, kept outside React, so a view on another tab can set it before the flow view mounts; the project page clears it
// when it closes.

import { useSyncExternalStore } from 'react';
import type { Focus } from '../views/flow-model.ts';

// The shape lives with the pure flow model (`focusSets` reads it), so the model needs nothing of this browser store.
export type { Focus };

let current: Focus = null;
/** What was lit when a hover began (`hoverFlowFocus`), put back when it ends; undefined while nothing is hovered. */
let beforeHover: Focus | undefined;
/** How many times a view asked the diagram to bring the focus into view (`revealFlowFocus`). */
let reveals = 0;
const listeners = new Set<() => void>();

function same(a: Focus, b: Focus): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'item') return b.kind === 'item' && a.key === b.key;
  return b.kind === a.kind && 'id' in b && b.id === a.id;
}

export function getFlowFocus(): Focus {
  return current;
}

export function subscribeFlowFocus(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Lights `focus` (null: nothing) and tells every listener, unless it is lit already. */
export function setFlowFocus(focus: Focus): void {
  beforeHover = undefined;
  if (same(current, focus)) return;
  current = focus;
  for (const fn of [...listeners]) fn();
}

/** Lights `focus` while something is hovered; `endHoverFlowFocus` puts back what was lit before. */
export function hoverFlowFocus(focus: Focus): void {
  const before = beforeHover === undefined ? current : beforeHover;
  setFlowFocus(focus);
  beforeHover = before;
}

/** The hover of `hoverFlowFocus` ended: light again what was lit before it. */
export function endHoverFlowFocus(): void {
  if (beforeHover === undefined) return;
  setFlowFocus(beforeHover);
}

/** The diagram's focus for a component: re-renders when it changes. */
export function useFlowFocus(): Focus {
  return useSyncExternalStore(subscribeFlowFocus, getFlowFocus, getFlowFocus);
}

/**
 * Lights `focus` and asks the flow diagram to bring it into view (fix spec §6.2: Find item, the Show buttons, "Show in
 * the flow"), even when it is lit already; a hover lights without moving the view.
 */
export function revealFlowFocus(focus: Focus): void {
  setFlowFocus(focus);
  reveals += 1;
  for (const fn of [...listeners]) fn();
}

/** How many times the focus was to be brought into view; the diagram centres it whenever this changes. */
export function getFlowReveal(): number {
  return reveals;
}

/** `getFlowReveal` for a component: re-renders when it changes. */
export function useFlowReveal(): number {
  return useSyncExternalStore(subscribeFlowFocus, getFlowReveal, getFlowReveal);
}

/** Lights `focus`, switches the project page to its Flow tab (the page follows the URL hash) and brings it into view there. */
export function showInFlow(focus: Focus): void {
  revealFlowFocus(focus);
  if (typeof location !== 'undefined') location.hash = '#flow';
}
