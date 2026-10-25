// Real-data acceptance of add-on 17's planning modes, farms and surplus across projects (plan 17 Task 10, run as the
// add-on 12 x 17 integration's A5; design spec §3.3, §3.11; architecture §11.45): the rubber tree farm as the farm
// research reads it, the user's Electronic Circuit in the three modes, best multi-output on plan 12's calibration lines,
// one rubber tree farm covering resin, carbon and wood pulp, a farm-fed least-raw line, the Compare card's modes, another
// project's surplus and a crop farm on the active export; then the reference flow's A1 under the raw cap (add-on 17
// ruling S13 as the integration's ruling R11 reads it; the user's ruling that the raw cap wins), Polyethylene Bar MV
// with farms on (the controller's poly ruling at a step charge above 0), and the reference R0's farm price and published
// by-products (ruling S14, R12). The user's settings are read at run time from the private docs/local (ec-state.json, the
// reference flow's reference.json), never committed or copied: a case without its file is skipped with a logged note. It
// runs only with GTNH_LOCAL=1 and logs counts, keys, figures and timings; nothing game-derived is read or written
// otherwise. The export is loaded once.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { openDb } from '../../../src/server/db/db.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { TREE_FARM_MAP } from '../../../src/server/pack/recipes.ts';
import { buildCostCounts } from '../../../src/server/planner/basis.ts';
import { COMPARE_TIME_LIMIT_SECONDS, compareModes, compareSummary, modeSettings, rawKeys } from '../../../src/server/planner/compare.ts';
import { TGS_MTE_ID, TGS_OP_TICKS, tgsOp } from '../../../src/server/planner/farms/tgs.ts';
import { objectiveOf, type Need, type Offer } from '../../../src/server/planner/objective.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import type { Solution } from '../../../src/server/planner/solve.ts';
import { SurplusBoard, crossRead, summaryOf } from '../../../src/server/projects/surplus.ts';
import { tierName } from '../../../src/shared/gt/tiers.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import { defaultFarmSettings, type FarmSettings, type RunningFarm } from '../../../src/shared/types/farm.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import {
  DEFAULT_BUILD_HORIZON_HOURS, DEFAULT_RAW_CAP, DEFAULT_STEP_CHARGE, PLAN_OBJECTIVES, type Plan, type PlanContext, type PlanObjective,
  type PlanSettings,
} from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import { buildObjective } from '../../helpers/build-objective.ts';
import { EC_STATE, REFERENCE, localDocPath, storedSettings } from '../../helpers/local-docs.ts';
import { checkPlanInvariants } from '../../helpers/plan-invariants.ts';
import { CASES, POLYETHYLENE_BAR, STEEL_INGOT, at, buildRun, owning, type Case } from '../../helpers/real-build-cases.ts';
import {
  COPPER_INGOT, REFERENCE_BASE, REFERENCE_BLOCKS, REFERENCE_RAW_KINDS, REF_RAW, ROD_EXTRUDER, ROD_LATHE, RUBBER_WOOD, machineBlocks,
  rawPerMinute,
} from '../../helpers/real-reference.ts';

const RUBBER_SAPLING = 'IC2:blockRubSapling@0';
const STICKY_RESIN = 'IC2:itemHarz@0';
const RAW_RUBBER_DUST = 'gregtech:gt.metaitem.01@2896';
const CARBON_DUST = 'gregtech:gt.metaitem.01@2010';
const WOOD_PULP = 'gregtech:gt.metaitem.01@2809';
const REFINED_GLUE = 'fluid:refinedglue';
const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
/** The research's rubber example (farms.md §5.8): a Steel Saw for the logs and a Steel Knife for the resin. */
const SAW = 'gregtech:gt.metatool.01@10';
const KNIFE = 'gregtech:gt.metatool.01@34';
/** The operations a Steel saw or knife lasts (farms.md §1.5: Steel's durability 512, × 1 for both tools). */
const STEEL_TOOL_USES = 512;
const CENTRIFUGE_MAP = 'gt.recipe.centrifuge';
/** The export's Tree Growth Simulator rows (farms.md §1.6: 127 + 110 + 9 + 3 + 2). */
const TREE_FARM_ROWS = 251;
/** The materials of the coal-type goods a rubber tree farm's centrifuged wood stands in for (plan 17 Task 10). */
const COAL_MATERIALS: ReadonlySet<string> = new Set(['Coal', 'Charcoal', 'Lignite', 'Carbon', 'Wood']);
const STICKY_CANE = 'cropsnh:stickyCane';
const RUBBER_BONSAI = 'cropsnh:bonsaiRubber';
/** Add-on 17's farms off (its ruling S15's settings): no farm kind offered. */
const FARMS_OFF: FarmSettings = { ...defaultFarmSettings(), kinds: [] };
/** The group's crop manager: 32 Rubber Wood a minute (the user's answer of 2026-10-20; add-on 17 rulings S13, S14, S20). */
const GROUP_CROP_MANAGER: RunningFarm = { name: "the group's crop manager", outputs: [{ key: RUBBER_WOOD, perMinute: 32 }] };
/** The "Some machines" preset of the machine weight, which A1 logs beside its own "Fewest machines" (ruling S13). */
const SOME_MACHINES = 0.02;
/**
 * The bound of every plan timed here (plan 17 Task 10's three modes, calibration lines and farm-fed least-raw line), not
 * plan 09's flat 5 s: fix wave 3's OQ1 (A)/(D) rule, the integration's ruling R13 — the next whole second above 1.25 x
 * the slowest quiet-host median of three whole-file runs. The slowest, Electronic Circuit MV on Project Red with two of
 * every machine owned in best multi-output (two build MIPs, each ended at its root), took 42.80 s, the median of three on
 * 2026-10-25 (each run started at a 1-minute load under 4): 1.25 × 42.80 = 53.50.
 */
const OBJECTIVE_PLAN_SECONDS = 54;
/** Rates up to this, a second, count as none (the solver's threshold). */
const TINY = 1e-9;
const SECONDS_PER_MINUTE = 60;

const local = process.env.GTNH_LOCAL === '1';
const ecPath = local ? localDocPath(EC_STATE) : undefined;
const referencePath = local ? localDocPath(REFERENCE, process.env.GTNH_REFERENCE) : undefined;
if (local && ecPath === undefined) console.log(`real-objectives: the user's Electronic Circuit cases skipped, no ${EC_STATE}`);
if (local && referencePath === undefined) console.log(`real-objectives: the reference flow's cases skipped, no ${REFERENCE}`);
/** The user's Electronic Circuit as it is stored, as the planner reads it (`normalizeSettings`: crafting automated). */
const ec: PlanSettings | undefined = ecPath === undefined ? undefined : normalizeSettings(storedSettings(ecPath));
/** `ec` with the group's Tree Growth Simulator (plan 17 Task 10: "the group runs a Tree Growth Simulator"). */
const owned: PlanSettings | undefined = ec === undefined ? undefined : { ...ec, ownedManual: [{ mteId: TGS_MTE_ID, count: 1 }] };
/** The reference flow's settings as the planner reads them. */
const stored: PlanSettings | undefined = referencePath === undefined ? undefined : normalizeSettings(storedSettings(referencePath));

/**
 * Plan 12's calibration lines (`CASES`) and, with its file, the user's Electronic Circuit with the group's Tree Growth
 * Simulator (plan 17 Task 10); `owned` marks a line planned owning two of every candidate machine (`owning`).
 */
const CALIBRATION: Case[] = [
  ...CASES, ...(owned === undefined ? [] : [{ name: "the user's Electronic Circuit, a Tree Growth Simulator owned", settings: owned, owned: false }]),
];
const LABELLED = CALIBRATION.map((c) => ({ ...c, label: `${c.name}${c.owned ? ', two of every machine owned' : ''}` }));

/** `settings`, read from a private file: a case that reads them is skipped (`skipIf`) where the file is missing. */
function given(settings: PlanSettings | undefined): PlanSettings {
  if (settings === undefined) throw new Error('real-objectives: a case ran without its private settings file');
  return settings;
}

/** A project of the group planned with `settings`, as a published summary names it (an invented id and date). */
function project(id: string, name: string, settings: PlanSettings, createdAt: string): Project {
  return { id, name, createdAt, createdBy: 'real-objectives', rev: 1, settings, world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
}

/** The farm steps of `plan`: how many machines, and their words. */
const farmSteps = (plan: Plan): string[] => plan.steps.filter((s) => s.farm !== undefined).map((s) => `${s.count}× ${s.farm?.text ?? ''}`);
/** Its Tree Growth Simulator steps on rubber saplings. */
const rubberTreeFarms = (plan: Plan): string[] =>
  plan.steps.filter((s) => s.farm?.kind === 'tgs' && s.farm.sapling === RUBBER_SAPLING).map((s) => s.id);
/** Its distinct raw sources, as the Compare card counts them (`Plan.rawSources`, else the raw goods it buys). */
const sourcesOf = (plan: Plan): number => compareSummary(plan).rawSources;
/** A build MIP's end: seconds and nodes (best multi-output: both its MIPs'), status and stop, and its pick marks. */
const statsText = (st: Solution['buildStats']): string => st === undefined ? 'no build MIP'
  : `${st.seconds.toFixed(2)} s, ${st.nodes} nodes, ${st.status}${st.stop === undefined ? '' : `/${st.stop}`}${st.approx ? ', approx' : ''}`
    + `${st.bare === undefined ? '' : `, bare ${st.bare}`}, objective ${st.objective ?? '-'}, bound ${st.bound ?? '-'}`;

/**
 * One log line of a plan (plan 17 Task 10 Step 2): its mode, target, rate, tier and logistics; status, seconds, steps,
 * raw material to run it an hour and to build it, its raw sources; its farm steps, its steps on the centrifuge and what
 * they take, and the raw goods it buys.
 */
function logPlan(label: string, s: PlanSettings, plan: Plan, seconds: number): void {
  const centrifuges = plan.steps.filter((st) => st.mapId === CENTRIFUGE_MAP).map((st) => `${st.recipeId} takes ${st.inputs.map((p) => p.key).join(' + ')}`);
  console.log(`real-objectives ${label}: ${objectiveOf(s)}, ${s.target} ${s.amount}/${s.per} at ${tierName(s.tier ?? 1)} on ${s.logistics}; `
    + `${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps, run ${plan.cost?.runPerHour ?? '-'} raw/h, build ${plan.cost?.build ?? '-'}, `
    + `raw sources ${plan.rawSources ?? '-'}; farms ${farmSteps(plan).join(' | ') || 'none'}; centrifuges ${centrifuges.join(' | ') || 'none'}; `
    + `buys ${[...rawKeys(plan)].sort().join(' ') || 'nothing'}`);
}

describe.skipIf(!local)('planning modes, farms and surplus on the real export (add-on 17 Task 10)', () => {
  let pack: Pack;
  const ctx: PlanContext = emptyContext();

  const timed = async (s: PlanSettings, opts?: { offers?: readonly Offer[]; needs?: readonly Need[] }): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, ctx, opts);
    return { plan, seconds: (performance.now() - started) / 1000 };
  };
  /** A plan held to OBJECTIVE_PLAN_SECONDS, its time logged on a line of its own for the bound's measure (ruling R13). */
  const timedPlan = async (label: string, s: PlanSettings): Promise<{ plan: Plan; seconds: number }> => {
    const run = await timed(s);
    logPlan(label, s, run.plan, run.seconds);
    console.log(`real-objectives timed plan, ${label}: ${run.seconds.toFixed(2)} s`);
    return run;
  };

  /** Which of the rubber goods `plan` buys: Carbon Dust, Wood Pulp, Sticky Resin, `logWood` items and coal-type goods. */
  const rubberGoods = (plan: Plan): StuffKey[] => {
    const logs = new Set<StuffKey>(pack.oreDict.get('logWood') ?? []);
    return [...rawKeys(plan)].filter((key) => key === CARBON_DUST || key === WOOD_PULP || key === STICKY_RESIN || logs.has(key)
      || COAL_MATERIALS.has(pack.items.get(key)?.gt?.material ?? '')).sort();
  };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, at(GLASS_TUBE, 2, 1), ctx);   // warm the pack
  }, 300_000);

  it('runs the rubber tree farm as the research says', () => {
    const rows = pack.recipes.filter((r) => r.maps.includes(TREE_FARM_MAP));
    console.log(`real-objectives tree farm rows: ${rows.length}, ${rows.filter((r) => r.meta.tgsModes !== undefined).length} with their modes`);
    expect(rows).toHaveLength(TREE_FARM_ROWS);
    expect(rows.filter((r) => r.meta.tgsModes === undefined).map((r) => r.id)).toEqual([]);
    const rubber = rows.find((r) => r.meta.specialItem === RUBBER_SAPLING);
    expect(rubber?.meta.tgsModes).toEqual(['log', 'sapling', 'leaves', 'fruit']);
    // farms.md §5.8: a Steel saw and knife at LV make 25 Rubber Wood and 5 Sticky Resin an operation at 30 EU/t, at MV 45
    // and 9 at 120 EU/t, each tool worn one use in 512.
    const bus = { log: true, sapling: false, leaves: false, fruit: true };
    const wear = [{ key: SAW, perOp: 1 / STEEL_TOOL_USES }, { key: KNIFE, perOp: 1 / STEEL_TOOL_USES }];
    expect(tgsOp(rubber!, 1, bus, 'Steel')).toEqual({
      outputs: [{ key: RUBBER_WOOD, amount: 25, chance: 1 }, { key: STICKY_RESIN, amount: 5, chance: 1 }], wear, euPerTick: 30, ticks: TGS_OP_TICKS,
    });
    expect(tgsOp(rubber!, 2, bus, 'Steel')).toEqual({
      outputs: [{ key: RUBBER_WOOD, amount: 45, chance: 1 }, { key: STICKY_RESIN, amount: 9, chance: 1 }], wear, euPerTick: 120, ticks: TGS_OP_TICKS,
    });
  });

  it.skipIf(owned === undefined)("plans the user's Electronic Circuit in the three modes", async () => {
    // Each mode's plan checked by the rules of its objective (ruling R13: a least-raw plan is plan 09's, so build cost is
    // not counted there) on the line's own pack, where its farm recipes are (`farmPack`, the integration's F7a).
    const base = given(owned);
    const plans = new Map<PlanObjective, Plan>();
    const slow: string[] = [];
    const errors: string[] = [];
    for (const o of PLAN_OBJECTIVES) {
      const s = modeSettings(base, o);
      const { plan, seconds } = await timedPlan(`the user's Electronic Circuit, ${o}`, s);
      plans.set(o, plan);
      if (plan.status !== 'ok') console.log(`real-objectives the user's Electronic Circuit, ${o}: ${plan.status}: ${JSON.stringify(plan.warnings)}`);
      if (!(seconds < OBJECTIVE_PLAN_SECONDS)) slow.push(`${o}: ${seconds.toFixed(2)} s`);
      const farmPack = (await linePricing(pack, s, ctx))?.pack;
      for (const v of checkPlanInvariants(pack, s, plan, { buildCost: buildCostCounts(s), farmPack })) {
        if (v.severity === 'error') errors.push(`${o}: ${v.kind}: ${v.message}`);
      }
    }
    // Fewer raw sources in best multi-output than in cheapest is guaranteed only where both build MIPs ended optimal on a
    // whole solution (plan 17 Task 10); else logged with both MIPs' ends.
    const cheapest = plans.get('cheapest') as Plan;
    const multi = plans.get('multi-output') as Plan;
    const cheapRun = await buildRun(pack, ctx, modeSettings(base, 'cheapest'));
    const multiRun = await buildRun(pack, ctx, modeSettings(base, 'multi-output'));
    const exact = [cheapRun, multiRun].every((r) => r.sol.buildStats?.status === 'optimal' && !r.sol.buildStats.approx);
    console.log(`real-objectives the user's Electronic Circuit: raw sources ${sourcesOf(multi)} in best multi-output against ${sourcesOf(cheapest)} in cheapest `
      + `(${exact ? 'asserted' : 'logged: not both build MIPs optimal'}); cheapest's build MIP ${statsText(cheapRun.sol.buildStats)}; `
      + `best multi-output's (both MIPs) ${statsText(multiRun.sol.buildStats)}; best multi-output's rubber tree farms ${rubberTreeFarms(multi).join(' ') || 'none'}, `
      + `${rawKeys(multi).has(STICKY_RESIN) ? 'buys' : 'buys no'} Sticky Resin; the checker's errors: ${errors.join('; ') || 'none'}`);
    expect(PLAN_OBJECTIVES.map((o) => `${o} ${plans.get(o)?.status}`)).toEqual(PLAN_OBJECTIVES.map((o) => `${o} ok`));
    expect(slow, `over ${OBJECTIVE_PLAN_SECONDS} s`).toEqual([]);
    expect(errors).toEqual([]);
    expect(rubberTreeFarms(multi), 'a Tree Growth Simulator on rubber saplings').not.toEqual([]);
    expect(rawKeys(multi).has(STICKY_RESIN), 'buys Sticky Resin').toBe(false);
    if (exact) expect(sourcesOf(multi)).toBeLessThanOrEqual(sourcesOf(cheapest));
  }, 600_000);

  it.each(LABELLED)("weighs raw sources on $label within the build MIP's limits", async (c) => {
    // Plan 17 Task 10: best multi-output on each calibration line, its raw sources against the same line in cheapest, both
    // build MIPs' ends logged (the cheapest pre-solve's alone, from the line in cheapest). A plan from the fallback or a
    // build MIP its node or iteration limit stopped is no failure here: it is logged for the controller (BUILD_MIP_MAX_NODES
    // was set without the source binaries, so a new limit is plan 12's decision, not this file's).
    const s = c.owned ? await owning(pack, ctx, c.settings) : c.settings;
    const multiSettings = modeSettings(s, 'multi-output');
    const { plan, seconds } = await timedPlan(`${c.label}, best multi-output`, multiSettings);
    const cheapest = await timed(modeSettings(s, 'cheapest'));
    logPlan(`${c.label}, cheapest`, modeSettings(s, 'cheapest'), cheapest.plan, cheapest.seconds);
    const multiStats = (await buildRun(pack, ctx, multiSettings)).sol.buildStats;
    const cheapStats = (await buildRun(pack, ctx, modeSettings(s, 'cheapest'))).sol.buildStats;
    console.log(`real-objectives ${c.label}: raw sources ${sourcesOf(plan)} in best multi-output against ${sourcesOf(cheapest.plan)} in cheapest; `
      + `best multi-output's build MIPs ${statsText(multiStats)}; the cheapest pre-solve's ${statsText(cheapStats)}`);
    if (multiStats?.approx === true || multiStats?.stop !== undefined) {
      console.log(`real-objectives FOR THE CONTROLLER (plan 17 Task 10 Step 3), ${c.label}: best multi-output's build MIP `
        + `${multiStats.approx ? 'fell back (approx)' : `stopped at its ${multiStats.stop === 'time' ? 'time' : 'node or iteration'} limit`}: ${statsText(multiStats)}`);
    }
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(OBJECTIVE_PLAN_SECONDS);
  }, 600_000);

  it.skipIf(owned === undefined)('covers resin, carbon and wood pulp from one rubber tree farm', async () => {
    // The user's example ("1 rubber tree farm with the crop manager could be centrifuged into rubber dust, wood pulp and
    // carbon which takes care of half of the mats") at a rate where machines matter less, 1 a minute: one rubber tree
    // farm, its wood centrifuged into Carbon Dust and Wood Pulp, and none of the rubber goods bought; fewer raw sources
    // than cheapest with farms off. Logged side by side, farms on, at 1 a minute and 1 an hour: each mode's rubber goods,
    // farm and centrifuge steps, raw sources and cost (with the Tree Growth Simulator owned and free to run, cheapest and
    // least raw use it too: the log shows where best multi-output differs).
    const base = given(owned);
    const perMinute: PlanSettings = { ...base, amount: 1, per: 'min' };
    const s = modeSettings(perMinute, 'multi-output');
    const { plan, seconds } = await timed(s);
    logPlan('one rubber tree farm, best multi-output at 1 a minute', s, plan, seconds);
    const farmless = modeSettings({ ...perMinute, farms: FARMS_OFF }, 'cheapest');
    const off = await timed(farmless);
    logPlan('one rubber tree farm, cheapest at 1 a minute with farms off', farmless, off.plan, off.seconds);
    for (const per of ['min', 'hour'] as const) {
      for (const o of PLAN_OBJECTIVES) {
        const so = modeSettings({ ...base, amount: 1, per }, o);
        const run = per === 'min' && o === 'multi-output' ? { plan, seconds } : await timed(so);
        if (run.plan !== plan) logPlan(`one rubber tree farm, ${o} at 1 a${per === 'min' ? ' minute' : 'n hour'}`, so, run.plan, run.seconds);
        console.log(`real-objectives one rubber tree farm, ${o} at 1 a${per === 'min' ? ' minute' : 'n hour'}: buys of the rubber goods `
          + `${rubberGoods(run.plan).join(' ') || 'none'}; raw sources ${sourcesOf(run.plan)}; cost ${JSON.stringify(run.plan.cost)}`);
      }
    }
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(rubberTreeFarms(plan), 'a Tree Growth Simulator on rubber saplings').not.toEqual([]);
    const centrifuged = plan.steps.filter((st) => st.mapId === CENTRIFUGE_MAP && st.inputs.some((p) => p.key.startsWith('IC2:blockRubWood'))
      && [CARBON_DUST, WOOD_PULP].every((key) => st.outputs.some((p) => p.key === key)));
    expect(centrifuged.map((st) => st.id), 'Rubber Wood centrifuged into Carbon Dust and Wood Pulp').not.toEqual([]);
    expect(rubberGoods(plan)).toEqual([]);
    expect(sourcesOf(plan)).toBeLessThan(sourcesOf(off.plan));
  }, 600_000);

  it.skipIf(owned === undefined)('plans a farm-fed least-raw line in time', async () => {
    // Raw Rubber Dust from the group's Tree Growth Simulator: a line whose least raw material is the tools it wears, which
    // plan 09's charge MIP still plans (add-on 17 Task 5 keeps its step charge for it).
    const s = modeSettings({ ...given(owned), target: RAW_RUBBER_DUST, amount: 1, per: 'min' }, 'least-raw');
    const { plan, seconds } = await timedPlan('Raw Rubber Dust 1 a minute from the owned tree farm, least raw', s);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(OBJECTIVE_PLAN_SECONDS);
    expect(plan.steps.filter((st) => st.farm?.kind === 'tgs').map((st) => st.id), 'a Tree Growth Simulator step').not.toEqual([]);
  }, 300_000);

  it.skipIf(owned === undefined)('compares the three modes within the time limit', async () => {
    const base = given(owned);
    const started = performance.now();
    const modes = await compareModes((o) => planLine(pack, modeSettings(base, o), ctx), {
      current: objectiveOf(base), limitSeconds: COMPARE_TIME_LIMIT_SECONDS, onLate: () => {},
    });
    const seconds = (performance.now() - started) / 1000;
    for (const m of modes) {
      console.log(`real-objectives compare, ${m.objective}: ${m.status}${m.error === undefined ? '' : ` (${m.error})`}; ${JSON.stringify(m.summary ?? null)}; `
        + `avoids ${m.avoids?.join(' ') || 'nothing'}; adds ${m.adds?.join(' ') || 'nothing'}`);
    }
    console.log(`real-objectives compare: ${seconds.toFixed(2)} s in all, against its limit of ${COMPARE_TIME_LIMIT_SECONDS} s`);
    expect(modes.map((m) => `${m.objective} ${m.status}`)).toEqual(PLAN_OBJECTIVES.map((o) => `${o} ok`));
  }, 300_000);

  it.skipIf(ec === undefined)("takes another project's surplus on real data", async () => {
    // Raw Rubber Dust from centrifuged resin leaves Refined Glue over: published as one project's summary on a board over
    // a temporary database, the user's circuit reads it as an offer and takes it "from" that project.
    const circuit = given(ec);
    const rubber: PlanSettings = { ...circuit, target: RAW_RUBBER_DUST, amount: 60, per: 'hour', objective: 'cheapest' };
    const made = await timed(rubber);
    logPlan("Raw Rubber Dust 60 an hour, another project's line", rubber, made.plan, made.seconds);
    expect(made.plan.status, JSON.stringify(made.plan.warnings)).toBe('ok');
    const producer = project('rubber-dust', 'Raw Rubber Dust', rubber, '2026-10-01T00:00:00.000Z');
    const reader = project('circuit', 'Electronic Circuit', circuit, '2026-10-02T00:00:00.000Z');
    const dir = mkdtempSync(join(tmpdir(), 'real-objectives-'));
    const db = openDb(join(dir, 'planner.sqlite'));
    try {
      const board = new SurplusBoard(db);
      const summary = summaryOf(producer, made.plan, new Date().toISOString());
      console.log(`real-objectives Raw Rubber Dust's summary: surplus ${(summary?.surplus ?? []).map((e) => `${e.key} ${e.perSecond * SECONDS_PER_MINUTE}/min`).join(', ') || 'none'}`);
      expect(summary).not.toBeNull();
      board.publish(summary!);
      const goods = new Set((await linePricing(pack, circuit, ctx))?.graph.goods.keys() ?? []);
      const read = crossRead(board, reader, circuit, new Set([producer.id, reader.id]), goods, made.plan.exportId);
      console.log(`real-objectives the circuit's read: ${read.offers.map((o) => `${o.key} ${o.perSecond * SECONDS_PER_MINUTE}/min from ${o.name}`).join(', ') || 'no offer'}`);
      expect(read.offers.filter((o) => o.key === REFINED_GLUE && o.from === producer.id), 'an offer of Refined Glue').not.toEqual([]);
      const taking = await timed(circuit, { offers: read.offers, needs: read.needs });
      logPlan('the user\'s Electronic Circuit on that offer', circuit, taking.plan, taking.seconds);
      const drawn = taking.plan.rawInputs.filter((r) => r.key === REFINED_GLUE && r.from?.kind === 'project');
      console.log(`real-objectives the circuit takes ${drawn.map((r) => `${r.perSecond * SECONDS_PER_MINUTE}/min of ${r.key} from ${r.from?.name}`).join(', ') || 'nothing from the project'}`);
      expect(taking.plan.status, JSON.stringify(taking.plan.warnings)).toBe('ok');
      expect(drawn.map((r) => r.from?.id), 'a Refined Glue row from the project').toEqual([producer.id]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it.skipIf(ec === undefined)('plans a crop farm when the export has the crop table', async (test) => {
    if ((pack.crops?.length ?? 0) === 0) {
      console.log('real-objectives crop farm: skipped, the active export has no crop table (exporter 0.5.1 or later writes it)');
      test.skip('no crop table');
    }
    const crops = pack.crops ?? [];
    const cane = crops.find((card) => card.id === STICKY_CANE);
    expect(cane).toMatchObject({ tier: 4, growthDuration: 200 });
    expect(cane?.drops).toContainEqual({ key: STICKY_RESIN, chance: 1, stackSize: 1 });
    const s = modeSettings({ ...given(ec), target: RAW_RUBBER_DUST, amount: 1, per: 'min', tier: 1 }, 'least-raw');
    const { plan, seconds } = await timed(s);
    logPlan('Raw Rubber Dust 1 a minute at LV, least raw', s, plan, seconds);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(plan.steps.filter((st) => st.farm?.kind === 'crop' && st.farm.crop?.id === STICKY_CANE).map((st) => st.id), 'a Sticky Cane farm').not.toEqual([]);
    // The user's literal example, a rubber tree under the Crop Manager (farms.md §2.8).
    const bonsai = crops.find((card) => card.id === RUBBER_BONSAI);
    expect(bonsai).toMatchObject({ tier: 1, growthDuration: 1200 });
    expect(bonsai?.drops).toHaveLength(3);
    for (const drop of [{ key: RUBBER_SAPLING, chance: 0.3, stackSize: 1 }, { key: RUBBER_WOOD, chance: 0.6, stackSize: 10 }, { key: STICKY_RESIN, chance: 0.05, stackSize: 2 }]) {
      expect(bonsai?.drops).toContainEqual(drop);
    }
    const managed: PlanSettings = { ...given(ec), amount: 1, per: 'min', farms: { ...defaultFarmSettings(), kinds: ['crop-manager'] } };
    const pricing = await linePricing(pack, modeSettings(managed, 'multi-output'), ctx);
    const offered = [...new Set((pricing?.graph.recipes ?? []).flatMap((r) => pricing?.pack?.recipeById.get(r.id)?.meta.farm?.crop?.id ?? []))].sort();
    console.log(`real-objectives the circuit's crop farms with the Crop Manager only: ${offered.join(' ') || 'none'}`);
    expect(offered).toContain(RUBBER_BONSAI);
    for (const o of PLAN_OBJECTIVES) {
      const so = modeSettings(managed, o);
      const run = await timed(so);
      const crop = run.plan.steps.filter((st) => st.farm?.kind === 'crop').map((st) => `${st.count}× ${st.farm?.crop?.id} (${st.farm?.sticks ?? 0} sticks)`);
      logPlan(`the circuit with the Crop Manager only, ${o}`, so, run.plan, run.seconds);
      console.log(`real-objectives the circuit with the Crop Manager only, ${o}: crop steps ${crop.join(' | ') || 'none'}; buys of the rubber goods ${rubberGoods(run.plan).join(' ') || 'none'}`);
    }
  }, 600_000);

  it.skipIf(stored === undefined)('keeps the reference A1 line within 18 machine blocks where the raw cap allows it (A1 (S13); the raw cap wins)', async () => {
    // Add-on 17 ruling S13 as the integration's ruling R11 reads it: the reference's settings without its pins, stops
    // Copper Ingot and Steel Ingot, crafting automated, "Fewest machines" (0.5), cheapest over 24 hours, the group's crop
    // manager at 32 Rubber Wood a minute, and only BASE coming in ("Only these come in", fix wave 3 (B)). Asserted: (b) raw
    // goods only from BASE and the free inputs; (c) none by hand; (d) at most the reference's 18 machine blocks where the raw
    // cap allows it: the plan at "No limit" (`free`) has at most 18 within (1 + DEFAULT_RAW_CAP) x A1's leanest line (the
    // user's ruling of 2026-10-24: the raw cap wins, else both plans are logged); (e) per minute at most Rubber Wood 32 (the
    // farm's and bought together), Copper 11.25, Steel 4, Tin 1, Redstone 5, Sand 2; (f) never dearer by the build MIP's
    // measure than A1 with the reference's pins where that plan is within A1's raw cap (else logged: the raw cap wins).
    // Logged only: (a) its status, seconds and build MIP; A1 at 0.02, by hand, without stops, and with Rubber Wood at 0 in
    // place of the farm (the controller's stand-in).
    const ref = given(stored);
    const a1: PlanSettings = {
      ...ref, recipeChoice: {}, stopItems: [COPPER_INGOT, STEEL_INGOT], automateCrafting: true, stepCharge: DEFAULT_STEP_CHARGE, objective: 'cheapest',
      buildHorizonHours: DEFAULT_BUILD_HORIZON_HOURS, farms: { ...(ref.farms ?? defaultFarmSettings()), running: [GROUP_CROP_MANAGER] },
      inputsOnly: [...REFERENCE_BASE],
    };
    const mine = await timed(a1);
    const stats = (await buildRun(pack, ctx, a1)).sol.buildStats;
    const free = await timed({ ...a1, rawCap: null });
    const pinned = await timed({ ...a1, recipeChoice: ref.recipeChoice });
    const least = mine.plan.rawCost?.leastPerSecond ?? 0;
    const leanest = mine.plan.rawCost?.leanestPerSecond ?? 0;
    const raw = (plan: Plan): number => plan.rawCost?.perSecond ?? 0;
    const text = (plan: Plan, seconds: number): string => `${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps, ${machineBlocks(plan)} machine blocks, `
      + `${plan.steps.filter((st) => st.handCraft).length} by hand, raw ${(raw(plan) * SECONDS_PER_MINUTE).toFixed(6)} a minute (${(raw(plan) / leanest).toFixed(4)} x A1's leanest line), `
      + `build ${plan.cost?.build ?? '-'}, by the build MIP's measure ${buildObjective(plan, a1, least, leanest).toFixed(1)}; raw a minute `
      + Object.entries(rawPerMinute(plan)).map(([key, n]) => `${key} ${n.toFixed(4)}`).join(', ');
    console.log(`real-objectives A1 (a): ${text(mine.plan, mine.seconds)}; its build MIP ${statsText(stats)}; leanest line ${(leanest * SECONDS_PER_MINUTE).toFixed(6)} a minute`);
    console.log(`real-objectives A1 at No limit: ${text(free.plan, free.seconds)}`);
    console.log(`real-objectives A1 with the reference's pins: ${text(pinned.plan, pinned.seconds)}`);
    const logged: Array<[string, PlanSettings]> = [
      ['A1 at 0.02 (Some machines)', { ...a1, stepCharge: SOME_MACHINES }], ['A1 by hand', { ...a1, automateCrafting: false }],
      ['A1 without stops', { ...a1, stopItems: [] }],
      ['A1 with Rubber Wood at 0 in place of the farm', { ...a1, farms: { ...(a1.farms ?? defaultFarmSettings()), running: [] }, costOverrides: { ...a1.costOverrides, [RUBBER_WOOD]: 0 } }],
    ];
    for (const [name, s] of logged) {
      const run = await timed(s);
      console.log(`real-objectives ${name} (logged): ${text(run.plan, run.seconds)}`);
    }
    expect(mine.plan.status, JSON.stringify(mine.plan.warnings)).toBe('ok');
    expect(mine.plan.rawInputs.map((r) => r.key).filter((key) => !REFERENCE_RAW_KINDS.has(key)), '(b)').toEqual([]);
    expect(mine.plan.steps.filter((st) => st.handCraft).map((st) => st.id), '(c)').toEqual([]);
    const capAllows = free.plan.status === 'ok' && machineBlocks(free.plan) <= REFERENCE_BLOCKS && raw(free.plan) <= (1 + DEFAULT_RAW_CAP) * leanest * (1 + 1e-6);
    console.log(`real-objectives A1 (d): ${machineBlocks(mine.plan)} machine blocks against the reference's ${REFERENCE_BLOCKS}; at No limit `
      + `${machineBlocks(free.plan)} blocks at ${(raw(free.plan) / leanest).toFixed(4)} x the leanest line: ${capAllows ? 'the cap allows them (asserted)' : 'the raw cap wins (logged)'}`);
    if (capAllows) expect(machineBlocks(mine.plan), '(d)').toBeLessThanOrEqual(REFERENCE_BLOCKS);
    const perMinute = rawPerMinute(mine.plan);
    for (const [key, most] of Object.entries(REF_RAW)) expect(perMinute[key] ?? 0, `(e) ${key}`).toBeLessThanOrEqual(most + 1e-6);
    const pinnedWithin = pinned.plan.status === 'ok' && raw(pinned.plan) <= (1 + DEFAULT_RAW_CAP) * leanest * (1 + 1e-6);
    const [ours, theirs] = [buildObjective(mine.plan, a1, least, leanest), buildObjective(pinned.plan, a1, least, leanest)];
    console.log(`real-objectives A1 (f): ${ours.toFixed(1)} by the build MIP's measure against the reference pins' ${theirs.toFixed(1)}; the pinned plan uses `
      + `${(raw(pinned.plan) / leanest).toFixed(4)} x A1's leanest line: ${pinnedWithin ? 'within the cap (asserted)' : 'beyond the cap: the raw cap wins (logged)'}`);
    if (pinnedWithin) expect(ours, '(f)').toBeLessThanOrEqual(theirs * (1 + 1e-6));
  }, 600_000);

  it('Polyethylene Bar MV (real-build-cost\'s line, step charge 0.5): farms on <= farms off + 1 steps', async () => {
    // The controller's poly ruling (farms on at most one step more than farms off) at a step charge above 0, on
    // real-build-cost's calibration line at "Fewest machines"; both farm settings given, so `at` decides neither. The
    // user's poly project at 0.5 is fix wave 4's acceptance case (the integration's hand-off), not this one.
    const on = await timed(at(POLYETHYLENE_BAR, 2, 1, { farms: defaultFarmSettings() }));
    const off = await timed(at(POLYETHYLENE_BAR, 2, 1, { farms: FARMS_OFF }));
    logPlan('Polyethylene Bar MV, farms on', at(POLYETHYLENE_BAR, 2, 1, { farms: defaultFarmSettings() }), on.plan, on.seconds);
    logPlan('Polyethylene Bar MV, farms off', at(POLYETHYLENE_BAR, 2, 1, { farms: FARMS_OFF }), off.plan, off.seconds);
    expect(on.plan.status, JSON.stringify(on.plan.warnings)).toBe('ok');
    expect(off.plan.status, JSON.stringify(off.plan.warnings)).toBe('ok');
    expect(on.plan.steps.length).toBeLessThanOrEqual(off.plan.steps.length + 1);
    for (const plan of [on.plan, off.plan]) expect(plan.warnings.filter((w) => w.code === 'free-loop').map((w) => w.text)).toEqual([]);
  }, 300_000);

  it.skipIf(stored === undefined)("prices rubber wood from the group's farm at its upkeep (R0)", async () => {
    // Add-on 17 ruling S14 (the controller's farm price): R0 as stored, crafted by hand, with the group's crop manager at
    // 32 Rubber Wood a minute. The farm's row costs its upkeep, 0, and stays within its rate; no Rubber Wood is bought;
    // no pinned Wood Pulp or Wood Plank recipe is dominated at the farm's price; and the Circuit Board's own figure in its
    // swap list is below 5 raw a board (35.2 before the farm price; about 3.2 at the stop prices of its 8 copper wires).
    const ref = given(stored);
    const r0: PlanSettings = { ...ref, automateCrafting: false, farms: { ...(ref.farms ?? defaultFarmSettings()), running: [GROUP_CROP_MANAGER] } };
    const { plan, seconds } = await timed(r0);
    logPlan('R0 with the group\'s crop manager', r0, plan, seconds);
    const farmed = plan.rawInputs.filter((r) => r.key === RUBBER_WOOD && r.from?.kind === 'farm');
    const bought = plan.rawInputs.filter((r) => r.key === RUBBER_WOOD && r.from === undefined && r.perSecond > TINY);
    const board = plan.steps.find((st) => st.mainOutput !== undefined && pack.nameOf(st.mainOutput) === 'Circuit Board');
    const figure = board?.alternatives.find((a) => a.recipeId === board.recipeId)?.rawCost;
    const dominated = plan.warnings.filter((w) => w.code === 'pin-dominated' && w.key !== undefined && ['Wood Pulp', 'Wood Plank'].includes(pack.nameOf(w.key)));
    console.log(`real-objectives R0's Rubber Wood: from the farm ${farmed.map((r) => `${r.perSecond * SECONDS_PER_MINUTE}/min at ${r.cost}`).join(', ') || 'none'}, `
      + `bought ${bought.map((r) => `${r.perSecond * SECONDS_PER_MINUTE}/min at ${r.cost}`).join(', ') || 'none'}; Circuit Board (${board?.mainOutput ?? 'no step'}, `
      + `${board?.recipeId ?? '-'}) ${figure ?? '-'} raw a board in its swap list; pin-dominated ${plan.warnings.filter((w) => w.code === 'pin-dominated').map((w) => pack.nameOf(w.key ?? '')).join(', ') || 'none'}`);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(farmed.map((r) => r.cost), "the farm's row").toEqual([0]);
    for (const r of farmed) expect(r.perSecond).toBeLessThanOrEqual(GROUP_CROP_MANAGER.outputs[0]!.perMinute / SECONDS_PER_MINUTE + TINY);
    expect(bought.map((r) => r.perSecond), 'bought Rubber Wood').toEqual([]);
    expect(dominated.map((w) => w.text)).toEqual([]);
    expect(figure, "the Circuit Board's figure").toBeLessThan(5);
  }, 300_000);

  it.skipIf(stored === undefined)("publishes R0's by-products for the group's other lines", async () => {
    // Add-on 17 ruling S14 (the controller's summary): R0 as add-on 12 plans it (farm kinds off, other projects' surplus
    // off) publishes its by-products a minute, to 1e-6: Sticky Resin 10, Plantball 12, Carbon Dust 6, Methane 1,920 L,
    // and 8 Small Piles of Steel Dust where its Steel Rod is the Lathe's (none on the Extruder). Goods named as the pack
    // names them.
    const ref = given(stored);
    const r0: PlanSettings = { ...ref, automateCrafting: false, farms: FARMS_OFF, useSurplus: false };
    const { plan, seconds } = await timed(r0);
    logPlan('R0, farm kinds off and no surplus read', r0, plan, seconds);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    const summary = summaryOf(project('r0', 'R0', r0, '2026-10-01T00:00:00.000Z'), plan, new Date().toISOString());
    const perMinute: Record<string, number> = {};
    for (const e of summary?.surplus ?? []) perMinute[pack.nameOf(e.key)] = (perMinute[pack.nameOf(e.key)] ?? 0) + e.perSecond * SECONDS_PER_MINUTE;
    const lathe = plan.steps.some((st) => st.recipeId === ROD_LATHE);
    console.log(`real-objectives R0's summary (Steel Rod on the ${lathe ? 'Lathe' : 'Extruder'}): `
      + `${(summary?.surplus ?? []).map((e) => `${e.key} (${pack.nameOf(e.key)}) ${e.perSecond * SECONDS_PER_MINUTE}/min`).join(', ') || 'none'}`);
    expect(lathe || plan.steps.some((st) => st.recipeId === ROD_EXTRUDER), 'a Steel Rod on the Lathe or the Extruder').toBe(true);
    const want: Record<string, number> = { 'Sticky Resin': 10, Plantball: 12, 'Carbon Dust': 6, Methane: 1920, ...(lathe ? { 'Small Pile of Steel Dust': 8 } : {}) };
    expect(Object.keys(perMinute).sort()).toEqual(Object.keys(want).sort());
    for (const [name, n] of Object.entries(want)) expect(Math.abs((perMinute[name] ?? 0) - n), name).toBeLessThanOrEqual(1e-6);
  }, 300_000);
});
