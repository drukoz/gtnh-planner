// Rain and roof spikes (RUK-3026, design goal 7): which laid blocks rain can reach, and the cells three roof rules
// would lay to cover them. A block needs a roof iff it is electric and has an EU buffer and rain reaches it from above
// or through an open side column (gt-mechanics §3.4a "Planner use."): singleblock machines of a unit with `electric`
// true and `multiblock` false, every transformer (head banks, Hi-Amp banks, satellites) and every energy hatch; cables,
// pipes, buses, item/fluid hatches, steam machines and buffer-less multiblock controllers are exempt. The line stands
// in its own local grid (floor at y 0), the spike assuming open sky everywhere (site cover and dimensions come later).
// Pure: it lays nothing and reads only a laid line's blocks and units.

import { posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { LocalBlock, PlacedUnit } from './arrange.ts';

/**
 * How a roof covers a line's rain exposures (RUK-3026 spike). The numbers are stable: never renumber one; a new rule
 * takes the next number.
 */
export const RoofRule = { Box: 0, Flat: 1, Lowest: 2 } as const;
export type RoofRule = (typeof RoofRule)[keyof typeof RoofRule];

/** The horizontal sides GT's rain test reads (gt-mechanics §3.4a): north (z − 1), south (z + 1), west (x − 1), east (x + 1). */
const SIDES: readonly number[] = [2, 3, 4, 5];
const SIDE_STEP: Record<number, Vec3> = { 2: [0, 0, -1], 3: [0, 0, 1], 4: [-1, 0, 0], 5: [1, 0, 0] };

const key = (p: Vec3): string => posKey(p);

/** Every block the line lays blocks rain (any role but a hookup tap's ghost): the cells that shield an exposure. */
function blocking(blocks: readonly LocalBlock[]): Set<string> {
  return new Set(blocks.filter((b) => b.role !== 'ghost').map((b) => key(b.pos)));
}

/**
 * The laid blocks rain is checked against (gt-mechanics §3.4a): every `machine` block of a unit with `electric` true
 * and `multiblock` false (a GT singleblock, matched to its unit by position; a multiblock controller has no EU buffer),
 * every `transformer` block (head banks, Hi-Amp banks and satellites), and every `hatch` block whose `hatch` is
 * `'energy'` (an energy hatch has a buffer). A steam machine (`electric` false) and every unbuffered block are not.
 */
export function rainChecked(blocks: readonly LocalBlock[], units: readonly PlacedUnit[]): LocalBlock[] {
  const singleblock = new Set<string>();
  for (const u of units) {
    if (!u.electric || u.multiblock) continue;
    singleblock.add(key(u.at)); // the placed machine cell (`at`; `u.cells[].pos` stay relative to the unit)
  }
  return blocks.filter((b) => b.role !== 'ghost'
    && ((b.role === 'machine' && singleblock.has(key(b.pos))) || b.role === 'transformer' || (b.role === 'hatch' && b.hatch === 'energy')));
}

/** One checked block and the faces rain reaches it through: `top` when its own column is open above it, `sides` the
 *  horizontal sides (`2` north, `3` south, `4` west, `5` east) whose neighbour column is open at the block's level. */
export interface RainExposure { pos: Vec3; top: boolean; sides: number[] }

/**
 * The faces of each checked block rain reaches (gt-mechanics §3.4a exposure test, open sky everywhere): `top` when no
 * blocking block sits anywhere above it in its own column (`(x, y', z)` for any `y' > y`); a horizontal side when the
 * neighbour column has no blocking block at `y' >= y`. A neighbour column outside the line's box is open sky, so a
 * block on the line's edge has its outward side exposed. In checked-block order.
 */
export function rainExposures(blocks: readonly LocalBlock[], checked: readonly LocalBlock[]): RainExposure[] {
  const colMax = new Map<string, number>();
  for (const b of blocks) {
    if (b.role === 'ghost') continue;
    const col = `${b.pos[0]},${b.pos[2]}`;
    const y = colMax.get(col);
    if (y === undefined || b.pos[1] > y) colMax.set(col, b.pos[1]);
  }
  return checked.map((b) => {
    const [x, y, z] = b.pos;
    const top = (colMax.get(`${x},${z}`) ?? -Infinity) <= y;
    const sides = SIDES.filter((s) => {
      const d = SIDE_STEP[s]!;
      const n = colMax.get(`${x + d[0]},${z + d[2]}`);
      return n === undefined || n < y;
    });
    return { pos: [...b.pos] as Vec3, top, sides };
  });
}

/**
 * The cells a roof rule lays to cover `exposures` (RUK-3026 spike), sorted by x, y, z. `height` is `H` = the line's
 * `size[1]`: one above its highest block or reserved cell, so a cover at `H` sits at least one above every exposed
 * block and never closes the face beside it (design goal 3 reach needs those faces).
 * - `Box`: every column of the blocks' footprint grown by 1 on each side, at `H` (what today's roof step asks for).
 * - `Flat`: at `H`, only the columns that cover an exposure — the own column of each top-exposed block and the neighbour
 *   column of each exposed side — deduplicated.
 * - `Lowest`: the same columns as `Flat`, each at the lowest y that is ≥ (the highest exposed block it covers + 1),
 *   holds no block and is not a reserved cell (`placement.reserved`: a muffler's front, a steam vent, a multiblock's
 *   hollow; a roof block never goes in one).
 */
export function roofCells(
  blocks: readonly LocalBlock[], exposures: readonly RainExposure[], reserved: readonly Vec3[], height: number, rule: RoofRule,
): Vec3[] {
  const solid = blocking(blocks);
  const reservedSet = new Set(reserved.map(key));
  if (rule === RoofRule.Box) {
    const cells: Vec3[] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of blocks) {
      if (b.role === 'ghost') continue;
      minX = Math.min(minX, b.pos[0]); maxX = Math.max(maxX, b.pos[0]);
      minZ = Math.min(minZ, b.pos[2]); maxZ = Math.max(maxZ, b.pos[2]);
    }
    for (let x = minX - 1; x <= maxX + 1; x++) for (let z = minZ - 1; z <= maxZ + 1; z++) cells.push([x, height, z]);
    return cells.sort(compareCell);
  }
  // Flat and Lowest cover the same columns: the own column of every top exposure, the neighbour column of every side.
  // Each column carries the highest exposed block it covers (Lowest sets its y from that; Flat ignores it).
  const coverMax = new Map<string, number>();
  for (const e of exposures) {
    const cover = (cx: number, cz: number, y: number): void => {
      const col = `${cx},${cz}`;
      const cur = coverMax.get(col);
      if (cur === undefined || y > cur) coverMax.set(col, y);
    };
    if (e.top) cover(e.pos[0], e.pos[2], e.pos[1]);
    for (const s of e.sides) {
      const d = SIDE_STEP[s]!;
      cover(e.pos[0] + d[0], e.pos[2] + d[2], e.pos[1]);
    }
  }
  const colBlocks = new Map<string, Set<number>>();
  for (const b of blocks) {
    if (b.role === 'ghost') continue;
    const col = `${b.pos[0]},${b.pos[2]}`;
    const set = colBlocks.get(col) ?? new Set<number>();
    set.add(b.pos[1]);
    colBlocks.set(col, set);
  }
  const cells: Vec3[] = [];
  for (const [col, top] of coverMax) {
    const [x, z] = col.split(',').map(Number) as [number, number];
    let y = rule === RoofRule.Flat ? height : top + 1;
    if (rule === RoofRule.Lowest) {
      const used = colBlocks.get(col) ?? new Set<number>();
      while (used.has(y) || reservedSet.has(`${x},${y},${z}`)) y++;
    }
    if (!solid.has(`${x},${y},${z}`) && !reservedSet.has(`${x},${y},${z}`)) cells.push([x, y, z]);
  }
  return cells.sort(compareCell);
}

function compareCell(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
