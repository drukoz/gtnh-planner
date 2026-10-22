// The plan index (fix spec R11, D16, D20): what flows into and out of every step's ports, who makes each good, and the
// integrity issues a plan carries — an input nothing supplies or supplies short, a good two steps make as their main
// output, a good both bought and made — with their texts (§6.4). `planLine` adds one warning per issue; the client runs
// the same functions as a guard and prefers the server's texts.
// Pure TypeScript shared by server and browser: nothing from node:* and no DOM.

import { formatPercent, formatRate } from '../format.ts';
import { isFluidKey, type StuffKey } from '../keys.ts';
import type { Product } from '../types/pack.ts';
import type { Plan } from '../types/plan.ts';

/** An input that gets at most this share of what its step needs has no source in the plan (`orphan-input`). */
export const ORPHAN_REL = 1e-6;
/** An input that gets less than this share of what its step needs is supplied short (`short-input`). */
export const SHORT_INPUT_SHARE = 0.995;

export type PlanIssueCode = 'orphan-input' | 'short-input' | 'multi-producer' | 'bought-and-made';
/**
 * One thing a plan does not add up on. `stepId`: the consumer (orphan, short) or the largest main producer (multi,
 * bought); `stepIds` the main producers, largest first, and `share` their shares of what the steps make of the good
 * (multi), or the share bought of all there is of it (bought); `needPerSecond`/`gotPerSecond` what the consumer needs
 * and gets (orphan, short).
 */
export interface PlanIssue {
  code: PlanIssueCode; key: StuffKey; stepId?: string; stepIds?: string[]; share?: number[]; needPerSecond?: number; gotPerSecond?: number;
}
/** What flows through one port of a step: the total per second and where it comes from or goes to, largest first. */
export interface PortSide { perSecond: number; peers: Array<{ node: string /* step id | 'raw' | 'out' | 'sink' */; perSecond: number }> }
export interface PlanIndex {
  /** Step → good → what flows in, and what the step needs of it per second. */
  inputs: Map<string, Map<StuffKey, PortSide & { needPerSecond: number }>>;
  /** Step → good → what flows out. */
  outputs: Map<string, Map<StuffKey, PortSide>>;
  /** Good → the steps that make it, largest first: per second, share of what the steps make of it, as their main output. */
  producers: Map<StuffKey, Array<{ stepId: string; perSecond: number; share: number; main: boolean }>>;
  /** Sorted by code, then key, then step id. */
  issues: PlanIssue[];
}

/** The flow end of what the line buys. */
const RAW = 'raw';

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Per-run amounts summed per key (a recipe may list one good in two output slots). */
function perRun(products: readonly Product[]): Map<StuffKey, number> {
  const out = new Map<StuffKey, number>();
  for (const p of products) out.set(p.key, (out.get(p.key) ?? 0) + p.amount);
  return out;
}

/** node → good → peer node → per second. */
type FlowsByNode = Map<string, Map<StuffKey, Map<string, number>>>;

function addFlow(byNode: FlowsByNode, node: string, key: StuffKey, peer: string, perSecond: number): void {
  let goods = byNode.get(node);
  if (goods === undefined) byNode.set(node, (goods = new Map()));
  let peers = goods.get(key);
  if (peers === undefined) goods.set(key, (peers = new Map()));
  peers.set(peer, (peers.get(peer) ?? 0) + perSecond);
}

function portSide(peers: ReadonlyMap<string, number> | undefined): PortSide {
  const list = [...(peers ?? [])].map(([node, perSecond]) => ({ node, perSecond }))
    .sort((a, b) => b.perSecond - a.perSecond || byString(a.node, b.node));
  let perSecond = 0;
  for (const p of list) perSecond += p.perSecond;
  return { perSecond, peers: list };
}

/**
 * The index of `plan` (spec R11). A step needs of a good what it takes per run less what it makes of it per run (flows
 * carry net amounts), times its runs per second, and gets what flows into it; a good that flows in without being one of
 * its inputs is a port it needs nothing of. Issues: `orphan-input` (need > 0, got ≤ ORPHAN_REL × need), `short-input`
 * (got < SHORT_INPUT_SHARE × need), `multi-producer` (the main output of 2+ steps), `bought-and-made` (a good the line
 * buys that is some step's main output). A good several steps make only beside their main output is no issue, nor is
 * the shortfall of a good a Make N batch's `batch-short` warning covers (its `keys`): it says what to have ready.
 * Add-on 17: what the line buys of a good is only the bought share of its `raw` flows — those less its raw inputs taken
 * from a farm the group runs or another project (`RawInput.from`), at least 0, and above ORPHAN_REL of them, as the flows
 * and rows each keep 9 digits — so a capped supply topped up by a step is no `bought-and-made` issue.
 */
export function indexPlan(plan: Plan): PlanIndex {
  const into: FlowsByNode = new Map();
  const outOf: FlowsByNode = new Map();
  const fromRaw = new Map<StuffKey, number>();
  for (const f of plan.flows) {
    addFlow(into, f.to, f.key, f.from, f.perSecond);
    addFlow(outOf, f.from, f.key, f.to, f.perSecond);
    if (f.from === RAW) fromRaw.set(f.key, (fromRaw.get(f.key) ?? 0) + f.perSecond);
  }
  const supplied = new Map<StuffKey, number>();
  for (const input of plan.rawInputs) if (input.from !== undefined) supplied.set(input.key, (supplied.get(input.key) ?? 0) + input.perSecond);
  /** What the line buys of `key` a second: its `raw` flows less what it takes from supplies, when that is more than rounding. */
  const boughtOf = (key: StuffKey): number => {
    const raw = fromRaw.get(key) ?? 0;
    const share = Math.max(0, raw - (supplied.get(key) ?? 0));
    return share > ORPHAN_REL * raw ? share : 0;
  };
  const batchShort = new Set(plan.warnings.flatMap((w) => (w.code === 'batch-short' ? (w.keys ?? []) : [])));

  const inputs: PlanIndex['inputs'] = new Map();
  const outputs: PlanIndex['outputs'] = new Map();
  const made = new Map<StuffKey, Array<{ stepId: string; perSecond: number; main: boolean }>>();
  const issues: PlanIssue[] = [];
  for (const step of plan.steps) {
    const takes = perRun(step.inputs);
    const makes = perRun(step.outputs);
    const flowsIn = into.get(step.id);
    const ins = new Map<StuffKey, PortSide & { needPerSecond: number }>();
    for (const [key, amount] of takes) {
      const needPerSecond = Math.max(0, amount - (makes.get(key) ?? 0)) * step.runsPerSecond;
      const port = { ...portSide(flowsIn?.get(key)), needPerSecond };
      ins.set(key, port);
      if (!(needPerSecond > 0) || batchShort.has(key)) continue;
      const got = { needPerSecond, gotPerSecond: port.perSecond };
      if (port.perSecond <= ORPHAN_REL * needPerSecond) issues.push({ code: 'orphan-input', key, stepId: step.id, ...got });
      else if (port.perSecond < SHORT_INPUT_SHARE * needPerSecond) issues.push({ code: 'short-input', key, stepId: step.id, ...got });
    }
    for (const [key, peers] of flowsIn ?? []) if (!ins.has(key)) ins.set(key, { ...portSide(peers), needPerSecond: 0 });
    inputs.set(step.id, ins);

    const flowsOut = outOf.get(step.id);
    const outs = new Map<StuffKey, PortSide>();
    for (const key of makes.keys()) outs.set(key, portSide(flowsOut?.get(key)));
    for (const [key, peers] of flowsOut ?? []) if (!outs.has(key)) outs.set(key, portSide(peers));
    outputs.set(step.id, outs);

    for (const [key, amount] of makes) {
      if (!(amount > 0)) continue;
      let list = made.get(key);
      if (list === undefined) made.set(key, (list = []));
      list.push({ stepId: step.id, perSecond: amount * step.runsPerSecond, main: step.mainOutput === key });
    }
  }

  const producers: PlanIndex['producers'] = new Map();
  for (const [key, list] of made) {
    let total = 0;
    for (const p of list) total += p.perSecond;
    producers.set(key, list.map((p) => ({ ...p, share: total > 0 ? p.perSecond / total : 0 }))
      .sort((a, b) => b.perSecond - a.perSecond || byString(a.stepId, b.stepId))
      .map(({ stepId, perSecond, share, main }) => ({ stepId, perSecond, share, main })));
  }
  for (const [key, list] of producers) {
    const mains = list.filter((p) => p.main);
    const largest = mains[0];
    if (largest === undefined) continue;
    if (mains.length >= 2) {
      issues.push({ code: 'multi-producer', key, stepId: largest.stepId, stepIds: mains.map((p) => p.stepId), share: mains.map((p) => p.share) });
    }
    const buys = boughtOf(key);
    if (buys > 0) {
      let makesTotal = 0;
      for (const p of list) makesTotal += p.perSecond;
      issues.push({ code: 'bought-and-made', key, stepId: largest.stepId, stepIds: mains.map((p) => p.stepId), share: [buys / (buys + makesTotal)] });
    }
  }
  issues.sort((a, b) => byString(a.code, b.code) || byString(a.key, b.key) || byString(a.stepId ?? '', b.stepId ?? ''));
  return { inputs, outputs, producers, issues };
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`;
}

/**
 * The words of an issue (spec §6.4): goods by `plan.names`, a step as its machine and the name of its main output,
 * rates per hour and shares as `formatPercent` writes them.
 */
export function issueText(issue: PlanIssue, plan: Plan): string {
  const name = (key: StuffKey): string => plan.names?.[key] ?? key;
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const machine = (id: string): string => steps.get(id)?.machine.name ?? id;
  /** "Mixer (Glue)": the machine and what the step is for. */
  const stepWords = (id: string): string => {
    const main = steps.get(id)?.mainOutput;
    return main === undefined ? machine(id) : `${machine(id)} (${name(main)})`;
  };
  const good = name(issue.key);
  const at = issue.stepId ?? '';
  switch (issue.code) {
    case 'orphan-input': {
      const rate = formatRate(issue.needPerSecond ?? 0, 'hour', { fluid: isFluidKey(issue.key) });
      return `Nothing supplies ${good} to ${stepWords(at)}: it needs ${rate} and the plan neither makes nor buys it.`;
    }
    case 'short-input': {
      const need = issue.needPerSecond ?? 0;
      return `${stepWords(at)} gets only ${formatPercent(need > 0 ? (issue.gotPerSecond ?? 0) / need : 0)} of the ${good} it needs.`;
    }
    case 'multi-producer': {
      const ids = issue.stepIds ?? [];
      return `${good} is made ${ids.length} ways: ${listed(ids.map((id, i) => `${machine(id)} (${formatPercent(issue.share?.[i] ?? 0)})`))}.`;
    }
    case 'bought-and-made':
      // Two reactor recipes read "made by Large Chemical Reactor", once.
      return `${good} is both bought (${formatPercent(issue.share?.[0] ?? 0)}) and made by ${listed([...new Set((issue.stepIds ?? [at]).map(machine))])}.`;
  }
}
