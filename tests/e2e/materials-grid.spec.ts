// "To build (once)" as an inventory grid (Phase 2 spec §9, D9), in a browser: the List is the default and stays the source of truth; Grid is
// chosen with the head's toggle, one choice for this browser (localStorage), which outlives the tab panel's remount on every tab switch and a
// reload, and a new browser starts on the List again. A slot is a 36 px Minecraft slot; the first stack of an item is its one checkbox, which
// ticks the row's one mark (the List's tick, and every other page's within the stream's 2 s), from the mouse, the keyboard or a tap, while a
// long press shows the slot's NEI tip and ticks nothing (P2-D21), and a tap only ticks (P2-R20). An item past nine stacks ends in a +N slot out of
// the tab order that ticks the same row. In forced colours the slots, the tick, the meter and the pressed toggle keep a cue, and a slot's frame
// is painted over its icon (P2-R41: read in the screen's pixels). materials.test.tsx pins the markup and the model, styles-contract.test.tsx the
// rules.

import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Plan } from '../../src/shared/types/plan.ts';
import { createProject, login, LV_CIRCUITS, markTips, setName } from './helpers.ts';

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

/** The colours the screen shows at `points` (viewport px, the page at a device scale of 1), read from a screenshot of the page. */
async function painted(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<string[]> {
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return page.evaluate(async ([data, at]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    return at.map(([x, y]) => {
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    });
  }, [png.toString('base64'), points] as const);
}

/** What a system colour of the theme computes to on the page (`CanvasText`, `Canvas` …). */
const systemColour = (page: Page, name: string): Promise<string> => page.evaluate((colour) => {
  const probe = document.createElement('span');
  probe.style.color = colour;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, name);

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

  // ledger ruling P2-R20 (spec §6.1): where a tap acts it only acts. A slot is a button, so a plain tap on a slot nothing has touched yet ticks
  // its row, and no tip shows at any point, not even for a frame (3a's markTips)
  test('a tap on an untouched slot ticks its row, and no tip shows at any point', async ({ page }) => {
    await openMaterials(page, 'Grid tap');
    await showGrid(page);
    const slot = firstSlot(page);
    await expect(slot).toHaveAttribute('data-marked', 'false');
    await markTips(page);
    await slot.tap();
    await expect(slot).toHaveAttribute('data-marked', 'true');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-test-tip-seen');
  });
});

// spec §9.1, §9.2: an item past nine stacks ends in a +N slot that says how many more there are; like the item's other stacks it is a hidden
// copy, out of the tab order, and it ticks the same row
test('the +N slot of an item past nine stacks is out of the tab order, and a click on it ticks the row', async ({ page }) => {
  const id = await openMaterials(page, 'Grid more');
  // the server's own plan, its power line at 1,000: sixteen stacks, nine drawn and a +7 slot
  const plan = (await (await page.request.get(`/api/projects/${id}/plan`)).json()) as Plan;
  const power = plan.buildList.find((line) => line.group === 'power');
  if (power === undefined) throw new Error('the plan has no power line');
  const big = { ...plan, buildList: plan.buildList.map((line) => (line === power ? { ...line, amount: 1000 } : line)) };
  await page.route(`**/api/projects/${id}/plan`, (route) => route.fulfill({ json: big }));
  await page.reload();
  await expect(toBuild(page).locator('li.mat-row').first()).toBeVisible();
  await showGrid(page);
  const row = `build:${power.key}`;
  const more = page.locator(`button.mat-slot-more[data-stack-of="${row}"]`);
  await expect(more).toHaveText('+7');
  await expect(more).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator(`button.mat-slot[data-stack-of="${row}"]`)).toHaveCount(9);   // the eight other stacks drawn, and the +7 slot
  // Tab goes from the item's one checkbox to the next item's: its other stacks and the +7 slot are passed over
  const checkbox = page.locator(`button.mat-slot[data-row="${row}"]`);
  await checkbox.focus();
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => [document.activeElement?.getAttribute('role'), document.activeElement?.getAttribute('data-row')]);
  expect(next[0]).toBe('checkbox');
  expect(next[1]).not.toBe(row);
  // a click on it ticks the row, and every stack of it shows that
  await more.click();
  await expect(checkbox).toHaveAttribute('data-marked', 'true');
  await expect(more).toHaveClass(/\bmarked\b/);
  await expect(page.locator(`button.mat-slot[data-stack-of="${row}"]:not(.marked)`)).toHaveCount(0);
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
  // what the screen shows (ledger ruling P2-R41): the frame is painted over the slot's own icon, whose face, the theme's canvas, fills the slot,
  // so its edge pixels are the theme's text colour, and the face just inside them is not. A computed outline cannot tell that: one under the
  // icon computes the same
  await page.locator('#to-build-title').hover();                                        // no veil on the slot, no tip over it
  const box = await slot.boundingBox();
  if (box === null) throw new Error('the slot has no box');
  const [left, top, right, inside] = await painted(page, [
    [Math.round(box.x), Math.round(box.y + box.height / 2)], [Math.round(box.x + box.width / 2), Math.round(box.y)],
    [Math.round(box.x + box.width) - 1, Math.round(box.y + box.height / 2) - 6], [Math.round(box.x) + 1, Math.round(box.y + box.height / 2)],
  ]);
  const canvasText = await systemColour(page, 'CanvasText');
  expect({ left, top, right }, 'the frame\'s edge pixels').toEqual({ left: canvasText, top: canvasText, right: canvasText });
  expect(inside, 'the face just inside the frame').not.toBe(canvasText);
  // out of forced colours a slot has no frame, its bevel draws it, and the pressed toggle reads by its sunk face and yellow: the
  // forced-colours block is what drew the cues above (an outline's width stays `medium` with no style: CSS UI 4 no longer zeroes it)
  await page.emulateMedia({ forcedColors: 'none' });
  expect(new Set((await frames()).map((frame) => frame.split(' ')[0]))).toEqual(new Set(['none']));
  await expect(viewButton(page, 'Grid')).toHaveCSS('text-decoration-line', 'none');
});
