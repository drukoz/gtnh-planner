// The Notes tab's focus (ledger ruling P2-R68, Task F3): a button the user presses that goes, or is disabled, hands the focus on, so the
// keyboard never falls to the page's body. Delete hands it on before its note goes (ledger ruling P2-R57's pattern): to the next note's
// Delete, else the previous note's, else the "Add a note" field. Add note, whose button the cleared field disables, hands it to that field.
// Save and Cancel, whose form goes, give it back to the note's Edit. Each test counts the focus left on the body two frames on (helpers.ts),
// which must be none, and the browser dialogs it meets, none: a note's Delete asks nothing (Task 10), its toast's Undo takes it back. A held
// Enter deletes one note (ledger ruling P2-R69), and the toast's Undo brings the note back, with the focus on its Delete if the Undo left it
// on the page's main or to be lost (P2-R74), else where it is.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { addNote, bodyFocusCount, createProject, login, noDialogs, setName, watchBodyFocus } from './helpers.ts';

/** A project of its own with `texts` as notes, in that order, open at its Notes tab with every note drawn; resolves with its id. */
async function withNotes(page: Page, name: string, texts: string[]): Promise<string> {
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, name);
  for (const [i, text] of texts.entries()) await addNote(page, id, { id: `n${i + 1}`, text }, 'Bob');
  await page.goto(`/p/${id}#notes`);
  await expect(page.locator('.note-text')).toHaveText(texts);
  return id;
}

/** The note that says `text`. */
const noteOf = (page: Page, text: string): Locator => page.locator('.note').filter({ has: page.locator('.note-text', { hasText: text }) });

test('a note\'s Delete hands the focus to the next note\'s Delete, else the previous note\'s, else the field to add one', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes focus', ['first', 'second', 'third']);
  await watchBodyFocus(page);
  // the pointer's Delete, in the middle: the next note's Delete
  await noteOf(page, 'second').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.note-text')).toHaveText(['first', 'third']);
  await expect(noteOf(page, 'third').getByRole('button', { name: 'Delete' })).toBeFocused();
  // the keyboard's Delete, on the last note: the previous note's Delete
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first']);
  await expect(noteOf(page, 'first').getByRole('button', { name: 'Delete' })).toBeFocused();
  // the last note left: the field to add one
  await page.keyboard.press('Enter');
  await expect(page.locator('.note')).toHaveCount(0);
  await expect(page.getByLabel('Add a note')).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

test('a Delete skips a note being edited, which has no Delete, for the next one that has', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes focus, editing', ['first', 'second', 'third']);
  await noteOf(page, 'second').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Note text')).toBeFocused();
  await watchBodyFocus(page);
  await noteOf(page, 'first').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.note')).toHaveCount(2);
  await expect(noteOf(page, 'third').getByRole('button', { name: 'Delete' })).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

test('Add note, which the cleared field disables, hands the focus to that field, from the pointer and from the keyboard', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes focus, adding', ['first']);
  await watchBodyFocus(page);
  const field = page.getByLabel('Add a note');
  const add = page.getByRole('button', { name: 'Add note' });
  await field.fill('by the pointer');
  await add.click();
  await expect(page.locator('.note-text')).toHaveText(['first', 'by the pointer']);
  await expect(add).toBeDisabled();
  await expect(field).toBeFocused();
  await field.fill('by the keyboard');
  await expect(add).toBeEnabled();                                                        // a disabled button takes no focus
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first', 'by the pointer', 'by the keyboard']);
  await expect(field).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

test('Save and Cancel, whose form goes, give the focus back to the note\'s Edit', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes focus, editing one', ['first', 'second']);
  await watchBodyFocus(page);
  const second = noteOf(page, 'second');
  await second.getByRole('button', { name: 'Edit' }).click();
  const text = page.getByLabel('Note text');
  await expect(text).toBeFocused();
  await text.fill('second, edited');
  await page.locator('form.note-edit').getByRole('button', { name: 'Save', exact: true }).click();
  const edited = noteOf(page, 'second, edited');
  await expect(edited.getByRole('button', { name: 'Edit' })).toBeFocused();
  // the keyboard's Cancel
  await page.keyboard.press('Enter');
  await expect(text).toBeFocused();
  await page.keyboard.press('Tab');                                                       // Save
  await page.keyboard.press('Tab');                                                       // Cancel
  await expect(page.locator('form.note-edit').getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(text).toHaveCount(0);
  await expect(edited.getByRole('button', { name: 'Edit' })).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

// ledger ruling P2-R69: Chromium presses a focused button again on each auto-repeat of a held Enter, and Delete hands the focus to the next
// note's Delete, so a held Enter would delete note after note. A repeated Enter is ignored there: one held press deletes one note. The
// second keydown is the key's auto-repeat (Playwright sends it with `repeat` set, as the keyboard does).
test('a held Enter deletes one note, not the next one its Delete hands the focus to', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes held', ['first', 'second']);
  await watchBodyFocus(page);
  await noteOf(page, 'first').getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('.note-text')).toHaveText(['second']);
  const next = noteOf(page, 'second').getByRole('button', { name: 'Delete' });
  await expect(next).toBeFocused();
  await page.keyboard.down('Enter');                                                      // the held key repeats, on the next note's Delete
  await page.keyboard.up('Enter');
  await expect(page.locator('.note-text')).toHaveText(['second']);
  await expect(next).toBeFocused();
  await expect(page.locator('.toast', { hasText: 'Note deleted' })).toHaveCount(1);
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

// fix round 1, M8: a note deleted from the keyboard comes back with its toast's Undo, reached by the keyboard. From the next note's Delete,
// Tab goes to the field to add a note and then to the toasts, after the page. The focus came into them from that field, which takes typing,
// so the Undo does not give it back there (ledger ruling P2-R57), and with no other toast showing it would go to the page's main: the note
// it restored takes it instead, its Delete, once its row is back (ledger ruling P2-R74; fix round 2 changed this test's last focus check)
test('a note deleted from the keyboard comes back with its toast\'s Undo, reached by the keyboard, the focus on its Delete', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes undone', ['first', 'second']);
  await watchBodyFocus(page);
  await noteOf(page, 'first').getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['second']);
  await expect(noteOf(page, 'second').getByRole('button', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Add a note')).toBeFocused();
  await page.keyboard.press('Tab');
  const toast = page.getByRole('region', { name: 'Notifications' }).getByRole('listitem').filter({ hasText: 'Note deleted' });
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first', 'second']);
  await expect(toast).toHaveCount(0);
  await expect(noteOf(page, 'first').getByRole('button', { name: 'Delete' })).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

// ledger ruling P2-R74: the pointer's Undo moves no focus (Chromium leaves it on the button it pressed, to be lost as its toast goes); the note it
// restored takes it, its Delete, once its row is back
test('a note\'s Undo by the pointer gives the focus to the note it restored', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes undone by the pointer', ['first', 'second']);
  await watchBodyFocus(page);
  await noteOf(page, 'first').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.note-text')).toHaveText(['second']);
  const toast = page.locator('section.toasts li[data-state="open"]', { hasText: 'Note deleted' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.note-text')).toHaveText(['first', 'second']);
  await expect(page.locator('section.toasts li', { hasText: 'Note deleted' })).toHaveCount(0);   // its toast has gone, with its button
  await expect(noteOf(page, 'first').getByRole('button', { name: 'Delete' })).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});

// P2-R74: a focus anywhere else stays where it is. Here the Notes tab: P2-R57 gives back there the focus that came into the toasts from it
// (the keyboard's Undo), and a press that moves no focus (a script's, or an assistive technology's, click on the Undo) leaves it there
test('a note\'s Undo leaves a focus that is elsewhere where it is', async ({ page }) => {
  const dialogs = noDialogs(page);
  await withNotes(page, 'Notes undone elsewhere', ['first', 'second']);
  await watchBodyFocus(page);
  const tab = page.getByRole('tab', { name: 'Notes' });
  const undo = page.locator('section.toasts li[data-state="open"]', { hasText: 'Note deleted' }).getByRole('button', { name: 'Undo' });
  await noteOf(page, 'first').getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['second']);
  await tab.focus();
  await undo.focus();                                                                     // into the toasts from the Notes tab
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first', 'second']);
  await expect(tab).toBeFocused();
  await noteOf(page, 'second').getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-text')).toHaveText(['first']);
  await tab.focus();
  await undo.evaluate((button) => (button as HTMLElement).click());                       // a press with no click count that moves no focus
  await expect(page.locator('.note-text')).toHaveText(['first', 'second']);
  await expect(tab).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page\'s body').toBe(0);
  expect(dialogs).toEqual([]);
});
