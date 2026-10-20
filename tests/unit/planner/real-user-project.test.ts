// Real-data acceptance of the planner-quality fix (fix spec §7.2–§7.3, plan 09 Task 8): the user's own Electronic
// Circuit project, the line whose plan they reported six complaints about, planned with its settings exactly as stored
// (the audit's copy of the project, through normalizeSettings: only the settings, never the project's name, id, author,
// marks or notes, ruling P27) per hour (P), per minute (P1m) and with supporting lines (PR), one test per complaint. It
// runs only with GTNH_LOCAL=1 and is skipped everywhere else; nothing game-derived is read or written otherwise. The
// export is loaded once for the whole file, and each plan is timed on a warm pack (a first, unrelated plan warms it).

import { beforeAll, describe, expect, it } from 'vitest';
import { flowGraph, focusSets } from '../../../src/client/views/flow-model.ts';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { isBaseItem } from '../../../src/server/planner/availability.ts';
import { planBasis, type PlanBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { isFluidKey, type StuffKey } from '../../../src/shared/keys.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { normalizeSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings, PlanStep } from '../../../src/shared/types/plan.ts';
import { checkPlanInvariants } from '../../helpers/plan-invariants.ts';

/** The project's stored settings (2026-10-18), verbatim: stored before plan 09, so without its new settings. */
const STORED: Partial<PlanSettings> = {
  target: 'IC2:itemPartCircuit@0', mode: 'rate', amount: 1, per: 'hour', tier: 2, dims: { policy: 'progression', overrides: {} },
  routeDerived: false, logistics: 'routed', costOverrides: {}, stopItems: [], expandItems: [],
  recipeChoice: { 'fluid:glue': '98f259e40a64e8b0', 'gregtech:gt.metaitem.01@32716': '0a074f4241a9e0f9' }, machineTier: {},
  excludedCategories: ['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion'],
  coilHeat: null, automateCrafting: false, declineReuse: [],
};
const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const ADVANCED_CIRCUIT = 'IC2:itemPartCircuitAdv@0';
/** The circuit assembler recipe of the Electronic Circuit: board, 2 resistors, 2 red alloy wires, 2 vacuum tubes, solder. */
const EC_CIRCUIT_ASSEMBLER = 'c0106c4cb6b4b041';
/** The user's pinned Resistor recipe, which another assembler recipe beats on raw material. */
const PINNED_RESISTOR = '0a074f4241a9e0f9';
const RED_ALLOY_WIRE = 'gregtech:gt.blockmachines@2000';   // 1x Red Alloy Wire
const GLASS_TUBE = 'gregtech:gt.metaitem.03@32012';
const SAND = 'minecraft:sand@0';
const GLASS_DUST = 'gregtech:gt.metaitem.01@2890';
const COBBLESTONE = 'minecraft:cobblestone@0';
const PLAN_SECONDS = 5;
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

describe.skipIf(process.env.GTNH_LOCAL !== '1')("the user's Electronic Circuit project on the real 2.9 export", () => {
  let pack: Pack;
  /** The project's settings as the planner reads them: plan 09's settings filled with their defaults (step charge 2 %). */
  const settings: PlanSettings = normalizeSettings(STORED);
  const timed = async (s: PlanSettings): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const plan = await planLine(pack, s, emptyContext());
    return { plan, seconds: (performance.now() - started) / 1000 };
  };
  let P: { plan: Plan; seconds: number };
  let P1m: { plan: Plan; seconds: number };
  let PR: { plan: Plan; seconds: number };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
    await planLine(pack, { ...settings, target: GLASS_TUBE, per: 'min', tier: 1 }, emptyContext());
    P = await timed(settings);
    P1m = await timed({ ...settings, per: 'min' });
    PR = await timed({ ...settings, routeDerived: true });
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

  it('complaint 5, "cobble … molten glass from sand": no cobblestone, no crafted sand or gravel, no hand step, glass from sand or glass dust', () => {
    for (const [name, p] of [['P', P.plan], ['PR', PR.plan]] as const) {
      expect(p.rawInputs.map((r) => r.key), name).not.toContain(COBBLESTONE);
      expect(p.steps.filter((s) => s.inputs.some((i) => i.key === COBBLESTONE)).map((s) => s.id), name).toEqual([]);
      expect(p.steps.filter((s) => s.outputs.some((o) => o.key === 'minecraft:gravel@0' || o.key === SAND)).map((s) => s.id), name).toEqual([]);
      expect(p.steps.filter((s) => s.handCraft).map((s) => s.id), name).toEqual([]);
      // P buys Glass Dust for a forming press or alloy smelter; PR gathers Sand and makes its glass in a supporting line.
      expect(stepsFromGlassImport(p, 2), name).toBeLessThanOrEqual(2);
    }
  });

  it('complaint 6, "recheck the planning step": few steps, little raw material above the least, the same line per minute, a sound plan', () => {
    const p = P.plan;
    expect(p.steps.length).toBeLessThanOrEqual(P_MAX_STEPS);
    expect(PR.plan.steps.length).toBeLessThanOrEqual(PR_MAX_STEPS);
    const raw = p.rawCost as NonNullable<Plan['rawCost']>;
    expect(raw).toBeDefined();
    expect(raw.perSecond).toBeLessThanOrEqual(1.25 * raw.leastPerSecond);
    // The user's priority is the least raw material (controller ruling 2, P14): 2 % per step costs little of it.
    expect(raw.perSecond).toBeLessThanOrEqual(1.1 * raw.leastPerSecond);
    expect(recipeIds(P1m.plan)).toEqual(recipeIds(p));
    const ratio = worstRatio(p, P1m.plan, 60);
    expect(ratio.unmatched).toEqual([]);
    expect(ratio.worst).toBeLessThanOrEqual(RATIO_REL);
    expect(checkPlanInvariants(pack, settings, p).filter((v) => EXACT_KINDS.includes(v.kind)).map((v) => `${v.kind}/${v.severity}: ${v.message}`)).toEqual([]);
    expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'pin-dominated', stepId: PINNED_RESISTOR }));
  });

  it('plans the same settings for an Advanced Circuit at HV on "Least raw material" in under 5 s, at the least raw material', async () => {
    // Spec §7.3: 181 s before the Task 4 review gave the 0 % stage its root-node MIP.
    const { plan, seconds } = await timed({ ...settings, target: ADVANCED_CIRCUIT, tier: 3, stepCharge: 0 });
    expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    const raw = plan.rawCost as NonNullable<Plan['rawCost']>;
    expect(Math.abs(raw.perSecond - raw.leastPerSecond)).toBeLessThanOrEqual(1e-6 * raw.leastPerSecond);
    expect(codesOf(plan)).not.toContain('simplify-skipped');
    expect(codesOf(plan)).not.toContain('numerics');
  }, 60_000);

  it('plans every machine new with "Reuse machines we have" off, also the ones the group lists', async () => {
    // The project links no world, so only the "Machines we have" list can own machines (architecture §11.29): it lists
    // one machine of the circuit assembler step's type and one of the red alloy wiremill's.
    const listed = P.plan.steps.filter((s) => s.recipeId === EC_CIRCUIT_ASSEMBLER || s.mainOutput === RED_ALLOY_WIRE);
    expect(listed).toHaveLength(2);
    const ownedManual = listed.map((s) => ({ mteId: s.machine.mteId, count: 1 }));
    const types = new Set(ownedManual.map((m) => m.mteId));
    expect(types.size).toBe(2);
    const on = await timed({ ...settings, ownedManual });
    const off = await timed({ ...settings, ownedManual, reuseOwned: false });
    for (const { plan, seconds } of [on, off]) {
      expect(plan.status).toBe('ok');
      expect(seconds).toBeLessThan(PLAN_SECONDS);
      expect(recipeIds(plan)).toEqual(recipeIds(P.plan));   // reuse changes which machines are new, not the line
    }
    // Switched on, each listed machine serves one step of its type (Task 9: earlier steps first) and says so.
    const reusing = on.plan.steps.filter((s) => s.owned > 0);
    expect(reusing.reduce((n, s) => n + s.owned, 0)).toBe(ownedManual.length);
    for (const s of reusing) {
      expect(types.has(s.machine.mteId), s.id).toBe(true);
      expect(s.reused, s.id).toEqual({ count: s.owned, where: [] });
    }
    expect(off.plan.steps.filter((s) => s.owned !== 0 || s.reused !== undefined).map((s) => s.id)).toEqual([]);
  }, 60_000);
});
