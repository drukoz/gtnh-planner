// The settings column is a drawer on a narrow screen (restyle plan Phase 1 Task 4, design spec §7a): the Settings button of the
// project head slides it in over a dimmed page, Escape or a click on the page behind closes it, and Escape gives the focus back
// to the button. A wide screen keeps the column beside the views and never shows the button. The drawer is a layer of its own
// (ruling R36): opening it moves the focus to its Close settings button, the page behind is inert while it is open, every way out
// gives the focus back to the Settings button, and a window that grows past 900 px closes it. The Settings button says what the line
// makes ("Settings · Make: nothing yet"), so it is found by a name that starts with Settings: "Close settings" does not.
//
// The most important setting, what to make, is in the drawer, so a project with no target opens it by itself, once, with the focus in the
// item search, and the banner's "Pick something to make" is a way back in (the last block of this file). The tests that start with the
// drawer closed give their project a target, which keeps it from opening.
//
// The banners are inert behind the open drawer, so their status is not announced there: the drawer has a status line of its own (Phase 2
// spec §17 R43, the last three tests), visually hidden, which counts the plan's problems, says when there are none, and is empty once the
// drawer is closed.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { circuitLv, copperUnsourced } from './fixtures/plans.ts';
import { bodyFocusCount, login, setName, createProject, holdReplan, LV_CIRCUITS, openWithPlan, watchBodyFocus } from './helpers.ts';

/** What the page behind the drawer is made of: inert while the drawer is open. */
const BEHIND = ['.top-nav', '.project-head', '.project-banners', '.project-views'];

/** The Settings button: its name is "Settings" and then what the line makes, and "Close settings" does not start with it. */
const SETTINGS_BUTTON = /^Settings/;

/** A target the e2e pack plans. A project without one opens the drawer by itself on a narrow screen, so a test that starts with it closed gives its project this. */
const TARGET = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 } as const;

/** Where the keyboard's focus is: in the drawer, nowhere (the end of the page, past which Tab goes round), or the element it escaped to. */
function focusIsIn(page: Page): Promise<string> {
  return page.evaluate(() => {
    const at = document.activeElement;
    if (at === null || at === document.body) return 'nowhere';
    if (at.closest('aside[aria-label="Project settings"]') !== null) return 'the drawer';
    return at.outerHTML.slice(0, 120);
  });
}

test('narrow screens open the settings as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drawer', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });

  // closed: the column is slid out of sight, and out of the tab order with it
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await toggle.click();
  await expect(settings).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Escape closes it from inside, and the focus goes back to the button (a click focuses a button too, so the focus starts in the drawer)
  await settings.getByPlaceholder('Search items and fluids').focus();
  await expect(settings.getByPlaceholder('Search items and fluids')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // the dimmed page behind the drawer closes it too, and gives the focus back to the button as well
  await toggle.click();
  await expect(settings).toBeVisible();
  await page.locator('.drawer-backdrop').click();
  await expect(settings).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('the keyboard opens the drawer into it, goes round its controls only, and leaves it on the Settings button', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Keys', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  const close = settings.getByRole('button', { name: 'Close settings' });
  // the button names the drawer it opens
  await expect(toggle).toHaveAttribute('aria-controls', 'project-settings');
  await expect(settings).toHaveAttribute('id', 'project-settings');

  // Tab from the top of the page to the Settings button, and Enter: the drawer opens with the focus on its Close button, in view
  for (let tabs = 0; tabs < 10 && !(await toggle.evaluate((el) => el === document.activeElement)); tabs++) await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(settings).toBeVisible();
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  // the page behind it is inert: nothing there takes the focus or a click while the drawer is open
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).toHaveAttribute('inert', '');

  // Tab goes round the drawer's own controls only: from Close through every one, past the end of the page, and back to Close
  let tabs = 0;
  do {
    await page.keyboard.press('Tab');
    tabs++;
    const at = await focusIsIn(page);
    expect(['the drawer', 'nowhere'], `Tab ${tabs} took the focus to ${at}`).toContain(at);
  } while (tabs < 300 && !(await close.evaluate((el) => el === document.activeElement)));
  await expect(close).toBeFocused();
  expect(tabs, 'the drawer has controls of its own to go round').toBeGreaterThan(5);
  // and Shift+Tab goes round the other way, from Close to the drawer's last control
  await page.keyboard.press('Shift+Tab');
  if ((await focusIsIn(page)) === 'nowhere') await page.keyboard.press('Shift+Tab');
  expect(await focusIsIn(page)).toBe('the drawer');
  await expect(close).not.toBeFocused();

  // Escape closes it, the focus goes back to the Settings button and the page is live again
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');

  // its Close button closes it the same way
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();

  // and so does a click on the dimmed page behind it
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused();
  await page.locator('.drawer-backdrop').click();
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('the drawer slides out faster than it slides in', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Exit', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const motion = (): Promise<{ duration: string; easing: string }> => settings.evaluate((el) => {
    const style = getComputedStyle(el);
    return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
  });
  // closed, its transition is the one a closing drawer slides out with: the exit's 180ms, easing in (then it hides at once)
  expect(await motion()).toEqual({ duration: '0.18s, 0s', easing: 'cubic-bezier(0.4, 0, 1, 1), ease' });
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  await expect(settings).toBeVisible();
  // open, the one it slid in with: 260ms, easing out
  expect(await motion()).toEqual({ duration: '0.26s', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
});

test('a window that grows past 900 px closes the drawer, and leaves the page live', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Resize', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.setViewportSize({ width: 1280, height: 720 });
  // the button is not drawn on a wide window, so it is found by its class: it says the drawer is closed
  await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-expanded', 'false');
  // R46 (plan ruling aside-refocus): the toggle's click put the focus on Close settings, which the column beside the views does not draw, so
  // the column itself takes it: it is not lost to the page's body
  await expect(settings).toBeFocused();
  expect(await focusIsIn(page)).toBe('the drawer');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');
  await expect(settings).toBeVisible();                                                // the column beside the views again
  // narrow once more, the drawer is closed: the state did not wait for a narrow window to show itself
  await watchBodyFocus(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(settings).toBeHidden();
  // the final fix wave, FW-8 (ledger ruling P2-R133): the column that had the focus is a closed drawer now, so the focus went to the Settings
  // button, which shows again, and never to the page's body
  await expect(page.getByRole('button', { name: SETTINGS_BUTTON })).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

// FW-8 (ledger ruling P2-R133): a window narrowed to 900 px or less no longer draws the head's Shortcuts and Compare modes buttons; one that had
// the focus hands it on as it goes, Shortcuts to the Settings button and Compare modes to its twin in the bar under the banner, never to the
// body. A laptop window snapped to half its screen (683 to 720 px) narrows so
test('narrowing past 900 px moves a focus on the head\'s Shortcuts to the Settings button, and on Compare modes to the bar\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Narrowed head', TARGET);
  const head = page.locator('.project-head');
  const name = page.getByRole('textbox', { name: 'Project name' });
  await watchBodyFocus(page);
  await head.getByRole('button', { name: 'Shortcuts', exact: true }).focus();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByRole('button', { name: SETTINGS_BUTTON })).toBeFocused();
  await name.focus();                                                                     // drawn at both widths
  await page.setViewportSize({ width: 1280, height: 720 });
  await head.getByRole('button', { name: 'Compare modes' }).focus();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('.compare-bar').getByRole('button', { name: 'Compare modes' })).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

test('Escape closes one layer per press: an open search list first, then the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Layers', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  await expect(settings).toBeVisible();

  // a list open in the drawer: typing shows it, and the first Escape is the list's, not the drawer's
  await settings.getByPlaceholder('Search items and fluids').fill('Iron Ingot');
  const matches = settings.getByRole('listbox', { name: 'Matches' });
  await expect(matches).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(matches).toBeHidden();
  // the drawer is still open: its button says so at once, and its backdrop is still there (a drawer that was closing would be
  // drawn for the 180ms of its slide, so the button and the backdrop are what to look at)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  await expect(settings).toBeVisible();

  // nothing is open in it now, so the next Escape closes the drawer and the focus goes back to the button
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

// ledger ruling P2-R139, P2-R133's mirror: a window that widens past 900 px no longer draws the Settings button nor the bar's Compare modes; one
// that had the focus hands it on as it goes, the Settings button to the project's name and the bar's Compare modes to the head's, never to the
// body
test('widening past 900 px moves a focus on the Settings button to the name, and on the bar\'s Compare modes to the head\'s', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Widened head', TARGET);
  const name = page.getByRole('textbox', { name: 'Project name' });
  await watchBodyFocus(page);
  await page.getByRole('button', { name: SETTINGS_BUTTON }).focus();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(name).toBeFocused();
  await page.setViewportSize({ width: 700, height: 900 });                               // the name is drawn at both widths
  await expect(name).toBeFocused();
  await page.locator('.compare-bar').getByRole('button', { name: 'Compare modes' }).focus();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.project-head').getByRole('button', { name: 'Compare modes' })).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

// the final fix wave, FW-9: a draft in the drawer is a layer of its own, as an open list is: Escape in the Amount takes the draft back and leaves
// the drawer open (the field takes the key, and the focus stays in it); with nothing to take back, the next Escape closes the drawer. So is an
// item search that shows only that nothing matches (ledger ruling P2-R138): its list is closed, so the drawer looks for its note, which Escape
// closes, the field cleared by the browser; the next Escape closes the drawer
test('Escape takes back a draft in the drawer, or closes a search\'s note, before it closes the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drafts in the drawer', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  const open = async (): Promise<void> => {
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  };
  await toggle.click();
  await expect(settings).toBeVisible();
  const amount = settings.getByLabel('Amount', { exact: true });
  await amount.fill('2x');                                                                // a draft the field refuses, so nothing sends it
  await page.keyboard.press('Escape');
  await expect(amount).toHaveValue('30');
  await expect(amount).toBeFocused();
  await open();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  // the search that matches nothing (P2-R138)
  await toggle.click();
  await open();
  const search = settings.getByPlaceholder('Search items and fluids');
  await search.fill('nothing is called this');
  const note = settings.getByText('No item or fluid matches');
  await expect(note).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await open();
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

/** Project `id`'s settings on the server. */
async function settingsOf(page: Page, id: string): Promise<{ amount: number; costOverrides: Record<string, number>; farms?: { crops?: { stats?: Record<string, number> } } }> {
  return ((await (await page.request.get(`/api/projects/${id}`)).json()) as { settings: never }).settings;
}

// Ledger ruling P2-R141 (the residue of FW-9): a settings draft takes Escape only while it differs from what the field would show without it.
// The Amount kept its draft after a commit (Enter, or its 500 ms timer), equal to the amount the store then shows, so the first Escape after it
// was taken for nothing and the drawer stayed open. Each draft field, the Amount, a cost and a crop seed's stat: a committed value, then Escape,
// closes the drawer; a draft equal to what is shown, the same; a draft that differs is taken back, the drawer staying open, and the next
// Escape closes the drawer
test('Escape after a committed Amount closes the drawer, and a draft that differs is taken back first (P2-R141)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Committed amount', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  const amount = settings.getByLabel('Amount', { exact: true });
  const reopen = async (): Promise<void> => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  };
  await reopen();
  await amount.fill('45');
  await amount.press('Enter');                                                            // committed: the store shows 45 at once
  await expect(amount).toHaveValue('45');
  await page.keyboard.press('Escape');
  await expect(toggle, 'nothing to take back: the drawer\'s Escape').toHaveAttribute('aria-expanded', 'false');
  await reopen();
  await amount.fill('46');                                                                // committed by its timer
  await expect.poll(async () => (await settingsOf(page, id)).amount).toBe(46);
  await expect(amount).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle, 'the timer\'s commit too').toHaveAttribute('aria-expanded', 'false');
  await reopen();
  await amount.fill('2x');                                                                // a draft that differs (and that nothing sends)
  await page.keyboard.press('Escape');
  await expect(amount).toHaveValue('46');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('Escape after a committed cost or crop seed stat, or a draft equal to it, closes the drawer; one that differs is taken back first (P2-R141)', async ({ page }) => {
  // the crop seed's stats are drawn while the pack has a crop table, which the e2e pack lacks: the page is told it has one (the server checks
  // the farm settings for their shape alone, so the stats are sent and stored as for a pack that has)
  await page.route('**/api/pack', async (route) => {
    const res = await route.fetch();
    const info = (await res.json()) as { manifest?: { counts?: Record<string, number> } };
    return route.fulfill({ response: res, json: { ...info, manifest: { ...info.manifest, counts: { ...info.manifest?.counts, crops: 179 } } } });
  });
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Committed cost and stat', { ...TARGET, costOverrides: { 't:iron_ingot@0': 2 } });
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  const reopen = async (): Promise<void> => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  };
  await reopen();
  await settings.getByRole('checkbox', { name: 'CropsNH Crop Manager' }).check();
  const fields = [
    { field: settings.getByLabel('Cost of Iron Ingot'), stored: async () => (await settingsOf(page, id)).costOverrides['t:iron_ingot@0'] },
    { field: settings.getByLabel('Growth', { exact: true }), stored: async () => (await settingsOf(page, id)).farms?.crops?.stats?.growth },
  ];
  for (const { field, stored } of fields) {
    await field.fill('3');
    await field.press('Enter');
    await expect.poll(stored, 'committed').toBe(3);
    await page.keyboard.press('Escape');
    await expect(toggle, 'nothing to take back after a commit: the drawer\'s Escape').toHaveAttribute('aria-expanded', 'false');
    await reopen();
    await field.fill('5');
    await field.fill('3');                                                                // a draft, typed, equal to what the field shows
    await page.keyboard.press('Escape');
    await expect(toggle, 'nothing to take back: the drawer\'s Escape').toHaveAttribute('aria-expanded', 'false');
    await reopen();
    await field.fill('7');                                                                // a draft that differs
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('3');
    await expect(toggle, 'the draft\'s Escape').toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await reopen();
  }
});

// the final fix wave's R2 (P2-R138 kept to its note): an item search that shows an error is no layer of its own, as Escape does not take its note
// away: the drawer closes on the first Escape
test('an item search showing an error is no layer: the first Escape closes the drawer', async ({ page }) => {
  await page.route('**/api/pack/search?**', (route) => route.fulfill({ status: 500, json: { error: 'search-failed', message: 'The search failed' } }));
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Search error', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await settings.getByPlaceholder('Search items and fluids').fill('iron');
  await expect(settings.getByText('The search failed')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('the avoid box\'s list, and a key something inside the drawer has handled, keep the drawer open too', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'More layers', TARGET);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  await expect(settings).toBeVisible();

  // the other search list of the column, the avoid box's, is a combobox that closes on Escape the same way
  await settings.getByRole('combobox', { name: 'Avoid a material' }).fill('copp');
  const materials = settings.getByRole('listbox', { name: 'Materials' });
  await expect(materials).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(materials).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // something inside the drawer that takes the key the way a confirmation would, by preventing its default, keeps the drawer open
  await settings.evaluate((aside) => {
    aside.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && aside.dataset['claimEscape'] === 'yes') e.preventDefault();
    });
    aside.dataset['claimEscape'] = 'yes';
  });
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);

  await settings.evaluate((aside) => { aside.dataset['claimEscape'] = 'no'; });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
});

// Ruling R37: in a column 300 px wide or so, the title of a section can wrap beside its readout ("Reachable dimensions"). The button
// then grows to hold its lines, instead of spilling them over its bevel; a title on one line keeps the button at 36 px.
test('a settings title that wraps grows its button and stays inside it, in the column and in the drawer', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Wrapped titles', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 });   // a plan: the readout shows
  const settings = page.locator('aside[aria-label="Project settings"]');
  const dims = settings.locator('details.settings-section > summary').filter({ hasText: 'Reachable dimensions' });
  const projector = settings.locator('details.settings-section > summary').filter({ hasText: 'In-game projector' });
  /** A summary's face less its 2 px edge and 2 px bevel, its title's box and line height, and its readout's box. */
  const measure = (summary: Locator) => summary.evaluate((el) => {
    const box = (of: Element): { top: number; bottom: number; left: number; right: number; height: number } => {
      const { top, bottom, left, right, height } = of.getBoundingClientRect();
      return { top, bottom, left, right, height };
    };
    const face = box(el);
    const inset = 2 + 2;
    const title = el.querySelector('h3');
    const readout = el.querySelector('.muted');
    return {
      height: face.height,
      inside: { top: face.top + inset, bottom: face.bottom - inset, left: face.left + inset, right: face.right - inset },
      title: title === null ? null : { ...box(title), line: Number.parseFloat(getComputedStyle(title).lineHeight) },
      readout: readout === null ? null : box(readout),
    };
  });

  for (const [width, height, drawer] of [[1280, 720, false], [800, 900, true]] as const) {
    await page.setViewportSize({ width, height });
    if (drawer) await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
    await expect(dims).toBeVisible();
    await expect(dims.locator('.muted')).toBeVisible();
    const drawn = await measure(dims);
    if (drawn.title === null || drawn.readout === null) throw new Error('the summary has no title or no readout');
    expect(Math.round(drawn.title.height / drawn.title.line), `the title wraps at ${width} px`).toBeGreaterThanOrEqual(2);
    expect(drawn.height, `the button grows at ${width} px`).toBeGreaterThan(36);
    // every line of the title, and the readout beside it, is inside the face: clear of its edge and its bevel
    for (const part of [drawn.title, drawn.readout]) {
      expect(part.top, `at ${width} px`).toBeGreaterThanOrEqual(drawn.inside.top);
      expect(part.bottom, `at ${width} px`).toBeLessThanOrEqual(drawn.inside.bottom);
      expect(part.right, `at ${width} px`).toBeLessThanOrEqual(drawn.inside.right);
    }
    // a title on one line keeps the button's 36 px
    expect((await measure(projector)).height, `at ${width} px`).toBe(36);
  }
});

test('wide screens keep the settings beside the views and show no button', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'No drawer');
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  // the button is there for a narrow window to find, and hidden by the stylesheet while this one is wide; so is the drawer's Close button
  await expect(page.locator('.settings-toggle')).toHaveCount(1);
  await expect(page.locator('.settings-toggle')).toBeHidden();
  await expect(page.locator('.settings-close')).toHaveCount(1);
  await expect(page.locator('.settings-close')).toBeHidden();
});

// A project with no target (the Make picker is never out of sight). What to make is the first section of the settings, and below 900 px
// the settings are a drawer behind the Settings button, so a person who opens a new project in a narrow window sees "Pick something to
// make" in the banner and finds no picker. Now the drawer opens by itself when such a project is opened, once per visit, with the focus in
// the item search; the words in the banner are a button that goes to the search (opening the drawer first on a narrow window); and the
// Settings button says what the line makes.

/** The drawer, its Settings button, the item search of its Make section, its Close button and the banner's hint, found the same way each time. */
function pieces(page: Page): { settings: Locator; toggle: Locator; search: Locator; close: Locator; hint: Locator } {
  const settings = page.locator('aside[aria-label="Project settings"]');
  return {
    settings,
    toggle: page.getByRole('button', { name: SETTINGS_BUTTON }),
    search: settings.getByPlaceholder('Search items and fluids'),
    close: settings.getByRole('button', { name: 'Close settings' }),
    hint: page.getByRole('button', { name: 'Pick something to make' }),
  };
}

test('a new project with no target opens the drawer by itself, once, with the focus in the item search', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Nothing yet');
  const { settings, toggle, search, close } = pieces(page);

  // open without a click, and the focus is in the search, not on Close: the way to what to make is where the keyboard is
  await expect(settings).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeFocused();
  await expect(close).not.toBeFocused();
  await expect(search).toBeInViewport();
  expect(await focusIsIn(page)).toBe('the drawer');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).toHaveAttribute('inert', '');

  // it is the same drawer in every other way: typing opens a list, and Escape closes one layer per press, the list first
  await page.keyboard.type('Iron Ingot');
  const matches = settings.getByRole('listbox', { name: 'Matches' });
  await expect(matches).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(matches).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');

  // once closed it stays closed: a change to the project (here, someone renames it) does not open it again
  const renamed = await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops: [{ op: 'rename', name: 'Still nothing' }] } });
  expect(renamed.ok()).toBe(true);
  await expect(page.getByLabel('Project name')).toHaveValue('Still nothing');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();

  // a new visit is a new chance: the project still has no target
  await page.reload();
  await expect(settings).toBeVisible();
  await expect(search).toBeFocused();
});

test('a project that has a target does not open the drawer by itself', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Has a target', TARGET);
  const { settings, toggle, hint } = pieces(page);
  // wait for the plan, which is the last thing the page waits for: the drawer would have opened by now
  await expect(page.locator('svg [data-step-id]').first()).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(hint).toHaveCount(0);
});

test('"Pick something to make" in the banner opens the drawer again, into the item search', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Hint');
  const { settings, toggle, search, close, hint } = pieces(page);
  await expect(settings).toBeVisible();                                              // opened by itself

  // close it with its Close button (Playwright scrolls that button into view first, which is the top of the drawer), and only then scroll
  // the drawer, hidden, to its bottom: the search is out of its view, and nothing but the page's own scrolling can bring it back
  await close.click();
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(await settings.evaluate((aside) => { aside.scrollTop = aside.scrollHeight; return aside.scrollTop; }), 'the hidden drawer scrolled').toBeGreaterThan(0);

  // the banner says what is missing, and its words are a button that goes there: the drawer opens, the search is in view and has the focus
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(settings).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeFocused();
  await expect(close).not.toBeFocused();
  await expect(search).toBeInViewport();
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).toHaveAttribute('inert', '');

  // it is the drawer of every other way in: Escape closes it and gives the focus back to the Settings button
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // and the hint is still there to use again
  await hint.click();
  await expect(settings).toBeVisible();
  await expect(search).toBeFocused();
});

test('the Settings button says what the line makes, from nothing yet to the target just picked', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Named');
  const { settings, toggle, search, close } = pieces(page);
  await expect(settings).toBeVisible();                                              // opened by itself

  // what is drawn is what the button is called (WCAG 2.5.3), and it is still the button of the drawer
  await expect(toggle).toHaveText('Settings · Make: nothing yet');
  await expect(toggle).toHaveAccessibleName('Settings · Make: nothing yet');
  await expect(toggle).toHaveAttribute('type', 'button');
  await expect(toggle).toHaveAttribute('aria-controls', 'project-settings');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // pick a target: the settings panel names it, and so does the button
  await search.fill('basic circ');
  await page.getByRole('option', { name: /Basic Circuit/ }).click();
  await expect(settings.locator('.settings-target-name')).toHaveText('Basic Circuit');
  await expect(toggle).toHaveText('Settings · Make: Basic Circuit');
  await expect(toggle).toHaveAccessibleName('Settings · Make: Basic Circuit');

  // closed, it still says so; and with a target there is no hint to pick one
  await close.click();
  await expect(settings).toBeHidden();
  await expect(toggle).toHaveText('Settings · Make: Basic Circuit');
  await expect(pieces(page).hint).toHaveCount(0);

  // clear the target: nothing yet again, and the hint is back
  await toggle.click();
  await settings.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(toggle).toHaveText('Settings · Make: nothing yet');
  await close.click();
  await expect(pieces(page).hint).toBeVisible();
});

test('the Settings button names a target the moment it is picked, before the plan that names it arrives', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Slow plan');
  const { settings, toggle, search } = pieces(page);
  await expect(search).toBeFocused();

  // hold back every plan the server is asked for from here on. Until the plan comes (it names every key it uses), the settings panel
  // names what was picked from the name the search box gave it, and the button must say the same, not the target's key
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/projects\/[^/]+\/plan$/, async (route) => {
    await held;
    await route.continue();
  });
  await search.fill('basic circ');
  await page.getByRole('option', { name: /Basic Circuit/ }).click();
  await expect(page.getByText('Updating the plan…')).toBeVisible();
  await expect(page.locator('svg [data-step-id]')).toHaveCount(0);                  // the plan of a target is not here
  await expect(settings.locator('.settings-target-name')).toHaveText('Basic Circuit');
  await expect(toggle).toHaveText('Settings · Make: Basic Circuit');
  await expect(toggle).not.toContainText('t:circuit');

  release();
  await expect(page.locator('svg [data-step-id]').first()).toBeVisible();           // now it is, and the button says the same
  await expect(toggle).toHaveText('Settings · Make: Basic Circuit');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('on a wide window "Pick something to make" focuses the item search, and no drawer opens', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Wide hint');
  const { settings, search, hint } = pieces(page);
  const toggle = page.locator('.settings-toggle');                                    // not drawn on a wide window, so not found by its role
  await expect(settings).toBeVisible();                                              // beside the views
  await expect(hint).toBeVisible();

  // nothing opens by itself, and nothing has the focus
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(search).not.toBeFocused();
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');

  // the column scrolls inside itself: scroll the search out of it, and the hint brings it back
  await settings.evaluate((aside) => { aside.scrollTop = aside.scrollHeight; });
  await expect(search).not.toBeInViewport();
  await hint.click();
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();

  // and still no drawer: no backdrop, nothing inert, and the button that opens one is not drawn
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(toggle).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');
});

test('the drawer of a project with no target waits for the name prompt, and opens into the search once the name is saved', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page);                                                                  // no name set: the prompt covers the page
  await createProject(page, 'Prompted');
  const { settings, toggle, search, hint } = pieces(page);
  const prompt = page.getByRole('dialog', { name: 'What should we call you?' });
  const name = prompt.getByLabel('Your name');
  await expect(prompt).toBeVisible();
  await expect(name).toBeFocused();

  // the project and its plan are loaded behind the prompt (the hint is drawn once they are), and the drawer has not taken the focus from it
  await expect(hint).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(name).toBeFocused();

  await name.fill('Ann');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toBeHidden();
  await expect(settings).toBeVisible();
  await expect(search).toBeFocused();
});

test('a long target name is cut with an ellipsis, and the Settings button stays within 40% of the head', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Long name', TARGET);
  const { toggle } = pieces(page);
  const target = toggle.locator('.settings-toggle-target');
  await expect(target).toHaveText('· Make: Basic Circuit');
  // the connection badge starts as "reconnecting…" (137px) and is "live" (58px) once the event stream is open; the head's rows are counted
  // with the badge it settles on, since the long name below fills 40% of the head and a wider badge wraps it
  await expect(page.locator('.connection.live')).toBeVisible();

  // Inter 13px in the muted ink on a dark readout, with no drop shadow of the button's (the contract's values, as the browser computes them)
  await expect(target).toHaveCSS('font-size', '13px');
  await expect(target).toHaveCSS('font-family', /^Inter\b/);
  await expect(target).toHaveCSS('color', 'rgb(170, 170, 170)');
  await expect(target).toHaveCSS('background-color', 'rgb(27, 27, 27)');
  await expect(target).toHaveCSS('text-shadow', 'none');
  await expect(target).toHaveCSS('text-overflow', 'ellipsis');

  const measure = (): Promise<{ head: number; rows: number; toggle: number; height: number; cut: boolean; nameTop: number; toggleTop: number }> => page.evaluate(async () => {
    await document.fonts.ready;                                                       // the widths are the pixel font's, not its stand-in's
    const head = document.querySelector('.project-head')!.getBoundingClientRect();
    const button = document.querySelector('.settings-toggle')!.getBoundingClientRect();
    const part = document.querySelector('.settings-toggle-target')!;
    return {
      head: head.width, rows: head.height, toggle: button.width, height: button.height, cut: part.scrollWidth > part.clientWidth,
      nameTop: document.querySelector('.project-name')!.getBoundingClientRect().top, toggleTop: button.top,
    };
  });
  const short = await measure();
  expect(short.cut, 'a short name is whole').toBe(false);
  expect(short.height).toBe(36);
  expect(short.rows, 'the head is one row at 800 px while the stream is live, as it was with the bare button').toBe(36);

  // the name of a long multiblock in its place (the button is drawn from the project's target; this is its layout)
  await target.evaluate((el) => { el.textContent = '· Make: Large Extremely Long Named Industrial Multiblock Processing Array Controller Casing'; });
  const long = await measure();
  expect(long.cut, 'a long name is cut').toBe(true);
  expect(long.toggle).toBeGreaterThan(short.toggle);
  expect(long.toggle).toBeLessThanOrEqual(long.head * 0.4 + 0.5);
  expect(long.height, 'the button keeps its 36px').toBe(36);
  expect(long.rows, 'and the head stays one row').toBe(36);
  expect(Math.abs(long.nameTop - long.toggleTop), 'the project name stays on the button\'s row').toBeLessThanOrEqual(1);
});

test('on a phone the Settings button shows the whole of a short name: the 40% cap is for windows wider than 700 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page); await setName(page, 'Ann');
  const { toggle } = pieces(page);
  const target = toggle.locator('.settings-toggle-target');
  const measure = (): Promise<{ head: number; toggle: number; partWidth: number; partNeeds: number }> => page.evaluate(async () => {
    await document.fonts.ready;                                                       // the widths are the pixel font's, not its stand-in's
    const part = document.querySelector('.settings-toggle-target')!;
    return {
      head: document.querySelector('.project-head')!.getBoundingClientRect().width, toggle: document.querySelector('.settings-toggle')!.getBoundingClientRect().width,
      partWidth: part.clientWidth, partNeeds: part.scrollWidth,
    };
  });

  // a project with no target and one making Basic Circuit: the part is whole, where a cap of 40% of the head (136 px) left it a few letters
  for (const [settings, text] of [[undefined, '· Make: nothing yet'], [TARGET, '· Make: Basic Circuit']] as const) {
    await createProject(page, 'Phone', settings);
    await expect(target).toHaveText(text);
    const whole = await measure();
    expect(whole.partNeeds, `"${text}" is drawn whole`).toBeLessThanOrEqual(whole.partWidth);
    expect(whole.toggle, 'the button fits the head').toBeLessThanOrEqual(whole.head + 0.5);
  }

  // a name too long for the head is still cut, at the width of the head
  await target.evaluate((el) => { el.textContent = '· Make: Large Extremely Long Named Industrial Multiblock Processing Array Controller Casing'; });
  const long = await measure();
  expect(long.partNeeds, 'a long name is cut').toBeGreaterThan(long.partWidth);
  expect(long.toggle, 'at the width of the head').toBeCloseTo(long.head, 0);
});

test('a drawer that opened by itself in a window that has grown past 900 px since it looked closes at once, and the focus stays in the search', async ({ page }) => {
  // The window is 1280 px wide, for real, but the first look the page takes at its width (the auto-open's, in an effect) is told it is narrow:
  // so the drawer opens, and by the time the drawer's own effect looks again, to hear the window change, it has grown past 900 px. A listener
  // that only hears the changes after it is attached would never close it, and the page would stay inert beside a column that needs no drawer.
  await page.addInitScript(() => {
    const seen = window as unknown as { __looks: number; __opened: boolean };
    seen.__looks = 0;
    seen.__opened = false;
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string): MediaQueryList => {
      if (query !== '(max-width: 900px)' || ++seen.__looks > 1) return real(query);
      return {
        matches: true, media: query, onchange: null, dispatchEvent: () => false,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      };
    };
    // whether the button ever said the drawer was open. The page can open it and close it again before a task ends, so what the DOM says by
    // the time this is told is not enough: the old value of each change is what shows that it was open
    new MutationObserver((records) => {
      const wasOpen = records.some((record) => record.oldValue === 'true' && record.target instanceof Element && record.target.classList.contains('settings-toggle'));
      if (wasOpen || document.querySelector('.settings-toggle[aria-expanded="true"]') !== null) seen.__opened = true;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'], attributeOldValue: true });
  });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Grown');                                                 // no target; the window is the default 1280x720
  const { settings, search } = pieces(page);
  const toggle = page.locator('.settings-toggle');                                    // not drawn on a wide window, so not found by its role

  // the page opened the drawer, told the window was narrow, and closed it at once when it looked again and found it wide
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: boolean }).__opened), 'the page opened the drawer by itself').toBe(true);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');
  // the column is beside the views, with the focus where the drawer put it: on the search, and not thrown to a button that is not drawn
  await expect(settings).toBeVisible();
  await expect(search).toBeFocused();
  await expect(toggle).not.toBeFocused();
});

// Phase 2 Task 8 (spec §17 R43): while the drawer is open the banners behind it are inert, so what they say is not announced; the drawer's
// own status line says how many problems the plan has (never their words, which other specs find by text), and nothing once it is closed.
test('the drawer has a status line of its own (R43)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, copperUnsourced());                                       // its LV_CIRCUITS give a target: the drawer stays shut
  const status = page.locator("aside[aria-label='Project settings'] [role=status]");
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();                 // "Settings · Make: Basic Circuit"
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible();   // the drawer is open
  await expect(status).toHaveText('The plan has 1 problem');                          // the Copper Ingot nothing supplies
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('');
});

// plan ruling drawer-status-count: the drawer that opens by itself is where the hint to pick something to make is answered, so that hint is
// no problem it announces over the focused item search
test('the drawer that opens by itself to pick a target says no problem (R43)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Status, nothing yet');                                  // no target: the drawer opens by itself into the item search
  await expect(page.locator('.plan-banner button.link')).toHaveText('Pick something to make');   // the plan is in; the banner is inert, so found by class
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible();   // the drawer is open
  await expect(page.locator("aside[aria-label='Project settings'] [role=status]")).toHaveText('');
});

// ledger ruling P2-R52: an update is heard to start in the drawer ("The plan is updating…"), and to end: a plan with nothing to warn about
// says it has no problems
test('the drawer says when an update ends with no problems (R43)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const id = await openWithPlan(page, circuitLv(), { ...LV_CIRCUITS, useSurplus: false });   // nothing to warn about; no other project reaches it
  const status = page.locator("aside[aria-label='Project settings'] [role=status]");
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeVisible();
  await expect(status).toHaveText('No problems');
  const letThrough = await holdReplan(page, id);
  await expect(status).toHaveText('The plan is updating…');
  await letThrough();
  await expect(status).toHaveText('No problems');
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('');
});

// the final fix wave, FW-10 (R43): a change the planner refuses snaps back in the drawer, and the banner that says why is inert behind it, so the
// drawer's own status says it, first. It is read in the status line: the banner holds the same words, which a page-wide getByText would find
// twice while the drawer is open (spec §3.8)
test('the drawer\'s status says why a change was refused (R43)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Refused in the drawer', TARGET);
  await page.route(`**/api/projects/${id}/ops`, (route) => route.fulfill({ status: 400, json: { error: 'bad-op', message: 'The planner refused that change' } }));
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  const settings = page.locator('aside[aria-label="Project settings"]');
  const status = settings.locator('p[role="status"]');
  await expect(status).toHaveText(/problem/);                                               // the plan's count, before the change
  const amount = settings.getByLabel('Amount', { exact: true });
  await amount.fill('45');
  await amount.press('Enter');
  await expect(status).toHaveText('The planner refused that change');
  await expect(page.locator('.project-banners .banner.error')).toHaveText('The planner refused that change');   // the inert banner's alert
});
