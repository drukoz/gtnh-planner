// The planning thread's own side (thread.ts, RUK-563 milestone 2): runs each job it is posted on its pack of the job's
// export, loaded once per export folder (a load that fails is forgotten, so the next job tries again), and posts back
// the job's value or the message of what it threw. Jobs run as they would on the main thread, interleaved at their awaits.

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadPack } from '../pack/load.ts';
import { expandBomLines } from './bom.ts';
import { bomBuildCost } from './build-cost.ts';
import { planLine } from './plan.ts';
import { linePricing } from './pricing.ts';
import { partSteps } from './steps.ts';
import { PLANNING_THREAD_FLAG, type PlanningJob, type PlanningReply, type PlanningRequest } from './thread.ts';
import type { Pack } from '../../shared/types/pack.ts';

let loaded: { exportDir: string; pack: Promise<Pack> } | null = null;

/** The pack of the export in `exportDir`: the one loaded last when it is the same folder, else a new load. */
function packOf(exportDir: string): Promise<Pack> {
  if (loaded?.exportDir === exportDir) return loaded.pack;
  const entry = { exportDir, pack: loadPack(exportDir) };
  loaded = entry;
  entry.pack.catch(() => {
    if (loaded === entry) loaded = null;
  });
  return entry.pack;
}

/** `job` run on this thread, as `PlanningThread`'s doc comments say. */
export async function runPlanningJob(job: PlanningJob): Promise<unknown> {
  const pack = await packOf(job.exportDir);
  switch (job.kind) {
    case 'plan':
      return planLine(pack, job.settings, job.ctx, { offers: job.offers, needs: job.needs });
    case 'goods': {
      const pricing = linePricing(pack, job.settings, job.ctx);
      return pricing === null ? null : [...(await pricing).graph.goods.keys()];
    }
    case 'expand':
      return expandBomLines(pack, job.lines, job.settings, job.ctx, job.steps === undefined ? undefined : { steps: job.steps });
    case 'layoutCost':
      return bomBuildCost(pack, job.settings, job.ctx, job.lines);
    case 'partSteps': {
      const pricing = linePricing(pack, job.settings, job.ctx);
      return partSteps(pricing === null ? pack : (await pricing).pack ?? pack, job.input);
    }
  }
}

if (!isMainThread && (workerData as Record<string, unknown> | null)?.[PLANNING_THREAD_FLAG] === true) {
  const port = parentPort;
  port?.on('message', ({ id, job }: PlanningRequest) => {
    runPlanningJob(job).then(
      (value) => port.postMessage({ id, value } satisfies PlanningReply),
      (err: unknown) => port.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies PlanningReply),
    );
  });
}
