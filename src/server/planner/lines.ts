// Supporting lines (fix spec R6, architecture §11.27 and §11.32): the steps of a plan that only serve a derived material
// the main line uses (an alloy, a plastic, a chemical) form that material's supporting line, so the flow diagram can
// group and collapse them, the panels can label them, and "we already make this" can turn one into an import.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { Plan, PlanStep } from '../../shared/types/plan.ts';
import { isBaseItem } from './availability.ts';
import type { PlanBasis } from './basis.ts';
import { moltenMaterial } from './costs.ts';

/** The supporting line of a step: the material it ultimately serves, and that material's name. */
export type SupportingLine = NonNullable<PlanStep['line']>;

/** The flow ends that are not steps (machines.ts `buildFlows`). */
const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The line's name for its root: the display name of the root's GT material for a GT item or a molten fluid ("Red
 * Alloy" for `fluid:molten.redalloy`), else the root's own name.
 */
function lineName(pack: Pack, root: StuffKey): string {
  const material = isFluidKey(root) ? moltenMaterial(pack, root) : pack.items.get(root)?.gt?.material;
  return material === undefined ? pack.nameOf(root) : (pack.materials.get(material)?.displayName ?? material);
}

/**
 * The supporting line of each step that has one, by step id in step order (fix spec R6), from the plan's steps and flows:
 * 1. A material is a good other than the target that availability calls derived (`basis.avail.classOf`) and that is a
 *    base item (a GT dust, ingot or gem, or a material's base part) or a fluid.
 * 2. The candidate roots are the materials some step makes as its main output that flow to the target's `out` or to a
 *    step whose main output is no material: what the main line takes.
 * 3. A step whose main output is a root is in that root's line; any other step is in the one line all the steps its
 *    outputs flow to share (flows to `sink` aside), else in the main line (an output to `out`, two lines, or none).
 *    A loop of steps waiting on each other is in the main line.
 * 4. A fluid root whose line has one step (molten glass, glue) is no root after all, and 3 runs again without it.
 * Main-line steps have none.
 */
export function supportingLines(pack: Pack, plan: Plan, basis: PlanBasis): Map<string, SupportingLine> {
  const target = plan.target;
  const kinds = new Map<StuffKey, boolean>();
  const isMaterial = (key: StuffKey | undefined): boolean => {
    if (key === undefined) return false;
    let material = kinds.get(key);
    if (material === undefined) {
      material = key !== target && basis.avail.classOf(key) === 'derived' && (isFluidKey(key) || isBaseItem(pack, key));
      kinds.set(key, material);
    }
    return material;
  };
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const mainOf = (id: string): StuffKey | undefined => steps.get(id)?.mainOutput;
  /** Where each step's outputs go: step ids or `out`. */
  const downstream = new Map<string, string[]>();
  for (const f of plan.flows) if (steps.has(f.from) && f.to !== SINK) pushTo(downstream, f.from, f.to);

  const candidates = new Set<StuffKey>();
  for (const f of plan.flows) {
    const takenByMain = f.to === OUT || (steps.has(f.to) && !isMaterial(mainOf(f.to)));
    if (f.from === RAW || !takenByMain || !isMaterial(f.key)) continue;
    if (plan.steps.some((s) => s.mainOutput === f.key)) candidates.add(f.key);
  }

  /** Each step's line (null: the main line) for the roots `roots`. */
  const linesFor = (roots: ReadonlySet<StuffKey>): Map<string, StuffKey | null> => {
    const lines = new Map<string, StuffKey | null>();
    const open = new Set<string>();
    const lineOf = (id: string): StuffKey | null => {
      const known = lines.get(id);
      if (known !== undefined) return known;
      if (open.has(id)) return null;   // a loop: the main line
      const main = mainOf(id);
      if (main !== undefined && roots.has(main)) {
        lines.set(id, main);
        return main;
      }
      open.add(id);
      let line: StuffKey | null | undefined;
      for (const to of downstream.get(id) ?? []) {
        const next = to === OUT || !steps.has(to) ? null : lineOf(to);
        line = line === undefined || line === next ? next : null;
        if (line === null) break;
      }
      open.delete(id);
      lines.set(id, line ?? null);
      return line ?? null;
    };
    for (const s of plan.steps) lineOf(s.id);
    return lines;
  };

  let lines = linesFor(candidates);
  const size = (root: StuffKey): number => [...lines.values()].filter((line) => line === root).length;
  const single = [...candidates].filter((root) => isFluidKey(root) && size(root) === 1);
  if (single.length > 0) lines = linesFor(new Set([...candidates].filter((root) => !single.includes(root))));

  const names = new Map<StuffKey, string>();
  const out = new Map<string, SupportingLine>();
  for (const s of plan.steps) {
    const root = lines.get(s.id) ?? null;
    if (root === null) continue;
    let name = names.get(root);
    if (name === undefined) {
      name = lineName(pack, root);
      names.set(root, name);
    }
    out.set(s.id, { key: root, name });
  }
  return out;
}
