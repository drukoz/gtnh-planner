// "To build (once)" as an inventory grid (Phase 2 spec §9, D9), in a browser: the List is the default and stays the source of truth; Grid is
// chosen with the head's toggle, one choice for this browser (localStorage), which outlives the tab panel's remount on every tab switch and a
// reload, and a new browser starts on the List again. A slot is a 36 px Minecraft slot; the first stack of an item is its one checkbox, which
// ticks the row's one mark (the List's tick, and every other page's within the stream's 2 s), from the mouse, the keyboard or a tap, while a
// long press shows the slot's NEI tip and ticks nothing (P2-D21). In forced colours the slots, the tick, the meter and the pressed toggle keep
// a cue. materials.test.tsx pins the markup and the model, styles-contract.test.tsx the rules.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, login, LV_CIRCUITS, setName } from './helpers.ts';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** The "To build (once)" section of the Materials tab. */
const toBuild = (page: Page): Locator => page.locator('section[aria-labelledby="to-build-title"]');
/** A button of the section's Grid / List toggle. */
const viewButton = (page: Page, name: 'Grid' | 'List'): Locator => toBuild(page).getByRole('button', { name, exact: true });
/** The first slot of the grid: the first stack of its first item, the item's one checkbox. */
const firstSlot = (page: Page): Locator => page.locator('[data-row^="build:"][role=checkbox]').first();

/** Logs the page in as Ann and opens a new project of the server's own plan (LV_CIRCUITS, which has a build list) on its Materials tab. */
async function openMaterials(page: Page, name: string): Promise<string> {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, name, LV_CIRCUITS);
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  await expect(toBuild(page).locator('li.mat-row').first()).toBeVisible();
  return id;
}

/** Shows the build list as the grid, and waits for its slots. */
async function showGrid(page: Page): Promise<void> {
  await viewButton(page, 'Grid').click();
  await expect(viewButton(page, 'Grid')).toHaveAttribute('aria-pressed', 'true');
  await expect(firstSlot(page)).toBeVisible();
}

test('List by default; Grid draws 36 px slots, survives a tab switch and a reload, and a new browser shows List', async ({ page, browser }) => {
  await openMaterials(page, 'Grid view');
  await expect(toBuild(page).locator('li.mat-row').first()).toBeVisible();
  await expect(page.locator('button.mat-slot')).toHaveCount(0);
  await expect(viewButton(page, 'List')).toHaveAttribute('aria-pressed', 'true');
  // the toggle stands into the room round the title's line: the head is as tall as the title, so the List's rows stay where they were
  const [head, title] = await page.evaluate(() => ['.mat-head', '#to-build-title'].map((selector) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0));
  expect(title).toBeGreaterThan(20);
  expect(head).toBe(title);
  await showGrid(page);
  await expect(toBuild(page).locator('li.mat-row')).toHaveCount(0);
  const boxes = await page.locator('button.mat-slot').evaluateAll((slots) => slots.map((slot) => {
    const box = slot.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) expect(box).toEqual({ width: 36, height: 36 });
  // the tab panel remounts on every tab switch: the choice is this browser's, not the panel's
  await page.getByRole('tab', { name: 'Flow' }).click();
  await expect(page.locator('svg.flow-canvas')).toBeVisible();
  await expect(toBuild(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  await expect(viewButton(page, 'Grid')).toHaveAttribute('aria-pressed', 'true');
  await expect(firstSlot(page)).toBeVisible();
  await page.reload();
  await expect(viewButton(page, 'Grid')).toHaveAttribute('aria-pressed', 'true');
  await expect(firstSlot(page)).toBeVisible();
  // a new browser keeps nothing of this one's: the List
  const other = await browser.newContext();
  try {
    const fresh = await other.newPage();
    await login(fresh); await setName(fresh, 'Bob');
    await fresh.goto(page.url());
    await expect(toBuild(fresh).locator('li.mat-row').first()).toBeVisible();
    await expect(viewButton(fresh, 'List')).toHaveAttribute('aria-pressed', 'true');
    await expect(fresh.locator('button.mat-slot')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('a slot ticks its row, which the List shows ticked', async ({ page }) => {
  await openMaterials(page, 'Grid tick');
  await showGrid(page);
  const slot = firstSlot(page);
  const row = await slot.getAttribute('data-row');
  await expect(slot).toHaveAttribute('data-marked', 'false');
  await slot.click();
  await expect(slot).toHaveAttribute('data-marked', 'true');
  await expect(slot).toHaveAttribute('aria-checked', 'true');
  await viewButton(page, 'List').click();
  await expect(toBuild(page).locator(`div.tick[data-row="${row}"]`)).toHaveAttribute('data-marked', 'true');
});

test('a tick in the grid reaches another browser within 2 s', async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  try {
    const pa = await a.newPage(); const pb = await b.newPage();
    await login(pa); await setName(pa, 'Ann'); await login(pb); await setName(pb, 'Jörg 🙂');
    const id = await createProject(pa, 'Grid shared', LV_CIRCUITS);
    for (const p of [pa, pb]) { await p.goto(`/p/${id}#materials`); await expect(toBuild(p).locator('li.mat-row').first()).toBeVisible(); }
    await showGrid(pa);                                                                // B keeps the List: the choice is A's browser's
    const slot = firstSlot(pa);
    const tick = toBuild(pb).locator(`div.tick[data-row="${await slot.getAttribute('data-row')}"]`);
    await expect(tick).toHaveAttribute('data-marked', 'false');
    await slot.click();
    await expect(tick).toHaveAttribute('data-marked', 'true', { timeout: 2000 });
    await expect(tick).toContainText('Ann');
  } finally {
    await a.close(); await b.close();
  }
});

test('Space ticks a focused slot, which rings in the panel\'s focus ink', async ({ page }) => {
  await openMaterials(page, 'Grid keys');
  await showGrid(page);
  const slot = firstSlot(page);
  // entered by the keyboard, so it is :focus-visible (focus.spec.ts: off the slot and back onto it)
  await slot.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(slot).toBeFocused();
  await page.keyboard.press('Space');
  await expect(slot).toHaveAttribute('aria-checked', 'true');
  // the 3 px ring of the page in the panel's near black (the yellow would be 1.6:1 on the light panel, R12)
  expect(await slot.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.outlineColor, width: style.outlineWidth, style: style.outlineStyle };
  })).toEqual({ color: 'rgb(27, 27, 27)', width: '3px', style: 'solid' });
});

test('pointing at or focusing a slot shows its tip with the item\'s name', async ({ page }) => {
  await openMaterials(page, 'Grid tips');
  await showGrid(page);
  const slot = firstSlot(page);
  const name = (await slot.getAttribute('data-tip'))?.split('\n')[0] ?? '';
  expect(name, 'the slot\'s tip starts with the item\'s name').not.toBe('');
  const tip = page.getByRole('tooltip');
  await slot.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(name);
  await expect(tip.locator(':scope > :first-child')).toHaveText(name);
  // the pointer leaves it for words that are no trigger, and the tip goes; then the keyboard comes to the slot
  await page.locator('#to-build-title').hover();
  await expect(tip).toHaveCount(0);
  await slot.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(slot).toBeFocused();
  await expect(tip).toBeVisible();
  await expect(tip.locator(':scope > :first-child')).toHaveText(name);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  // P2-D21: a long press shows the tip of what it is on, whatever a tap on it does, and its own click (Chromium may send one as the finger
  // lifts) never ticks; the host lets go of that guard at the next press, so the next tap ticks
  test('a long press on a slot shows its tip and does not tick it, and the next tap does', async ({ page }) => {
    await openMaterials(page, 'Grid long press');
    await showGrid(page);
    const slot = firstSlot(page);
    await expect(slot).toHaveAttribute('data-marked', 'false');
    // every click that reaches the slot is counted on <html>: the long press's own must not be one of them
    await slot.evaluate((el) => el.addEventListener('click', () => {
      const html = document.documentElement;
      html.dataset.testSlotClicks = String(Number(html.dataset.testSlotClicks ?? '0') + 1);
    }));
    const box = await slot.boundingBox();
    if (box === null) throw new Error('the slot has no box');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await expect(page.getByRole('tooltip')).toBeVisible();                                 // polled while the finger is down
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(slot).toHaveAttribute('data-marked', 'false');
    await slot.tap();
    await expect(slot).toHaveAttribute('data-marked', 'true');
    // input is handled in order: once the tap has ticked, a click of the long press's would have reached the slot before it, and untick it
    await expect(page.locator('html')).toHaveAttribute('data-test-slot-clicks', '1');
  });
});

test('in forced colours the slots, the tick, the meter and the pressed toggle keep a cue', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openMaterials(page, 'Grid forced');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);
  await showGrid(page);
  const slot = firstSlot(page);
  await slot.click();
  await expect(slot).toHaveAttribute('data-marked', 'true');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());   // a focused slot shows its ring in place of the frame
  /** What a slot computes: its outline, which in forced colours is the frame its dropped bevel leaves it. */
  const frames = (): Promise<string[]> => page.locator('button.mat-slot').evaluateAll((slots) => slots.map((el) => {
    const style = getComputedStyle(el);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  }));
  expect(new Set(await frames())).toEqual(new Set(['solid 1px']));
  // the tick and the meter's fill are a colour of their own: not transparent, and not the colour of what they lie on
  const paint = await slot.evaluate((el) => {
    /** The nearest background up from `from` that is not transparent. */
    const under = (from: Element | null): string => {
      let colour = 'rgba(0, 0, 0, 0)';
      for (let at = from; at !== null && colour === 'rgba(0, 0, 0, 0)'; at = at.parentElement) colour = getComputedStyle(at).backgroundColor;
      return colour;
    };
    const tick = el.querySelector('.mat-slot-tick');
    const meter = document.querySelector('.mat-meter');
    const fill = document.querySelector('.mat-meter-fill');
    if (tick === null || meter === null || fill === null) throw new Error('no tick or no meter');
    return {
      tick: getComputedStyle(tick, '::before').backgroundColor, slot: under(el), face: getComputedStyle(el.querySelector('.item-icon')!).backgroundColor,
      fill: getComputedStyle(fill).backgroundColor, meter: under(meter),
    };
  });
  expect(paint.tick).not.toBe(TRANSPARENT);
  expect(paint.tick, 'the tick is not the colour of the slot').not.toBe(paint.slot);
  expect(paint.tick, 'the tick is not the colour of the slot\'s face').not.toBe(paint.face);
  expect(paint.fill).not.toBe(TRANSPARENT);
  expect(paint.fill, 'the fill is not the colour of the meter').not.toBe(paint.meter);
  await expect(viewButton(page, 'Grid')).toHaveCSS('text-decoration-line', 'underline');
  // out of forced colours a slot has no frame, its bevel draws it, and the pressed toggle reads by its sunk face and yellow: the
  // forced-colours block is what drew the cues above (an outline's width stays `medium` with no style: CSS UI 4 no longer zeroes it)
  await page.emulateMedia({ forcedColors: 'none' });
  expect(new Set((await frames()).map((frame) => frame.split(' ')[0]))).toEqual(new Set(['none']));
  await expect(viewButton(page, 'Grid')).toHaveCSS('text-decoration-line', 'none');
});
