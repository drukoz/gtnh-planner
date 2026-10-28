// Two looks and a switch (Phase 2 spec §4, D2): Auto, the default, puts no data-theme on <html>, so the stylesheet follows the OS by
// itself; the Theme button goes round Auto, Dark and Light, and a chosen look outranks the OS. The head script of index.html puts a stored
// look on the page before any app code runs. The dark tour reads computed colours of the built page in the dark look, so the minifier can
// merge or drop no dark rule unseen (spec §4.13, the lesson of ruling R28): one test per stop, each in a fresh dark context, logged in and
// named, so no stop's route leaks into the next. Each later task adds its rows and its stops.

import { test, expect, type Page, type Route } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, LV_CIRCUITS, openWithPlan, setName, setTheme } from './helpers.ts';

/** The stone of the page as the browser paints it. */
const stone = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const LIGHT = { page: 'rgb(43, 43, 43)', panel: 'rgb(198, 198, 198)' };
const DARK = { page: 'rgb(20, 20, 20)', panel: 'rgb(42, 42, 42)' };

test('Auto follows the OS: today\'s look in a light OS, the dark look in a dark one', async ({ browser }) => {
  for (const [colorScheme, look] of [['light', LIGHT], ['dark', DARK]] as const) {
    const context = await browser.newContext({ colorScheme });
    try {
      const page = await context.newPage();
      await login(page); await setName(page, 'Ann');
      await page.goto('/');
      await expect(page.locator('form.new-project')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Theme: Auto' })).toBeVisible();
      const paint = await page.evaluate(() => {
        const form = document.querySelector('form.new-project');
        return {
          page: getComputedStyle(document.body).backgroundColor,
          panel: form === null ? null : getComputedStyle(form).backgroundColor,
        };
      });
      expect(paint, `with the OS set to ${colorScheme}`).toEqual(look);
    } finally {
      await context.close();
    }
  }
});

test('the Theme button cycles Auto, Dark and Light, and the choice outranks the OS', async ({ browser }) => {
  const light = await browser.newContext({ colorScheme: 'light' });
  try {
    const page = await light.newPage();
    await login(page); await setName(page, 'Ann');
    await page.goto('/');
    await page.getByRole('button', { name: 'Theme: Auto' }).click();
    // the page cross-fades into the new look (a View Transition), so the colours are polled for
    await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
    await expect.poll(() => stone(page)).toBe(DARK.page);
    // the choice is this browser's: a reload keeps it
    await page.reload();
    await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
    await expect.poll(() => stone(page)).toBe(DARK.page);
    await page.getByRole('button', { name: 'Theme: Dark' }).click();
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
    await expect.poll(() => stone(page)).toBe(LIGHT.page);
  } finally {
    await light.close();
  }
  // a chosen Light in a dark OS
  const dark = await browser.newContext({ colorScheme: 'dark' });
  try {
    const page = await dark.newPage();
    await setTheme(page, 'light');
    await login(page); await setName(page, 'Ann');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
    await expect.poll(() => stone(page)).toBe(LIGHT.page);
  } finally {
    await dark.close();
  }
});

test('a chosen look is on the page before any app code runs', async ({ page }) => {
  await setTheme(page, 'dark');
  await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  await login(page);
  await page.goto('/');
  // no script of the app ran: the stylesheet and the head script alone paint the dark stone
  await expect.poll(() => stone(page)).toBe(DARK.page);
  expect(await page.locator('#root').evaluate((el) => el.childElementCount)).toBe(0);
});

/** One computed value the built page must give in the dark look: `getComputedStyle(el, pseudo)[property]` of the first `selector`. */
interface DarkRow { what: string; selector: string; property: string; expected: string; pseudo?: string }
/** A screen of the dark tour: how to open it, the rows it reads, and how to let go of what `open` held (a held request). */
interface DarkStop { name: string; open(page: Page): Promise<void>; rows: DarkRow[]; close?(page: Page): Promise<void> }

/**
 * The compare the Compare card's stop holds: the server plans the three modes on its main thread, for up to 20 s, and a compare nothing
 * waits for would only slow the tests beside it. Its `close` lets go of it.
 */
const heldCompares: Route[] = [];
/** The plans the skeleton's stop holds (Task 8): a page whose plan never comes shows its skeletons; its `close` lets go of them. */
const heldPlans: Route[] = [];

/** The dark tour (spec §4.11, §4.12): each later task appends its rows and stops. */
const DARK_TOUR: DarkStop[] = [
  {
    name: 'the project list',
    open: async (page) => { await page.goto('/'); },
    rows: [{ what: 'the top bar', selector: '.top-nav', property: 'background-color', expected: 'rgb(11, 11, 11)' }],
  },
  {
    name: 'the Flow tab',
    open: async (page) => { await openWithPlan(page, circuitLv()); },
    rows: [
      { what: 'an unselected tab', selector: ".tabs [role='tab'][aria-selected='false']", property: 'background-color', expected: 'rgb(31, 31, 31)' },
      { what: 'a new box', selector: '[data-node-id="wire"] > rect.flow-node-box', property: 'fill', expected: 'rgb(48, 48, 48)' },
      // a hint of Plan for: the dark --text-muted, through the panel's ink group
      { what: 'a hint of Plan for', selector: '.settings-section p.choice-hint', property: 'color', expected: 'rgb(168, 168, 168)' },
      // Task 4: a step box's chip, the dark screen's #0b0b0b through --flow-chip (spec §7.5)
      { what: 'a chip', selector: '[data-step-id="wire"] .flow-chip rect', property: 'fill', expected: 'rgb(11, 11, 11)' },
      // Task 7: a key-numbers tile, the dark screen's #0b0b0b (spec §10.2, §4.11)
      { what: 'a key-numbers tile', selector: '.key-number', property: 'background-color', expected: 'rgb(11, 11, 11)' },
      // the final fix wave: the selected tab's label in the accent (ledger ruling P2-R129), and the page's scroll bars, which every scrolling
      // box inherits, the slider's #7a7a7a thumb on the screen's #0b0b0b (P2-R128)
      { what: 'the selected tab\'s label', selector: ".tabs [role='tab'][aria-selected='true']", property: 'color', expected: 'rgb(255, 255, 85)' },
      { what: 'the scroll bars', selector: 'html', property: 'scrollbar-color', expected: 'rgb(122, 122, 122) rgb(11, 11, 11)' },
    ],
  },
  // the base's surfaces (plan ruling base-surfaces-dark): they read the tokens, so the dark blocks reach them with no rule of their own
  {
    name: 'the Compare card and a farm\'s fields',
    open: async (page) => {
      await openWithPlan(page, circuitLv());
      await page.route(/\/api\/projects\/[^/]+\/compare$/, (route) => { heldCompares.push(route); });
      await page.getByRole('complementary', { name: 'Project settings' }).getByRole('checkbox', { name: 'Tree Growth Simulator', exact: true }).check();
      await page.locator('.project-head').getByRole('button', { name: 'Compare modes' }).click();
    },
    // no row waits for the compare itself: the card is drawn at once, planning the three modes
    rows: [
      { what: 'the Compare card', selector: '.compare-card', property: 'background-color', expected: 'rgb(42, 42, 42)' },
      { what: 'its title', selector: '.compare-head > h3', property: 'color', expected: 'rgb(255, 255, 255)' },
      { what: 'the line a farm\'s fields hang on', selector: '.farm-fields', property: 'border-left-color', expected: 'rgb(13, 13, 13)' },
    ],
    close: async () => {
      for (const route of heldCompares.splice(0)) await route.abort().catch(() => { /* the page has gone */ });
    },
  },
  {
    name: 'the narrow head and the drawer that opens by itself',
    open: async (page) => {
      await page.setViewportSize({ width: 800, height: 900 });
      await createProject(page, 'Dark drawer');                                         // no target: the drawer opens by itself
      await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
    },
    rows: [
      { what: 'the Settings button\'s readout', selector: '.settings-toggle-target', property: 'background-color', expected: 'rgb(11, 11, 11)' },
      { what: 'its words', selector: '.settings-toggle-target', property: 'color', expected: 'rgb(168, 168, 168)' },
      // below 900 px the drawer is the stone, --page
      { what: 'the drawer', selector: 'aside.settings-panel', property: 'background-color', expected: 'rgb(20, 20, 20)' },
    ],
  },
  {
    name: 'the Compare modes bar on a narrow window',
    open: async (page) => {
      await page.setViewportSize({ width: 800, height: 900 });
      await createProject(page, 'Dark bar', LV_CIRCUITS);                                // a target: the bar is drawn, the drawer stays shut
    },
    rows: [{ what: 'the bar\'s Compare modes button', selector: '.compare-bar .compare-toggle', property: 'background-color', expected: 'rgb(60, 60, 60)' }],
  },
  // Task 3a: the shared NEI tooltip is the same box in both looks (spec §6.3)
  {
    name: 'an item\'s tip',
    open: async (page) => {
      await createProject(page, 'Dark tip', LV_CIRCUITS);
      await page.getByRole('tab', { name: 'Materials & steps' }).click();
      await page.locator('li.mat-row .item-icon').first().hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
    },
    rows: [{ what: 'the shared tooltip', selector: '.nei-tooltip', property: 'background-color', expected: 'rgba(16, 0, 16, 0.94)' }],
  },
  // Task 5a: the step panel's recipe card, its recess the dark panel's #2a2a2a and a readout tile the dark screen's #0b0b0b (spec §8.4)
  {
    name: 'a step\'s panel',
    open: async (page) => {
      await openWithPlan(page, circuitLv());
      await page.locator('[data-step-id="circuit-lv"] .flow-node-head').click();
      await expect(page.getByRole('complementary', { name: 'Step: Basic Assembler' })).toBeVisible();
    },
    rows: [
      { what: 'the recipe strip', selector: '.recipe-strip', property: 'background-color', expected: 'rgb(42, 42, 42)' },
      { what: 'a readout', selector: '.readout', property: 'background-color', expected: 'rgb(11, 11, 11)' },
    ],
  },
  // Task 6a: the inventory grid, its slots' recess the dark panel's #2a2a2a (not a slot's icon: an e2e icon is a placeholder painted
  // inline), the pressed Grid on the dark --btn-lo and the meter a dark screen (spec §9.3)
  {
    name: 'the inventory grid',
    open: async (page) => {
      await createProject(page, 'Dark grid', LV_CIRCUITS);
      await page.getByRole('tab', { name: 'Materials & steps' }).click();
      await page.locator('section[aria-labelledby="to-build-title"]').getByRole('button', { name: 'Grid', exact: true }).click();
      await expect(page.locator('button.mat-slot').first()).toBeVisible();
    },
    rows: [
      { what: 'the slots\' recess', selector: '.mat-slots', property: 'background-color', expected: 'rgb(42, 42, 42)' },
      { what: 'the pressed Grid', selector: ".mat-view-toggle button[aria-pressed='true']", property: 'background-color', expected: 'rgb(30, 30, 30)' },
      { what: 'the meter', selector: '.mat-meter', property: 'background-color', expected: 'rgb(11, 11, 11)' },
    ],
  },
  // Task 8: a page whose plan never comes, its Flow skeleton set into the dark well (#1a1a1a), its blocks the dark --skeleton-well (spec §11.2),
  // and the strip's place in the tiles' dark face
  {
    name: 'a plan on its way',
    open: async (page) => {
      await page.route('**/api/projects/*/plan', (route) => { heldPlans.push(route); });
      await createProject(page, 'Dark skeleton', LV_CIRCUITS);
      await expect(page.locator('.tab-panel .skeleton-diagram')).toBeVisible();
    },
    rows: [
      { what: 'the diagram\'s skeleton', selector: '.skeleton-diagram', property: 'background-color', expected: 'rgb(26, 26, 26)' },
      { what: 'its blocks', selector: '.skeleton-diagram .skeleton-block', property: 'background-color', expected: 'rgb(42, 42, 42)' },
      // ledger ruling P2-R53: the strip's place in the tiles' own dark screen, #0b0b0b
      { what: 'the strip\'s skeleton', selector: '.key-numbers-wait .skeleton-block', property: 'background-color', expected: 'rgb(11, 11, 11)' },
    ],
    close: async () => {
      for (const route of heldPlans.splice(0)) await route.abort().catch(() => { /* the page has gone */ });
    },
  },
  // Task 9a: a toast is a chat box, the same in both looks (spec §12.3): a rename's, read while it shows
  {
    name: 'a toast',
    open: async (page) => {
      await createProject(page, 'Dark toast');
      const field = page.getByRole('textbox', { name: 'Project name' });
      await field.fill('Dark toast renamed');
      await field.press('Enter');
      await expect(page.locator('.toast')).toBeVisible();
    },
    rows: [{ what: 'a toast', selector: '.toast', property: 'background-color', expected: 'rgba(0, 0, 0, 0.82)' }],
  },
  // Task 10: the in-app confirm is a chat box, the same in both looks (spec §13.2): a token's Revoke, read while it asks
  {
    name: 'a confirm',
    open: async (page) => {
      await createProject(page, 'Dark confirm');
      await page.getByText('In-game projector').click();
      await page.getByLabel('Who is it for?').fill('Steve');
      await page.getByRole('button', { name: 'Create token' }).click();
      await page.getByRole('button', { name: 'Revoke' }).click();
      await expect(page.locator('.inline-confirm')).toBeVisible();
    },
    rows: [{ what: 'a confirm', selector: '.inline-confirm', property: 'background-color', expected: 'rgba(0, 0, 0, 0.82)' }],
  },
  // Task 11: the keyboard shortcuts' sheet is a modal on the dark panel's #2a2a2a, its key caps the dark button face's #3c3c3c (spec §14.1)
  {
    name: 'the shortcuts sheet',
    open: async (page) => {
      await openWithPlan(page, circuitLv());
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
    rows: [
      { what: 'the sheet', selector: '.shortcuts-sheet', property: 'background-color', expected: 'rgb(42, 42, 42)' },
      { what: 'a key cap', selector: '.shortcut-list kbd', property: 'background-color', expected: 'rgb(60, 60, 60)' },
    ],
  },
];

// a fresh context per test, in a dark OS
test.describe(() => {
  test.use({ colorScheme: 'dark' });

  for (const stop of DARK_TOUR) {
    test(`the dark tour: ${stop.name}`, async ({ page }) => {
      await login(page); await setName(page, 'Ann');
      try {
        await stop.open(page);
        for (const row of stop.rows) {
          const target = page.locator(row.selector).first();
          await expect.poll(
            () => target.evaluate((el, [property, pseudo]) => getComputedStyle(el, pseudo).getPropertyValue(property), [row.property, row.pseudo ?? null] as const),
            `${row.what}: ${row.selector}${row.pseudo ?? ''} { ${row.property} }`,
          ).toBe(row.expected);
        }
      } finally {
        await stop.close?.(page);
      }
    });
  }

  test('the dark tour: the login card', async ({ page }) => {
    await page.goto('/login');                                                           // logged out
    const card = page.locator('.login');
    await expect(card).toBeVisible();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(DARK.panel);
  });
});
