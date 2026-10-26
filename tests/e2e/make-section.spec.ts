// The settings' Make section and the keyboard (Task F3). A held Enter acts once, wherever its first press puts the focus (ledger ruling
// P2-R69a): "Pick something to make" in the banner hands the focus to the Make search, which reopens a list a query typed earlier left behind,
// and the held key's repeats must not pick from it (the search's own Enter skips a prevented key, ledger ruling P2-R76). Clear goes with the
// target it clears, so it hands the focus to the item search first, the next thing to do, drawn in both states (ledger ruling P2-R78).

import { test, expect, type Locator, type Page } from '@playwright/test';
import { bodyFocusCount, createProject, login, LV_CIRCUITS, noDialogs, setName, SETTINGS_BUTTON, watchBodyFocus } from './helpers.ts';

/** Counts the op posts `page` makes from now on (a settings change is one); read the array's length. */
function opPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/ops')) posts.push(r.url()); });
  return posts;
}

test('a held Enter on "Pick something to make" does not pick from the list the search reopens', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Make held');                                                 // 1280 × 720, no target: the column beside the views
  const settings = page.locator('aside[aria-label="Project settings"]');
  const search = settings.getByPlaceholder('Search items and fluids');
  const hint = page.getByRole('button', { name: 'Pick something to make' });
  await expect(hint).toBeVisible();
  await search.fill('basic circuit');
  await expect(page.getByRole('listbox', { name: 'Matches' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());      // the query stays, unpicked
  await expect(page.getByRole('listbox', { name: 'Matches' })).toHaveCount(0);
  const posts = opPosts(page);
  await watchBodyFocus(page);
  await hint.focus();
  await page.keyboard.down('Enter');
  await expect(search).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Matches' })).toBeVisible();              // the list is back, an option active
  await page.keyboard.down('Enter');                                                      // the held key repeats, on the search
  await page.keyboard.up('Enter');
  await expect(settings.getByText('Nothing picked yet')).toBeVisible();
  await expect(settings.locator('.settings-target')).toHaveCount(0);
  expect(posts, 'no settings op was sent').toEqual([]);
  // the control: a press of its own in the search picks, and is posted
  await page.keyboard.press('Enter');
  await expect(settings.locator('.settings-target-name')).toHaveText('Basic Circuit');
  await expect.poll(() => posts.length).toBe(1);
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

/** Presses the Make section's Clear in `settings` by the keyboard or the pointer, and checks the item search takes the focus. */
async function clearHandsOn(page: Page, settings: Locator, by: 'keyboard' | 'pointer'): Promise<void> {
  const clear = settings.getByRole('button', { name: 'Clear', exact: true });
  if (by === 'keyboard') {
    await clear.focus();
    await page.keyboard.press('Enter');
  } else {
    await clear.click();
  }
  await expect(settings.getByText('Nothing picked yet')).toBeVisible();
  await expect(settings.getByPlaceholder('Search items and fluids')).toBeFocused();
}

/** Picks Basic Circuit as the target in `settings`'s Make search, as a person does. */
async function pickCircuit(page: Page, settings: Locator): Promise<void> {
  await settings.getByPlaceholder('Search items and fluids').fill('basic circuit');
  await page.getByRole('option', { name: /Basic Circuit/ }).click();
  await expect(settings.locator('.settings-target-name')).toHaveText('Basic Circuit');
}

// ledger ruling P2-R78: Clear goes with the target it clears, so before it does it hands the focus to the item search, the next thing to do
test('Clear hands the focus to the item search, from the keyboard and the pointer, beside the views', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Make cleared', LV_CIRCUITS);
  const settings = page.locator('aside[aria-label="Project settings"]');
  await expect(settings.locator('.settings-target-name')).toHaveText('Basic Circuit');
  await watchBodyFocus(page);
  await clearHandsOn(page, settings, 'keyboard');
  await pickCircuit(page, settings);
  await clearHandsOn(page, settings, 'pointer');
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

test('Clear hands the focus to the item search in the open drawer too, which stays open', async ({ page }) => {
  const dialogs = noDialogs(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Make cleared, narrow', LV_CIRCUITS);                          // a target: the drawer opens when asked
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  const settings = page.locator('aside[aria-label="Project settings"]');
  await expect(settings).toBeVisible();
  await watchBodyFocus(page);
  await clearHandsOn(page, settings, 'keyboard');
  await pickCircuit(page, settings);
  await clearHandsOn(page, settings, 'pointer');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});
