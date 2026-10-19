import { describe, it, expect } from 'vitest';
import { findPath, growTree, straightPath, linkBits, MAX_PATH_NODES } from '../../../src/server/layout/path.ts';
import { posKey, type Vec3 } from '../../../src/shared/layout/geometry.ts';

const open = () => true;
const box = (max: Vec3) => ({ min: [0, 0, 0] as Vec3, max });

describe('findPath', () => {
  it('goes straight through open space', () => {
    const r = findPath([[0, 0, 0]], [[5, 0, 0]], { passable: open, bounds: box([5, 0, 0]) });
    expect(r.found).toBe(true);
    expect(r.path).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]]);
  });

  it('walks around a wall', () => {
    const wall = new Set(['2,0,0', '2,0,1', '2,0,2', '2,0,3']);
    const passable = (p: Vec3) => !wall.has(posKey(p));
    const r = findPath([[0, 0, 0]], [[4, 0, 0]], { passable, bounds: box([4, 0, 4]) });
    expect(r.found).toBe(true);
    expect(r.path).toHaveLength(13);
    expect(r.path).toContainEqual([2, 0, 4]);
    expect(r.path.every(passable)).toBe(true);
  });

  it('climbs over an obstacle with the fewest turns', () => {
    const r = findPath([[0, 0, 0]], [[4, 0, 0]], { passable: (p) => posKey(p) !== '2,0,0', bounds: box([4, 1, 0]) });
    expect(r.path).toEqual([[0, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 1, 0], [4, 0, 0]]);
  });

  it('gives up within its node budget', () => {
    const walled = new Set([[49, 5, 50], [51, 5, 50], [50, 4, 50], [50, 6, 50], [50, 5, 49], [50, 5, 51]].map((p) => posKey(p as Vec3)));
    const t0 = performance.now();
    const r = findPath([[0, 0, 0]], [[50, 5, 50]], { passable: (p) => !walled.has(posKey(p)), bounds: box([99, 9, 99]), maxNodes: 5000 });
    expect(r.found).toBe(false);
    expect(r.path).toEqual([]);
    expect(r.expanded).toBeLessThanOrEqual(5001);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(MAX_PATH_NODES).toBe(200_000);
  });
});

describe('growTree', () => {
  it('connects every terminal with shared runs', () => {
    const r = growTree([[0, 0, 2]], [[6, 0, 0], [6, 0, 4]], { passable: open, bounds: box([6, 0, 4]) });
    expect(r.unreached).toEqual([]);
    expect(r.cells.length).toBeLessThanOrEqual(12);              // two separate paths would need 16 cells
    const net = new Set([...r.cells, [0, 0, 2] as Vec3].map(posKey));
    const adj = new Map<string, string[]>();
    for (const [a, b] of r.links) {
      adj.set(posKey(a), [...(adj.get(posKey(a)) ?? []), posKey(b)]);
      adj.set(posKey(b), [...(adj.get(posKey(b)) ?? []), posKey(a)]);
    }
    const seen = new Set(['0,0,2']);
    const queue = ['0,0,2'];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    expect(seen.has('6,0,0') && seen.has('6,0,4')).toBe(true);
    expect([...seen].every((k) => net.has(k))).toBe(true);
  });

  it('reports terminals it cannot reach', () => {
    const r = growTree([[0, 0, 0]], [[4, 0, 0]], { passable: (p) => p[0] !== 2, bounds: box([4, 0, 0]) });
    expect(r.unreached).toEqual([[4, 0, 0]]);
    expect(r.cells).toEqual([]);
  });

  it('turns links into connection bits and draws straight guides', () => {
    const bits = linkBits([[[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]]]);
    expect(Object.fromEntries(bits)).toEqual({ '0,0,0': 32, '1,0,0': 16 | 2, '1,1,0': 1 });
    expect(straightPath([0, 0, 0], [2, 1, 1])).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 1], [2, 1, 1]]);
  });
});
