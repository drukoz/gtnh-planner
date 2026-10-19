// What the flow diagram lights up (fix spec §6.2 focus mode): one item (its producers, consumers and arrows), one box or
// one arrow, or nothing. The views that point into the diagram set it — the Materials "Show in flow" chips, the plan
// banner's chips and "Show in the flow", the step panel's rows — and the diagram reads it. One value per browser tab,
// kept outside React, so a view on another tab can set it before the flow view mounts.

import { useSyncExternalStore } from 'react';
import type { StuffKey } from '../../shared/keys.ts';

export type Focus = { kind: 'item'; key: StuffKey } | { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

let current: Focus = null;
/** What was lit when a hover began (`hoverFlowFocus`), put back when it ends; undefined while nothing is hovered. */
let beforeHover: Focus | undefined;
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

/** Lights `focus` and switches the project page to its Flow tab (the page follows the URL hash). */
export function showInFlow(focus: Focus): void {
  setFlowFocus(focus);
  if (typeof location !== 'undefined') location.hash = '#flow';
}
