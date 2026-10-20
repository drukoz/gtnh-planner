// What the Connections view shows (plan 11 Task 7; spec §3.8c; architecture §11.30 and "EnderIO conduits, granted
// change requests (add-on 11)"), as pure functions: every placed machine, chest, interface and hookup of a laid-out
// line as a box whose rows are its faces with their exact configuration (the covers on it and its own settings, the
// covers of pipes and the conduit faces that point at it), and the plan's flows as links between the boxes, each saying
// what carries it (the shared GT item pipe, a GT fluid pipe, the routed network, the ME network, an item or ender fluid
// conduit on its channel colour) and through which faces, each conduit face's row naming its mode and the channel of
// each of its sides; then each interface attached to what it serves and each
// logistics hookup joining the line. Also the ELK graph that lays the boxes out (inputs on the left, outputs on the
// right), the picture read back from ELK, and what a picked box, face or link tells; and where each link starts and
// ends in the world, which the 3D view's Show connections draws (the user's requirements of 2026-10-19, item 3 (b)).
// No DOM and no browser APIs: the server's tests lay real lines out and read their graphs too. Every order is fixed,
// so a layout gives one graph.

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { configTexts, conduitFaceText, coverText, faceName } from '../../shared/layout/configure-text.ts';
import { CONDUIT_MODE_NAMES, CONDUIT_NAMES, DYE_NAMES, hookupNetworkKind } from '../../shared/layout/enderio.ts';
import { fmtInt, fmtRate, joinNames, NETWORK_NAMES } from '../../shared/layout/format.ts';
import { DIRS, OPPOSITE, posKey, sideToward, step, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES, type Face } from '../../shared/types/assets.ts';
import type {
  BlockRole, ConduitFace, ConduitFilter, ConduitKind, ConduitMode, CoverSpec, DyeColor, Layout, LayoutBlock, TailChest,
} from '../../shared/types/layout.ts';
import type { LogisticsMode, Plan } from '../../shared/types/plan.ts';

// ---- Types ----

export type ConnNodeKind = 'machine' | 'chest' | 'interface' | 'hookup' | 'source' | 'sink';

/** A conduit face's mode and the channel colour of each side it has. */
export interface ConnFaceMode { mode: ConduitMode; extract?: DyeColor; insert?: DyeColor }

/**
 * One row of a box: a cover, a block's settings or a conduit face, with its configuration in a builder's words. A
 * conduit face's row also carries its `mode` (the audit of the EnderIO In / Out fix), which the picture shows on the
 * row's second line (`faceModeText`), so an In / Out face shows that what comes in and what goes out pass it.
 */
export interface ConnFace { id: string; title: string; lines: string[]; mode?: ConnFaceMode }

/** A box: a plan step's machines, a chest, an interface, a hookup, or where raw inputs come from (`raw`) and final outputs go (`out`). */
export interface ConnNode {
  id: string; kind: ConnNodeKind; title: string; lines: string[]; faces: ConnFace[]; blocks: number[] /* indices into layout.blocks */;
  width: number; height: number;
  // optional addition (plan 11, ruling R19)
  /** Which side of the line a tail chest stands for; set only on a chest whose block has a `tail`. */
  tail?: 'input' | 'output';
}

/** What carries a link: a flow's network, an interface on what it serves, or a hookup joining the line. */
export type ConnVia = 'gt_pipe' | 'fluid_pipe' | 'routed' | 'ae2' | 'item_conduit' | 'fluid_conduit' | 'attached' | 'hookup';

/**
 * A link between two boxes. A flow carries `key` at `perSecond` and, on conduits, leaves and enters through the faces
 * `fromFace` and `toFace` (`ConnFace` ids) on its channel `color`; the other links carry nothing (null and 0).
 */
export interface ConnEdge {
  id: string; from: string; to: string; via: ConnVia; key: StuffKey | null; perSecond: number; label: string; lines: string[];
  color: DyeColor | null; fromFace: string | null; toFace: string | null;
}

export interface ConnGraph { nodes: ConnNode[]; edges: ConnEdge[] }

/** A box is this wide, and this tall for its title plus this much per line and per line of a face row (plus `BOX_PADDING`). */
export const CONN_NODE_WIDTH = 260;
export const CONN_TITLE_HEIGHT = 28;
export const CONN_LINE_HEIGHT = 16;
const BOX_PADDING = 8;

export interface ConnLayout {
  width: number; height: number;
  nodes: Array<ConnNode & { x: number; y: number }>;
  /** `labelAt`: the centre of the link's label where ELK placed it. */
  edges: Array<ConnEdge & { points: Array<[number, number]>; labelAt?: [number, number] }>;
}

/** A picked box, one of its face rows, or a link. */
export type ConnPick = { node: string; face?: string } | { edge: string };

/**
 * A conduit face's mode and channels in a few words: `<mode>[ · in <insert colour>][ · out <extract colour>]`, where in
 * is into the block the face points at (its insert side) and out is out of it (its extract side), as its links go into
 * and out of the box; for example `In / Out · in Blue · out Red`. A face whose two sides share a channel, as an EnderIO
 * line's faces do on its one channel, names it once: `In / Out · Red`. At most 41 characters.
 */
export function faceModeText(m: ConnFaceMode): string {
  if (m.insert !== undefined && m.insert === m.extract) return `${CONDUIT_MODE_NAMES[m.mode]} · ${DYE_NAMES[m.insert]}`;
  return `${CONDUIT_MODE_NAMES[m.mode]}${m.insert === undefined ? '' : ` · in ${DYE_NAMES[m.insert]}`}`
    + `${m.extract === undefined ? '' : ` · out ${DYE_NAMES[m.extract]}`}`;
}

/** How many text lines a face row takes in its box: its title, and a conduit face's mode under it. */
export function faceLines(face: ConnFace): number {
  return face.mode === undefined ? 1 : 2;
}

// ---- Words ----

const RAW = 'raw';
const OUT = 'out';
const INTERFACE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['interface', 'chip_pipe']);

/** What carries a flow. */
type FlowVia = Exclude<ConnVia, 'attached' | 'hookup'>;
/** What carries an item flow in each mode; a fluid goes over GT fluid pipes, or the ender fluid conduit in EnderIO mode. */
const ITEM_VIA: Readonly<Record<LogisticsMode, FlowVia>> = { direct: 'gt_pipe', routed: 'routed', ae2: 'ae2', enderio: 'item_conduit' };
const VIA_TEXT: Readonly<Record<FlowVia, string>> = {
  gt_pipe: 'Shared GT item pipe', fluid_pipe: 'GT fluid pipe', routed: 'Project Red routed network', ae2: 'ME network',
  item_conduit: 'Item Conduit', fluid_conduit: 'Ender fluid conduit',
};

/** A tier's name; a tier outside 0..14 shows as its number instead of breaking the view (as the flow diagram does). */
function tierText(t: number): string {
  return TIER_NAMES[t] ?? `tier ${t}`;
}

function defined<T>(x: T | undefined): x is T {
  return x !== undefined;
}

/** The six face neighbours of `p`. */
function neighbours(p: Vec3): Vec3[] {
  return FACES.map((_, side) => step(p, side));
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

// ---- Boxes ----

/** A conduit face and the block holding it. */
interface ConduitRef { host: LayoutBlock; kind: ConduitKind; face: ConduitFace }

/** A face row, with the conduit face behind it when it is one (its sides tell which flows pass it). */
interface Row { face: ConnFace; conduit: ConduitFace | null }

/** The layout's blocks, the index of the block on each posKey (no ghosts), and the box each boxed block belongs to. */
interface Grid { blocks: readonly LayoutBlock[]; at: ReadonlyMap<string, number>; owner: ReadonlyMap<number, string> }

/**
 * The line's boxes in order, without faces: one per plan step that has placed blocks (plan order), per chest, per
 * interface or chip pipe (a hookup's end interface included: it is configured like the line's), per hookup. A block
 * belongs to one box at most; ghosts to none.
 */
function lineBoxes(layout: Layout, plan: Plan, nameOf: (k: StuffKey) => string): { nodes: ConnNode[]; tails: Map<string, TailChest> } {
  const blocks = layout.blocks;
  const live = blocks.flatMap((b, i) => (b.role === 'ghost' ? [] : [i]));
  const isInterface = (i: number): boolean => INTERFACE_ROLES.has(blocks[i]!.role);
  const nodes: ConnNode[] = [];
  const tails = new Map<string, TailChest>();
  const add = (node: Omit<ConnNode, 'faces' | 'width' | 'height'>): void => {
    nodes.push({ ...node, faces: [], width: CONN_NODE_WIDTH, height: 0 });
  };

  for (const s of plan.steps) {
    const own = live.filter((i) => blocks[i]!.stepId === s.id && blocks[i]!.hookup === undefined && !isInterface(i));
    if (own.length === 0) continue;
    const machines = Math.max(1, own.filter((i) => blocks[i]!.role === 'machine').length);
    add({ id: `step:${s.id}`, kind: 'machine', title: `${fmtInt(machines)}× ${s.machine.name}`,
      lines: [`${tierText(s.machine.tier)} · ${fmtInt(s.euPerTick)} EU/t`], blocks: own });
  }
  for (const i of live) {
    const b = blocks[i]!;
    if (b.role !== 'chest' || b.hookup !== undefined) continue;
    const id = `chest:${posKey(b.pos)}`;
    const names = joinNames((b.tail?.keys ?? []).map(nameOf));
    // a tail chest with no keys says nothing rather than "Takes in: "
    const lines = b.tail === undefined || names === '' ? [] : [`${b.tail.side === 'input' ? 'Takes in' : 'Collects'}: ${names}`];
    add({ id, kind: 'chest', title: b.label, lines, blocks: [i], ...(b.tail === undefined ? {} : { tail: b.tail.side }) });
    if (b.tail !== undefined) tails.set(id, b.tail);
  }
  for (const i of live.filter(isInterface)) {
    const b = blocks[i]!;
    add({ id: `iface:${posKey(b.pos)}`, kind: 'interface', title: b.label, lines: configTexts(b.config ?? {}), blocks: [i] });
  }
  layout.hookups.forEach((h, n) => {
    const laid = live.filter((i) => blocks[i]!.hookup === n);
    const kind = hookupNetworkKind(h, layout.mode);
    add({ id: `hookup:${n}`, kind: 'hookup', title: `${kind === null ? 'Power' : NETWORK_NAMES[kind]} tap at ${h.from.pos.join(' ')}`,
      lines: [`${fmtInt(laid.length)} block${laid.length === 1 ? '' : 's'} to lay`, ...h.parts.map((p) => `${fmtInt(p.amount)}× ${nameOf(p.key)}`),
        ...(h.found === false ? ['No free route was found: the path is a straight guide line'] : [])],
      blocks: laid.filter((i) => !isInterface(i)) });
  });
  return { nodes, tails };
}

/** `<host label>, <face> face`: one cover in a builder's words. */
function coverRow(node: string, host: LayoutBlock, cover: CoverSpec, nameOf: (k: StuffKey) => string): Row {
  return { face: { id: `${node}#cover:${posKey(host.pos)}:${cover.face}`, title: `${host.label}, ${faceName(cover.face)} face`, lines: [coverText(cover, nameOf)] }, conduit: null };
}

/** What follows `<box id>#` in the id of a conduit face's row: the conduit's cell, its kind and the face. */
function conduitRowKey(pos: Vec3, kind: ConduitKind, face: Face): string {
  return `conduit:${posKey(pos)}:${kind}:${face}`;
}

/**
 * `<label>, <side of what the face points at> side · <conduit name>`: one conduit face in a builder's words, with its
 * mode and the colour of each side it has.
 */
function conduitRow(node: string, ref: ConduitRef, label: string, nameOf: (k: StuffKey) => string): Row {
  const side: Face = FACES[OPPOSITE[FACES.indexOf(ref.face.face)]!]!;
  const { mode, extract, insert } = ref.face;
  return {
    face: { id: `${node}#${conduitRowKey(ref.host.pos, ref.kind, ref.face.face)}`, title: `${label}, ${faceName(side)} side · ${CONDUIT_NAMES[ref.kind]}`,
      lines: [conduitFaceText(ref.kind, ref.face, nameOf)],
      mode: { mode, ...(extract === undefined ? {} : { extract: extract.color }), ...(insert === undefined ? {} : { insert: insert.color }) } },
    conduit: ref.face,
  };
}

/**
 * What points at each boxed block, by its index, in block, conduit and face order: the covers of pipes that are in no
 * box (a boxed pipe shows its covers as its own) and every conduit face. `loose`: the conduit faces that point at no
 * boxed block (an open fluid end, toward your tank).
 */
function pointing(grid: Grid): { covers: Map<number, Array<{ host: LayoutBlock; cover: CoverSpec }>>; conduits: Map<number, ConduitRef[]>; loose: ConduitRef[] } {
  const covers = new Map<number, Array<{ host: LayoutBlock; cover: CoverSpec }>>();
  const conduits = new Map<number, ConduitRef[]>();
  const loose: ConduitRef[] = [];
  const boxedAt = (b: LayoutBlock, face: Face): number | undefined => {
    const i = grid.at.get(posKey(step(b.pos, FACES.indexOf(face))));
    return i !== undefined && grid.owner.has(i) ? i : undefined;
  };
  grid.blocks.forEach((b, i) => {
    if (b.role === 'ghost') return;
    if (b.role === 'pipe' && !grid.owner.has(i)) {
      for (const cover of b.covers ?? []) {
        const at = boxedAt(b, cover.face);
        if (at !== undefined) append(covers, at, { host: b, cover });
      }
    }
    for (const c of b.conduits ?? []) {
      for (const face of c.faces) {
        const ref: ConduitRef = { host: b, kind: c.kind, face };
        const at = boxedAt(b, face.face);
        if (at === undefined) loose.push(ref);
        else append(conduits, at, ref);
      }
    }
  });
  return { covers, conduits, loose };
}

/**
 * A box's rows, by its blocks in index order: each block's own covers, its settings (not for an interface, whose
 * settings are its lines: plan 11, ruling R21; nothing for empty settings), the pipe covers and the conduit faces that
 * point at it.
 */
function boxRows(node: ConnNode, grid: Grid, at: ReturnType<typeof pointing>, nameOf: (k: StuffKey) => string): Row[] {
  return node.blocks.flatMap((i): Row[] => {
    const b = grid.blocks[i]!;
    const config = node.kind === 'interface' ? [] : configTexts(b.config ?? {});
    return [
      ...(b.covers ?? []).map((cover) => coverRow(node.id, b, cover, nameOf)),
      ...(config.length === 0 ? [] : [{ face: { id: `${node.id}#config:${posKey(b.pos)}`, title: `${b.label} settings`, lines: config }, conduit: null }]),
      ...(at.covers.get(i) ?? []).map(({ host, cover }) => coverRow(node.id, host, cover, nameOf)),
      ...(at.conduits.get(i) ?? []).map((ref) => conduitRow(node.id, ref, b.label, nameOf)),
    ];
  });
}

// ---- Links ----

/** A filter passes a key: on its list for a whitelist, off it for a blacklist; no filter passes everything. */
function passes(filter: ConduitFilter | null, key: StuffKey): boolean {
  return filter === null || filter.keys.includes(key) === filter.whitelist;
}

/** One link per (from, to, key) of the plan's flows, in flow order, with their rates summed. */
interface FlowLink { id: string; from: string; to: string; key: StuffKey; perSecond: number }

/**
 * Each flow with a placed end, from its step's box (else the input chest that takes the key in, else `raw`) to its
 * step's box (else the output chest that collects the key, else `out`).
 */
function flowLinks(plan: Plan, placed: ReadonlySet<string>, tails: ReadonlyMap<string, TailChest>): FlowLink[] {
  const chest = (side: TailChest['side'], key: StuffKey): string | undefined =>
    [...tails].find(([, t]) => t.side === side && t.keys.includes(key))?.[0];
  const links = new Map<string, FlowLink>();
  for (const f of plan.flows) {
    if (!placed.has(f.from) && !placed.has(f.to)) continue;
    const from = placed.has(f.from) ? `step:${f.from}` : chest('input', f.key) ?? RAW;
    const to = placed.has(f.to) ? `step:${f.to}` : chest('output', f.key) ?? OUT;
    const id = `flow:${from}>${to}:${f.key}`;
    const link = links.get(id);
    if (link === undefined) links.set(id, { id, from, to, key: f.key, perSecond: f.perSecond });
    else link.perSecond += f.perSecond;
  }
  return [...links.values()];
}

/**
 * A flow's link: over the mode's network; through the first conduit face of its source box whose extract side passes
 * the key and the first of its target box whose insert side does, on the extract side's colour (else the insert
 * side's); labelled with the good, its rate and the channel, and told in full: the network, each end and its face.
 */
function flowEdge(link: FlowLink, ends: { from: ConnNode; to: ConnNode }, conduitOf: ReadonlyMap<string, ConduitFace>, mode: LogisticsMode,
  per: 'min' | 'hour', nameOf: (k: StuffKey) => string): ConnEdge {
  const via: FlowVia = isFluidKey(link.key) ? (mode === 'enderio' ? 'fluid_conduit' : 'fluid_pipe') : ITEM_VIA[mode];
  const through = (node: ConnNode, side: 'extract' | 'insert'): ConnFace | undefined => node.faces.find((f) => {
    const s = conduitOf.get(f.id)?.[side];
    return s !== undefined && passes(s.filter, link.key);
  });
  const fromFace = through(ends.from, 'extract'), toFace = through(ends.to, 'insert');
  const color = (fromFace === undefined ? undefined : conduitOf.get(fromFace.id)?.extract?.color)
    ?? (toFace === undefined ? undefined : conduitOf.get(toFace.id)?.insert?.color) ?? null;
  const channel = color === null ? '' : DYE_NAMES[color];
  return {
    id: link.id, from: link.from, to: link.to, via, key: link.key, perSecond: link.perSecond,
    label: `${nameOf(link.key)} ${fmtRate(link.perSecond * (per === 'min' ? 60 : 3600))}/${per === 'min' ? 'min' : 'h'}${channel === '' ? '' : ` · ${channel}`}`,
    lines: [`${VIA_TEXT[via]}${channel === '' ? '' : `, channel ${channel}`}`, ...endLines('From', ends.from, fromFace), ...endLines('To', ends.to, toFace)],
    color, fromFace: fromFace?.id ?? null, toFace: toFace?.id ?? null,
  };
}

/** One end of a flow in full: `<From|To> <box>[ — <face row>]`, then the face row's own lines. */
function endLines(word: 'From' | 'To', node: ConnNode, face: ConnFace | undefined): string[] {
  return [`${word} ${node.title}${face === undefined ? '' : ` — ${face.title}`}`, ...(face?.lines ?? [])];
}

/** A link that carries nothing: an interface on what it serves, or a hookup joining the line. */
function plainEdge(id: string, from: string, to: string, via: 'attached' | 'hookup', label: string, line: string): ConnEdge {
  return { id, from, to, via, key: null, perSecond: 0, label, lines: [line], color: null, fromFace: null, toFace: null };
}

/** The boxes of `among` with a block face-adjacent to one of `cells`, in box order. */
function touching(cells: readonly Vec3[], among: readonly ConnNode[], grid: Grid): ConnNode[] {
  const near = new Set(cells.flatMap(neighbours).map((p) => {
    const i = grid.at.get(posKey(p));
    return i === undefined ? undefined : grid.owner.get(i);
  }).filter(defined));
  return among.filter((n) => near.has(n.id));
}

/** Each interface to each machine or chest box one of whose blocks touches it, in box order. */
function attachedEdges(nodes: readonly ConnNode[], grid: Grid): ConnEdge[] {
  const served = nodes.filter((n) => n.kind === 'machine' || n.kind === 'chest');
  return nodes.filter((n) => n.kind === 'interface').flatMap((iface) =>
    touching(iface.blocks.map((i) => grid.blocks[i]!.pos), served, grid)
      .map((n) => plainEdge(`attach:${iface.id}>${n.id}`, iface.id, n.id, 'attached', '', `Attached to ${n.title}`)));
}

/**
 * Each logistics hookup to the line box it joins (plan 11, ruling R20 as amended in Task 7's review): the one holding
 * the block its end block points at (its facing, or a face of its conduit that is not Disabled); else the input chest,
 * where a hookup brings the base's items in (a routed hookup's request pipe fills it); else `raw`, which stands for the
 * base's ME network in AE2 mode, where the line has no chests; else none. Its own end interface is not a candidate.
 */
function hookupEdges(layout: Layout, nodes: readonly ConnNode[], grid: Grid): ConnEdge[] {
  return layout.hookups.flatMap((h, n): ConnEdge[] => {
    if (h.kind !== 'logistics') return [];
    const own = (i: number): boolean => grid.blocks[i]!.hookup === n;
    const line = nodes.filter((x) => (x.kind === 'machine' || x.kind === 'chest' || x.kind === 'interface') && !x.blocks.some(own));
    const last = h.path[h.path.length - 1];
    const endAt = last === undefined ? undefined : grid.at.get(posKey(last));
    const end = endAt !== undefined && own(endAt) ? grid.blocks[endAt]! : undefined;
    const sides = end === undefined ? [] : [
      ...(end.facing !== undefined && FACES[end.facing] !== undefined ? [end.facing] : []),
      ...(end.conduits ?? []).flatMap((c) => c.faces.filter((f) => f.mode !== 'disabled').map((f) => FACES.indexOf(f.face))),
    ];
    const pointed = end === undefined ? undefined : sides.map((side) => {
      const i = grid.at.get(posKey(step(end.pos, side)));
      return line.find((x) => i !== undefined && x.id === grid.owner.get(i));
    }).find(defined);
    const target = pointed ?? nodes.find((x) => x.tail === 'input') ?? nodes.find((x) => x.id === RAW);
    return target === undefined ? [] : [plainEdge(`hookup:${n}>${target.id}`, `hookup:${n}`, target.id, 'hookup', 'hookup', `Joins the line at ${target.title}`)];
  });
}

// ---- The graph ----

/** Whether a plan and its layout hold a line to connect: a plan that makes something and a layout that places it. */
export function hasLine(plan: Plan, layout: Layout): boolean {
  return plan.status !== 'empty' && plan.status !== 'infeasible' && layout.status !== 'empty';
}

/**
 * Spec §3.8c: the boxes of `layout` (machines per plan step, chests, interfaces, hookups, then `raw` and `out` when a
 * link or a face needs them) with their face rows and sizes (a conduit face's row takes two lines), and the links: the
 * plan's flows (rates per `per`), then the attached interfaces, then the hookups. A conduit face that points at no box
 * (an open fluid end, toward your tank) goes to `raw` when it extracts and to `out` when it inserts, so an In / Out one
 * is in both and both its links name it.
 */
export function connectionsGraph(layout: Layout, plan: Plan, per: 'min' | 'hour'): ConnGraph {
  const nameOf = (k: StuffKey): string => plan.names?.[k] ?? k;
  const { nodes, tails } = lineBoxes(layout, plan, nameOf);
  const at = new Map<string, number>();
  layout.blocks.forEach((b, i) => {
    if (b.role !== 'ghost' && !at.has(posKey(b.pos))) at.set(posKey(b.pos), i);
  });
  const owner = new Map(nodes.flatMap((n) => n.blocks.map((i): [number, string] => [i, n.id])));
  const grid: Grid = { blocks: layout.blocks, at, owner };

  // a face pointing at no box names what is on that side (your tank) where a box's face names its block
  const incoming = pointing(grid);
  const rows = new Map(nodes.map((n) => [n.id, boxRows(n, grid, incoming, nameOf)]));
  const extracts = (r: ConduitRef): boolean => r.face.mode === 'extract' || r.face.mode === 'in_out';
  const inserts = (r: ConduitRef): boolean => r.face.mode === 'insert' || r.face.mode === 'in_out';
  rows.set(RAW, incoming.loose.filter(extracts).map((r) => conduitRow(RAW, r, r.face.target, nameOf)));
  rows.set(OUT, incoming.loose.filter(inserts).map((r) => conduitRow(OUT, r, r.face.target, nameOf)));

  const boxed = new Set(nodes.map((n) => n.id));
  const links = flowLinks(plan, new Set(plan.steps.map((s) => s.id).filter((id) => boxed.has(`step:${id}`))), tails);
  for (const [id, kind, title] of [[RAW, 'source', 'Raw inputs'], [OUT, 'sink', 'Final outputs']] as const) {
    if ((rows.get(id) ?? []).length > 0 || links.some((l) => l.from === id || l.to === id)) {
      nodes.push({ id, kind, title, lines: [], faces: [], blocks: [], width: CONN_NODE_WIDTH, height: 0 });
    }
  }
  const conduitOf = new Map<string, ConduitFace>();
  for (const n of nodes) {
    const own = rows.get(n.id) ?? [];
    n.faces = own.map((r) => r.face);
    for (const r of own) if (r.conduit !== null) conduitOf.set(r.face.id, r.conduit);
    n.height = CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * (n.lines.length + n.faces.reduce((sum, f) => sum + faceLines(f), 0)) + BOX_PADDING;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const flows = links.map((l) => flowEdge(l, { from: byId.get(l.from)!, to: byId.get(l.to)! }, conduitOf, layout.mode, per, nameOf));
  return { nodes, edges: [...flows, ...attachedEdges(nodes, grid), ...hookupEdges(layout, nodes, grid)] };
}

// ---- ELK ----

/** The flow diagram's layout options (web-stack §7). */
const LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.spacing.nodeNodeBetweenLayers': '60',
};
const LAYER_CONSTRAINT = 'elk.layered.layering.layerConstraint';
/** Link label boxes for ELK: the label font is about this wide per character and this tall. */
const LABEL_CHAR_WIDTH = 6.5;
const LABEL_PADDING = 8;
const LABEL_HEIGHT = 14;

/**
 * The layer a box is held to: raw inputs and input chests first, final outputs and output chests last (a chest's side
 * is its `tail`, plan 11 ruling R19). A hookup goes in a layer of its own before the first: ELK lets a FIRST box take
 * links only from FIRST_SEPARATE boxes, and a hookup joins the line at its input chest.
 */
function layerOf(n: ConnNode): string | null {
  if (n.kind === 'hookup') return 'FIRST_SEPARATE';
  if (n.kind === 'source' || n.tail === 'input') return 'FIRST';
  if (n.kind === 'sink' || n.tail === 'output') return 'LAST';
  return null;
}

/** The ELK graph of the boxes and links, with a label box on every link that has a label. */
export function connectionsElk(g: ConnGraph): ElkNode {
  const children = g.nodes.map((n): ElkNode => {
    const layer = layerOf(n);
    return { id: n.id, width: n.width, height: n.height, ...(layer === null ? {} : { layoutOptions: { [LAYER_CONSTRAINT]: layer } }) };
  });
  const edges = g.edges.map((e): ElkExtendedEdge => ({
    id: e.id, sources: [e.from], targets: [e.to],
    ...(e.label === '' ? {} : {
      labels: [{ id: `${e.id}#label`, text: e.label, width: Math.ceil(e.label.length * LABEL_CHAR_WIDTH) + LABEL_PADDING, height: LABEL_HEIGHT }],
    }),
  }));
  return { id: 'root', layoutOptions: { ...LAYOUT_OPTIONS }, children, edges };
}

/** The laid-out picture: box positions, and each link as the start, bend and end points of its first section. */
export function connectionsFromElk(g: ConnGraph, laid: ElkNode): ConnLayout {
  const placed = new Map((laid.children ?? []).map((c) => [c.id, c]));
  const nodes = g.nodes.map((n) => ({ ...n, x: placed.get(n.id)?.x ?? 0, y: placed.get(n.id)?.y ?? 0 }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const routed = new Map((laid.edges ?? []).map((e) => [e.id, e]));
  const edges = g.edges.map((e): ConnLayout['edges'][number] => {
    const laidEdge = routed.get(e.id);
    const section = laidEdge?.sections?.[0];
    let points: Array<[number, number]>;
    if (section !== undefined) {
      points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p): [number, number] => [p.x, p.y]);
    } else {
      // No route came back: a straight line from the right side of one box to the left side of the other.
      const a = at.get(e.from);
      const b = at.get(e.to);
      points = a === undefined || b === undefined ? [] : [[a.x + a.width, a.y + a.height / 2], [b.x, b.y + b.height / 2]];
    }
    const label = laidEdge?.labels?.[0];
    const edge: ConnLayout['edges'][number] = { ...e, points };
    if (label?.x !== undefined && label.y !== undefined) edge.labelAt = [label.x + (label.width ?? 0) / 2, label.y + (label.height ?? 0) / 2];
    return edge;
  });
  const width = laid.width ?? Math.max(0, ...nodes.map((n) => n.x + n.width));
  const height = laid.height ?? Math.max(0, ...nodes.map((n) => n.y + n.height));
  return { width, height, nodes, edges };
}

// ---- Picking ----

/**
 * What a pick tells: a box, its lines and then every face row's title and lines; one face row, its own; a link, its
 * label (or its first line when it has none, as an attached link) and its lines. Null for anything the graph does not
 * hold.
 */
export function pickDetails(g: ConnGraph, pick: ConnPick): { title: string; lines: string[] } | null {
  if ('edge' in pick) {
    const e = g.edges.find((x) => x.id === pick.edge);
    return e === undefined ? null : { title: e.label === '' ? e.lines[0] ?? '' : e.label, lines: [...e.lines] };
  }
  const n = g.nodes.find((x) => x.id === pick.node);
  if (n === undefined) return null;
  if (pick.face === undefined) return { title: n.title, lines: [...n.lines, ...n.faces.flatMap((f) => [f.title, ...f.lines])] };
  const f = n.faces.find((x) => x.id === pick.face);
  return f === undefined ? null : { title: f.title, lines: [...f.lines] };
}

// ---- In the world ----

/**
 * One end of a link in the world, for the 3D view's Show connections (the user's requirements of 2026-10-19, item 3
 * (b)): face `side` (ForgeDirection) of the block cell `cell` (world coordinates), at its centre or `at` off it, and
 * the id of the face row it stands for when it is one. A conduit face's end is on the face of what the conduit face
 * points at, toward the conduit (an open fluid end's on the cell where your tank goes); any other end is on the face of
 * a block that stands for its box that shows best (`connectionPieces`).
 */
export interface ConnSpot {
  cell: Vec3; side: number; face: string | null;
  // optional addition (the review of f82c98c)
  /**
   * Where on the face the end is, from the face's centre (blocks, in the face's plane): set when a cable, pipe or
   * conduit of the line stands against the face, so the link starts beside its core and arms, never inside them.
   */
  at?: Vec3;
}
/** One piece of a link in the world, from one end to the other. */
export interface ConnSpan { edge: string; from: ConnSpot; to: ConnSpot }

/** Every piece of every link (`connectionPieces`), and what the 3D view's note says of the links it does not draw in full. */
export interface ConnPieces {
  spans: ConnSpan[];
  /** Per link between big steps, how many more pieces it would have than the SPANS_PER_LINK it is drawn with. */
  more: Map<string, number>;
  /** The links whose two ends are one spot, which its blocks already show (an AE2 hookup joining the base's network). */
  joined: Set<string>;
}

/** A block's top: the first face a link that stands for a whole box tries to start or end on. */
const TOP = 1;
/** The build step that lays a fluid's GT pipe run (`layout:logistics:fluid:<key>`, server layout steps), which every pipe of the run names. */
const FLUID_PIPE_STEP = 'layout:logistics:fluid:';
/** The roles the 3D view draws as a core with arms (a cable, a pipe or conduit, a chip pipe) rather than a whole block. */
const THIN_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['cable', 'pipe', 'chip_pipe']);
/**
 * At most this many pieces join one set of ends to another, so a line of big steps stays readable and light to draw
 * and to pick from: past it, a link is drawn with this many pieces spread over its bigger box, and the note under the
 * view counts the rest.
 */
export const SPANS_PER_LINK = 8;
/**
 * How a face shows to a link that ends on it, best first: OPEN, nothing of the line against it (a ghost lets it show);
 * OWN, a cable, pipe or chip pipe of what carries the link stands against it (its fluid's own pipe for a fluid, the
 * line's item pipe or chip pipe for an item), where the link really goes in or out; BESIDE, a side that a cable, pipe
 * or chip pipe passes beside without linking to it (an arc rises steeply off a side, clear of its arms); PASSING, one
 * that passes over a top without linking to it; LINKED, one whose arm ends on the face; WRONG, a fluid pipe for an item
 * or an item pipe for a fluid, so an item never seems to go into a fluid pipe; SOLID, a whole block, which hides it. On
 * any but an open face the end is beside the thin block's core and arms (`besideSpot`). A side that looks away from the
 * other end (more than AWAY_COS off it) ranks AWAY worse, as an arc from it doubles back over its own block; and one in
 * a notch NOTCH worse: a whole block of the line above its block's top in front of it or beside its front cell, which
 * an arc from it has to climb out of steeply.
 */
const OPEN = 0, OWN = 1, BESIDE = 2, PASSING = 3, LINKED = 4, WRONG = 5, SOLID = 6;
const AWAY = 4.5;
const AWAY_COS = -0.5;
const NOTCH = 2;
/**
 * How far off a face's centre (blocks) a link starts on a face that a thin block stands against: beside a cable's or
 * pipe's 6 px core and arms (2 px clear, more than a tube's radius), or in a corner beside a conduit bundle's lanes.
 */
const BESIDE_CORE = 5 / 16;
const BESIDE_BUNDLE = 6.5 / 16;

/**
 * Each of `a` with each of `b`; past SPANS_PER_LINK pairs, the two in turn instead (the k-th of each, round), as many
 * pairs as the longer has (each of either in a pair) but at most SPANS_PER_LINK, spread over the longer. `of`: how many
 * pairs there would be without that limit.
 */
function pairUp<A, B>(a: readonly A[], b: readonly B[]): { pairs: Array<[A, B]>; of: number } {
  if (a.length === 0 || b.length === 0) return { pairs: [], of: 0 };
  if (a.length * b.length <= SPANS_PER_LINK) return { pairs: a.flatMap((x) => b.map((y): [A, B] => [x, y])), of: a.length * b.length };
  const n = Math.max(a.length, b.length), k = Math.min(n, SPANS_PER_LINK);
  return {
    pairs: Array.from({ length: k }, (_, j): [A, B] => {
      const m = Math.floor((j * n) / k);
      return [a[m % a.length]!, b[m % b.length]!];
    }),
    of: n,
  };
}

/**
 * Every link of `g`, the Connections graph of `layout`, as the pieces the 3D view draws, in link order. A flow on
 * conduits goes from each extract face of its source box whose side passes its good to each insert face of its target
 * box that such an extraction reaches: an insert side on the extract side's channel, on a conduit of the good's kind
 * (an item on the Item Conduit, a fluid on an ender fluid conduit), that passes the good, as EnderIO offers every
 * extraction to each of them. Without such a pair it goes from the link's own faces (`fromFace`, `toFace`), and an end
 * without one is drawn as any other link's. Any other link joins the blocks that stand for its boxes, each with each: a
 * step's machines (a multiblock by its controller), a chest, an interface, a hookup by the block at the end of its
 * path, a fluid on GT pipes that enters or leaves the line by the free end of its pipe run (where your tank goes), and
 * the other raw inputs and final outputs by the end of the line's logistics hookup, where the base's network comes in
 * (no piece without one); an interface's link goes to the blocks of what it serves that it touches, and a hookup's to
 * the blocks of the box it joins that its end touches, when there are any. Each of those ends is on the face of its
 * block that shows best (`placed`): one nothing covers, the top first, else the side most toward the other end; else
 * one a cable or pipe stands against, beside its core; never the bottom, and a multiblock's on its own outside, an
 * item's on the bus it goes through and a fluid's on the hatch. Where each with each would make more than
 * SPANS_PER_LINK pieces (two big steps), the ends are joined in turn instead, at most SPANS_PER_LINK of them (`pairUp`;
 * `more` counts the rest). Each piece once; a piece whose two ends are one spot is left out (an AE2 hookup's link to
 * the base's network, which comes in at the hookup's end: `joined`).
 */
export function connectionPieces(layout: Layout, g: ConnGraph): ConnPieces {
  const blocks = layout.blocks;
  const at = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (b.role !== 'ghost' && !at.has(posKey(b.pos))) at.set(posKey(b.pos), i);
  });
  // the conduit face behind each conduit row of each box
  const byKey = new Map<string, ConduitRef>();
  for (const b of blocks) {
    if (b.role === 'ghost') continue;
    for (const c of b.conduits ?? []) for (const face of c.faces) byKey.set(conduitRowKey(b.pos, c.kind, face.face), { host: b, kind: c.kind, face });
  }
  const conduitRows = new Map(g.nodes.map((n) => [n.id, n.faces.flatMap((f) => {
    const ref = f.id.startsWith(`${n.id}#`) ? byKey.get(f.id.slice(n.id.length + 1)) : undefined;
    return ref === undefined ? [] : [{ id: f.id, ref }];
  })]));
  const refOf = new Map([...conduitRows.values()].flat().map((r) => [r.id, r.ref]));
  const faceSpot = (id: string, ref: ConduitRef): ConnSpot => {
    const side = FACES.indexOf(ref.face.face);
    return { cell: step(ref.host.pos, side), side: OPPOSITE[side]!, face: id };
  };
  const top = (i: number): ConnSpot => ({ cell: [...blocks[i]!.pos], side: TOP, face: null });
  /** The block at the end of hookup `n`'s path, when the hookup laid it. */
  const hookupEnd = (n: number): number[] => {
    const last = layout.hookups[n]?.path.at(-1);
    const i = last === undefined ? undefined : at.get(posKey(last));
    return i !== undefined && blocks[i]!.hookup === n ? [i] : [];
  };
  const logistics = layout.hookups.findIndex((h) => h.kind === 'logistics');
  /**
   * The free end of fluid `key`'s GT pipe run, where the fluid enters or leaves the line (your tank goes there): the
   * pipe of the run whose links, one at most, all go to pipes of the run (every other one links into its machine or
   * hatch, or to two of the run); none when the run has no such pipe.
   */
  const fluidEnds = new Map<StuffKey, number[]>();
  const fluidEnd = (key: StuffKey): number[] => {
    const known = fluidEnds.get(key);
    if (known !== undefined) return known;
    const run = blocks.flatMap((b, i) => (b.role === 'pipe' && b.buildStep === `${FLUID_PIPE_STEP}${key}` ? [i] : []));
    const cells = new Set(run.map((i) => posKey(blocks[i]!.pos)));
    const end = run.find((i) => {
      const linked = FACES.flatMap((_, side) => (((blocks[i]!.connections ?? 0) & (1 << side)) === 0 ? [] : [side]));
      return linked.length <= 1 && linked.every((side) => cells.has(posKey(step(blocks[i]!.pos, side))));
    });
    const found = end === undefined ? [] : [end];
    fluidEnds.set(key, found);
    return found;
  };
  const standFor = (node: ConnNode, e: ConnEdge): number[] => {
    if (node.kind === 'machine') {
      const machines = node.blocks.filter((i) => blocks[i]!.role === 'machine');
      return machines.length > 0 ? machines : node.blocks.slice(0, 1);
    }
    if (node.kind === 'hookup') return hookupEnd(Number(node.id.slice('hookup:'.length)));
    if (node.kind === 'source' || node.kind === 'sink') {
      const pipeEnd = e.via === 'fluid_pipe' && e.key !== null ? fluidEnd(e.key) : [];
      return pipeEnd.length > 0 || logistics === -1 ? pipeEnd : hookupEnd(logistics);
    }
    return node.blocks;
  };
  /** Each box's blocks by their cells, made once per box (a multiblock step's box holds thousands). */
  const cellMaps = new Map<string, Map<string, number>>();
  const cellsOf = (node: ConnNode): Map<string, number> => {
    let cells = cellMaps.get(node.id);
    if (cells === undefined) {
      cells = new Map(node.blocks.map((j) => [posKey(blocks[j]!.pos), j]));
      cellMaps.set(node.id, cells);
    }
    return cells;
  };
  /** The blocks of `node` face to face with one of `from`, in the box's order (a box lists its blocks in layout order). */
  const touching = (from: readonly number[], node: ConnNode): number[] => {
    const cells = cellsOf(node);
    const near = new Set<number>();
    for (const j of from) {
      for (let side = 0; side < 6; side++) {
        const k = cells.get(posKey(step(blocks[j]!.pos, side)));
        if (k !== undefined) near.add(k);
      }
    }
    return [...near].sort((a, b) => a - b);
  };
  /** An end: a conduit face's spot, or a block that stands for its box, whose face `placed` picks once the other end is known. */
  type End = ConnSpot | number;
  const ownEnds = (face: string | null, node: ConnNode, e: ConnEdge): End[] => {
    const ref = face === null ? undefined : refOf.get(face);
    return face !== null && ref !== undefined ? [faceSpot(face, ref)] : standFor(node, e);
  };
  const cellOf = (end: End): Vec3 => (typeof end === 'number' ? blocks[end]!.pos : end.cell);
  const isFluidPipe = (b: LayoutBlock): boolean => b.role === 'pipe' && b.buildStep?.startsWith(FLUID_PIPE_STEP) === true;
  /** A thin block that carries items: a chip pipe, or a pipe that is no fluid pipe and holds no conduit (an item pipe, an ME or routed pipe). */
  const carriesItems = (b: LayoutBlock): boolean => b.role === 'chip_pipe' || (b.role === 'pipe' && !isFluidPipe(b) && (b.conduits ?? []).length === 0);
  /** How face `side` of the cell `pos` shows to link `e` (OPEN … SOLID), and the block against it. */
  const shows = (pos: Vec3, side: number, e: ConnEdge): { rank: number; against?: LayoutBlock } => {
    const i = at.get(posKey(step(pos, side)));
    if (i === undefined) return { rank: OPEN };
    const b = blocks[i]!;
    if (!THIN_ROLES.has(b.role)) return { rank: SOLID, against: b };
    const linked = ((b.connections ?? 0) & (1 << OPPOSITE[side]!)) !== 0;
    if (side !== TOP && !linked) return { rank: BESIDE, against: b };
    const fluid = e.key === null ? null : isFluidKey(e.key);
    if (fluid === null) return { rank: linked ? LINKED : PASSING, against: b };
    if (fluid ? carriesItems(b) : isFluidPipe(b)) return { rank: WRONG, against: b };
    if (fluid ? b.buildStep === `${FLUID_PIPE_STEP}${e.key}` : carriesItems(b)) return { rank: OWN, against: b };
    return { rank: linked ? LINKED : PASSING, against: b };
  };
  /** Whether a whole block of the line stands above the top of the block at `p`, in front of its side `side` or beside that front cell (NOTCH). */
  const inNotch = (p: Vec3, side: number): boolean => {
    const front = step(p, side);
    const across = side < 4 ? [4, 5] : [2, 3];
    return [front, step(front, across[0]!), step(front, across[1]!)].some((c) => [1, 2].some((up) => {
      const j = at.get(posKey([c[0], p[1] + up, c[2]]));
      return j !== undefined && !THIN_ROLES.has(blocks[j]!.role);
    }));
  };
  /** A face a link may end on: its side, how it shows (`shows`), that rank plus AWAY or NOTCH where they apply, and the thin block against it. */
  type FaceChoice = { side: number; rank: number; total: number; against?: LayoutBlock };
  /**
   * The face of block `i` that shows best to link `e` (`shows`), whose other end is at the cell `toward`: of the top,
   * then the four sides, the one most toward `toward` first (in side order among equals), the first of the best total;
   * never the bottom, out of which an arc would rise back through its block, never one a whole block hides, and only
   * one whose neighbour cell `open` lets it face. None when every one is hidden.
   */
  const bestSide = (i: number, toward: Vec3, e: ConnEdge, open: (cell: Vec3) => boolean = () => true): FaceChoice | undefined => {
    const p = blocks[i]!.pos;
    const d: Vec3 = [toward[0] - p[0], 0, toward[2] - p[2]];
    const level = Math.hypot(d[0], d[2]);
    const along = (side: number): number => DIRS[side]![0] * d[0] + DIRS[side]![2] * d[2];
    let best: FaceChoice | undefined;
    for (const side of [TOP, ...[2, 3, 4, 5].sort((a, b) => along(b) - along(a) || a - b)]) {
      const seen = open(step(p, side)) ? shows(p, side, e) : { rank: SOLID };
      if (seen.rank >= SOLID) continue;
      const total = seen.rank + (side !== TOP && level > 0 && along(side) < AWAY_COS * level ? AWAY : 0) + (side !== TOP && inNotch(p, side) ? NOTCH : 0);
      if (best === undefined || total < best.total) best = { side, ...seen, total };
    }
    return best;
  };
  /**
   * Where on face `side` of the cell `pos` a link starts that a thin block `against` stands against, toward the cell
   * `toward`: off the face's centre by BESIDE_CORE, at the middle of an edge the block has no arm toward, or in a
   * corner (a conduit bundle's lanes leave only the corners, BESIDE_BUNDLE off); on a side never below its middle, out
   * of which an arc would rise through an arm into the face; the one most toward `toward` (on a side, above the middle
   * first), but on a top never toward a whole block that stands above it next door, so an arc has room to climb before
   * it passes over.
   */
  const besideSpot = (pos: Vec3, side: number, toward: Vec3, against: LayoutBlock): Vec3 => {
    const n = DIRS[side]!;
    const axes = [0, 1, 2].filter((k) => n[k] === 0);
    const bundle = (against.conduits ?? []).length > 1;
    const r = bundle ? BESIDE_BUNDLE : BESIDE_CORE;
    const arm = (v: Vec3): boolean => {
      const s = DIRS.findIndex((x) => x[0] === v[0] && x[1] === v[1] && x[2] === v[2]);
      return ((against.connections ?? 0) & (1 << s)) !== 0;
    };
    const unitOn = (k: number, sign: number): Vec3 => [0, 1, 2].map((j) => (j === k ? sign : 0)) as Vec3;
    const edges = bundle ? [] : axes.flatMap((k) => [1, -1].map((sign) => unitOn(k, sign))).filter((v) => !arm(v));
    const corners = [1, -1].flatMap((a) => [1, -1].map((b): Vec3 => {
      const u = unitOn(axes[0]!, a), v = unitOn(axes[1]!, b);
      return [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
    }));
    const spots = [...edges, ...corners].filter((v) => n[1] !== 0 || v[1] >= 0);
    const d: Vec3 = [toward[0] - pos[0], toward[1] - pos[1], toward[2] - pos[2]];
    const way = (v: Vec3): number => (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / (Math.hypot(...v) * (Math.hypot(...d) || 1));
    /** Whether a whole block stands above `pos`'s top in a column next door toward `v` (along each of its axes, and both). */
    const tall = (v: Vec3): boolean => [[v[0], 0], [0, v[2]], [v[0], v[2]]].some(([dx, dz]) => (dx !== 0 || dz !== 0) && [1, 2].some((up) => {
      const j = at.get(posKey([pos[0] + dx!, pos[1] + up, pos[2] + dz!]));
      return j !== undefined && !THIN_ROLES.has(blocks[j]!.role);
    }));
    const score = (v: Vec3): number => (n[1] === 0 ? (v[1] > 0 ? 2 : 0) : tall(v) ? -3 : 0) + way(v);
    const best = spots.reduce((a, b) => (score(b) > score(a) + 1e-9 ? b : a));
    const scale = r / Math.max(...best.map(Math.abs));
    return best.map((v) => v * scale) as Vec3;
  };
  /** Block `i`'s spot on the face `best` names (beside the thin block against it, if any), or none. */
  const spotOn = (i: number, best: ReturnType<typeof bestSide>, toward: Vec3): ConnSpot | undefined => {
    if (best === undefined) return undefined;
    const spot: ConnSpot = { cell: [...blocks[i]!.pos], side: best.side, face: null };
    if (best.rank !== OPEN && best.against !== undefined) spot.at = besideSpot(blocks[i]!.pos, best.side, toward, best.against);
    return spot;
  };
  /** A multiblock's structure that block `i` of box `node` is part of: the box's blocks joined to it face to face, and the box round them. */
  type Structure = { blocks: number[]; outside: (cell: Vec3) => boolean };
  const structures = new Map<number, Structure>();
  const structureOf = (i: number, node: ConnNode): Structure => {
    const known = structures.get(i);
    if (known !== undefined) return known;
    const cells = cellsOf(node);
    const joined = new Set([i]);
    for (const todo = [i]; todo.length > 0;) {
      const j = todo.pop()!;
      for (let side = 0; side < 6; side++) {
        const k = cells.get(posKey(step(blocks[j]!.pos, side)));
        if (k !== undefined && !joined.has(k)) {
          joined.add(k);
          todo.push(k);
        }
      }
    }
    const own = node.blocks.filter((j) => joined.has(j));
    const low = [0, 1, 2].map((k) => Math.min(...own.map((j) => blocks[j]!.pos[k]!)));
    const high = [0, 1, 2].map((k) => Math.max(...own.map((j) => blocks[j]!.pos[k]!)));
    const found = { blocks: own, outside: (c: Vec3): boolean => c.some((v, k) => v < low[k]! || v > high[k]!) };
    for (const j of own) structures.set(j, found);
    return found;
  };
  /**
   * Where block `i` of box `node` ends link `e`, whose other end is at `toward`: an interface's link to what it serves
   * on the side the two share, beside the interface when that is a cable or pipe (when a whole interface hides that
   * side, a multiblock's on its roof); else on its face that shows best (`bestSide`, beside a thin block against it). A
   * multiblock (a machine box with casings or hatches) ends on its own structure, only on a face that looks out of the
   * box round it (never into its hollow): an item on the bus it goes through (the input bus into the box, the output
   * bus out of it), a fluid on GT pipes on the hatch a pipe of the fluid's run links into (from above it, or from the
   * side its front faces where GT takes the hatch only lower down: the server's hatch rules), the nearest to `i` first; else on block `i`, each only on a face that does not look away from the other end; else on
   * the open top of its highest block nearest to `i` (its top layer), from which an arc never has to climb back over
   * the structure; else on the first face that looks away. With nothing showing, the top of block `i`.
   */
  const placed = (i: number, node: ConnNode, e: ConnEdge, toward: Vec3): ConnSpot => {
    const p = blocks[i]!.pos;
    const shared = e.via === 'attached' ? sideToward(p, toward) : -1;
    const behind = shared > 1 && shows(p, shared, e).rank >= SOLID;
    if (shared > 1 && !behind) return spotOn(i, { side: shared, ...shows(p, shared, e), total: 0 }, toward)!;
    if (node.kind !== 'machine' || node.blocks.every((j) => blocks[j]!.role === 'machine')) return spotOn(i, bestSide(i, toward, e), toward) ?? top(i);
    const { blocks: own, outside } = structureOf(i, node);
    const level = (j: number): number => Math.hypot(blocks[j]!.pos[0] - p[0], blocks[j]!.pos[2] - p[2]);
    const nearest = (a: number, b: number): number => level(a) - level(b) || Math.abs(blocks[a]!.pos[1] - p[1]) - Math.abs(blocks[b]!.pos[1] - p[1]) || a - b;
    const tops = own.filter((j) => outside(step(blocks[j]!.pos, TOP)) && shows(blocks[j]!.pos, TOP, e).rank === OPEN);
    const highest = Math.max(...tops.map((j) => blocks[j]!.pos[1]));
    const roof = tops.filter((j) => blocks[j]!.pos[1] === highest).sort(nearest)[0];
    // a block of a multiblock that a whole interface stands in front of: the roof, never round the structure
    if (behind && roof !== undefined) return top(roof);
    const through: number[] = [];
    if (e.via === 'fluid_pipe' && e.key !== null) {
      const run = `${FLUID_PIPE_STEP}${e.key}`;
      through.push(...own.filter((j) => blocks[j]!.role === 'hatch' && FACES.some((_, side) => {
        const next = at.get(posKey(step(blocks[j]!.pos, side)));
        const pipe = next === undefined ? undefined : blocks[next]!;
        return pipe?.role === 'pipe' && pipe.buildStep === run && ((pipe.connections ?? 0) & (1 << OPPOSITE[side]!)) !== 0;
      })).sort(nearest));
    } else if (e.key !== null && !isFluidKey(e.key)) {
      const bus = e.to === node.id ? 'input_bus' : 'output_bus';
      through.push(...own.filter((j) => blocks[j]!.hatch === bus).sort(nearest));
    }
    let away: ConnSpot | undefined;
    for (const h of [...through, i]) {
      const best = bestSide(h, toward, e, outside);
      const spot = spotOn(h, best, toward);
      if (spot !== undefined && best!.total < AWAY) return spot;
      away ??= spot;
    }
    return roof === undefined ? away ?? top(i) : top(roof);
  };

  const spans: ConnSpan[] = [];
  const more = new Map<string, number>();
  const joined = new Set<string>();
  const seen = new Set<string>();
  const spotKey = (s: ConnSpot): string => `${posKey(s.cell)}:${s.side}`;
  /** Adds a piece once; false when its two ends are one spot. */
  const push = (edge: string, from: ConnSpot, to: ConnSpot): boolean => {
    if (spotKey(from) === spotKey(to)) return false;
    const key = `${edge}|${spotKey(from)}|${spotKey(to)}`;
    if (!seen.has(key)) {
      seen.add(key);
      spans.push({ edge, from, to });
    }
    return true;
  };
  const left = (edge: string, pairs: { pairs: unknown[]; of: number }): void => {
    if (pairs.of > pairs.pairs.length) more.set(edge, (more.get(edge) ?? 0) + pairs.of - pairs.pairs.length);
  };
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (from === undefined || to === undefined) continue;
    if ((e.via === 'item_conduit' || e.via === 'fluid_conduit') && e.key !== null) {
      const key = e.key;
      const fits = (r: ConduitRef): boolean => (r.kind === 'item') !== isFluidKey(key);
      const outs = (conduitRows.get(from.id) ?? []).filter(({ ref }) => fits(ref) && ref.face.extract !== undefined && passes(ref.face.extract.filter, key));
      const ins = (conduitRows.get(to.id) ?? []).filter(({ ref }) => fits(ref) && ref.face.insert !== undefined && passes(ref.face.insert.filter, key));
      const before = spans.length;
      for (const color of new Set(outs.map((o) => o.ref.face.extract!.color))) {
        const reached = ins.filter((i) => i.ref.face.insert!.color === color);
        const pairs = pairUp(outs.filter((x) => x.ref.face.extract!.color === color), reached);
        left(e.id, pairs);
        for (const [o, i] of pairs.pairs) {
          if (i.ref.face !== o.ref.face) push(e.id, faceSpot(o.id, o.ref), faceSpot(i.id, i.ref));
        }
      }
      if (spans.length > before) continue;
      more.delete(e.id);
    }
    const starts = ownEnds(e.fromFace, from, e);
    let ends = ownEnds(e.toFace, to, e);
    if (e.via === 'attached' || e.via === 'hookup') {
      const near = touching(e.via === 'attached' ? from.blocks : standFor(from, e), to);
      if (near.length > 0) ends = near;
    }
    const spot = (end: End, node: ConnNode, other: End): ConnSpot => (typeof end === 'number' ? placed(end, node, e, cellOf(other)) : end);
    const pairs = pairUp(starts, ends);
    left(e.id, pairs);
    let drawn = false, oneSpot = false;
    for (const [a, b] of pairs.pairs) {
      if (push(e.id, spot(a, from, b), spot(b, to, a))) drawn = true;
      else oneSpot = true;
    }
    if (oneSpot && !drawn) joined.add(e.id);
  }
  return { spans, more, joined };
}

/** Every piece of every link of `g` (`connectionPieces`). */
export function connectionSpans(layout: Layout, g: ConnGraph): ConnSpan[] {
  return connectionPieces(layout, g).spans;
}

/**
 * What a piece of a link in the 3D view tells: the link's own details (`pickDetails`), but for a piece of a flow that
 * starts or ends on a face row, that piece's own faces: the face it leaves and the face it enters, each with its
 * configuration. Null for a link the graph does not hold.
 */
export function spanDetails(g: ConnGraph, span: ConnSpan): { title: string; lines: string[] } | null {
  const details = pickDetails(g, { edge: span.edge });
  const e = g.edges.find((x) => x.id === span.edge);
  if (details === null || e === undefined || e.key === null || (span.from.face === null && span.to.face === null)) return details;
  const from = g.nodes.find((n) => n.id === e.from), to = g.nodes.find((n) => n.id === e.to);
  if (from === undefined || to === undefined) return details;
  const row = (node: ConnNode, id: string | null): ConnFace | undefined => (id === null ? undefined : node.faces.find((f) => f.id === id));
  return { title: details.title, lines: [e.lines[0]!, ...endLines('From', from, row(from, span.from.face)), ...endLines('To', to, row(to, span.to.face))] };
}
