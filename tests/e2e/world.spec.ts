// The world map end to end (Plan 4 Task 18; spec §3.4, §3.7): a friend picks the synthetic sample world's folder on
// the World page, the browser finds its hotspots and sends only level.dat and the two trimmed region files, the server
// scans the upload, and a project picks the scan's Overworld base on its Map tab, reads what was found, hovers its
// centre to see what is there (before and after its tile is drawn, and gone once the pointer leaves the map) and pins a
// note that survives a reload. Last, the upload route refuses a path that climbs out of the upload. A second test presses the map while
// the page moves under the pointer: the press stays a click that picks a block, and the map does not pan (ledger rulings P2-R16, P2-R19).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { makeSampleWorld } from '../helpers/sample-world.ts';
import { createProject, login, setName, shiftViews } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

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
  // Other specs upload scans to this server at the same time (layout.spec.ts), so rows are not counted: the page's own
  // upload answers with its scan id, and that scan is the one waited for and picked below.
  const rows = page.getByTestId('scan-row');
  await expect(page.getByText('No scans yet').or(rows.first())).toBeVisible();
  const completed = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/world\/uploads\/[^/]+\/complete$/.test(r.url()));
  await page.getByTestId('upload-button').click();
  const { scanId } = (await (await completed).json()) as { scanId: string };
  await expect.poll(async () => (await (await page.request.get(`/api/world/scans/${scanId}/status`)).json()).state, { timeout: 60_000 }).toBe('done');
  await expect(page.locator('[data-testid=scan-row][data-state=done]').first()).toBeVisible();
  expect([...sent].sort()).toEqual(['DIM-1/region/r.-1.-1.mca', 'level.dat', 'region/r.0.0.mca']);   // no playerdata, no claims, no DIM7

  // The base-centre column's surface tile is held back until the pointer has rested there (architecture §11, Map hover).
  let releaseCentreTile = (): void => {};
  const centreTileHeld = new Promise<void>((resolve) => { releaseCentreTile = resolve; });
  const CENTRE_TILE = /\/api\/world\/scans\/[^/]+\/tiles\/0\/0\/0\?y=255$/;
  await page.route(CENTRE_TILE, async (route) => { await centreTileHeld; await route.continue(); });

  await createProject(page, 'E2E map');
  await page.getByText('Map', { exact: true }).first().click();     // the first project tab (Task 16)
  // exact: the settings panel's tier select also has "world scan" in its label (its "From world (LV until a world scan
  // exists)" option), and a substring match would pick that one before the Map tab has rendered, or both after
  await page.getByLabel('World scan', { exact: true }).selectOption(scanId);
  await page.getByLabel('Base').selectOption({ label: 'Overworld base (4, 5)' });   // the smart upload keeps claim files local, so the base has no team ("Alpha") name
  await page.getByRole('button', { name: 'Use this base' }).click();

  const panel = page.getByTestId('found-panel');
  await expect(panel.getByTestId('machine-count')).toHaveText('6');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('4,500');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('1,000 reachable');
  // Item names come from one batched POST /api/pack/names: the Mini-GT pack names the cobblestone; it has no
  // minecraft:iron_ingot, which keeps showing its key once that same answer is in.
  await expect(panel.locator('[data-key="minecraft:cobblestone@0"]')).toContainText('Cobblestone · 704');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('minecraft:iron_ingot@0 · 4,500');
  await expect(panel.getByText('Routed network')).toBeVisible();

  const canvas = page.locator('canvas[role=img]');
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Resting on the base-centre column describes it (architecture §11, Map hover). While its tile is on its way the
  // tooltip only knows the base the column lies in; when the tile lands it fills in, with the pointer still resting.
  await page.mouse.move(centre.x, centre.y);
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveText('Base: Overworld base (4, 5)');
  releaseCentreTile();
  await page.waitForFunction(() => {                                      // tiles are drawn at the base centre
    const c = document.querySelector<HTMLCanvasElement>('canvas[role=img]')!;
    return c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]! > 0;
  });
  await page.unroute(CENTRE_TILE);
  // Its block, named by the names route (the Mini-GT export has no stone item, so by its registry name), and its
  // position; the canvas points at the tooltip.
  await expect(tip).toContainText('minecraft:stone');
  await expect(tip).toContainText('4 63 5');
  await expect(canvas).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!);
  // Leaving the map (for the Y slider above it) hides the tooltip, and the canvas no longer points at it.
  const slider = (await page.getByLabel('Y level').boundingBox())!;
  await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
  await expect(tip).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('aria-describedby');
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByText('Add note at 4, 63, 5')).toBeVisible();
  await page.getByLabel('Note').fill('Build here');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(panel.getByTestId('note-1')).toContainText('Build here');
  await page.reload();
  await expect(page.getByTestId('found-panel').getByTestId('note-1')).toContainText('Build here');

  const { uploadId } = await (await page.request.post('/api/world/uploads', { data: {} })).json();
  expect((await page.request.put(`/api/world/uploads/${uploadId}/files/..%2Flevel.dat`, { data: 'x' })).status()).toBe(400);
});

// A press on the map that the page moves under stays a click (ledger rulings P2-R16, P2-R19): click and drag go by the pointer's own move
// on the page, as in the diagrams (flow-drag.spec.ts, connections.spec.ts), and a pan, once started, follows the map. So after the page
// moved under a still press, 1 px of jitter still picks the block under the pointer for a note, and the map does not pan.
test('a press on the map that the page moves under stays a click: it picks the block and the map holds', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E map click');
  // the base, read with no other project's surplus: no other project's change reaches the page. Once the plan names the scan, the replan
  // of these ops has sent its plan event (the server plans one at a time, the replan first), and the page opened again after it hears
  // none, so nothing above the tabs moves the map (a change of the hash alone would keep the page that heard it: hence the reload)
  const ops = [{ op: 'settings', patch: { useSurplus: false } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}/plan`)).json()).scanId).toBe(scanId);
  await page.goto(`/p/${id}#map`);
  await page.reload();
  const panel = page.getByTestId('found-panel');
  await expect(panel.getByTestId('machine-count')).toHaveText('6');
  await expect(panel.locator('[data-key="minecraft:cobblestone@0"]')).toContainText('Cobblestone · 704');   // the names are in
  await page.waitForFunction(() => {                                      // the base centre's tile is drawn
    const c = document.querySelector<HTMLCanvasElement>('canvas[role=img]');
    return c !== null && c.width > 0 && c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data[3]! > 0;
  });
  const canvas = page.locator('canvas[role=img]');
  const centreOf = async (): Promise<{ x: number; y: number }> => {
    const box = (await canvas.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const tip = page.getByRole('tooltip');
  const centre = await centreOf();
  await page.mouse.move(centre.x, centre.y);
  await expect(tip).toContainText('4 63 5');                              // the map is centred on the base's centre column, 4 px a block
  await page.mouse.down();
  const unshift = await shiftViews(page, 5);                               // the map moves 5 px down under the still pointer: 1¼ blocks
  await page.mouse.move(centre.x + 1, centre.y);                           // 1 px of jitter
  await page.mouse.up();
  await expect(page.getByText('Add note at 4, 63, 4')).toBeVisible();     // the click picks the block now under the pointer
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();   // the note's dialog covers the map until it closes
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved = await centreOf();
  await page.mouse.move(moved.x, moved.y);
  await expect(tip).toContainText('4 63 5');                              // no pan: the map's centre is the base's centre column still
  await unshift();
});
