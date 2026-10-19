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
