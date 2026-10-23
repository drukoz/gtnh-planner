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

test('Escape closes one layer per press: an open search list first, then the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Layers');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings' });
  await toggle.click();
  await expect(settings).toBeVisible();

  // a list open in the drawer: typing shows it, and the first Escape is the list's, not the drawer's
  await settings.getByPlaceholder('Search items and fluids').fill('Iron Ingot');
  const matches = settings.getByRole('listbox', { name: 'Matches' });
  await expect(matches).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(matches).toBeHidden();
  // the drawer is still open: its button says so at once, and its backdrop is still there (a drawer that was closing would be
  // drawn for the 260ms of its slide, so the button and the backdrop are what to look at)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  await expect(settings).toBeVisible();

  // nothing is open in it now, so the next Escape closes the drawer and the focus goes back to the button
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('the avoid box\'s list, and a key something inside the drawer has handled, keep the drawer open too', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'More layers');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings' });
  await toggle.click();
  await expect(settings).toBeVisible();

  // the other search list of the column, the avoid box's, is a combobox that closes on Escape the same way
  await settings.getByRole('combobox', { name: 'Avoid a material' }).fill('copp');
  const materials = settings.getByRole('listbox', { name: 'Materials' });
  await expect(materials).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(materials).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // something inside the drawer that takes the key the way a confirmation would, by preventing its default, keeps the drawer open
  await settings.evaluate((aside) => {
    aside.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && aside.dataset['claimEscape'] === 'yes') e.preventDefault();
    });
    aside.dataset['claimEscape'] = 'yes';
  });
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);

  await settings.evaluate((aside) => { aside.dataset['claimEscape'] = 'no'; });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('wide screens keep the settings beside the views and show no button', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'No drawer');
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  // the button is there for a narrow window to find, and hidden by the stylesheet while this one is wide
  await expect(page.locator('.settings-toggle')).toHaveCount(1);
  await expect(page.locator('.settings-toggle')).toBeHidden();
});
