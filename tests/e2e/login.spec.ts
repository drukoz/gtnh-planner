import { test, expect } from '@playwright/test';
import { E2E_PASSWORD } from './helpers.ts';

// One test on purpose (ruling R15): the suite of this plan reports `4 passed`.
test('the shared password leads to the project list, and the name is asked for once', async ({ page }) => {
  await page.goto('/');                                                                // no session yet: the API answers 401
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  const password = page.getByLabel('Password');
  const logIn = page.getByRole('button', { name: 'Log in' });
  await password.fill('not the password');
  await logIn.click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password');

  await password.fill(E2E_PASSWORD);
  await logIn.click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  const prompt = page.getByRole('dialog', { name: 'What should we call you?' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Your name').fill('Ann');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toBeHidden();

  await page.reload();                                                                 // the name stays in this browser
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(prompt).toHaveCount(0);
});
