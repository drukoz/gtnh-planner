// What the flow diagram shows (spec §3.9, fix spec §6.2), as pure functions: the boxes and arrows of a plan — a box per
// step listing the goods it takes and makes as rows (each row an ELK port, so an arrow leaves the row of its good), an
// import stub beside each step that takes a bought good, a red stub where nothing supplies an input, a stub for each
// good left over, the target, and supporting lines drawn open around their steps or collapsed into one box (a step that
// cannot avoid a material on the avoid list badged, spec §3.3) — the ELK graph that lays them out (web-stack §7) and the
// laid-out picture read back from it, what a focus lights (an item, a box or an arrow), what does not add up, the rate
// and overclock texts (the shared formatter of fix spec §6.1), the word for each kind of import, and the settings
// patches the panels send (fix spec §6.3), each with the whole new value of one setting. Base materials sit on the left
// and the target on the right.

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api.js';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES, V } from '../../shared/gt/tiers.ts';
import { joinNames } from '../../shared/layout/format.ts';
import { indexPlan, issueText, type PlanIndex, type PlanIssue, type PlanIssueCode } from '../../shared/plan/balance.ts';
import { FREE_KEYS, type LeafClass, type Plan, type PlanFlow, type PlanSettings, type PlanStep, type PlanWarning } from '../../shared/types/plan.ts';
import { formatDuration, formatNumber, formatPercent, formatRate } from '../format.ts';
import { toggleList } from './settings-model.ts';

export { formatNumber, formatRate };

/** What a box stands for (fix spec §6.2). */
export type FlowNodeKind = 'step' | 'import' | 'missing' | 'sink' | 'out' | 'line';

/**
 * One good on the edge of a box (fix spec §6.2): taken on the left (`in`) or made on the right (`out`), its ELK port
 * `<node id>|<side>|<key>`, its name and rate as the box shows them, whether it is what the step is for (`main`: first
 * and bold), what does not add up about it (`issue`) and the share behind that: of a good several steps make, what this
 * one makes; of an input supplied short, what it gets; of a good both bought and made, what is bought.
 */
export interface FlowRow {
  side: 'in' | 'out'; key: StuffKey; port: string; name: string; rate: string; main?: boolean; issue?: PlanIssueCode; share?: string;
  // optional addition
  /** The rate behind `rate`, per second (the first producer of a good is the one that makes most of it). */
  perSecond?: number;
}

export interface FlowNode {
  id: string; kind: FlowNodeKind; key: StuffKey | null; title: string; lines: string[];
  owned: 'all' | 'some' | 'none'; width: number; height: number;
  /** Its goods: the inputs, then the outputs with the main one first. A stub has one row, the target box one. */
  rows: FlowRow[];
  // optional addition
  /**
   * A step that uses goods on the avoid list because nothing at the tier avoids them (`avoid-unavoidable`): the badge
   * text below its lines (one line more of height) and the warnings behind it.
   */
  avoidBadge?: { text: string; warnings: string[] };
  // optional addition
  /** The name of `key`, for its icon's tooltip and accessible name. */
  keyName?: string;
  // optional additions (fix spec §6.2)
  /** An import stub's kind of import, drawn with the CSS class `leaf-<class>`. */
  leaf?: LeafClass;
  /** The open supporting line (`line:<key>`, a `FlowGroup`) whose box holds this one. */
  group?: string;
}

/**
 * What a raw input is, in the words of fix spec §6.2 (the flow's import stubs and the raw-material panel's header); the
 * Materials badges keep their own words (`LEAF_BADGES`, ruling P26).
 */
export const LEAF_WORD: Record<LeafClass, string> = {
  free: 'free',
  direct: 'mined',
  byproduct: 'ore byproduct',
  derived: 'bought (made elsewhere)',
  natural: 'gathered',
  stop: 'supplied (we make it)',
  unavailable: 'not reachable',
};

/**
 * One arrow, from an output port to an input port: the good, its rate (per second and as text), the rate as its label
 * only where a port at either end has two or more arrows (the box rows say it otherwise), and its tooltip
 * "name · rate · From → To".
 */
export interface FlowEdge {
  id: string; from: string; to: string; key: StuffKey; fromPort: string; toPort: string; perSecond: number; name: string; rate: string;
  label?: string; title: string;
}

/** An open supporting line (fix spec §6.2): an ELK compound node `line:<key>` titled "<name> line" around its boxes. */
export interface FlowGroup { id: string; key: StuffKey; title: string; nodes: string[] }

export interface FlowGraph {
  nodes: FlowNode[]; edges: FlowEdge[];
  /** The supporting lines drawn open, each around its steps and their stubs. */
  groups: FlowGroup[];
  /** Imports in the first column ("Imports in one column") instead of beside the step that takes them. */
  importsInOneColumn: boolean;
}

export interface FlowLayout {
  width: number; height: number;
  /** Where each box sits in the diagram (open supporting lines' boxes included). */
  nodes: Array<FlowNode & { x: number; y: number }>;
  /** `labelAt` (an addition): the centre of the edge's label where ELK placed it; `labelBox` (an addition): that box. */
  edges: Array<FlowEdge & { points: Array<[number, number]>; labelAt?: [number, number]; labelBox?: Box }>;
  /** The open supporting lines, around their boxes. */
  groups: Array<FlowGroup & { x: number; y: number; width: number; height: number }>;
}

/** A rectangle in diagram coordinates. */
export interface Box { x: number; y: number; width: number; height: number }

/** What the diagram lights up (fix spec §6.2 focus mode): one item, one box or one arrow, or nothing (`flow-focus.ts` keeps it). */
export type Focus = { kind: 'item'; key: StuffKey } | { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

/** What a focus lights (fix spec §6.2): boxes, arrows and rows (ports), and of the boxes those that make and that take. */
export interface FocusSets { nodes: Set<string>; edges: Set<string>; ports: Set<string>; producers: Set<string>; consumers: Set<string> }

/** Box widths come from their text, between these (fix spec §6.2). */
export const MIN_NODE_WIDTH = 190;
export const MAX_NODE_WIDTH = 330;
/** A box is this tall for its title, plus this much per line of text, plus this much per row. */
export const NODE_TITLE_HEIGHT = 28;
export const NODE_LINE_HEIGHT = 16;
export const ROW_HEIGHT = 18;
/** Room below the last row. */
const ROWS_BOTTOM = 6;
/** Estimated text widths per character: the 13 px semibold title, and the 11.5 px lines and rows. */
export const TITLE_CHAR_WIDTH = 7.4;
export const TEXT_CHAR_WIDTH = 6.2;
/** From a box's side to its text; and the room an item icon takes with the gap after it. */
export const TEXT_LEFT = 8;
export const ICON_SPACE = 20;
/** The room the open/collapse button takes at the right of a collapsed line's title. */
export const TOGGLE_SPACE = 28;
/** Over this many steps a plan starts with its supporting lines collapsed (fix spec §6.2). */
export const LINE_COLLAPSE_STEPS = 25;
const TICKS_PER_SECOND = 20;
/** Edge label boxes for ELK: the label font is about this wide per character and this tall. */
const LABEL_CHAR_WIDTH = 6.5;
const LABEL_PADDING = 8;
const LABEL_HEIGHT = 14;
/** An ELK port is a tiny box on the edge of its box, centred on its row, so ELK ends the arrow on that row. */
const PORT_SIZE = 2;
/** Room around the boxes of an open supporting line; its title sits in the top band. */
const GROUP_PADDING = '[top=36,left=12,bottom=12,right=12]';

const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

/** The layout options of web-stack §7, with fix spec §6.2's for ports, supporting lines and a stable order. */
const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};
const LAYER_CONSTRAINT = 'elk.layered.layering.layerConstraint';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Decimal text without trailing zeros (and without a trailing point). */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** A tier's name; a tier outside 0..14 shows as its number instead of breaking the diagram. */
export function tierText(t: number): string {
  return TIER_NAMES[t] ?? `tier ${t}`;
}

/** A rate of a good in the project's unit, in litres for a fluid. */
function goodRate(perSecond: number, per: 'min' | 'hour', key: StuffKey): string {
  return formatRate(perSecond, per, { fluid: isFluidKey(key) });
}

/** Under this many runs a second, a run rate reads as how often one run comes ("1 run every 373 days"). */
const FEWEST_RUNS_PER_SECOND = 0.01;

/** `0.4 runs/s`, or for a rare run how often it comes: `1 run every 373 days`. */
function runsText(perSecond: number): string {
  return perSecond > 0 && perSecond < FEWEST_RUNS_PER_SECOND ? `1 run every ${formatDuration(1 / perSecond)}` : `${formatNumber(perSecond)} runs/s`;
}

function ownedState(step: PlanStep): FlowNode['owned'] {
  if (step.owned > 0 && step.owned >= step.count) return 'all';
  return step.owned > 0 ? 'some' : 'none';
}

/** A row's ELK port: `<node id>|<side>|<key>`. */
export function portId(node: string, side: FlowRow['side'], key: StuffKey): string {
  return `${node}|${side}|${key}`;
}

function edgeId(fromPort: string, toPort: string): string {
  return `${fromPort}->${toPort}`;
}

/** The box of a supporting line: open, the group around its steps; collapsed, the one box standing for them. */
export function lineNodeId(key: StuffKey): string {
  return `line:${key}`;
}

function importId(key: StuffKey, consumer: string): string {
  return `import:${key}@${consumer}`;
}

function sinkId(key: StuffKey, producer: string): string {
  return `sink:${key}@${producer}`;
}

/**
 * The id of the arrow a plan flow is drawn as while its steps are not inside a collapsed line (the step panels light it
 * through the flow focus): a bought good comes from the import stub beside the step that takes it, a good left over goes
 * to the sink stub beside the step that makes it.
 */
export function flowEdgeId(f: Pick<PlanFlow, 'from' | 'to' | 'key'>): string {
  const from = f.from === RAW ? importId(f.key, f.to) : f.from;
  const to = f.to === SINK ? sinkId(f.key, f.from) : f.to;
  return edgeId(portId(from, 'out', f.key), portId(to, 'in', f.key));
}

/** Sums of `perSecond` by key for the flows `pick` selects. */
function ratesBy(flows: Plan['flows'], pick: (f: Plan['flows'][number]) => boolean): Map<StuffKey, number> {
  const rates = new Map<StuffKey, number>();
  for (const f of flows) if (pick(f)) rates.set(f.key, (rates.get(f.key) ?? 0) + f.perSecond);
  return rates;
}

/** Per-run amounts summed per key (a recipe may list one good in two slots). */
function perRun(products: PlanStep['inputs']): Map<StuffKey, number> {
  const amounts = new Map<StuffKey, number>();
  for (const p of products) amounts.set(p.key, (amounts.get(p.key) ?? 0) + p.amount);
  return amounts;
}

/** Each step's `avoid-unavoidable` warnings (Plan 8): the goods on the avoid list it uses as nothing at the tier avoids them. */
function unavoidableByStep(plan: Plan): Map<string, PlanWarning[]> {
  const byStep = new Map<string, PlanWarning[]>();
  for (const w of plan.warnings) {
    if (w.code !== 'avoid-unavoidable' || w.stepId === undefined) continue;
    const list = byStep.get(w.stepId);
    if (list === undefined) byStep.set(w.stepId, [w]);
    else list.push(w);
  }
  return byStep;
}

/** Where a box's rows start: below its title, its lines and its avoid badge. */
export function rowsTop(node: Pick<FlowNode, 'lines' | 'avoidBadge'>): number {
  return NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * (node.lines.length + (node.avoidBadge === undefined ? 0 : 1));
}

/** The middle of a box's `i`-th row, from the box's top: where that row's port sits. */
export function rowCentre(node: Pick<FlowNode, 'lines' | 'avoidBadge'>, i: number): number {
  return rowsTop(node) + ROW_HEIGHT * i + ROW_HEIGHT / 2;
}

/** Whether a box draws an icon beside each row: steps and collapsed lines; a stub's title already shows its one good. */
export function rowHasIcon(node: Pick<FlowNode, 'kind'>): boolean {
  return node.kind === 'step' || node.kind === 'line';
}

/** A row's rate as its box writes it, with the share behind its issue. */
export function rowRate(row: Pick<FlowRow, 'rate' | 'share'>): string {
  return row.share === undefined ? row.rate : `${row.rate} · ${row.share}`;
}

/** About how wide `text` is drawn at `charWidth` per character. */
export function textWidth(text: string, charWidth: number): number {
  return Math.ceil(text.length * charWidth);
}

/** The room a row of `node` leaves for the good's name beside its rate; a box sized to its rows leaves each name room. */
export function rowNameRoom(node: Pick<FlowNode, 'kind' | 'width'>, row: Pick<FlowRow, 'rate' | 'share'>): number {
  return node.width - 2 * TEXT_LEFT - (rowHasIcon(node) ? ICON_SPACE : 0) - textWidth(` ${rowRate(row)}`, TEXT_CHAR_WIDTH);
}

/** `text` cut to fit `width` at `charWidth` per character, ending in "…" when cut (the full text is in the tooltip). */
export function clipText(text: string, width: number, charWidth: number): string {
  if (textWidth(text, charWidth) <= width) return text;
  return `${text.slice(0, Math.max(1, Math.floor(width / charWidth) - 1)).trimEnd()}…`;
}

/** A box sized to its text (fix spec §6.2): as wide as its widest text, within 190–330 px, as tall as its rows need. */
function sized(node: Omit<FlowNode, 'width' | 'height'>): FlowNode {
  const icon = node.key !== null ? ICON_SPACE : 0;
  const rowIcon = rowHasIcon(node) ? ICON_SPACE : 0;
  const widths = [
    2 * TEXT_LEFT + icon + (node.kind === 'line' ? TOGGLE_SPACE : 0) + textWidth(node.title, TITLE_CHAR_WIDTH),
    ...node.lines.map((line) => 2 * TEXT_LEFT + textWidth(line, TEXT_CHAR_WIDTH)),
    ...(node.avoidBadge === undefined ? [] : [2 * TEXT_LEFT + textWidth(node.avoidBadge.text, TEXT_CHAR_WIDTH)]),
    ...node.rows.map((r) => 2 * TEXT_LEFT + rowIcon + textWidth(r.name, TEXT_CHAR_WIDTH) + textWidth(` ${rowRate(r)}`, TEXT_CHAR_WIDTH)),
  ];
  const width = Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, ...widths));
  const height = rowsTop(node) + ROW_HEIGHT * node.rows.length + (node.rows.length > 0 ? ROWS_BOTTOM : 0);
  return { ...node, width, height };
}

/** "3 machines", "1 machine". */
function machinesText(n: number): string {
  return n === 1 ? '1 machine' : `${n} machines`;
}

/** A step box's lines (fix spec §6.2): tier, EU/t, machines and how busy, or "by hand"; what it supplies; what is owned. */
function stepLines(step: PlanStep, nameOf: (key: StuffKey) => string): string[] {
  const busy = `${formatPercent(step.utilization)} busy`;
  // A hand step has no machine, no tier and no power: only how much of a person's time it takes.
  const lines = [step.handCraft ? `by hand · ${busy}` : `${tierText(step.machine.tier)} · ${step.euPerTick} EU/t · ${machinesText(step.count)} · ${busy}`];
  if (step.supply !== undefined) lines.push(`supplies ${nameOf(step.supply)}`);
  if (step.owned > 0) lines.push(`${step.owned} owned`);
  return lines;
}

/** Where a step's and a stub's words come from, and how the plan's issues mark its rows. */
interface RowContext {
  index: PlanIndex;
  nameOf(key: StuffKey): string;
  rateOf(perSecond: number, key: StuffKey): string;
  /** `<step id>|<key>` → the orphan or short issue of that input. */
  inputIssues: ReadonlyMap<string, PlanIssue>;
  /** `<step id>|<key>` → the multi-producer or bought-and-made issue of that output, and the step's share of it. */
  outputIssues: ReadonlyMap<string, { code: PlanIssueCode; share?: number }>;
}

/**
 * A step's rows: what flows in (an input it needs, at what it needs; a good that only flows in, at its flow) and what it
 * makes, net of what it takes back of the same good, as flows are (balance.ts); a good it takes and hands back in full
 * has no row. Outputs come main first.
 */
function stepRows(step: PlanStep, ctx: RowContext): FlowRow[] {
  const takes = perRun(step.inputs);
  const makes = perRun(step.outputs);
  const rows: FlowRow[] = [];
  for (const [key, port] of ctx.index.inputs.get(step.id) ?? []) {
    const perSecond = port.needPerSecond > 0 ? port.needPerSecond : port.perSecond;
    if (!(perSecond > 0)) continue;
    const row: FlowRow = { side: 'in', key, port: portId(step.id, 'in', key), name: ctx.nameOf(key), rate: ctx.rateOf(perSecond, key), perSecond };
    const issue = ctx.inputIssues.get(`${step.id}|${key}`);
    if (issue !== undefined) {
      row.issue = issue.code;
      if (issue.code === 'short-input' && port.needPerSecond > 0) row.share = formatPercent(port.perSecond / port.needPerSecond);
    }
    rows.push(row);
  }
  const outs: FlowRow[] = [];
  for (const [key, port] of ctx.index.outputs.get(step.id) ?? []) {
    const made = Math.max(0, (makes.get(key) ?? 0) - (takes.get(key) ?? 0)) * step.runsPerSecond;
    const perSecond = made > 0 ? made : port.perSecond;
    if (!(perSecond > 0)) continue;
    const row: FlowRow = { side: 'out', key, port: portId(step.id, 'out', key), name: ctx.nameOf(key), rate: ctx.rateOf(perSecond, key), perSecond };
    if (key === step.mainOutput) row.main = true;
    const issue = ctx.outputIssues.get(`${step.id}|${key}`);
    if (issue !== undefined) {
      row.issue = issue.code;
      if (issue.share !== undefined) row.share = formatPercent(issue.share);
    }
    outs.push(row);
  }
  return [...rows, ...outs.sort((a, b) => Number(b.main === true) - Number(a.main === true))];
}

/** A stub on its way to becoming a box: what it is, its good, how much flows through it and where it sits. */
interface Stub { kind: 'import' | 'missing' | 'sink'; key: StuffKey; perSecond: number; group?: string; leaf?: LeafClass; issue?: PlanIssueCode }

/** An arrow before its words: its ends, its good and how much flows. */
type Arrow = Omit<FlowEdge, 'name' | 'rate' | 'label' | 'title'>;

/** A box before its size. */
type Unsized = Omit<FlowNode, 'width' | 'height'>;

/** The steps of one supporting line (fix spec R6) and its material's name. */
interface SupportingLine { name: string; steps: PlanStep[] }

/** What the parts of `flowGraph` share: the plan's words and rates, where each step is drawn, what does not add up where. */
interface GraphContext extends RowContext {
  plan: Plan;
  stepById: ReadonlyMap<string, PlanStep>;
  /** Supporting lines in the order of their first step. */
  lines: ReadonlyMap<StuffKey, SupportingLine>;
  collapsed: ReadonlySet<StuffKey>;
  /** Of a good both bought and made, the share bought. */
  boughtShare: ReadonlyMap<StuffKey, number>;
}

/** The supporting lines of a plan, in the order of their first step. */
function supportingLines(plan: Plan): Map<StuffKey, SupportingLine> {
  const lines = new Map<StuffKey, SupportingLine>();
  for (const step of plan.steps) {
    if (step.line === undefined) continue;
    const line = lines.get(step.line.key);
    if (line === undefined) lines.set(step.line.key, { name: step.line.name, steps: [step] });
    else line.steps.push(step);
  }
  return lines;
}

/** The plan's integrity issues by the row they show on: a consumer's input, a producer's output, a bought good. */
function issuesByRow(index: PlanIndex): Pick<GraphContext, 'inputIssues' | 'outputIssues' | 'boughtShare'> {
  const inputIssues = new Map<string, PlanIssue>();
  const outputIssues = new Map<string, { code: PlanIssueCode; share?: number }>();
  const boughtShare = new Map<StuffKey, number>();
  for (const issue of index.issues) {
    if (issue.code === 'orphan-input' || issue.code === 'short-input') {
      if (issue.stepId !== undefined) inputIssues.set(`${issue.stepId}|${issue.key}`, issue);
      continue;
    }
    if (issue.code === 'bought-and-made') boughtShare.set(issue.key, issue.share?.[0] ?? 0);
    (issue.stepIds ?? []).forEach((id, i) => {
      const at = `${id}|${issue.key}`;
      // A good made two ways and bought as well: the row says who makes how much.
      if (issue.code === 'multi-producer') outputIssues.set(at, { code: issue.code, share: issue.share?.[i] ?? 0 });
      else if (!outputIssues.has(at)) outputIssues.set(at, { code: issue.code });
    });
  }
  return { inputIssues, outputIssues, boughtShare };
}

/** The box a step is drawn in: its own, or its collapsed line's. */
function boxOf(ctx: GraphContext, stepId: string): string {
  const line = ctx.stepById.get(stepId)?.line;
  return line !== undefined && ctx.collapsed.has(line.key) ? lineNodeId(line.key) : stepId;
}

/** The open supporting line whose group holds a step's box and the stubs beside it. */
function groupOf(ctx: GraphContext, stepId: string): string | undefined {
  const line = ctx.stepById.get(stepId)?.line;
  return line !== undefined && !ctx.collapsed.has(line.key) ? lineNodeId(line.key) : undefined;
}

/** A step's box: its machine, its line, its rows, and the badge of the avoided goods it cannot do without. */
function stepBox(ctx: GraphContext, step: PlanStep, unavoidable: readonly PlanWarning[] | undefined): Unsized {
  const key = step.mainOutput ?? null;
  const box: Unsized = {
    id: step.id, kind: 'step', key, title: step.machine.name, lines: stepLines(step, ctx.nameOf), owned: ownedState(step), rows: stepRows(step, ctx),
  };
  if (key !== null) box.keyName = ctx.nameOf(key);
  const group = groupOf(ctx, step.id);
  if (group !== undefined) box.group = group;
  if (unavoidable !== undefined) {
    const goods = [...new Set(unavoidable.flatMap((w) => (w.key === undefined ? [] : [ctx.nameOf(w.key)])))];
    box.avoidBadge = { text: `⚠ uses avoided ${goods.join(', ')}`, warnings: unavoidable.map((w) => w.text) };
  }
  return box;
}

/**
 * The arrows of the plan's flows between the boxes they are drawn in, and the stubs at their ends: an import stub beside
 * each box that takes a bought good, a sink beside each box that leaves a good over, a stub into each input nothing
 * supplies or supplies short (carrying what is missing). Flows between one pair of ports add up (a collapsed line's);
 * a flow inside a collapsed line is not drawn. With `importsInOneColumn` no import stub sits in a group.
 */
function arrowsAndStubs(ctx: GraphContext, importsInOneColumn: boolean): { arrows: Map<string, Arrow>; stubs: Map<string, Stub> } {
  const arrows = new Map<string, Arrow>();
  const stubs = new Map<string, Stub>();
  const leafOf = new Map(ctx.plan.rawInputs.map((r) => [r.key, r.leafClass]));
  const addArrow = (from: string, to: string, key: StuffKey, perSecond: number): void => {
    const fromPort = portId(from, 'out', key);
    const toPort = portId(to, 'in', key);
    const id = edgeId(fromPort, toPort);
    const arrow = arrows.get(id);
    if (arrow === undefined) arrows.set(id, { id, from, to, key, fromPort, toPort, perSecond });
    else arrow.perSecond += perSecond;
  };
  const addStub = (id: string, stub: Stub, group: string | undefined): void => {
    const known = stubs.get(id);
    if (known === undefined) {
      stubs.set(id, group === undefined ? stub : { ...stub, group });
      return;
    }
    known.perSecond += stub.perSecond;
    if (known.issue !== stub.issue) known.issue = 'short-input';   // an input of a collapsed line short at one step, missing at another
  };
  for (const f of ctx.plan.flows) {
    if (!(f.perSecond > 0)) continue;
    if (f.from === RAW) {
      if (f.to === SINK) continue;
      const consumer = f.to === OUT ? OUT : boxOf(ctx, f.to);
      const id = importId(f.key, consumer);
      const leaf = leafOf.get(f.key);
      addStub(id, { kind: 'import', key: f.key, perSecond: f.perSecond, ...(leaf === undefined ? {} : { leaf }) },
        f.to === OUT || importsInOneColumn ? undefined : groupOf(ctx, f.to));
      addArrow(id, consumer, f.key, f.perSecond);
    } else if (f.to === SINK) {
      const producer = boxOf(ctx, f.from);
      const id = sinkId(f.key, producer);
      addStub(id, { kind: 'sink', key: f.key, perSecond: f.perSecond }, groupOf(ctx, f.from));
      addArrow(producer, id, f.key, f.perSecond);
    } else {
      const from = boxOf(ctx, f.from);
      const to = f.to === OUT ? OUT : boxOf(ctx, f.to);
      if (from !== to) addArrow(from, to, f.key, f.perSecond);
    }
  }
  for (const issue of ctx.index.issues) {
    if ((issue.code !== 'orphan-input' && issue.code !== 'short-input') || issue.stepId === undefined) continue;
    const consumer = boxOf(ctx, issue.stepId);
    const id = `missing:${issue.key}@${consumer}`;
    const missing = Math.max(0, (issue.needPerSecond ?? 0) - (issue.gotPerSecond ?? 0));
    addStub(id, { kind: 'missing', key: issue.key, perSecond: missing, issue: issue.code }, groupOf(ctx, issue.stepId));
    addArrow(id, consumer, issue.key, missing);
  }
  return { arrows, stubs };
}

/**
 * A stub's box: titled by its good, with one row: an import's kind of import (and the share bought of a good also made),
 * "no source in the plan" or "short" with what is missing, or "left over".
 */
function stubBox(ctx: GraphContext, id: string, stub: Stub): Unsized {
  const base = { key: stub.key, rate: ctx.rateOf(stub.perSecond, stub.key), perSecond: stub.perSecond };
  let row: FlowRow;
  if (stub.kind === 'import') {
    row = { ...base, side: 'out', port: portId(id, 'out', stub.key), name: stub.leaf === undefined ? 'import' : LEAF_WORD[stub.leaf] };
    const bought = ctx.boughtShare.get(stub.key);
    if (bought !== undefined) {
      row.issue = 'bought-and-made';
      row.share = formatPercent(bought);
    }
  } else if (stub.kind === 'missing') {
    const orphan = stub.issue === 'orphan-input';
    row = { ...base, side: 'out', port: portId(id, 'out', stub.key), name: orphan ? 'no source in the plan' : 'short', issue: orphan ? 'orphan-input' : 'short-input' };
  } else {
    row = { ...base, side: 'in', port: portId(id, 'in', stub.key), name: 'left over' };
  }
  const box: Unsized = { id, kind: stub.kind, key: stub.key, title: ctx.nameOf(stub.key), lines: [], owned: 'none', rows: [row], keyName: ctx.nameOf(stub.key) };
  if (stub.leaf !== undefined) box.leaf = stub.leaf;
  if (stub.group !== undefined) box.group = stub.group;
  return box;
}

/**
 * A collapsed supporting line's box: "<name> line", how many steps and machines it stands for, and a row per good
 * crossing its edge (its own material first, then in the order its steps list them), marked as its steps' rows are.
 */
function lineBox(ctx: GraphContext, key: StuffKey, arrows: ReadonlyMap<string, Arrow>): Unsized {
  const line = ctx.lines.get(key) as SupportingLine;
  const id = lineNodeId(key);
  const ins = new Map<StuffKey, number>();
  const outs = new Map<StuffKey, number>();
  for (const a of arrows.values()) {
    if (a.to === id) ins.set(a.key, (ins.get(a.key) ?? 0) + a.perSecond);
    if (a.from === id) outs.set(a.key, (outs.get(a.key) ?? 0) + a.perSecond);
  }
  const order = new Map<StuffKey, number>();
  for (const step of line.steps) for (const p of [...step.inputs, ...step.outputs]) if (!order.has(p.key)) order.set(p.key, order.size);
  const ranked = (goods: Map<StuffKey, number>): Array<[StuffKey, number]> => [...goods].sort(([a], [b]) =>
    Number(b === key) - Number(a === key) || (order.get(a) ?? order.size) - (order.get(b) ?? order.size) || byString(a, b));
  const row = (side: FlowRow['side'], good: StuffKey, perSecond: number): FlowRow => {
    const r: FlowRow = { side, key: good, port: portId(id, side, good), name: ctx.nameOf(good), rate: ctx.rateOf(perSecond, good), perSecond };
    if (side === 'out' && good === key) r.main = true;
    const issues = side === 'in' ? ctx.inputIssues : ctx.outputIssues;
    const issue = line.steps.map((step) => issues.get(`${step.id}|${good}`)).find((i) => i !== undefined);
    if (issue !== undefined) r.issue = issue.code;
    return r;
  };
  let machines = 0;
  for (const step of line.steps) machines += step.count;
  return {
    id, kind: 'line', key, title: `${line.name} line`, owned: 'none', keyName: ctx.nameOf(key),
    lines: [`${line.steps.length === 1 ? '1 step' : `${line.steps.length} steps`} · ${machinesText(machines)}`],
    rows: [...ranked(ins).map(([good, perSecond]) => row('in', good, perSecond)), ...ranked(outs).map(([good, perSecond]) => row('out', good, perSecond))],
  };
}

/** The target's box `out`: what the plan says it makes (a plan from before `Plan.target`: what flows into `out`, first by key). */
function targetBox(ctx: GraphContext): Unsized | undefined {
  const { plan } = ctx;
  const target = plan.target ?? [...ratesBy(plan.flows, (f) => f.to === OUT).keys()].sort(byString)[0];
  if (target === undefined) return undefined;
  let perSecond = 0;
  for (const f of plan.flows) if (f.to === OUT && f.key === target) perSecond += f.perSecond;
  return {
    id: OUT, kind: 'out', key: target, title: ctx.nameOf(target), lines: [], owned: 'none', keyName: ctx.nameOf(target),
    rows: [{ side: 'in', key: target, port: portId(OUT, 'in', target), name: 'target', rate: ctx.rateOf(perSecond, target), perSecond }],
  };
}

/**
 * The arrows with a row at both ends (a flow to a step the plan does not list would break the layout), sorted by id,
 * each with its good's name and rate, the rate as its label where a port at either end has other arrows, and its
 * tooltip "name · rate · From → To".
 */
function finishArrows(ctx: GraphContext, arrows: Iterable<Arrow>, nodes: readonly FlowNode[]): FlowEdge[] {
  const ports = new Set(nodes.flatMap((n) => n.rows.map((r) => r.port)));
  const kept = [...arrows].filter((a) => ports.has(a.fromPort) && ports.has(a.toPort));
  const atPort = new Map<string, number>();
  for (const a of kept) for (const port of [a.fromPort, a.toPort]) atPort.set(port, (atPort.get(port) ?? 0) + 1);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** How a tooltip names one end of an arrow. */
  const endWords = (id: string): string => {
    const node = byId.get(id);
    switch (node?.kind) {
      case 'step': {
        const main = ctx.stepById.get(id)?.mainOutput;
        return main === undefined ? node.title : `${node.title} (${ctx.nameOf(main)})`;
      }
      case 'import': return node.leaf === undefined ? 'import' : `import (${LEAF_WORD[node.leaf]})`;
      case 'missing': return node.rows[0]?.name ?? 'no source in the plan';
      case 'sink': return 'left over';
      case 'out': return 'the target';
      default: return node?.title ?? id;
    }
  };
  return kept.map((a): FlowEdge => {
    const name = ctx.nameOf(a.key);
    const rate = ctx.rateOf(a.perSecond, a.key);
    const edge: FlowEdge = { ...a, name, rate, title: `${name} · ${rate} · ${endWords(a.from)} → ${endWords(a.to)}` };
    if ((atPort.get(a.fromPort) ?? 0) > 1 || (atPort.get(a.toPort) ?? 0) > 1) edge.label = rate;
    return edge;
  }).sort((a, b) => byString(a.id, b.id));
}

/** The open supporting lines that hold a box, each with the boxes it holds, sorted by id. */
function openGroups(ctx: GraphContext, nodes: readonly FlowNode[]): FlowGroup[] {
  const groups: FlowGroup[] = [];
  for (const [key, line] of ctx.lines) {
    if (ctx.collapsed.has(key)) continue;
    const id = lineNodeId(key);
    const members = nodes.filter((n) => n.group === id).map((n) => n.id);
    if (members.length > 0) groups.push({ id, key, title: `${line.name} line`, nodes: members });
  }
  return groups.sort((a, b) => byString(a.id, b.id));
}

/**
 * The boxes and arrows of a plan (fix spec §6.2), sorted by id so the layout never depends on the plan's order:
 * - a box per step titled by its machine, with its line (tier, EU/t, machines, how busy), what it supplies, what is owned,
 *   and a row per good it takes and makes; a step that uses goods on the avoid list gets a badge naming them;
 * - an import stub `import:<key>@<step>` beside each step that takes a bought good, named by its kind of import;
 * - a stub `missing:<key>@<step>` into each input nothing supplies ("no source in the plan") or supplies short ("short");
 * - a stub `sink:<key>@<step>` for each good a step leaves over;
 * - the target `out`, `Plan.target` (else what flows into `out`, for a plan from before that field);
 * - supporting lines (`PlanStep.line`): open, a group `line:<key>` around their steps and those steps' stubs; collapsed
 *   (`collapsedLines`), one box `line:<key>` whose rows are the goods crossing its edge, its own material first;
 * - an arrow per flow, port to port, labelled with its rate only where a port has two or more arrows.
 * `importsInOneColumn` keeps import stubs out of the groups so ELK can put them all in the first column.
 */
export function flowGraph(
  plan: Plan, per: 'min' | 'hour', opts: { collapsedLines?: ReadonlySet<StuffKey>; importsInOneColumn?: boolean } = {},
): FlowGraph {
  const index = indexPlan(plan);
  const lines = supportingLines(plan);
  const ctx: GraphContext = {
    plan, index, lines, stepById: new Map(plan.steps.map((s) => [s.id, s])),
    collapsed: new Set([...(opts.collapsedLines ?? [])].filter((key) => lines.has(key))),
    nameOf: (key) => plan.names?.[key] ?? key,
    rateOf: (perSecond, key) => goodRate(perSecond, per, key),
    ...issuesByRow(index),
  };
  const importsInOneColumn = opts.importsInOneColumn === true;
  const unavoidable = unavoidableByStep(plan);
  const boxes = plan.steps.filter((s) => boxOf(ctx, s.id) === s.id).map((s) => stepBox(ctx, s, unavoidable.get(s.id)));
  const { arrows, stubs } = arrowsAndStubs(ctx, importsInOneColumn);
  for (const [id, stub] of stubs) boxes.push(stubBox(ctx, id, stub));
  for (const key of ctx.collapsed) boxes.push(lineBox(ctx, key, arrows));
  const target = targetBox(ctx);
  if (target !== undefined) boxes.push(target);
  const nodes = boxes.map(sized).sort((a, b) => byString(a.id, b.id));
  return { nodes, edges: finishArrows(ctx, arrows.values(), nodes), groups: openGroups(ctx, nodes), importsInOneColumn };
}

/**
 * The supporting lines drawn collapsed: those the group closed, and, in a plan of more than 25 steps, every line the
 * group has not opened (`toggled`: line key → open).
 */
export function collapsedLines(plan: Plan, toggled: ReadonlyMap<StuffKey, boolean>): Set<StuffKey> {
  const closedFirst = plan.steps.length > LINE_COLLAPSE_STEPS;
  const keys = [...new Set(plan.steps.flatMap((s) => (s.line === undefined ? [] : [s.line.key])))].sort(byString);
  return new Set(keys.filter((key) => !(toggled.get(key) ?? !closedFirst)));
}

/**
 * The ELK graph (web-stack §7, fix spec §6.2): every row a port fixed on its box's edge, centred on the row
 * (`FIXED_POS`), so arrows run port to port; steps aligned left in their layer, so the import stub ELK puts in the layer
 * before (aligned right there, as it has only outgoing arrows) sits next to its step; imports in the first layer only
 * with `importsInOneColumn`, the target in the last; an open supporting line a compound node holding its boxes
 * (`INCLUDE_CHILDREN`); depth-first cycle breaking; boxes and arrows in id order. An arrow's rate label sits at the end
 * whose port has the other arrows: a centre label would get a layer of its own and push the stub away from its step.
 */
export function toElk(g: { nodes: FlowNode[]; edges: FlowEdge[]; groups?: FlowGroup[]; importsInOneColumn?: boolean }): ElkNode {
  const arrows = new Map<string, number>();
  for (const e of g.edges) for (const port of [e.fromPort, e.toPort]) arrows.set(port, (arrows.get(port) ?? 0) + 1);
  const groups = g.groups ?? [];
  const groupIds = new Set(groups.map((grp) => grp.id));
  const inside = new Map<string, ElkNode[]>();
  const top: ElkNode[] = [];
  for (const n of g.nodes) {
    const layoutOptions: Record<string, string> = { 'elk.portConstraints': 'FIXED_POS' };
    if (n.kind === 'step' || n.kind === 'line') layoutOptions['elk.alignment'] = 'LEFT';
    if (n.kind === 'import' && g.importsInOneColumn === true) layoutOptions[LAYER_CONSTRAINT] = 'FIRST';
    if (n.kind === 'out') layoutOptions[LAYER_CONSTRAINT] = 'LAST';
    const ports = n.rows.map((r, i): ElkPort => ({
      id: r.port, width: PORT_SIZE, height: PORT_SIZE, x: r.side === 'in' ? -PORT_SIZE : n.width, y: rowCentre(n, i) - PORT_SIZE / 2,
      layoutOptions: { 'elk.port.side': r.side === 'in' ? 'WEST' : 'EAST' },
    }));
    const child: ElkNode = { id: n.id, width: n.width, height: n.height, ports, layoutOptions };
    if (n.group !== undefined && groupIds.has(n.group)) {
      const list = inside.get(n.group);
      if (list === undefined) inside.set(n.group, [child]);
      else list.push(child);
    } else {
      top.push(child);
    }
  }
  for (const grp of groups) top.push({ id: grp.id, layoutOptions: { 'elk.padding': GROUP_PADDING }, children: inside.get(grp.id) ?? [] });
  top.sort((a, b) => byString(a.id, b.id));
  const edges = g.edges.map((e): ElkExtendedEdge => {
    const edge: ElkExtendedEdge = { id: e.id, sources: [e.fromPort], targets: [e.toPort] };
    if (e.label !== undefined) {
      edge.labels = [{
        id: `${e.id}#label`, text: e.label, width: Math.ceil(e.label.length * LABEL_CHAR_WIDTH) + LABEL_PADDING, height: LABEL_HEIGHT,
        layoutOptions: { 'elk.edgeLabels.placement': (arrows.get(e.toPort) ?? 0) > 1 ? 'HEAD' : 'TAIL' },
      }];
    }
    return edge;
  });
  return { id: 'root', layoutOptions: { ...LAYOUT_OPTIONS }, children: top, edges };
}

/**
 * The laid-out picture in diagram coordinates: box positions (ELK places a child relative to its parent), each arrow as
 * the start, bend and end points of its first section and its label's box and centre (both relative to the arrow's
 * container), and the open supporting lines' boxes. An arrow ELK did not route runs straight from its row to its row.
 */
export function fromElk(g: { nodes: FlowNode[]; edges: FlowEdge[]; groups?: FlowGroup[] }, laid: ElkNode): FlowLayout {
  const placed = new Map<string, Box>();
  const routed = new Map<string, ElkExtendedEdge>();
  const walk = (n: ElkNode, dx: number, dy: number): void => {
    for (const e of n.edges ?? []) routed.set(e.id, e);
    for (const c of n.children ?? []) {
      const at = { x: dx + (c.x ?? 0), y: dy + (c.y ?? 0), width: c.width ?? 0, height: c.height ?? 0 };
      placed.set(c.id, at);
      walk(c, at.x, at.y);
    }
  };
  walk(laid, 0, 0);
  const nodes = g.nodes.map((n) => ({ ...n, x: placed.get(n.id)?.x ?? 0, y: placed.get(n.id)?.y ?? 0 }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  /** Where a row's port is in the diagram. */
  const portAt = (nodeId: string, port: string): [number, number] | undefined => {
    const n = at.get(nodeId);
    const i = n?.rows.findIndex((r) => r.port === port) ?? -1;
    if (n === undefined || i < 0) return undefined;
    return [n.rows[i]?.side === 'in' ? n.x : n.x + n.width, n.y + rowCentre(n, i)];
  };
  const edges = g.edges.map((e): FlowLayout['edges'][number] => {
    const laidEdge = routed.get(e.id);
    const container = laidEdge?.container;
    const origin = container === undefined || container === laid.id ? { x: 0, y: 0 } : placed.get(container) ?? { x: 0, y: 0 };
    const section = laidEdge?.sections?.[0];
    let points: Array<[number, number]>;
    if (section !== undefined) {
      points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p): [number, number] => [origin.x + p.x, origin.y + p.y]);
    } else {
      const a = portAt(e.from, e.fromPort);
      const b = portAt(e.to, e.toPort);
      points = a === undefined || b === undefined ? [] : [a, b];
    }
    const edge: FlowLayout['edges'][number] = { ...e, points };
    const label = laidEdge?.labels?.[0];
    if (label?.x !== undefined && label.y !== undefined) {
      const box = { x: origin.x + label.x, y: origin.y + label.y, width: label.width ?? 0, height: label.height ?? 0 };
      edge.labelBox = box;
      edge.labelAt = [box.x + box.width / 2, box.y + box.height / 2];
    }
    return edge;
  });
  const groups = (g.groups ?? []).map((grp) => ({ ...grp, ...(placed.get(grp.id) ?? { x: 0, y: 0, width: 0, height: 0 }) }));
  const width = laid.width ?? Math.max(0, ...nodes.map((n) => n.x + n.width));
  const height = laid.height ?? Math.max(0, ...nodes.map((n) => n.y + n.height));
  return { width, height, nodes, edges, groups };
}

/**
 * What a focus lights (fix spec §6.2). An item: every row and arrow of that good, the boxes that make it (`producers`)
 * and those that take it (`consumers`). A box: its rows and arrows and the boxes at their other ends, those it takes
 * from as producers and those it gives to as consumers. An arrow: it, its two rows and its two boxes. Null for no focus,
 * and for a focus on nothing this graph has (so nothing dims for a good the plan no longer has).
 */
export function focusSets(graph: { nodes: FlowNode[]; edges: FlowEdge[] }, focus: Focus): FocusSets | null {
  if (focus === null) return null;
  const sets: FocusSets = { nodes: new Set(), edges: new Set(), ports: new Set(), producers: new Set(), consumers: new Set() };
  const light = (e: FlowEdge): void => {
    sets.edges.add(e.id);
    sets.ports.add(e.fromPort);
    sets.ports.add(e.toPort);
    sets.nodes.add(e.from);
    sets.nodes.add(e.to);
  };
  if (focus.kind === 'item') {
    for (const n of graph.nodes) {
      for (const r of n.rows) {
        if (r.key !== focus.key) continue;
        sets.ports.add(r.port);
        sets.nodes.add(n.id);
        (r.side === 'out' ? sets.producers : sets.consumers).add(n.id);
      }
    }
    for (const e of graph.edges) if (e.key === focus.key) light(e);
  } else if (focus.kind === 'node') {
    const node = graph.nodes.find((n) => n.id === focus.id);
    if (node !== undefined) {
      sets.nodes.add(node.id);
      for (const r of node.rows) sets.ports.add(r.port);
      for (const e of graph.edges) {
        if (e.to === node.id) {
          light(e);
          sets.producers.add(e.from);
        } else if (e.from === node.id) {
          light(e);
          sets.consumers.add(e.to);
        }
      }
    }
  } else {
    const edge = graph.edges.find((e) => e.id === focus.id);
    if (edge !== undefined) {
      light(edge);
      sets.producers.add(edge.from);
      sets.consumers.add(edge.to);
    }
  }
  return sets.nodes.size === 0 ? null : sets;
}

/** Which boxes count as making a good first: steps (and collapsed lines), then imports, then the stubs of what is missing. */
const PRODUCER_RANK: Readonly<Record<FlowNodeKind, number>> = { step: 0, line: 0, import: 1, missing: 2, out: 3, sink: 3 };

/**
 * The box Find and the Show buttons centre for a good (fix spec §6.2): the step that makes most of it, else its import
 * stub, else the stub of an input nothing supplies; a good only taken, its first taker; undefined when the graph has none.
 */
export function firstProducer(graph: { nodes: FlowNode[] }, key: StuffKey): string | undefined {
  let best: { id: string; rank: number; perSecond: number } | undefined;
  for (const n of graph.nodes) {
    for (const r of n.rows) {
      if (r.key !== key || r.side !== 'out') continue;
      const candidate = { id: n.id, rank: PRODUCER_RANK[n.kind], perSecond: r.perSecond ?? 0 };
      if (best === undefined || candidate.rank < best.rank
        || (candidate.rank === best.rank && (candidate.perSecond > best.perSecond || (candidate.perSecond === best.perSecond && candidate.id < best.id)))) {
        best = candidate;
      }
    }
  }
  return best?.id ?? graph.nodes.find((n) => n.rows.some((r) => r.key === key))?.id;
}

/** The box to bring into view for a focus: an item's first producer, the box itself, an arrow's source. */
export function focusAnchor(graph: { nodes: FlowNode[]; edges: FlowEdge[] }, focus: Focus): string | undefined {
  if (focus === null) return undefined;
  if (focus.kind === 'item') return firstProducer(graph, focus.key);
  if (focus.kind === 'node') return graph.nodes.some((n) => n.id === focus.id) ? focus.id : undefined;
  return graph.edges.find((e) => e.id === focus.id)?.from;
}

/** The view that puts the middle of `node` in the middle of the canvas, at the view's zoom. */
export function centreOn(
  node: { x: number; y: number; width: number; height: number }, view: { zoom: number; x: number; y: number }, canvas: { width: number; height: number },
): { zoom: number; x: number; y: number } {
  return { zoom: view.zoom, x: canvas.width / 2 - (node.x + node.width / 2) * view.zoom, y: canvas.height / 2 - (node.y + node.height / 2) * view.zoom };
}

/** The tag in which a lit arrow writes its good and rate ("1x Copper Wire · 2/h", fix spec §6.2), drawn above the boxes. */
export interface EdgeTag extends Box { text: string }

/**
 * Where a lit arrow writes "name · rate": over ELK's label box when the arrow has one, stretched away from the port the
 * arrow shares (so the tags of arrows into one port stay apart, as their labels do); else on the middle of the arrow's
 * longest segment, above it when that segment runs across.
 */
export function edgeTag(edge: Pick<FlowLayout['edges'][number], 'name' | 'rate' | 'points' | 'labelBox'>): EdgeTag | undefined {
  const text = `${edge.name} · ${edge.rate}`;
  const width = Math.ceil(text.length * LABEL_CHAR_WIDTH) + LABEL_PADDING;
  const height = LABEL_HEIGHT + 2;
  const box = edge.labelBox;
  const start = edge.points[0];
  const end = edge.points.at(-1);
  if (box !== undefined) {
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    // A head label sits by the arrow's end: the tag grows back along the arrow from there.
    const head = start === undefined || end === undefined || Math.hypot(end[0] - cx, end[1] - cy) <= Math.hypot(start[0] - cx, start[1] - cy);
    return { text, width, height, x: head ? box.x + box.width - width : box.x, y: cy - height / 2 };
  }
  let best: { x: number; y: number; across: boolean } | undefined;
  let longest = -1;
  for (let i = 1; i < edge.points.length; i += 1) {
    const [ax, ay] = edge.points[i - 1] as [number, number];
    const [bx, by] = edge.points[i] as [number, number];
    const length = Math.hypot(bx - ax, by - ay);
    if (length <= longest) continue;
    longest = length;
    best = { x: (ax + bx) / 2, y: (ay + by) / 2, across: ay === by };
  }
  if (best === undefined) return undefined;
  return { text, width, height, x: best.x - width / 2, y: best.across ? best.y - height - 2 : best.y - height / 2 };
}

/** Every good the diagram shows, by name, for Find item. */
export function findableGoods(graph: { nodes: FlowNode[] }, plan: Plan): Array<{ key: StuffKey; name: string }> {
  const keys = new Set(graph.nodes.flatMap((n) => n.rows.map((r) => r.key)));
  return [...keys].map((key) => ({ key, name: plan.names?.[key] ?? key }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || byString(a.key, b.key));
}

/** The integrity issues, most serious first (fix spec R11): the order of the plan banner and of the issues box. */
export const ISSUE_ORDER: readonly PlanIssueCode[] = ['orphan-input', 'short-input', 'multi-producer', 'bought-and-made'];

/** A warning's or an issue's identity: the same problem of the same good at the same step. */
export function problemId(p: { code: string; key?: StuffKey | undefined; stepId?: string | undefined }): string {
  return `${p.code}|${p.key ?? ''}|${p.stepId ?? ''}`;
}

/**
 * One line of the issues box above the diagram: the issue, its words, and for a good made two ways the bigger maker,
 * whose recipe "Keep only" pins, and what that pin would leave in the plan (`stays`, in plain words). Without
 * `keepOnly` the pin would leave every other maker.
 */
export interface FlowIssueLine { issue: PlanIssue; text: string; keepOnly?: { recipeId: string; machine: string }; stays?: string }

/**
 * Why a "Keep only" pin of `key` cannot take `step`, another maker of it, out of the plan, in words after "which …"
 * (plan 09's final review): the planner's walk keeps the step for something else. The client sees only the plan, so
 * these are the two cases a plan shows, null otherwise (the pin may still leave such a step, as a distillation run for
 * another of its fractions). On the 75 two-way goods of 192 real plans (the 2.9 export) the step stayed in the replanned
 * plan for 32 of the 33 issues they name, and the pin removed the makers of 25 of the other 42.
 */
function keptBy(plan: Plan, index: PlanIndex, step: PlanStep, key: StuffKey): string | null {
  const name = (k: StuffKey): string => plan.names?.[k] ?? k;
  // It makes another good the line takes from it that another step makes as its main output, so the walk keeps it for
  // that good too (GEC HV's salt water electrolysis, run for Chlorine beside the canner, made 2 % of its Hydrogen Cells).
  const forGoods = [...(index.outputs.get(step.id) ?? [])].filter(([good, side]) => good !== key && !FREE_KEYS.includes(good)
    && side.peers.some((p) => p.node !== SINK && p.perSecond > 0)
    && (index.producers.get(good) ?? []).some((p) => p.main && p.stepId !== step.id)).map(([good]) => name(good));
  if (forGoods.length > 0) return `the line runs for ${joinNames(forGoods)}`;
  // It empties containers another step fills (one item in, as many of another out beside the fluid `key`): the walk adds
  // it with whatever makes the filled ones (fix spec D14).
  const [filled, ...more] = step.inputs;
  const handedBack = step.outputs.filter((o) => o.key !== key);
  const empty = handedBack.length === 1 ? handedBack[0] : undefined;
  if (!isFluidKey(key) || filled === undefined || more.length > 0 || isFluidKey(filled.key) || empty === undefined
    || isFluidKey(empty.key) || empty.amount !== filled.amount) return null;
  const made = (index.inputs.get(step.id)?.get(filled.key)?.peers ?? []).some((p) => p.node !== RAW && p.perSecond > 0);
  return made ? `empties the ${name(filled.key)} the line makes` : null;
}

/**
 * What does not add up (fix spec §6.2 "Issues"), most serious first: each issue in the server's words when the plan
 * carries them, else `issueText`'s; a good made two ways also names the step that makes most of it, whose recipe
 * "Keep only" pins, unless the line keeps every other maker for something else (`keptBy`): then the line says so
 * instead, and with only some of them kept it says which the pin would leave.
 */
export function flowIssueLines(plan: Plan, index: PlanIndex = indexPlan(plan)): FlowIssueLine[] {
  const served = new Map(plan.warnings.map((w) => [problemId(w), w.text]));
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  return [...index.issues].sort((a, b) => ISSUE_ORDER.indexOf(a.code) - ISSUE_ORDER.indexOf(b.code)).map((issue) => {
    const line: FlowIssueLine = { issue, text: served.get(problemId(issue)) ?? issueText(issue, plan) };
    const [biggerId, ...others] = issue.stepIds ?? [];
    const bigger = issue.code === 'multi-producer' ? steps.get(biggerId ?? issue.stepId ?? '') : undefined;
    if (bigger === undefined) return line;
    const kept = others.flatMap((id, i) => {
      const step = steps.get(id);
      const why = step === undefined ? null : keptBy(plan, index, step, issue.key);
      return step === undefined || why === null ? [] : [{ share: formatPercent(issue.share?.[i + 1] ?? 0), machine: step.machine.name, why }];
    });
    if (others.length === 0 || kept.length < others.length) line.keepOnly = { recipeId: bigger.recipeId, machine: bigger.machine.name };
    if (kept.length === 0) return line;
    line.stays = line.keepOnly === undefined
      ? `Keep only would not change this: ${kept.map((k) => `the ${k.share} comes from ${k.machine}, which ${k.why}`).join('; ')}.`
      : `Keep only would still leave ${joinNames(kept.map((k) => `the ${k.share} from ${k.machine}, which ${k.why}`))}.`;
    return line;
  });
}

/** `declineReuse` with `mteId` taken out (`reuse`) or put in, sorted ascending without repeats. */
export function reusePatch(settings: PlanSettings, mteId: number, reuse: boolean): Partial<PlanSettings> {
  const declined = new Set(settings.declineReuse ?? []);
  if (reuse) declined.delete(mteId);
  else declined.add(mteId);
  return { declineReuse: [...declined].sort((a, b) => a - b) };
}

/** "Use only this recipe for <good>": `recipeChoice` pinning `recipeId` for `key`. */
export function useOnlyPatch(settings: PlanSettings, key: StuffKey, recipeId: string): Partial<PlanSettings> {
  return { recipeChoice: { ...settings.recipeChoice, [key]: recipeId } };
}

/** "Import <good> instead", "We already make <line>": `stopItems` with `key` in it. */
export function importInsteadPatch(settings: PlanSettings, key: StuffKey): Partial<PlanSettings> {
  return { stopItems: toggleList(settings.stopItems, key, true) };
}

/** "Make it here instead": `expandItems` with `key` in it. */
export function makeHerePatch(settings: PlanSettings, key: StuffKey): Partial<PlanSettings> {
  return { expandItems: toggleList(settings.expandItems, key, true) };
}

/** "We already have a supply of <good>" (`on`) or "Plan its generator again": `haveSupply` with `key` put in or out. */
export function haveSupplyPatch(settings: PlanSettings, key: StuffKey, on: boolean): Partial<PlanSettings> {
  return { haveSupply: toggleList(settings.haveSupply ?? [], key, on) };
}

/** The `optionChoice` key of one ingredient slot of a recipe (fix spec R9). */
export function optionSlotKey(recipeId: string, slot: number): string {
  return `${recipeId}#${slot}`;
}

/** "Pin this option" (`key`) or "Let the planner choose" (null): `optionChoice` with that slot's pin set or taken out. */
export function optionPatch(settings: PlanSettings, recipeId: string, slot: number, key: StuffKey | null): Partial<PlanSettings> {
  const pins = { ...(settings.optionChoice ?? {}) };
  const slotKey = optionSlotKey(recipeId, slot);
  if (key === null) delete pins[slotKey];
  else pins[slotKey] = key;
  return { optionChoice: pins };
}

function seconds(ticks: number): string {
  return trimZeros((ticks / TICKS_PER_SECOND).toFixed(2));
}

/** What the overclocks did: heat overclocks (EBF coils) first, else perfect overclocks, else the normal ×4 / ÷2. */
function overclockKind(oc: NonNullable<PlanStep['oc']>): string {
  if (oc.heatOverclocks > 0) return `(${oc.heatOverclocks} perfect from heat)`;
  return oc.perfect ? '(×4 EU/t, ÷4 time)' : '(×4 EU/t, ÷2 time)';
}

/**
 * The overclock math of a step in four lines: the recipe, the machine, the overclocks and their result, and how many
 * machines the rate needs. A step without its overclock inputs reads as the machine's tier voltage and 1 A. A rare run
 * reads as how often it comes, and a machine that runs at all is never "0% busy" (fix spec §6.1).
 */
export function ocLines(step: PlanStep): string[] {
  const oc = step.oc ?? {
    recipeEuPerTick: step.euPerTick, recipeDurationTicks: step.durationTicks, machineVoltage: V[step.machine.tier] ?? 0,
    machineAmps: 1, perfect: false, heatOverclocks: 0,
  };
  const n = step.overclocks;
  const how = n > 0 ? ` ${overclockKind(oc)}` : '';
  const busy = step.count * step.utilization;
  // The rate one machine manages, parallels included; machines that never run fall back to one run per duration.
  const perMachine = busy > 0 ? step.runsPerSecond / busy : step.durationTicks > 0 ? TICKS_PER_SECOND / step.durationTicks : 0;
  return [
    `Recipe: ${oc.recipeEuPerTick} EU/t × ${oc.recipeDurationTicks} t (${seconds(oc.recipeDurationTicks)} s)`,
    `Machine: ${tierText(step.machine.tier)}, ${oc.machineVoltage} V × ${oc.machineAmps} A`,
    `${n} ${n === 1 ? 'overclock' : 'overclocks'}${how} → ${step.euPerTick} EU/t × ${step.durationTicks} t`,
    `One machine: ${runsText(perMachine)} · needed: ${runsText(step.runsPerSecond)} → ${machinesText(step.count)}, ${formatPercent(step.utilization)} busy`,
  ];
}
