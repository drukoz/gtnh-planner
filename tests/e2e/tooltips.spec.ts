// The shared NEI tooltip (Phase 2 spec §6, Task 3a): one TooltipHost shows the `data-tip` of what the mouse rests on, in a box fixed in
// the window above every layer that never takes the pointer, one tip at a time. A tap shows it where the tap does nothing else, a long
// press anywhere (and the press then neither ticks nor picks), and Escape hides a tip before it closes anything. Task 3a puts it on the
// item icons; Task 3b gives the diagrams theirs (spec §6.7's cases 3 to 6).

import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, login, LV_CIRCUITS, setName, SETTINGS_BUTTON } from './helpers.ts';

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
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');                         // the tip's Escape, not the drawer's
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// Review Focus 2: a list that empties under a still pointer fires no pointerout, so the host notices its trigger has gone itself; a tip
// it missed would take the next Escape and keep the drawer open
test('a tip whose trigger goes away under a still pointer goes too, and never takes the next Escape', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Tip goes', LV_CIRCUITS);                                     // a target: the drawer does not open into the search
  const { toggle } = await openDrawer(page);
  const search = page.locator('aside[aria-label="Project settings"]').getByPlaceholder('Search items and fluids');
  await search.fill('Iron Ingot');
  await page.locator('[role=option] .item-icon').first().hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await search.fill('zzqxv');                                                            // no match: the list unmounts, the pointer stays
  await expect(tip).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

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
  test('a long-pressed tip whose trigger goes away goes too, the press picks nothing, and the next Escape is the drawer\'s', async ({ page }) => {
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
    await expect(tip).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText(/Make: Basic Circuit$/);                             // the long press picked nothing
  });
});
