// The only module that imports node:sqlite (web-stack §5). Rows leave this module as plain objects.

import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ProjectRow { id: string; name: string; rev: number; state: string; createdAt: string; updatedAt: string }

export interface Db {
  readonly file: string;
  tx<T>(fn: () => T): T;
  getProject(id: string): ProjectRow | undefined;
  listProjects(): ProjectRow[];
  insertProject(row: ProjectRow): void;
  updateProject(row: ProjectRow): void;
  appendOp(projectId: string, rev: number, op: string, by: string, at: string): void;
  countOps(projectId: string): number;
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

interface RawRow { id: string; name: string; rev: number; state: string; created_at: string; updated_at: string }

/** Rows from node:sqlite have a null prototype; spread them into plain objects (web-stack §5.2). */
function toRow(r: RawRow): ProjectRow {
  return { ...{ id: r.id, name: r.name, rev: Number(r.rev), state: r.state, createdAt: r.created_at, updatedAt: r.updated_at } };
}

export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const sql = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  sql.exec(SCHEMA);

  const getP = sql.prepare('SELECT * FROM project WHERE id = ?');
  const listP = sql.prepare('SELECT * FROM project ORDER BY updated_at DESC, id');
  const insertP = sql.prepare('INSERT INTO project (id, name, rev, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const updateP = sql.prepare('UPDATE project SET name = ?, rev = ?, state = ?, updated_at = ? WHERE id = ?');
  const opP = sql.prepare('INSERT INTO project_op (project_id, rev, op, by, at) VALUES (?, ?, ?, ?, ?)');
  const countP = sql.prepare('SELECT COUNT(*) AS n FROM project_op WHERE project_id = ?');
  let depth = 0;

  return {
    file,
    tx<T>(fn: () => T): T {
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
    },
    getProject(id) {
      const r = getP.get(id) as RawRow | undefined;
      return r ? toRow(r) : undefined;
    },
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
