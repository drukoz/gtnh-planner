// The pack a line with farms is planned on (add-on 17, architecture §11.45 (2) and the second pre-flight's ruling S5):
// the export pack plus the line's synthetic farm recipes (farms/recipes.ts) and the pseudo map their crop farms run on.
// It serves the line's own walks, the build model's machine options and plan assembly only; machine prices, the cost
// model, build-list breakdowns, swap lists and option prices read the export pack it was made from (`exportPack`).

import type { StuffKey } from '../../../shared/keys.ts';
import type { Machine, Pack, Recipe, RecipeMapInfo } from '../../../shared/types/pack.ts';
import { machineByMteId } from '../../pack/lookup.ts';
import { CROP_MANAGER_MTE_IDS } from './crops.ts';

/** The pseudo map crop farms run on (`Recipe.maps` of a crop recipe), whose machines are the pack's Crop Managers. */
export const CROP_MANAGER_MAP = 'farm:crops';
/** Farm packs kept per export pack (`withFarms`), the least recently used dropped first: as many as line pricings (pricing.ts). */
const FARM_PACK_MEMO_SIZE = 8;

const MEMOS = new WeakMap<Pack, Map<string, Pack>>();
const EXPORT_PACKS = new WeakMap<Pack, Pack>();

/** The export pack a farm pack was made from (`withFarms`); any other pack is its own. */
export function exportPack(pack: Pack): Pack {
  return EXPORT_PACKS.get(pack) ?? pack;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A copy of `index` with recipe `i` added to the list of each of `keys` (a list once per key), the other lists shared. */
function withIndex(index: ReadonlyMap<StuffKey, number[]>, added: ReadonlyArray<{ i: number; keys: readonly StuffKey[] }>): Map<StuffKey, number[]> {
  const out = new Map(index);
  const copied = new Set<StuffKey>();
  for (const { i, keys } of added) {
    for (const key of new Set(keys)) {
      const list = out.get(key);
      if (list === undefined) {
        out.set(key, [i]);
        copied.add(key);
      } else if (copied.has(key)) {
        list.push(i);
      } else {
        out.set(key, [...list, i]);
        copied.add(key);
      }
    }
  }
  return out;
}

/** `pack` with `recipes` (the line's synthetic farm recipes) and the Crop Managers as the machines of `CROP_MANAGER_MAP`. */
function farmPackOf(pack: Pack, recipes: readonly Recipe[]): Pack {
  const all = [...pack.recipes, ...recipes];
  const recipeById = new Map(pack.recipeById);
  for (const r of recipes) recipeById.set(r.id, r);
  const added = recipes.map((r, k) => ({ i: pack.recipes.length + k, r }));
  const producers = withIndex(pack.producers, added.map(({ i, r }) => ({ i, keys: r.outputs.map((p) => p.key) })));
  const consumers = withIndex(pack.consumers, added.map(({ i, r }) => ({ i, keys: r.inputs.flatMap((ing) => ing.options.map((o) => o.key)) })));
  const maps = new Map(pack.maps);
  const map: RecipeMapInfo = { id: CROP_MANAGER_MAP, name: 'Crop Manager', amps: 1, specialValue: 'none', aliases: [] };
  maps.set(CROP_MANAGER_MAP, map);
  const machines = new Map(pack.machines);
  const managers: Machine[] = [];
  for (const id of CROP_MANAGER_MTE_IDS) {
    const m = machineByMteId(pack, id);
    if (m === undefined) continue;
    const manager: Machine = { ...m, kind: 'basic', maps: [CROP_MANAGER_MAP] };
    machines.set(id, manager);
    managers.push(manager);
  }
  const machinesByMap = new Map(pack.machinesByMap);
  // in the order of every other map's machines (pack/indices.ts `buildMachinesByMap`): tier, then mteId
  machinesByMap.set(CROP_MANAGER_MAP, managers.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.mteId - b.mteId).map((m) => m.mteId));
  return { ...pack, recipes: all, recipeById, producers, consumers, maps, machines, machinesByMap };
}

/**
 * The pack a line with farms is planned on: a new Pack sharing everything with the export pack but `recipes` (the
 * export's, then `recipes`), `recipeById`, `producers` and `consumers` (with `recipes` indexed after the export's),
 * `maps` (plus `CROP_MANAGER_MAP`, "Crop Manager", amps 1), `machinesByMap` (plus `CROP_MANAGER_MAP` → the pack's Crop
 * Managers) and `machines` (the Crop Managers as `kind: 'basic'` with `maps: [CROP_MANAGER_MAP]`); each recipe once, by
 * id. Built from the export pack a farm pack was made from, never from a farm pack, and recorded with it (`exportPack`). Memoized per export pack and
 * sorted recipe ids, at most FARM_PACK_MEMO_SIZE per pack, the least recently used dropped first: the same farms give the
 * same object, which the per-pack memos of the planner (machine options, availability of maps, Auto Workbenches) need.
 */
export function withFarms(pack: Pack, recipes: readonly Recipe[]): Pack {
  const base = exportPack(pack);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const key = [...byId.keys()].sort(byString).join('\n');
  let memo = MEMOS.get(base);
  if (memo === undefined) MEMOS.set(base, (memo = new Map()));
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const farms = farmPackOf(base, [...byId.values()].sort((a, b) => byString(a.id, b.id)));
  EXPORT_PACKS.set(farms, base);
  memo.set(key, farms);
  if (memo.size > FARM_PACK_MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  return farms;
}
