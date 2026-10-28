import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('a planned line renders as a flow diagram and a materials list', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  // "Raw material for fewer machines" at "No limit" (fix wave 3 (A)): at the default +25 % over the leanest line, the
  // line below makes 40 % of its plates on one new Basic Bending Machine (4 steps, 2,880 Iron Ingots an hour).
  const id = await createProject(page, 'Circuits', { rawCap: null });               // leaves the page on /p/<id>#flow
  await expect(page).toHaveURL(new RegExp(`/p/${id}#flow$`));
  await page.getByPlaceholder('Search items and fluids').fill('basic circ');
  await page.getByRole('option', { name: /Basic Circuit/ }).click();
  await page.getByLabel('Amount').fill('30');
  await page.getByLabel('Tier').selectOption('LV');
  await expect(page.locator('svg [data-step-id]')).toHaveCount(3);
  await page.locator('svg [data-step-id]', { hasText: 'Basic Assembler' }).click();   // ids are content hashes in a real export
  await expect(page.getByText('Swap recipe')).toBeVisible();
  await expect(page.getByText('0 overclocks → 16 EU/t × 200 t')).toBeVisible();
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  // At the default "Fewest machines" (each new machine block costs half a day's least raw material, plan 12 fix wave 2)
  // with no raw cap, the plates come from the automated crafting table, 2 ingots each, not from 3 new Bending Machines.
  await expect(page.locator('[data-row="run:t:iron_ingot@0"]')).toContainText('3,600/h');
  await page.evaluate(() => { location.hash = '#notes'; });                           // a hash set from outside the tab bar (Plan 5's pin links)
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
});

test('at the default raw cap a good made two ways on purpose is a plain note, not a problem', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  // Plan 12's final review: at the default +25 % raw cap the line makes 40 % of its plates on one full Basic Bending
  // Machine and the rest on the automated crafting table, the plan the settings ask for: the plan marks the split, so the
  // banner notes it plainly and the flow lists nothing that does not add up.
  await createProject(page, 'Capped circuits', { target: 't:circuit@0', amount: 30, tier: 1 });
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(4);
  await expect(page.locator('.plan-banner .banner-notes')).toHaveText('Iron Plate is made 2 ways: Crafting table (automated) (60%) and Basic Bending '
    + 'Machine (40%). The Basic Bending Machine is full, and one more would cost more than the raw material it saves.');
  await expect(page.getByText('This plan does not add up')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'What does not add up' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  await expect(page.locator('[data-row="run:t:iron_ingot@0"]')).toContainText('2,880/h');
});

test('an impossible target explains what unlocks it', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Titanium');
  const ops = [{ op: 'settings', patch: { target: 't:titanium_plate@0', tier: 2 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(page.getByText('Titanium Ingot: needs Moon (T1 rocket) — reachable at HV').first()).toBeVisible();   // arrives through the plan event; banner and Flow tab both show it
});
