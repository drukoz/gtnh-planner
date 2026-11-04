// The solver threads as a pool (RUK-529): jobs handed out together go to as many threads as GTNH_LP_THREADS allows, and
// every answer is `solveLp`'s, bit for bit. Its own file, so the pool starts empty here.
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { solveLp, solveLpAside, solverThreadCount, type LpModel } from '../../../src/server/planner/lp.ts';

/** A 0/1 knapsack of 30 items whose weights and values depend on `seed`, cut at 200 nodes. */
function knapsack(seed: number): LpModel {
  const weights = Array.from({ length: 30 }, (_, i) => 1000 + ((i * 7919 + seed * 104729) % 1000));
  const values = weights.map((w, i) => w + ((i * 104729 + seed) % 97));
  return {
    sense: 'max', colCost: values, colLower: new Array<number>(30).fill(0), colUpper: new Array<number>(30).fill(1),
    rows: [{ lower: -Infinity, upper: Math.floor(weights.reduce((a, b) => a + b, 0) / 2), entries: weights.map((w, i): [number, number] => [i, w]) }],
    integer: new Array<boolean>(30).fill(true), maxNodes: 200,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('solverThreadCount', () => {
  it('takes GTNH_LP_THREADS when it is a whole number from 1 to 64, else at most 4', () => {
    vi.stubEnv('GTNH_LP_THREADS', '3');
    expect(solverThreadCount()).toBe(3);
    for (const bad of ['0', '65', '2.5', 'two', '']) {
      vi.stubEnv('GTNH_LP_THREADS', bad);
      expect(solverThreadCount()).toBeGreaterThanOrEqual(1);
      expect(solverThreadCount()).toBeLessThanOrEqual(4);
    }
  });
});

describe('solveLpAside on a pool of threads', () => {
  it('spreads jobs asked together over GTNH_LP_THREADS threads, each answer as solveLp gives it', async () => {
    vi.stubEnv('GTNH_LP_THREADS', '2');
    const workers = new Set<Worker>();
    const post = Worker.prototype.postMessage;
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      workers.add(this);
      return post.apply(this, args);
    });
    const models = [1, 2, 3, 4, 5, 6].map(knapsack);
    const aside = await Promise.all(models.map((m) => solveLpAside(m)));
    expect(workers.size).toBe(2);
    for (const [i, m] of models.entries()) expect(aside[i]).toStrictEqual(await solveLp(m));
  });
});
