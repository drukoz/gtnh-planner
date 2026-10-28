// tests/unit/layout/feeding/facts.test.ts
import { describe, expect, it } from 'vitest';
import { FEED_GATE_CODES, FEED_KINDS, SCENARIOS } from '../../../../src/server/layout/feeding/contract.ts';
import {
  INPUT_SEPARATION_DEFAULT, basicSlots, benchEnergyCap, conveyorOp, eioDeficit, eioMaxExtracted, ignoredByBlocking, prTravelTicks, stackLimit,
  stockKeeperDelay,
} from '../../../../src/server/layout/feeding/facts.ts';
import { feedPack } from '../../../helpers/feeding-fixtures.ts';

const slots = (metaName: string, tier: number) => basicSlots({ metaName, tier });

describe('feeding facts', () => {
  it('reads the slot table by kind and tier', () => {
    expect(slots('basicmachine.assembler.tier.01', 1)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.assembler.tier.02', 2)).toEqual({ in: 9, out: 1, source: 'table' });
    expect(slots('basicmachine.mixer.tier.04', 4)).toEqual({ in: 9, out: 4, source: 'table' });
    expect(slots('basicmachine.macerator.tier.03', 3)).toEqual({ in: 1, out: 2, source: 'table' });
    expect(slots('basicmachine.press.tier.05', 5)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.laserengraver.tier.04', 4)).toEqual({ in: 4, out: 1, source: 'table' });
    expect(slots('basicmachine.arcfurnace.tier.04', 4)).toEqual({ in: 2, out: 9, source: 'table' });
    expect(slots('basicmachine.circuitassembler.tier.07', 7)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.boxinator.tier.01', 1)).toEqual({ in: 2, out: 1, source: 'table' });
  });

  it('prefers exported slot counts and knows nothing of other machines', () => {
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.02', tier: 2, itemInSlots: 5, itemOutSlots: 2 })).toEqual({ in: 5, out: 2, source: 'export' });
    // exporter 0.6.0 counts a steam machine's slots too (GT's bronze machines are basic machines); the table has no row for one
    expect(basicSlots({ metaName: 'bronzemachine.macerator', tier: 1, itemInSlots: 1, itemOutSlots: 1 })).toEqual({ in: 1, out: 1, source: 'export' });
    // no output slot is still a count; one count alone, or one that is no count of slots, is no export's: the table's then
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.02', tier: 2, itemInSlots: 2, itemOutSlots: 0 })).toEqual({ in: 2, out: 0, source: 'export' });
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.02', tier: 2, itemInSlots: 5 })).toEqual({ in: 9, out: 1, source: 'table' });
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(basicSlots({ metaName: 'basicmachine.assembler.tier.02', tier: 2, itemInSlots: bad, itemOutSlots: 1 })).toEqual({ in: 9, out: 1, source: 'table' });
    }
    expect(slots('cropsnh.seedthing.tier.01', 1)).toBeNull();
    expect(slots('basicmachine.assembler.tier.00', 0)).toBeNull();
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.01', tier: undefined })).toBeNull();
  });

  it('stacks to 64 but for Fluid Packets and GT tools', () => {
    expect(['minecraft:redstone@0', 'ae2fc:fluid_packet@0', 'gregtech:gt.metatool.01@170'].map(stackLimit)).toEqual([64, 1, 1]);
  });

  it('knows what AE2 blocking mode ignores', () => {
    const pack = feedPack();
    const yes = ['gregtech:gt.integrated_circuit@3', 'gregtech:gt.metaitem.01@32301', 'gregtech:gt.metaitem.01@32331', 'gregtech:gt.metaitem.01@32350',
      'gregtech:gt.metaitem.01@32377', 'gregtech:gt.metaitem.01@32398', 'gregtech:gt.metaitem.01@32399', 't:lens@0',
      'miscutils:MU-metaitem.01@32140', 'dreamcraft:ReinforcedGlassLense@0', 'dreamcraft:ChromaticLens@0', 'bartworks:gt.bwMetaGeneratedlens@4',
      'appliedenergistics2:item.ItemMultiMaterial@13', 'appliedenergistics2:item.ItemMultiMaterial@19', 'appliedenergistics2:item.ItemMultiMaterial@21',
      'AWWayofTime:weakBloodOrb@0', 'AWWayofTime:transcendentBloodOrb@0', 'Avaritia:Orb_Armok@0', 'TwilightForest:item.trophy@2'];
    const no = ['gregtech:gt.metaitem.01@32300', 'gregtech:gt.metaitem.01@32332', 'gregtech:gt.metaitem.01@32349', 'gregtech:gt.metaitem.01@32378', 't:a@0',
      'miscutils:MU-metaitem.01@32142', 'appliedenergistics2:item.ItemMultiMaterial@20', 'appliedenergistics2:item.ItemMultiMaterial@22'];
    expect(yes.map((k) => ignoredByBlocking(pack, k))).toEqual(yes.map(() => true));
    expect(no.map((k) => ignoredByBlocking(pack, k))).toEqual(no.map(() => false));
  });

  it('knows which controllers start with Input Separation on', () => {
    expect(INPUT_SEPARATION_DEFAULT.size).toBe(69);
    expect(['MTEElectricBlastFurnace', 'MTEPyrolyseOven', 'MTEIndustrialMixer', 'MTEIndustrialCentrifuge', 'MTEAdvEBF', 'MTEMegaChemicalReactor',
      'MTEExoFoundry', 'MTEPlasmaModule'].map((c) => INPUT_SEPARATION_DEFAULT.has(c))).toEqual(Array(8).fill(true));
    expect(['MTEVacuumFreezer', 'MTEDistillationTower', 'MTELargeChemicalReactor', 'MTECircuitAssemblyLine', 'MTECokeOven']
      .map((c) => INPUT_SEPARATION_DEFAULT.has(c))).toEqual(Array(5).fill(false));
  });

  it('gives covers, conduit faces, payloads, stock keepers and benches their rates', () => {
    expect([32630, 32631, 32632, 32633, 32634, 32635, 32636].map((m) => conveyorOp(`gregtech:gt.metaitem.01@${m}`))).toEqual([
      { tier: 1, tickRate: 100, stacks: 1, items: 16 }, { tier: 2, tickRate: 100, stacks: 1, items: 64 }, { tier: 3, tickRate: 20, stacks: 1, items: 64 },
      { tier: 4, tickRate: 4, stacks: 1, items: 64 }, { tier: 5, tickRate: 1, stacks: 1, items: 64 }, { tier: 6, tickRate: 1, stacks: 4, items: 64 },
      { tier: 7, tickRate: 1, stacks: 16, items: 64 }]);
    expect(conveyorOp('t:x@0')).toBeNull();
    expect([0, 1, 3, 15, 20].map(eioMaxExtracted)).toEqual([4, 8, 16, 64, 64]);
    expect([[4, 4], [1, 4], [3, 8], [3, 12], [12, 12]].map(([n, m]) => eioDeficit(n!, m!))).toEqual([10, 3, 4, 3, 10]);
    expect(([[3, 'passive'], [3, 'active_broadcast'], [1, 'wandering'], [0, 'passive'], [7, 'default']] as const).map(([h, p]) => prTravelTicks(h, p)))
      .toEqual([20, 14, 40, 5, 80]);
    expect([0, 1, 120, 200].map(stockKeeperDelay)).toEqual([100, 110, 1300, 1300]);
    expect([1, 2, 3].map(benchEnergyCap)).toEqual([2048, 32768, 786432]);
  });

  it('names a kind for every code and gates the research acceptance', () => {
    expect(FEED_GATE_CODES).toEqual(['feed_crowded', 'feed_bench_eject', 'feed_bench_delete', 'feed_bench_stuck', 'feed_no_route', 'feed_pool_starve',
      'feed_fluid_packet', 'feed_pattern_unencodable', 'feed_starved']);
    expect(Object.keys(FEED_KINDS)).toHaveLength(13);
    expect(new Set(Object.values(FEED_KINDS))).toEqual(new Set(['overfill', 'deadlock', 'livelock', 'starvation', 'deletion']));
    expect(SCENARIOS).toEqual(['steady', 'fast_supplier', 'late_input', 'restart', 'multistack_on']);
  });
});
