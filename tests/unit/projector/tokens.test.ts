import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, PURGE_AFTER_MS, type Db } from '../../../src/server/db/db.ts';
import { ProjectStore } from '../../../src/server/projects/store.ts';
import { TokenStore, TokenLimitError, newToken, hashToken, cleanLabel } from '../../../src/server/projector/tokens.ts';

let dir: string; let db: Db; let pid: string; let other: string; let clock: number;
const now = () => new Date(clock);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gp-tokens-'));
  db = openDb(join(dir, 'planner.sqlite'));
  const projects = new ProjectStore(db);
  pid = projects.create('Steel line', 'Ann').id;
  other = projects.create('Circuits', 'Ann').id;
  clock = Date.UTC(2026, 9, 18, 12, 0, 0);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('projector tokens', () => {
  it('makes 256-bit tokens and hashes them with sha256', () => {
    const t = newToken();
    expect(t).toMatch(/^gpt_[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken('gpt_x')).toBe(createHash('sha256').update('gpt_x').digest('hex'));
    expect([cleanLabel('  Steve '), cleanLabel(''), cleanLabel(42), cleanLabel('x'.repeat(50)).length]).toEqual(['Steve', 'Projector token', 'Projector token', 40]);
  });

  it('shows a new token once and stores only its hash and hint', () => {
    const store = new TokenStore(db, { now });
    const r = store.create(pid, 'Steve', 'Ann');
    expect(r.tokenId).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(r.info).toEqual({ tokenId: r.tokenId, projectId: pid, label: 'Steve', createdAt: '2026-10-18T12:00:00.000Z', createdBy: 'Ann', lastUsedAt: null, hint: r.token.slice(0, 8) });
    const rows = db.listTokens(pid);
    expect(rows.map((x) => x.hash)).toEqual([hashToken(r.token)]);
    expect(JSON.stringify(rows)).not.toContain(r.token);
    expect(store.list(pid)).toEqual([r.info]);
    expect(JSON.stringify(store.list(pid))).not.toContain(hashToken(r.token));
  });

  it('verifies a token only for its own project and records use at most once a minute', () => {
    const store = new TokenStore(db, { now });
    const { token, tokenId } = store.create(pid, 'Steve', 'Ann');
    clock += 1_000;
    expect(store.verify(token, pid)).toMatchObject({ tokenId, lastUsedAt: '2026-10-18T12:00:01.000Z' });
    clock += 30_000;
    expect(store.verify(token, pid)?.lastUsedAt).toBe('2026-10-18T12:00:01.000Z');
    clock += 31_000;
    expect(store.verify(token, pid)?.lastUsedAt).toBe('2026-10-18T12:01:02.000Z');
    expect(store.verify(token, other)).toBeNull();
    expect(store.verify(`${token}x`, pid)).toBeNull();
    expect(store.verify('not-a-token', pid)).toBeNull();
    expect(store.verify(`gpt_${'a'.repeat(200)}`, pid)).toBeNull();
  });

  it('revokes a token for good, and only through its own project', () => {
    const store = new TokenStore(db, { now });
    const { token, tokenId } = store.create(pid, 'Steve', 'Ann');
    expect(store.revoke(other, tokenId)).toBe(false);
    expect(store.verify(token, pid)).not.toBeNull();
    expect(store.revoke(pid, tokenId)).toBe(true);
    expect(store.revoke(pid, tokenId)).toBe(false);
    expect(store.verify(token, pid)).toBeNull();
    expect(store.list(pid)).toEqual([]);
  });

  it('allows at most 20 tokens per project', () => {
    const store = new TokenStore(db, { now });
    for (let i = 0; i < 20; i++) store.create(pid, `p${i}`, 'Ann');
    expect(() => store.create(pid, 'one more', 'Ann')).toThrow(TokenLimitError);
    expect(() => store.create(pid, 'one more', 'Ann')).toThrow('A project can have at most 20 projector tokens — revoke one first');
    expect(db.countTokens(pid)).toBe(20);
    expect(store.create(other, 'fine', 'Ann').info.projectId).toBe(other);
    expect(store.list(pid).map((t) => t.label).slice(0, 2)).toEqual(['p0', 'p1']);
  });

  it("refuses a deleted project's tokens until it is restored, and purging the project deletes them", () => {
    const projects = new ProjectStore(db, { now });
    const store = new TokenStore(db, { now });
    const { token, tokenId } = store.create(pid, 'Steve', 'Ann');
    const kept = store.create(other, 'Alex', 'Ann');
    expect(projects.delete(pid, 'Sam')).not.toBeNull();
    clock += 1_000;
    expect(store.verify(token, pid)).toBeNull();
    expect(db.listTokens(pid).map((t) => t.lastUsedAt)).toEqual([null]);       // refused without recording a use
    expect(projects.restore(pid)).toMatchObject({ id: pid });
    expect(store.verify(token, pid)).toMatchObject({ tokenId, lastUsedAt: '2026-10-18T12:00:01.000Z' });

    expect(projects.delete(pid, 'Sam')).not.toBeNull();
    expect(db.purgeDeletedProjects(new Date(clock + PURGE_AFTER_MS), PURGE_AFTER_MS)).toBe(0);   // still restorable
    expect(db.listTokens(pid).map((t) => t.id)).toEqual([tokenId]);
    expect(db.purgeDeletedProjects(new Date(clock + PURGE_AFTER_MS + 1), PURGE_AFTER_MS)).toBe(1);
    expect(db.listTokens(pid)).toEqual([]);
    expect(store.verify(token, pid)).toBeNull();
    expect(store.list(other).map((t) => t.tokenId)).toEqual([kept.tokenId]);
  });

  it('upgrades a version-1 database in place', () => {
    const file = join(dir, 'v1.sqlite');
    const raw = new DatabaseSync(file);
    raw.exec(`CREATE TABLE project(id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE project_op(project_id TEXT NOT NULL REFERENCES project(id), rev INTEGER NOT NULL, op TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project_id, rev));
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');`);
    raw.close();
    const old = openDb(file);
    const p = new ProjectStore(old).create('Old', 'Ann');
    expect(new TokenStore(old, { now }).create(p.id, 'Steve', 'Ann').info.projectId).toBe(p.id);
    old.close();
    const check = new DatabaseSync(file);
    expect({ ...(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }).toEqual({ value: '3' });
    check.close();
  });

  it('upgrades a version-2 database in place', () => {
    const file = join(dir, 'v2.sqlite');
    const raw = new DatabaseSync(file);
    raw.exec(`CREATE TABLE project(id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT NULL, deleted_by TEXT NULL);
      CREATE TABLE project_op(project_id TEXT NOT NULL REFERENCES project(id), rev INTEGER NOT NULL, op TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project_id, rev));
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '2');`);
    raw.close();
    const old = openDb(file);
    const p = new ProjectStore(old).create('Old', 'Ann');
    expect(new TokenStore(old, { now }).create(p.id, 'Steve', 'Ann').info.projectId).toBe(p.id);
    old.close();
    const check = new DatabaseSync(file);
    expect({ ...(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }).toEqual({ value: '3' });
    check.close();
  });
});
