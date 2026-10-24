// One look whatever the OS theme (restyle plan Phase 1 Task 1, design spec §4): the stylesheet has no dark-mode rules and
// the page says `color-scheme: dark`, so a browser set to light and one set to dark paint the same stone page and the same
// light-grey panels.

import { test, expect } from '@playwright/test';
import { login, setName } from './helpers.ts';

test('looks the same whatever the OS theme', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme });
    try {
      const page = await context.newPage();
      await login(page); await setName(page, 'Ann');
      await page.goto('/');
      await expect(page.locator('form.new-project')).toBeVisible();
      const paint = await page.evaluate(() => {
        const form = document.querySelector('form.new-project');
        return {
          page: getComputedStyle(document.body).backgroundColor,
          panel: form === null ? null : getComputedStyle(form).backgroundColor,
        };
      });
      expect(paint, `with the OS set to ${colorScheme}`).toEqual({ page: 'rgb(43, 43, 43)', panel: 'rgb(198, 198, 198)' });
    } finally {
      await context.close();
    }
  }
});
