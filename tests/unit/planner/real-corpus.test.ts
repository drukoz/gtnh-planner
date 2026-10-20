// Real-data invariant gate of the planner-quality fix (fix spec §7.2, plan 09 Task 8): 16 targets at their natural tier
// (the lowest of LV…EV whose plan is ok, as the planner audit chose them; Steel Ingot at 10 a minute), each planned 1 a
// minute and 1 an hour without supporting lines and 1 a minute with them (48 plans), and every plan checked by the
// audit's invariant checker against an independent least-raw-material optimum of its own graph. It runs only with
// GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise. The export is loaded
// once for the whole file, and each plan is timed on a warm pack (a first, unrelated plan warms it).

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { DEFAULT_STEP_CHARGE, type Plan, type PlanSettings } from '../../../src/shared/types/plan.ts';
import { checkPlanInvariantsDeep, type ProducerInfo, type Violation } from '../../helpers/plan-invariants.ts';

interface Target { name: string; key: StuffKey; tier: number; amount: number }
/** The 16 targets of fix spec §7.2 and their natural tiers on the 2.9 export (LV 1, MV 2, HV 3). */
const CORPUS: readonly Target[] = [
  { name: 'Electronic Circuit', key: 'IC2:itemPartCircuit@0', tier: 1, amount: 1 },
  { name: 'Good Electronic Circuit', key: 'gregtech:gt.metaitem.01@32702', tier: 2, amount: 1 },
  { name: 'Integrated Logic Circuit', key: 'gregtech:gt.metaitem.01@32701', tier: 2, amount: 1 },
  { name: 'Advanced Circuit', key: 'IC2:itemPartCircuitAdv@0', tier: 3, amount: 1 },
  { name: 'Vacuum Tube', key: 'gregtech:gt.metaitem.01@32700', tier: 1, amount: 1 },
  { name: 'Resistor', key: 'gregtech:gt.metaitem.01@32716', tier: 1, amount: 1 },
  { name: 'Glass Tube', key: 'gregtech:gt.metaitem.03@32012', tier: 1, amount: 1 },
  { name: 'Circuit Board', key: 'gregtech:gt.metaitem.03@32100', tier: 1, amount: 1 },
  { name: 'LV Machine Hull', key: 'gregtech:gt.blockmachines@11', tier: 1, amount: 1 },
  { name: 'MV Machine Hull', key: 'gregtech:gt.blockmachines@12', tier: 2, amount: 1 },
  { name: 'Electric Motor (LV)', key: 'gregtech:gt.metaitem.01@32600', tier: 1, amount: 1 },
  { name: 'Electric Pump (LV)', key: 'gregtech:gt.metaitem.01@32610', tier: 1, amount: 1 },
  { name: 'Robot Arm (LV)', key: 'gregtech:gt.metaitem.01@32650', tier: 1, amount: 1 },
  { name: 'Robot Arm (MV)', key: 'gregtech:gt.metaitem.01@32651', tier: 2, amount: 1 },
  { name: 'Polyethylene (PE) Bar', key: 'gregtech:gt.metaitem.01@11874', tier: 1, amount: 1 },
  { name: 'Steel Ingot', key: 'gregtech:gt.metaitem.01@11305', tier: 1, amount: 10 },
];
/** The three variants of every target (fix spec §7.2). */
const VARIANTS = [
  { label: 'per minute', per: 'min', routeDerived: false },
  { label: 'per hour', per: 'hour', routeDerived: false },
  { label: 'per minute with supporting lines', per: 'min', routeDerived: true },
] as const;
const PLAN_SECONDS = 5;
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
 * Wafers beside bought Poly-Si dust or a centrifuge making Arsenic beside bought Sulfur Dust).
 */
function excuse(v: Violation, plan: Plan, stepCharge: number, optimum: number): string | null {
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
    expect(plan.status, `${name}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
    expect(seconds, name).toBeLessThan(PLAN_SECONDS);
    expect(plan.warnings.map((w) => w.code).filter((c) => NEVER.includes(c)), name).toEqual([]);
    const stepCharge = settings.stepCharge ?? DEFAULT_STEP_CHARGE;
    const found = await checkPlanInvariantsDeep(pack, settings, plan, { marginal: false, stepCharge });
    const text = (v: Violation): string => `${v.kind}/${v.severity}: ${v.message}`;
    expect(found.filter((v) => EXACT_KINDS.includes(v.kind) && v.severity !== 'info').map(text), name).toEqual([]);
    expect(found.filter((v) => v.kind === 'free-detour').map(text), name).toEqual([]);
    // Raw material: nothing from solver tolerance, at most the step charge's cap above the optimum.
    const cost = found.find((v) => v.kind === 'cost' && v.data?.optimum !== undefined);
    expect(cost, name).toBeDefined();
    const { planCost, optimum } = cost?.data as { planCost: number; optimum: number };
    expect(planCost, name).toBeGreaterThanOrEqual(optimum * (1 - 1e-6));
    expect(planCost, name).toBeLessThanOrEqual(optimum * (1 + STEP_CHARGE_CAP));
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
      for (const v of VARIANTS) {
        const settings: PlanSettings = { ...defaultSettings(), target: target.key, amount: target.amount, per: v.per, tier: target.tier, routeDerived: v.routeDerived };
        plans.set(v.label, await expectSound(`${target.name} ${v.label}`, settings));
      }
      // The LP is the same at every rate (fix spec D1): per hour the line runs the same recipes as per minute.
      expect(recipeIds(plans.get('per hour') as Plan)).toEqual(recipeIds(plans.get('per minute') as Plan));
    }, 120_000);
  }
});
