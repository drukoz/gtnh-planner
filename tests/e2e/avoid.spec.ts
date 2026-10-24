// Materials to avoid (plan 2026-10-18-08, ruling R14): the e2e export is Mini-GT, which has no Silver, so the line avoids
// Copper, which both Basic Circuit recipes need (copper wire): the plan still comes out, with the steps that cannot do
// without it flagged, and goes back to the plain plan once the entry is removed.

import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('avoiding a material flags the steps that cannot do without it, and removing it plans as before', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  // No raw cap (fix wave 3 (A)): at the default +25 % some plates come from a Basic Bending Machine, a fourth step.
  await createProject(page, 'No copper', { target: 't:circuit@0', amount: 30, tier: 1, rawCap: null });
  const steps = page.locator('svg [data-step-id]');
  const badges = page.locator('svg [data-step-id] [data-avoid-badge]');
  await expect(steps).toHaveCount(3);
  await expect(badges).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Avoid a material' }).fill('copp');
  await page.getByRole('option', { name: 'Copper', exact: true }).click();
  const chip = page.getByRole('button', { name: 'Remove Copper' });
  await expect(chip).toBeVisible();
  // The re-plan arrives through the plan event: the wiremill and the assembler use copper, as nothing at LV avoids it.
  await expect(badges).toHaveCount(2);
  await expect(page.getByText('Basic Wiremill uses Copper Ingot — no recipe at LV avoids it').first()).toBeVisible();
  await expect(steps).toHaveCount(3);

  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(badges).toHaveCount(0);
  await expect(page.getByText('Basic Wiremill uses Copper Ingot — no recipe at LV avoids it')).toHaveCount(0);
  await expect(steps).toHaveCount(3);
});
