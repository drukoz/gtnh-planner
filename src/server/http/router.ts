// Routing for the JSON API (architecture §7.1): route tables, path matching on the raw request path, JSON in and out,
// and the error type handlers throw to answer with a status.

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  /** Display name from the X-Planner-Name header, URI-decoded and trimmed; null when absent or empty. */
  me: string | null;
  /** The session cookie is valid, or a project token let the request into a `bearer` route (then `bearer` is set). */
  authed: boolean;
  /** Set when a project token, not the session cookie, let the request in (architecture §11.23). */
  bearer?: { projectId: string; tokenId: string };
}

export type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, ctx: RequestContext) => Promise<void>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** e.g. "/api/projects/:id"; `:name` matches one segment and a trailing "/*" captures the rest as params["*"]. */
  path: string;
  handler: Handler;
  /** Reachable without the session cookie. */
  public?: boolean;
  /** Also accept a project token for params.id (`Authorization: Bearer <token>`) instead of the session cookie. */
  bearer?: boolean;
}

/**
 * The id of `token` when it is a live token of project `projectId`, else null. Registered as `app.services.verifyToken`
 * (Plan 6's projector routes set it); the server reads it on every request, so a test may replace it after start.
 */
export type TokenVerifier = (token: string, projectId: string) => { tokenId: string } | null;

/** Thrown by handlers (and the router) to answer with `status` and the body `{ error: code, message }`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_MAX_JSON_BYTES = 1_048_576;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function tooLarge(maxBytes: number): HttpError {
  return new HttpError(413, 'too-large', `The request body is larger than ${maxBytes} bytes`);
}

/** The request body parsed as JSON: 413 when it is over `maxBytes` (1 MiB), 400 when it is not JSON. */
export function readJson<T>(req: IncomingMessage, maxBytes: number = DEFAULT_MAX_JSON_BYTES): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (Number(req.headers['content-length']) > maxBytes) {
      reject(tooLarge(maxBytes));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    // Events rather than `for await`: leaving that loop early destroys the request, and with it the socket the 413
    // answer has to go out on. The rest of an oversized body is read and dropped; the server closes the connection.
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) settle(() => reject(tooLarge(maxBytes)));
      else chunks.push(chunk);
    });
    req.on('end', () => settle(() => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new HttpError(400, 'bad-json', 'The request body is not valid JSON'));
      }
    }));
    req.on('error', (err) => settle(() => reject(err)));
    req.on('close', () => settle(() => reject(new HttpError(400, 'aborted', 'The request body was cut off'))));
  });
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    if (err instanceof URIError) throw new HttpError(400, 'bad-path', 'Malformed URL');
    throw err;
  }
}

/** The still-encoded params of `pattern` in `segments`, or null when the path does not fit. */
function matchSegments(pattern: readonly string[], segments: readonly string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i]!;
    if (part === '*' && i === pattern.length - 1) {
      if (segments.length < pattern.length) return null;
      params['*'] = segments.slice(i).join('/');
      return params;
    }
    const segment = segments[i];
    if (segment === undefined) return null;
    if (part.startsWith(':')) {
      if (segment === '') return null;
      params[part.slice(1)] = segment;
    } else if (part !== segment) {
      return null;
    }
  }
  return segments.length === pattern.length ? params : null;
}

/**
 * The first route (in list order) for `method` whose path fits the raw request path `pathname`. Segments are compared
 * still encoded, so `%2e%2e` or `%2F` never change which route matches; each captured param is then decoded once. A
 * malformed escape in a captured param is `HttpError(400, 'bad-path')` (architecture §11.17).
 */
export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const segments = pathname.split('/');
  for (const route of routes) {
    if (route.method !== method) continue;
    const raw = matchSegments(route.path.split('/'), segments);
    if (raw === null) continue;
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw)) params[name] = decodeParam(value);
    return { route, params };
  }
  return null;
}
