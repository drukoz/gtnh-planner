// The landing page (RUK-510): the site's front page, open to anyone. It asks the server for nothing, so nothing sends the
// visitor to the login form; the header's logo is the link back to it, and the login form links back to it too.

import { test, expect, type Page } from '@playwright/test';
import { createProject, E2E_PASSWORD, login, setName, sideways } from './helpers.ts';

const TITLE = { level: 1, name: 'GTNH Line Planner' } as const;

test('the landing page asks for no password and no request, and its way in and the logo go back and forth', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (req) => { if (new URL(req.url()).pathname.startsWith('/api/')) asked.push(req.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', TITLE)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/$/);                                                  // nothing sent it to the login form
  expect(asked).toEqual([]);
  // the header: the logo is the link home, and the pages are still Projects and World
  await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link')).toHaveText(['Projects', 'World']);
  await expect(page.getByRole('link', { name: 'GTNH Line Planner' })).toHaveAttribute('href', '/');

  await login(page); await setName(page, 'Ann');                                       // so no name prompt covers the list
  await page.getByRole('link', { name: 'Open the planner' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'GTNH Line Planner' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Open the planner' })).toBeVisible();
});

test('the login form links back to the landing page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Back to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Open the planner' })).toBeVisible();
});

// QA (RUK-510): the landing page's layout at both ends of the window sizes, its keyboard path, and the password a logged-out link
// to a project still asks for.

/** The left and top edges of each panel of the "What it does" grid, rounded to whole pixels. */
const panelEdges = (page: Page): Promise<{ left: number; top: number }[]> => page.locator('.landing-grid').first().locator(':scope > li')
  .evaluateAll((items) => items.map((li) => { const r = li.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; }));

test('at 390 px the landing page keeps everything inside the window, one panel to a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', TITLE)).toBeVisible();
  const { over, past } = await sideways(page);
  expect(over, past.join(', ')).toBeLessThanOrEqual(0);
  const edges = await panelEdges(page);
  expect(edges).toHaveLength(6);
  expect(new Set(edges.map((e) => e.left)).size).toBe(1);
});

test('at 1280 px the six panels of what it does sit three to a row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', TITLE)).toBeVisible();
  const tops = (await panelEdges(page)).map((e) => e.top);
  expect(tops).toHaveLength(6);
  expect(new Set(tops).size).toBe(2);
  expect(tops.filter((top) => top === tops[0])).toHaveLength(3);
});

test('the keyboard goes from the logo through the pages and the Theme button to the way in, with the yellow ring', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', TITLE)).toBeVisible();
  const reached: string[] = [];
  for (let tabs = 0; tabs < 5; tabs++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()));
  }
  expect(reached).toEqual(['GTNH Line Planner', 'Projects', 'World', 'Theme: Auto', 'Open the planner']);
  const way = page.getByRole('link', { name: 'Open the planner' });
  await expect(way).toBeFocused();
  expect(await way.evaluate((el) => { const s = getComputedStyle(el); return { color: s.outlineColor, width: s.outlineWidth }; }))
    .toEqual({ color: 'rgb(255, 255, 85)', width: '3px' });
});

test('a logged-out link to a project asks for the password, then opens that project', async ({ page }) => {
  await login(page);
  const id = await createProject(page, `Deep link ${test.info().repeatEachIndex + 1}`);    // one per run: the server is shared
  await page.context().clearCookies();                                                   // logged out again
  await page.goto(`/p/${id}#flow`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}#flow$`));
});
