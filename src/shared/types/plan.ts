// Planner settings and results: architecture §6.3, with BomLine.group (§11.13) and where stock sits (§11.20).
// Fields after an "optional addition" comment extend §6.3 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Product } from './pack.ts';

export const LogisticsMode = { Direct: 'direct', Routed: 'routed', AE2: 'ae2' } as const;
export type LogisticsMode = (typeof LogisticsMode)[keyof typeof LogisticsMode];

/**
 * Recipe categories left out unless the group turns the rule off: recycling, mass fab, replicator, scrap, lava/stone-dust
 * centrifuge (which also covers the Large Thermal Refinery's lava filter: metals out of free lava), and crafting a
 * Programmed Circuit back into a circuit.
 */
export const DEFAULT_EXCLUDED_CATEGORIES: readonly string[] = [
  'recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion',
];

/**
 * Inputs that cost nothing (architecture §5). Nether Air and Toxic Air are not free: they are dimension-gated
 * fluids that come from `worldgen.fluidSources` (materials-availability §2.3).
 */
export const FREE_KEYS: readonly StuffKey[] = ['fluid:water', 'fluid:lava', 'fluid:air', 'minecraft:cobblestone@0'];

/** Why a raw input is a leaf of the plan instead of something the line makes. */
export type LeafClass = 'free' | 'direct' | 'byproduct' | 'derived' | 'natural' | 'stop' | 'unavailable';

export interface PlanSettings {
  target: StuffKey | null; mode: 'rate' | 'makeN'; amount: number; per: 'min' | 'hour';   // per ignored for makeN
  tier: number | null;                     // null = from world scan (fallback LV = 1)
  dims: { policy: 'progression' | 'visited'; overrides: Record<string, 'on' | 'off'> };   // keys: DimensionInfo.key or Capability.key; absent = auto
  routeDerived: boolean;                   // true (default) = the planner makes derived materials (supporting lines); false = it buys those within 4 recipe layers (DERIVED_LEAF_MAX_DEPTH) as flagged leaves
  logistics: LogisticsMode;
  costOverrides: Record<string, number>;   // key = material name ("Silver") or StuffKey
  stopItems: StuffKey[];                   // "we already make this"
  expandItems: StuffKey[];                 // base items the group wants to make themselves
  recipeChoice: Record<StuffKey, string>;  // pinned recipe id per produced item
  machineTier: Record<string, number>;     // per recipe id
  excludedCategories: string[];            // default: DEFAULT_EXCLUDED_CATEGORIES
  coilHeat: number | null;                 // EBF coil heat (K); null = default for tier or from world
  automateCrafting: boolean;               // false = crafting-table steps are hand-crafting
  /**
   * Materials to avoid (§11.25): GT material names ("Silver": every form of it) or StuffKeys, at most 50, no repeats.
   * `defaultSettings()` and `normalizeSettings()` always fill it; readers still use `?? []` (projects stored before it).
   */
  avoid: string[];
  // optional addition
  /**
   * mteIds of owned machine types the group does not want to reuse for this line (spec §3.3 "suggests reusing them.
   * The group decides."). `defaultSettings()` and `normalizeSettings()` always fill it; readers use `?? []`.
   */
  declineReuse?: number[];
  // optional addition
  /**
   * Which defaults the settings were made under (`SETTINGS_VERSION` in apply-op.ts; architecture §11.32): 2 from plan 09,
   * when supporting lines (`routeDerived: true`) became the default. `defaultSettings()` sets the current version and
   * `normalizeSettings()` fills a missing one with 1 (a project stored before it), which the server switches once.
   */
  settingsVersion?: number;
}

/** One storage block holding some of a good (§11.20). */
export interface StorageWhere { kind: string; pos: [number, number, number]; count: number; reachable: boolean }

export interface SourceInfo { kind: 'vein' | 'small_ore' | 'byproduct' | 'fluid' | 'capability' | 'craft' | 'natural' | 'derived' | 'unknown'; dims: string[]; detail: string; foundAt?: Array<{ dim: number; x: number; z: number }> }
export interface ReachableDim { key: string; why: 'visited' | 'progression' | 'override' }

export interface RawInput {
  key: StuffKey; perSecond: number; total?: number; cost: number; available: boolean; sources: SourceInfo[];
  have?: { total: number; reachable: number; where?: StorageWhere[] };
  // optional addition
  leafClass?: LeafClass;
  // optional addition
  /**
   * For a bought derived material or a stop item (fix spec R7): the chain buying it stands for, from making it on its
   * own: the recipe that makes most of it (container moves skipped), the map it runs on, the first option of each of
   * that recipe's consumed slots, and the recipes the whole chain runs. Absent when nothing makes it on its own.
   */
  pricedVia?: { recipeId: string; mapId: string; inputs: StuffKey[]; steps: number };
  // optional addition
  /** Some recipe the group can run at this tier makes it (fix spec R7); false for free and gathered goods. */
  canMake?: boolean;
}

export interface PlanStep {
  id: string /* = recipe id */; recipeId: string; mapId: string; machine: { mteId: number; name: string; tier: number };
  count: number; owned: number; runsPerSecond: number; utilization: number; euPerTick: number; durationTicks: number; overclocks: number;
  inputs: Product[]; outputs: Product[];   // per run, after chances (expected)
  alternatives: Array<{
    recipeId: string; rawCost: number; mapId: string;
    // optional additions: what one run of the alternative takes and makes (first option per slot, summed per key, at
    // most 4 each), named in `Plan.names`, so the swap list can tell recipes of one map apart
    inputs?: Array<{ key: StuffKey; amount: number }>; outputs?: Array<{ key: StuffKey; amount: number }>;
  }>;
  handCraft: boolean; warnings: string[];
  // optional additions
  /** The good this step was chosen to make; the key used for `PlanSettings.recipeChoice`. */
  mainOutput?: StuffKey;
  /** The overclock inputs behind `euPerTick`, `durationTicks` and `overclocks`. */
  oc?: { recipeEuPerTick: number; recipeDurationTicks: number; machineVoltage: number; machineAmps: number; perfect: boolean; heatOverclocks: number };
  needsCleanroom?: boolean;
  /** Whole runs in Make N. */
  runs?: number;
  /** The programmed-circuit configuration the recipe needs (spec §3.6). */
  circuit?: number;
}

export interface PlanFlow { from: string /* step id | 'raw' */; to: string /* step id | 'out' | 'sink' */; key: StuffKey; perSecond: number }

export interface BomLine {
  key: StuffKey; amount: number; why: string /* e.g. "2× Assembler (MV)" */;
  have?: { total: number; reachable: number; where?: StorageWhere[] };
  // optional additions
  /** One level of breakdown; leaves have none. */
  children?: BomLine[];
  /** The "to build" list is shown in these groups (§11.13); a missing group counts as `machines`. */
  group?: 'machines' | 'power' | 'logistics' | 'one-off';
}

export interface BuildStep { id: string; order: number; text: string; pin?: number; kind: 'gather' | 'craft' | 'handcraft' | 'place' | 'power' | 'logistics' | 'configure' | 'test' }
export interface PowerSummary { peakEUt: number; averageEUt: number; voltageTier: number; amps: number; fits?: 'yes' | 'tight' | 'no'; detail?: string; suggestions?: string[] }
export interface PlanWarning {
  code: string; text: string; stepId?: string; key?: StuffKey;
  // optional additions (fix spec R11): the steps of an integrity warning (`multi-producer`, `bought-and-made`), largest
  // first, and their shares
  stepIds?: string[];
  share?: number[];
}

export interface Plan {
  settingsHash: string; exportId: string; scanId?: string; tier: number; reachable: ReachableDim[]; unlocks: Array<{ key: StuffKey; text: string /* cheapest unlock, e.g. "Tungstate: End asteroids (HV) or Mars (T2 rocket, EV)" */ }>;
  steps: PlanStep[]; flows: PlanFlow[]; rawInputs: RawInput[]; byproducts: Product[];
  power: PowerSummary; buildList: BomLine[]; buildSteps: BuildStep[]; warnings: PlanWarning[];
  makeN?: { totalSeconds: number; leftovers: Product[] };
  // optional additions
  status?: 'ok' | 'empty' | 'infeasible';
  /** Base materials of the whole build list, summed. */
  buildTotals?: BomLine[];
  /**
   * English name of every key used in the plan, plus `dim:<DimensionInfo.key>` and `dimId:<Minecraft dim id>`
   * → dimension name and `map:<recipe map id>` → map name, so the client never needs the pack.
   */
  names?: Record<string, string>;
  /**
   * The goods the avoid list matched that the plan without it uses (§11.25), sorted by key: `unavoidable` when this plan
   * still uses one because nothing at the tier avoids it. Absent when the settings avoid nothing. A good it uses in a
   * not-consumed slot (a lens, mold or catalyst its machine holds) counts. So does a derived material it would buy that
   * is made from goods the list matched (`madeFrom`, those goods): buying it would use them outside the plan.
   */
  avoided?: Array<{ key: StuffKey; name: string; unavoidable: boolean; madeFrom?: StuffKey[] }>;
  // optional additions (fix spec R3, R11): what the line makes, how much of it a second (rate mode), and the raw material
  // it uses a second against the least any plan of its graph needs (rate mode)
  target?: StuffKey;
  targetPerSecond?: number;
  rawCost?: { perSecond: number; leastPerSecond: number };
}

export interface PlanContext {           // filled from a world scan by Plan 4; Plan 2 works with an empty one
  ownedMachines: Array<{ mteId: number; count: number }>;
  storage: Map<StuffKey, { total: number; reachable: number; where?: StorageWhere[] }>;
  visitedDims: string[] /* DimensionInfo.key */; topTier: number | null; coilHeat: number | null;
  prospected: Array<{ dim: number; x: number; z: number; vein: string }>;   // team discoveries joined to vein types
  power?: { averageEUt: number; spareEUt: number; voltageTier: number; storedEU: number; rainOutageSeconds: number };
}
