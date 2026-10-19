// Textures for the planner's views (architecture §6.5, §11.17; spec §3.8): the extracted PNGs under data/assets, and
// the icons, block faces and cover overlays the asset service resolves. Logged-in users only (none of these is public).

import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { AppContext } from '../../app.ts';
import { assetService } from '../../assets/service.ts';
import { HttpError, readJson, sendJson, type Route } from '../router.ts';
import { ASSET_BLOCKS_MAX, ASSET_KEYS_MAX } from '../../../shared/types/api.ts';
import type { StuffKey } from '../../../shared/keys.ts';
import type { BlockRef } from '../../../shared/types/pack.ts';

const MAX_REL_LENGTH = 512;
const MAX_KEY_LENGTH = 300;
const MAX_BLOCK_ID_LENGTH = 200;
const MAX_META = 32767;
const FILE_CACHE_CONTROL = 'private, max-age=3600';

/** C0 controls (NUL included), DEL and C1 controls. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Whether `rel` (already URI-decoded) can name a file under data/assets: 1–512 characters, relative, no `\` or control
 * character, and no empty, `.` or `..` segment.
 */
export function isValidAssetRel(rel: string): boolean {
  if (rel.length === 0 || rel.length > MAX_REL_LENGTH) return false;
  if (rel.startsWith('/') || rel.includes('\\') || CONTROL_CHARACTER.test(rel)) return false;
  return rel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * The real path of the PNG `rel` names under `assetsDir`, or null when `rel` is not valid, does not end in `.png`, is
 * not a regular file, or resolves (through symlinks) outside `realpath(assetsDir)`.
 */
export async function safeAssetFile(assetsDir: string, rel: string): Promise<string | null> {
  if (!isValidAssetRel(rel) || !rel.endsWith('.png')) return null;
  try {
    const root = await realpath(assetsDir);
    const file = await realpath(join(root, rel));
    if (!file.startsWith(root + sep)) return null;
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

function notFound(rel: string): HttpError {
  return new HttpError(404, 'not-found', `No texture ${rel}`);
}

/** Whether an `If-None-Match` header names `etag` (weak comparison, `*` included). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((tag) => {
    const t = tag.trim();
    return t === '*' || (t.startsWith('W/') ? t.slice(2) : t) === etag;
  });
}

/** Streams the PNG `file` with its caching headers, or answers 304 when the client already holds this version. */
async function sendPng(req: IncomingMessage, res: ServerResponse, file: string, rel: string): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch {
    throw notFound(rel);
  }
  let streaming = false;
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw notFound(rel);
    const etag = `"${st.size}-${st.mtimeMs}"`;
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { 'Cache-Control': FILE_CACHE_CONTROL, ETag: etag });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': st.size,
      'Cache-Control': FILE_CACHE_CONTROL,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    streaming = true;   // the read stream closes the handle when it ends or is destroyed
    try {
      await pipeline(handle.createReadStream(), res);
    } catch (err) {
      // A client that goes away mid-download is not a server error.
      if ((err as NodeJS.ErrnoException | null)?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
    }
  } finally {
    if (!streaming) await handle.close();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(message: string): HttpError {
  return new HttpError(400, 'bad-request', message);
}

function isInteger(value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** `body[field]` as at most `ASSET_KEYS_MAX` strings of at most 300 characters each. */
function keyList(body: unknown, field: string, what: string): StuffKey[] {
  const list = isPlainObject(body) ? body[field] : undefined;
  if (!Array.isArray(list)) throw badRequest(`Send {"${field}": ["…"]}`);
  if (list.length > ASSET_KEYS_MAX) throw new HttpError(400, 'too-many', `At most ${ASSET_KEYS_MAX} ${what} per request`);
  if (!list.every((key) => typeof key === 'string' && key.length <= MAX_KEY_LENGTH)) {
    throw badRequest(`Each of "${field}" must be a string of at most ${MAX_KEY_LENGTH} characters`);
  }
  return list as StuffKey[];
}

/** `{ id ≤ 200 characters, meta 0..32767, mteId? ≥ 0 }`, copied without any other field; null when it is not one. */
function blockRefOf(value: unknown): BlockRef | null {
  if (!isPlainObject(value)) return null;
  const { id, meta, mteId } = value;
  if (typeof id !== 'string' || id.length > MAX_BLOCK_ID_LENGTH || !isInteger(meta, 0, MAX_META)) return null;
  if (mteId === undefined) return { id, meta };
  return isInteger(mteId, 0) ? { id, meta, mteId } : null;
}

function blocksRequest(body: unknown): { blocks: BlockRef[]; facing: number | undefined } {
  const list = isPlainObject(body) ? body.blocks : undefined;
  if (!Array.isArray(list)) throw badRequest('Send {"blocks": [{"id": "…", "meta": 0}], "facing": 2}');
  if (list.length > ASSET_BLOCKS_MAX) throw new HttpError(400, 'too-many', `At most ${ASSET_BLOCKS_MAX} blocks per request`);
  const facing = (body as Record<string, unknown>).facing;
  if (facing !== undefined && !isInteger(facing, 0, 5)) throw badRequest('"facing" must be an integer 0..5');
  const blocks: BlockRef[] = [];
  for (const value of list) {
    const ref = blockRefOf(value);
    if (ref === null) throw badRequest(`Each block must be {"id": string of at most ${MAX_BLOCK_ID_LENGTH} characters, "meta": 0..${MAX_META}, "mteId"?: integer ≥ 0}`);
    blocks.push(ref);
  }
  return { blocks, facing };
}

export function assetRoutes(app: AppContext): Route[] {
  const assets = assetService(app);
  return [
    {
      method: 'GET', path: '/api/assets/file/*',
      handler: async (req, res, params) => {
        const rel = params['*'] ?? '';
        if (!isValidAssetRel(rel)) throw new HttpError(400, 'bad-path', 'Not a path inside the assets folder');
        const file = await safeAssetFile(assets.assetsDir, rel);
        if (file === null) throw notFound(rel);
        await sendPng(req, res, file, rel);
      },
    },
    {
      method: 'POST', path: '/api/assets/icons',
      handler: async (req, res) => {
        const keys = keyList(await readJson<unknown>(req), 'keys', 'keys');
        sendJson(res, 200, await assets.icons(keys));
      },
    },
    {
      method: 'POST', path: '/api/assets/blocks',
      handler: async (req, res) => {
        const { blocks, facing } = blocksRequest(await readJson<unknown>(req));
        sendJson(res, 200, await assets.blocks(blocks, facing));
      },
    },
    {
      method: 'POST', path: '/api/assets/covers',
      handler: async (req, res) => {
        const items = keyList(await readJson<unknown>(req), 'items', 'items');
        sendJson(res, 200, await assets.covers(items));
      },
    },
  ];
}
