// The game facts the feeding checker rests on, each with the plan's evidence item (E1–E17 of
// `docs/superpowers/plans/2026-10-20-21-feeding-checker.md`, read from the pack's jars: GT 5.09.54.183, EnderIO 2.10.46,
// Project Red 4.12.44-GTNH, AE2 rv3-beta-1073-GTNH) and the research section (`docs/research/machine-feeding.md`).
// - Slot counts and the stack-size rule: E11, E2 (research §1.1.1, §1.1.3).
// - GT conveyor covers and the Auto Workbench: E10, E4 (research §2.4, §1.3).
// - EnderIO item conduit faces: E5 (research §2.1). Project Red chips and payloads: E6 (research §2.2).
// - AE2 crafting, the blocking-ignore list and the ME Export Bus: E8, E12, E16 (research §2.3, §3.5).
// - Which multiblock controllers start with Input Separation on: E15 (research §1.2).
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../shared/keys.ts';
import { V } from '../../../shared/gt/tiers.ts';
import { ITEM_CONDUIT } from '../../../shared/layout/enderio.ts';
import type { Machine, Pack } from '../../../shared/types/pack.ts';

/**
 * `o`, frozen, with its numbers typed `number`: `Object.freeze` and `as const` would pin each field to its literal, and
 * `let budget = PR.extractPerKey` could then never go down.
 */
function frozen<T extends object>(o: T): Readonly<T> {
  return Object.freeze(o);
}

/** The item id of `key`: the text before its last '@' (a key is `id@meta`, or `id@meta#hash`). */
function idOf(key: StuffKey): string {
  const at = key.lastIndexOf('@');
  return at < 1 ? key : key.slice(0, at);
}

const GT_META_ITEM = 'gregtech:gt.metaitem.01';

// ---- Part keys ----

/** The keys and ids the checker recognises on a layout's parts. */
export const PART_KEYS = {
  /** EnderIO's Limited Item Filter, on a conduit side (E5, research §2.1). */
  limitedFilter: 'EnderIO:itemLimitedItemFilter@0',
  /** ae2fc's Fluid Packet: how an AE2 pattern's fluid reaches a machine's item slots (E8, research §2.3). */
  fluidPacket: 'ae2fc:fluid_packet@0',
  /** GT's Shutter Module cover (add-on 15's key; settings mode `input_only` or `output_only`, E9). */
  shutter: 'gregtech:gt.metaitem.01@32749',
  /** GT's Item Filter cover (main's `item_filter_cover`, E9). */
  itemFilterCover: 'gregtech:gt.metaitem.01@32270',
  /** The programmed circuit, as an item id: every meta (E12). */
  circuitId: 'gregtech:gt.integrated_circuit',
  /** GT's tools, as an item id: every meta (they stack to 1). */
  gtToolId: 'gregtech:gt.metatool.01',
  /** The ME Export Bus part (E16; main lays it today as a hookup end). */
  meExportBus: 'appliedenergistics2:item.ItemMultiPart@260',
} as const;

/** The class simple name of GT++'s Auto Workbench, `MTEElectricAutoWorkbench` (E4). */
export const BENCH_CLASS = 'MTEElectricAutoWorkbench';

// ---- Slots (E11, E2) ----

/** A kind's slot count: one number for every tier, or the values for LV, MV, HV, EV and IV (a higher tier takes IV's). */
type SlotCount = number | readonly [number, number, number, number, number];

/**
 * The item slots `[in, out]` of each GT basic machine kind, by the kind in the machine's meta name
 * (`basicmachine.<kind>.tier.NN`). E11: the `LoaderMetaTileEntities` builders' `setSlotsCount(in, out)`, joined by mteId
 * with the export's meta names. Tiers ZPM to UMV equal IV for every kind; LuV was not captured and is taken as IV. The
 * Packager (`MTEBoxinator`) has 2 inputs and 1 output.
 */
export const BASIC_SLOT_TABLE = {
  alloysmelter: [2, 1], amplifab: [1, 1], arcfurnace: [2, [4, 4, 4, 9, 9]], assembler: [[6, 9, 9, 9, 9], 1], autoclave: [2, [2, 2, 3, 4, 4]],
  bender: [2, 1], boxinator: [2, 1], canner: [2, 2], centrifuge: [2, 6], chemicalbath: [1, [3, 3, 6, 6, 6]], chemicalreactor: [2, 2],
  circuitassembler: [6, 1], compressor: [1, 1], cutter: [2, [2, 2, 4, 4, 4]], distillery: [1, 1], e_furnace: [1, 1], e_oven: [1, 1],
  electrolyzer: [2, 6], electromagneticseparator: [1, 3], extractor: [1, 1], extruder: [2, 1], fermenter: [1, 1], fluidcanner: [1, 1],
  fluidextractor: [1, 1], fluidheater: [1, 1], fluidsolidifier: [1, 1], hammer: [1, 1], laserengraver: [[2, 2, 2, 4, 4], 1], lathe: [1, 2],
  macerator: [1, [1, 1, 2, 3, 4]], microwave: [1, 1], mixer: [[6, 6, 6, 9, 9], [1, 1, 4, 4, 4]], orewasher: [1, 3],
  plasmaarcfurnace: [2, [4, 4, 4, 9, 9]], polarizer: [1, 1], press: [[2, 2, 4, 4, 6], 1], printer: [1, 1], recycler: [1, 1], sifter: [1, 9],
  thermalcentrifuge: [1, 3], unboxinator: [1, 2], wiremill: [2, 1],
} as const;

const SLOT_ROWS: Readonly<Record<string, readonly [SlotCount, SlotCount]>> = BASIC_SLOT_TABLE;
const BASIC_KIND = /^basicmachine\.([a-z_]+)\.tier\.\d+$/;

function slotsAt(count: SlotCount, tier: number): number {
  return typeof count === 'number' ? count : count[Math.min(tier, 5) - 1]!;
}

/** A count of slots: a whole number, 0 or more. */
function isSlotCount(n: number | undefined): n is number {
  return n !== undefined && Number.isInteger(n) && n >= 0;
}

/**
 * The item slots of a GT basic machine. The exported counts when the machine has both (`Machine.itemInSlots` and
 * `itemOutSlots`, exporter 0.6.0, architecture §11 entry 49 (5): GT's `mInputSlotCount` and `mOutputItems.length` on
 * every `MTEBasicMachine`, steam machines among them; they replace the table: research §7); else the table, by the kind
 * in its meta name and its tier (E11); else null. On an older export a steam machine's `bronzemachine.*` and
 * `hpmachine.*` names, and on any a CropsNH or GT++ singleblock, are among the nulls: their slots come from their recipes
 * (plan Task 2).
 */
export function basicSlots(m: Pick<Machine, 'metaName' | 'tier' | 'itemInSlots' | 'itemOutSlots'>): { in: number; out: number; source: 'export' | 'table' } | null {
  if (isSlotCount(m.itemInSlots) && isSlotCount(m.itemOutSlots)) return { in: m.itemInSlots, out: m.itemOutSlots, source: 'export' };
  const kind = BASIC_KIND.exec(m.metaName)?.[1];
  if (kind === undefined || m.tier === undefined || !Number.isInteger(m.tier) || m.tier < 1) return null;
  const row = Object.hasOwn(SLOT_ROWS, kind) ? SLOT_ROWS[kind] : undefined;
  return row === undefined ? null : { in: slotsAt(row[0], m.tier), out: slotsAt(row[1], m.tier), source: 'table' };
}

/** The slots of a chest (`minecraft:chest`; plan Task 4 rule 9). */
export const CHEST_SLOTS = 27;

// ---- Stack sizes ----

const DEFAULT_STACK = 64;
/** The ids of the items that stack to 1: Fluid Packets and GT tools, whatever their meta. */
const SINGLE_STACK_IDS: ReadonlySet<string> = new Set([idOf(PART_KEYS.fluidPacket), PART_KEYS.gtToolId]);

/**
 * How many of an item fit in one slot: 64, but 1 for a Fluid Packet and a GT tool. The export carries no stack sizes, so
 * every other item is taken as 64 and the report names the unknown `stack_sizes` once (plan open question 7).
 */
export function stackLimit(key: StuffKey): number {
  return SINGLE_STACK_IDS.has(idOf(key)) ? 1 : DEFAULT_STACK;
}

// ---- AE2's blocking-ignore list (E12) ----

function metaKeys(id: string, from: number, to: number): StuffKey[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${id}@${from + i}`);
}

/**
 * What AE2's blocking mode ignores in a machine (E12: `AE2Compat.registerBlockingModeIgnoreItems` 81–139 and AE2's
 * `BlockingModeIgnoreItemRegistry.registerDefault`; research §2.3 for GT's metas).
 * - `ids`: items registered whole, every meta: the programmed circuit, BartWorks' lens item and the Twilight Forest trophies.
 * - `keys`: exact stacks: GT's 31 molds (metas 32301–32331 of `gregtech:gt.metaitem.01`), 28 extruder shapes (32350–32377)
 *   and 2 slicer blades (32398–32399), GT++'s Wood's Glass Lens, the four NH lenses, AE2's five inscriber presses
 *   (`appliedenergistics2:item.ItemMultiMaterial` 13, 14, 15, 19 and 21), the nine blood orbs and the Division Sigil.
 * GT's lenses (registered by `ProcessingLens`) are told by their prefix instead, in `ignoredByBlocking`. GT++'s Special lens has
 * no export key and is not listed (plan open question 13).
 */
export const BLOCKING_IGNORED: Readonly<{ keys: ReadonlySet<StuffKey>; ids: ReadonlySet<string> }> = frozen({
  keys: new Set<StuffKey>([
    ...metaKeys(GT_META_ITEM, 32301, 32331), ...metaKeys(GT_META_ITEM, 32350, 32377), ...metaKeys(GT_META_ITEM, 32398, 32399),
    'miscutils:MU-metaitem.01@32140',
    'dreamcraft:ReinforcedGlassLense@0', 'dreamcraft:MysteriousCrystalLens@0', 'dreamcraft:RadoxPolymerLens@0', 'dreamcraft:ChromaticLens@0',
    ...[13, 14, 15, 19, 21].map((meta) => `appliedenergistics2:item.ItemMultiMaterial@${meta}`),
    'AWWayofTime:weakBloodOrb@0', 'AWWayofTime:apprenticeBloodOrb@0', 'AWWayofTime:magicianBloodOrb@0', 'AWWayofTime:masterBloodOrb@0',
    'AWWayofTime:archmageBloodOrb@0', 'AWWayofTime:transcendentBloodOrb@0', 'BloodArsenal:transparent_orb@0', 'ForbiddenMagic:EldritchOrb@0',
    'Avaritia:Orb_Armok@0',
    'ExtraUtilities:divisionSigil@0',
  ]),
  ids: new Set<string>([PART_KEYS.circuitId, 'bartworks:gt.bwMetaGeneratedlens', 'TwilightForest:item.trophy']),
});

/** Whether AE2's blocking mode leaves `key` out of its "is the machine empty" test (E12). */
export function ignoredByBlocking(pack: Pack, key: StuffKey): boolean {
  return BLOCKING_IGNORED.ids.has(idOf(key)) || BLOCKING_IGNORED.keys.has(key) || pack.items.get(key)?.gt?.prefix === 'lens';
}

// ---- Input Separation (E15) ----

/**
 * The multiblock controllers that start with Input Separation on, by class simple name. E15, read from the GT jar's
 * bytecode: `MTEMultiBlockBase`'s constructor sets `inputSeparation = getDefaultInputSeparationMode()`, which
 * `IControllerWithOptionalFeatures` defaults to `supportsInputSeparation()` (`MTEExoFoundry` overrides both to true).
 * Resolved through the superclasses of every multiblock controller class in the jar (GT, GT++, BartWorks, GoodGenerator,
 * TecTech, KubaTech, GTNH-Lanth and the rest), 69 concrete classes return true. `MTECircuitAssemblyLine` computes it from its
 * mode, 0 on a new one (false); every other controller returns false. A pack update can leave the list stale (plan open
 * question 8: the exporter should record `supportsInputSeparation()` per controller).
 */
export const INPUT_SEPARATION_DEFAULT: ReadonlySet<string> = new Set([
  'MTEAdvEBF', 'MTEAdvImplosionCompressor', 'MTEAlloyBlastSmelter', 'MTEAmazonPackagerLegacy', 'MTEAutoCrafter',
  'MTEBECIONode', 'MTEBeamCrafter', 'MTEComponentAssemblyLine', 'MTECryogenicFreezer', 'MTEDEFusionCrafter',
  'MTEDigester', 'MTEDissolutionTank', 'MTEElectricBlastFurnace', 'MTEEndothermicFridge', 'MTEEntropicProcessor',
  'MTEExoFoundry', 'MTEExothermicHearth', 'MTEExoticModule', 'MTEFrothFlotationCell', 'MTEHIPCompressor',
  'MTEIndustrialArcFurnace', 'MTEIndustrialBendingMachine', 'MTEIndustrialBrewery', 'MTEIndustrialCentrifuge',
  'MTEIndustrialChemicalBath', 'MTEIndustrialChisel', 'MTEIndustrialCokeOven', 'MTEIndustrialCompressor',
  'MTEIndustrialCuttingMachine', 'MTEIndustrialElectrolyzer', 'MTEIndustrialElectromagneticSeparator',
  'MTEIndustrialExtractor', 'MTEIndustrialExtruder', 'MTEIndustrialForgeHammer', 'MTEIndustrialFormingPress',
  'MTEIndustrialLaserEngraver', 'MTEIndustrialMixer', 'MTEIndustrialMixerLegacy', 'MTEIndustrialMolecularTransformer',
  'MTEIndustrialPackager', 'MTEIndustrialRockBreaker', 'MTEIndustrialSifter', 'MTEIndustrialThermalCentrifuge',
  'MTEIndustrialWireMill', 'MTEIndustrialWireMillLegacy', 'MTELatex', 'MTEMassSolidifier', 'MTEMegaAlloyBlastSmelter',
  'MTEMegaBlastFurnaceLegacy', 'MTEMegaChemicalReactor', 'MTEMegaChemicalReactorLegacy', 'MTEMegaDistillationTower',
  'MTEMoltenModule', 'MTEMultiAutoclave', 'MTEMultiCanner', 'MTEMultiLathe', 'MTENanoForge', 'MTENeutroniumCompressor',
  'MTENuclearSaltProcessingPlant', 'MTEOreWashingPlant', 'MTEPCBFactory', 'MTEPlasmaModule', 'MTEPyrolyseOven',
  'MTEPyrolyseOvenLegacy', 'MTEQuantumForceTransformer', 'MTESmeltingModule', 'MTESolarFactory', 'MTESpinmatron',
  'MTEThermalBoiler',
]);

// ---- GT conveyor covers (E10) ----

/** What a conveyor cover moves: up to `stacks` stacks of up to `items` items every `tickRate` ticks. */
interface ConveyorOp { tier: number; tickRate: number; stacks: number; items: number }

/**
 * The Conveyor Module LV to ZPM (metas 32630–32636 of `gregtech:gt.metaitem.01`), as E10 gives them: LV 16 items per 100
 * ticks, MV 64/100, HV 64/20, EV 64/4, IV 64/1, LuV 4 × 64/1, ZPM 16 × 64/1 (research gt-mechanics §3.8; the `COVER_RATES`
 * comments in `src/server/layout/parts.ts`).
 */
const CONVEYOR_OPS: ReadonlyMap<StuffKey, ConveyorOp> = new Map<StuffKey, ConveyorOp>([
  [`${GT_META_ITEM}@32630`, { tier: 1, tickRate: 100, stacks: 1, items: 16 }],
  [`${GT_META_ITEM}@32631`, { tier: 2, tickRate: 100, stacks: 1, items: 64 }],
  [`${GT_META_ITEM}@32632`, { tier: 3, tickRate: 20, stacks: 1, items: 64 }],
  [`${GT_META_ITEM}@32633`, { tier: 4, tickRate: 4, stacks: 1, items: 64 }],
  [`${GT_META_ITEM}@32634`, { tier: 5, tickRate: 1, stacks: 1, items: 64 }],
  [`${GT_META_ITEM}@32635`, { tier: 6, tickRate: 1, stacks: 4, items: 64 }],
  [`${GT_META_ITEM}@32636`, { tier: 7, tickRate: 1, stacks: 16, items: 64 }],
]);

/** What the conveyor cover `coverKey` moves each time it acts, or null when the key is not a conveyor cover (E10). */
export function conveyorOp(coverKey: StuffKey): ConveyorOp | null {
  const op = CONVEYOR_OPS.get(coverKey);
  return op === undefined ? null : { ...op };
}

// ---- EnderIO item conduit faces (E5) ----

/**
 * E5: a face checks up to `maxSlotChecks` accessible slots a network tick (`ItemConduitNetwork.MAX_SLOT_CHECK_PER_TICK`);
 * one that found nothing on two ticks running sleeps `sleepTicks` ticks (`tickDeficit` below −1 becomes 20).
 */
export const EIO = frozen({ maxSlotChecks: 64, sleepTicks: 20 });

/** The most items a face takes at a time with `upgrades` Item Conduit Speed Upgrades: 4 + 4 × min(upgrades, 15) (E5). */
export function eioMaxExtracted(upgrades: number): number {
  return ITEM_CONDUIT.baseExtract + ITEM_CONDUIT.perUpgrade * Math.min(upgrades, ITEM_CONDUIT.maxUpgrades);
}

/**
 * The ticks a face waits after moving `moved` items when it moves at most `max`: `Math.round((float) n × (10f / max))` in
 * Java's float arithmetic, as the bytecode does it (E5: `ItemConduit.getTickTimePerItem` = 10f / max, `itemExtracted`'s
 * `i2f`, `fmul`, `Math.round(F)`). Keep both `Math.fround`s, the division's and the product's: 3 of 12 is exactly 2.5f and
 * rounds to 3, where the double product 2.49999994 would round to 2.
 */
export function eioDeficit(moved: number, max: number): number {
  return Math.round(Math.fround(moved * Math.fround(10 / max)));
}

// ---- Project Red chips and payloads (E6) ----

/**
 * E6, research §2.2:
 * - `extractorDelay`, `broadcasterDelay`: ticks between acts of an Item Extractor Chip and an Item Broadcaster Chip (the first at tick 9).
 * - `stockKeeperDelay`: an Item Stock Keeper Chip's base delay (the first act at tick 99); it grows by `throttleStep` for each pass that
 *   requested nothing, up to `throttleMax` more (`stockKeeperDelay()`).
 * - `extractPerKey`: an extractor's item budget, which starts again for each item key.
 * - `broadcastStacks`, `broadcastItems`: the orders and the items one act of a broadcaster handles.
 * - `maxRequest`: the most a stock keeper requests in one act.
 * - `chipSlots`, `stockSlots`: the chips of a Routed Interface Pipe and the entries of a stock keeper.
 */
export const PR = frozen({
  extractorDelay: 10, broadcasterDelay: 10, stockKeeperDelay: 100, throttleStep: 10, throttleMax: 1200, extractPerKey: 64, broadcastStacks: 8,
  broadcastItems: 64, maxRequest: 128, chipSlots: 4, stockSlots: 9,
});

/**
 * The priority of a payload's destination (E6): Passive is an Item Responder's answer, Terminated an Item Terminator's, Default an
 * Overflow Responder's, Active Broadcast and Active Craft the deliveries of a broadcaster and of a craft, and Wandering a payload
 * that has no destination.
 */
export type PrPriority = 'wandering' | 'default' | 'terminated' | 'passive' | 'active_broadcast' | 'active_craft';

/** The priorities in order: the index is the ordinal 0–5, and a higher one is preferred (E6). */
export const PR_PRIORITY_ORDER: readonly PrPriority[] =
  Object.freeze(['wandering', 'default', 'terminated', 'passive', 'active_broadcast', 'active_craft'] as const);

/** A payload's speed in hundredths of a pipe length per tick (E6: Wandering 0.05, Default 0.1, Terminated 0.05, Passive 0.2, Active 0.3). */
const PR_BOOST: Readonly<Record<PrPriority, number>> = { wandering: 5, default: 10, terminated: 5, passive: 20, active_broadcast: 30, active_craft: 30 };

/**
 * The ticks from a payload's dispatch to its arrival: it covers `hops` + 1 pipe lengths at its priority's speed, so
 * ⌈(hops + 1) × 100 / boost⌉ (E6; Java's float sums of the boost give the same ticks for every hop count the tests use).
 * `prTravelTicks(0, p)` is one pipe length: a bounce's retry, or a wanderer's.
 */
export function prTravelTicks(hops: number, p: PrPriority): number {
  return Math.ceil(((hops + 1) * 100) / PR_BOOST[p]);
}

/** The ticks until a stock keeper's next act after `idlePasses` passes that requested nothing: 100 + min(10 × passes, 1200) (E6). */
export function stockKeeperDelay(idlePasses: number): number {
  return PR.stockKeeperDelay + Math.min(PR.throttleStep * idlePasses, PR.throttleMax);
}

// ---- The Auto Workbench (E4) ----

/**
 * GT++'s Auto Workbench, mode 0 (E4, research §1.3):
 * - `craftEU`: the EU a bench must hold to run an update, and what a craft takes; `euPerItem`: what each item it pushes costs.
 * - `idleTicks`: the countdown after an update; `busyTicks`: the countdown after one that moved or crafted something.
 * - `firstTicks`: the countdown on a new bench and after a restart, which saves none of it.
 * - Slots: `inputSlots` input slots 0–8 (9–17 are the output buffer), `resultSlot` 18, `gridFrom` the first of the grid's nine ghost
 *   slots (19–27), `slots` in all (28 is the preview).
 */
export const BENCH = frozen({
  craftEU: 2048, euPerItem: 10, idleTicks: 32, busyTicks: 1, firstTicks: 20, inputSlots: 9, resultSlot: 18, gridFrom: 19, slots: 30,
});

/** The least EU a bench stores: `max(2048, V[t] × t × V[t])` (E4). */
const BENCH_MIN_STORE = 2048;

/**
 * The EU a bench of tier `tier` stores at most: `max(2048, V[t] × t × V[t])`, LV 2,048 and MV 32,768 (E4; `maxEUInput` is `V[t]`).
 * A tier that is not one of GT's (0 to 14) gets the least, 2,048.
 */
export function benchEnergyCap(tier: number): number {
  const volts = V[tier];
  return volts === undefined ? BENCH_MIN_STORE : Math.max(BENCH_MIN_STORE, volts * tier * volts);
}

// ---- AE2 (E8, E16) ----

/** How many items one ME Export Bus operation moves with 0 to 4 Acceleration Cards (E16). */
const EXPORT_AMOUNTS: readonly [number, number, number, number, number] = [1, 8, 32, 64, 96];

/**
 * AE2's timings. AE2 ticks a device at an adaptive rate between a minimum and a maximum number of ticks, and its
 * `TickTracker` starts at (min + max) / 2 (E8, E16):
 * - `ifaceMinTicks`, `ifaceMaxTicks`: `TickRates.Interface`, 5 to 120.
 * - `exportMinTicks`, `exportMaxTicks`: `TickRates.ExportBus`, 5 to 60.
 * - `exportAmounts`: the items an Export Bus moves per operation with 0 to 4 Acceleration Cards.
 * - `cpuWindow`: a crafting CPU with c co-processors may push `c + 1 − (pushes of its last cpuWindow updates)` patterns an update.
 */
export const AE2 = frozen({ ifaceMinTicks: 5, ifaceMaxTicks: 120, exportMinTicks: 5, exportMaxTicks: 60, exportAmounts: EXPORT_AMOUNTS, cpuWindow: 3 });
