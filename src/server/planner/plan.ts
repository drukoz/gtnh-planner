// The line planner (spec §3.2–§3.11): one pass from a project's settings and world context to the whole `Plan` — the
// candidate recipes, raw-material costs and alternatives, the solve (around the materials the project avoids, §3.3, and
// the machines that cannot be built here, weighing what the new machines cost to build: plan 12), machines per step
// (rate) or whole crafts on owned machines (Make N), the raw inputs with their sources, power, what the plan costs to
// run and to build, the build list and build steps, and the English names the client shows. Also the settings hash and
// the plan cache the plan route keys on (architecture §7, §11.8).

import { formatNumber, formatRate } from '../../shared/format.ts';
import { PSEUDO_IDS, V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, noteWarningCode, type PlanIssue } from '../../shared/plan/balance.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { DimensionInfo, Ingredient, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import {
  DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_RAW_CAP, DEFAULT_STEP_CHARGE, FREE_KEYS, type BomLine, type DeliberateSplit, type LeafClass, type Plan, type PlanContext,
  type PlanFlow, type PlanSettings, type PlanStep, type PlanWarning, type PowerSummary, type RawInput, type SourceInfo, type StepOption,
} from '../../shared/types/plan.ts';
import { GATHERED_BLOCKS, isBaseItem, unlockText, type Availability } from './availability.ts';
import { buildCostCounts, gatheredRecipesOn, planBasis, resolveAvoid, settingsHash, type PlanBasis } from './basis.ts';
import { benchLine, type BenchLine } from './benches.ts';
import { buildBom, stepProductName } from './bom.ts';
import { machineBuildCost } from './build-cost.ts';
import {
  EXCLUSION_RULES, acceptRecipe, buildCandidates, heldOption, keptOptions, usesAvoided, type Acceptance, type CandidateGraph, type HeldAvoid,
  type LeafDecision, type LeafOracle, type LpRecipe, type PlanEnv,
} from './candidates.ts';
import { analyzeCosts, moltenMaterial, type CostAnalysis } from './costs.ts';
import { supportingLines } from './lines.ts';
import { buildCounts, lineBuildModel, type BuildModel } from './machine-options.ts';
import { buildFlows, emptyContainers, optionShares, planSteps, stepLine, type OptionShare, type StepLine } from './machines.ts';
import { makeN, wholeRuns, type MakeNResult } from './make-n.ts';
import { yieldToEventLoop } from './lp.ts';
import { aloneGraph, linePricing, lineWalk, type CostModel, type LinePricing } from './pricing.ts';
import { sig9 } from './round.ts';
import {
  HAND_STEP_WEIGHT, MAX_NAMED_LOOP_RECIPES, solveLine, standaloneCosts, type Solution, type SolveOptions, type Standalone,
} from './solve.ts';
import { buildSteps } from './steps.ts';

export { effectiveTier, settingsHash } from './basis.ts';

const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const HOURS_PER_WEEK = 168;
/**
 * A byproduct-only good counts as bought beyond the group's stock over the horizon (`beyondStockWarnings`) above the
 * stock by more than this share of it, plus this much: the line's purchases are 9 significant digits of a rate.
 */
const BEYOND_STOCK_SLACK = 1e-6;
const DEFAULT_CACHE_SIZE = 32;
/** A machine or amp count this little above a whole number stays whole. */
const TINY = 1e-9;
/** A `build-cost-unknown` warning names at most this many machines, then counts the rest (plan 12). */
export const MAX_UNPRICED_NAMED = 5;
/**
 * A pinned recipe whose raw material per unit is above this many times the cheapest alternative's gets a `pin-dominated`
 * warning (fix spec D24): the user's resistor pin used 0.783 raw per resistor where another recipe used 0.533.
 */
export const PIN_DOMINATED_SHARE = 1.01;

/**
 * How the line's solves trade steps against raw material (fix spec R3): the project's step charge (a project stored
 * before it gets the default), and a crafting-table step weighs HAND_STEP_WEIGHT steps in a running line whose crafting
 * is not automated (fix spec D7; a Make N batch may be crafted by hand), as does one no Auto Workbench runs in a running
 * line whose crafting is (`byHandWeight`, controller ruling 214); with recipe pins, the pinned recipes, which no twin
 * replaces (`twinMoves`, solve.ts); wherever build cost counts, the project's raw cap (fix wave 3 (A): `DEFAULT_RAW_CAP`
 * for a project stored without one, none at "No limit").
 */
export function solveOptions(settings: PlanSettings): SolveOptions {
  const options: SolveOptions = {
    stepCharge: settings.stepCharge ?? DEFAULT_STEP_CHARGE,
    handWeight: settings.mode === 'rate' && !settings.automateCrafting ? HAND_STEP_WEIGHT : 1,
  };
  // with crafting automated, a crafting-table recipe no Auto Workbench runs is still crafted by hand (controller ruling 214)
  if (settings.mode === 'rate' && settings.automateCrafting) options.byHandWeight = HAND_STEP_WEIGHT;
  const pinned = Object.values(settings.recipeChoice);
  if (pinned.length > 0) options.pinnedRecipes = new Set(pinned);
  // Fix wave 3 (A): the raw cap, wherever build cost counts (the build stage reads it only with a step charge above 0).
  if (buildCostCounts(settings) && settings.rawCap !== null) options.rawCap = settings.rawCap ?? DEFAULT_RAW_CAP;
  return options;
}

/**
 * The group's stock for every production solve of a line (`SolveOptions.stock`, fix wave 3 (C), controller OQ2): what
 * storage holds of each good (`PlanContext.storage`'s `total`; 0 for a good it holds none of, and without a world scan),
 * spread over the build horizon in rate mode (24 hours where build cost is ignored: `DEFAULT_BUILD_HORIZON_HOURS`) or
 * over the batch in Make N, whose demand is the batch itself.
 */
export function groupStock(settings: PlanSettings, ctx: PlanContext): NonNullable<SolveOptions['stock']> {
  const over = settings.mode === 'makeN' ? 1 : (settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS) * SECONDS_PER_HOUR;
  return { over, total: (key) => ctx.storage.get(key)?.total ?? 0 };
}

/**
 * Rule (c) of twin step recipes (`twinMoves`, controller ruling 197 (1); `SolveOptions.formRank`): how players stock a
 * good, by the pack's GT prefix — 0 an ingot, 1 a dust, 2 any other form (a fluid, a plate, an item without a GT one).
 */
export function stockForm(pack: Pack): (key: StuffKey) => number {
  return (key) => {
    const prefix = isFluidKey(key) ? undefined : pack.items.get(key)?.gt?.prefix;
    return prefix === 'ingot' ? 0 : prefix === 'dust' ? 1 : 2;
  };
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0: the power summary (EU/t keep their rounding; rates use `sig9`). */
function round9(x: number): number {
  return Math.round(x * 1e9) / 1e9 || 0;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6 || 0;
}

/** No world scan: nothing owned, nothing in storage, no visited dimensions, tier and coil heat unknown. */
export function emptyContext(): PlanContext {
  return { ownedMachines: [], storage: new Map(), visitedDims: [], topTier: null, coilHeat: null, prospected: [] };
}

/**
 * The plan cache key: export, scan, base (architecture §11.8: another base of the same scan is another `PlanContext`)
 * and settings hash, in the order Plan 5's `layoutKey` mirrors.
 */
export function planCacheKey(hash: string, exportId: string, scanId: string | null, baseId: string | null): string {
  return `${exportId}|${scanId ?? '-'}|${baseId ?? '-'}|${hash}`;
}

/**
 * The line's draw: `averageEUt` = Σ count × EU/t × utilization (plan 12: with the owned machines of another option a
 * step runs on, `reused.others`, at their own EU/t), `voltageTier` the highest machine tier of the steps, those others
 * included (0 without steps), and `amps` the amps the peak needs at that tier's voltage (0 without draw). Whether it fits
 * the group's power (`fits`) is Plan 5's.
 *
 * `peakEUt` (rate; plan 12, architecture §11.39): each step's new machines, `count − reused.units.length` at its EU/t —
 * a sharing pool's (`machineGroups`) once, each at the largest EU/t of its steps, as one machine runs one recipe at a
 * time — plus each distinct owned machine (mteId and unit, those of `reused.others` at their own EU/t) once, at the
 * largest EU/t among the steps on it. A step that lists no units counts `count × EU/t`, as before plan 12.
 *
 * `sharedByType` (Make N, where every step of a machine type runs on that type's machines): the peak is instead
 * Σ over machine types (mteId) of the largest count × the largest EU/t among that type's steps, so shared machines
 * are counted once. The average is the same either way, because utilization already divides by the shared count.
 */
export function powerSummary(steps: PlanStep[], opts: { sharedByType?: boolean } = {}): PowerSummary {
  let peak = 0;
  let average = 0;
  let voltageTier = 0;
  for (const step of steps) {
    average += step.count * step.euPerTick * step.utilization;
    voltageTier = Math.max(voltageTier, step.machine.tier);
    for (const o of step.reused?.others ?? []) {
      average += o.count * o.euPerTick * step.utilization;
      voltageTier = Math.max(voltageTier, o.tier);
    }
  }
  if (opts.sharedByType === true) {
    const byType = new Map<number, { count: number; euPerTick: number }>();
    for (const step of steps) {
      const type = byType.get(step.machine.mteId);
      if (type === undefined) byType.set(step.machine.mteId, { count: step.count, euPerTick: step.euPerTick });
      else {
        type.count = Math.max(type.count, step.count);
        type.euPerTick = Math.max(type.euPerTick, step.euPerTick);
      }
    }
    for (const type of byType.values()) peak += type.count * type.euPerTick;
  } else {
    const units = new Map<string, number>();   // `<mteId>:<unit>` → the largest EU/t of the steps on that owned machine
    const onUnit = (mteId: number, unit: number, euPerTick: number): void => {
      const key = `${mteId}:${unit}`;
      units.set(key, Math.max(units.get(key) ?? 0, euPerTick));
    };
    for (const group of machineGroups(steps)) {
      const first = group[0] as PlanStep;
      let euPerTick = 0;
      for (const step of group) euPerTick = Math.max(euPerTick, step.euPerTick);
      peak += Math.max(0, first.count - (first.reused?.units?.length ?? 0)) * euPerTick;
      for (const step of group) {
        for (const u of step.reused?.units ?? []) onUnit(step.machine.mteId, u, step.euPerTick);
        for (const o of step.reused?.others ?? []) {
          if (o.units === undefined) peak += o.count * o.euPerTick;
          else for (const u of o.units) onUnit(o.mteId, u, o.euPerTick);
        }
      }
    }
    for (const euPerTick of units.values()) peak += euPerTick;
  }
  const peakEUt = round9(peak);
  const amps = peakEUt > 0 ? Math.ceil(peakEUt / (V[voltageTier] as number) - TINY) : 0;
  return { peakEUt, averageEUt: round9(average), voltageTier, amps };
}

/**
 * Plans by cache key, at most `max` (32), the least recently used dropped first. Callers that ask for a key while it
 * is being computed share that computation; a computation that fails is not kept, so the next caller tries again.
 * `computations` counts the computations started.
 */
export class PlanCache {
  computations = 0;
  readonly #max: number;
  readonly #plans = new Map<string, Promise<Plan>>();

  constructor(max: number = DEFAULT_CACHE_SIZE) {
    this.#max = max;
  }

  get(key: string, compute: () => Promise<Plan>): Promise<Plan> {
    const hit = this.#plans.get(key);
    if (hit !== undefined) {
      this.#plans.delete(key);
      this.#plans.set(key, hit);
      return hit;
    }
    this.computations++;
    const plan = (async () => compute())();
    this.#plans.set(key, plan);
    if (this.#plans.size > this.#max) this.#plans.delete(this.#plans.keys().next().value as string);
    plan.catch(() => {
      if (this.#plans.get(key) === plan) this.#plans.delete(key);
    });
    return plan;
  }
}

type Alternative = PlanStep['alternatives'][number];
type AlternativeInput = NonNullable<Alternative['inputs']>[number];

/** Items before fluids, each largest amount first, then by key: the order a swap-list row lists goods in. */
function byPartOrder(a: { key: StuffKey; amount: number }, b: { key: StuffKey; amount: number }): number {
  return Number(isFluidKey(a.key)) - Number(isFluidKey(b.key)) || b.amount - a.amount || byString(a.key, b.key);
}

/**
 * What one run of a recipe takes and makes, as its swap-list row shows it (controller rulings, plan 09): every consumed
 * slot the line may take (`keptOptions`), a slot of one option summed with the others of that good, a slot of several
 * as one entry that lists them all in its `options` (its key and amount are the first); and every output, summed per
 * key. Items before fluids, each largest first (`byPartOrder`).
 */
function recipeParts(
  pack: Pack, recipeId: string, avoid: ReadonlySet<StuffKey>,
): { inputs: AlternativeInput[]; outputs: Array<{ key: StuffKey; amount: number }> } {
  const r = pack.recipeById.get(recipeId);
  if (r === undefined) return { inputs: [], outputs: [] };
  const summed = (entries: ReadonlyArray<[StuffKey, number]>): Array<{ key: StuffKey; amount: number }> => {
    const totals = new Map<StuffKey, number>();
    for (const [key, amount] of entries) totals.set(key, (totals.get(key) ?? 0) + amount);
    return [...totals].map(([key, amount]) => ({ key, amount: round6(amount) }));
  };
  const single: Array<[StuffKey, number]> = [];
  const several: AlternativeInput[] = [];
  for (const ing of r.inputs) {
    const options = ing.consumed ? keptOptions(ing.options, avoid) : [];
    const first = options[0];
    if (first === undefined) continue;
    if (options.length === 1) single.push([first.key, first.amount]);
    else several.push({ key: first.key, amount: round6(first.amount), options: options.map((o) => ({ key: o.key, amount: round6(o.amount) })) });
  }
  return {
    inputs: [...summed(single), ...several].sort(byPartOrder),
    outputs: summed(r.outputs.map((p): [StuffKey, number] => [p.key, p.amount])).sort(byPartOrder),
  };
}

function byRawCostThenId(a: Alternative, b: Alternative): number {
  return a.rawCost - b.rawCost || byString(a.recipeId, b.recipeId);
}

/** The recipes of the pack that make a net amount of `key` (more than they consume of it alone), each once, in pack order. */
function makersOf(pack: Pack, key: StuffKey): Recipe[] {
  const seen = new Set<string>();
  const makers: Recipe[] = [];
  for (const i of pack.producers.get(key) ?? []) {
    const r = pack.recipes[i];
    if (r === undefined || seen.has(r.id)) continue;
    seen.add(r.id);
    let net = 0;
    for (const p of r.outputs) if (p.key === key) net += p.amount * p.chance;
    for (const ing of r.inputs) {
      const only = ing.consumed && ing.options.length === 1 ? ing.options[0] : undefined;
      if (only?.key === key) net -= only.amount * ing.chance;
    }
    if (net > 0) makers.push(r);
  }
  return makers;
}

/**
 * A recipe's rejections that are no way of making anything of its own (display-only, unreadable, fuel, a duplicate, and
 * a bench variant no Auto Workbench runs here, whose original is the hand way: plan 12, controller ruling 214 (a)).
 */
const NO_WAY: ReadonlySet<string> = new Set(['fake', 'opaque', 'fuel', 'vanilla-furnace', 'bench']);

/**
 * The places out of the group's reach (`reachable`) that would give it `key`, by name, nearest first (the tier at which
 * progression reaches a dimension, `defaultTier`, or a capability's `minTier`; the pack's order within one): for a GT
 * base item, the dimensions whose veins or small ores hold its material and the capabilities that yield it; for a fluid,
 * the dimensions that pump it, and for a molten one (`fluid:molten.titanium`) also those of its material, as for its
 * dust. None for a molten one whose material a place in reach holds: what is in the way then is the tier of what melts
 * it (Molten Lead at LV, which Io and Venus pump), not a place. "Moon (T1 rocket)", as unlock hints name them.
 */
function placesFor(pack: Pack, key: StuffKey, reachable: ReadonlySet<string>): string[] {
  const material = isFluidKey(key) ? moltenMaterial(pack, key) : isBaseItem(pack, key) ? pack.items.get(key)?.gt?.material : undefined;
  const places = new Set<string>();
  if (material !== undefined) {
    for (const vein of pack.worldgen.veins) if (Object.values(vein.materials).includes(material)) for (const dim of vein.dims) places.add(dim);
    for (const capability of pack.worldgen.capabilities) if (capability.yields.includes(material)) places.add(capability.key);
    if (isFluidKey(key) && [...places].some((place) => reachable.has(place))) return [];
  }
  if (isFluidKey(key)) {
    for (const source of pack.worldgen.fluidSources) if (source.fluid === key) for (const dim of source.dims) places.add(dim);
  }
  const found: Array<{ name: string; tier: number }> = [];
  for (const dim of pack.worldgen.dimensions) {
    const name = dim.rocketTier === undefined ? dim.name : `${dim.name} (T${dim.rocketTier} rocket)`;
    if (places.has(dim.key) && !reachable.has(dim.key)) found.push({ name, tier: dim.defaultTier });
  }
  for (const capability of pack.worldgen.capabilities) {
    if (places.has(capability.key) && !reachable.has(capability.key)) found.push({ name: capability.name, tier: capability.minTier });
  }
  return [...new Set(found.sort((a, b) => a.tier - b.tier).map((place) => place.name))];
}

/** Places a reason names (`unobtainableReason`) before "or <n> more": Molten Titanium has 53 at LV. */
const MAX_PLACES = 3;

const METALS = new WeakMap<Pack, ReadonlyMap<string, readonly StuffKey[]>>();

/** The dusts and ingots of `material` (by GT prefix, and its ore parts): what its molten fluid is melted from. Once per pack. */
function metalOf(pack: Pack, material: string): readonly StuffKey[] {
  let byMaterial = METALS.get(pack);
  if (byMaterial === undefined) {
    const sets = new Map<string, Set<StuffKey>>();
    const add = (name: string, key: StuffKey | undefined): void => {
      if (key === undefined) return;
      const set = sets.get(name);
      if (set === undefined) sets.set(name, new Set([key]));
      else set.add(key);
    };
    for (const item of pack.items.values()) if (item.gt?.prefix === 'dust' || item.gt?.prefix === 'ingot') add(item.gt.material, item.key);
    for (const [name, m] of pack.materials) {
      add(name, m.parts?.dust);
      add(name, m.parts?.ingot);
    }
    byMaterial = new Map([...sets].map(([name, set]) => [name, [...set]]));
    METALS.set(pack, byMaterial);
  }
  return byMaterial.get(material) ?? [];
}

/** Whether a singleblock machine runs some map of `r` (not only multiblocks). */
function singleblockMap(pack: Pack, r: Recipe): boolean {
  return r.maps.some((mapId) => (pack.machinesByMap.get(mapId) ?? []).some((id) => pack.machines.get(id)?.kind === 'basic'));
}

/**
 * The lowest tier above the group's at which a plan of the same settings and world gets `key` (`PlanBasis.at`), for a
 * molten metal whose dust or ingot the group gets here (`has`). A recipe making it from what the group gets (an option
 * of every slot) that a singleblock runs settles it at the tier its voltage needs (as `acceptRecipe` judges it, ruling
 * R2): most metals, in a fluid extractor. Below that tier, or where no such recipe is, what a plan at each tier would get
 * says: some metals only multiblocks melt, none of which the group can build yet, or only once they are ingots (on the
 * 2.9 export an LV group gets Niobium Dust, which the Alloy Blast Smelter melts from IV; from HV the blast furnace and
 * vacuum freezer make the ingots a fluid extractor melts). Past the next tier only when a plan at MAX would get it;
 * undefined when not.
 */
function meltTier(pack: Pack, key: StuffKey, basis: PlanBasis, has: (key: StuffKey) => boolean): number | undefined {
  const producers = pack.producers.get(key) ?? [];
  if (producers.length === 0 && !pack.worldgen.fluidSources.some((s) => s.fluid === key)) return undefined;
  let single = Infinity;
  for (const i of producers) {
    const r = pack.recipes[i] as Recipe;
    if (!singleblockMap(pack, r) || !r.inputs.every((ing) => ing.options.some((o) => has(o.key)))) continue;
    const a = acceptRecipe(pack, r, { ...basis.env, multiblocks: new Set() });
    if (!a.ok && a.why === 'tier' && a.needTier !== undefined) single = Math.min(single, a.needTier);
  }
  const max = V.length - 1;
  const bound = Math.min(single, max + 1);
  for (let tier = basis.tier + 1; tier < bound; tier++) {
    if (basis.at(tier).avail.available.has(key)) return tier;
    if (tier === basis.tier + 1 && bound > max && !basis.at(max).avail.available.has(key)) return undefined;
  }
  return Number.isFinite(single) ? single : undefined;
}

/**
 * Why the group cannot get `key` here, which availability does not reach, when the pack says. A molten metal whose dust
 * or ingot the group gets (`has`, `metalOf`), by whatever route, waits only for what melts it, never for the places of
 * its ore (review of the plan 09 follow-ups: on the 2.9 export 17 molten fluids at LV, 6 at MV and 1 at HV whose ore is
 * out of reach but whose metal the group gets another way, as Antimony Dust from the Nether's stibnite ore, read
 * "needs Mars (T2 rocket) or …"): the tier at which it could melt it ("needs HV (your tier is LV)", `meltTier`). Any
 * other good, the places out of reach that have it, the nearest MAX_PLACES ("needs Moon (T1 rocket)", "needs The End or
 * Moon (T1 rocket) or Mars (T2 rocket) or 38 more", `placesFor`). Else the lowest tier a recipe making it needs ("needs
 * MV (your tier is LV)": one level down, as the first thing in the way). Null when none tells.
 */
function unobtainableReason(pack: Pack, key: StuffKey, basis: PlanBasis, has: (key: StuffKey) => boolean): string | null {
  const { env } = basis;
  const material = isFluidKey(key) ? moltenMaterial(pack, key) : undefined;
  if (material !== undefined && metalOf(pack, material).some(has)) {
    const melt = meltTier(pack, key, basis, has);
    if (melt !== undefined) return `needs ${tierName(melt)} (your tier is ${tierName(env.tier)})`;
  } else {
    const places = placesFor(pack, key, env.reachable);
    const more = places.length > MAX_PLACES ? ` or ${places.length - MAX_PLACES} more` : '';
    if (places.length > 0) return `needs ${places.slice(0, MAX_PLACES).join(' or ')}${more}`;
  }
  let need = Infinity;
  for (const i of pack.producers.get(key) ?? []) {
    const a = acceptRecipe(pack, pack.recipes[i] as Recipe, env);
    if (!a.ok && a.why === 'tier' && a.needTier !== undefined) need = Math.min(need, a.needTier);
  }
  return Number.isFinite(need) ? `needs ${tierName(need)} (your tier is ${tierName(env.tier)})` : null;
}

/** Why the machine side of a recipe rules it out (`acceptRecipe`'s rejection), in a swap list's words. */
function machineReason(r: Recipe, a: Extract<Acceptance, { ok: false }>, tier: number): string {
  if (a.why === 'low-gravity') return 'needs low gravity (a space station or the asteroids)';
  if (a.why === 'heat') return `needs hotter coils (${formatNumber(r.meta.coilHeat ?? r.specialValue)} K)`;
  if (a.why === 'tier' && a.needTier !== undefined) return `needs ${tierName(a.needTier)} (your tier is ${tierName(tier)})`;
  return 'needs a machine nothing can build here';
}

/**
 * Whether the group can pick recipe `r` here (controller rulings, plan 09), and the map it would run on: `reasons` is
 * empty when it can, else says in plain words why not: every excluded category it falls in ("excluded: recycling (see
 * Settings)"), the machine it needs ("needs MV (your tier is LV)", "needs a machine nothing can build here"), or, for one
 * it could run, what is in the way of each ingredient it could not get (`obtainable`, `unobtainableReason`: "needs Moon
 * (T1 rocket)"), else that ingredient by name. Null for a recipe that is no way of its own (`NO_WAY`).
 */
function judgeWay(
  pack: Pack, r: Recipe, env: PlanEnv, obtainable: Obtainable, avoid: ReadonlySet<StuffKey>, bench?: BenchLine,
): { mapId: string; reasons: string[] } | null {
  const accepted = acceptRecipe(pack, r, env, bench);
  const firstMap = [...r.maps].sort(byString)[0] ?? '';
  if (accepted.ok) {
    const reasons = new Set<string>();
    for (const ing of r.inputs) {
      const options = keptOptions(ing.options, avoid);
      const first = options[0];
      if (first === undefined || options.some((o) => obtainable.has(o.key))) continue;
      reasons.add(obtainable.why(first.key) ?? `needs ${pack.nameOf(first.key)}, which you cannot get here`);
    }
    return { mapId: accepted.mapId, reasons: [...reasons] };
  }
  if (NO_WAY.has(accepted.why)) return null;
  if (accepted.why !== 'excluded') return { mapId: firstMap, reasons: [machineReason(r, accepted, env.tier)] };
  const categories = Object.entries(EXCLUSION_RULES).filter(([name, rule]) => env.excluded.has(name) && rule(r, pack)).map(([name]) => name);
  // `fromNothing` recipes are left out with the `lava-centrifuge` category (PlanEnv.fromNothing).
  const reasons = (categories.length > 0 ? categories : ['lava-centrifuge']).map((name) => `excluded: ${name.replaceAll('-', ' ')} (see Settings)`);
  const machine = acceptRecipe(pack, r, { ...env, excluded: new Set(), fromNothing: undefined }, bench);
  if (machine.ok) return { mapId: machine.mapId, reasons };
  if (NO_WAY.has(machine.why)) return null;
  return { mapId: firstMap, reasons: [...reasons, machineReason(r, machine, env.tier)] };
}

/** Whether the group can get a good here (`has`), and why not when it cannot (`why`, null when the pack does not say). */
export interface Obtainable { has(key: StuffKey): boolean; why(key: StuffKey): string | null }

/**
 * What the group can get here: availability reaches it, or the project says it already makes it; and why it cannot get
 * the rest (`unobtainableReason`, worked out once per good).
 */
export function obtainableIn(pack: Pack, basis: PlanBasis, settings: PlanSettings): Obtainable {
  const stops = new Set(settings.stopItems);
  const has = (key: StuffKey): boolean => basis.avail.available.has(key) || stops.has(key);
  const reasons = new Map<StuffKey, string | null>();
  const why = (key: StuffKey): string | null => {
    let reason = reasons.get(key);
    if (reason === undefined) reasons.set(key, (reason = unobtainableReason(pack, key, basis, has)));
    return reason;
  };
  return { has, why };
}

/** Producers of each wanted good in the cost graph, ranked by raw cost per unit then id; finite costs only. */
function alternativesFor(model: CostModel, wanted: ReadonlySet<StuffKey>): Map<StuffKey, Alternative[]> {
  const producers = new Map<StuffKey, LpRecipe[]>();
  for (const r of model.graph.recipes) {
    if (r.kind !== 'recipe' || r.mapId === null) continue;
    for (const [key, c] of r.coeffs) {
      if (c <= 0 || !wanted.has(key)) continue;
      const list = producers.get(key);
      if (list === undefined) producers.set(key, [r]);
      else list.push(r);
    }
  }
  const out = new Map<StuffKey, Alternative[]>();
  for (const key of wanted) {
    const list = (producers.get(key) ?? []).flatMap((r) => {
      const rawCost = model.costs.recipeCost(r.id, key);
      return Number.isFinite(rawCost) ? [{ recipeId: r.id, rawCost: round6(rawCost), mapId: r.mapId as string }] : [];
    });
    out.set(key, list.sort(byRawCostThenId));
  }
  return out;
}

/**
 * Each step's swap list (spec §3.9, alternatives by raw material use; controller rulings of plan 09, "every way to make
 * the output"): every recipe of the pack that makes its main output (`makersOf`, less those `judgeWay` finds no way of
 * their own), first the ones the group can pick here, then the others with why it cannot (`unusable`), each group by raw
 * cost per unit, then id, and each row with what one run takes and makes (`recipeParts`). All of them, however many
 * ("ALL ways the export knows": on the 2.9 export a Wood Pulp step lists 1,072, a Copper Ingot one 564), the step's own
 * recipe always among them (Plan 2 Task 14: "the one in use kept"); `PlanStep.ways` counts each group for the count
 * line. Raw costs: a producer of the cost graph at its cost there; the step's own recipe, which the line may run
 * although the cost graph dropped it (or never walked its good), at its raw cost in the line's own graph (`analyzeCosts`
 * of `graph`, run only then), else at what the good costs there; any other recipe at an estimate (`estimate`: its inputs
 * at their cost-model cost, else their price, less its other outputs at theirs). A step without a main output has
 * nothing to swap. A recipe that consumes or holds a good the line avoids (`avoid`, `usesAvoided`) is no alternative
 * (ruling R6), except the step's own. A recipe the line was walked without because no machine that runs it can be built
 * here (`unbuildable`, plan 12 ruling P19) carries that reason among its `unusable` ones. Returns, per step id, the
 * recipes of its list whose raw cost is no estimate (what `pinDominatedWarnings` compares).
 */
async function addAlternatives(
  pack: Pack, settings: PlanSettings, basis: PlanBasis, steps: PlanStep[], model: CostModel, graph: CandidateGraph, avoid: ReadonlySet<StuffKey>,
  unbuildable: ReadonlyMap<string, string>,
): Promise<Map<string, ReadonlySet<string>>> {
  const wanted = new Set(steps.flatMap((s) => (s.mainOutput === undefined ? [] : [s.mainOutput])));
  const priced = alternativesFor(model, wanted);
  const obtainable = obtainableIn(pack, basis, settings);
  // the line's Auto Workbenches judge its bench variants, as its own walks do (`lineWalk`, controller ruling 214 (a))
  const bench = benchLine(pack, settings, basis.tier);
  let lineCosts: CostAnalysis | undefined;
  const ownCost = async (recipeId: string, main: StuffKey): Promise<number> => {
    const inModel = model.costs.recipeCost(recipeId, main);
    if (Number.isFinite(inModel)) return inModel;
    lineCosts ??= await analyzeCosts(graph);
    const inLine = lineCosts.recipeCost(recipeId, main);
    if (Number.isFinite(inLine)) return inLine;
    const good = lineCosts.cost(main);   // the recipe makes no net amount of it (it also consumes it)
    return Number.isFinite(good) ? good : 0;
  };
  const costOf = (key: StuffKey): number => {
    const cost = model.costs.cost(key);
    return Number.isFinite(cost) ? cost : basis.prices.price(key);
  };
  /** Raw material per unit of `key` made by `r`, roughly: each consumed slot at its cheapest option, credits at cost. */
  const estimate = (r: Recipe, key: StuffKey): number => {
    let made = 0;
    let net = 0;
    for (const p of r.outputs) {
      const amount = p.amount * p.chance;
      if (p.key === key) {
        made += amount;
        continue;
      }
      const credit = model.costs.cost(p.key);   // a co-product without a finite cost earns no credit
      if (Number.isFinite(credit)) net -= amount * credit;
    }
    for (const ing of r.inputs) {
      let best = Infinity;
      for (const o of ing.consumed ? keptOptions(ing.options, avoid) : []) best = Math.min(best, o.amount * costOf(o.key));
      if (Number.isFinite(best)) net += ing.chance * best;
    }
    return made > 0 ? Math.max(0, net / made) : 0;
  };
  const exact = new Map<string, ReadonlySet<string>>();
  for (const step of steps) {
    const main = step.mainOutput;
    if (main === undefined) continue;
    const known = new Map((priced.get(main) ?? []).map((a) => [a.recipeId, a]));
    const usable: Alternative[] = [];
    const unusable: Alternative[] = [];
    const makers = makersOf(pack, main);
    const ownRecipe = pack.recipeById.get(step.recipeId);
    // The step's own recipe is listed even where it makes no net amount of its main output (it also consumes some).
    if (ownRecipe !== undefined && !makers.includes(ownRecipe)) makers.push(ownRecipe);
    for (const r of makers) {
      const own = r.id === step.recipeId;
      if (!own && usesAvoided(r, avoid)) continue;
      const way = own ? { mapId: step.mapId, reasons: [] } : judgeWay(pack, r, basis.env, obtainable, avoid, bench);
      if (way === null) continue;
      const machine = own ? undefined : unbuildable.get(r.id);
      const reasons = machine === undefined || way.reasons.includes(machine) ? way.reasons : [...way.reasons, machine];
      const inCostGraph = known.get(r.id);
      const rawCost = inCostGraph?.rawCost ?? round6(own ? await ownCost(r.id, main) : estimate(r, main));
      const row: Alternative = { recipeId: r.id, rawCost, mapId: inCostGraph?.mapId ?? way.mapId };
      if (reasons.length > 0) unusable.push({ ...row, unusable: reasons });
      else usable.push(row);
    }
    exact.set(step.id, new Set([step.recipeId, ...known.keys()]));
    step.ways = { total: usable.length + unusable.length, usable: usable.length };
    const listed = [...usable.sort(byRawCostThenId), ...unusable.sort(byRawCostThenId)];
    step.alternatives = listed.map((a) => ({ ...a, ...recipeParts(pack, a.recipeId, avoid) }));
  }
  return exact;
}

/** At most this many map names in a `StepOption` choice's `via`. */
const MAX_VIA = 3;

/**
 * What one unit of an ingredient option costs, the recipes making it on its own runs, their maps by name, why the
 * group cannot get it here, when it cannot, the goods the line avoids that those recipes cannot run without when no
 * chain around them makes it, and when the only chains around them run on a machine that cannot be built here, why
 * (`<machine> cannot be built here (<why>)`, plan 12).
 */
interface OptionPrice { cost: number; steps: number; via: string[]; unusable?: string[]; avoided?: StuffKey[]; unbuildable?: string }

/** The goods of `avoid` the recipes `ids` cannot run without (a slot of avoided options only, as `usesAvoided` reads it). */
function avoidedBy(pack: Pack, ids: readonly string[], avoid: ReadonlySet<StuffKey> | undefined): StuffKey[] {
  const needs = new Set<StuffKey>();
  if (avoid !== undefined && avoid.size > 0) {
    for (const id of ids) {
      for (const ing of pack.recipeById.get(id)?.inputs ?? []) {
        const first = ing.options[0];
        if (first !== undefined && keptOptions(ing.options, avoid).length === 0) needs.add(first.key);
      }
    }
  }
  return [...needs];
}

/** The map names of a chain's recipes (`Standalone.recipes`, the most runs first) in `graph`, each once, at most MAX_VIA. */
function viaOf(pack: Pack, graph: CandidateGraph, chain: Standalone | undefined): string[] {
  const mapOf = new Map(graph.recipes.map((r) => [r.id, r.mapId]));
  const names: string[] = [];
  for (const id of chain?.recipes ?? []) {
    const mapId = mapOf.get(id);
    const name = mapId === undefined || mapId === null ? undefined : (pack.maps.get(mapId)?.name ?? mapId);
    if (name !== undefined && !names.includes(name)) names.push(name);
    if (names.length === MAX_VIA) break;
  }
  return names;
}

/**
 * What one unit of each option of `keys` costs (fix spec R9; controller ruling: every option, also those the line's walk
 * left out): one the group cannot get here (`obtainableIn`) at its plain price, with why (`unobtainableReason`); an
 * option the line would buy (its leaf oracle) at its cost-model cost, else its leaf cost, in 0 steps; one the cost
 * model's graph prices at that cost, with the recipes of making it on its own there (`standaloneCosts`, never through
 * the target); one that graph never reached (the walk found it far dearer) priced the same way over the graph walked
 * from those options alone (`aloneGraph`), else at its plain price. Those chains ignore the avoid list: one that cannot do
 * without a good of `avoid` (the line's, `avoidedBy`) is chained again over the graph walked from those options alone
 * around `avoid`, as the line would plan a pin of it (a Good Electronic Circuit has a dearer chain without antimony): at
 * its least raw material there (`Standalone.cost`, never below the first price), with that chain's steps and maps. That
 * graph is walked as the line is (`plannedLine`, controller ruling OQ5 a; the controller's ruling after the verify of
 * 5e3820f): without the recipes the line was walked without (`LinePricing.unbuildable`) and, again and again, without
 * those its build model in `ctx` blocks (`lineBuildModel`'s `blocked` and `blockedAlike`: no machine that runs them can be
 * built here or is owned). One that graph cannot make keeps those goods (`avoided`), and with them, where the graph
 * walked with those recipes made it, the reason the first of its chain's recipes cannot run (`unbuildable`).
 */
async function optionPrices(
  pack: Pack, settings: PlanSettings, ctx: PlanContext, pricing: LinePricing, keys: readonly StuffKey[], avoid?: ReadonlySet<StuffKey>,
): Promise<Map<StuffKey, OptionPrice>> {
  const { model, basis, target, leaf } = pricing;
  const containers = pack.fluidContainers ?? [];
  const obtainable = obtainableIn(pack, basis, settings);
  const prices = new Map<StuffKey, OptionPrice>();
  const inModel: StuffKey[] = [];
  const unreached: StuffKey[] = [];
  for (const key of keys) {
    const d = leaf(key);
    const cost = model.costs.cost(key);
    if (!obtainable.has(key)) {
      prices.set(key, { cost: basis.prices.price(key), steps: 0, via: [], unusable: [obtainable.why(key) ?? 'you cannot get it here'] });
    } else if (d.buyable) {
      prices.set(key, { cost: Number.isFinite(cost) ? cost : d.cost, steps: 0, via: [] });
    } else if (Number.isFinite(cost)) {
      inModel.push(key);
    } else {
      unreached.push(key);
    }
  }
  const chained = async (graph: CandidateGraph, costs: CostAnalysis, list: StuffKey[]): Promise<void> => {
    for (const [key, chain] of await standaloneCosts(graph, list, [target], containers)) {
      const cost = costs.cost(key);
      const madeAlone = chain !== undefined && Number.isFinite(chain.cost);
      const price: OptionPrice = {
        cost: Number.isFinite(cost) ? cost : basis.prices.price(key), steps: madeAlone ? chain.steps : 0, via: madeAlone ? viaOf(pack, graph, chain) : [],
      };
      const avoided = madeAlone ? avoidedBy(pack, chain.recipes, avoid) : [];
      if (avoided.length > 0) price.avoided = avoided;
      prices.set(key, price);
    }
  };
  if (inModel.length > 0) await chained(model.graph, model.costs, inModel);
  if (unreached.length > 0) {
    await yieldToEventLoop();
    const alone = aloneGraph(pack, settings, basis, model, unreached);
    await chained(alone, await analyzeCosts(alone), unreached);
  }
  const around = [...prices].filter(([, price]) => price.avoided !== undefined).map(([key]) => key);
  if (around.length > 0) {
    await yieldToEventLoop();
    const walked = (unbuildable?: ReadonlyMap<string, string>): CandidateGraph =>
      aloneGraph(pack, settings, basis, model, around, unbuildable === undefined ? { avoid } : { avoid, unbuildable });
    const open = walked();
    const unbuildable = new Map(pricing.unbuildable ?? []);
    let alone = open;
    for (;;) {
      const built = await lineBuildModel(pack, alone, basis, settings, ctx);
      for (const [id, why] of [...built.blocked, ...(built.blockedAlike ?? [])]) if (!unbuildable.has(id)) unbuildable.set(id, why);
      if (!alone.recipes.some((r) => unbuildable.has(r.id))) break;
      await yieldToEventLoop();
      alone = walked(unbuildable);
    }
    const chains = await standaloneCosts(alone, around, [target], containers);
    const opened = alone === open ? chains : await standaloneCosts(open, around, [target], containers);
    for (const key of around) {
      const price = prices.get(key) as OptionPrice;
      const chain = chains.get(key);
      if (chain !== undefined && Number.isFinite(chain.cost)) {
        prices.set(key, { cost: Math.max(price.cost, chain.cost), steps: chain.steps, via: viaOf(pack, alone, chain) });
        continue;
      }
      const reason = opened.get(key)?.recipes.flatMap((id) => unbuildable.get(id) ?? [])[0];
      if (reason !== undefined) prices.set(key, { ...price, unbuildable: reason });
    }
  }
  return prices;
}

/**
 * Each step's ingredient options (`PlanStep.options`, fix spec R9 and D12): per consumed slot of its recipe with two or
 * more options the line may take (`keptOptions`), every one of them, those the walk left out too (controller ruling),
 * with what one run would take of it, its share of the slot in this plan (`optionShares` over `line`, the plan's own
 * runs), its raw material per run (amount × `optionPrices`' cost) and the steps and maps of its own chain, or why the
 * group cannot get it here (`unusable`), among it an option the plan does not use that no chain makes without a good the
 * line avoids: "needs Tin Ingot, which is on your avoid list", or where every such chain runs on a machine that cannot
 * be built here, "<machine> cannot be built here (<why>)" (plan 12); cheapest first, then by key. `pinned` names the
 * option `optionChoice` pins when the graph honours it. Priced once per plan, in the plan's context `ctx`.
 */
async function addOptions(
  pack: Pack, settings: PlanSettings, ctx: PlanContext, steps: readonly PlanStep[], line: StepLine, pricing: LinePricing,
): Promise<void> {
  const slotsOf = new Map<PlanStep, Array<{ ing: Ingredient; shares: OptionShare[] }>>();
  const keys = new Set<StuffKey>();
  for (const step of steps) {
    const r = pack.recipeById.get(step.recipeId);
    const slots = (r?.inputs ?? []).filter((ing) => ing.consumed && keptOptions(ing.options, line.avoid).length > 1)
      .map((ing) => ({ ing, shares: optionShares(r as Recipe, ing, line) }));
    if (slots.length === 0) continue;
    slotsOf.set(step, slots);
    for (const { shares } of slots) for (const { option } of shares) keys.add(option.key);
  }
  if (keys.size === 0) return;
  const prices = await optionPrices(pack, settings, ctx, pricing, [...keys].sort(byString), line.avoid);
  for (const [step, slots] of slotsOf) {
    step.options = slots.map(({ ing, shares }): StepOption => {
      const choices = shares.map(({ option, share }): StepOption['choices'][number] => {
        const price = prices.get(option.key);
        const amount = sig9(option.amount * ing.chance);
        const choice: StepOption['choices'][number] = { key: option.key, amount, share, rawPerRun: round6(amount * (price?.cost ?? 0)), steps: price?.steps ?? 0 };
        if (price !== undefined && price.via.length > 0) choice.via = price.via;
        if (price?.unusable !== undefined) choice.unusable = [...price.unusable];
        else if (share === 0 && price?.unbuildable !== undefined) choice.unusable = [price.unbuildable];
        else if (share === 0 && price?.avoided !== undefined) choice.unusable = price.avoided.map((k) => `needs ${pack.nameOf(k)}, which is on your avoid list`);
        return choice;
      }).sort((a, b) => a.rawPerRun - b.rawPerRun || byString(a.key, b.key));
      const slot: StepOption = { slot: ing.slot, choices };
      const pinned = line.optionPins?.get(`${step.recipeId}#${ing.slot}`);
      if (pinned !== undefined) slot.pinned = pinned;
      return slot;
    });
  }
}

/** `plan` with each step's supporting line (`PlanStep.line`, `supportingLines`), from its steps and flows. */
function withLines(pack: Pack, basis: PlanBasis, plan: Plan): Plan {
  const lines = supportingLines(pack, plan, basis);
  for (const step of plan.steps) {
    const line = lines.get(step.id);
    if (line !== undefined) step.line = line;
  }
  return plan;
}

/**
 * One `stop-outside-inputs` warning per stop item outside the project's non-empty "Only these come in" (plan 12 fix wave
 * 3 (B)) that is no free input, in list order, whether the line meets it or not: the planner never buys it
 * (`makeLeafOracle`'s `inputsOnly`). A free input (`FREE_KEYS`) keeps its rules there, so a stopped one is still bought
 * and gets no warning.
 */
function stopsOutsideInputs(pack: Pack, settings: PlanSettings): PlanWarning[] {
  const only = new Set(settings.inputsOnly ?? []);
  if (only.size === 0) return [];
  return settings.stopItems.filter((key) => !only.has(key) && !FREE_KEYS.includes(key)).map((key) => ({
    code: 'stop-outside-inputs', key,
    text: `${pack.nameOf(key)} is on “We already make” but not on “Only these come in”, so the planner does not buy it`,
  }));
}

/** "<machine> making <product>" for a recipe of the graph (a convert recipe: "any of <product>"). */
function recipeLabel(pack: Pack, recipe: LpRecipe | undefined, id: string): string {
  if (recipe === undefined) return id;
  const product = recipe.main ?? recipe.coeffs.find(([, c]) => c > 0)?.[0];
  const what = product === undefined ? id : pack.nameOf(product);
  if (recipe.mapId === null) return `any of ${what}`;
  return `${pack.maps.get(recipe.mapId)?.name ?? recipe.mapId} making ${what}`;
}

/**
 * A solver warning in names (solve.ts has no pack). `free-loop`: the targets by name and the recipes the loop guard
 * left out as "<machine> making <product>", the same label once, at most MAX_NAMED_LOOP_RECIPES and a count of the
 * rest. `numerics`: the good it could not balance by name. `owned-only` (plan 12, controller ruling OQ5 a): `<good>
 * needs more than your <n>× <machine>, which cannot be built here (<why>)`, `The line needs …` for one without a good
 * (solve.ts keys it by the step's main output, its recipe's first output, which every step recipe of a line's walk has:
 * exported so the wording of a keyless one is tested all the same, the controller's ruling after plan 12 Task 5).
 */
export function namedSolverWarning(pack: Pack, graph: CandidateGraph, sol: Solution, w: PlanWarning): PlanWarning {
  if (w.code === 'numerics' && w.key !== undefined) {
    return { ...w, text: `The solver could not balance ${pack.nameOf(w.key)} exactly; the plan uses an earlier stage` };
  }
  if (w.code === 'owned-only') {
    return { ...w, text: `${w.key === undefined ? 'The line' : pack.nameOf(w.key)} needs more than your ${w.text}` };
  }
  if (w.code !== 'free-loop') return w;
  const byId = new Map(graph.recipes.map((r) => [r.id, r]));
  const labels = [...new Set((sol.banned ?? []).map((id) => recipeLabel(pack, byId.get(id), id)))];
  const shown = labels.slice(0, MAX_NAMED_LOOP_RECIPES).join(', ');
  const list = labels.length > MAX_NAMED_LOOP_RECIPES ? `${shown} and ${labels.length - MAX_NAMED_LOOP_RECIPES} more` : shown;
  const targets = graph.targets.map((key) => pack.nameOf(key)).join(', ');
  if (sol.status === 'infeasible') {
    return { ...w, text: `No honest way to make ${targets} here: every plan these recipes allow makes it from nothing (likely recipe data loops), even without ${list}` };
  }
  const count = (sol.banned ?? []).length;
  return { ...w, text: `Ignored ${count === 1 ? '1 recipe' : `${count} recipes`} that make ${targets} from nothing (likely a recipe data loop): ${list}` };
}

/**
 * Plain words for each blocker of an infeasible line (Review Focus #3), and the unlock hints among them. When the
 * target itself is out of reach at this tier and no blocker is an out-of-reach base material or a recipe the tier
 * rejects for the target, the blockers are side roads of the walk (a part that only a recycling chain would turn
 * back into the target, or the target itself when only such a chain is left: Aluminium Ingot at LV crafts from
 * nuggets cut from the ingot, "nothing in this pack makes" it), so the target's own unlock hint ("needs MV machines")
 * replaces them. A good whose recipes need a machine that cannot be built here (plan 12, `Blocker.machine`) says so after
 * a colon: "Nothing at ≤ LV makes Stone Dust: Basic Macerator cannot be built here (no recipe in this pack)".
 */
function blockerWarnings(
  pack: Pack, sol: Solution, basis: PlanBasis, settings: PlanSettings, ctx: PlanContext,
): { warnings: PlanWarning[]; unlocks: Plan['unlocks'] } {
  const warnings: PlanWarning[] = [];
  const unlocks: Plan['unlocks'] = [];
  const unlock = (key: StuffKey): void => {
    const text = unlockText(pack, key, { env: basis.env, settings, visited: ctx.visitedDims });
    warnings.push({ code: 'unavailable', key, text });
    unlocks.push({ key, text });
  };
  const target = settings.target;
  // The target as a no-recipe blocker is a side road only when some recipe of the pack does make it.
  const madeHere = target !== null && (pack.producers.get(target)?.length ?? 0) > 0;
  const sideRoad = (b: Solution['blockers'][number]): boolean =>
    b.reason !== 'unavailable' && (b.key !== target || (b.reason === 'no-recipe' && madeHere));
  const sideRoads = sol.blockers.length > 0 && sol.blockers.every(sideRoad);
  if (target !== null && sideRoads && !basis.avail.available.has(target)) {
    unlock(target);
    return { warnings, unlocks };
  }
  for (const b of sol.blockers) {
    const name = pack.nameOf(b.key);
    if (b.reason === 'unavailable') {
      unlock(b.key);
    } else if (b.reason === 'rejected') {
      const needs = b.needTier === undefined ? '' : ` (needs ${tierName(b.needTier)})`;
      const machine = b.machine === undefined ? '' : `: ${b.machine}`;
      warnings.push({ code: 'no-recipe', key: b.key, text: `Nothing at ≤ ${tierName(basis.tier)} makes ${name}${needs}${machine}` });
    } else if (b.reason === 'outside-inputs') {
      warnings.push({ code: 'no-recipe', key: b.key, text: `Nothing makes ${name} from your base materials` });
    } else {
      warnings.push({ code: 'no-recipe', key: b.key, text: `Nothing in this pack makes ${name}` });
    }
  }
  return { warnings, unlocks };
}

/** The sources of a raw input, each vein with the spots the team found it at (in `ctx.prospected` order). */
function sourcesOf(basis: PlanBasis, ctx: PlanContext, key: StuffKey): SourceInfo[] {
  return basis.avail.sources(key).map((source) => {
    if (source.kind !== 'vein') return source;
    const foundAt = ctx.prospected.filter((p) => p.vein === source.detail).map(({ dim, x, z }) => ({ dim, x, z }));
    return foundAt.length > 0 ? { ...source, foundAt } : source;
  });
}

/** A copy of what storage holds of `key` (§11.20, ruling R9): `total` and `reachable`, plus `where` when known. */
function haveOf(ctx: PlanContext, key: StuffKey): RawInput['have'] {
  const stock = ctx.storage.get(key);
  if (stock === undefined) return undefined;
  const have: NonNullable<RawInput['have']> = { total: stock.total, reachable: stock.reachable };
  if (stock.where !== undefined) have.where = [...stock.where];
  return have;
}

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) as string}`;
}

/** How the `derived-leaf` warning ends (fix spec R7): the banner's "Plan them as supporting lines" turns `routeDerived` on. */
const PLAN_SUPPORTING_LINES = 'Plan them as supporting lines to include their chains.';

/**
 * The one `derived-leaf` warning for the derived leaves a line buys (by key), keyed to the first: for one, what it is
 * made from; for several, every name (no cut-off: the client shows each as a chip), as their sources say the rest.
 */
function derivedLeafWarning(pack: Pack, derived: ReadonlyArray<{ key: StuffKey; detail: string }>): PlanWarning[] {
  const first = derived[0];
  if (first === undefined) return [];
  const lead = derived.length === 1
    ? `${pack.nameOf(first.key)} is not mined anywhere you can reach; it is ${first.detail}.`
    : `${listed(derived.map((d) => pack.nameOf(d.key)))} are not mined anywhere you can reach; the line buys them made from other materials (see their sources).`;
  return [{ code: 'derived-leaf', key: first.key, text: `${lead} ${PLAN_SUPPORTING_LINES}` }];
}

/**
 * The chain a bought derived material or stop item stands for (`RawInput.pricedVia`, fix spec R7), from what making it
 * on its own runs (`LinePricing.chains`): the recipe that makes most of it, the map the group runs that on, the first
 * option of each of its consumed slots, and the recipes of the whole chain. None when nothing else makes it.
 */
function pricedViaOf(pack: Pack, env: PlanEnv, chain: Standalone | undefined): RawInput['pricedVia'] {
  const r = chain?.top === undefined ? undefined : pack.recipeById.get(chain.top);
  if (chain === undefined || r === undefined) return undefined;
  const accepted = acceptRecipe(pack, r, env);
  const inputs = r.inputs.flatMap((ing) => {
    const first = ing.consumed ? ing.options[0] : undefined;
    return first === undefined ? [] : [first.key];
  });
  return { recipeId: r.id, mapId: accepted.ok ? accepted.mapId : (r.maps[0] ?? ''), inputs, steps: chain.steps };
}

/** "made by Alloy Smelter from Copper Dust, Redstone (2 recipes in all)": the source of a bought derived material. */
function pricedViaText(pack: Pack, via: NonNullable<RawInput['pricedVia']>): string {
  const by = `made by ${pack.maps.get(via.mapId)?.name ?? via.mapId}`;
  const what = via.inputs.length > 0 ? `${by} from ${via.inputs.map((key) => pack.nameOf(key)).join(', ')}` : by;
  return `${what} (${via.steps} ${via.steps === 1 ? 'recipe' : 'recipes'} in all)`;
}

/**
 * Whether some recipe the group can run at its tier makes `key` (`RawInput.canMake`, fix spec R7), so "Make it here
 * instead" can work; never for a free or gathered good, which the line takes as it is — except, where the line's own
 * graph may make gathered world blocks (`gathered`: `gatheredRecipesOn`, plan 12 ruling P1), a `GATHERED_BLOCKS` key,
 * which is judged like any good.
 */
function canMakeHere(pack: Pack, env: PlanEnv, key: StuffKey, leafClass: LeafClass | undefined, gathered: boolean): boolean {
  const madeBlock = gathered && Object.hasOwn(GATHERED_BLOCKS, key);
  if (leafClass === 'free' || (leafClass === 'natural' && !madeBlock)) return false;
  return (pack.producers.get(key) ?? []).some((i) => {
    const r = pack.recipes[i] as Recipe;
    return r.outputs.some((p) => p.key === key && p.amount > 0 && p.chance > 0) && acceptRecipe(pack, r, env).ok;
  });
}

/**
 * One raw input per purchase, sorted by key: per second (in Make N the batch's total spread over its time, plus the
 * total), its cost (leaf cost × the amount: per second, or the batch's), sources, stock, leaf class, the chain a bought
 * derived material or stop item stands for (`chains`: its `pricedVia`; a derived one's source then names that chain) and
 * whether the group could make it here (`canMakeHere`, a gathered block judged with `gathered`); the `derived` leaves
 * also get one warning that says how to plan their chains (`derivedLeafWarning`).
 */
function rawInputsOf(
  pack: Pack, graph: CandidateGraph, basis: PlanBasis, chains: ReadonlyMap<StuffKey, Standalone>, ctx: PlanContext,
  buys: ReadonlyMap<StuffKey, number>, batchSeconds: number | null, gathered: boolean,
): { rawInputs: RawInput[]; warnings: PlanWarning[] } {
  const rawInputs: RawInput[] = [];
  const derived: Array<{ key: StuffKey; detail: string }> = [];
  for (const [key, amount] of [...buys].sort(([a], [b]) => byString(a, b))) {
    const good = graph.goods.get(key);
    const leafClass = good?.leafClass ?? undefined;
    const perSecond = batchSeconds === null ? amount : batchSeconds > 0 ? amount / batchSeconds : 0;
    const input: RawInput = {
      key, perSecond: sig9(perSecond), ...(batchSeconds === null ? {} : { total: amount }), cost: sig9((good?.cost ?? 0) * amount),
      available: leafClass !== 'unavailable', sources: sourcesOf(basis, ctx, key),
    };
    const have = haveOf(ctx, key);
    if (have !== undefined) input.have = have;
    if (leafClass !== undefined) input.leafClass = leafClass;
    const via = leafClass === 'derived' || leafClass === 'stop' ? pricedViaOf(pack, basis.env, chains.get(key)) : undefined;
    if (via !== undefined) {
      input.pricedVia = via;
      // What buying it stands for, not availability's first find (a canner emptying a cell of it).
      if (leafClass === 'derived') input.sources = [{ kind: 'derived', dims: [], detail: pricedViaText(pack, via) }];
    }
    input.canMake = canMakeHere(pack, basis.env, key, leafClass, gathered);
    rawInputs.push(input);
    if (leafClass === 'derived') derived.push({ key, detail: input.sources.find((s) => s.kind === 'derived')?.detail ?? 'made from other materials' });
  }
  return { rawInputs, warnings: derivedLeafWarning(pack, derived) };
}

/**
 * Fix wave 3 (C), controller OQ2: one `beyond-stock` warning per byproduct-only good (`leafClass` 'byproduct': no ore,
 * mob, farm or free supply yields it directly) the line buys more of than the group's stock (`groupStock`: storage's
 * total, 0 without a scan) over the build horizon (24 hours where build cost is ignored; Make N: the batch), keyed to
 * the good, in key order: `Buys <N> a day of <good>, beyond the <M> in storage` where the stock is spread over a day
 * (the default 24-hour horizon, and build cost ignored); at any other horizon the purchase over it too, the amount the
 * warning tests: `Buys <N> a day of <good>, <T> over <horizon>, beyond the <M> in storage` (`<horizon>` as the plan's
 * cost line says it: `6 h`, `1 week`); in Make N `Buys <N> of <good> for the batch, beyond the <M> in storage`. `buys`
 * per second, or the batch's in Make N.
 */
function beyondStockWarnings(
  pack: Pack, graph: CandidateGraph, settings: PlanSettings, ctx: PlanContext, buys: ReadonlyMap<StuffKey, number>,
): PlanWarning[] {
  const stock = groupStock(settings, ctx);
  const batch = settings.mode === 'makeN';
  const warnings: PlanWarning[] = [];
  for (const [key, amount] of [...buys].sort(([a], [b]) => byString(a, b))) {
    if (graph.goods.get(key)?.leafClass !== 'byproduct') continue;
    const have = stock.total(key);
    if (!(amount * stock.over > have * (1 + BEYOND_STOCK_SLACK) + BEYOND_STOCK_SLACK)) continue;
    const litres = isFluidKey(key) ? ' L' : '';
    const overHorizon = stock.over === SECONDS_PER_DAY ? '' : `, ${formatNumber(amount * stock.over)}${litres} over ${horizonWords(stock.over)}`;
    const bought = batch
      ? `${formatNumber(amount)}${litres} of ${pack.nameOf(key)} for the batch`
      : `${formatNumber(amount * SECONDS_PER_DAY)}${litres} a day of ${pack.nameOf(key)}${overHorizon}`;
    warnings.push({ code: 'beyond-stock', key, text: `Buys ${bought}, beyond the ${formatNumber(have)}${litres} in storage` });
  }
  return warnings;
}

/** A build horizon of `seconds` in the words of the plan's cost line (the client's `horizonText`): `<n> h`, a week `1 week`. */
function horizonWords(seconds: number): string {
  const hours = seconds / SECONDS_PER_HOUR;
  return hours === HOURS_PER_WEEK ? '1 week' : `${formatNumber(hours)} h`;
}

/** What the line throws away other than the target, per second; virtual ore-dictionary goods are never byproducts. */
function byproductsOf(graph: CandidateGraph, sinks: ReadonlyMap<StuffKey, number>, target: StuffKey): Product[] {
  return [...sinks]
    .filter(([key]) => key !== target && graph.goods.get(key)?.virtual !== true)
    .sort(([a], [b]) => byString(a, b))
    .map(([key, amount]) => ({ key, amount: sig9(amount), chance: 1 }));
}

/** "3× Empty Cell", "1,000 L Oxygen": an amount of a good in words, at most 2 decimal places. */
function amountOf(pack: Pack, key: StuffKey, amount: number): string {
  const n = (Math.round(amount * 100) / 100).toLocaleString('en-US');
  return key.startsWith('fluid:') ? `${n} L ${pack.nameOf(key)}` : `${n}× ${pack.nameOf(key)}`;
}

/** Shown before the rest of a list is counted. */
const MAX_LISTED = 5;

/**
 * The Make N warning for goods whole crafts could not balance (make-n.ts `short`): the batch under-delivers them, so
 * the plan says so instead of reading as if it worked out (spec §3.2 "shows how long it will take"). Its `keys` are
 * every good it covers, the target first, so the plan index adds no short input for them at each step that takes one.
 */
export function batchShortWarning(pack: Pack, short: readonly Product[], target: StuffKey, amount: number): PlanWarning[] {
  if (short.length === 0) return [];
  const missingTarget = short.find((p) => p.key === target);
  const others = short.filter((p) => p.key !== target);
  const listed = others.slice(0, MAX_LISTED).map((p) => amountOf(pack, p.key, p.amount)).join(', ');
  const more = others.length > MAX_LISTED ? ` and ${others.length - MAX_LISTED} more` : '';
  const head = missingTarget === undefined ? '' : `The batch makes only ${Math.max(0, Math.round((amount - missingTarget.amount) * 100) / 100)} of ${amount} ${pack.nameOf(target)}. `;
  const tail = others.length === 0 ? '' : `Whole crafts do not balance: have ${listed}${more} ready before you start (cells or catalysts the chain hands round), or the batch comes out short.`;
  const keys = [...(missingTarget === undefined ? [] : [target]), ...others.map((p) => p.key)];
  return [{ code: 'batch-short', key: keys[0], keys, text: `${head}${tail}`.trim() }];
}

function scaled(values: ReadonlyMap<string, number>, factor: number): Map<string, number> {
  return new Map([...values].map(([key, value]) => [key, value * factor]));
}

/** Everything a plan holds besides what `assemble` derives (hash, export, tier, reachable dimensions, names). */
interface PlanBody {
  status: NonNullable<Plan['status']>;
  unlocks: Plan['unlocks']; steps: PlanStep[]; flows: PlanFlow[]; rawInputs: RawInput[]; byproducts: Product[];
  power: PowerSummary; buildList: BomLine[]; buildTotals: BomLine[]; buildSteps: Plan['buildSteps']; warnings: PlanWarning[];
  makeN?: Plan['makeN'];
  avoided?: Plan['avoided'];
  /** `Plan.target`, `Plan.targetPerSecond` (rate mode) and `Plan.rawCost` (rate mode, a line that plans). */
  target?: StuffKey;
  targetPerSecond?: number;
  rawCost?: Plan['rawCost'];
  /** `Plan.cost` (plan 12): every line that plans. */
  cost?: Plan['cost'];
  /** `Plan.deliberate` (plan 12's final review): a rate line with build cost counted (`deliberateSplits`). */
  deliberate?: DeliberateSplit[];
}

function bodyWithout(status: PlanBody['status'], warnings: PlanWarning[], unlocks: Plan['unlocks'] = []): PlanBody {
  return {
    status, unlocks, steps: [], flows: [], rawInputs: [], byproducts: [], power: powerSummary([]), buildList: [], buildTotals: [],
    buildSteps: [], warnings,
  };
}

/** The dimension of Minecraft id `id` for a spot found in `source`: one of its dims, else the first by key, else none. */
function dimensionOfId(byKey: ReadonlyMap<string, DimensionInfo>, sortedDims: readonly DimensionInfo[], source: SourceInfo, id: number): DimensionInfo | undefined {
  return source.dims.map((key) => byKey.get(key)).find((d) => d?.id === id) ?? sortedDims.find((d) => d.id === id);
}

/**
 * The English name of every key the plan uses (target, steps with what they supply, their ingredient options and their
 * swap lists with every option of a slot, flows, raw inputs, byproducts, build list with its breakdown, totals, unlocks,
 * warnings, the avoided goods with what they are made from and the item and fluid entries of the avoid list, ruling
 * R11), `map:<id>` for every recipe map of a step or alternative, `dim:<key>` for every dimension it reaches or a source
 * names, and `dimId:<n>` for every dimension id a found spot or a reused machine stands in; keys in sorted order.
 */
function planNames(pack: Pack, plan: Plan, settings: PlanSettings): Record<string, string> {
  const target = settings.target;
  const names = new Map<string, string>();
  const add = (key: StuffKey | undefined): void => {
    if (key !== undefined && !names.has(key)) names.set(key, pack.nameOf(key));
  };
  const addLines = (lines: readonly BomLine[]): void => {
    for (const line of lines) {
      add(line.key);
      if (line.children !== undefined) addLines(line.children);
    }
  };
  add(target ?? undefined);
  const addMap = (mapId: string): void => {
    if (!names.has(`map:${mapId}`)) names.set(`map:${mapId}`, pack.maps.get(mapId)?.name ?? mapId);
  };
  for (const step of plan.steps) {
    add(step.mainOutput);
    add(step.supply);
    for (const p of [...step.inputs, ...step.outputs]) add(p.key);
    for (const slot of step.options ?? []) for (const choice of slot.choices) add(choice.key);
    addMap(step.mapId);
    for (const a of step.alternatives) {
      addMap(a.mapId);
      for (const p of a.inputs ?? []) for (const o of p.options ?? [p]) add(o.key);
      for (const p of a.outputs ?? []) add(p.key);
    }
  }
  for (const flow of plan.flows) add(flow.key);
  for (const input of plan.rawInputs) {
    add(input.key);
    // What a bought material stands for (fix spec R7): the client names its map and inputs from the plan alone.
    if (input.pricedVia !== undefined) {
      addMap(input.pricedVia.mapId);
      for (const key of input.pricedVia.inputs) add(key);
    }
  }
  for (const p of plan.byproducts) add(p.key);
  addLines(plan.buildList);
  addLines(plan.buildTotals ?? []);
  for (const u of plan.unlocks) add(u.key);
  for (const w of plan.warnings) add(w.key);
  for (const a of plan.avoided ?? []) for (const key of [a.key, ...(a.madeFrom ?? [])]) add(key);
  for (const entry of settings.avoid ?? []) if (pack.items.has(entry) || pack.fluids.has(entry)) add(entry);

  const dims = pack.worldgen.dimensions;
  const byKey = new Map(dims.map((d) => [d.key, d]));
  const sortedDims = [...dims].sort((a, b) => byString(a.key, b.key));
  const addDim = (key: string): void => {
    const dim = byKey.get(key);
    if (dim !== undefined && !names.has(`dim:${key}`)) names.set(`dim:${key}`, dim.name);
  };
  for (const r of plan.reachable) addDim(r.key);
  for (const input of plan.rawInputs) {
    for (const source of input.sources) {
      for (const key of source.dims) addDim(key);
      for (const spot of source.foundAt ?? []) {
        const id = `dimId:${spot.dim}`;
        if (!names.has(id)) names.set(id, dimensionOfId(byKey, sortedDims, source, spot.dim)?.name ?? `DIM${spot.dim}`);
      }
    }
  }
  // Where the machines a step reuses stand: the step panel names a dimension other than the overworld. Plan 12: those of
  // the step's other eligible options that run beside its machine (`reused.others`) too.
  for (const step of plan.steps) {
    for (const { dim } of [...(step.reused?.where ?? []), ...(step.reused?.others ?? []).flatMap((o) => o.where)]) {
      if (!names.has(`dimId:${dim}`)) names.set(`dimId:${dim}`, sortedDims.find((d) => d.id === dim)?.name ?? `DIM${dim}`);
    }
  }
  return Object.fromEntries([...names].sort(([a], [b]) => byString(a, b)));
}

/**
 * The warning of an integrity issue (fix spec R11): its code, its §6.4 text, the good and the steps it is about. A note
 * (`PlanIndex.notes`, plan 12's final review) takes its note code (`noteWarningCode`: `deliberate-split`,
 * `deliberate-purchase`), not an integrity code, and words why.
 */
function integrityWarning(issue: PlanIssue, plan: Plan): PlanWarning {
  const code = issue.deliberate === undefined ? issue.code : noteWarningCode(issue);
  const w: PlanWarning = { code, key: issue.key, text: issueText(issue, plan) };
  if (issue.stepId !== undefined) w.stepId = issue.stepId;
  if (issue.stepIds !== undefined) w.stepIds = [...issue.stepIds];
  if (issue.share !== undefined) w.share = [...issue.share];
  return w;
}

/**
 * The plan of `body`, named (`planNames`), with one warning per integrity issue of its flows (`indexPlan`: an input
 * nothing supplies or supplies short, a good made two ways, a good both bought and made), then one per note (a good the
 * plan makes two ways, or buys beside its makers, on purpose: `Plan.deliberate`). A correct plan has no issue; a plan
 * that has one says so instead of reading as if it added up.
 */
function assemble(pack: Pack, settings: PlanSettings, basis: PlanBasis, body: PlanBody): Plan {
  const plan: Plan = {
    settingsHash: settingsHash(settings), exportId: pack.manifest.exportId, tier: basis.tier, reachable: basis.reach.reachable,
    unlocks: body.unlocks, steps: body.steps, flows: body.flows, rawInputs: body.rawInputs, byproducts: body.byproducts,
    power: body.power, buildList: body.buildList, buildSteps: body.buildSteps, warnings: body.warnings,
  };
  if (body.makeN !== undefined) plan.makeN = body.makeN;
  plan.status = body.status;
  plan.buildTotals = body.buildTotals;
  if (body.avoided !== undefined) plan.avoided = body.avoided;
  if (body.target !== undefined) plan.target = body.target;
  if (body.targetPerSecond !== undefined) plan.targetPerSecond = body.targetPerSecond;
  if (body.rawCost !== undefined) plan.rawCost = body.rawCost;
  if (body.cost !== undefined) plan.cost = body.cost;
  if (body.deliberate !== undefined && body.deliberate.length > 0) plan.deliberate = body.deliberate;
  plan.names = planNames(pack, plan, settings);
  const { issues, notes } = indexPlan(plan);
  const found = [...issues, ...notes];
  if (found.length > 0) plan.warnings = [...plan.warnings, ...found.map((issue) => integrityWarning(issue, plan))];
  return plan;
}

/** What a project's avoid list asks of its line (§11.25). */
interface AvoidRequest {
  /** The list has entries: the plan then says what they matched (`Plan.avoided`), even when nothing. */
  listed: boolean;
  /** The goods the line avoids: what the list matches, but never the target (ruling R9). */
  goods: ReadonlySet<StuffKey>;
  /**
   * For a good the line would buy as a derived leaf, whose chain runs outside the plan: the goods of `goods` that chain
   * is made from (`derivedMadeFrom`), sorted by key; none for any other good. The line buys no such leaf while it can do
   * without (`avoidingLine`): the Magnetic Steel bought for a hull's plates would hide the steel it is polarized from.
   */
  madeFrom(key: StuffKey): readonly StuffKey[];
  /**
   * One `avoid-unknown` per entry that matches nothing (no material, item or fluid of the pack, or a material of it
   * without goods), in list order, then `avoid-target` when the list matches the target.
   */
  warnings: readonly PlanWarning[];
}

const MADE_FROM_NOTHING = (): readonly StuffKey[] => [];
const NOTHING_AVOIDED: AvoidRequest = { listed: false, goods: new Set(), madeFrom: MADE_FROM_NOTHING, warnings: [] };

/**
 * The goods of `avoided` a derived material was made from: those among what availability first made it from
 * (`Availability.derivedFrom`, the inputs its source names), and for each of those that is a base material itself
 * (`isBaseItem`: Bronze Dust ground from a Bronze Ingot) what that was made from, back to base materials no recipe made
 * available. A part or other intermediate it was made from (a cell, a plate, a fluid like Molten Epoxid) is not
 * followed back: such goods are made in many ways, and the first way availability found is no more how this one is
 * made than any other (every chemical first made with a cell would count as made from the tin of the cell). Memoized;
 * sorted by key.
 */
function derivedMadeFrom(pack: Pack, avail: Availability, avoided: ReadonlySet<StuffKey>): (key: StuffKey) => readonly StuffKey[] {
  const reached = new Map<StuffKey, readonly StuffKey[]>();
  const followed = (input: StuffKey): boolean => !avoided.has(input) && isBaseItem(pack, input);
  return (start) => {
    // Depth first, each good once. Every input became available before what it made, so this ends; `entered` keeps a
    // loop in the data from running forever all the same (a good met again on its own path adds nothing).
    const stack = [start];
    const entered = new Set<StuffKey>();
    while (stack.length > 0) {
      const key = stack[stack.length - 1] as StuffKey;
      if (reached.has(key)) {
        stack.pop();
        continue;
      }
      const inputs = avail.derivedFrom(key);
      if (!entered.has(key)) {
        entered.add(key);
        for (const input of inputs) if (followed(input) && !reached.has(input) && !entered.has(input)) stack.push(input);
        continue;
      }
      stack.pop();
      const from = new Set<StuffKey>();
      for (const input of inputs) {
        if (avoided.has(input)) from.add(input);
        else if (followed(input)) for (const good of reached.get(input) ?? []) from.add(good);
      }
      reached.set(key, [...from].sort(byString));
    }
    return reached.get(start) ?? [];
  };
}

/**
 * The avoid list of `settings` for a line that makes `target` (null: no target the export knows) at the prices of
 * `pricing` (null: no line, so no derived leaf to judge).
 */
function avoidRequest(pack: Pack, settings: PlanSettings, target: StuffKey | null, pricing: LinePricing | null): AvoidRequest {
  const entries = settings.avoid ?? [];
  if (entries.length === 0) return NOTHING_AVOIDED;
  const { goods, unknown, empty } = resolveAvoid(pack, entries);
  const warnings: PlanWarning[] = [];
  for (const entry of new Set(entries)) {
    if (unknown.includes(entry)) {
      warnings.push({ code: 'avoid-unknown', text: `"${entry}" is no material, item or fluid of this pack, so nothing is avoided for it` });
    } else if (empty.includes(entry)) {
      warnings.push({ code: 'avoid-unknown', text: `"${entry}" matches nothing in this pack: no item or fluid is made of it, so nothing is avoided for it` });
    }
  }
  if (target !== null && goods.delete(target)) {
    warnings.push({ code: 'avoid-target', key: target, text: `${pack.nameOf(target)} is what this line makes, so it is planned although the avoid list covers it` });
  }
  if (pricing === null || goods.size === 0) return { listed: true, goods, madeFrom: MADE_FROM_NOTHING, warnings };
  const reach = derivedMadeFrom(pack, pricing.basis.avail, goods);
  const known = new Map<StuffKey, readonly StuffKey[]>();
  const madeFrom = (key: StuffKey): readonly StuffKey[] => {
    let from = known.get(key);
    if (from === undefined) {
      const d = goods.has(key) || key === target ? undefined : pricing.leaf(key);
      from = d !== undefined && d.buyable && d.leafClass === 'derived' ? reach(key) : [];
      known.set(key, from);
    }
    return from;
  };
  return { listed: true, goods, madeFrom, warnings };
}

/** `body` with what the avoid list matched (`Plan.avoided`), when it lists anything; old projects never get the field. */
function withAvoided(body: PlanBody, avoid: AvoidRequest, avoided: NonNullable<Plan['avoided']>): PlanBody {
  return avoid.listed ? { ...body, avoided } : body;
}

/**
 * What a solution uses of what `request` avoids (`AvoidingLine.used`), by key, and how much: each avoided good it
 * consumes (in a recipe or ore-dictionary conversion it runs) or buys; each one its recipes hold in a not-consumed slot
 * (`LpRecipe.nonConsumed`), at 0, as a lens, mold or catalyst costs nothing while the line runs, so it is allowed back
 * first; and each derived leaf it buys that is made from avoided goods (`AvoidRequest.madeFrom`).
 */
function amountsUsed(graph: CandidateGraph, sol: Solution, request: AvoidRequest): Map<StuffKey, number> {
  const used = new Map<StuffKey, number>();
  const add = (key: StuffKey, amount: number): void => {
    used.set(key, (used.get(key) ?? 0) + amount);
  };
  for (const r of graph.recipes) {
    const runs = sol.runs.get(r.id) ?? 0;
    if (runs <= 0) continue;
    for (const [key, c] of r.coeffs) if (c < 0 && request.goods.has(key)) add(key, -c * runs);
    for (const key of r.nonConsumed) if (request.goods.has(key)) add(key, 0);
  }
  for (const [key, amount] of sol.buys) if (request.goods.has(key) || request.madeFrom(key).length > 0) add(key, amount);
  return used;
}

/** A line graph, its solution, and the goods the plan keeps out of (its swap lists and the parts its machines hold too). */
interface SolvedLine { graph: CandidateGraph; sol: Solution; avoid: ReadonlySet<StuffKey> }

/**
 * The line for an avoid list: `used` is what the plain line uses of it (`amountsUsed`), by key, and `reallowed` what
 * this one may use of that. The plain line is the probe of the open graph, or its full solve where that is the plan and
 * uses more (`avoidingLine`).
 */
interface AvoidingLine extends SolvedLine { used: StuffKey[]; reallowed: ReadonlySet<StuffKey> }

/** A line solved in full, and the build model of its graph it was solved with (plan 12). */
interface ModelledLine { line: AvoidingLine; model: BuildModel }

/**
 * Solves a line graph in full with its build model (`lineBuildModel`, plan 12); null, with the recipes the model blocks
 * (controller ruling OQ5 a) added to the set the line is walked without, when it blocks any.
 */
type FullSolve = (graph: CandidateGraph) => Promise<{ sol: Solution; model: BuildModel } | null>;

/**
 * A derived leaf made from avoided goods, as the walk sees it: no leaf, so the line makes it (keeping out of them there
 * too) or goes without.
 */
const NOT_BOUGHT: LeafDecision = { buyable: false, cost: 0, leafClass: null };

/**
 * The line that keeps out of what `request` avoids (architecture §11.25, ruling R10), from the plain line
 * (`pricing.graph`, solved as `plain`): the plain line itself when it uses none of it (`amountsUsed`); else the line
 * walked without it all (`CandidateOptions.avoid`; a derived leaf made from avoided goods is no leaf there, so the line
 * makes it from what it may use or goes without); else, as nothing at the tier avoids it all, the line with the fewest
 * of what the plain line used allowed back: one at a time, least raw-cost impact first (unit cost × what the plain line
 * consumes and buys of it; what a machine only holds counts 0), until the line plans, and then each one before the last
 * is avoided again wherever the line still plans without it. At most twice as many passes as goods used. When even
 * allowing them all back plans nothing (the walk without the rest prunes differently), the plain line, all of them
 * allowed back.
 *
 * A full solve (the step charge, fix spec R3; plan 12's build stage) costs far more than its least-raw stage, and only
 * whether a line plans and what it uses matter here: `plain` is a probe (`SolveOptions.probe`) and so is every trial;
 * only the line found is solved in full (`full`, with that graph's build model). Where that is the plain line itself,
 * its full solve can use what the probe did not: a tie the probe broke the other way, or the charge buying a derived
 * leaf made from a good whose own chain the probe ran. Then the search goes on from the full line as if the plain line
 * had used that, so every use is listed and flagged. Every trial walk leaves out the recipes no machine can run here
 * (`pricing.unbuildable`, plan 12); null when the build model of the graph to solve in full blocks more of them (`full`
 * returns null: the caller walks the line again without them).
 */
async function avoidingLine(
  pack: Pack, settings: PlanSettings, pricing: LinePricing, plain: Solution, demand: ReadonlyMap<StuffKey, number>, request: AvoidRequest,
  options: SolveOptions, full: FullSolve,
): Promise<ModelledLine | null> {
  const open = pricing.graph;
  const goods = request.goods;
  const without = (allowed: ReadonlySet<StuffKey>): Set<StuffKey> => new Set([...goods].filter((key) => !allowed.has(key)));
  const unitCost = (key: StuffKey): number => {
    const cost = pricing.model.costs.cost(key);
    return Number.isFinite(cost) ? cost : pricing.basis.prices.price(key);
  };
  /**
   * The probe of the line walked with `allowed` back, once per set: a second search starts as the first did. A pin of an
   * option on the list stays ignored where it is allowed back (`CandidateOptions.pinAvoid`, ruling P28), as in `open`.
   */
  const trials = new Map<string, Promise<SolvedLine>>();
  const trial = (allowed: ReadonlySet<StuffKey>): Promise<SolvedLine> => {
    const back = new Set(allowed);
    const id = [...back].sort(byString).join('\n');
    let line = trials.get(id);
    if (line === undefined) {
      line = (async (): Promise<SolvedLine> => {
        const avoid = without(back);
        const leaf: LeafOracle = (key) => (!back.has(key) && request.madeFrom(key).length > 0 ? NOT_BOUGHT : pricing.leaf(key));
        await yieldToEventLoop();
        const walk = lineWalk(pack, settings, pricing.basis,
          pricing.unbuildable === undefined ? { avoid, pinAvoid: goods } : { avoid, pinAvoid: goods, unbuildable: pricing.unbuildable });
        const graph = buildCandidates(pack, settings, pricing.basis.env, leaf, [pricing.target], walk);
        return { graph, sol: await solveLine(graph, demand, { ...options, probe: true }), avoid };
      })();
      trials.set(id, line);
    }
    return line;
  };
  /**
   * The search from the plain line solved as `from`, which uses `amounts` of what the list avoids: the line found, with
   * `from` where that is the plain line and a probe elsewhere.
   */
  const search = async (from: Solution, amounts: ReadonlyMap<StuffKey, number>): Promise<AvoidingLine> => {
    const used = [...amounts.keys()].sort(byString);
    if (used.length === 0) return { graph: open, sol: from, avoid: goods, used, reallowed: new Set() };
    /** The derived leaves made from avoided goods the plain line buys. */
    const bought = used.filter((key) => !goods.has(key));
    const solve = async (allowed: ReadonlySet<StuffKey>): Promise<SolvedLine> => {
      const avoid = without(allowed);
      // The list's goods are all ones the plain line uses, allowed back with the derived leaves it buys: the plain line.
      if (avoid.size === 0 && bought.every((key) => allowed.has(key))) return { graph: open, sol: from, avoid };
      return trial(allowed);
    };
    const strict = await solve(new Set());
    if (strict.sol.status === 'ok') return { ...strict, used, reallowed: new Set() };

    const impact = (key: StuffKey): number => unitCost(key) * (amounts.get(key) ?? 0);
    const reallowed = new Set<StuffKey>();
    let best: SolvedLine | undefined;
    for (const key of [...used].sort((a, b) => impact(a) - impact(b) || byString(a, b))) {
      reallowed.add(key);
      const tried = await solve(reallowed);
      if (tried.sol.status === 'ok') {
        best = tried;
        break;
      }
    }
    if (best === undefined) return { graph: open, sol: from, avoid: without(new Set(used)), used, reallowed: new Set(used) };
    for (const key of [...reallowed].slice(0, -1)) {
      reallowed.delete(key);
      const tried = await solve(reallowed);
      if (tried.sol.status === 'ok') best = tried;
      else reallowed.add(key);
    }
    return { ...best, used, reallowed };
  };
  /** `line` with its graph solved in full, and the graph's build model. */
  const inFull = async (line: AvoidingLine): Promise<ModelledLine | null> => {
    const done = await full(line.graph);
    return done === null ? null : { line: { ...line, sol: done.sol }, model: done.model };
  };

  const found = await search(plain, amountsUsed(open, plain, request));
  // A trial's graph holds only the avoided goods and derived leaves it allowed back; the open graph holds them all.
  if (found.graph !== open) return inFull(found);
  const whole = await full(open);
  if (whole === null) return null;
  const amounts = amountsUsed(open, whole.sol, request);
  if ([...amounts.keys()].every((key) => found.used.includes(key))) return { line: { ...found, sol: whole.sol }, model: whole.model };
  const again = await search(whole.sol, amounts);
  // On the open graph the search's line is `whole` itself.
  return again.graph === open ? { line: again, model: whole.model } : inFull(again);
}

/** The flow end of what the line buys (machines.ts `buildFlows`). */
const RAW = 'raw';

/**
 * One `hand-step` warning per step of a running line crafted by hand (fix spec D7): what it makes and how much an hour.
 * The step charge weighs such a step three times, so one that remains has no machine recipe that pays. With crafting
 * automated, a step is crafted by hand only where no Auto Workbench of the line runs its recipe (`LpRecipe.byHand` of
 * `graph`, controller ruling 214; user ruling 180 (d)), and the warning says why. Every project's crafting is automated
 * (`normalizeSettings`, user ruling 180 (b): no switch for it any more), so the advice never names a crafting setting.
 */
function handStepWarnings(pack: Pack, steps: readonly PlanStep[], graph: CandidateGraph): PlanWarning[] {
  const byHand = new Map(graph.recipes.flatMap((r): Array<[string, string]> => (r.byHand === undefined ? [] : [[r.id, r.byHand]])));
  return steps.filter((s) => s.handCraft).map((s): PlanWarning => {
    const key = s.mainOutput ?? s.outputs[0]?.key ?? s.recipeId;
    let perRun = 0;
    for (const p of s.outputs) if (p.key === key) perRun += p.amount;
    const rate = formatRate(perRun * s.runsPerSecond, 'hour', { fluid: isFluidKey(key) });
    const why = byHand.get(s.recipeId);
    const advice = why === undefined ? 'pin a machine recipe to automate it' : `it ${why}, so pin a machine recipe to automate it`;
    return { code: 'hand-step', stepId: s.id, text: `${pack.nameOf(key)} is crafted by hand: ${rate}; ${advice}` };
  });
}

/**
 * One `pin-dominated` warning per step whose recipe the project pins for its main output (`recipeChoice`) while its
 * cheapest alternative uses less than the pinned recipe's raw material per unit divided by PIN_DOMINATED_SHARE (fix spec
 * D24): the swap list's raw costs (`addAlternatives`, which leaves out recipes using an avoided good), among the recipes
 * the group can pick whose cost is no estimate (`exact`, by step id: the cost graph's and the step's own).
 */
function pinDominatedWarnings(pack: Pack, settings: PlanSettings, steps: readonly PlanStep[], exact: ReadonlyMap<string, ReadonlySet<string>>): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  for (const step of steps) {
    const key = step.mainOutput;
    if (key === undefined || !Object.hasOwn(settings.recipeChoice, key) || settings.recipeChoice[key] !== step.recipeId) continue;
    const priced = exact.get(step.id);
    const pinned = step.alternatives.find((a) => a.recipeId === step.recipeId);
    // Sorted by raw cost, then id, usable ones first.
    const cheapest = step.alternatives.find((a) => a.recipeId !== step.recipeId && a.unusable === undefined && priced?.has(a.recipeId) === true);
    if (pinned === undefined || cheapest === undefined || !(cheapest.rawCost < pinned.rawCost / PIN_DOMINATED_SHARE)) continue;
    const machine = pack.maps.get(cheapest.mapId)?.name ?? cheapest.mapId;
    warnings.push({
      code: 'pin-dominated', stepId: step.id, key,
      text: `${pack.nameOf(key)}: the pinned recipe uses ${formatNumber(pinned.rawCost)} raw per unit; ${machine} makes it for ${formatNumber(cheapest.rawCost)}`,
    });
  }
  return warnings;
}

/** What the line avoids where its machines hold parts (`heldOption`); nothing for a project that avoids nothing. */
function heldAvoid(request: AvoidRequest, line: SolvedLine): HeldAvoid | undefined {
  return request.listed ? { listed: request.goods, avoid: line.avoid } : undefined;
}

/**
 * `Plan.avoided` and the `avoid-unavoidable` warnings of the final line (ruling R10): each good of what the plain line
 * used (`AvoidingLine.used`; a derived leaf with what it is made from), `unavoidable` when it is allowed back and this
 * line still uses it; one warning per step and allowed-back good it uses, by step id then key: one flowing into the
 * step (flows, so ore-dictionary slots and Make N count), or one a not-consumed slot of its recipe holds (`heldOption`:
 * the machine "needs" it). A derived leaf uses what it is made from only where the line buys it (a flow from `raw`):
 * made in the line, its own steps avoid what they can.
 */
function unavoidableUses(
  pack: Pack, request: AvoidRequest, line: AvoidingLine, steps: readonly PlanStep[], flows: readonly PlanFlow[],
  buys: ReadonlyMap<StuffKey, number>, tier: number,
): { avoided: NonNullable<Plan['avoided']>; warnings: PlanWarning[] } {
  const stepOf = new Map(steps.map((s) => [s.id, s]));
  /** A derived leaf made from avoided goods: the rest of what the plain line used is on the list itself. */
  const derived = (key: StuffKey): boolean => !request.goods.has(key);
  const inUse = new Set([...buys.keys()].filter((key) => line.reallowed.has(key)));
  const uses = new Map<string, { stepId: string; key: StuffKey; machine: string; holds: boolean }>();
  for (const f of flows) {
    const step = stepOf.get(f.to);
    if (step === undefined || !line.reallowed.has(f.key) || (derived(f.key) && f.from !== RAW)) continue;
    inUse.add(f.key);
    uses.set(`${f.to}\n${f.key}`, { stepId: f.to, key: f.key, machine: step.machine.name, holds: false });
  }
  const parts = heldAvoid(request, line);
  for (const step of steps) {
    for (const ing of pack.recipeById.get(step.recipeId)?.inputs ?? []) {
      const key = ing.consumed ? undefined : heldOption(ing.options, parts)?.key;
      if (key === undefined || !line.reallowed.has(key) || derived(key)) continue;
      const id = `${step.id}\n${key}`;
      if (uses.has(id)) continue;
      inUse.add(key);
      uses.set(id, { stepId: step.id, key, machine: step.machine.name, holds: true });
    }
  }
  /** "Magnetic Steel Ingot (made from Steel Ingot)" for a derived leaf, else the good's name. */
  const named = (key: StuffKey): string => {
    const from = request.madeFrom(key).map((k) => pack.nameOf(k));
    if (from.length === 0) return pack.nameOf(key);
    const shown = from.length > MAX_LISTED ? `${from.slice(0, MAX_LISTED).join(', ')} and ${from.length - MAX_LISTED} more` : listed(from);
    return `${pack.nameOf(key)} (made from ${shown})`;
  };
  /**
   * Whether a use of an allowed-back good of the list is one its step could do without: every slot of its recipe that
   * takes the good, consumed or held, also takes a good the list does not cover (the step then takes it only because the
   * line allows it back: plan 12's build cost may pick it over adding the machines of the other option). A step with one
   * such slot that takes nothing else needs the good (plan 12's final review), as it does a part its machine holds, and a
   * derived leaf.
   */
  const couldAvoid = (use: { stepId: string; key: StuffKey; holds: boolean }): boolean => {
    const recipe = pack.recipeById.get(stepOf.get(use.stepId)?.recipeId ?? '');
    const slots = (recipe?.inputs ?? []).filter((ing) => ing.options.some((o) => o.key === use.key));
    return !use.holds && !derived(use.key) && slots.length > 0 && slots.every((ing) => keptOptions(ing.options, request.goods).length > 0);
  };
  /** Per good, the steps that need it: those whose use of it is no `couldAvoid` one. */
  const neededBy = new Map<StuffKey, string[]>();
  for (const use of uses.values()) {
    if (couldAvoid(use)) continue;
    const step = stepOf.get(use.stepId);
    if (step !== undefined) neededBy.set(use.key, [...(neededBy.get(use.key) ?? []), stepProductName(pack, step)]);
  }
  const warnings = [...uses.values()]
    .sort((a, b) => byString(a.stepId, b.stepId) || byString(a.key, b.key))
    .map((use): PlanWarning => {
      const { stepId, key, machine, holds } = use;
      // the controller's ruling after the verify of 5e3820f, (b): a step that takes the good although it could do
      // without it says that the line allows it back, for the steps that need it, not that no recipe avoids it; where no
      // step of the plan needs it (the avoid trial's that did is not in this plan), allowed back by the line alone
      // (plan 12's final review)
      if (!couldAvoid(use)) {
        return { code: 'avoid-unavoidable', key, stepId, text: `${machine} ${holds ? 'needs' : 'uses'} ${named(key)} — no recipe at ${tierName(tier)} avoids it` };
      }
      const neededFor = [...new Set(neededBy.get(key) ?? [])].sort(byString);
      return {
        code: 'avoid-unavoidable', key, stepId,
        text: `${machine} uses ${named(key)}, which the line allows back${neededFor.length > 0 ? ` for ${listed(neededFor)}` : ''}`,
      };
    });
  const avoided = line.used.map((key): NonNullable<Plan['avoided']>[number] => {
    const entry = { key, name: pack.nameOf(key), unavoidable: inUse.has(key) };
    const from = request.madeFrom(key);
    return from.length === 0 ? entry : { ...entry, madeFrom: [...from] };
  });
  return { avoided, warnings };
}


/**
 * The raw material to build one machine of a step (plan 12): `machineBuildCost` of its machine at its tier with the
 * step's recipe, so a multiblock carries its hatch set at its hatch tier; null for a pseudo machine and a pricing gap.
 */
function unitBuild(pack: Pack, model: BuildModel, step: PlanStep): number | null {
  const recipe = pack.recipeById.get(step.recipeId);
  return machineBuildCost(pack, model.prices, pack.machines.get(step.machine.mteId), recipe === undefined ? undefined : { recipe, tier: step.machine.tier });
}

/** New machines of one type a plan adds, and what building one costs (`each`; null: no price could be worked out). */
interface NewMachines { mteId: number; name: string; count: number; each: number | null }

/**
 * The new machines a plan adds, in step order: rate, `count − owned` of each step that holds machines (a sharing pool
 * once, by its first step: `machineGroups`); Make N, its added machine types (`MakeNResult.addedMachines`), each priced
 * with the first step of its type. Pseudo machines are never new.
 */
function newMachinesOf(pack: Pack, model: BuildModel, steps: readonly PlanStep[], made: MakeNResult | undefined): NewMachines[] {
  if (made !== undefined) {
    return made.addedMachines.flatMap(({ mteId, count }) => {
      const step = steps.find((s) => s.machine.mteId === mteId);
      return step === undefined ? [] : [{ mteId, name: step.machine.name, count, each: unitBuild(pack, model, step) }];
    });
  }
  return machineGroups(steps).flatMap((group) => {
    const first = group[0] as PlanStep;
    const count = first.count - first.owned;
    if (count <= 0 || first.handCraft || PSEUDO_IDS.has(first.machine.mteId)) return [];
    return [{ mteId: first.machine.mteId, name: first.machine.name, count, each: unitBuild(pack, model, first) }];
  });
}

/** What a plan spends raw material on while it runs: a rate's per second, or a batch's whole buys (`MakeNResult.buys`). */
type Spend = { mode: 'rate'; rawPerSecond: number } | { mode: 'makeN'; run: MakeNResult; graph: CandidateGraph };

/**
 * `Plan.cost` (plan 12, architecture §11.39; every plan that plans) and the `build-cost-unknown` warning. `build` = the
 * raw material to build the new machines (`newMachinesOf`) at their price, and the cleanroom when a step needs one and
 * the model's is not owned (its build, else 0) — never a stand-in: `unpriced` counts the new machines (a cleanroom
 * included) whose price is a pricing gap (controller ruling OQ5 b; a machine that cannot be built here is never new),
 * set only when above 0, and the warning names them, each type once, a cleanroom last: `Not counted in the build cost:
 * <names> (their price could not be worked out)`, `its price` for one, at most MAX_UNPRICED_NAMED names then ` and <n>
 * more`. Rate: `runPerHour` = the raw material a second × 3,600, `horizonHours` what build cost was weighed against
 * (null: ignored). Make N: `batch` = Σ bought × leaf cost, `runPerHour` that spread over the batch's time an hour,
 * `horizonHours` null.
 */
function planCost(
  pack: Pack, settings: PlanSettings, model: BuildModel, steps: readonly PlanStep[], spend: Spend,
): { cost: NonNullable<Plan['cost']>; warnings: PlanWarning[] } {
  const machines = newMachinesOf(pack, model, steps, spend.mode === 'makeN' ? spend.run : undefined);
  let build = 0;
  let unpriced = 0;
  const names = new Map<number, string>();
  for (const m of machines) {
    if (m.each !== null) build += m.count * m.each;
    else {
      unpriced += m.count;
      if (!names.has(m.mteId)) names.set(m.mteId, m.name);
    }
  }
  const unknown = [...names.values()];
  const room = model.cleanroom;
  if (room !== null && room.owned === 0 && steps.some((s) => s.needsCleanroom === true)) {
    if (room.build !== null) build += room.build;
    else {
      unpriced += 1;
      unknown.push(room.name);
    }
  }
  let cost: NonNullable<Plan['cost']>;
  if (spend.mode === 'rate') {
    const horizonHours = settings.buildHorizonHours === null ? null : (settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS);
    cost = { runPerHour: sig9(spend.rawPerSecond * SECONDS_PER_HOUR), build: sig9(build), horizonHours };
  } else {
    let batch = 0;
    for (const [key, amount] of spend.run.buys) batch += amount * (spend.graph.goods.get(key)?.cost ?? 0);
    batch = sig9(batch);
    const seconds = spend.run.totalSeconds;
    cost = { runPerHour: seconds > 0 ? sig9((batch * SECONDS_PER_HOUR) / seconds) : 0, build: sig9(build), horizonHours: null, batch };
  }
  if (unpriced > 0) cost.unpriced = unpriced;
  if (unknown.length === 0) return { cost, warnings: [] };
  const shown = unknown.slice(0, MAX_UNPRICED_NAMED).join(', ');
  const more = unknown.length > MAX_UNPRICED_NAMED ? ` and ${unknown.length - MAX_UNPRICED_NAMED} more` : '';
  const their = unknown.length === 1 ? 'its' : 'their';
  return { cost, warnings: [{ code: 'build-cost-unknown', text: `Not counted in the build cost: ${shown}${more} (${their} price could not be worked out)` }] };
}

/**
 * Controller Amendment OQ5 (ruling P5): a `tier-fallback` warning for each step whose pinned tier cannot be built here
 * (`BuildModel.pinFallback`) and that adds machines of the tier it fell back to: `<product> at <TIER>: <name> cannot be
 * built here (<why>), so your <n>× run beside <k>× <machine> (<TIER2>)` when the group's machines of the pinned tier serve
 * it (`reused.others`), else `…, so it runs on <k>× <machine> (<TIER2>)`.
 */
function tierFallbackWarnings(pack: Pack, model: BuildModel, steps: readonly PlanStep[]): PlanWarning[] {
  return steps.flatMap((step): PlanWarning[] => {
    const fallback = model.pinFallback(step.recipeId);
    if (fallback === undefined || !(step.count > step.owned)) return [];
    let mine = 0;
    for (const o of step.reused?.others ?? []) if (o.tier === fallback.tier) mine += o.count;
    const head = `${stepProductName(pack, step)} at ${tierName(fallback.tier)}: ${fallback.name} cannot be built here (${fallback.why}), so`;
    const runs = `${step.count}× ${step.machine.name} (${tierName(step.machine.tier)})`;
    return [{ code: 'tier-fallback', stepId: step.id, text: mine > 0 ? `${head} your ${mine}× run beside ${runs}` : `${head} it runs on ${runs}` }];
  });
}

/**
 * The step notes of the user's ruling 224 (plan 12 Task 7), on each step that builds new machines (`count > owned`): with
 * "Build machines at" a tier, where its new machines are of another tier and why (`BuildModel.buildTierFallback`):
 * `Built at <TIER2>, not <TIER>: <why>`; with "Multiblocks: only when nothing else can do it" and build cost counted
 * (where a new multiblock weighs ONLY_REQUIRED_MULTIBLOCK_WEIGHT more, so that any other route would have won), a new
 * multiblock: `A multiblock is needed: nothing else makes <product>`.
 */
function addBuildNotes(pack: Pack, settings: PlanSettings, model: BuildModel, steps: readonly PlanStep[]): void {
  const onlyRequired = settings.multiblocks === 'only-required' && buildCounts(model);
  for (const step of steps) {
    if (step.handCraft || !(step.count > step.owned)) continue;
    const built = model.buildTierFallback?.(step.recipeId);
    if (built !== undefined && step.machine.tier === built.tier) {
      step.warnings.push(`Built at ${tierName(built.tier)}, not ${tierName(built.wanted)}: ${built.why}`);
    }
    if (onlyRequired && pack.machines.get(step.machine.mteId)?.kind === 'multiblock') {
      step.warnings.push(`A multiblock is needed: nothing else makes ${stepProductName(pack, step)}`);
    }
  }
}

/** A maker is full where its machines (its sharing pool's) run at least this share of their time: the deep check's `relTol`. */
const FULL_SHARE = 1 - 1e-6;
/** Two ways of a good differ in raw material a unit only beyond this share and amount (the swap list rounds to 6 decimals). */
const RAW_UNIT_TIE = 1e-6;

/**
 * The goods a rate line with build cost counted makes two or more ways (`multi-producer`), or buys beside the steps that
 * make them (`bought-and-made`), on purpose (`Plan.deliberate`; plan 12's final review: the plan's side of controller
 * ruling 249's `needsMachine`, which the deep check reads), in the plan index's order. A step by hand or on a pseudo
 * machine has room for any share, any other for what its machines (its sharing pool's) leave idle, and makes a unit of
 * its main output for its swap list's raw cost (its own row, `addAlternatives`). Two or more makers: `full` where some
 * maker's machines are full and no maker can go within the plan's machines — the other makers that make the good for no
 * more raw material a unit have too little room for its share, so making it all one way needs another machine, which the
 * build stage weighed as dearer than the raw material it saves; a purchase: `full` where every step making the good
 * (as its main output or not) is full. Else `raw-cap` where the build stage's decision uses all the raw material the raw
 * cap allows (`Solution.atRawCap`) and the ways differ in raw material a unit (a purchase at what it costs a unit,
 * `rawInputs`), so the cap, not a tie, sets their shares. Every other finding stays an integrity issue.
 */
export function deliberateSplits(steps: readonly PlanStep[], flows: readonly PlanFlow[], rawInputs: readonly RawInput[], atRawCap: boolean): DeliberateSplit[] {
  const index = indexPlan({ steps, flows, warnings: [] });
  const byId = new Map(steps.map((s) => [s.id, s]));
  const stepOf = (id: string): PlanStep => byId.get(id) as PlanStep;
  const onNoMachine = (s: PlanStep): boolean => s.handCraft || s.machine.mteId < 0;
  const fullness = (s: PlanStep): number => {
    const pool = s.pool;
    return pool === undefined ? s.utilization : steps.filter((t) => t.pool?.id === pool.id).reduce((sum, t) => sum + t.utilization, 0);
  };
  const isFull = (s: PlanStep): boolean => !onNoMachine(s) && fullness(s) >= FULL_SHARE;
  /** How much more of a good `s` could make a second within its machines, making `perSecond` of it now. */
  const room = (s: PlanStep, perSecond: number): number =>
    (onNoMachine(s) || !(s.utilization > 0) ? Infinity : (Math.max(0, 1 - fullness(s)) * perSecond) / s.utilization);
  /** Raw material a unit of its main output; NaN where its swap list lacks its own recipe (then it may take any share). */
  const unitRaw = (s: PlanStep): number => s.alternatives.find((a) => a.recipeId === s.recipeId)?.rawCost ?? NaN;
  const dearer = (a: number, b: number): boolean => a > b * (1 + RAW_UNIT_TIE) + RAW_UNIT_TIE;
  const differ = (costs: readonly number[]): boolean => {
    const known = costs.filter((c) => Number.isFinite(c));
    return known.length >= 2 && dearer(Math.max(...known), Math.min(...known));
  };
  const out: DeliberateSplit[] = [];
  for (const issue of index.issues) {
    if (issue.code !== 'multi-producer' && issue.code !== 'bought-and-made') continue;
    const makers = index.producers.get(issue.key) ?? [];
    const mains = makers.filter((p) => p.main);
    if (issue.code === 'multi-producer') {
      const full = mains.filter((p) => isFull(stepOf(p.stepId))).map((p) => p.stepId);
      const canGo = mains.some((p) => {
        let spare = 0;
        for (const q of mains) {
          if (q !== p && !dearer(unitRaw(stepOf(q.stepId)), unitRaw(stepOf(p.stepId)))) spare += room(stepOf(q.stepId), q.perSecond);
        }
        return spare >= p.perSecond * FULL_SHARE;
      });
      if (full.length > 0 && !canGo) out.push({ key: issue.key, code: issue.code, why: 'full', full });
      else if (atRawCap && differ(mains.map((p) => unitRaw(stepOf(p.stepId))))) out.push({ key: issue.key, code: issue.code, why: 'raw-cap' });
      continue;
    }
    const full = makers.filter((p) => isFull(stepOf(p.stepId))).map((p) => p.stepId);
    const bought = rawInputs.find((r) => r.key === issue.key);
    const price = bought !== undefined && bought.perSecond > 0 ? bought.cost / bought.perSecond : NaN;
    if (makers.length > 0 && full.length === makers.length) out.push({ key: issue.key, code: issue.code, why: 'full', full });
    else if (atRawCap && differ([price, ...mains.map((p) => unitRaw(stepOf(p.stepId)))])) out.push({ key: issue.key, code: issue.code, why: 'raw-cap' });
  }
  return out;
}

/** The line `planLine` plans: its pricing and avoid list, its graph solved, and the build model it was solved with. */
interface PlannedLine {
  priced: LinePricing; avoid: AvoidRequest; line: AvoidingLine;
  /** Absent only when an avoid list's probe found the line infeasible before any full solve. */
  model?: BuildModel;
  /** Every step recipe the line was walked without, because no machine that runs it can be built here, with why. */
  unbuildable: ReadonlyMap<string, string>;
}

/**
 * The line solved (plan 12; controller ruling OQ5 a in every mode, Amendment OQ3, ruling P2): the graph it solves in
 * full — the plain one without an avoid list, else the one `avoidingLine` finds — is solved with its build model
 * (`lineBuildModel`), and while a model blocks some of its graph's recipes (no machine that runs them can be built here
 * or is owned), the line is walked again without every recipe blocked so far and the pack's other recipes on their maps
 * that no machine can run either (`BuildModel.blockedAlike`; `linePricing`'s `unbuildable`, which `avoidingLine`'s walks
 * leave out too), so producers that can run take their place; the set only grows, so this ends.
 * With an avoid list the plain line is first only probed (probes get no model), and a probe that plans nothing ends it.
 */
async function plannedLine(
  pack: Pack, settings: PlanSettings, ctx: PlanContext, first: LinePricing, demand: ReadonlyMap<StuffKey, number>, options: SolveOptions,
): Promise<PlannedLine> {
  const unbuildable = new Map<string, string>();
  /**
   * Whether `model` blocks a recipe the line is not yet walked without; it is added to the set, with the pack's other
   * recipes on its maps that no machine can run either (`BuildModel.blockedAlike`), so one walk goes around a machine
   * that cannot be built, whichever of its recipes the line would pick next.
   */
  const blocks = (model: BuildModel): boolean => {
    let grew = false;
    for (const [id, why] of model.blocked) {
      if (unbuildable.has(id)) continue;
      unbuildable.set(id, why);
      grew = true;
    }
    if (grew) for (const [id, why] of model.blockedAlike ?? []) if (!unbuildable.has(id)) unbuildable.set(id, why);
    return grew;
  };
  for (let priced = first; ;) {
    const pricing = priced;
    const open = pricing.graph;
    const avoid = avoidRequest(pack, settings, pricing.target, pricing);
    const openModel = await lineBuildModel(pack, open, pricing.basis, settings, ctx);
    if (!blocks(openModel)) {
      const full: FullSolve = async (graph) => {
        const model = graph === open ? openModel : await lineBuildModel(pack, graph, pricing.basis, settings, ctx);
        if (blocks(model)) return null;
        return { sol: await solveLine(graph, demand, { ...options, build: model }), model };
      };
      const plainLine = (sol: Solution): AvoidingLine => ({ graph: open, sol, avoid: avoid.goods, used: [], reallowed: new Set() });
      if (avoid.goods.size === 0) {
        return { priced: pricing, avoid, line: plainLine(await solveLine(open, demand, { ...options, build: openModel })), model: openModel, unbuildable };
      }
      const plain = await solveLine(open, demand, { ...options, probe: true });
      if (plain.status === 'infeasible') return { priced: pricing, avoid, line: plainLine(plain), unbuildable };
      const found = await avoidingLine(pack, settings, pricing, plain, demand, avoid, options, full);
      if (found !== null) return { priced: pricing, avoid, line: found.line, model: found.model, unbuildable };
    }
    const next = linePricing(pack, settings, ctx, { unbuildable });
    if (next === null) throw new Error('planLine: the target is gone between two pricings of one line');
    priced = await next;
  }
}

/**
 * The build MIP's limits a test or a calibration run may set for every solve of a line (`SolveOptions`: the time guard,
 * nodes and simplex iterations); planning a project never sets them (plan 12 fix wave 2: the real-data fallback test).
 */
export type SolveTuning = Pick<SolveOptions, 'buildTimeLimit' | 'buildMaxNodes' | 'buildMaxIterations'>;

/**
 * Plans one line (spec §3.2–§3.11): least raw material at the project's tier where the group can reach — with the raw
 * material to build the machines it adds weighed against the build horizon (Make N: the batch; plan 12) — each recipe
 * step paying for itself in raw material (the project's step charge, `solveOptions`), as a steady rate or as a batch of N
 * on the machines the group owns, keeping out of the materials the project avoids where any plan can (`avoidingLine`),
 * and around the steps no machine that can be built here or is owned can run (`plannedLine`). A missing or unknown
 * target gives an `empty` plan; a target nothing reachable makes gives an `infeasible` plan whose warnings say what
 * blocks it and what unlocks it. Every plan that plans has its `cost` (`planCost`). `tuning` (tests and calibration
 * only) overrides the build MIP's limits.
 */
export async function planLine(pack: Pack, settings: PlanSettings, ctx: PlanContext, tuning?: SolveTuning): Promise<Plan> {
  // Each synchronous stretch (availability, each candidate walk, each LP solve) yields first, so other
  // requests and live events go on between them (ledger 200).
  await yieldToEventLoop();
  // The line's prices (pricing.ts), shared with `expandBomLines`; none without a target the export knows.
  const pricing = linePricing(pack, settings, ctx);
  if (pricing === null) {
    const empty: PlanWarning = settings.target === null
      ? { code: 'no-target', text: 'Pick something to make' }
      : { code: 'unknown-target', text: 'This item is not in the current recipe export' };
    const avoid = avoidRequest(pack, settings, null, null);
    return assemble(pack, settings, planBasis(pack, settings, ctx), withAvoided(bodyWithout('empty', [empty, ...avoid.warnings]), avoid, []));
  }
  const first = await pricing;
  const { target, basis } = first;
  const batch = settings.mode === 'makeN';
  const demand = new Map([[target, batch ? settings.amount : settings.amount / SECONDS_PER[settings.per]]]);
  // What the plan is for (fix spec R11): the client reads the target and its rate instead of guessing them from flows.
  const aim: Pick<PlanBody, 'target' | 'targetPerSecond'> = batch
    ? { target } : { target, targetPerSecond: sig9(settings.amount / SECONDS_PER[settings.per]) };
  // Steps vs raw material (fix spec R3) for every solve of the line, the forms of goods that tell twin recipes apart
  // (`stockForm`), the group's stock its byproduct-only goods are priced against (`groupStock`, fix wave 3 (C)), and the
  // build model of each graph solved in full.
  const options = { ...solveOptions(settings), formRank: stockForm(pack), stock: groupStock(settings, ctx), ...tuning };
  const planned = await plannedLine(pack, settings, ctx, first, demand, options);
  const { priced, avoid, line, model: buildModel, unbuildable } = planned;
  const { graph, sol } = line;
  const { model } = priced;
  const solverWarnings = sol.warnings.map((w) => namedSolverWarning(pack, graph, sol, w));

  if (sol.status === 'infeasible' || buildModel === undefined) {
    // A graph cut short at its recipe cap names no blockers (solve.ts): its `graph-too-big` warning says why.
    const blocked = blockerWarnings(pack, sol, basis, settings, ctx);
    const warnings = [...graph.warnings, ...solverWarnings, ...blocked.warnings, ...avoid.warnings, ...stopsOutsideInputs(pack, settings)];
    return assemble(pack, settings, basis, { ...withAvoided(bodyWithout('infeasible', warnings, blocked.unlocks), avoid, []), ...aim });
  }

  // A step's main output is its most valuable output the line uses (fix spec D13): its raw cost × what the other steps
  // take, never an empty container it hands back. The cost model's cost, but never below the good's plain price (as
  // R7 floors derived leaves): the cost model splits a recipe's cost between its co-products arbitrarily and prices many
  // intermediates 0 (Sulfuric Acid beside Water, Steel beside Ashes) or not at all (a Methyl Acetate Cell the model never
  // walked), and at 0 against free Water the litres won again ("makes Water").
  const value: Pick<StepLine, 'valueOf' | 'empties'> = {
    valueOf: (key) => {
      const cost = model.costs.cost(key);
      return Math.max(Number.isFinite(cost) ? cost : 0, basis.prices.price(key));
    },
    empties: emptyContainers(pack),
  };
  const opts = { settings, groupTier: basis.tier, coilHeat: basis.coilHeat, ctx, multiblocks: basis.env.multiblocks, value, build: buildModel };
  let steps: PlanStep[];
  let flows: PlanFlow[];
  let buys: ReadonlyMap<StuffKey, number>;
  let sinks: ReadonlyMap<StuffKey, number>;
  let made: Plan['makeN'];
  /** The runs the steps were sized from: per second, or the batch's whole runs (what their ingredient shares follow). */
  let stepRuns: ReadonlyMap<string, number>;
  let batchWarnings: PlanWarning[] = [];
  let spend: Spend;
  if (batch) {
    // Its whole runs buy byproduct-only goods against the stock the solve priced them against (fix wave 3 (C)).
    const run = await makeN(pack, graph, sol, demand, { ...opts, stock: options.stock });
    batchWarnings = batchShortWarning(pack, run.short, target, settings.amount);
    // The whole runs makeN planned (the same rounding again), spread over the batch's time: flows and byproducts are
    // rates, as in every plan, and the leftovers are what the line sinks.
    const whole = await wholeRuns(graph, sol, demand, options.stock);
    const perSecond = run.totalSeconds > 0 ? 1 / run.totalSeconds : 0;
    const leftovers = scaled(new Map(whole.leftovers.map((p) => [p.key, p.amount])), perSecond);
    flows = buildFlows(graph, { ...sol, runs: scaled(whole.runs, perSecond), buys: scaled(whole.buys, perSecond), sinks: leftovers }, [target]);
    sinks = leftovers;
    steps = run.steps;
    buys = run.buys;
    made = { totalSeconds: run.totalSeconds, leftovers: run.leftovers };
    stepRuns = whole.runs;
    spend = { mode: 'makeN', run, graph };
  } else {
    steps = planSteps(pack, graph, sol, { ...opts, perSecondScale: 1 });
    flows = buildFlows(graph, sol, [target]);
    buys = sol.buys;
    sinks = sol.sinks;
    stepRuns = sol.runs;
    spend = { mode: 'rate', rawPerSecond: sol.rawCost };
  }
  // Where the new machines are built and why a multiblock is needed (the user's ruling 224).
  addBuildNotes(pack, settings, buildModel, steps);
  const exact = await addAlternatives(pack, settings, basis, steps, model, graph, line.avoid, unbuildable);
  // Every option of each ore-dictionary slot, with its share in this plan and what it would cost (fix spec R9).
  await addOptions(pack, settings, ctx, steps, stepLine(graph, stepRuns), priced);
  // A batch may be crafted by hand (fix spec D7); a pin is judged against the swap list just made (D24); a pinned tier
  // that cannot be built says so (plan 12).
  const stepWarnings = [
    ...(batch ? [] : handStepWarnings(pack, steps, graph)), ...pinDominatedWarnings(pack, settings, steps, exact),
    ...tierFallbackWarnings(pack, buildModel, steps),
  ];
  const cost = planCost(pack, settings, buildModel, steps, spend);

  const raw = rawInputsOf(pack, graph, basis, priced.chains, ctx, buys, made?.totalSeconds ?? null, gatheredRecipesOn(settings));
  // What a rate line with build cost counted makes two ways, or buys beside its makers, on purpose (plan 12's final
  // review): the plan index gives those as notes, not as integrity issues.
  const deliberate = !batch && sol.buildStats !== undefined ? deliberateSplits(steps, flows, raw.rawInputs, sol.atRawCap === true) : [];
  // Make N steps of one machine type share that type's machines (makeN), so they draw at most once per type.
  const power = powerSummary(steps, { sharedByType: batch });
  // The parts the machines hold are ones the line may use (ruling R7): never an option it still avoids.
  const held = heldAvoid(avoid, line);
  // The build list breaks down at the plain pricing's prices (`first`, the one `expandBomLines` reads for the layout's
  // parts), also after a walk around machines that cannot be built, so a line's machines and its layout parts break down
  // alike (architecture §11.15; the controller's ruling after plan 12 Task 5, item (a)).
  const bom = await buildBom(pack, steps, { settings, env: basis.env, leaf: first.buildLeaf, ctx, avoid: held });
  const uses = unavoidableUses(pack, avoid, line, steps, flows, buys, basis.tier);
  const body: PlanBody = {
    status: 'ok', unlocks: [], steps, flows, rawInputs: raw.rawInputs, byproducts: byproductsOf(graph, sinks, target), power,
    buildList: bom.lines, buildTotals: bom.totals,
    buildSteps: buildSteps(pack, { steps, bom, power, settings, tier: basis.tier, target, totalSeconds: made?.totalSeconds, avoid: held }),
    warnings: [
      ...graph.warnings, ...solverWarnings, ...stepWarnings, ...batchWarnings, ...raw.warnings,
      ...beyondStockWarnings(pack, graph, settings, ctx, buys), ...cost.warnings, ...bom.warnings, ...avoid.warnings,
      ...uses.warnings, ...stopsOutsideInputs(pack, settings),
    ],
    ...aim,
    cost: cost.cost,
  };
  if (deliberate.length > 0) body.deliberate = deliberate;
  if (made !== undefined) body.makeN = made;
  // The raw material the plan uses against the least any plan of its graph needs (fix spec R3): a rate's trade-off.
  if (!batch) {
    body.rawCost = { perSecond: sol.rawCost, leastPerSecond: sol.leastRawCost };
    if (sol.leanRawCost !== undefined) body.rawCost.leanestPerSecond = sol.leanRawCost;
  }
  // Supporting lines come from the finished steps and flows (fix spec R6).
  return withLines(pack, basis, assemble(pack, settings, basis, withAvoided(body, avoid, uses.avoided)));
}
