// What the flow diagram shows (spec §3.9), as pure functions: the boxes and arrows of a plan (a step that cannot avoid
// a material on the avoid list badged, spec §3.3), the ELK graph that lays them out (web-stack §7) and the laid-out
// picture read back from it, the rate and overclock texts (the shared formatter of fix spec §6.1), the word for each
// kind of import, and the settings patches the panels send (fix spec §6.3), each with the whole new value of one
// setting. Base materials sit on the left and the target on the right.

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES, V } from '../../shared/gt/tiers.ts';
import type { LeafClass, Plan, PlanFlow, PlanSettings, PlanStep, PlanWarning } from '../../shared/types/plan.ts';
import { formatDuration, formatNumber, formatPercent, formatRate } from '../format.ts';
import { toggleList } from './settings-model.ts';

export { formatNumber, formatRate };

export interface FlowNode {
  id: string; kind: 'raw' | 'step' | 'out' | 'sink'; key: StuffKey | null; title: string; lines: string[];
  owned: 'all' | 'some' | 'none'; width: number; height: number;
  // optional addition
  /**
   * A step that uses goods on the avoid list because nothing at the tier avoids them (`avoid-unavoidable`): the badge
   * text below its lines (one line more of height) and the warnings behind it.
   */
  avoidBadge?: { text: string; warnings: string[] };
  // optional addition
  /** The name of `key`, for its icon's tooltip and accessible name. */
  keyName?: string;
}

/**
 * What kind of import a raw input is, in the words of fix spec §6.2 (the flow's import stubs and the raw-material
 * panel's header); the Materials badges keep their own words (`LEAF_BADGES`, ruling P26).
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

/** A tier's name; a tier outside 0..14 shows as its number instead of breaking the diagram. */
function tierText(t: number): string {
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

function node(id: string, kind: FlowNode['kind'], key: StuffKey | null, title: string, lines: string[], owned: FlowNode['owned'] = 'none'): FlowNode {
  return { id, kind, key, title, lines, owned, width: NODE_WIDTH, height: NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * lines.length };
}

/** The node a flow end stands for: `raw` → `raw:<key>`, `sink` → `sink:<key>`, a step id or `out` as given. */
function endId(end: string, key: StuffKey): string {
  return end === RAW || end === SINK ? `${end}:${key}` : end;
}

/** The id of the arrow a flow is drawn as (the step panels light it through the flow focus). */
export function flowEdgeId(f: Pick<PlanFlow, 'from' | 'to' | 'key'>): string {
  return `${endId(f.from, f.key)}->${endId(f.to, f.key)}:${f.key}`;
}

/** Sums of `perSecond` by key for the flows `pick` selects. */
function ratesBy(flows: Plan['flows'], pick: (f: Plan['flows'][number]) => boolean): Map<StuffKey, number> {
  const rates = new Map<StuffKey, number>();
  for (const f of flows) if (pick(f)) rates.set(f.key, (rates.get(f.key) ?? 0) + f.perSecond);
  return rates;
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

/**
 * The boxes and arrows of a plan: one box per step, per raw material, per thrown-away good (`sink:<key>`) and one for
 * the target (`out`, from the flows into it); one arrow per flow, labelled with the good and its rate. Sorted by id.
 * A step that uses goods on the avoid list gets a badge naming them (`FlowNode.avoidBadge`).
 */
export function flowGraph(plan: Plan, per: 'min' | 'hour'): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nameOf = (key: StuffKey): string => plan.names?.[key] ?? key;
  const nodes: FlowNode[] = [];
  const unavoidable = unavoidableByStep(plan);
  const leafOf = new Map(plan.rawInputs.map((r) => [r.key, r.leafClass]));
  const named = (box: FlowNode): FlowNode => (box.key === null ? box : { ...box, keyName: nameOf(box.key) });

  for (const step of plan.steps) {
    const lines = [`${tierText(step.machine.tier)} · ${step.euPerTick} EU/t · ${formatPercent(step.utilization)} busy`];
    if (step.mainOutput !== undefined) lines.push(`makes ${nameOf(step.mainOutput)}`);
    if (step.owned > 0) lines.push(`${step.owned} owned`);
    const box = named(node(step.id, 'step', step.mainOutput ?? null, `${step.count}× ${step.machine.name}`, lines, ownedState(step)));
    const uses = unavoidable.get(step.id);
    if (uses !== undefined) {
      const goods = [...new Set(uses.flatMap((w) => (w.key === undefined ? [] : [nameOf(w.key)])))];
      box.avoidBadge = { text: `⚠ uses avoided ${goods.join(', ')}`, warnings: uses.map((w) => w.text) };
      box.height += NODE_LINE_HEIGHT;
    }
    nodes.push(box);
  }
  for (const [key, perSecond] of ratesBy(plan.flows, (f) => f.from === RAW)) {
    const leaf = leafOf.get(key);
    nodes.push(named(node(`${RAW}:${key}`, 'raw', key, nameOf(key), [`${leaf === undefined ? 'raw' : LEAF_WORD[leaf]} · ${goodRate(perSecond, per, key)}`])));
  }
  for (const [key, perSecond] of ratesBy(plan.flows, (f) => f.to === SINK)) {
    nodes.push(named(node(`${SINK}:${key}`, 'sink', key, nameOf(key), [`byproduct · ${goodRate(perSecond, per, key)}`])));
  }
  // The target is what flows into `out` (one good; the first by key if ever more).
  const out = [...ratesBy(plan.flows, (f) => f.to === OUT)].sort((a, b) => byString(a[0], b[0]))[0];
  if (out !== undefined) nodes.push(named(node(OUT, 'out', out[0], nameOf(out[0]), [goodRate(out[1], per, out[0])])));

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  for (const f of plan.flows) {
    const from = endId(f.from, f.key);
    const to = endId(f.to, f.key);
    if (!ids.has(from) || !ids.has(to)) continue;   // a flow to a step the plan does not list would break the layout
    edges.push({ id: flowEdgeId(f), from, to, key: f.key, label: `${nameOf(f.key)} ${goodRate(f.perSecond, per, f.key)}` });
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
  const machines = step.count === 1 ? '1 machine' : `${step.count} machines`;
  return [
    `Recipe: ${oc.recipeEuPerTick} EU/t × ${oc.recipeDurationTicks} t (${seconds(oc.recipeDurationTicks)} s)`,
    `Machine: ${tierText(step.machine.tier)}, ${oc.machineVoltage} V × ${oc.machineAmps} A`,
    `${n} ${n === 1 ? 'overclock' : 'overclocks'}${how} → ${step.euPerTick} EU/t × ${step.durationTicks} t`,
    `One machine: ${runsText(perMachine)} · needed: ${runsText(step.runsPerSecond)} → ${machines}, ${formatPercent(step.utilization)} busy`,
  ];
}
