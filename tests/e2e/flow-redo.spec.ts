// The Flow chart redo (RUK-740), one test per numbered check of the redo's acceptance: left-overs in a band along the bottom, imports all in
// the first column, boxes headed "Input" and "Output", the X/Y rate kept on every row, material names cut at 14 letters with the machine's kept
// whole, and the NEI popup (R on a made good, on a bought one, on nothing, U, and the panels' "Browse recipes"). The plan is a fixture served
// in place of the server's (`page.route`); the pack's stuff entries come from a routed mock, so the popup's lists are the test's own.
// QA_SHOTS=1 writes a picture of each check under .paperclip-runtime/qa/ for the reviewer.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanFlow, PlanSettings, PlanStep, RawInput } from '../../src/shared/types/plan.ts';
import type { RecipeSummary, StuffInfo } from '../../src/shared/types/api.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };
const WIRE = 't:copper_wire@0';
const RED = 't:redstone@0';
const RED_NAME = 'Refined Redstone Dust';
const STUB_RED = `import:${RED}@circuit-lv`;

/** A picture of the page for the reviewer, when asked for. */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.QA_SHOTS === '1') await page.screenshot({ path: `.paperclip-runtime/qa/${name}.png`, fullPage: true });
}

const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });

/**
 * The LV circuit line with everything the redo's checks need: the wiremill knows two ways to make its wire (the popup pins),
 * the wiremill leaves wire over (the bottom band), the redstone is bought and named longer than 14 letters (the cut), and
 * the bending machine's long machine name stands in its box head (kept whole).
 */
function redoPlan(): Plan {
  const plan = circuitLv();
  const ways: PlanStep['alternatives'] = [
    { recipeId: 'wire', rawCost: 0.5, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 1 }], outputs: [{ key: WIRE, amount: 2 }] },
    { recipeId: 'wire-slow', rawCost: 1, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 2 }], outputs: [{ key: WIRE, amount: 2 }] },
  ];
  return {
    ...plan,
    names: { ...plan.names, [RED]: RED_NAME },
    steps: plan.steps.map((s) => (s.id === 'wire' ? { ...s, alternatives: ways } : s)),
    flows: [...plan.flows, flow('wire', 'sink', WIRE, 0.25)],
    rawInputs: plan.rawInputs.map((r): RawInput => (r.key === RED ? { ...r, leafClass: 'derived', cost: 2 } : r)),
  };
}

const summary = (id: string, machine: string, inputs: Array<[string, string]>, outputs: Array<[string, string]>): RecipeSummary => ({
  id, source: 'gt', maps: ['gt.recipe.assembler'], machineName: machine, tier: 1, euPerTick: 16, durationTicks: 100,
  inputs: inputs.map(([key, name]) => ({ key, name, amount: 1, consumed: true })),
  outputs: outputs.map(([key, name]) => ({ key, name, amount: 1, chance: 1 })),
});
const assemblerCard = summary('circuit-r', 'Assembler', [[WIRE, '1x Copper Wire'], ['t:iron_plate@0', 'Iron Plate'], [RED, 'Redstone']], [['t:circuit@0', 'Basic Circuit']]);

/** The pack's stuff entries the popup fetches for the goods it has no plan list for. */
const PACK: Record<string, StuffInfo> = {
  [WIRE]: { key: WIRE, name: '1x Copper Wire', producers: [], consumers: [assemblerCard] },
  [RED]: {
    key: RED, name: 'Redstone',
    producers: [summary('redstone-r', 'Chemical Recipe', [['t:copper_ingot@0', 'Copper Ingot']], [[RED, 'Redstone']])],
    consumers: [assemblerCard],
  },
};

/** Opens a new project whose plan is `redoPlan()` and whose pack stuff comes from `PACK`; returns the project id. */
async function openWithPlan(page: Page): Promise<string> {
  const plan = redoPlan();
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await page.route('**/api/pack/stuff/**', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/stuff/')[1] ?? '');
    const info = PACK[key];
    return info === undefined ? route.fallback() : route.fulfill({ json: info });
  });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Flow redo', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  await page.getByRole('button', { name: 'Fit' }).click();
  return id;
}

/** The settings patch of the next ops request the page posts. */
function nextPatch(page: Page, id: string): Promise<Partial<PlanSettings>> {
  return page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/projects/${id}/ops`))
    .then((r) => (r.postDataJSON() as { ops: Array<{ patch: Partial<PlanSettings> }> }).ops[0]!.patch);
}

test('check 1: left-overs sit in one band along the bottom, joined by a pipe to the step that made them', async ({ page }) => {
  await openWithPlan(page);
  const band = page.locator('[data-left-over]');
  await expect(band).toBeVisible();
  await expect(band.getByText('Left over: not used in this line')).toBeVisible();
  const sink = page.locator('[data-node-id^="sink:"]');
  await expect(sink).toHaveCount(1);
  await expect(sink).toContainText('1x Copper Wire');
  const bandBox = await band.boundingBox();
  expect(bandBox).not.toBeNull();
  for (const stepId of ['wire', 'bend-plate', 'circuit-lv']) {
    const b = await page.locator(`[data-step-id="${stepId}"]`).boundingBox();
    expect(b).not.toBeNull();
    expect(bandBox!.y).toBeGreaterThan(b!.y + b!.height);
  }
  const s = await sink.boundingBox();
  expect(s).not.toBeNull();
  expect(s!.y).toBeGreaterThanOrEqual(bandBox!.y);
  expect(s!.y + s!.height).toBeLessThanOrEqual(bandBox!.y + bandBox!.height);
  await expect(page.locator('[data-edge-id*="sink:"]')).toHaveCount(1);
  await shot(page, '1-left-over');
});

test('check 2: every import stands in the first column, and no Imports-in-one-column control is left', async ({ page }) => {
  await openWithPlan(page);
  const stubs = page.locator('[data-node-id^="import:"]');
  await expect(stubs).toHaveCount(3);
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let i = 0; i < 3; i++) {
    const b = (await stubs.nth(i).boundingBox())!;
    lefts.push(b.x);
    rights.push(b.x + b.width);
  }
  expect(Math.max(...lefts)).toBeLessThan(Math.min(...rights)); // the boxes share one column's band, stacked
  for (const stepId of ['wire', 'bend-plate', 'circuit-lv']) {
    const b = await page.locator(`[data-step-id="${stepId}"]`).boundingBox();
    expect(b!.x).toBeGreaterThan(Math.max(...rights)); // the stubs stand in the first column, left of every step
  }
  await expect(page.getByText('Imports in one column')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /import/i })).toHaveCount(0);
  await shot(page, '2-imports');
});

test('check 3: step cards are headed Input and Output, inputs left and outputs right', async ({ page }) => {
  await openWithPlan(page);
  const box = page.locator('[data-step-id="circuit-lv"]');
  await expect(box.locator('text.flow-io-head')).toHaveCount(2);
  await expect(box.getByText('Input')).toBeVisible();
  await expect(box.getByText('Output')).toBeVisible();
  const b = await box.boundingBox();
  expect(b).not.toBeNull();
  const middle = b!.x + b!.width / 2;
  const ins = box.locator('.flow-row.in');
  await expect(ins).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const r = await ins.nth(i).boundingBox();
    expect(r!.x + r!.width / 2).toBeLessThan(middle);
  }
  const outRow = box.locator('.flow-row.out');
  await expect(outRow).toHaveCount(1);
  const o = await outRow.boundingBox();
  expect(o!.x + o!.width / 2).toBeGreaterThan(middle);
  await shot(page, '3-io-head');
});

test('check 4: every good keeps its X/Y rate on its tile', async ({ page }) => {
  await openWithPlan(page);
  const rates = page.locator('svg.flow-canvas .flow-tile-rate, svg.flow-canvas .flow-row-rate');
  await expect(rates.filter({ hasText: '60/min' }).first()).toBeVisible(); // the wire the wiremill makes, one a second
  await expect(rates.filter({ hasText: '30/min' }).first()).toBeVisible(); // the mined goods, half a second each
  await expect(rates.filter({ hasText: '15/min' }).first()).toBeVisible(); // the left-over wire, a quarter a second
  await shot(page, '4-rates');
});

test('check 5: a material name over 14 letters is cut to 13 and an ellipsis, and a machine name is kept whole', async ({ page }) => {
  await openWithPlan(page);
  const row = page.locator(`[data-step-id="circuit-lv"] .flow-row.in[data-key="${RED}"]`);
  await expect(row.locator('.flow-tile-name')).toContainText('Refined Redst…');
  await expect(row).toHaveAttribute('aria-label', `takes ${RED_NAME} 30/min: show where it comes from`);
  await expect(page.locator(`[data-node-id="${STUB_RED}"]`)).toContainText('Refined Redst…');
  await expect(page.locator('[data-step-id="bend-plate"]')).toContainText('Basic Bending Machine');
  await shot(page, '5-truncation');
});

test('check 6a: R on a made good lists the recipes that make it, and Use this recipe pins one', async ({ page }) => {
  const id = await openWithPlan(page);
  await page.locator(`[data-port$="|out|${WIRE}"]`).first().hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  await expect(dialog).toBeVisible();
  const card = dialog.locator('[data-recipe-id="wire"]');
  await expect(card).toContainText('Wiremill');
  await expect(card.locator('[aria-label="Takes per run"] [data-recipe-key="t:copper_ingot@0"]')).toBeVisible();
  await expect(card.locator('[aria-label="Makes per run"] [data-recipe-key="t:copper_wire@0"]')).toBeVisible();
  await expect(card.getByLabel(/Copper Ingot/).first()).toBeVisible();
  await expect(card).toContainText('in use');
  await shot(page, '6a-recipes');
  const patch = nextPatch(page, id);
  await dialog.locator('[data-recipe-id="wire-slow"]').getByRole('button', { name: 'Use this recipe' }).click();
  expect((await patch).recipeChoice).toEqual({ [WIRE]: 'wire-slow' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('check 6b: U on a made good lists what uses it, read only', async ({ page }) => {
  await openWithPlan(page);
  await page.locator(`[data-port$="|out|${WIRE}"]`).first().hover();
  await page.keyboard.press('u');
  const dialog = page.getByRole('dialog', { name: 'Uses of 1x Copper Wire' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('What uses 1x Copper Wire')).toBeVisible();
  const usedIn = dialog.locator('[data-recipe-id="circuit-r"]');
  await expect(usedIn.locator('[aria-label="Takes per run"] [data-recipe-key="t:copper_wire@0"]')).toBeVisible();
  await expect(usedIn.locator('[aria-label="Makes per run"] [data-recipe-key="t:circuit@0"]')).toBeVisible();
  await expect(usedIn.getByLabel(/Basic Circuit/).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use this recipe' })).toHaveCount(0);
  await shot(page, '6b-uses');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('check 6c: R on a bought good offers Make it with this recipe, which expands and pins it', async ({ page }) => {
  const id = await openWithPlan(page);
  await page.locator(`[data-node-id="${STUB_RED}"]`).hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for Redstone' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`The line buys Redstone. Make it with one of these recipes instead:`)).toBeVisible();
  await shot(page, '6c-bought');
  const patch = nextPatch(page, id);
  await dialog.locator('[data-recipe-id="redstone-r"]').getByRole('button', { name: 'Make it with this recipe' }).click();
  const sent = await patch;
  expect(sent.expandItems).toContain(RED);
  expect(sent.recipeChoice).toEqual({ [RED]: 'redstone-r' });
  expect(sent.stopItems ?? []).not.toContain(RED);
});

test('check 6d: R with nothing pointed at says to point at a material first, and opens nothing', async ({ page }) => {
  await openWithPlan(page);
  await page.mouse.move(1, 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.getByText('Hover or click a material first')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await shot(page, '6d-nothing');
});

test('check 6e: the popup lets the planner choose again and import the good instead', async ({ page }) => {
  const id = await openWithPlan(page);
  await page.locator(`[data-port$="|out|${WIRE}"]`).first().hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  const letting = nextPatch(page, id);
  await dialog.getByRole('button', { name: 'Let the planner choose' }).click();
  expect((await letting).recipeChoice).toEqual({});
  await page.locator(`[data-port$="|out|${WIRE}"]`).first().hover();
  await page.keyboard.press('r');
  const importing = nextPatch(page, id);
  await page.getByRole('dialog').getByRole('button', { name: 'Import it instead' }).click();
  expect((await importing).stopItems).toContain(WIRE);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await shot(page, '6e-list-buttons');
});

test('check 6f: a step panel and an import panel Browse recipes open the popup, and Close gives the focus back', async ({ page }) => {
  await openWithPlan(page);
  await page.locator('[data-step-id="wire"] .flow-node-head').click();
  const stepPanel = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  const browseStep = stepPanel.getByRole('button', { name: 'Browse recipes' });
  await browseStep.click();
  await expect(page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(browseStep).toBeFocused();
  await page.locator(`[data-node-id="${STUB_RED}"] .flow-node-head`).click();
  const importPanel = page.getByRole('complementary', { name: `Import: ${RED_NAME}` });
  const browseImport = importPanel.getByRole('button', { name: 'Browse recipes' });
  await browseImport.click();
  await expect(page.getByRole('dialog', { name: 'Recipes for Redstone' })).toBeVisible();
  await shot(page, '6f-browse');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(browseImport).toBeFocused();
});
