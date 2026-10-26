// The project page's "In-game projector" panel: a token made, copied and revoked. Revoke asks in the panel (Phase 2 spec §13, Task 10), in the
// token's row, never in a browser dialog: each test that revokes counts the browser dialogs it meets, which must be none. The safe answer,
// Keep it, takes the focus as the confirm opens; Keep it and Escape give it back to the row's Revoke, and a revoke that went through to the
// "Who is it for?" field, the row being gone. The focus is never left on the page's body; Tab stays in the confirm while it asks; Escape is one
// layer per press, after a tip and before the settings drawer it may be asked in. Task F3 (ledger ruling P2-R68): Create token, disabled
// while the token is made, hands the focus to the field first and then to the new command's Copy; a revoke that went through is said on the
// panel's polite line; and a failed revoke's reason is said once, in one alert.

import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { login, setName, createProject, LV_CIRCUITS, SETTINGS_BUTTON, noDialogs, watchBodyFocus, bodyFocusCount } from './helpers.ts';

test('create, copy and revoke a projector token', async ({ page }) => {
  const dialogs: string[] = []; page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await login(page);
  await setName(page, 'Ann');
  const id = await createProject(page, 'Projector e2e');
  await page.getByText('In-game projector').click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await page.getByLabel('Who is it for?').fill('Steve');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.locator('code', { hasText: `/planner load ${id} gpt_` })).toBeVisible();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Keep it' })).toBeFocused();
  await page.getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke' })).toBeFocused();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(page.getByLabel('Who is it for?')).toBeFocused();
  await page.reload();
  await page.getByText('In-game projector').click();
  await expect(page.locator('code', { hasText: '/planner load' })).toHaveCount(0);
  expect(dialogs).toEqual([]);
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

// ---- Task 10: the confirm's keyboard and focus, a revoke that fails or finds its token gone, its entrance, and forced colours ----

/**
 * Notes down, in the page, the words of every alert put in it from now on: an element with role="alert" inserted, or one inside an inserted
 * element (each is announced as it comes). Read with `alertsSaid`.
 */
const watchAlerts = (page: Page): Promise<void> => page.evaluate(() => {
  const w = window as unknown as { alerts: string[] };
  w.alerts = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const el of [node, ...node.querySelectorAll('[role="alert"]')]) if (el.matches('[role="alert"]')) w.alerts.push(el.textContent ?? '');
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
});
const alertsSaid = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { alerts: string[] }).alerts);

/** Notes down, in the page, the words of each saying put on the panel's polite line from now on; read with `sayings`. */
const watchSayings = (page: Page): Promise<void> => page.locator('.projector-panel ~ p[aria-live="polite"]').evaluate((line) => {
  const w = window as unknown as { sayings: string[] };
  w.sayings = [];
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) w.sayings.push(node.textContent ?? '');
  }).observe(line, { childList: true });
});
const sayings = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { sayings: string[] }).sayings);

/** Opens the projector panel in `scope` (the page, or the settings drawer), makes Steve a token and waits for its row; resolves with its id. */
async function steveToken(page: Page, scope: Page | Locator): Promise<string> {
  await scope.getByText('In-game projector').click();
  await scope.getByLabel('Who is it for?').fill('Steve');
  await scope.getByRole('button', { name: 'Create token' }).click();
  await expect(scope.getByText(/^Steve · gpt_/)).toBeVisible();
  await expect(scope.getByRole('button', { name: 'Create token' })).toBeEnabled();      // the list is in: the panel is not busy
  return (await scope.locator('li[data-token-id]').getAttribute('data-token-id'))!;
}

test('the confirm keeps the keyboard: Tab stays in it, a tip takes the first Escape, it the next, and in the drawer the drawer the one after', async ({ page }) => {
  const dialogs = noDialogs(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector drawer', LV_CIRCUITS);                            // a target: the drawer stays shut until asked
  const toggle = page.getByRole('button', { name: SETTINGS_BUTTON });
  await toggle.click();
  const settings = page.locator('aside[aria-label="Project settings"]');
  await expect(settings).toBeVisible();
  await steveToken(page, settings);
  await watchBodyFocus(page);
  const revoke = settings.getByRole('button', { name: 'Revoke' });
  await revoke.click();
  const confirm = settings.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  const keep = confirm.getByRole('button', { name: 'Keep it' });
  const yes = confirm.getByRole('button', { name: 'Revoke token' });
  await expect(keep).toBeFocused();
  // the confirm is in the drawer, above its dimmed page and not inert: it is drawn where the pointer reaches it
  expect(await confirm.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) && el.closest('[inert]') === null;
  })).toBe(true);
  // Tab and Shift+Tab go round its two buttons while it asks
  await page.keyboard.press('Tab');
  await expect(yes).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(keep).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(yes).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(keep).toBeFocused();
  // a tip showing takes the first Escape (ledger ruling P2-R21b): the confirm still asks, the focus still on Keep it
  await settings.locator('.settings-target .item-icon').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(confirm).toBeVisible();
  await expect(keep).toBeFocused();
  // the next is the confirm's: the token stays, the focus goes back to its Revoke, and the drawer stays open (one layer per press)
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(settings.getByText(/^Steve · gpt_/)).toBeVisible();
  await expect(revoke).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  // the next closes the drawer, the focus back on the Settings button
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  // answered inside the drawer, Revoke token revokes, the field takes the focus and the drawer stays open
  await toggle.click();
  await expect(settings).toBeVisible();
  await revoke.click();
  await yes.click();
  await expect(settings.getByText('No tokens yet.')).toBeVisible();
  await expect(settings.getByLabel('Who is it for?')).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// spec §13.4: a revoke that fails keeps the confirm, says why in it, and keeps the focus on Keep it. While it is on its way Revoke token cannot
// be pressed again, and the focus it had moves to Keep it first: a disabled button would leave it on the page
test('a revoke that fails keeps asking, says why in the confirm, and keeps the focus on Keep it', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector failed revoke');
  await steveToken(page, page);
  const held: Route[] = [];
  await page.route('**/api/projects/*/tokens/*', (route) => {
    if (route.request().method() === 'DELETE') held.push(route);
    else void route.continue();
  });
  await watchBodyFocus(page);
  await watchAlerts(page);
  await page.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  const yes = confirm.getByRole('button', { name: 'Revoke token' });
  const keep = confirm.getByRole('button', { name: 'Keep it' });
  await yes.click();
  await expect.poll(() => held.length, { message: 'the revoke is held on its way' }).toBe(1);
  await expect(yes).toBeDisabled();
  await expect(keep).toBeFocused();
  await held[0]!.fulfill({ status: 503, json: { error: 'unavailable', message: 'The planner could not revoke it just now' } });
  await expect(confirm.getByRole('alert')).toHaveText('The planner could not revoke it just now');
  await expect(yes).toBeEnabled();                                                          // the list came back: the panel is not busy
  await expect(keep).toBeFocused();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  await expect(page.locator('.projector-body > .error')).toHaveCount(0);                   // said in the confirm, and only there
  expect(await alertsSaid(page), 'said once (Task F3)').toEqual(['The planner could not revoke it just now']);
  await page.unroute('**/api/projects/*/tokens/*');
  await yes.click();                                                                         // the next try goes through
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(page.getByLabel('Who is it for?')).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// someone else revoked the token while it was asked about: the server no longer has it, the row and its question go, the field takes the
// focus, and the server's reason is said under the form, as before the confirm
test('a token revoked elsewhere first takes its question with it, and the panel says why', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Projector revoked elsewhere');
  const tokenId = await steveToken(page, page);
  await watchBodyFocus(page);
  await watchAlerts(page);
  await page.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  await expect(confirm.getByRole('button', { name: 'Keep it' })).toBeFocused();
  const gone = await page.request.delete(`/api/projects/${id}/tokens/${tokenId}`, { headers: { 'X-Planner-Name': 'Bob' } });
  expect(gone.status()).toBe(204);
  await confirm.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator('.projector-body > .error').getByRole('alert')).toHaveText(`No token ${tokenId} in project ${id}`);
  await expect(page.getByLabel('Who is it for?')).toBeFocused();
  // said once, under the form, not first in the confirm too (Task F3): one alert put in the page
  expect(await alertsSaid(page)).toEqual([`No token ${tokenId} in project ${id}`]);
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// Task F3 (ledger ruling P2-R68): Create token is disabled while the token is made, and a disabled button that has the focus drops it on the
// body at its next frame; so it hands the focus to the "Who is it for?" field first, and once the token is made, to its command's Copy, the
// next thing to do with it. The field's Enter makes a token too, and ends the same way.
test('Create token hands the focus to the field while the token is made, then to its command\'s Copy', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  const id = await createProject(page, 'Projector created');
  await page.getByText('In-game projector').click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await watchBodyFocus(page);
  const field = page.getByLabel('Who is it for?');
  const create = page.getByRole('button', { name: 'Create token' });
  const load = page.locator('code', { hasText: `/planner load ${id} gpt_` });
  const copy = page.locator('.command-line', { has: load }).getByRole('button', { name: 'Copy' });
  const held: Route[] = [];
  await page.route('**/api/projects/*/tokens', (route) => {
    if (route.request().method() === 'POST') held.push(route);
    else void route.continue();
  });
  await field.fill('Steve');
  await create.click();
  await expect.poll(() => held.length, { message: 'the token is held on its way' }).toBe(1);
  await expect(create).toBeDisabled();
  await expect(field).toBeFocused();
  await held[0]!.continue();
  await expect(copy).toBeFocused();
  const steve = await load.textContent();
  await page.unroute('**/api/projects/*/tokens');
  // Copy takes the focus as the command is drawn, before the list after it is in: until then Create token is disabled, and the field's Enter
  // makes no token (a form whose button is disabled is not sent)
  await expect(create).toBeEnabled();                                                     // the list is in: the panel is not busy
  await field.fill('Alex');
  await field.press('Enter');
  await expect(load).not.toHaveText(steve!);                                               // Alex's command, shown in place of Steve's
  await expect(copy).toBeFocused();
  await expect(page.getByText(/^Alex · gpt_/)).toBeVisible();
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// Task F3: a revoke that went through has no toast (Phase 2 spec §12.1: the confirm and the row's going are the feedback), so the panel's polite
// line says it, as it says "Copied" inside the drawer: a new line each time, so a second revoke is heard too
test('a revoke that went through is said on the panel\'s polite line, each time', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector said');
  await steveToken(page, page);
  await page.getByLabel('Who is it for?').fill('Alex');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByText(/^Alex · gpt_/)).toBeVisible();
  const said = page.locator('.projector-panel ~ p[aria-live="polite"]');
  await expect(said).toHaveText('');
  await watchSayings(page);
  for (const who of ['Steve', 'Alex']) {
    await page.locator('li[data-token-id]', { hasText: `${who} · ` }).getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('alertdialog', { name: new RegExp(`Revoke "${who}"`) }).getByRole('button', { name: 'Revoke token' }).click();
    await expect(page.locator('li[data-token-id]', { hasText: `${who} · ` })).toHaveCount(0);
    await expect(said).toHaveText('Token revoked');
  }
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  expect(await sayings(page)).toEqual(['Token revoked', 'Token revoked']);
  expect(dialogs).toEqual([]);
});

// F3 fix round 1, M2: the Copy's 2 s take back only the copy's own saying, so a revoke said meanwhile stays said. The page's clock is held from
// before the copy, so the revoke surely comes within the copy's 2 s, and is then let run past them
test('a revoke said within a copy\'s 2 s is still said once they are up', async ({ page }) => {
  await page.addInitScript(() => {                                                       // the old copy, with no clipboard API (as above)
    Object.defineProperty(window, 'isSecureContext', { value: false });
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    document.execCommand = (command: string): boolean => command === 'copy';
  });
  await page.clock.install();
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector said, copied');
  await steveToken(page, page);
  const said = page.locator('.projector-panel ~ p[aria-live="polite"]');
  const urlLine = page.locator('.command-line', { has: page.locator('code', { hasText: '/planner url ' }) });
  await page.clock.pauseAt(Date.now() + 1000);
  await urlLine.getByRole('button', { name: 'Copy' }).click();
  await expect(urlLine.getByRole('button', { name: 'Copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(said).toHaveText('Token revoked');
  await expect(urlLine.getByRole('button', { name: 'Copied' })).toBeVisible();          // the copy's 2 s have not run yet
  await page.clock.runFor(2000);
  await expect(urlLine.getByRole('button', { name: 'Copy' })).toBeVisible();            // they have
  await expect(said).toHaveText('Token revoked');
  expect(dialogs).toEqual([]);
});

// F3 fix round 1, M3: Keep it pressed while the revoke is on its way closes the question (the revoke goes on). A 503 then is said once, under
// the form, the question having gone; a revoke that went through is said aloud once, and its row goes. The row's Revoke is disabled while the
// revoke is on its way, so Keep it gives the focus to the field
test('a question closed while its revoke is on its way: a failure said once under the form, a revoke that went through said once aloud', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector kept meanwhile');
  await steveToken(page, page);
  const held: Route[] = [];
  await page.route('**/api/projects/*/tokens/*', (route) => {
    if (route.request().method() === 'DELETE') held.push(route);
    else void route.continue();
  });
  await watchBodyFocus(page);
  await watchAlerts(page);
  await watchSayings(page);
  const revoke = page.getByRole('button', { name: 'Revoke', exact: true });
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  const field = page.getByLabel('Who is it for?');
  const reason = 'The planner could not revoke it just now';
  await revoke.click();
  await confirm.getByRole('button', { name: 'Revoke token' }).click();
  await expect.poll(() => held.length, { message: 'the revoke is held on its way' }).toBe(1);
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(field).toBeFocused();
  await held[0]!.fulfill({ status: 503, json: { error: 'unavailable', message: reason } });
  await expect(page.locator('.projector-body > .error').getByRole('alert')).toHaveText(reason);
  await expect(revoke).toBeEnabled();                                                     // the list is in: the panel is not busy
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  expect(await alertsSaid(page)).toEqual([reason]);
  await revoke.click();
  await confirm.getByRole('button', { name: 'Revoke token' }).click();
  await expect.poll(() => held.length, { message: 'the second revoke is held on its way' }).toBe(2);
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(field).toBeFocused();
  await held[1]!.continue();                                                              // the server revokes it
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(page.locator('.projector-panel ~ p[aria-live="polite"]')).toHaveText('Token revoked');
  expect(await sayings(page)).toEqual(['Token revoked']);
  expect(await alertsSaid(page), 'no alert since the first').toEqual([reason]);
  await expect(field).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// F3 fix round 1, M6: Create token that fails says why under the form, once each time, keeps the focus in the field it handed it to, is
// enabled again, and makes no token
test('Create token that fails says why once each time, and keeps the focus in the field', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector refused');
  await page.getByText('In-game projector').click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  const reason = 'The planner cannot make a token just now';
  await page.route('**/api/projects/*/tokens', (route) => {
    if (route.request().method() === 'POST') void route.fulfill({ status: 503, json: { error: 'unavailable', message: reason } });
    else void route.continue();
  });
  await watchBodyFocus(page);
  await watchAlerts(page);
  const field = page.getByLabel('Who is it for?');
  const create = page.getByRole('button', { name: 'Create token' });
  const alert = page.locator('.projector-body > .error').getByRole('alert');
  await field.fill('Steve');
  await create.click();                                                                   // by the pointer
  await expect(alert).toHaveText(reason);
  await expect(create).toBeEnabled();
  await expect(field).toBeFocused();
  expect(await alertsSaid(page)).toEqual([reason]);
  await field.press('Enter');                                                             // and from the field
  await expect.poll(() => alertsSaid(page)).toEqual([reason, reason]);
  await expect(alert).toHaveText(reason);
  await expect(create).toBeEnabled();
  await expect(field).toBeFocused();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(page.locator('li[data-token-id]')).toHaveCount(0);
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// F3 fix round 1, M7 (ledger ruling P2-R70): with the server out of reach, the revoke and the list after it fail alike. Said once, where the
// revoke's reason goes: in the confirm, whose question still asks, a list that failed to come keeping its row. The focus stays on Keep it
test('a revoke and the list after it failing alike, the server out of reach, say it once', async ({ page }) => {
  const dialogs = noDialogs(page);
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector unreachable');
  await steveToken(page, page);
  await page.route('**/api/projects/*/tokens**', (route) => {
    if (route.request().method() === 'POST') void route.continue();
    else void route.abort();                                                              // the revoke and the list: no answer at all
  });
  await watchBodyFocus(page);
  await watchAlerts(page);
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  const yes = confirm.getByRole('button', { name: 'Revoke token' });
  await yes.click();
  await expect(confirm.getByRole('alert')).toBeVisible();
  await expect(yes).toBeEnabled();                                                        // the list has failed too: the panel is not busy
  const why = await confirm.getByRole('alert').textContent();
  expect(await alertsSaid(page)).toEqual([why]);
  await expect(page.locator('.projector-body > .error')).toHaveCount(0);
  await expect(confirm.getByRole('button', { name: 'Keep it' })).toBeFocused();
  expect(await bodyFocusCount(page), 'the focus is never left on the page').toBe(0);
  expect(dialogs).toEqual([]);
});

// spec §3.3: the confirm rises in once (opacity and transform), and not at all under reduced motion
test('under reduced motion the confirm appears with no entrance', async ({ page }) => {
  const dialogs = noDialogs(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector still');
  await steveToken(page, page);
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  const entrance = (): Promise<string> => confirm.evaluate((el) => { const s = getComputedStyle(el); return `${s.animationName} ${s.animationDuration}`; });
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(confirm).toBeVisible();
  await expect.poll(entrance).toBe('rise-in 0.001s');
  // without the preference it rises in over its 160 ms, so the check above is not vacuous
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect.poll(entrance).toBe('rise-in 0.16s');
  expect(dialogs).toEqual([]);
});

// forced colours (spec §20, ledger ruling P2-R41): a contrast theme drops the chat face's colour and keeps its edge, a border, in the theme's
// text colour; the face over the panel is the theme's canvas, as the panel is. Read from the painted pixels: the frame shows round the question
test('in forced colours the confirm keeps its frame, in the theme\'s text colour round the theme\'s canvas', async ({ page }) => {
  const dialogs = noDialogs(page);
  await page.emulateMedia({ forcedColors: 'active' });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Projector forced');
  await steveToken(page, page);
  await page.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog', { name: /Revoke "Steve"/ });
  await expect(confirm).toBeVisible();
  await confirm.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));   // risen in: measured where it rests
  const box = (await confirm.boundingBox())!;
  const theme = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const colourOf = (value: string): string => { probe.style.color = value; return getComputedStyle(probe).color; };
    const colours = { text: colourOf('CanvasText'), canvas: colourOf('Canvas') };
    probe.remove();
    return colours;
  });
  expect(theme.text).not.toBe(theme.canvas);
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const at: Array<[string, number, number]> = [
    ['the left edge', box.x + 1, box.y + box.height / 2], ['the top edge', box.x + box.width / 2, box.y + 1],
    ['the right edge', box.x + box.width - 1, box.y + box.height / 2], ['the bottom edge', box.x + box.width / 2, box.y + box.height - 1],
    ['the face', box.x + 5, box.y + 5], ['the panel beside it', box.x - 3, box.y + 5],
  ];
  const painted = await page.evaluate(async ([png, points]) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const g = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    g.drawImage(image, 0, 0);
    return points.map(([, x, y]) => { const [r, gr, b] = g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data; return `rgb(${r}, ${gr}, ${b})`; });
  }, [shot.toString('base64'), at] as const);
  const seen = Object.fromEntries(at.map(([what], i) => [what, painted[i]]));
  expect(seen).toEqual({
    'the left edge': theme.text, 'the top edge': theme.text, 'the right edge': theme.text, 'the bottom edge': theme.text,
    'the face': theme.canvas, 'the panel beside it': theme.canvas,
  });
  expect(dialogs).toEqual([]);
});
