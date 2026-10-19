import { describe, it, expect } from 'vitest';
import { CHEST_SHEET, chestLayers, curatedBlock, curatedIds, curatedItem, curatedItemIds, curatedPaths, PIPE_FILES } from '../../../src/server/assets/curated.ts';
import { FACES, type Face, type Rect, type Rgb } from '../../../src/shared/types/assets.ts';

const SD = 'storagedrawers/textures/blocks/';
const MC = 'minecraft/textures/blocks/';
const BOP = 'biomesoplenty/textures/blocks/';
const CHESTS = 'minecraft/textures/entity/chest/';
const MODELS = 'ironchest/textures/model/';
/** Every face with these candidates (none by default), and every face in one tint. */
const all = (...paths: string[]) => Object.fromEntries(FACES.map((f) => [f, paths]));
const allTint = (rgb: Rgb) => Object.fromEntries(FACES.map((f) => [f, rgb]));

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
    expect(curatedBlock('minecraft:log', 2)!.faces.up).toEqual([MC + 'log_birch_top.png']);
    expect(curatedBlock('minecraft:wool', 14)!.faces.north).toEqual([MC + 'wool_colored_red.png']);
    expect(curatedBlock('minecraft:furnace', 0)!.faces.north).toEqual([MC + 'furnace_front_off.png']);
  });

  it('maps vanilla blocks by meta: stairs, slabs, sandstone, carpets, log axes, crops and pumpkins', () => {
    expect(curatedBlock('minecraft:spruce_stairs', 3)!.faces.north).toEqual([MC + 'planks_spruce.png']);
    expect(curatedBlock('minecraft:sandstone', 2)!.faces.west).toEqual([MC + 'sandstone_smooth.png']);
    expect(curatedBlock('minecraft:sandstone', 1)!.faces.up).toEqual([MC + 'sandstone_top.png']);
    expect(curatedBlock('minecraft:stone_slab', 9)!.faces.up).toEqual([MC + 'sandstone_top.png']);
    expect(curatedBlock('minecraft:double_stone_slab', 8)!.faces.north).toEqual([MC + 'stone_slab_top.png']);
    expect(curatedBlock('minecraft:carpet', 14)!.faces.up).toEqual([MC + 'wool_colored_red.png']);
    expect(curatedBlock('minecraft:log', 4)!.faces.west).toEqual([MC + 'log_oak_top.png']);
    expect(curatedBlock('minecraft:log', 4)!.faces.up).toEqual([MC + 'log_oak.png']);
    expect(curatedBlock('minecraft:carrots', 5)!.faces.up).toEqual([MC + 'carrots_stage_2.png']);
    expect(curatedBlock('minecraft:pumpkin', 0)!.faces.north).toEqual([MC + 'pumpkin_face_off.png']);
  });

  it('turns logs along their axis and draws the other per-meta vanilla rows', () => {
    const log = (meta: number) => FACES.map((f) => curatedBlock('minecraft:log2', meta)!.faces[f][0]!.slice(MC.length));
    expect(log(1)).toEqual(['log_big_oak_top.png', 'log_big_oak_top.png', 'log_big_oak.png', 'log_big_oak.png', 'log_big_oak.png', 'log_big_oak.png']);
    expect(log(8)).toEqual(['log_acacia.png', 'log_acacia.png', 'log_acacia_top.png', 'log_acacia_top.png', 'log_acacia.png', 'log_acacia.png']);
    expect(log(12)).toEqual(Array(6).fill('log_acacia.png'));
    expect(['sandstone', 'sandstone', 'sandstone', 'sandstone_stairs'].map((id, meta) => curatedBlock(`minecraft:${id}`, meta)!.faces.down))
      .toEqual([[MC + 'sandstone_bottom.png'], [MC + 'sandstone_top.png'], [MC + 'sandstone_top.png'], [MC + 'sandstone_bottom.png']]);   // BlockSandStone.getIcon
    expect(curatedBlock('minecraft:double_stone_slab', 9)!.faces.down).toEqual([MC + 'sandstone_top.png']);
    expect(curatedBlock('minecraft:double_stone_slab', 15)!.faces.west).toEqual([MC + 'quartz_block_top.png']);   // the top bit: the kind's top everywhere
    expect(curatedBlock('minecraft:stone_slab', 15)!.faces.west).toEqual([MC + 'quartz_block_side.png']);       // a single slab: its upper half
    expect(curatedBlock('minecraft:sapling', 7)!.faces.up).toEqual([MC + 'sapling_roofed_oak.png']);            // BlockSapling clamps the type to 5
    expect([6, 7].map((meta) => curatedBlock('minecraft:double_plant', meta))).toEqual([null, null]);
    expect(curatedBlock('minecraft:stone_slab', 0)).toMatchObject({ faces: { up: [MC + 'stone_slab_top.png'], north: [MC + 'stone_slab_side.png'] } });
    expect(curatedBlock('minecraft:double_wooden_slab', 13)!.faces.east).toEqual([MC + 'planks_big_oak.png']);
    expect(curatedBlock('minecraft:double_plant', 10)).toEqual({ faces: all(MC + 'double_plant_grass_top.png'), tint: allTint([145, 189, 89]) });
    expect(curatedBlock('minecraft:double_plant', 0)).toEqual({ faces: all(MC + 'double_plant_sunflower_bottom.png') });
    expect(curatedBlock('minecraft:tallgrass', 0)).toEqual({ faces: all(MC + 'deadbush.png') });
    expect(curatedBlock('minecraft:tallgrass', 2)).toEqual({ faces: all(MC + 'fern.png'), tint: allTint([145, 189, 89]) });
    expect(curatedBlock('minecraft:redstone_wire', 15)).toEqual({ faces: all(MC + 'redstone_dust_cross.png'), tint: allTint([76, 0, 0]) });
    expect(curatedBlock('minecraft:bed', 9)!.faces).toMatchObject({ up: [MC + 'bed_head_top.png'], south: [MC + 'bed_head_end.png'], east: [MC + 'bed_head_side.png'], down: [MC + 'planks_oak.png'] });
    expect(curatedBlock('minecraft:anvil', 8)!.faces).toMatchObject({ up: [MC + 'anvil_top_damaged_2.png'], north: [MC + 'anvil_base.png'] });
    expect(curatedBlock('minecraft:red_mushroom_block', 10)!.faces).toMatchObject({ up: [MC + 'mushroom_block_inside.png'], west: [MC + 'mushroom_block_skin_stem.png'] });
    expect(curatedBlock('minecraft:wooden_door', 8)!.faces.north).toEqual([MC + 'door_wood_upper.png']);
    expect(curatedBlock('minecraft:farmland', 7)!.faces).toMatchObject({ up: [MC + 'farmland_wet.png'], down: [MC + 'dirt.png'] });
    expect(curatedBlock('minecraft:cocoa', 11)!.faces.up).toEqual([MC + 'cocoa_stage_2.png']);
    expect(curatedBlock('minecraft:nether_wart', 2)!.faces.up).toEqual([MC + 'nether_wart_stage_1.png']);
    expect(curatedBlock('minecraft:monster_egg', 5)!.faces.up).toEqual([MC + 'stonebrick_carved.png']);
    expect(curatedBlock('minecraft:dropper', 0)!.faces).toMatchObject({ north: [MC + 'dropper_front_horizontal.png'], up: [MC + 'furnace_top.png'], west: [MC + 'furnace_side.png'] });
  });

  it('maps BOP logs, planks and foliage, Natura bloodwood and Ztones', () => {
    expect(curatedBlock('BiomesOPlenty:logs4', 0)!.faces.up).toEqual([BOP + 'log_pine_heart.png']);
    expect(curatedBlock('BiomesOPlenty:logs1', 9)!.faces.north).toEqual([BOP + 'log_cherry_heart.png']);
    expect(curatedBlock('BiomesOPlenty:logs3', 3)).toBeNull();
    expect(curatedBlock('BiomesOPlenty:planks', 12)!.faces.up).toEqual([BOP + 'plank_hell_bark.png']);
    expect(curatedBlock('BiomesOPlenty:foliage', 10)).toMatchObject({ faces: { up: [BOP + 'wheatgrass.png'] }, tint: { up: [145, 189, 89] } });
    expect(curatedBlock('BiomesOPlenty:foliage', 15)!.tint).toBeUndefined();
    expect(curatedBlock('Ztones:tile.crayBlock', 5)!.faces.up).toEqual(['ztones/textures/blocks/sets/cray/cray_ (5).png']);
    expect(curatedBlock('BiomesOPlenty:logs2', 7)!.faces.west).toEqual([BOP + 'log_palm_heart.png']);   // palm, lying west–east
    expect(curatedBlock('BiomesOPlenty:logs2', 15)!.faces.west).toEqual([BOP + 'log_palm_side.png']);   // bark everywhere
    expect(curatedBlock('BiomesOPlenty:foliage', 9)!.tint!.north).toEqual([119, 171, 47]);
    expect(curatedBlock('Natura:bloodwood', 0)!.faces).toMatchObject({ up: ['natura/textures/blocks/bloodwood_heart_small.png'], east: ['natura/textures/blocks/bloodwood_bark.png'] });
    expect(curatedBlock('Ztones:tile.glaxx', 15)!.faces.south).toEqual(['ztones/textures/blocks/sets/glaxx/glaxx_ (15).png']);
    expect(curatedIds().filter((id) => id.startsWith('Ztones:'))).toHaveLength(34);
  });

  it('draws IC2 rubber wood from its strip, one region per face', () => {
    const wood = curatedBlock('IC2:blockRubWood', 3)!;
    expect(wood.layers!.east).toEqual([{ paths: ['ic2/textures/blocks/blockRubWood.png'], region: { sheet: 96, src: [80, 0, 16, 16] } }]);
    expect(FACES.map((f) => wood.layers![f]![0]!.region!.src[0])).toEqual([0, 16, 32, 48, 64, 80]);
    expect(wood.faces).toEqual(all());
  });

  it('draws the chest from its model sheet, with the planks as the fallback', () => {
    const N = CHESTS + 'normal.png';
    const r = (src: Rect, dst: Rect) => ({ paths: [N], region: { sheet: 64, src, dst } });
    expect(curatedBlock('minecraft:chest', 0)!.layers!.north).toEqual([r([14, 33, 14, 10], [1, 6, 14, 10]), r([14, 14, 14, 5], [1, 2, 14, 5]), r([1, 1, 2, 4], [7, 5, 2, 4])]);
    expect(curatedBlock('minecraft:chest', 0)!.layers!.up).toEqual([r([14, 0, 14, 14], [1, 1, 14, 14])]);
    expect(curatedBlock('minecraft:chest', 0)!.faces.north).toEqual(['minecraft/textures/blocks/planks_oak.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 7)!.layers!.down![0]!.paths).toEqual(['ironchest/textures/model/dirtchest.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 4)!.faces.north).toEqual(['ironchest/textures/blocks/silver_front.png']);   // unchanged fallback
  });

  it('lays the chest out as ModelChest does: base, lid and knob cut from a 64 px sheet, bottom to top', () => {
    expect(CHEST_SHEET).toBe(64);
    const layers = chestLayers('s.png');
    const cut = (face: Face) => layers[face].map((l) => [l.region!.src, l.region!.dst]);
    expect(cut('north')).toEqual([[[14, 33, 14, 10], [1, 6, 14, 10]], [[14, 14, 14, 5], [1, 2, 14, 5]], [[1, 1, 2, 4], [7, 5, 2, 4]]]);   // front, then the knob
    expect(cut('south')).toEqual([[[42, 33, 14, 10], [1, 6, 14, 10]], [[42, 14, 14, 5], [1, 2, 14, 5]]]);   // back
    expect(cut('west')).toEqual([[[28, 33, 14, 10], [1, 6, 14, 10]], [[28, 14, 14, 5], [1, 2, 14, 5]]]);    // the model's +X side
    expect(cut('east')).toEqual([[[0, 33, 14, 10], [1, 6, 14, 10]], [[0, 14, 14, 5], [1, 2, 14, 5]]]);      // the model's -X side
    expect(cut('up')).toEqual([[[14, 0, 14, 14], [1, 1, 14, 14]]]);                                         // lid top
    expect(cut('down')).toEqual([[[28, 19, 14, 14], [1, 1, 14, 14]]]);                                      // base bottom
    expect(FACES.flatMap((f) => layers[f]).every((l) => l.paths.length === 1 && l.paths[0] === 's.png' && l.region!.sheet === 64 && l.tint === undefined)).toBe(true);
  });

  it('draws the trapped and the ender chest from their sheets, with planks and obsidian as the fallback', () => {
    for (const [id, sheet, fallback] of [['minecraft:trapped_chest', 'trapped', 'planks_oak'], ['minecraft:ender_chest', 'ender', 'obsidian']] as const) {
      const b = curatedBlock(id, 0)!;
      expect(b.layers).toEqual(chestLayers(CHESTS + sheet + '.png'));
      expect(b.faces).toEqual(all(MC + fallback + '.png'));
      expect(b.tint).toBeUndefined();
    }
    expect(curatedBlock('minecraft:chest', 5)!.layers).toEqual(chestLayers(CHESTS + 'normal.png'));   // any meta: the facing is the caller's
  });

  it('names the Iron Chest sheet by type, and keeps the type\'s block icons as the fallback', () => {
    const types = ['iron', 'gold', 'diamond', 'copper', 'silver', 'crystal', 'obsidian', 'dirt', 'netherite', 'darksteel', 'silver', 'iron'];   // meta 11 and up: iron, as before
    types.forEach((t, meta) => expect(curatedBlock('IronChest:BlockIronChest', meta)!.layers).toEqual(chestLayers(`${MODELS}${t}chest.png`)));
    expect(curatedBlock('IronChest:BlockIronChest', 15)!.layers).toEqual(chestLayers(MODELS + 'ironchest.png'));
    expect(curatedBlock('IronChest:BlockIronChest', 1)!.faces).toEqual({
      ...all('ironchest/textures/blocks/gold_side.png'), north: ['ironchest/textures/blocks/gold_front.png'],
      up: ['ironchest/textures/blocks/gold_top.png'], down: ['ironchest/textures/blocks/gold_top.png'] });
    expect(curatedBlock('IronChest:BlockIronChest', 7)!.faces.north).toEqual(['ironchest/textures/blocks/dirtchest9000_front.png']);   // the block icons keep the type's own name
  });

  it('answers nothing else and lists what it knows', () => {
    expect(curatedBlock('minecraft:stone', 0)).toBeNull();
    expect(curatedBlock('nope:nope', 0)).toBeNull();
    expect(curatedIds()).toEqual(expect.arrayContaining(['StorageDrawers:fullDrawers1', 'JABBA:barrel', 'fmp:pr_pipe', 'conduit:oc', 'ae2cable:smart', 'minecraft:hopper']));
    expect(curatedPaths()).toContain('jabba/textures/blocks/barrel_top_0.png');
    expect(curatedPaths().every((p) => /^[a-z0-9_.-]+\/textures\/(blocks|items|entity\/chest|model)\/.+\.png$/.test(p))).toBe(true);
  });

  it('answers null for ids named after Object.prototype members', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      for (const id of [name, `fmp:${name}`, `conduit:${name}`, `ae2cable:${name}`]) expect(curatedBlock(id, 0)).toBeNull();
    }
  });

  it('draws the ender fluid conduits and the connector of each conduit mode', () => {
    expect(curatedBlock('conduit:liquid_ender', 0)!.faces.north).toEqual(['enderio/textures/blocks/liquidConduitEnder.png']);
    expect(curatedBlock('conduit:liquid_stellar', 0)!.faces.up).toEqual(['enderio/textures/blocks/liquidConduitStellarEnder.png']);
    expect(['connector_extract', 'connector_insert', 'connector_in_out'].map((k) => curatedBlock(`conduit:${k}`, 0)!.faces.north)).toEqual([
      ['enderio/textures/blocks/itemConduitInput.png'], ['enderio/textures/blocks/itemConduitOutput.png'], ['enderio/textures/blocks/itemConduitInOut_Out.png']]);
    expect(curatedIds()).toEqual(expect.arrayContaining(['conduit:liquid_crystalline', 'conduit:liquid_pink_slime', 'conduit:liquid_melodic']));
  });
});

describe('curated items', () => {
  const PARTS = 'projectred/textures/items/base/';

  it('draws vanilla coal and dye, ProjectRed parts and pipes, and the gaia head', () => {
    expect(curatedItem('minecraft:coal', 1)).toEqual({ paths: ['minecraft/textures/items/charcoal.png'] });
    expect(curatedItem('minecraft:dye', 4)).toEqual({ paths: ['minecraft/textures/items/dye_powder_blue.png'] });
    expect(curatedItem('ProjRed|Core:projectred.core.part', 20)).toEqual({ paths: ['projectred/textures/items/base/illumar1.png'] });
    expect(curatedItem('ProjRed|Transportation:projectred.transportation.pipe', 1))
      .toEqual({ paths: ['projectred/textures/blocks/mechanical/pipes/routedjunc.png'], region: { sheet: 16, src: [4, 0, 8, 8] } });
    expect(curatedItem('minecraft:stone', 0)).toBeNull();
    for (const name of ['constructor', '__proto__', 'toString']) expect(curatedItem(name, 0)).toBeNull();
    expect(curatedItem('Botania:gaiaHeadBlock', 0)).toEqual({ paths: ['botania/textures/items/gaiaHead.png'] });
    expect(curatedItem('Botania:gaiaHeadBlock', 1)).toBeNull();
  });

  it('follows the game\'s orders, and nothing past their ends', () => {
    expect(curatedItem('minecraft:coal', 0)).toEqual({ paths: ['minecraft/textures/items/coal.png'] });
    expect(curatedItem('minecraft:dye', 15)).toEqual({ paths: ['minecraft/textures/items/dye_powder_white.png'] });
    expect(curatedItem('minecraft:bow', 0)).toEqual({ paths: ['minecraft/textures/items/bow_standby.png'] });
    expect([37, 52, 59, 60].map((meta) => curatedItem('ProjRed|Core:projectred.core.part', meta)?.paths[0] ?? null))
      .toEqual([PARTS + 'gemruby.png', PARTS + 'copper_ingot.png', PARTS + 'electro_silicon.png', null]);
    expect(PIPE_FILES).toEqual(['basic', 'routedjunc', 'routedint', 'routedcrafting', 'routedrequest', 'routedextension', 'routedfire',
      'pressuretube', 'resistancetube', 'netvalve_inout', 'netlatency']);
    expect(curatedItem('ProjRed|Transportation:projectred.transportation.pipe', 11)).toBeNull();
  });

  it('lists the item ids, and every layer and item path among the curated paths', () => {
    expect(curatedItemIds().sort()).toEqual(['Botania:gaiaHeadBlock', 'ProjRed|Core:projectred.core.part', 'ProjRed|Transportation:projectred.transportation.pipe',
      'minecraft:bow', 'minecraft:coal', 'minecraft:dye']);
    expect(curatedPaths()).toEqual(expect.arrayContaining(['ic2/textures/blocks/blockRubWood.png', 'minecraft/textures/items/charcoal.png', PARTS + 'electro_silicon.png',
      'botania/textures/items/gaiaHead.png', 'ztones/textures/blocks/sets/zyth/zyth_ (15).png']));   // parts 16–59 too: each item row over its own metas
    expect(curatedPaths()).toEqual(expect.arrayContaining([CHESTS + 'normal.png', CHESTS + 'trapped.png', CHESTS + 'ender.png', MODELS + 'ironchest.png', MODELS + 'dirtchest.png', MODELS + 'darksteelchest.png']));
  });
});
