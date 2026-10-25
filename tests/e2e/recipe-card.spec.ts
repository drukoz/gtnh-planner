// The step panel's recipe card (Phase 2 spec §8, Task 5a): one run of the step's recipe as NEI draws it, between the panel's summary and its
// Takes and Makes lists. These cases ask Chromium what it draws on the Basic Assembler of circuitLv (1 plate, 2 wire and 1 redstone make 1
// circuit in 200 t at 16 EU/t): its slots and their stack counts, a slot lighting its good in the Flow while hovered, the GT progress arrow's
// three runs (still under reduced motion), a fluid's "144L" inside its slot with the web fonts and without them (spec §25: VT323, and a
// fallback drawn as tall), the arrow's and the energy bar's fills in forced colours (spec §20), and the arrow going on through a new plan
// for the same step (spec §8.7).

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { circuitLv, circuitMvPerHour } from './fixtures/plans.ts';
import { LV_CIRCUITS, openWithPlan } from './helpers.ts';

/** Opens circuitLv and the Basic Assembler's panel; returns the panel and the project's id. */
async function openAssembler(page: Page): Promise<{ panel: Locator; id: string }> {
  const id = await openWithPlan(page, circuitLv());
  await page.locator('[data-step-id="circuit-lv"] .flow-node-head').click();
  const panel = page.getByRole('complementary', { name: 'Step: Basic Assembler' });
  await expect(panel).toBeVisible();
  return { panel, id };
}

test('one run of the assembler as NEI draws it', async ({ page }) => {
  const { panel } = await openAssembler(page);
  await expect(panel.locator('[aria-label="Takes per run"] .recipe-slot')).toHaveCount(3);
  await expect(panel.locator('[aria-label="Makes per run"] .recipe-slot')).toHaveCount(1);
  await expect(panel.locator('[data-recipe-key="t:copper_wire@0"] .stack-count')).toHaveText('2');
  // strict: the card writes no second copy of the overclock line plan.spec.ts reads
  await expect(page.getByText('0 overclocks → 16 EU/t × 200 t')).toBeVisible();
});

test('hovering a slot lights its good in the Flow', async ({ page }) => {
  const { panel } = await openAssembler(page);
  const canvas = page.locator('svg.flow-canvas');
  // the click that opened the panel lit the assembler's box: Esc clears it, so what the hover lights is the hover's
  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveClass(/\bfocusing\b/);
  await expect(panel).toBeVisible();
  await panel.locator('[data-recipe-key="t:copper_wire@0"]').hover();
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  await expect(page.locator('[data-step-id="wire"]')).toHaveClass(/\bproducer\b/);       // the wire's maker, and its one arrow
  await expect(page.locator('.flow-edge.hl')).toHaveCount(1);
  // leaving the slot gives back what was lit before it: nothing
  await panel.locator('.flow-panel-head h3').hover();
  await expect(canvas).not.toHaveClass(/\bfocusing\b/);
});

test('the arrow runs three times, and is still under reduced motion', async ({ page }) => {
  const { panel } = await openAssembler(page);
  const fill = panel.locator('.gt-arrow-fill');
  const run = (): Promise<{ name: string; count: string; duration: string }> => fill.evaluate((el) => {
    const style = getComputedStyle(el);
    return { name: style.animationName, count: style.animationIterationCount, duration: style.animationDuration };
  });
  expect(await run()).toEqual({ name: 'gt-arrow', count: '3', duration: '1.6s' });       // 4.8 s, then it rests full (spec §8.7)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await run()).duration).toBe('0.001s');
});

/** The output slot of the Basic Fluid Extractor (144 L of Molten Iron a run) and its count, as Chromium lays them out. */
interface CountBox { loaded: string[]; text: string; icon: { left: number; right: number }; count: { left: number; right: number } }

/**
 * Opens circuitMvPerHour in a browser context of its own and the fluid extractor's panel, and measures its output slot's count once the
 * fonts the page asked for have loaded or failed. With `blockFonts` every font file is refused (the .woff2 files and the .woff fallbacks, as
 * chrome.spec.ts does), so the count stays in the size-adjusted fallback; `loaded` is the faces that did load.
 */
async function measureCount(browser: Browser, blockFonts: boolean): Promise<CountBox> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
    await openWithPlan(page, circuitMvPerHour(), { ...LV_CIRCUITS, tier: 2 });
    await page.getByRole('button', { name: 'Fit' }).click();
    await page.locator('[data-step-id="extract-iron"] .flow-node-head').click();
    const slot = page.getByRole('complementary', { name: 'Step: Basic Fluid Extractor' }).locator('[aria-label="Makes per run"] .recipe-slot');
    await expect(slot.locator('.stack-count')).toHaveText('144L');
    const loaded = (): Promise<string[]> => page.evaluate(async () => {
      await document.fonts.ready;                                                       // every font the page asked for has loaded or failed
      return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family);
    });
    // with the files served, the count's VT323 comes in once the panel is drawn
    if (!blockFonts) await expect.poll(async () => (await loaded()).includes('VT323')).toBe(true);
    const boxes = await slot.evaluate((li) => {
      const side = (el: Element | null): { left: number; right: number } => {
        const r = (el as Element).getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      const count = li.querySelector('.stack-count');
      return { text: count?.textContent ?? '', icon: side(li.querySelector('.item-icon')), count: side(count) };
    });
    return { loaded: await loaded(), ...boxes };
  } finally {
    await context.close();
  }
}

test('"144L" fits its slot with the fonts and without them', async ({ browser }) => {
  const without = await measureCount(browser, true);
  const withFonts = await measureCount(browser, false);
  // the premise (chrome.spec.ts's): the first page never got a web font, the second has VT323, so the two measure both faces
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded, 'VT323 loaded with the font files served').toContain('VT323');
  // from side to side inside the slot (it sits 2 px below it by design, bottom: -2px): VT323 writes it in 25.6 px, the size-adjusted
  // fallback in 29.6 px (38.5 px without the adjust), in the 36 px slot (spec §25)
  for (const [faces, m] of [['the fallback face', without], ['VT323', withFonts]] as const) {
    expect(m.text, faces).toBe('144L');
    expect(m.count.left, `${faces}: the count's left ${m.count.left} against the slot's ${m.icon.left}`).toBeGreaterThanOrEqual(m.icon.left - 1);
    expect(m.count.right, `${faces}: the count's right ${m.count.right} against the slot's ${m.icon.right}`).toBeLessThanOrEqual(m.icon.right + 1);
  }
});

test('in forced colours the arrow and the energy bar keep their fills', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const { panel } = await openAssembler(page);
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);
  const background = (selector: string): Promise<string> => panel.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const highlight = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'Highlight';
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  });
  for (const [fill, base] of [['.gt-arrow-fill', '.gt-arrow'], ['.energy-fill', '.energy-bar']] as const) {
    const painted = await background(fill);
    expect(painted, `${fill} has a fill`).not.toBe('rgba(0, 0, 0, 0)');
    expect(painted, `${fill} is not the colour of ${base}`).not.toBe(await background(base));
    expect(painted, `${fill} is the Highlight`).toBe(highlight);
  }
});

test('a new plan for the same step does not run the arrow again', async ({ page }) => {
  const { panel, id } = await openAssembler(page);
  await panel.locator('.gt-arrow-fill').evaluate((el) => el.setAttribute('data-was-here', ''));
  // the next plan the page fetches has the assembler busier (a later route wins over openWithPlan's)
  const busier = circuitLv();
  for (const s of busier.steps) if (s.id === 'circuit-lv') s.utilization = 0.9;
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: busier }));
  // a settings op makes the server replan; its plan event makes the page fetch the plan again
  const ops = [{ op: 'settings', patch: { amount: 31 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(panel.locator('.readout', { hasText: 'Busy' }).locator('dd')).toHaveText('90%');
  // the same element: its run went on, it did not start again
  await expect(panel.locator('.gt-arrow-fill[data-was-here]')).toHaveCount(1);
});
