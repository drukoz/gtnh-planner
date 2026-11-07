// Compressed answers (RUK-529, performance review F5): JSON and the client's text files go out gzip-compressed to a
// client that takes gzip, and as they are to every other client.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { acceptsGzip, gzipFor, MIN_GZIP_BYTES } from '../../../src/server/http/compress.ts';
import { sendJson } from '../../../src/server/http/router.ts';
import { serveStatic } from '../../../src/server/http/static.ts';

/** A request with these headers: only what the code under test reads. */
function request(headers: Record<string, string>, method = 'GET', url = '/'): IncomingMessage {
  return { headers, method, url } as unknown as IncomingMessage;
}

/** A response that records its status, headers and body; `req` is the request it answers. */
function response(req: IncomingMessage | undefined) {
  const sent: { status: number; headers: Record<string, string | number>; body: Buffer | undefined } = { status: 0, headers: {}, body: undefined };
  const res = {
    req,
    writeHead(status: number, headers: Record<string, string | number>) {
      sent.status = status;
      sent.headers = headers;
      return res;
    },
    end(body?: Buffer | string) {
      sent.body = body === undefined ? undefined : Buffer.from(body);
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, sent };
}

describe('acceptsGzip', () => {
  it('takes gzip when Accept-Encoding lists it, or lists * without it, with a q-value above 0', () => {
    expect(acceptsGzip(request({ 'accept-encoding': 'gzip, deflate' }))).toBe(true);
    expect(acceptsGzip(request({ 'accept-encoding': 'deflate, GZIP;q=0.5' }))).toBe(true);
    expect(acceptsGzip(request({ 'accept-encoding': 'x-gzip' }))).toBe(true);
    expect(acceptsGzip(request({ 'accept-encoding': '*' }))).toBe(true);
    expect(acceptsGzip(request({ 'accept-encoding': 'gzip;q=0' }))).toBe(false);
    expect(acceptsGzip(request({ 'accept-encoding': 'gzip;q=0, *' }))).toBe(false);
    expect(acceptsGzip(request({ 'accept-encoding': '*;q=0' }))).toBe(false);
    expect(acceptsGzip(request({ 'accept-encoding': 'br, deflate' }))).toBe(false);
    expect(acceptsGzip(request({ 'accept-encoding': 'identity' }))).toBe(false);
    expect(acceptsGzip(request({}))).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });

  it('compresses from MIN_GZIP_BYTES on', () => {
    const gzip = request({ 'accept-encoding': 'gzip' });
    expect(gzipFor(gzip, Buffer.alloc(MIN_GZIP_BYTES - 1, 'a'))).toBeNull();
    expect(gunzipSync(gzipFor(gzip, Buffer.alloc(MIN_GZIP_BYTES, 'a'))!).equals(Buffer.alloc(MIN_GZIP_BYTES, 'a'))).toBe(true);
  });
});

describe('sendJson', () => {
  const big = { rows: Array.from({ length: 200 }, (_, i) => ({ i, name: `row ${i}` })) };

  it('sends JSON of MIN_GZIP_BYTES or more gzip-compressed to a client that takes gzip', () => {
    const { res, sent } = response(request({ 'accept-encoding': 'gzip, deflate' }));
    sendJson(res, 200, big);
    expect(sent.status).toBe(200);
    expect(sent.headers['Content-Encoding']).toBe('gzip');
    expect(sent.headers['Vary']).toBe('Accept-Encoding');
    expect(sent.headers['Cache-Control']).toBe('no-store');
    expect(sent.headers['Content-Length']).toBe(sent.body!.length);
    expect(JSON.parse(gunzipSync(sent.body!).toString('utf8'))).toEqual(big);
  });

  it('sends it as it is to a client without gzip, without a request, and when it is small', () => {
    for (const req of [request({}), request({ 'accept-encoding': 'identity' }), undefined]) {
      const { res, sent } = response(req);
      sendJson(res, 200, big);
      expect(sent.headers['Content-Encoding']).toBeUndefined();
      expect(sent.body!.toString('utf8')).toBe(JSON.stringify(big));
      expect(sent.headers['Content-Length']).toBe(sent.body!.length);
    }
    const { res, sent } = response(request({ 'accept-encoding': 'gzip' }));
    sendJson(res, 404, { error: 'not-found', message: 'No such project' });
    expect(sent.headers['Content-Encoding']).toBeUndefined();
    expect(JSON.parse(sent.body!.toString('utf8'))).toEqual({ error: 'not-found', message: 'No such project' });
  });
});

describe('serveStatic', () => {
  const root = mkdtempSync(join(tmpdir(), 'gp-gzip-'));
  mkdirSync(join(root, 'assets'));
  const script = `console.log(${JSON.stringify('x'.repeat(4000))});\n`;
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>GTNH Line Planner</title>');
  writeFileSync(join(root, 'assets', 'app-2.js'), script);
  writeFileSync(join(root, 'assets', 'icon.png'), Buffer.alloc(4000, 7));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("sends the client's text files gzip-compressed to a client that takes gzip, and HEAD says the same", async () => {
    const { res, sent } = response(undefined);
    expect(await serveStatic(request({ 'accept-encoding': 'gzip' }, 'GET', '/assets/app-2.js'), res, root)).toBe(true);
    expect(sent.status).toBe(200);
    expect(sent.headers['Content-Encoding']).toBe('gzip');
    expect(sent.headers['Vary']).toBe('Accept-Encoding');
    expect(sent.headers['Content-Length']).toBe(sent.body!.length);
    expect(gunzipSync(sent.body!).toString('utf8')).toBe(script);
    const head = response(undefined);
    await serveStatic(request({ 'accept-encoding': 'gzip' }, 'HEAD', '/assets/app-2.js'), head.res, root);
    expect(head.sent.headers['Content-Encoding']).toBe('gzip');
    expect(head.sent.headers['Content-Length']).toBe(sent.body!.length);
    expect(head.sent.body).toBeUndefined();
  });

  it('sends images, small files, and files for a client without gzip as they are', async () => {
    const cases: Array<[Record<string, string>, string, number]> = [
      [{ 'accept-encoding': 'gzip' }, '/assets/icon.png', 4000],
      [{ 'accept-encoding': 'gzip' }, '/index.html', 47],
      [{}, '/assets/app-2.js', Buffer.byteLength(script)],
    ];
    for (const [headers, url, length] of cases) {
      const { res, sent } = response(undefined);
      await serveStatic(request(headers, 'GET', url), res, root);
      expect(sent.status).toBe(200);
      expect(sent.headers['Content-Encoding']).toBeUndefined();
      expect(sent.headers['Content-Length']).toBe(length);
      expect(sent.body!.length).toBe(length);
    }
  });
});
