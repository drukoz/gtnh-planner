// The cable-loss harness (RUK-117): the line of `n` machines spread over four build steps, the scan and ground it is
// laid on, and the measurement of what its cables lose. Every line is laid out end to end with the real pipeline
// (`layoutLine`); nothing here fakes a layout. `tierContacts` lives here (moved from internal.test.ts) so the loss
// tests can run the same wiring checks the internal route is held to.
//
// The loss figure comes from `Layout.power.detail` because this branch has no structured loss on the layout.
// TODO(RUK-112): read Layout.loss.totalEUt once it lands.

import { DIRS, posKey, step, type Vec3 } from '../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan } from '../../src/shared/types/plan.ts';
import type { Pack, Machine } from '../../src/shared/types/pack.ts';
import type { WorldScan } from '../../src/shared/types/world.ts';
import { layoutLine, type LayoutDeps } from '../../src/server/layout/layout.ts';
import { placeUnits, unitsFromPlan, type LocalBlock, type Placement } from '../../src/server/layout/arrange.ts';
import { PORT_SPACING } from '../../src/server/layout/modes/mode.ts';
import { resolveParts } from '../../src/server/layout/parts.ts';
import { hookupAllowanceVolts, tierGroups, transformerStages } from '../../src/server/layout/power.ts';
import { fluidNets, headWidthFor, routeInternal, type InternalResult } from '../../src/server/layout/internal.ts';
import {
  areaReader, flatVoxels, IDS, layoutPack, makePlan, makeProject, makeScan, type ScanSpec, type StepSpec,
} from './layout-fixtures.ts';

/** What one laid-out line loses: the machine draw, the cable loss, the ratio, the cable cells and the warning codes. */
export interface LossReport {
  machines: number;
  mode: LogisticsMode;
  /** The line's footprint `[x, height, z]`, straight off `Layout.size`. */
  size: [number, number, number];
  /** EU/t the placed electric machines draw (the plan's average). */
  drawEUt: number;
  /** EU/t the line's cables and transformers lose, read out of `Layout.power.detail`. */
  lossEUt: number;
  /** `lossEUt / drawEUt`, rounded to two decimals. */
  share: number;
  /** Cable blocks the line laid. */
  cableCells: number;
  /** The layout's warning codes, deduped and sorted. */
  codes: string[];
}

/** `n` machines spread over four build steps, the counts as even as whole machines allow (3,3,2,2 for 10). */
export function spreadSteps(n: number, prefix = 's'): StepSpec[] {
  const base = Math.floor(n / 4);
  const extra = n % 4;
  return [0, 1, 2, 3].map((i) => ({
    id: `${prefix}${i + 1}`, mteId: IDS.MACERATOR, count: base + (i < extra ? 1 : 0), euPerTick: 30,
  }));
}

/** The plan of `n` Basic Macerators (LV, 30 EU/t each) spread over four steps, chained raw → … → out. */
export function lossPlan(n: number): Plan {
  return makePlan(spreadSteps(n));
}

/** The scan a loss line is laid on: an MV network with a huge surplus and a fat tap, plus the mode's logistics net. */
export function lossScan(mode: LogisticsMode): WorldScan {
  const logistics: ScanSpec['logistics'] = mode === 'direct' ? []
    : mode === 'routed' ? [{ kind: 'routed', taps: [[26, 64, 12]] }]
      : mode === 'ae2' ? [{ kind: 'ae2', taps: [[26, 64, 12]], channelsUsed: 0, channelsMax: 128 }]
        : [{ kind: 'enderio', taps: [[26, 64, 12]] }];
  return makeScan({
    base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } },
    machines: [{ pos: [18, 64, 18], mteId: IDS.MACERATOR }],
    power: [{ voltageTier: 2, average: 1_000_000, loadEUt: 0, storedEU: 100_000_000,
      taps: [{ pos: [16, 64, 30], freeAmps: 1000, cableAmps: 1000 }] }],
    ...(logistics.length === 0 ? {} : { logistics }),
  });
}

/** Flat stone under the whole site, with the scanned macerator and the power tap's cable standing on it. */
export function lossGround(): LayoutDeps {
  const gt = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
  return { readArea: areaReader(flatVoxels({
    origin: [-160, 50, -160], size: [400, 30, 400], groundY: 63,
    boxes: [{ from: [18, 64, 18], to: [18, 64, 18], block: gt(IDS.MACERATOR) },
      { from: [16, 64, 30], to: [16, 64, 30], block: gt(IDS.ANNEALED_2X) }],
  })) };
}

/** The MV supply tier of `lossScan`, the tier the line's stages and run are sized against. */
export const SUPPLY_TIER = 2;

/**
 * The line of `n` machines in `mode`, laid end to end: the layout, its plan, and the local placement and internal
 * route the layout was built from (the wiring checks below read the local grid, where the ports and runs live).
 */
export async function lossLine(n: number, mode: LogisticsMode): Promise<{
  layout: Layout; plan: Plan; placement: Placement; internal: InternalResult; pack: Pack;
}> {
  const pack = layoutPack();
  const plan = lossPlan(n);
  const layout = await layoutLine(pack, plan, lossScan(mode), makeProject({ logistics: mode }), lossGround());
  const parts = resolveParts(pack);
  const { units } = unitsFromPlan(pack, plan, { primitive: mode !== 'direct' });
  const electric = units.filter((u) => u.electric);
  const stages = transformerStages(tierGroups(electric.map((u) => ({ tier: u.tier, euPerTick: u.euPerTick }))), SUPPLY_TIER);
  const placement = placeUnits(units, { headWidth: headWidthFor(stages), portSpacing: PORT_SPACING[mode], supplyTier: SUPPLY_TIER });
  const internal = routeInternal({
    pack, parts, placement, occupied: placement.blocks, stages, fluids: fluidNets(pack, plan, placement),
    tailFluidY: 1, groupTier: plan.tier, supplyLossVolts: hookupAllowanceVolts(SUPPLY_TIER),
  });
  return { layout, plan, placement, internal, pack };
}

/** Cells (`posKey`) holding two or more of the layout's blocks: an overlapping line is broken, whatever it measures. */
export function overlaps(blocks: readonly LayoutBlock[]): string[] {
  const seen = new Map<string, number>();
  for (const b of blocks) seen.set(posKey(b.pos), (seen.get(posKey(b.pos)) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k).sort();
}

/**
 * Final review C2: every pair of touching cable blocks and every cable beside a machine's power input, as text, when
 * the two are of different tiers (a cable's tier is its run's, by its label) or the machine is below the cable's tier.
 */
export function tierContacts(blocks: LocalBlock[], cables: Array<{ tier: number; cable: Machine }>, placement: Placement): string[] {
  const tierOf = new Map(cables.map((c) => [c.cable.name, c.tier]));
  const at = new Map(blocks.map((b) => [posKey(b.pos), b]));
  const machines = new Map(placement.units.filter((u) => u.ports.power !== null).map((u) => [posKey(step(u.ports.power!, u.facing)), u]));
  const out: string[] = [];
  for (const b of blocks) {
    if (b.role !== 'cable') continue;
    const tier = tierOf.get(b.label)!;
    for (let side = 0; side < DIRS.length; side++) {
      const n = step(b.pos, side);
      const other = at.get(posKey(n));
      if (other?.role === 'cable' && tierOf.get(other.label) !== tier) out.push(`${b.label} at ${posKey(b.pos)} touches ${other.label} at ${posKey(n)}`);
      const unit = machines.get(posKey(n));
      if (unit !== undefined && unit.tier < tier) out.push(`${b.label} at ${posKey(b.pos)} touches ${unit.name} at ${posKey(n)}`);
    }
  }
  return out;
}

/** The loss figure `fitPower` writes into `Layout.power.detail`, as an integer, or null when the string is not its shape. */
function parseLoss(detail: string): number | null {
  const m = /Needs ([\d,]+) EU\/t on average \(([\d,]+) \+ ([\d,]+) loss\)/.exec(detail);
  return m === null ? null : Number(m[3]!.replaceAll(',', ''));
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Lay `n` machines in `mode` end to end and measure what the cables lose: the line's footprint, the plan's draw,
 * the loss out of `Layout.power.detail` (TODO(RUK-112): `Layout.loss`), their ratio to two decimals, the cable
 * cells and the codes.
 * Throws when the layout does not report a loss figure.
 */
export async function measureLoss(n: number, mode: LogisticsMode): Promise<LossReport> {
  const { layout, plan } = await lossLine(n, mode);
  const lossEUt = parseLoss(layout.power?.detail ?? '');
  if (lossEUt === null) throw new Error(`no loss figure in power detail: ${layout.power?.detail ?? '(none)'}`);
  const drawEUt = plan.power.averageEUt;
  return {
    machines: n, mode, size: layout.size, drawEUt, lossEUt, share: round2(lossEUt / drawEUt),
    cableCells: layout.blocks.filter((b) => b.role === 'cable').length,
    codes: [...new Set(layout.warnings.map((w) => w.code))].sort(),
  };
}
