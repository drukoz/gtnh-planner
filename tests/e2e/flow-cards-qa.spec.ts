// The Flow cards, full height and Full view, QAed as one page (RUK-815): the review's seven checks over the merged tasks (RUK-809 to RUK-814) —
// a step card as a card, the stubs' and the left-over band's captions, the X/Y rate kept on every tile, the canvas at the window's height less
// its chrome, the plan banner's fold at three notes, Full view with the planner, and the interactions the cards had to keep. The plan is a
// fixture served in place of the server's (`page.route`), the LV circuit line of fixtures/plans.ts with a left-over, a long material name and
// five notes. QA_SHOTS=1 writes a picture of each check under .paperclip-runtime/qa/ for the reviewer.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanFlow, PlanSettings, PlanStep, PlanWarning, RawInput } from '../../src/shared/types/plan.ts';
import type { RecipeSummary, StuffInfo } from '../../src/shared/types/api.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };
const WIRE = 't:copper_wire@0';
const RED = 't:redstone@0';
const RED_NAME = 'Refined Redstone Dust';

/* No reducedMotion: with prefers-reduced-motion Chromium keeps the canvas height from before the --flow-chrome change (Full view
   canvas stays 760 px and the page scrolls), which is a product bug (filed under RUK-740), not a QA fixture's business. */
test.use({ viewport: { width: 1440, height: 900 } });

/** A picture of the page for the reviewer, when asked for. */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.QA_SHOTS === '1') await page.screenshot({ path: `.paperclip-runtime/qa/${name}.png`, fullPage: true });
}

const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });

/** Five notes the plan banner folds: none is an integrity problem, a build note or the derived-line warning, so all five are plain notes. */
const NOTES: PlanWarning[] = [
  { code: 'no-recipe', text: 'Note 1: the wiremill runs at 62 % of its work.', key: WIRE },
  { code: 'avoid-item', text: 'Note 2: the assembler avoids Iron Plate from a blast furnace.', key: 't:iron_plate@0' },
  { code: 'no-recipe', text: 'Note 3: Redstone is bought, as nothing nearby makes it.', key: RED },
  { code: 'avoid-item', text: 'Note 4: the bending machine avoids hammered plates.', key: 't:iron_plate@0' },
  { code: 'no-recipe', text: 'Note 5: the wiremill leaves wire over.', key: WIRE },
];

/**
 * The LV circuit line with what the seven checks need: the wiremill knows two ways to make its wire (the R popup), the wiremill leaves wire
 * over (the bottom band), the redstone is named longer than 14 letters (a tile's cut), and the plan carries five notes (the banner's fold).
 */
function qaPlan(): Plan {
  const plan = circuitLv();
  const ways: PlanStep['alternatives'] = [
    { recipeId: 'wire', rawCost: 0.5, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 1 }], outputs: [{ key: WIRE, amount: 2 }] },
    { recipeId: 'wire-slow', rawCost: 1, mapId: 'gt.recipe.wiremill', inputs: [{ key: 't:copper_ingot@0', amount: 2 }], outputs: [{ key: WIRE, amount: 2 }] },
  ];
  return {
    ...plan,
    names: { ...plan.names, [RED]: RED_NAME },
    steps: plan.steps.map((s) => (s.id === 'wire' ? { ...s, alternatives: ways } : s)),
    flows: [...plan.flows, flow('wire', 'sink', WIRE, 0.25)],
    rawInputs: plan.rawInputs.map((r): RawInput => (r.key === RED ? { ...r, cost: 2 } : r)),
    warnings: [...plan.warnings, ...NOTES],
  };
}

const summary = (id: string, machine: string, inputs: Array<[string, string]>, outputs: Array<[string, string]>): RecipeSummary => ({
  id, source: 'gt', maps: ['gt.recipe.assembler'], machineName: machine, tier: 1, euPerTick: 16, durationTicks: 100,
  inputs: inputs.map(([key, name]) => ({ key, name, amount: 1, consumed: true })),
  outputs: outputs.map(([key, name]) => ({ key, name, amount: 1, chance: 1 })),
});
const assemblerCard = summary('circuit-r', 'Assembler', [[WIRE, '1x Copper Wire'], ['t:iron_plate@0', 'Iron Plate'], [RED, 'Redstone']], [['t:circuit@0', 'Basic Circuit']]);

/** The pack's stuff entries the popup fetches for a good it has no plan list for. */
const PACK: Record<string, StuffInfo> = {
  [WIRE]: { key: WIRE, name: '1x Copper Wire', producers: [], consumers: [assemblerCard] },
};

/** Opens a new project whose plan is `qaPlan()` and whose pack stuff comes from `PACK`; fits the diagram and returns the id. */
async function openQa(page: Page): Promise<string> {
  const plan = qaPlan();
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await page.route('**/api/pack/stuff/**', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/stuff/')[1] ?? '');
    const info = PACK[key];
    return info === undefined ? route.fallback() : route.fulfill({ json: info });
  });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Flow cards QA', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
  await page.getByRole('button', { name: 'Fit' }).click();
  return id;
}

test('card: a step card is a card: title, tier chip, Input and Output, a tile per good with icon, rate and name, a power tile, a machine column and a busy foot', async ({ page }) => {
  await openQa(page);
  const card = page.locator('[data-step-id="circuit-lv"]');
  await expect(card.locator('text.flow-node-title')).toHaveText('Basic Assembler');
  await expect(card.locator('.flow-chip.tier-lv text')).toHaveText('LV');
  await expect(card.locator('text.flow-io-head')).toHaveText(['Input', 'Output']);
  const tiles = card.locator('.flow-tile:not(.power)');
  await expect(tiles).toHaveCount(4); // three goods in, one out
  await expect(tiles.locator('foreignObject [data-item-key]')).toHaveCount(4);
  const names = await tiles.locator('.flow-tile-name').allTextContents();
  const rates = await tiles.locator('.flow-tile-rate').allTextContents();
  expect(names.filter((t) => t.length > 0), names.join(' | ')).toHaveLength(4);
  expect(names.filter((t) => t.length > 14), names.join(' | ')).toEqual([]); // a material name is cut to 14 letters
  expect(rates.filter((t) => t.length > 0), rates.join(' | ')).toHaveLength(4);
  // the power tile under the inputs, and the machine column with its count, its owned word and its icon
  const power = card.locator('.flow-tile.power');
  await expect(power).toHaveCount(1);
  await expect(power.locator('.flow-tile-rate')).toHaveText('16 EU/t');
  await expect(power.locator('.flow-tile-name')).toHaveText('Power');
  await expect(card.locator('.flow-card-count')).toHaveText('×5');
  await expect(card.locator('.flow-card-owned')).toHaveText('new');
  await expect(card.locator('.flow-card-machine [data-item-key]')).toBeVisible();
  // the busy foot band, filled to the assembler's 100 %
  await expect(card.locator('.flow-busy-text')).toContainText('%');
  const track = await card.locator('.flow-busy-track').evaluate((el) => (el as SVGGraphicsElement).getBBox().width);
  const fill = await card.locator('.flow-busy-fill').evaluate((el) => (el as SVGGraphicsElement).getBBox().width);
  expect(fill / track).toBeCloseTo(1, 2);
  // the columns: every input tile stands left of every output tile
  const cols = await page.evaluate(() => {
    const list = (sel: string): DOMRect[] => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect());
    const ins = list('[data-step-id="circuit-lv"] .flow-tile.in:not(.power)');
    const outs = list('[data-step-id="circuit-lv"] .flow-tile.out');
    return { right: Math.max(...ins.map((b) => b.right)), left: Math.min(...outs.map((b) => b.left)) };
  });
  expect(cols.right).toBeLessThan(cols.left);
  await shot(page, '1-card');
});

test('stubs: an import stub is headed "Import · <name>" with its one tile, all imports share the first column, and the target and the left-over say their own word', async ({ page }) => {
  await openQa(page);
  const stubs = page.locator('[data-node-id^="import:"]');
  await expect(stubs).toHaveCount(3);
  const captions = await stubs.locator('text.flow-stub-caption').allTextContents();
  expect(captions.filter((c) => c.startsWith('Import · ')), captions.join(' | ')).toHaveLength(3);
  await expect(stubs.locator('.flow-tile')).toHaveCount(3); // one tile each
  const boxes = [];
  for (let i = 0; i < 3; i++) boxes.push((await stubs.nth(i).boundingBox())!);
  expect(Math.max(...boxes.map((b) => b.x))).toBeLessThan(Math.min(...boxes.map((b) => b.x + b.width))); // one column, stacked
  await expect(page.locator('[data-node-id="out"] text.flow-stub-caption')).toHaveText('Target');
  // the left-over: its band along the bottom, its box inside it, headed "Left over"
  const band = page.locator('[data-left-over]');
  await expect(band).toBeVisible();
  const sink = page.locator('[data-node-id^="sink:"]');
  await expect(sink).toHaveCount(1);
  await expect(sink.locator('text.flow-stub-caption')).toHaveText('Left over');
  const bandBox = (await band.boundingBox())!;
  const sinkBox = (await sink.boundingBox())!;
  expect(sinkBox.y).toBeGreaterThanOrEqual(bandBox.y);
  expect(sinkBox.y + sinkBox.height).toBeLessThanOrEqual(bandBox.y + bandBox.height);
  await shot(page, '2-stubs');
});

test('rates: every tile of every good shows its X/Y rate in the project\'s unit, and the power tile its EU/t', async ({ page }) => {
  await openQa(page);
  const rates = page.locator('svg.flow-canvas .flow-tile:not(.power) .flow-tile-rate');
  const texts = await rates.allTextContents();
  expect(texts.length).toBeGreaterThanOrEqual(8); // every good's tile, in every card and stub
  const perMin = /^\d+(\.\d+)?\/min$/;
  for (const t of texts) expect(t, `the rate "${t}" is an X/Y rate per minute`).toMatch(perMin);
  const ratesOf = (t: string): number => Number(t.split('/')[0]);
  expect(texts.map(ratesOf).filter((r) => r === 60).length).toBeGreaterThan(0); // the wire the wiremill makes
  expect(texts.map(ratesOf).filter((r) => r === 30).length).toBeGreaterThan(0); // the mined goods
  expect(texts.map(ratesOf).filter((r) => r === 15).length).toBeGreaterThan(0); // the left-over wire
  await expect(page.locator('svg.flow-canvas .flow-tile.power .flow-tile-rate').first()).toContainText('EU/t');
  await shot(page, '3-rates');
});

test('height: the canvas is the window\'s height less its chrome, and the page reaches its bottom and its legend by scrolling', async ({ page }) => {
  await openQa(page);
  const canvas = page.locator('svg.flow-canvas');
  expect(await canvas.evaluate((svg) => getComputedStyle(svg as SVGSVGElement).height), '900 px of window less 140 px of chrome').toBe('760px');
  await canvas.evaluate((svg) => svg.scrollIntoView(false));
  const inView = await page.evaluate(() => {
    const c = document.querySelector('svg.flow-canvas')!.getBoundingClientRect();
    return { bottom: c.bottom <= window.innerHeight + 1, top: c.top >= -1, window: window.innerHeight };
  });
  expect(inView.bottom, `the canvas's bottom against a ${inView.window} px window`).toBe(true);
  expect(inView.top, 'the canvas keeps its top in the window').toBe(true);
  const legend = page.locator('ul.flow-legend');
  await legend.scrollIntoViewIfNeeded();
  await expect(legend).toBeInViewport();
  await shot(page, '4-height');
});

test('banner: five notes show three and "2 more notes"; opening the fold shows the other two', async ({ page }) => {
  await openQa(page);
  const shown = page.locator('.plan-banner > ul.warnings > li');
  await expect(shown).toHaveCount(3);
  for (const n of NOTES.slice(0, 3)) await expect(shown.filter({ hasText: n.text })).toBeVisible();
  const more = page.locator('.plan-banner details.banner-more');
  await expect(more.locator('summary')).toHaveText('2 more notes');
  const folded = more.locator('li');
  for (const n of NOTES.slice(3)) await expect(folded.filter({ hasText: n.text })).toBeHidden();
  await more.locator('summary').click();
  expect(await more.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  for (const n of NOTES.slice(3)) await expect(folded.filter({ hasText: n.text })).toBeVisible();
  await shot(page, '5-banner');
});

test('full view: Full view hides the banners and keeps the page in the window with the planner beside it, and Hide planner widens the chart, both kept', async ({ page }) => {
  await openQa(page);
  const canvas = page.locator('svg.flow-canvas');
  await page.getByRole('button', { name: 'Full view' }).click();
  await expect(page.locator('.project-banners')).toBeHidden();
  await expect(page.locator('main.project-page')).toHaveClass(/flow-full/);
  // the planner stays beside the chart in Full view (Hide planner is what gives the chart its width)
  await expect(page.getByRole('complementary', { name: 'Project settings' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), 'the window holds the page').toBe(true);
  expect(await page.evaluate(() => document.querySelector('ul.flow-legend')!.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  const beside = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Hide planner' }).click();
  await expect(page.locator('.settings-panel')).toBeHidden();
  const wide = (await canvas.boundingBox())!;
  expect(wide.width).toBeGreaterThan(beside.width);
  // a reload keeps both choices
  await page.reload();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  await expect(page.locator('main.project-page')).toHaveClass(/flow-full/);
  await expect(page.locator('.settings-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show planner' })).toBeVisible();
  await shot(page, '6-full-view');
});

test('interaction: a tile lights its good, a card\'s head opens its panel, R on a made good opens its recipes, and Tab reaches the tiles', async ({ page }) => {
  await openQa(page);
  // hovering an input tile lights the good: the tile, the pipe that carries it and the stub that buys it
  const tile = page.locator(`[data-step-id="circuit-lv"] .flow-tile.in[data-key="${RED}"]`);
  await tile.hover();
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/focusing/);
  await expect(tile).toHaveClass(/hl/);
  await expect(page.locator(`.flow-edge[data-key="${RED}"]`)).toHaveClass(/hl/);
  await expect(page.locator(`[data-node-id="import:${RED}@circuit-lv"]`)).toHaveClass(/hl/);
  await shot(page, '7a-hover');
  // clicking the card's head opens its panel beside the chart
  await page.locator('[data-step-id="wire"] .flow-node-head').click();
  await expect(page.getByRole('complementary', { name: 'Step: Basic Wiremill' })).toBeVisible();
  // R on a made good lists the recipes that make it
  await page.keyboard.press('Escape');
  await page.locator(`[data-port$="|out|${WIRE}"]`).first().hover();
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog', { name: 'Recipes for 1x Copper Wire' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // the keyboard: from a card's head, Tab reaches one of its tiles
  await page.locator('[data-step-id="wire"] .flow-node-head').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('flow-tile') ?? false), 'Tab moves from the head to a tile').toBe(true);
  await shot(page, '7b-interaction');
});
