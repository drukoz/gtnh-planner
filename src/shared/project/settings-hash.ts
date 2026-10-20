// The hash of a project's settings that each plan carries (`Plan.settingsHash`), as the server's `settingsHash`
// (server/planner/basis.ts, node:crypto) makes it, in plain TypeScript shared by server and browser: nothing from node:*
// may be imported here. The browser tells by it whether the plan on screen is the plan of the settings it shows, as a
// settings change applies in the tab at once and its plan follows a second or more later.

import type { PlanSettings } from '../types/plan.ts';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A copy of `value` whose objects list their keys in sorted order, at every depth; arrays keep their order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort(byString).map((key) => [key, withSortedKeys(record[key])]));
}

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

/** The SHA-1 digest of `text` as UTF-8, in lower-case hex (FIPS 180-4). */
export function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const words = new Uint32Array(blocks * 16);
  bytes.forEach((byte, i) => {
    words[i >> 2] = (words[i >> 2] ?? 0) | (byte << (24 - 8 * (i % 4)));
  });
  words[bytes.length >> 2] = (words[bytes.length >> 2] ?? 0) | (0x80 << (24 - 8 * (bytes.length % 4)));
  words[blocks * 16 - 2] = Math.floor(bytes.length / 0x20000000);   // the length in bits, high word
  words[blocks * 16 - 1] = (bytes.length * 8) >>> 0;
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let block = 0; block < blocks; block++) {
    for (let t = 0; t < 80; t++) {
      w[t] = t < 16 ? (words[block * 16 + t] ?? 0) : rotl((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0), 1);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotl(a, 5) + f + e + k + (w[t] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = next;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * The first 16 hex digits of the SHA-1 of the settings as JSON with every object's keys sorted. An empty or missing avoid
 * list is left out: it plans like none, and a project stored before the list existed keeps its hash.
 */
export function settingsHash(s: PlanSettings): string {
  const { avoid, ...rest } = s;
  const hashed = (avoid ?? []).length === 0 ? rest : s;
  return sha1Hex(JSON.stringify(withSortedKeys(hashed))).slice(0, 16);
}
