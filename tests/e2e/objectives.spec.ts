// Planning modes (add-on 17 Task 9; design spec §3.3, architecture §11.45 (1), (5)): a new project plans for "Cheapest";
// the Compare card plans the three modes side by side, and "Use this mode" switches the project to one, which the
// card and Settings both show, for everyone.

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';

/** A compare plans the three modes on the server, within its time limit (20 s). */
const COMPARE_TIMEOUT_MS = 30_000;

test('compares the three planning modes and uses one', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Planning modes', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const settings = page.getByRole('complementary', { name: 'Project settings' });
  await expect(settings.getByRole('radio', { name: 'Cheapest', exact: true })).toBeChecked();
  await expect(settings.getByRole('combobox', { name: 'Count build cost against' })).toHaveValue('24');

  await page.getByRole('button', { name: 'Compare modes' }).click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  const columns = card.locator('[data-objective]');
  await expect(columns).toHaveCount(3, { timeout: COMPARE_TIMEOUT_MS });
  await expect(columns.locator('h4')).toHaveText(['Least raw material', 'Cheapest', 'Best multi-output']);
  for (const objective of ['least-raw', 'cheapest', 'multi-output']) {
    await expect(card.locator(`[data-objective="${objective}"]`)).toContainText('Raw per hour', { timeout: COMPARE_TIMEOUT_MS });
  }
  await expect(card.locator('[data-objective="cheapest"]').getByRole('button')).toHaveText('In use');

  const least = card.locator('[data-objective="least-raw"]');
  await least.getByRole('button', { name: 'Use this mode' }).click();
  // The replan's plan event fetches the compare again, which says the project plans least raw material now.
  await expect(least.getByRole('button')).toHaveText('In use', { timeout: COMPARE_TIMEOUT_MS });
  await expect(least.getByRole('button')).toBeDisabled();
  await expect(card.locator('[data-objective="cheapest"]').getByRole('button')).toHaveText('Use this mode');
  await expect(settings.getByRole('radio', { name: 'Least raw material', exact: true })).toBeChecked();
  await expect(settings.getByRole('combobox', { name: 'Count build cost against' })).toHaveCount(0);
});
