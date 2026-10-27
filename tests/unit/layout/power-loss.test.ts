// RUK-117 baseline: what the standard 10/20/40-machine lines lose in cables, per logistics mode, and the wiring
// properties the loss measurement relies on. The budget is today's measurement rounded up to two decimals — it may
// only ever be LOWERED. If a line loses more, the routing got worse; if it loses less, lower the number.
import { describe, it, expect } from 'vitest';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { deliveredVolts } from '../../../src/server/layout/power.ts';
import { runX } from '../../../src/server/layout/internal.ts';
import { lossLine, measureLoss, overlaps, SUPPLY_TIER, tierContacts } from '../../helpers/power-loss.ts';

// measured 2026-10-27 on this branch, rounded up to two decimals; may only ever be lowered
const BUDGET: Readonly<Record<string, number>> = {
  '10 direct': 0.80, '10 routed': 1.01, '10 ae2': 1.68, '10 enderio': 0.80,
  '20 direct': 1.01, '20 routed': 1.81, '20 ae2': 18.26, '20 enderio': 1.01,
  '40 direct': 1.81, '40 routed': 19.09, '40 ae2': 45.63, '40 enderio': 1.81,
};

const GT_VOLTS = (tier: number): number => 8 * 4 ** tier;   // ULV 8, LV 32, MV 128

/** Hops by which the machine's port cable reaches its tier's run column walking only that tier's connected cables; null when unwired. */
function hopsToRun(blocks: { pos: Vec3; role: string; label: string; connections?: number }[], from: Vec3, label: string, x: number): number | null {
  const cables = new Map(blocks.filter((b) => b.role === 'cable' && b.label === label).map((b) => [posKey(b.pos), b]));
  const seen = new Set<string>([posKey(from)]);
  let queue: Vec3[] = [from];
  for (let hops = 0; queue.length > 0; hops++) {
    const next: Vec3[] = [];
    for (const p of queue) {
      if (p[0] === x && p[1] === 0) return hops;
      const b = cables.get(posKey(p));
      if (b === undefined) continue;
      for (let s = 0; s < DIRS.length; s++) {
        const q = step(p, s);
        if (!seen.has(posKey(q))) { seen.add(posKey(q)); next.push(q); }
      }
    }
    queue = next;
  }
  return null;
}

const COUNTS = [10, 20, 40] as const;
const MODES = ['direct', 'routed', 'ae2', 'enderio'] as const;

describe('line cable loss baseline', () => {
  for (const n of COUNTS) {
    for (const mode of MODES) {
      it(`the ${n}-machine ${mode} line stays within its loss budget`, async () => {
        const report = await measureLoss(n, mode);
        const { layout } = await lossLine(n, mode);
        expect(layout.status).toBe('ok');
        expect(overlaps(layout.blocks)).toEqual([]);
        expect(report.cableCells).toBeGreaterThan(0);
        expect(report.share).toBeLessThanOrEqual(BUDGET[`${n} ${mode}`]!);
      });
    }
  }
});

describe('loss lines stay wired', () => {
  for (const n of COUNTS) {
    for (const mode of MODES) {
      it(`the ${n}-machine ${mode} line wires every machine from its own tier at 1 V or more`, async () => {
        const { plan, placement, internal } = await lossLine(n, mode);
        expect(tierContacts(internal.blocks, internal.cables, placement)).toEqual([]);
        const electric = placement.units.filter((u) => u.electric);
        expect(electric).toHaveLength(plan.steps.reduce((s, st) => s + st.count, 0));
        for (const u of electric) {
          expect(u.tier, u.name).toBeLessThanOrEqual(SUPPLY_TIER);
          const feedTier = Math.min(u.tier, SUPPLY_TIER);
          const entry = internal.cables.find((c) => c.tier === feedTier);
          expect(entry, `${u.name}: no ${feedTier}-tier cable run`).toBeDefined();
          const hops = hopsToRun(internal.blocks, u.ports.power!, entry!.cable.name, runX(SUPPLY_TIER, feedTier));
          expect(hops, `${u.name}: port cable does not reach the ${feedTier}-tier run`).not.toBeNull();
          const amps = Math.ceil(u.euPerTick / deliveredVolts(GT_VOLTS(feedTier), 0));
          const volts = deliveredVolts(GT_VOLTS(feedTier), amps * hops! * (entry!.cable.cable?.lossPerBlock ?? 0));
          expect(volts, `${u.name}: fed with ${volts} V`).toBeGreaterThanOrEqual(1);
        }
      });
    }
  }
});
