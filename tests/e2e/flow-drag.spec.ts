// The flow diagram's drag while the page above it changes height (ledger ruling P2-R16): a plan event (anyone's change to the project, or
// another project's surplus) shows "Updating the plan…" above the tabs until the plan is fetched again, and that line moves the diagram
// down the page and back. While the pointer is down, the picture keeps the spot it was grabbed by under the pointer, as the Connections
// view does (connections.spec.ts, whose pin moves the page with the real busy line); a press stays a click until the pointer itself has
// moved, whatever moves the page under it. Both cases here move the page with a spacer of their own (`shiftViews`). They open a real
// project of the Mini-GT e2e server and serve a fixture plan in place of the server's, the way flow-focus.spec.ts does.

import { test, expect } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { LV_CIRCUITS, openWithPlan, shiftViews } from './helpers.ts';

/** The fixture line, on a project that reads no other project's surplus: no other project's change reaches its page. */
const QUIET = { ...LV_CIRCUITS, useSurplus: false };

test('a drag keeps the flow diagram under the pointer while the page above it changes height', async ({ page }) => {
  const shift = 30;
  await openWithPlan(page, circuitLv(), QUIET);
  const canvas = page.locator('svg.flow-canvas');
  const box = page.locator('svg.flow-canvas [data-node-id] > rect.flow-node-box').first();
  const area0 = (await canvas.boundingBox())!;
  const from = (await box.boundingBox())!;
  // from the top left corner, which the diagram leaves empty (pipes.spec.ts): a drag may start anywhere
  const [px, py] = [Math.round(area0.x + 6), Math.round(area0.y + 6)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 50, py + 25, { steps: 5 });
  const unshift = await shiftViews(page, shift);                              // the diagram moves 30 px down while the pointer is down
  await page.mouse.move(px + 100, py + 50, { steps: 5 });
  await page.mouse.up();
  const area1 = (await canvas.boundingBox())!;
  const to = (await box.boundingBox())!;
  expect(area1.y - area0.y, 'the diagram moved down the page while the pointer was down').toBeCloseTo(shift, 3);
  expect([to.x - from.x, to.y - from.y].map(Math.round)).toEqual([100, 50]);
  await unshift();
});

test('a press that the page moves under stays a click: the step opens and the diagram holds', async ({ page }) => {
  const shift = 12;
  await openWithPlan(page, circuitLv(), QUIET);
  const pan = page.locator('svg.flow-canvas > g');                           // the diagram's pan group: its transform is the view
  const step = page.locator('svg.flow-canvas [data-step-id] > rect.flow-node-box').first();
  const before = await pan.getAttribute('transform');
  const from = (await step.boundingBox())!;
  expect(from.height, 'the pointer stays on the box when the diagram moves under it').toBeGreaterThan(2 * (shift + 2));
  const [px, py] = [Math.round(from.x + from.width / 2), Math.round(from.y + from.height / 2)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  const unshift = await shiftViews(page, shift);                              // the diagram moves 12 px down under the still pointer
  await page.mouse.move(px + 1, py);                                           // 1 px of jitter
  await page.mouse.up();
  await expect(page.getByRole('complementary', { name: /^Step: / })).toBeVisible();
  expect(await pan.getAttribute('transform')).toBe(before);
  await unshift();
});
