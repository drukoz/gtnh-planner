// Toasts (Phase 2 spec §12, D14): a short notice of what was just done ("Renamed to “Steel line”"), with Undo where it can be taken back. The
// App draws them in a region of its own in the window's corner (components/Toasts.tsx), after the page, so a toast lives on across the page's
// own navigation: "Created “X”" is shown on the list and read on the project it opens. One store for the page, kept outside React, like the
// other page-wide stores (pin-focus.ts, flow-focus.ts).
//
// - A toast stays TOAST_MS, then leaves: it is drawn leaving for TOAST_EXIT_MS (the stylesheet's `toast-out`), then removed. However it goes
//   (its time is up, Dismiss, a newer toast of its key, a newer toast past the limit), it says so once, through its `onExpire`; one whose action
//   was taken leaves without saying so, for it leaves before its action runs (ledger ruling P2-R58). A toast already leaving is left as it is,
//   so an `onExpire` that dismisses its own toast changes nothing.
// - Its time runs only while nothing holds it (spec §12.1): a pointer that moves over it (P2-D28: one that rests where the toast appeared does
//   not), the focus inside it, the page hidden, or the settings drawer open over the region (`inert`). Let go, it runs on with the time it had
//   left.
// - A toast is drawn, so heard, only where it can be seen and reached (ledger ruling P2-R56): one shown while the drawer is open waits behind
//   it, not drawn and its time still, and is drawn once the drawer closes, with its whole time. One drawn before the drawer opens stays drawn,
//   paused behind it, and is there with the time it had left once it closes: it is added to the polite list once, so heard once (P2-R56a).
// - At most TOAST_LIMIT are drawn at once, counted as each is drawn: a newer one makes the oldest leave that no one holds by its pointer or
//   focus (M3); with every one held, the newer waits, undrawn, until one is let go. A newer toast of a key replaces an older one of it at once.
// - Toasts never take Escape and have no tooltip (spec §12.1). Their motion is the stylesheet's alone, so reduced motion reaches it there.
// The clock is a parameter, so the tests run the store on fake timers.

import { useSyncExternalStore } from 'react';

/** How long a toast stays (spec §12.1). */
export const TOAST_MS = 5000;
/** How many toasts are drawn at once (spec §12.1): a newer one makes the oldest leave that no one holds. */
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
/** What holds a toast's time: a pointer moving over it, the focus inside it, the page hidden, the drawer open over the region. */
export type PauseReason = 'pointer' | 'focus' | 'hidden' | 'inert';

export interface ToastStore {
  /** Shows a toast, or keeps it waiting until it can be seen; returns its id. */
  show(text: string, opts?: ToastOptions): number;
  /** Makes the toast of this id, or every toast of this key, leave, saying so (`onExpire`); one still waiting goes at once. */
  dismiss(idOrKey: number | string): void;
  /** Takes the toast's action: the toast leaves, without saying it expired, and then its action runs, once (P2-R58). */
  act(id: number): void;
  /** Holds the toast's time for a reason, until it is let go for that reason (`resume`). */
  pause(id: number, why: PauseReason): void;
  resume(id: number, why: PauseReason): void;
  /** Holds every toast's time while the page is hidden, the ones shown meanwhile too. */
  setHidden(hidden: boolean): void;
  /**
   * Holds every toast's time while the drawer is open over the region, the ones drawn staying drawn, and keeps the ones shown meanwhile
   * waiting, undrawn, until it closes (P2-R56, P2-R56a).
   */
  setInert(inert: boolean): void;
  /** Whether the drawer is open over the region, so a toast shown now would wait. */
  isInert(): boolean;
  subscribe(fn: () => void): () => void;
  /** The toasts drawn, oldest first: the same array until one of them changes. */
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
  /** What holds its time. */
  holds: Set<PauseReason>;
  /** Not drawn yet: shown while the drawer was open, or past the limit with every toast drawn held. */
  waiting: boolean;
  /** The time it has left: all of it while it is held or waits, from `started` while its timer runs. */
  left: number;
  started: number;
  /** Its timer while its time runs, else null. */
  timer: unknown;
}

/** A hold that someone makes, by moving the pointer over a toast or putting the focus in it: the limit never takes such a toast (M3). */
const heldByUser = (entry: Entry): boolean => entry.holds.has('pointer') || entry.holds.has('focus');

export function createToastStore(clock: ToastClock = LIVE_CLOCK): ToastStore {
  let entries: Entry[] = [];
  let snapshot: readonly Toast[] = [];
  let hidden = false;
  let inert = false;
  let nextId = 1;
  const listeners = new Set<() => void>();

  /** Something drawn may have changed: a new snapshot, and every listener told, if it did. */
  function changed(): void {
    const drawn = entries.filter((e) => !e.waiting).map((e) => e.toast);
    if (drawn.length === snapshot.length && drawn.every((toast, i) => toast === snapshot[i])) return;
    snapshot = drawn;
    for (const fn of [...listeners]) fn();
  }
  const byId = (id: number): Entry | undefined => entries.find((e) => e.toast.id === id);
  /** Tells what the given toasts' going should be told, once the store has drawn it. */
  const tell = (said: ReadonlyArray<(() => void) | undefined>): void => {
    for (const fn of said) fn?.();
  };

  /** Whether its time runs: drawn, not leaving, and held by nothing. */
  const runs = (entry: Entry): boolean => !entry.waiting && !entry.toast.leaving && entry.holds.size === 0;
  /** Stops its timer, keeping the time it has left. */
  function stop(entry: Entry): void {
    if (entry.timer === null) return;
    clock.clearTimeout(entry.timer);
    entry.timer = null;
    entry.left = Math.max(0, entry.left - (clock.now() - entry.started));
  }
  /** Starts or stops its timer as `runs` says. */
  function sync(entry: Entry): void {
    if (!runs(entry)) {
      stop(entry);
      return;
    }
    if (entry.timer !== null) return;
    entry.started = clock.now();
    entry.timer = clock.setTimeout(() => {
      entry.timer = null;
      const said = [retire(entry)];
      settle(said);
      changed();
      tell(said);
    }, entry.left);
  }
  /** Removes a toast from the store (a leaving one once its exit has run); a toast already gone is left. */
  function remove(entry: Entry): void {
    if (!entries.includes(entry)) return;
    entries = entries.filter((e) => e !== entry);
    changed();
  }
  /** Makes a drawn toast leave: its time stops, it is drawn leaving, and removed after its exit. Returns what it is to tell (its onExpire). */
  function retire(entry: Entry): (() => void) | undefined {
    entry.toast = { ...entry.toast, leaving: true };
    sync(entry);
    const said = entry.onExpire;
    entry.onExpire = undefined;
    clock.setTimeout(() => remove(entry), TOAST_EXIT_MS);
    return said;
  }
  /** Takes a toast away at once, with no exit (a newer one of its key replaces it, or it never was drawn). Returns what it is to tell. */
  function drop(entry: Entry): (() => void) | undefined {
    stop(entry);
    entries = entries.filter((e) => e !== entry);
    const said = entry.onExpire;
    entry.onExpire = undefined;
    return said;
  }
  /**
   * Draws the waiting toasts, oldest first, while the drawer is not over the region: each takes a place of the TOAST_LIMIT, making the
   * oldest drawn toast that no one holds leave when they are all taken; when no one is free to go, it and the ones after it wait on.
   */
  function settle(said: Array<(() => void) | undefined>): void {
    if (inert) return;
    for (const entry of entries.filter((e) => e.waiting)) {
      const showing = entries.filter((e) => !e.waiting && !e.toast.leaving);
      if (showing.length >= TOAST_LIMIT) {
        const free = showing.find((e) => !heldByUser(e));
        if (free === undefined) return;
        said.push(retire(free));
      }
      entry.waiting = false;
      sync(entry);
    }
  }

  return {
    show(text, opts = {}) {
      const { action, key, ms = TOAST_MS, onExpire } = opts;
      const said: Array<(() => void) | undefined> = key === undefined ? [] : entries.filter((e) => e.toast.key === key).map(drop);
      const toast: Toast = { id: nextId++, text, ...(action === undefined ? {} : { action }), ...(key === undefined ? {} : { key }), leaving: false };
      const holds = new Set<PauseReason>([...(hidden ? ['hidden' as const] : []), ...(inert ? ['inert' as const] : [])]);
      entries = [...entries, { toast, onExpire, holds, waiting: true, left: ms, started: 0, timer: null }];
      settle(said);
      changed();
      tell(said);
      return toast.id;
    },
    dismiss(idOrKey) {
      const going = entries.filter((e) => !e.toast.leaving && (typeof idOrKey === 'number' ? e.toast.id === idOrKey : e.toast.key === idOrKey));
      if (going.length === 0) return;
      const said = going.map((e) => (e.waiting ? drop(e) : retire(e)));
      settle(said);
      changed();
      tell(said);
    },
    act(id) {
      const entry = byId(id);
      const action = entry?.toast.action;
      if (entry === undefined || entry.waiting || entry.toast.leaving || action === undefined) return;
      // it leaves first, its onExpire dropped, so an action that dismisses its own toast cannot make it say it expired (P2-R58)
      retire(entry);
      const said: Array<(() => void) | undefined> = [];
      settle(said);
      changed();
      tell(said);
      void action.run();
    },
    pause(id, why) {
      const entry = byId(id);
      if (entry === undefined || entry.toast.leaving) return;
      entry.holds.add(why);
      sync(entry);
    },
    resume(id, why) {
      const entry = byId(id);
      if (entry === undefined || entry.toast.leaving || !entry.holds.delete(why)) return;
      sync(entry);
      // a toast let go may now make way for one that waits for a place (M3)
      const said: Array<(() => void) | undefined> = [];
      settle(said);
      changed();
      tell(said);
    },
    setHidden(next) {
      if (next === hidden) return;
      hidden = next;
      for (const entry of entries) {
        if (next) entry.holds.add('hidden');
        else entry.holds.delete('hidden');
        sync(entry);
      }
    },
    setInert(next) {
      if (next === inert) return;
      inert = next;
      for (const entry of entries) {
        if (next) entry.holds.add('inert');
        else entry.holds.delete('inert');
        sync(entry);
      }
      const said: Array<(() => void) | undefined> = [];
      settle(said);
      changed();
      tell(said);
    },
    isInert: () => inert,
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

/** The settings drawer is open over the App's region, or has closed (ProjectPage): see `ToastStore.setInert`. */
export function setToastsInert(inert: boolean): void {
  toasts.setInert(inert);
}

/** Whether the drawer is open over the App's region, so a toast shown now would wait behind it (ProjectorPanel's copy makes none then). */
export function toastsInert(): boolean {
  return toasts.isInert();
}

/** The App's toasts, re-rendering when they change; the server snapshot is the same, so pages rendered to a string work too. */
export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(toasts.subscribe, toasts.getSnapshot, toasts.getSnapshot);
}
