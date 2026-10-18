import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, PURGE_AFTER_MS, type Db } from '../../../src/server/db/db.ts';
import { ProjectStore } from '../../../src/server/projects/store.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Project } from '../../../src/shared/types/project.ts';

const DAY_MS = 24 * 3600 * 1000;
let dir: string; let file: string; let db: Db; let store: ProjectStore; let t = 0;
const now = () => new Date(Date.UTC(2026, 9, 18, 12, 0, t++));
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gp-delete-')); file = join(dir, 'planner.sqlite'); db = openDb(file); store = new ProjectStore(db, { now }); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

/** A project with a note and a tick (rev 2). */
function projectWithWork(name: string): Project {
  const p = store.create(name, 'Ann');
  store.apply(p.id, [{ op: 'addNote', note: { id: 'n1', text: 'tap power here' } }, { op: 'mark', row: 'run:a', on: true }], 'Ann');
  return store.get(p.id)!;
}

function schemaVersion(path: string): unknown {
  const raw = new DatabaseSync(path);
  try {
    return { ...(raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) };
  } finally {
    raw.close();
  }
}

describe('soft delete and restore', () => {
  it('hides a deleted project and restores it with the same rev, notes and marks', () => {
    const a = projectWithWork('MV circuits');
    const b = store.create('Steel line', 'Bob');
    const deleted = store.delete(a.id, 'Sam');
    expect(deleted).toMatchObject({ id: a.id, name: 'MV circuits', rev: 2, deletedBy: 'Sam' });
    expect(store.list().map((p) => p.id)).toEqual([b.id]);
    expect(store.get(a.id)).toBeNull();
    expect(store.apply(a.id, [{ op: 'rename', name: 'x' }], 'Ann')).toBeNull();
    expect(db.listDeletedProjects()).toEqual([expect.objectContaining({ id: a.id, name: 'MV circuits', rev: 2, deletedBy: 'Sam', deletedAt: deleted!.deletedAt })]);
    expect(store.listDeleted()).toEqual([deleted]);

    expect(store.restore(a.id)).toEqual(a);
    expect(store.get(a.id)).toEqual(a);
    expect(store.list().map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(db.listDeletedProjects()).toEqual([]);
    expect(db.countOps(a.id)).toBe(2);   // delete and restore are no ops: history and rev stay as they were
    expect(store.apply(a.id, [{ op: 'rename', name: 'MV' }], 'Ann')?.project.rev).toBe(3);
  });
  it('tells an unknown, a live and an already deleted project apart', () => {
    const p = store.create('Steel line', 'Ann');
    expect(store.delete('nope', 'Sam')).toBeNull();
    expect(store.restore('nope')).toBeNull();
    expect(store.restore(p.id)).toBe('not-deleted');
    const first = store.delete(p.id, 'Sam');
    expect(store.delete(p.id, 'Bob')).toBeNull();                       // a second delete does not restart the 7 days
    expect(store.listDeleted()).toEqual([first]);
    expect(db.softDeleteProject(p.id, 'Bob', new Date().toISOString())).toBe(false);
    expect(db.listDeletedProjects()[0]).toMatchObject({ deletedBy: 'Sam', deletedAt: first!.deletedAt });
    expect(db.restoreProject('nope')).toBeUndefined();
  });
  it('lists the newest deletion first', () => {
    const a = store.create('A', 'Ann'); const b = store.create('B', 'Ann'); const c = store.create('C', 'Ann');
    store.delete(b.id, 'Sam'); store.delete(a.id, 'Sam'); store.delete(c.id, 'Bob');
    expect(store.listDeleted().map((p) => p.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('purge', () => {
  it('removes projects deleted more than 7 days ago with their ops, and only those', () => {
    const at = new Date(Date.UTC(2026, 10, 1, 12));
    const old = projectWithWork('Old');
    const recent = projectWithWork('Recent');
    const live = projectWithWork('Live');
    expect(db.softDeleteProject(old.id, 'Sam', new Date(at.getTime() - 8 * DAY_MS).toISOString())).toBe(true);
    expect(db.softDeleteProject(recent.id, 'Sam', new Date(at.getTime() - 6 * DAY_MS).toISOString())).toBe(true);

    expect(db.purgeDeletedProjects(at, PURGE_AFTER_MS)).toBe(1);
    expect(db.getProject(old.id)).toBeUndefined();
    expect(db.countOps(old.id)).toBe(0);
    expect(db.listDeletedProjects().map((r) => r.id)).toEqual([recent.id]);
    expect(db.countOps(recent.id)).toBe(2);
    expect(store.get(live.id)).toEqual(live);
    expect(db.countOps(live.id)).toBe(2);
    expect(db.purgeDeletedProjects(at, PURGE_AFTER_MS)).toBe(0);
    expect(store.restore(old.id)).toBeNull();                            // purged: gone for good
  });
  it('never purges a live project, however long ago it changed', () => {
    const live = projectWithWork('Live');
    expect(db.purgeDeletedProjects(new Date(Date.UTC(2030, 0, 1)), PURGE_AFTER_MS)).toBe(0);
    expect(store.get(live.id)).toEqual(live);
  });
  it('keeps a project for exactly 7 days', () => {
    expect(PURGE_AFTER_MS).toBe(7 * 24 * 3600 * 1000);
    const p = store.create('Edge', 'Ann');
    const at = new Date(Date.UTC(2026, 10, 1, 12));
    db.softDeleteProject(p.id, 'Sam', new Date(at.getTime() - PURGE_AFTER_MS).toISOString());
    expect(db.purgeDeletedProjects(at, PURGE_AFTER_MS)).toBe(0);
    expect(db.purgeDeletedProjects(new Date(at.getTime() + 1), PURGE_AFTER_MS)).toBe(1);
  });
});

describe('schema versions', () => {
  it('migrates a database of the previous version in place and keeps its projects', () => {
    const v1 = join(dir, 'v1.sqlite');
    const project: Project = {
      id: 'old1', name: 'Old line', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'Ann', rev: 1, settings: defaultSettings(),
      world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [{ id: 'n1', text: 'kept', by: 'Ann', at: '2026-10-01T00:00:00.000Z' }],
    };
    const raw = new DatabaseSync(v1);
    raw.exec(`CREATE TABLE project(id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE project_op(project_id TEXT NOT NULL REFERENCES project(id), rev INTEGER NOT NULL, op TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project_id, rev));
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');`);
    raw.prepare('INSERT INTO project VALUES (?, ?, ?, ?, ?, ?)').run('old1', 'Old line', 1, JSON.stringify(project), project.createdAt, project.createdAt);
    raw.prepare('INSERT INTO project_op VALUES (?, ?, ?, ?, ?)').run('old1', 1, JSON.stringify({ op: 'addNote', note: { id: 'n1', text: 'kept' } }), 'Ann', project.createdAt);
    raw.close();

    const old = openDb(v1);
    try {
      const oldStore = new ProjectStore(old, { now });
      expect(oldStore.get('old1')).toEqual(project);
      expect(oldStore.list().map((p) => p.id)).toEqual(['old1']);
      expect(old.countOps('old1')).toBe(1);
      expect(oldStore.delete('old1', 'Sam')).toMatchObject({ id: 'old1', deletedBy: 'Sam' });
      expect(oldStore.restore('old1')).toEqual(project);
    } finally {
      old.close();
    }
    expect(schemaVersion(v1)).toEqual({ value: '2' });
    openDb(v1).close();                                                  // opening it again changes nothing
    expect(schemaVersion(v1)).toEqual({ value: '2' });
  });
  it('creates a new database at the newest version', () => {
    expect(schemaVersion(file)).toEqual({ value: '2' });
  });
  it('refuses a database written by a newer planner', () => {
    const newer = join(dir, 'newer.sqlite');
    const raw = new DatabaseSync(newer);
    raw.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '3');`);
    raw.close();
    expect(() => openDb(newer)).toThrow('planner.sqlite has schema 3; this planner knows up to 2 — update the planner');
    expect(schemaVersion(newer)).toEqual({ value: '3' });
  });
});
