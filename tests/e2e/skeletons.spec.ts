// Skeletons and the progress arrow (Phase 2 spec §11, Task 8): every loading line stays as it is, with an aria-hidden skeleton of what is
// coming beside it, whose sheen passes three times (once, for a millisecond, under reduced motion) and which goes when the data comes; the
// Compare card's two (plan ruling compare-skeletons) fall as its tiles will. The plan's busy line carries the GT progress arrow, which keeps
// its fill in forced colours, and it moves nothing on the page (ledger ruling P2-R18): it hangs over the end of the tab strip, out of the
// flow, so a plan event, which every replan and other projects' surplus send, no longer moves the views under the banners. Chromium draws
// each; the plan or the compare is held on its way by a route.

import { test, expect, type Page, type Route } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, holdPlans, holdReplan, login, LV_CIRCUITS, openWithPlan, setName } from './helpers.ts';

/** Holds every request for a project's plan until the returned function is called; each then goes on to the server. */
async function holdPlan(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/projects/*/plan', async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

/** What the sheen of a skeleton's first block runs: its count and duration. */
const sheenOf = (page: Page): Promise<{ count: string; duration: string }> => page.locator('.tab-panel .skeleton-block').first().evaluate((el) => {
  const style = getComputedStyle(el, '::after');
  return { count: style.animationIterationCount, duration: style.animationDuration };
});

test('a plan on its way shows its loading line and a skeleton, which go when the plan comes', async ({ page }) => {
  const release = await holdPlan(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton', LV_CIRCUITS);
  await expect(page.getByText('Planning…')).toBeVisible();
  await expect(page.locator('.tab-panel .skeleton-diagram[aria-hidden="true"]')).toBeVisible();
  expect((await sheenOf(page)).count).toBe('3');
  release();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('under reduced motion the sheen runs once, for a millisecond', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const release = await holdPlan(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton still', LV_CIRCUITS);
  await expect(page.locator('.tab-panel .skeleton-diagram')).toBeVisible();
  expect(await sheenOf(page)).toEqual({ count: '1', duration: '0.001s' });
  release();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('in forced colours the busy line\'s arrow keeps its fill', async ({ page }) => {
  const id = await openWithPlan(page, circuitLv());
  const hold = await holdPlans(page, id);
  const res = await page.request.post(`/api/projects/${id}/ops`, { data: { ops: [{ op: 'settings', patch: { amount: 31 } }] }, headers: { 'X-Planner-Name': 'e2e' } });
  expect(res.ok()).toBe(true);
  await expect(page.getByText('Updating the plan…')).toBeVisible();                  // the refetch its plan event starts hangs
  await page.emulateMedia({ forcedColors: 'active' });
  const paint = await page.locator('.plan-banner .gt-arrow.on-chat .gt-arrow-fill').evaluate((fill) => ({
    fill: getComputedStyle(fill).backgroundColor, base: getComputedStyle(fill.parentElement!).backgroundColor,
  }));
  expect(paint.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(paint.fill).not.toBe(paint.base);
  await hold.release();
  await expect(page.getByText('Updating the plan…')).toHaveCount(0);
});

test('in forced colours a skeleton\'s blocks keep their shape on the well', async ({ page }) => {
  // P2-R41: checked by painted pixels. The theme paints every background its canvas colour, the well's and the blocks' alike, so the blocks
  // take GrayText: a block's middle is painted, and unlike the well beside it
  await page.emulateMedia({ forcedColors: 'active' });
  const release = await holdPlan(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton forced', LV_CIRCUITS);
  const well = page.locator('.tab-panel .skeleton-diagram');
  await expect(well).toBeVisible();
  const block = (await well.locator('.skeleton-block').first().boundingBox())!;
  const frame = (await well.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, animations: 'disabled' });
  const pixels = await page.evaluate(async ([png, points]) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const g = canvas.getContext('2d')!;
    g.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...g.getImageData(x!, y!, 1, 1).data.slice(0, 3)]);
  }, [shot.toString('base64'), [
    [Math.round(block.x - frame.x + block.width / 2), Math.round(block.y - frame.y + block.height / 2)],   // a block's middle
    [Math.round(block.x - frame.x + block.width + 20), Math.round(block.y - frame.y + block.height / 2)], // the well, between two blocks
  ]] as const);
  expect(pixels[0], 'a block keeps its shape: it is not painted as the well round it is').not.toEqual(pixels[1]);
  release();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// ledger ruling P2-R18: a plan event shows the busy line until the plan is fetched again, and the line no longer moves the page: it hangs from
// the banners' box over the end of the tab strip, so the strip, the views and everything under them stay where they are, whether the banner
// says nothing else (the line was a whole banner of 60.3 px) or lists the plan's warnings (a line of 24.3 px at their top).
for (const [what, open] of [
  ['the banner says nothing else', async (page: Page) => openWithPlan(page, circuitLv(), { ...LV_CIRCUITS, useSurplus: false })],
  ['the banner lists warnings', async (page: Page) => {
    await login(page); await setName(page, 'Ann');
    const id = await createProject(page, 'Busy line', { ...LV_CIRCUITS, useSurplus: false });
    await expect(page.locator('.plan-banner .warnings li').first()).toBeVisible();
    return id;
  }],
] as const) {
  test(`a plan event's busy line moves nothing on the page: ${what}`, async ({ page }) => {
    const id = await open(page);
    await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
    const where = (): Promise<number[]> => page.evaluate(() => ['.tabs', '.tab-panel', '.project-banners', 'svg.flow-canvas']
      .map((selector) => document.querySelector(selector)!.getBoundingClientRect()).flatMap((r) => [r.top, r.height]));
    const before = await where();
    const letThrough = await holdReplan(page, id);                                    // "Updating the plan…" shows
    const busy = page.getByText('Updating the plan…');
    expect(await where(), 'nothing moves while the plan is on its way').toEqual(before);
    // it sits over the tab strip, level with its tabs and at the end of the views, clear of every tab on this window
    const [line, tabs, views] = await Promise.all([busy.boundingBox(), page.locator('.tabs').boundingBox(), page.locator('.project-views').boundingBox()]);
    expect(line!.y).toBeGreaterThanOrEqual(tabs!.y);
    expect(line!.y + line!.height).toBeLessThanOrEqual(tabs!.y + tabs!.height);
    expect(line!.x + line!.width).toBeCloseTo(views!.x + views!.width, 3);
    const lastTab = (await page.getByRole('tab').last().boundingBox())!;
    expect(line!.x, 'clear of the last tab').toBeGreaterThan(lastTab.x + lastTab.width);
    // it takes no pointer: what is under it is what a click reaches
    const atLine = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.plan-banner') ?? null, [line!.x + 4, line!.y + line!.height / 2]);
    expect(atLine, 'the busy line takes no pointer').toBeNull();
    await letThrough();
    expect(await where(), 'nor when it goes').toEqual(before);
  });
}

// plan ruling compare-skeletons: the Compare card's skeleton is three frames in its columns' grid, each framed as a column and holding six blocks
// in the tiles' own grid, so its blocks fall as the tiles will: two a row on a wide card, stacked where a column is too narrow for two (860 px,
// objectives.spec.ts's width); a mode still planning keeps its six figures' place with a frame's blocks of its own.
const S = { rawPerHour: 12.5, rawBuild: 40, newMachines: 4, rawSources: 3, steps: 6, peakEUt: 96 };
const ANSWER = {
  rev: 1, current: 'cheapest',
  modes: [{ objective: 'least-raw', status: 'ok', summary: S }, { objective: 'cheapest', status: 'ok', summary: S }, { objective: 'multi-output', status: 'pending' }],
};
/** The distinct rows the boxes of `selector` sit in (their tops, rounded). */
const rowsOf = (page: Page, selector: string): Promise<number> => page.locator(selector).evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);

for (const [width, height, rows] of [[1280, 720, 3], [860, 900, 6]] as const) {
  test(`the Compare card shows a skeleton while it plans the three modes, and a mode still planning keeps its figures place, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page); await setName(page, 'Ann');
    await createProject(page, `Compare skeleton at ${width}`, LV_CIRCUITS);
    const held: Route[] = [];
    await page.route('**/api/projects/*/compare', (route) => { held.push(route); });
    const answer = async (): Promise<void> => { for (const route of held.splice(0)) await route.fulfill({ json: ANSWER }); };
    await page.getByRole('button', { name: 'Compare modes' }).click();                // the head's, or the bar's below 900 px
    const card = page.locator('.compare-card');
    await expect(page.getByText('Planning the three modes…')).toBeVisible();
    await expect(card.locator(".skeleton-compare[aria-hidden='true']")).toBeVisible();
    const frame = '.compare-card .skeleton-compare > .skeleton-readouts:first-child > .skeleton-block';
    await expect(page.locator(frame)).toHaveCount(6);
    expect(await rowsOf(page, frame), `the frame's six blocks in ${rows} rows`).toBe(rows);
    await expect.poll(() => held.length, { message: 'the card asks for the compare' }).toBeGreaterThan(0);
    await answer();
    await expect(card.locator('.skeleton-compare')).toHaveCount(0);
    await expect(card.locator(".compare-column[data-objective='multi-output'] .skeleton-readouts")).toBeVisible();
    await expect(card.locator(".compare-column[data-objective='cheapest'] .skeleton")).toHaveCount(0);
    expect(await rowsOf(page, ".compare-column[data-objective='least-raw'] .compare-row"), 'the tiles fall as the frame\'s blocks did').toBe(rows);
    expect(await rowsOf(page, ".compare-column[data-objective='multi-output'] .skeleton-readouts > .skeleton-block"), 'and so do a pending mode\'s').toBe(rows);
    if (width === 1280) {
      // another target picked with the card open (68c06c1): the old figures go, and the planning line comes back with its skeleton
      const settings = page.getByRole('complementary', { name: 'Project settings' });
      await settings.getByPlaceholder('Search items and fluids').fill('iron plate');
      await settings.getByRole('listbox', { name: 'Matches' }).getByRole('option', { name: /Iron Plate/ }).click();
      await expect(card.locator('[data-objective]')).toHaveCount(0);
      await expect(card.getByText('Planning the three modes…')).toBeVisible();
      await expect(card.locator('.skeleton-compare')).toBeVisible();
      await expect.poll(() => held.length, { message: 'the card asks for the new target\'s compare' }).toBeGreaterThan(0);
      await answer();
      await expect(card.locator('.skeleton-compare')).toHaveCount(0);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
