// A route table on a plain node:http server, answered like Plan 2's server.ts minus the session check (ledger ruling
// D-R9): the raw, undecoded path before `?` goes to Plan 2's `matchRoute`, so params are decoded exactly once, as in
// production (architecture §11.17); every request counts as logged in.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpError, matchRoute, sendJson, type RequestContext, type Route } from '../../src/server/http/router.ts';
import { displayName } from '../../src/server/http/server.ts';

function sendError(req: IncomingMessage, res: ServerResponse, status: number, error: string, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Answering before the body is read: close the connection rather than read the rest of it.
  if (!req.complete) res.setHeader('Connection', 'close');
  sendJson(res, status, { error, message });
}

async function handle(routes: Route[], req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const i = url.indexOf('?');
  const pathname = i < 0 ? url : url.slice(0, i);
  try {
    const match = matchRoute(routes, req.method ?? 'GET', pathname);
    if (match === null) {
      sendError(req, res, 404, 'not-found', `No API route ${req.method} ${pathname}`);
      return;
    }
    const ctx: RequestContext = { me: displayName(req), authed: true };
    await match.route.handler(req, res, match.params, ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(req, res, err.status, err.code, err.message);
      return;
    }
    console.error(`${req.method} ${pathname} failed:`, err);
    sendError(req, res, 500, 'internal', 'Something went wrong on the server');
  }
}

/** Serves `routes` on a free 127.0.0.1 port, with no request timeout. */
export async function serveRoutes(routes: Route[]): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer({ requestTimeout: 0 }, (req, res) => { void handle(routes, req, res); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
