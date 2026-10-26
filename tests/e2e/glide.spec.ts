// The diagrams glide (Phase 2 spec §16.2, §16.4 and §16.5, Task 13a; review focus 1): Fit, the zoom buttons and a reveal pan a diagram's view
// over 250 ms, a WAAPI animation of its pan group's CSS `transform` from the picture on screen to the view its `transform` attribute holds at
// once; under reduced motion they move it at once; the wheel and a drag move it at once, from the picture on screen, and stop a pan under way.
// An init script records every `Element.prototype.animate` call in `window.__animations` and makes the call as asked; every case leaves out
// the records of the check `canGlide()` makes once, on a probe group of its own (`glide-probe`). Every Flow case that presses Fit first
// drags the canvas, at once, so that Fit has somewhere to go. Task 13a adds: the zoom buttons, a reveal and a new plan's view pan too; the goods
// ride and the pipes run on through a pan (they are inside the pan group); and a panel's Close while a pan runs gives the focus to the box head
// where the pan ends (ledger rulings P2-R35 and P2-R36 read the view the attribute holds, not the picture on its way there).

import { test, expect, type Page } from '@playwright/test';
import { matrixView, panTransform, type PanView } from '../../src/client/views/glide.ts';
import { circuitLv, platesTwoWays } from './fixtures/plans.ts';
import { bodyFocusCount, finishMotion, openConnections, openWithPlan, watchBodyFocus } from './helpers.ts';

/** One `animate()` call: the element's class, its box or arrow (`data-node-id`, `data-edge-id` or `data-node`), its timing and its keyframes. */
interface AnimationRecord {
  cls: string | null; node: string | null; duration: unknown; delay: unknown; fill: unknown; frames: Array<Record<string, unknown>>;
}

/** Runs in the page before its scripts: records every `Element.prototype.animate` call in `window.__animations`, then makes it as asked. */
function recordAnimations(): void {
  const records: unknown[] = [];
  (window as unknown as { __animations: unknown[] }).__animations = records;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function recorded(
    this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions,
  ): Animation {
    const timing: KeyframeAnimationOptions = typeof options === 'number' ? { duration: options } : options ?? {};
    records.push({
      cls: this.getAttribute('class'),
      node: this.getAttribute('data-node-id') ?? this.getAttribute('data-edge-id') ?? this.getAttribute('data-node'),
      duration: timing.duration, delay: timing.delay ?? 0, fill: timing.fill, frames: JSON.parse(JSON.stringify(frames)) as unknown,
    });
    return animate.call(this, frames, options);
  };
}

/** Every `animate()` call the page has made, the probe's of `canGlide()` included. */
const allRecords = (page: Page): Promise<AnimationRecord[]> => page.evaluate(() => (window as unknown as { __animations: AnimationRecord[] }).__animations);

/** The page's `animate()` calls but the probe's of `canGlide()` (on its own `g.glide-probe`). */
const records = async (page: Page): Promise<AnimationRecord[]> => (await allRecords(page)).filter((r) => r.cls !== 'glide-probe');

/** A diagram's view from its pan group's `transform` attribute, `translate(x y) scale(k)` (as connections.spec.ts reads it). */
function attributeView(transform: string | null): PanView {
  const [x, y, scale] = (/^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(transform ?? '') ?? []).slice(1).map(Number);
  if (x === undefined || y === undefined || scale === undefined) throw new Error(`no view in the transform "${transform}"`);
  return { x, y, scale };
}

/** Drags the Flow canvas by (dx, dy), from its top left corner, which the diagram leaves empty (pipes.spec.ts): an instant move. */
async function dragCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('svg.flow-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 + dx, box.y + 6 + dy, { steps: 5 });
  await page.mouse.up();
}

/**
 * Clicks Fit (a script's click, which moves no focus) and, a frame later, holds the pan it started, at `ms` of its 250 ms: returns the
 * transform the browser computes for the pan group then, the picture on screen, which only the pan sets.
 */
function fitHeldAt(page: Page, ms: number): Promise<string> {
  return page.getByRole('button', { name: 'Fit' }).evaluate(async (button, at) => {
    (button as HTMLButtonElement).click();
    await new Promise((done) => requestAnimationFrame(done));
    const g = document.querySelector('svg.flow-canvas > g.flow-pan');
    const pan = g?.getAnimations()[0];
    if (g === null || pan === undefined) throw new Error('Fit started no pan');
    pan.pause();
    pan.currentTime = at;
    return getComputedStyle(g).transform;
  }, ms);
}

/**
 * The animations of the page that end, each in words (a pan by its id, a CSS animation by its name, a transition by its property, and the
 * class of what it moves) with the time it ends at, in ms of its own.
 */
const finiteAnimations = (page: Page): Promise<Array<{ what: string; ends: number }>> => page.evaluate(() => document.getAnimations()
  .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
  .map((a) => {
    const name = a instanceof CSSAnimation ? a.animationName : a instanceof CSSTransition ? a.transitionProperty : a.id;
    const on = (a.effect as KeyframeEffect | null)?.target?.getAttribute('class') ?? '?';
    return { what: `${a.constructor.name} ${name} on ${on}`, ends: Number(a.effect?.getComputedTiming().endTime) };
  }));

// spec §16.5 (1)
test('Fit pans over 250 ms, its attribute already final', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  const pan = page.locator('svg.flow-canvas > g.flow-pan');
  const dragged = await pan.getAttribute('transform');
  expect(await records(page), 'the view opened and was dragged at once').toEqual([]);
  await page.getByRole('button', { name: 'Fit' }).click();
  const fitted = await pan.getAttribute('transform');                                  // read at once
  expect(fitted, 'Fit moves the view').not.toBe(dragged);
  const glides = await records(page);
  expect(glides).toHaveLength(1);
  expect(glides[0]).toMatchObject({ cls: 'flow-pan', node: null, duration: 250, delay: 0, fill: 'none' });
  // absolute keyframes, from the picture on screen to the attribute (spec §16.1: never an implicit end)
  expect(glides[0]!.frames).toEqual([{ transform: panTransform(attributeView(dragged)) }, { transform: panTransform(attributeView(fitted)) }]);
  await finishMotion(page);
  expect(await pan.getAttribute('transform'), 'the attribute was final at once').toBe(fitted);
  // and the picture on screen is the attribute's: a box's width on screen over its own width is the attribute's scale
  const rect = page.locator('svg.flow-canvas rect.flow-node-box').first();
  const box = await rect.boundingBox();
  if (box === null) throw new Error('no box');
  expect(Math.abs(box.width / Number(await rect.getAttribute('width')) - attributeView(fitted).scale)).toBeLessThanOrEqual(0.01);
  // the first pan asked whether the browser can pan, on a probe of its own that is gone again (notes 5)
  expect((await allRecords(page)).filter((r) => r.cls === 'glide-probe'), 'canGlide()\'s probe ran once').toHaveLength(1);
  await expect(page.locator('.glide-probe')).toHaveCount(0);
});

// spec §16.5 (3)
test('under reduced motion Fit and the zoom buttons move at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  const pan = page.locator('svg.flow-canvas > g.flow-pan');
  for (const name of ['Fit', 'Zoom in', 'Zoom out']) {
    const before = await pan.getAttribute('transform');
    await page.getByRole('button', { name }).click();
    expect(await pan.getAttribute('transform'), `${name} moves the view at once`).not.toBe(before);
  }
  expect(await records(page)).toEqual([]);
  // reduced motion is asked first, so the check of what the browser can glide never ran either (notes: the probe never runs for nothing)
  expect(await allRecords(page), 'canGlide()\'s probe').toEqual([]);
  // the reduced-motion block turns every change into a transition of 1 ms (`transition-duration: 1ms` on everything, whose property is `all`:
  // a button's hover, the view's attribute too): at once nothing that ends lasts longer, as a pan of 250 ms would, and once those have run,
  // nothing that ends is left
  expect((await finiteAnimations(page)).filter((a) => a.ends > 1)).toEqual([]);
  await expect.poll(() => finiteAnimations(page)).toEqual([]);
});

// spec §16.5 (4); review focus 1: the wheel zooms the picture on screen, around the pointer
test('a wheel turn during a Fit leaves no pan running', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  const canvas = page.locator('svg.flow-canvas');
  const pan = canvas.locator(':scope > g.flow-pan');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  const held = matrixView(await fitHeldAt(page, 125));                                 // the pan held half way, so the turn comes during it
  if (held === null) throw new Error('no pan on screen');
  const [px, py] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];   // a wheel event's clientX and clientY are whole
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => pan.evaluate((g) => g.getAnimations().length), { message: 'the pan stops' }).toBe(0);
  // one turn's zoom (FlowView's WHEEL_ZOOM per pixel) around the pointer, from the picture the pan showed, not from where it was going
  const factor = Math.exp(100 * 0.0015);
  const [wx, wy] = [px - box.x, py - box.y];
  await expect.poll(async () => attributeView(await pan.getAttribute('transform')).scale).toBeCloseTo(held.scale * factor, 6);
  const now = attributeView(await pan.getAttribute('transform'));
  expect(now.x).toBeCloseTo(wx - (wx - held.x) * factor, 3);
  expect(now.y).toBeCloseTo(wy - (wy - held.y) * factor, 3);
  expect(await records(page), 'the turn moved the view at once').toHaveLength(1);
});

// spec §16.5 (5)
test('Connections\' Fit glides, its attribute final at once', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  const view = await openConnections(page);
  const pan = view.locator('g.conn-pan');
  // the view the picture was fitted at, once the area has its size (a read that holds from one poll to the next, as shortcuts.spec.ts reads it)
  let fitted = await pan.getAttribute('transform');
  await expect.poll(async () => {
    const now = await pan.getAttribute('transform');
    const held = now === fitted;
    fitted = now;
    return held;
  }).toBe(true);
  const area = await view.getByRole('group', { name: 'Connections of the line' }).boundingBox();
  if (area === null) throw new Error('no area');
  const [x, y] = [Math.round(area.x + area.width / 2), Math.round(area.y + area.height / 2)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 60, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => pan.getAttribute('transform')).not.toBe(fitted);
  const dragged = await pan.getAttribute('transform');
  // the picture's own records (the line's Flow tab, shown first while the line was planned, may have panned to a new plan's view)
  const pictures = async (): Promise<AnimationRecord[]> => (await records(page)).filter((r) => r.cls === 'conn-pan');
  expect(await pictures(), 'the picture was fitted and dragged at once').toEqual([]);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  expect(await pan.getAttribute('transform'), 'the attribute is the fitted view at once').toBe(fitted);
  const glides = await pictures();
  expect(glides).toHaveLength(1);
  expect(glides[0]).toMatchObject({ cls: 'conn-pan', node: null, duration: 250, delay: 0, fill: 'none' });
  expect(glides[0]!.frames).toEqual([{ transform: panTransform(attributeView(dragged)) }, { transform: panTransform(attributeView(fitted)) }]);
});

// spec §16.5's case for review focus 1
test('a drag that starts while Fit pans carries on from the picture on screen', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  const canvas = page.locator('svg.flow-canvas');
  const pan = canvas.locator(':scope > g.flow-pan');
  const held = matrixView(await fitHeldAt(page, 125));
  if (held === null) throw new Error('no pan on screen');
  const fitted = attributeView(await pan.getAttribute('transform'));
  expect(held.x === fitted.x && held.y === fitted.y, 'the premise: the picture on screen is not yet where the pan goes').toBe(false);
  // a drag may start anywhere: from the canvas's top left corner, 40 px right and 20 down
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 26, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => attributeView(await pan.getAttribute('transform')).x).toBeCloseTo(held.x + 40, 0);
  const now = attributeView(await pan.getAttribute('transform'));
  expect(now.y).toBeCloseTo(held.y + 20, 0);
  expect(now.scale, 'at the zoom on screen').toBe(held.scale);
  expect(await pan.evaluate((g) => g.getAnimations().length), 'no pan runs').toBe(0);
  expect(await records(page), 'the drag moved the view at once').toHaveLength(1);
});

// Phase 2 spec §16.2's other glides: the zoom buttons and a reveal (Find item) pan too, each to the view its attribute holds at once
test('the zoom buttons and Find item pan too, each to the attribute', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  const pan = page.locator('svg.flow-canvas > g.flow-pan');
  const ends: string[] = [];
  for (const name of ['Zoom in', 'Zoom out']) {
    await page.getByRole('button', { name }).click();
    ends.push(panTransform(attributeView(await pan.getAttribute('transform'))));
  }
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/\bfocusing\b/);
  // the reveal centres the wire's maker once the light is drawn: its pan starts with the view it goes to
  await expect.poll(async () => (await records(page)).length, { message: 'Find item pans' }).toBe(3);
  ends.push(panTransform(attributeView(await pan.getAttribute('transform'))));
  const glides = await records(page);
  expect(glides.map((g) => [g.cls, g.duration, g.fill, g.frames.length])).toEqual(Array(3).fill(['flow-pan', 250, 'none', 2]));
  expect(glides.map((g) => g.frames[1]?.transform)).toEqual(ends);
});

// Phase 2 spec §16.2: the view a new plan opens on (its steps changed: `viewKey`) is panned to from the last plan's picture; the first opened
// at once
test('a new plan\'s view is panned to from the picture of the last', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  const id = await openWithPlan(page, platesTwoWays());
  const pan = page.locator('svg.flow-canvas > g.flow-pan');
  const before = await pan.getAttribute('transform');
  expect(await records(page), 'the first plan opened at once').toEqual([]);
  // the next plan has other steps (a later route wins over openWithPlan's), brought by the plan event of a settings op
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: circuitLv() }));
  const ops = [{ op: 'settings', patch: { amount: 31 } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(3);
  await expect.poll(async () => (await records(page)).length, { message: 'the new plan\'s view pans' }).toBe(1);
  const [glide] = await records(page);
  expect(glide).toMatchObject({ cls: 'flow-pan', node: null, duration: 250, delay: 0, fill: 'none' });
  const after = await pan.getAttribute('transform');
  expect(glide!.frames).toEqual([{ transform: panTransform(attributeView(before)) }, { transform: panTransform(attributeView(after)) }]);
});

// Task 13a (notes 6): the pipes' dashes and the goods riding them are inside the pan group, so they move with it; a pan is no drag, so it
// neither stops them nor starts them over: the same animations run on, their times going forward, the goods along their routes
test('a pan leaves the pipes running and the goods riding: the same animations, on and going forward', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  await page.mouse.move(1, 1);                                                          // off the canvas: nothing is lit, so nothing dims
  const run = await page.getByRole('button', { name: 'Fit' }).evaluate(async (button) => {
    const svg = document.querySelector('svg.flow-canvas');
    if (svg === null) throw new Error('no canvas');
    const moving = (): Array<{ el: Element; animation: Animation | undefined; time: number; at: string }> => (
      [...svg.querySelectorAll('.flow-rider, .flow-edge-flow')].map((el) => {
        const animation = el.getAnimations()[0];
        return { el, animation, time: Number(animation?.currentTime), at: getComputedStyle(el).offsetDistance };
      })
    );
    const two = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    await two();
    const before = moving();
    (button as HTMLButtonElement).click();
    await two();
    const after = moving();
    const pans = svg.querySelector(':scope > g.flow-pan')?.getAnimations() ?? [];
    const riders = before.filter((b) => b.el.classList.contains('flow-rider'));
    return {
      panning: pans.length === 1 && pans[0]?.playState === 'running', dragging: svg.classList.contains('dragging'),
      riders: riders.length, pipes: before.length - riders.length,
      same: after.length === before.length && before.every((b, i) => b.animation !== undefined && after[i]?.animation === b.animation),
      running: after.every((a) => a.animation?.playState === 'running'),
      forward: before.every((b, i) => (after[i]?.time ?? 0) > b.time),
      riding: before.every((b, i) => !b.el.classList.contains('flow-rider') || after[i]?.at !== b.at),
    };
  });
  expect(run).toEqual({ panning: true, dragging: false, riders: 6, pipes: 6, same: true, running: true, forward: true, riding: true });
});

// Task 13a (notes 4; ledger rulings P2-R35 and P2-R36): Close gives the focus back to the box head that opened the panel when the canvas shows
// it, and scrolls the page only when the window shows none of it; while a pan runs, both read where the head will be once the pan has ended,
// the view the attribute holds, so the focus goes where it will be seen. Here the head is out of the canvas's view on screen and Fit's pan,
// held at its start, is going to bring it in: the head takes the focus, and nothing scrolls
test('Close while Fit pans gives the focus to the box head where the pan ends', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const head = page.locator('[data-step-id="circuit-lv"] .flow-node-head');
  await head.click();
  const panel = page.getByRole('complementary', { name: 'Step: Basic Assembler' });
  await expect(panel).toBeVisible();
  await expect.poll(() => page.locator('.flow-side').evaluate((el) => el.getAnimations().length)).toBe(0);   // the panel has slid in
  // two drags down the window pull the picture down, past the bottom of the canvas (recipe-card.spec.ts's)
  for (let drag = 0; drag < 2; drag++) {
    const at = await canvas.boundingBox();
    if (at === null) throw new Error('the canvas has no box');
    await page.mouse.move(at.x + 12, at.y + 12);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, 715, { steps: 6 });
    await page.mouse.up();
  }
  await fitHeldAt(page, 0);
  const [h, c] = [await head.boundingBox(), await canvas.boundingBox()];
  if (h === null || c === null) throw new Error('no box');
  expect(h.y, 'the premise: on screen the head is below the canvas, the pan held at its start').toBeGreaterThanOrEqual(c.y + c.height);
  const scrolled = await page.evaluate(() => scrollY);
  await watchBodyFocus(page);
  await panel.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(head).toBeFocused();
  expect(await page.evaluate(() => scrollY), 'the page moved').toBe(scrolled);
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  // and where the pan ends, the canvas shows the head
  await finishMotion(page);
  const [end, area] = [await head.boundingBox(), await canvas.boundingBox()];
  if (end === null || area === null) throw new Error('no box');
  expect(end.y + end.height, 'the head ends in the canvas\'s view').toBeLessThanOrEqual(area.y + area.height);
  expect(end.y).toBeGreaterThanOrEqual(area.y);
});
