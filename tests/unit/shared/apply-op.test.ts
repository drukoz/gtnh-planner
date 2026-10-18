import { describe, it, expect } from 'vitest';
import { applyOp, defaultSettings, normalizeSettings, validateOp } from '../../../src/shared/project/apply-op.ts';
import type { Project } from '../../../src/shared/types/project.ts';

const AT = '2026-10-17T12:00:00.000Z';
function project(): Project {
  return Object.freeze({ id: 'p1', name: 'Steel', createdAt: AT, createdBy: 'Ann', rev: 3, settings: defaultSettings(),
    world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] }) as Project;
}

describe('applyOp', () => {
  it('returns a new project with rev + 1 and never mutates the input', () => {
    const p = project();
    const q = applyOp(p, { op: 'rename', name: '  Steel line ' }, 'Bob', AT);
    expect(q).not.toBe(p);
    expect(q.rev).toBe(4);
    expect(q.name).toBe('Steel line');
    expect(p.name).toBe('Steel');
  });
  it('settings replaces only the patched fields', () => {
    const q = applyOp(project(), { op: 'settings', patch: { amount: 30, per: 'hour', costOverrides: { Silver: 5 } } }, 'Bob', AT);
    expect(q.settings.amount).toBe(30);
    expect(q.settings.per).toBe('hour');
    expect(q.settings.costOverrides).toEqual({ Silver: 5 });
    expect(q.settings.logistics).toBe('direct');
  });
  it('mark on records who and when; mark off removes it', () => {
    const on = applyOp(project(), { op: 'mark', row: 'run:fluid:water', on: true }, 'Jörg 🙂', AT);
    expect(on.marks['run:fluid:water']).toEqual({ by: 'Jörg 🙂', at: AT });
    const off = applyOp(on, { op: 'mark', row: 'run:fluid:water', on: false }, 'Ann', AT);
    expect(off.marks['run:fluid:water']).toBeUndefined();
  });
  it('addNote is idempotent per id; edit and delete work; unknown ids only bump rev', () => {
    const a = applyOp(project(), { op: 'addNote', note: { id: 'n1', text: 'tap power here' } }, 'Ann', AT);
    const b = applyOp(a, { op: 'addNote', note: { id: 'n1', text: 'tap power here' } }, 'Ann', AT);
    expect(b.notes).toHaveLength(1);
    expect(b.notes[0]).toEqual({ id: 'n1', text: 'tap power here', by: 'Ann', at: AT });
    const c = applyOp(b, { op: 'editNote', id: 'n1', text: 'tap MV power here' }, 'Bob', AT);
    expect(c.notes[0]?.text).toBe('tap MV power here');
    const d = applyOp(c, { op: 'deleteNote', id: 'nope' }, 'Bob', AT);
    expect(d.notes).toHaveLength(1);
    expect(d.rev).toBe(c.rev + 1);
    expect(applyOp(d, { op: 'deleteNote', id: 'n1' }, 'Bob', AT).notes).toEqual([]);
  });
  it('world, placement and clearPlacement', () => {
    const w = applyOp(project(), { op: 'world', scanId: 's1', baseId: 'b2' }, 'Ann', AT);
    expect(w.world).toEqual({ scanId: 's1', baseId: 'b2' });
    const pl = applyOp(w, { op: 'placement', origin: [1, 64, -3], rotation: 90 }, 'Ann', AT);
    expect(pl.placement).toEqual({ origin: [1, 64, -3], rotation: 90 });
    expect(applyOp(pl, { op: 'clearPlacement' }, 'Ann', AT).placement).toBeNull();
  });
});

describe('defaultSettings / normalizeSettings', () => {
  it('has the decided defaults', () => {
    const s = defaultSettings();
    expect(s).toMatchObject({ target: null, mode: 'rate', amount: 1, per: 'min', tier: null, routeDerived: false,
      logistics: 'direct', coilHeat: null, automateCrafting: false, dims: { policy: 'progression', overrides: {} } });
    expect(s.excludedCategories).toEqual(['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion']);
    expect(s.declineReuse).toEqual([]);
  });
  it('fills fields missing from an older stored project', () => {
    const s = normalizeSettings({ target: 'fluid:steam', amount: 5 } as never);
    expect(s.target).toBe('fluid:steam');
    expect(s.stopItems).toEqual([]);
    expect(s.declineReuse).toEqual([]);
    expect(s.dims).toEqual({ policy: 'progression', overrides: {} });
  });
});

describe('validateOp', () => {
  it.each([
    [{ op: 'settings', patch: { amount: 0 } }],
    [{ op: 'settings', patch: { amount: -5 } }],
    [{ op: 'settings', patch: { amount: Number.NaN } }],
    [{ op: 'settings', patch: { amount: 1e10 } }],
    [{ op: 'settings', patch: { mode: 'makeN', amount: 2.5 } }],
    [{ op: 'settings', patch: { tier: 15 } }],
    [{ op: 'settings', patch: { costOverrides: { Silver: -1 } } }],
    [{ op: 'settings', patch: { bogus: 1 } }],
    [{ op: 'settings', patch: { declineReuse: ['121'] } }],
    [{ op: 'settings', patch: { declineReuse: [1.5] } }],
    [{ op: 'mark', row: 'foo', on: true }],
    [{ op: 'addNote', note: { id: 'n', text: 'x'.repeat(4001) } }],
    [{ op: 'rename', name: '   ' }],
    [{ op: 'explode' }],
  ])('rejects %j', (op) => {
    expect(validateOp(op)).toEqual(expect.any(String));
  });
  it('accepts a normal settings patch and a tick', () => {
    expect(validateOp({ op: 'settings', patch: { mode: 'makeN', amount: 64, tier: 2 } })).toBeNull();
    expect(validateOp({ op: 'settings', patch: { declineReuse: [121, 1000] } })).toBeNull();
    expect(validateOp({ op: 'mark', row: 'build:gregtech:gt.metaitem.01@2032', on: true })).toBeNull();
  });
});

// Rules of the Task 1 brief and ruling R10 that the cases above do not reach.
function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) { Object.values(v).forEach(deepFreeze); Object.freeze(v); }
  return v;
}

describe('applyOp (more)', () => {
  it('never mutates nested state of the input', () => {
    const p = deepFreeze(applyOp(project(), { op: 'addNote', note: { id: 'n1', text: 'a' } }, 'Ann', AT));
    expect(() => {
      applyOp(p, { op: 'mark', row: 'build:t:x@0', on: true }, 'Ann', AT);
      applyOp(p, { op: 'settings', patch: { stopItems: ['t:x@0'], dims: { policy: 'visited', overrides: {} } } }, 'Ann', AT);
      applyOp(p, { op: 'addNote', note: { id: 'n2', text: 'b' } }, 'Ann', AT);
      applyOp(p, { op: 'editNote', id: 'n1', text: 'c' }, 'Ann', AT);
      applyOp(p, { op: 'deleteNote', id: 'n1' }, 'Ann', AT);
    }).not.toThrow();
    expect(p.notes).toEqual([{ id: 'n1', text: 'a', by: 'Ann', at: AT }]);
  });
  it('a retried addNote replaces text and pin, keeping author and time', () => {
    const a = applyOp(project(), { op: 'addNote', note: { id: 'n1', text: 'here', pin: { dim: 0, x: 1, y: 64, z: 2 } } }, 'Ann', AT);
    const b = applyOp(a, { op: 'addNote', note: { id: 'n1', text: 'there' } }, 'Bob', '2026-10-17T13:00:00.000Z');
    expect(b.notes).toEqual([{ id: 'n1', text: 'there', by: 'Ann', at: AT }]);
  });
  it('throws on an op it does not know', () => {
    expect(() => applyOp(project(), { op: 'explode' } as never, 'Ann', AT)).toThrow(TypeError);
  });
});

describe('normalizeSettings (more)', () => {
  it('fills a partial dims and an absent settings object', () => {
    expect(normalizeSettings({ dims: { policy: 'visited' } } as never).dims).toEqual({ policy: 'visited', overrides: {} });
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
  });
});

describe('validateOp (more)', () => {
  it.each([
    [null], ['rename'], [{ op: 'settings', patch: null }],
    [{ op: 'settings', patch: { target: '' } }],
    [{ op: 'settings', patch: { per: 'day' } }],
    [{ op: 'settings', patch: { logistics: 'teleport' } }],
    [{ op: 'settings', patch: { dims: { policy: 'visited', overrides: { moon: 'maybe' } } } }],
    [{ op: 'settings', patch: { dims: { policy: 'visited' } } }],
    [{ op: 'settings', patch: { routeDerived: 'yes' } }],
    [{ op: 'settings', patch: { stopItems: [1] } }],
    [{ op: 'settings', patch: { recipeChoice: { 't:x@0': '' } } }],
    [{ op: 'settings', patch: { machineTier: { r1: 15 } } }],
    [{ op: 'settings', patch: { coilHeat: 100001 } }],
    [{ op: 'rename', name: 'x'.repeat(81) }],
    [{ op: 'mark', row: 'run:x', on: 'yes' }],
    [{ op: 'addNote', note: { id: '', text: 'x' } }],
    [{ op: 'addNote', note: { id: 'n', text: 'x', pin: { dim: 0, x: 1.5, y: 64, z: 0 } } }],
    [{ op: 'editNote', id: 'n', text: '' }],
    [{ op: 'deleteNote', id: 'x'.repeat(65) }],
    [{ op: 'world', scanId: 'x'.repeat(101), baseId: null }],
    [{ op: 'placement', origin: [0, 64], rotation: 0 }],
    [{ op: 'placement', origin: [0, 64, 0], rotation: 45 }],
  ])('rejects %j', (op) => {
    expect(validateOp(op)).toEqual(expect.any(String));
  });
  it.each([
    [{ op: 'settings', patch: defaultSettings() }],
    [{ op: 'settings', patch: { amount: 2.5 } }],
    [{ op: 'rename', name: ' Steel ' }],
    [{ op: 'addNote', note: { id: 'n', text: 'x'.repeat(4000), pin: { dim: -1, x: 1, y: 2, z: 3 } } }],
    [{ op: 'world', scanId: null, baseId: null }],
    [{ op: 'placement', origin: [1, 64, -3], rotation: 270 }],
    [{ op: 'clearPlacement' }],
  ])('accepts %j', (op) => {
    expect(validateOp(op)).toBeNull();
  });
});
