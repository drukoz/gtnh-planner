// Project Red 4.12.44-GTNH pipes inside Forge Multipart blocks (world-format §6.9): `savedMultipart` tile entities
// whose `parts` include a pipe part, with its connection map, inventory side and routing chips.

import type { RawTe, Vec3 } from '../model.ts';
import { comp, list, num, str, type NbtValue } from '../nbt.ts';

export type PrPipeType =
  | 'basic' | 'junction' | 'interface' | 'crafting' | 'request' | 'extension' | 'firewall' | 'pressure' | 'resistance' | 'valve' | 'latency';

const pipe = (type: PrPipeType, routed: boolean) => Object.freeze({ type, routed });

/**
 * Pipe part ids (`PipeDefs`, in def order) and whether each is a routed pipe, the kind a routed network is made of.
 * The resistance tube (`pr_rpt`) is not a routed pipe despite its `pr_r` prefix.
 */
export const PR_PIPES: Readonly<Record<string, { type: PrPipeType; routed: boolean }>> = Object.freeze({
  pr_pipe: pipe('basic', false),
  pr_rbasic: pipe('junction', true),
  pr_rinterface: pipe('interface', true),
  pr_rcrafting: pipe('crafting', true),
  pr_rrequest: pipe('request', true),
  pr_rextension: pipe('extension', true),
  pr_rfire: pipe('firewall', true),
  pr_pt: pipe('pressure', false),
  pr_rpt: pipe('resistance', false),
  pr_netvalve: pipe('valve', false),
  pr_netlatency: pipe('latency', false),
});

/** `RoutingChipDefs` in order: a chip item's `Damage` indexes this list. */
export const ROUTING_CHIPS = [
  'responder', 'dyn_responder', 'overflow', 'terminator', 'extractor', 'broadcaster', 'stock_keeper', 'crafting', 'extension',
] as const;

export interface PrPipeRec {
  dim: number; pos: Vec3; type: PrPipeType; routed: boolean;
  /** Bits 0–5 connect out on side s, 6–11 connect internally, 12–17 side open; see `prConnects`. */
  connMap: number;
  /** The side (ForgeDirection ordinal) of the attached inventory; null when the pipe has none (`io` 6 or absent). */
  io: number | null;
  /** Installed routing chips in saved order, by `ROUTING_CHIPS` name ('unknown' for a damage outside the list). */
  chips: string[];
}

/** `TCenterConnectable.maskConnects`: the pipe connects on `side` when either its outward or its internal bit is set. */
export function prConnects(connMap: number, side: number): boolean {
  return (connMap & (0x41 << side)) !== 0;
}

/** The ForgeDirection side `io` names, or null for 6 (none), an absent key or any value that is not a side. */
function inventorySide(io: NbtValue | undefined): number | null {
  return typeof io === 'number' && Number.isInteger(io) && io >= 0 && io <= 5 ? io : null;
}

/** The chip type of each `chipsitems` stack in saved order, by its `Damage` (a negative one reads as 0, as for any stack). */
function chipTypes(items: NbtValue[]): string[] {
  const chips: string[] = [];
  for (const entry of items) {
    const chip = comp(entry);
    if (chip === null) continue;
    chips.push(ROUTING_CHIPS[Math.max(0, num(chip.Damage))] ?? 'unknown');
  }
  return chips;
}

/** The first Project Red pipe among a `savedMultipart` block's parts; null for other TEs and blocks without a pipe. */
export function classifyMultipart(te: RawTe): PrPipeRec | null {
  if (te.id !== 'savedMultipart') return null;
  for (const entry of list(te.nbt.parts)) {
    const part = comp(entry);
    const id = part === null ? null : str(part.id);
    const def = id !== null && Object.hasOwn(PR_PIPES, id) ? PR_PIPES[id] : undefined;
    if (part === null || def === undefined) continue;
    return {
      dim: te.dim, pos: [te.x, te.y, te.z], type: def.type, routed: def.routed, connMap: num(part.connMap),
      io: inventorySide(part.io), chips: chipTypes(list(part.chipsitems)),
    };
  }
  return null;
}
