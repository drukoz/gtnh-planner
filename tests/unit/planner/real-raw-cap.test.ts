// Real-data acceptance of fix wave 3's raw cap and step-charge base (A), (B2), and MV circuit's oxygen (C), on the
// active export: the user's poly line (Molten Polyethylene 1 L a minute at HV on EnderIO, the four machines its plan
// reuses listed as "Machines we have") keeps its Rubber Wood line, whose least raw material needs a Raw Oil line nobody
// would build; and the user's MV circuit line (Electronic Circuit 1 a minute at MV on EnderIO) is held within +25 % of
// its leanest line and buys no more Phosphate Dust over its build horizon than the group has in storage (737bcd0 bought
// 3,600 a day at 2.67 × the least, against 164 stored). With nothing in storage (an empty context), neither it nor 2 Good
// Electronic Circuits a minute at HV buys 1,000 a day or more of any byproduct-only good, which costs BEYOND_STOCK_FACTOR
// times its price beyond the stock (fix wave 3 (C), controller OQ2), at the default raw cap or at "No limit". It runs
// only with GTNH_LOCAL=1 and logs only counts, keys and figures.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { emptyContext, planLine } from '../../../src/server/planner/plan.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';

const MOLTEN_POLYETHYLENE = 'fluid:molten.plastic';
const RUBBER_WOOD = 'IC2:blockRubWood@0';
const RAW_OIL = 'fluid:liquid_medium_oil';
const ELECTRONIC_CIRCUIT = 'IC2:itemPartCircuit@0';
const GOOD_ELECTRONIC_CIRCUIT = 'gregtech:gt.metaitem.01@32702';
const PHOSPHATE_DUST = 'gregtech:gt.metaitem.01@2833';
/** The Phosphate Dust in the group's storage at the user's scan the ledger quotes (line 247: "3,600 a day against 164 in storage"). */
const PHOSPHATE_DUST_STOCK = 164;
const SECONDS_PER_DAY = 86_400;
/** Fix wave 3 (C)'s pins (controller OQ2): no byproduct-only good bought beyond the stock at this many a day or more. */
const BEYOND_STOCK_PER_DAY = 1000;
/** The machines the user's poly plan reuses (the live scan's): Steam Separator, Advanced Compressor, Basic Chemical Reactor, Pyrolyse Oven. */
const POLY_OWNED = [{ mteId: 31080, count: 1 }, { mteId: 242, count: 1 }, { mteId: 421, count: 1 }, { mteId: 15546, count: 1 }];

const poly = (more: Partial<PlanSettings> = {}): PlanSettings => ({
  ...defaultSettings(), target: MOLTEN_POLYETHYLENE, amount: 1, per: 'min', tier: 3, logistics: 'enderio', ownedManual: POLY_OWNED, ...more,
});
/** The user's MV circuit project's settings (the live project, 2026-10-22), at the default raw cap. */
const mvCircuit = (more: Partial<PlanSettings> = {}): PlanSettings => ({
  ...defaultSettings(), target: ELECTRONIC_CIRCUIT, amount: 1, per: 'min', tier: 2, logistics: 'enderio', routeDerived: true,
  stopItems: [ELECTRONIC_CIRCUIT], optionChoice: { 'c0106c4cb6b4b041#100': 'fluid:molten.tin' }, reuseOwned: false, stepCharge: 0.5, ...more,
});

/** 2 Good Electronic Circuits a minute at HV at the default settings (real-build-cost's `at(GOOD_ELECTRONIC_CIRCUIT, 3, 2)`). */
const gec = (more: Partial<PlanSettings> = {}): PlanSettings => ({
  ...defaultSettings(), per: 'min', target: GOOD_ELECTRONIC_CIRCUIT, tier: 3, amount: 2, ...more,
});

/** The byproduct-only goods `plan` buys at BEYOND_STOCK_PER_DAY a day or more, all beyond the stock of an empty context. */
const beyondStock = (plan: Plan): string[] => plan.rawInputs
  .filter((r) => r.leafClass === 'byproduct' && r.perSecond * SECONDS_PER_DAY >= BEYOND_STOCK_PER_DAY)
  .map((r) => `${r.key} ${(r.perSecond * SECONDS_PER_DAY).toFixed(1)} a day`);

const newBlocks = (plan: Plan): number => {
  const pools = new Set<string>();
  let n = 0;
  for (const s of plan.steps) {
    if (s.machine.mteId < 0) continue;
    if (s.pool !== undefined) {
      if (pools.has(s.pool.id)) continue;
      pools.add(s.pool.id);
    }
    n += Math.max(0, s.count - s.owned);
  }
  return n;
};
const line = (name: string, plan: Plan): string => {
  const raw = plan.rawCost;
  return `real-raw-cap ${name}: ${plan.status}, ${plan.steps.length} steps, ${newBlocks(plan)} new blocks, raw ${raw?.perSecond} a second`
    + ` (least ${raw?.leastPerSecond}, leanest ${raw?.leanestPerSecond}), build ${plan.cost?.build},`
    + ` raw inputs ${plan.rawInputs.map((r) => `${r.key} ${(r.perSecond * SECONDS_PER_DAY).toFixed(1)}/d ${r.leafClass ?? ''}`).join(', ')}`;
};

describe.skipIf(process.env.GTNH_LOCAL !== '1')('the raw cap on the real 2.9 export (fix wave 3 (A), (B2), (C))', () => {
  let pack: Pack;
  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  it("keeps the user's poly line on Rubber Wood at Least raw material and at Fewest machines: its leanest line, not its least raw material", async () => {
    for (const stepCharge of [0, 0.5]) {
      const plan = await planLine(pack, poly({ stepCharge }), emptyContext());
      console.log(line(`poly at ${stepCharge}`, plan));
      expect(plan.status).toBe('ok');
      // The user's acceptance of owned steps (ledger 265, controller OQ24): near 4–5 steps, reuse on (no farms on this branch).
      expect(plan.steps.length).toBeGreaterThanOrEqual(4);
      expect(plan.steps.length).toBeLessThanOrEqual(5);
      expect(plan.rawInputs.map((r) => r.key)).toEqual([RUBBER_WOOD]);
      expect(plan.rawInputs.map((r) => r.key)).not.toContain(RAW_OIL);
      expect(newBlocks(plan)).toBe(1);                                            // the Advanced Distillery; four reused
      const raw = plan.rawCost as NonNullable<Plan['rawCost']>;
      expect(raw.perSecond).toBeGreaterThan(100 * raw.leastPerSecond);            // 135 × S1, the Raw Oil line's
      expect(raw.perSecond).toBeLessThanOrEqual((raw.leanestPerSecond as number) * 1.25 * (1 + 1e-6));
      expect(raw.leanestPerSecond).toBe(raw.perSecond);
      expect(plan.cost?.build).toBeLessThan(100);                                 // the Raw Oil line builds 1,317
    }
  }, 300_000);

  it("holds the user's MV circuit line within +25 % of its leanest line, buying no more Phosphate Dust than the group has", async () => {
    const plan = await planLine(pack, mvCircuit(), emptyContext());
    console.log(line('MV circuit', plan));
    expect(plan.status).toBe('ok');
    const raw = plan.rawCost as NonNullable<Plan['rawCost']>;
    expect(raw.perSecond).toBeLessThanOrEqual((raw.leanestPerSecond as number) * 1.25 * (1 + 1e-6));
    // (C): over the build horizon (24 h) the line buys at most the group's stock (fix wave 3 review: a pick of 549 a day
    // passed the earlier "under 1,000 a day" pin while storage holds 164).
    const horizonSeconds = (plan.cost?.horizonHours as number) * 3600;
    const dust = plan.rawInputs.find((r) => r.key === PHOSPHATE_DUST);
    console.log(`real-raw-cap MV circuit Phosphate Dust: ${dust === undefined ? 'none' : `${(dust.perSecond * horizonSeconds).toFixed(1)} over ${plan.cost?.horizonHours} h`};`
      + ` byproduct-only goods ${plan.rawInputs.filter((r) => r.leafClass === 'byproduct').map((r) => `${r.key} ${(r.perSecond * horizonSeconds).toFixed(1)}`).join(', ') || 'none'}`);
    expect((dust?.perSecond ?? 0) * horizonSeconds).toBeLessThanOrEqual(PHOSPHATE_DUST_STOCK);
    // "No limit" (the user's choice), logged: 737bcd0's 2.67 × line bought 3,600 Phosphate Dust a day, which now costs
    // BEYOND_STOCK_FACTOR times its price beyond the stock (fix wave 3 (C)).
    const unlimited = await planLine(pack, mvCircuit({ rawCap: null }), emptyContext());
    console.log(line('MV circuit, no limit', unlimited));
    expect(unlimited.status).toBe('ok');
    for (const p of [plan, unlimited]) expect(beyondStock(p)).toEqual([]);
  }, 300_000);

  it('buys under 1,000 a day of every byproduct-only good for 2 Good Electronic Circuits a minute at HV, at the default raw cap and at No limit', async () => {
    for (const [name, settings] of [['GEC 2/min HV', gec()], ['GEC 2/min HV, no limit', gec({ rawCap: null })]] as const) {
      const plan = await planLine(pack, settings, emptyContext());
      console.log(line(name, plan));
      expect(plan.status, name).toBe('ok');
      expect(beyondStock(plan), name).toEqual([]);
    }
  }, 300_000);
});
