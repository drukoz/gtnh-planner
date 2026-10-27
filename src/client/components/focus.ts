// The keyboard's focus: moving it on when what has it goes or is disabled (ledger rulings P2-R57, P2-R68), to the next sensible control, else to
// the page's main, never to the body; and the held-key guard, which makes a held Enter act once wherever its first press puts the focus
// (P2-R69a, P2-R76). No React.

/** Focuses `el`, an HTML or an SVG element (a Flow box's head), and says whether it took the focus (one hidden, disabled or gone does not). */
export function focusOn(el: Element | null | undefined, options?: FocusOptions): boolean {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
  el.focus(options);
  return document.activeElement === el;
}

/** The page's main, focused as a last resort, with a tabindex of -1 that it loses with the focus (it is no stop of the Tab order). */
export function focusMain(): void {
  const main = document.querySelector('main');
  if (!(main instanceof HTMLElement)) return;
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
  }
  main.focus({ preventScroll: true });
}

/** Whether the focus has been lost: nothing has it, or the body has, as when what had it was removed or disabled. */
export function focusLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body;
}

/**
 * Makes a held Enter act once, wherever its first press puts the focus (ledger ruling P2-R69a, which widens P2-R69). Chromium sends a held key's
 * auto-repeats to whatever has the focus, so a press that hands the focus on as it acts lands its repeats there: a note's Delete on the next
 * note's (deleting it too) or on the field to add one (typing line breaks), a toast's Undo or Dismiss on the next toast's, a step panel's Close on
 * the box it gives the focus back to (picking it again), "Pick something to make" on the Make search (picking from the list it reopens). A
 * repeated Enter whose target is not where the press began is prevented, which keeps it from pressing a button or typing. A handler that acts
 * on Enter itself skips a prevented key, each on the line that tests for Enter (ledger ruling P2-R76; enter-layers.test.tsx reads them all):
 * the Flow canvas's pick (FlowView), the Make search's pick (ItemSearch), the avoid box's add (AvoidPicker), the tooltip's quiet on a focused
 * trigger (Tooltip), the project name's commit (ProjectPage, ledger ruling P2-R132) and the three settings drafts' commit (SettingsPanel: the
 * amount, a cost, a crop stat). A press held where it began repeats as before (Enter held in a text area types line after line). It listens on
 * `doc` in the capture phase, so it sees each key before any element does; installed once for the page's life (main.tsx), it returns how to
 * stop.
 *
 * Its order is a rule: it must see each key first (ledger ruling P2-R79). Capture listeners on one target run in the order they were added, and
 * the window's run before the document's, so a native key listener that reads `defaultPrevented` is added, on the document, after the guard is
 * installed or in the bubble phase, and on the window, in the bubble phase only: one on the document added before the guard in the capture
 * phase, or one on the window in the capture phase, whenever it was added, would read a repeat before the guard prevents it. TooltipHost's
 * capture listener on the document is added after it, as React mounts after main.tsx installs the guard (tooltips.spec.ts: a held Enter that
 * hands the focus to a box head leaves the head's tip to show), and the project page's shortcut listener is a bubble one on the document;
 * React's own listeners sit on its root and on a portal's container (<body>), under the document, so every handler written in React reads it.
 */
export function guardHeldEnter(doc: Document = document): () => void {
  let began: EventTarget | null = null;                                                 // where the Enter being held was first pressed
  const down = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    if (!e.repeat) began = e.target;
    else if (e.target !== began) e.preventDefault();
  };
  const up = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') began = null;
  };
  doc.addEventListener('keydown', down, true);
  doc.addEventListener('keyup', up, true);
  return () => {
    doc.removeEventListener('keydown', down, true);
    doc.removeEventListener('keyup', up, true);
  };
}
