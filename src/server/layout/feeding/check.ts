// The feeding checker (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 11; research
// `docs/research/machine-feeding.md` §7): `checkFeeding` reads a laid-out line (`readLine`), runs the static rules
// (`precheckFeeding`) and then the tick simulation in each scenario (`runScenario`), and reports what it found, what each
// machine input was planned to get and got, and what it could not know.
// - The scenarios (research §7; `scenarioParams`): `steady`; `fast_supplier`, the makers of each 2+ kind machine's first
//   kind ten times faster; `late_input`, each such machine's last kind held back for `LATE_TICKS`; `restart`, the line's
//   chunk loaded again at `restartAt`; `multistack_on`, Multi Stack Input On where the layout leaves it unset.
// - Findings: the static ones (precheckFeeding's order), then each scenario's in `SCENARIOS` order. A scenario other than
//   `steady` reports only the findings whose code, machine and item `steady` does not have: what its schedule adds. `ok` is
//   true when no `certain` finding has a gate code (`FEED_GATE_CODES`); a static risk never gates.
// - Inputs: per machine and planned item (the model's local order, then key), the plan's rate, what each scenario handed
//   over in the run's second half, per second, and in `restart` what came in the `BURST_TICKS` before the restart and in
//   those from it.
// - Unknowns: the model's, then each scenario's, each (code, place, step, item) once, the first met kept with its count, in
//   the order first met: an item dropped at one machine in every scenario is one unknown, and two items dropped there are two.
//   `stack_sizes` is in every report once, a report of the static rules alone too (they read stack sizes as well).
// - A line with nothing to check (a plan with status `empty` or `infeasible`, an empty layout, no machine read) is `ok`, with
//   the unknown `empty_line` and what reading it left unknown (Review Focus 2).
// - Deterministic: the same inputs give a deep-equal report, scheduled or with every entity on every tick (`exhaustive`).
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../shared/keys.ts';
import type { Layout } from '../../../shared/types/layout.ts';
import type { Pack } from '../../../shared/types/pack.ts';
import type { Plan } from '../../../shared/types/plan.ts';
import {
  BURST_TICKS, DEFAULT_TICKS, FEED_GATE_CODES, SCENARIOS, SLOW_TOLERANCE, TICKS_PER_SECOND,
  type FeedFinding, type FeedingOptions, type FeedingReport, type FeedUnknown, type InputReport, type ScenarioName,
} from './contract.ts';
import type { FeedModel, NodeId } from './model.ts';
import { precheckFeeding } from './precheck.ts';
import { readLine } from './read.ts';
import { runScenario, stackSizesUnknown, type ScenarioRun } from './sim/run.ts';

export { scenarioParams, type ScenarioParams } from './sim/run.ts';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rule 2's unknown: a line with nothing to check. */
const EMPTY_LINE: FeedUnknown = { code: 'empty_line', text: 'Nothing to check: the layout places no machine' };

/**
 * The feeding report of `layout`, the line laid out for `plan` (Task 11 rules 1–6). Options default to 24,000 ticks a
 * scenario, every scenario of `SCENARIOS`, a restart at half the run, no AE2 co-processor, no fluid in ME and a 10 %
 * tolerance for `feed_slow`; `scenarios: []` runs the static rules only.
 */
export function checkFeeding(input: { pack: Pack; plan: Plan; layout: Layout; options?: FeedingOptions }): FeedingReport {
  const { pack, plan, layout, options = {} } = input;
  // rule 1: the options
  const ticks = options.ticks ?? DEFAULT_TICKS;
  const restartAt = options.restartAt ?? Math.floor(ticks / 2);
  const asked = options.scenarios ?? SCENARIOS;
  const scenarios = SCENARIOS.filter((s) => asked.includes(s));
  const model = readLine({ pack, plan, layout });

  // rule 2: a line with nothing to check
  if (plan.status === 'empty' || plan.status === 'infeasible' || layout.status === 'empty' || !model.nodes.some((n) => n.kind !== 'chest')) {
    return { ok: true, findings: [], inputs: [], scenarios: [], unknowns: distinctUnknowns([EMPTY_LINE, ...model.unknowns]) };
  }

  const runs = scenarios.map((name) => runScenario(model, name, {
    ticks, restartAt, exhaustive: options.exhaustive === true, ae2Coprocessors: options.ae2Coprocessors ?? 0,
    ae2FluidStock: options.ae2FluidStock === true, slowTolerance: options.slowTolerance ?? SLOW_TOLERANCE,
  }));
  const findings = [...precheckFeeding(model, pack), ...scenarioFindings(runs)];
  // rule 6: with no scenario run, the report still says once that it takes the stack sizes it does (the static rules read them)
  const runUnknowns = runs.length === 0 ? [stackSizesUnknown()] : runs.flatMap((r) => r.unknowns);
  return {
    ok: !findings.some((f) => f.certainty === 'certain' && FEED_GATE_CODES.includes(f.code)),
    findings,
    inputs: inputReports(model, runs, ticks, restartAt),
    unknowns: distinctUnknowns([...model.unknowns, ...runUnknowns]),
    scenarios: runs.map((r) => ({ name: r.name, ticks: r.ticks, runs: r.runs, out: r.out })),
  };
}

/** A finding's code, machine (its world cell) and item: what rule 4 compares across scenarios. */
function identity(f: FeedFinding): string {
  return `${f.code}|${f.pos.join(' ')}|${f.key ?? ''}`;
}

/**
 * Rule 4: each scenario's findings, in run order (`SCENARIOS`'); a scenario other than `steady` keeps only those whose code,
 * machine and item `steady` does not have. Without `steady` among the runs, there is nothing to compare with, and every
 * scenario keeps all of its findings.
 */
function scenarioFindings(runs: readonly ScenarioRun[]): FeedFinding[] {
  const steady = runs.find((r) => r.name === 'steady');
  const known = new Set(steady?.findings.map(identity) ?? []);
  return runs.flatMap((r) => (r === steady ? r.findings : r.findings.filter((f) => !known.has(identity(f)))));
}

/**
 * Rule 5: one report per machine node and item its steps plan (node order, then key): the plan's rate (a shared machine's
 * steps summed, under the first step that plans the item), what each scenario handed over in `[⌊ticks/2⌋, ticks)` per second
 * (a multiblock gets its items through its input buses) — that window cut where an AE2 job had no more of the item for the
 * machine (`ScenarioRun.jobEnds`), and no rate where that came before the window — and in `restart` what came in
 * `[restartAt − BURST_TICKS, restartAt)` and in `[restartAt, restartAt + BURST_TICKS)`.
 */
function inputReports(model: FeedModel, runs: readonly ScenarioRun[], ticks: number, restartAt: number): InputReport[] {
  const half = Math.floor(ticks / 2);
  const seconds = (ticks - half) / TICKS_PER_SECOND;
  const reports: InputReport[] = [];
  for (const node of model.nodes) {
    if (node.kind === 'chest') continue;
    const planned = new Map<StuffKey, { rate: number; stepId: string }>();
    for (const stepId of node.stepIds) {
      for (const [key, rate] of Object.entries(model.planned[stepId] ?? {})) {
        const p = planned.get(key);
        planned.set(key, { rate: (p?.rate ?? 0) + rate, stepId: p?.stepId ?? stepId });
      }
    }
    if (planned.size === 0) continue;
    const at: NodeId[] = [node.id, ...(node.kind === 'multi' ? node.inBuses.map((b) => b.id) : [])];
    const given = runs.map((r) => at.flatMap((id) => r.stats.deliveries(id)));
    for (const [key, p] of [...planned].sort((a, b) => compareText(a[0], b[0]))) {
      const deliveredPerSecond: Partial<Record<ScenarioName, number>> = {};
      let burst: { before: number; after: number } | null = null;
      for (let i = 0; i < runs.length; i++) {
        const end = Math.min(ticks, runs[i]!.jobEnds[node.id]?.[key] ?? ticks);
        let late = 0, before = 0, after = 0;
        for (const [t, k, n] of given[i]!) {
          if (k !== key) continue;
          if (t >= half && t < end) late += n;
          if (t >= restartAt - BURST_TICKS && t < restartAt) before += n;
          else if (t >= restartAt && t < restartAt + BURST_TICKS) after += n;
        }
        const name = runs[i]!.name;
        if (end < ticks) {
          if (end > half) deliveredPerSecond[name] = late / ((end - half) / TICKS_PER_SECOND);
        } else deliveredPerSecond[name] = seconds > 0 ? late / seconds : 0;
        if (name === 'restart') burst = { before, after };
      }
      reports.push({
        stepId: p.stepId, machine: node.label, pos: [node.pos[0], node.pos[1], node.pos[2]], key, plannedPerSecond: p.rate, deliveredPerSecond,
        ...(burst === null ? {} : { burst }),
      });
    }
  }
  return reports;
}

/**
 * Rule 6: each (code, place, step, item) once, the first met kept with its count, in the order met. Only an unknown raised
 * once per item (`items_dropped`, `pr_queue_lost`, `pr_wander_path`) carries its item (`key`).
 */
function distinctUnknowns(list: readonly FeedUnknown[]): FeedUnknown[] {
  const seen = new Set<string>();
  const out: FeedUnknown[] = [];
  for (const u of list) {
    const id = `${u.code}|${u.pos?.join(' ') ?? '-'}|${u.stepId ?? '-'}|${u.key ?? '-'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...u, ...(u.pos === undefined ? {} : { pos: [u.pos[0], u.pos[1], u.pos[2]] }) });
  }
  return out;
}
