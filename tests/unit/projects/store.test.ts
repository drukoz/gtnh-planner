import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, backupDaily, type Db } from '../../../src/server/db/db.ts';
import { ProjectStore, OpError } from '../../../src/server/projects/store.ts';

let dir: string; let db: Db; let store: ProjectStore; let t = 0;
const now = () => new Date(Date.UTC(2026, 9, 17, 12, 0, t++));
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gp-store-')); db = openDb(join(dir, 'planner.sqlite')); store = new ProjectStore(db, { now }); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('ProjectStore', () => {
  it('creates, lists (newest first) and gets projects', () => {
    const a = store.create('Steel line', 'Ann');
    const b = store.create('Circuits', 'Bob', { amount: 64, mode: 'makeN' });
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(b.settings.amount).toBe(64);
    expect(store.list().map((p) => p.name)).toEqual(['Circuits', 'Steel line']);
    expect(store.get(a.id)).toEqual(a);
    expect(store.get('missing')).toBeNull();
  });
  it('applies ops in arrival order and keeps every tick', () => {
    const p = store.create('Steel line', 'Ann');
    store.apply(p.id, [{ op: 'mark', row: 'run:a', on: true }], 'Ann');
    const r = store.apply(p.id, [{ op: 'mark', row: 'run:b', on: true }, { op: 'rename', name: 'Steel' }], 'Jörg 🙂');
    expect(r?.applied.map((x) => x.rev)).toEqual([2, 3]);
    const q = store.get(p.id)!;
    expect(q.rev).toBe(3);
    expect(Object.keys(q.marks).sort()).toEqual(['run:a', 'run:b']);
    expect(q.marks['run:b']?.by).toBe('Jörg 🙂');
    expect(db.countOps(p.id)).toBe(3);
  });
  it('rejects a batch with one bad op without writing anything', () => {
    const p = store.create('Steel line', 'Ann');
    expect(() => store.apply(p.id, [{ op: 'rename', name: 'ok' }, { op: 'settings', patch: { amount: -1 } }], 'Ann')).toThrow(OpError);
    expect(store.get(p.id)?.rev).toBe(0);
    expect(() => store.apply(p.id, [{ op: 'settings', patch: { mode: 'makeN' } }], 'Ann')).not.toThrow();   // amount 1 is an integer
    expect(() => store.apply(p.id, [{ op: 'settings', patch: { amount: 2.5 } }], 'Ann')).toThrow('integer');
  });
  it('returns null for an unknown project', () => {
    expect(store.apply('nope', [{ op: 'rename', name: 'x' }], 'Ann')).toBeNull();
  });
  it('survives closing and reopening the database', () => {
    const p = store.create('Steel line', 'Ann');
    store.apply(p.id, [{ op: 'addNote', note: { id: 'n1', text: 'tap power here' } }], 'Ann');
    db.close();
    db = openDb(join(dir, 'planner.sqlite'));
    expect(new ProjectStore(db).get(p.id)?.notes[0]?.text).toBe('tap power here');
  });
  it('fills settings added after a project was stored', () => {
    const p = store.create('Old', 'Ann');
    const row = db.getProject(p.id)!;
    const state = JSON.parse(row.state); delete state.settings.automateCrafting;
    db.updateProject({ ...row, state: JSON.stringify(state) });
    expect(store.get(p.id)?.settings.automateCrafting).toBe(false);
  });
});

describe('backupDaily', () => {
  it('writes one backup per day and keeps 7', async () => {
    store.create('Steel line', 'Ann');
    const out = join(dir, 'backups');
    for (let d = 1; d <= 9; d++) await backupDaily(db, out, new Date(Date.UTC(2026, 9, d)), 7);
    expect(await backupDaily(db, out, new Date(Date.UTC(2026, 9, 9)), 7)).toBeNull();
    expect(readdirSync(out).sort()).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => `planner-2026-10-0${d}.sqlite`));
    expect(existsSync(join(out, 'planner-2026-10-09.sqlite'))).toBe(true);
  });
});
