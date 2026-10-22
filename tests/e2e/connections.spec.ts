// An EnderIO line end to end (plan 11 Task 9; spec §3.6 mode 4, §3.8c): a project on the uploaded sample world's
// Overworld base plans Iron Plates in EnderIO mode; its layout sets every conduit face with a configure step of its
// own and lists the Item Conduits under logistics, the Connections tab draws the line, moves it with a drag (from a box
// and from the background) and zooms it with the wheel, keeps its middle or fits it again when the side panel opens,
// and shows a box's faces in full, and the 3D tab lists the Item Conduits (plan 11, ruling R7's lines, back with Plan
// 5's 3D tab as merge follow-up F3).

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

test('plan an EnderIO line, read its conduit faces in the Connections tab and see the conduits in 3D', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E conduits');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  const layoutOf = async () => (await page.request.get(`/api/projects/${id}/layout`)).json();
  await expect.poll(async () => (await layoutOf()).status, { timeout: 30_000 }).toBe('ok');

  const layout = await layoutOf();
  expect(layout.mode).toBe('enderio');
  const faces = layout.blocks.flatMap((b: { conduits?: Array<{ faces: Array<{ mode: string }> }> }) => (b.conduits ?? []).flatMap((c) => c.faces));
  expect(faces.filter((f: { mode: string }) => f.mode === 'in_out')).toHaveLength(2);           // two bending machines take ingots and make plates
  expect(layout.buildSteps.filter((s: { id: string }) => s.id.startsWith('layout:conduit:'))).toHaveLength(faces.length);
  const plan = await (await page.request.get(`/api/projects/${id}/plan`)).json();
  expect(plan.buildList.find((l: { key: string }) => l.key === 'EnderIO:itemItemConduit@0')).toMatchObject({ group: 'logistics' });

  await expect(page.getByRole('radio', { name: 'EnderIO conduits' })).toBeChecked();
  const view = page.getByTestId('connections');
  // the layout's warnings can still be coming in above the tabs and move them: click again until the tab shows
  await expect(async () => {
    await page.getByRole('tab', { name: 'Connections' }).click();
    await expect(view).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(view).toContainText('2× Basic Bending Machine');
  // the link, not its line: Chromium gives a straight line an empty box, which Playwright counts as hidden
  await expect(view.locator('[data-edge^="flow:"]:has(polyline[stroke])').first()).toBeVisible();
  // the user's request of 2026-10-19: a drag, even one that starts on a box, moves the wire map by what the pointer
  // moved (the view's offset is in screen pixels, whatever zoom the line is fitted at), keeps the zoom and picks
  // nothing; a click still picks the box
  const machine = view.locator('.conn-machine rect').first();
  const viewOf = async (): Promise<number[]> => {
    const transform = (await view.locator('g.conn-pan').getAttribute('transform')) ?? '';
    return (/^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(transform) ?? []).slice(1).map(Number);
  };
  const [x0, y0, k0] = await viewOf();
  const from = (await machine.boundingBox())!;
  const [px, py] = [Math.round(from.x + from.width / 2), Math.round(from.y + from.height / 2)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 100, py + 50, { steps: 10 });
  await page.mouse.up();
  const [x1, y1, k1] = await viewOf();
  expect(x1! - x0!).toBeCloseTo(100, 6);
  expect(y1! - y0!).toBeCloseTo(50, 6);
  expect(k1).toBe(k0);
  const to = (await machine.boundingBox())!;
  expect([to.x - from.x, to.y - from.y].map(Math.round)).toEqual([100, 50]);
  await expect(page.getByTestId('conn-panel')).toHaveCount(0);

  // the Connections view follow-ups (the review of 401d0ca): a drag that starts on the background moves it the same way,
  // and one wheel step zooms it around the pointer (the picture now starts 100 px right and 50 px down of where it was
  // fitted, so the area's top left is background)
  const svg = view.locator('svg[role=group]');
  const area = async () => (await svg.boundingBox())!;
  const width = async () => svg.evaluate((el) => el.clientWidth);   // what the view's resize goes by
  const box = await area();
  const [bx, by] = [Math.round(box.x + x1! / 2), Math.round(box.y + y1! / 2)];
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.getAttribute('role'), [bx, by])).toBe('group');
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx - 60, by - 30, { steps: 12 });                    // out of the area too: the drag holds the pointer
  await page.mouse.up();
  const [x2, y2, k2] = await viewOf();
  expect(x2! - x1!).toBeCloseTo(-60, 6);
  expect(y2! - y1!).toBeCloseTo(-30, 6);
  expect(k2).toBe(k1);
  await expect(page.getByTestId('conn-panel')).toHaveCount(0);
  const [cx, cy] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  const [wx, wy] = [cx - box.x, cy - box.y];
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100);
  const factor = Math.exp(100 * 0.0015);                                       // pan-zoom.ts WHEEL_ZOOM per pixel
  await expect.poll(async () => (await viewOf())[2]).toBeCloseTo(k2! * factor, 6);
  const [x3, y3, k3] = await viewOf();
  expect(x3).toBeCloseTo(wx - (wx - x2!) * (k3! / k2!), 3);                 // the spot under the pointer stays under it
  expect(y3).toBeCloseTo(wy - (wy - y2!) * (k3! / k2!), 3);

  // a moved view keeps the spot in its middle when the side panel opens and the area narrows, and gets it back after
  const wide = await width();
  await machine.click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');
  await expect.poll(width).toBeLessThan(wide);
  const narrow = await width();
  await expect.poll(async () => (await viewOf())[0]).toBeCloseTo(x3! + (narrow - wide) / 2, 3);
  expect((await viewOf()).slice(1)).toEqual([y3, k3]);
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await expect.poll(async () => (await viewOf())[0]).toBeCloseTo(x3!, 3);
  // a fitted view is fitted again: none of the picture is cut off on the right once the panel is open
  await page.getByRole('button', { name: 'Fit' }).click();
  await machine.click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');
  await expect.poll(width).toBeLessThan(wide);
  await expect.poll(async () => {
    const [outer, inner] = [await area(), (await view.locator('g.conn-pan').boundingBox())!];
    return inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1;
  }).toBe(true);
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.getByTestId('block-list')).toContainText('Item Conduit');
});
