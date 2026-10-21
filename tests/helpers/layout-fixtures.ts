// Synthetic fixtures for the line-layout tests (Plan 5 Task 1, architecture §10): a pack with the parts a line is
// built from (transformers, hatches, cables, pipes, a boiler, turbines, covers, Project Red / AE2 / EnderIO parts),
// complete plans, projects and world scans, and flat voxel areas with a `readArea` stand-in. Every layout test builds
// its inputs here; no real export or world is read. Each call returns fresh objects, so a test that changes its pack,
// plan or scan changes no other.

import { parseItemKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import type { Vec3 } from '../../src/shared/layout/geometry.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { LayoutTap } from '../../src/shared/types/layout.ts';
import type { BlockRef, Fluid, Item, Machine, MachineKind, Pack, Product, StructureInfo } from '../../src/shared/types/pack.ts';
import type { BuildStep, LogisticsMode, Plan, PlanFlow, PlanStep } from '../../src/shared/types/plan.ts';
import type { Project } from '../../src/shared/types/project.ts';
import {
  AIR_INDEX, UNKNOWN_BLOCK, UNKNOWN_INDEX, type BBox, type Base, type LogisticsNetwork, type PlacedMachine, type PowerNetwork,
  type TapPoint, type Voxels, type WorldScan,
} from '../../src/shared/types/world.ts';
import { powerSummary } from '../../src/server/planner/plan.ts';
import { MAX_AREA_VOXELS } from '../../src/server/world/area.ts';

/** The machine ids of the fixture pack. */
export const IDS = {
  MACERATOR: 2001, ASSEMBLER: 2002, CHEM_HV: 2003, EXTRACTOR: 2010, SOLIDIFIER: 2011, EBF: 1000, AIR_MULTI: 9100,
  TRANSFORMER_ULV: 20, TRANSFORMER_LV: 21, TRANSFORMER_MV: 22, TRANSFORMER_HV: 23,
  ENERGY_LV: 41, ENERGY_MV: 42, ENERGY_HV: 43,
  INPUT_HATCH: 51, INPUT_BUS_ULV: 60, INPUT_BUS_LV: 61, OUTPUT_HATCH: 71, OUTPUT_BUS: 81, MAINTENANCE: 90, MUFFLER: 91,
  TIN_WIRE: 1240, TIN_1X: 1246, TIN_2X: 1247, TIN_4X: 1248, COPPER_1X: 1366, ANNEALED_1X: 1386, ANNEALED_2X: 1387,
  SILVER_1X: 1466, SILVER_2X: 1467, SMALL_BRONZE_PIPE: 5110, BRONZE_PIPE: 5121, TIN_ITEM_PIPE: 5600, BRASS_ITEM_PIPE: 5610,
  HP_SOLAR: 114, TURBINE_LV: 1120, TURBINE_MV: 1121, TURBINE_HV: 1122,
} as const;

const AIR: BlockRef = Object.freeze({ id: 'minecraft:air', meta: 0 });
export const STONE: BlockRef = Object.freeze({ id: 'minecraft:stone', meta: 0 });
export const WATER: BlockRef = Object.freeze({ id: 'minecraft:water', meta: 0 });
export const LAVA: BlockRef = Object.freeze({ id: 'minecraft:lava', meta: 0 });

const GT_BLOCK = 'gregtech:gt.blockmachines';
const IMPL = 'gregtech.api.metatileentity.implementations.';

// ---- Multiblock structures (Plan 1 canonical frame: front on north, x east, y up, z south, min corner at 0) ----

function ebfStructure(): StructureInfo {
  const blocks: StructureInfo['blocks'] = [];
  for (let y = 0; y < 4; y++) {
    const full = y === 0 || y === 3;
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if (!full && x === 1 && z === 1) continue;                                       // the hollow centre
        const block: BlockRef = x === 1 && y === 0 && z === 0 ? { id: GT_BLOCK, meta: 0, mteId: IDS.EBF }
          : full ? { id: 'gregtech:gt.blockcasings', meta: 11 } : { id: 'gregtech:gt.blockcasings5', meta: 1 };
        blocks.push({ pos: [x, y, z], block });
      }
    }
  }
  return { size: [3, 4, 3], controller: [1, 0, 0], blocks, air: [[1, 1, 1], [1, 2, 1]] };
}

function airMultiStructure(): StructureInfo {
  const blocks: StructureInfo['blocks'] = [];
  const air: StructureInfo['air'] = [];
  for (let y = 0; y < 2; y++) {
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if (z === 0) air.push([x, y, z]);
        else blocks.push({ pos: [x, y, z], block: x === 1 && y === 0 && z === 1 ? { id: GT_BLOCK, meta: 0, mteId: IDS.AIR_MULTI } : { id: 'gregtech:gt.blockcasings4', meta: 1 } });
      }
    }
  }
  return { size: [3, 2, 3], controller: [1, 0, 1], blocks, air };
}

/** Electric Blast Furnace: 3×4×3, casing layers at y 0 and 3, coil rings at y 1 and 2 around two air cells — 34 blocks. */
export const EBF_STRUCTURE: StructureInfo = ebfStructure();
/** A 3×2×3 multiblock whose whole front row (z = 0) must stay air. */
export const AIR_MULTI_STRUCTURE: StructureInfo = airMultiStructure();

// ---- Packs ----

function gtMachine(mteId: number, name: string, metaName: string, kind: MachineKind, cls: string, more: Partial<Machine> = {}): Machine {
  return { mteId, metaName, name, cls, itemKey: `${GT_BLOCK}@${mteId}`, kind, maps: [], ...more };
}

function cable(mteId: number, name: string, metaName: string, voltage: number, amps: number, lossPerBlock: number, insulated: boolean, material: string): Machine {
  return gtMachine(mteId, name, metaName, 'cable', `${IMPL}MTECable`, { cable: { voltage, amps, lossPerBlock, insulated, material } });
}

/** The line parts of the fixture table, fresh for every pack. */
function lineMachines(): Machine[] {
  const transformer = (mteId: number, tier: number, name: string) =>
    gtMachine(mteId, name, `transformer.tier.0${tier}`, 'transformer', `${IMPL}MTETransformer`, { tier });
  const hatch = (mteId: number, tier: number, name: string, metaName: string, cls: string) =>
    gtMachine(mteId, name, metaName, 'hatch', `${IMPL}${cls}`, { tier });
  const turbine = (mteId: number, tier: number, name: string) =>
    gtMachine(mteId, name, `basicgenerator.steamturbine.tier.0${tier}`, 'turbine', `${IMPL}MTESteamTurbine`, { tier });
  return [
    transformer(IDS.TRANSFORMER_ULV, 0, 'Ultra Low Voltage Transformer'),
    transformer(IDS.TRANSFORMER_LV, 1, 'Low Voltage Transformer'),
    transformer(IDS.TRANSFORMER_MV, 2, 'Medium Voltage Transformer'),
    transformer(IDS.TRANSFORMER_HV, 3, 'High Voltage Transformer'),
    hatch(IDS.ENERGY_LV, 1, 'LV Energy Hatch', 'hatch.energy.tier.01', 'MTEHatchEnergy'),
    hatch(IDS.ENERGY_MV, 2, 'MV Energy Hatch', 'hatch.energy.tier.02', 'MTEHatchEnergy'),
    hatch(IDS.ENERGY_HV, 3, 'HV Energy Hatch', 'hatch.energy.tier.03', 'MTEHatchEnergy'),
    hatch(IDS.INPUT_HATCH, 1, 'Input Hatch (LV)', 'hatch.input.tier.01', 'MTEHatchInput'),
    hatch(IDS.INPUT_BUS_ULV, 0, 'Input Bus (ULV)', 'hatch.input_bus.tier.00', 'MTEHatchInputBus'),
    hatch(IDS.INPUT_BUS_LV, 1, 'Input Bus (LV)', 'hatch.input_bus.tier.01', 'MTEHatchInputBus'),
    hatch(IDS.OUTPUT_HATCH, 1, 'Output Hatch (LV)', 'hatch.output.tier.01', 'MTEHatchOutput'),
    hatch(IDS.OUTPUT_BUS, 1, 'Output Bus (LV)', 'hatch.output_bus.tier.01', 'MTEHatchOutputBus'),
    hatch(IDS.MAINTENANCE, 1, 'Maintenance Hatch', 'hatch.maintenance', 'MTEHatchMaintenance'),
    hatch(IDS.MUFFLER, 1, 'Muffler Hatch (LV)', 'hatch.muffler.tier.01', 'MTEHatchMuffler'),
    cable(IDS.TIN_WIRE, '1x Tin Wire', 'wire.tin.01', 32, 1, 2, false, 'Tin'),
    cable(IDS.TIN_1X, '1x Tin Cable', 'cable.tin.01', 32, 1, 1, true, 'Tin'),
    cable(IDS.TIN_2X, '2x Tin Cable', 'cable.tin.02', 32, 2, 1, true, 'Tin'),
    cable(IDS.TIN_4X, '4x Tin Cable', 'cable.tin.04', 32, 4, 1, true, 'Tin'),
    cable(IDS.COPPER_1X, '1x Copper Cable', 'cable.copper.01', 128, 1, 2, true, 'Copper'),
    cable(IDS.ANNEALED_1X, '1x Annealed Copper Cable', 'cable.annealedcopper.01', 128, 1, 1, true, 'AnnealedCopper'),
    cable(IDS.ANNEALED_2X, '2x Annealed Copper Cable', 'cable.annealedcopper.02', 128, 2, 1, true, 'AnnealedCopper'),
    cable(IDS.SILVER_1X, '1x Silver Cable', 'cable.silver.01', 512, 1, 1, true, 'Silver'),
    cable(IDS.SILVER_2X, '2x Silver Cable', 'cable.silver.02', 512, 2, 1, true, 'Silver'),
    gtMachine(IDS.SMALL_BRONZE_PIPE, 'Small Bronze Fluid Pipe', 'pipe.fluid.bronze.small', 'fluid_pipe', `${IMPL}MTEFluid`,
      { fluidPipe: { litresPerSecond: 480, material: 'Bronze' } }),
    gtMachine(IDS.BRONZE_PIPE, 'Bronze Fluid Pipe', 'pipe.fluid.bronze', 'fluid_pipe', `${IMPL}MTEFluid`,
      { fluidPipe: { litresPerSecond: 1440, material: 'Bronze' } }),
    gtMachine(IDS.TIN_ITEM_PIPE, 'Tin Item Pipe', 'pipe.item.tin', 'item_pipe', `${IMPL}MTEItemPipe`,
      { itemPipe: { stacksPerSecond: 1, material: 'Tin' } }),
    gtMachine(IDS.BRASS_ITEM_PIPE, 'Brass Item Pipe', 'pipe.item.brass', 'item_pipe', `${IMPL}MTEItemPipe`,
      { itemPipe: { stacksPerSecond: 2, material: 'Brass' } }),
    gtMachine(IDS.HP_SOLAR, 'High Pressure Solar Boiler', 'boiler.solar.steel', 'boiler', 'gregtech.common.tileentities.boilers.MTEBoilerSolarSteel',
      { steamPerSecondMax: 360 }),
    turbine(IDS.TURBINE_LV, 1, 'Basic Steam Turbine'),
    turbine(IDS.TURBINE_MV, 2, 'Advanced Steam Turbine'),
    turbine(IDS.TURBINE_HV, 3, 'Turbo Steam Turbine'),
  ];
}

/** The machines `layoutPack` adds on top of the line parts, fresh for every pack. */
function layoutMachines(): Machine[] {
  const basic = (mteId: number, tier: number, name: string, metaName: string) =>
    gtMachine(mteId, name, metaName, 'basic', `${IMPL}MTEBasicMachineWithRecipe`, { tier });
  return [
    basic(IDS.MACERATOR, 1, 'Basic Macerator', 'basicmachine.macerator.tier.01'),
    basic(IDS.ASSEMBLER, 2, 'Advanced Assembler', 'basicmachine.assembler.tier.02'),
    basic(IDS.CHEM_HV, 3, 'Advanced Chemical Reactor', 'basicmachine.chemicalreactor.tier.03'),
    basic(IDS.EXTRACTOR, 1, 'Basic Fluid Extractor', 'basicmachine.fluidextractor.tier.01'),
    basic(IDS.SOLIDIFIER, 1, 'Basic Fluid Solidifier', 'basicmachine.fluidsolidifier.tier.01'),
    gtMachine(IDS.EBF, 'Electric Blast Furnace', 'multimachine.blastfurnace', 'multiblock', `${IMPL}MTEElectricBlastFurnace`,
      { structure: structuredClone(EBF_STRUCTURE) }),
    gtMachine(IDS.AIR_MULTI, 'Test Front-Air Machine', 'multimachine.testfrontair', 'multiblock', `${IMPL}MTETestFrontAir`,
      { structure: structuredClone(AIR_MULTI_STRUCTURE) }),
  ];
}

/** Part items `addLineParts` adds (covers, chests, Project Red, AE2 and EnderIO parts). */
const PART_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['gregtech:gt.metaitem.01@32630', 'Conveyor Module (LV)'],
  ['gregtech:gt.metaitem.01@32631', 'Conveyor Module (MV)'],
  ['gregtech:gt.metaitem.01@32610', 'Electric Pump (LV)'],
  ['gregtech:gt.metaitem.01@32611', 'Electric Pump (MV)'],
  ['gregtech:gt.metaitem.01@32270', 'Filtered Conveyor Cover (Export)'],
  ['minecraft:chest@0', 'Chest'],
  ['EnderIO:itemItemConduit@0', 'Item Conduit'],
  ['EnderIO:itemBasicFilterUpgrade@0', 'Basic Item Filter'],
  ['EnderIO:itemBasicFilterUpgrade@1', 'Advanced Item Filter'],
  ['EnderIO:itemBigFilterUpgrade@0', 'Big Item Filter'],
  ['EnderIO:itemExtractSpeedUpgrade@0', 'Item Conduit Speed Upgrade'],
  ['EnderIO:itemLiquidConduit@2', 'Ender Fluid Conduit'],
  ['EnderIO:itemLiquidConduit@3', 'Crystalline Ender Fluid Conduit'],
  ['EnderIO:itemLiquidConduit@4', 'Crystalline Pink Slime Ender Fluid Conduit'],
  ['EnderIO:itemLiquidConduit@5', 'Melodic Ender Fluid Conduit'],
  ['EnderIO:itemLiquidConduit@6', 'Stellar Ender Fluid Conduit'],
  ['ProjRed|Transportation:projectred.transportation.pipe@1', 'Routed Junction Pipe'],
  ['ProjRed|Transportation:projectred.transportation.pipe@2', 'Routed Interface Pipe'],
  ['ProjRed|Transportation:projectred.transportation.pipe@4', 'Routed Request Pipe'],
  ['ProjRed|Transportation:projectred.transportation.routingchip@0', 'Item Responder Chip'],
  ['ProjRed|Transportation:projectred.transportation.routingchip@4', 'Item Extractor Chip'],
  ['ProjRed|Transportation:projectred.transportation.routingchip@6', 'Item Stock Keeper Chip'],
  ['ProjRed|Transportation:projectred.transportation.routingchip@3', 'Item Terminator Chip'],
  ['appliedenergistics2:tile.BlockInterface@0', 'ME Interface'],
  ['appliedenergistics2:item.ItemMultiPart@16', 'ME Glass Cable - Fluix'],
  ['appliedenergistics2:item.ItemMultiPart@260', 'ME Export Bus'],
  ['appliedenergistics2:item.ItemMultiMaterial@52', 'Blank Pattern'],
  ['appliedenergistics2:item.ItemMultiMaterial@27', 'Capacity Card'],
  ['appliedenergistics2:item.ItemMultiMaterial@30', 'Acceleration Card'],
];

/** Plain items `layoutPack` adds for plans to flow. */
const LAYOUT_ITEMS: ReadonlyArray<readonly [ItemKey, string]> = [
  ['t:in@0', 'Raw Input'], ['t:dust@0', 'Titanium Dust'], ['t:ingot@0', 'Titanium Ingot'],
];

function item(key: ItemKey, name: string): Item {
  const { id, meta } = parseItemKey(key);
  return { key, id, meta, name, oreDict: [] };
}

function fluid(name: string, display: string, gas: boolean): Fluid {
  return { key: `fluid:${name}`, id: name, name: display, temperature: 300, gas, molten: name.startsWith('molten.') };
}

function addMachine(pack: Pack, m: Machine): void {
  pack.machines.set(m.mteId, m);
  pack.items.set(m.itemKey, item(m.itemKey, m.name));
}

/** A pack with nothing in it: export 'E1', the overworld only; `nameOf` gives the item or fluid name, else the key. */
export function emptyPack(): Pack {
  const pack: Pack = {
    manifest: {
      format: 'gtnh-planner-export/1', exportId: 'E1', exporterVersion: 'test', exportedAt: '2026-10-17T00:00:00.000Z',
      packVersion: 'test', gtVersion: 'test', mods: {}, counts: {},
    },
    items: new Map(), fluids: new Map(), oreDict: new Map(), maps: new Map(), recipes: [], recipeById: new Map(),
    producers: new Map(), consumers: new Map(), machines: new Map(), machinesByMap: new Map(), materials: new Map(),
    worldgen: {
      dimensions: [{ key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 }],
      veins: [], fluidSources: [], capabilities: [], byproducts: {},
    },
    nameOf: (k: StuffKey) => pack.items.get(k)?.name ?? pack.fluids.get(k)?.name ?? k,
  };
  return pack;
}

/**
 * Adds the fixture line parts (machines and their items, part items) to `pack`, replacing rows with the same id or key,
 * and gives machine 1000 the EBF structure when it has none. Mutates and returns `pack`.
 */
export function addLineParts(pack: Pack): Pack {
  for (const m of lineMachines()) addMachine(pack, m);
  for (const [key, name] of PART_ITEMS) pack.items.set(key, item(key, name));
  const ebf = pack.machines.get(IDS.EBF);
  if (ebf !== undefined && ebf.structure === undefined) ebf.structure = structuredClone(EBF_STRUCTURE);
  return pack;
}

/** `addLineParts(emptyPack())` plus the plan machines (five singleblocks, the EBF, the front-air multiblock), items and fluids. */
export function layoutPack(): Pack {
  const pack = addLineParts(emptyPack());
  for (const m of layoutMachines()) addMachine(pack, m);
  for (const [key, name] of LAYOUT_ITEMS) pack.items.set(key, item(key, name));
  for (const f of [fluid('molten.iron', 'Molten Iron', false), fluid('oxygen', 'Oxygen', true)]) pack.fluids.set(f.key, f);
  return pack;
}

let layoutNames: Map<number, string> | null = null;

function layoutMachineName(mteId: number): string | undefined {
  layoutNames ??= new Map([...layoutPack().machines].map(([id, m]) => [id, m.name]));
  return layoutNames.get(mteId);
}

// ---- Plans and projects ----

export interface StepSpec {
  id: string; mteId: number; count: number; owned?: number; tier?: number /* 1 */; euPerTick?: number /* 30 */; utilization?: number /* 1 */;
  name?: string; inputs?: Array<[StuffKey, number]> /* [['t:in@0', 1]] */; outputs?: Array<[StuffKey, number]> /* [[`t:out_${id}@0`, 1]] */;
  handCraft?: boolean;
}

const DEFAULT_INPUT: StuffKey = 't:in@0';
const defaultOutput = (stepId: string): StuffKey => `t:out_${stepId}@0`;

function products(list: ReadonlyArray<readonly [StuffKey, number]>): Product[] {
  return list.map(([key, amount]) => ({ key, amount, chance: 1 }));
}

function planStep(s: StepSpec): PlanStep {
  return {
    id: s.id, recipeId: s.id, mapId: '',
    machine: { mteId: s.mteId, name: s.name ?? layoutMachineName(s.mteId) ?? `#${s.mteId}`, tier: s.tier ?? 1 },
    count: s.count, owned: s.owned ?? 0, runsPerSecond: 1, utilization: s.utilization ?? 1, euPerTick: s.euPerTick ?? 30,
    durationTicks: 20, overclocks: 0,
    inputs: products(s.inputs ?? [[DEFAULT_INPUT, 1]]), outputs: products(s.outputs ?? [[defaultOutput(s.id), 1]]),
    alternatives: [], handCraft: s.handCraft ?? false, warnings: [],
  };
}

/** raw → s1 → s2 → … → out, each flow carrying the previous step's first output key (raw: the first step's first input). */
function chainFlows(steps: readonly PlanStep[]): PlanFlow[] {
  const first = steps[0];
  if (first === undefined) return [];
  const flows: PlanFlow[] = [];
  let from = 'raw';
  let key = first.inputs[0]?.key ?? DEFAULT_INPUT;
  for (const s of steps) {
    flows.push({ from, to: s.id, key, perSecond: 1 });
    from = s.id;
    key = s.outputs[0]?.key ?? defaultOutput(s.id);
  }
  flows.push({ from, to: 'out', key, perSecond: 1 });
  return flows;
}

/** Plan 2's build steps for a line in `direct` mode. */
function planBuildSteps(): BuildStep[] {
  const steps: Array<Omit<BuildStep, 'order'>> = [
    { id: 'gather', kind: 'gather', text: 'Gather the base materials' },
    { id: 'place', kind: 'place', text: 'Place the machines' },
    { id: 'power', kind: 'power', text: "Connect power — never feed a machine more than its tier's voltage" },
    { id: 'logistics:direct', kind: 'logistics', text: "Connect each machine's output to the next one with conveyor/pump covers or short pipes; only raw inputs and the final output touch storage" },
    { id: 'test', kind: 'test', text: 'Run the line and check it makes the target' },
  ];
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

/** A complete plan of `steps` (export 'E1', scan 'S1'), flows chained raw → … → out unless `opts.flows` is given. */
export function makePlan(steps: readonly StepSpec[], opts: { flows?: PlanFlow[]; status?: Plan['status']; tier?: number } = {}): Plan {
  const planSteps = steps.map(planStep);
  return {
    settingsHash: 'h1', exportId: 'E1', scanId: 'S1',
    tier: opts.tier ?? (planSteps.length > 0 ? Math.max(...planSteps.map((s) => s.machine.tier)) : 1),
    reachable: [], unlocks: [], steps: planSteps, flows: opts.flows ?? chainFlows(planSteps), rawInputs: [], byproducts: [],
    power: powerSummary(planSteps), buildList: [], buildSteps: planBuildSteps(), warnings: [], status: opts.status ?? 'ok',
  };
}

/** Project 'P1' targeting `t:out@0` on scan 'S1', base '0:0:0', not yet placed. */
export function makeProject(opts: { logistics?: LogisticsMode; scanId?: string | null; baseId?: string | null; placement?: Project['placement'] } = {}): Project {
  return {
    id: 'P1', name: 'Test', createdAt: '2026-10-17T00:00:00.000Z', createdBy: 'Ann', rev: 0,
    settings: { ...defaultSettings(), target: 't:out@0', logistics: opts.logistics ?? 'direct' },
    world: { scanId: opts.scanId === undefined ? 'S1' : opts.scanId, baseId: opts.baseId === undefined ? '0:0:0' : opts.baseId },
    placement: opts.placement ?? null, marks: {}, notes: [],
  };
}

// ---- World scans ----

export interface ScanSpec {
  base?: { center: Vec3; bbox?: BBox };
  machines?: Array<{ pos: Vec3; mteId: number }>;
  power?: Array<{ voltageTier: number; average: number; loadEUt?: number; storedEU?: number; solarShare?: number;
    taps: Array<{ pos: Vec3; freeAmps: number; cableAmps?: number }> }>;
  logistics?: Array<{ kind: 'routed' | 'ae2' | 'gtpipe' | 'enderio'; taps: Vec3[]; channelsUsed?: number; channelsMax?: number }>;
}

const BASE_ID = '0:0:0';
const DEFAULT_CENTER: Vec3 = [8, 64, 8];
const DEFAULT_BBOX: BBox = Object.freeze({ minX: 0, minY: 64, minZ: 0, maxX: 15, maxY: 66, maxZ: 15 });
const LOGISTICS_TAP_KIND: Readonly<Record<LogisticsNetwork['kind'], TapPoint['kind']>> = { routed: 'routed', ae2: 'ae2', gtpipe: 'pipe', enderio: 'pipe' };

function powerNetwork(p: NonNullable<ScanSpec['power']>[number], i: number): PowerNetwork {
  const id = `p:0:${i}`;
  const storedEU = p.storedEU ?? 0;
  const taps = p.taps.map((t): LayoutTap => ({
    pos: [...t.pos], dim: 0, kind: 'power', voltageTier: p.voltageTier, freeAmps: t.freeAmps, networkId: id,
    ...(t.cableAmps === undefined ? {} : { cableAmps: t.cableAmps }),
  }));
  return {
    id, baseId: BASE_ID, voltageTier: p.voltageTier, generatorEUt: { clear: p.average, rain: 0, average: p.average },
    consumersMaxEUt: 0, storedEU, capacityEU: storedEU, taps,
    ...(p.loadEUt === undefined ? {} : { loadEUt: p.loadEUt }),
    ...(p.solarShare === undefined ? {} : { solarShare: p.solarShare }),
  };
}

function logisticsNetwork(l: NonNullable<ScanSpec['logistics']>[number], i: number): LogisticsNetwork {
  const id = `${l.kind}:0:${i}`;
  return {
    id, baseId: BASE_ID, kind: l.kind, nodes: 4,
    taps: l.taps.map((pos) => ({ pos: [...pos], dim: 0, kind: LOGISTICS_TAP_KIND[l.kind], networkId: id })),
    ...(l.channelsUsed === undefined ? {} : { channelsUsed: l.channelsUsed }),
    ...(l.channelsMax === undefined ? {} : { channelsMax: l.channelsMax }),
  };
}

/** Scan 'S1' of the overworld with one base '0:0:0' holding the given machines (facing north), power and logistics networks. */
export function makeScan(spec: ScanSpec = {}): WorldScan {
  const machines = (spec.machines ?? []).map((m): PlacedMachine => ({ dim: 0, pos: [...m.pos], mteId: m.mteId, facing: 2, color: 0, baseId: BASE_ID }));
  const base: Base = {
    id: BASE_ID, dim: 0, name: 'Base', bbox: { ...(spec.base?.bbox ?? DEFAULT_BBOX) }, center: [...(spec.base?.center ?? DEFAULT_CENTER)],
    machineCount: machines.length, topTier: 1,
  };
  return {
    id: 'S1', source: { kind: 'server' }, scannedAt: '2026-10-17T00:00:00.000Z', levelName: 'world',
    dims: [{ dim: 0, keys: ['overworld'], name: 'Overworld', chunks: 1, inhabitedChunks: 1, visited: true, visitEvidence: ['inhabited chunks: 1'] }],
    bases: [base], machines, pipes: [], power: (spec.power ?? []).map(powerNetwork), logistics: (spec.logistics ?? []).map(logisticsNetwork),
    storage: [], visitedDims: ['overworld'], topTier: null, coilHeat: null, prospected: [],
  };
}

// ---- Voxels ----

export interface VoxSpec { origin: Vec3; size: Vec3; groundY: number; ground?: BlockRef; boxes?: Array<{ from: Vec3; to: Vec3; block: BlockRef }> }

function sameBlock(a: BlockRef, b: BlockRef): boolean {
  return a.id === b.id && a.meta === b.meta && a.mteId === b.mteId;
}

function paletteIndex(palette: BlockRef[], block: BlockRef): number {
  const i = palette.findIndex((p) => sameBlock(p, block));
  if (i !== -1) return i;
  palette.push({ ...block });
  return palette.length - 1;
}

/**
 * A voxel area of `size` at `origin`: every cell at world y ≤ `groundY` is `ground` (stone), the rest air; then each
 * box (inclusive world corners) overwrites its cells inside the area. Palette `[air, UNKNOWN_BLOCK, ground, …]`.
 */
export function flatVoxels({ origin, size, groundY, ground = STONE, boxes = [] }: VoxSpec): Voxels {
  const [sx, sy, sz] = size;
  const palette: BlockRef[] = [{ ...AIR }, { ...UNKNOWN_BLOCK }];
  const blocks = new Uint32Array(sx * sy * sz).fill(AIR_INDEX);
  const groundIndex = paletteIndex(palette, ground);
  const layer = sx * sz;
  for (let y = 0; y < sy; y++) if (origin[1] + y <= groundY) blocks.fill(groundIndex, y * layer, (y + 1) * layer);
  for (const box of boxes) {
    const index = paletteIndex(palette, box.block);
    const lo = [0, 1, 2].map((i) => Math.max(Math.min(box.from[i]!, box.to[i]!) - origin[i]!, 0));
    const hi = [0, 1, 2].map((i) => Math.min(Math.max(box.from[i]!, box.to[i]!) - origin[i]!, size[i]! - 1));
    for (let y = lo[1]!; y <= hi[1]!; y++) {
      for (let z = lo[2]!; z <= hi[2]!; z++) {
        for (let x = lo[0]!; x <= hi[0]!; x++) blocks[(y * sz + z) * sx + x] = index;
      }
    }
  }
  return { origin: [...origin], size: [...size], blocks, palette };
}

/**
 * A stand-in for Plan 4's `readArea` over `vox`: copies the requested inclusive box, with `UNKNOWN_INDEX` for cells
 * outside `vox`. Like `readArea` it throws a `RangeError` for an empty or malformed box or one above `MAX_AREA_VOXELS`.
 */
export function areaReader(vox: Voxels): (dim: number, bbox: BBox) => Promise<Voxels> {
  return async (_dim, bbox) => {
    const { minX, minY, minZ, maxX, maxY, maxZ } = bbox;
    const size: Vec3 = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
    if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isInteger) || size.some((n) => n < 1)) {
      throw new RangeError(`invalid area ${JSON.stringify(bbox)}`);
    }
    if (size[0] * size[1] * size[2] > MAX_AREA_VOXELS) throw new RangeError(`area of ${size.join('×')} blocks is over the limit of ${MAX_AREA_VOXELS}`);
    const [vx, vy, vz] = vox.size;
    const blocks = new Uint32Array(size[0] * size[1] * size[2]).fill(UNKNOWN_INDEX);
    for (let y = 0; y < size[1]; y++) {
      const fy = minY + y - vox.origin[1];                                               // the cell in `vox`
      if (fy < 0 || fy >= vy) continue;
      for (let z = 0; z < size[2]; z++) {
        const fz = minZ + z - vox.origin[2];
        if (fz < 0 || fz >= vz) continue;
        for (let x = 0; x < size[0]; x++) {
          const fx = minX + x - vox.origin[0];
          if (fx < 0 || fx >= vx) continue;
          blocks[(y * size[2] + z) * size[0] + x] = vox.blocks[(fy * vz + fz) * vx + fx]!;
        }
      }
    }
    return { origin: [minX, minY, minZ], size, blocks, palette: vox.palette.map((b) => ({ ...b })) };
  };
}
