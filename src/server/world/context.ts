// The world a project is planned in (architecture §6.6, §7.1, §11.20, §11.21; spec §3.3–§3.5): from a finished scan,
// what one base owns, holds in storage (and how much of it the project's logistics can reach), its top tier, EBF coil
// heat and power, plus the world-wide visited dimensions and prospected veins. Plan 2's planner reads it through the
// `app.services.planContext` hook; Plan 5 calls it with three arguments (mode `direct`).

import type { Pack } from '../../shared/types/pack.ts';
import type { LogisticsMode, MachineWhere, PlanContext } from '../../shared/types/plan.ts';
import { findBase, type PlacedMachine, type PowerNetwork, type WorldScan } from '../../shared/types/world.ts';
import { reachKinds, storageTotals } from '../../shared/world/storage-totals.ts';
import { countsForTopTier } from './classify/gt.ts';
import { RAIN_OUTAGE_SECONDS } from './power.ts';

/**
 * What the machines say: how many of each export-known mID there are and where each stands, in the scan's order (sorted
 * by mID; machines the export does not know are left out), the highest export tier among those that say what voltage a
 * base runs at (the rule of the scan's `Base.topTier`), and the highest EBF coil heat.
 */
function machineFacts(machines: readonly PlacedMachine[], pack: Pack): Pick<PlanContext, 'ownedMachines' | 'topTier' | 'coilHeat'> {
  const counts = new Map<number, number>();
  const places = new Map<number, MachineWhere[]>();   // ruling P22: a plan says where the machines it reuses stand
  let topTier: number | null = null, coilHeat: number | null = null;
  for (const placed of machines) {
    if (placed.coilHeat !== undefined && (coilHeat === null || placed.coilHeat > coilHeat)) coilHeat = placed.coilHeat;
    const m = pack.machines.get(placed.mteId);
    if (m === undefined) continue;
    counts.set(m.mteId, (counts.get(m.mteId) ?? 0) + 1);
    const where: MachineWhere = { dim: placed.dim, pos: [placed.pos[0], placed.pos[1], placed.pos[2]] };
    const list = places.get(m.mteId);
    if (list === undefined) places.set(m.mteId, [where]);
    else list.push(where);
    if (m.tier !== undefined && (topTier === null || m.tier > topTier) && countsForTopTier({ kind: m.kind, tier: m.tier, cls: m.cls })) topTier = m.tier;
  }
  const ownedMachines = [...counts].sort((a, b) => a[0] - b[0]).map(([mteId, count]) => ({ mteId, count, where: places.get(mteId) ?? [] }));
  return { ownedMachines, topTier, coilHeat };
}

/**
 * The networks together: average and spare EU/t (average minus load), the tier of the network with the largest
 * average (the first of equals), stored EU, and the rain outage the buffers must cover when any of it is solar.
 * Undefined without a network.
 */
function powerOf(networks: readonly PowerNetwork[]): PlanContext['power'] {
  let main: PowerNetwork | undefined;
  let averageEUt = 0, loadEUt = 0, storedEU = 0, solar = false;
  for (const n of networks) {
    averageEUt += n.generatorEUt.average;
    loadEUt += n.loadEUt ?? 0;
    storedEU += n.storedEU;
    solar ||= (n.solarShare ?? 0) > 0;
    if (main === undefined || n.generatorEUt.average > main.generatorEUt.average) main = n;
  }
  if (main === undefined) return undefined;
  return { averageEUt, spareEUt: averageEUt - loadEUt, voltageTier: main.voltageTier, storedEU, rainOutageSeconds: solar ? RAIN_OUTAGE_SECONDS : 0 };
}

/**
 * The context of base `baseId` (`findBase`, so a rescan that moved the base's anchor still finds it); the whole world
 * when there is no such base. Storage counts as reachable through the network kinds of `mode` (default `direct`).
 * `power` is an own property even when undefined (ledger ruling R18). Nothing in `scan` is shared or changed.
 */
export function contextFromScan(scan: WorldScan, pack: Pack, baseId: string | null, mode?: LogisticsMode): PlanContext {
  const base = findBase(scan, baseId);
  const inBase = <T extends { baseId: string | null }>(items: readonly T[]): readonly T[] =>
    base === null ? items : items.filter((x) => x.baseId === base.id);
  const { ownedMachines, topTier, coilHeat } = machineFacts(inBase(scan.machines), pack);
  return {
    ownedMachines,
    storage: storageTotals(scan.storage, scan.logistics, base?.id ?? null, reachKinds(mode)),
    visitedDims: [...scan.visitedDims],
    topTier,
    coilHeat,
    prospected: scan.prospected.map((p) => ({ ...p })),
    power: powerOf(inBase(scan.power)),
  };
}
