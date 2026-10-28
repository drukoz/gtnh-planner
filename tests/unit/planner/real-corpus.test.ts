// Real-data invariant gate of the planner-quality fix (fix spec §7.2, plan 09 Task 8): 16 targets at their natural tier
// (the lowest of LV…EV whose plan is ok, as the planner audit chose them; Steel Ingot at 10 a minute), each planned 1 a
// minute and 1 an hour without supporting lines and 1 a minute with them (48 plans), and every plan checked by the
// audit's invariant checker against an independent least-raw-material optimum of its own graph. It runs only with
// GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise. The export is loaded
// once for the whole file, and each plan is timed on a warm pack (a first, unrelated plan warms it).
//
// Plan 12 (Task 8): the plans count build cost over 24 hours by default, so the checker runs with `buildCost` (its checks
// that assume plan 09's objective follow plan 12's: nothing caps raw material above the least; a source of a good the line
// could drop at no more raw material is a note only where the plan's machines cannot do without it, `needsMachine`,
// controller ruling 249; a free detour into a gathered block is a note only on AE2 and Project Red lines, ruling 250,
// and these plans run machine to machine, which digs); and the line per hour is compared with the line per minute on the
// same settings with build cost ignored (plan 09's scale-free objective, where they run the same recipes), the build-cost
// plans' differences logged.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { DEFAULT_STEP_CHARGE, type Plan, type PlanSettings } from '../../../src/shared/types/plan.ts';
import { checkPlanInvariantsDeep, type ProducerInfo, type Violation } from '../../helpers/plan-invariants.ts';
import { CORPUS, VARIANTS } from '../../helpers/real-corpus.ts';

/**
 * A plan with build cost counted at a step charge above 0, as every corpus plan: such a plan also solves the raw cap's
 * leanest line and plan 09's plan (fix wave 3 (E), controller OQ1 (A): "each real-data file keeps its own bound for
 * build-cost plans with a step charge, which Task 13 sets to the next whole second above 1.25 x the slowest quiet-host
 * median"). The slowest, Advanced Circuit per minute (the corpus's first HV plan), took 11.50 s, the median of three on
 * 2026-10-24 (each run started at a 1-minute load under 4): 1.25 × 11.50 = 14.38.
 */
const BUILD_COST_PLAN_SECONDS = 15;
const NEVER = ['numerics', 'simplify-skipped', 'free-loop', 'graph-too-big'];
/** Invariant kinds (a), (b), (d), (e), (f): no error and no warning of these, only `info`. */
const EXACT_KINDS = ['balance', 'orphan-input', 'flow', 'machines', 'raw-source', 'byproduct'];
/** A plan's raw material may be this much above the optimum of its graph to save steps (spec §3 STEP_CHARGE_CAP). */
const STEP_CHARGE_CAP = 0.25;

/** One ban test of the deep check: the line's raw material without one producer, and how much more that is (relative). */
interface BanTest { stepId: string; costWithout: number; delta: number }

/** How much more raw material per second the line needs without the producer of `test` (Infinity: it cannot do without). */
function raiseWithout(test: BanTest): number {
  return Number.isFinite(test.costWithout) && Number.isFinite(test.delta) ? (test.costWithout * test.delta) / (1 + test.delta) : Infinity;
}

/**
 * Why a finding of kind (c) is allowed (fix spec §7.2's documented exceptions), or null: (i) co-products — at most one
 * of the steps making the good has it as its main output; (ii) a justified pair — removing any one of its main producers
 * raises the raw material by more than the step charge × the least raw material (the deep check's ban test); (iii)
 * bought and made, where every step making it is in the plan for another main output: each names another (spec D13: a
 * step making a good the line buys beside another output it uses is named after that one, as a cutting machine making
 * Wafers beside bought Poly-Si dust or a centrifuge making Arsenic beside bought Sulfur Dust); (iv) with build cost
 * counted (plan 12, controller ruling 249), a note where the deep check found that the plan's machines cannot do without
 * the source (`needsMachine`): the line without it costs the same raw material, but not within the machines the plan
 * gives its steps — one machine of A beside a cheaper machine of B for the rest, or a purchase beside steps whose
 * machines are full — so dropping it needs another machine, which the build MIP weighed. Every other finding of kind
 * (c), with build cost counted or not, needs (i)-(iii).
 */
function excuse(v: Violation, plan: Plan, stepCharge: number, optimum: number): string | null {
  if (v.severity === 'info' && v.data?.needsMachine === true) return 'build cost: dropping it needs another machine';
  if (v.kind === 'multi-producer') {
    const mains = ((v.data?.producers ?? []) as ProducerInfo[]).filter((p) => p.isMain);
    if (mains.length <= 1) return 'co-products';
    const tests = (v.data?.banTests ?? []) as BanTest[];
    const pays = mains.every((p) => {
      const test = tests.find((t) => t.stepId === p.stepId);
      return test !== undefined && raiseWithout(test) > stepCharge * optimum;
    });
    return pays ? 'a justified pair' : null;
  }
  if (v.kind === 'bought-and-made') {
    const makers = Object.keys((v.data?.producers ?? {}) as Record<string, number>);
    return makers.every((id) => plan.steps.find((s) => s.id === id)?.mainOutput !== v.key) ? 'made beside another main output' : null;
  }
  return null;
}

const recipeIds = (plan: Plan): string[] => plan.steps.map((s) => s.recipeId).sort();

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the plan 09 corpus on the real 2.9 export', () => {
  let pack: Pack;
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...defaultSettings(), target: 'gregtech:gt.metaitem.03@32012', per: 'min', tier: 2 }, emptyContext());
  }, 300_000);

  /** Plans `settings`, timed, and checks everything fix spec §7.2 asks of a corpus plan. */
  async function expectSound(name: string, settings: PlanSettings): Promise<Plan> {
    const started = performance.now();
    const plan = await planLine(pack, settings, emptyContext());
    const seconds = (performance.now() - started) / 1000;
    console.log(`real-corpus ${name}: ${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps`);
    expect(plan.status, `${name}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
    expect(seconds, name).toBeLessThan(BUILD_COST_PLAN_SECONDS);
    expect(plan.warnings.map((w) => w.code).filter((c) => NEVER.includes(c)), name).toEqual([]);
    const stepCharge = settings.stepCharge ?? DEFAULT_STEP_CHARGE;
    const buildCost = settings.buildHorizonHours !== null;
    const found = await checkPlanInvariantsDeep(pack, settings, plan, {
      marginal: false, stepCharge, buildCost, farmPack: (await linePricing(pack, settings, emptyContext()))?.pack,
    });
    const text = (v: Violation): string => `${v.kind}/${v.severity}: ${v.message}`;
    expect(found.filter((v) => EXACT_KINDS.includes(v.kind) && v.severity !== 'info').map(text), name).toEqual([]);
    // Kind (g): with build cost counted a detour into a gathered block is a note on AE2 and Project Red lines (plan 12's
    // D1), any other a warning (controller ruling 250): these machine-to-machine plans dig their gathered blocks.
    expect(found.filter((v) => v.kind === 'free-detour' && v.severity !== 'info').map(text), name).toEqual([]);
    // Raw material: nothing from solver tolerance; with build cost ignored at most the step charge's cap above the
    // optimum (with it counted the machines it saves may pay for more, architecture §11.39 amending §11.34).
    const cost = found.find((v) => v.kind === 'cost' && v.data?.optimum !== undefined);
    expect(cost, name).toBeDefined();
    const { planCost, optimum } = cost?.data as { planCost: number; optimum: number };
    expect(planCost, name).toBeGreaterThanOrEqual(optimum * (1 - 1e-6));
    if (!buildCost) expect(planCost, name).toBeLessThanOrEqual(optimum * (1 + STEP_CHARGE_CAP));
    expect(found.filter((v) => v.kind === 'cost' && v.severity === 'error').map(text), name).toEqual([]);
    // (c) per good: never an error, a warning or note only under one of the documented exceptions.
    for (const v of found.filter((x) => x.kind === 'multi-producer' || x.kind === 'bought-and-made')) {
      const good = `${name}, ${pack.nameOf(v.key ?? '')}: ${text(v)}`;
      expect(v.severity, good).not.toBe('error');
      expect(excuse(v, plan, stepCharge, optimum), good).not.toBeNull();
    }
    return plan;
  }

  for (const target of CORPUS) {
    it(`plans ${target.name} at its natural tier soundly per minute, per hour and with supporting lines`, async () => {
      const plans = new Map<string, Plan>();
      const settingsOf = (v: (typeof VARIANTS)[number]): PlanSettings =>
        ({ ...defaultSettings(), target: target.key, amount: target.amount, per: v.per, tier: target.tier, routeDerived: v.routeDerived });
      for (const v of VARIANTS) plans.set(v.label, await expectSound(`${target.name} ${v.label}`, settingsOf(v)));
      // The LP is the same at every rate (fix spec D1): with build cost ignored, per hour the line runs the same recipes
      // as per minute. With it counted the objective weighs machines against the rate (plan 12), so they may differ:
      // logged.
      const [perMinute, perHour] = VARIANTS;
      const ignored = async (v: (typeof VARIANTS)[number]): Promise<Plan> => planLine(pack, { ...settingsOf(v), buildHorizonHours: null }, emptyContext());
      expect(recipeIds(await ignored(perHour))).toEqual(recipeIds(await ignored(perMinute)));
      const hour = recipeIds(plans.get('per hour') as Plan);
      const minute = recipeIds(plans.get('per minute') as Plan);
      console.log(`real-corpus ${target.name}: with build cost per hour ${hour.length} recipes, per minute ${minute.length}; `
        + `per hour only ${hour.filter((id) => !minute.includes(id)).join(' ') || 'none'}, per minute only ${minute.filter((id) => !hour.includes(id)).join(' ') || 'none'}`);
    }, 180_000);
  }
});
