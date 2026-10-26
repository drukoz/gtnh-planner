// Keyboard shortcuts (Phase 2 spec §14, D16; Task 11): on a project page `/` focuses the item search (below 900 px it opens the drawer into it),
// 1–6 switch the tabs and hand the focus to the one selected, F fits the diagram shown and P pauses or plays its pipes (on a diagram's tab only),
// and ? opens a sheet that lists them, as the head's Shortcuts button does above 900 px (plan ruling shortcuts-button-wide). A key typed in a
// field is typed, and no key is a shortcut while the drawer, the sheet or another modal is open, nor inside an in-app confirm (ledger ruling
// P2-R73). The sheet is the top layer: #root is inert behind it, Escape closes it alone (P2-D22) and the focus goes back to what had it, else
// to the Shortcuts button, else to the selected tab (P2-R71), never to the page's body; the toasts wait it out as they wait out the drawer
// (P2-R72). Every project here has a target, so no drawer opens by itself, but in the last case, where that drawer is what it tests.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { bodyFocusCount, createProject, login, LV_CIRCUITS, noDialogs, openConnections, openWithPlan, setName, SETTINGS_BUTTON, watchBodyFocus } from './helpers.ts';

/** The sheet, by its role and its title. */
const sheetOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Keyboard shortcuts' });
/** The diagram's Fit, in the tab panel shown. */
const fitOf = (page: Page): Locator => page.locator('.tab-panel').getByRole('button', { name: 'Fit', exact: true });
/** The page's hash, which a digit sets as it is pressed: read at once, it says whether the key switched the tab. */
const hashOf = (page: Page): Promise<string> => page.evaluate(() => location.hash);

/** A finger's long press on `target`, held until its tip reads `tip`, then lifted (in a context with touch: the tip stays until the next tap). */
async function longPressTip(page: Page, target: Locator, tip: string): Promise<void> {
  const box = (await target.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(page.getByRole('tooltip')).toHaveText(tip);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('5 selects Materials & steps and moves the focus to it', async ({ page }) => {
  await openWithPlan(page, circuitLv());
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
  const button = page.getByRole('button', { name: 'Shortcuts' });
  await fit.focus();
  await watchBodyFocus(page);
  await page.keyboard.press('?');
  await expect(sheet).toBeVisible();
  await expect(close).toBeFocused();
  // its rows, and the page behind it out of reach
  await expect(sheet.locator('dt')).toHaveCount(6);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  // the keyboard stays with it: Tab and Shift+Tab keep the focus on Close, its one control, and so does a press on its words, so the Escape
  // after them is still the sheet's
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await sheet.getByText('Fit the diagram').click();
  await expect(close).toBeFocused();
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
  await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
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
    head.getByLabel('Project name', { exact: true }), head.getByRole('button', { name: 'Compare modes' }), head.getByRole('button', { name: 'Shortcuts' }),
    confirm,
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
  await expect(hint).toHaveText(/ \? shows the shortcuts\.$/);
  expect(await hintHeight(hint)).toBe(HINT_LINE);
});

test('the Connections hint ends with the shortcuts and is as tall as at fc87ab8, at 1280 x 720 and 1440 x 900 (P2-R84)', async ({ page }) => {
  const view = await openConnections(page);
  const hint = page.locator('.conn-toolbar > span');
  await expect(hint).toHaveText(/ \? shows the shortcuts\.$/);
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

// P2-R72: while the sheet is open the toasts behind it wait, as they wait out the drawer (P2-R56, P2-R56a): a toast drawn before it stays,
// its time held, and runs out once the sheet has closed. The page's clock is faked, so its 5 s are run at once
test('the sheet holds the toasts as the drawer does: a toast drawn before it keeps its time until it closes', async ({ page }) => {
  await page.clock.install();
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Sheet toasts', LV_CIRCUITS);
  const field = page.getByRole('textbox', { name: 'Project name' });
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
  const button = page.getByRole('button', { name: 'Shortcuts' });
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
