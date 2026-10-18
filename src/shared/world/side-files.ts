// Player and claim files (world-format §7) read from their decompressed NBT root: where a player stands and which
// chunks a team has claimed. The browser's smart upload reads them to find where to send chunks from, and never
// sends them (architecture §11.12); the scan reads claims as base hints (src/server/world/dims.ts). Shared by server
// and browser: no Node built-in modules.

import { comp, list, type NbtCompound, type NbtValue } from './nbt.ts';

const intOf = (v: NbtValue | undefined): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const finite = (v: NbtValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** `Dimension` (Int) and `Pos` (a List of 3 Doubles, block units); null when either is missing or not a number. */
export function playerPosition(player: NbtCompound): { dim: number; x: number; y: number; z: number } | null {
  const dim = intOf(player.Dimension);
  const [x, y, z] = list(player.Pos);
  if (dim === null || !finite(x) || !finite(y) || !finite(z)) return null;
  return { dim, x, y, z };
}

/**
 * A ServerUtilities claims file (`serverutilities/teams/claimedchunks/<team>.dat`): `ClaimedChunks: { "<dim>": [{ x, z }] }`,
 * chunk coordinates. Keys that are not a dimension id and entries without integer `x` and `z` are left out.
 */
export function claimedChunks(claims: NbtCompound): Array<{ dim: number; cx: number; cz: number }> {
  const out: Array<{ dim: number; cx: number; cz: number }> = [];
  for (const [key, chunks] of Object.entries(comp(claims.ClaimedChunks) ?? {})) {
    if (!/^-?\d+$/.test(key)) continue;
    const dim = Number(key);
    for (const entry of list(chunks)) {
      const chunk = comp(entry);
      const cx = intOf(chunk?.x), cz = intOf(chunk?.z);
      if (cx !== null && cz !== null) out.push({ dim, cx, cz });
    }
  }
  return out;
}
