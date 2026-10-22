// The in-game ghost projector (spec §3.13, architecture §11.22–§11.23): per-project tokens as the browser sees them,
// and the payload `GET /api/projects/:id/projector` sends the mod, built from the line layout.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { BlockRole, LayoutStatus } from './layout.ts';
import type { BuildStep } from './plan.ts';

export const TOKEN_PREFIX = 'gpt_';
export const MAX_TOKENS_PER_PROJECT = 20;
export const TOKEN_LABEL_MAX = 40;
export const DEFAULT_TOKEN_LABEL = 'Projector token';

/** A token as listed: neither the token (shown once, at creation) nor its hash. */
export interface TokenInfo { tokenId: string; projectId: string; label: string; createdAt: string; createdBy: string; lastUsedAt: string | null; hint: string /* first 8 characters of the token */ }
export interface CreateTokenBody { label?: string }
/** The only answer that carries `token`: the planner keeps just its hash. */
export interface CreateTokenResult { token: string; tokenId: string; info: TokenInfo }

export const PROJECTOR_FORMAT = 'gtnh-planner-projector/1' as const;
/** A cover drawn on one face of its block; covers are never checked. */
export interface ProjectorCover { face: number /* ForgeDirection */; item: StuffKey; label: string }
export interface ProjectorBlock {
  pos: [number, number, number]; id: string /* real registry name */; meta: number | null /* null = do not compare */;
  mteId?: number; facing?: number /* only when the front is checked: GT's front facing */;
  /** `facing` is a single-block machine's output side (its GT front facing); its face overlay is on another side. */
  facingIsOutput?: true;
  /**
   * Beside `facingIsOutput`: the machine's own front (GT's `mMainFacing`, ForgeDirection), where GT draws its face
   * overlay; the mod draws the ghost's overlay there and checks it too. Optional, so a mod that does not read it still
   * reads the payload.
   */
  mainFacing?: number;
  part?: string /* multipart / conduit / ME cable part */;
  /** Every part of a block holding two or more (a conduit bundle's conduits, in bundle order); `part` is the first. */
  parts?: string[];
  /**
   * Beside `parts`, in its order: the build step that lays each part (null where none does). A bundle of the line has
   * its Item Conduit laid by the step that places it (`step`, the line step) and its fluid conduit by the fluids step,
   * which does not list it in its `blocks`: a mod that sees only the bundle block (0.1) never counts it for the fluids
   * step, and one that sees the bundle's conduits shows it under both steps and counts it for each once that step's
   * conduit is in.
   */
  partSteps?: Array<string | null>;
  role: BlockRole; label: string; step: string | null /* build step id: the step that places it */; covers?: ProjectorCover[];
}
/**
 * `blocks`: the indices of the blocks whose `step` it is, ascending; a conduit bundle that another step places but this
 * one lays a conduit in names this step in its `partSteps` instead.
 */
export interface ProjectorStep { id: string; order: number; kind: BuildStep['kind']; text: string; blocks: number[] /* indices into blocks */; done: boolean }
export interface ProjectorPayload {
  format: typeof PROJECTOR_FORMAT; projectId: string; name: string; rev: number; version: string; status: LayoutStatus;
  message: string | null; dim: number; origin: [number, number, number]; size: [number, number, number]; blocks: ProjectorBlock[]; steps: ProjectorStep[];
}
