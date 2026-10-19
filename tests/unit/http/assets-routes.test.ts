import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { makePng } from '../../helpers/png.ts';
import { writeAssetsDir } from '../../helpers/assets-dir.ts';
import { writeTexturesDump } from '../../helpers/textures-dump.ts';
import { gtSampleFile, GT_SAMPLE_ASSETS, I } from '../../helpers/gt-sample.ts';
import { activeExportDir } from '../../../src/server/config.ts';
import { ASSET_KEYS_MAX } from '../../../src/shared/types/api.ts';

let s: TestServer;
const OUTSIDE = makePng(16, 16, [1, 2, 3, 255]);

beforeAll(async () => {
  s = await startTestServer({ pack: null });   // the asset routes work without a recipe pack
  await writeAssetsDir(s.app.config.dataDir, GT_SAMPLE_ASSETS);
  s.app.config.activeExportId = 'e1';
  await writeTexturesDump(activeExportDir(s.app.config), gtSampleFile());
  const outside = await mkdtemp(join(tmpdir(), 'gp-out-'));
  await writeFile(join(outside, 'x.png'), OUTSIDE);
  await symlink(join(outside, 'x.png'), join(s.app.config.dataDir, 'assets', 'link.png'));
  await symlink(outside, join(s.app.config.dataDir, 'assets', 'linkdir'));
});
afterAll(() => s.close());

// Raw request: fetch() would normalise "..", "%2e%2e" and "//" before sending.
function rawGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  const u = new URL(s.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path, headers: { cookie: s.cookie, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/assets/file/*', () => {
  it('serves extracted PNGs with caching headers', async () => {
    const r = await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.body).toEqual(makePng(16, 16, [150, 150, 160, 255]));
    expect((await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png', { 'if-none-match': String(r.headers.etag) })).status).toBe(304);
  });

  it.each([
    '/api/assets/file/%2e%2e/%2e%2e/config.json', '/api/assets/file/gregtech%2f..%2f..%2fconfig.json', '/api/assets/file/a%5cb.png',
    '/api/assets/file/a%00.png', '/api/assets/file//etc/hosts', '/api/assets/file/%E0%A4%A.png', '/api/assets/file/index.json',
    '/api/assets/file/link.png', '/api/assets/file/linkdir/x.png', '/api/assets/file/nope/missing.png',
  ])('refuses %s with 400 or 404', async (path) => {
    const r = await rawGet(path);
    expect([400, 404]).toContain(r.status);
    expect(r.body.includes(OUTSIDE)).toBe(false);
  });

  it('answers 400 for traversal and 404 for files it does not serve', async () => {
    expect((await rawGet('/api/assets/file/%2e%2e/%2e%2e/config.json')).status).toBe(400);
    expect((await rawGet('/api/assets/file/a%5cb.png')).status).toBe(400);
    expect((await rawGet('/api/assets/file/index.json')).status).toBe(404);
    expect((await rawGet('/api/assets/file/link.png')).status).toBe(404);
  });

  it('needs a session', async () => {
    expect((await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png', { cookie: '' })).status).toBe(401);
  });
});

describe('POST /api/assets/icons and /api/assets/blocks', () => {
  it('answers icons in request order', async () => {
    const r = await s.request('/api/assets/icons', { method: 'POST', body: { keys: ['fluid:water', 'gregtech:gt.metaitem.01@11032', 'x:y@0'] } });
    expect(r.status).toBe(200);
    expect((await r.json()).map((d: { key: string; source: string }) => [d.key, d.source]))
      .toEqual([['fluid:water', 'gt'], ['gregtech:gt.metaitem.01@11032', 'gt'], ['x:y@0', 'fallback']]);
  });

  it('answers block faces turned to the requested facing', async () => {
    const r = await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 301 }], facing: 3 } });
    const [b] = await r.json();
    expect(b.faces.south).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: 'gregtech/textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png' }]);
    expect(b.resolved).toBe(true);
  });

  it('answers cover overlays', async () => {
    const r = await s.request('/api/assets/covers', { method: 'POST', body: { items: ['gregtech:gt.metaitem.01@32630'] } });
    expect(await r.json()).toEqual([{ item: 'gregtech:gt.metaitem.01@32630', layers: [{ path: I + 'OVERLAY_CONVEYOR.png' }] }]);
  });

  it('refuses bad or oversized requests', async () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `x:y@${i}`);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: keys(ASSET_KEYS_MAX + 1) } })).status).toBe(400);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: keys(ASSET_KEYS_MAX) } })).status).toBe(200);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: 'x' } })).status).toBe(400);
    expect((await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [{ id: 'a:b', meta: -1 }] } })).status).toBe(400);
    expect((await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [], facing: 9 } })).status).toBe(400);
    expect((await s.request('/api/assets/covers', { method: 'POST', body: { items: keys(ASSET_KEYS_MAX + 1) } })).status).toBe(400);
  });
});
