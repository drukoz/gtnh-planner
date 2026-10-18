// EnderIO 2.10.46 conduit bundles (world-format §6.10): `blockConduitBundleTileEntity` with one entry per conduit,
// each typed by its class name and carrying its conduit-to-conduit and external links as side bitmasks.

import type { RawTe, Vec3 } from '../model.ts';
import { comp, list, str, type NbtValue } from '../nbt.ts';

export type ConduitType = 'item' | 'liquid' | 'power' | 'redstone' | 'me' | 'gas' | 'oc' | 'other';

export interface ConduitRec {
  dim: number; pos: Vec3;
  /** In bundle order. `connections` (to other conduits) and `external` (to machines, inventories): bit `1 << side`. */
  conduits: Array<{ type: ConduitType; connections: number; external: number }>;
}

const CONDUIT_PACKAGE = 'crazypants.enderio.conduit.';

/** The conduit packages that name a type (`.item.ItemConduit`, `.power.endergy.PowerConduitEndergy`, …). */
const PACKAGE_TYPES: ReadonlyMap<string, ConduitType> = new Map<string, ConduitType>([
  ['item', 'item'], ['liquid', 'liquid'], ['power', 'power'], ['redstone', 'redstone'], ['me', 'me'], ['gas', 'gas'], ['oc', 'oc'],
]);

/** A conduit's type by the package right after `crazypants.enderio.conduit.`; 'other' for any other class name. */
export function conduitType(className: string): ConduitType {
  if (!className.startsWith(CONDUIT_PACKAGE)) return 'other';
  const rest = className.slice(CONDUIT_PACKAGE.length);
  const dot = rest.indexOf('.');
  return dot > 0 ? PACKAGE_TYPES.get(rest.slice(0, dot)) ?? 'other' : 'other';
}

/** An IntArray of ForgeDirection ordinals as a `1 << side` mask; ordinals that are not a side (6 = UNKNOWN) are ignored. */
function sideMask(v: NbtValue | undefined): number {
  if (!(v instanceof Int32Array)) return 0;
  let mask = 0;
  for (const side of v) if (side >= 0 && side <= 5) mask |= 1 << side;
  return mask;
}

/**
 * A conduit bundle and its conduits. An entry that is not a compound is left out; one without a class name types as
 * 'other', and missing link arrays read as no links.
 */
export function classifyConduitBundle(te: RawTe): ConduitRec {
  const conduits: ConduitRec['conduits'] = [];
  for (const entry of list(te.nbt.conduits)) {
    const c = comp(entry);
    if (c === null) continue;
    const data = comp(c.conduit);
    conduits.push({
      type: conduitType(str(c.conduitType) ?? ''),
      connections: sideMask(data?.connections),
      external: sideMask(data?.externalConnections),
    });
  }
  return { dim: te.dim, pos: [te.x, te.y, te.z], conduits };
}
