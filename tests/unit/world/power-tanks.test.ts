// tests/unit/world/power-tanks.test.ts — plan 10 Task 1 (Global Constraints, rulings R1–R7): steam reaches steam
// turbines through tanks (Railcraft tank parts, GT super and quantum tanks, other tile entities holding steam) and from
// multiblock boilers' output hatches, and a power network whose turbines no steam producer reaches says so. Each world
// is a synthetic one-chunk world (make-world.ts) run through the whole scan job in-process, so the chunk pass, the
// classifiers, the steam graph and the scan notes are all exercised. Blocks are left unfilled: only tile entities count.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyTank } from '../../../src/server/world/classify/tanks.ts';
import type { FactMachine, ScanPackFacts } from '../../../src/server/world/facts.ts';
import type { RawTe, Vec3 } from '../../../src/server/world/model.ts';
import { runScanJob } from '../../../src/server/world/scan.worker.ts';
import { gtMachineId } from '../../../src/shared/ids.ts';
import { itemKey } from '../../../src/shared/keys.ts';
import type { WorldScan } from '../../../src/shared/types/world.ts';
import { makeWorld } from '../../helpers/make-world.ts';
import { comp, int, list, parseTag, str, type Tag } from '../../helpers/nbt-write.ts';
import { testFacts } from '../../helpers/world-facts.ts';
import { gtMachine, gtPipe, te } from '../../helpers/world-tes.ts';

const DOWN = 1 << 0, N = 1 << 2, S = 1 << 3, W = 1 << 4, E = 1 << 5;
const HP_BOILER = 114, LV_TURBINE = 1120, LV_BUFFER = 161, TIN_CABLE = 1246, BRONZE_PIPE = 5120, SUPER_TANK = 130, EBF = 1000, MACERATOR = 2001;
/** Stub rows added to `testFacts()` by `tankFacts` (ruling R6), and a steam turbine row without a tier. */
const LARGE_STEEL_BOILER = 15530, OUTPUT_HATCH_LV = 61, UNTIERED_TURBINE = 1199;
const ONE_UNFED = '1 steam turbine gets no steam the scan can follow';

function row(mteId: number, metaName: string, name: string, kind: FactMachine['kind'], cls: string, extra: Partial<FactMachine> = {}): FactMachine {
  return { id: gtMachineId(mteId), mteId, metaName, name, cls, itemKey: itemKey('gregtech:gt.blockmachines', mteId), kind, maps: [], ...extra };
}

/**
 * `testFacts()` plus a Large Steel Boiler stub making `steamPerSecondMax` L/s (no rate when null; the default 770 is
 * half an LV turbine's 1,540 L/s, so the turbine it feeds sends exactly 16 EU/t), an LV output hatch, and a steam
 * turbine the export gives no tier.
 */
function tankFacts(steamPerSecondMax: number | null = 770): ScanPackFacts {
  const facts = testFacts();
  facts.machines.set(LARGE_STEEL_BOILER, row(LARGE_STEEL_BOILER, 'multimachine.boiler.steel', 'Large Steel Boiler', 'multiblock',
    'gregtech.common.tileentities.machines.multi.MTELargeBoilerSteel', steamPerSecondMax === null ? {} : { steamPerSecondMax }));
  facts.machines.set(OUTPUT_HATCH_LV, row(OUTPUT_HATCH_LV, 'hatch.output.tier.01', 'Output Hatch (LV)', 'hatch',
    'gregtech.api.metatileentity.implementations.MTEHatchOutput', { tier: 1, voltage: 32 }));
  facts.machines.set(UNTIERED_TURBINE, row(UNTIERED_TURBINE, 'basicgenerator.steamturbine.test', 'Steam Turbine Without A Tier', 'turbine',
    'gregtech.common.tileentities.generators.MTESteamTurbine'));
  return facts;
}

let tmp: string;
let scans = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-power-tanks-')); });
afterAll(() => rm(tmp, { recursive: true, force: true }));

/** The scan job, in-process, over a world whose one chunk (0, 0) holds `tes`, read as an upload's files folder. */
async function scanOf(tes: Tag[], facts: ScanPackFacts = tankFacts()): Promise<WorldScan> {
  const n = ++scans;
  const { worldDir } = await makeWorld(join(tmp, `world-${n}`), { dims: { 0: [{ cx: 0, cz: 0, inhabitedTime: 72_000, tileEntities: tes }] } });
  return runScanJob({
    scanId: `20261018T120000Z-${n.toString(16).padStart(6, '0')}`, scanDir: join(tmp, 'scans', `scan-${n}`),
    source: { kind: 'dir', path: worldDir, label: 'test world' }, request: { kind: 'upload', uploadId: 'f'.repeat(32) }, serverDir: null, facts,
  }, () => {});
}

const fluidPipe = (pos: Vec3, connections: number): Tag => gtPipe({ pos, mID: BRONZE_PIPE, connections, kind: 'fluid' });
const tinCable = (pos: Vec3, connections: number): Tag => gtPipe({ pos, mID: TIN_CABLE, connections, kind: 'cable' });
/** A Railcraft tank part; the scan reads only its TE id, whatever it holds (ruling R4). */
const railcraft = (id: string, pos: Vec3): Tag => te(id, pos, {});
/** Another mod's one-block tank holding `fluid` in a Forge FluidStack. */
const modTank = (pos: Vec3, fluid: string): Tag => te('TileIronTank', pos, { tank: comp({ FluidName: str(fluid), Amount: int(16_000) }) });
/** An LV steam turbine at `pos` with its front on side `facing`, a tin cable in front of it and an LV battery buffer beyond (all along `facing`). */
function turbineToBuffer(pos: Vec3, facing: 3 | 5): Tag[] {
  const along = (d: number): Vec3 => (facing === 5 ? [pos[0] + d, pos[1], pos[2]] : [pos[0], pos[1], pos[2] + d]);
  return [
    gtMachine({ pos, mID: LV_TURBINE, facing }), tinCable(along(1), facing === 5 ? W | E : N | S), gtMachine({ pos: along(2), mID: LV_BUFFER, facing }),
  ];
}

/**
 * Two clean HP solar boilers at (1,64,0) and (1,64,2) fronting onto the bronze pipe at (1,64,1) → pipes to (3,64,1) →
 * one Railcraft tank of two parts at (4,64,1) and (5,64,1) → pipes at x 6–8 (`tankToTurbine: false` leaves out the one
 * at x 6) → LV steam turbine (9,64,1) facing east → tin cable → LV battery buffer (11,64,1).
 */
function boilersTankTurbine(tankToTurbine: boolean): Tag[] {
  return [
    gtMachine({ pos: [1, 64, 0], mID: HP_BOILER, facing: 3 }), gtMachine({ pos: [1, 64, 2], mID: HP_BOILER, facing: 2 }),
    fluidPipe([1, 64, 1], N | S | E), fluidPipe([2, 64, 1], W | E), fluidPipe([3, 64, 1], W | E),
    railcraft('RCIronTankValveTile', [4, 64, 1]), railcraft('RCIronTankWallTile', [5, 64, 1]),
    ...(tankToTurbine ? [fluidPipe([6, 64, 1], W | E)] : []), fluidPipe([7, 64, 1], W | E), fluidPipe([8, 64, 1], W | E),
    ...turbineToBuffer([9, 64, 1], 5),
  ];
}

describe('steam through tanks', () => {
  it('boilers → pipes → a Railcraft tank → pipes → an LV turbine: the turbine gets both boilers’ steam (ruling R1)', async () => {
    const scan = await scanOf(boilersTankTurbine(true));
    expect(scan.power.map((n) => n.id)).toEqual(['p:0:9:64:1']);
    const gen = scan.power[0]!.generatorEUt;
    expect(gen.clear).toBeCloseTo(14.074, 3);   // turbineEUt(1, 2 × 360 × 22,577/24,000): 677.3 of the turbine's 1,540 L/s
    expect(gen.rain).toBe(0);
    expect(gen.average).toBeCloseTo(12.889, 3);
    expect(scan.warnings).toEqual([]);
  });

  it('without the pipe from the tank towards the turbine: 0 EU/t and a note for the network (ruling R2)', async () => {
    const scan = await scanOf(boilersTankTurbine(false));
    expect(scan.power.map((n) => [n.id, n.generatorEUt])).toEqual([['p:0:9:64:1', { clear: 0, rain: 0, average: 0 }]]);
    expect(scan.warnings).toEqual([ONE_UNFED]);
  });

  it('a tank shared by two pipe systems merges their steam, but not the two cable networks behind the turbines', async () => {
    // 4 clean HP boilers at (x,64,0) → pipes (x,64,1) → a Railcraft tank at (4,64,1..3); from its part at (4,64,2) a pipe
    // east to turbine 1 at (6,64,2), from its part at (4,64,3) pipes south to turbine 2 at (4,64,6); each turbine has its own cable and buffer
    const boilers = [0, 1, 2, 3].flatMap((x) => [gtMachine({ pos: [x, 64, 0], mID: HP_BOILER, facing: 3 }), fluidPipe([x, 64, 1], N | (x > 0 ? W : 0) | E)]);
    const scan = await scanOf([
      ...boilers, railcraft('RCSteelTankWallTile', [4, 64, 1]), railcraft('RCSteelTankGaugeTile', [4, 64, 2]), railcraft('RCSteelTankValveTile', [4, 64, 3]),
      fluidPipe([5, 64, 2], W | E), ...turbineToBuffer([6, 64, 2], 5),
      fluidPipe([4, 64, 4], N | S), fluidPipe([4, 64, 5], N | S), ...turbineToBuffer([4, 64, 6], 3),
    ]);
    expect(scan.power.map((n) => n.id)).toEqual(['p:0:4:64:6', 'p:0:6:64:2']);
    for (const n of scan.power) expect(n.generatorEUt.clear, n.id).toBeCloseTo(14.074, 3);   // 4 boilers' steam shared by 2 LV turbines
    expect(scan.warnings).toEqual([]);
  });

  it.each([
    // a clean HP boiler (0,64,10) fronting onto a Railcraft part (1,64,10), whose other face the turbine at (2,64,10) touches
    ['a turbine touching a tank part takes its steam', [
      gtMachine({ pos: [0, 64, 10], mID: HP_BOILER, facing: 5 }), railcraft('RCIronTankWallTile', [1, 64, 10]),
      ...turbineToBuffer([2, 64, 10], 5)], 7.037, []],
    // Railcraft parts at (1,64,12) and (2,65,12) share only an edge: two tanks
    ['Railcraft parts that touch only at an edge are two tanks', [
      gtMachine({ pos: [0, 64, 12], mID: HP_BOILER, facing: 5 }), railcraft('RCIronTankWallTile', [1, 64, 12]), railcraft('RCIronTankValveTile', [2, 65, 12]),
      fluidPipe([3, 65, 12], W | E), ...turbineToBuffer([4, 65, 12], 5)], 0, [ONE_UNFED]],
    // one-block tanks of steam side by side at (1,64,14) and (2,64,14) do not pass steam to each other (ruling R5)
    ['one-block tanks side by side are two tanks', [
      gtMachine({ pos: [0, 64, 14], mID: HP_BOILER, facing: 5 }), modTank([1, 64, 14], 'steam'), modTank([2, 64, 14], 'steam'),
      ...turbineToBuffer([3, 64, 14], 5)], 0, [ONE_UNFED]],
  ] satisfies Array<[string, Tag[], number, string[]]>)('%s', async (_name, tes, clear, warnings) => {
    const scan = await scanOf(tes);
    expect(scan.power).toHaveLength(1);
    expect(scan.power[0]!.generatorEUt.clear).toBeCloseTo(clear, 3);
    expect(scan.warnings).toEqual(warnings);
  });

  it('a GT super tank and another mod’s tank holding steam pass it on; a tank of water does not (rulings R4, R5)', async () => {
    // a clean HP boiler (0,64,4) facing east → pipe → GT Super Tank I (2,64,4) → pipe → another mod's tank (4,64,4) → pipe → LV turbine (6,64,4)
    const line = (fluid: string): Tag[] => [
      gtMachine({ pos: [0, 64, 4], mID: HP_BOILER, facing: 5 }), fluidPipe([1, 64, 4], W | E), gtMachine({ pos: [2, 64, 4], mID: SUPER_TANK }),
      fluidPipe([3, 64, 4], W | E), modTank([4, 64, 4], fluid), fluidPipe([5, 64, 4], W | E), ...turbineToBuffer([6, 64, 4], 5),
    ];
    for (const fluid of ['steam', 'ic2steam']) {
      const scan = await scanOf(line(fluid));
      expect(scan.power[0]!.generatorEUt.clear, fluid).toBeCloseTo(7.037, 3);   // one clean HP boiler
      expect(scan.warnings, fluid).toEqual([]);
    }
    const water = await scanOf(line('water'));
    expect([water.power[0]!.generatorEUt.clear, water.warnings]).toEqual([0, [ONE_UNFED]]);
  });
});

describe('multiblock steam producers', () => {
  /**
   * The Large Steel Boiler stub's controller at (2,64,8) and its LV output hatch at (2,66,9) facing up → bronze pipes at
   * (2,67,9) and (3,67,9) → LV turbine (4,67,9) facing east → tin cable → LV battery buffer (6,67,9).
   */
  const largeBoilerLine: Tag[] = [
    gtMachine({ pos: [2, 64, 8], mID: LARGE_STEEL_BOILER, facing: 2 }), gtMachine({ pos: [2, 66, 9], mID: OUTPUT_HATCH_LV, facing: 1 }),
    fluidPipe([2, 67, 9], DOWN | E), fluidPipe([3, 67, 9], W | E), ...turbineToBuffer([4, 67, 9], 5),
  ];

  it('a Large Steel Boiler feeds a turbine through its output hatch and pipes, the same in rain (ruling R6)', async () => {
    const scan = await scanOf(largeBoilerLine);
    expect(scan.power.map((n) => [n.id, n.generatorEUt, n.solarShare])).toEqual([['p:0:4:67:9', { clear: 16, rain: 16, average: 16 }, 0]]);
    expect(scan.warnings).toEqual([]);
  });

  it('one whose rate the export does not give adds no steam and is an unknown boiler, not an unfed turbine (rulings R6, R7)', async () => {
    const scan = await scanOf(largeBoilerLine, tankFacts(null));
    expect(scan.power[0]!.generatorEUt).toEqual({ clear: 0, rain: 0, average: 0 });
    expect(scan.warnings).toEqual(['1 boiler with unknown steam output']);
  });

  it('an output hatch nearer to another multiblock controller is that one’s, so it carries no boiler steam (ruling R6)', async () => {
    // controller (0,64,0); output hatch (5,65,0) facing up, 5 blocks from it and 1 from an EBF at (6,64,0) → pipes → LV turbine (7,66,0)
    const line: Tag[] = [
      gtMachine({ pos: [0, 64, 0], mID: LARGE_STEEL_BOILER }), gtMachine({ pos: [5, 65, 0], mID: OUTPUT_HATCH_LV, facing: 1 }),
      fluidPipe([5, 66, 0], DOWN | E), fluidPipe([6, 66, 0], W | E), ...turbineToBuffer([7, 66, 0], 5),
    ];
    const withEbf = await scanOf([...line, gtMachine({ pos: [6, 64, 0], mID: EBF })]);
    expect([withEbf.power[0]!.generatorEUt.clear, withEbf.warnings]).toEqual([0, [ONE_UNFED]]);
    expect((await scanOf(line)).power[0]!.generatorEUt.clear).toBe(16);   // without the EBF the hatch is the boiler's
  });
});

describe('notes for turbines no steam reaches', () => {
  it('one per power network in network order, counting only turbines of a known tier that are in a network (rulings R2, R7)', async () => {
    const scan = await scanOf([
      // network p:0:0:64:0: LV turbines at (0,64,0) and (2,64,0) both fronting onto an LV battery buffer between them
      gtMachine({ pos: [0, 64, 0], mID: LV_TURBINE, facing: 5 }), gtMachine({ pos: [1, 64, 0], mID: LV_BUFFER }),
      gtMachine({ pos: [2, 64, 0], mID: LV_TURBINE, facing: 4 }),
      // network p:0:0:64:5: an LV turbine → tin cable → LV macerator, and a turbine without a tier fronting onto the macerator
      gtMachine({ pos: [0, 64, 5], mID: LV_TURBINE, facing: 5 }), tinCable([1, 64, 5], W | E), gtMachine({ pos: [2, 64, 5], mID: MACERATOR }),
      gtMachine({ pos: [2, 64, 6], mID: UNTIERED_TURBINE, facing: 2 }),
      // an LV turbine whose front touches nothing: in no network
      gtMachine({ pos: [0, 64, 10], mID: LV_TURBINE, facing: 5 }),
    ]);
    expect(scan.power.map((n) => [n.id, n.generatorEUt.clear])).toEqual([['p:0:0:64:0', 0], ['p:0:0:64:5', 0]]);
    expect(scan.warnings).toEqual(['2 steam turbines get no steam the scan can follow', ONE_UNFED]);
  });
});

/** A TE as the chunk pass hands it over: dim 0, the compound's own id and position. */
function raw(t: Tag): RawTe {
  const nbt = parseTag(t);
  const { id, x, y, z } = nbt;
  if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') throw new TypeError('not a TE compound');
  return { dim: 0, id, x, y, z, nbt };
}

describe('classifyTank', () => {
  const P: Vec3 = [-3, 70, 21];

  it('takes every Railcraft iron and steel tank part by its TE id, whatever it holds, but not the wooden water tank (ruling R4)', () => {
    const ids = ['RCIronTankWallTile', 'RCIronTankGaugeTile', 'RCIronTankValveTile', 'RCSteelTankWallTile', 'RCSteelTankGaugeTile', 'RCSteelTankValveTile'];
    expect(ids.map((id) => classifyTank(raw(te(id, P, {}))))).toEqual(ids.map(() => ({ dim: 0, pos: P, kind: 'railcraft' })));
    expect(classifyTank(raw(te('RCWaterTankTile', P, { tank: comp({ FluidName: str('water'), Amount: int(400_000) }) })))).toBeNull();
  });

  it('takes any other tile entity holding steam or IC2 steam as a tank of its own (ruling R5)', () => {
    const holding = (fluid: string): Tag => te('TileTank', P, { tanks: list('compound', [comp({ FluidName: str(fluid), Amount: int(1000) })]) });
    const single = { dim: 0, pos: P, kind: 'single' };
    expect(['steam', 'ic2steam', 'water'].map((f) => classifyTank(raw(holding(f))))).toEqual([single, single, null]);
    expect(classifyTank(raw(te('Furnace', P, { steam: int(5) })))).toBeNull();   // a key named steam is no steam
  });
});
