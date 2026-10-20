// Planner settings and results: architecture §6.3, with BomLine.group (§11.13) and where stock sits (§11.20).
// Fields after an "optional addition" comment extend §6.3 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Product } from './pack.ts';

/** Spec §3.6 modes 1–4; `enderio` is architecture §11.30. */
export const LogisticsMode = { Direct: 'direct', Routed: 'routed', AE2: 'ae2', EnderIO: 'enderio' } as const;
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

/**
 * The default `PlanSettings.stepCharge` (fix spec R3, architecture §11.34): a recipe step is built only when it saves
 * at least 2 % of the line's least raw material (the user chose 2 % over the 5 % first proposed).
 */
export const DEFAULT_STEP_CHARGE = 0.02;

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
  // optional addition
  /**
   * Free inputs (`FREE_KEYS`) the group already supplies (fix spec R2, architecture §11.26): the line buys them free
   * instead of planning their generator (rock breaker, pump, compressor). Entries that are no free input have no effect.
   * `defaultSettings()` and `normalizeSettings()` always fill it; readers use `?? []`.
   */
  haveSupply?: StuffKey[];
  // optional addition
  /**
   * Steps vs raw material (fix spec R3, architecture §11.34): the share of the line's least raw material one recipe step
   * must save to be built, 0 to 0.5 (0 = least raw material, fewest recipes only to break ties). `defaultSettings()` and
   * `normalizeSettings()` always fill it; readers use `?? DEFAULT_STEP_CHARGE`.
   */
  stepCharge?: number;
  // optional addition
  /**
   * Pinned ingredient options (fix spec R9, architecture §11.35): `<recipe id>#<Ingredient.slot>` → the option that slot
   * takes, so the line plans that option (and its chain) for it and no other. A pin whose recipe, slot or option is gone,
   * or whose option the avoid list matches, is ignored with a `stale-option` warning. `defaultSettings()` and
   * `normalizeSettings()` always fill it; readers use `?? {}`.
   */
  optionChoice?: Record<string, StuffKey>;
  // optional addition
  /**
   * "Reuse machines we have" (design spec §3.3, architecture §11.29): true = a step runs first on the machines the group
   * owns (the linked world scan's base and `ownedManual`) and the build list adds only the rest; false = every machine is
   * planned new, as if the group owned none (`declineReuse` leaves out one machine type instead). `defaultSettings()` and
   * `normalizeSettings()` always fill it (true); readers treat only `false` as off.
   */
  reuseOwned?: boolean;
  // optional addition
  /**
   * "Machines we have" (architecture §11.28–§11.29): machines the group owns that no linked scan shows (they stand
   * elsewhere, or no world is linked), by mteId, reused like the scan's; at most 200 entries of 1 to 10,000 machines, one
   * per mteId (repeats are summed). `defaultSettings()` and `normalizeSettings()` always fill it; readers use `?? []`.
   */
  ownedManual?: Array<{ mteId: number; count: number }>;
}

/** Where one of the group's machines stands (a world scan's `PlacedMachine`): its dimension id and block position. */
export interface MachineWhere { dim: number; pos: [number, number, number] }

/**
 * One multi-option ingredient slot of a step's recipe (fix spec R9, architecture §11.35): every option the line may take
 * (the avoid list's aside), those the planner's walk left out too, each with what one run would take of it, its share of
 * the slot in this plan (0: not used by this plan), its raw material per run and the recipe steps of its own chain.
 */
export interface StepOption {
  /** `Ingredient.slot`: with the recipe id, the key of `PlanSettings.optionChoice`. */
  slot: number;
  /** The option `PlanSettings.optionChoice` pins for this slot, when the plan honours that pin. */
  pinned?: StuffKey;
  choices: Array<{
    key: StuffKey; amount: number /* per run, expected */; share: number /* 0..1 in this plan */;
    rawPerRun: number /* amount × its raw cost per unit */; steps: number /* its standalone chain's recipes; 0 for a leaf */;
    via?: string[] /* map names of that chain, at most 3 */;
    /** Why the group cannot get this option here ("needs MV (your tier is LV)"), as a swap list says it; absent: it can. */
    unusable?: string[];
  }>;
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
    // optional additions: what one run of the alternative takes and makes, named in `Plan.names`, so the swap list can
    // tell recipes of one map apart: every consumed input (one-option slots summed per key; items before fluids, each
    // largest first) and every output. An input that is an ore-dictionary slot of several options lists them all in
    // `options` (its own key and amount are the first of them), shown as "72 L Molten Soldering Alloy / 144 L Molten Tin".
    inputs?: Array<{ key: StuffKey; amount: number; options?: Array<{ key: StuffKey; amount: number }> }>;
    outputs?: Array<{ key: StuffKey; amount: number }>;
    /**
     * Why the group cannot pick this recipe here, in plain words ("needs MV (your tier is LV)", "needs Moon (T1
     * rocket)", "excluded: recycling (see Settings)", "needs a machine nothing can build here"); absent when it can.
     * Usable recipes come first, then these, each group by raw cost per unit, then id (controller rulings, plan 09).
     */
    unusable?: string[];
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
  // optional addition
  /**
   * The good this step's supply recipe makes for the line (fix spec R2: a rock breaker's cobblestone or stone, a pump's
   * water or lava, the fluid of the cells a compressor fills); absent for every other step.
   */
  supply?: StuffKey;
  // optional addition
  /** The multi-option ingredient slots of the step's recipe and what each option would cost (fix spec R9). */
  options?: StepOption[];
  // optional addition
  /**
   * The supporting line the step belongs to (fix spec R6, architecture §11.27): the derived material it ultimately serves
   * and that material's name ("Red Alloy"); absent for a step of the main line.
   */
  line?: { key: StuffKey; name: string };
  // optional addition
  /**
   * How many ways the export knows to make the main output (`total`: recipes that make it, less display-only and duplicate
   * ones and those using a good the project avoids) and how many of them the group can pick here (`usable`), for the
   * count line "14 ways to make Electronic Circuit: 2 you can use now"; `alternatives` lists every one of them.
   */
  ways?: { total: number; usable: number };
  // optional addition
  /**
   * The owned machines the step runs on (architecture §11.29): as many as `owned`, and where those a world scan found
   * stand, scan positions first (a machine of the "Machines we have" list counts without one). Absent when the step
   * reuses none, as with "Reuse machines we have" off.
   */
  reused?: { count: number; where: MachineWhere[] };
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
  // optional addition
  /**
   * On a total of base materials (fix spec D15, architecture §11.36): the top-level build lines that need it, by key in
   * the order of the lines, and how much each needs; the amounts add up to the total's `amount`.
   */
  neededFor?: Array<{ key: StuffKey; amount: number }>;
}

export interface BuildStep { id: string; order: number; text: string; pin?: number; kind: 'gather' | 'craft' | 'handcraft' | 'place' | 'power' | 'logistics' | 'configure' | 'test' }
export interface PowerSummary { peakEUt: number; averageEUt: number; voltageTier: number; amps: number; fits?: 'yes' | 'tight' | 'no'; detail?: string; suggestions?: string[] }
export interface PlanWarning {
  code: string; text: string; stepId?: string; key?: StuffKey;
  // optional additions (fix spec R11): the steps of an integrity warning (`multi-producer`, `bought-and-made`), largest
  // first, and their shares
  stepIds?: string[];
  share?: number[];
  // optional addition (fix spec R11, plan 09 follow-up): every good a `batch-short` warning covers (`key` is the first),
  // which the plan index then leaves to it
  keys?: StuffKey[];
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
  ownedMachines: Array<{
    mteId: number; count: number;
    // optional addition (plan 09 Task 9, ruling P22): where those machines stand, in the scan's order
    where?: MachineWhere[];
  }>;
  storage: Map<StuffKey, { total: number; reachable: number; where?: StorageWhere[] }>;
  visitedDims: string[] /* DimensionInfo.key */; topTier: number | null; coilHeat: number | null;
  prospected: Array<{ dim: number; x: number; z: number; vein: string }>;   // team discoveries joined to vein types
  power?: { averageEUt: number; spareEUt: number; voltageTier: number; storedEU: number; rainOutageSeconds: number };
}
