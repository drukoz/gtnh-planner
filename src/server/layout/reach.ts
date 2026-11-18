// Reach (RUK-2571 design goal 3, RUK-2877): every machine of a line keeps a face a builder can work from outside the
// line. A face counts when the cell beside it is air that connects to the outside of the line's box, or a thin block
// (a cable, a pipe or conduit, a chip pipe: `THIN_ROLES`) whose own cell touches such air, as a builder clicks past it.
// Full blocks (machines, casings, hatches, transformers, ME Interfaces, chests) close a face. The ground under the
// line's floor (local y < 0) is solid. Pure.

import { fmtInt } from '../../shared/layout/format.ts';
import type { Vec3 } from '../../shared/layout/geometry.ts';
import type { PlanWarning } from '../../shared/types/plan.ts';

/** The roles of the thin blocks a builder can click past (GT cables and pipes, EnderIO conduits, ME glass cable, routed pipes). */
export const THIN_ROLES: ReadonlySet<string> = new Set(['cable', 'pipe', 'chip_pipe']);

const SIDES: readonly Vec3[] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/**
 * The machine blocks (role `machine`: a singleblock, or a multiblock's controller) of a line laid in its local grid
 * that no builder can reach, in block order: none of its six neighbours is outside air, nor a thin block touching
 * outside air. Outside air is every cell of the line's box grown by one on each side (not below the floor, y 0) that
 * holds no block and is joined to the grown box's edge through such cells.
 */
export function unreachableMachines(blocks: ReadonlyArray<{ pos: Vec3; role: string }>): Vec3[] {
  if (blocks.length === 0) return [];
  const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;
  const solid = new Map<string, string>();
  const lo: Vec3 = [Infinity, 0, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of blocks) {
    solid.set(key(b.pos), b.role);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.pos[i]!); hi[i] = Math.max(hi[i]!, b.pos[i]!); }
  }
  lo[0] -= 1; lo[2] -= 1; lo[1] = Math.max(0, lo[1] - 1);
  hi[0] += 1; hi[1] += 1; hi[2] += 1;
  const inBox = (p: Vec3): boolean => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2];
  const open = (p: Vec3): boolean => inBox(p) && !solid.has(key(p));
  const outside = new Set<string>();
  const queue: Vec3[] = [];
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    const p: Vec3 = [x, y, z];
    const edge = x === lo[0] || x === hi[0] || y === hi[1] || z === lo[2] || z === hi[2];
    if (edge && open(p) && !outside.has(key(p))) { outside.add(key(p)); queue.push(p); }
  }
  while (queue.length > 0) {
    const p = queue.pop()!;
    for (const d of SIDES) {
      const n: Vec3 = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      if (open(n) && !outside.has(key(n))) { outside.add(key(n)); queue.push(n); }
    }
  }
  const touchesOutside = (p: Vec3): boolean => SIDES.some((d) => outside.has(key([p[0] + d[0], p[1] + d[1], p[2] + d[2]])));
  return blocks.filter((b) => b.role === 'machine' && !SIDES.some((d) => {
    const n: Vec3 = [b.pos[0] + d[0], b.pos[1] + d[1], b.pos[2] + d[2]];
    if (outside.has(key(n))) return true;
    const role = solid.get(key(n));
    return role !== undefined && THIN_ROLES.has(role) && touchesOutside(n);
  })).map((b) => [...b.pos] as Vec3);
}

/**
 * The `machine_unreachable` warning for a line laid in its local grid, or null when every machine can be reached. The
 * shut-in machines are named as in the starved-machine warning (`2× Electric Blast Furnace`: labels grouped by name,
 * sorted, joined with `, `); `first` is the first of them in block order, where the layout pins the warning.
 */
export function unreachableWarning(blocks: ReadonlyArray<{ pos: Vec3; role: string; label: string }>): { warning: PlanWarning; first: Vec3 } | null {
  const shut = unreachableMachines(blocks);
  if (shut.length === 0) return null;
  const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;
  const at = new Set(shut.map(key));
  const byName = new Map<string, number>();
  for (const b of blocks) if (b.role === 'machine' && at.has(key(b.pos))) byName.set(b.label, (byName.get(b.label) ?? 0) + 1);
  const names = [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, count]) => `${count}× ${name}`).join(', ');
  const singular = shut.length === 1;
  const text = `${fmtInt(shut.length)} ${singular ? 'machine is' : 'machines are'} closed in by the blocks around ${singular ? 'it' : 'them'}, `
    + `so you cannot reach ${singular ? 'it' : 'them'} once the line is built: ${names}. `
    + 'Set up each one (circuit, covers, wrench) before you place the blocks beside it.';
  return { warning: { code: 'machine_unreachable', text }, first: shut[0]! };
}
