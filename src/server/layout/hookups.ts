// Hookups of a line into the base (Plan 5 Task 9; spec §3.5, §3.6, §3.8, §5): which power and logistics network the
// line joins and at which tap, the route of the hookup through the scanned world from the tap to the line, the cable
// or logistics parts laid along it, and the existing blocks shown as faint ghosts where the line connects.
// A hookup cable is never laid onto a tap whose cable carries fewer amps than the line draws (spec §5): that hookup
// stays a dashed guide with `power_amps_low`, and Task 10 writes the upgrade step from `blocked`. A route that cannot
// be found within the node budget becomes a straight guide (`found: false`, `no_path`). Every order and tie-break is
// fixed, so the same scan and voxels give the same hookups.

import { tierName, V } from '../../shared/gt/tiers.ts';
import { itemKey, type StuffKey } from '../../shared/keys.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import { bboxOf, DIRS, manhattan, posKey, sideToward, step, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { BlockRole, ConduitSpec, Hookup, LayoutBlock, LayoutTap } from '../../shared/types/layout.ts';
import type { BlockRef, Machine, Pack } from '../../shared/types/pack.ts';
import type { BomLine, LogisticsMode, PlanWarning } from '../../shared/types/plan.ts';
import {
  AIR_INDEX, UNKNOWN_INDEX, type Base, type LogisticsNetwork, type PowerNetwork, type TapPoint, type Voxels, type WorldScan,
} from '../../shared/types/world.ts';
import type { BlockConfig } from './arrange.ts';
import type { ModeHookup } from './modes/mode.ts';
import { findPath, linkBits, MAX_PATH_NODES, straightPath, type PathBounds } from './path.ts';
import { machineRef, pickCable, type PartId, type Parts } from './parts.ts';
import { lineLossEUt, LOSS_WARN_FRACTION } from './power.ts';
import { isReplaceable } from './site.ts';

// ---- Types ----

export interface RouteWorld {
  vox: Voxels | null; line: ReadonlySet<string> /* world posKeys of every line block */;
  /** World posKeys the route search also keeps off (plan 11, ruling R14); a straight guide and the laid cells ignore them. */
  keepOff?: ReadonlySet<string>;
}
export interface HookupBuild { hookup: Hookup; blocks: LayoutBlock[]; warnings: PlanWarning[]; found: boolean }
export interface PowerHookupBuild extends HookupBuild {
  cable: Machine | null; lossEUt: number; arrivingVolts: number;
  /** Set when the tap's own cable cannot carry the line: nothing is laid and Task 10 writes the upgrade step. */
  blocked: { cable: string; amps: number } | null;
}

/** The search box of a hookup reaches this far past the tap and the ports. */
const HOOKUP_REACH = 16;

/** The role of a part that ends a logistics hookup; every other hookup part is a `pipe`. */
const END_ROLES: Partial<Record<PartId, BlockRole>> = { pr_interface: 'chip_pipe', me_export_bus: 'interface' };

/** The kinds of network each logistics mode hooks into, most wanted first; never a GT pipe network (research §3.8). */
const MODE_KINDS: Readonly<Record<LogisticsMode, ReadonlyArray<LogisticsNetwork['kind']>>> = {
  routed: ['routed'], ae2: ['ae2'], direct: ['routed', 'ae2', 'enderio'], enderio: ['enderio'],
};
/** Plan 4 names EnderIO networks `e:<conduit type>:…`; a liquid conduit network carries no items. */
const ENDERIO_LIQUID_PREFIX = 'e:liquid:';

// ---- Small helpers ----

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function voltsOf(tier: number): number {
  const v = V[tier];
  if (v === undefined) throw new RangeError(`tier must be an integer from 0 to ${V.length - 1}, got ${tier}`);
  return v;
}

function neighbours(p: Vec3): Vec3[] {
  return DIRS.map((_, side) => step(p, side));
}

/** The first of `ps` with the smallest manhattan distance to `target`; undefined for none. */
function nearestOf(ps: readonly Vec3[], target: Vec3): Vec3 | undefined {
  let best: Vec3 | undefined;
  let bestDistance = Infinity;
  for (const p of ps) {
    const d = manhattan(p, target);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

// ---- Voxels ----

/** The palette index at world `p`; `UNKNOWN_INDEX` outside the box. */
function voxelIndex(vox: Voxels, p: Vec3): number {
  const x = p[0] - vox.origin[0], y = p[1] - vox.origin[1], z = p[2] - vox.origin[2];
  const [sx, sy, sz] = vox.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return UNKNOWN_INDEX;
  return vox.blocks[(y * sz + z) * sx + x] ?? UNKNOWN_INDEX;
}

/** Inside the box, known, and air or a block a line may be built through. */
function isFreeVoxel(vox: Voxels, p: Vec3): boolean {
  const index = voxelIndex(vox, p);
  if (index === UNKNOWN_INDEX) return false;
  if (index === AIR_INDEX) return true;
  const ref = vox.palette[index];
  return ref !== undefined && isReplaceable(ref);
}

/** The block at `p` when it is known and neither air nor replaceable; else null. */
function existingBlock(vox: Voxels | null, p: Vec3): BlockRef | null {
  if (vox === null) return null;
  const index = voxelIndex(vox, p);
  if (index === UNKNOWN_INDEX || index === AIR_INDEX) return null;
  const ref = vox.palette[index];
  return ref === undefined || isReplaceable(ref) ? null : ref;
}

function voxelBounds(vox: Voxels): PathBounds {
  const [ox, oy, oz] = vox.origin;
  return { min: [ox, oy, oz], max: [ox + vox.size[0] - 1, oy + vox.size[1] - 1, oz + vox.size[2] - 1] };
}

/** `a ∩ b` (inclusive corners; may be empty, which the router treats as no cell inside). */
function intersect(a: PathBounds, b: PathBounds): PathBounds {
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

/** The machine name by mteId, else the item name of `id@meta`, else the block id. */
export function blockName(pack: Pack, ref: BlockRef): string {
  if (ref.mteId !== undefined) {
    const machine = pack.machines.get(ref.mteId);
    if (machine !== undefined) return machine.name;
  }
  let name: string | undefined;
  try {
    name = pack.items.get(itemKey(ref.id, ref.meta))?.name;
  } catch {
    name = undefined;                                                    // a meta no item key can hold
  }
  return name ?? ref.id;
}

// ---- Network and tap choice ----

/**
 * The networks that have taps and belong to `base`; when none does, those with a tap in the base's dimension (Plan 4
 * gives a network the base most of its blocks stand in, or null).
 */
function atBase<T extends { baseId: string | null; taps: readonly TapPoint[] }>(networks: readonly T[], base: Base): T[] {
  const tapped = networks.filter((n) => n.taps.length > 0);
  const own = tapped.filter((n) => n.baseId === base.id);
  return own.length > 0 ? own : tapped.filter((n) => n.taps.some((t) => t.dim === base.dim));
}

/** The power network to feed the line from: at or above `lineTier` first, then the most spare EU/t, then id. */
export function choosePowerNetwork(scan: WorldScan, base: Base, lineTier: number): PowerNetwork | null {
  const spare = (n: PowerNetwork) => n.generatorEUt.average - (n.loadEUt ?? 0);
  const reaches = (n: PowerNetwork) => Number(n.voltageTier >= lineTier);
  return atBase(scan.power, base).sort((a, b) => reaches(b) - reaches(a) || spare(b) - spare(a) || compareText(a.id, b.id))[0] ?? null;
}

/**
 * The logistics network the mode hooks into (spec §3.6): routed → routed, AE2 → AE2, machine to machine → routed,
 * else AE2, else an EnderIO item network; never a GT pipe network. Within one kind the most nodes, then id.
 */
export function chooseLogisticsNetwork(scan: WorldScan, base: Base, mode: LogisticsMode): LogisticsNetwork | null {
  const kinds = MODE_KINDS[mode];
  const carriesItems = (n: LogisticsNetwork) => n.kind !== 'enderio' || !n.id.startsWith(ENDERIO_LIQUID_PREFIX);
  const eligible = scan.logistics.filter((n) => kinds.includes(n.kind) && carriesItems(n));
  return atBase(eligible, base)
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || b.nodes - a.nodes || compareText(a.id, b.id))[0] ?? null;
}

/** The tap with the smallest manhattan distance to `target`, ties by posKey; null for no taps. */
export function nearestTap<T extends TapPoint>(taps: readonly T[], target: Vec3): T | null {
  let best: T | null = null;
  let bestDistance = Infinity, bestKey = '';
  for (const tap of taps) {
    const d = manhattan(tap.pos, target), key = posKey(tap.pos);
    if (d < bestDistance || (d === bestDistance && key < bestKey)) {
      best = tap;
      bestDistance = d;
      bestKey = key;
    }
  }
  return best;
}

/** Free amps of a tap; a tap whose cable rating Plan 4 could not read has none (ruling R9). */
function freeAmpsOf(tap: LayoutTap): number {
  return tap.freeAmps ?? 0;
}

/** Amps the tap's own cable carries; unknown → its free amps (Plan 4 caps those at the cable's rating). */
function cableAmpsOf(tap: LayoutTap): number {
  return tap.cableAmps ?? freeAmpsOf(tap);
}

/**
 * Spec §3.5, §5 (never overload a cable): the nearest tap with `amps` free; else the nearest whose cable carries `amps`
 * (only generation is short, which the power fit reports); else the nearest of all (its hookup stays a guide).
 */
export function choosePowerTap(taps: readonly LayoutTap[], target: Vec3, amps: number): LayoutTap | null {
  return nearestTap(taps.filter((t) => freeAmpsOf(t) >= amps), target)
    ?? nearestTap(taps.filter((t) => cableAmpsOf(t) >= amps), target)
    ?? nearestTap(taps, target);
}

// ---- Routes ----

/** A neighbour of `p` nearest to `toward` (ties in DIRS order), outside the line unless every neighbour is in it. */
function guideEnd(p: Vec3, toward: Vec3, line: ReadonlySet<string>): Vec3 {
  const all = neighbours(p);
  const outside = all.filter((c) => !line.has(posKey(c)));
  return nearestOf(outside.length > 0 ? outside : all, toward)!;
}

/** A straight guide from the tap's neighbour nearest to the nearest port to that port's neighbour nearest to the tap. */
function guidePath(line: ReadonlySet<string>, tap: Vec3, ports: readonly Vec3[]): Vec3[] {
  const port = nearestOf(ports, tap);
  if (port === undefined) return [];
  return straightPath(guideEnd(tap, port, line), guideEnd(port, tap, line));
}

/**
 * The route of a hookup: A* from the tap's free face neighbours to the free face neighbours of the ports, through
 * cells that are inside the voxel box, known, air or replaceable, not part of the line and not kept off, within 16
 * blocks of the tap and ports. Without voxels or when nothing is found: a straight guide, `found: false`.
 */
export function hookupPath(world: RouteWorld, tap: Vec3, ports: readonly Vec3[], maxNodes?: number): { path: Vec3[]; found: boolean } {
  const { vox, line, keepOff } = world;
  if (vox !== null && ports.length > 0) {
    const around = bboxOf([tap, ...ports])!;
    const passable = (p: Vec3) => !line.has(posKey(p)) && keepOff?.has(posKey(p)) !== true && isFreeVoxel(vox, p);
    const starts = neighbours(tap).filter(passable);
    const goals = ports.flatMap(neighbours).filter(passable);
    const reach: PathBounds = {
      min: [around.min[0] - HOOKUP_REACH, around.min[1] - HOOKUP_REACH, around.min[2] - HOOKUP_REACH],
      max: [around.max[0] + HOOKUP_REACH, around.max[1] + HOOKUP_REACH, around.max[2] + HOOKUP_REACH],
    };
    const route = findPath(starts, goals, { passable, bounds: intersect(voxelBounds(vox), reach), maxNodes: maxNodes ?? MAX_PATH_NODES });
    if (route.found) return { path: route.path, found: true };
  }
  return { path: guidePath(line, tap, ports), found: false };
}

/** The side of `cell` that touches a port (DIRS order); -1 when none does. */
function portSide(cell: Vec3, ports: readonly Vec3[]): number {
  const portKeys = new Set(ports.map(posKey));
  return DIRS.findIndex((_, side) => portKeys.has(posKey(step(cell, side))));
}

/** The connection bits of a hookup: consecutive cells, the first cell toward the tap, the last toward its port. */
function hookupBits(path: readonly Vec3[], tap: Vec3, ports: readonly Vec3[]): Map<string, number> {
  const links: Array<[Vec3, Vec3]> = [];
  const first = path[0], last = path[path.length - 1];
  if (first !== undefined && sideToward(first, tap) !== -1) links.push([first, tap]);
  for (let i = 0; i + 1 < path.length; i++) links.push([path[i]!, path[i + 1]!]);
  if (last !== undefined) {
    const side = portSide(last, ports);
    if (side !== -1) links.push([last, step(last, side)]);
  }
  return linkBits(links);
}

/** The cells a hookup lays a block on: every path cell except those a line block already holds (a guide may cross the line). */
function runCells(path: readonly Vec3[], line: ReadonlySet<string>): Vec3[] {
  return path.filter((p) => !line.has(posKey(p)));
}

function copyTap<T extends TapPoint>(tap: T): T {
  return { ...tap, pos: [...tap.pos] };
}

function noPathWarning(kind: Hookup['kind']): PlanWarning {
  return {
    code: 'no_path',
    text: `Could not find a free route for the ${kind} hookup — the dashed line is a straight guide; route it around obstacles`,
  };
}

// ---- Power hookup ----

/**
 * Spec §3.5: a cable rated for the supply volts and the line's amps on every cell of the route. A tap whose own cable
 * cannot carry the line is never wired — the route stays a dashed guide and `blocked` names the cable to upgrade —
 * but the loss and arriving volts still describe the run that is laid after the upgrade.
 */
export function powerHookup(input: { pack: Pack; tap: LayoutTap; ports: readonly Vec3[]; world: RouteWorld; supplyTier: number; amps: number; maxNodes?: number }): PowerHookupBuild {
  const { pack, tap, ports, world, supplyTier, amps } = input;
  const volts = voltsOf(supplyTier);
  const route = hookupPath(world, tap.pos, ports, input.maxNodes);
  const run = runCells(route.path, world.line);
  const tapTooSmall = freeAmpsOf(tap) < amps && cableAmpsOf(tap) < amps;
  const tapBlock = existingBlock(world.vox, tap.pos);
  const blocked = tapTooSmall ? { cable: tapBlock === null ? 'cable' : blockName(pack, tapBlock), amps } : null;
  const warnings: PlanWarning[] = [];
  const pick = pickCable(pack, { volts, amps });
  let blocks: LayoutBlock[] = [];
  let parts: BomLine[] = [];
  let lossEUt = 0, arrivingVolts = volts;
  if (pick === null) {
    warnings.push({ code: 'no_cable', text: `No cable for ${tierName(supplyTier)} in this export` });
  } else {
    const { cable } = pick;
    const lossPerBlock = cable.cable!.lossPerBlock;
    lossEUt = lineLossEUt(amps, run.length, lossPerBlock);
    arrivingVolts = volts - run.length * lossPerBlock;
    if (run.length * lossPerBlock > LOSS_WARN_FRACTION * volts) {
      warnings.push({ code: 'cable_loss_high',
        text: `The power run loses ${Math.round((100 * run.length * lossPerBlock) / volts)}% over ${run.length} blocks of ${cable.name} — move the line closer to the tap or use a better cable` });
    }
    if (!tapTooSmall && run.length > 0) {
      const bits = hookupBits(route.path, tap.pos, ports);
      blocks = run.map((pos): LayoutBlock => {
        const connections = bits.get(posKey(pos));
        return { pos: [...pos], block: machineRef(cable), role: 'cable', label: cable.name, item: cable.itemKey, ...(connections === undefined ? {} : { connections }) };
      });
      parts = [{ key: cable.itemKey, amount: blocks.length, why: 'power hookup', group: 'power' }];
    }
  }
  if (blocked !== null) {
    warnings.push({ code: 'power_amps_low',
      text: `The tap has ${fmtInt(freeAmpsOf(tap))} A free at ${tierName(tap.voltageTier ?? supplyTier)}; the line draws up to ${fmtInt(amps)} A` });
  }
  if (pick?.ampsShort) {
    const cable = pick.cable;
    warnings.push({ code: 'cable_amps',
      text: `No cable carries ${fmtInt(amps)} A at ${tierName(supplyTier)}: run ${Math.ceil(amps / cable.cable!.amps)} parallel ${cable.name} lines` });
  }
  if (!route.found) warnings.push(noPathWarning('power'));
  return {
    hookup: { kind: 'power', from: copyTap(tap), path: route.path, parts, found: route.found },
    blocks, warnings, found: route.found, cable: pick?.cable ?? null, lossEUt, arrivingVolts, blocked,
  };
}

// ---- Logistics hookup ----

/**
 * The conduit on a hookup's last cell (architecture "EnderIO conduits, granted change requests (add-on 11)"): linked
 * like the cell but not toward the port (a chest is no conduit), with `endConduit`'s face on the side that touches the
 * port. Null when the cell does not touch a port (the end of a straight guide, plan 11 ruling R13).
 */
function endConduitSpec(endConduit: NonNullable<ModeHookup['endConduit']>, item: StuffKey, pos: Vec3, ports: readonly Vec3[],
  connections: number | undefined): ConduitSpec | null {
  const side = portSide(pos, ports);
  const face = FACES[side];
  if (face === undefined) return null;
  return { kind: endConduit.kind, item, connections: (connections ?? 0) & ~(1 << side), faces: [{ face, ...endConduit.face }] };
}

/**
 * The mode's hookup part on every cell of the route (role `pipe`); with `end`, the last cell is that part facing the
 * port it touches, and `endConfig` goes on the last cell; with `endConduit`, the last cell's conduit sets that face
 * toward the port it touches. Parts are counted per key, sorted by key.
 */
export function logisticsHookup(input: {
  pack: Pack; parts: Parts; tap: TapPoint; ports: readonly Vec3[]; world: RouteWorld; part: PartId; end: PartId | null;
  endConfig?: BlockConfig; endConduit?: ModeHookup['endConduit']; maxNodes?: number;
}): HookupBuild {
  const { parts, tap, ports, world, part, end, endConfig, endConduit } = input;
  const route = hookupPath(world, tap.pos, ports, input.maxNodes);
  const run = runCells(route.path, world.line);
  const bits = hookupBits(route.path, tap.pos, ports);
  const blocks = run.map((pos, i): LayoutBlock => {
    const last = i === run.length - 1;
    const endPart = last && end !== null ? end : null;
    const p = parts[endPart ?? part];
    const facing = endPart === null ? -1 : portSide(pos, ports);
    const connections = bits.get(posKey(pos));
    const conduit = last && endConduit !== undefined ? endConduitSpec(endConduit, parts[part].key, pos, ports, connections) : null;
    return {
      pos: [...pos], block: { ...p.block }, role: endPart === null ? 'pipe' : END_ROLES[endPart] ?? 'pipe',
      ...(facing === -1 ? {} : { facing }), label: p.name, item: p.key,
      ...(connections === undefined ? {} : { connections }),
      ...(last && endConfig !== undefined ? { config: { ...endConfig } } : {}),
      ...(conduit === null ? {} : { conduits: [conduit] }),
    };
  });
  const counts = new Map<StuffKey, number>();
  for (const b of blocks) counts.set(b.item!, (counts.get(b.item!) ?? 0) + 1);
  const hookupParts = [...counts]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, amount]): BomLine => ({ key, amount, why: 'logistics hookup', group: 'logistics' }));
  return {
    hookup: { kind: 'logistics', from: copyTap(tap), path: route.path, parts: hookupParts, found: route.found },
    blocks, warnings: route.found ? [] : [noPathWarning('logistics')], found: route.found,
  };
}

// ---- Ghosts ----

/**
 * Spec §3.8: existing base blocks appear only as faint ghosts where the line connects — one `ghost` per position of
 * `at` whose block is known, neither air nor replaceable, and not in `exclude`.
 */
export function ghostBlocks(vox: Voxels | null, pack: Pack, at: readonly Vec3[], exclude: ReadonlySet<string>): LayoutBlock[] {
  const ghosts: LayoutBlock[] = [];
  const seen = new Set<string>();
  for (const p of at) {
    const key = posKey(p);
    if (exclude.has(key) || seen.has(key)) continue;
    seen.add(key);
    const ref = existingBlock(vox, p);
    if (ref !== null) ghosts.push({ pos: [...p], block: { ...ref }, role: 'ghost', label: `existing ${blockName(pack, ref)}` });
  }
  return ghosts;
}
