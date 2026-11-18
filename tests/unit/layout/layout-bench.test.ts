// The baseline in `tests/fixtures/layout-bench/baseline.json` may only ever be lowered. Regenerate it only when a
// change makes lines shorter, less lossy or weaker-tier-free, and say in the commit message which rows moved.
//
// A line may get longer, lossier or weaker-tiered only to power machines it could not run (RUK-2571 plan, Assumption 4):
// a row offends when its `routeFailed` or its `unpowered` count rises, and its `total`, `lossEUt` and `weakTiers` only
// while its `unpowered` count stays at the baseline's (RUK-2617).

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
    expect([report.total, report.cable, report.pipe, report.hookup, report.weakTiers]).toEqual([29, 10, 11, 8, []]);
  }, 30_000);

  it("flags the 40-machine AE2 line's LV wiring as weak", async () => {
    // 53 cable blocks of LV to the farthest macerator leave it 1 V: under half of LV's 32 V
    const { layout } = await lossLine(40, 'ae2', { packing: false });
    expect(lengthOf(layout).weakTiers).toEqual([1]);
  }, 30_000);

  it('lays the 40-machine AE2 line packed with no weak tier and no starved machine', async () => {
    // the packed candidate wins the 40-machine AE2 line (spike SP-G): its short cable runs power every machine
    const { layout } = await lossLine(40, 'ae2');
    expect(lengthOf(layout).weakTiers).toEqual([]);
    expect(layout.warnings.filter((w) => w.code === 'machine_unpowered')).toEqual([]);
  }, 30_000);

  it("runs the 40-machine AE2 line's LV wiring with no weak tier once satellites are laid", async () => {
    // satellites step down beside the far machines (RUK-2679): the default line leaves no tier under-volted
    const { layout } = await lossLine(40, 'ae2', { satellites: true });
    expect(lengthOf(layout).weakTiers).toEqual([]);
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
      if (row.routeFailed > base.routeFailed) offenses.push(`${base.name} ${base.mode}: routeFailed ${row.routeFailed} > ${base.routeFailed}`);
      if (row.unpowered > base.unpowered) offenses.push(`${base.name} ${base.mode}: unpowered ${row.unpowered} > ${base.unpowered}`);
      // a line may only get longer, lossier or weaker while it powers no more machines than the baseline did
      if (row.unpowered === base.unpowered) {
        if (row.total > base.total) offenses.push(`${base.name} ${base.mode}: total ${row.total} > ${base.total}`);
        if (row.lossEUt > base.lossEUt + 0.01) offenses.push(`${base.name} ${base.mode}: lossEUt ${row.lossEUt} > ${base.lossEUt}`);
        if (row.weakTiers.length > base.weakTiers.length) offenses.push(`${base.name} ${base.mode}: weakTiers ${row.weakTiers.length} > ${base.weakTiers.length}`);
      }
    }
    expect(offenses, `lines that got worse:\n${offenses.join('\n')}\n\n${benchTable(rows)}`).toEqual([]);
  }, 60_000);
});
