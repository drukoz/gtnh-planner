// The pipes of the diagrams move and stay connected (restyle plan Phase 1 Tasks 6 and 7, design spec §7 and §7a, review focuses 4
// and 5). The Flow part opens a real project of the Mini-GT e2e server and serves a fixture plan in place of the server's, the way
// flow-focus.spec.ts does: the contents of every pipe move, every pipe starts and ends on the flange of a port at any zoom, a
// drag stops them, and a user who asked for reduced motion gets pipes that hold still. The Connections part lays an EnderIO line
// out on the uploaded sample world, the way connections.spec.ts does: the contents of its pipes move too.

import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import { circuitLv } from './fixtures/plans.ts';
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

/**
 * Watches the dashes of the pipe `contents` finds first, the same element all along: they are the moving pipe's (`pipe-flow`), and their
 * offset along the pipe changes within two seconds while that element stays in the page (ruling R40: a poll, not a fixed sleep). A
 * reading of a pipe the view had drawn anew would be another pipe's, and the empty offset of a detached one differs from any number:
 * neither counts as a move.
 */
async function expectDashesMove(contents: Locator): Promise<void> {
  const pipe = await contents.elementHandle();
  if (pipe === null) throw new Error('no pipe to watch');
  try {
    const read = (): Promise<{ attached: boolean; name: string; offset: number }> => pipe.evaluate((el) => {
      const style = getComputedStyle(el);
      return { attached: el.isConnected, name: style.animationName, offset: Number.parseFloat(style.strokeDashoffset) };
    });
    const first = await read();
    expect(first.name).toBe('pipe-flow');
    expect(Number.isFinite(first.offset), `the dash offset reads as a number, not "${first.offset}"`).toBe(true);
    await expect.poll(async () => {
      const now = await read();
      return now.attached && Number.isFinite(now.offset) && now.offset !== first.offset;
    }, { message: 'the dashes move along the pipe, which stays in the page', timeout: 2_000 }).toBe(true);
    expect((await read()).attached, 'the pipe watched is still in the page').toBe(true);
  } finally {
    await pipe.dispose();
  }
}

test('flow pipes move', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  await expectDashesMove(page.locator('.flow-edge-flow').first());
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
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  // from the top left corner, which the diagram leaves empty (it opens on the target, at the right)
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 26, { steps: 4 });
  await expect(canvas).toHaveClass(/\bdragging\b/);
  expect(await state()).toBe('paused');
  await page.mouse.up();
  await expect(canvas).not.toHaveClass(/\bdragging\b/);
  expect(await state()).toBe('running');
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
  expect(await count()).toBe('1');                                                     // run once, for a millisecond: still dashes
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await count(), 'without the preference the pipes flow for ever, so the check above is not vacuous').toBe('infinite');
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
  const pause = page.getByRole('button', { name: 'Pause pipes' });
  await expect(pause).not.toHaveAttribute('aria-pressed');                            // R44: the label says what a press does
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play pipes' })).not.toHaveAttribute('aria-pressed');
  await expect(canvas).toHaveClass(/\bpipes-paused\b/);
  expect(await playState('.flow-edge-flow')).toBe('paused');

  // loaded again, the page keeps them paused
  await page.reload();
  await expect(page.locator('svg.flow-canvas .flow-edge-flow').first()).toBeAttached();
  await expect(page.getByRole('button', { name: 'Play pipes' })).not.toHaveAttribute('aria-pressed');
  expect(await playState('.flow-edge-flow')).toBe('paused');

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
});
