import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

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
  await confirmDelete(stale);
  await expect(page.getByText(`${stale} was already deleted`)).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);                                 // no "No project <id>"
  await expect(page.getByRole('link', { name: stale, exact: true })).toHaveCount(0);
  await expect(deletedRow(stale)).toContainText('Deleted by Dee');
});
