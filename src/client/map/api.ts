// The /api/world routes (architecture §6.6, §11.11) and the block faces of /api/assets/blocks (Plan 3). JSON calls go
// through Plan 2's apiGet / apiPost (name header, 401 → login, ApiError); only the binary tile answer and the raw upload
// body use fetch directly, with the same credentials, name header and ApiError (ledger ruling M-R2).

import { apiGet, apiPost, ApiError } from '../api/client.ts';
import { getName } from '../state/name.ts';
import {
  NAME_HEADER, type ApiError as ApiErrorBody, type CreateUploadResponse, type PaletteName, type StartScanRequest, type StartScanResponse,
  type WorldScanListItem, type WorldSourcesResponse,
} from '../../shared/types/api.ts';
import type { BlockFaces } from '../../shared/types/assets.ts';
import type { BlockRef } from '../../shared/types/pack.ts';
import { decodeMapTile, type MapTile, type ScanStatus, type WorldScan, type WorldSource } from '../../shared/types/world.ts';

const SCANS = '/api/world/scans';
const UPLOADS = '/api/world/uploads';

const scanPath = (id: string): string => `${SCANS}/${encodeURIComponent(id)}`;
const uploadPath = (id: string): string => `${UPLOADS}/${encodeURIComponent(id)}`;

/** Plan 2's ApiError from a failed answer's `{ error, message }`, with client.ts's fallbacks for any other body. */
async function errorOf(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody> | null;
  } catch {
    // not JSON (a proxy's error page, say)
  }
  const code = typeof body?.error === 'string' ? body.error : `http-${res.status}`;
  const message = typeof body?.message === 'string' ? body.message : `The server answered ${res.status}`;
  return new ApiError(res.status, code, message);
}

/** A request whose body or answer is not JSON. */
async function rawFetch(path: string, init: { method: 'GET' | 'PUT'; accept?: string; body?: Blob }): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.accept !== undefined) headers.Accept = init.accept;
  if (init.body !== undefined) headers['Content-Type'] = 'application/octet-stream';
  const name = getName();
  if (name !== null) headers[NAME_HEADER] = encodeURIComponent(name);
  const request: RequestInit = { method: init.method, headers, credentials: 'same-origin' };
  if (init.body !== undefined) request.body = init.body;
  const res = await fetch(path, request);
  if (!res.ok) throw await errorOf(res);
  return res;
}

export const worldApi = {
  sources: (): Promise<WorldSourcesResponse> => apiGet<WorldSourcesResponse>('/api/world/sources'),
  scans: (): Promise<WorldScanListItem[]> => apiGet<WorldScanListItem[]>(SCANS),
  scan: (id: string): Promise<WorldScan> => apiGet<WorldScan>(scanPath(id)),
  status: (id: string): Promise<ScanStatus> => apiGet<ScanStatus>(`${scanPath(id)}/status`),
  /** Starts (or joins) a scan of `source`; answers its scan id. */
  start: async (source: WorldSource): Promise<string> => {
    const body: StartScanRequest = { source };
    return (await apiPost<StartScanResponse>(SCANS, body)).scanId;
  },
  cancel: (id: string): Promise<void> => apiPost<void>(`${scanPath(id)}/cancel`, undefined),
  palette: (id: string): Promise<BlockRef[]> => apiGet<BlockRef[]>(`${scanPath(id)}/palette`),
  /** The palette with each entry's English name, in the same order (architecture §11, Map hover); 503 without an export. */
  paletteNames: (id: string): Promise<PaletteName[]> => apiGet<PaletteName[]>(`${scanPath(id)}/palette?names=1`),
  /** The 64×64 map tile (tx, tz) of `dim`, showing the first block at or below `y` (255 = surface). */
  tile: async (scanId: string, dim: number, tx: number, tz: number, y: number): Promise<MapTile> => {
    const res = await rawFetch(`${scanPath(scanId)}/tiles/${dim}/${tx}/${tz}?y=${y}`, { method: 'GET', accept: 'application/octet-stream' });
    return decodeMapTile(new Uint8Array(await res.arrayBuffer()), dim, tx, tz);
  },
  /** Answers the new upload's id; the server records who made it. */
  createUpload: async (): Promise<string> => (await apiPost<CreateUploadResponse>(UPLOADS, undefined)).uploadId,
  /** Stores one world file (`rel` relative to the world folder, e.g. "DIM-1/region/r.0.0.mca") in the upload. */
  putFile: async (uploadId: string, rel: string, body: Blob): Promise<void> => {
    await rawFetch(`${uploadPath(uploadId)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body });
  },
  /** Closes the upload and scans it; answers the scan id. */
  completeUpload: async (uploadId: string): Promise<string> => (await apiPost<StartScanResponse>(`${uploadPath(uploadId)}/complete`, undefined)).scanId,
  blockFaces: (blocks: BlockRef[]): Promise<BlockFaces[]> => apiPost<BlockFaces[]>('/api/assets/blocks', { blocks }),
};
