// Real-data acceptance on the user's reference Electronic Circuit flow (plan 12 fix wave 2, controller rulings 184 and
// 186-187, the acceptance specification of the reference-flow analysis; the user's ruling 179's case without the
// reference's pins and stops, plan 12 Task 8): the reference's settings, and only its
// settings, read at run time from the main checkout's private docs/local/circuit-reference/reference.json, which is
// never committed or copied; without that file the cases skip with a logged note. It runs only with GTNH_LOCAL=1 and
// logs only counts, keys and timings; nothing game-derived is read or written otherwise. The export is loaded once.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine, type SolveTuning } from '../../../src/server/planner/plan.ts';
import { normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_STEP_CHARGE, FREE_KEYS, type Plan, type PlanSettings } from '../../../src/shared/types/plan.ts';
import { buildObjective } from '../../helpers/build-objective.ts';
import { REFERENCE, localDocPath, storedSettings } from '../../helpers/local-docs.ts';

const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
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
/**
 * Its Molten Tin from Tin Dust, and the same recipe on a Tin Ingot at the same raw price, which the reference accepts in
 * its place (controller ruling 201, option (i) on the tin twin: the user's base materials are ingots).
 */
const TIN_FROM_DUST = '1197004ce4210fc5';
const TIN_FROM_INGOT = 'd4bfdccc8c512446';
/** Its centrifuge step: Rubber Wood on circuit 2, 3 Centrifuges at MV. */
const RUBBER_WOOD_CENTRIFUGE = '85e9bdddf3f2bced';
const TIN_DUST = 'gregtech:gt.metaitem.01@2057';
const TIN_INGOT = 'gregtech:gt.metaitem.01@11057';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
/**
 * The reference's raw materials (the user's ruling 179: Rubber Wood, Copper Ingot, Steel Ingot, Tin Dust, Redstone, Sand;
 * tin as dust or ingot, controller ruling 201) and the free inputs.
 */
const REFERENCE_RAW_KINDS: ReadonlySet<string> = new Set([
  'IC2:blockRubWood@0', 'gregtech:gt.metaitem.01@11035', STEEL_INGOT, 'gregtech:gt.metaitem.01@2057', 'gregtech:gt.metaitem.01@11057', 'minecraft:redstone@0',
  'minecraft:sand@0', ...FREE_KEYS,
]);
/** Its raw material per minute (the acceptance spec's REF_RAW): tin as dust or ingot (controller ruling 201). */
const REF_RAW: Readonly<Record<string, number>> = {
  'IC2:blockRubWood@0': 32, 'gregtech:gt.metaitem.01@11035': 11.25, [STEEL_INGOT]: 4, tin: 1, 'minecraft:redstone@0': 5, 'minecraft:sand@0': 2,
};

const local = process.env.GTNH_LOCAL === '1';
/** The reference file: `GTNH_REFERENCE` when set, else in this checkout, else in the main checkout (`localDocPath`). */
const path = local ? localDocPath(REFERENCE, process.env.GTNH_REFERENCE) : undefined;
if (local && path === undefined) console.log(`real-reference: skipped, no ${REFERENCE} (the user's private reference settings)`);

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
 * The plan's step recipes, sorted, with the Extruder's rods read as the Lathe's (which the spec allows) and the Tin Ingot
 * extractor as the reference's Tin Dust one (controller ruling 201, option (i) on the tin twin): the user's base
 * materials are ingots, so the ingot is the stock form, and `twinMoves` (solve.ts) keeps the Tin Ingot twin by its rule
 * (c), ingot before dust, as these lines buy tin for their Molten Tin alone. Once the inputsOnly base-list fix lands, the
 * user's own list decides the form ahead of rule (c).
 */
function referenceIds(plan: Plan): string[] {
  const same: Readonly<Record<string, string>> = { [ROD_EXTRUDER]: ROD_LATHE, [TIN_FROM_INGOT]: TIN_FROM_DUST };
  return plan.steps.map((s) => same[s.recipeId] ?? s.recipeId).sort();
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
    stored = normalizeSettings(storedSettings(path as string));
    byHand = { ...stored, automateCrafting: false };
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...stored, target: GLASS_TUBE, recipeChoice: {}, per: 'min', tier: 1 }, emptyContext());   // warm the pack
  }, 300_000);

  it('R0: plans the reference as stored, with its 16 recipes, raw material, 14 machine blocks, 3 Centrifuges and 4 hand steps', async () => {
    // The acceptance spec's R0 (its pins, stops and crafting by hand, its stored 2 % step charge: normalizeSettings
    // applies no migration). On 93e508e: 17 blocks, 6 Basic Centrifuges for 3 Advanced (the step charge was per step).
    // Its 16 recipes, the Molten Tin from Tin Dust or its Tin Ingot twin (controller ruling 201: `referenceIds`).
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
    // The acceptance spec's R1: R0's recipes, the Molten Tin from Tin Dust or its Tin Ingot twin (controller ruling 201).
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

  it('probes R1 with its new machines at MV, and with new multiblocks only where nothing else can do it', async () => {
    // The user's ruling 224 (2026-10-20): "Build machines at" MV, logged with its machine blocks and raw material, and
    // "Multiblocks: only when nothing else can do it", logged with the multiblocks that remain. A step that builds new
    // machines elsewhere than at MV, or a new multiblock, says why on the step.
    const r1: PlanSettings = { ...stored, automateCrafting: true };
    const atMv = await timed({ ...r1, buildTier: 2 });
    logPlan('R1, new machines at MV', atMv.plan, atMv.seconds);
    expect(atMv.plan.status, JSON.stringify(atMv.plan.warnings)).toBe('ok');
    for (const s of atMv.plan.steps) {
      if (s.handCraft || s.machine.mteId < 0 || !(s.count > s.owned) || s.machine.tier === 2) continue;
      expect(s.warnings.filter((w) => w.startsWith('Built at')), s.recipeId).toHaveLength(1);
    }
    const required = await timed({ ...r1, multiblocks: 'only-required' });
    logPlan('R1, multiblocks only where required', required.plan, required.seconds);
    expect(required.plan.status, JSON.stringify(required.plan.warnings)).toBe('ok');
    const multiblocks = required.plan.steps.filter((s) => pack.machines.get(s.machine.mteId)?.kind === 'multiblock');
    console.log(`real-reference R1, multiblocks only where required: ${multiblocks.length === 0 ? 'no multiblock'
      : multiblocks.map((s) => `${s.count}× ${s.machine.name} (${s.recipeId}, ${s.owned} owned)`).join('; ')}`);
    for (const s of multiblocks) {
      if (s.count > s.owned) expect(s.warnings.filter((w) => w.startsWith('A multiblock is needed')), s.recipeId).toHaveLength(1);
    }
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
      // The three weighed alike: by the least raw material of the line with gathered blocks dug, the plan's that ignores
      // build cost (these EnderIO lines make none, so it is the least of each).
      const least = ignored.plan.rawCost?.leastPerSecond ?? 0;
      for (const [what, run] of [['guarded', guarded], ['ignored', ignored], ['solved', solved]] as const) {
        console.log(`real-reference ${name} ${what}: ${run.plan.status}, ${run.plan.steps.length} steps, objective ${buildObjective(run.plan, s, least).toFixed(1)}, ${run.seconds.toFixed(2)} s`);
      }
      expect(guarded.plan.status, name).toBe('ok');
      expect(guarded.plan.warnings.map((w) => w.code), name).toContain('build-cost-approx');
      expect(guarded.plan.steps.length, name).toBeLessThanOrEqual(ignored.plan.steps.length);
      expect(buildObjective(guarded.plan, s, least), name).toBeLessThanOrEqual(buildObjective(ignored.plan, s, least) * (1 + 1e-6));
    }
  }, 120_000);

  it("plans the line without the reference's pins and stops, at the default build-cost settings, in no more machine blocks than the reference, from its raw materials unless that is dearer", async () => {
    // The user's ruling 179 (2026-10-20): "the fewer machines make a big difference where 3 % more raw material is
    // negligible" — the reference's settings without its recipe pins and stop items, at the defaults of build cost (24
    // hours, "Fewest machines"), crafting on Auto Workbenches: no more machine blocks than the reference (its 12 machine
    // steps, one of them 3 Centrifuges, and its 4 crafting steps on Auto Workbenches: the reference at the same settings),
    // and no raw material outside the reference's unless the plan is cheaper than the reference by the build MIP's measure.
    // Where the 24-hour horizon does not achieve it, the other horizons are tried and logged for the controller, and the
    // case fails rather than loosen (the ruling: a controller ruling is needed then).
    const defaults: Partial<PlanSettings> = { stepCharge: DEFAULT_STEP_CHARGE, buildHorizonHours: DEFAULT_BUILD_HORIZON_HOURS, automateCrafting: true };
    const judge = async (hours: number): Promise<{ text: string; ok: boolean; blocks: boolean; raw: boolean }> => {
      const own: PlanSettings = { ...stored, ...defaults, recipeChoice: {}, stopItems: [], buildHorizonHours: hours };
      const reference: PlanSettings = { ...stored, ...defaults, buildHorizonHours: hours };
      const mine = await timed(own);
      const theirs = await timed(reference);
      const least = mine.plan.rawCost?.leastPerSecond ?? 0;
      const leanest = mine.plan.rawCost?.leanestPerSecond ?? 0;   // fix wave 3 (B2): the step charge's other base
      const outside = mine.plan.rawInputs.map((r) => r.key).filter((key) => !REFERENCE_RAW_KINDS.has(key)).sort();
      const cheaper = buildObjective(mine.plan, own, least, leanest) < buildObjective(theirs.plan, reference, least, leanest);
      const blocks = machineBlocks(mine.plan) <= machineBlocks(theirs.plan);
      const raw = outside.length === 0 || cheaper;
      return {
        ok: mine.plan.status === 'ok' && blocks && raw, blocks, raw,
        text: `${hours} h: ${mine.plan.status}, ${mine.seconds.toFixed(2)} s, ${mine.plan.steps.length} steps, ${machineBlocks(mine.plan)} machine blocks `
          + `against the reference's ${machineBlocks(theirs.plan)}; raw ${(((mine.plan.rawCost?.perSecond ?? 0) * 60)).toFixed(3)} a minute, build ${mine.plan.cost?.build}, `
          + `outside the reference's raw materials ${outside.join(' ') || 'none'}; by the build MIP's measure ${buildObjective(mine.plan, own, least, leanest).toFixed(1)} `
          + `against the reference's ${buildObjective(theirs.plan, reference, least, leanest).toFixed(1)}; raw kinds ${mine.plan.rawInputs.map((r) => r.key).join(' ')}; `
          + `the reference: raw ${(((theirs.plan.rawCost?.perSecond ?? 0) * 60)).toFixed(3)} a minute, build ${theirs.plan.cost?.build}, raw kinds ${theirs.plan.rawInputs.map((r) => r.key).join(' ')}`,
      };
    };
    const day = await judge(DEFAULT_BUILD_HORIZON_HOURS);
    console.log(`real-reference without pins and stops, ${day.text}`);
    if (!day.ok) {
      let largest: number | undefined;
      for (const hours of [1, 2, 4, 8, 12, 48, 168, 720, 8760]) {
        const other = await judge(hours);
        console.log(`real-reference without pins and stops, FOR THE CONTROLLER (the user's ruling 179), ${other.text}`);
        if (other.ok) largest = hours;
      }
      console.log(`real-reference without pins and stops: the largest horizon that achieves it: ${largest === undefined ? 'none of 1 h to 8,760 h' : `${largest} h`}`);
    }
    expect(day.blocks, 'no more machine blocks than the reference').toBe(true);
    expect(day.raw, "the reference's raw materials, unless dearer").toBe(true);
  }, 600_000);

  it('A1 and V4 from the base materials only ("Only these come in", fix wave 3 (B))', async () => {
    // The acceptance spec's BASE (REFERENCE_RAW_KINDS without the free inputs). V4: the stored settings without pins (its
    // stops include Molten Redstone Alloy, which BASE leaves out). A1: no pins, stops Copper Ingot + Steel Ingot, Rubber Wood
    // at 0 (add-on 17's farm stand-in), crafting automated, the stored step charge. This fix owns A1 (b); (c) and (e) hold
    // too and are asserted; (a)'s time, (d)'s machine blocks and (f) belong to other lanes and are logged only.
    const base = [...REFERENCE_RAW_KINDS].filter((key) => !FREE_KEYS.includes(key));
    const outside = (plan: Plan): string[] => plan.rawInputs.map((r) => r.key).filter((key) => !REFERENCE_RAW_KINDS.has(key));
    const v4 = await timed({ ...stored, recipeChoice: {}, inputsOnly: base });
    logPlan('V4 + BASE', v4.plan, v4.seconds);
    expect(v4.plan.status, JSON.stringify(v4.plan.warnings)).toBe('ok');
    expect(outside(v4.plan)).toEqual([]);
    expect(v4.plan.warnings.filter((w) => w.code === 'stop-outside-inputs').map((w) => w.key)).toEqual(['fluid:molten.redstonealloy']);
    const a1: PlanSettings = {
      ...stored, recipeChoice: {}, stopItems: ['gregtech:gt.metaitem.01@11035', STEEL_INGOT], inputsOnly: base, automateCrafting: true,
      costOverrides: { ...stored.costOverrides, 'IC2:blockRubWood@0': 0 },
    };
    const mine = await timed(a1);
    const pinned = await timed({ ...a1, recipeChoice: stored.recipeChoice });
    logPlan('A1', mine.plan, mine.seconds);
    logPlan('A1 with the reference pins', pinned.plan, pinned.seconds);
    const least = mine.plan.rawCost?.leastPerSecond ?? 0;
    const leanest = mine.plan.rawCost?.leanestPerSecond ?? 0;   // the step charge's other base (fix wave 3 (B2), Task 7)
    console.log(`real-reference A1: ${machineBlocks(mine.plan)} machine blocks (A1 (d): at most 18), approx ${mine.plan.warnings.some((w) => w.code === 'build-cost-approx')}, `
      + `raw ${((mine.plan.rawCost?.perSecond ?? 0) / least).toFixed(4)} x the least; by the build MIP's measure ${buildObjective(mine.plan, a1, least, leanest).toFixed(1)} `
      + `against the reference pins' ${buildObjective(pinned.plan, a1, least, leanest).toFixed(1)}`);
    expect(mine.plan.status, JSON.stringify(mine.plan.warnings)).toBe('ok');
    expect(outside(mine.plan)).toEqual([]);                                   // (b)
    expect(mine.plan.steps.filter((s) => s.handCraft)).toEqual([]);           // (c)
    const raw = rawPerMinute(mine.plan);                                      // (e): at most the reference's, per base input
    for (const [key, most] of Object.entries(REF_RAW)) expect(raw[key] ?? 0, key).toBeLessThanOrEqual(most + 1e-6);
  }, 300_000);
});
