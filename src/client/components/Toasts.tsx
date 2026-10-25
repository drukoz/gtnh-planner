// The App's toasts (Phase 2 spec §12.3): a labelled region in the window's bottom-right corner, drawn after the page, whose list is always
// there, empty or not, and polite: a screen reader hears each toast as it comes, once, and never one that goes (`aria-relevant="additions"`);
// never an alert or a status. Each toast is its words, its action's button (Undo) when it has one, and Dismiss. Its time stops while the
// pointer moves over it and while the focus is inside it (state/toasts.ts), and the region tells the store when the page is hidden. While the
// settings drawer is open the project page makes the region inert with the top bar, so the drawer stays a layer of its own (ruling R36).

import { useEffect, type ReactElement } from 'react';
import { actOnToast, dismissToast, pauseToast, resumeToast, toasts, useToasts, type Toast } from '../state/toasts.ts';

/**
 * The region's markup for `toasts`, oldest first, so the newest sits nearest the corner: a toast that is leaving is drawn leaving
 * (`data-state`) and takes no pointer, its exit the stylesheet's. Hook-free.
 */
export function ToastList(props: { toasts: readonly Toast[] }): ReactElement {
  return (
    <section className="toasts" aria-label="Notifications">
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
            {t.action !== undefined && <button type="button" className="small primary" onClick={() => actOnToast(t.id)}>{t.action.label}</button>}
            <button type="button" className="small" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The App's region: its toasts, and the page's visibility, which holds every toast's time while the page is hidden. */
export function Toasts(): ReactElement {
  const list = useToasts();
  useEffect(() => {
    const follow = (): void => toasts.setHidden(document.hidden);
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => {
      document.removeEventListener('visibilitychange', follow);
      toasts.setHidden(false);   // with no region to follow the page (the login page draws none), nothing holds a toast for it
    };
  }, []);
  return <ToastList toasts={list} />;
}
