// What the flow diagram shows (spec §3.9), as pure functions: the boxes and arrows of a plan, the ELK graph that lays
// them out (web-stack §7) and the laid-out picture read back from it, the rate and overclock texts, and the settings
// patch for "reuse our machines". Base materials sit on the left and the target on the right.

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES, V } from '../../shared/gt/tiers.ts';
import type { Plan, PlanSettings, PlanStep } from '../../shared/types/plan.ts';

export interface FlowNode {
  id: string; kind: 'raw' | 'step' | 'out' | 'sink'; key: StuffKey | null; title: string; lines: string[];
  owned: 'all' | 'some' | 'none'; width: number; height: number;
}

export interface FlowEdge { id: string; from: string; to: string; key: StuffKey; label: string }

export interface FlowLayout {
  width: number; height: number;
  nodes: Array<FlowNode & { x: number; y: number }>;
  /** `labelAt` (an addition): the centre of the edge's label where ELK placed it. */
  edges: Array<FlowEdge & { points: Array<[number, number]>; labelAt?: [number, number] }>;
}

const NODE_WIDTH = 200;
/** A box is this tall for its title plus this much per line of text. */
export const NODE_TITLE_HEIGHT = 28;
export const NODE_LINE_HEIGHT = 16;
const TICKS_PER_SECOND = 20;
/** Edge label boxes for ELK: the label font is about this wide per character and this tall. */
const LABEL_CHAR_WIDTH = 6.5;
const LABEL_PADDING = 8;
const LABEL_HEIGHT = 14;

const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

/** The layout options of web-stack §7, exactly. */
const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
};
const LAYER_CONSTRAINT = 'elk.layered.layering.layerConstraint';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Decimal text without trailing zeros (and without a trailing point). */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** `x` with at most `digits` significant digits, written out in full (never `1e-7`). */
function significant(x: number, digits: number): string {
  if (x === 0 || !Number.isFinite(x)) return String(x);
  const rounded = Number(x.toPrecision(digits));
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(rounded))));
  return trimZeros(rounded.toFixed(Math.min(decimals, 20)));
}

/** A number with at most three significant digits (runs per second, raw cost per unit). */
export function formatNumber(x: number): string {
  return significant(x, 3);
}

/** A tier's name; a tier outside 0..14 shows as its number instead of breaking the diagram. */
function tierText(t: number): string {
  return TIER_NAMES[t] ?? `tier ${t}`;
}

/** `<n>/min` or `<n>/h`: whole from 100, at most one decimal from 1, else two significant digits. */
export function formatRate(perSecond: number, per: 'min' | 'hour'): string {
  const amount = perSecond * (per === 'min' ? 60 : 3600);
  const unit = per === 'min' ? '/min' : '/h';
  const size = Math.abs(amount);
  const text = size >= 100 ? String(Math.round(amount)) : size >= 1 ? trimZeros(amount.toFixed(1)) : significant(amount, 2);
  return `${text}${unit}`;
}

function percent(utilization: number): number {
  return Math.round(utilization * 100);
}

function ownedState(step: PlanStep): FlowNode['owned'] {
  if (step.owned > 0 && step.owned >= step.count) return 'all';
  return step.owned > 0 ? 'some' : 'none';
}

function node(id: string, kind: FlowNode['kind'], key: StuffKey | null, title: string, lines: string[], owned: FlowNode['owned'] = 'none'): FlowNode {
  return { id, kind, key, title, lines, owned, width: NODE_WIDTH, height: NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * lines.length };
}

/** The node a flow end stands for: `raw` → `raw:<key>`, `sink` → `sink:<key>`, a step id or `out` as given. */
function endId(end: string, key: StuffKey): string {
  return end === RAW || end === SINK ? `${end}:${key}` : end;
}

/** Sums of `perSecond` by key for the flows `pick` selects. */
function ratesBy(flows: Plan['flows'], pick: (f: Plan['flows'][number]) => boolean): Map<StuffKey, number> {
  const rates = new Map<StuffKey, number>();
  for (const f of flows) if (pick(f)) rates.set(f.key, (rates.get(f.key) ?? 0) + f.perSecond);
  return rates;
}

/**
 * The boxes and arrows of a plan: one box per step, per raw material, per thrown-away good (`sink:<key>`) and one for
 * the target (`out`, from the flows into it); one arrow per flow, labelled with the good and its rate. Sorted by id.
 */
export function flowGraph(plan: Plan, per: 'min' | 'hour'): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nameOf = (key: StuffKey): string => plan.names?.[key] ?? key;
  const rate = (perSecond: number): string => formatRate(perSecond, per);
  const nodes: FlowNode[] = [];

  for (const step of plan.steps) {
    const lines = [`${tierText(step.machine.tier)} · ${step.euPerTick} EU/t · ${percent(step.utilization)}% busy`];
    if (step.mainOutput !== undefined) lines.push(`makes ${nameOf(step.mainOutput)}`);
    if (step.owned > 0) lines.push(`${step.owned} owned`);
    nodes.push(node(step.id, 'step', step.mainOutput ?? null, `${step.count}× ${step.machine.name}`, lines, ownedState(step)));
  }
  for (const [key, perSecond] of ratesBy(plan.flows, (f) => f.from === RAW)) {
    nodes.push(node(`${RAW}:${key}`, 'raw', key, nameOf(key), [`raw · ${rate(perSecond)}`]));
  }
  for (const [key, perSecond] of ratesBy(plan.flows, (f) => f.to === SINK)) {
    nodes.push(node(`${SINK}:${key}`, 'sink', key, nameOf(key), [`byproduct · ${rate(perSecond)}`]));
  }
  // Plan has no target field: the target is what flows into `out` (one good; the first by key if ever more).
  const out = [...ratesBy(plan.flows, (f) => f.to === OUT)].sort((a, b) => byString(a[0], b[0]))[0];
  if (out !== undefined) nodes.push(node(OUT, 'out', out[0], nameOf(out[0]), [rate(out[1])]));

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  for (const f of plan.flows) {
    const from = endId(f.from, f.key);
    const to = endId(f.to, f.key);
    if (!ids.has(from) || !ids.has(to)) continue;   // a flow to a step the plan does not list would break the layout
    edges.push({ id: `${from}->${to}:${f.key}`, from, to, key: f.key, label: `${nameOf(f.key)} ${rate(f.perSecond)}` });
  }
  return { nodes: nodes.sort((a, b) => byString(a.id, b.id)), edges: edges.sort((a, b) => byString(a.id, b.id)) };
}

/** The ELK graph of web-stack §7: raw materials in the first layer, the target in the last, a label box per arrow. */
export function toElk(g: { nodes: FlowNode[]; edges: FlowEdge[] }): ElkNode {
  const children: ElkNode[] = g.nodes.map((n) => {
    const child: ElkNode = { id: n.id, width: n.width, height: n.height };
    if (n.kind === 'raw') child.layoutOptions = { [LAYER_CONSTRAINT]: 'FIRST' };
    if (n.kind === 'out') child.layoutOptions = { [LAYER_CONSTRAINT]: 'LAST' };
    return child;
  });
  const edges: ElkExtendedEdge[] = g.edges.map((e) => ({
    id: e.id, sources: [e.from], targets: [e.to],
    labels: [{ id: `${e.id}#label`, text: e.label, width: Math.ceil(e.label.length * LABEL_CHAR_WIDTH) + LABEL_PADDING, height: LABEL_HEIGHT }],
  }));
  return { id: 'root', layoutOptions: { ...LAYOUT_OPTIONS }, children, edges };
}

/** The laid-out picture: node positions, and each arrow as the start, bend and end points of its first section. */
export function fromElk(g: { nodes: FlowNode[]; edges: FlowEdge[] }, laid: ElkNode): FlowLayout {
  const placed = new Map((laid.children ?? []).map((c) => [c.id, c]));
  const nodes = g.nodes.map((n) => ({ ...n, x: placed.get(n.id)?.x ?? 0, y: placed.get(n.id)?.y ?? 0 }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const routed = new Map((laid.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge]));
  const edges = g.edges.map((e): FlowLayout['edges'][number] => {
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
    const edge: FlowLayout['edges'][number] = { ...e, points };
    if (label?.x !== undefined && label.y !== undefined) edge.labelAt = [label.x + (label.width ?? 0) / 2, label.y + (label.height ?? 0) / 2];
    return edge;
  });
  const width = laid.width ?? Math.max(0, ...nodes.map((n) => n.x + n.width));
  const height = laid.height ?? Math.max(0, ...nodes.map((n) => n.y + n.height));
  return { width, height, nodes, edges };
}

/** `declineReuse` with `mteId` taken out (`reuse`) or put in, sorted ascending without repeats. */
export function reusePatch(settings: PlanSettings, mteId: number, reuse: boolean): Partial<PlanSettings> {
  const declined = new Set(settings.declineReuse ?? []);
  if (reuse) declined.delete(mteId);
  else declined.add(mteId);
  return { declineReuse: [...declined].sort((a, b) => a - b) };
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
 * machines the rate needs. A step without its overclock inputs reads as the machine's tier voltage and 1 A.
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
  const machines = step.count === 1 ? '1 machine' : `${step.count} machines`;
  return [
    `Recipe: ${oc.recipeEuPerTick} EU/t × ${oc.recipeDurationTicks} t (${seconds(oc.recipeDurationTicks)} s)`,
    `Machine: ${tierText(step.machine.tier)}, ${oc.machineVoltage} V × ${oc.machineAmps} A`,
    `${n} ${n === 1 ? 'overclock' : 'overclocks'}${how} → ${step.euPerTick} EU/t × ${step.durationTicks} t`,
    `One machine: ${formatNumber(perMachine)} runs/s · needed: ${formatNumber(step.runsPerSecond)} runs/s → ${machines}, ${percent(step.utilization)}% busy`,
  ];
}
