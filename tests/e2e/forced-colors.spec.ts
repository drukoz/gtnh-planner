// Forced colours, a Windows contrast theme (final review I1, design spec §6): the browser paints every background in the theme's Canvas
// colour and drops every shadow, so the restyle's custom ticks, radios and carets, drawn with those alone, vanished there, and with them
// whether a box was ticked. The stylesheet repaints them in system colours (styles-contract.test.tsx pins the block). Chromium's emulation
// of forced colours says what the browser computes: an edge round every tick and radio, a mark in a colour of its own on a ticked one only,
// and carets that are not the colour of what they sit on. A picked map row keeps the focus ring the keyboard gives it, its own cue showing
// only without one (ruling R42).

import { test, expect, type Locator } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** What the browser computes for a tick or a radio: its edge, its well and its mark. */
function tick(input: Locator): Promise<{ edge: number; edgeStyle: string; edgeColour: string; well: string; mark: string; shown: string }> {
  return input.evaluate((el) => {
    const box = getComputedStyle(el);
    const mark = getComputedStyle(el, '::before');
    return {
      edge: Number.parseFloat(box.borderTopWidth), edgeStyle: box.borderTopStyle, edgeColour: box.borderTopColor, well: box.backgroundColor,
      mark: mark.backgroundColor, shown: mark.opacity,
    };
  });
}

/** The colour of a caret (the `::before` of `owner`), and the colour of what it sits on: the nearest background that is not transparent. */
function caret(owner: Locator): Promise<{ caret: string; under: string }> {
  return owner.evaluate((el) => {
    let under = 'rgba(0, 0, 0, 0)';
    for (let at: Element | null = el; at !== null && under === 'rgba(0, 0, 0, 0)'; at = at.parentElement) under = getComputedStyle(at).backgroundColor;
    return { caret: getComputedStyle(el, '::before').backgroundColor, under };
  });
}

test('the ticks, radios and carets stay visible in forced colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Forced colours', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 });   // a plan: the Flow toolbar and Materials
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);

  // a checkbox that is ticked (reusing the machines we have is on by default) and one that is not (the Flow toolbar's), a radio that is
  // picked (the mode is Rate) and one that is not
  const ticked = page.locator('aside[aria-label="Project settings"] input[name="reuseOwned"]');
  const unticked = page.getByRole('checkbox', { name: 'Imports in one column' });
  const picked = page.getByRole('radio', { name: 'Rate' });
  const unpicked = page.getByRole('radio', { name: 'Make N (batch)' });
  for (const input of [ticked, unticked, picked, unpicked]) await expect(input).toBeVisible();
  await expect(ticked).toBeChecked();
  await expect(unticked).not.toBeChecked();
  await expect(picked).toBeChecked();
  await expect(unpicked).not.toBeChecked();

  // every box has an edge in a colour of its own, so the box shows; a ticked one's mark is a colour of its own too, so the tick shows
  for (const input of [ticked, unticked, picked, unpicked]) {
    const drawn = await tick(input);
    expect(drawn.edge).toBeGreaterThanOrEqual(1);
    expect(drawn.edgeStyle).toBe('solid');
    expect(drawn.edgeColour).not.toBe(TRANSPARENT);
    expect(drawn.edgeColour, 'the edge is not the colour of the well').not.toBe(drawn.well);
  }
  for (const input of [ticked, picked]) {
    const drawn = await tick(input);
    expect(drawn.shown).toBe('1');
    expect(drawn.mark).not.toBe(TRANSPARENT);
    expect(drawn.mark, 'the mark is not the colour of the well').not.toBe(drawn.well);
  }
  for (const input of [unticked, unpicked]) expect((await tick(input)).shown, 'an unticked box shows no mark').toBe('0');

  // the caret of a settings section's summary, and of a row of the build list that opens
  const summary = page.locator('aside[aria-label="Project settings"] details.settings-section > summary').first();
  await expect(summary).toBeVisible();
  const sectionCaret = await caret(summary);
  expect(sectionCaret.caret).not.toBe(TRANSPARENT);
  expect(sectionCaret.caret, 'the caret is not the colour of its summary').not.toBe(sectionCaret.under);
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  const toggle = page.locator('button.mat-toggle').first();
  await expect(toggle).toBeVisible();
  const rowCaret = await caret(toggle);
  expect(rowCaret.caret).not.toBe(TRANSPARENT);
  expect(rowCaret.caret, 'the caret is not the colour of its row').not.toBe(rowCaret.under);

  // out of forced colours a tick has no edge, its bevel draws it: the forced-colours block is what drew the edges above
  await page.emulateMedia({ forcedColors: 'none' });
  expect((await tick(ticked)).edge).toBe(0);
});

test('a picked map row shows the focus ring when the keyboard picks it, and its own cue when the pointer does', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await login(page); await setName(page, 'Ann');
  // the iron plate line on the sample world's base, its pins listed in the line's panel; it reads no other project's surplus, so no other
  // test's project replans it (ledger ruling P2-R16)
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'Forced colours map');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', useSurplus: false } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'Ann' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}/layout`)).json()).status, { timeout: 30_000 }).toBe('ok');
  await page.goto(`/p/${id}#map`);
  const pin = (n: number): Locator => page.getByTestId('line-panel').getByTestId(`pin-${n}`);
  await expect(pin(2)).toBeVisible();
  const outline = (n: number): Promise<{ width: string; offset: string }> => pin(n).locator('button').evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: style.outlineWidth, offset: style.outlineOffset };
  });

  // ledger ruling P2-R44: with the keyboard, Tab from the first pin's row to the second's and Enter picks it; it shows the focus ring, 3 px
  // outside it, where the picked row's cue (an outline too) once replaced it (R42)
  await pin(1).locator('button').focus();
  await page.keyboard.press('Tab');
  await expect(pin(2).locator('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pin(2)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => outline(2)).toEqual({ width: '3px', offset: '0px' });
  // with the pointer there is no focus ring, so the picked row shows its cue, 2 px inside it
  await pin(1).locator('button').click();
  await expect(pin(1)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => outline(1)).toEqual({ width: '2px', offset: '-2px' });
});
