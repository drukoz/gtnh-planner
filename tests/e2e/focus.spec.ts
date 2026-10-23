// Keyboard focus is always visible (restyle plan Phase 1 Task 2, design spec §4 and §6): one 3 px ring with no gap. On a
// button inside a light panel and on a link in the top bar it is yellow: the ring touches the control's own dark border or
// sits on the dark page, which is what keeps it readable. A link inside a light panel has no dark border of its own, so
// there the ring is near black (the panel's focus ink, ruling R12).

import { test, expect, type Locator } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

/** The focus ring of an element as the browser computes it. */
async function ring(element: Locator): Promise<{ color: string; width: string }> {
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.outlineColor, width: style.outlineWidth };
  });
}

const RING = { color: 'rgb(255, 255, 85)', width: '3px' };
const PANEL_LINK_RING = { color: 'rgb(27, 27, 27)', width: '3px' };

test('the focus ring shows on panels and on the top bar', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const project = `Focus link ${test.info().repeatEachIndex + 1}`;                     // one per run: the server is shared
  await createProject(page, project);
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

  // a link inside a light panel, the project's name in its card: entered by the keyboard, since the list is as long as the
  // other tests make it (they share the server), by stepping off the link and back onto it
  const link = page.getByRole('link', { name: project, exact: true });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  expect(await ring(link)).toEqual(PANEL_LINK_RING);
});
