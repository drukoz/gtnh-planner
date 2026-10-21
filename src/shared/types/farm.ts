// Farms as renewable sources (add-on 17, docs/superpowers/plans/2026-10-20-17-objectives.md; architecture §11.45 (2);
// research docs/research/farms.md): the farm settings a project plans with (`PlanSettings.farms`), what a synthetic farm
// recipe carries (`Recipe.meta.farm`) and what a farm step says (`PlanStep.farm`).
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';

/** The farms the planner may build or reuse: the Tree Growth Simulator, and CropsNH crop sticks under a Crop Manager. */
export const FARM_KINDS = ['tgs', 'crop-manager'] as const;
export type FarmKind = (typeof FARM_KINDS)[number];

/** The Tree Growth Simulator's modes in the order of a `gt.recipe.treefarm` row's item slots, `out` (farms.md §1.6). */
export const TGS_MODE_ORDER = ['log', 'sapling', 'leaves', 'fruit'] as const;   // the export's output positions
export type TgsMode = (typeof TGS_MODE_ORDER)[number];

/** A crop seed's stats (farms.md §2.2). */
export interface CropStats { growth: number; gain: number; resistance: number }   // 1–31 each

/** What a Crop Manager feeds its crop sticks besides water (farms.md §2.4): nothing, CropsNH Fertilizer or Bone Meal. */
export const FERTILIZER_CHOICES = ['none', 'fertilizer', 'bone-meal'] as const;

/** A farm the group already runs (a Forestry multifarm or any other), as what it gives a minute: free up to that rate. */
export interface RunningFarm { name: string; outputs: Array<{ key: StuffKey; perMinute: number }> }

/**
 * A project's farm settings: the kinds the planner may plan; the Tree Growth Simulator's energy hatch tier, which mode's
 * tool its input bus holds and their material; the Crop Manager's tier, the seeds' stats, the layers of crop sticks
 * (1 to 3), how many of the crop's liked biome tags the farm's biome has (0 to 2), open sky and fertilizer; and the farms
 * the group already runs.
 */
export interface FarmSettings {
  kinds: FarmKind[];
  tgs: { tier: number; tools: Record<TgsMode, boolean>; toolMaterial: string };
  crops: { tier: number; stats: CropStats; layers: number; likedTags: number; sky: boolean; fertilizer: (typeof FERTILIZER_CHOICES)[number] };
  running: RunningFarm[];
}

/**
 * The farm settings of a project that sets none, a new object each call: both kinds; a Tree Growth Simulator at LV (the
 * most items per EU, farms.md §1.3) holding a Steel saw and knife (the research's rubber example, §5.8); a Basic Crop
 * Manager over one layer of seeds at the stats a new seed has (§2.2), under open sky, without fertilizer; no farm the
 * group runs.
 */
export function defaultFarmSettings(): FarmSettings {
  return {
    kinds: ['tgs', 'crop-manager'],
    tgs: { tier: 1, tools: { log: true, sapling: false, leaves: false, fruit: true }, toolMaterial: 'Steel' },
    crops: { tier: 1, stats: { growth: 1, gain: 1, resistance: 1 }, layers: 1, likedTags: 0, sky: true, fertilizer: 'none' },
    running: [],
  };
}

/** The materials a Tree Growth Simulator's tools may be of (`FarmSettings.tgs.toolMaterial`), by durability. */
export const TOOL_MATERIALS = [
  'Bronze', 'Iron', 'Invar', 'Stainless Steel', 'Steel', 'Black Steel', 'Diamond', 'Damascus Steel', 'Titanium', 'Vanadiumsteel',
  'Tungstensteel', 'HSS-G', 'HSS-E',
] as const;

/**
 * The tool durability of each of `TOOL_MATERIALS` (farms.md §1.5, as GT's `MaterialsInit` sets it; the export's materials
 * carry none): a GT tool lasts `floor(durability × its tool's durability multiplier)` uses.
 */
export const TOOL_DURABILITY: Readonly<Record<string, number>> = {
  Bronze: 192, Iron: 256, Invar: 256, 'Stainless Steel': 480, Steel: 512, 'Black Steel': 768, Diamond: 1280,
  'Damascus Steel': 1280, Titanium: 1600, Vanadiumsteel: 1920, Tungstensteel: 2560, 'HSS-G': 4000, 'HSS-E': 10240,
};

/**
 * What a synthetic farm recipe carries (`Recipe.meta.farm`): a Tree Growth Simulator's, made from an export row of its
 * sapling, or a crop's, made from a card of the crop table; the tier it runs at (never overclocked), the farm machines the
 * line may use, the crop sticks one machine tends, its footprint, and what it plants and wears.
 */
export interface FarmRecipeMeta {
  kind: 'tgs' | 'crop'; tier: number; machines: number[] /* usable mteIds, owned first, then ascending */;
  parallel: number /* crop sticks one machine tends; 1 for a TGS */; footprint: [number, number, number] /* x, height, z, as every layout size */;
  sapling?: StuffKey; tools?: StuffKey[];
  crop?: { id: string; name: string; growthTicks: number; stats: CropStats; soil: StuffKey | null; seed: StuffKey | null };
}

/**
 * A farm step (`PlanStep.farm`): what kind of farm at which tier, its footprint (laid out as an area kept for it), its words
 * (`text`), and what it plants: a Tree Growth Simulator's sapling and tools, or a crop with its seed stats and the crop
 * sticks the step needs.
 */
export interface FarmStep {
  kind: 'tgs' | 'crop'; tier: number; footprint: [number, number, number]; text: string;
  sapling?: StuffKey; tools?: StuffKey[]; crop?: { id: string; name: string; stats: CropStats }; sticks?: number;
}
