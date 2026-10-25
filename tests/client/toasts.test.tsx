// Toasts (Phase 2 spec §12, D14; Task 9a): the store under fake timers — a toast stays 5 s, then leaves over 180 ms, saying so once; its time
// stops while a pointer moves over it, while the focus is in it and while the page is hidden, and runs on with what it had left; three at
// most, the oldest leaving first; a newer toast of a key replaces the older at once; an action runs once, and its toast leaves without
// saying it expired — and the region's markup: polite, never an alert, with Undo and Dismiss.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastList } from '../../src/client/components/Toasts.tsx';
import {
  createToastStore, dismissToast, showToast, TOAST_EXIT_MS, TOAST_LIMIT, TOAST_MS, toasts, type ToastStore,
} from '../../src/client/state/toasts.ts';

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

  it('shows the App\'s toasts through showToast and takes them away through dismissToast', () => {
    const id = showToast('Command copied');
    expect(toasts.getSnapshot().find((t) => t.id === id)).toEqual({ id, text: 'Command copied', leaving: false });
    dismissToast(id); vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(toasts.getSnapshot().some((t) => t.id === id)).toBe(false);
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
