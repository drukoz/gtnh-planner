// GregTech tile entities (world-format §6.1–§6.4): machines (`BaseMetaTileEntity`) and pipes and cables
// (`BaseMetaPipeEntity`) as the records the power, logistics and base passes use, named, kinded and tiered from the
// export's machine table. An mID the export does not know stays on the map as kind 'unknown' with no tier.

import { V } from '../../../shared/gt/tiers.ts';
import type { ItemKey } from '../../../shared/keys.ts';
import type { MachineKind } from '../../../shared/types/pack.ts';
import type { PlacedMachine, PlacedPipe } from '../../../shared/types/world.ts';
import { ENERGY_HATCH_RE, simpleClassName, type ScanPackFacts } from '../facts.ts';
import type { ItemCount, RawTe, Vec3 } from '../model.ts';
import { comp, list, num, type NbtCompound } from '../nbt.ts';
import { readStack } from '../tile-entities.ts';

export interface GtMachineRec {
  dim: number; pos: Vec3; mteId: number;
  /** `mFacing`, a ForgeDirection ordinal; `mainFacing` (`mMainFacing`) only on basic machines. */
  facing: number; mainFacing?: number;
  /** 0 = unpainted, 1..16 = dye 0..15. */
  color: number;
  /** `mStoredEnergy`: EU in the machine's own buffer (a battery buffer's batteries are in `batteries`). */
  storedEU: number;
  /** False when disabled with a soft mallet (`mWorks` is saved inverted). */
  works: boolean;
  /** From the export; 'unknown' (with tier, name and cls null) when the export does not know the mID. */
  kind: MachineKind | 'unknown'; tier: number | null; name: string | null;
  /** The export's fully qualified class name; compare `simpleClassName(cls)`. */
  cls: string | null;
  /** A multiblock controller: export kind `multiblock`, or the maintenance keys `mWrench … mCrowbar` in the NBT. */
  multiblock: boolean;
  /** `|mEUt|` of the current or last recipe. */
  recipeEUt: number;
  /** A recipe is in progress (`mMaxProgresstime > 0`). */
  running: boolean;
  /** Boilers: `mRunTime` (calcification, producing ticks) and `mTemperature`. */
  boiler?: { runTime: number; temperature: number };
  /** Battery buffers: the batteries in slot order, charge in EU (`GT.ItemCharge`, else IC2 `charge`). */
  batteries?: Array<{ key: ItemKey; charge: number }>;
  /** Every `Inventory` stack that can be keyed, with its `IntSlot`. */
  inventory: Array<ItemCount & { slot: number }>;
}

export interface GtPipeRec {
  dim: number; pos: Vec3; mteId: number;
  /** `mConnections`: bit `1 << side` per connected ForgeDirection side. */
  connections: number;
  pipeKind: 'cable' | 'fluid' | 'item';
  color: number;
  /** A cable's rating from the export (`loss` in EU per block). */
  cable?: { voltage: number; amps: number; loss: number };
  /** The tier of the cable's rated voltage; always an own key, `undefined` when the export gives no rating (ruling R16). */
  voltageTier?: number;
}

/** The kinds whose export tier says what voltage a base runs at (with energy hatches, see `countsForTopTier`). */
export const TIER_KINDS: ReadonlySet<MachineKind> = new Set<MachineKind>(['basic', 'generator', 'turbine', 'battery_buffer', 'transformer']);

/** `MTEMultiBlockBase` always saves these maintenance flags (world-format §6.3). */
const MAINTENANCE_KEYS = ['mWrench', 'mScrewdriver', 'mSoftMallet', 'mHardHammer', 'mSolderingTool', 'mCrowbar'] as const;

const PIPE_KIND_OF_EXPORT: Partial<Record<MachineKind, GtPipeRec['pipeKind']>> = { cable: 'cable', fluid_pipe: 'fluid', item_pipe: 'item' };

/** The smallest tier `t` with `V[t] ≥ volts` (0 for anything up to 8 V); MAX (14) above every tier. */
export function voltageTier(volts: number): number {
  const tier = V.findIndex((v) => v >= volts);
  return tier === -1 ? V.length - 1 : tier;
}

interface SlotStack { slot: number; key: ItemKey; count: number; tag: NbtCompound | null }

/** The `Inventory` entries (`IntSlot` + stack) that have a slot and a stack `readStack` can key, in NBT order. */
function readInventory(t: NbtCompound, itemNames: Map<number, string>): SlotStack[] {
  const out: SlotStack[] = [];
  for (const entry of list(t.Inventory)) {
    const c = comp(entry);
    if (c === null || typeof c.IntSlot !== 'number') continue;
    const s = readStack(c, itemNames);
    if (s !== null) out.push({ slot: c.IntSlot, ...s });
  }
  return out;
}

/** GT batteries keep their charge in `tag['GT.ItemCharge']` (Long), IC2 ones in `tag.charge` (Double); null without either. */
function chargeOf(tag: NbtCompound | null): number | null {
  const gt = tag?.['GT.ItemCharge'], ic2 = tag?.charge;
  if (typeof gt === 'number') return gt;
  return typeof ic2 === 'number' ? ic2 : null;
}

/**
 * The batteries in a buffer: every stack with a charge tag, and every electric item the export knows (an empty GT
 * battery has no tag; it still adds capacity) at charge 0.
 */
function batteriesOf(slots: SlotStack[], facts: ScanPackFacts): Array<{ key: ItemKey; charge: number }> {
  const out: Array<{ key: ItemKey; charge: number }> = [];
  for (const s of slots) {
    const charge = chargeOf(s.tag);
    if (charge !== null || facts.electric.has(s.key)) out.push({ key: s.key, charge: charge ?? 0 });
  }
  return out;
}

/** A boiler: export kind `boiler`, or an mID the export does not know whose NBT has the `MTEBoiler` keys. */
function isBoiler(kind: GtMachineRec['kind'], t: NbtCompound): boolean {
  return kind === 'boiler' || (kind === 'unknown' && (typeof t.mRunTime === 'number' || typeof t.mTemperature === 'number'));
}

/** A `BaseMetaTileEntity` (world-format §6.1, §6.3, §6.4). */
export function classifyGtMachine(te: RawTe, facts: ScanPackFacts, itemNames: Map<number, string>): GtMachineRec {
  const t = te.nbt;
  const mteId = num(t.mID);
  const machine = facts.machines.get(mteId);
  const kind = machine?.kind ?? 'unknown';
  const slots = readInventory(t, itemNames);
  const rec: GtMachineRec = {
    dim: te.dim, pos: [te.x, te.y, te.z], mteId, facing: num(t.mFacing),
    ...(typeof t.mMainFacing === 'number' ? { mainFacing: t.mMainFacing } : {}),
    color: num(t.mColor), storedEU: num(t.mStoredEnergy), works: num(t.mWorks) === 0,
    kind, tier: machine?.tier ?? null, name: machine?.name ?? null, cls: machine?.cls ?? null,
    multiblock: kind === 'multiblock' || MAINTENANCE_KEYS.some((k) => Object.hasOwn(t, k)),
    recipeEUt: Math.abs(num(t.mEUt)), running: num(t.mMaxProgresstime) > 0,
    inventory: slots.map(({ key, count, slot }) => ({ key, count, slot })),
  };
  if (isBoiler(kind, t)) rec.boiler = { runTime: num(t.mRunTime), temperature: num(t.mTemperature) };
  if (kind === 'battery_buffer') rec.batteries = batteriesOf(slots, facts);
  return rec;
}

function pipeKindFromNbt(t: NbtCompound): GtPipeRec['pipeKind'] {
  if (Object.hasOwn(t, 'mDisableInput')) return 'fluid';
  return Object.hasOwn(t, 'mLastReceivedFrom') ? 'item' : 'cable';
}

/** A `BaseMetaPipeEntity` (world-format §6.2): the kind from the export, else from the NBT keys. */
export function classifyGtPipe(te: RawTe, facts: ScanPackFacts): GtPipeRec {
  const t = te.nbt;
  const mteId = num(t.mID);
  const machine = facts.machines.get(mteId);
  const pipeKind = (machine === undefined ? undefined : PIPE_KIND_OF_EXPORT[machine.kind]) ?? pipeKindFromNbt(t);
  const rec: GtPipeRec = { dim: te.dim, pos: [te.x, te.y, te.z], mteId, connections: num(t.mConnections) & 0xff, pipeKind, color: num(t.mColor) };
  const rating = pipeKind === 'cable' ? machine?.cable : undefined;
  if (rating !== undefined) rec.cable = { voltage: rating.voltage, amps: rating.amps, loss: rating.lossPerBlock };
  rec.voltageTier = rating === undefined ? undefined : voltageTier(rating.voltage);
  return rec;
}

/**
 * Whether a machine's tier counts toward a base's, the world's or a plan context's top tier; never for an unknown mID
 * or no tier.
 */
export function countsForTopTier(r: Pick<GtMachineRec, 'kind' | 'tier' | 'cls'>): boolean {
  if (r.kind === 'unknown' || r.tier === null) return false;
  return TIER_KINDS.has(r.kind) || (r.kind === 'hatch' && ENERGY_HATCH_RE.test(simpleClassName(r.cls) ?? ''));
}

/** The scan's `PlacedMachine`; `recipeEUt` only while a recipe runs. The scan job adds `coilHeat` to EBFs. */
export function toPlacedMachine(r: GtMachineRec, baseId: string | null): PlacedMachine {
  const p: PlacedMachine = {
    dim: r.dim, pos: [...r.pos], mteId: r.mteId, facing: r.facing, ...(r.mainFacing === undefined ? {} : { mainFacing: r.mainFacing }),
    color: r.color, baseId, storedEU: r.storedEU, kind: r.kind,
  };
  if (r.tier !== null) p.tier = r.tier;
  if (r.name !== null) p.name = r.name;
  if (r.running) p.recipeEUt = r.recipeEUt;
  return p;
}

/** The scan's `PlacedPipe`: the cable rating's tier and amps when known, the network when given. */
export function toPlacedPipe(r: GtPipeRec, networkId?: string): PlacedPipe {
  const p: PlacedPipe = { dim: r.dim, pos: [...r.pos], mteId: r.mteId, connections: r.connections, kind: r.pipeKind };
  if (r.voltageTier !== undefined) p.voltageTier = r.voltageTier;
  if (r.cable !== undefined) p.amps = r.cable.amps;
  if (networkId !== undefined) p.networkId = networkId;
  return p;
}
