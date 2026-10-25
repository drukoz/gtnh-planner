import { describe, expect, it } from 'vitest';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { emptyFacts, ENERGY_HATCH_RE, packFacts, simpleClassName } from '../../../src/server/world/facts.ts';
import {
  classifyGtMachine, classifyGtPipe, countsForTopTier, TIER_KINDS, toPlacedMachine, toPlacedPipe, voltageTier,
} from '../../../src/server/world/classify/gt.ts';
import { classifyGtStorage, GT_CHEST_IDS, GT_TANK_IDS } from '../../../src/server/world/classify/gtchests.ts';
import type { RawTe, Vec3 } from '../../../src/server/world/model.ts';
import { DEFAULT_ITEM_IDS } from '../../helpers/make-world.ts';
import { byte, comp, double, int, list, long, parseTag, str, type Tag } from '../../helpers/nbt-write.ts';
import { packWithout, testFacts, testPack } from '../../helpers/world-facts.ts';
import { gtMachine, gtPipe, stack, stackFields } from '../../helpers/world-tes.ts';

const itemNames = new Map(Object.entries(DEFAULT_ITEM_IDS).map(([name, id]) => [id, name]));
const P: Vec3 = [-1, 64, -17];

/** A whitelisted TE as the chunk pass hands it over: dim 0, the compound's own id and position. */
function raw(t: Tag): RawTe {
  const nbt = parseTag(t);
  const { id, x, y, z } = nbt;
  if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') throw new TypeError('not a TE compound');
  return { dim: 0, id, x, y, z, nbt };
}

const facts = testFacts();

it('classifies a basic machine with facing, colour, tier and running recipe', () => {
  const r = classifyGtMachine(raw(gtMachine({ pos: [-3, 70, 5], mID: 2002, facing: 5, mainFacing: 3, color: 4, storedEU: 1000,
    extra: { mEUt: int(30), mMaxProgresstime: int(200) } })), facts, itemNames);
  expect(r).toMatchObject({ pos: [-3, 70, 5], mteId: 2002, facing: 5, mainFacing: 3, color: 4, storedEU: 1000, works: true,
    kind: 'basic', tier: 2, name: 'Advanced Assembler', recipeEUt: 30, running: true, multiblock: false });
});
it('reads mWorks inverted', () => expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 21, works: false })), facts, itemNames).works).toBe(false));
it('keeps unknown mIDs as unknown', () => {
  const r = classifyGtMachine(raw(gtMachine({ pos: P, mID: 31999 })), facts, itemNames);
  expect([r.kind, r.tier, r.name, countsForTopTier(r), toPlacedMachine(r, null).kind]).toEqual(['unknown', null, null, false, 'unknown']);
});
it('detects a multiblock by its maintenance keys when the export does not know the id', () => {
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 31998, extra: { mWrench: byte(1), mCrowbar: byte(1) } })), facts, itemNames).multiblock).toBe(true);
});
it('reads boiler calcification and temperature', () => {
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 114, extra: { mRunTime: int(1_440_000), mTemperature: int(500) } })), facts, itemNames).boiler)
    .toEqual({ runTime: 1_440_000, temperature: 500 });
});
it('reads battery charge from GT and IC2 tags', () => {
  const inv = list('compound', [
    comp({ IntSlot: int(0), ...stackFields(5000, 1, 32539), tag: comp({ 'GT.ItemCharge': long(1_600_000n) }) }),
    comp({ IntSlot: int(1), ...stackFields(5000, 1, 32540), tag: comp({ charge: double(10_000) }) }) ]);
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 193, extra: { Inventory: inv } })), facts, itemNames).batteries).toEqual([
    { key: 'gregtech:gt.metaitem.01@32539', charge: 1_600_000 }, { key: 'gregtech:gt.metaitem.01@32540', charge: 10_000 }]);
});
it('classifies pipes by export kind, else by NBT keys', () => {
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 1246, connections: 48, kind: 'cable' })), facts))
    .toMatchObject({ pipeKind: 'cable', connections: 48, cable: { voltage: 32, amps: 1, loss: 1 }, voltageTier: 1 });
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30001, connections: 3, kind: 'fluid' })), facts).pipeKind).toBe('fluid');
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30002, connections: 3, kind: 'item' })), facts).pipeKind).toBe('item');
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30003, connections: 3, kind: 'cable' })), facts)).toMatchObject({ pipeKind: 'cable', voltageTier: undefined });
});
it('counts a quantum chest as stored item × (mItemCount + slots 0 and 1)', () => {
  const s = classifyGtStorage(raw(gtMachine({ pos: P, mID: 125, extra: { mItemStack: stack(265, 1), mItemCount: int(1_000_000),
    Inventory: list('compound', [comp({ IntSlot: int(0), ...stackFields(265, 64) }), comp({ IntSlot: int(1), ...stackFields(265, 10) })]) } })), facts, itemNames);
  expect(s).toEqual({ dim: 0, pos: P, kind: 'gt_chest', contents: [{ key: 'minecraft:iron_ingot@0', count: 1_000_074 }] });
});
it('reads a super tank', () => {
  expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 130, extra: { mFluid: comp({ FluidName: str('water'), Amount: int(500_000) }) } })), facts, itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'gt_tank', contents: [{ key: 'fluid:water', count: 500_000 }] });
});
it('ignores machines that are not GT storage', () => expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 2002 })), facts, itemNames)).toBeNull());
it('voltageTier maps volts to the smallest covering tier', () => expect([8, 32, 33, 128, 512].map(voltageTier)).toEqual([0, 1, 2, 2, 3]));
it('compares class simple names, never the fully qualified cls', () => {
  expect([simpleClassName('gregtech.common.tileentities.boilers.MTEBoilerSolar'), simpleClassName('MTEBoilerSolar'), simpleClassName(null), simpleClassName('')])
    .toEqual(['MTEBoilerSolar', 'MTEBoilerSolar', null, null]);
  expect(countsForTopTier(classifyGtMachine(raw(gtMachine({ pos: P, mID: 42 })), facts, itemNames))).toBe(true);   // cls ...implementations.MTEHatchEnergy
  const moved = { ...facts, machines: new Map([...facts.machines, [9125, { ...facts.machines.get(125)!, mteId: 9125 }]]) };   // quantum chest class outside GT_CHEST_IDS
  expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 9125, extra: { mItemStack: stack(265, 1) } })), moved, itemNames)!.kind).toBe('gt_chest');
});

// ---- Beyond the plan's list: the rest of Task 4's interface ----

describe('pack facts', () => {
  it('takes machines without their structure, the dimensions and the batteries of a pack', () => {
    const pack = testPack();
    pack.machines.set(1000, { ...machineByMteId(pack, 1000)!, structure: { size: [3, 4, 3], controller: [1, 0, 0], blocks: [], air: [] } });
    const f = packFacts(pack);
    expect(f).toEqual(testFacts());
    expect(f.machines.get(1000)).not.toHaveProperty('structure');
    expect(f.machines.get(1000)!.cls).toBe('gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace');
    expect([f.exportId, f.dimensions.map((d) => [d.key, d.id]), [...f.electric]]).toEqual(['test-export',
      [['overworld', 0], ['nether', -1], ['theend', 1], ['endasteroid', 1], ['twilightforest', 7], ['moon', 28], ['ross128b', 64]],
      [['gregtech:gt.metaitem.01@32539', { maxCharge: 1_600_000, tier: 3 }], ['gregtech:gt.metaitem.01@32519', { maxCharge: 100_000, tier: 1 }]]]);
  });

  it('is empty without a pack and survives a structured clone (the worker gets a copy)', () => {
    expect(packFacts(null)).toEqual(emptyFacts());
    expect(emptyFacts()).toEqual({ exportId: null, machines: new Map(), dimensions: [], electric: new Map() });
    expect(structuredClone(packFacts(testPack()))).toEqual(testFacts());
  });

  it('packWithout drops one machine and leaves the pack it came from alone', () => {
    const pack = testPack();
    const without = packWithout(pack, 2002);
    expect([machineByMteId(without, 2002) !== undefined, machineByMteId(without, 2001) !== undefined, machineByMteId(pack, 2002) !== undefined]).toEqual([false, true, true]);
    expect(packFacts(without).machines.has(2002)).toBe(false);
  });

  it('matches energy hatches by the simple class name only', () => {
    expect(['MTEHatchEnergy', 'MTEHatchDynamo', ''].map((n) => ENERGY_HATCH_RE.test(n))).toEqual([true, false, false]);
    expect(simpleClassName('a.b.')).toBeNull();
  });
});

describe('machine details', () => {
  it('reads Long and negative mEUt, a missing mWorks as working and an idle machine as not running', () => {
    const r = classifyGtMachine(raw(gtMachine({ pos: P, mID: 1000, extra: { mEUt: long(-120n), mMaxProgresstime: int(0), mWrench: byte(1) } })), facts, itemNames);
    expect(r).toMatchObject({ dim: 0, pos: P, kind: 'multiblock', multiblock: true, tier: null, recipeEUt: 120, running: false, works: true,
      cls: 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace' });
    expect(r).not.toHaveProperty('mainFacing');
    expect(r).not.toHaveProperty('boiler');
    expect(r).not.toHaveProperty('batteries');
  });

  it('keeps the readable inventory slots and an empty known battery at charge 0', () => {
    const inv = list('compound', [
      comp({ IntSlot: int(0), ...stackFields(5000, 1, 32519) }),                       // Small Lithium Battery, empty: GT removes the tag
      comp({ IntSlot: int(1), ...stackFields(9999, 1) }),                              // an id the world's item map does not know
      comp({ IntSlot: int(2), ...stackFields(265, 3) }) ]);                            // not a battery
    const r = classifyGtMachine(raw(gtMachine({ pos: P, mID: 161, extra: { Inventory: inv } })), facts, itemNames);
    expect(r.batteries).toEqual([{ key: 'gregtech:gt.metaitem.01@32519', charge: 0 }]);
    expect(r.inventory).toEqual([{ key: 'gregtech:gt.metaitem.01@32519', count: 1, slot: 0 }, { key: 'minecraft:iron_ingot@0', count: 3, slot: 2 }]);
  });

  it('reads boiler fields of a boiler the export does not know, and none on other unknown machines', () => {
    expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 31997, extra: { mTemperature: int(80) } })), emptyFacts(), itemNames).boiler)
      .toEqual({ runTime: 0, temperature: 80 });
    expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 31997 })), emptyFacts(), itemNames)).not.toHaveProperty('boiler');
  });

  it('counts tiered kinds and energy hatches for the top tier', () => {
    expect([...TIER_KINDS].sort()).toEqual(['basic', 'battery_buffer', 'generator', 'transformer', 'turbine']);
    const tops = [2001, 1120, 1130, 161, 21, 42, 1000, 105, 125, 1246].map((mID) => countsForTopTier(classifyGtMachine(raw(gtMachine({ pos: P, mID })), facts, itemNames)));
    expect(tops).toEqual([true, true, true, true, true, true, false, false, false, false]);
  });

  it('places a machine with its base, tier, name and running recipe', () => {
    const r = classifyGtMachine(raw(gtMachine({ pos: P, mID: 2001, facing: 3, mainFacing: 2, color: 1, storedEU: 64,
      extra: { mEUt: int(2), mMaxProgresstime: int(100) } })), facts, itemNames);
    expect(toPlacedMachine(r, '0:-1:-2')).toEqual({ dim: 0, pos: P, mteId: 2001, facing: 3, mainFacing: 2, color: 1, baseId: '0:-1:-2', storedEU: 64,
      kind: 'basic', tier: 1, name: 'Basic Macerator', recipeEUt: 2 });
    const idle = classifyGtMachine(raw(gtMachine({ pos: P, mID: 31999, extra: { mEUt: int(2) } })), facts, itemNames);
    expect(toPlacedMachine(idle, null)).toEqual({ dim: 0, pos: P, mteId: 31999, facing: 2, color: 0, baseId: null, storedEU: 0, kind: 'unknown' });
  });
});

describe('pipe details', () => {
  it('rates cables from the export and places pipes with their network', () => {
    const silver = classifyGtPipe(raw(gtPipe({ pos: P, mID: 1466, connections: 63, kind: 'cable' })), facts);
    expect(silver).toEqual({ dim: 0, pos: P, mteId: 1466, connections: 63, pipeKind: 'cable', color: 0, cable: { voltage: 512, amps: 1, loss: 1 }, voltageTier: 3 });
    expect(toPlacedPipe(silver, 'p:0:-1:64:-17')).toEqual({ dim: 0, pos: P, mteId: 1466, connections: 63, kind: 'cable', voltageTier: 3, amps: 1, networkId: 'p:0:-1:64:-17' });
    const pipe = classifyGtPipe(raw(gtPipe({ pos: P, mID: 5120, connections: 12, kind: 'cable' })), facts);   // no NBT hint: the export says fluid pipe
    expect([pipe.pipeKind, pipe.cable, toPlacedPipe(pipe)]).toEqual(['fluid', undefined, { dim: 0, pos: P, mteId: 5120, connections: 12, kind: 'fluid' }]);
    expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 5600, connections: 1, kind: 'fluid' })), facts).pipeKind).toBe('item');
  });

  it('maps volts above every tier to MAX and none to ULV', () => expect([0, 2_147_483_640, 2 ** 40].map(voltageTier)).toEqual([0, 14, 14]));
});

describe('digital storage details', () => {
  it('knows the GT chest and tank id ranges', () => {
    expect([...GT_CHEST_IDS]).toEqual([125, 126, 127, 128, 129, 135, 136, 137, 138, 139]);
    expect([...GT_TANK_IDS]).toEqual([120, 121, 122, 123, 124, 130, 131, 132, 133, 134]);
  });

  it('reads an empty chest and tank as empty, and a chest of an item it cannot name as unknown', () => {
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 136 })), facts, itemNames)).toEqual({ dim: 0, pos: P, kind: 'gt_chest', contents: [] });
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 121 })), facts, itemNames)).toEqual({ dim: 0, pos: P, kind: 'gt_tank', contents: [] });
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 127, extra: { mItemStack: stack(9999, 1), mItemCount: int(5) } })), facts, itemNames)!.contents).toBeNull();
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 131, extra: { mFluid: comp({ Amount: int(5) }) } })), facts, itemNames)!.contents).toBeNull();
  });

  it('finds a chest by mItemCount alone and keeps the tank class over the id', () => {
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 31996, extra: { mItemStack: stack(4, 1), mItemCount: int(9), mDisableFilter: byte(0) } })), emptyFacts(), itemNames))
      .toEqual({ dim: 0, pos: P, kind: 'gt_chest', contents: [{ key: 'minecraft:cobblestone@0', count: 9 }] });
    const tankAt125 = { ...facts, machines: new Map([...facts.machines, [125, { ...facts.machines.get(130)!, mteId: 125 }]]) };
    expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 125 })), tankAt125, itemNames)!.kind).toBe('gt_tank');
  });
});
