// Moving the keyboard's focus on when what has it goes or is disabled (ledger rulings P2-R57, P2-R68): to the next sensible control, else
// to the page's main, never to the body. No React.

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
 * A button's keydown that keeps a held Enter from pressing it again (ledger ruling P2-R69). Chromium presses a focused button once more on each
 * auto-repeat of a held Enter, and a button that hands the focus on to the next one of its kind as it acts (a note's Delete, a toast's Dismiss)
 * would press that one too, and the next. A repeated Enter's default is prevented, which prevents its press: one held press acts once.
 */
export function ignoreHeldEnter(e: { key: string; repeat: boolean; preventDefault(): void }): void {
  if (e.repeat && e.key === 'Enter') e.preventDefault();
}
