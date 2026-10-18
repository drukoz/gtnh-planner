// Reachable dimensions and material availability (spec §3.3; materials-availability §5.4, §8.1–§8.4): which dimensions
// and capabilities the group can use at its tier, which goods it can get from them (a forward-chaining fixpoint over the
// recipes it can run), where each good comes from, and what would unlock a good it cannot get yet.

import { defaultCoilHeat } from '../../shared/gt/overclock.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import type { OrePart, Pack, Recipe, Worldgen } from '../../shared/types/pack.ts';
import { FREE_KEYS, type LeafClass, type PlanSettings, type ReachableDim, type SourceInfo } from '../../shared/types/plan.ts';
import { acceptRecipe, type PlanEnv } from './candidates.ts';

const MAX_TIER = V.length - 1;
const OVERWORLD = 'overworld';
const ASTEROIDS = 'asteroids';
/** The capability key of low-gravity processing (architecture §11.4); an explicit override of it decides `lowGravity`. */
const LOW_GRAVITY = 'low_gravity';
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);
/** The ore-processing parts of a material (`GtMaterial.parts`) that are base items: everything but crushed ore. */
const BASE_PARTS: readonly OrePart[] = ['ore', 'rawOre', 'dust', 'ingot', 'gem'];
const CACHE_SIZE = 32;
const PROGRESSION: PlanSettings['dims'] = Object.freeze({ policy: 'progression', overrides: Object.freeze({}) });

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** GT's ore block prefixes (`ore`, `oreNetherrack`, `oreSmall`…) and the raw ore. */
export function isOrePrefix(prefix: string): boolean {
  return prefix === 'rawOre' || prefix.startsWith('ore');
}

/** The GT prefixes of base items; every ore prefix (`isOrePrefix`) counts too. */
export const BASE_PREFIXES: ReadonlySet<string> = new Set(['dust', 'ingot', 'gem', 'rawOre']);

function isBasePrefix(prefix: string): boolean {
  return BASE_PREFIXES.has(prefix) || isOrePrefix(prefix);
}

export interface Reachability { reachable: ReachableDim[] /* sorted by key; dimensions and capabilities */; keys: ReadonlySet<string>; lowGravity: boolean }

/**
 * The dimensions and capabilities the group can use at `tier`. A dimension: an `off` override keeps it out, an `on`
 * override puts it in; otherwise it is in when visited, or by progression when its default tier is reached (overworld
 * always). A capability: overrides as above; otherwise in from its minimum tier when its dimension (if any) is in.
 * Keys the pack's worldgen does not list are ignored.
 */
export function reachableDims(worldgen: Worldgen, dims: PlanSettings['dims'], visited: readonly string[], tier: number): Reachability {
  const overrideOf = (key: string): 'on' | 'off' | undefined => (Object.hasOwn(dims.overrides, key) ? dims.overrides[key] : undefined);
  const wasVisited = new Set(visited);
  const why = new Map<string, ReachableDim['why']>();

  for (const dim of worldgen.dimensions) {
    if (why.has(dim.key)) continue;
    const override = overrideOf(dim.key);
    if (override === 'off') continue;
    if (override === 'on') why.set(dim.key, 'override');
    else if (wasVisited.has(dim.key)) why.set(dim.key, 'visited');
    else if ((dims.policy === 'progression' && dim.defaultTier <= tier) || dim.key === OVERWORLD) why.set(dim.key, 'progression');
  }
  // Low-gravity recipes run on a space station or in the Asteroids dimension, not on the Moon or planets (§5.4).
  const lowGravityPlace = worldgen.dimensions.some((dim) => why.has(dim.key) && (dim.kind === 'station' || dim.key === ASTEROIDS));

  for (const capability of worldgen.capabilities) {
    if (why.has(capability.key)) continue;
    const override = overrideOf(capability.key);
    if (override === 'off') continue;
    if (override === 'on') why.set(capability.key, 'override');
    else if (tier >= capability.minTier && (capability.dim === undefined || why.has(capability.dim))) why.set(capability.key, 'progression');
  }

  const lowGravityOverride = overrideOf(LOW_GRAVITY);
  return {
    reachable: [...why].map(([key, reason]) => ({ key, why: reason })).sort((a, b) => byString(a.key, b.key)),
    keys: new Set(why.keys()),
    lowGravity: lowGravityOverride === undefined ? lowGravityPlace : lowGravityOverride === 'on',
  };
}

interface PackFacts {
  /** Base parts of materials (`GtMaterial.parts`), for items the GT unificator gives no association. */
  partOf: Map<ItemKey, string /* material */>;
  /** The base items of each material: GT items with a base prefix, and the material's base parts. */
  baseItems: Map<string, StuffKey[]>;
  natural: ReadonlySet<StuffKey>;
  /** Fluids some `worldgen.fluidSources` entry names. */
  sourcedFluids: ReadonlySet<StuffKey>;
  /** Index of each recipe's first input in the flat slot array. */
  slotStart: Int32Array;
  slotTotal: number;
  /** Input slots per recipe. A slot with no option (an ore name that lists no items) is never satisfied. */
  slotCount: Int32Array;
  /** Recipes without any input slot: they fire as soon as the group can run them. */
  inputless: number[];
}

const FACTS = new WeakMap<Pack, PackFacts>();

function baseMaterialWith(pack: Pack, partOf: ReadonlyMap<ItemKey, string>, key: StuffKey): string | undefined {
  const gt = pack.items.get(key)?.gt;
  if (gt !== undefined && isBasePrefix(gt.prefix)) return gt.material;
  return partOf.get(key);
}

function factsOf(pack: Pack): PackFacts {
  let facts = FACTS.get(pack);
  if (facts !== undefined) return facts;

  const partOf = new Map<ItemKey, string>();
  for (const material of pack.materials.values()) {
    for (const part of BASE_PARTS) {
      const key = material.parts?.[part];
      if (key !== undefined && !partOf.has(key)) partOf.set(key, material.name);
    }
  }
  const baseItems = new Map<string, StuffKey[]>();
  const natural = new Set<StuffKey>();
  for (const item of pack.items.values()) {
    const material = baseMaterialWith(pack, partOf, item.key);
    if (material !== undefined) addTo(baseItems, material, item.key);
    else if (item.gt === undefined && (pack.producers.get(item.key)?.length ?? 0) === 0) natural.add(item.key);
  }

  const n = pack.recipes.length;
  const slotStart = new Int32Array(n);
  const slotCount = new Int32Array(n);
  const inputless: number[] = [];
  let slotTotal = 0;
  pack.recipes.forEach((r, i) => {
    slotStart[i] = slotTotal;
    slotTotal += r.inputs.length;
    slotCount[i] = r.inputs.length;
    if (r.inputs.length === 0) inputless.push(i);
  });

  facts = {
    partOf, baseItems, natural, sourcedFluids: new Set(pack.worldgen.fluidSources.map((s) => s.fluid)),
    slotStart, slotTotal, slotCount, inputless,
  };
  FACTS.set(pack, facts);
  return facts;
}

/**
 * A base item (spec §3.3): a free input; an ore, raw ore, dust, ingot or gem (by GT prefix, or as a material's ore
 * part); or a fluid that `worldgen.fluidSources` names. Molten metals are not base: they are made from their ingot.
 */
export function isBaseItem(pack: Pack, key: StuffKey): boolean {
  if (FREE.has(key)) return true;
  const facts = factsOf(pack);
  if (isFluidKey(key)) return facts.sourcedFluids.has(key);
  return baseMaterialWith(pack, facts.partOf, key) !== undefined;
}

/** An item with no GT association that no recipe in the pack produces (logs, sand, mob drops…): gathered by hand. */
export function isNatural(pack: Pack, key: StuffKey): boolean {
  return factsOf(pack).natural.has(key);
}

export interface Availability {
  tier: number; available: ReadonlySet<StuffKey>; classOf(key: StuffKey): LeafClass; sources(key: StuffKey): SourceInfo[];
  why: ReadonlyMap<StuffKey, string /* recipe id */>;
}

/** One way to get a direct material or a sourced fluid, and the reachable keys it relies on. */
interface Source { info: SourceInfo; reach: string[] }

interface State {
  avail: Availability;
  /** Order in which each available good became available (seeds first). */
  rank: ReadonlyMap<StuffKey, number>;
  /** Sources of every direct material, by material name, and of every sourced fluid, by key. */
  materialSources: ReadonlyMap<string, Source[]>;
  fluidSources: ReadonlyMap<StuffKey, Source[]>;
}

function addTo<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function copyOf(info: SourceInfo): SourceInfo {
  return { ...info, dims: [...info.dims] };
}

/** The veins, small ores and capabilities of each material, and the fluid sources, that `env` reaches. */
function reachedSources(worldgen: Worldgen, env: PlanEnv): { materials: Map<string, Source[]>; fluids: Map<StuffKey, Source[]> } {
  const materials = new Map<string, Source[]>();
  for (const vein of worldgen.veins) {
    const dims = vein.dims.filter((d) => env.reachable.has(d));
    if (dims.length === 0) continue;
    const info: SourceInfo = { kind: vein.kind === 'small' ? 'small_ore' : 'vein', dims, detail: vein.name };
    for (const material of unique(Object.values(vein.materials))) addTo(materials, material, { info, reach: dims });
  }
  for (const capability of worldgen.capabilities) {
    if (!env.reachable.has(capability.key)) continue;
    const info: SourceInfo = { kind: 'capability', dims: capability.dim === undefined ? [] : [capability.dim], detail: capability.name };
    for (const material of unique(capability.yields)) addTo(materials, material, { info, reach: [capability.key] });
  }
  const fluids = new Map<StuffKey, Source[]>();
  for (const source of worldgen.fluidSources) {
    if (source.minTier > env.tier) continue;
    const dims = source.dims.filter((d) => env.reachable.has(d));
    if (source.dims.length > 0 && dims.length === 0) continue;   // `dims: []` needs no dimension
    addTo(fluids, source.fluid, { info: { kind: 'fluid', dims, detail: source.kind }, reach: dims });
  }
  return { materials, fluids };
}

/** The input option of each slot of `r` that became available first: the ones that let it fire. */
function firstOptions(r: Recipe, rank: ReadonlyMap<StuffKey, number>): StuffKey[] {
  const keys: StuffKey[] = [];
  for (const ing of r.inputs) {
    let best: StuffKey | undefined;
    let bestRank = Infinity;
    for (const { key } of ing.options) {
      const at = rank.get(key);
      if (at !== undefined && at < bestRank) {
        best = key;
        bestRank = at;
      }
    }
    if (best !== undefined) keys.push(best);
  }
  return keys;
}

/**
 * materials-availability §8.1: seeds are the free inputs, natural items, the base items of direct materials and the
 * sourced fluids; a recipe the group can run fires once every input slot (consumed or not) has an available option,
 * and makes all its outputs with a chance above 0 available.
 */
function computeState(pack: Pack, env: PlanEnv): State {
  const facts = factsOf(pack);
  const { materials: materialSources, fluids: fluidSources } = reachedSources(pack.worldgen, env);

  const rank = new Map<StuffKey, number>();
  const queue: StuffKey[] = [];
  const why = new Map<StuffKey, string>();
  const add = (key: StuffKey, recipeId?: string): void => {
    if (rank.has(key)) return;
    rank.set(key, queue.length);
    queue.push(key);
    if (recipeId !== undefined) why.set(key, recipeId);
  };

  for (const key of FREE_KEYS) add(key);
  for (const key of facts.natural) add(key);
  const direct = new Set<StuffKey>();
  for (const material of materialSources.keys()) for (const key of facts.baseItems.get(material) ?? []) direct.add(key);
  for (const key of fluidSources.keys()) direct.add(key);
  for (const key of direct) add(key);

  const runs: Array<boolean | undefined> = new Array(pack.recipes.length);
  const canRun = (i: number): boolean => {
    let ok = runs[i];
    if (ok === undefined) {
      ok = acceptRecipe(pack, pack.recipes[i] as Recipe, env).ok;
      runs[i] = ok;
    }
    return ok;
  };
  const fire = (r: Recipe): void => {
    for (const p of r.outputs) if (p.chance > 0) add(p.key, r.id);
  };
  const need = Int32Array.from(facts.slotCount);
  const satisfied = new Uint8Array(facts.slotTotal);

  for (const i of facts.inputless) if (canRun(i)) fire(pack.recipes[i] as Recipe);
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head] as StuffKey;
    for (const i of pack.consumers.get(x) ?? []) {
      if (need[i] === 0 || !canRun(i)) continue;   // fired already, or the group cannot run it
      const r = pack.recipes[i] as Recipe;
      const start = facts.slotStart[i] as number;
      r.inputs.forEach((ing, s) => {
        if (satisfied[start + s] === 1 || !ing.options.some((o) => o.key === x)) return;
        satisfied[start + s] = 1;
        need[i] = (need[i] as number) - 1;
      });
      if (need[i] === 0) fire(r);
    }
  }

  const available: ReadonlySet<StuffKey> = new Set(queue);
  const byproductOf = new Map<string, string[]>();   // byproduct material → the direct materials whose ore yields it
  for (const [material, byproducts] of Object.entries(pack.worldgen.byproducts)) {
    if (!materialSources.has(material)) continue;
    for (const byproduct of unique(byproducts)) addTo(byproductOf, byproduct, material);
  }
  const baseMaterialOf = (key: StuffKey): string | undefined => baseMaterialWith(pack, facts.partOf, key);
  const displayName = (material: string): string => pack.materials.get(material)?.displayName ?? material;

  const classOf = (key: StuffKey): LeafClass => {
    if (FREE.has(key)) return 'free';
    if (facts.natural.has(key)) return 'natural';
    if (direct.has(key)) return 'direct';
    if (!available.has(key)) return 'unavailable';
    const material = baseMaterialOf(key);
    return material !== undefined && byproductOf.has(material) ? 'byproduct' : 'derived';
  };

  const derivedSource = (key: StuffKey): SourceInfo[] => {
    const r = pack.recipeById.get(why.get(key) ?? '');
    if (r === undefined) return [];
    const accepted = acceptRecipe(pack, r, env);
    const mapId = accepted.ok ? accepted.mapId : (r.maps[0] ?? '');
    const inputs = firstOptions(r, rank).map((k) => pack.nameOf(k));
    const by = `made by ${pack.maps.get(mapId)?.name ?? mapId}`;
    return [{ kind: 'derived', dims: [], detail: inputs.length > 0 ? `${by} from ${inputs.join(', ')}` : by }];
  };

  const sources = (key: StuffKey): SourceInfo[] => {
    switch (classOf(key)) {
      case 'free':
        return [{ kind: 'natural', dims: [], detail: 'free' }];
      case 'natural':
        return [{ kind: 'natural', dims: [OVERWORLD], detail: 'gathered by hand' }];
      case 'direct': {
        const list = isFluidKey(key) ? fluidSources.get(key) : materialSources.get(baseMaterialOf(key) ?? '');
        return (list ?? []).map((s) => copyOf(s.info));
      }
      case 'byproduct':
        return (byproductOf.get(baseMaterialOf(key) ?? '') ?? []).map((material) => ({
          kind: 'byproduct', dims: unique((materialSources.get(material) ?? []).flatMap((s) => s.info.dims)),
          detail: `byproduct of ${displayName(material)} ore`,
        }));
      case 'derived':
        return derivedSource(key);
      default:
        return [];
    }
  };

  return { avail: { tier: env.tier, available, classOf, sources, why }, rank, materialSources, fluidSources };
}

/** Availability results per pack, keyed by the env's content; the least recently used entry goes first. */
const STATES = new WeakMap<Pack, Map<string, State>>();

function stateFor(pack: Pack, env: PlanEnv): State {
  let perPack = STATES.get(pack);
  if (perPack === undefined) {
    perPack = new Map();
    STATES.set(pack, perPack);
  }
  const reachable = [...env.reachable].sort(byString);
  const excluded = [...env.excluded].sort(byString);
  const key = JSON.stringify([env.tier, reachable, env.lowGravity, env.coilHeat, excluded]);
  let state = perPack.get(key);
  if (state !== undefined) {
    perPack.delete(key);
  } else {
    // A snapshot: the caller may change its own sets later, the cached result must not.
    state = computeState(pack, { tier: env.tier, reachable: new Set(reachable), lowGravity: env.lowGravity, coilHeat: env.coilHeat, excluded: new Set(excluded) });
    if (perPack.size >= CACHE_SIZE) perPack.delete(perPack.keys().next().value as string);
  }
  perPack.set(key, state);
  return state;
}

/** Which goods the group can get at `env` and how (materials-availability §8.1); cached per pack and env, 32 entries. */
export function computeAvailability(pack: Pack, env: PlanEnv): Availability {
  return stateFor(pack, env).avail;
}

/** The goods without a recipe behind them (free, natural, direct) that `key` was first made from. */
function seedsOf(pack: Pack, state: State, key: StuffKey): StuffKey[] {
  const seeds: StuffKey[] = [];
  const seen = new Set<StuffKey>();
  const stack = [key];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const r = pack.recipeById.get(state.avail.why.get(next) ?? '');
    if (r === undefined) seeds.push(next);
    else stack.push(...firstOptions(r, state.rank));   // each became available before `next`, so this ends
  }
  return seeds;
}

/** The sources of a seed that is a direct material's base item or a sourced fluid (none for free and natural goods). */
function sourcesOf(pack: Pack, state: State, seed: StuffKey): Source[] {
  const list = isFluidKey(seed)
    ? state.fluidSources.get(seed)
    : state.materialSources.get(baseMaterialWith(pack, factsOf(pack).partOf, seed) ?? '');
  return list ?? [];
}

/** Dimension (with its rocket tier) and capability names of `keys`, in the pack's order. */
function placeNames(worldgen: Worldgen, keys: ReadonlySet<string>): string[] {
  const names: string[] = [];
  for (const dim of worldgen.dimensions) {
    if (keys.has(dim.key)) names.push(dim.rocketTier === undefined ? dim.name : `${dim.name} (T${dim.rocketTier} rocket)`);
  }
  for (const capability of worldgen.capabilities) if (keys.has(capability.key)) names.push(capability.name);
  return names;
}

/**
 * What would make `key` available (materials-availability §8.1 "Unlock hints"): the first tier above `from.env.tier`
 * at which progression defaults (same visited dimensions, the tier's default coils unless the project sets them) make
 * it available, and the dimensions new at that tier that its first chain relies on: only the seeds that first appear
 * at that tier count, so a seed the group already gets, or could get from a place it already reaches (or from no
 * place) once its tier allows, names no dimension.
 */
export function unlockText(pack: Pack, key: StuffKey, from: { env: PlanEnv; settings: PlanSettings; visited: readonly string[] }): string {
  const name = pack.nameOf(key);
  for (let tier = from.env.tier + 1; tier <= MAX_TIER; tier++) {
    const reach = reachableDims(pack.worldgen, PROGRESSION, from.visited, tier);
    const state = stateFor(pack, {
      tier, reachable: reach.keys, lowGravity: reach.lowGravity, coilHeat: from.settings.coilHeat ?? defaultCoilHeat(tier), excluded: from.env.excluded,
    });
    if (!state.avail.available.has(key)) continue;
    const now = stateFor(pack, from.env).avail.available;
    const reachedNow = (s: Source): boolean => s.reach.length === 0 || s.reach.some((place) => from.env.reachable.has(place));
    const added = new Set<string>();
    for (const seed of seedsOf(pack, state, key)) {
      if (now.has(seed)) continue;
      const sources = sourcesOf(pack, state, seed);
      if (sources.some(reachedNow)) continue;   // a fluid source the group reaches, gated only by its minimum tier
      for (const s of sources) for (const place of s.reach) added.add(place);
    }
    const places = placeNames(pack.worldgen, added);
    return places.length > 0 ? `${name}: needs ${places.join(' or ')} — reachable at ${tierName(tier)}` : `${name}: needs ${tierName(tier)} machines`;
  }
  return `${name}: no source in this pack's data`;
}
