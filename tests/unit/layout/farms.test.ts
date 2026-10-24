// Farms in the layout (add-on 17, plan 2026-10-20-17-objectives Task 8; architecture §11 entry 45 (7)): a farm step is
// not laid out block by block — each of its new machines gets an area kept beside the line, with a pin and one build
// step — and what a farm sends to the line enters it as a raw input does. Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { stepDepths, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { FARM_GAP, farmAreas, farmBuildText, farmExtent } from '../../../src/server/layout/farms.ts';
import { hookupPath } from '../../../src/server/layout/hookups.ts';
import { DEFAULT_ORIGIN, emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { edgeFlows } from '../../../src/server/layout/modes/enderio.ts';
import { makePins } from '../../../src/server/layout/pins.ts';
import { layoutSteps, type StepsInput } from '../../../src/server/layout/steps.ts';
import { projectorPayload } from '../../../src/server/projector/payload.ts';
import type { Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { FarmStep } from '../../../src/shared/types/farm.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import type { Machine, Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../../src/shared/types/plan.ts';
import { areaReader, flatVoxels, IDS, layoutPack, makePlan, makeProject, makeScan, STONE, type StepSpec, type VoxSpec } from '../../helpers/layout-fixtures.ts';

const TGS = 15541;
const CROP_MANAGER = 28001;
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });

/** `layoutPack()` with a Tree Growth Simulator (a multiblock), a Basic Crop Manager and the goods their farms make. */
function farmPack(): Pack {
  const pack = layoutPack();
  const machine = (mteId: number, name: string, metaName: string, kind: Machine['kind'], cls: string): Machine => ({
    mteId, metaName, name, cls, itemKey: `gregtech:gt.blockmachines@${mteId}`, kind, maps: [], tier: 1,
  });
  for (const m of [
    machine(TGS, 'Tree Growth Simulator', 'multimachine.treefarm', 'multiblock', 'gregtech.common.tileentities.machines.multi.MTETreeFarm'),
    machine(CROP_MANAGER, 'Basic Crop Manager', 'basicmachine.cropmanager.tier.01', 'basic', 'gregtech.common.tileentities.machines.basic.MTECropManager'),
  ]) {
    pack.machines.set(m.mteId, m);
    pack.items.set(m.itemKey, { key: m.itemKey, id: 'gregtech:gt.blockmachines', meta: m.mteId, name: m.name, oreDict: [] });
  }
  pack.items.set('t:wood@0', { key: 't:wood@0', id: 't:wood', meta: 0, name: 'Rubber Wood', oreDict: [] });
  pack.items.set('t:resin@0', { key: 't:resin@0', id: 't:resin', meta: 0, name: 'Sticky Resin', oreDict: [] });
  return pack;
}

const TGS_TEXT = 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw and Knife (Steel) in an input bus';
/** The crop farm step's own words: both its Crop Managers and all their crop sticks. */
const CROP_TEXT = '2× Basic Crop Manager: 242 crop sticks of Resin Cane (growth 1, gain 1, resistance 1) on Dirt, watering on';
/** What the crop farm plants: its words after the stick count. */
const CROP_PLANTING = 'of Resin Cane (growth 1, gain 1, resistance 1) on Dirt, watering on';
/** The words of an area kept for one of the crop farm's Crop Managers, which tends `sticks` of the step's crop sticks. */
const CROP_AREA = (sticks: number) => `1× Basic Crop Manager: ${sticks} crop sticks ${CROP_PLANTING}`;
const TGS_FARM: FarmStep = { kind: 'tgs', tier: 1, footprint: [7, 7, 7], text: TGS_TEXT };
/** x, height, z: one layer of 11 × 11 crop sticks on their soil; 242 sticks in all, 121 for each of two Crop Managers. */
const CROP_FARM: FarmStep = { kind: 'crop', tier: 1, footprint: [11, 2, 11], text: CROP_TEXT, sticks: 242, planting: CROP_PLANTING };
const TGS_BUILD = (at: string) => `Build the Tree Growth Simulator in the 7×7×7 area${at} as NEI shows its structure: ${TGS_TEXT}; one LV energy hatch, `
  + 'a maintenance hatch, a muffler hatch, an input bus and an output bus. Connect the energy hatch to your power and bring what the output bus fills '
  + 'to the line.';
const CROP_BUILD = (at: string, words: string, layers = '') => `Lay out the 11×11 area${at}: ${words}${layers}, with the Crop Manager in the middle `
  + 'and water in its tank. Connect it to your power and bring what it harvests to the line.';

/** The tree farm: a new Tree Growth Simulator making Rubber Wood. */
const tgsStep = (over: Partial<StepSpec> = {}): StepSpec => ({ id: 'tgs', mteId: TGS, count: 1, inputs: [], outputs: [['t:wood@0', 1]], farm: TGS_FARM, ...over });
/** The crop farm: two new Basic Crop Managers making Sticky Resin from water. */
const cropStep = (over: Partial<StepSpec> = {}): StepSpec => ({
  id: 'crop', mteId: CROP_MANAGER, name: 'Basic Crop Manager', count: 2, inputs: [['fluid:water', 20]], outputs: [['t:resin@0', 1]], farm: CROP_FARM,
  ...over,
});
/** The line: one macerator taking `takes`. */
const lineStep = (takes: readonly string[], over: Partial<StepSpec> = {}): StepSpec => ({
  id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: takes.map((k): [string, number] => [k, 1]), ...over,
});
const OUT: PlanFlow = { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 0.5 };

/** The line fed by the tree farm. */
const tgsPlan = (farm: Partial<StepSpec> = {}, line: Partial<StepSpec> = {}): Plan => makePlan([lineStep(['t:wood@0'], line), tgsStep(farm)],
  { flows: [{ from: 'tgs', to: 's1', key: 't:wood@0', perSecond: 0.5 }, OUT] });
/** The same line with its wood bought: no farm step. */
const barePlan = (): Plan => makePlan([lineStep(['t:wood@0'])], { flows: [{ from: 'raw', to: 's1', key: 't:wood@0', perSecond: 0.5 }, OUT] });

const BASE = { center: [20, 64, 20] as Vec3, bbox: { minX: 16, minY: 64, minZ: 16, maxX: 24, maxY: 65, maxZ: 24 } };
/** Scan 'S1': the base with `machines`, and an MV network tapped at `tap` on a cable rated for the line. */
const scan = (machines: Array<{ pos: Vec3; mteId: number }> = [], tap: Vec3 = [16, 64, 30]) => makeScan({
  base: BASE, machines, power: [{ voltageTier: 2, average: 1000, loadEUt: 100, storedEU: 10_000_000, taps: [{ pos: tap, freeAmps: 8, cableAmps: 8 }] }],
});
/** Flat stone ground at y 63 around the base, with `boxes` on it. */
const ground = (boxes: NonNullable<VoxSpec['boxes']> = []) => ({
  readArea: areaReader(flatVoxels({ origin: [-30, 50, -30], size: [140, 30, 140], groundY: 63, boxes })),
});
/** Whether column (x, z) of `p` lies in the world box at `pos` of `size`. */
const inColumns = (p: readonly number[], pos: readonly number[], size: readonly number[]) =>
  p[0]! >= pos[0]! && p[0]! < pos[0]! + size[0]! && p[2]! >= pos[2]! && p[2]! < pos[2]! + size[2]!;
/** At the chosen spot, turned or not. */
const placedAt = (rotation: 0 | 90 = 0, logistics: 'direct' | 'enderio' = 'direct') =>
  makeProject({ logistics, placement: { origin: [30, 64, 30], rotation } });

describe('farm areas', () => {
  it('stacks the areas of every farm step along z beside the line, by step id', () => {
    const plan = makePlan([lineStep(['t:wood@0']), tgsStep({ id: 'z-tgs' }), cropStep({ id: 'a-crop', count: 3, owned: 2 })], { flows: [] });
    const areas = farmAreas(plan, [5, 2, 4]);
    // the one new Crop Manager of three takes the first share of the step's 242 crop sticks (81, 81 and 80)
    expect(areas).toEqual([
      { stepId: 'a-crop', local: [7, 0, 0], size: [11, 2, 11], text: `Farm: ${CROP_AREA(81)}`, words: CROP_AREA(81) },
      { stepId: 'z-tgs', local: [7, 0, 13], size: [7, 7, 7], text: `Farm: ${TGS_TEXT}`, words: TGS_TEXT },
    ]);
    expect(FARM_GAP).toBe(2);
    expect(farmExtent([5, 2, 4], areas)).toEqual([18, 7, 20]);
    expect(farmExtent([5, 2, 4], [])).toEqual([5, 2, 4]);
    expect(farmAreas(barePlan(), [5, 2, 4])).toEqual([]);
    // without a line (its other machines all owned) there is nothing to keep a gap from
    expect(farmAreas(plan, [0, 0, 0]).map((a) => a.local)).toEqual([[0, 0, 0], [0, 0, 13]]);
  });

  it('words the build step of each kind of farm, and names the pin only when there is one', () => {
    const tgs = makePlan([tgsStep()]);
    expect(farmBuildText(tgs.steps[0]!, farmAreas(tgs, [5, 2, 7])[0]!, 3)).toBe(TGS_BUILD(' at pin 3'));
    expect(farmBuildText(tgs.steps[0]!, farmAreas(tgs, [5, 2, 7])[0]!)).toBe(TGS_BUILD(''));
    const crop = makePlan([cropStep()]);
    expect(farmBuildText(crop.steps[0]!, farmAreas(crop, [5, 2, 7])[0]!, 4)).toBe(CROP_BUILD(' at pin 4', CROP_AREA(121)));
    // two layers of soil and sticks stand 4 high
    const layered = makePlan([cropStep({ farm: { ...CROP_FARM, footprint: [11, 4, 11] } })]);
    const layers = ", 2 layers of soil and sticks stacked inside the Crop Manager's reach";
    expect(farmBuildText(layered.steps[0]!, farmAreas(layered, [5, 2, 7])[0]!, 4)).toBe(CROP_BUILD(' at pin 4', CROP_AREA(121), layers));
    expect(farmBuildText(layered.steps[0]!, farmAreas(layered, [5, 2, 7])[0]!)).toBe(CROP_BUILD('', CROP_AREA(121), layers));
  });

  it('words each crop area for its own Crop Manager, the step\'s crop sticks split evenly over its machines', () => {
    // 241 sticks over two Crop Managers: the first share takes the one left over, and the shares add up to the step's
    const odd = makePlan([cropStep({ farm: { ...CROP_FARM, sticks: 241 } })]);
    const areas = farmAreas(odd, [5, 2, 7]);
    expect(areas.map((a) => a.text)).toEqual([`Farm: ${CROP_AREA(121)}`, `Farm: ${CROP_AREA(120)}`]);
    expect(areas.map((a, i) => farmBuildText(odd.steps[0]!, a, 3 + i))).toEqual([CROP_BUILD(' at pin 3', CROP_AREA(121)), CROP_BUILD(' at pin 4', CROP_AREA(120))]);
    // the new machines' areas take the first shares
    expect(farmAreas(makePlan([cropStep({ owned: 1, farm: { ...CROP_FARM, sticks: 241 } })]), [5, 2, 7]).map((a) => a.words)).toEqual([CROP_AREA(121)]);
    // one crop stick is said as one
    expect(farmAreas(makePlan([cropStep({ farm: { ...CROP_FARM, sticks: 3 } })]), [5, 2, 7]).map((a) => a.words)).toEqual([
      CROP_AREA(2), `1× Basic Crop Manager: 1 crop stick ${CROP_PLANTING}`]);
    // a crop farm step without its planting or its sticks (one built by hand) keeps the step's words
    const unplanted = makePlan([cropStep({ farm: { kind: 'crop', tier: 1, footprint: [11, 2, 11], text: CROP_TEXT, sticks: 242 } })]);
    expect(farmAreas(unplanted, [5, 2, 7]).map((a) => a.text)).toEqual([`Farm: ${CROP_TEXT}`, `Farm: ${CROP_TEXT}`]);
    const uncounted = makePlan([cropStep({ farm: { kind: 'crop', tier: 1, footprint: [11, 2, 11], text: CROP_TEXT, planting: CROP_PLANTING } })]);
    expect(farmAreas(uncounted, [5, 2, 7]).map((a) => a.words)).toEqual([CROP_TEXT, CROP_TEXT]);
  });

  it('numbers the farm pins after the reuse pins and before the warnings', () => {
    const pins = makePins({ dim: 0, site: { center: [5, 64, 5], text: 'Build the line here' }, power: null, logistics: null,
      reuse: [{ stepId: 's1', name: 'Basic Macerator', count: 1, positions: [[3, 64, 3]] }],
      farms: [{ pos: [12, 64, 3], text: 'Farm: A' }, { pos: [12, 64, 12], text: 'Farm: B' }],
      warnings: [{ code: 'site_not_clear', text: 'Nothing clear nearby', pos: [5, 64, 5] }] });
    expect(pins.map((p) => [p.n, p.kind, p.pos, p.text])).toEqual([
      [1, 'site', [5, 64, 5], 'Build the line here'], [2, 'reuse', [3, 64, 3], 'Reuse your 1× Basic Macerator'],
      [3, 'farm', [12, 64, 3], 'Farm: A'], [4, 'farm', [12, 64, 12], 'Farm: B'], [5, 'warning', [5, 64, 5], 'Nothing clear nearby']]);
  });

  it('gives each area one place step after the line\'s place steps, numbered per farm step', () => {
    const input = (over: Partial<StepsInput>): StepsInput => ({ status: 'ok', pins: [], size: [6, 1, 5], site: null, units: [], stages: [],
      transformerName: () => 'Low Voltage Transformer', cables: [], power: null, supplyTier: null, drafts: [], fluids: [], logistics: null,
      reuse: [{ stepId: 'm', name: 'Basic Macerator', count: 1, positions: [[3, 64, 3]] }], blocks: [], origin: [0, 64, 0], rotation: 0,
      nameOf: (k) => k, ...over });
    const farms = [{ stepId: 'crop', text: 'Lay out A', pin: 3 }, { stepId: 'crop', text: 'Lay out B', pin: 4 }, { stepId: 'tgs', text: 'Build C' }];
    const ok = layoutSteps(input({ farms, siteSize: [20, 7, 13] }));
    expect(ok.map((s) => s.id)).toEqual(['layout:site', 'layout:roof', 'layout:farm:crop', 'layout:farm:crop:2', 'layout:farm:tgs',
      'layout:reuse:m', 'layout:test']);
    expect(ok.filter((s) => s.id.startsWith('layout:farm:')).map((s) => [s.kind, s.pin, s.text]))
      .toEqual([['place', 3, 'Lay out A'], ['place', 4, 'Lay out B'], ['place', undefined, 'Build C']]);
    // the clear step names the box the site search found clear, the line's and its farm areas' (the site pin stays in
    // the middle of the line's own box: the final review's T8-a); the roof stays the line's own
    expect(ok[0]!.text).toBe('Clear a 20×13 spot for the line and its farm areas (7 high) and keep a 1-block path around it');
    expect(ok[1]!.text).toBe('Roof the line: GT machines left in the rain can catch fire or explode');
    // with pins, from the line at its pin to the farm areas at theirs
    const site = { n: 1, dim: 0, pos: [3, 64, 2] as Vec3, kind: 'site' as const, text: 'Build the line here' };
    const pinned = farms.map((f, i) => ({ ...f, pin: 3 + i }));
    expect(layoutSteps(input({ pins: [site], farms: pinned, siteSize: [20, 7, 13] }))[0]!.text)
      .toBe('Clear a 20×13 spot from the line at pin 1 to the farm areas at pins 3, 4 and 5 (7 high) and keep a 1-block path around it');
    expect(layoutSteps(input({ pins: [site], farms: pinned.slice(0, 1), siteSize: [20, 7, 13] }))[0]!.text)
      .toBe('Clear a 20×13 spot from the line at pin 1 to the farm area at pin 3 (7 high) and keep a 1-block path around it');
    // without farms, the line's own spot at its pin
    expect(layoutSteps(input({ pins: [site] }))[0]!.text).toBe('Clear a 6×5 spot at pin 1 (1 high) and keep a 1-block path around it');
    // nothing of the line to place: the areas still get their steps, before the owned machines' hook steps
    expect(layoutSteps(input({ status: 'empty', farms })).map((s) => s.id))
      .toEqual(['layout:farm:crop', 'layout:farm:crop:2', 'layout:farm:tgs', 'layout:reuse:m']);
  });

  it('never looks up the machine of a farm step', () => {
    // layoutPack() has no Tree Growth Simulator: a farm step is passed over before its machine is looked up
    const { units, warnings } = unitsFromPlan(layoutPack(), tgsPlan());
    expect([units.map((u) => u.stepId), warnings]).toEqual([['s1'], []]);
  });

  it('keeps a hookup out of the columns of an area kept for a farm', () => {
    const area = { min: [6, 64, -3] as Vec3, max: [10, 70, 3] as Vec3 };
    const crosses = (path: readonly Vec3[]) => path.some((p) => p[0] >= 6 && p[0] <= 10 && p[2] >= -3 && p[2] <= 3);
    expect(crosses(hookupPath({ vox: null, line: new Set() }, [16, 64, 0], [[0, 64, 0]]).path)).toBe(true);
    const round = hookupPath({ vox: null, line: new Set(), areas: [area] }, [16, 64, 0], [[0, 64, 0]]);
    expect(round.path.length).toBeGreaterThan(0);
    expect(crosses(round.path)).toBe(false);
  });
});

describe('farms in the layout', () => {
  it('reserves an area for a farm instead of placing its blocks', async () => {
    const pack = farmPack();
    const width = (await layoutLine(pack, barePlan(), emptyScan(), makeProject())).size[0];
    const layout = await layoutLine(pack, tgsPlan(), emptyScan(), makeProject());
    expect(layout.blocks.some((b) => b.stepId === 'tgs' || b.stepIds?.includes('tgs') === true)).toBe(false);
    expect(layout.warnings.map((w) => w.code)).not.toContain('structure_unknown');
    expect([layout.origin, layout.rotation]).toEqual([DEFAULT_ORIGIN, 0]);
    // without a scan base there are no pins: the area and its build step name none (ruling S3)
    expect(layout.reserved).toEqual([{
      stepId: 'tgs', pos: [DEFAULT_ORIGIN[0] + width + FARM_GAP, DEFAULT_ORIGIN[1], DEFAULT_ORIGIN[2]], size: [7, 7, 7], text: `Farm: ${TGS_TEXT}`,
    }]);
    expect(layout.pins).toEqual([]);
    const ids = layout.buildSteps.map((s) => s.id);
    expect(layout.buildSteps.find((s) => s.id === 'layout:farm:tgs'))
      .toEqual({ id: 'layout:farm:tgs', order: ids.indexOf('layout:place:s1') + 2, text: TGS_BUILD(''), kind: 'place' });
    expect(layout.size[0]).toBe(width + 2 + 7);
    expect(layout.size[1]).toBeGreaterThanOrEqual(7);
  });

  it('pins the area with a scan base and names that pin in its build step', async () => {
    const pack = farmPack();
    const bare = await layoutLine(pack, barePlan(), scan(), placedAt(), ground());
    const layout = await layoutLine(pack, tgsPlan(), scan(), placedAt(), ground());
    const [width, height, length] = bare.size;
    expect([layout.status, layout.origin, layout.rotation]).toEqual(['ok', [30, 64, 30], 0]);
    const farmPins = layout.pins.filter((p) => p.kind === 'farm');
    // the pin stands in the middle of the area's floor
    expect(farmPins).toEqual([{ n: 3, dim: 0, pos: [30 + width + 2 + 3, 64, 33], kind: 'farm', text: `Farm: ${TGS_TEXT}` }]);
    expect(layout.reserved).toEqual([{
      stepId: 'tgs', pos: [layout.origin[0] + width + 2, layout.origin[1], layout.origin[2]], size: [7, 7, 7], pin: 3, text: `Farm: ${TGS_TEXT}`,
    }]);
    expect(layout.buildSteps.find((s) => s.id === 'layout:farm:tgs')).toMatchObject({ kind: 'place', pin: 3, text: TGS_BUILD(' at pin 3') });
    expect(layout.buildSteps.find((s) => s.id === 'layout:farm:tgs')!.text.startsWith('Build the Tree Growth Simulator in the 7×7×7 area at pin ')).toBe(true);
    expect(layout.size).toEqual([width + 2 + 7, Math.max(height, 7), Math.max(length, 7)]);
    // the site pin, its words and the roof stay the line's own; the clear step names the line and its farm's area together,
    // from the line at its pin to the area at its own (the final review's T8-a: pin 1 is not the spot's middle)
    expect(layout.pins.find((p) => p.kind === 'site')).toEqual(bare.pins.find((p) => p.kind === 'site'));
    expect(layout.buildSteps.find((s) => s.id === 'layout:roof')!.text).toBe(bare.buildSteps.find((s) => s.id === 'layout:roof')!.text);
    expect(layout.buildSteps.find((s) => s.id === 'layout:site')!.text).toBe(`Clear a ${width + 9}×${Math.max(length, 7)} spot from the line at pin 1 `
      + `to the farm area at pin 3 (${Math.max(height, 7)} high) and keep a 1-block path around it`);
    // the chosen spot is checked over the farm's area too
    const stone = await layoutLine(pack, tgsPlan(), scan(), placedAt(), ground([{ from: [30 + width + 5, 64, 33], to: [30 + width + 5, 64, 33], block: STONE }]));
    expect(stone.warnings).toContainEqual({ code: 'placement_blocked', text: '1 block is in the way at the chosen spot' });
  });

  it('turns the areas with the line', async () => {
    const pack = farmPack();
    const bare = await layoutLine(pack, barePlan(), scan(), placedAt(90), ground());
    const turned = await layoutLine(pack, tgsPlan(), scan(), placedAt(90), ground());
    // a quarter turn clockwise: the line's x runs along the world's z, and its z against the world's x
    const [length, , width] = bare.size;
    expect([turned.origin, turned.rotation]).toEqual([[30, 64, 30], 90]);
    expect(turned.reserved!.map((a) => [a.pos, a.size])).toEqual([[[30 + turned.size[0] - 7, 64, 30 + width + 2], [7, 7, 7]]]);
    expect(turned.size[2]).toBe(width + 2 + 7);
    const area = turned.reserved![0]!;
    expect(turned.blocks.filter((b) => inColumns(b.pos, area.pos, area.size))).toEqual([]);
    // the line keeps its place in the box it shares with the area: moved along x by what the area adds to the box there,
    // its machines and its site pin alike
    const shift = turned.size[0] - length;
    const machines = (l: Layout) => l.blocks.filter((b) => b.role === 'machine').map((b) => b.pos);
    expect(machines(turned)).toEqual(machines(bare).map((p) => [p[0] + shift, p[1], p[2]]));
    const site = bare.pins.find((p) => p.kind === 'site')!;
    expect(turned.pins.find((p) => p.kind === 'site')).toEqual({ ...site, pos: [site.pos[0] + shift, site.pos[1], site.pos[2]] });
  });

  it('finds clear, flat ground for the line and its farms together', async () => {
    const pack = farmPack();
    const first = await layoutLine(pack, tgsPlan(), scan(), makeProject(), ground());
    const area = first.reserved![0]!;
    // a pillar in the middle of where the farm went, five blocks clear of the line: the line alone would still fit there
    const pillar: Vec3 = [area.pos[0] + 3, 64, area.pos[2] + 3];
    const moved = await layoutLine(pack, tgsPlan(), scan(), makeProject(), ground([{ from: pillar, to: [pillar[0], 66, pillar[2]], block: STONE }]));
    expect(inColumns(pillar, first.origin, first.size)).toBe(true);
    expect(inColumns(pillar, moved.origin, moved.size)).toBe(false);
    expect(moved.warnings.map((w) => w.code)).not.toContain('site_not_clear');
  });

  it('reserves one area per new farm machine', async () => {
    const pack = farmPack();
    const plan = (owned: number) => makePlan([lineStep(['t:resin@0']), cropStep({ owned })],
      { flows: [{ from: 'crop', to: 's1', key: 't:resin@0', perSecond: 0.5 }, OUT] });
    const two = await layoutLine(pack, plan(0), emptyScan(), makeProject());
    expect(two.reserved!.map((a) => a.size)).toEqual([[11, 2, 11], [11, 2, 11]]);
    const [a, b] = two.reserved!;
    expect([b!.pos[0] - a!.pos[0], b!.pos[1] - a!.pos[1], b!.pos[2] - a!.pos[2]]).toEqual([0, 0, 13]);
    expect(two.size[2]).toBe(11 + FARM_GAP + 11);
    // each area is one Crop Manager's, with its half of the step's 242 crop sticks
    const words = '1× Basic Crop Manager: 121 crop sticks of Resin Cane (growth 1, gain 1, resistance 1) on Dirt, watering on';
    expect(two.reserved!.map((a) => a.text)).toEqual([`Farm: ${words}`, `Farm: ${words}`]);
    expect(two.buildSteps.filter((s) => s.id.startsWith('layout:farm:')).map((s) => [s.id, s.kind, s.text]))
      .toEqual([['layout:farm:crop', 'place', CROP_BUILD('', words)], ['layout:farm:crop:2', 'place', CROP_BUILD('', words)]]);
    // with a scan base, each area's pin says the same
    const pinned = await layoutLine(pack, plan(0), scan(), placedAt(), ground());
    expect(pinned.pins.filter((p) => p.kind === 'farm').map((p) => p.text)).toEqual([`Farm: ${words}`, `Farm: ${words}`]);
    const one = await layoutLine(pack, plan(1), emptyScan(), makeProject());
    expect(one.reserved!.map((a) => a.text)).toEqual([`Farm: ${words}`]);
  });

  it('gives an owned farm a reuse pin and no area', async () => {
    const pack = farmPack();
    const layout = await layoutLine(pack, tgsPlan({ owned: 1 }), scan([{ pos: [18, 64, 18], mteId: TGS }]), makeProject(),
      ground([{ from: [18, 64, 18], to: [18, 64, 18], block: GT(TGS) }]));
    expect(layout.reserved).toBeUndefined();
    expect(layout.pins.filter((p) => p.kind === 'reuse' || p.kind === 'farm').map((p) => [p.kind, p.pos, p.text]))
      .toEqual([['reuse', [18, 64, 18], 'Reuse your 1× Tree Growth Simulator']]);
    expect(layout.buildSteps.map((s) => s.id)).toContain('layout:reuse:tgs');
    expect(layout.buildSteps.some((s) => s.id.startsWith('layout:farm:'))).toBe(false);
  });

  it('lays out the farms of a line whose other machines are all owned', async () => {
    // ruling S12: no unit to place, but the new farm still gets its area and its build step; and the final review's T8-b:
    // the farm is something new to build, so the layout is no `empty` one (which says every step runs on owned machines)
    // but, as any line, `no-world` without a base and `ok` with one
    const pack = farmPack();
    const plan = tgsPlan({}, { owned: 1 });
    const bare = await layoutLine(pack, plan, emptyScan(), makeProject());
    expect([bare.status, bare.blocks, bare.pins, bare.origin, bare.size]).toEqual(['no-world', [], [], DEFAULT_ORIGIN, [7, 7, 7]]);
    expect(bare.reserved).toEqual([{ stepId: 'tgs', pos: DEFAULT_ORIGIN, size: [7, 7, 7], text: `Farm: ${TGS_TEXT}` }]);
    expect(bare.buildSteps.map((s) => [s.id, s.kind, s.text])).toEqual([['layout:farm:tgs', 'place', TGS_BUILD('')]]);
    // with a base: the farm's ground is found near it, its pin after the owned machine's
    const placed = await layoutLine(pack, plan, scan([{ pos: [18, 64, 18], mteId: IDS.MACERATOR }]), makeProject(),
      ground([{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }]));
    expect(placed.status).toBe('ok');
    expect(placed.pins.map((p) => [p.n, p.kind])).toEqual([[1, 'reuse'], [2, 'farm']]);
    expect(placed.reserved).toEqual([{ stepId: 'tgs', pos: placed.origin, size: [7, 7, 7], pin: 2, text: `Farm: ${TGS_TEXT}` }]);
    expect(placed.size).toEqual([7, 7, 7]);
    expect(placed.buildSteps.map((s) => [s.id, s.pin])).toEqual([['layout:farm:tgs', 2], ['layout:reuse:s1', 1]]);
    expect(placed.buildSteps[0]!.text).toBe(TGS_BUILD(' at pin 2'));
    // what is in the way of a chosen spot is said and pinned there
    const blocked = await layoutLine(pack, plan, scan([{ pos: [18, 64, 18], mteId: IDS.MACERATOR }]), placedAt(),
      ground([{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }, { from: [31, 64, 31], to: [31, 64, 31], block: STONE }]));
    expect(blocked.reserved!.map((a) => a.pos)).toEqual([[30, 64, 30]]);
    expect(blocked.status).toBe('ok');
    expect(blocked.warnings).toContainEqual({ code: 'placement_blocked', text: '1 block is in the way at the chosen spot' });
    expect(blocked.pins.at(-1)).toMatchObject({ kind: 'warning', pos: [33, 64, 33], text: '1 block is in the way at the chosen spot' });
    // the projector sends that layout's steps, the farm's among them (no blocks: a farm has none), and no "nothing to
    // build" message
    const payload = projectorPayload(makeProject(), placed, pack);
    expect([payload.status, payload.message, payload.blocks]).toEqual(['ok', null, []]);
    expect(payload.steps.map((s) => [s.id, s.blocks])).toEqual([['layout:farm:tgs', []], ['layout:reuse:s1', []]]);
    // with every machine owned, the farm too, there is nothing new to build: `empty`
    const owned = await layoutLine(pack, tgsPlan({ owned: 1 }, { owned: 1 }), scan([{ pos: [18, 64, 18], mteId: IDS.MACERATOR }]), makeProject(),
      ground([{ from: [18, 64, 18], to: [18, 64, 18], block: GT(IDS.MACERATOR) }]));
    expect([owned.status, owned.reserved]).toEqual(['empty', undefined]);
  });

  it('takes what a farm sends to the line in through the input chest', async () => {
    const pack = farmPack();
    const plan = makePlan([lineStep(['t:in@0', 't:wood@0']), tgsStep()], { flows: [
      { from: 'tgs', to: 's1', key: 't:wood@0', perSecond: 0.5 }, { from: 'raw', to: 's1', key: 't:in@0', perSecond: 0.25 }, OUT] });
    const inputChest = (l: Layout) => l.blocks.find((b) => b.tail?.side === 'input');
    const direct = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: 'direct' }));
    const routed = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: 'routed' }));
    expect(inputChest(direct)?.tail?.keys).toEqual(['t:in@0', 't:wood@0']);
    expect(inputChest(routed)?.tail?.keys).toEqual(['t:in@0', 't:wood@0']);
    // the conveyor cover that pulls the input chest onto direct's pipe moves both: 0.5 + 0.25 items a second
    expect(direct.blocks.flatMap((b) => b.covers ?? []).filter((c) => c.settings.mode === 'import').map((c) => c.settings.rate)).toEqual([0.75]);
    // EnderIO takes a flow from outside the placed steps in at the tail
    expect(edgeFlows(plan.flows, new Set(['s1'])).entering.map((f) => [f.from, f.key])).toEqual([['tgs', 't:wood@0'], ['raw', 't:in@0']]);
    const enderio = await layoutLine(pack, plan, emptyScan(), makeProject({ logistics: 'enderio' }));
    expect(inputChest(enderio)?.tail?.keys).toEqual(['t:in@0', 't:wood@0']);
    // the line step is fed as by a raw input, not one deeper than a step that is never laid out
    expect(stepDepths(plan).get('s1')).toBe(0);
  });

  it('lays out a crop farm watered from a placed pump, and routes nothing into its area', async () => {
    // ruling R20: the pump's water for the farm stays unrouted, as flows into steps the layout never places are (the farm's
    // build step says to keep water in its tank); a power hookup from a tap beyond the farm goes round its area
    const pack = farmPack();
    const plan = makePlan([lineStep(['t:resin@0']), { id: 'pump', mteId: IDS.EXTRACTOR, count: 1, inputs: [], outputs: [['fluid:water', 20]] },
      cropStep({ count: 1 })],
    { flows: [{ from: 'pump', to: 'crop', key: 'fluid:water', perSecond: 20 }, { from: 'crop', to: 's1', key: 't:resin@0', perSecond: 0.5 }, OUT] });
    for (const logistics of ['direct', 'enderio'] as const) {
      const first = await layoutLine(pack, plan, scan(), placedAt(0, logistics), ground());
      const area = first.reserved![0]!;
      const tap: Vec3 = [area.pos[0] + area.size[0] + 4, 64, area.pos[2] + 5];
      const layout = await layoutLine(pack, plan, scan([], tap), placedAt(0, logistics), ground());
      expect(layout.reserved).toEqual(first.reserved);
      expect(layout.blocks.filter((b) => inColumns(b.pos, area.pos, area.size)).map((b) => [b.role, b.pos])).toEqual([]);
      expect(layout.hookups.map((h) => [h.kind, h.found])).toEqual([['power', true]]);
      expect(layout.hookups[0]!.path.filter((p) => inColumns(p, area.pos, area.size))).toEqual([]);
      expect(layout.blocks.filter((b) => b.role === 'machine').map((b) => b.stepId).sort()).toEqual(['pump', 's1']);
    }
  });
});
