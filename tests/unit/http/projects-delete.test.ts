import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';

let s: TestServer;
beforeAll(async () => { s = await startTestServer({ pack: packFromSpec({}) }); });
afterAll(async () => { await s.close(); });

const create = async (name = 'MV circuits') => (await s.request('/api/projects', { method: 'POST', body: { name }, name: 'Ann' })).json();
const remove = (id: string, name?: string) => s.request(`/api/projects/${id}`, { method: 'DELETE', name });
const restore = (id: string) => s.request(`/api/projects/${id}/restore`, { method: 'POST', body: {}, name: 'Ann' });
/** A project with a note and a tick (rev 2). */
async function projectWithWork(name = 'MV circuits') {
  const p = await create(name);
  await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann',
    body: { ops: [{ op: 'addNote', note: { id: 'n1', text: 'tap power here' } }, { op: 'mark', row: 'run:a', on: true }] } });
  return (await s.request(`/api/projects/${p.id}`)).json();
}

describe('DELETE /api/projects/:id', () => {
  it('needs a name, like ops', async () => {
    const p = await create();
    const r = await remove(p.id);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'name-required' });
    const bad = await s.request(`/api/projects/${p.id}`, { method: 'DELETE', headers: { 'X-Planner-Name': '%E0%A4%A' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('bad-name');
    expect((await s.request(`/api/projects/${p.id}`)).status).toBe(200);   // still there
  });
  it('answers 204, after which every route for the project answers 404', async () => {
    const p = await projectWithWork();
    const r = await remove(p.id, 'Sam');
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    const routes: Array<[string, string, unknown?]> = [
      ['GET', `/api/projects/${p.id}`],
      ['POST', `/api/projects/${p.id}/ops`, { ops: [{ op: 'rename', name: 'back' }] }],
      ['GET', `/api/projects/${p.id}/plan`],
      ['GET', `/api/projects/${p.id}/events`],
      ['DELETE', `/api/projects/${p.id}`],
    ];
    for (const [method, path, body] of routes) {
      const res = await s.request(path, { method, body, name: 'Ann' });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((await res.json()).error, `${method} ${path}`).toBe('not-found');
    }
    expect((await (await s.request('/api/projects')).json()).map((e: { id: string }) => e.id)).not.toContain(p.id);
    const deleted = await (await s.request('/api/projects?deleted=1')).json();
    expect(deleted.find((e: { id: string }) => e.id === p.id)).toEqual({
      id: p.id, name: 'MV circuits', rev: 2, target: null, updatedAt: expect.any(String), deletedAt: expect.any(String), deletedBy: 'Sam',
    });
  });
  it('404s for an unknown project', async () => {
    const r = await remove('nope', 'Sam');
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('not-found');
  });
  it('tells every open stream of the project, then ends it', async () => {
    const p = await create();
    const other = await create('Other');
    const streams = [await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie), await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie)];
    const bystander = await openSse(`${s.url}/api/projects/${other.id}/events`, s.cookie);
    try {
      for (const es of [...streams, bystander]) await es.next('snapshot');
      expect(s.app.sse.count(p.id)).toBe(2);
      expect((await remove(p.id, 'Jörg 🙂')).status).toBe(204);
      for (const es of streams) {
        const e = await es.next('deleted');
        expect(e.data).toEqual({ id: p.id, by: 'Jörg 🙂', at: expect.any(String) });
        await expect(es.next('op', 1000)).rejects.toThrow('the stream ended');
      }
      expect(s.app.sse.count(p.id)).toBe(0);
      expect(s.app.sse.count(other.id)).toBe(1);
      await expect(bystander.next('deleted', 200)).rejects.toThrow('within 200 ms');
    } finally {
      for (const es of [...streams, bystander]) es.close();
    }
  });
});

describe('GET /api/projects?deleted=1', () => {
  it('lists the recently deleted projects, newest deletion first', async () => {
    const a = await create('First'); const b = await create('Second');
    await remove(b.id, 'Ann');
    await new Promise((r) => setTimeout(r, 5));                          // two deletions in one millisecond would tie
    await remove(a.id, 'Bob');
    const deleted = await (await s.request('/api/projects?deleted=1')).json();
    const ours = deleted.filter((e: { id: string }) => e.id === a.id || e.id === b.id);
    expect(ours.map((e: { name: string; deletedBy: string }) => [e.name, e.deletedBy])).toEqual([['First', 'Bob'], ['Second', 'Ann']]);
    expect(deleted.map((e: { deletedAt: string }) => e.deletedAt)).toEqual([...deleted.map((e: { deletedAt: string }) => e.deletedAt)].sort().reverse());
  });
});

describe('POST /api/projects/:id/restore', () => {
  it('brings the project back unchanged, once', async () => {
    const p = await projectWithWork();
    await remove(p.id, 'Sam');
    const r = await restore(p.id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(p);                                   // same rev, settings, notes and marks
    expect(await (await s.request(`/api/projects/${p.id}`)).json()).toEqual(p);
    expect((await (await s.request('/api/projects')).json()).map((e: { id: string }) => e.id)).toContain(p.id);
    expect((await (await s.request('/api/projects?deleted=1')).json()).map((e: { id: string }) => e.id)).not.toContain(p.id);
    const ops = await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann', body: { ops: [{ op: 'rename', name: 'Back' }] } });
    expect(await ops.json()).toEqual({ rev: 3 });

    const again = await restore(p.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('not-deleted');
    const unknown = await restore('nope');
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe('not-found');
  });
});
