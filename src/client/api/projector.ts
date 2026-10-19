// A project's projector tokens (spec §3.13, architecture §11.23) through apiGet / apiPost / apiDelete (name header,
// 401 → login, ApiError): the list shows who has one and when it was last used, never the token; creating one is the
// only answer that carries the token itself.

import type { CreateTokenBody, CreateTokenResult, TokenInfo } from '../../shared/types/projector.ts';
import { apiDelete, apiGet, apiPost } from './client.ts';

function tokensPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/tokens`;
}

/** The project's tokens, oldest first. */
export function listTokens(projectId: string): Promise<TokenInfo[]> {
  return apiGet<TokenInfo[]>(tokensPath(projectId));
}

/** A new token for whoever `label` names (the server trims it and names an empty one). */
export function createToken(projectId: string, label: string): Promise<CreateTokenResult> {
  const body: CreateTokenBody = { label };
  return apiPost<CreateTokenResult>(tokensPath(projectId), body);
}

/** Deletes the token: a projector that sends it is refused from then on. */
export function revokeToken(projectId: string, tokenId: string): Promise<void> {
  return apiDelete(`${tokensPath(projectId)}/${encodeURIComponent(tokenId)}`);
}
