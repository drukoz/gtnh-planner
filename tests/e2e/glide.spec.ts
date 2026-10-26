// The diagrams glide (Phase 2 spec §16.2, §16.4 and §16.5, Task 13a; review focus 1): Fit, the zoom buttons and a reveal pan a diagram's view
// over 250 ms, a WAAPI animation of its pan group's CSS `transform` from the picture on screen to the view its `transform` attribute holds at
// once; under reduced motion they move it at once; the wheel and a drag move it at once, from the picture on screen, and stop a pan under way.
// An init script records every `Element.prototype.animate` call in `window.__animations` and makes the call as asked; every case leaves out
// the records of the check `canGlide()` makes once, on a probe group of its own (`glide-probe`). Every Flow case that presses Fit first
// drags the canvas, at once, so that Fit has somewhere to go. Task 13a adds: the zoom buttons, a reveal and a new plan's view pan too; the goods
// ride and the pipes run on through a pan (they are inside the pan group); and a panel's Close while a pan runs gives the focus to the box head
// where the pan ends (ledger rulings P2-R35 and P2-R36 read the view the attribute holds, not the picture on its way there). Task 13b adds a
// new layout's glide (spec §16.3): the boxes that moved glide to their new places, what came fades in, the arrows and the goods riding them
// fade in over the glide's second half, and what went fades out as a ghost; none of it under reduced motion; a pan and a glide compose; the
// focus and its tip go with a box that moves, and on from one that goes; and a new Connections picture glides inside the view it lands in.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { EASE_IN, EASE_OUT } from '../../src/client/state/motion.ts';
import { matrixView, panTransform, type PanView } from '../../src/client/views/glide.ts';
import type { Layout } from '../../src/shared/types/layout.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { circuitLv, manyEdges, platesTwoWays } from './fixtures/plans.ts';
import {
  bodyFocusCount, createProject, finishMotion, login, loosePipeEnds, LV_CIRCUITS, openConnections, openWithPlan, setName, watchBodyFocus,
} from './helpers.ts';

/** A box on the page, as Playwright measures one. */
interface Box { x: number; y: number; width: number; height: number }

/** One `animate()` call: the element's class, its box or arrow (`data-node-id`, `data-edge-id` or `data-node`), its timing and its keyframes. */
interface AnimationRecord {
  cls: string | null; node: string | null; duration: unknown; delay: unknown; fill: unknown; easing: unknown; frames: Array<Record<string, unknown>>;
}

/**
 * Runs in the page before its scripts: records every `Element.prototype.animate` call in `window.__animations`, then makes it as asked. Task
 * 13b: an animation of an element that matches `window.__hold` (a selector a test sets) is held at its start, paused, for the test to see it.
 */
function recordAnimations(): void {
  const w = window as unknown as { __animations: unknown[]; __hold?: string };
  const records: unknown[] = [];
  w.__animations = records;
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
    const made = animate.call(this, frames, options);
    if (w.__hold !== undefined && this.matches(w.__hold)) {
      made.pause();
      made.currentTime = 0;
    }
    return made;
  };
}

/** From now on, holds every animation made of an element that matches `selector` at its start (`recordAnimations`). */
const holdAnimationsOf = (page: Page, selector: string): Promise<void> => page.evaluate((s) => {
  (window as unknown as { __hold?: string }).__hold = s;
}, selector);

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
// at once. Since Task 13b the new plan's boxes glide too (on their own groups, a case below): the pan is the pan group's one record
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
  const pans = async (): Promise<AnimationRecord[]> => (await records(page)).filter((r) => r.cls === 'flow-pan');
  await expect.poll(async () => (await pans()).length, { message: 'the new plan\'s view pans' }).toBe(1);
  const [glide] = await pans();
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

// ---- Task 13b: a new layout glides (Phase 2 spec §16.3) ----

/** The Flow diagram's boxes as drawn by their attributes: each `[data-node-id]`'s `transform`, by its id. */
const places = (page: Page): Promise<Record<string, string>> => page.locator('svg.flow-canvas [data-node-id]').evaluateAll((boxes) =>
  Object.fromEntries(boxes.map((box) => [box.getAttribute('data-node-id') ?? '', box.getAttribute('transform') ?? ''])));

/** The offset of a box's `translate(x y)` attribute or of a glide's `translate(xpx, ypx)` keyframe. */
function translation(transform: unknown): [number, number] {
  const [x, y] = (/^translate\((\S+?)(?:px)?,? (\S+?)(?:px)?\)$/.exec(String(transform)) ?? []).slice(1).map(Number);
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) throw new Error(`no translation in "${String(transform)}"`);
  return [x, y];
}

/**
 * Opens a new project whose plan, each time the page asks for one, is what `served` gives then (the test swaps it before a replan), and waits
 * for the first plan's boxes; returns the project's id.
 */
async function openServing(page: Page, served: () => Plan): Promise<string> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: served() }));
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Glide', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(served().steps.length);
  return id;
}

/** Makes the server plan project `id` again (a settings op, its amount each time another): its `plan` event makes the page fetch the plan. */
async function replan(page: Page, id: string, amount: number): Promise<void> {
  const ops = [{ op: 'settings', patch: { amount } }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
}

/** The Flow canvas's step boxes. */
const stepBoxes = (page: Page): Locator => page.locator('svg.flow-canvas [data-step-id]');

/** Runs in the page before its scripts: counts in `window.__ghosts` every ghost of a box (`.flow-ghost`) ever put in the page. */
function countGhosts(): void {
  const w = window as unknown as { __ghosts: number };
  w.__ghosts = 0;
  new MutationObserver((changes) => {
    for (const change of changes) {
      for (const added of change.addedNodes) {
        if (added instanceof Element && (added.matches('.flow-ghost') || added.querySelector('.flow-ghost') !== null)) w.__ghosts += 1;
      }
    }
  }).observe(document, { childList: true, subtree: true });
}

// spec §16.5 (2): a replan to a plan whose hand step shifts the line (circuitLv, then platesTwoWays) glides each box that moved from where it
// stood to where its `transform` attribute already puts it, in 260 ms with no fill; the hand step's new box fades in to its own opacity (its
// one keyframe at the start); and every arrow that changed or came, and the goods riding them, fade in over the glide's second half; once every
// motion that ends has ended, every pipe ends on its own flanges (F7)
test('a replan glides the boxes that moved, and every pipe ends on its flange after', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  let served = circuitLv();
  const id = await openServing(page, () => served);
  const before = await places(page);
  expect(await records(page), 'the first plan opened at once').toEqual([]);
  served = platesTwoWays();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(4);
  const after = await places(page);
  const made = await records(page);
  const moved = Object.keys(after).filter((box) => before[box] !== undefined && before[box] !== after[box]);
  expect(moved.length, 'the premise: the hand step shifts the line').toBeGreaterThan(0);
  for (const box of moved) {
    const glides = made.filter((r) => r.node === box && r.frames.some((frame) => 'transform' in frame));
    expect(glides, box).toHaveLength(1);
    expect(glides[0], box).toMatchObject({ duration: 260, delay: 0, fill: 'none', easing: EASE_OUT });
    // absolute keyframes, from where the box stood to where its attribute puts it at once (spec §16.1: never an implicit end)
    expect(glides[0]!.frames.map((frame) => translation(frame.transform)), box).toEqual([translation(before[box]), translation(after[box])]);
  }
  // the hand step's box comes in: from nothing to its own opacity
  expect(made.filter((r) => r.node === 'hammer-plate')).toEqual([
    expect.objectContaining({ duration: 260, delay: 0, fill: 'none', easing: EASE_OUT, frames: [{ opacity: 0, offset: 0 }] }),
  ]);
  // the arrows that changed or came, and the layer of the goods riding them, over the second half: invisible through the first
  const arrows = made.filter((r) => r.cls?.startsWith('flow-edge') === true);
  expect(arrows.length, 'arrows that changed').toBeGreaterThan(0);
  const riders = made.filter((r) => r.cls === 'flow-riders');
  expect(riders, 'the goods riding them, once, as a layer').toHaveLength(1);
  for (const r of [...arrows, ...riders]) {
    expect(r, `${r.cls} ${r.node}`).toMatchObject({ frames: [{ opacity: 0, offset: 0 }], delay: 130, duration: 130, fill: 'backwards' });
  }
  await finishMotion(page);
  const ends = await loosePipeEnds(page);
  expect(ends.pipes, 'platesTwoWays\' eight pipes').toBe(8);
  expect(ends.loose).toEqual([]);
});

// spec §16.5 (3), the replan half: under reduced motion a replan draws its layout at once, there and back (circuitLv, platesTwoWays, circuitLv
// again, whose layout drops the hand step's boxes): no box glides or fades, no ghost is ever drawn, and the browser is never asked whether it can
// glide; the global block's 1 ms transitions run out at once (ledger ruling P2-R107)
test('under reduced motion a replan moves at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(recordAnimations);
  await page.addInitScript(countGhosts);
  let served = circuitLv();
  const id = await openServing(page, () => served);
  const before = await places(page);
  served = platesTwoWays();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(4);
  const after = await places(page);
  expect(Object.keys(after).some((box) => before[box] !== undefined && before[box] !== after[box]), 'the premise: boxes moved').toBe(true);
  served = circuitLv();
  await replan(page, id, 32);
  await expect(stepBoxes(page)).toHaveCount(3);
  await expect(page.locator('[data-node-id="hammer-plate"]'), 'the premise: the hand step\'s box went').toHaveCount(0);
  expect(await allRecords(page), 'no animation, and no probe of what the browser can glide').toEqual([]);
  expect((await finiteAnimations(page)).filter((a) => a.ends > 1)).toEqual([]);
  await expect.poll(() => finiteAnimations(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __ghosts: number }).__ghosts), 'no ghost was ever drawn').toBe(0);
});

// Task 13b (spec §16.3, P2-D42): the boxes a replan drops (platesTwoWays, then circuitLv: the hand step and its Iron Ingot's stub) fade out where
// they stood, as ghosts drawn between the goods and the boxes: a plain copy of each box in its kind's colours, which no pointer, tip, focus or
// count sees (the `[data-step-id]` count, the boxes, `loosePipeEnds`), fading from whole to nothing over 180 ms with --ease-in, held at nothing
// (`forwards`) until they are taken away. Each ghost is held at its start here, so the test sees it
test('a box a replan drops fades out where it stood, as a ghost no pointer, tip or count sees', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  let served = platesTwoWays();
  const id = await openServing(page, () => served);
  const dropped = ['hammer-plate', 'import:t:iron_ingot@0@hammer-plate'];
  const stood = await page.locator('svg.flow-canvas [data-node-id]').evaluateAll((boxes, ids) => ids.map((nodeId) => {
    const box = boxes.find((b) => b.getAttribute('data-node-id') === nodeId);
    const rect = box?.querySelector(':scope > rect.flow-node-box');
    return { at: box?.getAttribute('transform'), width: rect?.getAttribute('width'), height: rect?.getAttribute('height') };
  }), dropped);
  await holdAnimationsOf(page, '.flow-ghost');
  served = circuitLv();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(3);
  const ghosts = page.locator('svg.flow-canvas > g.flow-pan > g.flow-ghost');
  await expect(ghosts).toHaveCount(2);
  const drawn = await ghosts.evaluateAll((all) => all.map((ghost) => {
    const pointAt = ghost.getBoundingClientRect();
    const under = document.elementFromPoint(pointAt.left + pointAt.width / 2, pointAt.top + pointAt.height / 2);
    return {
      attributes: ghost.getAttributeNames(), cls: ghost.getAttribute('class'), hidden: ghost.getAttribute('aria-hidden'), at: ghost.getAttribute('transform'),
      inside: [...ghost.children].map((child) => `${child.localName}.${child.getAttribute('class')} ${child.getAttributeNames().join(' ')}`),
      size: { width: ghost.firstElementChild?.getAttribute('width'), height: ghost.firstElementChild?.getAttribute('height') },
      pointer: getComputedStyle(ghost).pointerEvents, underIt: under?.closest('.flow-ghost') !== null && under !== null,
      opacity: getComputedStyle(ghost).opacity,
    };
  }));
  // where the boxes stood, the size they were, in their kinds' colours: the hand step a new one, its Iron Ingot an import
  expect(drawn.map(({ cls, at, size }) => ({ cls, at, size }))).toEqual([
    { cls: 'flow-ghost new', at: stood[0]!.at, size: { width: stood[0]!.width, height: stood[0]!.height } },
    { cls: 'flow-ghost import', at: stood[1]!.at, size: { width: stood[1]!.width, height: stood[1]!.height } },
  ]);
  for (const ghost of drawn) {
    // nothing a box carries: no id, kind, port, role, tab stop, tip, light or flange; a lone box with its size
    expect(ghost.attributes.sort(), ghost.cls ?? '').toEqual(['aria-hidden', 'class', 'transform']);
    expect(ghost.hidden).toBe('true');
    expect(ghost.inside, ghost.cls ?? '').toEqual(['rect.flow-ghost-box class width height']);
    // held at its start, whole, and never what the pointer finds
    expect(ghost.opacity).toBe('1');
    expect(ghost.pointer).toBe('none');
    expect(ghost.underIt, `${ghost.cls}: what the page finds at its middle`).toBe(false);
  }
  // between the goods riding the pipes and the boxes
  const order = await page.locator('svg.flow-canvas > g.flow-pan').evaluate((g) => [...g.children].map((child) => child.getAttribute('class')?.split(' ')[0]));
  const first = order.indexOf('flow-ghost');
  expect(order.slice(first - 1, first + 3)).toEqual(['flow-riders', 'flow-ghost', 'flow-ghost', 'flow-node']);
  // no count sees them: the boxes are the new layout's, its seven
  await expect(page.locator('svg.flow-canvas [data-node-id]')).toHaveCount(7);
  for (const nodeId of dropped) await expect(page.locator(`svg.flow-canvas [data-node-id="${nodeId}"]`)).toHaveCount(0);
  // their fade: from whole to nothing over 180 ms with --ease-in, held at nothing (`forwards`) until it goes
  const fades = (await records(page)).filter((r) => r.cls?.startsWith('flow-ghost') === true);
  expect(fades).toEqual(['flow-ghost new', 'flow-ghost import'].map((cls) => expect.objectContaining({
    cls, node: null, duration: 180, delay: 0, fill: 'forwards', easing: EASE_IN, frames: [{ opacity: 1 }, { opacity: 0 }],
  })));
  // once faded, each is taken away
  await finishMotion(page);
  await expect(ghosts).toHaveCount(0);
  expect((await loosePipeEnds(page)).loose).toEqual([]);
});

// Task 13b: under a focus a box it does not light is drawn dimmed (`.flow-canvas.focusing .dim`, 0.18); a replan that drops it (Copper Wire lit
// from Find item: neither the hand step nor its Iron Ingot's stub takes or makes it) fades its ghost out from there, never from whole, which
// would flash a box the eye had let go of; a ghost still carries no `dim`, so no count of the dimmed sees it
test('the ghost of a box a focus dims fades out from its dimmed opacity, not from whole', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  let served = platesTwoWays();
  const id = await openServing(page, () => served);
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/\bfocusing\b/);
  await page.mouse.move(1, 1);
  for (const nodeId of ['hammer-plate', 'import:t:iron_ingot@0@hammer-plate']) {
    await expect(page.locator(`svg.flow-canvas [data-node-id="${nodeId}"]`), `the premise: ${nodeId} is dimmed`).toHaveClass(/\bdim\b/);
  }
  await holdAnimationsOf(page, '.flow-ghost');
  served = circuitLv();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(3);
  const ghosts = page.locator('svg.flow-canvas .flow-ghost');
  await expect(ghosts).toHaveCount(2);
  expect(await ghosts.evaluateAll((all) => all.map((g) => [g.getAttribute('class'), getComputedStyle(g).opacity]))).toEqual([
    ['flow-ghost new', '0.18'], ['flow-ghost import', '0.18'],
  ]);
  const fades = (await records(page)).filter((r) => r.cls?.startsWith('flow-ghost') === true);
  expect(fades.map((r) => r.frames)).toEqual([[{ opacity: 0.18 }, { opacity: 0 }], [{ opacity: 0.18 }, { opacity: 0 }]]);
  await finishMotion(page);
  await expect(ghosts).toHaveCount(0);
});

/** The Flow canvas's content box's top left on the page: where its pan group's origin is (inside its 2 px border). */
const canvasOrigin = (page: Page): Promise<[number, number]> => page.locator('svg.flow-canvas').evaluate((svg) => {
  const box = svg.getBoundingClientRect();
  return [box.left + svg.clientLeft, box.top + svg.clientTop];
});

/** circuitLv's Redstone stub: "Imports in one column" moves it alone, 280 units left, to the first column (the same steps, so no new view). */
const REDSTONE = 'import:t:redstone@0@circuit-lv';

/**
 * Where the redstone's stub is drawn, and what puts it there: the pan's picture (the matrix the browser computes for the pan group), the glide's
 * place (the box group's), its rect's box on the page and its width in the diagram.
 */
function composed(page: Page): Promise<{ view: string; at: string; rect: [number, number, number]; width: number }> {
  return page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"]`).evaluate((box) => {
    const g = box.closest('g.flow-pan') as Element;
    const rect = (box.querySelector(':scope > rect.flow-node-box') as SVGRectElement);
    const r = rect.getBoundingClientRect();
    return { view: getComputedStyle(g).transform, at: getComputedStyle(box).transform, rect: [r.left, r.top, r.width], width: Number(rect.getAttribute('width')) };
  });
}

/** Checks that the stub is drawn where the pan's picture of its glide's place puts it: the two transforms compose. */
async function expectComposed(page: Page): Promise<void> {
  const [ox, oy] = await canvasOrigin(page);
  const run = await composed(page);
  const view = matrixView(run.view);
  const at = matrixView(run.at);
  if (view === null || at === null) throw new Error(`no matrix in ${run.view} or ${run.at}`);
  expect(run.rect[0], 'its left: the pan\'s picture of the glide\'s place').toBeCloseTo(ox + view.x + view.scale * at.x, 0);
  expect(run.rect[1], 'its top').toBeCloseTo(oy + view.y + view.scale * at.y, 0);
  expect(run.rect[2], 'its width, at the pan\'s zoom').toBeCloseTo(view.scale * run.width, 0);
}

// Task 13b (notes 11): a new layout that comes while Fit pans. "Imports in one column" lays the same steps out again (no new view: the redstone's
// stub moves to the first column), its glide held half way, while Fit's pan is held at 60 ms: the pan runs on, untouched, and the stub is drawn
// where the pan's picture of its glide's place puts it, the two transforms (on the pan group and on the box's group) composed
test('a new layout that comes while Fit pans glides its boxes and lets the pan run on: the two compose', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  await fitHeldAt(page, 60);
  await holdAnimationsOf(page, '[data-node-id]');
  await page.getByRole('checkbox', { name: 'Imports in one column' }).check();
  await expect.poll(async () => (await records(page)).filter((r) => r.node === REDSTONE).length, { message: 'the stub glides' }).toBe(1);
  const run = await page.locator(FLOW_PAN).evaluate((g, stub) => {
    const glide = g.querySelector(`[data-node-id="${stub}"]`)?.getAnimations()[0];
    if (glide === undefined) throw new Error('no glide');
    glide.currentTime = 130;
    return { pans: g.getAnimations().map((a) => [a.id, a.playState, a.currentTime]) };
  }, REDSTONE);
  expect(run.pans, 'Fit\'s pan runs on where it was, untouched by the new layout').toEqual([['pan', 'paused', 60]]);
  const moved = (await records(page)).filter((r) => r.frames.some((frame) => 'transform' in frame) && r.cls !== 'flow-pan');
  expect(moved.map((r) => r.node), 'the stub alone moved').toEqual([REDSTONE]);
  await expectComposed(page);
  await finishMotion(page);
  expect((await loosePipeEnds(page)).loose).toEqual([]);
});

// Task 13b (notes 11): Fit pressed while a new layout's boxes glide. The stub's glide held half way, Fit's pan held at 60 ms: the glide is the same
// animation, where it was, and the stub is drawn where the pan's picture of its glide's place puts it
test('Fit pressed while a new layout glides pans the view and lets the boxes glide on: the two compose', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  await dragCanvas(page, 100, 60);
  await holdAnimationsOf(page, '[data-node-id]');
  await page.getByRole('checkbox', { name: 'Imports in one column' }).check();
  await expect.poll(async () => (await records(page)).filter((r) => r.node === REDSTONE).length, { message: 'the stub glides' }).toBe(1);
  await page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"]`).evaluate((box) => {
    const glide = box.getAnimations()[0];
    if (glide === undefined) throw new Error('no glide');
    glide.currentTime = 130;
    (window as unknown as { __glide: Animation }).__glide = glide;
  });
  await fitHeldAt(page, 60);
  const glide = await page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"]`).evaluate((box) => {
    const now = box.getAnimations();
    return { same: now.length === 1 && now[0] === (window as unknown as { __glide: Animation }).__glide, state: now[0]?.playState, time: now[0]?.currentTime };
  });
  expect(glide, 'the glide runs on where it was, untouched by the pan').toEqual({ same: true, state: 'paused', time: 130 });
  expect(await pansOn(page), 'and the pan runs').toBe(1);
  await expectComposed(page);
  await finishMotion(page);
  expect((await loosePipeEnds(page)).loose).toEqual([]);
});

// Task 13b (notes 6; ledger rulings P2-R36, P2-R57): a replan that drops the box whose head has the focus gives the focus on to the canvas, never
// to the body, and moves no page; the box's ghost, which has no tab stop, takes none of it
test('a replan that drops the box holding the focus gives the focus to the canvas, never the body', async ({ page }) => {
  let served = platesTwoWays();
  const id = await openServing(page, () => served);
  const head = page.locator('[data-step-id="hammer-plate"] .flow-node-head');
  await head.focus();
  await expect(head).toBeFocused();
  const scrolled = await page.evaluate(() => scrollY);
  await watchBodyFocus(page);
  served = circuitLv();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(3);
  await expect(page.locator('svg.flow-canvas')).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(await page.evaluate(() => scrollY), 'the page moved').toBe(scrolled);
});

// Task 13b (notes 6): the other side: a focus the box no longer had (a press elsewhere on the page left it to the body) is nobody's to give on,
// so a replan that then drops that box takes the focus nowhere, the canvas included
test('a replan that drops a box the focus has left takes the focus nowhere', async ({ page }) => {
  let served = platesTwoWays();
  const id = await openServing(page, () => served);
  const head = page.locator('[data-step-id="hammer-plate"] .flow-node-head');
  await head.focus();
  await expect(head).toBeFocused();
  await page.locator('.flow-legend').click();                                          // a press on what takes no focus: the focus goes to the body
  expect(await page.evaluate(() => document.activeElement === document.body), 'the premise: the focus left the box').toBe(true);
  served = circuitLv();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(3);
  await expect(page.locator('svg.flow-canvas')).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

// Task 13b (notes 6): a supporting line opened or closed from the keyboard is laid out again, and its open/collapse button drawn anew, on the
// collapsed line's box or on its open frame: the focus goes on to that button, never to the body
test('a line closed and opened from the keyboard keeps the focus on its button', async ({ page }) => {
  const lined = circuitLv();
  lined.steps = lined.steps.map((s) => (s.id === 'wire' ? { ...s, line: { key: 't:copper_wire@0', name: '1x Copper Wire' } } : s));
  await openWithPlan(page, lined);
  const toggle = page.locator('svg.flow-canvas [data-line-toggle="t:copper_wire@0"]');
  await expect(toggle, 'the premise: a short plan opens its lines').toHaveAttribute('aria-expanded', 'true');
  await watchBodyFocus(page);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('svg.flow-canvas [data-node-id="line:t:copper_wire@0"]'), 'the line closed: one box').toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('svg.flow-canvas [data-group-id="line:t:copper_wire@0"]'), 'the line open again: its frame').toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
});

/** Whether `tip`'s box sits below `el`'s, from its left edge, as a focus tip does (spec §6.2), give or take a pixel. */
async function tipBelow(tip: Locator, el: Locator): Promise<boolean> {
  const [t, e] = [await tip.boundingBox(), await el.boundingBox()];
  return t !== null && e !== null && t.y >= e.y + e.height && t.y <= e.y + e.height + 12 && Math.abs(t.x - e.x) <= 1;
}

// Task 13b (notes 6): a box head with the focus keeps it through a replan that moves its box (the head is the same element), and the tip the
// keyboard's focus shows follows the box while it glides (the tip host places a shown tip at its element once a frame): half way through the
// glide and the new view's pan, both held there, and where they end, it is below the head, from its left edge. The window is tall: the replan's
// "What changed" note moves the diagram down, and in a 720 px window the head's tip goes above it, then away with it past the window's bottom
// (spec §6.2: an element out of view shows no tip)
test('a focused box head keeps the focus and its tip through a replan, the tip going with the box as it glides', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.addInitScript(recordAnimations);
  let served = circuitLv();
  const id = await openServing(page, () => served);
  const head = page.locator('[data-step-id="wire"] .flow-node-head');
  await head.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(head).toBeFocused();
  const tip = page.getByRole('tooltip');
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Wiremill');
  await expect.poll(() => tipBelow(tip, head)).toBe(true);
  await holdAnimationsOf(page, '[data-node-id], g.flow-pan');
  served = platesTwoWays();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(4);
  await expect(head).toBeFocused();
  const glide = (await records(page)).find((r) => r.node === 'wire' && r.frames.some((frame) => 'transform' in frame));
  expect(glide, 'the premise: the box glides').toBeDefined();
  await page.evaluate(() => {
    for (const a of document.getAnimations()) if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && a.playState === 'paused') a.currentTime = 130;
  });
  await expect.poll(() => tipBelow(tip, head), { message: 'half way' }).toBe(true);
  await finishMotion(page);
  await expect.poll(() => tipBelow(tip, head), { message: 'where the box lands' }).toBe(true);
  await expect(tip.locator(':scope > :first-child')).toHaveText('Basic Wiremill');
  await expect(head).toBeFocused();
});

// Task 13b (notes 11; ledger ruling P2-R36): a panel's Close pressed while a new layout glides the box that opened it judges the box where it
// lands: `restingBox` reads a gliding box's own attribute too. "Imports in one column" takes the redstone's stub 280 units left, out of the
// canvas's view; its glide held at its start, the stub still shows where it stood, in the canvas: Close gives the focus to the canvas
test('Close while a new layout glides the box that opened the panel out of view gives the focus to the canvas', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const stub = page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"]`);
  const head = stub.locator('.flow-node-head');
  await head.click();
  const panel = page.getByRole('complementary', { name: 'Import: Redstone' });
  await expect(panel).toBeVisible();
  await expect.poll(() => page.locator('.flow-side').evaluate((el) => el.getAnimations().length)).toBe(0);   // the panel has slid in
  // the stub's left edge 40 px inside the canvas's, so its place in the first column, 252 px left at this zoom, is wholly left of the canvas: a
  // drag to the left from near the canvas's right edge, so the pointer stays in the canvas until the press has become a drag
  const [h, c] = [await head.boundingBox(), await canvas.boundingBox()];
  if (h === null || c === null) throw new Error('no box');
  const [x, y] = [Math.round(c.x + c.width - 24), Math.round(c.y + 24)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.round(c.x + 40 - h.x), y, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(1, 1);
  const dragged = await head.boundingBox();
  expect(dragged?.x, 'the premise: the stub dragged 40 px inside the canvas\'s left edge').toBeCloseTo(c.x + 40, 0);
  await holdAnimationsOf(page, '[data-node-id]');
  await page.getByRole('checkbox', { name: 'Imports in one column' }).check();
  await expect.poll(async () => (await records(page)).filter((r) => r.node === REDSTONE).length, { message: 'the stub glides' }).toBe(1);
  const [onScreen, area] = [await head.boundingBox(), await canvas.boundingBox()];
  if (onScreen === null || area === null) throw new Error('no box');
  expect(apart(onScreen, area), 'the premise: on screen the head shows in the canvas, held where it stood').toBe(false);
  // where it lands: its glide sought to its end (no fill: the box on its attribute) and back, in one task, so nothing is painted
  const rest = await stub.evaluate((box) => {
    const glide = box.getAnimations()[0];
    if (glide === undefined) throw new Error('no glide');
    glide.currentTime = 260;
    const at = box.querySelector('.flow-node-head')?.getBoundingClientRect();
    glide.currentTime = 0;
    return at?.right ?? Number.NaN;
  });
  expect(rest, 'the premise: where it lands the head is wholly left of the canvas').toBeLessThan(area.x);
  await watchBodyFocus(page);
  await panel.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(canvas).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
});

// Task 13b (brief Step 4, notes 7): a new Connections picture glides into place from the last, served here as the line's layout with a change.
// Its hookup said to have found no route has a line more, so its box is taller and the box under it moves: that box glides (the taller picture
// makes the area taller too, whose refit is at once: 13a's resize refit). Then without its hookup the picture has other boxes: the view is
// fitted at once (a refit is never panned) and the boxes glide inside it, so a box moves along one path only, never a pan and a glide at once;
// the hookup's box goes at once (no ghosts here)
test('Connections: a new picture glides its boxes into place, inside the view it is fitted to at once', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  await openConnections(page);
  const { pan } = await fittedConnections(page);
  const id = /\/p\/([^/#]+)/.exec(page.url())?.[1] ?? '';
  const real = (await (await page.request.get(`/api/projects/${id}/layout`)).json()) as Layout;
  expect(real.hookups.length, 'the premise: a hookup').toBeGreaterThan(0);
  let served: Layout = { ...real, hookups: real.hookups.map((h) => ({ ...h, found: false })) };
  await page.route('**/api/projects/*/layout', (route) => route.fulfill({ json: served }));
  const boxes = (): Promise<Record<string, string>> => pan.locator('[data-node]').evaluateAll((all) =>
    Object.fromEntries(all.map((box) => [box.getAttribute('data-node') ?? '', box.getAttribute('transform') ?? ''])));
  /** The server plans the line again with its own settings: its `plan` event makes the page fetch the plan, then the layout served. */
  const planAgain = async (): Promise<void> => {
    const ops = [{ op: 'settings', patch: {} }];
    expect((await page.request.post(`/api/projects/${id}/ops`, { headers: { 'X-Planner-Name': 'e2e' }, data: { ops } })).ok()).toBe(true);
  };
  const glidesOf = async (): Promise<AnimationRecord[]> => (await records(page)).filter((r) => r.cls?.startsWith('conn-node') === true);
  const pans = async (): Promise<AnimationRecord[]> => (await records(page)).filter((r) => r.cls === 'conn-pan');
  const before = await boxes();
  await planAgain();
  await expect.poll(boxes, { message: 'the taller hookup moves a box' }).not.toEqual(before);
  const after = await boxes();
  const moved = Object.keys(after).filter((box) => before[box] !== undefined && before[box] !== after[box]);
  expect(moved.length, 'the premise: a box moved').toBeGreaterThan(0);
  for (const box of moved) {
    const glides = (await glidesOf()).filter((r) => r.node === box && r.frames.some((frame) => 'transform' in frame));
    expect(glides, box).toHaveLength(1);
    expect(glides[0], box).toMatchObject({ duration: 260, delay: 0, fill: 'none', easing: EASE_OUT });
    expect(glides[0]!.frames.map((frame) => translation(frame.transform)), box).toEqual([translation(before[box]), translation(after[box])]);
  }
  expect(await pans(), 'never panned').toEqual([]);
  // without the hookup: other boxes, fitted at once, and the boxes left glide inside the new view
  served = { ...served, hookups: [] };
  const made = (await glidesOf()).length;
  const view = await pan.getAttribute('transform');
  await planAgain();
  await expect(pan.locator('[data-node^="hookup:"]'), 'the hookup\'s box goes').toHaveCount(0);
  await expect(page.locator('.flow-ghost'), 'no ghosts in Connections').toHaveCount(0);
  expect(await pan.getAttribute('transform'), 'fitted again at once').not.toBe(view);
  expect(await pans(), 'and never panned: one motion a box').toEqual([]);
  expect((await glidesOf()).length, 'the boxes glide inside the new view').toBeGreaterThan(made);
});

// Task 13b (notes 3; ledger rulings P2-R93, P2-R94, P2-R96): a replan fades the layer of the goods riding the pipes in with the arrows, a WAAPI
// fade of the layer's group, which the riders' own opacity (a dimmed good's 0.18 and its fade, P2-R94) and their rides never meet: half way
// through the layer's fade, every good the last layout drew is the same <image> on the same ride, running or, dimmed, paused where it is (a
// replan starts no ride over), none has an animation of its own from the replan, and each keeps its own opacity, dimmed or lit, under the layer's
test('a replan\'s fade of the goods\' layer leaves each good its own ride and its own dimmed opacity', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  let served = circuitLv();
  const id = await openServing(page, () => served);
  await page.getByLabel('Find item').selectOption({ label: '1x Copper Wire' });
  await expect(page.locator('svg.flow-canvas')).toHaveClass(/\bfocusing\b/);
  await page.mouse.move(1, 1);
  await finishMotion(page);                                                            // the reveal's pan, and the riders' dimming
  const riders = await page.locator('svg.flow-canvas .flow-rider').evaluateAll((all) => all.map((rider) => {
    const ride = rider.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === 'pipe-ride');
    (rider as unknown as { __ride?: Animation }).__ride = ride;
    return rider.getAttribute('class');
  }));
  expect(riders.filter((cls) => cls?.includes(' dim')).length, 'the premise: dimmed goods').toBeGreaterThan(0);
  await holdAnimationsOf(page, 'g.flow-riders');
  served = platesTwoWays();
  await replan(page, id, 31);
  await expect(stepBoxes(page)).toHaveCount(4);
  const run = await page.locator('svg.flow-canvas g.flow-riders').evaluate((layer) => {
    const fades = layer.getAnimations();
    if (fades.length !== 1) throw new Error(`the layer has ${fades.length} animations`);
    fades[0]!.currentTime = 130 + 65;                                                  // half way through its second half
    const all = [...layer.querySelectorAll('.flow-rider')];
    const kept = all.filter((rider) => (rider as unknown as { __ride?: Animation }).__ride !== undefined);
    return {
      layer: Number(getComputedStyle(layer).opacity),
      kept: kept.length,
      same: kept.every((rider) => rider.getAnimations().includes((rider as unknown as { __ride: Animation }).__ride)),
      riding: kept.every((rider) => (rider as unknown as { __ride: Animation }).__ride.playState === (rider.classList.contains('dim') ? 'paused' : 'running')),
      own: all.filter((rider) => rider.getAnimations().some((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))).length,
      opacities: all.map((rider) => [rider.classList.contains('dim') ? 'dim' : 'lit', getComputedStyle(rider).opacity]),
    };
  });
  expect(run.layer, 'the layer half way through its fade').toBeGreaterThan(0.1);
  expect(run.layer).toBeLessThan(0.9);
  expect(run.kept, 'every good of the last layout is still drawn').toBe(riders.length);
  expect(run.same, 'on the same ride, not started over').toBe(true);
  expect(run.riding, 'running, or paused where a dimmed one is').toBe(true);
  expect(run.own, 'no good has a fade of its own').toBe(0);
  for (const [light, opacity] of run.opacities) expect(opacity, light).toBe(light === 'dim' ? '0.18' : '1');
  await finishMotion(page);
  expect(await page.locator('svg.flow-canvas g.flow-riders').evaluate((layer) => getComputedStyle(layer).opacity)).toBe('1');
});

// Task 13b (notes 11; ledger ruling P2-R35): the scroll. The page is scrolled so the redstone stub's head shows its bottom in the window while
// "Imports in one column" glides it, held at its start, 16 px up (and 252 px left, still in the canvas's view), where it lands wholly above the
// window. Close gives the focus to the head, ends the glide at once, and scrolls the head into the window by where it rests: the whole head is in
// the window once every motion has ended (the other order scrolls to where it is drawn, and the head then goes up out of the window). At 1000 px
// the panel stacks under the diagram, so its Close shows while the canvas's top is above the window
test('Close while a new layout glides the box that opened the panel out of the window ends the glide, then scrolls the head in', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(recordAnimations);
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const head = page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"] .flow-node-head`);
  await head.click();
  const panel = page.getByRole('complementary', { name: 'Import: Redstone' });
  await expect(panel).toBeVisible();
  await expect.poll(() => page.locator('.flow-side').evaluate((el) => el.getAnimations().length)).toBe(0);   // the panel has slid in
  // the stub's left edge 300 px inside the canvas's, so its place in the first column, 252 px left, is in the canvas's view too
  const [h, c] = [await head.boundingBox(), await canvas.boundingBox()];
  if (h === null || c === null) throw new Error('no box');
  const [x, y] = [Math.round(c.x + c.width / 2), Math.round(c.y + 24)];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.round(c.x + 300 - h.x), y, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(1, 1);
  await holdAnimationsOf(page, '[data-node-id]');
  await page.getByRole('checkbox', { name: 'Imports in one column' }).check();
  await expect.poll(async () => (await records(page)).filter((r) => r.node === REDSTONE).length, { message: 'the stub glides' }).toBe(1);
  // a spacer after the page lets it scroll, and the window's top goes 8 px above the head's bottom as drawn
  const scrolled = await head.evaluate((el) => {
    const spacer = document.createElement('div');
    spacer.setAttribute('data-test-spacer', '');
    spacer.style.height = '2000px';
    document.body.append(spacer);
    scrollTo(0, Math.round(scrollY + el.getBoundingClientRect().bottom - 8));
    return scrollY;
  });
  const close = panel.getByRole('button', { name: 'Close the panel' });
  await expect(close, 'the premise: Close shows').toBeInViewport();
  const drawn = await head.boundingBox();
  if (drawn === null) throw new Error('no head');
  expect(drawn.y + drawn.height, 'the premise: as drawn, the head\'s bottom shows in the window').toBeGreaterThan(0);
  // where it lands: its glide sought to its end and back, in one task, so nothing is painted
  const rest = await head.evaluate((el) => {
    const glide = el.closest('[data-node-id]')?.getAnimations()[0];
    const area = el.closest('svg.flow-canvas')?.getBoundingClientRect();
    if (glide === undefined || area === undefined) throw new Error('no glide');
    glide.currentTime = 260;
    const box = el.getBoundingClientRect();
    glide.currentTime = 0;
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, area: { top: area.top, left: area.left, right: area.right } };
  });
  expect(rest.bottom, 'the premise: where it lands the head is wholly above the window').toBeLessThan(0);
  expect(rest.top, 'and in the canvas\'s view').toBeGreaterThanOrEqual(rest.area.top);
  expect(rest.left).toBeGreaterThanOrEqual(rest.area.left);
  expect(rest.right).toBeLessThanOrEqual(rest.area.right);
  await watchBodyFocus(page);
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(head).toBeFocused();
  expect(await page.locator(`svg.flow-canvas [data-node-id="${REDSTONE}"]`).evaluate((box) => box.getAnimations().length), 'the glide ended').toBe(0);
  await finishMotion(page);
  // the whole head, but for the half pixel a scroll to a whole pixel can leave (the glide left running would leave its top 16 px out)
  const landed = await head.boundingBox();
  if (landed === null) throw new Error('no head');
  expect(landed.y, 'the whole head: its top in the window').toBeGreaterThan(-1);
  expect(landed.y + landed.height, 'and its bottom').toBeLessThanOrEqual(900);
  expect(await page.evaluate(() => scrollY), 'the page scrolled up to it').toBeLessThan(scrolled);
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
});

/** `plan` without the raw good `key`: its import stub, its arrow and its row go, and every stub after it in the column moves up a place. */
function without(plan: Plan, key: string): Plan {
  return {
    ...plan, steps: plan.steps.map((s) => ({ ...s, inputs: s.inputs.filter((p) => p.key !== key) })),
    flows: plan.flows.filter((f) => f.key !== key), rawInputs: plan.rawInputs.filter((r) => r.key !== key),
  };
}

// Review focus 4 (spec §16.3, Task 13b): a replan that moves more than GLIDE_LIMIT (200) boxes snaps into place, so no frame of a big plan
// runs long: nothing glides, fades or goes as a ghost, and the browser is not even asked whether it can glide. manyEdges' 201 stubs sit in one
// column: without its first good, every stub after it moves up a place; without one half way down, half of them do, and that replan glides
test('a replan that moves more than 200 boxes snaps into place, and one that moves fewer glides', async ({ page }) => {
  await page.addInitScript(recordAnimations);
  let served = manyEdges();
  const id = await openServing(page, () => served);
  /** Replans to `plan` and gives how many boxes moved. */
  const replanTo = async (plan: Plan, amount: number, gone: string): Promise<number> => {
    const before = await places(page);
    served = plan;
    await replan(page, id, amount);
    await expect(page.locator(`svg.flow-canvas [data-node-id="${gone}"]`)).toHaveCount(0);
    const after = await places(page);
    return Object.keys(after).filter((box) => before[box] !== undefined && before[box] !== after[box]).length;
  };
  expect(await replanTo(without(served, 't:g0@0'), 31, 'import:t:g0@0@big'), 'the premise: more than 200 boxes moved').toBeGreaterThan(200);
  expect(await allRecords(page), 'it snaps: no glide, fade or ghost, and no probe').toEqual([]);
  await expect(page.locator('svg.flow-canvas .flow-ghost')).toHaveCount(0);
  const moved = await replanTo(without(served, 't:g100@0'), 32, 'import:t:g100@0@big');
  expect(moved, 'the premise: 200 boxes or fewer moved').toBeLessThanOrEqual(200);
  const made = await records(page);
  expect(made.filter((r) => r.cls?.startsWith('flow-node') === true && r.frames.some((frame) => 'transform' in frame)), 'it glides').toHaveLength(moved);
  expect(made.filter((r) => r.cls?.startsWith('flow-ghost') === true), 'and its stub goes as a ghost').toHaveLength(1);
});
