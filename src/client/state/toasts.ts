// Toasts (Phase 2 spec §12, D14): a short notice of what was just done ("Renamed to “Steel line”"), with Undo where it can be taken back. The
// App draws them in a region of its own in the window's corner (components/Toasts.tsx), after the page, so a toast lives on across the page's
// own navigation: "Created “X”" is shown on the list and read on the project it opens. One store for the page, kept outside React, like the
// other page-wide stores (pin-focus.ts, flow-focus.ts).
//
// - A toast stays TOAST_MS, then leaves: it is drawn leaving for TOAST_EXIT_MS (the stylesheet's `toast-out`), then removed. However it goes
//   (its time is up, Dismiss, a newer toast of its key, a fourth toast), it says so once, through its `onExpire`; one whose action was taken
//   leaves without saying so. A toast already leaving is left as it is, so an `onExpire` that dismisses its own toast changes nothing.
// - Its time runs only while nothing holds it (spec §12.1): a pointer that moves over it (P2-D28: one that rests where the toast appeared does
//   not), the focus inside it, or the page hidden. Let go, it runs on with the time it had left.
// - At most TOAST_LIMIT show at once: a newer one makes the oldest leave. A newer toast of a key replaces an older one of that key at once.
// - Toasts never take Escape and have no tooltip (spec §12.1). Their motion is the stylesheet's alone, so reduced motion reaches it there.
// The clock is a parameter, so the tests run the store on fake timers.

import { useSyncExternalStore } from 'react';

/** How long a toast stays (spec §12.1). */
export const TOAST_MS = 5000;
/** How many toasts show at once (spec §12.1): a newer one makes the oldest leave. */
export const TOAST_LIMIT = 3;
/** How long a toast that goes is drawn leaving, `--dur-exit` (the stylesheet's `toast-out`), before it is removed. */
export const TOAST_EXIT_MS = 180;

/** What a toast offers to do, as its button: Undo. */
export interface ToastAction { label: string; run(): void | Promise<unknown> }
/** A toast as the region draws it: its words, what it offers to do, its key, and whether it is leaving. */
export interface Toast { id: number; text: string; action?: ToastAction; key?: string; leaving: boolean }
export interface ToastOptions {
  action?: ToastAction;
  /** A newer toast of the same key replaces this one at once; `dismiss(key)` takes it away. */
  key?: string;
  /** How long it stays, if not TOAST_MS. */
  ms?: number;
  /** Called once when it goes without its action taken: its time is up, or it is dismissed or replaced. */
  onExpire?(): void;
}
/** What holds a toast's time: a pointer moving over it, the focus inside it, the page hidden. */
export type PauseReason = 'pointer' | 'focus' | 'hidden';

export interface ToastStore {
  /** Shows a toast; returns its id. */
  show(text: string, opts?: ToastOptions): number;
  /** Makes the toast of this id, or every toast of this key, leave, saying so (`onExpire`). */
  dismiss(idOrKey: number | string): void;
  /** Takes the toast's action: it runs once, and the toast leaves without saying it expired. */
  act(id: number): void;
  /** Holds the toast's time for a reason, until it is let go for that reason (`resume`). */
  pause(id: number, why: PauseReason): void;
  resume(id: number, why: PauseReason): void;
  /** Holds every toast's time while the page is hidden, the ones shown meanwhile too. */
  setHidden(hidden: boolean): void;
  subscribe(fn: () => void): () => void;
  /** The toasts, oldest first: the same array until one of them changes. */
  getSnapshot(): readonly Toast[];
}

/** The timers the store runs on: the window's, or a test's. */
export interface ToastClock { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; now(): number }

/** The window's timers, looked up at each call, so a test's fake timers reach the App's store too. */
const LIVE_CLOCK: ToastClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** A toast with what the store keeps of it. */
interface Entry {
  toast: Toast;
  /** Called when it goes without its action taken; cleared once called, or once it can no longer be (it left, its action was taken). */
  onExpire: (() => void) | undefined;
  /** What holds its time: it runs while this is empty. */
  holds: Set<PauseReason>;
  /** The time it has left: all of it while held, from `started` while its timer runs. */
  left: number;
  started: number;
  /** Its timer while its time runs, else null. */
  timer: unknown;
}

export function createToastStore(clock: ToastClock = LIVE_CLOCK): ToastStore {
  let entries: Entry[] = [];
  let snapshot: readonly Toast[] = [];
  let hidden = false;
  let nextId = 1;
  const listeners = new Set<() => void>();

  /** Something drawn changed: a new snapshot, and every listener told. */
  function changed(): void {
    snapshot = entries.map((e) => e.toast);
    for (const fn of [...listeners]) fn();
  }
  const byId = (id: number): Entry | undefined => entries.find((e) => e.toast.id === id);
  /** Tells what the given toasts' going should be told, once the store has drawn it. */
  const tell = (said: ReadonlyArray<(() => void) | undefined>): void => {
    for (const fn of said) fn?.();
  };

  function start(entry: Entry): void {
    entry.started = clock.now();
    entry.timer = clock.setTimeout(() => {
      entry.timer = null;
      const said = retire(entry);
      changed();
      tell([said]);
    }, entry.left);
  }
  function stop(entry: Entry): void {
    if (entry.timer === null) return;
    clock.clearTimeout(entry.timer);
    entry.timer = null;
    entry.left = Math.max(0, entry.left - (clock.now() - entry.started));
  }
  function hold(entry: Entry, why: PauseReason): void {
    if (entry.toast.leaving) return;
    if (entry.holds.size === 0) stop(entry);
    entry.holds.add(why);
  }
  function release(entry: Entry, why: PauseReason): void {
    if (entry.toast.leaving || !entry.holds.delete(why)) return;
    if (entry.holds.size === 0) start(entry);
  }
  /** Removes a toast from the store (a leaving one once its exit has run); a toast already gone is left. */
  function remove(entry: Entry): void {
    if (!entries.includes(entry)) return;
    entries = entries.filter((e) => e !== entry);
    changed();
  }
  /** Makes a toast leave: its time stops, it is drawn leaving, and removed after its exit. Returns what it is to tell (its onExpire, once). */
  function retire(entry: Entry): (() => void) | undefined {
    stop(entry);
    entry.toast = { ...entry.toast, leaving: true };
    const said = entry.onExpire;
    entry.onExpire = undefined;
    clock.setTimeout(() => remove(entry), TOAST_EXIT_MS);
    return said;
  }
  /** Takes a toast away at once, with no exit (a newer one of its key replaces it). Returns what it is to tell, if it had not yet. */
  function drop(entry: Entry): (() => void) | undefined {
    stop(entry);
    entries = entries.filter((e) => e !== entry);
    const said = entry.onExpire;
    entry.onExpire = undefined;
    return said;
  }

  return {
    show(text, opts = {}) {
      const { action, key, ms = TOAST_MS, onExpire } = opts;
      const said: Array<(() => void) | undefined> = key === undefined ? [] : entries.filter((e) => e.toast.key === key).map(drop);
      const toast: Toast = { id: nextId++, text, ...(action === undefined ? {} : { action }), ...(key === undefined ? {} : { key }), leaving: false };
      const entry: Entry = { toast, onExpire, holds: new Set<PauseReason>(hidden ? ['hidden'] : []), left: ms, started: 0, timer: null };
      entries = [...entries, entry];
      if (entry.holds.size === 0) start(entry);
      const showing = entries.filter((e) => !e.toast.leaving);
      for (const old of showing.slice(0, Math.max(0, showing.length - TOAST_LIMIT))) said.push(retire(old));
      changed();
      tell(said);
      return toast.id;
    },
    dismiss(idOrKey) {
      const going = entries.filter((e) => !e.toast.leaving && (typeof idOrKey === 'number' ? e.toast.id === idOrKey : e.toast.key === idOrKey));
      if (going.length === 0) return;
      const said = going.map(retire);
      changed();
      tell(said);
    },
    act(id) {
      const entry = byId(id);
      const action = entry?.toast.action;
      if (entry === undefined || entry.toast.leaving || action === undefined) return;
      // it leaves first, its onExpire dropped, so an action that dismisses its own toast cannot make it say it expired
      retire(entry);
      changed();
      void action.run();
    },
    pause(id, why) {
      const entry = byId(id);
      if (entry !== undefined) hold(entry, why);
    },
    resume(id, why) {
      const entry = byId(id);
      if (entry !== undefined) release(entry, why);
    },
    setHidden(next) {
      if (next === hidden) return;
      hidden = next;
      for (const entry of entries) {
        if (next) hold(entry, 'hidden');
        else release(entry, 'hidden');
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
  };
}

/** The App's toasts: the one store the region draws (components/Toasts.tsx). */
export const toasts: ToastStore = createToastStore();

/** Shows a toast in the App's region; returns its id. */
export function showToast(text: string, opts?: ToastOptions): number {
  return toasts.show(text, opts);
}

/** Makes the App's toast of this id, or of this key, leave. */
export function dismissToast(idOrKey: number | string): void {
  toasts.dismiss(idOrKey);
}

/** Takes the action of the App's toast `id` (its Undo). */
export function actOnToast(id: number): void {
  toasts.act(id);
}

export function pauseToast(id: number, why: PauseReason): void {
  toasts.pause(id, why);
}

export function resumeToast(id: number, why: PauseReason): void {
  toasts.resume(id, why);
}

/** The App's toasts, re-rendering when they change; the server snapshot is the same, so pages rendered to a string work too. */
export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(toasts.subscribe, toasts.getSnapshot, toasts.getSnapshot);
}
