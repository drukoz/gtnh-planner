// A line layout end to end (Plan 5 Task 11; architecture §6.7; spec §3.5–§3.8, §3.10, Review Focus 1): the plan's new
// machines placed in two rows around a spine in the project's logistics mode, wired and piped inside the line, the line
// put on clear, flat ground near the base (or where the group dragged it), hooked up to the base's power and logistics
// taps through the scanned world, with numbered pins, build steps, the grouped parts list and the power fit.
// The line is fed only from taps on the supply tier, through a hookup that touches no other tier, judged against the
// one network it is wired to. A new farm is not laid out block by block: an area is kept for each of its machines beside
// the line, found clear with it and turned with it, with a pin and one build step (add-on 17, farms.ts). Without a scan
// or base the line is still laid out at a default origin, so the 3D view and the parts list work. Every stage has fixed
// orders and tie-breaks, so the same inputs give byte-identical JSON.

import { tierName, V } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { fmtInt, fmtRate } from '../../shared/layout/format.ts';
import {
  DIRS, manhattan, posKey, rotateConnections, rotatedSize, rotateFace, rotateFacing, sideToward, step, toWorld, type Rotation, type Vec3,
} from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { FeedSpec } from '../../shared/types/feed.ts';
import type {
  ConduitFace, ConduitSpec, CoverSpec, Hookup, Layout, LayoutBlock, LayoutLoss, LayoutPowerContext, LayoutStatus, LayoutTap, Pin, ReservedArea,
  TierLoss,
} from '../../shared/types/layout.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { BomLine, LogisticsMode, Plan, PlanContext, PlanWarning, PowerSummary } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import { findBase, type Base, type BBox, type LogisticsNetwork, type PowerNetwork, type Voxels, type WorldScan } from '../../shared/types/world.ts';
import { machineByMteId } from '../pack/lookup.ts';
import { emptyContext } from '../planner/plan.ts';
import { contextFromScan } from '../world/context.ts';
import { ENERGY_HATCH_RE, simpleClassName } from '../world/facts.ts';
import { RAIN_OUTAGE_SECONDS } from '../world/power.ts';
import { addedBlocks, attachCovers, placeUnits, replacedCasings, unitsFromPlan, type LocalBlock, type Placement, type Unit } from './arrange.ts';
import { farmAreas, farmBuildText, farmExtent, farmPinPos, reservedArea, type FarmArea } from './farms.ts';
import { feedingWarnings } from './feed-rules.ts';
import {
  carryingTaps, chooseLogisticsNetwork, choosePowerNetwork, choosePowerTap, ghostBlocks, logisticsHookup, nearestTap, parallelHookupParts, powerHookup, reachableTap,
  tapCableAmps, type HookupBuild, type PowerHookupBuild, type RouteWorld,
} from './hookups.ts';
import { fluidNets, headWidthFor, parallelRunParts, routeInternal, supplyRunLoss, type InternalResult } from './internal.ts';
import { buildMode, PORT_SPACING, type ModeResult } from './modes/mode.ts';
import { ae2IdleEUt, COVER_RATES, pickTransformer, resolveParts, type Parts } from './parts.ts';
import type { PathBounds } from './path.ts';
import { findReuse, logisticsText, makePins, networkName, powerText, siteText, type PinInput, type ReuseFind } from './pins.ts';
import { fitPower, hookupAllowanceVolts, tierGroups, transformerStages, type Stages } from './power.ts';
import { baseFloorY, checkPlacement, fallbackSite, findSite, MAX_SITE_SPAN, siteSearchBox, type Site, type SiteRequest } from './site.ts';
import { assignBuildSteps, bomFromBlocks, layoutSteps, type StepsInput } from './steps.ts';

// ---- Types ----

export interface LayoutDeps {
  /** Plan 4's read-only voxel read (`WorldService.readArea` bound to the scan); without it the terrain is unknown. */
  readArea?: (dim: number, bbox: BBox) => Promise<Voxels>;
  /** The A* budget of each hookup search (default `MAX_PATH_NODES`). */
  maxPathNodes?: number;
}

/** Where a line without a scan or base is drawn. */
export const DEFAULT_ORIGIN: Vec3 = [0, 64, 0];

/** A scan with nothing in it, for a project that has not picked one: id '', no dims, bases, machines or networks. */
export function emptyScan(): WorldScan {
  return {
    id: '', source: { kind: 'server' }, scannedAt: '', levelName: '', dims: [], bases: [], machines: [], pipes: [], power: [],
    logistics: [], storage: [], visitedDims: [], topTier: null, coilHeat: null, prospected: [],
  };
}

// ---- Small helpers ----

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** x, y, z, then role, then facing (none first). */
function compareBlocks(a: LayoutBlock, b: LayoutBlock): number {
  return a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || compareText(a.role, b.role) || (a.facing ?? -1) - (b.facing ?? -1);
}

/** Each code + text once, in the order first raised. */
function dedupeWarnings(warnings: readonly PlanWarning[]): PlanWarning[] {
  const seen = new Set<string>();
  const out: PlanWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}\n${w.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

function insideBox(p: Vec3, size: Vec3): boolean {
  return p.every((v, i) => v >= 0 && v < size[i]!);
}

// ---- Power supply (stage 4) ----

/**
 * Spec §3.5, §5: the network's taps the line may be fed from — those on the network's own tier (Plan 4's highest
 * emitter tier); when none is, those on the highest tier any tap has (a cable behind one of the base's transformers),
 * which then is the line's supply tier (`other`). Taps whose tier Plan 4 could not read count only when no tap's is known.
 */
function supplyTaps(net: PowerNetwork): { tier: number; taps: LayoutTap[]; other: boolean } {
  const known = net.taps.filter((t) => t.voltageTier !== undefined);
  if (known.length === 0) return { tier: net.voltageTier, taps: [...net.taps], other: false };
  const own = known.filter((t) => t.voltageTier === net.voltageTier);
  if (own.length > 0) return { tier: net.voltageTier, taps: own, other: false };
  const tier = Math.max(...known.map((t) => t.voltageTier!));
  return { tier, taps: known.filter((t) => t.voltageTier === tier), other: true };
}

/** The taps with their own cable's amp rating (`cableAmps`): the scan's cable at the tap, else its block in `vox`. */
function ratedTaps(pack: Pack, scan: WorldScan, vox: Voxels | null, taps: readonly LayoutTap[]): LayoutTap[] {
  const ratings = new Map<string, number>();
  for (const p of scan.pipes) if (p.amps !== undefined && (p.kind ?? machineByMteId(pack, p.mteId)?.kind) === 'cable') ratings.set(`${p.dim}|${posKey(p.pos)}`, p.amps);
  return taps.map((t): LayoutTap => {
    const amps = t.cableAmps ?? ratings.get(`${t.dim}|${posKey(t.pos)}`) ?? tapCableAmps(pack, vox, t);
    return amps === undefined ? { ...t, pos: [...t.pos] } : { ...t, pos: [...t.pos], cableAmps: amps };
  });
}

/**
 * The network's cables on the supply tier that Plan 4 did not list as taps (it lists one per 16×16×16 cell, the cable that
 * comes first in (x, y, z) with a side free of tile entities, however buried), as taps (architecture §11 entry 52): free
 * amps as Plan 4 works a tap's out (the cable's rating, at most the network's spare EU/t in whole amps), `cableAmps` the
 * rating. A cable whose rating is unknown is left out.
 */
function networkCableTaps(pack: Pack, scan: WorldScan, net: PowerNetwork, dim: number, supplyTier: number, listed: readonly LayoutTap[]): LayoutTap[] {
  const spareAmps = Math.max(0, Math.floor((net.generatorEUt.average - (net.loadEUt ?? 0)) / V[supplyTier]!));
  const isListed = new Set(listed.map((t) => posKey(t.pos)));
  const taps: LayoutTap[] = [];
  for (const p of scan.pipes) {
    const machine = machineByMteId(pack, p.mteId);
    if (p.networkId !== net.id || p.dim !== dim || p.voltageTier !== supplyTier || (p.kind ?? machine?.kind) !== 'cable') continue;
    const amps = p.amps ?? machine?.cable?.amps;
    if (amps === undefined || isListed.has(posKey(p.pos))) continue;
    taps.push({ pos: [...p.pos], dim, kind: 'power', networkId: net.id, voltageTier: supplyTier, freeAmps: Math.min(amps, spareAmps), cableAmps: amps });
  }
  return taps;
}

/**
 * The power the line is judged against (spec §3.5): the one network it is wired to — its average generation less its
 * load, its stored EU, what it still makes in rain, and the rain outage when any of it is solar.
 */
function networkPower(net: PowerNetwork): LayoutPowerContext {
  const average = net.generatorEUt.average;
  return {
    averageEUt: average, spareEUt: average - (net.loadEUt ?? 0), voltageTier: net.voltageTier, storedEU: net.storedEU,
    rainOutageSeconds: (net.solarShare ?? 0) > 0 ? RAIN_OUTAGE_SECONDS : 0, rainEUt: net.generatorEUt.rain,
  };
}

/** Kinds that send EU into a cable they touch. */
const EMITTER_KINDS: ReadonlySet<string> = new Set(['generator', 'turbine', 'battery_buffer', 'transformer']);

/** The tier a cable of `volts` is rated for (the lowest whose volts it takes); −1 above every tier. */
function ratedTier(volts: number): number {
  return V.findIndex((v) => v >= volts);
}

/**
 * World posKeys of base blocks a supply-tier hookup must not touch (spec §3.5, §5): cables of another tier (the tier the
 * scan saw on them, else their rating), machines below the supply tier and emitters of another tier; never the tap.
 */
function baseKeepAway(pack: Pack, scan: WorldScan, dim: number, supplyTier: number, tap: Vec3): Set<string> {
  const keys = new Set<string>();
  for (const p of scan.pipes) {
    const machine = machineByMteId(pack, p.mteId);
    if (p.dim !== dim || (p.kind ?? machine?.kind) !== 'cable') continue;
    const tier = p.voltageTier ?? (machine?.cable === undefined ? undefined : ratedTier(machine.cable.voltage));
    if (tier !== supplyTier) keys.add(posKey(p.pos));
  }
  for (const m of scan.machines) {
    if (m.dim !== dim) continue;
    const machine = machineByMteId(pack, m.mteId);
    const kind = m.kind ?? machine?.kind, tier = m.tier ?? machine?.tier;
    if (kind === undefined || tier === undefined) continue;
    const consumer = kind === 'basic' || (kind === 'hatch' && machine !== undefined && ENERGY_HATCH_RE.test(simpleClassName(machine.cls) ?? ''));
    if ((consumer && tier < supplyTier) || (EMITTER_KINDS.has(kind) && tier !== supplyTier)) keys.add(posKey(m.pos));
  }
  keys.delete(posKey(tap));
  return keys;
}

/**
 * The tap the power hookup starts from (architecture §11 entry 52): `choosePowerTap`'s whenever a route leaves it, so a
 * hookup that routes keeps its tap. Else a tap of the first of these groups that a route leaves, each searched once from
 * all of its taps (`reachableTap`, the nearest to the power port first): the listed taps with the line's amps free, the
 * listed taps whose cable carries them, then the same two groups of the network's other cables on the supply tier
 * (`networkCableTaps`). A group's search keeps away from what the hookup keeps away from but the group's own cells, and its
 * tap is taken only when a route leaves that tap alone, as `powerHookup` then searches it. When no group gives one, or
 * without voxels, `choosePowerTap`'s: its hookup stays a dashed guide with `no_path`.
 */
function powerTapFor(input: {
  pack: Pack; scan: WorldScan; dim: number; net: PowerNetwork; taps: readonly LayoutTap[]; target: Vec3; amps: number; supplyTier: number;
  ports: readonly Vec3[]; world: RouteWorld; lineKeepAway: readonly string[]; maxNodes: number | undefined;
}): LayoutTap | null {
  const { pack, scan, dim, net, taps, target, amps, supplyTier, ports, world, lineKeepAway, maxNodes } = input;
  const chosen = choosePowerTap(taps, target, amps);
  if (chosen === null || world.vox === null) return chosen;
  // what the hookup from `tap` keeps away from, as `buildHookups` gives it
  const keepAway = (tap: Vec3) => new Set([...lineKeepAway, ...baseKeepAway(pack, scan, dim, supplyTier, tap)]);
  const routes = (tap: LayoutTap) => reachableTap({ ...world, keepAway: keepAway(tap.pos) }, [tap], ports, maxNodes) !== null;
  if (routes(chosen)) return chosen;
  const nearestFirst = (a: LayoutTap, b: LayoutTap) => manhattan(a.pos, target) - manhattan(b.pos, target) || compareText(posKey(a.pos), posKey(b.pos));
  for (const group of [...carryingTaps(taps, amps), ...carryingTaps(networkCableTaps(pack, scan, net, dim, supplyTier, taps), amps)]) {
    if (group.length === 0) continue;
    const away = keepAway(group[0]!.pos);
    for (const t of group) away.delete(posKey(t.pos));
    const tap = reachableTap({ ...world, keepAway: away }, [...group].sort(nearestFirst), ports, maxNodes);
    if (tap !== null && routes(tap)) return tap;
  }
  return chosen;
}

// ---- The line in its local grid (stages 3–5) ----

interface LocalLine {
  placement: Placement; mode: ModeResult; internal: InternalResult;
  /** The transformer stages sized for the volts every machine gets (Task 6's `InternalResult.stages`). */
  stages: Stages | null;
  /** Units, mode and routing blocks with their covers and settings attached. */
  blocks: LocalBlock[];
  /** W, H (1 + the highest block or air cell a multiblock needs kept empty, such as a muffler's front), L. */
  size: Vec3;
  /** Mode, then routing warnings. */
  warnings: PlanWarning[];
}

/**
 * Stages 3–5 in the line's own grid. Machines fed at different tiers stand apart (their cables never touch), the lowest
 * feed tier next to the power head, whose last run is that tier's (`placeUnits` with the supply tier): a tier's tree
 * then never has to get past a higher tier's machines and tree to reach its own. The supply run is sized for packets
 * that already lost up to the hookup's allowance (spec §3.5 never overload a cable). The line's height counts the air
 * cells its multiblocks need kept empty as well as its blocks.
 */
function buildLocal(input: {
  pack: Pack; plan: Plan; parts: Parts; mode: LogisticsMode; units: readonly Unit[]; stages: Stages | null;
  network: LogisticsNetwork | null;
}): LocalLine {
  const { pack, plan, parts, mode, units, stages, network } = input;
  const placement = placeUnits(units, {
    headWidth: headWidthFor(stages), portSpacing: PORT_SPACING[mode], ...(stages === null ? {} : { supplyTier: stages.supplyTier }),
  });
  const modeResult = buildMode(mode, { pack, plan, parts, placement, network });
  // a mode that lays its own fluid network (EnderIO's ender fluid conduits) gets no GT fluid pipes or pump covers
  const internal = routeInternal({
    pack, parts, placement, occupied: [...placement.blocks, ...modeResult.blocks], stages,
    fluids: modeResult.ownsFluids === true ? [] : fluidNets(pack, plan, placement), tailFluidY: modeResult.tailFluidY, groupTier: plan.tier,
    supplyLossVolts: stages === null ? 0 : hookupAllowanceVolts(stages.supplyTier),
  });
  const blocks = attachCovers([...placement.blocks, ...modeResult.blocks, ...internal.blocks], [...modeResult.covers, ...internal.covers], modeResult.configs);
  // the line is as tall as its highest block or reserved air cell (a muffler facing up from a multiblock's top, a steam
  // machine's vent), so the site, its clearance and obstruction checks and the steps' height keep that cell free too (GT
  // stops a machine whose muffler has no air in front: MTEHatchMuffler.polluteEnvironment; a steam machine waits while
  // its vent is blocked: MTEBasicMachineBronze.allowToCheckRecipe)
  const top = placement.reserved.reduce((y, p) => Math.max(y, p[1]), blocks.reduce((y, b) => Math.max(y, b.pos[1]), 0));
  return {
    placement, mode: modeResult, internal, stages: internal.stages, blocks, size: [placement.size[0], 1 + top, placement.size[2]],
    warnings: [...modeResult.warnings, ...internal.warnings],
  };
}

// ---- Site (stage 6) ----

/** The first face neighbour of `p` (DIRS order) outside the local box; `p` itself when it has none. */
function outsideNeighbour(p: Vec3, size: Vec3): Vec3 {
  return DIRS.map((_, side) => step(p, side)).find((c) => !insideBox(c, size)) ?? [...p];
}

/** posKeys of every scanned machine, pipe, storage block and logistics block in `dim`. */
function scannedCells(scan: WorldScan, dim: number): Set<string> {
  const cells = new Set<string>();
  for (const list of [scan.machines, scan.pipes, scan.storage, scan.logisticsBlocks ?? []]) {
    for (const b of list) if (b.dim === dim) cells.add(posKey(b.pos));
  }
  return cells;
}

function placementBlockedText(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'block is' : 'blocks are'} in the way at the chosen spot`;
}

function placementUncheckedText(n: number): string {
  return n === 1 ? '1 block at the chosen spot was not scanned, so it could not be checked: look there in game before building'
    : `${fmtInt(n)} blocks at the chosen spot were not scanned, so they could not be checked: look there in game before building`;
}

/** The world box a placement covers (its y kept inside the world as `checkPlacement` keeps it), with its free ring and floor. */
function placementBox(placement: NonNullable<Project['placement']>, size: Vec3): BBox {
  const [w, h, l] = rotatedSize(size, placement.rotation);
  const [x, y0, z] = placement.origin;
  const y = Math.min(Math.max(y0, 1), 256 - h);
  return { minX: x - 1, minY: y - 1, minZ: z - 1, maxX: x + w, maxY: y + h - 1, maxZ: z + l };
}

/** Whether `box` lies in the `MAX_SITE_SPAN` square around the base centre, the most the site search reads. */
function withinReach(base: Base, box: BBox): boolean {
  const half = MAX_SITE_SPAN / 2;
  const [cx, , cz] = base.center;
  return box.minX >= cx - half && box.maxX <= cx + half - 1 && box.minZ >= cz - half && box.maxZ <= cz + half - 1;
}

/**
 * Spec §3.6, Review Focus 2 and 5: the dragged placement, checked against voxels read around it too; else the best
 * clear, flat spot near the base and its taps; else the spot beside the base box with what is in the way. A placement
 * farther from the base than the search reads (one kept from another base) is ignored with `placement_ignored`, and
 * one partly outside the scan says how much of it is unknown (`placement_unchecked`): nothing is placed silently.
 * Unreadable terrain places the line unchecked. The spot is for a box of `size`: the line's own, or the line's with the
 * areas kept for its farms (`farmExtent`, add-on 17), which are found clear and flat with it; `line` is null for farms
 * alone (every other machine owned), which have no ports to bring near the taps.
 */
async function chooseSite(input: {
  scan: WorldScan; project: Project; base: Base; line: LocalLine | null; size: Vec3; powerTaps: readonly LayoutTap[] | null;
  logisticsNet: LogisticsNetwork | null; deps: LayoutDeps;
}): Promise<{ site: Site; vox: Voxels | null; warnings: PlanWarning[] }> {
  const { scan, project, base, line, size, powerTaps, logisticsNet, deps } = input;
  const [w, h, l] = size;
  const ports: SiteRequest['ports'] = {};
  const taps: SiteRequest['taps'] = {};
  if (line !== null && line.stages !== null) {
    ports.power = [-1, 0, line.placement.spineZ];
    const tap = powerTaps === null ? null : nearestTap(powerTaps, base.center);
    if (tap !== null) taps.power = [...tap.pos];
  }
  if (line !== null && line.mode.logisticsPort !== null) {
    ports.logistics = outsideNeighbour(line.mode.logisticsPort, line.size);
    const tap = logisticsNet === null ? null : nearestTap(logisticsNet.taps, base.center);
    if (tap !== null) taps.logistics = [...tap.pos];
  }
  const floorY = baseFloorY(scan, base);
  const req: SiteRequest = { dim: base.dim, footprint: { w, h, l }, base, baseFloorY: floorY, ports, taps, avoid: scannedCells(scan, base.dim) };
  const warnings: PlanWarning[] = [];
  let placement = project.placement;
  let placed: BBox | null = null;
  if (placement !== null) {
    placed = placementBox(placement, size);
    if (!withinReach(base, placed)) {
      warnings.push({ code: 'placement_ignored',
        text: `The chosen spot is more than ${MAX_SITE_SPAN / 2} blocks from this base's centre, too far to check: the line is placed near the base instead — move it closer` });
      placement = null;
      placed = null;
    }
  }
  let vox: Voxels | null = null;
  if (deps.readArea !== undefined) {
    const box = siteSearchBox(base, floorY, req.footprint, [taps.power, taps.logistics].filter((t): t is Vec3 => t !== undefined), placed);
    try {
      vox = await deps.readArea(base.dim, box);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
  }
  if (vox === null) {
    warnings.push({ code: 'terrain_unknown', text: placement === null
      ? 'The ground around the base could not be read; the line is placed beside the base unchecked'
      : 'The ground around the base could not be read; the line is placed at the chosen spot unchecked' });
  }
  if (placement !== null) {
    const site = checkPlacement(req, vox, placement);
    if (site.blocked > 0) warnings.push({ code: 'placement_blocked', text: placementBlockedText(site.blocked) });
    if (site.unknown > 0) warnings.push({ code: 'placement_unchecked', text: placementUncheckedText(site.unknown) });
    if (site.moved) warnings.push({ code: 'placement_moved', text: `Moved the line to y=${site.origin[1]} to stay inside the world height` });
    return { site, vox, warnings };
  }
  const found = vox === null ? null : findSite(req, vox);
  if (found !== null) return { site: found, vox, warnings };
  const site = fallbackSite(req, vox);
  // unread terrain already says the spot is unchecked: its counts would all be 0
  if (vox !== null) {
    warnings.push({ code: 'site_not_clear',
      text: `No clear, flat ground near the base: the line is placed beside it — ${fmtInt(site.blocked)} blocks in the way, ${fmtInt(site.unsupported)} columns without a floor` });
  }
  return { site, vox, warnings };
}

// ---- To the world (stage 7) ----

/**
 * Where a local box lands: its min corner, its turn, and its local size before the turn — the line's own box, or the
 * line's with the areas kept for its farms (`farmExtent`, add-on 17), which then turn with it as one box. The line
 * stands at the box's local min corner either way.
 */
interface Frame { origin: Vec3; rotation: Rotation; size: Vec3 }

/** The frame of a box of `size` at the chosen site, or at `DEFAULT_ORIGIN` unturned without one. */
function frameAt(site: Site | null, size: Vec3): Frame {
  return site === null ? { origin: [...DEFAULT_ORIGIN], rotation: 0, size } : { origin: [...site.origin], rotation: site.rotation, size };
}

function worldPos(p: Vec3, f: Frame): Vec3 {
  return toWorld(p, f.origin, f.rotation, f.size);
}

/** The cover turned with its block; its settings and filter copied unchanged. */
function worldCover(c: CoverSpec, r: Rotation): CoverSpec {
  return { face: rotateFace(c.face, r), item: c.item, settings: { ...c.settings }, ...(c.filter === undefined ? {} : { filter: [...c.filter] }) };
}

/**
 * The conduit turned with its block (architecture "EnderIO conduits, granted change requests (add-on 11)"): its links by
 * `rotateConnections`, each face by `rotateFace`, the faces back in FACES order; their settings unchanged.
 */
function worldConduit(c: ConduitSpec, r: Rotation): ConduitSpec {
  const faces = c.faces.map((f): ConduitFace => ({ ...f, face: rotateFace(f.face, r) }))
    .sort((a, b) => FACES.indexOf(a.face) - FACES.indexOf(b.face));
  return { kind: c.kind, item: c.item, connections: rotateConnections(c.connections, r), faces };
}

/** The world box, inclusive, of the local box of `size` at the frame's local min corner: the line's own box. */
function worldBoxOf(size: Vec3, f: Frame): PathBounds {
  const a = worldPos([0, 0, 0], f);
  const b = worldPos([size[0] - 1, size[1] - 1, size[2] - 1], f);
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

/** The world box, inclusive, of an area kept for a farm. */
function areaBounds(a: ReservedArea): PathBounds {
  return { min: [...a.pos], max: [a.pos[0] + a.size[0] - 1, a.pos[1] + a.size[1] - 1, a.pos[2] + a.size[2] - 1] };
}

function worldBlock(b: LocalBlock, f: Frame): LayoutBlock {
  const r = f.rotation;
  return {
    pos: worldPos(b.pos, f), block: { ...b.block }, role: b.role, ...(b.facing === undefined ? {} : { facing: rotateFacing(b.facing, r) }),
    ...(b.mainFacing === undefined ? {} : { mainFacing: rotateFacing(b.mainFacing, r) }),
    ...(b.stepId === undefined ? {} : { stepId: b.stepId }), ...(b.stepIds === undefined ? {} : { stepIds: [...b.stepIds] }), label: b.label,
    ...(b.covers === undefined ? {} : { covers: b.covers.map((c) => worldCover(c, r)) }),
    ...(b.config === undefined ? {} : { config: { ...b.config } }),
    ...(b.item === undefined ? {} : { item: b.item }),
    ...(b.connections === undefined ? {} : { connections: rotateConnections(b.connections, r) }),
    ...(b.conduits === undefined ? {} : { conduits: b.conduits.map((c) => worldConduit(c, r)) }),
    ...(b.tail === undefined ? {} : { tail: { side: b.tail.side, keys: [...b.tail.keys] } }),
    ...(b.hatch === undefined ? {} : { hatch: b.hatch }),
    ...(b.feed === undefined ? {} : { feed: worldFeed(b.feed, r) }),
  };
}

/** The feeding configuration copied, an ME interface's wrench targets (the only faces it names) turned with its block. */
function worldFeed(feed: FeedSpec, r: Rotation): FeedSpec {
  const copy = structuredClone(feed);
  if (copy.interface?.targets !== undefined) copy.interface.targets = copy.interface.targets.map((f) => rotateFace(f, r));
  return copy;
}

// ---- Hookups (stage 8) ----

interface Hookups {
  hookups: Hookup[];
  /** Hookup blocks (with `hookup` = their index), then the ghosts of the taps they join. */
  blocks: LayoutBlock[];
  power: { build: PowerHookupBuild; tap: LayoutTap } | null;
  logistics: { build: HookupBuild; tap: LayoutTap; network: LogisticsNetwork } | null;
  warnings: PlanWarning[];
  /** The first path cell of the hookup that raised each `no_path` warning, by text. */
  noPathAt: Map<string, Vec3>;
}

/**
 * The world posKeys a hookup of item conduits that ends on a conduit face routes around: every cell face-adjacent to
 * a line block holding an Item Conduit (plan 11, ruling R14: EnderIO joins touching item conduits into one network, so
 * the base network's channels would trade with the line's), or to a line machine, hatch or chest other than the
 * port's own block (R14 as widened in the Task 5 review: an item conduit joins any inventory it touches, and only the
 * hookup's last cell sets a face, so a run cell there would get an unset face, Extract on Green, that pulls the
 * block's items onto the base's network whenever redstone power reaches it and that no build step names). Goal cells
 * are not exempt, so the hookup's last cell touches no line inventory but the port's chest.
 */
export function hookupKeepOff(lineBlocks: readonly LayoutBlock[], port: Vec3): Set<string> {
  const cells = new Set<string>();
  const portKey = posKey(port);
  for (const b of lineBlocks) {
    const conduit = b.conduits?.some((c) => c.kind === 'item') === true;
    const inventory = (b.role === 'machine' || b.role === 'hatch' || b.role === 'chest') && posKey(b.pos) !== portKey;
    if (!conduit && !inventory) continue;
    DIRS.forEach((_, side) => cells.add(posKey(step(b.pos, side))));
  }
  return cells;
}

/**
 * Spec §3.5, §3.6, §3.8: the power hookup from the supply-tier tap whose cable can carry the line and that a route can
 * leave (`powerTapFor`) to the supply run, and the logistics hookup from the network's tap nearest the logistics port.
 * Each goes round the line's box (never through it, so it ends beside its port), the multiblocks' air cells, the areas
 * kept for the line's farms (`areas`, add-on 17: a hookup never reaches them) and the hookups laid before it; the power
 * hookup also keeps off everything of another tier, in the line and in the base, and a logistics hookup that ends on a
 * conduit face keeps off the cells `hookupKeepOff` names. The taps they join show as ghosts.
 */
function buildHookups(input: {
  pack: Pack; parts: Parts; scan: WorldScan; dim: number; line: LocalLine; frame: Frame; vox: Voxels | null; lineBlocks: readonly LayoutBlock[];
  supplyTier: number; powerNet: PowerNetwork | null; powerTaps: readonly LayoutTap[]; logisticsNet: LogisticsNetwork | null; maxNodes: number | undefined;
  areas: readonly PathBounds[];
}): Hookups {
  const { pack, parts, scan, dim, line, frame, vox, lineBlocks, supplyTier, powerNet, powerTaps, logisticsNet, maxNodes, areas } = input;
  const taken = new Set(lineBlocks.map((b) => posKey(b.pos)));
  // a hookup must never fill a cell a multiblock needs empty
  const routeLine = new Set([...taken, ...line.placement.reserved.map((p) => posKey(worldPos(p, frame)))]);
  const box = worldBoxOf(line.size, frame);
  const lineKeepAway = line.internal.keepAway.map((p) => posKey(worldPos(p, frame)));
  const out: Hookups = { hookups: [], blocks: [], power: null, logistics: null, warnings: [], noPathAt: new Map() };
  const taps: LayoutTap[] = [];
  const add = (build: HookupBuild, tap: LayoutTap): void => {
    const index = out.hookups.length;
    out.hookups.push(build.hookup);
    for (const b of build.blocks) {
      out.blocks.push({ ...b, hookup: index });
      taken.add(posKey(b.pos));
      routeLine.add(posKey(b.pos));
    }
    out.warnings.push(...build.warnings);
    for (const w of build.warnings) if (w.code === 'no_path' && build.hookup.path[0] !== undefined) out.noPathAt.set(w.text, [...build.hookup.path[0]]);
    taps.push(tap);
  };

  const { stages } = line;
  if (stages !== null) {
    if (powerNet === null) out.warnings.push({ code: 'no_power_tap', text: 'No power network found at this base' });
    else {
      const tap = powerTapFor({
        pack, scan, dim, net: powerNet, taps: ratedTaps(pack, scan, vox, powerTaps), target: worldPos([-1, 0, line.placement.spineZ], frame),
        amps: stages.supplyAmps, supplyTier, ports: line.internal.supplyRun.map((c) => worldPos(c, frame)), world: { vox, line: routeLine, box, areas },
        lineKeepAway, maxNodes,
      });
      if (tap !== null) {
        const keepAway = new Set([...lineKeepAway, ...baseKeepAway(pack, scan, dim, supplyTier, tap.pos)]);
        const world: RouteWorld = { vox, line: routeLine, box, keepAway, areas };
        const build = powerHookup({
          pack, tap, ports: line.internal.supplyRun.map((c) => worldPos(c, frame)), world, supplyTier, amps: stages.supplyAmps, maxNodes,
        });
        add(build, tap);
        out.power = { build, tap };
      }
    }
  }
  const { hookup, logisticsPort } = line.mode;
  if (hookup !== null && logisticsPort !== null && logisticsNet !== null) {
    const port = worldPos(logisticsPort, frame);
    const tap = nearestTap(logisticsNet.taps, port);
    if (tap !== null) {
      // a hookup that ends on a conduit face keeps off the line's Item Conduits, machines, hatches and chests, all but
      // the port's chest (plan 11, ruling R14 as widened in the Task 5 review)
      const world: RouteWorld = {
        vox, line: routeLine, box, areas, ...(hookup.endConduit === undefined ? {} : { keepOff: hookupKeepOff(lineBlocks, port) }),
      };
      const build = logisticsHookup({
        pack, parts, tap, ports: [port], world, part: hookup.part, end: hookup.end,
        ...(hookup.endConfig === undefined ? {} : { endConfig: hookup.endConfig }),
        ...(hookup.endConduit === undefined ? {} : { endConduit: hookup.endConduit }), maxNodes,
      });
      add(build, tap);
      out.logistics = { build, tap, network: logisticsNet };
    }
  }
  const ghosted = new Set<string>();
  for (const tap of taps) {
    for (const g of ghostBlocks(vox, pack, [tap.pos], taken)) {
      if (ghosted.has(posKey(g.pos))) continue;
      ghosted.add(posKey(g.pos));
      out.blocks.push(g);
    }
  }
  return out;
}

/** The index in `internal.supplyRun` of the cell the power hookup's last cell touches; null without a power hookup. */
function landingIndex(line: LocalLine, frame: Frame, hookup: Hookup | undefined): number | null {
  const last = hookup?.path.at(-1);
  if (last === undefined) return null;
  const z = line.internal.supplyRun.findIndex((c) => sideToward(last, worldPos(c, frame)) !== -1);
  return z === -1 ? null : z;
}

/** Spec §3.6 (AE2 idle draw, architecture §11.13): the line's power need with its ME parts' idle draw added. */
function withIdleDraw(power: PowerSummary, idle: number): PowerSummary {
  return idle > 0 ? { ...power, averageEUt: power.averageEUt + idle, peakEUt: power.peakEUt + idle } : { ...power };
}

function idleDetail(power: PowerSummary, idle: number): PowerSummary {
  return idle > 0 ? { ...power, detail: `${power.detail ?? ''}; AE2 parts idle: ${fmtRate(idle)} EU/t` } : power;
}

/** What the line's cables and hookup lose (RUK-116, design G2), in the power card's detail. */
function lossDetail(power: PowerSummary, lossEUt: number): PowerSummary {
  return lossEUt > 0 ? { ...power, detail: `${power.detail ?? ''}; cables and hookup lose ${fmtInt(lossEUt)} EU/t` } : power;
}

// ---- Parts (stage 10) ----

const COVER_NAMES: ReadonlyMap<StuffKey, string> = new Map([...COVER_RATES.conveyor, ...COVER_RATES.pump].map((r) => [r.key, r.name]));

/**
 * One `part_unknown` per used key (sorted) that is a part `resolveParts` did not find in the pack, or a cover item the
 * pack lacks: the layout still lists it, by its usual id and English name, for the group to check in game.
 */
function unknownParts(pack: Pack, parts: Parts, blocks: readonly LayoutBlock[], bom: readonly BomLine[], nameOf: (k: StuffKey) => string): PlanWarning[] {
  const missing = new Map<StuffKey, string>();
  for (const p of Object.values(parts)) if (!p.found && !missing.has(p.key)) missing.set(p.key, p.name);
  const used = new Set<StuffKey>(bom.map((l) => l.key));
  const coverItems = new Set<StuffKey>();
  for (const b of blocks) {
    if (b.role === 'ghost') continue;
    if (b.item !== undefined) used.add(b.item);
    for (const c of b.covers ?? []) {
      used.add(c.item);
      coverItems.add(c.item);
    }
  }
  const warnings: PlanWarning[] = [];
  for (const key of [...used].sort(compareText)) {
    const name = missing.get(key) ?? (coverItems.has(key) && !pack.items.has(key) ? COVER_NAMES.get(key) ?? nameOf(key) : undefined);
    if (name !== undefined) warnings.push({ code: 'part_unknown', key, text: `${name} is not in this recipe export; check the part in game` });
  }
  return warnings;
}

// ---- Layout ----

/** Warnings pinned at the site centre (stage 9). */
const SITE_PINNED: ReadonlySet<string> = new Set([
  'site_not_clear', 'placement_blocked', 'placement_unchecked', 'placement_ignored', 'no_power_tap', 'routed_missing', 'ae2_missing',
]);

// ---- Farms (add-on 17) ----

/** The pin of each area kept for a farm, in the middle of its floor (`farmPinPos`), with the area's words. */
function farmPins(kept: readonly ReservedArea[]): Array<{ pos: Vec3; text: string }> {
  return kept.map((a) => ({ pos: farmPinPos(a), text: a.text }));
}

/** `Layout.reserved`: the areas with the numbers of their pins (`makePins` numbers the `farm` pins in area order), if any. */
function pinnedAreas(kept: readonly ReservedArea[], pins: readonly Pin[]): ReservedArea[] {
  const numbers = pins.filter((p) => p.kind === 'farm').map((p) => p.n);
  return kept.map((a, i) => {
    const pin = numbers[i];
    return { stepId: a.stepId, pos: [...a.pos], size: [...a.size], ...(pin === undefined ? {} : { pin }), text: a.text };
  });
}

/** One build step per area kept for a farm (`farmBuildText`, with the area's pin when it has one); nothing without areas. */
function farmStepsInput(plan: Plan, areas: readonly FarmArea[], reserved: readonly ReservedArea[]): Pick<StepsInput, 'farms'> {
  if (areas.length === 0) return {};
  return {
    farms: areas.map((a, i) => {
      const pin = reserved[i]?.pin;
      const step = plan.steps.find((s) => s.id === a.stepId)!;
      return { stepId: a.stepId, text: farmBuildText(step, a, pin), ...(pin === undefined ? {} : { pin }) };
    }),
  };
}

/** What stage 9 hands the build steps: the status, pins, reuse finds, earthwork and hookups (none of them without a base). */
interface Finish {
  status: LayoutStatus; pins: PinInput | null; reuse: readonly ReuseFind[]; site: { dig: number; fill: number } | null;
  power: StepsInput['power']; supplyTier: number | null; logistics: StepsInput['logistics'];
}

/**
 * Architecture §6.7: the line laid out for `plan` in the project's logistics mode, placed near the project's base in
 * `scan` (or at the dragged placement), hooked up to the base's networks. A plan with nothing to build gives an empty
 * layout; a project without a scan or base gets the line at `DEFAULT_ORIGIN` with no pins or hookups. Each new farm
 * machine gets an area kept for it (`Layout.reserved`, add-on 17), found clear with the line (or alone, when every other
 * machine is owned: then the layout is `ok` with a base, `no-world` without), turned with it and counted in
 * `Layout.size`, with a `farm` pin when the layout has pins and one build step; the hookups go round the areas.
 */
export async function layoutLine(pack: Pack, plan: Plan, scan: WorldScan, project: Project, deps: LayoutDeps = {}): Promise<Layout> {
  // stage 1
  const mode = project.settings.logistics;
  const parts = resolveParts(pack);
  if (plan.status === 'empty' || plan.status === 'infeasible') {
    return { status: 'empty', dim: 0, origin: [...DEFAULT_ORIGIN], size: [0, 0, 0], rotation: 0, mode, blocks: [], hookups: [], pins: [], buildSteps: [], bom: [], warnings: [] };
  }
  const nameOf = (k: StuffKey): string => plan.names?.[k] ?? pack.nameOf(k);
  const transformerName = (toTier: number): string => pickTransformer(pack, toTier)?.name ?? `${tierName(toTier)} transformer`;
  /** A plan step by what it makes: its main output's name, else its first output's (plan 12: a shared machine's steps). */
  const stepName = (stepId: string): string => {
    const s = plan.steps.find((x) => x.id === stepId);
    const key = s?.mainOutput ?? s?.outputs[0]?.key;
    return key === undefined ? stepId : nameOf(key);
  };

  // stage 2
  const base = findBase(scan, project.world.baseId);
  const worldWarnings: PlanWarning[] = base !== null ? []
    : project.world.scanId === null ? [{ code: 'no_scan', text: 'Pick a world scan and base on the Map tab to place the line' }]
      : [{ code: 'no_base', text: 'This scan has no base here to build next to' }];
  const ctx = base === null ? emptyContext() : contextFromScan(scan, pack, base.id);
  const dim = base?.dim ?? 0;

  // stages 3–4; GT's primitive machines get their own rules in every mode but machine to machine, which add-on 15 lays out
  const { units, warnings: unitWarnings } = unitsFromPlan(pack, plan, { primitive: mode !== 'direct' });
  const electric = units.filter((u) => u.electric);
  const lineTier = electric.length > 0 ? Math.max(...electric.map((u) => u.tier)) : plan.tier;
  const powerNet = base === null ? null : choosePowerNetwork(scan, base, lineTier);
  // the line is fed from taps of one tier only, and that tier is its supply (spec §3.5, §5)
  const supply = powerNet === null ? null : supplyTaps(powerNet);
  const supplyTier = supply?.tier ?? lineTier;
  // judged against the network it is wired to; the base's power only when there is none (spec §3.5)
  const fitCtx: PlanContext = powerNet === null ? ctx : { ...ctx, power: networkPower(powerNet) };
  const provisional = electric.length === 0 ? null : transformerStages(tierGroups(electric), supplyTier);
  const logisticsNet = base === null ? null : chooseLogisticsNetwork(scan, base, mode);

  if (units.length === 0) {
    // owned machines only: hook them up, with the plan's power fitted as it is; a new farm still gets its areas, found
    // clear and flat near the base as a line's site is (add-on 17, ruling S12), what is in their way pinned at their middle.
    // Its areas are what there is to build, so such a layout is `ok` with a base and `no-world` without, as any line (the
    // final review's T8-b), and `empty` only with no farm to build either.
    const areas = farmAreas(plan, [0, 0, 0]);
    const status: LayoutStatus = areas.length === 0 ? 'empty' : base === null ? 'no-world' : 'ok';
    const extent = farmExtent([0, 0, 0], areas);
    const chosen = base === null || areas.length === 0 ? null
      : await chooseSite({ scan, project, base, line: null, size: extent, powerTaps: null, logisticsNet: null, deps });
    const frame = frameAt(chosen?.site ?? null, extent);
    const worldSize = rotatedSize(extent, frame.rotation);
    const kept = areas.map((a) => reservedArea(a, (p) => worldPos(p, frame)));
    const warnings = dedupeWarnings([...unitWarnings, ...(chosen?.warnings ?? worldWarnings)]);
    const middle: Vec3 = [frame.origin[0] + Math.floor(worldSize[0] / 2), frame.origin[1], frame.origin[2] + Math.floor(worldSize[2] / 2)];
    const reuse = base === null ? [] : findReuse(pack, plan, scan, base, base.center);
    const pins = makePins({
      dim, site: null, power: null, logistics: null, reuse, ...(base === null ? {} : { farms: farmPins(kept) }),
      warnings: base === null ? [] : warnings.filter((w) => SITE_PINNED.has(w.code)).map((w) => ({ code: w.code, text: w.text, pos: middle })),
    });
    const reserved = pinnedAreas(kept, pins);
    // the steps of a line with nothing of its own to place (`empty`): its farms' areas and the owned machines' hook steps
    const buildSteps = layoutSteps({
      status: 'empty', pins, size: [0, 0, 0], site: null, units: [], stages: [], transformerName, cables: [], power: null, supplyTier: null,
      drafts: [], fluids: [], logistics: null, reuse, blocks: [], origin: [...frame.origin], rotation: frame.rotation, nameOf,
      ...farmStepsInput(plan, areas, reserved),
    });
    const fit = base === null ? null : fitPower({ power: plan.power, ctx: fitCtx, extraLossEUt: 0, pack, tier: supplyTier });
    return {
      dim, origin: [...frame.origin], size: worldSize, rotation: frame.rotation, mode, blocks: [], hookups: [], pins, buildSteps,
      bom: bomFromBlocks([], fit?.optional ?? []), warnings, status,
      power: fit?.power ?? { ...plan.power },
      // nothing of its own to wire, so nothing to lose
      loss: { tiers: [], hookupEUt: 0, banksEUt: 0, totalEUt: 0 },
      ...(reserved.length === 0 ? {} : { reserved }),
    };
  }

  // stage 5; from here on the stages are the ones sized for the volts every machine gets
  const line = buildLocal({ pack, plan, parts, mode, units, stages: provisional, network: logisticsNet });
  const { stages } = line;
  // the areas kept for the plan's new farms beside the line, and the box the line and its areas take (add-on 17)
  const areas = farmAreas(plan, line.size);
  const extent = farmExtent(line.size, areas);
  const replaced = replacedCasings(units);
  const supplyWarnings: PlanWarning[] = stages === null || powerNet === null || supply === null || !supply.other ? [] : [{ code: 'power_tap_tier',
    text: `The ${tierName(powerNet.voltageTier)} network has no ${tierName(powerNet.voltageTier)} cable to tap: the line is fed at `
      + `${tierName(supplyTier)} from a cable behind one of its transformers` }];

  // stages 6–7: the site is found for the line and its farms' areas together, which turn with it as one box
  const chosen = base === null ? null
    : await chooseSite({ scan, project, base, line, size: extent, powerTaps: supply?.taps ?? null, logisticsNet, deps });
  const frame = frameAt(chosen?.site ?? null, extent);
  const vox = chosen?.vox ?? null;
  const siteWarnings = chosen?.warnings ?? worldWarnings;
  const worldSize = rotatedSize(extent, frame.rotation);
  // the line's own box and size in the world: its site pin, its roof and its blocks' step ids go by them
  const lineBox = worldBoxOf(line.size, frame);
  const lineSize = rotatedSize(line.size, frame.rotation);
  const lineBlocks = line.blocks.map((b) => worldBlock(b, frame));
  const kept = areas.map((a) => reservedArea(a, (p) => worldPos(p, frame)));

  // stage 8
  const hooked = base === null ? null : buildHookups({
    pack, parts, scan, dim, line, frame, vox, lineBlocks, supplyTier, powerNet, powerTaps: supply?.taps ?? [], logisticsNet, maxNodes: deps.maxPathNodes,
    areas: kept.map(areaBounds),
  });
  const blocks = [...lineBlocks, ...(hooked?.blocks ?? [])].sort(compareBlocks);
  const idle = ae2IdleEUt(blocks, parts);
  const need = withIdleDraw(plan.power, idle);
  // the supply run's own loss counts from where the hookup lands on it (the worst cell without a hookup)
  const supplyRun = supplyRunLoss(line.internal.supply, landingIndex(line, frame, hooked?.power?.build.hookup));
  // the need counts the banks' emitter loss, the line's own cables and the hookup (spec §3.5)
  const lossEUt = (stages?.lossEUt ?? 0) + line.internal.lossEUt + supplyRun.lossEUt + (hooked?.power?.build.lossEUt ?? 0);
  // the loss tier by tier (RUK-116, design G2): the supply run's entry counts from the hookup's landing cell and is the
  // highest tier, so the list stays tier descending
  const tiers: TierLoss[] = [...(supplyRun.tier === null ? [] : [supplyRun.tier]), ...line.internal.tiers];
  const hookupEUt = hooked?.power?.build.lossEUt ?? 0;
  const banksEUt = stages?.lossEUt ?? 0;
  const loss: LayoutLoss = { tiers, hookupEUt, banksEUt, totalEUt: lossEUt };
  const fit = base === null ? null : fitPower({ power: need, ctx: fitCtx, extraLossEUt: lossEUt, pack, tier: supplyTier });

  // stages 10–11 (parts and warnings first: the warning pins come from them)
  // the casings of layers the layout added to an exported structure are parts too: Plan 2 lists the exported one
  const bom = bomFromBlocks(blocks, [...line.mode.extraParts, ...parallelRunParts(line.internal.cables),
    ...(hooked?.power == null ? [] : parallelHookupParts(hooked.power.build)), ...addedBlocks(units), ...(fit?.optional ?? [])]);
  // without a base the warning that says to pick one comes first (Review Focus 1)
  // the static feeding rules read the line as laid out (architecture §11 entry 51)
  const warnings = dedupeWarnings([
    ...(base === null ? siteWarnings : []), ...unitWarnings, ...line.warnings, ...(supplyRun.warning === null ? [] : [supplyRun.warning]),
    ...(base === null ? [] : siteWarnings), ...supplyWarnings, ...(hooked?.warnings ?? []), ...unknownParts(pack, parts, blocks, bom, nameOf),
    ...feedingWarnings({ pack, plan, layout: { mode, blocks } }),
  ]);

  // stage 9
  let finish: Finish;
  if (base === null || chosen === null || hooked === null) {
    finish = { status: 'no-world', pins: null, reuse: [], site: null, power: null, supplyTier: null, logistics: null };
  } else {
    const centre: Vec3 = [lineBox.min[0] + Math.floor(lineSize[0] / 2), frame.origin[1], lineBox.min[2] + Math.floor(lineSize[2] / 2)];
    const reuse = findReuse(pack, plan, scan, base, centre);
    const placed = warnings.flatMap((w) => {
      if (SITE_PINNED.has(w.code)) return [{ code: w.code, text: w.text, pos: centre }];
      const at = w.code === 'no_path' ? hooked.noPathAt.get(w.text) ?? centre : null;
      return at === null ? [] : [{ code: w.code, text: w.text, pos: at }];
    });
    const { power, logistics } = hooked;
    finish = {
      status: 'ok', reuse, site: { dig: chosen.site.dig, fill: chosen.site.fill },
      pins: {
        dim, site: { center: centre, text: siteText(lineSize) },
        power: power === null || stages === null ? null : { pos: [...power.tap.pos], text: powerText(power.tap, stages.supplyAmps) },
        logistics: logistics === null ? null : { pos: [...logistics.tap.pos], text: logisticsText(logistics.network.kind) },
        reuse, farms: farmPins(kept), warnings: placed,
      },
      power: power === null || stages === null ? null : {
        cable: power.build.cable?.name ?? 'cable', blocks: power.build.blocks.length, amps: stages.supplyAmps, tier: supplyTier,
        arrivingVolts: power.build.arrivingVolts, ...(power.build.blocked === null ? {} : { upgrade: { cable: power.build.blocked.cable } }),
      },
      supplyTier: stages === null ? null : supplyTier,
      logistics: logistics === null || line.mode.hookup === null ? null
        : { kindName: networkName(logistics.network.kind), part: parts[line.mode.hookup.part].name, blocks: logistics.build.blocks.length },
    };
  }
  const pins = finish.pins === null ? [] : makePins(finish.pins);
  const reserved = pinnedAreas(kept, pins);

  // stage 10: steps, then each block's owning step (ruling R7); the line's blocks are named from its own min corner, so
  // their step ids stay when farms come and go
  const stepsInput: StepsInput = {
    status: finish.status, pins, size: lineSize, ...(areas.length === 0 ? {} : { siteSize: worldSize }), site: finish.site,
    units: line.placement.units, stages: stages?.stages ?? [], transformerName,
    cables: line.internal.cables.map((c) => ({ tier: c.tier, cable: c.cable.name, cells: c.cells })),
    power: finish.power, supplyTier: finish.supplyTier, drafts: line.mode.drafts,
    fluids: line.internal.fluidPipes.map((f) => ({ key: f.key, name: f.name, pipe: f.pipe.name, cells: f.cells })),
    logistics: finish.logistics, reuse: finish.reuse, blocks, origin: [...lineBox.min], rotation: frame.rotation, nameOf, stepName,
    ...farmStepsInput(plan, areas, reserved),
  };
  const buildSteps = layoutSteps(stepsInput);
  const hookups = hooked?.hookups ?? [];

  return {
    dim, origin: [...frame.origin], size: worldSize, rotation: frame.rotation, mode, blocks: assignBuildSteps(blocks, buildSteps, stepsInput, hookups),
    hookups, pins, buildSteps, bom, warnings, status: finish.status,
    power: lossDetail(fit === null ? need : idleDetail(fit.power, idle), loss.totalEUt),
    loss,
    ...(replaced.length === 0 ? {} : { replaced }),
    ...(reserved.length === 0 ? {} : { reserved }),
  };
}
