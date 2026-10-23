// The pixel font's ligatures (restyle plan Phase 1 Task 8, ruling R24). Pixelify Sans draws a lowercase "fi", "fl" or "ff" as a ligature
// that looks like an A at 13 to 22px ("Does not fit" read "Does not At", "minecraft:fire" "minecraft:Are"), so styles.css turns liga and
// clig off for every element. It has to be !important on every element: the `font` shorthand, which the rules that set the pixel font
// use, resets font-feature-settings on its own element, so a value on :root or on a parent never reaches the text (measured in
// Chromium). This test asks a browser what it draws. A computed style only says what was asked for; the widths say whether the font
// obeyed, and the same text with the ligatures forced on again (an inline !important beats the stylesheet's) shows that they can tell.

import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';

/** The tags of a computed font-feature-settings (`"clig" 0, "liga" 0`: Chromium sorts them) as { clig: '0', liga: '0' }. */
function tagsOf(value: string): Record<string, string> {
  return Object.fromEntries(value.split(',').map((tag) => tag.trim().split(/\s+/)).map(([name, on]) => [(name ?? '').replace(/"/g, ''), on ?? '']));
}

/** What a text of two letters measures as one run, as two boxes of its own (which cannot ligate), and with the ligatures forced on. */
interface Widths { run: number; apart: number; ligated: number; features: string }

test('the pixel font draws fi, fl and ff as separate letters, in every rule that sets it', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');
  await createProject(page, 'Profile fluid offline');     // a name with a fi, an fl and an ff, in the head's field
  await expect(page.getByRole('tab').first()).toBeVisible();

  // what the page asks for, on real elements of rules that set the pixel font with the shorthand (an input, a tab, a link, the brand, a readout)
  for (const selector of ['input.project-name', ".tabs [role='tab']", '.top-nav nav a', '.brand', '.connection']) {
    const features = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFeatureSettings);
    expect(tagsOf(features), selector).toEqual({ clig: '0', liga: '0' });
  }

  // what it draws: the app's own classes for a badge (the fit of a line), a small button and a panel's title, around "fi", "fl" and "ff"
  const measured = await page.evaluate(async () => {
    await Promise.all(['13px', '15px', "600 16px"].map((font) => document.fonts.load(`${font} 'Pixelify Sans'`)));
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap';
    document.body.appendChild(host);
    const kinds: Record<string, { html: (text: string) => string; target: string }> = {
      badge: { html: (text) => `<span class="badge">${text}</span>`, target: '.badge' },
      button: { html: (text) => `<button type="button" class="small">${text}</button>`, target: 'button' },
      heading: { html: (text) => `<section class="settings-section"><h3>${text}</h3></section>`, target: 'h3' },
    };
    const measure = (kind: string, html: string, ligated: boolean): { width: number; features: string } => {
      host.innerHTML = kinds[kind]!.html(html);
      const target = host.querySelector<HTMLElement>(kinds[kind]!.target)!;
      if (ligated) target.style.setProperty('font-feature-settings', 'normal', 'important');
      const range = document.createRange();
      range.selectNodeContents(target);
      return { width: range.getBoundingClientRect().width, features: getComputedStyle(target).fontFeatureSettings };
    };
    const out: Record<string, Widths> = {};
    for (const kind of Object.keys(kinds)) {
      for (const pair of ['fi', 'fl', 'ff']) {
        const run = measure(kind, pair, false);
        out[`${kind} ${pair}`] = {
          run: run.width,
          apart: measure(kind, [...pair].map((letter) => `<i style="display:inline-block;font:inherit">${letter}</i>`).join(''), false).width,
          ligated: measure(kind, pair, true).width,
          features: run.features,
        };
      }
    }
    host.remove();
    return out;
  });
  for (const [what, w] of Object.entries(measured)) {
    expect(tagsOf(w.features), what).toEqual({ clig: '0', liga: '0' });
    // the font has the ligature (forced on, the pair is narrower by 2px or more) and the page does not draw it
    expect(w.run - w.ligated, `${what}: the ligature is narrower`).toBeGreaterThan(1);
    // "fi" and "ff" set as one run are the width of their two letters set apart (kerning changes "fl" by 0.7px, which this does not need)
    if (!what.endsWith('fl')) expect(Math.abs(w.run - w.apart), `${what}: two letters`).toBeLessThan(0.15);
  }

  // and the rule changes nothing else: the figures of a quantity stay tabular (font-variant-numeric asks the font for tnum, which a
  // font-feature-settings that does not name it leaves on), while the same figures set plainly are proportional, so the check can tell
  const figures = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap';
    document.body.appendChild(host);
    const width = (className: string, text: string): number => {
      host.innerHTML = `<span class="${className}">${text}</span>`;
      return host.firstElementChild!.getBoundingClientRect().width;
    };
    const out = { tabular: [width('mat-amount', '1111'), width('mat-amount', '8888')], plain: [width('', '1111'), width('', '8888')] };
    host.remove();
    return out;
  });
  expect(Math.abs(figures.tabular[0]! - figures.tabular[1]!), 'tabular figures').toBeLessThan(0.01);
  expect(Math.abs(figures.plain[0]! - figures.plain[1]!), 'plain figures are proportional').toBeGreaterThan(1);
});

// The World page's two file pickers draw their button in the pixel font (the small button's `font` on `::file-selector-button`), and a
// pseudo-element is not matched by `*`: the universal rule names it too (restyle plan Phase 1 Task 9, the hand-off of Task 8). A French
// browser's "Choisir un fichier" has the "fi" the font would ligate. What the browser draws for the button is its own text, so this asks what
// the page told it: the computed style of the pseudo-element.
test('the button of a file picker draws no ligature either', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');
  await page.goto('/world');
  for (const picker of ['world-folder-input', 'world-zip-input']) {
    const button = await page.getByTestId(picker).evaluate((input) => {
      const style = getComputedStyle(input, '::file-selector-button');
      return { features: style.fontFeatureSettings, family: style.fontFamily };
    });
    expect(tagsOf(button.features), picker).toEqual({ clig: '0', liga: '0' });
    expect(button.family, `${picker}: the button is the pixel font's`).toContain('Pixelify Sans');
  }
});
