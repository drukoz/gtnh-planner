// An EnderIO line end to end (plan 11 Task 9; spec §3.6 mode 4, §3.8c): a project on the uploaded sample world's
// Overworld base plans Iron Plates in EnderIO mode; its layout sets every conduit face with a configure step of its
// own and lists the Item Conduits under logistics, and the Connections tab draws the line and shows a box's faces in
// full. The 3D view's conduit check, and the title's words for it, come back with Plan 5's 3D tab (plan 11, ruling R7).

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

test('plan an EnderIO line and read its conduit faces in the Connections tab', async ({ page }) => {
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
  await view.locator('.conn-machine rect').first().click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');
});
