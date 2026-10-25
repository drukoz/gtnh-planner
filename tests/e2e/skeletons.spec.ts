// Skeletons and the progress arrow (Phase 2 spec §11, Task 8): every loading line stays as it is, with an aria-hidden skeleton of what is
// coming beside it, whose sheen passes three times (once, for a millisecond, under reduced motion) and which goes when the data comes; the
// Compare card's two (plan ruling compare-skeletons) fall as its tiles will; the strip's is drawn in the tiles' own dark face (ledger ruling
// P2-R53). The plan's busy line carries the GT progress arrow, which keeps its fill in forced colours, and it moves nothing on the page (ledger
// ruling P2-R18): out of the flow, it sits on the key-numbers strip's top-right corner, over that tile's label row, clear of every control and
// figure at every width (P2-R51), and with no strip it is out of sight. Chromium draws each; the plan or the compare is held on its way by a
// route.

import { test, expect, type Page, type Route } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, holdPlans, holdReplan, login, LV_CIRCUITS, openWithPlan, setName } from './helpers.ts';

/** What the sheen of a skeleton's first block runs: its count and duration. */
const sheenOf = (page: Page): Promise<{ count: string; duration: string }> => page.locator('.tab-panel .skeleton-block').first().evaluate((el) => {
  const style = getComputedStyle(el, '::after');
  return { count: style.animationIterationCount, duration: style.animationDuration };
});

test('a plan on its way shows its loading line and a skeleton, which go when the plan comes', async ({ page }) => {
  const plans = await holdPlans(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton', LV_CIRCUITS);
  await expect(page.getByText('Planning…')).toBeVisible();
  await expect(page.locator('.tab-panel .skeleton-diagram[aria-hidden="true"]')).toBeVisible();
  expect((await sheenOf(page)).count).toBe('3');
  // ledger ruling P2-R53: the strip's place is drawn in the tiles' own dark face, so the figures come with no flash from a lighter grey
  const face = (el: Element): string => getComputedStyle(el).backgroundColor;
  const waiting = await page.locator('.key-numbers-wait .skeleton-block').first().evaluate(face);
  await plans.release();
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  expect(waiting, 'the strip\'s skeleton is in the face of the tiles that take its place').toBe(await page.locator('.key-number').first().evaluate(face));
});

test('under reduced motion the sheen runs once, for a millisecond', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const plans = await holdPlans(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton still', LV_CIRCUITS);
  await expect(page.locator('.tab-panel .skeleton-diagram')).toBeVisible();
  expect(await sheenOf(page)).toEqual({ count: '1', duration: '0.001s' });
  await plans.release();
  await expect(page.locator('.skeleton')).toHaveCount(0);
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

test('in forced colours a skeleton\'s blocks keep their shape on the well and on the page', async ({ page }) => {
  // P2-R41: checked by painted pixels. The theme paints every background its canvas colour, the well's, the page's and the blocks' alike, so
  // the blocks take GrayText: a block's middle is painted, and unlike what lies beside it, in the diagram's well and in the strip's place
  await page.emulateMedia({ forcedColors: 'active' });
  const plans = await holdPlans(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Skeleton forced', LV_CIRCUITS);
  const well = page.locator('.tab-panel .skeleton-diagram');
  await expect(well).toBeVisible();
  /** The colours a screenshot of `frame` paints at `points` (page pixels). */
  const paintAt = async (frame: { x: number; y: number; width: number; height: number }, points: number[][]): Promise<number[][]> => {
    const shot = await page.screenshot({ clip: frame, animations: 'disabled' });
    return page.evaluate(async ([png, at]) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const g = canvas.getContext('2d')!;
      g.drawImage(image, 0, 0);
      return at.map(([x, y]) => [...g.getImageData(x!, y!, 1, 1).data.slice(0, 3)]);
    }, [shot.toString('base64'), points.map(([x, y]) => [Math.round(x! - frame.x), Math.round(y! - frame.y)])] as const);
  };
  const block = (await well.locator('.skeleton-block').first().boundingBox())!;
  const inWell = await paintAt((await well.boundingBox())!, [
    [block.x + block.width / 2, block.y + block.height / 2],                         // a block's middle
    [block.x + block.width + 20, block.y + block.height / 2],                        // the well, between two blocks
  ]);
  expect(inWell[0], 'a block keeps its shape: it is not painted as the well round it is').not.toEqual(inWell[1]);
  const tile = (await page.locator('.key-numbers-wait .skeleton-block').first().boundingBox())!;
  const strip = (await page.locator('.key-numbers-wait').boundingBox())!;
  const onPage = await paintAt(strip, [
    [tile.x + tile.width / 2, tile.y + tile.height / 2],                              // the strip's first block
    [tile.x + tile.width + 4, tile.y + tile.height / 2],                              // the page, in the gap after it
  ]);
  expect(onPage[0], 'a strip block keeps its shape: it is not painted as the page beside it is').not.toEqual(onPage[1]);
  await plans.release();
  await expect(page.locator('.skeleton')).toHaveCount(0);
});

/**
 * Where the busy line is and what it meets, read in the page: its box and the strip's, every control it meets, every figure it meets and every
 * tile but the top-right one that it meets (a control: a button, link, field, tab or anything that takes the focus; a figure: a tile's `dd`).
 */
function busyLine(): { line: number[]; strip: number[]; controls: string[]; figures: string[]; otherTiles: number } {
  const box = (el: Element): number[] => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const meets = (a: number[], b: number[]): boolean => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
  const line = [...document.querySelectorAll('.plan-banner > p.muted')][0]!;
  const strip = document.querySelector('.key-numbers > dl')!;
  const tiles = [...strip.querySelectorAll('.key-number')].map(box);
  const top = Math.min(...tiles.map((t) => t[1]!));
  const corner = tiles.filter((t) => t[1] === top).sort((a, b) => b[2]! - a[2]!)[0]!;
  const at = box(line);
  const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
  const controls = [...document.querySelectorAll('button, a, input, select, [role=tab], [tabindex]')]
    .filter((el) => el.checkVisibility() && el.getClientRects().length > 0 && meets(at, box(el))).map(name);
  const figures = [...document.querySelectorAll('.key-number dd')].filter((dd) => meets(at, box(dd))).map(name);
  const otherTiles = tiles.filter((t) => t !== corner && meets(at, t)).length;
  return { line: at, strip: box(strip), controls, figures, otherTiles };
}

// ledger rulings P2-R18 and P2-R51: a plan event shows the busy line until the plan is fetched again, and the line moves nothing on the page:
// it sits on the key-numbers strip's top-right corner, so the strip, the views and everything under them stay where they are, whether the
// banner says nothing else (the line was a whole banner of 60.3 px) or lists the plan's warnings (a line of 24.3 px at their top).
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
    expect(await where(), 'nothing moves while the plan is on its way').toEqual(before);
    // on the strip's top-right corner, 20 px tall: the tile's edge, padding and label line
    const { line, strip } = await page.evaluate(busyLine);
    expect([line[1], line[2], line[3]! - line[1]!]).toEqual([strip[1], strip[2], 20]);
    // it takes no pointer: what is under it is what a click reaches
    const atLine = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.plan-banner') ?? null, [line[0]! + 4, line[1]! + 10]);
    expect(atLine, 'the busy line takes no pointer').toBeNull();
    await letThrough();
    expect(await where(), 'nor when it goes').toEqual(before);
  });
}

// ledger ruling P2-R51: the busy line covers only the label row of the strip's top-right tile, whatever the window: no control (the tabs least
// of all, which it once covered wherever they filled their strip) and no figure, and the tabs stay where they are while it shows
test('the busy line sits on the strip\'s top-right corner, clear of every control and figure, at every width', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Busy corner', { ...LV_CIRCUITS, useSurplus: false });   // a target: no drawer opens below 900 px
  await expect(page.locator('svg.flow-canvas [data-step-id]').first()).toBeVisible();
  for (const width of [320, 390, 700, 800, 901, 1024, 1140, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const tabs = async (): Promise<number> => (await page.locator('.tabs').boundingBox())!.y;
    const before = await tabs();
    const letThrough = await holdReplan(page, id);
    const at = await page.evaluate(busyLine);
    expect(at.controls, `${width} px: controls under the busy line`).toEqual([]);
    expect(at.figures, `${width} px: figures under the busy line`).toEqual([]);
    // in the top-right tile's top 20 px, its edge, its padding and its label row, and on no other tile
    expect(at.line[1], `${width} px: on the strip's top`).toBe(at.strip[1]);
    expect(at.line[2], `${width} px: at the strip's right end`).toBe(at.strip[2]);
    expect(at.line[3]! - at.line[1]!, `${width} px: as tall as the label row`).toBe(20);
    expect(at.otherTiles, `${width} px: tiles but the top-right one under the busy line`).toBe(0);
    expect(await tabs(), `${width} px: the tabs stay where they are`).toBe(before);
    await letThrough();
  }
});

// ledger ruling P2-R51: a project with no target draws no strip, and its busy line is clipped from sight as `.visually-hidden` clips: still in
// the banner's status for a screen reader, still found by its words
test('with no strip the busy line is out of sight, for assistive technology only', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Busy, nothing yet');                          // no target: no strip (a wide window: no drawer)
  await expect(page.getByRole('button', { name: 'Pick something to make' })).toBeVisible();
  const before = await page.evaluate(() => document.querySelector('.tabs')!.getBoundingClientRect().top);
  const letThrough = await holdReplan(page, id);
  await expect(page.locator('.key-numbers')).toHaveCount(0);
  const line = page.locator('.plan-banner[role=status] > p.muted');
  expect(await line.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(el).clipPath]; })).toEqual([1, 1, 'inset(50%)']);
  expect(await page.evaluate(() => document.querySelector('.tabs')!.getBoundingClientRect().top)).toBe(before);
  await letThrough();
});

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
    // every compare the card asks for is held until answered; once `answering`, each is answered at once. The card fetches again on every
    // plan or compare event, and a fetch it asks for while one is on its way waits for that one: a held fetch of the old target's still on its
    // way when the target changes is answered and dropped, and only then is the new target's asked for
    const held: Route[] = [];
    let answering = false;
    await page.route('**/api/projects/*/compare', (route) => {
      if (answering) void route.fulfill({ json: ANSWER });
      else held.push(route);
    });
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
      await expect.poll(() => held.length, { message: 'the card asks for a compare' }).toBeGreaterThan(0);
      answering = true;                                                               // this one, and the new target's if it is still to come
      await answer();
      await expect(card.locator('.skeleton-compare')).toHaveCount(0);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
