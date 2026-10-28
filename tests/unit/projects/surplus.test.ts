import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../../src/server/db/db.ts';
import {
  FANOUT_ROUND_SECONDS, SUMMARY_PREFIX, SurplusBoard, crossRead, summaryOf, type BoardChange, type PublishedSummary,
} from '../../../src/server/projects/surplus.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings, RawInput } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import { makePlan } from '../../helpers/layout-fixtures.ts';

let dir: string; let file: string; let db: Db;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gp-surplus-')); file = join(dir, 'planner.sqlite'); db = openDb(file); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const NAMES: Readonly<Record<string, string>> = { p1: 'One', p2: 'Two', p3: 'Three', p4: 'Four' };
/** p1 is the oldest project, p4 the youngest (ruling R16: several readers of one surplus are served oldest first). */
const CREATED: Readonly<Record<string, string>> = {
  p1: '2026-10-01T08:00:00.000Z', p2: '2026-10-02T08:00:00.000Z', p3: '2026-10-03T08:00:00.000Z', p4: '2026-10-04T08:00:00.000Z',
};
const AT = '2026-10-22T10:00:00.000Z';
const LIVE: ReadonlySet<string> = new Set(['p1', 'p2', 'p3', 'p4']);

function project(id: string, settings: Partial<PlanSettings> = {}, createdAt = CREATED[id]!): Project {
  return {
    id, name: NAMES[id]!, createdAt, createdBy: 'Ann', rev: 3, settings: { ...defaultSettings(), target: 't:target@0', ...settings },
    world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [],
  };
}

function summary(id: string, over: Partial<PublishedSummary> = {}): PublishedSummary {
  return { projectId: id, name: NAMES[id]!, exportId: 'E1', rev: 1, at: AT, createdAt: CREATED[id]!, surplus: [], needs: [], draws: [], ...over };
}

const goods = (...keys: string[]): Set<string> => new Set(keys);
const rate = (key: string, perSecond: number) => ({ key, perSecond });
const draw = (from: string, key: string, perSecond: number) => ({ from, key, perSecond });
const change = (over: Partial<BoardChange> = {}): BoardChange => ({ surplus: [], needs: [], draws: false, drawsFrom: [], ...over });
const NOTHING = change();
/** `p`'s read of the board on export E1, in its own settings. */
const readOf = (board: SurplusBoard, p: Project, of: ReadonlySet<string>, live: ReadonlySet<string> = LIVE) =>
  crossRead(board, p, p.settings, live, of, 'E1');

function raw(key: string, perSecond: number, cost: number, extra: Partial<RawInput> = {}): RawInput {
  return { key, perSecond, cost, available: true, sources: [], ...extra };
}

describe('published summaries (add-on 17, architecture §11.45 (4))', () => {
  it('publishes what a plan makes and needs', () => {
    const plan: Plan = {
      ...makePlan([]), byproducts: [{ key: 't:y@0', amount: 0.1, chance: 1 }],
      rawInputs: [
        raw('t:a@0', 0.2, 1), raw('gregtech:gt.metatool.01@10', 1e-4, 2, { upkeep: true }),
        raw('t:b@0', 0.05, 0, { from: { kind: 'project', id: 'p2', name: 'Two' } }),
      ],
    };
    expect(summaryOf(project('p1'), plan, AT)).toEqual({
      projectId: 'p1', name: 'One', exportId: 'E1', rev: 3, at: AT, createdAt: CREATED.p1,
      surplus: [{ key: 't:y@0', perSecond: 0.1 }],
      needs: [{ key: 't:a@0', perSecond: 0.2 }, { key: 't:b@0', perSecond: 0.05 }],
      draws: [{ from: 'p2', key: 't:b@0', perSecond: 0.05 }],
    });
    expect(summaryOf(project('p1', { mode: 'makeN', amount: 4 }), { ...plan, makeN: { totalSeconds: 10, leftovers: [] } }, AT)).toBeNull();
    expect(summaryOf(project('p1'), { ...plan, status: 'infeasible' }, AT)).toBeNull();
    // per key, at 9 significant digits (ruling S11): a good bought beside a draw of it is one need; a farm the group runs
    // and free water are no need
    const mixed: Plan = {
      ...makePlan([]), byproducts: [{ key: 't:y@0', amount: 1 / 30, chance: 1 }],
      rawInputs: [
        raw('fluid:water', 2, 0), raw('t:b@0', 0.01, 1),
        raw('t:b@0', 0.05, 0, { from: { kind: 'project', id: 'p2', name: 'Two' } }),
        raw('t:wood@0', 0.03, 0, { from: { kind: 'farm', id: 'farm:0:t:wood@0', name: 'Forestry farm' } }),
      ],
    };
    expect(summaryOf(project('p1'), mixed, AT)).toMatchObject({
      surplus: [{ key: 't:y@0', perSecond: 0.0333333333 }], needs: [{ key: 't:b@0', perSecond: 0.06 }],
      draws: [{ from: 'p2', key: 't:b@0', perSecond: 0.05 }],
    });
  });

  it("offers another project's surplus of the goods a line uses", () => {
    const board = new SurplusBoard(db);
    board.publish(summary('p2', { surplus: [rate('t:y@0', 0.1), rate('t:z@0', 0.2)] }));
    board.publish(summary('p3', { exportId: 'other', surplus: [rate('t:y@0', 0.5)] }));
    const p1 = project('p1');
    expect(p1.settings.objective).toBe('cheapest');
    const read = readOf(board, p1, goods('t:y@0'));
    expect(read.offers).toEqual([{ from: 'p2', name: 'Two', key: 't:y@0', perSecond: 0.1 }]);
    expect(read.needs).toEqual([]);
    expect(read.hash).toMatch(/^[0-9a-f]{16}$/);
    // p2 not live: nothing; p3's summary is of another export: never
    expect(readOf(board, p1, goods('t:y@0', 't:z@0'), new Set(['p1', 'p3']))).toEqual({ offers: [], needs: [], hash: '' });
    expect(readOf(board, p1, goods('t:y@0', 't:z@0')).offers.map((o) => `${o.from} ${o.key}`)).toEqual(['p2 t:y@0', 'p2 t:z@0']);
    // its own target is never taken from another project
    expect(readOf(board, project('p1', { target: 't:y@0' }), goods('t:y@0', 't:z@0')).offers.map((o) => o.key)).toEqual(['t:z@0']);
    // nothing read
    expect(readOf(board, p1, goods('t:x@0')).hash).toBe('');
    // the same reads in another insertion order give the same hash
    const both = readOf(board, p1, goods('t:y@0', 't:z@0'));
    const otherDb = openDb(join(dir, 'other.sqlite'));
    try {
      const other = new SurplusBoard(otherDb);
      other.publish(summary('p3', { exportId: 'other', surplus: [rate('t:y@0', 0.5)] }));
      other.publish(summary('p2', { surplus: [rate('t:z@0', 0.2), rate('t:y@0', 0.1)] }));
      expect(readOf(other, p1, goods('t:z@0', 't:y@0'))).toEqual(both);
    } finally {
      otherDb.close();
    }
  });

  it('never lets two projects feed each other', () => {
    const board = new SurplusBoard(db);
    board.publish(summary('p2', { surplus: [rate('t:y@0', 0.1)], draws: [draw('p1', 't:b@0', 0.05)] }));
    board.publish(summary('p3', { surplus: [rate('t:y@0', 0.2)], draws: [draw('p4', 't:c@0', 0.01)] }));
    expect(readOf(board, project('p1'), goods('t:y@0')).offers.map((o) => o.from)).toEqual(['p3']);
  });

  it('walks the draws as they are now', () => {
    // review: a list of upstream projects stored when the producer last published goes stale
    const board = new SurplusBoard(db);
    board.publish(summary('p2'));
    board.publish(summary('p3', { surplus: [rate('t:z@0', 0.2)], draws: [draw('p2', 't:y@0', 0.1)] }));
    board.noteRead('p1', { offers: goods('t:z@0'), needs: goods() });
    board.noteRead('p4', { offers: goods('t:w@0'), needs: goods() });
    expect(readOf(board, project('p1'), goods('t:z@0')).offers).toEqual([{ from: 'p3', name: 'Three', key: 't:z@0', perSecond: 0.2 }]);
    // B starts drawing from A while C's summary stays as it was: C → B → A
    const drawn = board.publish(summary('p2', { draws: [draw('p1', 't:x@0', 0.3)] }));
    expect(readOf(board, project('p1'), goods('t:z@0')).offers).toEqual([]);
    expect(drawn).toEqual(change({ draws: true, drawsFrom: ['p1'] }));
    // every project that read offers walks the draws again, though no good it read changed
    expect(board.fanOut('p2', drawn)).toEqual({ to: ['p1', 'p4'], skipped: [] });
  });

  it('runs one read, plan and publish at a time', async () => {
    const flows = async (board: SurplusBoard, locked: boolean): Promise<string[]> => {
      const own: Record<string, PublishedSummary> = {
        p1: summary('p1', { surplus: [rate('t:y@0', 0.1)] }), p2: summary('p2', { surplus: [rate('t:z@0', 0.2)] }),
      };
      const reads: Record<string, Set<string>> = { p1: goods('t:z@0'), p2: goods('t:y@0') };
      board.publish(own.p1!);
      board.publish(own.p2!);
      const flow = (id: string) => async (): Promise<void> => {
        const read = readOf(board, project(id), reads[id]!);
        await new Promise((resolve) => setTimeout(resolve, 10));
        board.publish({ ...own[id]!, draws: read.offers.map((o) => ({ from: o.from, key: o.key, perSecond: o.perSecond })) });
      };
      await Promise.all(['p1', 'p2'].map((id) => (locked ? board.exclusive(flow(id)) : flow(id)())));
      return ['p1', 'p2'].filter((id) => board.get(id)!.draws.length > 0);
    };
    expect(await flows(new SurplusBoard(db), true)).toHaveLength(1);
    // a check on the test: without the lock both flows read before either publishes, and both draw
    const raceDb = openDb(join(dir, 'race.sqlite'));
    try {
      expect(await flows(new SurplusBoard(raceDb), false)).toEqual(['p1', 'p2']);
    } finally {
      raceDb.close();
    }
    // a flow that fails lets the next one run
    const board = new SurplusBoard(db);
    await expect(board.exclusive(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(board.exclusive(async () => 'next')).resolves.toBe('next');
  });

  it('reads needs only for best multi-output', () => {
    const board = new SurplusBoard(db);
    board.publish(summary('p2', { surplus: [rate('t:z@0', 0.2)], needs: [rate('t:y@0', 0.3)] }));
    const multi = readOf(board, project('p1', { objective: 'multi-output' }), goods('t:y@0', 't:z@0'));
    expect(multi.needs).toEqual([{ by: 'p2', name: 'Two', key: 't:y@0', perSecond: 0.3 }]);
    expect(multi.offers).toEqual([{ from: 'p2', name: 'Two', key: 't:z@0', perSecond: 0.2 }]);
    expect(readOf(board, project('p1'), goods('t:y@0', 't:z@0')).needs).toEqual([]);
    const switchedOff = readOf(board, project('p1', { objective: 'multi-output', useSurplus: false }), goods('t:y@0', 't:z@0'));
    expect(switchedOff.offers).toEqual([]);
    expect(switchedOff.needs).toEqual(multi.needs);
    expect(switchedOff.hash).not.toBe('');
    // a Make N project neither publishes nor reads
    expect(readOf(board, project('p1', { objective: 'multi-output', mode: 'makeN' }), goods('t:y@0', 't:z@0'))).toEqual({ offers: [], needs: [], hash: '' });
  });

  it('serves the oldest readers of one surplus first', () => {
    // ruling R16 (OQ3): an offer is the surplus less what older live readers draw of it, at least 0, and says so
    const board = new SurplusBoard(db);
    board.publish(summary('p2', { surplus: [rate('t:y@0', 0.1)] }));
    board.publish(summary('p3', { draws: [draw('p2', 't:y@0', 0.06)] }));
    const young = project('p4');
    const shared = readOf(board, young, goods('t:y@0'));
    expect(shared.offers).toEqual([{ from: 'p2', name: 'Two', key: 't:y@0', perSecond: 0.04, shared: { surplus: 0.1, takenBy: ['Three'] } }]);
    // a younger reader's draw leaves an older reader's offer whole
    board.publish(summary('p4', { draws: [draw('p2', 't:y@0', 0.04)] }));
    expect(readOf(board, project('p1'), goods('t:y@0')).offers).toEqual([{ from: 'p2', name: 'Two', key: 't:y@0', perSecond: 0.1 }]);
    // not live: no share taken
    expect(readOf(board, young, goods('t:y@0'), new Set(['p2', 'p4'])).offers).toEqual([{ from: 'p2', name: 'Two', key: 't:y@0', perSecond: 0.1 }]);
    // older readers in age order; a fully taken offer is 0, and still read, so the hash follows older readers' draws
    board.publish(summary('p1', { draws: [draw('p2', 't:y@0', 0.04)] }));
    const taken = readOf(board, young, goods('t:y@0'));
    expect(taken.offers).toEqual([{ from: 'p2', name: 'Two', key: 't:y@0', perSecond: 0, shared: { surplus: 0.1, takenBy: ['One', 'Three'] } }]);
    expect(taken.hash).not.toBe(shared.hash);
    expect(taken.hash).not.toBe('');
  });

  it('keeps summaries across a restart', () => {
    const published = summary('p2', { surplus: [rate('t:y@0', 0.1)], needs: [rate('t:a@0', 0.2)], draws: [draw('p3', 't:b@0', 0.05)] });
    const first = new SurplusBoard(db);
    first.publish(published);
    first.publish(summary('p4', { surplus: [rate('t:z@0', 1)] }));
    first.remove('p4');
    db.setMeta(`${SUMMARY_PREFIX}p9`, 'not json');
    db.setMeta(`${SUMMARY_PREFIX}p8`, JSON.stringify({ projectId: 'p8', name: 'Eight' }));
    db.close();
    db = openDb(file);
    const board = new SurplusBoard(db);
    expect(board.get('p2')).toEqual(published);
    expect(board.get('p4')).toBeNull();
    expect(board.get('p9')).toBeNull();
    expect(board.all().map((s) => s.projectId)).toEqual(['p2']);
    expect(db.getMeta('schema_version')).toBe('3');
  });

  it('says what changed and who read it', () => {
    const board = new SurplusBoard(db);
    const two = summary('p2', { surplus: [rate('t:y@0', 0.1), rate('t:z@0', 0.2)] });
    expect(board.publish(two)).toEqual(change({ surplus: ['t:y@0', 't:z@0'] }));
    expect(board.publish({ ...two, rev: 2, at: '2026-10-22T11:00:00.000Z' })).toEqual(NOTHING);
    const more = { ...two, surplus: [rate('t:y@0', 0.2), rate('t:z@0', 0.2)] };
    expect(board.publish(more)).toEqual(change({ surplus: ['t:y@0'] }));
    // a new name reaches every reader
    const renamed = { ...more, name: 'Two b' };
    expect(board.publish(renamed)).toEqual(change({ surplus: ['t:y@0', 't:z@0'] }));
    const drawing = { ...renamed, draws: [draw('p3', 't:b@0', 0.05)] };
    expect(board.publish(drawing)).toEqual(change({ draws: true, drawsFrom: ['p3'] }));
    // and the producers its draws name, whose lists of who takes their surplus show its name
    expect(board.publish({ ...drawing, name: 'Two' })).toEqual(change({ surplus: ['t:y@0', 't:z@0'], drawsFrom: ['p3'] }));
    board.noteRead('p1', { offers: goods('t:y@0'), needs: goods() });
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'] })).to).toEqual(['p1']);
    expect(board.fanOut('p2', change({ surplus: ['t:z@0'] })).to).toEqual([]);
    expect(board.fanOut('p2', change({ needs: ['t:y@0'] })).to).toEqual([]);
    expect(board.fanOut('p2', change({ draws: true })).to).toEqual(['p1']);
    // a project that read needs (best multi-output), and a producer, which reads nothing, told of a change of draws on it
    board.noteRead('p4', { offers: goods(), needs: goods('t:y@0') });
    expect(board.fanOut('p2', change({ needs: ['t:y@0'] })).to).toEqual(['p4']);
    expect(board.fanOut('p2', change({ drawsFrom: ['p3'] })).to).toEqual(['p3']);
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'], needs: ['t:y@0'], draws: true, drawsFrom: ['p2', 'p3'] })).to).toEqual(['p1', 'p3', 'p4']);
    expect(board.remove('p2')).toEqual(change({ surplus: ['t:y@0', 't:z@0'], draws: true, drawsFrom: ['p3'] }));
    expect(board.remove('p2')).toEqual(NOTHING);
    // a project that reads nothing any more is not told
    board.noteRead('p1', { offers: goods(), needs: goods() });
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'], draws: true })).to).toEqual([]);
  });

  it('stops plans that keep changing each other', () => {
    let now = 1_000_000;
    const board = new SurplusBoard(db, () => now);
    board.noteRead('p1', { offers: goods('t:y@0'), needs: goods() });
    board.noteRead('p2', { offers: goods('t:w@0'), needs: goods('t:q@0') });
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'] }))).toEqual({ to: ['p1'], skipped: [] });
    now += (FANOUT_ROUND_SECONDS - 1) * 1000;
    expect(board.fanOut('p1', change({ needs: ['t:q@0'] }))).toEqual({ to: [], skipped: ['p2'] });
    // p2 would be reached only through the draws: left out silently
    expect(board.fanOut('p1', change({ draws: true }))).toEqual({ to: [], skipped: [] });
    now += 2 * 1000;
    expect(board.fanOut('p1', change({ needs: ['t:q@0'] }))).toEqual({ to: ['p2'], skipped: [] });
    // p2 was reached in p1's round now; a change the group makes to p2 itself (its ops, its deletion) starts a new round
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'] }))).toEqual({ to: [], skipped: ['p1'] });
    board.newRound('p2');
    expect(board.fanOut('p2', change({ surplus: ['t:y@0'] }))).toEqual({ to: ['p1'], skipped: [] });
  });
});
