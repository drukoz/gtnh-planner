// The line layout: architecture §6.7, with configured parts (§11.14: `CoverSpec`, `LayoutBlock.covers/config`), the
// owning build step for the projector (§11.23: `LayoutBlock.buildStep`) and Plan 5's optional additions.
// Fields after an "optional addition" comment extend §6.7 without renaming or reshaping it.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from './assets.ts';
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
