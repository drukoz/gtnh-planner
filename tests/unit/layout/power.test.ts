import { describe, it, expect } from 'vitest';
import { tierGroups, transformerStages, lineLossEUt, fitPower, generatorSuggestion, LOSS_WARN_FRACTION, bankLossEUt, deliveredVolts, hookupAllowanceVolts,
} from '../../../src/server/layout/power.ts';
import { gtMachineId } from '../../../src/shared/ids.ts';
import { layoutPack } from '../../helpers/layout-fixtures.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import type { LayoutPowerContext } from '../../../src/shared/types/layout.ts';
import type { PlanContext, PowerSummary } from '../../../src/shared/types/plan.ts';

const power: PowerSummary = { peakEUt: 60, averageEUt: 50, voltageTier: 1, amps: 2 };
// `rainEUt` is not part of Plan 2's `PlanContext.power` (ruling R2), so the power object is built as a `LayoutPowerContext`.
const ctx = (p: Partial<LayoutPowerContext>): PlanContext => {
  const contextPower: LayoutPowerContext = { averageEUt: 200, spareEUt: 120, voltageTier: 1, storedEU: 1_000_000, rainOutageSeconds: 480, rainEUt: 80, ...p };
  return { ...emptyContext(), power: contextPower };
};
const why = (s: string) => `optional: covers a ${s} EU/t power shortfall`;

describe('power rules', () => {
  it('groups machines by tier and counts amps per machine', () => {
    expect(tierGroups([{ tier: 1, euPerTick: 30 }, { tier: 2, euPerTick: 120 }, { tier: 1, euPerTick: 40 }])).toEqual([
      { tier: 2, euPerTick: [120], peakEUt: 120, amps: 1 },
      { tier: 1, euPerTick: [30, 40], peakEUt: 70, amps: 3 },
    ]);
  });

  it('steps down one tier per transformer bank and never feeds a machine above its tier', () => {
    const groups = tierGroups([{ tier: 1, euPerTick: 30 }, { tier: 1, euPerTick: 30 }, { tier: 2, euPerTick: 120 }]);
    expect(transformerStages(groups, 2)).toEqual({ supplyTier: 2, supplyAmps: 2, lossEUt: 2, under: [],
      stages: [{ fromTier: 2, toTier: 1, count: 1, ampsIn: 1, ampsOut: 2 }] });
    const six = tierGroups(Array.from({ length: 6 }, () => ({ tier: 1, euPerTick: 30 })));
    expect(transformerStages(six, 3)).toEqual({ supplyTier: 3, supplyAmps: 1, lossEUt: 10, under: [],
      stages: [{ fromTier: 3, toTier: 2, count: 1, ampsIn: 1, ampsOut: 2 }, { fromTier: 2, toTier: 1, count: 2, ampsIn: 2, ampsOut: 6 }] });
    const low = transformerStages(groups, 1);
    expect(low.stages).toEqual([]);
    expect(low.under.map((g) => g.tier)).toEqual([2]);
    expect(low.supplyAmps).toBe(6);              // two LV machines at 1 A, the MV machine pulls ceil(120 / 32) = 4 A at LV
    expect(lineLossEUt(2, 15, 1)).toBe(30);
    expect(LOSS_WARN_FRACTION).toBe(0.1);
  });

  it('fits when the spare covers the line and the buffers cover a rain outage', () => {
    const fit = fitPower({ power, ctx: ctx({}), extraLossEUt: 4, pack: layoutPack(), tier: 1 });
    expect(fit.power).toEqual({ ...power, fits: 'yes', suggestions: [],
      detail: 'Needs 54 EU/t on average (50 + 4 loss); 120 EU/t spare; buffers hold 1,000,000 EU, rain needs 518,400 EU' });
    expect(fit.optional).toEqual([]);
    expect(fitPower({ power, ctx: ctx({ rainOutageSeconds: 0 }), extraLossEUt: 4, pack: layoutPack(), tier: 1 }).power.detail)
      .toBe('Needs 54 EU/t on average (50 + 4 loss); 120 EU/t spare');
  });

  it('is tight when the buffers cannot ride out rain, and suggests storage', () => {
    const fit = fitPower({ power, ctx: ctx({ storedEU: 100_000 }), extraLossEUt: 4, pack: layoutPack(), tier: 1 });
    expect(fit.power.fits).toBe('tight');
    expect(fit.power.suggestions).toEqual(['Add battery storage: about 418,400 EU more to ride out 8 min of rain']);
  });

  it("counts the base's own load against the buffers during rain", () => {
    // base load = 200 − 120 = 80 EU/t; nothing generates in rain → (54 + 80) × 20 × 480
    const fit = fitPower({ power, ctx: ctx({ rainEUt: 0 }), extraLossEUt: 4, pack: layoutPack(), tier: 1 });
    expect(fit.power.fits).toBe('tight');
    expect(fit.power.detail).toBe('Needs 54 EU/t on average (50 + 4 loss); 120 EU/t spare; buffers hold 1,000,000 EU, rain needs 1,286,400 EU');
    expect(fitPower({ power, ctx: ctx({ rainEUt: 500 }), extraLossEUt: 4, pack: layoutPack(), tier: 1 }).power.detail)
      .toContain('rain needs 0 EU');                // rain generation covers base and line
  });

  it('does not fit when the spare is short, and suggests boilers and turbines of the network tier', () => {
    const fit = fitPower({ power, ctx: ctx({ spareEUt: 20 }), extraLossEUt: 4, pack: layoutPack(), tier: 1 });
    expect(fit.power.fits).toBe('no');
    expect(fit.power.suggestions).toEqual(['Add about 6× High Pressure Solar Boiler and 2× Basic Steam Turbine to cover 34 EU/t']);
    expect(fit.optional).toEqual([
      { key: 'gregtech:gt.blockmachines@114', amount: 6, why: why('34'), group: 'power' },
      { key: 'gregtech:gt.blockmachines@1120', amount: 2, why: why('34'), group: 'power' },
    ]);
  });

  it('suggests another generator when the pack has no turbine at that tier', () => {
    const pack = layoutPack();
    pack.machines.delete(1121);                                       // the MV turbine
    pack.machines.set(1111, { id: gtMachineId(1111), mteId: 1111, metaName: 'generator.combustion.tier.02', name: 'Advanced Combustion Generator',
      cls: 'gregtech.common.tileentities.generators.MTEDieselGenerator', itemKey: 'gregtech:gt.blockmachines@1111', kind: 'generator', tier: 2, voltage: 128, amps: 1, maps: [] });
    expect(generatorSuggestion(pack, 300, 2)).toEqual({ text: 'Add about 3× Advanced Combustion Generator to cover 300 EU/t',
      lines: [{ key: 'gregtech:gt.blockmachines@1111', amount: 3, why: why('300'), group: 'power' }] });   // ceil(300 / (128 × 1))
  });

  it('says so when the base has no power network', () => {
    const fit = fitPower({ power, ctx: emptyContext(), extraLossEUt: 4, pack: layoutPack(), tier: 1 });
    expect(fit.power.fits).toBe('no');
    expect(fit.power.detail).toBe('No power network found at this base; the line needs 54 EU/t on average');
    expect(fit.power.suggestions).toEqual(['Add about 9× High Pressure Solar Boiler and 2× Basic Steam Turbine to cover 54 EU/t']);
    expect(generatorSuggestion(layoutPack(), 100, 7)).toEqual({ text: 'Add generators for about 100 EU/t at ZPM', lines: [] });
  });
});

// Final review I4: machines and banks counted at the volts they get after cable loss (gt-mechanics §3.1, §3.3).
describe('power rules: sized for the volts that arrive', () => {
  it('counts each machine at its delivered volts and each bank at the volts it takes in', () => {
    // 30 EU/t at 32 V is 1 A; at 28 V (4 V lost) it is 2 A
    expect(tierGroups([{ tier: 1, euPerTick: 30, lossVolts: 4 }, { tier: 1, euPerTick: 30 }])).toEqual([
      { tier: 1, euPerTick: [30, 30], peakEUt: 60, amps: 3, lossVolts: [4, 0] }]);
    const groups = tierGroups([{ tier: 1, euPerTick: 30, lossVolts: 4 }, { tier: 1, euPerTick: 30, lossVolts: 4 }, { tier: 2, euPerTick: 120, lossVolts: 14 }]);
    // the bank gives 4 A at LV (+1 EU each) and takes them at 128 − 3 = 125 V: ceil(4 × 33 / 125) = 2 A
    expect(transformerStages(groups, 2, (fromTier) => (fromTier === 2 ? 3 : 0))).toEqual({ supplyTier: 2, supplyAmps: 4, lossEUt: 4,
      under: [], stages: [{ fromTier: 2, toTier: 1, count: 1, ampsIn: 2, ampsOut: 4 }] });
    // a machine above the supply tier draws from the supply run at the supply volts less its own loss: 120 / (32 − 7) → 5 A
    const low = transformerStages(tierGroups([{ tier: 2, euPerTick: 120, lossVolts: 7 }]), 1);
    expect(low.supplyAmps).toBe(5);
    expect(deliveredVolts(32, 40)).toBe(1);                                         // never below 1 V
    expect([hookupAllowanceVolts(1), hookupAllowanceVolts(2)]).toEqual([3.2, 12.8]);
    expect(bankLossEUt([{ fromTier: 3, toTier: 2, count: 1, ampsIn: 1, ampsOut: 2 }, { fromTier: 2, toTier: 1, count: 2, ampsIn: 2, ampsOut: 6 }])).toBe(10);
  });
});
