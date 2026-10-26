// Keyboard shortcuts (Phase 2 spec §14, D16; Task 11): on a project page `/` focuses the item search (below 900 px it opens the drawer into it),
// 1–6 switch the tabs and hand the focus to the one selected, F fits the diagram shown and P pauses or plays its pipes (on a diagram's tab only),
// and ? opens a sheet that lists them, as the head's Shortcuts button does above 900 px (plan ruling shortcuts-button-wide). A key typed in a
// field is typed, and no key is a shortcut while the drawer, the sheet or another modal is open, nor inside an in-app confirm (ledger ruling
// P2-R73). The sheet is the top layer: #root is inert behind it, Escape closes it alone (P2-D22) and the focus goes back to the opener (the
// button pressed, or what had the focus for `?`), else to the head's Shortcuts button, else to the drawer's Keyboard shortcuts button while
// the drawer is open, else to the selected tab (P2-R71), never to the page's body nor into a closed drawer (P2-R90); the toasts wait it out
// as they wait out the drawer (P2-R72). Every project here has a target, so no drawer opens by itself, but in the last case, where that
// drawer is what it tests.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import {
  bodyFocusCount, createProject, login, LV_CIRCUITS, markTips, noDialogs, openConnections, openWithPlan, setName, SETTINGS_BUTTON, watchBodyFocus,
} from './helpers.ts';

/** The sheet, by its role and its title. */
const sheetOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Keyboard shortcuts' });
/** The diagram's Fit, in the tab panel shown. */
const fitOf = (page: Page): Locator => page.locator('.tab-panel').getByRole('button', { name: 'Fit', exact: true });
/** The page's hash, which a digit sets as it is pressed: read at once, it says whether the key switched the tab. */
const hashOf = (page: Page): Promise<string> => page.evaluate(() => location.hash);

/**
 * `bodyFocusCount` while the page's clock is paused (`page.clock.pauseAt`): the counter's frames are the faked clock's, so it runs the clock on
 * by 100 ms, which no 5 s toast notices, as the count waits for them.
 */
async function bodyFocusCountPaused(page: Page): Promise<number> {
  const counted = bodyFocusCount(page);
  await page.clock.runFor(100);
  return counted;
}

/** A finger's long press on `target`, held until its tip reads `tip`, then lifted (in a context with touch: the tip stays until the next tap). */
async function longPressTip(page: Page, target: Locator, tip: string): Promise<void> {
  const box = (await target.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(page.getByRole('tooltip')).toHaveText(tip);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/**
 * Holds the page's animations still over CDP, as the developer tools' Animations panel pauses them: a transition started meanwhile stays at
 * its start however slow the machine is (CSS transitions run on the browser's time, which `page.clock` does not fake). Gives back what lets
 * them run again.
 */
async function holdAnimations(page: Page): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  return async () => {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await cdp.detach();
  };
}

test('5 selects Materials & steps and moves the focus to it', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  // each tab says its digit, in order (fix round 1, M8)
  const tabKeys = await page.locator('.tabs [role=tab]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-keyshortcuts')));
  expect(tabKeys).toEqual(['1', '2', '3', '4', '5', '6']);
  // the digit of the tab shown already: no switch, the tab takes the focus at once, never by way of the body (fix round 1, M2)
  await fitOf(page).focus();
  await watchBodyFocus(page);
  await page.keyboard.press('4');
  await expect(page.locator('#tab-flow')).toBeFocused();
  expect(await hashOf(page)).toBe('#flow');
  expect(await bodyFocusCount(page)).toBe(0);
  const materials = page.getByRole('tab', { name: 'Materials & steps' });
  await page.keyboard.press('5');
  await expect(materials).toHaveAttribute('aria-selected', 'true');
  await expect(materials).toBeFocused();
  // from a control the switch takes away (Flow's Fit), the focus goes to the tab and is never left on the page's body
  await page.keyboard.press('4');
  await expect(page.locator('#tab-flow')).toBeFocused();
  await fitOf(page).focus();
  await watchBodyFocus(page);
  await page.keyboard.press('5');
  await expect(materials).toHaveAttribute('aria-selected', 'true');
  await expect(materials).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

test('a digit typed in a field types', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const flow = page.locator('#tab-flow');
  for (const field of [page.getByLabel('Project name'), page.getByLabel('Amount')]) {
    const before = await field.inputValue();
    await field.focus();
    await page.keyboard.press('1');
    await expect(field).toHaveValue(/1/);
    expect(await hashOf(page)).toBe('#flow');
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue(before);
    await expect(flow).toHaveAttribute('aria-selected', 'true');
  }
});

test('/ focuses the item search, which stays empty', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  // the Make section's search alone says it: the avoid box's, the cost form's and the Add a farm form's have no key
  const search = page.locator('input[aria-keyshortcuts="/"]');
  await expect(search).toHaveCount(1);
  await expect(search).toHaveAttribute('placeholder', 'Search items and fluids');
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
  await expect(search).toHaveValue('');
});

test('? and the Shortcuts button open the sheet; Escape closes it and gives the focus back', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const sheet = sheetOf(page);
  const close = sheet.getByRole('button', { name: 'Close' });
  const fit = fitOf(page);
  const button = page.getByRole('button', { name: 'Shortcuts', exact: true });
  await fit.focus();
  await watchBodyFocus(page);
  await page.keyboard.press('?');
  await expect(sheet).toBeVisible();
  await expect(close).toBeFocused();
  // its rows, and the page behind it out of reach
  await expect(sheet.locator('dt')).toHaveCount(6);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  // the keyboard stays with it: Tab and Shift+Tab go round its two controls, the tick (fix round 1, P2-R85) and Close, and a press on its words
  // keeps the focus in it, so the Escape after them is still the sheet's
  const tick = sheet.getByRole('checkbox', { name: 'Use single-key shortcuts' });
  await page.keyboard.press('Tab');
  await expect(tick).toBeFocused();                                                    // from the last, round to the first
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(tick).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();                                                   // from the first, round to the last
  // a press on its words leaves the focus in the dialog, which takes it (ledger ruling P2-R81a), and whose words can be selected; from the
  // dialog Tab goes to its first control and Shift+Tab to its last, and Escape is still the sheet's
  await sheet.getByText('Fit the diagram').click();
  await expect(sheet).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tick).toBeFocused();
  await sheet.getByText('Fit the diagram').dblclick();
  expect(await page.evaluate(() => String(getSelection()))).not.toBe('');
  await expect(sheet).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await sheet.getByText('Fit the diagram').click();
  await expect(sheet).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(fit).toBeFocused();

  // the Shortcuts button opens it too, and Close and a press on the dimmed page close it, the focus back on the button each time
  await expect(button).toHaveAttribute('aria-keyshortcuts', '?');
  await button.click();
  await expect(close).toBeFocused();
  await close.click();
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(close).toBeFocused();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width + 20, box.y + 4);                           // beside the sheet, on the dimmed page
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);

  // at 1280 x 720 the head keeps its one row of 36 px with the Compare modes and Shortcuts buttons both drawn (spec §3.6, §14.1)
  await expect(page.locator('.project-head .compare-toggle')).toBeVisible();
  await expect(button).toBeVisible();
  await expect(page.locator('.project-head .connection.live')).toBeVisible();
  const head = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.querySelector('.project-head')!.getBoundingClientRect().height;
  });
  expect(head, 'the head is one row').toBe(36);
});

test('P pauses and plays the pipes', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  await page.keyboard.press('p');
  const play = page.getByRole('button', { name: 'Play pipes' });
  await expect(play).toBeVisible();
  await expect(play).not.toHaveAttribute('aria-pressed');
  await expect(canvas).toHaveClass(/\bpipes-paused\b/);
  await page.keyboard.press('P');
  const pause = page.getByRole('button', { name: 'Pause pipes' });
  await expect(pause).toBeVisible();
  await expect(pause).not.toHaveAttribute('aria-pressed');
  await expect(canvas).not.toHaveClass(/\bpipes-paused\b/);
});

test('F fits the Connections picture again', async ({ page }) => {
  const view = await openConnections(page);
  const transform = (): Promise<string | null> => view.locator('g.conn-pan').getAttribute('transform');
  // the view the picture was fitted at, once the area has its size (a read that holds from one poll to the next)
  let fitted = await transform();
  await expect.poll(async () => {
    const now = await transform();
    const held = now === fitted;
    fitted = now;
    return held;
  }).toBe(true);
  const area = (await view.getByRole('group', { name: 'Connections of the line' }).boundingBox())!;
  const [x, y] = [Math.round(area.x + area.width / 2), Math.round(area.y + area.height / 2)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(transform).not.toBe(fitted);
  await page.keyboard.press('f');
  await expect.poll(transform).toBe(fitted);
});

test('with the drawer open at 800 px a digit does nothing', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, circuitLv());                                              // a target: the drawer stays shut until asked
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();                 // "Settings · Make: Basic Circuit"
  const toggle = page.locator('.settings-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('1');
  expect(await hashOf(page)).toBe('#flow');
  await expect(page.locator('#tab-flow')).toHaveAttribute('aria-selected', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // once it is shut, the same key switches
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('5');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-selected', 'true');
});

test('at 800 px / opens the drawer with the focus in its search', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, circuitLv());
  await page.keyboard.press('/');
  await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-expanded', 'true');
  const search = page.locator('aside[aria-label="Project settings"] input[aria-keyshortcuts="/"]');
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
  await expect(search).toHaveValue('');
  await expect(page.locator('.settings-close')).not.toBeFocused();
});

test('F and P do nothing off the diagrams', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await page.keyboard.press('5');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('p');
  await page.keyboard.press('f');
  await page.keyboard.press('4');
  await expect(page.locator('#tab-flow')).toHaveAttribute('aria-selected', 'true');
  // no setting changed unseen: the pipes still move, and this browser keeps no pause
  await expect(page.getByRole('button', { name: 'Pause pipes' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gtnh-planner:pipes-paused'))).toBeNull();
});

test('at 800 px the head keeps its one row: no Shortcuts button there, and ? still opens the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, circuitLv());
  await expect(page.locator('.connection.live')).toBeVisible();                       // the badge the head settles on (ruling F3)
  await expect(page.locator('.project-head .shortcuts-open')).toBeHidden();
  const head = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.querySelector('.project-head')!.getBoundingClientRect().height;
  });
  expect(head, 'the head is one row').toBe(36);
  // the focus was on the page's body: no opener to go back to, and no Shortcuts button drawn, so the selected tab takes it (P2-R71)
  await watchBodyFocus(page);
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#tab-flow')).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('button', { name: 'Shortcuts', exact: true })).toBeVisible();
});

// Ledger ruling P2-R83: the Shortcuts button sits before Delete project, so the type-the-name confirm that takes Delete project's place, a row
// of its own, leaves it on the head's first row. A 28 px button is centred on the row of the 36 px name: its centre is the name's (its top 4 px
// below the name's), and its top the Compare modes button's
test('the Shortcuts button stays on the head\'s first row while Delete project asks (P2-R83)', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const head = page.locator('.project-head');
  await head.getByRole('button', { name: 'Delete project' }).click();
  const confirm = head.getByRole('form', { name: 'Confirm delete' });
  await expect(confirm).toBeVisible();
  const [name, compare, shortcuts, asks] = await Promise.all([
    head.getByLabel('Project name', { exact: true }), head.getByRole('button', { name: 'Compare modes' }),
    head.getByRole('button', { name: 'Shortcuts', exact: true }), confirm,
  ].map(async (part) => (await part.boundingBox())!));
  expect(Math.abs(shortcuts!.y + shortcuts!.height / 2 - (name!.y + name!.height / 2)), 'on the name\'s row').toBeLessThanOrEqual(0.5);
  expect(shortcuts!.y, 'level with Compare modes').toBe(compare!.y);
  expect(shortcuts!.y + shortcuts!.height, 'above the confirm\'s row').toBeLessThanOrEqual(asks!.y);
});

// Ledger ruling P2-R84: the diagram hints end with "? shows the shortcuts." (spec §14.1) and are no taller for it than they were at fc87ab8. A
// line of the hint (`.small`, 13.6 px × 1.45 = 19.72 px) is laid out 19.703125 px tall. At fc87ab8, measured with the fonts in: the Flow hint
// one line at 1280 x 720; the Connections hint, beside Fit and Pause pipes, two lines (39.40625 px) at 1280 x 720 and one at 1440 x 900
const HINT_LINE = 19.703125;
const hintHeight = (hint: Locator): Promise<number> => hint.evaluate(async (el) => {
  await document.fonts.ready;
  return el.getBoundingClientRect().height;
});

test('the Flow hint ends with the shortcuts and stays one line at 1280 x 720 (P2-R84)', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const hint = page.locator('.flow-toolbar > span.muted.small');
  await expect(hint).toHaveText(/ \?question mark shows the shortcuts\.$/);           // the `?` said as a word (P2-R86)
  expect(await hintHeight(hint)).toBe(HINT_LINE);
});

test('the Connections hint ends with the shortcuts and is as tall as at fc87ab8, at 1280 x 720 and 1440 x 900 (P2-R84)', async ({ page }) => {
  const view = await openConnections(page);
  const hint = page.locator('.conn-toolbar > span');
  await expect(hint).toHaveText(/ \?question mark shows the shortcuts\.$/);           // the `?` said as a word (P2-R86)
  expect(await hintHeight(hint), '1280 x 720').toBe(2 * HINT_LINE);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(view).toBeVisible();
  expect(await hintHeight(hint), '1440 x 900').toBe(HINT_LINE);
});

// P2-D22: the sheet is the modal top layer, so the Escape that closes it stops there; Flow's own Escape, which clears the highlight whatever
// a layer above did (P2-R21c), hears the next one (one layer per press, spec §6.1)
test('Escape closes the sheet alone: the Flow highlight stays lit until the next one', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await fitOf(page).focus();                                                          // out of the select, which takes typing
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveClass(/\bfocusing\b/);
});

// Fix round 1, I1 (ledger ruling P2-R87): a tip a finger's long press showed stays until the next tap, whatever the pointer does; the sheet
// makes the page inert, and the tip goes with it, so the next Escape is the sheet's; and that Escape stops at the sheet, Flow's highlight lit
test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  // Fix round 2, M5 (ledger ruling P2-R87): no tip shows for a trigger already inside an inert layer. A long press on Fit, whose tip comes
  // LONG_PRESS_MS (500 ms) after the finger goes down, is still running when ? opens the sheet; the page's clock, paused, then runs past it:
  // no tip is drawn, not even for a frame (`markTips` sees one drawn for a frame). The same press with no sheet shows the tip, first
  test('a long press still running as the sheet opens shows no tip, not even for a frame (P2-R87)', async ({ page }) => {
    await page.clock.install();
    await openWithPlan(page, circuitLv());
    await page.clock.pauseAt(Date.now() + 1000);
    const box = (await fitOf(page).boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    // the control: the press shows Fit's tip once the clock has run past it, and a tap elsewhere takes it away
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await page.clock.runFor(1000);
    await expect(page.getByRole('tooltip')).toHaveText('Fit · F');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('.flow-legend').tap();
    await page.clock.runFor(1000);
    await expect(page.locator('.nei-tooltip')).toHaveCount(0);
    // under the sheet, opened while the press runs
    await markTips(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await page.keyboard.press('?');
    await expect(sheetOf(page)).toBeVisible();
    await page.clock.runFor(1000);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.clock.runFor(1000);
    await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-seen');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('a long-pressed tip goes as the sheet opens, and one Escape closes the sheet, Flow\'s highlight still lit (P2-R87)', async ({ page }) => {
    await openWithPlan(page, circuitLv());
    const canvas = page.locator('svg.flow-canvas');
    await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
    await expect(canvas).toHaveClass(/\bfocusing\b/);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());  // the key on the page, not in the select
    await longPressTip(page, fitOf(page), 'Fit · F');
    await page.keyboard.press('?');
    const sheet = sheetOf(page);
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(canvas).toHaveClass(/\bfocusing\b/);
  });
});

// Fix round 1, I1 (a): the sheet stops every Escape. One a layer above has taken (the shared tooltip's capture listener prevents an Escape and
// never stops it) is not the sheet's, and goes no further: Flow's window listener, which clears its highlight whatever a layer above did
// (P2-R21c), never hears it behind the open sheet
test('an Escape a layer above has taken goes no further than the open sheet', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.evaluate(() => document.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); }, { capture: true, once: true }));
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(canvas).toHaveClass(/\bfocusing\b/);
});

// Fix round 1, I2 (ledger ruling P2-R85, WCAG 2.1.4): the single-key shortcuts can be turned off, in the sheet, for this browser. Off, no key
// acts, `?` included, and nothing says a key: no `aria-keyshortcuts`, no tips on Fit and Pause pipes, no ending on the hints. The Shortcuts
// button still opens the sheet, where they can be turned on again; the choice outlives a reload
test('the single-key shortcuts can be turned off in the sheet and on again, and this browser keeps the choice (P2-R85)', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const sheet = sheetOf(page);
  const button = page.getByRole('button', { name: 'Shortcuts', exact: true });
  const keys = sheet.getByRole('checkbox', { name: 'Use single-key shortcuts' });
  const search = page.locator('aside[aria-label="Project settings"]').getByPlaceholder('Search items and fluids');
  const view = page.locator('svg.flow-canvas > g');
  const blur = (): Promise<void> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await button.click();
  await expect(keys).toBeChecked();
  await keys.uncheck();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // a view that Fit would change, and no key acts
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await view.getAttribute('transform');
  await blur();
  for (const key of ['1', '/', 'f', 'p', '?']) await page.keyboard.press(key);
  expect(await hashOf(page)).toBe('#flow');
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue('');
  expect(await view.getAttribute('transform')).toBe(zoomed);
  await expect(page.getByRole('button', { name: 'Pause pipes' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  // and nothing says a key
  await expect(page.locator('[aria-keyshortcuts]')).toHaveCount(0);
  for (const name of ['Fit', 'Pause pipes']) await expect(page.locator('.tab-panel').getByRole('button', { name, exact: true })).not.toHaveAttribute('data-tip');
  await expect(page.locator('.flow-toolbar > span.muted.small')).toHaveText(/scroll zooms\.$/);
  // the choice outlives a reload, and the Shortcuts button still opens the sheet, which turns them on again
  await page.reload();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  await page.keyboard.press('5');
  expect(await hashOf(page)).toBe('#flow');
  await button.click();
  await expect(keys).not.toBeChecked();
  await keys.check();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await blur();
  await page.keyboard.press('5');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-keyshortcuts', '5');
});

// Fix round 1, I2 (ledger rulings P2-R85, P2-R88): at 900 px or less the head draws no Shortcuts button, so the drawer ends with a Keyboard
// shortcuts button. It opens the sheet over the open drawer; Escape closes the sheet alone, the focus back on that button, the drawer's own
// layers still inert, and the next one the drawer. Both layers hold the toasts, and the sheet letting go of its hold leaves the drawer's: a
// toast drawn before waits until the drawer closes. Fix round 2 (M4): a window that outgrows the drawer while the sheet is open over it closes
// the drawer, the sheet staying and holding the toast, and the focus goes back by P2-R71's chain, the opener no longer drawn. The page's clock
// is faked and paused before the toast shows (M6), so its 5 s run only when the test runs them
test('at 800 px the drawer\'s Keyboard shortcuts button opens the sheet over it, and closing the sheet leaves the drawer and its hold (P2-R85, P2-R88)', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Sheet over the drawer', LV_CIRCUITS);                    // a target: the drawer stays shut until asked
  const field = page.getByRole('textbox', { name: 'Project name' });
  await expect(field).toBeVisible();
  await page.clock.pauseAt(Date.now() + 1000);
  await field.fill('Sheet over the drawer, renamed');
  await field.press('Enter');
  const toast = page.locator('section.toasts li', { hasText: 'Renamed to “Sheet over the drawer, renamed”' });
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  const toggle = page.locator('.settings-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const opener = page.locator('aside[aria-label="Project settings"]').getByRole('button', { name: 'Keyboard shortcuts' });
  await opener.click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await watchBodyFocus(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(opener).toBeFocused();
  // the sheet's layer has gone and the drawer's stays (M3)
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  for (const behind of ['.project-views', '.project-head', '.top-nav']) await expect(page.locator(behind), behind).toHaveAttribute('inert', '');
  expect(await bodyFocusCountPaused(page)).toBe(0);
  await page.clock.runFor(10_000);                                                     // twice a toast's time: the drawer still holds it
  await expect(toast).toHaveAttribute('data-state', 'open');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // the window outgrows the drawer while the sheet is open over it (M4)
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await opener.click();
  await expect(sheet).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.project-body')).not.toHaveClass(/\bsettings-open\b/);
  await expect(sheet).toBeVisible();
  await page.clock.runFor(10_000);                                                     // the sheet alone holds it now
  await expect(toast).toHaveAttribute('data-state', 'open');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shortcuts', exact: true })).toBeFocused();   // P2-R71: the opener is no longer drawn
  expect(await bodyFocusCountPaused(page)).toBe(0);
  await page.clock.runFor(6000);
  await expect(toast).toHaveCount(0);
});

// Fix round 2, M2: WebKit focuses no button on a click or a tap, so the sheet's opener is the button pressed, never only what has the focus.
// A press that moves no focus, a script's click as WebKit's, opens the sheet, and Escape still gives the focus back to the button pressed: the
// drawer's at 800 px (the focus was on Close settings), the head's at 1280 (the focus was on Fit)
test('at 800 px the sheet gives the focus back to the drawer\'s button that opened it, though the press moved no focus', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, circuitLv());
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();
  const opener = page.locator('aside[aria-label="Project settings"]').getByRole('button', { name: 'Keyboard shortcuts' });
  await opener.evaluate((button) => (button as HTMLElement).click());
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('at 1280 px the sheet gives the focus back to the head\'s Shortcuts button that opened it, though the press moved no focus', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await fitOf(page).focus();
  const button = page.getByRole('button', { name: 'Shortcuts', exact: true });
  await button.evaluate((el) => (el as HTMLElement).click());
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
});

// Fix round 3: the drawer's Keyboard shortcuts button is the sheet's way back only while the drawer is open. A window narrowed to 900 px or
// less under the sheet no longer draws the head's Shortcuts button that opened it, and draws the closed drawer for the 180 ms it slides out:
// its button would take the focus then, and the focus would drop to the page's body as the drawer is hidden (ledger ruling P2-R90, which
// covers the opener too: the next case). That exit is held at its start (`holdAnimations`)
test('a window narrowed to 800 px under the sheet gives the focus to the selected tab, not to the closed drawer\'s Keyboard shortcuts button', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  const release = await holdAnimations(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('.project-body')).not.toHaveClass(/\bsettings-open\b/);
  // found when hidden too, so that its last check says it is hidden, not gone
  const drawerButton = page.locator('aside[aria-label="Project settings"]').getByRole('button', { name: 'Keyboard shortcuts', includeHidden: true });
  await expect(drawerButton).toBeVisible();                                            // the closed drawer, held on its way out
  await watchBodyFocus(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toBeFocused();
  await release();
  await expect(drawerButton).toBeHidden();                                             // the drawer's exit has ended
  await expect(tab).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

// Ledger ruling P2-R90: nothing in the settings column takes the focus back while the column is a closed drawer, the opener included. `?`
// pressed at 1280 on the reuse tick, which takes no typing, makes the tick the opener; a window narrowed under the sheet then makes the
// column a closed drawer, drawn for the 180 ms it slides out, and the tick would take the focus then and lose it to the body
test('? pressed on a column tick at 1280 px, then the window narrowed to 800 px under the sheet: the focus goes to the selected tab, not into the closed drawer (P2-R90)', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  // found when hidden too, so that its last check says it is hidden, not gone
  const tick = page.locator('aside[aria-label="Project settings"]').getByRole('checkbox', { name: 'Reuse machines we have', includeHidden: true });
  await tick.focus();
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');                                                 // control: at 1280 the tick is the opener, drawn
  await expect(sheet).toHaveCount(0);
  await expect(tick).toBeFocused();
  await page.keyboard.press('?');
  await expect(sheet).toBeVisible();
  const release = await holdAnimations(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('.project-body')).not.toHaveClass(/\bsettings-open\b/);
  await expect(tick).toBeVisible();                                                    // the closed drawer, held on its way out
  await watchBodyFocus(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const tab = page.getByRole('tab', { selected: true });
  await expect(tab).toBeFocused();
  await release();
  await expect(tick).toBeHidden();                                                     // the drawer's exit has ended
  await expect(tab).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});

// Fix round 1, M1: a key held down repeats into whatever has the focus. A held `/` would type its repeats into the search its first press
// focused; the page takes the repeats of a key it acted on until that key goes up
for (const [width, height] of [[1280, 720], [800, 900]] as const) {
  test(`a held / types nothing into the search it focused, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openWithPlan(page, circuitLv());
    const search = page.locator('aside[aria-label="Project settings"] input[aria-keyshortcuts="/"]');
    await page.keyboard.down('/');
    await page.keyboard.down('/');                                                      // the held key's repeat, on the search by now
    await page.keyboard.up('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
  });
}

// Fix round 1, M5: in a window too short for it (or a zoomed one), the sheet scrolls inside the dimmed page: it stays in the window, its
// title can be scrolled to, and Close, which takes the focus, is scrolled into view
test('in a window too short for it the sheet scrolls, its title and Close both within reach', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await openWithPlan(page, circuitLv());
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all([...el.getAnimations(), ...el.parentElement!.getAnimations()].map((a) => a.finished)));
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(360);
  expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const close = sheet.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  await sheet.evaluate((el) => { el.scrollTop = 0; });
  await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInViewport();
});

// Fix round 1, M8: the head keeps its one row of 36 px with Compare modes and Shortcuts drawn, the badge live, just above the drawer's width
// and on a wide window
for (const [width, height] of [[901, 900], [1440, 900]] as const) {
  test(`at ${width} x ${height} the head keeps its one row with Compare modes and Shortcuts drawn`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openWithPlan(page, circuitLv());
    await expect(page.locator('.project-head .connection.live')).toBeVisible();
    await expect(page.locator('.project-head').getByRole('button', { name: 'Compare modes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shortcuts', exact: true })).toBeVisible();
    const head = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.querySelector('.project-head')!.getBoundingClientRect().height;
    });
    expect(head, 'the head is one row').toBe(36);
  });
}

// Fix round 1, M8: f gives Flow back the view Fit gives, after a zoom
test('f gives Flow back its fitted view after a zoom', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const view = page.locator('svg.flow-canvas > g');
  await fitOf(page).click();
  const fitted = await view.getAttribute('transform');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => view.getAttribute('transform')).not.toBe(fitted);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('f');
  await expect.poll(() => view.getAttribute('transform')).toBe(fitted);
});

// P2-R72: while the sheet is open the toasts behind it wait, as they wait out the drawer (P2-R56, P2-R56a): a toast drawn before it stays,
// its time held, and runs out once the sheet has closed. The page's clock is faked, so its 5 s are run at once
test('the sheet holds the toasts as the drawer does: a toast drawn before it keeps its time until it closes', async ({ page }) => {
  await page.clock.install();
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Sheet toasts', LV_CIRCUITS);
  const field = page.getByRole('textbox', { name: 'Project name' });
  await expect(field).toBeVisible();
  await page.clock.pauseAt(Date.now() + 1000);                                         // fix round 2, M6: the 5 s run only when run
  await field.fill('Sheet toasts renamed');
  await field.press('Enter');                                                          // the field lets the focus go
  const toast = page.getByRole('region', { name: 'Notifications' }).getByRole('listitem').filter({ hasText: 'Renamed to “Sheet toasts renamed”' });
  await expect(toast).toBeVisible();
  await page.keyboard.press('?');
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await page.clock.runFor(10_000);                                                     // twice a toast's time
  await expect(toast).toHaveAttribute('data-state', 'open');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.clock.runFor(6000);
  await expect(toast).toHaveCount(0);
});

// P2-R73: while an in-app confirm asks, the keyboard stays with it (P2-R66): a digit pressed on its Keep it switches no tab; answered, it does
test('a key pressed while an in-app confirm asks is no shortcut', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Sheet confirm', LV_CIRCUITS);
  await page.getByText('In-game projector').click();
  await page.getByLabel('Who is it for?').fill('Steve');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create token' })).toBeEnabled();      // the list is in: the panel is not busy
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  const keep = page.getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Keep it' });
  await expect(keep).toBeFocused();
  await page.keyboard.press('5');
  expect(await hashOf(page)).toBe('#flow');
  await expect(page.locator('#tab-flow')).toHaveAttribute('aria-selected', 'true');
  await expect(keep).toBeFocused();
  await page.keyboard.press('Escape');                                                 // the safe answer: the focus back on the row's Revoke
  await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toBeFocused();
  await page.keyboard.press('5');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-selected', 'true');
  expect(dialogs).toEqual([]);
});

// Spec §14.1: no key is a shortcut while another modal is open, here the name prompt (the map's pin dialog alike): a digit pressed on the page
// behind it switches no tab; once it has gone, the same key does
test('no key is a shortcut while the name prompt asks', async ({ page }) => {
  await login(page);                                                                   // no name in this browser: the prompt covers the page
  await createProject(page, 'Who asks', LV_CIRCUITS);
  const prompt = page.getByRole('dialog', { name: 'What should we call you?' });
  await expect(prompt).toBeVisible();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible(); // the page behind it is in
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());    // the key on the page, not typed in the prompt's field
  await page.keyboard.press('5');
  expect(await hashOf(page)).toBe('#flow');
  await prompt.getByLabel('Your name').fill('Ann');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toBeHidden();
  await page.keyboard.press('5');
  await expect(page.getByRole('tab', { name: 'Materials & steps' })).toHaveAttribute('aria-selected', 'true');
});

// P2-R69a: a held Enter acts once, wherever its first press puts the focus. Its press on the sheet's Close closes the sheet and hands the
// focus to the Shortcuts button; its repeat lands there, and must not press it, which would open the sheet again
test('a held Enter on the sheet\'s Close closes it once, and does not press the Shortcuts button the focus goes back to', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const button = page.getByRole('button', { name: 'Shortcuts', exact: true });
  const sheet = sheetOf(page);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');                                                   // the held key's repeat, on the Shortcuts button by now
  await page.keyboard.up('Enter');
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
});

// Phase 2 spec §14.1: Fit and Pause pipes say their key in their tips ("Fit · F") and in `aria-keyshortcuts`, which a screen reader says with
// the name: the tip says nothing more, so it describes nothing, and neither the name nor the key is heard twice (P2-D36)
test('the tips of Fit and Pause pipes give their keys, and describe nothing a screen reader has not said', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const toolbar = page.locator('.flow-toolbar');
  await toolbar.getByRole('button', { name: 'Zoom out' }).focus();
  for (const [name, tip] of [['Fit', 'Fit · F'], ['Pause pipes', 'Pause pipes · P']] as const) {
    await page.keyboard.press('Tab');
    const button = toolbar.getByRole('button', { name, exact: true });
    await expect(button).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(tip);
    await expect(button).not.toHaveAttribute('aria-describedby');
  }
});

// The Make-picker fix: below 900 px a project with no target opens the drawer by itself, the focus in the Make search, and every key typed
// there is the search's, the shortcuts' keys too (it is a field, and the drawer is open)
test('a project with no target opens the drawer into its search at 800 px, and keys typed there are typed', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Typed here');                                            // no target: the drawer opens by itself
  const search = page.locator('aside[aria-label="Project settings"]').getByPlaceholder('Search items and fluids');
  await expect(search).toBeFocused();
  for (const key of ['5', '?', '/', 'f', 'p']) await page.keyboard.press(key);
  await expect(search).toHaveValue('5?/fp');
  await expect(sheetOf(page)).toHaveCount(0);
  await expect(page.locator('#tab-flow')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-expanded', 'true');
});
