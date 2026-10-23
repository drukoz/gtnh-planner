import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { addLineParts, makeScan, flatVoxels, areaReader } from '../../helpers/layout-fixtures.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import type { CreateTokenResult, ProjectorPayload } from '../../../src/shared/types/projector.ts';

// The projector against Plan 5's real layout (no fake layout service): a Mini-GT plate line placed in a flat scanned
// world, set up as tests/unit/layout/route.test.ts sets up its project.
let s: TestServer; let id: string;
beforeAll(async () => {
  const pack = addLineParts(await miniGt());
  s = await startTestServer({ pack });
  const scan = makeScan({ power: [{ voltageTier: 1, average: 500, loadEUt: 10, taps: [{ pos: [0, 64, 16], freeAmps: 8 }] }] });
  const vox = flatVoxels({ origin: [-40, 50, -40], size: [100, 30, 100], groundY: 63 });
  s.app.services.world = { getScan: async () => scan, readArea: (_id: string, dim: number, bbox: Parameters<ReturnType<typeof areaReader>>[1]) => areaReader(vox)(dim, bbox) };
  s.app.services.planContext = async () => contextFromScan(scan, pack, '0:0:0');
  const settings = { target: 't:iron_plate@0', amount: 24, per: 'min' };
  id = (await (await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Plates', settings } })).json()).id;
  await s.request(`/api/projects/${id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'world', scanId: 'S1', baseId: '0:0:0' }] } });
});
afterAll(async () => { await s.close(); });

async function payload(): Promise<ProjectorPayload> {
  const made = (await (await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' })).json()) as CreateTokenResult;
  const r = await s.request(`/api/projects/${id}/projector`, { cookie: null, headers: { authorization: `Bearer ${made.token}` } });
  expect(r.status).toBe(200);
  return r.json();
}

const ordersById = (steps: ReadonlyArray<{ id: string; order: number }>): Record<string, number> => Object.fromEntries(steps.map((x) => [x.id, x.order]));

describe('projector payload on the real layout', () => {
  it('numbers every step as the plan route numbers the checklist', async () => {
    const p = await payload();
    const plan = (await (await s.request(`/api/projects/${id}/plan`)).json()) as Plan;
    const layout = (await (await s.request(`/api/projects/${id}/layout`)).json()) as Layout;
    expect(p.status).toBe('ok');
    expect(ordersById(p.steps)).toEqual(ordersById(plan.buildSteps));
    expect(p.steps.map((x) => x.text)).toEqual([...plan.buildSteps].sort((a, b) => a.order - b.order).map((x) => x.text));

    // Plan 2's gather, craft and make steps come first and place nothing, so the layout's steps get later numbers
    const before = p.steps.filter((x) => x.kind === 'gather' || x.kind === 'craft' || x.kind === 'make');
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((x) => x.blocks.length === 0 && x.order <= before.length)).toBe(true);
    const place = p.steps.find((x) => x.id.startsWith('layout:place:'))!;
    expect(place.blocks).toHaveLength(2);
    expect(place.order).toBe(layout.buildSteps.find((x) => x.id === place.id)!.order + before.length);
  });

  it("marks the machines' facing as their output side, where their conveyor cover goes", async () => {
    const machines = (await payload()).blocks.filter((b) => b.role === 'machine');
    expect(machines).toHaveLength(2);
    for (const m of machines) {
      expect(m).toMatchObject({ facingIsOutput: true });
      expect(m.covers?.map((c) => c.face)).toContain(m.facing);
    }
  });
});
