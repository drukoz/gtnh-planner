// The loaded pack: architecture §6.2, with the conventions of §11.4 as comments and the battery data of §11.5.
// Fields after an "optional addition" comment extend §6.2 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { FluidKey, ItemKey, StuffKey } from '../keys.ts';

/** The ore-processing forms an ore material can list in `GtMaterial.parts`. */
export type OrePart = 'ore' | 'rawOre' | 'crushed' | 'dust' | 'ingot' | 'gem';

export interface PackManifest {
  format: 'gtnh-planner-export/1'; exportId: string; exporterVersion: string; exportedAt: string; packVersion: string; gtVersion: string; mods: Record<string, string>; counts: Record<string, number>;
  // optional additions: the exporter's own report
  nameFailures?: number; nameFailureSamples?: string[]; sectionMillis?: Record<string, number>;
  failedSections?: string[]; skippedSections?: string[]; warnings?: string[];
}
/** `gt.amount` is in M units (3628800 = one dust or ingot). */
export interface Item {
  key: ItemKey; id: string; meta: number; nbt?: string; name: string; oreDict: string[]; gt?: { prefix: string; material: string; amount: number /* in M units */ };
  // optional addition (§11.5): only for IC2 electric items (batteries, tools) with a capacity
  electric?: { maxCharge: number; tier: number; canProvideEnergy: boolean };
}
export interface Fluid { key: FluidKey; id: string; name: string; temperature: number; gas: boolean; molten: boolean }
/** `slot` counts item inputs from 0 and fluid inputs from 100. */
export interface Ingredient { options: Array<{ key: StuffKey; amount: number }>; consumed: boolean; chance: number /* 0..1, probability consumed */ ; slot: number }
export interface Product { key: StuffKey; amount: number; chance: number /* 0..1 */ }
export type RecipeSource = 'gt' | 'assemblyline' | 'crafting' | 'furnace' | 'derived';
/**
 * `id` is the content hash of the "v1" canonical form (recipe-id.ts). Crafting recipes have euPerTick 0,
 * durationTicks 0 and amps 0; vanilla furnace recipes have durationTicks 200; electric furnace and microwave
 * recipes derived from the furnace list have source 'derived'. Disabled GT recipes are dropped at load; fake
 * ones are kept with `flags.fake`.
 */
export interface Recipe {
  id: string; source: RecipeSource; maps: string[]; inputs: Ingredient[]; outputs: Product[];
  euPerTick: number; durationTicks: number; amps: number; specialValue: number;
  meta: { coilHeat?: number; cleanroom?: boolean; lowGravity?: boolean; circuit?: number; [k: string]: unknown };
  flags: {
    hidden?: boolean; recycling?: boolean; dynamicMap?: 'overwrite' | 'fallback' | 'modify'; shaped?: boolean; opaque?: boolean;
    // optional addition: GT mFakeRecipe, display only (the machine runs its own code)
    fake?: boolean;
  };
  category?: string;
}
export interface RecipeMapInfo {
  id: string; name: string; amps: number; dynamic?: 'overwrite' | 'fallback' | 'modify'; specialValue: 'heat' | 'fusion' | 'fuel' | 'tier' | 'none'; aliases: string[];
  // optional additions
  categories?: string[]; catalystItems?: ItemKey[]; recipeCount?: number;
}
export type MachineKind = 'basic' | 'multiblock' | 'steam' | 'generator' | 'boiler' | 'turbine' | 'battery_buffer' | 'transformer' | 'cable' | 'fluid_pipe' | 'item_pipe' | 'hatch' | 'casing' | 'other';
export interface BlockRef { id: string; meta: number; mteId?: number }                 // registry name + meta (+ GT tile id)
export interface StructureInfo {
  size: [number, number, number]; controller: [number, number, number]; blocks: Array<{ pos: [number, number, number]; block: BlockRef }>; air: Array<[number, number, number]>;
  // optional addition: a block lay on the boundary of the exporter's scan box, so the structure may be incomplete
  truncated?: boolean;
}
/** A singleblock's `amps` is its mAmperage (thermal centrifuge 2, arc furnace 3, mass fabricator 8). */
export interface Machine {
  mteId: number; metaName: string; name: string; cls: string; itemKey: ItemKey; kind: MachineKind;
  tier?: number; voltage?: number; amps?: number; maps: string[];
  cable?: { voltage: number; amps: number; lossPerBlock: number; insulated: boolean; material: string };
  fluidPipe?: { litresPerSecond: number; material: string };
  itemPipe?: { stacksPerSecond: number; material: string };
  batterySlots?: number; steamPerSecondMax?: number; turbineEfficiency?: number;
  structure?: StructureInfo; perfectOC?: boolean; heatOC?: boolean;
}
/**
 * `name` is GT's mName, or for a BartWorks/GT++ ore material its internal name (prefixed `bw:`/`gtpp:` only when it
 * collides). Material names are the same strings in Item.gt.material, OreVein.materials, Capability.yields and
 * Worldgen.byproducts.
 */
export interface GtMaterial {
  name: string; rgba: [number, number, number, number]; iconSet: string; oreByproducts: string[];
  // optional additions: ore-material data
  key?: string /* "gt:Iron" */; family?: 'gt' | 'bw' | 'gtpp'; displayName?: string;
  parts?: Partial<Record<OrePart, ItemKey>>; oreMultiplier?: number; byproductMultiplier?: number;
}
// Dimension keys are GT ore-gen names (e.g. "overworld", "nether", "theend", "endasteroid", "moon", "ross128b", "iojupiter"),
// because vein allow-lists use names (materials-availability.md). One Minecraft dim id can host two keys (DIM 1: theend + endasteroid).
// §11.4: key = the GT ore-gen name in lower case without whitespace; extra keys `endasteroid` (kind 'region', the id of
// The End) and `station:<planet>` (kind 'station', id null); a dimension missing from the tier table gets defaultTier 14.
export interface DimensionInfo { key: string; id: number | null; name: string; mod: string; kind: 'dimension' | 'planet' | 'moon' | 'asteroids' | 'station' | 'region'; rocketTier?: number; defaultTier: number /* voltage tier at which progression assumes access (hand-maintained table, quest-book evidence) */ }
/** Small ores are veins of kind 'small' with weight = amount per chunk and size = density = 0. */
export interface OreVein { name: string; dims: string[]; materials: { primary: string; secondary: string; between: string; sporadic: string }; weight: number; minY: number; maxY: number; size: number; density: number; kind: 'vein' | 'small' }
/** `dims: []` = needs no dimension. */
export interface FluidSource { fluid: FluidKey; dims: string[]; kind: 'underground' | 'air_intake' | 'gas_siphon' | 'space_pump' | 'pump'; minTier: number }
/**
 * Keys: `void_miner:<dim key>`, `deep_dark_void_miner`, `space_elevator_mining`, `space_elevator_mining_mk2`,
 * `space_elevator_mining_mk3`, `low_gravity`. A capability without `dim` needs no dimension.
 */
export interface Capability { key: string /* e.g. "void_miner:moon", "space_elevator_mining", "deep_dark_void_miner" */; name: string; minTier: number; dim?: string; yields: string[] /* material names */ }
export interface Worldgen { dimensions: DimensionInfo[]; veins: OreVein[]; fluidSources: FluidSource[]; capabilities: Capability[]; byproducts: Record<string /*material*/, string[]> }
export interface SearchHit { key: StuffKey; name: string; kind: 'item' | 'fluid'; produced: boolean }
/**
 * `machines` also holds the pseudo machines -1 (crafting table, map 'crafting') and -2 (furnace, map 'furnace'), not
 * -3 (hand); `machinesByMap` includes them and the 'assemblyline' pseudo map.
 */
export interface Pack {
  manifest: PackManifest;
  items: Map<ItemKey, Item>; fluids: Map<FluidKey, Fluid>; oreDict: Map<string, ItemKey[]>;
  maps: Map<string, RecipeMapInfo>; recipes: Recipe[]; recipeById: Map<string, Recipe>;
  producers: Map<StuffKey, number[]>; consumers: Map<StuffKey, number[]>;   // indices into recipes
  machines: Map<number, Machine>; machinesByMap: Map<string, number[]>;
  materials: Map<string, GtMaterial>; worldgen: Worldgen;
  nameOf(key: StuffKey): string;
  // optional additions
  fluidContainers?: Array<{ container: ItemKey; empty: ItemKey | null; fluid: FluidKey; amount: number }>;
  warnings?: string[];
}
