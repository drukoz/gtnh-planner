// The settings column is a drawer on a narrow screen (restyle plan Phase 1 Task 4, design spec §7a): the Settings button of the
// project head slides it in over a dimmed page, Escape or a click on the page behind closes it, and Escape gives the focus back
// to the button. A wide screen keeps the column beside the views and never shows the button.

import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('narrow screens open the settings as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drawer');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings' });

  // closed: the column is slid out of sight, and out of the tab order with it
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await toggle.click();
  await expect(settings).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Escape closes it from inside, and the focus goes back to the button (a click focuses a button too, so the focus starts in the drawer)
  await settings.getByPlaceholder('Search items and fluids').focus();
  await expect(settings.getByPlaceholder('Search items and fluids')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // the dimmed page behind the drawer closes it too
  await toggle.click();
  await expect(settings).toBeVisible();
  await page.locator('.drawer-backdrop').click();
  await expect(settings).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});

test('wide screens keep the settings beside the views and show no button', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'No drawer');
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  // the button is there for a narrow window to find, and hidden by the stylesheet while this one is wide
  await expect(page.locator('.settings-toggle')).toHaveCount(1);
  await expect(page.locator('.settings-toggle')).toBeHidden();
});
