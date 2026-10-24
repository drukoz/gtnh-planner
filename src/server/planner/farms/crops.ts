// CropsNH crop sticks under a Crop Manager as a farm model (add-on 17, architecture §11.45 (2); research
// docs/research/farms.md §2.2–§2.4): how fast a crop grows on the nutrients a managed stick gets, what one harvest of one
// stick gives, and the water, fertilizer and EU the manager spends on it. Ported from the cropsnh-2.0.129 bytecode the
// research quotes, with Java's arithmetic. Pure; the synthetic crop recipes of a line are built from it.

import { V } from '../../../shared/gt/tiers.ts';
import type { StuffKey } from '../../../shared/keys.ts';
import type { CropStats, FarmSettings } from '../../../shared/types/farm.ts';
import type { CropCard, Product } from '../../../shared/types/pack.ts';

/** A crop stick grows once every 256 ticks (`TileEntityCropSticks.TICK_RATE`, farms.md §2.2). */
export const CROP_GROWTH_TICKS = 256;
/** The Crop Managers, LV to UMV (farms.md §2.1): `CROP_MANAGER_MTE_IDS[m − 1]` is the one of tier m. */
export const CROP_MANAGER_MTE_IDS: readonly number[] = Object.freeze([
  28001, 28002, 28003, 28004, 28005, 28006, 28007, 28008, 28009, 28010, 28011, 28012,
]);
/** The fertilizer items a Crop Manager can feed and their potency, in fertilizer points (`FertilizerLoader`, farms.md §2.4). */
export const FERTILIZERS: Readonly<Record<'fertilizer' | 'bone-meal', { key: StuffKey; potency: number }>> = {
  fertilizer: { key: 'cropsnh:fertilizer@0', potency: 100 },
  'bone-meal': { key: 'minecraft:dye@15', potency: 5 },
};

/** The water points, and the fertilizer points, a crop stick holds at most; a Crop Manager tops it up to that. */
const STICK_STORAGE = 200;
/** A Crop Manager waters a stick holding at most this many water points (`applyHydration`): one watering adds 20. */
const WATERING_BELOW = 180;
/** A Crop Manager's harvest rolls `1 + 0.05 × its tier` times the drop rounds (`getHarvestBonusChance`, farms.md §2.4). */
const HARVEST_BONUS_PER_TIER = 0.05;
/** The humidity the planner assumes: it gives no bonus, so the crop's liked biome tags alone may (farms.md §2.2). */
const NEUTRAL_HUMIDITY = 0.5;

/**
 * The growth points a crop gains per growth tick (`TileEntityCropSticks.getGrowthRate`, farms.md §2.2) on `nutrients`
 * (5–55), for a crop of `tier` and a seed of `growth`; 0 when it cannot grow. Java int arithmetic: each division truncates.
 */
export function growthRate(nutrients: number, tier: number, growth: number): number {
  const points = nutrients * 5;
  const need = tier * 10;
  if (need < 0) return 0;
  const base = 6 + growth;
  if (points >= need) return Math.trunc((base * (100 + points - need)) / 100);
  return Math.max(0, Math.trunc((base * (100 - (need - points) * 4)) / 100));
}

/**
 * The nutrients a crop stick gets (`getNutrientsPerCycle`, farms.md §2.2): 5, up to 10 for its water and 10 for its
 * fertilizer (each counted up to 100 points), 2 under open sky, and the larger of the biome's humidity bonus (up to 14)
 * and 14 per liked biome tag (up to 2). Java arithmetic: int division, and the humidity bonus in float, truncated.
 */
export function nutrientsPerCycle(likedTags: number, humidity: number, sky: boolean, water: number, fertilizer: number): number {
  const tags = Math.min(2, likedTags);
  const nutrients = 5 + Math.trunc((Math.min(100, water) + 9) / 10) + Math.trunc((Math.min(100, fertilizer) + 9) / 10) + (sky ? 2 : 0);
  const f = Math.fround;   // Java's float: the humidity is the biome's float rainfall, and the constants are floats too
  const humidityBonus = f(Math.max(0, Math.min(1, f(f(f(humidity) - 0.5) / f(0.3)))) * 14);
  return nutrients + Math.max(Math.trunc(humidityBonus), tags * 14);
}

/**
 * The nutrients of a crop stick under a Crop Manager with these crop settings: its water, and its fertilizer when
 * fertilizer is on, kept above 100 points; `likedTags` of the crop's liked biome tags and no humidity bonus; open sky
 * only with one layer, as with 2 or 3 only the top one sees it and every stick is planned without it.
 */
export function cropNutrients(crops: FarmSettings['crops']): number {
  const fertilizer = crops.fertilizer === 'none' ? 0 : STICK_STORAGE;
  return nutrientsPerCycle(crops.likedTags, NEUTRAL_HUMIDITY, crops.sky && crops.layers === 1, STICK_STORAGE, fertilizer);
}

/** The side of the square a Crop Manager of `tier` tends: twice its horizontal radius `3 + 2 × tier`, plus one (§2.4). */
export function managerSide(tier: number): number {
  return 2 * (3 + 2 * tier) + 1;
}

/** The crop sticks one Crop Manager of `tier` tends over `layers` (1–3) layers: a full square in each. */
export function sticksPerManager(tier: number, layers: number): number {
  return managerSide(tier) ** 2 * layers;
}

/**
 * One harvest of one crop stick: its growth ticks from 0 to mature and its cycle in ticks; its drops, as expected
 * values; the EU, water (L) and fertilizer items the Crop Manager spends on the stick in that cycle.
 */
export interface CropHarvest {
  growthTicks: number; cycleTicks: number; drops: Product[] /* per harvest of one stick, expected */;
  euPerRun: number; waterPerRun: number /* L */; fertilizer: { key: StuffKey; perRun: number } | null;
}

/**
 * One harvest of one crop stick under a Crop Manager of `managerTier`; null for a crop with growth requirements or one that cannot grow.
 * (Sub-soil blocks, light and machine-only crops are not modelled.) farms.md §2.2–§2.4, as expected values:
 * - growth: `ceil(growthDuration / rate)` growth ticks of 256 ticks each, harvested before the next one;
 * - drops: the harvest rolls `dropChance × 1.03^gain × (1 + 0.05 × managerTier)` drop rounds, and in each one drop j
 *   succeeds with its chance, at most 1 (a Crop Manager counts one success a round, so Water Lily's 8 acts as 1), for its
 *   stack size plus 1 more with chance `(gain + 1) / 100`; drops in card order, each at chance 1;
 * - water: a stick uses one water point per growth tick, one litre of water each;
 * - fertilizer: a stick uses one point per growth tick, and the manager uses one item when the stick holds at most
 *   `max(100, 200 − trunc(potency / 2))` points, of which the stick keeps at most 200 (`MTECropManager.applyFertilizer`), so
 *   one item adds `min(100, trunc(potency / 2))` points: 50 for CropsNH Fertilizer, 2 for Bone Meal;
 * - EU: `V / 8` for the harvest, charged only when it rolls at least one drop round (chance `min(1, rounds)`), and
 *   `V / 32` per upkeep action: one watering per 20 growth ticks (from 180 points back to 200) and one per fertilizer item.
 */
export function cropHarvest(card: CropCard, stats: CropStats, managerTier: number, crops: FarmSettings['crops']): CropHarvest | null {
  if (card.requirements.length > 0) return null;
  const rate = growthRate(cropNutrients(crops), card.tier, stats.growth);
  if (rate <= 0) return null;
  const growthTicks = Math.ceil(card.growthDuration / rate);
  const rounds = card.dropChance * Math.pow(1.03, stats.gain) * (1 + HARVEST_BONUS_PER_TIER * managerTier);
  const gainBonus = (stats.gain + 1) / 100;
  const drops = card.drops.map((d): Product => ({ key: d.key, amount: rounds * Math.min(1, d.chance) * (d.stackSize + gainBonus), chance: 1 }));
  let fertilizer: CropHarvest['fertilizer'] = null;
  if (crops.fertilizer !== 'none') {
    const { key, potency } = FERTILIZERS[crops.fertilizer];
    fertilizer = { key, perRun: growthTicks / Math.min(100, Math.trunc(potency / 2)) };
  }
  const volts = V[managerTier] as number;
  const upkeepActions = growthTicks / (STICK_STORAGE - WATERING_BELOW) + (fertilizer?.perRun ?? 0);
  const euPerRun = (volts / 8) * Math.min(1, rounds) + (volts / 32) * upkeepActions;
  return { growthTicks, cycleTicks: CROP_GROWTH_TICKS * growthTicks, drops, euPerRun, waterPerRun: growthTicks, fertilizer };
}
