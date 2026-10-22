import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('a planned line renders as a flow diagram and a materials list', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Circuits');                                  // leaves the page on /p/<id>#flow
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
  // the plates come from the automated crafting table, 2 ingots each, rather than from 3 new Bending Machines.
  await expect(page.locator('[data-row="run:t:iron_ingot@0"]')).toContainText('3,600/h');
  await page.evaluate(() => { location.hash = '#notes'; });                           // a hash set from outside the tab bar (Plan 5's pin links)
  await expect(page.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
});

test('an impossible target explains what unlocks it', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Titanium');
  const ops = [{ op: 'settings', patch: { target: 't:titanium_plate@0', tier: 2 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(page.getByText('Titanium Ingot: needs Moon (T1 rocket) — reachable at HV').first()).toBeVisible();   // arrives through the plan event; banner and Flow tab both show it
});
