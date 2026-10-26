// The diagrams glide (Phase 2 spec §16.2, §16.4 and §16.5, Task 13a; review focus 1): Fit, the zoom buttons and a reveal pan a diagram's view
// over 250 ms, a WAAPI animation of its pan group's CSS `transform` from the picture on screen to the view its `transform` attribute holds at
// once; under reduced motion they move it at once; the wheel and a drag move it at once, from the picture on screen, and stop a pan under way.
// An init script records every `Element.prototype.animate` call in `window.__animations` and makes the call as asked; every case leaves out
// the records of the check `canGlide()` makes once, on a probe group of its own (`glide-probe`). Every Flow case that presses Fit first
// drags the canvas, at once, so that Fit has somewhere to go. Task 13a adds: the zoom buttons, a reveal and a new plan's view pan too; the goods
// ride and the pipes run on through a pan (they are inside the pan group); and a panel's Close while a pan runs gives the focus to the box head
// where the pan ends (ledger rulings P2-R35 and P2-R36 read the view the attribute holds, not the picture on its way there).

import { test, expect, type Locator, type Page } from '@playwright/test';
import { EASE_OUT } from '../../src/client/state/motion.ts';
import { matrixView, panTransform, type PanView } from '../../src/client/views/glide.ts';
import { circuitLv, platesTwoWays } from './fixtures/plans.ts';
import { bodyFocusCount, finishMotion, openConnections, openWithPlan, watchBodyFocus } from './helpers.ts';

/** A box on the page, as Playwright measures one. */
interface Box { x: number; y: number; width: number; height: number }

/** One `animate()` call: the element's class, its box or arrow (`data-node-id`, `data-edge-id` or `data-node`), its timing and its keyframes. */
interface AnimationRecord {
  cls: string | null; node: string | null; duration: unknown; delay: unknown; fill: unknown; easing: unknown; frames: Array<Record<string, unknown>>;
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
      duration: timing.duration, delay: timing.delay ?? 0, fill: timing.fill, easing: timing.easing,
      frames: JSON.parse(JSON.stringify(frames)) as unknown,
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

/** The Flow diagram's pan group, and the Connections picture's. */
const FLOW_PAN = 'svg.flow-canvas > g.flow-pan';
const CONN_PAN = 'g.conn-pan';

/**
 * Clicks the shown diagram's button named `name` (a script's click, which moves no focus) and, a frame later, holds the pan it started on the
 * group `group`, at `ms` of its 250 ms: returns the transform the browser computes for the group then, the picture on screen, which only the
 * pan sets. The click and the hold are one script: clicked outside a frame, the pan is made in this task and starts in the next frame, whose
 * callback holds it, so it cannot have ended first however late that frame comes (fix round 2).
 */
function pressHeldAt(page: Page, name: string, ms: number, group = FLOW_PAN): Promise<string> {
  return page.getByRole('button', { name, exact: true }).evaluate(async (button, [at, selector]) => {
    (button as HTMLButtonElement).click();
    await new Promise((done) => requestAnimationFrame(done));
    const g = document.querySelector(selector);
    const pan = g?.getAnimations()[0];
    if (g === null || pan === undefined) throw new Error('the press started no pan');
    pan.pause();
    pan.currentTime = at;
    return getComputedStyle(g).transform;
  }, [ms, group] as const);
}

/** `pressHeldAt` for the shown diagram's Fit. */
const fitHeldAt = (page: Page, ms: number, group = FLOW_PAN): Promise<string> => pressHeldAt(page, 'Fit', ms, group);

/** A pan's keyframe, `translate(xpx, ypx) scale(s)` (`panTransform`), as a view. */
function keyframeView(transform: unknown): PanView {
  const [x, y, scale] = (/^translate\((\S+)px, (\S+)px\) scale\((\S+)\)$/.exec(String(transform)) ?? []).slice(1).map(Number);
  if (x === undefined || y === undefined || scale === undefined) throw new Error(`no view in the keyframe "${String(transform)}"`);
  return { x, y, scale };
}

/** The pans running on the group `group` now. */
const pansOn = (page: Page, group = FLOW_PAN): Promise<number> => page.locator(group).evaluate((g) => g.getAnimations().length);

/** One wheel turn's zoom (`WHEEL_ZOOM`, 0.0015 a pixel) of 100 px up, as both diagrams make it. */
const TURN = Math.exp(100 * 0.0015);

/** `v` zoomed by `k` around (px, py) of its svg, as both diagrams' wheel does (the scale within 0.15–3, as here). */
function zoomedAt(v: PanView, px: number, py: number, k: number): PanView {
  return { scale: v.scale * k, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
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
  expect(glides[0]).toMatchObject({ cls: 'flow-pan', node: null, duration: 250, delay: 0, fill: 'none', easing: EASE_OUT });
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
  // fix round 1 (T4): Fit on the fitted view has nowhere to go, and makes no pan
  await page.getByRole('button', { name: 'Fit' }).click();
  expect(await pan.getAttribute('transform')).toBe(fitted);
  expect(await records(page), 'no pan between equal views').toHaveLength(1);
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
  expect(glides[0]).toMatchObject({ cls: 'conn-pan', node: null, duration: 250, delay: 0, fill: 'none', easing: EASE_OUT });
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
  expect(glides.map((g) => [g.cls, g.duration, g.fill, g.easing, g.frames.length])).toEqual(Array(3).fill(['flow-pan', 250, 'none', EASE_OUT, 2]));
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
  expect(glide).toMatchObject({ cls: 'flow-pan', node: null, duration: 250, delay: 0, fill: 'none', easing: EASE_OUT });
  const after = await pan.getAttribute('transform');
  expect(glide!.frames).toEqual([{ transform: panTransform(attributeView(before)) }, { transform: panTransform(attributeView(after)) }]);
});

// Fix round 1 (ledger ruling P2-R108): a pan goes with the view `glideTo` made, never with whatever view is drawn next. Find item's reveal asks
// for its pan from an effect, which React runs in the microtask that draws the light, so the pan's view waits for React's default lane; a wheel
// turn in that same task updates at the continuous lane, drawn with it or before it. Either way the turn is an instant move: the view it gives,
// on top of the reveal's, is drawn at once and never panned to (the reveal's pan gives way to it, as to any instant move). Fix round 2: React
// applies the two updates in the order they were made, whichever lane it draws first, so the view drawn is the reveal's (the wiremill centred,
// at the zoom of 0.9 the page opened on) zoomed by the turn: the reveal's view is not lost, only its pan
test('a wheel turn in the task of a reveal is drawn at once, never panned to', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const pan = canvas.locator(':scope > g.flow-pan');
  const before = await pan.getAttribute('transform');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  const [px, py] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  const run = await page.getByLabel('Find item').evaluate(async (select, [x, y]) => {
    const find = select as HTMLSelectElement;
    find.value = [...find.options].find((o) => o.textContent === '1x Copper Wire')?.value ?? '';
    find.dispatchEvent(new Event('change', { bubbles: true }));
    // React draws the light in a microtask, and runs the reveal's effect there, which asks for the reveal's pan; then, in this task, the turn
    await Promise.resolve();
    const svg = document.querySelector('svg.flow-canvas');
    if (svg === null) throw new Error('no canvas');
    const area = svg.getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const mill = svg.querySelector('[data-node-id="wire"]');
    const millBox = mill?.querySelector(':scope > rect.flow-node-box');
    return {
      lit: { focusing: svg.classList.contains('focusing'), pans: svg.querySelector(':scope > g.flow-pan')?.getAnimations().length },
      // what the reveal centres in (FlowView's `canvas()`) and on, and where the turn was over the svg (its wheel's `clientX - left`)
      canvas: { width: svg.clientWidth, height: svg.clientHeight },
      mill: { at: mill?.getAttribute('transform') ?? '', width: Number(millBox?.getAttribute('width')), height: Number(millBox?.getAttribute('height')) },
      wx: x - area.left, wy: y - area.top,
    };
  }, [px, py] as const);
  expect(run.lit, 'the good is lit and no pan runs').toEqual({ focusing: true, pans: 0 });
  expect(await records(page), 'nothing was panned to').toEqual([]);
  expect(await pan.getAttribute('transform'), 'the reveal and the turn moved the view').not.toBe(before);
  // the reveal's view (`centreOn` the wiremill at zoom 0.9), then the turn on top of it, about the pointer
  const [mx, my] = (/^translate\((\S+) (\S+)\)$/.exec(run.mill.at) ?? []).slice(1).map(Number);
  if (mx === undefined || my === undefined) throw new Error(`no place in "${run.mill.at}"`);
  const revealed = {
    scale: 0.9, x: run.canvas.width / 2 - (mx + run.mill.width / 2) * 0.9, y: run.canvas.height / 2 - (my + run.mill.height / 2) * 0.9,
  };
  const want = zoomedAt(revealed, run.wx, run.wy, TURN);
  const now = attributeView(await pan.getAttribute('transform'));
  expect(now.scale, 'the reveal\'s zoom, turned once').toBeCloseTo(want.scale, 6);
  expect(now.x, 'the reveal\'s view turned about the pointer').toBeCloseTo(want.x, 0);
  expect(now.y).toBeCloseTo(want.y, 0);
});

// Task 13a (notes 6): the pipes' dashes and the goods riding them are inside the pan group, so they move with it; a pan is no drag, so it
// neither stops them nor starts them over: the same animations run on, their times going forward, the goods along their routes. Fix rounds 1
// and 2 (T6): the pan is read in the press's own task, once React has drawn the press in its microtask: made and pending, it cannot have ended,
// however slow the frames; the pipes and the goods are read a frame on
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
    const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));
    await frame();
    await frame();
    const before = moving();
    (button as HTMLButtonElement).click();
    await Promise.resolve();                             // React draws the press in a microtask of this task: the pan is made, pending
    const pans = svg.querySelector(':scope > g.flow-pan')?.getAnimations() ?? [];
    const panning = pans.length === 1 && pans[0]?.playState === 'running' && pans[0].pending;
    await frame();                                       // a frame of the pan, which the pipes and the goods run on through
    const after = moving();
    const riders = before.filter((b) => b.el.classList.contains('flow-rider'));
    return {
      panning, dragging: svg.classList.contains('dragging'),
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

/**
 * Waits for the Connections picture of the tab shown, and for the view it was fitted at, once the area has its size (a read that holds from one
 * poll to the next, as shortcuts.spec.ts reads it): returns the area, its pan group and that view's attribute.
 */
async function fittedConnections(page: Page): Promise<{ area: Locator; pan: Locator; fitted: string | null }> {
  const view = page.getByTestId('connections');
  await expect(view).toContainText('2× Basic Bending Machine');
  const pan = view.locator(CONN_PAN);
  let fitted = await pan.getAttribute('transform');
  await expect.poll(async () => {
    const now = await pan.getAttribute('transform');
    const held = now === fitted;
    fitted = now;
    return held;
  }).toBe(true);
  return { area: view.getByRole('group', { name: 'Connections of the line' }), pan, fitted };
}

/** Drags `area` by (dx, dy) from its middle (whole pixels): an instant move. */
async function dragFromMiddle(page: Page, area: Locator, dx: number, dy: number): Promise<void> {
  const box = await area.boundingBox();
  if (box === null) throw new Error('no area');
  const [x, y] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

// Fix round 1 (T1; review focus 1): Connections' instant moves while its Fit pans, the pan held at 125 ms each time: a drag, a wheel turn and an
// arrow key (the area focused) each start from the picture on screen, and no pan runs after them
test('Connections: a drag, a wheel turn and an arrow key during Fit\'s pan each start from the picture on screen', async ({ page }) => {
  await openConnections(page);
  const { area, pan } = await fittedConnections(page);
  /** The picture dragged off its fitted view, then Fit, its pan held at 125 ms: the picture on screen. */
  const held = async (): Promise<PanView> => {
    await dragFromMiddle(page, area, 100, 60);
    const view = matrixView(await fitHeldAt(page, 125, CONN_PAN));
    if (view === null) throw new Error('no pan on screen');
    const going = attributeView(await pan.getAttribute('transform'));
    expect(view.x === going.x && view.y === going.y, 'the premise: the picture on screen is not yet where the pan goes').toBe(false);
    return view;
  };
  const now = async (): Promise<PanView> => attributeView(await pan.getAttribute('transform'));
  // a drag, 40 px right and 20 down
  let from = await held();
  await dragFromMiddle(page, area, 40, 20);
  await expect.poll(async () => (await now()).x, { message: 'the drag moves the picture on screen' }).toBeCloseTo(from.x + 40, 0);
  expect((await now()).y).toBeCloseTo(from.y + 20, 0);
  expect((await now()).scale, 'at the zoom on screen').toBe(from.scale);
  await expect.poll(() => pansOn(page, CONN_PAN), { message: 'no pan runs after the drag' }).toBe(0);
  // a wheel turn, 100 px up, around the pointer
  from = await held();
  const box = await area.boundingBox();
  if (box === null) throw new Error('no area');
  const [px, py] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];   // a wheel event's clientX and clientY are whole
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -100);
  const zoomed = zoomedAt(from, px - box.x, py - box.y, TURN);
  await expect.poll(async () => (await now()).scale, { message: 'the turn zooms the picture on screen' }).toBeCloseTo(zoomed.scale, 6);
  expect((await now()).x).toBeCloseTo(zoomed.x, 0);
  expect((await now()).y).toBeCloseTo(zoomed.y, 0);
  await expect.poll(() => pansOn(page, CONN_PAN), { message: 'no pan runs after the turn' }).toBe(0);
  // ArrowRight, the area focused: the picture moves 40 px left (KEY_PAN), as a page scrolls
  from = await held();
  await area.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await now()).x, { message: 'the key moves the picture on screen' }).toBeCloseTo(from.x - 40, 0);
  expect((await now()).y).toBeCloseTo(from.y, 0);
  await expect.poll(() => pansOn(page, CONN_PAN), { message: 'no pan runs after the key' }).toBe(0);
});

// Fix round 1 (T1; ledger ruling P2-R105): a resize while Connections' Fit pans fits the picture again at once, for the new size, and ends the
// pan; the view it lands on is the fitted one, so Fit then has nowhere to go
test('Connections: a resize during Fit\'s pan fits the picture again at once and ends the pan', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openConnections(page);
  const { area, pan } = await fittedConnections(page);
  await dragFromMiddle(page, area, 100, 60);
  await fitHeldAt(page, 125, CONN_PAN);
  const going = await pan.getAttribute('transform');                                   // the fitted view of the wider area
  await page.setViewportSize({ width: 1100, height: 720 });                             // the area narrows
  await expect.poll(() => pan.getAttribute('transform'), { message: 'fitted again for the new size' }).not.toBe(going);
  await expect.poll(() => pansOn(page, CONN_PAN), { message: 'the pan has ended' }).toBe(0);
  const refitted = await pan.getAttribute('transform');
  const pictures = async (): Promise<number> => (await records(page)).filter((r) => r.cls === 'conn-pan').length;
  const made = await pictures();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  expect(await pan.getAttribute('transform'), 'the refit is the fitted view').toBe(refitted);
  expect(await pictures(), 'so Fit has nowhere to go').toBe(made);
});

// Fix round 1 (T2; review focus 1): a wheel turn that comes while a pan runs, nothing but the turn holding it, holds the pan where it is at once
// (paused, with no pause left pending) and zooms the picture on screen at that moment, read in the task the turn comes in; a second turn before
// React draws the first builds on it
test('a wheel turn while a pan runs holds it where it is, and a second turn before React draws builds on the first', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  const box = await page.locator('svg.flow-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  const [px, py] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  const run = await page.getByRole('button', { name: 'Fit', exact: true }).evaluate(async (button, [x, y]) => {
    (button as HTMLButtonElement).click();
    await new Promise((done) => requestAnimationFrame(done));                         // the press's first frame: the pan runs
    const svg = document.querySelector('svg.flow-canvas');
    const g = svg?.querySelector(':scope > g.flow-pan');
    const pan = g?.getAnimations()[0];
    if (svg === null || svg === undefined || g === null || g === undefined || pan === undefined) throw new Error('Fit started no pan');
    const turn = (): boolean => svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const state = pan.playState;
    const time = pan.currentTime;
    const onScreen = getComputedStyle(g).transform;                                     // the picture the turn finds
    turn();
    const held = { state: pan.playState, pending: pan.pending, same: pan.currentTime === time };
    turn();                                                                              // before React draws the first
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const area = svg.getBoundingClientRect();
    return { state, onScreen, held, wx: x - area.left, wy: y - area.top, transform: g.getAttribute('transform'), pans: g.getAnimations().length };
  }, [px, py] as const);
  expect(run.state, 'the turn comes while the pan runs').toBe('running');
  expect(run.held, 'the turn holds the pan where it is, at once').toEqual({ state: 'paused', pending: false, same: true });
  expect(run.pans, 'no pan runs once React has drawn the turns').toBe(0);
  const from = matrixView(run.onScreen);
  if (from === null) throw new Error('no pan on screen');
  const twice = zoomedAt(zoomedAt(from, run.wx, run.wy, TURN), run.wx, run.wy, TURN);
  const now = attributeView(run.transform);
  expect(now.scale, 'two turns, the second on the first').toBeCloseTo(twice.scale, 6);
  expect(now.x).toBeCloseTo(twice.x, 0);
  expect(now.y).toBeCloseTo(twice.y, 0);
});

// Fix round 1 (T3; ledger ruling P2-R103): a pan asked for while another runs starts from the picture on screen, not from where the other was
// going: Zoom out, pressed while Zoom in's pan is held at 60 ms, starts from that picture
test('a pan asked for during another starts from the picture on screen', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  const run = await page.locator('.flow-toolbar').evaluate(async (bar) => {
    const press = (name: string): void => {
      const button = [...bar.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name);
      if (button === undefined) throw new Error(`no ${name}`);
      button.click();
    };
    const g = document.querySelector('svg.flow-canvas > g.flow-pan');
    if (g === null) throw new Error('no pan group');
    press('Zoom in');
    await new Promise((done) => requestAnimationFrame(done));
    const pan = g.getAnimations()[0];
    if (pan === undefined) throw new Error('Zoom in started no pan');
    pan.pause();
    pan.currentTime = 60;
    const going = g.getAttribute('transform');                                          // where Zoom in's pan goes
    const onScreen = getComputedStyle(g).transform;                                     // the picture Zoom out finds
    press('Zoom out');
    return { going, onScreen };
  });
  await expect.poll(async () => (await records(page)).length, { message: 'Zoom out pans' }).toBe(2);
  const start = keyframeView((await records(page))[1]?.frames[0]?.transform);
  const onScreen = matrixView(run.onScreen);
  if (onScreen === null) throw new Error('no pan on screen');
  expect(start.x).toBeCloseTo(onScreen.x, 0);
  expect(start.y).toBeCloseTo(onScreen.y, 0);
  expect(start.scale).toBeCloseTo(onScreen.scale, 3);
  const going = attributeView(run.going);
  expect(Math.abs(start.x - going.x) + Math.abs(start.y - going.y), 'not where Zoom in was going').toBeGreaterThan(1);
});

// Fix round 1 (T4): Fit on a view that is already the fitted one has nowhere to go: no pan, and the browser is not even asked whether it can pan
// (equal views are asked before `canGlide()`). Connections opens fitted; the page is loaded again on that tab, so no pan of the Flow tab shown
// first while the line was planned comes before
test('Fit on the fitted view makes no pan, and the probe never runs', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openConnections(page);
  await page.reload();
  const { pan, fitted } = await fittedConnections(page);
  expect(await allRecords(page), 'opened fitted, at once').toEqual([]);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  expect(await pan.getAttribute('transform')).toBe(fitted);
  expect(await allRecords(page), 'no pan, and no probe').toEqual([]);
});

/** Whether two boxes share no area (FlowView's `disjoint`). */
const apart = (a: Box, b: Box): boolean => a.y + a.height <= b.y || a.y >= b.y + b.height || a.x + a.width <= b.x || a.x >= b.x + b.width;

/**
 * Opens circuitLv and the Basic Assembler's panel from its box head, once it has slid in; returns the canvas, the head and the panel. Then drags
 * the picture until the head is centred across the canvas and its bottom edge is at `bottom` (page px, from the canvas's `top` or `middle`), and
 * holds Zoom in's pan, which zooms about the canvas's middle, at its start: on screen the head is where it was dragged, and at rest a quarter
 * further from the middle, straight up, still centred across (fix round 2: so the whole head can be in view, none of it cut at a side).
 */
async function headHeldAboveMiddle(page: Page, bottom: (canvas: { top: number; middle: number }) => number): Promise<{ canvas: Locator; head: Locator; panel: Locator }> {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const head = page.locator('[data-step-id="circuit-lv"] .flow-node-head');
  await head.click();
  const panel = page.getByRole('complementary', { name: 'Step: Basic Assembler' });
  await expect(panel).toBeVisible();
  await expect.poll(() => page.locator('.flow-side').evaluate((el) => el.getAnimations().length)).toBe(0);   // the panel has slid in
  // the canvas's middle, which Zoom in keeps where it is: its content box's (the pan group's origin is inside its 2 px border)
  const middle = await canvas.evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    return { top: box.top + svg.clientTop, middle: box.top + svg.clientTop + svg.clientHeight / 2, across: box.left + svg.clientLeft + svg.clientWidth / 2 };
  });
  const h = await head.boundingBox();
  const c = await canvas.boundingBox();
  if (h === null || c === null) throw new Error('no box');
  const dx = Math.round(middle.across - (h.x + h.width / 2));
  const dy = Math.round(bottom(middle) - (h.y + h.height));
  const [x, y] = [Math.round(c.x + c.width / 2 - dx / 2), Math.round(dy < 0 ? c.y + c.height - 12 : c.y + 12)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(1, 1);
  await pressHeldAt(page, 'Zoom in', 0);
  return { canvas, head, panel };
}

// Fix round 1 (T7; ledger ruling P2-R36), the Close case the other way round: on screen the box head shows in the canvas, 10 px of it below the
// canvas's top edge, but Zoom in's pan, held at its start, takes it wholly above that edge: Close gives the focus to the canvas, as it would to
// a head panned out of its view
test('Close while a pan takes the head out of the canvas gives the focus to the canvas', async ({ page }) => {
  const { canvas, head, panel } = await headHeldAboveMiddle(page, ({ top }) => top + 10);
  const [h, c] = [await head.boundingBox(), await canvas.boundingBox()];
  if (h === null || c === null) throw new Error('no box');
  expect(apart(h, c), 'the premise: on screen the head shows in the canvas').toBe(false);
  await watchBodyFocus(page);
  await panel.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(canvas).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  // and where the pan ends, the canvas shows none of the head
  await finishMotion(page);
  const [end, area] = [await head.boundingBox(), await canvas.boundingBox()];
  if (end === null || area === null) throw new Error('no box');
  expect(apart(end, area), 'the premise: at rest the head is out of the canvas\'s view').toBe(true);
});

// Fix round 1 (T7; ledger ruling P2-R35): the scroll. The page is scrolled so that, on screen, the box head's bottom shows in the window and, at
// rest (Zoom in's pan, held at its start, takes the head a quarter further up), the head is wholly above the window though still in the
// canvas's view. Close gives the focus to the head, ends the pan at once, and scrolls the head into the window by the least scroll. At 1000 px
// the panel stacks under the diagram, so its Close shows while the canvas's top is above the window
test('Close while a pan takes the head out of the window ends the pan, then scrolls the head in', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const { canvas, head, panel } = await headHeldAboveMiddle(page, ({ middle }) => middle - 60);
  // a spacer after the page lets it scroll, and the window's top goes 67 px above the canvas's middle: between the head's bottom on screen (60 px
  // above) and at rest (75 px above)
  const scrolled = await canvas.evaluate((svg) => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-test-spacer', '');
    spacer.style.height = '2000px';
    document.body.append(spacer);
    const box = svg.getBoundingClientRect();
    scrollTo(0, Math.round(scrollY + box.top + svg.clientTop + svg.clientHeight / 2 - 67));
    return scrollY;
  });
  const close = panel.getByRole('button', { name: 'Close the panel' });
  await expect(close, 'the premise: Close shows').toBeInViewport();
  const h = await head.boundingBox();
  if (h === null) throw new Error('no head');
  expect(h.y + h.height, 'the premise: on screen the head\'s bottom shows in the window').toBeGreaterThan(0);
  // where the held pan ends: seek it to its end (no fill: the group on its attribute) and back, in one task, so nothing is painted
  const rest = await head.evaluate((el) => {
    const g = el.closest<SVGGElement>('g.flow-pan');
    const pan = g?.getAnimations()[0];
    const area = g?.ownerSVGElement?.getBoundingClientRect();
    if (g === null || g === undefined || pan === undefined || area === undefined) throw new Error('no pan held');
    const time = pan.currentTime;
    pan.currentTime = 250;
    const box = el.getBoundingClientRect();
    pan.currentTime = time;
    return { bottom: box.bottom, top: box.top, canvasTop: area.top };
  });
  expect(rest.bottom, 'the premise: at rest the head is wholly above the window').toBeLessThan(0);
  expect(rest.top, 'and still in the canvas\'s view').toBeGreaterThanOrEqual(rest.canvasTop);
  await watchBodyFocus(page);
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(head).toBeFocused();
  expect(await pansOn(page), 'the pan ended').toBe(0);
  await expect(head, 'the head is in the window').toBeInViewport();
  // the whole head: the pan ended first and the scroll went by where the head rests (the other order scrolls to the picture on its way, and
  // the head then jumps up, out of the window's top). Measured on the head's box, which `block: 'nearest'` aligns: an IntersectionObserver
  // (`toBeInViewport`'s ratio) also counts the focus ring's stroke round the box, half of which the aligned box leaves above the window
  const landed = await head.boundingBox();
  if (landed === null) throw new Error('no head');
  expect(landed.y, 'the whole head: its top in the window').toBeGreaterThanOrEqual(0);
  expect(landed.y + landed.height, 'and its bottom').toBeLessThanOrEqual(900);
  expect(await page.evaluate(() => scrollY), 'the page scrolled up to it').toBeLessThan(scrolled);
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
});
