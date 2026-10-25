// The step panel's recipe card (Phase 2 spec §8, Task 5a): one run of the step's recipe as NEI draws it, between the panel's summary and its
// Takes and Makes lists. These cases ask Chromium what it draws on the Basic Assembler of circuitLv (1 plate, 2 wire and 1 redstone make 1
// circuit in 200 t at 16 EU/t): its slots and their stack counts, a slot lighting its good in the Flow while hovered, the GT progress arrow's
// three runs (still under reduced motion), a fluid's "144L" and a chance tag inside their slot with the web fonts and without them (spec §25:
// VT323, and a fallback drawn as tall), the arrow's and the energy bar's fills in forced colours and the edges that keep the track, the
// arrow and a short slot there (spec §20, ledger ruling P2-R33), and the arrow going on through a new plan for the same step (spec §8.7).

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { circuitLv, circuitMvPerHour, copperUnsourced } from './fixtures/plans.ts';
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

/** The chances of three outputs added to the Basic Assembler: a sliver, one with a decimal, and all but certain. */
const RARE: ReadonlyArray<[string, number]> = [['t:iron_dust_tiny@0', 0.0005], ['t:copper_dust_small@0', 0.125], ['t:redstone_gem@0', 0.9995]];
interface Box { left: number; top: number; right: number }
interface TagBoxes { loaded: string[]; tags: Array<{ text: string; tag: Box; icon: Box }> }

/**
 * Opens circuitLv with RARE's outputs added to its assembler, in a browser context of its own, and measures each chance tag and its slot once
 * the fonts the page asked for have loaded or failed (with `blockFonts` every font file is refused, as chrome.spec.ts does).
 */
async function measureTags(browser: Browser, blockFonts: boolean): Promise<TagBoxes> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
    // new step objects: circuitLv() hands out the same assembler every time, so editing it in place would reach every later test
    const lv = circuitLv();
    const extra = RARE.map(([key, chance]) => ({ key, amount: chance, chance }));
    const plan = { ...lv, steps: lv.steps.map((s) => (s.id === 'circuit-lv' ? { ...s, outputs: [...s.outputs, ...extra] } : s)) };
    await openWithPlan(page, plan);
    await page.getByRole('button', { name: 'Fit' }).click();
    await page.locator('[data-step-id="circuit-lv"] .flow-node-head').click();
    const tags = page.getByRole('complementary', { name: 'Step: Basic Assembler' }).locator('.slot-chance');
    await expect(tags).toHaveCount(RARE.length);
    const loaded = (): Promise<string[]> => page.evaluate(async () => {
      await document.fonts.ready;                                                       // every font the page asked for has loaded or failed
      return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family);
    });
    // with the files served, the tag's Pixelify % and its VT323 digits come in once the panel is drawn
    if (!blockFonts) await expect.poll(async () => { const faces = await loaded(); return faces.includes('VT323') && faces.some((f) => f.includes('Pixelify')); }).toBe(true);
    const boxes = await tags.evaluateAll((els) => els.map((tag) => {
      const box = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right }; };
      return { text: tag.textContent ?? '', tag: box(tag), icon: box(tag.parentElement?.querySelector('.item-icon') as Element) };
    }));
    return { loaded: await loaded(), tags: boxes };
  } finally {
    await context.close();
  }
}

test('a chance tag never draws past its own slot, with the fonts and without them', async ({ browser }) => {
  const without = await measureTags(browser, true);
  const withFonts = await measureTags(browser, false);
  // the premise (chrome.spec.ts's): the first page never got a web font, the second has Pixelify and VT323
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded, 'VT323 loaded with the font files served').toContain('VT323');
  for (const [faces, m] of [['the fallback faces', without], ['the web fonts', withFonts]] as const) {
    for (const { text, tag, icon } of m.tags) {
      // 2 px in from the slot's left and top, and its 2 px shadow ends at the slot's right edge or before it
      expect(tag.left, `${faces}: "${text}" starts left of its slot`).toBeGreaterThanOrEqual(icon.left);
      expect(tag.top, `${faces}: "${text}" starts above its slot`).toBeGreaterThanOrEqual(icon.top);
      expect(tag.right + 2, `${faces}: "${text}" and its shadow end at ${tag.right + 2}, past its slot's edge at ${icon.right}`).toBeLessThanOrEqual(icon.right + 0.01);
    }
    // the whole chance is in the slot's name and tip: the tag says less, in at most three figures
    expect(m.tags.map((t) => t.text), faces).toEqual(['<1%', '13%', '99%']);
  }
});

test('in forced colours the arrow and the energy bar keep their fills, and the track, the arrow and a short slot their edges', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const { panel } = await openAssembler(page);
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);
  /** A system colour as the theme computes it: a probe span's `color`. */
  const system = (name: 'Highlight' | 'CanvasText' | 'GrayText'): Promise<string> => page.evaluate((colour) => {
    const probe = document.createElement('span');
    probe.style.color = colour;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, name);
  const paint = (scope: Locator, selector: string): Promise<{ background: string; outline: string }> => scope.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` };
  });
  const highlight = await system('Highlight');
  for (const [fill, base] of [['.gt-arrow-fill', '.gt-arrow'], ['.energy-fill', '.energy-bar']] as const) {
    const painted = (await paint(panel, fill)).background;
    expect(painted, `${fill} has a fill`).not.toBe('rgba(0, 0, 0, 0)');
    expect(painted, `${fill} is not the colour of ${base}`).not.toBe((await paint(panel, base)).background);
    expect(painted, `${fill} is the Highlight`).toBe(highlight);
  }
  // ledger ruling P2-R33: the energy bar's track keeps an edge in the text colour, so its fill has a scale, and the arrow its base in GrayText
  expect((await paint(panel, '.energy-bar')).outline, 'the energy bar\'s track has an edge').toBe(`solid 1px ${await system('CanvasText')}`);
  expect((await paint(panel, '.gt-arrow')).background, 'the arrow\'s base is GrayText').toBe(await system('GrayText'));
  // a short slot keeps its ring, as a Highlight outline: the line without its copper, the wiremill's panel (a later route wins over openWithPlan's)
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: copperUnsourced() }));
  await page.reload();
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.locator('[data-step-id="wire"] .flow-node-head').click();
  const mill = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(mill.locator('.recipe-slot.slot-short')).toHaveCount(1);
  expect((await paint(mill, '.recipe-slot.slot-short > .item-icon')).outline, 'the short slot\'s ring').toBe(`solid 2px ${highlight}`);
  // out of forced colours neither edge is there: the forced-colours block drew them
  await page.emulateMedia({ forcedColors: 'none' });
  expect((await paint(mill, '.energy-bar')).outline).toMatch(/^none /);
  expect((await paint(mill, '.recipe-slot.slot-short > .item-icon')).outline).toMatch(/^none /);
});

test('a new plan for the same step does not run the arrow again', async ({ page }) => {
  const { panel, id } = await openAssembler(page);
  await panel.locator('.gt-arrow-fill').evaluate((el) => el.setAttribute('data-was-here', ''));
  // the next plan the page fetches has the assembler busier (a later route wins over openWithPlan's)
  const lv = circuitLv();
  const busier = { ...lv, steps: lv.steps.map((s) => (s.id === 'circuit-lv' ? { ...s, utilization: 0.9 } : s)) };   // a new step: the fixture's is shared
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: busier }));
  // a settings op makes the server replan; its plan event makes the page fetch the plan again
  const ops = [{ op: 'settings', patch: { amount: 31 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(panel.locator('.readout', { hasText: 'Busy' }).locator('dd')).toHaveText('90%');
  // the same element: its run went on, it did not start again
  await expect(panel.locator('.gt-arrow-fill[data-was-here]')).toHaveCount(1);
});
