// GGFab's single-use tools on GT++'s Auto Workbench (controller rulings 188 and 214 (a); research
// docs/research/machine-feeding.md §1.3.4, §6.1 item 2). A craft wears a GT tool in the bench's grid (its wear is in its
// NBT, so it no longer matches the grid) and the bench stops after one craft, while GGFab's eight single-use tools
// (`ggfab:gt.ggfab.d1`: File, Wrench, Crowbar, Wire Cutter, Hard Hammer, Screwdriver, Saw and Soft Mallet, each
// ore-dictionaried `craftingTool<Name>`) have no container item and stack to 64, so a craft uses one up like any
// ingredient. So each crafting-table recipe whose tool slots all take one of them gets a variant of its own: the same
// outputs on map `crafting`, each tool slot a consumed input of its single-use tool, one a craft, with
// `Recipe.meta.benchVariantOf` naming the recipe it varies. Only an Auto Workbench runs a variant (planner/benches.ts);
// the original keeps its tool held, for crafting by hand. `benchVariants` is pure and deterministic; the loader (load.ts
// `addDerivedRecipes`) and the planner tests' `packFromSpec` add what it returns, before the indices are built.

import { parseItemKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Ingredient, Item, Recipe } from '../../shared/types/pack.ts';
import { recipeId } from './recipe-id.ts';
import { TOOL_ORE_PREFIX } from './recipes.ts';

/** GGFab's single-use items: its tools (metas 0–7) and the Fluid Solidifier molds that make them (30–37) share this id. */
export const SINGLE_USE_TOOL_ID = 'ggfab:gt.ggfab.d1';

/** Whether `key` is one of GGFab's single-use tools: of `SINGLE_USE_TOOL_ID` with a `craftingTool…` ore name (a mold has none). */
export function isSingleUseTool(items: ReadonlyMap<ItemKey, Item>, key: StuffKey): boolean {
  if (key.startsWith('fluid:') || parseItemKey(key).id !== SINGLE_USE_TOOL_ID) return false;
  return items.get(key)?.oreDict.some((ore) => ore.startsWith(TOOL_ORE_PREFIX)) === true;
}

/** The single-use tool a tool slot takes (the first of its options that is one), or undefined when it takes none. */
export function singleUseOption(items: ReadonlyMap<ItemKey, Item>, ing: Ingredient): StuffKey | undefined {
  return ing.options.find((o) => isSingleUseTool(items, o.key))?.key;
}

/**
 * The single-use variants of `recipes`' crafting-table recipes, in recipe order: one per recipe (map `crafting`) with at
 * least one tool slot (a slot it does not consume) whose tool slots all take a single-use tool (`singleUseOption`). Its
 * slots are the recipe's, each tool slot consumed (chance 1) with that tool alone, one a craft; outputs, flags and meta as
 * the recipe's plus `meta.benchVariantOf` (the recipe's id), so its content id is its own.
 */
export function benchVariants(recipes: readonly Recipe[], items: ReadonlyMap<ItemKey, Item>): Recipe[] {
  const variants: Recipe[] = [];
  for (const r of recipes) {
    if (r.source !== 'crafting' || !r.maps.includes('crafting') || r.meta.benchVariantOf !== undefined) continue;
    const tools = r.inputs.filter((ing) => !ing.consumed);
    if (tools.length === 0) continue;
    const single = new Map(tools.map((ing) => [ing, singleUseOption(items, ing)]));
    if ([...single.values()].some((key) => key === undefined)) continue;
    const inputs: Ingredient[] = r.inputs.map((ing) => {
      const tool = single.get(ing);
      return tool === undefined
        ? { ...ing, options: ing.options.map((o) => ({ ...o })) }
        : { slot: ing.slot, consumed: true, chance: 1, options: [{ key: tool, amount: 1 }] };
    });
    const outputs = r.outputs.map((p) => ({ ...p }));
    const meta: Recipe['meta'] = { ...r.meta, benchVariantOf: r.id };
    const flags: Recipe['flags'] = { ...r.flags };
    const { source, euPerTick, durationTicks, specialValue, category } = r;
    const variant: Recipe = {
      id: recipeId({ source, inputs, outputs, euPerTick, durationTicks, specialValue, meta, category, fake: flags.fake }),
      source, maps: ['crafting'], inputs, outputs, euPerTick, durationTicks, amps: r.amps, specialValue, meta, flags,
    };
    if (r.category !== undefined) variant.category = r.category;
    variants.push(variant);
  }
  return variants;
}
