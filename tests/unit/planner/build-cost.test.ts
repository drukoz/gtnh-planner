import { describe, it, expect } from 'vitest';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { largeBenderSpec, withPriceGap } from '../../helpers/build-fixtures.ts';
import {
  MACHINE_PRICE_MEMO_SIZE, bomBuildCost, buildKeys, gapText, hatchSet, itemPrices, machineBuildCost, machineGap, pricingSettings,
  structureParts, type ItemPrices,
} from '../../../src/server/planner/build-cost.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext } from '../../../src/server/planner/plan.ts';
import { PSEUDO_MACHINES } from '../../../src/shared/gt/tiers.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Machine, Pack } from '../../../src/shared/types/pack.ts';
import type { PlanSettings } from '../../../src/shared/types/plan.ts';

const lv: PlanSettings = { ...defaultSettings(), tier: 1 };
const mv: PlanSettings = { ...defaultSettings(), tier: 2 };
const ctx = emptyContext();

/** The prices of every machine of `pack` at `s`. */
function pricesOf(pack: Pack, s: PlanSettings): Promise<ItemPrices> {
  return itemPrices(pack, s, ctx, buildKeys(pack, [...pack.machines.values()]));
}

function machine(pack: Pack, mteId: number): Machine {
  const m = pack.machines.get(mteId);
  if (m === undefined) throw new Error(`no machine ${mteId}`);
  return m;
}

/** A fresh Mini-GT pack with `recipes` added. */
function miniWith(...recipes: NonNullable<PackSpec['recipes']>): Pack {
  const spec = structuredClone(MINI_GT);
  return packFromSpec({ ...spec, recipes: [...(spec.recipes ?? []), ...recipes] });
}

const HATCHES = 'gregtech.api.metatileentity.implementations.';

describe('machineBuildCost', () => {
  it('prices a singleblock through its crafting chain', async () => {
    const pack = miniGt();
    // LV: hull 9 (8 plates + 2 cables) + 2 circuits of 3 + 2 cables (121), 2 plates (101) or 4 wires (111).
    const atLv = await pricesOf(pack, lv);
    expect([121, 101, 111].map((id) => machineBuildCost(pack, atLv, machine(pack, id)))).toEqual([16, 17, 17]);
    // MV: the circuit costs 2.5 (circuit-mv: 2 wires 1 + redstone 1 + 72 L molten iron 0.5).
    const atMv = await pricesOf(pack, mv);
    expect([121, 101, 111].map((id) => machineBuildCost(pack, atMv, machine(pack, id)))).toEqual([15, 16, 16]);
  });

  it('has no build cost for a machine nothing makes', async () => {
    const pack = miniGt();
    const prices = await pricesOf(pack, lv);
    expect(machineBuildCost(pack, prices, machine(pack, 122))).toBeNull();
    // A priced item on a pseudo machine (packFromSpec packs hold none).
    expect(machineBuildCost(pack, prices, { ...machine(pack, 121), mteId: PSEUDO_MACHINES.CRAFTING_TABLE })).toBeNull();
    expect(machineBuildCost(pack, prices, undefined)).toBeNull();
  });

  it('prices a multiblock as its controller and structure, hatches at their lowest tier', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const m1100 = machine(pack, 1100);
    // The structure's HV muffler counts as the LV one.
    expect([...structureParts(pack, m1100)].sort()).toEqual([['machine:91@0', 1], ['t:casing@0', 7]]);
    // Controller 3 × 3 + 6 = 15, casings 7 × 6 = 42, LV muffler 9 + 1 = 10.
    expect(machineBuildCost(pack, await pricesOf(pack, lv), m1100)).toBe(67);
  });

  it('adds the hatches a multiblock needs to run at its hatch tier', async () => {
    const pack = packFromSpec(largeBenderSpec());
    const m1100 = machine(pack, 1100);
    const bendPlate = pack.recipeById.get('bend-plate')!;
    // Item in, item out, energy, maintenance.
    expect([...hatchSet(pack, m1100, bendPlate, 1)].sort())
      .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:81@0', 1]]);
    // 67 + 4 hatches of 10 − the 4 casings they stand on, 6 each.
    expect(machineBuildCost(pack, await pricesOf(pack, lv), m1100, { recipe: bendPlate, tier: 1 })).toBe(83);
    const atMv = await pricesOf(pack, mv);
    // Controller 3 × 2.5 + 6 = 13.5, so 65.5 + 40 − 24; with the MV energy hatch (15) 65.5 + 45 − 24.
    expect(machineBuildCost(pack, atMv, m1100, { recipe: bendPlate, tier: 1 })).toBe(81.5);
    expect(machineBuildCost(pack, atMv, m1100, { recipe: bendPlate, tier: 2 })).toBe(86.5);
  });

  it('fits a hatch per fluid and an input bus for a held item, and leaves out a hatch the pack lacks', () => {
    const spec = largeBenderSpec();
    spec.machines?.push(
      { mteId: 42, name: 'Input Hatch (MV)', kind: 'hatch', tier: 2, maps: [], cls: `${HATCHES}MTEHatchInput` },
      { mteId: 41, name: 'Input Hatch (LV)', kind: 'hatch', tier: 1, maps: [], cls: `${HATCHES}MTEHatchInput` },
    );
    spec.recipes?.push({
      id: 'press-mix', map: 'gt.recipe.metalbender', in: [{ nc: 't:mold@0' }, ['fluid:a', 100], ['fluid:b', 100]],
      out: [['t:mixed@0', 1], ['fluid:c', 50]], eut: 16,
    });
    const pack = packFromSpec(spec);
    const m1100 = machine(pack, 1100);
    // Two fluids in, at the lowest input hatch tier; no output hatch in this pack for fluid:c.
    expect([...hatchSet(pack, m1100, pack.recipeById.get('press-mix')!, 2)].sort())
      .toEqual([['machine:41@0', 2], ['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1], ['machine:82@0', 1]]);
    // No HV energy hatch in this pack, and a singleblock runs with no hatches.
    expect([...hatchSet(pack, m1100, pack.recipeById.get('bend-plate')!, 3)].sort())
      .toEqual([['machine:51@0', 1], ['machine:61@0', 1], ['machine:71@0', 1]]);
    expect(hatchSet(pack, machine(pack, 101), pack.recipeById.get('bend-plate')!, 1).size).toBe(0);
  });

  it('prices free inputs at 0 where a supply machine exists', async () => {
    const spec = structuredClone(MINI_GT);
    const pack = packFromSpec({
      ...spec,
      machines: [...(spec.machines ?? []), { mteId: 1140, name: 'Basic Pump', tier: 1, maps: [], cls: 'gregtech.common.tileentities.machines.basic.MTEPump' }],
      recipes: [...(spec.recipes ?? []), {
        id: 'make-161', map: 'gt.recipe.assembler', in: [['t:hull_lv@0', 1], ['fluid:water', 1000]], out: [['machine:161@0', 1]], eut: 16, dur: 100,
      }],
    });
    // A running line here plans a pump for its water; a machine's build materials take water free.
    expect(planBasis(pack, lv, ctx).supplied.has('fluid:water')).toBe(true);
    expect(machineBuildCost(pack, await pricesOf(pack, lv), machine(pack, 161))).toBe(9);
  });
});

describe('machineGap', () => {
  it('tells why a machine has no price', async () => {
    const pack = miniGt();
    const prices = await pricesOf(pack, lv);
    const m122 = machine(pack, 122);
    expect(prices.gap('machine:122@0')).toEqual({ kind: 'no-recipe' });
    const none = machineGap(pack, prices, m122);
    expect(none).toEqual({ kind: 'no-recipe' });
    expect(gapText(pack, m122, none!, 1)).toBe('no recipe in this pack');
    expect(prices.gap('machine:121@0')).toBeUndefined();
    expect(machineGap(pack, prices, machine(pack, 121))).toBeNull();

    // bend-ti needs 120 EU/t, above any LV bender, so nothing in the graph makes the plate.
    const ti = miniWith({ id: 'make-122', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:titanium_plate@0', 1]], out: [['machine:122@0', 1]] });
    const tiPrices = await pricesOf(ti, lv);
    const plate = { kind: 'unavailable', item: 't:titanium_plate@0' };
    expect(tiPrices.gap('machine:122@0')).toEqual(plate);
    const needs = machineGap(ti, tiPrices, machine(ti, 122));
    expect(needs).toEqual(plate);
    expect(gapText(ti, machine(ti, 122), needs!, 1)).toBe('needs Titanium Plate, not available at LV');

    // Its only recipe needs an MV assembler.
    const mvOnly = miniWith({ id: 'make-122', map: 'gt.recipe.assembler', in: [['t:hull_lv@0', 1]], out: [['machine:122@0', 1]], eut: 120, dur: 100 });
    const own = machineGap(mvOnly, await pricesOf(mvOnly, lv), machine(mvOnly, 122));
    expect(own).toEqual({ kind: 'unavailable', item: 'machine:122@0' });
    expect(gapText(mvOnly, machine(mvOnly, 122), own!, 1)).toBe('nothing at LV makes it');

    // Its Seed Crystal and Crystal Sprout only make each other.
    const seed = packFromSpec(withPriceGap(MINI_GT, [122]));
    const seedPrices = await pricesOf(seed, lv);
    expect(seedPrices.gap('machine:122@0')).toEqual({ kind: 'gap' });
    const gap = machineGap(seed, seedPrices, machine(seed, 122));
    expect(gap).toEqual({ kind: 'gap' });
    expect(gapText(seed, machine(seed, 122), gap!, 1)).toBeNull();
  });

  it('names the part a multiblock cannot get', async () => {
    // The controller is made from circuits alone, and nothing makes the casings of its structure.
    const spec = largeBenderSpec();
    spec.recipes = [...(spec.recipes ?? []).filter((r) => r.id !== 'make-casing' && r.id !== 'make-1100'),
      { id: 'make-1100', map: 'crafting', in: [['t:circuit@0', 3]], out: [['machine:1100@0', 1]] }];
    const pack = packFromSpec(spec);
    const prices = await pricesOf(pack, lv);
    const m1100 = machine(pack, 1100);
    expect(prices.gap('t:casing@0')).toEqual({ kind: 'no-recipe' });
    expect(machineBuildCost(pack, prices, m1100)).toBeNull();
    const gap = machineGap(pack, prices, m1100);
    expect(gap).toEqual({ kind: 'unavailable', item: 't:casing@0' });
    expect(gapText(pack, m1100, gap!, 1)).toBe('needs Machine Casing, not available at LV');
  });
});

describe('itemPrices', () => {
  it('memoizes prices per pricing context', async () => {
    const pack = miniGt();
    const keys = buildKeys(pack, [...pack.machines.values()]);
    const first = itemPrices(pack, lv, ctx, keys);
    const line: PlanSettings = { ...lv, target: 't:iron_plate@0', amount: 60, mode: 'makeN', logistics: 'ae2', buildHorizonHours: null };
    expect(itemPrices(pack, line, ctx, [...keys].reverse())).toBe(first);
    const dearer = itemPrices(pack, { ...lv, costOverrides: { Iron: 2 } }, ctx, keys);
    expect(dearer).not.toBe(first);
    // Hull 8 × 2 + 1 = 17, circuits 2 × 4 = 8, cables 1.
    expect(machineBuildCost(pack, await dearer, machine(pack, 121))).toBe(26);
  });

  it('keeps the most recently used pricings of a pack', async () => {
    const pack = miniGt();
    const keys = ['machine:121@0'];
    const others = Array.from({ length: MACHINE_PRICE_MEMO_SIZE }, (_, i): PlanSettings => ({ ...lv, costOverrides: { Iron: 2 + i } }));
    const first = itemPrices(pack, lv, ctx, keys);
    const asked = [first, ...others.slice(0, -1).map((s) => itemPrices(pack, s, ctx, keys))];
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
    // One more drops the least recently used, which is no longer `first`.
    asked.push(itemPrices(pack, others.at(-1)!, ctx, keys));
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
    const again = itemPrices(pack, others[0]!, ctx, keys);
    expect(asked).not.toContain(again);
    await Promise.all([...asked, again]);
  });

  it('prices machines without the project\'s target and pins', async () => {
    // Slot 1 of make-151 takes an iron or a titanium plate; nothing at LV makes the titanium one.
    const pack = miniWith({
      id: 'make-151', map: 'crafting', in: [['t:hull_lv@0', 1], { any: [['t:iron_plate@0', 1], ['t:titanium_plate@0', 1]] }], out: [['machine:151@0', 1]],
    });
    const keys = buildKeys(pack, [...pack.machines.values()]);
    const project: PlanSettings = { ...lv, target: 't:iron_dust@0', optionChoice: { 'make-151#1': 't:titanium_plate@0' } };
    const first = itemPrices(pack, project, ctx, keys);
    // Hull 9 + iron plate 1; pinned to the titanium plate it would have no price.
    expect(machineBuildCost(pack, await first, machine(pack, 151))).toBe(10);
    expect(pricingSettings(project, ctx)).toEqual(pricingSettings(lv, ctx));
    expect(itemPrices(pack, lv, ctx, keys)).toBe(first);
  });
});

describe('bomBuildCost', () => {
  it('prices layout parts and takes off replaced casings', async () => {
    const pack = miniGt();
    const add = [{ key: 'machine:121@0', amount: 2, why: 'a' }, { key: 't:iron_plate@0', amount: 3, why: 'b' }];
    expect(await bomBuildCost(pack, lv, ctx, add, [{ key: 't:iron_plate@0', amount: 1, why: 'c' }])).toBe(34);
    // A part without a price counts nothing, and the total never goes below 0.
    expect(await bomBuildCost(pack, lv, ctx, [{ key: 'machine:122@0', amount: 1, why: 'd' }], [{ key: 't:iron_plate@0', amount: 1, why: 'e' }])).toBe(0);
  });
});
