// Compressed answers (RUK-529, performance review F5): a plan is 0.8 to 4 MB of JSON and the client's main script about
// 0.6 MB, and friends reach the planner over a forwarded port. A body of MIN_GZIP_BYTES or more goes out
// gzip-compressed to a client whose `Accept-Encoding` takes gzip (over plain HTTP, Chrome and Firefox offer gzip and
// deflate only). The projector mod sends no `Accept-Encoding`, so it keeps getting plain bodies.

import type { IncomingMessage } from 'node:http';
import { gzipSync } from 'node:zlib';

/** A body smaller than this goes out as it is: gzip would save too little on it. */
export const MIN_GZIP_BYTES = 1024;

/** gzip's level: the group's 4 MB plan compresses 15 times at level 6, in about 20 ms. */
const GZIP_LEVEL = 6;

/**
 * Whether `req` takes a gzip body: its `Accept-Encoding` lists `gzip` (or `x-gzip`) with a q-value above 0, or, where it
 * does not list gzip, `*` with a q-value above 0. False without the header, and without a request.
 */
export function acceptsGzip(req: IncomingMessage | undefined): boolean {
  const header = req?.headers['accept-encoding'];
  if (typeof header !== 'string') return false;
  let gzip: number | null = null;
  let any: number | null = null;
  for (const part of header.split(',')) {
    const [name = '', ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    let q = 1;
    for (const param of params) {
      if (!param.startsWith('q=')) continue;
      const value = Number(param.slice(2));
      q = Number.isFinite(value) ? value : 0;
    }
    if (name === 'gzip' || name === 'x-gzip') gzip = Math.max(gzip ?? 0, q);
    else if (name === '*') any = Math.max(any ?? 0, q);
  }
  return gzip !== null ? gzip > 0 : any !== null && any > 0;
}

/** `body` gzip-compressed for `req`, or null to send it as it is: `req` does not take gzip, or `body` is under MIN_GZIP_BYTES. */
export function gzipFor(req: IncomingMessage | undefined, body: Buffer): Buffer | null {
  if (body.length < MIN_GZIP_BYTES || !acceptsGzip(req)) return null;
  return gzipSync(body, { level: GZIP_LEVEL });
}
