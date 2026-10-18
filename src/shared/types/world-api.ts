// Request and response bodies of the /api/world routes (architecture §6.6, §11.11). Plan 2's api.ts re-exports these
// once it is on this branch (ledger ruling R2).

import type { ScanStatus, WorldSource } from './world.ts';

export interface WorldSourcesResponse { server: boolean; backups: string[] }
export interface StartScanRequest { source: WorldSource }
export interface StartScanResponse { scanId: string }
export interface WorldScanListItem extends ScanStatus { source: WorldSource; levelName: string | null }
export interface CreateUploadResponse { uploadId: string }
