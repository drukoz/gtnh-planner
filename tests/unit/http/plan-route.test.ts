import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { planCacheFor, planForProject } from '../../../src/server/http/routes/projects.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';

let s: TestServer;
beforeAll(async () => { s = await startTestServer({ pack: miniGt() }); });
afterAll(async () => { await s.close(); });

const create = async (settings: Record<string, unknown>): Promise<Project> =>
  (await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Circuits', settings } })).json();
const send = async (id: string, ops: unknown[]): Promise<number> => {
  const r = await s.request(`/api/projects/${id}/ops`, { method: 'POST', name: 'Ann', body: { ops } });
  expect(r.status).toBe(200);
  return (await r.json()).rev;
};
const getPlan = (id: string) => s.request(`/api/projects/${id}/plan`);
const project = async (id: string): Promise<Project> => (await s.request(`/api/projects/${id}`)).json();
/** Plans the cache of this app has computed so far (the cache is per app, so tests compare deltas). */
const computations = (): number => planCacheFor(s.app).computations;
const events = (id: string) => openSse(`${s.url}/api/projects/${id}/events`, s.cookie);

describe('GET /api/projects/:id/plan', () => {
  it('plans a project once and serves the cached plan after that', async () => {
    const p = await create({ target: 't:circuit@0', tier: 1 });
    const before = computations();
    const r = await getPlan(p.id);
    expect(r.status).toBe(200);
    const plan = await r.json();
    expect(plan.status).toBe('ok');
    expect(plan.steps).toHaveLength(3);
    expect(plan).not.toHaveProperty('scanId');
    expect((await (await getPlan(p.id)).json()).settingsHash).toBe(plan.settingsHash);
    expect(computations() - before).toBe(1);
    expect((await getPlan('nope')).status).toBe(404);
  });
  it('plans in the world context the planContext hook gives', async () => {
    s.app.services.planContext = async () => ({ ...emptyContext(), ownedMachines: [{ mteId: 121, count: 2 }] });
    try {
      const p = await create({ target: 't:circuit@0', tier: 1, amount: 30 });
      const plan = await (await getPlan(p.id)).json();
      expect(plan.steps.find((st: { id: string }) => st.id === 'circuit-lv')).toMatchObject({ count: 5, owned: 2 });
    } finally {
      delete s.app.services.planContext;
    }
  });
  it('re-plans after a settings op and tells every open tab', async () => {
    const p = await create({ target: 't:circuit@0', tier: 1 });
    const es = await events(p.id);
    try {
      await es.next('snapshot');
      const sentAt = Date.now();
      expect(await send(p.id, [{ op: 'settings', patch: { amount: 60 } }])).toBe(1);
      const ev = await es.next('plan');
      expect(ev.data).toEqual({ rev: 1 });
      expect(ev.receivedAt - sentAt).toBeLessThan(2000);
      expect((await (await getPlan(p.id)).json()).rawInputs[0].perSecond).toBe(1);
      // Ticks, notes and names do not change the plan.
      await send(p.id, [{ op: 'mark', row: 'run:t:redstone@0', on: true }, { op: 'rename', name: 'Fast circuits' }]);
      await expect(es.next('plan', 300)).rejects.toThrow('"plan"');
    } finally {
      es.close();
    }
  });
  it('answers 503 no-export without a recipe export', async () => {
    const bare = await startTestServer({ pack: null });
    try {
      const p = await (await bare.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'x', settings: { target: 't:circuit@0' } } })).json();
      const r = await bare.request(`/api/projects/${p.id}/plan`);
      expect(r.status).toBe(503);
      expect((await r.json()).error).toBe('no-export');
    } finally {
      await bare.close();
    }
  });
});

describe('planForProject and planFinish (architecture §11.16)', () => {
  it('gives the plan the route serves, from the cache', async () => {
    const p = await create({ target: 't:circuit@0', tier: 2 });
    const served = await (await getPlan(p.id)).json();
    const before = computations();
    expect((await planForProject(s.app, await project(p.id))).settingsHash).toBe(served.settingsHash);
    expect(computations()).toBe(before);
  });
  it('finishes the served plan but caches the unfinished one', async () => {
    const p = await create({ target: 't:circuit@0', tier: 2, per: 'hour' });
    s.app.services.planFinish = async (plan) => ({ ...plan, warnings: [...plan.warnings, { code: 'finished', text: 'ok' }] });
    try {
      const served = await (await getPlan(p.id)).json();
      expect(served.warnings.map((w: { code: string }) => w.code)).toContain('finished');
      expect((await planForProject(s.app, await project(p.id))).warnings.map((w) => w.code)).not.toContain('finished');
    } finally {
      delete s.app.services.planFinish;
    }
  });
  it('sends the unfinished plan with a warning when finishing fails', async () => {
    const p = await create({ target: 't:circuit@0', tier: 2, per: 'hour', amount: 7 });
    s.app.services.planFinish = async () => { throw new Error('boom'); };
    try {
      const r = await getPlan(p.id);
      expect(r.status).toBe(200);
      const plan = await r.json();
      expect(plan.status).toBe('ok');
      expect(plan.warnings).toContainEqual({ code: 'layout-failed', text: 'The line layout failed: boom' });
    } finally {
      delete s.app.services.planFinish;
    }
  });
  it('answers 500 plan-failed when planning fails, and still tells the tabs to refetch', async () => {
    const p = await create({ target: 't:circuit@0', tier: 3 });
    const es = await events(p.id);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.app.services.planContext = async () => { throw new Error('no such scan'); };
    try {
      await es.next('snapshot');
      const rev = await send(p.id, [{ op: 'settings', patch: { amount: 3 } }]);
      expect((await es.next('plan')).data).toEqual({ rev });
      const r = await getPlan(p.id);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: 'plan-failed', message: 'The planner failed: no such scan' });
      expect(logged).toHaveBeenCalled();
    } finally {
      delete s.app.services.planContext;
      logged.mockRestore();
      es.close();
    }
  });
});

describe('plan events (architecture §11.8, §11.16)', () => {
  it('tells the tabs after placement ops, from the cache', async () => {
    const p = await create({ target: 't:circuit@0', tier: 1, per: 'hour' });
    await getPlan(p.id);
    const before = computations();
    const es = await events(p.id);
    try {
      await es.next('snapshot');
      let sentAt = Date.now();
      const placed = await send(p.id, [{ op: 'placement', origin: [0, 64, 0], rotation: 0 }]);
      let ev = await es.next('plan');
      expect(ev.data).toEqual({ rev: placed });
      expect(ev.receivedAt - sentAt).toBeLessThan(2000);
      sentAt = Date.now();
      const cleared = await send(p.id, [{ op: 'clearPlacement' }]);
      ev = await es.next('plan');
      expect(ev.data).toEqual({ rev: cleared });
      expect(ev.receivedAt - sentAt).toBeLessThan(2000);
      expect(computations()).toBe(before);
    } finally {
      es.close();
    }
  });
  it('re-plans when the project moves to another base of the same scan', async () => {
    s.app.services.planContext = async (pr) => ({ ...emptyContext(), topTier: pr.world.baseId === 'B' ? 2 : 1 });
    const p = await create({ target: 't:circuit@0' });
    const es = await events(p.id);
    try {
      await es.next('snapshot');
      const before = computations();
      const atA = await send(p.id, [{ op: 'world', scanId: 'S', baseId: 'A' }]);
      expect((await es.next('plan')).data).toEqual({ rev: atA });
      const a = await (await getPlan(p.id)).json();
      expect([a.tier, a.scanId]).toEqual([1, 'S']);
      const atB = await send(p.id, [{ op: 'world', scanId: 'S', baseId: 'B' }]);
      expect((await es.next('plan')).data).toEqual({ rev: atB });
      expect((await (await getPlan(p.id)).json()).tier).toBe(2);
      expect(computations() - before).toBe(2);
    } finally {
      delete s.app.services.planContext;
      es.close();
    }
  });
});
