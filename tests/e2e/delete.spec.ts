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
