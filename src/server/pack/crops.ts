// The crop table (exporter 0.5.0, `crops.jsonl.gz`): CropsNH crop cards for the planner's crop farms (farms.md
// §2.2–§2.4, §2.7). Item indices become keys by the rule recipe outputs use (`firstKeyAt`: a wildcard soil is its first
// variant). The table is optional, so an index the export does not have is left out with a load warning, never a
// failed load.

import type { ItemKey } from '../../shared/keys.ts';
import type { CropCard } from '../../shared/types/pack.ts';
import { EXPORT_FILES, type CropLine } from './format.ts';
import type { LoadContext } from './load.ts';
import { firstKeyAt } from './recipes.ts';

/** CropsNH's drop chance scale, GT's: 10000 = 100 %. */
const CHANCE_SCALE = 10000;

/** The cards of the crop table's lines, in their order (CropsNH's registration order). */
export function cropCards(lines: readonly CropLine[], ctx: LoadContext): CropCard[] {
  return lines.map((line) => cropCard(line, ctx));
}

function cropCard(line: CropLine, ctx: LoadContext): CropCard {
  /** The key of item `i`, or null with a warning that says what the crop does without it. */
  const keyAt = (i: number, what: 'drop' | 'soil' | 'seed', without: string): ItemKey | null => {
    if (ctx.items.has(i)) return firstKeyAt(ctx.items, i);
    ctx.warn(`${EXPORT_FILES.crops}: crop ${line.id}: ${what} item index ${i} is not in the export, ${without}`);
    return null;
  };
  const drops = line.drops.flatMap(({ item, count, chance }) => {
    const key = keyAt(item, 'drop', 'the drop is left out');
    return key === null ? [] : [{ key, chance: chance / CHANCE_SCALE, stackSize: count }];
  });
  const soils = new Set<ItemKey>();
  for (const i of line.soils) {
    const key = keyAt(i, 'soil', 'the soil is left out');
    if (key !== null) soils.add(key);
  }
  return {
    id: line.id, name: line.name, tier: line.tier, growthDuration: line.duration, dropChance: line.dropChance, drops,
    likedBiomes: [...line.liked], soils: [...soils], requirements: [...line.requirements],
    seed: line.seed === null ? null : keyAt(line.seed, 'seed', 'the crop has no seed'), minSeedBedTier: line.minSeedBedTier,
  };
}
