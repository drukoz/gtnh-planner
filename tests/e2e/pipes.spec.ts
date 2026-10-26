// The pipes of the diagrams move and stay connected (restyle plan Phase 1 Tasks 6 and 7, design spec §7 and §7a, review focuses 4
// and 5). The Flow part opens a real project of the Mini-GT e2e server and serves a fixture plan in place of the server's, the way
// flow-focus.spec.ts does: the contents of every pipe move, every pipe starts and ends on the flange of a port at any zoom, a
// drag stops them, and a user who asked for reduced motion gets pipes that hold still. The Connections part lays an EnderIO line
// out on the uploaded sample world, the way connections.spec.ts does: the contents of its pipes move too. Phase 2 Task 12 (spec §15):
// goods ride the Flow pipes, never take the pointer, stop with the pipes and are not drawn for reduced motion; above 200 arrows only
// the lit pipes carry them.

import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import { circuitLv, copperUnsourced, manyEdges } from './fixtures/plans.ts';
import { createProject, login, openConnections, setName } from './helpers.ts';

const LV_CIRCUITS: Partial<PlanSettings> = { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 };

/** Opens a new project whose plan, every time the page asks for one, is `plan`, on its Flow tab. */
async function openWithPlan(page: Page, plan: Plan): Promise<void> {
  await page.route('**/api/projects/*/plan', (route) => route.fulfill({ json: plan }));
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Pipes', LV_CIRCUITS);
  await expect(page.locator('svg.flow-canvas [data-step-id]')).toHaveCount(plan.steps.length);
}

/** The ends of the pipes that no flange holds (`[]` when every one is on a flange), and how many pipes were measured. */
async function loosePipeEnds(page: Page): Promise<{ loose: string[]; pipes: number }> {
  return page.evaluate(() => {
    const flanges = [...document.querySelectorAll('svg.flow-canvas rect.flow-port')].map((flange) => flange.getBoundingClientRect());
    const pipes = [...document.querySelectorAll<SVGPathElement>('svg.flow-canvas path.flow-edge-line')];
    const loose: string[] = [];
    for (const pipe of pipes) {
      const toScreen = pipe.getScreenCTM();
      const id = pipe.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? '?';
      if (toScreen === null) {
        loose.push(`${id}: not drawn`);
        continue;
      }
      const ends: Array<[string, DOMPoint]> = [['start', pipe.getPointAtLength(0)], ['end', pipe.getPointAtLength(pipe.getTotalLength())]];
      for (const [which, point] of ends) {
        const at = new DOMPoint(point.x, point.y).matrixTransform(toScreen);
        // inside some flange: across it give or take a pixel, and within its height
        const held = flanges.some((f) => at.x >= f.left - 1 && at.x <= f.right + 1 && at.y >= f.top && at.y <= f.bottom);
        if (!held) loose.push(`${id} ${which} at (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`);
      }
    }
    return { loose, pipes: pipes.length };
  });
}

/** What `expectMoving` watches: the keyframes that move it, the computed property they move, and how its messages name it. */
interface Motion { animation: string; property: 'strokeDashoffset' | 'offsetDistance'; offset: string; moves: string; watched: string }

/**
 * Watches the element `moving` finds first, the same element all along: it runs `motion.animation`, and the offset that animation moves
 * changes within two seconds while that element stays in the page (ruling R40: a poll, not a fixed sleep). A reading of an element the view
 * had drawn anew would be another's, and the empty offset of a detached one differs from any number: neither counts as a move.
 */
async function expectMoving(moving: Locator, motion: Motion): Promise<void> {
  const element = await moving.elementHandle();
  if (element === null) throw new Error(`no ${motion.watched} to watch`);
  try {
    const read = (): Promise<{ attached: boolean; name: string; offset: number }> => element.evaluate((el, property) => {
      const style = getComputedStyle(el);
      return { attached: el.isConnected, name: style.animationName, offset: Number.parseFloat(style[property]) };
    }, motion.property);
    const first = await read();
    expect(first.name).toBe(motion.animation);
    expect(Number.isFinite(first.offset), `${motion.offset} reads as a number, not "${first.offset}"`).toBe(true);
    await expect.poll(async () => {
      const now = await read();
      return now.attached && Number.isFinite(now.offset) && now.offset !== first.offset;
    }, { message: motion.moves, timeout: 2_000 }).toBe(true);
    expect((await read()).attached, `the ${motion.watched} watched is still in the page`).toBe(true);
  } finally {
    await element.dispose();
  }
}

/** The dashes of the pipe `contents` finds first are the moving pipe's (`pipe-flow`): their offset along it changes (`expectMoving`). */
function expectDashesMove(contents: Locator): Promise<void> {
  return expectMoving(contents, {
    animation: 'pipe-flow', property: 'strokeDashoffset', offset: 'the dash offset',
    moves: 'the dashes move along the pipe, which stays in the page', watched: 'pipe',
  });
}

/** The good `rider` finds first rides its pipe (`pipe-ride`): its offset along the path changes (`expectMoving`). */
function expectRiderMoves(rider: Locator): Promise<void> {
  return expectMoving(rider, {
    animation: 'pipe-ride', property: 'offsetDistance', offset: 'the offset along the path',
    moves: 'the good rides along its pipe, and stays in the page', watched: 'rider',
  });
}

/** The play state of the first rider in the Flow diagram (its CSS animation's: `running` or `paused`). */
const riderState = (page: Page): Promise<string> => (
  page.locator('svg.flow-canvas .flow-rider').first().evaluate((el) => getComputedStyle(el).animationPlayState)
);

test('flow pipes move', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await expectDashesMove(page.locator('.flow-edge-flow').first());
});

// Phase 2 spec §15: a good rides each pipe, its icon carried along the arrow's path by the stylesheet (`pipe-ride` on `offset-distance`); it
// takes no pointer, so the arrow under it keeps its hover, its click and its tip; and no more ride than there are pipes that carry something
test('goods ride the flow pipes, attached, and never take the pointer', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  // a rider drawn from its icon (the Iron Ingot's has the pack's texture): a placeholder gives way to the image once the icon has come, and an
  // image stays, so the element watched is the same all along
  const rider = canvas.locator('image.flow-rider').first();
  await expect(rider).toBeAttached();
  await expectRiderMoves(rider);
  const riders = await canvas.locator('.flow-rider').count();
  expect(riders, 'the line has goods riding').toBeGreaterThan(0);
  expect(riders).toBeLessThanOrEqual(await canvas.locator('.flow-edge:not(.missing)').count());
  // the whole diagram in view, then at each rider's centre (read and hit in one task, so it does not move in between): a rider that took the
  // pointer would be what the page finds there, wherever no box covers it (at a flange it slips under the box); the page finds what is under it
  await page.getByRole('button', { name: 'Fit' }).click();
  const hits = await canvas.evaluate((svg) => [...svg.querySelectorAll<SVGElement>('.flow-rider')].map((one) => {
    const box = one.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    one.style.pointerEvents = 'auto';
    const taking = document.elementFromPoint(x, y) === one;
    one.style.pointerEvents = '';
    const found = document.elementFromPoint(x, y);
    return { taking, rider: found?.classList.contains('flow-rider') ?? false, inCanvas: found !== null && svg.contains(found) };
  }));
  const open = hits.filter((hit) => hit.taking);
  expect(open.length, 'some rider is in view and under no box, so the check bites').toBeGreaterThan(0);
  for (const hit of open) expect(hit).toEqual({ taking: true, rider: false, inCanvas: true });
});

/** One frame of a rider in the log `logRiders` keeps: its ride's time, whether it shows its placeholder, and whether it is in the page. */
interface RiderFrame { t: number | null; placeholder: boolean; connected: boolean }

/** Runs in the page before its scripts: every frame, each Flow rider there is or was, by element, and how its ride stands (`window.riderLog`). */
function logRiders(): void {
  const log = new Map<Element, RiderFrame[]>();
  (window as unknown as { riderLog: Map<Element, RiderFrame[]> }).riderLog = log;
  const frame = (): void => {
    for (const rider of document.querySelectorAll('svg.flow-canvas .flow-rider')) if (!log.has(rider)) log.set(rider, []);
    for (const [rider, frames] of log) {
      const ride = rider.getAnimations().find((a) => (a as CSSAnimation).animationName === 'pipe-ride');
      const t = ride?.currentTime;
      frames.push({ t: typeof t === 'number' ? t : null, placeholder: rider.classList.contains('placeholder'), connected: rider.isConnected });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// fix round 1 (ledger ruling P2-R96): a rider is one <image> from its first frame, its placeholder square swapped in place for its icon, so its
// ride goes on when the icon comes. A log kept from before the page's own scripts follows every rider, element by element, frame by frame.
test('a good keeps its ride when its icon comes, in the image it started as', async ({ page }) => {
  await page.addInitScript(logRiders);
  await openWithPlan(page, circuitLv());
  const log = (): Promise<Array<{ connected: boolean; frames: RiderFrame[] }>> => page.evaluate(() => (
    [...(window as unknown as { riderLog: Map<Element, RiderFrame[]> }).riderLog].map(([rider, frames]) => ({ connected: rider.isConnected, frames }))
  ));
  // the Iron Ingot's icon comes from the pack: until a rider has shown an icon for ten frames
  await expect.poll(async () => (await log()).some(({ frames }) => frames.filter((f) => !f.placeholder).length >= 10), {
    message: 'a rider shows its icon', timeout: 10_000,
  }).toBe(true);
  const riders = await log();
  // no rider was ever taken out of the page for another: every one seen is there still, and there are no others
  expect(riders.map((r) => r.connected)).not.toContain(false);
  expect(riders).toHaveLength(await page.locator('svg.flow-canvas .flow-rider').count());
  // one rider at least was seen as its placeholder first and then, the same element, as its icon; its ride's time grew all along
  const came = riders.filter(({ frames }) => frames[0]?.placeholder === true && frames.some((f) => !f.placeholder));
  expect(came.length, 'a rider whose icon came while it was watched').toBeGreaterThan(0);
  for (const { frames } of came) {
    const arrived = frames.findIndex((f) => !f.placeholder);
    const before = frames.slice(0, arrived).map((f) => f.t).filter((t): t is number => t !== null);
    const after = frames.slice(arrived).map((f) => f.t).filter((t): t is number => t !== null);
    expect(before.length, 'its ride was under way before its icon came').toBeGreaterThan(0);
    const times = [...before, ...after];
    for (let i = 1; i < times.length; i++) expect(times[i], `frame ${i}: the ride's time never goes back`).toBeGreaterThanOrEqual(times[i - 1]!);
    expect(after.at(-1)!, 'and it grew past the icon\'s arrival').toBeGreaterThan(before.at(-1)!);
  }
});

// fix round 1 (ledger ruling P2-R97): a ride runs on 9 px past each end of its arrow, into the boxes, which are drawn over it, so nothing shows
// at a port: at the start of its ride a good lies wholly inside the box it leaves, and at the end wholly inside the box it reaches
test('a ride starts and ends under the boxes, so no good shows at a port', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await page.getByRole('button', { name: 'Fit' }).click();
  const ends = await page.locator('svg.flow-canvas').evaluate((svg) => {
    const boxOf = (id: string): DOMRect | undefined => [...svg.querySelectorAll('[data-node-id]')]
      .find((g) => g.getAttribute('data-node-id') === id)?.querySelector(':scope > rect.flow-node-box')?.getBoundingClientRect();
    const within = (a: DOMRect, b: DOMRect | undefined): boolean => (
      b !== undefined && a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom
    );
    const pipes = [...svg.querySelectorAll('.flow-edge:not(.missing)')];
    return [...svg.querySelectorAll<SVGElement>('.flow-rider')].map((rider, i) => {
      // its arrow: the riders come in the arrows' order (ledger ruling P2-R93), and an arrow's id is `<from>|out|<key>-><to>|in|<key>`
      const id = pipes[i]?.getAttribute('data-edge-id') ?? '';
      const [from = '', to = ''] = id.split('->').map((port) => port.split('|')[0] ?? '');
      for (const ride of rider.getAnimations()) ride.cancel();                         // the offset below places it, not its ride
      rider.style.offsetDistance = '0%';
      const start = within(rider.getBoundingClientRect(), boxOf(from));
      rider.style.offsetDistance = '100%';
      const end = within(rider.getBoundingClientRect(), boxOf(to));
      return { id, start, end };
    });
  });
  expect(ends).toHaveLength(6);
  for (const end of ends) expect(end).toEqual({ id: end.id, start: true, end: true });
});

// fix round 1 (M1): the goods ride in a layer of their own, hidden from assistive technology, after every arrow and before every box (so a box
// covers each end of a ride) and the lit tags; under a focus each good is lit or dimmed as its pipe is (they come in the pipes' order)
test('the goods ride in a layer of their own, over the pipes and under the boxes and the lit tags, lit and dimmed with their pipes', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  await expect(canvas.locator('g.flow-riders')).toHaveAttribute('aria-hidden', 'true');
  const order = (): Promise<{ afterPipes: boolean; beforeBoxes: boolean; beforeTags: boolean; tags: number }> => canvas.evaluate((svg) => {
    const layer = svg.querySelector('g.flow-riders');
    const pipes = svg.querySelectorAll('.flow-edge');
    const tags = [...svg.querySelectorAll('.flow-edge-tag')];
    const follows = (a: Node | null | undefined, b: Node | null | undefined): boolean => (
      a !== null && a !== undefined && b !== null && b !== undefined && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
    return {
      afterPipes: follows(pipes[pipes.length - 1], layer), beforeBoxes: follows(layer, svg.querySelector('[data-node-id]')),
      beforeTags: tags.every((tag) => follows(layer, tag)), tags: tags.length,
    };
  });
  expect(await order()).toEqual({ afterPipes: true, beforeBoxes: true, beforeTags: true, tags: 0 });
  await page.locator('[data-port$="|out|t:copper_wire@0"]').hover();
  await expect(canvas).toHaveClass(/\bfocusing\b/);
  expect(await order()).toEqual({ afterPipes: true, beforeBoxes: true, beforeTags: true, tags: 1 });
  const states = await canvas.evaluate((svg) => {
    const state = (el: Element): string => (el.classList.contains('hl') ? 'hl' : el.classList.contains('dim') ? 'dim' : 'neither');
    return { pipes: [...svg.querySelectorAll('.flow-edge:not(.missing)')].map(state), riders: [...svg.querySelectorAll('.flow-rider')].map(state) };
  });
  expect(states.riders).toEqual(states.pipes);
  expect(states.pipes, 'the focus lights a pipe and dims the others').toEqual(expect.arrayContaining(['hl', 'dim']));
});

// fix round 1 (M5): a pipe from a missing source carries nothing, so no good rides it, and every other pipe has its good
test('a pipe from a missing source carries no good', async ({ page }) => {
  await openWithPlan(page, copperUnsourced());
  const canvas = page.locator('svg.flow-canvas');
  await expect(canvas.locator('.flow-edge.missing')).toHaveCount(1);
  const carrying = await canvas.locator('.flow-edge:not(.missing)').count();
  expect(carrying).toBeGreaterThan(0);
  await expect(canvas.locator('.flow-rider')).toHaveCount(carrying);
});

/**
 * Runs in the page: how many Flow riders and arrows React has drawn again since the last call, by their props objects (which React gives a
 * drawn element anew and keeps on one it leaves as it is), and whether every rider's could be read; keeps the current ones for the next call.
 */
function drawnAgain(svg: SVGSVGElement): { read: boolean; riders: number; pipes: number } {
  const props = (el: Element): unknown => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    return key === undefined ? undefined : (el as unknown as Record<string, unknown>)[key];
  };
  const now = { riders: [...svg.querySelectorAll('.flow-rider')].map(props), pipes: [...svg.querySelectorAll('.flow-edge')].map(props) };
  const w = window as unknown as { drawn?: typeof now };
  const before = w.drawn ?? { riders: [], pipes: [] };
  w.drawn = now;
  return {
    read: now.riders.length > 0 && now.riders.every((p) => p !== undefined),
    riders: now.riders.filter((p, i) => p !== before.riders[i]).length, pipes: now.pipes.filter((p, i) => p !== before.pipes[i]).length,
  };
}

// fix round 1 (M3): a rider is memoized on its arrow and its light, so a pan or a zoom, which draws the canvas again (its arrows anew), leaves
// every rider as it was
test('a pan or a zoom draws no good again', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const frames = (): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  // a rider draws again when its icon comes: the icons have come once two frames pass with no rider drawn again
  await expect(canvas.locator('image.flow-rider:not(.placeholder)')).not.toHaveCount(0);
  await expect.poll(async () => {
    await canvas.evaluate(drawnAgain);
    await frames();
    return (await canvas.evaluate(drawnAgain)).riders;
  }, { message: 'the riders settle' }).toBe(0);
  const transform = (): Promise<string | null> => canvas.locator(':scope > g').evaluate((g) => g.getAttribute('transform'));
  // a pan, from the top left corner, which the diagram leaves empty (it opens on the target, at the right), so nothing is hovered on the way
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  const opened = await transform();
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 26, { steps: 4 });
  await page.mouse.up();
  await expect.poll(transform).not.toBe(opened);
  expect(await canvas.evaluate(drawnAgain)).toEqual({ read: true, riders: 0, pipes: 6 });
  // a zoom
  const panned = await transform();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(transform).not.toBe(panned);
  expect(await canvas.evaluate(drawnAgain)).toEqual({ read: true, riders: 0, pipes: 6 });
});

test('every flow pipe starts and ends on a flange', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const opened = await loosePipeEnds(page);                                            // at the zoom a diagram opens at
  expect(opened.pipes, 'the plan has pipes to measure').toBeGreaterThan(0);
  expect(opened.loose).toEqual([]);
  // the ends scale with the boxes: true zoomed out to show it all, and zoomed in as far as it goes
  await page.getByRole('button', { name: 'Fit' }).click();
  expect((await loosePipeEnds(page)).loose).toEqual([]);
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 8; i++) await zoomIn.click();
  expect((await loosePipeEnds(page)).loose).toEqual([]);
});

test('a drag stops the flow pipes until it ends', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const state = (): Promise<string> => page.locator('.flow-edge-flow').first().evaluate((el) => getComputedStyle(el).animationPlayState);
  expect(await state()).toBe('running');
  expect(await riderState(page), 'the goods ride with the pipes').toBe('running');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  // from the top left corner, which the diagram leaves empty (it opens on the target, at the right)
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 26, { steps: 4 });
  await expect(canvas).toHaveClass(/\bdragging\b/);
  expect(await state()).toBe('paused');
  expect(await riderState(page), 'and stop with them').toBe('paused');
  await page.mouse.up();
  await expect(canvas).not.toHaveClass(/\bdragging\b/);
  expect(await state()).toBe('running');
  expect(await riderState(page)).toBe('running');
});

test('a second pointer cannot leave the flow pipes stopped', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const canvas = page.locator('svg.flow-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  // the mouse drags from the empty top left corner, as above
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 26, { steps: 4 });
  await expect(canvas).toHaveClass(/\bdragging\b/);
  // then a finger presses and lets go without moving (dispatched: Playwright's touchscreen only taps), and the mouse lets go after
  // it. The press takes the drag over, so the mouse's release is not its drag's end and the finger's is no drag's end: the old
  // handlers left `dragging` on, and every pipe stopped, until some later drag ended
  const finger = (type: 'pointerdown' | 'pointerup'): Promise<void> => canvas.evaluate((svg, [kind, x, y]) => {
    svg.dispatchEvent(new PointerEvent(kind, {
      bubbles: true, pointerId: 2, pointerType: 'touch', isPrimary: false, button: 0, buttons: kind === 'pointerdown' ? 1 : 0, clientX: x, clientY: y,
    }));
  }, [type, box.x + 200, box.y + 6] as const);
  await finger('pointerdown');
  await expect(canvas).not.toHaveClass(/\bdragging\b/);                               // the mouse's drag pans no more
  await finger('pointerup');
  await page.mouse.up();
  await expect(canvas).not.toHaveClass(/\bdragging\b/);
  expect(await page.locator('.flow-edge-flow').first().evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('running');
});

test('reduced motion stills the pipes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWithPlan(page, circuitLv());
  const count = (): Promise<string> => page.locator('.flow-edge-flow').first().evaluate((el) => getComputedStyle(el).animationIterationCount);
  const rider = (): Promise<string> => page.locator('svg.flow-canvas .flow-rider').first().evaluate((el) => getComputedStyle(el).display);
  expect(await count()).toBe('1');                                                     // run once, for a millisecond: still dashes
  expect(await rider(), 'no good rides (Phase 2 spec §15.1)').toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await count(), 'without the preference the pipes flow for ever, so the check above is not vacuous').toBe('infinite');
  expect(await rider(), 'and the goods ride them').not.toBe('none');
});

test('connections pipes move', async ({ page }) => {
  const view = await openConnections(page);
  await expectDashesMove(view.locator('.conn-edge-flow').first());
});

// Ruling R32: a Connections arrow head takes the colour of its pipe with `context-stroke`, which WebKit does not know: it would fill the
// head black, lost on the dark casing, so a rule before gives it the items' yellow. The build's CSS minifier keeps only the last `fill` of
// one rule (it dropped the fallback of `fill: var(--item); fill: context-stroke`), so `context-stroke` is an @supports rule of its own:
// this asks the stylesheet the built page loaded that both rules are there.
test('the built stylesheet keeps a fallback colour for the Connections arrow heads', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const heads = await page.evaluate(() => {
    const found: string[] = [];
    const walk = (rules: CSSRuleList, within: string): void => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText === '.conn-arrow-head') found.push(`${within}fill: ${rule.style.getPropertyValue('fill')}`);
        else if (rule instanceof CSSSupportsRule) walk(rule.cssRules, `@supports ${rule.conditionText.replace(/\s+/g, '')} `);   // as minified or not
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules, '');
    return found;
  });
  expect(heads).toEqual(['fill: var(--item)', '@supports (fill:context-stroke) fill: context-stroke']);
});

// Ruling R31 (WCAG 2.2.2 Pause, Stop, Hide): the pipes move for as long as a diagram is shown, so the toolbars of both diagrams have a
// button that stops them where they are. It is one setting for this browser: it holds when the page is loaded again and on the other
// diagram, until Play pipes.
test('a Pause pipes button stops the pipes of both diagrams, and this browser remembers it', async ({ page }) => {
  const view = await openConnections(page);
  const playState = (selector: string): Promise<string> => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationPlayState);

  // the line's Flow diagram: its pipes move until the button stops them
  await page.getByRole('tab', { name: 'Flow' }).click();
  const canvas = page.locator('svg.flow-canvas');
  await expect(canvas.locator('.flow-edge-flow').first()).toBeAttached();
  expect(await playState('.flow-edge-flow')).toBe('running');
  expect(await riderState(page), 'the goods ride the Flow pipes').toBe('running');
  const pause = page.getByRole('button', { name: 'Pause pipes' });
  await expect(pause).not.toHaveAttribute('aria-pressed');                            // R44: the label says what a press does
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play pipes' })).not.toHaveAttribute('aria-pressed');
  await expect(canvas).toHaveClass(/\bpipes-paused\b/);
  expect(await playState('.flow-edge-flow')).toBe('paused');
  expect(await riderState(page), 'Pause pipes stops the goods too (Phase 2 spec §3.3)').toBe('paused');

  // loaded again, the page keeps them paused
  await page.reload();
  await expect(page.locator('svg.flow-canvas .flow-edge-flow').first()).toBeAttached();
  await expect(page.getByRole('button', { name: 'Play pipes' })).not.toHaveAttribute('aria-pressed');
  expect(await playState('.flow-edge-flow')).toBe('paused');
  expect(await riderState(page)).toBe('paused');

  // the Connections tab has them paused too, and its Play plays the pipes of both
  await page.getByRole('tab', { name: 'Connections' }).click();
  await expect(view.locator('.conn-edge-flow').first()).toBeAttached();
  await expect(view).toHaveAttribute('data-pipes', 'paused');
  expect(await playState('.conn-edge-flow')).toBe('paused');
  await page.getByRole('button', { name: 'Play pipes' }).click();
  await expect(page.getByRole('button', { name: 'Pause pipes' })).not.toHaveAttribute('aria-pressed');
  await expect(view).toHaveAttribute('data-pipes', 'all');
  expect(await playState('.conn-edge-flow')).toBe('running');
  await page.getByRole('tab', { name: 'Flow' }).click();
  await expect(page.locator('svg.flow-canvas .flow-edge-flow').first()).toBeAttached();
  await expect(page.locator('svg.flow-canvas')).not.toHaveClass(/\bpipes-paused\b/);
  expect(await playState('.flow-edge-flow')).toBe('running');
  expect(await riderState(page)).toBe('running');
});

// Deferred F8 (Phase 2 spec §15.1 and §15.5): past 200 arrows a diagram moves only its lit pipes (`many-edges`), and only those carry goods:
// none until something is lit, then one on the one lit arrow
test('above 200 arrows only the lit pipes carry goods', async ({ page }) => {
  await openWithPlan(page, manyEdges());
  const canvas = page.locator('svg.flow-canvas');
  await expect(canvas).toHaveClass(/\bmany-edges\b/);
  await expect(canvas.locator('.flow-edge')).toHaveCount(202);                         // every arrow is drawn, so the riders' count below is theirs
  await expect(canvas.locator('.flow-rider')).toHaveCount(0);
  await page.getByLabel('Find item').selectOption('t:g0@0');
  await expect(canvas.locator('.flow-edge.hl')).toHaveCount(1);
  await expect(canvas.locator('.flow-rider')).toHaveCount(1);
});
