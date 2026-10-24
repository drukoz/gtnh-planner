// Real-data acceptance of the planner (architecture §10): plans on the active export of this host (GT New Horizons
// 2.9.0-RC-1) and checks that the plans are ones a group could build. It runs only with GTNH_LOCAL=1 and is skipped
// everywhere else; nothing game-derived is read or written otherwise. The export is loaded once for the whole file.
//
// The keys below are the real 2.9 items and fluids. "Ordinary" is what GTNH's own LV–HV circuit and hull lines take from
// the world, now that they make their alloys, plastics and chemicals in supporting lines (plan 09: routeDerived on by
// default, derived fluids always made, glass from gathered sand, free inputs from rock breakers, pumps and compressors):
// copper, tin and antimony, iron, gold, tantalum, the ores' dusts, redstone, sand, wood, rubber, coal, raw oil and the
// other base materials the chains behind them start from.
//
// Plan 12 (Task 8): the plans count build cost over 24 hours at "Fewest machines" by default. The checks that assume
// plan 09's objective (the aluminium line's one blast furnace step, the least raw material at 0 %) read the same
// settings with build cost ignored; real-build-cost.test.ts plans them with build cost counted. HV lines with an avoid
// list or at 0 % may take up to 8 s (controller ruling 187).

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { planBasis, resolveAvoid } from '../../../src/server/planner/basis.ts';
import { expandBomLines } from '../../../src/server/planner/bom.ts';
import { moltenMaterial } from '../../../src/server/planner/costs.ts';
import { emptyContainers } from '../../../src/server/planner/machines.ts';
import { emptyContext, obtainableIn, planLine } from '../../../src/server/planner/plan.ts';
import { tierName } from '../../../src/shared/gt/tiers.ts';
import { indexPlan } from '../../../src/shared/plan/balance.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { FREE_KEYS, type BomLine, type Plan, type PlanSettings, type PlanStep } from '../../../src/shared/types/plan.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
const ADVANCED_CIRCUIT = 'IC2:itemPartCircuitAdv@0';
const LV_MACHINE_HULL = 'gregtech:gt.blockmachines@11';
const LV_MACHINE_CASING = 'gregtech:gt.blockcasings@1';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
const STEEL_PLATE = 'gregtech:gt.metaitem.01@17305';
const MICROPROCESSOR = 'gregtech:gt.metaitem.03@32078';
const DIAMOND_LENS = 'gregtech:gt.metaitem.01@24500';
const CALCITE_DUST = 'gregtech:gt.metaitem.01@2823';
const MAGNETIC_STEEL_INGOT = 'gregtech:gt.metaitem.01@11355';
const ANNEALED_COPPER_INGOT = 'gregtech:gt.metaitem.01@11345';
const ALUMINIUM_INGOT = 'gregtech:gt.metaitem.01@11019';
const RED_ALLOY_INGOT = 'gregtech:gt.metaitem.01@11308';
const IRON_III_CHLORIDE = 'fluid:ironiiichloride';
const RAW_SILICON_DUST = 'gregtech:gt.metaitem.01@2020';
const SAND = 'minecraft:sand@0';
const GRAVEL = 'minecraft:gravel@0';
const COBBLESTONE = 'minecraft:cobblestone@0';
const FORGE_HAMMER_MAP = 'gt.recipe.hammer';
const GLASS_DUST = 'gregtech:gt.metaitem.01@2890';
const ANTIMONY_INGOT = 'gregtech:gt.metaitem.01@11058';
/**
 * The circuit assembler recipe of the Electronic Circuit: board, 2 resistors, 2 red alloy wires, 2 vacuum tubes, solder.
 * (Its id since the loader keeps recipe ids stable across re-exports, dcb0ce4; it was 9cbcefac6fe44dd1 before.)
 */
const EC_CIRCUIT_ASSEMBLER = 'c0106c4cb6b4b041';
/** Its solder slot (`Ingredient.slot`): 72 L Molten Soldering Alloy, 144 L Molten Tin or 288 L Molten Lead. */
const SOLDER_SLOT = 100;
const SOLDERING_ALLOY: readonly string[] = ['fluid:molten.solderingalloy', 'gregtech:gt.metaitem.01@2314', 'gregtech:gt.metaitem.01@11314'];

const COPPER = ['gregtech:gt.metaitem.01@11035', 'gregtech:gt.metaitem.01@11345' /* annealed */];
const SOLDER = ['gregtech:gt.metaitem.01@2314' /* soldering alloy dust */, 'gregtech:gt.metaitem.01@11314' /* soldering alloy ingot */,
  'gregtech:gt.metaitem.01@11057' /* tin ingot */, 'gregtech:gt.metaitem.01@2057' /* tin dust, mixed into soldering alloy */];

/**
 * Ordinary base materials of GTNH's LV–HV circuit, hull and casing lines, by key. Fix spec §7.2 took cobblestone, Molten
 * Copper, Ethylene, Molten Polyethylene and the fluids made from others (Oxygen, Nitrogen, Hydrogen, Carbon Dioxide and
 * Monoxide, Distilled Water, Molten Tin) out and put sand, vanilla iron and coal, cast iron, Helium and Sulfuric Acid in;
 * the supporting lines (on by default) add the base materials their chains start from (the ores' dusts, tin dust, raw
 * oil, sugar beet) and the logs canonicalRank ranks 0 (oak, acacia, rubber wood), any of which fills Wood Pulp's slot.
 */
const ORDINARY: ReadonlySet<string> = new Set([
  // free
  'fluid:water', 'fluid:air',
  // metals and alloys
  ...COPPER, ...SOLDER,
  'gregtech:gt.metaitem.01@2032' /* iron dust */, 'gregtech:gt.metaitem.01@11032' /* iron ingot */, 'gregtech:gt.metaitem.01@11305' /* steel ingot */,
  'gregtech:gt.metaitem.01@2305' /* steel dust */, 'gregtech:gt.metaitem.01@11308' /* red alloy ingot */, 'gregtech:gt.metaitem.01@2308' /* red alloy dust */,
  'gregtech:gt.metaitem.01@11381' /* redstone alloy ingot */, 'minecraft:redstone@0', 'minecraft:gold_ingot@0', 'gregtech:gt.metaitem.01@2086' /* gold dust */,
  'gregtech:gt.metaitem.01@11080' /* tantalum ingot */, 'gregtech:gt.metaitem.01@11314' /* soldering alloy ingot */,
  'gregtech:gt.metaitem.01@11058' /* antimony ingot: the soldering alloy of a line within the raw cap (fix wave 3 (A)) */,
  'minecraft:iron_ingot@0', 'minecraft:coal@0', 'gregtech:gt.metaitem.01@11304' /* cast iron ingot */,
  // ores' dusts the supporting lines smelt, mix or electrolyse
  'gregtech:gt.metaitem.01@2058' /* antimony dust */, 'gregtech:gt.metaitem.01@2855' /* chalcopyrite dust */, 'gregtech:gt.metaitem.01@2871' /* malachite dust */,
  'gregtech:gt.metaitem.01@2525' /* sodalite dust */, 'gregtech:gt.metaitem.01@2913' /* realgar dust */, 'gregtech:gt.metaitem.01@2022' /* sulfur dust */,
  // a mined ore's dust "Fewest machines" buys for its phosphorus and oxygen rather than build the machines that make them
  // (plan 12 fix wave 2, controller ruling 197 (6))
  'gregtech:gt.metaitem.01@2833' /* phosphate dust */,
  // glass, wood, crops, rubber, carbon
  SAND, 'minecraft:sand@1', GLASS_DUST, 'gregtech:gt.metaitem.01@2809' /* wood pulp */, 'minecraft:log@0' /* oak wood */,
  'minecraft:log2@0' /* acacia wood */, 'IC2:blockRubWood@0' /* rubber wood */, 'cropsnh:berry@1' /* sugar beet */, 'gregtech:gt.metaitem.01@11880' /* rubber bar */,
  'gregtech:gt.metaitem.01@2896' /* raw rubber dust */, 'IC2:itemHarz@0' /* sticky resin */, 'minecraft:slime_ball@0', 'IC2:itemDust@2' /* coal dust */,
  'gregtech:gt.metaitem.01@2535' /* coal dust */, 'gregtech:gt.metaitem.01@2010' /* carbon dust */, 'gregtech:gt.metaitem.01@2536' /* charcoal dust */,
  // plastics and the chemistry behind them: oil, and the fluids pumped where a source is in reach
  'gregtech:gt.metaitem.01@11470' /* epoxid bar */, 'gregtech:gt.metaitem.01@11473' /* PTFE bar */, 'fluid:liquid_medium_oil' /* raw oil */,
  'fluid:saltwater', 'fluid:helium', 'fluid:sulfuricacid',
  // silicon and gallium arsenide (wafers, diodes)
  'gregtech:gt.metaitem.01@2856' /* Poly-Si dust */, 'gregtech:gt.metaitem.01@2980' /* GaAs dust */, 'gregtech:gt.metaitem.01@2037' /* gallium */,
  'gregtech:gt.metaitem.01@2039' /* arsenic */, 'gregtech:gt.metaitem.01@2021' /* phosphorus */,
]);
/** Maps of machines no group has before UMV, or that make metals out of free lava. */
const NEVER_HERE: readonly string[] = [
  'gt.recipe.eyeofharmony', 'gt.recipe.fog_molten', 'kubatech.htgrrecipes', 'gt.recipe.pcbfactory', 'gt.recipe.thermalboiler',
  'gt.recipe.fishpond', 'gt.recipe.algae_pond', 'gg.recipe.extreme_heat_exchanger',
];
const PLAN_SECONDS = 5;
/** HV lines with an avoid list or at 0 % step charge may take this long (controller ruling 187). */
const HV_SLOW_PLAN_SECONDS = 8;
/**
 * Step caps re-measured at the 2 % default step charge with supporting lines (ruling P14; the old caps came from plans of
 * the old rules, fix spec §2's from its 5 % prototype without supporting lines): measured + 5.
 */
const EC_MV_MAX_STEPS = 41;    // 36 steps
const GEC_HV_MAX_STEPS = 56;   // 51 steps
const STEEL_MV_MAX_STEPS = 14; // 9 steps at default settings, the cast iron made from ore too

const perMinute = (plan: Plan, key: string): number => 60 * (plan.rawInputs.find((r) => r.key === key)?.perSecond ?? 0);

/**
 * Whether the plan's flows run Sand ← a forge hammer ← Gravel ← a forge hammer ← Cobblestone ← the rock breaker's supply
 * step (plan 12, D1: sand made from free cobblestone): a `gt.recipe.hammer` step making Sand takes Gravel from a
 * `gt.recipe.hammer` step that takes Cobblestone from the step supplying it (`PlanStep.supply`).
 */
function sandFromBreaker(plan: Plan): boolean {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  /** The steps that send `key` into step `id`. */
  const feeding = (id: string, key: string): PlanStep[] => plan.flows.filter((f) => f.to === id && f.key === key).flatMap((f) => byId.get(f.from) ?? []);
  return plan.steps.some((sand) => sand.mapId === FORGE_HAMMER_MAP && sand.outputs.some((o) => o.key === SAND)
    && feeding(sand.id, GRAVEL).some((gravel) => gravel.mapId === FORGE_HAMMER_MAP
      && feeding(gravel.id, COBBLESTONE).some((breaker) => breaker.supply === COBBLESTONE)));
}
/** What the line's steps take of `key` a minute, bought or made in the line. */
const takenPerMinute = (plan: Plan, key: string): number =>
  60 * plan.steps.reduce((sum, s) => sum + s.inputs.filter((i) => i.key === key).reduce((a, i) => a + i.amount, 0) * s.runsPerSecond, 0);

/**
 * The outputs of `step` the line has from it alone and takes in full (fix spec D13): no other step makes them, the line
 * buys none, they are no free input or empty container (`empties`), and the steps take all `step` makes of them. Such
 * an output sets how much the step runs, so the step is named after one, never after a good another step makes too.
 */
function soleTakenOutputs(plan: Plan, step: PlanStep, empties: ReadonlySet<string>): string[] {
  const bought = new Set(plan.rawInputs.map((r) => r.key));
  return [...new Set(step.outputs.map((o) => o.key))].filter((key) => {
    if (bought.has(key) || FREE_KEYS.includes(key) || empties.has(key)) return false;
    if (plan.steps.some((s) => s.id !== step.id && s.outputs.some((o) => o.key === key))) return false;
    const net = (step.outputs.filter((o) => o.key === key).reduce((a, o) => a + o.amount, 0)
      - step.inputs.filter((i) => i.key === key).reduce((a, i) => a + i.amount, 0)) * step.runsPerSecond;
    const taken = plan.flows.filter((f) => f.from === step.id && f.key === key && f.to !== 'sink').reduce((a, f) => a + f.perSecond, 0);
    return net > 0 && taken >= net * (1 - 1e-6);
  });
}

/** The checks every plan of this file must pass; `alsoRaw` are further raw inputs the target itself is made of. */
function expectSane(plan: Plan, seconds: number, maxSteps: number, alsoRaw: readonly string[] = []): void {
  const codes = plan.warnings.map((w) => w.code);
  expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
  expect(codes).not.toContain('graph-too-big');
  expect(codes).not.toContain('free-loop');
  expect(seconds).toBeLessThan(PLAN_SECONDS);
  expect(plan.steps.length).toBeGreaterThan(0);
  expect(plan.steps.length).toBeLessThanOrEqual(maxSteps);
  expect(plan.rawInputs.filter((r) => !r.available)).toEqual([]);
  expect(plan.rawInputs.map((r) => r.key).filter((key) => !ORDINARY.has(key) && !alsoRaw.includes(key))).toEqual([]);
  expect(perMinute(plan, 'fluid:lava')).toBe(0);
  expect(perMinute(plan, 'fluid:water')).toBeLessThan(3000);
  expect(plan.steps.map((s) => s.mapId).filter((m) => NEVER_HERE.includes(m))).toEqual([]);
  // Every step's swap list holds the recipe it runs (spec §3.9: swap a recipe, or keep the one in use).
  expect(plan.steps.filter((s) => !s.alternatives.some((a) => a.recipeId === s.recipeId)).map((s) => s.recipeId)).toEqual([]);
}

/** The build list's top-level lines as Plan 5 hands its layout parts to expandBomLines: key, amount, why and group. */
const topLines = (plan: Plan): BomLine[] =>
  plan.buildList.map(({ key, amount, why, group }) => ({ key, amount, why, ...(group === undefined ? {} : { group }) }));

describe.skipIf(process.env.GTNH_LOCAL !== '1')('planner acceptance on the real 2.9 export', () => {
  let pack: Pack;
  const plan = async (s: Partial<PlanSettings>): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const p = await planLine(pack, { ...defaultSettings(), per: 'min', ...s }, emptyContext());
    return { plan: p, seconds: (performance.now() - started) / 1000 };
  };
  /** expandBomLines breaks the plan's own top-level build lines down to the plan's totals (architecture §11.15). */
  const expectSameBreakdown = async (p: Plan, s: Partial<PlanSettings>): Promise<void> => {
    const expanded = await expandBomLines(pack, topLines(p), { ...defaultSettings(), per: 'min', ...s }, emptyContext());
    expect(expanded.totals).toEqual(p.buildTotals);
  };
  /** The recipes of the export that make a net amount of `key`, by id (a swap list's "ways", plan 09). */
  const makersOf = (key: string): string[] => {
    const ids = new Set<string>();
    for (const i of pack.producers.get(key) ?? []) {
      const r = pack.recipes[i];
      if (r === undefined || r.flags.fake === true) continue;
      let net = 0;
      for (const p of r.outputs) if (p.key === key) net += p.amount * p.chance;
      for (const ing of r.inputs) if (ing.consumed && ing.options.length === 1 && ing.options[0]?.key === key) net -= (ing.options[0]?.amount ?? 0) * ing.chance;
      if (net > 0) ids.add(r.id);
    }
    return [...ids].sort();
  };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 120_000);

  it(`plans 1 Electronic Circuit a minute at MV from ordinary materials, in under ${EC_MV_MAX_STEPS} steps and 5 s`, async () => {
    const settings = { target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, EC_MV_MAX_STEPS);
    await expectSameBreakdown(p, settings);
    // It adds up (fix spec R11): its Bricked Blast Furnace, run for its Ferrosilite beside bought copper, is named so (D13).
    expect(indexPlan(p).issues).toEqual([]);
    expect(p.rawInputs.some((r) => COPPER.includes(r.key))).toBe(true);
    expect(p.rawInputs.some((r) => SOLDER.includes(r.key))).toBe(true);
    // The last step makes the circuit in GT's circuit assembler: crafting a Programmed Circuit (any LV circuit) back into
    // an Electronic Circuit is skipped by default (exclusion category programmed-circuit-conversion).
    expect(p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT)?.mapId).toBe('gt.recipe.circuitassembler');
  }, 60_000);

  it('offers every option of the Electronic Circuit\'s solder and every way the export makes it, and plans the option the group pins', async () => {
    // Controller rulings of plan 09 ("we should be able to select the other recipes"): every option of a slot stays
    // available, and the swap list shows all ways to make the step's product, the ones the group cannot use greyed with why.
    const settings = { target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 };
    const { plan: p, seconds } = await plan(settings);
    expect(p.status, JSON.stringify(p.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
    const ec = p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT);
    expect(ec?.recipeId).toBe(EC_CIRCUIT_ASSEMBLER);
    const solder = ec?.options?.find((o) => o.slot === SOLDER_SLOT);
    expect(solder?.choices.map((c) => c.key)).toEqual(expect.arrayContaining(['fluid:molten.solderingalloy', 'fluid:molten.tin', 'fluid:molten.lead']));
    const ways = ec?.alternatives ?? [];
    expect(ways.map((a) => a.recipeId).sort()).toEqual(makersOf(ELECTRONIC_CIRCUIT));
    const usable = ways.filter((a) => a.unusable === undefined);
    expect(usable.map((a) => a.recipeId)).toContain(EC_CIRCUIT_ASSEMBLER);
    expect(ways.slice(0, usable.length)).toEqual(usable);   // usable first, then the greyed ones
    for (const a of ways.slice(usable.length)) {
      expect(a.unusable?.length, a.recipeId).toBeGreaterThan(0);
      for (const reason of a.unusable ?? []) expect(reason, a.recipeId).toMatch(/^(needs |excluded: )/);
    }
    expect(ec?.ways).toEqual({ total: ways.length, usable: usable.length });
    // Pinning Molten Tin plans tin, and no soldering alloy.
    const tin = await plan({ ...settings, optionChoice: { [`${EC_CIRCUIT_ASSEMBLER}#${SOLDER_SLOT}`]: 'fluid:molten.tin' } });
    expect(tin.plan.status, JSON.stringify(tin.plan.warnings)).toBe('ok');
    expect(tin.seconds).toBeLessThan(PLAN_SECONDS);
    expect(tin.plan.steps.find((s) => s.recipeId === EC_CIRCUIT_ASSEMBLER)?.options?.find((o) => o.slot === SOLDER_SLOT)?.pinned).toBe('fluid:molten.tin');
    expect(tin.plan.steps.some((s) => s.mainOutput === 'fluid:molten.tin')).toBe(true);
    expect(tin.plan.steps.filter((s) => s.mainOutput !== undefined && SOLDERING_ALLOY.includes(s.mainOutput)).map((s) => s.id)).toEqual([]);
  }, 60_000);

  it('says what melts a molten metal whose dust or ingot the group gets, never the places of its ore, at LV, MV and HV', async () => {
    // Review of the plan 09 follow-ups (2cd200b): at default settings 17 molten fluids at LV, 6 at MV and 1 at HV whose ore
    // is out of reach but whose metal the group gets another way named places in swap lists and options: at LV an Antimony
    // Ingot's fluid solidifier read "needs Mars (T2 rocket) or Phobos (T2 rocket) or Mercury (T4 rocket) or 15 more",
    // though Antimony Dust is a byproduct of the Nether's stibnite ore and only the extractor that melts it needs MV. Each
    // now names the tier at which a plan of the same settings gets it: Niobium, Palladium, Poly-Si, Tantalum, Vanadium and
    // Yttrium dust melt from HV (smelted into ingots there; no Alloy Blast Smelter before IV). Runite, a 25th, has its
    // dust only as its material's ore part.
    const cases: ReadonlyArray<[number, Record<string, string>]> = [
      [1, {
        antimony: 'MV', arsenic: 'MV', barium: 'MV', chrome: 'MV', cobalt: 'MV', electrum: 'MV', magnesium: 'MV', manganese: 'MV', platinum: 'MV',
        silicon: 'MV', uranium: 'MV', niobium: 'HV', palladium: 'HV', siliconsolargrade: 'HV', tantalum: 'HV', vanadium: 'HV', yttrium: 'HV',
      }],
      [2, { niobium: 'HV', palladium: 'HV', siliconsolargrade: 'HV', tantalum: 'HV', vanadium: 'HV', yttrium: 'HV' }],
      [3, { tungsten: 'EV', runite: 'ZPM' }],
    ];
    // The dusts and ingots of each material: its GT items of those prefixes, and its ore parts.
    const metals = new Map<string, string[]>();
    const add = (material: string, key: string | undefined): void => {
      if (key !== undefined) metals.set(material, [...(metals.get(material) ?? []), key]);
    };
    for (const item of pack.items.values()) if (item.gt?.prefix === 'dust' || item.gt?.prefix === 'ingot') add(item.gt.material, item.key);
    for (const [name, m] of pack.materials) for (const key of [m.parts?.dust, m.parts?.ingot]) add(name, key);
    for (const [tier, needs] of cases) {
      const settings = { ...defaultSettings(), tier };
      const obtainable = obtainableIn(pack, planBasis(pack, settings, emptyContext()), settings);
      for (const [id, need] of Object.entries(needs)) expect(obtainable.why(`fluid:molten.${id}`), id).toBe(`needs ${need} (your tier is ${tierName(tier)})`);
      // Every molten fluid the group cannot get whose metal it gets: a tier, or nothing to say, never places.
      for (const key of pack.fluids.keys()) {
        const material = moltenMaterial(pack, key);
        if (material === undefined || obtainable.has(key) || !(metals.get(material) ?? []).some((k) => obtainable.has(k))) continue;
        expect(obtainable.why(key) ?? 'nothing', key).toMatch(/^(needs \w+ \(your tier is \w+\)|nothing)$/);
      }
    }
    // Where nothing reachable makes the metal, the nearest places still say where it is found.
    const lv = { ...defaultSettings(), tier: 1 };
    expect(obtainableIn(pack, planBasis(pack, lv, emptyContext()), lv).why('fluid:molten.titanium')).toMatch(/^needs Mars \(T2 rocket\) or [^,]+ or \d+ more$/);
    // As a plan's swap list shows it.
    const { plan: p } = await plan({ target: ANTIMONY_INGOT, amount: 1, tier: 1 });
    expect(p.status, JSON.stringify(p.warnings)).toBe('ok');
    const ways = p.steps.find((s) => s.mainOutput === ANTIMONY_INGOT)?.alternatives ?? [];
    const cast = ways.filter((a) => (a.inputs ?? []).some((i) => i.key === 'fluid:molten.antimony'));
    expect(cast.map((a) => [a.mapId, a.unusable])).toEqual([['gt.recipe.fluidsolidifier', ['needs MV (your tier is LV)']]]);
  }, 120_000);

  it(`plans 2 Good Electronic Circuits a minute at HV from ordinary materials, build cost ignored, in under ${GEC_HV_MAX_STEPS} steps and 5 s`, async () => {
    // With build cost counted the line crafts its Good Circuit Board from gold wire on an Auto Workbench rather than etch
    // it in a chemical reactor with Iron III Chloride, in about half the steps (real-build-cost.test.ts plans that).
    const settings = { target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, buildHorizonHours: null };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, GEC_HV_MAX_STEPS);
    await expectSameBreakdown(p, settings);
    // It adds up but for one good (fix spec R11, D13). The reactor that alone makes its Iron III Chloride and the sodalite
    // electrolyzer that alone makes its Raw Silicon Dust are named so, not after the Hydrogen Cells and Chlorine other
    // steps make too ("Hydrogen Cell is made 3 ways", "Chlorine is made 2 ways" before the final review), and no good is
    // made two ways by a step that runs for an output it alone makes. Measured left: Hydrogen Cell, from the water
    // electrolysis (97 % of it; it throws away 90 % of the Oxygen it alone makes) and the salt water electrolysis.
    const issues = indexPlan(p).issues;
    expect(issues.filter((i) => i.code !== 'multi-producer')).toEqual([]);
    expect(issues.length).toBeLessThanOrEqual(1);
    const empties = emptyContainers(pack);
    for (const issue of issues) {
      for (const id of issue.stepIds ?? []) {
        const maker = p.steps.find((s) => s.id === id) as PlanStep;
        expect(soleTakenOutputs(p, maker, empties), `${pack.nameOf(issue.key)} made by ${id}`).toEqual([]);
      }
    }
    for (const key of [IRON_III_CHLORIDE, RAW_SILICON_DUST]) {
      const makers = p.steps.filter((s) => s.outputs.some((o) => o.key === key));
      expect(makers.length, key).toBeGreaterThan(0);
      expect(makers.map((s) => s.mainOutput), key).toEqual(makers.map(() => key));
    }
    expect(p.steps.find((s) => s.mainOutput === GOOD_ELECTRONIC_CIRCUIT)?.mapId).toBe('gt.recipe.circuitassembler');
    expect(perMinute(p, 'minecraft:gold_ingot@0') + perMinute(p, 'gregtech:gt.metaitem.01@2086')).toBeGreaterThan(0);   // the board's gold foil
  }, 60_000);

  it("follows GTNH's own Electronic Circuit recipe when the group pins it: red alloy, vacuum tubes from sand glass, steel", async () => {
    const { plan: p, seconds } = await plan({ target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2, recipeChoice: { [ELECTRONIC_CIRCUIT]: EC_CIRCUIT_ASSEMBLER } });
    expectSane(p, seconds, 40);
    expect(indexPlan(p).issues).toEqual([]);
    expect(p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT)?.recipeId).toBe(EC_CIRCUIT_ASSEMBLER);
    // Its red alloy and steel come from supporting lines now (routeDerived on): what the line takes, bought or made.
    expect(takenPerMinute(p, RED_ALLOY_INGOT)).toBeCloseTo(1, 6);   // 2 × 1x red alloy wire = 1 ingot
    expect(takenPerMinute(p, STEEL_INGOT)).toBeGreaterThan(0);      // steel rods of the vacuum tubes
    // The glass tubes' glass comes from sand: gathered, or bought as glass dust, or (plan 12, D1) made on a forge hammer
    // from gravel that a forge hammer makes from the rock breaker's cobblestone, as the plan's flows say; cobblestone is
    // never bought (fix spec §7.2).
    expect(perMinute(p, SAND) + perMinute(p, GLASS_DUST) > 0 || sandFromBreaker(p)).toBe(true);
    expect(perMinute(p, COBBLESTONE)).toBe(0);
  }, 60_000);

  it('plans an LV Machine Hull at LV on LV machines: 8 steel plates, tin cable', async () => {
    const settings = { target: LV_MACHINE_HULL, amount: 1, tier: 1 };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, 12);
    await expectSameBreakdown(p, settings);
    expect(p.steps.every((s) => s.machine.tier <= 1)).toBe(true);
    // The casing's 8 steel plates, bent from steel its steel line makes (supporting lines on), and the hull's tin cables.
    const casing = p.steps.find((s) => s.mainOutput === LV_MACHINE_CASING);
    expect(casing?.inputs.filter((i) => i.key === STEEL_PLATE).reduce((n, i) => n + i.amount, 0)).toBe(8);
    expect(takenPerMinute(p, STEEL_PLATE)).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11057')).toBeGreaterThan(0);
  }, 60_000);

  it('makes steel at MV in one Electric Blast Furnace step from a base material, its oxygen from free air', async () => {
    // Bought Cast Iron Dust, a material made from others, so supporting lines off (fix spec §7.2, as for the Annealed
    // Copper test below; with them the line also makes the cast iron from iron ore). Steel Dust (made only from steel:
    // macerated ingots, magnetic or electrical steel) is no way to make steel; the least raw material is then the blast
    // furnace's cast iron recipe (1 Cast Iron Dust + 1,000 L Oxygen per ingot, against 1 Iron Dust + 1 Coal Dust + 1,000 L
    // Oxygen), Cast Iron Dust being iron nuggets smelted into cast iron. Its oxygen is made, never bought (fix spec R5):
    // the supply steps.
    const { plan: p, seconds } = await plan({ target: STEEL_INGOT, amount: 10, tier: 2, routeDerived: false });
    expectSane(p, seconds, 5, ['gregtech:gt.metaitem.01@2304' /* cast iron dust */]);
    expect(p.steps.map((s) => s.machine.name)).toContain('Electric Blast Furnace');
    expect(p.rawInputs.map((r) => r.key)).not.toContain('gregtech:gt.metaitem.01@2305' /* steel dust */);
    expect(p.rawInputs.map((r) => r.key)).not.toContain('fluid:oxygen');
    // At default settings the steel still comes from the Electric Blast Furnace, its cast iron made from ore as well.
    const routed = await plan({ target: STEEL_INGOT, amount: 10, tier: 2 });
    expect(routed.plan.status, JSON.stringify(routed.plan.warnings)).toBe('ok');
    expect(routed.seconds).toBeLessThan(PLAN_SECONDS);
    expect(routed.plan.steps.map((s) => s.machine.name)).toContain('Electric Blast Furnace');
    expect(routed.plan.steps.length).toBeLessThanOrEqual(STEEL_MV_MAX_STEPS);
  }, 60_000);

  it('makes aluminium, an EBF-only metal, at HV in one EBF step from mined dust, build cost ignored; at LV it says MV unlocks it', async () => {
    // With build cost counted the line may take the nitrogen recipe that needs fewer furnaces, with the steps that make
    // its nitrogen (real-build-cost.test.ts plans that).
    const hv = await plan({ target: ALUMINIUM_INGOT, amount: 10, tier: 3, buildHorizonHours: null });
    expectSane(hv.plan, hv.seconds, 1, ['gregtech:gt.metaitem.01@2019']);
    expect(hv.plan.steps[0]?.machine.name).toBe('Electric Blast Furnace');
    expect(hv.plan.rawInputs).toMatchObject([{ key: 'gregtech:gt.metaitem.01@2019', leafClass: 'direct' }]);
    const lv = await plan({ target: ALUMINIUM_INGOT, amount: 10, tier: 1 });
    expect(lv.plan.status).toBe('infeasible');
    expect(lv.plan.unlocks.length).toBeGreaterThan(0);
    expect(lv.plan.unlocks.every((u) => u.text.includes('MV'))).toBe(true);
  }, 60_000);

  it('builds only the multiblocks the tier can make: EBF from LV, Large Chemical Reactor from HV, never the Eye of Harmony', () => {
    const built = (tier: number): ReadonlySet<number> => planBasis(pack, { ...defaultSettings(), tier }, emptyContext()).env.multiblocks ?? new Set();
    const [ebf, lcr, eoh] = [1000, 1169, 15410];
    expect(built(1).has(ebf)).toBe(true);
    expect(built(2).has(lcr)).toBe(false);
    expect(built(3).has(lcr)).toBe(true);
    expect([1, 2, 3, 4].some((tier) => built(tier).has(eoh))).toBe(false);
  }, 60_000);

  it('gives the same Electronic Circuit plan twice', async () => {
    const a = (await plan({ target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 })).plan;
    const b = (await plan({ target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 })).plan;
    expect(b.steps).toEqual(a.steps);
    expect(b.rawInputs).toEqual(a.rawInputs);
  }, 60_000);

  it('plans an Advanced Circuit a minute at HV on "Least raw material", build cost ignored, at the least raw material', async () => {
    // Fix spec §7.3: the 0 % preset took 13 s here before the Task 4 review gave it a root-node MIP held at the least.
    // With build cost counted the line may use more raw material to build fewer machines (real-build-cost.test.ts).
    const { plan: p, seconds } = await plan({ target: ADVANCED_CIRCUIT, amount: 1, tier: 3, stepCharge: 0, buildHorizonHours: null });
    expect(p.status, JSON.stringify(p.warnings)).toBe('ok');
    expect(seconds).toBeLessThan(HV_SLOW_PLAN_SECONDS);
    const raw = p.rawCost as NonNullable<Plan['rawCost']>;
    expect(Math.abs(raw.perSecond - raw.leastPerSecond)).toBeLessThanOrEqual(1e-6 * raw.leastPerSecond);
    const codes = p.warnings.map((w) => w.code);
    expect(codes).not.toContain('simplify-skipped');
    expect(codes).not.toContain('numerics');
  }, 60_000);

  // Materials to avoid (plan 2026-10-18-08, ruling R15): no expectSane, as the way round a material may need goods
  // outside ORDINARY.
  /**
   * Every good the avoid list matches is out of the line, or flagged as unavoidable at each step it goes into; within
   * `limit` seconds (an HV line with an avoid list may take HV_SLOW_PLAN_SECONDS, controller ruling 187).
   */
  const expectAvoided = (p: Plan, seconds: number, avoid: string[], limit = PLAN_SECONDS): void => {
    const codes = p.warnings.map((w) => w.code);
    expect(p.status, JSON.stringify(p.warnings)).toBe('ok');
    expect(codes).not.toContain('graph-too-big');
    expect(codes).not.toContain('free-loop');
    expect(seconds).toBeLessThan(limit);
    const steps = new Set(p.steps.map((s) => s.id));
    const unavoidable = new Set((p.avoided ?? []).filter((a) => a.unavoidable).map((a) => a.key));
    const goods = resolveAvoid(pack, avoid).goods;
    for (const key of goods) {
      const into = new Set(p.flows.filter((f) => f.key === key && steps.has(f.to)).map((f) => f.to));
      if (into.size === 0 && !p.rawInputs.some((r) => r.key === key)) continue;
      expect(unavoidable.has(key), key).toBe(true);
      for (const stepId of into) expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'avoid-unavoidable', key, stepId }));
    }
    // Final review: a part a machine holds counts (a one-off of a matched good is flagged where it is needed), and so
    // does a derived material bought although it is made from a matched good (`avoided` lists it with `madeFrom`).
    for (const line of p.buildList.filter((l) => l.group === 'one-off' && goods.has(l.key))) {
      expect(unavoidable.has(line.key), line.key).toBe(true);
      expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'avoid-unavoidable', key: line.key }));
    }
    for (const a of p.avoided ?? []) if (p.rawInputs.some((r) => r.key === a.key)) expect(a.unavoidable, a.key).toBe(true);
  };

  it('keeps Silver out of 2 Good Electronic Circuits a minute at HV, or flags each use, in under 5 s', async () => {
    const avoid = ['Silver'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid, HV_SLOW_PLAN_SECONDS);
  }, 60_000);

  it('plans 2 Good Electronic Circuits a minute at HV around Gold, which the plain plan uses, or flags each use, in under 5 s', async () => {
    const avoid = ['Gold'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid, HV_SLOW_PLAN_SECONDS);
    expect(p.avoided?.length).toBeGreaterThan(0);   // the board's gold foil: the restricted plan really ran
  }, 60_000);

  // The final review's probes on this export: a lens or catalyst a machine holds, and a derived material made from an
  // avoided one, used to be kept in the line with nothing said.
  it('keeps the Diamond Lens out of the laser engraver of a Microprocessor at HV: the slot holds another lens it takes', async () => {
    const avoid = ['Diamond'];
    const { plan: p, seconds } = await plan({ target: MICROPROCESSOR, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid, HV_SLOW_PLAN_SECONDS);
    expect(p.avoided).toContainEqual({ key: DIAMOND_LENS, name: 'Diamond Lens', unavoidable: false });
    expect(p.buildList.filter((l) => l.group === 'one-off').map((l) => l.key)).not.toContain(DIAMOND_LENS);
    expect(p.buildList.some((l) => l.group === 'one-off' && pack.items.get(l.key)?.gt?.prefix === 'lens')).toBe(true);
  }, 60_000);

  it("keeps the Large Chemical Reactor's Calcite catalyst out of 2 Good Electronic Circuits a minute at HV", async () => {
    // Plan 08 wrote this before there was a step charge, so it plans at the least raw material ("Least raw material", 0 %,
    // fix spec R3): there the plain line makes its acetone in the only recipe of the 2.9 export that holds Calcite (from
    // acetic acid, 480 EU/t). At the 2 % default (and at 5 %) the plain line makes no acetone and holds no Calcite, so
    // there would be nothing to keep out.
    const avoid = ['Calcite'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid, stepCharge: 0 });
    expectAvoided(p, seconds, avoid, HV_SLOW_PLAN_SECONDS);
    expect(p.avoided?.map((a) => a.key)).toContain(CALCITE_DUST);   // the plain plan's catalyst
  }, 60_000);

  it('never buys Magnetic Steel for an LV Machine Hull avoiding Steel: the steel it is polarized from is flagged instead', async () => {
    const avoid = ['Steel'];
    const { plan: p, seconds } = await plan({ target: LV_MACHINE_HULL, amount: 1, tier: 1, avoid });
    expectAvoided(p, seconds, avoid);
    expect(p.rawInputs.map((r) => r.key)).not.toContain(MAGNETIC_STEEL_INGOT);
    expect(p.avoided).toContainEqual({ key: STEEL_INGOT, name: 'Steel Ingot', unavoidable: true });
  }, 60_000);

  it('flags the Annealed Copper that 2 Good Electronic Circuits a minute at HV still buy when avoiding Copper, naming the copper', async () => {
    // A bought derived material, so supporting lines off (fix spec §7.2).
    const avoid = ['Copper'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid, routeDerived: false });
    expectAvoided(p, seconds, avoid, HV_SLOW_PLAN_SECONDS);
    const annealed = p.avoided?.find((a) => a.key === ANNEALED_COPPER_INGOT);
    expect(annealed?.madeFrom?.length).toBeGreaterThan(0);   // made by an arc furnace from copper dust
    const flags = p.warnings.filter((w) => w.code === 'avoid-unavoidable' && w.key === ANNEALED_COPPER_INGOT);
    if (p.rawInputs.some((r) => r.key === ANNEALED_COPPER_INGOT)) expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((w) => w.text.includes('Annealed Copper Ingot (made from '))).toBe(true);
  }, 60_000);
});
