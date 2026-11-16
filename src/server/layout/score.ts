// Scoring of one laid line (RUK-2571, plan Assumption 3): what counts in a candidate's length, the field-by-field
// comparison the search ranks candidates by, and the rule that keeps a candidate from replacing today's line unless it
// is better and never worse in the ways that matter — a line gets longer or lossier only to power a machine.
// Pure: it reads what a laid line reports (`scoreLine`'s input), lays nothing and imports nothing from `layout.ts`.

import type { PlanWarning } from '../../shared/types/plan.ts';
import type { LineScore } from '../../shared/types/layout.ts';
import type { Vec3 } from '../../shared/layout/geometry.ts';
import type { LocalBlock } from './arrange.ts';
import type { MachinePower } from './internal.ts';

/** The roles whose blocks count in a line's length (the S1 benchmark's `total`; EnderIO conduits are `pipe`). */
export const LENGTH_ROLES: ReadonlySet<string> = new Set(['cable', 'pipe', 'interface', 'chip_pipe']);

/**
 * Score a laid line (RUK-2571, plan Assumption 3): the connections left to make by hand (the `route_failed` warnings),
 * the transformers its banks have no room for, the machines its wiring leaves too few volts to run, its blocks whose
 * role is in `LENGTH_ROLES`, the EU/t its own wiring loses, and its bounding volume.
 */
export function scoreLine(line: {
  blocks: readonly LocalBlock[]; warnings: readonly PlanWarning[]; machines: readonly MachinePower[];
  handTransformers: number; lossEUt: number; size: Vec3;
}): LineScore {
  return {
    unwired: line.warnings.filter((w) => w.code === 'route_failed').length,
    handTransformers: line.handTransformers,
    unpowered: line.machines.filter((m) => !m.powered).length,
    total: line.blocks.filter((b) => LENGTH_ROLES.has(b.role)).length,
    lossEUt: line.lossEUt,
    volume: line.size[0] * line.size[1] * line.size[2],
  };
}

/** Compare two scores as the search ranks candidates (Assumption 3): the first field that differs decides, lower first; 0 when all are equal. */
export function compareScore(a: LineScore, b: LineScore): number {
  return a.unwired - b.unwired || a.handTransformers - b.handTransformers || a.unpowered - b.unpowered
    || a.total - b.total || a.lossEUt - b.lossEUt || a.volume - b.volume;
}

/**
 * True when `candidate` may replace today's line (plan Assumption 4): it scores better, leaves no more connections
 * unwired and no more transformers for its banks, and either powers more machines or is both no longer and no lossier.
 * A line therefore gets longer or lossier only to power a machine that today gets nothing usable.
 */
export function replacesBaseline(candidate: LineScore, baseline: LineScore): boolean {
  if (compareScore(candidate, baseline) >= 0) return false;
  if (candidate.unwired > baseline.unwired || candidate.handTransformers > baseline.handTransformers) return false;
  return candidate.unpowered < baseline.unpowered
    || (candidate.unpowered === baseline.unpowered && candidate.total <= baseline.total && candidate.lossEUt <= baseline.lossEUt);
}
