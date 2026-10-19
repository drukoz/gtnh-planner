// Projector tokens (spec §3.13, architecture §11.22–§11.23): a revocable secret per project that the in-game projector
// sends as `Authorization: Bearer <token>`. Only its sha256 and its first 8 characters are stored, so the token is
// shown once, when it is made; revoking deletes the row. While a project is deleted its tokens are refused like those
// of an unknown project and work again once it is restored; purging the project deletes them (db.ts).

import { createHash, randomBytes } from 'node:crypto';
import type { Db, TokenRow } from '../db/db.ts';
import {
  DEFAULT_TOKEN_LABEL, MAX_TOKENS_PER_PROJECT, TOKEN_LABEL_MAX, TOKEN_PREFIX, type CreateTokenResult, type TokenInfo,
} from '../../shared/types/projector.ts';

/** A token's `lastUsedAt` is written at most this often, so a projector that polls does not write on every request. */
export const TOUCH_INTERVAL_MS = 60_000;
/** A token is 47 characters; anything longer is refused before it is hashed. */
const MAX_TOKEN_LENGTH = 100;

/** `gpt_` and 256 random bits as 43 base64url characters. */
export function newToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** What the database keeps in place of the token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Trimmed and cut to 40 characters; `DEFAULT_TOKEN_LABEL` when that leaves nothing or the label is not a string. */
export function cleanLabel(label: unknown): string {
  if (typeof label !== 'string') return DEFAULT_TOKEN_LABEL;
  // Characters, not UTF-16 units, so a cut never splits an emoji (as for display names in http/server.ts).
  const cut = Array.from(label.trim()).slice(0, TOKEN_LABEL_MAX).join('').trim();
  return cut === '' ? DEFAULT_TOKEN_LABEL : cut;
}

export class TokenLimitError extends Error {
  constructor() {
    super(`A project can have at most ${MAX_TOKENS_PER_PROJECT} projector tokens — revoke one first`);
    this.name = 'TokenLimitError';
  }
}

/** What anyone may see of a token: everything but its hash. */
function infoOf(row: TokenRow): TokenInfo {
  return {
    tokenId: row.id, projectId: row.projectId, label: row.label, createdAt: row.createdAt, createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt, hint: row.hint,
  };
}

export class TokenStore {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(db: Db, deps?: { now?: () => Date; newId?: () => string }) {
    this.#db = db;
    this.#now = deps?.now ?? (() => new Date());
    this.#newId = deps?.newId ?? (() => randomBytes(8).toString('base64url').slice(0, 10));
  }

  /**
   * A new token of `projectId`, made by `by`: the only time the token itself is returned. The caller checks that the
   * project exists (the foreign key rejects an unknown id). Throws `TokenLimitError` once the project has 20 tokens.
   */
  create(projectId: string, label: unknown, by: string): CreateTokenResult {
    return this.#db.tx(() => {
      if (this.#db.countTokens(projectId) >= MAX_TOKENS_PER_PROJECT) throw new TokenLimitError();
      const token = newToken();
      const row: TokenRow = {
        id: this.#newId(), projectId, hash: hashToken(token), hint: token.slice(0, 8), label: cleanLabel(label),
        createdAt: this.#now().toISOString(), createdBy: by, lastUsedAt: null,
      };
      this.#db.insertToken(row);
      return { token, tokenId: row.id, info: infoOf(row) };
    });
  }

  /** The project's tokens, oldest first. */
  list(projectId: string): TokenInfo[] {
    return this.#db.listTokens(projectId).map(infoOf);
  }

  /**
   * The token's info when `token` belongs to `projectId` and that project is not deleted, else null. Records the use
   * when none is recorded or the last one is at least TOUCH_INTERVAL_MS old; the answer carries the time now stored.
   */
  verify(token: string, projectId: string): TokenInfo | null {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
    const row = this.#db.tokenByHash(hashToken(token));
    if (row === undefined || row.projectId !== projectId) return null;
    const project = this.#db.getProject(projectId);
    if (project === undefined || project.deletedAt !== null) return null;
    const at = this.#now();
    if (row.lastUsedAt !== null && at.getTime() - Date.parse(row.lastUsedAt) < TOUCH_INTERVAL_MS) return infoOf(row);
    const lastUsedAt = at.toISOString();
    this.#db.touchToken(row.id, lastUsedAt);
    return infoOf({ ...row, lastUsedAt });
  }

  /** Deletes the token for good; false when project `projectId` has no token `tokenId`. */
  revoke(projectId: string, tokenId: string): boolean {
    return this.#db.deleteToken(projectId, tokenId);
  }
}
