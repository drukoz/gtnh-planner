// The baseline in `tests/fixtures/layout-bench/baseline.json` may only ever be lowered. Regenerate it only when a
// change makes lines shorter, less lossy or weaker-tier-free, and say in the commit message which rows moved.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { benchTable, lengthOf, runBench, type LengthReport } from '../../helpers/layout-bench.ts';
import { lossLine } from '../../helpers/power-loss.ts';

const BASELINE = fileURLToPath(new URL('../../fixtures/layout-bench/baseline.json', import.meta.url));
const baseline = (): LengthReport[] => JSON.parse(readFileSync(BASELINE, 'utf8')) as LengthReport[];

describe('layout benchmark', () => {
  it('measures the 10-machine direct loss line', async () => {
    const { layout } = await lossLine(10, 'direct');
    const report = lengthOf(layout);
    expect([report.total, report.cable, report.pipe, report.hookup, report.weakTiers]).toEqual([35, 20, 6, 9, []]);
  }, 30_000);

  it("flags the 40-machine AE2 line's LV wiring as weak", async () => {
    // 53 cable blocks of LV to the farthest macerator leave it 1 V: under half of LV's 32 V
    const { layout } = await lossLine(40, 'ae2');
    expect(lengthOf(layout).weakTiers).toEqual([1]);
  }, 30_000);

  it('lays every benchmark line deterministically', async () => {
    const rows = await runBench();
    expect(rows).toEqual(await runBench());
    expect(rows.length).toBe(132);
  }, 60_000);

  it('no benchmark line gets longer, lossier or weaker than the baseline', async () => {
    const rows = await runBench();
    const at = new Map(rows.map((r) => [`${r.name} ${r.mode}`, r]));
    const offenses: string[] = [];
    for (const base of baseline()) {
      const row = at.get(`${base.name} ${base.mode}`);
      if (row === undefined) {
        offenses.push(`${base.name} ${base.mode}: missing`);
        continue;
      }
      if (row.total > base.total) offenses.push(`${base.name} ${base.mode}: total ${row.total} > ${base.total}`);
      if (row.lossEUt > base.lossEUt + 0.01) offenses.push(`${base.name} ${base.mode}: lossEUt ${row.lossEUt} > ${base.lossEUt}`);
      if (row.weakTiers.length > base.weakTiers.length) offenses.push(`${base.name} ${base.mode}: weakTiers ${row.weakTiers.length} > ${base.weakTiers.length}`);
      if (row.routeFailed > base.routeFailed) offenses.push(`${base.name} ${base.mode}: routeFailed ${row.routeFailed} > ${base.routeFailed}`);
    }
    expect(offenses, `lines that got worse:\n${offenses.join('\n')}\n\n${benchTable(rows)}`).toEqual([]);
  }, 60_000);
});
