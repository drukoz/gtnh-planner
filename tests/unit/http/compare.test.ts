import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { farmPack } from '../../helpers/farm-fixtures.ts';
import { planCacheFor, planForProject } from '../../../src/server/http/routes/projects.ts';
import { compareSummary, modeSettings } from '../../../src/server/planner/compare.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import { summaryOf, surplusBoardFor } from '../../../src/server/projects/surplus.ts';
import type { CompareMode, CompareResult } from '../../../src/shared/types/api.ts';
import { PLAN_OBJECTIVES, type Plan, type PlanObjective, type PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';

// Add-on 17 Task 7 (architecture §11.45 (5)): the Compare card's endpoint on the synthetic farm pack, resin boards 1 a
// minute at HV. Every case starts its own server, so no plan of another case is in its plan cache.
const PACK = farmPack();
let s: TestServer;
beforeEach(async () => { s = await startTestServer({ pack: PACK }); });
afterEach(async () => { await s.close(); });

const BOARD: Partial<PlanSettings> = { target: 't:resin_board@0', amount: 1, per: 'min', tier: 3 };

async function create(settings: Partial<PlanSettings>): Promise<Project> {
  const r = await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Boards', settings } });
  expect(r.status).toBe(201);
  return r.json();
}
async function compare(id: string): Promise<CompareResult> {
  const r = await s.request(`/api/projects/${id}/compare`);
  expect(r.status).toBe(200);
  return r.json();
}
async function plan(id: string): Promise<Plan> {
  const r = await s.request(`/api/projects/${id}/plan`);
  expect(r.status).toBe(200);
  return r.json();
}
const project = async (id: string): Promise<Project> => (await s.request(`/api/projects/${id}`)).json();
/** Plans this app's cache has computed so far. */
const computations = (): number => planCacheFor(s.app).computations;
/** `project`'s plan in mode `o`, as the card plans it: from the plan cache, publishing nothing. */
const modePlan = (p: Project, o: PlanObjective): Promise<Plan> => planForProject(s.app, p, { settings: modeSettings(p.settings, o), publish: false });
const column = (result: CompareResult, o: PlanObjective): CompareMode => result.modes.find((m) => m.objective === o)!;
const APPROX = new Set(['build-cost-approx', 'sources-approx']);

describe('GET /api/projects/:id/compare (add-on 17, architecture §11.45 (5))', () => {
  it('compares the three modes of a project', async () => {
    const p = await create(BOARD);
    const result = await compare(p.id);
    expect(result.rev).toBe(p.rev);
    expect(result.current).toBe('cheapest');
    expect(result.modes.map((m) => [m.objective, m.status])).toEqual(PLAN_OBJECTIVES.map((o) => [o, 'ok']));
    // each column sums up its mode's plan, which the plan cache holds: planning it again computes nothing
    const before = computations();
    const plans = new Map<PlanObjective, Plan>();
    for (const o of PLAN_OBJECTIVES) plans.set(o, await modePlan(p, o));
    expect(computations()).toBe(before);
    for (const o of PLAN_OBJECTIVES) expect(column(result, o).summary, o).toEqual(compareSummary(plans.get(o)!));
    // Best multi-output starts from cheapest's decision and its objective is cheapest's plus a weight per source, so it
    // needs no more raw sources than cheapest where both build MIPs ended optimal (on this small graph they do).
    const approx = [...plans.get('cheapest')!.warnings, ...plans.get('multi-output')!.warnings].filter((w) => APPROX.has(w.code));
    if (approx.length === 0) {
      expect(column(result, 'multi-output').summary!.rawSources).toBeLessThanOrEqual(column(result, 'cheapest').summary!.rawSources);
    } else {
      console.info('multi-output vs cheapest raw sources not compared:', approx.map((w) => w.code));
    }
    // a compare publishes nothing for the other projects
    expect(surplusBoardFor(s.app).get(p.id)).toBeNull();
    // the cheapest column is the project's own plan, one cached plan with the plan route
    const served = await plan(p.id);
    expect(computations()).toBe(before);
    expect(compareSummary(served)).toEqual(column(result, 'cheapest').summary);
    expect((await s.request('/api/projects/nope/compare')).status).toBe(404);
  });

  it('uses a mode from the card', async () => {
    const p = await create(BOARD);
    const first = await compare(p.id);
    const before = computations();
    const es = await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie);
    try {
      await es.next('snapshot');
      const r = await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'settings', patch: { objective: 'least-raw' } }] } });
      expect(r.status).toBe(200);
      // the replan of the new settings, which the card planned already
      await es.next('plan');
    } finally {
      es.close();
    }
    const again = await compare(p.id);
    expect(again.rev).toBe(1);
    expect(again.current).toBe('least-raw');
    expect(again.modes).toEqual(first.modes);
    expect(computations()).toBe(before);
    // the plan route serves the card's least-raw plan, and that cache hit publishes its summary
    const served = await plan(p.id);
    expect(served.objective).toBe('least-raw');
    expect(computations()).toBe(before);
    const now = await project(p.id);
    const least = await modePlan(now, 'least-raw');
    expect(compareSummary(least)).toEqual(column(first, 'least-raw').summary);
    const stored = surplusBoardFor(s.app).get(p.id);
    expect(stored).not.toBeNull();
    expect(stored).toEqual(summaryOf(now, least, stored!.at));
  });

  it('compares the project as it is now, never a compare of its earlier world', async () => {
    const p = await create(BOARD);
    // The compare of the project's first world waits in its current mode for the world context.
    const gate = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    s.app.services.planContext = async (whose) => {
      if (whose.world.scanId === null) {
        waiting.resolve();
        await gate.promise;
      }
      return emptyContext();
    };
    const earlier = compare(p.id);
    await waiting.promise;
    const es = await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie);
    try {
      await es.next('snapshot');
      const r = await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'world', scanId: 'scan-1', baseId: null }] } });
      expect(r.status).toBe(200);
      await es.next('plan');
    } finally {
      es.close();
    }
    // The next compare's request reads the project and asks for its compare at once: let the first one go only then.
    const projects = s.app.projects;
    const read = projects.get.bind(projects);
    const asked = Promise.withResolvers<void>();
    projects.get = (id) => {
      asked.resolve();
      return read(id);
    };
    const now = compare(p.id);
    await asked.promise;
    projects.get = read;
    gate.resolve();
    // the first one went stale: it finished the mode it was in and started no other
    expect((await earlier).modes.map((m) => m.status)).toEqual(['pending', 'ok', 'pending']);
    const answer = await now;
    expect(answer.rev).toBe(1);
    expect(answer.modes.map((m) => m.status)).toEqual(['ok', 'ok', 'ok']);
    // and the newer one planned every mode in the project's new world
    const moved = await project(p.id);
    expect(moved.world.scanId).toBe('scan-1');
    const before = computations();
    for (const o of PLAN_OBJECTIVES) await modePlan(moved, o);
    expect(computations()).toBe(before);
  });
});
