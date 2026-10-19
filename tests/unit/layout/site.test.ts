import { describe, it, expect } from 'vitest';
import { findSite, fallbackSite, checkPlacement, siteSearchBox, baseFloorY, isReplaceable, type SiteRequest } from '../../../src/server/layout/site.ts';
import { flatVoxels, makeScan, STONE, WATER, LAVA } from '../../helpers/layout-fixtures.ts';
import type { Base } from '../../../src/shared/types/world.ts';
import type { Vec3 } from '../../../src/shared/layout/geometry.ts';

const AIR = { id: 'minecraft:air', meta: 0 };
const base = (c: Vec3): Base => ({ id: '0:0:0', dim: 0, name: 'B', center: c, machineCount: 0, topTier: 1,
  bbox: { minX: c[0] - 2, minY: 64, minZ: c[2] - 2, maxX: c[0] + 2, maxY: 65, maxZ: c[2] + 2 } });
const req = (over: Partial<SiteRequest> = {}): SiteRequest =>
  ({ dim: 0, footprint: { w: 4, h: 1, l: 3 }, base: base([10, 64, 10]), baseFloorY: 64, ports: {}, taps: {}, avoid: new Set(), ...over });
const world = (boxes: Parameters<typeof flatVoxels>[0]['boxes'] = [], groundY = 63) =>
  flatVoxels({ origin: [0, 56, 0], size: [40, 18, 40], groundY, boxes });

describe('site finder', () => {
  it('picks the flat spot nearest the base centre, keeping a free ring', () => {
    const site = findSite(req(), world([{ from: [10, 64, 10], to: [10, 66, 10], block: STONE }]));
    expect(site).toMatchObject({ origin: [5, 64, 9], rotation: 0, size: [4, 1, 3], dig: 0, fill: 0, reason: 'search', moved: false });
  });

  it('never builds on scanned blocks or GT machines', () => {
    const gt = world([{ from: [10, 64, 10], to: [10, 64, 10], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 } }]);
    expect(findSite(req(), gt)!.origin).toEqual([5, 64, 9]);
    const chest = world([{ from: [10, 64, 10], to: [10, 64, 10], block: { id: 'minecraft:chest', meta: 0 } }]);
    expect(findSite(req({ avoid: new Set(['10,64,10']) }), chest)!.origin).toEqual([5, 64, 9]);
  });

  it('treats water and lava as unbuildable', () => {
    const vox = world([
      { from: [0, 63, 0], to: [39, 63, 9], block: STONE },
      { from: [0, 63, 10], to: [39, 63, 24], block: WATER },
      { from: [0, 63, 25], to: [39, 63, 39], block: LAVA },
    ], 62);
    expect(findSite(req(), vox)).toMatchObject({ origin: [8, 64, 6], rotation: 0 });
  });

  it('turns the line so its power side faces the tap', () => {
    const site = findSite(req({ ports: { power: [-1, 0, 1] }, taps: { power: [0, 64, 10] } }), world());
    expect(site).toMatchObject({ origin: [8, 64, 9], rotation: 0, score: 7 });
  });

  it('falls back outside the base when nothing fits', () => {
    const lake = world([{ from: [0, 63, 0], to: [39, 63, 39], block: WATER }], 62);
    expect(findSite(req(), lake)).toBeNull();
    expect(fallbackSite(req(), lake)).toMatchObject({ origin: [14, 64, 9], rotation: 0, reason: 'fallback', unsupported: 12, blocked: 0 });
  });

  it('checks a user placement: counts what is in the way and clamps the height', () => {
    const vox = world([{ from: [6, 64, 9], to: [6, 64, 9], block: STONE }, { from: [7, 63, 10], to: [7, 63, 10], block: AIR }]);
    expect(checkPlacement(req(), vox, { origin: [5, 64, 9], rotation: 0 }))
      .toMatchObject({ origin: [5, 64, 9], size: [4, 1, 3], floorY: 63, dig: 1, fill: 1, blocked: 1, unsupported: 1, reason: 'placement', moved: false });
    expect(checkPlacement(req(), vox, { origin: [5, 300, 9], rotation: 90 })).toMatchObject({ origin: [5, 255, 9], size: [3, 1, 4], moved: true });
    expect(checkPlacement(req(), null, { origin: [5, -5, 9], rotation: 0 })).toMatchObject({ origin: [5, 1, 9], moved: true, blocked: 0 });
  });

  it('reads a bounded box around the base and its taps', () => {
    const b = base([10, 64, 10]);
    expect(siteSearchBox(b, 64, { w: 4, h: 1, l: 3 }, [[60, 64, 8]])).toEqual({ minX: -16, minY: 55, minZ: -16, maxX: 62, maxY: 73, maxZ: 36 });
    expect(siteSearchBox(b, 64, { w: 4, h: 1, l: 3 }, [[500, 64, 8]])).toMatchObject({ minX: -86, maxX: 105 });
    const scan = makeScan({ machines: [{ pos: [1, 64, 1], mteId: 2001 }, { pos: [2, 64, 1], mteId: 2001 }, { pos: [3, 65, 1], mteId: 2001 }] });
    expect(baseFloorY(scan, scan.bases[0]!)).toBe(64);
    expect(isReplaceable({ id: 'minecraft:tallgrass', meta: 1 })).toBe(true);
  });
});
