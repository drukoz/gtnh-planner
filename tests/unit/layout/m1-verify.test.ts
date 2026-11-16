// RUK-2621: milestone M1 verification (RUK-2571). The merged M1 tasks promise four things on the standard loss lines:
// the search never keeps a line worse than today's rule (plan Assumption 4), the line a layout reports is the
// candidate the search chose, one `machine_unpowered` warning names every machine the layout counts as unpowered
// (RUK-2617), and laying the same line twice gives the same search, blocks and warnings. These lay real lines through
// `lossLine`; nothing here touches `src/`.
import { describe, it, expect } from 'vitest';
import { replacesBaseline } from '../../../src/server/layout/score.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const COUNTS = [10, 20, 40] as const;
const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

describe('milestone M1 verification', () => {
  it('never keeps a line worse than the baseline', async () => {
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const s = layout.search!;
        if (s.chosen === s.baseline) continue;
        const chosen = s.candidates[s.chosen]!, baseline = s.candidates[s.baseline]!;
        expect(replacesBaseline(chosen, baseline), `${n} ${mode}: replacesBaseline`).toBe(true);
        expect(chosen.unpowered < baseline.unpowered
          || (chosen.total <= baseline.total && chosen.lossEUt <= baseline.lossEUt), `${n} ${mode}: never worse`).toBe(true);
      }
    }
  }, 120_000);

  it('the laid line is the chosen candidate', async () => {
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const chosen = layout.search!.candidates[layout.search!.chosen]!;
        // the laid line's own wiring loss: `totalEUt` minus the hookup's run (the banks' emitters, its cables, the supply run)
        const loss = layout.loss!;
        const wiringEUt = loss.totalEUt - loss.hookupEUt;
        expect(Math.abs((loss.unpowered ?? 0) - chosen.unpowered), `${n} ${mode}: unpowered`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(wiringEUt - chosen.lossEUt), `${n} ${mode}: lossEUt`).toBeLessThanOrEqual(0.01);
      }
    }
  }, 120_000);

  it('names every machine the warning counts', async () => {
    const { layout } = await lossLine(40, 'ae2');
    const warnings = layout.warnings.filter((w) => w.code === 'machine_unpowered');
    expect(warnings.length).toBeGreaterThan(0);
    let named = 0;
    for (const w of warnings) {
      const list = /machines: (.+)\. The farthest gets/.exec(w.text);
      expect(list, `no machine list in: ${w.text}`).not.toBeNull();
      for (const m of list![1]!.matchAll(/(\d+)× /g)) named += Number(m[1]);
    }
    expect(named).toBe(layout.loss?.unpowered ?? 0);
  }, 120_000);

  it('lays the same layout twice', async () => {
    for (const [n, mode] of [[40, 'enderio'], [20, 'routed']] as const) {
      const first = (await lossLine(n, mode)).layout;
      const second = (await lossLine(n, mode)).layout;
      expect(second.search, `${n} ${mode}: search`).toEqual(first.search);
      expect(second.blocks, `${n} ${mode}: blocks`).toEqual(first.blocks);
      expect(second.warnings, `${n} ${mode}: warnings`).toEqual(first.warnings);
    }
  }, 120_000);
});
