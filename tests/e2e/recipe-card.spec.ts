// The step panel's recipe card (Phase 2 spec §8, Task 5a): one run of the step's recipe as NEI draws it, between the panel's summary and its
// Takes and Makes lists. These cases ask Chromium what it draws on the Basic Assembler of circuitLv (1 plate, 2 wire and 1 redstone make 1
// circuit in 200 t at 16 EU/t): its slots and their stack counts, a slot lighting its good in the Flow while hovered, the GT progress arrow's
// three runs (still under reduced motion), a fluid's "144L" and a chance tag inside their slot with the web fonts and without them (spec §25:
// VT323, and a fallback drawn as tall), the arrow's and the energy bar's fills in forced colours and the edges that keep the track, the
// arrow and a short slot there (spec §20, ledger ruling P2-R33), and the arrow going on through a new plan for the same step (spec §8.7).
// Task 5b adds the panel sliding in once, and a step picked inside it taking the focus to its own panel, which stands where the old one
// stood (spec §8.6), its head scrolled into the window when the window shows none of it (ledger ruling P2-R35); and Close giving the focus
// back to the box head that opened the panel, or to the diagram once a replan has removed that box (ledger ruling P2-R36).

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { circuitLv, circuitMvPerHour, copperUnsourced, platesTwoWays } from './fixtures/plans.ts';
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

test('picking another box swaps the panel without sliding it in again', async ({ page }) => {
  await openAssembler(page);
  const side = page.locator('.flow-side');
  /** The animations of the panel's wrapper itself (its slide-in), not of what it holds. */
  const running = (): Promise<number> => side.evaluate((el) => el.getAnimations().length);
  await expect.poll(running).toBe(0);                                                    // the first pick's slide-in has run
  await side.evaluate((el) => el.setAttribute('data-was-here', ''));
  await page.getByRole('button', { name: 'Fit' }).click();
  const head = page.locator('[data-step-id="wire"] .flow-node-head');
  await head.click();
  // read at once: a wrapper mounted by this pick would be sliding in for 260 ms
  expect(await running(), 'the wrapper slides in again').toBe(0);
  const mill = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(mill).toBeVisible();
  // the same wrapper (spec §8.6), round a new panel, which fades in over 160 ms
  await expect(page.locator('.flow-side[data-was-here]')).toHaveCount(1);
  expect(await mill.evaluate((el) => { const s = getComputedStyle(el); return `${s.animationName} ${s.animationDuration}`; })).toBe('fade-in 0.16s');
  // a pick on the canvas leaves the focus where the click put it
  await expect(head).toBeFocused();
  await expect(mill).not.toBeFocused();
  // nor does a switch from a step's panel to an import's slide it in again
  await page.locator('[data-node-id^="import:t:copper_ingot@0@"]').click();
  expect(await running(), 'the wrapper slides in again for an import').toBe(0);
  await expect(page.getByRole('complementary', { name: 'Import: Copper Ingot' })).toBeVisible();
  await expect(page.locator('.flow-side[data-was-here]')).toHaveCount(1);
});

test('a peer picked inside the panel takes the focus to the new panel', async ({ page }) => {
  const { panel } = await openAssembler(page);
  await panel.getByRole('button', { name: 'Basic Wiremill (1x Copper Wire)' }).click();   // under Takes: where its wire comes from
  const mill = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(mill).toBeFocused();
  // and a step picked in an import's panel (Used by) takes it to the step's panel
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.locator('[data-node-id^="import:t:copper_ingot@0@"]').click();
  const ingot = page.getByRole('complementary', { name: 'Import: Copper Ingot' });
  await expect(ingot).toBeVisible();
  await ingot.getByRole('button', { name: 'Basic Wiremill (1x Copper Wire)' }).click();
  await expect(mill).toBeFocused();
  // and on a narrow window, where the panel grows with what it holds: no scroll container there, which Chromium lets take the focus with no
  // tabindex, so only the panel's own tabindex can take it
  await page.setViewportSize({ width: 1000, height: 900 });
  await mill.getByRole('button', { name: 'Basic Assembler (Basic Circuit)' }).click();   // under Makes: where its wire goes
  await expect(page.getByRole('complementary', { name: 'Step: Basic Assembler' })).toBeFocused();
});

test('the panel that takes the focus stands where the old one stood, and the page does not scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { panel } = await openAssembler(page);
  const peer = panel.getByRole('button', { name: 'Basic Wiremill (1x Copper Wire)' });
  await peer.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY);
  const old = await panel.boundingBox();
  if (old === null) throw new Error('the panel has no box');
  // the premise: the panel runs past the bottom of the window, so a focus that scrolled would move the page to show its end
  expect(old.y + old.height, 'the panel ends below the window').toBeGreaterThan(900);
  await peer.click();
  const mill = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(mill).toBeFocused();
  expect(await page.evaluate(() => scrollY), 'the page scrolled').toBe(scrolled);
  expect((await mill.boundingBox())?.y, 'the new panel starts where the old one did').toBe(old.y);
});

// ledger ruling P2-R35: a head the window does not show at all is scrolled in, by the least scroll, so the focus stays in sight
test('a step picked inside a panel whose head is above the window brings the new head into the window by the least scroll', async ({ page }) => {
  // one column, where the panel sits below the diagram as tall as what it holds; a short window, so the new panel is long enough that the page
  // keeps its scroll when the panel is swapped
  await page.setViewportSize({ width: 1000, height: 600 });
  const { panel } = await openAssembler(page);
  const head = panel.locator('.flow-panel-head');
  const peer = panel.getByRole('button', { name: 'Basic Wiremill (1x Copper Wire)' });
  const at = await head.boundingBox();
  if (at === null) throw new Error('the head has no box');
  await page.evaluate((dy) => scrollBy(0, dy), at.y + at.height + 40);                     // the head's bottom 40 px above the window
  const before = { scroll: await page.evaluate(() => scrollY), head: await head.boundingBox() };
  if (before.head === null) throw new Error('the head has no box');
  // the premise: the head is wholly above the window, and the peer can be clicked where it is
  expect(before.head.y + before.head.height, 'the head ends above the window').toBeLessThan(0);
  await expect(peer).toBeInViewport();
  await peer.click();
  const mill = page.getByRole('complementary', { name: 'Step: Basic Wiremill' });
  await expect(mill).toBeFocused();
  const now = { scroll: await page.evaluate(() => scrollY), head: await mill.locator('.flow-panel-head').boundingBox() };
  if (now.head === null) throw new Error('the new head has no box');
  // the new head stands where the old one did, so the least scroll puts it at the top of the window: the page moved up by its distance above
  expect(Math.abs(now.head.y), `the new head's top ${now.head.y} is at the top of the window`).toBeLessThan(1);
  expect(Math.abs(before.scroll - now.scroll + before.head.y), 'the page moved up by the head\'s distance above the window').toBeLessThan(1);
});

// ledger ruling P2-R36: Close gives the focus back to the head of the box that opened the panel, while it is drawn, else to the diagram
test('Close gives the focus back to the box head that opened the panel from the keyboard', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const head = page.locator('[data-step-id="circuit-lv"] .flow-node-head');
  await head.focus();
  await page.keyboard.press('Enter');                                                      // a pick on the canvas, which keeps the focus
  const panel = page.getByRole('complementary', { name: 'Step: Basic Assembler' });
  await expect(panel).toBeVisible();
  await expect(head).toBeFocused();
  await panel.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(head).toBeFocused();
});

test('Close after a replan removed the box that opened the panel gives the focus to the diagram', async ({ page }) => {
  const id = await openWithPlan(page, platesTwoWays());
  await page.getByRole('button', { name: 'Fit' }).click();
  const opener = page.locator('[data-node-id="import:t:iron_ingot@0@hammer-plate"]');      // the hammer's Iron Ingot stub
  await opener.click();
  const panel = page.getByRole('complementary', { name: 'Import: Iron Ingot' });
  await expect(panel).toBeVisible();
  // the next plan has no hammer, so its stub goes, while the bending machine still takes Iron Ingot and the panel stays (a later route wins)
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: circuitLv() }));
  const ops = [{ op: 'settings', patch: { amount: 31 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(3);
  await expect(opener).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close the panel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('svg.flow-canvas')).toBeFocused();
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
interface Tag { text: string; tag: Box; icon: Box; paddingRight: string; scrollWidth: number; clientWidth: number; unclipped: boolean }
interface TagBoxes { loaded: string[]; tags: Tag[] }

/**
 * Opens circuitLv with RARE's outputs added to its assembler, in a browser context of its own, and measures each chance tag and its slot once
 * the fonts the page asked for have loaded or failed (with `blockFonts` every font file is refused, as chrome.spec.ts does): the boxes, the
 * tag's right padding and widths, and whether its slot looks the same with the tag's clip lifted (`unclipped`: the clip cut nothing).
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
      return {
        text: tag.textContent ?? '', tag: box(tag), icon: box(tag.parentElement?.querySelector('.item-icon') as Element),
        paddingRight: getComputedStyle(tag).paddingRight, scrollWidth: tag.scrollWidth, clientWidth: tag.clientWidth,
      };
    }));
    // each slot as drawn, then with the tag's clip lifted: the same pixels when the clip cut nothing, the text's shadow included
    const slots = page.locator('.recipe-slot').filter({ has: page.locator('.slot-chance') });
    const shoot = (): Promise<Buffer[]> => Promise.all(boxes.map((_, i) => slots.nth(i).screenshot({ animations: 'disabled' })));
    const clipped = await shoot();
    await page.addStyleTag({ content: '.slot-chance { overflow-x: visible !important; }' });
    const lifted = await shoot();
    return { loaded: await loaded(), tags: boxes.map((t, i) => ({ ...t, unclipped: clipped[i]!.equals(lifted[i]!) })) };
  } finally {
    await context.close();
  }
}

test('a chance tag never draws past its own slot, and draws its whole shadow, with the fonts and without them', async ({ browser }) => {
  const without = await measureTags(browser, true);
  const withFonts = await measureTags(browser, false);
  // the premise (chrome.spec.ts's): the first page never got a web font, the second has Pixelify and VT323
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded, 'VT323 loaded with the font files served').toContain('VT323');
  for (const [faces, m] of [['the fallback faces', without], ['the web fonts', withFonts]] as const) {
    for (const { text, tag, icon, paddingRight, scrollWidth, clientWidth, unclipped } of m.tags) {
      // 2 px in from the slot's left and top, and its box, the 2 px right padding its shadow is drawn in included, ends at the slot's edge
      expect(tag.left, `${faces}: "${text}" starts left of its slot`).toBeGreaterThanOrEqual(icon.left);
      expect(tag.top, `${faces}: "${text}" starts above its slot`).toBeGreaterThanOrEqual(icon.top);
      expect(tag.right, `${faces}: "${text}" ends at ${tag.right}, past its slot's edge at ${icon.right}`).toBeLessThanOrEqual(icon.right + 0.01);
      // and a short tag draws its whole shadow: the clip cuts nothing, as the text fits before the padding its shadow falls in
      expect(unclipped, `${faces}: "${text}" looks the same with its clip lifted`).toBe(true);
      expect(paddingRight, `${faces}: "${text}" keeps 2 px for its shadow`).toBe('2px');
      expect(scrollWidth, `${faces}: "${text}" fits its box`).toBe(clientWidth);
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
