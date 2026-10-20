// Real-data acceptance on the user's reference Electronic Circuit flow (plan 12 fix wave 2, controller rulings 184 and
// 186-187, the acceptance specification of the reference-flow analysis): the reference's settings, and only its
// settings, read at run time from the main checkout's private docs/local/circuit-reference/reference.json, which is
// never committed or copied; without that file the cases skip with a logged note. It runs only with GTNH_LOCAL=1 and
// logs only counts, keys and timings; nothing game-derived is read or written otherwise. The export is loaded once.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine, type SolveTuning } from '../../../src/server/planner/plan.ts';
import { HAND_STEP_WEIGHT } from '../../../src/server/planner/solve.ts';
import { normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const REFERENCE = join('docs', 'local', 'circuit-reference', 'reference.json');
const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
const SECONDS_PER_HOUR = 3600;

/**
 * The reference file: `GTNH_REFERENCE` when set, else REFERENCE in this checkout, else in the main checkout (the parent
 * of git's common directory, where a worktree's private docs live); undefined when none exists.
 */
function referencePath(): string | undefined {
  const candidates = [process.env.GTNH_REFERENCE, resolve(REFERENCE)];
  try {
    candidates.push(join(dirname(resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim())), REFERENCE));
  } catch {
    // no git here: the other places only
  }
  return candidates.find((path): path is string => path !== undefined && existsSync(path));
}

const local = process.env.GTNH_LOCAL === '1';
const path = local ? referencePath() : undefined;
if (local && path === undefined) console.log(`real-reference: skipped, no ${REFERENCE} (the user's private reference settings)`);

/**
 * What a plan costs by the build MIP's measure, its tie-breaks aside: its raw material over the build horizon, the
 * machines it builds and the step charge on every new machine block (a pool's once; a step on a pseudo machine once, by
 * hand `HAND_STEP_WEIGHT` times), the charge being `stepCharge` × the least raw material over the horizon, at least 1
 * raw (no gathered block is made on these EnderIO lines, so S1g is S1).
 */
function buildObjective(plan: Plan, s: PlanSettings): number {
  const horizon = (s.buildHorizonHours ?? 24) * SECONDS_PER_HOUR;
  const charge = (s.stepCharge ?? 0) * Math.max((plan.rawCost?.leastPerSecond ?? 0) * horizon, 1);
  let blocks = 0;
  for (const step of plan.steps) {
    if (step.pool !== undefined && step.pool.steps[0] !== step.id) continue;
    if (step.handCraft) blocks += s.automateCrafting ? 1 : HAND_STEP_WEIGHT;
    else blocks += step.machine.mteId < 0 ? 1 : step.count - step.owned;
  }
  return (plan.rawCost?.perSecond ?? 0) * horizon + (plan.cost?.build ?? 0) + charge * blocks;
}

describe.skipIf(path === undefined)("the user's reference Electronic Circuit flow on the real 2.9 export", () => {
  let pack: Pack;
  /** The reference's settings as the planner reads them (`normalizeSettings`: no migration). */
  let stored: PlanSettings;
  const timed = async (s: PlanSettings, tuning?: SolveTuning): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, emptyContext(), tuning);
    return { plan, seconds: (performance.now() - started) / 1000 };
  };

  beforeAll(async () => {
    stored = normalizeSettings((JSON.parse(readFileSync(path as string, 'utf8')) as { settings: Partial<PlanSettings> }).settings);
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...stored, target: GLASS_TUBE, recipeChoice: {}, per: 'min', tier: 1 }, emptyContext());   // warm the pack
  }, 300_000);

  it('falls back to no more steps than the plan that ignores build cost when the time guard stops the build MIP', async () => {
    // Fix wave 2 (b): with the guard forced to 0 the line comes from the cheapest by the build MIP's objective of plan
    // 09's plan, the relaxation and S1, each rounded up; on 93e508e's fallback (the relaxation rounded up) these lines
    // had 49 and 39 steps against 36 and 20 with build cost ignored. No pins (V1 without the stops, V4 with them).
    const variants: Array<[string, PlanSettings]> = [['V1', { ...stored, recipeChoice: {}, stopItems: [] }], ['V4', { ...stored, recipeChoice: {} }]];
    for (const [name, s] of variants) {
      const guarded = await timed(s, { buildTimeLimit: 0 });
      const ignored = await timed({ ...s, buildHorizonHours: null });
      const solved = await timed(s);
      for (const [what, run] of [['guarded', guarded], ['ignored', ignored], ['solved', solved]] as const) {
        console.log(`real-reference ${name} ${what}: ${run.plan.status}, ${run.plan.steps.length} steps, objective ${buildObjective(run.plan, s).toFixed(1)}, ${run.seconds.toFixed(2)} s`);
      }
      expect(guarded.plan.status, name).toBe('ok');
      expect(guarded.plan.warnings.map((w) => w.code), name).toContain('build-cost-approx');
      expect(guarded.plan.steps.length, name).toBeLessThanOrEqual(ignored.plan.steps.length);
      expect(buildObjective(guarded.plan, s), name).toBeLessThanOrEqual(buildObjective(ignored.plan, s) * (1 + 1e-6));
    }
  }, 120_000);
});
