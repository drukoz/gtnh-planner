// Graph helpers shared by the power and logistics passes (Plan 4 Tasks 9 and 10): a union-find over string keys, the
// position order every network id and tap list uses, the majority vote that gives a network its base, and tap picking.

import type { Vec3 } from './model.ts';

/** The most taps one network offers (one per 16×16×16 cell, see `pickTaps`). */
export const MAX_TAPS_PER_NETWORK = 12;

/** The edge of a tap cell in blocks. */
const TAP_CELL = 16;

/** Disjoint sets of string keys. A key joins as a set of its own the first time `find` or `union` sees it. */
export class UnionFind {
  readonly #parent = new Map<string, string>();
  readonly #size = new Map<string, number>();

  /** The representative of `k`'s set (registering `k` when it is new). */
  find(k: string): string {
    let root = this.#parent.get(k);
    if (root === undefined) {
      this.#parent.set(k, k);
      this.#size.set(k, 1);
      return k;
    }
    for (let up = this.#parent.get(root)!; up !== root; up = this.#parent.get(root)!) root = up;
    for (let cur = k; cur !== root;) {
      const next = this.#parent.get(cur)!;
      this.#parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  /** Joins the sets of `a` and `b`. */
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    const sa = this.#size.get(ra)!, sb = this.#size.get(rb)!;
    const [big, small] = sa >= sb ? [ra, rb] : [rb, ra];
    this.#parent.set(small, big);
    this.#size.set(big, sa + sb);
  }

  /** Every set by its representative; keys and members in the order the keys were first seen. */
  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const k of this.#parent.keys()) {
      const root = this.find(k);
      const members = out.get(root);
      if (members === undefined) out.set(root, [k]);
      else members.push(k);
    }
    return out;
  }
}

/** Orders positions by x, then y, then z, as numbers. */
export function comparePos(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The first of `ps` in `comparePos` order; throws for an empty list. */
export function smallestPos(ps: Vec3[]): Vec3 {
  let best = ps[0];
  if (best === undefined) throw new RangeError('smallestPos needs at least one position');
  for (const p of ps) if (comparePos(p, best) < 0) best = p;
  return best;
}

/** The most common non-null id, ties going to the smallest string; null when every id is null (or there is none). */
export function majority(ids: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | null = null, bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && id < best)) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Tap positions: the smallest candidate (`comparePos`) of each 16×16×16 cell (cells by floor division, so x = −1 and
 * x = 0 never share one), in `comparePos` order, the first `max` of them. All candidates are of one dimension.
 */
export function pickTaps(cands: Vec3[], max: number): Vec3[] {
  const best = new Map<string, Vec3>();
  for (const p of cands) {
    const cell = `${Math.floor(p[0] / TAP_CELL)}:${Math.floor(p[1] / TAP_CELL)}:${Math.floor(p[2] / TAP_CELL)}`;
    const kept = best.get(cell);
    if (kept === undefined || comparePos(p, kept) < 0) best.set(cell, p);
  }
  return [...best.values()].sort(comparePos).slice(0, Math.max(0, max));
}
