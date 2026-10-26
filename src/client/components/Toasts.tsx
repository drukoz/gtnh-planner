// The App's toasts (Phase 2 spec §12.3): a labelled region in the window's bottom-right corner, drawn after the page, whose list is always
// there, empty or not, and polite: a screen reader hears each toast as it comes, once, and never one that goes (`aria-relevant="additions"`);
// never an alert or a status. Each toast is its words, its action's button (Undo) when it has one, and Dismiss. Its time stops while the
// pointer moves over it and while the focus is inside it (state/toasts.ts), and the region tells the store when the page is hidden. While the
// settings drawer is open the project page makes the region inert with the top bar, so the drawer stays a layer of its own (ruling R36), and
// the store keeps any toast shown meanwhile waiting until it closes (ledger ruling P2-R56).
//
// Undo and Dismiss pressed from the keyboard move the focus on before their toast goes from under it (ledger ruling P2-R57), so the keyboard
// never falls to the page's body: back to where the focus came into the region from, else to the same button of the next toast still
// showing, else to the page's main. A pointer's press moves nothing: Chromium focuses the button it presses, and moving that focus on would
// put it in the toast beside, which would then hold it and stop its time (fix round 2, M6). A held Enter dismisses one toast, not the next
// one Dismiss hands the focus to (ledger ruling P2-R69).

import { useEffect, type FocusEvent, type ReactElement } from 'react';
import { actOnToast, dismissToast, pauseToast, resumeToast, toasts, useToasts, type Toast, type ToastStore } from '../state/toasts.ts';
import { focusMain, focusOn, ignoreHeldEnter } from './focus.ts';

/** Where the focus came into the region from: the element a focus from outside it left, or null when it came from nowhere (P2-R57). */
let cameFrom: Element | null = null;

/** The region's focusin: a focus that comes in from outside it remembers where from; one that moves inside it changes nothing. */
function noteArrival(e: FocusEvent<HTMLElement>): void {
  const from = e.relatedTarget;
  if (from instanceof Node && e.currentTarget.contains(from)) return;
  cameFrom = from instanceof Element ? from : null;
}

/** The types of input that take typing: the fields an Undo must not put the focus in (`moveFocusOff`). */
const TYPED = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password']);
const takesTyping = (el: Element): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TYPED.has(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

/**
 * Before the toast of `button` goes from under the focus (its Undo, `acting`, or its Dismiss), the focus moves on (P2-R57): back to where it came
 * into the region from, while that is in the page and not inert, and, for an Undo, not a field that takes typing (a field being edited keeps its
 * draft, so the project's name would keep the name the Undo takes back and send it again on its blur); else to the same button of the next toast
 * still showing, after this one or else before it (Dismiss, which every toast has, for an Undo that one lacks); else to the page's main. Only a
 * press with no click count reaches it (the keyboard's, or a script's `click()`, M6), and a focus that is not in the toast is left where it is.
 */
function moveFocusOff(button: HTMLElement, acting: boolean): void {
  const toast = button.closest('li');
  if (toast === null || !toast.contains(document.activeElement)) return;
  const from = cameFrom;
  const back = from !== null && from.isConnected && from.closest('[inert]') === null && !toast.contains(from) && !(acting && takesTyping(from));
  if (back && focusOn(from)) return;
  const others = [...(toast.parentElement?.children ?? [])].filter((li) => li !== toast && li.getAttribute('data-state') === 'open');
  const after = others.filter((li) => (toast.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const before = others.filter((li) => !after.includes(li)).reverse();
  for (const li of [...after, ...before]) {
    if (focusOn((acting ? li.querySelector('button.primary') : null) ?? li.querySelector('button[aria-label="Dismiss"]'))) return;
  }
  focusMain();
}

/**
 * The region's markup for `toasts`, oldest first, so the newest sits nearest the corner: a toast that is leaving is drawn leaving
 * (`data-state`) and takes no pointer, its exit the stylesheet's. Hook-free.
 */
export function ToastList(props: { toasts: readonly Toast[] }): ReactElement {
  return (
    <section className="toasts" aria-label="Notifications" onFocus={noteArrival}>
      <ol aria-live="polite" aria-relevant="additions">
        {props.toasts.map((t) => (
          <li
            key={t.id}
            className="toast"
            data-state={t.leaving ? 'leaving' : 'open'}
            // a pointer that moves over it holds it, not one it appeared under (P2-D28)
            onPointerMove={() => pauseToast(t.id, 'pointer')}
            onPointerLeave={() => resumeToast(t.id, 'pointer')}
            onFocus={() => pauseToast(t.id, 'focus')}
            onBlur={(e) => {
              if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) resumeToast(t.id, 'focus');
            }}
          >
            <span>{t.text}</span>
            {t.action !== undefined && (
              <button
                type="button" className="small primary"
                onClick={(e) => {
                  if (e.detail === 0) moveFocusOff(e.currentTarget, true);   // the keyboard's press (Enter, Space) has no click count
                  actOnToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button" className="small" aria-label="Dismiss"
              onClick={(e) => {
                if (e.detail === 0) moveFocusOff(e.currentTarget, false);
                dismissToast(t.id);
              }}
              onKeyDown={ignoreHeldEnter}   // a held Enter dismisses one toast, not the next one this hands the focus to (P2-R69)
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Tells `store` whether `doc` is hidden, now and at every `visibilitychange`, which holds every toast's time while the page is hidden; returns how
 * to stop, which lets go of that hold: with no region to follow the page (the login page draws none), nothing holds a toast for it.
 */
export function followVisibility(doc: EventTarget & { readonly hidden: boolean }, store: Pick<ToastStore, 'setHidden'>): () => void {
  const follow = (): void => store.setHidden(doc.hidden);
  follow();
  doc.addEventListener('visibilitychange', follow);
  return () => {
    doc.removeEventListener('visibilitychange', follow);
    store.setHidden(false);
  };
}

/** The App's region: its toasts, and the page's visibility, which holds every toast's time while the page is hidden. */
export function Toasts(): ReactElement {
  const list = useToasts();
  useEffect(() => followVisibility(document, toasts), []);
  return <ToastList toasts={list} />;
}
