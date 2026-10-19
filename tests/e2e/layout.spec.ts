// The line layout end to end (Plan 5 Task 16; spec §3.6–3.8): upload the synthetic sample world, plan iron plates on
// its Overworld base, read the layout from the API, see the line on the Map tab, drag it 5 blocks east, follow the
// site pin from the build steps back to the map, and look at the line in the 3D tab.

import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, setName, createProject } from './helpers.ts';
import { makeSampleWorld } from '../helpers/sample-world.ts';

let tmp = '';
let worldDir = '';
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-e2e-layout-')); worldDir = (await makeSampleWorld(tmp)).worldDir; });
test.afterAll(async () => { if (tmp !== '') await rm(tmp, { recursive: true, force: true }); });

test('plan a line, see it on the map, move it, follow a pin and look at it in 3D', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('gp.test.preserveDrawingBuffer', '1'); } catch { /* private mode */ } });
  await login(page);
  await setName(page, 'E2E');

  const { uploadId } = await (await page.request.post('/api/world/uploads', { data: {} })).json();
  for (const rel of ['level.dat', ...(await readdir(join(worldDir, 'region'))).map((f) => `region/${f}`)]) {
    const res = await page.request.put(`/api/world/uploads/${uploadId}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, { data: await readFile(join(worldDir, rel)) });
    expect(res.status()).toBe(204);
  }
  const { scanId } = await (await page.request.post(`/api/world/uploads/${uploadId}/complete`)).json();
  await expect.poll(async () => (await (await page.request.get(`/api/world/scans/${scanId}/status`)).json()).state, { timeout: 60_000 }).toBe('done');

  const id = await createProject(page, 'E2E line');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  const layoutOf = async () => (await page.request.get(`/api/projects/${id}/layout`)).json();
  await expect.poll(async () => (await layoutOf()).status, { timeout: 30_000 }).toBe('ok');
  const layout = await layoutOf();
  expect(layout.blocks.filter((b: { role: string }) => b.role === 'machine')).toHaveLength(2);
  expect(layout.pins.map((p: { kind: string }) => p.kind).slice(0, 3)).toEqual(['site', 'power', 'logistics']);
  expect(layout.power.fits).toBe('no');                     // one HP solar boiler cannot run two bending machines

  await page.getByRole('tab', { name: 'Map' }).click();
  const panel = page.getByTestId('line-panel');
  await expect(panel).toContainText('2 new');
  await expect(panel).toContainText('Does not fit');
  await expect(panel.getByTestId('pin-1')).toBeVisible();

  await panel.getByRole('button', { name: 'Move line' }).click();
  const box = (await page.locator('canvas[role=img]').boundingBox())!;
  const screen = (x: number, z: number) => [box.x + box.width / 2 + (x - 4.5) * 4, box.y + box.height / 2 + (z - 5.5) * 4];   // Plan 4: focus = base centre + 0.5, 4 px per block
  const [sx, sy] = screen(layout.origin[0] + layout.size[0] / 2, layout.origin[2] + layout.size[2] / 2);
  await page.mouse.move(sx!, sy!);
  await page.mouse.down();
  await page.mouse.move(sx! + 20, sy!, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await layoutOf()).origin[0], { timeout: 30_000 }).toBe(layout.origin[0] + 5);

  await page.getByRole('tab', { name: 'Materials' }).click();
  const site = page.locator('[data-row="step:layout:site"]');
  await expect(site).toBeVisible();
  await site.locator('[data-pin="1"]').click();
  await expect(page.getByTestId('line-panel').getByTestId('pin-1')).toBeVisible();

  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.getByTestId('block-list')).toContainText('Basic Bending Machine ×2');
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=view3d-canvas] canvas');
    const gl = c?.getContext('webgl2');
    if (!c || !gl) return false;
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(Math.floor(c.width / 2) - 32, Math.floor(c.height / 2) - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) lit++;
    return lit > 50;
  }, null, { timeout: 15_000 });
  await page.getByLabel('Layer').fill('0');
  await expect(page.getByTestId('view3d')).toContainText('Layers 1–1 of');
});
