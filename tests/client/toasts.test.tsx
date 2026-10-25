// Toasts (Phase 2 spec §12, D14; Task 9a): the store under fake timers — a toast stays 5 s, then leaves over 180 ms, saying so once; its time
// stops while a pointer moves over it, while the focus is in it and while the page is hidden, and runs on with what it had left; three at
// most, the oldest leaving first; a newer toast of a key replaces the older at once; an action runs once, and its toast leaves without
// saying it expired — and the region's markup: polite, never an alert, with Undo and Dismiss. Fix round 1: a toast shown while the drawer is
// open waits behind it, undrawn and with its time still, and one drawn before stays drawn, paused (P2-R56, P2-R56a); a toast leaves before
// its action runs (P2-R58); the limit never takes a toast someone holds (M3); the region follows the page's visibility (M2). Task 9b: the time
// left of a toast drawn before the drawer opens, and a deleted project's toast, whose Undo restores it (a 409 counts as done, a 404 says so).

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '../../src/client/api/client.ts';
import { showDeletedToast } from '../../src/client/components/DeleteProject.tsx';
import { followVisibility, ToastList } from '../../src/client/components/Toasts.tsx';
import { leaveDeletedProject, takeDeletedNotice } from '../../src/client/state/deleted-notice.ts';
import { getProjectsChanged, restoredSince } from '../../src/client/state/projects-changed.ts';
import {
  createToastStore, dismissToast, showToast, TOAST_EXIT_MS, TOAST_LIMIT, TOAST_MS, toasts, type ToastStore,
} from '../../src/client/state/toasts.ts';
import { noticeAfterRestores } from '../../src/client/views/ProjectList.tsx';

describe('the toast store', () => {
  let store: ToastStore;
  beforeEach(() => {
    vi.useFakeTimers();
    store = createToastStore();
  });
  afterEach(() => { vi.useRealTimers(); });   // a failed fake-timer test must not stall the next one

  it('keeps a toast 5 s, then lets it leave for 180 ms, telling it once', () => {
    const onExpire = vi.fn(); const id = store.show('Note added', { onExpire });
    vi.advanceTimersByTime(4999); expect(store.getSnapshot()).toEqual([{ id, text: 'Note added', leaving: false }]);
    vi.advanceTimersByTime(1); expect(store.getSnapshot()[0]!.leaving).toBe(true); expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(180); expect(store.getSnapshot()).toEqual([]);
  });

  it('pauses while pointed at, focused or hidden, and resumes with the time it had left', () => {
    const id = store.show('x'); vi.advanceTimersByTime(3000); store.pause(id, 'pointer'); store.pause(id, 'focus'); vi.advanceTimersByTime(60_000);
    store.resume(id, 'pointer'); vi.advanceTimersByTime(10_000); expect(store.getSnapshot()[0]!.leaving).toBe(false);
    store.resume(id, 'focus'); vi.advanceTimersByTime(1999); expect(store.getSnapshot()[0]!.leaving).toBe(false); vi.advanceTimersByTime(1); expect(store.getSnapshot()[0]!.leaving).toBe(true);
    store.setHidden(true); const later = store.show('y'); vi.advanceTimersByTime(60_000); expect(store.getSnapshot().find((t) => t.id === later)!.leaving).toBe(false);
  });

  it('holds three at most, the oldest leaving first', () => {
    const first = vi.fn(); const [oldest] = [store.show('1', { onExpire: first }), store.show('2'), store.show('3'), store.show('4')];
    expect(store.getSnapshot().filter((t) => !t.leaving).map((t) => t.text)).toEqual(['2', '3', '4']);
    expect(store.getSnapshot().find((t) => t.id === oldest)!.leaving).toBe(true); expect(first).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TOAST_EXIT_MS); expect(store.getSnapshot().map((t) => t.text)).toEqual(['2', '3', '4']);
  });

  it('dismisses by key, and a newer toast of a key replaces the older at once', () => {
    store.show('Renamed to “A”', { key: 'rename:p' }); store.show('Renamed to “B”', { key: 'rename:p' }); expect(store.getSnapshot().map((t) => t.text)).toEqual(['Renamed to “B”']);
    store.dismiss('rename:p'); expect(store.getSnapshot()[0]!.leaving).toBe(true);
  });

  it('runs an action once and then lets its toast leave without expiring it', () => {
    const run = vi.fn(); const onExpire = vi.fn(); const id = store.show('Deleted “Steel”', { action: { label: 'Undo', run }, onExpire });
    store.act(id); store.act(id); expect(run).toHaveBeenCalledTimes(1); expect(store.getSnapshot()[0]!.leaving).toBe(true);
    vi.advanceTimersByTime(TOAST_MS); expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires a toast once, even when what it runs on expiry dismisses it again', () => {   // a deferred delete's flush dismisses its own toast (Task 9b)
    const onExpire = vi.fn(() => store.dismiss('note:n1')); store.show('Note deleted', { key: 'note:n1', onExpire });
    vi.advanceTimersByTime(TOAST_MS); expect(onExpire).toHaveBeenCalledTimes(1);
    store.dismiss('note:n1'); expect(onExpire).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(TOAST_EXIT_MS); expect(store.getSnapshot()).toEqual([]);
  });

  // ---- beyond the brief's cases: what the region and the call sites lean on ----

  it('answers the same snapshot until something drawn changes, and tells its listeners only then', () => {
    const heard = vi.fn(); const stop = store.subscribe(heard);
    const empty = store.getSnapshot(); expect(store.getSnapshot()).toBe(empty);
    const id = store.show('x'); expect(heard).toHaveBeenCalledTimes(1);
    const shown = store.getSnapshot(); expect(shown).not.toBe(empty);
    // a pause, a resume and a hidden page change nothing drawn
    store.pause(id, 'pointer'); store.resume(id, 'pointer'); store.setHidden(true); store.setHidden(false);
    expect(store.getSnapshot()).toBe(shown); expect(heard).toHaveBeenCalledTimes(1);
    store.dismiss(id); expect(heard).toHaveBeenCalledTimes(2); expect(store.getSnapshot()).not.toBe(shown);
    vi.advanceTimersByTime(TOAST_EXIT_MS); expect(heard).toHaveBeenCalledTimes(3);
    stop(); store.show('y'); expect(heard).toHaveBeenCalledTimes(3);
  });

  it('keeps a toast as long as it is asked to, and runs a hidden page\'s toasts on with the time they had left', () => {
    const short = store.show('short', { ms: 1000 }); vi.advanceTimersByTime(999); store.setHidden(true); vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot().find((t) => t.id === short)!.leaving).toBe(false);
    store.setHidden(false); vi.advanceTimersByTime(1); expect(store.getSnapshot().find((t) => t.id === short)!.leaving).toBe(true);
    // one shown while the page is hidden waits for the page to show, then has its whole time
    store.setHidden(true); const later = store.show('later'); vi.advanceTimersByTime(60_000); store.setHidden(false);
    vi.advanceTimersByTime(TOAST_MS - 1); expect(store.getSnapshot().find((t) => t.id === later)!.leaving).toBe(false);
    vi.advanceTimersByTime(1); expect(store.getSnapshot().find((t) => t.id === later)!.leaving).toBe(true);
  });

  it('lets a leaving toast go as it is: no second exit, no action, and no pause holds it', () => {
    const run = vi.fn(); const onExpire = vi.fn(); const id = store.show('x', { action: { label: 'Undo', run }, onExpire });
    store.dismiss(id); store.dismiss(id); store.act(id); store.pause(id, 'focus');
    expect(onExpire).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TOAST_EXIT_MS); expect(store.getSnapshot()).toEqual([]);
    // and one that is gone is no one's business: nothing throws, nothing changes
    store.dismiss(id); store.act(id); store.pause(id, 'pointer'); store.resume(id, 'pointer'); expect(store.getSnapshot()).toEqual([]);
  });

  it('replaces a keyed toast that is leaving at once too, and only tells an older one that has not gone yet', () => {
    const older = vi.fn(); store.show('A', { key: 'k', onExpire: older }); store.dismiss('k'); expect(older).toHaveBeenCalledTimes(1);
    const newer = vi.fn(); store.show('B', { key: 'k', onExpire: newer }); expect(store.getSnapshot().map((t) => [t.text, t.leaving])).toEqual([['B', false]]);
    store.show('C', { key: 'k' }); expect(newer).toHaveBeenCalledTimes(1); expect(older).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().map((t) => t.text)).toEqual(['C']);
  });

  it('counts only the toasts still showing toward the three', () => {
    const [a] = [store.show('a'), store.show('b'), store.show('c')]; store.dismiss(a); store.show('d');
    expect(store.getSnapshot().map((t) => [t.text, t.leaving])).toEqual([['a', true], ['b', false], ['c', false], ['d', false]]);
    expect(TOAST_LIMIT).toBe(3);
  });

  it('acts on the toast it is asked to and leaves a toast with nothing to do as it is', () => {
    const run = vi.fn(); const plain = store.show('plain'); const undo = store.show('undo', { action: { label: 'Undo', run } });
    store.act(plain); expect(store.getSnapshot().find((t) => t.id === plain)!.leaving).toBe(false);
    store.act(undo); expect(run).toHaveBeenCalledTimes(1); expect(store.getSnapshot().find((t) => t.id === plain)!.leaving).toBe(false);
  });

  // ---- fix round 1 (ledger rulings P2-R56, P2-R58; minors M2, M3) ----

  const find = (id: number) => store.getSnapshot().find((t) => t.id === id);

  it('keeps a toast shown while the region is inert out of sight with its time still, and shows it, with its whole time, once the region is live', () => {
    const before = store.show('Renamed to “B”'); store.setInert(true); const id = store.show('Upload finished');
    expect(store.getSnapshot().map((t) => t.text)).toEqual(['Renamed to “B”']);                  // not drawn, so not announced either
    vi.advanceTimersByTime(60_000); expect(find(before)!.leaving).toBe(false);                   // the drawer holds the one shown before it too
    store.setInert(false); expect(store.getSnapshot().map((t) => t.text)).toEqual(['Renamed to “B”', 'Upload finished']);
    vi.advanceTimersByTime(TOAST_MS - 1); expect(find(id)!.leaving).toBe(false); vi.advanceTimersByTime(1); expect(find(id)!.leaving).toBe(true);
  });

  it('drops a toast that waits behind the drawer when it is dismissed (P2-R54), telling it and never drawing it', () => {
    store.setInert(true); const onExpire = vi.fn(); store.show('Renamed to “B”', { key: 'rename:p', onExpire });
    const heard = vi.fn(); store.subscribe(heard);
    store.dismiss('rename:p'); expect(onExpire).toHaveBeenCalledTimes(1); expect(heard).not.toHaveBeenCalled();
    store.setInert(false); expect(store.getSnapshot()).toEqual([]); expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('counts the toasts that waited behind the drawer toward the three when they show', () => {
    const [a] = [store.show('a'), store.show('b')]; store.setInert(true); store.show('c'); store.show('d');
    expect(store.getSnapshot().map((t) => t.text)).toEqual(['a', 'b']);
    store.setInert(false);
    expect(store.getSnapshot().filter((t) => !t.leaving).map((t) => t.text)).toEqual(['b', 'c', 'd']); expect(find(a)!.leaving).toBe(true);
  });

  it('takes a toast away before running its action, so an action that dismisses its own toast does not say it expired (P2-R58)', () => {
    const onExpire = vi.fn(); const id = store.show('x', { key: 'k', onExpire, action: { label: 'Undo', run: () => store.dismiss('k') } }); store.act(id); expect(onExpire).not.toHaveBeenCalled();
  });

  it('never makes a toast someone holds leave for a newer one; with every toast held the newest waits until one is let go (M3)', () => {
    const [a, b, c] = [store.show('a'), store.show('b'), store.show('c')]; store.pause(a, 'pointer');
    const d = store.show('d');
    expect(find(a)!.leaving).toBe(false); expect(find(b)!.leaving).toBe(true);                   // the oldest that no one holds
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    store.pause(c, 'focus'); store.pause(d, 'pointer'); const e = store.show('e');
    expect(store.getSnapshot().map((t) => t.text)).toEqual(['a', 'c', 'd']);                    // all three held: e waits, unseen
    vi.advanceTimersByTime(60_000); expect(find(e)).toBeUndefined();
    store.resume(a, 'pointer');
    expect(store.getSnapshot().filter((t) => !t.leaving).map((t) => t.text)).toEqual(['c', 'd', 'e']); expect(find(a)!.leaving).toBe(true);
    vi.advanceTimersByTime(TOAST_MS - 1); expect(find(e)!.leaving).toBe(false); vi.advanceTimersByTime(1); expect(find(e)!.leaving).toBe(true);
  });

  it('follows the page\'s visibility through the region\'s listener, and lets go of the toasts when the region goes (M2)', () => {
    const doc = Object.assign(new EventTarget(), { hidden: true });
    const stop = followVisibility(doc, store);
    const id = store.show('x'); vi.advanceTimersByTime(60_000); expect(find(id)!.leaving).toBe(false);   // hidden from the start
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(TOAST_MS - 1); expect(find(id)!.leaving).toBe(false);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(60_000); expect(find(id)!.leaving).toBe(false);
    stop(); vi.advanceTimersByTime(1); expect(find(id)!.leaving).toBe(true);                     // no region, no page to wait for
    const later = store.show('y'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));   // heard by no one now
    vi.advanceTimersByTime(TOAST_MS); expect(find(later)!.leaving).toBe(true);
  });

  it('shows the App\'s toasts through showToast and takes them away through dismissToast', () => {
    const id = showToast('Command copied');
    expect(toasts.getSnapshot().find((t) => t.id === id)).toEqual({ id, text: 'Command copied', leaving: false });
    dismissToast(id); vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(toasts.getSnapshot().some((t) => t.id === id)).toBe(false);
  });

  // ---- Task 9b: the time a toast drawn before the drawer opens has left (the deferred minor of 9a), and Undo for a deleted project ----

  // ---- Task 9b fix round 1: a toast whose going commits a change runs on while the page is hidden (ledger ruling P2-R63) ----

  it('runs a toast whose going commits a change on while the page is hidden, and still holds an ordinary one (P2-R63)', () => {
    const ordinary = store.show('Note added');
    const commits = store.show('Note deleted', { runsHidden: true });
    store.setHidden(true);
    vi.advanceTimersByTime(TOAST_MS - 1); expect(find(commits)!.leaving).toBe(false);
    vi.advanceTimersByTime(1); expect(find(commits)!.leaving).toBe(true); expect(find(ordinary)!.leaving).toBe(false);
    const later = store.show('Note deleted', { runsHidden: true, key: 'note:n2' });                // shown while hidden: it runs from the start
    vi.advanceTimersByTime(TOAST_MS); expect(find(later)!.leaving).toBe(true); expect(find(ordinary)!.leaving).toBe(false);
    store.setHidden(false); vi.advanceTimersByTime(TOAST_MS); expect(find(ordinary)!.leaving).toBe(true);
  });

  it('runs it on while hidden whatever else holds it, for no one points at, focuses or opens a drawer on a hidden page (P2-R63)', () => {
    const id = store.show('Note deleted', { runsHidden: true });
    store.pause(id, 'pointer'); store.pause(id, 'focus'); store.setInert(true);
    vi.advanceTimersByTime(60_000); expect(find(id)!.leaving).toBe(false);                          // held while the page is seen
    store.setHidden(true); vi.advanceTimersByTime(2000); store.setHidden(false);
    vi.advanceTimersByTime(60_000); expect(find(id)!.leaving).toBe(false);                          // held again once it is seen
    store.setHidden(true); vi.advanceTimersByTime(TOAST_MS - 2000 - 1); expect(find(id)!.leaving).toBe(false);
    vi.advanceTimersByTime(1); expect(find(id)!.leaving).toBe(true);
  });

  it('keeps the time left of a toast drawn before the drawer opens, and runs it out once the drawer closes', () => {
    const id = store.show('Created “Steel”'); vi.advanceTimersByTime(300); store.setInert(true); vi.advanceTimersByTime(30_000);
    expect(find(id)!.leaving).toBe(false);
    store.setInert(false); vi.advanceTimersByTime(TOAST_MS - 300 - 1); expect(find(id)!.leaving).toBe(false);
    vi.advanceTimersByTime(1); expect(find(id)!.leaving).toBe(true);
  });

  it('restores a deleted project from its toast; a 409 counts as done, a 404 says it could not', async () => {
    const before = getProjectsChanged();
    showDeletedToast('p1', 'Steel', { restore: vi.fn(async () => ({})), toasts: store });
    expect(store.getSnapshot()[0]).toMatchObject({ text: 'Deleted “Steel”', key: 'project:p1' }); store.act(store.getSnapshot()[0]!.id);
    await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 1));
    showDeletedToast('p2', 'Iron', { restore: vi.fn(async () => { throw new ApiError(409, 'not-deleted', 'not deleted'); }), toasts: store });
    store.act(store.getSnapshot().find((t) => t.key === 'project:p2')!.id); await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 2));
    showDeletedToast('p3', 'Gold', { restore: vi.fn(async () => { throw new ApiError(404, 'not-found', 'gone'); }), toasts: store });
    store.act(store.getSnapshot().find((t) => t.key === 'project:p3')!.id);
    await vi.waitFor(() => expect(store.getSnapshot().map((t) => t.text)).toContain('Could not restore “Gold”')); expect(getProjectsChanged()).toBe(before + 2);
  });

  it('restores the project its toast names, takes the notice the list was to show, and answers the toast\'s id', async () => {
    const restore = vi.fn(async (_id: string) => ({}));
    vi.stubGlobal('location', { pathname: '/p/p 1', search: '', hash: '', href: 'http://planner.test/p/p%201' });
    vi.stubGlobal('history', { pushState: () => {} });
    try {
      leaveDeletedProject('Steel', 'Ann', 'p 1');                              // the page left for the list, which has not taken it yet
      const id = showDeletedToast('p 1', 'Steel', { restore, toasts: store });
      expect(store.getSnapshot().map((t) => [t.id, t.text, t.action?.label])).toEqual([[id, 'Deleted “Steel”', 'Undo']]);
      const before = getProjectsChanged();
      store.act(id);
      await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 1));
      expect(restore).toHaveBeenCalledWith('p 1');
      expect(restoredSince(before)).toEqual(['p 1']);
      expect(takeDeletedNotice()).toBeNull();                                  // "Steel was deleted by Ann" no longer holds
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops only the notice about the project its Undo restored, on the list and on its way there (M5)', async () => {
    vi.stubGlobal('location', { pathname: '/p/p2', search: '', hash: '', href: 'http://planner.test/p/p2' });
    vi.stubGlobal('history', { pushState: () => {} });
    try {
      leaveDeletedProject('Iron', 'Bob', 'p2');                                // another project's notice, on its way to the list
      const before = getProjectsChanged();
      store.act(showDeletedToast('p1', 'Steel', { restore: async () => ({}), toasts: store }));
      await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 1));
      expect(takeDeletedNotice()).toBe('Iron was deleted by Bob');             // still to be shown
      const steel = { text: 'Steel was deleted by Ann', about: 'p1' };
      const iron = { text: 'Iron was deleted by Bob', about: 'p2' };
      const unknown = { text: 'That project no longer exists', about: null };
      expect(noticeAfterRestores(steel, restoredSince(before))).toBeNull();
      expect(noticeAfterRestores(iron, restoredSince(before))).toBe(iron);
      expect(noticeAfterRestores(unknown, restoredSince(before))).toBe(unknown);
      expect(noticeAfterRestores(null, restoredSince(before))).toBeNull();
      expect(restoredSince(getProjectsChanged())).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the toast region', () => {
  it('draws a polite region that is never an alert, with Undo and Dismiss', () => {
    const html = renderToStaticMarkup(<ToastList toasts={[{ id: 1, text: 'Deleted “Steel line”', action: { label: 'Undo', run() {} }, leaving: false }]} />);
    expect(html).toBe('<section class="toasts" aria-label="Notifications"><ol aria-live="polite" aria-relevant="additions"><li class="toast" data-state="open"><span>Deleted “Steel line”</span><button type="button" class="small primary">Undo</button><button type="button" class="small" aria-label="Dismiss">×</button></li></ol></section>');
    expect(renderToStaticMarkup(<ToastList toasts={[]} />)).toContain('<ol aria-live="polite" aria-relevant="additions"></ol>');
  });

  it('draws a toast with nothing to undo with Dismiss alone, and one that is leaving as leaving, the newest last', () => {
    const html = renderToStaticMarkup(<ToastList toasts={[{ id: 1, text: 'Note added', leaving: true }, { id: 2, text: 'Command copied', leaving: false }]} />);
    expect(html).toBe('<section class="toasts" aria-label="Notifications"><ol aria-live="polite" aria-relevant="additions">'
      + '<li class="toast" data-state="leaving"><span>Note added</span><button type="button" class="small" aria-label="Dismiss">×</button></li>'
      + '<li class="toast" data-state="open"><span>Command copied</span><button type="button" class="small" aria-label="Dismiss">×</button></li></ol></section>');
    expect(html).not.toMatch(/role="(alert|status|tooltip)"|data-tip/);
  });
});
