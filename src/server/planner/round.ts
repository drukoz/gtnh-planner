// The rounding of every per-second value in a `Solution` and a `Plan` (fix spec D3): 9 significant digits, so a line
// keeps its precision at 1 per hour as at 1 per second (9 decimal places kept 1–2 digits of a step that runs 2.2e-8
// times a second, and arrows read up to 2 % off the steps they join). Counts, EU/t and build-list amounts keep their own
// rounding.

export const SIGNIFICANT_DIGITS = 9;

/** `x` to 9 significant digits; −0 and anything not finite read 0. Idempotent: `sig9(sig9(x)) === sig9(x)`. */
export function sig9(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  return Number(x.toPrecision(SIGNIFICANT_DIGITS)) || 0;
}
