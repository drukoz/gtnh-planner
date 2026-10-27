// The in-app confirm (Phase 2 spec §13, D15): a question asked in the page, where the control that asks it was, never in a browser dialog
// (none is left in the client: inline-confirm.test.tsx reads the sources). It is an alertdialog named by its question, the dangerous answer
// first and the safe one last, which takes the focus as it opens, so a slip of Enter keeps what it asks about.
//
// The keyboard stays with the question until it is answered: Tab and Shift+Tab go round its buttons, and Escape is the safe answer, one layer
// per press (spec §6.1, R15): a key a layer above has already taken (a tip that hid, ledger ruling P2-R21b) is not its, and it takes the key
// (`preventDefault`, never `stopPropagation`), so the settings drawer it may be asked in stays open. While the answer is on its way (`busy`)
// the dangerous button cannot be pressed again, and the focus, if it is there, moves to the safe one first: Chromium drops the focus of a
// disabled button on the page's body at its next frame. Where the focus goes once the question has gone is for its owner to say.

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';

export function InlineConfirm(props: {
  question: string; confirmLabel: string; cancelLabel?: string; busy?: boolean; error?: string | null; onConfirm(): void; onCancel(): void;
}): ReactElement {
  const { question, confirmLabel, cancelLabel = 'Keep it', busy = false, error = null, onConfirm, onCancel } = props;
  const questionId = useId();
  const answer = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    keep.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (busy && document.activeElement === answer.current) keep.current?.focus();
  }, [busy]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {   // one layer per press: not a key a tip has hidden itself with
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab') {
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const [first, last] = [buttons[0], buttons.at(-1)];
      if (first === undefined || last === undefined || document.activeElement !== (e.shiftKey ? first : last)) return;
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
  return (
    <div className="inline-confirm" role="alertdialog" aria-labelledby={questionId} onKeyDown={onKeyDown}>
      <p id={questionId}>{question}</p>
      {error !== null && error !== '' && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button ref={answer} type="button" className="small danger" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        <button ref={keep} type="button" className="small" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  );
}
