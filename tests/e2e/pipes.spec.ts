// The pipes of the diagrams move and stay connected (restyle plan Phase 1 Task 6, design spec §7 and §7a, review focuses 4 and
// 5). The Flow part opens a real project of the Mini-GT e2e server and serves a fixture plan in place of the server's, the way
// flow-focus.spec.ts does: the contents of every pipe move, every pipe starts and ends on the flange of a port at any zoom, a
// drag stops them, and a user who asked for reduced motion gets pipes that hold still.

import { test, expect, type Page } from '@playwright/test';
import type { Plan, PlanSettings } from '../../src/shared/types/plan.ts';
import { circuitLv } from './fixtures/plans.ts';
import { createProject, login, setName } from './helpers.ts';

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

test('flow pipes move', async ({ page }) => {
  await openWithPlan(page, circuitLv());
  const contents = page.locator('.flow-edge-flow').first();
  const [name, before, after] = await contents.evaluate(async (el) => {
    const style = getComputedStyle(el);
    const first = style.strokeDashoffset;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return [style.animationName, first, getComputedStyle(el).strokeDashoffset];
  });
  expect(name).toBe('pipe-flow');
  expect(after, 'the dashes have moved along the pipe in a quarter of a second').not.toBe(before);
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
