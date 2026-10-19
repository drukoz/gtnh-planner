// Number and name formatting for layout texts (warnings, power detail, build steps, the Connections view), shared by the
// server and the browser so both write the same words. Pure TypeScript: nothing from node:* may be imported here.

import type { LogisticsNetwork } from '../types/world.ts';

/**
 * A logistics network kind as the build steps, pins and the Connections view name it (moved here from the server's
 * pins.ts: architecture "EnderIO conduits, granted change requests (add-on 11)").
 */
export const NETWORK_NAMES: Readonly<Record<LogisticsNetwork['kind'], string>> = Object.freeze({
  routed: 'Project Red routed', ae2: 'AE2', gtpipe: 'GT pipe', enderio: 'EnderIO',
});

/** Turns −0 (from rounding a small negative number) into 0, so it never prints as "-0". */
function unsignedZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** A whole number with thousands separators: 1286400 → "1,286,400". */
export function fmtInt(n: number): string {
  return unsignedZero(Math.round(n)).toLocaleString('en-US');
}

/** A rate to one decimal place with thousands separators: 0.5, 3.2, 1,000. */
export function fmtRate(n: number): string {
  return unsignedZero(Math.round(n * 10) / 10).toLocaleString('en-US');
}

/** "A", "A and B", "A, B and C"; an empty list gives "". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
