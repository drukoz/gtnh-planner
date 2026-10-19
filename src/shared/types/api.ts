// Request and response bodies of the HTTP API (architecture §7, §8, §11.6). Plans 3–5 append their own; nothing here is
// renamed or reshaped. Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { BlockRef, Capability, DimensionInfo, PackManifest, RecipeSource } from './pack.ts';
import type { PlanSettings } from './plan.ts';
import type { ProjectOp } from './project.ts';

/** Who is acting; the value is `encodeURIComponent(name)` and the server decodes it. */
export const NAME_HEADER = 'X-Planner-Name';

/** The body of every error response. */
export interface ApiError { error: string; message: string }

/** `GET /api/pack`: §7's fields plus the settings panel's checklists (§11.6). */
export interface PackInfo {
  manifest: PackManifest; mapCount: number; recipeCount: number; itemCount: number;
  dimensions: DimensionInfo[]; capabilities: Capability[]; exclusionRules: string[];
  // optional addition
  /** The material names an avoid entry can be, with their display names, sorted by display name (§11.25). */
  materials?: Array<{ name: string; label: string }>;
}

/** One recipe as the item browser shows it; an ingredient with alternatives shows its first option. */
export interface RecipeSummary {
  id: string; source: RecipeSource; maps: string[]; machineName: string; tier: number; euPerTick: number; durationTicks: number;
  inputs: Array<{ key: StuffKey; name: string; amount: number; consumed: boolean }>;
  outputs: Array<{ key: StuffKey; name: string; amount: number; chance: number }>;
  /** From `flags.fake`: display only, the machine runs its own code. */
  fake?: boolean;
}

/** `GET /api/pack/stuff/:key`: at most 50 producers and 50 consumers. */
export interface StuffInfo { key: StuffKey; name: string; producers: RecipeSummary[]; consumers: RecipeSummary[] }

/** `GET /api/projects`, newest first. */
export interface ProjectListEntry { id: string; name: string; rev: number; target: StuffKey | null; updatedAt: string }

export interface CreateProjectBody { name: string; settings?: Partial<PlanSettings> }
export interface OpsBody { ops: ProjectOp[] }
export interface OpsResult { rev: number }

/** SSE `op` (§8). */
export interface OpEvent { rev: number; op: ProjectOp; by: string; at: string }
/** SSE `plan` (§8): the plan and the layout of this revision may have changed. */
export interface PlanEvent { rev: number }

// Plan 4: the /api/world bodies live in world-api.ts (ruling R2).
export type { WorldSourcesResponse, StartScanRequest, StartScanResponse, WorldScanListItem, CreateUploadResponse, PaletteName } from './world-api.ts';

// --- assets (Plan 3; architecture §6.5, §11.17) ---

/** `POST /api/assets/icons` → `IconDescriptor[]` in request order; at most `ASSET_KEYS_MAX` keys. */
export interface AssetIconsRequest { keys: StuffKey[] }
/**
 * `POST /api/assets/blocks` → `BlockFaces[]` in request order; at most `ASSET_BLOCKS_MAX` blocks. `facing`
 * (ForgeDirection 0..5, default 2 = north) applies to every block, so each facing is its own request.
 */
export interface AssetBlocksRequest { blocks: BlockRef[]; facing?: number }
/** `POST /api/assets/covers` → `CoverLayers[]` in request order; at most `ASSET_KEYS_MAX` items. */
export interface AssetCoversRequest { items: StuffKey[] }
export const ASSET_KEYS_MAX = 500;
export const ASSET_BLOCKS_MAX = 500;

/** `GET /api/projects?deleted=1` (§11.24), newest deletion first: restorable until purged 7 days after `deletedAt`. */
export interface DeletedProjectSummary { id: string; name: string; rev: number; target: StuffKey | null; updatedAt: string; deletedAt: string; deletedBy: string }
/** SSE `deleted` (§11.24): the last event of every stream of a project someone deleted; the stream then ends. */
export interface DeletedEvent { id: string; by: string; at: string }

// --- pack names (Plan 16; architecture §11.43(f)) ---

/**
 * `POST /api/pack/names` → `Array<string | null>` in request order: the pack's name of each item or fluid, null for a
 * key the pack does not hold; at most `ASSET_KEYS_MAX` keys of at most 300 characters each.
 */
export interface PackNamesRequest { keys: StuffKey[] }
