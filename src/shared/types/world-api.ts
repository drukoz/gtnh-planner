// Request and response bodies of the /api/world routes (architecture §6.6, §11.11), and the limits of one upload,
// which the server enforces and the browser checks before it sends anything (ledger ruling M-R8). Plan 2's api.ts
// re-exports the body types (ledger ruling R2). Pure TypeScript shared by server and browser.

import type { BlockRef } from './pack.ts';
import type { ScanStatus, WorldSource } from './world.ts';

export interface WorldSourcesResponse { server: boolean; backups: string[] }
export interface StartScanRequest { source: WorldSource }
export interface StartScanResponse { scanId: string }
export interface WorldScanListItem extends ScanStatus {
  source: WorldSource; levelName: string | null;
  /** A finished scan's `WorldScan.warnings`; absent when it has none (or was made before scans kept them in meta.json). */
  warnings?: string[];
}
export interface CreateUploadResponse { uploadId: string }
/**
 * One entry of `GET /api/world/scans/:id/palette?names=1` (architecture §11, Map hover): a palette entry with its
 * English name, in the plain palette's order, for the map's hover tooltip.
 */
export interface PaletteName { block: BlockRef; name: string }

const MiB = 1024 ** 2;
/** Bytes of level.dat and of one region file, files and bytes of one upload. */
export const UPLOAD_LIMITS: Readonly<{ levelDat: number; region: number; files: number; total: number }> =
  Object.freeze({ levelDat: 32 * MiB, region: 128 * MiB, files: 4096, total: 8 * 1024 * MiB });
export type UploadLimits = typeof UPLOAD_LIMITS;
