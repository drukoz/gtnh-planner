// RUK-117 baseline: what the standard 10/20/40-machine lines lose in cables, per logistics mode, and the wiring
// properties the loss measurement relies on. The budget is today's measurement rounded up to two decimals — it may
// only ever be LOWERED. If a line loses more, the routing got worse; if it loses less, lower the number.
import { describe, it, expect } from 'vitest';
import { DIRS, posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { deliveredVolts } from '../../../src/server/layout/power.ts';
import { runX } from '../../../src/server/layout/internal.ts';
import { lossLine, measureLoss, overlaps, SUPPLY_TIER, tierContacts } from '../../helpers/power-loss.ts';

// measured 2026-10-30 on this branch (RUK-124, commit 10883cace), rounded up to two decimals; may only ever be lowered
const BUDGET: Readonly<Record<string, number>> = {
  '10 direct': 0.84, '10 routed': 0.97, '10 ae2': 1.63, '10 enderio': 0.84,
  '20 direct': 0.97, '20 routed': 1.76, '20 ae2': 18.00, '20 enderio': 0.97,
  '40 direct': 1.76, '40 routed': 18.82, '40 ae2': 51.89, '40 enderio': 1.76,
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
        const { report, layout } = await measureLoss(n, mode);
        expect(layout.status).toBe('ok');
        expect(overlaps(layout.blocks)).toEqual([]);
        // a line that fell back to an unplaced site or could not reach the tap measures nothing real
        expect(report.codes, `${n} ${mode}: no site was clear`).not.toContain('site_not_clear');
        expect(report.codes, `${n} ${mode}: no hookup routed`).not.toContain('no_path');
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
