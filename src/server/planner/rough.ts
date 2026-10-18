// Rough costs (prior-art §3.4 step 2, as a fast pre-pass): the cheapest raw cost of every good of the pack at the
// group's tier, by a label-correcting cheapest-path pass over every recipe the group can run, without byproduct credit.
// The candidate graph uses these costs to expand only the producers that can matter (spec §3.3 least raw material), and
// a derived base material the line buys is priced at what making it costs. The plan itself still comes from the main
// LP (solve.ts) over the candidate graph; these costs only choose what goes into that graph.

import type { StuffKey } from '../../shared/keys.ts';
import type { Pack, Recipe } from '../../shared/types/pack.ts';
import { acceptRecipe, type LeafOracle, type PlanEnv } from './candidates.ts';

export interface RoughCosts {
  /** The cheapest raw cost of one `key` (per item or per litre); Infinity when nothing the group can run makes it. */
  cost(key: StuffKey): number;
  /**
   * The raw cost per unit of `key` made by recipe `index` (into `pack.recipes`): its consumed inputs at their cheapest
   * option, divided by how much of `key` one run yields; a container the recipe hands back is not consumed. Infinity
   * when the group cannot run it, an input has no finite cost, or the recipe does not make `key`.
   */
  recipeCost(index: number, key: StuffKey): number;
  /** The recipe (index into `pack.recipes`) behind `cost(key)`; undefined for a good bought or never made. */
  via(key: StuffKey): number | undefined;
}

/** A cost may improve this many times per good: a gaining loop (matter from nothing) must not run forever. */
const MAX_IMPROVEMENTS = 16;
/** An improvement must lower a cost by more than this share of it. */
const IMPROVE_RATIO = 1e-9;
const CACHE_SIZE = 8;

/** Every recipe of the pack in index form: consumed slots, not-consumed slots and outputs, containers handed back. */
interface Structure {
  goodOf: Map<StuffKey, number>;
  containers: ReadonlyMap<StuffKey, Container>;
  /** Per recipe, its consumed slots `slotStart[r] .. slotStart[r + 1]`. */
  slotStart: Int32Array;
  /** Per consumed slot, its options `optStart[s] .. optStart[s + 1]`, and the recipe it belongs to. */
  optStart: Int32Array;
  slotRecipe: Int32Array;
  optGood: Int32Array;
  /** Per option, the slot it belongs to. */
  optSlot: Int32Array;
  /** Amount × consume chance: the share of the option one run uses up. */
  optAmount: Float64Array;
  /** Per recipe, its not-consumed slots (each a list of keys, any of which does). */
  notConsumed: Array<StuffKey[][] | undefined>;
  /** Per recipe, its outputs `outStart[r] .. outStart[r + 1]`: good and expected yield per run. */
  outStart: Int32Array;
  outGood: Int32Array;
  outYield: Float64Array;
  /** Per good, the option indices that name it: `consumerStart[g] .. consumerStart[g + 1]` into `consumerOpt`. */
  consumerStart: Int32Array;
  consumerOpt: Int32Array;
}

const STRUCTURES = new WeakMap<Pack, Structure>();

/** A filled container of `pack.fluidContainers`: its fluid, how much, and the empty container (null: none comes back). */
interface Container { empty: StuffKey | null; fluid: StuffKey; amount: number }

/**
 * One recipe's consumed slots and outputs for costing, in fluids: a filled container (a cell, bucket or capsule) in or
 * out counts as its fluid plus its empty container, and the same good in and out (an empty cell handed back, a
 * catalyst consumed by chance and returned) counts once, net; a good fully handed back only has to be there. So a
 * recipe that turns an Oxygen Cell into its products and an Empty Cell neither makes nor uses up a cell (most of the
 * 1,700 recipes that "make" an empty cell are such), and canning or emptying a cell does nothing.
 */
function normalized(r: Recipe, containers: ReadonlyMap<StuffKey, Container>): {
  slots: Array<Array<[StuffKey, number]>>; outputs: Map<StuffKey, number>; notConsumed: StuffKey[][];
} {
  const outputs = new Map<StuffKey, number>();
  const addOut = (key: StuffKey, y: number): void => {
    outputs.set(key, (outputs.get(key) ?? 0) + y);
  };
  for (const p of r.outputs) {
    if (p.chance <= 0 || p.amount <= 0) continue;
    const y = p.amount * p.chance;
    const c = containers.get(p.key);
    if (c === undefined) addOut(p.key, y);
    else {
      addOut(c.fluid, y * c.amount);
      if (c.empty !== null) addOut(c.empty, y);
    }
  }
  const slots: Array<Array<[StuffKey, number]>> = [];
  const notConsumed: StuffKey[][] = [];
  const emptiesIn = new Map<StuffKey, number>();
  for (const ing of r.inputs) {
    if (ing.options.length === 0) {
      slots.push([]);   // a slot nothing fills: the recipe never runs
      continue;
    }
    if (!ing.consumed || ing.chance <= 0) {
      notConsumed.push(ing.options.map((o) => o.key));
      continue;
    }
    const first = ing.options[0]!;
    const filled = containers.get(first.key);
    slots.push(ing.options.map((o): [StuffKey, number] => {
      const c = containers.get(o.key);
      return c === undefined ? [o.key, o.amount * ing.chance] : [c.fluid, o.amount * c.amount * ing.chance];
    }));
    if (filled?.empty != null) emptiesIn.set(filled.empty, (emptiesIn.get(filled.empty) ?? 0) + first.amount * ing.chance);
  }
  for (const [empty, n] of emptiesIn) slots.push([[empty, n]]);
  const kept: Array<Array<[StuffKey, number]>> = [];
  for (const slot of slots) {
    const only = slot.length === 1 ? slot[0] : undefined;
    const made = only === undefined ? 0 : (outputs.get(only[0]) ?? 0);
    if (only === undefined || made <= 0) {
      kept.push(slot);
      continue;
    }
    const net = Math.min(made, only[1]);
    outputs.set(only[0], made - net);
    if (only[1] - net <= 1e-12) notConsumed.push([only[0]]);   // fully handed back: it must be there, but costs nothing
    else kept.push([[only[0], only[1] - net]]);
  }
  for (const [key, y] of outputs) if (y <= 1e-12) outputs.delete(key);
  return { slots: kept, outputs, notConsumed };
}

function structureOf(pack: Pack): Structure {
  const known = STRUCTURES.get(pack);
  if (known !== undefined) return known;
  const containers = new Map<StuffKey, Container>();
  for (const c of pack.fluidContainers ?? []) {
    if (c.amount > 0 && !containers.has(c.container)) containers.set(c.container, { empty: c.empty, fluid: c.fluid, amount: c.amount });
  }
  const goodOf = new Map<StuffKey, number>();
  const id = (key: StuffKey): number => {
    let g = goodOf.get(key);
    if (g === undefined) {
      g = goodOf.size;
      goodOf.set(key, g);
    }
    return g;
  };
  const n = pack.recipes.length;
  const slotStart = new Int32Array(n + 1);
  const outStart = new Int32Array(n + 1);
  const optStartList: number[] = [];
  const slotRecipeList: number[] = [];
  const optGoodList: number[] = [];
  const optSlotList: number[] = [];
  const optAmountList: number[] = [];
  const outGoodList: number[] = [];
  const outYieldList: number[] = [];
  const notConsumed: Array<StuffKey[][] | undefined> = new Array(n);
  pack.recipes.forEach((r, i) => {
    slotStart[i] = slotRecipeList.length;
    outStart[i] = outGoodList.length;
    const shape = normalized(r, containers);
    for (const slot of shape.slots) {
      optStartList.push(optGoodList.length);
      slotRecipeList.push(i);
      for (const [key, amount] of slot) {
        optSlotList.push(slotRecipeList.length - 1);
        optGoodList.push(id(key));
        optAmountList.push(amount);
      }
    }
    for (const [key, y] of shape.outputs) {
      outGoodList.push(id(key));
      outYieldList.push(y);
    }
    if (shape.notConsumed.length > 0) notConsumed[i] = shape.notConsumed;
  });
  slotStart[n] = slotRecipeList.length;
  outStart[n] = outGoodList.length;
  optStartList.push(optGoodList.length);

  const goods = goodOf.size;
  const consumerStart = new Int32Array(goods + 1);
  for (const g of optGoodList) consumerStart[g + 1] = (consumerStart[g + 1] as number) + 1;
  for (let g = 0; g < goods; g++) consumerStart[g + 1] = (consumerStart[g + 1] as number) + (consumerStart[g] as number);
  const consumerOpt = new Int32Array(optGoodList.length);
  const next = consumerStart.slice(0, goods);
  optGoodList.forEach((g, o) => {
    consumerOpt[next[g] as number] = o;
    next[g] = (next[g] as number) + 1;
  });

  const structure: Structure = {
    goodOf, containers, slotStart, optStart: Int32Array.from(optStartList), slotRecipe: Int32Array.from(slotRecipeList),
    optGood: Int32Array.from(optGoodList), optSlot: Int32Array.from(optSlotList), optAmount: Float64Array.from(optAmountList), notConsumed,
    outStart, outGood: Int32Array.from(outGoodList), outYield: Float64Array.from(outYieldList), consumerStart, consumerOpt,
  };
  STRUCTURES.set(pack, structure);
  return structure;
}

/** A binary min-heap of (cost, good). */
class Heap {
  readonly #cost: number[] = [];
  readonly #good: number[] = [];
  get size(): number {
    return this.#cost.length;
  }
  push(cost: number, good: number): void {
    const c = this.#cost;
    const g = this.#good;
    let i = c.length;
    c.push(cost);
    g.push(good);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((c[parent] as number) <= cost) break;
      c[i] = c[parent] as number;
      g[i] = g[parent] as number;
      i = parent;
    }
    c[i] = cost;
    g[i] = good;
  }
  /** The smallest entry, removed; call only when not empty. */
  pop(): [number, number] {
    const c = this.#cost;
    const g = this.#good;
    const top: [number, number] = [c[0] as number, g[0] as number];
    const lastCost = c.pop() as number;
    const lastGood = g.pop() as number;
    if (c.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= c.length) break;
        const right = left + 1;
        const child = right < c.length && (c[right] as number) < (c[left] as number) ? right : left;
        if ((c[child] as number) >= lastCost) break;
        c[i] = c[child] as number;
        g[i] = g[child] as number;
        i = child;
      }
      c[i] = lastCost;
      g[i] = lastGood;
    }
    return top;
  }
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The env's content as a string, so equal envs share their results. */
function envKey(env: PlanEnv): string {
  return JSON.stringify([
    env.tier, [...env.reachable].sort(byString), env.lowGravity, env.coilHeat, [...env.excluded].sort(byString),
    env.multiblocks === undefined ? null : [...env.multiblocks].sort((a, b) => a - b),
  ]);
}

const RESULTS = new WeakMap<Pack, Map<string, RoughCosts>>();

/**
 * Rough costs at `env`: a buyable good (`leaf`) costs what the oracle says, whatever a recipe could make it for (the
 * line buys it and does not walk its producers); any other good the least, over the recipes
 * the group can run (`acceptRecipe`) whose not-consumed slots each have an option in `available`, of its consumed
 * inputs at their cheapest option divided by its yield. Without byproduct credit these are upper bounds of what the LP
 * pays. A good of `notInputs` (the line's target) is never an input: a derived material made from the target itself
 * (Magnetic Steel Ingot from Steel Ingot, Polyethylene Pulp from the bar) then has no finite cost, so the line cannot
 * buy it to make its own target. `cacheKey` names everything `leaf` depends on besides the env; results are cached per
 * pack, 8 entries.
 */
export function roughCosts(
  pack: Pack, env: PlanEnv, leaf: LeafOracle, available: ReadonlySet<StuffKey>, cacheKey: string, notInputs: readonly StuffKey[] = [],
): RoughCosts {
  let perPack = RESULTS.get(pack);
  if (perPack === undefined) {
    perPack = new Map();
    RESULTS.set(pack, perPack);
  }
  const key = `${envKey(env)}|${cacheKey}|${JSON.stringify([...notInputs].sort(byString))}`;
  const hit = perPack.get(key);
  if (hit !== undefined) {
    perPack.delete(key);
    perPack.set(key, hit);
    return hit;
  }
  const result = computeRough(pack, env, leaf, available, notInputs);
  perPack.set(key, result);
  if (perPack.size > CACHE_SIZE) perPack.delete(perPack.keys().next().value as string);
  return result;
}

function computeRough(pack: Pack, env: PlanEnv, leaf: LeafOracle, available: ReadonlySet<StuffKey>, notInputs: readonly StuffKey[]): RoughCosts {
  const s = structureOf(pack);
  const barred = new Uint8Array(s.goodOf.size);
  for (const key of notInputs) {
    const g = s.goodOf.get(key);
    if (g !== undefined) barred[g] = 1;
  }
  const recipes = pack.recipes.length;
  const goods = s.goodOf.size;
  const accepted = new Uint8Array(recipes);
  pack.recipes.forEach((r, i) => {
    const nc = s.notConsumed[i];
    if (nc !== undefined && !nc.every((slot) => slot.some((k) => available.has(k)))) return;
    if (acceptRecipe(pack, r, env).ok) accepted[i] = 1;
  });

  const cost = new Float64Array(goods).fill(Infinity);
  const improvements = new Uint8Array(goods);
  const via = new Int32Array(goods).fill(-1);
  const slotBest = new Float64Array(s.slotRecipe.length).fill(Infinity);
  const waiting = new Int32Array(recipes);
  for (let r = 0; r < recipes; r++) waiting[r] = (s.slotStart[r + 1] as number) - (s.slotStart[r] as number);
  const heap = new Heap();
  /** Bought goods keep their price: the line buys them and never walks their producers, so no recipe lowers it. */
  const bought = new Uint8Array(goods);
  for (const [k, g] of s.goodOf) {
    const d = leaf(k);
    if (d.buyable) {
      bought[g] = 1;
      cost[g] = Math.max(0, d.cost);
      heap.push(cost[g] as number, g);
    }
  }
  // Goods the pack knows that no recipe names (only `leaf` can make them cost something) need no entry.

  const offer = (r: number): void => {
    let total = 0;
    for (let slot = s.slotStart[r] as number; slot < (s.slotStart[r + 1] as number); slot++) total += slotBest[slot] as number;
    for (let o = s.outStart[r] as number; o < (s.outStart[r + 1] as number); o++) {
      const g = s.outGood[o] as number;
      if (bought[g] === 1) continue;
      const candidate = total / (s.outYield[o] as number);
      const now = cost[g] as number;
      const better = now === Infinity ? candidate < Infinity : candidate < now - now * IMPROVE_RATIO;
      if (better && (improvements[g] as number) < MAX_IMPROVEMENTS) {
        improvements[g] = (improvements[g] as number) + 1;
        cost[g] = candidate;
        via[g] = r;
        heap.push(candidate, g);
      }
    }
  };
  // A recipe that consumes nothing (but can run) yields its outputs at no cost.
  for (let r = 0; r < recipes; r++) if (accepted[r] === 1 && waiting[r] === 0) offer(r);

  while (heap.size > 0) {
    const [c, g] = heap.pop();
    if (c > (cost[g] as number) || barred[g] === 1) continue;   // a stale entry, or a good no recipe may consume
    for (let i = s.consumerStart[g] as number; i < (s.consumerStart[g + 1] as number); i++) {
      const o = s.consumerOpt[i] as number;
      const slot = s.optSlot[o] as number;
      const r = s.slotRecipe[slot] as number;
      if (accepted[r] !== 1) continue;
      const v = c * (s.optAmount[o] as number);
      const before = slotBest[slot] as number;
      if (!(v < before)) continue;
      slotBest[slot] = v;
      if (before === Infinity) waiting[r] = (waiting[r] as number) - 1;
      if (waiting[r] === 0) offer(r);
    }
  }

  /** The cost of a good the DP saw, a filled container as its fluid plus its empty container, else what `leaf` says. */
  const goodCost = (key: StuffKey): number => {
    const c = s.containers.get(key);
    if (c !== undefined) return c.amount * goodCost(c.fluid) + (c.empty === null ? 0 : goodCost(c.empty));
    const g = s.goodOf.get(key);
    if (g !== undefined) return cost[g] as number;
    const d = leaf(key);
    return d.buyable ? Math.max(0, d.cost) : Infinity;
  };
  /** As `goodCost`, for an input: a good of `notInputs` (or a container of it) is never one. */
  const inputCost = (key: StuffKey): number => {
    const c = s.containers.get(key);
    if (c !== undefined) return c.amount * inputCost(c.fluid) + (c.empty === null ? 0 : inputCost(c.empty));
    const g = s.goodOf.get(key);
    return g !== undefined && barred[g] === 1 ? Infinity : goodCost(key);
  };
  return {
    cost: goodCost,
    via(key) {
      const g = s.goodOf.get(key);
      const r = g === undefined ? -1 : (via[g] as number);
      return r >= 0 ? r : undefined;
    },
    recipeCost(index, key) {
      if (accepted[index] !== 1) return Infinity;
      const r = pack.recipes[index] as Recipe;
      let made = 0;
      for (const p of r.outputs) if (p.key === key && p.chance > 0) made += p.amount * p.chance;
      let total = 0;
      for (const ing of r.inputs) {
        if (!ing.consumed || ing.chance <= 0) continue;
        let best = Infinity;
        for (const o of ing.options) best = Math.min(best, inputCost(o.key) * o.amount * ing.chance);
        if (best === Infinity) return Infinity;
        total += best;
        // An empty container handed back, or a good returned, is not made by this recipe.
        const first = ing.options[0];
        if (first !== undefined && (first.key === key || s.containers.get(first.key)?.empty === key)) made -= first.amount * ing.chance;
      }
      return made > 1e-12 ? total / made : Infinity;
    },
  };
}
