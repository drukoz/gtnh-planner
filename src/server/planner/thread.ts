// The planning thread (RUK-563 milestone 2): the plan route's and the layout service's planning work (the plan, the
// line's goods, the build's breakdown, its price and its steps' wording) on a worker thread of its own, so the main
// thread keeps answering every other request while a line is planned. The thread loads its own pack of the export
// each job names, and its own solver threads (`solveLpAside`) live inside it. Every answer is what the same call gives
// on the main thread, bit for bit: the planner reads nothing but its arguments and the pack.

import { Worker } from 'node:worker_threads';
import type { AppContext } from '../app.ts';
import type { expandBomLines } from './bom.ts';
import type { Need, Offer } from './objective.ts';
import type { partSteps } from './steps.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { BomLine, Plan, PlanContext, PlanSettings, PlanStep } from '../../shared/types/plan.ts';

/** What `expandBomLines` gives: the whole build broken down. */
export type Expansion = Awaited<ReturnType<typeof expandBomLines>>;
/** What `partSteps` reads besides the pack. */
export type PartStepsInput = Parameters<typeof partSteps>[1];
/** One build step `partSteps` gives. */
export type PartStep = ReturnType<typeof partSteps>[number];

/** A job for the planning thread: what to run, on the pack of the export in `exportDir`. */
export type PlanningJob =
  | { kind: 'plan'; exportDir: string; settings: PlanSettings; ctx: PlanContext; offers: readonly Offer[]; needs: readonly Need[] }
  | { kind: 'goods'; exportDir: string; settings: PlanSettings; ctx: PlanContext }
  | { kind: 'expand'; exportDir: string; lines: BomLine[]; settings: PlanSettings; ctx: PlanContext; steps?: readonly PlanStep[] }
  | { kind: 'layoutCost'; exportDir: string; settings: PlanSettings; ctx: PlanContext; lines: readonly BomLine[] }
  | { kind: 'partSteps'; exportDir: string; settings: PlanSettings; ctx: PlanContext; input: PartStepsInput };

/** A job as posted to the thread, and the thread's answer to it: its value, or the message of what it threw. */
export type PlanningRequest = { id: number; job: PlanningJob };
export type PlanningReply = { id: number; value: unknown } | { id: number; error: string };

/** The `workerData` flag that makes `thread-worker.ts` run jobs. */
export const PLANNING_THREAD_FLAG = 'planningThread';

/**
 * The planning thread's calls, each the named planner call on the thread's pack of `exportDir`, answered as that call
 * answers on the main thread. A job that throws rejects with an `Error` of the same message; when the thread stops,
 * every job it had rejects, and the next job starts a new thread.
 */
export interface PlanningThread {
  /** `planLine(pack, settings, ctx, { offers, needs })`. */
  plan(exportDir: string, settings: PlanSettings, ctx: PlanContext, read: { offers: readonly Offer[]; needs: readonly Need[] }): Promise<Plan>;
  /** The keys of `linePricing(pack, settings, ctx)`'s `graph.goods`, in its order; null when `linePricing` gives null. */
  goods(exportDir: string, settings: PlanSettings, ctx: PlanContext): Promise<StuffKey[] | null>;
  /** `expandBomLines(pack, lines, settings, ctx, steps === undefined ? undefined : { steps })`. */
  expand(exportDir: string, lines: BomLine[], settings: PlanSettings, ctx: PlanContext, steps?: readonly PlanStep[]): Promise<Expansion>;
  /** `bomBuildCost(pack, settings, ctx, lines)`. */
  layoutCost(exportDir: string, settings: PlanSettings, ctx: PlanContext, lines: readonly BomLine[]): Promise<number>;
  /** `partSteps(linePack, input)`, `linePack` being `(await linePricing(pack, settings, ctx))?.pack ?? pack`. */
  partSteps(exportDir: string, settings: PlanSettings, ctx: PlanContext, input: PartStepsInput): Promise<PartStep[]>;
  /** Stops the thread; every job it had rejects. A later call starts a new one. */
  close(): Promise<void>;
}

/** Starts no thread yet: the first job does, and holds the process open only while a job is unanswered. */
export function startPlanningThread(): PlanningThread {
  let worker: Worker | null = null;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let nextId = 0;

  const stopped = (w: Worker, why: string): void => {
    if (worker !== w) return;
    worker = null;
    for (const job of pending.values()) job.reject(new Error(`The planning thread stopped: ${why}`));
    pending.clear();
  };

  const start = (): Worker => {
    const w = new Worker(new URL('./thread-worker.ts', import.meta.url), {
      workerData: { [PLANNING_THREAD_FLAG]: true }, execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    w.unref();
    w.on('message', (reply: PlanningReply) => {
      const job = pending.get(reply.id);
      if (job === undefined) return;
      pending.delete(reply.id);
      if (pending.size === 0) w.unref();
      if ('error' in reply) job.reject(new Error(reply.error));
      else job.resolve(reply.value);
    });
    w.on('error', (err: unknown) => stopped(w, err instanceof Error ? err.message : String(err)));
    w.on('exit', (code: number) => stopped(w, `it exited with code ${code}`));
    return w;
  };

  const ask = <T>(job: PlanningJob): Promise<T> => new Promise<T>((resolve, reject) => {
    const w = worker ?? start();
    worker = w;
    const id = nextId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    w.ref();
    try {
      w.postMessage({ id, job } satisfies PlanningRequest);
    } catch (err) {
      pending.delete(id);
      if (pending.size === 0) w.unref();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return {
    plan: (exportDir, settings, ctx, read) => ask<Plan>({ kind: 'plan', exportDir, settings, ctx, offers: read.offers, needs: read.needs }),
    goods: (exportDir, settings, ctx) => ask<StuffKey[] | null>({ kind: 'goods', exportDir, settings, ctx }),
    expand: (exportDir, lines, settings, ctx, steps) =>
      ask<Expansion>({ kind: 'expand', exportDir, lines, settings, ctx, ...(steps === undefined ? {} : { steps }) }),
    layoutCost: (exportDir, settings, ctx, lines) => ask<number>({ kind: 'layoutCost', exportDir, settings, ctx, lines }),
    partSteps: (exportDir, settings, ctx, input) => ask<PartStep[]>({ kind: 'partSteps', exportDir, settings, ctx, input }),
    async close() {
      const w = worker;
      if (w === null) return;
      stopped(w, 'it was closed');
      await w.terminate();
    },
  };
}

/** The app's planning thread (`app.services.planningThread`, which `main.ts` starts), or undefined: plan on this thread. */
export function planningThreadOf(app: AppContext): PlanningThread | undefined {
  return app.services.planningThread as PlanningThread | undefined;
}
