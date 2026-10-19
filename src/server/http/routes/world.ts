// The world routes (architecture §7, §11.11, §11.17; spec §3.4, §5): the sources a scan can read, scans and their
// status, palette (with English names on request: architecture §11, Map hover) and map tiles, cancel, and uploads of
// level.dat plus region files. They also register the world service (`app.services.world`) and the planner hook that
// turns a project's scan and base into its `PlanContext`.
// Every route needs the session cookie. Errors are `HttpError`s (ledger ruling D-R5): a `SourceError` keeps its
// status, a `RangeError` is a 400, anything else goes to server.ts, which logs it and answers a generic 500.

import { STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AppContext } from '../../app.ts';
import { emptyContext } from '../../planner/plan.ts';
import { contextFromScan } from '../../world/context.ts';
import { emptyFacts, packFacts } from '../../world/facts.ts';
import { createWorldService, isScanId, type WorldService } from '../../world/scan.ts';
import { completeUpload, createUpload, isUploadId, SourceError, storeUploadFile } from '../../world/sources.ts';
import { GT_MACHINE_BLOCK } from '../../world/tiles.ts';
import { HttpError, readJson, sendJson, type Handler, type Route } from '../router.ts';
import type { CreateUploadResponse, PaletteName, StartScanResponse } from '../../../shared/types/api.ts';
import type { BlockRef, Pack } from '../../../shared/types/pack.ts';
import type { PlanContext } from '../../../shared/types/plan.ts';
import type { Project } from '../../../shared/types/project.ts';
import { UNKNOWN_BLOCK, type WorldSource } from '../../../shared/types/world.ts';

/** Tile coordinates, dimension ids and `y`: whole numbers of at most 8 digits. */
const TILE_NUMBER_RE = /^-?\d{1,8}$/;
const SURFACE_Y = 255;
const TILE_CACHE_CONTROL = 'private, max-age=3600';

const CODE_OF_STATUS: Readonly<Record<number, string>> = { 400: 'bad-request', 404: 'not-found', 409: 'conflict', 413: 'too-large' };

/** The error code of an HTTP status: the table's, else its reason phrase as a slug ("Service Unavailable" → service-unavailable). */
function codeOf(status: number): string {
  return CODE_OF_STATUS[status] ?? (STATUS_CODES[status] ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** `handler` with a `SourceError` answered with its status and a `RangeError` as a 400; other errors pass on. */
function guarded(handler: Handler): Handler {
  return async (req, res, params, ctx) => {
    try {
      await handler(req, res, params, ctx);
    } catch (err) {
      if (err instanceof SourceError) throw new HttpError(err.status, codeOf(err.status), err.message);
      if (err instanceof RangeError) throw new HttpError(400, 'bad-request', err.message);
      throw err;
    }
  };
}

function badRequest(message: string): HttpError {
  return new HttpError(400, 'bad-request', message);
}

function notFinished(): HttpError {
  return new HttpError(409, 'not-finished', 'Scan is not finished');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `source` of a StartScanRequest body, with only the fields of its kind; null when the body is not one. */
function requestedSource(body: unknown): WorldSource | null {
  const source = isRecord(body) ? body.source : undefined;
  if (!isRecord(source)) return null;
  if (source.kind === 'server') return { kind: 'server' };
  if (source.kind === 'backup' && typeof source.file === 'string') return { kind: 'backup', file: source.file };
  if (source.kind === 'upload' && typeof source.uploadId === 'string' && isUploadId(source.uploadId)) return { kind: 'upload', uploadId: source.uploadId };
  return null;
}

/** The whole number `text` stands for; 400 unless it matches `TILE_NUMBER_RE` and lies in `[min, max]`. */
function tileNumber(name: string, text: string, min = -Infinity, max = Infinity): number {
  const n = TILE_NUMBER_RE.test(text) ? Number(text) : NaN;
  if (!(n >= min && n <= max)) throw badRequest(`${name} must be a whole number${Number.isFinite(min) ? ` from ${min} to ${max}` : ''}`);
  return n;
}

/**
 * The English name of palette entry `ref` (architecture §11, Map hover). A GT machine block is the machine its tile id
 * names, never the pack item of its block meta, which is not that id; air and the unknown block get those words; any
 * other block is the pack item of its meta (`<id>@<meta>`, §5), else of meta 0 (the meta can be a facing), else its
 * registry name. `pack.items` is read directly: `pack.nameOf` answers an unknown key with the key itself.
 */
function blockName(pack: Pack, ref: BlockRef): string {
  if (ref.id === 'minecraft:air') return 'Air';
  if (ref.id === UNKNOWN_BLOCK.id) return 'Unknown block';
  if (ref.id === GT_MACHINE_BLOCK) {
    return ref.mteId === undefined ? ref.id : pack.machines.get(ref.mteId)?.name ?? `Unknown machine #${ref.mteId}`;
  }
  return pack.items.get(`${ref.id}@${ref.meta}`)?.name ?? pack.items.get(`${ref.id}@0`)?.name ?? ref.id;
}

/** The `Content-Length` the client declared; null when it sent none (a chunked body). */
function declaredLength(req: IncomingMessage): number | null {
  const header = req.headers['content-length'];
  return header === undefined ? null : Number(header);
}

/** The client hung up: there is nobody left to answer. */
function clientGone(res: ServerResponse): boolean {
  return res.destroyed || res.socket?.destroyed === true;
}

/**
 * The app's world service, created on first use. Scans get the active export's facts; when no export loads, the
 * reason goes to the log and the scan runs with none: every machine stays unknown, and the scan's warnings say so.
 */
export function worldService(app: AppContext): WorldService {
  const existing = app.services.world as WorldService | undefined;
  if (existing !== undefined) return existing;
  const world = createWorldService({
    config: app.config,
    facts: async () => {
      try {
        return packFacts(await app.pack());
      } catch (err) {
        console.warn(`World scan without a recipe export (${err instanceof Error ? err.message : String(err)}): its machines stay unknown`);
        return emptyFacts();
      }
    },
  });
  app.services.world = world;
  return world;
}

/**
 * The planner hook: the context of the project's scan and base in the project's logistics mode (Plan 2's plan cache
 * keys on the settings hash, so a mode change re-plans); `emptyContext()` without a scan or while it is not done.
 */
export function planContextHook(app: AppContext): (project: Project) => Promise<PlanContext> {
  return async (project) => {
    const { scanId, baseId } = project.world;
    if (scanId === null) return emptyContext();
    const scan = await worldService(app).getScan(scanId);
    if (scan === null) return emptyContext();
    return contextFromScan(scan, await app.pack(), baseId, project.settings.logistics);
  };
}

export function worldRoutes(app: AppContext): Route[] {
  const world = worldService(app);
  app.services.planContext = planContextHook(app);
  const { dataDir } = app.config;

  /** The scan `id` names: 400 for a malformed id, 404 for an unknown one. */
  const knownScan = (id: string): string => {
    if (!isScanId(id)) throw badRequest('Not a scan id');
    if (!world.hasScan(id)) throw new HttpError(404, 'not-found', `No scan ${id}`);
    return id;
  };

  const routes: Route[] = [
    {
      method: 'GET', path: '/api/world/sources',
      handler: async (_req, res) => sendJson(res, 200, await world.listSources()),
    },
    {
      method: 'POST', path: '/api/world/scans',
      handler: async (req, res) => {
        const source = requestedSource(await readJson<unknown>(req));
        if (source === null) {
          throw badRequest('Send {"source": {"kind": "server"}}, {"source": {"kind": "backup", "file": "…"}} or {"source": {"kind": "upload", "uploadId": "…"}}');
        }
        const answer: StartScanResponse = { scanId: await world.startScan(source) };
        sendJson(res, 200, answer);
      },
    },
    {
      method: 'GET', path: '/api/world/scans',
      handler: async (_req, res) => sendJson(res, 200, await world.listScans()),
    },
    {
      method: 'GET', path: '/api/world/scans/:id',
      handler: async (_req, res, params) => {
        const scan = await world.getScan(knownScan(params.id!));
        if (scan === null) throw notFinished();
        sendJson(res, 200, scan);
      },
    },
    {
      method: 'GET', path: '/api/world/scans/:id/status',
      handler: async (_req, res, params) => sendJson(res, 200, world.scanStatus(knownScan(params.id!))),
    },
    {
      method: 'GET', path: '/api/world/scans/:id/palette',
      handler: async (req, res, params) => {
        const palette = await world.palette(knownScan(params.id!));
        if (palette === null) throw notFinished();
        // Only names=1 adds the names (architecture §11, Map hover); without it, or with any other value, the answer is
        // the plain palette as before. The pack's 503 no-export goes out like on the other pack routes.
        if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('names') !== '1') {
          sendJson(res, 200, palette);
          return;
        }
        const pack = await app.pack();
        const named: PaletteName[] = palette.map((block) => ({ block, name: blockName(pack, block) }));
        sendJson(res, 200, named);
      },
    },
    {
      method: 'POST', path: '/api/world/scans/:id/cancel',
      handler: async (_req, res, params) => {
        const id = knownScan(params.id!);
        if (!world.cancelScan(id)) throw new HttpError(409, 'conflict', `Scan ${id} is not queued or running`);
        res.writeHead(204).end();
      },
    },
    {
      method: 'GET', path: '/api/world/scans/:id/tiles/:dim/:tx/:tz',
      handler: async (req, res, params) => {
        const id = knownScan(params.id!);
        const dim = tileNumber('dim', params.dim!);
        const tx = tileNumber('tx', params.tx!);
        const tz = tileNumber('tz', params.tz!);
        // req.url is a path here ('/api/world/…'), so parsing it against a placeholder origin cannot fail.
        const y = tileNumber('y', new URL(req.url ?? '/', 'http://localhost').searchParams.get('y') ?? String(SURFACE_Y), 0, SURFACE_Y);
        const tile = await world.tile(id, dim, tx, tz, y);
        if (tile === null) throw notFinished();
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': tile.byteLength, 'Cache-Control': TILE_CACHE_CONTROL });
        res.end(tile);
      },
    },
    {
      method: 'POST', path: '/api/world/uploads',
      handler: async (_req, res, _params, ctx) => {
        const answer: CreateUploadResponse = { uploadId: await createUpload(dataDir, ctx.me) };
        sendJson(res, 200, answer);
      },
    },
    {
      // params['*'] was decoded once by the router (architecture §11.17) and is used exactly as given: `uploadKind`
      // accepts only the canonical spelling of level.dat and region files.
      method: 'PUT', path: '/api/world/uploads/:uploadId/files/*',
      handler: async (req, res, params) => {
        try {
          await storeUploadFile(dataDir, params.uploadId!, params['*']!, req, declaredLength(req));
        } catch (err) {
          if (clientGone(res)) return;   // storeUploadFile has removed the part file
          throw err;
        }
        res.writeHead(204).end();
      },
    },
    {
      method: 'POST', path: '/api/world/uploads/:uploadId/complete',
      handler: async (_req, res, params) => {
        const answer: StartScanResponse = { scanId: await world.startScan(await completeUpload(dataDir, params.uploadId!)) };
        sendJson(res, 200, answer);
      },
    },
  ];
  return routes.map((route) => ({ ...route, handler: guarded(route.handler) }));
}
