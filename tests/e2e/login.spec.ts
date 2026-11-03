import { test, expect } from '@playwright/test';
import { E2E_PASSWORD } from './helpers.ts';

// One test on purpose (ruling R15). The front page is the landing page and asks for nothing (RUK-510): its way in, the
// project list, is what asks for the shared password.
test('the landing page\'s way in asks for the shared password, leads to the project list, and the name is asked for once', async ({ page }) => {
  await page.goto('/');                                                                // the landing page: no password, no name
  await expect(page.getByRole('heading', { level: 1, name: 'GTNH Line Planner' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'What should we call you?' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open the planner' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);                          // no session yet: the API answers 401
  const password = page.getByLabel('Password');
  const logIn = page.getByRole('button', { name: 'Log in' });
  await password.fill('not the password');
  await logIn.click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password');

  await password.fill(E2E_PASSWORD);
  await logIn.click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);

  const prompt = page.getByRole('dialog', { name: 'What should we call you?' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Your name').fill('Ann');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toBeHidden();

  await page.reload();                                                                 // the name stays in this browser
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(prompt).toHaveCount(0);
});
