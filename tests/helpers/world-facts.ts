// The pack facts of the world tests (Plan 4 Task 4), built from one table of machines, dimensions and batteries: as the
// `ScanPackFacts` a scan gets (`testFacts`) and as a whole synchronous `Pack` with empty recipe maps (`testPack`, for
// `contextFromScan`). Every `cls` is fully qualified, exactly as Plan 1 exports it (architecture §11.19); only the solar
// boilers carry `steamPerSecondMax`, as Plan 1 writes it only for `MTEBoilerSolar` and its subclass.

import type { FactMachine, ScanPackFacts } from '../../src/server/world/facts.ts';
import { itemKey, type ItemKey } from '../../src/shared/keys.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import type { DimensionInfo, Item, Machine, MachineKind, Pack } from '../../src/shared/types/pack.ts';

const TEST_EXPORT_ID = 'test-export';

const GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines';
const BOILERS = 'gregtech.common.tileentities.boilers.';
const GENERATORS = 'gregtech.common.tileentities.generators.';
const IMPLEMENTATIONS = 'gregtech.api.metatileentity.implementations.';
const STORAGE = 'gregtech.common.tileentities.storage.';
const BASIC_MACHINE = `${IMPLEMENTATIONS}MTEBasicMachineWithRecipe`;

function row(mteId: number, metaName: string, name: string, kind: MachineKind, cls: string, extra: Partial<FactMachine> = {}): FactMachine {
  return { id: gtMachineId(mteId), mteId, metaName, name, cls, itemKey: itemKey(GT_MACHINE_BLOCK, mteId), kind, maps: [], ...extra };
}

function cable(material: string, voltage: number): Machine['cable'] {
  return { voltage, amps: 1, lossPerBlock: 1, insulated: true, material };
}

const MACHINES: readonly FactMachine[] = [
  row(105, 'boiler.solar', 'Simple Solar Boiler', 'boiler', `${BOILERS}MTEBoilerSolar`, { steamPerSecondMax: 120 }),
  row(114, 'boiler.steel.solar', 'High Pressure Solar Boiler', 'boiler', `${BOILERS}MTEBoilerSolarSteel`, { steamPerSecondMax: 360 }),
  row(100, 'boiler.bronze', 'Small Coal Boiler', 'boiler', `${BOILERS}MTEBoilerBronze`),
  row(1120, 'basicgenerator.steamturbine.tier.01', 'Basic Steam Turbine', 'turbine', `${GENERATORS}MTESteamTurbine`, { tier: 1, voltage: 32, amps: 1 }),
  row(1121, 'basicgenerator.steamturbine.tier.02', 'Advanced Steam Turbine', 'turbine', `${GENERATORS}MTESteamTurbine`, { tier: 2, voltage: 128, amps: 1 }),
  row(1122, 'basicgenerator.steamturbine.tier.03', 'Turbo Steam Turbine', 'turbine', `${GENERATORS}MTESteamTurbine`, { tier: 3, voltage: 512, amps: 1 }),
  row(1130, 'basicgenerator.diesel.tier.01', 'Combustion Generator', 'generator', `${GENERATORS}MTEDieselGenerator`, { tier: 1, voltage: 32, amps: 1 }),
  row(161, 'batterybuffer.01.tier.01', 'Battery Buffer 1x1 LV', 'battery_buffer', `${IMPLEMENTATIONS}MTEBasicBatteryBuffer`, { tier: 1, batterySlots: 1 }),
  row(193, 'batterybuffer.16.tier.03', 'Battery Buffer 4x4 HV', 'battery_buffer', `${IMPLEMENTATIONS}MTEBasicBatteryBuffer`, { tier: 3, batterySlots: 16 }),
  row(21, 'transformer.tier.01', 'Transformer MV/LV', 'transformer', `${IMPLEMENTATIONS}MTETransformer`, { tier: 1 }),
  row(1246, 'cable.tin.01', '1x Tin Cable', 'cable', `${IMPLEMENTATIONS}MTECable`, { cable: cable('Tin', 32) }),
  row(1386, 'cable.annealedcopper.01', '1x Annealed Copper Cable', 'cable', `${IMPLEMENTATIONS}MTECable`, { cable: cable('AnnealedCopper', 128) }),
  row(1466, 'cable.silver.01', '1x Silver Cable', 'cable', `${IMPLEMENTATIONS}MTECable`, { cable: cable('Silver', 512) }),
  row(5120, 'pipe.fluid.bronze', 'Bronze Fluid Pipe', 'fluid_pipe', `${IMPLEMENTATIONS}MTEFluidPipe`),
  row(5600, 'pipe.item.tin', 'Tin Item Pipe', 'item_pipe', `${IMPLEMENTATIONS}MTEItemPipe`),
  row(2001, 'basicmachine.macerator.tier.01', 'Basic Macerator', 'basic', BASIC_MACHINE, { tier: 1 }),
  row(2002, 'basicmachine.assembler.tier.02', 'Advanced Assembler', 'basic', BASIC_MACHINE, { tier: 2 }),
  row(2003, 'basicmachine.chemicalreactor.tier.03', 'Chemical Reactor HV', 'basic', BASIC_MACHINE, { tier: 3 }),
  row(1000, 'multimachine.blastfurnace', 'Electric Blast Furnace', 'multiblock', 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace', { heatOC: true }),
  row(42, 'hatch.energy.tier.02', 'Energy Hatch MV', 'hatch', `${IMPLEMENTATIONS}MTEHatchEnergy`, { tier: 2 }),
  row(125, 'quantum.chest.tier.01', 'Quantum Chest LV', 'other', `${STORAGE}MTEQuantumChest`),
  row(130, 'super.tank.tier.01', 'Super Tank I', 'other', `${STORAGE}MTESuperTank`),
];

const DIMENSIONS: readonly DimensionInfo[] = [
  { key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'planet', defaultTier: 0 },
  { key: 'nether', id: -1, name: 'Nether', mod: 'minecraft', kind: 'dimension', defaultTier: 0 },
  { key: 'theend', id: 1, name: 'The End', mod: 'minecraft', kind: 'dimension', defaultTier: 3 },
  { key: 'endasteroid', id: 1, name: 'End Asteroids', mod: 'gregtech', kind: 'region', defaultTier: 3 },
  { key: 'twilightforest', id: 7, name: 'Twilight Forest', mod: 'TwilightForest', kind: 'dimension', defaultTier: 1 },
  { key: 'moon', id: 28, name: 'Moon', mod: 'GalacticraftCore', kind: 'moon', rocketTier: 1, defaultTier: 3 },
  { key: 'ross128b', id: 64, name: 'Ross 128b', mod: 'bartworks', kind: 'planet', rocketTier: 3, defaultTier: 5 },
];

const BATTERY_ITEM = 'gregtech:gt.metaitem.01';
const BATTERIES: ReadonlyArray<{ meta: number; name: string; maxCharge: number; tier: number }> = [
  { meta: 32539, name: 'Large Lithium Battery', maxCharge: 1_600_000, tier: 3 },
  { meta: 32519, name: 'Small Lithium Battery', maxCharge: 100_000, tier: 1 },
];

/** The facts of the table; a fresh copy on every call. */
export function testFacts(): ScanPackFacts {
  return {
    exportId: TEST_EXPORT_ID,
    machines: new Map(structuredClone(MACHINES).map((m) => [m.mteId, m])),
    dimensions: DIMENSIONS.map((d) => ({ ...d })),
    electric: new Map<ItemKey, { maxCharge: number; tier: number }>(BATTERIES.map((b) => [itemKey(BATTERY_ITEM, b.meta), { maxCharge: b.maxCharge, tier: b.tier }])),
  };
}

/** The table as a whole `Pack`: the machines, dimensions and the two batteries as items, with no recipes or maps; fresh on every call. */
export function testPack(): Pack {
  const items = new Map<ItemKey, Item>(BATTERIES.map((b): [ItemKey, Item] => {
    const key = itemKey(BATTERY_ITEM, b.meta);
    return [key, { key, id: BATTERY_ITEM, meta: b.meta, name: b.name, oreDict: [], electric: { maxCharge: b.maxCharge, tier: b.tier, canProvideEnergy: true } }];
  }));
  return {
    manifest: {
      format: 'gtnh-planner-export/1', exportId: TEST_EXPORT_ID, exporterVersion: 'test', exportedAt: '2026-10-17T00:00:00Z',
      packVersion: '2.9.0-RC-1', gtVersion: '5.09.54.183', mods: {}, counts: {},
    },
    items, fluids: new Map(), oreDict: new Map(),
    maps: new Map(), recipes: [], recipeById: new Map(), producers: new Map(), consumers: new Map(),
    machines: new Map<number, Machine>(structuredClone(MACHINES).map((m) => [m.mteId, m])), machinesByMap: new Map(),
    materials: new Map(),
    worldgen: { dimensions: DIMENSIONS.map((d) => ({ ...d })), veins: [], fluidSources: [], capabilities: [], byproducts: {} },
    nameOf: (key) => items.get(key)?.name ?? key,
  };
}

/** `pack` without machine `mteId` (also gone from `machinesByMap`); `pack` itself is left as it is. */
export function packWithout(pack: Pack, mteId: number): Pack {
  const machines = new Map(pack.machines);
  machines.delete(mteId);
  const machinesByMap = new Map([...pack.machinesByMap].map(([map, ids]) => [map, ids.filter((id) => id !== mteId)]));
  return { ...pack, machines, machinesByMap };
}
