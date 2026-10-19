// Real-data acceptance of the planner (architecture §10): plans on the active export of this host (GT New Horizons
// 2.9.0-RC-1) and checks that the plans are ones a group could build. It runs only with GTNH_LOCAL=1 and is skipped
// everywhere else; nothing game-derived is read or written otherwise. The export is loaded once for the whole file.
//
// The keys below are the real 2.9 items and fluids. "Ordinary" is what GTNH's own LV–HV circuit and hull recipes run
// on: copper, tin, solder, iron/steel, red alloy, redstone alloy, glass (from cobblestone), wood pulp, rubber, coal,
// plastics (ethylene, polyethylene, epoxid), silicon, gallium arsenide, gold, tantalum, glue and the free basics.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { planBasis, resolveAvoid } from '../../../src/server/planner/basis.ts';
import { expandBomLines } from '../../../src/server/planner/bom.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { BomLine, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
const LV_MACHINE_HULL = 'gregtech:gt.blockmachines@11';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
const MICROPROCESSOR = 'gregtech:gt.metaitem.03@32078';
const DIAMOND_LENS = 'gregtech:gt.metaitem.01@24500';
const CALCITE_DUST = 'gregtech:gt.metaitem.01@2823';
const MAGNETIC_STEEL_INGOT = 'gregtech:gt.metaitem.01@11355';
const ANNEALED_COPPER_INGOT = 'gregtech:gt.metaitem.01@11345';
const ALUMINIUM_INGOT = 'gregtech:gt.metaitem.01@11019';
/**
 * The circuit assembler recipe of the Electronic Circuit: board, 2 resistors, 2 red alloy wires, 2 vacuum tubes, solder.
 * (Its id since the loader keeps recipe ids stable across re-exports, dcb0ce4; it was 9cbcefac6fe44dd1 before.)
 */
const EC_CIRCUIT_ASSEMBLER = 'c0106c4cb6b4b041';

const COPPER = ['gregtech:gt.metaitem.01@11035', 'fluid:molten.copper', 'gregtech:gt.metaitem.01@11345' /* annealed */];
const SOLDER = ['gregtech:gt.metaitem.01@2314' /* soldering alloy dust */, 'gregtech:gt.metaitem.01@11314' /* soldering alloy ingot */,
  'gregtech:gt.metaitem.01@11057' /* tin ingot */, 'fluid:molten.tin'];

/** Ordinary base materials of GTNH's LV–HV circuit, hull and casing lines, by key. */
const ORDINARY: ReadonlySet<string> = new Set([
  // free
  'fluid:water', 'fluid:air', 'minecraft:cobblestone@0',
  // metals and alloys
  ...COPPER, ...SOLDER,
  'gregtech:gt.metaitem.01@2032' /* iron dust */, 'gregtech:gt.metaitem.01@11032' /* iron ingot */, 'gregtech:gt.metaitem.01@11305' /* steel ingot */,
  'gregtech:gt.metaitem.01@2305' /* steel dust */, 'gregtech:gt.metaitem.01@11308' /* red alloy ingot */, 'gregtech:gt.metaitem.01@2308' /* red alloy dust */,
  'gregtech:gt.metaitem.01@11381' /* redstone alloy ingot */, 'minecraft:redstone@0', 'minecraft:gold_ingot@0', 'gregtech:gt.metaitem.01@2086' /* gold dust */,
  'gregtech:gt.metaitem.01@11080' /* tantalum ingot */, 'gregtech:gt.metaitem.01@11314' /* soldering alloy ingot */,
  // glass, wood, rubber, carbon
  'gregtech:gt.metaitem.01@2890' /* glass dust */, 'gregtech:gt.metaitem.01@2809' /* wood pulp */, 'gregtech:gt.metaitem.01@11880' /* rubber bar */,
  'gregtech:gt.metaitem.01@2896' /* raw rubber dust */, 'IC2:itemHarz@0' /* sticky resin */, 'minecraft:slime_ball@0', 'IC2:itemDust@2' /* coal dust */,
  'gregtech:gt.metaitem.01@2535' /* coal dust */, 'gregtech:gt.metaitem.01@2010' /* carbon dust */, 'gregtech:gt.metaitem.01@2536' /* charcoal dust */,
  // plastics and the chemistry behind them
  'fluid:ethylene', 'fluid:molten.polyethylene', 'gregtech:gt.metaitem.01@11470' /* epoxid bar */, 'gregtech:gt.metaitem.01@11473' /* PTFE bar */,
  'fluid:oxygen', 'fluid:nitrogen', 'fluid:hydrogen', 'fluid:carbondioxide', 'fluid:carbonmonoxide', 'fluid:ic2distilledwater', 'fluid:saltwater',
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

const perMinute = (plan: Plan, key: string): number => 60 * (plan.rawInputs.find((r) => r.key === key)?.perSecond ?? 0);

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

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 120_000);

  it('plans 1 Electronic Circuit a minute at MV from ordinary materials, in under 40 steps and 5 s', async () => {
    const settings = { target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, 40);
    await expectSameBreakdown(p, settings);
    expect(p.rawInputs.some((r) => COPPER.includes(r.key))).toBe(true);
    expect(p.rawInputs.some((r) => SOLDER.includes(r.key))).toBe(true);
    // The last step makes the circuit in GT's circuit assembler: crafting a Programmed Circuit (any LV circuit) back into
    // an Electronic Circuit is skipped by default (exclusion category programmed-circuit-conversion).
    expect(p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT)?.mapId).toBe('gt.recipe.circuitassembler');
  }, 60_000);

  it('plans 2 Good Electronic Circuits a minute at HV from ordinary materials, in under 45 steps and 5 s', async () => {
    const settings = { target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3 };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, 45);
    await expectSameBreakdown(p, settings);
    expect(p.steps.find((s) => s.mainOutput === GOOD_ELECTRONIC_CIRCUIT)?.mapId).toBe('gt.recipe.circuitassembler');
    expect(perMinute(p, 'minecraft:gold_ingot@0') + perMinute(p, 'gregtech:gt.metaitem.01@2086')).toBeGreaterThan(0);   // the board's gold foil
  }, 60_000);

  it("follows GTNH's own Electronic Circuit recipe when the group pins it: red alloy, vacuum tubes from cobblestone glass, steel", async () => {
    const { plan: p, seconds } = await plan({ target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2, recipeChoice: { [ELECTRONIC_CIRCUIT]: EC_CIRCUIT_ASSEMBLER } });
    expectSane(p, seconds, 40);
    expect(p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT)?.recipeId).toBe(EC_CIRCUIT_ASSEMBLER);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11308')).toBeCloseTo(1, 6);   // 2 × 1x red alloy wire = 1 ingot
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11305')).toBeGreaterThan(0);  // steel rods of the vacuum tubes
    expect(perMinute(p, 'minecraft:cobblestone@0')).toBeGreaterThan(0);        // → gravel → sand → glass tubes
  }, 60_000);

  it('plans an LV Machine Hull at LV on LV machines: 8 steel plates, tin cable, polyethylene', async () => {
    const settings = { target: LV_MACHINE_HULL, amount: 1, tier: 1 };
    const { plan: p, seconds } = await plan(settings);
    expectSane(p, seconds, 12);
    await expectSameBreakdown(p, settings);
    expect(p.steps.every((s) => s.machine.tier <= 1)).toBe(true);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11305')).toBeCloseTo(8, 6);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11057')).toBeGreaterThan(0);
  }, 60_000);

  it('makes steel at MV in one Electric Blast Furnace step from a base material', async () => {
    const { plan: p, seconds } = await plan({ target: STEEL_INGOT, amount: 10, tier: 2 });
    // Steel Dust (made only from steel: macerated ingots, magnetic or electrical steel) is no way to make steel; the
    // least raw material is then the blast furnace's cast iron recipe (1 Cast Iron Dust + 1,000 L Oxygen per ingot,
    // against 1 Iron Dust + 1 Coal Dust + 1,000 L Oxygen), Cast Iron Dust being iron nuggets smelted into cast iron.
    expectSane(p, seconds, 2, ['gregtech:gt.metaitem.01@2304' /* cast iron dust */]);
    expect(p.steps.map((s) => s.machine.name)).toContain('Electric Blast Furnace');
    expect(p.rawInputs.map((r) => r.key)).not.toContain('gregtech:gt.metaitem.01@2305' /* steel dust */);
  }, 60_000);

  it('makes aluminium, an EBF-only metal, at HV in one EBF step from mined dust; at LV it says MV unlocks it', async () => {
    const hv = await plan({ target: ALUMINIUM_INGOT, amount: 10, tier: 3 });
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

  // Materials to avoid (plan 2026-10-18-08, ruling R15): no expectSane, as the way round a material may need goods
  // outside ORDINARY.
  /** Every good the avoid list matches is out of the line, or flagged as unavoidable at each step it goes into. */
  const expectAvoided = (p: Plan, seconds: number, avoid: string[]): void => {
    const codes = p.warnings.map((w) => w.code);
    expect(p.status, JSON.stringify(p.warnings)).toBe('ok');
    expect(codes).not.toContain('graph-too-big');
    expect(codes).not.toContain('free-loop');
    expect(seconds).toBeLessThan(PLAN_SECONDS);
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
    expectAvoided(p, seconds, avoid);
  }, 60_000);

  it('plans 2 Good Electronic Circuits a minute at HV around Gold, which the plain plan uses, or flags each use, in under 5 s', async () => {
    const avoid = ['Gold'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid);
    expect(p.avoided?.length).toBeGreaterThan(0);   // the board's gold foil: the restricted plan really ran
  }, 60_000);

  // The final review's probes on this export: a lens or catalyst a machine holds, and a derived material made from an
  // avoided one, used to be kept in the line with nothing said.
  it('keeps the Diamond Lens out of the laser engraver of a Microprocessor at HV: the slot holds another lens it takes', async () => {
    const avoid = ['Diamond'];
    const { plan: p, seconds } = await plan({ target: MICROPROCESSOR, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid);
    expect(p.avoided).toContainEqual({ key: DIAMOND_LENS, name: 'Diamond Lens', unavoidable: false });
    expect(p.buildList.filter((l) => l.group === 'one-off').map((l) => l.key)).not.toContain(DIAMOND_LENS);
    expect(p.buildList.some((l) => l.group === 'one-off' && pack.items.get(l.key)?.gt?.prefix === 'lens')).toBe(true);
  }, 60_000);

  it("keeps the Large Chemical Reactor's Calcite catalyst out of 2 Good Electronic Circuits a minute at HV", async () => {
    const avoid = ['Calcite'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid);
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
    const avoid = ['Copper'];
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3, avoid });
    expectAvoided(p, seconds, avoid);
    const annealed = p.avoided?.find((a) => a.key === ANNEALED_COPPER_INGOT);
    expect(annealed?.madeFrom?.length).toBeGreaterThan(0);   // made by an arc furnace from copper dust
    const flags = p.warnings.filter((w) => w.code === 'avoid-unavoidable' && w.key === ANNEALED_COPPER_INGOT);
    if (p.rawInputs.some((r) => r.key === ANNEALED_COPPER_INGOT)) expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((w) => w.text.includes('Annealed Copper Ingot (made from '))).toBe(true);
  }, 60_000);
});
