// The user's reference Electronic Circuit flow as the real-data tests hold a plan to it (plan 12 fix wave 2, the
// acceptance specification of the reference-flow analysis; add-on 12 x 17 ruling R10: one copy of each): its raw
// materials (the spec's BASE) with the free inputs, its raw material a minute and machine blocks, and a plan's machine
// blocks and raw material a minute counted as the spec counts them, and the Steel Rod recipes it allows.
// real-reference.test.ts imports them. Pack keys and recipe ids only: the reference's settings stay in the private
// docs/local (local-docs.ts).

import { FREE_KEYS, type Plan } from '../../src/shared/types/plan.ts';
import { STEEL_INGOT } from './real-build-cases.ts';

export const RUBBER_WOOD = 'IC2:blockRubWood@0';
export const COPPER_INGOT = 'gregtech:gt.metaitem.01@11035';
export const TIN_DUST = 'gregtech:gt.metaitem.01@2057';
export const TIN_INGOT = 'gregtech:gt.metaitem.01@11057';
/** Its Steel Rod on the Lathe, and on the Extruder (2 rods an ingot), which the spec allows in its place. */
export const ROD_LATHE = '3b34f87f2984fe95';
export const ROD_EXTRUDER = '31693ed806ba0a95';
/**
 * The acceptance spec's BASE, the reference's raw materials (the user's ruling 179: Rubber Wood, Copper Ingot, Steel
 * Ingot, Tin Dust, Redstone, Sand; tin as dust or ingot, controller ruling 201).
 */
export const REFERENCE_BASE: readonly string[] = [
  RUBBER_WOOD, COPPER_INGOT, STEEL_INGOT, TIN_DUST, TIN_INGOT, 'minecraft:redstone@0', 'minecraft:sand@0',
];
/** The reference's raw materials (`REFERENCE_BASE`) and the free inputs. */
export const REFERENCE_RAW_KINDS: ReadonlySet<string> = new Set([...REFERENCE_BASE, ...FREE_KEYS]);
/**
 * The reference's machine blocks (the acceptance spec's R1: its 12 machine steps, one of them 3 Centrifuges, and its 4
 * crafting steps on Auto Workbenches), the bound of the user's ruling 179: fixed, not the planner's re-plan of the pinned
 * reference at each horizon, which moves across the sweep (add-on 12 ledger :243, plan 12's final review).
 */
export const REFERENCE_BLOCKS = 18;
/** Its raw material per minute (the acceptance spec's REF_RAW): tin as dust or ingot (controller ruling 201). */
export const REF_RAW: Readonly<Record<string, number>> = {
  [RUBBER_WOOD]: 32, [COPPER_INGOT]: 11.25, [STEEL_INGOT]: 4, tin: 1, 'minecraft:redstone@0': 5, 'minecraft:sand@0': 2,
};

/** The acceptance spec's machine blocks: the machines of every step not crafted by hand, a sharing pool once (Auto Workbenches count). */
export function machineBlocks(plan: Plan): number {
  let blocks = 0;
  for (const step of plan.steps) if (!step.handCraft && (step.pool === undefined || step.pool.steps[0] === step.id)) blocks += step.count;
  return blocks;
}

/** The plan's raw material per minute by key, tin dust and tin ingot as one `tin`. */
export function rawPerMinute(plan: Plan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of plan.rawInputs) {
    const key = r.key === TIN_DUST || r.key === TIN_INGOT ? 'tin' : r.key;
    out[key] = (out[key] ?? 0) + r.perSecond * 60;
  }
  return out;
}
