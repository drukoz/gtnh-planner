// The rounding of every per-second value in a `Solution` and a `Plan` (fix spec D3): 9 significant digits, so a line
// keeps its precision at 1 per hour as at 1 per second (9 decimal places kept 1–2 digits of a step that runs 2.2e-8
// times a second, and arrows read up to 2 % off the steps they join). Counts, EU/t and build-list amounts keep their own
// rounding; a whole count read from such a rate (machines, a farm's crop sticks) rounds up by `wholeMachines`.

export const SIGNIFICANT_DIGITS = 9;

/** `x` to 9 significant digits; −0 and anything not finite read 0. Idempotent: `sig9(sig9(x)) === sig9(x)`. */
export function sig9(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  return Number(x.toPrecision(SIGNIFICANT_DIGITS)) || 0;
}

/** A count this little above a whole number stays whole (prior-art §3.4 step 6: a count that is exactly 2 stays 2). */
const WHOLE_TINY = 1e-9;
/**
 * The share of a load its rate's 9 significant digits can move it by (plan 12 Task 8): a step's runs per second keep 9
 * significant digits (`sig9`), up to 5e-9 of their value off, so a set of machines exactly full can read a little above a
 * whole number — 10 machines' worth at 1/6 a run a second reads 10.00000002 — and stays that whole number, as an exact 2
 * stays 2 (`WHOLE_TINY`).
 */
const SIG9_SLACK = 1e-8;

/** How little above a whole number a `load` may read and still stay that number: `WHOLE_TINY` or its 9 digits' slack. */
export function wholeSlack(load: number): number {
  return Math.max(WHOLE_TINY, SIG9_SLACK * Math.abs(load));
}

/**
 * The whole machines `load` machines' worth needs (`wholeSlack`); 0 for none. A farm step's crop sticks count the same way
 * (farms/recipes.ts `sticksOf`): an exactly full Crop Manager keeps the sticks it tends.
 */
export function wholeMachines(load: number): number {
  return Math.ceil(load - wholeSlack(load));
}
