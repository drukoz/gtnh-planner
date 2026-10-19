// A line layout end to end (Plan 5 Task 11; architecture §6.7; spec §3.5–§3.8, §3.10, Review Focus 1): the plan's new
// machines placed in two rows around a spine in the project's logistics mode, wired and piped inside the line, the line
// put on clear, flat ground near the base (or where the group dragged it), hooked up to the base's power and logistics
// taps through the scanned world, with numbered pins, build steps, the grouped parts list and the power fit.
// Without a scan or base the line is still laid out at a default origin, so the 3D view and the parts list work.
// Every stage has fixed orders and tie-breaks, so the same inputs give byte-identical layout JSON.

import { tierName } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { fmtInt, fmtRate } from '../../shared/layout/format.ts';
import {
  DIRS, posKey, rotateConnections, rotatedSize, rotateFace, rotateFacing, step, toWorld, type Rotation, type Vec3,
} from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { ConduitFace, ConduitSpec, CoverSpec, Hookup, Layout, LayoutBlock, LayoutStatus, LayoutTap } from '../../shared/types/layout.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { BomLine, LogisticsMode, Plan, PlanWarning, PowerSummary } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import { findBase, type Base, type BBox, type LogisticsNetwork, type PowerNetwork, type Voxels, type WorldScan } from '../../shared/types/world.ts';
import { emptyContext } from '../planner/plan.ts';
import { contextFromScan } from '../world/context.ts';
import { attachCovers, placeUnits, replacedCasings, unitsFromPlan, type LocalBlock, type Placement, type Unit } from './arrange.ts';
import {
  chooseLogisticsNetwork, choosePowerNetwork, choosePowerTap, ghostBlocks, logisticsHookup, nearestTap, powerHookup,
  type HookupBuild, type PowerHookupBuild,
} from './hookups.ts';
import { fluidNets, headWidthFor, routeInternal, type InternalResult } from './internal.ts';
import { buildMode, PORT_SPACING, type ModeResult } from './modes/mode.ts';
import { ae2IdleEUt, COVER_RATES, pickTransformer, resolveParts, type Parts } from './parts.ts';
import { findReuse, logisticsText, makePins, networkName, powerText, siteText, type PinInput, type ReuseFind } from './pins.ts';
import { fitPower, tierGroups, transformerStages, type Stages } from './power.ts';
import { baseFloorY, checkPlacement, fallbackSite, findSite, siteSearchBox, type Site, type SiteRequest } from './site.ts';
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

// ---- The line in its local grid (stages 3–5) ----

interface LocalLine {
  placement: Placement; mode: ModeResult; internal: InternalResult; stages: Stages | null;
  /** Units, mode and routing blocks with their covers and settings attached. */
  blocks: LocalBlock[];
  /** W, H (1 + the highest block), L. */
  size: Vec3;
  /** Mode, then routing warnings. */
  warnings: PlanWarning[];
}

function buildLocal(input: {
  pack: Pack; plan: Plan; parts: Parts; mode: LogisticsMode; units: readonly Unit[]; stages: Stages | null;
  network: LogisticsNetwork | null;
}): LocalLine {
  const { pack, plan, parts, mode, units, stages, network } = input;
  const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: PORT_SPACING[mode] });
  const modeResult = buildMode(mode, { pack, plan, parts, placement, network });
  // a mode that lays its own fluid network (EnderIO's ender fluid conduits) gets no GT fluid pipes or pump covers
  const internal = routeInternal({
    pack, parts, placement, occupied: [...placement.blocks, ...modeResult.blocks], stages,
    fluids: modeResult.ownsFluids === true ? [] : fluidNets(pack, plan, placement), tailFluidY: modeResult.tailFluidY, groupTier: plan.tier,
  });
  const blocks = attachCovers([...placement.blocks, ...modeResult.blocks, ...internal.blocks], [...modeResult.covers, ...internal.covers], modeResult.configs);
  const top = blocks.reduce((y, b) => Math.max(y, b.pos[1]), 0);
  return {
    placement, mode: modeResult, internal, stages, blocks, size: [placement.size[0], 1 + top, placement.size[2]],
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

/**
 * Spec §3.6, Review Focus 2 and 5: the dragged placement, checked; else the best clear, flat spot near the base and
 * its taps; else the spot beside the base box with what is in the way. Unreadable terrain places the line beside the
 * base unchecked.
 */
async function chooseSite(input: {
  scan: WorldScan; project: Project; base: Base; line: LocalLine; powerNet: PowerNetwork | null; logisticsNet: LogisticsNetwork | null; deps: LayoutDeps;
}): Promise<{ site: Site; vox: Voxels | null; warnings: PlanWarning[] }> {
  const { scan, project, base, line, powerNet, logisticsNet, deps } = input;
  const [w, h, l] = line.size;
  const ports: SiteRequest['ports'] = {};
  const taps: SiteRequest['taps'] = {};
  if (line.stages !== null) {
    ports.power = [-1, 0, line.placement.spineZ];
    const tap = powerNet === null ? null : nearestTap(powerNet.taps, base.center);
    if (tap !== null) taps.power = [...tap.pos];
  }
  if (line.mode.logisticsPort !== null) {
    ports.logistics = outsideNeighbour(line.mode.logisticsPort, line.size);
    const tap = logisticsNet === null ? null : nearestTap(logisticsNet.taps, base.center);
    if (tap !== null) taps.logistics = [...tap.pos];
  }
  const floorY = baseFloorY(scan, base);
  const req: SiteRequest = { dim: base.dim, footprint: { w, h, l }, base, baseFloorY: floorY, ports, taps, avoid: scannedCells(scan, base.dim) };
  const warnings: PlanWarning[] = [];
  let vox: Voxels | null = null;
  if (deps.readArea !== undefined) {
    const box = siteSearchBox(base, floorY, req.footprint, [taps.power, taps.logistics].filter((t): t is Vec3 => t !== undefined));
    try {
      vox = await deps.readArea(base.dim, box);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
  }
  if (vox === null) {
    warnings.push({ code: 'terrain_unknown', text: 'The ground around the base could not be read; the line is placed beside the base unchecked' });
  }
  if (project.placement !== null) {
    const site = checkPlacement(req, vox, project.placement);
    if (site.blocked > 0) warnings.push({ code: 'placement_blocked', text: placementBlockedText(site.blocked) });
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

/** Where a local line lands: its min corner, its turn, and its local size before the turn. */
interface Frame { origin: Vec3; rotation: Rotation; size: Vec3 }

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

function worldBlock(b: LocalBlock, f: Frame): LayoutBlock {
  const r = f.rotation;
  return {
    pos: worldPos(b.pos, f), block: { ...b.block }, role: b.role, ...(b.facing === undefined ? {} : { facing: rotateFacing(b.facing, r) }),
    ...(b.stepId === undefined ? {} : { stepId: b.stepId }), label: b.label,
    ...(b.covers === undefined ? {} : { covers: b.covers.map((c) => worldCover(c, r)) }),
    ...(b.config === undefined ? {} : { config: { ...b.config } }),
    ...(b.item === undefined ? {} : { item: b.item }),
    ...(b.connections === undefined ? {} : { connections: rotateConnections(b.connections, r) }),
    ...(b.conduits === undefined ? {} : { conduits: b.conduits.map((c) => worldConduit(c, r)) }),
    ...(b.tail === undefined ? {} : { tail: { side: b.tail.side, keys: [...b.tail.keys] } }),
  };
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
 * Spec §3.5, §3.6, §3.8: the power hookup from the tap that can carry the line to the supply run, and the logistics
 * hookup from the network's tap nearest the logistics port. Each routes around the line, the multiblocks' air cells
 * and the hookups laid before it; the taps they join show as ghosts.
 */
function buildHookups(input: {
  pack: Pack; parts: Parts; line: LocalLine; frame: Frame; vox: Voxels | null; lineBlocks: readonly LayoutBlock[]; supplyTier: number;
  powerNet: PowerNetwork | null; logisticsNet: LogisticsNetwork | null; maxNodes: number | undefined;
}): Hookups {
  const { pack, parts, line, frame, vox, lineBlocks, supplyTier, powerNet, logisticsNet, maxNodes } = input;
  const taken = new Set(lineBlocks.map((b) => posKey(b.pos)));
  // a hookup must never fill a cell a multiblock needs empty
  const routeLine = new Set([...taken, ...line.placement.reserved.map((p) => posKey(worldPos(p, frame)))]);
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
      const tap = choosePowerTap(powerNet.taps, worldPos([-1, 0, line.placement.spineZ], frame), stages.supplyAmps);
      if (tap !== null) {
        const build = powerHookup({
          pack, tap, ports: line.internal.supplyRun.map((c) => worldPos(c, frame)), world: { vox, line: routeLine }, supplyTier,
          amps: stages.supplyAmps, maxNodes,
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
      const world = { vox, line: routeLine, ...(hookup.endConduit === undefined ? {} : { keepOff: hookupKeepOff(lineBlocks, port) }) };
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

/** Spec §3.6 (AE2 idle draw, architecture §11.13): the line's power need with its ME parts' idle draw added. */
function withIdleDraw(power: PowerSummary, idle: number): PowerSummary {
  return idle > 0 ? { ...power, averageEUt: power.averageEUt + idle, peakEUt: power.peakEUt + idle } : { ...power };
}

function idleDetail(power: PowerSummary, idle: number): PowerSummary {
  return idle > 0 ? { ...power, detail: `${power.detail ?? ''}; AE2 parts idle: ${fmtRate(idle)} EU/t` } : power;
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
const SITE_PINNED: ReadonlySet<string> = new Set(['site_not_clear', 'placement_blocked', 'no_power_tap', 'routed_missing', 'ae2_missing']);

/** What stage 9 hands the build steps: the status, pins, reuse finds, earthwork and hookups (none of them without a base). */
interface Finish {
  status: LayoutStatus; pins: PinInput | null; reuse: readonly ReuseFind[]; site: { dig: number; fill: number } | null;
  power: StepsInput['power']; supplyTier: number | null; logistics: StepsInput['logistics'];
}

/**
 * Architecture §6.7: the line laid out for `plan` in the project's logistics mode, placed near the project's base in
 * `scan` (or at the dragged placement), hooked up to the base's networks. A plan with nothing to build gives an empty
 * layout; a project without a scan or base gets the line at `DEFAULT_ORIGIN` with no pins or hookups.
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

  // stage 2
  const base = findBase(scan, project.world.baseId);
  const worldWarnings: PlanWarning[] = base !== null ? []
    : project.world.scanId === null ? [{ code: 'no_scan', text: 'Pick a world scan and base on the Map tab to place the line' }]
      : [{ code: 'no_base', text: 'This scan has no base here to build next to' }];
  const ctx = base === null ? emptyContext() : contextFromScan(scan, pack, base.id);
  const dim = base?.dim ?? 0;

  // stages 3–4
  const { units, warnings: unitWarnings } = unitsFromPlan(pack, plan);
  const electric = units.filter((u) => u.electric);
  const lineTier = electric.length > 0 ? Math.max(...electric.map((u) => u.tier)) : plan.tier;
  const powerNet = base === null ? null : choosePowerNetwork(scan, base, lineTier);
  const supplyTier = powerNet?.voltageTier ?? lineTier;
  const stages = electric.length === 0 ? null : transformerStages(tierGroups(electric), supplyTier);
  const logisticsNet = base === null ? null : chooseLogisticsNetwork(scan, base, mode);

  if (units.length === 0) {
    // owned machines only: hook them up, with the plan's power fitted as it is
    const reuse = base === null ? [] : findReuse(pack, plan, scan, base, base.center);
    const pins = makePins({ dim, site: null, power: null, logistics: null, reuse, warnings: [] });
    const buildSteps = layoutSteps({
      status: 'empty', pins, size: [0, 0, 0], site: null, units: [], stages: [], transformerName, cables: [], power: null, supplyTier: null,
      drafts: [], fluids: [], logistics: null, reuse, blocks: [], origin: [...DEFAULT_ORIGIN], nameOf,
    });
    const fit = base === null ? null : fitPower({ power: plan.power, ctx, extraLossEUt: 0, pack, tier: supplyTier });
    return {
      dim, origin: [...DEFAULT_ORIGIN], size: [0, 0, 0], rotation: 0, mode, blocks: [], hookups: [], pins, buildSteps,
      bom: bomFromBlocks([], fit?.optional ?? []), warnings: dedupeWarnings([...unitWarnings, ...worldWarnings]), status: 'empty',
      power: fit?.power ?? { ...plan.power },
    };
  }

  // stage 5
  const line = buildLocal({ pack, plan, parts, mode, units, stages, network: logisticsNet });
  const replaced = replacedCasings(units);

  // stages 6–7
  const chosen = base === null ? null : await chooseSite({ scan, project, base, line, powerNet, logisticsNet, deps });
  const frame: Frame = chosen === null ? { origin: [...DEFAULT_ORIGIN], rotation: 0, size: line.size }
    : { origin: [...chosen.site.origin], rotation: chosen.site.rotation, size: line.size };
  const vox = chosen?.vox ?? null;
  const siteWarnings = chosen?.warnings ?? worldWarnings;
  const worldSize = rotatedSize(line.size, frame.rotation);
  const lineBlocks = line.blocks.map((b) => worldBlock(b, frame));

  // stage 8
  const hooked = base === null ? null : buildHookups({
    pack, parts, line, frame, vox, lineBlocks, supplyTier, powerNet, logisticsNet, maxNodes: deps.maxPathNodes,
  });
  const blocks = [...lineBlocks, ...(hooked?.blocks ?? [])].sort(compareBlocks);
  const idle = ae2IdleEUt(blocks, parts);
  const need = withIdleDraw(plan.power, idle);
  const fit = base === null ? null : fitPower({
    power: need, ctx, extraLossEUt: (stages?.lossEUt ?? 0) + (hooked?.power?.build.lossEUt ?? 0), pack, tier: supplyTier,
  });

  // stages 10–11 (parts and warnings first: the warning pins come from them)
  const bom = bomFromBlocks(blocks, [...line.mode.extraParts, ...(fit?.optional ?? [])]);
  const warnings = dedupeWarnings([
    ...unitWarnings, ...line.warnings, ...siteWarnings, ...(hooked?.warnings ?? []), ...unknownParts(pack, parts, blocks, bom, nameOf),
  ]);

  // stage 9
  let finish: Finish;
  if (base === null || chosen === null || hooked === null) {
    finish = { status: 'no-world', pins: null, reuse: [], site: null, power: null, supplyTier: null, logistics: null };
  } else {
    const centre: Vec3 = [frame.origin[0] + Math.floor(worldSize[0] / 2), frame.origin[1], frame.origin[2] + Math.floor(worldSize[2] / 2)];
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
        dim, site: { center: centre, text: siteText(worldSize) },
        power: power === null || stages === null ? null : { pos: [...power.tap.pos], text: powerText(power.tap, stages.supplyAmps) },
        logistics: logistics === null ? null : { pos: [...logistics.tap.pos], text: logisticsText(logistics.network.kind) },
        reuse, warnings: placed,
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

  // stage 10: steps, then each block's owning step (ruling R7)
  const stepsInput: StepsInput = {
    status: finish.status, pins, size: worldSize, site: finish.site, units: line.placement.units, stages: stages?.stages ?? [], transformerName,
    cables: line.internal.cables.map((c) => ({ tier: c.tier, cable: c.cable.name, cells: c.cells })),
    power: finish.power, supplyTier: finish.supplyTier, drafts: line.mode.drafts,
    fluids: line.internal.fluidPipes.map((f) => ({ key: f.key, name: f.name, pipe: f.pipe.name, cells: f.cells })),
    logistics: finish.logistics, reuse: finish.reuse, blocks, origin: [...frame.origin], nameOf,
  };
  const buildSteps = layoutSteps(stepsInput);
  const hookups = hooked?.hookups ?? [];

  return {
    dim, origin: [...frame.origin], size: worldSize, rotation: frame.rotation, mode, blocks: assignBuildSteps(blocks, buildSteps, stepsInput, hookups),
    hookups, pins, buildSteps, bom, warnings, status: finish.status,
    power: fit === null ? need : idleDetail(fit.power, idle),
    ...(replaced.length === 0 ? {} : { replaced }),
  };
}
