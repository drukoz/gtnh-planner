// An EnderIO line end to end (plan 11 Task 9; spec §3.6 mode 4, §3.8c): a project on the uploaded sample world's
// Overworld base plans Iron Plates in EnderIO mode; its layout sets every conduit face with a configure step of its
// own and lists the Item Conduits under logistics, the Connections tab draws the line, moves it with a drag and shows a
// box's faces in full, and the 3D tab lists the Item Conduits (plan 11, ruling R7's lines, back with Plan 5's 3D tab as
// merge follow-up F3).

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
  await page.getByRole('tab', { name: 'Connections' }).click();
  const view = page.getByTestId('connections');
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
  await machine.click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.getByTestId('block-list')).toContainText('Item Conduit');
});
