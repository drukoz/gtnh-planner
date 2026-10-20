// GT++'s Electric Auto Workbench in a line (plan 12 Task 6; the controller's Auto Workbench rulings — items (5) of the
// ruling of 2026-10-19, 188 and 204 — and the user's ruling of 2026-10-20 on feeding; research
// docs/research/machine-feeding.md §1.3, §3.4, §3.6 and §6.1): the machine a crafting-table step runs on, set to its
// "Normal Crafting Table" mode with the recipe's grid, cell by cell in its shape, holding the planner's concrete items.
// In that mode it takes any item, from any face, into any of its nine input slots, with no check against the grid, so a
// network that keeps pushing one ingredient fills all nine and the bench stops, throws stacks out of its back or deletes
// them. Each mode therefore caps every ingredient at the bench: AE2 pushes one exact set behind a Locking Card,
// Project Red keeps a stock with an Item Stock Keeper Chip, EnderIO lets each ingredient in up to a count with a Limited
// Item Filter, and machine-to-machine lines lay no pipe to it. This module holds what the modes share: the grid, the
// pattern, the stock to keep and whether it fits the bench's safe slots, what a craft hands back, and the tools a craft
// wears out. The export gives no stack sizes, so every ingredient is taken to stack to 64.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { BenchSpec, PatternSpec } from '../../shared/types/feed.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { PlanStep, PlanWarning } from '../../shared/types/plan.ts';
import { stepProductName } from '../planner/bom.ts';
import { heldOption } from '../planner/candidates.ts';

/** The Auto Workbench's crafting grid: 3 × 3 cells, top row first. */
export const BENCH_GRID_WIDTH = 3;
const GRID_CELLS = BENCH_GRID_WIDTH * BENCH_GRID_WIDTH;
/** What one stack of an ingredient is taken to hold (the export gives no stack sizes). */
export const BENCH_STACK = 64;
/**
 * The input slots a bench's stock may fill (research §1.3.8): inserters fill the lowest empty slot first, so with slot 8
 * of its nine left empty, a craft that fails for a missing ingredient has nothing to throw out of its back.
 */
export const BENCH_SAFE_SLOTS = 8;
/** Crafts of stock an EnderIO Limited Item Filter keeps (research §3.6: it refills at once). */
const ENDERIO_STOCK_CRAFTS = 2;
/** Project Red's Item Stock Keeper Chip asks every 100 ticks at best (research §2.2, §3.6). */
const STOCK_KEEPER_SECONDS = 5;
/** Crafts of stock a Stock Keeper keeps at least (research §3.6). */
const ROUTED_MIN_CRAFTS = 2;

/** What a line needs of one bench. */
export interface BenchPlan {
  /** Its configuration: mode normal, the grid with the planner's concrete items, the top-left (throughput) button at 0. */
  spec: BenchSpec;
  /** Each item a craft uses up, in the order of its first cell, with how many one craft takes (its cells in the grid). */
  ingredients: Array<{ key: StuffKey; perCraft: number }>;
  /** What a craft makes: the step's item outputs, whole. */
  result: Array<{ key: StuffKey; amount: number }>;
  /** The empty containers a craft hands back (a filled container in the grid, the export's fluid-container table), one per cell. */
  returns: Array<{ key: StuffKey; amount: number }>;
  /** The items the grid holds that a craft keeps (a tool slot): a craft wears a GT tool out or uses a single-use one up. */
  tools: StuffKey[];
}

/** Each key once, in first-seen order, with its amounts summed. */
function counted(keys: readonly StuffKey[]): Array<{ key: StuffKey; amount: number }> {
  const sums = new Map<StuffKey, number>();
  for (const key of keys) sums.set(key, (sums.get(key) ?? 0) + 1);
  return [...sums].map(([key, amount]) => ({ key, amount }));
}

/**
 * The grid cell of recipe slot `slot` (the loader numbers a crafting recipe's slots by their place in its `w`-wide
 * grid, row by row), or of the `i`-th ingredient of a shapeless one; null past the 3 × 3 grid.
 */
function cellOf(shaped: boolean, width: number, slot: number, i: number): number | null {
  if (!shaped) return i < GRID_CELLS ? i : null;
  const row = Math.floor(slot / width), col = slot % width;
  return row < BENCH_GRID_WIDTH && col < BENCH_GRID_WIDTH ? row * BENCH_GRID_WIDTH + col : null;
}

/**
 * What a crafting-table step's bench needs (`BenchPlan`): its grid, from its recipe's slots in their shape (a shaped
 * recipe from the top-left cell, a shapeless one in slot order), each cell the option the step uses most of its slot
 * (`step.inputs`; the slot's first on a tie or where the step names none), a tool slot its held option; without the
 * recipe, the step's item inputs one cell each. What it hands back comes from the pack's fluid-container table.
 */
export function benchPlan(pack: Pack, step: PlanStep): BenchPlan {
  const used = new Map(step.inputs.filter((p) => !isFluidKey(p.key)).map((p) => [p.key, p.amount]));
  const recipe = pack.recipeById.get(step.recipeId);
  const grid: Array<StuffKey | null> = Array.from({ length: GRID_CELLS }, () => null);
  const consumed: StuffKey[] = [];
  const tools: StuffKey[] = [];
  if (recipe === undefined) {
    const keys = step.inputs.filter((p) => !isFluidKey(p.key)).flatMap((p) => Array.from({ length: Math.max(1, Math.round(p.amount)) }, () => p.key));
    keys.slice(0, GRID_CELLS).forEach((key, i) => {
      grid[i] = key;
      consumed.push(key);
    });
  } else {
    const shaped = recipe.flags.shaped === true;
    const width = typeof recipe.meta.width === 'number' ? recipe.meta.width : BENCH_GRID_WIDTH;
    [...recipe.inputs].sort((a, b) => a.slot - b.slot).forEach((ing, i) => {
      const cell = cellOf(shaped, width, ing.slot, i);
      if (cell === null) return;
      const options = ing.options.filter((o) => !isFluidKey(o.key));
      const key = ing.consumed
        ? options.reduce<(typeof options)[number] | undefined>((best, o) => (best === undefined || (used.get(o.key) ?? 0) > (used.get(best.key) ?? 0) ? o : best), undefined)?.key
        : heldOption(options)?.key;
      if (key === undefined) return;
      grid[cell] = key;
      (ing.consumed ? consumed : tools).push(key);
    });
  }
  const empties = new Map((pack.fluidContainers ?? []).flatMap((c) => (c.empty === null ? [] : [[c.container, c.empty] as const])));
  const result = new Map<StuffKey, number>();
  for (const p of step.outputs) if (!isFluidKey(p.key) && p.chance >= 1) result.set(p.key, (result.get(p.key) ?? 0) + p.amount);
  return {
    spec: { mode: 'normal', grid, throughput: 0 },
    ingredients: counted(consumed).map(({ key, amount }) => ({ key, perCraft: amount })),
    result: [...result].map(([key, amount]) => ({ key, amount })),
    returns: counted(consumed.flatMap((key) => (empties.has(key) ? [empties.get(key)!] : []))),
    tools: [...new Set(tools)],
  };
}

/**
 * The AE2 processing pattern of a bench (research §3.4): exactly the grid's items, a tool's cell too, → what a craft makes
 * and hands back, so the crafting CPU pushes one whole set that matches the grid.
 */
export function benchPattern(bench: BenchPlan): PatternSpec {
  return {
    inputs: counted(bench.spec.grid.flatMap((key) => (key === null ? [] : [key]))),
    outputs: [...bench.result.map((r) => ({ ...r })), ...bench.returns.map((r) => ({ ...r }))],
  };
}

/** The stock a bench keeps of each ingredient, with how many input slots it fills and whether it fits them safely. */
export interface BenchStock { stock: Array<{ key: StuffKey; count: number }>; slots: number; safe: boolean }

function stocked(stock: Array<{ key: StuffKey; count: number }>): BenchStock {
  const slots = stock.reduce((sum, s) => sum + Math.ceil(s.count / BENCH_STACK), 0);
  return { stock, slots, safe: slots <= BENCH_SAFE_SLOTS && stock.every((s) => s.count <= BENCH_STACK) };
}

/**
 * The stock an EnderIO bench keeps (research §3.6): two crafts of each ingredient, its Limited Item Filter counting each
 * one's grid cells too (`limit`). Safe when it fits the bench's safe slots, one stack each (research §1.3.8).
 */
export function enderioStock(bench: BenchPlan): BenchStock & { limits: number[] } {
  const stock = bench.ingredients.map((i) => ({ key: i.key, count: ENDERIO_STOCK_CRAFTS * i.perCraft }));
  return { ...stocked(stock), limits: bench.ingredients.map((i) => ENDERIO_STOCK_CRAFTS * i.perCraft + i.perCraft) };
}

/**
 * The stock a Project Red bench keeps (research §3.6): enough for its crafts over the Stock Keeper's 5 s cadence, and at
 * least two crafts' worth, of each ingredient (`craftsPerSecond` one bench's; the travel time from its suppliers is not
 * known here and is left out). Safe as `enderioStock`.
 */
export function routedStock(bench: BenchPlan, craftsPerSecond: number): BenchStock {
  const crafts = Math.max(ROUTED_MIN_CRAFTS, Math.ceil(craftsPerSecond * STOCK_KEEPER_SECONDS - 1e-9));
  return stocked(bench.ingredients.map((i) => ({ key: i.key, count: crafts * i.perCraft })));
}

/**
 * `bench_cap`: a bench whose stock, on a line that keeps one (Project Red, EnderIO), takes more input slots than it fills
 * safely (research §1.3.8): when one ingredient runs short, the failed craft throws the stack in its last input slot out
 * of its back, which the line's part there refuses, and the bench stops. AE2 pushes one whole set at a time instead.
 */
export function benchCapWarning(pack: Pack, unit: { name: string }, step: PlanStep, slots: number): PlanWarning {
  const product = stepProductName(pack, step);
  return { code: 'bench_cap', stepId: step.id, text: `${unit.name} crafting ${product} cannot keep its ingredients within the ${BENCH_SAFE_SLOTS} `
    + `input slots it fills safely on this line (it would take ${slots}): when one runs short it throws a stack out of its back and stops — craft `
    + `${product} by hand, or plan the line on AE2` };
}
