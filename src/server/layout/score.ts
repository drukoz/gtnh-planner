// Scoring of one laid line (RUK-2571, plan Assumption 3): what counts in a candidate's length, the field-by-field
// comparison the search ranks candidates by, and the rule that keeps a candidate from replacing today's line unless it
// is better and never worse in the ways that matter — a line gets longer or lossier only to power a machine.
// Pure: it reads what a laid line reports (`scoreLine`'s input), lays nothing and imports nothing from `layout.ts`.

import type { PlanWarning } from '../../shared/types/plan.ts';
import type { Layout, LineScore } from '../../shared/types/layout.ts';
import type { Vec3 } from '../../shared/layout/geometry.ts';
import type { LocalBlock } from './arrange.ts';
import type { MachinePower } from './internal.ts';
import { V } from '../../shared/gt/tiers.ts';
import { unreachableMachines } from './reach.ts';

/** The roles whose blocks count in a line's length (the S1 benchmark's `total`; EnderIO conduits are `pipe`). */
export const LENGTH_ROLES: ReadonlySet<string> = new Set(['cable', 'pipe', 'interface', 'chip_pipe', 'roof']);

/**
 * Score a laid line (RUK-2571, plan Assumption 3): the connections left to make by hand (the `route_failed` warnings),
 * the machines no builder can reach (`unreachableMachines`, design goal 3: RUK-2877), the transformers its banks have no room for, the machines its wiring leaves too few volts to run, its blocks whose
 * role is in `LENGTH_ROLES`, the EU/t its own wiring loses, and its bounding volume.
 */
export function scoreLine(line: {
  blocks: readonly LocalBlock[]; warnings: readonly PlanWarning[]; machines: readonly MachinePower[];
  handTransformers: number; lossEUt: number; size: Vec3;
}): LineScore {
  return {
    unwired: line.warnings.filter((w) => w.code === 'route_failed').length,
    unreachable: unreachableMachines(line.blocks).length,
    handTransformers: line.handTransformers,
    unpowered: line.machines.filter((m) => !m.powered).length,
    total: line.blocks.filter((b) => LENGTH_ROLES.has(b.role)).length,
    lossEUt: line.lossEUt,
    volume: line.size[0] * line.size[1] * line.size[2],
  };
}

/**
 * Compare two scores as the search ranks candidates (Assumption 3): the first field that differs decides, lower first;
 * 0 when all are equal. Buildable comes first: no connection left by hand, every machine reachable (RUK-2877), and a bank short of room makes a line unbuildable whatever its count, so
 * `handTransformers` ranks once as "any at all", then again after `unpowered` (RUK-2976): placing two more transformers
 * by hand is easier than feeding a starved machine.
 */
export function compareScore(a: LineScore, b: LineScore): number {
  return a.unwired - b.unwired || a.unreachable - b.unreachable || Number(a.handTransformers > 0) - Number(b.handTransformers > 0) || a.unpowered - b.unpowered
    || a.handTransformers - b.handTransformers || a.total - b.total || a.lossEUt - b.lossEUt || a.volume - b.volume;
}

/**
 * True when `candidate` may replace today's line (plan Assumption 4): it scores better, leaves no more connections
 * unwired and no more machines out of reach (RUK-2877), leaves its banks short of room only where today's are too, leaves no more transformers for its banks unless
 * it powers more machines (RUK-2976), and either powers more machines, reaches more, or is both no longer and no lossier.
 * A line therefore gets longer or lossier only to power a machine that today gets nothing usable, or to reach one.
 */
export function replacesBaseline(candidate: LineScore, baseline: LineScore): boolean {
  if (compareScore(candidate, baseline) >= 0) return false;
  if (candidate.unwired > baseline.unwired || candidate.unreachable > baseline.unreachable || (candidate.handTransformers > 0 && baseline.handTransformers === 0)) return false;
  if (candidate.unpowered === baseline.unpowered && candidate.handTransformers > baseline.handTransformers) return false;
  return candidate.unpowered < baseline.unpowered || candidate.unreachable < baseline.unreachable
    || (candidate.unpowered === baseline.unpowered && candidate.total <= baseline.total && candidate.lossEUt <= baseline.lossEUt);
}

/**
 * What the benchmark measures of a finished layout (lengthOf): its connections left by hand, unpowered machines, length
 * with its hookups, loss, and weak tiers; and its machines out of reach, from its local line's score.
 */
export interface FinalMeasure { unwired: number; unpowered: number; unreachable: number; total: number; lossEUt: number; weakTiers: number }

/**
 * Measure a finished layout the way the S1 benchmark does (`lengthOf`): the `route_failed` warnings, the machines its
 * wiring leaves too few volts to run, the length as its own `LENGTH_ROLES` blocks plus every hookup block, ghosts
 * excluded, the EU/t `Layout.loss` counts, and its weak tiers: the tiers of `Layout.loss` whose farthest machine gets
 * under half the tier's volts (the benchmark's `weakTiers`, RUK-2877).
 */
export function finalMeasure(layout: Pick<Layout, 'blocks' | 'warnings' | 'loss'>, unreachable: number): FinalMeasure {
  const own = layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost');
  return {
    unwired: layout.warnings.filter((w) => w.code === 'route_failed').length,
    unpowered: layout.loss?.unpowered ?? 0,
    unreachable,
    total: own.filter((b) => LENGTH_ROLES.has(b.role)).length
      + layout.blocks.filter((b) => b.hookup !== undefined && b.role !== 'ghost').length,
    lossEUt: layout.loss?.totalEUt ?? 0,
    weakTiers: (layout.loss?.tiers ?? []).filter((t) => t.worstVolts * 2 < V[t.tier]!).length,
  };
}

/**
 * True when a finished candidate may replace the finished baseline: no more unwired, no more out of reach, no more weak
 * tiers unless it powers more machines (RUK-2877), and fewer unpowered, fewer out of reach, or as many of both and no
 * longer and no lossier.
 */
export function finalReplaces(candidate: FinalMeasure, baseline: FinalMeasure): boolean {
  return candidate.unwired <= baseline.unwired && candidate.unreachable <= baseline.unreachable
    && (candidate.weakTiers <= baseline.weakTiers || candidate.unpowered < baseline.unpowered)
    && (candidate.unpowered < baseline.unpowered || candidate.unreachable < baseline.unreachable
      || (candidate.unpowered === baseline.unpowered && candidate.total <= baseline.total && candidate.lossEUt <= baseline.lossEUt));
}

/**
 * Compare two finished layouts as `layoutLine` ranks its finalists (RUK-2877): the first field that differs decides,
 * lower first, in the search's order (`compareScore`) — unwired, out of reach, unpowered, length with the hookups, loss;
 * 0 when all are equal.
 */
export function compareFinal(a: FinalMeasure, b: FinalMeasure): number {
  return a.unwired - b.unwired || a.unreachable - b.unreachable || a.unpowered - b.unpowered || a.total - b.total || a.lossEUt - b.lossEUt;
}
