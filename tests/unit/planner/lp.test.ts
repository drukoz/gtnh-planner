import { describe, it, expect } from 'vitest';
import { solveLp } from '../../../src/server/planner/lp.ts';

describe('solveLp', () => {
  it('solves a small minimisation', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: 4, upper: Infinity, entries: [[0, 1], [1, 2]] }] });
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(2, 9);
    expect(r.x[1]).toBeCloseTo(2, 9);
  });
  it('reports infeasible', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1], colLower: [0], colUpper: [3], rows: [{ lower: 5, upper: Infinity, entries: [[0, 1]] }] });
    expect(r.status).toBe('infeasible');
  });
  it('is unaffected by badly scaled rows', async () => {
    const r = await solveLp({ sense: 'min', colCost: [1, 0], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: 0, upper: 0, entries: [[0, 20000], [1, -0.05]] }, { lower: 1, upper: Infinity, entries: [[1, 1]] }] });
    expect(r.x[0]).toBeCloseTo(0.05 / 20000, 10);
  });
  it('reports an unbounded maximisation as not optimal', async () => {
    const r = await solveLp({ sense: 'max', colCost: [1], colLower: [0], colUpper: [Infinity], rows: [] });
    expect(r.status).not.toBe('optimal');
  });
  it('decides a model without columns from its row bounds', async () => {
    expect(await solveLp({ sense: 'min', colCost: [], colLower: [], colUpper: [], rows: [] })).toEqual({ status: 'optimal', objective: 0, x: [] });
    const r = await solveLp({ sense: 'min', colCost: [], colLower: [], colUpper: [], rows: [{ lower: 1, upper: Infinity, entries: [] }] });
    expect(r.status).toBe('infeasible');
  });
  it('solves a small MIP with whole columns', async () => {
    const r = await solveLp({ sense: 'max', colCost: [1, 1], colLower: [0, 0], colUpper: [Infinity, Infinity],
      rows: [{ lower: -Infinity, upper: 3, entries: [[0, 2], [1, 2]] }], integer: [true, true], maxNodes: 100 });
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(1, 9);
    expect(r.x.every((v) => Math.abs(v - Math.round(v)) < 1e-9)).toBe(true);
  });
  it('rejects a row with a missing column, a repeated column or a non-finite coefficient', async () => {
    const model = (entries: Array<[number, number]>) => ({ sense: 'min' as const, colCost: [1], colLower: [0], colUpper: [1], rows: [{ lower: 0, upper: 1, entries }] });
    await expect(solveLp(model([[1, 1]]))).rejects.toThrow(RangeError);
    await expect(solveLp(model([[0, 1], [0, 2]]))).rejects.toThrow(RangeError);
    await expect(solveLp(model([[0, Infinity]]))).rejects.toThrow(RangeError);
  });
});
