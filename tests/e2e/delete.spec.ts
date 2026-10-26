import { test, expect, type Route } from '@playwright/test';
import { bodyFocusCount, login, setName, createProject, watchBodyFocus } from './helpers.ts';

test('a deleted project leaves every open tab within 2 s, and comes back with its notes when restored', async ({ browser }) => {
  const pa = await (await browser.newContext()).newPage(); const pb = await (await browser.newContext()).newPage();
  await login(pa); await setName(pa, 'Ann'); await login(pb); await setName(pb, 'Bob');
  const name = `MV circuits ${test.info().repeatEachIndex + 1}`;                     // one per run: the server is shared
  const id = await createProject(pa, name);
  await pa.goto(`/p/${id}#notes`);
  await pa.getByLabel('Add a note').fill('tap power here');
  await pa.getByRole('button', { name: 'Add note' }).click();
  await expect(pa.locator('.note-text')).toHaveText('tap power here');
  await pb.goto(`/p/${id}#notes`);
  await expect(pb.locator('.note-text')).toHaveText('tap power here');
  await expect(pb.locator('.connection.live')).toBeVisible();                          // B's event stream is open

  await pa.getByRole('button', { name: 'Delete project' }).click();
  const form = pa.getByRole('form', { name: 'Confirm delete' });                     // the notes have Delete buttons too
  const typed = form.getByLabel('Type the project name to confirm');
  const confirm = form.getByRole('button', { name: 'Delete', exact: true });
  await typed.fill(name.toLowerCase());
  await expect(confirm).toBeDisabled();
  await typed.fill(`${name} `);
  await expect(confirm).toBeDisabled();
  await typed.fill(name);
  const sentAt = Date.now();
  await confirm.click();
  await pb.waitForURL((url) => url.pathname === '/', { timeout: 2000 });
  expect(Date.now() - sentAt).toBeLessThan(2000);
  await expect(pb.getByText(`${name} was deleted by Ann`)).toBeVisible();

  await expect(pa).toHaveURL(/\/$/);
  await expect(pa.getByText(`${name} was deleted by Ann`)).toHaveCount(1);
  await expect(pa.getByRole('link', { name, exact: true })).toHaveCount(0);
  const row = pa.getByRole('region', { name: 'Recently deleted' }).getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText('Deleted by Ann');
  await row.getByRole('button', { name: 'Restore' }).click();

  const link = pa.getByRole('link', { name, exact: true });
  await expect(link).toBeVisible();
  await expect(row).toHaveCount(0);
  await link.click();
  await pa.getByRole('tab', { name: 'Notes' }).click();
  await expect(pa.locator('.note-text')).toHaveText('tap power here');
});

test('a project is deleted from its row on the list, and a row someone else deleted meanwhile catches up', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await login(page); await setName(page, 'Cy');
  const run = test.info().repeatEachIndex + 1;                                         // one per run: the server is shared
  const listed = `Row delete ${run}`;
  const stale = `Stale row ${run}`;
  await createProject(page, listed);
  await createProject(page, `Kept row ${run}`);                                        // the stale row's neighbour, which nothing deletes
  const staleId = await createProject(page, stale);
  await page.goto('/');
  const rowOf = (name: string) => page.locator('.project-card').filter({ has: page.getByRole('link', { name, exact: true }) });
  const deletedRow = (name: string) => page.getByRole('region', { name: 'Recently deleted' }).getByRole('listitem').filter({ hasText: name });
  const confirmDelete = async (name: string): Promise<void> => {
    const row = rowOf(name);
    await row.getByRole('button', { name: 'Delete' }).click();
    const form = row.getByRole('form', { name: 'Confirm delete' });
    await form.getByLabel('Type the project name to confirm').fill(name);
    await form.getByRole('button', { name: 'Delete', exact: true }).click();
  };

  await confirmDelete(listed);
  await expect(page.getByText(`${listed} was deleted by Cy`)).toHaveCount(1);
  await expect(page.getByRole('link', { name: listed, exact: true })).toHaveCount(0);
  await expect(deletedRow(listed)).toContainText('Deleted by Cy');

  // The list has no live channel (ruling C17): Dee deletes the other project while this list still shows its row.
  const res = await page.context().request.delete(`/api/projects/${staleId}`, { headers: { 'X-Planner-Name': 'Dee' } });
  expect(res.status()).toBe(204);
  await expect(page.getByRole('link', { name: stale, exact: true })).toBeVisible();
  // ledger ruling P2-R140 on a row found gone (onGone): the focus the confirm had goes on to the nearest row left's link, never to the body
  const nearest = await rowOf(stale).evaluate((li) => (li.nextElementSibling ?? li.previousElementSibling)?.querySelector('a.project-link')?.textContent ?? null);
  await watchBodyFocus(page);
  await confirmDelete(stale);
  await expect(nearest === null ? page.getByLabel('New project') : page.getByRole('link', { name: nearest, exact: true })).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
  await expect(page.getByText(`${stale} was already deleted`)).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);                                 // no "No project <id>"
  await expect(page.getByRole('link', { name: stale, exact: true })).toHaveCount(0);
  await expect(deletedRow(stale)).toContainText('Deleted by Dee');
});

// The final fix wave, FW-6. Since Task 9b's M1 the DELETE waits until the posts the page still has on their way are answered, up to 60 s
// behind a stalled one. Cancel meanwhile stops it: the project stays, and the confirm opens again ready to delete. While the keyboard's Delete
// waits, the focus stays in the form, on Cancel (the disabled Delete would drop it on the page's body), and Cancel gives it back to Delete
// project, which the form took the place of. The proof that no DELETE goes is a fixed wait across the moment the old code sent it, the held
// post's answer, followed by the positive check that a confirmed delete does go (ledger ruling P2-R25).
test('Cancel stops a delete still waiting for the page\'s posts, and the focus goes back to Delete project', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  const name = `Cancelled delete ${test.info().repeatEachIndex + 1}`;                // one per run: the server is shared
  const id = await createProject(page, name);
  const deletes: string[] = [];
  page.on('request', (r) => { if (r.method() === 'DELETE') deletes.push(r.url()); });
  const held: Route[] = [];
  let holding = true;
  await page.route(`**/api/projects/${id}/ops`, (route) => {
    if (holding) held.push(route);
    else void route.continue();
  });
  // a post on its way: a rename, held
  const renamed = `${name}, renamed`;
  const field = page.getByRole('textbox', { name: 'Project name' });
  await field.fill(renamed);
  await field.press('Enter');
  await expect.poll(() => held.length, { message: 'the rename is held on its way' }).toBe(1);
  const opener = page.getByRole('button', { name: 'Delete project' });
  await opener.click();
  const form = page.getByRole('form', { name: 'Confirm delete' });
  await form.getByLabel('Type the project name to confirm').fill(renamed);              // the name the page shows
  await watchBodyFocus(page);
  const confirm = form.getByRole('button', { name: 'Delete', exact: true });
  await confirm.focus();
  await page.keyboard.press('Enter');                                                     // the keyboard's Delete, which waits for the rename
  const cancel = form.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Enter');                                                     // the keyboard's Cancel
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
  holding = false;
  for (const route of held) await route.fulfill({ response: await route.fetch() });
  await expect.poll(async () => ((await (await page.request.get(`/api/projects/${id}`)).json()) as { name: string }).name).toBe(renamed);
  await page.waitForTimeout(600);
  expect(deletes, 'no DELETE once the rename is answered').toEqual([]);
  expect((await page.request.get(`/api/projects/${id}`)).status()).toBe(200);
  expect(await bodyFocusCount(page)).toBe(0);
  // the confirm opens again ready, and a delete confirmed now goes
  await opener.click();
  await form.getByLabel('Type the project name to confirm').fill(renamed);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(/\/$/);
  expect(deletes).toHaveLength(1);
});

// FW-6: on the list, Escape in the confirm is its Cancel (one layer per press, P2-R21b), and Cancel from the keyboard, or Escape, gives the
// focus back to the row's Delete, never to the page's body
test('on the list Escape cancels a row\'s confirm, and the keyboard\'s Cancel and Escape give the focus back to its Delete', async ({ page }) => {
  await login(page); await setName(page, 'Cy');
  const name = `Escaped delete ${test.info().repeatEachIndex + 1}`;
  await createProject(page, name);
  await page.goto('/');
  const row = page.locator('.project-card').filter({ has: page.getByRole('link', { name, exact: true }) });
  const opener = row.getByRole('button', { name: 'Delete' });
  const form = row.getByRole('form', { name: 'Confirm delete' });
  await watchBodyFocus(page);
  await opener.click();
  await expect(form.getByLabel('Type the project name to confirm')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');                                                     // open it again from the keyboard
  await form.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Enter');
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();             // nothing was deleted
});

// ledger ruling P2-R140 (P2-R57's and P2-R68's pattern): a delete confirmed from a list row hands the focus on as the row goes, when it was in
// the row: to the nearest row left's link, the next, else the one before; else the New project field; else the page's main; never the body. The
// list is served with this test's three projects alone (newest first: C, B, A), so which row is next is known whatever other tests make
test('a delete confirmed from a list row by the keyboard hands the focus to the next row, the one before, then New project', async ({ page }) => {
  await login(page); await setName(page, 'Cy');
  const run = test.info().repeatEachIndex + 1;                                         // one per run: the server is shared
  const names = [`Focus row A ${run}`, `Focus row B ${run}`, `Focus row C ${run}`];
  const ids: string[] = [];
  for (const name of names) ids.push(await createProject(page, name));
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const list = (await res.json()) as Array<{ id: string }>;
    return route.fulfill({ response: res, json: list.filter((p) => ids.includes(p.id)) });
  });
  await page.goto('/');
  await expect(page.locator('.project-card')).toHaveCount(3);
  const rowOf = (name: string) => page.locator('.project-card').filter({ has: page.getByRole('link', { name, exact: true }) });
  const linkOf = (name: string) => page.getByRole('link', { name, exact: true });
  await watchBodyFocus(page);
  /** Deletes `name` from its row by the keyboard alone: Enter on Delete, its name typed into the field the form opens with, Enter. */
  const deleteByKeyboard = async (name: string): Promise<void> => {
    const row = rowOf(name);
    await row.getByRole('button', { name: 'Delete' }).focus();
    await page.keyboard.press('Enter');
    await expect(row.getByLabel('Type the project name to confirm')).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(row).toHaveCount(0);
  };
  await deleteByKeyboard(names[2]!);                                                     // C, the first row: the next row's link, B's
  await expect(linkOf(names[1]!)).toBeFocused();
  await deleteByKeyboard(names[0]!);                                                     // A, the last row: the one before, B's
  await expect(linkOf(names[1]!)).toBeFocused();
  await deleteByKeyboard(names[1]!);                                                     // B, the only row: New project's field
  await expect(page.getByLabel('New project')).toBeFocused();
  expect(await bodyFocusCount(page)).toBe(0);
});
