// The sample world as a friend's browser uploads it (plan 11 Task 9, Plan 5 Task 16's upload loop; architecture
// §11.7): Plan 4's synthetic sample world is written to a temp folder, its level.dat and Overworld region files go
// through the world upload routes, and the scan of the upload is polled until it is done. Specs that need a scanned
// base to lay a line out next to start from it.

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { makeSampleWorld } from '../helpers/sample-world.ts';

/** How long the e2e server may take to scan the sample world. */
const SCAN_TIMEOUT_MS = 60_000;

/**
 * Uploads the sample world through the page's logged-in request context and waits until its scan is done; returns the
 * scan id. The temp folder is removed once the server holds the files.
 */
export async function uploadSampleWorld(page: Page): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'gp-e2e-upload-'));
  let scanId: string;
  try {
    const { worldDir } = await makeSampleWorld(tmp);
    const { uploadId } = await (await page.request.post('/api/world/uploads', { data: {} })).json();
    for (const rel of ['level.dat', ...(await readdir(join(worldDir, 'region'))).map((f) => `region/${f}`)]) {
      const res = await page.request.put(`/api/world/uploads/${uploadId}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, { data: await readFile(join(worldDir, rel)) });
      expect(res.status(), `PUT ${rel}`).toBe(204);
    }
    ({ scanId } = await (await page.request.post(`/api/world/uploads/${uploadId}/complete`)).json());
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await expect.poll(async () => (await (await page.request.get(`/api/world/scans/${scanId}/status`)).json()).state, { timeout: SCAN_TIMEOUT_MS }).toBe('done');
  return scanId;
}
