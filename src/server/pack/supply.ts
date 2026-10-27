// Supply recipes (fix spec R2, architecture §11.26 and §11.31): the recipes a running line needs to make its free inputs
// (cobblestone, water, lava, air) instead of taking them from nowhere. The export has none it can plan with: GT's rock
// breaker recipes are display only (`flags.fake`, the machine runs its own code once water and lava are beside it) and
// list a display item as their input, a pump has no recipe map at all, and a singleblock gets air only as compressed-air
// cells. So the loader makes the rock breaker's display-item recipes real, gives the pumps a pseudo map with a water and
// a lava recipe, and flags the compressor recipe that fills an empty cell with air (the canner that empties the cell
// stays an ordinary recipe). `deriveSupply` is pure and deterministic; the loader (load.ts `addDerivedRecipes`) and the
// planner tests' `packFromSpec` put what it returns into the pack, before the indices are built.

import type { MachineId } from '../../shared/ids.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Machine, Pack, Recipe, RecipeMapInfo } from '../../shared/types/pack.ts';
import { FREE_KEYS } from '../../shared/types/plan.ts';
import { recipeId } from './recipe-id.ts';

/** The pseudo map of the pumps' water and lava recipes. */
export const SUPPLY_PUMP_MAP = 'pump';
/** What a supply recipe is (`Recipe.meta.supply`, which names the same kinds). */
export type SupplyKind = 'rock-breaker' | 'pump' | 'compressor';
/** Typed as `SupplyKind` and stored in `Recipe.meta.supply`, so the two lists cannot drift apart. */
const ROCK_BREAKER_KIND: SupplyKind = 'rock-breaker';
const PUMP_KIND: SupplyKind = 'pump';

/** GT's rock breaker map (2.9; its recipes are display only). */
const ROCK_BREAKER_MAP = 'gt.recipe.rockbreaker';
/**
 * GT's display item (gt.metaitem.02, meta 32765, any NBT): the rock breaker recipes name the setup with it ("IT'S FREE!
 * Place Lava on Side"); it is never a real input.
 */
const DISPLAY_ITEM = 'gregtech:gt.metaitem.02@32765';
/** The simple class name of GT's singleblock pump (architecture §11.19: compare the name after the last '.'). */
const PUMP_CLASS = 'MTEPump';
/**
 * One pump run (fix spec §3): 1,000 L in 80 ticks at 8 EU/t, an LV pump's bucket every 4 s (GT `MTEPump`: one block per
 * 160 / 2^tier ticks); the singleblock overclock then halves the time per tier above LV.
 */
const PUMP_LITRES = 1000;
const PUMP_TICKS = 80;
const PUMP_EU_PER_TICK = 8;
/** What a pump makes, in this order. */
const PUMPED: readonly StuffKey[] = ['fluid:water', 'fluid:lava'];
const FREE: ReadonlySet<StuffKey> = new Set(FREE_KEYS);

type FluidContainers = NonNullable<Pack['fluidContainers']>;

/** The pump map; the pack gets its own copy. */
function pumpMapInfo(): RecipeMapInfo {
  return { id: SUPPLY_PUMP_MAP, name: 'Pump', amps: 1, specialValue: 'none', aliases: [] };
}

function isDisplayItem(key: StuffKey): boolean {
  return key === DISPLAY_ITEM || key.startsWith(`${DISPLAY_ITEM}#`);
}

/** A slot that holds display items only (an empty slot holds none). */
function displayOnly(ing: Ingredient): boolean {
  return ing.options.length > 0 && ing.options.every((o) => isDisplayItem(o.key));
}

function copyOf(ing: Ingredient): Ingredient {
  return { ...ing, options: ing.options.map((o) => ({ ...o })) };
}

/**
 * The real recipe behind a display-only rock breaker recipe (fix spec R2.1), or null: a fake recipe of the rock breaker
 * map (one `maps` has, as `deriveFurnaceRecipes` derives only for maps the pack has) with one output made for sure,
 * whose consumed inputs are display items and nothing else, at least one of them. The display items go; every other
 * input, the output, EU/t, duration, amps and maps stay; source 'derived', no flags, `meta.supply` 'rock-breaker', and
 * the id of that content. A fake recipe that consumes redstone or glowstone (obsidian, netherrack), or one that consumes
 * nothing and only holds a block (basalt beside blue ice), shows what the machine does with what it is given, not a free
 * input, and stays fake.
 */
function realRockBreakerRecipe(r: Recipe, maps: ReadonlyMap<string, RecipeMapInfo>): Recipe | null {
  if (r.flags.fake !== true || !r.maps.includes(ROCK_BREAKER_MAP) || !maps.has(ROCK_BREAKER_MAP)) return null;
  if (r.outputs.length !== 1 || r.outputs[0]?.chance !== 1) return null;
  const consumed = r.inputs.filter((ing) => ing.consumed);
  if (consumed.length === 0 || !consumed.every(displayOnly)) return null;
  const content = {
    source: 'derived' as const,
    inputs: r.inputs.filter((ing) => !displayOnly(ing)).map(copyOf),
    outputs: r.outputs.map((p) => ({ ...p })),
    euPerTick: r.euPerTick, durationTicks: r.durationTicks, specialValue: r.specialValue,
    meta: { ...r.meta, supply: ROCK_BREAKER_KIND },
    ...(r.category === undefined ? {} : { category: r.category }),
  };
  return { id: recipeId(content), ...content, maps: [...r.maps], amps: r.amps, flags: {} };
}

/** A pump's recipe for `fluid` on the pseudo map (fix spec R2.2). */
function pumpRecipe(fluid: StuffKey): Recipe {
  const content = {
    source: 'derived' as const, inputs: [], outputs: [{ key: fluid, amount: PUMP_LITRES, chance: 1 }],
    euPerTick: PUMP_EU_PER_TICK, durationTicks: PUMP_TICKS, specialValue: 0, meta: { supply: PUMP_KIND },
  };
  return { id: recipeId(content), ...content, maps: [SUPPLY_PUMP_MAP], amps: 1, flags: {} };
}

function isPump(m: Machine): boolean {
  return m.cls.slice(m.cls.lastIndexOf('.') + 1) === PUMP_CLASS;
}

/**
 * Whether `r` fills an empty container with a free fluid and nothing else (fix spec R2.3): it is not fake, its only
 * consumed input is one empty container `E`, and its only output a container `C` that `fluidContainers` lists as `E`
 * filled with a free fluid (the compressor: Empty Cell → Compressed Air Cell).
 */
function fillsWithFreeFluid(r: Recipe, fluidContainers: FluidContainers): boolean {
  if (r.flags.fake === true || r.outputs.length !== 1) return false;
  const consumed = r.inputs.filter((ing) => ing.consumed);
  const only = consumed.length === 1 && consumed[0]?.options.length === 1 ? consumed[0].options[0]?.key : undefined;
  const container = r.outputs[0]?.key;
  return only !== undefined && fluidContainers.some((c) => c.container === container && c.empty === only && FREE.has(c.fluid));
}

/**
 * The supply recipes of a pack being loaded (fix spec R2), pure and deterministic:
 * - `recipes`: the rock breaker's display-only recipes made real (`realRockBreakerRecipe`), and when a pump exists one
 *   water and one lava recipe on `SUPPLY_PUMP_MAP`, each once (by id), with ids from `recipeId`;
 * - `pumpMap`: that pseudo map when some machine's class is `MTEPump` (2.9: Basic, Good and Advanced Pump), else null;
 * - `pumpMachines`: those machines' mteIds, ascending, which the caller gives the map;
 * - `flagged`: the ids of the recipes that fill an empty cell with a free fluid (`fillsWithFreeFluid`), in input order,
 *   which the caller marks `meta.supply = 'compressor'` without changing their ids (ruling P20), so the recipe pins
 *   projects already store keep finding them.
 * Nothing of the input is changed.
 */
export function deriveSupply(input: {
  recipes: readonly Recipe[]; machines: ReadonlyMap<MachineId, Machine>; maps: ReadonlyMap<string, RecipeMapInfo>;
  fluidContainers: FluidContainers;
}): { recipes: Recipe[]; pumpMap: RecipeMapInfo | null; pumpMachines: number[]; flagged: string[] } {
  const derived = new Map<string, Recipe>();
  const add = (r: Recipe): void => {
    if (!derived.has(r.id)) derived.set(r.id, r);
  };
  for (const r of input.recipes) {
    const real = realRockBreakerRecipe(r, input.maps);
    if (real !== null) add(real);
  }
  const pumpMachines = [...input.machines.values()].filter(isPump).map((m) => m.mteId).sort((a, b) => a - b);
  const pumpMap = pumpMachines.length > 0 ? pumpMapInfo() : null;
  if (pumpMap !== null) for (const fluid of PUMPED) add(pumpRecipe(fluid));
  const flagged = input.recipes.filter((r) => fillsWithFreeFluid(r, input.fluidContainers)).map((r) => r.id);
  return { recipes: [...derived.values()], pumpMap, pumpMachines, flagged };
}

/**
 * What a supply recipe gives the line (`PlanStep.supply`): its output, and for the compressor the free fluid of the
 * container it fills; undefined for any other recipe.
 */
export function suppliedKey(r: Recipe, fluidContainers: Pack['fluidContainers']): StuffKey | undefined {
  const supply: SupplyKind | undefined = r.meta.supply;
  const output = r.outputs[0]?.key;
  if (supply === undefined || output === undefined) return undefined;
  if (supply !== 'compressor') return output;
  const held = (fluidContainers ?? []).filter((c) => c.container === output);
  return (held.find((c) => FREE.has(c.fluid)) ?? held[0])?.fluid ?? output;
}
