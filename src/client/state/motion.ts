// Whether the user has asked their system for less motion (Phase 2 spec §3.4). The stylesheet's reduced-motion block stops what CSS
// moves; every motion the page drives from JS asks this first, at each call, so a change of the setting counts at once, and then does
// the instant thing instead: the theme's cross-fade (state/theme.ts) now, the glides and the count-up of later tasks.

/** True while the system asks for reduced motion; false where there is no `matchMedia` (node). */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
