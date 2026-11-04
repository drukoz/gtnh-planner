// Compression through the real server (RUK-529, performance review F5): `sendJson` and the static files gzip a body of
// MIN_GZIP_BYTES or more for a request whose `Accept-Encoding` takes gzip, server-sent events stay plain, and a client
// that sends no `Accept-Encoding` (the projector mod) gets plain JSON. `compress.test.ts` tests the helpers on mocked
// requests; this file pins the same promises on answers that leave a real server.
//
// `fetch` adds `accept-encoding: gzip, deflate` by itself and decompresses, so `TestServer.request` cannot show what the
// server sends. The raw helpers below use `node:http`, which sends the headers it is given and hands back the bytes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request, type IncomingHttpHeaders } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { crossSpec } from '../../helpers/farm-fixtures.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';

const PACK = packFromSpec(crossSpec());
let s: TestServer;
beforeEach(async () => { s = await startTestServer({ pack: PACK }); });
afterEach(async () => { await s.close(); });

const BASE: Partial<PlanSettings> = { per: 'hour', objective: 'least-raw' };
const MAKES_T: Partial<PlanSettings> = { target: 't:t@0', amount: 60 };

async function create(name: string, settings: Partial<PlanSettings>): Promise<Project> {
  const r = await s.request('/api/projects', { method: 'POST', name: 'Ann', body: { name, settings: { ...BASE, ...settings } } });
  expect(r.status).toBe(201);
  return r.json();
}

/** One raw GET: the session cookie plus `headers`, answered with the status, the headers and the body as the bytes sent. */
function raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const target = new URL(s.url);
    const req = request(
      { host: target.hostname, port: target.port, path, method: 'GET', headers: { cookie: s.cookie, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => { chunks.push(c); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** One raw GET resolved at the first chunk of a stream (an event stream never ends), then destroyed. */
function firstChunk(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingHttpHeaders; chunk: Buffer }> {
  return new Promise((resolve, reject) => {
    const target = new URL(s.url);
    let settled = false;
    const req = request(
      { host: target.hostname, port: target.port, path, method: 'GET', headers: { cookie: s.cookie, ...headers } },
      (res) => {
        res.once('data', (chunk: Buffer) => {
          settled = true;
          const answer = { status: res.statusCode ?? 0, headers: res.headers, chunk };
          req.destroy();
          resolve(answer);
        });
        res.on('error', () => { /* the destroy below: the answer is already sent */ });
      },
    );
    req.on('error', (err) => { if (!settled) reject(err); });
    req.end();
  });
}

describe('compression through the real server (RUK-529, F5)', () => {
  it('sends a big plan plain to a client that sends no Accept-Encoding', async () => {
    const p = await create('P', MAKES_T);
    const plain = await raw(`/api/projects/${p.id}/plan`);
    expect(plain.status).toBe(200);
    expect(plain.body.length).toBeGreaterThanOrEqual(1024);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(plain.body.toString('utf8'))).toEqual(await (await s.request(`/api/projects/${p.id}/plan`)).json());
  }, 30_000);

  it('gzips the same plan for a client that takes gzip, byte for byte the same body', async () => {
    const p = await create('P', MAKES_T);
    const plain = await raw(`/api/projects/${p.id}/plan`);
    expect(plain.body.length).toBeGreaterThanOrEqual(1024);
    const gz = await raw(`/api/projects/${p.id}/plan`, { 'accept-encoding': 'gzip, deflate' });
    expect(gz.status).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.headers.vary).toBe('Accept-Encoding');
    expect(Number(gz.headers['content-length'])).toBe(gz.body.length);
    expect(gunzipSync(gz.body).equals(plain.body)).toBe(true);
  }, 30_000);

  it('sends the plan plain when Accept-Encoding refuses gzip (gzip;q=0)', async () => {
    const p = await create('P', MAKES_T);
    const r = await raw(`/api/projects/${p.id}/plan`, { 'accept-encoding': 'gzip;q=0' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
  }, 30_000);

  it('never gzips a server-sent event stream, even for a client that takes gzip', async () => {
    const p = await create('P', MAKES_T);
    const stream = await firstChunk(`/api/projects/${p.id}/events`, { 'accept-encoding': 'gzip' });
    expect(stream.status).toBe(200);
    expect(String(stream.headers['content-type'])).toMatch(/^text\/event-stream/);
    expect(stream.headers['content-encoding']).toBeUndefined();
  }, 30_000);

  it('sends a small JSON answer plain, the gzip saving being too little', async () => {
    const r = await raw('/api/health', { 'accept-encoding': 'gzip' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
  }, 30_000);
});
