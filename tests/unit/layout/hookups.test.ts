import { describe, it, expect } from 'vitest';
import { choosePowerNetwork, chooseLogisticsNetwork, nearestTap, choosePowerTap, powerHookup, logisticsHookup, ghostBlocks } from '../../../src/server/layout/hookups.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makeScan, flatVoxels, IDS, STONE } from '../../helpers/layout-fixtures.ts';
import { posKey, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { LayoutTap } from '../../../src/shared/types/layout.ts';

const tap = (pos: Vec3, over: Partial<LayoutTap> = {}): LayoutTap => ({ pos, dim: 0, kind: 'power', voltageTier: 1, freeAmps: 4, networkId: 'p:0:0', ...over });
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
const vox = (wall: Array<{ from: Vec3; to: Vec3; block: typeof STONE }> = []) => flatVoxels({ origin: [-4, 60, -4], size: [30, 12, 20], groundY: 63,
  boxes: [{ from: [0, 64, 0], to: [0, 64, 0], block: GT(IDS.TIN_1X) }, ...wall] });
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
    const r = power(vox(), 1, 1);
    expect([r.blocks, r.hookup.parts]).toEqual([[], []]);
    expect(r.hookup.path).toHaveLength(10);                         // still drawn, dashed
    expect(r.warnings).toContainEqual({ code: 'power_amps_low', text: 'The tap has 1 A free at LV; the line draws up to 2 A' });
    expect(r.blocked).toEqual({ cable: '1x Tin Cable', amps: 2 });   // Task 10 turns this into the upgrade step
    expect(power(vox(), 1).blocks).toEqual([]);                      // cable rating unknown: treated as the free amps
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
    expect(ghostBlocks(vox(), layoutPack(), [[0, 64, 0], [3, 64, 3]], new Set())).toEqual([
      { pos: [0, 64, 0], block: GT(IDS.TIN_1X), role: 'ghost', label: 'existing 1x Tin Cable' }]);
    expect(ghostBlocks(null, layoutPack(), [[0, 64, 0]], new Set())).toEqual([]);
  });
});
