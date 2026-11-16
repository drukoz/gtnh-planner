// The layout benchmark (RUK-2580): a fixed set of lines laid out in all four logistics modes, measured by what they
// cost — total placed blocks, the loss their wiring counts, the tiers whose farthest machine is under-volted, and the
// machines that wiring cannot run (RUK-2617).
// Program RUK-2571 ("optimal layout") changes how lines are laid out; this is the stick every change is measured
// against, so `tests/fixtures/layout-bench/baseline.json` holds today's numbers and
// `tests/unit/layout/layout-bench.test.ts` fails if any line gets longer, lossier or weaker.
//
// A layout's own blocks are `blocks` without the hookups' and without the ghosts of the taps they join (CLAUDE.md
// "Conventions"): hookups run out into the world beyond the line's box, so counting them would measure the base, not
// the line. Their placed blocks are counted once, as `hookup`.

import { layoutLine, type LayoutDeps } from '../../src/server/layout/layout.ts';
import type { Layout, LayoutBlock } from '../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan, PlanFlow } from '../../src/shared/types/plan.ts';
import type { StuffKey } from '../../src/shared/keys.ts';
import type { WorldScan } from '../../src/shared/types/world.ts';
import { makePlan, makeProject, makeScan, IDS, layoutPack, type StepSpec } from './layout-fixtures.ts';
import { lossGround, lossPlan, lossScan } from './power-loss.ts';

/** The four logistics modes, in the order every benchmark line is laid in. */
const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];

/** One laid-out line's cost: its footprint, its placed blocks by role, its loss, its weak tiers and its route failures. */
export interface LengthReport {
  /** The benchmark line's name, e.g. `loss-10`, `mixed-07`, `fluid-03`. */
  name: string;
  mode: LogisticsMode;
  /** The line's footprint `[x, height, z]`, straight off `Layout.size`. */
  size: [number, number, number];
  /** What the line costs: its own cable, pipe, interface and chip-pipe blocks, plus every hookup block. */
  total: number;
  /** The line's own `cable` blocks. */
  cable: number;
  /** The line's own `pipe` blocks (EnderIO conduits are laid as pipes). */
  pipe: number;
  /** The line's own `interface` blocks. */
  iface: number;
  /** The line's own `chip_pipe` blocks. */
  chip: number;
  /** The line's own transformers: reported, not counted in `total`. */
  transformer: number;
  /** The line's own chests: reported, not counted in `total`. */
  chest: number;
  /** Every block belonging to a hookup (its power run and its logistics runs), ghosts excluded. */
  hookup: number;
  /** EU/t the power need counts, read off `Layout.loss.totalEUt` (0 when the layout reports no loss). */
  lossEUt: number;
  /** One entry per `Layout.loss.tiers` row: the tier, its worst cable count and the volts its farthest machine sees. */
  tiers: Array<{ tier: number; worstBlocks: number; worstVolts: number }>;
  /** The tiers whose farthest machine gets less than half the tier's volts (GT volts are 8·4^tier), ascending. */
  weakTiers: number[];
  /** How many `route_failed` warnings the layout reports. */
  routeFailed: number;
  /** Machines whose wiring leaves them too few volts to run, read off `Layout.loss.unpowered` (0 when the line reports none). */
  unpowered: number;
}

/** What `lengthOf` measures: a `LengthReport` before the benchmark knows which line it measured. */
export type LengthMeasure = Omit<LengthReport, 'name'>;

const countRole = (blocks: readonly LayoutBlock[], role: LayoutBlock['role']): number => blocks.filter((b) => b.role === role).length;

/**
 * Measure one laid-out line: its footprint, the blocks it laid (`cable`, `pipe`, `iface` and `chip` are its own,
 * `hookup` every hookup's), `total` = those four + `hookup`, the loss the power need counts, one entry per loss tier,
 * the tiers whose farthest machine reaches under half the tier's volts, the `route_failed` count and the number of
 * machines its wiring leaves too few volts to run. Transformers and chests are reported but never counted in `total`.
 */
export function lengthOf(layout: Layout): LengthMeasure {
  const own = layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost');
  const hookup = layout.blocks.filter((b) => b.hookup !== undefined && b.role !== 'ghost').length;
  const cable = countRole(own, 'cable');
  const pipe = countRole(own, 'pipe');
  const iface = countRole(own, 'interface');
  const chip = countRole(own, 'chip_pipe');
  const tiers = (layout.loss?.tiers ?? []).map((t) => ({ tier: t.tier, worstBlocks: t.worstBlocks, worstVolts: t.worstVolts }));
  return {
    mode: layout.mode,
    size: layout.size,
    total: cable + pipe + iface + chip + hookup,
    cable, pipe, iface, chip,
    transformer: countRole(own, 'transformer'),
    chest: countRole(own, 'chest'),
    hookup,
    lossEUt: layout.loss?.totalEUt ?? 0,
    tiers,
    weakTiers: tiers.filter((t) => t.worstVolts * 2 < 8 * 4 ** t.tier).map((t) => t.tier).sort((a, b) => a - b),
    routeFailed: layout.warnings.filter((w) => w.code === 'route_failed').length,
    unpowered: layout.loss?.unpowered ?? 0,
  };
}

/** One line of the benchmark: the plan to lay, the world to lay it in per mode, and the layout's voxel deps. */
export interface BenchLine {
  name: string;
  plan: Plan;
  /** The scan this line is laid on in `mode` (the loss lines vary by mode; the mixed and fluid lines do not). */
  scan: (mode: LogisticsMode) => WorldScan;
  deps: LayoutDeps;
}

/**
 * The benchmark's 33 lines, in the order the baseline lists them: the three loss lines (10, 20, 40 macerators), the
 * first 20 random mixed-tier lines and the first 10 random fluid lines, each on the same scan and network the
 * generator in `tests/unit/layout/layout.test.ts` lays it on.
 */
export function benchLines(): BenchLine[] {
  const lines: BenchLine[] = [10, 20, 40].map((n) => ({
    name: `loss-${n}`, plan: lossPlan(n), scan: (mode: LogisticsMode) => lossScan(mode), deps: lossGround(),
  }));
  for (const line of mixedLines(20)) lines.push(line);
  for (const line of fluidLines(10)) lines.push(line);
  return lines;
}

/**
 * Lay every benchmark line in all four modes (33 × 4 = 132 layouts) and measure each: the rows in line order, then
 * mode order (`direct`, `routed`, `ae2`, `enderio`). Deterministic: the same run twice gives equal rows.
 */
export async function runBench(): Promise<LengthReport[]> {
  const rows: LengthReport[] = [];
  for (const line of benchLines()) {
    for (const mode of MODES) {
      const layout = await layoutLine(layoutPack(), line.plan, line.scan(mode), makeProject({ logistics: mode }), line.deps);
      rows.push({ name: line.name, ...lengthOf(layout) });
    }
  }
  return rows;
}

const sizeText = (size: readonly [number, number, number]): string => size.join('x');

const sum = (rows: readonly LengthReport[], of: (r: LengthReport) => number): number => rows.reduce((acc, r) => acc + of(r), 0);

/**
 * A markdown table of the benchmark: one row per line × mode (footprint, the block counts, the loss rounded, the weak
 * tiers, the route failures and the machines the wiring cannot run), then one summary row per mode summing `total`,
 * summing the loss, counting the rows with any weak tier and summing `routeFailed` and `unpowered`.
 */
export function benchTable(rows: readonly LengthReport[]): string {
  const head = '| line | mode | size | total | cable | pipe | iface | chip | trans | chest | hook | loss EU/t | weak tiers | route failed | unpowered |';
  const rule = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const cells = rows.map((r) => `| ${r.name} | ${r.mode} | ${sizeText(r.size)} | ${r.total} | ${r.cable} | ${r.pipe} | ${r.iface} | ${r.chip}`
    + ` | ${r.transformer} | ${r.chest} | ${r.hookup} | ${Math.round(r.lossEUt)} | ${r.weakTiers.length === 0 ? '-' : r.weakTiers.join(',')} | ${r.routeFailed}`
    + ` | ${r.unpowered} |`);
  const summary = MODES.map((mode) => {
    const of = rows.filter((r) => r.mode === mode);
    return `| **all** | **${mode}** |  | ${sum(of, (r) => r.total)} |  |  |  |  |  |  |  | ${Math.round(sum(of, (r) => r.lossEUt))}`
      + ` | ${of.filter((r) => r.weakTiers.length > 0).length} | ${sum(of, (r) => r.routeFailed)} | ${sum(of, (r) => r.unpowered)} |`;
  });
  return [head, rule, ...cells, ...summary].join('\n');
}

// ---- The benchmark's generated lines ----

/** A deterministic PRNG (mulberry32): the same seed gives the same numbers in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The base scan of `layout.test.ts`: the site the generated lines are laid next to, with an MV tap. */
const scan = () => makeScan({
  base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } },
  machines: [{ pos: [18, 64, 18], mteId: IDS.MACERATOR }],
  // the tap's own cable is rated for the line (the 1x Annealed Copper block below would carry 1 A; the line draws 4)
  power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 8, cableAmps: 8 }] }],
});

/** A network of `tier` at the shared base, with one tap rated for every line here. */
const netScan = (tier: number) => makeScan({ base: scan().bases[0], power: [{ voltageTier: tier, average: 100_000, loadEUt: 0, storedEU: 10_000_000,
  taps: [{ pos: [16, 64, 30], freeAmps: 64, cableAmps: 64 }] }] });

const MI: StuffKey = 'fluid:molten.iron', OX: StuffKey = 'fluid:oxygen';

/**
 * The first `count` plans of the mixed-tier generator (seed `20261019`), each with the `supply` draw that follows it:
 * 2–4 chained steps, each 1–3 machines of a random tier (now and then 1–2 MV blast furnaces), on an MV or HV network.
 * Copies the generator in `layout.test.ts` with its seed and draw order unchanged, so the lines are the same.
 */
function mixedLines(count: number): BenchLine[] {
  const random = seeded(20261019);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const singleblocks: Record<number, { mteId: number; euPerTick: number[] }> = {
    1: { mteId: IDS.MACERATOR, euPerTick: [8, 16, 30] }, 2: { mteId: IDS.ASSEMBLER, euPerTick: [64, 120] }, 3: { mteId: IDS.CHEM_HV, euPerTick: [256, 480] },
  };
  const lines: BenchLine[] = [];
  for (let i = 0; i < count; i++) {
    const steps = Array.from({ length: pick([2, 3, 4]) }, (_, j): StepSpec => {
      if (random() < 1 / 8) return { id: `s${j + 1}`, mteId: IDS.EBF, count: pick([1, 2]), tier: 2, euPerTick: 120 };
      const tier = pick([1, 2, 3]);
      return { id: `s${j + 1}`, mteId: singleblocks[tier]!.mteId, count: pick([1, 2, 3]), tier, euPerTick: pick(singleblocks[tier]!.euPerTick) };
    });
    const supply = pick([2, 3]);
    const plan = makePlan(steps);
    lines.push({ name: `mixed-${String(i).padStart(2, '0')}`, plan, scan: () => netScan(supply), deps: {} });
  }
  return lines;
}

/**
 * The first `count` plans of the fluid generator (seed `20261020`): 2–4 chained steps, each 1–3 machines of a random
 * tier, now and then one that makes molten iron the next takes, or takes oxygen from outside the line, on an MV or HV
 * network. Copies the generator in `layout.test.ts` with its seed and draw order unchanged.
 */
function fluidLines(count: number): BenchLine[] {
  const random = seeded(20261020);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const machines: Record<number, { plain: number; makes: number; takes: number; euPerTick: number[] }> = {
    1: { plain: IDS.MACERATOR, makes: IDS.EXTRACTOR, takes: IDS.SOLIDIFIER, euPerTick: [8, 16, 30] },
    2: { plain: IDS.ASSEMBLER, makes: IDS.ASSEMBLER, takes: IDS.ASSEMBLER, euPerTick: [64, 120] },
    3: { plain: IDS.CHEM_HV, makes: IDS.CHEM_HV, takes: IDS.CHEM_HV, euPerTick: [256, 480] },
  };
  const lines: BenchLine[] = [];
  for (let i = 0; i < count; i++) {
    const supply = pick([2, 3]);
    const steps: StepSpec[] = [];
    const flows: PlanFlow[] = [];
    let from = 'raw', item: StuffKey = 't:in@0';
    const length = pick([2, 3, 4]);
    for (let j = 0; j < length; j++) {
      const id = `s${j + 1}`, tier = pick([1, 2, 3]), m = machines[tier]!;
      const makes = random() < 0.3, oxygen = random() < 0.2;
      const made: StuffKey = makes ? MI : `t:out_${id}@0`;
      steps.push({ id, mteId: makes ? m.makes : item === MI ? m.takes : m.plain, count: pick([1, 2, 3]), tier, euPerTick: pick(m.euPerTick),
        inputs: oxygen ? [[item, 1], [OX, 100]] : [[item, 1]], outputs: [[made, 1]] });
      flows.push({ from, to: id, key: item, perSecond: 1 }, ...(oxygen ? [{ from: 'raw', to: id, key: OX, perSecond: 1 }] : []));
      from = id;
      item = made;
    }
    flows.push({ from, to: 'out', key: item, perSecond: 1 });
    const plan = makePlan(steps, { flows });
    lines.push({ name: `fluid-${String(i).padStart(2, '0')}`, plan, scan: () => netScan(supply), deps: {} });
  }
  return lines;
}
