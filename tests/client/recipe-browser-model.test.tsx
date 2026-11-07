// The recipe browser's popup model (RUK-740, RUK-T4): the plan's alternatives and the pack's producer and consumer
// recipes as cards, what the popup calls them, which button they get and which settings patch that button sends.

import { describe, expect, it } from 'vitest';
import {
  BrowserAction, cardPatch, focusGood, importPatch, makeWithPatch, needsPack, packList, planList, plannerChoosesPatch,
} from '../../src/client/views/recipe-browser-model.ts';
import { RecipeMode } from '../../src/client/state/recipe-request.ts';
import type { FlowEdge, FlowNode, Focus } from '../../src/client/views/flow-model.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { RecipeSummary, StuffInfo } from '../../src/shared/types/api.ts';
import type { LeafClass, Plan, PlanSettings, PlanStep, Product, RawInput } from '../../src/shared/types/plan.ts';

// A board line (the flow test's, cut to the point): wire from a bought ingot, a mixer the pack says makes glue.
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
];
const mill = mv({
  id: 'mill', mainOutput: WIRE, mapId: 'gt.recipe.wiremill', machine: { mteId: 352, name: 'Advanced Wiremill', tier: 2 },
  inputs: [per(INGOT, 1)], outputs: [per(WIRE, 2)], alternatives: alts,
});
const line = planOf({ target: BOARD, targetPerSecond: 1 / H, names, steps: [mill], rawInputs: [raw(INGOT, 1 / H, 'derived')] });
// The same line buying glue (the mixer's good) instead of nothing, and one whose glue comes from a capped farm supply.
const buys = planOf({
  target: BOARD, targetPerSecond: 1 / H, names,
  steps: [mill, mv({ id: 'mix', mapId: 'gt.recipe.mixer' })], rawInputs: [raw(GLUE, 1 / H, 'derived')],
});
const capped = planOf({
  target: BOARD, targetPerSecond: 1 / H, names, steps: [mill],
  rawInputs: [{ ...raw(GLUE, 1 / H, 'free'), from: { kind: 'farm', id: 'f1', name: 'Tree Farm' } }],
});
const summary = (p: Partial<RecipeSummary> & Pick<RecipeSummary, 'id'>): RecipeSummary => ({
  source: 'gt', maps: ['gt.recipe.mixer'], machineName: 'Mixer', tier: 1, euPerTick: 30, durationTicks: 100, inputs: [], outputs: [], ...p,
});
const stuff = (p: Partial<StuffInfo> & Pick<StuffInfo, 'key'>): StuffInfo => ({ name: 'Glue', producers: [], consumers: [], ...p });

describe('planList', () => {
  it('shows the plan alternatives of a made good, in order, marked', () => {
    const list = planList(line, S(), WIRE)!;
    expect([list.mode, list.action, list.note, list.name, list.canImport]).toEqual([RecipeMode.Recipes, BrowserAction.Pin, null, '1x Copper Wire', true]);
    expect(list.good).toBe(WIRE);
    expect(list.cards.map((c) => c.recipeId)).toEqual(['mill', 'ext']);
    const a = list.cards[0]!;
    const b = list.cards[1]!;
    expect([a.machine, a.facts, a.inUse, a.pinned]).toEqual(['Wiremill', '12.5 raw/unit', true, false]);
    expect(a.inputs).toEqual([{ key: INGOT, name: 'Copper Ingot', amount: 1, fluid: false }]);
    expect(a.outputs).toEqual([{ key: WIRE, name: '1x Copper Wire', amount: 2, fluid: false }]);
    expect([b.machine, b.facts]).toEqual(['Circuit Extruder', '20 raw/unit']);
    expect(b.unusable).toEqual(['needs MV (your tier is LV)']);
    expect(b.inputs[0]!.others).toEqual(['Tin Ingot']);
  });

  it('marks the recipe the settings pin for the good', () => {
    expect(planList(line, S({ recipeChoice: { [WIRE]: 'ext' } }), WIRE)!.cards.map((c) => c.pinned)).toEqual([false, true]);
  });

  it('marks a recipe in use when any step of that good runs it', () => {
    const two = planOf({ target: BOARD, targetPerSecond: 1 / H, names, steps: [mill, mv({ id: 'ext', mainOutput: WIRE, alternatives: alts })], rawInputs: [] });
    expect(planList(two, S(), WIRE)!.cards.map((c) => [c.recipeId, c.inUse])).toEqual([['mill', true], ['ext', true]]);
  });

  it('is null for a good no step makes, which sends the popup to the pack', () => {
    expect(planList(line, S(), BOARD)).toBeNull();
    expect(needsPack(line, WIRE, RecipeMode.Recipes)).toBe(false);
    expect(needsPack(line, BOARD, RecipeMode.Recipes)).toBe(true);
    expect(needsPack(line, WIRE, RecipeMode.Uses)).toBe(true);
    expect(needsPack(line, 't:nothing@0', RecipeMode.Uses)).toBe(true);
  });

  it('offers import except for the line target itself', () => {
    expect(planList(line, S({ target: WIRE }), WIRE)!.canImport).toBe(false);
    expect(planList(line, S({ target: BOARD }), WIRE)!.canImport).toBe(true);
  });
});

describe('packList', () => {
  it('says what the list is and which button its cards get', () => {
    const made = packList(stuff({ key: GLUE, producers: [summary({ id: 'mix' })] }), buys, S(), RecipeMode.Recipes);
    expect([made.mode, made.good, made.name, made.canImport]).toEqual([RecipeMode.Recipes, GLUE, 'Glue', false]);
    expect(made.action).toBe(BrowserAction.Make);
    expect(made.note).toBe('The line buys Glue. Make it with one of these recipes instead:');
    const madeFree = packList(stuff({ key: GLUE, producers: [summary({ id: 'mix' })] }), line, S(), RecipeMode.Recipes);
    expect(madeFree.action).toBe(BrowserAction.None);
    expect(madeFree.note).toBe("Nothing in this line makes Glue on purpose. The pack's recipes for it:");
    const supplied = packList(stuff({ key: GLUE, producers: [summary({ id: 'mix' })] }), capped, S(), RecipeMode.Recipes);
    expect(supplied.action).toBe(BrowserAction.None);
    const uses = packList(stuff({ key: GLUE, consumers: [summary({ id: 'asm' })] }), buys, S(), RecipeMode.Uses);
    expect(uses.mode).toBe(RecipeMode.Uses);
    expect(uses.action).toBe(BrowserAction.None);
    expect(uses.note).toBe('What uses Glue');
  });

  it('says so when the pack has none, and marks a list cut at fifty', () => {
    expect(packList(stuff({ key: GLUE }), buys, S(), RecipeMode.Recipes).note).toBe('Nothing in this pack makes Glue.');
    expect(packList(stuff({ key: GLUE }), buys, S(), RecipeMode.Uses).note).toBe('Nothing in this pack uses Glue.');
    const many = Array.from({ length: 50 }, (_, i): RecipeSummary => summary({ id: `c${i}` }));
    expect(packList(stuff({ key: GLUE, consumers: many }), buys, S(), RecipeMode.Uses).note).toBe('What uses Glue (the first 50)');
  });

  it('writes a pack card facts and slots as the popup reads them', () => {
    const rich = summary({
      id: 'mix',
      inputs: [
        { key: INGOT, name: 'Copper Ingot', amount: 1, consumed: true },
        { key: 't:lens@0', name: 'Lens', amount: 1, consumed: false },
        { key: 't:ingot@0', name: 'Ingot', amount: 1, consumed: true, options: [{ key: INGOT, name: 'Copper Ingot', amount: 1 }, { key: TIN, name: 'Tin Ingot', amount: 1 }] },
      ],
      outputs: [
        { key: GLUE, name: 'Glue', amount: 100, chance: 1 },
        { key: 't:copper_dust@0', name: 'Copper Dust', amount: 1, chance: 0.25 },
        { key: 'fluid:water', name: 'Water', amount: 10, chance: 1 },
      ],
    });
    const card = packList(stuff({ key: GLUE, producers: [rich] }), buys, S({ recipeChoice: { [GLUE]: 'mix' } }), RecipeMode.Recipes).cards[0]!;
    expect(card.machine).toBe('Mixer');
    expect(card.facts).toBe('LV · 30 EU/t · 5 s');
    expect(card.inUse).toBe(true);
    expect(card.pinned).toBe(true);
    expect(card.inputs[0]!.kept).toBeUndefined();
    expect(card.inputs[1]!.kept).toBe(true);
    expect(card.inputs[2]!.others).toEqual(['Tin Ingot']);
    expect(card.outputs[0]!.chance).toBeUndefined();
    expect(card.outputs[1]!.chance).toBe(0.25);
    expect(card.outputs[2]!.fluid).toBe(true);
  });

  it('leaves a crafting recipe facts empty and marks a display-only recipe', () => {
    const craft = summary({ id: 'craft', source: 'crafting', machineName: 'Crafting Table', tier: 0, euPerTick: 0, durationTicks: 0 });
    const card = packList(stuff({ key: GLUE, producers: [craft, summary({ id: 'fake', fake: true })] }), buys, S(), RecipeMode.Recipes).cards;
    expect(card[0]!.facts).toBe('');
    expect(card[0]!.fake).toBeUndefined();
    expect(card[1]!.fake).toBe(true);
  });
});

describe('patches', () => {
  const settings = S({
    target: BOARD, expandItems: ['t:plate@0'], stopItems: [GLUE, 't:redstone@0'], recipeChoice: { [BOARD]: 'c1', [GLUE]: 'old' },
  });

  it('makeWithPatch pins a bought good to a recipe and asks the line to make it', () => {
    expect(makeWithPatch(settings, GLUE, 'mix9')).toEqual({
      expandItems: [GLUE, 't:plate@0'],
      stopItems: ['t:redstone@0'],
      recipeChoice: { [BOARD]: 'c1', [GLUE]: 'mix9' },
    });
  });

  it('a card button sends its list patch, and a read-only card sends none', () => {
    const made = packList(stuff({ key: GLUE, producers: [summary({ id: 'mix9' })] }), buys, settings, RecipeMode.Recipes);
    expect(cardPatch(made, settings, 'mix9')).toEqual(makeWithPatch(settings, GLUE, 'mix9'));
    const uses = packList(stuff({ key: GLUE, consumers: [summary({ id: 'asm' })] }), buys, settings, RecipeMode.Uses);
    expect(cardPatch(uses, settings, 'asm')).toBeNull();
    const wire = planList(line, settings, WIRE)!;
    expect(cardPatch(wire, settings, 'ext')).toEqual({ recipeChoice: { [BOARD]: 'c1', [GLUE]: 'old', [WIRE]: 'ext' } });
  });

  it('let-the-planner-choose drops the pin and import stops buying', () => {
    expect(plannerChoosesPatch(settings, GLUE)).toEqual({ recipeChoice: { [BOARD]: 'c1' } });
    expect(importPatch(settings, WIRE)).toEqual({ stopItems: [GLUE, WIRE, 't:redstone@0'] });
  });
});

describe('focusGood', () => {
  const graph = {
    nodes: [{ id: 'mill', key: WIRE } as FlowNode, { id: 'out', key: null } as FlowNode],
    edges: [{ id: 'e1', key: GLUE } as FlowEdge],
  };
  const f = (x: Focus) => focusGood(graph, x);

  it('reads the good off an item, a box and an arrow, and null of the rest', () => {
    expect(f(null)).toBeNull();
    expect(f({ kind: 'item', key: GLUE })).toBe(GLUE);
    expect(f({ kind: 'node', id: 'mill' })).toBe(WIRE);
    expect(f({ kind: 'node', id: 'out' })).toBeNull();
    expect(f({ kind: 'node', id: 'nope' })).toBeNull();
    expect(f({ kind: 'edge', id: 'e1' })).toBe(GLUE);
    expect(f({ kind: 'edge', id: 'nope' })).toBeNull();
  });
});
