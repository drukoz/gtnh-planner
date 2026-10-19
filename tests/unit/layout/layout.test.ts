import { describe, it, expect } from 'vitest';
import { layoutLine, emptyScan } from '../../../src/server/layout/layout.ts';
import { overlaps } from '../../../src/server/layout/arrange.ts';
import { ae2IdleEUt, resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makePlan, makeProject, makeScan, flatVoxels, areaReader, IDS, STONE } from '../../helpers/layout-fixtures.ts';

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
    expect(layout.power!.detail).toBe('Needs 258 EU/t on average (180 + 78 loss); 900 EU/t spare');
    expect(layout.buildSteps.find((s) => s.id === 'layout:power:hookup')!.text)
      .toBe('Run 6× 2x Annealed Copper Cable from the tap at pin 2 to the line: up to 4 A at MV, arriving at 122 V');
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
    expect(layout.power!.detail).toMatch(/; 0 EU\/t spare$/);
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
    expect(machines.every((b) => b.mainFacing === 1)).toBe(true);                    // front up: the output side keeps the spine face
    expect(new Set(machines.map((b) => b.facing))).toEqual(new Set([4, 5]));         // the two rows face the spine, turned 90°
    expect(machines.every((b) => b.config?.inputFromOutputSide === true)).toBe(true);
  });
});

