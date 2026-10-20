// The multiblocks GregTech lets nothing automated fill (architecture §11 entry 48; Plan 5 follow-up 8; add-on 15
// rulings R7). Read with javap from the pack's GT 5.09.54.183 jar: of every multiblock controller in it (GT, GT++,
// BartWorks, GoodGenerator, TecTech and KekzTech classes that are structure-checked `MetaTileEntity`s) only these two
// and BartWorks' `MTEWindmill` override `allowPullStack`, `allowPutStack` or `allowCoverOnSide`. The routed, AE2 and
// EnderIO modes run these two by hand (`unitsFromPlan`'s `primitive` option); add-on 15 gives machine-to-machine mode
// the same rule.

import type { Machine } from '../../shared/types/pack.ts';
import { simpleClassName } from '../world/facts.ts';
import type { ManualReason } from './arrange.ts';

/**
 * Controllers that let nothing automated move items in or out: `MTEBrickedBlastFurnace` (a plain `MetaTileEntity` with
 * no hatches; its `allowPullStack` and `allowPutStack` are false on every side, and it takes only covers allowed on
 * primitive blocks, the chest and decorative covers). It gets no buses, covers or pipes: fill and empty it by hand.
 */
export const NO_AUTOMATION: ReadonlySet<string> = new Set(['MTEBrickedBlastFurnace']);

/**
 * Controllers that take items only through a hatch of their own kind, which the planner does not lay out:
 * `MTECokeOven` (no cover fits it, `allowPutStack` takes nothing from a real side and `drain` gives nothing to one; its
 * structure's one hatch element is the Coke Oven Hatch, `MTEHatchCokeOven`, which moves items and Creosote in or out
 * every 20 ticks). Like `NO_AUTOMATION` they take no bus, energy or maintenance hatch.
 */
export const OWN_HATCH: ReadonlySet<string> = new Set(['MTECokeOven']);

/** Why a multiblock is run by hand, or null when the line's logistics can serve it. */
export function manualReasonOf(m: Pick<Machine, 'cls' | 'kind'>): ManualReason | null {
  if (m.kind !== 'multiblock') return null;
  const name = simpleClassName(m.cls) ?? '';
  return NO_AUTOMATION.has(name) ? 'no_automation' : OWN_HATCH.has(name) ? 'own_hatch' : null;
}
