import { describe, expect, it } from 'vitest';
import type { BlockReader } from '../../../src/server/world/area.ts';
import type { GtMachineRec } from '../../../src/server/world/classify/gt.ts';
import { COIL_BLOCK, COIL_HEAT_BY_META, ebfCoilHeat, isEbf } from '../../../src/server/world/coils.ts';
import { posKey, type Vec3 } from '../../../src/server/world/model.ts';
import { DEFAULT_BLOCK_IDS } from '../../helpers/make-world.ts';

const names = new Map(Object.entries(DEFAULT_BLOCK_IDS).map(([name, id]) => [id, name]));
const COIL_ID = DEFAULT_BLOCK_IDS[COIL_BLOCK]!;
const STONE_ID = DEFAULT_BLOCK_IDS['minecraft:stone']!;
const CUPRONICKEL = 0, KANTHAL = 1, NICHROME = 2;

/** The 16 ring positions of an EBF whose controller is at (8,64,8) facing north: around (8, ·, 9) at y 65–66. */
function ringAround(centre: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let dy = 1; dy <= 2; dy++) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dz !== 0) out.push([centre[0] + dx, centre[1] + dy, centre[2] + dz]);
  }
  return out;
}
const RING = ringAround([8, 64, 9]);

/**
 * A block reader over DIM 0 holding exactly `blocks` (`[pos, id, meta]`) and air elsewhere; chunks listed in
 * `missingChunks` (`"cx:cz"`) are not available.
 */
function reader(blocks: Array<[Vec3, number, number]>, missingChunks: string[] = []): BlockReader {
  const at = new Map(blocks.map(([p, id, meta]) => [posKey(0, ...p), { id, meta }]));
  return {
    chunk: async () => { throw new Error('ebfCoilHeat reads single blocks'); },
    blockAt: async (dim, x, y, z) => {
      if (dim !== 0 || missingChunks.includes(`${x >> 4}:${z >> 4}`)) return null;
      return at.get(posKey(dim, x, y, z)) ?? { id: 0, meta: 0 };
    },
  };
}
const coils = (positions: Vec3[], meta: (p: Vec3, i: number) => number): Array<[Vec3, number, number]> =>
  positions.map((p, i) => [p, COIL_ID, meta(p, i)]);

const fullKanthalRing = coils(RING, () => KANTHAL);
const ringMissingOne = coils(RING.slice(1), () => KANTHAL);
const mixedNichromeKanthal = coils(RING, (_, i) => (i % 3 === 0 ? KANTHAL : NICHROME));

/** A GtMachineRec with the given fields over a plain EBF-less default. */
function rec(fields: Partial<GtMachineRec>): GtMachineRec {
  return {
    dim: 0, pos: [0, 64, 0], mteId: 0, facing: 2, color: 0, storedEU: 0, works: true, kind: 'unknown', tier: null, name: null, cls: null,
    multiblock: true, recipeEUt: 0, running: false, inventory: [], ...fields,
  };
}

describe('EBF coils', () => {
  it('reads EBF coil heat from a full ring and rejects a broken one', async () => {
    expect(await ebfCoilHeat(reader(fullKanthalRing), names, 0, [8, 64, 8], 2)).toBe(2701);
    expect(await ebfCoilHeat(reader(ringMissingOne), names, 0, [8, 64, 8], 2)).toBeNull();
    expect(await ebfCoilHeat(reader(mixedNichromeKanthal), names, 0, [8, 64, 8], 2)).toBe(2701);   // lowest coil wins
  });

  it('recognises an EBF by its fully qualified class or, without one, by mteId 1000', () => {
    const EBF = 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace';
    expect([isEbf(rec({ mteId: 5555, cls: EBF })), isEbf(rec({ mteId: 1000, cls: null })), isEbf(rec({ mteId: 5556, cls: 'x.MTEElectricBlastFurnaceMk2' }))])
      .toEqual([true, true, false]);   // rec = a GtMachineRec with those fields
  });

  it('a known class that is not the EBF wins over mteId 1000', () =>
    expect(isEbf(rec({ mteId: 1000, cls: 'gregtech.common.tileentities.machines.multi.MTEVacuumFreezer' }))).toBe(false));

  it('finds the ring behind the controller for every horizontal facing', async () => {
    // facing east (5): the centre is one block west of the controller
    expect(await ebfCoilHeat(reader(coils(ringAround([7, 64, 8]), () => CUPRONICKEL)), names, 0, [8, 64, 8], 5)).toBe(1801);
    // facing west (4) at negative coordinates: the centre is one block east, at x = 0 next to the x = -1 border
    expect(await ebfCoilHeat(reader(coils(ringAround([0, 64, -5]), () => KANTHAL)), names, 0, [-1, 64, -5], 4)).toBe(2701);
    // a full ring in the wrong place reads as no ring
    expect(await ebfCoilHeat(reader(fullKanthalRing), names, 0, [8, 64, 8], 3)).toBeNull();
  });

  it('rejects a ring with an unknown coil meta, a block that is no coil, or a missing chunk', async () => {
    expect(await ebfCoilHeat(reader(coils(RING, (_, i) => (i === 5 ? 14 : KANTHAL))), names, 0, [8, 64, 8], 2)).toBeNull();
    expect(await ebfCoilHeat(reader([...ringMissingOne, [RING[0]!, STONE_ID, KANTHAL]]), names, 0, [8, 64, 8], 2)).toBeNull();
    expect(await ebfCoilHeat(reader(fullKanthalRing, ['0:0']), names, 0, [8, 64, 8], 2)).toBeNull();
    expect(await ebfCoilHeat(reader(fullKanthalRing), names, 0, [8, 64, 8], 9)).toBeNull();   // not a ForgeDirection
  });

  it('knows the heat of every coil meta from gt-mechanics §6.4', () => {
    expect(Object.keys(COIL_HEAT_BY_META).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect([COIL_HEAT_BY_META[0], COIL_HEAT_BY_META[8], COIL_HEAT_BY_META[9], COIL_HEAT_BY_META[13]]).toEqual([1801, 10801, 6301, 13501]);
  });
});
