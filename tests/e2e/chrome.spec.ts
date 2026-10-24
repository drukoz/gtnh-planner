// The chrome keeps its size and its stillness (restyle plan Phase 1 Task 3: its chrome height budget and review focuses 2 and 4,
// design spec §7a). The end-to-end tests aim the mouse at canvas centres, so the top bar and the tab strip must measure the same
// whether the web fonts have arrived or never do: a font swap would otherwise shift every canvas under them. And a user who asked
// for reduced motion gets a live dot that holds still, and a logo whose pipe never moves (Phase 2 spec §5.3: it flows six turns
// otherwise, then rests on its still frame). The figures, in VT323 (Phase 2 spec §25), keep their boxes whether that face arrives or not.

import { test, expect, type Browser } from '@playwright/test';
import { login, setName, createProject, LV_CIRCUITS } from './helpers.ts';

/** What the chrome of a project page measures, and which web fonts the page has loaded. */
interface Chrome {
  /** The height of the top bar. */
  bar: number;
  /** The height of the tab strip, and the gap between its bottom and the top of the tab panel. */
  strip: number;
  below: number;
  /** The height of every tab. */
  tabs: number[];
  /** The families of the font faces that loaded, once per face. */
  loaded: string[];
}

/**
 * Opens a new project in a browser context of its own and measures its chrome. With `blockFonts` every font file is refused, the
 * .woff2 files the browser asks for first and the .woff fallbacks it would ask for next, so the page stays on its fallback fonts.
 */
async function measure(browser: Browser, blockFonts: boolean): Promise<Chrome> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
    await login(page); await setName(page, 'Ann');
    await createProject(page, blockFonts ? 'Chrome without fonts' : 'Chrome with fonts');
    await expect(page.getByRole('tab').first()).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });                 // every font the page asked for has loaded or failed

    const box = async (selector: string): Promise<{ y: number; height: number }> => {
      const found = await page.locator(selector).first().boundingBox();
      if (found === null) throw new Error(`${selector} has no box`);
      return found;
    };
    const bar = await box('.top-nav');
    const strip = await box('.tabs');
    const panel = await box('.tab-panel');
    return {
      bar: bar.height,
      strip: strip.height,
      below: panel.y - (strip.y + strip.height),
      tabs: await page.getByRole('tab').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height)),
      loaded: await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family)),
    };
  } finally {
    await context.close();
  }
}

test('fonts arriving late do not move the chrome', async ({ browser }) => {
  const without = await measure(browser, true);
  const withFonts = await measure(browser, false);

  // the premise: the first page never got a pixel font and the second has it, so the two measure the swap
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded.some((family) => family.includes('Pixelify')), 'the faces that loaded with the font files served').toBe(true);

  // equal heights either way, and within the plan's budget: a top bar up to 53px, a tab strip up to 41px with no margin below it
  expect(withFonts.bar).toBe(without.bar);
  expect(without.bar).toBeLessThanOrEqual(53);
  expect(withFonts.tabs).toEqual(without.tabs);
  expect(without.tabs).toHaveLength(6);
  for (const height of without.tabs) expect(height).toBe(38);
  expect(withFonts.strip).toBe(without.strip);
  expect(without.strip).toBeLessThanOrEqual(41);
  expect(without.below, 'the strip has no margin: the selected tab joins the panel').toBe(0);
  expect(withFonts.below).toBe(0);
});

test('reduced motion stops the live dot', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Live dot');
  const live = page.locator('.connection.live');
  await expect(live).toBeVisible();
  const dot = (): Promise<{ name: string; count: string }> => live.evaluate((el) => {
    const style = getComputedStyle(el, '::before');
    return { name: style.animationName, count: style.animationIterationCount };
  });

  expect(await dot()).toEqual({ name: 'breathe', count: '1' });                       // the animation is there, run once for a millisecond
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // without the preference the dot breathes twice, so the check above is not vacuous; twice and no more (ruling R31, WCAG 2.2.2: what
  // moves by itself beside the content stops within 5 s)
  expect(await dot(), 'without the preference the dot breathes twice').toEqual({ name: 'breathe', count: '2' });
});

test('the brand\'s pipe flows six turns, then rests; under reduced motion it holds still', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const mark = page.locator('.brand-mark');
  await expect(mark).toBeVisible();
  // both pseudo-elements are read, each on its own: the build's minifier has merged a list of them before and lost a half (ruling R28)
  const overlays = (): Promise<{ animationName: string; animationIterationCount: string }[]> => mark.evaluate((el) =>
    ['::before', '::after'].map((pseudo) => {
      const style = getComputedStyle(el, pseudo);
      return { animationName: style.animationName, animationIterationCount: style.animationIterationCount };
    }));
  const turns = (count: string): { animationName: string; animationIterationCount: string }[] =>
    [{ animationName: 'brand-flow', animationIterationCount: count }, { animationName: 'brand-flow', animationIterationCount: count }];

  // seven runs of 0.66 s, the first spent before the first paint by the negative delays: six turns show, and no more (rulings R31 and
  // P2-R12, WCAG 2.2.2); then each overlay falls back to its own opacity 0, the still frame
  expect(await overlays(), 'both overlays run seven times: six turns on screen').toEqual(turns('7'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // the global block's one run of a millisecond, which the overlays' negative delays have used up by the first paint
  expect(await overlays(), 'under reduced motion both run once').toEqual(turns('1'));
});

test('figures in VT323 keep their boxes whether the fonts arrive or not', async ({ browser }) => {
  // spec §25: a VT323 element has its line in px, so a late VT323 moves nothing; measured on the settings column's count of
  // reachable dimensions and on a Compare tile (54.7 px: 6 + 14.3 + 2 + 26.39 + 6, which Task 8's skeleton blocks copy)
  const boxes = async (blockFonts: boolean): Promise<{ count: number; tile: number; loaded: string[] }> => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
      const summary = { rawPerHour: 0.000000123, rawBuild: 131072, newMachines: 12, rawSources: 7, steps: 23, peakEUt: 2097152 };   // objectives.spec.ts:155
      await page.route(/\/api\/projects\/[^/]+\/compare$/, (route) => route.fulfill({ json: { rev: 1, current: 'cheapest',
        modes: ['least-raw', 'cheapest', 'multi-output'].map((objective) => ({ objective, status: 'ok', summary })) } }));
      await login(page); await setName(page, 'Ann');
      await createProject(page, blockFonts ? 'Figures without fonts' : 'Figures with fonts', LV_CIRCUITS);
      const count = page.locator('aside[aria-label="Project settings"] details.settings-section > summary > .muted').first();
      await expect(count).toBeVisible();
      await page.locator('.project-head').getByRole('button', { name: 'Compare modes' }).click();
      const tiles = page.getByRole('region', { name: 'Compare modes' }).locator('.compare-row');
      await expect(tiles).toHaveCount(18);
      await page.evaluate(async () => { await document.fonts.ready; });
      return {
        count: (await count.boundingBox())!.height, tile: (await tiles.first().boundingBox())!.height,
        loaded: await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family)),
      };
    } finally {
      await context.close();
    }
  };
  const without = await boxes(true);
  const withFonts = await boxes(false);
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded.some((family) => family.includes('VT323')), 'a VT323 face loaded with the font files served').toBe(true);
  expect(withFonts.count).toBe(without.count);
  expect(withFonts.tile).toBe(without.tile);
  expect(without.tile).toBeCloseTo(54.7, 0);
});
