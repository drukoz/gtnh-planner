// Toasts (Phase 2 spec §12, D14; Task 9a): what was just done, said in a polite region the App draws in the window's corner after the page, so
// a toast lives on across the page's own navigation ("Created “X”" is shown on the list and read on the project), with Undo where the action
// can be taken back: here, a rename. Under reduced motion a toast appears with no entrance. While the settings drawer is open the region is
// inert, out of the keyboard's and the pointer's reach (the drawer is a layer of its own, ruling R36), whether the Settings button opened it
// or it opened by itself (the Make-picker fix: below 900 px a project with no target opens it); so the narrow cases that rename give their
// project a target, without which the drawer opens by itself and the head, the name with it, is inert. A toast drawn before the drawer opens
// stays drawn and paused behind it, so it is heard once ("Created", on a narrow window: ledger ruling P2-R56a); a command copied inside the
// drawer says so in place, and makes no toast (P2-R56). Undo or Dismiss from the keyboard moves the focus on before the toast goes (P2-R57),
// and a rename's toast goes with its page (P2-R54). Task 9b adds the deleted project, whose Undo restores it on the list it leaves for, and
// the deleted note, whose delete waits out its toast in the page's store and is posted then, or at once as the page goes (Phase 2 spec
// §12.2); and the page posts its changes one at a time, so an Undo never lands before what it undoes (ledger ruling P2-R59). Since Task 10 a
// note's delete asks nothing first, its toast's Undo being the way back: each note test counts the browser dialogs it meets, none.

import { test, expect, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { circuitLv } from './fixtures/plans.ts';
import { addNote, createProject, login, LV_CIRCUITS, noDialogs, openWithPlan, setName, SETTINGS_BUTTON } from './helpers.ts';

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
 * bodies reach it. The page posts them one at a time since Task 9b (ledger ruling P2-R59, pinned below by 'an Undo pressed while its rename
 * is still on its way…'); the tests that undo a rename for something else still let the rename land first, so each checks one thing.
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

// P2-R56a: a toast drawn before the drawer opens stays drawn behind it, paused, and is visible with the time it had left once the drawer
// closes: added to the polite list once, so heard once. "Created" is made on the list, moments before the drawer of a project with no target
// opens by itself on a narrow window. An observer the page starts with counts the toasts added to the list that say "Created".
test('a project made on a narrow window says so once, its toast waiting drawn and paused behind the drawer that opens by itself', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { createdAdded: number };
    w.createdAdded = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLLIElement && node.closest('section.toasts') !== null && (node.textContent ?? '').includes('Created')) w.createdAdded += 1;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await page.goto('/');
  await page.getByLabel('New project').fill('Toasts made narrow');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(settingsOf(page)).toBeVisible();                                            // no target: the drawer opened by itself
  const region = page.locator('section.toasts');
  await expect(region).toHaveAttribute('inert', '');
  const drawnBehind = await region.locator('li').count();
  await page.keyboard.press('Escape');
  await expect(toastOf(page, 'Created “Toasts made narrow”')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { createdAdded: number }).createdAdded), 'added to the polite list once').toBe(1);
  expect(drawnBehind, 'drawn behind the drawer all the while').toBe(1);
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

// ledger ruling P2-R69: Dismiss from the keyboard hands the focus to the next toast's Dismiss (P2-R57), and Chromium presses a focused button
// again on each auto-repeat of a held Enter, so a held Enter would dismiss toast after toast (a deleted note's dismissed toast posts its delete,
// and its Undo is gone). A repeated Enter is ignored there: one held press dismisses one toast. The second keydown is the key's auto-repeat
// (Playwright sends it with `repeat` set).
test('a held Enter dismisses one toast, not the next one its Dismiss hands the focus to', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts held');
  await addNote(page, id, { id: 'n1', text: 'first' }, 'Bob');
  await addNote(page, id, { id: 'n2', text: 'second' }, 'Bob');
  await page.goto(`/p/${id}#notes`);
  await expect(page.locator('.note-text')).toHaveText(['first', 'second']);
  await page.locator('.note').first().getByRole('button', { name: 'Delete' }).click();
  await page.locator('.note').first().getByRole('button', { name: 'Delete' }).click();
  const deleted = toastOf(page, 'Note deleted');
  const open = page.locator('section.toasts li[data-state="open"]', { hasText: 'Note deleted' });   // not leaving
  await expect(open).toHaveCount(2);
  // the focus comes into the region from nowhere, as in P2-R57's Dismiss test above, so Dismiss hands it to the next toast's Dismiss (from a
  // control still drawn it would go back there)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await open.first().getByRole('button', { name: 'Dismiss' }).focus();
  await page.keyboard.down('Enter');
  await expect(open).toHaveCount(1);
  const next = open.getByRole('button', { name: 'Dismiss' });
  await expect(next).toBeFocused();
  await page.keyboard.down('Enter');                                                      // the held key repeats, on the next toast's Dismiss
  await page.keyboard.up('Enter');
  await expect(deleted).toHaveCount(1);                                                   // the one dismissed has left: the other stays
  await expect(open).toHaveCount(1);
  await expect(next).toBeFocused();
  expect(dialogs).toEqual([]);
});

// ledger ruling P2-R69a: a held key acts once, wherever the focus goes. A note toast's Undo from the keyboard hands the focus to the next toast's
// Undo (P2-R57), here a rename's; the held Enter's auto-repeats are not that Undo's, as the press began on the note's, so the rename stays
test('a held Enter on a note\'s Undo brings the note back and leaves the rename beside it as it is', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts held undo');
  await addNote(page, id, { id: 'n1', text: 'first' }, 'Bob');
  await page.goto(`/p/${id}#notes`);
  await expect(page.locator('.note-text')).toHaveText(['first']);
  await rename(page, 'Toasts held undo, renamed');
  const renamed = toastOf(page, 'Renamed to “Toasts held undo, renamed”');
  await expect(renamed).toBeVisible();
  await landed(page, id, 'Toasts held undo, renamed');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  const deleted = toastOf(page, 'Note deleted');
  await expect(deleted).toBeVisible();
  // the focus comes into the region from nowhere, so the note's Undo hands it to the next toast's Undo, the rename's (P2-R57)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await deleted.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first']);
  const renameUndo = renamed.getByRole('button', { name: 'Undo' });
  await expect(renameUndo).toBeFocused();
  await page.keyboard.down('Enter');                                                      // the held key repeats, on the rename's Undo
  await page.keyboard.up('Enter');
  await expect(renameUndo).toBeFocused();
  await expect(renamed).toHaveAttribute('data-state', 'open');
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Toasts held undo, renamed');
  await landed(page, id, 'Toasts held undo, renamed');
  expect(dialogs).toEqual([]);
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
  await expect(toast).toHaveCount(0, { timeout: 2000 });                                   // well inside the 5 s it would have lived
});

// fix round 2, M5: the focus goes back to an SVG element too, here a Flow box's head (a <g> that takes the focus)
test('Undo from the keyboard gives the focus back to the Flow box it came from', async ({ page }) => {
  const id = await openWithPlan(page, circuitLv());
  await rename(page, 'Toasts flow');
  const toast = toastOf(page, 'Renamed to “Toasts flow”');
  await expect(toast).toBeVisible();
  await landed(page, id, 'Toasts flow');
  const head = page.locator('[data-step-id="wire"] .flow-node-head');
  await head.focus();
  await toast.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(head).toBeFocused();
});

// fix round 2, M6: only the keyboard's Undo or Dismiss moves the focus. A pointer's click focuses the button it presses (Chromium), and moving
// that focus on would put it in the toast beside, which then holds it and stops its time
test('a pointer\'s Dismiss leaves the focus alone, and the toast beside keeps its time', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Toasts clicked');
  await rename(page, 'Toasts clicked, renamed');
  await page.getByRole('tab', { name: 'Notes' }).click();
  await page.getByLabel('Add a note').fill('Toasts clicked');
  await page.getByRole('button', { name: 'Add note' }).click();
  const older = toastOf(page, 'Renamed to “Toasts clicked, renamed”');
  const newer = toastOf(page, 'Note added');
  await expect(newer).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());       // nowhere for the focus to go back to
  await newer.getByRole('button', { name: 'Dismiss' }).click();
  await expect(newer).toHaveCount(0);
  await expect(older.getByRole('button', { name: 'Dismiss' })).not.toBeFocused();
  await page.mouse.move(5, 5);
  await expect(older).toHaveCount(0, { timeout: 8000 });                                   // nothing holds it: it goes in its time
});

// ---- Task 9b: Undo for a deleted project or note (Phase 2 spec §12.1, §12.2), and one post at a time (ledger ruling P2-R59) ----

/** Deletes the open project from its page, as a person does: its name typed into the confirmation. */
async function deleteProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Delete project' }).click();
  const form = page.getByRole('form', { name: 'Confirm delete' });
  await form.getByLabel('Type the project name to confirm').fill(name);
  await form.getByRole('button', { name: 'Delete', exact: true }).click();
}

/** Project `name`'s row under "Recently deleted" on the list (delete.spec.ts's `deletedRow`). */
const deletedRow = (page: Page, name: string): Locator =>
  page.getByRole('region', { name: 'Recently deleted' }).getByRole('listitem').filter({ hasText: name });

/** A name for this run's project: the e2e server is shared by every run, and the list finds a project by its name. */
const runName = (name: string): string => `${name} ${test.info().repeatEachIndex + 1}`;

test('deleting a project from its page offers Undo, which brings it back', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const name = runName('Toasts deleted');
  await createProject(page, name);
  await deleteProject(page, name);
  await expect(page).toHaveURL(/\/$/);
  const toast = toastOf(page, `Deleted “${name}”`);
  await expect(toast).toBeVisible();                                                      // on the list the page left for
  await expect(page.getByText(`${name} was deleted by Ann`)).toHaveCount(1);
  await expect(deletedRow(page, name)).toContainText('Deleted by Ann');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(deletedRow(page, name)).toHaveCount(0);
  await expect(page.getByText(`${name} was deleted by Ann`)).toHaveCount(0);              // the notice no longer holds
  await expect(toast).toHaveCount(0);
});

// Spec §12.1: the toast's key is the project's, so the list's own Restore takes it away (its Undo would restore it again)
test('a project deleted from its row offers Undo too, and the list\'s own Restore takes that toast away', async ({ page }) => {
  await login(page); await setName(page, 'Cy');
  const name = runName('Toasts row deleted');
  await createProject(page, name);
  await page.goto('/');
  const row = page.locator('.project-card').filter({ has: page.getByRole('link', { name, exact: true }) });
  await row.getByRole('button', { name: 'Delete' }).click();
  const form = row.getByRole('form', { name: 'Confirm delete' });
  await form.getByLabel('Type the project name to confirm').fill(name);
  await form.getByRole('button', { name: 'Delete', exact: true }).click();
  const toast = toastOf(page, `Deleted “${name}”`);
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByText(`${name} was deleted by Cy`)).toHaveCount(1);
  await deletedRow(page, name).getByRole('button', { name: 'Restore' }).click();
  await expect(toast).toHaveCount(0, { timeout: 2000 });                                  // well inside the 5 s it would have lived
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(deletedRow(page, name)).toHaveCount(0);
});

/** Project `id`'s notes on the server. */
async function notesOf(page: Page, id: string): Promise<Array<{ id: string; text: string; by: string; at: string }>> {
  return ((await (await page.request.get(`/api/projects/${id}`)).json()) as { notes: Array<{ id: string; text: string; by: string; at: string }> }).notes;
}

/** A page of its own browser, logged in as `name`. */
async function browserOf(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page); await setName(page, name);
  return page;
}

/**
 * A project of its own with one note, Bob's, open at its Notes tab on a page logged in as Ann; resolves with its id and the browser dialogs the
 * page meets from then on, each dismissed: a note's delete asks nothing since Task 10 (its toast's Undo takes it back), so there are none.
 */
async function oneNote(page: Page, name: string, text: string): Promise<{ id: string; dialogs: string[] }> {
  const dialogs = noDialogs(page);
  const id = await createProject(page, name);
  await addNote(page, id, { id: 'n1', text }, 'Bob');
  await page.goto(`/p/${id}#notes`);
  await expect(page.locator('.note-text')).toHaveText(text);
  return { id, dialogs };
}

test('deleting a note offers Undo, which keeps its author, time and place', async ({ page }) => {
  const dialogs = noDialogs(page);                                                        // the delete asks nothing (Task 10)
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts note undone');
  await addNote(page, id, { id: 'first', text: 'Bob\'s note, first' }, 'Bob');
  await addNote(page, id, { id: 'second', text: 'Ann\'s note, second' }, 'Ann');
  await page.goto(`/p/${id}#notes`);
  const first = page.locator('.note').first();
  await expect(first.locator('.note-text')).toHaveText('Bob\'s note, first');
  const at = await first.locator('time').getAttribute('datetime');
  await first.getByRole('button', { name: 'Delete' }).click();
  const toast = toastOf(page, 'Note deleted');
  await expect(toast).toBeVisible();
  await expect(page.locator('.note-text')).toHaveText(['Ann\'s note, second']);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.note-text')).toHaveText(['Bob\'s note, first', 'Ann\'s note, second']);
  await page.reload();
  const back = page.locator('.note').first();
  await expect(back.locator('.note-text')).toHaveText('Bob\'s note, first');
  await expect(back.locator('.note-by')).toHaveText('Bob');
  await expect(back.locator('time')).toHaveAttribute('datetime', at!);
  expect((await notesOf(page, id)).map((n) => n.id)).toEqual(['first', 'second']);
  expect(dialogs).toEqual([]);
});

test('a note deleted without Undo reaches another browser within 7 s', async ({ browser }) => {
  const pa = await browserOf(browser, 'Ann');
  const pb = await browserOf(browser, 'Bob');
  const { id, dialogs } = await oneNote(pa, 'Toasts note gone', 'gone in 5 s');
  await pb.goto(`/p/${id}#notes`);
  await expect(pb.locator('.note-text')).toHaveText('gone in 5 s');
  await expect(pb.locator('.connection.live')).toBeVisible();                             // B's event stream is open
  await pa.locator('.note').getByRole('button', { name: 'Delete' }).click();
  await expect(toastOf(pa, 'Note deleted')).toBeVisible();
  await expect(pa.locator('.note')).toHaveCount(0);
  await expect(pb.locator('.note')).toHaveCount(0, { timeout: 7000 });
  await expect(toastOf(pa, 'Note deleted')).toHaveCount(0);                               // posted as its toast went, so its Undo has gone
  expect(dialogs).toEqual([]);
  await pa.context().close(); await pb.context().close();
});

/**
 * Has the page note down, for each op post it makes, whether it asks the browser to keep the post alive past the page (`keepalive`), in the
 * tab's session storage, which a reload keeps; read with `keptAlive`. On this machine's server a plain post made as the page goes arrives
 * anyway, so only this shows that the post was made to outlive the page, as it must on a slower network.
 */
async function noteKeepalive(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const send = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/ops')) {
        const kept = JSON.parse(sessionStorage.getItem('test-ops-keepalive') ?? '[]') as boolean[];
        sessionStorage.setItem('test-ops-keepalive', JSON.stringify([...kept, init.keepalive === true]));
      }
      return send(input, init);
    };
  });
}
const keptAlive = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('test-ops-keepalive') ?? '[]') as boolean[]);

// Review Focus 3: a note deleted moments before its page goes must still reach the server, or it comes back. A reload hides the page for
// good (pagehide): the delete is posted then, with keepalive, so it outlives the page that sends it
test('a note deleted just before a reload stays deleted', async ({ page }) => {
  await noteKeepalive(page);
  await login(page); await setName(page, 'Ann');
  const { id, dialogs } = await oneNote(page, 'Toasts note reloaded', 'deleted, then reloaded');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  await expect(toastOf(page, 'Note deleted')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Add a note')).toBeVisible();                              // the notes are drawn again
  await expect(page.locator('.note-text')).toHaveCount(0);
  await expect.poll(() => notesOf(page, id)).toEqual([]);
  expect(await keptAlive(page), 'the delete was the one post, made to outlive its page').toEqual([true]);
  expect(dialogs).toEqual([]);
});

// Review Focus 3, going back to the list: the page's store closes, and posts the delete as it does (spec §12.2). The note's Undo would act
// through that store, so its toast goes with its page, as a rename's does (ledger ruling P2-R54)
test('a note deleted just before going back to the list stays deleted, and its toast goes with its page', async ({ page }) => {
  await noteKeepalive(page);
  await login(page); await setName(page, 'Ann');
  const { id, dialogs } = await oneNote(page, 'Toasts note left', 'deleted, then left');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  const toast = toastOf(page, 'Note deleted');
  await expect(toast).toBeVisible();
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('form.new-project')).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 2000 });                                  // well inside the 5 s it would have lived
  await expect.poll(() => notesOf(page, id), { timeout: 2000 }).toEqual([]);
  expect(await keptAlive(page), 'the delete was the one post, made to outlive its page').toEqual([true]);
  expect(dialogs).toEqual([]);
});

// Review Focus 3, closing the tab: the page is hidden for good, as for a reload
test('a note deleted just before its tab closes stays deleted', async ({ browser }) => {
  const page = await browserOf(browser, 'Ann');
  const { id, dialogs } = await oneNote(page, 'Toasts note closed', 'deleted, then closed');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  await expect(toastOf(page, 'Note deleted')).toBeVisible();
  const asking = page.context().request;
  await page.close();
  await expect.poll(async () => ((await (await asking.get(`/api/projects/${id}`)).json()) as { notes: unknown[] }).notes).toEqual([]);
  expect(dialogs).toEqual([]);
  await page.context().close();
});

// Ledger ruling P2-R59: a project's op batches are posted one at a time, in order, the next once the one before has been answered, so the
// server, which applies them in the order they reach it, never applies a rename after its own Undo. Every op post of the page is held here
// until the test lets it go, and the page counts the posts it makes. The rename is held on its way, Undo is pressed, and the posts the page
// has made are let go newest first, each landing before the next goes: the order in which the old client's Undo, posted at once, landed
// first and was then undone by its rename.
test('an Undo pressed while its rename is still on its way lands after it, so the name it gave back stays', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { opsPosted: number };
    w.opsPosted = 0;
    const send = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/ops')) w.opsPosted += 1;
      return send(input, init);
    };
  });
  const posted = (): Promise<number> => page.evaluate(() => (window as unknown as { opsPosted: number }).opsPosted);
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Toasts in turn');
  const field = page.getByRole('textbox', { name: 'Project name' });
  const held: Route[] = [];
  let holding = true;
  await page.route(`**/api/projects/${id}/ops`, (route) => {
    if (holding) held.push(route);
    else void route.continue();
  });
  await rename(page, 'Toasts in turn, renamed');
  await expect.poll(() => held.length, { message: 'the rename is held on its way' }).toBe(1);
  await toastOf(page, 'Renamed to “Toasts in turn, renamed”').getByRole('button', { name: 'Undo' }).click();
  await expect(field).toHaveValue('Toasts in turn');
  const sent = await posted();
  await expect.poll(() => held.length, { message: 'every post the page made has reached the route' }).toBe(sent);
  holding = false;
  for (const route of [...held].reverse()) await route.fulfill({ response: await route.fetch() });   // the newest first, each landed
  await expect.poll(posted, { message: 'the Undo is posted once the rename has landed' }).toBe(2);
  await landed(page, id, 'Toasts in turn');
  await expect(field).toHaveValue('Toasts in turn');
  expect(sent, 'the Undo waited for the rename\'s answer').toBe(1);
});

// ---- Task 9b fix round 1: a hidden or frozen page (ledger ruling P2-R63), and a note deleted just before its project (M1) ----

// P2-R63: a toast whose going commits a change runs on while the page is hidden (a minimised window, or one the full-screen game this planner
// is for covers), so a deleted note still goes about 5 s after it was deleted, as others expect; an ordinary toast waits for the page. The
// page is hidden here as the region hears it: `document.hidden` and a visibilitychange.
test('a note deleted just before the page is hidden still goes about 5 s later, while it is hidden', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const { id, dialogs } = await oneNote(page, 'Toasts note hidden', 'deleted, then hidden');
  await rename(page, 'Toasts note hidden, renamed');
  const renamed = toastOf(page, 'Renamed to “Toasts note hidden, renamed”');
  await expect(renamed).toBeVisible();
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  const deleted = toastOf(page, 'Note deleted');
  await expect(deleted).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => notesOf(page, id), { timeout: 8000, message: 'the delete reaches the server while the page is hidden' }).toEqual([]);
  await expect(deleted).toHaveCount(0);
  await expect(renamed).toHaveAttribute('data-state', 'open');                            // an ordinary toast waits for the page
  expect(await page.evaluate(() => document.hidden), 'the page is still hidden').toBe(true);
  expect(dialogs).toEqual([]);
});

// P2-R63: Chrome freezes a hidden page it may discard later, and a frozen page runs no timer, so the deferred delete is posted as the page
// freezes, with keepalive, as on pagehide. Headless, this Chromium dispatches nothing for DevTools' frozen lifecycle state (the fix report's
// probe), so the page is sent its `freeze` event as Chrome sends it; the check ends well inside the toast's own 5 s.
test('a note deleted just before the page is frozen is posted as it freezes, with keepalive', async ({ page }) => {
  await noteKeepalive(page);
  await login(page); await setName(page, 'Ann');
  const { id, dialogs } = await oneNote(page, 'Toasts note frozen', 'deleted, then frozen');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  const toast = toastOf(page, 'Note deleted');
  await expect(toast).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
  await expect.poll(() => notesOf(page, id), { timeout: 3000, message: 'posted as the page froze' }).toEqual([]);
  expect(await keptAlive(page), 'the delete was the one post, made to outlive its page').toEqual([true]);
  await expect(toast).toHaveCount(0);                                                     // posted, so its Undo has gone
  expect(dialogs).toEqual([]);
});

// M1: a note deleted just before its project is posted before the project's own delete, which would otherwise find the project gone (404)
// and drop it, so the project restored by its toast's Undo comes back without the note
test('a note deleted just before its project stays deleted when the project is restored', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const name = runName('Toasts note, then project');
  const { id, dialogs } = await oneNote(page, name, 'deleted, then its project');
  await page.locator('.note').getByRole('button', { name: 'Delete' }).click();
  await expect(toastOf(page, 'Note deleted')).toBeVisible();
  await deleteProject(page, name);                                                        // well inside the note's 5 s
  await expect(page).toHaveURL(/\/$/);
  await toastOf(page, `Deleted “${name}”`).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  expect(await notesOf(page, id)).toEqual([]);
  expect(dialogs).toEqual([]);
});
