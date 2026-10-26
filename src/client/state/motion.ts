// Whether the user has asked their system for less motion (Phase 2 spec §3.4), and the motion tokens of the stylesheet that JS motion uses
// (§16.1). The stylesheet's reduced-motion block stops what CSS moves; every motion the page drives from JS asks this first, at each call, so
// a change of the setting counts at once, and then does the instant thing instead: the theme's cross-fade (state/theme.ts), the diagrams'
// pans (views/glide.ts) and the count-up of later tasks.

/** The re-layout's glide (Phase 2 spec §16.3): the stylesheet's `--dur-slow`. */
export const GLIDE_MS = 260;
/** A pan of a diagram's view (Fit, the zoom buttons, a reveal: Phase 2 spec §16.2), as the Phase 1 spec's §7a sets it. */
export const PAN_MS = 250;
/** What goes out (Phase 2 spec §16.3's ghosts): the stylesheet's `--dur-exit`. */
export const EXIT_MS = 180;
/** The stylesheet's `--ease-out`: what comes or moves in slows to its end. */
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** The stylesheet's `--ease-in`: what goes out speeds up as it goes. */
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

/** True while the system asks for reduced motion; false where there is no `matchMedia` (node). */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
