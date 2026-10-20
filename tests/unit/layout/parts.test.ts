import { describe, it, expect } from 'vitest';
import { resolveParts, PART_DEFS, pickCable, pickItemPipe, pickFluidPipe, pickTransformer, pickHatch, machineRef,
  pickConveyor, pickPump, coverRateWarning, ae2IdleEUt } from '../../../src/server/layout/parts.ts';
import { fmtRate, joinNames } from '../../../src/shared/layout/format.ts';
import { layoutPack, IDS, emptyPack, addLineParts } from '../../helpers/layout-fixtures.ts';
import type { LayoutBlock } from '../../../src/shared/types/layout.ts';

describe('parts', () => {
  it('resolves parts by key, then by English name, else marks them missing', () => {
    const parts = resolveParts(layoutPack());
    expect(parts.conveyor_cover).toEqual({ id: 'conveyor_cover', key: 'gregtech:gt.metaitem.01@32630', name: 'Conveyor Module (LV)',
      block: { id: 'gregtech:gt.metaitem.01', meta: 32630 }, found: true });
    expect(parts.pr_interface.block).toEqual({ id: 'fmp:pr_rinterface', meta: 0 });
    expect(parts.me_cable.block).toEqual({ id: 'ae2cable:glass', meta: 0 });
    expect(parts.chest.block).toEqual({ id: 'minecraft:chest', meta: 0 });
    const renamed = emptyPack();
    renamed.items.set('mod:conveyor@7', { key: 'mod:conveyor@7', id: 'mod:conveyor', meta: 7, name: 'conveyor module (lv) ', oreDict: [] });
    expect(resolveParts(renamed).conveyor_cover).toMatchObject({ key: 'mod:conveyor@7', found: true });
    expect(resolveParts(emptyPack()).pump_cover).toMatchObject({ key: 'gregtech:gt.metaitem.01@32610', name: 'Electric Pump (LV)', found: false });
    expect(parts.item_filter_cover).toMatchObject({ key: 'gregtech:gt.metaitem.01@32270', name: 'Filtered Conveyor Cover (Export)' });
    expect(parts.eio_item_conduit.block).toEqual({ id: 'conduit:item', meta: 0 });
    expect(Object.keys(PART_DEFS)).toHaveLength(27);
  });

  it('picks the smallest pump cover that carries the flow', () => {
    const pack = layoutPack();
    expect(pickPump(pack, 600, 2)).toEqual({ key: 'gregtech:gt.metaitem.01@32610', name: 'Electric Pump (LV)', tier: 1, perSecond: 640, short: false, found: true });
    expect(pickPump(pack, 1000, 2)).toMatchObject({ key: 'gregtech:gt.metaitem.01@32611', perSecond: 2560, short: false });
    expect(pickPump(pack, 1000, 1)).toMatchObject({ key: 'gregtech:gt.metaitem.01@32610', short: true });
    expect(pickPump(pack, 9000, 3)).toMatchObject({ key: 'gregtech:gt.metaitem.01@32611', short: true });   // no HV pump in this pack
    expect(pickConveyor(pack, 0.5, 1)).toMatchObject({ name: 'Conveyor Module (LV)', perSecond: 3.2, short: false });
    expect(pickConveyor(pack, 5, 2)).toMatchObject({ name: 'Conveyor Module (MV)', perSecond: 12.8, short: false });
    expect(pickConveyor(emptyPack(), 1, 3)).toMatchObject({ key: 'gregtech:gt.metaitem.01@32630', found: false, short: false });
    expect(coverRateWarning('pump', pickPump(pack, 1000, 1), 1000, 1, 'Basic Fluid Extractor', 'x')).toEqual({ code: 'cover_rate', stepId: 'x',
      text: 'No pump cover up to LV moves 1,000 L/s out of Basic Fluid Extractor: the Electric Pump (LV) moves 640 L/s, so the line runs slower' });
    expect([fmtRate(0.5), fmtRate(3.2), fmtRate(1000), joinNames(['A', 'B', 'C'])]).toEqual(['0.5', '3.2', '1,000', 'A, B and C']);
  });

  it('counts the idle draw of placed ME parts in EU/t', () => {
    const pack = layoutPack();
    const parts = resolveParts(pack);
    const at = (x: number, item: string, role: LayoutBlock['role'] = 'interface'): LayoutBlock =>
      ({ pos: [x, 0, 0], block: { id: 'x', meta: 0 }, role, label: 'x', item });
    expect(ae2IdleEUt([at(0, parts.me_interface.key), at(1, parts.me_cable.key, 'pipe'), at(2, parts.me_interface.key),
      at(3, parts.me_export_bus.key), at(4, parts.me_interface.key, 'ghost'), at(5, parts.chest.key, 'chest')], parts)).toBe(1.5);
  });

  it('chooses the insulated cable with the least loss that carries the volts and amps', () => {
    const pack = layoutPack();
    expect(pickCable(pack, { volts: 32, amps: 2 })).toMatchObject({ cable: { mteId: IDS.TIN_2X }, ampsShort: false });
    expect(pickCable(pack, { volts: 128, amps: 1 })).toMatchObject({ cable: { mteId: IDS.ANNEALED_1X }, ampsShort: false });
    expect(pickCable(pack, { volts: 512, amps: 5 })).toMatchObject({ cable: { mteId: IDS.SILVER_2X }, ampsShort: true });
    expect(pickCable(pack, { volts: 2048, amps: 1 })).toBeNull();
    expect(machineRef(pack.machines.get(IDS.TIN_1X)!)).toEqual({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.TIN_1X });
  });

  it('chooses pipes, transformers and hatches', () => {
    const pack = layoutPack();
    expect(pickItemPipe(pack, 0.5)!.mteId).toBe(IDS.TIN_ITEM_PIPE);
    expect(pickItemPipe(pack, 1.5)!.mteId).toBe(IDS.BRASS_ITEM_PIPE);
    expect(pickItemPipe(pack, 9)!.mteId).toBe(IDS.BRASS_ITEM_PIPE);
    expect(pickFluidPipe(pack, 600)!.mteId).toBe(IDS.BRONZE_PIPE);
    expect(pickTransformer(pack, 1)!.mteId).toBe(IDS.TRANSFORMER_LV);
    expect(pickTransformer(pack, 7)).toBeNull();
    expect(pickHatch(pack, 'MTEHatchEnergy', 2)!.mteId).toBe(IDS.ENERGY_MV);
    expect(pickHatch(pack, 'MTEHatchInputBus', null)!.mteId).toBe(IDS.INPUT_BUS_ULV);
    expect(pickHatch(pack, 'MTEHatchInputBus', null, { slots: 1 })!.mteId).toBe(IDS.INPUT_BUS_ULV);
    expect(pickHatch(pack, 'MTEHatchInputBus', null, { slots: 2 })!.mteId).toBe(IDS.INPUT_BUS_LV);   // ULV has 1 slot, LV 4
    expect(pickHatch(pack, 'MTEHatchInput', null)!.mteId).toBe(IDS.INPUT_HATCH);
    expect(pickHatch(pack, 'MTEHatchInput', null, { litres: 20_000 })!.mteId).toBe(IDS.INPUT_HATCH);   // the LV hatch (16,000 L) is the biggest
    expect(pickItemPipe(emptyPack(), 1)).toBeNull();
    expect(pickItemPipe(addLineParts(emptyPack()), 1)!.mteId).toBe(IDS.TIN_ITEM_PIPE);
  });
});
