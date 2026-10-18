// The real app and HTTP server on a free 127.0.0.1 port, with a temporary data folder and a config built in memory (no
// config file). It logs in once; `request` sends that session cookie unless told not to.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppContext } from '../../src/server/app.ts';
import { DEFAULT_CONFIG, type AppConfig } from '../../src/server/config.ts';
import { hashPassword, newSessionSecret } from '../../src/server/http/auth.ts';
import { startServer } from '../../src/server/http/server.ts';
import { NAME_HEADER } from '../../src/shared/types/api.ts';
import type { Pack } from '../../src/shared/types/pack.ts';

/** A fetch `Response` whose `json()` is `Promise<any>`, as in the DOM lib, so tests read fields without casts. */
export interface TestResponse extends Response { readonly json: () => Promise<any> }

export interface TestServer {
  url: string;
  app: AppContext;
  dir: string;
  /** `gp_session=<token>` from the login at start. */
  cookie: string;
  request(path: string, init?: { method?: string; body?: unknown; name?: string; cookie?: string | null; headers?: Record<string, string> }): Promise<TestResponse>;
  close(): Promise<void>;
}

/**
 * `opts.pack` is what the app's pack loader returns (no export is active without one, so pack routes answer 503);
 * without `opts.staticDir` the server has no built client and every non-API path is a 404.
 */
export async function startTestServer(opts: { pack?: Pack | null; password?: string; staticDir?: string } = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'gp-server-'));
  const password = opts.password ?? 'pw';
  const pack = opts.pack ?? null;
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    dataDir: join(dir, 'data'), activeExportId: pack === null ? null : pack.manifest.exportId,
    port: 0, host: '127.0.0.1', passwordHash: hashPassword(password), sessionSecret: newSessionSecret(),
  };
  const app = createApp(config, {
    loadPack: async () => {
      if (pack === null) throw new Error('startTestServer: no pack');
      return pack;
    },
  });
  const server = await startServer(app, { port: 0, host: '127.0.0.1', staticDir: opts.staticDir ?? join(dir, 'no-client') });
  const close = async (): Promise<void> => {
    await server.close();
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  };

  const login = await fetch(`${server.url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  });
  const setCookie = login.headers.get('set-cookie');
  if (login.status !== 204 || setCookie === null) {
    await close();
    throw new Error(`startTestServer: login answered ${login.status}`);
  }
  const cookie = setCookie.slice(0, setCookie.indexOf(';'));

  return {
    url: server.url, app, dir, cookie,
    request(path, init = {}) {
      const headers: Record<string, string> = {};
      if (init.cookie !== null) headers.cookie = init.cookie ?? cookie;
      if (init.name !== undefined) headers[NAME_HEADER] = encodeURIComponent(init.name);
      let body: string | undefined;
      if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(init.body);
      }
      return fetch(`${server.url}${path}`, { method: init.method ?? 'GET', headers: { ...headers, ...init.headers }, body }) as Promise<TestResponse>;
    },
    close,
  };
}
