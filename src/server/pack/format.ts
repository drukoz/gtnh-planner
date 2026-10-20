// The export wire format: what the Java exporter (exporter-mod/) writes and the pack loader reads.
// UTF-8 gzip'd JSON Lines (one JSON value per line, every line ends with '\n') plus a plain manifest.json.
//
// Rules both sides rely on:
// - Item index: `i` = 0-based line position in items.jsonl.gz; every index used in any file exists there.
// - m == 32767: wildcard (only from ore-dictionary lists or recipe stacks with wildcard damage); never a real variant.
// - Item slot: null keeps the slot position; amount 0 = not consumed; chance on GT's 1/10000 scale, omitted when 10000.
// - Fluid slot: litres; chance as for items.
// - inAlt[i], finAlt[i]: alternatives for slot i of in/fin; null or [] = none.
// - meta: every GT metadata entry by identifier, as JSON that is the same on every export of one pack (the loader
//   hashes it into the recipe id): booleans and finite numbers as they are, ItemStack as { "item": index } at any
//   depth, FluidStack as [fluid name, litres], enums by name, arrays and lists element by element, sets sorted, maps
//   and other objects as objects keyed by name (an object's instance fields); never Object.toString, whose identity
//   hash changes from run to run. null only inside arrays.
// - Dimension names: GT ore-gen names exactly as GT stores them (Overworld, The End, EndAsteroid, moon, Underdark);
//   the loader normalizes.
// - Material keys: gt: / bw: / gtpp: + IOreMaterial.getInternalName().
// - Structure coordinates: canonical orientation (controller front faces north, -z); x east, y up, z south;
//   origin = min corner of blocks and air cells, so every coordinate is >= 0.
// - Furnace ef / mw: the output GT's own electric furnace / microwave lookup returned for that input; mw is omitted
//   when the microwave would explode, burn or reject it.
// - electric: only for a non-wildcard item that is an IC2 IElectricItem with a finite maxCharge > 0.
// - Markers: EXPORT_OK or EXPORT_FAILED is written after every other file is closed.

import type { MachineKind, OrePart } from '../../shared/types/pack.ts';

export const EXPORT_FORMAT = 'gtnh-planner-export/1';
export const MARKER_OK = 'EXPORT_OK';
export const MARKER_FAILED = 'EXPORT_FAILED';

export type ItemSlot = null | [item: number, amount: number] | [item: number, amount: number, chance: number];
export type FluidSlot = null | [fluid: string, litres: number] | [fluid: string, litres: number, chance: number];
/** A `meta` value; an object that is exactly `{ item: number }` is an item reference. */
export type MetaValue = boolean | number | string | null | MetaValue[] | { [key: string]: MetaValue };
export type CraftingSlot = null | number | { ore: string } | number[];

export interface ItemLine { i: number; id: string; m: number; nid?: number; nbt?: string; un?: string | null; dn?: string | null; od?: string[]; gtPrefix?: string; gtMat?: string; gtAmt?: number; electric?: { maxCharge: number; tier: number; canProvideEnergy: boolean } }
export interface FluidLine { id: string; nid?: number; un?: string | null; dn?: string | null; temp: number; gas: boolean; density?: number }
export interface FluidContainerLine { container: number; empty: number | null; fluid: string; amount: number }
export interface OreDictLine { ore: string; items: number[] }
export interface RecipeMapLine { i: number; id: string; dn?: string | null; amps: number; maxIn?: number; maxOut?: number; maxFIn?: number; maxFOut?: number; svFormatter?: string; svKey?: string; dynamic?: 'overwrite' | 'fallback' | 'modify'; cats?: string[]; catalysts?: number[]; recipes: number }
export interface GtRecipeLine { map: number; in: ItemSlot[]; out: ItemSlot[]; fin: FluidSlot[]; fout: FluidSlot[]; eut: number; dur: number; sv?: number; inAlt?: Array<ItemSlot[] | null>; finAlt?: Array<FluidSlot[] | null>; disabled?: true; hidden?: true; fake?: true; needsEmptyOut?: true; nbtSensitive?: true; special?: number; cat?: string; meta?: Record<string, MetaValue>; owners?: string[] }
export interface AssemblyLineLine { research: number | null; researchTime: number; researchVoltage: number; in: ItemSlot[]; inAlt?: Array<ItemSlot[] | null>; fin: FluidSlot[]; out: ItemSlot; eut: number; dur: number }
export interface CraftingLine { cls: string; shape: 'shaped' | 'shapeless' | 'opaque'; w?: number; h?: number; mirrored?: boolean; in?: CraftingSlot[]; out: ItemSlot }
export interface FurnaceLine { in: number; out: [number, number]; xp: number; ef?: [number, number]; mw?: [number, number] }
export interface MachineLine {
  id: number; name: string; cls: string; dn?: string | null; item: number | null; kind: MachineKind;
  tier?: number; voltage?: number; amps?: number; maps?: string[]; mapsError?: string; perfectOC?: boolean; heatOC?: boolean;
  cable?: { voltage: number; amps: number; lossPerBlock: number; insulated: boolean; material: string | null };
  fluidPipe?: { capacityPerSecond: number; pipes: number; maxTemp: number; gasProof: boolean; material: string | null };
  itemPipe?: { slots: number; tickTime: number; stepSize: number; restrictive: boolean; material: string | null };
  batterySlots?: number; steamPerSecondMax?: number; turbineEfficiency?: number;
}
export interface StructureLine { id: number; size: [number, number, number]; controller: [number, number, number]; palette: Array<{ id: string; meta: number; mte?: number }>; blocks: Array<[number, number, number, number]>; air: Array<[number, number, number]>; truncated?: true }
export interface MaterialLine { name: string; dn?: string | null; rgba: [number, number, number, number]; iconSet: string; byproducts: string[]; oreMultiplier?: number; byproductMultiplier?: number }
export interface OreMaterialLine { key: string; family: 'gt' | 'bw' | 'gtpp'; name: string; id?: number; dn?: string | null; rgba?: [number, number, number, number]; iconSet?: string; byproducts: string[]; parts: Partial<Record<OrePart, number>> }
export interface DimensionLine { id: number | null; provider?: string | null; name: string; display?: string | null; mod?: string | null; ore?: { type: string; veinChance?: number; voidMinable: boolean }; body?: string | null; airIntake?: string | null }
export interface CelestialLine { name: string; display?: string | null; kind: 'star' | 'planet' | 'moon' | 'satellite'; parent?: string | null; tier: number; dim?: number | null; reachable: boolean }
export interface OreVeinLine { name: string; weight: number; density: number; size: number; dims: string[]; yByDim: Record<string, [number, number]>; primary: string; secondary: string; between: string; sporadic: string; stoneSpecific: boolean }
export interface SmallOreLine { name: string; amount: number; y: [number, number]; dims: string[]; material: string }
export interface UndergroundFluidLine { key: string; dims: number[]; fluids: Array<{ fluid: string; chance: number; min: number; max: number; decrease: number }> }
export interface VoidMinerLine { dim: string; drops: Array<{ item: number; weight: number }>; extra: Array<{ item: number; weight: number }> }
export interface GasSiphonLine { planet: string; tier: number; depths: Array<[depth: number, fluid: string, amount: number]> }
export interface SpacePumpLine { planetType: number; gasType: number; fluid: string; amount: number }
export interface SpaceAsteroidLine { name: string; outputs: number[]; chances: number[]; moduleTier: number; droneTiers: [number, number]; distance: [number, number]; weight: number }
/**
 * A CropsNH crop card (exporter 0.5.0 and later), lines in CropsNH's registration order: `duration` in growth points;
 * `dropChance` CropsNH's float, widened exactly; each drop's `count` its stack size and `chance` on the 1/10000 scale,
 * always written, the likeliest drop first; `liked` biome dictionary tags by name; `soils` by item key; `requirements`
 * the simple class names of its growth requirements in the card's order; `seed` null for a card without a seed item;
 * `minSeedBedTier` −1 for any Seed Bed.
 */
export interface CropLine { id: string; name: string; tier: number; duration: number; dropChance: number; drops: Array<{ item: number; count: number; chance: number }>; liked: string[]; soils: number[]; requirements: string[]; seed: number | null; minSeedBedTier: number }

export interface ExportLineTypes {
  items: ItemLine; fluids: FluidLine; fluidContainers: FluidContainerLine; oreDict: OreDictLine; recipeMaps: RecipeMapLine;
  recipesGt: GtRecipeLine; recipesAssemblyLine: AssemblyLineLine; recipesCrafting: CraftingLine; recipesFurnace: FurnaceLine;
  machines: MachineLine; structures: StructureLine; materials: MaterialLine; oreMaterials: OreMaterialLine;
  dimensions: DimensionLine; celestial: CelestialLine; oreVeins: OreVeinLine; smallOres: SmallOreLine;
  undergroundFluids: UndergroundFluidLine; voidMiner: VoidMinerLine; gasSiphon: GasSiphonLine; spacePump: SpacePumpLine; spaceAsteroids: SpaceAsteroidLine;
  crops: CropLine;
}
export type ExportFileKey = keyof ExportLineTypes;
export const EXPORT_FILES: { readonly manifest: 'manifest.json' } & { readonly [K in ExportFileKey]: string } = {
  manifest: 'manifest.json',
  items: 'items.jsonl.gz', fluids: 'fluids.jsonl.gz', fluidContainers: 'fluid-containers.jsonl.gz', oreDict: 'oredict.jsonl.gz',
  recipeMaps: 'recipe-maps.jsonl.gz', recipesGt: 'recipes-gt.jsonl.gz', recipesAssemblyLine: 'recipes-assemblyline.jsonl.gz',
  recipesCrafting: 'recipes-crafting.jsonl.gz', recipesFurnace: 'recipes-furnace.jsonl.gz',
  machines: 'machines.jsonl.gz', structures: 'structures.jsonl.gz', materials: 'materials.jsonl.gz', oreMaterials: 'ore-materials.jsonl.gz',
  dimensions: 'dimensions.jsonl.gz', celestial: 'celestial.jsonl.gz', oreVeins: 'ore-veins.jsonl.gz', smallOres: 'small-ores.jsonl.gz',
  undergroundFluids: 'underground-fluids.jsonl.gz', voidMiner: 'void-miner.jsonl.gz', gasSiphon: 'gas-siphon.jsonl.gz',
  spacePump: 'space-pump.jsonl.gz', spaceAsteroids: 'space-asteroids.jsonl.gz',
  crops: 'crops.jsonl.gz',
};
/** Files an export may lack: the crop table comes only from exporter 0.5.0 on, and only with CropsNH installed. */
export const OPTIONAL_EXPORT_FILES: readonly ExportFileKey[] = ['structures', 'crops'];

export interface ManifestFile {
  format: typeof EXPORT_FORMAT; exportId: string; exporterVersion: string; exportedAt: string; packVersion: string; gtVersion: string;
  mods: Record<string, string>; counts: Partial<Record<ExportFileKey, number>>;   // counts[k] = number of lines in EXPORT_FILES[k]
  nameFailures: number; nameFailureSamples: string[]; sectionMillis: Record<string, number>;
  failedSections: string[]; skippedSections: string[]; warnings: string[];
}
