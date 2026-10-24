// "Reuse machines we have" (plan 09 Task 9; ruling P23): the e2e server has no world scan, so the project first lists a
// machine it owns, Mini-GT's Basic Assembler (mteId 121), through a settings op; the flow colours that step owned, and
// turning the switch off in Settings colours every box new again.

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';

test('turning "Reuse machines we have" off takes the owned colouring off every flow box', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  // No raw cap (fix wave 3 (A)): at the default +25 % some plates come from a Basic Bending Machine, a fourth step.
  const id = await createProject(page, 'Reuse', { target: 't:circuit@0', amount: 30, tier: 1, rawCap: null });
  const steps = page.locator('svg.flow-canvas [data-step-id]');
  const owned = page.locator('svg.flow-canvas [data-step-id].owned, svg.flow-canvas [data-step-id].partly-owned');
  await expect(steps).toHaveCount(3);
  await expect(owned).toHaveCount(0);

  const ops = [{ op: 'settings', patch: { ownedManual: [{ mteId: 121, count: 2 }] } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  // 30 a minute takes 5 Basic Assemblers: the 2 on the list make that box partly owned (the plan event brings it).
  await expect(owned).toHaveCount(1);
  await expect(page.locator('svg.flow-canvas [data-step-id].partly-owned', { hasText: 'Basic Assembler' })).toHaveCount(1);
  await expect(page.locator('[data-owned-machine="121"]')).toContainText('2× Basic Assembler (LV)');
  await page.locator('svg.flow-canvas [data-step-id]', { hasText: 'Basic Assembler' }).click();
  await expect(page.getByText('2× Basic Assembler (LV) reused — from your list')).toBeVisible();

  const reuse = page.getByRole('checkbox', { name: 'Reuse machines we have' });
  await expect(reuse).toBeChecked();
  await reuse.uncheck();
  await expect(owned).toHaveCount(0);
  await expect(page.locator('svg.flow-canvas [data-step-id].new')).toHaveCount(3);
  await expect(page.getByText('2× Basic Assembler (LV) reused — from your list')).toHaveCount(0);
  await expect(page.locator('[data-owned-machine="121"]')).toContainText('2× Basic Assembler (LV)');   // the list stays
});
