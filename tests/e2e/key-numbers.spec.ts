// The key-numbers strip (Phase 2 spec §10, Task 7): five readout tiles at the top of the banners' box, what the plan makes, its peak power,
// its machines and what it costs to build and to run. A changed figure counts up from the one shown over 400 ms and its tile flashes once;
// under reduced motion the new figure shows at once. The strip leads the box, above add-on 17's Compare card, which adds nothing while it
// is closed (plan ruling p2-d44-landed); it reads the build cost the project's planning mode counts; and in the narrow tiles of an 800 px
// window each figure stays whole on one line (plan ruling strip-figures).

import { test, expect, type Page, type Route } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, openWithPlan, setName, LV_CIRCUITS } from './helpers.ts';

/** The figure the Output tile shows (the visually hidden copy beside it holds the final one). */
const OUTPUT = '[data-key-number="output"] dd > span[aria-hidden]';

/**
 * From now on, records every text the Output tile's figure shows and every class its tile has, as the page writes them (the strip is
 * observed whole, so a figure drawn anew is caught too); `seen` gives both lists.
 */
async function watchOutput(page: Page): Promise<() => Promise<{ texts: string[]; classes: string[] }>> {
  await page.locator('.key-numbers').evaluate((strip, figure) => {
    const record = { texts: [] as string[], classes: [] as string[] };
    (window as unknown as { stripRecord: typeof record }).stripRecord = record;
    new MutationObserver(() => {
      record.texts.push(strip.querySelector(figure)?.textContent ?? '');
      record.classes.push(strip.querySelector('[data-key-number="output"]')?.className ?? '');
    }).observe(strip, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }, OUTPUT);
  return () => page.evaluate(() => (window as unknown as { stripRecord: { texts: string[]; classes: string[] } }).stripRecord);
}

/** Sets the Amount in the settings column; the field sends it once typing pauses. */
const setAmount = (page: Page, amount: string): Promise<void> =>
  page.getByRole('complementary', { name: 'Project settings' }).getByLabel('Amount', { exact: true }).fill(amount);

test('under reduced motion a new value shows at once, with nothing in between', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Strip at once', LV_CIRCUITS);
  const output = page.locator(OUTPUT);
  await expect(output).toHaveText('30');
  const seen = await watchOutput(page);

  await setAmount(page, '60');
  await expect.poll(() => output.textContent()).toBe('60');
  const { texts } = await seen();
  expect(texts.length, 'the figure was written').toBeGreaterThan(0);
  for (const text of texts) expect(['30', '60']).toContain(text);
});

// the motion the case above turns off (spec §10.1): the figure eases from the last one shown to the new one, every figure in between drawn
// on its way up, and the tile is `changed` while its frame flashes, then itself again (the flash's own end ends it)
test('counts a changed figure up from the last one shown, and flashes its tile once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Strip count-up', LV_CIRCUITS);
  const output = page.locator(OUTPUT);
  await expect(output).toHaveText('30');
  const seen = await watchOutput(page);

  await setAmount(page, '60');
  await expect.poll(() => output.textContent()).toBe('60');
  const tile = page.locator('[data-key-number="output"]');
  await expect(tile).toHaveClass('key-number');                                      // the flash has run and ended
  const { texts, classes } = await seen();
  const figures = texts.map(Number);
  expect(figures.every((n) => Number.isInteger(n) && n >= 30 && n <= 60), texts.join(' ')).toBe(true);
  expect(figures.some((n) => n > 30 && n < 60), `a figure on the way: ${texts.join(' ')}`).toBe(true);
  expect(figures, 'never backwards').toEqual([...figures].sort((a, b) => a - b));
  expect(classes).toContain('key-number changed');
  await expect(tile.locator('.key-number-flash')).toHaveCount(1);
});

// plan ruling p2-d44-landed: add-on 17 merged first, so its Compare modes button stays in the head (above 900 px) and nothing moves into the
// strip's row; the strip is the box's first child, and the card, which draws nothing while it is closed, opens below it as the box's last
test('the strip leads the banners box: closed, the Compare card adds nothing, and it opens below the strip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // the compare the card asks for is held, never planned: the server plans the three modes on its main thread for up to 20 s (theme.spec.ts)
  const held: Route[] = [];
  await page.route(/\/api\/projects\/[^/]+\/compare$/, (route) => { held.push(route); });
  try {
    await login(page); await setName(page, 'Ann');
    await createProject(page, 'Strip and compare', LV_CIRCUITS);
    const strip = page.locator('.key-numbers');
    await expect(strip).toBeVisible();
    expect(await page.locator('.project-banners').evaluate((box) => box.firstElementChild?.classList.contains('key-numbers') === true)).toBe(true);
    await expect(page.locator('.project-head .connection.live')).toBeVisible();      // the head measured once the stream is live (ruling F3)
    expect((await page.locator('.project-head').boundingBox())!.height).toBe(36);
    const before = (await strip.boundingBox())!;

    await page.locator('.project-head').getByRole('button', { name: 'Compare modes' }).click();
    const card = page.getByRole('region', { name: 'Compare modes' });
    await expect(card).toBeVisible();
    expect((await strip.boundingBox())!.y).toBe(before.y);
    expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(before.y + before.height);
  } finally {
    for (const route of held.splice(0)) await route.abort().catch(() => { /* the page has gone */ });
  }
});

// add-on 17's server counts no build cost in least raw material (it sends `Plan.cost.horizonHours` null, objective.ts): the strip reads the
// plan's cost and takes no figure per mode, and its qualifier says what the hidden cost sentence says
test('the strip reads the mode the project plans in: least raw material counts no build cost', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Strip mode', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 });
  const sub = page.locator("[data-key-number='build'] .key-number-sub");
  await expect(sub).toHaveText('over 24 h');                                          // Cheapest, the default mode
  await page.getByRole('complementary', { name: 'Project settings' }).getByRole('radio', { name: 'Least raw material', exact: true }).check();
  await expect(sub).toHaveText('not counted');
  await expect(page.locator('.plan-cost')).toContainText('(build cost not counted)');
});

// plan ruling strip-figures (spec §25): at 800 px the five tiles are 144 px wide, 120 px inside; in VT323 28 px "99,999" is 67.2 px and
// "99,999 raw/h" 101.2 px, so the figures the strip writes stay whole (a longer unit may still end in "…", which this does not cover)
test('keeps each figure of the strip whole and on one line at 800 px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openWithPlan(page, { ...circuitLv(), cost: { runPerHour: 99_999, build: 99_999, horizonHours: 24 } });   // a target: the drawer stays shut
  const tiles = page.locator('.key-number');
  await expect(tiles).toHaveCount(5);
  await page.evaluate(async () => { await document.fonts.ready; });
  const measured = await tiles.evaluateAll((els) => els.map((tile) => {
    const box = tile.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(tile.querySelector("dd > span[aria-hidden='true']")!);
    const rects = [...range.getClientRects()];
    return {
      id: tile.getAttribute('data-key-number'), height: box.height, lines: rects.length,
      inside: rects.every((r) => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom),
    };
  }));
  expect(measured.map((tile) => tile.id)).toEqual(['output', 'power', 'machines', 'build', 'run']);
  for (const tile of measured) expect(tile, tile.id ?? '').toMatchObject({ height: 52, lines: 1, inside: true });
});
