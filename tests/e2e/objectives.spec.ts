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

// The Machine GUI restyle moved the card's button into the project head, so a closed card takes no room under the banner (the chrome's
// height budget, which layout.spec.ts's press on the map canvas needs): the button opens and closes the card, which opens under the plan
// banner in the banners' box (inert with it while the settings drawer is open), and the card's Close gives the focus back to the button.
test('opens the Compare card from the project head, adds nothing while closed, and gives the focus back on Close', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Head button', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const head = page.locator('.project-head');
  const toggle = head.getByRole('button', { name: 'Compare modes' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'compare-card');
  await expect(page.locator('.compare-card')).toHaveCount(0);
  // a small button in a head that keeps its 36px
  expect((await toggle.boundingBox())!.height).toBe(28);
  expect((await head.boundingBox())!.height).toBe(36);

  await toggle.click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('id', 'compare-card');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // the last of the banners' box: under the plan's cost and banner
  expect(await card.evaluate((el) => el.parentElement?.classList.contains('project-banners') === true && el.parentElement.lastElementChild === el)).toBe(true);

  await card.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  // the head's button closes it as well
  await toggle.click();
  await expect(card).toBeVisible();
  await toggle.click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
});

// Below 900 px the head's one row is full: the Settings button says what the line makes there (the Make picker fix), and the head must
// stay one row on a tablet. So on a narrow window the Compare modes button is in a bar of its own under the banner, and the head's is not
// drawn; it opens the same card, whose Close gives the focus back to it. The project has a target, so the drawer does not open by itself.
test('on a narrow window the Compare modes button sits in a bar under the banner, and the head stays one row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Narrow compare', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  await expect(page.locator('svg [data-step-id]').first()).toBeVisible();          // the plan is in: the drawer would have opened by now
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Compare modes' });
  await expect(toggle).toHaveCount(1);                                               // the head's is not drawn here
  await expect(page.locator('.project-head .compare-toggle')).toBeHidden();
  expect(await toggle.evaluate((el) => el.parentElement?.classList.contains('compare-bar') === true && el.closest('.project-banners') !== null)).toBe(true);
  expect((await page.locator('.project-head').boundingBox())!.height, 'the head is one row').toBe(36);

  await toggle.click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  await expect(card).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // wide again, the head's button is the one drawn, and the bar is gone
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.project-head').getByRole('button', { name: 'Compare modes' })).toBeVisible();
  await expect(page.locator('.compare-bar')).toBeHidden();
});
