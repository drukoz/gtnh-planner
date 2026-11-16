// RUK-2621 (RUK-2655): the layout search panel on the 12 standard loss lines. The headline prints the laid line's own
// wiring loss (`loss.totalEUt − loss.hookupEUt`), not the search's estimate, and the "The search compared layouts"
// line appears exactly when the two print differently. This is the panel-text half of "the laid line is the chosen
// candidate" from `tests/unit/layout/m1-verify.test.ts`: it lives in the `client` project because that is the only
// vitest project that can import `searchText` from `src/client/views/View3D.tsx`. Nothing here touches `src/`.
import { describe, it, expect } from 'vitest';
import { searchText } from '../../src/client/views/View3D.tsx';
import { fmtInt } from '../../src/shared/layout/format.ts';
import { lossLine } from '../helpers/power-loss.ts';

const COUNTS = [10, 20, 40] as const;
const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

describe('milestone M1 panel text on the loss lines', () => {
  it('the laid line is the chosen candidate', async () => {
    const comparedLines: string[] = [];
    for (const n of COUNTS) {
      for (const mode of MODES) {
        const { layout } = await lossLine(n, mode);
        const chosen = layout.search!.candidates[layout.search!.chosen]!;
        const loss = layout.loss!;
        const wiringEUt = loss.totalEUt - loss.hookupEUt;
        const lines = searchText(layout.search!, layout.loss);
        expect(lines[0], `${n} ${mode}: headline`).toContain(`its wiring loses ${fmtInt(wiringEUt)} EU/t.`);
        const compared = lines.filter((l) => l.startsWith('The search compared layouts')).length;
        expect(compared, `${n} ${mode}: comparison line`).toBe(fmtInt(wiringEUt) !== fmtInt(chosen.lossEUt) ? 1 : 0);
        if (compared === 1) comparedLines.push(`loss-${n} ${mode}`);
      }
    }
    expect(comparedLines.sort()).toEqual(['loss-10 ae2', 'loss-10 enderio', 'loss-20 routed']);
  }, 120_000);
});
