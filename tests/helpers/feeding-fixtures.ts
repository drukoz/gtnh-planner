// Fixtures for the feeding checker's tests (plan 21): the fixture pack with recipe maps and the machines and items the
// feeding tests need. Every call returns fresh objects, so a test that changes its pack changes no other. Synthetic only:
// invented names, apart from the GT class names, mteIds and item ids the code names; no real export is read.

import { parseItemKey, type ItemKey } from '../../src/shared/keys.ts';
import type { Item, Machine, MachineKind, Pack, StructureInfo } from '../../src/shared/types/pack.ts';
import { PART_KEYS } from '../../src/server/layout/feeding/facts.ts';
import { EBF_STRUCTURE, IDS, layoutPack } from './layout-fixtures.ts';

/** The machine ids `feedPack` adds beside `IDS`. */
export const FEED_IDS = { SMELTER: 2020, MIXER: 2021, ODD: 2022, STEAM: 2023, COKE: 2024, BENCH: 31092 } as const;

const GT_BLOCK = 'gregtech:gt.blockmachines';
const BASIC_CLASS = 'gregtech.api.metatileentity.implementations.MTEBasicMachineWithRecipe';

/** A machine in the fixture table's own shape (the fields of `layout-fixtures.ts`'s `gtMachine`). */
function gtMachine(mteId: number, name: string, metaName: string, kind: MachineKind, cls: string, more: Partial<Machine> = {}): Machine {
  return { mteId, metaName, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind, maps: [], ...more };
}

function item(key: ItemKey, name: string): Item {
  const { id, meta } = parseItemKey(key);
  return { key, id, meta, name, oreDict: [] };
}

function addMachine(pack: Pack, m: Machine): void {
  pack.machines.set(m.mteId, m);
  pack.items.set(m.itemKey, item(m.itemKey, m.name));
}

/** The Coke Oven's structure: the fixture EBF's, with the controller block naming the Coke Oven itself. */
function cokeStructure(): StructureInfo {
  const structure = structuredClone(EBF_STRUCTURE);
  for (const b of structure.blocks) if (b.block.mteId === IDS.EBF) b.block.mteId = FEED_IDS.COKE;
  return structure;
}

/** The recipe map of each machine the layout fixtures define without one. */
const FIXTURE_MAPS: ReadonlyArray<readonly [number, string]> = [
  [IDS.MACERATOR, 'gt.recipe.macerator'], [IDS.ASSEMBLER, 'gt.recipe.assembler'], [IDS.CHEM_HV, 'gt.recipe.chemicalreactor'],
  [IDS.EXTRACTOR, 'gt.recipe.fluidextractor'], [IDS.SOLIDIFIER, 'gt.recipe.fluidsolidifier'], [IDS.EBF, 'gt.recipe.blastfurnace'],
];

/** Plain items the feeding tests flow through machines. */
const FEED_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:a@0', 'Alpha'], ['t:b@0', 'Beta'], ['t:c@0', 'Gamma'], ['t:x@0', 'Ex'], ['t:y@0', 'Why'],
];

/** The part items of `PART_KEYS` that `layoutPack` lacks (it holds the item filter cover and the ME Export Bus). */
const FEED_PART_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  [PART_KEYS.limitedFilter, 'Limited Item Filter'], [PART_KEYS.fluidPacket, 'Fluid Packet'], [PART_KEYS.shutter, 'Shutter Module'],
];

/** The machines `feedPack` adds. */
function feedMachines(): Machine[] {
  return [
    gtMachine(FEED_IDS.SMELTER, 'Advanced Alloy Smelter', 'basicmachine.alloysmelter.tier.02', 'basic', BASIC_CLASS,
      { tier: 2, maps: ['gt.recipe.alloysmelter'] }),
    gtMachine(FEED_IDS.MIXER, 'Basic Mixer', 'basicmachine.mixer.tier.01', 'basic', BASIC_CLASS, { tier: 1, maps: ['gt.recipe.mixer'] }),
    gtMachine(FEED_IDS.BENCH, 'Auto Workbench (MV)', 'basicmachine.automation.autoworkbench.02', 'other',
      'gtPlusPlus.xmod.gregtech.common.tileentities.automation.MTEElectricAutoWorkbench', { tier: 2, maps: [] }),
    gtMachine(FEED_IDS.ODD, 'Seed Thing', 'cropsnh.seedthing.tier.01', 'basic', 'com.example.MTESeedThing', { tier: 1, maps: ['t.recipe.seed'] }),
    gtMachine(FEED_IDS.STEAM, 'Steam Macerator', 'bronzemachine.macerator', 'steam',
      'gregtech.common.tileentities.machines.steam.MTESteamMaceratorBronze', { tier: 1, maps: ['gt.recipe.macerator'] }),
    gtMachine(FEED_IDS.COKE, 'Coke Oven', 'multimachine.cokeoven', 'multiblock', 'gregtech.common.tileentities.machines.multi.MTECokeOven',
      { maps: ['gt.recipe.cokeoven'], structure: cokeStructure() }),
  ];
}

/**
 * `layoutPack()` plus what the feeding tests need: recipe maps on the fixture machines (`IDS.MACERATOR` and the other five that
 * `layoutPack` leaves without one), the machines of `FEED_IDS` (a smelter and a mixer, an Auto Workbench, a basic machine of an
 * unknown kind, a steam macerator and a Coke Oven), the items `t:a@0` "Alpha", `t:b@0` "Beta", `t:c@0` "Gamma", `t:x@0` "Ex",
 * `t:y@0` "Why" and `t:lens@0` "Test Lens" (a GT lens), and the part items of `PART_KEYS`. The machines of `layoutPack` keep their
 * ids (`IDS`) and names.
 */
export function feedPack(): Pack {
  const pack = layoutPack();
  for (const [mteId, map] of FIXTURE_MAPS) {
    const m = pack.machines.get(mteId);
    if (m === undefined) throw new Error(`the layout fixtures define no machine ${mteId}`);
    m.maps = [map];
  }
  for (const m of feedMachines()) addMachine(pack, m);
  for (const [key, name] of FEED_ITEMS) pack.items.set(key, item(key, name));
  pack.items.set('t:lens@0', { ...item('t:lens@0', 'Test Lens'), gt: { prefix: 'lens', material: 'Glass', amount: 3628800 } });
  for (const [key, name] of FEED_PART_ITEMS) pack.items.set(key, item(key, name));
  return pack;
}
