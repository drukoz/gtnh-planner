// Plans the flow-focus end-to-end test serves in place of the server's (fix spec §7.1, `page.route` on the plan route):
// Mini-GT goods, maps and machines only (tests/helpers/mini-gt.ts), so what a panel sends still makes sense to the real
// e2e server. Step ids are the Mini-GT recipe ids, not the content hashes of the e2e export; rates are per second.

import { TIER_NAMES } from '../../../src/shared/gt/tiers.ts';
import type { Product } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow, PlanStep, RawInput } from '../../../src/shared/types/plan.ts';

const HOUR = 3600;

const NAMES: Record<string, string> = {
  't:copper_ingot@0': 'Copper Ingot', 't:copper_wire@0': '1x Copper Wire', 't:iron_ingot@0': 'Iron Ingot', 't:iron_plate@0': 'Iron Plate',
  't:redstone@0': 'Redstone', 't:circuit@0': 'Basic Circuit', 'fluid:molten.iron': 'Molten Iron',
  'map:gt.recipe.wiremill': 'Wiremill', 'map:gt.recipe.metalbender': 'Bending Machine', 'map:gt.recipe.assembler': 'Assembler',
  'map:gt.recipe.fluidextractor': 'Fluid Extractor', 'map:crafting': 'Crafting Table',
};

const per = (key: string, amount: number): Product => ({ key, amount, chance: 1 });
const flow = (from: string, to: string, key: string, perSecond: number): PlanFlow => ({ from, to, key, perSecond });
const mined = (key: string, perSecond: number): RawInput => ({ key, perSecond, cost: perSecond, available: true, sources: [], leafClass: 'direct' });

function step(p: Partial<PlanStep> & Pick<PlanStep, 'id' | 'mapId' | 'machine' | 'mainOutput'>): PlanStep {
  return {
    recipeId: p.id, count: 1, owned: 0, runsPerSecond: 0.5, utilization: 0.5, euPerTick: 16, durationTicks: 100, overclocks: 0, inputs: [], outputs: [],
    alternatives: [], handCraft: false, warnings: [], ...p,
  };
}

function planOf(p: Pick<Plan, 'steps' | 'flows' | 'rawInputs' | 'tier'> & Partial<Plan>): Plan {
  return {
    settingsHash: 'flow-focus-fixture', exportId: 'e2e', reachable: [], unlocks: [], byproducts: [], buildList: [], buildSteps: [], warnings: [],
    power: { peakEUt: 0, averageEUt: 0, voltageTier: p.tier, amps: 1 }, status: 'ok', names: NAMES, target: 't:circuit@0', ...p,
  };
}

const wire = (runsPerSecond: number): PlanStep => step({
  id: 'wire', mapId: 'gt.recipe.wiremill', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 }, mainOutput: 't:copper_wire@0', count: 2, runsPerSecond,
  utilization: 0.625, euPerTick: 32, durationTicks: 50, overclocks: 1, inputs: [per('t:copper_ingot@0', 1)], outputs: [per('t:copper_wire@0', 2)],
});
const bend = (runsPerSecond: number): PlanStep => step({
  id: 'bend-plate', mapId: 'gt.recipe.metalbender', machine: { mteId: 101, name: 'Basic Bending Machine', tier: 1 }, mainOutput: 't:iron_plate@0', count: 3,
  runsPerSecond, utilization: 0.833, euPerTick: 24, inputs: [per('t:iron_ingot@0', 1)], outputs: [per('t:iron_plate@0', 1)],
});
const assembleLv = step({
  id: 'circuit-lv', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, mainOutput: 't:circuit@0', count: 5,
  utilization: 1, durationTicks: 200, inputs: [per('t:iron_plate@0', 1), per('t:copper_wire@0', 2), per('t:redstone@0', 1)], outputs: [per('t:circuit@0', 1)],
});

/** Basic Circuit at LV, 30 a minute: the wiremill and the bending machine feed the assembler; ingots and redstone are mined. */
export function circuitLv(): Plan {
  return planOf({
    tier: 1, targetPerSecond: 0.5,
    steps: [wire(0.5), bend(0.5), assembleLv],
    flows: [
      flow('raw', 'wire', 't:copper_ingot@0', 0.5), flow('raw', 'bend-plate', 't:iron_ingot@0', 0.5), flow('raw', 'circuit-lv', 't:redstone@0', 0.5),
      flow('wire', 'circuit-lv', 't:copper_wire@0', 1), flow('bend-plate', 'circuit-lv', 't:iron_plate@0', 0.5), flow('circuit-lv', 'out', 't:circuit@0', 0.5),
    ],
    rawInputs: [mined('t:copper_ingot@0', 0.5), mined('t:iron_ingot@0', 0.5), mined('t:redstone@0', 0.5)],
  });
}

/** The same line without the Copper Ingot for the wiremill: nothing supplies it. */
export function copperUnsourced(): Plan {
  const plan = circuitLv();
  return {
    ...plan, flows: plan.flows.filter((f) => !(f.from === 'raw' && f.key === 't:copper_ingot@0')),
    rawInputs: plan.rawInputs.filter((r) => r.key !== 't:copper_ingot@0'),
  };
}

/** The same line with its Iron Plate made two ways: 99 % by the bending machine, 1 % hammered by hand. */
export function platesTwoWays(): Plan {
  const hammer = step({
    id: 'hammer-plate', mapId: 'crafting', machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, mainOutput: 't:iron_plate@0',
    runsPerSecond: 0.005, utilization: 0.03, euPerTick: 0, handCraft: true, inputs: [per('t:iron_ingot@0', 2)], outputs: [per('t:iron_plate@0', 1)],
  });
  return planOf({
    tier: 1, targetPerSecond: 0.5,
    steps: [wire(0.5), bend(0.495), hammer, assembleLv],
    flows: [
      flow('raw', 'wire', 't:copper_ingot@0', 0.5), flow('raw', 'bend-plate', 't:iron_ingot@0', 0.495), flow('raw', 'hammer-plate', 't:iron_ingot@0', 0.01),
      flow('raw', 'circuit-lv', 't:redstone@0', 0.5), flow('wire', 'circuit-lv', 't:copper_wire@0', 1), flow('bend-plate', 'circuit-lv', 't:iron_plate@0', 0.495),
      flow('hammer-plate', 'circuit-lv', 't:iron_plate@0', 0.005), flow('circuit-lv', 'out', 't:circuit@0', 0.5),
    ],
    rawInputs: [mined('t:copper_ingot@0', 0.5), mined('t:iron_ingot@0', 0.505), mined('t:redstone@0', 0.5)],
  });
}

/**
 * A step at every voltage tier, ULV to MAX, each with a machine count of its own and every other one shared by a pool: every tier chip there is
 * and count chips from "×1" to "×1024 shared" (Phase 2 Task 4, ledger ruling P2-R8: the chips' text must fit with the web fonts and without).
 * Nothing flows, so the boxes have no rows.
 */
export function everyTier(): Plan {
  const counts = [1, 2, 5, 12, 64, 128, 1024];
  const steps = TIER_NAMES.map((name, tier) => step({
    id: `tier-${tier}`, mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: `${name} Assembler`, tier }, mainOutput: 't:circuit@0',
    count: counts[tier % counts.length] ?? 1, euPerTick: 8 * 4 ** tier,
    ...(tier % 2 === 0 ? { pool: { id: `pool:tier-${tier}`, steps: [`tier-${tier}`, `tier-${tier + 1}`] } } : {}),
  }));
  return planOf({ tier: 1, targetPerSecond: 0.5, steps, flows: [], rawInputs: [] });
}

/**
 * Deferred F8 (Phase 2 spec §15.5, Task 12): one assembler, `big`, taking 201 raw goods (direct imports, as `mined` gives them, each from a
 * stub of its own), `t:g0@0` to `t:g200@0`, which have no names (they show their keys): 202 arrows with the target's, past
 * `PIPE_ANIMATION_LIMIT`, so only the lit pipes move and carry goods.
 */
export function manyEdges(): Plan {
  const keys = Array.from({ length: 201 }, (_, i) => `t:g${i}@0`);
  const big = step({
    id: 'big', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 }, mainOutput: 't:circuit@0',
    inputs: keys.map((key) => per(key, 1)), outputs: [per('t:circuit@0', 1)],
  });
  return planOf({
    tier: 1, targetPerSecond: 0.5, steps: [big],
    flows: [...keys.map((key) => flow('raw', 'big', key, 0.5)), flow('big', 'out', 't:circuit@0', 0.5)],
    rawInputs: keys.map((key) => mined(key, 0.5)),
  });
}

/** Basic Circuit at MV, 1 an hour: the cheaper assembler recipe on Molten Iron from a fluid extractor. */
export function circuitMvPerHour(): Plan {
  const assembleMv = step({
    id: 'circuit-mv', mapId: 'gt.recipe.assembler', machine: { mteId: 122, name: 'Advanced Assembler', tier: 2 }, mainOutput: 't:circuit@0',
    runsPerSecond: 1 / HOUR, utilization: 1.4e-4, euPerTick: 120, inputs: [per('t:copper_wire@0', 2), per('t:redstone@0', 1), per('fluid:molten.iron', 72)],
    outputs: [per('t:circuit@0', 1)],
  });
  const extract = step({
    id: 'extract-iron', mapId: 'gt.recipe.fluidextractor', machine: { mteId: 131, name: 'Basic Fluid Extractor', tier: 1 }, mainOutput: 'fluid:molten.iron',
    runsPerSecond: 0.5 / HOUR, utilization: 2.8e-6, euPerTick: 30, durationTicks: 40, inputs: [per('t:iron_ingot@0', 1)], outputs: [per('fluid:molten.iron', 144)],
  });
  return planOf({
    tier: 2, targetPerSecond: 1 / HOUR,
    steps: [assembleMv, extract, { ...wire(1 / HOUR), count: 1, utilization: 1.4e-5 }],
    flows: [
      flow('raw', 'wire', 't:copper_ingot@0', 1 / HOUR), flow('raw', 'extract-iron', 't:iron_ingot@0', 0.5 / HOUR), flow('raw', 'circuit-mv', 't:redstone@0', 1 / HOUR),
      flow('wire', 'circuit-mv', 't:copper_wire@0', 2 / HOUR), flow('extract-iron', 'circuit-mv', 'fluid:molten.iron', 72 / HOUR),
      flow('circuit-mv', 'out', 't:circuit@0', 1 / HOUR),
    ],
    rawInputs: [mined('t:copper_ingot@0', 1 / HOUR), mined('t:iron_ingot@0', 0.5 / HOUR), mined('t:redstone@0', 1 / HOUR)],
  });
}
