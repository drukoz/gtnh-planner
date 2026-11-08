// The recipe browser (RUK-740): in the Flow tab, R opens the recipes that make the good under the pointer and U what uses it, as NEI's keys do;
// a card's "Use this recipe" pins it and closes the popup. The project is a real one of the Mini-GT e2e server, its plan a fixture
// (tests/e2e/fixtures/plans.ts) whose wiremill knows two ways to make the wire.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanSettings, PlanStep } from '../../src/shared/types/plan.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };
const WIRE = 't:copper_wire@0';

/** The LV circuit line, its wiremill offering its own recipe and a slower one of the same map. */
function twoWiremillRecipes(): Plan {
  const plan = circuitLv();
  const ways: PlanStep['alternatives'] = [
    { recipeId: 'wire', rawCost: 0.5, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 1 }], outputs: [{ key: WIRE, amount: 2 }] },
    { recipeId: 'wire-slow', rawCost: 1, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 2 }], outputs: [{ key: WIRE, amount: 2 }] },
  ];
  return { ...plan, steps: plan.steps.map((s) => (s.id === 'wire' ? { ...s, alternatives: ways } : s)) };
}

/** Opens a new project whose plan, every time the page asks for one, is `plan`; returns the project id. */
async function openWithPlan(page: Page, plan: Plan): Promise<string> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Recipe browser', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  await page.getByRole('button', { name: 'Fit' }).click();
  return id;
}

test('R on a good shows the recipes that make it, U what uses it, and Escape closes the popup', async ({ page }) => {
  await openWithPlan(page, twoWiremillRecipes());
  await page.locator(`[data-port$="|out|${WIRE}"]`).hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-recipe-id]')).toHaveCount(2);
  await expect(dialog.locator('[data-recipe-id="wire"]')).toContainText('in use');
  await page.keyboard.press('u');
  await expect(page.getByRole('dialog', { name: 'Uses of 1x Copper Wire' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("a card's Use this recipe pins its recipe for the good and closes the popup", async ({ page }) => {
  const id = await openWithPlan(page, twoWiremillRecipes());
  await page.locator(`[data-port$="|out|${WIRE}"]`).hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/projects/${id}/ops`));
  await dialog.locator('[data-recipe-id="wire-slow"]').getByRole('button', { name: 'Use this recipe' }).click();
  const body = (await posted).postDataJSON() as { ops: Array<{ op: string; patch: Partial<PlanSettings> }> };
  expect(body.ops).toHaveLength(1);
  expect(body.ops[0]!.op).toBe('settings');
  expect(body.ops[0]!.patch.recipeChoice).toEqual({ [WIRE]: 'wire-slow' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('R with nothing under the pointer says to point at a material, and opens nothing', async ({ page }) => {
  await openWithPlan(page, twoWiremillRecipes());
  await page.mouse.move(1, 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.getByText('Point at a material first')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("a step panel's Browse recipes opens the popup on its product, and Close gives the focus back to the button", async ({ page }) => {
  await openWithPlan(page, twoWiremillRecipes());
  await page.locator('[data-step-id="wire"] .flow-node-head').click();
  const panel = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(panel).toBeVisible();
  const browse = panel.getByRole('button', { name: 'Browse recipes' });
  await browse.click();
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(browse).toBeFocused();
});
