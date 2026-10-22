// The line layout: architecture §6.7, with configured parts (§11.14: `CoverSpec`, `LayoutBlock.covers/config`), the
// owning build step for the projector (§11.23: `LayoutBlock.buildStep`), EnderIO conduit faces and tail chests
// (architecture "EnderIO conduits, granted change requests (add-on 11)": `ConduitSpec`, `LayoutBlock.conduits/tail`),
// the structured feeding configuration (architecture §11 entry 51: `LayoutBlock.feed`) and Plan 5's optional additions.
// Fields after an "optional addition" comment extend §6.7 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from './assets.ts';
import type { FeedSpec } from './feed.ts';
import type { BlockRef } from './pack.ts';
import type { BomLine, BuildStep, LogisticsMode, PlanContext, PlanWarning, PowerSummary } from './plan.ts';
import type { TapPoint } from './world.ts';

/** No task emits a `cover` block: a cover is a `CoverSpec` on the block it sits on (§11.14). */
export type BlockRole = 'machine' | 'casing' | 'hatch' | 'cable' | 'transformer' | 'pipe' | 'cover' | 'interface' | 'chip_pipe' | 'chest' | 'ghost';

/** A cover on one face of its host block (§11.14). */
export interface CoverSpec {
  face: Face;
  item: StuffKey;                                        // the cover item, e.g. conveyor, pump, item/fluid/ore-dict filter
  settings: Record<string, string | number | boolean>;  // mode, direction, rate, whitelist
  filter?: StuffKey[];
}

// ---- EnderIO conduits (architecture "EnderIO conduits, granted change requests (add-on 11)") ----
// Every face has its own extract side and insert side, each with its own channel colour and filter.

/** The conduits a line lays; `conduit:<kind>` is the pseudo block of Plan 3's curated table. */
export type ConduitKind = 'item' | 'liquid_ender' | 'liquid_crystalline' | 'liquid_pink_slime' | 'liquid_melodic' | 'liquid_stellar';
/** EnderIO `ConnectionMode` (NBT `conModes`): extract = INPUT (1), insert = OUTPUT (2), in_out = IN_OUT (0), disabled = DISABLED (3). */
export type ConduitMode = 'extract' | 'insert' | 'in_out' | 'disabled';
/** EnderIO `DyeColor` in ordinal order (NBT `inSC.<DIR>` / `outSC.<DIR>`). */
export type DyeColor = 'black' | 'red' | 'green' | 'brown' | 'blue' | 'purple' | 'cyan' | 'silver' | 'gray' | 'pink' | 'lime' | 'yellow' | 'light_blue' | 'magenta' | 'orange' | 'white';
/** EnderIO `RedstoneControlMode` IGNORE, ON, OFF, NEVER (NBT `extRM.<DIR>`). */
export type RedstoneMode = 'ignore' | 'on' | 'off' | 'never';
export interface ConduitFilter {
  /** The filter upgrade in the slot; absent for an ender fluid conduit's own fluid filter. */
  item?: StuffKey;
  whitelist: boolean; keys: StuffKey[];
  /** Item filters only. */
  matchMeta?: boolean; matchNbt?: boolean; oreDict?: boolean; sticky?: boolean;
  /**
   * How many items or fluids the filter holds: a Basic Item Filter 5, an Advanced 10, a Big 24, an ender fluid conduit's
   * own fluid filter 5. Optional addition (the EnderIO single-pipe change), so the words can say which filter a list needs.
   */
  slots?: number;
  /**
   * A Limited Item Filter's count of each key, in `keys` order: an insert side lets an item in only while the target holds
   * fewer of it (every slot counted, an Auto Workbench's grid cells too). Optional addition (plan 12 Task 6: the cap on an
   * Auto Workbench's ingredients, research machine-feeding §2.1, §3.4).
   */
  limits?: number[];
}
export interface ConduitExtract {
  color: DyeColor; filter: ConduitFilter | null; /** items/s or L/s the face must move */ rate: number; roundRobin: boolean; redstone: RedstoneMode;
  /** Item conduits only; `speed` is absent when no upgrade is needed. */
  selfFeed?: boolean; speed?: { item: StuffKey; count: number };
}
export interface ConduitInsert {
  color: DyeColor; filter: ConduitFilter | null; rate: number; /** item conduits only; higher is filled first */ priority?: number;
  /**
   * True when the side inserts into a GT basic machine through that machine's output side, which takes items and fluids
   * there only while its Input from Output Side is allowed (`MTEBasicMachine.allowPutStack`, `isLiquidInput`); absent
   * otherwise.
   */
  outputSide?: boolean;
}
/** `extract` iff mode is extract or in_out, `insert` iff insert or in_out; `target` names what is on that side. */
export interface ConduitFace { face: Face; mode: ConduitMode; target: string; extract?: ConduitExtract; insert?: ConduitInsert }
/** `connections`: links to the same kind in neighbouring cells, bits `1 << side`; `faces` in `FACES` order. */
export interface ConduitSpec { kind: ConduitKind; item: StuffKey; connections: number; faces: ConduitFace[] }
/** A tail chest: where raw inputs go in, or which final outputs it collects. */
export interface TailChest { side: 'input' | 'output'; keys: StuffKey[] }

/**
 * What a multiblock's hatch is for: power, items in or out, fluids in or out, maintenance, the muffler GT needs on
 * some, and a steam multiblock's steam input hatch (the hatches the layout puts on a multiblock: server hatch-rules.ts).
 */
export type HatchKind = 'energy' | 'input_bus' | 'output_bus' | 'input_hatch' | 'output_hatch' | 'maintenance' | 'muffler' | 'steam';

export interface LayoutBlock {
  pos: [number, number, number]; block: BlockRef; role: BlockRole; facing?: number; stepId?: string; label: string;
  // §11.14: covers on this block's faces; programmed circuit number, chip settings, interface/pattern settings
  covers?: CoverSpec[]; config?: Record<string, string | number | boolean>;
  // optional additions
  /** What to craft for this block. */
  item?: StuffKey;
  /** Connected sides as bits `1 << side` (ForgeDirection), like `PlacedPipe.connections`. */
  connections?: number;
  /** Index into `Layout.hookups` of the hookup this block belongs to. */
  hookup?: number;
  /** The id of the build step that places this block (§11.23, for the in-game projector). */
  buildStep?: string;
  /** A conduit bundle's conduits, item first; the block's `connections` = OR of each conduit's links and its non-disabled face bits. */
  conduits?: ConduitSpec[];
  /** Set on the tail's input and output chests. */
  tail?: TailChest;
  /** What a hatch the line chose for a multiblock is for (the 3D view's links go into a multiblock through its buses). */
  hatch?: HatchKind;
  /**
   * A GT basic machine's front (`mMainFacing`), which GT keeps apart from its output side: then `facing` is the output
   * side (`mFacing`, where its output cover and inputs go). Only singleblock machines carry it.
   */
  mainFacing?: number;
  /**
   * The structured feeding configuration (architecture §11 entry 51, `src/shared/types/feed.ts`): a routed interface
   * pipe's chips with their filter mode and items, an ME interface's patterns and blocking mode, and on the ME glass
   * cable block an ME Export Bus sits on (as its `me_export_bus` cover) the bus's filter in slot order and its
   * Acceleration Cards (`exportBus`, which that cover's words say, not the feed's). The configure steps, the 3D view and
   * the Connections view word it with `configuredLines`; the feeding checker reads it.
   */
  feed?: FeedSpec;
  /**
   * Every plan step a shared machine runs (plan 12, architecture §11 entry 39: the steps of a sharing pool, `PlanStep.pool`),
   * on each block of its unit, the first being `stepId`. Set only for a machine of two or more steps.
   */
  stepIds?: string[];
}

export interface Hookup {
  kind: 'power' | 'logistics'; from: TapPoint; path: Array<[number, number, number]>; parts: BomLine[];
  // optional addition: false = no free route was found and `path` is a straight guide line
  found?: boolean;
}

export interface Pin { n: number; dim: number; pos: [number, number, number]; kind: 'site' | 'power' | 'logistics' | 'reuse' | 'warning'; text: string }

/** `empty`: nothing to place; `no-world`: laid out without a scan or base, at a default origin. */
export type LayoutStatus = 'ok' | 'empty' | 'no-world';

export interface Layout {
  dim: number; origin: [number, number, number]; size: [number, number, number]; rotation: 0 | 90 | 180 | 270; mode: LogisticsMode;
  blocks: LayoutBlock[]; hookups: Hookup[]; pins: Pin[]; buildSteps: BuildStep[]; bom: BomLine[]; warnings: PlanWarning[];
  // optional additions
  status?: LayoutStatus;
  /** The plan's power summary with the line's losses, AE2 idle draw and the power fit. */
  power?: PowerSummary;
  /** Structure casings that hatches replace. */
  replaced?: BomLine[];
}

/**
 * A tap that may know its cable's amp rating. `TapPoint.cableAmps` is not part of Plan 4's type (change request 7),
 * so real scans never carry it and readers fall back to `freeAmps`.
 */
export type LayoutTap = TapPoint & { cableAmps?: number };

/**
 * A power context that may know what the base still generates in rain. `PlanContext.power.rainEUt` is not part of
 * Plan 2's type (change request 8), so a missing value counts as 0.
 */
export type LayoutPowerContext = NonNullable<PlanContext['power']> & { rainEUt?: number };
