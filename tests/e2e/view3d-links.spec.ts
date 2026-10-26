// The 3D tab's Show connections end to end (the user's requirements of 2026-10-19, item 3 (b)): on the sample world's
// EnderIO line the toggle starts off; turned on, the Connections tab's links are drawn over the line (new pixels in the
// links' own flat colours) and the tab says how many; hovering one names it as the Connections tab does and redraws it
// thicker while the others fade (the review of f82c98c); a click shows its details and marks it and both its faces in
// white; Focus shows beside the toggle and the note says what it does; and both are still on after a reload.

import { test, expect, type Page } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

/** Runs in the page: keeps a copy of the 3D canvas's pixels (the test keeps its drawing buffer), and how many are lit. */
function keepPixels(): number {
  const c = document.querySelector<HTMLCanvasElement>('[data-testid=view3d-canvas] canvas')!;
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

/**
 * Runs in the page before its scripts: marks a canvas once a draw call of its WebGL 2 context ran (the 3D view's first
 * frame), and keeps the drawing buffer for the test.
 */
function markDrawn(): void {
  try { localStorage.setItem('gp.test.preserveDrawingBuffer', '1'); } catch { /* private mode */ }
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const draw = proto[name];
    if (draw === undefined) continue;
    proto[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      (this.canvas as unknown as { gpDrawn?: true }).gpDrawn = true;
      return draw.apply(this, args);
    };
  }
}

/** Runs in the page: whether the 3D canvas drew its first frame (`markDrawn`). */
function drawn(): boolean {
  return document.querySelector<HTMLCanvasElement & { gpDrawn?: true }>('[data-testid=view3d-canvas] canvas')?.gpDrawn === true;
}

/**
 * Opens the 3D tab (again, while the layout's warnings coming in above the tabs move them) and waits until the line is
 * drawn. It reads the canvas only after the viewer's first frame (the controller's ruling G4 at the integration's release
 * gate, round 2): under load the textures can take longer than the first read, and a `getContext` of the test's own
 * before the viewer's makes the canvas's context without a kept drawing buffer, so every later read saw 0 pixels.
 */
async function open3d(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('tab', { name: '3D' }).click();
    await expect(page.getByTestId('view3d')).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(page.getByTestId('block-list')).toContainText('Item Conduit');
  await expect.poll(() => page.evaluate(drawn), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(keepPixels), { timeout: 15_000 }).toBeGreaterThan(50);
}

test('show the Connections links in 3D, name one by hovering it and mark its faces by clicking it', async ({ page }) => {
  await page.addInitScript(markDrawn);
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E 3D connections');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}/layout`)).json()).status, { timeout: 30_000 }).toBe('ok');

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
