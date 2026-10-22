// GTNH's circuit stand-ins (NewHorizonsCoreMod's "Any <tier> Circuit" items, `dreamcraft:Circuit<tier>`): what GT recipes
// list where they take any circuit of a tier. GT matches a machine's inputs to a recipe's by their ore-dictionary
// unification, so such a slot takes every item of the stand-in's ore name (circuitBasic for LV, circuitGood for MV …);
// nothing makes the stand-in itself (its only recipes on the 2.9 export take reactor sensor location cards nothing
// makes, or the stand-in itself). The loader reads GT and assembly-line slots so (recipes.ts), and the planner tests'
// `packFromSpec` does the same; crafting recipes name their ore names themselves.

import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import type { ItemKey } from '../../shared/keys.ts';
import type { Ingredient, Item } from '../../shared/types/pack.ts';

/** The registry names of the stand-ins: `dreamcraft:Circuit` and a tier name (ULV … MAX), as NewHorizonsCoreMod names them. */
export const CIRCUIT_STAND_IN_IDS: ReadonlySet<string> = new Set(TIER_NAMES.map((tier) => `dreamcraft:Circuit${tier}`));

/**
 * Per stand-in (an item of `CIRCUIT_STAND_IN_IDS` without NBT): the other items of its ore names, in ore-dictionary order,
 * without repeats. A stand-in whose ore names list nothing else is left out (it stands for nothing).
 */
export function circuitStandIns(items: Iterable<Item>, oreDict: ReadonlyMap<string, readonly ItemKey[]>): Map<ItemKey, ItemKey[]> {
  const standIns = new Map<ItemKey, ItemKey[]>();
  for (const item of items) {
    if (item.nbt !== undefined || !CIRCUIT_STAND_IN_IDS.has(item.id)) continue;
    const members = [...new Set(item.oreDict.flatMap((ore) => oreDict.get(ore) ?? []))].filter((key) => key !== item.key);
    if (members.length > 0) standIns.set(item.key, members);
  }
  return standIns;
}

type Option = Ingredient['options'][number];

/** `options` with the items each stand-in among them stands for (`circuitStandIns`) after it, at its amount, without repeats. */
export function withStandIns(options: readonly Option[], standIns: ReadonlyMap<ItemKey, readonly ItemKey[]>): Option[] {
  if (standIns.size === 0 || !options.some((o) => standIns.has(o.key))) return [...options];
  const out: Option[] = [];
  const seen = new Set<string>();
  const push = (o: Option): void => {
    const id = `${o.amount} ${o.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(o);
  };
  for (const o of options) {
    push(o);
    for (const key of standIns.get(o.key) ?? []) push({ key, amount: o.amount });
  }
  return out;
}
