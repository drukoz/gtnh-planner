// Planner settings and results: architecture §6.3, with BomLine.group (§11.13) and where stock sits (§11.20).
// Fields after an "optional addition" comment extend §6.3 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { FarmSettings, FarmStep } from './farm.ts';
import type { Product } from './pack.ts';

/** Spec §3.6 modes 1–4; `enderio` is architecture §11.30. */
export const LogisticsMode = { Direct: 'direct', Routed: 'routed', AE2: 'ae2', EnderIO: 'enderio' } as const;
export type LogisticsMode = (typeof LogisticsMode)[keyof typeof LogisticsMode];

/**
 * The networked logistics modes, Project Red (`routed`) and AE2 (design spec §3.3, architecture §11.39): when the build
 * cost counts only their lines may make gathered world blocks (sand from cobblestone); machine-to-machine and EnderIO
 * lines dig them. Machine sharing is narrower: only AE2 lines in rate mode share machines (`sharesMachines`,
 * machine-options.ts: the steps of one sharing pool, `PlanStep.pool`, run on the same machines, owned and new alike);
 * Project Red, machine-to-machine and EnderIO lines give every step its own machines.
 */
export const NETWORKED_LOGISTICS: ReadonlySet<string> = new Set(['routed', 'ae2']);

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
 * The default `PlanSettings.stepCharge` (fix spec R3, architecture §11.34 as entry 39 amends it): "Fewest machines", the
 * user's answer of 2026-10-20 ("the fewer machines make a big difference where 3 % more raw material is negligible"):
 * with build cost counted each new machine block costs half the line's least raw material over the horizon, with it
 * ignored each recipe step must save half of it (within plan 09's +25 % cap). It was 0.02 from plan 09 to plan 12's fix
 * wave 2, which switches stored projects still at that value once (`SETTINGS_VERSION` 3, apply-op.ts).
 */
export const DEFAULT_STEP_CHARGE = 0.5;
/** The default `PlanSettings.stepCharge` before `SETTINGS_VERSION` 3 (plan 09 to plan 12's fix wave 2). */
export const STEP_CHARGE_BEFORE_V3 = 0.02;

/**
 * The default `PlanSettings.buildHorizonHours` (design spec §3.3, architecture §11.28): in rate mode the raw material to
 * build the machines a line adds is weighed against 24 hours of running it.
 */
export const DEFAULT_BUILD_HORIZON_HOURS = 24;

/**
 * The planning modes a project picks under "Plan for" (design spec §3.3, architecture §11.45 (1)): `least-raw`, raw
 * material per item while the line runs, machines not counted (add-on 12's "Ignore build cost"); `cheapest`, raw material
 * over the build horizon plus the machines the group does not have (add-on 12's objective); `multi-output`, cheapest with
 * a weight on each different raw material the line must be supplied with.
 */
export const PLAN_OBJECTIVES = ['least-raw', 'cheapest', 'multi-output'] as const;
export type PlanObjective = (typeof PLAN_OBJECTIVES)[number];
/** Every project's mode unless it picks another (the user's ruling of 2026-10-20: machine build cost counts). */
export const DEFAULT_OBJECTIVE: PlanObjective = 'cheapest';

/**
 * The default `PlanSettings.rawCap` (fix wave 3 (A), the user's answer of 2026-10-22: "still pick fewest machines, but
 * never more than 25 % more raw material than the leanest line; a setting you can change per project").
 */
export const DEFAULT_RAW_CAP = 0.25;

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
  automateCrafting: boolean;               // true = crafting-table steps run on the GT++ Auto Workbench (plan 12's Auto Workbench ruling); false = by hand. `normalizeSettings` reads every project as true (the user's ruling 180: no checkbox); an explicit false still plans by hand
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
   * when supporting lines (`routeDerived: true`) became the default, 3 from plan 12's fix wave 2, when "Fewest machines"
   * (`DEFAULT_STEP_CHARGE` 0.5) did, 4 from its fix wave 3 (A), when the raw cap (`DEFAULT_RAW_CAP`) was added.
   * `defaultSettings()` sets the current version and `normalizeSettings()` fills a missing one with 1 (a project stored
   * before it), which the server switches once.
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
   * Steps vs raw material (fix spec R3, architecture §11.34 as entry 39 amends it), 0 to 0.5: with build cost counted the
   * share of the line's least raw material over the horizon one new machine block costs beside its build (plan 12 fix
   * wave 2), with it ignored the share one recipe step must save to be built; 0 = least raw material, fewest recipes only
   * to break ties. `defaultSettings()` and `normalizeSettings()` always fill it; readers use `?? DEFAULT_STEP_CHARGE`.
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
  // optional addition
  /**
   * Hours of running the build cost of new machines is weighed against (rate mode); null = ignore build cost; Make N always
   * counts it against the batch. Above 0 and at most `MAX_BUILD_HORIZON_HOURS` (apply-op.ts); design spec §3.3,
   * architecture §11.28 and §11.39. `defaultSettings()` and `normalizeSettings()` always fill it
   * (`DEFAULT_BUILD_HORIZON_HOURS`) and keep a stored null, so readers test for null before they read a missing value as
   * `DEFAULT_BUILD_HORIZON_HOURS`.
   */
  buildHorizonHours?: number | null;
  // optional addition
  /**
   * "Build machines at" (the user's ruling 224 of 2026-10-20, plan 12 Task 7, architecture §11.39): the tier every step's
   * new machines are built at, where a machine of that tier runs its recipe (else the lowest tier above it that does,
   * else the nearest below, and the step says so; never above the project's tier, to which a higher value is clamped);
   * null = the cheapest tier, by the objective. A step's own `machineTier` pin wins; owned machines of every tier still
   * serve. A whole tier from 1 (LV) to 14. `defaultSettings()` and `normalizeSettings()` always fill it (null); readers
   * use `?? null`.
   */
  buildTier?: number | null;
  // optional addition
  /**
   * "Multiblocks" (the user's ruling 224, plan 12 Task 7): `allow` (the default) weighs a new multiblock like any machine;
   * `only-required` builds none for a step a single-block machine that can be built here runs, and weighs every new
   * multiblock of the others at `ONLY_REQUIRED_MULTIBLOCK_WEIGHT` raw on top of its build (machine-options.ts), so any
   * route without one wins where build cost counts, and a step that still needs one says so. Owned multiblocks stay free.
   * `defaultSettings()` and `normalizeSettings()` always fill it; readers treat only `only-required` as on.
   */
  multiblocks?: 'allow' | 'only-required';
  // optional addition
  /** The planning mode (add-on 17, §11.45 (1)); in rate mode a null `buildHorizonHours` plans least raw whatever it says. */
  objective?: PlanObjective;
  // optional addition
  /** The farms the planner may build or reuse, and those the group runs (add-on 17, farm.ts); readers use `?? defaultFarmSettings()`. */
  farms?: FarmSettings;
  // optional addition
  /** "Use other projects' surplus" (add-on 17, §11.45 (4)): on by default; readers treat only `false` as off. */
  useSurplus?: boolean;
  // optional addition (fix wave 3 (A))
  /**
   * "Raw material for fewer machines": wherever build cost counts and the step charge is above 0, the plan uses at most
   * (1 + this) × the raw material of the leanest line — the plan "Least raw material" makes with the same settings, the
   * raw material over the horizon plus its machines' build at its least — and within that the step charge decides; null =
   * no limit. 0 to `MAX_RAW_CAP` (apply-op.ts). With build cost ignored it is not read. `defaultSettings()` and
   * `normalizeSettings()` always fill it (`DEFAULT_RAW_CAP`) and keep a stored null.
   */
  rawCap?: number | null;
  // optional addition (plan 12 fix wave 3 (B))
  /**
   * "Only these come in" (fix wave 3 (B)): empty = off. Otherwise the line buys nothing outside these keys and the free
   * inputs (`FREE_KEYS`, which keep their own rules, `haveSupply` among them): every other good is made, or the plan is
   * blocked with "Nothing makes <good> from your base materials"; a stop item outside the list is made, with a
   * `stop-outside-inputs` warning. A listed key keeps its usual decision: the list only takes leaves away, so a good the
   * line would make (a derived fluid) is still made unless it is a stop item too. Only the line's own graphs read it:
   * machine prices, the build list and the layout's parts do not (`LinePricing.buildLeaf`). At most `MAX_INPUTS_ONLY`
   * keys (apply-op.ts), no repeats. `defaultSettings()` and `normalizeSettings()` always fill it; readers use `?? []`.
   */
  inputsOnly?: StuffKey[];
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
    /**
     * Why the group cannot get this option here ("needs MV (your tier is LV)"), as a swap list says it, or, for one this
     * plan does not use, that no chain makes it without a good the line avoids ("needs Tin Ingot, which is on your avoid
     * list"); absent: it can.
     */
    unusable?: string[];
  }>;
}

/**
 * One machine tier a step can run at (plan 12, architecture §11.39), for the step panel's "Machine tier" choice: of the
 * step's eligible machine options of that tier (before a `PlanSettings.machineTier` pin narrows them), the one with the
 * lowest build cost (an unpriced one last, then the lowest mteId), and what the step would need of it.
 */
export interface StepTier {
  /** The machine tier (a multiblock's: its energy-hatch tier). */
  tier: number;
  mteId: number; name: string;
  /** Machines of it the step would need at its rate, at least 1. */
  machines: number;
  /** How many of those the group owns. */
  owned: number;
  /** Raw material to build the rest; null when the machine has no price (it cannot be built here, or no price could be worked out). */
  build: number | null;
  /** Why the machine cannot be built here ("no recipe in this pack", "needs <item>, not available at <tier>"); absent when it can. */
  unbuildable?: string;
  /** On the tier a `PlanSettings.machineTier` pin names, clamped to the step's eligible tiers; set also when it cannot be built here. */
  pinned?: true;
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
  // optional addition
  /** Where a capped free supply comes from (add-on 17): another project's surplus or a farm the group runs; a row of its own beside a bought row of the key. */
  from?: { kind: 'project' | 'farm'; id: string; name: string };
  // optional addition
  /** A farm's tool wear (add-on 17): priced upkeep, never a raw source of best multi-output. */
  upkeep?: true;
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
  reused?: {
    count: number; where: MachineWhere[];
    // optional additions (plan 12, architecture §11.39)
    /**
     * Which of the type's owned machines the step runs on, 0-based in the owned pool's order (the scan's machines, then the
     * "Machines we have" list's): one index in two steps' lists is one machine serving both.
     */
    units?: number[];
    /** The ids of the other steps that run on one of these machines (`units` or those of `others`), sorted. */
    sharedWith?: string[];
    /**
     * Owned machines of the step's other eligible options (another tier, or a multiblock beside a singleblock) that run it
     * beside `machine`'s. They are in no `count`; `utilization` counts their capacity too.
     */
    others?: Array<{
      mteId: number; name: string; tier: number; count: number; units?: number[]; where: MachineWhere[];
      euPerTick: number; runsPerSecondPerMachine: number;
    }>;
  };
  // optional addition
  /** Every eligible machine tier of the step (plan 12), by tier, for the step panel's "Machine tier" choice. */
  tiers?: StepTier[];
  // optional addition
  /**
   * A sharing pool (plan 12): this step's machines are shared with the other steps of `steps` — same machine option,
   * programmed circuit, held items and fluids; every step of the pool carries the same `count`, `owned` and
   * `reused.units`, and its machines are counted once. Set only for a pool of two or more steps.
   */
  pool?: { id: string /* 'pool:' + its smallest step id */; steps: string[] /* every step id it runs, sorted, this one included */ };
  // optional addition
  /** A farm step's farm (add-on 17, farm.ts): what it plants and its words; the layout keeps an area for it. */
  farm?: FarmStep;
}

export interface PlanFlow { from: string /* step id | 'raw' */; to: string /* step id | 'out' | 'sink' */; key: StuffKey; perSecond: number }

/**
 * The machine a one-off job of the build list runs on (architecture §11 entry 41 (1)): `owned` the group has one (world
 * scan, "Machines we have" or a step's owned machines; reuse settings do not apply to a one-off job), `line` a type this
 * line adds, `new` neither (the cheapest that runs it), `first` only this line's own unit could, but its build needs the part.
 */
export interface BomMachine { mteId: number; name: string; tier: number; source: 'owned' | 'line' | 'new' | 'first' }

/** How the build list makes a good (architecture §11 entry 41 (1)): its recipe, machine and runs. */
export interface BomMade {
  recipeId: string; mapId: string; machine: BomMachine | 'crafting table';
  /** Whole runs of this node, alone (the pooled runs are the make plan's). */
  runs: number;
  /** The programmed-circuit configuration the recipe needs. */
  circuit?: number;
  /** The not-consumed parts the machine holds (`heldOption`'s pick per slot; the programmed circuit left out when `circuit` is set). */
  nonConsumed?: StuffKey[];
  /** The recipe needs a cleanroom. */
  cleanroom?: true;
}

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
  // optional addition
  /** How the breakdown makes this good (architecture §11 entry 41 (1)); never on a leaf. */
  made?: BomMade;
  // optional addition
  /** A good the line cannot buy and the breakdown cannot make here, and why (architecture §11 entry 41 (2)). */
  unmade?: 'no-recipe' | 'own-chain';
}

// 'make' is an optional addition (architecture §11 entry 41 (5)): a build part made in a machine
export interface BuildStep { id: string; order: number; text: string; pin?: number; kind: 'gather' | 'craft' | 'make' | 'handcraft' | 'place' | 'power' | 'logistics' | 'configure' | 'test' }
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
  rawCost?: {
    perSecond: number; leastPerSecond: number;
    // optional addition (fix wave 3 (A))
    /**
     * Where build cost counts: the raw material a second of the leanest line (the plan the build stage makes at step
     * charge 0, what "Least raw material" plans), which `PlanSettings.rawCap` and the step charge are measured against;
     * absent at No limit where the leanest line cannot change the step charge.
     */
    leanestPerSecond?: number;
  };
  // optional addition
  /**
   * What the plan costs in raw material (architecture §11.28, §11.39; every `ok` plan): to run it an hour (Make N: the
   * batch spread over its run time), and to build the machines it adds beyond what the group owns — step machines,
   * multiblock structures with the hatches they run with, and the cleanroom, a sharing pool's machines once — never the
   * layout's power and logistics parts. `horizonHours` is what the build cost was weighed against (null: ignored, and in
   * Make N, where the batch is the horizon).
   */
  cost?: {
    runPerHour: number; build: number; horizonHours: number | null;
    /** Make N: the raw material the whole batch consumes. */
    batch?: number;
    /** The layout's required parts other than its hatches (Plan 5's `planFinish`); the Materials page adds it to `build`. */
    layout?: number;
    /** New machines (a cleanroom included) that can be made here but that `build` leaves out: no price could be worked out. Set only when above 0. */
    unpriced?: number;
  };
  // optional addition
  /** The swap list of every made build part (architecture §11 entry 41 (3)), by key; absent when there is none. */
  buildAlternatives?: Record<StuffKey, PlanStep['alternatives']>;
  // optional addition
  /** The planning mode the plan was made in (add-on 17): its settings' mode as the planner reads it (`objectiveOf`). */
  objective?: PlanObjective;
  // optional addition
  /** The different raw goods the plan buys (cost above 0, upkeep aside), which best multi-output keeps few (add-on 17). */
  rawSources?: number;
  // optional addition
  /** Byproducts of the line's own runs credited to other projects that need them (best multi-output, add-on 17), per second. */
  credits?: Array<{ to: string; name: string; key: StuffKey; perSecond: number }>;
  // optional addition
  /** Who takes this plan's surplus (add-on 17): each live project's draw on it, oldest project first, per second. */
  drawnBy?: Array<{ by: string; name: string; key: StuffKey; perSecond: number }>;
  // optional addition
  /** The hash of what the plan read from other projects' summaries (add-on 17); absent when it read nothing. */
  crossHash?: string;
  // optional addition (plan 12's final review)
  /**
   * The goods a rate plan with build cost counted makes two or more ways, or buys beside the steps that make them, on
   * purpose (`planLine`), by code, then key: the plan index (`indexPlan`) gives such a good's `multi-producer` or
   * `bought-and-made` as a note (`PlanIndex.notes`), not as an integrity issue. Absent where there is none.
   */
  deliberate?: DeliberateSplit[];
}

/**
 * A good a build-cost plan makes two or more ways, or buys beside the steps that make it, on purpose (`Plan.deliberate`;
 * plan 12's final review, the plan-side counterpart of controller ruling 249's `needsMachine`). `full`: the machines of
 * the steps in `full` are full, and no maker can be dropped within the plan's machines — the other makers have too little
 * room for its share at no more raw material a unit (a step by hand or on a pseudo machine has room for any share); a
 * purchase: every step making the good is full — so making the rest one way, or making what it buys, needs another
 * machine, which the build stage weighed as dearer than the raw material it saves. `raw-cap`: the build stage's plan
 * uses all the raw material the raw cap allows (`PlanSettings.rawCap`) and its ways (a purchase: the purchase and its
 * makers) differ in raw material a unit, so the cap, not a tie, sets how much each makes.
 */
export interface DeliberateSplit {
  key: StuffKey;
  /** The integrity issue it would otherwise be (balance.ts `PlanIssueCode`). */
  code: 'multi-producer' | 'bought-and-made';
  why: 'full' | 'raw-cap';
  /** With `full`: the steps whose machines are full, in the order the plan index lists the good's makers (largest first). */
  full?: string[];
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
