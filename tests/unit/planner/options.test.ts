// Ingredient options (fix spec R9, D12; architecture §11.35; controller ruling "every option stays available"): a step
// lists every option of its ore-dictionary slots with what each would cost, the project can pin one, and a pin a
// re-export broke is ignored with a warning.

import { describe, expect, it } from 'vitest';
import { withBuildRecipes } from '../../helpers/build-fixtures.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { OreVein } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

/** An overworld vein of one material. */
const vein = (material: string): OreVein => ({ name: `ore.mix.${material}`, dims: ['overworld'], kind: 'vein', weight: 1, minY: 0, maxY: 255, size: 1, density: 1,
  materials: { primary: material, secondary: material, between: material, sporadic: material } });

const SOLDER = 'fluid:molten.solder';
const TIN = 'fluid:molten.tin';
const LEAD = 'fluid:molten.lead';

/**
 * A circuit assembler takes a mined part and 72 L of soldering alloy, 144 L of tin or 288 L of lead. Soldering alloy
 * ingots are alloyed from 9 tin ingots and 1 antimony dust into 10, so 72 L costs 0.5 raw in two steps; tin costs 1 and
 * lead 2, each one extraction from a mined ingot. Lead is priced above KEEP_WITHIN (2 × the cheapest), so the walk
 * leaves it out of the line's graph. Every machine can be built (ruling P3: plan 12 never plans one no recipe makes as a
 * new one).
 */
const CIRCUIT: PackSpec = withBuildRecipes({
  items: [
    { key: 't:ec@0', name: 'Electronic Circuit' },
    { key: 't:part@0', name: 'Circuit Part', gt: { prefix: 'dust', material: 'Part' } },
    { key: 't:tin_ingot@0', name: 'Tin Ingot', gt: { prefix: 'ingot', material: 'Tin' } },
    { key: 't:lead_ingot@0', name: 'Lead Ingot', gt: { prefix: 'ingot', material: 'Lead' } },
    { key: 't:antimony_dust@0', name: 'Antimony Dust', gt: { prefix: 'dust', material: 'Antimony' } },
    { key: 't:solder_ingot@0', name: 'Soldering Alloy Ingot', gt: { prefix: 'ingot', material: 'SolderingAlloy' } },
  ],
  fluids: [{ key: SOLDER, name: 'Molten Soldering Alloy' }, { key: TIN, name: 'Molten Tin' }, { key: LEAD, name: 'Molten Lead' }],
  maps: [
    { id: 'gt.recipe.circuitassembler', name: 'Circuit Assembler' }, { id: 'gt.recipe.fluidextractor', name: 'Fluid Extractor' },
    { id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' },
  ],
  machines: [
    { mteId: 1, name: 'Basic Circuit Assembler', maps: ['gt.recipe.circuitassembler'], tier: 1 },
    { mteId: 2, name: 'Basic Fluid Extractor', maps: ['gt.recipe.fluidextractor'], tier: 1 },
    { mteId: 3, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 },
  ],
  recipes: [
    { id: 'ca', map: 'gt.recipe.circuitassembler', in: [['t:part@0', 1], { any: [[SOLDER, 72], [TIN, 144], [LEAD, 288]] }], out: [['t:ec@0', 1]], eut: 16 },
    { id: 'x-solder', map: 'gt.recipe.fluidextractor', in: [['t:solder_ingot@0', 1]], out: [[SOLDER, 144]], eut: 16 },
    { id: 'x-tin', map: 'gt.recipe.fluidextractor', in: [['t:tin_ingot@0', 1]], out: [[TIN, 144]], eut: 16 },
    { id: 'x-lead', map: 'gt.recipe.fluidextractor', in: [['t:lead_ingot@0', 1]], out: [[LEAD, 144]], eut: 16 },
    { id: 'alloy-solder', map: 'gt.recipe.alloysmelter', in: [['t:tin_ingot@0', 9], ['t:antimony_dust@0', 1]], out: [['t:solder_ingot@0', 10]], eut: 16 },
  ],
  worldgen: { veins: ['Part', 'Tin', 'Lead', 'Antimony'].map(vein) },
});

const pack = packFromSpec(CIRCUIT);
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:ec@0', tier: 1, buildHorizonHours: null, ...p });
const circuitStep = (plan: Plan): PlanStep => plan.steps.find((s) => s.id === 'ca')!;
const ids = (plan: Plan): string[] => plan.steps.map((s) => s.id);
const staleOptions = (plan: Plan) => plan.warnings.filter((w) => w.code === 'stale-option');

describe('ingredient options', () => {
  it('explains the option it chose', async () => {
    const plan = await planLine(pack, S(), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['alloy-solder', 'ca', 'x-solder']);
    const [slot, ...more] = circuitStep(plan).options ?? [];
    expect(more).toEqual([]);
    expect(slot?.slot).toBe(100);
    expect(slot?.pinned).toBeUndefined();
    // Every option of the slot, cheapest first: the one the plan uses and those it does not (lead was never in the graph).
    expect(slot?.choices).toMatchObject([
      { key: SOLDER, amount: 72, rawPerRun: 0.5, steps: 2, share: 1 },
      { key: TIN, amount: 144, rawPerRun: 1, steps: 1, share: 0, via: ['Fluid Extractor'] },
      { key: LEAD, amount: 288, rawPerRun: 2, steps: 1, share: 0, via: ['Fluid Extractor'] },
    ]);
    expect(slot?.choices[0]?.via).toContain('Alloy Smelter');
    expect(plan.names).toMatchObject({ [LEAD]: 'Molten Lead', [TIN]: 'Molten Tin', [SOLDER]: 'Molten Soldering Alloy' });
    // The step's own inputs name the option it takes; no other step has a multi-option slot.
    expect(circuitStep(plan).inputs).toEqual([{ key: 't:part@0', amount: 1, chance: 1 }, { key: SOLDER, amount: 72, chance: 1 }]);
    expect(plan.steps.filter((s) => s.options !== undefined).map((s) => s.id)).toEqual(['ca']);
  });
  it('pins an option', async () => {
    const plan = await planLine(pack, S({ optionChoice: { 'ca#100': TIN } }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toContain('x-tin');
    expect(ids(plan)).not.toContain('alloy-solder');
    expect(ids(plan)).not.toContain('x-solder');
    const slot = circuitStep(plan).options?.[0];
    expect(slot?.pinned).toBe(TIN);
    expect(slot?.choices.map((c) => [c.key, c.share])).toEqual([[SOLDER, 0], [TIN, 1], [LEAD, 0]]);
    expect(circuitStep(plan).inputs).toContainEqual({ key: TIN, amount: 144, chance: 1 });
    expect(staleOptions(plan)).toEqual([]);
  });
  it('pins an option the walk would leave out, and plans its chain', async () => {
    // Controller ruling: a pinned option is kept and planned even above KEEP_WITHIN, with the recipes that make it.
    const plan = await planLine(pack, S({ optionChoice: { 'ca#100': LEAD } }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['ca', 'x-lead']);
    const slot = circuitStep(plan).options?.[0];
    expect(slot?.pinned).toBe(LEAD);
    expect(slot?.choices.map((c) => [c.key, c.share, c.rawPerRun])).toEqual([[SOLDER, 0, 0.5], [TIN, 0, 1], [LEAD, 1, 2]]);
    expect(plan.rawInputs.map((r) => r.key)).toEqual(['t:lead_ingot@0', 't:part@0']);
  });
  it('ignores a stale option pin with a warning', async () => {
    // A re-export dropped gold from the slot and the recipe 'gone' altogether: the plan is the unpinned one.
    const plan = await planLine(pack, S({ optionChoice: { 'ca#100': 'fluid:molten.gold', 'gone#0': 't:x@0' } }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['alloy-solder', 'ca', 'x-solder']);
    expect(staleOptions(plan).map((w) => w.key).sort()).toEqual(['ca#100', 'gone#0']);
    for (const w of staleOptions(plan)) expect(w.text).toEqual(expect.any(String));
    expect(circuitStep(plan).options?.[0]?.pinned).toBeUndefined();
    // A slot the recipe does not have is stale too; a pin of a recipe this line does not run is not, while it still fits.
    const noSlot = await planLine(pack, S({ optionChoice: { 'ca#7': TIN, 'x-tin#0': 't:tin_ingot@0' } }), emptyContext());
    expect(staleOptions(noSlot).map((w) => w.key)).toEqual(['ca#7']);
  });
  it('says why the group cannot get an option', async () => {
    // At LV nothing extracts lead (its extractor needs 34 EU/t, an MV machine): lead is listed with why, not as a leaf.
    const spec = structuredClone(CIRCUIT);
    spec.recipes!.find((r) => r.id === 'x-lead')!.eut = 34;
    const plan = await planLine(packFromSpec(spec), S(), emptyContext());
    const choices = circuitStep(plan).options?.[0]?.choices ?? [];
    expect(choices.find((c) => c.key === LEAD)).toMatchObject({ share: 0, steps: 0, unusable: ['needs MV (your tier is LV)'] });
    expect(choices.find((c) => c.key === LEAD)?.via).toBeUndefined();
    expect(choices.filter((c) => c.unusable !== undefined).map((c) => c.key)).toEqual([LEAD]);
  });
  it('ignores a pinned option on the avoid list, saying so', async () => {
    // Ruling P28: the avoid list wins over a pin, as it does over a pinned recipe (stale-choice). The pin is ignored in
    // every graph of the line, so the line is the one without it, which uses nothing the list covers.
    const plan = await planLine(pack, S({ optionChoice: { 'ca#100': LEAD }, avoid: ['Lead'] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['alloy-solder', 'ca', 'x-solder']);
    expect(staleOptions(plan)).toEqual([{ code: 'stale-option', key: 'ca#100', text: expect.stringContaining('avoid list') }]);
    expect(circuitStep(plan).options?.[0]?.pinned).toBeUndefined();
    expect(plan.avoided).toEqual([]);
  });
  it('ignores a pinned option on the avoid list even where nothing at the tier makes it', async () => {
    // At LV nothing extracts lead (34 EU/t, an MV machine): a line that honoured the pin would plan nothing, though the
    // same settings without the pin plan fine. The avoid list wins before the line is first solved.
    const spec = structuredClone(CIRCUIT);
    spec.recipes!.find((r) => r.id === 'x-lead')!.eut = 34;
    const mvLead = packFromSpec(spec);
    const plan = await planLine(mvLead, S({ optionChoice: { 'ca#100': LEAD }, avoid: ['Lead'] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['alloy-solder', 'ca', 'x-solder']);
    expect(staleOptions(plan)).toEqual([{ code: 'stale-option', key: 'ca#100', text: expect.stringContaining('avoid list') }]);
    expect(plan.warnings.map((w) => w.code)).not.toContain('no-recipe');
    const unpinned = await planLine(mvLead, S({ avoid: ['Lead'] }), emptyContext());
    expect(plan.steps).toEqual(unpinned.steps);
    // Without the avoid list the pin holds (the line's pricing is not shared with the avoiding one): nothing makes lead.
    const pinned = await planLine(mvLead, S({ optionChoice: { 'ca#100': LEAD } }), emptyContext());
    expect(pinned.status).toBe('infeasible');
    expect(pinned.warnings).toContainEqual({ code: 'no-recipe', key: LEAD, text: 'Nothing at ≤ LV makes Molten Lead (needs MV)' });
    expect(staleOptions(pinned)).toEqual([]);
  });
  it('keeps ignoring a pinned option on the avoid list where the line has to allow it back', async () => {
    // A Lead Weight is cast from molten lead only, so the line cannot avoid lead; it avoids antimony, and with it
    // soldering alloy. Lead is allowed back for the weight, yet the slot takes tin, not the pinned lead: the avoid list
    // still wins over the pin, and only the weight's chain is flagged.
    const spec = structuredClone(CIRCUIT);
    spec.items!.push({ key: 't:weight@0', name: 'Lead Weight' });
    spec.maps!.push({ id: 'gt.recipe.fluidsolidifier', name: 'Fluid Solidifier' });
    spec.machines!.push({ mteId: 4, name: 'Basic Fluid Solidifier', maps: ['gt.recipe.fluidsolidifier'], tier: 1 });
    spec.recipes!.find((r) => r.id === 'ca')!.in!.push(['t:weight@0', 1]);
    spec.recipes!.push({ id: 'cast-weight', map: 'gt.recipe.fluidsolidifier', in: [[LEAD, 144]], out: [['t:weight@0', 1]], eut: 16 });
    const plan = await planLine(packFromSpec(withBuildRecipes(spec)), S({ optionChoice: { 'ca#100': LEAD }, avoid: ['Lead', 'Antimony'] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['ca', 'cast-weight', 'x-lead', 'x-tin']);
    expect(circuitStep(plan).inputs).toContainEqual({ key: TIN, amount: 144, chance: 1 });
    expect(circuitStep(plan).options?.[0]?.pinned).toBeUndefined();
    expect(staleOptions(plan)).toEqual([{ code: 'stale-option', key: 'ca#100', text: expect.stringContaining('avoid list') }]);
    const flagged = plan.warnings.filter((w) => w.code === 'avoid-unavoidable').map((w) => [w.stepId, w.key]);
    expect(flagged).toEqual([['cast-weight', LEAD], ['x-lead', 't:lead_ingot@0']]);
    expect(plan.avoided?.map((a) => [a.key, a.unavoidable])).toEqual([[LEAD, true], ['t:antimony_dust@0', false], ['t:lead_ingot@0', true]]);
  });
  it('says it ignores a pinned option on the avoid list without promising another option', async () => {
    // Plan 09's final review: at LV only lead can be extracted (the solder and tin extractors need 34 EU/t, an MV machine),
    // so the line uses the pinned lead anyway, flagged as nothing at the tier avoiding it; the pin's warning said
    // "using another option that avoids it".
    const spec = structuredClone(CIRCUIT);
    for (const id of ['x-solder', 'x-tin']) spec.recipes!.find((r) => r.id === id)!.eut = 34;
    const plan = await planLine(packFromSpec(spec), S({ optionChoice: { 'ca#100': LEAD }, avoid: ['Lead'] }), emptyContext());
    expect(plan.status).toBe('ok');
    expect(ids(plan)).toEqual(['ca', 'x-lead']);
    expect(plan.warnings.filter((w) => w.code === 'avoid-unavoidable').map((w) => w.key)).toContain(LEAD);
    expect(staleOptions(plan)).toEqual([{ code: 'stale-option', key: 'ca#100', text: 'Electronic Circuit: the pinned ingredient Molten Lead is on the avoid list; ignoring the pin' }]);
  });
  it('says which option needs a good on the avoid list', async () => {
    // Plan 09's final review: with tin avoided, soldering alloy (alloyed from tin ingots) was listed as usable and the
    // cheapest, at 0.5 raw in two steps, while the line takes lead; pinning it would use tin after all.
    const plan = await planLine(pack, S({ avoid: ['Tin'] }), emptyContext());
    expect(ids(plan)).toEqual(['ca', 'x-lead']);
    expect(circuitStep(plan).options?.[0]?.choices.map((c) => [c.key, c.share, c.unusable])).toEqual([
      [SOLDER, 0, ['needs Tin Ingot, which is on your avoid list']], [LEAD, 1, undefined]]);
    // A pin of it is honoured, its tin flagged as nothing avoiding it: the option in use is not marked.
    const pinned = await planLine(pack, S({ avoid: ['Tin'], optionChoice: { 'ca#100': SOLDER } }), emptyContext());
    expect(ids(pinned)).toEqual(['alloy-solder', 'ca', 'x-solder']);
    expect(pinned.warnings.filter((w) => w.code === 'avoid-unavoidable').map((w) => w.key)).toEqual(['t:tin_ingot@0']);
    expect(circuitStep(pinned).options?.[0]?.choices.map((c) => [c.key, c.share, c.unusable])).toEqual([[SOLDER, 1, undefined], [LEAD, 0, undefined]]);
  });
  it('keeps an option pinnable that a dearer chain makes without the avoided good', async () => {
    // Review of the plan 09 follow-up: the mark read only the cheapest chain, over the cost model that ignores the avoid
    // list, so at MV a Good Electronic Circuit read "needs Antimony Ingot", though a chain without antimony makes it and a
    // pin of it planned fine. Here soldering alloy is also alloyed from lead, dearer (3 raw for the slot): with tin
    // avoided it stays pinnable, at what that chain costs.
    const spec = structuredClone(CIRCUIT);
    spec.recipes!.push({ id: 'alloy-solder-pb', map: 'gt.recipe.alloysmelter', in: [['t:lead_ingot@0', 50], ['t:antimony_dust@0', 10]], out: [['t:solder_ingot@0', 10]], eut: 16 });
    const p = packFromSpec(spec);
    const plan = await planLine(p, S({ avoid: ['Tin'] }), emptyContext());
    expect(ids(plan)).toEqual(['ca', 'x-lead']);
    expect(circuitStep(plan).options?.[0]?.choices.map((c) => [c.key, c.share, c.rawPerRun, c.steps, c.via, c.unusable])).toEqual([
      [LEAD, 1, 2, 1, ['Fluid Extractor'], undefined], [SOLDER, 0, 3, 2, ['Fluid Extractor', 'Alloy Smelter'], undefined]]);
    // Its pin plans that chain, with nothing on the avoid list.
    const pinned = await planLine(p, S({ avoid: ['Tin'], optionChoice: { 'ca#100': SOLDER } }), emptyContext());
    expect(ids(pinned)).toEqual(['alloy-solder-pb', 'ca', 'x-solder']);
    expect(circuitStep(pinned).options?.[0]?.pinned).toBe(SOLDER);
    expect(pinned.warnings.filter((w) => w.code === 'avoid-unavoidable')).toEqual([]);
    expect(pinned.avoided?.filter((a) => a.unavoidable)).toEqual([]);
  });
});

describe('a slot split between two options', () => {
  // The line makes A as a by-product of X (half a dust a run) and takes the rest of the slot as mined B: 1.5 raw per
  // Thing, where B alone would cost 2. Task 1's deferred minor: the step listed only the busiest option with the whole
  // slot amount, so the flows looked short.
  const split = packFromSpec(withBuildRecipes({
    items: [
      { key: 't:thing@0', name: 'Thing' }, { key: 't:x@0', name: 'X' },
      { key: 't:a@0', name: 'A Dust', gt: { prefix: 'dust', material: 'A' } },
      { key: 't:b@0', name: 'B Dust', gt: { prefix: 'dust', material: 'B' } },
      { key: 't:raw@0', name: 'Raw Dust', gt: { prefix: 'dust', material: 'Raw' } },
    ],
    maps: [{ id: 'gt.recipe.assembler', name: 'Assembler' }, { id: 'gt.recipe.macerator', name: 'Macerator' }],
    machines: [{ mteId: 1, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 }, { mteId: 2, name: 'Basic Macerator', maps: ['gt.recipe.macerator'], tier: 1 }],
    recipes: [
      { id: 'use', map: 'gt.recipe.assembler', in: [['t:x@0', 1], { any: [['t:a@0', 1], ['t:b@0', 1]] }], out: [['t:thing@0', 1]], eut: 16 },
      { id: 'make-x', map: 'gt.recipe.macerator', in: [['t:raw@0', 1]], out: [['t:x@0', 1], ['t:a@0', 1, 0.5]], eut: 16 },
      { id: 'make-a', map: 'gt.recipe.macerator', in: [['t:raw@0', 3]], out: [['t:a@0', 1]], eut: 16 },
    ],
    worldgen: { veins: ['B', 'Raw'].map(vein) },
  }));
  it('lists both options with their shares, and the flows feed the step in full', async () => {
    const plan = await planLine(split, { ...defaultSettings(), target: 't:thing@0', tier: 1, buildHorizonHours: null }, emptyContext());
    expect(plan.status).toBe('ok');
    const use = plan.steps.find((s) => s.id === 'use')!;
    expect(use.inputs).toEqual([{ key: 't:x@0', amount: 1, chance: 1 }, { key: 't:a@0', amount: 0.5, chance: 0.5 }, { key: 't:b@0', amount: 0.5, chance: 0.5 }]);
    // (Which of the two lists first depends on how the cost model splits make-x's cost between X and A.)
    expect(use.options?.[0]?.choices.map((c) => [c.key, c.share]).sort()).toEqual([['t:a@0', 0.5], ['t:b@0', 0.5]]);
    expect(plan.warnings.map((w) => w.code)).not.toContain('short-input');
    expect(plan.warnings.map((w) => w.code)).not.toContain('orphan-input');
  });
});
