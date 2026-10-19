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
  part?: string /* multipart / conduit / ME cable part */;
  role: BlockRole; label: string; step: string | null /* build step id */; covers?: ProjectorCover[];
}
export interface ProjectorStep { id: string; order: number; kind: BuildStep['kind']; text: string; blocks: number[] /* indices into blocks */; done: boolean }
export interface ProjectorPayload {
  format: typeof PROJECTOR_FORMAT; projectId: string; name: string; rev: number; version: string; status: LayoutStatus;
  message: string | null; dim: number; origin: [number, number, number]; size: [number, number, number]; blocks: ProjectorBlock[]; steps: ProjectorStep[];
}
