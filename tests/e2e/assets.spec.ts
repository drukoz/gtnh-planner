import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';
import { E2E_INGOT_RGBA } from './assets-fixture.ts';

/** Runs in the page: the RGBA of the image's centre pixel, read once the image has decoded (ruling R25). */
async function centrePixel(img: HTMLImageElement): Promise<number[]> {
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  return [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data];
}

test('search results and the materials list show the pack textures, with a plain colour where there is none', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Icons');
  const search = page.getByPlaceholder('Search items and fluids');
  await search.fill('Iron Ingot');
  const ingot = page.getByRole('option', { name: /Iron Ingot/ }).locator('[data-item-key="t:iron_ingot@0"]');
  await expect(ingot).toHaveAttribute('data-icon-source', 'jar');
  await expect(ingot.locator('img')).toBeVisible();
  expect(await ingot.locator('img').evaluate(centrePixel)).toEqual(E2E_INGOT_RGBA);
  await search.fill('Copper Wire');
  const wire = page.getByRole('option', { name: /Copper Wire/ }).locator('[data-item-key="t:copper_wire@0"]');
  await expect(wire).toHaveAttribute('data-icon-source', 'fallback');
  await expect(wire.locator('img')).toHaveCount(0);
  await search.fill('Iron Plate');
  await page.getByRole('option', { name: /Iron Plate/ }).click();
  await page.getByLabel('Tier').selectOption('LV');
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  // The icon sits beside the ticked row, not inside it (ruling R24): `<li class="mat-row"><ItemIcon/><Tick data-row/>`.
  await expect(page.locator('li.mat-row').filter({ has: page.locator('[data-row="run:t:iron_ingot@0"]') }).locator('[data-item-key="t:iron_ingot@0"] img')).toBeVisible();
});

test('asset routes answer logged-in users only and describe GT fluids and machines', async ({ page, browser }) => {
  await login(page);
  const file = await page.request.get('/api/assets/file/t/textures/items/iron_ingot.png');
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/png');
  const [water] = await (await page.request.post('/api/assets/icons', { data: { keys: ['fluid:water'] } })).json();
  expect(water).toMatchObject({ source: 'gt', layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }] });
  const [mac] = await (await page.request.post('/api/assets/blocks', { data: { blocks: [{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 301 }], facing: 5 } })).json();
  expect(mac.faces.east.map((l: { path: string }) => l.path)).toEqual(['gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png', 'gregtech/textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png']);
  const stranger = await browser.newContext({ baseURL: 'http://127.0.0.1:18787' });
  expect((await stranger.request.get('/api/assets/file/t/textures/items/iron_ingot.png')).status()).toBe(401);
  await stranger.close();
});
