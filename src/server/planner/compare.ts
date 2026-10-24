// The Compare card's planning (add-on 17; design spec §3.3, architecture §11.45 (5)): each planning mode of a project
// planned with its own settings (`modeSettings`: one settings hash per mode, the current mode's the project's own, so the
// plan route and the card share its cached plan, and the modes share the line's pricing), summed up for the card
// (`compareSummary`) with the raw goods each mode avoids and adds against the others (`modeDifferences`) and the goods it
// is credited for (`creditedKeys`); the modes planned one after another, the current one first, within a time limit, the
// rest finishing after the answer (`compareModes`); and one compare per project at a time, at most a few projects at once
// per app, the newest settings winning (`CompareRunner`, `compareRunnerFor`).

import type { AppContext } from '../app.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { CompareMode } from '../../shared/types/api.ts';
import {
  DEFAULT_BUILD_HORIZON_HOURS, PLAN_OBJECTIVES, type Plan, type PlanObjective, type PlanSettings, type PlanStep,
} from '../../shared/types/plan.ts';
import { objectiveOf } from './objective.ts';
import { sig9 } from './round.ts';

/** How long a compare waits for its modes before it answers; the modes still planning then go on and say when they are done. */
export const COMPARE_TIME_LIMIT_SECONDS = 20;
/** At most this many projects' compares plan at once per app (`CompareRunner`); the others wait their turn. */
export const COMPARE_MAX_RUNNING = 2;

const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The settings mode `objective` of `settings`' project is planned with: the project's own for the mode it plans in, so
 * the plan route and the card share that cached plan; else `{ ...settings, objective }`, with
 * `buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS` for cheapest and best multi-output (in rate mode a null horizon plans
 * least raw material). That is what "Use this mode" leaves the project with (`withObjectiveRules`), so the plan route
 * then serves the plan the card made. Only the mode and the horizon differ, of which a line's pricing reads only whether
 * build cost counts (`linePricing`), so a compare prices the line at most twice: least raw, and the two that count it.
 */
export function modeSettings(settings: PlanSettings, objective: PlanObjective): PlanSettings {
  if (objective === objectiveOf(settings)) return settings;
  if (objective === 'least-raw') return { ...settings, objective };
  return { ...settings, objective, buildHorizonHours: settings.buildHorizonHours ?? DEFAULT_BUILD_HORIZON_HOURS };
}

/**
 * The raw goods `plan` buys: its raw input rows that cost raw material (above 0), less a farm's tool wear (`upkeep`) and
 * what another project or a farm the group runs supplies (`from`).
 */
export function rawKeys(plan: Plan): Set<StuffKey> {
  return new Set(plan.rawInputs.filter((r) => r.cost > 0 && r.upkeep !== true && r.from === undefined).map((r) => r.key));
}

/** The steps by machine type (mteId), in step order: the machines a Make N batch shares (make-n.ts). */
function byMachineType(steps: readonly PlanStep[]): PlanStep[][] {
  const types = new Map<number, PlanStep[]>();
  for (const step of steps) {
    const type = types.get(step.machine.mteId);
    if (type === undefined) types.set(step.machine.mteId, [step]);
    else type.push(step);
  }
  return [...types.values()];
}

/**
 * The machines `plan` adds to those the group owns: `count − owned` of the steps on a real machine (mteId ≥ 0, not crafted
 * by hand), the machines its steps share counted once — a sharing pool's (`machineGroups`), or in Make N, where the steps
 * of one machine type share its machines, each type's.
 */
function newMachines(plan: Plan): number {
  const groups = plan.makeN === undefined ? machineGroups(plan.steps) : byMachineType(plan.steps);
  let total = 0;
  for (const group of groups) {
    let added = 0;
    for (const step of group) {
      if (step.machine.mteId >= 0 && !step.handCraft) added = Math.max(added, step.count - step.owned);
    }
    total += added;
  }
  return total;
}

/**
 * What the card shows of a mode's plan: raw material to run it an hour (`Plan.cost.runPerHour`, else the raw material a
 * second × 3,600) and to build the machines it adds (`Plan.cost.build`, else 0), the machines it adds (`newMachines`),
 * its distinct raw sources (`Plan.rawSources`, else the raw goods it buys), its steps and its peak EU/t.
 */
export function compareSummary(plan: Plan): NonNullable<CompareMode['summary']> {
  return {
    rawPerHour: plan.cost?.runPerHour ?? sig9((plan.rawCost?.perSecond ?? 0) * SECONDS_PER_HOUR),
    rawBuild: plan.cost?.build ?? 0,
    newMachines: newMachines(plan),
    rawSources: plan.rawSources ?? rawKeys(plan).size,
    steps: plan.steps.length,
    peakEUt: plan.power.peakEUt,
  };
}

/**
 * Per mode of `plans`: the raw goods some other mode's plan buys and this one does not (`avoids`), and those this one buys
 * and no other does (`adds`), both sorted (`rawKeys`).
 */
export function modeDifferences(plans: ReadonlyMap<PlanObjective, Plan>): Map<PlanObjective, { avoids: StuffKey[]; adds: StuffKey[] }> {
  const bought = new Map([...plans].map(([objective, plan]) => [objective, rawKeys(plan)] as const));
  const differences = new Map<PlanObjective, { avoids: StuffKey[]; adds: StuffKey[] }>();
  for (const [objective, mine] of bought) {
    const others = [...bought].filter(([other]) => other !== objective).map(([, keys]) => keys);
    const avoids = new Set<StuffKey>();
    for (const keys of others) for (const key of keys) if (!mine.has(key)) avoids.add(key);
    const adds = [...mine].filter((key) => others.every((keys) => !keys.has(key)));
    differences.set(objective, { avoids: [...avoids].sort(byString), adds: adds.sort(byString) });
  }
  return differences;
}

/**
 * The goods `plan` is credited for (`Plan.credits`), each once, sorted: byproducts of the runs its own line needs, which
 * other projects take (OQ5) — never a reason its raw material went up.
 */
export function creditedKeys(plan: Plan): StuffKey[] {
  return [...new Set((plan.credits ?? []).map((c) => c.key))].sort(byString);
}

/** How a mode's planning ended: its plan, or why it has none. */
type Outcome = { plan: Plan } | { error: string };

/** `objective`'s outcome: its plan when `ok`; else the plan's first warning, or the message `planMode` failed with. */
async function outcomeOf(planMode: (o: PlanObjective) => Promise<Plan>, objective: PlanObjective): Promise<Outcome> {
  try {
    const plan = await planMode(objective);
    if ((plan.status ?? 'ok') === 'ok') return { plan };
    return { error: plan.warnings[0]?.text ?? 'No plan was found in this mode' };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

/** The modes in `PLAN_OBJECTIVES` order as the card gets them, the `ok` ones compared with each other. */
function modesOf(outcomes: ReadonlyMap<PlanObjective, Outcome>): CompareMode[] {
  const plans = new Map<PlanObjective, Plan>();
  for (const objective of PLAN_OBJECTIVES) {
    const outcome = outcomes.get(objective);
    if (outcome !== undefined && 'plan' in outcome) plans.set(objective, outcome.plan);
  }
  const differences = modeDifferences(plans);
  return PLAN_OBJECTIVES.map((objective): CompareMode => {
    const outcome = outcomes.get(objective);
    if (outcome === undefined) return { objective, status: 'pending' };
    if ('error' in outcome) return { objective, status: 'failed', error: outcome.error };
    const credited = creditedKeys(outcome.plan);
    return {
      objective, status: 'ok', summary: compareSummary(outcome.plan), ...differences.get(objective),
      ...(credited.length === 0 ? {} : { credited }),
    };
  });
}

/**
 * Plans the three modes with `planMode`, one after another — on the one Node thread, where HiGHS solves synchronously,
 * in turn is as fast as at once and leaves the event loop free between modes —: `current` first (the plan route has
 * usually cached it), then the others in `PLAN_OBJECTIVES` order, starting no mode once `stale()` is true. Answers when
 * every mode has settled or `limitSeconds` have passed, in `PLAN_OBJECTIVES` order: `ok` with its summary, the raw goods
 * it avoids and adds against the other `ok` modes and the goods it is credited for (when any); `failed` with why (a plan
 * that is not `ok` with its first warning's text, a rejection with its message); `pending` when not settled or not
 * started. The modes still planning go on, and `onLate()` is called once when the last of them settles — never when the
 * run went stale, as the newer run answers for it. `planning`, when given, gets at once the promise of the whole
 * planning, which may outlast the answer (`CompareRunner` holds the project's turn until it settles).
 */
export async function compareModes(
  planMode: (o: PlanObjective) => Promise<Plan>,
  opts: { current: PlanObjective; limitSeconds: number; onLate: () => void; stale?: () => boolean; planning?: (all: Promise<void>) => void },
): Promise<CompareMode[]> {
  const stale = opts.stale ?? ((): boolean => false);
  const order = [opts.current, ...PLAN_OBJECTIVES.filter((o) => o !== opts.current)];
  const outcomes = new Map<PlanObjective, Outcome>();
  const planning = (async (): Promise<void> => {
    for (const objective of order) {
      if (stale()) return;
      outcomes.set(objective, await outcomeOf(planMode, objective));
    }
  })();
  opts.planning?.(planning);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, opts.limitSeconds * MS_PER_SECOND);
  });
  await Promise.race([planning, limit]);
  clearTimeout(timer);
  const modes = modesOf(outcomes);
  if (modes.some((m) => m.status === 'pending')) {
    void planning
      .then(() => {
        if (!stale()) opts.onLate();
      })
      .catch((err: unknown) => console.error('Saying that the late modes of a compare are done failed:', err));
  }
  return modes;
}

/**
 * What a compare runs: `stale()` turns true once a compare of the project's newer settings is asked for (it then starts
 * no other mode), and `planning`, when its modes go on planning past its answer, gets the promise of that planning, so
 * the project's turn lasts until it settles (`compareModes`' `planning`).
 */
export type CompareStart = (stale: () => boolean, planning: (all: Promise<unknown>) => void) => Promise<CompareMode[]>;

/** The compare a project waits to run: the newest call's settings hash and start, and the answer every waiting caller gets. */
interface WaitingCompare { hash: string; start: CompareStart; answer: PromiseWithResolvers<CompareMode[]> }
/** The compare a project runs: its settings hash, whether a newer call made it stale, and its answer. */
interface RunningCompare { hash: string; stale: boolean; answer: Promise<CompareMode[]> }
interface ProjectCompares { running: RunningCompare | null; waiting: WaitingCompare | null }

/**
 * One compare per project at a time, at most `maxRunning` (`COMPARE_MAX_RUNNING`) projects at once, as `replanInBackground`
 * runs one replan per project: without it every settings change and every `plan` event (a fan-out from another project
 * included) with the card open would start two more uncached full plans at once. A call for the settings hash of the
 * running compare shares it; a call for other settings makes the running one stale (it finishes the mode it is in and
 * starts no other) and waits for it, and a later call replaces the waiting one: the newest settings win, and every
 * waiting caller gets the answer of the compare that then runs. A project's turn lasts until its compare's planning
 * ends, past its answer when modes were still planning then. The projects waiting for a turn start in the order they
 * asked.
 */
export class CompareRunner {
  readonly #maxRunning: number;
  readonly #projects = new Map<string, ProjectCompares>();
  /** The projects with a waiting compare, in the order it was asked for. */
  readonly #queue: string[] = [];
  #running = 0;

  constructor(maxRunning: number = COMPARE_MAX_RUNNING) {
    this.#maxRunning = Math.max(1, maxRunning);
  }

  /**
   * The answer of `projectId`'s compare of `settingsHash` (what its plans read of the project: the compare route passes
   * the settings hash and the project's world), `start` run when its turn comes, unless a running compare is shared.
   */
  run(projectId: string, settingsHash: string, start: CompareStart): Promise<CompareMode[]> {
    let project = this.#projects.get(projectId);
    if (project === undefined) {
      project = { running: null, waiting: null };
      this.#projects.set(projectId, project);
    }
    const { running, waiting } = project;
    if (running !== null && !running.stale && running.hash === settingsHash) return running.answer;
    if (running !== null) running.stale = true;
    if (waiting !== null) {
      waiting.hash = settingsHash;
      waiting.start = start;
      return waiting.answer.promise;
    }
    const next: WaitingCompare = { hash: settingsHash, start, answer: Promise.withResolvers<CompareMode[]>() };
    project.waiting = next;
    this.#queue.push(projectId);
    this.#startWaiting();
    return next.answer.promise;
  }

  /** Starts the waiting compares, in the order they were asked for, of projects that run none, while turns are free. */
  #startWaiting(): void {
    while (this.#running < this.#maxRunning) {
      const i = this.#queue.findIndex((id) => this.#projects.get(id)?.running === null);
      if (i < 0) return;
      const id = this.#queue.splice(i, 1)[0] as string;
      this.#begin(id, this.#projects.get(id) as ProjectCompares);
    }
  }

  /** Runs `project`'s waiting compare; when it and its planning have settled, the project's turn passes on. */
  #begin(projectId: string, project: ProjectCompares): void {
    const waiting = project.waiting as WaitingCompare;
    project.waiting = null;
    const running: RunningCompare = { hash: waiting.hash, stale: false, answer: waiting.answer.promise };
    project.running = running;
    this.#running++;
    let planning: Promise<unknown> | undefined;
    const answer = (async () => waiting.start(() => running.stale, (all) => { planning = all; }))();
    answer.then(waiting.answer.resolve, waiting.answer.reject);
    const end = (): void => {
      this.#running--;
      project.running = null;
      if (project.waiting === null) this.#projects.delete(projectId);
      this.#startWaiting();
    };
    void answer.then(() => planning, () => planning).then(end, end);
  }
}

const RUNNERS = new WeakMap<AppContext, CompareRunner>();

/** The compare runner of one app (one per `AppContext`, as `planCacheFor`). */
export function compareRunnerFor(app: AppContext): CompareRunner {
  let runner = RUNNERS.get(app);
  if (runner === undefined) {
    runner = new CompareRunner();
    RUNNERS.set(app, runner);
  }
  return runner;
}
