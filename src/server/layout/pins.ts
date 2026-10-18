// Numbered pins of a line layout (Plan 5 Task 10; spec §3.7): where to build, where to tap power, where to hook into
// the base's logistics, which owned machines to reuse, and where a warning applies. Numbers run from 1 in that order,
// so the build steps can say "at pin <n>". Also the owned machines the line reuses, found in the scanned base. Every
// order and tie-break is fixed, so the same inputs give the same pins.

import { tierName } from '../../shared/gt/tiers.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import { manhattan, posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { Pin } from '../../shared/types/layout.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { Plan } from '../../shared/types/plan.ts';
import type { Base, LogisticsNetwork, TapPoint, WorldScan } from '../../shared/types/world.ts';

// ---- Types ----

/** Owned machines of one plan step, nearest first; `count` is the planner's (`PlanStep.owned`). */
export interface ReuseFind { stepId: string; name: string; count: number; positions: Vec3[] }

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
 * Spec §3.3, §3.7: per plan step with `owned > 0`, by step id, the base's machines of that type (same base and
 * dimension) nearest to `near` (manhattan, ties by posKey), at most `owned`. Plan 2 lets each owned machine serve one
 * step, so a machine found for one step is not offered to the next step of the same type. Steps with no machine
 * found are left out: the planner may count owned machines that stand outside this base.
 */
export function findReuse(pack: Pack, plan: Plan, scan: WorldScan, base: Base | null, near: Vec3): ReuseFind[] {
  if (base === null) return [];
  const pools = new Map<number, Vec3[]>();
  const poolOf = (mteId: number): Vec3[] => {
    let pool = pools.get(mteId);
    if (pool === undefined) {
      pool = scan.machines
        .filter((m) => m.mteId === mteId && m.baseId === base.id && m.dim === base.dim)
        .map((m): Vec3 => [...m.pos])
        .sort((a, b) => manhattan(a, near) - manhattan(b, near) || compareText(posKey(a), posKey(b)));
      pools.set(mteId, pool);
    }
    return pool;
  };
  const out: ReuseFind[] = [];
  for (const s of plan.steps.filter((st) => st.owned > 0).sort((a, b) => compareText(a.id, b.id))) {
    const positions = poolOf(s.machine.mteId).splice(0, s.owned);
    if (positions.length === 0) continue;
    out.push({ stepId: s.id, name: pack.machines.get(s.machine.mteId)?.name ?? s.machine.name, count: s.owned, positions });
  }
  return out;
}

/** The text of a reuse pin. */
export function reuseText(find: ReuseFind): string {
  return `Reuse your ${fmtInt(find.count)}× ${find.name}`;
}

// ---- Pins ----

/**
 * Pins numbered from 1: the site, the power tap, the logistics tap, one per reuse find (at its nearest machine), then
 * the warnings by code and posKey. Every pin carries `dim`.
 */
export function makePins(input: PinInput): Pin[] {
  const pins: Pin[] = [];
  const add = (pos: Vec3, kind: Pin['kind'], text: string): void => {
    pins.push({ n: pins.length + 1, dim: input.dim, pos: [...pos], kind, text });
  };
  if (input.site !== null) add(input.site.center, 'site', input.site.text);
  if (input.power !== null) add(input.power.pos, 'power', input.power.text);
  if (input.logistics !== null) add(input.logistics.pos, 'logistics', input.logistics.text);
  for (const find of input.reuse) {
    const at = find.positions[0];
    if (at !== undefined) add(at, 'reuse', reuseText(find));
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

const NETWORK_NAMES: Readonly<Record<LogisticsNetwork['kind'], string>> = {
  routed: 'Project Red routed', ae2: 'AE2', gtpipe: 'GT pipe', enderio: 'EnderIO',
};

/** The name of a logistics network kind, as the build steps and pins write it. */
export function networkName(kind: LogisticsNetwork['kind']): string {
  return NETWORK_NAMES[kind];
}

export function logisticsText(kind: LogisticsNetwork['kind']): string {
  return `Hook logistics here: ${networkName(kind)} network`;
}
