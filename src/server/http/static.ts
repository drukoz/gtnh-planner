// The built web client (`dist/client`, web-stack §2.2): hashed files under /assets/ are cached for a year, everything
// else is revalidated, and a path without a file extension is a client route that gets index.html.

import { open, stat, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
});

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': REVALIDATE });
  res.end('Not found');
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** The decoded request path, or null when it is malformed or could leave the folder (`..`, NUL, backslash). */
function safePath(rawUrl: string): string | null {
  const q = rawUrl.indexOf('?');
  let path: string;
  try {
    path = decodeURIComponent(q < 0 ? rawUrl : rawUrl.slice(0, q));
  } catch {
    return null;
  }
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\\')) return null;
  if (path.split('/').includes('..')) return null;
  return path;
}

/** Sends `file` (200, or headers only for HEAD); false when it is not a regular file. */
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch {
    return false;
  }
  try {
    if (!(await handle.stat()).isFile()) return false;
    const body = await handle.readFile();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } finally {
    await handle.close();
  }
}

/**
 * Answers a GET or HEAD for a file of `rootDir`: the file itself, index.html for a path without an extension, else 404.
 * Returns false, without answering, for any other method and while `rootDir` has no index.html (client not built).
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, rootDir: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const root = resolve(rootDir);
  const index = join(root, 'index.html');
  if (!(await isFile(index))) return false;
  const path = safePath(req.url ?? '/');
  if (path === null) {
    notFound(res);
    return true;
  }
  const file = join(root, path);
  if (file.startsWith(root + sep)) {
    const cacheControl = path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE;
    if (await sendFile(req, res, file, cacheControl)) return true;
  }
  if (extname(path) === '' && (await sendFile(req, res, index, REVALIDATE))) return true;
  notFound(res);
  return true;
}
