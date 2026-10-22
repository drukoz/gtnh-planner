import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse, type SseClient } from '../../helpers/sse-client.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { crossSpec } from '../../helpers/farm-fixtures.ts';
import { planCacheFor, planForProject } from '../../../src/server/http/routes/projects.ts';
import { summaryOf, surplusBoardFor } from '../../../src/server/projects/surplus.ts';
import { sig9 } from '../../../src/server/planner/round.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';

// Add-on 17 Task 6 (architecture §11.45 (4)): P makes Tees and a Wye beside each, Q makes Cues from Wyes. Every case
// starts its own server, so no project of another case offers or reads anything.
const PACK = packFromSpec(crossSpec());
let s: TestServer;
beforeEach(async () => { s = await startTestServer({ pack: PACK }); });
afterEach(async () => { await s.close(); });

const HOUR = 3600;
const BASE: Partial<PlanSettings> = { per: 'hour', objective: 'least-raw' };
const MAKES_T: Partial<PlanSettings> = { target: 't:t@0', amount: 60 };
const USES_Y: Partial<PlanSettings> = { target: 't:q@0', amount: 30 };

async function create(name: string, settings: Partial<PlanSettings>): Promise<Project> {
  const r = await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name, settings: { ...BASE, ...settings } } });
  expect(r.status).toBe(201);
  return r.json();
}
async function plan(id: string): Promise<Plan> {
  const r = await s.request(`/api/projects/${id}/plan`);
  expect(r.status).toBe(200);
  return r.json();
}
async function send(id: string, ops: unknown[]): Promise<void> {
  expect((await s.request(`/api/projects/${id}/ops`, { method: 'POST', name: 'Ann', body: { ops } })).status).toBe(200);
}
const project = async (id: string): Promise<Project> => (await s.request(`/api/projects/${id}`)).json();
async function events(id: string): Promise<SseClient> {
  const es = await openSse(`${s.url}/api/projects/${id}/events`, s.cookie);
  await es.next('snapshot');
  return es;
}
const recipes = (p: Plan): string[] => p.steps.map((st) => st.recipeId);
const bought = (p: Plan): string[] => p.rawInputs.filter((r) => r.from === undefined).map((r) => r.key);
const fromRows = (p: Plan) => p.rawInputs.filter((r) => r.from !== undefined).map((r) => ({ key: r.key, from: r.from }));
const codes = (p: Plan): string[] => p.warnings.map((w) => w.code);
/** Creation times are milliseconds: one apart, so the older project is always the one created first. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('surplus across projects (add-on 17, architecture §11.45 (4))', () => {
  it("takes another project's surplus, from <project>", async () => {
    const p = await create('P', MAKES_T);
    const q = await create('Q', USES_Y);
    const first = await plan(q.id);
    expect(recipes(first)).toContain('make-y');
    expect(bought(first)).toContain('t:copper_ingot@0');
    expect(first).not.toHaveProperty('crossHash');
    const es = await events(q.id);
    try {
      const made = await plan(p.id);
      expect(made.byproducts).toEqual([{ key: 't:y@0', amount: sig9(60 / HOUR), chance: 1 }]);
      expect((await es.next('plan')).data).toEqual({ rev: 0 });
    } finally {
      es.close();
    }
    const taken = await plan(q.id);
    expect(taken.rawInputs.filter((r) => r.key === 't:y@0')).toEqual([
      { key: 't:y@0', perSecond: sig9(30 / HOUR), cost: 0, available: true, sources: [], from: { kind: 'project', id: p.id, name: 'P' } },
    ]);
    expect(recipes(taken)).not.toContain('make-y');
    expect(bought(taken)).not.toContain('t:copper_ingot@0');
    expect(taken.crossHash).toMatch(/^[0-9a-f]{16}$/);
    const into = taken.flows.filter((f) => f.key === 't:y@0' && f.to === 'use-y');
    expect(into.map((f) => f.from)).toEqual(['raw']);
    expect(into[0]!.perSecond).toBeCloseTo(30 / HOUR, 10);
    for (const code of ['orphan-input', 'short-input', 'bought-and-made']) expect(codes(taken)).not.toContain(code);
    // P's served plan says who takes its Wyes (ruling R16)
    expect((await plan(p.id)).drawnBy).toEqual([{ by: q.id, name: 'Q', key: 't:y@0', perSecond: sig9(30 / HOUR) }]);
  });

  it('publishes the plan a request finds in the cache', async () => {
    const p = await create('P', MAKES_T);
    const q = await create('Q', USES_Y);
    await plan(p.id);
    expect(fromRows(await plan(q.id)).map((r) => r.from?.id)).toEqual([p.id]);
    // stands in for a compare that planned Q's mode without publishing
    const board = surplusBoardFor(s.app);
    board.remove(q.id);
    expect(board.get(q.id)).toBeNull();
    const before = planCacheFor(s.app).computations;
    await plan(q.id);
    expect(planCacheFor(s.app).computations).toBe(before);
    const stored = board.get(q.id);
    expect(stored).not.toBeNull();
    const current = await project(q.id);
    expect(stored).toEqual(summaryOf(current, await planForProject(s.app, current, { publish: false }), stored!.at));
    expect(stored!.draws).toEqual([{ from: p.id, key: 't:y@0', perSecond: sig9(30 / HOUR) }]);
  });

  it('follows a rename, a new target and a delete of the project it takes from', async () => {
    const p = await create('P', MAKES_T);
    const q = await create('Q', USES_Y);
    await plan(p.id);
    expect(fromRows(await plan(q.id))).toEqual([{ key: 't:y@0', from: { kind: 'project', id: p.id, name: 'P' } }]);
    const es = await events(q.id);
    try {
      await send(p.id, [{ op: 'rename', name: 'Pea' }]);
      await es.next('plan');
      expect(fromRows(await plan(q.id))).toEqual([{ key: 't:y@0', from: { kind: 'project', id: p.id, name: 'Pea' } }]);
      // P makes Cues itself now, and has no Wye to spare
      await send(p.id, [{ op: 'settings', patch: { target: 't:q@0' } }]);
      await es.next('plan');
      const own = await plan(q.id);
      expect(fromRows(own)).toEqual([]);
      expect(recipes(own)).toContain('make-y');
      await send(p.id, [{ op: 'settings', patch: { target: 't:t@0' } }]);
      await es.next('plan');
      expect(fromRows(await plan(q.id))).toEqual([{ key: 't:y@0', from: { kind: 'project', id: p.id, name: 'Pea' } }]);
      expect((await s.request(`/api/projects/${p.id}`, { method: 'DELETE', name: 'Ann' })).status).toBe(204);
      await es.next('plan');
      const alone = await plan(q.id);
      expect(fromRows(alone)).toEqual([]);
      expect(recipes(alone)).toContain('make-y');
      expect(surplusBoardFor(s.app).get(p.id)).toBeNull();
    } finally {
      es.close();
    }
  });

  it('settles two projects that feed each other', async () => {
    const a = await create('A', { ...MAKES_T, objective: 'multi-output' });
    const b = await create('B', USES_Y);
    const rounds: Array<[Plan, Plan]> = [];
    for (let round = 0; round < 3; round++) rounds.push([await plan(a.id), await plan(b.id)]);
    expect(rounds[2]).toEqual(rounds[1]);
    const [madeBy, takenBy] = rounds[2]!;
    expect(fromRows(takenBy)).toEqual([{ key: 't:y@0', from: { kind: 'project', id: a.id, name: 'A' } }]);
    expect(fromRows(madeBy)).toEqual([]);
    expect(madeBy.credits).toEqual([{ to: b.id, name: 'B', key: 't:y@0', perSecond: sig9(30 / HOUR) }]);
    expect(madeBy.byproducts).toEqual([{ key: 't:y@0', amount: sig9(60 / HOUR), chance: 1 }]);
  });

  it('serves the older of two readers first and lists both on the producer', async () => {
    // ruling R16 (OQ3): Q1, the older, takes its 40 an hour of P's 60 first; Q2 gets the other 20 and makes the rest
    const p = await create('P', MAKES_T);
    await tick();
    const q1 = await create('Q1', { target: 't:q@0', amount: 40 });
    await tick();
    const q2 = await create('Q2', { target: 't:q@0', amount: 40 });
    expect(q1.createdAt < q2.createdAt).toBe(true);
    await plan(p.id);
    const older = await plan(q1.id);
    expect(older.rawInputs.filter((r) => r.from !== undefined).map((r) => r.perSecond)).toEqual([sig9(40 / HOUR)]);
    expect(codes(older)).not.toContain('surplus-shared');
    const younger = await plan(q2.id);
    // what P spares less what Q1 takes, both as published
    const left = sig9(sig9(60 / HOUR) - sig9(40 / HOUR));
    expect(younger.rawInputs.filter((r) => r.from !== undefined).map((r) => r.perSecond)).toEqual([left]);
    expect(recipes(younger)).toContain('make-y');
    expect(younger.warnings.filter((w) => w.code === 'surplus-shared')).toEqual([{
      code: 'surplus-shared', key: 't:y@0',
      text: 'P spares 60/h of Wye; older projects take 40/h of it first (Q1), so this line takes 20/h and makes or buys the rest',
    }]);
    expect((await plan(p.id)).drawnBy).toEqual([
      { by: q1.id, name: 'Q1', key: 't:y@0', perSecond: sig9(40 / HOUR) },
      { by: q2.id, name: 'Q2', key: 't:y@0', perSecond: left },
    ]);
  });

  it('ignores other projects with the switch off', async () => {
    const p = await create('P', MAKES_T);
    const q = await create('Q', { ...USES_Y, useSurplus: false });
    await plan(p.id);
    const alone = await plan(q.id);
    expect(recipes(alone)).toContain('make-y');
    expect(fromRows(alone)).toEqual([]);
    expect(alone).not.toHaveProperty('crossHash');
  });

  it('never reads a summary of a project that is gone or of another export', async () => {
    const q = await create('Q', MAKES_T);
    const board = surplusBoardFor(s.app);
    const stale = {
      rev: 1, at: '2026-10-22T10:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', surplus: [{ key: 't:y@0', perSecond: 1 }], needs: [], draws: [],
    };
    board.publish({ ...stale, projectId: 'gone', name: 'Gone', exportId: PACK.manifest.exportId });
    board.publish({ ...stale, projectId: q.id, name: 'Q', exportId: 'another export' });
    const p = await create('P', USES_Y);
    const alone = await plan(p.id);
    expect(alone.status).toBe('ok');
    expect(fromRows(alone)).toEqual([]);
    expect(recipes(alone)).toContain('make-y');
    expect(alone).not.toHaveProperty('crossHash');
  });
});
