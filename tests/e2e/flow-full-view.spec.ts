// Full view (RUK-813): the Flow tab's Full view button hides the project banners so the canvas fills the window, and
// Hide planner gives the chart the settings column's width. Both choices are kept per browser (localStorage), and the
// head draws neither button below 901 px, where the planner is a drawer.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };

/** Opens a new project on its Flow tab, its plan the served LV-circuits fixture; returns the id. */
async function openFlow(page: Page): Promise<string> {
  const plan: Plan = circuitLv();
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Full view', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  return id;
}

/** The canvas box on the open page. */
const canvasBox = (page: Page): Promise<{ width: number; height: number } | null> =>
  page.locator('svg.flow-canvas').boundingBox();

test('Full view hides the banners, the canvas fills the window, and the choice is kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFlow(page);
  await page.getByRole('button', { name: 'Full view' }).click();
  await expect(page.locator('.project-banners')).toBeHidden();
  await expect(page.locator('main.project-page')).toHaveClass(/flow-full/);
  const full = await canvasBox(page);
  expect(full!.height).toBeGreaterThan(450); // the chart keeps a window-filling share, not a banner's castoff
  // the window holds the page: no scroll, and the legend's last line shows
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('ul.flow-legend')!.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  // a reload keeps it (the choice lives in this browser's storage)
  await page.reload();
  await expect(page.locator('main.project-page')).toHaveClass(/flow-full/);
  await expect(page.getByRole('button', { name: 'Exit full view' })).toBeVisible();
  // and leaving it comes back
  await page.getByRole('button', { name: 'Exit full view' }).click();
  await expect(page.locator('.project-banners')).toBeVisible();
  await expect(page.locator('main.project-page')).not.toHaveClass(/flow-full/);
});

test('Hide planner gives the canvas the settings column, kept across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFlow(page);
  await page.getByRole('button', { name: 'Full view' }).click();
  const plain = await canvasBox(page);
  await page.getByRole('button', { name: 'Hide planner' }).click();
  await expect(page.locator('.settings-panel')).toBeHidden();
  const wide = await canvasBox(page);
  expect(wide!.width).toBeGreaterThan(plain!.width);
  await page.reload();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  await expect(page.locator('.settings-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show planner' })).toBeVisible();
});

test('the Full view button belongs to the Flow tab, and Full view applies there only', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFlow(page);
  await page.getByRole('button', { name: 'Full view' }).click();
  await expect(page.locator('.project-banners')).toBeHidden();
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByRole('button', { name: 'Exit full view' })).toHaveCount(0);
  await expect(page.locator('.project-banners')).toBeVisible();
  await expect(page.locator('main.project-page')).not.toHaveClass(/flow-full/);
  await page.getByRole('tab', { name: 'Flow' }).click();
  await expect(page.locator('main.project-page')).toHaveClass(/flow-full/);
  await expect(page.locator('.project-banners')).toBeHidden();
});

test('below 901 px the head draws neither button', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openFlow(page);
  await expect(page.getByRole('button', { name: 'Full view' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hide planner' })).toBeHidden();
});
