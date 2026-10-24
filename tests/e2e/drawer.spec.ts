// The settings column is a drawer on a narrow screen (restyle plan Phase 1 Task 4, design spec §7a): the Settings button of the
// project head slides it in over a dimmed page, Escape or a click on the page behind closes it, and Escape gives the focus back
// to the button. A wide screen keeps the column beside the views and never shows the button. The drawer is a layer of its own
// (ruling R36): opening it moves the focus to its Close settings button, the page behind is inert while it is open, every way out
// gives the focus back to the Settings button, and a window that grows past 900 px closes it. The Settings button is found by its
// exact name: "Close settings" has it in its own.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

/** What the page behind the drawer is made of: inert while the drawer is open. */
const BEHIND = ['.top-nav', '.project-head', '.project-banners', '.project-views'];

/** Where the keyboard's focus is: in the drawer, nowhere (the end of the page, past which Tab goes round), or the element it escaped to. */
function focusIsIn(page: Page): Promise<string> {
  return page.evaluate(() => {
    const at = document.activeElement;
    if (at === null || at === document.body) return 'nowhere';
    if (at.closest('aside[aria-label="Project settings"]') !== null) return 'the drawer';
    return at.outerHTML.slice(0, 120);
  });
}

test('narrow screens open the settings as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Drawer');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });

  // closed: the column is slid out of sight, and out of the tab order with it
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await toggle.click();
  await expect(settings).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Escape closes it from inside, and the focus goes back to the button (a click focuses a button too, so the focus starts in the drawer)
  await settings.getByPlaceholder('Search items and fluids').focus();
  await expect(settings.getByPlaceholder('Search items and fluids')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // the dimmed page behind the drawer closes it too, and gives the focus back to the button as well
  await toggle.click();
  await expect(settings).toBeVisible();
  await page.locator('.drawer-backdrop').click();
  await expect(settings).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('the keyboard opens the drawer into it, goes round its controls only, and leaves it on the Settings button', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Keys');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });
  const close = settings.getByRole('button', { name: 'Close settings' });
  // the button names the drawer it opens
  await expect(toggle).toHaveAttribute('aria-controls', 'project-settings');
  await expect(settings).toHaveAttribute('id', 'project-settings');

  // Tab from the top of the page to the Settings button, and Enter: the drawer opens with the focus on its Close button, in view
  for (let tabs = 0; tabs < 10 && !(await toggle.evaluate((el) => el === document.activeElement)); tabs++) await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(settings).toBeVisible();
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  // the page behind it is inert: nothing there takes the focus or a click while the drawer is open
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).toHaveAttribute('inert', '');

  // Tab goes round the drawer's own controls only: from Close through every one, past the end of the page, and back to Close
  let tabs = 0;
  do {
    await page.keyboard.press('Tab');
    tabs++;
    const at = await focusIsIn(page);
    expect(['the drawer', 'nowhere'], `Tab ${tabs} took the focus to ${at}`).toContain(at);
  } while (tabs < 300 && !(await close.evaluate((el) => el === document.activeElement)));
  await expect(close).toBeFocused();
  expect(tabs, 'the drawer has controls of its own to go round').toBeGreaterThan(5);
  // and Shift+Tab goes round the other way, from Close to the drawer's last control
  await page.keyboard.press('Shift+Tab');
  if ((await focusIsIn(page)) === 'nowhere') await page.keyboard.press('Shift+Tab');
  expect(await focusIsIn(page)).toBe('the drawer');
  await expect(close).not.toBeFocused();

  // Escape closes it, the focus goes back to the Settings button and the page is live again
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');

  // its Close button closes it the same way
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();

  // and so does a click on the dimmed page behind it
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused();
  await page.locator('.drawer-backdrop').click();
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('the drawer slides out faster than it slides in', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Exit');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const motion = (): Promise<{ duration: string; easing: string }> => settings.evaluate((el) => {
    const style = getComputedStyle(el);
    return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
  });
  // closed, its transition is the one a closing drawer slides out with: the exit's 180ms, easing in (then it hides at once)
  expect(await motion()).toEqual({ duration: '0.18s, 0s', easing: 'cubic-bezier(0.4, 0, 1, 1), ease' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings).toBeVisible();
  // open, the one it slid in with: 260ms, easing out
  expect(await motion()).toEqual({ duration: '0.26s', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
});

test('a window that grows past 900 px closes the drawer, and leaves the page live', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Resize');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.setViewportSize({ width: 1280, height: 720 });
  // the button is not drawn on a wide window, so it is found by its class: it says the drawer is closed
  await expect(page.locator('.settings-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  for (const behind of BEHIND) await expect(page.locator(behind).first(), behind).not.toHaveAttribute('inert');
  await expect(settings).toBeVisible();                                                // the column beside the views again
  // narrow once more, the drawer is closed: the state did not wait for a narrow window to show itself
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(settings).toBeHidden();
});

test('Escape closes one layer per press: an open search list first, then the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Layers');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });
  await toggle.click();
  await expect(settings).toBeVisible();

  // a list open in the drawer: typing shows it, and the first Escape is the list's, not the drawer's
  await settings.getByPlaceholder('Search items and fluids').fill('Iron Ingot');
  const matches = settings.getByRole('listbox', { name: 'Matches' });
  await expect(matches).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(matches).toBeHidden();
  // the drawer is still open: its button says so at once, and its backdrop is still there (a drawer that was closing would be
  // drawn for the 180ms of its slide, so the button and the backdrop are what to look at)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);
  await expect(settings).toBeVisible();

  // nothing is open in it now, so the next Escape closes the drawer and the focus goes back to the button
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('the avoid box\'s list, and a key something inside the drawer has handled, keep the drawer open too', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'More layers');
  const settings = page.locator('aside[aria-label="Project settings"]');
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });
  await toggle.click();
  await expect(settings).toBeVisible();

  // the other search list of the column, the avoid box's, is a combobox that closes on Escape the same way
  await settings.getByRole('combobox', { name: 'Avoid a material' }).fill('copp');
  const materials = settings.getByRole('listbox', { name: 'Materials' });
  await expect(materials).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(materials).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // something inside the drawer that takes the key the way a confirmation would, by preventing its default, keeps the drawer open
  await settings.evaluate((aside) => {
    aside.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && aside.dataset['claimEscape'] === 'yes') e.preventDefault();
    });
    aside.dataset['claimEscape'] = 'yes';
  });
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);

  await settings.evaluate((aside) => { aside.dataset['claimEscape'] = 'no'; });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(toggle).toBeFocused();
});

// Ruling R37: in a column 300 px wide or so, the title of a section can wrap beside its readout ("Reachable dimensions"). The button
// then grows to hold its lines, instead of spilling them over its bevel; a title on one line keeps the button at 36 px.
test('a settings title that wraps grows its button and stays inside it, in the column and in the drawer', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Wrapped titles', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 });   // a plan: the readout shows
  const settings = page.locator('aside[aria-label="Project settings"]');
  const dims = settings.locator('details.settings-section > summary').filter({ hasText: 'Reachable dimensions' });
  const projector = settings.locator('details.settings-section > summary').filter({ hasText: 'In-game projector' });
  /** A summary's face less its 2 px edge and 2 px bevel, its title's box and line height, and its readout's box. */
  const measure = (summary: Locator) => summary.evaluate((el) => {
    const box = (of: Element): { top: number; bottom: number; left: number; right: number; height: number } => {
      const { top, bottom, left, right, height } = of.getBoundingClientRect();
      return { top, bottom, left, right, height };
    };
    const face = box(el);
    const inset = 2 + 2;
    const title = el.querySelector('h3');
    const readout = el.querySelector('.muted');
    return {
      height: face.height,
      inside: { top: face.top + inset, bottom: face.bottom - inset, left: face.left + inset, right: face.right - inset },
      title: title === null ? null : { ...box(title), line: Number.parseFloat(getComputedStyle(title).lineHeight) },
      readout: readout === null ? null : box(readout),
    };
  });

  for (const [width, height, drawer] of [[1280, 720, false], [800, 900, true]] as const) {
    await page.setViewportSize({ width, height });
    if (drawer) await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(dims).toBeVisible();
    await expect(dims.locator('.muted')).toBeVisible();
    const drawn = await measure(dims);
    if (drawn.title === null || drawn.readout === null) throw new Error('the summary has no title or no readout');
    expect(Math.round(drawn.title.height / drawn.title.line), `the title wraps at ${width} px`).toBeGreaterThanOrEqual(2);
    expect(drawn.height, `the button grows at ${width} px`).toBeGreaterThan(36);
    // every line of the title, and the readout beside it, is inside the face: clear of its edge and its bevel
    for (const part of [drawn.title, drawn.readout]) {
      expect(part.top, `at ${width} px`).toBeGreaterThanOrEqual(drawn.inside.top);
      expect(part.bottom, `at ${width} px`).toBeLessThanOrEqual(drawn.inside.bottom);
      expect(part.right, `at ${width} px`).toBeLessThanOrEqual(drawn.inside.right);
    }
    // a title on one line keeps the button's 36 px
    expect((await measure(projector)).height, `at ${width} px`).toBe(36);
  }
});

test('wide screens keep the settings beside the views and show no button', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'No drawer');
  await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible();
  // the button is there for a narrow window to find, and hidden by the stylesheet while this one is wide; so is the drawer's Close button
  await expect(page.locator('.settings-toggle')).toHaveCount(1);
  await expect(page.locator('.settings-toggle')).toBeHidden();
  await expect(page.locator('.settings-close')).toHaveCount(1);
  await expect(page.locator('.settings-close')).toBeHidden();
});
