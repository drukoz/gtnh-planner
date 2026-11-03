// RUK-112: properties the line loss report must keep on the 12 standard loss lines.
import { describe, it, expect } from 'vitest';
import { deliveredVolts } from '../../../src/server/layout/power.ts';
import { fmtInt } from '../../../src/shared/layout/format.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const COUNTS = [10, 20, 40] as const;
const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

describe('line loss report', () => {
  for (const n of COUNTS) {
    for (const mode of MODES) {
      it(`the ${n}-machine ${mode} line keeps the loss report's five properties`, async () => {
        const line = `${n} ${mode}`;
        const { layout } = await lossLine(n, mode);
        const again = (await lossLine(n, mode)).layout;
        const loss = layout.loss;
        expect(loss, `${line}: loss report`).toBeDefined();
        const tiers = loss!.tiers;
        // 1. the total is the sum of its parts
        const sum = loss!.banksEUt + loss!.hookupEUt + tiers.reduce((s, t) => s + t.lossEUt, 0);
        expect(sum, `${line}: total`).toBe(loss!.totalEUt);
        // 2. tier order: tier descending, two entries (tier 2 then tier 1)
        expect(tiers, `${line}: two tiers`).toHaveLength(2);
        for (let i = 1; i < tiers.length; i++) {
          expect(tiers[i - 1]!.tier, `${line}: tier order`).toBeGreaterThanOrEqual(tiers[i]!.tier);
        }
        // 3. the volts formula
        for (const t of tiers) {
          expect(t.worstVolts, `${line}: tier ${t.tier} volts`)
            .toBe(deliveredVolts(8 * 4 ** t.tier, t.lossPerBlock * t.worstBlocks));
        }
        // 4. the power detail carries the same total
        expect(layout.power, `${line}: power summary`).toBeDefined();
        expect(layout.power!.detail, `${line}: power detail`).toBeDefined();
        expect(layout.power!.detail!, `${line}: detail carries the loss`)
          .toContain(` + ${fmtInt(loss!.totalEUt)} loss)`);
        expect(layout.power!.detail!.endsWith(`; cables and hookup lose ${fmtInt(loss!.totalEUt)} EU/t`), `${line}: detail ends with the loss`)
          .toBe(true);
        // 5. determinism
        expect(JSON.stringify(again), `${line}: deterministic`).toBe(JSON.stringify(layout));
      });
    }
  }
});
