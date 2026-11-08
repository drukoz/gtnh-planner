// RUK-810: the Flow canvas is the window's height less its chrome, at a 320 px floor, whatever its diagram's height is (CSS alone, no hold).

import { test, expect, type Page } from '@playwright/test';
import type { PlanSettings } from '../../src/shared/types/plan.ts';
import { createProject, login, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };

const canvasCssHeight = (page: Page): Promise<string> =>
  page.locator('svg.flow-canvas').evaluate((svg) => getComputedStyle(svg as SVGSVGElement).height);

test.use({ viewport: { width: 1440, height: 900 } });

test('the canvas is the window\'s height less its chrome, and its floor at a short window', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Flow height', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).not.toHaveCount(0);
  expect(await canvasCssHeight(page), '900 px of window less 140 px of chrome').toBe('760px');
  await page.setViewportSize({ width: 1440, height: 400 });
  expect(await canvasCssHeight(page), 'the floor at a 400 px window').toBe('320px');
});
