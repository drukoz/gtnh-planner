// Synthetic fixtures for the EnderIO mode tests (plan 11 Tasks 3–7; architecture §10): the conduit and filter keys of
// the fixture pack, the Basic Item Filter a face is expected to hold, the plans the tests lay out and their placement on
// the fixture pack (a power head 1 column wide, the EnderIO port spacing), every face of a result with its cell and
// conduit, and the line scan and ground of tests/unit/layout/layout.test.ts (copied, not moved: plan 11, ruling R16).
// Nothing here reads a real export or world; each call returns fresh objects.

import type { Vec3 } from '../../src/shared/layout/geometry.ts';
import type { ConduitFace, ConduitFilter, ConduitKind, ConduitSpec } from '../../src/shared/types/layout.ts';
import type { Pack } from '../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import type { WorldScan } from '../../src/shared/types/world.ts';
import { placeUnits, unitsFromPlan, type Placement } from '../../src/server/layout/arrange.ts';
import type { LayoutDeps } from '../../src/server/layout/layout.ts';
import { PORT_SPACING } from '../../src/server/layout/modes/mode.ts';
import { resolveParts, type Parts } from '../../src/server/layout/parts.ts';
import { areaReader, flatVoxels, IDS, layoutPack, makePlan, makeScan, STONE, type ScanSpec, type StepSpec } from './layout-fixtures.ts';

/** The Item Conduit, Basic Item Filter and Ender Fluid Conduit of the fixture pack. */
export const ITEM = 'EnderIO:itemItemConduit@0';
export const BASIC = 'EnderIO:itemBasicFilterUpgrade@0';
export const ENDER = 'EnderIO:itemLiquidConduit@2';

/** A Basic Item Filter whitelisting `keys` as given: match meta, ignore NBT, no ore dictionary, not sticky. */
export function basic(keys: string[]): ConduitFilter {
  return { item: BASIC, whitelist: true, keys: [...keys], matchMeta: true, matchNbt: false, oreDict: false, sticky: false };
}

/** `n` item keys `t:i00@0`, `t:i01@0`, … in order. */
export function keysN(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t:i${String(i).padStart(2, '0')}@0`);
}

/** layout.test.ts's `twoStep`: raw → 2× Basic Macerator (s1) → 1× Advanced Assembler (s2, tier 2, 120 EU/t) → out, 1/s each. */
export function twoStep(): Plan {
  return makePlan([
    { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
    { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
  ]);
}

/** x: a Basic Fluid Extractor making 144 L of Molten Iron a run from Raw Input; y: a Basic Fluid Solidifier taking it, making `t:out_y@0`. */
export const fluidSteps: StepSpec[] = [
  { id: 'x', mteId: IDS.EXTRACTOR, count: 1, outputs: [['fluid:molten.iron', 144]] },
  { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]] },
];

/** `fluidSteps` with `flows`, else chained raw → x → y → out at 1/s each. */
export function fluidPlan(flows?: PlanFlow[]): Plan {
  return makePlan(fluidSteps, flows === undefined ? {} : { flows });
}

/** The fixture pack, `plan`, its units placed with a power head 1 column wide and `spacing`, and the resolved parts. */
export function setup(plan: Plan = twoStep(), spacing: 0 | 1 | 2 = PORT_SPACING.enderio): { pack: Pack; plan: Plan; placement: Placement; parts: Parts } {
  const pack = layoutPack();
  const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 1, portSpacing: spacing });
  return { pack, plan, placement, parts: resolveParts(pack) };
}

/** Every face of every conduit of the blocks, in block, bundle and face order, with its cell and its conduit's kind. */
export function faces(r: { blocks: ReadonlyArray<{ pos: Vec3; conduits?: ConduitSpec[] }> }): Array<ConduitFace & { pos: Vec3; kind: ConduitKind }> {
  return r.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => ({ ...f, pos: [...b.pos], kind: c.kind }))));
}

const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });

/** layout.test.ts's `scan()`: a base around 20 64 20 holding one macerator and an MV power tap at 16 64 30; plus `extra.logistics`. */
export function lineScan(extra: Pick<ScanSpec, 'logistics'> = {}): WorldScan {
  return makeScan({
    base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } },
    machines: [{ pos: [18, 64, 18], mteId: IDS.MACERATOR }],
    power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 8 }] }],
    ...(extra.logistics === undefined ? {} : { logistics: extra.logistics }),
  });
}

/**
 * layout.test.ts's `ground()`: stone up to y 63 around the base, with the scanned macerator and the tap's cable on it;
 * plus a stone box from each `[from, to]` of `stone` (inclusive corners), to wall a hookup in.
 */
export function lineGround(stone: ReadonlyArray<readonly [Vec3, Vec3]> = []): LayoutDeps {
  return { readArea: areaReader(flatVoxels({
    origin: [-20, 50, -20], size: [90, 30, 90], groundY: 63,
    boxes: [{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }, { from: [16, 64, 30], to: [16, 64, 30], block: GT(IDS.ANNEALED_1X) },
      ...stone.map(([from, to]) => ({ from: [from[0], from[1], from[2]] as Vec3, to: [to[0], to[1], to[2]] as Vec3, block: STONE }))],
  })) };
}
