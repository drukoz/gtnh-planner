// The Flow step boxes as machine readouts (Phase 2 spec §7, Task 4): a step box's head shows its machine's icon in a 36 px slot, its tier and
// its machine count on Pixelify chips (a count's digits in VT323, spec §25) and its power, over a busy band filled to how busy its machines
// are. These cases ask Chromium what it draws: the wiremill's machine, chips and fill; every chip's text inside its chip, with the web fonts
// and with them refused (ledger ruling P2-R8: a tier label in the fallback face is wider than in Pixelify), over a step at every tier; and in
// forced colours a fill that still differs from its track, chips that keep an edge and a slot framed in the text colour (spec §20, ledger
// ruling P2-R26).

import { test, expect, type Browser } from '@playwright/test';
import { TIER_NAMES } from '../../src/shared/gt/tiers.ts';
import { circuitLv, everyTier } from './fixtures/plans.ts';
import { openWithPlan } from './helpers.ts';

test('a step box shows its machine, its tier and count chips and how busy it is', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const wire = page.locator('[data-step-id="wire"]');
  // the wiremill's own icon, once: its rows show the goods
  await expect(wire.locator('[data-item-key="gregtech:gt.blockmachines@111"]')).toHaveCount(1);
  await expect(wire.locator('.flow-chip text')).toHaveText(['LV', '×2']);
  // the fixture's wiremill is 62.5 % busy: its fill is that share of its track
  const width = (selector: string): Promise<number> => wire.locator(selector).evaluate((el) => (el as SVGGraphicsElement).getBBox().width);
  expect((await width('.flow-busy-fill')) / (await width('.flow-busy-track'))).toBeCloseTo(0.625, 2);
});

/** One chip as Chromium lays it out: its text, how long that text is drawn and the width of its rect. */
interface Chip { text: string; length: number; width: number }

/**
 * Opens the every-tier plan in a browser context of its own and measures every Flow chip once the fonts the page asked for have loaded or
 * failed. With `blockFonts` every font file is refused (the .woff2 files and the .woff fallbacks, as chrome.spec.ts does), so the chips stay
 * in their fallback faces; `loaded` is the faces that did load.
 */
async function measureChips(browser: Browser, blockFonts: boolean): Promise<{ loaded: string[]; chips: Chip[] }> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
    await openWithPlan(page, everyTier());
    await expect(page.locator('.flow-chip').first()).toBeVisible();
    const loaded = (): Promise<string[]> => page.evaluate(async () => {
      await document.fonts.ready;                                                       // every font the page asked for has loaded or failed
      return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family);
    });
    // with the files served, the chips' faces come in once the chips are laid out: a tier label's Pixelify and a count's VT323 digits
    if (!blockFonts) {
      await expect.poll(async () => {
        const faces = await loaded();
        return faces.some((family) => family.includes('Pixelify')) && faces.includes('VT323');
      }).toBe(true);
    }
    const chips = await page.locator('.flow-chip').evaluateAll((groups) => groups.map((g) => {
      const text = g.querySelector('text') as SVGTextElement;
      return { text: text.textContent ?? '', length: text.getComputedTextLength(), width: (g.querySelector('rect') as SVGRectElement).width.baseVal.value };
    }));
    return { loaded: await loaded(), chips };
  } finally {
    await context.close();
  }
}

test('every chip\'s text fits its chip, with the fonts and without them', async ({ browser }) => {
  const without = await measureChips(browser, true);
  const withFonts = await measureChips(browser, false);
  // the premise (chrome.spec.ts's): the first page never got a web font, the second has Pixelify and VT323, so the two measure both faces
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded.some((family) => family.includes('Pixelify')), 'Pixelify loaded with the font files served').toBe(true);
  expect(withFonts.loaded, 'VT323 loaded with the font files served').toContain('VT323');
  for (const [faces, { chips }] of [['the fallback faces', without], ['the web fonts', withFonts]] as const) {
    // every tier label is measured, and the fixture's count chips, "×2" to "×1024 shared"
    expect(chips.map((c) => c.text).filter((t) => !t.startsWith('×')).sort(), faces).toEqual([...TIER_NAMES].sort());
    expect(chips.map((c) => c.text), faces).toEqual(expect.arrayContaining(['×1 shared', '×2', '×1024 shared', '×128']));
    // 5 px of padding on each side, as CHIP_PADDING
    for (const chip of chips) expect(chip.length, `${chip.text} in ${faces}: ${chip.length} px in a ${chip.width} px chip`).toBeLessThanOrEqual(chip.width - 2 * 5);
  }
});

test('in forced colours the busy fill and track differ and the chips stay visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openWithPlan(page, circuitLv());
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'the premise: the page is in forced colours').toBe(true);
  const paint = (selector: string, property: 'fill' | 'stroke'): Promise<string> =>
    page.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
  const wireFill = await paint('[data-step-id="wire"] .flow-busy-fill', 'fill');
  expect(wireFill, 'the fill is not the colour of its track').not.toBe(await paint('[data-step-id="wire"] .flow-busy-track', 'fill'));
  // Chromium leaves an SVG paint as it is in forced colours: the fill is the theme's Highlight because the forced-colours block says so
  const system = (name: 'Highlight' | 'Canvas' | 'CanvasText'): Promise<string> => page.evaluate((colour) => {
    const probe = document.createElement('span');
    probe.style.color = colour;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, name);
  expect(wireFill, 'the fill is the Highlight').toBe(await system('Highlight'));
  // ledger ruling P2-R26: the machine's slot keeps a frame, its two bevel strips in the theme's text colour, round a face of its canvas
  for (const strip of ['.flow-slot-lo', '.flow-slot-hi']) {
    expect(await paint(`[data-step-id="wire"] ${strip}`, 'fill'), `the slot's frame (${strip}) is the text colour`).toBe(await system('CanvasText'));
  }
  expect(await paint('[data-step-id="wire"] .flow-machine-slot', 'fill'), 'the slot\'s face is the canvas').toBe(await system('Canvas'));
  // the assembler is 100 % busy, so its band is the high one, whose fill the block repaints the same
  await expect(page.locator('[data-step-id="circuit-lv"] .flow-busy')).toHaveClass('flow-busy high');
  expect(await paint('[data-step-id="circuit-lv"] .flow-busy-fill', 'fill'), 'the high fill is repainted as the other').toBe(wireFill);
  // every chip and every track keeps an edge
  const strokes = (selector: string): Promise<string[]> => page.locator(selector).evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke));
  const chipEdges = await strokes('.flow-chip rect');
  expect(chipEdges).toHaveLength(6);                                                    // three steps, a tier chip and a count chip each
  for (const edge of [...chipEdges, ...await strokes('.flow-busy-track')]) expect(edge).not.toBe('none');
  // out of forced colours a chip has no edge, the high fill is its own colour and the slot's strips are its two bevel colours again: the
  // forced-colours block is what drew the above
  await page.emulateMedia({ forcedColors: 'none' });
  expect(await paint('.flow-chip rect', 'stroke')).toBe('none');
  expect(await paint('[data-step-id="circuit-lv"] .flow-busy-fill', 'fill')).not.toBe(await paint('[data-step-id="wire"] .flow-busy-fill', 'fill'));
  expect(await paint('[data-step-id="wire"] .flow-slot-lo', 'fill')).not.toBe(await paint('[data-step-id="wire"] .flow-slot-hi', 'fill'));
});
