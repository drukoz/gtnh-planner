// The landing page (RUK-510): the site's front page, open to anyone. It asks the server for nothing, so nothing sends the
// visitor to the login form; the header's logo is the link back to it, and the login form links back to it too.

import { test, expect } from '@playwright/test';
import { login, setName } from './helpers.ts';

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
