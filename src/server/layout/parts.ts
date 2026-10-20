// The parts a line layout is built from (Plan 5 Task 3; architecture §11.13, §11.14, §11.17): the catalog of covers,
// chests, Project Red, AE2 and EnderIO parts resolved against the pack, and the sizing rules that choose a cable, an
// item or fluid pipe, a transformer, a hatch or bus, and a conveyor or pump cover for what it must carry
// (gt-mechanics §3.3, §3.6, §3.8). Also the idle draw of placed ME parts. Every choice has fixed tie-breaks, so the same
// pack gives the same layout. Class checks compare the simple class name (architecture §11.19).

import { tierName } from '../../shared/gt/tiers.ts';
import { parseItemKey, type ItemKey, type StuffKey } from '../../shared/keys.ts';
import { CONDUIT_NAMES, FLUID_CONDUITS } from '../../shared/layout/enderio.ts';
import { fmtRate } from '../../shared/layout/format.ts';
import { ae2CableBlockRef, conduitBlockRef, partBlockRef } from '../../shared/types/assets.ts';
import type { ConduitKind, LayoutBlock } from '../../shared/types/layout.ts';
import type { BlockRef, Machine, Pack } from '../../shared/types/pack.ts';
import type { PlanWarning } from '../../shared/types/plan.ts';
import { simpleClassName } from '../world/facts.ts';
import { GT_MACHINE_BLOCK } from '../world/tiles.ts';

// ---- Part catalog ----

export type PartId = 'conveyor_cover' | 'pump_cover' | 'item_filter_cover' | 'chest' | 'pr_junction' | 'pr_interface' | 'pr_request'
  | 'chip_responder' | 'chip_extractor' | 'chip_stock_keeper' | 'me_interface' | 'me_cable' | 'me_export_bus' | 'blank_pattern'
  | 'eio_item_conduit' | 'eio_basic_filter' | 'eio_advanced_filter' | 'eio_big_filter' | 'eio_speed_upgrade'
  | 'eio_fluid_ender' | 'eio_fluid_crystalline' | 'eio_fluid_pink_slime' | 'eio_fluid_melodic' | 'eio_fluid_stellar'
  | 'chip_terminator';

/**
 * `keys` are tried in order against the pack, then `names` (English, ignoring case). `block` is what a placed part
 * looks like; `'item'` means the resolved item's own id and meta.
 */
export interface PartDef { name: string; keys: readonly ItemKey[]; names: readonly string[]; block: BlockRef | 'item' }

const GT_META_ITEM = 'gregtech:gt.metaitem.01';
const PR_TRANSPORT = 'ProjRed|Transportation:projectred.transportation';
const EIO_LIQUID_CONDUIT = 'EnderIO:itemLiquidConduit';

function partDef(name: string, key: ItemKey, block: BlockRef | 'item', otherNames: readonly string[] = []): PartDef {
  return Object.freeze({
    name, keys: Object.freeze([key]), names: Object.freeze([name, ...otherNames]), block: block === 'item' ? block : Object.freeze(block),
  });
}

/** An ender fluid conduit by its `FLUID_CONDUITS` row: the pack's item name and meta, drawn as its `conduit:<kind>` pseudo block. */
function fluidConduitDef(kind: ConduitKind): PartDef {
  const row = FLUID_CONDUITS.find((c) => c.kind === kind);
  if (row === undefined) throw new RangeError(`${kind} is not an ender fluid conduit`);
  return partDef(CONDUIT_NAMES[kind], `${EIO_LIQUID_CONDUIT}@${row.meta}`, conduitBlockRef(kind));
}

/** The pack's usual ids for each part (research gt-mechanics §3.8 for the GT covers). */
export const PART_DEFS: Readonly<Record<PartId, PartDef>> = Object.freeze({
  conveyor_cover: partDef('Conveyor Module (LV)', `${GT_META_ITEM}@32630`, 'item'),
  pump_cover: partDef('Electric Pump (LV)', `${GT_META_ITEM}@32610`, 'item'),
  // @32729 is the Component_Filter crafting component, not the cover
  item_filter_cover: partDef('Filtered Conveyor Cover (Export)', `${GT_META_ITEM}@32270`, 'item'),
  chest: partDef('Chest', 'minecraft:chest@0', { id: 'minecraft:chest', meta: 0 }),
  pr_junction: partDef('Routed Junction Pipe', `${PR_TRANSPORT}.pipe@1`, partBlockRef('pr_rbasic')),
  pr_interface: partDef('Routed Interface Pipe', `${PR_TRANSPORT}.pipe@2`, partBlockRef('pr_rinterface')),
  pr_request: partDef('Routed Request Pipe', `${PR_TRANSPORT}.pipe@4`, partBlockRef('pr_rrequest'), ['Request Pipe']),
  chip_responder: partDef('Item Responder Chip', `${PR_TRANSPORT}.routingchip@0`, 'item'),
  chip_extractor: partDef('Item Extractor Chip', `${PR_TRANSPORT}.routingchip@4`, 'item'),
  chip_stock_keeper: partDef('Item Stock Keeper Chip', `${PR_TRANSPORT}.routingchip@6`, 'item'),
  me_interface: partDef('ME Interface', 'appliedenergistics2:tile.BlockInterface@0', { id: 'appliedenergistics2:tile.BlockInterface', meta: 0 }),
  me_cable: partDef('ME Glass Cable - Fluix', 'appliedenergistics2:item.ItemMultiPart@16', ae2CableBlockRef('glass')),
  me_export_bus: partDef('ME Export Bus', 'appliedenergistics2:item.ItemMultiPart@260', 'item'),
  blank_pattern: partDef('Blank Pattern', 'appliedenergistics2:item.ItemMultiMaterial@52', 'item'),
  eio_item_conduit: partDef('Item Conduit', 'EnderIO:itemItemConduit@0', conduitBlockRef('item')),
  eio_basic_filter: partDef('Basic Item Filter', 'EnderIO:itemBasicFilterUpgrade@0', 'item'),
  eio_advanced_filter: partDef('Advanced Item Filter', 'EnderIO:itemBasicFilterUpgrade@1', 'item'),
  eio_big_filter: partDef('Big Item Filter', 'EnderIO:itemBigFilterUpgrade@0', 'item'),
  eio_speed_upgrade: partDef('Item Conduit Speed Upgrade', 'EnderIO:itemExtractSpeedUpgrade@0', 'item'),
  eio_fluid_ender: fluidConduitDef('liquid_ender'),
  eio_fluid_crystalline: fluidConduitDef('liquid_crystalline'),
  eio_fluid_pink_slime: fluidConduitDef('liquid_pink_slime'),
  eio_fluid_melodic: fluidConduitDef('liquid_melodic'),
  eio_fluid_stellar: fluidConduitDef('liquid_stellar'),
  // the feeding fix (architecture §11 entry 51): the routed output chest's chip
  chip_terminator: partDef('Item Terminator Chip', `${PR_TRANSPORT}.routingchip@3`, 'item'),
});

const PART_IDS = Object.keys(PART_DEFS) as PartId[];

/** A part resolved against one pack. `found: false` keeps the usual key and English name, and the pack lacks it. */
export interface Part { id: PartId; key: StuffKey; name: string; block: BlockRef; found: boolean }
export type Parts = Readonly<Record<PartId, Part>>;

function nameMatchKey(name: string): string {
  return name.trim().toLowerCase();
}

function itemBlock(key: ItemKey): BlockRef {
  const { id, meta } = parseItemKey(key);
  return { id, meta };
}

/**
 * Each part's key is the first of its `keys` the pack holds; else the smallest item key (string order) whose trimmed
 * name equals one of its `names`, ignoring case; else `keys[0]` with `found: false`. A found part takes the pack's
 * item name, a missing one its English name.
 */
export function resolveParts(pack: Pack): Parts {
  const byKey = new Map<PartId, ItemKey>();
  const wantedNames = new Set<string>();
  for (const id of PART_IDS) {
    const key = PART_DEFS[id].keys.find((k) => pack.items.has(k));
    if (key !== undefined) byKey.set(id, key);
    else for (const name of PART_DEFS[id].names) wantedNames.add(nameMatchKey(name));
  }
  // one pass over the items, only when some part is not found by key
  const firstKeyByName = new Map<string, ItemKey>();
  if (wantedNames.size > 0) {
    for (const [key, item] of pack.items) {
      const name = nameMatchKey(item.name);
      if (!wantedNames.has(name)) continue;
      const known = firstKeyByName.get(name);
      if (known === undefined || key < known) firstKeyByName.set(name, key);
    }
  }
  const parts = {} as Record<PartId, Part>;
  for (const id of PART_IDS) {
    const def = PART_DEFS[id];
    let key = byKey.get(id);
    if (key === undefined) {
      for (const name of def.names) {
        const candidate = firstKeyByName.get(nameMatchKey(name));
        if (candidate !== undefined && (key === undefined || candidate < key)) key = candidate;
      }
    }
    const item = key === undefined ? undefined : pack.items.get(key);
    const resolved = key ?? def.keys[0]!;
    parts[id] = {
      id, key: resolved, name: item?.name ?? def.name, block: def.block === 'item' ? itemBlock(resolved) : { ...def.block }, found: item !== undefined,
    };
  }
  return parts;
}

/** The world block of a GregTech machine, cable or pipe. */
export function machineRef(m: Machine): BlockRef {
  return { id: GT_MACHINE_BLOCK, meta: 0, mteId: m.mteId };
}

// ---- Cables, pipes, transformers ----

type CableMachine = Machine & { cable: NonNullable<Machine['cable']> };

/** Insulated before bare (bare wires shock players, gt-mechanics §3.3), then loss, voltage, amps and mteId, all ascending. */
function cableOrder(a: CableMachine, b: CableMachine): number {
  return Number(b.cable.insulated) - Number(a.cable.insulated) || a.cable.lossPerBlock - b.cable.lossPerBlock
    || a.cable.voltage - b.cable.voltage || a.cable.amps - b.cable.amps || a.mteId - b.mteId;
}

/**
 * The cable for packets of `need.volts` carrying `need.amps`: among cables rated for the volts, the first in
 * `cableOrder` that carries the amps; when none does, the first of the highest-amp ones with `ampsShort` (the caller
 * lays parallel runs). Null when no cable takes the volts.
 */
export function pickCable(pack: Pack, need: { volts: number; amps: number }): { cable: Machine; ampsShort: boolean } | null {
  const rated: CableMachine[] = [];
  for (const m of pack.machines.values()) if (m.kind === 'cable' && m.cable !== undefined && m.cable.voltage >= need.volts) rated.push(m as CableMachine);
  if (rated.length === 0) return null;
  const enough = rated.filter((m) => m.cable.amps >= need.amps);
  if (enough.length > 0) return { cable: enough.sort(cableOrder)[0]!, ampsShort: false };
  const most = Math.max(...rated.map((m) => m.cable.amps));
  return { cable: rated.filter((m) => m.cable.amps === most).sort(cableOrder)[0]!, ampsShort: true };
}

/** The candidate with the smallest capacity ≥ `rate`, else the one with the largest; ties by mteId. */
function smallestEnough(candidates: ReadonlyArray<{ m: Machine; capacity: number }>, rate: number): Machine | null {
  const sorted = [...candidates].sort((a, b) => a.capacity - b.capacity || a.m.mteId - b.m.mteId);
  const enough = sorted.find((c) => c.capacity >= rate);
  if (enough !== undefined) return enough.m;
  const largest = sorted[sorted.length - 1];
  return largest === undefined ? null : sorted.find((c) => c.capacity === largest.capacity)!.m;
}

/** The item pipe for `stacksPerSecond` (`Machine.itemPipe`). */
export function pickItemPipe(pack: Pack, stacksPerSecond: number): Machine | null {
  const candidates: Array<{ m: Machine; capacity: number }> = [];
  for (const m of pack.machines.values()) if (m.kind === 'item_pipe' && m.itemPipe !== undefined) candidates.push({ m, capacity: m.itemPipe.stacksPerSecond });
  return smallestEnough(candidates, stacksPerSecond);
}

/** The fluid pipe for `litresPerSecond` (`Machine.fluidPipe`). */
export function pickFluidPipe(pack: Pack, litresPerSecond: number): Machine | null {
  const candidates: Array<{ m: Machine; capacity: number }> = [];
  for (const m of pack.machines.values()) if (m.kind === 'fluid_pipe' && m.fluidPipe !== undefined) candidates.push({ m, capacity: m.fluidPipe.litresPerSecond });
  return smallestEnough(candidates, litresPerSecond);
}

/**
 * The transformer between `lowerTier + 1` and `lowerTier` (a transformer's tier is its lower side, gt-mechanics §3.6):
 * the plain `MTETransformer` before others of that tier (hi-amp, power transformers), then mteId.
 */
export function pickTransformer(pack: Pack, lowerTier: number): Machine | null {
  const rank = (m: Machine) => (simpleClassName(m.cls) === 'MTETransformer' ? 0 : 1);
  const transformers = [...pack.machines.values()].filter((m) => m.kind === 'transformer' && m.tier === lowerTier);
  return transformers.sort((a, b) => rank(a) - rank(b) || a.mteId - b.mteId)[0] ?? null;
}

// ---- Hatches and buses ----

/** GT's hatch classes the layout places: the planner's six, the muffler, and a steam multiblock's buses and steam hatch (GT++). */
export type HatchClass = 'MTEHatchEnergy' | 'MTEHatchInputBus' | 'MTEHatchOutputBus' | 'MTEHatchInput' | 'MTEHatchOutput' | 'MTEHatchMaintenance'
  | 'MTEHatchMuffler' | 'MTEHatchSteamBusInput' | 'MTEHatchSteamBusOutput' | 'MTEHatchCustomFluidBase';

const BUS_CLASSES: ReadonlySet<HatchClass> = new Set<HatchClass>(['MTEHatchInputBus', 'MTEHatchOutputBus']);
const FLUID_HATCH_CLASSES: ReadonlySet<HatchClass> = new Set<HatchClass>(['MTEHatchInput', 'MTEHatchOutput']);

/** Item slots of a bus: `(tier + 1)²`; input buses have one more slot for a circuit (research §3.8). */
export function busSlots(tier: number): number {
  return (tier + 1) ** 2;
}

/** Litres a fluid hatch holds: `8000 × 2^tier` (research §3.8). */
export function hatchLitres(tier: number): number {
  return 8000 * 2 ** tier;
}

/**
 * The hatch of class `cls`: of exactly `tier` when given; else the lowest tier that holds `need.slots` (buses) or
 * `need.litres` (fluid hatches), else the lowest tier. Ties by mteId. A hatch without a tier sorts last and never
 * counts as big enough. Callers that get one smaller than `need` warn `hatch_small`.
 */
export function pickHatch(pack: Pack, cls: HatchClass, tier: number | null, need?: { slots?: number; litres?: number }): Machine | null {
  const hatches = [...pack.machines.values()].filter((m) => m.kind === 'hatch' && simpleClassName(m.cls) === cls);
  const byTier = (a: Machine, b: Machine) => (a.tier ?? Infinity) - (b.tier ?? Infinity) || a.mteId - b.mteId;
  if (tier !== null) return hatches.filter((m) => m.tier === tier).sort(byTier)[0] ?? null;
  hatches.sort(byTier);
  const holds = (m: Machine): boolean => {
    if (m.tier === undefined) return false;
    if (BUS_CLASSES.has(cls) && need?.slots !== undefined) return busSlots(m.tier) >= need.slots;
    if (FLUID_HATCH_CLASSES.has(cls) && need?.litres !== undefined) return hatchLitres(m.tier) >= need.litres;
    return true;
  };
  return hatches.find(holds) ?? hatches[0] ?? null;
}

// ---- Conveyor and pump covers ----

export interface CoverRate { tier: number; key: ItemKey; name: string; perSecond: number }

function coverRate(tier: number, meta: number, name: string, perSecond: number): CoverRate {
  return Object.freeze({ tier, key: `${GT_META_ITEM}@${meta}`, name, perSecond });
}

/**
 * Cover throughput LV–ZPM (research gt-mechanics §3.8, GT 5.09.54.183 `MetaGeneratedItem01.registerCovers`): conveyors
 * move `stacksPerTransfer × itemsPerStack` items every `tickRate` ticks, pumps `litresPerTick × 20` L/s.
 */
export const COVER_RATES: { readonly conveyor: readonly CoverRate[] /* items/s */; readonly pump: readonly CoverRate[] /* L/s */ } = Object.freeze({
  conveyor: Object.freeze([
    coverRate(1, 32630, 'Conveyor Module (LV)', 3.2),       // 16 items / 100 ticks
    coverRate(2, 32631, 'Conveyor Module (MV)', 12.8),      // 64 / 100
    coverRate(3, 32632, 'Conveyor Module (HV)', 64),        // 64 / 20
    coverRate(4, 32633, 'Conveyor Module (EV)', 320),       // 64 / 4
    coverRate(5, 32634, 'Conveyor Module (IV)', 1280),      // 64 / 1
    coverRate(6, 32635, 'Conveyor Module (LuV)', 5120),     // 4 × 64 / 1
    coverRate(7, 32636, 'Conveyor Module (ZPM)', 20480),    // 16 × 64 / 1
  ]),
  pump: Object.freeze([
    coverRate(1, 32610, 'Electric Pump (LV)', 640),         // 32 L/t
    coverRate(2, 32611, 'Electric Pump (MV)', 2560),        // ×4 per tier
    coverRate(3, 32612, 'Electric Pump (HV)', 10240),
    coverRate(4, 32613, 'Electric Pump (EV)', 40960),
    coverRate(5, 32614, 'Electric Pump (IV)', 163840),
    coverRate(6, 32615, 'Electric Pump (LuV)', 655360),
    coverRate(7, 32616, 'Electric Pump (ZPM)', 2621440),    // 131,072 L/t
  ]),
});

/** `short`: the cover moves less than the rate asked for. `found: false`: the pack has no such cover at all. */
export interface CoverPick { key: ItemKey; name: string; tier: number; perSecond: number; short: boolean; found: boolean }

/** Covers are offered up to the group's tier, but never below LV, the lowest cover tier. */
function coverTierCap(groupTier: number): number {
  return Math.max(1, groupTier);
}

function pickCover(rows: readonly CoverRate[], pack: Pack, rate: number, groupTier: number): CoverPick {
  const cap = coverTierCap(groupTier);
  const candidates = rows.filter((r) => r.tier <= cap && pack.items.has(r.key)).sort((a, b) => a.perSecond - b.perSecond);
  if (candidates.length === 0) {
    const first = rows[0]!;
    return { key: first.key, name: first.name, tier: first.tier, perSecond: first.perSecond, short: rate > first.perSecond, found: false };
  }
  const enough = candidates.find((r) => r.perSecond >= rate);
  const row = enough ?? candidates[candidates.length - 1]!;
  return { key: row.key, name: pack.items.get(row.key)?.name ?? row.name, tier: row.tier, perSecond: row.perSecond, short: enough === undefined, found: true };
}

/** The smallest conveyor cover up to `groupTier` that moves `itemsPerSecond`, else the biggest one (`short`). */
export function pickConveyor(pack: Pack, itemsPerSecond: number, groupTier: number): CoverPick {
  return pickCover(COVER_RATES.conveyor, pack, itemsPerSecond, groupTier);
}

/** The smallest pump cover up to `groupTier` that moves `litresPerSecond`, else the biggest one (`short`). */
export function pickPump(pack: Pack, litresPerSecond: number, groupTier: number): CoverPick {
  return pickCover(COVER_RATES.pump, pack, litresPerSecond, groupTier);
}

/** The `cover_rate` warning for a `short` pick; the tier named is the one the pick was capped at. */
export function coverRateWarning(kind: 'conveyor' | 'pump', pick: CoverPick, rate: number, groupTier: number, machine: string, stepId?: string): PlanWarning {
  const unit = kind === 'conveyor' ? 'items/s' : 'L/s';
  return {
    code: 'cover_rate', ...(stepId === undefined ? {} : { stepId }),
    text: `No ${kind} cover up to ${tierName(coverTierCap(groupTier))} moves ${fmtRate(rate)} ${unit} out of ${machine}: `
      + `the ${pick.name} moves ${fmtRate(pick.perSecond)} ${unit}, so the line runs slower`,
  };
}

// ---- AE2 idle draw ----

/**
 * Idle AE/t per placed part (research §3.8, AE2 rv3-beta-1073-GTNH): `AENetworkProxy` idles at 1 AE/t, `PartCable`
 * sets 0, the ME Interface and the ME Export Bus keep 1.
 */
export const AE2_IDLE_AE_PER_TICK: Readonly<Record<'me_interface' | 'me_cable' | 'me_export_bus', number>> = Object.freeze({
  me_interface: 1, me_cable: 0, me_export_bus: 1,
});

/** AE per EU: `PowerRatios.IC2 = 2.0`, so 1 EU = 2 AE. */
export const AE_PER_EU = 2;

/** EU/t the line's ME parts draw while idle: Σ idle AE/t of non-ghost blocks whose item is one of those parts, ÷ `AE_PER_EU`. */
export function ae2IdleEUt(blocks: readonly LayoutBlock[], parts: Parts): number {
  const idleByKey = new Map<StuffKey, number>();
  for (const id of Object.keys(AE2_IDLE_AE_PER_TICK) as Array<keyof typeof AE2_IDLE_AE_PER_TICK>) {
    if (!idleByKey.has(parts[id].key)) idleByKey.set(parts[id].key, AE2_IDLE_AE_PER_TICK[id]);
  }
  let ae = 0;
  for (const b of blocks) if (b.role !== 'ghost' && b.item !== undefined) ae += idleByKey.get(b.item) ?? 0;
  return ae / AE_PER_EU;
}
