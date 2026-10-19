// What the Connections view shows (plan 11 Task 7; spec §3.8c; architecture §11.30 and "EnderIO conduits, granted
// change requests (add-on 11)"), as pure functions: every placed machine, chest, interface and hookup of a laid-out
// line as a box whose rows are its faces with their exact configuration (the covers on it and its own settings, the
// covers of pipes and the conduit faces that point at it), and the plan's flows as links between the boxes, each saying
// what carries it (the shared GT item pipe, a GT fluid pipe, the routed network, the ME network, an item or ender fluid
// conduit on its channel colour) and through which faces; then each interface attached to what it serves and each
// logistics hookup joining the line. Also the ELK graph that lays the boxes out (inputs on the left, outputs on the
// right), the picture read back from ELK, and what a picked box, face or link tells. No DOM and no browser APIs: the
// server's tests lay real lines out and read their graphs too. Every order is fixed, so a layout gives one graph.

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { configTexts, conduitFaceText, coverText, faceName } from '../../shared/layout/configure-text.ts';
import { CONDUIT_NAMES, DYE_NAMES, hookupNetworkKind } from '../../shared/layout/enderio.ts';
import { fmtInt, fmtRate, joinNames, NETWORK_NAMES } from '../../shared/layout/format.ts';
import { OPPOSITE, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES, type Face } from '../../shared/types/assets.ts';
import type { BlockRole, ConduitFace, ConduitFilter, ConduitKind, CoverSpec, DyeColor, Layout, LayoutBlock, TailChest } from '../../shared/types/layout.ts';
import type { LogisticsMode, Plan } from '../../shared/types/plan.ts';

// ---- Types ----

export type ConnNodeKind = 'machine' | 'chest' | 'interface' | 'hookup' | 'source' | 'sink';

/** One row of a box: a cover, a block's settings or a conduit face, with its configuration in a builder's words. */
export interface ConnFace { id: string; title: string; lines: string[] }

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

/** A box is this wide, and this tall for its title plus this much per line and per face row (plus `BOX_PADDING`). */
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

/** `<label>, <side of what the face points at> side · <conduit name>`: one conduit face in a builder's words. */
function conduitRow(node: string, ref: ConduitRef, label: string, nameOf: (k: StuffKey) => string): Row {
  const side: Face = FACES[OPPOSITE[FACES.indexOf(ref.face.face)]!]!;
  return {
    face: { id: `${node}#conduit:${posKey(ref.host.pos)}:${ref.kind}:${ref.face.face}`, title: `${label}, ${faceName(side)} side · ${CONDUIT_NAMES[ref.kind]}`,
      lines: [conduitFaceText(ref.kind, ref.face, nameOf)] },
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
  const end = (word: string, node: ConnNode, face: ConnFace | undefined): string[] =>
    [`${word} ${node.title}${face === undefined ? '' : ` — ${face.title}`}`, ...(face?.lines ?? [])];
  return {
    id: link.id, from: link.from, to: link.to, via, key: link.key, perSecond: link.perSecond,
    label: `${nameOf(link.key)} ${fmtRate(link.perSecond * (per === 'min' ? 60 : 3600))}/${per === 'min' ? 'min' : 'h'}${channel === '' ? '' : ` · ${channel}`}`,
    lines: [`${VIA_TEXT[via]}${channel === '' ? '' : `, channel ${channel}`}`, ...end('From', ends.from, fromFace), ...end('To', ends.to, toFace)],
    color, fromFace: fromFace?.id ?? null, toFace: toFace?.id ?? null,
  };
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

/**
 * Spec §3.8c: the boxes of `layout` (machines per plan step, chests, interfaces, hookups, then `raw` and `out` when a
 * link or a face needs them) with their face rows and sizes, and the links: the plan's flows (rates per `per`), then
 * the attached interfaces, then the hookups. A conduit face that points at no box goes to `raw` when it extracts and to
 * `out` when it only inserts (an open fluid end, toward your tank).
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
  rows.set(RAW, incoming.loose.filter(extracts).map((r) => conduitRow(RAW, r, r.face.target, nameOf)));
  rows.set(OUT, incoming.loose.filter((r) => r.face.mode === 'insert').map((r) => conduitRow(OUT, r, r.face.target, nameOf)));

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
    n.height = CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * (n.lines.length + n.faces.length) + BOX_PADDING;
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
