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
import { planBasis } from '../../../src/server/planner/basis.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
const LV_MACHINE_HULL = 'gregtech:gt.blockmachines@11';
const STEEL_INGOT = 'gregtech:gt.metaitem.01@11305';
const ALUMINIUM_INGOT = 'gregtech:gt.metaitem.01@11019';
/** The circuit assembler recipe of the Electronic Circuit: board, 2 resistors, 2 red alloy wires, 2 vacuum tubes, solder. */
const EC_CIRCUIT_ASSEMBLER = '9cbcefac6fe44dd1';

const COPPER = ['gregtech:gt.metaitem.01@11035', 'fluid:molten.copper', 'gregtech:gt.metaitem.01@11345' /* annealed */];
const SOLDER = ['gregtech:gt.metaitem.01@2314' /* soldering alloy dust */, 'gregtech:gt.metaitem.01@11057' /* tin ingot */, 'fluid:molten.tin'];

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
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('planner acceptance on the real 2.9 export', () => {
  let pack: Pack;
  const plan = async (s: Partial<PlanSettings>): Promise<{ plan: Plan; seconds: number }> => {
    const started = performance.now();
    const p = await planLine(pack, { ...defaultSettings(), per: 'min', ...s }, emptyContext());
    return { plan: p, seconds: (performance.now() - started) / 1000 };
  };

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 120_000);

  it('plans 1 Electronic Circuit a minute at MV from ordinary materials, in under 40 steps and 5 s', async () => {
    const { plan: p, seconds } = await plan({ target: ELECTRONIC_CIRCUIT, amount: 1, tier: 2 });
    expectSane(p, seconds, 40);
    expect(p.rawInputs.some((r) => COPPER.includes(r.key))).toBe(true);
    expect(p.rawInputs.some((r) => SOLDER.includes(r.key))).toBe(true);
    // The last step makes the circuit: GT's circuit assembler, or the programmed-circuit crafting that turns any LV
    // circuit back into an Electronic Circuit (the least raw material in 2.9: red alloy is 1 copper + 4 redstone).
    expect(p.steps.find((s) => s.mainOutput === ELECTRONIC_CIRCUIT)?.mapId).toMatch(/^(gt\.recipe\.circuitassembler|crafting)$/);
  }, 60_000);

  it('plans 2 Good Electronic Circuits a minute at HV from ordinary materials, in under 45 steps and 5 s', async () => {
    const { plan: p, seconds } = await plan({ target: GOOD_ELECTRONIC_CIRCUIT, amount: 2, tier: 3 });
    expectSane(p, seconds, 45);
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
    const { plan: p, seconds } = await plan({ target: LV_MACHINE_HULL, amount: 1, tier: 1 });
    expectSane(p, seconds, 12);
    expect(p.steps.every((s) => s.machine.tier <= 1)).toBe(true);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11305')).toBeCloseTo(8, 6);
    expect(perMinute(p, 'gregtech:gt.metaitem.01@11057')).toBeGreaterThan(0);
  }, 60_000);

  it('makes steel at MV in one Electric Blast Furnace step from a base material', async () => {
    const { plan: p, seconds } = await plan({ target: STEEL_INGOT, amount: 10, tier: 2 });
    expectSane(p, seconds, 2);
    expect(p.steps.map((s) => s.machine.name)).toContain('Electric Blast Furnace');
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
});
