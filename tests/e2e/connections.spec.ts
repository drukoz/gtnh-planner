// An EnderIO line end to end (plan 11 Task 9; spec §3.6 mode 4, §3.8c): a project on the uploaded sample world's
// Overworld base plans Iron Plates in EnderIO mode; its layout sets every conduit face with a configure step of its
// own and lists the Item Conduits under logistics, the Connections tab draws the line, moves it with a drag (from a box
// and from the background) and zooms it with the wheel, keeps its middle or fits it again when the side panel opens,
// and shows a box's faces in full, and the 3D tab lists the Item Conduits (plan 11, ruling R7's lines, back with Plan
// 5's 3D tab as merge follow-up F3). A drag keeps the box it started on under the pointer while the banner above the
// tabs changes height, and a press the page moves under stays a click (ledger ruling P2-R16).

import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, holdReplan, login, setName, shiftViews } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

/** Project `id`'s layout, from the layout route. */
async function layoutOf(page: Page, id: string) {
  return (await page.request.get(`/api/projects/${id}/layout`)).json();
}

/**
 * A new project on the uploaded sample world's Overworld base that plans 24 Iron Plates a minute in EnderIO mode, its ops sent while its
 * page is open; resolves with its id once the server has laid the line out. The line reads no other project's surplus: the e2e server is
 * shared, and a project that reads the group's offers hears a `plan` event whenever another test's project withdraws its summary or changes
 * what it draws (the surplus board's fan-out), at moments no test controls (ledger ruling P2-R16).
 */
async function conduitsLine(page: Page): Promise<string> {
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E conduits');
  const ops = [
    { op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio', useSurplus: false } },
    { op: 'world', scanId, baseId: '0:0:0' },
  ];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  await expect.poll(async () => (await layoutOf(page, id)).status, { timeout: 30_000 }).toBe('ok');
  return id;
}

/**
 * Opens the line's page again, so that nothing above its tabs changes height while a test measures boxes on the page (ledger ruling
 * P2-R16). A `plan` event shows "Updating the plan…" above the tabs until the page has fetched the plan again, a line that moves every
 * view under it down the page (24.3 px here) and back. The replan of the line's ops sent the page its event before the layout route
 * answered 'ok' (the server plans one at a time, and the replan was asked first), so the page opened now loads the plan the server
 * settled on and hears no `plan` event: `conduitsLine` keeps the other projects' changes from reaching it.
 */
async function reopenSettled(page: Page): Promise<void> {
  await page.reload();
}

/** Opens the Connections tab of the line's page and waits for its boxes and a link; returns the view. */
async function showConnections(page: Page): Promise<Locator> {
  const view = page.getByTestId('connections');
  // the layout's warnings can still be coming in above the tabs and move them: click again until the tab shows
  await expect(async () => {
    await page.getByRole('tab', { name: 'Connections' }).click();
    await expect(view).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(view).toContainText('2× Basic Bending Machine');
  // the link, not its line: Chromium gives a straight line an empty box, which Playwright counts as hidden
  await expect(view.locator('[data-edge^="flow:"]:has(polyline[stroke])').first()).toBeVisible();
  return view;
}

/** The view's offset (screen px) and zoom, from the picture's transform. */
async function viewOf(view: Locator): Promise<number[]> {
  const transform = (await view.locator('g.conn-pan').getAttribute('transform')) ?? '';
  return (/^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(transform) ?? []).slice(1).map(Number);
}

test('plan an EnderIO line, read its conduit faces in the Connections tab and see the conduits in 3D', async ({ page }) => {
  const id = await conduitsLine(page);

  const layout = await layoutOf(page, id);
  expect(layout.mode).toBe('enderio');
  const faces = layout.blocks.flatMap((b: { conduits?: Array<{ faces: Array<{ mode: string }> }> }) => (b.conduits ?? []).flatMap((c) => c.faces));
  expect(faces.filter((f: { mode: string }) => f.mode === 'in_out')).toHaveLength(2);           // two bending machines take ingots and make plates
  expect(layout.buildSteps.filter((s: { id: string }) => s.id.startsWith('layout:conduit:'))).toHaveLength(faces.length);
  const plan = await (await page.request.get(`/api/projects/${id}/plan`)).json();
  expect(plan.buildList.find((l: { key: string }) => l.key === 'EnderIO:itemItemConduit@0')).toMatchObject({ group: 'logistics' });

  await expect(page.getByRole('radio', { name: 'EnderIO conduits' })).toBeChecked();
  // the page took the ops as they came; it opens again on the settled line before anything is measured on the page
  await reopenSettled(page);
  const view = await showConnections(page);
  // the user's request of 2026-10-19: a drag, even one that starts on a box, moves the wire map by what the pointer
  // moved (the view's offset is in screen pixels, whatever zoom the line is fitted at), keeps the zoom and picks
  // nothing; a click still picks the box
  const machine = view.locator('.conn-machine rect').first();
  const [x0, y0, k0] = await viewOf(view);
  const from = (await machine.boundingBox())!;
  const [px, py] = [Math.round(from.x + from.width / 2), Math.round(from.y + from.height / 2)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 100, py + 50, { steps: 10 });
  await page.mouse.up();
  const [x1, y1, k1] = await viewOf(view);
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
  const [x2, y2, k2] = await viewOf(view);
  expect(x2! - x1!).toBeCloseTo(-60, 6);
  expect(y2! - y1!).toBeCloseTo(-30, 6);
  expect(k2).toBe(k1);
  await expect(page.getByTestId('conn-panel')).toHaveCount(0);
  const [cx, cy] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  const [wx, wy] = [cx - box.x, cy - box.y];
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100);
  const factor = Math.exp(100 * 0.0015);                                       // pan-zoom.ts WHEEL_ZOOM per pixel
  await expect.poll(async () => (await viewOf(view))[2]).toBeCloseTo(k2! * factor, 6);
  const [x3, y3, k3] = await viewOf(view);
  expect(x3).toBeCloseTo(wx - (wx - x2!) * (k3! / k2!), 3);                 // the spot under the pointer stays under it
  expect(y3).toBeCloseTo(wy - (wy - y2!) * (k3! / k2!), 3);

  // a moved view keeps the spot in its middle when the side panel opens and the area narrows, and gets it back after
  const wide = await width();
  await machine.click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');
  await expect.poll(width).toBeLessThan(wide);
  const narrow = await width();
  await expect.poll(async () => (await viewOf(view))[0]).toBeCloseTo(x3! + (narrow - wide) / 2, 3);
  expect((await viewOf(view)).slice(1)).toEqual([y3, k3]);
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await expect.poll(async () => (await viewOf(view))[0]).toBeCloseTo(x3!, 3);
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

// Ledger ruling P2-R16: a plan event (anyone's change to the project, or another project's surplus) shows "Updating the plan…" above the
// tabs until the plan is fetched again, and that line moves the view down the page and back. A drag keeps the spot it grabbed under the
// pointer meanwhile: the box moves on the page with the pointer, and the view's offset by what the pointer moved over the view.
// TASK 8 RE-POINTS THIS PIN: it is the one pin that moves the view with the real busy line, the user's case (the others make their own
// shift, `shiftViews`). Ledger ruling P2-R18 has Task 8 stop that line from reflowing; this pin's `shift < -20` precondition fails then.
test('a drag keeps the box it started on under the pointer while the banner above the tabs changes height', async ({ page }) => {
  const id = await conduitsLine(page);
  await reopenSettled(page);
  const view = await showConnections(page);
  const svg = view.locator('svg[role=group]');
  const machine = view.locator('.conn-machine rect').first();
  const letThrough = await holdReplan(page, id);                             // "Updating the plan…" shows: the view sits lower
  const [x0, y0, k0] = await viewOf(view);
  const area0 = (await svg.boundingBox())!;
  const from = (await machine.boundingBox())!;
  const [px, py] = [Math.round(from.x + from.width / 2), Math.round(from.y + from.height / 2)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 50, py + 25, { steps: 5 });
  await letThrough();                                                         // the plan comes back and the line goes: the view moves up
  await page.mouse.move(px + 100, py + 50, { steps: 5 });
  await page.mouse.up();
  const area1 = (await svg.boundingBox())!;
  const to = (await machine.boundingBox())!;
  const [x1, y1, k1] = await viewOf(view);
  const shift = area1.y - area0.y;
  expect(shift, 'the view moved up the page while the pointer was down').toBeLessThan(-20);
  expect([to.x - from.x, to.y - from.y].map(Math.round)).toEqual([100, 50]);
  expect(x1! - x0!).toBeCloseTo(100, 6);
  expect(y1! - y0!).toBeCloseTo(50 - shift, 3);                               // what the pointer moved over the view
  expect(k1).toBe(k0);
  await expect(page.getByTestId('conn-panel')).toHaveCount(0);
});

// A press is a click until the pointer itself has moved DRAG_THRESHOLD px on the page (P2-R16, fix round 1): when the page moves under a
// still press (a spacer above the banners here, as the busy line does it), 1 px of jitter still leaves it a click. The box is picked, as a
// click picks it, and no drag moves the view.
test('a press that the page moves under stays a click: the box is picked and the view holds', async ({ page }) => {
  const shift = 12;
  await conduitsLine(page);
  await reopenSettled(page);
  const view = await showConnections(page);
  const machine = view.locator('.conn-machine rect').first();
  // an arrow key moves the view first: the panel's opening then keeps its offset's y and its zoom (a fitted view would be fitted again)
  await view.locator('svg[role=group]').focus();
  await page.keyboard.press('ArrowLeft');
  const [, y0, k0] = await viewOf(view);
  const from = (await machine.boundingBox())!;
  expect(from.height, 'the pointer stays on the box when the view moves under it').toBeGreaterThan(2 * (shift + 2));
  const [px, py] = [Math.round(from.x + from.width / 2), Math.round(from.y + from.height / 2)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  const unshift = await shiftViews(page, shift);                              // the view moves 12 px down under the still pointer
  await page.mouse.move(px + 1, py);                                           // 1 px of jitter
  await page.mouse.up();
  await expect(page.getByTestId('conn-panel')).toContainText('Basic Bending Machine');
  expect((await viewOf(view)).slice(1)).toEqual([y0, k0]);
  await unshift();
});
