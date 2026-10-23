// Keyboard focus is always visible (restyle plan Phase 1 Task 2, design spec §4 and §6): one 3 px yellow ring with no gap,
// on a button inside a light panel and on a link in the top bar. The ring touches the control's own dark border, which is
// what keeps it readable on the light grey.

import { test, expect, type Locator } from '@playwright/test';
import { login, setName } from './helpers.ts';

/** The focus ring of an element as the browser computes it. */
async function ring(element: Locator): Promise<{ color: string; width: string }> {
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.outlineColor, width: style.outlineWidth };
  });
}

const RING = { color: 'rgb(255, 255, 85)', width: '3px' };

test('the focus ring shows on panels and on the top bar', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await page.goto('/');

  // Create is disabled while the name is empty, and Tab skips a disabled button: give the project a name first
  await page.getByLabel('New project').fill('Focus line');
  const create = page.getByRole('button', { name: 'Create' });
  await expect(create).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  expect(await ring(create)).toEqual(RING);

  await page.reload();                                                                 // the focus is back at the page start
  const projects = page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Projects' });
  await expect(projects).toBeVisible();
  for (let tabs = 0; tabs < 10 && !(await projects.evaluate((el) => el === document.activeElement)); tabs++) await page.keyboard.press('Tab');
  await expect(projects).toBeFocused();
  expect(await ring(projects)).toEqual(RING);
});
