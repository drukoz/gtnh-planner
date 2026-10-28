// The item slots (restyle plan Phase 1 Task 5, design spec §6): every HTML icon sits in a slot, 4 px wider and taller than its
// image, and a slot is veiled while it is pointed at; the Flow diagram's 16 px icons are not framed, since a 16 px foreignObject
// clips what overflows it. The stylesheet's contract test pins the values; only a browser can say that the cascade gives them to
// the right icons (an inline style beats the slot face, a placeholder rule out-ranks the opt-out unless it has its own) and that the
// image inside is still the size its markup asks for, which assets.spec.ts reads the pixels of.

import { test, expect, type Locator } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';

/** The opacity of the white veil over a slot, as the browser computes it. */
function veil(slot: Locator): Promise<string> {
  return slot.evaluate((el) => getComputedStyle(el, '::after').opacity);
}

test('an item in the search list sits in a slot that is veiled while its hit is highlighted', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Slots');
  const search = page.getByPlaceholder('Search items and fluids');
  await search.fill('Iron');

  // a texture from the pack (a loaded image): the image is 20px and the slot adds 2px of padding on every side
  const ingot = page.getByRole('option', { name: /Iron Ingot/ }).locator('[data-item-key="t:iron_ingot@0"]');
  await expect(ingot.locator('img')).toBeVisible();
  const slot = await ingot.boundingBox();
  const image = await ingot.locator('img').boundingBox();
  if (slot === null || image === null) throw new Error('the ingot icon has no box');
  expect([slot.width, slot.height]).toEqual([24, 24]);
  expect([image.width, image.height]).toEqual([20, 20]);
  expect(image.x - slot.x).toBeCloseTo(2, 1);
  expect(image.y - slot.y).toBeCloseTo(2, 1);
  const face = await ingot.evaluate((el) => {
    const style = getComputedStyle(el);
    return { padding: style.padding, sizing: style.boxSizing, radius: style.borderRadius, face: style.backgroundColor, bevels: style.boxShadow.split('inset').length - 1 };
  });
  expect(face).toEqual({ padding: '2px', sizing: 'content-box', radius: '0px', face: 'rgb(139, 139, 139)', bevels: 2 });

  // a plain colour (a placeholder): its own inline colour beats the slot face, and it has the bevel and a dark ring under it
  const placeholder = page.locator('.search-hit .item-icon.placeholder').first();
  await expect(placeholder).toBeVisible();
  const colours = await placeholder.evaluate((el) => ({
    shown: getComputedStyle(el).backgroundColor, inline: (el as HTMLElement).style.backgroundColor, shadows: getComputedStyle(el).boxShadow.split('inset').length - 1,
  }));
  expect(colours.shown).toBe(colours.inline);
  expect(colours.shown).not.toBe('rgb(139, 139, 139)');
  expect(colours.shadows).toBe(3);

  // the veil is lit on the highlighted hit only: the first one when the answer arrives, then the one the arrow keys or the pointer pick
  const slotOf = (n: number): Locator => page.locator('.search-hit').nth(n).locator('.item-icon');
  await expect(page.locator('.search-hit').nth(2)).toBeVisible();
  await expect.poll(() => veil(slotOf(0))).toBe('1');
  expect(await veil(slotOf(1))).toBe('0');
  await search.press('ArrowDown');
  await expect.poll(() => veil(slotOf(1))).toBe('1');
  await expect.poll(() => veil(slotOf(0))).toBe('0');
  await slotOf(2).hover();                                                              // the pointer moves the highlight
  await expect.poll(() => veil(slotOf(2))).toBe('1');
  await expect.poll(() => veil(slotOf(1))).toBe('0');
});

test('a slot in the materials list is veiled under the pointer, and sits centred on the first line of its row', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Slots tab', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 });
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  const rows = page.locator('li.mat-row');
  await expect(rows.nth(2)).toBeVisible();
  const slot = rows.first().locator('.item-icon');
  expect(await veil(slot)).toBe('0');
  await slot.hover();
  await expect.poll(() => veil(slot)).toBe('1');
  expect(await veil(rows.nth(1).locator('.item-icon'))).toBe('0');

  // the 24px slot starts 2px above the 20px line of text, so their middles are the same
  const middles = await rows.first().evaluate((row) => {
    const middle = (el: Element | null): number => {
      const box = (el as HTMLElement).getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    return { icon: middle(row.querySelector('.item-icon')), text: middle(row.querySelector('.tick-label')), caret: middle(row.querySelector('.mat-toggle')) };
  });
  expect(Math.abs(middles.icon - middles.text)).toBeLessThanOrEqual(1);
  expect(Math.abs(middles.caret - middles.text)).toBeLessThanOrEqual(1);
  // a build row's caret is a 20px button that turns down when the row opens
  const caret = page.locator('button.mat-toggle').first();
  await expect(caret).toHaveAttribute('aria-expanded', 'false');
  expect(await caret.boundingBox()).toMatchObject({ width: 20, height: 20 });
  await caret.click();
  await expect(caret).toHaveAttribute('aria-expanded', 'true');
  // its caret is a quarter turn round once the transition has run: matrix(cos, sin, -sin, cos, 0, 0) of 90 degrees
  await expect.poll(async () => {
    const turn = await caret.evaluate((el) => getComputedStyle(el, '::before').transform);
    const [a = NaN, b = NaN, c = NaN, d = NaN] = turn.replace(/^matrix\(|\)$/g, '').split(', ').map(Number);
    return [a, b, c, d].map((n) => Math.round(n));
  }).toEqual([0, 1, -1, 0]);
});

test('a row of the materials list keeps its slot level with its first line while a disclosure of it is open', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Slots disclosure', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1 });
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  // a base material's "for …" disclosure (ledger ruling P2-R44): the row's tick line sits at the top of its line, so the open disclosure
  // makes the line taller below the label; centred, the label dropped to the middle of it, away from the slot (Phase 1's Task 5 minor)
  const needed = page.locator('section[aria-labelledby="build-totals-title"] details.mat-needed').first();
  await expect(needed).toBeVisible();
  const apart = (): Promise<number> => needed.evaluate((details) => {
    const row = details.closest('li.mat-row');
    const middle = (el: Element | null | undefined): number => {
      const box = (el as HTMLElement).getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    return Math.abs(middle(row?.querySelector(':scope > .item-icon')) - middle(row?.querySelector('.tick-label')));
  });
  expect(await apart(), 'shut').toBeLessThanOrEqual(1);
  await needed.locator('summary').click();
  // its height grows over the fold (ruling R16): measured once it holds the whole of its list
  await expect.poll(() => needed.evaluate((details: HTMLDetailsElement) => {
    const list = details.querySelector('.mat-where');
    return details.open && list !== null && details.getBoundingClientRect().bottom >= list.getBoundingClientRect().bottom - 0.5;
  })).toBe(true);
  expect(await apart(), 'open').toBeLessThanOrEqual(1);
});

test('the icons of the Flow diagram stay bare 16px images, not framed slots', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  // No limit: at the default +25 % cap the line makes its plates two ways on purpose (plan.spec.ts's 4-step pin); this test
  // only needs a drawn diagram (fix wave 3 (A)).
  await createProject(page, 'Flow slots', { target: 't:circuit@0', amount: 30, per: 'min', tier: 1, rawCap: null });
  await expect(page.locator('svg [data-step-id]')).toHaveCount(3);
  const icons = page.locator('svg.flow-canvas foreignObject .item-icon');
  await expect(icons.first()).toBeVisible();
  // both kinds are in the diagram: the iron ingot's texture, once it has loaded, and a plain colour for what has none
  await expect.poll(() => icons.locator('img').count()).toBeGreaterThan(0);
  expect(await icons.filter({ hasNot: page.locator('img') }).count()).toBeGreaterThan(0);

  const measured = await page.locator('svg.flow-canvas foreignObject').evaluateAll((objects) => objects.map((object) => {
    const icon = object.querySelector('.item-icon');
    if (icon === null) return null;
    const frame = object.getBoundingClientRect();
    const box = icon.getBoundingClientRect();
    const style = getComputedStyle(icon);
    return {
      widthRatio: box.width / frame.width, heightRatio: box.height / frame.height, padding: style.padding, position: style.position,
      veil: getComputedStyle(icon, '::after').content, shadows: style.boxShadow.split('inset').length - 1, loaded: icon.querySelector('img') !== null,
    };
  }));
  const found = measured.filter((m) => m !== null);
  expect(found.length).toBeGreaterThan(0);
  for (const m of found) {
    // it fills its 16px frame exactly: a framed one would be 20px and the foreignObject would cut it
    expect(m.widthRatio).toBeCloseTo(1, 2);
    expect(m.heightRatio).toBeCloseTo(1, 2);
    expect(m.padding).toBe('0px');
    expect(m.position).toBe('static');
    expect(m.veil, 'no veil is drawn over a diagram icon').toBe('none');
    // a texture has no edge at all; a placeholder has the thin one it had before the slots, not the 2px bevel and the ring
    expect(m.shadows).toBe(m.loaded ? 0 : 1);
  }
});
