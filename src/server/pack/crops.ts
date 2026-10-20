// The crop table (`crops.jsonl.gz`, exporter 0.5.0; self-contained from 0.5.1): CropsNH crop cards for the planner's
// crop farms (farms.md §2.2–§2.4, §2.7). An item index becomes a key by the rule recipe outputs use (`firstKeyAt`: a
// wildcard soil is its first variant). An item the item table lacks comes inline (format.ts `CropInlineItem`) and
// becomes a crop item (`Item.cropOnly`): `buildPack` adds it to `pack.items` after the item table, never to `ItemRefs`,
// so it joins no wildcard's options and no ore name, and every recipe and item of the table stays as it is without the
// crop table. The table is optional, so an item a line names but the loader cannot resolve is left out with a load
// warning, never a failed load.

import { itemKey, parseItemKey, type ItemKey } from '../../shared/keys.ts';
import type { CropCard, Item } from '../../shared/types/pack.ts';
import { EXPORT_FILES, type CropItemRef, type CropLine } from './format.ts';
import type { LoadContext } from './load.ts';
import { nbtHash } from './recipe-id.ts';
import { firstKeyAt } from './recipes.ts';

/** CropsNH's drop chance scale, GT's: 10000 = 100 %. */
const CHANCE_SCALE = 10000;

/** The cards of a crop table and the crop items its lines name inline. */
export interface CropTable {
  /** In the lines' order (CropsNH's registration order). */
  cards: CropCard[];
  /** Each inline key once, the first line that names it wins, in the order the lines name them. */
  items: Item[];
}

/** The cards of the crop table's lines and the items they name inline (see the header). */
export function cropTable(lines: readonly CropLine[], ctx: LoadContext): CropTable {
  const items = new Map<ItemKey, Item>();
  const cards = lines.map((line) => cropCard(line, ctx, items));
  return { cards, items: [...items.values()] };
}

/** The crop item an inline item names, or null when it is not `{ key: id@meta, name, nbt? }`. */
function inlineItem(ref: unknown): Item | null {
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) return null;
  const { key, name, nbt } = ref as Record<string, unknown>;
  if (typeof key !== 'string' || typeof name !== 'string' || name === '') return null;
  if (nbt !== undefined && (typeof nbt !== 'string' || nbt === '')) return null;
  let parsed: ReturnType<typeof parseItemKey>;
  try {
    parsed = parseItemKey(key);
  } catch {
    return null;
  }
  if (parsed.nbtHash !== undefined) return null;   // the NBT comes as `nbt`, which the loader hashes itself
  const item: Item = { key: itemKey(parsed.id, parsed.meta, nbt === undefined ? undefined : nbtHash(nbt)), id: parsed.id, meta: parsed.meta, name, oreDict: [], cropOnly: true };
  if (nbt !== undefined) item.nbt = nbt;
  return item;
}

function cropCard(line: CropLine, ctx: LoadContext, items: Map<ItemKey, Item>): CropCard {
  const warn = (what: string, without: string) => ctx.warn(`${EXPORT_FILES.crops}: crop ${line.id}: ${what}, ${without}`);
  /** The key of the item `ref` names, or null with a warning that says what the crop does without it. */
  const keyOf = (ref: CropItemRef, what: 'drop' | 'soil' | 'seed', without: string): ItemKey | null => {
    if (typeof ref === 'number') {
      if (ctx.items.has(ref)) return firstKeyAt(ctx.items, ref);
      warn(`${what} item index ${ref} is not in the export`, without);
      return null;
    }
    const item = inlineItem(ref);
    if (item === null) {
      warn(`${what} item ${JSON.stringify(ref)} needs a key id@meta and a name`, without);
      return null;
    }
    if (!items.has(item.key)) items.set(item.key, item);
    return item.key;
  };
  const drops = line.drops.flatMap(({ item, count, chance }) => {
    const key = keyOf(item, 'drop', 'the drop is left out');
    return key === null ? [] : [{ key, chance: chance / CHANCE_SCALE, stackSize: count }];
  });
  const soils = new Set<ItemKey>();
  for (const ref of line.soils) {
    const key = keyOf(ref, 'soil', 'the soil is left out');
    if (key !== null) soils.add(key);
  }
  return {
    id: line.id, name: line.name, tier: line.tier, growthDuration: line.duration, dropChance: line.dropChance, drops,
    likedBiomes: [...line.liked], soils: [...soils], requirements: [...line.requirements],
    seed: line.seed === null ? null : keyOf(line.seed, 'seed', 'the crop has no seed'), minSeedBedTier: line.minSeedBedTier,
  };
}
