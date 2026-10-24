// The 3D tab's Show connections end to end (the user's requirements of 2026-10-19, item 3 (b)): on the sample world's
// EnderIO line the toggle starts off; turned on, the Connections tab's links are drawn over the line (new pixels in the
// links' own flat colours) and the tab says how many; hovering one names it as the Connections tab does and redraws it
// thicker while the others fade (the review of f82c98c); a click shows its details and marks it and both its faces in
// white; Focus shows beside the toggle and the note says what it does; and both are still on after a reload. The second
// test holds the scene's block faces back, so the canvas is read before the viewer is made: that read must leave the
// canvas's WebGL context to the viewer, or the line never reads back (Phase 2 Task F1).

import { test, expect, type Page } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

/**
 * Runs in the page: keeps a copy of the 3D canvas's pixels (the test keeps its drawing buffer), and how many are lit:
 * none until the viewer has made the canvas's WebGL context. three's renderer marks the canvas (`data-engine`) just
 * before it does, in the same task; asking for the context earlier would make it here, with WebGL's defaults, and the
 * renderer would be handed that one, its own ask for a kept buffer ignored: each frame would be cleared once shown and
 * read back blank.
 */
function keepPixels(): number {
  const c = document.querySelector<HTMLCanvasElement>('[data-testid=view3d-canvas] canvas')!;
  if (!c.hasAttribute('data-engine')) return 0;
  const gl = c.getContext('webgl2')!;
  const px = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  (window as unknown as { gpKept: Uint8Array }).gpKept = px;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) lit++;
  return lit;
}

/**
 * Runs in the page: how many of the canvas's pixels changed since `keepPixels` (all of them when its size changed), how
 * many are white, and the page point of a changed pixel whose 3 × 3 neighbours all have its colour: inside a link drawn
 * in a channel's colour (never the hookup's grey), whose colour comes back too.
 */
function changedPixels(): { changed: number; white: number; point: [number, number] | null; rgb: number[] | null } {
  const c = document.querySelector<HTMLCanvasElement>('[data-testid=view3d-canvas] canvas')!;
  const gl = c.getContext('webgl2')!;
  const [w, h] = [c.width, c.height];
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const kept = (window as unknown as { gpKept: Uint8Array }).gpKept;
  const differs = (i: number): boolean => kept.length !== px.length || [0, 1, 2, 3].some((k) => px[i + k] !== kept[i + k]);
  let changed = 0, white = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (differs(i)) changed++;
    if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255 && px[i + 3] === 255) white++;
  }
  const rect = c.getBoundingClientRect();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (!differs(i) || px[i + 3] !== 255) continue;
      const rgb = [px[i]!, px[i + 1]!, px[i + 2]!];
      if (rgb.join() === '138,146,160' || rgb.join() === '255,255,255') continue;   // a hookup's link, a picked one
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) {
        for (let dx = -1; dx <= 1 && same; dx++) {
          const j = ((y + dy) * w + x + dx) * 4;
          same = px[j] === rgb[0] && px[j + 1] === rgb[1] && px[j + 2] === rgb[2] && differs(j);
        }
      }
      // readPixels counts rows from the bottom
      if (same) return { changed, white, point: [rect.left + ((x + 0.5) * rect.width) / w, rect.top + ((h - y - 0.5) * rect.height) / h], rgb };
    }
  }
  return { changed, white, point: null, rgb: null };
}

/** Opens the 3D tab (again, while the layout's warnings coming in above the tabs move them) and waits for its block list. */
async function show3d(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('tab', { name: '3D' }).click();
    await expect(page.getByTestId('view3d')).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(page.getByTestId('block-list')).toContainText('Item Conduit');
}

/** `show3d`, then waits until the line is drawn. */
async function open3d(page: Page): Promise<void> {
  await show3d(page);
  await expect.poll(() => page.evaluate(keepPixels), { timeout: 15_000 }).toBeGreaterThan(50);
}

/** Logs in, with the canvas kept readable, and lays out the sample world's EnderIO iron plate line; resolves once its layout is in. */
async function enderioLine(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('gp.test.preserveDrawingBuffer', '1'); } catch { /* private mode */ } });
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E 3D connections');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}/layout`)).json()).status, { timeout: 30_000 }).toBe('ok');
}

test('show the Connections links in 3D, name one by hovering it and mark its faces by clicking it', async ({ page }) => {
  await enderioLine(page);

  await open3d(page);
  const toggle = page.getByRole('checkbox', { name: 'Show connections' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('view3d-links')).toHaveCount(0);
  await page.evaluate(keepPixels);

  // on: the links are drawn over the line, in their own flat colours, and the tab says how many
  await toggle.check();
  await expect(page.getByTestId('view3d-links')).toContainText(/\d+ connections? drawn/);
  await expect.poll(async () => (await page.evaluate(changedPixels)).changed, { timeout: 10_000 }).toBeGreaterThan(100);
  const { point, rgb } = await page.evaluate(changedPixels);
  expect(point, 'a pixel inside a drawn link').not.toBeNull();
  expect(rgb).not.toBeNull();

  // hovering it names it as the Connections tab writes it on the link: the good, its rate and its channel; it is drawn
  // thicker and lighter, and the other links fade
  await page.evaluate(keepPixels);
  await page.mouse.move(point![0], point![1]);
  await expect(page.getByTestId('view3d-hover')).toContainText(/\/min/);
  await expect.poll(async () => (await page.evaluate(changedPixels)).changed, { timeout: 10_000 }).toBeGreaterThan(50);

  // a click shows its details and marks it and both its faces in white
  const white = (await page.evaluate(changedPixels)).white;
  await page.evaluate(keepPixels);
  await page.mouse.click(point![0], point![1]);
  const info = page.getByTestId('view3d-info');
  await expect(info).toContainText('channel');
  await expect(info).toContainText('From ');
  await expect(info).toContainText('To ');
  await expect.poll(async () => (await page.evaluate(changedPixels)).white).toBeGreaterThan(white + 20);

  // Focus: beside the toggle while the links show, off at first; on, the note says what it does
  const focus = page.getByRole('checkbox', { name: 'Focus' });
  await expect(focus).not.toBeChecked();
  await expect(page.getByTestId('view3d-links')).not.toContainText('Focus');
  await focus.check();
  await expect(page.getByTestId('view3d-links')).toContainText('Focus shows only the links of the block under the pointer');

  // kept in this browser: both still on after a reload
  await page.reload();
  await open3d(page);
  await expect(page.getByRole('checkbox', { name: 'Show connections' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Focus' })).toBeChecked();
  await expect(page.getByTestId('view3d-links')).toContainText(/\d+ connections? drawn/);
});

// The block list that open3d waits for shows as soon as the layout is in, but the viewer is made only once the scene's
// block faces, icons, covers and textures have come, so open3d's first read can come before it: the first test lost
// that race now and then, more often under load (Phase 2 Task F1). Holding the faces back makes the read come first
// every time.
test('a read of the 3D canvas while its block faces are on the way leaves the canvas to the viewer, so the line reads back once drawn', async ({ page }) => {
  await enderioLine(page);
  let asked = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/assets/blocks', async (route) => {
    asked++;
    await held;
    await route.continue();
  });

  await show3d(page);
  await expect.poll(() => asked).toBeGreaterThan(0);              // the viewer waits on the held faces
  expect(await page.evaluate(keepPixels)).toBe(0);                // nothing drawn yet
  release();
  await expect.poll(() => page.evaluate(keepPixels), { timeout: 15_000 }).toBeGreaterThan(50);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
