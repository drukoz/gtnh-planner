// RUK-506: the middle power head (RUK-505's `westUnits`). When `placeUnits` is asked to split the line, the first
// `westUnits` units placed by feed tier stand west of the head facing east, the rest east of it facing west, and the
// head's runs bridge the spine with cables so nothing of the head stands on the spine row. A check that holds for the
// west-end head too (`westUnits` 0) runs there first as a control: one that fails there is the check's fault, not the
// middle head's. The free spine row under the head and the bridge over it are the middle head's alone (spec §3.5,
// gt-mechanics §3.1).

import { describe, it, expect } from 'vitest';
import { placeUnits, unitsFromPlan, type LocalBlock } from '../../../src/server/layout/arrange.ts';
import { fluidNets, headWidthFor, routeInternal, runX } from '../../../src/server/layout/internal.ts';
import { hookupAllowanceVolts, tierGroups, transformerStages } from '../../../src/server/layout/power.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import { layoutPack, makePlan, IDS } from '../../helpers/layout-fixtures.ts';
import { lossPlan, SUPPLY_TIER, tierContacts } from '../../helpers/power-loss.ts';

const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

/** `plan` laid in its own grid with `westUnits` units west of the power head, as `layoutLine` lays it. */
function line(plan: Plan, westUnits: number, mode: LogisticsMode = 'direct', supplyTier = SUPPLY_TIER) {
  const pack = layoutPack();
  const parts = resolveParts(pack);
  const { units } = unitsFromPlan(pack, plan, { primitive: mode !== 'direct' });
  const stages = transformerStages(tierGroups(units.filter((u) => u.electric).map((u) => ({ tier: u.tier, euPerTick: u.euPerTick }))), supplyTier);
  const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: PORT_SPACING[mode], supplyTier, westUnits });
  const modeResult = buildMode(mode, { pack, plan, parts, placement, network: null });
  const internal = routeInternal({
    pack, parts, placement, occupied: [...placement.blocks, ...modeResult.blocks], stages,
    fluids: modeResult.ownsFluids === true ? [] : fluidNets(pack, plan, placement), tailFluidY: modeResult.tailFluidY,
    groupTier: plan.tier, supplyLossVolts: hookupAllowanceVolts(supplyTier),
  });
  return { placement, modeResult, internal, stages, headWidth: headWidthFor(stages) };
}

/** Two feed tiers: 4 LV macerators fed at LV, 2 MV assemblers fed at MV (the `twoStep` pattern of internal.test.ts). */
const twoTier = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 4, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 120 },
]);

/** A unit's feed tier at an MV supply: the tier its run and tree are built at. */
const fedTier = (tier: number): number => Math.min(tier, SUPPLY_TIER);

/** True when a cable path of connections leads from `from` to a cell `to` accepts (the check of internal.test.ts). */
function reaches(blocks: readonly LocalBlock[], from: Vec3, to: (p: Vec3) => boolean): boolean {
  const cables = new Map(blocks.filter((b) => b.role === 'cable').map((b) => [posKey(b.pos), b]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    const b = cables.get(posKey(p));
    if (!b || seen.has(posKey(p))) continue;
    seen.add(posKey(p));
    if (to(p)) return true;
    for (let s = 0; s < 6; s++) if ((b.connections ?? 0) & (1 << s)) queue.push(step(p, s));
  }
  return false;
}

/** The units west of the head, nearest first; the units east of it, nearest first. */
function sides(r: ReturnType<typeof line>) {
  const westOf = (x: number): boolean => x < r.placement.headX;
  const eastOf = (x: number): boolean => x >= r.placement.headX + r.headWidth;
  const west = r.placement.units.filter((u) => westOf(u.at[0])).sort((a, b) => b.at[0] - a.at[0] || posKey(a.at).localeCompare(posKey(b.at)));
  const east = r.placement.units.filter((u) => eastOf(u.at[0])).sort((a, b) => a.at[0] - b.at[0] || posKey(a.at).localeCompare(posKey(b.at)));
  return { west, east };
}

describe('middle power head', () => {
  it('splits the line around the head', () => {
    // control: with no west units the head stands at the west end, exactly as before RUK-121
    const westHead = line(lossPlan(10), 0);
    expect(westHead.placement.headX).toBe(0);
    expect(westHead.placement.firstX).toBe(3);
    expect(westHead.placement.units.every((u) => u.at[0] >= 3)).toBe(true);
    expect(westHead.placement.size).toEqual([9, 1, 5]);
    // the middle head: 4 of the 10 units stand west of it, 6 east, and the head fits between them
    const mid = line(lossPlan(10), 4);
    expect(mid.placement.firstX).toBe(0);
    expect(mid.placement.units.filter((u) => u.at[0] < mid.placement.headX)).toHaveLength(4);
    expect(mid.placement.units.filter((u) => u.at[0] >= mid.placement.headX + 3)).toHaveLength(6);
    expect(mid.placement.headX + 3).toBeLessThanOrEqual(mid.placement.tailX);
    expect(mid.placement.size[0]).toBe(mid.placement.tailX + 1);
    expect(mid.placement.size).toEqual([10, 1, 5]);
  });

  it('stands the lowest feed tier nearest the head on both sides', () => {
    const mid = line(twoTier(), 2);
    const { west, east } = sides(mid);
    expect(west.map((u) => fedTier(u.tier))).toEqual([1, 1]);
    expect(east.map((u) => fedTier(u.tier))).toEqual([1, 1, 2, 2]);
    // the unit nearest the head on each side is fed at LV
    expect(fedTier(west[0]!.tier)).toBe(1);
    expect(fedTier(east[0]!.tier)).toBe(1);
    // going away from the head, feed tiers never fall: the lowest fed tier stands nearest on each side
    for (const side of [west, east]) {
      for (let i = 1; i < side.length; i++) expect(fedTier(side[i]!.tier)).toBeGreaterThanOrEqual(fedTier(side[i - 1]!.tier));
    }
  });

  for (const mode of MODES) {
    it(`wires a middle head in ${mode} mode`, () => {
      // control first: the spine runs under every unit column of the west-head line in this mode
      const westHead = line(lossPlan(20), 0, mode);
      const spineOf = (r: ReturnType<typeof line>): number[] => {
        const covered = new Set(r.modeResult.blocks.filter((b) => b.pos[1] === 0 && b.pos[2] === r.placement.spineZ).map((b) => b.pos[0]));
        const missing: number[] = [];
        for (let x = r.placement.firstX; x <= r.placement.tailX; x++) if (!covered.has(x)) missing.push(x);
        return missing;
      };
      expect(spineOf(westHead)).toEqual([]);
      // each run is unbroken along z: its two ends are linked (in the middle, across the spine through the bridge)
      const brokenRuns = (r: ReturnType<typeof line>): number[] => [r.placement.headX, r.placement.headX + 2]
        .filter((x) => !reaches(r.internal.blocks, [x, 0, 0], (p) => posKey(p) === posKey([x, 0, r.placement.size[2] - 1])));
      expect(brokenRuns(westHead)).toEqual([]);
      const mid = line(lossPlan(20), 8, mode);
      expect(tierContacts(mid.internal.blocks, mid.internal.cables, mid.placement)).toEqual([]);
      expect(mid.internal.warnings.map((w) => w.code)).not.toContain('route_failed');
      const all = [...mid.placement.blocks, ...mid.modeResult.blocks, ...mid.internal.blocks];
      const counts = new Map<string, number>();
      for (const b of all) counts.set(posKey(b.pos), (counts.get(posKey(b.pos)) ?? 0) + 1);
      expect([...counts.values()].filter((n) => n > 1)).toEqual([]);
      // the head's columns keep the spine row free and bridge it with cables at y = 1
      const at = (p: Vec3): LocalBlock[] => mid.internal.blocks.filter((b) => posKey(b.pos) === posKey(p));
      for (let x = mid.placement.headX; x < mid.placement.headX + mid.headWidth; x++) {
        expect(at([x, 0, mid.placement.spineZ])).toEqual([]);
      }
      for (const x of [mid.placement.headX, mid.placement.headX + 2]) {
        for (const z of [mid.placement.spineZ - 1, mid.placement.spineZ, mid.placement.spineZ + 1]) {
          expect(at([x, 1, z]).some((b) => b.role === 'cable'), `cable at ${JSON.stringify([x, 1, z])}`).toBe(true);
        }
      }
      // units stand on both sides of the head, and every one of them reaches the run of its feed tier
      const { west, east } = sides(mid);
      expect(west.length).toBe(8);
      expect(east.length).toBe(12);
      for (const u of mid.placement.units) {
        const run = runX(SUPPLY_TIER, fedTier(u.tier), mid.placement.headX);
        expect(reaches(mid.internal.blocks, u.ports.power!, (p) => p[0] === run && p[1] === 0), u.name).toBe(true);
      }
      expect(spineOf(mid)).toEqual([]);
      expect(brokenRuns(mid)).toEqual([]);
    });
  }

  it('drops the worst LV path below the west head', () => {
    const westHead = line(lossPlan(20), 0, 'ae2');
    const mid = line(lossPlan(20), 8, 'ae2');
    const lvWorst = (r: ReturnType<typeof line>): number => r.internal.tiers.find((t) => t.tier === 1)!.worstBlocks;
    expect(lvWorst(westHead)).toBe(44);
    expect(lvWorst(mid)).toBe(30);
    expect(lvWorst(mid)).toBeLessThan(lvWorst(westHead));
  });

  it('lays the same line twice', () => {
    const a = JSON.stringify(line(lossPlan(20), 8, 'routed').internal.blocks);
    const b = JSON.stringify(line(lossPlan(20), 8, 'routed').internal.blocks);
    expect(a).toBe(b);
  });
});
