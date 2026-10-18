import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';

let s: TestServer;
beforeAll(async () => { s = await startTestServer({ pack: packFromSpec({}) }); });
afterAll(async () => { await s.close(); });
const create = async (name = 'Steel line') => (await s.request('/api/projects', { method: 'POST', body: { name }, name: 'Ann' })).json();

describe('projects', () => {
  it('creates, lists and gets', async () => {
    const p = await create();
    expect(p).toMatchObject({ name: 'Steel line', createdBy: 'Ann', rev: 0 });
    const list = await (await s.request('/api/projects')).json();
    expect(list[0]).toMatchObject({ id: p.id, name: 'Steel line', rev: 0, target: null });
    expect((await (await s.request(`/api/projects/${p.id}`)).json()).id).toBe(p.id);
    expect((await s.request('/api/projects/nope')).status).toBe(404);
  });
  it('requires a name to create or change anything', async () => {
    expect((await s.request('/api/projects', { method: 'POST', body: { name: 'x' } })).status).toBe(400);
    const p = await create();
    const r = await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', body: { ops: [{ op: 'rename', name: 'y' }] } });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'name-required' });
  });
  it('rejects a bad op with its index and changes nothing', async () => {
    const p = await create();
    const r = await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann',
      body: { ops: [{ op: 'rename', name: 'ok' }, { op: 'settings', patch: { tier: 99 } }] } });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/^op 1: /);
    expect((await (await s.request(`/api/projects/${p.id}`)).json()).rev).toBe(0);
  });
  it('keeps non-ASCII names exactly', async () => {
    const p = await create();
    await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Jörg 🙂', body: { ops: [{ op: 'mark', row: 'run:fluid:water', on: true }] } });
    const q = await (await s.request(`/api/projects/${p.id}`)).json();
    expect(q.marks['run:fluid:water'].by).toBe('Jörg 🙂');
  });
  it('applies concurrent batches in arrival order without losing any', async () => {
    const p = await create();
    const post = (row: string, name: string) => s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name, body: { ops: [{ op: 'mark', row, on: true }] } });
    const revs = await Promise.all(Array.from({ length: 10 }, (_, i) => post(`build:item${i}`, i % 2 ? 'Ann' : 'Bob').then((r) => r.json())));
    expect(revs.map((r) => r.rev).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Object.keys((await (await s.request(`/api/projects/${p.id}`)).json()).marks)).toHaveLength(10);
  });
});

describe('events', () => {
  it('sends a snapshot, then each op from another person within 2 s', async () => {
    const p = await create();
    const es = await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie);
    const snap = await es.next('snapshot');
    expect(snap).toMatchObject({ id: '0', data: { id: p.id, rev: 0 } });
    const sentAt = Date.now();
    await s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Bob', body: { ops: [{ op: 'mark', row: 'step:gather', on: true }] } });
    const ev = await es.next('op');
    expect(ev).toMatchObject({ id: '1', data: { rev: 1, by: 'Bob', op: { op: 'mark', row: 'step:gather', on: true } } });
    expect(ev.receivedAt - sentAt).toBeLessThan(2000);
    es.close();
  });
  it('404s for an unknown project and 401s without a cookie', async () => {
    expect((await s.request('/api/projects/nope/events')).status).toBe(404);
    expect((await s.request('/api/projects/nope/events', { cookie: null })).status).toBe(401);
  });
});

describe('request checks', () => {
  it('checks the name and settings of a new project', async () => {
    const post = (body: unknown) => s.request('/api/projects', { method: 'POST', body, name: 'Ann' });
    for (const body of [[], {}, { name: 7 }, { name: '   ' }, { name: 'x'.repeat(81) }, { name: 'ok', settings: null }, { name: 'ok', settings: { tier: 99 } }]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await r.json()).error).toBe('bad-request');
    }
    const r = await post({ name: '  Titanium  ', settings: { tier: 3, mode: 'makeN', amount: 4 } });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ name: 'Titanium', createdBy: 'Ann', settings: { tier: 3, mode: 'makeN', amount: 4, per: 'min' } });
  });
  it('takes 1 to 100 ops per request and 404s for an unknown project', async () => {
    const p = await create();
    const marks = (n: number) => Array.from({ length: n }, (_, i) => ({ op: 'mark', row: `build:x${i}`, on: true }));
    const send = (id: string, body: unknown) => s.request(`/api/projects/${id}/ops`, { method: 'POST', name: 'Ann', body });
    for (const body of [{}, { ops: [] }, { ops: marks(101) }, { ops: { op: 'rename', name: 'y' } }]) {
      const r = await send(p.id, body);
      expect(r.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect((await r.json()).error).toBe('bad-request');
    }
    expect(await (await send(p.id, { ops: marks(100) })).json()).toEqual({ rev: 100 });
    const r = await send('nope', { ops: marks(1) });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('not-found');
  });
  it('streams one op event per applied op in order, none for a rejected batch, after a snapshot at the current rev', async () => {
    const p = await create();
    const send = (ops: unknown[]) => s.request(`/api/projects/${p.id}/ops`, { method: 'POST', name: 'Ann', body: { ops } });
    await send([{ op: 'rename', name: 'A' }]);
    const es = await openSse(`${s.url}/api/projects/${p.id}/events`, s.cookie);
    try {
      expect(await es.next('snapshot')).toMatchObject({ id: '1', data: { rev: 1, name: 'A' } });
      const bad = await send([{ op: 'rename', name: 'B' }, { op: 'mark', row: 'nowhere', on: true }]);
      expect(await bad.json()).toMatchObject({ error: 'bad-op', message: expect.stringMatching(/^op 1: mark row/) });
      expect(await (await send([{ op: 'rename', name: 'C' }, { op: 'mark', row: 'build:a', on: true }])).json()).toEqual({ rev: 3 });
      const first = await es.next('op');
      const second = await es.next('op');
      expect(first).toMatchObject({ id: '2', data: { rev: 2, by: 'Ann', op: { op: 'rename', name: 'C' } } });
      expect(second).toMatchObject({ id: '3', data: { rev: 3, by: 'Ann', op: { op: 'mark', row: 'build:a', on: true } } });
      expect(typeof (second.data as { at: unknown }).at).toBe('string');
      await expect(es.next('op', 100)).rejects.toThrow('"op"');
    } finally {
      es.close();
    }
  });
});
