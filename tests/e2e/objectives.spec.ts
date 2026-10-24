// Planning modes (add-on 17 Task 9; design spec §3.3, architecture §11.45 (1), (5)): a new project plans for "Cheapest";
// the Compare card plans the three modes side by side, and "Use this mode" switches the project to one, which the
// card and Settings both show, for everyone.

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';

/** A compare plans the three modes on the server, within its time limit (20 s). */
const COMPARE_TIMEOUT_MS = 30_000;

test('compares the three planning modes and uses one', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Planning modes', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const settings = page.getByRole('complementary', { name: 'Project settings' });
  await expect(settings.getByRole('radio', { name: 'Cheapest', exact: true })).toBeChecked();
  await expect(settings.getByRole('combobox', { name: 'Count build cost against' })).toHaveValue('24');

  await page.getByRole('button', { name: 'Compare modes' }).click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  const columns = card.locator('[data-objective]');
  await expect(columns).toHaveCount(3, { timeout: COMPARE_TIMEOUT_MS });
  await expect(columns.locator('h4')).toHaveText(['Least raw material', 'Cheapest', 'Best multi-output']);
  for (const objective of ['least-raw', 'cheapest', 'multi-output']) {
    await expect(card.locator(`[data-objective="${objective}"]`)).toContainText('Raw per hour', { timeout: COMPARE_TIMEOUT_MS });
  }
  await expect(card.locator('[data-objective="cheapest"]').getByRole('button')).toHaveText('In use');

  const least = card.locator('[data-objective="least-raw"]');
  await least.getByRole('button', { name: 'Use this mode' }).click();
  // The replan's plan event fetches the compare again, which says the project plans least raw material now.
  await expect(least.getByRole('button')).toHaveText('In use', { timeout: COMPARE_TIMEOUT_MS });
  await expect(least.getByRole('button')).toBeDisabled();
  await expect(card.locator('[data-objective="cheapest"]').getByRole('button')).toHaveText('Use this mode');
  await expect(settings.getByRole('radio', { name: 'Least raw material', exact: true })).toBeChecked();
  await expect(settings.getByRole('combobox', { name: 'Count build cost against' })).toHaveCount(0);
});

// The Machine GUI restyle moved the card's button into the project head, so a closed card takes no room under the banner (the chrome's
// height budget, which layout.spec.ts's press on the map canvas needs): the button opens and closes the card, which opens under the plan
// banner in the banners' box (inert with it while the settings drawer is open), and the card's Close gives the focus back to the button.
test('opens the Compare card from the project head, adds nothing while closed, and gives the focus back on Close', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Head button', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const head = page.locator('.project-head');
  const toggle = head.getByRole('button', { name: 'Compare modes' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'compare-card');
  await expect(page.locator('.compare-card')).toHaveCount(0);
  // a small button in a head that keeps its 36px
  expect((await toggle.boundingBox())!.height).toBe(28);
  expect((await head.boundingBox())!.height).toBe(36);

  await toggle.click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('id', 'compare-card');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // the last of the banners' box: under the plan's cost and banner
  expect(await card.evaluate((el) => el.parentElement?.classList.contains('project-banners') === true && el.parentElement.lastElementChild === el)).toBe(true);

  await card.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  // the head's button closes it as well
  await toggle.click();
  await expect(card).toBeVisible();
  await toggle.click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
});

// Below 900 px the head's one row is full: the Settings button says what the line makes there (the Make picker fix), and the head must
// stay one row on a tablet. So on a narrow window the Compare modes button is in a bar of its own under the banner, and the head's is not
// drawn; it opens the same card, whose Close gives the focus back to it. The project has a target, so the drawer does not open by itself.
test('on a narrow window the Compare modes button sits in a bar under the banner, and the head stays one row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Narrow compare', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  await expect(page.locator('svg [data-step-id]').first()).toBeVisible();          // the plan is in: the drawer would have opened by now
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Compare modes' });
  await expect(toggle).toHaveCount(1);                                               // the head's is not drawn here
  await expect(page.locator('.project-head .compare-toggle')).toBeHidden();
  expect(await toggle.evaluate((el) => el.parentElement?.classList.contains('compare-bar') === true && el.closest('.project-banners') !== null)).toBe(true);
  // measured once the stream is live (as "reconnecting…" the badge is wider, and the head wraps earlier) and the fonts are in (main's F3)
  await expect(page.locator('.connection.live')).toBeVisible();
  const head = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.querySelector('.project-head')!.getBoundingClientRect().height;
  });
  expect(head, 'the head is one row').toBe(36);

  await toggle.click();
  const card = page.getByRole('region', { name: 'Compare modes' });
  await expect(card).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // wide again, the head's button is the one drawn, and the bar is gone
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.project-head').getByRole('button', { name: 'Compare modes' })).toBeVisible();
  await expect(page.locator('.compare-bar')).toBeHidden();
});

// A target's card never shows another's figures (the review of the merge, C1): clearing the target closes the card and forgets what it
// showed, so when the next target's card opens it says it is planning until its own compare comes.
test('clearing the target closes the Compare card and forgets its figures, so the next target\'s card never shows them', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'New target', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const settings = page.getByRole('complementary', { name: 'Project settings' });
  const toggle = page.getByRole('button', { name: 'Compare modes' });
  const card = page.getByRole('region', { name: 'Compare modes' });
  const steps = card.locator('[data-objective="cheapest"] .compare-row', { hasText: 'Steps' }).locator('dd');
  await toggle.click();
  await expect(steps).toHaveText('3', { timeout: COMPARE_TIMEOUT_MS });              // Basic Circuit: three steps

  // Clear: nothing to compare, so no card and no button
  await settings.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.compare-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare modes' })).toHaveCount(0);

  // another target: the button is back, closed, and there is still no card
  await settings.getByPlaceholder('Search items and fluids').fill('iron plate');
  await page.getByRole('option', { name: /Iron Plate/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.compare-card')).toHaveCount(0);

  // opened, with its compare held back on the way: the card says it is planning and shows no column, none of Basic Circuit's figures
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/projects\/[^/]+\/compare$/, async (route) => {
    await held;
    await route.continue();
  });
  const asked = page.waitForRequest(/\/api\/projects\/[^/]+\/compare$/);
  await toggle.click();
  await asked;
  await expect(card.locator('[data-objective]')).toHaveCount(0);
  await expect(card.getByText('Planning the three modes…')).toBeVisible();
  release();
  await expect(steps).toHaveText('1', { timeout: COMPARE_TIMEOUT_MS });              // Iron Plate: one step
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// A figure is never split across lines (the review of the merge, C4): where three columns leave a tile little room, its tiles stack in
// one column, and each value stays on one line inside its tile. A crafted compare answer gives long figures: 11 glyphs, 7 and 9.
for (const [width, height] of [[860, 900], [768, 1024]] as const) {
  test(`keeps each figure of the Compare card on one line inside its tile at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page); await setName(page, 'Ann');
    await createProject(page, `Figures at ${width}`, { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
    const summary = { rawPerHour: 0.000000123, rawBuild: 131072, newMachines: 12, rawSources: 7, steps: 23, peakEUt: 2097152 };
    const answer = { rev: 1, current: 'cheapest', modes: ['least-raw', 'cheapest', 'multi-output'].map((objective) => ({ objective, status: 'ok', summary })) };
    await page.route(/\/api\/projects\/[^/]+\/compare$/, (route) => route.fulfill({ json: answer }));
    await page.getByRole('button', { name: 'Compare modes' }).click();
    const card = page.getByRole('region', { name: 'Compare modes' });
    await expect(card.locator('[data-objective="multi-output"] dd').last()).toHaveText('2,097,152');
    const figures = await card.locator('.compare-row').evaluateAll(async (rows) => {
      await document.fonts.ready;
      return rows.map((row) => {
        const dd = row.querySelector('dd')!;
        const text = document.createRange();
        text.selectNodeContents(dd);
        const tile = row.getBoundingClientRect(), drawn = text.getBoundingClientRect();
        return {
          value: dd.textContent ?? '', lines: text.getClientRects().length, inside: drawn.left >= tile.left && drawn.right <= tile.right,
          clipped: dd.scrollWidth > dd.clientWidth,
        };
      });
    });
    expect(figures).toHaveLength(18);
    for (const figure of figures) expect(figure, figure.value).toMatchObject({ lines: 1, inside: true, clipped: false });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}

// Another target picked straight from the item search, without Clear (the review of the merge, T1): the open card drops the old target's
// figures at once and says it is planning until the new target's compare comes.
test('picking another target while the Compare card is open drops the old figures and plans the new ones', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Swap target', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const settings = page.getByRole('complementary', { name: 'Project settings' });
  const card = page.getByRole('region', { name: 'Compare modes' });
  const steps = card.locator('[data-objective="cheapest"] .compare-row', { hasText: 'Steps' }).locator('dd');
  await page.getByRole('button', { name: 'Compare modes' }).click();
  await expect(steps).toHaveText('3', { timeout: COMPARE_TIMEOUT_MS });              // Basic Circuit: three steps

  // the next compare held back on its way, Iron Plate picked in the item search with no Clear: the card stays open, with no column
  // and its planning line, none of Basic Circuit's figures
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/projects\/[^/]+\/compare$/, async (route) => {
    await held;
    await route.continue();
  });
  await settings.getByPlaceholder('Search items and fluids').fill('iron plate');
  await settings.getByRole('listbox', { name: 'Matches' }).getByRole('option', { name: /Iron Plate/ }).click();   // not the flow's Find item list
  await expect(settings.locator('.settings-target-name')).toHaveText('Iron Plate');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-objective]')).toHaveCount(0);
  await expect(card.getByText('Planning the three modes…')).toBeVisible();
  release();
  await expect(steps).toHaveText('1', { timeout: COMPARE_TIMEOUT_MS });              // Iron Plate: one step
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
