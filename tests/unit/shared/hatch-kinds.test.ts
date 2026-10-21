import { describe, expect, it } from 'vitest';
import { EXPORT_HATCH_CLASSES, EXPORT_HATCH_KINDS, EXPORT_HATCH_KIND_NAMES, exportKindOfClass, isExportHatchKind } from '../../../src/shared/gt/hatch-kinds.ts';

describe('export hatch kinds', () => {
  it('lists the 17 kinds of exporter 0.6.0 in their order, each with a name', () => {
    expect(EXPORT_HATCH_KINDS).toEqual(['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'energy_multi', 'energy_laser',
      'maintenance', 'muffler', 'dynamo', 'dynamo_multi', 'dynamo_laser', 'steam_input_bus', 'steam_output_bus', 'steam_hatch', 'data_access', 'coke_oven_hatch']);
    for (const k of EXPORT_HATCH_KINDS) expect(EXPORT_HATCH_KIND_NAMES[k]).toMatch(/\S/);
    expect(isExportHatchKind('steam_hatch')).toBe(true);
    expect(isExportHatchKind('quantum_hatch')).toBe(false);
  });

  it('finds the kind of a hatch by its class, and the steam hatch also by its name', () => {
    expect(exportKindOfClass('MTEHatchInputBus', 'hatch.input_bus.tier.01')).toBe('input_bus');
    expect(exportKindOfClass('MTEHatchMuffler', 'hatch.muffler.tier.09')).toBe('muffler');
    expect(exportKindOfClass('MTEHatchCustomFluidBase', 'hatch.steam.input.tier.00')).toBe('steam_hatch');
    expect(exportKindOfClass('MTEHatchCustomFluidBase', 'hatch.cryotheum.input.tier.00')).toBeNull();
    expect(exportKindOfClass('MTEHatchInputBusME', 'hatch.input_bus.me')).toBeNull();
    expect(EXPORT_HATCH_CLASSES.steam_hatch).toEqual({ cls: 'MTEHatchCustomFluidBase', metaPrefix: 'hatch.steam.' });
    expect(EXPORT_HATCH_CLASSES.coke_oven_hatch).toEqual({ cls: 'MTEHatchCokeOven' });
  });

  it('probes multi-amp dynamos with a 16 A hatch, which the plain dynamo adder refuses', () => {
    expect(EXPORT_HATCH_CLASSES.dynamo_multi).toEqual({ cls: 'MTEHatchDynamoMulti', metaPrefix: 'hatch.dynamomulti16.' });
    expect(exportKindOfClass('MTEHatchDynamoMulti', 'hatch.dynamomulti16.tier.05')).toBe('dynamo_multi');
    expect(exportKindOfClass('MTEHatchDynamoMulti', 'hatch.dynamomulti04.tier.05')).toBeNull();
    expect(exportKindOfClass('MTEHatchEnergyMulti', 'hatch.energymulti04.tier.05')).toBe('energy_multi');
    expect(EXPORT_HATCH_KIND_NAMES.dynamo_multi).toContain('16 A');
  });
});
