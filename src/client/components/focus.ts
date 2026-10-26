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
