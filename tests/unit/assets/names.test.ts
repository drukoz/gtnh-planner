import { describe, it, expect } from 'vitest';
import { indexOf } from '../../helpers/assets-dir.ts';
import { dumpFile } from '../../helpers/textures-dump.ts';
import { buildTexturesDump } from '../../../src/server/assets/textures-dump.ts';
import {
  facesByName, fileByName, fluidFile, modDomains, nameIndex, stemCandidates, stemsOf, textureNameFaces, textureNameFile,
} from '../../../src/server/assets/names.ts';

const index = indexOf({
  'ic2/textures/items/itemPartCircuit.png': {}, 'ic2/textures/items/cell/itemCellEmpty.png': {},
  'ic2/textures/blocks/blockRubWood.png': { w: 96, h: 16 },                 // six-face strip
  'ic2/textures/blocks/blockMachine.png': { w: 384, h: 32 },                // machine sheet
  'gregtech/textures/items/gt.integrated_circuit.png': {},
  'gregtech/textures/items/gt.integrated_circuit/0.png': {}, 'gregtech/textures/items/gt.integrated_circuit/7.png': {},
  'm/textures/items/a/thing.png': {}, 'm/textures/items/b/thing.png': {},   // one basename twice
  'mod/textures/items/OddCase.png': {},
  'minecraft/textures/blocks/tnt_top.png': {}, 'minecraft/textures/blocks/tnt_bottom.png': {}, 'minecraft/textures/blocks/tnt_side.png': {},
  'minecraft/textures/blocks/pumpkin_top.png': {}, 'minecraft/textures/blocks/pumpkin_side.png': {},
  'ztones/textures/blocks/aurora.png': {},
  'minecraft/textures/items/diamond.png': {}, 'minecraft/textures/blocks/diamond_block.png': {},   // the gem and its block
  'openmodularturrets/textures/items/accuraccyUpgrade.png': {},
  'gregtech/textures/blocks/fluids/fluid.steam.png': { h: 512, frames: 32 },
  'ic2/textures/blocks/fluids/distilledwater_still.png': { h: 512, frames: 32 },
  'tinker/textures/blocks/liquid_iron.png': {}, 'dreamcraft/textures/blocks/fluidConcrete_still.png': {},
  'minecraft/textures/blocks/water_still.png': {},
});
const names = nameIndex(index);

describe('file names', () => {
  it('finds an item file by its registry name, also in a subfolder', () => {
    expect(fileByName(names, ['ic2'], 'itemPartCircuit', 0, 'items', 'north')).toBe('ic2/textures/items/itemPartCircuit.png');
    expect(fileByName(names, ['ic2'], 'itemCellEmpty', 0, 'items', 'north')).toBe('ic2/textures/items/cell/itemCellEmpty.png');
  });

  it('never picks a sheet', () => {
    expect(fileByName(names, ['ic2'], 'blockRubWood', 0, 'blocks', 'north')).toBeNull();
    expect(fileByName(names, ['ic2'], 'blockMachine', 0, 'blocks', 'north')).toBeNull();
  });

  it('tries the numbered icon of the meta first', () => {
    expect(fileByName(names, ['gregtech'], 'gt.integrated_circuit', 7, 'items', 'north')).toBe('gregtech/textures/items/gt.integrated_circuit/7.png');
    expect(fileByName(names, ['gregtech'], 'gt.integrated_circuit', 0, 'items', 'north')).toBe('gregtech/textures/items/gt.integrated_circuit/0.png');
    expect(fileByName(names, ['gregtech'], 'gt.integrated_circuit', 3, 'items', 'north')).toBe('gregtech/textures/items/gt.integrated_circuit.png');
  });

  it('counts a basename or a case-insensitive match only when it is the only one', () => {
    expect(fileByName(names, ['m'], 'thing', 0, 'items', 'north')).toBeNull();
    expect(fileByName(names, ['mod'], 'oddcase', 0, 'items', 'north')).toBe('mod/textures/items/OddCase.png');
    const twice = nameIndex(indexOf({ 'mod/textures/items/Twice.png': {}, 'mod/textures/items/twice.png': {} }));
    expect(fileByName(twice, ['mod'], 'TWICE', 0, 'items', 'north')).toBeNull();
    expect(fileByName(twice, ['mod'], 'Twice', 0, 'items', 'north')).toBe('mod/textures/items/Twice.png');   // the path itself wins
  });

  it('drops a trailing Block in blocks/', () => {
    expect(fileByName(names, ['ztones'], 'auroraBlock', 0, 'blocks', 'up')).toBe('ztones/textures/blocks/aurora.png');
  });

  it('a block\'s item never takes its material\'s item icon', () => {
    expect(fileByName(names, ['minecraft'], 'diamond_block', 0, 'items', 'north')).toBeNull();
    expect(fileByName(names, ['minecraft'], 'diamond_block', 0, 'blocks', 'north')).toBe('minecraft/textures/blocks/diamond_block.png');
    expect(fileByName(names, ['openmodularturrets'], 'accuraccyUpgradeItem', 0, 'items', 'north')).toBe('openmodularturrets/textures/items/accuraccyUpgrade.png');
  });

  it('probes each face by itself, by registry name and by texture name', () => {
    const tnt = (suffix: string): string => `minecraft/textures/blocks/tnt_${suffix}.png`;
    expect(facesByName(names, ['minecraft'], 'tnt', 0)).toEqual({
      down: tnt('bottom'), up: tnt('top'), north: tnt('side'), south: tnt('side'), west: tnt('side'), east: tnt('side') });
    const top = 'minecraft/textures/blocks/pumpkin_top.png';
    const side = 'minecraft/textures/blocks/pumpkin_side.png';
    expect(textureNameFaces(names, 'pumpkin', 0)).toEqual({ down: top, up: top, north: side, south: side, west: side, east: side });
    expect(facesByName(names, ['minecraft'], 'nothing', 0)).toBeNull();
    expect(textureNameFaces(names, 'minecraft:nothing', 0)).toBeNull();
  });

  it('gives a face that finds nothing the first face that did', () => {
    const front = nameIndex(indexOf({ 'x/textures/blocks/box_front.png': {} }));
    expect(facesByName(front, ['x'], 'box', 0)).toEqual({ down: 'x/textures/blocks/box_front.png', up: 'x/textures/blocks/box_front.png',
      north: 'x/textures/blocks/box_front.png', south: 'x/textures/blocks/box_front.png', west: 'x/textures/blocks/box_front.png', east: 'x/textures/blocks/box_front.png' });
  });

  it('probes a texture name in its own folder only', () => {
    expect(textureNameFile(names, 'gregtech:gt.integrated_circuit', 'items', 7, 'north')).toBe('gregtech/textures/items/gt.integrated_circuit/7.png');
    expect(textureNameFile(names, 'ic2:itemCellEmpty', 'items', 0, 'north')).toBeNull();   // no basename search
  });

  it('makes stems and candidates', () => {
    expect(stemsOf('tile.crayBlock', 'blocks')).toEqual(['tile.crayBlock', 'crayBlock', 'tile.cray', 'cray']);
    expect(stemsOf('tile.crayBlock', 'items')).toEqual(['tile.crayBlock', 'crayBlock']);
    expect(stemsOf('accuraccyUpgradeItem', 'items')).toEqual(['accuraccyUpgradeItem', 'accuraccyUpgrade']);
    expect(stemsOf('item.foo.bar', 'items')).toEqual(['item.foo.bar', 'foo.bar', 'bar']);
    expect(stemCandidates('x', 2, 'up')).toEqual(['x/2', 'x_2', 'x.2', 'x', 'x_top', 'x_normal', 'x_0', 'x_stage_0']);
    expect(stemCandidates('x', 0, 'north')).toEqual(['x/0', 'x', 'x_0', 'x.0', 'x_front', 'x_side', 'x_normal', 'x_stage_0']);
  });

  it('looks in the mod\'s own domain, then in the domains its texture names use', () => {
    const dump = buildTexturesDump(dumpFile({ textureNames: { blocks: {}, items: {
      'ProjRed|Transportation:a': 'projectred:x', 'ProjRed|Transportation:b': 'projectred:y', 'ProjRed|Transportation:c': 'plain' } } }), index);
    expect(modDomains(dump, 'ProjRed|Transportation')).toEqual(['projred|transportation', 'projectred', 'minecraft']);
    expect(modDomains(null, 'IC2')).toEqual(['ic2']);
    const ties = buildTexturesDump(dumpFile({ textureNames: { blocks: { 'X:a': 'zeta:a', 'X:b': 'alpha:b', 'X:c': 'x:c' }, items: { 'Y:d': 'y:d' } } }), index);
    expect(modDomains(ties, 'X')).toEqual(['x', 'alpha', 'zeta']);
    expect(modDomains(ties, 'Z')).toEqual(['z']);
  });

  it('finds fluid files by name', () => {
    expect(fluidFile(names, 'steam')).toBe('gregtech/textures/blocks/fluids/fluid.steam.png');
    expect(fluidFile(names, 'ic2distilledwater')).toBe('ic2/textures/blocks/fluids/distilledwater_still.png');
    expect(fluidFile(names, 'iron.molten')).toBe('tinker/textures/blocks/liquid_iron.png');
    expect(fluidFile(names, 'concrete')).toBe('dreamcraft/textures/blocks/fluidConcrete_still.png');
    expect(fluidFile(names, 'water')).toBe('minecraft/textures/blocks/water_still.png');
    expect(fluidFile(names, 'nothing')).toBeNull();
  });

  it('builds one name index per asset index', () => {
    expect(nameIndex(index)).toBe(names);
  });
});
