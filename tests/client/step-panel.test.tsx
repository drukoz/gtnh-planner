import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortsSection, RawPanel, StepPanel, shownWays } from '../../src/client/views/StepPanel.tsx';
import { haveSupplyPatch, importInsteadPatch, makeHerePatch, optionPatch, useOnlyPatch } from '../../src/client/views/flow-model.ts';
import { getFlowFocus, setFlowFocus } from '../../src/client/state/flow-focus.ts';
import { defaultSettings, validateOp } from '../../src/shared/project/apply-op.ts';
import type { Plan, PlanSettings, PlanStep, RawInput } from '../../src/shared/types/plan.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

/** The text of an unrendered element's children (strings and numbers only). */
function childText(e: ReactElement<Record<string, unknown>>): string {
  const kids = e.props.children as ReactNode;
  return (Array.isArray(kids) ? kids : [kids]).filter((k) => typeof k === 'string' || typeof k === 'number').join('');
}

const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), ...p });
const step = (p: Partial<PlanStep> & Pick<PlanStep, 'id'>): PlanStep => ({
  recipeId: p.id, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, count: 1, owned: 0,
  runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [], alternatives: [],
  handCraft: false, warnings: [], ...p,
});
const raw = (p: Partial<RawInput> & Pick<RawInput, 'key'>): RawInput => ({ perSecond: 0.25, cost: 0.25, available: true, sources: [], ...p });
const planOf = (p: Partial<Plan>): Plan => ({
  settingsHash: 'h', exportId: 'e', tier: 1, reachable: [], unlocks: [], steps: [], flows: [], rawInputs: [], byproducts: [],
  power: { peakEUt: 0, averageEUt: 0, voltageTier: 1, amps: 0 }, buildList: [], buildSteps: [], warnings: [], status: 'ok', ...p,
});
const panelHtml = (s: PlanStep, plan: Plan, settings = S()): string => renderToStaticMarkup(
  <StepPanel step={s} plan={plan} settings={settings} send={() => {}} onClose={() => {}} per="min" />);
const panel = (s: PlanStep, plan: Plan, settings = S()): string => text(panelHtml(s, plan, settings));

// A wiremill feeding an assembler: what each takes and makes, and from or to whom.
const wire = step({
  id: 'wire', mapId: 'gt.recipe.wiremill', machine: { mteId: 351, name: 'Wiremill', tier: 1 }, runsPerSecond: 0.25, mainOutput: 't:copper_wire@0',
  inputs: [{ key: 't:copper_ingot@0', amount: 1, chance: 1 }], outputs: [{ key: 't:copper_wire@0', amount: 2, chance: 1 }],
});
const asm = step({
  id: 'asm', runsPerSecond: 0.5, mainOutput: 't:circuit@0',
  inputs: [{ key: 't:copper_wire@0', amount: 1, chance: 1 }], outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }],
});
const wires = planOf({
  steps: [wire, asm], target: 't:circuit@0',
  names: { 't:copper_ingot@0': 'Copper Ingot', 't:copper_wire@0': '1x Copper Wire', 't:circuit@0': 'Basic Circuit' },
  flows: [{ from: 'raw', to: 'wire', key: 't:copper_ingot@0', perSecond: 0.25 }, { from: 'wire', to: 'asm', key: 't:copper_wire@0', perSecond: 0.5 },
    { from: 'asm', to: 'out', key: 't:circuit@0', perSecond: 0.5 }],
  rawInputs: [raw({ key: 't:copper_ingot@0', leafClass: 'direct', canMake: false })],
});

afterEach(() => { setFlowFocus(null); vi.unstubAllGlobals(); });

describe('step panel: takes and makes', () => {
  it('names where each input comes from and where each output goes', () => {
    const takes = panel(asm, wires);
    expect(takes).toContain('Takes');
    expect(takes).toContain('from Wiremill (1x Copper Wire) 30/min');
    expect(takes).toContain('to the target 30/min');
    const makes = panel(wire, wires);
    expect(makes).toContain('Makes');
    expect(makes).toContain('to Basic Assembler (Basic Circuit) 30/min');
    expect(makes).toContain('from import (mined) 15/min');
    expect(panel(wire, wires)).toContain('Wiremill');                     // the header is the machine
    expect(panelHtml(wire, wires)).toMatch(/<h3>Wiremill<\/h3>/);
  });
  it('leaves out a good the step takes and hands back in full', () => {
    const fill = step({ id: 'fill', mainOutput: 't:x@0', inputs: [{ key: 't:cell@0', amount: 1, chance: 1 }, { key: 't:copper_ingot@0', amount: 1, chance: 1 }],
      outputs: [{ key: 't:cell@0', amount: 1, chance: 1 }, { key: 't:x@0', amount: 1, chance: 1 }] });
    const handsBack = planOf({ steps: [fill], names: { 't:cell@0': 'Empty Cell', 't:x@0': 'X', 't:copper_ingot@0': 'Copper Ingot' },
      flows: [{ from: 'raw', to: 'fill', key: 't:copper_ingot@0', perSecond: 0.5 }, { from: 'fill', to: 'out', key: 't:x@0', perSecond: 0.5 }] });
    const html = panelHtml(fill, handsBack);
    expect(html).not.toContain('data-port-key="t:cell@0"');
    expect(html).toContain('data-port-key="t:x@0"');
    expect(html).toContain('data-port-key="t:copper_ingot@0"');
    expect(text(html)).not.toMatch(/(?<![\d.,])0\/min/);
  });
  it('marks an input the plan does not supply', () => {
    const short = planOf({ ...wires, flows: wires.flows.filter((f) => f.from !== 'wire') });
    const html = panelHtml(asm, short);
    expect(text(html)).toContain('nothing supplies it');
    expect(html).toMatch(/class="[^"]*port-short[^"]*"/);
  });
  it('selects a peer step on click and lights the item while the row is hovered', () => {
    const onSelect = vi.fn();
    const ports = PortsSection({ step: asm, plan: wires, per: 'min', onSelect });
    const [peer] = findAll(ports, (e) => e.type === 'button' && childText(e) === 'Wiremill (1x Copper Wire)');
    (peer!.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith('wire');
    const [row] = findAll(ports, (e) => e.props['data-port-key'] === 't:copper_wire@0');
    setFlowFocus({ kind: 'node', id: 'wire' });
    (row!.props.onMouseEnter as () => void)();
    expect(getFlowFocus()).toEqual({ kind: 'item', key: 't:copper_wire@0' });
    (row!.props.onMouseLeave as () => void)();
    expect(getFlowFocus()).toEqual({ kind: 'node', id: 'wire' });   // what was lit before the hover
  });
});

describe('step panel: sections', () => {
  it('shows who else makes its product and pins this recipe for it', () => {
    const plate = (id: string, name: string, runsPerSecond: number): PlanStep => step({
      id, machine: { mteId: id.length, name, tier: 1 }, runsPerSecond, mainOutput: 't:iron_plate@0',
      inputs: [{ key: 't:iron_ingot@0', amount: 1, chance: 1 }], outputs: [{ key: 't:iron_plate@0', amount: 1, chance: 1 }],
    });
    const bend = plate('bend', 'Bending Machine', 0.9);
    const casing = step({ id: 'casing', runsPerSecond: 1, mainOutput: 't:casing@0', inputs: [{ key: 't:iron_plate@0', amount: 1, chance: 1 }],
      outputs: [{ key: 't:casing@0', amount: 1, chance: 1 }] });
    const plates = planOf({
      steps: [bend, plate('press', 'Forge Hammer', 0.1), casing],
      names: { 't:iron_ingot@0': 'Iron Ingot', 't:iron_plate@0': 'Iron Plate', 't:casing@0': 'Casing' },
      flows: [{ from: 'raw', to: 'bend', key: 't:iron_ingot@0', perSecond: 0.9 }, { from: 'raw', to: 'press', key: 't:iron_ingot@0', perSecond: 0.1 },
        { from: 'bend', to: 'casing', key: 't:iron_plate@0', perSecond: 0.9 }, { from: 'press', to: 'casing', key: 't:iron_plate@0', perSecond: 0.1 },
        { from: 'casing', to: 'out', key: 't:casing@0', perSecond: 1 }],
      rawInputs: [raw({ key: 't:iron_ingot@0', perSecond: 1, leafClass: 'direct' })],
    });
    const html = panel(bend, plates);
    expect(html).toContain('Also made by');
    expect(html).toContain('Forge Hammer makes 10% of Iron Plate (from imported Iron Ingot)');
    expect(html).toContain('This step makes 90%');
    expect(html).toContain('Use only this recipe for Iron Plate');
    expect(panel(casing, plates)).not.toContain('Also made by');
  });
  it('explains the ingredient option it chose and lets the group pin another', () => {
    const ca = step({
      id: 'ca', mapId: 'gt.recipe.circuitassembler', machine: { mteId: 1180, name: 'Circuit Assembler', tier: 1 }, runsPerSecond: 0.1, mainOutput: 't:ec@0',
      inputs: [{ key: 't:part@0', amount: 1, chance: 1 }, { key: 'fluid:molten.solderingalloy', amount: 72, chance: 1 }],
      outputs: [{ key: 't:ec@0', amount: 1, chance: 1 }],
      options: [{ slot: 100, choices: [
        { key: 'fluid:molten.solderingalloy', amount: 72, share: 1, rawPerRun: 0.5, steps: 2, via: ['Alloy Smelter', 'Fluid Extractor'] },
        { key: 'fluid:molten.tin', amount: 144, share: 0, rawPerRun: 1, steps: 1, via: ['Fluid Extractor'] },
        { key: 'fluid:molten.lead', amount: 288, share: 0, rawPerRun: 2, steps: 1, via: ['Fluid Extractor'], unusable: ['needs MV (your tier is LV)'] },
      ] }],
    });
    const circuits = planOf({ steps: [ca], names: { 't:ec@0': 'Electronic Circuit', 't:part@0': 'Part', 'fluid:molten.solderingalloy': 'Molten Soldering Alloy',
      'fluid:molten.tin': 'Molten Tin', 'fluid:molten.lead': 'Molten Lead' } });
    const html = panelHtml(ca, circuits);
    expect(text(html)).toContain('Molten Soldering Alloy chosen: 0.50 raw per circuit vs 1.00 for Molten Tin; needs Alloy Smelter + Fluid Extractor');
    for (const row of ['72 L Molten Soldering Alloy', '0.50 raw per run, 2 extra steps (via Alloy Smelter, Fluid Extractor)', '144 L Molten Tin',
      '1.00 raw per run, 1 extra step (via Fluid Extractor)', 'not used by this plan', '288 L Molten Lead', 'needs MV (your tier is LV)', 'Let the planner choose']) {
      expect(text(html)).toContain(row);
    }
    const slot = /<fieldset[^>]*data-slot="100"[^>]*>.*?<\/fieldset>/s.exec(html)?.[0] ?? '';
    expect(slot.match(/<input type="radio"/g)).toHaveLength(3);          // let the planner choose, solder, tin: lead cannot be had at LV
    expect(slot).toMatch(/<input type="radio"[^>]*checked=""[^>]*>Let the planner choose/);
    // A pin the plan honours: its radio is the checked one and the line says so.
    const pinned = { ...ca, options: [{ slot: 100, pinned: 'fluid:molten.tin', choices: ca.options![0]!.choices.map((c) => ({ ...c, share: c.key === 'fluid:molten.tin' ? 1 : 0 })) }] };
    const pinnedHtml = panelHtml(pinned, { ...circuits, steps: [pinned] }, S({ optionChoice: { 'ca#100': 'fluid:molten.tin' } }));
    expect(text(pinnedHtml)).toContain('Molten Tin pinned: 1.00 raw per circuit vs 0.50 for Molten Soldering Alloy; needs Fluid Extractor');
    expect(pinnedHtml).toMatch(/<input type="radio"[^>]*checked=""[^>]*><span[^>]*>144 L Molten Tin/);
    expect(text(pinnedHtml)).not.toContain('is not usable now');
  });
  it('says a pinned option is not usable only when the plan cannot use it, not while the next plan is on its way', () => {
    // The project store applies the pin at once; the plan that honours it (`slot.pinned`) comes seconds later.
    const choices = [
      { key: 'fluid:molten.solderingalloy', amount: 72, share: 1, rawPerRun: 0.5, steps: 2 },
      { key: 'fluid:molten.tin', amount: 144, share: 0, rawPerRun: 1, steps: 1 },
      { key: 'fluid:molten.lead', amount: 288, share: 0, rawPerRun: 2, steps: 1, unusable: ['needs MV (your tier is LV)'] },
    ];
    const ca = step({
      id: 'ca', mapId: 'gt.recipe.circuitassembler', machine: { mteId: 1180, name: 'Circuit Assembler', tier: 1 }, runsPerSecond: 0.1, mainOutput: 't:ec@0',
      inputs: [{ key: 't:part@0', amount: 1, chance: 1 }, { key: 'fluid:molten.solderingalloy', amount: 72, chance: 1 }],
      outputs: [{ key: 't:ec@0', amount: 1, chance: 1 }], options: [{ slot: 100, choices }],
    });
    const circuits = planOf({ steps: [ca], names: { 't:ec@0': 'Electronic Circuit', 't:part@0': 'Part', 'fluid:molten.solderingalloy': 'Molten Soldering Alloy',
      'fluid:molten.tin': 'Molten Tin', 'fluid:molten.lead': 'Molten Lead', 'fluid:molten.bismuth': 'Molten Bismuth' } });
    const pinning = (key: string): string => panelHtml(ca, circuits, S({ optionChoice: { 'ca#100': key } }));
    // Tin just pinned, the plan still the one before: its radio is checked, and nothing says the pin failed.
    const waiting = pinning('fluid:molten.tin');
    expect(waiting).toMatch(/<input type="radio"[^>]*checked=""[^>]*><span[^>]*>144 L Molten Tin/);
    expect(text(waiting)).not.toContain('is not usable now');
    expect(text(waiting)).toContain('Molten Soldering Alloy chosen');
    // A pin the group cannot get here, or one the slot no longer offers (an option on the avoid list), is not usable.
    expect(text(pinning('fluid:molten.lead'))).toContain('The pinned option Molten Lead is not usable now, so the planner chose another.');
    expect(text(pinning('fluid:molten.bismuth'))).toContain('The pinned option Molten Bismuth is not usable now, so the planner chose another.');
  });
  it('offers to count a free input as supplied, but only one the plan consumes', () => {
    const rock = (supply: string): PlanStep => step({ id: 'rock', machine: { mteId: 3, name: 'Basic Rock Breaker', tier: 1 }, supply, mainOutput: supply,
      outputs: [{ key: supply, amount: 1, chance: 1 }] });
    const mill = (good: string): PlanStep => step({ id: 'mill', mainOutput: 't:gravel@0', inputs: [{ key: good, amount: 1, chance: 1 }], outputs: [{ key: 't:gravel@0', amount: 1, chance: 1 }] });
    const line = (good: string): Plan => planOf({ steps: [rock(good), mill(good)],
      names: { 'minecraft:cobblestone@0': 'Cobblestone', 'minecraft:stone@0': 'Stone', 't:gravel@0': 'Gravel' },
      flows: [{ from: 'rock', to: 'mill', key: good, perSecond: 0.5 }, { from: 'mill', to: 'out', key: 't:gravel@0', perSecond: 0.5 }] });
    const cobble = panel(rock('minecraft:cobblestone@0'), line('minecraft:cobblestone@0'));
    expect(cobble).toContain('Supplies Cobblestone for this line');
    expect(cobble).toContain('We already have a supply of Cobblestone');
    const stone = panel(rock('minecraft:stone@0'), line('minecraft:stone@0'));
    expect(stone).toContain('Supplies Stone for this line');
    expect(stone).not.toContain('We already have a supply');           // no free input: listing it would change nothing
  });
  it('names the supporting line a step belongs to', () => {
    const smelt = step({ id: 'alloy-ra', machine: { mteId: 201, name: 'Basic Alloy Smelter', tier: 1 }, mainOutput: 't:redalloy_ingot@0',
      outputs: [{ key: 't:redalloy_ingot@0', amount: 1, chance: 1 }], line: { key: 'fluid:molten.redalloy', name: 'Red Alloy' } });
    const html = panel(smelt, planOf({ steps: [smelt], names: { 't:redalloy_ingot@0': 'Red Alloy Ingot' } }));
    expect(html).toContain('Part of the Red Alloy line');
    expect(html).toContain('We already make Red Alloy');
    expect(panel(asm, wires)).not.toContain('Part of the');
  });
  it('supplies a product from outside and lists every way to make it, then importing it', () => {
    const sand = step({
      id: 'hammer-sand', mapId: 'gt.recipe.hammer', machine: { mteId: 611, name: 'Forge Hammer', tier: 1 }, mainOutput: 'minecraft:sand@0',
      inputs: [{ key: 'minecraft:gravel@0', amount: 1, chance: 1 }], outputs: [{ key: 'minecraft:sand@0', amount: 1, chance: 1 }],
      alternatives: [
        { recipeId: 'hammer-sand', rawCost: 1, mapId: 'gt.recipe.hammer', inputs: [{ key: 'minecraft:gravel@0', amount: 1 }], outputs: [{ key: 'minecraft:sand@0', amount: 1 }] },
        { recipeId: 'mace-sand', rawCost: 1.5, mapId: 'gt.recipe.macerator', inputs: [{ key: 'minecraft:cobblestone@0', amount: 1 }], outputs: [{ key: 'minecraft:sand@0', amount: 1 }] },
        { recipeId: 'sift-sand', rawCost: 0.5, mapId: 'gt.recipe.sifter', inputs: [{ key: 'minecraft:gravel@0', amount: 1 }], outputs: [{ key: 'minecraft:sand@0', amount: 2 }],
          unusable: ['needs HV (your tier is LV)'] },
      ],
      ways: { total: 3, usable: 2 },
    });
    const sands = planOf({ steps: [sand], names: { 'minecraft:sand@0': 'Sand', 'minecraft:gravel@0': 'Gravel', 'minecraft:cobblestone@0': 'Cobblestone',
      'map:gt.recipe.hammer': 'Forge Hammer', 'map:gt.recipe.macerator': 'Macerator', 'map:gt.recipe.sifter': 'Sifter' } });
    const html = panelHtml(sand, sands);
    expect(text(html)).toContain('Supply it from outside');
    expect(text(html)).toContain('Import Sand instead');
    expect(text(html)).not.toContain('We already make this');
    expect(text(html)).toContain('Swap recipe');
    expect(text(html)).toContain('3 ways to make Sand: 2 you can use now');
    expect(text(html)).toContain('Sifter: Gravel → 2× Sand · 0.5 raw/unit — needs HV (your tier is LV)');
    const swap = /<fieldset[^>]*data-swap=""[^>]*>.*?<\/fieldset>/s.exec(html)?.[0] ?? '';
    const radios = [...swap.matchAll(/<label[^>]*>(?:(?!<\/label>).)*<input type="radio"(?:(?!<\/label>).)*<\/label>/gs)].map((m) => text(m[0]).trim());
    expect(radios).toHaveLength(4);                                      // let the planner choose, two usable recipes, import: no radio for the HV one
    expect(radios.at(-1)).toBe('Import it (counted at 1 raw/unit)');
    expect(swap).toMatch(/Import it \(counted at 1 <abbr[^>]*title="raw-material units per unit made \(1 base item, 144 L molten metal or 1,000 L other fluid = 1\)"[^>]*>raw\/unit<\/abbr>\)/);
    // The line's own target is what it makes: nothing to import instead.
    const target = text(panelHtml(sand, sands, S({ target: 'minecraft:sand@0' })));
    expect(target).not.toContain('Import it');
    expect(target).not.toContain('Import Sand instead');
    expect(target).toContain('This step makes the target itself.');
  });
  it('pages a long swap list', () => {
    const ways = Array.from({ length: 60 }, (_, i) => ({ recipeId: `r${String(i).padStart(2, '0')}`, rawCost: i + 1, mapId: 'gt.recipe.assembler' }));
    const many = step({ id: 'r00', mainOutput: 't:circuit@0', outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }], alternatives: ways, ways: { total: 60, usable: 60 } });
    const html = text(panelHtml(many, planOf({ steps: [many], names: { 't:circuit@0': 'Basic Circuit' } })));
    expect(html).toContain('· 5 raw/unit');
    expect(html).not.toContain('· 6 raw/unit');
    expect(html).toContain('25 more… (55 not shown)');
    // Each "more…" opens a page more, until every way is listed; the one in use and a pinned one always show.
    expect([5, 30, 55, 80].map((limit) => shownWays(ways, limit, 'r00', undefined).length)).toEqual([5, 30, 55, 60]);
    expect(shownWays(ways, 5, 'r40', 'r59').map((a) => a.recipeId)).toEqual(['r00', 'r01', 'r02', 'r03', 'r04', 'r40', 'r59']);
  });
});

describe('raw material panel', () => {
  const rawPanel = (key: string, plan: Plan, settings = S()): string => renderToStaticMarkup(
    <RawPanel itemKey={key} plan={plan} settings={settings} per="min" send={() => {}} onClose={() => {}} />);
  it('says what kind of import it is, who uses it and whether anything here makes it', () => {
    const html = rawPanel('t:copper_ingot@0', wires);
    expect(text(html)).toContain('Import · mined · 15/min');
    expect(text(html)).toContain('Used by');
    expect(text(html)).toContain('Wiremill (1x Copper Wire) 15/min');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make it here instead<\/button>/);
    expect(text(html)).toContain('Nothing at LV makes Copper Ingot');
    const makeable = planOf({ ...wires, rawInputs: [raw({ key: 't:copper_ingot@0', leafClass: 'direct', canMake: true })] });
    expect(rawPanel('t:copper_ingot@0', makeable)).toMatch(/<button type="button">Make it here instead<\/button>/);
    expect(text(rawPanel('t:copper_ingot@0', makeable))).not.toContain('Nothing at LV makes');
  });
  it('says what a bought material stands for', () => {
    const bought = planOf({
      names: { 't:redalloy_ingot@0': 'Red Alloy Ingot', 't:copper_ingot@0': 'Copper Ingot', 't:redstone@0': 'Redstone', 'map:gt.recipe.alloysmelter': 'Alloy Smelter' },
      rawInputs: [raw({ key: 't:redalloy_ingot@0', leafClass: 'derived', canMake: true,
        pricedVia: { recipeId: 'ra', mapId: 'gt.recipe.alloysmelter', inputs: ['t:copper_ingot@0', 't:redstone@0'], steps: 1 } })],
    });
    const html = text(rawPanel('t:redalloy_ingot@0', bought));
    expect(html).toContain('Import · bought (made elsewhere) · 15/min');
    expect(html).toContain('Bought: usually made by Alloy Smelter from Copper Ingot, Redstone (1 recipe)');
  });
  it('plans the generator of a free input again', () => {
    const send = vi.fn();
    const cobble = planOf({ names: { 'minecraft:cobblestone@0': 'Cobblestone' }, rawInputs: [raw({ key: 'minecraft:cobblestone@0', cost: 0, leafClass: 'free' })] });
    const settings = S({ haveSupply: ['minecraft:cobblestone@0'] });
    expect(text(rawPanel('minecraft:cobblestone@0', cobble, settings))).toContain('Plan its generator again');
    expect(text(rawPanel('minecraft:cobblestone@0', cobble))).not.toContain('Plan its generator again');
    const tree = RawPanel({ itemKey: 'minecraft:cobblestone@0', plan: cobble, settings, per: 'min', send, onClose: () => {} });
    const [again] = findAll(tree, (e) => e.type === 'button' && childText(e) === 'Plan its generator again');
    (again!.props.onClick as () => void)();
    expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: { haveSupply: [] } }]);
  });
});

describe('patch builders', () => {
  it('send the whole new value of one setting', () => {
    const s = S({ recipeChoice: { 't:x@0': 'r0' }, stopItems: ['t:b@0'], expandItems: ['t:b@0'], haveSupply: ['fluid:water'], optionChoice: { 'r0#1': 't:y@0' } });
    const patches = [
      useOnlyPatch(s, 't:iron_plate@0', 'bend'), importInsteadPatch(s, 't:a@0'), makeHerePatch(s, 't:a@0'),
      haveSupplyPatch(s, 'minecraft:cobblestone@0', true), optionPatch(s, 'ca', 100, 'fluid:molten.tin'),
    ];
    expect(patches).toEqual([
      { recipeChoice: { 't:x@0': 'r0', 't:iron_plate@0': 'bend' } }, { stopItems: ['t:a@0', 't:b@0'] }, { expandItems: ['t:a@0', 't:b@0'] },
      { haveSupply: ['fluid:water', 'minecraft:cobblestone@0'] }, { optionChoice: { 'r0#1': 't:y@0', 'ca#100': 'fluid:molten.tin' } },
    ]);
    expect(haveSupplyPatch(s, 'fluid:water', false)).toEqual({ haveSupply: [] });
    expect(optionPatch(s, 'r0', 1, null)).toEqual({ optionChoice: {} });                     // null takes the pin out
    const old = { ...S() };
    delete old.haveSupply;
    delete old.optionChoice;
    expect([haveSupplyPatch(old, 'fluid:water', true), optionPatch(old, 'ca', 100, 'fluid:molten.tin')])
      .toEqual([{ haveSupply: ['fluid:water'] }, { optionChoice: { 'ca#100': 'fluid:molten.tin' } }]);   // a project stored before these settings
    for (const patch of patches) expect(validateOp({ op: 'settings', patch })).toBeNull();
    expect(s).toEqual(S({ recipeChoice: { 't:x@0': 'r0' }, stopItems: ['t:b@0'], expandItems: ['t:b@0'], haveSupply: ['fluid:water'], optionChoice: { 'r0#1': 't:y@0' } }));
  });
});

// Where reused machines stand (plan 09 Task 9; architecture §11.29): scan positions first, the "Machines we have" list after.
describe('step panel: reused machines', () => {
  const pos = (x: number) => ({ dim: 0, pos: [x, 64, 2] as [number, number, number] });
  const reusing = (count: number, owned: number, where: ReturnType<typeof pos>[]) =>
    step({ id: 'asm', count, owned, reused: { count: owned, where }, mainOutput: 't:circuit@0' });
  it('says how many machines the step reuses and where they stand', () => {
    expect(panel(reusing(3, 2, [pos(1), pos(3)]), wires)).toContain('2× Basic Assembler (LV) reused — at your base 1 64 2, 3 64 2');
    expect(panel(reusing(3, 2, []), wires)).toContain('2× Basic Assembler (LV) reused — from your list');
    expect(panel(reusing(3, 3, [pos(1)]), wires)).toContain('3× Basic Assembler (LV) reused — 1 at your base 1 64 2; 2 from your list');
    expect(panel(reusing(5, 5, [1, 2, 3, 4, 5].map(pos)), wires)).toContain('5× Basic Assembler (LV) reused — at your base 1 64 2, 2 64 2, 3 64 2 and 2 more');
    expect(panel(step({ id: 'asm', count: 3, owned: 2, mainOutput: 't:circuit@0' }), wires)).toContain('2× Basic Assembler (LV) reused');   // a plan without where
    expect(panel(step({ id: 'asm', count: 3, owned: 0 }), wires)).not.toContain('reused');
  });
  it('keeps the per-machine switch beside it, and shows neither with "Reuse machines we have" off', () => {
    const html = panel(reusing(3, 2, [pos(1), pos(3)]), wires);
    expect(html).toContain('Reuse your 2× Basic Assembler');
    const off = panel(step({ id: 'asm', count: 3, owned: 0 }), wires, S({ reuseOwned: false, declineReuse: [121] }));
    expect(off).not.toContain('Reuse your');
    expect(off).not.toContain('reused');
  });
});
