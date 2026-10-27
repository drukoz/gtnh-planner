import { describe, it, expect } from 'vitest';
import { choosePowerNetwork, chooseLogisticsNetwork, nearestTap, choosePowerTap, powerHookup, logisticsHookup, ghostBlocks, hookupPath, tapCableAmps } from '../../../src/server/layout/hookups.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makeScan, flatVoxels, IDS, STONE } from '../../helpers/layout-fixtures.ts';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { LayoutTap } from '../../../src/shared/types/layout.ts';

const tap = (pos: Vec3, over: Partial<LayoutTap> = {}): LayoutTap => ({ pos, dim: 0, kind: 'power', voltageTier: 1, freeAmps: 4, networkId: 'p:0:0', ...over });
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
// the tap is a 4x Tin Cable (4 A, enough for the 2 A line) unless a test gives another cable
const vox = (wall: Array<{ from: Vec3; to: Vec3; block: typeof STONE }> = [], tapCable: number = IDS.TIN_4X) => flatVoxels({ origin: [-4, 60, -4], size: [30, 12, 20], groundY: 63,
  boxes: [{ from: [0, 64, 0], to: [0, 64, 0], block: GT(tapCable) }, ...wall] });
const lineAt = (x0: number, x1: number, z0: number, z1: number) => {
  const s = new Set<string>();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) s.add(posKey([x, 64, z]));
  return s;
};
const power = (w = vox(), freeAmps = 4, cableAmps?: number) =>
  powerHookup({ pack: layoutPack(), tap: tap([0, 64, 0], { freeAmps, ...(cableAmps === undefined ? {} : { cableAmps }) }), ports: [[11, 64, 0]],
    world: { vox: w, line: lineAt(11, 14, 0, 3) }, supplyTier: 1, amps: 2 });

describe('network and tap choice', () => {
  it('prefers a network at or above the line tier, then the most spare power', () => {
    const scan = makeScan({ power: [
      { voltageTier: 1, average: 300, loadEUt: 200, taps: [{ pos: [0, 64, 0], freeAmps: 3 }] },
      { voltageTier: 2, average: 200, loadEUt: 150, taps: [{ pos: [5, 64, 0], freeAmps: 1 }] },
    ] });
    expect(choosePowerNetwork(scan, scan.bases[0]!, 2)!.voltageTier).toBe(2);
    expect(choosePowerNetwork(scan, scan.bases[0]!, 1)!.voltageTier).toBe(1);
    const none = makeScan();
    expect(choosePowerNetwork(none, none.bases[0]!, 1)).toBeNull();
    const logi = makeScan({ logistics: [{ kind: 'ae2', taps: [[1, 64, 1]] }, { kind: 'routed', taps: [[2, 64, 2]] }, { kind: 'gtpipe', taps: [[3, 64, 3]] }] });
    expect(chooseLogisticsNetwork(logi, logi.bases[0]!, 'direct')!.kind).toBe('routed');
    expect(chooseLogisticsNetwork(logi, logi.bases[0]!, 'ae2')!.kind).toBe('ae2');
    expect(nearestTap([tap([0, 64, 0]), tap([9, 64, 9])], [8, 64, 8])!.pos).toEqual([9, 64, 9]);
  });

  it('direct mode picks the EnderIO network when no routed or AE2 network exists', () => {
    const eio = makeScan({ logistics: [{ kind: 'gtpipe', taps: [[3, 64, 3]] }, { kind: 'enderio', taps: [[1, 64, 1]] }] });
    expect(chooseLogisticsNetwork(eio, eio.bases[0]!, 'direct')!.kind).toBe('enderio');
    const gt = makeScan({ logistics: [{ kind: 'gtpipe', taps: [[3, 64, 3]] }] });
    expect(chooseLogisticsNetwork(gt, gt.bases[0]!, 'direct')).toBeNull();
  });
});

describe('hookups', () => {
  it('runs the power cable from the tap to the line and reports its loss', () => {
    const r = power();
    expect(r.found).toBe(true);
    expect(r.hookup.path).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, 64, 0]));
    expect(r.hookup.parts).toEqual([{ key: 'gregtech:gt.blockmachines@1247', amount: 10, why: 'power hookup', group: 'power' }]);
    expect(r.blocked).toBeNull();
    expect(r.blocks.map((b) => [b.role, b.block.mteId, b.connections])).toEqual(Array(10).fill(['cable', IDS.TIN_2X, 16 | 32]));
    expect([r.lossEUt, r.arrivingVolts]).toEqual([20, 22]);
    expect(r.warnings).toEqual([{ code: 'cable_loss_high', text: 'The power run loses 31% over 10 blocks of 2x Tin Cable — move the line closer to the tap or use a better cable' }]);
  });

  it('prices the parallel runs the amps need, matching the warning', () => {
    // no LV cable carries 9 A: 4x Tin Cable (4 A) needs 3 parallel runs over the 10-block route
    const r = powerHookup({ pack: layoutPack(), tap: tap([0, 64, 0], { freeAmps: 12, cableAmps: 9 }), ports: [[11, 64, 0]],
      world: { vox: vox(), line: lineAt(11, 14, 0, 3) }, supplyTier: 1, amps: 9 });
    expect(r.hookup.parts).toEqual([{ key: 'gregtech:gt.blockmachines@1248', amount: 30, why: 'power hookup (3 parallel)', group: 'power' }]);
    expect(r.warnings).toContainEqual({ code: 'cable_amps', text: 'No cable carries 9 A at LV: run 3 parallel 4x Tin Cable lines' });
  });

  it('walks around a wall', () => {
    const r = power(vox([{ from: [5, 60, -4], to: [5, 71, 3], block: STONE }]));
    expect(r.found).toBe(true);
    expect(r.hookup.path).toHaveLength(18);
    expect(r.hookup.path.some((p) => p[0] === 5 && p[2] >= 4)).toBe(true);
  });

  it('falls back to a straight dashed guide when no route exists', () => {
    const r = power(vox([{ from: [5, 60, -4], to: [5, 71, 15], block: STONE }]));
    expect([r.found, r.hookup.found]).toEqual([false, false]);
    expect(r.hookup.path).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, 64, 0]));
    expect(r.warnings).toContainEqual({ code: 'no_path', text: 'Could not find a free route for the power hookup — the dashed line is a straight guide; route it around obstacles' });
  });

  it('never lays a hookup onto a tap whose cable carries fewer amps than the line draws', () => {
    // the rating of the tap's own cable decides (its block in the voxels, or a rating the tap carries); spare
    // generation does not (final review: Plan 4 floors free amps to whole amps of spare power)
    const small = vox([], IDS.TIN_1X);
    const r = power(small, 1);
    expect([r.blocks, r.hookup.parts]).toEqual([[], []]);
    expect(r.hookup.path).toHaveLength(10);                         // still drawn, dashed
    expect(r.warnings).toContainEqual({ code: 'power_amps_low', text: "The tap's 1x Tin Cable carries 1 A at LV; the line draws up to 2 A" });
    expect(r.blocked).toEqual({ cable: '1x Tin Cable', amps: 2 });   // Task 10 turns this into the upgrade step
    expect(power(small, 4).blocks).toEqual([]);                      // free amps never make the cable bigger
    expect(power(vox(), 0).blocked).toBeNull();                      // a 4x Tin Cable carries the line with no spare: the power fit says so
    expect(power(small, 1, 4).blocked).toBeNull();                   // a rating the tap carries wins over the block
    expect([tapCableAmps(layoutPack(), small, tap([0, 64, 0])), tapCableAmps(layoutPack(), null, tap([0, 64, 0]))]).toEqual([1, undefined]);
    const unknown = powerHookup({ pack: layoutPack(), tap: tap([0, 64, 0], { freeAmps: 1 }), ports: [[11, 64, 0]], world: { vox: null, line: lineAt(11, 14, 0, 3) },
      supplyTier: 1, amps: 2 });                                     // no voxels, no rating: the free amps stand in (ruling R9)
    expect(unknown.warnings).toContainEqual({ code: 'power_amps_low', text: "The tap has 1 A free at LV and its cable's rating is unknown; the line draws up to 2 A" });
    const shortOnPower = power(vox(), 1, 4);                         // the cable carries 4 A; only generation is short
    expect([shortOnPower.blocks.length, shortOnPower.blocked]).toEqual([10, null]);
    expect(shortOnPower.warnings.map((w) => w.code)).not.toContain('power_amps_low');
    expect(choosePowerTap([tap([1, 64, 1], { freeAmps: 1, cableAmps: 1 }), tap([9, 64, 9], { freeAmps: 4 })], [0, 64, 0], 2)!.pos).toEqual([9, 64, 9]);
    expect(choosePowerTap([tap([1, 64, 1], { freeAmps: 1, cableAmps: 1 }), tap([9, 64, 9], { freeAmps: 0, cableAmps: 4 })], [0, 64, 0], 2)!.pos).toEqual([9, 64, 9]);
  });

  it('ends a routed hookup with an interface pipe facing the chest', () => {
    const pack = layoutPack();
    const r = logisticsHookup({ pack, parts: resolveParts(pack), tap: tap([0, 64, 0], { kind: 'routed', networkId: 'routed:0:0' }),
      ports: [[7, 64, 0]], world: { vox: vox(), line: lineAt(7, 9, 0, 2) }, part: 'pr_junction', end: 'pr_interface' });
    expect(r.hookup.path).toHaveLength(6);
    expect(r.blocks.map((b) => [b.role, b.label])).toEqual([...Array(5).fill(['pipe', 'Routed Junction Pipe']), ['chip_pipe', 'Routed Interface Pipe']]);
    expect(r.blocks.at(-1)!.facing).toBe(5);
    expect(r.hookup.parts).toEqual([
      { key: 'ProjRed|Transportation:projectred.transportation.pipe@1', amount: 5, why: 'logistics hookup', group: 'logistics' },
      { key: 'ProjRed|Transportation:projectred.transportation.pipe@2', amount: 1, why: 'logistics hookup', group: 'logistics' }]);
    const keeper = logisticsHookup({ pack, parts: resolveParts(pack), tap: tap([0, 64, 0], { kind: 'routed', networkId: 'routed:0:0' }),
      ports: [[7, 64, 0]], world: { vox: vox(), line: lineAt(7, 9, 0, 2) }, part: 'pr_junction', end: 'pr_interface', endConfig: { chips: 'Item Stock Keeper Chip' } });
    expect(keeper.blocks.at(-1)!.config).toEqual({ chips: 'Item Stock Keeper Chip' });
  });

  it('shows the existing block at the tap as a ghost', () => {
    expect(ghostBlocks(vox([], IDS.TIN_1X), layoutPack(), [[0, 64, 0], [3, 64, 3]], new Set())).toEqual([
      { pos: [0, 64, 0], block: GT(IDS.TIN_1X), role: 'ghost', label: 'existing 1x Tin Cable' }]);
    expect(ghostBlocks(null, layoutPack(), [[0, 64, 0]], new Set())).toEqual([]);
  });

  // final review C1: a guide that would cross the line goes round it, ends level beside the run, and its cables link
  // only to each other, the tap and the run (never into a cell the hookup does not lay)
  it('goes round the line when it cannot route, ending beside the run', () => {
    const line = lineAt(11, 14, 0, 3);
    const box = { min: [11, 64, 0] as Vec3, max: [14, 64, 3] as Vec3 };
    const ports: Vec3[] = [[11, 64, 0], [11, 64, 1], [11, 64, 2], [11, 64, 3]];
    const r = powerHookup({ pack: layoutPack(), tap: tap([20, 64, 1], { cableAmps: 4 }), ports, world: { vox: null, line, box }, supplyTier: 1, amps: 2 });
    const inColumns = (p: Vec3) => p[0] >= 11 && p[0] <= 14 && p[2] >= 0 && p[2] <= 3;
    expect([r.found, r.hookup.path.some(inColumns)]).toEqual([false, false]);
    const last = r.hookup.path.at(-1)!;
    expect(last[1]).toBe(64);                                        // level with the run, not under or over it
    expect(ports.some((p) => DIRS.some((_, side) => posKey(step(last, side)) === posKey(p)))).toBe(true);
    const laid = new Set(r.blocks.map((b) => posKey(b.pos)));
    const allowed = new Set([...laid, posKey([20, 64, 1]), ...ports.map(posKey)]);
    for (const b of r.blocks) for (let side = 0; side < 6; side++) if ((b.connections ?? 0) & (1 << side)) expect(allowed.has(posKey(step(b.pos, side)))).toBe(true);
    expect(r.blocks).toHaveLength(r.hookup.path.length);
    expect(r.warnings).toContainEqual({ code: 'no_path', text: 'Could not find a free route for the power hookup — the dashed line is a straight guide; route it around obstacles' });
  });

  it('keeps away from the cells it must not touch', () => {
    const plain = hookupPath({ vox: vox(), line: lineAt(11, 14, 0, 3) }, [0, 64, 0], [[11, 64, 0]]);
    expect(plain.path).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, 64, 0]));
    // an LV cable of the base beside the straight route: the MV hookup must not run along it
    const away = hookupPath({ vox: vox(), line: lineAt(11, 14, 0, 3), keepAway: new Set([posKey([5, 64, 1])]) }, [0, 64, 0], [[11, 64, 0]]);
    expect(away.found).toBe(true);
    expect(away.path.some((p) => DIRS.some((_, side) => posKey(step(p, side)) === '5,64,1'))).toBe(false);
  });
});
