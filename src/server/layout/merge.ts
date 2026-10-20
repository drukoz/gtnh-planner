// Merging a line layout into its plan (Plan 5 Task 11; spec §3.5, §3.10, architecture §11.13, §11.16): the server-side
// join the `planFinish` hook uses (Task 12). The plan takes the layout's power fit, its grouped parts (broken down to
// base materials by Plan 2's `expandBomLines`), less the structure casings the layout's hatches stand on, and its
// pin-linked build steps in place of Plan 2's generic place, power and logistics steps. Generator suggestions are only
// optional build-list lines: they never count towards the base-material totals. Each merged total keeps what every
// build line needs of it (`neededFor`, architecture §11.36). Pure: the inputs are not changed.

import type { StuffKey } from '../../shared/keys.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { BomLine, BuildStep, Plan, PlanWarning } from '../../shared/types/plan.ts';

// ---- Small helpers ----

/** Layout parts whose why starts with this are suggestions (generators), not parts the line needs. */
const OPTIONAL_PREFIX = 'optional:';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A layout part that is only a suggestion: it is never broken down to base materials (the layout service skips it too). */
export function isOptional(line: BomLine): boolean {
  return line.why.startsWith(OPTIONAL_PREFIX);
}

/**
 * A line being merged: the distinct non-empty whys in the order first seen, the first `have`, children and group set,
 * and what each build line needs of it (`BomLine.neededFor`, architecture §11.36) summed per key in the order first
 * seen — null once a merged line has no `neededFor`, as the amounts would no longer add up to `amount`.
 */
interface Draft {
  key: StuffKey; amount: number; whys: string[]; have?: BomLine['have']; children?: BomLine[]; group?: BomLine['group'];
  neededFor: Map<StuffKey, number> | null;
}

function draftOf(line: BomLine): Draft {
  return {
    key: line.key, amount: 0, whys: [],
    ...(line.have === undefined ? {} : { have: line.have }),
    ...(line.children === undefined ? {} : { children: line.children }),
    ...(line.group === undefined ? {} : { group: line.group }),
    neededFor: line.neededFor === undefined ? null : new Map(),
  };
}

function addTo(draft: Draft, line: BomLine): void {
  draft.amount += line.amount;
  if (line.why !== '' && !draft.whys.includes(line.why)) draft.whys.push(line.why);
  if (draft.have === undefined && line.have !== undefined) draft.have = line.have;
  if (draft.children === undefined && line.children !== undefined) draft.children = line.children;
  if (draft.group === undefined && line.group !== undefined) draft.group = line.group;
  if (line.neededFor === undefined) draft.neededFor = null;
  else if (draft.neededFor !== null) for (const n of line.neededFor) draft.neededFor.set(n.key, (draft.neededFor.get(n.key) ?? 0) + n.amount);
}

function lineOf(d: Draft): BomLine {
  return {
    key: d.key, amount: d.amount, why: d.whys.join('; '),
    ...(d.have === undefined ? {} : { have: d.have }),
    ...(d.children === undefined ? {} : { children: d.children.map((c) => ({ ...c })) }),
    ...(d.group === undefined ? {} : { group: d.group }),
    ...(d.neededFor === null ? {} : { neededFor: [...d.neededFor].map(([key, amount]) => ({ key, amount })) }),
  };
}

// ---- Build list ----

/**
 * One line per key over `a` then `b`: amounts summed, the distinct non-empty whys joined with "; " in the order first
 * seen, and the first `have`, `children` and group set (architecture §11.13); sorted by key. A total of base materials
 * keeps `neededFor` (architecture §11.36): the build lines that need it, by key in the order first seen, each one's
 * amounts summed, so they still add up to the merged amount; it is left out when one of the merged lines has none.
 */
export function mergeBom(a: readonly BomLine[], b: readonly BomLine[]): BomLine[] {
  const drafts = new Map<StuffKey, Draft>();
  for (const line of [...a, ...b]) {
    let draft = drafts.get(line.key);
    if (draft === undefined) {
      draft = draftOf(line);
      drafts.set(line.key, draft);
    }
    addTo(draft, line);
  }
  return [...drafts.values()].sort((x, y) => compareText(x.key, y.key)).map(lineOf);
}

/**
 * Plan 2 lists every exported structure casing (`structure of <n>× <name>`), but the layout's hatches stand on some
 * of those cells: each replaced amount is taken off the lines with its key, in list order, never below 0. A line that
 * reaches 0 is dropped; a reduced line's children scale to `ceil(child × new / old)`. Other lines are kept as they are.
 */
export function subtractReplaced(lines: readonly BomLine[], replaced: readonly BomLine[]): BomLine[] {
  const left = new Map<StuffKey, number>();
  for (const r of replaced) left.set(r.key, (left.get(r.key) ?? 0) + r.amount);
  const out: BomLine[] = [];
  for (const line of lines) {
    const take = Math.min(left.get(line.key) ?? 0, line.amount);
    if (take <= 0) {
      out.push(line);
      continue;
    }
    left.set(line.key, left.get(line.key)! - take);
    const amount = line.amount - take;
    if (amount <= 0) continue;
    out.push({
      ...line, amount,
      ...(line.children === undefined ? {} : { children: line.children.map((c) => ({ ...c, amount: Math.ceil((c.amount * amount) / line.amount) })) }),
    });
  }
  return out;
}

/** `lines` with each optional line merged into the line of its key, or appended in order when there is none. */
function addOptional(lines: readonly BomLine[], optional: readonly BomLine[]): BomLine[] {
  const out = [...lines];
  for (const o of optional) {
    const i = out.findIndex((l) => l.key === o.key);
    if (i === -1) {
      out.push({ ...o });
      continue;
    }
    const draft = draftOf(out[i]!);
    addTo(draft, out[i]!);
    addTo(draft, o);
    out[i] = lineOf(draft);
  }
  return out;
}

// ---- Build steps ----

const BEFORE_LAYOUT: ReadonlySet<BuildStep['kind']> = new Set<BuildStep['kind']>(['gather', 'craft']);
const AFTER_LAYOUT: ReadonlySet<BuildStep['kind']> = new Set<BuildStep['kind']>(['configure', 'handcraft', 'test']);

/**
 * With layout steps: the plan's gather and craft steps, the layout steps, then the plan's configure, handcraft and
 * test steps — Plan 2's generic place, power and logistics steps are left out, since the layout's say where — with
 * `order` renumbered from 1. Without layout steps the plan's steps as they are.
 */
export function mergeBuildSteps(planSteps: readonly BuildStep[], layoutSteps: readonly BuildStep[]): BuildStep[] {
  if (layoutSteps.length === 0) return [...planSteps];
  const steps = [
    ...planSteps.filter((s) => BEFORE_LAYOUT.has(s.kind)),
    ...layoutSteps,
    ...planSteps.filter((s) => AFTER_LAYOUT.has(s.kind)),
  ];
  return steps.map((s, i): BuildStep => ({ ...s, order: i + 1 }));
}

// ---- Plan ----

function warningKey(w: PlanWarning): string {
  return `${w.code}\n${w.text}`;
}

/** Every key of `lines` and of their children. */
function keysOf(lines: readonly BomLine[]): StuffKey[] {
  return lines.flatMap((l) => [l.key, ...(l.children ?? []).map((c) => c.key)]);
}

/**
 * Spec §3.10, architecture §11.16: a plan with something to build gets the layout's power fit, its parts in the build
 * list — `expanded` is `expandBomLines` of the layout's required (non-optional) parts, or null to take those parts as
 * they are — with the replaced casings taken off and the optional generator lines appended, the base materials of the
 * expanded parts in `buildTotals`, the layout's build steps, its warnings not already there (code + text) and a name
 * (`nameOf`) for every key it adds; and with `layoutCost` (plan 12, architecture §11 entry 39: the raw material of the
 * layout's parts other than its hatches) a plan that has a `cost` gets it as `cost.layout`. A plan whose status is not
 * `ok` is returned unchanged.
 */
export function mergeLayoutIntoPlan(plan: Plan, layout: Layout, expanded: { lines: BomLine[]; totals: BomLine[] } | null,
  nameOf: (k: StuffKey) => string, layoutCost?: number): Plan {
  if ((plan.status ?? 'ok') !== 'ok') return plan;
  const required = layout.bom.filter((l) => !isOptional(l));
  const optional = layout.bom.filter(isOptional);
  const buildList = addOptional(mergeBom(subtractReplaced(plan.buildList, layout.replaced ?? []), expanded?.lines ?? required), optional);
  const buildTotals = mergeBom(plan.buildTotals ?? [], expanded?.totals ?? []);
  const seen = new Set(plan.warnings.map(warningKey));
  const warnings = [...plan.warnings];
  for (const w of layout.warnings) {
    if (seen.has(warningKey(w))) continue;
    seen.add(warningKey(w));
    warnings.push(w);
  }
  const names: Record<string, string> = { ...plan.names };
  for (const key of [...keysOf(buildList), ...keysOf(buildTotals)]) if (!Object.hasOwn(names, key)) names[key] = nameOf(key);
  return {
    ...plan, power: layout.power ?? plan.power, buildList, buildTotals, buildSteps: mergeBuildSteps(plan.buildSteps, layout.buildSteps), warnings, names,
    ...(plan.cost === undefined || layoutCost === undefined ? {} : { cost: { ...plan.cost, layout: layoutCost } }),
  };
}
