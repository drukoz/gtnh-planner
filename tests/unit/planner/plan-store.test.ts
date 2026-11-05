import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { planCacheFor } from '../../../src/server/http/routes/projects.ts';
import { planCacheKey, settingsHash } from '../../../src/server/planner/plan.ts';
import { openPlanStore, planStoreFor } from '../../../src/server/planner/plan-store.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'gp-plan-store-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** The plan key of `p` on the Mini-GT export, without a scan or base. */
const keyOf = (p: Project): string => planCacheKey(settingsHash(p.settings), miniGt().manifest.exportId, null, null);
const create = async (s: TestServer): Promise<Project> =>
  (await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Circuits', settings: { target: 't:circuit@0', tier: 1 } } })).json();

describe('openPlanStore', () => {
  it('deletes what a put that died left behind, and reads what an earlier open kept under the same version only', async () => {
    const at = join(dir, 'open');
    await openPlanStore(at, 'v1').plans.put('k', { a: 1 });
    const plans = join(at, 'cache', 'plans');
    writeFileSync(join(plans, 'x.json.gz.123.0.tmp'), 'half');
    const again = openPlanStore(at, 'v1');
    expect(readdirSync(plans).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(await again.plans.get('k')).toEqual({ a: 1 });
    expect(await again.goods.get('k')).toBeUndefined();
    expect(await openPlanStore(at, 'v2').plans.get('k')).toBeUndefined();
  });
});

describe('planStoreFor and the plan route', () => {
  let first: TestServer;
  let second: TestServer;
  beforeAll(async () => {
    first = await startTestServer({ pack: miniGt() });
    second = await startTestServer({ pack: miniGt() });
  });
  afterAll(async () => {
    await first.close();
    await second.close();
  });

  it('gives the app\'s store, none without one, and none while the project\'s scan is not done', () => {
    const at = (scanId: string | null): Project => ({ world: { scanId, baseId: null } }) as Project;
    expect(planStoreFor(first.app, at(null))).toBeUndefined();
    const store = openPlanStore(join(dir, 'for'), 'v1');
    first.app.services.planStore = store;
    try {
      expect(planStoreFor(first.app, at(null))).toBe(store);
      expect(planStoreFor(first.app, at('no-such-scan'))).toBeUndefined();
    } finally {
      delete first.app.services.planStore;
    }
  });

  it('keeps the plans and goods it works out, and a server with nothing in memory serves the plan its store holds', async () => {
    // one store object for both servers: opening a folder again deletes the temp files of puts still under way
    const store = openPlanStore(join(dir, 'route'), 'v1');
    first.app.services.planStore = store;
    try {
      const a = await create(first);
      const made = (await (await first.request(`/api/projects/${a.id}/plan`)).json()) as Plan;
      expect(made.status).toBe('ok');
      await vi.waitFor(async () => {
        expect(((await store.plans.get(keyOf(a))) as Plan | undefined)?.settingsHash).toBe(made.settingsHash);
        expect(Array.isArray(await store.goods.get(keyOf(a)))).toBe(true);
      });
      // the same settings on another server: the same key, so the copy marked here is what it must serve, unplanned
      const b = await create(second);
      expect(keyOf(b)).toBe(keyOf(a));
      const kept = (await store.plans.get(keyOf(b))) as Plan;
      await store.plans.put(keyOf(b), { ...kept, warnings: [...kept.warnings, { code: 'kept', text: 'from the store' }] });
      second.app.services.planStore = store;
      const served = (await (await second.request(`/api/projects/${b.id}/plan`)).json()) as Plan;
      expect(served.warnings.map((w) => w.code)).toContain('kept');
      expect(served.steps.map((s) => s.id)).toEqual(made.steps.map((s) => s.id));
      expect(planCacheFor(second.app).computations).toBe(1);
    } finally {
      delete first.app.services.planStore;
      delete second.app.services.planStore;
    }
  });
});
