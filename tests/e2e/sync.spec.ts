import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

test('a tick by one person shows up for another within 2 s, with their name', async ({ browser }) => {
  const pa = await (await browser.newContext()).newPage(); const pb = await (await browser.newContext()).newPage();
  await login(pa); await setName(pa, 'Ann'); await login(pb); await setName(pb, 'Jörg 🙂');
  const id = await createProject(pa, 'Shared', { target: 't:circuit@0', amount: 30, tier: 1 });
  for (const p of [pa, pb]) { await p.goto(`/p/${id}#materials`); await expect(p.locator('[data-row="run:t:iron_ingot@0"]')).toBeVisible(); }
  const sentAt = Date.now();
  await pb.locator('[data-row="run:t:iron_ingot@0"] input[type=checkbox]').click();   // click, not check(): the box flips on the server echo
  await pa.waitForFunction(() => document.querySelector('[data-row="run:t:iron_ingot@0"]')?.getAttribute('data-marked') === 'true', null, { polling: 'raf', timeout: 2000 });
  expect(Date.now() - sentAt).toBeLessThan(2000);
  await expect(pa.locator('[data-row="run:t:iron_ingot@0"]')).toContainText('Jörg 🙂');
  await pa.reload();                                                                   // persisted, not only pushed
  await expect(pa.locator('[data-row="run:t:iron_ingot@0"]')).toHaveAttribute('data-marked', 'true');
});
