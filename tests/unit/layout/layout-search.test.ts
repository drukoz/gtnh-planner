// RUK-2618: a line is now laid as a scored search (RUK-2571). `buildLocal` lays exactly the lines today's rule laid,
// scores each, keeps that rule's line as the `baseline`, and only lets a candidate take its place when it
// `replacesBaseline`s it — so the chosen line is never worse than today's. `layoutLine` reports every candidate's score
// in `Layout.search`. These tests lay the 12 standard lines and check the search is honest: the west head is laid first,
// the chosen line is the baseline unless a candidate truly replaces it, the chosen candidate's score matches what the
// layout reports, the search is deterministic, and one candidate is laid per head split.
import { describe, it, expect } from 'vitest';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import { headSplits } from '../../../src/server/layout/layout.ts';
import { replacesBaseline } from '../../../src/server/layout/score.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const COUNTS = [10, 20, 40] as const;
const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

describe('the layout search', () => {
  it('puts the west-head line first', async () => {
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const first = layout.search!.candidates[0]!;
        expect(first.kind, `${n} ${mode}: first kind`).toBe(CandidateKind.WestHead);
        expect(first.westUnits, `${n} ${mode}: first westUnits`).toBe(0);
      }
    }
  }, 60_000);

  it("never chooses a line worse than today's rule's", async () => {
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const { candidates, chosen, baseline } = layout.search!;
        expect(chosen === baseline || replacesBaseline(candidates[chosen]!, candidates[baseline]!), `${n} ${mode}: chosen`).toBe(true);
      }
    }
  }, 60_000);

  it("records the chosen candidate's score", async () => {
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const { candidates, chosen } = layout.search!;
        expect(candidates[chosen]!.unpowered, `${n} ${mode}: unpowered`).toBe(layout.loss?.unpowered ?? 0);
      }
    }
  }, 60_000);

  it('lays the same search twice', async () => {
    const first = (await lossLine(40, 'ae2')).layout.search!;
    const second = (await lossLine(40, 'ae2')).layout.search!;
    expect(second).toEqual(first);
  }, 60_000);

  it('lays one candidate per head split when the line loses something', async () => {
    const { layout } = await lossLine(40, 'ae2');
    const { candidates } = layout.search!;
    expect(candidates.length).toBe(1 + headSplits(40).length);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.kind, `candidate ${i}: kind`).toBe(CandidateKind.MiddleHead);
    }
  }, 60_000);
});
