// The one HTTP server (web-stack §4): `/api/*` goes through the route table with the session check, everything else is
// the built web client. Timeouts allow slow 1 GB world uploads (architecture §11.9).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppContext } from '../app.ts';
import { SESSION_COOKIE, readCookie, verifySession } from './auth.ts';
import { HttpError, matchRoute, sendJson, type RequestContext, type Route } from './router.ts';
import { ROUTE_MODULES } from './routes/index.ts';
import { serveStatic } from './static.ts';

export interface RunningServer { url: string; port: number; close(): Promise<void> }

const MAX_NAME_CHARACTERS = 40;

/**
 * `ctx.me`: the X-Planner-Name header, URI-decoded and trimmed, cut to 40 characters; null when absent or empty.
 * `HttpError(400, 'bad-name')` when it is not valid URI encoding.
 */
export function displayName(req: IncomingMessage): string | null {
  const raw = req.headers['x-planner-name'];
  if (typeof raw !== 'string') return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'bad-name', 'The X-Planner-Name header is not valid URI encoding');
  }
  // Characters, not UTF-16 units, so a cut never splits an emoji.
  const trimmed = Array.from(name.trim()).slice(0, MAX_NAME_CHARACTERS).join('').trim();
  return trimmed === '' ? null : trimmed;
}

/** "file:line:col" of the first stack frame, for a one-line log. */
function whereOf(err: unknown): string {
  const frame = err instanceof Error ? err.stack?.split('\n').find((line) => line.trimStart().startsWith('at ')) : undefined;
  return frame === undefined ? '' : ` (${frame.trim().slice(3)})`;
}

function sendError(req: IncomingMessage, res: ServerResponse, status: number, error: string, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Answering before the body is read: close the connection rather than read the rest of it.
  if (!req.complete) res.setHeader('Connection', 'close');
  sendJson(res, status, { error, message });
}

async function handleApi(app: AppContext, routes: Route[], req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    const match = matchRoute(routes, req.method ?? 'GET', pathname);
    if (match === null) {
      sendError(req, res, 404, 'not-found', `No API route ${req.method} ${pathname}`);
      return;
    }
    const authed = verifySession(app.config.sessionSecret, readCookie(req.headers.cookie, SESSION_COOKIE), Date.now());
    if (!match.route.public && !authed) {
      sendError(req, res, 401, 'auth', 'Log in first');
      return;
    }
    const ctx: RequestContext = { me: displayName(req), authed };
    await match.route.handler(req, res, match.params, ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(req, res, err.status, err.code, err.message);
      return;
    }
    console.error(`${req.method} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}${whereOf(err)}`);
    sendError(req, res, 500, 'internal', 'Something went wrong on the server');
  }
}

async function handleStatic(req: IncomingMessage, res: ServerResponse, staticDir: string): Promise<void> {
  try {
    if (await serveStatic(req, res, staticDir)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error(`${req.method} ${req.url} failed: ${err instanceof Error ? err.message : String(err)}${whereOf(err)}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong on the server');
  }
}

function urlOf(host: string, port: number): string {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/**
 * Listens on `opts.port`/`opts.host` (default: the config's) and serves the API and `opts.staticDir` ('dist/client').
 * The path matched against the routes is the raw request path before the first `?`: not decoded and not normalized,
 * so encoded dot segments reach their route as params (Plan 3 refuses them).
 */
export function startServer(app: AppContext, opts: { port?: number; host?: string; staticDir?: string } = {}): Promise<RunningServer> {
  const routes = ROUTE_MODULES.flatMap((m) => m(app));
  const staticDir = opts.staticDir ?? 'dist/client';
  const host = opts.host ?? app.config.host;
  const server = createServer({ requestTimeout: 7_200_000, headersTimeout: 60_000 }, (req, res) => {
    const url = req.url ?? '/';
    const i = url.indexOf('?');
    const pathname = i < 0 ? url : url.slice(0, i);
    if (pathname === '/api' || pathname.startsWith('/api/')) void handleApi(app, routes, req, res, pathname);
    else void handleStatic(req, res, staticDir);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? app.config.port, host, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      let closing: Promise<void> | null = null;
      resolve({
        url: urlOf(host, port),
        port,
        close() {
          closing ??= new Promise<void>((done, fail) => {
            app.sse.closeAll();
            server.closeAllConnections();
            server.close((err) => (err ? fail(err) : done()));
          });
          return closing;
        },
      });
    });
  });
}
