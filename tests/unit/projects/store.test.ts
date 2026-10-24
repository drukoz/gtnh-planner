import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, backupDaily, type Db } from '../../../src/server/db/db.ts';
import { ProjectStore, OpError, PLANNER_UPDATE } from '../../../src/server/projects/store.ts';

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
    // The Auto Workbench (plan 12's ruling) for the missing field; and since the user's ruling 180 (crafting steps are
    // automatic, no checkbox) a stored "by hand" reads as automated too, with no recorded change.
    expect(store.get(p.id)?.settings.automateCrafting).toBe(true);
    const byHand = store.create('By hand', 'Ann');
    const stored = db.getProject(byHand.id)!;
    const hand = JSON.parse(stored.state); hand.settings.automateCrafting = false;
    db.updateProject({ ...stored, state: JSON.stringify(hand) });
    expect(store.get(byHand.id)?.settings.automateCrafting).toBe(true);
    expect(store.get(byHand.id)?.rev).toBe(stored.rev);
  });
});

// Controller ruling 3 (ruling P10): projects stored before supporting lines were the default are switched to them once.
describe('ProjectStore.migrateSettings', () => {
  /** A project as plan 09 found it: no settings version, and the old default routeDerived false. */
  function storedBeforePlan09(name: string): string {
    const p = store.create(name, 'Ann');
    const row = db.getProject(p.id)!;
    const state = JSON.parse(row.state);
    delete state.settings.settingsVersion;
    state.settings.routeDerived = false;
    db.updateProject({ ...row, state: JSON.stringify(state) });
    return p.id;
  }
  /** The ops recorded for `id`, read straight from the database file. */
  function opsOf(id: string): Array<{ rev: number; op: unknown; by: string }> {
    const sql = new DatabaseSync(db.file, { readOnly: true });
    try {
      const rows = sql.prepare('SELECT rev, op, by FROM project_op WHERE project_id = ? ORDER BY rev').all(id) as Array<{ rev: number; op: string; by: string }>;
      return rows.map((r) => ({ rev: Number(r.rev), op: JSON.parse(r.op), by: r.by }));
    } finally {
      sql.close();
    }
  }
  /** A project as plan 12's fix wave 2 found it: settings version 2 and the step charge `stepCharge` stored. */
  function storedAtVersion2(name: string, stepCharge: number): string {
    const p = store.create(name, 'Ann');
    const row = db.getProject(p.id)!;
    const state = JSON.parse(row.state);
    state.settings.settingsVersion = 2;
    state.settings.stepCharge = stepCharge;
    db.updateProject({ ...row, state: JSON.stringify(state) });
    return p.id;
  }
  it('switches an old project to supporting lines once, as a recorded settings op by the planner', () => {
    const id = storedBeforePlan09('Old');
    expect(store.get(id)?.settings).toMatchObject({ routeDerived: false, settingsVersion: 1 });
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([id]);
    expect(store.get(id)).toMatchObject({ rev: 1, settings: { routeDerived: true, rawCap: 0.25, settingsVersion: 4 } });
    expect(opsOf(id)).toEqual([{ rev: 1, op: { op: 'settings', patch: { routeDerived: true, rawCap: 0.25, settingsVersion: 4 } }, by: 'Planner update' }]);
    // Run again (the next start): nothing left to switch.
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([]);
    expect(store.get(id)?.rev).toBe(1);
    expect(db.countOps(id)).toBe(1);
  });
  it('never touches a project whose settings are of this version, so a later "off" sticks', () => {
    const p = store.create('New', 'Ann', { routeDerived: false });
    const migratedOld = storedBeforePlan09('Old');
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([migratedOld]);
    expect(store.get(p.id)).toMatchObject({ rev: 0, settings: { routeDerived: false, settingsVersion: 4 } });
    expect(db.countOps(p.id)).toBe(0);
  });
  // Plan 12 fix wave 2 (the user's answer of 2026-10-20): "Fewest machines" (0.5) is the default, and a project still at
  // the old default of exactly 0.02 is switched to it once; any other stored value stays.
  it('switches a project still at the old 2 % step charge to Fewest machines once, and leaves any other value', () => {
    const old = storedAtVersion2('Old default', 0.02);
    const kept = new Map([0, 0.05, 0.15, 0.5].map((charge) => [storedAtVersion2(`Chose ${charge}`, charge), charge]));
    expect(store.get(old)?.settings).toMatchObject({ stepCharge: 0.02, settingsVersion: 2 });
    expect(store.migrateSettings(PLANNER_UPDATE).sort()).toEqual([old, ...kept.keys()].sort());
    expect(store.get(old)).toMatchObject({ rev: 1, settings: { stepCharge: 0.5, routeDerived: true, rawCap: 0.25, settingsVersion: 4 } });
    expect(opsOf(old)).toEqual([{ rev: 1, op: { op: 'settings', patch: { stepCharge: 0.5, rawCap: 0.25, settingsVersion: 4 } }, by: 'Planner update' }]);
    for (const [id, charge] of kept) {
      expect(store.get(id)).toMatchObject({ rev: 1, settings: { stepCharge: charge, rawCap: 0.25, settingsVersion: 4 } });
      expect(opsOf(id)).toEqual([{ rev: 1, op: { op: 'settings', patch: { rawCap: 0.25, settingsVersion: 4 } }, by: 'Planner update' }]);
    }
    // Idempotent: the next start changes nothing, and a later deliberate 2 % ("Some machines") sticks.
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([]);
    store.apply(old, [{ op: 'settings', patch: { stepCharge: 0.02 } }], 'Ann');
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([]);
    expect(store.get(old)).toMatchObject({ rev: 2, settings: { stepCharge: 0.02, settingsVersion: 4 } });
    expect(db.countOps(old)).toBe(2);
  });
  // Fix wave 3 (A), the user's answer of 2026-10-22: the raw cap at +25 % for every project stored before it, once; a
  // project at version 3 keeps a deliberate 2 % step charge, and a later "No limit" sticks.
  it('gives a project stored before the raw cap its default once, and keeps what is chosen after', () => {
    const p = store.create('At 3', 'Ann');
    const row = db.getProject(p.id)!;
    const state = JSON.parse(row.state);
    state.settings.settingsVersion = 3;
    state.settings.stepCharge = 0.02;
    delete state.settings.rawCap;
    db.updateProject({ ...row, state: JSON.stringify(state) });
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([p.id]);
    expect(store.get(p.id)).toMatchObject({ rev: 1, settings: { stepCharge: 0.02, rawCap: 0.25, settingsVersion: 4 } });
    expect(opsOf(p.id)).toEqual([{ rev: 1, op: { op: 'settings', patch: { rawCap: 0.25, settingsVersion: 4 } }, by: 'Planner update' }]);
    store.apply(p.id, [{ op: 'settings', patch: { rawCap: null } }], 'Ann');
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([]);
    expect(store.get(p.id)).toMatchObject({ rev: 2, settings: { rawCap: null, settingsVersion: 4 } });
  });
  it('leaves deleted projects for the start after they are restored', () => {
    const id = storedBeforePlan09('Old');
    store.delete(id, 'Ann');
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([]);
    store.restore(id);
    expect(store.get(id)?.settings.routeDerived).toBe(false);
    expect(store.migrateSettings(PLANNER_UPDATE)).toEqual([id]);
    expect(store.get(id)?.settings.routeDerived).toBe(true);
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
