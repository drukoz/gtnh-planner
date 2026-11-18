// RUK-3057 (RUK-2571): the unit-order search. `reorderSwapCap` bounds the swap pass by the work it lays, and the swapped
// line is kept only when it beats the line `layoutLine` would otherwise keep: `mixed-01` direct takes it, `fluid-02` and
// `mixed-14` direct keep M3's stacked line (the swapped one is shorter, `lossier` by more than the blocks it saves).
import { describe, it, expect } from 'vitest';
import { layoutLine, reorderSwapCap } from '../../../src/server/layout/layout.ts';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import { benchLines, lengthOf } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';

describe('reorderSwapCap (RUK-3057)', () => {
  it('bounds the swap pass by the machines it may lay', () => {
    expect([0, 1, 10, 20, 21, 40, 80, 160, 161].map(reorderSwapCap)).toEqual([0, 8, 8, 8, 7, 4, 2, 1, 0]);
  });
});

describe('the unit-order search (RUK-3057)', () => {
  const line = (name: string) => benchLines().find((l) => l.name === name)!;

  it('keeps a reordered line for mixed-01 in direct', async () => {
    const l = line('mixed-01');
    const layout = await layoutLine(layoutPack(), l.plan, l.scan('direct'), makeProject({ logistics: 'direct' }), l.deps);
    const search = layout.search!;
    expect(search.candidates[search.chosen]!.kind).toBe(CandidateKind.Reordered);
    expect(lengthOf(layout).total).toBe(35);
    expect(lengthOf(layout).lossEUt).toBe(335);
  }, 30_000);

  it('keeps M3\'s stacked line over the shorter, lossier reordered one for fluid-02 in direct', async () => {
    const l = line('fluid-02');
    const layout = await layoutLine(layoutPack(), l.plan, l.scan('direct'), makeProject({ logistics: 'direct' }), l.deps);
    const search = layout.search!;
    expect(search.candidates[search.chosen]!.kind).toBe(CandidateKind.Stacked);
    expect(search.rejected).toBeDefined();
    expect(search.candidates[search.rejected!]!.kind).toBe(CandidateKind.Reordered);
    expect(lengthOf(layout).total).toBe(71);
    expect(lengthOf(layout).lossEUt).toBe(441);
  }, 30_000);

  it('keeps M3\'s stacked line over the reordered one for mixed-14 in direct', async () => {
    const l = line('mixed-14');
    const layout = await layoutLine(layoutPack(), l.plan, l.scan('direct'), makeProject({ logistics: 'direct' }), l.deps);
    const search = layout.search!;
    expect(search.candidates[search.chosen]!.kind).toBe(CandidateKind.Stacked);
    expect(search.rejected).toBeDefined();
    expect(search.candidates[search.rejected!]!.kind).toBe(CandidateKind.Reordered);
    expect(lengthOf(layout).total).toBe(37);
    expect(lengthOf(layout).lossEUt).toBe(286);
  }, 30_000);
});
