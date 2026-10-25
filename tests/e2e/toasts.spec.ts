// Toasts (Phase 2 spec §12, D14; Task 9a): what was just done, said in a polite region the App draws in the window's corner after the page, so
// a toast lives on across the page's own navigation ("Created “X”" is shown on the list and read on the project), with Undo where the action
// can be taken back: here, a rename. Under reduced motion a toast appears with no entrance. While the settings drawer is open the region is
// inert, out of the keyboard's and the pointer's reach (the drawer is a layer of its own, ruling R36), whether the Settings button opened it
// or it opened by itself (the Make-picker fix: below 900 px a project with no target opens it); so the narrow cases that rename give their
// project a target, without which the drawer opens by itself and the head, the name with it, is inert. Task 9b adds the deleted project and note.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, login, LV_CIRCUITS, setName, SETTINGS_BUTTON } from './helpers.ts';

/** The toast that says `text`, in the region of notifications. */
const toastOf = (page: Page, text: string): Locator =>
  page.getByRole('region', { name: 'Notifications' }).getByRole('listitem').filter({ hasText: text });

/** Renames the open project as a person does: a new name in the head's field, then Enter. */
async function rename(page: Page, name: string): Promise<void> {
  const field = page.getByRole('textbox', { name: 'Project name' });
  await field.fill(name);
  await field.press('Enter');
}

test('renaming offers Undo', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts rename');
  const field = page.getByRole('textbox', { name: 'Project name' });
  await rename(page, 'Toasts renamed');
  const toast = toastOf(page, 'Renamed to “Toasts renamed”');
  await expect(toast).toBeVisible();
  await expect(field).toHaveValue('Toasts renamed');
  await toast.getByRole('button', { name: 'Undo' }).click();
  // the name is back, in the field and on the server, and the toast has gone
  await expect.poll(() => field.inputValue()).toBe('Toasts rename');
  await expect.poll(async () => ((await (await page.request.get(`/api/projects/${id}`)).json()) as { name: string }).name).toBe('Toasts rename');
  await expect(toast).toHaveCount(0);
});

test('under reduced motion a toast appears with no entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts still');
  const duration = (toast: Locator): Promise<string> => toast.evaluate((el) => getComputedStyle(el).animationDuration);
  await rename(page, 'Toasts still renamed');
  const still = toastOf(page, 'Renamed to “Toasts still renamed”');
  await expect(still).toBeVisible();
  await expect.poll(() => duration(still)).toBe('0.001s');
  // without the preference it pops in over its 260 ms, so the check above is not vacuous (a newer rename's toast replaces the older)
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await rename(page, 'Toasts moving');
  const moving = toastOf(page, 'Renamed to “Toasts moving”');
  await expect(moving).toBeVisible();
  await expect(still).toHaveCount(0);
  await expect.poll(() => duration(moving)).toBe('0.26s');
});

test('while the drawer is open the toasts are out of reach', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts drawer', LV_CIRCUITS);
  const region = page.locator('section.toasts');
  const field = page.getByRole('textbox', { name: 'Project name' });
  await rename(page, 'Toasts drawer renamed');
  await expect(toastOf(page, 'Renamed to “Toasts drawer renamed”').getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  await expect(region).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(region).not.toHaveAttribute('inert');
  // and once it has closed a toast is in the window and takes a click again, on a narrow window too (a fresh one: the first's 5 s may be up)
  await rename(page, 'Toasts drawer again');
  const again = toastOf(page, 'Renamed to “Toasts drawer again”');
  await expect(again).toBeInViewport();
  await again.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => field.inputValue()).toBe('Toasts drawer renamed');
});

test('the toasts are out of reach from the moment the drawer opens by itself', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts, nothing yet');                                   // no target: the drawer opens by itself
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  const region = page.locator('section.toasts');
  await expect(region).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(region).not.toHaveAttribute('inert');
});

// A toast's time stops while a pointer moves over it or the focus is in it, and runs on when they leave (spec §12.1); a pointer at rest that a
// toast comes under does not hold it (P2-D28: Chromium sends that pointer an over and an enter, never a move), so it goes in its time. Ledger
// ruling P2-R25: the one fixed wait proves that neither held toast goes across its 5 s, and the polls after it that each goes once let go.
test('a toast holds while a pointer moves over it or the focus is in it, and not under a pointer at rest', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts held');
  await rename(page, 'Toasts held, renamed');
  const focused = toastOf(page, 'Renamed to “Toasts held, renamed”');
  await expect(focused).toBeVisible();
  await page.getByRole('tab', { name: 'Notes' }).click();
  await page.getByLabel('Add a note').fill('Toasts hold');
  await page.getByRole('button', { name: 'Add note' }).click();
  const pointed = toastOf(page, 'Note added');
  await expect(pointed).toBeVisible();
  await focused.getByRole('button', { name: 'Dismiss' }).focus();
  await pointed.locator('span').hover();
  await page.waitForTimeout(6000);                                                     // past the 5 s either had
  await expect(focused).toHaveAttribute('data-state', 'open');
  await expect(pointed).toHaveAttribute('data-state', 'open');
  await page.mouse.move(5, 5);
  await page.getByLabel('Add a note').focus();
  await expect(focused).toHaveCount(0, { timeout: 8000 });
  await expect(pointed).toHaveCount(0, { timeout: 8000 });
  // the corner where the next toast comes, under a pointer that then rests
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width - 16 - 100, height - 16 - 22);
  await rename(page, 'Toasts held, again');
  const resting = toastOf(page, 'Renamed to “Toasts held, again”');
  await expect(resting).toBeVisible();
  expect(await resting.evaluate((el) => el.matches(':hover')), 'the toast came under the pointer').toBe(true);
  await expect(resting).toHaveCount(0, { timeout: 8000 });
});

// Forced colours (spec §3.5, §20; ledger ruling P2-R41: read from painted pixels). A contrast theme keeps a toast's edge, a border, in its text
// colour, and its chat face's 82 % (Chromium keeps a background's alpha), so what a toast floats over would show through its words: the face is
// the theme's canvas, whole. A block of the theme's text colour is laid under the toast here, so a see-through face would show it.
test('in forced colours a toast is a whole box of the theme\'s canvas, framed in its text colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts forced');
  await rename(page, 'Toasts forced renamed');
  const toast = toastOf(page, 'Renamed to “Toasts forced renamed”');
  await expect(toast).toBeVisible();
  await toast.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));   // measured at its size, not on its way in at 96 %
  const box = (await toast.boundingBox())!;
  const theme = await page.evaluate(({ x, y, width, height }) => {
    // the block: under the toast and 8 px out to its left, all of it an edge (two halves of its height), which the theme keeps
    const under = document.createElement('div');
    Object.assign(under.style, {
      position: 'fixed', left: `${x - 8}px`, top: `${y}px`, width: `${width + 8}px`, height: `${height}px`, boxSizing: 'border-box',
      border: `${Math.ceil(height / 2)}px solid black`, zIndex: '39',
    });
    document.body.append(under);
    const probe = document.createElement('div');
    document.body.append(probe);
    const colourOf = (value: string): string => { probe.style.color = value; return getComputedStyle(probe).color; };
    const colours = { text: colourOf('CanvasText'), canvas: colourOf('Canvas') };
    probe.remove();
    return colours;
  }, box);
  expect(theme.text).not.toBe(theme.canvas);
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const [edge, face, under] = await page.evaluate(async ([png, at]) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const g = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    g.drawImage(image, 0, 0);
    return at.map(([x, y]) => { const [r, gr, b] = g.getImageData(x!, y!, 1, 1).data; return `rgb(${r}, ${gr}, ${b})`; });
  }, [shot.toString('base64'), [
    [Math.round(box.x + 1), Math.round(box.y + box.height / 2)],                      // the toast's edge
    [Math.round(box.x + 6), Math.round(box.y + 4)],                                   // its face, in the padding above and before its words
    [Math.round(box.x - 4), Math.round(box.y + 4)],                                   // and the block under it, just outside it
  ]] as const);
  expect(under, 'the block laid under the toast shows beside it').toBe(theme.text);
  expect(edge, 'the edge is the theme\'s text colour').toBe(theme.text);
  expect(face, 'the face is the theme\'s canvas, whole: nothing under it shows through').toBe(theme.canvas);
});

// The other actions of spec §12.1's table that a browser test reaches cheaply: a project made on the list says so on the page it opens (the
// region outlives the list), and a note added says so; neither can be undone, so Dismiss is the toast's one button, and it takes it away.
test('making a project and adding a note say so, with nothing to undo', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await page.goto('/');
  await page.getByLabel('New project').fill('Toasts made');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/p\//);
  const created = toastOf(page, 'Created “Toasts made”');
  await expect(created).toBeVisible();
  await expect(created.getByRole('button')).toHaveText(['×']);
  await expect(created.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  await page.getByRole('tab', { name: 'Notes' }).click();
  await page.getByLabel('Add a note').fill('Toasts note');
  await page.getByRole('button', { name: 'Add note' }).click();
  const added = toastOf(page, 'Note added');
  await expect(added).toBeVisible();
  await added.getByRole('button', { name: 'Dismiss' }).click();
  await expect(added).toHaveCount(0);
});
