// The network and cover readers of `readLine` (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 2
// rules 11–15): Project Red routed pipes, AE2 interfaces and ME Export Buses, EnderIO item conduits, GT item pipes, and
// the GT covers of every block. Each reads the structured config first (`LayoutBlock.feed`, architecture §11 entry 51,
// which main's routed and AE2 lines carry since fix/feeding) and the layout text of older lines and the plan second, and
// lists what it could not know as unknowns. Everything comes out in the line's local frame (`frame.ts`): cells and their
// links turned back by the line's rotation, members in local order, sides 0–5.
// Pure TypeScript: nothing from node:* may be imported here.

import type { StuffKey } from '../../../shared/keys.ts';
import { joinNames } from '../../../shared/layout/format.ts';
import { step, type Rotation, type Vec3 } from '../../../shared/layout/geometry.ts';
import { FACES, type Face } from '../../../shared/types/assets.ts';
import type { ConduitFace, ConduitSpec, CoverSpec } from '../../../shared/types/layout.ts';
import type { Machine, Pack } from '../../../shared/types/pack.ts';
import type { Plan, PlanStep } from '../../../shared/types/plan.ts';
import { stepItemInputs, stepItemOutputs } from '../modes/mode.ts';
import type { ChipKind, FeedBlock, FeedConduitFilter, InterfaceSpec, PatternSpec, RoutedChipSpec } from './contract.ts';
import { AE2, conveyorOp, eioMaxExtracted, PART_KEYS } from './facts.ts';
import { compareLocal, localConnections, localSide, nodeId } from './frame.ts';
import type { Ae2ExportBus, Ae2Iface, Ae2Net, EioFace, EioNet, FeedNode, GtCover, GtPipe, GtPipeNet, InvRef, NodeId, RoutedNet, RoutedPipe } from './model.ts';

// ---- The context `readLine` hands its readers ----

/** A block of the line the readers read (no ghost, no hookup block), at its cell of the line's local frame. */
export interface Cell {
  readonly block: FeedBlock; readonly id: NodeId; readonly local: Vec3; readonly pos: Vec3;
  /** `${block.label} at x y z` (world). */
  readonly label: string;
  /** The pack machine of a GT block (by `block.mteId`), if the pack has it. */
  readonly machine: Machine | undefined;
}

/** What `readLine` hands its network readers (read.ts builds it; it is private to the two files). */
export interface ReadContext {
  readonly pack: Pack; readonly plan: Plan; readonly rotation: Rotation;
  /** Every readable block, in local order. */
  readonly cells: readonly Cell[];
  /** The machine and chest nodes, by id. */
  readonly nodes: ReadonlyMap<NodeId, FeedNode>;
  /** The readable block at a local cell. */
  cellAt(local: Vec3): Cell | undefined;
  /** The inventory on `side` of the local cell `from` (a node, a multiblock's bus, a chest), with its own side toward `from`. */
  invRef(from: Vec3, side: number): InvRef | null;
  /** A world face of a block (covers, conduit faces and interface targets are world faces), as a local side. */
  sideOf(face: Face): number;
  /** A block's connection bits (`1 << side`), local. */
  links(cell: Cell): number;
  /** Item names as the layout writes them (`A`, `A and B`, `A, B and C`): the plan item each names, and those naming none or two. */
  readNames(text: string): { keys: StuffKey[]; unread: string[] };
  /** An item's English name: `plan.names`, else the pack's. */
  nameOf(key: StuffKey): string;
  /** The plan step `id`. */
  step(id: string): PlanStep | undefined;
  /** Records an unknown, at most once per code and block (once per code and step for one tied to no block). */
  unknown(code: string, text: string, at?: Cell, stepId?: string): void;
}

/** ForgeDirection sides 0–5. */
const SIDES: readonly number[] = [0, 1, 2, 3, 4, 5];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each key once, sorted. */
function distinct(keys: Iterable<StuffKey>): StuffKey[] {
  return [...new Set(keys)].sort(compareText);
}

/** The inventories on every side of `cell`, in side order. */
function inventoriesAround(ctx: ReadContext, cell: Cell): InvRef[] {
  return SIDES.flatMap((side) => {
    const ref = ctx.invRef(cell.local, side);
    return ref === null ? [] : [ref];
  });
}

// ---- Linked cells (pipes and conduits) ----

/**
 * The cells of `members` each one links to: a neighbouring member that either cell's bit points at (a layout sets both
 * ends of a link; either one is read as the link). Lists in local order.
 */
function linksAmong(members: readonly Cell[], bitsOf: (c: Cell) => number): Map<NodeId, Cell[]> {
  const byId = new Map(members.map((c) => [c.id, c]));
  const next = new Map<NodeId, Cell[]>(members.map((c) => [c.id, []]));
  const join = (a: Cell, b: Cell): void => {
    const list = next.get(a.id)!;
    if (!list.includes(b)) list.push(b);
  };
  for (const c of members) {
    const bits = bitsOf(c);
    for (const side of SIDES) {
      if ((bits & (1 << side)) === 0) continue;
      const other = byId.get(nodeId(step(c.local, side)));
      if (other === undefined || other === c) continue;
      join(c, other);
      join(other, c);
    }
  }
  for (const list of next.values()) list.sort((a, b) => compareLocal(a.local, b.local));
  return next;
}

/** The linked groups of `members` (in local order, as `members` is), each in local order. */
function linkedGroups(members: readonly Cell[], next: ReadonlyMap<NodeId, readonly Cell[]>): Cell[][] {
  const seen = new Set<NodeId>();
  const groups: Cell[][] = [];
  for (const first of members) {
    if (seen.has(first.id)) continue;
    seen.add(first.id);
    const group = [first];
    for (let i = 0; i < group.length; i++) {
      for (const n of next.get(group[i]!.id) ?? []) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        group.push(n);
      }
    }
    groups.push(group.sort((a, b) => compareLocal(a.local, b.local)));
  }
  return groups;
}

/** Breadth-first hops from every cell of `group` to every cell of it (0 to itself). */
function hopsOf(group: readonly Cell[], next: ReadonlyMap<NodeId, readonly Cell[]>): Record<NodeId, Record<NodeId, number>> {
  const hops: Record<NodeId, Record<NodeId, number>> = {};
  for (const from of group) {
    const dist: Record<NodeId, number> = { [from.id]: 0 };
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]!;
      for (const n of next.get(c.id) ?? []) {
        if (dist[n.id] !== undefined) continue;
        dist[n.id] = dist[c.id]! + 1;
        queue.push(n);
      }
    }
    hops[from.id] = dist;
  }
  return hops;
}

// ---- The target's own items (text fallbacks) ----

/**
 * What an inventory is planned to take (`in`) or give (`out`), for a chip text the reader cannot read (rule 12): a
 * machine's `stepItemInputs` or `stepItemOutputs` over its steps, a chest's `tail.keys`; nothing without a target.
 */
function ownKeys(ctx: ReadContext, target: InvRef | null, dir: 'in' | 'out'): StuffKey[] {
  const node = target === null ? undefined : ctx.nodes.get(target.node);
  if (node === undefined) return [];
  if (node.kind === 'chest') return [...(ctx.cellAt(node.local)?.block.tail?.keys ?? [])];
  return distinct(node.stepIds.flatMap((id) => (dir === 'in' ? stepItemInputs(ctx.plan, id) : stepItemOutputs(ctx.plan, id))));
}

// ---- Project Red (rule 12) ----

const PR_PIPE = 'ProjRed|Transportation:projectred.transportation.pipe@';
const CHIP_KINDS: Readonly<Record<string, ChipKind>> = { Responder: 'responder', Extractor: 'extractor', Broadcaster: 'broadcaster', Terminator: 'terminator' };
/** A filter chip as main writes it: `Item Responder Chip (whitelist: A and B)`, or the chip's bare name for a new one. */
const FILTER_CHIP = /^Item (Responder|Extractor|Broadcaster|Terminator) Chip(?: \((whitelist|blacklist): (.*)\))?$/;
/** A stock keeper as main writes it (machine to machine's input chest): `Item Stock Keeper Chip, keep in stock: A and B`. */
const STOCK_CHIP = /^Item Stock Keeper Chip(?:, keep in stock: (.*))?$/;
const OVERFLOW_CHIP = 'Item Overflow Responder Chip';
/** What a stock keeper read from text keeps of each item (rule 12). */
const TEXT_STOCK = 64;

function copyChip(chip: RoutedChipSpec): RoutedChipSpec {
  return {
    ...chip, ...(chip.filter === undefined ? {} : { filter: { mode: chip.filter.mode, keys: [...chip.filter.keys] } }),
    ...(chip.stock === undefined ? {} : { stock: chip.stock.map((s) => ({ ...s })) }),
  };
}

/**
 * The names of a chip's list as plan items. A name that resolves to no plan item, or to two, gives `text_unread`, and
 * the chip then lists the target's own items: what it takes for a chip that brings items in (responder, terminator,
 * stock keeper), what it makes for one that takes them out (extractor, broadcaster).
 */
function chipKeys(ctx: ReadContext, cell: Cell, text: string, chip: string, target: InvRef | null, dir: 'in' | 'out'): { keys: StuffKey[]; read: boolean } {
  const { keys, unread } = ctx.readNames(text);
  if (unread.length === 0) return { keys, read: true };
  const own = ownKeys(ctx, target, dir);
  ctx.unknown('text_unread', `${cell.label}: the ${chip} lists ${joinNames(unread.map((n) => `"${n}"`))}, which names no single item of the plan, so it is `
    + `read as listing ${own.length === 0 ? 'nothing' : joinNames(own.map((k) => ctx.nameOf(k)))}, what its ${target === null ? 'pipe' : 'inventory'} `
    + `${dir === 'in' ? 'takes' : 'makes'}`, cell);
  return { keys: own, read: false };
}

/** One chip of main's chip text (`config.chips` split on ` + `). */
function chipFromText(ctx: ReadContext, cell: Cell, text: string, target: InvRef | null): RoutedChipSpec[] {
  if (text === OVERFLOW_CHIP) return [{ kind: 'overflow' }];
  const stock = STOCK_CHIP.exec(text);
  if (stock !== null) {
    // a new stock keeper keeps nothing in stock
    const { keys } = stock[1] === undefined ? { keys: [] } : chipKeys(ctx, cell, stock[1], 'Item Stock Keeper Chip', target, 'in');
    return [{ kind: 'stock_keeper', stock: keys.map((key) => ({ key, count: TEXT_STOCK })) }];
  }
  const filter = FILTER_CHIP.exec(text);
  if (filter === null) {
    ctx.unknown('text_unread', `${cell.label}: "${text}" is no chip the checker knows, so it is left out`, cell);
    return [];
  }
  const kind = CHIP_KINDS[filter[1]!]!;
  if (filter[2] === undefined) {
    // a new chip: a responder's, extractor's or terminator's filter is an empty whitelist, a broadcaster's an empty blacklist (research §2.2)
    if (kind === 'extractor') {
      ctx.unknown('extractor_new', `${cell.label}: a new Item Extractor Chip is a whitelist with an empty filter, so it extracts nothing`, cell);
    }
    return [{ kind, filter: { mode: kind === 'broadcaster' ? 'blacklist' : 'whitelist', keys: [] } }];
  }
  const dir = kind === 'responder' || kind === 'terminator' ? 'in' : 'out';
  const { keys, read } = chipKeys(ctx, cell, filter[3]!, `Item ${filter[1]!} Chip`, target, dir);
  return [{ kind, filter: { mode: read ? (filter[2] as 'whitelist' | 'blacklist') : 'whitelist', keys } }];
}

/** A Routed Interface Pipe's chips: `feed.chips`, else its `config.chips` text (Review Focus 4). */
function readChips(ctx: ReadContext, cell: Cell, target: InvRef | null): RoutedChipSpec[] {
  const structured = cell.block.feed?.chips;
  const text = cell.block.config?.chips;
  if (structured !== undefined) {
    if (text !== undefined) ctx.unknown('text_ignored', `${cell.label}: its structured chips are read, and its text "${String(text)}" is ignored`, cell);
    return structured.map(copyChip);
  }
  if (text === undefined) return [];
  ctx.unknown('routed_text', `${cell.label}: its chips are read from the layout's text "${String(text)}"`, cell);
  if (typeof text !== 'string') {
    ctx.unknown('text_unread', `${cell.label}: its chip setting is no text the checker can read, so it has no chips here`, cell);
    return [];
  }
  return text.split(' + ').map((part) => part.trim()).filter((part) => part !== '').flatMap((part) => chipFromText(ctx, cell, part, target));
}

/** A pipe's first linked neighbour, in side order, that is a node, a bus or a chest. */
function linkedInventory(ctx: ReadContext, cell: Cell): InvRef | null {
  const bits = ctx.links(cell);
  for (const side of SIDES) {
    if ((bits & (1 << side)) === 0) continue;
    const ref = ctx.invRef(cell.local, side);
    if (ref !== null) return ref;
  }
  return null;
}

/** Rule 12: one routed network per linked group of Project Red pipes; a Routed Interface Pipe's chips and target. */
export function readRouted(ctx: ReadContext): RoutedNet[] {
  const members = ctx.cells.filter((c) => c.block.item?.startsWith(PR_PIPE) === true);
  const next = linksAmong(members, (c) => ctx.links(c));
  return linkedGroups(members, next).map((group): RoutedNet => ({
    kind: 'routed',
    pipes: group.map((c): RoutedPipe => {
      if (c.block.role !== 'chip_pipe') return { id: c.id, label: c.label, chips: [], target: null };
      const target = linkedInventory(ctx, c);
      return { id: c.id, label: c.label, chips: readChips(ctx, c, target), target };
    }),
    hops: hopsOf(group, next),
  }));
}

// ---- AE2 (rule 13) ----

/** A layout block's `id@meta`. */
function blockKey(b: FeedBlock): StuffKey {
  return `${b.block.id}@${b.block.meta}`;
}

/**
 * The ME Export Bus fix/feeding lays as an AE2 part on the spine's ME cable (architecture §11 entry 51): the cable block's
 * `me_export_bus` cover, on the face toward the machine or input bus it feeds. Only a cable carries one (role `pipe`, no
 * GT tile): GT's blocks take no AE2 part.
 */
function exportBusCover(c: Cell): CoverSpec | undefined {
  if (c.block.role !== 'pipe' || c.machine !== undefined) return undefined;
  return c.block.covers?.find((cover) => cover.item === PART_KEYS.meExportBus);
}

/** An ME Export Bus: a block that is the bus (as main lays the hookup's end), or a cable with the bus on it (`feed.exportBus`, its cover). */
function isExportBus(c: Cell): boolean {
  return blockKey(c.block) === PART_KEYS.meExportBus || c.block.item === PART_KEYS.meExportBus || c.block.feed?.exportBus !== undefined
    || exportBusCover(c) !== undefined;
}

/** The `config` keys main and add-on 12 write an interface's patterns as: `patterns` (count), `pattern`, `pattern2` …, `blockingMode`. */
const PATTERN_KEY = /^pattern\d*$/;

function patternTextKeys(config: FeedBlock['config']): string[] {
  return Object.keys(config ?? {}).filter((k) => k === 'patterns' || k === 'blockingMode' || PATTERN_KEY.test(k));
}

function copyPattern(p: PatternSpec): PatternSpec {
  return { inputs: p.inputs.map((i) => ({ key: i.key, amount: i.amount })), outputs: p.outputs.map((o) => ({ key: o.key, amount: o.amount })) };
}

/**
 * An interface's patterns from its `config`, each taken from the plan step it was written for, the target machine's
 * k-th step, as `step.inputs` → `step.outputs` (fluids and fractions included: what main writes as text).
 */
function textSpec(ctx: ReadContext, cell: Cell, targets: readonly InvRef[]): InterfaceSpec {
  const config = cell.block.config ?? {};
  const blocking = config.blockingMode === true;
  const count = typeof config.patterns === 'number' ? Math.max(0, Math.floor(config.patterns))
    : Object.keys(config).filter((k) => PATTERN_KEY.test(k)).length;
  if (count === 0) return { patterns: [], blocking, lock: 'none' };
  ctx.unknown('ae2_pattern_text', `${cell.label}: its ${count === 1 ? 'pattern is' : 'patterns are'} read from the plan ${count === 1 ? 'step' : 'steps'} `
    + `${count === 1 ? 'it was' : 'they were'} written for, as the layout's text gives ${count === 1 ? 'it' : 'them'}: what the player encodes may differ`, cell);
  const machine = targets.map((t) => ctx.nodes.get(t.node)).find((n) => n !== undefined && n.kind !== 'chest');
  const patterns: PatternSpec[] = [];
  for (let k = 0; k < count; k++) {
    const stepId = machine?.stepIds[k];
    const planStep = stepId === undefined ? undefined : ctx.step(stepId);
    if (planStep === undefined) {
      ctx.unknown('text_unread', `${cell.label}: its pattern ${k + 1} is for no step of ${machine === undefined ? 'a machine it touches' : machine.label}, `
        + 'so it is left out', cell);
      continue;
    }
    patterns.push({ inputs: planStep.inputs.map((p) => ({ key: p.key, amount: p.amount })), outputs: planStep.outputs.map((p) => ({ key: p.key, amount: p.amount })) });
  }
  return { patterns, blocking, lock: 'none' };
}

/** An ME interface: `feed.interface` (its wrench targets turned into local faces), else its patterns from the plan (rule 13). */
function ae2Interface(ctx: ReadContext, cell: Cell): Ae2Iface {
  const given = cell.block.feed?.interface;
  if (given === undefined) {
    const targets = inventoriesAround(ctx, cell);
    return { id: cell.id, label: cell.label, spec: textSpec(ctx, cell, targets), targets };
  }
  const text = patternTextKeys(cell.block.config);
  if (text.length > 0) ctx.unknown('text_ignored', `${cell.label}: its structured patterns are read, and its text (${text.join(', ')}) is ignored`, cell);
  const sides = given.targets === undefined ? null : [...new Set(given.targets.map((f) => ctx.sideOf(f)))].sort((a, b) => a - b);
  const targets = sides === null ? inventoriesAround(ctx, cell) : sides.flatMap((side) => {
    const ref = ctx.invRef(cell.local, side);
    return ref === null ? [] : [ref];
  });
  const spec: InterfaceSpec = { ...given, patterns: given.patterns.map(copyPattern), ...(sides === null ? {} : { targets: sides.map((s) => FACES[s]!) }) };
  return { id: cell.id, label: cell.label, spec, targets };
}

/**
 * What an ME Export Bus feeds (E16): for a bus on a cable, the inventory on its cover's face (a world face, turned into the
 * local frame); for a bus block, the inventory it faces, else its one neighbouring inventory.
 */
function exportTarget(ctx: ReadContext, cell: Cell, label: string): InvRef | null {
  const cover = exportBusCover(cell);
  if (cover !== undefined) {
    const ref = ctx.invRef(cell.local, ctx.sideOf(cover.face));
    if (ref === null) ctx.unknown('export_target_unknown', `${label}: it faces no machine, bus or chest, so what it feeds is not known`, cell);
    return ref;
  }
  const facing = cell.block.facing;
  if (facing !== undefined && Number.isInteger(facing) && facing >= 0 && facing <= 5) {
    const ref = ctx.invRef(cell.local, localSide(facing, ctx.rotation));
    if (ref !== null) return ref;
  }
  const around = inventoriesAround(ctx, cell);
  if (around.length === 1) return around[0]!;
  ctx.unknown('export_target_unknown', `${label}: it ${around.length === 0 ? 'touches no machine, bus or chest' : `touches ${around.length} inventories`}, `
    + 'so what it feeds is not known', cell);
  return null;
}

/** A bus's Acceleration Cards, 0 to 4 (E16); anything else counts as none. */
function cardsOf(n: unknown): 0 | 1 | 2 | 3 | 4 {
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : 0;
}

/**
 * An ME Export Bus outside the hookup (rule 13, E16): its filter and Acceleration Cards from `feed.exportBus`, else from
 * the bus cover on its cable (its `filter` and `settings.accelerationCards`, as fix/feeding writes them there too), else
 * its `config.exportFilter` names. Beside either structured filter that text is ignored, and `text_ignored` says so
 * (Review Focus 4). A bus on a cable is named by its part, at the cable's cell.
 */
function exportBus(ctx: ReadContext, cell: Cell): Ae2ExportBus {
  const given = cell.block.feed?.exportBus;
  const cover = exportBusCover(cell);
  const label = cover === undefined ? cell.label : `${ctx.nameOf(cover.item)} at ${cell.pos.join(' ')}`;
  const text = cell.block.config?.exportFilter;
  let keys: StuffKey[] = [];
  if (given !== undefined || cover !== undefined) {
    if (text !== undefined) ctx.unknown('text_ignored', `${label}: its structured filter is read, and its text "${String(text)}" is ignored`, cell);
    keys = [...(given?.keys ?? cover?.filter ?? [])];
  } else if (text !== undefined) {
    ctx.unknown('export_bus_text', `${label}: its filter is read from the layout's text "${String(text)}"`, cell);
    const read = typeof text === 'string' ? ctx.readNames(text) : { keys: [], unread: [String(text)] };
    if (read.unread.length > 0) {
      ctx.unknown('text_unread', `${label}: its filter lists ${joinNames(read.unread.map((n) => `"${n}"`))}, which names no single item of the plan, `
        + 'so that slot is left out', cell);
    }
    keys = read.keys;
  }
  const cards = cardsOf(given?.cards ?? cover?.settings.accelerationCards);
  return { id: cell.id, label, keys, amount: AE2.exportAmounts[cards], target: exportTarget(ctx, cell, label) };
}

/**
 * Rule 13: the line's ME interfaces and its ME Export Buses, one network. Main lays an interface, and the hookup's end
 * bus, with role `interface`; fix/feeding lays a step's export bus as a part on the spine's cable (`exportBusCover`).
 */
export function readAe2(ctx: ReadContext): Ae2Net[] {
  const buses = ctx.cells.filter(isExportBus);
  const interfaces = ctx.cells.filter((c) => c.block.role === 'interface' && !isExportBus(c));
  if (interfaces.length === 0 && buses.length === 0) return [];
  return [{ kind: 'ae2', interfaces: interfaces.map((c) => ae2Interface(ctx, c)), exportBuses: buses.map((c) => exportBus(ctx, c)) }];
}

// ---- EnderIO (rule 14) ----

function itemConduit(cell: Cell): ConduitSpec | undefined {
  return cell.block.conduits?.find((c) => c.kind === 'item');
}

/**
 * A face's filter, copied. A Limited Item Filter on an extract side raises `eio_limited_extract` (it extracts only
 * what is above its counts, which the checker does not model); one without counts raises `limited_counts_missing` and
 * is read as a whitelist of its keys.
 */
function conduitFilter(ctx: ReadContext, cell: Cell, face: Face, filter: FeedConduitFilter | null, side: 'extract' | 'insert'): FeedConduitFilter | null {
  if (filter === null) return null;
  const copy: FeedConduitFilter = { ...filter, keys: [...filter.keys] };
  if (filter.limits !== undefined) copy.limits = filter.limits.map((l) => ({ key: l.key, count: l.count }));
  if (filter.item !== PART_KEYS.limitedFilter) return copy;
  if (side === 'extract') {
    ctx.unknown('eio_limited_extract', `${cell.label}: the Limited Item Filter on its ${face} face's extract side extracts only what is above its counts, `
      + 'which the checker does not model', cell);
  }
  if (copy.limits !== undefined) return copy;
  ctx.unknown('limited_counts_missing', `${cell.label}: the Limited Item Filter on its ${face} face has no counts, so it is read as a whitelist of its items`, cell);
  return { ...copy, whitelist: true };
}

function eioFace(ctx: ReadContext, cell: Cell, face: ConduitFace, side: number): EioFace {
  const out: EioFace = { id: `${cell.id}:${side}`, conduit: cell.id, side, target: ctx.invRef(cell.local, side), label: `${cell.label}, ${face.face} face` };
  const { extract, insert } = face;
  if (extract !== undefined && (face.mode === 'extract' || face.mode === 'in_out')) {
    out.extract = {
      color: extract.color, filter: conduitFilter(ctx, cell, face.face, extract.filter, 'extract'), max: eioMaxExtracted(extract.speed?.count ?? 0),
      roundRobin: extract.roundRobin, selfFeed: extract.selfFeed ?? false, redstone: extract.redstone,
    };
  }
  if (insert !== undefined && (face.mode === 'insert' || face.mode === 'in_out')) {
    out.insert = { color: insert.color, filter: conduitFilter(ctx, cell, face.face, insert.filter, 'insert'), priority: insert.priority ?? 0 };
  }
  return out;
}

/** Rule 14: one EnderIO network per linked group of item conduits; every face not disabled, in local side order. */
export function readEnderio(ctx: ReadContext): EioNet[] {
  const members = ctx.cells.filter((c) => itemConduit(c) !== undefined);
  const next = linksAmong(members, (c) => localConnections(itemConduit(c)!.connections, ctx.rotation));
  return linkedGroups(members, next).map((group): EioNet => ({
    kind: 'enderio',
    faces: group.flatMap((c) => itemConduit(c)!.faces
      .filter((f) => f.mode !== 'disabled')
      .map((f) => ({ f, side: ctx.sideOf(f.face) }))
      .sort((a, b) => a.side - b.side)
      .map(({ f, side }) => eioFace(ctx, c, f, side))),
    hops: hopsOf(group, next),
  }));
}

// ---- GT item pipes (rule 15) ----

function gtPipe(ctx: ReadContext, cell: Cell): GtPipe {
  const links = ctx.links(cell);
  const sides = SIDES.flatMap((side) => {
    const ref = (links & (1 << side)) === 0 ? null : ctx.invRef(cell.local, side);
    return ref === null ? [] : [{ side, target: ref }];
  });
  return { id: cell.id, label: cell.label, capacity: cell.machine?.itemPipe?.stacksPerSecond ?? 1, links, sides };
}

/** Rule 15: one network per linked group of GT item pipes; each pipe's linked sides that touch an inventory. */
export function readGtPipes(ctx: ReadContext): GtPipeNet[] {
  const members = ctx.cells.filter((c) => c.machine?.kind === 'item_pipe');
  const next = linksAmong(members, (c) => ctx.links(c));
  return linkedGroups(members, next).map((group): GtPipeNet => ({ kind: 'gtpipe', pipes: group.map((c) => gtPipe(ctx, c)) }));
}

// ---- Covers (rule 11) ----

function gtCover(host: NodeId, side: number, cover: CoverSpec): GtCover | null {
  const op = conveyorOp(cover.item);
  if (op !== null) {
    return { host, side, kind: 'conveyor', export: cover.settings.mode === 'export', allowInput: cover.settings.allowInput === true,
      op: { tickRate: op.tickRate, stacks: op.stacks, items: op.items } };
  }
  if (cover.item === PART_KEYS.itemFilterCover) {
    // GT's Item Filter cover lets items in and out (E9; plan Task 4 rule 5)
    return { host, side, kind: 'filter', export: true, allowInput: true,
      filter: { mode: cover.settings.mode === 'blacklist' ? 'blacklist' : 'whitelist', keys: [...(cover.filter ?? [])] } };
  }
  if (cover.item === PART_KEYS.shutter) {
    const mode = cover.settings.mode;
    return { host, side, kind: 'shutter', export: false, allowInput: false, shutter: mode === 'input_only' || mode === 'output_only' ? mode : 'open' };
  }
  return null;
}

/**
 * Rule 11: every block's covers (cover faces are world faces), by host in local order, then side. A cover that is no
 * conveyor, Item Filter or Shutter cover, and any cover on a steam machine (GT lets only primitive covers onto one,
 * E17), is not read: `cover_unknown` names them. The ME Export Bus on a cable is no GT cover: `readAe2` reads it.
 */
export function readCovers(ctx: ReadContext): GtCover[] {
  const covers: GtCover[] = [];
  for (const cell of ctx.cells) {
    const bus = exportBusCover(cell);
    const list = (cell.block.covers ?? []).filter((cover) => cover !== bus).map((cover) => ({ cover, side: ctx.sideOf(cover.face) }))
      .sort((a, b) => a.side - b.side);
    const steam = cell.machine?.kind === 'steam';
    const unread: string[] = [];
    for (const { cover, side } of list) {
      const read = steam ? null : gtCover(cell.id, side, cover);
      if (read === null) unread.push(`${ctx.nameOf(cover.item)} (${cover.face} face)`);
      else covers.push(read);
    }
    if (unread.length > 0) {
      ctx.unknown('cover_unknown', `${cell.label}: ${joinNames(unread)} ${unread.length === 1 ? 'is' : 'are'} not read: `
        + (steam ? 'GregTech lets only primitive covers onto a steam machine' : 'the checker models conveyor, Item Filter and Shutter covers only'), cell);
    }
  }
  return covers;
}
