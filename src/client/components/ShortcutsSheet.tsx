// The keyboard shortcuts' sheet (Phase 2 spec §14.1, P2-D29): a modal that lists the project page's keys (state/shortcuts.ts), each key's caps
// in the button's look beside what it does, a digit cap's digit in VT323 (`Figs`, spec §25). It is the top layer while it is open: a portal on
// <body>, with #root inert behind it, so neither Tab nor a click reaches the page, and the toasts wait it out as they wait out the drawer
// (ledger ruling P2-R72: a toast drawn already keeps its time, one shown meanwhile is drawn once the sheet has closed). Its Close button takes
// the focus as it opens and keeps it: Tab stays on it, as a press on the sheet's words does (InlineConfirm keeps the keyboard the same way).
// Escape, Close or a press on the dimmed page closes it, and the page gives the focus back (ProjectPage). Escape stops at the sheet (P2-D22):
// nothing under the modal top layer hears it, Flow's highlight included; a key a layer above has handled (the shared tooltip's, hiding a tip)
// is not the sheet's, one layer per press (P2-R21b).

import { Fragment, useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUT_ROWS } from '../state/shortcuts.ts';
import { setToastsInert } from '../state/toasts.ts';
import { Figs } from './Figs.tsx';

/** The sheet's dialog, named by its title: a row a key, its caps (an en dash between two stands for a range) and what it does; then Close. */
export function ShortcutsDialog(props: { onClose(): void; closeRef?: Ref<HTMLButtonElement> }): ReactElement {
  const { onClose, closeRef } = props;
  const titleId = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {   // one layer per press: not a key a tip has hidden itself with
      e.preventDefault();
      e.stopPropagation();   // the modal top layer: nothing under it hears this Escape (P2-D22)
      onClose();
    } else if (e.key === 'Tab') {
      // Close is the sheet's one control, and Tab and Shift+Tab stay on it: the page behind is inert, and past it the focus would fall to
      // the page's body, where Escape is no longer the sheet's
      e.preventDefault();
      e.currentTarget.querySelector('button')?.focus();
    }
  };
  // a press on the sheet's words leaves the focus on Close, for the same reason (it would fall to the page's body)
  const keepFocus = (e: MouseEvent<HTMLDivElement>): void => {
    if (!(e.target instanceof Element && e.target.closest('button') !== null)) e.preventDefault();
  };
  return (
    <div className="modal shortcuts-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown} onMouseDown={keepFocus}>
      <h2 id={titleId}>Keyboard shortcuts</h2>
      <dl className="shortcut-list">
        {SHORTCUT_ROWS.map(([caps, what]) => (
          <div key={what}>
            <dt>{caps.map((cap, i) => (cap === '–' ? <Fragment key={i}>–</Fragment> : <kbd key={i}><Figs text={cap} /></kbd>))}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <button type="button" ref={closeRef} onClick={onClose}>Close</button>
    </div>
  );
}

/** The sheet, in a portal on <body>: #root inert and the toasts held while it is open, its Close focused as it opens. */
export function ShortcutsSheet(props: { onClose(): void }): ReactElement {
  const { onClose } = props;
  const close = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root !== null) root.inert = true;
    setToastsInert(true);
    close.current?.focus();
    return () => {
      if (root !== null) root.inert = false;
      setToastsInert(false);
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();   // no focus moves to the dimmed page: the page gives it back as the sheet closes
        onClose();
      }}
    >
      <ShortcutsDialog onClose={onClose} closeRef={close} />
    </div>,
    document.body,
  );
}
