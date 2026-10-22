import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { bearerToken } from '../../../src/server/http/auth.ts';
import { tokenMayApply } from '../../../src/server/http/routes/projects.ts';
import type { TokenVerifier } from '../../../src/server/http/router.ts';
import type { ProjectOp } from '../../../src/shared/types/project.ts';

let s: TestServer; let id: string; let other: string;
const create = async (name: string) => (await (await s.request('/api/projects', { method: 'POST', body: { name }, name: 'Ann' })).json()).id as string;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({}) });
  id = await create('Steel line');
  other = await create('Circuits');
  const verify: TokenVerifier = (token, projectId) => (token === 'gpt_good' && projectId === id ? { tokenId: 't1' } : null);
  s.app.services.verifyToken = verify;
});
afterAll(async () => { await s.close(); });
const withToken = (path: string, init: { method?: string; body?: unknown; name?: string; token?: string } = {}) => {
  const { token = 'gpt_good', ...rest } = init;
  return s.request(path, { ...rest, cookie: null, headers: { authorization: `Bearer ${token}` } });
};
const mark = (row: string) => ({ ops: [{ op: 'mark', row, on: true }] });

describe('bearer tokens', () => {
  it('parses only the Bearer scheme', () => {
    expect([bearerToken('Bearer gpt_a'), bearerToken('bearer   gpt_a'), bearerToken('Basic gpt_a'), bearerToken('Bearer'), bearerToken('Bearer a b'), bearerToken(undefined)])
      .toEqual(['gpt_a', 'gpt_a', null, null, null, null]);
    expect(tokenMayApply([{ op: 'mark', row: 'step:layout:site', on: true }])).toBe(true);
    expect(tokenMayApply([{ op: 'mark', row: 'build:x@0', on: true }])).toBe(false);
    expect(tokenMayApply([{ op: 'rename', name: 'x' }])).toBe(false);
  });

  it('reads its own project and layout and nothing else', async () => {
    expect((await withToken(`/api/projects/${id}`)).status).toBe(200);
    expect((await withToken(`/api/projects/${id}/layout`)).status).toBe(200);
    for (const path of ['/api/projects', `/api/projects/${id}/plan`, `/api/projects/${id}/events`, `/api/projects/${other}`, `/api/projects/${other}/layout`, '/api/pack'])
      expect((await withToken(path)).status, path).toBe(401);
    expect((await withToken(`/api/projects/${id}`, { token: 'gpt_bad' })).status).toBe(401);
    expect((await s.request(`/api/projects/${id}`, { cookie: null, headers: { authorization: 'Basic gpt_good' } })).status).toBe(401);
  });

  it('ticks build steps in the player\'s name and refuses every other change', async () => {
    const ok = await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('step:layout:place:s1'), name: 'Steve' });
    expect(ok.status).toBe(200);
    const p = await (await s.request(`/api/projects/${id}`)).json();
    expect(p.marks['step:layout:place:s1']).toMatchObject({ by: 'Steve' });
    const rename = await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: { ops: [{ op: 'rename', name: 'x' }] }, name: 'Steve' });
    expect([rename.status, (await rename.json()).error]).toEqual([403, 'token-scope']);
    expect((await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('build:x@0'), name: 'Steve' })).status).toBe(403);
    expect((await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('step:layout:site') })).status).toBe(400);
    expect((await withToken(`/api/projects/${other}/ops`, { method: 'POST', body: mark('step:layout:site'), name: 'Steve' })).status).toBe(401);
  });

  it('keeps full rights for a valid cookie even with a bad Authorization header', async () => {
    const r = await s.request(`/api/projects/${id}/ops`, { method: 'POST', body: { ops: [{ op: 'rename', name: 'Steel line 2' }] }, name: 'Ann', headers: { authorization: 'Bearer gpt_bad' } });
    expect(r.status).toBe(200);
  });

  it('refuses the whole batch when any op is not a step tick, and applies none of it', async () => {
    expect(tokenMayApply([{ op: 'mark', row: 'step:layout:site', on: true }, { op: 'rename', name: 'x' }])).toBe(false);
    expect(tokenMayApply([null] as unknown as ProjectOp[])).toBe(false);
    expect(tokenMayApply([{ op: 'mark', row: 7, on: true }] as unknown as ProjectOp[])).toBe(false);
    const mixed = { ops: [{ op: 'mark', row: 'step:layout:hookup', on: true }, { op: 'rename', name: 'x' }] };
    expect((await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mixed, name: 'Steve' })).status).toBe(403);
    expect((await (await s.request(`/api/projects/${id}`)).json()).marks['step:layout:hookup']).toBeUndefined();
  });

  it('refuses every token while no verifier is registered', async () => {
    const verify = s.app.services.verifyToken;
    delete s.app.services.verifyToken;
    try {
      expect((await withToken(`/api/projects/${id}`)).status).toBe(401);
    } finally {
      s.app.services.verifyToken = verify;
    }
  });
});
