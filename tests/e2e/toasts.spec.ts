// Toasts (Phase 2 spec §12, D14; Task 9a): what was just done, said in a polite region the App draws in the window's corner after the page, so
// a toast lives on across the page's own navigation ("Created “X”" is shown on the list and read on the project), with Undo where the action
// can be taken back: here, a rename. Under reduced motion a toast appears with no entrance. While the settings drawer is open the region is
// inert, out of the keyboard's and the pointer's reach (the drawer is a layer of its own, ruling R36), whether the Settings button opened it
// or it opened by itself (the Make-picker fix: below 900 px a project with no target opens it); so the narrow cases that rename give their
// project a target, without which the drawer opens by itself and the head, the name with it, is inert. A toast that comes while the drawer is
// open waits behind it, unseen and unheard, and shows when it closes; the drawer that opens by itself takes back the toasts its page came with
// ("Created"); a command copied inside the drawer says so in place, and makes no toast (ledger ruling P2-R56). Undo or Dismiss from the
// keyboard moves the focus on before the toast goes (P2-R57), and a rename's toast goes with its page (P2-R54). Task 9b adds the deleted
// project and note.

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

/**
 * Waits until project `id` is named `name` on the server. A rename and its Undo are two posts, which the server applies in the order their
 * bodies reach it: an Undo pressed the moment the rename is sent, as a test can and a person hardly does, may land first and be undone by
 * the rename itself (the task 9a report's concerns). So a test that undoes a rename lets the rename land first.
 */
async function landed(page: Page, id: string, name: string): Promise<void> {
  await expect.poll(async () => ((await (await page.request.get(`/api/projects/${id}`)).json()) as { name: string }).name).toBe(name);
}

test('renaming offers Undo', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts rename');
  const field = page.getByRole('textbox', { name: 'Project name' });
  await rename(page, 'Toasts renamed');
  const toast = toastOf(page, 'Renamed to “Toasts renamed”');
  await expect(toast).toBeVisible();
  await expect(field).toHaveValue('Toasts renamed');
  await landed(page, id, 'Toasts renamed');
  await toast.getByRole('button', { name: 'Undo' }).click();
  // the name is back, in the field and on the server, and the toast has gone
  await expect.poll(() => field.inputValue()).toBe('Toasts rename');
  await landed(page, id, 'Toasts rename');
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
  const id = await createProject(page, 'Toasts drawer', LV_CIRCUITS);
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
  await landed(page, id, 'Toasts drawer again');
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
  await expect.poll(() => resting.evaluate((el) => el.matches(':hover')), { message: 'the toast came under the pointer' }).toBe(true);
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

// ---- fix round 1: the drawer's layer (ledger ruling P2-R56), the focus (P2-R57) and a rename's page (P2-R54) ----

/** The project settings, the drawer below 900 px. */
const settingsOf = (page: Page): Locator => page.locator('aside[aria-label="Project settings"]');

// P2-R56 (a), through the one way a page reaches it: no toast can be made while the drawer is open (the head and the views are inert behind
// it, a copy inside it makes none, and the World page stops its upload when it is left), but "Created" is made moments before the drawer of a
// project with no target opens by itself on a narrow window. That drawer takes back the toasts its page came with: they wait behind it, not
// drawn (so not announced), and show, as additions the polite list announces, once it closes.
test('a project made on a narrow window says so once the drawer it opened by itself is closed', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await page.goto('/');
  await page.getByLabel('New project').fill('Toasts made narrow');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(settingsOf(page)).toBeVisible();                                            // no target: the drawer opened by itself
  await expect(page.locator('section.toasts')).toHaveAttribute('inert', '');
  await expect(page.locator('section.toasts li')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(toastOf(page, 'Created “Toasts made narrow”')).toBeVisible();
});

// P2-R56 (b): a command copied inside the open drawer makes no toast (it would only wait behind the drawer): the button's "Copied" is the
// feedback there, and the panel says it aloud on a polite line of its own. Beside the views, on a wide window, the copy makes its toast, and
// the panel's line says nothing, so it is heard once. The copy is the page's old copy (no clipboard API), as projector.spec.ts stubs it.
test('a command copied inside the open drawer says so in place, and makes no toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    document.execCommand = (command: string): boolean => command === 'copy';
  });
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts copied', LV_CIRCUITS);
  await page.getByRole('button', { name: SETTINGS_BUTTON }).click();
  const settings = settingsOf(page);
  await settings.getByText('In-game projector').click();
  await settings.getByLabel('Who is it for?').fill('Steve');
  await settings.getByRole('button', { name: 'Create token' }).click();
  const loadLine = settings.locator('.command-line', { has: page.locator('code', { hasText: `/planner load ${id} gpt_` }) });
  const said = settings.locator('[aria-live="polite"]');
  await loadLine.getByRole('button', { name: 'Copy' }).click();
  await expect(loadLine.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(said).toHaveText('Copied');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);                                                          // P2-R25: no toast comes once the drawer is shut
  await expect(page.locator('section.toasts li')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });                                // the column beside the views: no drawer
  await loadLine.getByRole('button', { name: 'Copy' }).click();                            // its "Copied" has turned back by now
  await expect(toastOf(page, 'Command copied')).toBeVisible();
  await expect(said).toHaveText('');
});

/** Counts, in the page, every time the focus leaves an element for nothing (the body); read with `lostFocus`. */
const watchFocus = (page: Page): Promise<void> => page.evaluate(() => {
  const w = window as unknown as { lost: number };
  w.lost = 0;
  document.addEventListener('focusout', (e) => { if (e.relatedTarget === null) w.lost += 1; }, true);
});
const lostFocus = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { lost: number }).lost);

// P2-R57: before a toast goes from under the focus, the focus goes back where it came from into the region, here the Notes tab
test('Undo from the keyboard gives the focus back where it came from, never to the page', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts focus');
  await rename(page, 'Toasts focus, renamed');
  const toast = toastOf(page, 'Renamed to “Toasts focus, renamed”');
  await expect(toast).toBeVisible();
  await landed(page, id, 'Toasts focus, renamed');
  const notes = page.getByRole('tab', { name: 'Notes' });
  await notes.focus();
  await watchFocus(page);
  await toast.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Toasts focus');
  await expect(notes).toBeFocused();
  expect(await lostFocus(page)).toBe(0);
});

// P2-R57: focus that came into the region from nowhere has nowhere to go back to: it goes to the next toast still showing (here the one
// before), to the same button, and with no toast left to the page's main
test('Dismiss from the keyboard moves the focus to the next toast still showing, and with none left to the page\'s main', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts dismissed');
  await rename(page, 'Toasts dismissed, renamed');
  await page.getByRole('tab', { name: 'Notes' }).click();
  await page.getByLabel('Add a note').fill('Toasts dismissed');
  await page.getByRole('button', { name: 'Add note' }).click();
  const older = toastOf(page, 'Renamed to “Toasts dismissed, renamed”');
  const newer = toastOf(page, 'Note added');
  await expect(newer).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await watchFocus(page);
  await newer.getByRole('button', { name: 'Dismiss' }).focus();
  await page.keyboard.press('Enter');
  await expect(newer).toHaveCount(0);
  await expect(older.getByRole('button', { name: 'Dismiss' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(older).toHaveCount(0);
  await expect(page.locator('main')).toBeFocused();
  expect(await lostFocus(page)).toBe(0);
});

// P2-R57: never back into the project's name in the tick of a rename's Undo. The field follows the name only while it is not being edited, so
// it would keep the name the Undo takes back and send it again on its blur.
test('a rename\'s Undo never gives the focus back to the project name, which keeps the name it gave back', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts named');
  const field = page.getByRole('textbox', { name: 'Project name' });
  await rename(page, 'Toasts named, renamed');
  const toast = toastOf(page, 'Renamed to “Toasts named, renamed”');
  await expect(toast).toBeVisible();
  await landed(page, id, 'Toasts named, renamed');
  await field.focus();
  await toast.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(field).not.toBeFocused();
  await expect(page.locator('main')).toBeFocused();
  await expect(field).toHaveValue('Toasts named');
  await landed(page, id, 'Toasts named');
});

// P2-R54: a rename's Undo works through its page's store, which closes with the page, so the toast goes with it
test('a rename\'s toast goes with its page', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts left');
  await rename(page, 'Toasts left, renamed');
  const toast = toastOf(page, 'Renamed to “Toasts left, renamed”');
  await expect(toast).toBeVisible();
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('form.new-project')).toBeVisible();
  await expect(toast).toHaveCount(0);
});
