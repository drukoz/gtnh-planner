// Derived recipes and pack indices (architecture §6.2, §11.4): the electric furnace and microwave recipes GT builds
// from the smelting list at lookup time, the producer and consumer indices over `pack.recipes`, and the machines of
// every recipe map.

import type { StuffKey } from '../../shared/keys.ts';
import type { Machine, Recipe, RecipeMapInfo } from '../../shared/types/pack.ts';
import { recipeId } from './recipe-id.ts';
import type { FurnaceEntry } from './recipes.ts';

/**
 * The GT maps whose recipes GT builds from the smelting list at lookup time, with the EU/t and ticks it gives them and
 * the furnace entry's output they use: the values `FurnaceBackend` (`sipush 128`, `iconst_4`) and `MicrowaveBackend`
 * (`bipush 32`, `iconst_4`) build (checked with `javap -c` on the pack's `gregtech-5.09.54.183.jar`).
 */
export const DERIVED_FROM_FURNACE: Readonly<Record<string, { euPerTick: number; durationTicks: number; from: 'ef' | 'mw' }>> = Object.freeze({
  'gt.recipe.furnace': { euPerTick: 4, durationTicks: 128, from: 'ef' },
  'gt.recipe.microwave': { euPerTick: 4, durationTicks: 32, from: 'mw' },
});

/**
 * For every map of `DERIVED_FROM_FURNACE` that `maps` has with `dynamic === 'overwrite'`, one recipe per furnace entry
 * with that map's output: one of the entry's input (any of its options) into that output, at 1 A.
 */
export function deriveFurnaceRecipes(entries: readonly FurnaceEntry[], maps: ReadonlyMap<string, RecipeMapInfo>): Recipe[] {
  const recipes: Recipe[] = [];
  for (const [mapId, { euPerTick, durationTicks, from }] of Object.entries(DERIVED_FROM_FURNACE)) {
    if (maps.get(mapId)?.dynamic !== 'overwrite') continue;
    for (const entry of entries) {
      const output = entry[from];
      if (output === undefined) continue;
      const content = {
        source: 'derived' as const,
        inputs: [{ slot: 0, consumed: true, chance: 1, options: entry.input.map((key) => ({ key, amount: 1 })) }],
        outputs: [{ ...output }],
        euPerTick, durationTicks, specialValue: 0, meta: {},
      };
      recipes.push({ id: recipeId(content), ...content, maps: [mapId], amps: 1, flags: { dynamicMap: 'overwrite' } });
    }
  }
  return recipes;
}

/** Adds `i` to the list of `key` unless it is already its last entry (callers go through the recipes in order). */
function addIndex(index: Map<StuffKey, number[]>, key: StuffKey, i: number): void {
  const list = index.get(key);
  if (list === undefined) index.set(key, [i]);
  else if (list[list.length - 1] !== i) list.push(i);
}

/**
 * Recipe indices by output key (`producers`) and by the key of every input option, not-consumed inputs included
 * (`consumers`); each recipe appears at most once per key, in ascending order. Fake, hidden and recycling recipes are
 * indexed too: callers filter by `flags`.
 */
export function buildIndices(recipes: readonly Recipe[]): { producers: Map<StuffKey, number[]>; consumers: Map<StuffKey, number[]> } {
  const producers = new Map<StuffKey, number[]>();
  const consumers = new Map<StuffKey, number[]>();
  recipes.forEach((recipe, i) => {
    for (const output of recipe.outputs) addIndex(producers, output.key, i);
    for (const input of recipe.inputs) for (const option of input.options) addIndex(consumers, option.key, i);
  });
  return { producers, consumers };
}

/** The machines of every map they list, sorted by tier (none = 0), then MTE id. */
export function buildMachinesByMap(machines: ReadonlyMap<number, Machine>): Map<string, number[]> {
  const byMap = new Map<string, Machine[]>();
  for (const machine of machines.values()) {
    for (const map of machine.maps) {
      const list = byMap.get(map);
      if (list === undefined) byMap.set(map, [machine]);
      else list.push(machine);
    }
  }
  const result = new Map<string, number[]>();
  for (const [map, list] of byMap) {
    result.set(map, list.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.mteId - b.mteId).map((m) => m.mteId));
  }
  return result;
}
