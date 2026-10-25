// What the Compare card shows (add-on 17, design spec §3.3, architecture §11.45 (5)), as pure functions: one column per
// planning mode of a project's compare (`GET /api/projects/:id/compare`), in the modes' order, with what its plan costs,
// how many machines, raw materials and steps it takes and its peak power, whether the project plans in it, whether it is
// still planning or why it failed, the raw materials it avoids and adds against the other two, and the goods it makes
// for other projects. Numbers through the shared formatter (fix spec §6.1).

import type { StuffKey } from '../../shared/keys.ts';
import type { CompareMode, CompareResult } from '../../shared/types/api.ts';
import { PLAN_OBJECTIVES, type PlanObjective } from '../../shared/types/plan.ts';
import { formatNumber } from '../format.ts';
import { OBJECTIVE_CHOICES } from './settings-model.ts';

/** One column of the card: a planning mode and what its plan comes to. */
export interface CompareColumn {
  objective: PlanObjective;
  /** The mode's name under "Plan for". */
  label: string;
  /** The project plans in this mode (`CompareResult.current`). */
  current: boolean;
  status: CompareMode['status'];
  /** "Still planning…" for a mode still planning, why it failed for a failed one, else null. */
  note: string | null;
  /** What its plan comes to, one row each: raw per hour, raw to build, new machines, raw materials, steps and peak EU/t. */
  rows: Array<{ label: string; value: string }>;
  /** The names, joined by ", " (`''` for none), of the raw materials it avoids, those it adds, and the goods it makes for other projects. */
  avoids: string; adds: string; credited: string;
}

/** What a failed mode says when the server gave no reason. */
const FAILED = 'This mode could not be planned';

/** The card's columns for `result`, in `PLAN_OBJECTIVES` order, goods named by `nameOf`. */
export function compareColumns(result: CompareResult, nameOf: (k: StuffKey) => string): CompareColumn[] {
  const names = (keys: readonly StuffKey[] | undefined): string => (keys ?? []).map(nameOf).join(', ');
  return [...result.modes]
    .sort((a, b) => PLAN_OBJECTIVES.indexOf(a.objective) - PLAN_OBJECTIVES.indexOf(b.objective))
    .map((mode): CompareColumn => {
      const s = mode.summary;
      const rows = s === undefined ? [] : [
        { label: 'Raw per hour', value: formatNumber(s.rawPerHour) },
        { label: 'Raw to build', value: formatNumber(s.rawBuild) },
        { label: 'New machines', value: formatNumber(s.newMachines) },
        { label: 'Different raw materials', value: formatNumber(s.rawSources) },
        { label: 'Steps', value: formatNumber(s.steps) },
        { label: 'Peak EU/t', value: formatNumber(s.peakEUt) },
      ];
      const note = mode.status === 'pending' ? 'Still planning…' : mode.status === 'failed' ? (mode.error ?? FAILED) : null;
      return {
        objective: mode.objective, label: OBJECTIVE_CHOICES.find((c) => c.value === mode.objective)?.label ?? mode.objective,
        current: mode.objective === result.current, status: mode.status, note, rows,
        avoids: names(mode.avoids), adds: names(mode.adds), credited: names(mode.credited),
      };
    });
}

/** Every good the modes of `result` avoid, add or make for other projects, each once, sorted (the names the card needs). */
export function compareKeys(result: CompareResult): StuffKey[] {
  const keys = new Set<StuffKey>();
  for (const mode of result.modes) for (const key of [...(mode.avoids ?? []), ...(mode.adds ?? []), ...(mode.credited ?? [])]) keys.add(key);
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
