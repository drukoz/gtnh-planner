// Worldgen converters (architecture §6.2, §11.4; materials-availability.md §1.6, §1.7, §2, §5, §8.2): the nine
// worldgen files become the pack's `Worldgen` — dimensions with the tier at which progression assumes access, ore veins
// and small ores, fluid sources, location-bound capabilities and ore byproducts.
//
// Dimension keys are GT ore-gen names in lower case without whitespace, plus `endasteroid` (a region of The End) and
// `station:<planet>` (space stations, id null). Material keys become names through the `nameOfKey` map of
// materials.ts. Item indices go through `LoadContext.items`; load.ts checks them before the lines get here.

import { tierName } from '../../shared/gt/tiers.ts';
import { fluidKey, type FluidKey, type ItemKey } from '../../shared/keys.ts';
import type { Capability, DimensionInfo, FluidSource, GtMaterial, Item, OreVein, Worldgen } from '../../shared/types/pack.ts';
import type {
  CelestialLine, DimensionLine, GasSiphonLine, OreVeinLine, SmallOreLine, SpaceAsteroidLine, SpacePumpLine,
  UndergroundFluidLine, VoidMinerLine,
} from './format.ts';
import type { LoadContext } from './load.ts';
import { materialNameResolver } from './materials.ts';

/** The GT ore-gen name as a dimension key: lower case, all whitespace removed (`The End` → `theend`). */
export function dimKey(gtName: string): string {
  return gtName.toLowerCase().replace(/\s+/g, '');
}

/** The default tier of a dimension the tier table does not know: MAX, so the planner never assumes it is reachable. */
export const UNKNOWN_DIM_TIER = 14;

/** Rocket tier (index) → the voltage tier the quest book ties it to (materials-availability.md §5.2). */
export const ROCKET_TIER_DEFAULT: readonly number[] = Object.freeze([0, 3, 4, 5, 5, 6, 7, 8, 9, 10]);

/**
 * The lowest voltage tier of each location-bound source (materials-availability.md §1.6, §1.7, §2.1, §2.5, §8.2). The
 * air-intake hatch tier is not researched, so it adds no gate beyond the dimension. `spaceElevatorMining` holds the
 * mining modules MK-I, MK-II and MK-III.
 */
export const CAPABILITY_MIN_TIER = Object.freeze({
  undergroundFluid: 2, airIntake: 0, voidMiner: 6, deepDarkVoidMiner: 11, spaceElevatorMining: [8, 9, 10], spacePump: 9, lowGravity: 3,
} as const);

export interface TierDefault { tier: number; evidence: string }

/** Rows of the tier table: dimension keys, voltage tier, quest-book evidence. */
const TIER_TABLE: ReadonlyArray<readonly [keys: readonly string[], tier: number, evidence: string]> = [
  [['overworld'], 0, 'start'],
  [['nether'], 0, 'quest #479 "THE NETHER" (Tier05Steam)'],
  [['twilightforest'], 1, 'quest #225 "Searching for Answers"'],
  [['theend', 'endasteroid'], 3, 'quest #986 needs "Ender Eyes" #1233 (Tier3HV)'],
  [['moon'], 3, 'quest #162 "Dimensional Goal: Moon" (Tier3HV), rocket T1'],
  [['mars', 'phobos', 'deimos'], 4, 'quest #176 "Tier 4 (EV)", rocket T2'],
  [['asteroids', 'ceres', 'europa', 'ganymed', 'callisto', 'ross128b'], 5, 'quest #215 (Tier5IV), #2311 "Ross128b Trip", rocket T3'],
  [['iojupiter', 'venus', 'mercury'], 5, 'quest #1715 "On Your Way to Tier 4 DIMs" (Tier5IV), rocket T4'],
  [['enceladus', 'titan', 'miranda', 'oberon', 'ross128ba'], 6, '"Getting Europium", "Fetching Prasiolite" (Tier6LuV), rocket T5'],
  [['dimensiondarkworld'], 7, 'quest #2634 "A Vision of the Future" (Tier7ZPM)'],
  [['proteus', 'triton'], 7, 'quest #2640 "Rocket Tier 6" (ZPM with the GT++ assembler)'],
  [['pluto', 'kuiperbelt', 'haumea', 'makemake'], 8, '"All Good Things..." (Tier8UV), rocket T7'],
  [['centauribb', 'barnarda2', 'barnarda4', 'barnarda5', 'tcetie', 'vega1'], 9, '"UHV Energy Hatch" (Tier9UHV), rocket T8'],
  [['neper', 'maahes', 'anubis', 'horus', 'seth', 'asteroidbeltmehen'], 10, '"The Final Frontier!" (Tier10UEV), mothership'],
  [['underdark'], 11, 'quest #2413 "The Darkness of Choice for Edgelords"'],
  [['station:overworld'], 3, 'quest #1067 "Space Station" (HV)'],
  [['station:mars'], 4, 'Mars station, rocket T2'],
  [['station:jupiter', 'station:venus'], 5, 'station tiers 3 and 4 (IV)'],
  [['station:saturn', 'station:uranus'], 6, 'station tier 5 (LuV)'],
  [['station:neptune'], 7, 'station tier 6 (ZPM)'],
];

/**
 * The hand-maintained tier table (our own data with quest evidence, materials-availability.md §8.2): dimension key →
 * the voltage tier at which progression assumes access. Re-check the quest ids on pack upgrades.
 */
export const TIER_DEFAULTS: Readonly<Record<string, TierDefault>> = Object.freeze(Object.fromEntries(
  TIER_TABLE.flatMap(([keys, tier, evidence]) => keys.map((key) => [key, Object.freeze({ tier, evidence })])),
));

export interface WorldgenInput {
  dimensions: DimensionLine[]; celestial: CelestialLine[]; veins: OreVeinLine[]; smallOres: SmallOreLine[];
  undergroundFluids: UndergroundFluidLine[]; voidMiner: VoidMinerLine[]; gasSiphon: GasSiphonLine[]; spacePump: SpacePumpLine[];
  spaceAsteroids: SpaceAsteroidLine[];
}

/** The materials, ore keys and items that veins, capabilities and byproducts name. */
export interface WorldgenMaterials {
  materials: ReadonlyMap<string, GtMaterial>; nameOfKey: ReadonlyMap<string, string>; items: ReadonlyMap<ItemKey, Item>;
}

type Warn = (message: string) => void;
type MaterialNameOf = (key: string, usedBy: string) => string;

const THE_END = 'theend';
/** The Far End Asteroids: GT's ore-gen region of The End beyond its main island. */
const END_ASTEROIDS = { key: 'endasteroid', name: 'Far End Asteroids', mod: 'gregtech' } as const;
/** Minecraft's id of The End, for the region when the export has no The End line. */
const THE_END_ID = 1;
const DEEP_DARK = 'underdark';
const STATION_PREFIX = 'station:';
const STATION_MOD = 'Galacticraft';
/** Where the low-gravity recipes run: the Overworld space station is the first one (materials-availability.md §5.4). */
const LOW_GRAVITY_STATION = 'station:overworld';
/** Y range of a vein whose line has none. */
const WORLD_Y_RANGE = [0, 255] as const;
const SPACE_ELEVATOR_MODULES = [
  { key: 'space_elevator_mining', name: 'Space Elevator mining module MK-I', moduleTier: 1, minTier: CAPABILITY_MIN_TIER.spaceElevatorMining[0] },
  { key: 'space_elevator_mining_mk2', name: 'Space Elevator mining module MK-II', moduleTier: 2, minTier: CAPABILITY_MIN_TIER.spaceElevatorMining[1] },
  { key: 'space_elevator_mining_mk3', name: 'Space Elevator mining module MK-III', moduleTier: 3, minTier: CAPABILITY_MIN_TIER.spaceElevatorMining[2] },
] as const;

function tierDefaultOf(key: string): TierDefault | undefined {
  return Object.hasOwn(TIER_DEFAULTS, key) ? TIER_DEFAULTS[key] : undefined;
}

function stationKey(planet: string): string {
  return STATION_PREFIX + dimKey(planet);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/**
 * The table's tier, else `UNKNOWN_DIM_TIER`; a dimension the table does not know warns when it matters for
 * progression (it has ores or a rocket tier).
 */
function defaultTierOf(key: string, name: string, matters: boolean, warn: Warn): number {
  const known = tierDefaultOf(key);
  if (known !== undefined) return known.tier;
  if (matters) warn(`dimension ${key} (${name}) is not in the tier table; assuming ${tierName(UNKNOWN_DIM_TIER)} (${UNKNOWN_DIM_TIER})`);
  return UNKNOWN_DIM_TIER;
}

function kindOf(key: string, line: DimensionLine, body: CelestialLine | undefined): DimensionInfo['kind'] {
  if (key === END_ASTEROIDS.key) return 'region';
  if (body?.kind === 'planet' || body?.kind === 'moon') return body.kind;
  if (line.ore?.type === 'Asteroid') return 'asteroids';
  return 'dimension';
}

/**
 * One `DimensionInfo` per dimension line, then one per space station (celestial satellites); the first key wins.
 * Also returns the air-intake fluid of every dimension that has one.
 */
function buildDimensions(lines: readonly DimensionLine[], celestial: readonly CelestialLine[], warn: Warn): { dimensions: DimensionInfo[]; airIntakes: Array<{ dim: DimensionInfo; fluid: string }> } {
  const bodies = new Map<string, CelestialLine>();
  for (const body of celestial) if (!bodies.has(body.name)) bodies.set(body.name, body);
  const endId = lines.find((line) => dimKey(line.name) === THE_END)?.id;

  const byKey = new Map<string, DimensionInfo>();
  const isNew = (key: string, source: string): boolean => {
    if (!byKey.has(key)) return true;
    warn(`${source}: duplicate dimension key ${key} ignored, the first one wins`);
    return false;
  };

  const airIntakes: Array<{ dim: DimensionInfo; fluid: string }> = [];
  for (const line of lines) {
    const key = dimKey(line.name);
    if (!isNew(key, `dimension ${line.name}`)) continue;
    const body = line.body ? bodies.get(line.body) : undefined;
    if (line.body && body === undefined) warn(`dimension ${key}: celestial body ${line.body} not found`);
    const region = key === END_ASTEROIDS.key;
    const name = region ? END_ASTEROIDS.name : line.display || line.name;
    const rocketTier = body !== undefined && body.reachable && body.tier > 0 ? body.tier : undefined;
    const dim: DimensionInfo = {
      key, id: region ? endId ?? line.id ?? THE_END_ID : line.id, name, mod: region ? END_ASTEROIDS.mod : line.mod || 'unknown',
      kind: kindOf(key, line, body), defaultTier: defaultTierOf(key, name, line.ore !== undefined || rocketTier !== undefined, warn),
    };
    if (rocketTier !== undefined) dim.rocketTier = rocketTier;
    byKey.set(key, dim);
    if (line.airIntake) airIntakes.push({ dim, fluid: line.airIntake });
  }

  for (const body of celestial) {
    if (body.kind !== 'satellite') continue;
    if (!body.parent) {
      warn(`space station ${body.name}: no parent planet, ignored`);
      continue;
    }
    const key = stationKey(body.parent);
    if (!isNew(key, `space station ${body.name}`)) continue;
    const name = body.display || body.name;
    byKey.set(key, { key, id: null, name, mod: STATION_MOD, kind: 'station', rocketTier: body.tier, defaultTier: defaultTierOf(key, name, true, warn) });
  }
  return { dimensions: [...byKey.values()], airIntakes };
}

function toVein(line: OreVeinLine, nameOf: MaterialNameOf, warn: Warn): OreVein {
  const usedBy = `ore vein ${line.name}`;
  const ranges = Object.values(line.yByDim);
  if (ranges.length === 0) warn(`${usedBy}: no y range, assuming ${WORLD_Y_RANGE[0]}..${WORLD_Y_RANGE[1]}`);
  return {
    name: line.name, dims: unique(line.dims.map(dimKey)),
    materials: {
      primary: nameOf(line.primary, usedBy), secondary: nameOf(line.secondary, usedBy),
      between: nameOf(line.between, usedBy), sporadic: nameOf(line.sporadic, usedBy),
    },
    weight: line.weight,
    minY: ranges.length === 0 ? WORLD_Y_RANGE[0] : Math.min(...ranges.map(([low]) => low)),
    maxY: ranges.length === 0 ? WORLD_Y_RANGE[1] : Math.max(...ranges.map(([, high]) => high)),
    size: line.size, density: line.density, kind: 'vein',
  };
}

function toSmallOre(line: SmallOreLine, nameOf: MaterialNameOf): OreVein {
  const material = nameOf(line.material, `small ore ${line.name}`);
  return {
    name: line.name, dims: unique(line.dims.map(dimKey)),
    materials: { primary: material, secondary: material, between: material, sporadic: material },
    weight: line.amount, minY: line.y[0], maxY: line.y[1], size: 0, density: 0, kind: 'small',
  };
}

/**
 * One source per kind, fluid and minimum tier, with the dimensions of every entry united in first-seen order. An
 * underground entry whose dimension ids are all unknown adds nothing (`dims: []` would mean "needs no dimension").
 */
function buildFluidSources(input: WorldgenInput, dimensions: readonly DimensionInfo[], airIntakes: ReadonlyArray<{ dim: DimensionInfo; fluid: string }>, warn: Warn): FluidSource[] {
  const keysById = new Map<number, string[]>();
  for (const dim of dimensions) {
    if (dim.id === null) continue;
    const keys = keysById.get(dim.id);
    if (keys === undefined) keysById.set(dim.id, [dim.key]);
    else keys.push(dim.key);
  }
  const sources = new Map<string, FluidSource>();
  const add = (kind: FluidSource['kind'], fluid: FluidKey, dims: readonly string[], minTier: number): void => {
    const id = `${kind} ${minTier} ${fluid}`;
    const source = sources.get(id);
    if (source === undefined) sources.set(id, { fluid, kind, dims: unique(dims), minTier });
    else for (const dim of dims) if (!source.dims.includes(dim)) source.dims.push(dim);
  };

  for (const entry of input.undergroundFluids) {
    const unknown = entry.dims.filter((id) => !keysById.has(id));
    if (unknown.length > 0) warn(`underground fluids ${entry.key}: unknown dimension id(s) ${unknown.join(', ')} skipped`);
    const dims = unique(entry.dims.flatMap((id) => keysById.get(id) ?? []));
    if (dims.length === 0) continue;
    for (const { fluid } of entry.fluids) add('underground', fluidKey(fluid), dims, CAPABILITY_MIN_TIER.undergroundFluid);
  }
  for (const { dim, fluid } of airIntakes) {
    add('air_intake', fluidKey(fluid), dim.id === null ? [dim.key] : keysById.get(dim.id) ?? [dim.key], CAPABILITY_MIN_TIER.airIntake);
  }
  for (const line of input.gasSiphon) {
    const station = stationKey(line.planet);
    const minTier = tierDefaultOf(station)?.tier ?? ROCKET_TIER_DEFAULT[line.tier] ?? UNKNOWN_DIM_TIER;
    for (const [, fluid] of line.depths) add('gas_siphon', fluidKey(fluid), [station], minTier);
  }
  for (const line of input.spacePump) add('space_pump', fluidKey(line.fluid), [], CAPABILITY_MIN_TIER.spacePump);
  return [...sources.values()];
}

/**
 * Void miners per dimension (the Deep Dark has its own), the three Space Elevator mining modules when the export has
 * asteroids, and low-gravity processing. Yields are the sorted, unique material names of the items a source gives:
 * an item's GT material, else the material whose ore parts hold it; items without one are skipped with one warning per
 * line.
 */
function buildCapabilities(input: WorldgenInput, dimensions: readonly DimensionInfo[], ctx: LoadContext, mats: WorldgenMaterials, warn: Warn): Capability[] {
  const partOwner = new Map<ItemKey, string>();
  for (const material of mats.materials.values()) {
    for (const key of Object.values(material.parts ?? {})) if (!partOwner.has(key)) partOwner.set(key, material.name);
  }
  const materialsOf = (indices: readonly number[], usedBy: string): string[] => {
    const names = new Set<string>();
    let unmatched = 0;
    for (const i of indices) {
      const key = ctx.items.optionsAt(i)[0] as ItemKey;
      const name = mats.items.get(key)?.gt?.material ?? partOwner.get(key);
      if (name === undefined) unmatched += 1;
      else names.add(name);
    }
    if (unmatched > 0) warn(`${usedBy}: ${unmatched} item(s) without a material skipped`);
    return [...names].sort();
  };

  const nameByKey = new Map(dimensions.map((dim) => [dim.key, dim.name]));
  const capabilities: Capability[] = [];
  const seen = new Set<string>();
  for (const line of input.voidMiner) {
    const dim = dimKey(line.dim);
    const usedBy = `void miner ${line.dim}`;
    const yields = materialsOf([...line.drops, ...line.extra].map(({ item }) => item), usedBy);
    const capability: Capability = dim === DEEP_DARK
      ? { key: 'deep_dark_void_miner', name: 'Void miner in the Deep Dark', minTier: CAPABILITY_MIN_TIER.deepDarkVoidMiner, dim, yields }
      : { key: `void_miner:${dim}`, name: `Void miner on ${nameByKey.get(dim) ?? line.dim}`, minTier: CAPABILITY_MIN_TIER.voidMiner, dim, yields };
    if (seen.has(capability.key)) {
      warn(`${usedBy}: duplicate capability ${capability.key} ignored, the first line wins`);
      continue;
    }
    seen.add(capability.key);
    capabilities.push(capability);
  }

  if (input.spaceAsteroids.length > 0) {
    const asteroids = input.spaceAsteroids.map((line) => ({ moduleTier: line.moduleTier, yields: materialsOf(line.outputs, `space asteroid ${line.name}`) }));
    for (const { key, name, moduleTier, minTier } of SPACE_ELEVATOR_MODULES) {
      const yields = unique(asteroids.filter((a) => a.moduleTier <= moduleTier).flatMap((a) => a.yields)).sort();
      capabilities.push({ key, name, minTier, yields });
    }
  }
  capabilities.push({ key: 'low_gravity', name: 'Low-gravity processing (space station)', minTier: CAPABILITY_MIN_TIER.lowGravity, dim: LOW_GRAVITY_STATION, yields: [] });
  return capabilities;
}

/** The ore byproducts of every material that has an ore part or appears in a vein or small ore. */
function buildByproducts(materials: ReadonlyMap<string, GtMaterial>, veins: readonly OreVein[]): Worldgen['byproducts'] {
  const inVeins = new Set(veins.flatMap((vein) => Object.values(vein.materials)));
  const entries: Array<[string, string[]]> = [];
  for (const material of materials.values()) {
    if (material.parts?.ore !== undefined || inVeins.has(material.name)) entries.push([material.name, [...material.oreByproducts]]);
  }
  return Object.fromEntries(entries);
}

/** The pack's worldgen from the nine worldgen files; `mats` comes from materials.ts and the loaded items. */
export function buildWorldgen(input: WorldgenInput, ctx: LoadContext, mats: WorldgenMaterials): Worldgen {
  const warn = (message: string): void => ctx.warn(message);
  const { dimensions, airIntakes } = buildDimensions(input.dimensions, input.celestial, warn);
  const nameOf = materialNameResolver(mats.nameOfKey, warn);
  const veins = [...input.veins.map((line) => toVein(line, nameOf, warn)), ...input.smallOres.map((line) => toSmallOre(line, nameOf))];
  return {
    dimensions, veins,
    fluidSources: buildFluidSources(input, dimensions, airIntakes, warn),
    capabilities: buildCapabilities(input, dimensions, ctx, mats, warn),
    byproducts: buildByproducts(mats.materials, veins),
  };
}
