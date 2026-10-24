// The only module that imports node:sqlite (web-stack §5). Rows leave this module as plain objects.

import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ProjectRow { id: string; name: string; rev: number; state: string; createdAt: string; updatedAt: string }
/** A row as stored: `deletedAt`/`deletedBy` (ISO time, display name) are set while the project is soft-deleted. */
export interface StoredProjectRow extends ProjectRow { deletedAt: string | null; deletedBy: string | null }
export interface DeletedProjectRow extends ProjectRow { deletedAt: string; deletedBy: string }
/** A projector token as stored (Plan 6): its sha256 `hash` and first 8 characters (`hint`), never the token itself. */
export interface TokenRow { id: string; projectId: string; hash: string; hint: string; label: string; createdAt: string; createdBy: string; lastUsedAt: string | null }

/** How long a deleted project stays restorable before `purgeDeletedProjects` removes it for good (spec §3.11). */
export const PURGE_AFTER_MS = 7 * 24 * 3600 * 1000;

export interface Db {
  readonly file: string;
  tx<T>(fn: () => T): T;
  /** Live or soft-deleted; whether a deleted project counts as there is the store's call. */
  getProject(id: string): StoredProjectRow | undefined;
  /** The live projects, most recently changed first. */
  listProjects(): StoredProjectRow[];
  insertProject(row: ProjectRow): void;
  updateProject(row: ProjectRow): void;
  appendOp(projectId: string, rev: number, op: string, by: string, at: string): void;
  countOps(projectId: string): number;
  /** Marks a live project deleted by `by` at `at`; false when there is no live project `id` (the first deletion stands). */
  softDeleteProject(id: string, by: string, at: string): boolean;
  /** Clears the deletion marks and returns the row; undefined when no soft-deleted project has this id. */
  restoreProject(id: string): StoredProjectRow | undefined;
  /** The soft-deleted projects, newest deletion first. */
  listDeletedProjects(): DeletedProjectRow[];
  /** Removes, with their ops and projector tokens, the projects deleted more than `olderThanMs` before `now`; returns how many. */
  purgeDeletedProjects(now: Date, olderThanMs: number): number;
  insertToken(row: TokenRow): void;
  /** Oldest first; tokens made in the same millisecond in the order they were made. */
  listTokens(projectId: string): TokenRow[];
  tokenByHash(hash: string): TokenRow | undefined;
  /** True when project `projectId` had the token `id`, now deleted. */
  deleteToken(projectId: string, id: string): boolean;
  /** Sets the token's `last_used_at`. */
  touchToken(id: string, at: string): void;
  countTokens(projectId: string): number;
  // Add-on 17 (architecture §11.45 (4)): the `meta` table's other rows, such as the published surplus summaries
  // (`surplus:<project id>`), with no schema change; `schema_version` stays the migrations' alone.
  /** The value stored under `key`; undefined when there is none. */
  getMeta(key: string): string | undefined;
  /** Stores `value` under `key`, replacing what was there. */
  setMeta(key: string, value: string): void;
  /** True when there was a row under `key` and it is gone now. */
  deleteMeta(key: string): boolean;
  /** Every row whose key starts with `prefix`, by key. */
  listMeta(prefix: string): Array<{ key: string; value: string }>;
  backup(toFile: string): Promise<void>;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, state TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_op (
  project_id TEXT NOT NULL REFERENCES project(id), rev INTEGER NOT NULL, op TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (project_id, rev)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

/**
 * The steps from one schema version to the next, in order; `openDb` runs each one the file has not had yet, in one
 * transaction with the version bump, so a file of any earlier version keeps its rows. Append only.
 */
const MIGRATIONS: ReadonlyArray<{ to: number; sql: string }> = [
  // Soft delete (spec §3.11, architecture §11.24): set while a project waits in "Recently deleted".
  { to: 2, sql: 'ALTER TABLE project ADD COLUMN deleted_at TEXT NULL; ALTER TABLE project ADD COLUMN deleted_by TEXT NULL;' },
  // Projector tokens (spec §3.13, architecture §11.23; schema 3 since §11.24 took 2): a token's hash, never the token.
  {
    to: 3,
    sql: `CREATE TABLE project_token(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), hash TEXT NOT NULL UNIQUE,
            hint TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, last_used_at TEXT);
          CREATE INDEX project_token_project ON project_token(project_id);`,
  },
];
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.to;

function schemaVersionOf(sql: DatabaseSync): number {
  const row = sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return Number(row?.value ?? 1);
}

/** Brings the file from its stored version up to SCHEMA_VERSION; throws for a file a newer planner wrote. */
function migrate(sql: DatabaseSync): void {
  const stored = schemaVersionOf(sql);
  if (stored > SCHEMA_VERSION) {
    throw new Error(`planner.sqlite has schema ${stored}; this planner knows up to ${SCHEMA_VERSION} — update the planner`);
  }
  for (const step of MIGRATIONS) {
    if (stored >= step.to) continue;
    sql.exec('BEGIN IMMEDIATE');
    try {
      if (schemaVersionOf(sql) < step.to) {   // read again under the lock: another process may have migrated meanwhile
        sql.exec(step.sql);
        sql.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(step.to));
      }
      sql.exec('COMMIT');
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  }
}

interface RawRow {
  id: string; name: string; rev: number; state: string; created_at: string; updated_at: string;
  deleted_at: string | null; deleted_by: string | null;
}

/** Rows from node:sqlite have a null prototype; copy them into plain objects (web-stack §5.2). */
function toRow(r: RawRow): StoredProjectRow {
  return {
    id: r.id, name: r.name, rev: Number(r.rev), state: r.state, createdAt: r.created_at, updatedAt: r.updated_at,
    deletedAt: r.deleted_at, deletedBy: r.deleted_by,
  };
}

/** For rows of a `deleted_at IS NOT NULL` query. */
function toDeletedRow(r: RawRow): DeletedProjectRow {
  return { ...toRow(r), deletedAt: r.deleted_at ?? '', deletedBy: r.deleted_by ?? '' };
}

interface RawTokenRow {
  id: string; project_id: string; hash: string; hint: string; label: string; created_at: string; created_by: string;
  last_used_at: string | null;
}

function toTokenRow(r: RawTokenRow): TokenRow {
  return {
    id: r.id, projectId: r.project_id, hash: r.hash, hint: r.hint, label: r.label, createdAt: r.created_at,
    createdBy: r.created_by, lastUsedAt: r.last_used_at,
  };
}

export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const sql = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
  try {
    sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    sql.exec(SCHEMA);
    migrate(sql);
  } catch (e) {
    sql.close();
    throw e;
  }

  const getP = sql.prepare('SELECT * FROM project WHERE id = ?');
  const listP = sql.prepare('SELECT * FROM project WHERE deleted_at IS NULL ORDER BY updated_at DESC, id');
  const insertP = sql.prepare('INSERT INTO project (id, name, rev, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const updateP = sql.prepare('UPDATE project SET name = ?, rev = ?, state = ?, updated_at = ? WHERE id = ?');
  const opP = sql.prepare('INSERT INTO project_op (project_id, rev, op, by, at) VALUES (?, ?, ?, ?, ?)');
  const countP = sql.prepare('SELECT COUNT(*) AS n FROM project_op WHERE project_id = ?');
  const softDeleteP = sql.prepare('UPDATE project SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL');
  const restoreP = sql.prepare('UPDATE project SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL');
  const listDeletedP = sql.prepare('SELECT * FROM project WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id');
  // Every table that references a project loses its rows first (foreign keys are enforced, without ON DELETE CASCADE).
  const purgeTokensP = sql.prepare('DELETE FROM project_token WHERE project_id IN (SELECT id FROM project WHERE deleted_at IS NOT NULL AND deleted_at < ?)');
  const purgeOpsP = sql.prepare('DELETE FROM project_op WHERE project_id IN (SELECT id FROM project WHERE deleted_at IS NOT NULL AND deleted_at < ?)');
  const purgeP = sql.prepare('DELETE FROM project WHERE deleted_at IS NOT NULL AND deleted_at < ?');
  const insertTokenP = sql.prepare(
    'INSERT INTO project_token (id, project_id, hash, hint, label, created_at, created_by, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const listTokensP = sql.prepare('SELECT * FROM project_token WHERE project_id = ? ORDER BY created_at, rowid');
  const tokenByHashP = sql.prepare('SELECT * FROM project_token WHERE hash = ?');
  const deleteTokenP = sql.prepare('DELETE FROM project_token WHERE project_id = ? AND id = ?');
  const touchTokenP = sql.prepare('UPDATE project_token SET last_used_at = ? WHERE id = ?');
  const countTokensP = sql.prepare('SELECT COUNT(*) AS n FROM project_token WHERE project_id = ?');
  const getMetaP = sql.prepare('SELECT value FROM meta WHERE key = ?');
  const setMetaP = sql.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  const deleteMetaP = sql.prepare('DELETE FROM meta WHERE key = ?');
  // a prefix match by characters, as SQLite counts them, with no LIKE wildcards to escape
  const listMetaP = sql.prepare('SELECT key, value FROM meta WHERE substr(key, 1, length(?)) = ? ORDER BY key');
  let depth = 0;

  function tx<T>(fn: () => T): T {
    if (depth > 0) return fn();
    sql.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const result = fn();
      sql.exec('COMMIT');
      return result;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  }

  function getProject(id: string): StoredProjectRow | undefined {
    const r = getP.get(id) as RawRow | undefined;
    return r ? toRow(r) : undefined;
  }

  return {
    file,
    tx,
    getProject,
    listProjects() {
      return (listP.all() as unknown as RawRow[]).map(toRow);
    },
    insertProject(r) {
      insertP.run(r.id, r.name, r.rev, r.state, r.createdAt, r.updatedAt);
    },
    updateProject(r) {
      updateP.run(r.name, r.rev, r.state, r.updatedAt, r.id);
    },
    appendOp(projectId, rev, op, by, at) {
      opP.run(projectId, rev, op, by, at);
    },
    countOps(projectId) {
      return Number((countP.get(projectId) as { n: number | bigint }).n);
    },
    softDeleteProject(id, by, at) {
      return Number(softDeleteP.run(at, by, id).changes) > 0;
    },
    restoreProject(id) {
      return tx(() => (Number(restoreP.run(id).changes) > 0 ? getProject(id) : undefined));
    },
    listDeletedProjects() {
      return (listDeletedP.all() as unknown as RawRow[]).map(toDeletedRow);
    },
    purgeDeletedProjects(now, olderThanMs) {
      // ISO times of one format compare as strings.
      const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
      return tx(() => {
        purgeTokensP.run(cutoff);
        purgeOpsP.run(cutoff);
        return Number(purgeP.run(cutoff).changes);
      });
    },
    insertToken(r) {
      insertTokenP.run(r.id, r.projectId, r.hash, r.hint, r.label, r.createdAt, r.createdBy, r.lastUsedAt);
    },
    listTokens(projectId) {
      return (listTokensP.all(projectId) as unknown as RawTokenRow[]).map(toTokenRow);
    },
    tokenByHash(hash) {
      const r = tokenByHashP.get(hash) as RawTokenRow | undefined;
      return r ? toTokenRow(r) : undefined;
    },
    deleteToken(projectId, id) {
      return Number(deleteTokenP.run(projectId, id).changes) > 0;
    },
    touchToken(id, at) {
      touchTokenP.run(at, id);
    },
    countTokens(projectId) {
      return Number((countTokensP.get(projectId) as { n: number | bigint }).n);
    },
    getMeta(key) {
      const r = getMetaP.get(key) as { value: string } | undefined;
      return r === undefined ? undefined : String(r.value);
    },
    setMeta(key, value) {
      setMetaP.run(key, value);
    },
    deleteMeta(key) {
      return Number(deleteMetaP.run(key).changes) > 0;
    },
    listMeta(prefix) {
      return (listMetaP.all(prefix, prefix) as Array<{ key: string; value: string }>).map((r) => ({ key: String(r.key), value: String(r.value) }));
    },
    async backup(toFile) {
      mkdirSync(dirname(toFile), { recursive: true });
      await sqliteBackup(sql, toFile);
    },
    close() {
      sql.close();
    },
  };
}

const BACKUP_NAME = /^planner-\d{4}-\d{2}-\d{2}\.sqlite$/;

/** One backup per UTC day (`planner-YYYY-MM-DD.sqlite`), newest `keep` kept. Returns the path written, or null. */
export async function backupDaily(db: Db, dir: string, now: Date, keep = 7): Promise<string | null> {
  const target = join(dir, `planner-${now.toISOString().slice(0, 10)}.sqlite`);
  if (existsSync(target)) return null;
  await db.backup(target);
  const old = readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) rmSync(join(dir, f), { force: true });
  return target;
}
