import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('create, copy and revoke a projector token', async ({ page }) => {
  await login(page);
  await setName(page, 'Ann');
  const id = await createProject(page, 'Projector e2e');
  await page.getByText('In-game projector').click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await page.getByLabel('Who is it for?').fill('Steve');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.locator('code', { hasText: `/planner load ${id} gpt_` })).toBeVisible();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await page.reload();
  await page.getByText('In-game projector').click();
  await expect(page.locator('code', { hasText: '/planner load' })).toHaveCount(0);
});

/** What the page's stand-in for `document.execCommand('copy')` saw (it never touches the real clipboard). */
interface CopyLog { copied: string[]; copyWorks: boolean }

test('copies a command over plain http, and says how to copy it by hand when the browser refuses', async ({ page }) => {
  // A friend's browser at http://<host>:8765 is not a secure context: no navigator.clipboard, only the old copy.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    const log = window as unknown as CopyLog;
    log.copied = [];
    log.copyWorks = true;
    document.execCommand = (command: string): boolean => {
      if (command !== 'copy' || !log.copyWorks) return false;
      log.copied.push(String(getSelection()));
      return true;
    };
  });
  await login(page);
  await setName(page, 'Ann');
  const id = await createProject(page, 'Projector copy');
  await page.getByText('In-game projector').click();
  await page.getByLabel('Who is it for?').fill('Steve');
  await page.getByRole('button', { name: 'Create token' }).click();
  const loadCode = page.locator('code', { hasText: `/planner load ${id} gpt_` });
  await expect(loadCode).toBeVisible();
  const loadLine = page.locator('.command-line', { has: loadCode });
  await loadLine.getByRole('button', { name: 'Copy' }).click();
  await expect(loadLine.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as CopyLog).copied)).toEqual([await loadCode.textContent()]);
  await expect(loadLine.getByRole('button', { name: 'Copy' })).toBeVisible();   // back after a moment

  await page.evaluate(() => { (window as unknown as CopyLog).copyWorks = false; });
  const urlCode = page.locator('code', { hasText: '/planner url ' });
  const urlLine = page.locator('.command-line', { has: urlCode });
  await urlLine.getByRole('button', { name: 'Copy' }).click();
  await expect(urlLine.getByRole('status')).toHaveText('Press Ctrl+C (Cmd+C on a Mac) to copy');
  expect(await page.evaluate(() => String(getSelection()))).toBe(await urlCode.textContent());
  await expect(loadLine.getByRole('status')).toHaveCount(0);
});
