import { describe, expect, it } from 'vitest';
import { baseAt, findBases, INHABITED_KEEP_TICKS, LINK_CHUNKS, MIN_SEEDS, type BaseHints, type BaseSignal } from '../../../src/server/world/bases.ts';
import type { ChunkStat, Vec3 } from '../../../src/server/world/model.ts';
import { INHABITED_KEEP_TICKS as SHARED_KEEP_TICKS } from '../../../src/shared/world/chunk-summary.ts';
import { baseIdOf, findBase, type Base } from '../../../src/shared/types/world.ts';

/** A GT machine (seed and machine, no tier) unless `opts` says otherwise. */
const sig = (dim: number, pos: Vec3, opts: Partial<Omit<BaseSignal, 'dim' | 'pos'>> = {}): BaseSignal =>
  ({ dim, pos, seed: true, machine: true, tier: null, ...opts });
const stat = (dim: number, cx: number, cz: number, inhabitedTime: number): ChunkStat =>
  ({ dim, cx, cz, inhabitedTime, timestamp: 0, teCount: 0, oreTes: 0 });
const NO_HINTS: BaseHints = { claims: [], beds: [] };
const BASE: Base = { id: '0:0:0', dim: 0, name: 'Overworld base (0, 0)', bbox: { minX: 0, minY: 64, minZ: 0, maxX: 0, maxY: 64, maxZ: 0 },
  center: [0, 64, 0], machineCount: 1, topTier: 0 };

describe('constants', () => {
  it('links within 3 chunks, keeps 4 seeds, and keeps the chunks the smart upload keeps', () => {
    expect([LINK_CHUNKS, MIN_SEEDS, INHABITED_KEEP_TICKS]).toEqual([3, 4, 72_000]);
    expect(INHABITED_KEEP_TICKS).toBe(SHARED_KEEP_TICKS);
  });
});

describe('findBases', () => {
  it('clusters nearby machines into one base and ignores a lone dungeon chest', () => {
    const signals = [sig(0, [1, 64, 1], { tier: 1 }), sig(0, [2, 64, 2]), sig(0, [17, 65, 3], { tier: 3 }), sig(0, [18, 64, 4]),
      sig(0, [50, 70, 5]), sig(0, [51, 64, 6]), sig(0, [640, 30, 640], { seed: false, machine: false })];
    const bases = findBases(signals, [stat(0, 0, 0, 100), stat(0, 1, 0, 500_000), stat(0, 3, 0, 10)], NO_HINTS, () => 'Overworld');
    expect(bases).toEqual([{ id: '0:1:0', dim: 0, name: 'Overworld base (26, 3)', center: [26, 67, 3],
      bbox: { minX: 1, minY: 64, minZ: 1, maxX: 51, maxY: 70, maxZ: 6 }, machineCount: 6, topTier: 3 }]);
  });

  it('splits clusters more than 3 chunks apart', () => {
    const four = (cx: number) => [0, 1, 2, 3].map((i) => sig(0, [cx * 16 + i, 64, i]));
    const bases = findBases([...four(0), ...four(5)], [], NO_HINTS, () => 'Overworld');
    expect(bases.map((b) => [b.id, b.machineCount, b.bbox.minX, b.bbox.maxX])).toEqual([['0:0:0', 4, 0, 3], ['0:5:0', 4, 80, 83]]);
    // exactly 3 chunks apart (Chebyshev, here diagonally) still links
    expect(findBases([...four(0), sig(0, [3 * 16, 64, 3 * 16])], [], NO_HINTS, () => 'Overworld').map((b) => [b.id, b.machineCount]))
      .toEqual([['0:0:0', 5]]);
  });

  it('keeps a small cluster when claimed, inhabited or with a bed; drops it otherwise', () => {
    const one = (cx: number) => sig(0, [cx * 16 + 1, 64, 1]);
    const hints = { claims: [{ team: 'Alpha', dim: 0, cx: 20, cz: 0 }], beds: [{ dim: 0, x: 40 * 16 + 3, z: 2 }] };
    const names = findBases([one(20), one(30), one(40), one(60)], [stat(0, 30, 0, 80_000)], hints, () => 'Overworld').map((b) => b.name).sort();
    expect(names).toEqual(['Alpha base (321, 1)', 'Overworld base (481, 1)', 'Overworld base (641, 1)']);
  });

  it('drops a small cluster whose chunk was inhabited for less than an hour, and hints from another dimension', () => {
    const hints = { claims: [{ team: 'Alpha', dim: -1, cx: 0, cz: 0 }], beds: [{ dim: 7, x: 1, z: 1 }] };
    expect(findBases([sig(0, [1, 64, 1])], [stat(0, 0, 0, INHABITED_KEEP_TICKS - 1)], hints, () => 'Overworld')).toEqual([]);
    expect(findBases([sig(0, [1, 64, 1])], [stat(0, 0, 0, INHABITED_KEEP_TICKS)], NO_HINTS, () => 'Overworld').map((b) => b.id)).toEqual(['0:0:0']);
  });

  it('handles negative coordinates', () => {
    const bases = findBases([sig(0, [-1, 64, -1]), sig(0, [-17, 64, -1]), sig(0, [-33, 64, -20]), sig(0, [-2, 60, -2])], [], NO_HINTS, () => 'Overworld');
    expect(bases[0]).toMatchObject({ id: '0:-1:-1', bbox: { minX: -33, maxX: -1, minZ: -20, maxZ: -1 } });
    expect(bases[0]!.center).toEqual([-17, 62, -11]);
  });

  it('covers every signal inside the cluster chunk bounds, seed or not, and counts GT machines and their tiers', () => {
    const signals = [sig(0, [1, 64, 1], { tier: 2 }), sig(0, [2, 64, 1]), sig(0, [3, 64, 1], { machine: false }), sig(0, [50, 64, 1], { machine: false }),
      sig(0, [40, 90, 12], { seed: false, machine: false }), sig(0, [200, 64, 1], { seed: false, machine: false })];
    // chunk (2,0) lies inside the bounds (cx 0..3) but holds no seed, so its InhabitedTime does not make it the anchor
    expect(findBases(signals, [stat(0, 2, 0, 500_000)], NO_HINTS, () => 'Overworld')).toEqual([{ id: '0:0:0', dim: 0, name: 'Overworld base (25, 6)',
      center: [25, 77, 6], bbox: { minX: 1, minY: 64, minZ: 1, maxX: 50, maxY: 90, maxZ: 12 }, machineCount: 2, topTier: 2 }]);
    expect(findBases([sig(0, [1, 64, 1]), sig(0, [2, 64, 1]), sig(0, [3, 64, 1]), sig(0, [4, 64, 1])], [], NO_HINTS, () => 'Overworld')[0]!.topTier).toBe(0);
  });

  it('picks the anchor by InhabitedTime, then seeds, then lower cx, then lower cz', () => {
    const at = (cx: number, cz: number, n: number) => Array.from({ length: n }, (_, i) => sig(0, [cx * 16 + i, 64, cz * 16]));
    const ids = (signals: BaseSignal[], chunks: ChunkStat[]) => findBases(signals, chunks, NO_HINTS, () => 'Overworld').map((b) => b.id);
    expect(ids([...at(0, 0, 2), ...at(1, 0, 2)], [stat(0, 0, 0, 10), stat(0, 1, 0, 11)])).toEqual(['0:1:0']);
    expect(ids([...at(0, 0, 2), ...at(1, 0, 3)], [])).toEqual(['0:1:0']);
    expect(ids([...at(1, 0, 2), ...at(0, 1, 2)], [])).toEqual(['0:0:1']);
    expect(ids([...at(0, 1, 2), ...at(0, 0, 2)], [])).toEqual(['0:0:0']);
  });

  it('names a base after the team whose claim overlaps it, and keeps dimensions apart', () => {
    const four = (dim: number) => [0, 1, 2, 3].map((i) => sig(dim, [i, 64, 0]));
    const claim = (team: string, cx: number, cz: number) => ({ team, dim: 7, cx, cz });
    // the team with the most claimed chunks inside the bounds wins; a claim outside them (3,3) does not count
    const hints = { claims: [claim('Beta', 0, 0), claim('Beta', 1, 0), claim('Alpha', 2, 0), claim('Alpha', 3, 3), claim('Alpha', 4, 4)], beds: [] };
    const bases = findBases([...four(0), ...four(7), sig(7, [40, 64, 0])], [], hints, (dim) => (dim === 0 ? 'Overworld' : 'Twilight Forest'));
    expect(bases.map((b) => [b.id, b.name, b.machineCount])).toEqual([['7:0:0', 'Beta base (20, 0)', 5], ['0:0:0', 'Overworld base (1, 0)', 4]]);
    // a tie goes to the team name that sorts first
    const tie = { claims: [claim('Beta', 0, 0), claim('Alpha', 2, 0)], beds: [] };
    expect(findBases([...four(7), sig(7, [40, 64, 0])], [], tie, () => 'Twilight Forest')[0]!.name).toBe('Alpha base (20, 0)');
  });
});

describe('baseAt', () => {
  it('finds the base of the same dimension whose bbox holds the position (edges included)', () => {
    const bases = [BASE, { ...BASE, id: '7:0:0', dim: 7 }, { ...BASE, id: '0:5:5', bbox: { minX: 80, minY: 10, minZ: 80, maxX: 90, maxY: 20, maxZ: 90 } }];
    expect(baseAt(bases, 0, [0, 64, 0])?.id).toBe('0:0:0');
    expect(baseAt(bases, 7, [0, 64, 0])?.id).toBe('7:0:0');
    expect(baseAt(bases, 0, [90, 20, 80])?.id).toBe('0:5:5');
    expect([baseAt(bases, 0, [90, 21, 80]), baseAt(bases, 0, [1, 64, 0]), baseAt(bases, -1, [0, 64, 0]), baseAt([], 0, [0, 0, 0])]).toEqual([null, null, null, null]);
  });
});

describe('baseIdOf and findBase', () => {
  it('builds "dim:cx:cz" ids', () => {
    expect([baseIdOf(0, 1, 0), baseIdOf(-1, -3, 12)]).toEqual(['0:1:0', '-1:-3:12']);
  });

  it('finds a base by its id', () => {
    const other = { ...BASE, id: '0:9:9', bbox: { minX: 0, minY: 0, minZ: 0, maxX: 255, maxY: 255, maxZ: 255 } };
    expect(findBase({ bases: [other, BASE] }, '0:0:0')).toBe(BASE);
  });

  it('findBase falls back to the anchor chunk after a rescan', () => {
    const scan = { bases: [{ ...BASE, id: '0:2:0', bbox: { minX: 0, minY: 0, minZ: 0, maxX: 63, maxY: 255, maxZ: 15 } }] };
    expect(findBase(scan, '0:1:0')!.id).toBe('0:2:0');
    expect([findBase(scan, '7:1:0'), findBase(scan, null), findBase(scan, 'junk')]).toEqual([null, null, null]);
    // the anchor chunk's centre (x 72, z 8) lies outside the bbox
    expect(findBase(scan, '0:4:0')).toBeNull();
    expect(findBase({ bases: [{ ...BASE, id: '-1:-1:-1', dim: -1, bbox: { minX: -20, minY: 0, minZ: -20, maxX: -1, maxY: 255, maxZ: -1 } }] }, '-1:-1:-2'))
      .toBeNull();
    expect(findBase({ bases: [{ ...BASE, id: '-1:-2:-2', dim: -1, bbox: { minX: -20, minY: 0, minZ: -20, maxX: -1, maxY: 255, maxZ: -1 } }] }, '-1:-1:-1')!.id)
      .toBe('-1:-2:-2');
  });
});
