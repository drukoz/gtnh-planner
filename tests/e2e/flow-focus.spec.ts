// The flow diagram's import stubs, item ports and focus (fix spec §6.2), the seven cases of fix spec §7.1. Cases 1–6
// open a real project of the Mini-GT e2e server but serve a fixture plan in place of the server's (tests/e2e/fixtures/
// plans.ts), so each shows exactly the line it needs; case 7 plans on the server for real.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import { circuitLv, circuitMvPerHour, copperUnsourced, platesTwoWays } from './fixtures/plans.ts';
import { bodyFocusCount, createProject, login, setName, watchBodyFocus } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };

/** Opens a new project whose plan, every time the page asks for one, is `plan`; returns the project id. */
async function openWithPlan(page: Page, plan: Plan, settings: Partial<PlanSettings> = LV_CIRCUITS): Promise<string> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Flow focus', settings);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  return id;
}

/** Where a box is drawn on screen, and the zoom it is drawn at (its rect's width on screen over its width in the layout). */
async function boxOf(page: Page, nodeId: string): Promise<{ x: number; y: number; width: number; height: number; zoom: number }> {
  const rect = page.locator(`[data-node-id="${nodeId}"] > rect.flow-node-box`);
  const box = await rect.boundingBox();
  if (box === null) throw new Error(`${nodeId} is not drawn`);
  return { ...box, zoom: box.width / Number(await rect.getAttribute('width')) };
}

test('(1) an import sits right before the step that takes it', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const stub = await boxOf(page, 'import:t:copper_ingot@0@wire');
  const mill = await boxOf(page, 'wire');
  const gap = mill.x - (stub.x + stub.width);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap / mill.zoom).toBeLessThan(160);                         // at zoom 1
});

test('(2) hovering a good lights where it comes from and where it goes, and Esc clears it', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await page.getByRole('button', { name: 'Fit' }).click();
  const canvas = page.locator('svg.flow-canvas');
  await page.locator('[data-port$="|out|t:copper_wire@0"]').hover();
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await expect(page.locator('.flow-edge.hl')).toHaveCount(1);
  await expect(page.locator('[data-step-id="circuit-lv"]')).toHaveClass(/\bconsumer\b/);
  await expect(page.locator('[data-step-id="wire"]')).toHaveClass(/\bproducer\b/);
  await expect(page.locator('[data-step-id="bend-plate"]')).toHaveClass(/\bdim\b/);
  await expect(page.locator('[data-node-id="import:t:iron_ingot@0@bend-plate"]')).toHaveClass(/\bdim\b/);
  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveClass(/\bfocusing\b/);
  await expect(page.locator('.flow-edge.hl')).toHaveCount(0);
  await expect(page.locator('svg.flow-canvas .dim')).toHaveCount(0);
});

test('(3) Find item lights a good and centres the step that makes it', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/\bfocusing\b/);
  await expect(page.locator('[data-step-id="wire"]')).toHaveClass(/\bproducer\b/);
  const canvas = await page.locator('svg.flow-canvas').boundingBox();
  if (canvas === null) throw new Error('no canvas');
  const off = async (): Promise<number> => {
    const mill = await boxOf(page, 'wire');
    return Math.max(Math.abs(mill.x + mill.width / 2 - (canvas.x + canvas.width / 2)), Math.abs(mill.y + mill.height / 2 - (canvas.y + canvas.height / 2)));
  };
  await expect.poll(off).toBeLessThan(3);
});

test('(4) an input nothing supplies gets a red stub, and the banner says so', async ({ page }) => {
  await openWithPlan(page, copperUnsourced());
  await expect(page.locator('[data-node-id^="missing:t:copper_ingot@0@"]')).toHaveCount(1);
  await expect(page.locator('[data-node-id="missing:t:copper_ingot@0@wire"]')).toHaveAttribute('data-kind', 'missing');
  await expect(page.locator('.plan-banner')).toContainText('Nothing supplies Copper Ingot');
});

test('(5) a good made two ways says so, and Keep only pins the bigger maker', async ({ page }) => {
  const id = await openWithPlan(page, platesTwoWays());
  await expect(page.locator('.flow-issues')).toContainText('Iron Plate is made 2 ways');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/projects/${id}/ops`));
  await page.getByRole('button', { name: 'Keep only Basic Bending Machine' }).click();
  expect((await posted).postDataJSON()).toEqual({ ops: [{ op: 'settings', patch: { recipeChoice: { 't:iron_plate@0': 'bend-plate' } } }] });
  // The pin is in the settings at once, its plan not yet (here the fixture stays): the line says so, with no Keep only.
  await expect(page.locator('.flow-issues')).toContainText('Iron Plate is made 2 ways');
  await expect(page.locator('.flow-issues')).toContainText('Updating…');
  await expect(page.getByRole('button', { name: 'Keep only Basic Bending Machine' })).toHaveCount(0);
});

/** Makes the server plan project `id` again (a settings op that changes nothing): a plan event, and the page fetches its plan again. */
async function replan(page: Page, id: string): Promise<void> {
  const res = await page.request.post(`/api/projects/${id}/ops`, { data: { ops: [{ op: 'settings', patch: {} }] }, headers: { 'X-Planner-Name': 'e2e' } });
  expect(res.ok(), await res.text()).toBe(true);
}

// the final fix wave, FW-7(c): Keep only goes as its pin is set, so pressed from the keyboard it hands the focus to its own line's Show, which
// stays while the line says "Updating…"; and a replan that drops the line that holds the focus hands it to the first Show left, else to the
// diagram (ledger ruling P2-R112's order), never to the page's body
test('(5) Keep only from the keyboard gives the focus to its line\'s Show, and a replan that drops the line gives it on', async ({ page }) => {
  const plates = platesTwoWays();
  // the plates made two ways, and the wiremill's Copper Ingot from nowhere: two lines
  const both = {
    ...plates, flows: plates.flows.filter((f) => !(f.from === 'raw' && f.key === 't:copper_ingot@0')),
    rawInputs: plates.rawInputs.filter((r) => r.key !== 't:copper_ingot@0'),
  };
  let served = both;
  const id = await openWithPlan(page, both);
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: served }));
  const issues = page.locator('.flow-issues');
  const plateLine = issues.locator('li[data-issue="multi-producer"]');
  const copperLine = issues.locator('li[data-issue="orphan-input"]');
  await expect(issues.locator('li')).toHaveCount(2);
  await watchBodyFocus(page);
  await page.getByRole('button', { name: 'Keep only Basic Bending Machine' }).focus();
  await page.keyboard.press('Enter');
  await expect(plateLine).toContainText('Updating…');
  await expect(plateLine.getByRole('button', { name: 'Show' })).toBeFocused();
  // the plan of the pin makes the plates one way: their line goes, and the focus to the first Show left, the copper's
  served = copperUnsourced();
  await replan(page, id);
  await expect(plateLine).toHaveCount(0);
  await expect(copperLine.getByRole('button', { name: 'Show' })).toBeFocused();
  // and with nothing left to show, to the diagram
  served = circuitLv();
  await replan(page, id);
  await expect(issues).toHaveCount(0);
  await expect(page.locator('svg.flow-canvas')).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

// the final fix wave, FW-7(b): "Plan them as supporting lines" goes with the op it sends, and the chips beside it with the next plan, so pressed
// from the keyboard it hands the focus to the page's main first, never to the body
test('Plan them as supporting lines from the keyboard leaves the focus on the page\'s main', async ({ page }) => {
  const plan = circuitLv();
  const derived = {
    ...plan, rawInputs: plan.rawInputs.map((r) => (r.key === 't:redstone@0' ? { ...r, leafClass: 'derived' as const } : r)),
    warnings: [{ code: 'derived-leaf', key: 't:redstone@0', text: 'Redstone is not mined anywhere you can reach; the line buys it made.' }],
  };
  const id = await openWithPlan(page, derived, { ...LV_CIRCUITS, routeDerived: false });   // supporting lines off: the line buys them
  const button = page.getByRole('button', { name: 'Plan them as supporting lines' });
  await watchBodyFocus(page);
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/projects/${id}/ops`));
  await button.focus();
  await page.keyboard.press('Enter');
  expect((await posted).postDataJSON()).toEqual({ ops: [{ op: 'settings', patch: { routeDerived: true } }] });
  await expect(button).toHaveCount(0);
  await expect(page.locator('main')).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

test('(6) a line at 1 an hour never reads 0/h and gives fluids in litres', async ({ page }) => {
  await openWithPlan(page, circuitMvPerHour(), { target: 't:circuit@0', amount: 1, per: 'hour', tier: 2 });
  const canvas = page.locator('svg.flow-canvas');
  await expect(canvas).toContainText('Molten Iron 72 L/h');
  await expect(canvas).toContainText('1x Copper Wire 2/h');
  await expect(canvas).not.toContainText(/(?<![\d.,])0\/h/);
});

test('a good lit in one project is not lit in the next project opened', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const res = await page.context().request.post('/api/projects', { headers: { 'X-Planner-Name': 'e2e' }, data: { name: 'Second flow line', settings: LV_CIRCUITS } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/\bfocusing\b/);
  await page.getByRole('link', { name: 'Projects' }).click();                      // in-app navigation keeps the page's scripts
  await page.locator(`a.project-link[href="/p/${encodeURIComponent(id)}"]`).click();
  await page.getByRole('tab', { name: 'Flow' }).click();
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(3);
  await expect(page.locator('svg.flow-canvas')).not.toHaveClass(/\bfocusing\b/);
});

test('(7) Make it here instead on Iron Ingot says what changed: the new furnace step', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Make iron', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.locator('[data-node-id^="import:t:iron_ingot@0@"]').click();
  await page.getByRole('complementary', { name: 'Import: Iron Ingot' }).getByRole('button', { name: 'Make it here instead' }).click();
  const note = page.getByRole('status', { name: 'What changed' });
  await expect(note).toContainText('New steps');
  await expect(note).toContainText('Basic Electric Furnace (Iron Ingot)');
});
