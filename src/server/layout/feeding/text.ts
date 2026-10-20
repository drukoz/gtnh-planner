// The wording helpers the feeding checker's texts share (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md`
// Task 3): the static rules (precheck.ts) and, later, the simulation's detectors write an amount, a list of names and a
// count of slots the same way, and the same way the layout's own texts do.
// Pure TypeScript: nothing from node:* may be imported here.

import { joinNames } from '../../../shared/layout/format.ts';

/**
 * Whole numbers with thousands separators, anything else with two decimals: 1286400 gives "1,286,400" and 0.5 gives
 * "0.50". A copy of the private `amountText` in `src/server/layout/modes/mode.ts`, which the checker may not import
 * (ruling R-5: the plan allows only `stepItemInputs` and `stepItemOutputs` from that file); keep the two in step.
 */
export function amountText(n: number): string {
  const x = Math.round(n * 1e9) / 1e9 || 0;
  return Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "A", "A and B", "A, B and C"; an empty list gives "" (the layout's `joinNames`). */
export function listText(names: readonly string[]): string {
  return joinNames(names);
}

/** "1 input slot", "2 input slots", "0 input slots". */
export function slotWord(n: number): string {
  return `${n} input slot${n === 1 ? '' : 's'}`;
}
