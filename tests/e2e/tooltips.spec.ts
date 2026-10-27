// The shared NEI tooltip (Phase 2 spec §6, Task 3a): one TooltipHost shows the `data-tip` of what the mouse rests on, in a box fixed in
// the window above every layer that never takes the pointer, one tip at a time. A tap shows it where the tap does nothing else, a long
// press anywhere (and the press then neither ticks nor picks), and Escape hides a tip before it closes anything. Task 3a puts it on the
// item icons; Task 3b gives the diagrams' boxes and arrows theirs (spec §6.7's cases 3 to 6; on a touch screen a tap on a box or an arrow,
// which only picks, and a long press on a straight arrow, which shows its tip).

import { test, expect, type Locator, type Page } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import {
  createProject, escapesTaken, login, LV_CIRCUITS, markTips, openConnections, openWithPlan, recordEscapes, setName, SETTINGS_BUTTON,
} from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

/** Opens a new project that makes 30 Basic Circuits a minute on its Materials & steps tab, and gives the icons of its rows. */
async function materialIcons(page: Page, name: string): Promise<Locator> {
  await login(page); await setName(page, 'Ann');
  await createProject(page, name, LV_CIRCUITS);
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  const icons = page.locator('li.mat-row .item-icon');
  await expect(icons.first()).toBeVisible();
  return icons;
}

/** Whether the box of `tip` lies inside the 1280 × 720 window. */
const inWindow = (tip: Locator): Promise<boolean> => tip.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.left >= 0 && r.top >= 0 && r.right <= 1280 && r.bottom <= 720;
});

/** The Settings button of a narrow window and its drawer, opened. */
async function openDrawer(page: Page): Promise<{ toggle: Locator; settings: Locator }> {
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  const settings = page.locator('aside[aria-label="Project settings"]');
  await expect(settings).toBeVisible();
  return { toggle, settings };
}

/**
 * Whether `tip`'s box sits right of and below `trigger`, which the pointer rests on the middle of: 12 px past the pointer on both axes
 * (TIP_OFFSET, P2-D36), give or take a pixel, and the 2 px it rises in by.
 */
async function belowRightOf(tip: Locator, trigger: Locator): Promise<boolean> {
  const [t, r] = [await tip.boundingBox(), await trigger.boundingBox()];
  if (t === null || r === null) return false;
  const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
  return Math.abs(t.x - (x + 12)) <= 1.5 && t.y >= y + 12 - 1.5 && t.y <= y + 12 + 2 + 1.5;
}

test('an item icon shows its name in the NEI tooltip, which takes no pointer and goes when the pointer leaves', async ({ page }) => {
  const icon = (await materialIcons(page, 'Icon tip')).first();
  await expect(icon).not.toHaveAttribute('title');                                      // the native title is gone (spec §6.4)
  const name = await icon.getAttribute('aria-label');
  expect(name).toBeTruthy();
  await icon.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText(name!);
  await expect(tip).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => inWindow(tip)).toBe(true);
  await expect.poll(() => belowRightOf(tip, icon)).toBe(true);                         // right of and below the pointer, never above it
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
});

test('one tip at a time: the last icon pointed at', async ({ page }) => {
  const icons = await materialIcons(page, 'One tip');
  const [a, b] = [icons.nth(0), icons.nth(1)];
  const [nameA, nameB] = [await a.getAttribute('aria-label'), await b.getAttribute('aria-label')];
  expect(nameB).not.toBe(nameA);
  // the tip's first line, its title; strict, so two tips would fail it
  const title = page.getByRole('tooltip').locator(':scope > :first-child');
  await a.hover();
  await expect(title).toHaveText(nameA!);
  await b.hover();
  await expect(title).toHaveText(nameB!);
});

/** The top of `tip`'s box is at or below the bottom of `el`'s: an element tip sits below its element (spec §6.2). */
async function below(tip: Locator, el: Locator): Promise<boolean> {
  const [t, e] = [await tip.boundingBox(), await el.boundingBox()];
  return t !== null && e !== null && t.y >= e.y + e.height;
}

/** The middle of a Flow arrow on the screen: the point half way along its hit path (`hit`, a `path.flow-edge-hit`). */
function middleOf(hit: Locator): Promise<{ x: number; y: number }> {
  return hit.evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM() ?? undefined);
    return { x: screen.x, y: screen.y };
  });
}

/** Focuses `el` from the keyboard (`:focus-visible`): focused, then away and back with Shift+Tab and Tab. */
async function keyboardFocus(page: Page, el: Locator): Promise<void> {
  await el.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(el).toBeFocused();
}

// spec §6.7 (3), P2-D22: a box's tip is its words, one a line (the machine first, then its line, then what it takes and makes), and the
// press that hides it clears the Flow highlight too, for Flow's own Escape hears it whatever the tip did with it
test('a Flow box\'s tip lists its machine and what it takes, and Escape clears it with the highlight', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  await page.locator('[data-step-id="wire"] .flow-node-head').hover();                 // its rect.flow-hit lies over the box's rect
  const tip = page.getByRole('tooltip');
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Wiremill');
  await expect(tip.locator(':scope > div').filter({ hasText: 'takes Copper Ingot' })).toHaveCount(1);
  await expect(canvas).toHaveClass(/\bfocusing\b/);                                    // the hover lit the box
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(canvas).not.toHaveClass(/\bfocusing\b/);
});

// spec §6.7 (4), P2-D36: an arrow's tip says its good, its rate and its route, a line each; its name says the same words, so the tip does
// not describe it (ledger ruling P2-R24)
test('an arrow\'s tip has three lines', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const arrow = page.locator('[data-edge-id^="wire|out"]');
  const at = await middleOf(arrow.locator('path.flow-edge-hit'));
  await page.mouse.move(at.x, at.y);
  await expect(page.getByRole('tooltip').locator(':scope > div')).toHaveCount(3);
  await expect(arrow).not.toHaveAttribute('aria-describedby');
});

// spec §6.7 (5), §6.2, §6.6: a focus tip is its trigger's, at the element focused, below it, and describes that element while it shows
// with what it says beyond the element's name (ledger ruling P2-R24): a head is named by the box's title and line, so its description is
// the box's rows; a row is named by its own words, so its description is the rest of the box; a row shows its box's tip at the row
test('a step head focused from the keyboard shows its box\'s tip below it, described by it, and tabbing away clears both', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const tip = page.getByRole('tooltip');
  const title = tip.locator(':scope > :first-child');
  const box = page.locator('[data-step-id="wire"]');
  const head = box.locator('.flow-node-head');
  await keyboardFocus(page, head);
  await expect(title).toHaveText('Basic Wiremill');
  await expect.poll(() => below(tip, head)).toBe(true);
  const id = await tip.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(head).toHaveAttribute('aria-describedby', id!);
  await expect(head).toHaveAccessibleDescription(/takes Copper Ingot .*makes 1x Copper Wire/);
  await expect(head).not.toHaveAccessibleDescription(/Basic Wiremill|EU\/t/);
  await page.keyboard.press('Tab');                                                      // the box's first row
  const row = box.locator('.flow-row').first();
  await expect(row).toBeFocused();
  await expect(title).toHaveText('Basic Wiremill');                                       // the same box's tip, at the row
  await expect.poll(() => below(tip, row)).toBe(true);
  await expect(row).toHaveAttribute('aria-describedby', id!);
  await expect(row).toHaveAccessibleDescription(/Basic Wiremill.*makes 1x Copper Wire/);
  await expect(row).not.toHaveAccessibleDescription(/takes Copper Ingot/);
  await expect(head).not.toHaveAttribute('aria-describedby');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(row).not.toHaveAttribute('aria-describedby');
  // the canvas's first stop for the keyboard, and out of the canvas to the toolbar's last control, which has no tip
  const first = page.locator('svg.flow-canvas [tabindex="0"]').first();
  const words = await first.evaluate((el) => el.closest('[data-tip]')?.getAttribute('data-tip')?.split('\n')[0] ?? '');
  expect(words).not.toBe('');
  await keyboardFocus(page, first);
  await expect(title).toHaveText(words);
  await expect(first).toHaveAttribute('aria-describedby', id!);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('checkbox', { name: 'Imports in one column' })).toBeFocused();
  await expect(tip).toHaveCount(0);
  await expect(first).not.toHaveAttribute('aria-describedby');
});

// spec §6.2 (Task 3b's fix round, M1): an element tip sits at its element, so the element must be in the window too, not only in its svg's
// view: a focused head the page has scrolled out of the window shows no tip (it came back at the window's edge), and shows it again once
// the page brings the head back. A focus tip waits TIP_DELAY_MS (150 ms) after the scroll, so the check without one waits well past that
test('a focused head scrolled out of the window shows no tip until it is back', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const tip = page.getByRole('tooltip');
  const head = page.locator('[data-step-id="wire"] .flow-node-head');
  await keyboardFocus(page, head);                                                       // the keyboard's, so a focus by script is too
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Wiremill');
  await page.keyboard.press('Shift+Tab');                                                 // off the head, whose tip goes
  await expect(head).not.toBeFocused();
  // room to scroll; the head scrolled above the window and focused again where it is; a tip of the head shown meanwhile marks <html>
  const top = await head.evaluate((el) => {
    const room = document.createElement('div');
    room.style.height = '3000px';
    document.body.append(room);
    const html = document.documentElement;
    new MutationObserver(() => {
      const shown = document.querySelector('.nei-tooltip[role="tooltip"]')?.textContent ?? '';
      if (html.dataset['testPhase'] === 'away' && shown.startsWith('Basic Wiremill')) html.setAttribute('data-test-tip-away', '');
    }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    const y = scrollY;
    html.dataset['testPhase'] = 'away';
    scrollTo(0, y + el.getBoundingClientRect().bottom + 40);
    el.focus({ preventScroll: true });
    return y;
  });
  await expect(head).toBeFocused();
  expect(await head.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);             // above the window
  const since = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() - t > 600, since);
  await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-away');
  // back in the window, the head shows its tip below it again: the focus was a keyboard one all along
  await page.evaluate((y) => {
    document.documentElement.dataset['testPhase'] = 'back';
    scrollTo(0, y);
  }, top);
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Wiremill');
  await expect.poll(() => below(tip, head)).toBe(true);
});

// spec §6.7 (6): a Connections box's tip holds every text of the box in full, its conduit face's mode too (`In / Out`), and a press hides it
test('a Connections box\'s tip tells its texts in full, and a press hides it', async ({ page }) => {
  const view = await openConnections(page);
  await view.locator('.conn-machine > rect').first().hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('In / Out');
  await page.mouse.down();
  await expect(tip).toHaveCount(0);
});

test('under reduced motion a tip appears at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const icon = (await materialIcons(page, 'Still tip')).first();
  const tip = page.getByRole('tooltip');
  const duration = (): Promise<string> => tip.evaluate((el) => getComputedStyle(el).animationDuration);
  await icon.hover();
  await expect.poll(duration).toBe('0.001s');
  // without the preference it rises in over its 120 ms, so the check above is not vacuous
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await icon.hover();
  await expect.poll(duration).toBe('0.12s');
});

test('in the drawer the first Escape hides a tip, the second closes the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drawer tip', LV_CIRCUITS);                                   // a target: the drawer does not open by itself
  const { toggle, settings } = await openDrawer(page);
  await settings.locator('.settings-target .item-icon').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.evaluate(() => document.activeElement?.setAttribute('data-test-focused', ''));
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');                         // the tip's Escape, not the drawer's
  await expect(page.locator('[data-test-focused]')).toBeFocused();                       // and it leaves the focus where it was
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// Review Focus 2: a list that empties under a still pointer fires no pointerout, so the host notices its trigger has gone itself; a tip
// it missed would take the next Escape. Since ledger ruling P2-R138 the note the emptied search shows ("No item or fluid matches") is a layer of
// its own, as the list was: the next Escape is the note's, which goes, the drawer staying open and no layer having taken the key (a tip that
// had stayed would have taken it, and the note would stay); the Escape after it closes the drawer
test('a tip whose trigger goes away under a still pointer goes too, and never takes the next Escape', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Tip goes', LV_CIRCUITS);                                     // a target: the drawer does not open into the search
  const { toggle, settings } = await openDrawer(page);
  const search = settings.getByPlaceholder('Search items and fluids');
  await search.fill('Iron Ingot');
  await page.locator('[role=option] .item-icon').first().hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await search.fill('zzqxv');                                                            // no match: the list unmounts, the pointer stays
  // the list first, so the tip below goes because its trigger did (anything else that hid it earlier would leave the list open, and the
  // Escape would be the list's)
  await expect(page.getByRole('listbox', { name: 'Matches' })).toHaveCount(0);
  await expect(tip).toHaveCount(0);
  const note = settings.getByText('No item or fluid matches');
  await expect(note).toBeVisible();
  await recordEscapes(page);
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await escapesTaken(page), 'no layer took the note\'s Escape').toEqual([false]);
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// ledger ruling P2-R21 (spec §6.1, R15): one layer per press over a search list too: the first Escape hides the tip, and the list, which
// skips a key whose default was prevented, stays open until the second
test('over an open search list the first Escape hides the tip, the second closes the list', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Tip over a list', LV_CIRCUITS);
  const settings = page.locator('aside[aria-label="Project settings"]');
  const tip = page.getByRole('tooltip');
  // the item search's list, and the tip of one of its icons
  const search = settings.getByPlaceholder('Search items and fluids');
  await search.fill('Iron Ingot');
  const matches = settings.getByRole('listbox', { name: 'Matches' });
  await settings.locator('[role=option] .item-icon').first().hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(matches).toBeVisible();
  await expect(search).toBeFocused();                                                   // the tip's Escape leaves the focus where it was
  await page.keyboard.press('Escape');
  await expect(matches).toBeHidden();
  // the avoid box's list, and the tip of the target's icon above it
  const avoid = settings.getByRole('combobox', { name: 'Avoid a material' });
  await avoid.fill('copp');
  const materials = settings.getByRole('listbox', { name: 'Materials' });
  await expect(materials).toBeVisible();
  await settings.locator('.settings-target .item-icon').hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(materials).toBeVisible();
  await expect(avoid).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(materials).toBeHidden();
});

// ledger ruling P2-R21b (spec §6.1, R15): one layer per press, app-wide. With a tip showing, a field's first Escape only hides the tip and
// keeps what is being typed (and the focus); the second drops the draft. The amount and a cost here; a crop stat is the same kind of field,
// which the e2e pack, with no crop table, never draws (escape-layers.test.tsx reads every Escape handler)
test('a field keeps its draft through the Escape that hides a tip, and drops it on the next', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drafts', { ...LV_CIRCUITS, costOverrides: { 't:iron_ingot@0': 2 } });
  const settings = page.locator('aside[aria-label="Project settings"]');
  const tip = page.getByRole('tooltip');
  // the target's name comes with the pack's answer, and the icon's tip with it: a tip whose words change under a still pointer waits for it to
  // move, so the icon is pointed at once it names the target (on a cold server the name came during the hover)
  await expect(settings.locator('.settings-target .item-icon')).toHaveAttribute('data-tip', 'Basic Circuit');
  for (const [field, stored] of [[settings.getByLabel('Amount', { exact: true }), '30'], [settings.getByLabel('Cost of Iron Ingot'), '2']] as const) {
    await field.fill('2x');                                                             // a draft the field refuses, so nothing sends it
    await page.mouse.move(5, 5);                                                        // off the target's icon, which an Escape keeps quiet
    await settings.locator('.settings-target .item-icon').hover();
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await expect(field).toHaveValue('2x');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue(stored);
  }
});

// the same for the project's name: the first Escape hides the tip and leaves the edit; the second drops the edit, and the focus stays in the
// field (ledger ruling P2-R132, which reverses the blur this case pinned: the focus never falls to the page's body)
test('the project name keeps its edit through the Escape that hides a tip, and drops it on the next', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Named line', LV_CIRCUITS);
  const name = page.getByRole('textbox', { name: 'Project name' });
  const icon = page.locator('aside[aria-label="Project settings"] .settings-target .item-icon');
  await expect(icon).toHaveAttribute('data-tip', 'Basic Circuit');                      // named, as in the case above
  await name.fill('Renamed line');
  await icon.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(name).toHaveValue('Renamed line');
  await expect(name).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(name).toHaveValue('Named line');
  await expect(name).toBeFocused();
});

// the same for the map's note dialog: a modal, so no pointer reaches a trigger under it; a focus tip in it shows how its Escape waits (a
// tip on its Note field, given by the test, shown by the keyboard's focus)
test('the note dialog stays open through the Escape that hides a tip, and closes on the next', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const scanId = await uploadSampleWorld(page);
  await createProject(page, 'Note dialog');                                              // no line on the map, so the click is the note's
  await page.getByText('Map', { exact: true }).first().click();
  await page.getByLabel('World scan', { exact: true }).selectOption(scanId);
  // exact, as in world.spec.ts: the settings panel's "Only these come in" search is labelled "Add a base material"
  await page.getByLabel('Base', { exact: true }).selectOption({ label: 'Overworld base (4, 5)' });
  await page.getByRole('button', { name: 'Use this base' }).click();
  await expect(page.getByTestId('found-panel').getByTestId('machine-count')).toHaveText('6');
  const canvas = page.locator('canvas[role=img]');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('the map has no box');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.waitForFunction(() => {                                                   // the base centre's tile is drawn: a click picks its block
    const c = document.querySelector<HTMLCanvasElement>('canvas[role=img]');
    return c !== null && (c.getContext('2d')?.getImageData(c.width / 2, c.height / 2, 1, 1).data[3] ?? 0) > 0;
  });
  await page.mouse.click(centre.x, centre.y);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const note = dialog.getByLabel('Note');
  await note.evaluate((el) => el.setAttribute('data-tip', 'Write what to build here'));
  await note.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');                                               // back on the field from the keyboard: :focus-visible
  await expect(note).toBeFocused();
  const tip = page.locator('.nei-tooltip[role="tooltip"]');                            // the shared tip, not the map's own
  await expect(tip).toHaveText('Write what to build here');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(note).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

// and the tip itself is a layer like the others: a key that a layer above it has taken (prevented on its way down) leaves the tip
test('a tip stays when a layer above it has taken the Escape', async ({ page }) => {
  const icon = (await materialIcons(page, 'Layer above')).first();
  await icon.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset['claimEscape'] = 'yes';
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.documentElement.dataset['claimEscape'] === 'yes') e.preventDefault();
    }, true);
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));   // a hide is drawn
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('data-state', 'open');
  await page.evaluate(() => { document.documentElement.dataset['claimEscape'] = 'no'; });
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
});

// spec §6.2 (the fix round's I2): an element out of its svg's view shows no tip, not even for a frame (its box is never put in the page),
// and one that leaves the view between its tip showing and the tip being laid out is dropped as it is, before the page is painted, with no
// fade. A finger's long press shows an element tip at once when the browser's own long press (its context menu) comes first, so the presses
// below, synthetic touch pointer events on three triggers of an svg of the test's own that draws past its edge, each in a task of its own,
// show their tips at once: one out of the svg's view, one that leaves it in the same task, and one in it (the control)
test('a tip whose element is out of its svg\'s view is never drawn, not even for a frame', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Out of view', LV_CIRCUITS);
  await expect(page.getByRole('tab', { name: 'Flow' })).toBeVisible();
  await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    svg.style.cssText = 'position: fixed; left: 300px; top: 300px; overflow: visible; z-index: 99';
    for (const [id, tip, x] of [['out-of-view', 'Out of view', 200], ['leaves-view', 'Leaves view', 10], ['in-view', 'In view', 50]] as const) {
      const g = document.createElementNS(NS, 'g');
      g.id = id;
      g.setAttribute('data-tip', tip);
      g.setAttribute('transform', `translate(${x} 10)`);
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('width', '20');
      rect.setAttribute('height', '20');
      g.append(rect);
      svg.append(g);
    }
    document.body.append(svg);
    // what the page's tips did: a box put in the page at all (`added`), and one still there once a task's changes have settled (`seen`)
    const mark = (what: string): void => document.documentElement.setAttribute(`data-test-${what}`, '');
    const words = (el: Element | null): string => (el?.matches('.nei-tooltip') === true ? el.textContent ?? '' : '');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (words(node).includes('Out of view')) mark('out-of-view-added');
          if (words(node).includes('Leaves view')) mark('leaves-view-added');
        }
      }
      const shown = words(document.querySelector('.nei-tooltip'));
      if (shown.includes('Out of view')) mark('out-of-view-seen');
      if (shown.includes('Leaves view')) mark('leaves-view-seen');
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  /** A finger's long press on trigger `id`: down, the browser's long press, `moveTo` (a transform) in the same task, and up. */
  const longPress = (id: string, moveTo: string | null = null): Promise<void> => page.evaluate(([id, moveTo]) => {
    const g = document.getElementById(id);
    const rect = g?.firstElementChild;
    if (g === null || rect === null || rect === undefined) throw new Error(`no trigger ${id}`);
    const at = rect.getBoundingClientRect();
    const init: PointerEventInit = {
      bubbles: true, cancelable: true, composed: true, pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: at.left + 2, clientY: at.top + 2,
    };
    rect.dispatchEvent(new PointerEvent('pointerdown', init));
    rect.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true }));
    if (moveTo !== null) g.setAttribute('transform', moveTo);
    rect.dispatchEvent(new PointerEvent('pointerup', init));
  }, [id, moveTo] as const);
  await longPress('out-of-view');                                                       // out of the svg's view as its tip would show
  await longPress('leaves-view', 'translate(300 10)');                                  // in it as its tip shows, out before it is laid out
  await longPress('in-view');                                                            // the control: in view, its tip shows
  await expect(page.getByRole('tooltip')).toHaveText('In view');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-test-out-of-view-added');               // show() drew nothing
  await expect(html).toHaveAttribute('data-test-leaves-view-added');                   // this one was drawn, so place() had it to lay out ...
  await expect(html).not.toHaveAttribute('data-test-leaves-view-seen');                // ... and dropped it before the page was painted
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  // ledger ruling P2-R20 (spec §6.1): where a tap acts it only acts, on a trigger inside what acts too: a search option picks on a tap
  test('a tap on a search option\'s icon picks it, and no tip shows at any point', async ({ page }) => {
    await login(page); await setName(page, 'Ann');
    await createProject(page, 'Tap picks', LV_CIRCUITS);
    await markTips(page);
    const settings = page.locator('aside[aria-label="Project settings"]');
    await settings.getByPlaceholder('Search items and fluids').fill('Iron Ingot');
    await settings.locator('[role=option] .item-icon').first().tap();
    await expect(settings.locator('.settings-target-name')).toHaveText('Iron Ingot');                // it picked
    await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-seen');                    // and no tip showed, not even for a frame
  });

  test('a tap shows an icon\'s tip, a second tap or a tap elsewhere hides it', async ({ page }) => {
    const icon = (await materialIcons(page, 'Tap tip')).first();
    const tip = page.getByRole('tooltip');
    await icon.tap();
    await expect(tip).toBeVisible();
    await icon.tap();
    await expect(tip).toHaveCount(0);
    await icon.tap();
    await expect(tip).toBeVisible();
    await page.locator('#to-build-title').tap();
    await expect(tip).toHaveCount(0);
  });

  // P2-D21: a long press shows the tip of what it is on, whatever that does on a tap; the click it may bring is the press's own, and the
  // host lets go of it in time, so the next tap acts
  test('a long press on an icon shows its tip, and the next tap still acts', async ({ page }) => {
    const icon = (await materialIcons(page, 'Long press')).first();
    const box = await icon.boundingBox();
    if (box === null) throw new Error('the icon has no box');
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Chromium sends a click as the finger lifts after a long press: it must never reach what was pressed (the mark goes on <html>, which
    // outlives the Materials tab)
    await icon.evaluate((el) => el.addEventListener('click', () => document.documentElement.setAttribute('data-test-icon-clicked', '')));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await expect(page.getByRole('tooltip')).toBeVisible();                               // polled while the finger is down
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const flow = page.getByRole('tab', { name: 'Flow' });
    await flow.tap();
    await expect(flow).toHaveAttribute('aria-selected', 'true');
    // the press's own click came before the tap (the input is handled in order), so once the tap has acted it would have marked the page
    await expect(page.locator('html')).not.toHaveAttribute('data-test-icon-clicked');
  });

  // Review Focus 2 again, for a tip no pointer event takes away: a long press's. Chromium sends the mouse a pointerover on what is under it
  // once a list empties, which hides a hovered tip; a finger's tip goes only because the host watches its trigger every frame
  test('a long-pressed tip whose trigger goes away goes too, the press picks nothing, and the next Escapes close the emptied search\'s note, then the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await login(page); await setName(page, 'Ann');
    await createProject(page, 'Pressed tip goes', LV_CIRCUITS);
    const { toggle, settings } = await openDrawer(page);
    const search = settings.getByPlaceholder('Search items and fluids');
    await search.fill('Iron Ingot');
    const box = await page.locator('[role=option] .item-icon').first().boundingBox();
    if (box === null) throw new Error('the option has no icon');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await search.fill('zzqxv');                                                            // no match: the list unmounts
    await expect(settings.getByRole('listbox', { name: 'Matches' })).toHaveCount(0);      // the list first, as above
    await expect(tip).toHaveCount(0);
    // the emptied search's note is a layer (ledger ruling P2-R138): its Escape first, taken by no layer, then the drawer's, as above
    const note = settings.getByText('No item or fluid matches');
    await expect(note).toBeVisible();
    await recordEscapes(page);
    await page.keyboard.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await escapesTaken(page), 'no layer took the note\'s Escape').toEqual([false]);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText(/Make: Basic Circuit$/);                             // the long press picked nothing
  });

  // Fix round 1 of Task 11 (ledger ruling P2-R87): a tip whose trigger comes inside an inert layer goes. A finger's tip stays until the next
  // tap; at 800 px the drawer makes the page behind it inert, and a tip a long press showed on Fit before the drawer opened goes as it opens
  test('at 800 px a long-pressed tip goes as the drawer makes the page behind it inert', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openWithPlan(page, circuitLv());                                            // a target: the drawer stays shut until asked
    const fit = page.locator('.tab-panel').getByRole('button', { name: 'Fit', exact: true });
    const box = (await fit.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    const tip = page.getByRole('tooltip');
    await expect(tip).toHaveText('Fit · F');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('.settings-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(tip).toHaveCount(0);
  });

  // spec §6.1, P2-D21: a diagram picks on a tap, so a tap on an svg trigger only acts; a long press or the focus shows a box's tip
  test('a tap on a Flow box picks it and shows no tip', async ({ page }) => {
    await openWithPlan(page, circuitLv());
    await markTips(page);
    await page.locator('[data-step-id="wire"] .flow-node-head').tap();
    await expect(page.getByRole('complementary', { name: 'Step: Basic Wiremill' })).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-seen');                    // not even for a frame
  });

  // the same for what acts only because it is in a diagram: a box's head is a button, which acts anyway, but an arrow has no role, so the
  // svg rule alone keeps its tap a pick (it lights the arrow) with no tip
  test('a tap on a Flow arrow lights it and shows no tip', async ({ page }) => {
    await openWithPlan(page, circuitLv());
    await markTips(page);
    const arrow = page.locator('[data-edge-id^="wire|out"]');
    const at = await middleOf(arrow.locator('path.flow-edge-hit'));
    await page.touchscreen.tap(at.x, at.y);
    await expect(arrow).toHaveClass(/\bhl\b/);                                                       // it picked the arrow
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-seen');
  });

  // P2-D21: a finger sees an arrow's tip by a long press, the one way it has (a tap picks the arrow, and an arrow takes no focus), straight
  // arrows too: one drawn level with its rows has a box with no height, a line, which is in the diagram's view all the same (spec §6.2)
  test('a long press on a straight Flow arrow shows its tip', async ({ page }) => {
    await openWithPlan(page, circuitLv());
    // the first arrow that runs straight, found by measuring: its box has a length and no height
    const id = await page.evaluate(() => [...document.querySelectorAll('svg.flow-canvas .flow-edge')].find((g) => {
      const box = g.getBoundingClientRect();
      return box.width > 0 && box.height === 0;
    })?.getAttribute('data-edge-id') ?? null);
    expect(id, 'an arrow of the plan runs straight').not.toBeNull();
    const arrow = page.locator(`[data-edge-id="${id}"]`);
    expect(await arrow.evaluate((g) => g.getBoundingClientRect().height)).toBe(0);               // it runs straight: its box is a line
    const name = await arrow.evaluate((g) => g.getAttribute('data-tip')?.split('\n')[0] ?? '');
    const at = await middleOf(arrow.locator('path.flow-edge-hit'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    const tip = page.getByRole('tooltip');
    await expect(tip.locator(':scope > div')).toHaveCount(3);                                       // polled while the finger is down
    await expect(tip.locator(':scope > :first-child')).toHaveText(name);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});

// ledger ruling P2-R69a, its order (F3 fix round 5): the held-Enter guard is the first capture listener on the document (main.tsx installs it
// before React mounts), so the tooltip's own key listener, added as its host mounts, reads what the guard prevented. A held Enter on a step
// panel's Close hands the focus back to the box head that opened it (P2-R36), a tip's trigger: the repeat that lands there is no press on it, so
// it does not quiet the head, and the head's tip shows from the keyboard's focus
test('a held Enter whose first press hands the focus to a box head leaves the head\'s tip to show', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const head = page.locator('[data-step-id="circuit-lv"] .flow-node-head');
  await keyboardFocus(page, head);
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Step: Basic Assembler' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.down('Enter');
  await expect(panel).toHaveCount(0);
  await expect(head).toBeFocused();
  await page.keyboard.down('Enter');                                                      // the held key repeats, on the head
  await page.keyboard.up('Enter');
  const tip = page.getByRole('tooltip');
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Assembler');
  await expect(head).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!);
  await expect(panel).toHaveCount(0);
});

// the final fix wave, FW-4 (ledger ruling P2-R131; WCAG 1.4.10): a tip is at most as wide as the window, `min(360px, 100%)` (a fixed box's
// containing block is the window), so a long one in a 320 px window wraps inside it instead of losing its right edge past the window's (an
// element tip is kept inside the window while it fits: placeTip)
test('a long tip in a 320 px window stays inside it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Narrow tip', LV_CIRCUITS);                                  // a target: no drawer opens by itself
  const name = page.getByRole('textbox', { name: 'Project name' });
  await name.evaluate((el) => el.setAttribute('data-tip', 'A tip as long as a sentence that runs on and on, so that its box is as wide as a tip may ever be'));
  await name.focus();
  const tip = page.locator('.nei-tooltip[role="tooltip"]');
  await expect(tip).toBeVisible();
  const box = (await tip.boundingBox())!;
  const room = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.x, 'from the window\'s left edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'to its right edge').toBeLessThanOrEqual(room);
});
