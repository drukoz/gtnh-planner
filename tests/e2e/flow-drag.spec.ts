// The flow diagram's drag while the banner above the tabs changes height (ledger ruling P2-R16): a plan event (anyone's change to the
// project, or another project's surplus) shows "Updating the plan…" above the tabs until the plan is fetched again, and that line moves the
// diagram down the page and back. While the pointer is down, the picture keeps the spot it was grabbed by under the pointer, as the
// Connections view does (connections.spec.ts). It opens a real project of the Mini-GT e2e server and serves a fixture plan in place of the
// server's, the way flow-focus.spec.ts does.

import { test, expect } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { holdReplan, LV_CIRCUITS, openWithPlan } from './helpers.ts';

test('a drag keeps the flow diagram under the pointer while the banner above the tabs changes height', async ({ page }) => {
  // a project that reads no other project's surplus hears no other project's changes: only the replan this test asks for reaches its page
  const id = await openWithPlan(page, circuitLv(), { ...LV_CIRCUITS, useSurplus: false });
  const canvas = page.locator('svg.flow-canvas');
  const box = page.locator('svg.flow-canvas [data-node-id] > rect.flow-node-box').first();
  const letThrough = await holdReplan(page, id);                             // "Updating the plan…" shows: the diagram sits lower
  const area0 = (await canvas.boundingBox())!;
  const from = (await box.boundingBox())!;
  // from the top left corner, which the diagram leaves empty (pipes.spec.ts): a drag may start anywhere
  const [px, py] = [Math.round(area0.x + 6), Math.round(area0.y + 6)];
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 50, py + 25, { steps: 5 });
  await letThrough();                                                         // the plan comes back and the line goes: the diagram moves up
  await page.mouse.move(px + 100, py + 50, { steps: 5 });
  await page.mouse.up();
  const area1 = (await canvas.boundingBox())!;
  const to = (await box.boundingBox())!;
  expect(area1.y - area0.y, 'the diagram moved up the page while the pointer was down').toBeLessThan(-20);
  expect([to.x - from.x, to.y - from.y].map(Math.round)).toEqual([100, 50]);
});
