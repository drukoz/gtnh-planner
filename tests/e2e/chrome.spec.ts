// The chrome keeps its size and its stillness (restyle plan Phase 1 Task 3: its chrome height budget and review focuses 2 and 4,
// design spec §7a). The end-to-end tests aim the mouse at canvas centres, so the top bar and the tab strip must measure the same
// whether the web fonts have arrived or never do: a font swap would otherwise shift every canvas under them. And a user who asked
// for reduced motion gets a live dot that holds still.

import { test, expect, type Browser } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

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
