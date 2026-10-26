// The keyboard shortcuts' sheet (Phase 2 spec §14.1, P2-D29): a modal that lists the project page's keys (state/shortcuts.ts), each key's caps
// in the button's look beside what it does, a digit cap's digit in VT323 (`Figs`, spec §25). It is the top layer while it is open: a portal on
// <body>, with #root inert behind it, so neither Tab nor a click reaches the page, and the toasts wait it out as they wait out the drawer
// (ledger ruling P2-R72: a toast drawn already keeps its time, one shown meanwhile is drawn once the sheet has closed). Its Close button takes
// the focus as it opens, and the keyboard stays in the sheet: Tab and Shift+Tab go round its controls, and a press on its words leaves the focus
// in the dialog, which takes it, its words still selectable (ledger ruling P2-R81a; InlineConfirm keeps the keyboard the same way).
// Escape, Close or a press on the dimmed page closes it, and the page gives the focus back (ProjectPage). Escape stops at the sheet (P2-D22):
// nothing under the modal top layer hears it, Flow's highlight included; a key a layer above has handled (the shared tooltip's, hiding a tip)
// is not the sheet's, one layer per press (P2-R21b).

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUT_ROWS } from '../state/shortcuts.ts';
import { setSingleKeyShortcuts, useSingleKeyShortcuts } from '../state/single-key-shortcuts.ts';
import { setToastsInert } from '../state/toasts.ts';
import { Figs } from './Figs.tsx';

/** The words a screen reader says for a glyph it would skip or misread (ledger ruling P2-R86): the punctuation keys, and the range's dash. */
const SPOKEN: Readonly<Record<string, string>> = { '/': 'slash', '?': 'question mark', '–': ' to ' };

/** `glyph` as it is seen, hidden from a screen reader, which hears its word instead (P2-R86). Hook-free. */
function Spoken(props: { glyph: string }): ReactElement {
  return <><span aria-hidden="true">{props.glyph}</span><span className="visually-hidden">{SPOKEN[props.glyph]}</span></>;
}

/** The end of the diagram hints, Flow's and Connections', while the single-key shortcuts are on (spec §14.1): the sheet's key, said as a word. */
export const SHEET_KEY_HINT = <>{' '}<Spoken glyph="?" /> shows the shortcuts.</>;

/**
 * The sheet's dialog, named by its title: a row a key, its caps (an en dash between two stands for a range) and what it does; then the tick that
 * turns the single-key shortcuts on and off for this browser (ledger ruling P2-R85: WCAG 2.1.4); then Close.
 */
export function ShortcutsDialog(props: { onClose(): void; closeRef?: Ref<HTMLButtonElement> }): ReactElement {
  const { onClose, closeRef } = props;
  const titleId = useId();
  const keysOn = useSingleKeyShortcuts();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // The modal top layer: no Escape gets past it (P2-D22), not even one a layer above took (a tip's, which it prevents and never stops); it
    // closes on one nobody took, one layer per press (P2-R21b)
    if (e.key === 'Escape') { e.stopPropagation(); if (!e.nativeEvent.defaultPrevented) { e.preventDefault(); onClose(); } return; }
    if (e.key === 'Tab') {
      // Tab and Shift+Tab go round the sheet's controls, the tick and Close: the page behind is inert, and past them the focus would fall to
      // the page's body, where Escape is no longer the sheet's
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')];
      const [first, last] = [controls[0], controls.at(-1)];
      const at = document.activeElement;
      if (first === undefined || last === undefined) return;
      const inside = controls.some((control) => control === at);
      if (e.shiftKey ? inside && at !== first : inside && at !== last) return;   // the browser's own step, to the next control
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
  // tabIndex -1: a press on the sheet's words gives the dialog the focus, where Escape and Tab are still the sheet's (it would fall to the body)
  return (
    <div className="modal shortcuts-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <h2 id={titleId}>Keyboard shortcuts</h2>
      <dl className="shortcut-list">
        {SHORTCUT_ROWS.map(([caps, what]) => (
          <div key={what}>
            <dt>
              {caps.map((cap, i) => {
                if (cap === '–') return <Spoken key={i} glyph={cap} />;
                return <kbd key={i}>{SPOKEN[cap] === undefined ? <Figs text={cap} /> : <Spoken glyph={cap} />}</kbd>;
              })}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <label className="check">
        <input type="checkbox" checked={keysOn} onChange={(e) => setSingleKeyShortcuts(e.currentTarget.checked)} />
        Use single-key shortcuts
      </label>
      <button type="button" ref={closeRef} onClick={onClose}>Close</button>
    </div>
  );
}

/**
 * The sheet, in a portal on <body>: #root inert and the toasts held while it is open (a hold of its own, so a sheet over the open drawer leaves
 * the drawer's when it closes: ledger ruling P2-R88), its Close focused as it opens.
 */
export function ShortcutsSheet(props: { onClose(): void }): ReactElement {
  const { onClose } = props;
  const close = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root !== null) root.inert = true;
    setToastsInert(true, 'sheet');
    close.current?.focus();
    return () => {
      if (root !== null) root.inert = false;
      setToastsInert(false, 'sheet');
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
