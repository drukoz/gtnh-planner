// The line planner (spec §3.2–§3.11): one pass from a project's settings and world context to the whole `Plan` — the
// candidate recipes, raw-material costs and alternatives, the solve (around the materials the project avoids, §3.3),
// machines per step (rate) or whole crafts on owned machines (Make N), the raw inputs with their sources, power, the
// build list and build steps, and the English names the client shows. Also the settings hash and the plan cache the
// plan route keys on (architecture §7, §11.8).

import { formatNumber, formatRate } from '../../shared/format.ts';
import { V, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, type PlanIssue } from '../../shared/plan/balance.ts';
import type { DimensionInfo, Ingredient, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import {
  DEFAULT_STEP_CHARGE, type BomLine, type LeafClass, type Plan, type PlanContext, type PlanFlow, type PlanSettings, type PlanStep,
  type PlanWarning, type PowerSummary, type RawInput, type SourceInfo, type StepOption,
} from '../../shared/types/plan.ts';
import { isBaseItem, unlockText, type Availability } from './availability.ts';
import { planBasis, resolveAvoid, settingsHash, type PlanBasis } from './basis.ts';
import { buildBom } from './bom.ts';
import {
  EXCLUSION_RULES, acceptRecipe, buildCandidates, heldOption, keptOptions, usesAvoided, type Acceptance, type CandidateGraph, type HeldAvoid,
  type LeafDecision, type LeafOracle, type LpRecipe, type PlanEnv,
} from './candidates.ts';
import { analyzeCosts, type CostAnalysis } from './costs.ts';
import { supportingLines } from './lines.ts';
import { buildFlows, emptyContainers, optionShares, planSteps, stepLine, type OptionShare, type StepLine } from './machines.ts';
import { makeN, wholeRuns } from './make-n.ts';
import { yieldToEventLoop } from './lp.ts';
import { aloneGraph, linePricing, type CostModel, type LinePricing } from './pricing.ts';
import { sig9 } from './round.ts';
import {
  HAND_STEP_WEIGHT, MAX_NAMED_LOOP_RECIPES, solveLine, standaloneCosts, type Solution, type SolveOptions, type Standalone,
} from './solve.ts';
import { buildSteps } from './steps.ts';

export { effectiveTier, settingsHash } from './basis.ts';

const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const DEFAULT_CACHE_SIZE = 32;
/** A machine or amp count this little above a whole number stays whole. */
const TINY = 1e-9;
/**
 * A pinned recipe whose raw material per unit is above this many times the cheapest alternative's gets a `pin-dominated`
 * warning (fix spec D24): the user's resistor pin used 0.783 raw per resistor where another recipe used 0.533.
 */
export const PIN_DOMINATED_SHARE = 1.01;

/**
 * How the line's solves trade steps against raw material (fix spec R3): the project's step charge (a project stored
 * before it gets the default), and a crafting-table step weighs HAND_STEP_WEIGHT steps in a running line whose crafting
 * is not automated (fix spec D7; a Make N batch may be crafted by hand).
 */
export function solveOptions(settings: PlanSettings): SolveOptions {
  return {
    stepCharge: settings.stepCharge ?? DEFAULT_STEP_CHARGE,
    handWeight: settings.mode === 'rate' && !settings.automateCrafting ? HAND_STEP_WEIGHT : 1,
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
 * The line's draw: `peakEUt` = Σ count × EU/t, `averageEUt` = Σ count × EU/t × utilization, `voltageTier` the highest
 * machine tier of the steps (0 without steps) and `amps` the amps that peak needs at that tier's voltage (0 without
 * draw). Whether it fits the group's power (`fits`) is Plan 5's.
 *
 * `sharedByType` (Make N, where every step of a machine type runs on that type's machines): the peak is instead
 * Σ over machine types (mteId) of the largest count × the largest EU/t among that type's steps, so shared machines
 * are counted once. The average is the same either way, because utilization already divides by the shared count.
 */
export function powerSummary(steps: PlanStep[], opts: { sharedByType?: boolean } = {}): PowerSummary {
  let peak = 0;
  let average = 0;
  let voltageTier = 0;
  const byType = new Map<number, { count: number; euPerTick: number }>();
  for (const step of steps) {
    average += step.count * step.euPerTick * step.utilization;
    voltageTier = Math.max(voltageTier, step.machine.tier);
    if (opts.sharedByType !== true) {
      peak += step.count * step.euPerTick;
      continue;
    }
    const type = byType.get(step.machine.mteId);
    if (type === undefined) byType.set(step.machine.mteId, { count: step.count, euPerTick: step.euPerTick });
    else {
      type.count = Math.max(type.count, step.count);
      type.euPerTick = Math.max(type.euPerTick, step.euPerTick);
    }
  }
  for (const type of byType.values()) peak += type.count * type.euPerTick;
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

/** A recipe's rejections that are no way of making anything of its own (display-only, unreadable, fuel, a duplicate). */
const NO_WAY: ReadonlySet<string> = new Set(['fake', 'opaque', 'fuel', 'vanilla-furnace']);

/**
 * The places out of the group's reach (`reachable`) that would give it `key`, by name in the pack's order: for a GT base
 * item, the dimensions whose veins or small ores hold its material and the capabilities that yield it; for a fluid, the
 * dimensions that pump it. "Moon (T1 rocket)", as unlock hints name them.
 */
function placesFor(pack: Pack, key: StuffKey, reachable: ReadonlySet<string>): string[] {
  const places = new Set<string>();
  if (isFluidKey(key)) {
    for (const source of pack.worldgen.fluidSources) if (source.fluid === key) for (const dim of source.dims) places.add(dim);
  } else {
    const material = isBaseItem(pack, key) ? pack.items.get(key)?.gt?.material : undefined;
    if (material !== undefined) {
      for (const vein of pack.worldgen.veins) if (Object.values(vein.materials).includes(material)) for (const dim of vein.dims) places.add(dim);
      for (const capability of pack.worldgen.capabilities) if (capability.yields.includes(material)) places.add(capability.key);
    }
  }
  const names: string[] = [];
  for (const dim of pack.worldgen.dimensions) {
    if (places.has(dim.key) && !reachable.has(dim.key)) names.push(dim.rocketTier === undefined ? dim.name : `${dim.name} (T${dim.rocketTier} rocket)`);
  }
  for (const capability of pack.worldgen.capabilities) if (places.has(capability.key) && !reachable.has(capability.key)) names.push(capability.name);
  return [...new Set(names)];
}

/**
 * Why the group cannot get `key` here, which availability does not reach, when the pack says: the places out of reach
 * that have it ("needs Moon (T1 rocket)", `placesFor`), else the lowest tier a recipe making it needs ("needs MV (your
 * tier is LV)": one level down, as the first thing in the way). Null when neither tells.
 */
function unobtainableReason(pack: Pack, key: StuffKey, env: PlanEnv): string | null {
  const places = placesFor(pack, key, env.reachable);
  if (places.length > 0) return `needs ${places.join(' or ')}`;
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
  pack: Pack, r: Recipe, env: PlanEnv, obtainable: (key: StuffKey) => boolean, avoid: ReadonlySet<StuffKey>,
): { mapId: string; reasons: string[] } | null {
  const accepted = acceptRecipe(pack, r, env);
  const firstMap = [...r.maps].sort(byString)[0] ?? '';
  if (accepted.ok) {
    const reasons = new Set<string>();
    for (const ing of r.inputs) {
      const options = keptOptions(ing.options, avoid);
      const first = options[0];
      if (first === undefined || options.some((o) => obtainable(o.key))) continue;
      reasons.add(unobtainableReason(pack, first.key, env) ?? `needs ${pack.nameOf(first.key)}, which you cannot get here`);
    }
    return { mapId: accepted.mapId, reasons: [...reasons] };
  }
  if (NO_WAY.has(accepted.why)) return null;
  if (accepted.why !== 'excluded') return { mapId: firstMap, reasons: [machineReason(r, accepted, env.tier)] };
  const categories = Object.entries(EXCLUSION_RULES).filter(([name, rule]) => env.excluded.has(name) && rule(r, pack)).map(([name]) => name);
  // `fromNothing` recipes are left out with the `lava-centrifuge` category (PlanEnv.fromNothing).
  const reasons = (categories.length > 0 ? categories : ['lava-centrifuge']).map((name) => `excluded: ${name.replaceAll('-', ' ')} (see Settings)`);
  const machine = acceptRecipe(pack, r, { ...env, excluded: new Set(), fromNothing: undefined });
  if (machine.ok) return { mapId: machine.mapId, reasons };
  if (NO_WAY.has(machine.why)) return null;
  return { mapId: firstMap, reasons: [...reasons, machineReason(r, machine, env.tier)] };
}

/** Whether the group can get a good here: availability reaches it, or the project says it already makes it. */
function obtainableIn(basis: PlanBasis, settings: PlanSettings): (key: StuffKey) => boolean {
  const stops = new Set(settings.stopItems);
  return (key) => basis.avail.available.has(key) || stops.has(key);
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
 * (ruling R6), except the step's own. Returns, per step id, the recipes of its list whose raw cost is no estimate (what
 * `pinDominatedWarnings` compares).
 */
async function addAlternatives(
  pack: Pack, settings: PlanSettings, basis: PlanBasis, steps: PlanStep[], model: CostModel, graph: CandidateGraph, avoid: ReadonlySet<StuffKey>,
): Promise<Map<string, ReadonlySet<string>>> {
  const wanted = new Set(steps.flatMap((s) => (s.mainOutput === undefined ? [] : [s.mainOutput])));
  const priced = alternativesFor(model, wanted);
  const obtainable = obtainableIn(basis, settings);
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
      const way = own ? { mapId: step.mapId, reasons: [] } : judgeWay(pack, r, basis.env, obtainable, avoid);
      if (way === null) continue;
      const inCostGraph = known.get(r.id);
      const rawCost = inCostGraph?.rawCost ?? round6(own ? await ownCost(r.id, main) : estimate(r, main));
      const row: Alternative = { recipeId: r.id, rawCost, mapId: inCostGraph?.mapId ?? way.mapId };
      if (way.reasons.length > 0) unusable.push({ ...row, unusable: way.reasons });
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
 * What one unit of an ingredient option costs, the recipes making it on its own runs, their maps by name, and why the
 * group cannot get it here, when it cannot.
 */
interface OptionPrice { cost: number; steps: number; via: string[]; unusable?: string[] }

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
 * from those options alone (`aloneGraph`), else at its plain price.
 */
async function optionPrices(pack: Pack, settings: PlanSettings, pricing: LinePricing, keys: readonly StuffKey[]): Promise<Map<StuffKey, OptionPrice>> {
  const { model, basis, target, leaf } = pricing;
  const containers = pack.fluidContainers ?? [];
  const obtainable = obtainableIn(basis, settings);
  const prices = new Map<StuffKey, OptionPrice>();
  const inModel: StuffKey[] = [];
  const unreached: StuffKey[] = [];
  for (const key of keys) {
    const d = leaf(key);
    const cost = model.costs.cost(key);
    if (!obtainable(key)) {
      prices.set(key, { cost: basis.prices.price(key), steps: 0, via: [], unusable: [unobtainableReason(pack, key, basis.env) ?? 'you cannot get it here'] });
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
      prices.set(key, {
        cost: Number.isFinite(cost) ? cost : basis.prices.price(key), steps: madeAlone ? chain.steps : 0, via: madeAlone ? viaOf(pack, graph, chain) : [],
      });
    }
  };
  if (inModel.length > 0) await chained(model.graph, model.costs, inModel);
  if (unreached.length > 0) {
    await yieldToEventLoop();
    const alone = aloneGraph(pack, settings, basis, model, unreached);
    await chained(alone, await analyzeCosts(alone), unreached);
  }
  return prices;
}

/**
 * Each step's ingredient options (`PlanStep.options`, fix spec R9 and D12): per consumed slot of its recipe with two or
 * more options the line may take (`keptOptions`), every one of them, those the walk left out too (controller ruling),
 * with what one run would take of it, its share of the slot in this plan (`optionShares` over `line`, the plan's own
 * runs), its raw material per run (amount × `optionPrices`' cost) and the steps and maps of its own chain, or why the
 * group cannot get it here (`unusable`); cheapest first, then by key. `pinned` names the option `optionChoice` pins when
 * the graph honours it. Priced once per plan.
 */
async function addOptions(pack: Pack, settings: PlanSettings, steps: readonly PlanStep[], line: StepLine, pricing: LinePricing): Promise<void> {
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
  const prices = await optionPrices(pack, settings, pricing, [...keys].sort(byString));
  for (const [step, slots] of slotsOf) {
    step.options = slots.map(({ ing, shares }): StepOption => {
      const choices = shares.map(({ option, share }): StepOption['choices'][number] => {
        const price = prices.get(option.key);
        const amount = sig9(option.amount * ing.chance);
        const choice: StepOption['choices'][number] = { key: option.key, amount, share, rawPerRun: round6(amount * (price?.cost ?? 0)), steps: price?.steps ?? 0 };
        if (price !== undefined && price.via.length > 0) choice.via = price.via;
        if (price?.unusable !== undefined) choice.unusable = [...price.unusable];
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
 * rest. `numerics`: the good it could not balance by name.
 */
function namedSolverWarning(pack: Pack, graph: CandidateGraph, sol: Solution, w: PlanWarning): PlanWarning {
  if (w.code === 'numerics' && w.key !== undefined) {
    return { ...w, text: `The solver could not balance ${pack.nameOf(w.key)} exactly; the plan uses an earlier stage` };
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
 * replaces them.
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
      warnings.push({ code: 'no-recipe', key: b.key, text: `Nothing at ≤ ${tierName(basis.tier)} makes ${name}${needs}` });
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
 * instead" can work; never for a free or gathered good, which the line takes as it is.
 */
function canMakeHere(pack: Pack, env: PlanEnv, key: StuffKey, leafClass: LeafClass | undefined): boolean {
  if (leafClass === 'free' || leafClass === 'natural') return false;
  return (pack.producers.get(key) ?? []).some((i) => {
    const r = pack.recipes[i] as Recipe;
    return r.outputs.some((p) => p.key === key && p.amount > 0 && p.chance > 0) && acceptRecipe(pack, r, env).ok;
  });
}

/**
 * One raw input per purchase, sorted by key: per second (in Make N the batch's total spread over its time, plus the
 * total), its cost (leaf cost × the amount: per second, or the batch's), sources, stock, leaf class, the chain a bought
 * derived material or stop item stands for (`chains`: its `pricedVia`; a derived one's source then names that chain) and
 * whether the group could make it here; the `derived` leaves also get one warning that says how to plan their chains
 * (`derivedLeafWarning`).
 */
function rawInputsOf(
  pack: Pack, graph: CandidateGraph, basis: PlanBasis, chains: ReadonlyMap<StuffKey, Standalone>, ctx: PlanContext,
  buys: ReadonlyMap<StuffKey, number>, batchSeconds: number | null,
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
    input.canMake = canMakeHere(pack, basis.env, key, leafClass);
    rawInputs.push(input);
    if (leafClass === 'derived') derived.push({ key, detail: input.sources.find((s) => s.kind === 'derived')?.detail ?? 'made from other materials' });
  }
  return { rawInputs, warnings: derivedLeafWarning(pack, derived) };
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
 * the plan says so instead of reading as if it worked out (spec §3.2 "shows how long it will take").
 */
export function batchShortWarning(pack: Pack, short: readonly Product[], target: StuffKey, amount: number): PlanWarning[] {
  if (short.length === 0) return [];
  const missingTarget = short.find((p) => p.key === target);
  const others = short.filter((p) => p.key !== target);
  const listed = others.slice(0, MAX_LISTED).map((p) => amountOf(pack, p.key, p.amount)).join(', ');
  const more = others.length > MAX_LISTED ? ` and ${others.length - MAX_LISTED} more` : '';
  const head = missingTarget === undefined ? '' : `The batch makes only ${Math.max(0, Math.round((amount - missingTarget.amount) * 100) / 100)} of ${amount} ${pack.nameOf(target)}. `;
  const tail = others.length === 0 ? '' : `Whole crafts do not balance: have ${listed}${more} ready before you start (cells or catalysts the chain hands round), or the batch comes out short.`;
  return [{ code: 'batch-short', key: missingTarget?.key ?? others[0]?.key, text: `${head}${tail}`.trim() }];
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
 * names, and `dimId:<n>` for every dimension id a found spot names; keys in sorted order.
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
  return Object.fromEntries([...names].sort(([a], [b]) => byString(a, b)));
}

/** The warning of an integrity issue (fix spec R11): its code, its §6.4 text, the good and the steps it is about. */
function integrityWarning(issue: PlanIssue, plan: Plan): PlanWarning {
  const w: PlanWarning = { code: issue.code, key: issue.key, text: issueText(issue, plan) };
  if (issue.stepId !== undefined) w.stepId = issue.stepId;
  if (issue.stepIds !== undefined) w.stepIds = [...issue.stepIds];
  if (issue.share !== undefined) w.share = [...issue.share];
  return w;
}

/**
 * The plan of `body`, named (`planNames`), with one warning per integrity issue of its flows (`indexPlan`: an input
 * nothing supplies or supplies short, a good made two ways, a good both bought and made). A correct plan has none; a
 * plan that has one says so instead of reading as if it added up.
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
  plan.names = planNames(pack, plan, settings);
  const issues = indexPlan(plan).issues;
  if (issues.length > 0) plan.warnings = [...plan.warnings, ...issues.map((issue) => integrityWarning(issue, plan))];
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
 * A full solve (the step charge, fix spec R3) costs far more than its least-raw stage, and only whether a line plans
 * and what it uses matter here: `plain` is a probe (`SolveOptions.probe`) and so is every trial; only the line found is
 * solved in full (`options`). Where that is the plain line itself, its full solve can use what the probe did not: a tie
 * the probe broke the other way, or the charge buying a derived leaf made from a good whose own chain the probe ran.
 * Then the search goes on from the full line as if the plain line had used that, so every use is listed and flagged.
 */
async function avoidingLine(
  pack: Pack, settings: PlanSettings, pricing: LinePricing, plain: Solution, demand: ReadonlyMap<StuffKey, number>, request: AvoidRequest,
  options: SolveOptions,
): Promise<AvoidingLine> {
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
        const graph = buildCandidates(pack, settings, pricing.basis.env, leaf, [pricing.target], { avoid, pinAvoid: goods });
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
  /** `line` with its graph solved in full. */
  const inFull = async (line: AvoidingLine): Promise<AvoidingLine> => ({ ...line, sol: await solveLine(line.graph, demand, options) });

  const found = await search(plain, amountsUsed(open, plain, request));
  // A trial's graph holds only the avoided goods and derived leaves it allowed back; the open graph holds them all.
  if (found.graph !== open) return inFull(found);
  const whole = await solveLine(open, demand, options);
  const amounts = amountsUsed(open, whole, request);
  if ([...amounts.keys()].every((key) => found.used.includes(key))) return { ...found, sol: whole };
  const again = await search(whole, amounts);
  return again.graph === open ? again : inFull(again);
}

/** The flow end of what the line buys (machines.ts `buildFlows`). */
const RAW = 'raw';

/**
 * One `hand-step` warning per step of a running line crafted by hand (fix spec D7): what it makes and how much an hour.
 * The step charge weighs such a step three times, so one that remains has no machine recipe that pays.
 */
function handStepWarnings(pack: Pack, steps: readonly PlanStep[]): PlanWarning[] {
  return steps.filter((s) => s.handCraft).map((s): PlanWarning => {
    const key = s.mainOutput ?? s.outputs[0]?.key ?? s.recipeId;
    let perRun = 0;
    for (const p of s.outputs) if (p.key === key) perRun += p.amount;
    const rate = formatRate(perRun * s.runsPerSecond, 'hour', { fluid: isFluidKey(key) });
    return { code: 'hand-step', stepId: s.id, text: `${pack.nameOf(key)} is crafted by hand: ${rate}; mark crafting as automated or pin a machine recipe` };
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
  const warnings = [...uses.values()]
    .sort((a, b) => byString(a.stepId, b.stepId) || byString(a.key, b.key))
    .map(({ stepId, key, machine, holds }): PlanWarning => ({
      code: 'avoid-unavoidable', key, stepId, text: `${machine} ${holds ? 'needs' : 'uses'} ${named(key)} — no recipe at ${tierName(tier)} avoids it`,
    }));
  const avoided = line.used.map((key): NonNullable<Plan['avoided']>[number] => {
    const entry = { key, name: pack.nameOf(key), unavoidable: inUse.has(key) };
    const from = request.madeFrom(key);
    return from.length === 0 ? entry : { ...entry, madeFrom: [...from] };
  });
  return { avoided, warnings };
}

/**
 * Plans one line (spec §3.2–§3.11): least raw material at the project's tier where the group can reach, each recipe step
 * paying for itself in raw material (the project's step charge, `solveOptions`), as a steady rate or as a batch of N on
 * the machines the group owns, keeping out of the materials the project avoids where any plan can (`avoidingLine`). A
 * missing or unknown target gives an `empty` plan; a target nothing reachable makes gives an `infeasible` plan whose
 * warnings say what blocks it and what unlocks it.
 */
export async function planLine(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<Plan> {
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
  const priced = await pricing;
  const { target, basis, model, leaf } = priced;
  const avoid = avoidRequest(pack, settings, target, priced);
  const batch = settings.mode === 'makeN';
  const demand = new Map([[target, batch ? settings.amount : settings.amount / SECONDS_PER[settings.per]]]);
  // What the plan is for (fix spec R11): the client reads the target and its rate instead of guessing them from flows.
  const aim: Pick<PlanBody, 'target' | 'targetPerSecond'> = batch
    ? { target } : { target, targetPerSecond: sig9(settings.amount / SECONDS_PER[settings.per]) };
  // Steps vs raw material (fix spec R3) for every solve of the line. With goods to avoid, the plain line is first only
  // probed (its least raw material: whether it plans and what it uses), and `avoidingLine` solves in full what it finds.
  const options = solveOptions(settings);
  const probing = avoid.goods.size > 0;
  const plain = await solveLine(priced.graph, demand, probing ? { ...options, probe: true } : options);

  if (plain.status === 'infeasible') {
    // A graph cut short at its recipe cap names no blockers (solve.ts): its `graph-too-big` warning says why.
    const solverWarnings = plain.warnings.map((w) => namedSolverWarning(pack, priced.graph, plain, w));
    const blocked = blockerWarnings(pack, plain, basis, settings, ctx);
    const warnings = [...priced.graph.warnings, ...solverWarnings, ...blocked.warnings, ...avoid.warnings];
    return assemble(pack, settings, basis, { ...withAvoided(bodyWithout('infeasible', warnings, blocked.unlocks), avoid, []), ...aim });
  }
  const line: AvoidingLine = probing
    ? await avoidingLine(pack, settings, priced, plain, demand, avoid, options)
    : { graph: priced.graph, sol: plain, avoid: avoid.goods, used: [], reallowed: new Set() };
  const { graph, sol } = line;
  const solverWarnings = sol.warnings.map((w) => namedSolverWarning(pack, graph, sol, w));

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
  const opts = { settings, groupTier: basis.tier, coilHeat: basis.coilHeat, ctx, multiblocks: basis.env.multiblocks, value };
  let steps: PlanStep[];
  let flows: PlanFlow[];
  let buys: ReadonlyMap<StuffKey, number>;
  let sinks: ReadonlyMap<StuffKey, number>;
  let made: Plan['makeN'];
  /** The runs the steps were sized from: per second, or the batch's whole runs (what their ingredient shares follow). */
  let stepRuns: ReadonlyMap<string, number>;
  let batchWarnings: PlanWarning[] = [];
  if (batch) {
    const run = await makeN(pack, graph, sol, demand, opts);
    batchWarnings = batchShortWarning(pack, run.short, target, settings.amount);
    // The whole runs makeN planned (the same rounding again), spread over the batch's time: flows and byproducts are
    // rates, as in every plan, and the leftovers are what the line sinks.
    const whole = await wholeRuns(graph, sol, demand);
    const perSecond = run.totalSeconds > 0 ? 1 / run.totalSeconds : 0;
    const leftovers = scaled(new Map(whole.leftovers.map((p) => [p.key, p.amount])), perSecond);
    flows = buildFlows(graph, { ...sol, runs: scaled(whole.runs, perSecond), buys: scaled(whole.buys, perSecond), sinks: leftovers }, [target]);
    sinks = leftovers;
    steps = run.steps;
    buys = run.buys;
    made = { totalSeconds: run.totalSeconds, leftovers: run.leftovers };
    stepRuns = whole.runs;
  } else {
    steps = planSteps(pack, graph, sol, { ...opts, perSecondScale: 1 });
    flows = buildFlows(graph, sol, [target]);
    buys = sol.buys;
    sinks = sol.sinks;
    stepRuns = sol.runs;
  }
  const exact = await addAlternatives(pack, settings, basis, steps, model, graph, line.avoid);
  // Every option of each ore-dictionary slot, with its share in this plan and what it would cost (fix spec R9).
  await addOptions(pack, settings, steps, stepLine(graph, stepRuns), priced);
  // A batch may be crafted by hand (fix spec D7); a pin is judged against the swap list just made (D24).
  const stepWarnings = [...(batch ? [] : handStepWarnings(pack, steps)), ...pinDominatedWarnings(pack, settings, steps, exact)];

  const raw = rawInputsOf(pack, graph, basis, priced.chains, ctx, buys, made?.totalSeconds ?? null);
  // Make N steps of one machine type share that type's machines (makeN), so they draw at most once per type.
  const power = powerSummary(steps, { sharedByType: batch });
  // The parts the machines hold are ones the line may use (ruling R7): never an option it still avoids.
  const held = heldAvoid(avoid, line);
  const bom = await buildBom(pack, steps, { settings, env: basis.env, leaf, ctx, avoid: held });
  const uses = unavoidableUses(pack, avoid, line, steps, flows, buys, basis.tier);
  const body: PlanBody = {
    status: 'ok', unlocks: [], steps, flows, rawInputs: raw.rawInputs, byproducts: byproductsOf(graph, sinks, target), power,
    buildList: bom.lines, buildTotals: bom.totals,
    buildSteps: buildSteps(pack, { steps, bom, power, settings, tier: basis.tier, target, totalSeconds: made?.totalSeconds, avoid: held }),
    warnings: [
      ...graph.warnings, ...solverWarnings, ...stepWarnings, ...batchWarnings, ...raw.warnings, ...bom.warnings, ...avoid.warnings, ...uses.warnings,
    ],
    ...aim,
  };
  if (made !== undefined) body.makeN = made;
  // The raw material the plan uses against the least any plan of its graph needs (fix spec R3): a rate's trade-off.
  if (!batch) body.rawCost = { perSecond: sol.rawCost, leastPerSecond: sol.leastRawCost };
  // Supporting lines come from the finished steps and flows (fix spec R6).
  return withLines(pack, basis, assemble(pack, settings, basis, withAvoided(body, avoid, uses.avoided)));
}
