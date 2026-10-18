// Materials to avoid (spec §3.3, architecture §11.25, plan 2026-10-18-08): the planner keeps every good an avoid entry
// matches out of the line while a plan without it exists, and otherwise re-allows only what it cannot do without and
// flags each step that uses it. Packs are Mini-GT plus a few invented items and recipes (ruling R13: mini-gt.ts and
// pack-spec.ts stay as they are).

import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { resolveAvoid } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine, settingsHash } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const pack = miniGt();
const S = (p: Partial<PlanSettings>): PlanSettings => ({ ...defaultSettings(), ...p });
/** Half a dust or ingot in GT's material units: 1x wires and cables. */
const HALF = 1_814_400;

/** Mini-GT with more items and recipes. */
function extended(extra: Pick<PackSpec, 'items' | 'recipes'>): Pack {
  const spec = structuredClone(MINI_GT);
  spec.items = [...(spec.items ?? []), ...(extra.items ?? [])];
  spec.recipes = [...(spec.recipes ?? []), ...(extra.recipes ?? [])];
  return packFromSpec(spec);
}

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
    const { goods, unknown } = resolveAvoid(pack, ['Iron', 't:redstone@0', 'fluid:oil', 'tin', 'Unobtainium']);
    expect([...goods].sort()).toEqual(['fluid:molten.iron', 'fluid:oil', 't:iron_dust@0', 't:iron_ingot@0', 't:iron_ore@0', 't:iron_plate@0', 't:redstone@0']);
    expect(unknown).toEqual(['tin', 'Unobtainium']);
  });
  it("takes in a material's ore parts and its molten, plasma and plain fluids; a material with no goods is known but matches nothing", () => {
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
    expect(resolveAvoid(p, ['Unused'])).toEqual({ goods: new Set(), unknown: [] });
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
