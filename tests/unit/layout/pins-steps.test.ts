import { describe, it, expect } from 'vitest';
import { makePins, pinNumber, findReuse, siteText, powerText, logisticsText } from '../../../src/server/layout/pins.ts';
import { layoutSteps, bomFromBlocks, assignBuildSteps, type StepsInput } from '../../../src/server/layout/steps.ts';
import { coverText, configTexts } from '../../../src/shared/layout/configure-text.ts';
import { unitsFromPlan, placeUnits } from '../../../src/server/layout/arrange.ts';
import { layoutPack, makePlan, makeScan, IDS, STONE } from '../../helpers/layout-fixtures.ts';
import type { Hookup, LayoutBlock } from '../../../src/shared/types/layout.ts';

const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });
const PUMP = 'gregtech:gt.metaitem.01@32610';
const CONV = 'gregtech:gt.metaitem.01@32630';
const FILTER = 'gregtech:gt.metaitem.01@32270';
const NAMES: Record<string, string> = { [PUMP]: 'Electric Pump (LV)', [CONV]: 'Conveyor Module (LV)', [FILTER]: 'Filtered Conveyor Cover (Export)', 't:ingot@0': 'Titanium Ingot' };
const nameOf = (k: string) => NAMES[k] ?? k;
const base = (over: Partial<StepsInput>): StepsInput => ({ status: 'ok', pins: [], size: [6, 1, 5], site: null, units: [], stages: [],
  transformerName: () => 'Low Voltage Transformer', cables: [], power: null, supplyTier: null, drafts: [], fluids: [], logistics: null, reuse: [],
  blocks: [], origin: [0, 64, 0], nameOf, ...over });

describe('pins', () => {
  it('numbers pins site, power, logistics, reuse, then warnings', () => {
    const pins = makePins({ dim: 0,
      site: { center: [10, 64, 10], text: siteText([4, 1, 5]) },
      power: { pos: [0, 64, 0], text: powerText({ pos: [0, 64, 0], dim: 0, kind: 'power', voltageTier: 1, freeAmps: 4, networkId: 'p' }, 2) },
      logistics: { pos: [2, 64, 2], text: logisticsText('routed') },
      reuse: [{ stepId: 's1', name: 'Basic Macerator', count: 1, positions: [[3, 64, 3]] }],
      warnings: [{ code: 'site_not_clear', text: 'Nothing clear nearby', pos: [10, 64, 10] }] });
    expect(pins).toEqual([
      { n: 1, dim: 0, pos: [10, 64, 10], kind: 'site', text: 'Build the line here (4×5, 1 high)' },
      { n: 2, dim: 0, pos: [0, 64, 0], kind: 'power', text: 'Tap power here: LV, 4 A free (the line needs 2 A)' },
      { n: 3, dim: 0, pos: [2, 64, 2], kind: 'logistics', text: 'Hook logistics here: Project Red routed network' },
      { n: 4, dim: 0, pos: [3, 64, 3], kind: 'reuse', text: 'Reuse your 1× Basic Macerator' },
      { n: 5, dim: 0, pos: [10, 64, 10], kind: 'warning', text: 'Nothing clear nearby' }]);
    expect(pinNumber(pins, 'logistics')).toBe(3);
  });

  it('finds owned machines to reuse, nearest first', () => {
    const scan = makeScan({ machines: [{ pos: [30, 64, 30], mteId: IDS.MACERATOR }, { pos: [2, 64, 2], mteId: IDS.MACERATOR }, { pos: [5, 64, 5], mteId: IDS.ASSEMBLER }] });
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 3, owned: 2 }, { id: 's2', mteId: IDS.CHEM_HV, count: 1, owned: 1, tier: 3 }]);
    expect(findReuse(layoutPack(), plan, scan, scan.bases[0]!, [0, 64, 0])).toEqual([
      { stepId: 's1', name: 'Basic Macerator', count: 2, positions: [[2, 64, 2], [30, 64, 30]] }]);
  });
});

describe('layout steps', () => {
  it('lists site, placing, power, logistics, configure and test steps linked to pins', () => {
    const pack = layoutPack();
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2 }, { id: 's2', mteId: IDS.ASSEMBLER, count: 1, tier: 2, euPerTick: 120 }]);
    const placement = placeUnits(unitsFromPlan(pack, plan).units, { headWidth: 3, portSpacing: 0 });
    const pins = makePins({ dim: 0, site: { center: [5, 64, 5], text: 's' }, power: { pos: [0, 64, 0], text: 'p' }, logistics: null, reuse: [], warnings: [] });
    const steps = layoutSteps(base({ pins, site: { dig: 2, fill: 0 }, units: placement.units,
      stages: [{ fromTier: 2, toTier: 1, count: 1, ampsIn: 1, ampsOut: 2 }],
      cables: [{ tier: 2, cable: '2x Annealed Copper Cable', cells: 8 }, { tier: 1, cable: '2x Tin Cable', cells: 7 }],
      power: { cable: '2x Annealed Copper Cable', blocks: 12, amps: 2, tier: 2, arrivingVolts: 116 }, supplyTier: 2,
      drafts: [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site', text: 'Lay pipe' }, { id: 'layout:configure:s1', kind: 'configure', pin: null, text: 'Set covers' }] }));
    expect(steps.map((s) => [s.order, s.id, s.kind, s.pin])).toEqual([
      [1, 'layout:site', 'place', 1], [2, 'layout:roof', 'place', 1], [3, 'layout:place:s1', 'place', 1], [4, 'layout:place:s2', 'place', 1],
      [5, 'layout:power:stage:1', 'power', 2], [6, 'layout:power:wire:2', 'power', 1], [7, 'layout:power:wire:1', 'power', 1],
      [8, 'layout:power:hookup', 'power', 2], [9, 'layout:logistics:line', 'logistics', 1], [10, 'layout:configure:s1', 'configure', undefined],
      [11, 'layout:test', 'test', 1]]);
    expect(steps[0]!.text).toBe('Clear a 6×5 spot at pin 1 (1 high) and keep a 1-block path around it; dig 2 and fill 0 blocks to level it');
    expect(steps[2]!.text).toBe('Place 2× Basic Macerator facing the middle row');
    expect(steps[4]!.text).toBe('Place 1× Low Voltage Transformer between the MV and LV cables, front (input) toward MV');
    expect(steps[7]!.text).toBe('Run 12× 2x Annealed Copper Cable from the tap at pin 2 to the line: up to 2 A at MV, arriving at 116 V');
  });

  it('describes multiblocks with their hatches and drops pins without a world', () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120,
      inputs: [['t:dust@0', 1], ['fluid:oxygen', 1000]], outputs: [['t:ingot@0', 1]] }]);
    const placement = placeUnits(unitsFromPlan(layoutPack(), plan).units, { headWidth: 1, portSpacing: 0 });
    const steps = layoutSteps(base({ status: 'no-world', size: [5, 4, 7], units: placement.units, supplyTier: 2 }));
    expect(steps.find((s) => s.id === 'layout:place:e')!.text).toBe('Build 1× Electric Blast Furnace (3×4×3) with the controller facing the middle row; '
      + 'hatches: Input Bus (ULV), Output Bus (LV), MV Energy Hatch, Maintenance Hatch, Input Hatch (LV)');
    expect(steps[0]!.text).toBe('Clear a 5×7 spot (4 high) and keep a 1-block path around it');
    expect(steps.every((s) => s.pin === undefined)).toBe(true);
    expect(steps.find((s) => s.id === 'layout:power:hookup')!.text).toBe('No power network found: feed the line from your own MV supply (see the power suggestions)');
    expect(layoutSteps(base({ status: 'empty', reuse: [{ stepId: 's1', name: 'Basic Macerator', count: 1, positions: [[1, 64, 1]] }] })).map((s) => s.id))
      .toEqual(['layout:reuse:s1']);
  });

  it('bomFromBlocks groups cables as power and covers as logistics', () => {
    const cover = { face: 'south' as const, item: CONV, settings: { mode: 'export' } };
    const blocks: LayoutBlock[] = [
      { pos: [0, 0, 0], block: GT(IDS.TIN_2X), role: 'cable', label: '2x Tin Cable', item: 'gregtech:gt.blockmachines@1247' },
      { pos: [1, 0, 0], block: GT(IDS.TIN_2X), role: 'cable', label: '2x Tin Cable', item: 'gregtech:gt.blockmachines@1247', hookup: 0 },
      { pos: [2, 0, 0], block: GT(IDS.MACERATOR), role: 'machine', label: 'Basic Macerator', item: 'gregtech:gt.blockmachines@2001', covers: [cover] },
      { pos: [3, 0, 0], block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest (input)', item: 'minecraft:chest@0' },
      { pos: [4, 0, 0], block: STONE, role: 'ghost', label: 'existing Stone', covers: [cover] },
      { pos: [5, 0, 0], block: GT(IDS.ENERGY_MV), role: 'hatch', label: 'MV Energy Hatch', item: 'gregtech:gt.blockmachines@42' },
    ];
    expect(bomFromBlocks(blocks, [{ key: 'minecraft:chest@0', amount: 1, why: 'spare' }])).toEqual([
      { key: 'gregtech:gt.blockmachines@1247', amount: 2, why: 'line wiring; power hookup', group: 'power' },
      { key: 'gregtech:gt.blockmachines@42', amount: 1, why: 'hatches (replace casings)', group: 'machines' },
      { key: CONV, amount: 1, why: 'covers', group: 'logistics' },
      { key: 'minecraft:chest@0', amount: 2, why: 'chests; spare', group: 'logistics' }]);
  });

  it('configure text names face, mode, whitelist and rate', () => {
    const machine: LayoutBlock = { pos: [1, 65, 1], block: GT(IDS.EXTRACTOR), role: 'machine', label: 'Basic Fluid Extractor', stepId: 'x',
      covers: [{ face: 'up', item: PUMP, settings: { mode: 'export', allowInput: false, rate: 1, unit: 'L/s' } }] };
    const macA: LayoutBlock = { pos: [2, 64, 1], block: GT(IDS.MACERATOR), role: 'machine', label: 'Basic Macerator', stepId: 's1',
      covers: [{ face: 'south', item: CONV, settings: { mode: 'export', allowInput: true, rate: 0.5, unit: 'items/s' } }],
      config: { circuit: 3, inputFilter: true, inputFromOutputSide: true } };
    const macB: LayoutBlock = { ...macA, pos: [3, 64, 1] };
    const tail: LayoutBlock = { pos: [3, 64, 2], block: GT(IDS.TIN_ITEM_PIPE), role: 'pipe', label: 'Tin Item Pipe',
      covers: [{ face: 'south', item: FILTER, settings: { mode: 'whitelist' }, filter: ['t:ingot@0'] }] };
    const pins = makePins({ dim: 0, site: { center: [5, 64, 5], text: 's' }, power: null, logistics: null, reuse: [], warnings: [] });
    const steps = layoutSteps(base({ pins, blocks: [machine, macA, macB, tail] })).filter((s) => s.kind === 'configure');
    expect(steps.map((s) => [s.id, s.pin, s.text])).toEqual([
      ['layout:configure:x', 1, 'Basic Fluid Extractor: Electric Pump (LV) on the top face: Export, 1 L/s'],
      ['layout:configure:s1', 1, 'Basic Macerator ×2: Conveyor Module (LV) on the south face: Export, allow input, 0.5 items/s; '
        + 'programmed circuit 3; Input Filter on; allow input from the output side'],
      ['layout:configure:3,0,2', 1, 'Tin Item Pipe: Filtered Conveyor Cover (Export) on the south face: whitelist Titanium Ingot']]);
    expect(coverText({ face: 'north', item: CONV, settings: { mode: 'import', rate: 1000, unit: 'items/s' } }, nameOf))
      .toBe('Conveyor Module (LV) on the north face: Import, 1,000 items/s');
    expect(configTexts({ patterns: 1, pattern: '1× A → 1× B', blockingMode: false, chips: 'Item Extractor Chip' }))
      .toEqual(['1 processing pattern', 'pattern 1× A → 1× B', 'blocking mode off', 'chips: Item Extractor Chip']);
  });

  it('asks to upgrade a tap cable that is too small instead of wiring it', () => {
    const pins = makePins({ dim: 0, site: { center: [5, 64, 5], text: 's' }, power: { pos: [0, 64, 0], text: 'p' }, logistics: null, reuse: [], warnings: [] });
    const steps = layoutSteps(base({ pins, supplyTier: 1,
      power: { cable: '2x Tin Cable', blocks: 10, amps: 2, tier: 1, arrivingVolts: 22, upgrade: { cable: '1x Tin Cable' } } }));
    expect(steps.find((s) => s.id === 'layout:power:hookup')).toMatchObject({ pin: 2,
      text: 'Upgrade the 1x Tin Cable from the tap at pin 2 to carry 2 A, then connect the line' });
  });

  // ruling R7 (architecture §11.23): every placed block names the build step that places it, for the in-game projector
  it('gives each placed block the id of the build step that places it', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }]);
    const placement = placeUnits(unitsFromPlan(layoutPack(), plan).units, { headWidth: 2, portSpacing: 0 });
    const parts = {
      stages: [{ fromTier: 2, toTier: 1, count: 1, ampsIn: 1, ampsOut: 2 }], transformerName: () => 'Low Voltage Transformer',
      cables: [{ tier: 1, cable: '2x Tin Cable', cells: 3 }], fluids: [{ key: 'fluid:oxygen', name: 'Oxygen', pipe: 'Small Bronze Fluid Pipe', cells: 2 }],
    };
    const steps = layoutSteps(base({ ...parts, units: placement.units, supplyTier: 2,
      power: { cable: '2x Annealed Copper Cable', blocks: 1, amps: 1, tier: 2, arrivingVolts: 127 },
      logistics: { kindName: 'Project Red routed', part: 'Routed Junction Pipe', blocks: 1 },
      drafts: [{ id: 'layout:logistics:line', kind: 'logistics', pin: 'site', text: 'Lay pipe' }] }));
    const tap = { pos: [9, 64, 9] as [number, number, number], dim: 0, kind: 'power' as const, networkId: 'p' };
    const hookups: Hookup[] = [{ kind: 'power', from: tap, path: [], parts: [] }, { kind: 'logistics', from: { ...tap, kind: 'routed' }, path: [], parts: [] }];
    const at = (x: number): [number, number, number] => [x, 70, 0];
    const blocks: LayoutBlock[] = [
      { pos: at(0), block: GT(IDS.MACERATOR), role: 'machine', label: 'Basic Macerator', stepId: 's1' },
      { pos: at(1), block: STONE, role: 'casing', label: 'Stone', stepId: 'gone' },
      { pos: at(2), block: GT(IDS.TRANSFORMER_LV), role: 'transformer', label: 'Low Voltage Transformer' },
      { pos: at(3), block: GT(IDS.TIN_2X), role: 'cable', label: '2x Tin Cable' },
      { pos: at(4), block: GT(IDS.TIN_1X), role: 'cable', label: '1x Tin Cable', buildStep: 'stale' },
      { pos: at(5), block: GT(IDS.ANNEALED_2X), role: 'cable', label: '2x Annealed Copper Cable', hookup: 0 },
      { pos: at(6), block: GT(IDS.TIN_ITEM_PIPE), role: 'pipe', label: 'Routed Junction Pipe', hookup: 1 },
      { pos: at(7), block: GT(IDS.SMALL_BRONZE_PIPE), role: 'pipe', label: 'Small Bronze Fluid Pipe (Oxygen)' },
      { pos: at(8), block: GT(IDS.TIN_ITEM_PIPE), role: 'pipe', label: 'Tin Item Pipe' },
      { pos: at(9), block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest (input)' },
      { pos: at(10), block: STONE, role: 'ghost', label: 'existing Stone', stepId: 's1', hookup: 0 },
      { pos: at(11), block: GT(IDS.TIN_2X), role: 'cable', label: '2x Tin Cable', hookup: 0 },
    ];
    const assigned = assignBuildSteps(blocks, steps, parts, hookups);
    expect(assigned.map((b) => b.buildStep)).toEqual(['layout:place:s1', undefined, 'layout:power:stage:1', 'layout:power:wire:1', undefined,
      'layout:power:hookup', 'layout:logistics:hookup', 'layout:logistics:fluid:fluid:oxygen', 'layout:logistics:line', 'layout:logistics:line', undefined,
      'layout:power:hookup']);
    expect(assigned.map((b) => 'buildStep' in b)).toEqual([true, false, true, true, false, true, true, true, true, true, false, true]);
    expect(blocks[4]!.buildStep).toBe('stale');
    // without a hookup or line step a rule does not match and the next one is tried: the hookup's Tin cable falls to its wire step
    const bare = layoutSteps(base({ ...parts, units: placement.units }));
    expect(assignBuildSteps(blocks, bare, parts, hookups).map((b) => b.buildStep)).toEqual(['layout:place:s1', undefined, 'layout:power:stage:1',
      'layout:power:wire:1', undefined, undefined, undefined, 'layout:logistics:fluid:fluid:oxygen', undefined, undefined, undefined, 'layout:power:wire:1']);
  });
});
