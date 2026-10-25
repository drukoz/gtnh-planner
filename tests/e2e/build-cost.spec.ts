// The build horizon (plan 12 Task 7, design spec §3.3): a running line's plan says what it uses to run and to build its
// new machines, counted over 24 hours of running by default; "Count build cost against" in Settings changes the horizon
// for everyone, and a Make N batch, which counts the build cost against the batch itself, has no such choice.

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';

test('the plan counts the build cost of new machines over the horizon the settings pick', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Build cost', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const cost = page.locator('.plan-cost');
  await expect(cost).toContainText('raw per hour to run');
  await expect(cost).toContainText('counted over 24 h');
  // The key-numbers strip (Phase 2 spec §10) shows the build cost in a tile of its own, whose qualifier says the horizon.
  const strip = page.locator('.key-numbers');
  await expect(strip).toContainText('To build');
  await expect(strip).toContainText('raw');
  const over = page.locator('[data-key-number="build"] .key-number-sub');
  await expect(over).toHaveText('over 24 h');

  const horizon = page.getByRole('combobox', { name: 'Count build cost against' });
  await expect(horizon).toHaveValue('24');
  await horizon.selectOption({ label: '1 hour' });
  // The replan arrives through the plan event.
  await expect(cost).toContainText('counted over 1 h');
  await expect(over).toHaveText('over 1 h');

  await page.getByRole('radio', { name: 'Make N (batch)' }).check();
  await expect(horizon).toHaveCount(0);
  await expect(page.getByText('Make N counts the build cost of new machines against the batch itself.')).toBeVisible();
  await expect(cost).toContainText('raw for the batch');
});
