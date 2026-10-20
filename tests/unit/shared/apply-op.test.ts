import { describe, it, expect } from 'vitest';
import {
  applyOp, defaultSettings, MAX_BUILD_HORIZON_HOURS, MAX_OWNED_MANUAL_COUNT, MAX_OWNED_MANUAL_ENTRIES, MAX_STEP_CHARGE, normalizeSettings,
  SETTINGS_VERSION, validateOp,
} from '../../../src/shared/project/apply-op.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_STEP_CHARGE, NETWORKED_LOGISTICS } from '../../../src/shared/types/plan.ts';
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
    expect(s).toMatchObject({ target: null, mode: 'rate', amount: 1, per: 'min', tier: null, routeDerived: true,
      logistics: 'direct', coilHeat: null, automateCrafting: true, dims: { policy: 'progression', overrides: {} }, settingsVersion: 2,
      stepCharge: 0.02, reuseOwned: true });
    expect(s.excludedCategories).toEqual(['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion']);
    expect(s.declineReuse).toEqual([]);
    expect(s.ownedManual).toEqual([]);
    expect(SETTINGS_VERSION).toBe(2);
    // Fix spec §3 as the user answered it (§10 answer 3): each step must save 2 % of the least raw material; at most 50 %.
    expect(DEFAULT_STEP_CHARGE).toBe(0.02);
    expect(MAX_STEP_CHARGE).toBe(0.5);
  });
  it('fills fields missing from an older stored project', () => {
    const s = normalizeSettings({ target: 'fluid:steam', amount: 5 } as never);
    expect(s.target).toBe('fluid:steam');
    expect(s.stopItems).toEqual([]);
    expect(s.declineReuse).toEqual([]);
    expect(s.dims).toEqual({ policy: 'progression', overrides: {} });
    // Ruling P10: a project stored before plan 09 reads as settings version 1 (so the server switches it once), and
    // normalizing alone keeps the routeDerived it stored.
    expect(s.settingsVersion).toBe(1);
    expect(normalizeSettings({ routeDerived: false } as never)).toMatchObject({ routeDerived: false, settingsVersion: 1 });
    expect(normalizeSettings({ routeDerived: false, settingsVersion: 2 } as never)).toMatchObject({ routeDerived: false, settingsVersion: 2 });
  });
  it('fills the new settings of an old project', () => {
    // A project stored before plan 09: no stepCharge, haveSupply, reuseOwned, ownedManual or settingsVersion, supporting
    // lines off. Normalizing fills the new defaults and keeps its own choice (the server switches routeDerived once, P10).
    const s = normalizeSettings({ target: 't:x@0', routeDerived: false } as never);
    expect(s).toMatchObject({ stepCharge: 0.02, haveSupply: [], optionChoice: {}, reuseOwned: true, ownedManual: [], routeDerived: false, settingsVersion: 1 });
    expect(normalizeSettings({ stepCharge: 0.15 } as never).stepCharge).toBe(0.15);
  });
});

// Pinned ingredient options (plan 09 Task 5; fix spec R9, §3).
describe('optionChoice', () => {
  const optionOp = (optionChoice: unknown) => ({ op: 'settings', patch: { optionChoice } });
  it('is empty by default and for an older stored project', () => {
    expect(defaultSettings().optionChoice).toEqual({});
    expect(normalizeSettings({ target: 't:x@0' } as never).optionChoice).toEqual({});
    expect(normalizeSettings({ optionChoice: { 'r1#100': 'fluid:molten.tin' } } as never).optionChoice).toEqual({ 'r1#100': 'fluid:molten.tin' });
  });
  it('takes <recipe id>#<slot> keys and option keys of 1 to 300 characters', () => {
    expect(validateOp(optionOp({ 'r1#100': 'fluid:molten.tin' }))).toBeNull();
    expect(validateOp(optionOp({}))).toBeNull();
    expect(validateOp(optionOp({ [`${'r'.repeat(100)}#9999`]: 'x'.repeat(300) }))).toBeNull();
    for (const key of ['nohash', 'r#x', '#1', 'r#12345', `${'r'.repeat(101)}#1`, 'a#b#1']) {
      expect(validateOp(optionOp({ [key]: 'fluid:molten.tin' })), key).toEqual(expect.any(String));
    }
    for (const value of ['x'.repeat(301), '', 5, null]) expect(validateOp(optionOp({ 'r1#100': value })), String(value)).toEqual(expect.any(String));
    for (const v of [null, 'r1#100', ['r1#100']]) expect(validateOp(optionOp(v)), JSON.stringify(v)).toEqual(expect.any(String));
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
    [{ op: 'settings', patch: { settingsVersion: 1 } }],
    [{ op: 'settings', patch: { settingsVersion: 1.5 } }],
    [{ op: 'settings', patch: { settingsVersion: 'x' } }],
    [{ op: 'settings', patch: { stepCharge: 0.6 } }],
    [{ op: 'settings', patch: { stepCharge: -0.1 } }],
    [{ op: 'settings', patch: { stepCharge: 'x' } }],
    [{ op: 'settings', patch: { stepCharge: Number.NaN } }],
    [{ op: 'settings', patch: { reuseOwned: 'x' } }],
    [{ op: 'settings', patch: { ownedManual: Array.from({ length: 201 }, (_, i) => ({ mteId: i, count: 1 })) } }],
    [{ op: 'settings', patch: { ownedManual: [{ mteId: 121, count: 0 }] } }],
    [{ op: 'settings', patch: { ownedManual: [{ mteId: -1, count: 1 }] } }],
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
    expect(validateOp({ op: 'settings', patch: { routeDerived: true, settingsVersion: 2 } })).toBeNull();
    expect(validateOp({ op: 'mark', row: 'build:gregtech:gt.metaitem.01@2032', on: true })).toBeNull();
    for (const stepCharge of [0, 0.02, 0.15, 0.5]) expect(validateOp({ op: 'settings', patch: { stepCharge } })).toBeNull();
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
    // A missing settings object is an old project's: version 1 (ruling P10), every other field the default.
    expect(normalizeSettings(undefined)).toEqual({ ...defaultSettings(), settingsVersion: 1 });
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

// Free inputs the group already supplies (plan 09 Task 3; fix spec R2, §3).
describe('haveSupply', () => {
  it('is an empty list by default and for an older stored project', () => {
    expect(defaultSettings().haveSupply).toEqual([]);
    expect(normalizeSettings({ target: 't:x@0' } as never).haveSupply).toEqual([]);
    expect(normalizeSettings({ haveSupply: ['fluid:water'] } as never).haveSupply).toEqual(['fluid:water']);
  });
  it('takes a list of keys', () => {
    expect(validateOp({ op: 'settings', patch: { haveSupply: ['minecraft:cobblestone@0', 'fluid:water'] } })).toBeNull();
    expect(validateOp({ op: 'settings', patch: { haveSupply: [] } })).toBeNull();
    expect(validateOp({ op: 'settings', patch: { haveSupply: 'x' } })).toEqual(expect.any(String));
    expect(validateOp({ op: 'settings', patch: { haveSupply: [1] } })).toEqual(expect.any(String));
  });
});

// Materials to avoid (plan 2026-10-18-08, rulings R1 and R3).
describe('avoid', () => {
  const avoidOp = (avoid: unknown) => ({ op: 'settings', patch: { avoid } });
  it('is an empty list by default and for an older stored project', () => {
    expect(defaultSettings().avoid).toEqual([]);
    expect(normalizeSettings({ target: 't:x@0' } as never).avoid).toEqual([]);
  });
  it('takes at most 50 entries of 1 to 300 characters', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `t:x@${i}`);
    expect(validateOp(avoidOp(fifty))).toBeNull();
    expect(validateOp(avoidOp([...fifty, 'Tin']))).toEqual(expect.any(String));
    expect(validateOp(avoidOp(new Array(51).fill('Tin')))).toEqual(expect.any(String));   // counted before duplicates go
    expect(validateOp(avoidOp(['x'.repeat(300)]))).toBeNull();
    expect(validateOp(avoidOp(['x'.repeat(301)]))).toEqual(expect.any(String));
    for (const avoid of [[''], [5], 'Tin', null, { Tin: true }]) expect(validateOp(avoidOp(avoid)), JSON.stringify(avoid)).toEqual(expect.any(String));
  });
  it('collapses duplicates, keeping the first of each where it was', () => {
    const q = applyOp(project(), { op: 'settings', patch: { avoid: ['Tin', 'Silver', 'Tin', 't:x@0', 'Silver'] } }, 'Ann', AT);
    expect(q.settings.avoid).toEqual(['Tin', 'Silver', 't:x@0']);
    expect(applyOp(q, { op: 'settings', patch: { amount: 2 } }, 'Ann', AT).settings.avoid).toEqual(['Tin', 'Silver', 't:x@0']);
    expect(normalizeSettings({ avoid: ['Gold', 'Gold', 'Tin'] } as never).avoid).toEqual(['Gold', 'Tin']);
  });
});

// "Reuse machines we have" and the "Machines we have" list (plan 09 Task 9; architecture §11.29, ruling P22).
describe('reuseOwned and ownedManual', () => {
  const ownedOp = (ownedManual: unknown) => ({ op: 'settings', patch: { ownedManual } });
  const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ mteId: i, count: 1 }));
  it('reuses owned machines and lists none by default and for an older stored project', () => {
    expect(defaultSettings()).toMatchObject({ reuseOwned: true, ownedManual: [] });
    expect(normalizeSettings({ target: 't:x@0' } as never)).toMatchObject({ reuseOwned: true, ownedManual: [] });
    expect(normalizeSettings({ reuseOwned: false, ownedManual: [{ mteId: 121, count: 2 }] } as never))
      .toMatchObject({ reuseOwned: false, ownedManual: [{ mteId: 121, count: 2 }] });
  });
  it('takes the switch as true or false', () => {
    for (const reuseOwned of [true, false]) expect(validateOp({ op: 'settings', patch: { reuseOwned } })).toBeNull();
    for (const reuseOwned of ['x', 1, null]) expect(validateOp({ op: 'settings', patch: { reuseOwned } }), String(reuseOwned)).toEqual(expect.any(String));
  });
  it('takes at most 200 entries, each a machine id of 0 or more and a whole count from 1 to 10,000', () => {
    expect([MAX_OWNED_MANUAL_ENTRIES, MAX_OWNED_MANUAL_COUNT]).toEqual([200, 10_000]);
    expect(validateOp(ownedOp([]))).toBeNull();
    expect(validateOp(ownedOp(entries(200)))).toBeNull();
    expect(validateOp(ownedOp([{ mteId: 0, count: 10_000 }, { mteId: 15512, count: 1 }]))).toBeNull();
    expect(validateOp(ownedOp(entries(201)))).toEqual(expect.any(String));
    expect(validateOp(ownedOp(new Array(201).fill({ mteId: 121, count: 1 })))).toEqual(expect.any(String));   // counted before repeats merge
    for (const entry of [{ mteId: 121, count: 0 }, { mteId: 121, count: -1 }, { mteId: 121, count: 1.5 }, { mteId: 121, count: 10_001 },
      { mteId: 121, count: '2' }, { mteId: -1, count: 1 }, { mteId: 1.5, count: 1 }, { mteId: '121', count: 1 }, { mteId: 121 }, { count: 1 }, null, 121]) {
      expect(validateOp(ownedOp([entry])), JSON.stringify(entry)).toEqual(expect.any(String));
    }
    for (const list of [null, 'x', { mteId: 121, count: 1 }]) expect(validateOp(ownedOp(list)), JSON.stringify(list)).toEqual(expect.any(String));
  });
  it('sums the counts of a repeated machine where it first appears, keeping only id and count', () => {
    const q = applyOp(project(), ownedOp([{ mteId: 121, count: 2 }, { mteId: 101, count: 1 }, { mteId: 121, count: 3 }]) as never, 'Ann', AT);
    expect(q.settings.ownedManual).toEqual([{ mteId: 121, count: 5 }, { mteId: 101, count: 1 }]);
    expect(applyOp(q, { op: 'settings', patch: { amount: 2 } }, 'Ann', AT).settings.ownedManual).toEqual([{ mteId: 121, count: 5 }, { mteId: 101, count: 1 }]);
    expect(normalizeSettings({ ownedManual: [{ mteId: 7, count: 1 }, { mteId: 7, count: 1 }] } as never).ownedManual).toEqual([{ mteId: 7, count: 2 }]);
    expect(applyOp(project(), ownedOp([{ mteId: 121, count: 1, note: 'x' }]) as never, 'Ann', AT).settings.ownedManual).toEqual([{ mteId: 121, count: 1 }]);
  });
  it('never sums a machine above 10,000 (ruling P22)', () => {
    const q = applyOp(project(), ownedOp([{ mteId: 121, count: 10_000 }, { mteId: 121, count: 1 }]) as never, 'Ann', AT);
    expect(q.settings.ownedManual).toEqual([{ mteId: 121, count: 10_000 }]);
    expect(normalizeSettings({ ownedManual: [{ mteId: 121, count: 6_000 }, { mteId: 121, count: 6_000 }] } as never).ownedManual).toEqual([{ mteId: 121, count: 10_000 }]);
  });
});

// "Count build cost against" (plan 12 Task 1; architecture §11.28, §11.39): the hours of running the build cost of new
// machines is weighed against, null to ignore it.
describe('buildHorizonHours', () => {
  const horizonOp = (buildHorizonHours: unknown) => ({ op: 'settings', patch: { buildHorizonHours } });
  it('counts the build cost over 24 hours by default', () => {
    expect(DEFAULT_BUILD_HORIZON_HOURS).toBe(24);
    expect(defaultSettings().buildHorizonHours).toBe(24);
  });
  it('takes empty or a number of hours above 0 and at most 8760', () => {
    expect(MAX_BUILD_HORIZON_HOURS).toBe(8760);
    for (const v of [null, 1, 0.5, 168, 8760]) expect(validateOp(horizonOp(v)), `${typeof v} ${String(v)}`).toBeNull();
    // Number.POSITIVE_INFINITY stands for 1e309, which JSON parsing turns into Infinity.
    for (const v of [0, -1, 8761, '24', true, Number.POSITIVE_INFINITY]) {
      expect(validateOp(horizonOp(v)), `${typeof v} ${String(v)}`).toEqual(expect.any(String));
    }
    expect(validateOp(horizonOp(0))).toBe('buildHorizonHours must be empty or above 0 and at most 8760');
  });
  it('fills the build horizon of an old project', () => {
    expect(normalizeSettings({ target: 't:x@0' } as never).buildHorizonHours).toBe(24);
    expect(normalizeSettings({ buildHorizonHours: null } as never).buildHorizonHours).toBeNull();
    expect(normalizeSettings({ buildHorizonHours: 8 } as never).buildHorizonHours).toBe(8);
  });
});

describe('NETWORKED_LOGISTICS', () => {
  it('lists the networked logistics modes', () => {
    expect([...NETWORKED_LOGISTICS].sort()).toEqual(['ae2', 'routed']);
    expect(NETWORKED_LOGISTICS.has('direct')).toBe(false);
    // EnderIO plans like machine to machine, each step on its own machines (controller ruling).
    expect(NETWORKED_LOGISTICS.has('enderio')).toBe(false);
  });
});
