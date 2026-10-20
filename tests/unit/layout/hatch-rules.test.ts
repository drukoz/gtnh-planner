import { describe, it, expect } from 'vitest';
import {
  elementMap, elementTakes, HATCH_RULES, hatchRuleFor, ruleFits, ruleNeeds, rulePower, ruleTakes, type HatchKind, type HatchRule,
} from '../../../src/server/layout/hatch-rules.ts';
import { posKey, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { EBF_STRUCTURE } from '../../helpers/layout-fixtures.ts';

const rule = (cls: string): HatchRule => {
  const found = hatchRuleFor({ cls: `gregtech.common.tileentities.machines.multi.${cls}` });
  if (found === null) throw new Error(`no row for ${cls}`);
  return found;
};
/** The cells of `map` (posKey → element) on layer `y` of a structure. */
const layer = (map: Map<string, string>, y: number) => [...map].filter(([key]) => Number(key.split(',')[1]) === y);
const takes = (r: HatchRule, map: Map<string, string>, p: Vec3, kind: HatchKind) => elementTakes(r, map.get(posKey(p)), kind);

describe('the hatch rule table', () => {
  it('finds a row by the simple class name the export gives, whatever its package', () => {
    expect(hatchRuleFor({ cls: 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace' })?.cls).toBe('MTEElectricBlastFurnace');
    expect(hatchRuleFor({ cls: 'gregtech.api.metatileentity.implementations.MTEElectricBlastFurnace' })?.cls).toBe('MTEElectricBlastFurnace');
    expect(hatchRuleFor({ cls: 'bartworks.common.tileentities.multis.MTEBioVat' })?.cls).toBe('MTEBioVat');
    expect(hatchRuleFor({ cls: 'gregtech.common.tileentities.machines.multi.MTEAssemblyLine' })).toBeNull();
  });

  it('keeps one row per class, each with its evidence, its controller in a piece and only element characters its pieces hold', () => {
    expect(new Set(HATCH_RULES.map((r) => r.cls)).size).toBe(HATCH_RULES.length);
    for (const r of HATCH_RULES) {
      expect(r.evidence, r.cls).toContain(r.cls.replace('MTELargeBoilerBronze', 'MTELargeBoilerBase'));
      const chars = new Set(r.pieces.flatMap((p) => p.shape.flat().join('').split('')));
      expect(chars.has('~'), r.cls).toBe(true);
      expect(Object.keys(r.elements).filter((ch) => !chars.has(ch)), r.cls).toEqual([]);
      for (const c of r.casingMin ?? []) expect([...c.chars].filter((ch) => !chars.has(ch)), r.cls).toEqual([]);
    }
  });

  it("lays GT's EBF shape onto the export: bottom layer b, coils, the top layer f with the muffler m in its middle", () => {
    const ebf = rule('MTEElectricBlastFurnace');
    const map = elementMap(ebf, EBF_STRUCTURE.controller, EBF_STRUCTURE.size);
    expect(map.get('1,0,0')).toBe('~');
    expect(layer(map, 0).filter(([key]) => key !== '1,0,0').every(([, ch]) => ch === 'b')).toBe(true);
    expect(map.get('1,3,1')).toBe('m');
    expect(layer(map, 3).filter(([key]) => key !== '1,3,1').every(([, ch]) => ch === 'f')).toBe(true);
    expect(map.get('1,1,1')).toBe('-');
    expect(map.get('0,2,0')).toBe('C');
    expect(ruleFits(ebf, EBF_STRUCTURE.controller, EBF_STRUCTURE.size, EBF_STRUCTURE.blocks.map((b) => b.pos))).toBe(true);
  });

  it('never lets an EBF take an input hatch on its top layer, and lets it take an output hatch there', () => {
    // MTEElectricBlastFurnace: f = atLeast(OutputHatch); b = atLeast(InputHatch, OutputHatch, InputBus, OutputBus, Maintenance, Energy)
    const ebf = rule('MTEElectricBlastFurnace');
    const map = elementMap(ebf, EBF_STRUCTURE.controller, EBF_STRUCTURE.size);
    const top = layer(map, 3).map(([key]) => key.split(',').map(Number) as Vec3);
    expect(top.some((p) => takes(ebf, map, p, 'input_hatch'))).toBe(false);
    expect(top.filter((p) => takes(ebf, map, p, 'output_hatch'))).toHaveLength(8);
    expect(top.filter((p) => takes(ebf, map, p, 'muffler'))).toEqual([[1, 3, 1]]);
    for (const kind of ['input_hatch', 'output_hatch', 'input_bus', 'output_bus', 'energy', 'maintenance'] as const) {
      expect(takes(ebf, map, [0, 0, 1], kind), kind).toBe(true);
    }
    expect(takes(ebf, map, [0, 1, 0], 'input_hatch')).toBe(false);                                  // a coil
    expect(ebf.needs).toEqual(['muffler']);
  });

  it("gives a distillation tower's bottom its inputs and every layer above it its own output hatch", () => {
    const dt = rule('MTEDistillationTower');
    const map = elementMap(dt, [1, 0, 0], [3, 5, 3]);
    expect(takes(dt, map, [0, 0, 1], 'input_hatch')).toBe(true);
    expect(takes(dt, map, [0, 0, 1], 'output_hatch')).toBe(false);
    for (const y of [1, 2, 3, 4]) {
      expect(takes(dt, map, [0, y, 1], 'output_hatch'), `layer ${y}`).toBe(true);
      expect(takes(dt, map, [0, y, 1], 'input_hatch'), `layer ${y}`).toBe(false);
    }
    expect(map.get('1,2,1')).toBe('c');                                                            // a layer's middle
    expect(dt.layerOutputs).toEqual({ maxLayers: 12 });
    expect(dt.casingMin![0]!.min).toBeInstanceOf(Function);
  });

  it("puts a cracker's inputs on one side, its outputs on the other and its catalyst in the middle", () => {
    // MTEOilCracker: l = left adder (x = 4 in the export: a runs west), r = right adder (x = 0), m = middle input
    const cracker = rule('MTEOilCracker');
    const map = elementMap(cracker, [2, 1, 0], [5, 3, 3]);
    expect([0, 1, 2, 3, 4].map((x) => map.get(`${x},0,1`))).toEqual(['r', 'c', 'm', 'c', 'l']);
    expect(takes(cracker, map, [4, 0, 1], 'input_hatch')).toBe(true);
    expect(takes(cracker, map, [4, 0, 1], 'output_hatch')).toBe(false);
    expect(takes(cracker, map, [0, 0, 1], 'output_hatch')).toBe(true);
    expect(takes(cracker, map, [2, 0, 1], 'input_bus')).toBe(true);
    expect(cracker.fluidInputSlots).toEqual({ 0: 'l', 1: 'm' });
  });

  it('lets the large chemical reactor and the vacuum freezer take any hatch on any casing', () => {
    const lcr = rule('MTELargeChemicalReactor');
    const map = elementMap(lcr, [1, 1, 0], [3, 3, 3]);
    for (const p of [[0, 0, 0], [1, 2, 1], [2, 1, 2]] as Vec3[]) {
      for (const kind of ['input_hatch', 'output_hatch', 'input_bus', 'output_bus', 'energy', 'maintenance'] as const) expect(takes(lcr, map, p, kind)).toBe(true);
    }
    expect(takes(lcr, map, [1, 1, 1], 'input_hatch')).toBe(false);                                 // the PTFE pipe casing
    expect(ruleTakes(rule('MTEVacuumFreezer'), 'output_hatch')).toBe(true);
  });

  it("lists the hatches GT's check needs whatever the recipe moves, each on an element that takes it", () => {
    for (const r of HATCH_RULES) {
      for (const need of ruleNeeds(r)) {
        const chars = Object.keys(r.elements).filter((ch) => need.chars === undefined || need.chars.includes(ch));
        expect(chars.some((ch) => r.elements[ch]!.includes(need.kind)), `${r.cls}: ${need.kind} on ${need.chars ?? 'any'}`).toBe(true);
      }
    }
    // each class's checkMachine (research hatch-rules.md §4): checkHasMufflerHatch, checkHasInputHatch, checkHasInputBus,
    // checkHasOutputBus, checkHasOutputHatch, the cracker's side and middle hatches; a boiler boils water into steam
    const needs = (cls: string) => ruleNeeds(rule(cls)).map((n) => [n.kind, n.chars ?? null, n.fluid ?? null].filter((v) => v !== null).join(' '));
    expect(needs('MTEElectricBlastFurnace')).toEqual(['muffler']);
    expect(needs('MTEDistillationTower')).toEqual(['input_hatch']);
    expect(needs('MTEOilCracker')).toEqual(['input_hatch l', 'output_hatch r', 'input_hatch m']);
    expect(needs('MTEImplosionCompressor')).toEqual(['muffler', 'input_bus', 'output_bus']);
    expect(needs('MTEPyrolyseOven')).toEqual(['muffler']);
    expect(needs('MTEBioVat')).toEqual(['input_hatch', 'output_hatch']);
    expect(needs('MTESolarFactory')).toEqual(['input_bus', 'input_hatch', 'output_bus']);
    expect(needs('MTESteamMixer')).toEqual(['steam']);
    expect(needs('MTELargeBoilerBronze')).toEqual(['muffler', 'input_hatch fluid:water', 'output_hatch fluid:steam']);
    expect(rule('MTELargeBoilerBronze').handNote).toContain('runs dry explodes');
  });

  it('runs the primitive and steam multiblocks on no EU, and takes no ordinary hatch on the bricked blast furnace or the coke oven', () => {
    expect(rulePower(rule('MTEElectricBlastFurnace'))).toBe('eu');
    expect(rulePower(hatchRuleFor({ cls: 'gregtech.common.tileentities.machines.multi.steam.MTESteamMixer' })!)).toBe('steam');
    for (const cls of ['MTEBrickedBlastFurnace', 'MTECokeOven']) {
      expect(rulePower(rule(cls))).toBe('none');
      expect(['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance'].some((k) => ruleTakes(rule(cls), k as HatchKind))).toBe(false);
    }
  });

  it('fits only the structure it was read from', () => {
    const ebf = rule('MTEElectricBlastFurnace');
    // another variant: one coil layer more, or the controller somewhere else
    expect(ruleFits(ebf, [1, 0, 0], [3, 5, 3], [...EBF_STRUCTURE.blocks.map((b) => b.pos), [0, 4, 0]])).toBe(false);
    expect(ruleFits(ebf, [1, 1, 0], EBF_STRUCTURE.size, EBF_STRUCTURE.blocks.map((b) => b.pos))).toBe(false);
  });
});
