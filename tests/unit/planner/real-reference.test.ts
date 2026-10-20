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
/** Plan 09's bound on a real-data plan with a warm pack (an MV line; ruling 187). */
const PLAN_SECONDS = 5;

/** The reference's 16 step recipes (the acceptance spec's REF_IDS). */
const REF_IDS: readonly string[] = [
  '0808d860600af273', '1197004ce4210fc5', '391f33f5fad58a0e', '3b34f87f2984fe95', '551a7e121b83f8a5', '5e6fc6d8b7780920', '81809934c9e573da',
  '85e9bdddf3f2bced', '85eaebd6c5132556', '922523df6bc22ca3', '960dc3ce801a4e96', 'c0106c4cb6b4b041', 'c19837cccfcebc98', 'd25f29069b92783e',
  'd528af67b884c660', 'fd5543a5f831c58b',
];
/** Its Steel Rod on the Lathe, and on the Extruder (2 rods an ingot), which the spec allows in its place. */
const ROD_LATHE = '3b34f87f2984fe95';
const ROD_EXTRUDER = '31693ed806ba0a95';
/** Its centrifuge step: Rubber Wood on circuit 2, 3 Centrifuges at MV. */
const RUBBER_WOOD_CENTRIFUGE = '85e9bdddf3f2bced';
const TIN_DUST = 'gregtech:gt.metaitem.01@2057';
const TIN_INGOT = 'gregtech:gt.metaitem.01@11057';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
/** Its raw material per minute (the acceptance spec's REF_RAW): tin as dust or ingot. */
const REF_RAW: Readonly<Record<string, number>> = {
  'IC2:blockRubWood@0': 32, 'gregtech:gt.metaitem.01@11035': 11.25, [STEEL_INGOT]: 4, tin: 1, 'minecraft:redstone@0': 5, 'minecraft:sand@0': 2,
};

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

/** The acceptance spec's machine blocks: the machines of every step not crafted by hand, a sharing pool once (Auto Workbenches count). */
function machineBlocks(plan: Plan): number {
  let blocks = 0;
  for (const step of plan.steps) if (!step.handCraft && (step.pool === undefined || step.pool.steps[0] === step.id)) blocks += step.count;
  return blocks;
}

/** The plan's raw material per minute by key, tin dust and tin ingot as one `tin`. */
function rawPerMinute(plan: Plan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of plan.rawInputs) {
    const key = r.key === TIN_DUST || r.key === TIN_INGOT ? 'tin' : r.key;
    out[key] = (out[key] ?? 0) + r.perSecond * 60;
  }
  return out;
}

/**
 * The plan's step recipes, sorted, with the Extruder's rods read as the Lathe's (the one exception the spec allows). Its
 * Molten Tin is the reference's, from Tin Dust: a plan that runs the Tin Ingot twin of that recipe (d4bfdccc8c512446),
 * the same at the same raw material, runs the dust's instead (`twinMoves`, solve.ts), so it never comes down to chance.
 */
function referenceIds(plan: Plan): string[] {
  return plan.steps.map((s) => (s.recipeId === ROD_EXTRUDER ? ROD_LATHE : s.recipeId)).sort();
}

/** Its raw material is the reference's: every key to 1e-6, steel at most 4 a minute (2 with the Extruder), nothing else. */
function expectReferenceRaw(plan: Plan, name: string): void {
  const raw = rawPerMinute(plan);
  expect(Object.keys(raw).sort(), name).toEqual(Object.keys(REF_RAW).sort());
  for (const [key, want] of Object.entries(REF_RAW)) {
    if (key === STEEL_INGOT) {
      const most = plan.steps.some((s) => s.recipeId === ROD_EXTRUDER) ? 2 : 4;
      expect(raw[key] as number, `${name} ${key}`).toBeLessThanOrEqual(most + 1e-6);
    } else {
      expect(Math.abs((raw[key] as number) - want), `${name} ${key}`).toBeLessThanOrEqual(1e-6);
    }
  }
}

/** One log line of a plan: counts, keys and its time only. */
function logPlan(name: string, plan: Plan, seconds: number): void {
  const raw = Object.entries(rawPerMinute(plan)).map(([key, n]) => `${key} ${n.toFixed(4)}`).join(', ');
  console.log(`real-reference ${name}: ${plan.status}, ${plan.steps.length} steps, ${machineBlocks(plan)} machine blocks, `
    + `${plan.steps.filter((s) => s.handCraft).length} by hand, build ${plan.cost?.build ?? 0}, ${seconds.toFixed(2)} s; raw a minute: ${raw}`);
}

describe.skipIf(path === undefined)("the user's reference Electronic Circuit flow on the real 2.9 export", () => {
  let pack: Pack;
  /** The reference's settings as the planner reads them (`normalizeSettings`: no migration). */
  let stored: PlanSettings;
  /**
   * R0's settings: `stored` with crafting by hand given explicitly, as the acceptance spec's R0 crafts by hand. The stored
   * project says so today; once `normalizeSettings` reads every project as automated (the user's ruling that crafting
   * steps are automatic), `planLine` still plans an explicit `automateCrafting: false` by hand.
   */
  let byHand: PlanSettings;
  const timed = async (s: PlanSettings, tuning?: SolveTuning): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, emptyContext(), tuning);
    return { plan, seconds: (performance.now() - started) / 1000 };
  };

  beforeAll(async () => {
    stored = normalizeSettings((JSON.parse(readFileSync(path as string, 'utf8')) as { settings: Partial<PlanSettings> }).settings);
    byHand = { ...stored, automateCrafting: false };
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...stored, target: GLASS_TUBE, recipeChoice: {}, per: 'min', tier: 1 }, emptyContext());   // warm the pack
  }, 300_000);

  it('R0: plans the reference as stored, with its 16 recipes, raw material, 14 machine blocks, 3 Centrifuges and 4 hand steps', async () => {
    // The acceptance spec's R0 (its pins, stops and crafting by hand, its stored 2 % step charge: normalizeSettings
    // applies no migration). On 93e508e: 17 blocks, 6 Basic Centrifuges for 3 Advanced (the step charge was per step).
    // Its 16 recipes exactly, the Molten Tin from Tin Dust included (on 56e177c the ingot twin's at 2 %, the dust's at 50 %).
    const { plan, seconds } = await timed(byHand);
    logPlan('R0', plan, seconds);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    expect(plan.warnings.map((w) => w.code)).not.toContain('build-cost-approx');
    expect(referenceIds(plan)).toEqual([...REF_IDS].sort());
    expectReferenceRaw(plan, 'R0');
    expect(machineBlocks(plan)).toBe(14);
    const centrifuges = plan.steps.find((s) => s.recipeId === RUBBER_WOOD_CENTRIFUGE);
    expect(centrifuges?.machine.name).toMatch(/Centrifuge/);
    expect(centrifuges?.count).toBe(3);
    expect(plan.steps.filter((s) => s.handCraft)).toHaveLength(4);
    // A Project Red copy shares no machine (fix wave 2 (d)): the two circuit-1 Wiremills keep their own, 14 blocks still.
    const routed = await timed({ ...byHand, logistics: 'routed' });
    logPlan('R0 on Project Red', routed.plan, routed.seconds);
    expect(routed.plan.status).toBe('ok');
    expect(routed.plan.steps.filter((s) => s.pool !== undefined)).toEqual([]);
    expect(machineBlocks(routed.plan)).toBe(14);
    const ae2 = await timed({ ...byHand, logistics: 'ae2' });
    logPlan('R0 on AE2 (logged only: its parts need HV and EV)', ae2.plan, ae2.seconds);
  }, 120_000);

  it('R1: plans R0 with its crafting on 4 Auto Workbenches, no hand step and 18 machine blocks', async () => {
    // The acceptance spec's R1: R0's recipes exactly, the Molten Tin from Tin Dust included.
    const { plan, seconds } = await timed({ ...stored, automateCrafting: true });
    logPlan('R1', plan, seconds);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    expect(plan.warnings.map((w) => w.code)).not.toContain('build-cost-approx');
    expect(referenceIds(plan)).toEqual([...REF_IDS].sort());
    expectReferenceRaw(plan, 'R1');
    const crafting = plan.steps.filter((s) => /Auto Workbench/.test(s.machine.name));
    expect(crafting.map((s) => s.recipeId).sort()).toEqual(['551a7e121b83f8a5', '81809934c9e573da', '922523df6bc22ca3', 'd25f29069b92783e']);
    for (const s of crafting) expect(s.count, s.recipeId).toBe(1);
    expect(plan.steps.filter((s) => s.handCraft)).toEqual([]);
    expect(machineBlocks(plan)).toBe(18);
  }, 120_000);

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
