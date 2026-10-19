// Materials to avoid (spec §3.3, architecture §11.25, plan 2026-10-18-08): the planner keeps every good an avoid entry
// matches out of the line while a plan without it exists, and otherwise re-allows only what it cannot do without and
// flags each step that uses it. Packs are Mini-GT plus a few invented items and recipes (ruling R13: mini-gt.ts and
// pack-spec.ts stay as they are).

import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec, type RecipeSpec } from '../../helpers/pack-spec.ts';
import { resolveAvoid } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine, settingsHash } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
/** Supporting lines off (the default before plan 09): these cases buy derived materials. */
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), routeDerived: false, ...p });
/** Half a dust or ingot in GT's material units: 1x wires and cables. */
const HALF = 1_814_400;

/** Mini-GT with more items, recipes, maps, machines and materials. */
function extended(extra: Pick<PackSpec, 'items' | 'recipes' | 'maps' | 'machines' | 'materials'>): Pack {
  const spec = structuredClone(MINI_GT);
  spec.items = [...(spec.items ?? []), ...(extra.items ?? [])];
  spec.recipes = [...(spec.recipes ?? []), ...(extra.recipes ?? [])];
  spec.maps = [...(spec.maps ?? []), ...(extra.maps ?? [])];
  spec.machines = [...(spec.machines ?? []), ...(extra.machines ?? [])];
  spec.materials = [...(spec.materials ?? []), ...(extra.materials ?? [])];
  return packFromSpec(spec);
}

/** An LV alloy smelter, which Mini-GT lacks. */
const ALLOY_SMELTER: Pick<PackSpec, 'maps' | 'machines'> = {
  maps: [{ id: 'gt.recipe.alloysmelter', name: 'Alloy Smelter' }],
  machines: [{ mteId: 171, name: 'Basic Alloy Smelter', maps: ['gt.recipe.alloysmelter'], tier: 1 }],
};

/** The goods of `material` the plan buys, feeds into a step or lists among a step's inputs, sorted. */
function usesOf(p: Pack, plan: Plan, material: string): string[] {
  const steps = new Set(plan.steps.map((s) => s.id));
  const keys = [
    ...plan.rawInputs.map((r) => r.key), ...plan.flows.filter((f) => steps.has(f.to)).map((f) => f.key),
    ...plan.steps.flatMap((s) => s.inputs.map((i) => i.key)),
  ];
  return [...new Set(keys)].filter((key) => p.items.get(key)?.gt?.material === material).sort();
}

const avoidWarnings = (plan: Plan) => plan.warnings.filter((w) => w.code.startsWith('avoid-'));

/**
 * A Widget is an LV Machine Hull and two iron plates. The hull takes tin cable (half a tin ingot each) or, at twice the
 * cost, copper cable (a whole copper ingot each), so tin sits three recipes below the target and has a dearer way round.
 */
const copperCable = extended({
  items: [
    { key: 't:copper_cable@0', name: '1x Copper Cable', gt: { prefix: 'cableGt01', material: 'Copper', amount: HALF } },
    { key: 't:widget@0', name: 'Widget' },
  ],
  recipes: [
    { id: 'copper-cable', map: 'crafting', in: [['t:copper_ingot@0', 1]], out: [['t:copper_cable@0', 1]] },
    { id: 'hull-lv-copper', map: 'crafting', in: [['t:iron_plate@0', 8], ['t:copper_cable@0', 2]], out: [['t:hull_lv@0', 1]] },
    { id: 'widget', map: 'gt.recipe.assembler', in: [['t:hull_lv@0', 1], ['t:iron_plate@0', 2]], out: [['t:widget@0', 1]], eut: 16, dur: 100 },
  ],
});

describe('resolveAvoid', () => {
  it('turns a material name into every form of it and a key into itself, case-sensitively, and names what it does not know', () => {
    const { goods, unknown, empty } = resolveAvoid(pack, ['Iron', 't:redstone@0', 'fluid:oil', 'tin', 'Unobtainium']);
    expect([...goods].sort()).toEqual(['fluid:molten.iron', 'fluid:oil', 't:iron_dust@0', 't:iron_ingot@0', 't:iron_ore@0', 't:iron_plate@0', 't:redstone@0']);
    expect(unknown).toEqual(['tin', 'Unobtainium']);
    expect(empty).toEqual([]);
  });
  it("takes in a material's ore parts and its molten, plasma and plain fluids; a material with no goods is known but matches nothing (empty)", () => {
    const p = packFromSpec({
      items: [
        { key: 't:silver_ingot@0', name: 'Silver Ingot', gt: { prefix: 'ingot', material: 'Silver' } }, { key: 't:crushed_silver@0', name: 'Crushed Silver Ore' },
        { key: 't:red_alloy@0', name: 'Red Alloy Ingot', gt: { prefix: 'ingot', material: 'Red Alloy' } },
      ],
      fluids: [{ key: 'fluid:molten.silver' }, { key: 'fluid:plasma.silver' }, { key: 'fluid:silver' }, { key: 'fluid:molten.redalloy' }],
      materials: ['Unused'],
    });
    p.materials.get('Silver')!.parts = { crushed: 't:crushed_silver@0' };
    expect([...resolveAvoid(p, ['Silver']).goods].sort()).toEqual(['fluid:molten.silver', 'fluid:plasma.silver', 'fluid:silver', 't:crushed_silver@0', 't:silver_ingot@0']);
    expect([...resolveAvoid(p, ['Red Alloy']).goods].sort()).toEqual(['fluid:molten.redalloy', 't:red_alloy@0']);
    expect(resolveAvoid(p, ['Unused'])).toEqual({ goods: new Set(), unknown: [], empty: ['Unused'] });
  });
});

describe('planLine with materials to avoid', () => {
  it('(a) takes the way round an avoided material, three recipes below the target, and drops its recipes from the swap lists', async () => {
    const settings = S({ target: 't:widget@0', tier: 1 });
    const open = await planLine(copperCable, settings, emptyContext());
    expect(usesOf(copperCable, open, 'Tin')).toEqual(['t:tin_cable@0', 't:tin_ingot@0']);   // tin cable is the cheaper way
    const p = await planLine(copperCable, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(p.status).toBe('ok');
    expect(usesOf(copperCable, p, 'Tin')).toEqual([]);
    expect(p.steps.map((s) => s.id)).toEqual(['bend-plate', 'copper-cable', 'hull-lv-copper', 'widget']);
    expect(p.rawInputs.map((r) => r.key)).toEqual(['t:copper_ingot@0', 't:iron_ingot@0']);
    expect(p.avoided).toEqual([
      { key: 't:tin_cable@0', name: '1x Tin Cable', unavoidable: false }, { key: 't:tin_ingot@0', name: 'Tin Ingot', unavoidable: false }]);
    expect(avoidWarnings(p)).toEqual([]);
    expect(p.steps.find((s) => s.id === 'hull-lv-copper')?.alternatives.map((a) => a.recipeId)).toEqual(['hull-lv-copper']);
    expect(open.steps.find((s) => s.id === 'hull-lv')?.alternatives.map((a) => a.recipeId)).toEqual(['hull-lv', 'hull-lv-copper']);
  });
  it('(b) keeps the allowed option of an ore-dictionary slot that also takes an avoided one, and shows the step using it', async () => {
    // Either one copper ingot or two tin ingots: copper is cheaper, and it sorts first, so a step that looked up the
    // untrimmed slot would name copper.
    const joint = extended({
      items: [{ key: 't:joint@0', name: 'Joint' }],
      recipes: [{
        id: 'joint', map: 'gt.recipe.assembler', in: [['t:iron_plate@0', 1], { any: [['t:copper_ingot@0', 1], ['t:tin_ingot@0', 2]] }],
        out: [['t:joint@0', 1]], eut: 16, dur: 100,
      }],
    });
    const settings = S({ target: 't:joint@0', tier: 1 });
    const open = await planLine(joint, settings, emptyContext());
    expect(open.steps.find((s) => s.id === 'joint')?.inputs.map((i) => [i.key, i.amount])).toEqual([['t:iron_plate@0', 1], ['t:copper_ingot@0', 1]]);
    const p = await planLine(joint, { ...settings, avoid: ['Copper'] }, emptyContext());
    expect(p.steps.map((s) => s.id)).toEqual(['bend-plate', 'joint']);
    expect(p.steps.find((s) => s.id === 'joint')?.inputs.map((i) => [i.key, i.amount])).toEqual([['t:iron_plate@0', 1], ['t:tin_ingot@0', 2]]);
    expect(p.flows).toContainEqual(expect.objectContaining({ from: 'raw', to: 'joint', key: 't:tin_ingot@0' }));
    expect(usesOf(joint, p, 'Copper')).toEqual([]);
    expect(p.avoided).toEqual([{ key: 't:copper_ingot@0', name: 'Copper Ingot', unavoidable: false }]);
  });
  it('(c) still plans when the only route goes through an avoided material, and flags each step that uses it', async () => {
    const p = await planLine(pack, S({ target: 't:hull_lv@0', tier: 1, avoid: ['Tin'] }), emptyContext());
    expect(p.status).toBe('ok');
    expect(p.steps.map((s) => s.id)).toEqual(['bend-plate', 'cable', 'hull-lv']);
    expect(p.avoided).toEqual([
      { key: 't:tin_cable@0', name: '1x Tin Cable', unavoidable: true }, { key: 't:tin_ingot@0', name: 'Tin Ingot', unavoidable: true }]);
    expect(avoidWarnings(p)).toEqual([
      { code: 'avoid-unavoidable', key: 't:tin_ingot@0', stepId: 'cable', text: 'Crafting table (by hand) uses Tin Ingot — no recipe at LV avoids it' },
      { code: 'avoid-unavoidable', key: 't:tin_cable@0', stepId: 'hull-lv', text: 'Crafting table (by hand) uses 1x Tin Cable — no recipe at LV avoids it' }]);
    // A batch is flagged the same way.
    const batch = await planLine(pack, S({ target: 't:hull_lv@0', tier: 1, mode: 'makeN', amount: 2, avoid: ['Tin'] }), emptyContext());
    expect(batch.avoided).toEqual(p.avoided);
    expect(avoidWarnings(batch).map((w) => [w.key, w.stepId])).toEqual([['t:tin_ingot@0', 'cable'], ['t:tin_cable@0', 'hull-lv']]);
  });
  it('(c) re-allows only what the line cannot do without', async () => {
    // A Kit is one iron ingot and two redstone, or four redstone. With iron and redstone both avoided, letting the
    // cheaper-to-allow iron back in does not help, and once redstone is back the kit no longer needs the iron.
    const kit = extended({
      items: [{ key: 't:kit@0', name: 'Kit' }],
      recipes: [
        { id: 'kit-a', map: 'gt.recipe.assembler', in: [['t:iron_ingot@0', 1], ['t:redstone@0', 2]], out: [['t:kit@0', 1]], eut: 16, dur: 100 },
        { id: 'kit-b', map: 'gt.recipe.assembler', in: [['t:redstone@0', 4]], out: [['t:kit@0', 1]], eut: 16, dur: 100 },
      ],
    });
    const settings = S({ target: 't:kit@0', tier: 1 });
    expect((await planLine(kit, settings, emptyContext())).steps.map((s) => s.id)).toEqual(['kit-a']);
    const p = await planLine(kit, { ...settings, avoid: ['Iron', 'Redstone'] }, emptyContext());
    expect(p.steps.map((s) => s.id)).toEqual(['kit-b']);
    expect(p.rawInputs.map((r) => r.key)).toEqual(['t:redstone@0']);
    expect(p.avoided).toEqual([
      { key: 't:iron_ingot@0', name: 'Iron Ingot', unavoidable: false }, { key: 't:redstone@0', name: 'Redstone', unavoidable: true }]);
    expect(avoidWarnings(p)).toEqual([
      { code: 'avoid-unavoidable', key: 't:redstone@0', stepId: 'kit-b', text: 'Basic Assembler uses Redstone — no recipe at LV avoids it' }]);
  });
  it('(d) warns once about an entry that matches nothing, and names the avoided items and fluids it lists', async () => {
    const settings = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const open = await planLine(pack, settings, emptyContext());
    const p = await planLine(pack, { ...settings, avoid: ['Unobtainium', 'Tin', 't:titanium_plate@0'] }, emptyContext());
    expect(avoidWarnings(p)).toEqual([{ code: 'avoid-unknown', text: expect.stringContaining('"Unobtainium"') }]);
    expect(p.steps).toEqual(open.steps);
    expect(p.rawInputs).toEqual(open.rawInputs);
    expect(p.avoided).toEqual([]);
    expect(p.names?.['t:titanium_plate@0']).toBe('Titanium Plate');
    expect(p.names?.Tin).toBeUndefined();
  });
  it('(d) also says so of a material of the pack that nothing is made of, in list order (final review)', async () => {
    // The real export has 80 such materials (AnyCopper, AnyIron, Nano, …): picking one used to avoid nothing silently.
    const p = extended({ materials: ['AnyCopper'] });
    const plan = await planLine(p, S({ target: 't:circuit@0', amount: 30, tier: 1, avoid: ['AnyCopper', 'Unobtainium'] }), emptyContext());
    expect(avoidWarnings(plan)).toEqual([
      { code: 'avoid-unknown', text: '"AnyCopper" matches nothing in this pack: no item or fluid is made of it, so nothing is avoided for it' },
      { code: 'avoid-unknown', text: '"Unobtainium" is no material, item or fluid of this pack, so nothing is avoided for it' }]);
    expect(plan.avoided).toEqual([]);
  });
  it('(e) plans an avoided target normally, with one avoid-target warning (ruling R9)', async () => {
    const settings = S({ target: 't:tin_cable@0', tier: 1 });
    const open = await planLine(pack, settings, emptyContext());
    const byKey = await planLine(pack, { ...settings, avoid: ['t:tin_cable@0'] }, emptyContext());
    expect(byKey.steps).toEqual(open.steps);
    expect(byKey.rawInputs).toEqual(open.rawInputs);
    expect(avoidWarnings(byKey)).toEqual([{ code: 'avoid-target', key: 't:tin_cable@0', text: expect.stringContaining('1x Tin Cable') }]);
    expect(byKey.avoided).toEqual([]);
    // Review Focus 1: avoiding the cable's whole material still plans it, flagging the tin ingot nothing at LV avoids.
    const byMaterial = await planLine(pack, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(byMaterial.steps.map((s) => s.id)).toEqual(['cable']);
    expect(byMaterial.avoided).toEqual([{ key: 't:tin_ingot@0', name: 'Tin Ingot', unavoidable: true }]);
    expect(avoidWarnings(byMaterial).map((w) => [w.code, w.key, w.stepId])).toEqual([
      ['avoid-target', 't:tin_cable@0', undefined], ['avoid-unavoidable', 't:tin_ingot@0', 'cable']]);
  });
  it('(f) re-plans when the avoid list changes: the settings hash covers it, and an empty list hashes like none', () => {
    const s = S({ target: 't:circuit@0' });
    const { avoid: _, ...old } = s;
    expect(settingsHash({ ...s, avoid: ['Tin'] })).not.toBe(settingsHash(s));
    expect(settingsHash({ ...s, avoid: ['Tin'] })).not.toBe(settingsHash({ ...s, avoid: ['Copper'] }));
    expect(settingsHash(old as PlanSettings)).toBe(settingsHash({ ...s, avoid: [] }));
  });
  it('keeps out of what the full line uses although its least-raw probe used none of it (fix spec R3)', async () => {
    // A Part is 1 copper ingot (1 raw, 1 step) or the end of a 4-step chain from 0.99 tin ingots (0.99 raw). The probe
    // the avoid search starts from runs the chain and uses no copper; the 2 % step charge would take the copper.
    const p = extended({
      items: [
        { key: 't:part@0', name: 'Part' }, { key: 't:tin_part1@0', name: 'Tin Part 1' }, { key: 't:tin_part2@0', name: 'Tin Part 2' },
        { key: 't:tin_part3@0', name: 'Tin Part 3' },
      ],
      recipes: [
        { id: 'part-copper', map: 'gt.recipe.assembler', in: [['t:copper_ingot@0', 1]], out: [['t:part@0', 1]], eut: 16, dur: 100 },
        { id: 'part-tin-1', map: 'gt.recipe.assembler', in: [['t:tin_ingot@0', 99]], out: [['t:tin_part1@0', 100]], eut: 16, dur: 100 },
        { id: 'part-tin-2', map: 'gt.recipe.assembler', in: [['t:tin_part1@0', 1]], out: [['t:tin_part2@0', 1]], eut: 16, dur: 100 },
        { id: 'part-tin-3', map: 'gt.recipe.assembler', in: [['t:tin_part2@0', 1]], out: [['t:tin_part3@0', 1]], eut: 16, dur: 100 },
        { id: 'part-tin-4', map: 'gt.recipe.assembler', in: [['t:tin_part3@0', 1]], out: [['t:part@0', 1]], eut: 16, dur: 100 },
      ],
    });
    const settings = S({ target: 't:part@0', tier: 1 });
    const chain = ['part-tin-1', 'part-tin-2', 'part-tin-3', 'part-tin-4'];
    expect((await planLine(p, settings, emptyContext())).steps.map((s) => s.id)).toEqual(['part-copper']);
    expect((await planLine(p, { ...settings, stepCharge: 0 }, emptyContext())).steps.map((s) => s.id)).toEqual(chain);
    const plan = await planLine(p, { ...settings, avoid: ['Copper'] }, emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(chain);
    expect(usesOf(p, plan, 'Copper')).toEqual([]);
    expect(plan.avoided).toEqual([{ key: 't:copper_ingot@0', name: 'Copper Ingot', unavoidable: false }]);
    expect(avoidWarnings(plan)).toEqual([]);
  });
  it('plans the plain line when it uses nothing avoided', async () => {
    // Fix spec R3: the plain line and the avoid trials are probes (least raw material only) and only the line the avoid
    // list leads to is planned in full; here that is the plain line itself.
    const settings = S({ target: 't:circuit@0', tier: 2 });
    const open = await planLine(pack, settings, emptyContext());
    const p = await planLine(pack, { ...settings, avoid: ['Titanium'] }, emptyContext());
    expect(p.status).toBe('ok');
    expect(p.steps).toEqual(open.steps);
    expect(p.avoided).toEqual([]);
  });
  it('(g) plans a project without an avoid list exactly like one with an empty list', async () => {
    const s = S({ target: 't:circuit@0', amount: 30, tier: 1 });
    const { avoid: _, ...old } = s;
    const before = await planLine(pack, old as PlanSettings, emptyContext());
    const after = await planLine(pack, s, emptyContext());
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(before.avoided).toBeUndefined();
  });
  it('drops a pinned recipe that uses an avoided material, saying so (ruling R8)', async () => {
    const p = await planLine(copperCable, S({ target: 't:widget@0', tier: 1, avoid: ['Tin'], recipeChoice: { 't:hull_lv@0': 'hull-lv' } }), emptyContext());
    expect(p.steps.map((s) => s.id)).toContain('hull-lv-copper');
    expect(p.warnings).toContainEqual({
      code: 'stale-choice', key: 't:hull_lv@0', text: 'LV Machine Hull: the chosen recipe uses a material on the avoid list; using the best one that avoids it',
    });
  });
});

describe('planLine with an avoided good a machine holds (final review: lenses, molds, catalysts)', () => {
  /**
   * An Iron Gear is cast from 4 iron ingots by an alloy smelter that holds a Tin Mold; with `byHand` it can also be
   * crafted from 6 iron plates, which costs more.
   */
  const gears = (byHand: boolean): Pack => extended({
    items: [
      { key: 't:tin_mold@0', name: 'Tin Mold', gt: { prefix: 'toolHeadMold', material: 'Tin' } },
      { key: 't:iron_mold@0', name: 'Iron Mold', gt: { prefix: 'toolHeadMold', material: 'Iron' } },
      { key: 't:iron_gear@0', name: 'Iron Gear' },
    ],
    ...ALLOY_SMELTER,
    recipes: [
      { id: 'cast-gear', map: 'gt.recipe.alloysmelter', in: [['t:iron_ingot@0', 4], { nc: 't:tin_mold@0' }], out: [['t:iron_gear@0', 1]], eut: 16, dur: 100 },
      ...(byHand ? [CRAFT_GEAR] : []),
    ],
  });
  const settings = S({ target: 't:iron_gear@0', tier: 1 });
  const oneOffs = (plan: Plan): string[] => plan.buildList.filter((l) => l.group === 'one-off').map((l) => l.key);

  it('re-allows a mold the machine holds when nothing else makes the part, and flags the step that needs it', async () => {
    const p = gears(false);
    expect(oneOffs(await planLine(p, settings, emptyContext()))).toEqual(['t:tin_mold@0']);
    const plan = await planLine(p, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['cast-gear']);
    expect(plan.avoided).toEqual([{ key: 't:tin_mold@0', name: 'Tin Mold', unavoidable: true }]);
    expect(avoidWarnings(plan)).toEqual([
      { code: 'avoid-unavoidable', key: 't:tin_mold@0', stepId: 'cast-gear', text: 'Basic Alloy Smelter needs Tin Mold — no recipe at LV avoids it' }]);
    expect(oneOffs(plan)).toEqual(['t:tin_mold@0']);   // the materials view marks it: unavoidable in `avoided`
    // A batch is flagged the same way.
    const batch = await planLine(p, { ...settings, mode: 'makeN', amount: 2, avoid: ['Tin'] }, emptyContext());
    expect(batch.avoided).toEqual(plan.avoided);
    expect(avoidWarnings(batch)).toEqual(avoidWarnings(plan));
  });
  it('takes the way round a held mold, also in the swap lists, and builds no such mold', async () => {
    const p = gears(true);
    expect((await planLine(p, settings, emptyContext())).steps.map((s) => s.id)).toEqual(['cast-gear']);   // 4 ingots, not 6
    const plan = await planLine(p, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['bend-plate', 'craft-gear']);
    expect(plan.avoided).toEqual([{ key: 't:tin_mold@0', name: 'Tin Mold', unavoidable: false }]);
    expect(avoidWarnings(plan)).toEqual([]);
    expect(plan.buildList.map((l) => l.key)).not.toContain('t:tin_mold@0');
    expect(plan.steps.find((s) => s.id === 'craft-gear')?.alternatives.map((a) => a.recipeId)).toEqual(['craft-gear']);
  });
  it('holds the allowed option of a slot that also takes the avoided one, and has that one built', async () => {
    const p = gears(false);
    // Either mold casts the gear, the tin one listed first.
    p.recipeById.get('cast-gear')!.inputs.find((ing) => !ing.consumed)!.options.push({ key: 't:iron_mold@0', amount: 1 });
    expect(oneOffs(await planLine(p, settings, emptyContext()))).toEqual(['t:tin_mold@0']);
    const plan = await planLine(p, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['cast-gear']);
    expect(plan.avoided).toEqual([{ key: 't:tin_mold@0', name: 'Tin Mold', unavoidable: false }]);
    expect(avoidWarnings(plan)).toEqual([]);
    expect(oneOffs(plan)).toEqual(['t:iron_mold@0']);
    expect(plan.buildSteps.find((s) => s.id === 'configure:cast-gear')?.text).toBe('Put Iron Mold in the Basic Alloy Smelter that makes Iron Gear');
  });
  it('holds an option off the list where it can, even with the avoided mold allowed back for another step', async () => {
    // A Gear Kit is a gear and a ring. Only the Tin Mold casts the gear; the ring takes it or an Iron Mold.
    const p = extended({
      items: [
        { key: 't:tin_mold@0', name: 'Tin Mold', gt: { prefix: 'toolHeadMold', material: 'Tin' } },
        { key: 't:iron_mold@0', name: 'Iron Mold', gt: { prefix: 'toolHeadMold', material: 'Iron' } },
        { key: 't:iron_gear@0', name: 'Iron Gear' }, { key: 't:iron_ring@0', name: 'Iron Ring' }, { key: 't:gear_kit@0', name: 'Gear Kit' },
      ],
      ...ALLOY_SMELTER,
      recipes: [
        { id: 'cast-gear', map: 'gt.recipe.alloysmelter', in: [['t:iron_ingot@0', 4], { nc: 't:tin_mold@0' }], out: [['t:iron_gear@0', 1]], eut: 16, dur: 100 },
        { id: 'cast-ring', map: 'gt.recipe.alloysmelter', in: [['t:iron_ingot@0', 1], { nc: 't:tin_mold@0' }], out: [['t:iron_ring@0', 1]], eut: 16, dur: 100 },
        { id: 'kit', map: 'crafting', in: [['t:iron_gear@0', 1], ['t:iron_ring@0', 1]], out: [['t:gear_kit@0', 1]] },
      ],
    });
    p.recipeById.get('cast-ring')!.inputs.find((ing) => !ing.consumed)!.options.push({ key: 't:iron_mold@0', amount: 1 });
    const plan = await planLine(p, S({ target: 't:gear_kit@0', tier: 1, avoid: ['Tin'] }), emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['cast-gear', 'cast-ring', 'kit']);
    expect(plan.avoided).toEqual([{ key: 't:tin_mold@0', name: 'Tin Mold', unavoidable: true }]);
    expect(avoidWarnings(plan)).toEqual([
      { code: 'avoid-unavoidable', key: 't:tin_mold@0', stepId: 'cast-gear', text: 'Basic Alloy Smelter needs Tin Mold — no recipe at LV avoids it' }]);
    expect(oneOffs(plan)).toEqual(['t:iron_mold@0', 't:tin_mold@0']);
    expect(plan.buildSteps.find((s) => s.id === 'configure:cast-ring')?.text).toBe('Put Iron Mold in the Basic Alloy Smelter that makes Iron Ring');
  });
});

/** The dearer way to an Iron Gear: crafted from 6 iron plates. */
const CRAFT_GEAR: RecipeSpec = { id: 'craft-gear', map: 'crafting', in: [['t:iron_plate@0', 6]], out: [['t:iron_gear@0', 1]] };
/** Bronze from copper and an iron plate: no tin, but dearer, and only once iron plates are made. */
const TIN_FREE_BRONZE: RecipeSpec = {
  id: 'alloy-bronze-b', map: 'gt.recipe.alloysmelter', in: [['t:copper_ingot@0', 1], ['t:iron_plate@0', 1]], out: [['t:bronze_ingot@0', 1]], eut: 16, dur: 200,
};

describe('planLine with a derived material made from an avoided one (final review)', () => {
  /**
   * Bronze is mined nowhere: an alloy smelter makes 4 ingots from 3 copper and 1 tin, a macerator grinds an ingot into
   * Bronze Dust, and the line buys either as a derived material. A Bronze Gear takes 4 ingots, a Bronze Rotor 2 dusts.
   * With `tinFree`, bronze can also be alloyed from copper and an iron plate; as iron plates are made, not mined, tin
   * stays what bronze was first made from.
   */
  const bronze = (tinFree: boolean): Pack => extended({
    items: [
      { key: 't:bronze_ingot@0', name: 'Bronze Ingot', gt: { prefix: 'ingot', material: 'Bronze' } },
      { key: 't:bronze_dust@0', name: 'Bronze Dust', gt: { prefix: 'dust', material: 'Bronze' } },
      { key: 't:bronze_gear@0', name: 'Bronze Gear' }, { key: 't:bronze_rotor@0', name: 'Bronze Rotor' },
    ],
    ...ALLOY_SMELTER,
    recipes: [
      { id: 'alloy-bronze', map: 'gt.recipe.alloysmelter', in: [['t:copper_ingot@0', 3], ['t:tin_ingot@0', 1]], out: [['t:bronze_ingot@0', 4]], eut: 16, dur: 200 },
      { id: 'mace-bronze', map: 'gt.recipe.macerator', in: [['t:bronze_ingot@0', 1]], out: [['t:bronze_dust@0', 1]], eut: 2, dur: 100 },
      { id: 'bronze-gear', map: 'crafting', in: [['t:bronze_ingot@0', 4]], out: [['t:bronze_gear@0', 1]] },
      { id: 'bronze-rotor', map: 'crafting', in: [['t:bronze_dust@0', 2]], out: [['t:bronze_rotor@0', 1]] },
      ...(tinFree ? [TIN_FREE_BRONZE] : []),
    ],
  });

  it('buys it only when nothing at the tier avoids it, flagging each use with what it is made from', async () => {
    const p = bronze(false);
    const settings = S({ target: 't:bronze_gear@0', tier: 1 });
    const open = await planLine(p, settings, emptyContext());
    expect(open.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:bronze_ingot@0', 'derived']]);   // no tin in sight
    const plan = await planLine(p, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.avoided).toEqual([{ key: 't:bronze_ingot@0', name: 'Bronze Ingot', unavoidable: true, madeFrom: ['t:tin_ingot@0'] }]);
    expect(avoidWarnings(plan)).toEqual([{
      code: 'avoid-unavoidable', key: 't:bronze_ingot@0', stepId: 'bronze-gear',
      text: 'Crafting table (by hand) uses Bronze Ingot (made from Tin Ingot) — no recipe at LV avoids it',
    }]);
    expect(plan.names?.['t:tin_ingot@0']).toBe('Tin Ingot');
    // Bronze Dust is ground from the ingot, so what the ingot is made from counts for it too.
    const rotor = await planLine(p, S({ target: 't:bronze_rotor@0', tier: 1, avoid: ['Tin'] }), emptyContext());
    expect(rotor.avoided).toEqual([{ key: 't:bronze_dust@0', name: 'Bronze Dust', unavoidable: true, madeFrom: ['t:tin_ingot@0'] }]);
    expect(avoidWarnings(rotor).map((w) => [w.key, w.stepId, w.text])).toEqual([
      ['t:bronze_dust@0', 'bronze-rotor', 'Crafting table (by hand) uses Bronze Dust (made from Tin Ingot) — no recipe at LV avoids it']]);
  });
  it('makes it in the line instead where that keeps the avoided material out', async () => {
    const p = bronze(true);
    const settings = S({ target: 't:bronze_gear@0', tier: 1 });
    expect((await planLine(p, settings, emptyContext())).rawInputs.map((r) => r.key)).toEqual(['t:bronze_ingot@0']);
    const plan = await planLine(p, { ...settings, avoid: ['Tin'] }, emptyContext());
    expect(plan.steps.map((s) => s.id)).toEqual(['alloy-bronze-b', 'bend-plate', 'bronze-gear']);
    expect(plan.rawInputs.map((r) => r.key)).toEqual(['t:copper_ingot@0', 't:iron_ingot@0']);
    expect(usesOf(p, plan, 'Tin')).toEqual([]);
    expect(plan.avoided).toEqual([{ key: 't:bronze_ingot@0', name: 'Bronze Ingot', unavoidable: false, madeFrom: ['t:tin_ingot@0'] }]);
    expect(avoidWarnings(plan)).toEqual([]);
  });
  it('flags what the plan buys where its least-raw probe used the avoided material itself (fix spec R3)', async () => {
    // A Bronze Gear is 4 bought Bronze Ingots (4 raw, 1 step) or a tenth of 39 tin rods, each from a tin plate (3.9 raw,
    // 3 steps). The least raw material, the probe the avoid search starts from, runs the tin chain; the 2 % step charge
    // buys the bronze, which is made from tin. Nothing at LV does without tin, so the plan buys the bronze and says so.
    const p = extended({
      items: [
        { key: 't:bronze_ingot@0', name: 'Bronze Ingot', gt: { prefix: 'ingot', material: 'Bronze' } },
        { key: 't:bronze_gear@0', name: 'Bronze Gear' }, { key: 't:tin_plate@0', name: 'Tin Plate' }, { key: 't:tin_rod@0', name: 'Tin Rod' },
      ],
      ...ALLOY_SMELTER,
      recipes: [
        { id: 'alloy-bronze', map: 'gt.recipe.alloysmelter', in: [['t:copper_ingot@0', 3], ['t:tin_ingot@0', 1]], out: [['t:bronze_ingot@0', 4]], eut: 16, dur: 200 },
        { id: 'bronze-gear', map: 'crafting', in: [['t:bronze_ingot@0', 4]], out: [['t:bronze_gear@0', 1]] },
        { id: 'tin-plate', map: 'gt.recipe.assembler', in: [['t:tin_ingot@0', 1]], out: [['t:tin_plate@0', 1]], eut: 16, dur: 100 },
        { id: 'tin-rod', map: 'gt.recipe.assembler', in: [['t:tin_plate@0', 1]], out: [['t:tin_rod@0', 1]], eut: 16, dur: 100 },
        { id: 'tin-gear', map: 'gt.recipe.assembler', in: [['t:tin_rod@0', 39]], out: [['t:bronze_gear@0', 10]], eut: 16, dur: 100 },
      ],
    });
    const settings = S({ target: 't:bronze_gear@0', tier: 1, automateCrafting: true });
    expect((await planLine(p, settings, emptyContext())).rawInputs.map((r) => [r.key, r.leafClass])).toEqual([['t:bronze_ingot@0', 'derived']]);
    expect((await planLine(p, { ...settings, stepCharge: 0 }, emptyContext())).steps.map((s) => s.id)).toEqual(['tin-gear', 'tin-plate', 'tin-rod']);
    const plan = await planLine(p, { ...settings, avoid: ['t:tin_ingot@0'] }, emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s) => s.id)).toEqual(['bronze-gear']);
    expect(plan.avoided).toEqual([{ key: 't:bronze_ingot@0', name: 'Bronze Ingot', unavoidable: true, madeFrom: ['t:tin_ingot@0'] }]);
    expect(avoidWarnings(plan)).toEqual([{
      code: 'avoid-unavoidable', key: 't:bronze_ingot@0', stepId: 'bronze-gear',
      text: 'Crafting table (automated) uses Bronze Ingot (made from Tin Ingot) — no recipe at LV avoids it',
    }]);
    // With no charge the plan is the probe's tin chain, and the tin is flagged where it goes in.
    const least = await planLine(p, { ...settings, stepCharge: 0, avoid: ['t:tin_ingot@0'] }, emptyContext());
    expect(least.steps.map((s) => s.id)).toEqual(['tin-gear', 'tin-plate', 'tin-rod']);
    expect(least.avoided).toEqual([{ key: 't:tin_ingot@0', name: 'Tin Ingot', unavoidable: true }]);
    expect(avoidWarnings(least).map((w) => [w.code, w.key, w.stepId])).toEqual([['avoid-unavoidable', 't:tin_ingot@0', 'tin-plate']]);
  });
});
