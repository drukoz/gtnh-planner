import { describe, it, expect, vi } from 'vitest';
import { startTestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { miniGt } from '../../helpers/mini-gt.ts';
import { addLineParts, makeScan, flatVoxels, areaReader } from '../../helpers/layout-fixtures.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';

async function serverWithProject(withWorld: boolean) {
  const pack = addLineParts(await miniGt());
  const srv = await startTestServer({ pack });
  if (withWorld) {
    const scan = makeScan({ power: [{ voltageTier: 1, average: 500, loadEUt: 10, taps: [{ pos: [0, 64, 16], freeAmps: 8 }] }] });
    const vox = flatVoxels({ origin: [-40, 50, -40], size: [100, 30, 100], groundY: 63 });
    srv.app.services.world = { getScan: async () => scan, readArea: (_id: string, dim: number, bbox: Parameters<ReturnType<typeof areaReader>>[1]) => areaReader(vox)(dim, bbox) };
    srv.app.services.planContext = async () => contextFromScan(scan, pack, '0:0:0');
  }
  const res = await srv.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Plates', settings: { target: 't:iron_plate@0', amount: 24, per: 'min' } } });
  const project = await res.json() as { id: string };
  if (withWorld) await srv.request(`/api/projects/${project.id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'world', scanId: 'S1', baseId: '0:0:0' }] } });
  return { srv, id: project.id };
}

describe('layout route', () => {
  it('serves the layout, finishes the plan with it and re-plans after a placement', async () => {
    const { srv, id } = await serverWithProject(true);
    const layout = await (await srv.request(`/api/projects/${id}/layout`)).json();
    expect(layout.status).toBe('ok');
    expect(layout.blocks.filter((b: { role: string }) => b.role === 'machine').map((b: { block: { mteId: number } }) => b.block.mteId)).toEqual([101, 101]);
    const plan = await (await srv.request(`/api/projects/${id}/plan`)).json();
    expect(plan.power.fits).toBe('yes');
    expect(plan.buildSteps.map((s: { id: string }) => s.id)).toContain('layout:site');
    const sse = await openSse(`${srv.url}/api/projects/${id}/events`, srv.cookie);
    await sse.next('snapshot');
    await srv.request(`/api/projects/${id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'placement', origin: [30, 64, 30], rotation: 0 }] } });
    await sse.next('plan', 5000);
    expect((await (await srv.request(`/api/projects/${id}/layout`)).json()).origin).toEqual([30, 64, 30]);
    sse.close();
    expect((await srv.request('/api/projects/nope/layout')).status).toBe(404);
    await srv.close();
  });

  it('answers 200 with a no-world layout before anyone picked a scan', async () => {
    const { srv, id } = await serverWithProject(false);
    const res = await srv.request(`/api/projects/${id}/layout`);
    expect(res.status).toBe(200);
    const layout = await res.json();
    expect([layout.status, layout.warnings[0]?.code]).toEqual(['no-world', 'no_scan']);   // the line's own wiring warnings follow
    await srv.close();
  });

  // Rules of the brief its tests above leave out.

  it('passes an HttpError through and answers any other failure with layout-failed', async () => {
    const bare = await startTestServer();
    const created = await (await bare.request('/api/projects', { method: 'POST', name: 'Ann', body: { name: 'Plates' } })).json() as { id: string };
    const noExport = await bare.request(`/api/projects/${created.id}/layout`);
    expect([noExport.status, (await noExport.json()).error]).toEqual([503, 'no-export']);
    await bare.close();

    const { srv, id } = await serverWithProject(true);
    srv.app.services.world = { getScan: async () => { throw new Error('disk gone'); } };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await srv.request(`/api/projects/${id}/layout`);
      expect([res.status, await res.json()]).toEqual([500, { error: 'layout-failed', message: 'The line layout failed: disk gone' }]);
      expect(logged).toHaveBeenCalledTimes(1);
      const plan = await (await srv.request(`/api/projects/${id}/plan`)).json();
      expect(plan.warnings.map((w: { code: string }) => w.code)).toContain('layout-failed');
    } finally {
      logged.mockRestore();
    }
    await srv.close();
  });
});
