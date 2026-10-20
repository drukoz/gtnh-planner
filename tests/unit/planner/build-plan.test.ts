// Plan assembly with build cost (plan 12 Task 5; design spec §3.2 Make N, §3.3 Objective, "How materials are counted" and
// "Reusing machines we have", architecture §11.39): the steps follow the build-cost solve — whole machine counts, the
// tier it picked, sharing pools of new and owned machines on AE2 and Project Red lines, owned machines of another tier —
// and the plan says what it costs to run and to build, which new machines it cannot price, and which machines cannot be
// built here (their steps walked around, or the line blocked); sand is made from rock-breaker cobblestone where that pays.
// `S` and the sand cases' `G` craft by hand: their numbers, hand steps and `hand-step` warnings were worked out with
// crafting-table steps by hand (HAND_STEP_WEIGHT 3), while the Auto Workbench is the default (the controller's ruling).

import { describe, it, expect } from 'vitest';
import { kitSpec, sandSpec, withPriceGap } from '../../helpers/build-fixtures.ts';
import { MINI_GT, miniGt } from '../../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../../helpers/pack-spec.ts';
import { assignOwned } from '../../../src/server/planner/machines.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { sig9 } from '../../../src/server/planner/round.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { LogisticsMode, MachineWhere, Plan, PlanContext, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';

const COBBLE = 'minecraft:cobblestone@0';
const SAND = 'minecraft:sand@0';
/** Basic Circuits at LV, crafted by hand (see the file comment). */
const S = (p: Partial<PlanSettings> = {}): PlanSettings => ({ ...defaultSettings(), target: 't:circuit@0', tier: 1, automateCrafting: false, ...p });
/** Glass at LV, 1 a minute, a step charge of 2 %, crafted by hand. */
const G = (p: Partial<PlanSettings> = {}): PlanSettings => ({
  ...defaultSettings(), target: 't:glass@0', tier: 1, amount: 1, per: 'min', stepCharge: 0.02, automateCrafting: false, ...p,
});
/** A world scan's base with these machines. */
const owning = (...owned: PlanContext['ownedMachines']): PlanContext => ({ ...emptyContext(), ownedMachines: owned });

const stepOf = (plan: Plan, id: string): PlanStep => {
  const step = plan.steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`no step ${id} in ${plan.steps.map((s) => s.id).join(', ')}`);
  return step;
};
const ids = (plan: Plan): string[] => plan.steps.map((s) => s.id);
const codes = (plan: Plan): string[] => plan.warnings.map((w) => w.code);
const placeText = (plan: Plan): string => plan.buildSteps.find((b) => b.kind === 'place')?.text ?? '';
const configureTexts = (plan: Plan): string[] => plan.buildSteps.filter((b) => b.kind === 'configure').map((b) => b.text);

describe('build cost in the plan', () => {
  it('plans whole machines and reports the build cost over 24 hours', async () => {
    const plan = await planLine(miniGt(), S({ amount: 30 }), emptyContext());
    expect(plan.status).toBe('ok');
    // circuit-lv 0.5 runs/s ÷ 0.1; bend-plate 2.5 → 3; wire 2.5 → 3.
    expect(plan.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['bend-plate', 101, 3], ['circuit-lv', 121, 5], ['wire', 111, 3]]);
    // 3 raw × 0.5/s × 3,600; 5 × 16 + 3 × 17 + 3 × 17.
    expect(plan.cost).toEqual({ runPerHour: 5400, build: 182, horizonHours: 24 });
  });

  it('weighs building a bender against an hour of hand-hammered plates', async () => {
    // Relative to S1 = 3 raw a circuit: over 24 h the bender (1 + 3 × 0.02 + 50 / 72) beats the hammer (4/3 + 0.10 + 33/72);
    // over 1 h it does not (1.06 + 50/3 against 1.433 + 33/3); ignoring build cost, the +25 % cap rules out the hammer's 4 raw.
    const pack = miniGt();
    const hourly = (p: Partial<PlanSettings> = {}): Promise<Plan> => planLine(pack, S({ amount: 1, per: 'hour', ...p }), emptyContext());
    const day = await hourly();
    expect(ids(day)).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    expect(day.cost).toEqual({ runPerHour: 3, build: 50, horizonHours: 24 });
    const hour = await hourly({ buildHorizonHours: 1 });
    expect(ids(hour)).toEqual(['circuit-lv', 'hammer-plate', 'wire']);
    expect(hour.cost).toEqual({ runPerHour: 4, build: 33, horizonHours: 1 });
    expect(hour.warnings).toContainEqual(expect.objectContaining({ code: 'hand-step', stepId: 'hammer-plate' }));
    const ignored = await hourly({ buildHorizonHours: null });
    expect(ids(ignored)).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    expect(ignored.cost).toEqual({ runPerHour: 3, build: 50, horizonHours: null });
  });

  it('plans around the steps whose machines cannot be built', async () => {
    // Controller ruling OQ5 (a): no recipe makes the Advanced Assembler or the Basic Fluid Extractor, so circuit-mv and
    // extract-iron are left out and the line is walked again without them; the MV line runs on LV machines (the Advanced
    // Bending Machine cannot be built either), at MV prices.
    const plan = await planLine(miniGt(), S({ tier: 2, amount: 30 }), emptyContext());
    expect(plan.steps.map((s) => [s.id, s.machine.mteId, s.count])).toEqual([['bend-plate', 101, 3], ['circuit-lv', 121, 5], ['wire', 111, 3]]);
    expect(codes(plan)).not.toContain('build-cost-unknown');
    expect(plan.cost).toEqual({ runPerHour: 5400, build: 171, horizonHours: 24 });
    // Ruling P19: the swap list says why the recipe on a machine that cannot be built cannot be picked.
    expect(stepOf(plan, 'circuit-lv').alternatives.find((a) => a.recipeId === 'circuit-mv')?.unusable)
      .toEqual(['Advanced Assembler cannot be built here (no recipe in this pack)']);
  });

  it('names the machines whose build cost it cannot count', async () => {
    // OQ5 (b): both are made from a Seed Crystal nothing grounds (pricing gaps). The solve weighed them at their stand-in
    // of 16, and the circuit-mv route still wins by 21,600 raw over 24 h.
    const plan = await planLine(packFromSpec(withPriceGap(MINI_GT, [122, 131])), S({ tier: 2, amount: 30 }), emptyContext());
    expect(stepOf(plan, 'circuit-mv')).toMatchObject({ machine: { mteId: 122 }, count: 3 });
    expect(stepOf(plan, 'extract-iron')).toMatchObject({ machine: { mteId: 131 }, count: 1 });
    expect(plan.warnings).toContainEqual({
      code: 'build-cost-unknown', text: 'Not counted in the build cost: Advanced Assembler, Basic Fluid Extractor (their price could not be worked out)',
    });
    // 3 Basic Wiremills at 16; 2.5 raw × 0.5/s × 3,600; 3 Advanced Assemblers and 1 Basic Fluid Extractor not counted.
    expect(plan.cost).toEqual({ runPerHour: 4500, build: 48, horizonHours: 24, unpriced: 4 });
  });
});

describe('sharing pools', () => {
  const kitPack = packFromSpec(kitSpec());
  const AT: MachineWhere = { dim: 0, pos: [10, 64, 10] };
  const oneAssembler = owning({ mteId: 121, count: 1, where: [AT] });
  /** A kit a minute at LV: circuit-lv, gear and kit need 1/6, 1/12 and 1/12 of an assembler. */
  const K = (logistics: LogisticsMode): PlanSettings => S({ target: 't:kit@0', logistics });
  const OWN_OUTPUT = 'One Basic Assembler needs AE2: Project Red cannot feed a machine its own output';

  it('shares one owned assembler between the steps a network can share', async () => {
    // AE2: all three take programmed circuit 2, so they form one sharing pool of 1/3 of a machine on the owned one.
    const ae2 = await planLine(kitPack, K('ae2'), oneAssembler);
    const pool = { id: 'pool:circuit-lv', steps: ['circuit-lv', 'gear', 'kit'] };
    for (const id of pool.steps) {
      expect(stepOf(ae2, id)).toMatchObject({ machine: { mteId: 121 }, count: 1, owned: 1, reused: { count: 1, where: [AT], units: [0] }, pool });
      expect(stepOf(ae2, id).reused?.sharedWith).toEqual(pool.steps.filter((s) => s !== id));
      expect(stepOf(ae2, id).warnings).not.toContain(OWN_OUTPUT);
    }
    expect([stepOf(ae2, 'bend-plate'), stepOf(ae2, 'wire')].map((s) => [s.machine.mteId, s.count])).toEqual([[101, 1], [111, 1]]);
    expect(ae2.cost?.build).toBe(34);
    expect(ae2.power.peakEUt).toBe(48);   // the owned assembler once (16), the bender 24 and the wiremill 8
    expect(placeText(ae2)).toContain('reuse your 1× Basic Assembler');
    expect(configureTexts(ae2)).toContain('Put a Programmed Circuit set to 2 in the Basic Assembler that makes Basic Circuit, Gear, Kit');
    expect(codes(ae2)).not.toContain('routed-shared');

    // Project Red never hands an item back to the machine that made it, so kit (which takes the circuit and the gear)
    // leaves the pool; the larger pool (1/4 against 1/12) takes the owned machine and kit runs on a new one.
    const routed = await planLine(kitPack, K('routed'), oneAssembler);
    const shared = { id: 'pool:circuit-lv', steps: ['circuit-lv', 'gear'] };
    for (const id of shared.steps) {
      expect(stepOf(routed, id)).toMatchObject({ count: 1, owned: 1, reused: { units: [0] }, pool: shared });
      expect(stepOf(routed, id).reused?.sharedWith).toEqual(shared.steps.filter((s) => s !== id));
    }
    expect(stepOf(routed, 'kit')).toMatchObject({ count: 1, owned: 0 });
    expect(stepOf(routed, 'kit').pool).toBeUndefined();
    expect(routed.cost?.build).toBe(50);
    expect(routed.power.peakEUt).toBe(64);
    expect(configureTexts(routed)).toEqual(expect.arrayContaining([
      'Put a Programmed Circuit set to 2 in the Basic Assembler that makes Basic Circuit, Gear',
      'Put a Programmed Circuit set to 2 in the Basic Assembler that makes Kit',
    ]));
    // Rulings P7 and P8: the steps kept apart say why, and the shared machine is flagged to check in game.
    for (const id of ['circuit-lv', 'gear', 'kit']) expect(stepOf(routed, id).warnings).toContain(OWN_OUTPUT);
    expect(routed.warnings.filter((w) => w.code === 'routed-shared')).toEqual([{
      code: 'routed-shared', stepId: 'circuit-lv',
      text: '1× Basic Assembler (Basic Circuit, Gear): one machine runs several recipes over Project Red; if one recipe\'s inputs stay stocked, the other can wait — check it in game',
    }]);

    // Machine to machine: every step has its own machines; the largest load keeps the owned one.
    const direct = await planLine(kitPack, K('direct'), oneAssembler);
    expect(stepOf(direct, 'circuit-lv')).toMatchObject({ count: 1, owned: 1 });
    for (const id of ['gear', 'kit']) expect(stepOf(direct, id)).toMatchObject({ count: 1, owned: 0 });
    expect(direct.steps.filter((s) => s.pool !== undefined)).toEqual([]);
    expect(direct.cost?.build).toBe(66);   // 2 × 16 + 17 + 17
    expect(direct.power.peakEUt).toBe(80);
    expect(codes(direct)).not.toContain('routed-shared');
  });

  it('never shares a machine between programmed circuits', async () => {
    // gear and kit take no circuit: two pools of 1/6 each; the owned machine serves one key, and at equal loads the pool
    // with the smaller first id takes it.
    const plan = await planLine(packFromSpec(kitSpec(null)), K('ae2'), oneAssembler);
    expect(stepOf(plan, 'circuit-lv')).toMatchObject({ count: 1, owned: 1, reused: { units: [0] } });
    expect(stepOf(plan, 'circuit-lv').pool).toBeUndefined();
    const pool = { id: 'pool:gear', steps: ['gear', 'kit'] };
    for (const id of pool.steps) expect(stepOf(plan, id)).toMatchObject({ count: 1, owned: 0, pool });
    expect(plan.cost?.build).toBe(50);   // one new assembler 16 + 17 + 17
    expect(plan.power.peakEUt).toBe(64);
  });
});

describe('sand from cobblestone', () => {
  const sand = packFromSpec(sandSpec());
  const HAMMER_POOL = { id: 'pool:hammer-gravel', steps: ['hammer-gravel', 'hammer-sand'] };

  it('makes sand from cobblestone on one shared forge hammer in AE2 lines', async () => {
    // S1 = 0 on rock-breaker cobblestone, S1g = 1 raw a glass with sand dug, F = 1,440 and a step 28.8: one shared hammer
    // 37 + 4 × 28.8 < gravel by hand 37 + 28.8 × 6 < digging the sand 1,440 + 16 + 28.8.
    const plan = await planLine(sand, G({ logistics: 'ae2' }), emptyContext());
    const supply = plan.steps.find((s) => s.supply === COBBLE);
    expect(supply).toMatchObject({ machine: { mteId: 441 }, count: 1, owned: 0 });
    expect(supply?.pool).toBeUndefined();
    for (const id of HAMMER_POOL.steps) {
      expect(stepOf(plan, id)).toMatchObject({ machine: { mteId: 481 }, count: 1, owned: 0, pool: HAMMER_POOL });
      expect(Math.abs(stepOf(plan, id).utilization - 1 / 30)).toBeLessThanOrEqual(1e-9);
    }
    expect(stepOf(plan, 'smelt-glass')).toMatchObject({ machine: { mteId: 151 }, count: 1 });
    expect(stepOf(plan, 'smelt-glass').pool).toBeUndefined();
    expect(ids(plan)).not.toContain('gravel-hand');
    expect(plan.rawInputs).toEqual([]);
    expect(plan.cost).toEqual({ runPerHour: 0, build: 37, horizonHours: 24 });   // 4 + 17 + 16
    expect(plan.power.peakEUt).toBe(62);   // 30 + the hammer once 16 + 16
    expect(placeText(plan)).toContain('1× Basic Forge Hammer');
  });

  it('gives each step its own hammer on Project Red lines', async () => {
    // Project Red's extractor never routes the gravel back into the hammer that made it: two hammers 54 + 115.2 < gravel
    // by hand 209.8 < digging 1,484.8.
    const plan = await planLine(sand, G({ logistics: 'routed' }), emptyContext());
    for (const id of HAMMER_POOL.steps) {
      expect(stepOf(plan, id)).toMatchObject({ machine: { mteId: 481 }, count: 1, owned: 0 });
      expect(stepOf(plan, id).pool).toBeUndefined();
      expect(stepOf(plan, id).warnings).toContain('One Basic Forge Hammer needs AE2: Project Red cannot feed a machine its own output');
    }
    expect(plan.cost?.build).toBe(54);   // 4 + 2 × 17 + 16
    expect(plan.power.peakEUt).toBe(78);
    expect(placeText(plan)).toContain('2× Basic Forge Hammer');
    expect(codes(plan)).not.toContain('routed-shared');
  });

  it('digs sand on machine-to-machine and EnderIO lines', async () => {
    // Controller Amendment OQ4 (ruling P1): those lines dig gathered blocks until add-on 15 redesigns the direct tail.
    for (const logistics of ['direct', 'enderio'] as const) {
      const plan = await planLine(sand, G({ logistics }), emptyContext());
      expect(ids(plan)).toEqual(['smelt-glass']);
      expect(plan.rawInputs.map((r) => [r.key, r.leafClass, r.canMake])).toEqual([[SAND, 'natural', false]]);
      expect(plan.cost?.build).toBe(16);
      expect(placeText(plan)).not.toContain('Forge Hammer');
    }
  });

  it('crafts gravel by hand at 1 per hour unless a shared hammer has room', async () => {
    // F = 24, a step 0.48, a hand step 1.44. Project Red: by hand 37 + 0.48 × 3 + 1.44 = 39.88 < digging 40.48 < a hammer
    // per step 55.92. AE2: one shared hammer 37 + 1.92 = 38.92 < 39.88. Controller ruling 2: at very low rates hand-crafting
    // may win. Machine to machine digs (ruling P1).
    const routed = await planLine(sand, G({ per: 'hour', logistics: 'routed' }), emptyContext());
    expect(stepOf(routed, 'gravel-hand')).toMatchObject({ handCraft: true });
    expect(stepOf(routed, 'hammer-sand')).toMatchObject({ machine: { mteId: 481 }, count: 1 });
    expect(ids(routed)).not.toContain('hammer-gravel');
    expect(routed.warnings).toContainEqual(expect.objectContaining({ code: 'hand-step', stepId: 'gravel-hand' }));
    expect(routed.cost?.build).toBe(37);
    const ae2 = await planLine(sand, G({ per: 'hour', logistics: 'ae2' }), emptyContext());
    expect(stepOf(ae2, 'hammer-gravel').pool).toEqual(HAMMER_POOL);
    expect(stepOf(ae2, 'hammer-sand').pool).toEqual(HAMMER_POOL);
    expect(ids(ae2)).not.toContain('gravel-hand');
    expect(ae2.cost?.build).toBe(37);
    const direct = await planLine(sand, G({ per: 'hour', logistics: 'direct' }), emptyContext());
    expect(ids(direct)).toEqual(['smelt-glass']);
    expect(direct.cost?.build).toBe(16);
  });

  it('digs sand when making it does not pay', async () => {
    // F = 1, σ = 1: digging 1 + 16 + 0.02 < one shared hammer 37 + 0.08. "Make it here instead" is offered (ruling P1).
    const plan = await planLine(sand, G({ per: 'hour', buildHorizonHours: 1, logistics: 'ae2' }), emptyContext());
    expect(ids(plan)).toEqual(['smelt-glass']);
    expect(plan.rawInputs.map((r) => [r.key, r.leafClass])).toEqual([[SAND, 'natural']]);
    expect(plan.rawInputs[0]?.canMake).toBe(true);
    expect(plan.cost).toEqual({ runPerHour: 1, build: 16, horizonHours: 1 });
  });

  it('keeps digging sand when build cost is ignored', async () => {
    // Plan 09 R1: without build cost nothing would bound a zero-raw chain.
    const settings = G({ buildHorizonHours: null, logistics: 'routed' });
    const plan = await planLine(sand, settings, emptyContext());
    expect(ids(plan)).toEqual(['smelt-glass']);
    const dug = plan.rawInputs.find((r) => r.key === SAND);
    expect(dug).toMatchObject({ leafClass: 'natural', canMake: false });
    expect(dug?.sources.map((s) => s.detail)).toContain('gathered (dig it)');
    expect(plan.flows.some((f) => f.key === COBBLE)).toBe(false);
    expect((await linePricing(sand, settings, emptyContext()))!.graph.recipes.map((r) => r.id)).not.toContain('hammer-sand');
  });

  it('makes sand in Make N only when the hammer pays for itself', async () => {
    // S1 = 0, S1g = 1 a glass. 8: σ = 8, a step 0.16: digging 8 + 16 + 0.16 < one hammer 33 + 0.48. 64: σ = 64, a step
    // 1.28: digging 64 + 16 + 1.28 > one hammer 33 + 3.84. Machine to machine digs (ruling P1).
    const noHand = packFromSpec(sandSpec({ handGravel: false }));
    const batch = (amount: number, logistics: LogisticsMode = 'ae2'): Promise<Plan> => planLine(noHand, G({ mode: 'makeN', amount, logistics }), emptyContext());
    const few = await batch(8);
    expect(ids(few)).toEqual(['smelt-glass']);
    expect(few.cost).toMatchObject({ build: 16, batch: 8 });
    const many = await batch(64);
    // Cobblestone is a free raw input: Make N plans no supply step.
    expect(ids(many)).toEqual(['hammer-gravel', 'hammer-sand', 'smelt-glass']);
    expect(many.cost).toMatchObject({ build: 33, batch: 0 });
    expect(many.buildList.find((l) => l.key === 'machine:481@0')?.amount).toBe(1);   // Make N's one machine per type
    expect(ids(await batch(64, 'direct'))).toEqual(['smelt-glass']);
  });

  it('puts an owned forge hammer into the shared pool', async () => {
    const AT: MachineWhere = { dim: 0, pos: [5, 64, 5] };
    const oneHammer = owning({ mteId: 481, count: 1, where: [AT] });
    const ae2 = await planLine(sand, G({ logistics: 'ae2' }), oneHammer);
    for (const id of HAMMER_POOL.steps) {
      expect(stepOf(ae2, id)).toMatchObject({ count: 1, owned: 1, reused: { count: 1, where: [AT], units: [0] }, pool: HAMMER_POOL });
      expect(stepOf(ae2, id).reused?.sharedWith).toEqual(HAMMER_POOL.steps.filter((s) => s !== id));
    }
    expect(ae2.cost?.build).toBe(20);   // 4 + 16
    // Project Red: two pools, and the owned machine serves one; at equal loads the lower id keeps it.
    const routed = await planLine(sand, G({ logistics: 'routed' }), oneHammer);
    expect(stepOf(routed, 'hammer-gravel')).toMatchObject({ count: 1, owned: 1 });
    expect(stepOf(routed, 'hammer-sand')).toMatchObject({ count: 1, owned: 0 });
    expect(routed.cost?.build).toBe(37);
    const direct = await planLine(sand, G({ logistics: 'direct' }), oneHammer);
    expect(ids(direct)).toEqual(['smelt-glass']);
    expect(direct.cost?.build).toBe(16);
  });
});

describe('build cost in Make N', () => {
  it('weighs a bender against the batch in Make N', async () => {
    // 64: 192 + 50 < 256 + 33; 8: 24 + 50 > 32 + 33.
    const pack = miniGt();
    const many = await planLine(pack, S({ mode: 'makeN', amount: 64 }), emptyContext());
    expect(ids(many)).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    expect(many.cost).toMatchObject({ build: 50, batch: 192, horizonHours: null });
    expect(many.cost?.runPerHour).toBe(sig9((192 * 3600) / many.makeN!.totalSeconds));
    const few = await planLine(pack, S({ mode: 'makeN', amount: 8 }), emptyContext());
    expect(ids(few)).toEqual(['circuit-lv', 'hammer-plate', 'wire']);
    expect(few.cost).toMatchObject({ build: 33, batch: 32 });
  });

  it('counts owned machines as free in Make N', async () => {
    const ctx = owning({ mteId: 121, count: 1 }, { mteId: 101, count: 1 }, { mteId: 111, count: 1 });
    const plan = await planLine(miniGt(), S({ mode: 'makeN', amount: 8 }), ctx);
    expect(ids(plan)).toEqual(['bend-plate', 'circuit-lv', 'wire']);
    for (const step of plan.steps) expect(step).toMatchObject({ count: 1, owned: 1 });
    expect(plan.cost?.build).toBe(0);
  });
});

describe('machine tiers', () => {
  const plates = (p: Partial<PlanSettings> = {}): PlanSettings => S({ target: 't:iron_plate@0', tier: 2, amount: 60, ...p });
  const oneMvBender = owning({ mteId: 102, count: 1 });
  const LV_TIER = { tier: 1, mteId: 101, name: 'Basic Bending Machine', machines: 5, owned: 0, build: 80 };
  const MV_TIER = { tier: 2, mteId: 102, name: 'Advanced Bending Machine', machines: 3, owned: 1, build: null, unbuildable: 'no recipe in this pack' };

  it('lists the eligible tiers of a step', async () => {
    // The owned Advanced Bending Machine (no recipe makes it: it can serve, not be built) does 0.4 runs/s and 3 new Basic
    // ones the other 0.6: 3 × 16, against 80 for 5 Basic ones.
    const auto = await planLine(miniGt(), plates(), oneMvBender);
    const bend = stepOf(auto, 'bend-plate');
    expect(bend).toMatchObject({
      machine: { mteId: 101 }, count: 3, owned: 0,
      reused: { count: 0, others: [{ mteId: 102, name: 'Advanced Bending Machine', tier: 2, count: 1, units: [0] }] },
    });
    expect(Math.abs(bend.utilization - 1)).toBeLessThanOrEqual(1e-9);
    expect(auto.cost?.build).toBe(48);
    expect(bend.tiers).toEqual([LV_TIER, MV_TIER]);

    // Controller Amendment OQ5 (ruling P5): the pinned MV tier cannot be built, so its owned machine runs first and the
    // rest falls back to LV, with a warning; the radio stays on the user's choice.
    const pinned = await planLine(miniGt(), plates({ machineTier: { 'bend-plate': 2 } }), oneMvBender);
    expect(stepOf(pinned, 'bend-plate')).toMatchObject({
      machine: { mteId: 101 }, count: 3, owned: 0, reused: { count: 0, others: [{ mteId: 102, count: 1, units: [0] }] },
    });
    expect(ids(pinned)).not.toContain('hammer-plate');
    expect(codes(pinned)).not.toContain('hand-step');
    expect(pinned.warnings.filter((w) => w.code === 'tier-fallback')).toEqual([{
      code: 'tier-fallback', stepId: 'bend-plate',
      text: 'Iron Plate at MV: Advanced Bending Machine cannot be built here (no recipe in this pack), so your 1× run beside 3× Basic Bending Machine (LV)',
    }]);
    expect(pinned.cost).toEqual({ runPerHour: 3600, build: 48, horizonHours: 24 });
    expect(stepOf(pinned, 'bend-plate').tiers).toEqual([LV_TIER, { ...MV_TIER, pinned: true }]);

    // With that pin and nothing owned: the MV bender can neither be built nor borrowed, so the step runs at LV.
    const none = await planLine(miniGt(), plates({ machineTier: { 'bend-plate': 2 } }), emptyContext());
    expect(stepOf(none, 'bend-plate')).toMatchObject({ machine: { mteId: 101 }, count: 5 });
    expect(none.warnings.filter((w) => w.code === 'tier-fallback')).toEqual([{
      code: 'tier-fallback', stepId: 'bend-plate',
      text: 'Iron Plate at MV: Advanced Bending Machine cannot be built here (no recipe in this pack), so it runs on 5× Basic Bending Machine (LV)',
    }]);
    expect(stepOf(none, 'bend-plate').tiers).toEqual([LV_TIER, { ...MV_TIER, owned: 0, pinned: true }]);
  });
});

const DISPLAY = 'gregtech:gt.metaitem.02@32765#abcdefabcdef';

/**
 * Mini-GT with the rock-breaker part of plan 09's supply fixture (map, Basic Rock Breaker 441 and its display recipe),
 * `mace-cobble` (Mini-GT's Basic Macerator 141: 1 cobblestone → 1 Stone Dust, 2 EU/t × 40 t) and `make-441` (4 iron
 * ingots → a rock breaker, 4 raw); nothing makes the macerator, unless `gap` gives it a recipe the cost analysis cannot
 * price.
 */
function stoneSpec(gap: boolean): PackSpec {
  const spec = structuredClone(MINI_GT);
  spec.items = [...(spec.items ?? []), { key: DISPLAY, name: 'IT\'S FREE! Place Lava on Side' }, { key: 't:stone_dust@0', name: 'Stone Dust' }];
  spec.maps = [...(spec.maps ?? []), { id: 'gt.recipe.rockbreaker', name: 'Rock Breaker' }];
  spec.machines = [
    ...(spec.machines ?? []),
    { mteId: 441, name: 'Basic Rock Breaker', maps: ['gt.recipe.rockbreaker'], tier: 1, cls: 'gregtech.common.tileentities.machines.basic.MTERockBreaker' },
  ];
  spec.recipes = [
    ...(spec.recipes ?? []),
    { id: 'fake-cobble', map: 'gt.recipe.rockbreaker', in: [[DISPLAY, 1]], out: [[COBBLE, 1]], eut: 30, dur: 16, flags: { fake: true } },
    { id: 'mace-cobble', map: 'gt.recipe.macerator', in: [[COBBLE, 1]], out: [['t:stone_dust@0', 1]], eut: 2, dur: 40 },
    { id: 'make-441', map: 'crafting', in: [['t:iron_ingot@0', 4]], out: [['machine:441@0', 1]] },
  ];
  return gap ? withPriceGap(spec, [141]) : spec;
}

describe('machines of supply steps and machines that cannot be built', () => {
  /** 150 Stone Dust a minute at LV: 2.5 runs/s of mace-cobble on 2.5 cobblestone a second. */
  const dust = (): PlanSettings => S({ target: 't:stone_dust@0', amount: 150 });

  it('counts the machines of a supply step', async () => {
    // The macerator can be made, but the cost analysis cannot price it (a pricing gap).
    const plan = await planLine(packFromSpec(stoneSpec(true)), dust(), emptyContext());
    expect(plan.status).toBe('ok');
    expect(plan.steps.find((s) => s.supply === COBBLE)).toMatchObject({ machine: { mteId: 441 }, count: 2 });   // 1.25/s each
    expect(stepOf(plan, 'mace-cobble')).toMatchObject({ machine: { mteId: 141 }, count: 5 });   // 2.5/s ÷ 0.5
    expect(plan.cost?.build).toBe(8);   // 2 × 4
    expect(plan.cost?.unpriced).toBe(5);
    expect(plan.warnings).toContainEqual({ code: 'build-cost-unknown', text: 'Not counted in the build cost: Basic Macerator (its price could not be worked out)' });
  });

  it('blocks a step whose machine cannot be built', async () => {
    const pack = packFromSpec(stoneSpec(false));
    const blocked = await planLine(pack, dust(), emptyContext());
    expect(blocked.status).toBe('infeasible');
    expect(blocked.warnings).toContainEqual({
      code: 'no-recipe', key: 't:stone_dust@0', text: 'Nothing at ≤ LV makes Stone Dust: Basic Macerator cannot be built here (no recipe in this pack)',
    });
    // Owned machines serve, as far as there are enough of them.
    const five = await planLine(pack, dust(), owning({ mteId: 141, count: 5 }));
    expect(five.status).toBe('ok');
    expect(stepOf(five, 'mace-cobble')).toMatchObject({ count: 5, owned: 5 });
    expect(five.cost?.build).toBe(8);
    expect(codes(five)).not.toContain('build-cost-unknown');
    // 2 × 0.5 runs/s against 2.5.
    const two = await planLine(pack, dust(), owning({ mteId: 141, count: 2 }));
    expect(two.status).toBe('infeasible');
    expect(two.warnings).toContainEqual({
      code: 'owned-only', key: 't:stone_dust@0', text: 'Stone Dust needs more than your 2× Basic Macerator, which cannot be built here (no recipe in this pack)',
    });
  });
});

describe('assignOwned', () => {
  const units = (n: number): Map<number, null[]> => new Map([[1, new Array<null>(n).fill(null)]]);

  it('assigns owned units deterministically', () => {
    const a = { id: 'a', mteId: 1, load: 0.5 };
    const b = { id: 'b', mteId: 1, load: 1.5 };
    // Direct: the larger load first, whole units (ceil(1.5) = 2).
    const direct = assignOwned([a, b], units(2), false);
    expect(direct.get('b')).toEqual({ units: [0, 1], added: 0 });
    expect(direct.get('a')).toEqual({ units: [], added: 1 });
    // One sharing pool: 2.0 on both units; the network spreads both steps over them.
    const pooled = assignOwned([{ ...a, key: 'k' }, { ...b, key: 'k' }], units(2), true);
    expect(pooled.get('a')).toEqual({ units: [0, 1], added: 0, pool: 'pool:a' });
    expect(pooled.get('b')).toEqual({ units: [0, 1], added: 0, pool: 'pool:a' });
    // Two keys: the larger pool first, and no unit serves two keys.
    const keyed = assignOwned([{ ...a, key: 'k1' }, { ...b, key: 'k2' }], units(2), true);
    expect(keyed.get('b')).toEqual({ units: [0, 1], added: 0 });
    expect(keyed.get('a')).toEqual({ units: [], added: 1 });
    // 0.6 fits one unit; unit 1 stays free.
    const light = assignOwned([{ id: 'a', mteId: 1, load: 0.3, key: 'k' }, { id: 'b', mteId: 1, load: 0.3, key: 'k' }], units(2), true);
    expect(light.get('a')).toEqual({ units: [0], added: 0, pool: 'pool:a' });
    expect(light.get('b')).toEqual({ units: [0], added: 0, pool: 'pool:a' });
    // A running step needs a machine, however small its load.
    const tiny = { id: 'a', mteId: 1, load: 1e-12 };
    for (const shared of [false, true]) {
      expect(assignOwned([tiny], new Map(), shared).get('a')).toEqual({ units: [], added: 1 });
      expect(assignOwned([tiny], units(1), shared).get('a')).toEqual({ units: [0], added: 0 });
    }
    // The owned machines of another option a step also runs on (`also`) take their share first.
    const beside = assignOwned([{ id: 'c', mteId: 1, load: 1, share: 1, also: true }, b], units(2), false);
    expect(beside.get('c')).toEqual({ units: [], added: 0, others: [{ mteId: 1, units: [0] }] });
    expect(beside.get('b')).toEqual({ units: [1], added: 1 });
    const room = assignOwned([{ id: 'c', mteId: 1, load: 0.4, share: 0.4, also: true, key: 'k' }, { id: 'd', mteId: 1, load: 0.5, key: 'k' }], units(1), true);
    expect(room.get('c')?.others).toEqual([{ mteId: 1, units: [0] }]);
    expect(room.get('d')).toEqual({ units: [0], added: 0 });   // 0.4 and 0.5 fit the one unit
    // A step that can only use owned machines goes first.
    const onlyOwned = assignOwned([{ id: 'a', mteId: 1, load: 1, ownedOnly: true }, b], units(2), false);
    expect(onlyOwned.get('a')).toEqual({ units: [0], added: 0 });
    expect(onlyOwned.get('b')).toEqual({ units: [1], added: 1 });
  });
});
