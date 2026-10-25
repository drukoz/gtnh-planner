import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { crossSpec } from '../../helpers/farm-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { projectorLayout, CONVEYOR } from '../../helpers/projector-fixtures.ts';
import { HttpError, type TokenVerifier } from '../../../src/server/http/router.ts';
import { tokenStore } from '../../../src/server/http/routes/projector.ts';
import { mergeBuildSteps } from '../../../src/server/layout/merge.ts';
import type { LayoutService } from '../../../src/server/layout/service.ts';
import { TokenLimitError, TokenStore } from '../../../src/server/projector/tokens.ts';
import { surplusBoardFor } from '../../../src/server/projects/surplus.ts';
import type { Plan } from '../../../src/shared/types/plan.ts';
import type { CreateTokenResult, ProjectorPayload, TokenInfo } from '../../../src/shared/types/projector.ts';

let s: TestServer; let id: string; let fail: Error | null = null;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({ items: [{ key: CONVEYOR, name: 'Conveyor Module (LV)' }] }) });
  id = (await (await s.request('/api/projects', { method: 'POST', body: { name: 'Steel line' }, name: 'Ann' })).json()).id;
  s.app.services.layout = { layoutFor: async () => { if (fail) throw fail; return projectorLayout(); }, finishPlan: async (p: unknown) => p, computations: 0 };
});
afterAll(async () => { await s.close(); });
const createProject = async (name: string): Promise<string> => (await (await s.request('/api/projects', { method: 'POST', body: { name }, name: 'Ann' })).json()).id;
const newToken = async (label = 'Steve', project = id): Promise<CreateTokenResult> => (await s.request(`/api/projects/${project}/tokens`, { method: 'POST', body: { label }, name: 'Ann' })).json();
const projector = (token: string, project = id) => s.request(`/api/projects/${project}/projector`, { cookie: null, headers: { authorization: `Bearer ${token}` } });

describe('projector routes', () => {
  it('creates a token, shows it once and lists it without the secret', async () => {
    const r = await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' });
    expect(r.status).toBe(201);
    const made = (await r.json()) as CreateTokenResult;
    expect(made.token).toMatch(/^gpt_[A-Za-z0-9_-]{43}$/);
    expect(made.info).toMatchObject({ label: 'Steve', createdBy: 'Ann', lastUsedAt: null, projectId: id });
    const listed = await (await s.request(`/api/projects/${id}/tokens`)).text();
    expect(listed).not.toContain(made.token);
    expect((JSON.parse(listed) as TokenInfo[]).map((t) => t.tokenId)).toContain(made.tokenId);
  });

  it('refuses token changes without a name, a cookie or a known project', async () => {
    expect((await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: {} })).status).toBe(400);
    expect((await s.request(`/api/projects/nope/tokens`, { method: 'POST', body: {}, name: 'Ann' })).status).toBe(404);
    const { token } = await newToken();
    expect((await s.request(`/api/projects/${id}/tokens`, { cookie: null, headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('serves the projector payload to a token', async () => {
    const { token } = await newToken();
    const r = await projector(token);
    expect(r.status).toBe(200);
    const p = (await r.json()) as ProjectorPayload;
    expect([p.projectId, p.name, p.blocks.length, p.blocks[3]!.covers?.[0]!.label]).toEqual([id, 'Steel line', 10, 'Conveyor Module (LV)']);
    expect((await s.request(`/api/projects/${id}/tokens`)).ok).toBe(true);
  });

  it('a revoked token gets 401', async () => {
    const { token, tokenId } = await newToken('old');
    expect((await s.request(`/api/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await projector(token)).status).toBe(401);
    expect((await s.request(`/api/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('says when the layout fails', async () => {
    const { token } = await newToken();
    fail = new Error('boom');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await projector(token);
      expect([r.status, await r.json()]).toEqual([500, { error: 'layout-failed', message: 'The line layout failed: boom' }]);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      fail = null;
      logged.mockRestore();
    }
  });

  it('caps tokens per project', async () => {
    const pid = await createProject('Many');
    for (let i = 0; i < 20; i++) await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {}, name: 'Ann' });
    const r = await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {}, name: 'Ann' });
    const body = await r.json();
    expect([r.status, body.error, body.message]).toEqual([409, 'too-many-tokens', new TokenLimitError().message]);
  });

  // Rules of the brief that the tests above leave out.

  it("a deleted project's token gets 401 and its token routes 404 until it is restored", async () => {
    const pid = await createProject('Doomed');
    const { token, tokenId } = await newToken('Steve', pid);
    expect((await projector(token, pid)).status).toBe(200);
    expect((await s.request(`/api/projects/${pid}`, { method: 'DELETE', name: 'Ann' })).status).toBe(204);
    expect((await projector(token, pid)).status).toBe(401);
    expect((await s.request(`/api/projects/${pid}/tokens`)).status).toBe(404);
    expect((await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {}, name: 'Ann' })).status).toBe(404);
    expect((await s.request(`/api/projects/${pid}/tokens/${tokenId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await s.request(`/api/projects/${pid}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await projector(token, pid)).status).toBe(200);
    expect(((await (await s.request(`/api/projects/${pid}/tokens`)).json()) as TokenInfo[]).map((t) => t.tokenId)).toEqual([tokenId]);
  });

  it('keeps a token to its own project, and a session cookie needs no token', async () => {
    const other = await createProject('Circuits');
    const mine = await newToken('Steve');
    const theirs = await newToken('Alex', other);
    expect((await projector(mine.token, other)).status).toBe(401);
    // revoking goes through the project that owns the token
    expect((await s.request(`/api/projects/${id}/tokens/${theirs.tokenId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await projector(theirs.token, other)).status).toBe(200);
    expect((await s.request(`/api/projects/${id}/projector`)).status).toBe(200);
  });

  it('answers 404 not-found on every route for an unknown project', async () => {
    for (const [method, path] of [['GET', 'tokens'], ['DELETE', 'tokens/T1aaaaaaaa'], ['GET', 'projector']] as const) {
      const r = await s.request(`/api/projects/nope/${path}`, { method });
      // the project's own 404, not the router's "No API route" for a path nobody serves
      expect([method, path, r.status, await r.json()]).toEqual([method, path, 404, { error: 'not-found', message: 'No project nope' }]);
    }
  });

  it('answers the missing name in plain words and takes a label of any shape', async () => {
    const pid = await createProject('Labels');
    const noName = await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {} });
    expect([noName.status, await noName.json()]).toEqual([400, { error: 'name-required', message: 'Tell us your name first' }]);
    const labels: unknown[] = [{}, null, { label: 42 }, { label: '  Alex  ' }];
    const made: CreateTokenResult[] = [];
    for (const body of labels) made.push(await (await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body, name: 'Ann' })).json());
    expect(made.map((m) => m.info.label)).toEqual(['Projector token', 'Projector token', 'Projector token', 'Alex']);
    expect((await s.request(`/api/projects/${pid}/tokens`)).status).toBe(200);
  });

  it('passes an HttpError from the layout through', async () => {
    const { token } = await newToken();
    fail = new HttpError(503, 'no-export', 'No recipe export yet — run npm run export');
    try {
      const r = await projector(token);
      expect([r.status, (await r.json()).error]).toEqual([503, 'no-export']);
    } finally {
      fail = null;
    }
  });

  it('registers the token store and the bearer check on the app', async () => {
    const { token, tokenId } = await newToken();
    const store = s.app.services.tokens;
    expect(store).toBeInstanceOf(TokenStore);
    expect(tokenStore(s.app)).toBe(store);
    const verify = s.app.services.verifyToken as TokenVerifier;
    expect([verify(token, id), verify(token, 'nope'), verify('gpt_nope', id)]).toEqual([{ tokenId }, null, null]);
  });

  it('lays out the plan whose build steps it numbers, planned once', async () => {
    // add-on 17 Task 6: Q takes P's Wyes. P's summary is withdrawn while Q's line is laid out, as a publish of P landing
    // then would change it, so a plan made again after the layout would be another line (Q making its own Wyes).
    const t = await startTestServer({ pack: packFromSpec(crossSpec()) });
    try {
      const create = async (name: string, settings: object): Promise<string> => (await (await t.request('/api/projects', {
        method: 'POST', name: 'Ann', body: { name, settings: { per: 'hour', objective: 'least-raw', ...settings } },
      })).json()).id;
      const p = await create('P', { target: 't:t@0', amount: 60 });
      const q = await create('Q', { target: 't:q@0', amount: 30 });
      expect((await t.request(`/api/projects/${p}/plan`)).status).toBe(200);
      const given: Array<Plan | undefined> = [];
      t.app.services.layout = {
        layoutFor: async (_project, plan) => {
          given.push(plan);
          surplusBoardFor(t.app).remove(p);
          return projectorLayout();
        },
        finishPlan: async (plan) => plan, computations: 0,
      } satisfies LayoutService;
      const made = (await (await t.request(`/api/projects/${q}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' })).json()) as CreateTokenResult;
      const r = await t.request(`/api/projects/${q}/projector`, { cookie: null, headers: { authorization: `Bearer ${made.token}` } });
      expect(r.status).toBe(200);
      const payload = (await r.json()) as ProjectorPayload;
      expect(given).toHaveLength(1);
      const plan = given[0];
      expect(plan?.rawInputs.filter((x) => x.from !== undefined).map((x) => x.from?.id)).toEqual([p]);
      const numbered = mergeBuildSteps(plan!.buildSteps, projectorLayout().buildSteps);
      expect(payload.steps.map((x) => [x.order, x.id, x.text])).toEqual(numbered.map((x) => [x.order, x.id, x.text]));
      // the plan's own steps are among them, not only the layout's
      expect(payload.steps.at(-1)?.id).toBe('test');
    } finally {
      await t.close();
    }
  });
});
