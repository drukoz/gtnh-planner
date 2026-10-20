import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { ASSET_KEYS_MAX } from '../../../src/shared/types/api.ts';

const pack = packFromSpec({ items: [{ key: 't:iron_ingot@0', name: 'Iron Ingot' }], fluids: [{ key: 'fluid:water', name: 'Water' }] });

let s: TestServer;
beforeAll(async () => { s = await startTestServer({ pack }); });
afterAll(async () => { await s.close(); });

const names = (server: TestServer, body: unknown) => server.request('/api/pack/names', { method: 'POST', body });

describe('POST /api/pack/names', () => {
  it('names items and fluids in request order, null for a key the pack does not hold', async () => {
    const r = await names(s, { keys: ['t:iron_ingot@0', 'nope:nope@0', 'fluid:water'] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(['Iron Ingot', null, 'Water']);
  });

  it('takes at most ASSET_KEYS_MAX keys of at most 300 characters', async () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `x:y@${i}`);
    const many = await names(s, { keys: keys(ASSET_KEYS_MAX + 1) });
    expect(many.status).toBe(400);
    expect(await many.json()).toMatchObject({ error: 'too-many' });
    expect(await (await names(s, { keys: keys(ASSET_KEYS_MAX) })).json()).toHaveLength(ASSET_KEYS_MAX);
    expect((await names(s, { keys: 'x' })).status).toBe(400);
    expect((await names(s, { keys: ['x'.repeat(301)] })).status).toBe(400);
  });

  it('answers 503 no-export without an active export', async () => {
    const t = await startTestServer({ pack: null });
    const r = await names(t, { keys: ['t:iron_ingot@0'] });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'no-export' });
    await t.close();
  });
});
