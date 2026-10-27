import { describe, it, expect } from 'vitest';
import { layoutLine, emptyScan } from '../../../src/server/layout/layout.ts';
import { overlaps } from '../../../src/server/layout/arrange.ts';
import { ae2IdleEUt, resolveParts } from '../../../src/server/layout/parts.ts';
import { tierName } from '../../../src/shared/gt/tiers.ts';
import { OPPOSITE, rotateFacing, step } from '../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../../src/shared/types/plan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { layoutPack, makePlan, makeProject, makeScan, flatVoxels, areaReader, IDS, STONE, type StepSpec } from '../../helpers/layout-fixtures.ts';
import { mergeLayoutIntoPlan } from '../../../src/server/layout/merge.ts';
import { planBasis } from '../../../src/server/planner/basis.ts';
import { buildBom } from '../../../src/server/planner/bom.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import { largeBenderSpec } from '../../helpers/build-fixtures.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { emptyContextForTest } from '../../helpers/plan-context.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';

const twoStep = () => makePlan([
  { id: 's1', mteId: IDS.MACERATOR, count: 2, euPerTick: 30 },
  { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
]);
const scan = () => makeScan({
  base: { center: [20, 64, 20], bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } },
  machines: [{ pos: [18, 64, 18], mteId: IDS.MACERATOR }],
  // the tap's own cable is rated for the line (the 1x Annealed Copper block below would carry 1 A; the line draws 4)
  power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 8, cableAmps: 8 }] }],
});
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
const ground = (boxes: Parameters<typeof flatVoxels>[0]['boxes'] = []) => ({ readArea: areaReader(flatVoxels({
  origin: [-20, 50, -20], size: [90, 30, 90], groundY: 63,
  boxes: [{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }, { from: [16, 64, 30], to: [16, 64, 30], block: GT(IDS.ANNEALED_1X) }, ...(boxes ?? [])],
})) });

describe('layoutLine', () => {
  it('lays out a two-step line next to the base, wired from the tap through a transformer', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect([layout.status, layout.mode, layout.dim]).toEqual(['ok', 'direct', 0]);
    expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => b.block.mteId).sort()).toEqual([IDS.MACERATOR, IDS.MACERATOR, IDS.ASSEMBLER]);
    expect(layout.blocks.filter((b) => b.role === 'transformer').map((b) => b.block.mteId)).toEqual([IDS.TRANSFORMER_LV]);
    expect(layout.hookups.map((h) => [h.kind, h.from.pos, h.found])).toEqual([['power', [16, 64, 30], true]]);
    expect(layout.blocks.filter((b) => b.role === 'ghost').map((b) => [b.pos, b.label])).toEqual([[[16, 64, 30], 'existing 1x Annealed Copper Cable']]);
    expect(layout.pins.map((p) => [p.n, p.kind])).toEqual([[1, 'site'], [2, 'power']]);
    expect(layout.power!.fits).toBe('yes');
    expect(layout.buildSteps.map((s) => s.id)).toEqual(expect.arrayContaining(['layout:site', 'layout:power:stage:1', 'layout:power:hookup', 'layout:configure:s1']));
    expect(layout.bom).toContainEqual({ key: 'gregtech:gt.blockmachines@21', amount: 1, why: 'transformers', group: 'power' });
    expect(layout.bom.find((l) => l.key === 'gregtech:gt.metaitem.01@32630')).toMatchObject({ amount: 4, group: 'logistics' });
    expect(layout.bom.every((l) => l.group !== undefined)).toBe(true);
    expect(layout.blocks.some((b) => b.role === 'cover')).toBe(false);
    expect(layout.blocks.filter((b) => b.role === 'machine').every((b) => b.covers?.length === 1 && b.config?.inputFilter === true)).toBe(true);
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost'))).toEqual([]);
    const inside = (p: number[]) => p.every((v, i) => v >= layout.origin[i]! && v < layout.origin[i]! + layout.size[i]!);
    expect(layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost').every((b) => inside(b.pos))).toBe(true);
    expect(layout.blocks.some((b) => b.pos.join() === '18,64,18')).toBe(false);
    // ruling R7 (architecture §11.23): every placed block names the build step that places it
    const stepIds = new Set(layout.buildSteps.map((s) => s.id));
    expect(layout.blocks.filter((b) => b.role !== 'ghost').every((b) => b.buildStep !== undefined && stepIds.has(b.buildStep))).toBe(true);
    const again = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect(JSON.stringify(again)).toBe(JSON.stringify(layout));
  });

  it('lays out without a scan so the 3D view and parts still work', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), emptyScan(), makeProject({ scanId: null, baseId: null }));
    expect([layout.status, layout.origin, layout.hookups, layout.pins]).toEqual(['no-world', [0, 64, 0], [], []]);
    // the warning that says what to do comes first; the line's own wiring warnings follow (final review I4)
    expect(layout.warnings[0]).toEqual({ code: 'no_scan', text: 'Pick a world scan and base on the Map tab to place the line' });
    expect(layout.warnings.slice(1).map((w) => w.code)).toEqual(['cable_amps', 'cable_loss_high', 'cable_loss_high']);
    expect(layout.blocks.filter((b) => b.role === 'machine')).toHaveLength(3);
    expect(layout.buildSteps.every((s) => s.pin === undefined)).toBe(true);
  });

  it('honours a dragged placement and says what is in the way', async () => {
    const project = makeProject({ placement: { origin: [30, 64, 30], rotation: 90 } });
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), project, ground([{ from: [30, 64, 30], to: [30, 64, 30], block: STONE }]));
    expect([layout.origin, layout.rotation]).toEqual([[30, 64, 30], 90]);
    expect(layout.warnings).toContainEqual({ code: 'placement_blocked', text: '1 block is in the way at the chosen spot' });
  });

  it('pins machines the group already owns instead of placing new ones', async () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, owned: 1 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
    const layout = await layoutLine(layoutPack(), plan, scan(), makeProject(), ground());
    expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => b.block.mteId)).toEqual([IDS.ASSEMBLER]);
    expect(layout.pins.find((p) => p.kind === 'reuse')).toMatchObject({ pos: [18, 64, 18], text: 'Reuse your 1× Basic Macerator' });
    expect(layout.buildSteps.map((s) => s.id)).toContain('layout:reuse:s1');
  });

  it('never assumes AE2 the base does not have', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ logistics: 'ae2' }), ground());
    expect(layout.warnings.map((w) => w.code)).toContain('ae2_missing');
    expect(layout.pins.at(-1)!.kind).toBe('warning');
    expect(layout.hookups.map((h) => h.kind)).toEqual(['power']);
  });

  it("AE2 mode adds the ME parts' idle draw to the line's power need", async () => {
    const pack = layoutPack();
    const ae2 = await layoutLine(pack, twoStep(), scan(), makeProject({ logistics: 'ae2' }), ground());
    const idle = ae2IdleEUt(ae2.blocks, resolveParts(pack));
    expect(idle).toBe(1.5);                                  // three ME interfaces at 1 AE/t, glass cable 0 AE/t, 2 AE per EU
    expect([ae2.power!.averageEUt, ae2.power!.peakEUt]).toEqual([twoStep().power.averageEUt + idle, twoStep().power.peakEUt + idle]);
    expect(ae2.power!.detail).toContain('; AE2 parts idle: 1.5 EU/t');
    const direct = await layoutLine(pack, twoStep(), scan(), makeProject({ logistics: 'direct' }), ground());
    expect([direct.power!.averageEUt, direct.power!.detail]).toEqual([twoStep().power.averageEUt, expect.not.stringContaining('AE2')]);
  });

  it('returns an empty layout for a plan with nothing to build', async () => {
    const layout = await layoutLine(layoutPack(), makePlan([], { status: 'empty' }), scan(), makeProject(), ground());
    expect([layout.status, layout.blocks, layout.pins, layout.buildSteps]).toEqual(['empty', [], [], []]);
  });

  it('counts the banks, the line\'s own cables and the hookup in the power need', async () => {
    // banks 4 A out × 1 EU; LV: 2 macerators × 2 A × 4 V; MV from the hookup's landing cell (z 4): assembler 2 A × 14,
    // bank 2 A × 3; hookup 6 cables × 4 A × 1 V
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject(), ground());
    expect(layout.power!.detail).toBe('Needs 258 EU/t on average (180 + 78 loss); 900 EU/t spare; cables and hookup lose 78 EU/t');
    expect(layout.buildSteps.find((s) => s.id === 'layout:power:hookup')!.text)
      .toBe('Run 6× 2x Annealed Copper Cable from the tap at pin 2 to the line: up to 4 A at MV, arriving at 122 V');
  });

  it("says what the line's cables lose, tier by tier, and in the power card", async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject(), ground());
    // MV from the hookup's landing cell (z 4): assembler 2 A × 14 cables, bank 2 A × 3; LV: 2 macerators × 2 A × 4
    expect(layout.loss).toEqual({ tiers: [
      { tier: 2, cable: '2x Annealed Copper Cable', lossPerBlock: 1, worstBlocks: 14, worstVolts: 114, lossEUt: 34 },
      { tier: 1, cable: '4x Tin Cable', lossPerBlock: 1, worstBlocks: 4, worstVolts: 28, lossEUt: 16 },
    ], hookupEUt: 24, banksEUt: 4, totalEUt: 78 });       // the tiers' 50, the bank's emitter 4 and the hookup's 24
    const parts = layout.loss!;
    expect(parts.totalEUt).toBe(parts.tiers.reduce((sum, t) => sum + t.lossEUt, 0) + parts.hookupEUt + parts.banksEUt);
    expect(layout.power!.detail).toContain('cables and hookup lose 78 EU/t');
  });

  it('prices the supply run from its far end when the line has no base to wire to', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), emptyScan(), makeProject({ scanId: null, baseId: null }));
    expect([layout.status, layout.loss]).toEqual(['no-world', { tiers: [
      { tier: 2, cable: '2x Annealed Copper Cable', lossPerBlock: 1, worstBlocks: 14, worstVolts: 114, lossEUt: 34 },
      { tier: 1, cable: '4x Tin Cable', lossPerBlock: 1, worstBlocks: 4, worstVolts: 28, lossEUt: 16 },
    ], hookupEUt: 0, banksEUt: 4, totalEUt: 4 + 16 + 34 }]); // no hookup to lose anything, and no network to fit against
  });
});

// Final review findings, end to end.
describe('layoutLine: the final review', () => {
  const DIRS: Array<[number, number, number]> = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const key = (p: readonly number[]) => p.join();
  const near = (p: readonly number[]) => DIRS.map((d) => key([p[0]! + d[0], p[1]! + d[1], p[2]! + d[2]]));
  const hvLine = () => makePlan([{ id: 'h', mteId: IDS.CHEM_HV, count: 1, tier: 3, euPerTick: 300 }]);
  const hvScan = (networks: NonNullable<NonNullable<Parameters<typeof makeScan>[0]>['power']>) => makeScan({ base: scan().bases[0], power: networks });

  it('C1: a guide that would cross the line goes round it and links only to its own cables, the tap and the run', async () => {
    const hvless = makeScan({ base: scan().bases[0], power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000,
      taps: [{ pos: [40, 64, 12], freeAmps: 8, cableAmps: 8 }] }] });
    for (const rotation of [270, 0] as const) {
      const layout = await layoutLine(layoutPack(), twoStep(), hvless, makeProject({ placement: { origin: [20, 64, 10], rotation } }));
      const [min, size] = [layout.origin, layout.size];
      const inColumns = (p: number[]) => p[0]! >= min[0] && p[0]! < min[0] + size[0] && p[2]! >= min[2] && p[2]! < min[2] + size[2];
      const hookup = layout.hookups[0]!;
      expect([hookup.found, hookup.path.some(inColumns)]).toEqual([false, false]);
      const supplyRun = layout.blocks.filter((b) => b.buildStep === 'layout:power:wire:2' && inColumns(b.pos) && b.pos[1] === min[1]).map((b) => key(b.pos));
      const last = hookup.path.at(-1)!;
      expect(last[1]).toBe(64);                                                     // beside the run, not under it
      expect(near(last).some((k) => supplyRun.includes(k))).toBe(true);
      const own = new Set(layout.blocks.filter((b) => b.hookup === 0).map((b) => key(b.pos)));
      const lineCables = new Set(layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost').map((b) => key(b.pos)));
      for (const b of layout.blocks.filter((x) => x.hookup === 0)) {
        near(b.pos).forEach((k, side) => {
          if (((b.connections ?? 0) & (1 << side)) === 0) return;
          expect(own.has(k) || k === '40,64,12' || (lineCables.has(k) && supplyRun.includes(k))).toBe(true);
        });
      }
    }
  });

  it('C2: no two cables of different tiers touch, and no cable touches a machine below its tier', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject(), ground());
    const plan = twoStep();
    const tierOf = (b: (typeof layout.blocks)[number]): number | undefined =>
      b.hookup !== undefined ? 2 : b.buildStep?.startsWith('layout:power:wire:') ? Number(b.buildStep.split(':').at(-1)) : undefined;
    const placed = layout.blocks.filter((b) => b.role !== 'ghost');
    const at = new Map(placed.map((b) => [key(b.pos), b]));
    const cables = placed.filter((b) => b.role === 'cable');
    expect(cables.every((b) => tierOf(b) !== undefined)).toBe(true);
    const contacts: string[] = [];
    for (const b of cables) {
      for (const k of near(b.pos)) {
        const other = at.get(k);
        if (other?.role === 'cable' && tierOf(other) !== tierOf(b)) contacts.push(`${key(b.pos)}~${k}`);
        const machineTier = other?.role === 'machine' ? plan.steps.find((s) => s.id === other.stepId)?.machine.tier : undefined;
        if (machineTier !== undefined && machineTier < tierOf(b)!) contacts.push(`${key(b.pos)}>${k}`);
      }
    }
    expect(contacts).toEqual([]);
    expect(layout.buildSteps.filter((s) => s.id.startsWith('layout:power:wire:')).every((s) => s.text.endsWith('never let the MV cables touch the LV cables'))).toBe(true);
  });

  it('I3: feeds the line only from a tap on its supply tier, and says so when the network has none on its own', async () => {
    // an HV network whose nearest tap is an LV tin cable (1 A free) and whose HV tap is far away
    const mixed = hvScan([{ voltageTier: 3, average: 5000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 1 }, { pos: [60, 64, 60], freeAmps: 4 }] }]);
    mixed.power[0]!.taps[0]!.voltageTier = 1;
    const layout = await layoutLine(layoutPack(), hvLine(), mixed, makeProject(), ground());
    expect(layout.hookups.map((h) => [h.from.pos, h.from.voltageTier])).toEqual([[[60, 64, 60], 3]]);
    expect(layout.pins.find((p) => p.kind === 'power')!.text).toBe('Tap power here: HV, 4 A free (the line needs 1 A)');
    // only LV taps: the line is fed at LV, and the warning says why
    const lvOnly = hvScan([{ voltageTier: 3, average: 5000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 4 }] }]);
    lvOnly.power[0]!.taps[0]!.voltageTier = 1;
    const fed = await layoutLine(layoutPack(), hvLine(), lvOnly, makeProject(), ground());
    expect(fed.warnings).toContainEqual({ code: 'power_tap_tier', text: 'The HV network has no HV cable to tap: the line is fed at LV from a cable behind one of its transformers' });
    expect(fed.warnings.map((w) => w.code)).toContain('power_tier_low');
    // the HV machine fed at LV: 300 EU/t at 23.8 V (the hookup's 3.2 V and 5 cables lost) is 13 A, more than the 1x cable carries
    expect(fed.buildSteps.find((s) => s.id === 'layout:power:hookup')!.text)
      .toBe('Upgrade the 1x Annealed Copper Cable from the tap at pin 2 to carry 13 A, then connect the line');
    expect(fed.warnings).toContainEqual({ code: 'power_amps_low', text: "The tap's 1x Annealed Copper Cable carries 1 A at LV; the line draws up to 13 A" });
  });

  it('I-tap: reads the tap cable\'s own rating, so a cable that carries the line is wired whatever the spare power', async () => {
    // 400 EU/t spare at HV: Plan 4 gives 0 A free, but the tap is a 2x Silver Cable (2 A)
    const spare = hvScan([{ voltageTier: 3, average: 500, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: [16, 64, 30], freeAmps: 0 }] }]);
    const layout = await layoutLine(layoutPack(), hvLine(), spare, makeProject(), ground([{ from: [16, 64, 30], to: [16, 64, 30], block: GT(IDS.SILVER_2X) }]));
    expect(layout.warnings.map((w) => w.code)).not.toContain('power_amps_low');
    expect(layout.buildSteps.find((s) => s.id === 'layout:power:hookup')!.text).toMatch(/^Run \d+× 1x Silver Cable from the tap at pin 2 to the line: up to 1 A at HV/);
    expect(layout.blocks.filter((b) => b.hookup === 0).length).toBeGreaterThan(0);
    expect(layout.power!.fits).toBe('yes');
  });

  it('I-fit: judges the line against the one network it is wired to', async () => {
    // the HV network has nothing spare; an MV network beside it (no taps the line can use) has 6,000 EU/t
    const two = hvScan([
      { voltageTier: 3, average: 1000, loadEUt: 1000, storedEU: 0, taps: [{ pos: [16, 64, 30], freeAmps: 0, cableAmps: 2 }] },
      { voltageTier: 2, average: 6000, loadEUt: 0, storedEU: 0, taps: [] }]);
    const layout = await layoutLine(layoutPack(), hvLine(), two, makeProject(), ground());
    expect(layout.power!.fits).toBe('no');
    expect(layout.power!.detail).toContain('; 0 EU/t spare');
  });

  it('I-placement: checks a placement far from the base against what is really there, and never uses one from too far away', async () => {
    const hill = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ placement: { origin: [55, 64, 20], rotation: 0 } }),
      ground([{ from: [50, 64, 15], to: [65, 70, 30], block: STONE }]));
    expect([hill.origin, hill.warnings.filter((w) => w.code.startsWith('placement'))]).toEqual([[55, 64, 20],
      [{ code: 'placement_blocked', text: '105 blocks are in the way at the chosen spot' }]]);
    const edge = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ placement: { origin: [66, 64, 20], rotation: 0 } }), ground());
    expect(edge.warnings).toContainEqual({ code: 'placement_unchecked',
      text: '60 blocks at the chosen spot were not scanned, so they could not be checked: look there in game before building' });
    expect(edge.pins.some((p) => p.kind === 'warning' && p.text.startsWith('60 blocks at the chosen spot'))).toBe(true);
    // a placement kept from another base (or dragged off the map) is not used
    const far = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ placement: { origin: [600, 64, 20], rotation: 0 } }), ground());
    const auto = await layoutLine(layoutPack(), twoStep(), scan(), makeProject(), ground());
    expect(far.origin).toEqual(auto.origin);
    expect(far.warnings).toContainEqual({ code: 'placement_ignored',
      text: "The chosen spot is more than 96 blocks from this base's centre, too far to check: the line is placed near the base instead — move it closer" });
    const unread = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ placement: { origin: [30, 64, 30], rotation: 0 } }));
    expect(unread.warnings).toContainEqual({ code: 'terrain_unknown', text: 'The ground around the base could not be read; the line is placed at the chosen spot unchecked' });
  });

  it('gives a singleblock its front and output side apart, turned with the line', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), scan(), makeProject({ placement: { origin: [30, 64, 30], rotation: 90 } }), ground());
    const machines = layout.blocks.filter((b) => b.role === 'machine');
    // the front toward the power head (local west, GT allows no front up or down): the output side keeps the spine face
    expect(machines.every((b) => b.mainFacing === rotateFacing(4, 90))).toBe(true);
    expect(new Set(machines.map((b) => b.facing))).toEqual(new Set([4, 5]));         // the two rows face the spine, turned 90°
    expect(machines.every((b) => b.config?.inputFromOutputSide === true)).toBe(true);
    // the place steps name that front by the compass, turned with the line (local west → north at 90°)
    const place = layout.buildSteps.filter((s) => s.id.startsWith('layout:place:'));
    expect(place.length).toBeGreaterThan(0);
    expect(place.every((s) => s.text.includes('its front facing north: with a Wrench, sneak-right-click its north side'))).toBe(true);
  });
});

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

// Plan 5's final ruling on the C2 fix: a higher tier's tree that serves both rows crossed the spine and walled off the
// lower tier's machines beyond it. Every machine of a mixed-tier line is wired, whatever the flow order, and still no two
// tiers touch.
describe('layoutLine: mixed-tier lines', () => {
  const MODES = ['direct', 'routed', 'ae2'] as const;
  const key = (p: readonly number[]) => p.join();
  /** A network of `tier` at the shared base, with one tap rated for every line here. */
  const netScan = (tier: number) => makeScan({ base: scan().bases[0], power: [{ voltageTier: tier, average: 100_000, loadEUt: 0, storedEU: 10_000_000,
    taps: [{ pos: [16, 64, 30], freeAmps: 64, cableAmps: 64 }] }] });
  /** A cable's tier: its wire step's, or for a hookup cable its tap's. */
  const tierOf = (layout: Layout, b: LayoutBlock): number | undefined => (b.hookup !== undefined ? layout.hookups[b.hookup]?.from.voltageTier
    : b.buildStep?.startsWith('layout:power:wire:') ? Number(b.buildStep.split(':').at(-1)) : undefined);

  /**
   * What is wrong with the line's power, as text: every "Could not wire" warning; every singleblock machine without a cable
   * of its feed tier (`min(tier, supply)`) joined to the power input behind it; every cable beside a cable of another tier,
   * a machine or energy hatch of a lower tier, or a transformer it does not belong to (one joins its own tier and the next).
   */
  function powerProblems(layout: Layout, plan: Plan, pack: Pack, supply: number): string[] {
    const placed = layout.blocks.filter((b) => b.role !== 'ghost');
    const at = new Map(placed.map((b) => [key(b.pos), b]));
    const stepTier = new Map(plan.steps.map((s) => [s.id, s.machine.tier]));
    const out = layout.warnings.filter((w) => w.code === 'route_failed' && w.text.startsWith('Could not wire')).map((w) => w.text);
    for (const m of placed) {
      if (m.role !== 'machine' || m.mainFacing === undefined) continue;
      const port = at.get(key(step(m.pos, OPPOSITE[m.facing!]!)));
      const feed = Math.min(stepTier.get(m.stepId!)!, supply);
      if (port?.role !== 'cable' || tierOf(layout, port) !== feed || ((port.connections ?? 0) & (1 << m.facing!)) === 0) {
        out.push(`${m.label} at ${key(m.pos)} has no ${tierName(feed)} cable at its power input`);
      }
    }
    for (const b of placed) {
      if (b.role !== 'cable') continue;
      const tier = tierOf(layout, b);
      for (let side = 0; side < 6; side++) {
        const other = at.get(key(step(b.pos, side)));
        if (other === undefined) continue;
        const energy = other.role === 'machine' || (other.role === 'hatch' && machineByMteId(pack, other.block.mteId!)?.cls.endsWith('MTEHatchEnergy') === true);
        const transformer = other.role === 'transformer' ? machineByMteId(pack, other.block.mteId!)?.tier : undefined;
        if (tier === undefined || (other.role === 'cable' && tierOf(layout, other) !== tier)
          || (energy && other.stepId !== undefined && stepTier.get(other.stepId)! < tier)
          || (transformer !== undefined && tier !== transformer && tier !== transformer + 1)) {
          out.push(`${b.label} at ${key(b.pos)} touches ${other.label} at ${key(other.pos)}`);
        }
      }
    }
    return out;
  }

  it('wires a lower-tier machine behind a higher-tier step that fills both rows, in every mode', async () => {
    // two MV assemblers (one per row) ahead of an LV macerator in flow order: the MV tree to the second row ran over the
    // spine and left the macerator unwired in every mode
    const plan = makePlan([
      { id: 'a', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 120 },
      { id: 'm', mteId: IDS.MACERATOR, count: 1, euPerTick: 30 },
    ]);
    for (const mode of MODES) {
      const pack = layoutPack();
      const layout = await layoutLine(pack, plan, scan(), makeProject({ logistics: mode }), ground());
      expect([mode, layout.blocks.filter((b) => b.role === 'machine').length, powerProblems(layout, plan, pack, 2)]).toEqual([mode, 3, []]);
    }
  });

  it('wires a three-tier line with two machines per tier, in every mode', async () => {
    // HV ahead of MV ahead of LV in flow order, a machine of each tier in each row: each tier's tree has to get past the
    // runs and trees of the tiers below it
    const plan = makePlan([
      { id: 'h', mteId: IDS.CHEM_HV, count: 2, tier: 3, euPerTick: 256 },
      { id: 'm', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 64 },
      { id: 'l', mteId: IDS.MACERATOR, count: 2, euPerTick: 16 },
    ]);
    for (const mode of MODES) {
      const pack = layoutPack();
      const layout = await layoutLine(pack, plan, netScan(3), makeProject({ logistics: mode }), ground());
      expect([mode, layout.buildSteps.filter((s) => s.id.startsWith('layout:power:wire:')).map((s) => s.id), powerProblems(layout, plan, pack, 3)])
        .toEqual([mode, ['layout:power:wire:3', 'layout:power:wire:2', 'layout:power:wire:1'], []]);
    }
  });

  it('wires every machine of random LV, MV and HV lines in every mode, and no two tiers touch', async () => {
    // 200 chained plans of 2–4 steps, each step 1–3 machines of a random tier (now and then 1–2 MV blast furnaces), on an
    // MV or HV network, each laid out in all three modes without voxels; the fixed seed lays out the same 600 lines every run
    const random = seeded(20261019);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
    const singleblocks: Record<number, { mteId: number; euPerTick: number[] }> = {
      1: { mteId: IDS.MACERATOR, euPerTick: [8, 16, 30] }, 2: { mteId: IDS.ASSEMBLER, euPerTick: [64, 120] }, 3: { mteId: IDS.CHEM_HV, euPerTick: [256, 480] },
    };
    const pack = layoutPack();
    const fedAt = [0, 0, 0];                                                          // plans fed at one, two and three tiers
    const failed: string[] = [];
    for (let i = 0; i < 200; i++) {
      const steps = Array.from({ length: pick([2, 3, 4]) }, (_, j): StepSpec => {
        if (random() < 1 / 8) return { id: `s${j + 1}`, mteId: IDS.EBF, count: pick([1, 2]), tier: 2, euPerTick: 120 };
        const tier = pick([1, 2, 3]);
        return { id: `s${j + 1}`, mteId: singleblocks[tier]!.mteId, count: pick([1, 2, 3]), tier, euPerTick: pick(singleblocks[tier]!.euPerTick) };
      });
      const supply = pick([2, 3]);
      const plan = makePlan(steps);
      fedAt[new Set(steps.map((s) => Math.min(s.tier!, supply))).size - 1]! += 1;
      for (const mode of MODES) {
        const problems = powerProblems(await layoutLine(pack, plan, netScan(supply), makeProject({ logistics: mode })), plan, pack, supply);
        if (problems.length > 0) {
          failed.push(`${mode} on ${tierName(supply)}, ${steps.map((s) => `${s.count}× ${s.id} ${tierName(s.tier!)}`).join(' → ')}: ${problems[0]!}`);
        }
      }
    }
    // mostly mixed-tier lines (the seed fixes these counts)
    expect(fedAt).toEqual([55, 124, 21]);
    expect({ failed: failed.length, first: failed.slice(0, 5) }).toEqual({ failed: 0, first: [] });
  });

  // Review of the fix above: a higher tier's tree that serves both rows crosses the spine one block up, which walled in a
  // fluid pipe kept to the units' height (and the logistics fill the spine below). Such a pipe climbs over the cable.
  const MI: StuffKey = 'fluid:molten.iron', OX: StuffKey = 'fluid:oxygen';
  /** The fluids a step takes or makes. */
  const fluidsOf = (plan: Plan, stepId: string | undefined): StuffKey[] => {
    const s = plan.steps.find((x) => x.id === stepId);
    return s === undefined ? [] : [...new Set([...s.inputs, ...s.outputs].map((p) => p.key).filter((k) => k.startsWith('fluid:')))];
  };

  /**
   * What is wrong with the line's fluid pipes, as text: every "Could not lay" warning, and every basic machine that takes
   * or makes a fluid without a pipe of that fluid above it, linked down into it and joined (by the pipes' connection bits)
   * to the pipe above every other machine of that fluid.
   */
  function pipeProblems(layout: Layout, plan: Plan, pack: Pack): string[] {
    const out = layout.warnings.filter((w) => w.code === 'route_failed' && w.text.startsWith('Could not lay')).map((w) => w.text);
    const pipes = new Map(layout.blocks.filter((b) => b.role === 'pipe' && b.hookup === undefined).map((b) => [key(b.pos), b]));
    const machines = layout.blocks.filter((b) => b.role === 'machine' && b.mainFacing !== undefined);
    for (const fluid of [...new Set(plan.steps.flatMap((s) => fluidsOf(plan, s.id)))]) {
      const name = pack.nameOf(fluid);
      const ports = machines.filter((m) => fluidsOf(plan, m.stepId).includes(fluid)).map((m) => key(step(m.pos, 1)));
      const joined = new Set<string>();
      const queue = ports.slice(0, 1);
      while (queue.length > 0) {
        const at = queue.shift()!;
        const b = pipes.get(at);
        if (b === undefined || !b.label.endsWith(`(${name})`) || joined.has(at)) continue;
        joined.add(at);
        for (let side = 0; side < 6; side++) if (((b.connections ?? 0) & (1 << side)) !== 0) queue.push(key(step(b.pos, side)));
      }
      for (const p of ports) if (!joined.has(p) || ((pipes.get(p)!.connections ?? 0) & 1) === 0) out.push(`no ${name} pipe into the machine below ${p}`);
    }
    return out;
  }

  it('lays a fluid pipe over a higher tier\'s cable that crosses the spine, in every mode', async () => {
    const plans: Array<[number, Plan]> = [
      // the review's line: the LV extractor stands next to the head, the HV reactors behind it in both rows
      [3, makePlan([
        { id: 'p1', mteId: IDS.CHEM_HV, count: 1, tier: 3, euPerTick: 512, inputs: [['t:in@0', 1], [OX, 1000]] },
        { id: 'p2', mteId: IDS.EXTRACTOR, count: 1, euPerTick: 24, inputs: [['t:out_p1@0', 1]], outputs: [[MI, 144]] },
        { id: 'p3', mteId: IDS.CHEM_HV, count: 1, tier: 3, euPerTick: 128, inputs: [[MI, 1]] },
      ])],
      // an LV extractor feeding two MV assemblers
      [2, makePlan([
        { id: 'x', mteId: IDS.EXTRACTOR, count: 1, euPerTick: 24, outputs: [[MI, 144]] },
        { id: 'a', mteId: IDS.ASSEMBLER, count: 2, tier: 2, euPerTick: 120, inputs: [[MI, 1]] },
      ])],
      // an MV assembler, then an LV extractor feeding another MV assembler
      [2, makePlan([
        { id: 'a', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 },
        { id: 'x', mteId: IDS.EXTRACTOR, count: 1, euPerTick: 24, inputs: [['t:out_a@0', 1]], outputs: [[MI, 144]] },
        { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120, inputs: [[MI, 1]] },
      ])],
    ];
    for (const [supply, plan] of plans) {
      for (const mode of MODES) {
        const pack = layoutPack();
        const layout = await layoutLine(pack, plan, netScan(supply), makeProject({ logistics: mode }), ground());
        expect([plan.steps[0]!.id, mode, pipeProblems(layout, plan, pack), powerProblems(layout, plan, pack, supply)]).toEqual([plan.steps[0]!.id, mode, [], []]);
      }
    }
  });

  it('pipes every fluid of random LV, MV and HV lines in every mode, but a second fluid at a basic machine\'s one port', async () => {
    // 150 chained plans of 2–4 steps, each 1–3 machines of a random tier on an MV or HV network; now and then a step makes
    // molten iron, which the next step takes, or takes oxygen from outside the line (its pipe starts above the tail). A
    // basic machine has one cell above it for all its fluids, so the pipe of a second fluid there may fail
    // (`fluid_port_shared`); in these lines no other pipe does. The fixed seed lays out the same 450 lines every run,
    // without voxels.
    const random = seeded(20261020);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
    const machines: Record<number, { plain: number; makes: number; takes: number; euPerTick: number[] }> = {
      1: { plain: IDS.MACERATOR, makes: IDS.EXTRACTOR, takes: IDS.SOLIDIFIER, euPerTick: [8, 16, 30] },
      2: { plain: IDS.ASSEMBLER, makes: IDS.ASSEMBLER, takes: IDS.ASSEMBLER, euPerTick: [64, 120] },
      3: { plain: IDS.CHEM_HV, makes: IDS.CHEM_HV, takes: IDS.CHEM_HV, euPerTick: [256, 480] },
    };
    const pack = layoutPack();
    let mixed = 0;                                                                    // lines piping molten iron between two feed tiers
    const failed: string[] = [];
    for (let i = 0; i < 150; i++) {
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
      const feed = new Map(steps.map((s) => [s.id, Math.min(s.tier!, supply)]));
      if (flows.some((f) => f.key === MI && feed.has(f.from) && feed.has(f.to) && feed.get(f.from) !== feed.get(f.to))) mixed += 1;
      const plan = makePlan(steps, { flows });
      for (const mode of MODES) {
        const layout = await layoutLine(pack, plan, netScan(supply), makeProject({ logistics: mode }));
        const walled = layout.warnings.filter((w) => w.code === 'route_failed' && w.text.startsWith('Could not lay') && fluidsOf(plan, w.stepId).length < 2);
        const problems = [...walled.map((w) => w.text), ...powerProblems(layout, plan, pack, supply)];
        if (problems.length > 0) {
          failed.push(`${mode} on ${tierName(supply)}, ${steps.map((s) => `${s.count}× ${s.id} ${tierName(s.tier!)} ${fluidsOf(plan, s.id).join('+')}`).join(' → ')}: ${problems[0]!}`);
        }
      }
    }
    expect(mixed).toBe(51);                                                           // the seed fixes this count
    expect({ failed: failed.length, first: failed.slice(0, 5) }).toEqual({ failed: 0, first: [] });
  });
});


// Plan 12 Task 6: a shared machine laid out once, and an exported structure hatch counted once.
describe('layoutLine: shared machines and structure hatches', () => {
  it('places a shared machine once and names the steps it runs', async () => {
    // s1 and s2 of one sharing pool run on one macerator (an AE2 line: the macerator feeds itself)
    const pool = { id: 'pool:s1', steps: ['s1', 's2'] };
    const pooled = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, pool }, { id: 's2', mteId: IDS.MACERATOR, count: 1, pool, inputs: [['t:out_s1@0', 1]] }]);
    const layout = await layoutLine(layoutPack(), pooled, emptyScan(), makeProject({ logistics: 'ae2', scanId: null, baseId: null }));
    expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => [b.stepId, b.stepIds])).toEqual([['s1', ['s1', 's2']]]);
    const place = layout.buildSteps.filter((s) => s.id.startsWith('layout:place:'));
    expect(place.map((s) => s.id)).toEqual(['layout:place:s1']);
    expect(place[0]!.text).toMatch(/^Place 1× Basic Macerator .*; it runs t:out_s1@0 and t:out_s2@0$/);
  });

  it('builds an exported structure hatch at the lowest tier of its class, counted once', async () => {
    // Task 2: the Large Bender's exported structure holds an HV muffler, which Plan 2's build list lists at the lowest tier
    // of its class (the LV one); the layout lays that one and leaves it off its own parts, so it is counted once
    const pack = packFromSpec(largeBenderSpec());
    const settings = { ...defaultSettings(), tier: 1 };
    const plan = makePlan([{ id: 'bend-plate', mteId: 1100, count: 1, tier: 1, inputs: [['t:iron_ingot@0', 1]], outputs: [['t:iron_plate@0', 1]] }]);
    const basis = planBasis(pack, settings, emptyContextForTest());
    plan.buildList = (await buildBom(pack, plan.steps, { settings, env: basis.env, leaf: basis.leaf, ctx: emptyContextForTest() })).lines;
    const layout = await layoutLine(pack, plan, emptyScan(), makeProject({ scanId: null, baseId: null }));
    const mufflers = layout.blocks.filter((b) => b.block.mteId === 91 || b.block.mteId === 93);
    expect(mufflers.map((b) => [b.role, b.block.mteId, b.item, b.label])).toEqual([['hatch', 91, 'machine:91@0', 'Muffler Hatch (LV)']]);
    expect(layout.bom.map((l) => l.key)).not.toContain('machine:91@0');
    expect(layout.bom.map((l) => l.key)).not.toContain('machine:93@0');
    const merged = mergeLayoutIntoPlan(plan, layout, null, (k) => pack.nameOf(k));
    expect(merged.buildList.filter((l) => l.key === 'machine:91@0' || l.key === 'machine:93@0').map((l) => [l.key, l.amount])).toEqual([['machine:91@0', 1]]);
    expect(layout.buildSteps.find((s) => s.id === 'layout:place:bend-plate')!.text).toContain('Muffler Hatch (LV)');
  });
});
