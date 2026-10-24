// Real-data acceptance of plan 12's build cost (Task 8; design spec §3.3 Objective, "How materials are counted" and
// "Reusing machines we have", D1–D3; architecture §11.39): the calibration plans on the active export with build cost
// counted over the default 24 hours, nothing owned and with two of every candidate machine owned (`owning`), each timed
// on a warm pack, its build MIP run again on its own (`buildRun`) to log the MIP's time, nodes, objective, bound and
// gap — its node and simplex-iteration limits decide, never time (controller ruling 183 (2), fix wave 3 (F)) — and each
// held to the plan that ignores build cost by the build MIP's own measure (controller ruling 187); what a line adds that
// cannot be built here or has no price; how it gets its sand and gravel; the step counts against the plan that ignores
// build cost (D1); the horizon trade; the time guard; the speed of the price table; the build-cost plans of plan 09's
// checks that build cost legitimately changes (plan 12 Task 8 Step 4); and the build MIP's pick (fix wave 3 (F), ledger
// 248). It runs only with GTNH_LOCAL=1 and logs only counts, keys and timings; nothing game-derived is read or written
// otherwise. The user's reference flow joins the calibration plans when its private settings file is there (docs/local,
// never committed).

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { benchCapBy } from '../../../src/server/planner/benches.ts';
import { buildKeys, itemPrices, machineBuildCost, machineGap } from '../../../src/server/planner/build-cost.ts';
import type { CandidateGraph } from '../../../src/server/planner/candidates.ts';
import { lineBuildModel, optionMachines, type BuildModel } from '../../../src/server/planner/machine-options.ts';
import { emptyContext, planLine, solveOptions, stockForm } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { solveLine, type Solution } from '../../../src/server/planner/solve.ts';
import { tierName, V } from '../../../src/shared/gt/tiers.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings, normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Machine, Pack } from '../../../src/shared/types/pack.ts';
import { DEFAULT_BUILD_HORIZON_HOURS, type Plan, type PlanContext, type PlanSettings } from '../../../src/shared/types/plan.ts';
import { buildObjective } from '../../helpers/build-objective.ts';
import { REFERENCE, localDocPath, storedSettings } from '../../helpers/local-docs.ts';
import { USER_EC_STORED } from '../../helpers/user-project.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
const ADVANCED_CIRCUIT = 'IC2:itemPartCircuitAdv@0';
const POLYETHYLENE_BAR = 'gregtech:gt.metaitem.01@11874';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
const ALUMINIUM_INGOT = 'gregtech:gt.metaitem.01@11019';
const MICROPROCESSOR = 'gregtech:gt.metaitem.03@32078';
const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
const SAND = 'minecraft:sand@0';
const GRAVEL = 'minecraft:gravel@0';
const HAMMER_MAP = 'gt.recipe.hammer';
/** Plan 09's bound on a real-data plan with a warm pack (its real-data files' own constant, which plan 09 does not export: ruling P13). */
const PLAN_SECONDS = 5;
/** HV acceptance lines at 0 % step charge or with avoid lists may take this long (controller ruling 187). */
const HV_SLOW_PLAN_SECONDS = 8;
/** D1's headroom over the plan that ignores build cost (plan 09's headroom over a measured count). */
const STEP_HEADROOM = 5;
/** Steps one AE2 pool runs at most (controller Amendment OQ6, ruling P15): one ME Interface's patterns. */
const AE2_POOL_MAX_STEPS = 9;
/** `GTNH_BUILD_NODES`: the build MIP's node limit for a calibration run the controller asks for (`SolveOptions.buildMaxNodes`). */
const NODES = process.env.GTNH_BUILD_NODES === undefined ? undefined : Number(process.env.GTNH_BUILD_NODES);
const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };

/** One calibration plan: its settings and whether two of every candidate machine of its line are owned (`owning`). */
interface Case { name: string; settings: PlanSettings; owned: boolean }

const at = (target: StuffKey, tier: number, amount: number, more: Partial<PlanSettings> = {}): PlanSettings =>
  ({ ...defaultSettings(), per: 'min', target, tier, amount, ...more });

/**
 * The eleven calibration plans of plan 12 (seven nothing owned, two of them routed; four through `owning`), the
 * Electronic Circuit at LV on AE2 (ruling P15), and where its settings file is there the user's reference flow's R0, R1,
 * V1 and V4 (controller ruling 184): R0 as stored but crafted by hand, R1 crafted on Auto Workbenches, V1 without its pins
 * and stops, V4 without its pins.
 */
const CASES: Case[] = [
  { name: 'Electronic Circuit MV', settings: at(ELECTRONIC_CIRCUIT, 2, 1), owned: false },
  { name: 'Electronic Circuit MV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 2, 1, { logistics: 'routed' }), owned: false },
  { name: 'Good Electronic Circuit HV', settings: at(GOOD_ELECTRONIC_CIRCUIT, 3, 1), owned: false },
  { name: 'Polyethylene Bar MV', settings: at(POLYETHYLENE_BAR, 2, 1), owned: false },
  { name: 'Steel Ingot MV x10', settings: at(STEEL_INGOT, 2, 10), owned: false },
  { name: 'Electronic Circuit LV', settings: at(ELECTRONIC_CIRCUIT, 1, 1), owned: false },
  { name: 'Electronic Circuit LV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' }), owned: false },
  { name: 'Electronic Circuit MV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 2, 1, { logistics: 'routed' }), owned: true },
  { name: 'Polyethylene Bar MV', settings: at(POLYETHYLENE_BAR, 2, 1), owned: true },
  { name: 'Electronic Circuit LV', settings: at(ELECTRONIC_CIRCUIT, 1, 1), owned: true },
  { name: 'Electronic Circuit LV on Project Red', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' }), owned: true },
  { name: 'Electronic Circuit LV on AE2', settings: at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'ae2' }), owned: false },
];
const local = process.env.GTNH_LOCAL === '1';
const referenceFile = local ? localDocPath(REFERENCE, process.env.GTNH_REFERENCE) : undefined;
if (local && referenceFile === undefined) console.log(`real-build-cost: the reference flow's cases skipped, no ${REFERENCE}`);
if (referenceFile !== undefined) {
  const stored = normalizeSettings(storedSettings(referenceFile));
  CASES.push(
    { name: 'reference R0 (by hand)', settings: { ...stored, automateCrafting: false }, owned: false },
    { name: 'reference R1', settings: { ...stored, automateCrafting: true }, owned: false },
    { name: 'reference V1 (no pins, no stops)', settings: { ...stored, recipeChoice: {}, stopItems: [] }, owned: false },
    { name: 'reference V4 (no pins)', settings: { ...stored, recipeChoice: {} }, owned: false },
  );
}
const LABELLED = CASES.map((c) => ({ ...c, label: `${c.name}${c.owned ? ', two of every machine owned' : ''}` }));

/** The line's build MIP run on its own, as `planLine` solves the line when nothing is avoided. */
interface BuildRun {
  sol: Solution; model: BuildModel; graph: CandidateGraph;
  /** The line's first walk, before any recipe is walked around: its graph and build model (`optionMachines`' list for it). */
  first: { graph: CandidateGraph; model: BuildModel };
  /** Walks of the line, the last the one solved. */
  rounds: number;
  /** The step recipes the build models blocked (no machine that runs them can be built here or is owned), every walk's. */
  blocked: string[];
  /** How many of the pack's recipes alike to those were walked around with them (`BuildModel.blockedAlike`). */
  alike: number;
}

/**
 * The build MIP's measure of a plan (controller ruling 187; `buildObjective`, tests/helpers/build-objective.ts), its
 * `least` the least raw material a second with gathered world blocks dug: the plan's that ignores build cost, whose walk
 * digs them.
 */
const leastDug = (ignored: Plan): number => ignored.rawCost?.leastPerSecond ?? 0;

/** How a plan gets `key`: dug (a raw input), made (by its steps), both, or neither. */
function sourceOf(plan: Plan, key: StuffKey): 'dug' | 'made' | 'both' | 'none' {
  const dug = plan.rawInputs.some((r) => r.key === key);
  const made = plan.steps.some((s) => s.outputs.some((o) => o.key === key));
  return dug && made ? 'both' : dug ? 'dug' : made ? 'made' : 'none';
}

/** The plan's sharing pools as `<n>× <machine>: <steps>`, one each. */
function poolsOf(plan: Plan): string[] {
  return plan.steps.filter((s) => s.pool !== undefined && s.pool.steps[0] === s.id)
    .map((s) => `${s.count}× ${s.machine.name}: ${(s.pool?.steps ?? []).join(', ')}`);
}

describe.skipIf(!local)('build cost on the real 2.9 export', () => {
  let pack: Pack;
  const ctx: PlanContext = emptyContext();

  const timed = async (s: PlanSettings): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, ctx);
    return { plan, seconds: (performance.now() - started) / 1000 };
  };

  /** The machines the step recipes of `s`'s line can run on (`optionMachines`, nothing owned): its basis's tier and multiblocks, its crafting and bench rules. */
  const candidateMachines = async (s: PlanSettings): Promise<Machine[]> => {
    const pricing = linePricing(pack, s, ctx);
    if (pricing === null) throw new Error(`no line for ${s.target}`);
    const { graph, basis } = await pricing;
    const capBy = benchCapBy(s.logistics);
    return optionMachines(pack, graph, {
      groupTier: basis.tier, multiblocks: basis.env.multiblocks, automateCrafting: s.automateCrafting, ...(capBy === undefined ? {} : { benchCapBy: capBy }),
    }, new Map());
  };

  /**
   * `s` with `ownedManual` two of every machine `optionMachines` lists for its line's graph (`candidateMachines`): every
   * step can run on owned machines at no build cost, so only the step charge bounds a free chain (plan review).
   */
  const owning = async (s: PlanSettings): Promise<PlanSettings> =>
    ({ ...s, ownedManual: (await candidateMachines(s)).map((m) => ({ mteId: m.mteId, count: 2 })) });

  /**
   * The line's build MIP on its own (plan 12 Task 5's walk): its pricing and build model, both made again without the
   * recipes the model blocks (with the pack's alike ones) while it blocks any, as `planLine` does, then `solveLine` with
   * the model, and the node limit of `GTNH_BUILD_NODES` when set.
   */
  const buildRun = async (s: PlanSettings): Promise<BuildRun> => {
    const unbuildable = new Map<string, string>();
    const blocked = new Set<string>();
    let first: BuildRun['first'] | undefined;
    for (let rounds = 1; ; rounds++) {
      const pricing = linePricing(pack, s, ctx, { unbuildable });
      if (pricing === null) throw new Error(`no line for ${s.target}`);
      const { graph, basis, target } = await pricing;
      const model = await lineBuildModel(pack, graph, basis, s, ctx);
      first ??= { graph, model };
      let grew = false;
      for (const [id, why] of model.blocked) {
        blocked.add(id);
        if (unbuildable.has(id)) continue;
        unbuildable.set(id, why);
        grew = true;
      }
      if (grew) {
        for (const [id, why] of model.blockedAlike ?? []) if (!unbuildable.has(id)) unbuildable.set(id, why);
        continue;
      }
      const sol = await solveLine(graph, new Map([[target, s.amount / SECONDS_PER[s.per]]]), {
        ...solveOptions(s), formRank: stockForm(pack), build: model, ...(NODES === undefined ? {} : { buildMaxNodes: NODES }),
      });
      return { sol, model, graph, first, rounds, blocked: [...blocked].sort(), alike: unbuildable.size - blocked.size };
    }
  };

  /**
   * Of the machines `optionMachines` lists for the line's graph — its first walk's, before any recipe is walked around
   * (`BuildRun.first`: the eligible options of every step recipe, `lineBuildModel`'s list) — how many cannot be built here
   * (OQ5 a) and how many are pricing gaps (OQ5 b): a machine priced for any of its uses is priced.
   */
  const machineCounts = (run: BuildRun): { candidates: number; unbuildable: number; gaps: number } => {
    const rank = { priced: 0, gap: 1, unbuildable: 2 } as const;
    const verdict = new Map<number, keyof typeof rank>();
    for (const r of run.first.graph.recipes) {
      if (r.kind !== 'recipe') continue;
      for (const o of run.first.model.eligible(r.id)) {
        const v = o.build !== null ? 'priced' : o.unbuildable !== undefined ? 'unbuildable' : 'gap';
        const before = verdict.get(o.mteId);
        if (before === undefined || rank[v] < rank[before]) verdict.set(o.mteId, v);
      }
    }
    const values = [...verdict.values()];
    return { candidates: values.length, unbuildable: values.filter((v) => v === 'unbuildable').length, gaps: values.filter((v) => v === 'gap').length };
  };

  /** Price tables measured so far: each measure's cost override has a value of its own, so its memo key is new. */
  let measured = 0;
  /** Seconds the price table of `s`'s line takes on a memo key nothing priced yet (a cost override that matches nothing). */
  const priceTableSeconds = async (s: PlanSettings): Promise<number> => {
    const machines = await candidateMachines(s);
    const fresh: PlanSettings = { ...s, costOverrides: { ...s.costOverrides, 'gregtech:gt.metaitem.01@99999': ++measured } };
    const started = performance.now();
    await itemPrices(pack, fresh, ctx, buildKeys(pack, machines));
    return (performance.now() - started) / 1000;
  };

  /**
   * One log line of a plan, each `it` one per plan it makes (Step 2's list): its target, tier, logistics and what is
   * owned; seconds, steps, run, build and unpriced cost; how many of the machines its graph lists cannot be built here
   * (OQ5 a) and are pricing gaps (OQ5 b); the step recipes its build models block and its walks; its sharing pools; how it
   * gets its sand and gravel; its price table's seconds; its build MIP's seconds, nodes, end, objective, bound and gap
   * (`buildRun`, run here); and with `ignored`, the plan that ignores build cost, both by the build MIP's measure. Counts,
   * keys and timings only. Returns the build run and the price table's seconds.
   */
  const logPlan = async (label: string, s: PlanSettings, plan: Plan, seconds: number, ignored?: Plan): Promise<{ run: BuildRun; priceSeconds: number }> => {
    const run = await buildRun(s);
    const priceSeconds = await priceTableSeconds(s);
    const counts = machineCounts(run);
    const stats = run.sol.buildStats;
    const gap = stats?.objective !== undefined && stats.bound !== undefined && stats.objective > 0 ? (stats.objective - stats.bound) / stats.objective : undefined;
    const pools = poolsOf(plan);
    const owned = s.ownedManual ?? [];
    console.log([
      `real-build-cost ${label}: ${s.target} at ${tierName(s.tier ?? 1)} on ${s.logistics},`
        + ` ${owned.length === 0 ? 'nothing owned' : `${owned.reduce((n, o) => n + o.count, 0)} machines of ${owned.length} types owned`},`
        + ` build horizon ${s.buildHorizonHours === null ? 'ignored' : `${s.buildHorizonHours} h`};`,
      `${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps${ignored === undefined ? '' : ` (ignoring build cost ${ignored.steps.length})`};`,
      `run ${plan.cost?.runPerHour ?? '-'} raw/h, build ${plan.cost?.build ?? '-'}, unpriced ${plan.cost?.unpriced ?? 0};`,
      `candidate machines ${counts.candidates}: ${counts.unbuildable} cannot be built here, ${counts.gaps} pricing gaps;`,
      `walks ${run.rounds}, blocked step recipes ${run.blocked.length === 0 ? 'none' : `${run.blocked.length} (${run.blocked.join(' ')})`} and ${run.alike} alike ones;`,
      `pools ${pools.length === 0 ? 'none' : pools.join(' | ')}; sand ${sourceOf(plan, SAND)}, gravel ${sourceOf(plan, GRAVEL)}; price table ${priceSeconds.toFixed(2)} s;`,
      `build MIP ${stats === undefined ? 'none' : `${stats.seconds.toFixed(2)} s, ${stats.nodes} nodes, ${stats.status}${stats.stop === undefined ? '' : `/${stats.stop}`}${stats.approx ? ', approx' : ''}`},`
        + ` objective ${stats?.objective?.toFixed(3) ?? '-'}, bound ${stats?.bound?.toFixed(3) ?? '-'}, gap ${gap === undefined ? '-' : `${(gap * 100).toFixed(2)} %`}`
        + (ignored === undefined ? '' : `; by its measure ${buildObjective(plan, s, leastDug(ignored)).toFixed(1)} against ${buildObjective(ignored, s, leastDug(ignored)).toFixed(1)} ignoring build cost`),
    ].join(' '));
    return { run, priceSeconds };
  };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, at(GLASS_TUBE, 1, 1), ctx);   // warm the pack
  }, 300_000);

  it.each(LABELLED)('plans $label with its build cost', async (c) => {
    const s = c.owned ? await owning(c.settings) : c.settings;
    const { plan, seconds } = await timed(s);
    const ignored = (await timed({ ...s, buildHorizonHours: null })).plan;
    const { run } = await logPlan(c.label, s, plan, seconds, ignored);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(plan.cost?.horizonHours).toBe(DEFAULT_BUILD_HORIZON_HOURS);
    if (!c.owned) expect(plan.cost?.build).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    expect(plan.warnings.map((w) => w.code)).not.toContain('build-cost-approx');
    // No step adds a machine that cannot be built here (OQ5 a): each new machine has a build, or is a pricing gap (OQ5 b),
    // which the build-cost-unknown warning names.
    const unknown = plan.warnings.find((w) => w.code === 'build-cost-unknown')?.text ?? '';
    for (const step of plan.steps) {
      const m = pack.machines.get(step.machine.mteId);
      const r = pack.recipeById.get(step.recipeId);
      if (!(step.count > step.owned) || m === undefined || r === undefined || step.machine.mteId < 0) continue;
      const use = { recipe: r, tier: step.machine.tier };
      if (machineBuildCost(pack, run.model.prices, m, use) !== null) continue;
      expect(machineGap(pack, run.model.prices, m, use)?.kind, `${step.id} adds ${m.name}`).toBe('gap');
      if (!/ and \d+ more /.test(unknown)) expect(unknown, `${step.id} adds the pricing gap ${m.name}`).toContain(m.name);
    }
    // Sand and gravel: dug or made, never both, and never crafted by hand beside a forge hammer.
    for (const key of [SAND, GRAVEL]) expect(sourceOf(plan, key), key).not.toBe('both');
    if (plan.steps.some((st) => st.mapId === HAMMER_MAP)) {
      expect(plan.steps.filter((st) => st.handCraft && st.outputs.some((o) => o.key === SAND || o.key === GRAVEL)).map((st) => st.id)).toEqual([]);
    }
    // Project Red lines share no machine (fix wave 2 (d)); an AE2 pool runs at most nine recipes (OQ6, ruling P15), its
    // steps on one pool.
    if (s.logistics !== 'ae2') expect(poolsOf(plan)).toEqual([]);
    for (const step of plan.steps.filter((st) => st.pool !== undefined)) {
      expect(step.pool?.steps.length, step.id).toBeLessThanOrEqual(AE2_POOL_MAX_STEPS);
      for (const id of step.pool?.steps ?? []) expect(plan.steps.find((st) => st.id === id)?.pool, `${step.id} beside ${id}`).toEqual(step.pool);
    }
    // The build MIP on its own: decided by its limits (its nodes, its simplex iterations), never by time.
    const stats = run.sol.buildStats;
    expect(stats?.approx, 'build-cost-approx').toBe(false);
    expect(stats?.status === 'optimal' || (stats?.status === 'feasible' && stats.stop === 'limit'), `${stats?.status}/${stats?.stop}`).toBe(true);
    // Never worse by the build MIP's own measure than the plan that ignores build cost (controller ruling 187).
    expect(buildObjective(plan, s, leastDug(ignored))).toBeLessThanOrEqual(buildObjective(ignored, s, leastDug(ignored)) * (1 + 1e-6) + 1e-6);
  }, 300_000);

  it('keeps Electronic Circuit at LV and Polyethylene Bar within 5 steps of the plan that ignores build cost', async () => {
    // D1's bound on zero-raw chains (sand from free cobblestone), on real data: with nothing owned, and owning two of every
    // candidate machine, so only the step charge bounds a free chain. Electronic Circuit at LV directly, on Project Red
    // and on AE2 (ruling P15), and Polyethylene Bar at MV. A count above the bound is a finding for the controller, not a
    // bound to loosen: both step lists are logged.
    const lines: Array<[string, PlanSettings]> = [
      ['Electronic Circuit LV', at(ELECTRONIC_CIRCUIT, 1, 1)], ['Electronic Circuit LV on Project Red', at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' })],
      ['Electronic Circuit LV on AE2', at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'ae2' })], ['Polyethylene Bar MV', at(POLYETHYLENE_BAR, 2, 1)],
    ];
    const over: string[] = [];
    for (const [name, base] of lines) {
      for (const owned of [false, true]) {
        const s = owned ? await owning(base) : base;
        const ignoring: PlanSettings = { ...s, buildHorizonHours: null };
        const label = `${name}${owned ? ', two of every machine owned' : ''}`;
        const withCost = await timed(s);
        const without = await timed(ignoring);
        const [built, ignored] = [withCost.plan, without.plan];
        await logPlan(`D1 bound, ${label}`, s, built, withCost.seconds, ignored);
        await logPlan(`D1 bound, ${label}, ignoring build cost`, ignoring, ignored, without.seconds);
        console.log(`real-build-cost steps ${label}: ${built.steps.length} with build cost against ${ignored.steps.length} ignoring it; `
          + `sand ${sourceOf(built, SAND)}, gravel ${sourceOf(built, GRAVEL)} (ignoring: ${sourceOf(ignored, SAND)}, ${sourceOf(ignored, GRAVEL)}); `
          + `pools ${poolsOf(built).join(' | ') || 'none'}\n  with: ${built.steps.map((st) => st.recipeId).join(' ')}\n  ignoring: ${ignored.steps.map((st) => st.recipeId).join(' ')}`);
        expect(built.status, label).toBe('ok');
        expect(ignored.status, label).toBe('ok');
        if (built.steps.length > ignored.steps.length + STEP_HEADROOM) over.push(`${label}: ${built.steps.length} > ${ignored.steps.length} + ${STEP_HEADROOM}`);
      }
    }
    expect(over).toEqual([]);
  }, 600_000);

  it('trades build for running as the horizon grows', async () => {
    // An Electronic Circuit a minute at MV over 1 hour, 24 hours and 1 week. Only exact optima are monotone in the
    // horizon, so the comparisons are asserted only where no plan of the three fell back (build-cost-approx) and each
    // line's build MIP ended optimal; otherwise both are logged with the three stats (ruling P17: the plans' status is
    // always asserted). The plan that ignores build cost is logged against the 1-hour plan, not asserted (plan 09's
    // root-node step MIP is no exact optimum either).
    const runs: Array<{ hours: number; plan: Plan; run: BuildRun }> = [];
    for (const hours of [1, 24, 168]) {
      const s = at(ELECTRONIC_CIRCUIT, 2, 1, { buildHorizonHours: hours });
      const { plan, seconds } = await timed(s);
      const { run } = await logPlan(`horizon ${hours} h, Electronic Circuit MV`, s, plan, seconds);
      runs.push({ hours, plan, run });
    }
    const ignoring = at(ELECTRONIC_CIRCUIT, 2, 1, { buildHorizonHours: null });
    const { plan: ignored, seconds: ignoredSeconds } = await timed(ignoring);
    await logPlan('horizon ignored, Electronic Circuit MV', ignoring, ignored, ignoredSeconds);
    for (const { hours, plan } of runs) expect(plan.status, `${hours} h`).toBe('ok');
    console.log(`real-build-cost horizon: ignoring build cost runs ${ignored.cost?.runPerHour} raw/h (${ignored.steps.length} steps), the 1-hour plan ${runs[0]?.plan.cost?.runPerHour}`);
    const [hour, , week] = runs as [typeof runs[number], typeof runs[number], typeof runs[number]];
    const exact = runs.every(({ plan, run }) => !plan.warnings.some((w) => w.code === 'build-cost-approx') && run.sol.buildStats?.status === 'optimal');
    if (exact) {
      expect(hour.plan.cost?.build ?? 0).toBeLessThanOrEqual(week.plan.cost?.build ?? 0);
      expect(hour.plan.cost?.runPerHour ?? 0).toBeGreaterThanOrEqual(week.plan.cost?.runPerHour ?? 0);
    } else {
      console.log(`real-build-cost horizon: not compared (a build MIP ended at its limit or fell back): build 1 h ${hour.plan.cost?.build} against 1 week ${week.plan.cost?.build}, `
        + `run 1 h ${hour.plan.cost?.runPerHour} against 1 week ${week.plan.cost?.runPerHour} raw/h`);
    }
  }, 300_000);

  it('keeps the time guard', async () => {
    // A Microprocessor a minute at HV: under plan 09's bound, the build MIP decided by its limits; whether it fell back
    // to the relaxation (build-cost-approx) is logged, not asserted.
    const s = at(MICROPROCESSOR, 3, 1);
    const { plan, seconds } = await timed(s);
    await logPlan('time guard, Microprocessor HV', s, plan, seconds);
    console.log(`real-build-cost time guard: Microprocessor HV build-cost-approx ${plan.warnings.some((w) => w.code === 'build-cost-approx') ? 'yes' : 'no'}`);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
  }, 180_000);

  it('prices a part the same whatever else is asked, and never dearer than without the override when an override makes a good cheaper', async () => {
    // Fix wave 3 (D), the Electronic Circuit at MV, each table on a pricing context nothing priced yet (`priceTableSeconds`'
    // override). a5f5100 priced 16x Redstone Alloy Cable at 12.3789 asked alone and 6.4770 beside every cable rated up to
    // HV, and 1x Tin Cable at 0.6111 / 0.7111 / 0.6211 / 0.6111 with Rubber Wood at 1 / 0.1 / 0.01 / 0.
    const s = at(ELECTRONIC_CIRCUIT, 2, 1);
    const fresh = (more: PlanSettings): PlanSettings => ({ ...more, costOverrides: { ...more.costOverrides, 'gregtech:gt.metaitem.01@99999': ++measured } });
    const cableKey = (name: string): StuffKey => ([...pack.machines.values()].find((m) => m.name === name) as Machine).itemKey;
    const redstoneAlloy = cableKey('16x Redstone Alloy Cable');
    const cables = [...pack.machines.values()].filter((m) => m.kind === 'cable' && m.cable !== undefined && m.cable.voltage <= (V[3] as number)).map((m) => m.itemKey);
    const alone = (await itemPrices(pack, fresh(s), ctx, [redstoneAlloy])).cost(redstoneAlloy);
    const together = (await itemPrices(pack, fresh(s), ctx, cables)).cost(redstoneAlloy);
    const tin = cableKey('1x Tin Cable');
    const byWood: number[] = [];
    for (const wood of [1, 0.1, 0.01, 0]) {
      byWood.push((await itemPrices(pack, { ...s, costOverrides: { 'IC2:blockRubWood@0': wood } }, ctx, [tin])).cost(tin));
    }
    console.log(`real-build-cost prices: 16x Redstone Alloy Cable ${alone} alone, ${together} beside ${cables.length} cables; 1x Tin Cable at Rubber Wood 1 / 0.1 / 0.01 / 0: ${byWood.join(' / ')}`);
    expect(Number.isFinite(alone)).toBe(true);
    expect(together).toBeCloseTo(alone, 6);
    byWood.slice(1).forEach((price, i) => expect(price, `Rubber Wood step ${i + 1}`).toBeLessThanOrEqual((byWood[i] as number) * (1 + 1e-9)));
  }, 300_000);

  it('prices the candidate machines quickly', async () => {
    // The Electronic Circuit at MV: every candidate machine of its line on a memo key nothing priced yet (its log line's
    // price table).
    const s = at(ELECTRONIC_CIRCUIT, 2, 1);
    const { plan, seconds } = await timed(s);
    const { priceSeconds } = await logPlan('price table, Electronic Circuit MV', s, plan, seconds);
    console.log(`real-build-cost price table: Electronic Circuit MV, ${(await candidateMachines(s)).length} machines, ${priceSeconds.toFixed(2)} s`);
    expect(priceSeconds).toBeLessThan(2);
  }, 180_000);

  describe('the build MIP pick (fix wave 3 (F), ledger 248)', () => {
    /** New machine blocks: per step with a machine its machines beyond the owned ones, a sharing pool once (its first step). */
    const newBlocks = (plan: Plan): number => plan.steps
      .filter((st) => st.machine.mteId >= 0 && (st.pool === undefined || st.pool.steps[0] === st.id))
      .reduce((n, st) => n + Math.max(0, st.count - st.owned), 0);
    /**
     * The build-MIP objectives (`buildStats.objective`, nothing owned, empty context) on fix wave 3 (D)'s prices, measured
     * after Task 3 (Task 1 pinned 737bcd0's own, on a5f5100's prices).
     */
    const PINNED: ReadonlyArray<[string, PlanSettings, number]> = [
      ['Electronic Circuit MV', at(ELECTRONIC_CIRCUIT, 2, 1), 12.451591979],
      ['Electronic Circuit MV on Project Red', at(ELECTRONIC_CIRCUIT, 2, 1, { logistics: 'routed' }), 12.451594296],
      ['Good Electronic Circuit HV', at(GOOD_ELECTRONIC_CIRCUIT, 3, 1), 17.294139328],
      ['Polyethylene Bar MV', at(POLYETHYLENE_BAR, 2, 1), 8.410411920],
      ['Steel Ingot MV x10', at(STEEL_INGOT, 2, 10), 11.924229250],
      ['Electronic Circuit LV', at(ELECTRONIC_CIRCUIT, 1, 1), 17.240499791],
      ['Electronic Circuit LV on Project Red', at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'routed' }), 17.259551046],
      ['Electronic Circuit LV on AE2', at(ELECTRONIC_CIRCUIT, 1, 1, { logistics: 'ae2' }), 15.856850743],
      ['Advanced Circuit HV 1/min', at(ADVANCED_CIRCUIT, 3, 1, { routeDerived: false }), 22.294776901],
      ['Advanced Circuit HV 1/h', at(ADVANCED_CIRCUIT, 3, 1, { routeDerived: false, per: 'hour' }), 33.562427797],
      ['Advanced Circuit HV 1/min, supporting lines', at(ADVANCED_CIRCUIT, 3, 1), 27.699827544],
    ];
    const statsOf = (run: BuildRun): NonNullable<Solution['buildStats']> => run.sol.buildStats as NonNullable<Solution['buildStats']>;
    const logPick = (name: string, stats: NonNullable<Solution['buildStats']>): void => {
      console.log(`real-build-cost pick ${name}: ${stats.objective?.toFixed(9)} ${stats.status}/${stats.stop ?? '-'}, ${stats.nodes} nodes`
        + `${stats.retried ? ', retried at 1e-9' : ''}${stats.earlier ? ', an earlier incumbent' : ''}, ${stats.seconds.toFixed(2)} s`);
    };

    it.each(PINNED)('is no worse by the build MIP than its measured pin on %s', async (name, s, pinned) => {
      const stats = statsOf(await buildRun(s));
      logPick(name, stats);
      expect(stats.approx).toBe(false);
      expect(stats.objective as number).toBeLessThanOrEqual(pinned * (1 + 1e-6));
    }, 300_000);

    it('plans 2 Good Electronic Circuits a minute at HV on AE2 in at most 28 new machines, at most 16.371 by the build MIP', async () => {
      const s = at(GOOD_ELECTRONIC_CIRCUIT, 3, 2, { logistics: 'ae2' });
      const stats = statsOf(await buildRun(s));
      logPick('Good Electronic Circuit HV x2 on AE2', stats);
      expect(stats.retried).toBe(true);   // its root LP relaxation does not solve at 1e-10
      expect(stats.status === 'optimal' || stats.stop === 'limit', `${stats.status}/${stats.stop}`).toBe(true);
      expect(stats.objective as number).toBeLessThanOrEqual(16.371 + 1e-6);
      const { plan } = await timed(s);
      expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
      expect(newBlocks(plan)).toBeLessThanOrEqual(28);
    }, 300_000);

    it('proves its plan of 2 Good Electronic Circuits a minute at HV optimal within its iteration cap', async () => {
      const stats = statsOf(await buildRun(at(GOOD_ELECTRONIC_CIRCUIT, 3, 2)));
      logPick('Good Electronic Circuit HV x2', stats);
      expect(stats.status).toBe('optimal');
      expect(stats.objective as number).toBeLessThanOrEqual(17.755272959 * (1 + 1e-6));
    }, 300_000);
  });

  describe("plan 09's checks that build cost legitimately changes, with build cost counted (Task 8 Step 4)", () => {
    // Plan 09's real-data tests check these settings with build cost ignored now (`buildHorizonHours: null`), where its
    // expectations hold; here the same settings with build cost counted, each with its own assertions.

    it('makes aluminium at HV in Electric Blast Furnaces, no worse by its measure than ignoring build cost', async () => {
      // real-acceptance's aluminium case: ignoring build cost one EBF step from mined dust; with it the line may take the
      // nitrogen recipe that needs fewer furnaces, with the steps that make its nitrogen.
      const s = at(ALUMINIUM_INGOT, 3, 10);
      const { plan, seconds } = await timed(s);
      const without = await timed({ ...s, buildHorizonHours: null });
      const ignored = without.plan;
      await logPlan('aluminium HV x10', s, plan, seconds, ignored);
      await logPlan('aluminium HV x10, ignoring build cost', { ...s, buildHorizonHours: null }, ignored, without.seconds);
      const ebf = plan.steps.filter((st) => st.machine.name === 'Electric Blast Furnace');
      console.log(`real-build-cost aluminium HV: ${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps (${ebf.map((st) => `${st.count}× EBF on ${st.recipeId}`).join(', ')}), `
        + `raw ${plan.rawInputs.map((r) => r.key).join(' ')}; ignoring build cost ${ignored.steps.length} steps`);
      expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
      expect(seconds).toBeLessThan(PLAN_SECONDS);
      expect(plan.steps.find((st) => st.mainOutput === ALUMINIUM_INGOT)?.machine.name).toBe('Electric Blast Furnace');
      expect(plan.rawInputs.map((r) => r.key)).toContain('gregtech:gt.metaitem.01@2019');   // the mined aluminium dust
      expect(buildObjective(plan, s, leastDug(ignored))).toBeLessThanOrEqual(buildObjective(ignored, s, leastDug(ignored)) * (1 + 1e-6));
    }, 300_000);

    it('plans 2 Good Electronic Circuits a minute at HV in fewer steps than ignoring build cost, from ordinary materials', async () => {
      // real-acceptance's Good Electronic Circuit case: ignoring build cost the line etches its Good Circuit Board in a
      // chemical reactor with Iron III Chloride; with it counted it crafts the board from gold wire on an Auto Workbench,
      // and needs about half the steps, no worse by the build MIP's measure.
      const s = at(GOOD_ELECTRONIC_CIRCUIT, 3, 2);
      const { plan, seconds } = await timed(s);
      const without = await timed({ ...s, buildHorizonHours: null });
      const ignored = without.plan;
      await logPlan('Good Electronic Circuit HV x2', s, plan, seconds, ignored);
      await logPlan('Good Electronic Circuit HV x2, ignoring build cost', { ...s, buildHorizonHours: null }, ignored, without.seconds);
      const board = plan.steps.find((st) => st.mainOutput === 'gregtech:gt.metaitem.03@32101');
      console.log(`real-build-cost Good Electronic Circuit HV x2: ${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps (ignoring build cost ${ignored.steps.length}), `
        + `its Good Circuit Board on ${board?.machine.name ?? 'none'}, build ${plan.cost?.build} (ignoring ${ignored.cost?.build})`);
      expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
      expect(seconds).toBeLessThan(PLAN_SECONDS);
      expect(plan.steps.length).toBeLessThan(ignored.steps.length);
      expect(plan.steps.find((st) => st.mainOutput === GOOD_ELECTRONIC_CIRCUIT)?.mapId).toBe('gt.recipe.circuitassembler');
      expect(plan.rawInputs.filter((r) => !r.available)).toEqual([]);
      expect(plan.warnings.map((w) => w.code)).not.toContain('build-cost-approx');
      expect(buildObjective(plan, s, leastDug(ignored))).toBeLessThanOrEqual(buildObjective(ignored, s, leastDug(ignored)) * (1 + 1e-6));
    }, 300_000);

    it('plans an Advanced Circuit at HV on "Least raw material" with build cost counted, at least the least raw material', async () => {
      // real-acceptance's and real-user-project's 0 % cases: ignoring build cost they plan at the least raw material; with it
      // the line may use more raw material to build fewer machines, never less than the least.
      for (const [name, s] of [['default settings', at(ADVANCED_CIRCUIT, 3, 1, { stepCharge: 0 })],
        ["the user's project", { ...normalizeSettings(USER_EC_STORED), automateCrafting: false, target: ADVANCED_CIRCUIT, tier: 3, stepCharge: 0 }]] as const) {
        const { plan, seconds } = await timed(s);
        await logPlan(`Advanced Circuit HV at 0 %, ${name}`, s, plan, seconds);
        const raw = plan.rawCost as NonNullable<Plan['rawCost']>;
        console.log(`real-build-cost Advanced Circuit HV at 0 %, ${name}: ${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps, raw ${raw.perSecond} against the least ${raw.leastPerSecond}, build ${plan.cost?.build}`);
        expect(plan.status, `${name}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
        expect(seconds, name).toBeLessThan(HV_SLOW_PLAN_SECONDS);
        expect(raw.perSecond, name).toBeGreaterThanOrEqual(raw.leastPerSecond * (1 - 1e-6));
        expect(plan.warnings.map((w) => w.code), name).not.toContain('build-cost-approx');
      }
    }, 300_000);

    it("reuses the machines the user's project lists, and none with \"Reuse machines we have\" off", async () => {
      // real-user-project's reuse case: with build cost counted, owned machines are free, so owning one of the circuit
      // assembler's and of the red alloy wiremill's types may change the line; switched on they serve its steps, off none.
      const settings: PlanSettings = { ...normalizeSettings(USER_EC_STORED), automateCrafting: false };
      const first = await timed(settings);
      const plain = first.plan;
      await logPlan("user project", settings, plain, first.seconds);
      const listed = plain.steps.filter((st) => st.recipeId === 'c0106c4cb6b4b041' || st.mainOutput === 'gregtech:gt.blockmachines@2000');
      expect(listed).toHaveLength(2);
      const ownedManual = listed.map((st) => ({ mteId: st.machine.mteId, count: 1 }));
      const on = await timed({ ...settings, ownedManual });
      const off = await timed({ ...settings, ownedManual, reuseOwned: false });
      await logPlan('user project, its two machines owned', { ...settings, ownedManual }, on.plan, on.seconds);
      await logPlan('user project, its two machines owned, "Reuse machines we have" off', { ...settings, ownedManual, reuseOwned: false }, off.plan, off.seconds);
      console.log(`real-build-cost user project reuse: on ${on.plan.steps.length} steps, ${on.seconds.toFixed(2)} s, build ${on.plan.cost?.build}; `
        + `off ${off.plan.steps.length} steps, ${off.seconds.toFixed(2)} s, build ${off.plan.cost?.build}`);
      for (const { plan, seconds } of [on, off]) {
        expect(plan.status).toBe('ok');
        expect(seconds).toBeLessThan(PLAN_SECONDS);
      }
      const reusing = on.plan.steps.filter((st) => st.owned > 0);
      expect(reusing.reduce((n, st) => n + st.owned, 0)).toBeGreaterThan(0);
      for (const st of reusing) expect(st.reused?.units?.length, st.id).toBe(st.owned);
      expect(off.plan.steps.filter((st) => st.owned !== 0 || st.reused !== undefined).map((st) => st.id)).toEqual([]);
      expect(off.plan.cost?.build ?? 0).toBeGreaterThanOrEqual(on.plan.cost?.build ?? 0);
    }, 300_000);
  });
});
