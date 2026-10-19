import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { projectorLayout } from '../../helpers/projector-fixtures.ts';
import type { CreateTokenResult, ProjectorPayload, TokenInfo } from '../../../src/shared/types/projector.ts';

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({}) });
  s.app.services.layout = { layoutFor: async () => projectorLayout(), finishPlan: async (p: unknown) => p, computations: 0 };
});
afterAll(async () => { await s.close(); });

describe('projector end to end (server side)', () => {
  it('a player loads the line, ticks a step in their name, the browser sees it live, and revoking ends access', async () => {
    const project = await (await s.request('/api/projects', { method: 'POST', body: { name: 'Steel line' }, name: 'Ann' })).json();
    const made = (await (await s.request(`/api/projects/${project.id}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' })).json()) as CreateTokenResult;
    const mod = (path: string, init: { method?: string; body?: unknown } = {}) =>
      s.request(`/api/projects/${project.id}${path}`, { ...init, name: 'Steve', cookie: null, headers: { authorization: `Bearer ${made.token}` } });

    const before = (await (await mod('/projector')).json()) as ProjectorPayload;
    expect(before.steps.find((x) => x.id === 'layout:place:s1')).toMatchObject({ order: 2, blocks: [3, 4], done: false });

    const sse = await openSse(`${s.url}/api/projects/${project.id}/events`, s.cookie);
    await sse.next('snapshot');
    expect((await mod('/ops', { method: 'POST', body: { ops: [{ op: 'mark', row: 'step:layout:place:s1', on: true }] } })).status).toBe(200);
    expect((await sse.next('op')).data).toMatchObject({ op: { op: 'mark', row: 'step:layout:place:s1', on: true }, by: 'Steve' });
    sse.close();

    const after = (await (await mod('/projector')).json()) as ProjectorPayload;
    expect(after.steps.find((x) => x.id === 'layout:place:s1')?.done).toBe(true);
    expect(after.version).toBe(before.version);
    const tokens = (await (await s.request(`/api/projects/${project.id}/tokens`)).json()) as TokenInfo[];
    expect(tokens[0]!.lastUsedAt).not.toBeNull();

    expect((await s.request(`/api/projects/${project.id}/tokens/${made.tokenId}`, { method: 'DELETE' })).status).toBe(204);
    for (const path of ['/projector', '/layout', '']) expect((await mod(path)).status, path).toBe(401);
  });
});
