import { describe, it, expect } from 'vitest';
import { curatedBlock, curatedIds, curatedPaths } from '../../../src/server/assets/curated.ts';

const SD = 'storagedrawers/textures/blocks/';
const MC = 'minecraft/textures/blocks/';

describe('curated block tables', () => {
  it('maps Storage Drawers by wood and drawer count', () => {
    const b = curatedBlock('StorageDrawers:fullDrawers2', 1)!;
    expect(b.faces.north).toEqual([SD + 'drawers_spruce_front_2.png']);
    expect(b.faces.east).toEqual([SD + 'drawers_spruce_side.png']);
    const h = curatedBlock('StorageDrawers:halfDrawers4', 9)!;
    expect(h.faces.north).toEqual([SD + 'drawers_oak_front_4.png']);
    expect(h.faces.up).toEqual([SD + 'drawers_oak_side_h.png']);
    expect(h.faces.west).toEqual([SD + 'drawers_oak_side_v.png']);
    expect(curatedBlock('StorageDrawers:controller', 0)!.faces.north).toEqual([SD + 'drawers_controller_front.png']);
    expect(curatedBlock('StorageDrawers:compDrawers', 0)!.faces.north).toEqual([SD + 'drawers_comp_front_2.png', SD + 'drawers_comp_front_1.png', SD + 'drawers_comp_front_0.png']);
  });

  it('maps barrels, iron chests, routed pipes, conduits and AE2 blocks', () => {
    expect(curatedBlock('JABBA:barrel', 0)!.faces.north).toEqual(['jabba/textures/blocks/barrel_label_0.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 4)!.faces.north).toEqual(['ironchest/textures/blocks/silver_front.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 9)!.faces.up).toEqual(['ironchest/textures/blocks/darksteel_top.png']);
    expect(curatedBlock('fmp:pr_rinterface', 0)!.faces.west).toEqual(['projectred/textures/blocks/mechanical/pipes/routedint.png']);
    expect(curatedBlock('ForgeMultipart:block', 0)!.faces.up).toEqual(['projectred/textures/blocks/mechanical/pipes/basic.png']);
    expect(curatedBlock('conduit:item', 0)!.faces.down).toEqual(['enderio/textures/blocks/itemConduit.png']);
    expect(curatedBlock('appliedenergistics2:tile.BlockDrive', 0)!.faces.north).toEqual(['appliedenergistics2/textures/blocks/BlockDriveFront.png']);
    expect(curatedBlock('ae2cable:smart', 0)!.faces.up).toEqual(['appliedenergistics2/textures/items/ItemPart.CableSmart.png',
      'appliedenergistics2/textures/blocks/ItemPart.CableSmart.png', 'appliedenergistics2/textures/blocks/MESmart_Grey.png']);
  });

  it('maps the vanilla blocks that need more than one texture', () => {
    const g = curatedBlock('minecraft:grass', 0)!;
    expect(g.faces.up).toEqual([MC + 'grass_top.png']);
    expect(g.faces.down).toEqual([MC + 'dirt.png']);
    expect(g.tint).toEqual({ up: [145, 189, 89] });
    expect(curatedBlock('minecraft:log', 6)!.faces.up).toEqual([MC + 'log_birch_top.png']);
    expect(curatedBlock('minecraft:wool', 14)!.faces.north).toEqual([MC + 'wool_colored_red.png']);
    expect(curatedBlock('minecraft:furnace', 0)!.faces.north).toEqual([MC + 'furnace_front_off.png']);
  });

  it('answers nothing else and lists what it knows', () => {
    expect(curatedBlock('minecraft:stone', 0)).toBeNull();
    expect(curatedBlock('nope:nope', 0)).toBeNull();
    expect(curatedIds()).toEqual(expect.arrayContaining(['StorageDrawers:fullDrawers1', 'JABBA:barrel', 'fmp:pr_pipe', 'conduit:oc', 'ae2cable:smart', 'minecraft:hopper']));
    expect(curatedPaths()).toContain('jabba/textures/blocks/barrel_top_0.png');
    expect(curatedPaths().every((p) => /^[a-z0-9_.-]+\/textures\/(blocks|items)\/.+\.png$/.test(p))).toBe(true);
  });

  it('answers null for ids named after Object.prototype members', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      for (const id of [name, `fmp:${name}`, `conduit:${name}`, `ae2cable:${name}`]) expect(curatedBlock(id, 0)).toBeNull();
    }
  });
});
