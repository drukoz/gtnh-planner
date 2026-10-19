// Curated face tables for blocks whose icons are chosen in client-only code, so a dedicated
// server cannot report them (research §2.3, §5). Paths are relative to data/assets/; each face
// lists candidates and the first extracted one wins (Task 10). A face may instead draw layers cut
// out of a sheet (architecture §11.43 (b)), and a few items have an icon row of their own.
import { FACES } from '../../shared/types/assets.ts';
import type { Face, LayerRegion, Rect, Rgb } from '../../shared/types/assets.ts';

/** One layer: the first extracted of `paths`, cut to `region`, in `tint` (else its block face's tint). */
export interface CuratedLayer { paths: readonly string[]; region?: LayerRegion; tint?: Rgb }
/** A face with `layers` draws them when every one resolves, else its `faces` candidates as without them. */
export interface CuratedBlock { faces: Record<Face, readonly string[]>; tint?: Partial<Record<Face, Rgb>>; layers?: Partial<Record<Face, readonly CuratedLayer[]>> }

type FaceSpec = Partial<Record<Face, string | readonly string[]>>;

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'big_oak'];
const LOG_WOODS = ['oak', 'spruce', 'birch', 'jungle'];
const LOG2_WOODS = ['acacia', 'big_oak'];
const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const STONEBRICK = ['stonebrick', 'stonebrick_mossy', 'stonebrick_cracked', 'stonebrick_carved'];
const CHEST_TYPES = ['iron', 'gold', 'diamond', 'copper', 'silver', 'crystal', 'obsidian', 'dirtchest9000', 'netherite', 'darksteel', 'silver'];
/** The chests' model sheets (architecture §11.43 (e)): the client jar's skins of the vanilla chests, and IronChest's `<type>chest.png`. */
const CHEST_SKINS = 'minecraft/textures/entity/chest/';
const IRON_CHEST_MODELS = 'ironchest/textures/model/';
/** The width of a chest sheet in pixels (`ModelChest.setTextureSize(64, 64)`; IronChest's sheets lay out the same). */
export const CHEST_SHEET = 64;
const SAPLINGS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'roofed_oak'];
const TALLGRASS = ['deadbush', 'tallgrass', 'fern'];
const DOUBLE_PLANTS = ['sunflower', 'syringa', 'grass', 'fern', 'rose', 'paeonia'];
const SANDSTONE = ['normal', 'carved', 'smooth'];
const MONSTER_EGG = ['stone', 'cobblestone', 'stonebrick', 'stonebrick_mossy', 'stonebrick_cracked', 'stonebrick_carved'];
/** Carrot and potato growth stage → texture stage (BlockCarrot, BlockPotato). */
const ROOT_STAGES = [0, 0, 1, 1, 2, 2, 2, 3];
const NETHER_WART_STAGES = [0, 1, 1, 2];
/** ItemDye's colour order, which is WOOL's reversed. */
const DYES = ['black', 'red', 'green', 'brown', 'blue', 'purple', 'cyan', 'silver', 'gray', 'pink', 'lime', 'yellow', 'light_blue', 'magenta', 'orange', 'white'];
/** BlockBOPLog (javap): the wood of logs1…logs4 by `meta & 3`; logs3's last is the big flower stem, which has no log file. */
const BOP_LOGS: ReadonlyArray<ReadonlyArray<string | null>> = [
  ['sacredoak', 'cherry', 'dark', 'fir'], ['ethereal', 'magic', 'mangrove', 'palm'], ['redwood', 'willow', 'dead', null], ['pine', 'hellbark', 'jacaranda', 'mahogany'],
];
/** BlockBOPPlank (javap), meta 0–14. */
const BOP_PLANKS = ['plank_sacredoak', 'plank_cherry', 'plank_dark', 'plank_fir', 'plank_ethereal', 'plank_magic', 'plank_mangrove', 'plank_palm',
  'plank_redwood', 'plank_willow', 'bamboothatching', 'plank_pine', 'plank_hell_bark', 'plank_jacaranda', 'plank_mahogany'];
/** BlockBOPFoliage (javap), meta 0–15. */
const BOP_FOLIAGE = ['duckweed', 'shortgrass', 'mediumgrass', 'flaxbottom', 'bush', 'sprout', 'flaxtop', 'poisonivy', 'berrybush', 'shrub',
  'wheatgrass', 'dampgrass', 'koru', 'cloverpatch', 'leafpile', 'deadleafpile'];
/** Ztones' block sets: `Ztones:tile.<set>Block`, one file per meta in `sets/<set>/`. */
const ZTONES_SETS = ['agon', 'azur', 'bitt', 'cray', 'fort', 'iszm', 'jelt', 'korp', 'kryp', 'lair', 'lave', 'mint', 'myst', 'reds', 'reed', 'roen',
  'sols', 'sync', 'tank', 'vect', 'vena', 'zane', 'zech', 'zest', 'zeta', 'zion', 'zkul', 'zoea', 'zome', 'zone', 'zorg', 'ztyl', 'zyth'];
/** ProjectRed's part metas in `PartDefs` order (javap of `mrtjp.projectred.core.PartDefs$`, ProjRed-4.12.44-GTNH), files in `items/base/`. */
const PART = ['plate', 'conductive_plate', 'wired_plate', 'bundled_plate', 'anode', 'cathode', 'pointer', 'silicon_chip', 'energized_silicon_chip',
  'platformed_plate', 'red_ingot', 'boule', 'silicon', 'infused_silicon', 'energized_silicon', 'motor', 'copper_coil', 'iron_coil', 'gold_coil',
  ...Array.from({ length: 16 }, (_, i) => `illumar${i}`), 'cloth', 'sail', 'gemruby', 'gemsapphire', 'gemperidot', 'red_iron_comp', 'sand_coal_comp',
  'red_silicon_comp', 'glow_silicon_comp', 'null_chip', 'null_upgrd', 'upgrd_lx', 'upgrd_ly', 'upgrd_lz', 'upgrd_rx', 'upgrd_ry', 'upgrd_rz',
  'copper_ingot', 'tin_ingot', 'silver_ingot', 'electrotine_ingot', 'electrotine_dust', 'electrotine_iron_comp', 'electrotine_silicon_comp', 'electro_silicon'];

const GRASS_TINT: Rgb = [145, 189, 89];
const LEAVES_TINT: Rgb = [119, 171, 47];
/** Redstone dust with no power. */
const REDSTONE_TINT: Rgb = [76, 0, 0];

function wood(meta: number): string { return WOODS[meta] ?? 'oak'; }

/** Build a block from a per-face spec; `others` fills every face the spec does not name. */
function build(domain: string, kind: 'blocks' | 'items', spec: FaceSpec, others: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock {
  const toPaths = (v: string | readonly string[]): string[] => (typeof v === 'string' ? [v] : [...v]).map((n) => `${domain}/textures/${kind}/${n}.png`);
  const faces = {} as Record<Face, readonly string[]>;
  for (const f of FACES) faces[f] = toPaths(spec[f] ?? others);
  return tint ? { faces, tint } : { faces };
}

const blocks = (domain: string, spec: FaceSpec, others: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock => build(domain, 'blocks', spec, others, tint);
const all = (domain: string, name: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock => blocks(domain, {}, name, tint);
const allFaces = (tint: Rgb): Partial<Record<Face, Rgb>> => Object.fromEntries(FACES.map((f) => [f, tint]));

const SD = 'storagedrawers';
const PR = 'projectred';
const EIO = 'enderio';
const AE = 'appliedenergistics2';
const MC = 'minecraft';
const BOP = 'biomesoplenty';

const PIPES: Record<string, string> = {
  pr_pipe: 'basic', pr_rbasic: 'routedjunc', pr_rinterface: 'routedint', pr_rcrafting: 'routedcrafting',
  pr_rrequest: 'routedrequest', pr_rextension: 'routedextension', pr_rfire: 'routedfire', pr_pt: 'pressuretube',
  pr_rpt: 'resistancetube', pr_netvalve: 'netvalve_inout', pr_netlatency: 'netlatency',
};
const CONDUITS: Record<string, string> = {
  item: 'itemConduit', liquid: 'liquidConduit', power: 'powerConduit', redstone: 'redstoneConduit',
  me: 'meConduit', gas: 'gasConduit', oc: 'ocConduit', other: 'conduitConnector',
  // architecture "EnderIO conduits, granted change requests (add-on 11)": the ender fluid conduits the EnderIO mode lays,
  // and the connector a face shows in each mode (the textures ItemConduit and AbstractEnderLiquidConduit draw for it)
  liquid_ender: 'liquidConduitEnder', liquid_crystalline: 'liquidConduitCrystallineEnder',
  liquid_pink_slime: 'liquidConduitCrystallinePinkSlimeEnder', liquid_melodic: 'liquidConduitMelodicEnder',
  liquid_stellar: 'liquidConduitStellarEnder',
  connector_extract: 'itemConduitInput', connector_insert: 'itemConduitOutput', connector_in_out: 'itemConduitInOut_Out',
};
const AE2_CABLES: Record<string, [string, string]> = {
  glass: ['CableGlass', 'MECable'], covered: ['CableCovered', 'MECovered'], smart: ['CableSmart', 'MESmart'],
  dense: ['CableDense', 'MEDense'], dense_covered: ['CableDenseCovered', 'MEDenseCovered'],
};

function ae2Cable(center: string): CuratedBlock | null {
  const c = Object.hasOwn(AE2_CABLES, center) ? AE2_CABLES[center] : undefined;
  if (!c) return null;
  const [part, family] = c;
  const list = [`${AE}/textures/items/ItemPart.${part}.png`, `${AE}/textures/blocks/ItemPart.${part}.png`, `${AE}/textures/blocks/${family}_Grey.png`];
  const faces = {} as Record<Face, readonly string[]>;
  for (const f of FACES) faces[f] = list;
  return { faces };
}

function drawers(w: string, n: number): CuratedBlock {
  return blocks(SD, { north: `drawers_${w}_front_${n}` }, `drawers_${w}_side`);
}

/** Meta-independent or meta-driven table lookup; null for ids the tables do not know, or a meta the block does not have. */
const TABLE: Record<string, (meta: number) => CuratedBlock | null> = {
  'StorageDrawers:fullDrawers1': (m) => drawers(wood(m), 1),
  'StorageDrawers:fullDrawers2': (m) => drawers(wood(m), 2),
  'StorageDrawers:fullDrawers4': (m) => drawers(wood(m), 4),
  'StorageDrawers:halfDrawers2': (m) => halfDrawers(wood(m), 2),
  'StorageDrawers:halfDrawers4': (m) => halfDrawers(wood(m), 4),
  'StorageDrawers:compDrawers': () => blocks(SD, { north: ['drawers_comp_front_2', 'drawers_comp_front_1', 'drawers_comp_front_0'] }, 'drawers_comp_side'),
  'StorageDrawers:controller': () => blocks(SD, { north: 'drawers_controller_front' }, 'drawers_comp_side'),
  'StorageDrawers:controllerSlave': () => all(SD, 'drawers_comp_side'),
  'StorageDrawers:trim': (m) => all(SD, `drawers_${wood(m)}_trim`),
  'JABBA:barrel': () => blocks('jabba', { north: 'barrel_label_0', up: 'barrel_top_0', down: 'barrel_top_0' }, 'barrel_side_0'),
  'IronChest:BlockIronChest': (m) => {
    const t = CHEST_TYPES[m] ?? 'iron';
    return chest(ironChestSheet(t), blocks('ironchest', { north: `${t}_front`, up: `${t}_top`, down: `${t}_top` }, `${t}_side`));
  },
  'ForgeMultipart:block': () => all(PR, 'mechanical/pipes/basic'),
  'EnderIO:blockConduitBundle': () => all(EIO, 'conduitConnector'),
  'appliedenergistics2:tile.BlockController': () => all(AE, ['BlockControllerPowered', 'BlockController']),
  'appliedenergistics2:tile.BlockDrive': () => blocks(AE, { north: 'BlockDriveFront', up: 'BlockDrive', down: 'BlockDriveBottom' }, 'BlockDriveSide'),
  'appliedenergistics2:tile.BlockInterface': () => all(AE, 'BlockInterface'),
  'appliedenergistics2:tile.BlockCableBus': () => ae2Cable('glass')!,
  'minecraft:grass': () => blocks('minecraft', { up: 'grass_top', down: 'dirt' }, 'grass_side', { up: GRASS_TINT }),
  'minecraft:sand': (m) => all('minecraft', m === 1 ? 'red_sand' : 'sand'),
  'minecraft:planks': (m) => all('minecraft', `planks_${wood(m)}`),
  'minecraft:log': (m) => vanillaLog(LOG_WOODS[m & 3]!, m),
  'minecraft:log2': (m) => vanillaLog(LOG2_WOODS[m & 1]!, m),
  'minecraft:leaves': (m) => all('minecraft', `leaves_${LOG_WOODS[m & 3]}`, allFaces(LEAVES_TINT)),
  'minecraft:wool': (m) => all('minecraft', `wool_colored_${WOOL[m & 15]}`),
  'minecraft:stonebrick': (m) => all('minecraft', STONEBRICK[m & 3]!),
  'minecraft:sandstone': (m) => sandstone(m),
  'minecraft:quartz_block': () => quartzBlock(),
  'minecraft:chest': () => chest(`${CHEST_SKINS}normal.png`, all(MC, 'planks_oak')),
  'minecraft:trapped_chest': () => chest(`${CHEST_SKINS}trapped.png`, all(MC, 'planks_oak')),
  'minecraft:ender_chest': () => chest(`${CHEST_SKINS}ender.png`, all(MC, 'obsidian')),
  'minecraft:crafting_table': () => blocks('minecraft', { north: 'crafting_table_front', up: 'crafting_table_top', down: 'planks_oak' }, 'crafting_table_side'),
  'minecraft:furnace': () => blocks('minecraft', { north: 'furnace_front_off', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:lit_furnace': () => blocks('minecraft', { north: 'furnace_front_on', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:hopper': () => blocks('minecraft', { up: 'hopper_top' }, 'hopper_outside'),
  'minecraft:water': () => all('minecraft', 'water_still'),
  'minecraft:flowing_water': () => all('minecraft', 'water_still'),
  'minecraft:lava': () => all('minecraft', 'lava_still'),
  'minecraft:flowing_lava': () => all('minecraft', 'lava_still'),
  // The rest of the vanilla blocks the planner meets, by meta (RC7, RC14)
  'minecraft:leaves2': (m) => all(MC, `leaves_${LOG2_WOODS[m & 1]}`, allFaces(LEAVES_TINT)),
  'minecraft:sapling': (m) => all(MC, `sapling_${SAPLINGS[Math.min(m & 7, SAPLINGS.length - 1)]}`),   // BlockSapling clamps the type
  'minecraft:tallgrass': (m) => (m === 1 || m === 2 ? all(MC, TALLGRASS[m]!, allFaces(GRASS_TINT)) : all(MC, 'deadbush')),
  'minecraft:double_plant': (m) => doublePlant(m),
  'minecraft:carpet': (m) => all(MC, `wool_colored_${WOOL[m & 15]}`),
  'minecraft:stained_hardened_clay': (m) => all(MC, `hardened_clay_stained_${WOOL[m & 15]}`),
  'minecraft:stained_glass': (m) => all(MC, `glass_${WOOL[m & 15]}`),
  'minecraft:stained_glass_pane': (m) => all(MC, `glass_${WOOL[m & 15]}`),
  'minecraft:oak_stairs': () => all(MC, 'planks_oak'),
  'minecraft:spruce_stairs': () => all(MC, 'planks_spruce'),
  'minecraft:birch_stairs': () => all(MC, 'planks_birch'),
  'minecraft:jungle_stairs': () => all(MC, 'planks_jungle'),
  'minecraft:acacia_stairs': () => all(MC, 'planks_acacia'),
  'minecraft:dark_oak_stairs': () => all(MC, 'planks_big_oak'),
  'minecraft:wooden_slab': (m) => all(MC, `planks_${wood(m & 7)}`),
  'minecraft:double_wooden_slab': (m) => all(MC, `planks_${wood(m & 7)}`),
  'minecraft:stone_stairs': () => all(MC, 'cobblestone'),
  'minecraft:brick_stairs': () => all(MC, 'brick'),
  'minecraft:stone_brick_stairs': () => all(MC, 'stonebrick'),
  'minecraft:nether_brick_stairs': () => all(MC, 'nether_brick'),
  'minecraft:sandstone_stairs': () => sandstone(0),
  'minecraft:quartz_stairs': () => quartzBlock(),
  'minecraft:stone_slab': (m) => stoneSlab(m, false),
  'minecraft:double_stone_slab': (m) => stoneSlab(m, true),
  'minecraft:fence': () => all(MC, 'planks_oak'),
  'minecraft:fence_gate': () => all(MC, 'planks_oak'),
  'minecraft:wooden_pressure_plate': () => all(MC, 'planks_oak'),
  'minecraft:wooden_button': () => all(MC, 'planks_oak'),
  'minecraft:standing_sign': () => all(MC, 'planks_oak'),
  'minecraft:wall_sign': () => all(MC, 'planks_oak'),
  'minecraft:nether_brick_fence': () => all(MC, 'nether_brick'),
  'minecraft:cobblestone_wall': (m) => all(MC, m === 1 ? 'cobblestone_mossy' : 'cobblestone'),
  'minecraft:stone_pressure_plate': () => all(MC, 'stone'),
  'minecraft:stone_button': () => all(MC, 'stone'),
  'minecraft:light_weighted_pressure_plate': () => all(MC, 'gold_block'),
  'minecraft:heavy_weighted_pressure_plate': () => all(MC, 'iron_block'),
  'minecraft:glass_pane': () => all(MC, 'glass'),
  'minecraft:iron_bars': () => all(MC, 'iron_bars'),
  'minecraft:monster_egg': (m) => all(MC, MONSTER_EGG[m] ?? 'stone'),
  'minecraft:wheat': (m) => all(MC, `wheat_stage_${Math.min(m, 7)}`),
  'minecraft:carrots': (m) => all(MC, `carrots_stage_${ROOT_STAGES[m & 7]}`),
  'minecraft:potatoes': (m) => all(MC, `potatoes_stage_${ROOT_STAGES[m & 7]}`),
  'minecraft:nether_wart': (m) => all(MC, `nether_wart_stage_${NETHER_WART_STAGES[Math.min(m, 3)]}`),
  'minecraft:cocoa': (m) => all(MC, `cocoa_stage_${Math.min((m >> 2) & 3, 2)}`),
  'minecraft:melon_stem': () => all(MC, 'melon_stem_disconnected'),
  'minecraft:pumpkin_stem': () => all(MC, 'pumpkin_stem_disconnected'),
  'minecraft:farmland': (m) => blocks(MC, { up: m > 0 ? 'farmland_wet' : 'farmland_dry' }, 'dirt'),
  'minecraft:pumpkin': () => blocks(MC, { north: 'pumpkin_face_off', up: 'pumpkin_top', down: 'pumpkin_top' }, 'pumpkin_side'),
  'minecraft:lit_pumpkin': () => blocks(MC, { north: 'pumpkin_face_on', up: 'pumpkin_top', down: 'pumpkin_top' }, 'pumpkin_side'),
  'minecraft:dispenser': () => blocks(MC, { north: 'dispenser_front_horizontal', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:dropper': () => blocks(MC, { north: 'dropper_front_horizontal', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:fire': () => all(MC, 'fire_layer_0'),
  'minecraft:redstone_wire': () => all(MC, 'redstone_dust_cross', allFaces(REDSTONE_TINT)),
  'minecraft:bed': (m) => bed((m & 8) !== 0 ? 'head' : 'feet'),
  'minecraft:brown_mushroom_block': (m) => mushroomBlock('brown', m),
  'minecraft:red_mushroom_block': (m) => mushroomBlock('red', m),
  'minecraft:anvil': (m) => blocks(MC, { up: `anvil_top_damaged_${Math.min((m >> 2) & 3, 2)}` }, 'anvil_base'),
  'minecraft:wooden_door': (m) => all(MC, `door_wood_${(m & 8) !== 0 ? 'upper' : 'lower'}`),
  'minecraft:iron_door': (m) => all(MC, `door_iron_${(m & 8) !== 0 ? 'upper' : 'lower'}`),
  // Modded blocks no name rule finds (RC1)
  'BiomesOPlenty:logs1': (m) => bopLog(0, m),
  'BiomesOPlenty:logs2': (m) => bopLog(1, m),
  'BiomesOPlenty:logs3': (m) => bopLog(2, m),
  'BiomesOPlenty:logs4': (m) => bopLog(3, m),
  'BiomesOPlenty:planks': (m) => {
    const plank = BOP_PLANKS[m];
    return plank === undefined ? null : all(BOP, plank);
  },
  'BiomesOPlenty:foliage': (m) => bopFoliage(m),
  'IC2:blockRubWood': () => ic2Strip('ic2/textures/blocks/blockRubWood.png'),
  'Natura:bloodwood': () => blocks('natura', { up: 'bloodwood_heart_small', down: 'bloodwood_heart_small' }, 'bloodwood_bark'),
  ...ztonesRows(),
};

function halfDrawers(w: string, n: number): CuratedBlock {
  return blocks(SD, { north: `drawers_${w}_front_${n}`, up: `drawers_${w}_side_h`, down: `drawers_${w}_side_h`, west: `drawers_${w}_side_v`, east: `drawers_${w}_side_v` }, `drawers_${w}_side`);
}

/** Where a log's ends face, by `meta & 12` (BlockLog): 0 up and down, 4 west and east, 8 north and south, 12 nowhere (bark only). */
const LOG_ENDS: Readonly<Record<number, readonly Face[]>> = { 0: ['down', 'up'], 4: ['west', 'east'], 8: ['north', 'south'], 12: [] };

/** A log lying along its axis: `ends` on the two faces it points to, `bark` on the others. */
function logBlock(domain: string, ends: string, bark: string, meta: number): CuratedBlock {
  const spec: FaceSpec = {};
  for (const face of LOG_ENDS[meta & 12]!) spec[face] = ends;
  return blocks(domain, spec, bark);
}

function vanillaLog(w: string, meta: number): CuratedBlock {
  return logBlock(MC, `log_${w}_top`, `log_${w}`, meta);
}

/** BlockSandStone: the sides by meta (others draw meta 0's), and the top underneath too for carved and smooth. */
function sandstone(meta: number): CuratedBlock {
  const down = meta === 1 || meta === 2 ? 'sandstone_top' : 'sandstone_bottom';
  return blocks(MC, { up: 'sandstone_top', down }, `sandstone_${SANDSTONE[meta] ?? 'normal'}`);
}

function quartzBlock(): CuratedBlock {
  return blocks(MC, { up: 'quartz_block_top', down: 'quartz_block_bottom' }, 'quartz_block_side');
}

/** BlockStoneSlab's kinds by `meta & 7`, each drawn as its full block. */
const SLAB_KINDS: ReadonlyArray<() => CuratedBlock> = [
  () => blocks(MC, { up: 'stone_slab_top', down: 'stone_slab_top' }, 'stone_slab_side'),
  () => sandstone(0),
  () => all(MC, 'planks_oak'),
  () => all(MC, 'cobblestone'),
  () => all(MC, 'brick'),
  () => all(MC, 'stonebrick'),
  () => all(MC, 'nether_brick'),
  () => quartzBlock(),
];

/** A stone slab by its kind; a double slab with the top bit (`meta & 8`) shows its kind's top on every face, as the game draws it. */
function stoneSlab(meta: number, double: boolean): CuratedBlock {
  const kind = SLAB_KINDS[meta & 7]!();
  if (!double || (meta & 8) === 0) return kind;
  const faces = {} as Record<Face, readonly string[]>;
  for (const face of FACES) faces[face] = kind.faces.up;
  return { faces };
}

/**
 * BlockDoublePlant: the upper half (`meta & 8`) carries no type and is drawn as the grass's, the lower half by `meta & 7`;
 * grass and fern are grey until tinted. A type past the six plants has no row.
 */
function doublePlant(meta: number): CuratedBlock | null {
  if ((meta & 8) !== 0) return all(MC, 'double_plant_grass_top', allFaces(GRASS_TINT));
  const kind = DOUBLE_PLANTS[meta & 7];
  if (kind === undefined) return null;
  return all(MC, `double_plant_${kind}_bottom`, kind === 'grass' || kind === 'fern' ? allFaces(GRASS_TINT) : undefined);
}

/** One half of a bed: its top, its ends north and south, its sides west and east, planks underneath. */
function bed(part: 'head' | 'feet'): CuratedBlock {
  return blocks(MC, { up: `bed_${part}_top`, north: `bed_${part}_end`, south: `bed_${part}_end`, west: `bed_${part}_side`, east: `bed_${part}_side` }, 'planks_oak');
}

/** A huge mushroom block: meta 0 the inside everywhere, 10 the stem (inside on top and bottom), any other its cap's skin. */
function mushroomBlock(color: 'brown' | 'red', meta: number): CuratedBlock {
  if (meta === 0) return all(MC, 'mushroom_block_inside');
  if (meta === 10) return blocks(MC, { up: 'mushroom_block_inside', down: 'mushroom_block_inside' }, 'mushroom_block_skin_stem');
  return all(MC, `mushroom_block_skin_${color}`);
}

/** BOP log `block` (0 for logs1): heart ends and side bark along the vanilla axis; null for the big flower stem. */
function bopLog(block: number, meta: number): CuratedBlock | null {
  const w = BOP_LOGS[block]?.[meta & 3];
  return w ? logBlock(BOP, `log_${w}_heart`, `log_${w}_side`, meta) : null;
}

/** BlockBOPFoliage.colorMultiplier (javap): the grass's colour, the leaves' for the shrub (9) and the leaf pile (14), none for the dead leaf pile (15). */
function bopFoliage(meta: number): CuratedBlock | null {
  const name = BOP_FOLIAGE[meta];
  if (name === undefined) return null;
  const tint = meta === 15 ? undefined : meta === 9 || meta === 14 ? LEAVES_TINT : GRASS_TINT;
  return all(BOP, name, tint === undefined ? undefined : allFaces(tint));
}

/** IC2's block strips: six 16 px faces side by side in ForgeDirection order, 96 px wide. */
const IC2_STRIP_WIDTH = 96;
const IC2_FACE = 16;

/** Every face its own tile of IC2 strip `path`; no other candidates. */
function ic2Strip(path: string): CuratedBlock {
  const faces = {} as Record<Face, readonly string[]>;
  const layers: Partial<Record<Face, readonly CuratedLayer[]>> = {};
  FACES.forEach((face, side) => {
    faces[face] = [];
    layers[face] = [{ paths: [path], region: { sheet: IC2_STRIP_WIDTH, src: [IC2_FACE * side, 0, IC2_FACE, IC2_FACE] } }];
  });
  return { faces, layers };
}

/**
 * A chest cut from its model sheet `path`, each face's layers from bottom to top (architecture §11.43 (b)). ModelChest
 * (1.7.10) is a lid box 14×5×14 at texture offset (0, 0), a base 14×10×14 at (0, 19) and a knob 2×4×1 at (0, 0); ModelBox
 * lays a box (dx, dy, dz) at (u, v) out as its top at (u+dz, v), its bottom at (u+dz+dx, v) and, at row v+dz, its −X side,
 * front, +X side and back side by side. Model y grows downward, so on a face the lid spans rows 2–7, the base rows 6–16
 * and the knob columns 7–9, rows 5–9. The front is north; the model's +X side is west.
 */
export function chestLayers(path: string): Record<Face, CuratedLayer[]> {
  const layer = (src: Rect, dst: Rect): CuratedLayer => ({ paths: [path], region: { sheet: CHEST_SHEET, src, dst } });
  // One side of the base (row 33) and of the lid (row 14), `u` columns in.
  const side = (u: number): CuratedLayer[] => [layer([u, 33, 14, 10], [1, 6, 14, 10]), layer([u, 14, 14, 5], [1, 2, 14, 5])];
  return {
    down: [layer([28, 19, 14, 14], [1, 1, 14, 14])],
    up: [layer([14, 0, 14, 14], [1, 1, 14, 14])],
    north: [...side(14), layer([1, 1, 2, 4], [7, 5, 2, 4])],
    south: side(42),
    west: side(28),
    east: side(0),
  };
}

/** A chest drawn from its model sheet; a face whose sheet was not extracted draws `fallback`'s candidates, as before the sheets were copied. */
function chest(sheet: string, fallback: CuratedBlock): CuratedBlock {
  return { ...fallback, layers: chestLayers(sheet) };
}

/** IronChest's model sheet of chest type `type` (`CHEST_TYPES`): `<type>chest.png`, but `dirtchest.png` for the dirt chest. */
function ironChestSheet(type: string): string {
  return `${IRON_CHEST_MODELS}${type === 'dirtchest9000' ? 'dirt' : type}chest.png`;
}

/** `Ztones:tile.<set>Block` for every set, and `Ztones:tile.glaxx`: one file per meta, `sets/<set>/<set>_ (<meta>).png`. */
function ztonesRows(): Record<string, (meta: number) => CuratedBlock> {
  const row = (set: string) => (meta: number): CuratedBlock => all('ztones', `sets/${set}/${set}_ (${meta})`);
  return Object.fromEntries([...ZTONES_SETS.map((set) => [`Ztones:tile.${set}Block`, row(set)] as const), ['Ztones:tile.glaxx', row('glaxx')] as const]);
}

/** A pseudo id's table entry; only own keys count, so `ae2cable:constructor` or `conduit:__proto__` is unknown. */
function pseudo(id: string): CuratedBlock | null {
  if (id.startsWith('fmp:')) {
    const k = id.slice(4);
    const x = Object.hasOwn(PIPES, k) ? PIPES[k] : undefined;
    return x ? all(PR, `mechanical/pipes/${x}`) : null;
  }
  if (id.startsWith('conduit:')) {
    const k = id.slice(8);
    const x = Object.hasOwn(CONDUITS, k) ? CONDUITS[k] : undefined;
    return x ? all(EIO, x) : null;
  }
  if (id.startsWith('ae2cable:')) return ae2Cable(id.slice(9));
  return null;
}

export function curatedBlock(id: string, meta: number): CuratedBlock | null {
  const fn = Object.hasOwn(TABLE, id) ? TABLE[id] : undefined;
  return fn ? fn(meta) : pseudo(id);
}

export function curatedIds(): string[] {
  return [
    ...Object.keys(TABLE),
    ...Object.keys(PIPES).map((k) => `fmp:${k}`),
    ...Object.keys(CONDUITS).map((k) => `conduit:${k}`),
    ...Object.keys(AE2_CABLES).map((k) => `ae2cable:${k}`),
  ];
}

/** The ProjectRed pipe textures in `PipeDefs` order (the pipe item's meta), which is `PIPES`'s order. */
export const PIPE_FILES: readonly string[] = Object.values(PIPES);

/** An item's curated icon by meta (null for a meta the item does not have), and how many metas it has. */
interface ItemRow { metas: number; layer(meta: number): CuratedLayer | null }

const itemFile = (domain: string, name: string): string => `${domain}/textures/items/${name}.png`;

/** Items whose icon no texture name or name rule finds, by item id. */
const ITEMS: Record<string, ItemRow> = {
  'minecraft:coal': { metas: 2, layer: (m) => ({ paths: [itemFile(MC, m === 1 ? 'charcoal' : 'coal')] }) },
  'minecraft:dye': { metas: DYES.length, layer: (m) => ({ paths: [itemFile(MC, `dye_powder_${DYES[m & 15]}`)] }) },
  'minecraft:bow': { metas: 1, layer: () => ({ paths: [itemFile(MC, 'bow_standby')] }) },
  'ProjRed|Core:projectred.core.part': { metas: PART.length, layer: (m) => partIcon(m) },
  'ProjRed|Transportation:projectred.transportation.pipe': { metas: PIPE_FILES.length, layer: (m) => pipeIcon(m) },
  'Botania:gaiaHeadBlock': { metas: 1, layer: (m) => (m === 0 ? { paths: [itemFile('botania', 'gaiaHead')] } : null) },
};

function partIcon(meta: number): CuratedLayer | null {
  const part = PART[meta];
  return part === undefined ? null : { paths: [itemFile(PR, `base/${part}`)] };
}

/** A pipe item: the centre face of its pipe model's sheet. */
function pipeIcon(meta: number): CuratedLayer | null {
  const pipe = PIPE_FILES[meta];
  return pipe === undefined ? null : { paths: [`${PR}/textures/blocks/mechanical/pipes/${pipe}.png`], region: { sheet: 16, src: [4, 0, 8, 8] } };
}

/** Item `id`'s curated icon at `meta`; null for an item or meta the table does not know (only own keys count). */
export function curatedItem(id: string, meta: number): CuratedLayer | null {
  const row = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
  return row === undefined ? null : row.layer(meta);
}

export function curatedItemIds(): string[] {
  return Object.keys(ITEMS);
}

/** Every candidate path in the tables (faces, layers and items), over every meta value that changes the answer. */
export function curatedPaths(): string[] {
  const out = new Set<string>();
  const add = (paths: readonly string[]): void => { for (const p of paths) out.add(p); };
  for (const id of curatedIds()) {
    for (let meta = 0; meta < 16; meta++) {
      const b = curatedBlock(id, meta);
      if (b) for (const f of FACES) {
        add(b.faces[f]);
        for (const layer of b.layers?.[f] ?? []) add(layer.paths);
      }
    }
  }
  for (const id of curatedItemIds()) for (let meta = 0; meta < ITEMS[id]!.metas; meta++) add(curatedItem(id, meta)?.paths ?? []);
  return [...out].sort();
}
