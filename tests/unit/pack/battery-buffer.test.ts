// Battery buffer slots on exports made before the exporter fix (plan 10 Task 2, ruling R10): exporter 0.2.0 wrote the
// prototype's battery count, 0 for every buffer, so the loader takes the slot count from the metaName and warns once
// per machine. The lines copy the real 2.9.0-RC-1 export's ids, names, classes and amps.

import { describe, expect, it } from 'vitest';
import type { MachineLine } from '../../../src/server/pack/format.ts';
import { makePack } from '../../helpers/make-pack.ts';

const BUFFER = 'gregtech.api.metatileentity.implementations.MTEBasicBatteryBuffer';
const CHARGER = 'gregtech.common.tileentities.machines.basic.MTECharger';
const TURBO_CHARGER = 'gregtech.common.tileentities.machines.basic.MTETurboCharger';
const TESLA_COIL = 'tectech.thing.metaTileEntity.single.MTETeslaCoil';

/** A battery_buffer line as exporter 0.2.0 wrote it (LV unless `over` says otherwise): amps 0 and 0 slots. */
function line(id: number, name: string, cls: string, over: Partial<MachineLine> = {}): MachineLine {
  return { id, name, cls, dn: 'Low Voltage Battery Buffer', item: null, kind: 'battery_buffer', tier: 1, voltage: 32, amps: 0, batterySlots: 0, ...over };
}

/** The LV 4-slot battery buffer (mID 171). */
const LV_4 = line(171, 'batterybuffer.04.tier.01', BUFFER);

describe('battery buffer slots from old exports', () => {
  it('an LV 4-slot buffer exported with 0 slots loads with 4 and one warning naming it; its amps stay as exported', async () => {
    const pack = await makePack({ machines: [LV_4] });
    expect(pack.machines.get(171)).toMatchObject({ metaName: 'batterybuffer.04.tier.01', kind: 'battery_buffer', tier: 1, batterySlots: 4, amps: 0 });
    expect(pack.warnings).toEqual(['machine 171 (batterybuffer.04.tier.01): the export gives 0 battery slots, using 4 from its name']);
  });

  it('a buffer exported with its slots loads unchanged without a warning', async () => {
    const pack = await makePack({ machines: [{ ...LV_4, amps: 4, batterySlots: 4 }] });
    expect(pack.machines.get(171)).toMatchObject({ batterySlots: 4, amps: 4 });
    expect(pack.warnings).toEqual([]);
  });

  it('takes 1, 9 and 16 slots from buffer names, and 4 for chargers and turbo chargers, whose 16 is not a slot count', async () => {
    const pack = await makePack({
      machines: [
        line(161, 'batterybuffer.01.tier.01', BUFFER),
        line(182, 'batterybuffer.09.tier.02', BUFFER, { dn: 'Medium Voltage Battery Buffer', tier: 2, voltage: 128 }),
        line(193, 'batterybuffer.16.tier.03', BUFFER, { dn: 'High Voltage Battery Buffer', tier: 3, voltage: 512 }),
        line(691, 'batterycharger.16.tier.01', CHARGER, { dn: 'Low Voltage Battery Charger', amps: 2 }),
        line(12041, 'batteryturbocharger.16.tier.01', TURBO_CHARGER, { dn: 'Low Voltage Turbo Charger', amps: 16 }),
      ],
    });
    expect([161, 182, 193, 691, 12041].map((id) => pack.machines.get(id)!.batterySlots)).toEqual([1, 9, 16, 4, 4]);
    expect([691, 12041].map((id) => pack.machines.get(id)!.amps)).toEqual([2, 16]);
    expect(pack.warnings).toEqual([
      'machine 161 (batterybuffer.01.tier.01): the export gives 0 battery slots, using 1 from its name',
      'machine 182 (batterybuffer.09.tier.02): the export gives 0 battery slots, using 9 from its name',
      'machine 193 (batterybuffer.16.tier.03): the export gives 0 battery slots, using 16 from its name',
      'machine 691 (batterycharger.16.tier.01): the export gives 0 battery slots, using 4 from its name',
      'machine 12041 (batteryturbocharger.16.tier.01): the export gives 0 battery slots, using 4 from its name',
    ]);
  });

  it('keeps 0 slots with a warning for a Tesla coil, whose one name covers every size', async () => {
    const pack = await makePack({ machines: [line(16000, 'machine.tt.tesla.01', TESLA_COIL, { dn: 'Basic Tesla Transceiver' })] });
    expect(pack.machines.get(16000)!.batterySlots).toBe(0);
    expect(pack.warnings).toEqual(['machine 16000 (machine.tt.tesla.01): the export gives 0 battery slots and its name does not tell how many, slots unknown']);
  });

  it('leaves a buffer without batterySlots without them, and a line of another kind as it is', async () => {
    const { batterySlots: _slots, ...withoutSlots } = LV_4;
    const pack = await makePack({ machines: [withoutSlots, line(1, 'batterybuffer.04.tier.01', 'x', { kind: 'other' })] });
    expect(pack.machines.get(171)!.batterySlots).toBeUndefined();
    expect(pack.machines.get(1)!.batterySlots).toBe(0);
    expect(pack.warnings).toEqual([]);
  });
});
