// Hookups of a line into the base (Plan 5 Task 9; spec §3.5, §3.6, §3.8, §5): which power and logistics network the
// line joins and at which tap, the route of the hookup through the scanned world from the tap to the line, the cable
// or logistics parts laid along it, and the existing blocks shown as faint ghosts where the line connects.
// A hookup goes round the line's box and ends beside it, goes round the areas kept for the line's farms (add-on 17), and
// touches nothing it must keep away from (another tier's cable, a machine below its tier); its blocks link only to each
// other, the tap and the port they end at. One that ends on an EnderIO conduit face also keeps off its `keepOff` cells
// (plan 11, ruling R14).
// A hookup cable is never laid onto a tap whose own cable is rated for fewer amps than the line draws (spec §5): that
// hookup stays a dashed guide with `power_amps_low`, and Task 10 writes the upgrade step from `blocked`. A route that
// cannot be found within the node budget becomes a dashed guide round the line (`found: false`, `no_path`). Every
// order and tie-break is fixed, so the same scan and voxels give the same hookups.

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
import { machineByMteId } from '../pack/lookup.ts';
import type { BlockConfig } from './arrange.ts';
import type { ModeHookup } from './modes/mode.ts';
import { findPath, linkBits, MAX_PATH_NODES, straightPath, type PathBounds } from './path.ts';
import { machineRef, pickCable, type PartId, type Parts } from './parts.ts';
import { lineLossEUt, LOSS_WARN_FRACTION } from './power.ts';
import { isReplaceable } from './site.ts';

// ---- Types ----

export interface RouteWorld {
  vox: Voxels | null;
  /** World posKeys of every line block (and of the air cells a multiblock needs). */
  line: ReadonlySet<string>;
  /**
   * The line's world box, inclusive: a hookup goes round it, never through, over or under it (no cell in the box's
   * columns), and ends at a port's level neighbour outside it.
   */
  box?: PathBounds;
  /** World posKeys of blocks no hookup cell may touch: another tier's cable, a transformer, a machine below its tier. */
  keepAway?: ReadonlySet<string>;
  /**
   * World posKeys no hookup cell may take (plan 11, ruling R14): set only for a hookup that ends on an EnderIO conduit
   * face. The route search and the dashed guide's search keep off them; a straight guide, the last resort, does not.
   */
  keepOff?: ReadonlySet<string>;
  /**
   * The world boxes, inclusive, of the areas kept for the line's farms (add-on 17, farms.ts): a hookup goes round them as
   * it goes round the line's box (no cell in their columns, and no block laid there by a straight guide either), so it
   * never takes the ground a farm's build step sends the group to build on.
   */
  areas?: readonly PathBounds[];
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

/** The horizontal sides first (north, south, west, east), then up, then down: a hookup prefers to arrive level. */
const LEVEL_FIRST: readonly number[] = [2, 3, 4, 5, 1, 0];
const LEVEL: readonly number[] = [2, 3, 4, 5];

/** Whether `p` stands in one of the box's columns (any height): over, in or under the line. */
function inColumns(p: Vec3, box: PathBounds): boolean {
  return p[0] >= box.min[0] && p[0] <= box.max[0] && p[2] >= box.min[2] && p[2] <= box.max[2];
}

/** Whether `p` stands in the columns of an area kept for a farm (`RouteWorld.areas`). */
function inAreas(p: Vec3, world: RouteWorld): boolean {
  return world.areas?.some((a) => inColumns(p, a)) === true;
}

/**
 * Whether a hookup may use `p` whatever the terrain: not a line cell, not kept off, outside the line's columns and the
 * farms' areas' columns, touching nothing to keep away from.
 */
function clearOfLine(world: RouteWorld, p: Vec3): boolean {
  if (world.line.has(posKey(p)) || world.keepOff?.has(posKey(p)) === true || (world.box !== undefined && inColumns(p, world.box))) return false;
  if (inAreas(p, world)) return false;
  const keepAway = world.keepAway;
  return keepAway === undefined || !DIRS.some((_, side) => keepAway.has(posKey(step(p, side))));
}

/** The sides of a port a hookup may end at: with a line box only the level ones (it arrives beside the line). */
function portSides(world: RouteWorld): readonly number[] {
  return world.box === undefined ? LEVEL_FIRST : LEVEL;
}

/** The cells a hookup may start from (the tap's neighbours, level ones first) and end at (the ports' neighbours). */
function endCells(world: RouteWorld, tap: Vec3, ports: readonly Vec3[]): { starts: Vec3[]; goals: Vec3[] } {
  const sides = portSides(world);
  return { starts: LEVEL_FIRST.map((side) => step(tap, side)), goals: ports.flatMap((p) => sides.map((side) => step(p, side))) };
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
    const machine = machineByMteId(pack, ref.mteId);
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
 * The amp rating of the tap's own cable: `tap.cableAmps`, else the cable whose block stands at the tap in `vox`;
 * undefined when neither says (spec §5: the cable is what a hookup must not overload; spare generation is the power
 * fit's business).
 */
export function tapCableAmps(pack: Pack, vox: Voxels | null, tap: LayoutTap): number | undefined {
  if (tap.cableAmps !== undefined) return tap.cableAmps;
  const ref = existingBlock(vox, tap.pos);
  return ref?.mteId === undefined ? undefined : machineByMteId(pack, ref.mteId)?.cable?.amps;
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

/** `choosePowerTap`'s two classes of taps that can carry the line: those with `amps` free, then the others whose cable carries `amps`. */
export function carryingTaps<T extends LayoutTap>(taps: readonly T[], amps: number): [T[], T[]] {
  return [taps.filter((t) => freeAmpsOf(t) >= amps), taps.filter((t) => freeAmpsOf(t) < amps && cableAmpsOf(t) >= amps)];
}

// ---- Routes ----

/** A neighbour of `p` nearest to `toward` (ties level first), clear of the line unless no neighbour is. */
function guideEnd(world: RouteWorld, p: Vec3, toward: Vec3, sides: readonly number[]): Vec3 {
  const all = sides.map((side) => step(p, side));
  const clear = all.filter((c) => clearOfLine(world, c));
  return nearestOf(clear.length > 0 ? clear : all, toward)!;
}

/** A straight guide from the tap's neighbour nearest to the nearest port to that port's neighbour nearest to the tap. */
function straightGuide(world: RouteWorld, tap: Vec3, ports: readonly Vec3[]): Vec3[] {
  const port = nearestOf(ports, tap);
  if (port === undefined) return [];
  return straightPath(guideEnd(world, tap, port, LEVEL_FIRST), guideEnd(world, port, tap, portSides(world)));
}

/** The box around the taps and the ports (and the line), `HOOKUP_REACH` wider on every side. */
function reachBounds(world: RouteWorld, taps: readonly Vec3[], ports: readonly Vec3[]): PathBounds {
  const around = bboxOf([...taps, ...ports, ...(world.box === undefined ? [] : [world.box.min, world.box.max])])!;
  return {
    min: [around.min[0] - HOOKUP_REACH, around.min[1] - HOOKUP_REACH, around.min[2] - HOOKUP_REACH],
    max: [around.max[0] + HOOKUP_REACH, around.max[1] + HOOKUP_REACH, around.max[2] + HOOKUP_REACH],
  };
}

/**
 * The route of a hookup: A* from the tap's face neighbours to the ports' face neighbours (`endCells`), through cells
 * that are inside the voxel box, known, air or replaceable, clear of the line (`clearOfLine`) and within 16 blocks of
 * the tap and ports. Without voxels or when nothing is found: a dashed guide (`found: false`) by the same search with
 * the terrain ignored, so it still goes round the line; a straight one only when even that finds nothing.
 */
export function hookupPath(world: RouteWorld, tap: Vec3, ports: readonly Vec3[], maxNodes?: number): { path: Vec3[]; found: boolean } {
  const { vox } = world;
  if (ports.length === 0) return { path: [], found: false };
  const clear = (p: Vec3) => clearOfLine(world, p);
  const { starts, goals } = endCells(world, tap, ports);
  const reach = reachBounds(world, [tap], ports);
  const budget = maxNodes ?? MAX_PATH_NODES;
  if (vox !== null) {
    const passable = (p: Vec3) => clear(p) && isFreeVoxel(vox, p);
    const route = findPath(starts.filter(passable), goals.filter(passable), { passable, bounds: intersect(voxelBounds(vox), reach), maxNodes: budget });
    if (route.found) return { path: route.path, found: true };
  }
  const guide = findPath(starts.filter(clear), goals.filter(clear), { passable: clear, bounds: reach, maxNodes: budget });
  return { path: guide.found ? guide.path : straightGuide(world, tap, ports), found: false };
}

/**
 * Which of `taps` a hookup can leave (architecture §11 entry 52): `hookupPath`'s route search, run once from the face
 * neighbours of every tap at the same time, through the same cells to the same goals, inside the voxel box and within 16
 * blocks of the taps and ports. The tap the cheapest route leaves from (routes of equal cost go by the search's fixed
 * order, which takes the taps in the order given); null without voxels or when no route is found. It draws no guide.
 */
export function reachableTap<T extends TapPoint>(world: RouteWorld, taps: readonly T[], ports: readonly Vec3[], maxNodes?: number): T | null {
  const { vox } = world;
  if (vox === null || taps.length === 0 || ports.length === 0) return null;
  const passable = (p: Vec3) => clearOfLine(world, p) && isFreeVoxel(vox, p);
  // each passable start cell with the first tap it is a face neighbour of
  const leaves = new Map<string, { start: Vec3; tap: T }>();
  for (const tap of taps) {
    for (const start of endCells(world, tap.pos, ports).starts) if (passable(start) && !leaves.has(posKey(start))) leaves.set(posKey(start), { start, tap });
  }
  const { goals } = endCells(world, taps[0]!.pos, ports);                // the same for every tap
  const route = findPath([...leaves.values()].map((l) => l.start), goals.filter(passable), {
    passable, bounds: intersect(voxelBounds(vox), reachBounds(world, taps.map((t) => t.pos), ports)), maxNodes: maxNodes ?? MAX_PATH_NODES,
  });
  return route.found ? leaves.get(posKey(route.path[0]!))!.tap : null;
}

/** The side of `cell` that touches a port (DIRS order); -1 when none does. */
function portSide(cell: Vec3, ports: readonly Vec3[]): number {
  const portKeys = new Set(ports.map(posKey));
  return DIRS.findIndex((_, side) => portKeys.has(posKey(step(cell, side))));
}

/**
 * The connection bits of a hookup's laid cells: between consecutive laid cells, the first path cell toward the tap and
 * the last toward its port when laid. Never toward a cell the hookup does not lay (a line cell a straight guide crossed).
 */
function hookupBits(path: readonly Vec3[], laid: ReadonlySet<string>, tap: Vec3, ports: readonly Vec3[]): Map<string, number> {
  const isLaid = (p: Vec3 | undefined): p is Vec3 => p !== undefined && laid.has(posKey(p));
  const links: Array<[Vec3, Vec3]> = [];
  const first = path[0], last = path[path.length - 1];
  if (isLaid(first) && sideToward(first, tap) !== -1) links.push([first, tap]);
  for (let i = 0; i + 1 < path.length; i++) if (isLaid(path[i]) && isLaid(path[i + 1])) links.push([path[i]!, path[i + 1]!]);
  if (isLaid(last)) {
    const side = portSide(last, ports);
    if (side !== -1) links.push([last, step(last, side)]);
  }
  return linkBits(links);
}

/**
 * The cells a hookup lays a block on: every path cell outside the line, its columns and the farms' areas' columns (only a
 * straight guide can cross them).
 */
function runCells(path: readonly Vec3[], world: RouteWorld): Vec3[] {
  return path.filter((p) => !world.line.has(posKey(p)) && (world.box === undefined || !inColumns(p, world.box)) && !inAreas(p, world));
}

/** The tap as Plan 4 gives it (a `LayoutTap`'s `cableAmps` is the layout's own reading, not part of the hookup). */
function copyTap(tap: LayoutTap): TapPoint {
  const { cableAmps: _rating, ...plain } = tap;
  return { ...plain, pos: [...tap.pos] };
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
 * is rated for fewer amps than the line draws (`tapCableAmps`; unknown → its free amps, ruling R9) is never wired — the
 * route stays a dashed guide and `blocked` names the cable to upgrade — but the loss and arriving volts still describe
 * the run that is laid after the upgrade. Spare generation below the line's amps is not a reason: the power fit says it.
 */
export function powerHookup(input: { pack: Pack; tap: LayoutTap; ports: readonly Vec3[]; world: RouteWorld; supplyTier: number; amps: number; maxNodes?: number }): PowerHookupBuild {
  const { pack, tap, ports, world, supplyTier, amps } = input;
  const volts = voltsOf(supplyTier);
  const route = hookupPath(world, tap.pos, ports, input.maxNodes);
  const run = runCells(route.path, world);
  const rated = tapCableAmps(pack, world.vox, tap);
  const tapTooSmall = (rated ?? freeAmpsOf(tap)) < amps;
  const tapBlock = existingBlock(world.vox, tap.pos);
  const tapCable = tapBlock === null ? 'cable' : blockName(pack, tapBlock);
  const blocked = tapTooSmall ? { cable: tapCable, amps } : null;
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
      const bits = hookupBits(route.path, new Set(run.map(posKey)), tap.pos, ports);
      blocks = run.map((pos): LayoutBlock => {
        const connections = bits.get(posKey(pos));
        return { pos: [...pos], block: machineRef(cable), role: 'cable', label: cable.name, item: cable.itemKey, ...(connections === undefined ? {} : { connections }) };
      });
      parts = [{ key: cable.itemKey, amount: blocks.length, why: 'power hookup', group: 'power' }];
    }
  }
  if (blocked !== null) {
    const tier = tierName(tap.voltageTier ?? supplyTier);
    warnings.push({ code: 'power_amps_low', text: rated === undefined
      ? `The tap has ${fmtInt(freeAmpsOf(tap))} A free at ${tier} and its cable's rating is unknown; the line draws up to ${fmtInt(amps)} A`
      : `The tap's ${tapCable} carries ${fmtInt(rated)} A at ${tier}; the line draws up to ${fmtInt(amps)} A` });
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
  const run = runCells(route.path, world);
  const bits = hookupBits(route.path, new Set(run.map(posKey)), tap.pos, ports);
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
