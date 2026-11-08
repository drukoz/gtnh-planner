// The recipe browser's popup (RUK-740 task 8): the dialog as static markup — its title, tabs, notes, cards, slots, badges, paging and
// buttons, the loading line and the failure. The dialog fetches nothing, so every render here is one state drawn whole.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowserLoad, RecipeBrowserDialog, type BrowserState } from '../../src/client/components/RecipeBrowser.tsx';
import { packList, planList } from '../../src/client/views/recipe-browser-model.ts';
import { RecipeMode } from '../../src/client/state/recipe-request.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { RecipeSummary, StuffInfo } from '../../src/shared/types/api.ts';
import type { LeafClass, Plan, PlanSettings, PlanStep, Product, RawInput } from '../../src/shared/types/plan.ts';

// The board line and fixtures of the model's test, cut to the point: wire from a bought ingot, a line that buys glue.
const H = 3600;
const per = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
const raw = (key: string, perSecond: number, leafClass: LeafClass): RawInput => ({ key, perSecond, cost: perSecond, available: true, sources: [], leafClass });
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), ...p });
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 2, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 2, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const mv = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.test', machine: { mteId: 200, name: 'Advanced Machine', tier: 2 }, count: 1, owned: 0, runsPerSecond: 1 / H,
  utilization: 0.001, euPerTick: 28, durationTicks: 80, overclocks: 1, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [], ...p,
});
const WIRE = 't:copper_wire@0';
const INGOT = 't:copper_ingot@0';
const TIN = 't:tin_ingot@0';
const GLUE = 'fluid:glue';
const BOARD = 't:board@0';

const names = {
  [WIRE]: '1x Copper Wire', [INGOT]: 'Copper Ingot', [TIN]: 'Tin Ingot', [GLUE]: 'Glue', [BOARD]: 'Circuit Board',
  'map:gt.recipe.wiremill': 'Wiremill', 'map:gt.recipe.extruder': 'Circuit Extruder',
};
const alts: PlanStep['alternatives'] = [
  { recipeId: 'mill', rawCost: 12.5, mapId: 'gt.recipe.wiremill', inputs: [{ key: INGOT, amount: 1 }], outputs: [{ key: WIRE, amount: 2 }] },
  {
    recipeId: 'ext', rawCost: 20, mapId: 'gt.recipe.extruder',
    inputs: [{ key: INGOT, amount: 1, options: [{ key: INGOT, amount: 1 }, { key: TIN, amount: 1 }] }],
    outputs: [{ key: WIRE, amount: 4 }], unusable: ['needs MV (your tier is LV)'],
  },
] as PlanStep['alternatives'];
const mill = mv({
  id: 'mill', mainOutput: WIRE, mapId: 'gt.recipe.wiremill', machine: { mteId: 352, name: 'Advanced Wiremill', tier: 2 },
  inputs: [per(INGOT, 1)], outputs: [per(WIRE, 2)], alternatives: alts,
});
const line = planOf({ target: BOARD, targetPerSecond: 1 / H, names, steps: [mill], rawInputs: [raw(INGOT, 1 / H, 'derived')] });
const buys = planOf({
  target: BOARD, targetPerSecond: 1 / H, names,
  steps: [mill, mv({ id: 'mix', mapId: 'gt.recipe.mixer' })], rawInputs: [raw(GLUE, 1 / H, 'derived')],
});
const summary = (p: Partial<RecipeSummary> & Pick<RecipeSummary, 'id'>): RecipeSummary => ({
  source: 'gt', maps: ['gt.recipe.wiremill'], machineName: 'Wiremill', tier: 1, euPerTick: 30, durationTicks: 100, inputs: [], outputs: [], ...p,
});
const stuff = (p: Partial<StuffInfo> & Pick<StuffInfo, 'key'>): StuffInfo => ({ name: 'Glue', producers: [], consumers: [], ...p });
const alts7: PlanStep['alternatives'] = Array.from({ length: 7 }, (_, i) => ({
  recipeId: `p${i + 1}`, rawCost: 10 + i, mapId: 'gt.recipe.wiremill',
  inputs: [{ key: INGOT, amount: 1 }], outputs: [{ key: WIRE, amount: 2 }],
}));
const seven = planOf({
  target: BOARD, targetPerSecond: 1 / H, names,
  steps: [mv({ id: 'p1', mainOutput: WIRE, mapId: 'gt.recipe.wiremill', inputs: [per(INGOT, 1)], outputs: [per(WIRE, 2)], alternatives: alts7 })],
  rawInputs: [],
});

const render = (state: BrowserState, mode: RecipeMode, settings: PlanSettings = S()): string =>
  renderToStaticMarkup(
    <RecipeBrowserDialog
      good={state.load === BrowserLoad.Ready ? state.list.good : WIRE}
      name={state.load === BrowserLoad.Ready ? state.list.name : '1x Copper Wire'}
      mode={mode} state={state} settings={settings}
      onMode={() => {}} onPatch={() => {}} onClose={() => {}}
    />,
  );
const ready = (list: ReturnType<typeof planList>): BrowserState => {
  if (list === null) throw new Error('no list');
  return { load: BrowserLoad.Ready, list };
};
/** One card's markup: from its marker to the next card's, or to the end of the dialog for the last. */
const cardHtml = (html: string, id: string): string => {
  const at = html.indexOf(`data-recipe-id="${id}"`);
  expect(at, `card ${id}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-recipe-id="', at + 1);
  return next === -1 ? html.slice(at) : html.slice(at, next);
};
const cardsOf = (html: string): number => (html.match(/data-recipe-id="/g) ?? []).length;

describe('RecipeBrowserDialog', () => {
  it('titles, tabs and lists the plan of a made good, as the model put them', () => {
    const html = render(ready(planList(line, S(), WIRE)), RecipeMode.Recipes);
    expect(html).toContain('>Recipes for 1x Copper Wire</h2>');
    expect(html).toContain('aria-pressed="true">Recipes (R)');
    expect(html).toContain('aria-pressed="false">Uses (U)');
    expect([...html.matchAll(/data-recipe-id="([^"]+)"/g)].map((m) => m[1])).toEqual(['mill', 'ext']);
    const millCard = cardHtml(html, 'mill');
    expect(millCard).toContain('Wiremill');
    expect(millCard).toContain('<span class="badge">in use</span>');
    expect(millCard).toContain('Use this recipe');
    expect(millCard).toContain('class="stack-count"');   // 2× of the wire, as Minecraft counts it
    const extCard = cardHtml(html, 'ext');
    expect(html).toContain('<li class="browser-card unusable" data-recipe-id="ext">');
    expect(extCard).toContain('Not usable: needs MV (your tier is LV)');
    expect(extCard).not.toContain('Use this recipe');
    expect(html).toContain('Let the planner choose');
    expect(html).toContain('Import it instead');
  });

  it('names an ore-dictionary slot with its other options', () => {
    const html = render(ready(planList(line, S(), WIRE)), RecipeMode.Recipes);
    expect(cardHtml(html, 'ext')).toContain('aria-label="Copper Ingot, or Tin Ingot"');
  });

  it('marks the pinned card', () => {
    const html = render(ready(planList(line, S({ recipeChoice: { [WIRE]: 'ext' } }), WIRE)), RecipeMode.Recipes);
    expect(cardHtml(html, 'ext')).toContain('<span class="badge">pinned</span>');
    expect(cardHtml(html, 'mill')).not.toContain('pinned');
  });

  it('pages the cards at five and shows the pinned one among the first', () => {
    const html = render(ready(planList(seven, S(), WIRE)), RecipeMode.Recipes);
    expect(cardsOf(html)).toBe(5);
    expect(html).toContain('<span class="fig">2</span> more…');
    const pinned = render(ready(planList(seven, S({ recipeChoice: { [WIRE]: 'p7' } }), WIRE)), RecipeMode.Recipes);
    expect(cardsOf(pinned)).toBe(6);   // the first five and the pinned one, and p7 stands where the server put it
    expect(cardHtml(pinned, 'p7')).toContain('pinned');
    expect(pinned).toContain('<span class="fig">1</span> more…');
  });

  it('offers making a bought good with a card, and no whole-list buttons', () => {
    const list = packList(
      stuff({ key: GLUE, producers: [summary({ id: 'mix', outputs: [{ key: GLUE, name: 'Glue', amount: 1, chance: 0.25 }] })] }),
      buys, S(), RecipeMode.Recipes,
    );
    const html = render(ready(list), RecipeMode.Recipes);
    expect(html).toContain('The line buys Glue. Make it with one of these recipes instead:');
    expect(cardHtml(html, 'mix')).toContain('Make it with this recipe');
    expect(html).not.toContain('Let the planner choose');
    expect(html).not.toContain('Import it instead');
  });

  it('keeps a uses list read only', () => {
    const list = packList(stuff({ key: GLUE, consumers: [summary({ id: 'asm', inputs: [{ key: WIRE, name: '1x Copper Wire', amount: 1, consumed: true }] })] }), buys, S(), RecipeMode.Uses);
    const html = render(ready(list), RecipeMode.Uses);
    expect(html).toContain('>Uses of Glue</h2>');
    expect(html).toContain('What uses Glue');
    expect(html).toContain('aria-pressed="true">Uses (U)');
    expect((html.match(/<button/g) ?? []).length, 'the two tabs and Close, and nothing else').toBe(3);
  });

  it('tags a slot with its chance and says what a run keeps', () => {
    const made = render(
      ready(packList(stuff({ key: GLUE, producers: [summary({ id: 'mix', outputs: [{ key: GLUE, name: 'Glue', amount: 1, chance: 0.25 }] })] }), buys, S(), RecipeMode.Recipes)),
      RecipeMode.Recipes,
    );
    expect(made).toContain('class="slot-chance"');
    expect(made).toContain('25% chance');
    const used = render(
      ready(packList(stuff({ key: GLUE, consumers: [summary({ id: 'asm', inputs: [{ key: WIRE, name: '1x Copper Wire', amount: 1, consumed: false }] })] }), buys, S(), RecipeMode.Uses)),
      RecipeMode.Uses,
    );
    expect(used).toContain('aria-label="1x Copper Wire, not used up"');
  });

  it('says when the list is loading and when it failed', () => {
    expect(render({ load: BrowserLoad.Loading }, RecipeMode.Recipes)).toContain('Loading recipes…');
    const failed = render({ load: BrowserLoad.Failed, message: 'boom' }, RecipeMode.Recipes);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Could not load the recipes: boom');
    expect(failed).toContain('aria-pressed="true">Recipes (R)');   // the tabs stand while the list failed
  });
});
