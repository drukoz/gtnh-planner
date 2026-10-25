// Real-data acceptance of the planner-quality fix (fix spec §7.2–§7.3, plan 09 Task 8): the user's own Electronic
// Circuit project, the line whose plan they reported six complaints about, planned with its settings exactly as stored
// (the audit's copy of the project, through normalizeSettings: only the settings, never the project's name, id, author,
// marks or notes, ruling P27) per hour (P), per minute (P1m) and with supporting lines (PR), one test per complaint. It
// runs only with GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise. The
// export is loaded once for the whole file, and each plan is timed on a warm pack (a first, unrelated plan at the line's
// tier warms it).
//
// Plan 12 (Task 8): the settings fill to build cost counted over 24 hours at "Fewest machines" (0.5), so the checks
// that assume plan 09's scale-free objective — the same line per minute as per hour, raw material within the step
// charge's cap, the least raw material at 0 %, the same line whatever the group owns — read the same settings with build
// cost ignored (P0, P0m); every other check reads the build-cost plans. Complaint 5 accepts sand made from rock-breaker
// cobblestone on forge hammers (D1: gathered blocks are made where that costs less, machines and step charges counted).
// The user's line as they keep it now (docs/local/ec-state.json, read at run time) is checked with crafting on Auto
// Workbenches, the default (the Auto Workbench ruling's item 7).

import { beforeAll, describe, expect, it } from 'vitest';
import { flowGraph, focusSets } from '../../../src/client/views/flow-model.ts';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { isBaseItem } from '../../../src/server/planner/availability.ts';
import { isAutoWorkbench } from '../../../src/server/planner/benches.ts';
import { planBasis, type PlanBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { linePricing } from '../../../src/server/planner/pricing.ts';
import { isFluidKey, type StuffKey } from '../../../src/shared/keys.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { STEP_CHARGE_BEFORE_V3, type Plan, type PlanSettings, type PlanStep } from '../../../src/shared/types/plan.ts';
import { EC_STATE, localDocPath, storedSettings } from '../../helpers/local-docs.ts';
import { checkPlanInvariants } from '../../helpers/plan-invariants.ts';
import { USER_EC_STORED } from '../../helpers/user-project.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const ADVANCED_CIRCUIT = 'IC2:itemPartCircuitAdv@0';
/** The circuit assembler recipe of the Electronic Circuit: board, 2 resistors, 2 red alloy wires, 2 vacuum tubes, solder. */
const EC_CIRCUIT_ASSEMBLER = 'c0106c4cb6b4b041';
/** The user's pinned Resistor recipe, which another assembler recipe beats on raw material. */
const PINNED_RESISTOR = '0a074f4241a9e0f9';
const RED_ALLOY_WIRE = 'gregtech:gt.blockmachines@2000';   // 1x Red Alloy Wire
const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
const SAND = 'minecraft:sand@0';
const GRAVEL = 'minecraft:gravel@0';
const GLASS_DUST = 'gregtech:gt.metaitem.01@2890';
const COBBLESTONE = 'minecraft:cobblestone@0';
const HAMMER_MAP = 'gt.recipe.hammer';
/**
 * The user's MV lines, this project's among them: plan 09's bound, timed after a plan at their tier (fix wave 3 (E),
 * controller OQ1: "the user's MV lines must stay under 5 s warm").
 */
const PLAN_SECONDS = 5;
/**
 * A plan at step charge 0 or with build cost ignored, which prices its line's candidate machines cold as the first plan
 * of its tier (fix wave 3 (E), the controller's ruling of 2026-10-23 on Task 3's finding (2): "every real-data plan-time
 * assertion of a plan at step charge 0 or with build cost ignored that prices its own line's candidate machines cold
 * […] gets the OQ1 (A) bound the same way as the build-cost plans: the next whole second above 1.25 x the slowest
 * quiet-host median of Step 1, measured as the first plan of its tier in a whole-file run"). The Advanced Circuit at HV,
 * the file's first HV plan, took 5.45 s, the median of three on 2026-10-24 (each run started at a 1-minute load under 4):
 * 1.25 × 5.45 = 6.81.
 */
const COLD_PRICES_PLAN_SECONDS = 7;
/**
 * Step caps of complaint 6 at the 2 % default step charge (ruling P14: the spec's 20 and 32 came from its 5 %
 * prototype): P's is the ruling's 22 + 5 (the 2 % count of spec §10; P has 24 steps), PR's its 37 steps + 5.
 */
const P_MAX_STEPS = 27;
const PR_MAX_STEPS = 42;
/** Warnings no plan of the user's line may carry (fix spec D1, D2, the loop guard, the graph cap). */
const NEVER = ['numerics', 'simplify-skipped', 'free-loop', 'graph-too-big'];
/** Invariant kinds (a), (b), (d), (e), (f) of the audit's checker. */
const EXACT_KINDS = ['balance', 'orphan-input', 'flow', 'machines', 'raw-source', 'byproduct'];
/**
 * Two plans of one line at rates 60× apart: each value keeps 9 significant digits (fix spec D3, rounded at unit demand
 * and again when scaled back), so a ratio of two of them is 60 within up to 1e-8 (spec §7.2's complaint 6, as Task 1's
 * ruling on numerics.test's balance bound; measured worst 4.8e-9), no bound near 1e-9.
 */
const RATIO_REL = 1e-8;

/** Goods some step takes that no step makes and the line does not buy. */
function orphans(plan: Plan): StuffKey[] {
  const made = new Set(plan.steps.flatMap((s) => s.outputs.map((o) => o.key)));
  const bought = new Set(plan.rawInputs.map((r) => r.key));
  return [...new Set(plan.steps.flatMap((s) => s.inputs.map((i) => i.key)))].filter((k) => !made.has(k) && !bought.has(k)).sort();
}

/** Largest |made + bought − taken − thrown away − delivered| / taken over the goods steps take. */
function worstImbalance(plan: Plan, target: StuffKey, perSecond: number): number {
  const sum = new Map<StuffKey, number>();
  const taken = new Map<StuffKey, number>();
  const add = (m: Map<StuffKey, number>, k: StuffKey, v: number): void => {
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const s of plan.steps) {
    for (const o of s.outputs) add(sum, o.key, o.amount * s.runsPerSecond);
    for (const i of s.inputs) {
      add(sum, i.key, -i.amount * s.runsPerSecond);
      add(taken, i.key, i.amount * s.runsPerSecond);
    }
  }
  for (const r of plan.rawInputs) add(sum, r.key, r.perSecond);
  for (const b of plan.byproducts) add(sum, b.key, -b.amount);
  add(sum, target, -perSecond);
  let worst = 0;
  for (const [k, t] of taken) worst = Math.max(worst, Math.abs(sum.get(k) ?? 0) / t);
  return worst;
}

/**
 * The derived materials of fix spec R6 (rule 1 of `supportingLines`): goods other than the target that availability
 * calls derived and that are a base item (a GT dust, ingot or gem, or a material's base part) or a fluid — the alloys,
 * plastics and chemicals supporting lines make.
 */
function derivedMaterials(pack: Pack, plan: Plan, basis: PlanBasis): (key: StuffKey | undefined) => boolean {
  return (key) => key !== undefined && key !== plan.target && basis.avail.classOf(key) === 'derived' && (isFluidKey(key) || isBaseItem(pack, key));
}

/**
 * Whether fix spec R6 itself keeps `step`, a step without a supporting line, in the main line: what it makes goes to the
 * target, to a main-line step, to two lines or only to the sink (rule 3), and its main output roots no line (rule 2: no
 * step sends it to the target or to a step whose main output is no derived material) unless it is a fluid made in a
 * line of one step (rule 4: refined glue, glue).
 */
function keptInMainLine(plan: Plan, step: PlanStep, isMaterial: (key: StuffKey | undefined) => boolean): boolean {
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const goesTo = (id: string): string[] => [...new Set(plan.flows.filter((f) => f.from === id && f.to !== 'sink').map((f) => f.to))];
  const lines = goesTo(step.id).map((to) => (to === 'out' ? null : (steps.get(to)?.line?.key ?? null)));
  const oneLine = lines.length > 0 && !lines.includes(null) && new Set(lines).size === 1;
  const key = step.mainOutput;
  const root = plan.flows.some((f) => f.key === key && steps.has(f.from) && (f.to === 'out' || (steps.has(f.to) && !isMaterial(steps.get(f.to)?.mainOutput))));
  const alone = !plan.steps.some((s) => s.id !== step.id && goesTo(s.id).length > 0 && goesTo(s.id).every((to) => to === step.id));
  return !oneLine && (!root || (key !== undefined && isFluidKey(key) && alone));
}

/** What one run of `step` nets of `key`: made less taken. */
function netPerRun(step: PlanStep, key: StuffKey): number {
  let net = 0;
  for (const o of step.outputs) if (o.key === key) net += o.amount;
  for (const i of step.inputs) if (i.key === key) net -= i.amount;
  return net;
}

/**
 * The fewest steps between an import of sand or glass dust and what the glass-tube step takes (0: it takes the import
 * itself), following the steps that make each good; Infinity beyond `depth` steps.
 */
function stepsFromGlassImport(plan: Plan, depth: number): number {
  const tube = plan.steps.find((s) => s.mainOutput === GLASS_TUBE);
  if (tube === undefined) return Infinity;
  const bought = new Set(plan.rawInputs.map((r) => r.key));
  const distance = (key: StuffKey, left: number): number => {
    if ((key === SAND || key === GLASS_DUST) && bought.has(key)) return 0;
    if (left === 0) return Infinity;
    let best = Infinity;
    for (const s of plan.steps) {
      if (s.id === tube.id || netPerRun(s, key) <= 0) continue;
      for (const i of s.inputs) best = Math.min(best, 1 + distance(i.key, left - 1));
    }
    return best;
  };
  return Math.min(...tube.inputs.map((i) => distance(i.key, depth)));
}

/** Every rate of `fast` against `slow` × `factor`: the largest relative difference, and the rates without a partner. */
function worstRatio(slow: Plan, fast: Plan, factor: number): { worst: number; unmatched: string[] } {
  let worst = 0;
  const unmatched: string[] = [];
  const compare = (label: string, a: number | undefined, b: number | undefined): void => {
    if (a === undefined || b === undefined) {
      unmatched.push(label);
      return;
    }
    worst = Math.max(worst, Math.abs(b - factor * a) / Math.max(Math.abs(factor * a), 1e-300));
  };
  const fastSteps = new Map(fast.steps.map((s) => [s.id, s]));
  for (const s of slow.steps) compare(`step ${s.id}`, s.runsPerSecond, fastSteps.get(s.id)?.runsPerSecond);
  const fastFlows = new Map(fast.flows.map((f) => [`${f.from}|${f.to}|${f.key}`, f.perSecond]));
  for (const f of slow.flows) compare(`flow ${f.from}|${f.to}|${f.key}`, f.perSecond, fastFlows.get(`${f.from}|${f.to}|${f.key}`));
  const fastRaw = new Map(fast.rawInputs.map((r) => [r.key, r]));
  for (const r of slow.rawInputs) {
    compare(`raw ${r.key}`, r.perSecond, fastRaw.get(r.key)?.perSecond);
    compare(`raw cost ${r.key}`, r.cost, fastRaw.get(r.key)?.cost);
  }
  const fastLeft = new Map(fast.byproducts.map((b) => [b.key, b.amount]));
  for (const b of slow.byproducts) compare(`byproduct ${b.key}`, b.amount, fastLeft.get(b.key));
  if (fast.flows.length !== slow.flows.length) unmatched.push(`${fast.flows.length} flows against ${slow.flows.length}`);
  return { worst, unmatched };
}

const codesOf = (plan: Plan): string[] => [...new Set(plan.warnings.map((w) => w.code))];
const recipeIds = (plan: Plan): string[] => plan.steps.map((s) => s.recipeId).sort();

/** Sand and gravel, each dug, made or both (`'none'`: the plan has neither). */
function sourceOf(plan: Plan, key: StuffKey): 'dug' | 'made' | 'both' | 'none' {
  const dug = plan.rawInputs.some((r) => r.key === key);
  const made = plan.steps.some((s) => s.outputs.some((o) => o.key === key));
  return dug && made ? 'both' : dug ? 'dug' : made ? 'made' : 'none';
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')("the user's Electronic Circuit project on the real 2.9 export", () => {
  let pack: Pack;
  /**
   * The project's settings as the planner reads them (plan 09's settings filled with their defaults: since plan 12's fix
   * wave 2 build cost over 24 hours at "Fewest machines", 0.5), crafting by hand as stored: `normalizeSettings` now reads
   * every project as automated (the user's ruling 180 (b)), and plan 09's checks were worked out on these settings
   * verbatim, by hand (plan 12 Task 8; `planLine` still plans an explicit false by hand).
   */
  const settings: PlanSettings = { ...normalizeSettings(USER_EC_STORED), automateCrafting: false };
  const timed = async (s: PlanSettings): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, emptyContext());
    return { plan, seconds: (performance.now() - started) / 1000 };
  };
  let P: { plan: Plan; seconds: number };
  let P1m: { plan: Plan; seconds: number };
  let PR: { plan: Plan; seconds: number };
  /** P and P1m with build cost ignored: plan 09's objective, where its scale-free checks hold (plan 12 Task 8). */
  let P0: { plan: Plan; seconds: number };
  let P0m: { plan: Plan; seconds: number };
  /** P0 at plan 09's default step charge, 2 % ("Some machines"), which complaint 6's raw-material bound was set at. */
  let P02: { plan: Plan; seconds: number };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...settings, target: GLASS_TUBE, per: 'min' }, emptyContext());   // warm the pack at the line's tier
    P = await timed(settings);
    P1m = await timed({ ...settings, per: 'min' });
    PR = await timed({ ...settings, routeDerived: true });
    P0 = await timed({ ...settings, buildHorizonHours: null });
    P0m = await timed({ ...settings, per: 'min', buildHorizonHours: null });
    P02 = await timed({ ...settings, buildHorizonHours: null, stepCharge: STEP_CHARGE_BEFORE_V3 });
  }, 300_000);

  it('plans the line per hour, per minute and with supporting lines, each in under 5 s, with no solver warning', () => {
    for (const [name, { plan, seconds }] of [['P', P], ['P1m', P1m], ['PR', PR]] as const) {
      expect(plan.status, `${name}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
      expect(seconds, name).toBeLessThan(PLAN_SECONDS);
      expect(codesOf(plan).filter((c) => NEVER.includes(c)), name).toEqual([]);
    }
  });

  it('complaint 1, "we are missing the import": every good a step takes is made or bought, in balance', () => {
    const p = P.plan;
    expect(indexPlan(p).issues.filter((i) => i.code === 'orphan-input' || i.code === 'short-input')).toEqual([]);
    expect(orphans(p)).toEqual([]);
    expect(worstImbalance(p, ELECTRONIC_CIRCUIT, 1 / 3600)).toBeLessThan(1e-6);
    // The served plan took Polyvinyl Acetate and Methyl Acetate Cells from nowhere, for an Advanced Glue that saved 0.1 %.
    const taken = new Set(p.steps.flatMap((s) => s.inputs.map((i) => i.key)));
    for (const key of ['fluid:polyvinylacetate', 'gregtech:gt.metaitem.01@30681', 'fluid:advancedglue']) expect(taken.has(key), key).toBe(false);
  });

  it('complaint 2, "we need PE and ethylene": no bought fluid made elsewhere, sources that say where it comes from, supporting lines', () => {
    for (const [name, p] of [['P', P.plan], ['PR', PR.plan]] as const) {
      expect(p.rawInputs.filter((r) => r.leafClass === 'derived' && r.key.startsWith('fluid:')).map((r) => r.key), name).toEqual([]);
      expect(p.rawInputs.map((r) => r.key), name).not.toContain('fluid:ethylene');
    }
    const derived = P.plan.rawInputs.filter((r) => r.leafClass === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    for (const r of derived) {
      expect(r.pricedVia, r.key).toBeDefined();
      expect(r.pricedVia?.mapId, r.key).not.toBe('gt.recipe.canner');
      expect(r.sources.filter((s) => s.kind === 'derived' && s.detail.startsWith('made by Canner')), r.key).toEqual([]);
    }
    // With supporting lines the line buys nothing made elsewhere, and every step that makes a derived material has `line`:
    // all of them but the ones fix spec R6 keeps in the main line by its own rules (keptInMainLine: oxygen and naphtha
    // feeding several lines, glue made in one step, steam for a main-line reactor), and at least one.
    expect(PR.plan.rawInputs.filter((r) => r.leafClass === 'derived').map((r) => r.key)).toEqual([]);
    const isMaterial = derivedMaterials(pack, PR.plan, planBasis(pack, { ...settings, routeDerived: true }, emptyContext()));
    const materialSteps = PR.plan.steps.filter((s) => isMaterial(s.mainOutput));
    expect(materialSteps.filter((s) => s.line !== undefined).length).toBeGreaterThan(0);
    expect(materialSteps.filter((s) => s.line === undefined && !keptInMainLine(PR.plan, s, isMaterial)).map((s) => `${s.id} makes ${s.mainOutput}`)).toEqual([]);
    // Each material P buys made is made in PR on a supporting line, wherever PR takes it (6 of P's 7: PR takes no
    // Soldering Alloy Ingot).
    let checked = 0;
    for (const { key } of derived) {
      if (!PR.plan.steps.some((s) => s.inputs.some((i) => i.key === key))) continue;
      checked += 1;
      const makers = PR.plan.steps.filter((s) => s.mainOutput === key);
      expect(makers.length, key).toBeGreaterThan(0);
      for (const s of makers) expect(s.line, `${key} made by ${s.id}`).toBeDefined();
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('complaint 3, "two places, two processes": one step per product', () => {
    for (const [name, p] of [['P', P.plan], ['PR', PR.plan]] as const) {
      // Nothing the plan does not add up on (fix spec R11): no good made two ways, none both bought and made (a Bricked
      // Blast Furnace run for its Ferrosilite beside bought copper is named after the Ferrosilite, spec D13).
      expect(indexPlan(p).issues, name).toEqual([]);
      const mains = p.steps.flatMap((s) => (s.mainOutput === undefined ? [] : [s.mainOutput]));
      expect(mains.filter((key, i) => mains.indexOf(key) !== i), name).toEqual([]);
      const makers = (key: StuffKey): string[] => p.steps.filter((s) => s.outputs.some((o) => o.key === key)).map((s) => s.id);
      expect(makers('fluid:molten.plastic').length, name).toBeLessThanOrEqual(1);
      expect(makers('gregtech:gt.metaitem.01@17035' /* Copper Plate */).length, name).toBeLessThanOrEqual(1);
    }
  });

  it('complaint 4, "where the wire is coming out": the wire lights its one wiremill and the circuit assembler, every port has its peers', () => {
    const p = P.plan;
    const lit = focusSets(flowGraph(p, 'hour'), { kind: 'item', key: RED_ALLOY_WIRE });
    expect(lit).not.toBeNull();
    const producers = [...(lit?.producers ?? [])];
    expect(producers).toHaveLength(1);
    expect(p.steps.find((s) => s.id === producers[0])?.mapId).toBe('gt.recipe.wiremill');
    expect([...(lit?.consumers ?? [])]).toContain(EC_CIRCUIT_ASSEMBLER);
    // Every port tells where its good comes from or goes: what a step needs comes in in full, what it makes on balance
    // goes out in full, each from or to named peers (steps, the purchases, the target, left-overs).
    const index = indexPlan(p);
    for (const step of p.steps) {
      for (const [key, port] of index.inputs.get(step.id) ?? []) {
        if (!(port.needPerSecond > 0)) continue;
        expect(port.peers.length, `${step.id} takes ${key}`).toBeGreaterThan(0);
        expect(Math.abs(port.perSecond - port.needPerSecond), `${step.id} takes ${key}`).toBeLessThanOrEqual(1e-6 * port.needPerSecond);
      }
      for (const [key, port] of index.outputs.get(step.id) ?? []) {
        const net = netPerRun(step, key) * step.runsPerSecond;
        if (!(net > 0)) continue;
        expect(port.peers.length, `${step.id} makes ${key}`).toBeGreaterThan(0);
        expect(Math.abs(port.perSecond - net), `${step.id} makes ${key}`).toBeLessThanOrEqual(1e-6 * net);
      }
    }
  });

  it('complaint 5, "cobble … molten glass from sand": sand and gravel dug or made on forge hammers, cobblestone from a rock breaker, glass from sand', () => {
    // Plan 12 (D1, the user's request): build cost counted, a Project Red line may make its sand from rock-breaker
    // cobblestone on forge hammers, one for the gravel and one for the sand (Project Red cannot feed a machine its own
    // output: no pool), where that costs less with the machines counted; the tube's sand then comes from them.
    for (const [name, p] of [['P', P.plan], ['P1m', P1m.plan], ['PR', PR.plan]] as const) {
      const made = (key: StuffKey): PlanStep[] => p.steps.filter((s) => s.outputs.some((o) => o.key === key));
      const hammers = p.steps.some((s) => s.mapId === HAMMER_MAP);
      const byHandBesideHammers = hammers ? p.steps.filter((s) => s.handCraft && (made(SAND).includes(s) || made(GRAVEL).includes(s))) : [];
      const glass = stepsFromGlassImport(p, 2) <= 2 ? 'an import of sand or glass dust within 2 steps' : 'sand made on forge hammers';
      console.log(`real-user-project complaint 5, ${name}: sand ${sourceOf(p, SAND)}, gravel ${sourceOf(p, GRAVEL)}, `
        + `${made(SAND).length + made(GRAVEL).length} step(s) make them (${[...made(GRAVEL), ...made(SAND)].map((s) => `${s.id} on ${s.machine.name}`).join(', ') || 'none'}); `
        + `the glass tube's glass from ${glass}${byHandBesideHammers.length > 0 ? `; FOR THE CONTROLLER: gravel crafted by hand beside a sand hammer: ${byHandBesideHammers.map((s) => s.id).join(', ')}` : ''}`);
      // (a) each dug or made, never both
      for (const key of [SAND, GRAVEL]) expect(sourceOf(p, key), `${name} ${key}`).not.toBe('both');
      // (b) never crafted by hand beside a forge hammer: per minute strictly; per hour logged above for the controller (a
      // hammer of its own may cost more than three step charges at that rate, controller ruling 2)
      if (name === 'P1m') expect(byHandBesideHammers.map((s) => s.id), name).toEqual([]);
      // (c) on forge hammers, no pool holding a step beside one that takes what it makes, a pool's machines what its steps need
      for (const s of [...made(SAND), ...made(GRAVEL)].filter((x) => !byHandBesideHammers.includes(x))) expect(s.mapId, `${name} ${s.id}`).toBe(HAMMER_MAP);
      for (const s of p.steps.filter((x) => x.pool !== undefined && x.pool.steps[0] === x.id)) {
        const pool = p.steps.filter((x) => x.pool?.id === s.pool?.id);
        const takes = (a: PlanStep, b: PlanStep): boolean => a.inputs.some((i) => b.outputs.some((o) => o.key === i.key));
        if (made(SAND).includes(s) || made(GRAVEL).includes(s)) expect(pool.some((a) => pool.some((b) => a !== b && takes(a, b))), `${name} ${s.pool?.id}`).toBe(false);
        let busy = 0;
        for (const x of pool) busy += (x.runsPerSecond * x.durationTicks) / 20;
        expect(s.count, `${name} ${s.pool?.id}`).toBe(Math.max(1, Math.ceil(busy - 1e-9)));
      }
      // (d) cobblestone is never bought: what takes it is fed by the rock breaker's supply step
      expect(p.rawInputs.map((r) => r.key), name).not.toContain(COBBLESTONE);
      const breakers = p.steps.filter((s) => s.supply === COBBLESTONE).map((s) => s.id);
      for (const s of p.steps.filter((x) => x.inputs.some((i) => i.key === COBBLESTONE))) {
        expect(p.flows.filter((f) => f.to === s.id && f.key === COBBLESTONE).every((f) => breakers.includes(f.from)), `${name} ${s.id}`).toBe(true);
        expect(breakers.length, `${name} ${s.id}`).toBeGreaterThan(0);
      }
      // (e) the glass tube's sand: an import of sand or glass dust within 2 steps (plan 09's check), or sand made on the hammers
      if (stepsFromGlassImport(p, 2) > 2) expect(made(SAND).filter((s) => s.mapId === HAMMER_MAP).length, name).toBeGreaterThan(0);
      // no step crafted by hand anywhere else (plan 09)
      expect(p.steps.filter((s) => s.handCraft && !byHandBesideHammers.includes(s)).map((s) => s.id), name).toEqual([]);
    }
  });

  it('complaint 6, "recheck the planning step": few steps, little raw material above the least, the same line per minute, a sound plan', async () => {
    const p = P.plan;
    expect(p.steps.length).toBeLessThanOrEqual(P_MAX_STEPS);
    expect(PR.plan.steps.length).toBeLessThanOrEqual(PR_MAX_STEPS);
    // Plan 09's objective, scale-free and within the step charge's cap, on the same settings with build cost ignored
    // (plan 12 Task 8: with build cost counted the objective weighs machines against the rate, so per hour and per minute
    // may rightly run different recipes, and the line may use more raw material to build fewer machines).
    const raw = P0.plan.rawCost as NonNullable<Plan['rawCost']>;
    expect(raw).toBeDefined();
    expect(raw.perSecond).toBeLessThanOrEqual(1.25 * raw.leastPerSecond);
    // At 2 % per step (plan 09's default, controller ruling 2, P14, when the user's priority was the least raw material)
    // a step costs little of it. Since the user's answer of 2026-10-20 ("Fewest machines", 50 %, the default now) a step
    // may cost up to the cap above.
    const atTwo = P02.plan.rawCost as NonNullable<Plan['rawCost']>;
    expect(atTwo.perSecond).toBeLessThanOrEqual(1.1 * atTwo.leastPerSecond);
    expect(recipeIds(P0m.plan)).toEqual(recipeIds(P0.plan));
    const ratio = worstRatio(P0.plan, P0m.plan, 60);
    expect(ratio.unmatched).toEqual([]);
    expect(ratio.worst).toBeLessThanOrEqual(RATIO_REL);
    // With build cost counted: logged.
    const built = p.rawCost as NonNullable<Plan['rawCost']>;
    const onlyHour = recipeIds(p).filter((id) => !recipeIds(P1m.plan).includes(id));
    const onlyMinute = recipeIds(P1m.plan).filter((id) => !recipeIds(p).includes(id));
    console.log(`real-user-project complaint 6: with build cost P uses ${(built.perSecond / built.leastPerSecond).toFixed(4)}× the least raw material `
      + `(ignoring it ${(raw.perSecond / raw.leastPerSecond).toFixed(4)}×), ${p.steps.length} steps (ignoring it ${P0.plan.steps.length}), PR ${PR.plan.steps.length}; `
      + `per hour only ${onlyHour.join(' ') || 'none'}, per minute only ${onlyMinute.join(' ') || 'none'}, worst rate ratio ${worstRatio(p, P1m.plan, 60).worst.toExponential(2)}`);
    expect(checkPlanInvariants(pack, settings, p, { buildCost: true, farmPack: (await linePricing(pack, settings, emptyContext()))?.pack })
      .filter((v) => EXACT_KINDS.includes(v.kind) && v.severity !== 'info')
      .map((v) => `${v.kind}/${v.severity}: ${v.message}`)).toEqual([]);
    expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'pin-dominated', stepId: PINNED_RESISTOR }));
  });

  it('plans the same settings for an Advanced Circuit at HV on "Least raw material", build cost ignored, at the least raw material', async () => {
    // Spec §7.3: 181 s before the Task 4 review gave the 0 % stage its root-node MIP. With build cost counted the line may
    // use more raw material to build fewer machines (real-build-cost.test.ts plans that); ignoring it, the least. The
    // file's first HV plan, it prices its tier's machines cold (COLD_PRICES_PLAN_SECONDS).
    const { plan, seconds } = await timed({ ...settings, target: ADVANCED_CIRCUIT, tier: 3, stepCharge: 0, buildHorizonHours: null });
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(COLD_PRICES_PLAN_SECONDS);
    const raw = plan.rawCost as NonNullable<Plan['rawCost']>;
    expect(Math.abs(raw.perSecond - raw.leastPerSecond)).toBeLessThanOrEqual(1e-6 * raw.leastPerSecond);
    expect(codesOf(plan)).not.toContain('simplify-skipped');
    expect(codesOf(plan)).not.toContain('numerics');
  }, 60_000);

  it('plans every machine new with "Reuse machines we have" off, also the ones the group lists, build cost ignored', async () => {
    // The project links no world, so only the "Machines we have" list can own machines (architecture §11.29): it lists
    // one machine of the circuit assembler step's type and one of the red alloy wiremill's. With build cost ignored
    // reuse changes which machines are new, not the line (with it counted owned machines are free and may change the
    // line: real-build-cost.test.ts plans that); each step says which of the owned units it runs on (plan 12: `units`).
    const listed = P0.plan.steps.filter((s) => s.recipeId === EC_CIRCUIT_ASSEMBLER || s.mainOutput === RED_ALLOY_WIRE);
    expect(listed).toHaveLength(2);
    const ownedManual = listed.map((s) => ({ mteId: s.machine.mteId, count: 1 }));
    const types = new Set(ownedManual.map((m) => m.mteId));
    expect(types.size).toBe(2);
    const on = await timed({ ...settings, ownedManual, buildHorizonHours: null });
    const off = await timed({ ...settings, ownedManual, reuseOwned: false, buildHorizonHours: null });
    for (const { plan, seconds } of [on, off]) {
      expect(plan.status).toBe('ok');
      expect(seconds).toBeLessThan(PLAN_SECONDS);
      expect(recipeIds(plan)).toEqual(recipeIds(P0.plan));   // reuse changes which machines are new, not the line
    }
    // Switched on, each listed machine serves one step of its type (Task 9: earlier steps first) and says so.
    const reusing = on.plan.steps.filter((s) => s.owned > 0);
    expect(reusing.reduce((n, s) => n + s.owned, 0)).toBe(ownedManual.length);
    for (const s of reusing) {
      expect(types.has(s.machine.mteId), s.id).toBe(true);
      expect(s.reused, s.id).toEqual({ count: s.owned, where: [], units: [0] });
    }
    expect(off.plan.steps.filter((s) => s.owned !== 0 || s.reused !== undefined).map((s) => s.id)).toEqual([]);
  }, 60_000);

  // The user's line as they keep it now (docs/local/ec-state.json, read at run time, settings only; its world scan is
  // not in this checkout, so no machines are owned), with crafting on Auto Workbenches, which `normalizeSettings` makes of
  // every project (the user's ruling 180 (b)).
  const ecState = process.env.GTNH_LOCAL === '1' ? localDocPath(EC_STATE) : undefined;
  if (process.env.GTNH_LOCAL === '1' && ecState === undefined) console.log(`real-user-project: the user's current line skipped, no ${EC_STATE}`);
  it.skipIf(ecState === undefined)("runs the user's current line's crafting on Auto Workbenches: by hand only what no autocrafter can run, saying why", async () => {
    // The Auto Workbench ruling's item 7, read as user ruling 180 (d) and controller ruling 214 have it: no hand-craft step
    // but a recipe no autocrafter in the pack can run, with its reason on the step; every crafting step on an Auto
    // Workbench at or below the project's tier; the build list holds them.
    const s = normalizeSettings(storedSettings(ecState as string));
    const { plan, seconds } = await timed(s);
    const crafting = plan.steps.filter((x) => x.mapId === 'crafting');
    console.log(`real-user-project current line: ${plan.status}, ${seconds.toFixed(2)} s, ${plan.steps.length} steps, ${crafting.length} crafting steps `
      + `(${crafting.filter((x) => x.handCraft).length} by hand), build ${plan.cost?.build}`);
    expect(s.automateCrafting).toBe(true);
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    for (const step of plan.steps.filter((x) => x.handCraft)) {
      expect(step.warnings.filter((w) => w.startsWith('Crafted by hand: it ')), step.id).toHaveLength(1);
    }
    for (const step of crafting.filter((x) => !x.handCraft)) {
      expect(isAutoWorkbench(pack.machines.get(step.machine.mteId)), `${step.id} on ${step.machine.name}`).toBe(true);
      expect(step.machine.tier, step.id).toBeLessThanOrEqual(plan.tier);
      if (step.count > step.owned) expect(plan.buildList.some((l) => l.key === pack.machines.get(step.machine.mteId)?.itemKey), step.id).toBe(true);
    }
  }, 60_000);
});
