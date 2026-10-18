// The line planner (spec §3.2–§3.11): one pass from a project's settings and world context to the whole `Plan` — the
// candidate recipes, raw-material costs and alternatives, the solve, machines per step (rate) or whole crafts on owned
// machines (Make N), the raw inputs with their sources, power, the build list and build steps, and the English names
// the client shows. Also the settings hash and the plan cache the plan route keys on (architecture §7, §11.8).

import { createHash } from 'node:crypto';
import { V, tierName } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { DimensionInfo, Pack, Product } from '../../shared/types/pack.ts';
import type {
  BomLine, Plan, PlanContext, PlanFlow, PlanSettings, PlanStep, PlanWarning, PowerSummary, RawInput, SourceInfo,
} from '../../shared/types/plan.ts';
import { isBaseItem, unlockText } from './availability.ts';
import { planBasis, type PlanBasis } from './basis.ts';
import { buildBom } from './bom.ts';
import { buildCandidates, type CandidateGraph, type LeafOracle, type LpRecipe } from './candidates.ts';
import { analyzeCosts, makeLeafOracle, type CostAnalysis } from './costs.ts';
import { buildFlows, planSteps } from './machines.ts';
import { makeN, wholeRuns } from './make-n.ts';
import { yieldToEventLoop } from './lp.ts';
import { MAX_NAMED_LOOP_RECIPES, solveLine, standaloneCosts, type Solution } from './solve.ts';
import { buildSteps } from './steps.ts';

export { effectiveTier } from './basis.ts';

const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const DEFAULT_CACHE_SIZE = 32;
/** A machine or amp count this little above a whole number stays whole. */
const TINY = 1e-9;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 9 decimal places; −0 reads 0 (the rounding of `Solution`). */
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

/** A copy of `value` whose objects list their keys in sorted order, at every depth; arrays keep their order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort(byString).map((key) => [key, withSortedKeys(record[key])]));
}

/** The first 16 hex digits of the SHA-1 of the settings as JSON with every object's keys sorted. */
export function settingsHash(s: PlanSettings): string {
  return createHash('sha1').update(JSON.stringify(withSortedKeys(s))).digest('hex').slice(0, 16);
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

/** The cost analysis behind stop-item prices and alternatives, and the graph it ran on. */
interface CostModel { graph: CandidateGraph; costs: CostAnalysis }

/**
 * Raw-material costs over a candidate graph built without pins and stop items and with derived base materials routed,
 * so every recipe of a good is an alternative, costs count raw material (not stop prices), and every derived material
 * the line may buy has the cost of making it (`makeLeafOracle`'s `derivedCost`). A stop item or derived material that
 * graph cannot make (nothing at the tier makes it, but the group already does, or gets it some other way) would cost
 * Infinity there and hide every recipe that uses it, the one the plan chose among them; such goods are leaves at their
 * stop price (key override, else price) instead.
 */
async function costModel(pack: Pack, settings: PlanSettings, basis: PlanBasis, target: StuffKey): Promise<CostModel> {
  const analyze = async (stopItems: StuffKey[]): Promise<CostModel> => {
    await yieldToEventLoop();
    const s: PlanSettings = { ...settings, recipeChoice: {}, stopItems, routeDerived: true };
    const graph = buildCandidates(pack, s, basis.env, makeLeafOracle(pack, s, basis.avail, basis.prices), [target]);
    return { graph, costs: await analyzeCosts(graph) };
  };
  const open = await analyze([]);
  const unmade = (key: StuffKey): boolean => key !== target && open.graph.goods.has(key) && !Number.isFinite(open.costs.cost(key));
  const derived = [...open.graph.goods.keys()].filter((key) => basis.avail.classOf(key) === 'derived' && isBaseItem(pack, key));
  const stuck = [...new Set([...settings.stopItems, ...derived])].filter(unmade);
  return stuck.length > 0 ? analyze(stuck) : open;
}

/** A swap list holds at most this many recipes (the one in use always among them). */
const MAX_ALTERNATIVES = 20;
/** Inputs and outputs listed per alternative. */
const MAX_ALTERNATIVE_PARTS = 4;

/** What one run of a recipe takes (first option of each consumed slot) and makes, summed per key, largest first, at most 4. */
function recipeParts(pack: Pack, recipeId: string): { inputs: Array<{ key: StuffKey; amount: number }>; outputs: Array<{ key: StuffKey; amount: number }> } {
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
      const first = ing.options[0];
      return ing.consumed && first !== undefined ? [[first.key, first.amount]] : [];
    })),
    outputs: sum(r.outputs.map((p): [StuffKey, number] => [p.key, p.amount])),
  };
}

/** Producers of each wanted good in the cost graph, ranked by raw cost per unit then id; finite costs only. */
function alternativesFor(model: CostModel, wanted: ReadonlySet<StuffKey>): Map<StuffKey, PlanStep['alternatives']> {
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
  const out = new Map<StuffKey, PlanStep['alternatives']>();
  for (const key of wanted) {
    const list = (producers.get(key) ?? []).flatMap((r) => {
      const rawCost = model.costs.recipeCost(r.id, key);
      return Number.isFinite(rawCost) ? [{ recipeId: r.id, rawCost: round6(rawCost), mapId: r.mapId as string }] : [];
    });
    out.set(key, list.sort((a, b) => a.rawCost - b.rawCost || byString(a.recipeId, b.recipeId)));
  }
  return out;
}

/**
 * Each step's swap list (spec §3.9, alternatives by raw material use): the cheapest MAX_ALTERNATIVES producers of its
 * main output in the cost graph, the step's own recipe always kept, each with what it takes and makes.
 */
function addAlternatives(pack: Pack, steps: PlanStep[], model: CostModel): void {
  const wanted = new Set(steps.flatMap((s) => (s.mainOutput === undefined ? [] : [s.mainOutput])));
  const alternatives = alternativesFor(model, wanted);
  for (const step of steps) {
    const all = step.mainOutput === undefined ? [] : (alternatives.get(step.mainOutput) ?? []);
    const kept = all.slice(0, MAX_ALTERNATIVES);
    const own = all.find((a) => a.recipeId === step.recipeId);
    if (own !== undefined && !kept.includes(own)) kept[kept.length - 1] = own;
    step.alternatives = kept.map((a) => ({ ...a, ...recipeParts(pack, a.recipeId) }));
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
 * A `free-loop` warning in names (solve.ts has no pack): the targets by name and the recipes the loop guard left out
 * as "<machine> making <product>", the same label once, at most MAX_NAMED_LOOP_RECIPES and a count of the rest.
 */
function namedSolverWarning(pack: Pack, graph: CandidateGraph, sol: Solution, w: PlanWarning): PlanWarning {
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
 * target itself is out of reach at this tier and no blocker names it or an out-of-reach base material, the blockers
 * are side roads of the walk (a part that only a recycling chain would turn back into the target), so the target's
 * own unlock hint ("needs EV machines") replaces them.
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
  const sideRoads = sol.blockers.length > 0 && sol.blockers.every((b) => b.reason !== 'unavailable' && b.key !== target);
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

/**
 * One raw input per purchase, sorted by key: per second (in Make N the batch's total spread over its time, plus the
 * total), its cost (leaf cost × the amount: per second, or the batch's), sources, stock and leaf class; a `derived`
 * leaf also gets a warning that says how to plan its chain.
 */
function rawInputsOf(
  pack: Pack, graph: CandidateGraph, basis: PlanBasis, ctx: PlanContext, buys: ReadonlyMap<StuffKey, number>, batchSeconds: number | null,
): { rawInputs: RawInput[]; warnings: PlanWarning[] } {
  const rawInputs: RawInput[] = [];
  const warnings: PlanWarning[] = [];
  for (const [key, amount] of [...buys].sort(([a], [b]) => byString(a, b))) {
    const good = graph.goods.get(key);
    const leafClass = good?.leafClass ?? undefined;
    const perSecond = batchSeconds === null ? amount : batchSeconds > 0 ? amount / batchSeconds : 0;
    const input: RawInput = {
      key, perSecond: round9(perSecond), ...(batchSeconds === null ? {} : { total: amount }), cost: round9((good?.cost ?? 0) * amount),
      available: leafClass !== 'unavailable', sources: sourcesOf(basis, ctx, key),
    };
    const have = haveOf(ctx, key);
    if (have !== undefined) input.have = have;
    if (leafClass !== undefined) input.leafClass = leafClass;
    rawInputs.push(input);
    if (leafClass === 'derived') {
      const detail = input.sources.find((s) => s.kind === 'derived')?.detail ?? 'made from other materials';
      warnings.push({
        code: 'derived-leaf', key,
        text: `${pack.nameOf(key)} is not mined anywhere you can reach; it is ${detail}. Turn on "plan derived materials" to include that chain.`,
      });
    }
  }
  return { rawInputs, warnings };
}

/** What the line throws away other than the target, per second; virtual ore-dictionary goods are never byproducts. */
function byproductsOf(graph: CandidateGraph, sinks: ReadonlyMap<StuffKey, number>, target: StuffKey): Product[] {
  return [...sinks]
    .filter(([key]) => key !== target && graph.goods.get(key)?.virtual !== true)
    .sort(([a], [b]) => byString(a, b))
    .map(([key, amount]) => ({ key, amount: round9(amount), chance: 1 }));
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
 * The English name of every key the plan uses (target, steps and their swap lists, flows, raw inputs, byproducts, build
 * list with its breakdown, totals, unlocks and warnings), `map:<id>` for every recipe map of a step or alternative,
 * `dim:<key>` for every dimension it reaches or a source names, and `dimId:<n>` for every dimension id a found spot
 * names; keys in sorted order.
 */
function planNames(pack: Pack, plan: Plan, target: StuffKey | null): Record<string, string> {
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

function assemble(pack: Pack, settings: PlanSettings, basis: PlanBasis, body: PlanBody): Plan {
  const plan: Plan = {
    settingsHash: settingsHash(settings), exportId: pack.manifest.exportId, tier: basis.tier, reachable: basis.reach.reachable,
    unlocks: body.unlocks, steps: body.steps, flows: body.flows, rawInputs: body.rawInputs, byproducts: body.byproducts,
    power: body.power, buildList: body.buildList, buildSteps: body.buildSteps, warnings: body.warnings,
  };
  if (body.makeN !== undefined) plan.makeN = body.makeN;
  plan.status = body.status;
  plan.buildTotals = body.buildTotals;
  plan.names = planNames(pack, plan, settings.target);
  return plan;
}

/**
 * Plans one line (spec §3.2–§3.11): least raw material at the project's tier where the group can reach, as a steady
 * rate or as a batch of N on the machines the group owns. A missing or unknown target gives an `empty` plan; a target
 * nothing reachable makes gives an `infeasible` plan whose warnings say what blocks it and what unlocks it.
 */
export async function planLine(pack: Pack, settings: PlanSettings, ctx: PlanContext): Promise<Plan> {
  // Each synchronous stretch (availability, each candidate walk, each LP solve) yields first, so other
  // requests and live events go on between them (ledger 200).
  await yieldToEventLoop();
  const basis = planBasis(pack, settings, ctx);
  const target = settings.target;
  if (target === null) return assemble(pack, settings, basis, bodyWithout('empty', [{ code: 'no-target', text: 'Pick something to make' }]));
  if (!pack.items.has(target) && !pack.fluids.has(target)) {
    return assemble(pack, settings, basis, bodyWithout('empty', [{ code: 'unknown-target', text: 'This item is not in the current recipe export' }]));
  }

  const model = await costModel(pack, settings, basis, target);
  const stopCost = (key: StuffKey): number => {
    const cost = model.costs.cost(key);
    return Number.isFinite(cost) ? cost : basis.prices.price(key);
  };
  // Derived leaves cost what making them on their own costs (`standaloneCosts` over the cost model's graph, where they
  // are routed, never consuming the target): first the graph at their plain prices, then again with the derived leaves
  // it buys priced, twice at most. One only a chain through the target makes is no leaf (Infinity).
  const priced = new Map<StuffKey, number>();
  const tried = new Set<StuffKey>();
  const leafWith = (): LeafOracle => makeLeafOracle(pack, settings, basis.avail, basis.prices, stopCost, (key) => priced.get(key));
  let leaf = leafWith();
  await yieldToEventLoop();
  let graph = buildCandidates(pack, settings, basis.env, leaf, [target]);
  for (let round = 0; round < 2; round++) {
    const unpriced = [...graph.goods.values()].filter((g) => g.leafClass === 'derived' && g.buyable && !tried.has(g.key)).map((g) => g.key);
    if (unpriced.length === 0) break;
    for (const key of unpriced) tried.add(key);
    for (const [key, cost] of await standaloneCosts(model.graph, unpriced, [target])) if (cost !== undefined) priced.set(key, cost);
    leaf = leafWith();
    await yieldToEventLoop();
    graph = buildCandidates(pack, settings, basis.env, leaf, [target]);
  }
  const batch = settings.mode === 'makeN';
  const demand = new Map([[target, batch ? settings.amount : settings.amount / SECONDS_PER[settings.per]]]);
  const sol = await solveLine(graph, demand);
  const solverWarnings = sol.warnings.map((w) => namedSolverWarning(pack, graph, sol, w));

  if (sol.status === 'infeasible') {
    // A graph cut short at its recipe cap names no blockers (solve.ts): its `graph-too-big` warning says why.
    const blocked = blockerWarnings(pack, sol, basis, settings, ctx);
    return assemble(pack, settings, basis, bodyWithout('infeasible', [...graph.warnings, ...solverWarnings, ...blocked.warnings], blocked.unlocks));
  }

  const opts = { settings, groupTier: basis.tier, coilHeat: basis.coilHeat, ctx, multiblocks: basis.env.multiblocks };
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
  addAlternatives(pack, steps, model);

  const raw = rawInputsOf(pack, graph, basis, ctx, buys, made?.totalSeconds ?? null);
  // Make N steps of one machine type share that type's machines (makeN), so they draw at most once per type.
  const power = powerSummary(steps, { sharedByType: batch });
  const bom = await buildBom(pack, steps, { settings, env: basis.env, leaf, ctx });
  const body: PlanBody = {
    status: 'ok', unlocks: [], steps, flows, rawInputs: raw.rawInputs, byproducts: byproductsOf(graph, sinks, target), power,
    buildList: bom.lines, buildTotals: bom.totals,
    buildSteps: buildSteps(pack, { steps, bom, power, settings, tier: basis.tier, target, totalSeconds: made?.totalSeconds }),
    warnings: [...graph.warnings, ...solverWarnings, ...batchWarnings, ...raw.warnings, ...bom.warnings],
  };
  if (made !== undefined) body.makeN = made;
  return assemble(pack, settings, basis, body);
}
