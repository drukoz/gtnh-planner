// Numbered pins of a line layout (Plan 5 Task 10; spec §3.7): where to build, where to tap power, where to hook into
// the base's logistics, which owned machines to reuse, and where a warning applies. Numbers run from 1 in that order,
// so the build steps can say "at pin <n>". Also the owned machines the line reuses, found in the scanned base. Every
// order and tie-break is fixed, so the same inputs give the same pins.

import { tierName } from '../../shared/gt/tiers.ts';
import { fmtInt, NETWORK_NAMES } from '../../shared/layout/format.ts';
import { manhattan, posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { Pin } from '../../shared/types/layout.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { Plan, PlanStep } from '../../shared/types/plan.ts';
import type { Base, LogisticsNetwork, TapPoint, WorldScan } from '../../shared/types/world.ts';
import { stepProductName } from '../planner/bom.ts';

// ---- Types ----

/** Owned machines of one plan step, nearest first; `count` is the planner's (`PlanStep.owned`). */
export interface ReuseFind {
  stepId: string; name: string; count: number; positions: Vec3[];
  // optional additions (plan 12, architecture §11 entry 39)
  /** What the step makes (`stepProductName`), for the hook step of a machine several steps share. */
  product?: string;
  /** The type of an owned machine of another option that runs the step beside its own (`PlanStep.reused.others`). */
  otherMteId?: number;
  /**
   * The planner's units of the find (`PlanStep.reused.units`, or its `others` entry's) that have no machine in this base
   * (owned elsewhere, or on the "Machines we have" list); absent when every one stands here. A group of finds that share
   * machines (`reuseGroups`) counts each of its machines once, these too (controller ruling 215).
   */
  elsewhere?: number[];
}

export interface PinInput {
  dim: number; site: { center: Vec3; text: string } | null; power: { pos: Vec3; text: string } | null;
  logistics: { pos: Vec3; text: string } | null; reuse: readonly ReuseFind[]; warnings: ReadonlyArray<{ code: string; text: string; pos: Vec3 }>;
}

// ---- Small helpers ----

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- Reuse ----

/**
 * Spec §3.3, §3.7: the base's machines (same base and dimension) a plan step reuses, nearest to `near` first (manhattan,
 * ties by posKey). A step with the planner's units (`PlanStep.reused.units`, plan 12, architecture §11 entry 39) runs on
 * those: per mteId the distinct unit indices in the order the steps (by id) first use them — a step's own units, then
 * each of its `reused.others` entries' — are that type's machines nearest the site, one index one machine, so a machine
 * several steps share is the same one for each and stands nearest the line, whatever the planner's pool order; an index
 * past the base's machines of the type (an owned machine elsewhere, or one of the "Machines we have" list) has no
 * position. Such a step gives a find for its own type (`count` its `owned`, positions its units' machines) and one per
 * `others` entry (`count` its units, `otherMteId` its type), each with the step's `product` and its units without a
 * machine here (`elsewhere`, when it has any); a find without positions is left out, and such a step never takes
 * another machine of the base. A step without units takes, as Plan 2 lets each
 * owned machine serve one step, at most `owned` of the type's machines no other step has, nearest first. Steps by id;
 * a step with no machine found is left out: the planner may count owned machines that stand outside this base.
 */
export function findReuse(pack: Pack, plan: Plan, scan: WorldScan, base: Base | null, near: Vec3): ReuseFind[] {
  if (base === null) return [];
  const nearest = (a: Vec3, b: Vec3) => manhattan(a, near) - manhattan(b, near) || compareText(posKey(a), posKey(b));
  const pools = new Map<number, Vec3[]>();
  const poolOf = (mteId: number): Vec3[] => {
    let pool = pools.get(mteId);
    if (pool === undefined) {
      pool = scan.machines
        .filter((m) => m.mteId === mteId && m.baseId === base.id && m.dim === base.dim)
        .map((m): Vec3 => [...m.pos])
        .sort(nearest);
      pools.set(mteId, pool);
    }
    return pool;
  };
  const steps = [...plan.steps].sort((a, b) => compareText(a.id, b.id));
  /** What a step with the planner's units runs on: its own type's units, then each other option's. */
  const usesOf = (s: PlanStep): Array<{ mteId: number; units: readonly number[] }> => [
    { mteId: s.machine.mteId, units: s.reused?.units ?? [] }, ...(s.reused?.others ?? []).map((o) => ({ mteId: o.mteId, units: o.units ?? [] })),
  ];
  const firstUse = new Map<number, number[]>();
  for (const s of steps) {
    if (s.reused?.units === undefined) continue;
    for (const { mteId, units } of usesOf(s)) {
      let order = firstUse.get(mteId);
      if (order === undefined) firstUse.set(mteId, (order = []));
      for (const unit of units) if (!order.includes(unit)) order.push(unit);
    }
  }
  /** The machines of the planner's units of `mteId`, nearest first, and the units with no machine in this base. */
  const machinesOf = (mteId: number, units: readonly number[]): { at: Vec3[]; elsewhere: number[] } => {
    const at: Vec3[] = [];
    const elsewhere: number[] = [];
    for (const unit of units) {
      const pos = poolOf(mteId)[firstUse.get(mteId)?.indexOf(unit) ?? -1];
      if (pos === undefined) elsewhere.push(unit);
      else at.push([...pos]);
    }
    return { at: at.sort(nearest), elsewhere };
  };
  /** A unit find: its positions, and the units standing elsewhere when it has any. */
  const unitFind = (find: ReuseFind, elsewhere: readonly number[]): ReuseFind => (elsewhere.length === 0 ? find : { ...find, elsewhere: [...elsewhere] });
  /** Per type, the machines none of the planner's units took, for the steps without units. */
  const free = new Map<number, Vec3[]>();
  const freeOf = (mteId: number): Vec3[] => {
    let list = free.get(mteId);
    if (list === undefined) free.set(mteId, (list = poolOf(mteId).slice(firstUse.get(mteId)?.length ?? 0)));
    return list;
  };
  const nameOf = (mteId: number, fallback: string): string => pack.machines.get(mteId)?.name ?? fallback;
  const out: ReuseFind[] = [];
  for (const s of steps) {
    if (s.reused?.units !== undefined) {
      const product = stepProductName(pack, s);
      const own = machinesOf(s.machine.mteId, s.reused.units);
      if (own.at.length > 0) {
        out.push(unitFind({ stepId: s.id, name: nameOf(s.machine.mteId, s.machine.name), count: s.owned, positions: own.at, product }, own.elsewhere));
      }
      for (const o of s.reused.others ?? []) {
        const units = o.units ?? [];
        const other = machinesOf(o.mteId, units);
        if (other.at.length > 0) {
          out.push(unitFind({ stepId: s.id, name: nameOf(o.mteId, o.name), count: units.length, positions: other.at, product, otherMteId: o.mteId }, other.elsewhere));
        }
      }
      continue;
    }
    if (s.owned <= 0) continue;
    const positions = freeOf(s.machine.mteId).splice(0, s.owned);
    if (positions.length === 0) continue;
    out.push({ stepId: s.id, name: nameOf(s.machine.mteId, s.machine.name), count: s.owned, positions });
  }
  return out;
}

/** The text of a reuse pin. */
export function reuseText(find: ReuseFind): string {
  return `Reuse your ${fmtInt(find.count)}× ${find.name}`;
}

/** Reuse finds that share owned machines (`reuseGroups`), where they meet, and how many machines they run on. */
export interface ReuseGroup { at: Vec3 | null; finds: ReuseFind[]; count: number }

/**
 * The reuse finds by the owned machines they run on (plan 12; controller ruling 215): finds that share any machine (any
 * of their positions), directly or through other finds, form one group, in the order of their first find; a find without
 * positions is a group alone, at null. A group stands at its first find's first machine, which is its machine nearest
 * the site (`findReuse` maps the units in the order the steps first use them onto the machines nearest the site, and
 * gives a find's positions nearest first), so every machine is in one group; `count` is the group's distinct machines —
 * each position once, and each unit with no machine in this base (`ReuseFind.elsewhere`) once — and a group of one find
 * keeps that find's `count`. `makePins` gives each group with a position one reuse pin, `layoutSteps` each group one
 * hook step.
 */
export function reuseGroups(finds: readonly ReuseFind[]): ReuseGroup[] {
  // union-find over the finds, joined where two hold one position
  const parent = finds.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    for (let j = i; parent[j] !== r;) {
      const next = parent[j] as number;
      parent[j] = r;
      j = next;
    }
    return r;
  };
  const holder = new Map<string, number>();
  finds.forEach((find, i) => {
    for (const pos of find.positions) {
      const key = posKey(pos);
      const other = holder.get(key);
      if (other === undefined) {
        holder.set(key, i);
        continue;
      }
      const [a, b] = [root(other), root(i)];
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  const byRoot = new Map<number, ReuseFind[]>();
  finds.forEach((find, i) => {
    const r = root(i);
    const list = byRoot.get(r);
    if (list === undefined) byRoot.set(r, [find]);
    else list.push(find);
  });
  return [...byRoot.keys()].sort((a, b) => a - b).map((r) => {
    const members = byRoot.get(r) as ReuseFind[];
    const first = members[0] as ReuseFind;
    const at = first.positions[0];
    const count = members.length === 1 ? first.count
      : new Set(members.flatMap((f) => f.positions.map(posKey))).size + new Set(members.flatMap((f) => f.elsewhere ?? [])).size;
    return { at: at === undefined ? null : ([...at] as Vec3), finds: members, count };
  });
}

/** The distinct steps of a reuse group's finds, in find order. */
export function groupSteps(finds: readonly ReuseFind[]): string[] {
  return [...new Set(finds.map((f) => f.stepId))];
}

// ---- Pins ----

/**
 * Pins numbered from 1: the site, the power tap, the logistics tap, one reuse pin per group of reuse finds
 * (`reuseGroups`: finds that share owned machines, at their machine nearest the site, so at most one reuse pin per
 * position; its text `reuseText` of the first find with the group's machine count, plus ` (shared by <n> steps)` when
 * its finds belong to n > 1 steps, controller ruling 215), then the warnings by code and posKey. Every pin carries `dim`.
 */
export function makePins(input: PinInput): Pin[] {
  const pins: Pin[] = [];
  const add = (pos: Vec3, kind: Pin['kind'], text: string): void => {
    pins.push({ n: pins.length + 1, dim: input.dim, pos: [...pos], kind, text });
  };
  if (input.site !== null) add(input.site.center, 'site', input.site.text);
  if (input.power !== null) add(input.power.pos, 'power', input.power.text);
  if (input.logistics !== null) add(input.logistics.pos, 'logistics', input.logistics.text);
  for (const { at, finds, count } of reuseGroups(input.reuse)) {
    if (at === null) continue;
    const steps = groupSteps(finds).length;
    add(at, 'reuse', `${reuseText({ ...finds[0]!, count })}${steps > 1 ? ` (shared by ${fmtInt(steps)} steps)` : ''}`);
  }
  const warnings = [...input.warnings].sort((a, b) => compareText(a.code, b.code) || compareText(posKey(a.pos), posKey(b.pos)));
  for (const w of warnings) add(w.pos, 'warning', w.text);
  return pins;
}

/** The number of the first pin of `kind`; undefined when there is none (e.g. no world). */
export function pinNumber(pins: readonly Pin[], kind: Pin['kind']): number | undefined {
  return pins.find((p) => p.kind === kind)?.n;
}

/** `size` is the world `[W, H, L]`. */
export function siteText(size: Vec3): string {
  return `Build the line here (${fmtInt(size[0])}×${fmtInt(size[2])}, ${fmtInt(size[1])} high)`;
}

/** A tap whose voltage or free amps Plan 4 could not read says so instead of guessing. */
export function powerText(tap: TapPoint, amps: number): string {
  const tier = tap.voltageTier === undefined ? '' : `${tierName(tap.voltageTier)}, `;
  const free = tap.freeAmps === undefined ? 'free amps unknown' : `${fmtInt(tap.freeAmps)} A free`;
  return `Tap power here: ${tier}${free} (the line needs ${fmtInt(amps)} A)`;
}

/** The name of a logistics network kind, as the build steps and pins write it (`NETWORK_NAMES`, shared with the Connections view). */
export function networkName(kind: LogisticsNetwork['kind']): string {
  return NETWORK_NAMES[kind];
}

export function logisticsText(kind: LogisticsNetwork['kind']): string {
  return `Hook logistics here: ${networkName(kind)} network`;
}
