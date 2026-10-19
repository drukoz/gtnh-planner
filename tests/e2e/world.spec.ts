// The world map end to end (Plan 4 Task 18; spec §3.4, §3.7): a friend picks the synthetic sample world's folder on
// the World page, the browser finds its hotspots and sends only level.dat and the two trimmed region files, the server
// scans the upload, and a project picks the scan's Overworld base on its Map tab, reads what was found, sees the map
// drawn, hovers its centre to see what is there and pins a note that survives a reload. Last, the upload route refuses
// a path that climbs out of the upload.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { makeSampleWorld } from '../helpers/sample-world.ts';
import { createProject, login, setName } from './helpers.ts';

let tmp: string;

test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-e2e-world-')); await makeSampleWorld(tmp); });
test.afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

test('smart upload of the sample world sends only trimmed regions; scan, pick the base, read the map and pin a note', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');                                       // before any navigation: no name prompt, addNote carries X-Planner-Name
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/world/uploads/')) sent.push(decodeURIComponent(r.url().split('/files/')[1]!)); });
  await page.goto('/world');
  await page.setInputFiles('[data-testid=world-folder-input]', join(tmp, 'World'));
  await expect(page.getByTestId('smart-area')).toHaveCount(2);      // the Overworld base chunks and the Nether chunk; DIM 7 was never lived in
  await expect(page.getByTestId('smart-total')).toContainText('KB');
  // A server that already holds a done scan (a repeated run) would pass the first-row check before this upload starts,
  // so wait for the new row (newest first) before asking that it is done.
  const rows = page.getByTestId('scan-row');
  await expect(page.getByText('No scans yet').or(rows.first())).toBeVisible();
  const before = await rows.count();
  await page.getByTestId('upload-button').click();
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId('scan-row').first()).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  expect([...sent].sort()).toEqual(['DIM-1/region/r.-1.-1.mca', 'level.dat', 'region/r.0.0.mca']);   // no playerdata, no claims, no DIM7

  await createProject(page, 'E2E map');
  await page.getByText('Map', { exact: true }).first().click();     // the first project tab (Task 16)
  // exact: the settings panel's tier select also has "world scan" in its label (its "From world (LV until a world scan
  // exists)" option), and a substring match would pick that one before the Map tab has rendered, or both after
  await page.getByLabel('World scan', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Base').selectOption({ label: 'Overworld base (4, 5)' });   // the smart upload keeps claim files local, so the base has no team ("Alpha") name
  await page.getByRole('button', { name: 'Use this base' }).click();

  const panel = page.getByTestId('found-panel');
  await expect(panel.getByTestId('machine-count')).toHaveText('6');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('4,500');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('1,000 reachable');
  await expect(panel.getByText('Routed network')).toBeVisible();
  await page.waitForFunction(() => {                                      // tiles are drawn at the base centre
    const c = document.querySelector<HTMLCanvasElement>('canvas[role=img]')!;
    return c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]! > 0;
  });

  const canvas = page.locator('canvas[role=img]');
  const box = (await canvas.boundingBox())!;
  // Resting on the base-centre column describes it (architecture §11, Map hover): its block, named by the names route
  // (the Mini-GT export has no stone item, so by its registry name), and its position; the canvas points at the tooltip.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('minecraft:stone');
  await expect(tip).toContainText('4 63 5');
  await expect(canvas).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText('Add note at 4, 63, 5')).toBeVisible();
  await page.getByLabel('Note').fill('Build here');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(panel.getByTestId('note-1')).toContainText('Build here');
  await page.reload();
  await expect(page.getByTestId('found-panel').getByTestId('note-1')).toContainText('Build here');

  const { uploadId } = await (await page.request.post('/api/world/uploads', { data: {} })).json();
  expect((await page.request.put(`/api/world/uploads/${uploadId}/files/..%2Flevel.dat`, { data: 'x' })).status()).toBe(400);
});
