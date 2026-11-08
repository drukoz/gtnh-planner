// The Flow chart's re-planning badge, QAed end to end (RUK-823, over RUK-821 and RUK-822): after a change that replans, the chart stays up dimmed
// under a badge that says what it waits for, and the toast says when the plan is in. The checks here are the badge after a pick in the recipe
// popup, in the normal view and in Full view, a change made outside the popup in the settings column, the chart under the badge still taking
// clicks, the badge's words in forced colours, and its colours in each look. The plan is a fixture served in place of the server's and its fetch is
// held to stand for the seconds the server takes, the way recipe-browser.spec.ts's last two tests do. QA_SHOTS=1 writes a picture of the badge in
// each of those under .paperclip-runtime/qa/ for the reviewer.

import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, LV_CIRCUITS, setName, setTheme } from './helpers.ts';

const WIRE = 't:copper_wire@0';

// reduced motion, so no glide is caught half way and the seconds the badge counts are the only motion left
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

/** A picture of the badge over the chart for the reviewer, when asked for. */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.QA_SHOTS !== '1') return;
  await page.waitForTimeout(800);   // the picture is taken of a settled page, not of a drag half way
  await page.locator('.flow-stage').screenshot({ path: `.paperclip-runtime/qa/${name}.png` });
}

/** The LV circuit line, its wiremill offering its own recipe and a slower one of the same map (recipe-browser.spec.ts). */
function twoWiremillRecipes(): Plan {
  const plan = circuitLv();
  const ways: PlanStep['alternatives'] = [
    { recipeId: 'wire', rawCost: 0.5, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 1 }], outputs: [{ key: WIRE, amount: 2 }] },
    { recipeId: 'wire-slow', rawCost: 1, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 2 }], outputs: [{ key: WIRE, amount: 2 }] },
  ];
  return { ...plan, steps: plan.steps.map((s) => (s.id === 'wire' ? { ...s, alternatives: ways } : s)) };
}

/**
 * Opens a new project whose plan is `plan`, fits the diagram, and holds every later fetch of its plan until the returned function is called:
 * the page stands the held fetch in for the seconds the server takes to plan a line (recipe-browser.spec.ts's last two tests).
 */
async function openHeld(page: Page, plan: Plan): Promise<() => void> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Re-plan QA', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  await page.getByRole('button', { name: 'Fit' }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/projects/*/plan', async (route) => { await held; await route.fulfill({ json: plan }); });
  return () => release();
}

/** Picks the wiremill's slower recipe in the R popup; resolves once the op is sent, so the badge is up. */
async function pickSlowerWire(page: Page): Promise<void> {
  await page.locator(`[data-port$="|out|${WIRE}"]`).hover();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-recipe-id="wire-slow"]').getByRole('button', { name: 'Use this recipe' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const badge = (page: Page): Locator => page.locator('.flow-wait');
const badgeWords = (page: Page): Locator => page.locator('.flow-wait-text');
const stage = (page: Page): Locator => page.locator('.flow-stage');

/** The stage as the badge's dimming shows it: the badge's own colours, and the canvas's opacity under it. */
const dimming = (page: Page): Promise<{ badge: string; canvas: string }> => page.evaluate(() => {
  const wait = document.querySelector('.flow-wait');
  const canvas = document.querySelector('svg.flow-canvas');
  return {
    badge: wait === null ? '' : getComputedStyle(wait).backgroundColor,
    canvas: canvas === null ? '' : getComputedStyle(canvas).opacity,
  };
});

/**
 * The badge's words and its second count against the back they are painted on: the badge's own back, with what shows through it (the chart's
 * well) composited under it, so the ratio is what the eye sees. WCAG's ratio, so a reviewer can read the number.
 */
const readability = (page: Page): Promise<{ back: string; words: number; count: number }> => page.evaluate(() => {
  const chan = (s: string): [number, number, number, number] => {
    const n = (s.match(/[\d.]+/g) ?? []).map(Number);
    return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n.length > 3 ? n[3] ?? 1 : 1];
  };
  const over = (fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] =>
    [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
  const lum = (c: [number, number, number]): number => {
    const [r, g, b] = c.map((v) => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const ratio = (a: [number, number, number], b: [number, number, number]): number => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const style = (sel: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(sel)!);
  const well = chan(style('svg.flow-canvas').backgroundColor);
  const back = chan(style('.flow-wait').backgroundColor);
  const on = over(back, [well[0], well[1], well[2]]);
  return {
    back: `rgb(${on.map((v) => Math.round(v)).join(', ')})`,
    words: ratio(over(chan(style('.flow-wait-text').color), on), on),
    count: ratio(over(chan(style('.flow-wait-time').color), on), on),
  };
});

/**
 * Pans the chart, by drags of the canvas as a user makes them, until `target`'s centre sits under the badge's centre, so a click on it is a
 * click through the badge. Any press on the canvas starts a pan, so the drag may start on a card; the endpoint stays inside the canvas.
 */
async function panUnderBadge(page: Page, target: Locator): Promise<void> {
  const limit = 400;   // a drag's most in one direction, so its endpoint stays well inside the 1440 × 900 window's canvas
  for (let at = 0; at < 12; at++) {
    const area = (await page.locator('svg.flow-canvas').boundingBox())!;
    const over = (await badge(page).boundingBox())!;
    const box = (await target.boundingBox())!;
    const cut = (v: number): number => Math.round(Math.max(-limit, Math.min(limit, v)));
    const dx = cut(over.x + over.width / 2 - (box.x + box.width / 2));
    const dy = cut(over.y + over.height / 2 - (box.y + box.height / 2));
    if (dx === 0 && dy === 0) return;
    // start where the drag can end inside the canvas: at the near edge when it goes with the axis, at the far edge when against it
    const from: [number, number] = [dx > 0 ? area.x + 12 : area.x + area.width - 12 + dx, dy > 0 ? area.y + 12 : area.y + area.height - 12 + dy];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 6 });
    await page.mouse.up();
  }
}

test('a pick in the popup puts the badge over the chart, and its plan brings the toast in its place', async ({ page }) => {
  const release = await openHeld(page, twoWiremillRecipes());
  await pickSlowerWire(page);
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toBeInViewport();
  await expect(badgeWords(page)).toHaveText('Re-planning with your choice for 1x Copper Wire…');
  await expect(stage(page)).toHaveAttribute('aria-busy', 'true');
  expect(await dimming(page), 'the chart is dimmed under a badge of its own colours').toMatchObject({ canvas: '0.55' });
  await expect(badge(page).locator('.flow-wait-time')).toHaveText(/^\d+ s$/, { timeout: 5000 });   // counts from 2 s on
  await shot(page, '1-badge-normal-view');
  release();
  await expect(badge(page)).toBeHidden();
  await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('Plan updated with your choice for 1x Copper Wire')).toBeVisible();
});

test('in Full view, where the banners are hidden, the badge is over the chart too, and its plan takes it away', async ({ page }) => {
  const release = await openHeld(page, twoWiremillRecipes());
  await page.getByRole('button', { name: 'Full view' }).click();
  await expect(page.locator('.project-banners')).toBeHidden();
  await pickSlowerWire(page);
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toBeInViewport();
  await expect(badgeWords(page)).toHaveText('Re-planning with your choice for 1x Copper Wire…');
  await shot(page, '2-badge-full-view');
  release();
  await expect(badge(page)).toBeHidden();
  await expect(page.getByText('Plan updated with your choice for 1x Copper Wire')).toBeVisible();
});

test('a change made outside the popup, in the settings column, says "Re-planning…", and its plan brings no choice toast', async ({ page }) => {
  const release = await openHeld(page, twoWiremillRecipes());
  const amount = page.getByRole('complementary', { name: 'Project settings' }).getByLabel('Amount', { exact: true });
  await expect(amount).toHaveValue('30');
  await amount.fill('31');   // the field sends it once typing pauses
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toBeInViewport();
  await expect(badgeWords(page)).toHaveText('Re-planning…');
  await expect(stage(page)).toHaveAttribute('aria-busy', 'true');
  await shot(page, '3-badge-settings-change');
  release();
  await expect(badge(page)).toBeHidden();
  await expect(page.getByText('Plan updated with your choice')).toHaveCount(0);
});

test('the badge takes no pointer events: the card head it covers still opens its panel', async ({ page }) => {
  const release = await openHeld(page, twoWiremillRecipes());
  await pickSlowerWire(page);
  await expect(badge(page)).toBeVisible();
  const head = page.locator('[data-step-id="wire"] .flow-node-head');
  await panUnderBadge(page, head);
  const over = (await badge(page).boundingBox())!;
  const box = (await head.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(
    centre.x > over.x && centre.x < over.x + over.width && centre.y > over.y && centre.y < over.y + over.height,
    'the premise: the badge covers the head the click goes through',
  ).toBe(true);
  expect(await badge(page).evaluate((el) => getComputedStyle(el).pointerEvents), 'the badge takes no pointer').toBe('none');
  await head.click();
  await expect(page.getByRole('complementary', { name: 'Step: Basic Wiremill' })).toBeVisible();
  await expect(badge(page)).toBeVisible();   // the panel opens while the plan is still on its way
  release();
  await expect(badge(page)).toBeHidden();
});

test('the badge keeps its words in forced colours', async ({ page }) => {
  const release = await openHeld(page, twoWiremillRecipes());
  await page.emulateMedia({ forcedColors: 'active' });
  await pickSlowerWire(page);
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);
  await expect(badge(page)).toBeVisible();
  await expect(badgeWords(page)).toBeVisible();
  await expect(badgeWords(page)).toHaveText('Re-planning with your choice for 1x Copper Wire…');
  const words = (await badgeWords(page).boundingBox())!;
  expect(words.width, 'the words are printed, not collapsed to nothing').toBeGreaterThan(80);
  expect(words.height, 'the words keep a line of their own').toBeGreaterThan(10);
  await shot(page, '4-badge-forced-colors');
  release();
  await expect(badge(page)).toBeHidden();
});

test('the badge reads well in the light look and in the dark one', async ({ page }) => {
  for (const look of ['light', 'dark'] as const) {
    await setTheme(page, look);
    const release = await openHeld(page, twoWiremillRecipes());
    await pickSlowerWire(page);
    await expect(badge(page)).toBeVisible();
    await expect(badgeWords(page)).toHaveText('Re-planning with your choice for 1x Copper Wire…');
    await expect(badge(page).locator('.flow-wait-time')).toHaveText(/^\d+ s$/, { timeout: 5000 });   // the count, so its colours are read too
    const paint = await dimming(page);
    expect(paint.canvas, 'the chart under the badge is dimmed').toBe('0.55');
    expect(paint.badge, `the badge keeps a filled back of its own in the ${look} look`).not.toBe('rgba(0, 0, 0, 0)');
    const ink = await readability(page);
    expect(ink.words, `the words against ${ink.back} in the ${look} look`).toBeGreaterThanOrEqual(4.5);
    expect(ink.count, `the second count against ${ink.back} in the ${look} look`).toBeGreaterThanOrEqual(4.5);
    await shot(page, `5-badge-${look}-look`);
    release();
    await expect(badge(page)).toBeHidden();
  }
});
