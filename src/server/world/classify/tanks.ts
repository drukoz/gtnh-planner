// Tanks of the steam graph (plan 10 Task 1, rulings R4 and R5): blocks that hold fluid and pass steam between the pipes
// and machines touching them. Railcraft iron and steel tank parts are recognised by their TE id whatever they hold
// (world-format §6.12; a tank keeps its fluid in one master part only); any other tile entity counts when it holds
// steam, which the chunk pass pre-checks by bytes (tile-entities.ts). GT super and quantum tanks are GT machines: the
// scan job adds them from their storage records (classify/gtchests.ts).

import type { RawTe, Vec3 } from '../model.ts';
import type { NbtValue } from '../nbt.ts';
import { RAILCRAFT_TANK_TES, STEAM_FLUIDS } from '../tile-entities.ts';

/**
 * A tank block. Railcraft parts that touch face to face are one tank (`kind` 'railcraft'); every other tank (a GT super
 * or quantum tank, another mod's tank holding steam) is a tank of its own ('single').
 */
export interface TankRec { dim: number; pos: Vec3; kind: 'railcraft' | 'single' }

/** True when a String value anywhere in `v` (compounds and lists searched) is a steam fluid name. */
function holdsSteam(v: NbtValue): boolean {
  if (typeof v === 'string') return STEAM_FLUIDS.includes(v);
  if (typeof v !== 'object' || ArrayBuffer.isView(v)) return false;   // numbers, byte and int arrays
  return Object.values(v).some(holdsSteam);
}

/** A Railcraft tank part (by TE id) or another tile entity holding steam; null for every other TE. */
export function classifyTank(te: RawTe): TankRec | null {
  const pos: Vec3 = [te.x, te.y, te.z];
  if (RAILCRAFT_TANK_TES.has(te.id)) return { dim: te.dim, pos, kind: 'railcraft' };
  return holdsSteam(te.nbt) ? { dim: te.dim, pos, kind: 'single' } : null;
}
