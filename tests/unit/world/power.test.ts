// tests/unit/world/power.test.ts — m(mteId, pos, opts) and c(mteId, pos, bits, kind) build GtMachineRec / GtPipeRec via testFacts()
import { expect, it } from 'vitest';
import { voltageTier, type GtMachineRec, type GtPipeRec } from '../../../src/server/world/classify/gt.ts';
import { comparePos, majority, pickTaps, smallestPos, UnionFind } from '../../../src/server/world/graph.ts';
import { posKey, type Vec3 } from '../../../src/server/world/model.ts';
import {
  buildPower, RAIN_OUTAGE_FRACTION, RAIN_OUTAGE_SECONDS, SOLAR_BOILERS, solarBoilerOf, solarOutput, turbineEUt, turbineSteamForFull,
  type PowerInput,
} from '../../../src/server/world/power.ts';
import { testFacts } from '../../helpers/world-facts.ts';

const facts = testFacts();
const N = 1 << 2, S = 1 << 3, W = 1 << 4, E = 1 << 5;

/** A machine of the test table at `pos` in dim 0: idle, enabled, empty; boilers clean and hot. */
function m(mteId: number, pos: Vec3, opts: Partial<Omit<GtMachineRec, 'dim' | 'pos' | 'mteId'>>): GtMachineRec {
  const f = facts.machines.get(mteId);
  const kind = f?.kind ?? 'unknown';
  return {
    dim: 0, pos, mteId, facing: 0, color: 0, storedEU: 0, works: true,
    kind, tier: f?.tier ?? null, name: f?.name ?? null, cls: f?.cls ?? null,
    multiblock: kind === 'multiblock', recipeEUt: 0, running: false, inventory: [],
    ...(kind === 'boiler' ? { boiler: { runTime: 0, temperature: 500 } } : {}),
    ...opts,
  };
}

/** A GT pipe of the test table at `pos` in dim 0 with connection bits `bits`; cables carry the table's rating. */
function c(mteId: number, pos: Vec3, bits: number, kind: GtPipeRec['pipeKind']): GtPipeRec {
  const rating = kind === 'cable' ? facts.machines.get(mteId)?.cable : undefined;
  return {
    dim: 0, pos, mteId, connections: bits, pipeKind: kind, color: 0,
    ...(rating === undefined ? {} : { cable: { voltage: rating.voltage, amps: rating.amps, loss: rating.lossPerBlock } }),
    voltageTier: rating === undefined ? undefined : voltageTier(rating.voltage),
  };
}

/** `occupied` = any of the given records' positions; no bases unless `over` names them. */
function input(machines: GtMachineRec[], pipes: GtPipeRec[], over: Partial<PowerInput> = {}): PowerInput {
  const taken = new Set([...machines, ...pipes].map((r) => posKey(r.dim, ...r.pos)));
  return { machines, pipes, tanks: [], facts, baseOf: () => null, occupied: (dim, p) => taken.has(posKey(dim, ...p)), ...over };
}

/** HP solar boilers at (x, 64, −1) facing south onto a bronze fluid pipe line at (x, 64, 0), x = 0 … count − 1. */
function boilerLine(count: number, calcified: readonly number[] = []): { boilers: GtMachineRec[]; pipes: GtPipeRec[] } {
  const boilers: GtMachineRec[] = [], pipes: GtPipeRec[] = [];
  for (let x = 0; x < count; x++) {
    const runTime = calcified.includes(x) ? 1_440_000 : 0;
    boilers.push(m(114, [x, 64, -1], { facing: 3, boiler: { runTime, temperature: 500 } }));
    pipes.push(c(5120, [x, 64, 0], N | (x > 0 ? W : 0) | E, 'fluid'));
  }
  return { boilers, pipes };
}

// 3 clean + 1 calcified HP boilers → pipe line → LV turbine 1120 at (4,64,0) facing east → tin cable (5,64,0) → LV macerator (6,64,0)
const one = boilerLine(4, [3]);
const oneTurbine = buildPower(input([...one.boilers, m(1120, [4, 64, 0], { facing: 5 }), m(2001, [6, 64, 0], {})],
                                    [...one.pipes, c(1246, [5, 64, 0], W | E, 'cable')]));
// 10 clean HP boilers → pipe line whose last pipe (9,64,0) also points south → LV turbines at (10,64,0) facing south and (9,64,1)
// facing east, both fronting onto LV buffer 161 at (10,64,1)
const ten = boilerLine(10);
ten.pipes[9] = c(5120, [9, 64, 0], N | W | E | S, 'fluid');
const twoTurbines = buildPower(input([...ten.boilers, m(1120, [10, 64, 0], { facing: 3 }), m(1120, [9, 64, 1], { facing: 5 }), m(161, [10, 64, 1], { facing: 5 })],
                                     ten.pipes));

it('computes solar output with calcification (integer maths, never below min)', () => {
  const hp = SOLAR_BOILERS.MTEBoilerSolarSteel, lo = SOLAR_BOILERS.MTEBoilerSolar;
  expect([0, 1_080_000, 1_440_000, 1_800_000, 2_000_000].map((rt) => solarOutput(hp, rt))).toEqual([360, 360, 240, 120, 120]);
  expect(solarOutput(lo, 1_440_000)).toBe(80);
});
it('turbine steam and EU follow gt-mechanics §4.1', () => {
  expect(turbineSteamForFull(1)).toBe(1540);
  expect(turbineSteamForFull(2)).toBeCloseTo(6933.33, 2);
  expect(turbineSteamForFull(3)).toBe(30960);
  expect([turbineEUt(1, 1540), turbineEUt(1, 3000)]).toEqual([32, 32]);
  expect(turbineEUt(1, 360 * 22_577 / 24_000)).toBeCloseTo(7.037, 3);
});
it('one clean HP boiler → LV turbine → tin cable → LV machine', () => {
  const r = buildPower(input([m(114, [0, 64, 0], { facing: 5 }), m(1120, [1, 64, 0], { facing: 5 }), m(2001, [3, 64, 0], { running: true, recipeEUt: 2 })],
                             [c(1246, [2, 64, 0], 16 | 32, 'cable')]));
  expect(r.networks).toHaveLength(1);
  const n = r.networks[0]!;
  expect(n).toMatchObject({ id: 'p:0:1:64:0', voltageTier: 1, consumersMaxEUt: 32, loadEUt: 2, storedEU: 0, capacityEU: 0, solarShare: 1 });
  expect(n.generatorEUt.clear).toBeCloseTo(7.037, 3);
  expect(n.generatorEUt.rain).toBe(0);
  expect(n.generatorEUt.average).toBeCloseTo(6.444, 3);
  expect(n.taps).toEqual([{ pos: [2, 64, 0], dim: 0, kind: 'power', voltageTier: 1, freeAmps: 0, networkId: 'p:0:1:64:0' }]);   // the boiler is only in the steam graph
});
it('shares piped steam, counts calcified boilers and caps turbines at full output', () => {
  // 3 clean + 1 calcified (rt 1,440,000) HP boilers → fluid pipe line → one LV turbine
  expect(oneTurbine.networks[0]!.generatorEUt.clear).toBeCloseTo(25.802, 3);
  // 10 clean HP boilers → two LV turbines: supply 3,386.6 L/s ≥ demand 3,080 → both full, even on average
  expect(twoTurbines.networks[0]!.generatorEUt).toEqual({ clear: 64, rain: 0, average: 64 });
  expect([oneTurbine.networks.length, twoTurbines.networks.length, twoTurbines.networks[0]!.id]).toEqual([1, 1, 'p:0:9:64:1']);   // both turbines feed the buffer
});
it('sums buffer charge and capacity, known batteries only for capacity', () => {
  const buf = m(193, [0, 64, 0], { facing: 2, storedEU: 1000, batteries: [{ key: 'gregtech:gt.metaitem.01@32539', charge: 1_600_000 }, { key: 'x:unknown@0', charge: 10_000 }] });
  const n = buildPower(input([buf, m(2003, [0, 64, -1], {})], [])).networks[0]!;
  expect([n.storedEU, n.capacityEU, n.voltageTier]).toEqual([1_611_000, 512 * 64 * 16 + 1_600_000, 3]);
});
it("counts a buffer's own charge at most up to its 64 × V × slots, never its one-packet overshoot (plan 10, ruling R12)", () => {
  // 4×4 HV buffer 193 next to an HV machine, holding 205 EU more than its own 512 × 64 × 16 (gt-mechanics §4.3) and a
  // full Large Lithium Battery, whose charge always counts in full
  const own = 512 * 64 * 16, overshoot = 205, battery = 1_600_000;
  const buffer = (over: Partial<GtMachineRec> = {}) =>
    m(193, [0, 64, 0], { facing: 2, storedEU: own + overshoot, batteries: [{ key: 'gregtech:gt.metaitem.01@32539', charge: battery }], ...over });
  const network = (b: GtMachineRec, over: Partial<PowerInput> = {}) => buildPower(input([b, m(2003, [0, 64, -1], {})], [], over)).networks[0]!;
  const full = network(buffer());
  expect([full.storedEU, full.capacityEU]).toEqual([own + battery, own + battery]);
  // with 0 slots or no tier the buffer has no own capacity to cap at, so its charge counts as it is
  const noSlots = testFacts();
  noSlots.machines.set(193, { ...noSlots.machines.get(193)!, batterySlots: 0 });
  const zero = network(buffer(), { facts: noSlots }), untiered = network(buffer({ tier: null }));
  expect([zero.storedEU, zero.capacityEU]).toEqual([own + overshoot + battery, battery]);
  expect([untiered.storedEU, untiered.capacityEU]).toEqual([own + overshoot + battery, battery]);
});
it('counts a running multiblock once, at its nearest energy hatch', () => {
  const n = buildPower(input([m(1130, [0, 64, 0], { facing: 5 }), m(42, [1, 64, 0], {}), m(1000, [2, 63, 3], { running: true, recipeEUt: 120 })],
                             [])).networks[0]!;   // generator front touches the hatch directly
  expect([n.consumersMaxEUt, n.loadEUt, n.generatorEUt.clear]).toEqual([256, 120, 32]);
});
it('a step-up transformer outputs one tier higher on its front', () => {
  const r = buildPower(input([m(1130, [0, 64, 0], { facing: 5 }), m(21, [1, 64, 0], { facing: 5, works: false }), m(2002, [3, 64, 0], {})],
                             [c(1386, [2, 64, 0], 16 | 32, 'cable')]));
  expect([r.cableTier.get(posKey(0, 2, 64, 0)), r.networks[0]!.voltageTier, r.networks.length]).toEqual([2, 2, 1]);
});
it('finds solar boilers by class simple name; mteId 105/114 only without a class', () => {
  const HP = 'gregtech.common.tileentities.boilers.MTEBoilerSolarSteel';
  expect(solarBoilerOf({ mteId: 9114, cls: HP })).toBe(SOLAR_BOILERS.MTEBoilerSolarSteel);
  expect(solarBoilerOf({ mteId: 105, cls: null })).toBe(SOLAR_BOILERS.MTEBoilerSolar);
  expect(solarBoilerOf({ mteId: 114, cls: 'gregtech.common.tileentities.boilers.MTEBoilerBronze' })).toBeNull();
});
it('a boiler without steamPerSecondMax adds no steam (not 0 L/s, not NaN) and is counted as unknown', () => {
  // HP boiler 114 at (0,64,0) facing east and coal boiler 100 at (1,64,1) facing north both front onto fluid pipe 5120 at (1,64,0) (bits W|S|E),
  // which feeds LV turbine 1120 at (2,64,0) facing east → tin cable 1246 at (3,64,0) (W|E) → LV macerator 2001 at (4,64,0)
  const r = buildPower(input([m(114, [0, 64, 0], { facing: 5 }), m(100, [1, 64, 1], { facing: 2 }), m(1120, [2, 64, 0], { facing: 5 }), m(2001, [4, 64, 0], {})],
                             [c(5120, [1, 64, 0], 16 | 8 | 32, 'fluid'), c(1246, [3, 64, 0], 16 | 32, 'cable')]));
  expect(r.unknownBoilers).toBe(1);
  expect(Object.values(r.networks[0]!.generatorEUt).every(Number.isFinite)).toBe(true);
  expect(r.networks[0]!.generatorEUt.clear).toBeCloseTo(7.037, 3);   // the same as the HP boiler alone
});
it('returns no networks for a world without power', () => expect(buildPower(input([], [])).networks).toEqual([]));
it('rain outage constants', () => { expect(RAIN_OUTAGE_SECONDS).toBe(480); expect(RAIN_OUTAGE_FRACTION).toBeCloseTo(0.08422, 5); });

it('graph helpers: union-find groups, numeric position order, majority vote and one tap per 16-block cell', () => {
  const uf = new UnionFind();
  uf.union('a', 'b'); uf.union('c', 'd'); uf.union('b', 'd'); uf.find('e');
  expect([...uf.groups().values()].map((g) => [...g].sort())).toEqual([['a', 'b', 'c', 'd'], ['e']]);
  expect(uf.find('a')).toBe(uf.find('c'));
  expect(([[10, 0, 0], [9, 5, 5], [9, 5, -1]] as Vec3[]).sort(comparePos)).toEqual([[9, 5, -1], [9, 5, 5], [10, 0, 0]]);   // numbers, not strings
  expect(smallestPos([[2, 64, 0], [-1, 70, 3], [-1, 64, 9]])).toEqual([-1, 64, 9]);
  expect([majority(['b', null, 'a', 'b']), majority(['b', 'a', null]), majority([null, null]), majority([])]).toEqual(['b', 'a', null, null]);
  // x = −1 and x = 0 are different cells (floor division); (−16, …) shares the −1 cell with (−1, …)
  expect(pickTaps([[0, 64, 0], [-1, 64, 0], [-16, 64, 0], [15, 79, 15], [16, 64, 0]], 12)).toEqual([[-16, 64, 0], [0, 64, 0], [16, 64, 0]]);
  expect(pickTaps([[32, 0, 0], [0, 0, 0], [16, 0, 0]], 2)).toEqual([[0, 0, 0], [16, 0, 0]]);
});
