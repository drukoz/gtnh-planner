import { request } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/server/app.ts';
import { DEFAULT_CONFIG, type AppConfig } from '../../../src/server/config.ts';
import { worldRoutes } from '../../../src/server/http/routes/world.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import type { WorldService } from '../../../src/server/world/scan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { NAME_HEADER } from '../../../src/shared/types/api.ts';
import type { PlanContext, PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import type { Base, ScanStatus } from '../../../src/shared/types/world.ts';
import { SAMPLE, SAMPLE_BACKUP, makeSampleWorld } from '../../helpers/sample-world.ts';
import { serveRoutes } from '../../helpers/serve-routes.ts';
import { startTestServer } from '../../helpers/test-server.ts';
import { testPack } from '../../helpers/world-facts.ts';

// app = { config, services: {}, pack: async () => testPack() } as unknown as AppContext, served with
// serveRoutes(worldRoutes(app)); config.serverFolder = makeSampleWorld(tmp/srv), whose complete backup BACKUP is
// 10 minutes old. DONE = the id of a finished scan of that backup.

const BACKUP = SAMPLE_BACKUP;
const B1 = Buffer.from([1]);
const RUNNING_ID = '20261017T120000Z-abcdef';

let tmp: string, config: AppConfig, app: AppContext, url: string, close: () => Promise<void>;
let DONE: string, LEVEL_BYTES: Buffer, REGION_BYTES: Buffer;

interface Answer { status: number; body: string }

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}${path}`, {
    method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getJson(path: string): Promise<any> {
  const res = await call('GET', path);
  if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postJson(path: string, body: unknown, headers?: Record<string, string>): Promise<any> {
  const res = await call('POST', path, body, headers);
  if (res.status !== 200) throw new Error(`POST ${path} answered ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * A raw node:http request to `/api/world/uploads/<uploadId>/files/<path exactly as given>` (fetch's URL parser would
 * resolve '%2e%2e/' away before the server sees it). `bytes` null sends only the headers.
 */
function rawPut(uploadId: string, path: string, headers: Record<string, string | number>, bytes: Buffer | null): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const req = request({ hostname, port, method: 'PUT', path: `/api/world/uploads/${uploadId}/files/${path}`, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
        if (bytes === null) req.destroy();   // the server answered without reading a body that never comes
      });
    });
    req.on('error', reject);
    if (bytes === null) req.flushHeaders();
    else req.end(bytes);
  });
}

function put(uploadId: string, path: string, bytes: Buffer): Promise<Answer> {
  return rawPut(uploadId, path, { 'content-type': 'application/octet-stream', 'content-length': bytes.length }, bytes);
}

/** Sends only a Content-Length header of `length` bytes, and no body. */
function putDeclared(uploadId: string, path: string, length: number): Promise<Answer> {
  return rawPut(uploadId, path, { 'content-length': length }, null);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function projectWith(scanId: string | null, baseId: string | null, settings: Partial<PlanSettings> = {}): Project {
  return {
    id: 'p-1', name: 'Line', createdAt: '2026-10-17T12:00:00.000Z', createdBy: 'Tester', rev: 1,
    settings: { ...defaultSettings(), ...settings }, world: { scanId, baseId }, placement: null, marks: {}, notes: [],
  };
}

function appWith(services: Record<string, unknown> = {}): AppContext {
  return { config, services, pack: async () => testPack() } as unknown as AppContext;
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gp-routes-world-'));
  const { serverDir, worldDir } = await makeSampleWorld(join(tmp, 'srv'));
  [LEVEL_BYTES, REGION_BYTES] = await Promise.all([readFile(join(worldDir, 'level.dat')), readFile(join(worldDir, 'region', 'r.0.0.mca'))]);
  config = { ...DEFAULT_CONFIG, dataDir: join(tmp, 'data'), serverFolder: serverDir };
  app = appWith();
  ({ url, close } = await serveRoutes(worldRoutes(app)));
  const world = app.services.world as WorldService;
  DONE = await world.startScan({ kind: 'backup', file: BACKUP });
  await world.idle();
}, 60_000);
afterAll(async () => {
  await close();
  await rm(tmp, { recursive: true, force: true });
});

it('lists sources, runs a scan and serves scan, palette and tiles', { timeout: 60_000 }, async () => {
  expect(await getJson('/api/world/sources')).toEqual({ server: true, backups: [BACKUP] });
  const { scanId } = await postJson('/api/world/scans', { source: { kind: 'server' } });
  await waitFor(async () => (await getJson(`/api/world/scans/${scanId}/status`)).state === 'done');
  expect((await getJson(`/api/world/scans/${scanId}`)).bases.map((b: Base) => b.id)).toEqual(SAMPLE.baseIds);
  expect((await getJson('/api/world/scans')).map((s: ScanStatus) => s.id)).toEqual(expect.arrayContaining([scanId, DONE]));
  const palette = await getJson(`/api/world/scans/${scanId}/palette`);
  expect(palette.length).toBeGreaterThan(0);
  expect(palette.every((b: { id: unknown; meta: unknown }) => typeof b.id === 'string' && typeof b.meta === 'number')).toBe(true);
  const tile = await fetch(`${url}/api/world/scans/${scanId}/tiles/0/0/0?y=63`);
  expect([tile.status, tile.headers.get('content-type'), (await tile.arrayBuffer()).byteLength]).toEqual([200, 'application/octet-stream', 20480]);
  expect(tile.headers.get('cache-control')).toBe('private, max-age=3600');
  const surface = await fetch(`${url}/api/world/scans/${scanId}/tiles/-1/-1/-1`);   // y defaults to the surface
  expect([surface.status, (await surface.arrayBuffer()).byteLength]).toEqual([200, 20480]);
});

it.each([
  ['GET', '/api/world/scans/20991231T000000Z-abcdef', 404], ['GET', '/api/world/scans/..%2f..', 400],
  ['GET', `/api/world/scans/{DONE}/tiles/0/x/0`, 400], ['GET', `/api/world/scans/{DONE}/tiles/0/0/0?y=300`, 400],
  ['GET', '/api/world/scans/{DONE}/tiles/0/0/0?y=-1', 400], ['GET', '/api/world/scans/{DONE}/tiles/0/1.5/0', 400],
  ['GET', '/api/world/scans/{DONE}/tiles/0/123456789/0', 400], ['GET', '/api/world/scans/{DONE}/tiles/0/0/0?y=', 400],
  ['GET', '/api/world/scans/20991231T000000Z-abcdef/status', 404], ['GET', '/api/world/scans/nope/palette', 400],
  ['POST', '/api/world/scans', 400, { source: { kind: 'backup' } }], ['POST', '/api/world/scans', 400, { source: { kind: 'upload', uploadId: '../x' } }],
  ['POST', '/api/world/scans', 400, { kind: 'server' }], ['POST', '/api/world/scans', 400, { source: { kind: 'backup', file: 'nope.zip' } }],
  ['POST', `/api/world/scans/{DONE}/cancel`, 409], ['POST', '/api/world/scans/20991231T000000Z-abcdef/cancel', 404],
  ['POST', `/api/world/uploads/${'0'.repeat(32)}/complete`, 404], ['GET', '/api/world/nothing', 404],
])('%s %s → %i', async (method, path, status, body?) => {
  const res = await call(method, path.replace('{DONE}', DONE), body);
  expect(res.status).toBe(status);
  const answer = await res.json() as { error: unknown; message: unknown };
  expect([typeof answer.error, typeof answer.message]).toEqual(['string', 'string']);
});

it('answers 409 while a scan is not finished', async () => {
  const running: ScanStatus = { id: RUNNING_ID, state: 'running', progress: 0.5, message: 'Scanning Overworld r.0.0', startedAt: '2026-10-17T12:00:00.000Z' };
  const stub = {
    hasScan: () => true, scanStatus: () => running, getScan: async () => null, palette: async () => null, tile: async () => null,
  } as unknown as WorldService;
  const stubApp = appWith({ world: stub });
  const served = await serveRoutes(worldRoutes(stubApp));
  try {
    expect(stubApp.services.world).toBe(stub);   // worldRoutes keeps a service that is already registered
    for (const path of [`/api/world/scans/${RUNNING_ID}`, `/api/world/scans/${RUNNING_ID}/palette`, `/api/world/scans/${RUNNING_ID}/tiles/0/0/0`]) {
      const res = await fetch(`${served.url}${path}`);
      expect([res.status, await res.json()]).toEqual([409, { error: 'not-finished', message: 'Scan is not finished' }]);
    }
    const status = await fetch(`${served.url}/api/world/scans/${RUNNING_ID}/status`);
    expect([status.status, await status.json()]).toEqual([200, running]);
  } finally {
    await served.close();
  }
});

it('cancels a queued or running scan', async () => {
  const cancelled: string[] = [];
  const stub = { hasScan: () => true, cancelScan: (id: string) => { cancelled.push(id); return true; } } as unknown as WorldService;
  const served = await serveRoutes(worldRoutes(appWith({ world: stub })));
  try {
    const res = await fetch(`${served.url}/api/world/scans/${RUNNING_ID}/cancel`, { method: 'POST' });
    expect([res.status, await res.text(), cancelled]).toEqual([204, '', [RUNNING_ID]]);
  } finally {
    await served.close();
  }
});

it('answers 500 with a generic message when the service fails', async () => {
  const stub = { listSources: async () => { throw new Error('disk on fire at /secret/path'); } } as unknown as WorldService;
  const served = await serveRoutes(worldRoutes(appWith({ world: stub })));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await fetch(`${served.url}/api/world/sources`);
    expect(res.status).toBe(500);
    const answer = await res.json() as { error: string; message: string };
    expect(answer.error).toBe('internal');
    expect(answer.message).not.toContain('/secret/path');
    expect(logged).toHaveBeenCalledOnce();
  } finally {
    logged.mockRestore();
    await served.close();
  }
});

it('runs the upload flow and refuses bad paths', { timeout: 60_000 }, async () => {
  const { uploadId } = await postJson('/api/world/uploads', {}, { [NAME_HEADER]: 'Tester' });
  expect(JSON.parse(await readFile(join(config.dataDir, 'uploads', uploadId, 'upload.json'), 'utf8'))).toMatchObject({ by: 'Tester', complete: false });
  expect((await put(uploadId, 'level.dat', LEVEL_BYTES)).status).toBe(204);
  expect((await put(uploadId, 'region%2Fr.0.0.mca', REGION_BYTES)).status).toBe(204);
  for (const bad of ['..%2Flevel.dat', '%2e%2e/level.dat', 'Region/r.0.0.mca', 'DIM-1/r.0.0.mca', '%E0%A4%A',
                     'region%252Fr.3.0.mca'])               // decoded once → 'region%2Fr.3.0.mca'; a second decode would wrongly accept it
    expect((await put(uploadId, bad, B1)).status).toBe(400);
  expect((await putDeclared(uploadId, 'region/r.1.0.mca', 134_217_729)).status).toBe(413);   // declared Content-Length only
  expect((await put('f'.repeat(32), 'level.dat', B1)).status).toBe(404);
  expect(await readdir(join(config.dataDir, 'uploads', uploadId, 'files', 'region'))).toEqual(['r.0.0.mca']);
  const { scanId } = await postJson(`/api/world/uploads/${uploadId}/complete`, {});
  expect((await put(uploadId, 'region/r.2.0.mca', REGION_BYTES)).status).toBe(409);
  await waitFor(async () => (await getJson(`/api/world/scans/${scanId}/status`)).state === 'done');
  expect((await getJson(`/api/world/scans/${scanId}`)).source).toEqual({ kind: 'upload', uploadId });
});

it('refuses to complete an upload without level.dat', async () => {
  const { uploadId } = await postJson('/api/world/uploads', {});
  const res = await call('POST', `/api/world/uploads/${uploadId}/complete`);
  expect([res.status, await res.json()]).toEqual([400, { error: 'bad-request', message: 'level.dat is missing' }]);
});

it('leaves no partial file and sends no answer when the client aborts an upload', async () => {
  const { uploadId } = await postJson('/api/world/uploads', {});
  const regionDir = join(config.dataDir, 'uploads', uploadId, 'files', 'region');
  const entries = async (): Promise<string[]> => readdir(regionDir).catch(() => []);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { hostname, port } = new URL(url);
    const req = request({ hostname, port, method: 'PUT', path: `/api/world/uploads/${uploadId}/files/region/r.5.5.mca`, headers: { 'content-length': 1_000_000 } });
    let answered = false;
    req.on('response', () => { answered = true; });
    req.on('error', () => {});   // the abort below
    req.write(Buffer.alloc(65_536));
    await waitFor(async () => (await entries()).some((n) => n.endsWith('.part')));   // the server is storing the body
    req.destroy();
    await waitFor(async () => (await entries()).length === 0);
    expect(answered).toBe(false);
    expect(logged).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(config.dataDir, 'uploads', uploadId, 'upload.json'), 'utf8'))).toMatchObject({ files: 0, bytes: 0 });
  } finally {
    logged.mockRestore();
  }
});

it('is served by the app server, only with the session cookie', async () => {
  const server = await startTestServer();
  try {
    const sources = await server.request('/api/world/sources');
    expect([sources.status, await sources.json()]).toEqual([200, { server: false, backups: [] }]);   // no server folder configured
    expect((await server.request('/api/world/scans', { cookie: null })).status).toBe(401);
    expect((await server.request('/api/world/uploads', { method: 'POST', body: {}, cookie: null })).status).toBe(401);
    expect(typeof server.app.services.planContext).toBe('function');
  } finally {
    await server.close();
  }
});

it('sets the planner hook', async () => {
  worldRoutes(app);
  const hook = app.services.planContext as (p: Project) => Promise<PlanContext>;
  expect((await hook(projectWith(DONE, '0:0:0'))).topTier).toBe(1);
  expect((await hook(projectWith(DONE, '0:0:0', { logistics: 'ae2' }))).storage.get('minecraft:iron_ingot@0')!.reachable).toBe(0);   // the project's mode reaches the context
  expect((await hook(projectWith(DONE, '0:0:0'))).storage.get('minecraft:iron_ingot@0')!.reachable).toBe(1000);
  expect(await hook(projectWith(null, null))).toEqual(emptyContext());
  expect(await hook(projectWith('20991231T000000Z-abcdef', null))).toEqual(emptyContext());   // unknown (or unfinished) scan
});
