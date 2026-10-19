// The line planner (spec §3.2–§3.11): one pass from a project's settings and world context to the whole `Plan` — the
// candidate recipes, raw-material costs and alternatives, the solve (around the materials the project avoids, §3.3),
// machines per step (rate) or whole crafts on owned machines (Make N), the raw inputs with their sources, power, the
// build list and build steps, and the English names the client shows. Also the settings hash and the plan cache the
// plan route keys on (architecture §7, §11.8).

import { V, tierName } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, type PlanIssue } from '../../shared/plan/balance.ts';
import type { DimensionInfo, Pack, Product, Recipe } from '../../shared/types/pack.ts';
import type {
  BomLine, LeafClass, Plan, PlanContext, PlanFlow, PlanSettings, PlanStep, PlanWarning, PowerSummary, RawInput, SourceInfo,
} from '../../shared/types/plan.ts';
import { isBaseItem, unlockText, type Availability } from './availability.ts';
import { planBasis, resolveAvoid, settingsHash, type PlanBasis } from './basis.ts';
import { buildBom } from './bom.ts';
import {
  acceptRecipe, buildCandidates, heldOption, keptOptions, usesAvoided, type CandidateGraph, type HeldAvoid, type LeafDecision,
  type LeafOracle, type LpRecipe, type PlanEnv,
} from './candidates.ts';
import { analyzeCosts, type CostAnalysis } from './costs.ts';
import { buildFlows, emptyContainers, planSteps, type StepLine } from './machines.ts';
import { makeN, wholeRuns } from './make-n.ts';
import { yieldToEventLoop } from './lp.ts';
import { linePricing, type CostModel, type LinePricing } from './pricing.ts';
import { sig9 } from './round.ts';
import { MAX_NAMED_LOOP_RECIPES, solveLine, type Solution, type Standalone } from './solve.ts';
import { buildSteps } from './steps.ts';

export { effectiveTier, settingsHash } from './basis.ts';

const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const DEFAULT_CACHE_SIZE = 32;
/** A machine or amp count this little above a whole number stays whole. */
const TINY = 1e-9;

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

/** A swap list holds at most this many recipes (the one in use always among them). */
const MAX_ALTERNATIVES = 20;
/** Inputs and outputs listed per alternative. */
const MAX_ALTERNATIVE_PARTS = 4;

/**
 * What one run of a recipe takes (first option of each consumed slot the line may take, `keptOptions`) and makes, summed
 * per key, largest first, at most 4.
 */
function recipeParts(
  pack: Pack, recipeId: string, avoid: ReadonlySet<StuffKey>,
): { inputs: Array<{ key: StuffKey; amount: number }>; outputs: Array<{ key: StuffKey; amount: number }> } {
  const r = pack.recipeById.get(recipeId);
  const sum = (entries: Array<[StuffKey, number]>): Array<{ key: StuffKey; amount: number }> => {
    const totals = new Map<StuffKey, number>();
    for (const [key, amount] of entries) totals.set(key, (totals.get(key) ?? 0) + amount);
    return [...totals].map(([key, amount]) => ({ key, amount: round6(amount) }))
      .sort((a, b) => b.amount - a.amount || byString(a.key, b.key)).slice(0, MAX_ALTERNATIVE_PARTS);
  };
  if (r === undefined) return { inputs: [], outputs: [] };
  return {
    inputs: sum(r.inputs.flatMap((ing): Array<[StuffKey, number]> => {
      const first = keptOptions(ing.options, avoid)[0];
      return ing.consumed && first !== undefined ? [[first.key, first.amount]] : [];
    })),
    outputs: sum(r.outputs.map((p): [StuffKey, number] => [p.key, p.amount])),
  };
}

type Alternative = PlanStep['alternatives'][number];

function byRawCostThenId(a: Alternative, b: Alternative): number {
  return a.rawCost - b.rawCost || byString(a.recipeId, b.recipeId);
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
 * Each step's swap list (spec §3.9, alternatives by raw material use): the cheapest MAX_ALTERNATIVES producers of its
 * main output in the cost graph, each with what it takes and makes, and always the step's own recipe (Plan 2 Task 14:
 * "the one in use kept"), in the last place when it is not among the cheapest. The cost graph prunes by its own
 * estimates and the line's graph prices derived leaves and stop items differently, so the line can run a producer the
 * cost graph dropped (or a pinned one), even make a good the cost graph never walked: its recipe is listed anyway, at
 * its raw cost in the cost graph when it can run there, else at its raw cost in the line's own graph (`analyzeCosts`
 * of `graph`, run only then), else at what the good costs there. A step without a main output has nothing to swap.
 * A recipe that consumes or holds a good the line avoids (`avoid`, `usesAvoided`) is no alternative (ruling R6), except
 * the step's own.
 */
async function addAlternatives(pack: Pack, steps: PlanStep[], model: CostModel, graph: CandidateGraph, avoid: ReadonlySet<StuffKey>): Promise<void> {
  const wanted = new Set(steps.flatMap((s) => (s.mainOutput === undefined ? [] : [s.mainOutput])));
  const alternatives = alternativesFor(model, wanted);
  const avoids = (recipeId: string): boolean => {
    const r = pack.recipeById.get(recipeId);
    return r !== undefined && usesAvoided(r, avoid);
  };
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
  for (const step of steps) {
    const main = step.mainOutput;
    const all = (main === undefined ? [] : (alternatives.get(main) ?? [])).filter((a) => a.recipeId === step.recipeId || !avoids(a.recipeId));
    let own = all.find((a) => a.recipeId === step.recipeId);
    let ranked = all;
    if (own === undefined && main !== undefined) {
      own = { recipeId: step.recipeId, rawCost: round6(await ownCost(step.recipeId, main)), mapId: step.mapId };
      ranked = [...all, own].sort(byRawCostThenId);
    }
    const kept = ranked.slice(0, MAX_ALTERNATIVES);
    if (own !== undefined && !kept.includes(own)) kept[kept.length - 1] = own;
    step.alternatives = kept.map((a) => ({ ...a, ...recipeParts(pack, a.recipeId, avoid) }));
  }
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
 * The English name of every key the plan uses (target, steps with what they supply and their swap lists, flows, raw
 * inputs, byproducts, build list with its breakdown, totals, unlocks, warnings, the avoided goods with what they are
 * made from and the item and fluid entries of the avoid list, ruling R11), `map:<id>` for every recipe map of a step or
 * alternative, `dim:<key>` for every dimension it reaches or a source names, and `dimId:<n>` for every dimension id a
 * found spot names; keys in sorted order.
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
    addMap(step.mapId);
    for (const a of step.alternatives) {
      addMap(a.mapId);
      for (const p of [...(a.inputs ?? []), ...(a.outputs ?? [])]) add(p.key);
    }
  }
  for (const flow of plan.flows) add(flow.key);
  for (const input of plan.rawInputs) add(input.key);
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
 * this one may use of that.
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
 */
async function avoidingLine(
  pack: Pack, settings: PlanSettings, pricing: LinePricing, plain: Solution, demand: ReadonlyMap<StuffKey, number>, request: AvoidRequest,
): Promise<AvoidingLine> {
  const open = pricing.graph;
  const goods = request.goods;
  const amounts = amountsUsed(open, plain, request);
  const used = [...amounts.keys()].sort(byString);
  const without = (allowed: ReadonlySet<StuffKey>): Set<StuffKey> => new Set([...goods].filter((key) => !allowed.has(key)));
  if (used.length === 0) return { graph: open, sol: plain, avoid: goods, used, reallowed: new Set() };
  /** The derived leaves made from avoided goods the plain line buys. */
  const bought = used.filter((key) => !goods.has(key));
  const solve = async (allowed: ReadonlySet<StuffKey>): Promise<SolvedLine> => {
    const avoid = without(allowed);
    // The list's goods are all ones the plain line uses, allowed back with the derived leaves it buys: the plain line.
    if (avoid.size === 0 && bought.every((key) => allowed.has(key))) return { graph: open, sol: plain, avoid };
    const leaf: LeafOracle = (key) => (!allowed.has(key) && request.madeFrom(key).length > 0 ? NOT_BOUGHT : pricing.leaf(key));
    await yieldToEventLoop();
    const graph = buildCandidates(pack, settings, pricing.basis.env, leaf, [pricing.target], { avoid });
    return { graph, sol: await solveLine(graph, demand), avoid };
  };
  const strict = await solve(new Set());
  if (strict.sol.status === 'ok') return { ...strict, used, reallowed: new Set() };

  const unitCost = (key: StuffKey): number => {
    const cost = pricing.model.costs.cost(key);
    return Number.isFinite(cost) ? cost : pricing.basis.prices.price(key);
  };
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
  if (best === undefined) return { graph: open, sol: plain, avoid: without(new Set(used)), used, reallowed: new Set(used) };
  for (const key of [...reallowed].slice(0, -1)) {
    reallowed.delete(key);
    const tried = await solve(reallowed);
    if (tried.sol.status === 'ok') best = tried;
    else reallowed.add(key);
  }
  return { ...best, used, reallowed };
}

/** The flow end of what the line buys (machines.ts `buildFlows`). */
const RAW = 'raw';

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
 * Plans one line (spec §3.2–§3.11): least raw material at the project's tier where the group can reach, as a steady
 * rate or as a batch of N on the machines the group owns, keeping out of the materials the project avoids where any
 * plan can (`avoidingLine`). A missing or unknown target gives an `empty` plan; a target nothing reachable makes gives
 * an `infeasible` plan whose warnings say what blocks it and what unlocks it.
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
  const plain = await solveLine(priced.graph, demand);

  if (plain.status === 'infeasible') {
    // A graph cut short at its recipe cap names no blockers (solve.ts): its `graph-too-big` warning says why.
    const solverWarnings = plain.warnings.map((w) => namedSolverWarning(pack, priced.graph, plain, w));
    const blocked = blockerWarnings(pack, plain, basis, settings, ctx);
    const warnings = [...priced.graph.warnings, ...solverWarnings, ...blocked.warnings, ...avoid.warnings];
    return assemble(pack, settings, basis, { ...withAvoided(bodyWithout('infeasible', warnings, blocked.unlocks), avoid, []), ...aim });
  }
  const line = await avoidingLine(pack, settings, priced, plain, demand, avoid);
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
  } else {
    steps = planSteps(pack, graph, sol, { ...opts, perSecondScale: 1 });
    flows = buildFlows(graph, sol, [target]);
    buys = sol.buys;
    sinks = sol.sinks;
  }
  await addAlternatives(pack, steps, model, graph, line.avoid);

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
    warnings: [...graph.warnings, ...solverWarnings, ...batchWarnings, ...raw.warnings, ...bom.warnings, ...avoid.warnings, ...uses.warnings],
    ...aim,
  };
  if (made !== undefined) body.makeN = made;
  // The raw material the plan uses against the least any plan of its graph needs (fix spec R3): a rate's trade-off.
  if (!batch) body.rawCost = { perSecond: sol.rawCost, leastPerSecond: sol.leastRawCost };
  return assemble(pack, settings, basis, withAvoided(body, avoid, uses.avoided));
}
