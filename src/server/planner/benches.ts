// Which crafting-table recipes GT++'s Electric Auto Workbench runs on a line (plan 12; controller rulings 188 and 214,
// user ruling 180 (d); research docs/research/machine-feeding.md §1.3, §6.1 items 2 and 7). A craft wears a GT tool in
// the bench's grid out of the grid's match, so the bench stops after one craft: a recipe with a tool slot never runs on
// one (its GGFab single-use variant does, the loader's `Recipe.meta.benchVariantOf`, pack/bench-tools.ts). And where the
// line's logistics keep a stock at the bench (Project Red's Item Stock Keeper Chip, EnderIO's Limited Item Filter), that
// stock must fit the eight input slots a bench fills safely (shared/gt/feeding.ts): a recipe whose least stock does not
// (one craft needs all nine slots) runs on no bench there — AE2 pushes one whole set at a time behind a Locking Card, and
// machine to machine fills a bench by hand. Such a recipe is crafted by hand, with this module's reason on its step. A
// leaf module: candidates.ts and machine-options.ts both read it.

import { BENCH_LEAST_CRAFTS, BENCH_SAFE_SLOTS, benchSlots } from '../../shared/gt/feeding.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Machine, Pack, Recipe } from '../../shared/types/pack.ts';
import type { PlanSettings } from '../../shared/types/plan.ts';
import { SINGLE_USE_TOOL_ID } from '../pack/bench-tools.ts';
import { GT_TOOL_ITEM_IDS } from '../pack/recipes.ts';

/** GT++'s Electric Auto Workbench, by its simple class name (architecture §11.19): mteIds 31091–31098, LV–UV, on 2.9. */
const AUTO_WORKBENCH_CLASS = 'MTEElectricAutoWorkbench';

function tierOf(m: Machine): number {
  return m.tier ?? 0;
}

/**
 * Whether `m` is GT++'s Electric Auto Workbench (`AUTO_WORKBENCH_CLASS`): the machine crafting-table steps run on
 * (machine-options.ts rule 1), which Plan 5's layout lays with its own feeding (an Auto Workbench takes any item into any
 * input slot).
 */
export function isAutoWorkbench(m: Machine | undefined): boolean {
  return m !== undefined && m.cls.slice(m.cls.lastIndexOf('.') + 1) === AUTO_WORKBENCH_CLASS;
}

const AUTO_WORKBENCHES = new WeakMap<Pack, readonly Machine[]>();

/** The pack's Electric Auto Workbenches (`isAutoWorkbench`), by tier then mteId; once per pack. */
export function autoWorkbenches(pack: Pack): readonly Machine[] {
  let list = AUTO_WORKBENCHES.get(pack);
  if (list === undefined) {
    list = [...pack.machines.values()].filter(isAutoWorkbench).sort((a, b) => tierOf(a) - tierOf(b) || a.mteId - b.mteId);
    AUTO_WORKBENCHES.set(pack, list);
  }
  return list;
}

/**
 * The Auto Workbenches of a line (`benchLine`): `capBy` names the logistics that keep a stock at a bench (`benchCapBy`),
 * so a recipe whose least stock cannot fit its safe slots has no bench there.
 */
export interface BenchLine { capBy?: string }

/**
 * The logistics that keep a stock at an Auto Workbench in its input slots (research §3.4, §6.1 item 7): Project Red's
 * Item Stock Keeper Chip and EnderIO's Limited Item Filter; undefined for AE2 (one whole set at a time behind a Locking
 * Card) and machine to machine (filled by hand).
 */
export function benchCapBy(logistics: PlanSettings['logistics']): string | undefined {
  return logistics === 'routed' ? 'Project Red' : logistics === 'enderio' ? 'EnderIO' : undefined;
}

/**
 * The Auto Workbenches a line runs its crafting-table recipes on: with crafting automated, when the pack has one at or
 * below `tier` (else undefined: by hand, or a pack without one, where a crafting step stays a pseudo step).
 */
export function benchLine(pack: Pack, settings: Pick<PlanSettings, 'automateCrafting' | 'logistics'>, tier: number): BenchLine | undefined {
  if (settings.automateCrafting !== true || !autoWorkbenches(pack).some((m) => tierOf(m) <= tier)) return undefined;
  const capBy = benchCapBy(settings.logistics);
  return capBy === undefined ? {} : { capBy };
}

/** Whether `r` is the GGFab single-use variant of a tool recipe (`Recipe.meta.benchVariantOf`), which only a bench runs. */
export function isBenchVariant(r: Recipe): boolean {
  return typeof r.meta.benchVariantOf === 'string';
}

/** "a"/"an" before a tool's name. */
function article(name: string): string {
  return /^[aeiou]/i.test(name) ? 'an' : 'a';
}

/** A tool slot's tool by name: a GT tool item of its options first, then any but a single-use tool, then its first. */
function toolName(pack: Pack, options: Recipe['inputs'][number]['options']): string | undefined {
  const keys = options.map((o) => o.key).filter((key) => !isFluidKey(key));
  const idOf = (key: StuffKey): string => parseItemKey(key).id;
  const key = keys.find((k) => GT_TOOL_ITEM_IDS.includes(idOf(k))) ?? keys.find((k) => idOf(k) !== SINGLE_USE_TOOL_ID) ?? keys[0];
  return key === undefined ? undefined : pack.nameOf(key);
}

/** `a`, `a and b`, `a, b and c`. */
function joined(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The input slots a bench's least stock of `r` fills (research §3.6, §1.3.8): BENCH_LEAST_CRAFTS crafts of each
 * ingredient (its consumed item slots, those with the same options one ingredient, one per cell a craft), one stack of 64
 * per slot; and whether that fits the safe slots.
 */
export function leastBenchStock(r: Recipe): { slots: number; safe: boolean } {
  const cells = new Map<string, number>();
  for (const ing of r.inputs) {
    if (!ing.consumed || ing.options.length === 0 || ing.options.some((o) => isFluidKey(o.key))) continue;
    const id = ing.options.map((o) => o.key).sort().join('|');
    cells.set(id, (cells.get(id) ?? 0) + 1);
  }
  return benchSlots([...cells.values()].map((n) => BENCH_LEAST_CRAFTS * n));
}

/**
 * Why no Auto Workbench of `line` runs the crafting-table recipe `r`, in plain words (the reason a step crafted by hand
 * gives, user ruling 180 (d)); undefined when one does. A recipe with a tool slot (one it does not consume): "needs a
 * <tool>, which an Auto Workbench cannot keep using" — a craft wears the tool out of the grid's match (its GGFab
 * single-use variant, when every tool slot takes one, is a recipe of its own that a bench runs). On a line that keeps a
 * stock at the bench (`BenchLine.capBy`), a recipe whose least stock (`leastBenchStock`) does not fit the bench's safe
 * input slots: "needs <n> input slots of an Auto Workbench for its stock, more than the 8 a Project Red line fills
 * safely".
 */
export function benchRefusal(pack: Pack, r: Recipe, line: BenchLine): string | undefined {
  const tools = [...new Set(r.inputs.filter((ing) => !ing.consumed).flatMap((ing) => toolName(pack, ing.options) ?? []))];
  if (tools.length > 0) {
    return `needs ${joined(tools.map((name) => `${article(name)} ${name}`))}, which an Auto Workbench cannot keep using`;
  }
  if (line.capBy === undefined) return undefined;
  const stock = leastBenchStock(r);
  return stock.safe ? undefined
    : `needs ${stock.slots} input slots of an Auto Workbench for its stock, more than the ${BENCH_SAFE_SLOTS} ${article(line.capBy)} ${line.capBy} line fills safely`;
}
